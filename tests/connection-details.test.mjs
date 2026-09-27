// Connection details for manual client setup: formatter redaction rules and
// the manager's status/start output against mock proxies (synthetic keys only).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { DEFAULT_MODEL_IDS, REDACTED_KEY, configuredModelIds, configuredServer, connectionDetailsLines, isLoopbackHost, shouldRevealKey } from "../cli/connection-details.mjs";
import { createManager } from "../proxy/zcode-proxy-manager.mjs";

const KEY = "kit-test-key-Synthetic123";

test("formatter: URLs derive from the port, the key is shown only when reveal is true, output is plain text", () => {
  const revealed = connectionDetailsLines({ port: 18457, key: KEY, models: ["glm-5.3", "glm-5.3-flash"], source: "running", reveal: true });
  const text = revealed.join("\n");
  assert.match(text, /OpenAI-compatible base URL:\s+http:\/\/127\.0\.0\.1:18457\/v1/);
  assert.match(text, /Anthropic-compatible base URL: http:\/\/127\.0\.0\.1:18457 /);
  assert.match(text, /POST \/v1\/messages/); assert.match(text, /POST \/responses/);
  assert.ok(text.includes(`API key (Bearer / x-api-key):  ${KEY}`));
  assert.match(text, /Model IDs:\s+glm-5\.3, glm-5\.3-flash/);
  assert.match(text, /running and verified/);
  assert.doesNotMatch(text, /Start the proxy first/);
  const redacted = connectionDetailsLines({ port: 8457, key: KEY, source: "configured", reveal: false }).join("\n");
  assert.ok(!redacted.includes(KEY), "key never printed without reveal");
  assert.ok(redacted.includes(REDACTED_KEY));
  assert.match(redacted, /from configuration; proxy not verified running/);
  assert.match(redacted, /Start the proxy first: zcode-kit proxy start/);
  assert.match(redacted, /glm-5\.3, glm-5\.3-flash/, "default model ids");
  for (const line of [...revealed, ...redacted.split("\n")]) {
    assert.doesNotMatch(line, /\x1b\[/, "no ANSI escapes");
    assert.doesNotMatch(line, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️]/u, "no emojis or symbol glyphs");
  }
});

test("shouldRevealKey: both stdin and stdout on a terminal, not in CI, never for JSON", () => {
  const tty = { isTTY: true }, pipe = { isTTY: false };
  assert.equal(shouldRevealKey({ stdin: tty, stdout: tty, env: {} }), true);
  assert.equal(shouldRevealKey({ stdin: pipe, stdout: tty, env: {} }), false, "piped stdin (scripts, installers) never reveals");
  assert.equal(shouldRevealKey({ stdin: tty, stdout: pipe, env: {} }), false, "piped stdout (logs) never reveals");
  assert.equal(shouldRevealKey({ stdin: tty, stdout: {}, env: {} }), false);
  assert.equal(shouldRevealKey({ stdin: tty, stdout: tty, env: {}, json: true }), false);
  assert.equal(shouldRevealKey({ stdin: tty, stdout: tty, env: { CI: "true" } }), false, "CI runners never reveal");
  assert.equal(shouldRevealKey({ stdin: tty, stdout: tty, env: { CI: "1" } }), false);
  assert.equal(shouldRevealKey({ stdin: tty, stdout: tty, env: { CI: "false" } }), true);
  assert.equal(shouldRevealKey({ stdin: tty, stdout: tty, env: { CI: "0" } }), true);
});

test("formatter: Responses route follows the config switch, a non-loopback host is shown with a warning", () => {
  const noResponses = connectionDetailsLines({ port: 8457, key: KEY, responsesEnabled: false }).join("\n");
  assert.doesNotMatch(noResponses, /POST \/responses/);
  assert.match(noResponses, /POST \/chat\/completions, GET \/models/);
  const exposed = connectionDetailsLines({ port: 8457, key: KEY, host: "0.0.0.0" }).join("\n");
  assert.match(exposed, /http:\/\/0\.0\.0\.0:8457\/v1/, "the real listener host is shown, not a loopback guess");
  assert.match(exposed, /WARNING: server.host is 0\.0\.0\.0/);
  for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "::1"]) assert.equal(isLoopbackHost(host), true, host);
  for (const host of ["0.0.0.0", "192.168.1.5", "example.org"]) assert.equal(isLoopbackHost(host), false, host);
  const localhost = connectionDetailsLines({ port: 8457, key: KEY, host: "localhost" }).join("\n");
  assert.match(localhost, /http:\/\/127\.0\.0\.1:8457\/v1/, "loopback aliases are printed as 127.0.0.1");
  assert.doesNotMatch(localhost, /WARNING/);
});

