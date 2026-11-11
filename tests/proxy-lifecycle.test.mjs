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
import { chmodSync, closeSync, cpSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
  // Ticket 43: the output module's token set and width core re-export the
  // shared files under zcode-proxy-src/src/tui — part of every real kit
  // layout, so the fixture kit carries them too.
  mkdirSync(join(root, "zcode-proxy-src", "src", "tui"), { recursive: true });
  for (const f of ["tokens.mjs", "width-core.mjs"]) cpSync(join(ROOT, "zcode-proxy-src", "src", "tui", f), join(root, "zcode-proxy-src", "src", "tui", f));
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
let pressureState = "starting";
let readinessPolls = 0;
let samplesTaken = 0;
const server = createServer((req, res) => {
  if (req.headers.authorization !== "Bearer " + key) return res.writeHead(401).end("{}");
  if (req.url === "/health") { answeredAt ??= Date.now(); return res.end(JSON.stringify({ status: "ok", provider: "zai", details: { pressureState, readinessPolls, samplesTaken } })); }
  res.writeHead(404).end("{}");
}).listen(port, "127.0.0.1");
// A slow manager (the late acknowledgement): the hook runs FAKE_LATE_MANAGER,
// which starts the real manager late.
const env = { ...process.env };
if (env.FAKE_COMPLETION_MANAGER) env.ZCODE_KIT_RESPAWN_MANAGER = env.FAKE_COMPLETION_MANAGER;
if (env.FAKE_LATE_MANAGER) { env.FAKE_REAL_MANAGER = env.ZCODE_KIT_RESPAWN_MANAGER; env.ZCODE_KIT_RESPAWN_MANAGER = env.FAKE_LATE_MANAGER; }
const supervisor = createHealthSupervisor({
  thresholds: { samples: 1, sampleIntervalMs: 250 },
  sample: () => { samplesTaken++; return { mb: Number(process.env.FAKE_PRESSURE_MB), metric: "footprint" }; },
  respawn: managerRespawnHandoff(env, process.env.FAKE_ACK_WAIT_MS ? { ackWaitMs: Number(process.env.FAKE_ACK_WAIT_MS) } : {}),
  shutdown: async () => { console.log("stand-in drained"); server.close(); process.exit(0); },
  watchdog: false,
});
// Health + a start-time record does not mean the spawning manager finished:
// Windows process/connection probes can still be running. Each fixture
// manager publishes a per-generation marker only after the real CLI exits 0.
// Missing completion is a fixture failure, never permission to start pressure.
const ready = setInterval(() => {
  if (answeredAt === null) return;
  readinessPolls++;
  let record = null;
  try { record = JSON.parse(readFileSync(join(process.env.ZCODE_KIT_LOG_DIR, "proxy.pid"), "utf8")); } catch {}
  const recorded = record?.pid === process.pid && Number.isFinite(record?.startedMs);
  let completed = null;
  try { completed = JSON.parse(readFileSync(join(process.env.ZCODE_KIT_LOG_DIR, "fixture-manager-complete-" + process.pid), "utf8")); } catch {}
  const sameGeneration = recorded && completed?.pid === record.pid && completed?.startedMs === record.startedMs && completed?.startTicks === record.startTicks;
  if (!sameGeneration) {
    pressureState = "waiting-manager";
    if (Date.now() - answeredAt >= 10_000) throw new Error("fixture start manager did not complete within 10000ms");
    return;
  }
  clearInterval(ready);
  pressureState = "running";
  supervisor.start();
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

// Only a successful exit of the real fixture manager may arm its next proxy.
// This wrapper changes no manager lifecycle code, timings, or exit statuses.
function completionManager(root, { managerNodeArgs = [], managerAfterObserverArgs = [], lifecycleModule = pathToFileURL(join(root, "lib", "proxy-lifecycle.mjs")).href } = {}) {
  const entry = join(root, "completion-manager.mjs");
  const adapter = join(root, "completion-lifecycle.mjs");
  const preload = join(root, "completion-observer.mjs");
  // Capture the generation at the existing lifecycle seam, not by assuming
  // whatever proxy.pid names after the child closes is the child it started.
  // The real CLI still executes; only this test wrapper uses the IPC channel.
  writeFileSync(adapter, `
export * from ${JSON.stringify(lifecycleModule)};
import { createLifecycle as realLifecycle } from ${JSON.stringify(lifecycleModule)};
import { readFileSync, writeFileSync } from "node:fs";
const traceFile = ${JSON.stringify(join(root, "logs"))} + "/completion-observer-" + process.pid + ".json";
const trace = (fields) => {
  let previous = {};
  try { previous = JSON.parse(readFileSync(traceFile, "utf8")); } catch {}
  writeFileSync(traceFile, JSON.stringify({ ...previous, ...fields }), { mode: 0o600 });
};
const snapshot = () => {
  const r = JSON.parse(readFileSync(${JSON.stringify(join(root, "logs", "proxy.pid"))}, "utf8"));
  return { pid: r.pid, startedMs: r.startedMs, ...(r.startTicks === undefined ? {} : { startTicks: r.startTicks }) };
};
export function createLifecycle(options) {
  trace({ adapterInvoked: true, managerPid: process.pid });
  let spawned = null;
  const lifecycle = realLifecycle({ ...options, stepHook(step) {
    options.stepHook?.(step);
    if (step === "spawn:start-recorded") spawned = snapshot();
  } });
  const observed = (intent) => async (...args) => {
    const result = await lifecycle[intent](...args);
    if (result.code === 0) {
      const identity = spawned ?? snapshot(); // late acknowledgement: existing serving generation
      trace({ intent, intentCode: result.code, identity, sendCalled: true });
      await new Promise((resolve, reject) => process.send({ type: "fixture-manager-generation", identity }, (err) => {
        trace({ sendCallback: true, sendErrorCode: err?.code ?? null });
        err ? reject(err) : resolve();
      }));
    }
    return result;
  };
  return { ...lifecycle, ensureRunning: observed("ensureRunning"), requestRespawn: observed("requestRespawn") };
}
`);
  writeFileSync(preload, `
import { registerHooks } from "node:module";
import { realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Canonicalize BOTH operands: Node's parentURL spelling need not equal the
// native realpath URL (Windows short names/case, or equivalent URL encoding).
// Scope stays this fixture's exact manager file and exact lifecycle import.
const canonical = (url) => {
  if (!url?.startsWith("file:")) return null;
  try {
    const path = realpathSync.native(fileURLToPath(url));
    return process.platform === "win32" ? path.toLowerCase() : path;
  } catch { return null; }
};
const manager = canonical(${JSON.stringify(pathToFileURL(join(root, "proxy", "zcode-proxy-manager.mjs")).href)});
let hookOrdinal = 0;
registerHooks({ resolve(spec, context, next) {
  hookOrdinal++;
  if (spec === "../lib/proxy-lifecycle.mjs") {
    const parent = canonical(context.parentURL);
    const matched = manager !== null && parent === manager;
    // Trace EVERY lifecycle-import resolve, whatever the parentURL spelling —
    // a short-name (8.3) or otherwise non-suffix spelling must still leave
    // evidence, especially when the comparator misses it. Only fixture file
    // identity/URL facts; never env, config, key or pid-record contents.
    // parentURL is recorded as RECEIVED, so a rewrite by an earlier hook of
    // the chain stays visible; hookOrdinal is this hook's resolve count, the
    // order it saw inside this process.
    writeFileSync(${JSON.stringify(join(root, "logs"))} + "/completion-resolve-" + process.pid + ".json", JSON.stringify({ parentURL: context.parentURL ?? null, canonicalParent: parent, canonicalManager: manager, matched, hookOrdinal }), { mode: 0o600 });
    if (matched) return { url: ${JSON.stringify(pathToFileURL(adapter).href)}, shortCircuit: true };
  }
  return next(spec, context);
} });
`);
  writeFileSync(entry, `
import { spawn } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const child = spawn(process.execPath, [...${JSON.stringify(managerNodeArgs)}, "--import", ${JSON.stringify(pathToFileURL(preload).href)}, ...${JSON.stringify(managerAfterObserverArgs)}, ${JSON.stringify(join(root, "proxy", "zcode-proxy-manager.mjs"))}, ...process.argv.slice(2)], { env: process.env, stdio: ["inherit", "inherit", "inherit", "ipc"] });
let generation = null;
let messages = 0;
const receiptFile = ${JSON.stringify(join(root, "logs"))} + "/completion-receipt-" + child.pid + ".json";
const receipt = (fields = {}) => writeFileSync(receiptFile, JSON.stringify({ wrapperPid: process.pid, managerPid: child.pid, messages, generation, ...fields }), { mode: 0o600 });
child.on("message", (message) => {
  if (message?.type === "fixture-manager-generation") { generation = message.identity; messages++; receipt(); }
});
const timer = setTimeout(() => { child.kill("SIGKILL"); process.exitCode = 124; }, 90_000);
child.once("error", (err) => { clearTimeout(timer); console.error(err.message); process.exitCode = 1; });
child.once("close", (code) => {
  clearTimeout(timer);
  receipt({ closeCode: code });
  if (process.exitCode === 124) return;
  process.exitCode = code ?? 1;
  if (code !== 0) return;
  const logDir = ${JSON.stringify(join(root, "logs"))};
  const record = JSON.parse(readFileSync(join(logDir, "proxy.pid"), "utf8"));
  if (!generation || !Number.isInteger(generation.pid) || !Number.isFinite(generation.startedMs)) throw new Error("completed manager left no started proxy generation: " + JSON.stringify({ messages, generationPresent: generation !== null, pidInteger: Number.isInteger(generation?.pid), startedMsFinite: Number.isFinite(generation?.startedMs) }));
  if (record.pid !== generation.pid || record.startedMs !== generation.startedMs || record.startTicks !== generation.startTicks) throw new Error("completed manager proxy generation changed before completion");
  const marker = join(logDir, "fixture-manager-complete-" + record.pid);
  const temp = marker + "." + process.pid + ".tmp";
  writeFileSync(temp, JSON.stringify({ pid: record.pid, startedMs: record.startedMs, startTicks: record.startTicks }), { mode: 0o600, flag: "wx" });
  renameSync(temp, marker);
});
`);
  return entry;
}

// Exercise the generated wrapper and real CLI, not a hand-built successful
// marker. Percent-encoding an unreserved character keeps the same file but
// changes the raw parentURL string, portably exposing representation matching.
// This is a controlled URL-shape counterexample, NOT native Windows evidence.
test("the completion observer follows an equivalent file URL through the actual wrapper and CLI", { timeout: 60_000 }, async (t) => {
  const root = kitFixture(t, await freePort(), { proxySrc: true });
  const control = join(root, "parent-url-control.mjs");
  const trace = join(root, "parent-url-control.json");
  writeFileSync(control, `
import { registerHooks } from "node:module";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({ resolve(spec, context, next) {
  if (spec === "../lib/proxy-lifecycle.mjs" && context.parentURL?.endsWith("/proxy/zcode-proxy-manager.mjs")) {
    const shaped = context.parentURL.replace("zcode-proxy-manager.mjs", "%7Acode-proxy-manager.mjs");
    writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ original: context.parentURL, shaped, sameFile: fileURLToPath(shaped) === fileURLToPath(context.parentURL) }));
    return next(spec, { ...context, parentURL: shaped });
  }
  return next(spec, context);
} });
`);
  const manager = completionManager(root, { managerAfterObserverArgs: ["--import", pathToFileURL(control).href] });
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail() });
  const result = spawnSync(process.execPath, [manager, "start"], { env, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 });
  const record = readJson(join(root, "logs", "proxy.pid"));
  if (record) defer(root, () => killFixtureProxy(root, record.pid));
  const evidence = readJson(trace);
  assert.equal(evidence?.sameFile, true, "the control changes URL spelling, never the imported file");
  assert.notEqual(evidence.original, evidence.shaped);
  assert.equal(result.status, 0, completionEvidence(root, result.stdout + result.stderr));
  const observers = readdirSync(join(root, "logs")).filter((name) => /^completion-observer-\d+\.json$/.test(name));
  assert.equal(observers.length, 1, "one actual manager adapter invocation");
  const observed = readJson(join(root, "logs", observers[0]));
  assert.equal(observed.adapterInvoked, true);
  assert.equal(observed.intent, "ensureRunning");
  assert.equal(observed.intentCode, 0);
  assert.equal(observed.sendCalled, true);
  assert.equal(observed.sendCallback, true, "the real IPC send callback ran before CLI exit");
  assert.equal(observed.sendErrorCode, null);
  const receipt = readJson(join(root, "logs", `completion-receipt-${observed.managerPid}.json`));
  assert.equal(receipt.messages, 1, "the actual wrapper received the generation message");
  assert.equal(receipt.closeCode, 0, "the real CLI closed successfully");
  assert.deepEqual(receipt.generation, observed.identity);
  assert.deepEqual(readJson(join(root, "logs", `fixture-manager-complete-${record.pid}`)), {
    pid: record.pid, startedMs: record.startedMs, ...(record.startTicks === undefined ? {} : { startTicks: record.startTicks }),
  }, "only the actual wrapper publishes after its real manager closes 0");
  assert.equal(receipt.wrapperPid, result.pid, "receipt belongs to the actual spawned wrapper");
  if (process.platform !== "win32") {
    const groups = spawnSync("ps", ["-o", "pid=,pgid=", "-p", [process.pid, record.pid].join(",")], { encoding: "utf8", timeout: 5000 });
    assert.equal(groups.status, 0, groups.stderr);
    t.diagnostic(`owned PID/PGID (runner, proxy): ${groups.stdout.trim().replace(/\s*\n\s*/g, "; ")}`);
  }
  t.diagnostic(`equivalent-parentURL=${JSON.stringify(evidence)}; wrapper=${result.pid} manager=${observed.managerPid} proxy=${record.pid}; adapterInvoked=${observed.adapterInvoked} sendCallback=${observed.sendCallback} sendError=${observed.sendErrorCode} receivedMessages=${receipt.messages} CLIclose=${receipt.closeCode} wrapperExit=${result.status}`);
});

// Failure evidence is limited to owned fixture output and explicitly named
// fixture logs/traces. Never read proxy.pid, config, keys, env or account stores.
// Redaction is shape-based so an arbitrary key spelling cannot leak: ANSI is
// stripped first, then the fixture key itself, any bearer token, a
// proxyApiKey value in any spelling, 64-hex tokens, and 43-char base64url
// stop tokens (ticket 18's shape) are all replaced before the text is capped.
const fixtureOutput = (text) => String(text)
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  .replaceAll(KEY, "<fixture-key-redacted>")
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, "Bearer <fixture-secret-redacted>")
  .replace(/(proxyApiKey["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s"',}]{8,})/gi, "$1<fixture-secret-redacted>")
  .replace(/\b[a-f0-9]{64}\b/gi, "<fixture-token-redacted>")
  .replace(/\b[A-Za-z0-9_-]{43}\b/g, "<fixture-token-redacted>")
  .slice(-8192);
function fixtureTail(file, limit = 6000) {
  let fd;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    const bytes = Buffer.alloc(Math.min(size, limit));
    readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length));
    return fixtureOutput(bytes.toString("utf8"));
  } catch { return "<absent>"; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function completionEvidence(root, output = "") {
  const dir = join(root, "logs");
  const traces = readdirSync(dir).filter((name) => /^completion-(?:resolve|observer|receipt|hookorder)-\d+\.json$/.test(name)).sort().slice(-12);
  return fixtureOutput(output) + "\nfixture proxy.log tail:\n" + fixtureTail(join(dir, "proxy.log")) +
    "\nfixture early-log tail:\n" + fixtureTail(join(dir, "proxy.early.log")) +
    traces.map((name) => `\n${name}: ${fixtureTail(join(dir, name), 2000)}`).join("");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The fixture's stand-in proxies alive now (by command line), or null when the process table cannot be read. */
const standIns = (root) => fixtureProcesses(root)?.filter((p) => /zcode-proxy-src[\\/]+src[\\/]+index\.ts\b.*\bserve\b/.test(p.commandLine)) ?? null;
const countOf = (text, re) => (text.match(re) ?? []).length;

// Instrument only the fixture manager's lifecycle import. The actual CLI entry,
// completion wrapper, stand-in and supervisor are unchanged; stepHook is the
// existing lifecycle seam. No production file is rewritten, even in the copy.
function heldCompletionFixture(t, port, { onExit = "none", windowsTicks = false, missObserver = false, orderProbe = false } = {}) {
  const root = kitFixture(t, port, { proxySrc: true });
  writeFileSync(join(root, "zcode-proxy-src", "src", "index.ts"), SUPERVISED_PROXY);
  const held = join(root, "manager-held.json");
  const release = join(root, "manager-release");
  const exiting = join(root, "manager-exiting.json");
  const exitRelease = join(root, "manager-exit-release");
  const adapter = join(root, "held-lifecycle.mjs");
  const preload = join(root, "hold-manager.mjs");
  writeFileSync(adapter, `
export * from "./lib/proxy-lifecycle.mjs";
import { createLifecycle as realLifecycle } from "./lib/proxy-lifecycle.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const pidFile = ${JSON.stringify(join(root, "logs", "proxy.pid"))};
export function createLifecycle(options) {
  return realLifecycle({ ...options, stepHook(step) {
    if (step !== "spawn:start-recorded") { options.stepHook?.(step); return; }
    let record = JSON.parse(readFileSync(pidFile, "utf8"));
    // Synthetic Windows-shaped identity, NOT a native Windows probe. Keep its
    // decimal string exact, including sub-ms ticks beyond Number precision.
    if (${windowsTicks}) {
      record.startTicks = "639298000000030001";
      writeFileSync(pidFile, JSON.stringify(record), { mode: 0o600 });
    }
    options.stepHook?.(step);
    writeFileSync(${JSON.stringify(held)}, JSON.stringify({ managerPid: process.pid, pid: record.pid, startedMs: record.startedMs, startTicks: record.startTicks }));
    const deadline = Date.now() + 20_000;
    while (!existsSync(${JSON.stringify(release)})) {
      if (Date.now() > deadline) throw new Error("held start was not released");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    if (readFileSync(${JSON.stringify(release)}, "utf8") === "fail") throw new Error("synthetic held manager failure");
  } });
}
`);
  writeFileSync(preload, `
import { registerHooks } from "node:module";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
${orderProbe ? `
// Passive order probe, registered BEFORE the observer (this --import comes
// first in the spawn argv). Synchronous registerHooks chains LIFO, so the
// observer registered later runs first: when it short-circuits the manager's
// lifecycle import, this probe never sees it. Records only spec strings.
const seenSpecs = [];
let lifecycleSeen = false;
registerHooks({ resolve(spec, context, next) {
  if (spec === "../lib/proxy-lifecycle.mjs") lifecycleSeen = true;
  if (seenSpecs.length < 64) seenSpecs.push(String(spec));
  return next(spec, context);
} });
process.on("exit", () => writeFileSync(${JSON.stringify(join(root, "logs"))} + "/completion-hookorder-" + process.pid + ".json", JSON.stringify({ lifecycleSeen, specs: seenSpecs })));
` : ""}
const exit = process.exit;
process.exit = (code) => {
  if (Number(code) === 0) {
    writeFileSync(${JSON.stringify(exiting)}, JSON.stringify({ managerPid: process.pid, code: Number(code) }));
    const deadline = Date.now() + 20_000;
    while (!existsSync(${JSON.stringify(exitRelease)})) {
      if (Date.now() > deadline) throw new Error("held manager exit was not released");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    const file = ${JSON.stringify(join(root, "logs", "proxy.pid"))};
    // Explicit fault injection after the real successful intent. These are
    // robustness controls, not concurrent writers observed in historical CI.
    if (${JSON.stringify(onExit)} === "missing") rmSync(file);
    if (${JSON.stringify(onExit)} === "invalid") writeFileSync(file, "not-json");
    if (["replacement", "ticks-missing", "ticks-changed"].includes(${JSON.stringify(onExit)})) {
      const record = JSON.parse(readFileSync(file, "utf8"));
      if (${JSON.stringify(onExit)} === "replacement") { record.pid = ${NEVER_ALLOCATED_PID}; record.startedMs++; }
      if (${JSON.stringify(onExit)} === "ticks-missing") delete record.startTicks;
      if (${JSON.stringify(onExit)} === "ticks-changed") record.startTicks = "639298000000030002";
      writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
    }
  }
  exit(code);
};
`);
  const entry = completionManager(root, { managerNodeArgs: ["--import", pathToFileURL(preload).href], lifecycleModule: pathToFileURL(adapter).href });
  // Diagnostic negative control only: omit the generated observation hook
  // before spawn, leaving the SAME wrapper, real CLI and stand-in untouched.
  if (missObserver) writeFileSync(join(root, "completion-observer.mjs"), "// Deliberately missing fixture observer.\n");
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail(), FAKE_PRESSURE_MB: "0", FAKE_COMPLETION_MANAGER: entry });
  const child = spawn(process.execPath, [entry, "start"], { env, stdio: ["ignore", "pipe", "pipe"] });
  defer(root, () => killChild(child));
  let output = "";
  child.stdout.on("data", (d) => { output = (output + d).slice(-8192); });
  child.stderr.on("data", (d) => { output = (output + d).slice(-8192); });
  let closed;
  const exited = new Promise((r) => child.once("close", (code) => { closed = code; r(code); }));
  // Cleanup releases both handshakes even when an assertion fails. The wrapper
  // owns its real manager child; fixture teardown waits for both and the proxy.
  defer(root, async () => {
    writeFileSync(release, "release"); writeFileSync(exitRelease, "release");
    await exited;
  });
  return { t, root, child, env, held, release, exiting, exitRelease, exited, closed: () => closed, output: () => fixtureOutput(output) };
}

async function heldProxy(f) {
  let held;
  try {
    held = await until("the actual wrapper's manager held at spawn:start-recorded", () => {
      const record = readJson(f.held);
      if (record) return record;
      if (f.closed() !== undefined) assert.fail(`actual wrapper closed early: code=${f.closed()} signal=${f.child.signalCode}`);
      return null;
    }, 20_000);
  } catch (err) {
    err.message += "\n" + completionEvidence(f.root, f.output());
    throw err;
  }
  assert.ok(Number.isInteger(held.managerPid) && held.managerPid !== f.child.pid, "the wrapper spawned the held real manager child");
  defer(f.root, () => killFixtureProxy(f.root, held.pid));
  if (process.platform !== "win32") {
    const groups = spawnSync("ps", ["-o", "pid=,pgid=", "-p", [f.child.pid, held.managerPid, held.pid].join(",")], { encoding: "utf8", timeout: 5000 });
    assert.equal(groups.status, 0, groups.stderr);
    f.t.diagnostic(`owned PID/PGID (wrapper, manager, proxy): ${groups.stdout.trim().replace(/\\s*\\n\\s*/g, "; ")}`);
  } else f.t.diagnostic(`owned child handles: wrapper=${f.child.pid}, manager=${held.managerPid}, proxy=${held.pid}; Windows has no POSIX PGID`);
  return { ...held, marker: join(f.root, "logs", `fixture-manager-complete-${held.pid}`) };
}
async function pressureDetails(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(1500) });
    return (await res.json()).details ?? null;
  } catch { return null; }
}
const pressureState = async (port) => (await pressureDetails(port))?.pressureState ?? null;
const pressurePoll = async (port) => (await pressureDetails(port))?.readinessPolls ?? -1;
const fixtureLog = (root) => { try { return readFileSync(join(root, "logs", "proxy.log"), "utf8"); } catch { return ""; } };

