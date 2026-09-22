/**
 * Tests for server routing and proxy API key auth.
 * @see .omo/plans/zcode-proxy.md Task 7
 */
import { describe, it, expect } from "bun:test";
import { createFetchHandler, startServer } from "./server.js";
import { handleListModels } from "./routes-openai.js";
import { handleMessages } from "./routes-anthropic.js";
import type { ProxyConfig } from "../config/types.js";
import { AuthManager } from "../auth/manager.js";
import { createAccountRotator } from "../auth/account-rotator.js";
import { fixtureSecret, wrongSecret } from "../test-fixtures.js";

/** The configured proxy API key; requests presenting it must be accepted. */
const PROXY_KEY = fixtureSecret("server-proxy-key");
/** Guaranteed different from PROXY_KEY — requests with it must be rejected. */
const WRONG_PROXY_KEY = wrongSecret("server-proxy-key");

/** AuthManager with a preset oauth credential (replaces the removed apikey mode). */
function oauthAuth(key = "testkey.testsecret"): AuthManager {
  const [apiKey, secret] = key.split(".");
  const auth = new AuthManager();
  auth.setOAuthCredential(secret ? { apiKey, secret, provider: "zai" } : { apiKey, provider: "zai" });
  return auth;
}

function makeConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    server: { port: 0, host: "127.0.0.1" },
    auth: { ...overrides.auth },
    provider: "zai",
    plan: "coding-plan",
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
    ...overrides,
  };
}

function mockUpstream(): typeof fetch {
  return (async (req: Request): Promise<Response> => {
    const url = req.url;
    if (url.includes("/v1/models") || req.method === "GET") {
      return new Response('{"object":"list","data":[]}', { status: 200, headers: { "content-type": "application/json" } });
    }
    const body = await req.text();
    const parsed = JSON.parse(body);
    if (url.includes("/anthropic/") || url.includes("/v1/messages")) {
      return new Response(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Hello from upstream" }],
          model: parsed.model ?? "glm-4.6",
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: Date.now(),
        model: parsed.model ?? "glm-4.6",
        choices: [{ index: 0, message: { role: "assistant", content: "Hello from upstream" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

describe("server routing", () => {
  it("GET /v1/models returns model list", async () => {
    const config = makeConfig({ auth: {} });
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(new Request("http://localhost/v1/models", { method: "GET" }));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.object).toBe("list");
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].object).toBe("model");
  });

  it("POST /v1/chat/completions forwards to upstream", async () => {
    const config = makeConfig();
    const auth = oauthAuth();
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] }),
      }),
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.choices[0].message.content).toBe("Hello from upstream");
  });

  it("POST /v1/messages returns Anthropic-compatible response", async () => {
    const config = makeConfig();
    const auth = oauthAuth();
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "glm-4.6", max_tokens: 100, messages: [{ role: "user", content: "Hi" }] }),
      }),
    );
    expect(resp.status).toBe(200);
  });

  it("does not expose POST /v1/responses when Responses API is disabled", async () => {
    const config = makeConfig({ responses: { enabled: false, storeMaxEntries: 1000, storeTtlMs: 86400000 } });
    const auth = oauthAuth();
    let upstreamCalls = 0;
    const fetchImpl = Object.assign(async (_request: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      upstreamCalls++;
      return new Response("unexpected", { status: 500 });
    }, { preconnect: fetch.preconnect });
    const handler = createFetchHandler({ config, auth, fetchImpl });

    const resp = await handler(new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-4.6", input: "Hi" }),
    }));
    expect(resp.status).toBe(404);
    expect(upstreamCalls).toBe(0);
  });

  it("returns async_plan_unsupported on /async/* when plan is start-plan", async () => {
    const config = makeConfig({
      plan: "start-plan",
      async: { enabled: true, origin: "https://zcode.z.ai", pollIntervalMs: 10, keepAliveIntervalMs: 5, maxWaitMs: 0, maxRetries: 3, settleTimeoutMs: 100, controlTimeoutMs: 1000, defaultModel: "" },
    });
    const auth = oauthAuth();
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(new Request("http://localhost/async/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] }),
    }));
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.type).toBe("async_plan_unsupported");
  });

  it("dispatches /async/v1/messages when plan is coding-plan (reaches credential check)", async () => {
    const config = makeConfig({
      async: { enabled: true, origin: "https://zcode.z.ai", pollIntervalMs: 10, keepAliveIntervalMs: 5, maxWaitMs: 0, maxRetries: 3, settleTimeoutMs: 100, controlTimeoutMs: 1000, defaultModel: "" },
    });
    // JWT-less credential: the route must get PAST the plan gate and fail later
    // with async_credentials_unavailable (proving dispatch, not blocking).
    const auth = oauthAuth();
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(new Request("http://localhost/async/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-4.6", messages: [{ role: "user", content: "Hi" }] }),
    }));
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error.type).toBe("async_credentials_unavailable");
  });

  it("GET /health returns ok status", async () => {
    const config = makeConfig();
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth });

    const resp = await handler(new Request("http://localhost/health"));
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe("ok");
  });

  it("unknown route returns 404", async () => {
    const config = makeConfig();
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth });

    const resp = await handler(new Request("http://localhost/unknown", { method: "GET" }));
    expect(resp.status).toBe(404);
  });
});

