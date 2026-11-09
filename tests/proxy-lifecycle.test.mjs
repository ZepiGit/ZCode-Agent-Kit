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
// Ports: every test takes a free loopback port of its own (freePort), so
// parallel runs of this file in several worktrees never collide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { processCommandLine, resolveBun } from "../lib/process.mjs";

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
/** A loopback port no listener holds right now (bind port 0, read it back, release it). */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolvePort(port)); });
  });
}

const cleanups = new Map();
/** Run fn when the fixture is torn down, before its directory is removed (t.after hooks run in order). */
const defer = (root, fn) => cleanups.get(root).push(fn);

/**
 * Processes other than this one whose command line names the fixture
 * directory: every process a fixture's test starts (proxies, the old-proxy
 * stand-in, the manager hook) does, and the mkdtemp name is unique. null when
 * the process table cannot be read.
 */
function fixtureProcesses(root) {
  const tag = basename(root).toLowerCase();
  if (!/^[a-z0-9-]+$/.test(tag)) return null;
  if (process.platform === "win32") {
    const script = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.ToLower().Contains('${tag}') } | ForEach-Object { "$($_.ProcessId)\`t$($_.CommandLine)" }`;
    const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 30_000, windowsHide: true });
    if (r.status !== 0) return null;
    return r.stdout.split(/\r?\n/).filter(Boolean).map((line) => { const [pid, ...rest] = line.split("\t"); return { pid: Number(pid), commandLine: rest.join("\t") }; });
  }
  if (process.platform === "linux") {
    const found = [];
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
      let commandLine;
      try { commandLine = readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0").filter(Boolean).join(" "); } catch { continue; }
      if (commandLine.toLowerCase().includes(tag)) found.push({ pid: Number(name), commandLine });
    }
    return found;
  }
  const r = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", timeout: 15_000 });
  if (r.status !== 0) return null;
  return r.stdout.split("\n").map((l) => l.trim().match(/^(\d+)\s+(.*)$/)).filter((m) => m && Number(m[1]) !== process.pid && m[2].toLowerCase().includes(tag)).map((m) => ({ pid: Number(m[1]), commandLine: m[2] }));
}
const describeProcesses = (list) => list.map((p) => `pid ${p.pid}: ${p.commandLine}`).join("; ");

/**
 * Teardown waits on the observable state, never on time: the deferred stops
 * and kills run, then every process naming the fixture must be gone (Windows
 * TerminateProcess is asynchronous, and a live process's cwd or open log
 * file keeps the directory from being removed), then the directory is
 * removed with a short retry for handles Windows releases late (EPERM/EBUSY).
 * A process still there is reported by pid and command line, and killed
 * (it names this fixture, so this test started it); a removal that still
 * fails names what holds the directory.
 */
async function tearDownFixture(root) {
  for (const fn of cleanups.get(root).splice(0).reverse()) { try { await fn(); } catch {} }
  let left = null;
  const deadline = Date.now() + 20_000;
  for (;;) {
    left = fixtureProcesses(root);
    if ((left && left.length === 0) || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  let orphans = null;
  if (left && left.length) {
    orphans = `still running after teardown: ${describeProcesses(left)}`;
    for (const p of left) { try { process.kill(p.pid, "SIGKILL"); } catch {} }
  }
  for (let attempt = 1; ; attempt++) {
    try { rmSync(root, { recursive: true, force: true }); break; }
    catch (err) {
      if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(err.code) || attempt >= 10) {
        const holders = fixtureProcesses(root);
        err.message += ` — after ${attempt} attempt(s); ${holders === null ? "the process table could not be read" : holders.length ? `processes naming the fixture: ${describeProcesses(holders)}` : "no process names the fixture"}`;
        if (orphans) err.message += `; ${orphans}`;
        throw err;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (orphans) throw new Error(`fixture ${root}: ${orphans}`);
}

/** A kit copy (cli/, lib/, the manager) in a temp root that is also its state directory. */
function kitFixture(t, port, { proxySrc = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kit-lifecycle-"));
  cleanups.set(root, []);
  t.after(() => tearDownFixture(root));
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
// config, and records the respawn hook environment it was spawned with (and,
// in its own file, the per-spawn variables of ticket 18).
const FAKE_PROXY = `
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
const config = readFileSync(process.env.ZCODE_PROXY_CONFIG, "utf8");
const port = Number(config.match(/^  port:\\s*(\\d+)/m)[1]);
const key = config.match(/proxyApiKey:\\s*"([^"]+)"/)[1];
if (process.env.FAKE_PROXY_ENV_OUT) writeFileSync(process.env.FAKE_PROXY_ENV_OUT, JSON.stringify({ pid: process.pid, node: process.env.ZCODE_KIT_RESPAWN_NODE ?? null, manager: process.env.ZCODE_KIT_RESPAWN_MANAGER ?? null, argv: process.argv.slice(2) }));
if (process.env.FAKE_PROXY_KIT_ENV_OUT) writeFileSync(process.env.FAKE_PROXY_KIT_ENV_OUT, JSON.stringify({ pid: process.pid, logDir: process.env.ZCODE_KIT_LOG_DIR ?? null, stopToken: process.env.ZCODE_KIT_STOP_TOKEN ?? null }), { mode: 0o600 });
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
// Teardown never kills by a bare pid (ticket 70: Windows reuses a pid as soon as
// its process object is freed). A direct child is killed through its own
// handle; a proxy the manager spawned only while its command line still names
// this fixture.
const killChild = (child) => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); };
function killFixtureProxy(root, pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  const info = processCommandLine(pid);
  if (!info || !info.commandLine.toLowerCase().includes(basename(root).toLowerCase())) return;
  try { process.kill(pid, "SIGKILL"); } catch {}
}
// A pid no process has: above Linux's pid_max and never handed out by Windows.
const NEVER_ALLOCATED_PID = 2147483644;
// The manager records the pid at spawn and adds the start time once its probe
// answers (within 5 s; on Windows a PowerShell query). A probe that does not
// answer in time leaves startedMs null: today's behaviour (DECISIONS Round 7
// Q4), which ticket 16 closes. Only Windows can hit it.
const startTimeMissing = (record) => process.platform === "win32" && record?.startedMs === null;

test("the teardown's process scan sees a process naming the fixture, and loses it once it exited", { timeout: 60_000 }, async (t) => {
  const root = kitFixture(t, await freePort());
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)", join(root, "marker")], { stdio: "ignore" });
  defer(root, () => killChild(child));
  await new Promise((r) => child.once("spawn", r));
  const seen = await until("the scan to list the child", () => fixtureProcesses(root)?.some((p) => p.pid === child.pid), 30_000);
  assert.equal(seen, true);
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGKILL");
  await exited;
  await until("the scan to drop the child", () => fixtureProcesses(root)?.every((p) => p.pid !== child.pid), 30_000);
});

// --------------------------------------------------------- spawned preflight
test("a spawned preflight loads the lifecycle module and no presentation module, with today's output", async (t) => {
  const root = kitFixture(t, await freePort()); // nothing listens there; no proxy dependencies: start refuses
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
  server.unref(); // a failing fixture teardown skips the later after-hooks; this server must not keep the run alive
  t.after(() => { server.closeAllConnections(); server.close(); });
}

async function lifecycleFor(root, options = {}) {
  const { createLifecycle } = await import(pathToFileURL(join(ROOT, "lib", "proxy-lifecycle.mjs")).href);
  return createLifecycle({ root, home: join(root, "home"), bunResolver: () => { throw new Error("must not spawn"); }, ...options });
}

test("ensure running prints nothing and returns an outcome record per identity outcome", async (t) => {
  const oursPort = await freePort();
  const ours = kitFixture(t, oursPort);
  await identityServer(t, oursPort, "ours");
  const running = await printed(async () => (await lifecycleFor(ours)).ensureRunning());
  assert.deepEqual(running.out, []);
  assert.deepEqual(running.value, { intent: "ensure-running", code: 0, outcome: "already-running", recovered: null, lines: ["already running"] });

  const foreignPort = await freePort();
  const foreign = kitFixture(t, foreignPort);
  await identityServer(t, foreignPort, "foreign");
  const refused = await printed(async () => (await lifecycleFor(foreign)).ensureRunning());
  assert.deepEqual(refused.out, []);
  assert.equal(refused.value.code, 3);
  assert.equal(refused.value.outcome, "foreign");
  assert.deepEqual(refused.value.lines, [`ERROR: port ${foreignPort} is occupied by a foreign service (auth failed). Not touching it.`]);

  const noKey = kitFixture(t, oursPort);
  rmSync(join(noKey, ".proxykey"));
  const keyless = await printed(async () => (await lifecycleFor(noKey)).ensureRunning());
  assert.deepEqual(keyless.out, []);
  assert.equal(keyless.value.code, 5);
  assert.equal(keyless.value.outcome, "no-key");
  // The narration still reaches proxy.log, as the manager's lines always did.
  assert.match(readFileSync(join(ours, "logs", "proxy.log"), "utf8"), /^\[manager [^\]]+\] already running$/m);
});

