// Seam 2: the start lock protocol v1 and the spawn → pid record window
// (ticket 16; spec §4; ADR-0003, ADR-0012; DECISIONS Round 7 Q4).
//   - a stale lock is taken over only on proof (holder dead, or pid reused:
//     v1 start id / start time, v0 start later than startedAt), with one
//     takeover event line; a live holder's lock is never touched;
//   - an unparsable lock or one of an unknown higher version is never
//     deleted and is reported with what/why/next and the exact path;
//   - the takeover race: N contenders, a kill injected at every protocol
//     step (real processes, real time) → never two holders, never a deleted
//     live lock, never a partial lock file, no failed contender;
//   - origin/main's lock code reads a new lock as pid/startedAt and never
//     deletes it; the lock-version migration replayed twice is a no-op;
//   - a start killed at each point between spawn and the complete pid
//     record, and a start whose start-time probe times out (no kill), each
//     end with exactly one proxy that the next start adopts and stop stops;
//     a reused pid is never signalled.
// Ports: every test takes a free loopback port of its own (freePort), as ticket
// 15's tests do since its Windows fix (ticket 75: parallel test files collide).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { processCommandLine, resolveBun } from "../lib/process.mjs";

const ROOT = join(import.meta.dirname, "..");
const KEY = "synthetic-start-lock-key";
const DEAD_PID = 2147483646; // above Linux's pid_max and never handed out by Windows
const CONTENDER = join(ROOT, "tests", "fixtures", "start-lock-contender.mjs");
const STARTER = join(ROOT, "tests", "fixtures", "start-contender.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- fixtures
const cleanups = new Map();
const defer = (root, fn) => cleanups.get(root).push(fn);

/** A loopback port no listener holds right now (bind port 0, read it back, release it). */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolvePort(port)); });
  });
}

/** A temp root that is its own state directory (config, key, logs). */
async function stateFixture(t, port = null, { kit = false } = {}) {
  port ??= await freePort();
  const root = mkdtempSync(join(tmpdir(), "kit-start-lock-"));
  cleanups.set(root, []);
  t.after(() => {
    for (const fn of cleanups.get(root).splice(0).reverse()) { try { fn(); } catch {} }
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "proxy"), { recursive: true }); mkdirSync(join(root, "logs")); mkdirSync(join(root, "home"));
  writeFileSync(join(root, "proxy", "config.yaml"), `server:\n  host: 127.0.0.1\n  port: ${port}\nauth:\n  proxyApiKey: "${KEY}"\n`);
  writeFileSync(join(root, ".proxykey"), KEY + "\n");
  if (kit) {
    for (const member of ["cli", "lib"]) cpSync(join(ROOT, member), join(root, member), { recursive: true });
    cpSync(join(ROOT, "proxy", "zcode-proxy-manager.mjs"), join(root, "proxy", "zcode-proxy-manager.mjs"));
    mkdirSync(join(root, "zcode-proxy-src", "node_modules"), { recursive: true });
    mkdirSync(join(root, "zcode-proxy-src", "src"));
    writeFileSync(join(root, "zcode-proxy-src", "src", "index.ts"), FAKE_PROXY);
    mkdirSync(join(root, "spawned"));
  }
  return root;
}

const lockPath = (root) => join(root, "logs", "manager.lock");
const lockFiles = (root) => readdirSync(join(root, "logs")).filter((f) => f.startsWith("manager.lock")).sort();
const takeoverLines = (root) => { try { return readFileSync(join(root, "logs", "proxy.log"), "utf8").split("\n").filter((l) => / WARN manager lock takeover /.test(l)); } catch { return []; } };

function childEnv(root, extra = {}) {
  const env = { ...process.env, HOME: join(root, "home"), USERPROFILE: join(root, "home"), ...extra };
  delete env.ZCODE_KIT_STATE_DIR; // the fixture root is the state directory
  return env;
}

async function lifecycleFor(root, options = {}) {
  const { createLifecycle } = await import(pathToFileURL(join(ROOT, "lib", "proxy-lifecycle.mjs")).href);
  return createLifecycle({ root, home: join(root, "home"), bunResolver: () => { throw new Error("must not spawn"); }, ...options });
}

// ------------------------------------------------- proof: stale vs live locks
test("a stale v0 lock whose holder is dead is taken over by the next start, with one takeover event line", async (t) => {
  const root = await stateFixture(t);
  writeFileSync(lockPath(root), JSON.stringify({ pid: DEAD_PID, startedAt: "2026-01-01T00:00:00.000Z", nonce: "0123456789abcdef" }));
  const started = await (await lifecycleFor(root)).ensureRunning({ waitMs: 1000 });
  // Past the lock: no proxy dependencies in this fixture, so it stops right after.
  assert.equal(started.outcome, "dependencies-missing", JSON.stringify(started));
  assert.deepEqual(lockFiles(root), [], "the lock was taken over, then released");
  const events = takeoverLines(root);
  assert.equal(events.length, 1, events.join("\n"));
  assert.match(events[0], new RegExp(`^\\S+ WARN manager lock takeover holderPid=${DEAD_PID} reason="holder dead" version=0 path=\\S+manager\\.lock$`));
});

