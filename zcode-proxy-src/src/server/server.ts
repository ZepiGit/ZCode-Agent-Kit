/**
 * HTTP server bootstrap with routing and proxy API key auth.
 *
 * Replaces the original `Bun.serve` adapter with `node:http.createServer` so
 * the same code runs on Bun (dev mode, source TS) and on Node (Android bundle).
 * Bun supports `node:http` natively; Node has no `Bun.serve` equivalent.
 *
 */
import { createServer, type Server } from "node:http";
import { Readable } from "node:stream";
import { createHash, timingSafeEqual } from "node:crypto";
import webuiHtml from "./webui.txt" with { type: "text" };
import type { ProxyConfig } from "../config/types.js";
import type { AuthManager } from "../auth/manager.js";
import { handleChatCompletions, handleListModels } from "./routes-openai.js";
import { handleMessages } from "./routes-anthropic.js";
import { handleResponsesRoute } from "./routes-responses.js";
import { handleAsyncMessagesRoute, handleAsyncChatRoute, handleAsyncHealthRoute } from "./routes-async.js";
import { handleQuota } from "./routes-quota.js";
import { collectPoolQuotaSnapshot } from "./routes-quota.js";
import { loadAccountStore } from "../auth/account-store.js";
import { errorResponse } from "../proxy/handler.js";
import { healthDetails } from "../runtime/health-monitor.js";
import { STOP_REQUEST_PATH, STOP_TOKEN_HEADER } from "../runtime/stop-deadlines.mjs";
import type { ResponseStore } from "../responses/store.js";
import {
  ADMISSION_SHED_NEXT,
  admissionCost,
  admissionShedWhy,
  bindTicket,
  createAdmission,
  DEFAULT_MAX_IN_FLIGHT_BYTES,
  SHED_RETRY_AFTER_SECONDS,
  shedResponse,
  type Admission,
  type AdmissionStats,
  type EndpointShape,
} from "./admission.js";

// Transport-only handoff, not a wire header or a second shutdown sequence.
const stopResponses = new WeakSet<Response>();

export interface ServerOptions {
  config: ProxyConfig;
  auth: AuthManager;
  /** Override fetch for testing. */
  fetchImpl?: typeof fetch;
  /** When true, enable per-request debug diagnostics in the proxy handler. */
  debug?: boolean;
  /** Responses-API state store. When absent, `/v1/responses` runs stateless (`previous_response_id` returns 404). */
  responseStore?: ResponseStore;
  /** Admission control for request bodies (ADR-0004). Defaults to one built from `config.server.admission`. */
  admission?: Admission;
  /** The drain gate `startServer` shares with its handler (ADR-0008 cond 2). */
  drain?: DrainGate;
  /**
   * This spawn's stop token (ADR-0014, ticket 18): `ZCODE_KIT_STOP_TOKEN` as
   * the manager set it at spawn. A proxy hosted without a manager (the TUI,
   * standalone) passes none: the stop route then answers the unknown-route
   * `404 not_found_error` and never accepts without a token.
   */
  stopToken?: string;
  /** Runs the graceful shutdown sequence once the stop request is accepted (serve()'s wiring). */
  onStopRequest?: () => void;
}

/** Minimal server handle: what the caller needs to print URLs and shut down. */
export interface ProxyServer {
  hostname: string;
  port: number;
  /** Close the server. When `exit` is true, also call `process.exit(0)`. */
  stop(exit?: boolean): void;
  /** Promise that resolves once the server has fully stopped. */
  close(): Promise<void>;
  /** Admission counters (`inFlightBytes`, `queued`, `shedTotal`, …), for observability (ticket 39). */
  admission(): AdmissionStats;
  /**
   * Start the drain (ADR-0008 cond 2): the listener stays open, every new
   * request (and every request still waiting for admission) is shed with 503
   * + `Retry-After` in its endpoint's shape; `/health` keeps answering.
   * Requests already accepted run on. Irreversible.
   */
  beginDrain(opts: DrainOptions): void;
  draining(): boolean;
  /** Requests whose response is not finished yet. */
  inFlight(): number;
  /** Resolves once no request is in flight. */
  whenIdle(): Promise<void>;
  /** Destroy every response still in flight (the force point); returns how many were cut. */
  cutInFlight(): number;
  /** Requests shed because the proxy was draining. */
  drainShed(): number;
}