test("formatter: a verified proxy says when the model list came from configuration; an IPv6 loopback listener keeps its URL", () => {
  const fromConfig = connectionDetailsLines({ port: 1, key: KEY, source: "running", modelsSource: "config" }).join("\n");
  assert.match(fromConfig, /Model IDs:.*\(from configuration; live model list unavailable\)/);
  const live = connectionDetailsLines({ port: 1, key: KEY, source: "running", modelsSource: "live" }).join("\n");
  assert.doesNotMatch(live, /live model list unavailable/);
  const unverified = connectionDetailsLines({ port: 1, key: KEY, source: "configured", modelsSource: "config" }).join("\n");
  assert.doesNotMatch(unverified, /live model list unavailable/, "only a verified proxy has a live list to miss");
  const v6 = connectionDetailsLines({ port: 1, key: KEY, host: "::1" }).join("\n");
  assert.match(v6, /http:\/\/\[::1\]:1\/v1/);
  assert.doesNotMatch(v6, /WARNING/);
  const v6Global = connectionDetailsLines({ port: 1, key: KEY, host: "fd00::5" }).join("\n");
  assert.match(v6Global, /http:\/\/\[fd00::5\]:1\/v1/, "every IPv6 literal gets brackets in the URL");
  assert.match(v6Global, /WARNING: server.host is fd00::5/);
});

test("configuredServer reads host and the Responses switch, with template defaults when absent", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kit-conn-srv-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cfg = join(dir, "config.yaml");
  writeFileSync(cfg, "server:\n  host: \"0.0.0.0\"\n  port: 8457\nresponses:\n  enabled: false\n  maxRetries: 2\n");
  assert.deepEqual(configuredServer(cfg), { host: "0.0.0.0", responsesEnabled: false });
  writeFileSync(cfg, "server:\n  port: 8457\n  host: 127.0.0.1\nresponses:\n  enabled: true\n");
  assert.deepEqual(configuredServer(cfg), { host: "127.0.0.1", responsesEnabled: true });
  writeFileSync(cfg, "server:\n  port: 8457\n");
  assert.deepEqual(configuredServer(cfg), { host: "127.0.0.1", responsesEnabled: true });
  assert.deepEqual(configuredServer(join(dir, "missing.yaml")), { host: "127.0.0.1", responsesEnabled: true });
});

test("configuredModelIds reads the config list and falls back to the registry snapshot", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "kit-conn-cfg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cfg = join(dir, "config.yaml");
  writeFileSync(cfg, "server:\n  port: 1\nmodels:\n  - glm-5.3\n  - \"glm-5.3-flash\"\n  - glm-4.7\nidentity:\n  appVersion: \"3.11.2\"\n");
  assert.deepEqual(configuredModelIds(cfg), ["glm-5.3", "glm-5.3-flash", "glm-4.7"]);
  writeFileSync(cfg, "server:\n  port: 1\n");
  assert.deepEqual(configuredModelIds(cfg), DEFAULT_MODEL_IDS);
  assert.deepEqual(configuredModelIds(join(dir, "missing.yaml")), DEFAULT_MODEL_IDS);
  assert.deepEqual(configuredModelIds(undefined), DEFAULT_MODEL_IDS);
});

// ------------------------------------------------------------- manager
let server = null;
afterEach(() => { if (server) { server.closeAllConnections?.(); server.close(); server = null; } });

function kitRoot(port) {
  const root = mkdtempSync(join(tmpdir(), "kit-conn-mgr-"));
  mkdirSync(join(root, "proxy")); mkdirSync(join(root, "logs"));
  writeFileSync(join(root, "proxy", "config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${port}\nmodels:\n  - glm-5.3\n  - glm-5.3-flash\n`);
  writeFileSync(join(root, ".proxykey"), KEY + "\n");
  return root;
}
async function mockProxy({ mode = "ours", models = [{ id: "mock-a" }, { id: "mock-b" }] } = {}) {
  const srv = http.createServer((req, res) => {
    if (mode === "wrong-key" || req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401).end(); return; }
    if (req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", provider: "zai" })); return; }
    if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: models })); return; }
    if (req.url === "/quota") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ provider: "zai", balances: [] })); return; }
    res.writeHead(404).end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  return srv;
}
async function capture(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try { return { code: await fn(), text: lines.join("\n") }; } finally { console.log = original; }
}