test("the manager CLI's start and stop take a dead holder's lock over (no more 'refusing automatic takeover')", async (t) => {
  const root = await stateFixture(t, null, { kit: true });
  writeFileSync(lockPath(root), JSON.stringify({ pid: DEAD_PID, startedAt: "2026-01-01T00:00:00.000Z", nonce: "fedcba9876543210" }));
  const stop = spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "stop"], { env: childEnv(root), encoding: "utf8", timeout: 60_000 });
  assert.equal(stop.status, 0, stop.stdout + stop.stderr);
  assert.equal(stop.stdout, "not running\n");
  assert.deepEqual(lockFiles(root), []);
});

test("a v0 lock is stale when the live process at its pid started after the lock's startedAt (pid reused)", async (t) => {
  const root = await stateFixture(t);
  writeFileSync(lockPath(root), JSON.stringify({ pid: process.pid, startedAt: "2000-01-01T00:00:00.000Z", nonce: "aaaaaaaaaaaaaaaa" }));
  const lock = (await lifecycleFor(root)).acquireStartLock();
  assert.equal(lock.status, "acquired", lock.message);
  lock.release();
  assert.match(takeoverLines(root)[0] ?? "", / reason="pid reused" version=0 /);
});

test("a v0 lock whose live holder started before startedAt is never touched", async (t) => {
  const root = await stateFixture(t);
  const text = JSON.stringify({ pid: process.pid, startedAt: new Date(Date.now() + 60_000).toISOString(), nonce: "bbbbbbbbbbbbbbbb" });
  writeFileSync(lockPath(root), text);
  const lock = (await lifecycleFor(root)).acquireStartLock();
  assert.equal(lock.status, "contended");
  assert.match(lock.message, new RegExp(`^another manager start is in progress \\(pid ${process.pid}, started `));
  assert.equal(readFileSync(lockPath(root), "utf8"), text);
  assert.deepEqual(takeoverLines(root), []);
});

test("v1: a live holder's lock is never touched; a reused pid (later start, other start id) is taken over; an unknown start time is no proof", async (t) => {
  // Live: our own acquisition, met by a second contender in this process.
  const root = await stateFixture(t);
  const lifecycle = await lifecycleFor(root);
  const held = lifecycle.acquireStartLock();
  assert.equal(held.status, "acquired");
  const bytes = readFileSync(lockPath(root), "utf8");
  assert.equal(lifecycle.acquireStartLock().status, "contended");
  assert.equal(readFileSync(lockPath(root), "utf8"), bytes, "a live holder's lock is never touched");
  held.release();
  assert.deepEqual(lockFiles(root), []);

  // Reused, by start time: the process now at the pid started after the holder's start bound.
  const reused = await stateFixture(t);
  writeFileSync(lockPath(reused), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce: "c".repeat(32), v: 1, holderStartMs: Date.now() - 60_000 }));
  const later = await lifecycleFor(reused, { processStartMsImpl: () => Date.now() });
  const taken = later.acquireStartLock();
  assert.equal(taken.status, "acquired", taken.message);
  taken.release();
  assert.match(takeoverLines(reused)[0] ?? "", / reason="pid reused" version=1 /);

  // Unknown: the live start time cannot be read → no proof, untouched.
  const unknown = await stateFixture(t);
  const text = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce: "d".repeat(32), v: 1, holderStartMs: 0 });
  writeFileSync(lockPath(unknown), text);
  assert.equal((await lifecycleFor(unknown, { processStartMsImpl: () => null })).acquireStartLock().status, "contended");
  assert.equal(readFileSync(lockPath(unknown), "utf8"), text);
});

test("v1 on Linux: a different start id at the holder's pid proves reuse, whatever the clock says", { skip: process.platform !== "linux" && "the start id is Linux's /proc boot id + start ticks" }, async (t) => {
  const root = await stateFixture(t);
  // holderStartMs far in the future: by time alone this would be the live holder.
  writeFileSync(lockPath(root), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce: "e".repeat(32), v: 1, holderStartMs: Date.now() + 3_600_000, holderStartId: "another-boot:1" }));
  const lock = (await lifecycleFor(root)).acquireStartLock();
  assert.equal(lock.status, "acquired", lock.message);
  lock.release();
});

test("new locks are v1 records an old kit reads as pid/startedAt", async (t) => {
  const root = await stateFixture(t);
  const lock = (await lifecycleFor(root)).acquireStartLock();
  const record = JSON.parse(readFileSync(lockPath(root), "utf8"));
  lock.release();
  assert.equal(record.pid, process.pid);
  assert.ok(Number.isFinite(Date.parse(record.startedAt)));
  assert.match(record.nonce, /^[0-9a-f]{32}$/);
  assert.equal(record.v, 1);
  assert.ok(Number.isFinite(record.holderStartMs) && record.holderStartMs <= Date.now());
  assert.deepEqual(Object.keys(record).sort(), ["holderStartMs", "nonce", "pid", "startedAt", "v", ...(process.platform === "linux" ? ["holderStartId"] : [])].sort());
});

