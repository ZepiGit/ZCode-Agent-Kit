/**
 * Admission control (ADR-0004): a cap on the request-body bytes in flight.
 *
 * A request that carries a body is admitted before anything reads it. It is
 * admitted when the bytes already in flight plus its own fit under the cap, or
 * when nothing is in flight at all (an idle proxy always admits, so a single
 * request at the largest body size the handlers accept is never shed). Until
 * then it waits in a FIFO without its body being read, so the backpressure
 * stays on the client's socket. The FIFO is bounded by a count
 * (`DEFAULT_MAX_QUEUED`) and by time (`DEFAULT_QUEUE_TIMEOUT_MS`); past either
 * bound the request is shed with HTTP 503 + `Retry-After` in its endpoint's
 * error shape (`shedResponse`), never 429 and never a reset.
 *
 * Accounting:
 * - A request is charged its `Content-Length` on admission. A body without
 *   one (chunked) is charged the largest wire body the handlers accept
 *   (`UNKNOWN_LENGTH_BYTES`, 32 MiB) until its reader has it all; from then on
 *   it is charged the bytes really read (`settleBodyBytes`). The cap therefore
 *   holds for chunked bodies too: a reservation is never smaller than what the
 *   reader may still read.
 * - A gzip body is charged its inflated size once inflated. That growth is
 *   charged at once (the bytes exist already), so in-flight bytes can pass the
 *   cap by at most the inflation of requests already admitted; nothing new is
 *   admitted until they are back under it.
 * - The bytes are given back when the route handler has produced its
 *   response (the upstream answered, so no retry needs the body any more) or
 *   when the client goes away, whichever comes first. The response body that
 *   follows, a stream however long, is not limited.
 */
import { createEventLogger, type EventLogger } from "../log/event-line.mjs";

/** The default cap: 64 MB of request bodies in flight (ADR-0004). */
export const DEFAULT_MAX_IN_FLIGHT_MB = 64;
export const DEFAULT_MAX_IN_FLIGHT_BYTES = DEFAULT_MAX_IN_FLIGHT_MB * 1024 * 1024;
/** The FIFO's count bound: requests waiting for admission at most. */
export const DEFAULT_MAX_QUEUED = 64;
/** The FIFO's time bound. */
export const DEFAULT_QUEUE_TIMEOUT_MS = 15_000;
/** `Retry-After` of an admission shed, in seconds. */
export const SHED_RETRY_AFTER_SECONDS = 2;
/** The largest wire body any handler accepts (`readBody` in proxy/handler.ts). */
export const MAX_WIRE_BODY_BYTES = 32 * 1024 * 1024;
/** What a body without `Content-Length` is charged until it has been read. */
export const UNKNOWN_LENGTH_BYTES = MAX_WIRE_BODY_BYTES;
/** A request that held at least this much asks the runtime for a collection when it gives its bytes back. */
export const DEFAULT_COLLECT_AFTER_BYTES = 4 * 1024 * 1024;

export interface AdmissionStats {
  /** Request-body bytes currently charged to admitted requests. */
  inFlightBytes: number;
  /** Requests waiting for admission. */
  queued: number;
  /** Requests shed since start (queue full or queue timeout). */
  shedTotal: number;
  /** The highest `inFlightBytes` seen since start. */
  peakInFlightBytes: number;
  maxInFlightBytes: number;
  maxQueued: number;
  queueTimeoutMs: number;
  /** Request-body bytes the listener has handed to handlers since start (the server-side read counter). */
  bodyBytesRead: number;
}

/** An admitted request's share of the cap. */
export interface AdmissionTicket {
  /** Bytes currently charged. */
  readonly bytes: number;
  /** Charge exactly `bytes` from now on (shrinks or grows the reservation). */
  settle(bytes: number): void;
  /** Give the bytes back. Idempotent. */
  release(): void;
}

export type ShedReason = "queue_full" | "queue_timeout";

export type AdmitResult =
  | { ok: true; ticket: AdmissionTicket }
  | { ok: false; reason: ShedReason; waitedMs: number }
  /** The client went away while waiting: nobody to answer, not a shed. */
  | { ok: false; reason: "aborted"; waitedMs: number };

export interface Admission {
  /** Wait for admission of a request charged `bytes`. */
  admit(bytes: number, signal?: AbortSignal): Promise<AdmitResult>;
  stats(): AdmissionStats;
  /** Count `bytes` of request body read from a client socket. */
  noteBodyRead(bytes: number): void;
  /** Count a shed and write its event line. */
  recordShed(fields: { reason: ShedReason; endpoint: string; bytes: number; waitedMs: number }): void;
}

