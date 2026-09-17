import type { AuthManager } from "../auth/manager.js";
import type { Credential } from "../auth/types.js";

export function parseGatewayErrorEnvelope(body: string): { status: number; type: string; message: string; code?: number } | null {
  if (!body || body.length > 65536) return null;
  let obj: any;
  try { obj = JSON.parse(body); } catch { return null; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || obj.content !== undefined || obj.choices !== undefined || obj.type === "message") return null;
  if (!Number.isInteger(obj.code) || obj.code === 0 || obj.code === 200) return null;
  const code: number = obj.code;
  const status = code === 401 ? 401 : code === 1005 || code === 1113 || code === 3001 ? 400
    : code === 3006 || code === 3007 || code === 3012 ? 403 : code === 429 ? 429 : 502;
  const type = status === 400 ? "invalid_request_error" : status === 401 ? "authentication_error" : status === 403 ? "permission_error" : status === 429 ? "rate_limit_error" : "upstream_error";
  const message = code === 1005 ? "exceed quota limit" : code === 1113 ? "Insufficient balance" : code === 3001 ? "upstream balance or request rejected"
    : code === 3007 ? "captcha verify failed" : code === 3006 ? "model not allowed" : code === 3012 ? "upstream authorization rejected" : code === 401 ? "upstream authentication rejected" : "upstream request failed";
  // Never echo upstream msg, error objects, URLs, cookies, or credentials.
  return { status, type, message: `[${code}] ${message}` };
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

async function inspect(resp: Response): Promise<{ status: number; type: string; message: string; code?: number } | null> {
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
    if (encoding !== "gzip" && encoding !== "deflate") return null;
    const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
    const decoded = await readBounded(source.pipeThrough(new DecompressionStream(encoding) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
    return decoded ? parseGatewayErrorEnvelope(new TextDecoder().decode(decoded)) : null;
  } catch { return null; } // Unsupported/corrupt coding must not turn a valid response into 502.
}

/** Before output only. SSE is never sniffed/replayed, including in-stream errors. */
export async function recoverAndMapUpstream(opts: {
  response: Response; auth: AuthManager; credential: Credential; plan: string;
  signal: AbortSignal; resend: (credential: Credential) => Promise<Response>;
}): Promise<Response> {
  let response = opts.response;
  let envelope = await inspect(response);
  const code = envelope ? Number(/^\[(\d+)\]/.exec(envelope.message)?.[1]) : undefined;
  const streaming = response.headers.get("content-type")?.includes("text/event-stream");
  if (!streaming && !opts.signal.aborted && (response.status === 401 || [3012, 401, 1113, 3001].includes(code!))) {
    const fresh = await opts.auth.recoverCredential(opts.credential, opts.plan);
    if (fresh && !opts.signal.aborted) {
      void response.body?.cancel().catch(() => {});
      response = await opts.resend(fresh); // Exactly one attempt, no nested connect/captcha retry.
      envelope = await inspect(response);
    }
  }
  if (response.ok && !envelope) return response;
  const status = response.ok ? envelope!.status : response.status;
  const type = status === 401 ? "authentication_error" : status === 403 ? "permission_error" : status === 429 ? "rate_limit_error" : response.ok ? envelope?.type ?? "upstream_error" : "upstream_error";
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