export interface DrainOptions {
  /** Why the proxy drains, in words for the shed message ("a memory respawn"). */
  cause: string;
  /** `Retry-After` of a drain shed, in seconds (read per request). */
  retryAfterSeconds: () => number;
}

/** The drain state shared by the listener and the handler. */
export interface DrainGate {
  active: boolean;
  /** Aborted when the drain begins: requests waiting for admission leave the queue. */
  readonly signal: AbortSignal;
  shed: number;
  begin(opts: DrainOptions): void;
  /** The 503 + Retry-After answer for `path` while draining. */
  shedResponse(path: string): Response;
}

/** The endpoint's error shape: Anthropic for the messages routes, OpenAI for the rest. */
function shapeOf(path: string): EndpointShape {
  return path === "/v1/messages" || path === "/async/v1/messages" ? "anthropic" : "openai";
}

export function createDrainGate(): DrainGate {
  const controller = new AbortController();
  let opts: DrainOptions | null = null;
  const gate: DrainGate = {
    active: false,
    signal: controller.signal,
    shed: 0,
    begin(next) {
      if (gate.active) return;
      opts = next;
      gate.active = true;
      controller.abort();
    },
    shedResponse(path) {
      gate.shed++;
      return shedResponse(shapeOf(path), {
        why: `It is shutting down (${opts?.cause ?? "stop"}) and only finishes the requests it had already accepted.`,
        retryAfterSeconds: opts?.retryAfterSeconds() ?? SHED_RETRY_AFTER_SECONDS,
        next: "after a respawn a fresh proxy answers on the same port; if it was stopped, start it with: zcode-kit proxy start",
      });
    },
  };
  return gate;
}

