/**
 * The graceful shutdown's drain over the proxy's loopback listener (seam 4,
 * ADR-0008 cond 2, ADR-0004 Round 2 amendment): the listener stays open, new
 * requests are shed with 503 + Retry-After in their endpoint's shape, requests
 * already accepted get the drain window, and streams still open at the force
 * point are cut and counted in one log line.
 *
 * The proxy runs in this process on an ephemeral loopback port against an
 * injected upstream (no network); `exit` is a spy, so nothing ends the runner.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { startServer, type ProxyServer } from "./server.js";
import { createAdmission } from "./admission.js";
import { createGracefulShutdown } from "../runtime/supervisor.js";
import type { ProxyConfig } from "../config/types.js";
import { AuthManager } from "../auth/manager.js";
import { fixtureSecret } from "../test-fixtures.js";

const KEY = fixtureSecret("drain-proxy-key");
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

/** An upstream that holds each request (JSON answer, or an SSE stream left open) until released. */
function heldUpstream(opts: { stream?: boolean } = {}) {
  const waiting: Array<() => void> = [];
  let arrived = 0;
  const enc = new TextEncoder();
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input as Request;
    const signal = init?.signal ?? undefined;
    await req.text();
    arrived++;
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    waiting.push(release);
    if (opts.stream) {
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(enc.encode(`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"glm-4.6","usage":{"input_tokens":1,"output_tokens":0}}}\n\n`));
          controller.enqueue(enc.encode(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`));
          await released;
          try {
            controller.enqueue(enc.encode(`event: message_stop\ndata: {"type":"message_stop"}\n\n`));
            controller.close();
          } catch {}
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    await Promise.race([released, new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }))]);
    return new Response(JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "glm-4.6",
      content: [{ type: "text", text: "finished during the drain" }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const handle = {
    fetchImpl,
    get arrived() { return arrived; },
    releaseAll() { while (waiting.length) waiting.shift()!(); },
  };
  upstreams.push(handle);
  return handle;
}

const servers: ProxyServer[] = [];
const upstreams: Array<{ releaseAll(): void }> = [];
afterEach(async () => {
  while (upstreams.length) upstreams.pop()!.releaseAll();
  while (servers.length) await servers.pop()!.close().catch(() => {});
});

async function proxy(fetchImpl: typeof fetch, admission = createAdmission({ maxInFlightBytes: 64 * 1024 * 1024 })) {
  const server = await startServer({ config: makeConfig(), auth: oauthAuth(), fetchImpl, admission });
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
  return { server, shutdown, lines, order, exits, base: `http://127.0.0.1:${server.port}` };
}

const headers = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };
const messages = (extra: Record<string, unknown> = {}) => JSON.stringify({ model: "glm-4.6", max_tokens: 8, ...extra, messages: [{ role: "user", content: "hi" }] });
const chat = () => JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "hi" }] });

async function until(cond: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not reached");
    await Bun.sleep(5);
  }
}

