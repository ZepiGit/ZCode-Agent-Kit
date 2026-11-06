// The memory loop at process level (seam 1): the sampler finds every process
// carrying the run marker — including a detached child its parent left
// behind — and writes the CSV schema the verdict and reverdict read; the
// entry point refuses to run outside a capped, isolated run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSamplesCsv, roleOf, scan, startSampler, survivors } from "./lib/sampler.mjs";
import { chooseCap, commandFor, parseJobReport } from "./lib/caps.mjs";
import { generateOmpExtension, startOmpHost } from "./lib/omp-host.mjs";
import { causeLinesOf } from "./lib/omp-leg.mjs";
import { OMP_LEG } from "./lib/budgets.mjs";
import { PREFLIGHT_WARNINGS } from "../../cli/heal.mjs";
import { resolveBun } from "../../lib/process.mjs";

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
    assert.equal(text.split("\n")[0], "t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd,commit_kb");
    const parsed = parseSamplesCsv(text).filter((r) => r.pid === child.pid);
    assert.ok(parsed.length >= 2, "the marked child is sampled");
    assert.equal(parsed[0].commitKb, null);
    assert.ok(parsed[0].rssKb > 0 && parsed[0].hwmKb >= parsed[0].rssKb);
    assert.equal(parsed[0].ppid, process.pid);
    assert.equal(parsed[0].progress, 7);
    assert.ok(rows.some((r) => r.procs.some((p) => p.pid === child.pid)));
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
  assert.deepEqual(c.argv.slice(1, 5), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]);
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

// ── S3 OMP leg: the stub Bun host runs the generated extension (ticket 03) ──
const KIT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The promise's value, or `fallback` after `ms`; the timer never outlives the race. */
const within = (promise, ms, fallback) => { let t; return Promise.race([promise, new Promise((r) => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t)); };
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; } };
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
  let preflight = null;
  try {
    assert.ok(await host.ready, host.stderr());
    host.go();
    for (let i = 0; i < 200 && preflight === null; i++) {
      try { preflight = Number(readFileSync(join(f.root, "preflight.pid"), "utf8")) || null; } catch {}
      if (preflight === null) await sleep(50);
    }
    assert.ok(preflight, "the host spawned its preflight");
    host.killTree();
    await within(host.exited, 10_000);
    const gone = await (async () => { for (let i = 0; i < 100; i++) { if (!isAlive(preflight)) return true; await sleep(100); } return false; })();
    assert.equal(isAlive(host.pid), false, "the host is gone");
    assert.equal(gone, true, "its preflight is gone too");
  } finally {
    host.killTree();
    if (preflight && isAlive(preflight)) { try { process.kill(preflight, "SIGKILL"); } catch {} }
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("the stub OMP host charges a hook that does nothing well under the 5 MB waiter gate (its own churn is in the baseline)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memloop-omp-floor-"));
  const extension = join(dir, "noop-extension.ts");
  writeFileSync(extension, `export default function (pi) { pi.on("before_provider_request", async () => {}); }\n`);
  const host = startOmpHost({ bun: resolveBun(KIT), extension, env: { ...process.env } });
  try {
    assert.ok(await host.ready, host.stderr());
    host.go();
    const done = await host.done;
    assert.ok(done, host.stderr());
    // Half the gate: a measurement whose floor reached the gate could not tell a waiter from noise.
    assert.ok(done.costMB < OMP_LEG.waiterCostMB / 2, `no-op hook charged ${done.costMB} MB`);
  } finally {
    host.close();
    if ((await within(host.exited, 10_000, "running")) === "running") host.killTree();
    rmSync(dir, { recursive: true, force: true });
  }
});
