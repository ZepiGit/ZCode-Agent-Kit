// `doctor --upstream`: comparison of the kit's gateway with the provider
// configuration the ZCode client receives, both answer shapes, network
// boundaries, and drift between the kit table and the proxy's constants.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, cpSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import {
  KIT_GATEWAY_BASES, REFERENCE_APP_VERSION, UPSTREAM_ORIGIN_ENV, compareUpstream, fetchUpstreamProviders, readProxyTarget,
  resolveUpstreamOrigin, upstreamChecks,
} from "../cli/upstream-config.mjs";

const KIT = join(import.meta.dirname, "..");
let server = null;
afterEach(() => { if (server) { server.closeAllConnections?.(); server.close(); server = null; } });

function rule(mode, accountType, baseUrl, models) {
  return { providerId: `account:${accountType}-${mode}`, config: { access: { type: "zhipu-account", mode, accountType }, api: { type: "anthropic-messages", baseUrl }, builtinModelIds: models } };
}
const RELEASE = {
  schemaVersion: 1, revision: 23,
  config: {
    providerConfigRules: {
      templateRules: [],
      providerRules: [
        rule("individual-coding-plan", "zai", "https://api.z.ai/api/anthropic", ["GLM-5.3", "GLM-5.3-Flash"]),
        rule("start-plan", "zai", "https://zcode.z.ai/api/v1/zcode-plan/anthropic", ["GLM-5.3-Flash", "GLM-5.2"]),
        rule("individual-coding-plan", "bigmodel", "https://open.bigmodel.cn/api/anthropic", ["GLM-5.3"]),
      ],
    },
    modelConfigRules: {},
  },
};
const LEGACY = { code: 0, msg: "", data: { providers: [
  { id: "z-ai", schema: "anthropic", baseUrl: "https://api.z.ai/api/anthropic", models: [{ modelId: "GLM-5.2" }] },
  { id: "z-ai", schema: "openai:chat", baseUrl: "https://api.z.ai/api/coding/paas/v4", models: [] },
], configs: {} } };

/** Loopback vendor double: `routes(appVersion)` picks the answer; every request is recorded. */
async function vendor(routes) {
  const requests = [];
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const body = routes(url, origin);
    if (body === "redirect") { res.writeHead(302, { location: "https://example.org/x" }).end(); return; }
    if (body === "hang") return;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}
const releaseRoutes = (url, origin) => url.pathname === "/release.json" ? RELEASE
  : { code: 0, data: { configs: { builtin_provider_config_json: `${origin}/release.json` } } };
function config(dir, { provider = "zai", plan = "start-plan", appVersion = "3.14.3", models = ["glm-5.3", "glm-5.3-flash"] } = {}) {
  const path = join(dir, "config.yaml");
  writeFileSync(path, `provider: ${provider}\nplan: ${plan}\nmodels:\n${models.map((m) => `  - ${m}\n`).join("")}identity:\n  appVersion: "${appVersion}"\n`);
  return path;
}

test("the kit's gateway table matches the proxy's own constants (no silent drift)", () => {
  const providers = readFileSync(join(KIT, "zcode-proxy-src", "src", "provider", "providers.ts"), "utf8");
  const upstream = readFileSync(join(KIT, "zcode-proxy-src", "src", "proxy", "upstream.ts"), "utf8");
  const anthropicBase = (id) => providers.match(new RegExp(`id: "${id}",[\\s\\S]*?anthropicBaseURL: "([^"]+)"`))?.[1];
  assert.equal(KIT_GATEWAY_BASES["coding-plan"].zai, anthropicBase("zai"));
  assert.equal(KIT_GATEWAY_BASES["coding-plan"].bigmodel, anthropicBase("bigmodel"));
  const startPlan = upstream.match(/const STARTPLAN_ANTHROPIC_BASE = "([^"]+)"/)?.[1];
  assert.ok(startPlan, "STARTPLAN_ANTHROPIC_BASE found");
  assert.match(upstream, /STARTPLAN_ANTHROPIC_BASE\}\/anthropic/, "start-plan requests go to <base>/anthropic");
  for (const provider of ["zai", "bigmodel"]) assert.equal(KIT_GATEWAY_BASES["start-plan"][provider], `${startPlan}/anthropic`);
});

test("readProxyTarget reads provider, plan, identity.appVersion and models", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kit-up-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readProxyTarget(config(dir, { provider: "bigmodel", plan: "coding-plan", appVersion: "3.9.0", models: ["glm-5.3"] })),
    { provider: "bigmodel", plan: "coding-plan", appVersion: "3.9.0", models: ["glm-5.3"] });
  const defaults = readProxyTarget(join(dir, "missing.yaml"));
  assert.equal(defaults.plan, "start-plan");
  assert.equal(defaults.provider, "zai");
});

