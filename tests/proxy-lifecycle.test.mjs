// Seam 2: the proxy lifecycle module (lib/proxy-lifecycle.mjs, spec §4,
// ticket 15). Its interface is the lifecycle intents (ensure running, stop,
// restart, budgeted respawn request, read state); the intents print nothing
// and return outcome records, and every caller renders them itself.
//   - the preflight entry's import closure holds no output/presentation module
//     (statically, and in a spawned preflight run);
//   - the intents print nothing and return outcome records;
//   - frozen contracts: an old proxy (origin/main) calling the new manager's
//     `respawn <pid> --reason <r>` CLI gets a fresh proxy, and every proxy
//     the kit spawns carries the `ZCODE_KIT_RESPAWN_NODE`/`_MANAGER` hook.
// Ports 19150-19159 (ticket 15's range).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBun } from "../lib/process.mjs";

const ROOT = join(import.meta.dirname, "..");
const KEY = "synthetic-lifecycle-key";
const rel = (file) => relative(ROOT, file).split(sep).join("/");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

// ------------------------------------------------------------ module graph
// Output/presentation code: the output module and its tokens/width core, the
// proxy TUI, the CLI command modules (they render records), the connection
// details card, setup's output, the consent prompts, and the manager CLI
// (status/doctor/logs rendering and its connection details).
const PRESENTATION = /^(?:lib\/term\/|zcode-proxy-src\/src\/tui\/|cli\/commands\/|cli\/connection-details\.mjs$|cli\/setup-output\.mjs$|cli\/harness-consent\.mjs$|proxy\/zcode-proxy-manager\.mjs$)/;