export interface AdmissionOptions {
  maxInFlightBytes: number;
  maxQueued?: number;
  queueTimeoutMs?: number;
  /** Event-line sink for shed events (default: the console). */
  writeLog?: (line: string) => void;
  /** Bytes a released request must have held to trigger `collect` (0 = never). */
  collectAfterBytes?: number;
  /** Ask the runtime to collect garbage (default: a full Bun GC; a no-op off Bun). */
  collect?: () => void;
}

interface Waiter {
  bytes: number;
  settle(result: AdmitResult): void;
}

function defaultCollect(): void {
  const bun = (globalThis as { Bun?: { gc(force: boolean): void } }).Bun;
  bun?.gc(true);
}

export function createAdmission(opts: AdmissionOptions): Admission {
  const max = opts.maxInFlightBytes;
  const maxQueued = opts.maxQueued ?? DEFAULT_MAX_QUEUED;
  const queueTimeoutMs = opts.queueTimeoutMs ?? DEFAULT_QUEUE_TIMEOUT_MS;
  const collectAfter = opts.collectAfterBytes ?? DEFAULT_COLLECT_AFTER_BYTES;
  const collect = opts.collect ?? defaultCollect;
  const log: EventLogger = createEventLogger({ component: "shed", ...(opts.writeLog ? { write: opts.writeLog } : {}) });
  let inFlight = 0;
  let peak = 0;
  let shedTotal = 0;
  let bodyBytesRead = 0;
  let collectPending = false;
  const queue: Waiter[] = [];

  const fits = (bytes: number): boolean => inFlight === 0 || inFlight + bytes <= max;

  function charge(delta: number): void {
    inFlight += delta;
    if (inFlight > peak) peak = inFlight;
  }

  // The body copies a large request leaves behind are garbage once it has
  // its response; collecting before they pile up keeps the peak near the
  // live bytes under the cap. Deferred so the response is written first, and
  // coalesced to one pending collection.
  function scheduleCollect(): void {
    if (collectPending) return;
    collectPending = true;
    setImmediate(() => {
      collectPending = false;
      try { collect(); } catch { /* never fail a request over a collection */ }
    });
  }

  function ticket(initial: number): AdmissionTicket {
    let bytes = initial;
    let held = initial;
    let released = false;
    charge(bytes);
    return {
      get bytes() { return bytes; },
      settle(next: number) {
        if (released) return;
        const value = Math.max(0, Math.floor(next));
        charge(value - bytes);
        bytes = value;
        held = Math.max(held, value);
        pump();
      },
      release() {
        if (released) return;
        released = true;
        charge(-bytes);
        bytes = 0;
        if (collectAfter > 0 && held >= collectAfter) scheduleCollect();
        pump();
      },
    };
  }

  function pump(): void {
    while (queue.length && fits(queue[0].bytes)) {
      const waiter = queue.shift()!;
      waiter.settle({ ok: true, ticket: ticket(waiter.bytes) });
    }
  }

  return {
    admit(bytes: number, signal?: AbortSignal): Promise<AdmitResult> {
      const cost = Math.max(0, Math.floor(bytes));
      if (signal?.aborted) return Promise.resolve({ ok: false, reason: "aborted", waitedMs: 0 });
      if (queue.length === 0 && fits(cost)) return Promise.resolve({ ok: true, ticket: ticket(cost) });
      if (queue.length >= maxQueued) return Promise.resolve({ ok: false, reason: "queue_full", waitedMs: 0 });
      return new Promise<AdmitResult>((resolve) => {
        const enqueuedAt = Date.now();
        let done = false;
        const leave = (): void => {
          const i = queue.indexOf(waiter);
          if (i >= 0) queue.splice(i, 1);
        };
        const finish = (result: AdmitResult): void => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const onAbort = (): void => {
          leave();
          finish({ ok: false, reason: "aborted", waitedMs: Date.now() - enqueuedAt });
          pump();
        };
        const waiter: Waiter = {
          bytes: cost,
          settle: (result) => {
            if (done) {
              // Admitted after the waiter gave up: give the bytes straight back.
              if (result.ok) result.ticket.release();
              return;
            }
            finish(result);
          },
        };
        const timer = setTimeout(() => {
          leave();
          finish({ ok: false, reason: "queue_timeout", waitedMs: Date.now() - enqueuedAt });
          // The head may have been the one that did not fit.
          pump();
        }, queueTimeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(waiter);
      });
    },
    stats(): AdmissionStats {
      return {
        inFlightBytes: inFlight,
        queued: queue.length,
        shedTotal,
        peakInFlightBytes: peak,
        maxInFlightBytes: max,
        maxQueued,
        queueTimeoutMs,
        bodyBytesRead,
      };
    },
    noteBodyRead(bytes: number): void {
      bodyBytesRead += bytes;
    },
    recordShed({ reason, endpoint, bytes, waitedMs }): void {
      shedTotal++;
      log.warn("request shed", {
        reason,
        endpoint,
        bytes,
        waitedMs,
        inFlightBytes: inFlight,
        queued: queue.length,
        maxInFlightBytes: max,
        retryAfterS: SHED_RETRY_AFTER_SECONDS,
      });
    },
  };
}

/** The tickets of admitted requests, for the body readers. */
const tickets = new WeakMap<Request, AdmissionTicket>();

/** Bind `ticket` to `req` so the body reader can settle the real body size. */
export function bindTicket(req: Request, ticket: AdmissionTicket): void {
  tickets.set(req, ticket);
}

/**
 * Called by a body reader once it holds the whole body: from now on the
 * request is charged `bytes` (the bytes read, or the inflated size of a gzip
 * body). A request that bypassed admission has no ticket; this is then a no-op.
 */
export function settleBodyBytes(req: Request, bytes: number): void {
  tickets.get(req)?.settle(bytes);
}

/**
 * Bytes a request is charged on admission, before its body is read: its
 * `Content-Length`, or, without one, `UNKNOWN_LENGTH_BYTES` until the reader
 * settles the real size. `null` means the request bypasses admission: it
 * declares no body (`Content-Length: 0`, or no body stream at all), or its
 * declared length already exceeds what any handler accepts, so it is refused
 * (413) without being read.
 */
export function admissionCost(req: Request): number | null {
  const declared = req.headers.get("content-length")?.trim();
  if (declared !== undefined && /^\d+$/.test(declared)) {
    const n = Number(declared);
    if (n === 0 || n > MAX_WIRE_BODY_BYTES) return null;
    return n;
  }
  if (!req.body) return null;
  return UNKNOWN_LENGTH_BYTES;
}

/** The two error shapes of the proxy's endpoints. */
export type EndpointShape = "anthropic" | "openai";

/**
 * The ADR-0004 shed contract: HTTP 503 with `Retry-After`, in the endpoint's
 * own error shape (Anthropic `overloaded_error`; the OpenAI `error` object).
 * Never 429: clients map 429 to quota exhaustion. The message says what
 * happened, why and what to do next. Reused by the supervisor's drain (21)
 * and the solver's fail-fast window (58) with their own why and Retry-After.
 */
export function shedResponse(shape: EndpointShape, opts: { why: string; retryAfterSeconds: number; next?: string }): Response {
  const retry = Math.max(1, Math.ceil(opts.retryAfterSeconds));
  const message = [
    "The proxy is busy and did not accept this request.",
    opts.why,
    `Retry in ${retry} s${opts.next ? `; ${opts.next}` : ""}.`,
  ].join(" ");
  const body = shape === "anthropic"
    ? { type: "error", error: { type: "overloaded_error", message } }
    : { error: { message, type: "server_error", param: null, code: "overloaded" } };
  return new Response(JSON.stringify(body), {
    status: 503,
    headers: { "content-type": "application/json", "retry-after": String(retry) },
  });
}

/** The why of an admission shed. */
export function admissionShedWhy(reason: ShedReason, stats: AdmissionStats, waitedMs: number): string {
  const capMB = Math.round(stats.maxInFlightBytes / (1024 * 1024));
  const inFlightMB = (stats.inFlightBytes / (1024 * 1024)).toFixed(1);
  const cause = reason === "queue_full"
    ? `the admission queue is full (${stats.maxQueued} waiting)`
    : `it waited ${(waitedMs / 1000).toFixed(1)} s for admission (the limit is ${stats.queueTimeoutMs / 1000} s)`;
  return `Its body was not admitted because ${cause}, while ${inFlightMB} MB of request bodies are in flight against a cap of ${capMB} MB (server.admission.maxInFlightMB).`;
}

/** The next step of an admission shed. */
export const ADMISSION_SHED_NEXT = "if this keeps happening, send fewer large requests at once or raise server.admission.maxInFlightMB in the proxy's config.yaml";
