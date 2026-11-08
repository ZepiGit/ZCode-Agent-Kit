/**
 * Reading a request body into one buffer of its declared size (ticket 20).
 *
 * The handler reads a body with a Content-Length straight into a buffer of that
 * size. A Request built in-process can declare any length, so these tests send
 * bodies whose declared length is right, too small, too large, absent or zero,
 * in odd chunk sizes, and check that the text forwarded upstream is exactly
 * the client's. The body is one the transforms leave unmodified (no messages,
 * the metadata user id the proxy would inject), so the expected upstream text
 * is the client text itself. The 32 MiB wire cap must still hold when the
 * declared length is smaller than the real body.
 */
import { describe, it, expect } from "bun:test";
import { createFetchHandler } from "../server/server.js";
import { AuthManager } from "../auth/manager.js";
import type { ProxyConfig } from "../config/types.js";

const DEVICE_MID = "0b6f8d1e-5a77-4c3e-9e21-bodyreadmid1";

function config(): ProxyConfig {
  return {
    server: { port: 0, host: "127.0.0.1" },
    auth: {},
    provider: "zai",
    plan: "coding-plan",
    providers: {
      zai: { anthropicBase: "https://api.z.ai/api/anthropic", openaiBase: "https://api.z.ai/api/coding/paas/v4" },
      bigmodel: { anthropicBase: "https://open.bigmodel.cn/api/anthropic", openaiBase: "https://open.bigmodel.cn/api/coding/paas/v4" },
    },
    defaultModel: "glm-5.3",
    models: ["glm-5.3"],
    identity: { appVersion: "test-1.0.0", sourceTitle: "cli", refererOrigin: "https://zcode.z.ai", deviceMid: DEVICE_MID },
    clientIdentity: { mode: "off", ttlSeconds: 900, maxSessions: 1024 },
    responses: { enabled: false, storeMaxEntries: 1000, storeTtlMs: 86400000 },
    endpointRouting: { enabled: false, origin: "https://zcode.z.ai" },
    clientSigning: { enabled: false, origin: "https://zcode.z.ai" },
    mcp: { enabled: false, webSearch: false, webReader: false, zread: false },
    async: { enabled: false, origin: "https://zcode.z.ai", pollIntervalMs: 5000, keepAliveIntervalMs: 3000, maxWaitMs: 0, maxRetries: 3, settleTimeoutMs: 8000, controlTimeoutMs: 15000, defaultModel: "" },
    claim: { enabled: false, auto: false, origin: "https://zcode.z.ai", pollIntervalMs: 300000, cooldownMs: 600000, planId: "" },
    logging: { level: "info" },
  } as ProxyConfig;
}

function auth(): AuthManager {
  const a = new AuthManager();
  a.setOAuthCredential({ apiKey: "bodyreadkey", secret: "bodyreadsecret", provider: "zai" });
  return a;
}

/** A handler whose upstream records the body text it receives. */
function handlerWithCapture(): { handler: (req: Request) => Promise<Response>; bodies: string[] } {
  const bodies: string[] = [];
  const fetchImpl = (async (req: Request | string | URL, init?: RequestInit): Promise<Response> => {
    if (typeof init?.body === "string") bodies.push(init.body);
    else if (req instanceof Request) bodies.push(await req.text());
    return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "glm-5.3", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { handler: createFetchHandler({ config: config(), auth: auth(), fetchImpl }), bodies };
}

/** Unmodified by every transform; padded with multi-byte text in a field the proxy ignores. */
function verbatimBody(padChars: number): string {
  const userId = JSON.stringify({ device_id: DEVICE_MID, account_uuid: "", session_id: "" });
  return `{ "model": "glm-5.3", "max_tokens": 8, "messages": [], "metadata": { "user_id": ${JSON.stringify(userId)} }, "pad": ${JSON.stringify("é😀x".repeat(Math.ceil(padChars / 4)).slice(0, padChars))} }`;
}

function streamOf(bytes: Uint8Array, chunk: (i: number) => number): ReadableStream<Uint8Array> {
  let at = 0;
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.byteLength) { controller.close(); return; }
      const size = Math.max(1, chunk(i++));
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

function post(bytes: Uint8Array, declared: string | null, chunk: (i: number) => number): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (declared !== null) headers["content-length"] = declared;
  return new Request("http://localhost/v1/messages", { method: "POST", headers, body: streamOf(bytes, chunk), duplex: "half" } as RequestInit);
}

describe("request body read into one buffer (ticket 20)", () => {
  const text = verbatimBody(200_000);
  const bytes = new TextEncoder().encode(text);
  const cases: [string, string | null, (i: number) => number][] = [
    ["the declared length is right", String(bytes.byteLength), (i) => 1 + ((i * 7919) % 65_536)],
    ["the declared length is too small", "10", (i) => 3 + ((i * 31) % 997)],
    ["the declared length runs out mid-chunk", String(Math.floor(bytes.byteLength / 2) + 1), () => 4_093],
    ["the declared length is too large", String(bytes.byteLength * 2), () => 65_536],
    ["no length is declared", null, (i) => 1 + (i % 5)],
    ["the declared length is zero", "0", () => 8_192],
  ];
  for (const [name, declared, chunk] of cases) {
    it(`forwards the client's text exactly when ${name}`, async () => {
      const { handler, bodies } = handlerWithCapture();
      const res = await handler(post(bytes, declared, chunk));
      expect(res.status).toBe(200);
      expect(bodies).toHaveLength(1);
      expect(bodies[0] === text).toBe(true);
    });
  }

  it("still refuses a body over the 32 MiB wire cap that declares a small length", async () => {
    const { handler, bodies } = handlerWithCapture();
    const big = new Uint8Array(32 * 1024 * 1024 + 1).fill(0x20);
    const res = await handler(post(big, "16", () => 1024 * 1024));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe("request_too_large");
    expect(bodies).toHaveLength(0);
  });
});
