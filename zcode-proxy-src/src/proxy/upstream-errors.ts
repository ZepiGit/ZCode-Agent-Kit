import { decodeContentStream } from "./inflate.js";
import type { AuthManager } from "../auth/manager.js";
import type { Credential } from "../auth/types.js";
import type { AccountHandle } from "../auth/account-rotator.js";

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
}): Promise<Response> {
  let response = opts.response;
  let activeCredential = opts.credential;
  let activeHandle = opts.handle;
  const attempted = opts.attemptedIdentities ?? new Set<string>();
  if (activeHandle) attempted.add(activeHandle.effectiveIdentity);
  let envelope = await inspect(response);
  const code = envelope?.code;
  let streaming = response.headers.get("content-type")?.includes("text/event-stream") === true;
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
