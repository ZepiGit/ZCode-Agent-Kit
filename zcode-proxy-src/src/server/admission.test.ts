/**
 * Admission control over the proxy's loopback listener:
 * a cap on the request-body bytes in flight, a bounded FIFO whose bodies stay
 * unread, and the 503 + Retry-After shed in each endpoint's error shape.
 *
 * The proxy runs in this process on an ephemeral loopback port; the upstream
 * is an injected fetch that holds every request until the test opens its gate,
 * so "in flight" is observable from outside as "arrived upstream, not answered".
 */
import { afterEach, describe, expect, it } from "bun:test";
import net from "node:net";
import { gzipSync } from "node:zlib";
import { startServer, type ProxyServer } from "./server.js";
import { createAdmission, type Admission } from "./admission.js";
import type { ProxyConfig } from "../config/types.js";
import { AuthManager } from "../auth/manager.js";
import { fixtureSecret } from "../test-fixtures.js";

const KEY = fixtureSecret("admission-proxy-key");
const MB = 1024 * 1024;

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
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
    async: { enabled: true, origin: "http://127.0.0.1:9", pollIntervalMs: 5000, keepAliveIntervalMs: 3000, maxWaitMs: 0, maxRetries: 0, settleTimeoutMs: 8000, controlTimeoutMs: 15000, defaultModel: "" },
    claim: { enabled: false, auto: false, origin: "https://zcode.z.ai", pollIntervalMs: 300000, cooldownMs: 600000, planId: "" },
    logging: { level: "info" },
    ...overrides,
  };
}

function oauthAuth(): AuthManager {
  const auth = new AuthManager();
  auth.setOAuthCredential({ apiKey: "testkey", secret: "testsecret", provider: "zai" });
  return auth;
}

/**
 * An upstream that holds every request until released. `arrivals` lists the
 * tag of each request in the order it reached the upstream; `held` is how many
 * are waiting for an answer right now, `maxHeld` the most at any one time.
 */
