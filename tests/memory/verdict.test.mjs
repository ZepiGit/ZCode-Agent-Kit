// The memory loop's definition of RED, pinned with hand-built series.
import { test } from "node:test";
import assert from "node:assert/strict";
import { osVerdict, verdict } from "./lib/verdict.mjs";
import { MEMORY, PROCESSES, s3Budgets } from "./lib/budgets.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRatchet, issueIdsIn, readExpectedRed, validateExpectedRed } from "./lib/ratchet.mjs";
import { JOB } from "./lib/catalogue.mjs";
import { chooseRepetitions, medianFalseRedRate, medianVerdict, repetitionRule, runRepetitions } from "./lib/repetitions.mjs";

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
  // Round 7 Q2: windows 600 → 514 MB commit (0.7 × the 734.5 MB first clean windows run).
  assert.deepEqual(MEMORY.S3, { kitTotalMB: { linux: 596, windows: 514 }, rolePeakMB: { launcher: 74, "mcp-bridge": 75, preflight: 76, proxy: 62, solver: 20 } });
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

// Round 7 Q1: on Windows the per-process peak and steady budgets of the proxy,
// launcher, MCP bridge and preflight are judged on working set (max of sampled
// WS and PeakWorkingSetSize); the S3 total, every growth check and every
// solver/S2 check stay on commit; paced runs fail when a proxy sample's commit
// exceeds 512 MB (ADR-0008 soft limit). Every memory check carries both values.
test("Windows: a proxy RED only on commit is GREEN (its per-process peak is judged on working set)", () => {
  // WS 110 MB (peak 120), commit 240 MB with a 310 MB peak; 250 MB budget.
  const rows = rowsOf(...Array.from({ length: 5 }, () => [winProc(1, "proxy", { ws: 110, peakWs: 120, commit: 240, peakCommit: 310 })]));
  const v = osVerdict(rows, { procPeaks: { proxy: 250 } });
  const c = checkNamed(v, "procPeak:proxy");
  assert.deepEqual({ red: v.red, gate: c.gate, value: c.value, commitValue: c.commitValue, wsValue: c.wsValue }, { red: false, gate: "ws", value: 120, commitValue: 310, wsValue: 120 });
  assert.equal(v.metric, "commit");
});

test("Windows: steady and per-process peaks of launcher, bridge and preflight are judged on working set too", () => {
  const rows = rowsOf(...Array.from({ length: 8 }, () => [winProc(1, "proxy", { ws: 100, commit: 300 }), winProc(2, "launcher", { ws: 30, commit: 90 }), winProc(3, "mcp-bridge", { ws: 40, commit: 95 }), winProc(4, "preflight", { ws: 30, commit: 90 })]));
  const v = osVerdict(rows, { steady: { role: "proxy", maxMB: 160 }, procPeaks: { launcher: 74, "mcp-bridge": 75, preflight: 76 } });
  assert.equal(v.red, false, JSON.stringify(v.checks.filter((c) => c.red)));
  assert.deepEqual(v.checks.map((c) => [c.name, c.gate]), [["procPeak:launcher", "ws"], ["procPeak:mcp-bridge", "ws"], ["procPeak:preflight", "ws"], ["steady:proxy", "ws"]]);
  assert.deepEqual([checkNamed(v, "steady:proxy").commitValue, checkNamed(v, "steady:proxy").wsValue], [300, 100]);
});

test("Windows: a solver RED only on commit stays RED", () => {
  const rows = rowsOf([winProc(1, "solver", { ws: 150, commit: 340 })], [winProc(1, "solver", { ws: 150, commit: 340 })]);
  const c = checkNamed(osVerdict(rows, { procPeaks: { solver: 300 } }), "procPeak:solver");
  assert.deepEqual([c.red, c.gate, c.commitValue, c.wsValue], [true, "commit", 340, 150]);
});

test("Windows: the S2 host and the growth checks stay on commit", () => {
  const rows = rowsOf(...Array.from({ length: 40 }, (_, i) => [winProc(1, "scenario", { ws: 200, commit: 300 + i * 20 })])).map((r, i) => ({ ...r, progress: i * 100 }));
  const v = osVerdict(rows, { procPeaks: { scenario: 600 }, growth: { role: "scenario", axis: "progress", maxPctPer1k: 5, risingWindows: 3 } });
  assert.deepEqual([checkNamed(v, "procPeak:scenario").gate, checkNamed(v, "procPeak:scenario").red], ["commit", true]);
  assert.deepEqual([checkNamed(v, "growth:scenario").gate, checkNamed(v, "growth:scenario").red], ["commit", true]);
});

