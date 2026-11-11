/**
 * The graceful stop request `POST /__kit/stop` (seam 4, ADR-0014, ticket 22):
 * the route sits after the Host, Origin and bearer checks and additionally
 * requires the per-spawn stop-token header, both compared in constant time
 * including length; without a configured token it answers the unknown-route
 * `404 not_found_error`; it has no body, bypasses admission (ADR-0004) and the
 * drain shed, answers 202 before the drain starts, triggers the one graceful
 * sequence with the shared deadlines, and the listener stays open during the
 * drain.
 *
 * The proxy runs in this process on an ephemeral loopback port against an
 * injected upstream (no network); `exit` is a spy, so nothing ends the runner.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { createFetchHandler, startServer, type ProxyServer } from "./server.js";
import { createAdmission } from "./admission.js";
import { createGracefulShutdown } from "../runtime/supervisor.js";
import { STOP_GRACE_MS, STOP_REQUEST_PATH, STOP_TOKEN_HEADER } from "../runtime/stop-deadlines.mjs";
import type { ProxyConfig } from "../config/types.js";
import { AuthManager } from "../auth/manager.js";
import { fixtureSecret, wrongSecret } from "../test-fixtures.js";

const KEY = fixtureSecret("stop-route-proxy-key");
const TOKEN = fixtureSecret("stop-route-stop-token");
const WRONG_TOKEN = wrongSecret("stop-route-stop-token");
const EVENT_LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z (DEBUG|INFO|WARN|ERROR) shutdown /;

function makeConfig(): ProxyConfig {
  return {
    server: { port: 0, host: "127.0.0.1" },
    auth: { proxyApiKey: KEY },
    provider: "zai",
    plan: "coding-plan",
    providers: {
      zai: { anthropicBase: "https://api.z.ai/api/anthropic", openaiBase: "https://api.z.ai/api/coding/paas/v4" },
      bigmodel: { anthropicBase: "https://open.bigmodel.cn/api/anthropic", openaiBase: "https://open.bigmodel.cn/api/coding/paas/v4" },
    },
    defaultModel: "glm-4.6",
    models: ["glm-4.6"],
    identity: { appVersion: "test-1.0.0", sourceTitle: "cli", refererOrigin: "https://zcode.z.ai" },
    clientIdentity: { mode: "off", ttlSeconds: 900, maxSessions: 1024 },
    responses: { enabled: true, storeMaxEntries: 1000, storeTtlMs: 86400000 },
    endpointRouting: { enabled: false, origin: "https://zcode.z.ai" },
    clientSigning: { enabled: false, origin: "https://zcode.z.ai" },
    mcp: { enabled: false, webSearch: false, webReader: false, zread: false },
    async: { enabled: false, origin: "http://127.0.0.1:9", pollIntervalMs: 5000, keepAliveIntervalMs: 3000, maxWaitMs: 0, maxRetries: 0, settleTimeoutMs: 8000, controlTimeoutMs: 15000, defaultModel: "" },
    claim: { enabled: false, auto: false, origin: "https://zcode.z.ai", pollIntervalMs: 300000, cooldownMs: 600000, planId: "" },
    logging: { level: "info" },
  };
}

function oauthAuth(): AuthManager {
  const auth = new AuthManager();
  auth.setOAuthCredential({ apiKey: "testkey", secret: "testsecret", provider: "zai" });
  return auth;
}

const servers: ProxyServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close().catch(() => {});
});

interface StopProxyOptions {
  stopToken?: string;
  /** Shrinks admission's byte cap so a small request body saturates it. */
  admissionBytes?: number;
  /** Admission's queue timeout (default 200 ms in these tests: a queued request sheds fast). */
  queueTimeoutMs?: number;
  /**
   * Wires the route's trigger to the graceful shutdown, the way serve() does.
   * Without it the trigger is only recorded (auth and admission tests must not
   * run the sequence: it closes the listener and ends the proxy).
   */
  wireShutdown?: boolean;
  /** The upstream holds every body request until `releaseUpstream()` (an in-flight holder for admission). */
  holdUpstream?: boolean;
}

/**
 * The proxy under test, wired the way `serve()` wires it: the route's trigger
 * goes through a ref the shutdown is hung onto after the listener is up.
 */
