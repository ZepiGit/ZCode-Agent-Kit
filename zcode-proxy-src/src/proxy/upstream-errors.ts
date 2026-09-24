import { decodeContentStream } from "./inflate.js";
import type { AuthManager } from "../auth/manager.js";
import type { Credential } from "../auth/types.js";
import type { AccountHandle } from "../auth/account-rotator.js";

/**
 * Same-account retry schedule for a clean 1005/1113 envelope (see
 * recoverAndMapUpstream). The gateway needs a variable time to fall through
 * to another balance package; live evidence ranges from seconds to about a
 * minute, so the default schedule spans ~65s before the request fails over.
 */
const DEFAULT_QUOTA_RETRY_DELAYS_MS = [1_000, 4_000, 10_000, 20_000, 30_000];
const MAX_QUOTA_RETRY_ATTEMPTS = 6;
const MAX_SINGLE_QUOTA_RETRY_DELAY_MS = 60_000;
let quotaRetryEnvWarned = false;

/** Exported for tests: the effective same-account retry schedule. */
export function quotaRetryDelays(override?: readonly number[]): readonly number[] {
  if (override) return override;
  const raw = process.env.ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS;
  if (raw === undefined) return DEFAULT_QUOTA_RETRY_DELAYS_MS;
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === "off") return [];
  // One invalid token rejects the whole value (falling back to the default
  // schedule beats a silently mutated one); empty segments are dropped, and
  // only plain decimal milliseconds are accepted — Number() would otherwise
  // read "0x10", "1e3" or "1.0" as numbers.
  const parts = trimmed.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
  const valid = parts.length > 0 && parts.every((part) => /^[0-9]+$/.test(part));
  if (!valid) {
    if (!quotaRetryEnvWarned) {
      quotaRetryEnvWarned = true;
      console.error(`[quota-retry] ignoring invalid ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS=${JSON.stringify(raw)} — using the default schedule`);
    }
    return DEFAULT_QUOTA_RETRY_DELAYS_MS;
  }
  return parts.map((part) => Math.min(Number(part), MAX_SINGLE_QUOTA_RETRY_DELAY_MS)).slice(0, MAX_QUOTA_RETRY_ATTEMPTS);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal.aborted) {
    resolve();
    return promise;
  }
  const done = () => {
    clearTimeout(timer);
    signal.removeEventListener("abort", done);
    resolve();
  };
  const timer = setTimeout(done, ms);
  signal.addEventListener("abort", done, { once: true });
  return promise;
}

export function parseGatewayErrorEnvelope(body: string): { status: number; type: string; message: string; code?: number; resetAt?: number } | null {
  if (!body || body.length > 65536) return null;
  let obj: any;
  try { obj = JSON.parse(body); } catch { return null; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || obj.content !== undefined || obj.choices !== undefined || obj.type === "message") return null;
  // Recognize only this verified Anthropic validation code, never arbitrary
  // provider text (which may contain credentials, URLs, or request IDs).
  if (obj.type === "error" && obj.error && typeof obj.error === "object" && !Array.isArray(obj.error)
    && typeof obj.error.message === "string" && obj.error.message.startsWith("[1210]")) {
    return {
      status: 400, type: "invalid_request_error", code: 1210,
      message: "[1210] Invalid thinking configuration. This model requires thinking; use effort low, high, or max.",
    };
  }
  if (!Number.isInteger(obj.code) || obj.code === 0 || obj.code === 200) return null;
  const code: number = obj.code;
  const status = code === 401 ? 401 : code === 1005 || code === 1113 || code === 3001 ? 400
    : code === 3006 || code === 3007 || code === 3012 ? 403 : code === 429 ? 429 : 502;
  const type = status === 400 ? "invalid_request_error" : status === 401 ? "authentication_error" : status === 403 ? "permission_error" : status === 429 ? "rate_limit_error" : "upstream_error";
  const message = code === 1005 ? "exceed quota limit" : code === 1113 ? "Insufficient balance" : code === 3001 ? "upstream balance or request rejected"
    : code === 3007 ? "captcha verify failed" : code === 3006 ? "model not allowed" : code === 3012 ? "upstream authorization rejected" : code === 401 ? "upstream authentication rejected" : "upstream request failed";
  const resetRaw = obj.resetAt ?? obj.reset_at ?? obj.data?.resetAt ?? obj.data?.reset_at;
  const resetNumber = typeof resetRaw === "number" && Number.isFinite(resetRaw) && resetRaw > 0
    ? (resetRaw < 1_000_000_000_000 ? resetRaw * 1000 : resetRaw)
    : undefined;
  // Never echo upstream msg, error objects, URLs, cookies, or credentials.
  return { status, type, message: `[${code}] ${message}`, code, ...(resetNumber === undefined ? {} : { resetAt: resetNumber }) };
}

