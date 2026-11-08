/**
 * Protocol contract: the bytes the proxy sends upstream (seam 4, ticket 20).
 *
 * A real proxy on a loopback listener forwards representative client requests
 * to a mock upstream on another loopback listener, which records every request
 * exactly as it arrived on the wire: method, path, header pairs in order, and
 * the body bytes. The records are compared with a fixture captured on the tree
 * BEFORE ticket 20 removed the redundant request-body copies (integration tip
 * e88821f), so any change to the bytes sent upstream fails here.
 *
 * Covered: all five body endpoints (/v1/messages, /v1/chat/completions,
 * /v1/responses, /async/v1/messages, /async/v1/chat/completions), streaming and
 * non-streaming, tool calls and tool results, images, the effort/thinking
 * normalisation, unicode and number edge cases, a body the transforms leave
 * unmodified (forwarded verbatim), gzip and chunked request bodies, invalid
 * UTF-8 and a BOM, a multi-megabyte multi-byte body, and the client-session
 * modes (off, observe with explicit and inferred sessions, enforce, which takes
 * the ordered transport).
 *
 * Volatile values are normalised before the comparison, by first appearance
 * within a case: random UUIDs (trace headers) and the inferred `ses_…` session
 * ids. Equal values stay equal, so a lineage decision (turn 2 continues turn
 * 1's session) is still pinned. The identity headers that describe the machine
 * running the test (OS, locale, time zone) are masked, and `date`/`host` are
 * dropped, so the fixture holds on every CI leg.
 *
 * The fixture is (re)written only with UPDATE_SNAPSHOTS=1, like every snapshot.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { startServer, type ProxyServer } from "./server.js";
import { AuthManager } from "../auth/manager.js";
import { ResponseStore } from "../responses/store.js";
import type { ProxyConfig } from "../config/types.js";

const FIXTURE = join(import.meta.dir, "__fixtures__", "upstream-bytes.json");
const PROXY_KEY = "capture-proxy-key-0123456789abcdef";
const DEVICE_MID = "0b6f8d1e-5a77-4c3e-9e21-capturemid01";

interface Captured {
  method: string;
  path: string;
  headers: [string, string][];
  bodyBytes: Buffer;
}

interface CaseRecord {
  status: number[];
  upstream: { method: string; path: string; headers: [string, string][]; length: number; sha256: string; body?: string }[];
}

// ── mock upstream ───────────────────────────────────────────────────────────

const captured: Captured[] = [];
let upstream: Server;
let upstreamUrl = "";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function anthropicStream(model: string): string {
  return [
    sse("message_start", { type: "message_start", message: { id: "msg_capture", type: "message", role: "assistant", model, content: [], usage: { input_tokens: 3, output_tokens: 0 } } }),
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } }),
    sse("message_stop", { type: "message_stop" }),
  ].join("");
}

function anthropicMessage(model: string): string {
  return JSON.stringify({ id: "msg_capture", type: "message", role: "assistant", model, content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 3, output_tokens: 1 } });
}

function envelope(data: unknown): string {
  return JSON.stringify({ code: 0, msg: "ok", data });
}

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function rawPairs(req: IncomingMessage): [string, string][] {
  const pairs: [string, string][] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) pairs.push([req.rawHeaders[i].toLowerCase(), req.rawHeaders[i + 1]]);
  return pairs;
}

function startUpstream(): Promise<void> {
  upstream = createServer(async (req, res) => {
    const bodyBytes = await readRaw(req);
    const path = req.url ?? "/";
    const offPeakControl = path.startsWith("/api/v1/off-peak/ticket");
    if (!offPeakControl) captured.push({ method: req.method ?? "", path, headers: rawPairs(req), bodyBytes });
    if (path === "/api/v1/off-peak/ticket/availability") {
      res.writeHead(200, { "content-type": "application/json" }).end(envelope({ can_take_number: true }));
      return;
    }
    if (path === "/api/v1/off-peak/ticket") {
      res.writeHead(200, { "content-type": "application/json" }).end(envelope({ ticket_id: "t-capture", state: "ready" }));
      return;
    }
    if (path === "/api/v1/off-peak/ticket/status") {
      res.writeHead(200, { "content-type": "application/json" }).end(envelope({ next_poll_after: 0.01, tickets: [{ ticket_id: "t-capture", state: "ready" }] }));
      return;
    }
    if (offPeakControl) {
      res.writeHead(200).end();
      return;
    }
    let parsed: { stream?: unknown; model?: unknown } = {};
    try { parsed = JSON.parse(bodyBytes.toString("utf8")); } catch {}
    const model = typeof parsed.model === "string" ? parsed.model : "glm-5.3";
    if (parsed.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream" }).end(anthropicStream(model));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }).end(anthropicMessage(model));
  });
  return new Promise((resolve) => upstream.listen(0, "127.0.0.1", () => {
    const addr = upstream.address();
    upstreamUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    resolve();
  }));
}

// ── proxies under test ──────────────────────────────────────────────────────

type Profile = "off" | "observe" | "enforce";

function config(profile: Profile): ProxyConfig {
  return {
    server: { port: 0, host: "127.0.0.1" },
    auth: { proxyApiKey: PROXY_KEY },
    provider: "zai",
    plan: "coding-plan",
    providers: {
      zai: { anthropicBase: `${upstreamUrl}/api/anthropic`, openaiBase: `${upstreamUrl}/api/coding/paas/v4` },
      bigmodel: { anthropicBase: `${upstreamUrl}/api/anthropic`, openaiBase: `${upstreamUrl}/api/coding/paas/v4` },
    },
    defaultModel: "glm-5.3",
    models: ["glm-5.3-flash", "glm-5.3"],
    identity: { appVersion: "test-1.0.0", sourceTitle: "cli", refererOrigin: "https://zcode.z.ai", deviceMid: DEVICE_MID },
    clientIdentity: { mode: profile, ttlSeconds: 900, maxSessions: 1024 },
    responses: { enabled: true, storeMaxEntries: 1000, storeTtlMs: 86400000 },
    endpointRouting: { enabled: false, origin: upstreamUrl },
    clientSigning: { enabled: false, origin: upstreamUrl },
    mcp: { enabled: false, webSearch: false, webReader: false, zread: false },
    async: { enabled: true, origin: upstreamUrl, pollIntervalMs: 10, keepAliveIntervalMs: 5, maxWaitMs: 0, maxRetries: 0, settleTimeoutMs: 100, controlTimeoutMs: 1000, defaultModel: "" },
    claim: { enabled: false, auto: false, origin: upstreamUrl, pollIntervalMs: 300000, cooldownMs: 600000, planId: "" },
    logging: { level: "info" },
  } as ProxyConfig;
}

function auth(): AuthManager {
  const a = new AuthManager();
  a.setOAuthCredential({ apiKey: "capturekey", secret: "capturesecret", provider: "zai", jwt: "capture.jwt.token" });
  return a;
}

const proxies = new Map<Profile, ProxyServer>();

async function proxyBase(profile: Profile): Promise<string> {
  let server = proxies.get(profile);
  if (!server) {
    server = await startServer({ config: config(profile), auth: auth(), responseStore: new ResponseStore() });
    proxies.set(profile, server);
  }
  return `http://127.0.0.1:${server.port}`;
}

// ── client requests ─────────────────────────────────────────────────────────

interface Send {
  profile?: Profile;
  path: string;
  body: string | Uint8Array | (() => ReadableStream<Uint8Array>);
  headers?: Record<string, string>;
}

/** Send one client request and drain its answer; returns the status. */
async function send(s: Send): Promise<{ status: number; text: string }> {
  const base = await proxyBase(s.profile ?? "off");
  const headers: Record<string, string> = { authorization: `Bearer ${PROXY_KEY}`, "content-type": "application/json", "accept-encoding": "identity", ...s.headers };
  const init: RequestInit & { duplex?: "half" } = { method: "POST", headers };
  if (typeof s.body === "function") {
    init.body = s.body();
    init.duplex = "half";
  } else {
    init.body = s.body;
  }
  const res = await fetch(`${base}${s.path}`, init);
  const text = await res.text();
  return { status: res.status, text };
}

