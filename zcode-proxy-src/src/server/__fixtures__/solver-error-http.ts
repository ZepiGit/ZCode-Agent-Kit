import assert from "node:assert/strict";
import { mock } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ProxyConfig } from "../../config/types.js";

// Permanent isolated regression fixture. Seam4: real loopback listener and route/error
// mapping; seam3: real pool with an injected synthetic solver dispatcher.
// No vendor SDK execution, account-store access, or production code edits.
const ROOT = fileURLToPath(new URL("../../", import.meta.url)).replace(/[\\/]$/, "");
let PORT = 0;
const KEY = "t82-offline-listener-fixture-not-a-secret";
const nativeFetch = globalThis.fetch;
let localRequests = 0;
let blockedExternalFetches = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== `http://127.0.0.1:${PORT}`) {
    blockedExternalFetches += 1;
    throw new Error("offline probe blocks non-owned fetch destinations");
  }
  localRequests += 1;
  return nativeFetch(input, init);
}) as typeof fetch;

const { CaptchaTokenPool } = await import(`${ROOT}/proxy/captcha-pool.ts`);
const { CaptchaSdkError } = await import(`${ROOT}/proxy/captcha-token.ts`);
let activePool: InstanceType<typeof CaptchaTokenPool> | null = null;
let publicTakes = 0;
const poolConfig = { enabled: true, prefix: "offline-fixture", sceneId: "offline-fixture", region: "sgp" };
const takeFromFixturePool = async () => {
  publicTakes += 1;
  assert.ok(activePool, "probe must supply its own synthetic pool");
  return { verifyParam: await activePool.takeToken(poolConfig), region: "sgp" };
};
const captchaFixture = {
  RETRY_HEADERS: { PARAM: "x-aliyun-captcha-verify-param", REGION: "x-aliyun-captcha-verify-region" },
  detectCaptchaChallenge: (resp: Response) => resp.headers.get("x-aliyun-captcha-verify-param"),
  getCaptchaToken: takeFromFixturePool,
};
mock.module(`${ROOT}/proxy/captcha.ts`, () => captchaFixture);
const loadedCaptcha = await import(`${ROOT}/proxy/captcha.ts`);
assert.equal(loadedCaptcha.getCaptchaToken, takeFromFixturePool, "real SDK must not be loaded");
const { startServer } = await import(`${ROOT}/server/server.ts`);
const { AuthManager } = await import(`${ROOT}/auth/manager.ts`);

const config: ProxyConfig = {
  server: { port: PORT, host: "127.0.0.1" },
  auth: { proxyApiKey: KEY }, provider: "zai", plan: "start-plan",
  providers: {
    zai: { anthropicBase: "https://offline.invalid/anthropic", openaiBase: "https://offline.invalid/openai" },
    bigmodel: { anthropicBase: "https://offline.invalid/anthropic", openaiBase: "https://offline.invalid/openai" },
  },
  defaultModel: "glm-4.6", models: ["glm-4.6"],
  identity: { appVersion: "offline-fixture", sourceTitle: "cli", refererOrigin: "https://offline.invalid" },
  clientIdentity: { mode: "off", ttlSeconds: 900, maxSessions: 1024 },
  responses: { enabled: true, storeMaxEntries: 1000, storeTtlMs: 86400000 },
  endpointRouting: { enabled: false, origin: "https://offline.invalid" },
  clientSigning: { enabled: false, origin: "https://offline.invalid" },
  mcp: { enabled: false, webSearch: false, webReader: false, zread: false },
  async: { enabled: false, origin: "https://offline.invalid", pollIntervalMs: 5000, keepAliveIntervalMs: 3000, maxWaitMs: 0, maxRetries: 3, settleTimeoutMs: 8000, controlTimeoutMs: 15000, defaultModel: "" },
  claim: { enabled: false, auto: false, origin: "https://offline.invalid", pollIntervalMs: 300000, cooldownMs: 600000, planId: "" },
  logging: { level: "info" },
};
const auth = new AuthManager();
auth.setOAuthCredential({ apiKey: "offline-upstream-fixture-not-a-secret", jwt: "offline-jwt-fixture-not-a-secret", provider: "zai" });
let upstreamCalls = 0;
const fetchImpl = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
  upstreamCalls += 1;
  return new Response('{"code":3007,"msg":"synthetic challenge"}', { status: 400, headers: { "content-type": "application/json" } });
}) as typeof fetch;
const paths = ["/v1/chat/completions", "/v1/messages", "/v1/responses"];
const bodyFor = (path: string) => path === "/v1/responses"
  ? { model: "glm-4.6", input: "offline fixture", stream: false }
  : { model: "glm-4.6", max_tokens: 8, messages: [{ role: "user", content: "offline fixture" }], stream: false };
