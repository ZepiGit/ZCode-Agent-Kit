/**
 * Main proxy handler — routes requests, injects auth, forwards, and streams responses.
 *
 * **Current upstream behavior**: BOTH plan tiers post an
 * Anthropic-format upstream — coding-plan mirrors the real ZCode client
 * (api.z.ai/api/anthropic → ultra via endpoint routing); start-plan posts to
 * zcode.z.ai's Anthropic gateway with the plan JWT. Consequently:
 * - OpenAI clients are translated OpenAI→Anthropic on the way up and
 *   Anthropic→OpenAI on the way down ("translation" mode).
 * - Anthropic clients speak the upstream's native format — requests are
 *   forwarded with body transforms only ("passthrough" mode,
 *   `decompress: false`).
 *
 */
import type { Format } from "../translator/types.js";
import type { ProxyConfig } from "../config/types.js";
import type { AuthManager } from "../auth/manager.js";
import type { AccountHandle } from "../auth/account-rotator.js";
import { getProvider } from "../provider/providers.js";
import { buildUpstreamHeaderPairs, buildUpstreamRequest, type UpstreamHeaderPair } from "./upstream.js";
import { getDefaultEndpointRouting, type EndpointRoutingService } from "./endpoint-routing.js";
import { getDefaultClientSigning, sendWithClientSigning, type ClientSigningManager } from "./client-signing.js";
import { credentialString, type Credential } from "../auth/types.js";
import { isPostWriteError, sendOrderedUpstreamRequest } from "./ordered-transport.js";
import { transformRequestBody } from "./body-transformer.js";
import { CAPTCHA_CHALLENGE_HEADER, isCaptchaChallenged, retryOnCaptchaChallenge } from "./captcha-retry.js";
import { type ClientSessionResult } from "./client-session.js";
import { resolveSessionContext } from "./session-context.js";
import { gzipSync } from "node:zlib";
import { recoverAndMapUpstream, parseGatewayErrorEnvelope, inspectGatewayEnvelope } from "./upstream-errors.js";
export { parseGatewayErrorEnvelope } from "./upstream-errors.js";

// captcha.ts is loaded lazily inside the `startPlan` branch (only path that
// touches it). The solver itself (captcha-happy.ts) is dynamically imported
// by captcha-solver.ts, so non-start-plan processes never pay its startup
// cost. Desktop Bun keeps the same code path; the dynamic import resolves
// synchronously enough on Bun's warm cache.
type CaptchaModule = typeof import("./captcha.js");
let captchaModule: CaptchaModule | null = null;
async function loadCaptcha(): Promise<CaptchaModule> {
  if (!captchaModule) captchaModule = await import("./captcha.js");
  return captchaModule;
}
import { translateRequestOpenAIToAnthropic, translateResponseAnthropicToOpenAI } from "../translator/openai-to-anthropic.js";
import { translateRequestAnthropicToOpenAI, translateResponseOpenAIToAnthropic } from "../translator/anthropic-to-openai.js";
import { anthropicSseToOpenaiSse, openaiSseToAnthropicSse } from "../translator/sse-translator.js";
import type { OpenAIChatRequest, OpenAIChatResponse, AnthropicMessagesRequest, AnthropicMessagesResponse } from "../translator/types.js";
import { dumpPhase, dumpHeaders, dumpBody, dumpEnabled, SENSITIVE_HEADERS } from "./dump.js";
import { ensureAnthropicSseTerminal } from "./sse-terminal.js";
import { gateStreamPrelude, isGatedStream, type PreludeVerdict } from "./stream-prelude.js";
import { RETRYABLE_GATEWAY_CODES, TERMINAL_GATEWAY_CODES } from "./gateway-codes.js";
export { RETRYABLE_GATEWAY_CODES, TERMINAL_GATEWAY_CODES } from "./gateway-codes.js";
import { inflateWithCap, decodeContentStream } from "./inflate.js";
import { buildAnthropicMetadataUserId } from "./trace-headers.js";

/** Options for the proxy handler. */
export interface ProxyHandlerOptions {
  config: ProxyConfig;
  auth: AuthManager;
  /** Override the global fetch (for testing). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /**
   * When true, emit additional per-request diagnostic lines: upstream URL,
   * redacted request headers, body preview, upstream response status and
   * selected response headers. Activated by `zcode-proxy serve debug`.
   */
  debug?: boolean;
  /** Override the process-wide endpoint routing service (for testing). `null` disables. */
  endpointRouting?: EndpointRoutingService | null;
  /** Override the process-wide client signing manager (for testing). `null` disables. */
  clientSigning?: ClientSigningManager | null;
  /** Override captcha provider for isolated start-plan tests. */
  captcha?: CaptchaModule;
}

/**
 * Forward a client request to the upstream provider with injected auth.
 *
 * Upstream fetch options differ by mode:
 * - **Passthrough** (OpenAI client): `{ decompress: false }` — compressed
 *   response bodies (gzip/deflate/br) pass through untouched; raw bytes and the
 *   Content-Encoding header are forwarded as-is, letting the client decompress.
 * - **Translation** (Anthropic client): no options — Bun decompresses so the proxy
 *   can read the body and translate OpenAI→Anthropic (then re-gzip if the client
 *   accepts).
 *
 * No upstream timeout is applied — matches ZCode desktop client behaviour
 * (the bundle has no automatic timer on LLM calls, only user-initiated abort).
 * Connection-level errors (ECONNREFUSED, DNS failure) still surface as 502.
 */