test("ensure running reports a lock it may not take as an outcome, leaves the lock untouched and prints nothing", async (t) => {
  const root = kitFixture(t, await freePort());
  const lock = join(root, "logs", "manager.lock");
  // Ticket 16: a dead holder's lock is now taken over on proof (ADR-0003), so
  // the lock it may not take is one of an unknown higher protocol version.
  writeFileSync(lock, '{"pid":2147483647,"startedAt":"2026-01-01T00:00:00.000Z","nonce":"stale","v":99}');
  const { value, out } = await printed(async () => (await lifecycleFor(root)).ensureRunning({ waitMs: 1000 }));
  assert.deepEqual(out, []);
  assert.equal(value.outcome, "start-lock-unavailable");
  assert.equal(value.code, 1);
  assert.match(value.error, /so it was left untouched/);
  assert.equal(readFileSync(lock, "utf8"), '{"pid":2147483647,"startedAt":"2026-01-01T00:00:00.000Z","nonce":"stale","v":99}');
});

test("stop, restart, the respawn request and read state print nothing and return records", async (t) => {
  const root = kitFixture(t, await freePort()); // nothing listens there
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

test("stop counts its proxy as gone when its pid is reused after the kill, and never signals the new process", {
  skip: process.platform === "win32" && "the stand-in survives SIGTERM; Windows stops through the handle-checked TerminateProcess",
}, async (t) => {
  // Ticket 70 (orchestrator note on 15): the exit poll after a kill checked
  // the pid alone, so a pid Windows hands to a new process at once made a
  // successful stop refuse and report 2. The stand-in keeps running after
  // SIGTERM (it is "the new process at that pid"); the injected probe reports
  // its new start time once the signal arrived.
  const port = await freePort();
  const root = kitFixture(t, port);
  await identityServer(t, port, "ours");
  const recordedMs = Date.now() - 10 * 60_000;
  const stand = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => process.stdout.write("term\\n")); setInterval(() => {}, 1e6); process.stdout.write("up\\n");'], { stdio: ["ignore", "pipe", "ignore"] });
  defer(root, () => killChild(stand));
  await new Promise((r) => stand.stdout.once("data", r));
  let reused = false;
  stand.stdout.on("data", (b) => { if (String(b).includes("term")) reused = true; });
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: stand.pid, startedMs: recordedMs, startedIso: new Date(recordedMs).toISOString() }) + "\n");
  const lifecycle = await lifecycleFor(root, { processStartMsImpl: () => (reused ? recordedMs + 60_000 : recordedMs) });
  const stopped = await lifecycle.stop();
  assert.equal(reused, true, "test premise: the kill was sent");
  assert.deepEqual({ code: stopped.code, outcome: stopped.outcome, lines: stopped.lines }, { code: 0, outcome: "stopped", lines: [`stopped (pid ${stand.pid})`] });
  assert.equal(stand.exitCode, null, "the process that now holds the pid is never signalled again (C6)");
  assert.equal(stand.signalCode, null);
  assert.equal(existsSync(join(root, "logs", "proxy.pid")), false, "the stopped proxy's record is removed");
});

test("stop never counts its proxy as gone on an unknown start time after the kill, and does not escalate", {
  skip: process.platform === "win32" && "the stand-in survives SIGTERM; Windows stops through the handle-checked TerminateProcess",
  timeout: 60_000,
}, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port);
  await identityServer(t, port, "ours");
  const recordedMs = Date.now() - 10 * 60_000;
  const stand = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => process.stdout.write("term\\n")); setInterval(() => {}, 1e6); process.stdout.write("up\\n");'], { stdio: ["ignore", "pipe", "ignore"] });
  defer(root, () => killChild(stand));
  await new Promise((r) => stand.stdout.once("data", r));
  let signalled = false;
  stand.stdout.on("data", (b) => { if (String(b).includes("term")) signalled = true; });
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: stand.pid, startedMs: recordedMs, startedIso: new Date(recordedMs).toISOString() }) + "\n");
  const lifecycle = await lifecycleFor(root, { processStartMsImpl: () => (signalled ? null : recordedMs) });
  const stopped = await lifecycle.stop();
  assert.deepEqual({ code: stopped.code, outcome: stopped.outcome, lines: stopped.lines },
    { code: 2, outcome: "kill-failed", lines: [`refusing to signal pid ${stand.pid}: its start time no longer matches the pid record`, `ERROR killing pid ${stand.pid}`] });
  assert.equal(stand.signalCode, null, "no forced kill without proof");
  assert.equal(stand.exitCode, null);
  assert.equal(existsSync(join(root, "logs", "proxy.pid")), true, "the record stays");
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
  const port = await freePort();
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
  defer(root, () => killChild(old));
  await new Promise((resolveUp, reject) => { old.stdout.once("data", resolveUp); old.once("exit", (code) => reject(new Error(`old proxy exited ${code}`))); });
  // The record an old manager writes at spawn.
  const { createManager } = await import(pathToFileURL(join(ROOT, "proxy", "zcode-proxy-manager.mjs")).href);
  const startedMs = createManager({ root, home: join(root, "home") }).processStartMs(old.pid);
  assert.ok(startedMs !== null, "test premise: the old proxy's start time is readable");
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: old.pid, startedMs, startedIso: new Date(startedMs).toISOString() }) + "\n");

  const asked = await fetch(`http://127.0.0.1:${port}/__test/respawn`).then((r) => r.text());
  assert.equal(asked, "true", "the old hook started the new manager");
  // The port first, then the record: since ticket 16 the spawner records a
  // spawn intent (pid null) before the spawn, so a record read before a slow
  // port check may be that intent while the proxy it spawned already answers
  // (CI run 42507303528, ubuntu Node 24). Only a record naming a pid is the
  // respawned proxy's.
  const fresh = await until("the respawned proxy", async () => {
    if (await identity(port) !== "ours") return null;
    const record = readJson(join(root, "logs", "proxy.pid"));
    return record && Number.isInteger(record.pid) && record.pid !== old.pid ? record : null;
  }, 90_000);
  defer(root, () => killFixtureProxy(root, fresh.pid));
  await until("the respawn to finish", () => /respawn: start finished with exit code 0/.test(readFileSync(join(root, "logs", "proxy.log"), "utf8")), 30_000);
  // The record is final once the start finished (the start time is filled
  // before the health wait); the proxy can answer /health while the manager
  // is still probing its start time, so the record seen above may lack it.
  const record = readJson(join(root, "logs", "proxy.pid"));
  assert.equal(record.pid, fresh.pid, "the respawned proxy is the recorded one");
  if (startTimeMissing(record)) t.diagnostic(`windows: the start-time probe did not answer within its deadline; startedMs stays null (today's behaviour, ticket 16)`);
  else {
    assert.ok(Number.isFinite(record.startedMs), "the fresh record carries its start time");
    assert.equal(createManager({ root, home: join(root, "home") }).verifyOwnProcess(record), "match", "and it is the live proxy's start time");
  }
  const events = readJson(join(root, "logs", "respawn.json")).events;
  assert.equal(events.length, 1);
  assert.deepEqual({ pid: events[0].pid, reason: events[0].reason }, { pid: old.pid, reason: "memory" });
  const spawned = readJson(envOut);
  assert.equal(spawned.pid, fresh.pid);
  assert.deepEqual({ node: canonicalPath(spawned.node), manager: canonicalPath(spawned.manager), argv: spawned.argv }, { node: canonicalPath(process.execPath), manager: canonicalPath(manager), argv: ["serve"] });
  // The test stops what it started: the manager's own stop (it returns only
  // after the exit) rather than a teardown kill.
  const stop = spawnSync(process.execPath, [manager, "stop"], { env, encoding: "utf8", timeout: 60_000 });
  if (startTimeMissing(record)) t.diagnostic(`windows: no start time, stop refuses (ticket 16); teardown kills pid ${fresh.pid} by its fixture command line`);
  else {
    assert.equal(stop.status, 0, stop.stdout + stop.stderr);
    assert.equal(stop.stdout, `stopped (pid ${fresh.pid})\n`);
  }
});

