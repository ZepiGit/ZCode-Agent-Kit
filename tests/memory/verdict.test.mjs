// The memory loop's definition of RED, pinned with hand-built series.
import { test } from "node:test";
import assert from "node:assert/strict";
import { osVerdict, verdict } from "./lib/verdict.mjs";
import { MEMORY, OMP_LEG, PROCESSES, s3Budgets } from "./lib/budgets.mjs";
import { ompLegChecks } from "./lib/omp-leg.mjs";
import { roleOf } from "./lib/sampler.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRatchet, issueIdsIn, readExpectedRed, validateExpectedRed } from "./lib/ratchet.mjs";
import { JOB } from "./lib/catalogue.mjs";

/** One proxy sample per second; `mb(i)` gives its RSS, progress = 10 units/s. */
function series(n, mb, role = "proxy") {
  return Array.from({ length: n }, (_, i) => ({ t: i * 1000, progress: i * 10, procs: [{ pid: 1, key: "1:1", role, rssKb: Math.round(mb(i) * 1024), hwmKb: Math.round(mb(i) * 1024), threads: 1, fds: 1, heapMB: null }] }));
}
const growthBudget = { growth: { role: "proxy", axis: "progress", maxPctPer1k: 5, risingWindows: 3 } };
const growthCheck = (rows) => verdict(rows, growthBudget).checks.find((c) => c.name === "growth:proxy");

test("a flat process with GC noise is green", () => {
  assert.equal(growthCheck(series(300, (i) => 100 + (i % 7))).red, false);
});

test("steady growth of 1 MB per 100 units is red", () => {
  // 10 MB per 1,000 units on a ~120 MB level is ~8 %/1k, rising in every window.
  const c = growthCheck(series(300, (i) => 100 + i * 0.1));
  assert.equal(c.red, true);
  assert.equal(c.trend, true);
});

test("allocator warm-up that plateaus is green", () => {
  assert.equal(growthCheck(series(300, (i) => (i < 120 ? 60 + i * 0.5 : 120))).red, false);
});

test("a leak whose last windows rise by less than the noise floor is still red via net rise", () => {
  // The S5 shape: growth, a flat stretch, then +0.4 % per window — the
  // trailing-run rule alone would call this green.
  const rows = series(600, (i) => (i < 150 ? 86 : i < 350 ? 86 + (i - 150) * 0.06 : i < 450 ? 98 : 98 + (i - 450) * 0.002)).map((r) => ({ ...r, progress: r.t / 1000 }));
  const c = growthCheck(rows);
  assert.ok(c.detail.risingWindows < 3, `trailing run ${c.detail.risingWindows}`);
  assert.ok(c.detail.netRisePct >= 10, `net rise ${c.detail.netRisePct}`);
  assert.equal(c.red, true);
});

test("process count, per-process peak (incl. VmHWM) and orphans each go red", () => {
  const rows = series(10, () => 100);
  rows[5].procs.push({ pid: 2, key: "2:1", role: "proxy", rssKb: 50 * 1024, hwmKb: 400 * 1024, threads: 1, fds: 1, heapMB: null });
  const v = verdict(rows, { counts: { proxy: 1 }, procPeaks: { proxy: 250 }, orphans: 0 }, { orphans: [{ pid: 2, role: "proxy", cmd: "bun serve" }] });
  const red = Object.fromEntries(v.checks.map((c) => [c.name, c.red]));
  assert.deepEqual(red, { "count:proxy": true, "procPeak:proxy": true, orphans: true });
  assert.equal(v.red, true);
});

test("fixture processes never count as kit footprint", () => {
  const rows = series(10, () => 100);
  for (const r of rows) r.procs.push({ pid: 9, key: "9:1", role: "mock-upstream", rssKb: 900 * 1024, hwmKb: 900 * 1024, threads: 1, fds: 1, heapMB: null });
  assert.equal(verdict(rows, { peaks: { kit: 600 } }).red, false);
});

// ── Budgets (spec §18) ─────────────────────────────────────────────────────
const proc = (pid, role, mb, { hwm = mb, ppid = 1 } = {}) => ({ pid, ppid, key: `${pid}:1`, role, rssKb: mb * 1024, hwmKb: hwm * 1024, threads: 1, fds: 1, heapMB: null });
const rowsOf = (...samples) => samples.map((procs, i) => ({ t: i * 1000, progress: i, procs }));
const checkNamed = (v, name) => v.checks.find((c) => c.name === name);