// ------------------------------------------ unreadable and newer locks: untouched
for (const [name, text] of [
  ["garbage", "not a lock"],
  ["an empty file", ""],
  ["a record without a numeric pid", '{"pid":"123","startedAt":"x"}'],
  ["a v1 record without its start time", `{"pid":${DEAD_PID},"startedAt":"x","nonce":"n","v":1}`],
]) {
  test(`an unparsable lock (${name}) is never deleted and is reported with what/why/next and its path`, async (t) => {
    const root = await stateFixture(t, null, { kit: true });
    writeFileSync(lockPath(root), text);
    const started = await (await lifecycleFor(root)).ensureRunning({ waitMs: 1000 });
    assert.equal(started.outcome, "start-lock-unavailable");
    assert.equal(started.code, 1);
    assert.equal(started.error,
      `start lock at ${lockPath(root)} is not a readable start lock record, so it was left untouched.\n` +
      `  why: it is not JSON with a holder pid. The kit writes its locks atomically, so this is a foreign or corrupted file, not a start in progress.\n` +
      `  next: if no zcode-kit start or stop is running, inspect ${lockPath(root)}, remove it, and retry.`);
    // The manager CLI (frozen: exit 1, `manager error: …`) and stop refuse the same way.
    const cli = spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "start"], { env: childEnv(root), encoding: "utf8", timeout: 60_000 });
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    assert.ok(cli.stderr.startsWith(`manager error: start lock at ${lockPath(root)} is not a readable start lock record`), cli.stderr);
    const stop = spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), "stop"], { env: childEnv(root), encoding: "utf8", timeout: 60_000 });
    assert.equal(stop.status, 4, stop.stdout + stop.stderr);
    assert.equal(readFileSync(lockPath(root), "utf8"), text, "never deleted");
    assert.deepEqual(lockFiles(root), ["manager.lock"]);
  });
}

test("a lock of an unknown higher protocol version is never deleted and is reported with what/why/next and its path", async (t) => {
  const root = await stateFixture(t);
  const text = JSON.stringify({ pid: DEAD_PID, startedAt: "2026-01-01T00:00:00.000Z", nonce: "f".repeat(32), v: 7, holderStartMs: 0 });
  writeFileSync(lockPath(root), text);
  const started = await (await lifecycleFor(root)).ensureRunning({ waitMs: 1000 });
  assert.equal(started.outcome, "start-lock-unavailable");
  assert.equal(started.error,
    `start lock at ${lockPath(root)} has protocol version 7, newer than this kit understands (1), so it was left untouched.\n` +
    `  why: only a kit that knows a lock's version may judge whether its holder is gone.\n` +
    `  next: let the newer kit's start finish, or update this kit; if no start is running, remove ${lockPath(root)} and retry.`);
  assert.equal(readFileSync(lockPath(root), "utf8"), text);
});

// --------------------------------------------------- old kits meet new locks
const ORIGIN_MAIN_LOCK = join(ROOT, "tests", "fixtures", "origin-main-9e45d05", "manager-start-lock.mjs");

test("the vendored origin/main start-lock code is verbatim origin/main (when the object is available)", (t) => {
  const show = spawnSync("git", ["-C", ROOT, "show", "9e45d05:proxy/zcode-proxy-manager.mjs"], { encoding: "utf8" });
  if (show.status !== 0) { t.diagnostic("commit 9e45d05 not in this clone (shallow CI checkout): vendored copy not re-verified"); return; }
  const vendored = readFileSync(ORIGIN_MAIN_LOCK, "utf8").replace(/\r\n/g, "\n");
  const blocks = [...vendored.matchAll(/\/\/ --- verbatim block: [^\n]*\n([\s\S]*?)\/\/ --- end\n/g)].map((m) => m[1]);
  assert.equal(blocks.length, 2);
  for (const block of blocks) assert.ok(show.stdout.replace(/\r\n/g, "\n").includes(block), `drifted from origin/main:\n${block}`);
});

test("origin/main's lock code reads a new lock as pid/startedAt and never deletes it", async (t) => {
  const { originMainStartLock } = await import(pathToFileURL(ORIGIN_MAIN_LOCK).href);
  const root = await stateFixture(t);
  const LOG_DIR = join(root, "logs");
  const old = originMainStartLock({ LOG_DIR, LOCK_FILE: lockPath(root) });

  // A live new-kit holder: the old kit sees a start in progress, by pid and startedAt.
  const held = (await lifecycleFor(root)).acquireStartLock();
  const record = JSON.parse(readFileSync(lockPath(root), "utf8"));
  assert.throws(() => old.acquireStartLock(), (err) => err.code === "START_IN_PROGRESS" && err.message.includes(`(pid ${record.pid}, started ${record.startedAt})`));
  old.releaseStartLock();
  assert.equal(JSON.parse(readFileSync(lockPath(root), "utf8")).nonce, record.nonce, "the old kit never deletes a lock it does not own");
  held.release();

  // A dead new-kit holder: the old kit reports it (pid and startedAt) and leaves it.
  const stale = { pid: DEAD_PID, startedAt: "2026-02-03T04:05:06.007Z", nonce: "1".repeat(32), v: 1, holderStartMs: 1 };
  writeFileSync(lockPath(root), JSON.stringify(stale));
  assert.throws(() => old.acquireStartLock(), new RegExp(`holder pid ${DEAD_PID} is not alive, started 2026-02-03T04:05:06\\.007Z`));
  assert.equal(readFileSync(lockPath(root), "utf8"), JSON.stringify(stale));

  // An old kit's own lock (v0) held by a live old kit: the new kit waits, never touches it.
  rmSync(lockPath(root));
  old.acquireStartLock();
  const oldText = readFileSync(lockPath(root), "utf8");
  assert.equal((await lifecycleFor(root)).acquireStartLock().status, "contended");
  assert.equal(readFileSync(lockPath(root), "utf8"), oldText);
  old.releaseStartLock();
  assert.deepEqual(lockFiles(root), []);
});