// ------------------------------------- respawn acknowledgement (ticket 23)
// ADR-0015: on a memory respawn the proxy drains only after the manager has
// reserved the restart budget (a respawn.json event with its pid, written
// after its request). The stand-in proxy below runs the REAL health supervisor
// and respawn handoff of this checkout under induced memory pressure (its
// footprint sampler reports FAKE_PRESSURE_MB), and the hook it spawns is the
// real manager CLI of the fixture. "Draining" is its exit.
const SUPERVISOR_URL = pathToFileURL(join(ROOT, "zcode-proxy-src", "src", "runtime", "supervisor.ts")).href;
const SUPERVISED_PROXY = `
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHealthSupervisor, managerRespawnHandoff } from ${JSON.stringify(SUPERVISOR_URL)};
const config = readFileSync(process.env.ZCODE_PROXY_CONFIG, "utf8");
const port = Number(config.match(/^  port:\\s*(\\d+)/m)[1]);
const key = config.match(/proxyApiKey:\\s*"([^"]+)"/)[1];
let answeredAt = null;
const server = createServer((req, res) => {
  if (req.headers.authorization !== "Bearer " + key) return res.writeHead(401).end("{}");
  if (req.url === "/health") { answeredAt ??= Date.now(); return res.end(JSON.stringify({ status: "ok", provider: "zai" })); }
  res.writeHead(404).end("{}");
}).listen(port, "127.0.0.1");
// A slow manager (the late acknowledgement): the hook runs FAKE_LATE_MANAGER,
// which starts the real manager late.
const env = { ...process.env };
if (env.FAKE_LATE_MANAGER) { env.FAKE_REAL_MANAGER = env.ZCODE_KIT_RESPAWN_MANAGER; env.ZCODE_KIT_RESPAWN_MANAGER = env.FAKE_LATE_MANAGER; }
const supervisor = createHealthSupervisor({
  thresholds: { samples: 1, sampleIntervalMs: 250 },
  sample: () => ({ mb: Number(process.env.FAKE_PRESSURE_MB), metric: "footprint" }),
  respawn: managerRespawnHandoff(env, process.env.FAKE_ACK_WAIT_MS ? { ackWaitMs: Number(process.env.FAKE_ACK_WAIT_MS) } : {}),
  shutdown: async () => { console.log("stand-in drained"); server.close(); process.exit(0); },
  watchdog: false,
});
// The pressure starts once the manager's start has finished: this proxy
// answered /health and its pid record names it with its start time (or, where
// the start-time probe is slow, 10 s after the first answer).
const ready = setInterval(() => {
  if (answeredAt === null) return;
  let record = null;
  try { record = JSON.parse(readFileSync(join(process.env.ZCODE_KIT_LOG_DIR, "proxy.pid"), "utf8")); } catch {}
  const recorded = record?.pid === process.pid && Number.isFinite(record?.startedMs);
  if (!recorded && Date.now() - answeredAt < 10_000) return;
  clearInterval(ready);
  setTimeout(() => supervisor.start(), 1_000);
}, 100);
`;

// The late manager: waits FAKE_LATE_MS, then runs the real manager CLI with
// the hook's arguments and records how it ended.
const LATE_MANAGER = `
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
await new Promise((r) => setTimeout(r, Number(process.env.FAKE_LATE_MS)));
const r = spawnSync(process.execPath, [process.env.FAKE_REAL_MANAGER, ...process.argv.slice(2)], { encoding: "utf8", env: process.env, timeout: 120_000 });
writeFileSync(process.env.FAKE_LATE_OUT, JSON.stringify({ argv: process.argv.slice(2), code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") }));
process.exit(r.status ?? 1);
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The fixture's stand-in proxies alive now (by command line), or null when the process table cannot be read. */
const standIns = (root) => fixtureProcesses(root)?.filter((p) => /zcode-proxy-src[\\/]+src[\\/]+index\.ts\b.*\bserve\b/.test(p.commandLine)) ?? null;
const countOf = (text, re) => (text.match(re) ?? []).length;

test("induced memory pressure: acknowledged respawns drain, the budget caps them at 3, the refused one keeps its proxy serving with one ERROR and no further hook", { timeout: 240_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port, { proxySrc: true });
  writeFileSync(join(root, "zcode-proxy-src", "src", "index.ts"), SUPERVISED_PROXY);
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail(), FAKE_PRESSURE_MB: "4096" });
  const manager = join(root, "proxy", "zcode-proxy-manager.mjs");
  const logFile = join(root, "logs", "proxy.log");
  const log = () => { try { return readFileSync(logFile, "utf8"); } catch { return ""; } };
  const seen = new Set();
  const remember = () => { const r = readJson(join(root, "logs", "proxy.pid")); if (Number.isInteger(r?.pid) && !seen.has(r.pid)) { seen.add(r.pid); defer(root, () => killFixtureProxy(root, r.pid)); } };
  const start = spawnSync(process.execPath, [manager, "start"], { env, encoding: "utf8", timeout: 90_000 });
  remember();
  assert.equal(start.status, 0, start.stdout + start.stderr);

  // Sample until the refusal is logged: never two proxies at once.
  const refused = / ERROR supervisor respawn refused by the kit manager; keeps serving /;
  const counts = [];
  const deadline = Date.now() + 180_000;
  while (!refused.test(log())) {
    if (Date.now() > deadline) assert.fail(`no refusal logged; proxy.log tail:\n${log().slice(-3000)}`);
    remember();
    const list = standIns(root);
    if (list) counts.push(list.length);
    await sleep(100);
  }
  remember();
  const hooksAtRefusal = countOf(log(), /respawn: requested for pid \d+ \(reason memory\)/g);
  // After the refusal: exactly one proxy at every sample, ours and serving.
  const after = [];
  for (let i = 0; i < 12; i++) {
    after.push({ proxies: standIns(root)?.length ?? null, identity: await identity(port) });
    await sleep(250);
  }
  const text = log();
  const events = readJson(join(root, "logs", "respawn.json")).events;
  const record = readJson(join(root, "logs", "proxy.pid"));

  assert.ok(counts.length > 0 && counts.every((n) => n <= 1), `never two proxies (samples: ${counts.join(",")})`);
  assert.deepEqual(after.filter((s) => s.proxies !== 1 || s.identity !== "ours"), [], `exactly one serving proxy after the refusal: ${JSON.stringify(after)}`);
  assert.equal(events.length, 3, "three restarts reserved in the window, never more");
  assert.equal(countOf(text, /stand-in drained/g), 3, "each acknowledged respawn drained its proxy");
  assert.equal(hooksAtRefusal, 4, "three acknowledged requests and the refused one");
  assert.equal(countOf(text, /respawn: requested for pid \d+ \(reason memory\)/g), 4, "no further hook within the budget window");
  assert.equal(countOf(text, / ERROR supervisor /g), 1, "one ERROR line");
  assert.match(text, / ERROR supervisor respawn refused by the kit manager; keeps serving .*outcome=refused .*hookExit=4 restarts=exhausted retryInS=900\n/);
  assert.equal(countOf(text, /respawn refused: 3 restarts in 15 min/g), 1);
  assert.ok(!events.some((e) => e.pid === record.pid), "the serving proxy is the one whose request was refused");
  await managerStop(t, root, env, record);
});

test("a late acknowledgement: the proxy keeps serving, the manager ends in 'already running', 0, with exactly one proxy and the slot consumed", { timeout: 180_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port, { proxySrc: true });
  writeFileSync(join(root, "zcode-proxy-src", "src", "index.ts"), SUPERVISED_PROXY);
  const late = join(root, "late-manager.mjs");
  writeFileSync(late, LATE_MANAGER);
  const lateOut = join(root, "late-manager.json");
  // The proxy waits 1.5 s for the acknowledgement; the manager reserves after 3 s.
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail(), FAKE_PRESSURE_MB: "4096", FAKE_ACK_WAIT_MS: "1500", FAKE_LATE_MANAGER: late, FAKE_LATE_MS: "3000", FAKE_LATE_OUT: lateOut });
  const manager = join(root, "proxy", "zcode-proxy-manager.mjs");
  const start = spawnSync(process.execPath, [manager, "start"], { env, encoding: "utf8", timeout: 90_000 });
  const record = readJson(join(root, "logs", "proxy.pid"));
  if (record) defer(root, () => killFixtureProxy(root, record.pid));
  assert.equal(start.status, 0, start.stdout + start.stderr);

  // The late manager waits 30 s for the proxy to exit, which it never does.
  const counts = [];
  const deadline = Date.now() + 120_000;
  while (!existsSync(lateOut)) {
    if (Date.now() > deadline) assert.fail("the late manager did not finish");
    const list = standIns(root);
    if (list) counts.push(list.length);
    await sleep(250);
  }
  const ended = readJson(lateOut);
  const text = readFileSync(join(root, "logs", "proxy.log"), "utf8");
  const events = readJson(join(root, "logs", "respawn.json")).events;

  assert.deepEqual(ended.argv, ["respawn", String(record.pid), "--reason", "memory"], "the hook's arguments are unchanged");
  assert.equal(ended.code, 0, ended.out);
  assert.equal(ended.out, [
    `respawn: requested for pid ${record.pid} (reason memory)`,
    `respawn: waiting up to 30s for pid ${record.pid} to exit`,
    `respawn: pid ${record.pid} still alive — start() decides via the hung-own proof`,
    "respawn: starting a fresh proxy",
    `already running (pid ${record.pid})`,
    "respawn: start finished with exit code 0",
    "",
  ].join("\n"));
  assert.deepEqual(events.map((e) => ({ pid: e.pid, reason: e.reason })), [{ pid: record.pid, reason: "memory" }], "the budget slot is consumed");
  assert.match(text, / ERROR supervisor respawn not acknowledged by the kit manager; keeps serving .*outcome=no-acknowledgement .*restarts=exhausted/);
  assert.doesNotMatch(text, /stand-in drained/);
  assert.ok(counts.length > 0 && counts.every((n) => n === 1), `exactly one proxy at every sample (samples: ${counts.join(",")})`);
  assert.equal(readJson(join(root, "logs", "proxy.pid")).pid, record.pid, "the same proxy is still the recorded one");
  assert.equal(await identity(port), "ours");
  assert.equal(countOf(text, /respawn: requested for pid/g), 1, "one hook");
  await managerStop(t, root, env, record);
});

test("the respawn wait (30 s) is longer than the acknowledgement wait (10 s) + the proxy's stop deadline (10 s) + a margin", async () => {
  // The proxy's side, read by Bun from the proxy's own modules.
  const read = spawnSync(bunOrFail(), ["-e", `import { RESPAWN_ACK_WAIT_MS, SHUTDOWN_TIMING } from ${JSON.stringify(SUPERVISOR_URL)}; console.log(JSON.stringify({ ack: RESPAWN_ACK_WAIT_MS, deadline: SHUTDOWN_TIMING.memory.deadlineMs }));`], { encoding: "utf8", timeout: 60_000 });
  assert.equal(read.status, 0, read.stderr);
  const proxy = JSON.parse(read.stdout);
  // The manager's side: the module the manager CLI builds on.
  const { RESPAWN_WAIT_MS } = await import(pathToFileURL(join(ROOT, "lib", "proxy-lifecycle.mjs")).href);
  assert.deepEqual({ respawnWait: RESPAWN_WAIT_MS, ack: proxy.ack, deadline: proxy.deadline }, { respawnWait: 30_000, ack: 10_000, deadline: 10_000 });
  // STOP_EXIT_MARGIN_MS (ticket 22) is "a few 300 ms poll intervals, for example 2 s".
  const MARGIN_MS = 2_000;
  assert.ok(RESPAWN_WAIT_MS > proxy.ack + proxy.deadline + MARGIN_MS);
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
  const port = await freePort();
  const root = kitFixture(t, port, { proxySrc: true });
  const bun = bunOrFail();
  const first = spawnSync(process.execPath, [join(root, "cli", "heal.mjs")], { env: childEnv(root, { ZCODE_KIT_BUN: bun }), encoding: "utf8", timeout: 90_000 });
  const before = readJson(join(root, "logs", "proxy.pid"));
  if (before) defer(root, () => killFixtureProxy(root, before.pid));
  assert.equal(first.status, 0, first.stderr);
  if (startTimeMissing(before)) { t.skip("windows: the start-time probe did not answer in time, so no stop can verify this proxy (today's behaviour, ticket 16)"); return; }
  const { restartForAccountChange } = await import(pathToFileURL(join(root, "cli", "account-setup.mjs")).href);
  const savedBun = process.env.ZCODE_KIT_BUN;
  process.env.ZCODE_KIT_BUN = bun;
  let lines;
  try { lines = await consoleLines(() => restartForAccountChange({ root, home: join(root, "home") })); }
  finally { if (savedBun === undefined) delete process.env.ZCODE_KIT_BUN; else process.env.ZCODE_KIT_BUN = savedBun; }
  const after = readJson(join(root, "logs", "proxy.pid"));
  if (after) defer(root, () => killFixtureProxy(root, after.pid));
  assert.notEqual(after.pid, before.pid, "a fresh proxy replaced the verified one");
  assert.deepEqual(lines, [`log:stopped (pid ${before.pid})`, "log:starting zcode-proxy ...", `log:started (pid ${after.pid}) — healthy on http://127.0.0.1:${port}`]);
  assert.equal(await identity(port), "ours");

  // A record whose pid is dead is not a running proxy: nothing starts, the
  // change is reported. The proxy is stopped through the intent (which
  // returns only after the exit); the dead record names a pid no process has,
  // so a reused pid cannot turn it into a live one (ticket 70).
  if (startTimeMissing(after)) { t.diagnostic("windows: the fresh record has no start time (ticket 16); stopped through its fixture command line"); killFixtureProxy(root, after.pid); }
  else {
    const { createLifecycle } = await import(pathToFileURL(join(root, "lib", "proxy-lifecycle.mjs")).href);
    assert.equal((await createLifecycle({ root, home: join(root, "home") }).stop()).outcome, "stopped");
  }
  await until("the proxy to leave the port", async () => await identity(port) === "down", 15_000);
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: NEVER_ALLOCATED_PID, startedMs: 1, startedIso: "1970-01-01T00:00:00.001Z" }) + "\n");
  let warned;
  try { warned = await consoleLines(() => restartForAccountChange({ root, home: join(root, "home") })); }
  finally {
    const stray = readJson(join(root, "logs", "proxy.pid"));
    if (stray && stray.pid !== NEVER_ALLOCATED_PID) defer(root, () => killFixtureProxy(root, stray.pid)); // never leak a proxy this test started
  }
  assert.deepEqual(warned, ["warn:Account Rotator setting saved. A running proxy could not be verified; run zcode-kit doctor before restarting it."]);
  assert.equal(await identity(port), "down");
});