test("budgets are the spec §18 numbers", () => {
  assert.equal(MEMORY.growth.maxPctPer1k, 5);
  assert.equal(MEMORY.growth.risingWindows, 3);
  assert.deepEqual(MEMORY.S1, { steadyMB: 160, peakMB: 250, burstPeakMB: { burst16: 400, burst32: 600 } });
  assert.deepEqual(MEMORY.S2, { solverCapMB: 300, costPerGenerationMB: 300, retainedBeforeRecycleMB: 300, hungReclaimMB: 64, cdnMemoryMB: 64, coldStartMs: 4500 });
  assert.deepEqual(MEMORY.S3, { kitTotalMB: { linux: 596, windows: 600 }, rolePeakMB: { launcher: 74, "mcp-bridge": 75, preflight: 76, proxy: 62, solver: 20 } });
  assert.deepEqual(MEMORY.S5, { procPeakMB: 150, rebootCostMB: 20, taskFailures: 0 });
  assert.deepEqual(MEMORY.S6, { linesHeapMB: 16, longLineHeapMB: 16, resizeHeapMB: 8 });
  assert.deepEqual(MEMORY.S7, { proxyLogMB: 6, earlyLogMB: 1, responsesStoreHeapMB: 96 });
  assert.deepEqual(PROCESSES, { proxiesPerInstallation: 1, failedLaunches: 0, staleLocks: 0, orphans: 0, logDirFiles: 8, solversPerProxy: 1, solversAfterProxyKill: 0, solversAfterIdleExit: 0, respawnsPer15Min: 3 });
});

test("every budget whose baseline exceeded it asks for at least 30 % less than that baseline", () => {
  // Baselines from METRICS.md (Phase 1B, Bun 1.4.2).
  const baseline = { burst16: 998, burst32: 1619, s2Generation: 958, s3Kit: 852, s6LongLine: 125 };
  assert.ok(MEMORY.S1.burstPeakMB.burst16 <= baseline.burst16 * 0.7);
  assert.ok(MEMORY.S1.burstPeakMB.burst32 <= baseline.burst32 * 0.7);
  assert.ok(MEMORY.S2.costPerGenerationMB <= baseline.s2Generation * 0.7);
  assert.ok(MEMORY.S3.kitTotalMB.linux <= baseline.s3Kit * 0.7);
  assert.ok(MEMORY.S6.longLineHeapMB <= baseline.s6LongLine * 0.7);
});

test("steady state: a proxy plateau above the steady budget is red without any growth", () => {
  const flat = (mb) => verdict(series(100, () => mb), { steady: { role: "proxy", maxMB: MEMORY.S1.steadyMB } });
  assert.equal(checkNamed(flat(170), "steady:proxy").red, true);
  assert.equal(checkNamed(flat(150), "steady:proxy").red, false);
});

test("S3 part (a): summed kit RSS above the total is red although every process is within its role target", () => {
  const sample = [proc(1, "launcher", 70), proc(2, "mcp-bridge", 74), proc(3, "mcp-bridge", 74), proc(4, "mcp-bridge", 74), proc(5, "mcp-bridge", 74), proc(6, "mcp-bridge", 74), proc(7, "preflight", 75), proc(8, "preflight", 75), proc(9, "proxy", 60), proc(10, "mock-upstream", 500)];
  const v = verdict(rowsOf(sample), s3Budgets("linux"));
  assert.equal(checkNamed(v, "peak:kit").red, true); // 650 MB > 596; the mock is not kit
  assert.deepEqual(v.checks.filter((c) => c.name.startsWith("procPeak:") && c.red), []);
});

test("S3 part (b): one process above its role target is red although the sum fits, and VmHWM counts", () => {
  const v = verdict(rowsOf([proc(1, "launcher", 70), proc(2, "mcp-bridge", 60, { hwm: 86 }), proc(3, "proxy", 60)]), s3Budgets("linux"));
  assert.equal(checkNamed(v, "peak:kit").red, false);
  assert.equal(checkNamed(v, "procPeak:mcp-bridge").red, true);
  assert.equal(checkNamed(v, "procPeak:mcp-bridge").value, 86);
  assert.equal(checkNamed(v, "procPeak:launcher").red, false);
});

