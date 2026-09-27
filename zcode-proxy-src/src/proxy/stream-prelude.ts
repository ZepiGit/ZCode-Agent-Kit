/**
 * Prelude gate for upstream Anthropic SSE streams ("prelude retry").
 *
 * The official client retries a stream that fails before it emitted any
 * output event: an `event: error` (overloaded, rate limit, server error) or a
 * cut connection arriving before the first content event is retried like a
 * failed request, because nothing reached the user yet. The proxy mirrors
 * that here. A 200 stream is read frame by frame until the first content
 * event: `message_start`, `ping` and comment frames are held back (they carry
 * no output), an error frame or an early end is reported to the transient
 * ladder, and on a content event the held prelude plus the untouched rest of
 * the stream are handed on. Nothing is ever replayed: a retry cancels this
 * stream, and a surfaced stream is byte-identical to what the upstream sent
 * (decoded when it arrived compressed, then forwarded identity-encoded).
 *
 * Bounds: the decision waits at most PRELUDE_DECIDE_TIMEOUT_MS per attempt
 * and holds at most MAX_PRELUDE_BYTES; beyond either the stream is passed
 * through unread. A frame without an `event:` line is classified by its JSON
 * `type` like the translators do; data the gate cannot classify is output.
 */
import { decodeContentStream } from "./inflate.js";
import { lastFrameEnd } from "./sse-terminal.js";
import { RETRYABLE_GATEWAY_CODES, TERMINAL_GATEWAY_CODES } from "./gateway-codes.js";

export const PRELUDE_DECIDE_TIMEOUT_MS = 15_000;
export const MAX_PRELUDE_BYTES = 256 * 1024;
const DECODABLE_ENCODINGS = new Set(["gzip", "x-gzip", "deflate", "br"]);
/** Anthropic error types the official client retries (the HTTP 429/5xx class). */
const RETRYABLE_ERROR_TYPES = new Set(["overloaded_error", "api_error", "rate_limit_error", "internal_server_error", "timeout_error"]);
/** Verdicts about the request or account: handed to the client unchanged. */
const TERMINAL_ERROR_TYPES = new Set(["invalid_request_error", "authentication_error", "permission_error", "not_found_error", "request_too_large", "billing_error"]);
/** Frames before the first content event that carry no output. */
const PRELUDE_EVENTS = new Set(["message_start", "ping"]);
const EMPTY = new Uint8Array(0);
const TIMEOUT = Symbol("prelude-timeout");
const ABORTED = Symbol("prelude-aborted");

export interface PreludeVerdict {
  kind: "content" | "error" | "eof" | "passthrough";
  /** True when the ladder may re-dispatch the request (nothing reached the client). */
  retryable: boolean;
  reason: string;
  /** The stream to hand on or to cancel: held prelude + rest, identity-encoded when decoded here. */
  response: Response;
}

type ReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

function concatAll(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  if (total === 0) return EMPTY;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Split text that ends exactly at a frame boundary into its frames. Line
 * endings are normalized first so every mix lastFrameEnd accepts (CRLF, LF,
 * CR, e.g. `\n\r\n`) splits the same way; only classification sees this, the
 * forwarded bytes are untouched.
 */
function splitFrames(text: string): string[] {
  return text.replace(/\r\n|\r/g, "\n").split("\n\n").filter((frame) => frame.length > 0);
}

/**
 * Event name of a frame as the downstream translators see it: the `event:`
 * field, else the JSON `type` of the data (data-only frames are dispatched on
 * it). `undefined` only for frames without data (comments, keep-alives);
 * `"?"` for data the gate cannot classify — treated as output, never skipped.
 */
function parseFrame(frame: string): { event?: string; data: string } {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of frame.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  const joined = data.join("\n");
  if (event === undefined && joined.length) {
    try {
      const type = (JSON.parse(joined) as { type?: unknown })?.type;
      event = typeof type === "string" ? type : "?";
    } catch {
      event = "?";
    }
  }
  return { event, data: joined };
}

/**
 * Classify the payload of an `event: error` frame: retried like the official
 * client (transient error types and its retryable gateway codes), or handed
 * to the client (terminal codes and request/auth verdicts; unknown shapes).
 */
export function classifyStreamError(data: string): { retryable: boolean; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { retryable: false, reason: "error event (unparseable)" };
  }
  const outer = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const error = outer.error && typeof outer.error === "object" ? (outer.error as Record<string, unknown>) : outer;
  const type = typeof error.type === "string" ? error.type : "";
  const message = typeof error.message === "string" ? error.message : "";
  const bracket = /^\[(\d{3,4})\]/.exec(message);
  const code = bracket ? Number(bracket[1])
    : Number.isInteger(error.code) ? (error.code as number)
    : Number.isInteger(outer.code) ? (outer.code as number)
    : undefined;
  if (code !== undefined && TERMINAL_GATEWAY_CODES.has(code)) return { retryable: false, reason: `error event: gateway code ${code}` };
  if (code !== undefined && RETRYABLE_GATEWAY_CODES.has(code)) return { retryable: true, reason: `error event: gateway code ${code}` };
  if (TERMINAL_ERROR_TYPES.has(type)) return { retryable: false, reason: `error event: ${type}` };
  if (RETRYABLE_ERROR_TYPES.has(type)) return { retryable: true, reason: `error event: ${type}` };
  return { retryable: false, reason: `error event: ${type || "unknown"}` };
}