test("a proxy started through the preflight carries the frozen respawn hook, and the manager CLI stops it", { timeout: 120_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port, { proxySrc: true });
  const envOut = join(root, "spawned-env.json");
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail(), FAKE_PROXY_ENV_OUT: envOut });
  const preflight = spawnSync(process.execPath, [join(root, "cli", "heal.mjs")], { env, encoding: "utf8", timeout: 90_000 });
  const record = readJson(join(root, "logs", "proxy.pid"));
  if (record) defer(root, () => killFixtureProxy(root, record.pid));
  assert.equal(preflight.status, 0, preflight.stderr);
  assert.match(preflight.stdout, new RegExp(`^starting zcode-proxy \\.\\.\\.\\nstarted \\(pid ${record.pid}\\) — healthy on http://127\\.0\\.0\\.1:${port}\\n$`));
  const spawned = readJson(envOut);
  assert.deepEqual({ ...spawned, node: canonicalPath(spawned.node), manager: canonicalPath(spawned.manager) },
    { pid: record.pid, node: canonicalPath(process.execPath), manager: canonicalPath(join(root, "proxy", "zcode-proxy-manager.mjs")), argv: ["serve"] });
  const stop = spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "stop"], { env, encoding: "utf8", timeout: 60_000 });
  if (startTimeMissing(record)) {
    // Today's behaviour (ticket 16 closes it): no start time, no kill.
    t.diagnostic("windows: the start-time probe did not answer in time; stop refuses (start-unknown)");
    assert.equal(stop.status, 4, stop.stdout + stop.stderr);
    assert.match(stop.stdout, /start time of pid \d+ is not determinable/);
    return;
  }
  assert.equal(stop.status, 0, stop.stdout + stop.stderr);
  assert.equal(stop.stdout, `stopped (pid ${record.pid})\n`);
  assert.equal(await identity(port), "down");
  assert.equal(existsSync(join(root, "logs", "proxy.pid")), false);
  assert.deepEqual(readdirSync(join(root, "logs")).filter((f) => f === "manager.lock"), []);
});

// ------------------------------------------- per-spawn environment (ticket 18)
// ADR-0014/ADR-0015, Round 4 Q4: at every proxy spawn the manager sets
// ZCODE_KIT_STOP_TOKEN (fresh, 32 random bytes base64url, also written to
// proxy.pid) and ZCODE_KIT_LOG_DIR (its own logs dir), overwriting whatever the
// manager inherited. Assertions never print a token (B2): values are compared
// inside assert.ok with a message that names no value.
const STOP_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** The per-spawn variables the stand-in recorded, once it is the recorded proxy. */
function spawnedKitEnv(root, file) {
  return until("the spawned proxy's per-spawn environment", () => {
    const record = readJson(join(root, "logs", "proxy.pid"));
    const seen = readJson(file);
    return record && seen && seen.pid === record.pid ? { record, seen } : null;
  }, 30_000);
}

/** `manager start`; the started proxy is torn down with the fixture. */
async function managerStart(root, env, kitEnvOut) {
  const run = spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "start"], { env, encoding: "utf8", timeout: 90_000 });
  const record = readJson(join(root, "logs", "proxy.pid"));
  if (record) defer(root, () => killFixtureProxy(root, record.pid));
  assert.equal(run.status, 0, run.stdout + run.stderr);
  return spawnedKitEnv(root, kitEnvOut);
}

/** Stop the recorded proxy the way its start allows (Windows without a start time: by its fixture command line). */
async function managerStop(t, root, env, record) {
  if (startTimeMissing(record)) {
    t.diagnostic("windows: no start time recorded, so stop refuses (ticket 16); stopped through its fixture command line");
    killFixtureProxy(root, record.pid);
    rmSync(join(root, "logs", "proxy.pid"), { force: true });
  } else {
    const stop = spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "stop"], { env, encoding: "utf8", timeout: 60_000 });
    assert.equal(stop.status, 0, stop.stdout + stop.stderr);
  }
}

test("every proxy spawn gets the manager's logs dir and a fresh stop token equal to proxy.pid's, overwriting ambient values", { timeout: 180_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port, { proxySrc: true });
  const kitEnvOut = join(root, "kit-env.json");
  // What a respawned chain or a stray shell would hand the manager: a token of the right shape and another logs dir.
  const ambientToken = randomBytes(32).toString("base64url");
  const ambientLogDir = join(root, "ambient-logs");
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail(), FAKE_PROXY_KIT_ENV_OUT: kitEnvOut, ZCODE_KIT_STOP_TOKEN: ambientToken, ZCODE_KIT_LOG_DIR: ambientLogDir });
  // A world-readable proxy.pid the manager cannot parse (old or damaged): the
  // record that now holds the token must still end up owner-only.
  const pidFile = join(root, "logs", "proxy.pid");
  writeFileSync(pidFile, "not a pid record\n");
  chmodSync(pidFile, 0o644);

  const spawns = [];
  for (let i = 0; i < 2; i++) {
    if (i > 0) {
      await managerStop(t, root, env, spawns[i - 1].record);
      await until("the proxy to leave the port", async () => await identity(port) === "down", 15_000);
    }
    const { record, seen } = await managerStart(root, env, kitEnvOut);
    assert.equal(canonicalPath(seen.logDir ?? ""), canonicalPath(join(root, "logs")), `spawn ${i + 1}: ZCODE_KIT_LOG_DIR is the manager's own logs dir`);
    assert.ok(typeof seen.stopToken === "string" && STOP_TOKEN_SHAPE.test(seen.stopToken), `spawn ${i + 1}: ZCODE_KIT_STOP_TOKEN is set, 32 random bytes as base64url`);
    assert.ok(seen.stopToken !== ambientToken, `spawn ${i + 1}: the inherited stop token is overwritten`);
    assert.ok(record.stopToken === seen.stopToken, `spawn ${i + 1}: proxy.pid records the token the proxy received`);
    if (process.platform !== "win32") assert.equal(statSync(pidFile).mode & 0o777, 0o600, `spawn ${i + 1}: proxy.pid is owner-only`);
    spawns.push({ record, seen });
  }
  assert.ok(spawns[0].seen.stopToken !== spawns[1].seen.stopToken, "two consecutive spawns get different tokens");
  assert.equal(existsSync(ambientLogDir), false, "nothing is written to the inherited logs dir");
  await managerStop(t, root, env, spawns[1].record);
});