test("Windows: an S3 total RED only on commit stays RED", () => {
  const rows = rowsOf([winProc(1, "proxy", { ws: 55, commit: 188 }), winProc(2, "mcp-bridge", { ws: 60, commit: 80 }), winProc(3, "launcher", { ws: 30, commit: 300 })]);
  const c = checkNamed(osVerdict(rows, { peaks: { kit: 514 } }), "peak:kit");
  assert.deepEqual([c.red, c.gate, c.commitValue, c.wsValue], [true, "commit", 568, 145]);
});

test("Windows: a paced run whose proxy commit exceeds 512 MB is RED even when its working set is green", () => {
  const rows = rowsOf([winProc(1, "proxy", { ws: 150, commit: 400 })], [winProc(1, "proxy", { ws: 160, commit: 530 })], [winProc(1, "proxy", { ws: 150, commit: 420 })]);
  const v = osVerdict(rows, { procPeaks: { proxy: 250 }, commitBackstop: { role: "proxy", maxMB: 512 } });
  const c = checkNamed(v, "commit-backstop:proxy");
  assert.deepEqual([v.red, c.red, c.value, c.budget, checkNamed(v, "procPeak:proxy").red], [true, true, 530, 512, false]);
  assert.equal(checkNamed(osVerdict(rows.slice(0, 1), { commitBackstop: { role: "proxy", maxMB: 512 } }), "commit-backstop:proxy").red, false);
});

