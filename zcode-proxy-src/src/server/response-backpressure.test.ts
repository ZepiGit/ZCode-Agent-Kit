/**
 * Backpressure from a streaming client to the upstream (seam 4, ticket 61,
 * Round 12 Q3 condition 2): the proxy reads an upstream answer no faster than
 * its client drains it. A client that stops reading holds the upstream back
 * instead of making the proxy queue the answer in memory; when it reads again
 * it receives every byte, in order; when it goes away the upstream is released.
 *
 * The proxy runs in this process on an ephemeral loopback port against an
 * injected upstream (no network) whose answer is a pull-based stream that
 * counts what the proxy has pulled. The client is a raw socket that pauses,
 * so the only buffers between the two are the proxy's own and the loopback
 * socket's (a few MB at most on any OS); the answer is 48 MB.
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import net from "node:net";
import { createHash } from "node:crypto";
import { startServer, type ProxyServer } from "./server.js";
import { AuthManager } from "../auth/manager.js";
import { proxyRequest } from "../proxy/handler.js";
import type { ProxyConfig } from "../config/types.js";
import { fixtureSecret } from "../test-fixtures.js";

const KEY = fixtureSecret("backpressure-proxy-key");
const DELTAS = 3000;
const TEXT = "y".repeat(16 * 1024);
/** The usage total the stream reports; it wins over the counted deltas in the request row. */
const USAGE_TOKENS = DELTAS + 7;
/** Well above the loopback socket buffers, well below the 48 MB answer. */
const HELD_BACK_MAX = 16 * 1024 * 1024;

const enc = new TextEncoder();
const sse = (event: string, data: unknown): Uint8Array => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const HEAD = [
  sse("message_start", { type: "message_start", message: { id: "msg_bp", type: "message", role: "assistant", model: "glm-5.3", content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 } } }),
  sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
];
const DELTA = sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: TEXT } });
const TAIL = [
  sse("content_block_stop", { type: "content_block_stop", index: 0 }),
  sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: USAGE_TOKENS } }),
  sse("message_stop", { type: "message_stop" }),
];
const ANSWER_BYTES = HEAD.concat(TAIL).reduce((n, b) => n + b.byteLength, 0) + DELTAS * DELTA.byteLength;

function answerSha(): string {
  const h = createHash("sha256");
  for (const b of HEAD) h.update(b);
  for (let i = 0; i < DELTAS; i++) h.update(DELTA);
  for (const b of TAIL) h.update(b);
  return h.digest("hex");
}

/** One upstream answer: what the proxy pulled, and whether it let go. */
interface Upstream { pulled: number; released: boolean }
const upstreams: Upstream[] = [];
/** When set, the next answers are this one chunk (the shape of a late read of an accumulated body). */
let oneChunk: Uint8Array | null = null;

function upstreamAnswer(signal: AbortSignal | undefined): Response {
  const u: Upstream = { pulled: 0, released: false };
  upstreams.push(u);
  const single = oneChunk;
  const frames = single ? [single][Symbol.iterator]() : function* () { yield* HEAD; for (let i = 0; i < DELTAS; i++) yield DELTA; yield* TAIL; }();
  let ctl: ReadableStreamDefaultController<Uint8Array> | null = null;
  signal?.addEventListener("abort", () => { u.released = true; try { ctl?.error(new DOMException("aborted", "AbortError")); } catch {} }, { once: true });
  const body = new ReadableStream<Uint8Array>({
    start(c) { ctl = c; },
    pull(c) {
      const next = frames.next();
      if (next.done) { c.close(); return; }
      u.pulled += next.value.byteLength;
      c.enqueue(next.value);
    },
    cancel() { u.released = true; },
  }, { highWaterMark: 0 });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

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
    defaultModel: "glm-5.3",
    models: ["glm-5.3"],
    identity: { appVersion: "test-1.0.0", sourceTitle: "cli", refererOrigin: "https://zcode.z.ai" },
    clientIdentity: { mode: "off", ttlSeconds: 900, maxSessions: 1024 },
    responses: { enabled: false, storeMaxEntries: 1000, storeTtlMs: 86400000 },
    endpointRouting: { enabled: false, origin: "https://zcode.z.ai" },
    clientSigning: { enabled: false, origin: "https://zcode.z.ai" },
    mcp: { enabled: false, webSearch: false, webReader: false, zread: false },
    async: { enabled: false, origin: "http://127.0.0.1:9", pollIntervalMs: 5000, keepAliveIntervalMs: 3000, maxWaitMs: 0, maxRetries: 0, settleTimeoutMs: 8000, controlTimeoutMs: 15000, defaultModel: "" },
    claim: { enabled: false, auto: false, origin: "https://zcode.z.ai", pollIntervalMs: 300000, cooldownMs: 600000, planId: "" },
    logging: { level: "info" },
  } as ProxyConfig;
}