function gatedUpstream(opts: { stream?: boolean } = {}) {
  const arrivals: string[] = [];
  const waiting: Array<() => void> = [];
  let held = 0;
  let maxHeld = 0;
  let open = false;
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    const req = input as Request;
    // Like a real fetch, a held request fails once the proxy aborts it.
    const signal = init?.signal ?? undefined;
    const text = await req.text();
    const tag = /\[tag:([^\]]+)\]/.exec(text)?.[1] ?? "?";
    arrivals.push(tag);
    held++;
    maxHeld = Math.max(maxHeld, held);
    if (opts.stream) {
      // Answer at once with an SSE stream that stays open until released.
      let close!: () => void;
      const closed = new Promise<void>((r) => { close = r; });
      waiting.push(close);
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(enc.encode(`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_${tag}","type":"message","role":"assistant","content":[],"model":"glm-4.6","usage":{"input_tokens":1,"output_tokens":0}}}\n\n`));
          controller.enqueue(enc.encode(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`));
          await closed;
          controller.enqueue(enc.encode(`event: message_stop\ndata: {"type":"message_stop"}\n\n`));
          held--;
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    if (!open) {
      try {
        await new Promise<void>((resolve, reject) => {
          waiting.push(resolve);
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      } finally {
        held--;
      }
    } else {
      held--;
    }
    return new Response(JSON.stringify({
      id: `msg_${tag}`, type: "message", role: "assistant", model: "glm-4.6",
      content: [{ type: "text", text: `ok ${tag}` }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const handle = {
    fetchImpl,
    arrivals,
    get held() { return held; },
    get maxHeld() { return maxHeld; },
    /** Answer the oldest held request. */
    releaseOne() { waiting.shift()?.(); },
    /** Answer every held request and every later one at once. */
    openAll() { open = true; while (waiting.length) waiting.shift()!(); },
  };
  upstreams.push(handle);
  return handle;
}

const servers: ProxyServer[] = [];
const upstreams: Array<{ openAll(): void }> = [];
afterEach(async () => {
  while (upstreams.length) upstreams.pop()!.openAll();
  while (servers.length) await servers.pop()!.close().catch(() => {});
});

async function startProxy(admission: Admission, fetchImpl: typeof fetch, config = makeConfig()) {
  const server = await startServer({ config, auth: oauthAuth(), fetchImpl, admission });
  servers.push(server);
  return { server, base: `http://127.0.0.1:${server.port}` };
}

/** An Anthropic messages body of about `size` bytes carrying `tag`. */
function messagesBody(tag: string, size: number, extra: Record<string, unknown> = {}): string {
  const head = `[tag:${tag}] `;
  const make = (pad: number) => JSON.stringify({ model: "glm-4.6", max_tokens: 8, ...extra, messages: [{ role: "user", content: head + "x".repeat(pad) }] });
  return make(Math.max(0, size - make(0).length));
}

const authHeaders = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };

async function until(cond: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

describe("admission: the byte cap", () => {
  it("lets at most cap / size bodies reach the upstream at once; the rest wait and are then served", async () => {
    const upstream = gatedUpstream();
    const admission = createAdmission({ maxInFlightBytes: 32 * MB });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    // 12 concurrent 7.5 MB bodies against a 32 MB cap: at most 4 fit at once.
    const pending = Array.from({ length: 12 }, (_, i) => fetch(`${base}/v1/messages`, {
      method: "POST", headers: authHeaders, body: messagesBody(String(i), 7.5 * MB),
    }));
    await until(() => upstream.held >= 4, "4 requests upstream");
    await Bun.sleep(300);
    expect(upstream.held).toBe(4);
    expect(admission.stats().queued).toBe(8);
    upstream.openAll();
    const responses = await Promise.all(pending);
    expect(responses.map((r) => r.status)).toEqual(Array(12).fill(200));
    await Promise.all(responses.map((r) => r.text()));
    expect(upstream.maxHeld).toBe(4);
    expect(upstream.arrivals.length).toBe(12);
    const stats = admission.stats();
    expect(stats.inFlightBytes).toBe(0);
    expect(stats.queued).toBe(0);
    expect(stats.peakInFlightBytes).toBeLessThanOrEqual(32 * MB);
  }, 30_000);

  it("leaves a queued request's body unread on the socket until it is admitted", async () => {
    const upstream = gatedUpstream();
    const admission = createAdmission({ maxInFlightBytes: 16 * MB });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const first = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("A", 10 * MB) });
    await until(() => upstream.held === 1, "A upstream");
    const readBefore = admission.stats().bodyBytesRead;
    const second = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("B", 12 * MB) });
    await until(() => admission.stats().queued === 1, "B queued");
    await Bun.sleep(500);
    // B's 12 MB went to the socket; the server read (almost) none of it.
    expect(admission.stats().bodyBytesRead - readBefore).toBeLessThan(1 * MB);
    upstream.openAll();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(admission.stats().bodyBytesRead - readBefore).toBeGreaterThanOrEqual(12 * MB - 100);
    expect(upstream.arrivals).toEqual(["A", "B"]);
  }, 30_000);
});

/** The endpoints that carry a request body, with a small body in each one's format. */
const ENDPOINTS = [
  { path: "/v1/messages", shape: "anthropic", body: (tag: string) => messagesBody(tag, 256) },
  { path: "/async/v1/messages", shape: "anthropic", body: (tag: string) => messagesBody(tag, 256) },
  { path: "/v1/chat/completions", shape: "openai", body: (tag: string) => JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: `[tag:${tag}]` }] }) },
  { path: "/async/v1/chat/completions", shape: "openai", body: (tag: string) => JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: `[tag:${tag}]` }] }) },
  { path: "/v1/responses", shape: "openai", body: (tag: string) => JSON.stringify({ model: "glm-4.6", input: `[tag:${tag}]` }) },
] as const;

