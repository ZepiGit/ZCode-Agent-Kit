// The memory loop at process level (seam 1): the sampler finds every process
// carrying the run marker — including a detached child its parent left
// behind — and writes the CSV schema the verdict and reverdict read; the
// entry point refuses to run outside a capped, isolated run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSamplesCsv, roleOf, scan, startSampler, survivors } from "./lib/sampler.mjs";
import { chooseCap, commandFor, parseJobReport } from "./lib/caps.mjs";
import { runEvidence } from "./lib/completeness.mjs";
import { isolatedConfig, KIT_ROOT } from "./lib/isolated-kit.mjs";
import { whileFrozen } from "./lib/freeze.mjs";
import { makeHungRound } from "./scenarios/s3-concurrency.mjs";

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
  writeFileSync(entry, "setTimeout(() => {}, 5000);\n");
  // `sh pre-exec.sh` first (role other), then the same pid execs into a proxy command line.
  const preExec = join(dir, "pre-exec.sh");
  writeFileSync(preExec, `sleep 0.6\nexec "${process.execPath}" "${entry}" serve\n`);
  const child = spawn("/bin/sh", [preExec], { env: { ...process.env, ZCODE_MEMLOOP_RUN: marker.split("=")[1] }, stdio: "ignore" });
  try {
    const sampler = startSampler({ marker, csvPath: join(dir, "samples.csv"), intervalMs: 100 });
    await sleep(1600);
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
  try {
    await sleep(100);
    const found = survivors(marker);
    assert.deepEqual(found.map((s) => s.pid), [orphanPid]);
    assert.notEqual(found[0].ppid, parent.pid);
  } finally {
    try { process.kill(orphanPid, "SIGKILL"); } catch {}
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

// ── Live Windows self-tests (spec §1; run on the windows-latest legs) ───────
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
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
  const pids = [];
  let sampler;
  // The parent starts a detached grandchild and exits; `token` puts the run id in the grandchild's command line.
  const orphanVia = async (token, parentLivesMs) => {
    const code = `const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", ${token ? JSON.stringify(id) : '"no-token"'}], { detached: true, stdio: "ignore" }); console.log(c.pid); c.unref(); setTimeout(() => process.exit(0), ${parentLivesMs});`;
    const parent = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    parent.stdout.on("data", (b) => { out += b; });
    await new Promise((r) => parent.on("close", r));
    pids.push(Number(out.trim()));
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
  } finally {
    await sampler?.stop();
    for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch {} }
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
    await sleep(500);
    assert.equal(alive(pollerPid), false, "the poller is reaped on stop");
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
  const grandchild = Number((r.stdout.match(/GRANDCHILD (\d+)/) ?? [])[1]);
  assert.ok(grandchild > 0, r.stdout);
  const gone = await waitFor(() => !alive(grandchild), 10_000);
  if (!gone) { try { process.kill(grandchild, "SIGKILL"); } catch {} }
  assert.ok(gone, "the grandchild died with the job");
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
const S3_HUNG_ROUNDS = [{ name: "kill-holder-10" }, { name: "hung-10-with-stale-lock" }, { name: "hung-10" }];
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

// The loop freezes its own hung proxy (S3); whatever happens in between, it
// is thawed, and a thaw that fails makes the run a harness failure — a
// process the loop left frozen is never reported as a kit orphan.
test("whileFrozen thaws after the work, after a failing work, and a failed thaw fails the run", async () => {
  const calls = [];
  const freeze = (pid) => calls.push(`freeze ${pid}`);
  const thaw = (pid) => calls.push(`thaw ${pid}`);
  // Fake pids: liveness is injected, never asked of the host (Windows and Linux answer differently for pid 7/8).
  const alive = () => true;
  assert.equal(await whileFrozen(7, async () => { calls.push("work"); return 42; }, { freeze, thaw, alive }), 42);
  await assert.rejects(whileFrozen(8, async () => { throw new Error("round failed"); }, { freeze, thaw, alive }), /round failed/);
  assert.deepEqual(calls, ["freeze 7", "work", "thaw 7", "freeze 8", "thaw 8"]);
  await assert.rejects(whileFrozen(9, async () => 1, { freeze, thaw: () => { throw new Error("status 0xC000000B"); }, alive: () => true }), /could not thaw pid 9 .*0xC000000B/);
});

// ── CI run 42281731448 (ubuntu, staging/02): S3/hung ran 9 s. The killed start
// lock holder had spawned the proxy but not yet written proxy.pid, so
// `manager start` answered 0 (healthy) with no pid record, both hung rounds
// were skipped, and only kill-holder-10 ran (8 of 9 earlier ubuntu runs: 188 s).
// The hung round freezes the run's own proxy that serves the isolated port;
// it never freezes a process that is not this run's, and it never guesses.
function fakeHungRound({ record = null, ours = [], listening = {}, startCode = 0 } = {}) {
  const calls = [], notes = {};
  const kit = { port: 19026, manager: async () => ({ code: startCode, out: "", err: "" }), pidRecord: () => record };
  const hungRound = makeHungRound({
    kit, proxies: () => ours.map((pid) => ({ pid, role: "proxy", key: `${pid}` })), portsOf: (pid) => listening[pid] ?? [],
    round: async (name) => { calls.push(`round ${name}`); }, note: (k, v) => { notes[k] = v; },
    freeze: (pid) => calls.push(`freeze ${pid}`), thaw: (pid) => calls.push(`thaw ${pid}`), alive: () => true, graceMs: 0,
  });
  return { hungRound, calls, notes };
}

test("S3 hung round: a proxy the killed start left without a pid record is frozen and the round runs (CI run 42281731448)", async () => {
  const { hungRound, calls, notes } = fakeHungRound({ record: null, ours: [3723], listening: { 3723: [19026] } });
  await hungRound("hung-10-with-stale-lock");
  assert.deepEqual(calls, ["freeze 3723", "round hung-10-with-stale-lock", "thaw 3723"]);
  assert.deepEqual(notes, { "hung-10-with-stale-lock.target": { pid: 3723, via: "listener", recordedPid: null } });
});

test("S3 hung round: the recorded proxy is frozen as before", async () => {
  const { hungRound, calls, notes } = fakeHungRound({ record: { pid: 41, startedMs: 1 }, ours: [41], listening: { 41: [19026] } });
  await hungRound("hung-10");
  assert.deepEqual(calls, ["freeze 41", "round hung-10", "thaw 41"]);
  assert.deepEqual(notes, { "hung-10.target": { pid: 41, via: "pid-record", recordedPid: 41 } });
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

test("whileFrozen: a frozen process the kit killed meanwhile (hung-own recovery) needs no thaw", async () => {
  const thawed = [];
  const r = await whileFrozen(10, async () => "round", { freeze: () => {}, thaw: (pid) => { thawed.push(pid); throw new Error("kill ESRCH"); }, alive: () => false });
  assert.equal(r, "round");
  assert.deepEqual(thawed, []);
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

test("measurement mode is off by default: the ratchet step runs unless the marker file exists, and the marker is not committed", () => {
  const ci = readFileSync(join(KIT_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const job = ci.slice(ci.indexOf("\n  memory-budget:"));
  const step = (name) => job.slice(job.indexOf(`- name: ${name}`)).split(/\n      - /)[0];
  assert.match(step("Memory loop (short profile) and expected-RED ratchet"), /if: hashFiles\('tests\/memory\/measure-burst1'\) == ''/);
  const measure = step("S1/burst1 measurement");
  assert.match(measure, /if: hashFiles\('tests\/memory\/measure-burst1'\) != ''/);
  assert.match(measure, /--measure-burst1 "\$\(cat tests\/memory\/measure-burst1\)"/);
  assert.match(step("Upload memory loop artefacts"), /measure-S1-burst1\.json[\s\S]*measure-S1-burst1\.md/);
  // A measurement run turns the ratchet off; a committed marker must never reach the integration branch.
  assert.equal(readdirSync(join(KIT_ROOT, "tests", "memory")).includes("measure-burst1"), false, "tests/memory/measure-burst1 is a one-run switch: delete it before the pre-merge run");
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
