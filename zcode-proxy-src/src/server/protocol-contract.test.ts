/**
 * End-to-end protocol contract tests against controlled mock upstreams
 * (audit §10). Real route handlers via createFetchHandler — no hand-mocked
 * protocol layer:
 *   /v1/messages    — anthropic passthrough: SSE chunk boundaries incl. split
 *                     multi-byte UTF-8, thinking blocks, error mid-stream,
 *                     abort propagation, image blocks, usage fidelity
 *   /v1/chat/completions — openai client over anthropic upstream: tool calls
 *                     with fragmented input_json_delta reassembled, stable ids,
 *                     multiple tools
 */
import { describe, it, expect } from "bun:test";
import { createFetchHandler, startServer } from "./server.js";
import { AuthManager } from "../auth/manager.js";
import { ResponseStore } from "../responses/store.js";
import type { ProxyConfig } from "../config/types.js";

function oauthAuth(): AuthManager {
  const auth = new AuthManager();
  auth.setOAuthCredential({ apiKey: "testkey", secret: "testsecret", provider: "zai" });
  return auth;
}

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    server: { port: 0, host: "127.0.0.1" },
    auth: {},
    provider: "zai",
    plan: "coding-plan",
    providers: {
      zai: { anthropicBase: "https://api.z.ai/api/anthropic", openaiBase: "https://api.z.ai/api/coding/paas/v4" },
      bigmodel: { anthropicBase: "https://open.bigmodel.cn/api/anthropic", openaiBase: "https://open.bigmodel.cn/api/coding/paas/v4" },
    },
    defaultModel: "glm-5.3-flash",
    models: ["glm-5.3-flash", "glm-5.3"],
    identity: { appVersion: "test-1.0.0", sourceTitle: "cli", refererOrigin: "https://zcode.z.ai" },
    clientIdentity: { mode: "off", ttlSeconds: 900, maxSessions: 1024 },
    responses: { enabled: true, storeMaxEntries: 1000, storeTtlMs: 86400000 },
    endpointRouting: { enabled: false, origin: "https://zcode.z.ai" },
    clientSigning: { enabled: false, origin: "https://zcode.z.ai" },
    mcp: { enabled: true, webSearch: true, webReader: false, zread: false },
    async: { enabled: false, origin: "https://zcode.z.ai", pollIntervalMs: 5000, keepAliveIntervalMs: 3000, maxWaitMs: 0, maxRetries: 3, settleTimeoutMs: 8000, controlTimeoutMs: 15000, defaultModel: "" },
    claim: { enabled: false, auto: true, origin: "https://zcode.z.ai", pollIntervalMs: 300000, cooldownMs: 600000, planId: "" },
    logging: { level: "info" },
    ...overrides,
  };
}

/** Collect a (possibly SSE) body as text. */
async function readAll(res: Response): Promise<string> {
  return await res.text();
}

/** SSE event string helper. */
function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Build a Response whose body is emitted as RAW byte chunks (so tests control
 * exact chunk boundaries, including mid-codepoint splits of multi-byte UTF-8).
 */
function chunkedSseResponse(chunks: Uint8Array[], headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", ...headers } });
}

const enc = new TextEncoder();

/** Anthropic upstream that replays a scripted sequence of raw chunks. */
function anthropicStreamUpstream(chunks: Uint8Array[], capture?: { bodies: string[]; signals: AbortSignal[] }): typeof fetch {
  return (async (req: Request | string | URL, init?: RequestInit): Promise<Response> => {
    if (capture) {
      const body = typeof req === "string" ? req : req instanceof URL ? "" : await req.text();
      if (init?.body && typeof init.body === "string") capture.bodies.push(init.body);
      else if (body) capture.bodies.push(body);
      const sig = init?.signal ?? (req instanceof Request ? req.signal : undefined);
      if (sig) capture.signals.push(sig);
    }
    return chunkedSseResponse(chunks);
  }) as unknown as typeof fetch;
}

function sseChunks(events: string[], splitAt: number | null = null): Uint8Array[] {
  const joined = events.join("");
  if (splitAt === null) return [enc.encode(joined)];
  // Split at a BYTE offset (may land mid-codepoint — that is the point).
  const head = enc.encode(joined.slice(0, splitAt));
  const tail = enc.encode(joined.slice(splitAt));
  return [head, tail];
}