/** Relative imports of a module: static imports, re-exports and literal dynamic import()s. */
function imports(file) {
  const source = stripComments(readFileSync(file, "utf8"));
  const specs = [
    ...[...source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2]),
    ...[...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  return specs.filter((s) => s.startsWith(".")).map((s) => resolve(dirname(file), s)).filter((p) => existsSync(p));
}
function closure(entry) {
  const seen = new Set();
  const walk = (file) => { if (seen.has(file)) return; seen.add(file); for (const dep of imports(file)) walk(dep); };
  walk(join(ROOT, entry));
  return [...seen].map(rel);
}

test("the preflight entry's import closure (static and dynamic) contains no output/presentation module", () => {
  const files = closure("cli/heal.mjs");
  assert.ok(files.includes("lib/proxy-lifecycle.mjs"), `the preflight reaches the lifecycle module (closure: ${files.join(", ")})`);
  assert.deepEqual(files.filter((f) => PRESENTATION.test(f)), []);
});

test("the closure walk follows dynamic imports into presentation code (the walk is not vacuous)", () => {
  // cli/commands/setup.mjs reaches setup output statically and heal.mjs by a dynamic import().
  const files = closure("cli/commands/setup.mjs");
  for (const f of ["cli/setup-output.mjs", "cli/heal.mjs", "lib/proxy-lifecycle.mjs"]) assert.ok(files.includes(f), `${f} reached`);
  assert.ok(closure("proxy/zcode-proxy-manager.mjs").includes("cli/connection-details.mjs"));
});

// ---------------------------------------------------------------- fixtures
/** A kit copy (cli/, lib/, the manager) in a temp root that is also its state directory. */
function kitFixture(t, port, { proxySrc = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kit-lifecycle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const member of ["cli", "lib"]) cpSync(join(ROOT, member), join(root, member), { recursive: true });
  mkdirSync(join(root, "proxy")); mkdirSync(join(root, "logs")); mkdirSync(join(root, "home"));
  cpSync(join(ROOT, "proxy", "zcode-proxy-manager.mjs"), join(root, "proxy", "zcode-proxy-manager.mjs"));
  writeFileSync(join(root, "proxy", "config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${port}\nauth:\n  proxyApiKey: "${KEY}"\n`);
  writeFileSync(join(root, ".proxykey"), KEY + "\n");
  if (proxySrc) {
    mkdirSync(join(root, "zcode-proxy-src", "node_modules"), { recursive: true });
    mkdirSync(join(root, "zcode-proxy-src", "src"));
    writeFileSync(join(root, "zcode-proxy-src", "src", "index.ts"), FAKE_PROXY);
  }
  return root;
}

function childEnv(root, extra = {}) {
  const env = { ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home"), ...extra };
  delete env.ZCODE_KIT_STATE_DIR; // the fixture root is the state directory
  return env;
}

// A stand-in for the proxy: answers the identity proof with the key from its
// config, and records the respawn hook environment it was spawned with.
const FAKE_PROXY = `
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
const config = readFileSync(process.env.ZCODE_PROXY_CONFIG, "utf8");
const port = Number(config.match(/^  port:\\s*(\\d+)/m)[1]);
const key = config.match(/proxyApiKey:\\s*"([^"]+)"/)[1];
if (process.env.FAKE_PROXY_ENV_OUT) writeFileSync(process.env.FAKE_PROXY_ENV_OUT, JSON.stringify({ pid: process.pid, node: process.env.ZCODE_KIT_RESPAWN_NODE ?? null, manager: process.env.ZCODE_KIT_RESPAWN_MANAGER ?? null, argv: process.argv.slice(2) }));
createServer((req, res) => {
  if (req.headers.authorization !== "Bearer " + key) return res.writeHead(401).end("{}");
  if (req.url === "/health") return res.end(JSON.stringify({ status: "ok", provider: "zai" }));
  res.writeHead(404).end("{}");
}).listen(port, "127.0.0.1");
`;

function bunOrFail() {
  try { return resolveBun(ROOT); } catch (err) { assert.fail(`this test spawns proxies under Bun: ${err.message}`); }
}

async function identity(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(1500) });
    return res.status === 200 && (await res.json()).provider === "zai" ? "ours" : "foreign";
  } catch { return "down"; }
}

async function until(what, fn, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
/** One file, however spelled: the ESM loader realpaths entry modules, and Windows runners' TEMP uses 8.3 short names. */
const canonicalPath = (file) => { let p = resolve(file); try { p = realpathSync.native(p); } catch {} return process.platform === "win32" ? p.toLowerCase() : p; };
const killQuietly = (pid) => { try { process.kill(pid, "SIGKILL"); } catch {} };

// --------------------------------------------------------- spawned preflight
test("a spawned preflight loads the lifecycle module and no presentation module, with today's output", async (t) => {
  const root = kitFixture(t, 19150); // nothing listens on 19150; no proxy dependencies: start refuses
  const seen = join(root, "loaded.json");
  const hooks = join(root, "record-loads.mjs");
  writeFileSync(hooks, `
    import { registerHooks } from "node:module";
    import { writeFileSync } from "node:fs";
    const urls = [];
    registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); urls.push(r.url); return r; } });
    process.on("exit", () => writeFileSync(${JSON.stringify(seen)}, JSON.stringify(urls)));
  `);
  const run = spawnSync(process.execPath, ["--import", pathToFileURL(hooks).href, join(root, "cli", "heal.mjs")], { env: childEnv(root), encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 4, run.stderr);
  assert.equal(run.stdout, "ERROR: proxy dependencies missing. Run: cd zcode-proxy-src && bun install --frozen-lockfile\n");
  assert.equal(run.stderr, "ZCode safe start failed. Run zcode-kit proxy restart, then zcode-kit doctor; inspect logs/proxy.log and manager lock ownership.\n");
  const loaded = JSON.parse(readFileSync(seen, "utf8")).filter((u) => u.startsWith("file:")).map((u) => relative(canonicalPath(root), canonicalPath(fileURLToPath(u))).split(sep).join("/"));
  assert.ok(loaded.includes("lib/proxy-lifecycle.mjs"), `loaded: ${loaded.join(", ")}`);
  assert.deepEqual(loaded.filter((f) => PRESENTATION.test(f)), []);
});

// ----------------------------------------------------- intents print nothing
/**
 * Run fn with every console call of this process recorded. (The raw stdio
 * streams cannot be spied on here: the test runner reports through them. The
 * source check below covers them.)
 */
async function printed(fn) {
  const out = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const name of Object.keys(saved)) console[name] = (...args) => { out.push(args.join(" ")); };
  try { return { value: await fn(), out }; }
  finally { Object.assign(console, saved); }
}

test("the lifecycle module never writes to the console or the process's stdio itself", () => {
  const code = stripComments(readFileSync(join(ROOT, "lib", "proxy-lifecycle.mjs"), "utf8"));
  assert.doesNotMatch(code, /\bconsole\s*\.|process\s*\.\s*(?:stdout|stderr)\b/);
});

async function identityServer(t, port, mode) {
  const server = http.createServer((req, res) => {
    if (mode === "foreign" || req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok", provider: "zai" }));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
}

async function lifecycleFor(root, options = {}) {
  const { createLifecycle } = await import(pathToFileURL(join(ROOT, "lib", "proxy-lifecycle.mjs")).href);
  return createLifecycle({ root, home: join(root, "home"), bunResolver: () => { throw new Error("must not spawn"); }, ...options });
}

test("ensure running prints nothing and returns an outcome record per identity outcome", async (t) => {
  const ours = kitFixture(t, 19152);
  await identityServer(t, 19152, "ours");
  const running = await printed(async () => (await lifecycleFor(ours)).ensureRunning());
  assert.deepEqual(running.out, []);
  assert.deepEqual(running.value, { intent: "ensure-running", code: 0, outcome: "already-running", recovered: null, lines: ["already running"] });

  const foreign = kitFixture(t, 19153);
  await identityServer(t, 19153, "foreign");
  const refused = await printed(async () => (await lifecycleFor(foreign)).ensureRunning());
  assert.deepEqual(refused.out, []);
  assert.equal(refused.value.code, 3);
  assert.equal(refused.value.outcome, "foreign");
  assert.deepEqual(refused.value.lines, ["ERROR: port 19153 is occupied by a foreign service (auth failed). Not touching it."]);

  const noKey = kitFixture(t, 19152);
  rmSync(join(noKey, ".proxykey"));
  const keyless = await printed(async () => (await lifecycleFor(noKey)).ensureRunning());
  assert.deepEqual(keyless.out, []);
  assert.equal(keyless.value.code, 5);
  assert.equal(keyless.value.outcome, "no-key");
  // The narration still reaches proxy.log, as the manager's lines always did.
  assert.match(readFileSync(join(ours, "logs", "proxy.log"), "utf8"), /^\[manager [^\]]+\] already running$/m);
});

test("ensure running reports a lock it may not take as an outcome, leaves the lock untouched and prints nothing", async (t) => {
  const root = kitFixture(t, 19154);
  const lock = join(root, "logs", "manager.lock");
  writeFileSync(lock, '{"pid":2147483647,"startedAt":"2026-01-01T00:00:00.000Z","nonce":"stale"}');
  const { value, out } = await printed(async () => (await lifecycleFor(root)).ensureRunning({ waitMs: 1000 }));
  assert.deepEqual(out, []);
  assert.equal(value.outcome, "start-lock-unavailable");
  assert.equal(value.code, 1);
  assert.match(value.error, /refusing automatic takeover/);
  assert.equal(readFileSync(lock, "utf8"), '{"pid":2147483647,"startedAt":"2026-01-01T00:00:00.000Z","nonce":"stale"}');
});

test("stop, restart, the respawn request and read state print nothing and return records", async (t) => {
  const root = kitFixture(t, 19155); // nothing on 19155
  const lifecycle = await lifecycleFor(root);
  const { value: stopped, out: stopOut } = await printed(() => lifecycle.stop());
  assert.deepEqual(stopOut, []);
  assert.deepEqual(stopped, { intent: "stop", code: 0, outcome: "not-running", recovered: null, lines: ["not running"] });

  const { value: restarted, out: restartOut } = await printed(() => lifecycle.restart({ waitMs: 1000 }));
  assert.deepEqual(restartOut, []);
  assert.equal(restarted.intent, "restart");
  assert.equal(restarted.stop.outcome, "not-running");
  assert.equal(restarted.start.outcome, "dependencies-missing");
  assert.equal(restarted.code, 4);
  assert.deepEqual(restarted.lines, ["not running", "ERROR: proxy dependencies missing. Run: cd zcode-proxy-src && bun install --frozen-lockfile"]);

  const { value: respawn, out: respawnOut } = await printed(() => lifecycle.requestRespawn(process.pid, "memory"));
  assert.deepEqual(respawnOut, []);
  assert.equal(respawn.intent, "respawn");
  assert.equal(respawn.code, 4);
  assert.equal(respawn.outcome, "refused");
  assert.deepEqual(respawn.lines, [`respawn: requested for pid ${process.pid} (reason memory)`, `respawn: refused — pid ${process.pid} is not the recorded proxy pid (no pid file)`]);
  assert.match(readFileSync(join(root, "logs", "heal.log"), "utf8"), /cause=respawn action=respawn result=refused/);

  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: process.pid, startedMs: 1, startedIso: "1970-01-01T00:00:00.001Z" }) + "\n");
  const { value: state, out: stateOut } = await printed(() => lifecycle.readState());
  assert.deepEqual(stateOut, []);
  assert.deepEqual(state, { identity: "down", pidRecord: { pid: process.pid, startedMs: 1, startedIso: "1970-01-01T00:00:00.001Z" }, alive: true });
});

// ------------------------------------------------------ frozen respawn contract
test("the lifecycle module imports every child_process helper it calls (H2a moved with the start-time probe)", () => {
  const src = readFileSync(join(ROOT, "lib", "proxy-lifecycle.mjs"), "utf8");
  const imported = new Set([...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*"node:child_process"/g)].flatMap((m) => m[1].split(",").map((s) => s.trim())).filter(Boolean));
  const used = new Set([...src.matchAll(/\b(spawnSync|spawn|execSync|execFile|exec)\s*\(/g)].map((m) => m[1]));
  assert.ok(used.has("spawnSync") && used.has("spawn"), "the start-time probes and the proxy spawn live in the lifecycle module");
  for (const fn of used) assert.ok(imported.has(fn), `${fn} is called but not imported from node:child_process`);
});

const VENDORED_HOOK = join(ROOT, "tests", "fixtures", "origin-main-9e45d05", "watchdog.ts");

test("the vendored origin/main respawn hook is byte-identical to origin/main (when the object is available)", (t) => {
  const show = spawnSync("git", ["-C", ROOT, "show", "9e45d05:zcode-proxy-src/src/runtime/watchdog.ts"], { encoding: "buffer" });
  if (show.status !== 0) { t.diagnostic("commit 9e45d05 not in this clone (shallow CI checkout): vendored copy not re-verified"); return; }
  assert.ok(show.stdout.equals(readFileSync(VENDORED_HOOK)), "tests/fixtures/origin-main-9e45d05/watchdog.ts drifted from origin/main");
});

test("an old proxy (origin/main) calling the new manager's respawn CLI gets a fresh proxy (spawned)", { timeout: 120_000 }, async (t) => {
  const port = 19151;
  const root = kitFixture(t, port, { proxySrc: true });
  const bun = bunOrFail();
  const manager = join(root, "proxy", "zcode-proxy-manager.mjs");
  const envOut = join(root, "respawned-env.json");
  // The old proxy: origin/main's own hook code, triggered the way its memory guard does.
  const oldProxy = join(root, "old-proxy.ts");
  writeFileSync(oldProxy, `
    import { createServer } from "node:http";
    import { spawnRespawnHook } from ${JSON.stringify(pathToFileURL(VENDORED_HOOK).href)};
    const server = createServer(async (req, res) => {
      if (req.url === "/__test/respawn") {
        const ok = await spawnRespawnHook("memory");
        res.end(String(ok));
        server.close();
        setTimeout(() => process.exit(0), 50);
        return;
      }
      if (req.headers.authorization !== "Bearer ${KEY}") return res.writeHead(401).end("{}");
      res.end(JSON.stringify({ status: "ok", provider: "zai" }));
    });
    server.listen(${port}, "127.0.0.1", () => console.log("up"));
  `);
  const env = childEnv(root, { ZCODE_KIT_BUN: bun, ZCODE_KIT_RESPAWN_NODE: process.execPath, ZCODE_KIT_RESPAWN_MANAGER: manager, FAKE_PROXY_ENV_OUT: envOut });
  const old = spawn(bun, ["run", oldProxy], { env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => killQuietly(old.pid));
  await new Promise((resolveUp, reject) => { old.stdout.once("data", resolveUp); old.once("exit", (code) => reject(new Error(`old proxy exited ${code}`))); });
  // The record an old manager writes at spawn.
  const { createManager } = await import(pathToFileURL(join(ROOT, "proxy", "zcode-proxy-manager.mjs")).href);
  const startedMs = createManager({ root, home: join(root, "home") }).processStartMs(old.pid);
  assert.ok(startedMs !== null, "test premise: the old proxy's start time is readable");
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: old.pid, startedMs, startedIso: new Date(startedMs).toISOString() }) + "\n");

  const asked = await fetch(`http://127.0.0.1:${port}/__test/respawn`).then((r) => r.text());
  assert.equal(asked, "true", "the old hook started the new manager");
  const fresh = await until("the respawned proxy", async () => {
    const record = readJson(join(root, "logs", "proxy.pid"));
    return record && record.pid !== old.pid && await identity(port) === "ours" ? record : null;
  }, 90_000);
  t.after(() => killQuietly(fresh.pid));
  await until("the respawn to finish", () => /respawn: start finished with exit code 0/.test(readFileSync(join(root, "logs", "proxy.log"), "utf8")), 30_000);
  assert.ok(Number.isFinite(fresh.startedMs), "the fresh record carries its start time");
  const events = readJson(join(root, "logs", "respawn.json")).events;
  assert.equal(events.length, 1);
  assert.deepEqual({ pid: events[0].pid, reason: events[0].reason }, { pid: old.pid, reason: "memory" });
  const spawned = readJson(envOut);
  assert.equal(spawned.pid, fresh.pid);
  assert.deepEqual({ node: canonicalPath(spawned.node), manager: canonicalPath(spawned.manager), argv: spawned.argv }, { node: canonicalPath(process.execPath), manager: canonicalPath(manager), argv: ["serve"] });
});