let server: ProxyServer;
const rows: string[] = [];
let logSpy: ReturnType<typeof spyOn>;

beforeAll(async () => {
  const auth = new AuthManager();
  auth.setOAuthCredential({ apiKey: "testkey", secret: "testsecret", provider: "zai" });
  const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
    await (input as Request).text();
    return upstreamAnswer(init?.signal ?? undefined);
  }) as typeof fetch;
  server = await startServer({ config: makeConfig(), auth, fetchImpl });
  // The request rows (printRow) go to console.log; keep them for the stats assertions.
  logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => { rows.push(args.map(String).join(" ")); });
});

const sockets = new Set<net.Socket>();

afterAll(async () => {
  logSpy.mockRestore();
  // A failed test can leave its paused client open; the server closes only without connections.
  for (const s of sockets) s.destroy();
  await server.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the upstream's pulled count has not moved for `quietMs` (or `maxMs` passed). */
async function settled(u: Upstream, quietMs = 400, maxMs = 6000): Promise<number> {
  const t0 = Date.now();
  let last = -1;
  let since = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (u.pulled !== last) { last = u.pulled; since = Date.now(); }
    else if (Date.now() - since >= quietMs) break;
    await sleep(25);
  }
  return u.pulled;
}

/** A raw HTTP/1.1 client: it reads the response head, then stops reading until told to resume. */
function stallingClient(path: string, body: string) {
  const sock = net.connect(server.port, "127.0.0.1");
  sockets.add(sock);
  const chunks: Buffer[] = [];
  let ended = false;
  const headSeen = new Promise<void>((resolve) => {
    sock.once("data", (b: Buffer) => { chunks.push(b); sock.pause(); resolve(); });
  });
  sock.on("connect", () => {
    sock.write(`POST ${path} HTTP/1.1\r\nhost: 127.0.0.1:${server.port}\r\nauthorization: Bearer ${KEY}\r\ncontent-type: application/json\r\naccept-encoding: identity\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
  });
  sock.on("error", () => {});
  const done = new Promise<void>((resolve) => { sock.on("close", () => { ended = true; resolve(); }); });
  return {
    headSeen,
    async readToEnd(): Promise<Buffer> {
      sock.on("data", (b: Buffer) => chunks.push(b));
      sock.resume();
      await done;
      return Buffer.concat(chunks);
    },
    destroy() { sock.destroy(); },
    get ended() { return ended; },
  };
}

/** The body of a chunked HTTP/1.1 response, de-chunked. */
function dechunk(raw: Buffer): { head: string; body: Buffer } {
  const split = raw.indexOf("\r\n\r\n");
  const head = raw.subarray(0, split).toString("latin1");
  expect(head).toMatch(/^HTTP\/1\.1 200/);
  expect(head.toLowerCase()).toContain("transfer-encoding: chunked");
  const parts: Buffer[] = [];
  let at = split + 4;
  for (;;) {
    const eol = raw.indexOf("\r\n", at);
    const size = parseInt(raw.subarray(at, eol).toString("latin1"), 16);
    if (size === 0) break;
    parts.push(raw.subarray(eol + 2, eol + 2 + size));
    at = eol + 2 + size + 2;
  }
  return { head, body: Buffer.concat(parts) };
}

/** The sizes of the HTTP/1.1 chunks of a raw response (each one write of the proxy). */
function chunkSizes(raw: Buffer): number[] {
  const sizes: number[] = [];
  let at = raw.indexOf("\r\n\r\n") + 4;
  for (;;) {
    const eol = raw.indexOf("\r\n", at);
    const size = parseInt(raw.subarray(at, eol).toString("latin1"), 16);
    if (size === 0) break;
    sizes.push(size);
    at = eol + 2 + size + 2;
  }
  return sizes;
}

const MESSAGES = JSON.stringify({ model: "glm-5.3", max_tokens: 64, stream: true, messages: [{ role: "user", content: "long answer" }] });
const CHAT = JSON.stringify({ model: "glm-5.3", stream: true, messages: [{ role: "user", content: "long answer" }] });

describe("a streaming client's reads pace the upstream (ticket 61)", () => {
  it("messages: a client that stops reading holds the upstream back, and gets the whole answer, in order, when it reads again", async () => {
    const before = upstreams.length;
    const client = stallingClient("/v1/messages", MESSAGES);
    await client.headSeen;
    while (upstreams.length === before) await sleep(10);
    const u = upstreams[before];
    const heldAt = await settled(u);
    expect(heldAt).toBeLessThan(HELD_BACK_MAX);

    const firstRow = rows.length;
    const { body } = dechunk(await client.readToEnd());
    expect(body.byteLength).toBe(ANSWER_BYTES);
    expect(createHash("sha256").update(body).digest("hex")).toBe(answerSha());
    // The request row is printed once the stream ends, with the stream's usage total.
    for (let i = 0; i < 100 && !rows.slice(firstRow).some((r) => r.includes(" ANT ")); i++) await sleep(10);
    const row = rows.slice(firstRow).filter((r) => r.includes(" ANT "));
    expect(row.length).toBe(1);
    expect(row[0]).toMatch(/\| ANT \| glm-5\.3\s+\| stream \|  200 \|\s+\d+ms \|\s+3007 \|/);
  }, 60_000);

  it("messages: a client that goes away while it stalls releases the upstream, and its row is printed once", async () => {
    const before = upstreams.length;
    const firstRow = rows.length;
    const client = stallingClient("/v1/messages", MESSAGES);
    await client.headSeen;
    while (upstreams.length === before) await sleep(10);
    const u = upstreams[before];
    await settled(u);
    client.destroy();
    for (let i = 0; i < 200 && !u.released; i++) await sleep(10);
    expect(u.released).toBe(true);
    const pulledAtEnd = await settled(u, 300, 3000);
    expect(pulledAtEnd).toBeLessThan(HELD_BACK_MAX);
    await sleep(100);
    expect(rows.slice(firstRow).filter((r) => r.includes(" ANT ")).length).toBe(1);
  }, 60_000);

  it("messages: a large upstream chunk is written to the client in pieces of at most 64 KiB (a stalled client holds at most one in the proxy), bytes unchanged", async () => {
    // A late read of a fetch body returns what accumulated meanwhile, often
    // hundreds of KB at once; written whole, a stalled client's socket keeps
    // all of it in the proxy's write buffer (linux RSS +14 MB).
    const frames = [...HEAD, ...Array<Uint8Array>(160).fill(DELTA), ...TAIL];
    const big = Buffer.concat(frames);
    oneChunk = big;
    try {
      const before = upstreams.length;
      const client = stallingClient("/v1/messages", MESSAGES);
      await client.headSeen;
      const raw = await client.readToEnd();
      expect(upstreams.length).toBe(before + 1);
      expect(Math.max(...chunkSizes(raw))).toBeLessThanOrEqual(64 * 1024);
      const { body } = dechunk(raw);
      expect(body.byteLength).toBe(big.byteLength);
      expect(Buffer.compare(body, big)).toBe(0);
    } finally {
      oneChunk = null;
    }
  }, 60_000);

  it("messages, at the handler: a large upstream chunk leaves the response-body module in pieces, so the terminal-frame guard never copies it whole", async () => {
    // The socket writer splits writes as well; this pins the earlier bound,
    // which keeps the guard's frame buffer and decoders at piece size.
    const big = Buffer.concat([...HEAD, ...Array<Uint8Array>(160).fill(DELTA), ...TAIL]);
    const fetchImpl = (async (input: Request | string | URL) => {
      await (input as Request).text();
      return new Response(new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(big)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const auth = new AuthManager();
    auth.setOAuthCredential({ apiKey: "testkey", secret: "testsecret", provider: "zai" });
    const clientReq = new Request("http://127.0.0.1/v1/messages", { method: "POST", headers: { "content-type": "application/json" }, body: MESSAGES });
    const resp = await proxyRequest(clientReq, "anthropic", { config: makeConfig(), auth, fetchImpl });
    const reader = resp.body!.getReader();
    const sizes: number[] = [];
    const parts: Uint8Array[] = [];
    for (;;) { const r = await reader.read(); if (r.done) break; sizes.push(r.value.byteLength); parts.push(r.value); }
    // A piece, plus at most the unfinished frame the guard carried over from the last one.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(64 * 1024 + DELTA.byteLength);
    expect(Buffer.compare(Buffer.concat(parts), big)).toBe(0);
  }, 60_000);

  it("chat (translated): a client that stops reading holds the upstream back, and gets the whole translated answer when it reads again", async () => {
    const before = upstreams.length;
    const client = stallingClient("/v1/chat/completions", CHAT);
    await client.headSeen;
    while (upstreams.length === before) await sleep(10);
    const u = upstreams[before];
    const heldAt = await settled(u);
    expect(heldAt).toBeLessThan(HELD_BACK_MAX);

    const { body } = dechunk(await client.readToEnd());
    const data = body.toString("utf8").split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6));
    expect(data.at(-1)).toBe("[DONE]");
    const text = data.slice(0, -1).map((d) => JSON.parse(d).choices?.[0]?.delta?.content ?? "").join("");
    expect(text.length).toBe(DELTAS * TEXT.length);
    expect(text).toBe(TEXT.repeat(DELTAS));
    expect(u.pulled).toBe(ANSWER_BYTES);
  }, 60_000);
});

/** The table row's cells: #, Time, Fmt, Model, Mode, Stat, TTFB, Tok, tok/s, Total. */
function rowCells(row: string): string[] {
  return row.split("|").slice(1, -1).map((cell) => cell.trim());
}

/** The request rows of `tag` printed since `from`, once the first has appeared and nothing more follows for a moment. */
async function rowsSince(from: number, tag: "ANT" | "OAI", maxMs = 10_000): Promise<string[]> {
  const mine = (): string[] => rows.slice(from).filter((r) => r.includes(`| ${tag} |`));
  for (const t0 = Date.now(); Date.now() - t0 < maxMs && mine().length === 0;) await sleep(10);
  await sleep(300);
  return mine();
}

/**
 * The Tok a row must show for `text` as delivered: the upstream's usage total
 * when a usage event is among the delivered events, otherwise the counted
 * text deltas (correction 6).
 */
function tokOf(text: string): string {
  let tokens = 0;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
    const j = JSON.parse(line.slice(5).trim());
    if (j.usage?.completion_tokens) tokens = j.usage.completion_tokens;
    else if (j.usage?.output_tokens) tokens = j.usage.output_tokens;
    else if (typeof j.choices?.[0]?.delta?.content === "string" && j.choices[0].delta.content.length > 0) tokens++;
    else if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text.length > 0) tokens++;
  }
  return tokens > 0 ? String(tokens) : "-";
}

/** The number of text deltas among the events in `text` (either wire format). */
function deltasIn(text: string): number {
  return text.split("\n").filter((l) => l.startsWith("data:") && (l.includes("\"text_delta\"") || l.includes("\"content\":\"y"))).length;
}

describe("the request row of a client that is slower than its upstream (ticket 61, round 31 Q2 condition 5)", () => {
  /** Longer than the tip's stats branch takes to read the whole 48 MB answer at upstream speed. */
  const PAUSE_MS = 3000;

  for (const [route, path, body, tag] of [["messages", "/v1/messages", MESSAGES, "ANT"], ["chat (translated)", "/v1/chat/completions", CHAT, "OAI"]] as const) {
    it(`(b) ${route}: a client that pauses ${PAUSE_MS} ms mid-stream gets a row whose Total is at least the pause`, async () => {
      const firstRow = rows.length;
      const client = stallingClient(path, body);
      await client.headSeen;
      const pausedAt = Date.now();
      await sleep(PAUSE_MS);
      const paused = Date.now() - pausedAt;
      await client.readToEnd();
      const mine = await rowsSince(firstRow, tag);
      expect(mine.length).toBe(1);
      const total = rowCells(mine[0])[9];
      expect(total).toMatch(/^\d+ms$/);
      expect(Number.parseInt(total, 10)).toBeGreaterThanOrEqual(paused);
    }, 60_000);
  }

  for (const [route, format, path, body, tag] of [["messages", "anthropic", "/v1/messages", MESSAGES, "ANT"], ["chat (translated)", "openai", "/v1/chat/completions", CHAT, "OAI"]] as const) {
    it(`(c) ${route}: a client that leaves early gets one row, and its Tok is that of the events delivered before the cancel, never more`, async () => {
      // At the handler, where "delivered" is exact: the bytes the response
      // body handed to its reader (what the server writes to the socket).
      const fetchImpl = (async (input: Request | string | URL, init?: RequestInit) => {
        await (input as Request).text();
        return upstreamAnswer(init?.signal ?? undefined);
      }) as typeof fetch;
      const auth = new AuthManager();
      auth.setOAuthCredential({ apiKey: "testkey", secret: "testsecret", provider: "zai" });
      const firstRow = rows.length;
      const clientReq = new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { "content-type": "application/json" }, body });
      const resp = await proxyRequest(clientReq, format, { config: makeConfig(), auth, fetchImpl });
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let delivered = "";
      while (deltasIn(delivered) < 5) {
        const r = await reader.read();
        if (r.done) break;
        delivered += decoder.decode(r.value, { stream: true });
      }
      // Let any read-ahead inside the proxy finish before the client leaves: a
      // stage that reads before it is asked would count events not delivered.
      await sleep(300);
      await reader.cancel();
      const mine = await rowsSince(firstRow, tag);
      expect(mine.length).toBe(1);
      expect(deltasIn(delivered)).toBeGreaterThanOrEqual(5);
      // Only whole events count as delivered (an unfinished last line is not one).
      expect(rowCells(mine[0])[7]).toBe(tokOf(delivered.slice(0, delivered.lastIndexOf("\n") + 1)));
    }, 60_000);
  }
});