test("the commit backstop never applies to Linux samples (no commit there)", () => {
  const rows = rowsOf([proc(1, "proxy", 600)]);
  assert.equal(checkNamed(osVerdict(rows, { commitBackstop: { role: "proxy", maxMB: 512 } }), "commit-backstop:proxy"), undefined);
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

// ── S1/burst1: the median of n fresh repetitions (Round 6 Q1, ticket 60) ────
// One repetition's summary as run.mjs writes it: the peak check plus the others.
const rep = (peakMB, { exitCode = peakMB > 250 ? 1 : 0, others = [] } = {}) => ({ exitCode, checks: [{ name: "procPeak:proxy", red: peakMB > 250, value: peakMB, budget: 250, unit: "MB" }, { name: "count:proxy", red: false, value: 1 }, ...others] });
const rule5 = { n: 5, check: "procPeak:proxy", budgetMB: 250, ceilingMB: 400 };

test("median rule: one high repetition passes, the median stays within the budget", () => {
  const v = medianVerdict([rep(236), rep(299), rep(231), rep(240), rep(219)], rule5);
  assert.equal(v.medianMB, 236);
  assert.deepEqual(v.values, [236, 299, 231, 240, 219]);
  assert.deepEqual([v.exitCode, v.red, v.redChecks], [0, false, []]);
});

test("median rule: a high majority fails", () => {
  const v = medianVerdict([rep(236), rep(264), rep(257), rep(299), rep(219)], rule5);
  assert.equal(v.medianMB, 257);
  assert.deepEqual([v.exitCode, v.red, v.redChecks], [1, true, ["median:procPeak:proxy"]]);
});

test("per-run ceiling: one repetition above 400 MB fails although the median is within the budget", () => {
  const v = medianVerdict([rep(236), rep(401), rep(231), rep(240), rep(219)], rule5);
  assert.equal(v.medianMB, 236);
  assert.deepEqual([v.exitCode, v.red, v.redChecks, v.overCeiling], [1, true, ["ceiling:procPeak:proxy"], [2]]);
  // At the ceiling itself is still within it.
  assert.equal(medianVerdict([rep(236), rep(400), rep(231), rep(240), rep(219)], rule5).red, false);
});

test("median rule: any other RED check in any one repetition is RED (only the peak is judged on the median)", () => {
  const orphan = { name: "orphans", red: true, value: 1, budget: 0 };
  const v = medianVerdict([rep(236), rep(231), rep(240, { exitCode: 1, others: [orphan] }), rep(219), rep(230)], rule5);
  assert.deepEqual([v.exitCode, v.redChecks], [1, ["orphans"]]);
});

test("median rule: an incomplete set is never judged — a harness failure, a missing repetition or a missing peak is a harness failure", () => {
  const four = [rep(236), rep(231), rep(240), rep(219)];
  const short = medianVerdict(four, rule5);
  assert.equal(short.exitCode, 2);
  assert.match(short.error, /4 of 5 repetitions/);
  const failed = medianVerdict([...four, { exitCode: 2, checks: [], error: "killed (memory cap 3G?)" }], rule5);
  assert.equal(failed.exitCode, 2);
  assert.match(failed.error, /repetition 5: killed \(memory cap 3G\?\)/);
  const noPeak = medianVerdict([...four, { exitCode: 0, checks: [{ name: "count:proxy", red: false, value: 1 }] }], rule5);
  assert.equal(noPeak.exitCode, 2);
  assert.match(noPeak.error, /repetition 5: no procPeak:proxy value/);
});

test("false-RED rate of a median of n: the binomial tail, as Round 6 Q1 worked it", () => {
  // A median of n fails when at least (n + 1) / 2 runs land in the tail.
  assert.equal(Number(medianFalseRedRate(0.27, 3).toFixed(3)), 0.179); // 3p² − 2p³ ≈ 18 %
  assert.equal(Number(medianFalseRedRate(0.25, 9).toFixed(3)), 0.049); // ≈ 4.9 %
  assert.equal(medianFalseRedRate(0, 9), 0);
  // n is the smallest odd number in {3, 5, 7, 9} at ≤ 5 %; none at all means the rule is not adopted.
  assert.equal(chooseRepetitions(0.25), 9);
  assert.equal(chooseRepetitions(0.1), 3);
  assert.equal(chooseRepetitions(0.3), null);
});

test("repetitions run one after another, as many as the rule's n, and a harness failure ends the set", async () => {
  let active = 0;
  let overlapped = false;
  const calls = [];
  const runOnce = async (i) => {
    calls.push(i);
    if (++active > 1) overlapped = true;
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return rep(230 + i);
  };
  const three = await runRepetitions({ ...rule5, n: 3 }, runOnce);
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(overlapped, false, "never two repetitions at once (§6 resource safety)");
  assert.deepEqual([three.exitCode, three.values, three.medianMB], [0, [231, 232, 233], 232]);
  const failing = await runRepetitions(rule5, async (i) => (i === 2 ? { exitCode: 2, checks: [], error: "timed out" } : rep(230)));
  assert.equal(failing.reps.length, 2);
  assert.deepEqual([failing.exitCode, failing.error], [2, "repetition 2: timed out"]);
});

// Round 7 Q1 / Round 8 Q1: on Windows the S1/burst1 set is judged on the
// working-set gate, max(sampled WS, PeakWorkingSetSize), and the 400 MB
// per-run ceiling applies to that same value; commit is reported per repetition.
// One repetition as job.mjs hands it over on Windows: osVerdict's checks plus the
// all-WS verdict's RED checks.
const winRep = ({ commit, ws, wsPeak = ws }) => {
  const p = winProc(1, "proxy", { ws, commit, peakWs: wsPeak });
  const v = osVerdict(rowsOf([p], [p]), { procPeaks: { proxy: 250 }, counts: { proxy: 1 }, orphans: 0 });
  return { exitCode: v.red ? 1 : 0, checks: v.checks, metric: v.metric, workingSetRedChecks: v.workingSet.redChecks };
};

test("median rule on Windows: judged on the WS gate (max of sampled WS and PeakWorkingSetSize), commit beside it", () => {
  // CI run 42265988296-like repetitions: ~420 MB commit, WS around the budget.
  const reps = [winRep({ commit: 422, ws: 234.3, wsPeak: 255 }), winRep({ commit: 365.2, ws: 222 }), winRep({ commit: 424.5, ws: 248.3, wsPeak: 262 }), winRep({ commit: 410, ws: 230, wsPeak: 240 }), winRep({ commit: 400, ws: 236 })];
  const v = medianVerdict(reps, rule5);
  // The PeakWorkingSetSize between samples counts: 255 and 262, not 234.3 and 248.3.
  assert.deepEqual(v.values, [255, 222, 262, 240, 236]);
  assert.deepEqual([v.gate, v.medianMB, v.red, v.redChecks], ["ws", 240, false, []]);
  // Commit is reported, never the gate: every repetition is above 250 commit and above 400 in three.
  assert.deepEqual(v.commitValues, [422, 365.2, 424.5, 410, 400]);
  assert.equal(v.commitMedianMB, 410);
  assert.deepEqual(v.overCeiling, []);
  assert.equal(v.redOnlyOnCommit, false);
});

test("median rule on Windows: a WS majority above 250 is RED, and the 400 MB ceiling applies to the WS gate value", () => {
  const high = medianVerdict([winRep({ commit: 430, ws: 240, wsPeak: 256 }), winRep({ commit: 420, ws: 251 }), winRep({ commit: 380, ws: 230 }), winRep({ commit: 425, ws: 248, wsPeak: 270 }), winRep({ commit: 410, ws: 220 })], rule5);
  assert.deepEqual([high.medianMB, high.red, high.redChecks, high.redOnlyOnCommit], [251, true, ["median:procPeak:proxy"], false]);
  const spike = medianVerdict([winRep({ commit: 420, ws: 230 }), winRep({ commit: 520, ws: 300, wsPeak: 401 }), winRep({ commit: 400, ws: 231 }), winRep({ commit: 400, ws: 232 }), winRep({ commit: 400, ws: 233 })], rule5);
  assert.deepEqual([spike.medianMB, spike.red, spike.redChecks, spike.overCeiling], [232, true, ["ceiling:procPeak:proxy"], [2]]);
  // Linux repetitions carry no commit values.
  const linux = medianVerdict([rep(236), rep(231), rep(240), rep(219), rep(230)], rule5);
  assert.deepEqual([linux.gate, linux.commitValues, linux.redOnlyOnCommit], [null, null, false]);
});

// ── The ratchet over a repeated run key (Round 9 Q1 condition 1) ──────────
// A listed repeated key tolerates only its median check: a ceiling breach, any
// other RED check in any repetition or a harness failure fails, listed or not.
// The set result as job.mjs hands it to the ratchet.
const setResult = (key, reps, rule = rule5) => {
  const v = medianVerdict(reps, rule);
  return { key, exitCode: v.exitCode, redChecks: v.redChecks, median: { n: rule.n, check: rule.check, medianMB: v.medianMB, budgetMB: rule.budgetMB, ceilingMB: rule.ceilingMB }, error: v.error ?? null };
};
const burstJob = { linux: ["S1/burst1", "S1/short"], windows: ["S1/burst1", "S1/short"] };
const burstIds = new Set(["19", "20"]);
const judgeBurst = (expected, burst1, os = "windows") => checkRatchet({ expected, os, results: [burst1, outcome("S1/short", 0)], job: burstJob, issueIds: burstIds });
const fiveOf = (...peaks) => peaks.map((p) => (typeof p === "number" ? rep(p) : p));
const twoProxies = (peakMB) => ({ exitCode: 1, checks: [{ name: "procPeak:proxy", red: false, value: peakMB, budget: 250, unit: "MB" }, { name: "count:proxy", red: true, value: 2, budget: 1, unit: "procs" }] });
const withOrphan = (peakMB) => rep(peakMB, { exitCode: 1, others: [{ name: "orphans", red: true, value: 1, budget: 0 }] });

test("ratchet: a listed repeated key RED only on its median passes", () => {
  const r = judgeBurst({ windows: { "S1/burst1": "20" } }, setResult("S1/burst1", fiveOf(255, 262, 240, 251, 230)));
  assert.deepEqual(r.failures, []);
});

test("ratchet: a listed repeated key RED on its ceiling fails, with the median within the budget or above it (Round 6 Q1 condition 3)", () => {
  for (const peaks of [[236, 401, 231, 240, 219], [255, 401, 262, 251, 230]]) {
    const r = judgeBurst({ windows: { "S1/burst1": "20" } }, setResult("S1/burst1", fiveOf(...peaks)));
    assert.equal(r.ok, false, peaks.join());
    assert.match(r.failures.join("\n"), /S1\/burst1: RED on .*ceiling:procPeak:proxy.*accepts only median:procPeak:proxy/);
  }
});

test("ratchet: a listed repeated key with an orphan or a second proxy in one repetition fails", () => {
  for (const [label, odd] of [["orphan", withOrphan(255)], ["count:proxy 2", twoProxies(255)]]) {
    const r = judgeBurst({ windows: { "S1/burst1": "20" } }, setResult("S1/burst1", fiveOf(260, odd, 262, 251, 230)));
    assert.equal(r.ok, false, label);
    assert.match(r.failures.join("\n"), new RegExp(`S1/burst1: RED on .*${label === "orphan" ? "orphans" : "count:proxy"}`), label);
  }
});

test("ratchet: a repeated key's harness failure or ceiling breach fails listed or not", () => {
  const harness = setResult("S1/burst1", fiveOf(236, { exitCode: 2, checks: [], error: "Job Object cap not applied: no @@JOB report" }, 231, 240, 219));
  for (const expected of [{ windows: { "S1/burst1": "20" } }, { windows: {} }]) {
    assert.match(judgeBurst(expected, harness).failures.join("\n"), /S1\/burst1: harness failure/);
    assert.equal(judgeBurst(expected, setResult("S1/burst1", fiveOf(236, 401, 231, 240, 219))).ok, false);
  }
});

// ── The `unstable` entry: windows S1/burst1 only (Round 9 Q1 conditions 2–3) ──
// A median ≤ 300 MB passes (≤ 250 GREEN or 250–300 RED) with the line
// "S1/burst1: unstable (median <x> MB, budget 250), owned by ticket 20"; above
// 300 fails; condition 1 holds on top. Any other key carrying it is a schema error.
const UNSTABLE_ENTRY = { ticket: "20", state: "unstable" };
const unstableDoc = { windows: { "S1/burst1": UNSTABLE_ENTRY } };
const wsFive = (...ws) => ws.map((x) => winRep({ commit: 410, ws: x }));

test("unstable: a median of 251 and a median of 230 both pass, each with its unstable line", () => {
  for (const [peaks, medianMB] of [[[255, 251, 240, 262, 230], 251], [[230, 220, 240, 235, 225], 230]]) {
    const r = judgeBurst(unstableDoc, setResult("S1/burst1", wsFive(...peaks)));
    assert.deepEqual(r.failures, [], String(medianMB));
    const row = r.rows.find((x) => x.key === "S1/burst1");
    assert.equal(row.state, "unstable");
    assert.equal(row.note, `S1/burst1: unstable (median ${medianMB} MB, budget 250), owned by ticket 20`);
  }
});

test("unstable: a median above 300 MB fails", () => {
  const r = judgeBurst(unstableDoc, setResult("S1/burst1", wsFive(301, 305, 290, 310, 280)));
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S1\/burst1: unstable median 301 MB is above the 300 MB bound/);
  assert.equal(judgeBurst(unstableDoc, setResult("S1/burst1", wsFive(300, 305, 290, 310, 280))).ok, true, "300 itself is within the bound");
});

test("unstable: one repetition at 401 with a median of 240, an orphan, or count:proxy 2 fails (condition 1 holds on top)", () => {
  const cases = {
    "ceiling:procPeak:proxy": setResult("S1/burst1", [winRep({ commit: 520, ws: 300, wsPeak: 401 }), ...wsFive(240, 231, 245, 236)]),
    orphans: setResult("S1/burst1", fiveOf(255, withOrphan(255), 262, 251, 230)),
    "count:proxy": setResult("S1/burst1", fiveOf(240, twoProxies(240), 231, 245, 236)),
  };
  for (const [check, result] of Object.entries(cases)) {
    const r = judgeBurst(unstableDoc, result);
    assert.equal(r.ok, false, check);
    assert.match(r.failures.join("\n"), new RegExp(`S1/burst1: RED on .*${check}`), check);
    assert.equal(r.rows.find((x) => x.key === "S1/burst1").note, undefined, `${check}: no unstable pass line`);
  }
});

test("unstable is rejected on any other key and on linux S1/burst1; a plain listed GREEN still fails", () => {
  const ok = { ...unstableDoc };
  assert.deepEqual(validateExpectedRed(ok, { job: burstJob, issueIds: burstIds }), []);
  for (const [doc, pattern] of [
    [{ linux: { "S1/burst1": UNSTABLE_ENTRY } }, /linux S1\/burst1: `unstable` is allowed for windows S1\/burst1 only/],
    [{ windows: { "S1/short": UNSTABLE_ENTRY } }, /windows S1\/short: `unstable` is allowed for windows S1\/burst1 only/],
    [{ windows: { "S1/burst1": { ticket: "20", state: "flaky" } } }, /windows S1\/burst1: an entry is a ticket id or \{ "ticket", "state": "unstable" \}/],
    [{ windows: { "S1/burst1": { ticket: "20", state: "unstable", maxMedianMB: 400 } } }, /windows S1\/burst1: an entry is a ticket id or/],
    [{ windows: { "S1/burst1": { ticket: "99", state: "unstable" } } }, /windows S1\/burst1: ticket 99 has no issue file/],
  ]) {
    assert.match(validateExpectedRed(doc, { job: burstJob, issueIds: burstIds }).join("\n"), pattern, JSON.stringify(doc));
    assert.equal(judgeBurst(doc, setResult("S1/burst1", wsFive(255, 251, 240, 262, 230)), Object.keys(doc)[0]).ok, false, JSON.stringify(doc));
  }
  // The plain entry keeps its meaning: GREEN while listed is a failure.
  assert.match(judgeBurst({ windows: { "S1/burst1": "20" } }, setResult("S1/burst1", wsFive(230, 220, 240, 235, 225))).failures.join("\n"), /GREEN but listed for ticket 20/);
});

test("the committed list marks windows S1/burst1 unstable for ticket 20, its only non-plain entry; linux does not list it", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const expected = readExpectedRed(join(here, "expected-red.json"));
  assert.deepEqual(expected.windows["S1/burst1"], { ticket: "20", state: "unstable" });
  assert.equal(Object.hasOwn(expected.linux, "S1/burst1"), false);
  const objects = Object.entries(expected).flatMap(([os, e]) => Object.entries(e).filter(([, v]) => typeof v !== "string").map(([k]) => `${os} ${k}`));
  assert.deepEqual(objects, ["windows S1/burst1"]);
});