test("a missed completion observer reports bounded fixture evidence on actual wrapper early exit", { timeout: 60_000 }, async (t) => {
  const f = heldCompletionFixture(t, await freePort(), { missObserver: true });
  // Both handshakes are pre-written so the emptied-observer case ends
  // deterministically at the wrapper's early-close guard: the hold preload's
  // patched process.exit waits for its exit release, and without the
  // pre-release the manager holds inside that patched exit (up to 20 s) while
  // the stand-in's own 10 s completion wait fails first — an observed
  // instability of the first attempt of this negative, kept reproducible only
  // by this pre-release. No mechanism claim beyond that composition
  // dependency; the early close itself is the wrapper's compound guard.
  writeFileSync(f.release, "release");
  writeFileSync(f.exitRelease, "release");
  await assert.rejects(() => heldProxy(f), (err) => {
    assert.match(err.message, /actual wrapper closed early: code=1/);
    assert.match(err.message, /completed manager left no started proxy generation/);
    assert.match(err.message, /"messages":0,"generationPresent":false/);
    assert.match(err.message, /completion-receipt-\d+\.json/);
    assert.match(err.message, /fixture proxy\.log tail:/);
    assert.doesNotMatch(err.message, new RegExp(KEY));
    assert.ok(err.message.length < 48_000, "failure evidence stays bounded");
    t.diagnostic(`missing-observer early-exit evidence: ${err.message}`);
    return true;
  });
  writeFileSync(f.exitRelease, "release");
  assert.equal(await f.exited, 1);
  const record = readJson(join(f.root, "logs", "proxy.pid"));
  defer(f.root, () => killFixtureProxy(f.root, record.pid));
  assert.equal(existsSync(join(f.root, "logs", `fixture-manager-complete-${record.pid}`)), false);
  writeFileSync(join(f.root, "logs", "proxy.early.log"), KEY + " " + "a".repeat(64) + " " + "x".repeat(12_000));
  assert.doesNotMatch(completionEvidence(f.root, KEY), new RegExp(KEY));
  assert.ok(fixtureTail(join(f.root, "logs", "proxy.early.log")).length <= 6000);
});