export async function proxyRequest(
  clientReq: Request,
  format: Format,
  opts: ProxyHandlerOptions,
): Promise<Response> {
  const { config, auth } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const hasCustomFetchImpl = opts.fetchImpl !== undefined;
  const debug = opts.debug === true;
  const started = Date.now();
  const reqId = nextReqId();

  let body: string | undefined;
  try {
    body = await readBody(clientReq);
  } catch (err) {
    if (err instanceof InflatedBodyTooLargeError) {
      return errorResponse(413, "request_too_large", err.message);
    }
    return errorResponse(400, "invalid_request_error", (err as Error).message);
  }

  if (body) {
    try {
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return errorResponse(400, 'invalid_request_error', 'Request body must be a JSON object');
    } catch { return errorResponse(400, format === 'openai' ? 'translation_failed' : 'invalid_request_error', 'Request body is not valid JSON'); }
  }
  const meta = peekBody(body);

  if (dumpEnabled()) {
    dumpPhase(reqId, "client_in", {
      method: clientReq.method,
      url: clientReq.url,
      headers: dumpHeaders(clientReq.headers),
      body: dumpBody(body),
    });
  }

  const staticProvider = getProvider(config.provider);
  const provider = {
    ...staticProvider,
    anthropicBaseURL: config.providers[config.provider].anthropicBase,
    openaiBaseURL: config.providers[config.provider].openaiBase,
  };

  let cred: Credential;
  let accountHandle: AccountHandle | undefined;
  try {
    const select = (auth as AuthManager & { getCredentialHandle?: () => Promise<AccountHandle> }).getCredentialHandle;
    if (typeof select === "function") {
      accountHandle = await select.call(auth);
      cred = accountHandle.credential;
    } else {
      cred = await auth.getCredential();
    }
  } catch (err) {
    if (debug) debugError(reqId, "credential_unavailable", (err as Error).message);
    printRow(reqId, format, meta, 503, started, Date.now(), 0, 0, 0);
    return errorResponse(503, "credential_unavailable", (err as Error).message);
  }
  // The selected account context and the configured transport must agree
  // before constructing headers or a target URL. Never silently send a pooled
  // credential to another provider/plan.
  if (accountHandle && accountHandle.provider !== config.provider) {
    return errorResponse(409, "account_provider_mismatch", "selected account is not enabled for the configured provider");
  }
  if (accountHandle?.plan && accountHandle.plan !== config.plan) {
    return errorResponse(409, "account_plan_mismatch", "selected account is not enabled for the configured plan");
  }

  // v2.6: both plans use the Anthropic upstream. coding-plan mirrors the real
  // ZCode client (api.z.ai/api/anthropic → ultra via endpoint routing);
  // start-plan's old OpenAI gateway (/api/v1/zcode-plan/chat/completions) was
  // retired server-side (404 as of 2026-08-28) — the live desktop client now
  // posts Anthropic messages to /api/v1/zcode-plan/anthropic/v1/messages with
  // the start-plan JWT, so we do the same (no OpenAI translation either way).
  const startPlan = config.plan === "start-plan";
  const translateAnthropicToOpenAI = false;
  const translateOpenAIToAnthropic = format === "openai";
  const upstreamFormat: Format = "anthropic";
  const clientSession = resolveSessionContext({ clientReq, body, upstreamFormat, model: meta.model, config });
  if (debug && clientSession) {
    const shortSession = clientSession.sessionId ? clientSession.sessionId.slice(0, 10) : "-";
    debugLine(reqId, `clientIdentity source=${clientSession.source} action=${clientSession.action} confidence=${clientSession.confidence.toFixed(2)} session=${shortSession}`);
  }

  let upstreamBody = body;
  if (translateOpenAIToAnthropic) {
    const translated = translateOpenAIBody(body);
    if (translated instanceof Response) return translated;
    upstreamBody = translated;
    if (debug) debugLine(reqId, `translated OpenAI→Anthropic (bytes=${upstreamBody?.length ?? 0})`);
  } else if (translateAnthropicToOpenAI) {
    const translated = translateAnthropicBody(body);
    if (translated instanceof Response) return translated;
    upstreamBody = translated;
    if (debug) debugLine(reqId, `translated Anthropic→OpenAI (bytes=${upstreamBody?.length ?? 0})`);
  }

  // Bundle `E2e` fires for EVERY anthropic-kind request (both plans) — the
  // injected user_id is the device/session blob, never the account uuid.
  const metadataUserId = buildAnthropicMetadataUserId(config.identity.deviceMid, clientSession?.sessionId);
  const transformedBody = transformRequestBody(upstreamBody, { format: upstreamFormat, metadataUserId, startPlan });
  if (debug && transformedBody !== upstreamBody) {
    debugLine(reqId, `body transformed (upstreamFormat=${upstreamFormat}, startPlan=${startPlan}, bytes=${transformedBody?.length ?? 0})`);
  }

  let captchaHeaders: Record<string, string> | undefined;
  if (startPlan) {
    try {
      const captcha = opts.captcha ?? await loadCaptcha();
      const token = await captcha.getCaptchaToken(config.identity.appVersion);
      captchaHeaders = { [captcha.RETRY_HEADERS.PARAM]: token.verifyParam, [captcha.RETRY_HEADERS.REGION]: token.region };
    } catch {
      // Will solve on 403 fallback below
    }
  }

  const useOrderedTransport = shouldUseOrderedTransport(config, clientSession, hasCustomFetchImpl);
  let upstreamHeaderPairs = buildUpstreamHeaderPairs(clientReq, upstreamFormat, cred, config.identity, config.plan, captchaHeaders, clientSession);
  let upstreamReq = buildUpstreamRequest(clientReq, upstreamFormat, provider, cred, transformedBody, config.identity, config.plan, captchaHeaders, clientSession);

  const routing = opts.endpointRouting !== undefined ? opts.endpointRouting : getDefaultEndpointRouting(config);
  const signer = opts.clientSigning !== undefined ? opts.clientSigning : getDefaultClientSigning(config);
  const translateMode = translateOpenAIToAnthropic || translateAnthropicToOpenAI;
  const dispatch = async (req: Request, pairs: UpstreamHeaderPair[]): Promise<Response> => {
    let sendUrl = req.url;
    if (routing) {
      const routed = await routing.resolve(req.url, credentialString(cred));
      if (routed.routed) {
        sendUrl = routed.url;
        if (debug) debugLine(reqId, `endpoint routing: ${req.url} -> ${routed.url}`);
      }
    }
    // Signing decisions (exempt-path, handshake origin, bypass keying) run
    // against the PRE-routing provider URL — the client's signer wraps the
    // routing transport, so its checks see the original URL too.
    return sendWithClientSigning(signer, {
      url: req.url,
      headerPairs: pairs,
      credential: credentialString(cred),
      appVersion: config.identity.appVersion,
      debug: debug ? (message) => debugLine(reqId, message) : undefined,
      send: (finalPairs) => {
        const sendReq = sendUrl === req.url && finalPairs === pairs
          ? req
          : new Request(sendUrl, {
              method: req.method,
              headers: Object.fromEntries(finalPairs),
              body: transformedBody ?? undefined,
            });
        return sendUpstreamRequest(sendReq, finalPairs, transformedBody, translateMode, useOrderedTransport, fetchImpl, clientReq.signal, hasCustomFetchImpl);
      },
    });
  };

  if (debug) {
    debugLine(reqId, `→ POST ${upstreamReq.url}`);
    debugLine(reqId, `  ${formatHeaderPairs(upstreamReq.headers)}`);
    if (transformedBody) debugLine(reqId, `  body preview: ${previewBody(transformedBody)}`);
  }

  if (dumpEnabled()) {
    dumpPhase(reqId, "upstream_out", {
      method: upstreamReq.method,
      url: upstreamReq.url,
      headers: dumpHeaders(upstreamReq.headers),
      body: dumpBody(transformedBody),
      upstreamFormat,
      translateMode: translateOpenAIToAnthropic || translateAnthropicToOpenAI,
      useOrderedTransport,
      startPlan,
    });
  }

  let upstreamResp: Response;
  if (accountHandle && typeof (auth as AuthManager & { validateAccountHandle?: unknown }).validateAccountHandle === "function") {
    try {
      if (!(await auth.validateAccountHandle(accountHandle))) {
        return errorResponse(409, "account_context_changed", "account configuration changed before dispatch; retry the request");
      }
    } catch {
      return errorResponse(503, "account_state_unavailable", "account state could not be verified before dispatch");
    }
  }
  try {
    // Pre-output ladder: connect failures, drops before a response and
    // transient gateway statuses/codes are re-dispatched on the same account
    // (exact policy at dispatchWithConnectRetry). Guard rails: no retry once
    // the client aborted, none after a failure the ordered transport flagged
    // postWrite, the account is re-checked before every retry, and each
    // attempt re-dispatches a FRESH Request — a reused Request has its body
    // stream marked used after the first fetch (start-plan hits the plain
    // pass-through path where dispatch does NOT rebuild the Request). On
    // start-plan a retry after a response, a drop after the write or a failed
    // stream prelude takes a fresh pooled captcha token (the gateway may have
    // spent the first one); a never-connected attempt keeps it, and when no
    // fresh token can be minted the previous one is re-sent and the captcha
    // layer below re-solves on a challenge.
    upstreamResp = await dispatchWithConnectRetry(
      async ({ attempt, previous }) => {
        if (attempt === 1) return dispatch(upstreamReq, upstreamHeaderPairs);
        if (startPlan && previous?.kind !== "connect") {
          try {
            const captchaModule = opts.captcha ?? await loadCaptcha();
            const token = await captchaModule.getCaptchaToken(config.identity.appVersion);
            captchaHeaders = { [captchaModule.RETRY_HEADERS.PARAM]: token.verifyParam, [captchaModule.RETRY_HEADERS.REGION]: token.region };
            upstreamHeaderPairs = buildUpstreamHeaderPairs(clientReq, upstreamFormat, cred, config.identity, config.plan, captchaHeaders, clientSession);
          } catch {
            // keep the previous token
          }
        }
        return dispatch(buildUpstreamRequest(clientReq, upstreamFormat, provider, cred, transformedBody, config.identity, config.plan, captchaHeaders, clientSession), upstreamHeaderPairs);
      },
      {
        isAborted: () => clientReq.signal.aborted,
        signal: clientReq.signal,
        beforeRetry: () => accountHandleStillCurrent(auth, accountHandle),
        // Translation mode reads a body the transport already inflated.
        streamPrelude: (resp) => gateStreamPrelude(resp, { decoded: translateMode, signal: clientReq.signal }),
        onRetry: (attempt, reason, delayMs) => {
          if (debug) debugError(reqId, "upstream_transient_retry", `attempt ${attempt}/${MAX_TRANSIENT_ATTEMPTS} failed (${reason}), retrying in ${delayMs}ms`);
          console.log(`${reqId} upstream transient failure (${reason}), retry ${attempt + 1}/${MAX_TRANSIENT_ATTEMPTS} in ${delayMs}ms`);
        },
      },
    );
  } catch (err) {
    if (debug) debugError(reqId, "upstream_unreachable", (err as Error).message);
    printRow(reqId, format, meta, 502, started, Date.now(), 0, 0, 0);
    return errorResponse(502, "upstream_unreachable", "Upstream request could not be completed.");
  }
  const headersAt = Date.now();

  if (debug) {
    debugLine(reqId, `← ${upstreamResp.status} ${upstreamResp.statusText}`);
    debugLine(reqId, `  ${formatResponseHeaders(upstreamResp.headers)}`);
  }

  if (dumpEnabled()) {
    dumpPhase(reqId, "upstream_in", {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: dumpHeaders(upstreamResp.headers),
      isSSE: upstreamResp.headers.get("content-type")?.includes("text/event-stream") ?? false,
      ttfbMs: headersAt - started,
    });
  }

  // start-plan: on explicit captcha challenge, retry once with a fresh
  // pooled token (the challenged token was already consumed by this request;
  // getCaptchaToken takes the next pre-solved one). Detection covers the
  // response-header variant AND the in-body `{"code":3007}` variant (observed
  // 2026-08-29 as HTTP 400 JSON with no captcha header) via the shared
  // captcha-retry seam (used by /v1/responses too).
  const captcha = startPlan ? opts.captcha ?? await loadCaptcha() : null;
  const captchaChallenge = captcha ? await isCaptchaChallenged(upstreamResp, captcha) : false;
  if (captchaChallenge && captcha) {
    console.log(`${reqId} captcha challenge, re-solving...`);
    const outcome = await retryOnCaptchaChallenge({
      captcha,
      appVersion: config.identity.appVersion,
      challengedResp: upstreamResp,
      signal: clientReq.signal,
      debug: debug ? (message) => debugLine(reqId, message) : undefined,
      solveAndRetry: (retryHeaders) => {
        console.log(`${reqId} captcha re-solved (token ${retryHeaders[captcha.RETRY_HEADERS.PARAM].length} chars), retrying...`);
        upstreamHeaderPairs = buildUpstreamHeaderPairs(clientReq, upstreamFormat, cred, config.identity, config.plan, retryHeaders, clientSession);
        upstreamReq = buildUpstreamRequest(clientReq, upstreamFormat, provider, cred, transformedBody, config.identity, config.plan, retryHeaders, clientSession);
        return dispatch(upstreamReq, upstreamHeaderPairs).then((resp) => {
          if (debug) debugLine(reqId, `← retry ${resp.status} ${resp.statusText}`);
          return resp;
        });
      },
      mapError: (err, phase) => {
        if (phase === "solver") {
          if (debug) debugError(reqId, "captcha_solver_failed", err.message);
          printRow(reqId, format, meta, 503, started, Date.now(), 0, 0, 0);
          return errorResponse(503, "captcha_solver_failed", err.message);
        }
        if (debug) debugError(reqId, "upstream_unreachable", err.message);
        printRow(reqId, format, meta, 502, started, Date.now(), 0, 0, 0);
        return errorResponse(502, "upstream_unreachable", "Upstream request could not be completed.");
      },
    });
    if (!outcome.ok) return outcome.resp;
    upstreamResp = outcome.resp;
  }

  try {
    upstreamResp = await recoverAndMapUpstream({
      response: upstreamResp, auth, credential: cred, handle: accountHandle, plan: config.plan, signal: clientReq.signal,
      attemptedIdentities: new Set(accountHandle ? [accountHandle.effectiveIdentity] : []),
      resend: async (fresh) => {
        cred = fresh;
        if (startPlan) {
          const provider = opts.captcha ?? await loadCaptcha();
          const token = await provider.getCaptchaToken(config.identity.appVersion);
          captchaHeaders = { [provider.RETRY_HEADERS.PARAM]: token.verifyParam, [provider.RETRY_HEADERS.REGION]: token.region };
        }
        upstreamHeaderPairs = buildUpstreamHeaderPairs(clientReq, upstreamFormat, cred, config.identity, config.plan, captchaHeaders, clientSession);
        upstreamReq = buildUpstreamRequest(clientReq, upstreamFormat, provider, cred, transformedBody, config.identity, config.plan, captchaHeaders, clientSession);
        return dispatch(upstreamReq, upstreamHeaderPairs);
      },
      resendHandle: async (freshHandle) => {
        accountHandle = freshHandle;
        cred = freshHandle.credential;
        if (freshHandle.provider !== config.provider || (freshHandle.plan && freshHandle.plan !== config.plan)) {
          throw new Error("selected account context does not match configured provider/plan");
        }
        if (startPlan) {
          const provider = opts.captcha ?? await loadCaptcha();
          const token = await provider.getCaptchaToken(config.identity.appVersion);
          captchaHeaders = { [provider.RETRY_HEADERS.PARAM]: token.verifyParam, [provider.RETRY_HEADERS.REGION]: token.region };
        }
        upstreamHeaderPairs = buildUpstreamHeaderPairs(clientReq, upstreamFormat, cred, config.identity, config.plan, captchaHeaders, clientSession);
        upstreamReq = buildUpstreamRequest(clientReq, upstreamFormat, provider, cred, transformedBody, config.identity, config.plan, captchaHeaders, clientSession);
        return dispatch(upstreamReq, upstreamHeaderPairs);
      },
    });
  } catch {
    return errorResponse(502, "upstream_unreachable", "Upstream request could not be completed.");
  }
  if (!upstreamResp.ok) {
    printRow(reqId, format, meta, upstreamResp.status, started, headersAt, 0, 0, 0);
    return upstreamResp;
  }
  const isSSE = upstreamResp.headers.get("content-type")?.includes("text/event-stream") ?? false;

  if (translateOpenAIToAnthropic) {
    if (isSSE && upstreamResp.body) {
      const translated = anthropicSseToOpenaiSse(upstreamResp.body, meta.model);
      const [clientBody, statsBody] = translated.tee();
      observeStream(reqId, format, meta, upstreamResp.status, started, statsBody, null);
      return translatedSseResponse(clientBody);
    }
    return await translatedBatchResponse(clientReq, upstreamResp, meta.model, reqId, format, meta, started, headersAt);
  }

  if (translateAnthropicToOpenAI) {
    if (isSSE && upstreamResp.body) {
      const translated = openaiSseToAnthropicSse(upstreamResp.body, meta.model);
      const [clientBody, statsBody] = translated.tee();
      observeStream(reqId, format, meta, upstreamResp.status, started, statsBody, null);
      return translatedSseResponse(clientBody);
    }
    return await translatedOpenAIToAnthropicBatchResponse(clientReq, upstreamResp, reqId, format, meta, started, headersAt);
  }

  if (isSSE && upstreamResp.body) {
    const [clientBody, statsBody] = upstreamResp.body.tee();
    observeStream(reqId, format, meta, upstreamResp.status, started, statsBody, upstreamResp.headers.get("content-encoding"));
    // Native Anthropic streams get a terminal `event: error` when the upstream
    // ends without message_stop or the read fails (only where the bytes are
    // readable: an uncompressed stream, or one this proxy decompresses).
    return passthroughResponse(upstreamResp, clientAcceptsGzip(clientReq), clientBody, ensureAnthropicSseTerminal);
  }

  if (upstreamResp.status === 200) {
    // The gateway answers some failures with HTTP 200 + a JSON error envelope
    // (e.g. {"code":1005,"msg":"exceed quota limit"}) instead of an error
    // status. Anthropic clients would see a valid-but-empty response and
    // retry blindly — surface a real error status instead.
    const sniffed = await decodeBodyText(upstreamResp);
    if (sniffed === null || !sniffed.trim()) {
      return errorResponse(502, "upstream_invalid_response", "Upstream returned an empty or undecodable response.");
    }
    const envelope = parseGatewayErrorEnvelope(sniffed);
    if (envelope) {
      printRow(reqId, format, meta, envelope.status, started, headersAt, 0, 0, 0);
      return errorResponse(envelope.status, envelope.type, envelope.message);
    }
    const plainHeaders = new Headers(upstreamResp.headers);
    plainHeaders.delete("content-encoding");
    plainHeaders.delete("content-length");
    const reconstructed = new Response(sniffed, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: plainHeaders,
    });
    printRow(reqId, format, meta, upstreamResp.status, started, headersAt, 0, 0, 0);
    return passthroughResponse(reconstructed, clientAcceptsGzip(clientReq));
  }

  printRow(reqId, format, meta, upstreamResp.status, started, headersAt, 0, 0, 0);
  return passthroughResponse(upstreamResp, clientAcceptsGzip(clientReq));
}