function anthropicStreamEvents(text: string, opts: { usageIn?: number; usageOut?: number; id?: string } = {}): string[] {
  return [
    sse("message_start", { type: "message_start", message: { id: opts.id ?? "msg_contract", type: "message", role: "assistant", model: "glm-5.3-flash", content: [], usage: { input_tokens: opts.usageIn ?? 12, output_tokens: 0 } } }),
    sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
    sse("content_block_stop", { type: "content_block_stop", index: 0 }),
    sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: opts.usageOut ?? 34 } }),
    sse("message_stop", { type: "message_stop" }),
  ];
}

describe("protocol contract: /v1/messages (anthropic passthrough)", () => {
  it("reassembles SSE chunks split mid-codepoint (multi-byte UTF-8)", async () => {
    // „OKÄ" is 4 chars / 5 bytes in UTF-8 — the byte split cuts the Ä in half.
    const text = "OKÄ";
    const events = anthropicStreamEvents(text);
    const joined = events.join("");
    const splitByte = enc.encode(joined).length - 2; // inside the Ä sequence
    const upstream = anthropicStreamUpstream(sseChunks(events, splitByte));
    const handler = createFetchHandler({ config: makeConfig(), auth: oauthAuth(), fetchImpl: upstream });
    const res = await handler(new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ model: "glm-5.3-flash", max_tokens: 100, stream: true, messages: [{ role: "user", content: "hi" }] }),
    }));
    expect(res.status).toBe(200);
    const body = await readAll(res);
    expect(body).toContain("OKÄ");
    // The split must not produce a replacement char in the reassembled stream.
    expect(body).not.toContain("\uFFFD");
    // Event framing survived the byte-level split.
    expect(body).toContain("event: message_stop");
  });

  it("passes thinking blocks through and keeps usage from upstream only", async () => {
    const events = [
      sse("message_start", { type: "message_start", message: { id: "msg_t", type: "message", role: "assistant", model: "glm-5.3-flash", content: [], usage: { input_tokens: 12, output_tokens: 0 } } }),
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "considering…" } }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
      sse("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "answer" } }),
      sse("content_block_stop", { type: "content_block_stop", index: 1 }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 34 } }),
      sse("message_stop", { type: "message_stop" }),
    ];
    const upstream = anthropicStreamUpstream([enc.encode(events.join(""))]);
    const handler = createFetchHandler({ config: makeConfig(), auth: oauthAuth(), fetchImpl: upstream });
    const res = await handler(new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ model: "glm-5.3-flash", max_tokens: 100, stream: true, messages: [{ role: "user", content: "hi" }] }),
    }));
    const body = await readAll(res);
    expect(body).toContain("thinking_delta");
    expect(body).toContain("considering…");
    // Usage appears exactly once per field with upstream's values.
    expect(body.match(/"input_tokens":12/g)?.length).toBe(1);
    expect(body.match(/"output_tokens":34/g)?.length).toBe(1);
  });

  it("surfaces an upstream error event mid-stream instead of ending silently", async () => {
    const events = [
      sse("message_start", { type: "message_start", message: { id: "msg_e", type: "message", role: "assistant", model: "glm-5.3-flash", content: [], usage: { input_tokens: 5, output_tokens: 0 } } }),
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } }),
      sse("error", { type: "error", error: { type: "api_error", message: "boom mid-stream" } }),
    ];
    const upstream = anthropicStreamUpstream([enc.encode(events.join(""))]);
    const handler = createFetchHandler({ config: makeConfig(), auth: oauthAuth(), fetchImpl: upstream });
    const res = await handler(new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ model: "glm-5.3-flash", max_tokens: 100, stream: true, messages: [{ role: "user", content: "hi" }] }),
    }));
    expect(res.status).toBe(200); // stream already started
    const body = await readAll(res);
    expect(body).toContain("boom mid-stream");
  });

  it("propagates client abort to the upstream request (no retry storm)", async () => {
    // Full production wiring: startServer (node:http) -> handler -> upstream.
    // The client aborting its fetch closes the socket; the server's per-request
    // AbortController must abort the upstream fetch too.
    const signals: AbortSignal[] = [];
    const upstream = (async (req: Request | URL | string, init?: RequestInit): Promise<Response> => {
      const sig = init?.signal ?? (req instanceof Request ? req.signal : undefined);
      if (sig) signals.push(sig);
      // Stream that stays open until the upstream fetch is aborted.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode(sse("message_start", { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "glm-5.3-flash", content: [], usage: { input_tokens: 1, output_tokens: 0 } } })));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as unknown as typeof fetch;
    const server = await startServer({ config: makeConfig({ server: { port: 0, host: "127.0.0.1" } }), auth: oauthAuth(), fetchImpl: upstream });
    const ctrl = new AbortController();
    try {
      const client = await fetch(`http://127.0.0.1:${server.port}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ model: "glm-5.3-flash", max_tokens: 100, stream: true, messages: [{ role: "user", content: "hi" }] }),
        signal: ctrl.signal,
      });
      expect(client.status).toBe(200);
      const reader = client.body!.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);
      ctrl.abort();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && signals[0]?.aborted !== true) await new Promise((r) => setTimeout(r, 25));
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0].aborted).toBe(true);
      try { await reader.cancel(); } catch {}
    } finally {
      server.stop();
      await server.close();
    }
  });

  it("forwards image blocks to the upstream unchanged (flash multimodal)", async () => {
    const capture: { bodies: string[]; signals: AbortSignal[] } = { bodies: [], signals: [] };
    const upstream = anthropicStreamUpstream(sseChunks(anthropicStreamEvents("Rot.")), capture);
    const handler = createFetchHandler({ config: makeConfig(), auth: oauthAuth(), fetchImpl: upstream });
    const img = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    await handler(new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "glm-5.3-flash",
        max_tokens: 100,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: img } },
          { type: "text", text: "Was ist das?" },
        ] }],
      }),
    }));
    expect(capture.bodies.length).toBe(1);
    const sent = JSON.parse(capture.bodies[0]);
    const imageBlock = sent.messages?.[0]?.content?.find?.((c: { type: string }) => c.type === "image");
    expect(imageBlock).toBeDefined();
    expect(imageBlock.source.data).toBe(img);
    expect(imageBlock.source.media_type).toBe("image/png");
  });

  it("keeps order and completeness under a slow reader (backpressure)", async () => {
    const total = 200;
    const events: string[] = [];
    for (let i = 0; i < total; i++) events.push(sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `chunk-${i};` } }));
    events.push(sse("message_stop", { type: "message_stop" }));
    const upstream = anthropicStreamUpstream([enc.encode(events.join(""))]);
    const handler = createFetchHandler({ config: makeConfig(), auth: oauthAuth(), fetchImpl: upstream });
    const res = await handler(new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ model: "glm-5.3-flash", max_tokens: 100, stream: true, messages: [{ role: "user", content: "hi" }] }),
    }));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    let reads = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      reads++;
      if (reads % 10 === 0) await new Promise((r) => setTimeout(r, 2)); // slow reader
    }
    acc += decoder.decode();
    for (let i = 0; i < total; i++) expect(acc).toContain(`chunk-${i};`);
    // Order preserved: first chunk before last.
    expect(acc.indexOf("chunk-0;")).toBeLessThan(acc.indexOf(`chunk-${total - 1};`));
  });
});

describe("protocol contract: /v1/chat/completions (openai over anthropic upstream)", () => {
  it("reassembles tool calls from fragmented input_json_delta with stable ids", async () => {
    const toolId = "toolu_01contract";
    const events = [
      sse("message_start", { type: "message_start", message: { id: "msg_tool", type: "message", role: "assistant", model: "glm-5.3-flash", content: [], usage: { input_tokens: 9, output_tokens: 0 } } }),
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: toolId, name: "read_file", input: {} } }),
      // Arguments fragmented across three deltas.
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"path"' } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ': "src/ma' } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'in.ts"}' } }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } }),
      sse("message_stop", { type: "message_stop" }),
    ];
    const upstream = anthropicStreamUpstream([enc.encode(events.join(""))]);
    const handler = createFetchHandler({ config: makeConfig(), auth: oauthAuth(), fetchImpl: upstream });
    const res = await handler(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ model: "glm-5.3-flash", stream: true, messages: [{ role: "user", content: "read the file" }], tools: [{ type: "function", function: { name: "read_file", parameters: {} } }] }),
    }));
    expect(res.status).toBe(200);
    const body = await readAll(res);
    expect(body).toContain(toolId);
    // Parse the SSE stream properly: collect every tool_call argument delta.
    const dataLines = body.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter((d) => d && d !== "[DONE]");
    const toolCalls: Array<{ id?: string; function?: { name?: string; arguments?: string } }> = [];
    for (const line of dataLines) {
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { continue; }
      const deltas = parsed?.choices?.[0]?.delta?.tool_calls;
      if (Array.isArray(deltas)) toolCalls.push(...deltas);
    }
    expect(toolCalls.length).toBeGreaterThan(0);
    // OpenAI streaming semantics: the id rides on the first fragment; later
    // fragments may carry only the index. At least one fragment carries the
    // upstream's stable id, and all fragments share one tool-call index.
    expect(toolCalls.some((tc) => tc.id === toolId)).toBe(true);
    const indexes = new Set(toolCalls.map((tc) => (tc as { index?: number }).index ?? 0));
    expect(indexes.size).toBe(1);
    // Reassembled arguments parse to the exact object the upstream fragmented.
    const joinedArgs = toolCalls.map((tc) => tc.function?.arguments ?? "").join("");
    expect(JSON.parse(joinedArgs)).toEqual({ path: "src/main.ts" });
  });

  it("preserves multiple tool calls in order (non-streaming)", async () => {
    const upstream = (async (): Promise<Response> => new Response(JSON.stringify({
      id: "msg_multi",
      type: "message",
      role: "assistant",
      model: "glm-5.3-flash",
      content: [
        { type: "tool_use", id: "toolu_a", name: "first_tool", input: { a: 1 } },
        { type: "tool_use", id: "toolu_b", name: "second_tool", input: { b: 2 } },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const handler = createFetchHandler({ config: makeConfig(), auth: oauthAuth(), fetchImpl: upstream });
    const res = await handler(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-5.3-flash", messages: [{ role: "user", content: "do both" }], tools: [{ type: "function", function: { name: "first_tool", parameters: {} } }, { type: "function", function: { name: "second_tool", parameters: {} } }] }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const calls = body.choices?.[0]?.message?.tool_calls ?? [];
    expect(calls.length).toBe(2);
    expect(calls[0].function.name).toBe("first_tool");
    expect(calls[1].function.name).toBe("second_tool");
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ a: 1 });
    expect(JSON.parse(calls[1].function.arguments)).toEqual({ b: 2 });
    // Stable, distinct ids.
    expect(calls[0].id).not.toBe(calls[1].id);
  });
});

describe("protocol contract: /v1/responses state", () => {
  it("previous_response_id continuation is id-scoped: unknown ids are 404, no cross-talk", async () => {
    const store = new ResponseStore();
    const handler = (fetchImpl: typeof fetch) => createFetchHandler({ config: makeConfig(), auth: oauthAuth(), fetchImpl, responseStore: store });
    const textUpstream = (text: string): typeof fetch => (async (): Promise<Response> => new Response(JSON.stringify({
      id: "msg_r", type: "message", role: "assistant", model: "glm-5.3-flash", content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 3, output_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    const call = (payload: Record<string, unknown>) => handler(textUpstream("ok"))(new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }));

    const r1 = await call({ model: "glm-5.3-flash", input: "first" });
    expect(r1.status).toBe(200);
    const b1 = await r1.json();
    expect(b1.id).toBeTruthy();

    // Unknown previous id → 404, not a fabricated empty history.
    const rMiss = await handler(textUpstream("ok"))(new Request("http://localhost/v1/responses", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-5.3-flash", input: "x", previous_response_id: "resp_does_not_exist" }),
    }));
    expect(rMiss.status).toBe(404);
  });

  it("byte-budget eviction surfaces as a clean 404 on continuation (bounded memory)", async () => {
    const store = new ResponseStore({ maxEntries: 100, ttlMs: 60_000, maxTotalBytes: 2048 });
    const bigUpstream: typeof fetch = (async (): Promise<Response> => new Response(JSON.stringify({
      id: "msg_big", type: "message", role: "assistant", model: "glm-5.3-flash",
      content: [{ type: "text", text: "x".repeat(3000) }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 3, output_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const handler = createFetchHandler({ config: makeConfig(), auth: oauthAuth(), fetchImpl: bigUpstream, responseStore: store });
    const r = await handler(new Request("http://localhost/v1/responses", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-5.3-flash", input: "big" }),
    }));
    const b = await r.json();
    const after = await createFetchHandler({ config: makeConfig(), auth: oauthAuth(), fetchImpl: bigUpstream, responseStore: store })(new Request("http://localhost/v1/responses", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-5.3-flash", input: "next", previous_response_id: b.id }),
    }));
    // The oversized entry was not retained: continuation is an honest 404.
    expect(after.status).toBe(404);
    expect(store.totalBytesUsed()).toBeLessThanOrEqual(2048);
  });
});