// ADR-0015 identity, fixture-only comparison helpers (production files and
// the identity policy untouched). A respawn event belongs to a serving
// generation only when it names the generation's pid AND was reserved after
// that generation started — the same pid + `at > requestTime` shape the proxy
// applies to its own acknowledgement
// (zcode-proxy-src/src/runtime/watchdog.ts isRespawnAcknowledgement). An older
// generation's event under legitimate PID reuse (its reservation precedes the
// reused pid's new start) never matches; there is no time window that could
// excuse a real stale server. Events carry no start identity of their own, so
// the event rule binds on startedMs; a record without a usable start identity
// cannot be bound to a generation and keeps the pid-only comparison there
// (never weaker than before). A record's full start identity (ticket 77) is
// pid + startedMs + the exact startTicks compared as strings when present.
const servesGeneration = (event, record) =>
  event?.pid === record?.pid && (!Number.isFinite(record?.startedMs) || event.at > record.startedMs);
const sameGeneration = (a, b) =>
  !!a && !!b && a.pid === b.pid && (a.startedMs ?? null) === (b.startedMs ?? null) && (a.startTicks ?? null) === (b.startTicks ?? null);

// ADR-0015 identity, portable counterexample over the REAL requestRespawn and
// readState seams with a synthetic permitted history: an older generation had
// the same pid, was acknowledged, exited, and the OS reused the pid for the
// serving generation — every reservation precedes the current start. The
// pid-only comparison flags the refused generation as replaced (the old
// assertion false-alarms here); the pid + start comparison keeps it. A
// test-assumption repair only: NOT an explanation of any historical Windows
// CI failure (runs 42828829522 / 42870123342 stay unattributed).
test("a legitimately reused pid does not make the refused generation look replaced (ADR-0015 identity)", { timeout: 60_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port);
  await identityServer(t, port, "ours");
  const now = Date.now();
  const currentStart = now - 1000;
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: process.pid, startedMs: currentStart, startedIso: new Date(currentStart).toISOString() }) + "\n");
  const history = { events: [
    { at: now - 5000, pid: process.pid, reason: "memory" },
    { at: now - 4000, pid: NEVER_ALLOCATED_PID, reason: "memory" },
    { at: now - 3000, pid: NEVER_ALLOCATED_PID + 1, reason: "memory" },
  ] };
  writeFileSync(join(root, "logs", "respawn.json"), JSON.stringify(history) + "\n");
  const lifecycle = await lifecycleFor(root);
  const refused = await lifecycle.requestRespawn(process.pid, "memory");
  assert.equal(refused.code, 4, refused.lines.join("\n"));
  assert.equal(refused.outcome, "refused", "the exhausted budget refuses through the real seam");
  assert.deepEqual(readJson(join(root, "logs", "respawn.json")), history, "a refusal records no event");
  const state = await lifecycle.readState();
  assert.equal(state.identity, "ours", "the reused pid still serves as ours");
  assert.equal(state.pidRecord.pid, process.pid);
  assert.equal(state.pidRecord.startedMs, currentStart);
  const events = history.events;
  // The old assertion's false alarm, made explicit: pid-only matching flags
  // the legitimate reuse; the repaired comparison does not.
  assert.ok(events.some((e) => e.pid === state.pidRecord.pid), "premise (the old pid-only assertion false-alarms here): a historical event shares the reused pid");
  assert.ok(events.every((e) => e.at < state.pidRecord.startedMs), "premise: every reservation predates the serving generation (legitimate reuse, ADR-0015 cond 4's unmatchable shape)");
  assert.ok(!events.some((e) => servesGeneration(e, state.pidRecord)), "the repaired comparison keeps the refused generation serving under legitimate pid reuse");
  // Teeth: an acknowledged event of the serving generation itself, a different
  // generation at the same pid, and a different tick identity must all fail.
  assert.ok(servesGeneration({ pid: state.pidRecord.pid, at: state.pidRecord.startedMs + 5000, reason: "memory" }, state.pidRecord), "an acknowledged event of the serving generation is caught (same pid, reserved after its start)");
  assert.ok(!sameGeneration(state.pidRecord, { ...state.pidRecord, startedMs: state.pidRecord.startedMs + 1 }), "a different generation at the same pid is caught by the start identity");
  assert.ok(!sameGeneration(state.pidRecord, { ...state.pidRecord, startTicks: "639298000000030002" }), "a different tick identity is caught when ticks are present");
});