test("the stop token appears in no output of status, status --json, doctor or logs, nor in any log file", { timeout: 180_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port, { proxySrc: true });
  const kitEnvOut = join(root, "kit-env.json");
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail(), FAKE_PROXY_KIT_ENV_OUT: kitEnvOut });
  const { record, seen } = await managerStart(root, env, kitEnvOut);
  const token = seen.stopToken;
  assert.ok(typeof token === "string" && STOP_TOKEN_SHAPE.test(token), "test premise: the proxy received a stop token");
  const manager = join(root, "proxy", "zcode-proxy-manager.mjs");
  const run = (args) => spawnSync(process.execPath, [manager, ...args], { env, encoding: "utf8", timeout: 60_000 });
  const json = run(["status", "--json"]);
  assert.equal(JSON.parse(json.stdout).health, "ours", "test premise: the commands see the running proxy");
  const outputs = [["status --json", json], ...[["status"], ["doctor"], ["logs", "400"]].map((args) => [args.join(" "), run(args)])];
  for (const [name, r] of outputs) {
    assert.ok(!`${r.stdout}${r.stderr}`.includes(token), `${name} printed the stop token`);
  }
  await managerStop(t, root, env, record);
  for (const name of readdirSync(join(root, "logs"))) {
    if (name === "proxy.pid") continue;
    assert.ok(!readFileSync(join(root, "logs", name), "utf8").includes(token), `logs/${name} holds the stop token`);
  }
});

test("manager output masks the recorded stop token exactly, also where the token-shape rule would not", async (t) => {
  const root = kitFixture(t, await freePort());
  // A generated fixture token with more than four hyphens: the opaque-token
  // shape rule leaves it alone, so only the exact known-secret match masks it.
  const fixtureToken = `fixture-stop-${randomBytes(6).toString("hex")}-a-b-c-d`;
  writeFileSync(join(root, "logs", "proxy.log"), `[zcode-proxy] echoed ${fixtureToken}\n`);
  const logs = () => spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "logs", "10"], { env: childEnv(root), encoding: "utf8", timeout: 30_000 });
  assert.equal(logs().stdout, `[zcode-proxy] echoed ${fixtureToken}\n`, "test premise: without a recorded token the line passes unchanged");
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: NEVER_ALLOCATED_PID, startedMs: 1, startedIso: "1970-01-01T00:00:00.001Z", stopToken: fixtureToken }) + "\n", { mode: 0o600 });
  assert.equal(logs().stdout, "[zcode-proxy] echoed <redacted>\n");
});

// ------------------------------------------- proxy.log ownership (ticket 33)
// Spec §8: while it runs, the proxy is the single rotator of proxy.log. The
// manager keeps appending its `[manager <ISO>] …` lines and rotates only
// under the start lock and only when no live recorded proxy exists (the
// rotation before lock acquisition is gone). Every log-dir file the manager
// creates is 0o600, the logs dir 0o700 (POSIX). `proxy logs N` reads across
// proxy.log.1 and proxy.log.
const FIVE_MB = 5 * 1024 * 1024;
/** proxy.log past the 5 MB rotation threshold, with a first line to recognise it by. */
function oversizedLog(root) {
  const file = join(root, "logs", "proxy.log");
  writeFileSync(file, `oversized-log-start\n${`${"#".repeat(1023)}\n`.repeat(5 * 1024 + 1)}`);
  return file;
}
function assertNotRotated(file, what) {
  assert.equal(existsSync(`${file}.1`), false, `${what}: proxy.log.1 was not created`);
  const text = readFileSync(file, "utf8");
  assert.ok(text.startsWith("oversized-log-start\n") && statSync(file).size > FIVE_MB, `${what}: proxy.log kept its bytes`);
}

test("the manager never rotates proxy.log while its proxy answers, without the start lock, or over a live recorded proxy", async (t) => {
  // Its own proxy answers: already running, nothing else happens.
  const oursPort = await freePort();
  const ours = kitFixture(t, oursPort);
  await identityServer(t, oursPort, "ours");
  const oursLog = oversizedLog(ours);
  assert.equal((await (await lifecycleFor(ours)).ensureRunning()).outcome, "already-running");
  assertNotRotated(oursLog, "while its proxy answers");

  // The start lock is not this start's to take.
  const locked = kitFixture(t, await freePort());
  writeFileSync(join(locked, "logs", "manager.lock"), '{"pid":2147483647,"startedAt":"2026-01-01T00:00:00.000Z","nonce":"stale","v":99}');
  const lockedLog = oversizedLog(locked);
  assert.equal((await (await lifecycleFor(locked)).ensureRunning({ waitMs: 1000 })).outcome, "start-lock-unavailable");
  assertNotRotated(lockedLog, "without the start lock");

  // Under the lock, a live recorded process that does not answer (not proven hung): refused, log untouched.
  const live = kitFixture(t, await freePort());
  writeFileSync(join(live, "logs", "proxy.pid"), JSON.stringify({ pid: process.pid, startedMs: 1, startedIso: "1970-01-01T00:00:00.001Z" }) + "\n", { mode: 0o600 });
  const liveLog = oversizedLog(live);
  assert.equal((await (await lifecycleFor(live)).ensureRunning({ waitMs: 1000 })).outcome, "unproven-live-record");
  assertNotRotated(liveLog, "over a live recorded proxy");
});

test("under the start lock with no live recorded proxy, a start rotates proxy.log first: the old bytes in proxy.log.1, its own lines in a new proxy.log", async (t) => {
  const root = kitFixture(t, await freePort()); // nothing listens; no proxy dependencies: the start ends there
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: NEVER_ALLOCATED_PID, startedMs: 1, startedIso: "1970-01-01T00:00:00.001Z" }) + "\n", { mode: 0o600 });
  const file = oversizedLog(root);
  const record = await (await lifecycleFor(root)).ensureRunning({ waitMs: 1000 });
  assert.equal(record.outcome, "dependencies-missing");
  assert.ok(readFileSync(`${file}.1`, "utf8").startsWith("oversized-log-start\n"), "proxy.log.1 holds the rotated bytes");
  assert.match(readFileSync(file, "utf8"), /^\[manager [^\]]+\] ERROR: proxy dependencies missing\. Run: cd zcode-proxy-src && bun install --frozen-lockfile\n$/);
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600, "the new proxy.log is owner-only");
});

test("POSIX: the logs dir and every log file the manager creates are owner-only (0o700 / 0o600)", {
  skip: process.platform === "win32" && "POSIX modes; Windows files take the profile directory's ACL",
}, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port);
  await identityServer(t, port, "ours");
  rmSync(join(root, "logs"), { recursive: true, force: true });
  const lifecycle = await lifecycleFor(root);
  assert.equal((await lifecycle.ensureRunning()).outcome, "already-running"); // narrates into a new proxy.log
  assert.equal(statSync(join(root, "logs")).mode & 0o777, 0o700, "logs dir");
  assert.equal(statSync(join(root, "logs", "proxy.log")).mode & 0o777, 0o600, "proxy.log");
  // heal.log past its cap: the discarded-oversized marker file is a new heal.log.1.
  writeFileSync(join(root, "logs", "heal.log"), "x".repeat(70 * 1024), { mode: 0o600 });
  assert.equal((await lifecycle.requestRespawn(process.pid, "memory")).outcome, "refused"); // writes a heal line
  assert.equal(statSync(join(root, "logs", "heal.log.1")).mode & 0o777, 0o600, "heal.log.1");
  assert.equal(statSync(join(root, "logs", "heal.log")).mode & 0o777, 0o600, "heal.log");
});