/**
 * Fully decode a response body to text, undoing gzip/deflate/br when the
 * runtime has not already done so. Tries the raw bytes first and only runs
 * explicit decompression when the result does not look like JSON, so both
 * auto-decompressing and transparent runtimes are handled. Returns null when
 * nothing decodable can be produced.
 */
async function decodeBodyText(resp: Response): Promise<string | null> {
  const encoding = (resp.headers.get("content-encoding") ?? "").toLowerCase();
  try {
    const buf = await resp.arrayBuffer();
    const raw = new TextDecoder().decode(buf);
    if (raw.trimStart().startsWith("{") || !encoding) return raw;
    return await new Response(decodeContentStream(new Response(buf).body!, encoding)).text();
  } catch {
    return null;
  }
}

/**
 * Detect the gateway's HTTP-200 error envelope. Returns the mapped error
 * response fields, or null when the body is a legitimate message response.
 *
 * Statuses are chosen to match Anthropic client retry semantics:
 * quota/balance exhaustion (1005/1113) and captcha/capability rejections
 * (3006/3007/3012) are deterministic for the current account/window, so they
 * map to non-retryable 400/403 — mirroring Anthropic's own "credit balance
 * too low" 400 — instead of a retryable 429 that only provokes more
 * gateway anti-abuse (captcha) challenges.
 */