// Synthetic 8.3-shaped parentURL counterexample (RUNNER%7E1-style). A real
// directory alias named RUNNER~1 (a symlink to the fixture's proxy dir) makes
// the alias a valid spelling of the SAME manager file here — on Windows the
// filesystem itself resolves the short name, and the CI wrapper URLs spell it
// exactly like this (file:///C:/Users/RUNNER%7E1/...). The shaped URL also
// percent-encodes the manager filename, so it neither ends with the manager
// suffix nor equals the manager URL: with the widened trace EVERY spelling
// leaves evidence, and the canonicalized comparator matches the same file.
// Synthetic alias, NOT native Windows evidence.
test("an 8.3-shaped alias spelling of the manager parent leaves a resolve trace and still matches (synthetic)", { timeout: 60_000 }, async (t) => {
  const root = kitFixture(t, await freePort(), { proxySrc: true });
  try {
    symlinkSync(join(root, "proxy"), join(root, "RUNNER~1"), "dir");
  } catch (err) {
    t.skip(`this environment cannot create the RUNNER~1 directory alias (${err.code ?? err.message}); Windows resolves 8.3 short names itself, Linux needs this alias to synthesize the shape`);
    return;
  }
  const control = join(root, "parent-url-control.mjs");
  const trace = join(root, "parent-url-control.json");
  writeFileSync(control, `
import { registerHooks } from "node:module";
import { realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
registerHooks({ resolve(spec, context, next) {
  if (spec === "../lib/proxy-lifecycle.mjs" && context.parentURL?.endsWith("/proxy/zcode-proxy-manager.mjs")) {
    const shaped = context.parentURL.replace("/proxy/zcode-proxy-manager.mjs", "/RUNNER%7E1/%7Acode-proxy-manager.mjs");
    writeFileSync(${JSON.stringify(trace)}, JSON.stringify({ original: context.parentURL, shaped, sameFile: realpathSync.native(fileURLToPath(shaped)) === realpathSync.native(fileURLToPath(context.parentURL)) }));
    return next(spec, { ...context, parentURL: shaped });
  }
  return next(spec, context);
} });
`);
  const manager = completionManager(root, { managerAfterObserverArgs: ["--import", pathToFileURL(control).href] });
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail() });
  const result = spawnSync(process.execPath, [manager, "start"], { env, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 });
  const record = readJson(join(root, "logs", "proxy.pid"));
  if (record) defer(root, () => killFixtureProxy(root, record.pid));
  const evidence = readJson(trace);
  assert.notEqual(evidence.original, evidence.shaped);
  assert.match(evidence.shaped, /\/RUNNER%7E1\/%7Acode-proxy-manager\.mjs$/, "the shaped spelling is 8.3-style and matches neither the suffix nor the manager URL");
  assert.equal(evidence.sameFile, true, "the alias names the same manager file (fileURLToPath + native realpath)");
  assert.equal(result.status, 0, completionEvidence(root, result.stdout + result.stderr));
  const observers = readdirSync(join(root, "logs")).filter((name) => /^completion-observer-\d+\.json$/.test(name));
  assert.equal(observers.length, 1, "one actual manager adapter invocation");
  const observed = readJson(join(root, "logs", observers[0]));
  const resolveTrace = readJson(join(root, "logs", `completion-resolve-${observed.managerPid}.json`));
  assert.equal(resolveTrace.parentURL, evidence.shaped, "the trace records the raw shaped parentURL as received");
  assert.equal(resolveTrace.matched, true, "the canonicalized comparator matches the alias spelling");
  assert.equal(resolveTrace.canonicalParent, resolveTrace.canonicalManager, "both resolved spellings agree");
  assert.ok(Number.isInteger(resolveTrace.hookOrdinal) && resolveTrace.hookOrdinal >= 1, "the trace carries the hook order the observer saw");
  const receipt = readJson(join(root, "logs", `completion-receipt-${observed.managerPid}.json`));
  assert.equal(receipt.messages, 1, "the actual wrapper received the generation message");
  assert.equal(receipt.closeCode, 0, "the real CLI closed successfully");
  t.diagnostic(`alias-parentURL=${JSON.stringify(evidence)}; matched=${resolveTrace.matched} hookOrdinal=${resolveTrace.hookOrdinal} messages=${receipt.messages}`);
});

// Hook-composition control for the held fixtures: the hold preload's --import
// is registered BEFORE the observer's (spawn argv order), and synchronous
// registerHooks chains LIFO — the observer registered later runs first. The
// passive probe inside the hold preload records what its earlier-registered,
// later-run position still sees. Linux control, not native Windows evidence.
test("the held fixture's hook composition keeps the observer resolving and the hold engaging (LIFO order)", { timeout: 60_000 }, async (t) => {
  const port = await freePort();
  const f = heldCompletionFixture(t, port, { orderProbe: true });
  const held = await heldProxy(f);
  // The observer resolved: the manager is held at spawn:start-recorded through
  // the redirected held adapter, and its resolve trace names the match.
  const resolveTrace = await until("the observer's resolve trace", () => readJson(join(f.root, "logs", `completion-resolve-${held.managerPid}.json`)), 5000);
  assert.equal(resolveTrace.matched, true, "the observer's redirect matched the manager's lifecycle import");
  assert.equal(resolveTrace.canonicalParent, resolveTrace.canonicalManager);
  assert.ok(Number.isInteger(resolveTrace.hookOrdinal) && resolveTrace.hookOrdinal >= 1);
  writeFileSync(f.release, "release");
  await until("the real CLI has returned success but not exited", () => readJson(f.exiting), 10_000);
  writeFileSync(f.exitRelease, "release");
  assert.equal(await f.exited, 0, completionEvidence(f.root, f.output()));
  assert.deepEqual(readJson(held.marker), { pid: held.pid, startedMs: held.startedMs, ...(held.startTicks === undefined ? {} : { startTicks: held.startTicks }) }, "the hold still engages and the actual wrapper publishes after real exit 0");
  const order = readJson(join(f.root, "logs", `completion-hookorder-${held.managerPid}.json`));
  // LIFO measured, not assumed: the probe registered before the observer (and
  // running after it) saw the process's ordinary imports but never the
  // short-circuited lifecycle import.
  assert.equal(order.lifecycleSeen, false, "the probe registered before the observer never sees the short-circuited lifecycle import");
  assert.ok(order.specs.length > 0, "the probe still resolves the process's other imports (the chain runs)");
  t.diagnostic(`hook-order: matched=${resolveTrace.matched} hookOrdinal=${resolveTrace.hookOrdinal}; probe specs=${order.specs.length} lifecycleSeen=${order.lifecycleSeen}`);
});