test("`proxy logs N` reads across proxy.log.1 and proxy.log: the last N lines of both, oldest first", async (t) => {
  const root = kitFixture(t, await freePort());
  const logs = join(root, "logs");
  writeFileSync(join(logs, "proxy.log.1"), Array.from({ length: 10 }, (_, i) => `old-${i + 1}\n`).join(""));
  writeFileSync(join(logs, "proxy.log"), "new-1\nnew-2\n");
  const run = (n) => spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "logs", String(n)], { env: childEnv(root), encoding: "utf8", timeout: 30_000 });
  assert.equal(run(5).stdout, "old-8\nold-9\nold-10\nnew-1\nnew-2\n");
  assert.equal(run(2).stdout, "new-1\nnew-2\n");
  assert.equal(run(40).stdout, `${Array.from({ length: 10 }, (_, i) => `old-${i + 1}`).join("\n")}\nnew-1\nnew-2\n`);
  // Right after a rotation the current file may not exist yet.
  rmSync(join(logs, "proxy.log"));
  assert.equal(run(3).stdout, "old-8\nold-9\nold-10\n");
  rmSync(join(logs, "proxy.log.1"));
  assert.equal(run(3).stdout, `(no log file at ${join(logs, "proxy.log")})\n`);
});

// ---------------------------------------------- early log, per-start (ticket 34)
test("early log: each start copies only the last 64 KiB behind a marker before truncating, with inherited stdio on the same owner-only file", { timeout: 90_000 }, async (t) => {
  const root = kitFixture(t, await freePort(), { proxySrc: true });
  const early = join(root, "logs", "proxy.early.log");
  const log = join(root, "logs", "proxy.log");
  const tail = `tail-start\n${"t".repeat(64 * 1024 - 21)}\ntail-end\n`;
  assert.equal(Buffer.byteLength(tail), 64 * 1024);
  writeFileSync(early, `discarded-head\n${"h".repeat(2 * 1024 * 1024)}\n${tail}`, { mode: 0o600 });
  const fake = join(root, "zcode-proxy-src", "src", "index.ts");
  writeFileSync(fake, `import { writeSync } from "node:fs"; writeSync(1, "native-stdout\\n"); writeSync(2, "native-stderr\\n");\n${FAKE_PROXY}`);
  const lifecycle = await lifecycleFor(root, { bunResolver: bunOrFail });
  const started = await lifecycle.ensureRunning({ waitMs: 30_000 });
  const record = readJson(join(root, "logs", "proxy.pid"));
  if (record) defer(root, () => killFixtureProxy(root, record.pid));
  assert.equal(started.code, 0, JSON.stringify(started));
  assert.equal(readFileSync(early, "utf8"), "native-stdout\nnative-stderr\n");
  const copied = readFileSync(log, "utf8");
  assert.match(copied, /^\d{4}-\d\d-\d\dT[\d:.]+Z INFO manager proxy\.early\.log tail copy reason=start sizeBytes=\d+ tailBytes=65536\n/m);
  assert.ok(copied.includes(tail));
  assert.ok(!copied.includes("discarded-head"));
  assert.ok(!copied.includes("native-stdout"), "inherited stdio does not bypass ticket 33's single proxy.log writer");
  if (process.platform !== "win32") assert.equal(statSync(early).mode & 0o777, 0o600);
  // A refusal/already-running preflight must not truncate an active early log.
  assert.equal((await lifecycle.ensureRunning()).outcome, "already-running");
  assert.equal(readFileSync(early, "utf8"), "native-stdout\nnative-stderr\n");
  assert.equal((await lifecycle.restart({ waitMs: 30_000 })).code, 0);
  const next = readJson(join(root, "logs", "proxy.pid"));
  if (next) defer(root, () => killFixtureProxy(root, next.pid));
  assert.equal(readFileSync(early, "utf8"), "native-stdout\nnative-stderr\n");
  assert.ok(readFileSync(log, "utf8").includes("tailBytes=28\nnative-stdout\nnative-stderr\n"));
});

test("early log: a failed start preserves its native cause in proxy.log immediately, not just on the next attempt", { timeout: 30_000 }, async (t) => {
  const root = kitFixture(t, await freePort(), { proxySrc: true });
  writeFileSync(join(root, "zcode-proxy-src", "src", "index.ts"), 'import { writeSync } from "node:fs"; writeSync(2, "SyntaxError: fixture-native-start-failure\\n"); process.exit(7);');
  const lifecycle = await lifecycleFor(root, { bunResolver: bunOrFail });
  const failed = await lifecycle.ensureRunning({ waitMs: 5000 });
  assert.equal(failed.outcome, "exited");
  assert.equal(failed.code, 2);
  const log = readFileSync(join(root, "logs", "proxy.log"), "utf8");
  assert.match(log, /proxy\.early\.log tail copy reason=exited sizeBytes=42 tailBytes=42\nSyntaxError: fixture-native-start-failure\n/);
  assert.equal(readFileSync(join(root, "logs", "proxy.early.log"), "utf8"), "SyntaxError: fixture-native-start-failure\n", "failure does not discard the original early log");
  const { classifyStartFailure } = await import("../scripts/verify-golden-path.mjs");
  assert.equal(classifyStartFailure(log, false).syntaxError, true, "the actual golden-path classifier sees the cause through the marker in proxy.log only");
  assert.equal(classifyStartFailure(log, false).exitCode, 7);
});

// -------------------------------------------- Windows kill guard identity (77)
// Ticket 77 (found by ticket 21 round 3, run 42500996594): the Windows start
// time was read as `Number(.NET ticks) / 10000 - epoch`, and the kill guard
// compared the handle's creation time with FromUnixTimeMilliseconds(trunc(…))
// at 1 ms. The tick count (~6.39e17) is above 2^53, so a start just above a
// millisecond boundary lost a whole millisecond and every signal to that
// process was refused. These tests drive the lifecycle module as it runs on
// Windows: process.platform reads win32 and `powershell` on PATH is a
// stand-in (tests/fixtures/fake-powershell.mjs) that answers the start-time
// reader and evaluates the kill guard's identity check against the handle's
// creation FILETIME. They fake Windows on a POSIX host; the windows-latest leg
// runs the real PowerShell through the spawned tests above.
const FAKE_POWERSHELL = join(ROOT, "tests", "fixtures", "fake-powershell.mjs");
const { identityCheckExit } = await import(pathToFileURL(FAKE_POWERSHELL).href);
// The worked example: the true start is …240003.0001 ms since the Unix epoch;
// the pre-77 reader gave …240002.9922 and the guard compared against …240002.
const WORKED_TICKS = 639297530400030001n;
const WORKED_FILETIME = 134386298400030001n; // the same instant as a creation FILETIME
const WORKED_MS = 1794156240003.0001; // as a double: …240003.0 (resolution 0.24 µs at this magnitude)
const OLD_KIT_WORKED_MS = 1794156240002.9922; // what a pre-77 kit recorded for it
const TICKS_PER_MS = 10000n;
const FILETIME_OF = (ticks) => ticks - 504911232000000000n;
const fakeWindows = { skip: process.platform === "win32" && "fakes Windows on a POSIX host; windows-latest runs the real PowerShell" };