/** Identity headers whose values come from the machine running the test (OS, locale, time zone). */
const HOST_DEPENDENT = new Set(["x-os-category", "x-os-version", "x-platform", "x-client-language", "x-client-timezone"]);

/** Normalise random UUIDs and inferred session ids by first appearance. */
function normaliser(): (value: string) => string {
  const seen = new Map<string, string>();
  const tag = (kind: string, v: string): string => {
    const key = `${kind}:${v}`;
    if (!seen.has(key)) seen.set(key, `<${kind}-${[...seen.keys()].filter((k) => k.startsWith(`${kind}:`)).length + 1}>`);
    return seen.get(key)!;
  };
  return (value) => value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => (m.startsWith("0b6f8d1e") ? m : tag("uuid", m)))
    .replace(/ses_[0-9a-f]{12}/g, (m) => tag("ses", m));
}

function record(statuses: number[], from: number): CaseRecord {
  const norm = normaliser();
  return {
    status: statuses,
    upstream: captured.slice(from).map((c) => {
      const text = c.bodyBytes.toString("latin1");
      const normalisedBody = norm(text);
      const bodyBuf = Buffer.from(normalisedBody, "latin1");
      return {
        method: c.method,
        path: c.path,
        headers: c.headers.filter(([k]) => k !== "date" && k !== "host").map(([k, v]) => [k, HOST_DEPENDENT.has(k) ? "<host>" : norm(v)] as [string, string]),
        length: c.bodyBytes.byteLength,
        sha256: createHash("sha256").update(bodyBuf).digest("hex"),
        ...(bodyBuf.byteLength <= 4096 ? { body: bodyBuf.toString("utf8") } : {}),
      };
    }),
  };
}