test("solver processes: two under one proxy in any sample is red, one under each of two proxies is not", () => {
  const budgets = { perParent: [{ role: "solver", max: PROCESSES.solversPerProxy }] };
  const two = rowsOf([proc(1, "proxy", 60), proc(2, "solver", 30, { ppid: 1 })], [proc(1, "proxy", 60), proc(2, "solver", 30, { ppid: 1 }), proc(3, "solver", 30, { ppid: 1 })]);
  assert.equal(checkNamed(verdict(two, budgets), "perParent:solver").red, true);
  const split = rowsOf([proc(1, "proxy", 60), proc(4, "proxy", 60), proc(2, "solver", 30, { ppid: 1 }), proc(3, "solver", 30, { ppid: 4 })]);
  assert.equal(checkNamed(verdict(split, budgets), "perParent:solver").red, false);
});

test("solver cost per generation: host plus solver RSS above the host's base, inside the window only", () => {
  // Thread transport today: the solver lives in the host process. Child transport: its own role.
  const budgets = { windowPeaks: [{ name: "solver:cost-per-generation", roles: ["scenario", "solver"], fromT: 1000, untilT: 3000, baseMB: 80, maxMB: MEMORY.S2.costPerGenerationMB }] };
  const thread = rowsOf([proc(1, "scenario", 80)], [proc(1, "scenario", 300)], [proc(1, "scenario", 420)], [proc(1, "scenario", 380)], [proc(1, "scenario", 900)]);
  const t = checkNamed(verdict(thread, budgets), "solver:cost-per-generation");
  assert.equal(t.value, 340); // 420 − 80; the 900 MB sample is outside the window
  assert.equal(t.red, true);
  const child = rowsOf([proc(1, "scenario", 80)], [proc(1, "scenario", 90), proc(2, "solver", 200, { ppid: 1 })], [proc(1, "scenario", 90), proc(2, "solver", 240, { ppid: 1 })], [proc(1, "scenario", 85)]);
  const c = checkNamed(verdict(child, budgets), "solver:cost-per-generation");
  assert.equal(c.value, 250);
  assert.equal(c.red, false);
});

test("observed process counts: a solver alive after the proxy was SIGKILLed is red", () => {
  const budgets = { observed: [{ name: "solver-after-proxy-sigkill", label: "after-proxy-sigkill", role: "solver", max: PROCESSES.solversAfterProxyKill }] };
  const seen = (n) => [{ label: "after-proxy-sigkill:hung-solve", counts: { solver: n } }, { label: "after-proxy-sigkill:idle-generation", counts: {} }];
  assert.equal(checkNamed(verdict([], budgets, { observations: seen(1) }), "solver-after-proxy-sigkill").red, true);
  assert.equal(checkNamed(verdict([], budgets, { observations: seen(0) }), "solver-after-proxy-sigkill").red, false);
  // No observation at all means the scenario never checked: that is red too.
  assert.equal(checkNamed(verdict([], budgets, { observations: [] }), "solver-after-proxy-sigkill").red, true);
});

// ── Expected-RED ratchet (seam 9) ─────────────────────────────────────────
// A small job of three runs; ticket files 19 and 37 exist, nothing else does.
const job = { linux: ["S1/short", "S1/burst16", "S3/short"] };
const issueIds = new Set(["19", "37"]);
const judge = (expected, results, os = "linux") => checkRatchet({ expected, os, results, job, issueIds });
const outcome = (key, exitCode) => ({ key, exitCode });

test("ratchet: every RED run listed and every other run GREEN passes", () => {
  const r = judge({ linux: { "S1/burst16": "19", "S3/short": "37" } }, [outcome("S1/short", 0), outcome("S1/burst16", 1), outcome("S3/short", 1)]);
  assert.deepEqual(r.failures, []);
  assert.equal(r.ok, true);
});

test("ratchet: a RED run that is not listed fails", () => {
  const r = judge({ linux: { "S1/burst16": "19" } }, [outcome("S1/short", 0), outcome("S1/burst16", 1), outcome("S3/short", 1)]);
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S3\/short.*RED.*not listed/);
});

test("ratchet: a listed run that is GREEN fails until its entry is deleted", () => {
  const r = judge({ linux: { "S1/burst16": "19", "S3/short": "37" } }, [outcome("S1/short", 0), outcome("S1/burst16", 0), outcome("S3/short", 1)]);
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S1\/burst16.*GREEN.*delete/);
});