/** Run as Windows with a stand-in PowerShell; `processes` as in the fixture's state file. */
function asWindows(processes) {
  const dir = mkdtempSync(join(tmpdir(), "fake-powershell-"));
  const state = join(dir, "state.json");
  const log = join(dir, "calls.jsonl");
  writeFileSync(state, JSON.stringify({ log, processes }));
  writeFileSync(join(dir, "powershell"), `#!/bin/sh\nFAKE_POWERSHELL_STATE='${state}' exec '${process.execPath}' '${FAKE_POWERSHELL}' "$@"\n`, { mode: 0o755 });
  const saved = { platform: Object.getOwnPropertyDescriptor(process, "platform"), path: process.env.PATH };
  Object.defineProperty(process, "platform", { ...saved.platform, value: "win32" });
  process.env.PATH = dir + delimiter + saved.path;
  return {
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    restore() {
      Object.defineProperty(process, "platform", saved.platform);
      process.env.PATH = saved.path;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const newKitRecord = (pid, ticks, ms) => ({ pid, startedMs: ms, startedIso: new Date(ms).toISOString(), startTicks: String(ticks) });
const oldKitRecord = (pid, ms) => ({ pid, startedMs: ms, startedIso: new Date(ms).toISOString() });
const msOf = (ticks) => Number(ticks - 621355968000000000n) / 10000; // a record's display value only
const gone = (child) => until(`pid ${child.pid} to exit`, () => child.exitCode !== null || child.signalCode !== null, 10_000);

/**
 * One healthy-answering installation per case, each with a live stand-in
 * proxy recorded in proxy.pid (record(pid)) and described to the stand-in
 * PowerShell (process(pid)); then every stop at once, as Windows.
 * Returns [{ proxy, root, record, stopped }] in case order, plus the calls.
 */
async function stopAsWindows(t, cases) {
  const fixtures = [];
  for (const c of cases) {
    const port = await freePort();
    const root = kitFixture(t, port);
    await identityServer(t, port, "ours");
    const proxy = spawn(process.execPath, ["-e", 'setInterval(() => {}, 1e6); process.stdout.write("up\\n");', join(root, "stand-in")], { stdio: ["ignore", "pipe", "ignore"] });
    defer(root, () => killChild(proxy));
    await new Promise((r) => proxy.stdout.once("data", r));
    const record = c.record(proxy.pid);
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify(record) + "\n");
    fixtures.push({ c, root, proxy, record, lifecycle: await lifecycleFor(root) });
  }
  const win = asWindows(Object.fromEntries(fixtures.map((f) => [f.proxy.pid, f.c.process(f.proxy.pid)])));
  let stopped, calls;
  try {
    stopped = await Promise.all(fixtures.map((f) => f.lifecycle.stop()));
    calls = win.calls();
  } finally { win.restore(); }
  return fixtures.map((f, i) => ({ ...f, stopped: stopped[i], calls: calls.filter((call) => call.pid === f.proxy.pid) }));
}

test("the Windows start-time reader keeps the exact tick count: 639297530400030001 reads as …240003.0001 ms, not a millisecond early", fakeWindows, async (t) => {
  const root = kitFixture(t, await freePort());
  const lifecycle = await lifecycleFor(root);
  const win = asWindows({ 4242: { ticks: String(WORKED_TICKS) } });
  let ms;
  try { ms = lifecycle.processStartMs(4242); } finally { win.restore(); }
  assert.equal(Math.floor(ms), 1794156240003, `read ${ms}: the millisecond the process started in`);
  assert.ok(Math.abs(ms - WORKED_MS) < 1e-3, `read ${ms}, expected ${WORKED_MS}`);
});

test("stop terminates a recorded proxy whose start lies just above a millisecond boundary (worked example and boundary sweep)", { ...fakeWindows, timeout: 120_000 }, async (t) => {
  const boundary = WORKED_TICKS - 1n; // …240003.0000 ms exactly
  const sweep = [WORKED_TICKS, boundary, boundary + 2n, boundary + 64n, boundary + 127n, boundary + 128n, boundary + 9999n, boundary + 10001n];
  const results = await stopAsWindows(t, sweep.map((ticks) => ({
    record: (pid) => newKitRecord(pid, ticks, msOf(ticks)),
    process: () => ({ ticks: String(ticks) }),
  })));
  for (const [i, { proxy, root, stopped }] of results.entries()) {
    assert.deepEqual({ ticks: String(sweep[i]), code: stopped.code, lines: stopped.lines }, { ticks: String(sweep[i]), code: 0, lines: [`stopped (pid ${proxy.pid})`] });
    await gone(proxy);
    assert.equal(existsSync(join(root, "logs", "proxy.pid")), false, "the stopped proxy's record is removed");
  }
});

test("the kill guard compares the handle's creation FILETIME exactly: the same tick passes, one tick or 1 ms + 1 tick away is refused", async () => {
  // Pure: the guard script text for every boundary tick value, evaluated by the
  // stand-in's identity check. The worked example's literal is pinned.
  const { killGuardScript } = await import(pathToFileURL(join(ROOT, "lib", "proxy-lifecycle.mjs")).href);
  const worked = killGuardScript(4242, String(WORKED_TICKS));
  assert.match(worked, /if \(\$created -ne \[long\]'134386298400030001'\) \{ exit 4 \}/);
  assert.doesNotMatch(worked, /FromUnixTimeMilliseconds|TotalMilliseconds/, "no millisecond rounding in the comparison");
  assert.ok(worked.indexOf("$created -ne") < worked.indexOf("TerminateProcess($handle,0)"), "the identity check precedes the signal");
  assert.match(worked, /OpenProcess\(0x1001, \$false, 4242\)/);
  let checked = 0;
  for (let ms = 0n; ms < 200n; ms++) {
    for (const sub of [0n, 1n, 2n, 63n, 64n, 65n, 127n, 128n, 129n, 5000n, 9872n, 9998n, 9999n]) {
      const ticks = WORKED_TICKS - 1n + ms * TICKS_PER_MS + sub;
      const script = killGuardScript(4242, String(ticks));
      const created = FILETIME_OF(ticks);
      assert.equal(identityCheckExit(script, created), 0, `ticks ${ticks}: the matching process passes`);
      for (const off of [1n, -1n, TICKS_PER_MS + 1n, -(TICKS_PER_MS + 1n)]) {
        assert.equal(identityCheckExit(script, created + off), 4, `ticks ${ticks}: a handle created ${off} ticks away is refused`);
      }
      checked++;
    }
  }
  assert.equal(checked, 2600);
  assert.equal(FILETIME_OF(WORKED_TICKS), WORKED_FILETIME);
  assert.throws(() => killGuardScript(4242, "not-ticks"), SyntaxError, "a guard is never built without an exact identity");
});

test("a reused pid is still refused: a live start one tick or 1 ms + 1 tick from the record, or a handle created 1 ms + 1 tick later", { ...fakeWindows, timeout: 120_000 }, async (t) => {
  const cases = [
    ["live start 1 tick later", WORKED_TICKS + 1n, null, { code: 4, outcome: "reuse-suspect", guard: false }],
    ["live start 1 ms + 1 tick later", WORKED_TICKS + TICKS_PER_MS + 1n, null, { code: 4, outcome: "reuse-suspect", guard: false }],
    ["handle created 1 ms + 1 tick later", WORKED_TICKS, WORKED_FILETIME + TICKS_PER_MS + 1n, { code: 2, outcome: "kill-failed", guard: true }],
    ["handle created 1 tick earlier", WORKED_TICKS, WORKED_FILETIME - 1n, { code: 2, outcome: "kill-failed", guard: true }],
  ];
  const results = await stopAsWindows(t, cases.map(([, live, created]) => ({
    record: (pid) => newKitRecord(pid, WORKED_TICKS, WORKED_MS),
    process: () => ({ ticks: String(live), ...(created === null ? {} : { created: String(created) }) }),
  })));
  for (const [i, { proxy, root, record, stopped, calls }] of results.entries()) {
    const [label, , , want] = cases[i];
    assert.deepEqual({ label, code: stopped.code, outcome: stopped.outcome }, { label, code: want.code, outcome: want.outcome });
    const guards = calls.filter((c) => c.kind === "guard");
    if (want.guard) {
      assert.ok(guards.length >= 1 && guards.every((g) => g.exit === 4), `${label}: every guard run refused (${JSON.stringify(guards)})`);
      assert.ok(stopped.lines.includes(`refusing to signal pid ${proxy.pid}: process handle identity could not be confirmed (kill guard exit 4: the handle's creation time differs from the expected start)`), stopped.lines.join("\n"));
    } else {
      assert.deepEqual(guards, [], `${label}: no signal attempt at all`);
    }
    assert.equal(proxy.exitCode, null, `${label}: the process is never signalled`);
    assert.equal(proxy.signalCode, null);
    assert.deepEqual(readJson(join(root, "logs", "proxy.pid")), record, `${label}: the record stays`);
  }
});

test("a pid record whose start ticks are present but unreadable proves nothing: stop refuses and never signals", { ...fakeWindows, timeout: 60_000 }, async (t) => {
  // Its startedMs alone would pass the legacy 1 ms rule; a damaged identity
  // must not fall back to it (B4: never signal on an unproven identity).
  const damaged = ["6392975304000300O1", "", "-639297530400030001", "1e18"];
  const results = await stopAsWindows(t, damaged.map((startTicks) => ({
    record: (pid) => ({ ...newKitRecord(pid, WORKED_TICKS, WORKED_MS), startTicks }),
    process: () => ({ ticks: String(WORKED_TICKS) }),
  })));
  for (const [i, { proxy, root, record, stopped, calls }] of results.entries()) {
    assert.deepEqual({ startTicks: damaged[i], code: stopped.code, outcome: stopped.outcome }, { startTicks: damaged[i], code: 4, outcome: "start-unknown" });
    assert.deepEqual(calls.filter((c) => c.kind === "guard"), []);
    assert.equal(proxy.exitCode, null);
    assert.deepEqual(readJson(join(root, "logs", "proxy.pid")), record);
  }
});

test("a pid record from an older kit (millisecond startedMs, no ticks) still verifies within 1 ms; one more than 1 ms away is refused", { ...fakeWindows, timeout: 60_000 }, async (t) => {
  // Legacy tolerance: |live − recorded| ≤ 1 ms (the rule older kits applied).
  // An older kit's value for this process is …240002.9922 (float error < 0.01 ms).
  const cases = [[OLD_KIT_WORKED_MS, 0], [WORKED_MS - 0.999, 0], [WORKED_MS + 0.999, 0], [WORKED_MS - 1.01, 4], [WORKED_MS + 1.01, 4]];
  const results = await stopAsWindows(t, cases.map(([recordedMs]) => ({
    record: (pid) => oldKitRecord(pid, recordedMs),
    process: () => ({ ticks: String(WORKED_TICKS) }),
  })));
  for (const [i, { proxy, stopped }] of results.entries()) {
    const [recordedMs, want] = cases[i];
    assert.deepEqual({ recordedMs, code: stopped.code }, { recordedMs, code: want }, stopped.lines.join("\n"));
    if (want === 0) await gone(proxy);
    else {
      assert.equal(stopped.outcome, "reuse-suspect");
      assert.equal(proxy.exitCode, null);
    }
  }
});

test("the stop narration records the kill guard's exit code, and each refusal branch reads differently", { ...fakeWindows, timeout: 60_000 }, async (t) => {
  const exits = [2, 3, 4, 5, 1];
  const results = await stopAsWindows(t, exits.map((guardExit) => ({
    record: (pid) => newKitRecord(pid, WORKED_TICKS, WORKED_MS),
    process: () => ({ ticks: String(WORKED_TICKS), guardExit }),
  })));
  const seen = new Map();
  for (const [i, { proxy, stopped }] of results.entries()) {
    const exit = exits[i];
    assert.equal(stopped.code, 2);
    const line = stopped.lines.find((l) => l.includes(`kill guard exit ${exit}`));
    assert.ok(line, `exit ${exit}: ${stopped.lines.join(" | ")}`);
    assert.deepEqual(stopped.lines.slice(-1), [`ERROR killing pid ${proxy.pid}`]);
    seen.set(exit, line.replace(String(proxy.pid), "<pid>"));
  }
  assert.equal(new Set(seen.values()).size, exits.length, [...seen.values()].join("\n"));
  assert.match(seen.get(2), /OpenProcess failed/);
  assert.match(seen.get(3), /GetProcessTimes failed/);
  assert.match(seen.get(4), /creation time differs/);
  assert.match(seen.get(5), /TerminateProcess failed/);
  assert.match(seen.get(1), /PowerShell error/);
});

test("a proxy the manager starts on Windows records its exact start ticks, and stop terminates it through the guard", { ...fakeWindows, timeout: 120_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port, { proxySrc: true });
  const bun = bunOrFail();
  const lifecycle = await lifecycleFor(root, { bunResolver: () => bun });
  const win = asWindows({ "*": { ticks: String(WORKED_TICKS) } });
  let started, record, stopped;
  try {
    started = await lifecycle.ensureRunning({ waitMs: 30_000 });
    record = readJson(join(root, "logs", "proxy.pid"));
    if (record) defer(root, () => killFixtureProxy(root, record.pid));
    stopped = await lifecycle.stop();
  } finally { win.restore(); }
  assert.equal(started.code, 0, started.lines.join("\n"));
  // The record also carries this spawn's stop token (ticket 18; its value is
  // checked in the section below): compared here without it.
  const { stopToken, ...identityFields } = record ?? {};
  assert.ok(typeof stopToken === "string" && stopToken.length > 0, "the record carries a stop token");
  assert.deepEqual(identityFields, { pid: started.pid, startedMs: WORKED_MS, startedIso: "2026-11-08T16:44:00.003Z", startTicks: "639297530400030001" });
  assert.deepEqual({ code: stopped.code, lines: stopped.lines }, { code: 0, lines: [`stopped (pid ${started.pid})`] });
  await until("the proxy to leave the port", async () => await identity(port) === "down", 15_000);
});

// ------------------------- the stop token in 16's pid record (tickets 16, 18, 77)
// Every proxy.pid is built by one builder (pidRecord, ticket 16) and written
// atomically at mode 0600; the stop token (ticket 18) goes through it: the
// spawn intent, the pid and start-time writes of the spawner, and
// completeRecord, which rewrites a record another manager wrote and so keeps
// that record's token for the same spawn and never invents one. startTicks
// (ticket 77) and the spawn intent stay as they were. Tokens are generated
// fixtures and are compared without printing them (B2).

// An in-process listener that answers the identity proof naming `pid` as its own.
async function identityListenerFor(t, port, pid) {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end();
    res.end(JSON.stringify({ status: "ok", provider: "zai", details: { pid } }));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
}
/** A harmless child the test owns (killed through its own handle at the end). */
function harmlessChild(t) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)"], { stdio: "ignore" });
  t.after(() => killChild(child));
  return child;
}
const DEAD_SPAWNER = NEVER_ALLOCATED_PID;
const modeOf = (file) => statSync(file).mode & 0o777;