// This is the SAME wrapper and stand-in as the induced-pressure test below.
// Only the actual wrapper publishes a successful completion; this test writes
// no successful marker. Zero sampled footprint keeps the proof independent of
// the later budget/three-event test, whose pressure stays 4096 MB.
for (const windowsTicks of [false, true]) {
  test(`the actual completion wrapper waits for real manager exit before arming pressure (${windowsTicks ? "Windows-shaped exact ticks" : "native identity"})`, { timeout: 60_000 }, async (t) => {
    const port = await freePort();
    const f = heldCompletionFixture(t, port, { windowsTicks });
    const held = await heldProxy(f);
    assert.equal(await until("the stand-in's startup decision", async () => {
      const s = await pressureState(port); return s && s !== "starting" ? s : null;
    }, 10_000), "waiting-manager");
    assert.equal(f.child.exitCode, null, "the wrapper is still awaiting its real manager");
    assert.equal(existsSync(held.marker), false, "no completion while the real manager is held");
    // Invalid/stale markers are negative input only. The test never writes a
    // current successful marker; the wrapper must replace these after exit.
    const negatives = ["not-json", JSON.stringify({ pid: held.pid, startedMs: held.startedMs - 1 }),
      ...(windowsTicks ? [JSON.stringify({ pid: held.pid, startedMs: held.startedMs }), JSON.stringify({ pid: held.pid, startedMs: held.startedMs, startTicks: "639298000000030002" })] : [])];
    for (const marker of negatives) {
      writeFileSync(held.marker, marker, { mode: 0o600 });
      // An HTTP response after a readiness poll observes the same event loop;
      // wait for two health answers separated by an observed poll (below).
      const initial = await pressurePoll(port);
      await until("a readiness poll with invalid/stale completion", async () => (await pressurePoll(port)) > initial, 3000);
      assert.equal(await pressureState(port), "waiting-manager", "invalid, stale or inexact identity never arms pressure");
    }
    writeFileSync(f.release, "release");
    await until("the real CLI has returned success but not exited", () => readJson(f.exiting), 10_000);
    assert.equal(f.child.exitCode, null);
    assert.notDeepEqual(readJson(held.marker), { pid: held.pid, startedMs: held.startedMs, ...(held.startTicks === undefined ? {} : { startTicks: held.startTicks }) });
    assert.equal(await pressureState(port), "waiting-manager", "a successful intent is not a successful process exit");
    assert.equal((await pressureDetails(port)).samplesTaken, 0, "no supervisor sample before real manager exit");
    writeFileSync(f.exitRelease, "release");
    // completionEvidence, not the raw output alone: a native hold that passes
    // the early-close check and then fails the marker keeps the resolve,
    // observer, receipt (and hook-order) tails attached to this failure.
    assert.equal(await f.exited, 0, completionEvidence(f.root, f.output()));
    assert.deepEqual(readJson(held.marker), { pid: held.pid, startedMs: held.startedMs, ...(held.startTicks === undefined ? {} : { startTicks: held.startTicks }) }, "the actual wrapper publishes this exact generation after real exit 0");
    await until("the actual wrapper's marker arms the supervisor and sampling starts", async () => {
      const details = await pressureDetails(port);
      return details?.pressureState === "running" && details.samplesTaken > 0;
    }, 10_000);
    assert.doesNotMatch(fixtureLog(f.root), /respawn: requested|stand-in drained/);
    t.diagnostic(`wrapper=${f.child.pid} manager=${held.managerPid} proxy=${held.pid}; actual-wrapper success; ticks=${held.startTicks ?? "absent"}`);
  });
}

for (const fault of ["failed-manager", "missing", "invalid", "replacement", "ticks-missing", "ticks-changed"]) {
  test(`the actual completion wrapper fails closed with a finite stand-in error (${fault})`, { timeout: 60_000 }, async (t) => {
    const port = await freePort();
    const f = heldCompletionFixture(t, port, { onExit: fault, windowsTicks: fault.startsWith("ticks-") });
    const held = await heldProxy(f);
    assert.equal(await until("the stand-in waiting without completion", async () => {
      const s = await pressureState(port); return s && s !== "starting" ? s : null;
    }, 10_000), "waiting-manager");
    const started = Date.now();
    writeFileSync(f.release, fault === "failed-manager" ? "fail" : "release");
    if (fault !== "failed-manager") {
      await until("the real manager's exit boundary", () => readJson(f.exiting), 10_000);
      writeFileSync(f.exitRelease, "release");
    }
    const code = await f.exited;
    // Even record fault injection must not be reported as successful startup.
    assert.equal(code, 1, `invalid completion must be an honest wrapper failure; output: ${f.output()}`);
    assert.equal(existsSync(held.marker), false, "a failed completion publishes no success for the proxy");
    assert.equal(existsSync(join(f.root, "logs", `fixture-manager-complete-${NEVER_ALLOCATED_PID}`)), false, "never acknowledge a replacement record");
    await until("the stand-in's finite missing-completion failure", () => fixtureLog(f.root).includes("fixture start manager did not complete within 10000ms"), 15_000);
    await until("the failed stand-in to exit", () => standIns(f.root)?.length === 0, 5000);
    assert.doesNotMatch(fixtureLog(f.root), /respawn: requested|stand-in drained/);
    assert.equal(await identity(port), "down");
    assert.ok(Date.now() - started < 20_000, "missing completion fails finitely rather than starting pressure");
    t.diagnostic(`fault=${fault} wrapperExit=${code}; stand-in=10000ms error; no pressure/hook/success marker`);
  });
}