test("ratchet: a harness failure fails even when the run is listed", () => {
  const r = judge({ linux: { "S1/burst16": "19", "S3/short": "37" } }, [outcome("S1/short", 0), outcome("S1/burst16", 2), outcome("S3/short", 1)]);
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S1\/burst16.*harness failure/);
});

test("ratchet: an unknown scenario, variant or OS leg fails", () => {
  const all = [outcome("S1/short", 0), outcome("S1/burst16", 1), outcome("S3/short", 1)];
  const base = { "S1/burst16": "19", "S3/short": "37" };
  for (const [doc, pattern] of [
    [{ linux: { ...base, "S9/short": "19" } }, /S9\/short.*unknown scenario/],
    [{ linux: { ...base, "S1/burst99": "19" } }, /S1\/burst99.*unknown variant/],
    [{ linux: { ...base, "S1-burst16": "19" } }, /S1-burst16.*not a run key/],
    [{ ...{ linux: base }, macos: {} }, /macos.*unknown OS leg/],
  ]) {
    const r = judge(doc, all);
    assert.equal(r.ok, false, JSON.stringify(doc));
    assert.match(r.failures.join("\n"), pattern);
  }
});

test("ratchet: a known variant that this leg's job never runs fails (it could never be checked)", () => {
  const r = checkRatchet({ expected: { linux: { "S1/burst16": "19", "S3/short": "37" }, windows: { "S1/burst16": "19" } }, os: "linux", results: [outcome("S1/short", 0), outcome("S1/burst16", 1), outcome("S3/short", 1)], job: { ...job, windows: ["S1/short"] }, issueIds });
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /windows.*S1\/burst16.*not run by the windows job/);
});

test("ratchet: a ticket id with no issue file fails", () => {
  const r = judge({ linux: { "S1/burst16": "19", "S3/short": "99" } }, [outcome("S1/short", 0), outcome("S1/burst16", 1), outcome("S3/short", 1)]);
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S3\/short.*ticket 99.*no issue file/);
  const malformed = judge({ linux: { "S1/burst16": "19", "S3/short": 37 } }, [outcome("S1/short", 0), outcome("S1/burst16", 1), outcome("S3/short", 1)]);
  assert.match(malformed.failures.join("\n"), /S3\/short.*ticket id/);
});

test("the committed expected-red.json is valid: known runs of each leg's job, tickets with issue files", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const expected = readExpectedRed(join(here, "expected-red.json"));
  const ids = issueIdsIn(join(here, "..", "..", ".scratch", "kit-overhaul", "issues"));
  assert.deepEqual(validateExpectedRed(expected, { issueIds: ids }), []);
});

test("ratchet: a listed run that did not run fails", () => {
  const r = judge({ linux: { "S1/burst16": "19", "S3/short": "37" } }, [outcome("S1/short", 0), outcome("S1/burst16", 1)]);
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S3\/short.*did not run/);
});

// ── Metric per OS (spec §1, ticket 02): commit on Windows, RSS on Linux ─────
const winProc = (pid, role, { ws, commit, peakCommit = commit, peakWs = ws }) => ({ pid, ppid: 1, key: `${pid}:1`, role, rssKb: ws * 1024, commitKb: commit * 1024, hwmKb: peakCommit * 1024, wsPeakKb: peakWs * 1024, threads: 1, fds: 1, heapMB: null });

test("on Windows samples the verdict judges commit, and a run RED only on commit is flagged for the owner", () => {
  // Working set 110 MB (peak 120), commit 240 MB with a 310 MB peak: within a 250 MB working-set budget, over it on commit.
  const rows = rowsOf(...Array.from({ length: 5 }, () => [winProc(1, "proxy", { ws: 110, peakWs: 120, commit: 240, peakCommit: 310 })]));
  const v = osVerdict(rows, { procPeaks: { proxy: 250 } });
  assert.equal(v.metric, "commit");
  assert.equal(v.red, true);
  assert.equal(checkNamed(v, "procPeak:proxy").value, 310);
  assert.equal(v.workingSet.red, false);
  assert.equal(v.redOnlyOnCommit, true);
});

test("on Windows samples RED on both metrics is not 'RED only on commit'", () => {
  const rows = rowsOf([winProc(1, "proxy", { ws: 300, commit: 320 })], [winProc(1, "proxy", { ws: 300, commit: 320 })]);
  const v = osVerdict(rows, { procPeaks: { proxy: 250 } });
  assert.deepEqual([v.red, v.workingSet.red, v.redOnlyOnCommit, v.workingSet.redChecks], [true, true, false, ["procPeak:proxy"]]);
});