test("the lock-version migration (a stale v0 lock replaced through takeover) replayed twice is a no-op the second time", async (t) => {
  const root = await stateFixture(t);
  writeFileSync(lockPath(root), JSON.stringify({ pid: DEAD_PID, startedAt: "2026-01-01T00:00:00.000Z", nonce: "2222222222222222" }));
  const lifecycle = await lifecycleFor(root);
  for (const pass of [1, 2]) {
    const lock = lifecycle.acquireStartLock();
    assert.equal(lock.status, "acquired", `pass ${pass}: ${lock.message}`);
    assert.equal(JSON.parse(readFileSync(lockPath(root), "utf8")).v, 1);
    lock.release();
    assert.deepEqual(lockFiles(root), [], `pass ${pass}`);
    assert.equal(takeoverLines(root).length, 1, `pass ${pass}: exactly one takeover, on the first pass`);
  }
});

// ------------------------------------------------------- the takeover race
function runContender(root, { killAt = null, pauseAt = null, pauseMs = 0, holdMs = 20, deadlineMs = 60_000, onPaused = null } = {}) {
  const cfg = { kitRoot: ROOT, root, killAt, pauseAt, pauseMs, holdMs, deadlineMs, flag: join(root, "holder.flag") };
  const child = spawn(process.execPath, [CONTENDER, JSON.stringify(cfg)], { env: childEnv(root), stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (b) => { out += b; });
  child.stderr.on("data", (b) => { err += b; if (onPaused && err.includes("paused ")) { const fn = onPaused; onPaused = null; fn(); } });
  return new Promise((resolveRun) => child.on("close", (code, signal) => {
    let result = null;
    try { result = JSON.parse(out.trim().split("\n").pop()); } catch {}
    resolveRun({ code, signal, result, err });
  }));
}

/** What a kill left behind must be no lock file, or a complete, parsable record (never a partial one). */
function assertNoPartialLock(root, label) {
  if (!existsSync(lockPath(root))) return;
  const text = readFileSync(lockPath(root), "utf8");
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}
  assert.ok(parsed && Number.isInteger(parsed.pid) && parsed.v === 1 && Number.isFinite(parsed.holderStartMs), `${label}: partial lock file ${JSON.stringify(text)}`);
}

const STALE_V1 = () => JSON.stringify({ pid: DEAD_PID, startedAt: new Date().toISOString(), nonce: "3".repeat(32), v: 1, holderStartMs: 1 });
const FRESH_STEPS = ["lock:temp-partial", "lock:temp-written", "lock:linked", "lock:temp-removed", "acquired", "release-checked"];
const TAKEOVER_STEPS = ["judged-stale", "claim:temp-partial", "claim:temp-written", "claim:linked", "claim:temp-removed", "target-rechecked", "target-removed", "claim-released"];
const RACE = [
  ...FRESH_STEPS.map((step) => ({ prep: null, kills: [step] })),
  ...TAKEOVER_STEPS.map((step) => ({ prep: STALE_V1, kills: [step] })),
  // A claimant killed while holding its claim, then a second contender killed
  // at each step of taking that stale claim over (a claim of the claim).
  ...["judged-stale", "claim:linked", "target-rechecked", "target-removed"].map((step) => ({ prep: STALE_V1, kills: ["claim:linked", step] })),
];
const RACERS = 5;

test("judge-then-delete race (ADR-0003 condition 1): a contender that judged a lock stale never deletes the fresh lock another contender wrote meanwhile", { timeout: 120_000 }, async (t) => {
  for (const pauseAt of ["judged-stale", "claim:linked"]) {
    const root = await stateFixture(t);
    writeFileSync(lockPath(root), STALE_V1());
    // A judges the dead holder's lock stale, then stalls right there.
    let resolvePaused;
    const paused = new Promise((r) => { resolvePaused = r; });
    const a = runContender(root, { pauseAt, pauseMs: 2500, onPaused: () => resolvePaused() });
    await paused;
    // Meanwhile B takes the stale lock over (or waits on A's claim) and holds a fresh lock while A resumes.
    const b = runContender(root, { holdMs: 4000 });
    const [ra, rb] = await Promise.all([a, b]);
    for (const [name, r] of [["A", ra], ["B", rb]]) {
      assert.equal(r.code, 0, `${pauseAt}: ${name} ${r.err}`);
      assert.equal(r.result?.acquired, true, `${pauseAt}: ${name} acquired (${r.result?.error})`);
      assert.equal(r.result.overlap, false, `${pauseAt}: ${name} overlapped a live holder (two holders)`);
      assert.equal(r.result.intact, true, `${pauseAt}: ${name}'s live lock was deleted while it held it`);
    }
    assert.deepEqual(lockFiles(root), []);
    assert.equal(takeoverLines(root).length, 1, `${pauseAt}: the stale record was taken over exactly once`);
  }
});