test("induced memory pressure: acknowledged respawns drain, the budget caps them at 3, the refused one keeps its proxy serving with one ERROR and no further hook", { timeout: 240_000 }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port, { proxySrc: true });
  writeFileSync(join(root, "zcode-proxy-src", "src", "index.ts"), SUPERVISED_PROXY);
  const manager = completionManager(root);
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail(), FAKE_PRESSURE_MB: "4096", FAKE_COMPLETION_MANAGER: manager });
  const logFile = join(root, "logs", "proxy.log");
  const log = () => { try { return readFileSync(logFile, "utf8"); } catch { return ""; } };
  const seen = new Set();
  const remember = () => { const r = readJson(join(root, "logs", "proxy.pid")); if (Number.isInteger(r?.pid) && !seen.has(r.pid)) { seen.add(r.pid); defer(root, () => killFixtureProxy(root, r.pid)); } };
  const start = spawnSync(process.execPath, [manager, "start"], { env, encoding: "utf8", timeout: 90_000 });
  remember();
  assert.equal(start.status, 0, completionEvidence(root, start.stdout + start.stderr));

  // Sample until the refusal is logged: never two proxies at once.
  const refused = / ERROR supervisor respawn refused by the kit manager; keeps serving /;
  const counts = [];
  const deadline = Date.now() + 180_000;
  while (!refused.test(log())) {
    if (Date.now() > deadline) assert.fail(`no refusal logged; ${completionEvidence(root)}`);
    remember();
    const list = standIns(root);
    if (list) counts.push(list.length);
    await sleep(100);
  }
  remember();
  // The record the moment the refusal is first seen: the refused generation's
  // own start identity, compared against the final record below (ADR-0015
  // identity, fixture-only; production untouched).
  const refusedRecord = readJson(join(root, "logs", "proxy.pid"));
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
  assert.equal(events.length, 3, `three restarts reserved in the window, never more; proxy.log tail:\n${text.slice(-6000)}`);
  assert.equal(countOf(text, /stand-in drained/g), 3, "each acknowledged respawn drained its proxy");
  assert.equal(hooksAtRefusal, 4, "three acknowledged requests and the refused one");
  assert.equal(countOf(text, /respawn: requested for pid \d+ \(reason memory\)/g), 4, "no further hook within the budget window");
  assert.equal(countOf(text, / ERROR supervisor /g), 1, "one ERROR line");
  assert.match(text, / ERROR supervisor respawn refused by the kit manager; keeps serving .*outcome=refused .*hookExit=4 restarts=exhausted retryInS=900\n/);
  assert.equal(countOf(text, /respawn refused: 3 restarts in 15 min/g), 1);
  assert.ok(sameGeneration(record, refusedRecord), `the record still names the generation that was refused (pid + start identity, exact ticks when present: no replacement or stale generation took over; refusal=${JSON.stringify(refusedRecord)} final=${JSON.stringify(record)})`);
  assert.ok(!events.some((e) => servesGeneration(e, record)), "the serving proxy is the one whose request was refused: no acknowledged respawn event belongs to its generation (same pid, reserved after its start; an older generation's pid reuse never matches)");
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
  const manager = completionManager(root);
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail(), FAKE_PRESSURE_MB: "4096", FAKE_COMPLETION_MANAGER: manager, FAKE_ACK_WAIT_MS: "1500", FAKE_LATE_MANAGER: late, FAKE_LATE_MS: "3000", FAKE_LATE_OUT: lateOut });
  const start = spawnSync(process.execPath, [manager, "start"], { env, encoding: "utf8", timeout: 90_000 });
  const record = readJson(join(root, "logs", "proxy.pid"));
  if (record) defer(root, () => killFixtureProxy(root, record.pid));
  assert.equal(start.status, 0, completionEvidence(root, start.stdout + start.stderr));

  // The late manager waits 30 s for the proxy to exit, which it never does.
  const counts = [];
  const deadline = Date.now() + 120_000;
  while (!existsSync(lateOut)) {
    if (Date.now() > deadline) assert.fail(`the late manager did not finish; ${completionEvidence(root)}`);
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
  // STOP_EXIT_MARGIN_MS (ticket 22) lives in the shared module; the margin is
  // the same one the manager's stop force point adds after STOP_GRACE_MS.
  const { STOP_EXIT_MARGIN_MS } = await stopDeadlines();
  assert.ok(RESPAWN_WAIT_MS > proxy.ack + proxy.deadline + STOP_EXIT_MARGIN_MS);
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

// -------------------------------- graceful stop request (ticket 22, ADR-0014)
// The manager asks its own proxy to stop gracefully with `POST /__kit/stop`
// (bearer key + per-spawn stop token, the one from proxy.pid) after the
// identity proof, then waits past the proxy's own deadline (STOP_GRACE_MS)
// plus STOP_EXIT_MARGIN_MS before it forces. The force paths (hung-own
// recovery, the explicit force helper, the startup timeout) never send the
// request. Tokens are generated fixtures and are compared, never printed (B2).

const stopDeadlines = () => import(pathToFileURL(join(ROOT, "lib", "stop-deadlines.mjs")).href);
const PROXY_STOP_DEADLINES_URL = pathToFileURL(join(ROOT, "zcode-proxy-src", "src", "runtime", "stop-deadlines.mjs")).href;

/** One stand-in's recorded stop requests: a JSON line per POST /__kit/stop. */
const readStopRequests = (file) => existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

/**
 * A stand-in for the proxy (seam 2): answers the identity proof, records every
 * stop request (method, URL, bearer, token header) in its own JSONL file, and
 * answers POST /__kit/stop per `STOP_STANDIN_STOP`: a fixed status
 * ("202"/"404"/"401"/"403"), "destroy" (a connection error), or
 * "202-exit-<ms>" (accepted; the process exits after that many milliseconds,
 * the way a draining proxy does, without any signal). Its dummy argv element
 * names the fixture, so teardown sees it.
 */
const STOP_STANDIN = `
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const port = Number(process.env.STOP_STANDIN_PORT);
const key = process.env.STOP_STANDIN_KEY;
const behavior = process.env.STOP_STANDIN_STOP;
const record = process.env.STOP_STANDIN_RECORD;
createServer((req, res) => {
  if (req.headers.authorization !== "Bearer " + key) return res.writeHead(401).end("{}");
  if (req.url === "/health") return res.end(JSON.stringify({ status: "ok", provider: "zai" }));
  if (req.url === "/__kit/stop" && req.method === "POST") {
    appendFileSync(record, JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization, token: req.headers["x-zcode-stop-token"] ?? null }) + "\\n");
    if (behavior === "destroy") { res.destroy(); return; }
    const exit = /^202-exit-(\\d+)$/.exec(behavior ?? "");
    if (exit) {
      res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true }));
      setTimeout(() => { appendFileSync(record + ".natural", "exited naturally\\n"); process.exit(0); }, Number(exit[1]));
      return;
    }
    return res.writeHead(Number(behavior || 404), { "content-type": "application/json" }).end("{}");
  }
  res.writeHead(404).end("{}");
}).listen(port, "127.0.0.1", () => process.stdout.write("up\\n"));
`;

/** The hung variant: /health destroys the socket (no answer), /__kit/stop still records. */
const STOP_STANDIN_HUNG = `
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";
const port = Number(process.env.STOP_STANDIN_PORT);
const key = process.env.STOP_STANDIN_KEY;
const record = process.env.STOP_STANDIN_RECORD;
createServer((req, res) => {
  if (req.headers.authorization !== "Bearer " + key) return res.writeHead(401).end("{}");
  if (req.url === "/health") { res.destroy(); return; }
  if (req.url === "/__kit/stop" && req.method === "POST") {
    appendFileSync(record, JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization, token: req.headers["x-zcode-stop-token"] ?? null }) + "\\n");
    return res.writeHead(202).end("{}");
  }
  res.writeHead(404).end("{}");
}).listen(port, "127.0.0.1", () => process.stdout.write("up\\n"));
`;

/** Spawn one stop-request stand-in for `root`'s fixture; killed with the fixture. */
function spawnStopStandIn(t, root, port, behavior, record, hung = false) {
  const stand = spawn(process.execPath, ["-e", hung ? STOP_STANDIN_HUNG : STOP_STANDIN, join(root, "stand-in")], {
    env: { ...process.env, STOP_STANDIN_PORT: String(port), STOP_STANDIN_KEY: KEY, STOP_STANDIN_STOP: behavior, STOP_STANDIN_RECORD: record },
    stdio: ["ignore", "pipe", "ignore"],
  });
  defer(root, () => killChild(stand));
  return new Promise((resolveStand) => stand.stdout.once("data", () => resolveStand(stand)));
}

// Portable seam-2 controls: the real stop/lock/identity/deadline logic with
// Windows-shaped OS boundaries. These do NOT prove native TerminateProcess.
async function portableStop(t, { answer = 202, exitsAt = Infinity, reuseAt = Infinity, unknownAt = Infinity, noToken = false, down = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "portable-stop-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ["proxy", "logs", "home"]) mkdirSync(join(root, dir));
  writeFileSync(join(root, "proxy", "config.yaml"), `server:\n  port: ${await freePort()}\n`);
  writeFileSync(join(root, ".proxykey"), KEY);
  const pid = 2147483644; // never a real process; all OS boundaries injected
  const ticks = "638800000000000001";
  const start = { ms: 1744403200000, ticks };
  const record = { pid, startedMs: start.ms, startTicks: ticks, ...(noToken ? {} : { stopToken: "synthetic-stop-token" }) };
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify(record));
  let now = 0, alive = true;
  const trace = [], sleeps = [];
  const { createLifecycle } = await import(pathToFileURL(join(ROOT, "lib", "proxy-lifecycle.mjs")).href);
  const lifecycle = createLifecycle({
    root, home: join(root, "home"),
    clock: { now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; } },
    processAdapter: {
      platform: "win32",
      alive: p => { assert.equal(p, pid); return alive && now < exitsAt; },
      identity: p => {
        assert.equal(p, pid);
        if (now >= unknownAt) return null;
        // Exactly one 100 ns tick apart, deliberately identical milliseconds.
        return { ms: start.ms, ticks: now >= reuseAt ? "638800000000000002" : ticks };
      },
      terminate: (p, expectedTicks) => {
        assert.equal(p, pid);
        trace.push({ kind: "terminate", at: now, ticks: expectedTicks });
        assert.equal(expectedTicks, ticks);
        alive = false;
        return 0;
      },
    },
    processCommandLineImpl: () => ({ commandLine: `bun ${join(root, "zcode-proxy-src", "src", "index.ts")} serve`, executablePath: "bun" }),
    startupGraceMs: 0, hungProbeCount: 1,
    fetchImpl: async (url, options) => {
      trace.push({ kind: new URL(url).pathname, at: now });
      if (url.endsWith("/health")) {
        if (down) throw new Error("synthetic connection failure");
        return new Response(JSON.stringify({ status: "ok", provider: "zai" }));
      }
      assert.equal(new URL(url).pathname, "/__kit/stop");
      assert.equal(options.method, "POST");
      assert.ok(options.headers.Authorization === `Bearer ${KEY}`);
      assert.ok(options.headers["x-zcode-stop-token"] === "synthetic-stop-token");
      if (answer === "error") throw new Error("synthetic connection failure");
      return new Response(null, { status: answer });
    },
  });
  return { lifecycle, trace, sleeps, start, pid, root, now: () => now };
}

test("portable Windows stop: exits after proxy grace but before manager margin without force", async t => {
  const p = await portableStop(t, { exitsAt: 10500 });
  const result = await p.lifecycle.stop();
  assert.deepEqual([result.code, result.outcome], [0, "stopped"]);
  assert.deepEqual(p.trace, [{ kind: "/health", at: 0 }, { kind: "/health", at: 0 }, { kind: "/__kit/stop", at: 0 }]);
  assert.equal(p.now(), 10500);
  assert.equal(existsSync(join(p.root, "logs", "proxy.pid")), false);
});

test("portable Windows stop: real stop waits exactly through grace and margin before guarded force", async t => {
  const p = await portableStop(t);
  assert.equal((await p.lifecycle.stop()).code, 0);
  assert.deepEqual(p.trace, [{ kind: "/health", at: 0 }, { kind: "/health", at: 0 }, { kind: "/__kit/stop", at: 0 }, { kind: "terminate", at: 12000, ticks: "638800000000000001" }]);
  assert.ok(p.sleeps.every(ms => ms === 300));
});

test("portable Windows stop: a one-tick PID replacement during grace is gone, never terminated", async t => {
  const p = await portableStop(t, { reuseAt: 12000 });
  assert.equal((await p.lifecycle.stop()).code, 0);
  assert.equal(p.trace.filter(e => e.kind === "terminate").length, 0);
  assert.equal(p.now(), 12000);
});

test("portable Windows stop: unknown identity at escalation fails closed with exit 2", async t => {
  const p = await portableStop(t, { unknownAt: 12000 });
  const result = await p.lifecycle.stop();
  assert.deepEqual([result.code, result.outcome], [2, "kill-failed"]);
  assert.equal(p.trace.filter(e => e.kind === "terminate").length, 0);
  assert.equal(existsSync(join(p.root, "logs", "proxy.pid")), true);
});

test("portable Windows stop: refused/error/legacy requests fall back immediately after identity", async t => {
  for (const answer of [404, 401, 403, "error", "no-token"]) {
    const p = await portableStop(t, { answer: answer === "no-token" ? 404 : answer, noToken: answer === "no-token" });
    assert.equal((await p.lifecycle.stop()).code, 0);
    assert.deepEqual(p.trace.map(e => e.kind), answer === "no-token" ? ["/health", "/health", "terminate"] : ["/health", "/health", "/__kit/stop", "terminate"]);
    assert.equal(p.trace.at(-1).at, 0);
  }
});