test("Linux samples (no commit_kb) keep the RSS verdict unchanged", () => {
  const rows = rowsOf([proc(1, "proxy", 100, { hwm: 300 })], [proc(1, "proxy", 120)]);
  const v = osVerdict(rows, { procPeaks: { proxy: 250 } });
  assert.equal(v.metric, "rss");
  assert.deepEqual(v.checks, verdict(rows, { procPeaks: { proxy: 250 } }).checks);
  assert.equal(v.redOnlyOnCommit, false);
  assert.equal(v.workingSet, null);
});

test("the windows leg runs S1, S2 (offline fixture), S3, S4, S5 and S7 — the linux runs without S6", () => {
  assert.deepEqual(JOB.windows, JOB.linux.filter((k) => !k.startsWith("S6/")));
  assert.ok(JOB.windows.includes("S3/hung") && JOB.windows.includes("S2/short"));
});

// ── S3 OMP stub-host leg (ticket 03, ADR-0013 cond 4, Round 4 Q1 add. 4) ────
// A host is a stub Bun host running the generated OMP extension. A starter
// spawned a preflight process; a waiter spawned none. Its cost is its own RSS
// delta (commit on Windows) above its idle baseline while the hook ran.
const QUOTA = "[zcode-autostart] quota-unavailable: Quota check unavailable; continuing with the healthy local proxy. No retry scheduled.";
const HUNG = "[zcode-autostart] hung: Recovered an unresponsive ZCode proxy (restarted automatically).";
const host = (id, { preflights = 0, causeLines = [], costMB = 1.2, killed = false, finished = !killed } = {}) => ({ id, pid: 100 + id, preflights, causeLines, costMB, killed, finished });
const ompRound = (name, hosts, maxConcurrentPreflights, extra = {}) => ({ name, hosts, maxConcurrentPreflights, ...extra });
const ompCheck = (rounds, name) => ompLegChecks(rounds).find((c) => c.name === name);
// The shape single-flight should produce: one starter, four waiters that printed its cause line.
const singleFlight = (name = "omp-5") => ompRound(name, [host(0, { preflights: 1, causeLines: [QUOTA] }), ...[1, 2, 3, 4].map((i) => host(i, { causeLines: [QUOTA] }))], 1);

test("OMP leg budgets are the spec §18 numbers: 5 hosts, ≤ 1 concurrent preflight, ≤ 5 MB waiter cost", () => {
  assert.deepEqual(OMP_LEG, { hosts: 5, concurrentPreflights: 1, waiterCostMB: 5 });
});

test("OMP leg: five hosts that each spawn their own preflight at once are red (today's extension)", () => {
  const today = ompRound("omp-5", [0, 1, 2, 3, 4].map((i) => host(i, { preflights: 1, causeLines: [QUOTA] })), 5);
  const c = ompCheck([today], "omp:concurrent-preflights");
  assert.equal(c.red, true);
  assert.equal(c.value, 5);
  assert.equal(c.budget, 1);
});

test("OMP leg: one starter and four waiters that printed its cause lines are green in every check", () => {
  const killed = ompRound("omp-5-kill-starter", [host(0, { preflights: 1, killed: true }), host(1, { preflights: 1, causeLines: [QUOTA] }), ...[2, 3, 4].map((i) => host(i, { causeLines: [QUOTA] }))], 1, { killExpected: true });
  const checks = ompLegChecks([singleFlight(), killed]);
  assert.deepEqual(checks.filter((c) => c.red).map((c) => c.name), []);
  assert.deepEqual(checks.map((c) => c.name), ["omp:concurrent-preflights", "omp:waiter-cost", "omp:waiter-cause-lines", "omp:hosts-finished", "omp:starter-killed"]);
});

test("OMP leg: a killed starter followed by two overlapping preflights is red", () => {
  const r = ompRound("omp-5-kill-starter", [host(0, { preflights: 1, killed: true }), host(1, { preflights: 1, causeLines: [QUOTA] }), host(2, { preflights: 1, causeLines: [QUOTA] }), host(3), host(4)], 2, { killExpected: true });
  assert.equal(ompCheck([singleFlight(), r], "omp:concurrent-preflights").red, true);
});