async function stopProxy(opts: StopProxyOptions = {}) {
  const triggers: number[] = [];
  const stopRef: { run: (() => void) | null } = { run: null };
  const waiting: Array<() => void> = [];
  const respond = async (): Promise<Response> => new Response("{}", { status: 200 });
  const fetchImpl: typeof fetch = opts.holdUpstream
    ? (async () => {
      await new Promise<void>((release) => waiting.push(release));
      return respond();
    }) as unknown as typeof fetch
    : respond as unknown as typeof fetch;
  const server = await startServer({
    config: makeConfig(),
    auth: oauthAuth(),
    fetchImpl,
    ...(opts.admissionBytes ? { admission: createAdmission({ maxInFlightBytes: opts.admissionBytes, queueTimeoutMs: opts.queueTimeoutMs ?? 200 }) } : {}),
    ...(opts.stopToken ? { stopToken: opts.stopToken } : {}),
    onStopRequest: () => { triggers.push(triggers.length + 1); stopRef.run?.(); },
  });
  servers.push(server);
  const lines: string[] = [];
  const order: string[] = [];
  const exits: number[] = [];
  const shutdown = createGracefulShutdown({
    server,
    stopBackground: () => order.push("background"),
    flush: async () => { order.push("flush"); },
    exit: (code) => { order.push("exit"); exits.push(code); },
    writeLog: (line) => lines.push(line),
  });
  if (opts.wireShutdown) stopRef.run = () => { void shutdown.run("stop"); };
  return { server, shutdown, triggers, lines, order, exits, base: `http://127.0.0.1:${server.port}`, releaseUpstream: () => { while (waiting.length) waiting.shift()!(); } };
}

const messages = (extra: Record<string, unknown> = {}) => JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "hi" }], ...extra });
const headers = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function until(cond: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await Bun.sleep(5);
  }
}