describe("graceful shutdown drain over the loopback listener", () => {
  it("keeps the listener open, sheds new requests with 503 + Retry-After per endpoint, and lets the accepted request finish", async () => {
    const up = heldUpstream();
    const p = await proxy(up.fetchImpl);
    const accepted = fetch(`${p.base}/v1/messages`, { method: "POST", headers, body: messages() });
    await until(() => up.arrived === 1);

    const done = p.shutdown.run("memory", { drainMs: 5_000, deadlineMs: 9_000 });

    const anthropic = await fetch(`${p.base}/v1/messages`, { method: "POST", headers, body: messages() });
    expect(anthropic.status).toBe(503);
    expect(Number(anthropic.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const aBody = await anthropic.json() as { type: string; error: { type: string; message: string } };
    expect(aBody.type).toBe("error");
    expect(aBody.error.type).toBe("overloaded_error");
    expect(aBody.error.message).toContain("shutting down");

    const openai = await fetch(`${p.base}/v1/chat/completions`, { method: "POST", headers, body: chat() });
    expect(openai.status).toBe(503);
    expect(openai.headers.get("retry-after")).not.toBeNull();
    const oBody = await openai.json() as { error: { type: string; code: string } };
    expect(oBody.error.code).toBe("overloaded");
    expect(openai.status).not.toBe(429);
    // Routes without a body never wait for admission; they are shed too.
    const models = await fetch(`${p.base}/v1/models`, { headers });
    expect(models.status).toBe(503);
    expect(models.headers.get("retry-after")).not.toBeNull();
    expect(((await models.json()) as { error: { code: string } }).error.code).toBe("overloaded");
    expect(up.arrived).toBe(1); // nothing new reached upstream

    // The listener is still open: health answers, an unauthenticated call is still a 401.
    expect((await fetch(`${p.base}/health`, { headers })).status).toBe(200);
    expect((await fetch(`${p.base}/v1/messages`, { method: "POST", body: messages() })).status).toBe(401);
    expect(p.exits).toEqual([]);

    up.releaseAll();
    const res = await accepted;
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("finished during the drain");
    await done;

    expect(p.exits).toEqual([0]);
    expect(p.order).toEqual(["background", "flush", "exit"]);
    const drainLines = p.lines.filter((l) => / shutdown drain finished /.test(l));
    expect(drainLines).toHaveLength(1);
    expect(drainLines[0]).toMatch(EVENT_LINE);
    expect(drainLines[0]).toMatch(/ cut=0( |$)/);
    expect(drainLines[0]).toMatch(/ shed=3( |$)/);
  });

  it("cuts the streams still open at the force point and counts them in one log line", async () => {
    const up = heldUpstream({ stream: true });
    const p = await proxy(up.fetchImpl);
    const streams = await Promise.all([1, 2].map(async () => {
      const res = await fetch(`${p.base}/v1/messages`, { method: "POST", headers, body: messages({ stream: true }) });
      const reader = res.body!.getReader();
      await reader.read();
      return reader;
    }));
    const started = Date.now();
    await p.shutdown.run("memory", { drainMs: 300, deadlineMs: 5_000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    expect(Date.now() - started).toBeLessThan(4_000);
    for (const reader of streams) {
      // A cut stream ends early (an error or an early end), never with message_stop.
      let text = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += new TextDecoder().decode(value);
        }
      } catch { /* cut */ }
      expect(text).not.toContain("message_stop");
    }
    const drainLines = p.lines.filter((l) => / shutdown drain finished /.test(l));
    expect(drainLines).toHaveLength(1);
    expect(drainLines[0]).toMatch(/^\S+ WARN shutdown drain finished .*cut=2( |$)/);
    expect(p.exits).toEqual([0]);
  });

  it("adversarial: a request still waiting for admission when the drain starts is shed at once, not cut later", async () => {
    const up = heldUpstream();
    const p = await proxy(up.fetchImpl, createAdmission({ maxInFlightBytes: 1024 }));
    const big = messages({ metadata: { pad: "x".repeat(2_000) } });
    const accepted = fetch(`${p.base}/v1/messages`, { method: "POST", headers, body: big });
    await until(() => up.arrived === 1);
    const queued = fetch(`${p.base}/v1/messages`, { method: "POST", headers, body: big });
    await until(() => p.server.admission().queued === 1);

    const done = p.shutdown.run("memory", { drainMs: 5_000, deadlineMs: 9_000 });
    const shed = await queued;
    expect(shed.status).toBe(503);
    expect(shed.headers.get("retry-after")).not.toBeNull();
    expect(up.arrived).toBe(1);
    expect(p.exits).toEqual([]);

    up.releaseAll();
    expect((await accepted).status).toBe(200);
    await done;
    expect(p.exits).toEqual([0]);
  });

  it("adversarial: a second trigger during the drain joins the running sequence (one drain, one exit)", async () => {
    const up = heldUpstream();
    const p = await proxy(up.fetchImpl);
    const accepted = fetch(`${p.base}/v1/messages`, { method: "POST", headers, body: messages() });
    await until(() => up.arrived === 1);
    const first = p.shutdown.run("memory", { drainMs: 5_000, deadlineMs: 9_000 });
    const second = p.shutdown.run("signal");
    expect(p.shutdown.running()).toBe(true);
    up.releaseAll();
    await accepted;
    await Promise.all([first, second]);
    expect(p.exits).toEqual([0]);
    expect(p.lines.filter((l) => / shutdown started /.test(l))).toHaveLength(1);
    expect(p.lines.filter((l) => / shutdown drain finished /.test(l))).toHaveLength(1);
  });

  it("adversarial: a flush that never returns cannot hold the process past the deadline", async () => {
    const up = heldUpstream();
    const server = await startServer({ config: makeConfig(), auth: oauthAuth(), fetchImpl: up.fetchImpl });
    servers.push(server);
    const exits: number[] = [];
    const shutdown = createGracefulShutdown({
      server,
      flush: () => new Promise<void>(() => {}),
      exit: (code) => { exits.push(code); },
      writeLog: () => {},
    });
    const started = Date.now();
    void shutdown.run("signal", { drainMs: 100, deadlineMs: 600 });
    await until(() => exits.length > 0, 3_000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(550);
    expect(exits).toEqual([0]);
    await Bun.sleep(100);
    expect(exits).toEqual([0]);
  });
});