test("completeRecord keeps the stop token of the record it completes (a recorded pid or a spawn intent), never invents one, and leaves the record owner-only", { timeout: 60_000 }, async (t) => {
  const cases = [
    ["recorded pid with a token", "pid", true],
    ["spawn intent with a token", "intent", true],
    ["recorded pid without a token (an older kit)", "pid", false],
    ["spawn intent without a token (an older kit)", "intent", false],
  ];
  for (const [label, kind, withToken] of cases) {
    const port = await freePort();
    const root = kitFixture(t, port);
    const proxy = harmlessChild(t);
    await new Promise((r) => proxy.once("spawn", r));
    await identityListenerFor(t, port, proxy.pid);
    const token = randomBytes(32).toString("base64url");
    const at = Date.now();
    const unfinished = {
      pid: kind === "pid" ? proxy.pid : null, startedMs: null, startedIso: null, spawning: { by: DEAD_SPAWNER, at },
      ...(withToken ? { stopToken: token } : {}),
    };
    // Another manager's record, world-readable (an older kit's write mode).
    const pidFile = join(root, "logs", "proxy.pid");
    writeFileSync(pidFile, JSON.stringify(unfinished) + "\n");
    chmodSync(pidFile, 0o644);
    const started = await (await lifecycleFor(root)).ensureRunning();
    assert.equal(started.outcome, "already-running", `${label}: ${started.lines.join("\n")}`);
    const { stopToken, ...rest } = readJson(pidFile) ?? {};
    assert.equal(rest.pid, proxy.pid, `${label}: completed for the answering pid`);
    assert.ok(Number.isFinite(rest.startedMs), `${label}: the start time is recorded`);
    assert.equal(rest.spawning, undefined, `${label}: the spawn intent is gone once complete`);
    if (withToken) assert.ok(stopToken === token, `${label}: the completed record keeps the token it held`);
    else assert.equal(stopToken, undefined, `${label}: no token is invented`);
    if (process.platform !== "win32") assert.equal(modeOf(pidFile), 0o600, `${label}: the completed record is owner-only`);
    assert.ok(!started.lines.some((l) => l.includes(token)), `${label}: no narration line carries the token`);
    assert.ok(untouchedChild(proxy), `${label}: the proxy is never signalled`);
  }
});
const untouchedChild = (child) => child.exitCode === null && child.signalCode === null;

test("the manager's reports never return the recorded stop token: readPidFile and readState carry the identity fields only", async (t) => {
  const root = kitFixture(t, await freePort());
  const token = randomBytes(32).toString("base64url");
  const record = { pid: NEVER_ALLOCATED_PID, startedMs: WORKED_MS, startedIso: "2026-11-08T16:44:00.003Z", startTicks: String(WORKED_TICKS), stopToken: token };
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify(record) + "\n", { mode: 0o600 });
  const lifecycle = await lifecycleFor(root);
  const { stopToken, ...identityFields } = record;
  assert.deepEqual(lifecycle.readPidFile(), identityFields);
  const state = await lifecycle.readState();
  assert.ok(!JSON.stringify(state).includes(token), "readState carries no stop token");
  assert.deepEqual(state.pidRecord, identityFields);
});

test("a spawn's records all carry its stop token next to startTicks: the intent, the pid record and the completed record, as Windows", { ...fakeWindows, timeout: 120_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port, { proxySrc: true });
  const bun = bunOrFail();
  const pidFile = join(root, "logs", "proxy.pid");
  const kitEnvOut = join(root, "kit-env.json");
  const seenAt = {};
  const lifecycle = await lifecycleFor(root, { bunResolver: () => bun, stepHook: (step) => { if (step.startsWith("spawn:")) seenAt[step] = readJson(pidFile); } });
  const win = asWindows({ "*": { ticks: String(WORKED_TICKS) } });
  const savedOut = process.env.FAKE_PROXY_KIT_ENV_OUT;
  process.env.FAKE_PROXY_KIT_ENV_OUT = kitEnvOut;
  let started, record, mode, stopped;
  try {
    started = await lifecycle.ensureRunning({ waitMs: 30_000 });
    record = readJson(pidFile);
    if (record) defer(root, () => killFixtureProxy(root, record.pid));
    mode = modeOf(pidFile);
    stopped = await lifecycle.stop();
  } finally {
    win.restore();
    if (savedOut === undefined) delete process.env.FAKE_PROXY_KIT_ENV_OUT; else process.env.FAKE_PROXY_KIT_ENV_OUT = savedOut;
  }
  assert.equal(started.code, 0, started.lines.join("\n"));
  const seen = readJson(kitEnvOut);
  assert.equal(seen?.pid, started.pid, "test premise: the proxy recorded its per-spawn environment");
  const token = seen.stopToken;
  assert.ok(typeof token === "string" && STOP_TOKEN_SHAPE.test(token), "the proxy received a stop token");
  const intent = seenAt["spawn:intent-recorded"];
  assert.deepEqual({ pid: intent?.pid, by: intent?.spawning?.by, startTicks: intent?.startTicks }, { pid: null, by: process.pid, startTicks: undefined }, "the spawn intent is 16's, unchanged");
  assert.ok(intent.stopToken === token, "the spawn intent carries the spawn's token");
  assert.ok(seenAt["spawn:pid-recorded"]?.stopToken === token, "the pid record carries it");
  assert.ok(seenAt["spawn:start-recorded"]?.stopToken === token, "the start-time record carries it");
  const { stopToken, ...identityFields } = record;
  assert.ok(stopToken === token, "the final record carries the token the proxy received");
  assert.deepEqual(identityFields, { pid: started.pid, startedMs: WORKED_MS, startedIso: "2026-11-08T16:44:00.003Z", startTicks: "639297530400030001" }, "77's exact ticks, next to the token");
  assert.equal(mode, 0o600, "the record is owner-only");
  assert.ok(!started.lines.concat(stopped.lines).some((l) => l.includes(token)), "no narration line carries the token");
  assert.deepEqual({ code: stopped.code, lines: stopped.lines }, { code: 0, lines: [`stopped (pid ${started.pid})`] });
  await until("the proxy to leave the port", async () => await identity(port) === "down", 15_000);
});