describe("proxy API key auth", () => {
  // Synthetic key generated at runtime — no credential literals in source.
  const TEST_KEY = PROXY_KEY;
  const withAuth = (value?: string): ProxyConfig => {
    const config = makeConfig({});
    if (value !== undefined) (config.auth as Record<string, string>).proxyApiKey = value;
    return config;
  };

  // ZAK-002: startServer enforces serve invariants — loopback host + a real
  // bearer key — before binding. Without them it must refuse to serve.
  it("startServer refuses to bind without a proxy key or with the placeholder", async () => {
    const auth = oauthAuth("test");
    for (const candidate of [undefined, "", "GENERATE_ME", "your-proxy-secret", "changeme"]) {
      const config = withAuth(candidate);
      await expect(
        startServer({ config, auth, fetchImpl: mockUpstream() }),
      ).rejects.toThrow(/proxyApiKey/);
    }
  });

  it("startServer refuses to bind a non-loopback host", async () => {
    const config = withAuth(TEST_KEY);
    (config.server as Record<string, unknown>).host = "0.0.0.0";
    await expect(
      startServer({ config, auth: oauthAuth("test"), fetchImpl: mockUpstream() }),
    ).rejects.toThrow(/loopback/);
  });

  it("startServer binds and serves with a loopback host and a real key", async () => {
    const server = await startServer({ config: withAuth(TEST_KEY), auth: oauthAuth("test"), fetchImpl: mockUpstream() });
    try {
      const resp = await fetch(`http://127.0.0.1:${server.port}/v1/models`, {
        headers: { authorization: `Bearer ${TEST_KEY}` },
      });
      expect(resp.status).toBe(200);
      await resp.text();
    } finally {
      await server.close();
    }
  });

  // Audit backlog: every accepted loopback spelling must produce a working bind.
  it("startServer binds the accepted loopback host forms (localhost, ::1)", async () => {
    for (const host of ["localhost", "::1"]) {
      const config = withAuth(TEST_KEY);
      (config.server as Record<string, unknown>).host = host;
      const server = await startServer({ config, auth: oauthAuth("test"), fetchImpl: mockUpstream() });
      try {
        expect(server.hostname).toBe(host === 'localhost' ? '127.0.0.1' : host);
        const address = host === 'localhost' ? '127.0.0.1' : '[::1]';
        const response = await fetch(`http://${address}:${server.port}/v1/models`, { headers: { authorization: `Bearer ${TEST_KEY}` } });
        expect(response.status).toBe(200);
        await response.text();
      } finally {
        await server.close();
      }
    }
  });

  it("startServer rejects a placeholder key even when it comes from the env override", async () => {
    // ZCODE_PROXY_API_KEY has precedence over YAML in loadConfig; the resolved
    // value lands in config.auth.proxyApiKey and MUST still be validated here.
    const saved = process.env.ZCODE_PROXY_API_KEY;
    process.env.ZCODE_PROXY_API_KEY = "GENERATE_ME";
    try {
      // build the config through the real loader so the env override applies
      const { loadConfig } = await import("../config/loader.js");
      const { mkdtempSync, writeFileSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const net = await import("node:net");
      const dir = mkdtempSync(join(tmpdir(), "zcode-envkey-"));
      const cfgFile = join(dir, "config.yaml");
      // grab a genuinely free port (loadConfig validates the port range)
      const freePort = await new Promise<number>((resolve) => {
        const probe = net.createServer();
        probe.listen(0, "127.0.0.1", () => {
          const p = (probe.address() as { port: number }).port;
          probe.close(() => resolve(p));
        });
      });
      writeFileSync(cfgFile, `server:\n  port: ${freePort}\n  host: "127.0.0.1"\nprovider: zai\n`);
      const config = loadConfig(cfgFile);
      expect(config.auth.proxyApiKey).toBe("GENERATE_ME");
      await expect(
        startServer({ config, auth: oauthAuth("test"), fetchImpl: mockUpstream() }),
      ).rejects.toThrow(/proxyApiKey/);
    } finally {
      if (saved === undefined) delete process.env.ZCODE_PROXY_API_KEY;
      else process.env.ZCODE_PROXY_API_KEY = saved;
    }
  });

  it("rejects request without proxy API key when configured", async () => {
    const config = makeConfig({ auth: { proxyApiKey: PROXY_KEY } });
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(new Request("http://localhost/v1/models"));
    expect(resp.status).toBe(401);
  });

  it("accepts request with correct Bearer proxy key", async () => {
    const config = makeConfig({ auth: { proxyApiKey: PROXY_KEY } });
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(
      new Request("http://localhost/v1/models", {
        headers: { authorization: `Bearer ${PROXY_KEY}` },
      }),
    );
    expect(resp.status).toBe(200);
  });

  it("accepts request with correct x-api-key proxy key", async () => {
    const config = makeConfig({ auth: { proxyApiKey: PROXY_KEY } });
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(
      new Request("http://localhost/v1/models", {
        headers: { "x-api-key": PROXY_KEY },
      }),
    );
    expect(resp.status).toBe(200);
  });

  it("rejects request with wrong proxy key", async () => {
    const config = makeConfig({ auth: { proxyApiKey: PROXY_KEY } });
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(
      new Request("http://localhost/v1/models", {
        headers: { authorization: `Bearer ${WRONG_PROXY_KEY}` },
      }),
    );
    expect(resp.status).toBe(401);
  });

  it("does not require proxy key when proxyApiKey is unset", async () => {
    const config = makeConfig({ auth: {} });
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(new Request("http://localhost/v1/models"));
    expect(resp.status).toBe(200);
  });
});

describe("CORS", () => {
  it("OPTIONS returns 204 with CORS headers", async () => {
    const config = makeConfig();
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth });

    const resp = await handler(new Request("http://localhost/v1/models", { method: "OPTIONS" }));
    expect(resp.status).toBe(204);
    expect(resp.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects untrusted browser origins while allowing loopback origins", async () => {
    const config = makeConfig({ auth: { proxyApiKey: PROXY_KEY } });
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth });
    const denied = await handler(new Request("http://localhost/health", { headers: { origin: "https://evil.example", authorization: `Bearer ${PROXY_KEY}` } }));
    expect(denied.status).toBe(403);
    const allowed = await handler(new Request("http://localhost/health", { headers: { origin: "http://127.0.0.1:8080", authorization: `Bearer ${PROXY_KEY}` } }));
    expect(allowed.status).toBe(200);
  });

  it("rejects non-loopback Host headers even when the listener is loopback-bound", async () => {
    const config = makeConfig({ auth: { proxyApiKey: PROXY_KEY } });
    const handler = createFetchHandler({ config, auth: oauthAuth("test") });
    const response = await handler(new Request("http://localhost/health", {
      headers: { host: "attacker.example", authorization: `Bearer ${PROXY_KEY}` },
    }));
    expect(response.status).toBe(421);
  });
});