/** Run fn with console.log/console.warn recorded per stream (not passed through). */
async function consoleLines(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn };
  console.log = (...args) => lines.push(`log:${args.join(" ")}`);
  console.warn = (...args) => lines.push(`warn:${args.join(" ")}`);
  try { await fn(); return lines; } finally { Object.assign(console, saved); }
}

test("the account change restarts a verified own proxy through the intents, with the manager's lines", { timeout: 120_000 }, async (t) => {
  const port = 19157;
  const root = kitFixture(t, port, { proxySrc: true });
  const bun = bunOrFail();
  const first = spawnSync(process.execPath, [join(root, "cli", "heal.mjs")], { env: childEnv(root, { ZCODE_KIT_BUN: bun }), encoding: "utf8", timeout: 90_000 });
  const before = readJson(join(root, "logs", "proxy.pid"));
  if (before) t.after(() => killQuietly(before.pid));
  assert.equal(first.status, 0, first.stderr);
  const { restartForAccountChange } = await import(pathToFileURL(join(root, "cli", "account-setup.mjs")).href);
  const savedBun = process.env.ZCODE_KIT_BUN;
  process.env.ZCODE_KIT_BUN = bun;
  let lines;
  try { lines = await consoleLines(() => restartForAccountChange({ root, home: join(root, "home") })); }
  finally { if (savedBun === undefined) delete process.env.ZCODE_KIT_BUN; else process.env.ZCODE_KIT_BUN = savedBun; }
  const after = readJson(join(root, "logs", "proxy.pid"));
  if (after) t.after(() => killQuietly(after.pid));
  assert.notEqual(after.pid, before.pid, "a fresh proxy replaced the verified one");
  assert.deepEqual(lines, [`log:stopped (pid ${before.pid})`, "log:starting zcode-proxy ...", `log:started (pid ${after.pid}) — healthy on http://127.0.0.1:${port}`]);
  assert.equal(await identity(port), "ours");

  // A record whose pid is dead is not a running proxy: nothing starts, the change is reported.
  killQuietly(after.pid);
  // This process spawned it (in-process restart): wait until it is reaped, not only off the port.
  const gone = (pid) => { try { process.kill(pid, 0); return false; } catch (err) { return err.code === "ESRCH"; } };
  await until("the proxy to exit", async () => gone(after.pid) && await identity(port) === "down", 10_000);
  let warned;
  try { warned = await consoleLines(() => restartForAccountChange({ root, home: join(root, "home") })); }
  finally {
    const stray = readJson(join(root, "logs", "proxy.pid"));
    if (stray && stray.pid !== after.pid) killQuietly(stray.pid); // never leak a proxy this test started
  }
  assert.deepEqual(warned, ["warn:Account Rotator setting saved. A running proxy could not be verified; run zcode-kit doctor before restarting it."]);
  assert.equal(await identity(port), "down");
});