test("portable Windows stop: hung recovery and explicit force never issue a stop request", async t => {
  const hung = await portableStop(t, { down: true });
  assert.deepEqual([(await hung.lifecycle.stop()).outcome, hung.trace.map(e => e.kind)], ["stopped-hung", ["/health", "/health", "terminate"]]);
  const forced = await portableStop(t);
  assert.equal(await forced.lifecycle.forceStop(forced.pid, { recordedStart: forced.start }), true);
  assert.deepEqual(forced.trace, [{ kind: "terminate", at: 0, ticks: "638800000000000001" }]);
});

const POSIX_STOP_STANDIN_SKIP = process.platform === "win32" && "the fallback signal and the stand-in's exit shape are asserted; Windows stops through the handle-checked TerminateProcess (the request path itself is platform-independent)";

test("one shared module holds the stop deadlines and the request shape; the manager forces only after grace + margin, and the copies are byte-identical", async () => {
  const { STOP_GRACE_MS, STOP_EXIT_MARGIN_MS, STOP_REQUEST_PATH, STOP_TOKEN_HEADER } = await stopDeadlines();
  // ADR-0014 cond 4: STOP_GRACE_MS is the proxy's own hard deadline.
  assert.equal(STOP_GRACE_MS, 10_000);
  // "a named margin of at least a few 300 ms poll intervals (for example 2 s)".
  assert.ok(STOP_EXIT_MARGIN_MS >= 3 * 300, `STOP_EXIT_MARGIN_MS (${STOP_EXIT_MARGIN_MS}) must cover a few 300ms poll intervals`);
  assert.equal(STOP_REQUEST_PATH, "/__kit/stop");
  assert.match(STOP_TOKEN_HEADER, /^x-/);
  // One implementation, two byte-identical copies (the event-line pattern):
  // the manager runs from lib/, the proxy builds from zcode-proxy-src alone.
  assert.ok(
    readFileSync(join(ROOT, "lib", "stop-deadlines.mjs")).equals(readFileSync(join(ROOT, "zcode-proxy-src", "src", "runtime", "stop-deadlines.mjs"))),
    "lib/stop-deadlines.mjs and zcode-proxy-src/src/runtime/stop-deadlines.mjs are byte-identical",
  );
  // The proxy's own stop deadline, read from its modules by Bun.
  const read = spawnSync(bunOrFail(), ["-e", `import { SHUTDOWN_TIMING } from ${JSON.stringify(SUPERVISOR_URL)}; import { STOP_GRACE_MS } from ${JSON.stringify(PROXY_STOP_DEADLINES_URL)}; console.log(JSON.stringify({ stop: SHUTDOWN_TIMING.stop, grace: STOP_GRACE_MS }));`], { encoding: "utf8", timeout: 60_000 });
  assert.equal(read.status, 0, read.stderr);
  const proxySide = JSON.parse(read.stdout);
  assert.equal(proxySide.grace, STOP_GRACE_MS);
  assert.deepEqual(proxySide.stop, { drainMs: 6_000, deadlineMs: STOP_GRACE_MS }, "the stop sequence drains inside its own grace and exits at it");
  // The manager's force point is strictly after the proxy's own deadline.
  assert.ok(STOP_GRACE_MS + STOP_EXIT_MARGIN_MS > proxySide.grace);
});

// Native acceptance remains separate from portable clock/process controls.
// No POSIX shebang or signal-exit assumptions: this child is the running Node.
test("native Windows accepted stop honors grace/margin and exits without TerminateProcess", { skip: process.platform !== "win32", timeout: 60_000 }, async t => {
  const root = kitFixture(t, await freePort());
  const port = Number(readFileSync(join(root, "proxy", "config.yaml"), "utf8").match(/port: (\d+)/)[1]);
  const requests = join(root, "native-stop.jsonl");
  const stand = await spawnStopStandIn(t, root, port, "202-exit-1200", requests);
  const lifecycle = await lifecycleFor(root, { stopGraceMs: 600, stopExitMarginMs: 1800 });
  const startedMs = lifecycle.processStartMs(stand.pid);
  assert.ok(Number.isFinite(startedMs));
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: stand.pid, startedMs, stopToken: "synthetic-native-stop" }));
  const stopped = await lifecycle.stop();
  await gone(stand);
  assert.equal(stopped.code, 0);
  assert.equal(stand.exitCode, 0);
  assert.equal(readStopRequests(requests).length, 1);
  assert.equal(existsSync(requests + ".natural"), true, "child reached its natural-exit timer, not TerminateProcess");
  assert.ok(!stopped.lines.some(line => /refusing|kill guard/.test(line)));
});

test("native Windows accepted stop forces only after margin; direct force sends no request", { skip: process.platform !== "win32", timeout: 90_000 }, async t => {
  for (const direct of [false, true]) {
    const port = await freePort();
    const root = kitFixture(t, port);
    const requests = join(root, "native-stop.jsonl");
    const stand = await spawnStopStandIn(t, root, port, "202", requests);
    const lifecycle = await lifecycleFor(root, { stopGraceMs: 600, stopExitMarginMs: 600 });
    const startedMs = lifecycle.processStartMs(stand.pid);
    assert.ok(Number.isFinite(startedMs));
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: stand.pid, startedMs, stopToken: "synthetic-native-stop" }));
    let requestAt = null, forceAt = null;
    const observe = line => {
      if (line.includes("stop request sent")) requestAt = performance.now();
      if (line.includes("outlived the grace; forcing")) forceAt = performance.now();
    };
    if (direct) assert.equal(await lifecycle.forceStop(stand.pid, { recordedStart: { ms: startedMs, ticks: null }, observe }), true);
    else {
      assert.equal((await lifecycle.stop({ observe })).code, 0);
      assert.ok(forceAt !== null && requestAt !== null && forceAt - requestAt >= 1200, "native manager never enters force inside grace/margin");
    }
    await gone(stand);
    assert.equal(stand.exitCode, 0);
    assert.equal(readStopRequests(requests).length, direct ? 0 : 1);
  }
});

test("stop sends the stop request with the bearer key and the recorded token, answers 202, and never signals while the proxy exits within the grace", {
  skip: POSIX_STOP_STANDIN_SKIP,
}, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port);
  const { STOP_REQUEST_PATH } = await stopDeadlines();
  const token = randomBytes(32).toString("base64url");
  const record = join(root, "stop-requests.jsonl");
  const stand = await spawnStopStandIn(t, root, port, "202-exit-900", record);
  const recordedMs = Date.now() - 10 * 60_000;
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: stand.pid, startedMs: recordedMs, startedIso: new Date(recordedMs).toISOString(), stopToken: token }) + "\n", { mode: 0o600 });
  const lifecycle = await lifecycleFor(root, { processStartMsImpl: () => recordedMs, stopGraceMs: 800, stopExitMarginMs: 400 });
  const observed = [];
  const stopped = await lifecycle.stop({ observe: (l) => observed.push(l) });
  // The proxy exits at 900 ms: after its own deadline (800 ms), before the
  // manager's force point (800 + 400 ms). No signal was ever delivered.
  assert.equal(stand.exitCode, 0, "the stand-in exited by itself (never signalled)");
  assert.equal(stand.signalCode, null);
  const requests = readStopRequests(record);
  assert.equal(requests.length, 1, "the manager sent exactly one stop request");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, STOP_REQUEST_PATH);
  assert.equal(requests[0].auth, `Bearer ${KEY}`);
  assert.ok(requests[0].token === token, "the request carried the recorded stop token");
  assert.deepEqual({ code: stopped.code, outcome: stopped.outcome }, { code: 0, outcome: "stopped" });
  // The intent's narration keeps its frozen text; the request's steps are
  // event lines (ticket 14) on the observe channel and in proxy.log.
  assert.deepEqual(stopped.lines, [`stopped (pid ${stand.pid})`]);
  assert.ok(observed.some((l) => / INFO manager stop request sent pid=\d+ graceMs=800$/.test(l)), observed.join("\n"));
  assert.match(readFileSync(join(root, "logs", "proxy.log"), "utf8"), / INFO manager stop request sent pid=\d+ graceMs=800$/m);
  assert.equal(existsSync(join(root, "logs", "proxy.pid")), false, "the stopped proxy's record is removed");
});

