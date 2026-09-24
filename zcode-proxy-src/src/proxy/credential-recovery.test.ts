import { describe, expect, test } from "bun:test";
import { AuthManager } from "../auth/manager.js";
import { proxyRequest } from "./handler.js";
import { handleResponses } from "./responses-handler.js";
import type { ProxyConfig } from "../config/types.js";
import { gzipSync } from "node:zlib";
import { fixtureSecret } from "../test-fixtures.js";

const OLD_KEY = fixtureSecret("recovery-old");
const FRESH_KEY = fixtureSecret("recovery-fresh");

// No store, desktop path, server, routing, signing, captcha or live fetch access.
const config = {
  server: { port: 0, host: "127.0.0.1" }, auth: {}, provider: "zai", plan: "coding-plan",
  providers: { zai: { anthropicBase: "https://fixture.invalid", openaiBase: "https://fixture.invalid" }, bigmodel: { anthropicBase: "https://fixture.invalid", openaiBase: "https://fixture.invalid" } },
  defaultModel: "fixture", models: ["fixture"], identity: { appVersion: "test", sourceTitle: "cli", refererOrigin: "https://fixture.invalid" },
  clientIdentity: { mode: "off", ttlSeconds: 900, maxSessions: 100 },
  responses: { enabled: true, storeMaxEntries: 10, storeTtlMs: 1000 },
  endpointRouting: { enabled: false, origin: "https://fixture.invalid" }, clientSigning: { enabled: false, origin: "https://fixture.invalid" },
  mcp: { enabled: false }, async: { enabled: false }, claim: { enabled: false }, logging: { level: "error" },
} as ProxyConfig;
const first = { apiKey: OLD_KEY, provider: "zai" as const };
const fresh = { apiKey: FRESH_KEY, provider: "zai" as const };
const ok = () => Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: "fixture", content: [{ type: "text", text: "one reply" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 2 } });
function request(route: string, stream = false) {
  return new Request(`http://fixture.invalid/${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(route === "responses" ? { model: "fixture", input: "hi", stream } : { model: "fixture", messages: [{ role: "user", content: "hi" }], max_tokens: 32, stream }) });
}
async function run(route: string, auth: AuthManager, upstream: (req: Request) => Promise<Response>, stream = false) {
  const opts = { config, auth, fetchImpl: upstream as typeof fetch, endpointRouting: null, clientSigning: null };
  return route === "responses" ? handleResponses(request(route, stream), opts) : proxyRequest(request(route, stream), route === "anthropic" ? "anthropic" : "openai", opts);
}
for (const route of ["openai", "anthropic", "responses"]) describe(`${route} safe errors and bounded recovery`, () => {
  for (const status of [400, 401, 403, 429, 500, 503]) test(`preserves HTTP ${status} without upstream body or headers`, async () => {
    const auth = new AuthManager(); auth.setOAuthCredential(first);
    let calls = 0;
    const resp = await run(route, auth, async () => { calls++; return Response.json({ error: { message: "PRIVATE_FIXTURE_DO_NOT_FORWARD" } }, { status, headers: { "set-cookie": "PRIVATE_FIXTURE_DO_NOT_FORWARD", "retry-after": "7" } }); });
    expect(resp.status).toBe(status);
    expect(await resp.text()).not.toContain("PRIVATE_FIXTURE");
    expect(resp.headers.get("set-cookie")).toBeNull();
    if (status === 429) expect(resp.headers.get("retry-after")).toBe("7");
    expect(calls).toBe(1);
  });
  for (const code of [3012, 401, 3001]) test(`retries code ${code} once with changed credential before output`, async () => {
    let imports = 0;
    const auth = new AuthManager({ importCredential: async () => { imports++; return fresh; } }); auth.setOAuthCredential(first);
    const seen: string[] = [];
    const resp = await run(route, auth, async req => {
      seen.push(req.headers.get("authorization") ?? req.headers.get("x-api-key") ?? "");
      return seen.length === 1 ? Response.json({ code, msg: "PRIVATE_FIXTURE" }) : ok();
    });
    expect(resp.status).toBe(200);
    expect((await resp.text()).match(/one reply/g)?.length).toBe(1);
    expect(seen.length).toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(imports).toBe(1);
  });
  test("retries code 1113 once on the same credential, then once with changed credential", async () => {
    let imports = 0;
    const auth = new AuthManager({ importCredential: async () => { imports++; return fresh; } }); auth.setOAuthCredential(first);
    const seen: string[] = [];
    const resp = await run(route, auth, async req => {
      const key = (req.headers.get("authorization") ?? req.headers.get("x-api-key") ?? "").replace(/^Bearer /, "");
      seen.push(key);
      // The gateway keeps reporting the exhausted package until the request
      // carries the replaced credential, then serves from remaining balance.
      return key === OLD_KEY ? Response.json({ code: 1113, msg: "PRIVATE_FIXTURE" }) : ok();
    });
    expect(resp.status).toBe(200);
    expect((await resp.text()).match(/one reply/g)?.length).toBe(1);
    // Same-credential package fall-through first, then the import recovery.
    expect(seen).toEqual([OLD_KEY, OLD_KEY, FRESH_KEY]);
    expect(imports).toBe(1);
  });
  test("remembers a failed same-account retry instead of repeating it", async () => {
    let imports = 0, calls = 0;
    const auth = new AuthManager({ importCredential: async () => { imports++; return first; } }); auth.setOAuthCredential(first);
    for (let i = 0; i < 3; i++) {
      const resp = await run(route, auth, async () => { calls++; return Response.json({ code: 1113, msg: "PRIVATE_FIXTURE" }); });
      expect(resp.status).toBe(400);
      expect(await resp.text()).not.toContain("PRIVATE_FIXTURE");
    }
    // The first request spends its same-account retry; the per-credential
    // memo then suppresses retries until the cooldown, and the unchanged
    // import result never triggers a third send.
    expect(calls).toBe(4); expect(imports).toBe(1);
  });
  test("a failed replacement is returned, not a third request", async () => {
    const auth = new AuthManager({ importCredential: async () => fresh }); auth.setOAuthCredential(first);
    let calls = 0;
    const resp = await run(route, auth, async () => { calls++; return Response.json({ code: 3012, msg: "PRIVATE_FIXTURE" }, { status: 401 }); });
    expect(resp.status).toBe(401); expect(calls).toBe(2);
    expect(await resp.text()).not.toContain("PRIVATE_FIXTURE");
  });
  test("never recovers or duplicates after SSE output, even an in-stream auth error", async () => {
    let imports = 0, calls = 0;
    const auth = new AuthManager({ importCredential: async () => { imports++; return fresh; } }); auth.setOAuthCredential(first);
    const resp = await run(route, auth, async () => { calls++; return new Response('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_fixture","type":"message","role":"assistant","model":"fixture","content":[],"usage":{"input_tokens":1,"output_tokens":0}}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"one reply"}}\n\nevent: error\ndata: {"type":"error","error":{"code":3012,"message":"stream error"}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n', { headers: { "content-type": "text/event-stream" } }); }, true);
    await resp.text(); expect(calls).toBe(1); expect(imports).toBe(0);
  });
  test("concurrent rejected requests share one import and each send at most once more", async () => {
    let imports = 0, calls = 0;
    const auth = new AuthManager({ importCredential: async () => { imports++; await Promise.resolve(); return fresh; } }); auth.setOAuthCredential(first);
    const results = await Promise.all(Array.from({ length: 12 }, () => run(route, auth, async req => {
      calls++;
      return (req.headers.get("authorization") ?? "").includes(FRESH_KEY) ? ok() : Response.json({ code: 3012, msg: "PRIVATE_FIXTURE" });
    })));
    expect(results.every(r => r.status === 200)).toBe(true);
    expect(calls).toBe(24); expect(imports).toBe(1);
    for (const r of results) await r.text();
  });
  if (route !== "anthropic") test("malformed successful upstream body cannot leak through translation errors", async () => {
    const auth = new AuthManager(); auth.setOAuthCredential(first);
    const resp = await run(route, auth, async () => new Response("PRIVATE_FIXTURE not-json"));
    expect(resp.status).toBe(502); expect(await resp.text()).not.toContain("PRIVATE_FIXTURE");
  });
  test("auto-decoded successful JSON with br header remains successful", async () => {
    const auth = new AuthManager(); auth.setOAuthCredential(first);
    const resp = await run(route, auth, async () => {
      const response = ok(); response.headers.set("content-encoding", "br"); return response;
    });
    expect(resp.status).toBe(200); await resp.text();
  });
  for (const compressed of [false, true]) test(`recovers ${compressed ? "compressed" : "auto-decoded"} gzip auth envelope`, async () => {
    const auth = new AuthManager({ importCredential: async () => fresh }); auth.setOAuthCredential(first);
    let calls = 0;
    const resp = await run(route, auth, async () => {
      if (++calls > 1) return ok();
      const raw = JSON.stringify({ code: 3012, msg: "PRIVATE_FIXTURE" });
      return new Response(compressed ? gzipSync(raw) : raw, { headers: { "content-encoding": "gzip", "content-type": "application/json" } });
    });
    expect(resp.status).toBe(200); expect(calls).toBe(2);
    expect((await resp.text()).match(/one reply/g)?.length).toBe(1);
  });
  test("start-plan credential recovery spends a new captcha token exactly once", async () => {
    let tokens = 0;
    const captcha = {
      RETRY_HEADERS: { PARAM: "x-aliyun-captcha-verify-param", REGION: "x-aliyun-captcha-verify-region" },
      getCaptchaToken: async () => ({ verifyParam: `fixture-captcha-${++tokens}`, region: "sgp" }),
      detectCaptchaChallenge: () => null,
    } as any;
    const auth = new AuthManager({ importCredential: async () => ({ ...fresh, jwt: "fixture-jwt-fresh" }) });
    auth.setOAuthCredential({ ...first, jwt: "fixture-jwt-old" });
    const seen: (string | null)[] = [];
    const upstream = async (req: Request) => {
      seen.push(req.headers.get("x-aliyun-captcha-verify-param"));
      return seen.length === 1 ? Response.json({ code: 3012, msg: "PRIVATE_FIXTURE" }, { status: 401 }) : ok();
    };
    const opts = { config: { ...config, plan: "start-plan" as const }, auth, captcha, fetchImpl: upstream as typeof fetch, endpointRouting: null, clientSigning: null };
    const resp = route === "responses" ? await handleResponses(request(route), opts) : await proxyRequest(request(route), route === "anthropic" ? "anthropic" : "openai", opts);
    expect(resp.status).toBe(200); expect(seen).toEqual(["fixture-captcha-1", "fixture-captcha-2"]);
    expect(tokens).toBe(2); expect((await resp.text()).match(/one reply/g)?.length).toBe(1);
  });
  test("transport failure never leaks upstream exception text", async () => {
    const auth = new AuthManager(); auth.setOAuthCredential(first);
    const resp = await run(route, auth, async () => { throw new Error("PRIVATE_FIXTURE"); });
    expect(resp.status).toBe(502); expect(await resp.text()).not.toContain("PRIVATE_FIXTURE");
  });
});