let executed = 0;
let passed = 0;
const failures: string[] = [];
const records: unknown[] = [];
const previousWarning = console.warn;
let warningMarkerVisible = false;
let marker = "";
console.warn = (...values) => { warningMarkerVisible ||= marker !== "" && values.some(v => String(v).includes(marker)); };
const server = await startServer({ config, auth, fetchImpl });
PORT = server.port;
try {
  // Auth controls must execute before a pool is installed and before upstream.
  for (const path of paths) {
    const resp = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong-offline-fixture", connection: "close" }, body: JSON.stringify(bodyFor(path)), signal: AbortSignal.timeout(5000) });
    const body = await resp.json() as { error: { type: string } };
    assert.equal(resp.status, 401);
    assert.equal(body.error.type, "authentication_error");
    assert.equal(publicTakes, 0);
    assert.equal(upstreamCalls, 0);
    executed += 1; passed += 1;
    records.push({ scenario: "wrong-key-control", path, pass: true, status: resp.status });
  }

  for (const scenario of ["trusted-no-marker-control", "raw-untrusted-marker", "mutable-sdk-marker"]) {
    marker = scenario === "trusted-no-marker-control" ? "" : scenario === "raw-untrusted-marker" ? "SyntheticHttpRawCredentialMarker" : "SyntheticHttpTypedCredentialMarker";
    warningMarkerVisible = false;
    let mints = 0;
    const dispatcher = {
      run: async () => {
        mints += 1;
        const error = scenario === "raw-untrusted-marker" ? new Error("synthetic solver failure") : new CaptchaSdkError("other");
        if (marker) error.message += ` | ${marker}`;
        throw error;
      },
      concurrency: () => 1,
      stats: () => ({ mode: "worker", alive: false, busy: false, queueDepth: 0, generation: 0, solvesSinceSpawn: 0, totalSolves: mints, totalFailures: mints, consecutiveFailures: mints, deadlineKills: 0, recycles: 0, lastRecycleReason: null, lastRecycleAt: null, lastSdkScripts: null }),
      requestRecycle: () => {},
    };
    activePool = new CaptchaTokenPool({ poolSizeMin: 1, poolSizeMax: 1, tokenTtlMs: 60000, refillIntervalMs: 600000, staggerMs: 0, solveRetries: 1, solveConcurrency: 1, emptyTakeRace: 1, scaleDownIdleMs: 600000, deepIdleAfterMs: 600000, cpuLimitPercent: 0, now: () => 2000000 }, dispatcher);
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) await activePool.prefill(poolConfig);
      assert.equal(activePool.stats().storm, true, "real pool storm path required");
      assert.equal(mints, 5);
      for (const path of paths) {
        const beforeUpstream = upstreamCalls;
        const beforeTakes = publicTakes;
        const resp = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, connection: "close" }, body: JSON.stringify(bodyFor(path)), signal: AbortSignal.timeout(5000) });
        const text = await resp.text();
        const body = JSON.parse(text) as { error: { type: string; message: string } };
        assert.equal(resp.status, 503, "must reach real solver error mapping, not a route/config failure");
        assert.equal(body.error.type, "captcha_solver_failed");
        assert.ok(body.error.message.startsWith("captcha minting degraded (storm)"));
        assert.equal(upstreamCalls - beforeUpstream, 1, "synthetic upstream only; no resend on solver failure");
        assert.equal(publicTakes - beforeTakes, 2, "initial take plus challenged solve must use fixture pool");
        assert.equal(mints, 5, "storm must not execute extra solver work");
        const markerVisible = marker !== "" && text.includes(marker);
        assert.ok(body.error.message.length < 400, "bounded host-built error required");
        const pass = !markerVisible && !warningMarkerVisible;
        executed += 1;
        if (pass) passed += 1; else failures.push(`${scenario}:${path}`);
        records.push({ scenario, path, pass, status: resp.status, type: body.error.type, markerVisible, responseBytes: Buffer.byteLength(text), warningMarkerVisible, mints, upstreamCallsThisRequest: upstreamCalls - beforeUpstream });
      }
    } finally {
      activePool.stopBackgroundRefill();
      activePool = null;
    }
  }
} finally {
  await server.close();
  console.warn = previousWarning;
  globalThis.fetch = nativeFetch;
}
for (const record of records) console.log(JSON.stringify(record));
console.log(JSON.stringify({ executed, passed, failed: failures.length, failures, localRequests, upstreamFixtureCalls: upstreamCalls, blockedExternalFetches, syntheticOnly: true, liveUpstreamRequests: 0, listenerClosed: true, pid: process.pid }));
assert.equal(executed, 12, "all auth/security/control cases must run");
assert.equal(localRequests, 12);
assert.equal(upstreamCalls, 9);
assert.equal(blockedExternalFetches, 0, "no unexpected external fetch attempted");
assert.equal(failures.length, 0, "client-visible solver failures must exclude untrusted raw or mutable SDK message text");