/** Assert the ADR-0004 shed contract on `resp` for an endpoint of `shape`. */
async function expectShed(resp: Response, shape: "anthropic" | "openai"): Promise<string> {
  expect(resp.status).toBe(503);
  expect(resp.headers.get("retry-after")).toBe("2");
  expect(resp.headers.get("content-type")).toContain("application/json");
  const body = await resp.json() as Record<string, any>;
  if (shape === "anthropic") {
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("overloaded_error");
  } else {
    expect(body.error.type).toBe("server_error");
    expect(body.error.code).toBe("overloaded");
    expect(body.error.param).toBeNull();
  }
  const message: string = body.error.message;
  // what / why / next
  expect(message).toMatch(/^The proxy is busy and did not accept this request\./);
  expect(message).toMatch(/request bodies .* in flight/);
  expect(message).toMatch(/Retry in 2 s/);
  return message;
}

describe("admission: the queue bounds and the 503 shed", () => {
  it("sheds at once with 503 + Retry-After in each endpoint's shape when the queue is full (count bound)", async () => {
    const upstream = gatedUpstream();
    const lines: string[] = [];
    const admission = createAdmission({ maxInFlightBytes: 1 * MB, maxQueued: 1, writeLog: (line) => lines.push(line) });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    // A (2 MB) is admitted on an idle proxy and holds the cap; B fills the queue.
    const a = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("A", 2 * MB) });
    await until(() => upstream.held === 1, "A upstream");
    const b = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("B", 256) });
    await until(() => admission.stats().queued === 1, "B queued");
    for (const endpoint of ENDPOINTS) {
      const started = Date.now();
      const resp = await fetch(`${base}${endpoint.path}`, { method: "POST", headers: authHeaders, body: endpoint.body("C") });
      expect(Date.now() - started).toBeLessThan(1000);
      const message = await expectShed(resp, endpoint.shape);
      expect(message).toContain("the admission queue is full (1 waiting)");
    }
    expect(admission.stats().shedTotal).toBe(ENDPOINTS.length);
    // Every shed is one event line: `ISO-time WARN shed request shed key=value…`.
    const shedLines = lines.filter((l) => / WARN shed request shed /.test(l));
    expect(shedLines.length).toBe(ENDPOINTS.length);
    expect(shedLines[0]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z WARN shed request shed reason=queue_full endpoint=\/v1\/messages /);
    expect(shedLines[0]).toMatch(/ retryAfterS=2/);
    upstream.openAll();
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    expect(upstream.arrivals).toEqual(["A", "B"]);
  }, 30_000);

  it("sheds a request that waited past the time bound, in each endpoint's shape, and never answers 429", async () => {
    const upstream = gatedUpstream();
    const admission = createAdmission({ maxInFlightBytes: 1 * MB, queueTimeoutMs: 300 });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const a = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("A", 2 * MB) });
    await until(() => upstream.held === 1, "A upstream");
    const statuses: number[] = [];
    for (const endpoint of ENDPOINTS) {
      const started = Date.now();
      const resp = await fetch(`${base}${endpoint.path}`, { method: "POST", headers: authHeaders, body: endpoint.body("late") });
      const waited = Date.now() - started;
      statuses.push(resp.status);
      expect(waited).toBeGreaterThanOrEqual(280);
      expect(waited).toBeLessThan(3000);
      const message = await expectShed(resp, endpoint.shape);
      expect(message).toContain("it waited 0.3 s for admission");
    }
    expect(statuses).not.toContain(429);
    expect(admission.stats().queued).toBe(0);
    upstream.openAll();
    expect((await a).status).toBe(200);
    // The shed requests never reached the upstream.
    expect(upstream.arrivals).toEqual(["A"]);
  }, 30_000);

  it("uses the documented defaults: 64 MB cap, 64 waiting requests, 15 s", () => {
    const stats = createAdmission({ maxInFlightBytes: 64 * MB }).stats();
    expect(stats.maxInFlightBytes).toBe(64 * MB);
    expect(stats.maxQueued).toBe(64);
    expect(stats.queueTimeoutMs).toBe(15_000);
  });
});