// The S1/burst1 proxy peaks (VmHWM, MB) measured for ticket 60: 48 fresh,
// sequential runs on the integration tip 97c2211 (Linux, Bun 1.4.2; METRICS.md).
const BURST1_TIP = [
  236.5, 205.9, 267.4, 235.5, 227.5, 239.4, 235.1, 255.6, 239.9, 191.2, 268.9, 240.3, 235, 234, 241.5, 235, 241.1, 214.7, 235.4, 239.7, 247.7, 207.3, 232.9, 237.3,
  235.6, 203.9, 243.8, 225.3, 234.8, 248.9, 235.7, 240.1, 234.5, 239.4, 256, 227.3, 239.7, 226.9, 262.3, 237.8, 237.4, 237.8, 235.1, 236, 218, 235.2, 242.8, 240.4,
];
// The earlier samples on unchanged code Round 6 Q1 lists (plus one CI GREEN without a recorded value).
const BURST1_EARLIER = { values: [219.1, 231.8, 234, 236.6, 236.7, 237.5, 237.7, 256.7, 264.6, 299.2], greenWithoutValue: 1 };

test("S1/burst1 is the only run judged on a median: n from the measured distribution, the 250 MB peak budget, the 400 MB ceiling", () => {
  const above = (xs) => xs.filter((v) => v > 250).length;
  const tipP = above(BURST1_TIP) / BURST1_TIP.length; // 5 / 48
  const pooledP = (above(BURST1_TIP) + above(BURST1_EARLIER.values)) / (BURST1_TIP.length + BURST1_EARLIER.values.length + BURST1_EARLIER.greenWithoutValue); // 8 / 59
  assert.deepEqual([above(BURST1_TIP), BURST1_TIP.length], [5, 48]);
  assert.equal(chooseRepetitions(tipP), 3); // 3.0 %
  assert.equal(chooseRepetitions(pooledP), 5); // 3: 5.02 % > 5 %; 5: 2.0 %
  // n is the larger of the two, so the ≤ 5 % false-RED bound holds on either estimate.
  assert.deepEqual(repetitionRule("S1/burst1"), { n: 5, check: "procPeak:proxy", budgetMB: 250, ceilingMB: 400 });
  assert.ok(Math.max(...BURST1_TIP, ...BURST1_EARLIER.values) <= 400, "the ceiling sits above every measured run");
  for (const os of Object.keys(JOB)) for (const key of JOB[os]) if (key !== "S1/burst1") assert.equal(repetitionRule(key), null, `${os} ${key}`);
});

test("the windows leg runs S1, S2 (offline fixture), S3, S4, S5 and S7 — the linux runs without S6", () => {
  assert.deepEqual(JOB.windows, JOB.linux.filter((k) => !k.startsWith("S6/")));
  assert.ok(JOB.windows.includes("S3/hung") && JOB.windows.includes("S2/short"));
});