// ── representative bodies ───────────────────────────────────────────────────

const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3000, 7)]).toString("base64");
const userIdOff = JSON.stringify({ device_id: DEVICE_MID, account_uuid: "", session_id: "" });

const anthropicTools = [
  { name: "read_file", description: "Read a file", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, cache_control: { type: "ephemeral" } },
  { name: "write_file", description: "Write a file", input_schema: { type: "object", properties: { path: { type: "string" }, text: { type: "string" } } } },
];

const anthropicToolHistory = [
  { role: "user", content: [{ type: "text", text: "Read README.md", cache_control: { type: "ephemeral" } }] },
  { role: "assistant", content: [{ type: "text", text: "Reading." }, { type: "tool_use", id: "toolu_01", name: "read_file", input: { path: "README.md" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "# Title\nbody ünïcödé" }] },
];

const openaiTools = [
  { type: "function", function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
];

const openaiToolHistory = [
  { role: "system", content: "You are terse." },
  { role: "user", content: "Read README.md" },
  { role: "assistant", content: null, tool_calls: [{ id: "call_01", type: "function", function: { name: "read_file", arguments: "{\"path\":\"README.md\"}" } }] },
  { role: "tool", tool_call_id: "call_01", content: "# Title" },
];

// Raw JSON text: unicode escapes, a lone surrogate escape, U+2028, numbers
// whose text JSON.stringify changes, a duplicate key, a __proto__ key, pretty
// printing. Modified by the transforms, so it is re-serialised.
const EDGE_JSON = `{
  "model": "glm-5.3",
  "max_tokens": 64,
  "x": 1, "x": 2,
  "__proto__": { "polluted": true },
  "temperature": 1.0,
  "top_p": 0.10,
  "seed": 12345678901234567890,
  "big": 1e21, "neg0": -0, "tiny": 1E-7,
  "messages": [
    { "role": "user", "content": "caf\\u00e9 \u00e9 \\ud83d\\ude00 \ud83d\ude00 lone \\ud800 sep \\u2028 nul \\u0000 tab\\t quote\\" slash\\/" }
  ]
}`;

// Left unmodified by every transform: no messages to mark and the metadata
// user id the proxy would inject is already there. Forwarded verbatim.
const VERBATIM_JSON = `{
    "model" : "glm-5.3",
    "max_tokens" : 16,
    "messages" : [ ],
    "metadata" : { "user_id" : ${JSON.stringify(userIdOff)} }
}\n`;

function bigMultibyte(): string {
  const unit = "äöü€😀 lorem ipsum ";
  const text = unit.repeat(Math.ceil((3 * 1024 * 1024) / Buffer.byteLength(unit)));
  return JSON.stringify({ model: "glm-5.3", max_tokens: 64, messages: [{ role: "user", content: text }] });
}

function chunkedSplitBody(): () => ReadableStream<Uint8Array> {
  const bytes = Buffer.from(JSON.stringify({ model: "glm-5.3", max_tokens: 64, stream: true, messages: [{ role: "user", content: "split €€€ 😀😀 across chunks ".repeat(2000) }] }));
  return () => {
    let at = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= bytes.byteLength) { controller.close(); return; }
        const size = 1 + ((at * 7919) % 4093);
        controller.enqueue(new Uint8Array(bytes.subarray(at, at + size)));
        at += size;
      },
    });
  };
}

function invalidUtf8WithBom(): Uint8Array {
  const head = Buffer.from([0xef, 0xbb, 0xbf]);
  const json = Buffer.from(`{"model":"glm-5.3","max_tokens":8,"messages":[{"role":"user","content":"bad byte: X and a truncated euro: YY"}]}`, "latin1");
  const at = json.indexOf("X");
  json[at] = 0xff;
  const y = json.indexOf("YY");
  json[y] = 0xe2; json[y + 1] = 0x82;
  return Buffer.concat([head, json]);
}

