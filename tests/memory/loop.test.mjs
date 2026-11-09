// The memory loop at process level (seam 1): the sampler finds every process
// carrying the run marker — including a detached child its parent left
// behind — and writes the CSV schema the verdict and reverdict read; the
// entry point refuses to run outside a capped, isolated run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSamplesCsv, roleOf, scan, startSampler, survivors } from "./lib/sampler.mjs";
import { chooseCap, commandFor, parseJobReport } from "./lib/caps.mjs";
import { generateOmpExtension, startOmpHost } from "./lib/omp-host.mjs";
import { causeLinesOf } from "./lib/omp-leg.mjs";
import { OMP_FLOOR } from "./lib/budgets.mjs";
import { floorMeasurement, floorVerdict } from "./lib/repetitions.mjs";
import { PREFLIGHT_WARNINGS } from "../../cli/heal.mjs";
import { resolveBun } from "../../lib/process.mjs";
import { ROUNDS, runEvidence } from "./lib/completeness.mjs";
import { isolatedConfig, KIT_ROOT } from "./lib/isolated-kit.mjs";
import { freezeProcess, killProcess, thawProcess, whileFrozen } from "./lib/freeze.mjs";
import { identityOf, isSameProcess, linuxStart, parseWindowsStart, startOf } from "./lib/process-identity.mjs";
import * as s3Scenario from "./scenarios/s3-concurrency.mjs";
const { makeHungRound } = s3Scenario;
const refusedStartCheck = (rounds) => s3Scenario.refusedStartCheck(rounds);

// The /proc sampler's own tests (Windows has its own below and in win-sampler.test.mjs).
const linuxOnly = { skip: process.platform === "linux" ? false : `Linux /proc sampler (platform ${process.platform})` };
const windowsOnly = { skip: process.platform === "win32" ? false : "live Windows sampler self-test (windows-latest legs)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("a solver process is its own role, whatever runtime starts it", () => {
  assert.equal(roleOf(["/usr/bin/bun", "/kit/zcode-proxy-src/src/proxy/captcha-solver-child.ts"]), "solver");
  assert.equal(roleOf(["/kit/zcode-proxy", "captcha-solver"]), "solver");
  assert.equal(roleOf(["/usr/bin/bun", "/kit/zcode-proxy-src/src/index.ts", "serve"]), "proxy");
});