test(`takeover race: ${RACERS} contenders after a kill injected at every protocol step → never two holders, never a deleted live lock, never a partial lock`, { timeout: 600_000 }, async (t) => {
  for (const { prep, kills } of RACE) {
    const label = `${prep ? "stale lock, " : ""}kill at ${kills.join(" then ")}`;
    const root = await stateFixture(t);
    if (prep) writeFileSync(lockPath(root), prep());
    for (const killAt of kills) {
      const victim = await runContender(root, { killAt });
      assert.equal(victim.result, null, `${label}: the victim reached ${killAt} and was killed there (${JSON.stringify(victim.result)} ${victim.err})`);
      assert.ok(victim.signal === "SIGKILL" || victim.code !== 0, `${label}: killed`);
      assertNoPartialLock(root, label);
    }
    // The killed holder's leftovers (a lock, a claim, temp files) must not block anyone.
    const racers = await Promise.all(Array.from({ length: RACERS }, () => runContender(root, { holdMs: 10 + Math.floor(Math.random() * 30) })));
    for (const [i, r] of racers.entries()) {
      assert.equal(r.code, 0, `${label}: racer ${i} exited ${r.code} ${r.err}`);
      assert.equal(r.result?.error, null, `${label}: racer ${i}: ${r.result?.error}`);
      assert.equal(r.result.acquired, true, `${label}: racer ${i} acquired the lock`);
      assert.equal(r.result.overlap, false, `${label}: racer ${i} overlapped another live holder (two holders)`);
      assert.equal(r.result.intact, true, `${label}: racer ${i}'s live lock was deleted or replaced while it held it`);
    }
    assert.deepEqual(lockFiles(root), [], `${label}: nothing left behind`);
    assert.ok(takeoverLines(root).length <= 2, `${label}: at most one takeover per stale record`);
  }
});

test("takeover race with the victim among the racers: a holder killed while holding never blocks the rest", { timeout: 300_000 }, async (t) => {
  for (const killAt of ["acquired", "lock:linked", "claim:linked", "target-removed"]) {
    const root = await stateFixture(t);
    writeFileSync(lockPath(root), STALE_V1());
    const all = await Promise.all([runContender(root, { killAt }), ...Array.from({ length: RACERS }, () => runContender(root))]);
    const [victim, ...racers] = all;
    for (const r of racers) {
      if (r.result === null && victim.result !== null) continue; // the victim role landed elsewhere: impossible (only one killAt)
      assert.equal(r.result?.acquired, true, `kill at ${killAt}: ${JSON.stringify(r.result)} ${r.err}`);
      assert.equal(r.result.overlap, false);
      assert.equal(r.result.intact, true);
    }
    if (victim.result) assert.equal(victim.result.overlap, false); // it never reached the step (lost every race)
    // Whatever the victim left, the next acquisition proceeds.
    const after = await runContender(root);
    assert.equal(after.result?.acquired, true, `kill at ${killAt}: the next start is not blocked (${after.result?.error})`);
    assert.deepEqual(lockFiles(root), []);
  }
});

// ---------------------------------------------- the spawn → pid record window
// A stand-in for the proxy: answers the identity proof with its own pid in
// details (as the real proxy's /health does), and records each start.
const FAKE_PROXY = `
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const config = (await Bun.file(process.env.ZCODE_PROXY_CONFIG).text());
const port = Number(config.match(/^  port:\\s*(\\d+)/m)[1]);
const key = config.match(/proxyApiKey:\\s*"([^"]+)"/)[1];
const root = join(import.meta.dir, "..", "..");
writeFileSync(join(root, "spawned", String(process.pid)), "");
// listen-delay-ms: a proxy that takes this long to come up (a cold start).
let delay = 0;
try { delay = Number(await Bun.file(join(root, "listen-delay-ms")).text()) || 0; } catch {}
if (delay) await Bun.sleep(delay);
createServer((req, res) => {
  if (req.headers.authorization !== "Bearer " + key) return res.writeHead(401).end("{}");
  if (req.url === "/health") return res.end(JSON.stringify({ status: "ok", provider: "zai", details: { pid: process.pid } }));
  res.writeHead(404).end("{}");
}).listen(port, "127.0.0.1");
`;

function bunOrFail() {
  try { return resolveBun(ROOT); } catch (err) { assert.fail(`this test spawns proxies under Bun: ${err.message}`); }
}

async function health(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(1500) });
    const j = await res.json();
    return res.status === 200 && j.provider === "zai" ? { state: "ours", pid: j.details?.pid ?? null } : { state: "foreign" };
  } catch { return { state: "down" }; }
}