describe("the graceful stop request POST /__kit/stop", () => {
  it("is accepted only after Host, Origin and bearer, with the per-spawn stop token", async () => {
    const p = await stopProxy({ stopToken: TOKEN });
    const stop = (extra: Record<string, string> = {}) =>
      fetch(`${p.base}${STOP_REQUEST_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, [STOP_TOKEN_HEADER]: TOKEN, ...extra },
      });

    // The happy path: bearer + token.
    expect((await stop()).status).toBe(202);
    expect(p.triggers.length).toBe(1);

    // A Host header that is not a loopback host is rejected before the token matters.
    expect((await stop({ host: "intranet.example" })).status).toBe(421);
    // A disallowed browser origin is rejected before the token matters (no CORS allowance).
    const evil = await fetch(`${p.base}${STOP_REQUEST_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, [STOP_TOKEN_HEADER]: TOKEN, origin: "https://evil.example" },
    });
    expect(evil.status).toBe(403);
    expect(((await evil.json()) as { error: { type: string } }).error.type).toBe("origin_not_allowed");
    // Without or with a wrong bearer the request never reaches the token check.
    const noBearer = await fetch(`${p.base}${STOP_REQUEST_PATH}`, { method: "POST", headers: { [STOP_TOKEN_HEADER]: TOKEN } });
    expect(noBearer.status).toBe(401);
    const wrongBearer = await fetch(`${p.base}${STOP_REQUEST_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${wrongSecret("stop-route-proxy-key")}`, [STOP_TOKEN_HEADER]: TOKEN },
    });
    expect(wrongBearer.status).toBe(401);
    for (const key of [KEY.slice(0, -1), `${KEY}x`]) {
      expect((await stop({ authorization: `Bearer ${key}` })).status).toBe(401);
    }
    const preflight = await fetch(`${p.base}${STOP_REQUEST_PATH}`, {
      method: "OPTIONS", headers: { origin: "http://localhost:19220", "access-control-request-headers": STOP_TOKEN_HEADER },
    });
    expect(preflight.headers.get("access-control-allow-headers")).not.toContain(STOP_TOKEN_HEADER);
    // A GET is the unknown route, never the stop.
    expect((await fetch(`${p.base}${STOP_REQUEST_PATH}`, { headers })).status).toBe(404);
    expect(p.triggers.length).toBe(1); // only the accepted request triggered
  });

  it("rejects wrong, short and long tokens and answers the unknown-route 404 without a configured token", async () => {
    const p = await stopProxy({ stopToken: TOKEN });
    const stop = (token: string | null) =>
      fetch(`${p.base}${STOP_REQUEST_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, ...(token === null ? {} : { [STOP_TOKEN_HEADER]: token }) },
      });
    for (const token of [WRONG_TOKEN, TOKEN.slice(0, -1), `${TOKEN}x`, "", "   "]) {
      const res = await stop(token);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { type: string; message: string } };
      expect(body.error.type).toBe("forbidden");
      // The presented token never echoes in the answer.
      if (token) expect(body.error.message).not.toContain(token as string);
    }
    const noHeader = await stop(null);
    expect(noHeader.status).toBe(403);
    expect(p.triggers.length).toBe(0);

    // A proxy spawned without a stop token (TUI-hosted, standalone) answers the
    // same 404 not_found_error as an unknown route; it never accepts without one.
    const tokenless = await stopProxy({});
    const unknown = await fetch(`${tokenless.base}/nope`, { headers });
    const attempt = await fetch(`${tokenless.base}${STOP_REQUEST_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, [STOP_TOKEN_HEADER]: TOKEN },
    });
    expect(attempt.status).toBe(404);
    expect(((await attempt.json()) as { error: { type: string } }).error.type)
      .toBe(((await unknown.json()) as { error: { type: string } }).error.type);
    expect(tokenless.triggers.length).toBe(0);
  });

  it("does not start the drain while the 202 is still inside the handler", async () => {
    let triggered = false;
    const handler = createFetchHandler({
      config: makeConfig(), auth: oauthAuth(), stopToken: TOKEN,
      onStopRequest: () => { triggered = true; },
    });
    const response = await handler(new Request(`http://127.0.0.1${STOP_REQUEST_PATH}`, {
      method: "POST", headers: { authorization: `Bearer ${KEY}`, [STOP_TOKEN_HEADER]: TOKEN },
    }));
    expect(response.status).toBe(202);
    expect(triggered).toBe(false);
  });

  it("bypasses admission: it is answered 202 while the byte cap is saturated", async () => {
    const p = await stopProxy({ stopToken: TOKEN, admissionBytes: 1024, holdUpstream: true });
    // One in-flight request holds most of the admission cap (the body is
    // ~1 KB JSON, under the 1024 cap, so it is admitted and held upstream).
    const holder = fetch(`${p.base}/v1/messages`, { method: "POST", headers, body: messages({ metadata: { pad: "x".repeat(900) } }) });
    try {
      await until(() => p.server.admission().inFlightBytes >= 900);
      const stop = await fetch(`${p.base}${STOP_REQUEST_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, [STOP_TOKEN_HEADER]: TOKEN },
      });
      expect(stop.status).toBe(202);
      expect(((await stop.json()) as { accepted: boolean }).accepted).toBe(true);
      // A body route at the same moment no longer fits and is shed instead.
      const shed = await fetch(`${p.base}/v1/messages`, { method: "POST", headers, body: messages({ metadata: { pad: "x".repeat(900) } }) });
      expect(shed.status).toBe(503);
      await shed.text().catch(() => {});
      expect(p.triggers.length).toBe(1);
    } finally {
      p.releaseUpstream();
      // Consume the holder so no socket lingers into afterEach's close.
      const holderRes = await holder.catch(() => null);
      if (holderRes) await holderRes.text().catch(() => {});
    }
  });

  it("answers 202 before the drain, triggers the one graceful sequence with the shared deadline, and the listener stays open during the drain", async () => {
    const p = await stopProxy({ stopToken: TOKEN, wireShutdown: true, holdUpstream: true });
    const stop = () =>
      fetch(`${p.base}${STOP_REQUEST_PATH}`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, [STOP_TOKEN_HEADER]: TOKEN },
      });
    try {
      // One accepted request is in flight, so the drain has something to wait
      // for and the listener provably stays open while it drains.
      const accepted = fetch(`${p.base}/v1/messages`, { method: "POST", headers, body: messages() });
      await until(() => p.server.inFlight() === 1);

      const res = await stop();
      expect(res.status).toBe(202);
      expect(((await res.json()) as { accepted: boolean }).accepted).toBe(true);
      // The 202 is the answer that starts the drain: the response carries no
      // Retry-After — the stop request is never shed by the drain it triggers.
      expect(res.headers.get("retry-after")).toBeNull();
      expect(p.server.draining()).toBe(true);

      // The listener stays open during the drain; /health keeps answering.
      expect((await fetch(`${p.base}/health`, { headers })).status).toBe(200);
      // A repeated stop request during the drain joins the running sequence (202 again).
      expect((await stop()).status).toBe(202);
      // New requests are shed.
      const shed = await fetch(`${p.base}/v1/messages`, { method: "POST", headers, body: messages() });
      expect(shed.status).toBe(503);
      // The accepted request finishes inside the drain window.
      p.releaseUpstream();
      expect((await accepted).status).toBe(200);
      await until(() => p.exits.length > 0, 3_000);

      expect(p.exits).toEqual([0]);
      expect(p.order).toEqual(["background", "flush", "exit"]);
      const started = p.lines.filter((l) => / shutdown started /.test(l));
      expect(started).toHaveLength(1);
      expect(started[0]).toMatch(EVENT_LINE);
      expect(started[0]).toMatch(/ reason=stop( |$)/);
      expect(started[0]).toContain("drainMs=6000");
      expect(started[0]).toContain(`deadlineMs=${STOP_GRACE_MS}`);
      // The flush's marker line (the windows-latest `proxy stop` flush proof reads it).
      expect(p.lines.some((l) => / shutdown flush finished /.test(l))).toBe(true);
      expect(p.lines.filter((l) => / shutdown drain finished /.test(l))).toHaveLength(1);
      expect(p.triggers.length).toBe(2);
    } finally {
      p.releaseUpstream();
    }
  });

  it("uses the shared module's path, header and grace on both sides", () => {
    expect(STOP_REQUEST_PATH).toBe("/__kit/stop");
    expect(STOP_TOKEN_HEADER).toBe("x-zcode-stop-token");
    expect(STOP_GRACE_MS).toBe(10_000);
  });
});