test("samples.csv keeps its columns and appends commit_kb, empty on Linux", linuxOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-sampler-"));
  const marker = `ZCODE_MEMLOOP_RUN=sampler-test-${process.pid}`;
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 3000)"], { env: { ...process.env, ZCODE_MEMLOOP_RUN: marker.split("=")[1] }, stdio: "ignore" });
  try {
    const sampler = startSampler({ marker, csvPath: join(dir, "samples.csv"), intervalMs: 200, progress: () => 7 });
    await sleep(700);
    const rows = await sampler.stop();
    const text = readFileSync(join(dir, "samples.csv"), "utf8");
    // commit_kb (ticket 02) and ws_peak_kb (Round 7 Q1) are additive and empty on Linux.
    assert.equal(text.split("\n")[0], "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd,commit_kb,ws_peak_kb");
    const parsed = parseSamplesCsv(text).filter((r) => r.pid === child.pid);
    assert.ok(parsed.length >= 2, "the marked child is sampled");
    assert.equal(parsed[0].commitKb, null);
    assert.equal(parsed[0].wsPeakKb, null);
    assert.ok(parsed[0].rssKb > 0 && parsed[0].hwmKb >= parsed[0].rssKb);
    assert.equal(parsed[0].ppid, process.pid);
    assert.equal(parsed[0].progress, 7);
    assert.ok(rows.some((r) => r.procs.some((p) => p.pid === child.pid)));
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

// A process sampled between fork and exec still shows its parent's argv; pid
// and start time survive the exec. Ticket 02 round 7, local S3/hung: the start
// lock holder (`node cli/heal.mjs`) was killed inside spawn(), its proxy was
// first sampled before its exec and stayed role "preflight" for all 475
// samples, so the run had no proxy at all. The role follows the exec.
test("a marked process is re-attributed after it execs (a proxy first seen before its exec is a proxy)", linuxOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-exec-"));
  const marker = `ZCODE_MEMLOOP_RUN=exec-test-${process.pid}`;
  const entry = join(dir, "zcode-proxy-src", "src", "index.ts");
  mkdirSync(dirname(entry), { recursive: true });
  writeFileSync(entry, "setTimeout(() => {}, 30000);\n");
  // `sh pre-exec.sh` first (role other), then the same pid execs into a proxy
  // command line. Ticket 64: every step waits on the event it needs (sampled as
  // sh, the exec seen in /proc, two ticks after it), never on a time window.
  const preExec = join(dir, "pre-exec.sh");
  writeFileSync(preExec, `read go\nexec "${process.execPath}" "${entry}" serve\n`);
  const child = spawn("/bin/sh", [preExec], { env: { ...process.env, ZCODE_MEMLOOP_RUN: marker.split("=")[1] }, stdio: ["pipe", "ignore", "ignore"] });
  const until = async (what, ok, ms = 20_000) => {
    for (const end = Date.now() + ms; !ok(); await sleep(20)) if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
  };
  const execd = () => { try { return /index\.ts\0serve\0/.test(readFileSync(`/proc/${child.pid}/cmdline`, "utf8")); } catch { return false; } };
  try {
    const sampler = startSampler({ marker, csvPath: join(dir, "samples.csv"), intervalMs: 100 });
    const rolesNow = () => sampler.rows.flatMap((r) => r.procs.filter((p) => p.pid === child.pid).map((p) => p.role));
    await until("a sample of the child as sh", () => rolesNow().length > 0);
    child.stdin.end("go\n");
    await until("the exec", execd);
    const seenAtExec = sampler.rows.length;
    await until("two samples after the exec", () => sampler.rows.length >= seenAtExec + 2);
    const rows = await sampler.stop();
    const roles = rows.flatMap((r) => r.procs.filter((p) => p.pid === child.pid).map((p) => p.role));
    assert.equal(roles[0], "other", `first seen as sh: ${roles}`);
    assert.equal(roles.at(-1), "proxy", `after its exec: ${roles}`);
    const csv = parseSamplesCsv(readFileSync(join(dir, "samples.csv"), "utf8")).filter((r) => r.pid === child.pid);
    assert.equal(csv.at(-1).role, "proxy");
    assert.match(csv.at(-1).cmd, /index\.ts serve/);
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

// A fake /proc for the exec window (ticket 64): one directory per pid, the
// files the sampler reads. `stat` carries the pid's start time (field 22),
// which survives the exec, and its flags (field 9; PF_KTHREAD = 0x200000).
function fakeProc() {
  const root = mkdtempSync(join(tmpdir(), "memloop-fakeproc-"));
  return {
    root,
    set(pid, { cmdline, environ, starttime = 4711, flags = 0x400000, state = "S" }) {
      const d = join(root, String(pid));
      mkdirSync(join(d, "fd"), { recursive: true });
      const fields = [state, 1, pid, pid, 0, -1, flags, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 1, 0, starttime, 1000, 100];
      writeFileSync(join(d, "stat"), `${pid} (sh) ${fields.join(" ")}\n`);
      writeFileSync(join(d, "cmdline"), cmdline.length ? `${cmdline.join("\0")}\0` : "");
      writeFileSync(join(d, "environ"), environ.length ? `${environ.join("\0")}\0` : "");
      writeFileSync(join(d, "status"), "VmHWM:\t2048 kB\nVmRSS:\t1024 kB\nThreads:\t1\n");
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

// Ticket 64 (CI run 42391052837: "after its exec: other,other,other,other,other,other").
// Between installing the new address space and setting its arguments, an exec
// shows /proc/<pid>/cmdline and /proc/<pid>/environ as 0 bytes (fs/proc/base.c
// returns 0 while mm->env_end is unset). A sample taken in that window found no
// marker and cached the pid as not ours for good: the exec'd proxy vanished from
// the run, which is ticket 02 round 7's "role proxy never seen" again.
test("a marked process sampled inside its exec is read again after it, not dropped as not ours", linuxOnly, () => {
  const proc = fakeProc();
  const marker = "ZCODE_MEMLOOP_RUN=exec-window";
  const env = ["PATH=/usr/bin", marker];
  const proxyArgv = ["/usr/bin/node", "/kit/zcode-proxy-src/src/index.ts", "serve"];
  try {
    const cache = new Map();
    const rolesOf = (pid) => scan(marker, cache, { procRoot: proc.root }).filter((p) => p.pid === pid).map((p) => p.role);
    proc.set(4242, { cmdline: ["/bin/sh", "/tmp/pre-exec.sh"], environ: env });
    assert.deepEqual(rolesOf(4242), ["other"], "before the exec: sh");
    proc.set(4242, { cmdline: [], environ: [] });
    assert.deepEqual(rolesOf(4242), [], "inside the exec: no sample (nothing to attribute yet)");
    assert.deepEqual(rolesOf(4242), [], "still inside the exec on the next tick");
    proc.set(4242, { cmdline: proxyArgv, environ: env });
    assert.deepEqual(rolesOf(4242), ["proxy"], "after the exec: the same pid is a proxy");

    // First seen inside its exec (spawned between two ticks): picked up after it.
    proc.set(4343, { cmdline: [], environ: [], starttime: 5000 });
    assert.deepEqual(rolesOf(4343), []);
    proc.set(4343, { cmdline: proxyArgv, environ: env, starttime: 5000 });
    assert.deepEqual(rolesOf(4343), ["proxy"], "a pid first seen inside its exec is ours once the exec is done");
  } finally { proc.cleanup(); }
});

test("the exec window never makes a process ours: an exec without the marker, a kernel thread and a stranger stay out", linuxOnly, () => {
  const proc = fakeProc();
  const marker = "ZCODE_MEMLOOP_RUN=exec-window-out";
  const proxyArgv = ["/usr/bin/node", "/kit/zcode-proxy-src/src/index.ts", "serve"];
  try {
    const cache = new Map();
    const pids = () => scan(marker, cache, { procRoot: proc.root }).map((p) => p.pid).sort((a, b) => a - b);
    proc.set(10, { cmdline: ["/bin/sh", "x.sh"], environ: [marker] });          // ours, later execs into a clean environment
    proc.set(11, { cmdline: [], environ: [], flags: 0x00208040 });               // a kernel thread (PF_KTHREAD)
    proc.set(12, { cmdline: ["/usr/bin/other"], environ: ["PATH=/usr/bin"] }); // a stranger
    assert.deepEqual(pids(), [10]);
    proc.set(10, { cmdline: [], environ: [] });
    proc.set(12, { cmdline: [], environ: [] });
    assert.deepEqual(pids(), []);
    proc.set(10, { cmdline: proxyArgv, environ: ["PATH=/usr/bin"] });
    proc.set(12, { cmdline: proxyArgv, environ: [marker] }); // cached as not ours: a fork inherits its parent's environment
    assert.deepEqual(pids(), [], "an exec that drops the marker is not ours; a stranger stays a stranger");
  } finally { proc.cleanup(); }
});

// The entry point refuses to run any scenario outside a capped, isolated run.
const RUN = join(dirname(fileURLToPath(import.meta.url)), "run.mjs");
function runLoop(args, env) {
  const clean = { ...process.env };
  delete clean.ZCODE_OVERHAUL_RUN;
  delete clean.ZCODE_MEMLOOP_ALLOW;
  return spawnSync(process.execPath, [RUN, ...args], { env: { ...clean, ...env }, encoding: "utf8", timeout: 30_000 });
}

test("run.mjs refuses every scenario without ZCODE_OVERHAUL_RUN=1 or ZCODE_MEMLOOP_ALLOW=1 (exit 2, nothing started)", () => {
  const out = mkdtempSync(join(tmpdir(), "memloop-guard-"));
  try {
    for (const scenario of ["S2", "S5", "S6"]) {
      const r = runLoop([scenario, "--out", out], { HOME: out });
      assert.equal(r.status, 2, `${scenario}: ${r.stderr}`);
      assert.match(r.stderr, /refuses to run outside a capped run/);
    }
    assert.deepEqual(readdirSync(out), []);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("run.mjs refuses the real home directory as HOME inside a capped run", () => {
  const out = mkdtempSync(join(tmpdir(), "memloop-guard-"));
  try {
    const r = runLoop(["S6", "--out", out], { ZCODE_OVERHAUL_RUN: "1", HOME: userInfo().homedir });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /isolated HOME/);
    assert.deepEqual(readdirSync(out), []);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("run.mjs rejects an unknown scenario or variant with exit 2", () => {
  assert.equal(runLoop(["S9"], { ZCODE_OVERHAUL_RUN: "1" }).status, 2);
  const r = runLoop(["S1", "--variant", "burst99"], { ZCODE_OVERHAUL_RUN: "1" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /variants of S1: .*burst16/);
});

const JOB_ENTRY = join(dirname(fileURLToPath(import.meta.url)), "job.mjs");
function runJob(args, env) {
  const clean = { ...process.env };
  delete clean.ZCODE_OVERHAUL_RUN;
  delete clean.ZCODE_MEMLOOP_ALLOW;
  return spawnSync(process.execPath, [JOB_ENTRY, ...args], { env: { ...clean, ...env }, encoding: "utf8", timeout: 30_000 });
}

test("job.mjs refuses to start outside a capped run, before any scenario runs", () => {
  const out = mkdtempSync(join(tmpdir(), "memloop-job-"));
  try {
    const r = runJob(["--os", "linux", "--out", join(out, "job"), "--cap", "none"], { HOME: out });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /refuses to run outside a capped run/);
    assert.deepEqual(readdirSync(out), []);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("job.mjs rejects a run that is not part of the leg's job", () => {
  const r = runJob(["--os", "linux", "--only", "S2/gc", "--cap", "none"], { ZCODE_OVERHAUL_RUN: "1" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /S2\/gc is not a run of the linux job/);
});

test("a detached child whose parent exited is still found as a survivor", linuxOnly, async () => {
  const marker = `ZCODE_MEMLOOP_RUN=orphan-test-${process.pid}`;
  // The parent starts a detached grandchild and exits at once; the grandchild
  // is reparented and keeps the marker in its environment.
  const parent = spawn(process.execPath, ["-e", `const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { detached: true, stdio: "ignore" }); console.log(c.pid); c.unref();`], { env: { ...process.env, ZCODE_MEMLOOP_RUN: marker.split("=")[1] }, stdio: ["ignore", "pipe", "inherit"] });
  let out = "";
  parent.stdout.on("data", (b) => { out += b; });
  await new Promise((r) => parent.on("close", r));
  const orphanPid = Number(out.trim());
  // Its identity while it surely runs (it sleeps 20 s): the cleanup kills that
  // process, never whatever holds its pid by then (ticket 73).
  let orphan = null;
  try {
    orphan = identityOf(orphanPid);
    await sleep(100);
    const found = survivors(marker);
    assert.deepEqual(found.map((s) => s.pid), [orphanPid]);
    assert.notEqual(found[0].ppid, parent.pid);
  } finally {
    if (orphan) try { killProcess(orphan); } catch {}
  }
});

// ── The windows leg's cap (ticket 02): a Job Object per run ─────────────────
test("on Windows the job caps every run with a Job Object (job memory + kill-on-close) and its own timeout", () => {
  assert.deepEqual(chooseCap("auto", { platform: "win32" }), { cap: "jobobject" });
  const c = commandFor("jobobject", "3G", 1200, ["S1", "--profile", "short"], { node: "C:\\node\\node.exe", runScript: "D:\\kit\\tests\\memory\\run.mjs" });
  assert.equal(c.argv[0], "powershell.exe");
  assert.deepEqual(c.argv.slice(1, 7), ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-ExecutionPolicy", "Bypass"]);
  assert.equal(c.timeoutMs, 1230 * 1000, "timeout plus the 30 s kill-after the Linux leg gives `timeout`");
  const script = Buffer.from(c.argv.at(-1), "base64").toString("utf16le");
  assert.match(script, /\b3221225472\b/, "3G in bytes");
  assert.match(script, /'C:\\node\\node\.exe'/);
  assert.match(script, /'D:\\kit\\tests\\memory\\run\.mjs', 'S1', '--profile', 'short'/);
});

test("the Linux caps are unchanged: systemd scope or prlimit around timeout --kill-after=30", () => {
  const args = ["S1", "--profile", "short"];
  const s = commandFor("systemd", "3G", 1200, args, { node: "/usr/bin/node", runScript: "/kit/run.mjs" });
  assert.deepEqual(s, { argv: ["systemd-run", "--user", "--scope", "--quiet", "-p", "MemoryMax=3G", "-p", "MemorySwapMax=0", "--", "timeout", "--kill-after=30", "1200", "/usr/bin/node", "/kit/run.mjs", ...args], timeoutMs: null });
  const p = commandFor("prlimit", "3G", 1200, args, { node: "/usr/bin/node", runScript: "/kit/run.mjs" });
  assert.deepEqual(p.argv.slice(0, 3), ["prlimit", `--as=${6 * 1024 ** 3}`, "--"]);
});

test("the Job Object wrapper's report says whether the cap was applied and how close the run came to it", () => {
  assert.deepEqual(parseJobReport("noise\n@@JOB applied=1 limit=3221225472 peak=1610612736\n"), { applied: true, limitBytes: 3221225472, peakBytes: 1610612736 });
  assert.deepEqual(parseJobReport("@@JOB applied=0 error=AssignProcessToJobObject failed (5)\n"), { applied: false, error: "AssignProcessToJobObject failed (5)" });
  assert.equal(parseJobReport("no report"), null);
});

// ── Process identity: pid + start time (ticket 72) ──────────────────────────
// A check that holds no handle on a process asks for that process, not its pid:
// Windows reuses a freed pid quickly (ticket 70), so a stranger at the same pid
// must neither keep a dead process "alive" nor stand in for a live one.
test("a process identity is its pid and start time: a stranger at the same pid is not it, a gone pid is not it", () => {
  const proc = mkdtempSync(join(tmpdir(), "memloop-identity-"));
  const stat = (start) => `4242 (node -e x) S 1 4242 4242 0 -1 4194304 ${Array(12).fill(0).join(" ")} ${start} 0 0\n`;
  try {
    mkdirSync(join(proc, "4242"));
    writeFileSync(join(proc, "4242", "stat"), stat(1000));
    const opts = { platform: "linux", procRoot: proc };
    const id = identityOf(4242, opts);
    assert.deepEqual(id, { pid: 4242, start: "1000" });
    assert.equal(isSameProcess(id, opts), true);
    writeFileSync(join(proc, "4242", "stat"), stat(5242)); // the pid now names a later process
    assert.equal(isSameProcess(id, opts), false, "a reused pid is another process");
    rmSync(join(proc, "4242"), { recursive: true });
    assert.equal(startOf(4242, opts), null);
    assert.equal(isSameProcess(id, opts), false, "a gone pid is not the process");
    assert.throws(() => identityOf(4242, opts), /no process to identify/, "an identity is recorded only while the process runs");
  } finally { rmSync(proc, { recursive: true, force: true }); }
});

test("an unknown start time is never taken for a gone process", () => {
  assert.throws(() => linuxStart(4242, "4242 (x) S 1\n"), /start time of pid 4242 unknown/);
  assert.equal(parseWindowsStart(4242, { status: 0, stdout: "NONE" }), null);
  assert.equal(parseWindowsStart(4242, { status: 0, stdout: "START 134070000170000000" }), "134070000170000000");
  // PowerShell that failed, timed out (status null) or printed nothing says nothing about the process.
  for (const r of [{ status: 1, stdout: "", stderr: "Get-CimInstance : Access denied" }, { status: null, stdout: "" }, { status: 0, stdout: "" }]) {
    assert.throws(() => parseWindowsStart(4242, r), /start time of pid 4242 unknown/, JSON.stringify(r));
  }
});

test("a live child keeps its identity until it exits, then no process is it", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  try {
    await new Promise((r) => child.once("spawn", r));
    const id = identityOf(child.pid);
    assert.equal(isSameProcess(id), true);
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGKILL");
    await exited; // reaped: from here on the pid is free for anyone
    assert.equal(isSameProcess(id), false);
  } finally { try { child.kill("SIGKILL"); } catch {} }
});

// ── Live Windows self-tests (spec §1; run on the windows-latest legs) ───────
const waitFor = async (fn, ms = 15_000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v || Date.now() > end) return v; await sleep(250); } };

test("Windows: the units self-test against Get-Process PrivateMemorySize64 passes on the live process table", windowsOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-units-"));
  let sampler;
  try {
    sampler = startSampler({ marker: `ZCODE_MEMLOOP_RUN=units-${process.pid}`, csvPath: join(dir, "samples.csv") });
    const ready = await sampler.ready;
    await sampler.stop();
    assert.equal(ready.units.ok, true, ready.units.reason);
    assert.ok(ready.units.compared >= 5, `compared ${ready.units.compared}`);
  } finally { await sampler?.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test("Windows: a deliberately orphaned detached process is found, by the run token and through a parent seen earlier", windowsOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-orphan-"));
  const id = `orphan-${process.pid}-${Date.now()}`;
  const marker = `ZCODE_MEMLOOP_RUN=${id}`;
  const orphans = []; // identities, recorded while each orphan surely runs (it sleeps 30 s)
  let sampler;
  // The parent starts a detached grandchild and exits; `token` puts the run id in the grandchild's command line.
  const orphanVia = async (token, parentLivesMs) => {
    const code = `const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", ${token ? JSON.stringify(id) : '"no-token"'}], { detached: true, stdio: "ignore" }); console.log(c.pid); c.unref(); setTimeout(() => process.exit(0), ${parentLivesMs});`;
    const parent = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    parent.stdout.on("data", (b) => { out += b; });
    await new Promise((r) => parent.on("close", r));
    orphans.push(identityOf(Number(out.trim())));
    return { orphan: Number(out.trim()), parent: parent.pid };
  };
  try {
    sampler = startSampler({ marker, csvPath: join(dir, "samples.csv"), intervalMs: 500 });
    await sampler.ready;
    const byToken = await orphanVia(true, 0); // parent gone before any poll could see it
    const byTree = await orphanVia(false, 3000); // parent seen by the polls, grandchild without the token
    const found = await waitFor(() => { const s = scan(marker).map((p) => p.pid); return s.includes(byToken.orphan) && s.includes(byTree.orphan) ? s : null; });
    assert.ok(found, "both orphans in the live scan");
    await sampler.stop();
    const after = survivors(marker).filter((s) => !/^conhost\.exe$/i.test(s.comm ?? ""));
    assert.deepEqual(after.map((s) => s.pid).sort((a, b) => a - b), [byToken.orphan, byTree.orphan].sort((a, b) => a - b), "a fresh poll after stop still finds both, and nothing else");
    assert.equal(after.find((s) => s.pid === byTree.orphan).ppid, byTree.parent, "Windows keeps the dead parent's pid");
    // The cleanup kills each orphan by its identity (TerminateProcess under a held handle, ticket 73).
    while (orphans.length) { assert.equal(killProcess(orphans[0]), true, `orphan ${orphans[0].pid} is still itself and is terminated`); orphans.shift(); }
  } finally {
    await sampler?.stop();
    for (const o of orphans) { try { killProcess(o); } catch {} }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Windows: the sampler excludes its own poller by pid and records the poller's overhead", windowsOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-win-self-"));
  let sampler;
  try {
    sampler = startSampler({ marker: `ZCODE_MEMLOOP_RUN=self-${process.pid}`, csvPath: join(dir, "samples.csv"), intervalMs: 500 });
    await sampler.ready;
    await sleep(2500);
    const pollerPid = sampler.pollerPid;
    const seen = scan(`ZCODE_MEMLOOP_RUN=self-${process.pid}`).map((p) => p.pid);
    const rows = await sampler.stop();
    const o = sampler.overhead();
    assert.ok(!seen.includes(pollerPid) && rows.every((r) => r.procs.every((p) => p.pid !== pollerPid)), "the poller is never sampled");
    assert.equal(o.pid, pollerPid);
    assert.ok(o.polls >= 2 && o.peakCommitKb > 0 && o.peakRssKb > 0 && o.pollMsMax > 0, JSON.stringify(o));
    assert.equal(sampler.pollerRunning(), false, "the poller is reaped on stop (asked of its handle, not its pid)");
  } finally { await sampler?.stop(); rmSync(dir, { recursive: true, force: true }); }
});

const PROBE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "win32", "job-probe.mjs");
const runCapped = (size, args, timeoutS = 60) => {
  const { argv } = commandFor("jobobject", size, timeoutS, args, { runScript: PROBE });
  return spawnSync(argv[0], argv.slice(1), { encoding: "utf8", timeout: 120_000 });
};

test("Windows: the Job Object cap is applied and read back, and an allocation past it fails", windowsOnly, () => {
  const ok = runCapped("1G", ["alloc", "256"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const rep = parseJobReport(ok.stderr);
  assert.equal(rep.applied, true, ok.stderr);
  assert.equal(rep.limitBytes, 1024 ** 3);
  assert.ok(rep.peakBytes >= 256 * 1048576, `peak ${rep.peakBytes}`);
  const over = runCapped("1G", ["alloc", "2048"]);
  assert.notEqual(over.status, 0, "2 GB inside a 1 GB job cannot succeed");
  assert.doesNotMatch(over.stdout, /ALLOC_OK/);
});

test("Windows: closing the Job Object kills a detached grandchild (nothing escapes the cap)", windowsOnly, async () => {
  const r = runCapped("1G", ["detach"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // The probe prints the grandchild's identity (pid + start time), taken while
  // it ran: the job kills it before this test could ask, and its freed pid may
  // already name a stranger (ticket 72).
  const m = r.stdout.match(/GRANDCHILD (\d+) (\d+)/);
  assert.ok(m, r.stdout);
  const grandchild = { pid: Number(m[1]), start: m[2] };
  // Each ask is one PowerShell (~1-3 s cold on a runner): 20 s, not 10.
  const gone = await waitFor(() => !isSameProcess(grandchild), 20_000);
  if (!gone && isSameProcess(grandchild)) { try { process.kill(grandchild.pid, "SIGKILL"); } catch {} }
  assert.ok(gone, "the grandchild died with the job");
});

// ── S3 OMP leg: the stub Bun host runs the generated extension (ticket 03) ──
const KIT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The promise's value, or `fallback` after `ms`; the timer never outlives the race. */
const within = (promise, ms, fallback) => { let t; return Promise.race([promise, new Promise((r) => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t)); };
/** A kit root whose preflight is a fixture script; the extension is generated from the real template by the OMP adapter. */
function ompFixture(healSource) {
  const dir = mkdtempSync(join(tmpdir(), "memloop-omp-host-"));
  const root = join(dir, "kit");
  mkdirSync(join(root, "cli"), { recursive: true });
  mkdirSync(join(root, "proxy"), { recursive: true });
  copyFileSync(join(KIT, "proxy", "zcode-proxy-autostart.ts"), join(root, "proxy", "zcode-proxy-autostart.ts"));
  writeFileSync(join(root, "cli", "heal.mjs"), healSource);
  const keyFile = join(dir, ".proxykey");
  writeFileSync(keyFile, "synthetic-omp-host-key\n");
  const extension = generateOmpExtension({ root, home: join(dir, "home"), keyFile, port: 19031 });
  return { dir, root, extension };
}

test("the stub OMP host runs the generated extension once, prints its cause lines, reports its own cost and exits with its loop", async () => {
  const f = ompFixture(`
    import { appendFileSync } from "node:fs";
    appendFileSync("attempts", String(process.ppid) + "\\n");
    console.error("[zcode-preflight] cause=quota-unavailable");
    console.error("Bearer SECRET not a cause line");
  `);
  const host = startOmpHost({ bun: resolveBun(KIT), extension: f.extension, env: { ...process.env } });
  try {
    const ready = await host.ready;
    assert.ok(ready && ready.baselineMB > 0, host.stderr());
    assert.equal(ready.pid, host.pid);
    host.go();
    const done = await host.done;
    assert.ok(done, host.stderr());
    assert.equal(typeof done.costMB, "number");
    assert.ok(done.costMB >= 0 && done.peakMB >= done.baselineMB);
    assert.equal(done.metric, process.platform === "win32" ? "commit" : "rss");
    // Windows reports the working-set delta beside the commit gate; Linux has one metric.
    if (process.platform === "win32") assert.ok(typeof done.wsCostMB === "number" && done.wsCostMB >= 0, JSON.stringify(done));
    else assert.equal(done.wsCostMB, undefined);
    assert.deepEqual(causeLinesOf(host.stderr(), PREFLIGHT_WARNINGS), [`[zcode-autostart] quota-unavailable: ${PREFLIGHT_WARNINGS["quota-unavailable"]}`]);
    assert.doesNotMatch(host.stderr(), /SECRET/);
    assert.deepEqual(readFileSync(join(f.root, "attempts"), "utf8").trim().split("\n"), [String(host.pid)], "one preflight, spawned by the host itself");
    host.close();
    const exit = await within(host.exited, 10_000, "still running");
    assert.deepEqual(exit, { code: 0, signal: null });
  } finally {
    host.killTree();
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("killing a starter host takes its running preflight with it (the killed-starter adversary)", async () => {
  const f = ompFixture(`
    import { writeFileSync } from "node:fs";
    writeFileSync("preflight.pid", String(process.pid));
    setTimeout(() => {}, 30_000);
  `);
  const host = startOmpHost({ bun: resolveBun(KIT), extension: f.extension, env: { ...process.env } });
  let preflightPid = null;
  let preflight = null; // its identity (pid + start time): this test holds no handle on the host's child
  try {
    assert.ok(await host.ready, host.stderr());
    host.go();
    for (let i = 0; i < 200 && preflightPid === null; i++) {
      try { preflightPid = Number(readFileSync(join(f.root, "preflight.pid"), "utf8")) || null; } catch {}
      if (preflightPid === null) await sleep(50);
    }
    assert.ok(preflightPid, "the host spawned its preflight");
    preflight = identityOf(preflightPid); // it waits 30 s: surely running now
    host.killTree();
    await within(host.exited, 10_000);
    // Gone = no longer that process: a stranger given its freed pid is not it (ticket 72).
    const gone = await waitFor(() => !isSameProcess(preflight), 10_000);
    assert.equal(host.running(), false, "the host is gone");
    assert.equal(gone, true, "its preflight is gone too");
  } finally {
    host.killTree();
    if (preflight && isSameProcess(preflight)) { try { process.kill(preflight.pid, "SIGKILL"); } catch {} }
    rmSync(f.dir, { recursive: true, force: true });
  }
});

/** One fresh stub host charged for a hook that does nothing: its OMP_HOST_DONE line ({ costMB, … }). */
async function noopHostCost(extension) {
  const host = startOmpHost({ bun: resolveBun(KIT), extension, env: { ...process.env } });
  try {
    assert.ok(await host.ready, host.stderr());
    host.go();
    const done = await host.done;
    assert.ok(done, host.stderr());
    return done;
  } finally {
    host.close();
    if ((await within(host.exited, 10_000, "running")) === "running") host.killTree();
  }
}

// The floor measurement mode (Round 17 Q4 condition 1), off by default: while
// the one-run marker tests/memory/measure-omp-floor exists (content: N, 1–50),
// the floor test below measures N fresh hosts instead of judging n, prints each
// value as an OMP_FLOOR_VALUE line (as every run does), adds an
// OMP_FLOOR_MEASURE_SUMMARY line and writes the reading to
// $GITHUB_STEP_SUMMARY. It runs in every `npm run test` leg (test-kit: ubuntu
// and windows × Node 24 and 26). The marker test fails while it exists, so it never merges.
const OMP_FLOOR_MARKER = join(KIT_ROOT, "tests", "memory", "measure-omp-floor");
function ompFloorMarker() {
  let text;
  try { text = readFileSync(OMP_FLOOR_MARKER, "utf8"); } catch { return null; }
  const count = Number(text.trim());
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error(`tests/memory/measure-omp-floor must hold a whole number from 1 to 50, got ${JSON.stringify(text.trim())}`);
  return count;
}

// Ticket 03's floor test, as Round 17 Q4 decided it: n fresh hosts (budgets.mjs
// OMP_FLOOR), the median no-op cost < 2.5 MB, every repetition < 5 MB, every value printed, pass or fail.
test("the stub OMP host charges a hook that does nothing well under the 5 MB waiter gate: median of n fresh hosts < 2.5 MB, every one < 5 MB (its own churn is in the baseline)", async (t) => {
  const measure = ompFloorMarker();
  const count = measure ?? OMP_FLOOR.n;
  const dir = mkdtempSync(join(tmpdir(), "memloop-omp-floor-"));
  const extension = join(dir, "noop-extension.ts");
  writeFileSync(extension, `export default function (pi) { pi.on("before_provider_request", async () => {}); }\n`);
  const os = process.platform === "win32" ? "windows" : "linux";
  const runs = [];
  try {
    for (let i = 1; i <= count; i++) {
      const done = await noopHostCost(extension);
      runs.push(done);
      t.diagnostic(`OMP_FLOOR_VALUE ${JSON.stringify({ os, node: process.version, rep: i, of: count, metric: done.metric, costMB: done.costMB, ...(done.wsCostMB !== undefined ? { wsCostMB: done.wsCostMB } : {}), baselineMB: done.baselineMB, peakMB: done.peakMB })}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const values = runs.map((d) => d.costMB);
  if (measure) {
    // Measurement only: the distribution, no verdict (a tail is what it records).
    const m = floorMeasurement(values, { thresholdMB: OMP_FLOOR.medianBelowMB, gateMB: OMP_FLOOR.everyBelowMB });
    const reading = { os, node: process.version, metric: runs[0]?.metric, requested: count, ...m, values, ...(runs.every((d) => d.wsCostMB !== undefined) ? { wsValues: runs.map((d) => d.wsCostMB) } : {}) };
    t.diagnostic(`OMP_FLOOR_MEASURE_SUMMARY ${JSON.stringify(reading)}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`## OMP no-op floor measurement (${os}, Node ${process.version}, ${count} fresh hosts, metric ${reading.metric})`, "",
        `Not a verdict (Round 17 Q4 condition 1). Value: the stub host's no-op cost (commit on Windows, RSS on Linux)${reading.wsValues ? "; working set beside it" : ""}.`, "",
        `- values (MB): ${values.join(", ")}`, ...(reading.wsValues ? [`- working set (MB): ${reading.wsValues.join(", ")}`] : []),
        `- min / median / max: ${m.minMB} / ${m.medianMB} / ${m.maxMB} MB; at or above ${OMP_FLOOR.medianBelowMB} MB: ${m.atOrAbove} of ${m.count} (p = ${m.p})`,
        `- predicted false-fail rate of the median clause: ${Object.entries(m.falseFailRate).map(([n, r]) => `n = ${n}: ${r}`).join(", ")}; smallest odd n at ≤ 1 %: ${m.n ?? "none"}`,
        ...(m.comesBack.length ? [`- comes back: ${m.comesBack.join("; ")}`] : []), "", ""].join("\n"));
    }
    assert.equal(m.count, count, "every host produced a numeric cost");
    return;
  }
  const v = floorVerdict(values, OMP_FLOOR);
  t.diagnostic(`OMP no-op floor (${os}, ${runs[0]?.metric}): ${values.join(", ")} MB; median ${v.medianMB} (< ${OMP_FLOOR.medianBelowMB}), every one < ${OMP_FLOOR.everyBelowMB}: ${v.ok ? "pass" : "FAIL"}`);
  assert.equal(v.error, null, v.error);
  // Half the gate for the median: a floor at the gate could not tell a waiter from noise.
  assert.ok(v.ok, `no-op hook charged ${values.join(", ")} MB over ${count} fresh hosts: ${v.failures.join("; ")}`);
});

test("the OMP floor measurement mode is off by default: the marker tests/memory/measure-omp-floor is not committed", () => {
  assert.equal(readdirSync(join(KIT_ROOT, "tests", "memory")).includes("measure-omp-floor"), false, "tests/memory/measure-omp-floor is a one-run switch: delete it before the pre-merge run");
});

// ── A run that never ran its scenario is a harness failure, never GREEN ──────
// CI run 42221794531 (windows): every run exited 0 after writing the CSV
// header, no summary, no sample, and the job called all 13 runs GREEN.
const FAKE_RUN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-run.mjs");
function fakeJob(mode, only = "S1/short", env = {}) {
  const home = mkdtempSync(join(tmpdir(), "memloop-fakejob-"));
  const r = runJob(["--os", "linux", "--only", only, "--cap", "none", "--out", join(home, "job"), "--run-script", FAKE_RUN], { ZCODE_OVERHAUL_RUN: "1", HOME: home, FAKE_RUN_MODE: mode, ...env });
  let report = null;
  try { report = JSON.parse(readFileSync(join(home, "job", "job-summary.json"), "utf8")); } catch {}
  rmSync(home, { recursive: true, force: true });
  return { r, report, row: report?.rows?.[0], result: report?.results?.[0] };
}

test("job: a run that exits 0 without a summary is a harness failure, not GREEN", () => {
  const { r, row, result } = fakeJob("exit0-nothing");
  assert.equal(row?.outcome, "HARNESS FAILURE", r.stdout + r.stderr);
  assert.match(result.error, /no summary\.json/);
  assert.equal(r.status, 1, "the ratchet fails on a harness failure");
});

test("job: a GREEN summary whose sampler saw no process of the scenario is a harness failure", () => {
  const { r, row, result } = fakeJob("green-empty");
  assert.equal(row?.outcome, "HARNESS FAILURE", r.stdout + r.stderr);
  assert.match(result.error, /samples/);
  assert.match(result.error, /role proxy never seen/);
  assert.match(result.error, /below the S1 floor/);
  assert.equal(r.status, 1);
});

test("job: a run with real evidence keeps its verdict", () => {
  const { r, row } = fakeJob("green-complete");
  assert.equal(row?.outcome, "GREEN", r.stdout + r.stderr);
  assert.equal(r.status, 0);
});

test("job: every memory check is reported with its commit and its working-set value and the gate (Round 7 Q1)", () => {
  const { r, result } = fakeJob("green-complete");
  assert.deepEqual(result?.memoryChecks, [{ name: "procPeak:proxy", red: false, gate: "ws", commitMB: 310, wsMB: 120, budget: 250 }], r.stdout + r.stderr);
  assert.match(r.stdout, /S1\/short procPeak:proxy: commit 310 \/ WS 120 MB \(budget 250, gate WS\) ok/);
});

test("run evidence: outcome and exit code must agree, and on Windows commit and a passed units self-test are required", () => {
  const ok = { key: "S7/short", platform: "linux", outcome: "RED", metric: "rss", durationS: 90, samples: 90, summary: { proxy: { maxCount: 1 } }, notes: { sampler: {} } };
  assert.deepEqual(runEvidence(ok, { key: "S7/short", exitCode: 1 }), { ok: true, problems: [] });
  assert.match(runEvidence(ok, { key: "S7/short", exitCode: 0 }).problems.join(), /outcome RED but exit 0/);
  assert.match(runEvidence(ok, { key: "S1/short", exitCode: 1 }).problems.join(), /summary is for S7\/short/);
  const win = { ...ok, platform: "win32", metric: "rss" };
  assert.match(runEvidence(win, { key: "S7/short", exitCode: 1 }).problems.join(), /no commit_kb/);
  const winCommit = { ...win, metric: "commit", notes: { sampler: { units: { ok: false } } } };
  assert.match(runEvidence(winCommit, { key: "S7/short", exitCode: 1 }).problems.join(), /units self-test did not pass/);
  assert.equal(runEvidence({ ...winCommit, notes: { sampler: { units: { ok: true } } } }, { key: "S7/short", exitCode: 1 }).ok, true);
  assert.equal(runEvidence(ok, { key: "S7/short", exitCode: 2 }).ok, true, "a harness failure needs no evidence: it is already a failure");
});

// ── Windows checkouts (CI run 42246379763) ───────────────────────────────────
test("the isolated config is the same from a CRLF checkout of the template (Windows autocrlf)", () => {
  const lf = readFileSync(join(KIT_ROOT, "proxy", "config.example.yaml"), "utf8").replace(/\r\n/g, "\n");
  const opts = { port: 19024, key: "fixture-key", mockUrl: "http://127.0.0.1:19025" };
  const fromLf = isolatedConfig({ ...opts, template: lf });
  const fromCrlf = isolatedConfig({ ...opts, template: lf.replace(/\n/g, "\r\n") });
  assert.equal(fromCrlf, fromLf);
  assert.match(fromCrlf, /^claim:\n  enabled: false\n  auto: false/m);
  assert.match(fromCrlf, /^  port: 19024$/m);
});

test("`--cap none` on Windows runs the run script directly under the job's own timeout (no GNU `timeout`)", () => {
  const args = ["S1", "--profile", "short"];
  assert.deepEqual(commandFor("none", "3G", 60, args, { node: "C:\\node.exe", runScript: "D:\\run.mjs", platform: "win32" }), { argv: ["C:\\node.exe", "D:\\run.mjs", ...args], timeoutMs: 90_000 });
  assert.deepEqual(commandFor("none", "3G", 60, args, { node: "/usr/bin/node", runScript: "/kit/run.mjs", platform: "linux" }), { argv: ["timeout", "--kill-after=30", "60", "/usr/bin/node", "/kit/run.mjs", ...args], timeoutMs: null });
});

// ── CI run 42252896054 (windows): S3/hung printed a complete RED verdict and
// was turned into a harness failure because no MCP bridge was seen — every
// launch failed on Windows, so no session ever started a bridge.
// A kill-holder round as ticket 16's scenario records it: the adversary's kill
// and exactly one launch on that pid that exited non-zero. A bare round name
// is no evidence the killed-holder case ran (Owner Proxy round 27 Q1 condition 2).
const KILL_HOLDER_ROUND = {
  name: "kill-holder-10", n: 10, adversary: { killed: 501, afterMs: 160 },
  launches: Array.from({ length: 10 }, (_, i) => ({ i, via: "preflight", pid: 500 + i, code: i === 1 ? null : 0, signal: i === 1 ? "SIGKILL" : null })),
};
const S3_HUNG_ROUNDS = [KILL_HOLDER_ROUND, { name: "hung-10-with-stale-lock" }, { name: "hung-10" }];
test("run evidence: S3 is proven by its proxy, launchers and preflights; a bridge exists only after a launch succeeds", () => {
  const s3 = (roles) => ({ key: "S3/hung", platform: "linux", outcome: "RED", metric: "rss", durationS: 150, samples: 500, summary: Object.fromEntries(roles.map((r) => [r, { maxCount: 1 }])), notes: { sampler: {}, rounds: S3_HUNG_ROUNDS } });
  assert.deepEqual(runEvidence(s3(["proxy", "launcher", "preflight"]), { key: "S3/hung", exitCode: 1 }), { ok: true, problems: [] });
  assert.match(runEvidence(s3(["proxy", "preflight"]), { key: "S3/hung", exitCode: 1 }).problems.join(), /role launcher never seen/);
});

// ── CI run 42281731448 (ubuntu): S3/hung skipped both hung rounds, ran 9 s and
// printed a RED verdict. A run that did not run its rounds stays a harness
// failure — through the job, and however long and busy the rest of it was.
const CI_S3_HUNG = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ci-42281731448-s3-hung-summary.json");

test("job: the S3/hung run of CI 42281731448 (hung rounds skipped, RED verdict) is a harness failure", () => {
  const { r, row, result } = fakeJob("replay", "S3/hung", { FAKE_RUN_SUMMARY: CI_S3_HUNG });
  assert.equal(row?.outcome, "HARNESS FAILURE", r.stdout + r.stderr);
  assert.match(result.error, /round hung-10-with-stale-lock skipped/);
  assert.match(result.error, /round hung-10 never ran/);
  assert.equal(r.status, 1, "the ratchet fails on a harness failure");
});

test("run evidence: an S3 round that was skipped or never ran fails the run, whatever its time and roles", () => {
  const busy = (notes) => ({ key: "S3/hung", platform: "linux", outcome: "RED", metric: "rss", durationS: 300, samples: 900, summary: { proxy: { maxCount: 1 }, launcher: { maxCount: 5 }, preflight: { maxCount: 9 } }, notes: { sampler: {}, ...notes } });
  assert.equal(runEvidence(busy({ rounds: S3_HUNG_ROUNDS }), { key: "S3/hung", exitCode: 1 }).ok, true);
  const skipped = runEvidence(busy({ rounds: S3_HUNG_ROUNDS.slice(0, 2), "hung-10.skipped": { startCode: 0, reason: "no pid record, 0 proxies of this run serve port 18457" } }), { key: "S3/hung", exitCode: 1 });
  assert.equal(skipped.ok, false);
  assert.match(skipped.problems.join(), /round hung-10 skipped: no pid record, 0 proxies/);
  // The pre-fix note was the bare start code (0): still a skip.
  assert.match(runEvidence(busy({ rounds: S3_HUNG_ROUNDS, "hung-10.skipped": 0 }), { key: "S3/hung", exitCode: 1 }).problems.join(), /round hung-10 skipped: manager start exited 0/);
  // No note at all, the round is simply missing.
  assert.match(runEvidence(busy({ rounds: S3_HUNG_ROUNDS.slice(0, 1) }), { key: "S3/hung", exitCode: 1 }).problems.join(), /round hung-10-with-stale-lock never ran.*round hung-10 never ran/);
  assert.match(runEvidence(busy({}), { key: "S3/hung", exitCode: 0 }).problems.join(), /round kill-holder-10 never ran/);
  // S3/short likewise needs its four short-profile rounds.
  const short = { ...busy({ rounds: [{ name: "race-5#0" }, { name: "race-10#0" }, { name: "race-10-preflight#0" }] }), key: "S3/short" };
  assert.match(runEvidence(short, { key: "S3/short", exitCode: 1 }).problems.join(), /round kill-holder-10 never ran/);
});

// ── S3/omp (ticket 03): no launcher ever runs, the run takes 10–12 s on Linux,
// and its proof is the stub hosts, their preflights and the proxy one of them
// started. Its own floor, never an exemption from the gate.
const S3_OMP_ROUNDS = [{ name: "omp-5" }, { name: "omp-5-kill-starter" }];
const s3omp = ({ roles = ["proxy", "preflight", "omp-host", "manager"], rounds = S3_OMP_ROUNDS, ...rest } = {}) => ({ key: "S3/omp", platform: "linux", outcome: "RED", metric: "rss", durationS: 10, samples: 28, summary: Object.fromEntries(roles.map((r) => [r, { maxCount: r === "omp-host" ? 5 : 1 }])), notes: { sampler: {}, rounds }, ...rest });

test("run evidence: S3/omp is proven by its hosts, their preflights, the proxy and both OMP rounds, not by launchers", () => {
  assert.deepEqual(runEvidence(s3omp(), { key: "S3/omp", exitCode: 1 }), { ok: true, problems: [] });
  assert.match(runEvidence(s3omp({ roles: ["proxy", "preflight"] }), { key: "S3/omp", exitCode: 1 }).problems.join(), /role omp-host never seen/);
  assert.match(runEvidence(s3omp({ roles: ["proxy", "omp-host"] }), { key: "S3/omp", exitCode: 1 }).problems.join(), /role preflight never seen/);
  assert.match(runEvidence(s3omp({ roles: ["preflight", "omp-host"] }), { key: "S3/omp", exitCode: 0 }).problems.join(), /role proxy never seen/);
  // The killed-starter round is the adversary: a run without it never ran its scenario.
  assert.match(runEvidence(s3omp({ rounds: S3_OMP_ROUNDS.slice(0, 1) }), { key: "S3/omp", exitCode: 1 }).problems.join(), /round omp-5-kill-starter never ran/);
  assert.match(runEvidence(s3omp({ rounds: [] }), { key: "S3/omp", exitCode: 0 }).problems.join(), /round omp-5 never ran/);
  // Half the shortest Linux run (10 s, 28 samples): a run that never started its hosts is below it.
  assert.match(runEvidence(s3omp({ durationS: 3, samples: 9 }), { key: "S3/omp", exitCode: 0 }).problems.join(), /9 samples \(need ≥ 14\).*ran 3 s, below the S3\/omp floor of 5 s/);
  // The other S3 runs keep the S3 floor: a launcher and 15 s.
  const shortRun = { ...s3omp({ rounds: [{ name: "race-5#0" }, { name: "race-10#0" }, { name: "race-10-preflight#0" }, { name: "kill-holder-10" }] }), key: "S3/short" };
  assert.match(runEvidence(shortRun, { key: "S3/short", exitCode: 1 }).problems.join(), /below the S3 floor of 15 s.*role launcher never seen/);
});

// A real S3/omp run on this branch (Linux, Bun 1.4.2, 2026-11-07): 5 OMP
// preflights at once in both rounds, every other check green. The integration
// tip's gate (the S3 floor) called it a harness failure: 12 s, no launcher.
const S3_OMP_RUN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "local-20261107-s3-omp-linux-summary.json");

test("job: a real S3/omp run passes the evidence gate and is the listed RED; without its killed-starter round it is a harness failure", () => {
  const { r, row, result } = fakeJob("replay", "S3/omp", { FAKE_RUN_SUMMARY: S3_OMP_RUN });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // Round 14 Q1 condition 2, Round 15 Q1: the row names the tolerated RED and the ticket that owns it.
  assert.deepEqual(row, { key: "S3/omp", outcome: "RED", ticket: "35, 37", owners: ["35", "37"], note: "S3/omp: RED on omp:concurrent-preflights, owned by ticket 35 (omp:concurrent-preflights)" });
  assert.deepEqual(result.redChecks, ["omp:concurrent-preflights"]);
  const dir = mkdtempSync(join(tmpdir(), "memloop-s3omp-"));
  try {
    const run = JSON.parse(readFileSync(S3_OMP_RUN, "utf8"));
    const cut = join(dir, "summary.json");
    writeFileSync(cut, JSON.stringify({ ...run, notes: { ...run.notes, rounds: run.notes.rounds.slice(0, 1) } }));
    const skipped = fakeJob("replay", "S3/omp", { FAKE_RUN_SUMMARY: cut });
    assert.equal(skipped.row?.outcome, "HARNESS FAILURE", skipped.r.stdout + skipped.r.stderr);
    assert.match(skipped.result.error, /round omp-5-kill-starter never ran/);
    assert.equal(skipped.r.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the S3/omp scenario runs exactly the rounds the evidence gate demands", async () => {
  const { OMP_ROUNDS } = await import("./scenarios/s3-concurrency.mjs");
  assert.deepEqual(Object.keys(OMP_ROUNDS), ROUNDS["S3/omp"]);
  assert.deepEqual(ROUNDS["S3/omp"], S3_OMP_ROUNDS.map((r) => r.name));
  assert.equal(OMP_ROUNDS["omp-5-kill-starter"].killStarter, true);
  assert.ok(!OMP_ROUNDS["omp-5"].killStarter);
});

// The loop freezes its own hung proxy (S3); whatever happens in between, it
// is thawed, and a thaw that fails makes the run a harness failure — a
// process the loop left frozen is never reported as a kit orphan.
test("whileFrozen thaws after the work, after a failing work, and a failed thaw fails the run", async () => {
  const calls = [];
  // Fake identities and primitives: nothing is asked of the host's process table.
  const freeze = (id) => { calls.push(`freeze ${id.pid}`); return true; };
  const thaw = (id) => { calls.push(`thaw ${id.pid}`); return true; };
  assert.equal(await whileFrozen({ pid: 7, start: "70" }, async () => { calls.push("work"); return 42; }, { freeze, thaw }), 42);
  await assert.rejects(whileFrozen({ pid: 8, start: "80" }, async () => { throw new Error("round failed"); }, { freeze, thaw }), /round failed/);
  assert.deepEqual(calls, ["freeze 7", "work", "thaw 7", "freeze 8", "thaw 8"]);
  await assert.rejects(whileFrozen({ pid: 9, start: "90" }, async () => 1, { freeze, thaw: () => { throw new Error("status 0xC000000B"); } }), /could not thaw pid 9 .*0xC000000B/);
});

// ── Freeze, thaw and kill by identity (ticket 73) ───────────────────────────
// The S3 hung proxy is named by its pid AND start time, as the run's scan saw
// it. Once it is gone its pid may name a stranger (Windows reuses pids quickly,
// tickets 70, 72): the stranger is never frozen, thawed or killed, and it
// neither fails the run (a refused resume) nor passes it.
/** A fake process table: pid → start time; `replace` hands a pid to a stranger, as Windows may at once. */
function fakeTable(entries) {
  const table = new Map(Object.entries(entries).map(([pid, start]) => [Number(pid), start]));
  const signals = [];
  return {
    signals,
    opts: { platform: "linux", start: (pid) => table.get(pid) ?? null, kill: (pid, sig) => { if (!table.has(pid)) throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" }); signals.push(`${sig} ${pid}:${table.get(pid)}`); } },
    exit: (pid) => table.delete(pid),
    replace: (pid, start) => table.set(pid, start),
  };
}

test("a process gone during the freeze is never thawed: neither when its pid is free nor when a stranger holds it", async () => {
  for (const after of ["free", "stranger"]) {
    const t = fakeTable({ 4242: "1000" });
    const id = { pid: 4242, start: "1000" };
    const r = await whileFrozen(id, async () => {
      t.exit(4242); // the kit's hung-own recovery killed it
      if (after === "stranger") t.replace(4242, "5000"); // and its pid already names another process
      return "round";
    }, { freeze: (x) => freezeProcess(x, t.opts), thaw: (x) => thawProcess(x, t.opts) });
    assert.equal(r, "round", `${after}: the round's result, no harness failure`);
    assert.deepEqual(t.signals, ["SIGSTOP 4242:1000"], `${after}: only our process was ever signalled`);
  }
});

test("a stranger at the chosen pid is never frozen, and the round does not run on it", async () => {
  const t = fakeTable({ 4242: "5000" }); // the chosen proxy (start 1000) is gone, a stranger has its pid
  let worked = false;
  await assert.rejects(
    whileFrozen({ pid: 4242, start: "1000" }, async () => { worked = true; }, { freeze: (x) => freezeProcess(x, t.opts), thaw: (x) => thawProcess(x, t.opts) }),
    /pid 4242 no longer names the process chosen to freeze/,
  );
  assert.equal(worked, false);
  assert.deepEqual(t.signals, []);
});

test("the process still frozen after the work is thawed; a kill reaches only the process it names", () => {
  const t = fakeTable({ 4242: "1000" });
  const id = { pid: 4242, start: "1000" };
  assert.equal(freezeProcess(id, t.opts), true);
  assert.equal(thawProcess(id, t.opts), true);
  assert.equal(killProcess(id, t.opts), true);
  t.replace(4242, "5000");
  assert.equal(killProcess(id, t.opts), false, "a stranger at the pid is not killed");
  t.exit(4242);
  assert.equal(killProcess(id, t.opts), false, "a gone pid is not killed");
  assert.deepEqual(t.signals, ["SIGSTOP 4242:1000", "SIGCONT 4242:1000", "SIGKILL 4242:1000"]);
  // An identity that cannot be told is no reason to signal: the error surfaces (a harness failure).
  assert.throws(() => thawProcess(id, { ...t.opts, start: () => { throw new Error("start time of pid 4242 unknown"); } }), /unknown/);
});

// Live, on this OS (on windows-latest through the held-handle PowerShell of lib/win-process.mjs).
test("a live child is frozen, thawed and killed by its identity; once it is gone nothing is done to its pid", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await new Promise((r) => child.once("spawn", r));
    const id = identityOf(child.pid);
    // A stop or continue signal takes effect asynchronously: poll the state (bounded) instead of reading it once.
    const stateIs = async (stopped) => {
      for (let i = 0; i < 200; i++) {
        if (/\) T /.test(readFileSync(`/proc/${child.pid}/stat`, "utf8")) === stopped) return true;
        await new Promise((r) => setTimeout(r, 10));
      }
      return false;
    };
    assert.equal(freezeProcess(id), true);
    if (process.platform === "linux") assert.ok(await stateIs(true), "stopped within 2 s");
    assert.equal(thawProcess(id), true);
    if (process.platform === "linux") assert.ok(await stateIs(false), "running again within 2 s");
    const exited = new Promise((r) => child.once("exit", r));
    assert.equal(killProcess(id), true);
    await exited; // reaped: from here on the pid is free for anyone
    assert.equal(thawProcess(id), false, "no thaw for a gone process");
    assert.equal(killProcess(id), false, "no kill for a gone process");
  } finally { try { child.kill("SIGKILL"); } catch {} }
});

// ── Every caller names the process by its identity (CI run 42554009537) ─────
// Ticket 16's start-lock test froze its own proxy with `suspendProcess(pid)` on
// Windows and `process.kill(pid, "SIGSTOP")` elsewhere: the bare pid reached
// the identity API only on windows-latest, so every Linux run stayed green.
// A bare pid is refused on every platform, before anything is signalled or
// spawned, and only lib/freeze.mjs drives the Windows actions, so a platform
// branch cannot hide a pid-only caller from Linux again.
test("a bare pid is refused by freeze, thaw and kill on every platform, before anything is signalled or spawned", async () => {
  const notAnIdentity = 7048; // CI run 42554009537's pid
  for (const platform of ["linux", "darwin", "win32"]) {
    for (const [name, fn] of [["freeze", freezeProcess], ["thaw", thawProcess], ["kill", killProcess]]) {
      const t = fakeTable({ 7048: "1000" });
      assert.throws(() => fn(notAnIdentity, { ...t.opts, platform }), /not a process identity: 7048/, `${name} on ${platform}`);
      assert.throws(() => fn({ pid: 7048 }, { ...t.opts, platform }), /pid 7048: no start time/, `${name} on ${platform}: a pid without a start time`);
      assert.deepEqual(t.signals, [], `${name} on ${platform}: nothing signalled`);
    }
  }
  let worked = false;
  await assert.rejects(whileFrozen(notAnIdentity, async () => { worked = true; }), /not a process identity: 7048/);
  assert.equal(worked, false, "the round does not run on a bare pid");
});

const IDENTITY_ACTIONS = ["freezeProcess", "thawProcess", "killProcess", "whileFrozen", "suspendProcess", "resumeProcess", "terminateProcess"];
const FREEZE_LIB = join(KIT_ROOT, "tests", "memory", "lib", "freeze.mjs");
const WIN_PROCESS_LIB = join(KIT_ROOT, "tests", "memory", "lib", "win-process.mjs");
/** Every .mjs/.js file of the kit's own code and tests (no dependencies, no build output). */
function kitSources(dir = KIT_ROOT, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) kitSources(p, out);
    else if (/\.(mjs|js)$/.test(e.name)) out.push(p);
  }
  return out;
}
/** The text of the first argument of the call whose `(` is at `open`. */
function firstArgument(src, open) {
  let depth = 0;
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) { if (depth === 0) return src.slice(open + 1, i).trim(); depth--; }
    else if (c === "," && depth === 0) return src.slice(open + 1, i).trim();
  }
  return "";
}
/** `src` with the contents of comments and string literals blanked (same length and lines): calls are matched in code only. */
function codeOnly(src) {
  let out = "", i = 0;
  const blank = (s) => s.replace(/[^\n]/g, " ");
  while (i < src.length) {
    const c = src[i], two = src.slice(i, i + 2);
    let end = -1;
    if (two === "//") end = src.indexOf("\n", i) === -1 ? src.length : src.indexOf("\n", i);
    else if (two === "/*") end = src.indexOf("*/", i + 2) === -1 ? src.length : src.indexOf("*/", i + 2) + 2;
    else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && !(c !== "`" && src[j] === "\n")) j += src[j] === "\\" ? 2 : 1;
      end = Math.min(j + 1, src.length);
    }
    if (end === -1) { out += c; i++; continue; }
    out += src[i] + blank(src.slice(i + 1, end - 1)) + (end - i > 1 ? src[end - 1] : "");
    i = end;
  }
  return out;
}
/** Callers of the identity actions in `file` (source `src`): violations as "path:line what". */
function identityCallViolations(file, src) {
  const rel = file.slice(KIT_ROOT.length + 1).replaceAll("\\", "/");
  const found = [];
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  const local = new Map(); // local name → imported name
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const target = m[2].startsWith(".") ? join(dirname(file), m[2]) : m[2];
    if (target !== FREEZE_LIB && target !== WIN_PROCESS_LIB) continue;
    for (const spec of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
      const [imported, alias = imported] = spec.split(/\s+as\s+/).map((s) => s.trim());
      if (target === WIN_PROCESS_LIB && /^(suspend|resume|terminate)Process$/.test(imported) && file !== FREEZE_LIB) {
        found.push(`${rel}:${lineOf(m.index)} imports ${imported} from win-process.mjs (use freezeProcess/thawProcess/killProcess of lib/freeze.mjs: identity-checked on every platform)`);
      }
      if (IDENTITY_ACTIONS.includes(imported)) local.set(alias, imported);
    }
  }
  if (/import\(\s*[^)]*win-process\.mjs/.test(src) && file !== FREEZE_LIB) found.push(`${rel}: imports win-process.mjs dynamically`);
  const code = codeOnly(src);
  for (const [name, imported] of local) {
    for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${name}\\s*\\(`, "g"))) {
      const arg = firstArgument(code, m.index + m[0].length - 1);
      // A bare pid: a number, `pid`, `x.pid`, `holderPid`, `Number(…)`.
      if (/^\d+$/.test(arg) || /(^|\.)pid$/i.test(arg) || /Pid$/.test(arg) || /^Number\(/.test(arg)) {
        found.push(`${rel}:${lineOf(m.index)} ${imported}(${arg}): a bare pid, not an identity`);
      }
    }
  }
  return found;
}

test("every caller of the freeze, thaw and kill actions passes an identity, and only lib/freeze.mjs drives the Windows actions", () => {
  // The check itself, on the shape of the defect it exists for (a file at tests/x.test.mjs).
  const at = join(KIT_ROOT, "tests", "x.test.mjs");
  assert.deepEqual(identityCallViolations(at, `import { suspendProcess } from "./memory/lib/win-process.mjs";\nconst f = (pid) => suspendProcess(pid);`), [
    "tests/x.test.mjs:1 imports suspendProcess from win-process.mjs (use freezeProcess/thawProcess/killProcess of lib/freeze.mjs: identity-checked on every platform)",
    "tests/x.test.mjs:2 suspendProcess(pid): a bare pid, not an identity",
  ]);
  assert.deepEqual(identityCallViolations(at, `import { freezeProcess as freeze } from "./memory/lib/freeze.mjs";\nfreeze(child.pid); freeze(Number(x)); freeze(identityOf(child.pid));`), [
    "tests/x.test.mjs:2 freezeProcess(child.pid): a bare pid, not an identity",
    "tests/x.test.mjs:2 freezeProcess(Number(x)): a bare pid, not an identity",
  ]);
  assert.deepEqual(identityCallViolations(at, `import { killProcess } from "./memory/lib/freeze.mjs";\nkillProcess({ pid: 1, start: "2" }); killProcess(orphans[0]);`), []);
  // The kit's code and tests as they are.
  const sources = kitSources();
  assert.ok(sources.includes(FREEZE_LIB) && sources.some((f) => f.endsWith(join("tests", "start-lock.test.mjs"))), "the scan covers the memory loop and the kit tests");
  const violations = sources.flatMap((f) => identityCallViolations(f, readFileSync(f, "utf8")));
  assert.deepEqual(violations, []);
});

// ── CI run 42281731448 (ubuntu, staging/02): S3/hung ran 9 s. The killed start
// lock holder had spawned the proxy but not yet written proxy.pid, so
// `manager start` answered 0 (healthy) with no pid record, both hung rounds
// were skipped, and only kill-holder-10 ran (8 of 9 earlier ubuntu runs: 188 s).
// The hung round freezes the run's own proxy that serves the isolated port;
// it never freezes a process that is not this run's, and it never guesses.
function fakeHungRound({ record = null, ours = [], listening = {}, startCode = 0, startErr = "", lock = null } = {}) {
  const calls = [], notes = {}, roundOpts = {}, frozen = [];
  const kit = { port: 19026, manager: async () => ({ code: startCode, out: "", err: startErr }), pidRecord: () => record };
  const hungRound = makeHungRound({
    // Scan rows carry the sample key <pid>:<start time>; here start = 1700<pid>.
    kit, proxies: () => ours.map((pid) => ({ pid, role: "proxy", key: `${pid}:1700${pid}` })), portsOf: (pid) => listening[pid] ?? [],
    round: async (name, n, opts) => { calls.push(`round ${name}`); roundOpts[name] = { n, ...opts }; }, note: (k, v) => { notes[k] = v; },
    freeze: (id) => { frozen.push(id); calls.push(`freeze ${id.pid}`); return true; }, thaw: (id) => { calls.push(`thaw ${id.pid}`); return true; }, graceMs: 0,
    lockState: () => lock,
  });
  return { hungRound, calls, notes, roundOpts, frozen };
}

test("S3 hung round: a proxy the killed start left without a pid record is frozen and the round runs (CI run 42281731448)", async () => {
  const { hungRound, calls, notes } = fakeHungRound({ record: null, ours: [3723], listening: { 3723: [19026] } });
  await hungRound("hung-10-with-stale-lock");
  assert.deepEqual(calls, ["freeze 3723", "round hung-10-with-stale-lock", "thaw 3723"]);
  assert.deepEqual(notes, { "hung-10-with-stale-lock.target": { pid: 3723, via: "listener", recordedPid: null } });
});

test("S3 hung round: the recorded proxy is frozen as before", async () => {
  const { hungRound, calls, notes, frozen } = fakeHungRound({ record: { pid: 41, startedMs: 1 }, ours: [41], listening: { 41: [19026] } });
  await hungRound("hung-10");
  assert.deepEqual(calls, ["freeze 41", "round hung-10", "thaw 41"]);
  assert.deepEqual(notes, { "hung-10.target": { pid: 41, via: "pid-record", recordedPid: 41 } });
  assert.deepEqual(frozen, [{ pid: 41, start: "170041" }], "frozen by the identity the run's scan saw (ticket 73)");
});

test("S3 hung round: nothing of this run to freeze is a skipped round, never a guess", async () => {
  const cases = {
    "no proxy at all": { ours: [] },
    "our proxy is not on the isolated port": { ours: [50], listening: { 50: [9999] } },
    "two of our proxies serve the port": { ours: [51, 52], listening: { 51: [19026], 52: [19026] } },
    "the recorded pid is not a process of this run": { record: { pid: 1, startedMs: 1 }, ours: [] },
    "start failed": { startCode: 4, ours: [53], listening: { 53: [19026] } },
  };
  for (const [label, c] of Object.entries(cases)) {
    const { hungRound, calls, notes } = fakeHungRound(c);
    await hungRound("hung-10");
    assert.deepEqual(calls, [], label);
    assert.ok(notes["hung-10.skipped"], `${label}: the skip is noted`);
  }
});

// ── CI runs 42395651721 (ubuntu), 42398295810 and 42398299724 (windows): the
// kill-holder adversary killed the start lock holder before its proxy was up
// (ubuntu and the first windows run: before the spawn; the second windows run:
// inside it, a proxy process that never ran). The next `manager start` met the
// stale lock with no healthy proxy and refused it (exit 1, "stale or unreadable
// manager start lock … refusing automatic takeover"): the kit defect ticket 16
// owns. In the stale-lock round that refusal is the measured outcome, not a
// round that did not run: its launches still race the state the killed start
// left, and the refusal is recorded with its exit code and stderr.
const LOCK = "/fx/state/logs/manager.lock";
const REFUSAL = `manager error: stale or unreadable manager start lock at ${LOCK} (holder pid 4089 is not alive, started 2026-11-07T17:37:21.369Z) — refusing automatic takeover. If no start is actually running, remove ${LOCK} manually and retry.\n`;
const staleLock = { path: LOCK, holderPid: 4089, holderAlive: false };

test("S3 hung round: a start refused over the killed holder's stale lock is a measured outcome; the round runs unfrozen (CI run 42395651721)", async () => {
  const { hungRound, calls, notes, roundOpts } = fakeHungRound({ startCode: 1, startErr: REFUSAL, lock: staleLock });
  await hungRound("hung-10-with-stale-lock", { staleLock: true });
  assert.deepEqual(calls, ["round hung-10-with-stale-lock"], "nothing is frozen: no proxy of this run serves the port");
  assert.equal(notes["hung-10-with-stale-lock.skipped"], undefined, "a refused start is not a skipped round");
  const refused = notes["hung-10-with-stale-lock.startRefused"];
  assert.equal(refused.startCode, 1);
  assert.match(refused.stderr, /stale or unreadable manager start lock .*refusing automatic takeover/);
  assert.deepEqual(refused.lock, { path: LOCK, holderPid: 4089, holderAlive: false });
  assert.equal(refused.serving, 0);
  assert.deepEqual(roundOpts["hung-10-with-stale-lock"], { n: 10, kind: "mixed", startRefused: refused }, "the round's launches still run, and its entry carries the refusal");
});

test("S3 hung round: the Windows killed-spawn orphan (ours, never serving the port) is no target; the refusal is still the measured outcome (CI run 42398299724)", async () => {
  const { calls, notes, hungRound } = fakeHungRound({ startCode: 1, startErr: REFUSAL, lock: staleLock, ours: [8652], listening: {} });
  await hungRound("hung-10-with-stale-lock", { staleLock: true });
  assert.deepEqual(calls, ["round hung-10-with-stale-lock"]);
  assert.equal(notes["hung-10-with-stale-lock.startRefused"].proxiesOfRun, 1);
});

test("S3 hung round: a failed start is a measured outcome only over a proven-stale lock in the stale-lock round; otherwise it stays a skip", async () => {
  const cases = {
    "not the stale-lock round": { opts: {}, c: { startCode: 1, startErr: REFUSAL, lock: staleLock } },
    "no lock file": { opts: { staleLock: true }, c: { startCode: 1, startErr: REFUSAL, lock: null } },
    // The round started before the killed holder was gone: a race of the scenario, never a kit verdict.
    "the lock holder is still alive": { opts: { staleLock: true }, c: { startCode: 1, startErr: REFUSAL, lock: { ...staleLock, holderAlive: true } } },
    "the lock names no holder": { opts: { staleLock: true }, c: { startCode: 1, startErr: REFUSAL, lock: { path: LOCK, holderPid: null, holderAlive: false } } },
    "the failure does not name the lock": { opts: { staleLock: true }, c: { startCode: 1, startErr: "manager error: EACCES somewhere else\n", lock: staleLock } },
    "no stderr at all": { opts: { staleLock: true }, c: { startCode: 1, startErr: "", lock: staleLock } },
    "a proxy of this run serves the port": { opts: { staleLock: true }, c: { startCode: 1, startErr: REFUSAL, lock: staleLock, ours: [53], listening: { 53: [19026] } } },
  };
  for (const [label, { opts, c }] of Object.entries(cases)) {
    const { hungRound, calls, notes } = fakeHungRound(c);
    await hungRound("hung-10-with-stale-lock", opts);
    assert.deepEqual(calls, [], label);
    assert.ok(notes["hung-10-with-stale-lock.skipped"], `${label}: the skip is noted`);
    assert.equal(notes["hung-10-with-stale-lock.startRefused"], undefined, label);
    assert.equal(notes["hung-10-with-stale-lock.skipped"].startCode, 1, label);
  }
});

test("S3: a refused start over the stale lock is a RED check, owned with S3/hung (ticket 16), naming the exit code and stderr", () => {
  const refused = { startCode: 1, stderr: REFUSAL.trim(), lock: staleLock, proxiesOfRun: 0, serving: 0 };
  const green = refusedStartCheck([{ name: "kill-holder-10" }, { name: "hung-10", startRefused: null }]);
  assert.equal(green.name, "start-over-stale-lock");
  assert.equal(green.red, false);
  assert.equal(green.value, 0);
  const red = refusedStartCheck([{ name: "kill-holder-10" }, { name: "hung-10-with-stale-lock", startRefused: refused }]);
  assert.equal(red.red, true);
  assert.equal(red.value, 1);
  assert.equal(red.budget, 0);
  assert.match(red.detail.join(), /hung-10-with-stale-lock: manager start exited 1: manager error: stale or unreadable manager start lock/);
});

// The gate (lib/completeness.mjs): a round carrying a refused start counts as
// run only with its evidence, only in a stale-lock round and only with the RED
// check; everything ticket 02 round 7 made a harness failure still is one.
const refusedEvidence = { startCode: 1, stderr: REFUSAL.trim(), lock: staleLock, proxiesOfRun: 0, serving: 0 };
const refusedRound = (over = {}) => ({ name: "hung-10-with-stale-lock", n: 10, launchMs: Array(10).fill(300), startRefused: refusedEvidence, ...over });
const s3HungRun = ({ rounds, checks = [{ name: "start-over-stale-lock", red: true, value: 1, budget: 0 }], notes = {} }) => ({ key: "S3/hung", platform: "linux", outcome: "RED", metric: "rss", durationS: 190, samples: 600, checks, summary: { proxy: { maxCount: 1 }, launcher: { maxCount: 5 }, preflight: { maxCount: 9 } }, notes: { sampler: {}, rounds, ...notes } });

test("run evidence: the stale-lock round with a refused start, its launches and the RED check is a run that ran", () => {
  const rounds = [KILL_HOLDER_ROUND, refusedRound(), { name: "hung-10" }];
  assert.deepEqual(runEvidence(s3HungRun({ rounds, notes: { "hung-10-with-stale-lock.startRefused": refusedEvidence } }), { key: "S3/hung", exitCode: 1 }), { ok: true, problems: [] });
});

test("run evidence: a refused start without its evidence, outside the stale-lock round, without launches or without the RED check is a harness failure", () => {
  const run = (round, extra = {}) => runEvidence(s3HungRun({ rounds: [{ name: "kill-holder-10" }, round, { name: "hung-10" }], ...extra }), { key: "S3/hung", exitCode: 1 });
  assert.match(run(refusedRound({ name: "hung-10-with-stale-lock", startRefused: { ...refusedEvidence, startCode: 0 } })).problems.join(), /round hung-10-with-stale-lock: refused start without its evidence/);
  assert.match(run(refusedRound({ startRefused: { ...refusedEvidence, stderr: "" } })).problems.join(), /refused start without its evidence/);
  assert.match(run(refusedRound({ startRefused: { ...refusedEvidence, lock: { ...staleLock, holderAlive: true } } })).problems.join(), /refused start without its evidence/);
  assert.match(run(refusedRound({ startRefused: { ...refusedEvidence, lock: null } })).problems.join(), /refused start without its evidence/);
  assert.match(run(refusedRound({ launchMs: [] })).problems.join(), /round hung-10-with-stale-lock: refused start but 0 of 10 launches ran/);
  assert.match(run(refusedRound(), { checks: [{ name: "start-over-stale-lock", red: false, value: 0, budget: 0 }] }).problems.join(), /refused start but the start-over-stale-lock check is not RED/);
  // hung-10 runs after the stale lock was cleared: a refusal there is no measured outcome.
  const inHung10 = runEvidence(s3HungRun({ rounds: [{ name: "kill-holder-10" }, { name: "hung-10-with-stale-lock" }, refusedRound({ name: "hung-10" })] }), { key: "S3/hung", exitCode: 1 });
  assert.match(inHung10.problems.join(), /round hung-10: a refused start counts only in a stale-lock round/);
  // S3/short has no stale-lock round at all.
  const short = runEvidence({ ...s3HungRun({ rounds: [{ name: "race-5#0" }, { name: "race-10#0" }, { name: "race-10-preflight#0" }, refusedRound({ name: "kill-holder-10" })] }), key: "S3/short" }, { key: "S3/short", exitCode: 1 });
  assert.match(short.problems.join(), /round kill-holder-10: a refused start counts only in a stale-lock round/);
});

// The three CI runs' own summaries (written by the pre-fix scenario: a
// `.skipped` note and no round entry) stay harness failures through the job.
const CI_REFUSED = {
  "42395651721 (ubuntu)": "ci-42395651721-s3-hung-summary.json",
  "42398295810 (windows)": "ci-42398295810-s3-hung-summary.json",
  "42398299724 (windows)": "ci-42398299724-s3-hung-summary.json",
};
// A real S3/hung run of the fixed scenario (Linux, Bun 1.4.2, 2026-11-07) in
// the CI state: a scratch copy of the kit waited 3 s between taking the start
// lock and spawning, so the adversary always killed the holder before its
// proxy existed (ticket 65 Comments). Through the job it is the listed RED of
// ticket 16, with the refusal as a check; without that check, or without the
// stale-lock round, it is a harness failure.
const S3_HUNG_REFUSED_RUN = join(dirname(CI_S3_HUNG), "local-20261107-s3-hung-refused-linux-summary.json");

test("job: a real S3/hung run whose stale-lock start was refused passes the evidence gate as RED; the lock checks ticket 16 removed now fail it; cut or unchecked it is a harness failure", () => {
  // Written before ticket 16, its kill-holder round recorded no launch pids, so
  // as archived it no longer proves the killed-holder case ran (Round 27 Q1
  // condition 2).
  const archived = fakeJob("replay", "S3/hung", { FAKE_RUN_SUMMARY: S3_HUNG_REFUSED_RUN });
  assert.equal(archived.row?.outcome, "HARNESS FAILURE", archived.r.stdout + archived.r.stderr);
  assert.match(archived.result.error, /round kill-holder-10: the round recorded no launch pids, so the killed pid 2138131 matches no launch/);
  // The rest of the gate on the same run, with its kill-holder launches in the
  // shape ticket 16's scenario records them: the victim is preflight#0 (its own
  // failedLaunches line, code=null) under the adversary's pid; the other pids
  // were not recorded.
  const run = JSON.parse(readFileSync(S3_HUNG_REFUSED_RUN, "utf8"));
  const killHolder = run.notes.rounds.find((x) => x.name === "kill-holder-10");
  assert.equal(killHolder.failedLaunches[0], "preflight#0 code=null ");
  killHolder.launches = Array.from({ length: killHolder.n }, (_, i) => ({ i, via: "preflight", pid: i === 0 ? killHolder.adversary.killed : null, code: i === 0 ? null : 4, signal: null }));
  const dir = mkdtempSync(join(tmpdir(), "memloop-s3hung-"));
  try {
    const withLaunches = join(dir, "with-launches.json");
    writeFileSync(withLaunches, JSON.stringify(run));
    const { r, row, result } = fakeJob("replay", "S3/hung", { FAKE_RUN_SUMMARY: withLaunches });
    // The gate: a measured RED, not a harness failure.
    assert.equal(row?.outcome, "RED", r.stdout + r.stderr);
    assert.ok(result.redChecks.includes("start-over-stale-lock"), result.redChecks.join());
    // Ticket 16 removed failed-launches and stale-lock-after-round from S3/hung
    // (Round 15 Q1 condition 5): this pre-fix run's REDs on them are unowned now.
    assert.equal(r.status, 1, "the ratchet fails on the removed names");
    const unowned = r.stdout.split("\n").filter((l) => / not owned by /.test(l)).map((l) => l.trim());
    assert.deepEqual(unowned, [
      "- S3/hung: RED on failed-launches, not owned by tickets 16, 37 (linux, Round 14 Q1, Round 15 Q1); the RED comes back as an ownership question, do not edit owners",
      "- S3/hung: RED on stale-lock-after-round, not owned by tickets 16, 37 (linux, Round 14 Q1, Round 15 Q1); the RED comes back as an ownership question, do not edit owners",
    ]);
    const variants = {
      "the stale-lock round removed": [{ ...run, notes: { ...run.notes, rounds: run.notes.rounds.filter((x) => x.name !== "hung-10-with-stale-lock") } }, /round hung-10-with-stale-lock never ran/],
      "the refusal check not RED": [{ ...run, checks: run.checks.map((c) => (c.name === "start-over-stale-lock" ? { ...c, red: false } : c)) }, /refused start but the start-over-stale-lock check is not RED/],
    };
    for (const [label, [summary, why]] of Object.entries(variants)) {
      const cut = join(dir, "summary.json");
      writeFileSync(cut, JSON.stringify(summary));
      const v = fakeJob("replay", "S3/hung", { FAKE_RUN_SUMMARY: cut });
      assert.equal(v.row?.outcome, "HARNESS FAILURE", `${label}: ${v.r.stdout + v.r.stderr}`);
      assert.match(v.result.error, why, label);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const [run, file] of Object.entries(CI_REFUSED)) {
  test(`job: the S3/hung run of CI ${run} (stale-lock round skipped, start exited 1) stays a harness failure`, () => {
    const { r, row, result } = fakeJob("replay", "S3/hung", { FAKE_RUN_SUMMARY: join(dirname(CI_S3_HUNG), file) });
    assert.equal(row?.outcome, "HARNESS FAILURE", r.stdout + r.stderr);
    assert.match(result.error, /round hung-10-with-stale-lock skipped: manager start exited 1; round hung-10-with-stale-lock never ran/);
    assert.equal(r.status, 1);
  });
}

test("whileFrozen: a frozen process the kit killed meanwhile (hung-own recovery) needs no thaw", async () => {
  // A real process and the OS primitives (windows-latest: NtSuspendProcess / NtResumeProcess by identity).
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await new Promise((r) => child.once("spawn", r));
    const id = identityOf(child.pid);
    const r = await whileFrozen(id, async () => {
      const exited = new Promise((ok) => child.once("exit", ok));
      child.kill("SIGKILL"); // as the kit's recovery does; a frozen process dies of SIGKILL / TerminateProcess
      await exited;
      return "round";
    });
    assert.equal(r, "round", "the round's result, no harness failure");
  } finally { try { child.kill("SIGKILL"); } catch {} }
});

// ── S1/burst1 at the job seam: the median rule and the measurement mode (ticket 60) ──
// The fake run's burst1 mode writes proxy samples and judges them with the real
// osVerdict, in the Linux or the Windows shape (fixtures/fake-run.mjs).
function burst1Job(args, { shape = "linux", peaks, env = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), "memloop-burst1-"));
  const stepSummary = join(home, "step-summary.md");
  writeFileSync(stepSummary, "");
  const os = shape === "win32" ? "windows" : "linux";
  const r = runJob(["--os", os, "--cap", "none", "--out", join(home, "job"), "--run-script", FAKE_RUN, ...args], { ZCODE_OVERHAUL_RUN: "1", HOME: home, FAKE_RUN_MODE: "burst1", FAKE_RUN_SHAPE: shape, FAKE_RUN_PEAKS: JSON.stringify(peaks), GITHUB_STEP_SUMMARY: stepSummary, ...env });
  const read = (p) => { try { return readFileSync(join(home, "job", p), "utf8"); } catch { return null; } };
  const json = (p) => { const t = read(p); return t === null ? null : JSON.parse(t); };
  const files = (() => { try { return readdirSync(join(home, "job")); } catch { return []; } })();
  const out = { r, files, job: json("job-summary.json"), measure: json("measure-S1-burst1.json"), measureMd: read("measure-S1-burst1.md"), stepSummary: readFileSync(stepSummary, "utf8"), repDirs: (() => { try { return readdirSync(join(home, "job", "S1-burst1")); } catch { return []; } })() };
  rmSync(home, { recursive: true, force: true });
  return out;
}

test("job: S1/burst1 runs n fresh repetitions (n from budgets.mjs REPEATED) and the ratchet sees one verdict", async () => {
  const { REPEATED } = await import("./lib/budgets.mjs");
  const n = REPEATED["S1/burst1"].n;
  const peaks = Array.from({ length: n }, (_, i) => ({ rss: i === 1 ? 270 : 230 + i }));
  const { r, job, repDirs } = burst1Job(["--only", "S1/burst1"], { peaks });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(repDirs.filter((d) => d.startsWith("rep-")).sort(), Array.from({ length: n }, (_, i) => `rep-${i + 1}`).sort());
  assert.deepEqual(job.rows.map((x) => [x.key, x.outcome]), [["S1/burst1", "GREEN"]]);
  assert.equal(job.results[0].repetitions.length, n);
  assert.equal(job.results[0].median.n, n);
});

// Workflow text with LF line endings: a Windows checkout (autocrlf) has CRLF,
// and every assertion below is written against LF (CI run 42360554587).
const lf = (text) => text.replace(/\r\n/g, "\n");
const ciWorkflow = () => readFileSync(join(KIT_ROOT, ".github", "workflows", "ci.yml"), "utf8");

/** The memory-budget job's measurement-mode wiring, asserted on ci.yml text as checked out (LF or CRLF). */
function assertMeasurementWiring(ciText) {
  const ci = lf(ciText);
  const job = ci.slice(ci.indexOf("\n  memory-budget:"));
  const step = (name) => job.slice(job.indexOf(`- name: ${name}`)).split(/\n      - /)[0];
  assert.match(step("Memory loop (short profile) and expected-RED ratchet"), /if: hashFiles\('tests\/memory\/measure-burst1'\) == ''/);
  const measure = step("S1/burst1 measurement");
  assert.match(measure, /if: hashFiles\('tests\/memory\/measure-burst1'\) != ''/);
  assert.match(measure, /--measure-burst1 "\$\(cat tests\/memory\/measure-burst1\)"/);
  assert.match(step("Upload memory loop artefacts"), /measure-S1-burst1\.json[\s\S]*measure-S1-burst1\.md/);
  // Round 10 Q1 condition 1 / Round 11 Q1 condition 4: the candidate Bun arms
  // are installed only with the marker, uncached (setup-bun's post step would
  // cache the binary then on ~/.bun/bin under the wrong version); the job's
  // own Bun, the pinned 1.4.2 and the reference arm, comes last so it stays
  // on PATH; --bun is built from the marker's own arm list.
  for (const v of ["1.4.3", "1.4.4"]) {
    const arm = step(`Bun ${v} for the paired measurement`);
    assert.match(arm, /if: hashFiles\('tests\/memory\/measure-burst1'\) != ''/, v);
    assert.match(arm, new RegExp(`bun-version: ${v.replace(/\./g, "\\.")}\\n\\s+no-cache: true`), v);
    assert.match(step(`Keep Bun ${v} aside`), /if: hashFiles\('tests\/memory\/measure-burst1'\) != ''/, v);
  }
  assert.match(step("Keep Bun 1.4.2 aside"), /if: hashFiles\('tests\/memory\/measure-burst1'\) != ''/);
  const ownBun = job.indexOf("\n          bun-version: 1.4.2\n");
  assert.ok(ownBun > 0 && job.indexOf("- name: Keep Bun 1.4.4 aside") < ownBun && ownBun < job.indexOf("- name: Keep Bun 1.4.2 aside"), "the job's own Bun is installed last, so it stays the one on PATH");
  assert.match(measure, /grep -q 'bun=' tests\/memory\/measure-burst1[\s\S]*for v in \$\(printf '%s' "\$\{SPEC#\*bun=\}" \| tr ',' ' '\); do BUNS="\$\{BUNS:\+\$BUNS,\}\$v=\$ARMS\/\$v\/bun\$EXE"; done[\s\S]*--bun "\$BUNS"/);
}

test("measurement mode is off by default: the ratchet step runs unless the marker file exists, and the marker is not committed", () => {
  assertMeasurementWiring(ciWorkflow());
  // A measurement run turns the ratchet off; a committed marker must never reach the integration branch.
  assert.equal(readdirSync(join(KIT_ROOT, "tests", "memory")).includes("measure-burst1"), false, "tests/memory/measure-burst1 is a one-run switch: delete it before the pre-merge run");
});

test("the measurement-mode wiring check reads ci.yml the same with LF and CRLF line endings (Windows checkouts)", () => {
  const text = lf(ciWorkflow());
  const crlf = text.replace(/\n/g, "\r\n");
  assert.ok(crlf.includes("bun-version: 1.4.3\r\n          no-cache: true"), "the CRLF copy is a real CRLF checkout");
  assertMeasurementWiring(text);
  assertMeasurementWiring(crlf);
});

// ── The S1/stalled attribution at the job seam (ticket 61, Round 12 Q3 condition 1) ──
function stalledJob(args, { shape = "linux", arms }) {
  const home = mkdtempSync(join(tmpdir(), "memloop-stalled-"));
  const stepSummary = join(home, "step-summary.md");
  writeFileSync(stepSummary, "");
  const os = shape === "win32" ? "windows" : "linux";
  const r = runJob(["--os", os, "--cap", "none", "--out", join(home, "job"), "--run-script", FAKE_RUN, ...args], { ZCODE_OVERHAUL_RUN: "1", HOME: home, FAKE_RUN_MODE: "stalled-arms", FAKE_RUN_SHAPE: shape, FAKE_RUN_ARMS: JSON.stringify(arms), GITHUB_STEP_SUMMARY: stepSummary });
  const read = (p) => { try { return readFileSync(join(home, "job", p), "utf8"); } catch { return null; } };
  const out = { r, job: read("job-summary.json"), measure: JSON.parse(read("measure-S1-stalled.json") ?? "null"), md: read("measure-S1-stalled.md"), stepSummary: readFileSync(stepSummary, "utf8"), runDirs: (() => { try { return readdirSync(join(home, "job", "measure-S1-stalled")).sort(); } catch { return []; } })() };
  rmSync(home, { recursive: true, force: true });
  return out;
}

test("stalled attribution: N rotations of S1/stalled and S1/drained; the buckets are the floors, the drained excess, the JS-held heap and the residual (worked example, linux)", () => {
  const arms = {
    "S1/stalled": [{ peak: 170, floor: 90, heapPeak: 24, heapFloor: 6 }, { peak: 180, floor: 92, heapPeak: 26, heapFloor: 6 }],
    "S1/drained": [{ peak: 140, floor: 90, heapPeak: 14, heapFloor: 6 }, { peak: 150, floor: 90, heapPeak: 16, heapFloor: 6 }],
  };
  const { r, job, measure, md, stepSummary, runDirs } = stalledJob(["--measure-stalled", "2"], { arms });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(job, null, "an attribution run is not a ratchet run");
  assert.deepEqual(runDirs, ["rep-1-S1-drained", "rep-1-S1-stalled", "rep-2-S1-drained", "rep-2-S1-stalled"]);
  assert.deepEqual(measure.reps.map((x) => `${x.rep} ${x.arm}`), ["1 S1/stalled", "1 S1/drained", "2 S1/stalled", "2 S1/drained"], "the arms run in rotation");
  assert.equal(measure.complete, true);
  assert.deepEqual([measure.stalled.gateMB, measure.stalled.floorMB, measure.stalled.heapPeakMB, measure.stalled.floorHeapMB, measure.stalled.readers], [175, 91, 25, 6, 8]);
  assert.deepEqual([measure.drained.gateMB, measure.drained.floorMB, measure.drained.heapPeakMB, measure.drained.floorHeapMB], [145, 90, 15, 6]);
  // Excess 175 − 91 = 84; (iii) 145 − 90 = 55; (i) (25 − 6) − (15 − 6) = 10; residual 84 − 55 − 10 = 19 > 0.2 × 84.
  const g = measure.buckets.gate;
  assert.deepEqual({ metric: g.metric, excess: g.excessMB, iii: g.iiiMB, i: g.iMB, residual: g.residualMB, accounted: g.accounted }, { metric: "rss", excess: 84, iii: 55, i: 10, residual: 19, accounted: false });
  assert.deepEqual(g.perReader, { excessMB: 10.5, iiiMB: 6.9, iMB: 1.3, residualMB: 2.4 });
  assert.equal(measure.buckets.commit, undefined, "linux has no commit metric");
  for (const text of [md, stepSummary]) {
    assert.match(text, /S1\/stalled attribution \(linux, 2 rotations of S1\/stalled → S1\/drained\)/);
    assert.match(text, /\| RSS \| 175 \| 91 \| 84 \(10\.5\) \| 55 \(6\.9\) \| 10 \(1\.3\) \| 19 \(2\.4\) \| no \|/);
  }
});

test("stalled attribution on windows: WS gate and commit buckets side by side; accounted when (i) + (iii) explain the excess within ±20 %", () => {
  const arms = {
    "S1/stalled": [{ peak: 300, wsPeak: 300, floor: 53, heapPeak: 104, heapFloor: 4, commit: 440, floorCommit: 180 }],
    "S1/drained": [{ peak: 180, wsPeak: 180, floor: 53, heapPeak: 14, heapFloor: 4, commit: 300, floorCommit: 180 }],
  };
  const { r, measure, md } = stalledJob(["--measure-stalled", "1"], { shape: "win32", arms });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // WS: excess 247, (iii) 127, (i) 100 − 10 = 90, residual 30 ≤ 49.4 → accounted.
  assert.deepEqual([measure.buckets.gate.metric, measure.buckets.gate.excessMB, measure.buckets.gate.iiiMB, measure.buckets.gate.iMB, measure.buckets.gate.residualMB, measure.buckets.gate.accounted], ["ws", 247, 127, 90, 30, true]);
  // Commit: excess 260, (iii) 120, (i) 90, residual 50 ≤ 52 → accounted.
  assert.deepEqual([measure.buckets.commit.excessMB, measure.buckets.commit.iiiMB, measure.buckets.commit.iMB, measure.buckets.commit.residualMB, measure.buckets.commit.accounted], [260, 120, 90, 50, true]);
  assert.match(md, /\| WS \| 300 \| 53 \| 247 \(30\.9\) \| 127 \(15\.9\) \| 90 \(11\.3\) \| 30 \(3\.8\) \| yes \|/);
  assert.match(md, /\| commit \| 440 \| 180 \| 260 \(32\.5\) \| 120 \(15\) \| 90 \(11\.3\) \| 50 \(6\.3\) \| yes \|/);
});

test("stalled attribution: a run without an idle floor (fewer than 3 samples before the load) is invalid, and the attribution exits 2", () => {
  const arms = {
    "S1/stalled": [{ peak: 170, floor: 90, heapPeak: 24, heapFloor: 6, preSamples: 2 }],
    "S1/drained": [{ peak: 140, floor: 90, heapPeak: 14, heapFloor: 6 }],
  };
  const { r, measure, md } = stalledJob(["--measure-stalled", "1"], { arms });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(measure.complete, false);
  assert.deepEqual(measure.reps.map((x) => x.valid), [false, true]);
  assert.match(measure.reps[0].problems.join(), /2 proxy samples before the load \(need ≥ 3 for the idle floor\)/);
  assert.match(md, /complete: NO/);
});

test("stalled attribution: --measure-stalled takes a whole number of rotations and runs on its own", () => {
  for (const [args, why] of [[["--measure-stalled", "0"], /whole number of rotations from 1 to 50/], [["--measure-stalled", "2", "--measure-burst1", "3"], /runs on its own/], [["--measure-stalled", "2", "--only", "S1/stalled"], /runs on its own/]]) {
    const { r } = stalledJob(args, { arms: {} });
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, why, args.join(" "));
  }
});

test("stalled attribution is off by default: the ratchet step runs unless the marker exists, the attribution step only with it, and the marker is not committed", () => {
  const ci = lf(ciWorkflow());
  const job = ci.slice(ci.indexOf("\n  memory-budget:"));
  const step = (name) => job.slice(job.indexOf(`- name: ${name}`)).split(/\n      - /)[0];
  assert.match(step("Memory loop (short profile) and expected-RED ratchet"), /if: hashFiles\('tests\/memory\/measure-burst1'\) == '' && hashFiles\('tests\/memory\/measure-stalled'\) == ''/);
  const attribution = step("S1/stalled attribution");
  assert.match(attribution, /if: hashFiles\('tests\/memory\/measure-burst1'\) == '' && hashFiles\('tests\/memory\/measure-stalled'\) != ''/);
  assert.match(attribution, /--measure-stalled "\$\(tr -d '\\r' < tests\/memory\/measure-stalled\)"/);
  assert.match(step("Upload memory loop artefacts"), /measure-S1-stalled\.json[\s\S]*measure-S1-stalled\.md/);
  assert.equal(readdirSync(join(KIT_ROOT, "tests", "memory")).includes("measure-stalled"), false, "tests/memory/measure-stalled is a one-run switch: delete it before the pre-merge run");
});

test("measurement mode: N fresh sequential S1/burst1 runs on Windows, each with WS gate, sampled WS, ws_peak_kb, commit, proxy count, units and Job Object", () => {
  const peaks = [{ ws: 234.3, wsPeak: 255, commit: 422 }, { ws: 222, wsPeak: 222, commit: 365.2 }, { ws: 240, wsPeak: 246, commit: 410 }, { ws: 248.3, wsPeak: 262, commit: 424.5 }];
  const { r, files, job, measure, measureMd, stepSummary, repDirs } = burst1Job(["--measure-burst1", "4"], { shape: "win32", peaks });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(job, null, "a measurement run is not a ratchet run");
  assert.ok(files.includes("measure-S1-burst1.md"));
  assert.deepEqual(repDirs, [], "the job's own S1/burst1 set does not run");
  assert.equal(measure.key, "S1/burst1");
  assert.equal(measure.os, "windows");
  assert.equal(measure.requested, 4);
  assert.equal(measure.reps.length, 4);
  assert.deepEqual(measure.reps.map((x) => x.rep), [1, 2, 3, 4]);
  const first = measure.reps[0];
  assert.deepEqual(
    { gate: first.gate, gateMB: first.gateMB, sampledMB: first.sampledMB, wsPeakKb: first.wsPeakKb, commitMB: first.commitMB, proxyCount: first.proxyCount, unitsOk: first.unitsOk, jobApplied: first.jobApplied, gateConsistent: first.gateConsistent, valid: first.valid, outcome: first.outcome },
    { gate: "ws", gateMB: 255, sampledMB: 234.3, wsPeakKb: 261120, commitMB: 422, proxyCount: 1, unitsOk: true, jobApplied: true, gateConsistent: true, valid: true, outcome: "RED" },
  );
  assert.deepEqual(measure.reps.map((x) => x.gateMB), [255, 222, 246, 262]);
  assert.deepEqual([measure.valid, measure.aboveBudget, measure.p, measure.overCeiling, measure.maxMB, measure.medianMB], [4, 2, 0.5, [], 262, 250.5]);
  assert.equal(measure.budgetMB, 250);
  assert.equal(measure.ceilingMB, 400);
  // P(median RED) for each odd n ≤ 9 at the measured p (informational: Round 8 Q1 condition 3 decides).
  assert.deepEqual(Object.keys(measure.medianRedProbability), ["3", "5", "7", "9"]);
  assert.equal(measure.medianRedProbability["3"], 0.5);
  for (const text of [measureMd, stepSummary]) {
    assert.match(text, /S1\/burst1 measurement \(windows, 4 fresh runs\)/);
    assert.match(text, /\| 1 \| RED \| 255 \| 234\.3 \| 261120 \| 422 \| 1 \| ok \| applied \|/);
    assert.match(text, /above 250 MB: 2 of 4 \(p = 0\.5\)/);
  }
});

test("measurement mode: a missing or zero PeakWorkingSetSize, a failed units self-test or no Job Object makes a run invalid, and the measurement exits 2", () => {
  const peaks = [{ ws: 230, wsPeak: 240, commit: 400 }, { ws: 222, wsPeak: 0, commit: 365.2 }, { ws: 231, wsPeak: 241, commit: 401, job: false }, { ws: 232, wsPeak: 242, commit: 402, units: false }];
  const { r, measure } = burst1Job(["--measure-burst1", "4"], { shape: "win32", peaks });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.deepEqual(measure.reps.map((x) => x.valid), [true, false, false, false]);
  assert.match(measure.reps[1].problems.join(), /ws_peak_kb missing or 0/);
  assert.match(measure.reps[2].problems.join(), /Job Object not applied/);
  assert.match(measure.reps[3].problems.join(), /units self-test/);
  assert.equal(measure.valid, 1);
  assert.equal(measure.complete, false);
});

test("measurement mode on Linux: the gate is max(sampled RSS, VmHWM), no commit, no Job Object", () => {
  // "3\r": the marker as `$(cat …)` reads it from a CRLF (autocrlf) checkout.
  const { r, measure } = burst1Job(["--measure-burst1", "3\r"], { peaks: [{ rss: 200, hwm: 236.5 }, { rss: 190, hwm: 267.4 }, { rss: 180, hwm: 235.5 }] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(measure.reps.map((x) => [x.gate, x.gateMB, x.sampledMB, x.peakMB, x.commitMB, x.jobApplied, x.gateConsistent, x.valid]), [
    ["rss", 236.5, 200, 236.5, null, null, true, true],
    ["rss", 267.4, 190, 267.4, null, null, true, true],
    ["rss", 235.5, 180, 235.5, null, null, true, true],
  ]);
  assert.deepEqual([measure.aboveBudget, measure.valid, measure.complete], [1, 3, true]);
});

test("measurement mode: the median of an even count is the mean of the middle pair, rounded to 0.1 MB", () => {
  // The ticket 60 Linux measurement's middle pair, 229.6 / 232.2, printed as 230.89999999999998.
  const { measure, measureMd } = burst1Job(["--measure-burst1", "4"], { peaks: [{ rss: 150, hwm: 229.6 }, { rss: 150, hwm: 260 }, { rss: 150, hwm: 200 }, { rss: 150, hwm: 232.2 }] });
  assert.equal(measure.medianMB, 230.9);
  assert.match(measureMd, /min \/ median \/ max: 200 \/ 230\.9 \/ 260 MB/);
});

test("measurement mode rejects a count that is not a whole number from 1 to 50 before anything runs", () => {
  for (const bad of ["0", "51", "2.5", "x", ""]) {
    const { r, files } = burst1Job(["--measure-burst1", bad], { peaks: [] });
    assert.equal(r.status, 2, `${bad}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--measure-burst1/);
    assert.deepEqual(files, [], bad);
  }
});

// ── Paired Bun measurement (Round 10 Q1 conditions 1–2, ticket 09) ──
// The marker names the arms ("N bun=1.4.2,1.4.3,1.4.4"); --bun gives their
// binaries; the arms run interleaved in rotation, N valid runs each, and the
// output carries the re-entry reading (Round 11 Q1 condition 4) at the job's
// n, with the first arm as the reference. The fake run reports the
// proxy's runtime Bun from FAKE_RUN_BUN_REVISIONS (path → revision).
function bunArms(home, versions) {
  const paths = {};
  for (const v of versions) {
    mkdirSync(join(home, "arms", v), { recursive: true });
    paths[v] = join(home, "arms", v, process.platform === "win32" ? "bun.exe" : "bun");
    writeFileSync(paths[v], "fake bun\n");
  }
  return paths;
}

function pairedJob({ spec, arms = ["1.4.2", "1.4.3", "1.4.4"], peaks, shape = "linux", revisions = (v) => `${v}+fake${v.replace(/\./g, "")}`, bunArg, extraArgs = [], jobBunEnv = null }) {
  const home = mkdtempSync(join(tmpdir(), "memloop-paired-"));
  const paths = bunArms(home, arms);
  const stepSummary = join(home, "step-summary.md");
  writeFileSync(stepSummary, "");
  const map = Object.fromEntries(Object.entries(paths).map(([v, p]) => [p, revisions(v)]));
  const bun = bunArg === undefined ? Object.entries(paths).map(([v, p]) => `${v}=${p}`).join(",") : bunArg;
  const args = ["--os", shape === "win32" ? "windows" : "linux", "--cap", "none", "--out", join(home, "job"), "--run-script", FAKE_RUN, ...(spec === null ? [] : ["--measure-burst1", spec]), ...(bun === null ? [] : ["--bun", bun]), ...extraArgs];
  const r = runJob(args, { ZCODE_OVERHAUL_RUN: "1", HOME: home, FAKE_RUN_MODE: "burst1", FAKE_RUN_SHAPE: shape, FAKE_RUN_PEAKS: JSON.stringify(peaks), FAKE_RUN_BUN_REVISIONS: JSON.stringify(map), GITHUB_STEP_SUMMARY: stepSummary, ZCODE_KIT_BUN: jobBunEnv ?? join(home, "no-job-bun") });
  const read = (p) => { try { return readFileSync(join(home, "job", p), "utf8"); } catch { return null; } };
  const files = (() => { try { return readdirSync(join(home, "job")); } catch { return []; } })();
  const measureText = read("measure-S1-burst1.json");
  const out = { r, files, paths, measure: measureText ? JSON.parse(measureText) : null, measureMd: read("measure-S1-burst1.md"), stepSummary: readFileSync(stepSummary, "utf8") };
  rmSync(home, { recursive: true, force: true });
  return out;
}

test("paired marker spec: N, or N bun=<v>,<v>[,…] with distinct x.y.z versions; anything else is refused", async () => {
  const { parseMeasureSpec } = await import("./lib/measure.mjs");
  assert.deepEqual(parseMeasureSpec("24"), { count: 24, arms: null });
  assert.deepEqual(parseMeasureSpec("24\r\n"), { count: 24, arms: null });
  assert.deepEqual(parseMeasureSpec("24 bun=1.4.2,1.4.3,1.4.4\r\n"), { count: 24, arms: ["1.4.2", "1.4.3", "1.4.4"] });
  for (const bad of ["", "0", "51", "24 bun=", "24 bun=1.4.2", "24 bun=1.4.2,1.4.2", "24 bun=latest,1.4.4", "24 bun=1.4,1.4.4", "24 foo=1.4.2,1.4.4", "24 bun=1.4.2,1.4.4 x", "0 bun=1.4.2,1.4.4"]) {
    assert.throws(() => parseMeasureSpec(bad), /--measure-burst1/, JSON.stringify(bad));
  }
});

test("one-sided Fisher exact test on counts above the budget (arm more often above than the reference)", async () => {
  const { fisherOneSided } = await import("./lib/measure.mjs");
  // Independent check: the hypergeometric upper tail with exact BigInt binomials.
  const C = (n, k) => { let r = 1n; for (let i = 0n; i < BigInt(k); i++) r = (r * (BigInt(n) - i)) / (i + 1n); return r; };
  const tail = (a, n1, c, n2) => {
    const K = a + c, N = n1 + n2;
    let num = 0n;
    for (let x = a; x <= Math.min(K, n1); x++) num += C(n1, x) * C(n2, K - x);
    return Number((num * 10n ** 12n) / C(N, K)) / 1e12;
  };
  for (const [a, n1, c, n2] of [[12, 24, 1, 24], [3, 24, 1, 24], [5, 24, 2, 24], [0, 24, 0, 24], [24, 24, 0, 24], [1, 3, 0, 3], [14, 24, 13, 24]]) {
    assert.ok(Math.abs(fisherOneSided(a, n1, c, n2) - tail(a, n1, c, n2)) < 1e-9, `${[a, n1, c, n2]}`);
  }
  // The Round 10 CI numbers: 1.4.4 12/24 against 1.4.2 1/24 is p ≈ 0.0003 (well under 0.05).
  assert.ok(fisherOneSided(12, 24, 1, 24) < 0.001);
  assert.equal(fisherOneSided(0, 24, 0, 24), 1);
  assert.ok(fisherOneSided(3, 24, 1, 24) > 0.05, "3/24 vs 1/24 is no shown effect");
});

test("stable unlisted follows the job's n: at most 3 / 4 / 5 / 6 of 24 for n = 3 / 5 / 7 / 9 (Round 11)", async () => {
  const { stableMaxCount, stableUnlisted } = await import("./lib/measure.mjs");
  assert.deepEqual([3, 5, 7, 9].map((n) => stableMaxCount(24, n)), [3, 4, 5, 6]);
  const arm = (above) => ({ valid: 24, aboveBudget: above });
  assert.deepEqual([stableUnlisted(arm(5), 5), stableUnlisted(arm(5), 7), stableUnlisted(arm(6), 7)], [false, true, false]);
  assert.throws(() => stableUnlisted(arm(1)), /the job's n/, "no default n: the caller passes the job's");
});

test("re-entry reading (Round 11 Q1 condition 4): (i) valid and within the ceiling, (ii) stable at the job's n, (iii) Fisher p > 0.05 on Linux; (iv) median ≤ 300 on Windows", async () => {
  const { reentryReading } = await import("./lib/measure.mjs");
  const arm = (bun, above, { valid = 24, requested = 24, overCeiling = [], medianMB = 240 } = {}) => ({ bun, valid, requested, aboveBudget: above, overCeiling, medianMB });
  const linux = (ref, ...cands) => reentryReading([ref, ...cands], { os: "linux", n: 7, jobBun: "1.4.2+744846f84" });
  const verdict = (r) => r.candidates.map((c) => [c.bun, c.pass, ...["i", "ii", "iii"].map((k) => c.checks[k].pass)]);
  // The paired CI run 42352122623 (Linux): 1.4.2 5/24, 1.4.3 14/24, 1.4.4 13/24.
  const ci = linux(arm("1.4.2", 5), arm("1.4.3", 14), arm("1.4.4", 13));
  assert.equal(ci.reference, "1.4.2");
  assert.deepEqual(verdict(ci), [["1.4.3", false, true, false, false], ["1.4.4", false, true, false, false]]);
  assert.ok(Math.abs(ci.candidates[0].fisherP - 0.0086) < 5e-4 && Math.abs(ci.candidates[1].fisherP - 0.0178) < 5e-4);
  assert.deepEqual(ci.notes, []);
  // A candidate that passes all three on this leg.
  assert.deepEqual(verdict(linux(arm("1.4.2", 1), arm("1.4.5", 3))), [["1.4.5", true, true, true, true]]);
  // Stable at n = 7 (5 of 24) but significantly above a clean reference (5 vs 0: p = C(24,5)/C(48,5) ≈ 0.0248).
  const sig = linux(arm("1.4.2", 0), arm("1.4.5", 5));
  assert.deepEqual(verdict(sig), [["1.4.5", false, true, true, false]]);
  assert.ok(Math.abs(sig.candidates[0].fisherP - 42504 / 1712304) < 1e-9);
  // Not stable at n = 7 (6 of 24), although no worse than the reference.
  assert.deepEqual(verdict(linux(arm("1.4.2", 5), arm("1.4.5", 6))), [["1.4.5", false, true, false, true]]);
  // (i): one invalid run in the reference, or one run above the ceiling in the candidate.
  assert.deepEqual(verdict(linux(arm("1.4.2", 1, { valid: 23 }), arm("1.4.5", 1))), [["1.4.5", false, false, true, true]]);
  assert.deepEqual(verdict(linux(arm("1.4.2", 1), arm("1.4.5", 1, { overCeiling: [7] }))), [["1.4.5", false, false, true, true]]);
  // n is the job's: the same 5 of 24 is not stable at n = 5.
  assert.equal(reentryReading([arm("1.4.2", 1), arm("1.4.5", 5)], { os: "linux", n: 5, jobBun: "1.4.2+x" }).candidates[0].checks.ii.pass, false);
  // Windows: (i) and (iv) only.
  const win = reentryReading([arm("1.4.2", 12), arm("1.4.3", 17, { medianMB: 300 }), arm("1.4.4", 19, { medianMB: 300.1 })], { os: "windows", n: 7, jobBun: "1.4.2+x" });
  assert.deepEqual(win.candidates.map((c) => [c.bun, Object.keys(c.checks).sort().join(), c.pass]), [["1.4.3", "i,iv", true], ["1.4.4", "i,iv", false]]);
  // Cautions: not 24 per arm; the reference arm is not the job's own Bun.
  const notes = reentryReading([arm("1.4.4", 0, { valid: 3, requested: 3 }), arm("1.4.2", 0, { valid: 3, requested: 3 })], { os: "linux", n: 7, jobBun: "1.4.2+744846f84" }).notes.join("\n");
  assert.match(notes, /24 valid runs per arm/);
  assert.match(notes, /reference arm 1\.4\.4 is not the job's own Bun \(1\.4\.2\+744846f84\)/);
  assert.match(reentryReading([arm("1.4.2", 0), arm("1.4.5", 0)], { os: "linux", n: 7, jobBun: null }).notes.join(), /not the job's own Bun \(unknown\)/);
});

test("paired measurement: arms interleaved in rotation, each run on its arm's Bun, per-arm counts and the re-entry reading at the job's n in the summary", () => {
  // Rotation 1.4.2, 1.4.3, 1.4.4 ×4: 1.4.2 never above 250, 1.4.3 once, 1.4.4 three times.
  const hwm = [230, 240, 260, 231, 255, 270, 229, 241, 280, 232, 242, 245];
  const { r, measure, measureMd, stepSummary, paths } = pairedJob({ spec: "4 bun=1.4.2,1.4.3,1.4.4", peaks: hwm.map((h) => ({ rss: 200, hwm: h })) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(measure.mode, "paired");
  assert.deepEqual(measure.reps.map((x) => x.bun), ["1.4.2", "1.4.3", "1.4.4", "1.4.2", "1.4.3", "1.4.4", "1.4.2", "1.4.3", "1.4.4", "1.4.2", "1.4.3", "1.4.4"]);
  assert.deepEqual(measure.reps.map((x) => x.rep), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(measure.reps.map((x) => x.bunRuntime), measure.reps.map((x) => `${x.bun}+fake${x.bun.replace(/\./g, "")}`), "the Bun the proxy ran, not the flag");
  assert.deepEqual(measure.reps.map((x) => x.bunPath), measure.reps.map((x) => paths[x.bun]));
  assert.ok(measure.reps.every((x) => x.valid));
  assert.deepEqual(measure.arms.map((a) => [a.bun, a.requested, a.valid, a.aboveBudget, a.complete]), [["1.4.2", 4, 4, 0, true], ["1.4.3", 4, 4, 1, true], ["1.4.4", 4, 4, 3, true]]);
  assert.deepEqual(measure.arms.map((a) => [a.env?.bun?.hardwareConcurrency, a.env?.nproc, a.env?.cgroup?.type, a.env?.cgroup?.memoryMax, a.env?.capRequested, a.envVariants]), Array(3).fill([4, 4, "v2-only", "3221225472", "3G", 1]), "the runtime environment once per arm; free memory alone does not make a variant");
  // The reading uses the job's own n (budgets.mjs REPEATED) and the first arm as the reference.
  assert.deepEqual([measure.n, measure.reading.reference, measure.reading.n, measure.reading.candidates.map((c) => c.bun)], [7, "1.4.2", 7, ["1.4.3", "1.4.4"]]);
  assert.match(measure.reading.notes.join("\n"), /24 valid runs per arm/);
  for (const text of [measureMd, stepSummary]) {
    assert.match(text, /S1\/burst1 paired Bun measurement \(linux, 4 runs per arm, rotation 1\.4\.2 → 1\.4\.3 → 1\.4\.4\)/);
    // 1 of 4 is p = 0.25, above the 0.225 that n = 7 still allows.
    assert.match(text, /stable unlisted \(P\(median of 7 RED\) ≤ 0\.05; ≤ 0 of 4\)/);
    assert.match(text, /\| 1\.4\.4 \| 4 of 4 \| 3 \| FAIL \|/);
    assert.match(text, /Fisher one-sided p, 1\.4\.4 vs 1\.4\.2: \d/);
    assert.match(text, /Fisher one-sided p, 1\.4\.3 vs 1\.4\.2: \d/);
    assert.match(text, /Re-entry reading \(Round 11 Q1 condition 4, linux leg, mechanical; reference 1\.4\.2, n = 7\)/);
    assert.match(text, /\| 1\.4\.4 \| pass: [^|]* \| FAIL: 3 of 4 above the budget[^|]* \| [^|]* \| \*\*fails\*\* \|/);
    assert.match(text, /\| 3 \| 1\.4\.4 \| 1\.4\.4\+fake144 \| RED \| 260 \|/);
  }
});

test("paired measurement: the job's own Bun is the reference check; a marker that lists another Bun first is flagged", linuxOnly, () => {
  const home = mkdtempSync(join(tmpdir(), "memloop-jobbun-"));
  try {
    const own = join(home, "bun");
    writeFileSync(own, "#!/bin/sh\nprintf '1.4.2+744846f84\\n'\n", { mode: 0o755 });
    const peaks = Array.from({ length: 2 }, () => ({ rss: 200, hwm: 230 }));
    const ok = pairedJob({ spec: "1 bun=1.4.2,1.4.4", arms: ["1.4.2", "1.4.4"], peaks, jobBunEnv: own });
    assert.equal(ok.measure.jobBun, "1.4.2+744846f84");
    assert.equal(ok.measure.reading.notes.some((n) => /not the job's own Bun/.test(n)), false);
    const flipped = pairedJob({ spec: "1 bun=1.4.4,1.4.2", arms: ["1.4.2", "1.4.4"], peaks, jobBunEnv: own });
    assert.match(flipped.measure.reading.notes.join(), /reference arm 1\.4\.4 is not the job's own Bun \(1\.4\.2\+744846f84\): list the pinned Bun first/);
    assert.match(flipped.measureMd, /Caution: the reference arm 1\.4\.4 is not the job's own Bun/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("paired measurement on Windows: the re-entry reading checks (i) and (iv) only", () => {
  // Rotation ×2: 1.4.4's median 305 is above 300; 1.4.3 has one run above 400.
  const ws = [250, 260, 300, 252, 410, 310].map((w) => ({ ws: w, wsPeak: w, commit: 420 }));
  const { r, measure, measureMd } = pairedJob({ spec: "2 bun=1.4.2,1.4.3,1.4.4", peaks: ws, shape: "win32" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(measure.reading.candidates.map((c) => [c.bun, c.checks.i.pass, c.checks.iv.pass, "ii" in c.checks, c.pass]), [["1.4.3", false, false, false, false], ["1.4.4", true, false, false, false]]);
  assert.match(measureMd, /Re-entry reading \(Round 11 Q1 condition 4, windows leg/);
  assert.match(measureMd, /\| 1\.4\.3 \| FAIL: 1\.4\.3: 0 invalid, over the ceiling #5 \| FAIL: median 335 MB \(≤ 300\) \| \*\*fails\*\* \|/);
  assert.match(measureMd, /\| 1\.4\.2 \| 2 of 2 \| 1 \| FAIL \| none \| 250 \/ 251 \/ 252 \| 420 \/ 420 \|/);
});

test("paired measurement: a run whose proxy ran another Bun than its arm, or reported none, is invalid and the measurement exits 2", () => {
  const peaks = Array.from({ length: 6 }, () => ({ rss: 200, hwm: 230 }));
  const wrong = pairedJob({ spec: "2 bun=1.4.2,1.4.3,1.4.4", peaks, revisions: (v) => (v === "1.4.3" ? "1.4.4+38afee6c8" : `${v}+x`) });
  assert.equal(wrong.r.status, 2, wrong.r.stdout + wrong.r.stderr);
  assert.deepEqual(wrong.measure.reps.map((x) => x.valid), [true, false, true, true, false, true]);
  assert.match(wrong.measure.reps[1].problems.join(), /proxy ran Bun 1\.4\.4\+38afee6c8, not the 1\.4\.3 arm/);
  assert.deepEqual(wrong.measure.reading.candidates.map((c) => [c.bun, c.checks.i.pass]), [["1.4.3", false], ["1.4.4", true]], "re-entry check (i): an invalid run fails its arm");
  const none = pairedJob({ spec: "1 bun=1.4.2,1.4.4", arms: ["1.4.2", "1.4.4"], peaks, revisions: () => "" });
  assert.equal(none.r.status, 2);
  assert.ok(none.measure.reps.every((x) => !x.valid && /no runtime Bun version recorded for the proxy/.test(x.problems.join())));
});

test("--bun exists only in measurement mode and must match the marker's arms exactly, refused before anything runs", () => {
  const peaks = [{ rss: 200, hwm: 230 }];
  const cases = {
    "no measurement mode": { spec: null },
    "plain-N marker": { spec: "3" },
    "marker arms without --bun": { spec: "3 bun=1.4.2,1.4.3,1.4.4", bunArg: null },
    "an arm without a path": { spec: "3 bun=1.4.2,1.4.3,1.4.4", arms: ["1.4.2", "1.4.4"] },
    "a path for no arm": { spec: "3 bun=1.4.2,1.4.4", arms: ["1.4.2", "1.4.3", "1.4.4"] },
    "a missing binary": { spec: "3 bun=1.4.2,1.4.4", arms: ["1.4.2", "1.4.4"], bunArg: "1.4.2=/nonexistent/bun,1.4.4=/nonexistent/bun2" },
    "a malformed list": { spec: "3 bun=1.4.2,1.4.4", bunArg: "1.4.2" },
  };
  for (const [label, c] of Object.entries(cases)) {
    const { r, files } = pairedJob({ peaks, ...c });
    assert.equal(r.status, 2, `${label}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--bun|--measure-burst1/, label);
    assert.deepEqual(files, [], `${label}: nothing ran`);
  }
});

test("keep-bun-arm: an arm's binary is kept only if its --revision is that version; a mislabelled one is removed and the step fails", linuxOnly, () => {
  const home = mkdtempSync(join(tmpdir(), "memloop-keeparm-"));
  try {
    const fake = (name, revision) => { const p = join(home, name, "bun"); mkdirSync(join(home, name)); writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' '${revision}'\n`, { mode: 0o755 }); return p; };
    const script = join(KIT_ROOT, "tests", "memory", "lib", "keep-bun-arm.mjs");
    const arms = join(home, "arms");
    const ok = spawnSync(process.execPath, [script, fake("a", "1.4.3+c6da4a4d3"), "1.4.3", arms], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(spawnSync(join(arms, "1.4.3", "bun"), ["--revision"], { encoding: "utf8" }).stdout.trim(), "1.4.3+c6da4a4d3");
    // setup-bun's ~/.bun/bin already overwritten by the next version: refused.
    const bad = spawnSync(process.execPath, [script, fake("b", "1.4.4+38afee6c8"), "1.4.2", arms], { encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /reports "1\.4\.4\+38afee6c8", not Bun 1\.4\.2/);
    assert.equal(readdirSync(arms).includes("1.4.2"), false, "nothing is left for the job to pick up");
    // "1.4.30+…" is not 1.4.3.
    assert.equal(spawnSync(process.execPath, [script, fake("c", "1.4.30+x"), "1.4.3", join(home, "arms2")], { encoding: "utf8" }).status, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("runtime environment: cgroup type from the filesystem magic, the scope's MemoryMax from /proc/self/cgroup", async () => {
  const { cgroupInfo } = await import("./lib/runtime-probe.mjs");
  const files = {
    "/sys/fs/cgroup/user.slice/run-r1.scope/memory.max": "3221225472\n",
    "/sys/fs/cgroup/unified/user.slice/run-r2.scope/memory.max": "max\n",
    "/sys/fs/cgroup/memory/user.slice/memory.limit_in_bytes": "9223372036854771712\n",
  };
  const fsLike = (types) => ({ statfsType: (p) => types[p] ?? null, read: (p) => files[p] ?? null, exists: (p) => p in types });
  const v2 = cgroupInfo({ procSelfCgroup: "0::/user.slice/run-r1.scope\n", ...fsLike({ "/sys/fs/cgroup": 0x63677270 }) });
  assert.deepEqual([v2.type, v2.memoryMax], ["v2-only", "3221225472"]);
  const hybrid = cgroupInfo({ procSelfCgroup: "12:memory:/user.slice\n0::/user.slice/run-r2.scope\n", ...fsLike({ "/sys/fs/cgroup": 0x01021994, "/sys/fs/cgroup/unified": 0x63677270 }) });
  assert.deepEqual([hybrid.type, hybrid.memoryMax, hybrid.v1MemoryLimit], ["hybrid", "max", "9223372036854771712"]);
  const v1 = cgroupInfo({ procSelfCgroup: "12:memory:/user.slice\n", ...fsLike({ "/sys/fs/cgroup": 0x01021994 }) });
  assert.deepEqual([v1.type, v1.memoryMax], ["v1-only", null]);
});

test("job: windows S1/burst1 against the committed list (no entry since ticket 20) is GREEN at a median of 230 and fails the ratchet at a median of 251", () => {
  const ws = (...xs) => xs.map((w) => ({ ws: w, wsPeak: w, commit: 410 }));
  // Seven repetitions: the job's n since Round 11 Q1 condition 2 (budgets.mjs REPEATED).
  const green = burst1Job(["--only", "S1/burst1"], { shape: "win32", peaks: ws(230, 220, 240, 235, 225, 260, 228) });
  assert.equal(green.r.status, 0, green.r.stdout + green.r.stderr);
  assert.equal(green.job.results[0].repetitions.length, 7);
  assert.doesNotMatch(green.stepSummary, /unstable|owned by ticket 20/);
  // The band that tolerated a median of 251-300 left with the entry: 251 is now an unlisted RED.
  const red = burst1Job(["--only", "S1/burst1"], { shape: "win32", peaks: ws(255, 251, 240, 262, 230, 280, 245) });
  assert.equal(red.r.status, 1, red.r.stdout + red.r.stderr);
  assert.match(red.stepSummary, /S1\/burst1: RED but not listed in expected-red\.json \(windows\)/);
  assert.doesNotMatch(red.stepSummary, /owned by ticket 20/);
});

// ── windows S5/short at the job seam (Round 13 Q1, ticket 66) ──────────────────
// The real windows S5/short summary.json of CI run 42404639968 (staging/65, the
// RED run: growth:mcp-bridge 23.71 %/1k commit, trend true) and of run
// 42401136452 (staging/42, GREEN: 15.55, trend false), replayed through the job
// against the committed list. Variants of the RED one are the adversaries.
const CI_S5_RED = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ci-42404639968-s5-short-windows-summary.json");
const CI_S5_GREEN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ci-42401136452-s5-short-windows-summary.json");

function s5ReplayJob(summary) {
  const home = mkdtempSync(join(tmpdir(), "memloop-s5-"));
  const stepSummary = join(home, "step-summary.md");
  writeFileSync(stepSummary, "");
  let path = summary;
  if (typeof summary !== "string") { path = join(home, "summary.json"); writeFileSync(path, JSON.stringify(summary)); }
  const r = runJob(["--os", "windows", "--only", "S5/short", "--cap", "none", "--out", join(home, "job"), "--run-script", FAKE_RUN], { ZCODE_OVERHAUL_RUN: "1", HOME: home, FAKE_RUN_MODE: "replay", FAKE_RUN_SUMMARY: path, GITHUB_STEP_SUMMARY: stepSummary });
  let job = null;
  try { job = JSON.parse(readFileSync(join(home, "job", "job-summary.json"), "utf8")); } catch {}
  const out = { r, job, row: job?.rows?.[0], result: job?.results?.[0], stepSummary: readFileSync(stepSummary, "utf8") };
  rmSync(home, { recursive: true, force: true });
  return out;
}

/** The RED CI summary with its growth:mcp-bridge check (and outcome) changed. */
function s5Variant(change) {
  const s = JSON.parse(readFileSync(CI_S5_RED, "utf8"));
  change(s, s.checks.find((c) => c.name === "growth:mcp-bridge"));
  s.red = s.checks.some((c) => c.red);
  s.outcome = s.red ? "RED" : "GREEN";
  return s;
}

test("job: the windows S5/short runs of CI 42404639968 (RED) and 42401136452 (GREEN) pass as unstable, owned by ticket 74", () => {
  for (const [fixture, outcome, line] of [
    [CI_S5_RED, "RED", "S5/short: unstable (growth:mcp-bridge 23.71 %/1k commit, budget 5, bound 30, trend true), owned by ticket 74"],
    [CI_S5_GREEN, "GREEN", "S5/short: unstable (growth:mcp-bridge 15.55 %/1k commit, budget 5, bound 30, trend false), owned by ticket 74"],
  ]) {
    const { r, row, result, stepSummary } = s5ReplayJob(fixture);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual([row.outcome, row.ticket, row.state, row.note], [outcome, "74", "unstable", line]);
    assert.deepEqual(result.growthChecks.map((g) => [g.name, g.commitValue, g.gate, g.trend, g.insufficient]), [["growth:mcp-bridge", outcome === "RED" ? 23.71 : 15.55, "commit", outcome === "RED", false]]);
    for (const text of [r.stdout, stepSummary]) {
      assert.ok(text.includes(`- ${line}`), text);
      assert.ok(text.includes(`| S5/short | ${outcome} (unstable) | ticket 74 |`), text);
    }
  }
});

test("job: the replayed windows S5/short fails above 30, at 5, with another RED check, or without a growth value", () => {
  const cases = {
    "30.01": [s5Variant((s, g) => Object.assign(g, { value: 30.01, commitValue: 30.01 })), /S5\/short: unstable growth:mcp-bridge 30\.01 %\/1k \(commit\) is above the 30 %\/1k bound/],
    "5, no trend": [s5Variant((s, g) => Object.assign(g, { value: 5, commitValue: 5, red: false, trend: false })), /S5\/short: growth:mcp-bridge 5 %\/1k \(commit\) is at budget \(≤ 5\) but listed for ticket 74/],
    orphans: [s5Variant((s) => Object.assign(s.checks.find((c) => c.name === "orphans"), { red: true, value: 1 })), /S5\/short: RED on orphans: the unstable entry accepts only growth:mcp-bridge/],
    "task failures": [s5Variant((s) => Object.assign(s.checks.find((c) => c.name === "bridge:task-failures"), { red: true, value: 1 })), /S5\/short: RED on bridge:task-failures/],
    "reboot cost 21": [s5Variant((s) => Object.assign(s.checks.find((c) => c.name === "bridge:reboot-cost-of-history"), { red: true, value: 21 })), /S5\/short: RED on bridge:reboot-cost-of-history/],
    "procPeak 151 WS": [s5Variant((s) => Object.assign(s.checks.find((c) => c.name === "procPeak:mcp-bridge"), { red: true, value: 151, wsValue: 151 })), /S5\/short: RED on procPeak:mcp-bridge/],
    insufficient: [s5Variant((s, g) => { for (const k of ["value", "commitValue", "wsValue"]) delete g[k]; Object.assign(g, { red: false, trend: false, detail: { samples: 3, insufficient: true } }); }), /S5\/short: unstable entry without a commit value of growth:mcp-bridge \(insufficient: 3 samples\): a measurement gap/],
    "no growth check": [s5Variant((s) => { s.checks = s.checks.filter((c) => c.name !== "growth:mcp-bridge"); }), /S5\/short: unstable entry without a commit value of growth:mcp-bridge \(no growth:mcp-bridge check\): a measurement gap/],
  };
  for (const [label, [summary, pattern]] of Object.entries(cases)) {
    const { r, row, stepSummary } = s5ReplayJob(summary);
    assert.equal(r.status, 1, `${label}: ${r.stdout}${r.stderr}`);
    assert.match(stepSummary, pattern, label);
    assert.equal(row.note, undefined, label);
    assert.doesNotMatch(stepSummary, /owned by ticket 74/, label);
  }
});

// ── The job prints every tolerated RED (Round 14 Q1 condition 2) ───────────────
// The real S3/omp run (fixtures/local-20261107-s3-omp-linux-summary.json, RED on
// omp:concurrent-preflights only) replayed through the job against the committed
// list: its row and the summary say which checks were RED and which ticket owns
// them. An orphan more, or the owned check renamed in the run, fails the job.
function s3ompReplay(change = null) {
  const dir = mkdtempSync(join(tmpdir(), "memloop-owns-"));
  try {
    let path = S3_OMP_RUN;
    if (change) {
      const s = JSON.parse(readFileSync(S3_OMP_RUN, "utf8"));
      change(s);
      s.red = s.checks.some((c) => c.red);
      s.outcome = s.red ? "RED" : "GREEN";
      path = join(dir, "summary.json");
      writeFileSync(path, JSON.stringify(s));
    }
    return fakeJob("replay", "S3/omp", { FAKE_RUN_SUMMARY: path });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("job: a listed run RED only on its owned checks passes and the summary prints the tolerated RED with its owner", () => {
  const { r, row, result } = s3ompReplay();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const line = "S3/omp: RED on omp:concurrent-preflights, owned by ticket 35 (omp:concurrent-preflights)";
  assert.equal(row.note, line);
  assert.ok(result.checkNames.includes("omp:concurrent-preflights") && result.checkNames.includes("orphans"), result.checkNames.join());
  assert.ok(r.stdout.includes("| S3/omp | RED | tickets 35, 37 |"), r.stdout);
  assert.match(r.stdout, /Tolerated REDs and flipping GREENs \(Round 14 Q1, Round 15 Q1[^\n]*\n- S3\/omp: RED on omp:concurrent-preflights, owned by ticket 35 \(omp:concurrent-preflights\)/);
});

test("job: an unowned RED or an owned check the run no longer produces fails the job, with no tolerated line", () => {
  const orphan = s3ompReplay((s) => Object.assign(s.checks.find((c) => c.name === "orphans"), { red: true, value: 1 }));
  assert.equal(orphan.r.status, 1, orphan.r.stdout);
  assert.match(orphan.r.stdout, /- S3\/omp: RED on orphans, not owned by tickets 35, 37 \(linux, Round 14 Q1, Round 15 Q1\); the RED comes back as an ownership question, do not edit owners/);
  assert.equal(orphan.row.note, undefined);
  const renamed = s3ompReplay((s) => { s.checks.find((c) => c.name === "omp:concurrent-preflights").name = "omp:parallel-preflights"; });
  assert.equal(renamed.r.status, 1, renamed.r.stdout);
  assert.match(renamed.r.stdout, /- S3\/omp: ticket 35 owns omp:concurrent-preflights, which this run does not produce: a stale or mistyped name/);
  assert.match(renamed.r.stdout, /- S3\/omp: RED on omp:parallel-preflights, not owned by tickets 35, 37/);
  assert.doesNotMatch(renamed.r.stdout, /owned by ticket 35 \(/);
});

// Round 15 Q1 condition 4: the committed linux S3/omp entry marks 37's role peaks as
// flipping, so the run GREEN on every check (35's fix landed, the peaks did not flip
// RED this time) passes with its line; the same run RED on an unowned check still fails.
test("job: a GREEN run of a listed entry with flipping checks passes and the summary says which checks flip and whose they are", () => {
  const green = s3ompReplay((s) => Object.assign(s.checks.find((c) => c.name === "omp:concurrent-preflights"), { red: false, value: 1 }));
  assert.equal(green.r.status, 0, green.r.stdout + green.r.stderr);
  const line = "S3/omp: GREEN, listed for ticket 37 on flipping checks procPeak:proxy, procPeak:preflight (Round 15 Q1)";
  assert.equal(green.row.outcome, "GREEN");
  assert.equal(green.row.note, line);
  assert.ok(green.r.stdout.includes(`- ${line}`), green.r.stdout);
  const greenOrphan = s3ompReplay((s) => {
    Object.assign(s.checks.find((c) => c.name === "omp:concurrent-preflights"), { red: false, value: 1 });
    Object.assign(s.checks.find((c) => c.name === "orphans"), { red: true, value: 1 });
  });
  assert.equal(greenOrphan.r.status, 1, greenOrphan.r.stdout);
  assert.equal(greenOrphan.row.note, undefined);
});

// ── linux S5/short GREEN on the trend flag (Round 17 Q2) ───────────────────────
// The real linux S5/short summary of CI run 42436186573 (staging/67, ticket 13's
// tree): growth:mcp-bridge 39.53 %/1k RSS, eight times the 5 %/1k budget, GREEN
// only because the net rise (9.7 %) missed the 10 % trend branch. Replayed through
// the job against the committed list, it passes on the flipping mark and says so;
// the same run with an orphan fails.
const CI_S5_LINUX_GREEN = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ci-42436186573-s5-short-linux-summary.json");

function s5LinuxReplay(change = null) {
  const home = mkdtempSync(join(tmpdir(), "memloop-s5l-"));
  try {
    let path = CI_S5_LINUX_GREEN;
    if (change) {
      const s = JSON.parse(readFileSync(CI_S5_LINUX_GREEN, "utf8"));
      change(s);
      s.red = s.checks.some((c) => c.red);
      s.outcome = s.red ? "RED" : "GREEN";
      path = join(home, "summary.json");
      writeFileSync(path, JSON.stringify(s));
    }
    return fakeJob("replay", "S5/short", { FAKE_RUN_SUMMARY: path });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ── S7 responses store: retained heap (Round 17 Q1, ticket 71) ───────────────
// heap-at-cap is the minimum of ≥ 30 /health heapUsedMB readings 1 s apart
// after the existing 5 s wait, minus the reading before the load (h0). The fake
// run reads its fixture series through the scenario's own reader and judge
// (lib/retained-heap.mjs) from a fake /health, then the job and the ratchet
// judge it against the committed list (S7/short: 33 owns proxy.log, RED as on CI).
function s7Job({ before = { heapUsedMB: 20, rssMB: 140 }, readings }) {
  const home = mkdtempSync(join(tmpdir(), "memloop-s7-"));
  const r = runJob(["--os", "linux", "--only", "S7/short", "--cap", "none", "--out", join(home, "job"), "--run-script", FAKE_RUN], { ZCODE_OVERHAUL_RUN: "1", HOME: home, FAKE_RUN_MODE: "s7-series", FAKE_RUN_HEAP: JSON.stringify({ before, readings }) });
  let report = null, summary = null;
  try { report = JSON.parse(readFileSync(join(home, "job", "job-summary.json"), "utf8")); } catch {}
  try { const d = join(home, "job", "S7-short"); summary = JSON.parse(readFileSync(join(d, readdirSync(d).find((n) => n.endsWith("-fake")), "summary.json"), "utf8")); } catch {}
  rmSync(home, { recursive: true, force: true });
  const heap = summary?.checks?.find((c) => c.name === "responses-store:heap-at-cap") ?? null;
  return { r, report, summary, heap, row: report?.rows?.[0], result: report?.results?.[0] };
}
// Absolute heapUsedMB readings: h0 (20) plus the heap growth the round names.
const above = (...growth) => growth.map((g) => 20 + g);
const padTo = (xs, n, last = xs.at(-1)) => [...xs, ...Array.from({ length: n - xs.length }, () => last)];

test("S7 retained heap: a series [98, 97, 80, 64, …] is GREEN on its minimum, and the check records first, minimum, maximum and RSS before and after", () => {
  const { r, heap, row, summary } = s7Job({ readings: padTo(above(98, 97, 80, 64, 63, 65), 30).map((h, i) => ({ heapUsedMB: h, rssMB: 300 - i })) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(row.outcome, "RED", "RED only on 33's proxy.log check");
  assert.equal(row.note, "S7/short: RED on proxy.log:bounded-while-running, owned by ticket 33 (proxy.log:bounded-while-running)");
  assert.deepEqual([heap.red, heap.value, heap.budget], [false, 63, 96]);
  assert.deepEqual(
    { readings: heap.detail.readings, intervalMs: heap.detail.intervalMs, h0MB: heap.detail.h0MB, firstMB: heap.detail.firstMB, minMB: heap.detail.minMB, maxMB: heap.detail.maxMB, firstReadingGrowthMB: heap.detail.firstReadingGrowthMB, rssBeforeMB: heap.detail.rssBeforeMB, rssAfterMB: heap.detail.rssAfterMB, rssLastMB: heap.detail.rssLastMB },
    { readings: 30, intervalMs: 1000, h0MB: 20, firstMB: 118, minMB: 83, maxMB: 118, firstReadingGrowthMB: 98, rssBeforeMB: 140, rssAfterMB: 300, rssLastMB: 271 },
  );
  assert.equal(heap.detail.seriesMB.length, 30);
  assert.deepEqual(summary.notes.responsesStore.heapSeriesMB, heap.detail.seriesMB, "summary.json records the series too");
  assert.match(r.stdout, /S7\/short responses-store:heap-at-cap: 63 MB = min 83 − h0 20 over 30 readings 1 s apart \(first 118, max 118; rss 140 → 300 … 271\) ok/);
});

test("S7 retained heap: a series that never drops below 97 is RED, an unowned RED that fails the job", () => {
  const { r, heap, row } = s7Job({ readings: padTo(above(99, 98, 97, 101), 30, 117).map((h) => ({ heapUsedMB: h, rssMB: 300 })) });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.deepEqual([heap.red, heap.value, heap.detail.minMB, heap.detail.firstMB], [true, 97, 117, 119]);
  assert.match(r.stdout, /- S7\/short: RED on responses-store:heap-at-cap, not owned by ticket 33/);
  assert.equal(row.note, undefined);
});

test("S7 retained heap: a missing or non-numeric reading is a harness failure, never GREEN", () => {
  const good = padTo(above(70, 64), 30).map((h) => ({ heapUsedMB: h, rssMB: 300 }));
  for (const [label, bad] of [["no /health answer", null], ["no heapUsedMB", { rssMB: 300 }], ["non-numeric", { heapUsedMB: "64", rssMB: 300 }], ["NaN", { heapUsedMB: Number.NaN, rssMB: 300 }]]) {
    const readings = good.map((x, i) => (i === 7 ? bad : x));
    const { r, row, result, heap } = s7Job({ readings });
    assert.equal(row?.outcome, "HARNESS FAILURE", `${label}: ${r.stdout}${r.stderr}`);
    assert.equal(heap, null, label);
    assert.match(result.error, /reading 8 of 30/, label);
    assert.equal(r.status, 1, label);
  }
  const noH0 = s7Job({ before: { rssMB: 140 }, readings: good });
  assert.equal(noH0.row?.outcome, "HARNESS FAILURE", noH0.r.stdout);
  assert.match(noH0.result.error, /no heapUsedMB before the load/);
});

test("S7 retained heap: a series shorter than 30 readings is a harness failure", () => {
  const { r, row, result } = s7Job({ readings: padTo(above(70, 64), 29).map((h) => ({ heapUsedMB: h, rssMB: 300 })) });
  assert.equal(row?.outcome, "HARNESS FAILURE", r.stdout + r.stderr);
  assert.match(result.error, /29 readings, need ≥ 30/);
});

// ── windows S1/short: 5 fresh repetitions (Round 17 Q3, ticket 71) ──────────
// growth:proxy is RED when ≥ 3 of 5 repetitions are RED under the unchanged
// growth() (commit > 5 AND trend), the reported value is the median, every
// repetition must stay ≤ 10 %/1k on commit, and every other check is judged in
// each repetition. The fake run's s1-reps mode writes one windows-shaped
// S1/short summary per repetition (rep-<i> in --out) from FAKE_RUN_REPS.
// Linux S1/short stays a single run.
function s1ShortJob(reps, { os = "windows" } = {}) {
  const home = mkdtempSync(join(tmpdir(), "memloop-s1short-"));
  const stepSummary = join(home, "step-summary.md");
  writeFileSync(stepSummary, "");
  const r = runJob(["--os", os, "--only", "S1/short", "--cap", "none", "--out", join(home, "job"), "--run-script", FAKE_RUN], { ZCODE_OVERHAUL_RUN: "1", HOME: home, FAKE_RUN_MODE: "s1-reps", FAKE_RUN_REPS: JSON.stringify(reps), FAKE_RUN_SHAPE: os === "windows" ? "win32" : "linux", GITHUB_STEP_SUMMARY: stepSummary });
  const read = (p) => { try { return JSON.parse(readFileSync(join(home, "job", p), "utf8")); } catch { return null; } };
  const out = { r, job: read("job-summary.json"), set: read(join("S1-short", "summary.json")), stepSummary: readFileSync(stepSummary, "utf8"), dirs: (() => { try { return readdirSync(join(home, "job", "S1-short")).sort(); } catch { return []; } })() };
  rmSync(home, { recursive: true, force: true });
  return { ...out, row: out.job?.rows?.[0], result: out.job?.results?.[0] };
}
// One repetition: commit growth %/1k and its trend flag (RED under growth() only with both).
const g = (growth, trend = growth > 5, extra = {}) => ({ growth, trend, ...extra });

test("windows S1/short: five fresh repetitions with 2 RED pass; summary.json and the job summary print all five values, trends and the median", () => {
  const { r, row, result, set, dirs, stepSummary } = s1ShortJob([g(5.27), g(3.1, false), g(5.4), g(3.6, true), g(2.9, false)]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(dirs, ["rep-1", "rep-2", "rep-3", "rep-4", "rep-5", "summary.json"]);
  assert.equal(row.outcome, "GREEN");
  assert.deepEqual(result.redChecks, []);
  assert.deepEqual([set.outcome, set.n, set.check, set.values, set.trends, set.redRepetitions, set.median, set.budget, set.redAtLeast, set.ceiling], ["GREEN", 5, "growth:proxy", [5.27, 3.1, 5.4, 3.6, 2.9], [true, false, true, true, false], [1, 3], 3.6, 5, 3, 10]);
  assert.equal(set.repetitions.length, 5);
  for (const text of [r.stdout, stepSummary]) {
    assert.match(text, /\| S1\/short \| 5 \| commit \| 5\.27, 3\.1, 5\.4, 3\.6, 2\.9 \| true, false, true, true, false \| #1, #3 \(2 of 5\) \| 3\.6 \| ≤ 5 \| ≥ 3 of 5 \| ≤ 10 \| none \|/);
  }
});

test("windows S1/short: 3 RED repetitions fail on growth:proxy; three values over 5 with one trend missing are 2 RED and pass", () => {
  const red = s1ShortJob([g(5.27), g(5.1), g(3.6, true), g(5.4), g(2.9, false)]);
  assert.equal(red.r.status, 1, red.r.stdout + red.r.stderr);
  assert.equal(red.row.outcome, "RED");
  assert.deepEqual([red.result.redChecks, red.set.median, red.set.redRepetitions], [["growth:proxy"], 5.1, [1, 2, 4]]);
  assert.match(red.r.stdout, /- S1\/short: RED but not listed in expected-red\.json \(windows\)/);
  const noTrend = s1ShortJob([g(5.27), g(5.1, false), g(3.6, true), g(5.4), g(2.9, false)]);
  assert.equal(noTrend.r.status, 0, noTrend.r.stdout);
  assert.deepEqual(noTrend.set.redRepetitions, [1, 4]);
});

test("windows S1/short: one repetition above 10 %/1k on commit fails with a GREEN median, trend or not; 10.0 is within the ceiling", () => {
  for (const trend of [true, false]) {
    const { r, result, set } = s1ShortJob([g(3.1, false), g(10.1, trend), g(3.4, false), g(3.6, true), g(2.9, false)]);
    assert.equal(r.status, 1, `${trend}: ${r.stdout}${r.stderr}`);
    assert.equal(set.median, 3.4);
    assert.deepEqual([result.redChecks, set.overCeiling], [["ceiling:growth:proxy"], [2]]);
  }
  assert.equal(s1ShortJob([g(3.1, false), g(10, true), g(3.4, false), g(3.6, true), g(2.9, false)]).r.status, 0);
});

test("windows S1/short: a RED steady, procPeak, count, orphans or commit-backstop in any one repetition fails the set", () => {
  for (const name of ["steady:proxy", "procPeak:proxy", "count:proxy", "orphans", "commit-backstop:proxy"]) {
    const { r, result } = s1ShortJob([g(3.1, false), g(3.2, false), g(3.4, false, { red: [name] }), g(3.6, true), g(2.9, false)]);
    assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
    assert.deepEqual(result.redChecks, [name], name);
  }
});

test("windows S1/short: a missing repetition or one without a growth value is a harness failure, and the set stops there", () => {
  const killed = s1ShortJob([g(3.1, false), g(3.2, false), g(3.4, false, { harness: "killed (memory cap 3G?)" }), g(3.6, true), g(2.9, false)]);
  assert.equal(killed.row.outcome, "HARNESS FAILURE", killed.r.stdout + killed.r.stderr);
  assert.match(killed.result.error, /repetition 3: /);
  assert.deepEqual(killed.dirs, ["rep-1", "rep-2", "rep-3", "summary.json"]);
  assert.equal(killed.r.status, 1);
  const insufficient = s1ShortJob([g(3.1, false), g(3.2, false), g(3.4, false), g(null, false), g(2.9, false)]);
  assert.equal(insufficient.row.outcome, "HARNESS FAILURE", insufficient.r.stdout);
  assert.match(insufficient.result.error, /repetition 4: no growth:proxy value/);
  const four = s1ShortJob([g(3.1, false), g(3.2, false), g(3.4, false), g(3.6, true)]);
  assert.equal(four.row.outcome, "HARNESS FAILURE", four.r.stdout);
});

test("linux S1/short stays a single run under the unchanged growth() verdict", () => {
  const { r, row, dirs, set } = s1ShortJob([g(5.27)], { os: "linux" });
  assert.equal(row.outcome, "RED", r.stdout + r.stderr);
  assert.equal(set, null, "no repetition set");
  assert.equal(dirs.some((d) => d.startsWith("rep-")), false, dirs.join());
});

// ── linux S6/short: the median of 5 fresh S6 body repetitions (Round 21 Q1, ticket 71) ──
// tui:adversarial-line-heap is judged on the median against 16 MB, every
// repetition ≤ 32 MB; orphans and the other tui checks in each repetition. The
// fake run's s6-reps mode writes one S6/short summary per repetition from
// FAKE_RUN_REPS: { adversarial (MB, or a non-number), red: [names], harness }.
function s6Job(reps) {
  const home = mkdtempSync(join(tmpdir(), "memloop-s6-"));
  const stepSummary = join(home, "step-summary.md");
  writeFileSync(stepSummary, "");
  const r = runJob(["--os", "linux", "--only", "S6/short", "--cap", "none", "--out", join(home, "job"), "--run-script", FAKE_RUN], { ZCODE_OVERHAUL_RUN: "1", HOME: home, FAKE_RUN_MODE: "s6-reps", FAKE_RUN_REPS: JSON.stringify(reps), GITHUB_STEP_SUMMARY: stepSummary });
  const read = (p) => { try { return JSON.parse(readFileSync(join(home, "job", p), "utf8")); } catch { return null; } };
  const out = { r, job: read("job-summary.json"), set: read(join("S6-short", "summary.json")), stepSummary: readFileSync(stepSummary, "utf8"), dirs: (() => { try { return readdirSync(join(home, "job", "S6-short")).sort(); } catch { return []; } })() };
  rmSync(home, { recursive: true, force: true });
  return { ...out, row: out.job?.rows?.[0], result: out.job?.results?.[0] };
}
const s6 = (...values) => values.map((v) => (typeof v === "object" && v !== null ? v : { adversarial: v }));

test("linux S6/short: [8, 8, 20, 8, 8] is GREEN on the median; summary.json and the job summary print all five values and the median", () => {
  const { r, row, set, dirs, stepSummary } = s6Job(s6(8, 8, 20, 8, 8));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(row.outcome, "GREEN");
  assert.deepEqual(dirs, ["rep-1", "rep-2", "rep-3", "rep-4", "rep-5", "summary.json"]);
  assert.deepEqual([set.n, set.check, set.values, set.medianMB, set.budgetMB, set.ceilingMB], [5, "tui:adversarial-line-heap", [8, 8, 20, 8, 8], 8, 16, 32]);
  for (const text of [r.stdout, stepSummary]) assert.match(text, /\| S6\/short \| 5 \| RSS \| 8, 8, 20, 8, 8 \| 8 \| ≤ 16 \| ≤ 32 \| none \|/);
});

test("linux S6/short: [20, 20, 20, 8, 8] is RED on the median; [8, 8, 33, 8, 8] is RED on the ceiling with a GREEN median", () => {
  const median = s6Job(s6(20, 20, 20, 8, 8));
  assert.equal(median.r.status, 1, median.r.stdout + median.r.stderr);
  assert.deepEqual([median.row.outcome, median.result.redChecks, median.set.medianMB], ["RED", ["median:tui:adversarial-line-heap"], 20]);
  assert.match(median.r.stdout, /- S6\/short: RED but not listed in expected-red\.json \(linux\)/);
  const ceiling = s6Job(s6(8, 8, 33, 8, 8));
  assert.equal(ceiling.r.status, 1, ceiling.r.stdout);
  assert.deepEqual([ceiling.result.redChecks, ceiling.set.medianMB, ceiling.set.overCeiling], [["ceiling:tui:adversarial-line-heap"], 8, [3]]);
  assert.equal(s6Job(s6(8, 8, 32, 8, 8)).r.status, 0, "32 MB is within the ceiling");
});

test("linux S6/short: a repetition with tui:long-line-heap, tui:log-pane-heap, tui:resize-storm-heap or orphans RED fails", () => {
  for (const name of ["tui:long-line-heap", "tui:log-pane-heap", "tui:resize-storm-heap", "orphans"]) {
    const { r, result } = s6Job(s6(8, 8, { adversarial: 8, red: [name] }, 8, 8));
    assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
    assert.deepEqual(result.redChecks, [name], name);
  }
});

test("linux S6/short: a missing repetition or a non-numeric value is a harness failure, never GREEN", () => {
  const killed = s6Job(s6(8, 8, { harness: "s6 body exited 1" }, 8, 8));
  assert.equal(killed.row.outcome, "HARNESS FAILURE", killed.r.stdout + killed.r.stderr);
  assert.match(killed.result.error, /repetition 3: s6 body exited 1/);
  assert.equal(s6Job(s6(8, 8, 8, 8)).row.outcome, "HARNESS FAILURE");
  for (const bad of ["8", null, "Infinity"]) {
    const { row, result, r } = s6Job(s6(8, 8, 8, { adversarial: bad }, 8));
    assert.equal(row.outcome, "HARNESS FAILURE", `${bad}: ${r.stdout}`);
    assert.match(result.error, /repetition 4: no tui:adversarial-line-heap value/, String(bad));
  }
});

test("job: the linux S5/short run of CI 42436186573 (GREEN on the trend flag at 39.53 %/1k) passes on its flipping mark, owned by ticket 74", () => {
  const { r, row, result } = s5LinuxReplay();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(row.outcome, "GREEN");
  assert.deepEqual(result.growthChecks.map((g) => [g.name, g.value, g.trend]), [["growth:mcp-bridge", 39.53, false]]);
  const line = "S5/short: GREEN, listed for ticket 74 on flipping checks growth:mcp-bridge (Round 15 Q1)";
  assert.equal(row.note, line);
  assert.ok(r.stdout.includes(`- ${line}`), r.stdout);
  const orphan = s5LinuxReplay((s) => Object.assign(s.checks.find((c) => c.name === "orphans"), { red: true, value: 1 }));
  assert.equal(orphan.r.status, 1, orphan.r.stdout);
  assert.match(orphan.r.stdout, /- S5\/short: RED on orphans, not owned by ticket 74 \(linux, Round 14 Q1, Round 15 Q1\)/);
});

// Ticket 16: the kill-holder adversary SIGKILLs one of the round's own
// launches (the lock holder). That launch was ended by the scenario and is
// reported apart; every OTHER launch that did not exit 0 is a failed launch,
// so `failed-launches` (budget 0, "incl. a killed lock holder") can be met.
test("S3 failed launches leave out only the launch the kill-holder adversary killed, matched by pid", () => {
  const results = [
    { i: 0, via: "preflight", pid: 101, code: null, tail: "starting zcode-proxy ..." },
    { i: 1, via: "preflight", pid: 102, code: 0, tail: "ok" },
    { i: 2, via: "preflight", pid: 103, code: 4, tail: "safe start refused" },
    { i: 3, via: "preflight", pid: 104, code: null, tail: "killed by something else" },
  ];
  assert.deepEqual(s3Scenario.launchOutcomes(results, { killed: 101, afterMs: 150 }), {
    failedLaunches: ["preflight#2 code=4 safe start refused", "preflight#3 code=null killed by something else"],
    killedByAdversary: ["preflight#0 code=null starting zcode-proxy ..."],
  });
  // No adversary, or one that killed nobody: every non-zero launch counts.
  for (const adversary of [null, { killed: null, reason: "no holder observed" }]) {
    assert.equal(s3Scenario.launchOutcomes(results, adversary).failedLaunches.length, 3);
  }
  // A victim pid that exited 0 (the kill came too late) is neither.
  assert.deepEqual(s3Scenario.launchOutcomes([{ i: 0, via: "preflight", pid: 101, code: 0 }], { killed: 101 }), { failedLaunches: [], killedByAdversary: [] });
});

// Owner Proxy round 27 Q1 condition 2: pid matching may only ever make the
// count stricter. Windows reuses pids quickly; a pid carried by two launches
// of the round names no single victim, so neither is left out.
test("S3 failed launches: a killed pid carried by two launches leaves neither out (a reused pid never hides a real failure)", () => {
  const results = [
    { i: 0, via: "preflight", pid: 101, code: null, tail: "starting zcode-proxy ..." },
    { i: 1, via: "preflight", pid: 101, code: 4, tail: "[zcode-preflight] cause=startup" },
    { i: 2, via: "preflight", pid: 102, code: 0, tail: "ok" },
  ];
  assert.deepEqual(s3Scenario.launchOutcomes(results, { killed: 101, afterMs: 150 }), {
    failedLaunches: ["preflight#0 code=null starting zcode-proxy ...", "preflight#1 code=4 [zcode-preflight] cause=startup"],
    killedByAdversary: [],
  });
});

// ── The kill-holder round counts only with its victim (Owner Proxy round 27 Q1
// condition 2). A real S3/short run on ticket 16's tree (Linux, Bun 1.4.2,
// 2026-11-08): the adversary SIGKILLed preflight#6 (pid 31679), the other 9
// launches exited 0. Every other adversary state is a harness failure that
// names the round and prints the adversary record, never a verdict.
const S3_SHORT_RUN = join(dirname(CI_S3_HUNG), "local-20261108-s3-short-linux-summary.json");
const KILL_HOLDER_RULE = /a kill-holder round counts only with exactly one launch that carries the killed pid and exited non-zero/;

function replayKillHolder(edit) {
  const run = JSON.parse(readFileSync(S3_SHORT_RUN, "utf8"));
  const rounds = run.notes.rounds.map((r) => (r.name === "kill-holder-10" ? edit(structuredClone(r)) : r));
  const dir = mkdtempSync(join(tmpdir(), "memloop-killholder-"));
  try {
    const file = join(dir, "summary.json");
    writeFileSync(file, JSON.stringify({ ...run, notes: { ...run.notes, rounds } }));
    return fakeJob("replay", "S3/short", { FAKE_RUN_SUMMARY: file });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("job: a real S3/short run whose kill-holder round killed exactly one of its launches keeps its verdict", () => {
  const { r, row } = replayKillHolder((round) => round);
  assert.equal(row?.outcome, "RED", r.stdout + r.stderr);
  assert.equal(r.status, 0, "RED only on ticket 37's listed names");
});

test("job: a kill-holder round whose adversary recorded no kill is a harness failure, not GREEN", () => {
  for (const adversary of [{ killed: null, reason: "no holder observed" }, null]) {
    const { r, row, result } = replayKillHolder((round) => ({ ...round, adversary }));
    assert.equal(row?.outcome, "HARNESS FAILURE", r.stdout + r.stderr);
    assert.match(result.error, /round kill-holder-10: the adversary recorded no kill/);
    assert.match(result.error, KILL_HOLDER_RULE);
    assert.ok(result.error.includes(`(adversary ${JSON.stringify(adversary)})`), result.error);
  }
});

test("job: a kill-holder round whose killed pid matches no launch is a harness failure", () => {
  const stranger = replayKillHolder((round) => ({ ...round, adversary: { ...round.adversary, killed: 2147483000 } }));
  assert.equal(stranger.row?.outcome, "HARNESS FAILURE", stranger.r.stdout + stranger.r.stderr);
  assert.match(stranger.result.error, /round kill-holder-10: the killed pid 2147483000 matches no launch/);
  assert.match(stranger.result.error, KILL_HOLDER_RULE);
  assert.match(stranger.result.error, /\(adversary \{"killed":2147483000,"afterMs":167,/);
  // A round that recorded no launch pids (every summary before ticket 16) proves no match either.
  const unrecorded = replayKillHolder(({ launches, ...round }) => round);
  assert.equal(unrecorded.row?.outcome, "HARNESS FAILURE", unrecorded.r.stdout + unrecorded.r.stderr);
  assert.match(unrecorded.result.error, /round kill-holder-10: the round recorded no launch pids, so the killed pid 31679 matches no launch/);
});

test("job: a kill-holder round whose matched launch exited 0 is a harness failure", () => {
  const { r, row, result } = replayKillHolder((round) => {
    round.launches[6] = { ...round.launches[6], code: 0, signal: null };
    return round;
  });
  assert.equal(row?.outcome, "HARNESS FAILURE", r.stdout + r.stderr);
  assert.match(result.error, /round kill-holder-10: the launch with the killed pid 31679 \(preflight#6\) exited 0/);
  assert.match(result.error, KILL_HOLDER_RULE);
});

test("job: a kill-holder round with two launches on the killed pid is a harness failure (a reused pid never hides a real failure)", () => {
  // preflight#7 failed for real, under the pid the adversary killed.
  const { r, row, result } = replayKillHolder((round) => {
    round.launches[7] = { ...round.launches[7], pid: 31679, code: 4 };
    return round;
  });
  assert.equal(row?.outcome, "HARNESS FAILURE", r.stdout + r.stderr);
  assert.match(result.error, /round kill-holder-10: 2 launches carry the killed pid 31679 \(preflight#6, preflight#7\)/);
  assert.match(result.error, KILL_HOLDER_RULE);
});

test("job: a kill-holder round that recorded fewer launches than it ran is a harness failure", () => {
  const { r, row, result } = replayKillHolder((round) => ({ ...round, launches: round.launches.filter((l) => l.i !== 7) }));
  assert.equal(row?.outcome, "HARNESS FAILURE", r.stdout + r.stderr);
  assert.match(result.error, /round kill-holder-10: 9 of 10 launches recorded/);
});

test("run evidence: S3/hung's kill-holder round is gated the same way", () => {
  const hung = (killHolder) => runEvidence({ key: "S3/hung", platform: "linux", outcome: "RED", metric: "rss", durationS: 190, samples: 600, summary: { proxy: { maxCount: 1 }, launcher: { maxCount: 5 }, preflight: { maxCount: 9 } }, notes: { sampler: {}, rounds: [killHolder, { name: "hung-10-with-stale-lock" }, { name: "hung-10" }] } }, { key: "S3/hung", exitCode: 1 });
  assert.deepEqual(hung(KILL_HOLDER_ROUND), { ok: true, problems: [] });
  assert.match(hung({ ...KILL_HOLDER_ROUND, adversary: { killed: null, reason: "holder 7 not ours" } }).problems.join(), /round kill-holder-10: the adversary recorded no kill/);
});