/** The fixture's proxies that still run: judged by command line (never by a bare pid: Windows reuses pids). */
function liveProxies(root) {
  return readdirSync(join(root, "spawned")).map(Number).filter((pid) => {
    const info = processCommandLine(pid);
    return !!info && info.commandLine.toLowerCase().includes(basename(root).toLowerCase());
  });
}
function killFixtureProxies(root) {
  for (const pid of liveProxies(root)) { try { process.kill(pid, "SIGKILL"); } catch {} }
}
const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };
const manager = (root, args, env) => spawnSync(process.execPath, [join(root, "proxy", "zcode-proxy-manager.mjs"), ...args], { env, encoding: "utf8", timeout: 120_000 });

for (const [i, killAt] of ["spawn:intent-recorded", "spawn:spawned", "spawn:pid-recorded", "spawn:start-recorded"].entries()) {
  test(`a start killed at ${killAt} ends with exactly one proxy, adopted by the next start and stopped by stop`, { timeout: 180_000 }, async (t) => {
    const port = await freePort();
    const root = await stateFixture(t, port, { kit: true });
    defer(root, () => killFixtureProxies(root));
    const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail() });
    const killed = spawnSync(process.execPath, [STARTER, JSON.stringify({ kitRoot: root, root, killAt })], { env, encoding: "utf8", timeout: 120_000 });
    assert.equal(killed.stdout, "", `the start was killed at ${killAt} (${killed.stdout}${killed.stderr})`);
    assert.notEqual(killed.status, 0);
    assert.ok(existsSync(lockPath(root)), "test premise: the killed start left its (now stale) lock");

    // The next start (manager CLI) proceeds over the stale lock and ends with one proxy, recorded.
    const start = manager(root, ["start"], env);
    assert.equal(start.status, 0, start.stdout + start.stderr);
    await sleep(500);
    const live = liveProxies(root);
    assert.equal(live.length, 1, `exactly one proxy (spawned: ${readdirSync(join(root, "spawned")).join(", ")})`);
    const answer = await health(port);
    const record = readJson(join(root, "logs", "proxy.pid"));
    assert.equal(answer.pid, live[0]);
    assert.equal(record?.pid, live[0], `the pid record names the listener (${JSON.stringify(record)})`);
    assert.ok(Number.isFinite(record.startedMs), "with its start time");
    const { createLifecycle } = await import(pathToFileURL(join(ROOT, "lib", "proxy-lifecycle.mjs")).href);
    assert.equal(createLifecycle({ root, home: join(root, "home") }).verifyOwnProcess(record), "match");
    assert.deepEqual(lockFiles(root), [], "no stale lock after the start");

    const stop = manager(root, ["stop"], env);
    assert.equal(stop.status, 0, stop.stdout + stop.stderr);
    assert.equal(stop.stdout, `stopped (pid ${live[0]})\n`);
    assert.equal((await health(port)).state, "down");
    assert.deepEqual(liveProxies(root), [], "0 orphans");
    assert.equal(existsSync(join(root, "logs", "proxy.pid")), false);
  });
}

for (const [i, killAt] of ["spawn:spawned", "spawn:pid-recorded", "spawn:start-recorded"].entries()) {
  test(`a start killed at ${killAt} while its proxy is still coming up: the next start waits for that proxy instead of spawning a second`, { timeout: 180_000 }, async (t) => {
    const port = await freePort();
    const root = await stateFixture(t, port, { kit: true });
    defer(root, () => killFixtureProxies(root));
    // Windows: the killed start's own PowerShell probe can take seconds before the kill.
    writeFileSync(join(root, "listen-delay-ms"), process.platform === "win32" ? "6000" : "4000");
    const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail() });
    const killed = spawnSync(process.execPath, [STARTER, JSON.stringify({ kitRoot: root, root, killAt })], { env, encoding: "utf8", timeout: 120_000 });
    assert.equal(killed.stdout, "", `the start was killed at ${killAt}`);
    const early = (await health(port)).state;
    if (process.platform === "win32" && early !== "down") t.diagnostic(`windows: the orphaned proxy was already up (${early}) before the next start; the adoption path ran instead of the wait`);
    else assert.equal(early, "down", "test premise: the orphaned proxy is not up yet");
    const start = manager(root, ["start"], env);
    assert.equal(start.status, 0, start.stdout + start.stderr);
    await sleep(500);
    const spawned = readdirSync(join(root, "spawned"));
    assert.equal(spawned.length, 1, `no second proxy was spawned (spawned: ${spawned.join(", ")})`);
    const live = liveProxies(root);
    assert.equal(live.length, 1);
    assert.equal((await health(port)).pid, live[0]);
    const record = readJson(join(root, "logs", "proxy.pid"));
    assert.equal(record?.pid, live[0], JSON.stringify(record));
    assert.ok(Number.isFinite(record.startedMs));
    const stop = manager(root, ["stop"], env);
    assert.equal(stop.status, 0, stop.stdout + stop.stderr);
    assert.deepEqual(liveProxies(root), []);
  });
}