/** Create a fetch-style handler that routes the request through the proxy. */
export function createFetchHandler(opts: ServerOptions): (req: Request) => Promise<Response> {
  const { config, auth } = opts;
  const proxyOpts = { config, auth, fetchImpl: opts.fetchImpl, debug: opts.debug === true };
  const responsesOpts = {
    config,
    auth,
    fetchImpl: opts.fetchImpl,
    debug: opts.debug === true,
    ...(opts.responseStore ? { responseStore: opts.responseStore } : {}),
  };
  const asyncOpts = {
    config,
    auth,
    fetchImpl: opts.fetchImpl,
    debug: opts.debug === true,
  };
  const admission = opts.admission ?? admissionFor(config);
  const drain = opts.drain;

  /**
   * Run a body-carrying route under admission: the handler (which reads the
   * body) starts only once the request is admitted, and the request's bytes
   * are given back when the handler has produced its response, the point
   * after which it no longer holds the body for a retry. The response body
   * that follows (a stream, possibly long) is not limited.
   */
  const admitted = async (req: Request, shape: EndpointShape, run: () => Promise<Response>): Promise<Response> => {
    const cost = admissionCost(req);
    if (cost === null) return run();
    // A request still waiting for admission when the drain begins leaves the
    // queue at once and is shed, instead of being admitted and cut later.
    let waitSignal: AbortSignal = req.signal;
    let detach = (): void => {};
    if (drain) {
      const waiting = new AbortController();
      const leave = (): void => waiting.abort();
      if (req.signal.aborted || drain.signal.aborted) waiting.abort();
      req.signal.addEventListener("abort", leave, { once: true });
      drain.signal.addEventListener("abort", leave, { once: true });
      detach = () => {
        req.signal.removeEventListener("abort", leave);
        drain.signal.removeEventListener("abort", leave);
      };
      waitSignal = waiting.signal;
    }
    const result = await admission.admit(cost, waitSignal).finally(detach);
    if (!result.ok && result.reason === "aborted" && drain?.active && !req.signal.aborted) {
      return drain.shedResponse(new URL(req.url).pathname);
    }
    if (!result.ok) {
      const why = result.reason === "aborted"
        ? "The client went away while the request waited for admission."
        : admissionShedWhy(result.reason, admission.stats(), result.waitedMs);
      if (result.reason !== "aborted") {
        admission.recordShed({ reason: result.reason, endpoint: new URL(req.url).pathname, bytes: cost, waitedMs: result.waitedMs });
      }
      // Nobody reads an aborted request's answer; the shed shape keeps it uniform.
      return shedResponse(shape, { why, retryAfterSeconds: SHED_RETRY_AFTER_SECONDS, next: ADMISSION_SHED_NEXT });
    }
    const ticket = result.ticket;
    bindTicket(req, ticket);
    // A client that goes away ends the handler too (its body read or its
    // upstream fetch fails on the request's signal), so this releases then.
    try {
      return await run();
    } finally {
      ticket.release();
    }
  };

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    const hostHeader = req.headers.get("host");
    if (hostHeader && !isAllowedHostHeader(hostHeader)) {
      return errorResponse(421, "host_not_allowed", "request host is not a loopback host");
    }

    const origin = req.headers.get("origin");
    if (origin && !isAllowedBrowserOrigin(origin, config)) {
      return errorResponse(403, "origin_not_allowed", "browser origin is not allowed");
    }

    // CORS preflight. No wildcard is returned for browser origins; requests
    // without an Origin retain the historical wildcard for non-browser CLI
    // clients, while authenticated browser calls receive an explicit origin.
    if (method === "OPTIONS") {
      return corsResponse(origin, config);
    }

    // The static shell is intentionally public so it can render a login/key
    // prompt, but every data endpoint it calls remains behind the API key.
    // No account status or credential data is embedded in this HTML.
    if (method === "GET" && (path === "/webui" || path.startsWith("/webui/"))) {
      return new Response(webuiHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" },
      });
    }

    if (config.auth.proxyApiKey) {
      const authHeader = req.headers.get("authorization") ?? req.headers.get("x-api-key");
      if (!authHeader || !checkProxyKey(authHeader, config.auth.proxyApiKey)) {
        return errorResponse(401, "authentication_error", "Invalid or missing proxy API key");
      }
    }
    if (path.startsWith("/accounts/") && !config.auth.proxyApiKey) {
      return errorResponse(401, "authentication_error", "account status requires proxy API key authentication");
    }

    // The graceful stop request (ADR-0014, ticket 22): it sits after the Host,
    // Origin and bearer checks and additionally requires the per-spawn stop
    // token, both compared in constant time including length. It has no body,
    // bypasses admission (it is never queued behind the byte cap) and the
    // drain shed — a repeated request during the drain joins the running
    // sequence — and answers 202 before the drain starts.
    if (path === STOP_REQUEST_PATH && method === "POST") {
      if (!opts.stopToken) {
        // A proxy spawned without a stop token (TUI-hosted, standalone)
        // answers the same 404 not_found_error as an unknown route.
        return errorResponse(404, "not_found_error", `No route for ${method} ${path}`);
      }
      const presented = req.headers.get(STOP_TOKEN_HEADER) ?? "";
      if (!stopTokenMatches(presented, opts.stopToken)) {
        return errorResponse(403, "forbidden", "the stop token does not match");
      }
      // The transport triggers only after the 202 has finished writing. Merely
      // constructing a Response is not delivery and must not start the drain.
      const response = new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
      stopResponses.add(response);
      return response;
    }

    // Draining (ADR-0008 cond 2): shed every new request; /health keeps
    // answering for the manager's hung-proxy detection.
    if (drain?.active && path !== "/health" && path !== "/") {
      return drain.shedResponse(path);
    }

    // --- Routing ---

    if (path === "/v1/chat/completions" && method === "POST") {
      return admitted(req, "openai", () => handleChatCompletions(req, proxyOpts));
    }
    if (config.responses.enabled && path === "/v1/responses" && method === "POST") {
      return admitted(req, "openai", () => handleResponsesRoute(req, responsesOpts));
    }
    if (path === "/v1/models" && method === "GET") {
      return handleListModels(req, config);
    }

    if (path === "/quota" && method === "GET") {
      // In pool mode the selected account is authoritative. Capture the
      // credential once for this billing round and partition the short cache
      // by its stable id so account A's snapshot cannot be served for B.
      if (auth.isAccountPoolEnabled()) {
        try {
          const handle = await auth.getCredentialHandle({ operation: "quota" });
          const credential = handle.credential;
          const accountId = handle.id;
          return handleQuota(config, opts.fetchImpl, async () => credential, `pool:${accountId}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : "account credential unavailable";
          return errorResponse(503, "quota_unavailable", `quota query failed: ${message}`);
        }
      }
      return handleQuota(config, opts.fetchImpl);
    }

    if (path === "/accounts/status" && method === "GET") {
      return accountStatusResponse(config, auth);
    }

    if (path === "/accounts/quota" && method === "GET") {
      if (!auth.isAccountPoolEnabled()) {
        return errorResponse(409, "account_pool_disabled", "account pool is disabled");
      }
      try {
        const policy = config.auth.accounts;
        const profiles = (await loadAccountStore(policy?.path ? { path: policy.path } : {}))
          .filter((profile) => profile.credential.provider === config.provider
            && (!profile.plan || profile.plan === config.plan)
            && isPolicyAllowed(profile.id, profile.plan, config)
            && profile.paused !== true);
        const snapshot = await collectPoolQuotaSnapshot(config, profiles, opts.fetchImpl);
        return jsonResponse(snapshot);
      } catch (err) {
        return errorResponse(503, "quota_unavailable", `pool quota query failed: ${safeStatusError(err)}`);
      }
    }

    if (path === "/v1/messages" && method === "POST") {
      return admitted(req, "anthropic", () => handleMessages(req, proxyOpts));
    }

    if (config.async.enabled) {
      // Off-peak is a coding-plan feature: on start-plan the async routes are
      // disabled even when async.enabled=true (explicit error, not a silent 404).
      const isAsyncRoute =
        (path === "/async/v1/messages" && method === "POST") ||
        (path === "/async/v1/chat/completions" && method === "POST") ||
        (path === "/async/v1/health" && method === "GET");
      if (isAsyncRoute && config.plan !== "coding-plan") {
        return errorResponse(
          400,
          "async_plan_unsupported",
          `async (off-peak) endpoints are only available with plan "coding-plan" (current plan: ${config.plan})`,
        );
      }
      if (path === "/async/v1/messages" && method === "POST") {
        return admitted(req, "anthropic", () => handleAsyncMessagesRoute(req, asyncOpts));
      }
      if (path === "/async/v1/chat/completions" && method === "POST") {
        return admitted(req, "openai", () => handleAsyncChatRoute(req, asyncOpts));
      }
      if (path === "/async/v1/health" && method === "GET") {
        return handleAsyncHealthRoute(req, asyncOpts);
      }
    }

    if (path === "/health" || path === "/") {
      // `details` is additive and synchronous: the kit manager's hung-proxy
      // detection relies on /health answering whenever the loop runs at all.
      return new Response(JSON.stringify({ status: "ok", provider: config.provider, details: healthDetails() }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return errorResponse(404, "not_found_error", `No route for ${method} ${path}`);
  };
}

/**
 * Start the HTTP server. Resolves once the listener is bound; the returned
 * `ProxyServer.stop()` closes the underlying `node:http.Server`.
 *
 * `idleTimeout: 0` (the original Bun.serve setting for self-hosted long
 * reasoning calls) is mirrored by zeroing Node's request/keep-alive/headers
 * timeouts.
 */
export async function startServer(opts: ServerOptions): Promise<ProxyServer> {
  // ZAK-002: loopback binding and bearer auth are startup invariants for the
  // serve path, not template conventions. Defense in depth: the config loader
  // already rejects non-loopback hosts; here we re-check both right before
  // binding, so no code path can listen without a real key or on a wide host.
  const host = (opts.config.server.host ?? "").trim().toLowerCase();
  if (!["127.0.0.1", "::1", "localhost", "[::1]"].includes(host)) {
    throw new Error(
      `refusing to bind "${opts.config.server.host}" — the proxy fronts a personal, account-backed ` +
        `credential and only serves loopback (127.0.0.1 / ::1 / localhost)`,
    );
  }
  const key = (opts.config.auth.proxyApiKey ?? "").trim();
  if (!key || /^(?:GENERATE_ME|your-proxy-secret|change-?me|replace-?me)$/i.test(key)) {
    throw new Error(
      "auth.proxyApiKey is missing or still the placeholder — generate a local key before serving " +
        "(the kit's setup does this; manually: replace GENERATE_ME in proxy/config.yaml)",
    );
  }

  const admission = opts.admission ?? admissionFor(opts.config);
  const drain = createDrainGate();
  const handler = createFetchHandler({ ...opts, admission, drain });
  const requestedPort = opts.config.server.port;
  const bindHost = host === 'localhost' ? '127.0.0.1' : host === '[::1]' ? '::1' : host;

  // Responses not finished yet: what the drain waits for and the force point cuts.
  const active = new Set<import("node:http").ServerResponse>();
  let idleWaiters: Array<() => void> = [];
  const settleIdle = (): void => {
    if (active.size > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const server: Server = createServer(async (req, res) => {
    active.add(res);
    const done = (): void => {
      if (active.delete(res)) settleIdle();
    };
    res.once("finish", done);
    res.once("close", done);
    const abortController = new AbortController();
    const onClientClose = (): void => {
      if (!res.writableEnded) abortController.abort();
    };
    res.on("close", onClientClose);

    // `/async/*` routes can hold the connection open for minutes-to-hours while
    // waiting for an off-peak ticket. Lift the per-request socket timeout from
    // the default 600s (set below via server.requestTimeout) to 24h so the long
    // queue wait + LLM stream doesn't get killed mid-flight. Non-async routes
    // keep the default timeout.
    if ((req.url ?? "").startsWith("/async/")) {
      req.setTimeout(24 * 60 * 60 * 1000);
    }

    try {
      const webReq = nodeReqToWebRequest(req, abortController.signal, (n) => admission.noteBodyRead(n));
      const answer = await handler(webReq);
      if (stopResponses.has(answer)) {
        res.once("finish", () => {
          try { opts.onStopRequest?.(); } catch { /* the shutdown logs its own failure */ }
        });
      }
      const resp = addCorsHeaders(answer, webReq.headers.get("origin"), opts.config);
      await writeWebResponseToNodeResp(resp, res, abortController.signal);
    } catch (err) {
      if (abortController.signal.aborted) return;
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { type: "internal_error", message: "Request could not be completed" } }));
      } else {
        try { res.end(); } catch {}
      }
    }
  });

  // Disable all Node HTTP server timeouts to match Bun's `idleTimeout: 0`.
  // Long LLM reasoning calls (60-120s before first token) would otherwise
  // be killed by Node's defaults.
  server.requestTimeout = 600_000;
  server.keepAliveTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.maxConnections = 128;

  return new Promise<ProxyServer>((resolve, reject) => {
    server.on("error", reject);
    server.listen(requestedPort, bindHost, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
      resolve({
        hostname: bindHost,
        port: actualPort,
        stop: (exit) => {
          server.close();
          if (exit) process.exit(0);
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
        admission: () => admission.stats(),
        beginDrain: (drainOpts) => drain.begin(drainOpts),
        draining: () => drain.active,
        inFlight: () => active.size,
        whenIdle: () => new Promise<void>((resolve) => {
          idleWaiters.push(resolve);
          settleIdle();
        }),
        cutInFlight: () => {
          const cut = active.size;
          for (const res of [...active]) {
            try { res.destroy(); } catch {}
          }
          active.clear();
          settleIdle();
          return cut;
        },
        drainShed: () => drain.shed,
      });
    });
  });
}