describe("admission: order, streams and the idle rule", () => {
  it("admits waiting requests in arrival order (FIFO): a small one that would fit never overtakes a large one", async () => {
    const upstream = gatedUpstream();
    const admission = createAdmission({ maxInFlightBytes: 8 * MB });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const a = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("A", 6 * MB) });
    await until(() => upstream.held === 1, "A upstream");
    // Queued in this order. s1 and s2 would fit next to A at once; FIFO keeps them behind L.
    const order = [["L", 6 * MB], ["s1", 1024], ["s2", 1024], ["M", 3 * MB], ["s3", 1024]] as const;
    const pending: Promise<Response>[] = [];
    for (const [tag, size] of order) {
      pending.push(fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody(tag, size) }));
      await until(() => admission.stats().queued === pending.length, `${tag} queued`);
    }
    await Bun.sleep(200);
    expect(upstream.arrivals).toEqual(["A"]);
    // A answers: L, then s1 and s2 behind it, are admitted; M does not fit next to L, and s3 waits behind M.
    upstream.releaseOne();
    await until(() => upstream.held === 3, "L, s1, s2 upstream");
    await Bun.sleep(200);
    expect(new Set(upstream.arrivals.slice(1))).toEqual(new Set(["L", "s1", "s2"]));
    expect(admission.stats().queued).toBe(2);
    upstream.openAll();
    expect((await a).status).toBe(200);
    for (const p of pending) expect((await p).status).toBe(200);
    expect(new Set(upstream.arrivals.slice(4))).toEqual(new Set(["M", "s3"]));
  }, 30_000);

  it("does not limit open response streams: 20 concurrent streams whose bodies together exceed the cap all start and stay open", async () => {
    const upstream = gatedUpstream({ stream: true });
    // 20 × 8 KB of request bodies against a 32 KB cap: a stream's bytes come
    // back when its response starts, so the open streams never wait on each other.
    const admission = createAdmission({ maxInFlightBytes: 32 * 1024 });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(`${base}/v1/messages`, {
      method: "POST", headers: authHeaders, body: messagesBody(`s${i}`, 8 * 1024, { stream: true }),
    })));
    expect(responses.map((r) => r.status)).toEqual(Array(20).fill(200));
    // Every stream is open at once and the admission holds nothing for them.
    expect(upstream.held).toBe(20);
    expect(admission.stats()).toMatchObject({ inFlightBytes: 0, queued: 0, shedTotal: 0 });
    const firsts = await Promise.all(responses.map(async (r) => {
      const reader = r.body!.getReader();
      const { value } = await reader.read();
      return { reader, text: new TextDecoder().decode(value) };
    }));
    for (const f of firsts) expect(f.text).toContain("message_start");
    upstream.openAll();
    for (const f of firsts) { while (!(await f.reader.read()).done) { /* drain */ } }
  }, 30_000);

  it("always admits on an idle proxy: one 32 MiB wire body, even with a cap below its size", async () => {
    const upstream = gatedUpstream();
    upstream.openAll();
    const admission = createAdmission({ maxInFlightBytes: 8 * MB });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const body = messagesBody("max", 32 * MB);
    expect(Buffer.byteLength(body)).toBe(32 * MB);
    const resp = await fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toContain("ok max");
    expect(admission.stats()).toMatchObject({ inFlightBytes: 0, shedTotal: 0 });
  }, 30_000);

  it("always admits on an idle proxy at the default cap: a gzip body that inflates to 64 MiB", async () => {
    const upstream = gatedUpstream();
    upstream.openAll();
    const admission = createAdmission({ maxInFlightBytes: 64 * MB });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const plain = messagesBody("gz", 64 * MB);
    expect(Buffer.byteLength(plain)).toBe(64 * MB);
    const gz = gzipSync(plain);
    const resp = await fetch(`${base}/v1/messages`, { method: "POST", headers: { ...authHeaders, "content-encoding": "gzip" }, body: gz });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toContain("ok gz");
    const stats = admission.stats();
    expect(stats.inFlightBytes).toBe(0);
    // The inflated size was charged while the request held it.
    expect(stats.peakInFlightBytes).toBe(64 * MB);
  }, 60_000);

  it("refuses a body declared larger than the 32 MiB wire limit at once with 413, unread, even while others wait", async () => {
    const upstream = gatedUpstream();
    const admission = createAdmission({ maxInFlightBytes: 1 * MB });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const a = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("A", 2 * MB) });
    await until(() => upstream.held === 1, "A upstream");
    const b = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("B", 1024) });
    await until(() => admission.stats().queued === 1, "B queued");
    const readBefore = admission.stats().bodyBytesRead;
    // A raw client declares 40 MiB and sends only the headers.
    const status = await new Promise<string>((resolve, reject) => {
      const port = Number(new URL(base).port);
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write(`POST /v1/messages HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nauthorization: Bearer ${KEY}\r\ncontent-type: application/json\r\ncontent-length: ${40 * MB}\r\n\r\n`);
      });
      sock.once("data", (d) => { resolve(String(d).split("\r\n")[0]); sock.destroy(); });
      sock.once("error", reject);
    });
    expect(status).toBe("HTTP/1.1 413 Payload Too Large");
    expect(admission.stats().bodyBytesRead - readBefore).toBe(0);
    expect(admission.stats().shedTotal).toBe(0);
    upstream.openAll();
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
  }, 30_000);
});