const CASES: Record<string, Send[]> = {
  "messages: text, non-streaming": [{ path: "/v1/messages", body: JSON.stringify({ model: "glm-5.3", max_tokens: 64, messages: [{ role: "user", content: "hello" }] }) }],
  "messages: streaming with system, tools, tool use and results, stale cache_control, metadata": [{
    path: "/v1/messages",
    body: JSON.stringify({ model: "glm-5.3", max_tokens: 256, stream: true, system: "Be brief.", tools: anthropicTools, tool_choice: { type: "auto" }, metadata: { foo: "bar" }, messages: anthropicToolHistory }),
  }],
  "messages: image block, glm-5.3-flash with thinking disabled": [{
    path: "/v1/messages",
    body: JSON.stringify({ model: "glm-5.3-flash", max_tokens: 128, thinking: { type: "disabled" }, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_B64 } }, { type: "text", text: "What is this?" }] }] }),
  }],
  "messages: glm-5.3-flash with an explicit effort": [{
    path: "/v1/messages",
    body: JSON.stringify({ model: "glm-5.3-flash", max_tokens: 4096, stream: true, thinking: { type: "enabled", budget_tokens: 2048 }, output_config: { effort: "high" }, messages: [{ role: "user", content: "think" }] }),
  }],
  "messages: unicode, numbers, duplicate and __proto__ keys, pretty-printed": [{ path: "/v1/messages", body: EDGE_JSON }],
  "messages: body the transforms leave unmodified is forwarded verbatim": [{ path: "/v1/messages", body: VERBATIM_JSON }],
  "messages: gzip request body": [{
    path: "/v1/messages",
    headers: { "content-encoding": "gzip" },
    body: new Uint8Array(gzipSync(Buffer.from(JSON.stringify({ model: "glm-5.3", max_tokens: 64, messages: [{ role: "user", content: "gzipped ✓ ".repeat(500) }] })))),
  }],
  "messages: 3 MB multi-byte body": [{ path: "/v1/messages", body: bigMultibyte() }],
  "messages: chunked body without content-length, multi-byte characters split across chunks": [{ path: "/v1/messages", body: chunkedSplitBody() }],
  "messages: invalid UTF-8 and a byte order mark": [{ path: "/v1/messages", body: invalidUtf8WithBom() }],
  "chat: text, non-streaming": [{ path: "/v1/chat/completions", body: JSON.stringify({ model: "glm-5.3", messages: [{ role: "user", content: "hello" }] }) }],
  "chat: streaming with tools, tool calls and tool results": [{
    path: "/v1/chat/completions",
    body: JSON.stringify({ model: "glm-5.3", stream: true, max_tokens: 200, temperature: 0.2, tools: openaiTools, tool_choice: "auto", messages: openaiToolHistory }),
  }],
  "chat: image_url data URI": [{
    path: "/v1/chat/completions",
    body: JSON.stringify({ model: "glm-5.3-flash", messages: [{ role: "user", content: [{ type: "text", text: "What is this?" }, { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } }] }] }),
  }],
  "chat: streaming with stream_options and reasoning effort": [{
    path: "/v1/chat/completions",
    body: JSON.stringify({ model: "glm-5.3-flash", stream: true, stream_options: { include_usage: false }, reasoning_effort: "high", messages: [{ role: "user", content: "hi" }] }),
  }],
  "responses: string input, non-streaming, then a previous_response_id chain": [
    { path: "/v1/responses", body: JSON.stringify({ model: "glm-5.3", input: "first turn" }) },
    { path: "/v1/responses", body: "<previous>" },
  ],
  "responses: streaming with function tools and array input": [{
    path: "/v1/responses",
    body: JSON.stringify({ model: "glm-5.3", stream: true, instructions: "Be brief.", tools: [{ type: "function", name: "read_file", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } } } }], input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Read it" }] }, { type: "function_call", call_id: "call_9", name: "read_file", arguments: "{\"path\":\"a\"}" }, { type: "function_call_output", call_id: "call_9", output: "contents" }] }),
  }],
  "async messages: streaming and non-streaming": [
    { path: "/async/v1/messages", body: JSON.stringify({ model: "glm-5.3", max_tokens: 64, stream: true, system: [{ type: "text", text: "sys" }], messages: anthropicToolHistory, tools: anthropicTools }) },
    { path: "/async/v1/messages", body: JSON.stringify({ model: "glm-5.3", max_tokens: 64, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_B64 } }] }] }) },
  ],
  "async chat: streaming with tools, non-streaming with an image": [
    { path: "/async/v1/chat/completions", body: JSON.stringify({ model: "glm-5.3", stream: true, tools: openaiTools, messages: openaiToolHistory }) },
    { path: "/async/v1/chat/completions", body: JSON.stringify({ model: "glm-5.3-flash", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } }] }] }) },
  ],
  "observe: explicit session header (ordered transport) and body metadata session": [
    { profile: "observe", path: "/v1/messages", headers: { "x-session-id": "ses-explicit-1", "x-request-id": "req-explicit-1" }, body: JSON.stringify({ model: "glm-5.3", max_tokens: 64, messages: [{ role: "user", content: "hello" }] }) },
    { profile: "observe", path: "/v1/messages", body: JSON.stringify({ model: "glm-5.3", max_tokens: 64, metadata: { session_id: "ses-from-body", trace_id: "trace-from-body" }, messages: [{ role: "user", content: "hello" }] }) },
  ],
  "observe: inferred lineage, a continued conversation keeps its session": [
    { profile: "observe", path: "/v1/messages", body: JSON.stringify({ model: "glm-5.3", max_tokens: 64, system: "lineage-observe", messages: [{ role: "user", content: "turn one" }] }) },
    { profile: "observe", path: "/v1/messages", body: JSON.stringify({ model: "glm-5.3", max_tokens: 64, system: "lineage-observe", messages: [{ role: "user", content: "turn one" }, { role: "assistant", content: "ok" }, { role: "user", content: "turn two" }] }) },
    { profile: "observe", path: "/v1/chat/completions", body: JSON.stringify({ model: "glm-5.3", messages: [{ role: "system", content: "lineage-observe-chat" }, { role: "user", content: "other conversation" }] }) },
  ],
  "enforce: inferred lineage forwarded upstream (ordered transport)": [
    { profile: "enforce", path: "/v1/messages", body: JSON.stringify({ model: "glm-5.3", max_tokens: 64, system: "lineage-enforce", stream: true, messages: [{ role: "user", content: "turn one" }] }) },
    { profile: "enforce", path: "/v1/messages", body: JSON.stringify({ model: "glm-5.3", max_tokens: 64, system: "lineage-enforce", stream: true, messages: [{ role: "user", content: "turn one" }, { role: "assistant", content: "ok" }, { role: "user", content: "turn two" }] }) },
    { profile: "enforce", path: "/v1/chat/completions", body: JSON.stringify({ model: "glm-5.3", stream: true, messages: [{ role: "user", content: "enforced chat" }] }) },
  ],
};