test("the spawner itself completes the record when its start-time probe answers only during the health wait", { timeout: 180_000 }, async (t) => {
  const port = await freePort();
  const root = await stateFixture(t, port, { kit: true });
  defer(root, () => killFixtureProxies(root));
  const bun = bunOrFail();
  const { createLifecycle } = await import(pathToFileURL(join(ROOT, "lib", "proxy-lifecycle.mjs")).href);
  const real = createLifecycle({ root, home: join(root, "home") }).processStartMs;
  // Slow for longer than the spawn's own 5 s probe window, then answering.
  const until = Date.now() + 6000;
  const slow = createLifecycle({ root, home: join(root, "home"), bunResolver: () => bun, processStartMsImpl: (pid, opts) => (Date.now() < until ? null : real(pid, opts)) });
  const started = await slow.ensureRunning({ waitMs: 30_000 });
  assert.equal(started.outcome, "started", JSON.stringify(started));
  const record = readJson(join(root, "logs", "proxy.pid"));
  assert.equal(record.pid, started.pid);
  assert.ok(Number.isFinite(record.startedMs), `the start finished with a complete record: ${JSON.stringify(record)}`);
  assert.equal((await slow.stop()).outcome, "stopped");
});

test("a start whose start-time probe times out (no kill) leaves a proxy the next start completes and stop stops", { timeout: 180_000 }, async (t) => {
  const port = await freePort();
  const root = await stateFixture(t, port, { kit: true });
  defer(root, () => killFixtureProxies(root));
  const bun = bunOrFail();
  const { createLifecycle } = await import(pathToFileURL(join(ROOT, "lib", "proxy-lifecycle.mjs")).href);
  const real = createLifecycle({ root, home: join(root, "home") }).processStartMs;
  // The spawner's probes never answer in time (two slow PowerShell calls on Windows).
  const slow = createLifecycle({ root, home: join(root, "home"), bunResolver: () => bun, processStartMsImpl: () => null });
  const started = await slow.ensureRunning({ waitMs: 8000 });
  assert.equal(started.outcome, "started", JSON.stringify(started));
  const before = readJson(join(root, "logs", "proxy.pid"));
  assert.equal(before.pid, started.pid);
  assert.equal(before.startedMs, null, "test premise: the start time is missing");

  // The next start: the probe answers now; the record is completed by proof.
  const next = createLifecycle({ root, home: join(root, "home"), bunResolver: () => bun, processStartMsImpl: (pid, opts) => real(pid, opts) });
  assert.equal((await next.ensureRunning()).outcome, "already-running");
  const completed = readJson(join(root, "logs", "proxy.pid"));
  assert.equal(completed.pid, started.pid);
  assert.ok(Number.isFinite(completed.startedMs), `completed: ${JSON.stringify(completed)}`);
  assert.equal(next.verifyOwnProcess(completed), "match");

  const stopped = await next.stop();
  assert.deepEqual({ code: stopped.code, outcome: stopped.outcome }, { code: 0, outcome: "stopped" });
  assert.deepEqual(liveProxies(root), []);
});

test("stop completes a record left without a start time and stops its proxy (the probe answers at stop time)", { timeout: 180_000 }, async (t) => {
  const port = await freePort();
  const root = await stateFixture(t, port, { kit: true });
  defer(root, () => killFixtureProxies(root));
  const bun = bunOrFail();
  const { createLifecycle } = await import(pathToFileURL(join(ROOT, "lib", "proxy-lifecycle.mjs")).href);
  const real = createLifecycle({ root, home: join(root, "home") }).processStartMs;
  const started = await createLifecycle({ root, home: join(root, "home"), bunResolver: () => bun, processStartMsImpl: () => null }).ensureRunning({ waitMs: 8000 });
  assert.equal(started.outcome, "started");
  assert.equal(readJson(join(root, "logs", "proxy.pid")).startedMs, null);
  const stopped = await createLifecycle({ root, home: join(root, "home"), processStartMsImpl: (pid, opts) => real(pid, opts) }).stop();
  assert.deepEqual({ code: stopped.code, outcome: stopped.outcome, lines: stopped.lines }, { code: 0, outcome: "stopped", lines: [`stopped (pid ${started.pid})`] });
  assert.deepEqual(liveProxies(root), []);
});

// An in-process listener that answers the identity proof naming `pid` as its own.
async function identityListener(t, port, pid) {
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end();
    res.end(JSON.stringify({ status: "ok", provider: "zai", details: { pid } }));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  t.after(() => { server.closeAllConnections(); server.close(); });
}
/** A harmless child the test owns (killed through its own handle at the end). */
function harmless(t) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e6)"], { stdio: "ignore" });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  return child;
}
const untouched = (child) => child.exitCode === null && child.signalCode === null;