test("release shape: matching base PASS, moved base FAIL with the new URL, models informational; no credentials, platform and version sent", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kit-up-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const v = await vendor(releaseRoutes);
  const env = { [UPSTREAM_ORIGIN_ENV]: v.origin };
  const pass = await upstreamChecks(config(dir, { plan: "start-plan" }), { env });
  assert.equal(pass[0].ok, true, JSON.stringify(pass));
  assert.match(pass[0].detail, /remote provider release rev 23/);
  assert.equal(pass[1].ok, null, "glm-5.3 is not offered for start-plan: informational");
  assert.match(pass[1].detail, /glm-5\.3\b/);
  assert.equal(v.requests[0].path, "/api/v1/client/configs");
  assert.deepEqual(v.requests[0].query, { app_version: "3.14.3", platform: "win32-x64" });
  for (const r of v.requests) assert.equal(r.headers.authorization, undefined);
  const moved = compareUpstream({ provider: "zai", plan: "coding-plan", appVersion: "x", models: ["glm-5.3"] },
    { shape: "release", revision: 24, entries: [{ provider: "zai", mode: "individual-coding-plan", baseUrl: "https://api.z.ai/api/v2/anthropic", models: ["GLM-5.3"] }] });
  assert.equal(moved[0].ok, false);
  assert.match(moved[0].detail, /now uses https:\/\/api\.z\.ai\/api\/v2\/anthropic/);
  assert.equal(moved[1].ok, true, "model ids compare case-insensitively");
});

test("legacy shape: coding-plan compared from the provider list; start-plan falls back to the reference client version", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kit-up-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const v = await vendor((url, origin) => url.searchParams.get("app_version") === REFERENCE_APP_VERSION ? releaseRoutes(url, origin) : url.pathname === "/release.json" ? RELEASE : LEGACY);
  const env = { [UPSTREAM_ORIGIN_ENV]: v.origin };
  const coding = await upstreamChecks(config(dir, { plan: "coding-plan", appVersion: "3.11.2" }), { env });
  assert.equal(coding[0].ok, true);
  assert.match(coding[0].detail, /provider list/);
  const start = await upstreamChecks(config(dir, { plan: "start-plan", appVersion: "3.11.2" }), { env });
  assert.equal(start[0].ok, true, JSON.stringify(start));
  assert.match(start[0].detail, /as served to app 3\.14\.3; the kit announces 3\.11\.2/);
});

test("network boundaries: redirects, foreign release hosts, stalls and junk are SKIPs; non-loopback http origins are refused", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kit-up-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cfg = config(dir);
  for (const answer of ["redirect", { code: 0, data: { configs: { builtin_provider_config_json: "https://evil.example.org/r.json" } } }, { code: 3001, msg: "parameter error" }, { nonsense: true }]) {
    const v = await vendor(() => answer);
    const checks = await upstreamChecks(cfg, { env: { [UPSTREAM_ORIGIN_ENV]: v.origin } });
    assert.equal(checks.length, 1);
    assert.equal(checks[0].ok, null, JSON.stringify(checks));
    assert.match(checks[0].detail, /unreachable or unreadable/);
    assert.ok(!v.requests.some((r) => r.path === "/x"), "a redirect is never followed");
    server.close(); server = null;
  }
  const hang = await vendor(() => "hang");
  const started = Date.now();
  const stalled = await upstreamChecks(cfg, { env: { [UPSTREAM_ORIGIN_ENV]: hang.origin }, timeoutMs: 300 });
  assert.equal(stalled[0].ok, null);
  assert.ok(Date.now() - started < 5000, "bounded");
  assert.throws(() => resolveUpstreamOrigin({ [UPSTREAM_ORIGIN_ENV]: "http://zcode.example.org" }), /https origin/);
  assert.equal(resolveUpstreamOrigin({}), "https://zcode.z.ai");
  await assert.rejects(fetchUpstreamProviders({ appVersion: "1", origin: "http://127.0.0.1:9", fetchImpl: async () => { throw new Error("offline"); } }), /offline/);
});

test("the default doctor never calls the vendor; --upstream does", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "kit-up-e2e-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const member of ["cli", "lib"]) cpSync(join(KIT, member), join(root, member), { recursive: true });
  mkdirSync(join(root, "proxy")); mkdirSync(join(root, "logs")); mkdirSync(join(root, "zcode-proxy-src"));
  cpSync(join(KIT, "proxy", "zcode-proxy-manager.mjs"), join(root, "proxy", "zcode-proxy-manager.mjs"));
  cpSync(join(KIT, "zcode-proxy-src", "package.json"), join(root, "zcode-proxy-src", "package.json"));
  symlinkSync(join(KIT, "zcode-proxy-src", "node_modules"), join(root, "zcode-proxy-src", "node_modules"), process.platform === "win32" ? "junction" : "dir");
  config(join(root, "proxy"));
  const home = join(root, "home"); mkdirSync(home);
  const v = await vendor(releaseRoutes);
  const env = { ...process.env, HOME: home, USERPROFILE: home, [UPSTREAM_ORIGIN_ENV]: v.origin, ZCODE_KIT_SKIP_DEPS: "1", ZCODE_PROXY_CREDENTIALS_PATH: join(home, "c.json") };
  const run = (args) => new Promise((resolve) => execFile(process.execPath, [join(root, "cli", "zcode-kit.mjs"), ...args], { env, encoding: "utf8", timeout: 60000 },
    (err, stdout) => resolve({ code: err ? err.code : 0, stdout })));
  await run(["doctor", "--json"]);
  assert.equal(v.requests.length, 0, "no vendor request without --upstream");
  const r = await run(["doctor", "--json", "--upstream"]);
  const checks = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))).checks;
  assert.ok(checks.some((c) => c.name === "upstream gateway (zai, start-plan)" && c.ok === true), r.stdout);
  assert.ok(v.requests.length >= 2);
});