// ── the contract ────────────────────────────────────────────────────────────

const update = process.env.UPDATE_SNAPSHOTS === "1";
const results: Record<string, CaseRecord> = {};
const expected: Record<string, CaseRecord> | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;

beforeAll(async () => {
  await startUpstream();
});

afterAll(async () => {
  for (const server of proxies.values()) await server.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  if (update) {
    mkdirSync(dirname(FIXTURE), { recursive: true });
    writeFileSync(FIXTURE, `${JSON.stringify(results, null, 1)}\n`);
  }
});

describe("protocol contract: bytes sent upstream are unchanged (ticket 20)", () => {
  it("the fixture exists and names every case (write it with UPDATE_SNAPSHOTS=1 on the reference tree)", () => {
    if (update) return;
    expect(expected).not.toBeNull();
    expect(Object.keys(expected!).sort()).toEqual(Object.keys(CASES).sort());
  });

  for (const [name, sends] of Object.entries(CASES)) {
    it(name, async () => {
      const from = captured.length;
      const statuses: number[] = [];
      let previousId = "";
      for (const s of sends) {
        const body = s.body === "<previous>"
          ? JSON.stringify({ model: "glm-5.3", input: "second turn", previous_response_id: previousId })
          : s.body;
        const { status, text } = await send({ ...s, body });
        statuses.push(status);
        try { previousId = JSON.parse(text).id ?? ""; } catch { previousId = ""; }
      }
      const rec = record(statuses, from);
      results[name] = rec;
      // Every send reached the upstream exactly once and was answered 200.
      expect(rec.status).toEqual(sends.map(() => 200));
      expect(rec.upstream.length).toBe(sends.length);
      if (update) return;
      expect(rec).toEqual(expected![name]);
    }, 30_000);
  }
});