export function shouldUseOrderedTransport(config: ProxyConfig, clientSession: ClientSessionResult | undefined, hasCustomFetchImpl: boolean): boolean {
  if (hasCustomFetchImpl) return false;
  return clientSession?.action === "enforce" || clientSession?.source === "explicit";
}

/** Max attempts (initial + 3 retries) of the pre-output transient ladder. */
export const MAX_TRANSIENT_ATTEMPTS = 4;
const DEFAULT_TRANSIENT_RETRY_UNIT_MS = 500;
const MAX_TRANSIENT_RETRY_UNIT_MS = 10_000;
let transientRetryEnvWarned = false;

/**
 * Operator knob for the transient ladder, mirroring ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS:
 * ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS is the base unit of the backoff in
 * decimal milliseconds (default 500, capped at 10000; 0 retries without
 * waiting); "off" restores the connect-only ladder (never-connected failures
 * only, no status or drop retries). Invalid values fall back to the default
 * with a one-time warning. Exported for tests.
 */
export function transientRetryPolicy(override?: number): { unitMs: number; extended: boolean } {
  if (override !== undefined) return { unitMs: override, extended: true };
  const raw = process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS;
  if (raw === undefined) return { unitMs: DEFAULT_TRANSIENT_RETRY_UNIT_MS, extended: true };
  const trimmed = raw.trim();
  if (trimmed.toLowerCase() === "off") return { unitMs: DEFAULT_TRANSIENT_RETRY_UNIT_MS, extended: false };
  if (!/^[0-9]+$/.test(trimmed)) {
    if (!transientRetryEnvWarned) {
      transientRetryEnvWarned = true;
      console.error(`[transient-retry] ignoring invalid ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS=${JSON.stringify(raw)} — using the default`);
    }
    return { unitMs: DEFAULT_TRANSIENT_RETRY_UNIT_MS, extended: true };
  }
  return { unitMs: Math.min(Number(trimmed), MAX_TRANSIENT_RETRY_UNIT_MS), extended: true };
}
/** A numeric Retry-After above this is surfaced to the client instead of waited out. */
export const TRANSIENT_RETRY_AFTER_CAP_MS = 15_000;

/** Failures that prove the connection was never established. */
const CONNECT_ERROR_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "ConnectionRefused"]);
/**
 * Connection dropped before any response bytes arrived. The official ZCode
 * client retries this class (network failure) with backoff; the request may
 * have reached the gateway, which is the same exposure that client accepts.
 */
const DROP_ERROR_CODES = new Set([
  "ECONNRESET", "EPIPE", "ETIMEDOUT", "ECONNABORTED", "EHOSTUNREACH", "ENETUNREACH",
  "UND_ERR_SOCKET", "UND_ERR_HEADERS_TIMEOUT", "ConnectionClosed",
]);
const DROP_ERROR_MESSAGES = [/socket hang up/i, /other side closed/i, /connection closed/i, /connection reset/i, /closed before sending response headers/i];
/** TLS/certificate failures are configuration problems, never transient. */
const NON_TRANSIENT_CODE = /^(ERR_TLS_|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED)/;
/** Gateway/edge statuses the official client retries as server errors. */
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504, 524, 529]);
// Gateway business codes (retryable vs terminal) live in gateway-codes.ts,
// shared with the stream prelude gate.

type TransientKind = "connect" | "drop" | "status";

function errorChain(err: unknown): Array<{ code?: unknown; name?: unknown; message?: unknown; cause?: unknown }> {
  const chain: Array<{ code?: unknown; name?: unknown; message?: unknown; cause?: unknown }> = [];
  let cause: unknown = err;
  for (let depth = 0; depth < 5 && cause !== null && typeof cause === "object"; depth += 1) {
    const detail = cause as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    chain.push(detail);
    cause = detail.cause;
  }
  return chain;
}

/**
 * Classify a thrown dispatch error; null = not retried (unknown, abort, TLS).
 * A failure flagged `postWrite` (the ordered transport wrote the full request
 * before it failed) is a drop like a reset on the fetch path: no response
 * reached the client, and the official client re-sends exactly this class —
 * so it is never a "connect" kind (the connect-only policy leaves it alone).
 */