test("a proxy started through the preflight carries the frozen respawn hook, and the manager CLI stops it", { timeout: 120_000 }, async (t) => {
  const port = 19156;
  const root = kitFixture(t, port, { proxySrc: true });
  const envOut = join(root, "spawned-env.json");
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail(), FAKE_PROXY_ENV_OUT: envOut });
  const preflight = spawnSync(process.execPath, [join(root, "cli", "heal.mjs")], { env, encoding: "utf8", timeout: 90_000 });
  const record = readJson(join(root, "logs", "proxy.pid"));
  if (record) t.after(() => killQuietly(record.pid));
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.match(preflight.stdout, new RegExp(`^starting zcode-proxy \\.\\.\\.\\nstarted \\(pid ${record.pid}\\) — healthy on http://127\\.0\\.0\\.1:${port}\\n$`));
  const spawned = readJson(envOut);
  assert.deepEqual({ ...spawned, node: canonicalPath(spawned.node), manager: canonicalPath(spawned.manager) },
    { pid: record.pid, node: canonicalPath(process.execPath), manager: canonicalPath(join(root, "proxy", "zcode-proxy-manager.mjs")), argv: ["serve"] });
  const stop = spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "stop"], { env, encoding: "utf8", timeout: 60_000 });
  assert.equal(stop.status, 0, stop.stdout + stop.stderr);
  assert.equal(stop.stdout, `stopped (pid ${record.pid})\n`);
  assert.equal(await identity(port), "down");
  assert.equal(existsSync(join(root, "logs", "proxy.pid")), false);
  assert.deepEqual(readdirSync(join(root, "logs")).filter((f) => f === "manager.lock"), []);
});