/** Convert a Node.js IncomingMessage to a Web API Request. */
function nodeReqToWebRequest(req: import("node:http").IncomingMessage, signal?: AbortSignal, onBodyRead?: (bytes: number) => void): Request {
  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val == null) continue;
    if (Array.isArray(val)) {
      for (const v of val) headers.append(key, v);
    } else {
      headers.set(key, val);
    }
  }
  const host = headers.get("host") ?? "localhost";
  const url = `http://${host}${req.url ?? "/"}`;
  const method = req.method ?? "GET";

  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers, signal });
  }

  // Cast: Node's ReadableStream type ≠ Web ReadableStream type at the type layer, but `Readable.toWeb` returns a spec-compliant stream at runtime.
  const bodyStream = countedPullStream(Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>, onBodyRead);
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    body: bodyStream,
    duplex: "half",
    signal,
  };
  return new Request(url, init);
}

/**
 * The request body as a pull-only stream: nothing is read from the socket
 * before the handler asks for it (a request waiting for admission keeps its
 * body on the socket), and every chunk handed over is counted.
 */
function countedPullStream(source: ReadableStream<Uint8Array>, onRead?: (bytes: number) => void): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      onRead?.(value.byteLength);
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  }, { highWaterMark: 0 });
}

/** The admission control a proxy builds from its config (ADR-0004). */
function admissionFor(config: ProxyConfig): Admission {
  return createAdmission({ maxInFlightBytes: config.server.admission?.maxInFlightBytes ?? DEFAULT_MAX_IN_FLIGHT_BYTES });
}

