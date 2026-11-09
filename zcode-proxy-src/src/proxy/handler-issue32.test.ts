/**
 * GitHub issue 32 — public-boundary classification pins.
 *
 * The reporter saw failed POST /v1/chat/completions with HTTP 405 and
 * business code 3012. Whatever the upstream cause, the proxy must preserve
 * the genuine 3012 authorization classification at the client boundary and
 * must never treat a 3012 response as a captcha challenge (no re-solve, no
 * "captcha verify failed" mapping). The in-body 3007 contrast is pinned by
 * handler-resilience.test.ts ("retries an in-body 3007 captcha challenge").
 *
 * Offline: mock fetch + injected captcha module, no network. This test pins
 * behavior that already holds; it is proven live with a deliberate mutation
 * (see ticket 82 Comments).
 */
import { describe, it, expect, mock } from "bun:test";
import { proxyRequest } from "./handler.js";
import type { ProxyConfig, ProxyIdentity } from "../config/types.js";
import { AuthManager } from "../auth/manager.js";
import { fixtureSecret } from "../test-fixtures.js";

const PLAN_KEY = fixtureSecret("issue32-key");
const PLAN_JWT = fixtureSecret("issue32-jwt");

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
  defaultModel: "glm-4.6",
  models: ["glm-4.6"],
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

describe("3012 authorization classification at the public boundary (issue 32)", () => {
  it("an HTTP 405 + code 3012 rejection keeps its authorization classification and never triggers a captcha re-solve", async () => {
    let mints = 0;
    let upstreamCalls = 0;
    mock.module("./captcha.js", () => ({
      detectCaptchaChallenge: (resp: Response): string | null => {
        const v = resp.headers.get("x-aliyun-captcha-verify-param");
        return v && v.trim().length > 0 ? v.trim() : null;
      },
      getCaptchaToken: async (_appVersion: string) => {
        mints += 1;
        return { verifyParam: `tok-${mints}`, region: "sgp" };
      },
      RETRY_HEADERS: { PARAM: "x-aliyun-captcha-verify-param", REGION: "x-aliyun-captcha-verify-region" },
    }));
    const fetchMock = mock(async (req: Request): Promise<Response> => {
      if (req.url.includes("/client/configs")) {
        return new Response(JSON.stringify({ data: { configs: { captcha: { enabled: true } } } }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      upstreamCalls += 1;
      // The reporter's shape: non-JSON-error status with business code 3012.
      return new Response(JSON.stringify({ code: 3012, msg: "method not allowed" }), {
        status: 405, headers: { "content-type": "application/json" },
      });
    });

    const auth = new AuthManager();
    auth.setOAuthCredential({ apiKey: PLAN_KEY, provider: "zai", jwt: PLAN_JWT });
    const clientReq = new Request("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"model":"glm-4.6","messages":[{"role":"user","content":"hi"}]}',
    });

    const resp = await proxyRequest(clientReq, "openai", { config: TEST_CONFIG, auth, fetchImpl: fetchMock as unknown as typeof fetch });

    // Exactly the initial mint and one upstream dispatch: 3012 is terminal for
    // this account/window — no captcha re-solve, no rotation resend.
    expect(mints).toBe(1);
    expect(upstreamCalls).toBe(1);

    // The client sees the preserved authorization classification.
    expect(resp.status).toBe(405);
    const body = await resp.json() as { error: { type: string; message: string } };
    expect(body.error.message).toContain("[3012]");
    expect(body.error.message).toContain("upstream authorization rejected");
    expect(body.error.message).not.toContain("captcha");
  });
});