/** A chunked request body (no Content-Length) streamed in `chunks` pieces of `chunkSize`. */
function chunkedBody(tag: string, chunks: number, chunkSize: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i === 0) controller.enqueue(enc.encode(`{"model":"glm-4.6","max_tokens":8,"messages":[{"role":"user","content":"[tag:${tag}] `));
      if (i < chunks) controller.enqueue(enc.encode("x".repeat(chunkSize)));
      else { controller.enqueue(enc.encode(`"}]}`)); controller.close(); }
      i++;
    },
  });
}

describe("admission: bodies without Content-Length, slow uploads and aborts", () => {
  it("holds the cap for concurrent chunked bodies: each is reserved at the wire maximum until read, then charged its real size", async () => {
    const upstream = gatedUpstream();
    const admission = createAdmission({ maxInFlightBytes: 64 * MB });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    // 10 chunked bodies of 4 MB: reserved at 32 MiB each while unread, so at
    // most 2 are read at once; once read each is charged 4 MB.
    const pending = Array.from({ length: 10 }, (_, i) => fetch(`${base}/v1/messages`, {
      method: "POST", headers: authHeaders, body: chunkedBody(`c${i}`, 4, MB), duplex: "half",
    } as RequestInit));
    // Each read body is a little over 4 MiB, so 8 read (just over 32 MiB)
    // leave no room for another 32 MiB reservation: 8 reach the upstream and
    // 2 wait, unread.
    await until(() => upstream.held >= 8, "8 chunked bodies upstream");
    await Bun.sleep(300);
    expect(upstream.held).toBe(8);
    expect(admission.stats().queued).toBe(2);
    expect(admission.stats().inFlightBytes).toBeLessThanOrEqual(64 * MB);
    upstream.openAll();
    const responses = await Promise.all(pending);
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
    const stats = admission.stats();
    expect(stats.peakInFlightBytes).toBeLessThanOrEqual(64 * MB);
    expect(stats.inFlightBytes).toBe(0);
  }, 30_000);

  it("a slow upload keeps its bytes for as long as it uploads; a request behind it waits unread and is shed at the time bound", async () => {
    const upstream = gatedUpstream();
    upstream.openAll();
    const admission = createAdmission({ maxInFlightBytes: 16 * MB, queueTimeoutMs: 400 });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const port = Number(new URL(base).port);
    const body = messagesBody("slow", 10 * MB);
    const total = Buffer.byteLength(body);
    // The slow client sends the headers and the first 1 MB, then stalls.
    const sock = net.connect(port, "127.0.0.1");
    await new Promise<void>((r) => sock.once("connect", () => r()));
    const reply = new Promise<string>((resolve) => { let buf = ""; sock.on("data", (d) => { buf += d; if (buf.includes("\r\n\r\n")) resolve(buf.split("\r\n")[0]); }); });
    sock.write(`POST /v1/messages HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nauthorization: Bearer ${KEY}\r\ncontent-type: application/json\r\ncontent-length: ${total}\r\n\r\n`);
    sock.write(body.slice(0, MB));
    await until(() => admission.stats().inFlightBytes === total, "slow upload admitted");
    const readBefore = admission.stats().bodyBytesRead;
    const behind = await fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("behind", 8 * MB) });
    await expectShed(behind, "anthropic");
    expect(admission.stats().bodyBytesRead - readBefore).toBeLessThan(1 * MB);
    expect(admission.stats().inFlightBytes).toBe(total);
    // The slow upload finishes and is served; its bytes come back.
    sock.write(body.slice(MB));
    expect(await reply).toBe("HTTP/1.1 200 OK");
    sock.destroy();
    await until(() => admission.stats().inFlightBytes === 0, "slow upload released");
    expect(upstream.arrivals).toEqual(["slow"]);
  }, 30_000);

  it("gives back the bytes of a client that disconnects mid-upload, and admits the next request", async () => {
    const upstream = gatedUpstream();
    upstream.openAll();
    const admission = createAdmission({ maxInFlightBytes: 16 * MB });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const port = Number(new URL(base).port);
    const body = messagesBody("gone", 12 * MB);
    const sock = net.connect(port, "127.0.0.1");
    await new Promise<void>((r) => sock.once("connect", () => r()));
    sock.on("error", () => {});
    sock.write(`POST /v1/messages HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\nauthorization: Bearer ${KEY}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n`);
    sock.write(body.slice(0, 2 * MB));
    await until(() => admission.stats().inFlightBytes > 0, "upload admitted");
    const next = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("next", 8 * MB) });
    await until(() => admission.stats().queued === 1, "next queued");
    sock.destroy();
    const resp = await next;
    expect(resp.status).toBe(200);
    expect(await resp.text()).toContain("ok next");
    await until(() => admission.stats().inFlightBytes === 0, "all bytes back");
    expect(upstream.arrivals).toEqual(["next"]);
  }, 30_000);

  it("gives back the bytes of a client that disconnects while its request waits for the upstream", async () => {
    const upstream = gatedUpstream();
    const admission = createAdmission({ maxInFlightBytes: 16 * MB });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const ac = new AbortController();
    const gone = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("gone", 12 * MB), signal: ac.signal }).catch((e) => e);
    await until(() => upstream.held === 1, "upstream holds it");
    const next = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("next", 8 * MB) });
    await until(() => admission.stats().queued === 1, "next queued");
    ac.abort();
    await gone;
    await until(() => upstream.held === 1 && upstream.arrivals.length === 2, "next upstream");
    upstream.openAll();
    expect((await next).status).toBe(200);
    await until(() => admission.stats().inFlightBytes === 0, "all bytes back");
  }, 30_000);

  it("drops a client that disconnects while queued from the queue without counting a shed", async () => {
    const upstream = gatedUpstream();
    const admission = createAdmission({ maxInFlightBytes: 1 * MB });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    const a = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("A", 2 * MB) });
    await until(() => upstream.held === 1, "A upstream");
    const ac = new AbortController();
    const gone = fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("gone", 1024), signal: ac.signal }).catch((e) => e);
    await until(() => admission.stats().queued === 1, "queued");
    ac.abort();
    await gone;
    await until(() => admission.stats().queued === 0, "left the queue");
    expect(admission.stats().shedTotal).toBe(0);
    upstream.openAll();
    expect((await a).status).toBe(200);
    expect(upstream.arrivals).toEqual(["A"]);
  }, 30_000);
});

describe("admission: giving large bodies back", () => {
  it("asks the runtime for one collection after a request of at least 4 MiB gives its bytes back, never for small ones", async () => {
    const upstream = gatedUpstream();
    upstream.openAll();
    let collections = 0;
    const admission = createAdmission({ maxInFlightBytes: 64 * MB, collect: () => { collections++; } });
    const { base } = await startProxy(admission, upstream.fetchImpl);
    for (let i = 0; i < 5; i++) {
      const resp = await fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody(`small${i}`, 512 * 1024) });
      await resp.text();
    }
    await Bun.sleep(50);
    expect(collections).toBe(0);
    const big = await fetch(`${base}/v1/messages`, { method: "POST", headers: authHeaders, body: messagesBody("big", 5 * MB) });
    expect(big.status).toBe(200);
    await big.text();
    await until(() => collections === 1, "one collection");
    await Bun.sleep(50);
    expect(collections).toBe(1);
  }, 30_000);
});