test("stop falls back per status and OS against a proxy that does not accept the request, and without a recorded token it sends none", { timeout: 120_000 }, async (t) => {
  for (const behavior of ["404", "401", "403", "destroy", "no-token"]) {
    const port = await freePort();
    const root = kitFixture(t, port);
    const token = behavior === "no-token" ? null : randomBytes(32).toString("base64url");
    const record = join(root, "stop-requests.jsonl");
    const stand = await spawnStopStandIn(t, root, port, behavior === "no-token" ? "404" : behavior, record);
    const nativeWindows = process.platform === "win32";
    const nativeLifecycle = nativeWindows ? await lifecycleFor(root) : null;
    const recordedMs = nativeWindows ? nativeLifecycle.processStartMs(stand.pid) : Date.now() - 10 * 60_000;
    assert.ok(Number.isFinite(recordedMs), `${behavior}: creation time is readable`);
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: stand.pid, startedMs: recordedMs, startedIso: new Date(recordedMs).toISOString(), ...(token ? { stopToken: token } : {}) }) + "\n", { mode: 0o600 });
    const lifecycle = nativeLifecycle ?? await lifecycleFor(root, { processStartMsImpl: () => recordedMs, stopGraceMs: 800, stopExitMarginMs: 400 });
    const observed = [];
    const stopped = await lifecycle.stop({ observe: (l) => observed.push(l) });
    const requests = readStopRequests(record);
    assert.equal(requests.length, behavior === "no-token" ? 0 : 1, `${behavior}: request count`);
    if (process.platform === "win32") {
      await gone(stand);
      assert.equal(stand.exitCode, 0, `${behavior}: handle-checked TerminateProcess exits 0`);
    } else {
      assert.equal(stand.signalCode, "SIGTERM", `${behavior}: the fallback signal was delivered`);
    }
    assert.deepEqual({ code: stopped.code, outcome: stopped.outcome }, { code: 0, outcome: "stopped" });
    assert.deepEqual(stopped.lines, [`stopped (pid ${stand.pid})`], `${behavior}: the narration keeps its frozen text`);
    if (behavior === "no-token") {
      assert.ok(observed.some((l) => new RegExp(` INFO manager stop request skipped; no token pid=\\d+ fallback=${process.platform === "win32" ? "TerminateProcess" : "SIGTERM"}$`).test(l)), observed.join("\n"));
    } else {
      const why = behavior === "destroy" ? "connection error" : behavior;
      assert.ok(observed.some((l) => new RegExp(` INFO manager stop request refused; falling back pid=\\d+ why=(?:"${why}"|${why}) fallback=${process.platform === "win32" ? "TerminateProcess" : "SIGTERM"}$`).test(l)), observed.join("\n"));
    }
  }
});

test("an accepted stop that outlives grace waits through the margin before escalation", { skip: POSIX_STOP_STANDIN_SKIP }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port);
  const record = join(root, "stop-requests.jsonl");
  const token = randomBytes(32).toString("base64url");
  const stand = await spawnStopStandIn(t, root, port, "202", record);
  const recordedMs = Date.now() - 600_000;
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: stand.pid, startedMs: recordedMs, stopToken: token }) + "\n");
  const lifecycle = await lifecycleFor(root, { processStartMsImpl: () => recordedMs, stopGraceMs: 600, stopExitMarginMs: 600 });
  const started = Date.now();
  const stopped = await lifecycle.stop();
  assert.equal(stopped.code, 0);
  assert.ok(Date.now() - started >= 1200, "never signal before grace + margin");
  assert.equal(stand.signalCode, "SIGTERM");
  assert.equal(readStopRequests(record).length, 1);
});

test("an accepted stop never signals a reused PID at escalation", { skip: POSIX_STOP_STANDIN_SKIP }, async (t) => {
  const port = await freePort();
  const root = kitFixture(t, port);
  const record = join(root, "stop-requests.jsonl");
  const token = randomBytes(32).toString("base64url");
  const stand = await spawnStopStandIn(t, root, port, "202", record);
  const recordedMs = Date.now() - 600_000;
  writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: stand.pid, startedMs: recordedMs, stopToken: token }) + "\n");
  const lifecycle = await lifecycleFor(root, {
    processStartMsImpl: () => readStopRequests(record).length ? recordedMs + 1000 : recordedMs,
    stopGraceMs: 300, stopExitMarginMs: 300,
  });
  const stopped = await lifecycle.stop();
  assert.equal(stopped.code, 0, "the recorded generation is gone");
  assert.equal(stand.exitCode, null);
  assert.equal(stand.signalCode, null, "no signal to the replacement generation");
});

test("Windows-shaped old-proxy stop fallbacks keep the creation-time checked TerminateProcess path", { ...fakeWindows, timeout: 120_000 }, async (t) => {
  for (const behavior of ["404", "401", "403", "destroy"]) {
    const port = await freePort();
    const root = kitFixture(t, port);
    const record = join(root, "stop-requests.jsonl");
    const token = randomBytes(32).toString("base64url");
    const stand = await spawnStopStandIn(t, root, port, behavior, record);
    const pidRecord = { ...newKitRecord(stand.pid, WORKED_TICKS, WORKED_MS), stopToken: token };
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify(pidRecord) + "\n");
    const lifecycle = await lifecycleFor(root);
    const win = asWindows({ [stand.pid]: { ticks: String(WORKED_TICKS) } });
    let result, calls;
    try { result = await lifecycle.stop(); calls = win.calls(); } finally { win.restore(); }
    assert.equal(result.code, 0, behavior);
    assert.equal(readStopRequests(record).length, 1, `${behavior}: request before fallback`);
    assert.ok(calls.some((c) => c.kind === "guard" && c.exit === 0), `${behavior}: handle-checked fallback ran`);
    await gone(stand);
  }
});

test("the force paths never send the stop request: hung-own recovery, the explicit force helper, and the startup timeout", {
  timeout: 120_000,
  skip: process.platform === "win32" && "the fake-bun startup path is POSIX; Windows forces through the handle-checked TerminateProcess (proven by the kill-guard tests)",
}, async (t) => {
  const token = randomBytes(32).toString("base64url");

  // (1) Hung-own recovery (recoverHung): a recorded proxy that answers nothing
  // is killed only with the hung-own proof, and never through the request.
  {
    const port = await freePort();
    const root = kitFixture(t, port);
    const record = join(root, "stop-requests.jsonl");
    const stand = await spawnStopStandIn(t, root, port, "202", record, true);
    const recordedMs = Date.now() - 10 * 60_000;
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: stand.pid, startedMs: recordedMs, startedIso: new Date(recordedMs).toISOString(), stopToken: token }) + "\n", { mode: 0o600 });
    const lifecycle = await lifecycleFor(root, {
      processStartMsImpl: () => recordedMs,
      processCommandLineImpl: () => ({ commandLine: `bun ${join(root, "zcode-proxy-src", "src", "index.ts")} serve`, executablePath: "bun" }),
      hungProbeCount: 1, hungProbeIntervalMs: 10, hungProbeTimeoutMs: 100,
      stopGraceMs: 800, stopExitMarginMs: 400,
    });
    const observed = [];
    const stopped = await lifecycle.stop({ observe: (l) => observed.push(l) });
    assert.deepEqual({ code: stopped.code, outcome: stopped.outcome }, { code: 0, outcome: "stopped-hung" });
    assert.equal(readStopRequests(record).length, 0, "hung-own recovery sent no stop request");
    assert.ok(!observed.some((l) => l.includes("stop request sent")), observed.join("\n"));
    await until("the hung stand-in to be gone", async () => stand.exitCode !== null || stand.signalCode !== null, 15_000);
  }

  // (2) The explicit force helper (the golden-path crash injection's entry):
  // killOwned/forceStop signal directly, no request is sent.
  {
    const port = await freePort();
    const root = kitFixture(t, port);
    const record = join(root, "stop-requests.jsonl");
    const stand = await spawnStopStandIn(t, root, port, "202", record);
    const recordedMs = Date.now() - 10 * 60_000;
    writeFileSync(join(root, "logs", "proxy.pid"), JSON.stringify({ pid: stand.pid, startedMs: recordedMs, startedIso: new Date(recordedMs).toISOString(), stopToken: token }) + "\n", { mode: 0o600 });
    const lifecycle = await lifecycleFor(root, { processStartMsImpl: () => recordedMs, stopGraceMs: 800, stopExitMarginMs: 400 });
    const observed = [];
    const { createManager } = await import(pathToFileURL(join(root, "proxy", "zcode-proxy-manager.mjs")).href);
    const manager = createManager({ root, home: join(root, "home"), processStartMsImpl: () => recordedMs });
    assert.equal(typeof manager.forceStop, "function", "golden-path crash injection uses the manager's public force helper");
    const killed = await manager.forceStop(stand.pid, { recordedStart: { ms: recordedMs } });
    assert.equal(killed, true, "the force helper killed the stand-in");
    assert.equal(readStopRequests(record).length, 0, "the force helper sent no stop request");
    assert.ok(!observed.some((l) => l.includes("stop request sent")), observed.join("\n"));
    await until("the forced stand-in to be gone", async () => stand.exitCode !== null || stand.signalCode !== null, 15_000);
  }

  // (3) The startup timeout: a spawned proxy that never becomes healthy is
  // killed by the start, and no stop request goes out.
  {
    const port = await freePort();
    const root = kitFixture(t, port);
    const record = join(root, "stop-requests.jsonl");
    await spawnStopStandIn(t, root, port, "202", record, true); // /health stays silent
    mkdirSync(join(root, "zcode-proxy-src", "node_modules"), { recursive: true });
    const fakeBun = join(root, "fake-bun.mjs");
    writeFileSync(fakeBun, "#!/usr/bin/env node\nprocess.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1e6);\n");
    chmodSync(fakeBun, 0o755);
    const lifecycle = await lifecycleFor(root, { bunResolver: () => fakeBun, stopGraceMs: 800, stopExitMarginMs: 400 });
    const observed = [];
    const started = await lifecycle.ensureRunning({ waitMs: 1500, observe: (l) => observed.push(l) });
    assert.deepEqual({ code: started.code, outcome: started.outcome }, { code: 2, outcome: "unhealthy" });
    assert.equal(readStopRequests(record).length, 0, "the startup timeout sent no stop request");
    assert.ok(!observed.some((l) => l.includes("stop request sent")), observed.join("\n"));
  }
});