test("status on the own running proxy prints verified details with live model ids and never the key (no terminal)", async (t) => {
  server = await mockProxy();
  const root = kitRoot(server.address().port);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const m = createManager({ root, home: root });
  const keyFile = join(root, ".proxykey");
  const before = { text: readFileSync(keyFile, "utf8"), mtime: statSync(keyFile).mtimeMs };
  const first = await capture(() => m.status());
  assert.equal(first.code, 0);
  assert.match(first.text, /health:\s+ours/);
  assert.match(first.text, /running and verified/);
  assert.match(first.text, new RegExp(`http://127\\.0\\.0\\.1:${server.address().port}/v1`));
  assert.match(first.text, /Model IDs:\s+mock-a, mock-b/, "ids come from the running instance");
  assert.ok(!first.text.includes(KEY), "key redacted outside a terminal");
  assert.ok(first.text.includes(REDACTED_KEY));
  const second = await capture(() => m.status());
  assert.equal(second.code, 0);
  assert.deepEqual({ text: readFileSync(keyFile, "utf8"), mtime: statSync(keyFile).mtimeMs }, before, "status never creates or rotates the key");
});

test("status --json: one parseable object, redacted connection block for the own proxy, never the key", async (t) => {
  server = await mockProxy();
  const port = server.address().port;
  const root = kitRoot(port);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = await capture(() => createManager({ root, home: root }).status({ json: true }));
  assert.equal(r.code, 0);
  const j = JSON.parse(r.text); // nothing but the object on stdout
  assert.equal(j.schemaVersion, 1);
  assert.equal(j.health, "ours");
  assert.equal(j.port, port);
  assert.equal(j.connection.source, "running");
  assert.equal(j.connection.openaiBaseUrl, `http://127.0.0.1:${port}/v1`);
  assert.equal(j.connection.anthropicBaseUrl, `http://127.0.0.1:${port}`);
  assert.deepEqual(j.connection.models, ["mock-a", "mock-b"]);
  assert.equal(j.connection.modelsSource, "live");
  assert.deepEqual(j.connection.key, { redacted: true, export: "zcode-kit models --show-key" });
  assert.deepEqual(j.quota, []);
  assert.ok(!r.text.includes(KEY), "the key never appears in JSON");
});

test("status --json: a stopped proxy reports configured values, a foreign port reports no connection", async (t) => {
  const probe = await mockProxy(); const port = probe.address().port; probe.close();
  const root = kitRoot(port);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const down = await capture(() => createManager({ root, home: root }).status({ json: true }));
  assert.equal(down.code, 1);
  const d = JSON.parse(down.text);
  assert.equal(d.health, "down");
  assert.equal(d.connection.source, "configured");
  assert.equal(d.connection.modelsSource, "config");
  assert.deepEqual(d.connection.models, ["glm-5.3", "glm-5.3-flash"]);
  assert.equal(d.quota, null);
  server = await mockProxy({ mode: "wrong-key" });
  const foreignRoot = kitRoot(server.address().port);
  t.after(() => rmSync(foreignRoot, { recursive: true, force: true }));
  const foreign = await capture(() => createManager({ root: foreignRoot, home: foreignRoot }).status({ json: true }));
  assert.equal(foreign.code, 1);
  const f = JSON.parse(foreign.text);
  assert.equal(f.health, "foreign");
  assert.equal(f.connection, null);
  assert.ok(!foreign.text.includes(KEY));
});

test("status on a stopped proxy labels configured values and never claims a running proxy", async (t) => {
  const probe = await mockProxy(); const port = probe.address().port; probe.close();
  const root = kitRoot(port);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = await capture(() => createManager({ root, home: root }).status());
  assert.equal(r.code, 1);
  assert.match(r.text, /health:\s+down/);
  assert.match(r.text, /from configuration; proxy not verified running/);
  assert.doesNotMatch(r.text, /running and verified/);
  assert.match(r.text, /Model IDs:\s+glm-5\.3, glm-5\.3-flash/, "configured list when nothing runs");
  assert.ok(!r.text.includes(KEY));
});

test("status withholds details when the port is answered by a foreign service", async (t) => {
  server = await mockProxy({ mode: "wrong-key" });
  const root = kitRoot(server.address().port);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const r = await capture(() => createManager({ root, home: root }).status());
  assert.equal(r.code, 1);
  assert.match(r.text, /health:\s+foreign/);
  assert.match(r.text, /connection details withheld/);
  assert.doesNotMatch(r.text, /base URL/);
});

test("start on an already running own proxy exits 0 and the details are re-verified before printing", async (t) => {
  server = await mockProxy();
  const root = kitRoot(server.address().port);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const m = createManager({ root, home: root });
  const started = await capture(() => m.start());
  assert.equal(started.code, 0, started.text);
  assert.match(started.text, /already running/);
  const details = await capture(async () => { await m.printConnectionDetails("running"); return 0; });
  assert.match(details.text, /running and verified/);
  assert.match(details.text, /mock-a, mock-b/);
  server.closeAllConnections(); server.close(); server = null;
  const gone = await capture(async () => { await m.printConnectionDetails("running"); return 0; });
  assert.match(gone.text, /proxy not verified running/, "a proxy that stopped meanwhile is not shown as verified");
  assert.doesNotMatch(gone.text, /running and verified/);
});
