/**
 * Tests for the two resilience behaviors:
 *
 * 1. In-body captcha challenge detection: a start-plan upstream response with
 *    HTTP 400 + {"code":3007,...} in the JSON body (no captcha header) must
 *    be treated as a captcha challenge and retried with a fresh token.
 * 2. Connect-retry freshness: after a connect-level failure, the retried
 *    dispatch must receive a FRESH Request.
 *    a `req.bodyUsed === false` assertion is vacuous in a mock (mock fetch
 *    never consumes the body), so freshness is pinned by OBJECT IDENTITY —
 *    the second call must receive a different Request instance.
 *
 * Both tests use the start-plan path with an injected captcha module via
 * `mock.module("./captcha.js")` (same technique as captcha-pool.test.ts).
 */
import { describe, it, expect, mock } from "bun:test";
import { dispatchWithConnectRetry, proxyRequest } from "./handler.js";
import type { ProxyConfig, ProxyIdentity } from "../config/types.js";
import { AuthManager } from "../auth/manager.js";
import { fixtureSecret } from "../test-fixtures.js";

const PLAN_KEY = fixtureSecret("resilience-key");
const PLAN_JWT = fixtureSecret("resilience-jwt");

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

const GATEWAY_URL = "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages";

const ANTHROPIC_OK = JSON.stringify({
  id: "msg_resilience",
  type: "message",
  role: "assistant",
  model: "glm-4.6",
  content: [{ type: "text", text: "resilience reply" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 5, output_tokens: 3 },
});

describe("dispatchWithConnectRetry — replay safety (C1-02)", () => {
  it("retries only allowlisted connect failure codes found on the error or cause", async () => {
    for (const codedError of [
      Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }),
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }),
      Object.assign(new TypeError("fetch failed"), { cause: { code: "EAI_AGAIN" } }),
      Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }),
    ]) {
      let calls = 0;
      const response = await dispatchWithConnectRetry(async () => {
        calls += 1;
        if (calls === 1) throw codedError;
        return new Response("ok");
      }, { retryDelayMs: 0 });

      expect(response.status).toBe(200);
      expect(calls).toBe(2);
    }
  });

  it("retries a connection drop before any response (reset/pipe/timeout), like the official client", async () => {
    // Transient extension: a reset before response headers is retried on the
    // same account — the request may have reached the gateway, which is the
    // exposure the official ZCode client accepts for this class too.
    for (const dropped of [
      Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }),
      Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
      Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } }),
      new Error("socket hang up"),
    ]) {
      let calls = 0;
      const response = await dispatchWithConnectRetry(async () => {
        calls += 1;
        if (calls === 1) throw dropped;
        return new Response("ok");
      }, { retryDelayMs: 0 });
      expect(response.status).toBe(200);
      expect(calls).toBe(2);
    }
  });

  it("does not retry an unknown failure, a TLS failure or an abort", async () => {
    for (const fatal of [
      new Error("something unrelated"),
      Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }),
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    ]) {
      let calls = 0;
      await expect(dispatchWithConnectRetry(async () => {
        calls += 1;
        throw fatal;
      }, { retryDelayMs: 0 })).rejects.toBe(fatal);
      expect(calls).toBe(1);
    }
  });

  it("retries a drop flagged postWrite on the same account (parity with the fetch path); the connect-only policy leaves it alone", async () => {
    let calls = 0;
    const postWrite = Object.assign(new Error("upstream closed before sending response headers"), {
      code: "ECONNRESET",
      postWrite: true,
    });
    const resp = await dispatchWithConnectRetry(async () => {
      calls += 1;
      if (calls === 1) throw postWrite;
      return new Response("ok");
    }, { retryDelayMs: 0 });
    expect(resp.status).toBe(200);
    expect(calls).toBe(2);

    const previous = process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS;
    process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = "off";
    try {
      calls = 0;
      await expect(dispatchWithConnectRetry(async () => {
        calls += 1;
        throw postWrite;
      })).rejects.toBe(postWrite);
      expect(calls).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS;
      else process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = previous;
    }
  });
});

