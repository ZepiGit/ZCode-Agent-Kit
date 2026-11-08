/**
 * Protocol contract: the bytes and event order a client receives for a
 * streamed answer (seam 4, ticket 61).
 *
 * A real proxy on a loopback listener answers client requests from an
 * injected upstream (no network) that streams representative SSE answers in
 * awkward chunkings: frames split across chunks, a cut stream without
 * `message_stop`, a read that fails mid-stream, a gzip-encoded stream for a
 * client that takes gzip and for one that does not, and translated OpenAI
 * chat streams with text and tool calls. The client's raw bytes (status, the
 * forwarded headers, the body as it came off the wire, still compressed if it
 * was) are compared with a fixture captured on the tree BEFORE ticket 61
 * replaced the `tee()` stats branch (integration tip 788f2fb), so any change
 * to what a client receives fails here.
 *
 * The fixture is (re)written only with UPDATE_SNAPSHOTS=1, like every snapshot.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { startServer, type ProxyServer } from "./server.js";
import { AuthManager } from "../auth/manager.js";
import type { ProxyConfig } from "../config/types.js";
import { fixtureSecret } from "../test-fixtures.js";

const FIXTURE = join(import.meta.dir, "__fixtures__", "client-response-bytes.json");
const KEY = fixtureSecret("response-bytes-proxy-key");

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A complete Anthropic stream: text, then a tool call, usage at the end. */
function anthropicFrames(texts: string[], { stop = true }: { stop?: boolean } = {}): string {
  const frames = [
    sse("message_start", { type: "message_start", message: { id: "msg_contract", type: "message", role: "assistant", model: "glm-5.3", content: [], stop_reason: null, usage: { input_tokens: 7, output_tokens: 1 } } }),
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    ...texts.map((text) => sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_c1", name: "read_file", input: {} } }),
    sse("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{\"path\":" } }),
    sse("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "\"README.md\"}" } }),
    sse("content_block_stop", { type: "content_block_stop", index: 1 }),
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: texts.length + 2 } }),
  ];
  if (stop) frames.push(sse("message_stop", { type: "message_stop" }));
  return frames.join("");
}

const TEXTS = ["Hel", "lo ", "wörld ", "😀", " ", "x".repeat(3000), " end"];

/** Split `bytes` into chunks of the given repeating sizes (frames and UTF-8 sequences cut anywhere). */
function chunked(bytes: Uint8Array, sizes: number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  for (let i = 0; at < bytes.byteLength; i++) {
    const size = sizes[i % sizes.length];
    out.push(bytes.slice(at, at + size));
    at += size;
  }
  return out;
}

interface UpstreamAnswer {
  chunks: Uint8Array[];
  headers: Record<string, string>;
  /** Fail the read after this many chunks (an upstream read error mid-stream). */
  failAfter?: number;
}

function streamOf(answer: UpstreamAnswer): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (answer.failAfter !== undefined && i >= answer.failAfter) {
        controller.error(Object.assign(new Error("upstream read failed"), { code: "ECONNRESET" }));
        return;
      }
      if (i >= answer.chunks.length) { controller.close(); return; }
      controller.enqueue(answer.chunks[i++]);
    },
  });
}

const enc = new TextEncoder();
const native = enc.encode(anthropicFrames(TEXTS));
const nativeCut = enc.encode(anthropicFrames(TEXTS, { stop: false }) + "event: content_block_delta\ndata: {\"type\":\"content_block_del");
const gz = new Uint8Array(gzipSync(native));
const SSE = { "content-type": "text/event-stream", "cache-control": "no-cache", "x-request-id": "req-contract" };