async function readBounded(stream: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 65536) return null;
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function inspect(resp: Response): Promise<{ status: number; type: string; message: string; code?: number; resetAt?: number } | null> {
  if (resp.headers.get("content-type")?.includes("text/event-stream")) return null;
  try {
    const copy = resp.clone();
    if (!copy.body) return null;
    const bytes = await readBounded(copy.body);
    if (!bytes) return null;
    const raw = new TextDecoder().decode(bytes);
    // Fetch may already decode while retaining Content-Encoding. Never inflate JSON twice.
    try { JSON.parse(raw); return parseGatewayErrorEnvelope(raw); } catch { /* compressed or malformed */ }
    const encoding = copy.headers.get("content-encoding")?.trim().toLowerCase();
    if (!encoding) return null;
    const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    const decoded = await readBounded(decodeContentStream(source, encoding));
    return decoded ? parseGatewayErrorEnvelope(new TextDecoder().decode(decoded)) : null;
  } catch { return null; } // Unsupported/corrupt coding must not turn a valid response into 502.
}

/** Before output only. SSE is never sniffed/replayed, including in-stream errors. */
export async function recoverAndMapUpstream(opts: {
  response: Response; auth: AuthManager; credential: Credential; plan: string;
  /** Immutable context captured immediately before the first upstream send. */
  handle?: AccountHandle;
  signal: AbortSignal; resend: (credential: Credential) => Promise<Response>;
  /** Optional handle-preserving resend used by pooled transports. */
  resendHandle?: (handle: AccountHandle) => Promise<Response>;
  /** Shared retry budget/identity set for callers that compose recovery layers. */
  attemptedIdentities?: Set<string>;
  /** Test seam: wait schedule for same-credential quota retries. */
  quotaRetryDelaysMs?: readonly number[];
}): Promise<Response> {
  let response = opts.response;
  let activeCredential = opts.credential;
  let activeHandle = opts.handle;
  const attempted = opts.attemptedIdentities ?? new Set<string>();
  if (activeHandle) attempted.add(activeHandle.effectiveIdentity);
  let envelope = await inspect(response);
  let code = envelope?.code;
  let streaming = response.headers.get("content-type")?.includes("text/event-stream") === true;
  // A clean 1005/1113 envelope can name one exhausted package while the same
  // account still holds balance for the model in another package (e.g. an
  // event grant next to an empty daily free package). Observed live: the
  // gateway then serves a retry from the package that still has balance, but
  // the time it needs varies (seconds to about a minute), so the same
  // credential is retried on a growing schedule. These envelopes prove only
  // that no output reached the client, so a bounded resend cannot duplicate
  // a response — whether a rejected request costs tokens is decided by the
  // gateway, exactly as in the existing rotation path. A start-plan resend
  // re-mints a captcha token like any failover resend. If the schedule is
  // exhausted and the last response still reports exhaustion, the rotation
  // below treats it as a real quota failure and the per-credential memo
  // suppresses further same-account retries until the reset window.
  // 3007 (captcha verify failed) is deliberately NOT retried here: the
  // handler captcha-retry layer already owns one fresh-token resend for it.
  const quotaEnvelope = envelope !== null && [1005, 1113].includes(envelope.code ?? -1);
  if (quotaEnvelope && !streaming && !opts.signal.aborted) {
    let confirmedExhausted = false;
    let scheduleCompleted = true;
    for (const [index, delayMs] of quotaRetryDelays(opts.quotaRetryDelaysMs).entries()) {
      const retryAdmitted = activeHandle
        ? opts.auth.canResendCredential?.(activeHandle) ?? false
        : opts.auth.canResendCredential?.(activeCredential) ?? false;
      if (!retryAdmitted) { scheduleCompleted = false; break; }
      await abortableDelay(delayMs, opts.signal);
      // Re-admit after the wait: a concurrent quarantine, pause, credential
      // replace, removal or a remembered failed retry must not send again.
      const readmitted = !opts.signal.aborted
        && (activeHandle
          ? opts.auth.canResendCredential?.(activeHandle) ?? false
          : opts.auth.canResendCredential?.(activeCredential) ?? false);
      if (!readmitted) { scheduleCompleted = false; break; }
      const accountLabel = activeHandle?.id
        ?? (opts.auth.isAccountPoolEnabled?.() ? "pool" : "single-account");
      console.log(`[quota-retry] account ${accountLabel}: same-account resend ${index + 1} after ${delayMs}ms`);
      try {
        const retried = activeHandle && opts.resendHandle
          ? await opts.resendHandle(activeHandle)
          : await opts.resend(activeCredential);
        const retriedEnvelope = await inspect(retried);
        const retriedStreaming = retried.headers.get("content-type")?.includes("text/event-stream") === true;
        const retriedQuota = retriedEnvelope !== null && [1005, 1113].includes(retriedEnvelope.code ?? -1);
        // Adopt the retry only when it succeeded or is itself a quota
        // envelope; any other failure (5xx, 429, captcha) keeps the current
        // quota envelope so the rotation below still fails over.
        if ((retried.ok && retriedEnvelope === null) || retriedQuota) {
          void response.body?.cancel().catch(() => {});
          response = retried;
          envelope = retriedEnvelope;
          code = retriedEnvelope?.code;
          streaming = retriedStreaming;
        } else {
          void retried.body?.cancel().catch(() => {});
          scheduleCompleted = false;
          break;
        }
        if (!retriedQuota) break; // served from a package with balance — done
        // A SENT retry came back exhausted: this is real evidence for the memo.
        confirmedExhausted = true;
      } catch {
        // The retry could not be sent (connect or captcha failure): keep the
        // current quota envelope so rotation below is not lost.
        scheduleCompleted = false;
        break;
      }
    }
    // Memoize only proven exhaustion across a FULLY run schedule: a sent
    // retry must have returned a quota envelope and no abort, admission
    // denial, non-quota failure or transport error may have interrupted the
    // schedule — an interrupted one is inconclusive, not evidence.
    if (scheduleCompleted && confirmedExhausted && envelope !== null && [1005, 1113].includes(envelope.code ?? -1)) {
      opts.auth.blockSameCredentialRetry?.(activeHandle ?? activeCredential, envelope.resetAt);
    }
  }
  // Account-pool retries are limited to explicit balance/quota envelopes. The
  // legacy single-account manager may still recover 401/3012 through its
  // desktop-import path; pool mode itself rejects those signals in
  // AuthManager, preventing accidental rotation on auth/model errors.
  const rotationCode = code !== 1210 && (response.status === 401 || [3012, 401, 1005, 1113, 3001].includes(code ?? -1))
    ? (code ?? (response.status === 401 ? 401 : undefined))
    : undefined;
  if (!streaming && !opts.signal.aborted && rotationCode !== undefined) {
    const pooledContext = activeHandle && (opts.auth.isAccountPoolEnabled?.() ?? false);
    const currentHandle = activeHandle;
    const freshHandle = pooledContext && currentHandle
      ? await opts.auth.recoverCredentialHandle(currentHandle, opts.plan, String(rotationCode), envelope?.resetAt, attempted)
      : null;
    const fresh = freshHandle?.credential
      ?? (!pooledContext ? await opts.auth.recoverCredential(opts.credential, opts.plan, String(rotationCode), envelope?.resetAt) : null);
    if (fresh && !opts.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      activeCredential = fresh;
      if (freshHandle) {
        activeHandle = freshHandle;
        attempted.add(freshHandle.effectiveIdentity);
      }
      response = freshHandle && opts.resendHandle
        ? await opts.resendHandle(freshHandle)
        : await opts.resend(fresh); // Exactly one attempt, no nested connect/captcha retry.
      envelope = await inspect(response);
      streaming = response.headers.get("content-type")?.includes("text/event-stream") === true;
    }
  }
  // A 200 SSE header only proves that a stream was opened. The stream may
  // still contain an error event, so it is never a health acknowledgement.
  const successfulJson = response.status === 200 && (response.headers.get("content-type") ?? "").toLowerCase().includes("json");
  if (successfulJson && !envelope && !streaming) {
    // Handlers in downstream integrations sometimes provide a minimal
    // credential provider mock. Pool health bookkeeping is additive and must
    // not turn an otherwise successful upstream response into a 502.
    opts.auth.markCredentialHealthy?.(activeHandle ?? activeCredential);
    return response;
  }
  // Successful responses without a parseable envelope are returned as-is. In
  // particular this is the normal path for SSE: the header is not proof that
  // the model completed, but it must never be turned into `envelope!.status`.
  if (response.ok && !envelope) return response;
  if (envelope && [1005, 1113, 3001].includes(envelope.code ?? -1)) {
    // If the one permitted failover request also reports exhaustion, quarantine
    // that second account before returning the mapped error. This prevents the
    // next request from selecting it repeatedly while the reset window lasts.
    opts.auth.markCredentialExhausted?.(activeHandle ?? activeCredential, String(envelope.code), envelope.resetAt);
  }
  const status = response.ok ? envelope!.status : response.status;
  const type = status === 401 ? "authentication_error" : status === 403 ? "permission_error" : status === 429 ? "rate_limit_error" : envelope?.code === 1210 || response.ok ? envelope?.type ?? "upstream_error" : "upstream_error";
  const message = envelope?.message ?? `Upstream request failed (HTTP ${status}).`;
  const result = Response.json({ error: { type, message } }, { status });
  // Preserve retry guidance only when it is a bounded numeric delta, not arbitrary upstream data.
  const retryAfter = response.headers.get("retry-after");
  if (status === 429 && retryAfter && /^\d{1,6}$/.test(retryAfter)) result.headers.set("retry-after", retryAfter);
  const requestId = response.headers.get('x-request-id');
  if (requestId && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) result.headers.set('x-request-id', requestId);
  void response.body?.cancel().catch(() => {});
  return result;
}