describe("proxyRequest — start-plan resilience", () => {
  it("retries an in-body 3007 captcha challenge with a fresh token", async () => {
    // Mock the captcha module: config enabled, token take returns distinct
    // tokens per call so we can assert the retry used a FRESH token.
    let tokenSeq = 0;
    mock.module("./captcha.js", () => ({
      detectCaptchaChallenge: (resp: Response): string | null => {
        const v = resp.headers.get("x-aliyun-captcha-verify-param");
        return v && v.trim().length > 0 ? v.trim() : null;
      },
      getCaptchaToken: async (_appVersion: string) => {
        tokenSeq += 1;
        return { verifyParam: `tok-${tokenSeq}`, region: "sgp" };
      },
      RETRY_HEADERS: { PARAM: "x-aliyun-captcha-verify-param", REGION: "x-aliyun-captcha-verify-region" },
    }));

    // Upstream: first call = HTTP 400 with {"code":3007} in the body (no
    // captcha header), second call = success. The mock also records the
    // captcha header of each call so we can assert the retry used a FRESH
    // token (tok-2, not the consumed tok-1).
    const seenCaptchaHeaders: (string | null)[] = [];
    let calls = 0;
    const fetchMock = mock(async (req: Request): Promise<Response> => {
      if (req.url.includes("/client/configs")) {
        return new Response(JSON.stringify({ data: { configs: { captcha: { enabled: true } } } }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      calls += 1;
      seenCaptchaHeaders.push(req.headers.get("x-aliyun-captcha-verify-param"));
      if (calls === 1) {
        return new Response(JSON.stringify({ code: 3007, msg: "captcha verify failed" }), {
          status: 400, headers: { "content-type": "application/json" },
        });
      }
      return new Response(ANTHROPIC_OK, { status: 200, headers: { "content-type": "application/json" } });
    });

    const auth = new AuthManager();
    auth.setOAuthCredential({ apiKey: PLAN_KEY, provider: "zai", jwt: PLAN_JWT });
    const clientReq = new Request("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"model":"glm-4.6","messages":[{"role":"user","content":"hi"}]}',
    });

    const resp = await proxyRequest(clientReq, "openai", { config: TEST_CONFIG, auth, fetchImpl: fetchMock as any });

    // The in-body 3007 challenge was detected and retried with a fresh token.
    expect(calls).toBe(2);
    expect(seenCaptchaHeaders[0]).toBe("tok-1");
    expect(seenCaptchaHeaders[1]).toBe("tok-2");
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.choices[0].message.content).toBe("resilience reply");
  });

  it("retries a gateway 503 before any output on the SAME credential and without touching the quota layer", async () => {
    const authHeaders: (string | null)[] = [];
    let calls = 0;
    const fetchMock = mock(async (req: Request): Promise<Response> => {
      calls += 1;
      authHeaders.push(req.headers.get("authorization"));
      if (calls === 1) return new Response("<html>bad gateway</html>", { status: 503, headers: { "content-type": "text/html" } });
      return new Response(ANTHROPIC_OK, { status: 200, headers: { "content-type": "application/json" } });
    });

    const auth = new AuthManager();
    auth.setOAuthCredential({ apiKey: PLAN_KEY, provider: "zai", jwt: PLAN_JWT });
    const clientReq = new Request("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"model":"glm-4.6","messages":[{"role":"user","content":"hi"}]}',
    });

    const resp = await proxyRequest(clientReq, "openai", { config: TEST_CONFIG, auth, fetchImpl: fetchMock as any });
    expect(calls).toBe(2);
    expect(authHeaders[0]).toBe(authHeaders[1]); // same account, fresh request
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.choices[0].message.content).toBe("resilience reply");
  });

  it("retries a connect failure with a FRESH Request (identity-pinned)", async () => {
    // Upstream: first call = connect-level failure (the bug shape), second
    // call = success. A mock fetch never
    // consumes the Request body, so a `req.bodyUsed === false` assertion is
    // vacuous — it passes even if the handler re-dispatches the SAME Request
    // object. Pin freshness by OBJECT IDENTITY instead: the second call must
    // receive a different Request instance than the first.
    let calls = 0;
    let firstReq: Request | null = null;
    const fetchMock = mock(async (req: Request): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        firstReq = req;
        throw Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" });
      }
      // The freshness assertion: re-dispatching the SAME Request object
      // would fail this identity check.
      expect(firstReq).not.toBeNull();
      expect(req).not.toBe(firstReq);
      return new Response(ANTHROPIC_OK, { status: 200, headers: { "content-type": "application/json" } });
    });

    const auth = new AuthManager();
    auth.setOAuthCredential({ apiKey: PLAN_KEY, provider: "zai", jwt: PLAN_JWT });
    const clientReq = new Request("http://localhost:8080/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"model":"glm-4.6","messages":[{"role":"user","content":"hi"}]}',
    });

    const resp = await proxyRequest(clientReq, "openai", { config: TEST_CONFIG, auth, fetchImpl: fetchMock as any });

    // The connect failure was retried with a FRESH Request (identity check
    // inside the mock passed).
    expect(calls).toBe(2);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.choices[0].message.content).toBe("resilience reply");
  });

  function mockCaptcha(): { minted: () => number } {
    let seq = 0;
    mock.module("./captcha.js", () => ({
      detectCaptchaChallenge: (resp: Response): string | null => resp.headers.get("x-aliyun-captcha-verify-param"),
      getCaptchaToken: async () => { seq += 1; return { verifyParam: `fresh-${seq}`, region: "sgp" }; },
      RETRY_HEADERS: { PARAM: "x-aliyun-captcha-verify-param", REGION: "x-aliyun-captcha-verify-region" },
    }));
    return { minted: () => seq };
  }
  const chatReq = (stream = false): Request => new Request("http://localhost:8080/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "glm-4.6", max_tokens: 16, stream, messages: [{ role: "user", content: "hi" }] }),
  });
  const START = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_p","type":"message","role":"assistant","model":"glm-4.6","content":[],"usage":{"input_tokens":1,"output_tokens":0}}}\n\n';
  const BLOCK = 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n';
  const DELTA = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n';
  const STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
  const OVERLOADED = 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
  const INVALID = 'event: error\ndata: {"type":"error","error":{"type":"invalid_request_error","message":"bad"}}\n\n';
  const sse = (text: string): Response => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });

  it("re-dispatches a stream that fails in its prelude (before any content) on the same account with a fresh captcha token; the client sees only the good stream", async () => {
    const captcha = mockCaptcha();
    const seen: Array<{ auth: string | null; token: string | null }> = [];
    const fetchMock = mock(async (req: Request): Promise<Response> => {
      seen.push({ auth: req.headers.get("authorization"), token: req.headers.get("x-aliyun-captcha-verify-param") });
      return seen.length === 1 ? sse(START + OVERLOADED) : sse(START + BLOCK + DELTA + STOP);
    });
    const auth = new AuthManager();
    auth.setOAuthCredential({ apiKey: PLAN_KEY, provider: "zai", jwt: PLAN_JWT });
    const previous = process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS;
    process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = "0";
    try {
      const resp = await proxyRequest(chatReq(true), "anthropic", { config: TEST_CONFIG, auth, fetchImpl: fetchMock as any });
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(seen.length).toBe(2);
      expect(seen[0].auth).toBe(seen[1].auth); // same account
      expect(seen[0].token).toBe("fresh-1");
      expect(seen[1].token).toBe("fresh-2"); // a response-based retry never re-sends a possibly spent token
      expect(captcha.minted()).toBe(2);
      expect(text).toBe(START + BLOCK + DELTA + STOP); // the failed prelude never reached the client
      expect(text).not.toContain("overloaded_error");
    } finally {
      if (previous === undefined) delete process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS;
      else process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = previous;
    }
  });

  it("never retries a terminal error in the prelude, and never anything after the first content event", async () => {
    mockCaptcha();
    const auth = new AuthManager();
    auth.setOAuthCredential({ apiKey: PLAN_KEY, provider: "zai", jwt: PLAN_JWT });
    let calls = 0;
    const terminal = await proxyRequest(chatReq(true), "anthropic", {
      config: TEST_CONFIG, auth, fetchImpl: mock(async () => { calls += 1; return sse(START + INVALID); }) as any,
    });
    expect(await terminal.text()).toBe(START + INVALID);
    expect(calls).toBe(1);
    calls = 0;
    const late = await proxyRequest(chatReq(true), "anthropic", {
      config: TEST_CONFIG, auth, fetchImpl: mock(async () => { calls += 1; return sse(START + BLOCK + OVERLOADED); }) as any,
    });
    expect(await late.text()).toBe(START + BLOCK + OVERLOADED);
    expect(calls).toBe(1);
  });

  it("keeps the captcha token after a never-connected attempt and mints a fresh one after a drop post-write", async () => {
    mockCaptcha();
    const tokens: Array<string | null> = [];
    let calls = 0;
    const fetchMock = mock(async (req: Request): Promise<Response> => {
      calls += 1;
      tokens.push(req.headers.get("x-aliyun-captcha-verify-param"));
      if (calls === 1) throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
      if (calls === 2) throw Object.assign(new Error("reset after write"), { code: "ECONNRESET" });
      return new Response(ANTHROPIC_OK, { status: 200, headers: { "content-type": "application/json" } });
    });
    const auth = new AuthManager();
    auth.setOAuthCredential({ apiKey: PLAN_KEY, provider: "zai", jwt: PLAN_JWT });
    const previous = process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS;
    process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = "0";
    try {
      const resp = await proxyRequest(chatReq(), "anthropic", { config: TEST_CONFIG, auth, fetchImpl: fetchMock as any });
      expect(resp.status).toBe(200);
      expect(calls).toBe(3);
      expect(tokens[1]).toBe(tokens[0]); // never connected: the token was not seen by the gateway
      expect(tokens[2]).not.toBe(tokens[1]); // a drop may have spent it
    } finally {
      if (previous === undefined) delete process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS;
      else process.env.ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS = previous;
    }
  });
});