/**
 * The largest single write to a client socket (ticket 61). A body chunk can
 * be hundreds of KB (a late read of an accumulated upstream body); written
 * whole, whatever a client that does not read leaves of it stays in the
 * proxy's write buffer. In pieces, that is at most one piece per client.
 */
const WRITE_PIECE_BYTES = 64 * 1024;

/** Resolves true once `res` can take more, false if the client went away first. */
function drained(res: import("node:http").ServerResponse): Promise<boolean> {
  if (res.destroyed) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const onDrain = (): void => { res.off("close", onClose); resolve(true); };
    const onClose = (): void => { res.off("drain", onDrain); resolve(false); };
    res.once("drain", onDrain);
    res.once("close", onClose);
  });
}

/** Write a Web API Response to a Node.js ServerResponse. */
async function writeWebResponseToNodeResp(resp: Response, res: import("node:http").ServerResponse, abortSignal?: AbortSignal): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  resp.headers.forEach((value, key) => {
    const existing = headers[key];
    if (existing === undefined) {
      headers[key] = value;
    } else if (typeof existing === "string") {
      headers[key] = [existing, value];
    } else {
      existing.push(value);
    }
  });

  res.writeHead(resp.status, resp.statusText, headers);

  if (resp.body == null) {
    res.end();
    return;
  }

  const reader = resp.body.getReader();
  const onAbort = (): void => { reader.cancel().catch(() => {}); };
  abortSignal?.addEventListener("abort", onAbort);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let at = 0; at < value.byteLength; at += WRITE_PIECE_BYTES) {
        if (res.write(Buffer.from(value.subarray(at, at + WRITE_PIECE_BYTES)))) continue;
        // A client that leaves while the proxy waits for room ends the write
        // here (the abort above cancels the body); before, this wait never
        // settled for a closed client.
        if (!(await drained(res))) return;
      }
    }
    res.end();
  } catch (err) {
    if (abortSignal?.aborted) {
      try { res.end(); } catch {}
    } else {
      try { res.destroy(err as Error); } catch {}
    }
  } finally {
    abortSignal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Check whether the client provided the correct proxy API key.
 * Constant-time comparison (audit R2-10): a plain `===` on the presented vs
 * expected key is a timing side channel on public-network deployments
 * (default bind is 0.0.0.0). Behavior is unchanged for honest callers.
 */
function checkProxyKey(authHeader: string, expected: string): boolean {
  const trimmed = authHeader.trim();
  const presented = trimmed.startsWith("Bearer ") ? trimmed.slice(7).trim() : trimmed;
  // Fixed-size digests include the complete value and its length. Never
  // branch on a secret's byte length before the constant-time comparison.
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

/**
 * The stop-token check (ADR-0014 cond 1): constant time, length included —
 * fixed-size digests prevent a secret-length-dependent early return, as for
 * checkProxyKey. The complete UTF-8 input participates in each digest.
 */
function stopTokenMatches(presented: string, expected: string): boolean {
  // Fixed-size digests include the complete value and its length. Never
  // branch on a secret's byte length before the constant-time comparison.
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

/** Build a CORS preflight response. */
function corsResponse(origin: string | null, config: ProxyConfig): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, config),
  });
}