test("OMP leg: a killed-starter round in which no starter was killed proved nothing and is red", () => {
  const r = { ...singleFlight("omp-5-kill-starter"), killExpected: true };
  const c = ompCheck([r], "omp:starter-killed");
  assert.equal(c.red, true);
  assert.equal(ompCheck([singleFlight()], "omp:starter-killed").red, false, "the 5-host round kills nobody");
});

test("OMP leg: a waiter above 5 MB is red; the starter's cost is reported but not gated", () => {
  const heavyWaiter = singleFlight();
  heavyWaiter.hosts[3].costMB = 5.4;
  const c = ompCheck([heavyWaiter], "omp:waiter-cost");
  assert.equal(c.red, true);
  assert.equal(c.value, 5.4);
  const heavyStarter = singleFlight();
  heavyStarter.hosts[0].costMB = 9;
  assert.equal(ompCheck([heavyStarter], "omp:waiter-cost").red, false);
  assert.match(ompCheck([heavyStarter], "omp:waiter-cost").detail.join("\n"), /host 0 starter \+9 MB/);
});

test("OMP leg: a waiter whose cost was never measured is red, not assumed cheap", () => {
  const r = singleFlight();
  r.hosts[2].costMB = null;
  assert.equal(ompCheck([r], "omp:waiter-cost").red, true);
});

test("OMP leg: a waiter that did not print the starter's cause lines is red", () => {
  const r = singleFlight();
  r.hosts[0].causeLines = [HUNG, QUOTA];
  r.hosts[4].causeLines = [QUOTA]; // the hung recovery was dropped
  const c = ompCheck([r], "omp:waiter-cause-lines");
  assert.equal(c.red, true);
  assert.equal(c.value, 4, "every waiter lacks the hung line");
  for (const w of r.hosts.slice(1)) w.causeLines = [HUNG, QUOTA];
  assert.equal(ompCheck([r], "omp:waiter-cause-lines").red, false);
});

test("OMP leg: when the starter's preflight emitted no cause line, silent waiters are green", () => {
  const r = singleFlight();
  for (const h of r.hosts) h.causeLines = [];
  assert.equal(ompCheck([r], "omp:waiter-cause-lines").red, false);
});

test("OMP leg: after a killed starter the waiters must print the surviving starter's lines, not nothing", () => {
  const r = ompRound("omp-5-kill-starter", [host(0, { preflights: 1, killed: true }), host(1, { preflights: 1, causeLines: [QUOTA] }), host(2, { causeLines: [QUOTA] }), host(3, { causeLines: [] }), host(4, { causeLines: [QUOTA] })], 1, { killExpected: true });
  const c = ompCheck([r], "omp:waiter-cause-lines");
  assert.equal(c.red, true);
  assert.equal(c.value, 1);
  assert.match(c.detail.join("\n"), /omp-5-kill-starter host 3/);
});

test("OMP leg: waiters with no surviving starter got no diagnostics at all and are red", () => {
  const r = ompRound("omp-5-kill-starter", [host(0, { preflights: 1, killed: true }), ...[1, 2, 3, 4].map((i) => host(i))], 1, { killExpected: true });
  assert.equal(ompCheck([r], "omp:waiter-cause-lines").red, true);
});

test("OMP leg: a surviving host whose hook never returned is red", () => {
  const r = singleFlight();
  r.hosts[2].finished = false;
  assert.equal(ompCheck([r], "omp:hosts-finished").red, true);
});

test("the stub OMP host is the harness: never kit footprint, like the other fixtures", () => {
  assert.equal(roleOf(["/usr/bin/bun", "/kit/tests/memory/fixtures/omp-host.ts", "/h/.omp/agent/extensions/zcode-proxy-autostart.ts"]), "omp-host");
  const rows = rowsOf([proc(1, "omp-host", 400), proc(2, "preflight", 70), proc(3, "proxy", 60)]);
  assert.equal(checkNamed(verdict(rows, { peaks: { kit: 200 } }), "peak:kit").value, 130);
});

test("the S3 OMP leg runs on both legs and is expected RED until single-flight lands (ticket 35)", () => {
  assert.ok(JOB.linux.includes("S3/omp") && JOB.windows.includes("S3/omp"));
  const here = dirname(fileURLToPath(import.meta.url));
  const expected = readExpectedRed(join(here, "expected-red.json"));
  assert.equal(expected.linux["S3/omp"], "35");
  assert.equal(expected.windows["S3/omp"], "35");
});