const CASES: Record<string, { path: string; acceptEncoding?: string; answer: UpstreamAnswer }> = {
  "messages: complete stream, frames and UTF-8 split across chunks": { path: "/v1/messages", answer: { chunks: chunked(native, [1, 7, 64, 333, 4096]), headers: SSE } },
  "messages: complete stream in one chunk": { path: "/v1/messages", answer: { chunks: [native], headers: SSE } },
  "messages: stream cut without message_stop, unfinished last frame": { path: "/v1/messages", answer: { chunks: chunked(nativeCut, [50, 500]), headers: SSE } },
  "messages: upstream read fails mid-stream": { path: "/v1/messages", answer: { chunks: chunked(native, [100]), headers: SSE, failAfter: 12 } },
  "messages: gzip stream, client takes gzip": { path: "/v1/messages", acceptEncoding: "gzip", answer: { chunks: chunked(gz, [9, 200]), headers: { ...SSE, "content-encoding": "gzip" } } },
  "messages: gzip stream, client does not take gzip": { path: "/v1/messages", acceptEncoding: "identity", answer: { chunks: chunked(gz, [9, 200]), headers: { ...SSE, "content-encoding": "gzip" } } },
  "chat: translated stream with text and a tool call, split across chunks": { path: "/v1/chat/completions", answer: { chunks: chunked(native, [3, 41, 777]), headers: SSE } },
  "chat: translated stream cut without message_stop": { path: "/v1/chat/completions", answer: { chunks: chunked(nativeCut, [64]), headers: SSE } },
  "chat: translated stream, upstream read fails mid-stream": { path: "/v1/chat/completions", answer: { chunks: chunked(native, [100]), headers: SSE, failAfter: 12 } },
};

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
let current: UpstreamAnswer | null = null;

beforeAll(async () => {
  const auth = new AuthManager();
  auth.setOAuthCredential({ apiKey: "testkey", secret: "testsecret", provider: "zai" });
  const fetchImpl = (async (input: Request | string | URL) => {
    await (input as Request).text();
    const answer = current!;
    return new Response(streamOf(answer), { status: 200, headers: answer.headers });
  }) as typeof fetch;
  server = await startServer({ config: makeConfig(), auth, fetchImpl });
});

afterAll(async () => {
  await server.close();
  if (update) {
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, `${JSON.stringify(results, null, 1)}\n`);
  }
});

interface ClientRecord {
  status: number;
  headers: Record<string, string>;
  length: number;
  sha256: string;
  body?: string;
  /** The client's error when the connection ended abnormally (no bytes are recorded then). */
  error?: string;
}

const FORWARDED = ["content-type", "content-encoding", "cache-control", "x-request-id"];

async function receive(path: string, acceptEncoding = "identity"): Promise<ClientRecord> {
  const body = path === "/v1/messages"
    ? JSON.stringify({ model: "glm-5.3", max_tokens: 64, stream: true, messages: [{ role: "user", content: "hi" }] })
    : JSON.stringify({ model: "glm-5.3", stream: true, messages: [{ role: "user", content: "hi" }] });
  // decompress: false keeps the bytes exactly as the proxy wrote them. A
  // connection the proxy resets is part of the contract too.
  let res: Response;
  let bytes: Uint8Array;
  try {
    res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "accept-encoding": acceptEncoding },
      body,
      decompress: false,
    } as RequestInit);
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    return { status: 0, headers: {}, length: 0, sha256: "", error: String((err as { code?: unknown }).code ?? (err as Error).name) };
  }
  const headers: Record<string, string> = {};
  for (const h of FORWARDED) {
    const v = res.headers.get(h);
    if (v !== null) headers[h] = v;
  }
  // The translated chunks carry the wall clock (`"created":<unix s>`); it is
  // the only volatile value. Normalised byte for byte (latin1 keeps every byte).
  if (headers["content-encoding"] === undefined) {
    bytes = new Uint8Array(Buffer.from(Buffer.from(bytes).toString("latin1").replace(/"created":\d+/g, "\"created\":0"), "latin1"));
  }
  return {
    status: res.status,
    headers,
    length: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...(bytes.byteLength <= 8192 && headers["content-encoding"] === undefined ? { body: new TextDecoder().decode(bytes) } : {}),
  };
}

const update = process.env.UPDATE_SNAPSHOTS === "1";
const results: Record<string, ClientRecord> = {};
const expected: Record<string, ClientRecord> | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;

describe("protocol contract: bytes a client receives for a streamed answer are unchanged (ticket 61)", () => {
  it("the fixture exists and names every case (write it with UPDATE_SNAPSHOTS=1 on the reference tree)", () => {
    if (update) return;
    expect(expected).not.toBeNull();
    expect(Object.keys(expected!).sort()).toEqual(Object.keys(CASES).sort());
  });

  for (const [name, c] of Object.entries(CASES)) {
    it(name, async () => {
      current = c.answer;
      const rec = await receive(c.path, c.acceptEncoding);
      results[name] = rec;
      if (update) return;
      expect(rec).toEqual(expected![name]);
    }, 30_000);
  }
});