export function transientErrorKind(err: unknown): { kind: TransientKind; reason: string } | null {
  const chain = errorChain(err);
  if (chain.some((e) => e.name === "AbortError" || e.code === "ABORT_ERR")) return null;
  // A TLS/certificate code anywhere in the chain wins over a socket code that wraps it.
  if (chain.some((e) => typeof e.code === "string" && NON_TRANSIENT_CODE.test(e.code))) return null;
  const postWrite = isPostWriteError(err);
  for (const e of chain) {
    if (typeof e.code !== "string") continue;
    if (CONNECT_ERROR_CODES.has(e.code)) return { kind: postWrite ? "drop" : "connect", reason: e.code };
    if (DROP_ERROR_CODES.has(e.code)) return { kind: "drop", reason: e.code };
  }
  const text = chain.map((e) => (typeof e.message === "string" ? e.message : "")).join(" | ");
  if (DROP_ERROR_MESSAGES.some((re) => re.test(text))) return { kind: "drop", reason: "connection dropped" };
  return null;
}

/** Retry-After as milliseconds: delta-seconds or an HTTP-date (never negative); null when absent or unparseable. */
export function retryAfterMs(resp: Response, now: number = Date.now()): number | null {
  const raw = resp.headers.get("retry-after")?.trim();
  if (!raw) return null;
  if (/^\d{1,6}$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Classify an upstream response; null = returned to the recovery layers as
 * is. Streams are never inspected, a captcha challenge belongs to the captcha
 * layer whatever its status, and a gateway envelope decides by its code: a
 * terminal verdict is never retried, a code the official client retries is
 * retried with any HTTP status (the gateway also wraps errors in HTTP 200),
 * any other code follows the HTTP status like a body-less response.
 */
export async function transientResponseReason(resp: Response): Promise<string | null> {
  const statusTransient = resp.status === 429 || TRANSIENT_STATUSES.has(resp.status);
  if (!statusTransient && resp.status !== 200) return null;
  if ((resp.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream")) return null;
  if (resp.headers.get(CAPTCHA_CHALLENGE_HEADER)) return null;
  const envelope = await inspectGatewayEnvelope(resp);
  if (envelope) {
    const code = envelope.code ?? -1;
    if (TERMINAL_GATEWAY_CODES.has(code)) return null;
    if (RETRYABLE_GATEWAY_CODES.has(code)) return `gateway code ${code}`;
  }
  return statusTransient ? `HTTP ${resp.status}` : null;
}

/** Admission re-check for the ladder: false when the pooled account is no longer current or cannot be verified. */
export async function accountHandleStillCurrent(auth: AuthManager, handle: AccountHandle | undefined): Promise<boolean> {
  if (!handle) return true;
  const validator = (auth as AuthManager & { validateAccountHandle?: (h: AccountHandle) => Promise<boolean> }).validateAccountHandle;
  if (typeof validator !== "function") return true;
  try {
    return (await validator.call(auth, handle)) === true;
  } catch {
    return false;
  }
}

function transientDelayMs(kind: TransientKind, attempt: number, unitMs: number): number {
  if (kind === "connect") return unitMs * attempt; // never connected: cheap, quick
  // Dropped connections and gateway errors: 2x growth with up to 25% jitter,
  // the shape the official client uses (base 2s, factor 2) at a proxy scale.
  const base = unitMs * 2 * 2 ** (attempt - 1);
  return Math.round(base * (1 + Math.random() * 0.25));
}

async function abortableWait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const done = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Pre-output transient retry ladder shared by the chat hot path and
 * /v1/responses. It runs strictly before any response byte reaches the
 * client and re-dispatches the identical request on the SAME account:
 *   - thrown connect failures (never connected) and connection drops before
 *     a response (reset, pipe, timeout) that are not flagged `postWrite`;
 *   - HTTP 500/502/503/504/524/529 and 429 whose body is not a terminal
 *     gateway verdict, and the gateway codes the official client retries
 *     (RETRYABLE_GATEWAY_CODES) with any status; a Retry-After (seconds or
 *     HTTP-date) is honoured up to TRANSIENT_RETRY_AFTER_CAP_MS, above it
 *     the response is surfaced.
 *   - a 200 event stream whose prelude fails — an `event: error` of a
 *     transient kind, or an end/read failure before the first content event
 *     (see stream-prelude.ts) — when `opts.streamPrelude` is given; the
 *     official client retries exactly this window.
 * Never retried: terminal gateway verdicts (quota, balance, auth, model,
 * captcha — their own layers handle them), captcha challenges, request
 * validation errors, TLS/certificate failures, anything after the client
 * aborted, and anything after a content event reached the stream.
 *
 * Contract for transient extensions:
 *   - `attemptDispatch` must dispatch a FRESH request each call — a reused
 *     Request has its body stream marked used after the first fetch; it
 *     receives the attempt number and why the previous attempt is retried.
 *   - failures flagged `postWrite` (ordered transport already wrote the full
 *     request) are drops: re-sent on the SAME account like a reset on the
 *     fetch path, never replayed on another account (the failover layer
 *     keeps refusing them).
 *   - no retry once the client aborted (`opts.isAborted` / `opts.signal`).
 *   - `opts.beforeRetry` is consulted after every wait: false ends the ladder
 *     with the last outcome (response returned intact, error rethrown).
 *   - the ladder never touches the sticky account, the quota-retry memo or
 *     the captcha layer: those run on the response it returns.
 */
export interface DispatchAttempt {
  /** 1-based attempt number. */
  attempt: number;
  /** Why the previous attempt is being retried (absent on the first attempt). */
  previous?: { kind: TransientKind | "stream"; reason: string };
}

export async function dispatchWithConnectRetry(
  attemptDispatch: (context: DispatchAttempt) => Promise<Response>,
  opts: {
    isAborted?: () => boolean;
    signal?: AbortSignal;
    /** Re-check before every retry (account still current); false ends the ladder with the last outcome. */
    beforeRetry?: () => boolean | Promise<boolean>;
    /** Prelude gate for 200 event streams (stream-prelude.ts); absent = streams are handed on unread. */
    streamPrelude?: (resp: Response) => Promise<PreludeVerdict>;
    onRetry?: (attempt: number, reason: string, delayMs: number) => void;
    /** Test seam: base unit of the backoff (default 500 ms; 0 disables waiting). */
    retryDelayMs?: number;
  } = {},
): Promise<Response> {
  const { unitMs, extended } = transientRetryPolicy(opts.retryDelayMs);
  const aborted = (): boolean => opts.isAborted?.() === true || opts.signal?.aborted === true;
  const admitted = async (): Promise<boolean> => (opts.beforeRetry ? (await opts.beforeRetry()) === true : true);
  let previous: DispatchAttempt["previous"];
  for (let attempt = 1; ; attempt++) {
    if (aborted()) throw new Error("client aborted before upstream connect");
    let resp: Response;
    try {
      resp = await attemptDispatch({ attempt, ...(previous ? { previous } : {}) });
    } catch (err) {
      const transient = transientErrorKind(err);
      if (!transient || (!extended && transient.kind !== "connect") || attempt >= MAX_TRANSIENT_ATTEMPTS || aborted()) throw err;
      const delayMs = transientDelayMs(transient.kind, attempt, unitMs);
      opts.onRetry?.(attempt, transient.reason, delayMs);
      await abortableWait(delayMs, opts.signal);
      if (aborted() || !(await admitted())) throw err;
      previous = { kind: transient.kind, reason: transient.reason };
      continue;
    }
    if (!extended || attempt >= MAX_TRANSIENT_ATTEMPTS || aborted()) return resp;
    let reason = await transientResponseReason(resp);
    let kind: TransientKind | "stream" = "status";
    let retryAfter: number | null = null;
    if (reason !== null) {
      retryAfter = retryAfterMs(resp);
      if (retryAfter !== null && retryAfter > TRANSIENT_RETRY_AFTER_CAP_MS) return resp;
    } else {
      // A 200 stream may still fail before any output: read its prelude and
      // treat an early transient error or end like a failed request. The
      // verdict's response carries the held prelude and the untouched rest.
      if (!opts.streamPrelude || !isGatedStream(resp)) return resp;
      const verdict = await opts.streamPrelude(resp);
      resp = verdict.response;
      // The client may have left while the prelude was read: nothing further
      // (captcha, recovery, health bookkeeping) is done for it.
      if (aborted()) {
        void resp.body?.cancel().catch(() => {});
        throw new Error("client aborted during the stream prelude");
      }
      if (!verdict.retryable) return resp;
      reason = `stream ${verdict.kind}: ${verdict.reason}`;
      kind = "stream";
    }
    // Unit 0 means "retry without waiting" (tests, operators): it also skips a
    // short Retry-After; the cap above still surfaces a long one.
    const delayMs = unitMs === 0 ? 0 : retryAfter !== null ? retryAfter : transientDelayMs("status", attempt, unitMs);
    opts.onRetry?.(attempt, reason, delayMs);
    await abortableWait(delayMs, opts.signal);
    // The response is released only once the retry is certain, so a refused
    // retry hands the client an intact body.
    if (aborted()) {
      void resp.body?.cancel().catch(() => {});
      throw new Error("client aborted before upstream retry");
    }
    if (!(await admitted())) return resp;
    void resp.body?.cancel().catch(() => {});
    previous = { kind, reason };
  }
}

/**
 * True on runtimes whose fetch ignores Bun's `decompress: false` extension and
 * transparently inflates compressed response bodies while KEEPING the
 * `content-encoding`/`content-length` headers (verified empirically against
 * Node 22/26 undici and Bun 1.3: gzip, deflate and br are all decoded, headers
 * unchanged). Bun honors `decompress: false` (raw bytes + truthful header), so
 * no normalization is needed there.
 */
const FETCH_AUTO_DECOMPRESSES = typeof Bun === "undefined";

/** Content codings a `FETCH_AUTO_DECOMPRESSES` runtime inflates transparently. */
const AUTO_DECODED_ENCODINGS = new Set(["gzip", "x-gzip", "deflate", "br"]);

/**
 * Strip `content-encoding`/`content-length` from a Response whose body the
 * runtime fetch has ALREADY inflated. Without this, passthrough on Node would
 * forward a decoded body still labeled `content-encoding: gzip` — clients that
 * advertise gzip then fail to decompress it, and the `passthroughResponse`
 * safety net would double-decompress an already-inflated stream for clients
 * that don't. No-op for encodings the runtime leaves untouched. Returns a new
 * Response because a fetch Response's headers can be immutable.
 */
export function stripAutoDecodedEncoding(resp: Response): Response {
  const encoding = resp.headers.get("content-encoding")?.toLowerCase().trim() ?? "";
  if (!encoding) return resp;
  const codings = encoding.split(",").map((c) => c.trim());
  if (!codings.every((c) => AUTO_DECODED_ENCODINGS.has(c))) return resp;
  const headers = new Headers(resp.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

async function sendUpstreamRequest(
  upstreamReq: Request,
  headerPairs: UpstreamHeaderPair[],
  body: string | undefined,
  translateMode: boolean,
  useOrderedTransport: boolean,
  fetchImpl: typeof fetch,
  abortSignal?: AbortSignal,
  hasCustomFetchImpl = false,
): Promise<Response> {
  if (useOrderedTransport) {
    return sendOrderedUpstreamRequest({
      url: upstreamReq.url,
      method: upstreamReq.method,
      headers: headerPairs,
      body,
      decompress: translateMode,
      signal: abortSignal,
    });
  }
  const fetchOpts: RequestInit & { decompress?: boolean } = translateMode ? {} : { decompress: false };
  if (abortSignal) fetchOpts.signal = abortSignal;
  const resp = await fetchImpl(upstreamReq, fetchOpts);
  // Passthrough on a runtime whose fetch auto-decompresses (Node/undici in the
  // Android bundle): the body arrives inflated while its headers still claim
  // compression. Drop the stale labels so the body/header pairing downstream
  // stays truthful. Skipped for injected fetch impls (tests) — their bodies are
  // genuinely compressed and their decompression semantics are their own.
  if (!translateMode && FETCH_AUTO_DECOMPRESSES && !hasCustomFetchImpl) {
    return stripAutoDecodedEncoding(resp);
  }
  return resp;
}

/**
 * Read the request body as a string, returning undefined for empty bodies.
 * Transparently inflates `content-encoding: gzip` request bodies (the OpenAI /
 * Anthropic upstreams accept gzipped request bodies; without this, clients
 * that send them got a misleading "body is not valid JSON" 400). Corrupt gzip
 * throws a descriptive Error; inflation past `MAX_INFLATED_BODY_BYTES` throws
 * `InflatedBodyTooLargeError` (streamed + aborted early, so a small wire
 * payload cannot expand into unbounded proxy memory).
 */
export async function readBody(req: Request): Promise<string | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const maxWireBytes = 32 * 1024 * 1024;
  if (Number(req.headers.get('content-length')) > maxWireBytes) {
    void req.body?.cancel().catch(() => {});
    throw new InflatedBodyTooLargeError(maxWireBytes);
  }
  if (!req.body) return undefined;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxWireBytes) {
        void reader.cancel().catch(() => {});
        throw new InflatedBodyTooLargeError(maxWireBytes);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (size === 0) return undefined;
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  const encoding = req.headers.get("content-encoding")?.toLowerCase().trim() ?? "";
  if (encoding === "gzip" || encoding === "x-gzip") {
    return new TextDecoder().decode(await inflateGzipBody(bytes));
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Decompressed-size ceiling, separate from the 32 MiB wire-body limit.
 */
const MAX_INFLATED_BODY_BYTES = 64 * 1024 * 1024;

/** Thrown when a gzip request body expands past MAX_INFLATED_BODY_BYTES. */
export class InflatedBodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`request body exceeds ${limit} bytes`);
    this.name = "InflatedBodyTooLargeError";
  }
}

async function inflateGzipBody(bytes: Uint8Array): Promise<Uint8Array> {
  const result = await inflateWithCap(bytes, MAX_INFLATED_BODY_BYTES);
  if (!result.ok) {
    if (result.reason === "too_large") throw new InflatedBodyTooLargeError(MAX_INFLATED_BODY_BYTES);
    throw new Error(`request body is marked content-encoding: gzip but failed to decompress: ${result.detail}`);
  }
  return result.bytes;
}

/**
 * Create a passthrough response that streams the upstream body to the client.
 * Preserves status and the allowlisted headers, and honors the client's
 * `Accept-Encoding` for gzip.
 *
 * The upstream request FORWARDS the client's `accept-encoding` (only
 * defaulting to "gzip" when the client sent none — see
 * `buildUpstreamHeaderPairs`), so the upstream compresses only when the
 * client can decode it. If THIS client did not advertise gzip but the body
 * arrived gzip-compressed anyway, we decompress before forwarding and drop
 * the now-mismatched `content-encoding`/`content-length` headers — otherwise
 * clients whose HTTP stack does not auto-decompress (e.g. some Tauri-based
 * clients) receive raw gzip bytes and fail to parse the JSON body with
 * "non-JSON body" errors despite a 200 status.
 */
function passthroughResponse(
  upstream: Response,
  clientAcceptsGzip: boolean,
  body?: ReadableStream<Uint8Array>,
  /** Applied to the body bytes the client will read (after any decompression here). */
  monitor?: (body: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>,
): Response {
  const headers = new Headers();
  const forwardHeaders = [
    "content-type",
    "content-encoding",
    "cache-control",
    "x-request-id",
    "anthropic-ratelimit-requests-limit",
    "anthropic-ratelimit-requests-remaining",
    "anthropic-ratelimit-requests-reset",
    "anthropic-ratelimit-tokens-limit",
    "anthropic-ratelimit-tokens-remaining",
    "anthropic-ratelimit-tokens-reset",
  ];

  for (const h of forwardHeaders) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  const upstreamEncoding = headers.get("content-encoding")?.toLowerCase() ?? "";
  const codings = upstreamEncoding.split(",").map((c) => c.trim()).filter((c) => c && c !== "identity");
  const source = body ?? upstream.body;
  // Decode here when the client cannot take gzip, or when a monitor must see
  // plain bytes (the terminal-frame guarantee for native streams): the client
  // then gets an identity-encoded body without the now-mismatched headers.
  const decodeForClient = codings.some((c) => c === "gzip" || c === "x-gzip") && !clientAcceptsGzip;
  if (source && codings.length && codings.every((c) => AUTO_DECODED_ENCODINGS.has(c)) && (decodeForClient || monitor)) {
    const decoded = decodeContentStream(source, upstreamEncoding);
    headers.delete("content-encoding");
    headers.delete("content-length");
    return new Response(monitor ? monitor(decoded) : decoded, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  // A body in a coding this proxy cannot decode is forwarded as is and cannot
  // be monitored; the monitor only ever sees plain bytes.
  const clientBody = source && monitor && !codings.length ? monitor(source) : source;
  return new Response(clientBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

/** Build a JSON error response. */
export function errorResponse(status: number, type: string, message: string): Response {
  const body = JSON.stringify({
    error: { type, message },
  });
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Translate an OpenAI request body string to Anthropic JSON. Returns error Response on failure. */
function translateOpenAIBody(body: string | undefined): Response | string | undefined {
  if (body === undefined || body.length === 0) {
    return errorResponse(400, "translation_failed", "OpenAI request body is empty; cannot translate.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return errorResponse(400, "translation_failed", `OpenAI request body is not valid JSON: ${(err as Error).message}`);
  }
  try {
    const translated = translateRequestOpenAIToAnthropic(parsed as OpenAIChatRequest);
    return JSON.stringify(translated);
  } catch (err) {
    return errorResponse(400, "translation_failed", `OpenAI→Anthropic translation failed: ${(err as Error).message}`);
  }
}

/** True when the client request explicitly accepts gzip (and has not disabled it via q=0). */
function clientAcceptsGzip(req: Request): boolean {
  const ae = req.headers.get("accept-encoding");
  if (!ae) return false;
  return /\bgzip\b(?!\s*;\s*q=0(?:\.0+)?\s*(?:,|$))/i.test(ae);
}

/** Build a translated batch (non-streaming) OpenAI response. Gzip if client accepts. */
async function translatedBatchResponse(
  clientReq: Request,
  upstream: Response,
  model: string,
  reqId: string,
  format: Format,
  meta: RequestMeta,
  started: number,
  headersAt: number,
): Promise<Response> {
  const raw = await upstream.text();
  let parsedAnthropic: AnthropicMessagesResponse;
  try {
    parsedAnthropic = JSON.parse(raw) as AnthropicMessagesResponse;
  } catch (err) {
    printRow(reqId, format, meta, 502, started, headersAt, 0, 0, 0);
    return errorResponse(502, "translation_failed", "Upstream returned an invalid JSON response.");
  }
  if (!isAnthropicMessagesResponse(parsedAnthropic)) {
    printRow(reqId, format, meta, 502, started, headersAt, 0, 0, 0);
    return errorResponse(502, "translation_failed", "Upstream returned an invalid Anthropic message.");
  }
  const openaiResp = translateResponseAnthropicToOpenAI(parsedAnthropic, model);
  const json = JSON.stringify(openaiResp);
  const payload = new TextEncoder().encode(json);

  const respHeaders = new Headers();
  respHeaders.set("content-type", "application/json");
  for (const h of forwardedUpstreamHeaders()) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }

  if (clientAcceptsGzip(clientReq)) {
    respHeaders.set("content-encoding", "gzip");
    printRow(reqId, format, meta, upstream.status, started, headersAt, openaiResp.usage?.completion_tokens ?? 0, 0, 0);
    return new Response(gzipSync(payload), {
      status: upstream.status,
      headers: respHeaders,
    });
  }
  printRow(reqId, format, meta, upstream.status, started, headersAt, openaiResp.usage?.completion_tokens ?? 0, 0, 0);
  return new Response(payload, {
    status: upstream.status,
    headers: respHeaders,
  });
}

async function translatedOpenAIToAnthropicBatchResponse(
  clientReq: Request,
  upstream: Response,
  reqId: string,
  format: Format,
  meta: RequestMeta,
  started: number,
  headersAt: number,
): Promise<Response> {
  const raw = await upstream.text();
  let parsedOpenAI: OpenAIChatResponse;
  try {
    parsedOpenAI = JSON.parse(raw) as OpenAIChatResponse;
  } catch (err) {
    printRow(reqId, format, meta, 502, started, headersAt, 0, 0, 0);
    return errorResponse(502, "translation_failed", "Upstream returned an invalid JSON response.");
  }
  const anthropicResp = translateResponseOpenAIToAnthropic(parsedOpenAI);
  const json = JSON.stringify(anthropicResp);
  const payload = new TextEncoder().encode(json);

  const respHeaders = new Headers();
  respHeaders.set("content-type", "application/json");
  for (const h of forwardedUpstreamHeaders()) {
    const v = upstream.headers.get(h);
    if (v) respHeaders.set(h, v);
  }

  if (clientAcceptsGzip(clientReq)) {
    respHeaders.set("content-encoding", "gzip");
    printRow(reqId, format, meta, upstream.status, started, headersAt, anthropicResp.usage.output_tokens, 0, 0);
    return new Response(gzipSync(payload), {
      status: upstream.status,
      headers: respHeaders,
    });
  }
  printRow(reqId, format, meta, upstream.status, started, headersAt, anthropicResp.usage.output_tokens, 0, 0);
  return new Response(payload, {
    status: upstream.status,
    headers: respHeaders,
  });
}

function translateAnthropicBody(body: string | undefined): Response | string | undefined {
  if (body === undefined || body.length === 0) {
    return errorResponse(400, "translation_failed", "Anthropic request body is empty; cannot translate.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return errorResponse(400, "translation_failed", `Anthropic request body is not valid JSON: ${(err as Error).message}`);
  }
  try {
    const translated = translateRequestAnthropicToOpenAI(parsed as AnthropicMessagesRequest);
    return JSON.stringify(translated);
  } catch (err) {
    return errorResponse(400, "translation_failed", `Anthropic→OpenAI translation failed: ${(err as Error).message}`);
  }
}

function isAnthropicMessagesResponse(value: unknown): value is AnthropicMessagesResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AnthropicMessagesResponse>;
  return candidate.type === "message" && candidate.role === "assistant" && Array.isArray(candidate.content);
}

function forwardedUpstreamHeaders(): string[] {
  return [
    "x-request-id",
    "anthropic-ratelimit-requests-limit",
    "anthropic-ratelimit-requests-remaining",
    "anthropic-ratelimit-requests-reset",
    "anthropic-ratelimit-tokens-limit",
    "anthropic-ratelimit-tokens-remaining",
    "anthropic-ratelimit-tokens-reset",
  ];
}

function translatedSseResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

interface RequestMeta {
  model: string;
  stream: boolean;
}

function peekBody(body: string | undefined): RequestMeta {
  if (!body) return { model: "-", stream: false };
  try {
    const p = JSON.parse(body) as Record<string, unknown>;
    return {
      model: typeof p.model === "string" ? p.model : "-",
      stream: p.stream === true,
    };
  } catch {
    return { model: "-", stream: false };
  }
}

let reqCounter = 0;
let headerPrinted = false;

/** Format a unix-ms timestamp as local HH:MM:SS in the host's timezone (not UTC). */
function localTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function nextReqId(): string {
  return `#${String(++reqCounter).padStart(3, "0")}`;
}

const DEBUG_BODY_PREVIEW = 200;
// Credentials, cookies and the single-use captcha verify tokens of the
// start-plan gateway are masked in debug output; the set is shared with the
// dump module so both outputs agree.

function debugLine(reqId: string, msg: string): void {
  console.log(`${reqId} debug: ${msg}`);
}

function debugError(reqId: string, kind: string, msg: string): void {
  console.log(`${reqId} debug: ERROR ${kind}: ${msg}`);
}

function redactHeaderVal(key: string, val: string): string {
  const k = key.toLowerCase();
  if (!SENSITIVE_HEADERS.has(k)) return val;
  if (k === "authorization") {
    const sp = val.indexOf(" ");
    return sp > 0 ? `${val.slice(0, sp)} <redacted>` : "<redacted>";
  }
  if (val.length <= 10) return "<redacted>";
  return `${val.slice(0, 6)}...${val.slice(-4)}`;
}

function formatHeaderPairs(headers: Headers): string {
  const pairs: string[] = [];
  for (const [k, v] of headers.entries()) {
    pairs.push(`${k}=${redactHeaderVal(k, v)}`);
  }
  return pairs.join(" ");
}

function formatResponseHeaders(headers: Headers): string {
  const interesting = [
    "content-type",
    "content-encoding",
    "content-length",
    "x-request-id",
    "anthropic-ratelimit-requests-remaining",
    "anthropic-ratelimit-tokens-remaining",
  ];
  const pairs: string[] = [];
  for (const h of interesting) {
    const v = headers.get(h);
    if (v) pairs.push(`${h}=${v}`);
  }
  return pairs.length > 0 ? pairs.join(" ") : "(no notable headers)";
}

function previewBody(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= DEBUG_BODY_PREVIEW) return flat;
  return `${flat.slice(0, DEBUG_BODY_PREVIEW)}…(${flat.length} bytes total)`;
}

const COMPACT_LOG = process.env.ZCODE_LOG_FORMAT === "compact";

function printHeader(): void {
  if (headerPrinted) return;
  headerPrinted = true;
  if (COMPACT_LOG) return;
  console.log(
    "| #    | Time       | Fmt | Model       | Mode   | Stat |    TTFB |   Tok |  tok/s |   Total |",
  );
  console.log(
    "|------|------------|-----|-------------|--------|------|---------|-------|--------|---------|",
  );
}

function printRow(
  reqId: string,
  format: Format,
  meta: RequestMeta,
  status: number,
  started: number,
  headersAt: number,
  tokens: number,
  avgTps: number,
  streamEndAt: number,
): void {
  printHeader();
  const tag = format === "anthropic" ? "ANT" : "OAI";
  const mode = meta.stream ? "stream" : "batch";

  if (COMPACT_LOG) {
    const ttfbMs = headersAt - started;
    const totalMs = streamEndAt > started ? streamEndAt - started : ttfbMs;
    const ttfbStr = fmtMs(ttfbMs);
    const tokStr = tokens > 0 ? `${tokens}tok` : "";
    const tpsStr = avgTps > 0 ? `${avgTps.toFixed(0)}t/s` : "";
    const parts = [reqId, tag, meta.model, String(status), mode];
    if (meta.stream && streamEndAt > started) {
      parts.push(`${ttfbStr}→${fmtMs(totalMs)}`);
    } else {
      parts.push(ttfbStr);
    }
    if (tokStr) parts.push(tokStr);
    if (tpsStr) parts.push(tpsStr);
    console.log(parts.join(" "));
    return;
  }

  const ts = localTime(started);
  const ttfb = `${headersAt - started}ms`;
  const total = streamEndAt > started ? `${streamEndAt - started}ms` : "-";
  const tok = tokens > 0 ? String(tokens) : "-";
  const tps = avgTps > 0 ? avgTps.toFixed(1) : "-";
  console.log(
    `| ${reqId.padEnd(4)} | ${ts.padEnd(10)} | ${tag} | ${meta.model.padEnd(11)} | ${mode.padEnd(6)} | ${String(status).padStart(4)} | ${ttfb.padStart(7)} | ${tok.padStart(5)} | ${tps.padStart(6)} | ${total.padStart(7)} |`,
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function observeStream(
  reqId: string,
  format: Format,
  meta: RequestMeta,
  status: number,
  requestSentAt: number,
  body: ReadableStream<Uint8Array>,
  contentEncoding: string | null,
): void {
  const compressed = contentEncoding !== null;
  const dumpOn = dumpEnabled();
  let tokens = 0;
  let sseBuffer = "";
  let firstChunkAt = 0;
  let totalBytes = 0;
  let firstBytesSample = "";

  function parseSse(text: string): void {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
      try {
        const j = JSON.parse(line.slice(5).trim());
        if (j.usage?.completion_tokens) { tokens = j.usage.completion_tokens; continue; }
        if (j.usage?.output_tokens) { tokens = j.usage.output_tokens; continue; }
        // OpenAI content delta: choices[0].delta.content
        const oai = j.choices?.[0]?.delta?.content;
        if (typeof oai === "string" && oai.length > 0) { tokens++; continue; }
        // Anthropic content delta: type=content_block_delta, delta.type=text_delta
        if (j.type === "content_block_delta" && j.delta?.type === "text_delta") {
          const t = j.delta?.text;
          if (typeof t === "string" && t.length > 0) tokens++;
        }
      } catch {}
    }
  }

  (async () => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (firstChunkAt === 0) firstChunkAt = Date.now();
        if (dumpOn && value) {
          totalBytes += value.byteLength;
          if (firstBytesSample.length < 4096) {
            firstBytesSample += decoder.decode(value.slice(0, 4096 - firstBytesSample.length), { stream: true });
          }
        }
        if (!compressed) {
          sseBuffer += decoder.decode(value, { stream: true });
          const idx = sseBuffer.lastIndexOf("\n");
          if (idx >= 0) {
            parseSse(sseBuffer.slice(0, idx));
            sseBuffer = sseBuffer.slice(idx + 1);
          }
        }
      }
      if (!compressed && sseBuffer) parseSse(sseBuffer);
    } catch {}
    const endAt = Date.now();
    const ttfbMs = (firstChunkAt > 0 ? firstChunkAt : endAt) - requestSentAt;
    const totalMs = endAt - requestSentAt;
    const avgTps = tokens > 0 && totalMs > 0 ? tokens / (totalMs / 1000) : 0;
    printRow(reqId, format, meta, status, requestSentAt, requestSentAt + ttfbMs, tokens, avgTps, endAt);
    if (dumpOn) {
      dumpPhase(reqId, "upstream_stream_summary", {
        status,
        contentEncoding,
        compressed,
        totalBytes,
        tokensObserved: tokens,
        ttfbMs,
        totalMs,
        firstBytesSample: firstBytesSample.length > 0 ? firstBytesSample.slice(0, 4096) : "(empty stream)",
      });
    }
  })().catch(() => {});
}