/** True for a 200 response whose body is an event stream (the only shape the gate reads). */
export function isGatedStream(resp: Response): boolean {
  return resp.status === 200 && (resp.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream") && resp.body !== null;
}

/**
 * Rebuild the client-facing body: the held prelude first, then the untouched
 * rest read from `reader` (an in-flight read is consumed first, never lost;
 * a read failure seen in the prelude is re-raised so the terminal-frame
 * monitor downstream can report it). Cancel propagates to the source.
 */
function reconstruct(
  prefix: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  inflight: Promise<ReadResult> | undefined,
  failure: { error: unknown } | undefined,
): ReadableStream<Uint8Array> {
  let prefixSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!prefixSent) {
        prefixSent = true;
        if (prefix.length) {
          controller.enqueue(prefix);
          return;
        }
      }
      if (failure) {
        controller.error(failure.error);
        return;
      }
      let result: ReadResult;
      try {
        result = inflight ? await inflight : await reader.read();
      } catch (err) {
        controller.error(err);
        return;
      }
      inflight = undefined;
      if (result.done) {
        controller.close();
        return;
      }
      controller.enqueue(result.value);
    },
    cancel(reason) {
      return reader.cancel(reason).catch(() => {});
    },
  });
}

/**
 * Read the prelude of a 200 event stream and decide whether it failed before
 * any output. The returned response replaces `resp` (whose body is consumed).
 * `decoded`: the transport already inflated the body (fetch in translation
 * mode may keep a stale `content-encoding` header) — then the bytes are read
 * as they are and the headers are handed on unchanged.
 */
export async function gateStreamPrelude(resp: Response, opts: { timeoutMs?: number; maxPreludeBytes?: number; decoded?: boolean; signal?: AbortSignal } = {}): Promise<PreludeVerdict> {
  if (!isGatedStream(resp)) return { kind: "passthrough", retryable: false, reason: "not a 200 event stream", response: resp };
  const encoding = (resp.headers.get("content-encoding") ?? "").toLowerCase();
  const codings = opts.decoded ? [] : encoding.split(",").map((c) => c.trim()).filter((c) => c && c !== "identity");
  let headers = resp.headers;
  let source = resp.body as ReadableStream<Uint8Array>;
  if (codings.length) {
    if (!codings.every((c) => DECODABLE_ENCODINGS.has(c))) return { kind: "passthrough", retryable: false, reason: "undecodable content-encoding", response: resp };
    source = decodeContentStream(source, encoding);
    headers = new Headers(resp.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
  }
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const held: Uint8Array[] = [];
  let heldBytes = 0;
  let pending: Uint8Array = EMPTY;
  const maxBytes = opts.maxPreludeBytes ?? MAX_PRELUDE_BYTES;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), opts.timeoutMs ?? PRELUDE_DECIDE_TIMEOUT_MS); });
  timer?.unref?.();
  // A client that leaves during the prelude must not keep the upstream open
  // until the time limit: the source is cancelled at once.
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    if (!opts.signal) return;
    if (opts.signal.aborted) { resolve(ABORTED); return; }
    onAbort = () => resolve(ABORTED);
    opts.signal.addEventListener("abort", onAbort, { once: true });
  });
  const finish = (kind: PreludeVerdict["kind"], retryable: boolean, reason: string, inflight?: Promise<ReadResult>, failure?: { error: unknown }): PreludeVerdict => {
    if (timer) clearTimeout(timer);
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
    const body = reconstruct(concatAll([...held, pending]), reader, inflight, failure);
    return { kind, retryable, reason, response: new Response(body, { status: resp.status, statusText: resp.statusText, headers }) };
  };
  for (;;) {
    const inflight = reader.read();
    const raced = await Promise.race([
      inflight.then((read) => ({ read }), (error: unknown) => ({ failure: { error } })),
      timeout,
      aborted,
    ]);
    if (raced === ABORTED) {
      void reader.cancel(opts.signal?.reason).catch(() => {});
      return finish("passthrough", false, "client aborted during the prelude", undefined, { error: new Error("client aborted") });
    }
    if (raced === TIMEOUT) return finish("passthrough", false, "prelude undecided within the time limit", inflight);
    if ("failure" in raced) {
      // Decoded here and nothing decodable yet: most likely a mislabelled or
      // corrupt coding — deterministic, so a retry would only cost requests.
      if (codings.length && heldBytes === 0 && pending.length === 0) return finish("passthrough", false, "body could not be decoded", undefined, raced.failure);
      return finish("eof", true, "stream failed in the prelude", undefined, raced.failure);
    }
    const { done, value } = raced.read;
    if (done) return finish("eof", true, "stream ended in the prelude");
    pending = pending.length ? concatAll([pending, value]) : value;
    // One bound for everything held back (complete frames + a partial one),
    // checked before any classification: past it the stream is committed.
    if (heldBytes + pending.length > maxBytes) return finish("passthrough", false, "prelude too large");
    const end = lastFrameEnd(pending);
    if (end === 0) continue;
    const complete = pending.subarray(0, end);
    pending = end < pending.length ? pending.slice(end) : EMPTY;
    held.push(complete);
    heldBytes += complete.length;
    for (const frame of splitFrames(decoder.decode(complete, { stream: true }))) {
      const { event, data } = parseFrame(frame);
      if (event === "error") {
        const verdict = classifyStreamError(data);
        return finish("error", verdict.retryable, verdict.reason);
      }
      if (event === undefined || PRELUDE_EVENTS.has(event)) continue;
      return finish("content", false, `first content event: ${event}`);
    }
  }
}