/** Add CORS headers to an existing response (non-mutating). */
function addCorsHeaders(resp: Response, origin: string | null, config: ProxyConfig): Response {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin, config))) {
    headers.set(k, v);
  }
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

function corsHeaders(origin: string | null, config: ProxyConfig): Record<string, string> {
  return {
    "access-control-allow-origin": origin && isAllowedBrowserOrigin(origin, config) ? origin : "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta",
    "access-control-max-age": "86400",
  };
}

function isAllowedBrowserOrigin(origin: string, config: ProxyConfig): boolean {
  const configured = config.auth.accounts?.allowedOrigins;
  if (Array.isArray(configured) && configured.length > 0) return configured.includes(origin);
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return (parsed.protocol === "http:" || parsed.protocol === "https:")
      && (host === "localhost" || host === "127.0.0.1" || host === "::1");
  } catch {
    return false;
  }
}

function isAllowedHostHeader(value: string): boolean {
  try {
    const parsed = new URL(`http://${value}`);
    const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

function safeStatusError(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err
    ? String((err as { code?: unknown }).code)
    : "unavailable";
  return ["invalid", "locked", "corrupt", "conflict"].includes(code) ? code : "unavailable";
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value, null, 1), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function accountStatusResponse(config: ProxyConfig, auth: AuthManager): Promise<Response> {
  // Refresh the authoritative pool at the status read boundary. This keeps
  // the live view distinct from the offline config and prevents a stale
  // runtime snapshot from being reported as current after an admin edit.
  try {
    await auth.refreshAccountPool?.();
  } catch {
    return errorResponse(503, "account_status_unavailable", "account state could not be refreshed");
  }
  const accounts = auth.listAccounts().map((account) => ({
    id: account.id,
    provider: account.provider,
    plan: account.plan ?? null,
    state: account.provider === config.provider && (!account.plan || account.plan === config.plan)
      && isPolicyAllowed(account.id, account.plan, config) ? account.state : "blocked",
    // Never expose key prefixes/suffixes in a browser status response.
    credential: "redacted",
    lastUsedAt: account.lastUsedAt ?? null,
    lastUsedAgeMs: account.lastUsedAt ? Math.max(0, Date.now() - account.lastUsedAt) : null,
    exhaustedUntil: account.exhaustedUntil ?? null,
    dataSource: "runtime",
  }));
  const active = accounts.find((account) => account.state === "active")?.id ?? null;
  return jsonResponse({
    schemaVersion: 1,
    source: "live-runtime",
    asOf: new Date().toISOString(),
    dataAgeMs: 0,
    provider: config.provider,
    plan: config.plan,
    activeAccountId: active,
    persistence: typeof auth.getPersistenceStatus === "function" ? auth.getPersistenceStatus() : { state: "unknown" },
    accounts,
  });
}

function isPolicyAllowed(id: string, plan: string | undefined, config: ProxyConfig): boolean {
  const policy = config.auth.accounts;
  if (!policy) return true;
  if (policy.allowedIds && !policy.allowedIds.includes(id)) return false;
  if (policy.pausedIds?.includes(id)) return false;
  // A free-only policy is fail-closed: an account with no plan metadata has
  // unknown cost and cannot silently become a paid fallback.
  if (policy.allowPaid === false && (!plan || (plan !== "coding-plan" && plan !== "start-plan"))) return false;
  return true;
}