test("a reused pid is never signalled: a record without a start time whose pid is not the listener's stays unproven", async (t) => {
  const port = await freePort();
  const root = await stateFixture(t, port);
  const stranger = harmless(t); // now holds the recorded pid
  const decoy = harmless(t);    // the pid the listener names
  await identityListener(t, port, decoy.pid);
  const recordText = JSON.stringify({ pid: stranger.pid, startedMs: null, startedIso: null }) + "\n";
  writeFileSync(join(root, "logs", "proxy.pid"), recordText);
  const lifecycle = await lifecycleFor(root);
  assert.equal((await lifecycle.ensureRunning()).outcome, "already-running");
  const stopped = await lifecycle.stop();
  assert.deepEqual({ code: stopped.code, outcome: stopped.outcome }, { code: 4, outcome: "start-unknown" });
  assert.ok(untouched(stranger) && untouched(decoy), "nothing is signalled");
  assert.equal(readFileSync(join(root, "logs", "proxy.pid"), "utf8"), recordText, "the record is not completed from a port or a pid alone");
});

test("a record is completed only when the listener's start time is the same before and after its second answer", async (t) => {
  const port = await freePort();
  const root = await stateFixture(t, port);
  const proxy = harmless(t);
  await identityListener(t, port, proxy.pid);
  const recordText = JSON.stringify({ pid: proxy.pid, startedMs: null, startedIso: null }) + "\n";
  writeFileSync(join(root, "logs", "proxy.pid"), recordText);
  // Every read gives another start time: the pid changed hands between the reads.
  let n = 0;
  const lifecycle = await lifecycleFor(root, { processStartMsImpl: () => Date.now() - 60_000 + (n++) * 1000 });
  assert.equal((await lifecycle.ensureRunning()).outcome, "already-running");
  assert.equal(readFileSync(join(root, "logs", "proxy.pid"), "utf8"), recordText, "not completed");
  assert.equal((await lifecycle.stop()).code, 4);
  assert.ok(untouched(proxy));
  // A stable start time: the same record is completed and the proxy is the verified one.
  const steady = Date.now() - 60_000;
  const proven = await lifecycleFor(root, { processStartMsImpl: () => steady });
  assert.equal((await proven.ensureRunning()).outcome, "already-running");
  assert.deepEqual(readJson(join(root, "logs", "proxy.pid")), { pid: proxy.pid, startedMs: steady, startedIso: new Date(steady).toISOString() });
});

test("a spawn intent adopts only a proxy that started after it: an older listener is never recorded", async (t) => {
  const port = await freePort();
  const root = await stateFixture(t, port);
  const older = harmless(t);
  await identityListener(t, port, older.pid);
  const at = Date.now();
  const intent = JSON.stringify({ pid: null, startedMs: null, startedIso: null, spawning: { by: DEAD_PID, at } }) + "\n";
  writeFileSync(join(root, "logs", "proxy.pid"), intent);
  const lifecycle = await lifecycleFor(root, { processStartMsImpl: () => at - 60_000 });
  assert.equal((await lifecycle.ensureRunning()).outcome, "already-running");
  assert.equal(readFileSync(join(root, "logs", "proxy.pid"), "utf8"), intent, "an older listener is not adopted by the intent");
  // One that started after the intent is adopted.
  const adopted = await lifecycleFor(root, { processStartMsImpl: () => at + 50 });
  assert.equal((await adopted.ensureRunning()).outcome, "already-running");
  assert.equal(readJson(join(root, "logs", "proxy.pid")).pid, older.pid);
  assert.ok(untouched(older));
});

test("a start waiting on a live holder takes the lock over once that holder dies mid-start, and ends with one proxy", { timeout: 180_000 }, async (t) => {
  const port = await freePort();
  const root = await stateFixture(t, port, { kit: true });
  defer(root, () => killFixtureProxies(root));
  const env = childEnv(root, { ZCODE_KIT_BUN: bunOrFail() });
  // The holder hangs before its spawn, then dies (a harness closed mid-start).
  const holder = spawn(process.execPath, [STARTER, JSON.stringify({ kitRoot: root, root, killAt: "spawn:intent-recorded", pauseMs: 3000 })], { env, stdio: ["ignore", "pipe", "pipe"] });
  let holderErr = "";
  await new Promise((resolveUp) => holder.stderr.on("data", (b) => { holderErr += b; if (holderErr.includes("paused ")) resolveUp(); }));
  // A second start meets the live holder's lock and waits.
  const { createLifecycle } = await import(pathToFileURL(join(root, "lib", "proxy-lifecycle.mjs")).href);
  const savedBun = process.env.ZCODE_KIT_BUN;
  process.env.ZCODE_KIT_BUN = env.ZCODE_KIT_BUN;
  let waiter;
  try { waiter = await createLifecycle({ root, home: join(root, "home"), pendingSpawnWaitMs: 1000 }).ensureRunning({ waitMs: 30_000 }); }
  finally { if (savedBun === undefined) delete process.env.ZCODE_KIT_BUN; else process.env.ZCODE_KIT_BUN = savedBun; }
  await new Promise((r) => (holder.exitCode !== null || holder.signalCode !== null ? r() : holder.once("exit", r)));
  assert.equal(waiter.lines[0], "another start is in progress — waiting for it to finish");
  assert.deepEqual({ code: waiter.code, outcome: waiter.outcome }, { code: 0, outcome: "started" }, waiter.lines.join("\n"));
  assert.equal(liveProxies(root).length, 1);
  assert.equal(readJson(join(root, "logs", "proxy.pid")).pid, liveProxies(root)[0]);
  assert.deepEqual(lockFiles(root), []);
});
