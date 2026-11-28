/**
 * GitHub issue 94 — a success-coded gateway envelope without a model reply.
 *
 * The start-plan gateway answered POST /v1/messages with HTTP 200 and
 * `{"code":0,"msg":"","logid":"…"}`. The proxy passed that body through, so
 * an Anthropic client received a "successful" response with no message, no
 * stop reason and no error to act on. The proxy must answer 502 instead.
 *
 * Offline: mock fetch + injected captcha module, no network.
 */
import { describe, it, expect, mock } from "bun:test";
import { proxyRequest } from "./handler.js";
import { EMPTY_GATEWAY_SUCCESS_MESSAGE, EMPTY_GATEWAY_SUCCESS_TYPE } from "./upstream-errors.js";
import type { ProxyConfig, ProxyIdentity } from "../config/types.js";
import { AuthManager } from "../auth/manager.js";
import { fixtureSecret } from "../test-fixtures.js";

const PLAN_KEY = fixtureSecret("issue94-key");
const PLAN_JWT = fixtureSecret("issue94-jwt");
const LOG_ID = "issue94-private-logid";

const IDENTITY: ProxyIdentity = {
  appVersion: "test-1.0.0",
  sourceTitle: "cli",
  refererOrigin: "https://zcode.z.ai",
};

const TEST_CONFIG: ProxyConfig = {
  server: { port: 8080, host: "0.0.0.0" },
  auth: {},
  provider: "zai",
  plan: "start-plan",
  providers: {
    zai: { anthropicBase: "https://api.z.ai/api/anthropic", openaiBase: "https://api.z.ai/api/coding/paas/v4" },
    bigmodel: { anthropicBase: "https://open.bigmodel.cn/api/anthropic", openaiBase: "https://open.bigmodel.cn/api/coding/paas/v4" },
  },
  defaultModel: "glm-5.3-flash",
  models: ["glm-5.3-flash"],
  identity: IDENTITY,
  clientIdentity: { mode: "observe", ttlSeconds: 900, maxSessions: 1024 },
  responses: { enabled: true, storeMaxEntries: 1000, storeTtlMs: 86400000 },
  endpointRouting: { enabled: false, origin: "https://zcode.z.ai" },
  clientSigning: { enabled: false, origin: "https://zcode.z.ai" },
  mcp: { enabled: true, webSearch: true, webReader: false, zread: false },
  async: { enabled: false, origin: "https://zcode.z.ai", pollIntervalMs: 5000, keepAliveIntervalMs: 3000, maxWaitMs: 0, maxRetries: 3, settleTimeoutMs: 8000, controlTimeoutMs: 15000, defaultModel: "" },
  claim: { enabled: false, auto: true, origin: "https://zcode.z.ai", pollIntervalMs: 300000, cooldownMs: 600000, planId: "" },
  logging: { level: "info" },
};

async function send(format: "anthropic" | "openai", upstreamBody: unknown, stream: boolean): Promise<Response> {
  mock.module("./captcha.js", () => ({
    detectCaptchaChallenge: (): string | null => null,
    getCaptchaToken: async (_appVersion: string) => ({ verifyParam: "tok", region: "sgp" }),
    RETRY_HEADERS: { PARAM: "x-aliyun-captcha-verify-param", REGION: "x-aliyun-captcha-verify-region" },
  }));
  const fetchMock = mock(async (req: Request): Promise<Response> => {
    if (req.url.includes("/client/configs")) {
      return new Response(JSON.stringify({ data: { configs: { captcha: { enabled: true } } } }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(upstreamBody), { status: 200, headers: { "content-type": "application/json" } });
  });
  const auth = new AuthManager();
  auth.setOAuthCredential({ apiKey: PLAN_KEY, provider: "zai", jwt: PLAN_JWT });
  const path = format === "openai" ? "/v1/chat/completions" : "/v1/messages";
  const payload = format === "openai"
    ? { model: "glm-5.3-flash", stream, messages: [{ role: "user", content: "hi" }] }
    : { model: "glm-5.3-flash", max_tokens: 64, stream, messages: [{ role: "user", content: "hi" }] };
  const clientReq = new Request(`http://localhost:8080${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return proxyRequest(clientReq, format, { config: TEST_CONFIG, auth, fetchImpl: fetchMock as unknown as typeof fetch });
}

function sendMessages(upstreamBody: unknown, stream: boolean): Promise<Response> {
  return send("anthropic", upstreamBody, stream);
}

describe("success-coded gateway envelope without a model reply (issue 94)", () => {
  it.each([
    { code: 0 as number | string, stream: false },
    { code: 0, stream: true },
    { code: "0", stream: false },
    { code: 200, stream: false },
  ])("code $code (stream=$stream) becomes a 502 instead of an empty HTTP 200", async ({ code, stream }) => {
    const resp = await sendMessages({ code, msg: "", logid: LOG_ID }, stream);

    expect(resp.status).toBe(502);
    const text = await resp.text();
    expect(JSON.parse(text)).toEqual({ error: { type: EMPTY_GATEWAY_SUCCESS_TYPE, message: EMPTY_GATEWAY_SUCCESS_MESSAGE } });
    expect(text).toContain("identity.appVersion");
    // Upstream identifiers are never echoed to the client.
    expect(text).not.toContain(LOG_ID);
  });

  it("OpenAI chat completions names the outdated client identity instead of a translation failure", async () => {
    const resp = await send("openai", { code: 0, msg: "", logid: LOG_ID }, false);

    expect(resp.status).toBe(502);
    const text = await resp.text();
    expect(JSON.parse(text)).toEqual({ error: { type: EMPTY_GATEWAY_SUCCESS_TYPE, message: EMPTY_GATEWAY_SUCCESS_MESSAGE } });
    expect(text).not.toContain("translation_failed");
    expect(text).not.toContain(LOG_ID);
  });

  it("still translates a real Anthropic message for an OpenAI client", async () => {
    const message = { id: "msg_1", type: "message", role: "assistant", model: "glm-5.3-flash", content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
    const resp = await send("openai", message, false);
    expect(resp.status).toBe(200);
    const body = await resp.json() as { object: string; choices: Array<{ message: { content: string } }> };
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message.content).toBe("OK");
  });

  it("still passes a message through when the gateway adds a success code to it", async () => {
    const message = { code: 0, id: "msg_1", type: "message", role: "assistant", model: "glm-5.3-flash", content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };

    const resp = await sendMessages(message, false);

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(message);
  });
});
