/**
 * What a client sees when its request needs a CAPTCHA solve and the solver
 * refuses it (its fail-fast window, or a full solve queue): HTTP 503 with
 * `Retry-After` in the endpoint's own error shape, on the chat routes and on
 * /v1/responses. Offline: a mock upstream that challenges, an injected
 * captcha provider that fails the way the solver does.
 */
import { describe, expect, it } from "bun:test";
import { proxyRequest } from "./handler.js";
import { handleResponses } from "./responses-handler.js";
import { CaptchaSolverUnavailableError } from "./captcha-token.js";
import { solverShed } from "../server/admission.js";
import { AuthManager } from "../auth/manager.js";
import type { ProxyConfig } from "../config/types.js";
import { fixtureSecret } from "../test-fixtures.js";

const CONFIG: ProxyConfig = {
  server: { port: 8080, host: "127.0.0.1" },
  auth: {},
  provider: "zai",
  plan: "start-plan",
  providers: {
    zai: { anthropicBase: "https://api.z.ai/api/anthropic", openaiBase: "https://api.z.ai/api/coding/paas/v4" },
    bigmodel: { anthropicBase: "https://open.bigmodel.cn/api/anthropic", openaiBase: "https://open.bigmodel.cn/api/coding/paas/v4" },
  },
  defaultModel: "glm-4.6",
  models: ["glm-4.6"],
  identity: { appVersion: "test-1.0.0", sourceTitle: "cli", refererOrigin: "https://zcode.z.ai" },
  clientIdentity: { mode: "observe", ttlSeconds: 900, maxSessions: 1024 },
  responses: { enabled: true, storeMaxEntries: 1000, storeTtlMs: 86400000 },
  endpointRouting: { enabled: false, origin: "https://zcode.z.ai" },
  clientSigning: { enabled: false, origin: "https://zcode.z.ai" },
  mcp: { enabled: true, webSearch: true, webReader: false, zread: false },
  async: { enabled: false, origin: "https://zcode.z.ai", pollIntervalMs: 5000, keepAliveIntervalMs: 3000, maxWaitMs: 0, maxRetries: 3, settleTimeoutMs: 8000, controlTimeoutMs: 15000, defaultModel: "" },
  claim: { enabled: false, auto: true, origin: "https://zcode.z.ai", pollIntervalMs: 300000, cooldownMs: 600000, planId: "" },
  logging: { level: "info" },
};

function auth(): AuthManager {
  const manager = new AuthManager();
  manager.setOAuthCredential({ apiKey: fixtureSecret("solver-shed-key"), provider: "zai", jwt: fixtureSecret("solver-shed-jwt") });
  return manager;
}

/** An upstream that answers every request with the in-body captcha challenge. */
function challengingUpstream() {
  let calls = 0;
  const fetchImpl = (async (): Promise<Response> => {
    calls += 1;
    return new Response(JSON.stringify({ code: 3007, msg: "captcha verify failed" }), { status: 400, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls: () => calls };
}

/** A captcha provider whose solver refuses every solve. */
function refusingCaptcha(error: Error) {
  let asked = 0;
  const captcha = {
    RETRY_HEADERS: { PARAM: "x-aliyun-captcha-verify-param", REGION: "x-aliyun-captcha-verify-region" },
    getCaptchaToken: async () => { asked += 1; throw error; },
    detectCaptchaChallenge: (resp: Response) => resp.headers.get("x-aliyun-captcha-verify-param"),
  } as unknown as NonNullable<Parameters<typeof proxyRequest>[2]["captcha"]>;
  return { captcha, asked: () => asked };
}

const post = (path: string, body: unknown) => new Request(`http://localhost:8080${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const CHAT = { model: "glm-4.6", max_tokens: 16, messages: [{ role: "user", content: "hi" }] };

describe("a request whose solve the solver refuses", () => {
  it("gets 503 + Retry-After until the fail-fast window reopens, in the Anthropic shape on /v1/messages", async () => {
    const upstream = challengingUpstream();
    const { captcha, asked } = refusingCaptcha(new CaptchaSolverUnavailableError("fail-fast", 299_200));
    const resp = await proxyRequest(post("/v1/messages", CHAT), "anthropic", { config: CONFIG, auth: auth(), fetchImpl: upstream.fetchImpl, captcha });
    expect(resp.status).toBe(503);
    // Whole seconds, rounded up: never earlier than the window's end.
    expect(resp.headers.get("retry-after")).toBe("300");
    expect(await resp.json()).toEqual({
      type: "error",
      error: {
        type: "overloaded_error",
        message: "The proxy is busy and did not accept this request. It needs a CAPTCHA solve, and the solver is paused because it ended abnormally too often in the last 10 minutes. "
          + "Retry in 300 s; if this keeps happening, look for the solver's lines in the proxy log (zcode-kit proxy logs).",
      },
    });
    // As before: the request went upstream once without a token, and the retry was not sent.
    expect({ upstream: upstream.calls(), asked: asked() }).toEqual({ upstream: 1, asked: 2 });
  });

  it("gets the same in the OpenAI shape on /v1/chat/completions and on /v1/responses", async () => {
    const expected = {
      error: {
        message: "The proxy is busy and did not accept this request. It needs a CAPTCHA solve, and the solver is paused because it ended abnormally too often in the last 10 minutes. "
          + "Retry in 42 s; if this keeps happening, look for the solver's lines in the proxy log (zcode-kit proxy logs).",
        type: "server_error", param: null, code: "overloaded",
      },
    };
    const refusal = () => refusingCaptcha(new CaptchaSolverUnavailableError("fail-fast", 42_000)).captcha;
    const chat = await proxyRequest(post("/v1/chat/completions", CHAT), "openai", { config: CONFIG, auth: auth(), fetchImpl: challengingUpstream().fetchImpl, captcha: refusal() });
    const responses = await handleResponses(post("/v1/responses", { model: "glm-4.6", input: "hi" }), { config: CONFIG, auth: auth(), fetchImpl: challengingUpstream().fetchImpl, captcha: refusal() });
    for (const resp of [chat, responses]) {
      expect([resp.status, resp.headers.get("retry-after")]).toEqual([503, "42"]);
      expect(await resp.json()).toEqual(expected);
    }
  });

  it("gets 503 + Retry-After: 2 when too many solves are waiting", async () => {
    const { captcha } = refusingCaptcha(new CaptchaSolverUnavailableError("queue-full", 2_000));
    const resp = await proxyRequest(post("/v1/messages", CHAT), "anthropic", { config: CONFIG, auth: auth(), fetchImpl: challengingUpstream().fetchImpl, captcha });
    expect([resp.status, resp.headers.get("retry-after")]).toEqual([503, "2"]);
    const body = await resp.json() as { error: { type: string; message: string } };
    expect(body.error.type).toBe("overloaded_error");
    expect(body.error.message).toContain(solverShed("queue-full").why);
  });

  it("keeps the plain solver failure for every other solver error: 503 captcha_solver_failed, no Retry-After", async () => {
    const { captcha } = refusingCaptcha(new Error("captcha failed after 4 attempts: captcha SDK failure"));
    const resp = await proxyRequest(post("/v1/messages", CHAT), "anthropic", { config: CONFIG, auth: auth(), fetchImpl: challengingUpstream().fetchImpl, captcha });
    expect([resp.status, resp.headers.get("retry-after")]).toEqual([503, null]);
    expect(((await resp.json()) as { error: { type: string } }).error.type).toBe("captcha_solver_failed");
  });
});