describe("authenticated live account status", () => {
  it("returns redacted live status and never exposes credential previews", async () => {
    const config = makeConfig({ auth: { proxyApiKey: PROXY_KEY, accounts: { enabled: true } } });
    const auth = new AuthManager({ accountRotator: createAccountRotator([
      { id: "one", credential: { apiKey: "secret-api-key", provider: "zai" }, plan: "coding-plan" },
    ]) });
    const handler = createFetchHandler({ config, auth });
    const response = await handler(new Request("http://localhost/accounts/status", { headers: { authorization: `Bearer ${PROXY_KEY}` } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.schemaVersion).toBe(1);
    expect(body.source).toBe("live-runtime");
    expect(JSON.stringify(body)).not.toContain("secret-api-key");
    expect(body.accounts[0].credential).toBe("redacted");
  });
});

describe("web UI", () => {
  it("GET /webui serves HTML without the proxy API key", async () => {
    // proxyApiKey is configured, yet /webui must load freely — it sits before
    // the auth gate by design so the page can present the key input.
    const config = makeConfig({ auth: { proxyApiKey: PROXY_KEY } });
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(new Request("http://localhost/webui", { method: "GET" }));
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("text/html");
    const body = await resp.text();
    expect(body).toContain("<!doctype html>");
  });

  it("non-GET /webui is not served as the SPA", async () => {
    const config = makeConfig({ auth: { proxyApiKey: PROXY_KEY } });
    const auth = oauthAuth("test");
    const handler = createFetchHandler({ config, auth, fetchImpl: mockUpstream() });

    const resp = await handler(new Request("http://localhost/webui", { method: "POST" }));
    // POST falls through to the auth gate (proxyApiKey set, no creds) -> 401.
    expect(resp.status).toBe(401);
  });
});

describe("route handler exports", () => {
  it("handleListModels returns model list", () => {
    const resp = handleListModels(new Request("http://localhost/v1/models"));
    expect(resp.status).toBe(200);
  });

  it("handleListModels respects the configured model whitelist", async () => {
    const resp = handleListModels(
      new Request("http://localhost/v1/models"),
      { models: ["glm-5.3", "glm-5.3-flash", "not-in-registry"] },
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((m) => m.id).sort()).toEqual(["glm-5.3", "glm-5.3-flash"]);
  });

  it("handleListModels rich catalog on client_version=pi", async () => {
    const resp = handleListModels(new Request("http://localhost/v1/models?client_version=pi"));
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      models: Array<{
        slug: string;
        context_window: number;
        max_tokens?: number;
        supported_reasoning_levels: Array<{ effort: string }>;
        input_modalities: string[];
        visibility: string;
      }>;
      data?: unknown;
    };
    // Rich shape: top-level models[], no data[].
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.data).toBeUndefined();
    const flash = body.models.find((m) => m.slug === "glm-5.3-flash");
    expect(flash).toBeDefined();
    expect(flash!.context_window).toBe(1_000_000);
    expect(flash!.max_tokens).toBe(128_000);
    expect(flash!.visibility).toBe("list");
    // Only the verified effort levels are advertised (audit: no invented
    // medium/xhigh entries).
    const efforts = flash!.supported_reasoning_levels.map((l) => l.effort);
    expect(efforts).toEqual(["low", "high", "max"]);
    // Registry-derived modalities: flash image input is live-verified, so the
    // pi catalog must NOT hide it behind an id.includes("v") heuristic.
    expect(flash!.input_modalities).toEqual(["text", "image"]);
    // Vision variants advertise image input; unverified reasoning models
    // (glm-4.6v has no efforts entry) expose an empty level list.
    const vModel = body.models.find((m) => m.slug === "glm-4.6v");
    expect(vModel).toBeDefined();
    expect(vModel!.supported_reasoning_levels).toEqual([]);
    expect(vModel!.input_modalities).toEqual(["text", "image"]);
  });

  it("handleMessages is a function", () => {
    expect(typeof handleMessages).toBe("function");
  });
});
