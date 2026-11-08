// The memory loop's definition of RED, pinned with hand-built series.
import { test } from "node:test";
import assert from "node:assert/strict";
import { osVerdict, verdict } from "./lib/verdict.mjs";
import { MEMORY, OMP_LEG, PROCESSES, s3Budgets } from "./lib/budgets.mjs";
import { ompLegChecks } from "./lib/omp-leg.mjs";
import { roleOf } from "./lib/sampler.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRatchet, issueIdsIn, readExpectedRed, UNSTABLE, validateExpectedRed } from "./lib/ratchet.mjs";
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
// Each listed single run maps its owner tickets to the checks they own (Round 14 Q1, Round 15 Q1).
const job = { linux: ["S1/short", "S1/burst16", "S3/short"] };
const issueIds = new Set(["19", "37"]);
const judge = (expected, results, os = "linux") => checkRatchet({ expected, os, results, job, issueIds });
const outcome = (key, exitCode) => ({ key, exitCode });
// A run as job.mjs hands it over: RED on `procPeak:proxy` (S1) or `peak:kit` (S3) when exit 1.
const seen = (key, exitCode) => ({ ...outcome(key, exitCode), redChecks: exitCode === 1 ? [key.startsWith("S3/") ? "peak:kit" : "procPeak:proxy"] : [], checkNames: ["procPeak:proxy", "peak:kit", "orphans"] });
const burst16 = { owners: { 19: ["procPeak:proxy"] } };
const s3 = (ticket = "37") => ({ owners: { [ticket]: ["peak:kit"] } });

test("ratchet: every RED run listed and every other run GREEN passes", () => {
  const r = judge({ linux: { "S1/burst16": burst16, "S3/short": s3() } }, [seen("S1/short", 0), seen("S1/burst16", 1), seen("S3/short", 1)]);
  assert.deepEqual(r.failures, []);
  assert.equal(r.ok, true);
});

test("ratchet: a RED run that is not listed fails", () => {
  const r = judge({ linux: { "S1/burst16": burst16 } }, [seen("S1/short", 0), seen("S1/burst16", 1), seen("S3/short", 1)]);
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S3\/short.*RED.*not listed/);
});

test("ratchet: a listed run that is GREEN fails until its entry is deleted", () => {
  const r = judge({ linux: { "S1/burst16": burst16, "S3/short": s3() } }, [seen("S1/short", 0), seen("S1/burst16", 0), seen("S3/short", 1)]);
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S1\/burst16.*GREEN.*delete/);
});

test("ratchet: a harness failure fails even when the run is listed", () => {
  const r = judge({ linux: { "S1/burst16": burst16, "S3/short": s3() } }, [seen("S1/short", 0), seen("S1/burst16", 2), seen("S3/short", 1)]);
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S1\/burst16.*harness failure/);
});

test("ratchet: an unknown scenario, variant or OS leg fails", () => {
  const all = [seen("S1/short", 0), seen("S1/burst16", 1), seen("S3/short", 1)];
  const base = { "S1/burst16": burst16, "S3/short": s3() };
  for (const [doc, pattern] of [
    [{ linux: { ...base, "S9/short": burst16 } }, /S9\/short.*unknown scenario/],
    [{ linux: { ...base, "S1/burst99": burst16 } }, /S1\/burst99.*unknown variant/],
    [{ linux: { ...base, "S1-burst16": burst16 } }, /S1-burst16.*not a run key/],
    [{ ...{ linux: base }, macos: {} }, /macos.*unknown OS leg/],
  ]) {
    const r = judge(doc, all);
    assert.equal(r.ok, false, JSON.stringify(doc));
    assert.match(r.failures.join("\n"), pattern);
  }
});

test("ratchet: a known variant that this leg's job never runs fails (it could never be checked)", () => {
  const r = checkRatchet({ expected: { linux: { "S1/burst16": burst16, "S3/short": s3() }, windows: { "S1/burst16": burst16 } }, os: "linux", results: [seen("S1/short", 0), seen("S1/burst16", 1), seen("S3/short", 1)], job: { ...job, windows: ["S1/short"] }, issueIds });
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /windows.*S1\/burst16.*not run by the windows job/);
});

test("ratchet: a ticket id with no issue file fails", () => {
  const r = judge({ linux: { "S1/burst16": burst16, "S3/short": s3("99") } }, [seen("S1/short", 0), seen("S1/burst16", 1), seen("S3/short", 1)]);
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S3\/short.*ticket 99.*no issue file/);
  const malformed = judge({ linux: { "S1/burst16": burst16, "S3/short": s3("7") } }, [seen("S1/short", 0), seen("S1/burst16", 1), seen("S3/short", 1)]);
  assert.match(malformed.failures.join("\n"), /S3\/short.*ticket id/);
});

test("the committed expected-red.json is valid: known runs of each leg's job, tickets with issue files", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const expected = readExpectedRed(join(here, "expected-red.json"));
  const ids = issueIdsIn(join(here, "..", "..", ".scratch", "kit-overhaul", "issues"));
  assert.deepEqual(validateExpectedRed(expected, { issueIds: ids }), []);
});

test("ratchet: a listed run that did not run fails", () => {
  const r = judge({ linux: { "S1/burst16": burst16, "S3/short": s3() } }, [seen("S1/short", 0), seen("S1/burst16", 1)]);
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
  // The job's own rule (n = 7 since Round 11 Q1 condition 2), seven repetitions.
  const rule = repetitionRule("S1/burst1");
  assert.equal(rule.n, 7);
  for (const [peaks, medianMB] of [[[255, 251, 240, 262, 230, 280, 245], 251], [[230, 220, 240, 235, 225, 260, 228], 230]]) {
    assert.equal(peaks.length, rule.n);
    const r = judgeBurst(unstableDoc, setResult("S1/burst1", wsFive(...peaks), rule));
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
    [{ linux: { "S1/burst1": UNSTABLE_ENTRY } }, /linux S1\/burst1: `unstable` is allowed for windows S1\/burst1, windows S5\/short only/],
    [{ windows: { "S1/short": UNSTABLE_ENTRY } }, /windows S1\/short: `unstable` is allowed for windows S1\/burst1, windows S5\/short only/],
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

test("the committed list marks windows S1/burst1 unstable for ticket 20 and windows S5/short unstable for ticket 30, its only unstable entries", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const expected = readExpectedRed(join(here, "expected-red.json"));
  assert.deepEqual(expected.windows["S1/burst1"], { ticket: "20", state: "unstable" });
  assert.equal(Object.hasOwn(expected.linux, "S1/burst1"), false);
  // Round 13 Q1: windows S5/short is the same defect as linux S5/short, one owner (ticket 30); linux stays
  // a binary entry (since Round 14/15 Q1 one that names the check ticket 30 owns).
  assert.deepEqual(expected.windows["S5/short"], { ticket: "30", state: "unstable" });
  // Round 17 Q2: its one name flips (RED in 9 of 10 runs on ticket 13's tree, run 42436186573 GREEN on the trend flag).
  assert.deepEqual(expected.linux["S5/short"], { owners: { 30: ["growth:mcp-bridge"] }, flips: ["growth:mcp-bridge"] });
  const unstable = Object.entries(expected).flatMap(([os, e]) => Object.entries(e).filter(([, v]) => v?.state === "unstable").map(([k]) => `${os} ${k}`));
  assert.deepEqual(unstable, ["windows S1/burst1", "windows S5/short"]);
});

// ── The `unstable` entry: windows S5/short, a growth-value band (Round 13 Q1 conditions 1 and 3) ──
// Judged on the commit value of growth:mcp-bridge, not on RED/GREEN: 5 < v ≤ 30
// passes with either trend flag and prints its line; > 30 fails; ≤ 5 fails as
// "at budget but listed"; any other RED fails; no value is a measurement gap.
// The result as job.mjs hands it to the ratchet (`growthChecks` from summary.json).
const S5_ENTRY = { ticket: "30", state: "unstable" };
const s5Doc = { windows: { "S5/short": S5_ENTRY } };
const s5Job = { linux: ["S5/short", "S1/short"], windows: ["S5/short", "S1/short", "S3/short"] };
const s5Ids = new Set(["30", "37"]);
const bridgeGrowth = (value, trend, extra = {}) => ({ name: "growth:mcp-bridge", red: value > 5 && trend, value, commitValue: value, wsValue: 25.03, gate: "commit", budget: 5, trend, insufficient: false, samples: 704, ...extra });
const s5Result = ({ growth = bridgeGrowth(23.71, true), red = [], exitCode } = {}) => {
  const redChecks = [...(growth?.red ? [growth.name] : []), ...red];
  return { key: "S5/short", exitCode: exitCode ?? (redChecks.length ? 1 : 0), redChecks, growthChecks: growth ? [growth] : [] };
};
const judgeS5 = (expected, result, { os = "windows", unstable } = {}) => checkRatchet({ expected, os, results: [result, outcome("S1/short", 0), outcome("S3/short", 0)], job: s5Job, issueIds: s5Ids, ...(unstable ? { unstable } : {}) });
const s5Line = (value, trend) => `S5/short: unstable (growth:mcp-bridge ${value} %/1k commit, budget 5, bound 30, trend ${trend}), owned by ticket 30`;

test("UNSTABLE holds two keys, each with its own bound kind: S1/burst1 a median bound, S5/short a growth-value band", () => {
  assert.deepEqual(UNSTABLE, { windows: { "S1/burst1": { maxMedianMB: 300 }, "S5/short": { growthBand: { check: "growth:mcp-bridge", budget: 5, max: 30 } } } });
  assert.equal(UNSTABLE.windows["S5/short"].growthBand.budget, MEMORY.growth.maxPctPer1k, "the band's floor is the growth budget itself");
});

test("unstable S5/short: 6, 15.55, 23.71, 26.24 and 30 pass with either trend flag, each with its line", () => {
  for (const [value, trend] of [[6, true], [6, false], [15.55, false], [23.71, true], [26.24, false], [30, true], [30, false]]) {
    const r = judgeS5(s5Doc, s5Result({ growth: bridgeGrowth(value, trend) }));
    assert.deepEqual(r.failures, [], `${value} trend ${trend}`);
    const row = r.rows.find((x) => x.key === "S5/short");
    assert.equal(row.state, "unstable");
    assert.equal(row.outcome, trend ? "RED" : "GREEN");
    assert.equal(row.note, s5Line(value, trend));
  }
});

test("unstable S5/short: 30.01 fails as a step change, 5 and 4.9 fail as at budget but listed (either trend)", () => {
  for (const trend of [true, false]) {
    const high = judgeS5(s5Doc, s5Result({ growth: bridgeGrowth(30.01, trend) }));
    assert.equal(high.ok, false);
    assert.deepEqual(high.failures, ["S5/short: unstable growth:mcp-bridge 30.01 %/1k (commit) is above the 30 %/1k bound (windows, Round 13 Q1 condition 1)"]);
    for (const value of [5, 4.9]) {
      const low = judgeS5(s5Doc, s5Result({ growth: bridgeGrowth(value, trend) }));
      assert.equal(low.ok, false, `${value}`);
      assert.deepEqual(low.failures, [`S5/short: growth:mcp-bridge ${value} %/1k (commit) is at budget (≤ 5) but listed for ticket 30: the ownership comes back as a question (windows, Round 13 Q1 condition 1)`]);
      assert.equal(low.rows.find((x) => x.key === "S5/short").note, undefined);
    }
  }
});

test("unstable S5/short: a growth value in the band with any other RED check fails (procPeak WS, orphans, reboot cost, task failures)", () => {
  for (const other of ["procPeak:mcp-bridge", "orphans", "bridge:reboot-cost-of-history", "bridge:task-failures"]) {
    for (const growth of [bridgeGrowth(23.71, true), bridgeGrowth(15.55, false)]) {
      const r = judgeS5(s5Doc, s5Result({ growth, red: [other] }));
      assert.equal(r.ok, false, other);
      assert.match(r.failures.join("\n"), new RegExp(`^S5/short: RED on ${other}: the unstable entry accepts only growth:mcp-bridge within its band`), other);
      assert.equal(r.rows.find((x) => x.key === "S5/short").note, undefined, `${other}: no unstable pass line`);
    }
  }
  // RED with no red check at all is no growth-only RED either.
  assert.match(judgeS5(s5Doc, { ...s5Result({ growth: bridgeGrowth(15.55, false) }), exitCode: 1 }).failures.join("\n"), /S5\/short: RED on no red check: the unstable entry accepts only growth:mcp-bridge/);
});

test("unstable S5/short: an insufficient growth check, no value, no growth check or no commit value fails as a measurement gap", () => {
  const cases = {
    insufficient: bridgeGrowth(undefined, false, { insufficient: true, samples: 3, value: undefined, commitValue: undefined, wsValue: undefined }),
    "no value": bridgeGrowth(null, false, { value: null, commitValue: null }),
    "no commit value (not judged on commit)": bridgeGrowth(23.71, true, { commitValue: undefined, gate: undefined }),
    "WS gate": bridgeGrowth(23.71, true, { gate: "ws" }),
    "no growth check": null,
  };
  for (const [label, growth] of Object.entries(cases)) {
    const r = judgeS5(s5Doc, s5Result({ growth }));
    assert.equal(r.ok, false, label);
    assert.match(r.failures.join("\n"), /^S5\/short: unstable entry without a commit value of growth:mcp-bridge \(.+\): a measurement gap \(windows, Round 13 Q1 condition 1, Round 6 Q2 condition 2\)$/m, label);
    assert.equal(r.rows.find((x) => x.key === "S5/short").note, undefined, label);
  }
});

test("unstable S5/short: a harness failure (no Job Object, failed units self-test, timeout) fails", () => {
  const r = judgeS5(s5Doc, { ...s5Result({ growth: bridgeGrowth(15.55, false) }), exitCode: 2, error: "Job Object cap not applied: no @@JOB report" });
  assert.equal(r.ok, false);
  assert.match(r.failures.join("\n"), /S5\/short: harness failure \(exit 2\); a harness failure is never expected/);
});

test("unstable is a schema error on linux S5/short and on any third key; the S1/burst1 entry still validates", () => {
  assert.deepEqual(validateExpectedRed(s5Doc, { job: s5Job, issueIds: s5Ids }), []);
  assert.deepEqual(validateExpectedRed(unstableDoc, { job: burstJob, issueIds: burstIds }), []);
  const allowed = /`unstable` is allowed for windows S1\/burst1, windows S5\/short only \(Round 9 Q1 condition 3, Round 13 Q1 condition 3\)/;
  for (const [doc, key] of [[{ linux: { "S5/short": S5_ENTRY } }, "linux S5/short"], [{ windows: { "S3/short": { ticket: "37", state: "unstable" } } }, "windows S3/short"]]) {
    const errors = validateExpectedRed(doc, { job: s5Job, issueIds: s5Ids }).join("\n");
    assert.match(errors, new RegExp(`${key.replace("/", "\\/")}: ${allowed.source}`), key);
  }
  // A linux S5/short marked unstable never passes, whatever its value.
  assert.equal(judgeS5({ linux: { "S5/short": S5_ENTRY } }, s5Result({ growth: bridgeGrowth(23.71, true) }), { os: "linux" }).ok, false);
  // An entry carrying its own bound is refused: the bounds live in code.
  for (const extra of [{ maxMedianMB: 300 }, { max: 40 }]) assert.match(validateExpectedRed({ windows: { "S5/short": { ...S5_ENTRY, ...extra } } }, { job: s5Job, issueIds: s5Ids }).join("\n"), /windows S5\/short: an entry is a ticket id or/);
});

test("the allow-list's bound kind must fit its key: a median bound only on a repeated key, a growth band only on a single run", () => {
  const band = { growthBand: { check: "growth:mcp-bridge", budget: 5, max: 30 } };
  const kind = /: the `unstable` allow-list gives it .+; a repeated key takes \{ maxMedianMB \}, a single run \{ growthBand: \{ check, budget, max \} \} \(Round 13 Q1 condition 3\)/;
  for (const [unstable, doc, job] of [
    [{ windows: { "S5/short": { maxMedianMB: 300 } } }, s5Doc, s5Job],
    [{ windows: { "S1/burst1": band } }, unstableDoc, burstJob],
    [{ windows: { "S5/short": { ...band, maxMedianMB: 300 } } }, s5Doc, s5Job],
    [{ windows: { "S5/short": { growthBand: { check: "procPeak:mcp-bridge", budget: 5, max: 30 } } } }, s5Doc, s5Job],
    [{ windows: { "S5/short": { growthBand: { check: "growth:mcp-bridge", budget: 30, max: 5 } } } }, s5Doc, s5Job],
  ]) {
    const key = Object.keys(doc.windows)[0];
    const errors = validateExpectedRed(doc, { job, issueIds: new Set(["20", "30"]), unstable }).join("\n");
    assert.match(errors, new RegExp(`windows ${key.replace("/", "\\/")}${kind.source}`), JSON.stringify(unstable));
  }
  // A mis-shaped bound never judges a run.
  const r = judgeS5(s5Doc, s5Result({ growth: bridgeGrowth(23.71, true) }), { unstable: { windows: { "S5/short": { maxMedianMB: 300 } } } });
  assert.equal(r.ok, false);
  assert.equal(r.rows.find((x) => x.key === "S5/short").note, undefined);
});

// The S1/burst1 proxy peaks (VmHWM, MB) measured for ticket 60: 48 fresh,
// sequential runs on the integration tip 97c2211 (Linux, Bun 1.4.2; METRICS.md).
const BURST1_TIP = [
  236.5, 205.9, 267.4, 235.5, 227.5, 239.4, 235.1, 255.6, 239.9, 191.2, 268.9, 240.3, 235, 234, 241.5, 235, 241.1, 214.7, 235.4, 239.7, 247.7, 207.3, 232.9, 237.3,
  235.6, 203.9, 243.8, 225.3, 234.8, 248.9, 235.7, 240.1, 234.5, 239.4, 256, 227.3, 239.7, 226.9, 262.3, 237.8, 237.4, 237.8, 235.1, 236, 218, 235.2, 242.8, 240.4,
];
// The earlier samples on unchanged code Round 6 Q1 lists (plus one CI GREEN without a recorded value).
const BURST1_EARLIER = { values: [219.1, 231.8, 234, 236.6, 236.7, 237.5, 237.7, 256.7, 264.6, 299.2], greenWithoutValue: 1 };

test("S1/burst1 is judged on a median (with linux S6/short since Round 21): n from the measured distribution, the 250 MB peak budget, the 400 MB ceiling", () => {
  const above = (xs) => xs.filter((v) => v > 250).length;
  const tipP = above(BURST1_TIP) / BURST1_TIP.length; // 5 / 48
  const pooledP = (above(BURST1_TIP) + above(BURST1_EARLIER.values)) / (BURST1_TIP.length + BURST1_EARLIER.values.length + BURST1_EARLIER.greenWithoutValue); // 8 / 59
  assert.deepEqual([above(BURST1_TIP), BURST1_TIP.length], [5, 48]);
  assert.equal(chooseRepetitions(tipP), 3); // 3.0 %
  assert.equal(chooseRepetitions(pooledP), 5); // 3: 5.02 % > 5 %; 5: 2.0 %
  // Round 11 Q1 condition 2: the paired run's Bun 1.4.2 arm (CI 42352122623,
  // Linux) had 5 of 24 above 250 MB, the less favourable estimate against the
  // pooled 1.4.2 CI history of 6 of 48 (with run 42316982634's 1 of 24).
  assert.equal(chooseRepetitions(5 / 24), 7); // 5: 6.45 % > 5 %; 7: 3.83 %
  // The pooled estimate alone would allow n = 3 (4.30 %; Round 11's "returns 5"
  // quotes the n = 5 rate, 1.61 %). The less favourable estimate decides.
  assert.equal(chooseRepetitions(6 / 48), 3);
  assert.ok(Math.abs(medianFalseRedRate(5 / 24, 5) - 0.0645) < 5e-4 && Math.abs(medianFalseRedRate(5 / 24, 7) - 0.0383) < 5e-4);
  // n is the largest over the estimates, so the ≤ 5 % false-RED bound holds on each of them.
  assert.equal(Math.max(chooseRepetitions(tipP), chooseRepetitions(pooledP), chooseRepetitions(5 / 24), chooseRepetitions(6 / 48)), 7);
  assert.deepEqual(repetitionRule("S1/burst1"), { n: 7, check: "procPeak:proxy", budgetMB: 250, ceilingMB: 400 });
  assert.ok(Math.max(...BURST1_TIP, ...BURST1_EARLIER.values) <= 400, "the ceiling sits above every measured run");
  // Round 21 Q1 (ticket 71): linux S6/short is judged on a median of 5 too, with its own n (pinned below).
  for (const os of Object.keys(JOB)) for (const key of JOB[os]) if (key !== "S1/burst1" && key !== "S6/short") assert.equal(repetitionRule(key), null, `${os} ${key}`);
});

// Round 17 Q3 (ticket 71): windows S1/short commit growth over 49 CI runs, min
// 1.43, median 3.56, max 5.27 %/1k, RED in 2 of 49; normal fit P(> 5) = 4.3 %,
// log-normal 7.8 %. Linux S1/short: 70 runs, max 4.43, never RED.
test("windows S1/short is judged on 5 fresh repetitions, RED at ≥ 3 RED, ceiling 10 %/1k; n from the 49-run distribution at ≤ 1 %; linux stays a single run", async () => {
  const { REPEATED } = await import("./lib/budgets.mjs");
  assert.deepEqual(repetitionRule("S1/short", REPEATED, "windows"), { legs: ["windows"], kind: "majority", n: 5, redAtLeast: 3, check: "growth:proxy", budget: MEMORY.growth.maxPctPer1k, ceiling: 10, unit: "%/1k" });
  assert.equal(repetitionRule("S1/short", REPEATED, "linux"), null);
  // ≥ 3 of 5 RED is the binomial tail the median rule uses: the less favourable (log-normal) fit decides.
  assert.equal(chooseRepetitions(0.078, { target: 0.01 }), 5);
  assert.ok(Math.abs(medianFalseRedRate(0.078, 3) - 0.0173) < 5e-4 && Math.abs(medianFalseRedRate(0.078, 5) - 0.0042) < 5e-4);
  assert.ok(Math.abs(medianFalseRedRate(2 / 49, 5) - 0.0006) < 1e-4, "empirical 2 of 49: 0.06 %");
  assert.ok(Math.abs(medianFalseRedRate(0.14, 5) - 0.022) < 1e-3, "at the 95 % upper bound p = 0.14: 2.2 %");
  assert.ok(10 - 5.27 > 4.7, "the ceiling sits 4.73 above the observed maximum");
  // The keys judged on repetitions, per leg: every other run of either job is judged on one run.
  const repeatedKeys = Object.fromEntries(Object.keys(JOB).map((os) => [os, JOB[os].filter((k) => repetitionRule(k, REPEATED, os))]));
  assert.deepEqual(repeatedKeys, { linux: ["S1/burst1", "S6/short"], windows: ["S1/short", "S1/burst1"] });
});

// Round 21 Q1 (ticket 71): tui:adversarial-line-heap read exactly 8 MB in 32 of 33
// CI runs on the same S6 code and 20 MB once (42446461464); 1 of 10 on the staging/19 tree.
test("linux S6/short is judged on the median of 5 fresh repetitions against 16 MB, every repetition ≤ 32 MB; n from 1 of 10 at ≤ 1 %", async () => {
  const { REPEATED } = await import("./lib/budgets.mjs");
  assert.deepEqual(repetitionRule("S6/short", REPEATED, "linux"), { n: 5, check: "tui:adversarial-line-heap", budgetMB: MEMORY.S6.longLineHeapMB, ceilingMB: 32 });
  assert.equal(MEMORY.S6.longLineHeapMB, 16);
  assert.equal(JOB.windows.includes("S6/short"), false, "S6 is ubuntu-only: windows is unaffected");
  assert.equal(chooseRepetitions(1 / 10, { target: 0.01 }), 5);
  assert.ok(Math.abs(medianFalseRedRate(1 / 10, 3) - 0.028) < 5e-4 && Math.abs(medianFalseRedRate(1 / 10, 5) - 0.0086) < 5e-4);
  assert.ok(Math.abs(medianFalseRedRate(1 / 33, 5) - 0.00027) < 5e-5, "1 of 33: 0.027 %");
  assert.ok(8 + 20 < 32 && 32 < 40, "the ceiling clears the pane's 8 MB plus one stray 20 MB object and fails two retained parents");
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

// ── The OMP no-op floor (ticket 03's floor test; Round 17 Q4, ticket 71) ────
// n fresh stub hosts, each charged for a hook that does nothing: the median
// cost < 2.5 MB (half the waiter gate), every repetition < 5 MB (the gate),
// every value printed. The windows commit floor reached 2.55 once in 16 legs.
test("OMP floor: one 2.55 MB repetition among five passes on the median; a median at 2.5 fails; one repetition at 5 MB fails with a GREEN median", async () => {
  const { floorVerdict } = await import("./lib/repetitions.mjs");
  const rule = { n: 5, medianBelowMB: 2.5, everyBelowMB: 5 };
  assert.deepEqual(floorVerdict([0.7, 0.6, 2.55, 0.8, 0.7], rule), { ok: true, error: null, values: [0.7, 0.6, 2.55, 0.8, 0.7], medianMB: 0.7, atOrAboveGate: [], failures: [] });
  const median = floorVerdict([2.6, 2.55, 2.5, 0.7, 0.6], rule);
  assert.deepEqual([median.ok, median.medianMB, median.failures], [false, 2.5, ["median no-op cost 2.5 MB is not below 2.5 MB"]]);
  const gate = floorVerdict([0.7, 0.6, 5, 0.8, 0.7], rule);
  assert.deepEqual([gate.ok, gate.medianMB, gate.atOrAboveGate, gate.failures], [false, 0.7, [3], ["repetition 3 charged 5 MB, not below the 5 MB waiter gate"]]);
  assert.equal(floorVerdict([0.7, 0.6, 4.99, 0.8, 0.7], rule).ok, true);
});

test("OMP floor: fewer repetitions than n or a repetition without a numeric cost is a harness failure, never a pass", async () => {
  const { floorVerdict } = await import("./lib/repetitions.mjs");
  const rule = { n: 5, medianBelowMB: 2.5, everyBelowMB: 5 };
  const four = floorVerdict([0.7, 0.6, 0.8, 0.7], rule);
  assert.deepEqual([four.ok, four.error], [false, "4 of 5 repetitions measured"]);
  for (const bad of [null, "0.7", Number.NaN]) {
    const v = floorVerdict([0.7, 0.6, bad, 0.8, 0.7], rule);
    assert.equal(v.ok, false, String(bad));
    assert.match(v.error, /repetition 3: no numeric no-op cost/, String(bad));
  }
});

test("OMP floor n from data (Round 17 Q4 condition 1): the smallest odd n in {3, 5, 7, 9} at ≤ 1 % predicted false fails on the fraction at or above 2.5 MB; ≥ 5 MB or no n comes back", async () => {
  const { floorMeasurement } = await import("./lib/repetitions.mjs");
  const twenty = (high) => Array.from({ length: 20 }, (_, i) => (i < high.length ? high[i] : 0.7));
  const one = floorMeasurement(twenty([2.55]), { thresholdMB: 2.5, gateMB: 5 });
  assert.deepEqual([one.count, one.atOrAbove, one.p, one.n, one.comesBack], [20, 1, 0.05, 3, []]);
  assert.equal(one.falseFailRate["3"], 0.0073);
  // The windows record so far: 1 of 16 legs above 2.5 (2.55 MB, run 42436440284) → n = 5 (n = 3: 1.12 %).
  assert.equal(floorMeasurement([2.55, ...Array(15).fill(0.7)], { thresholdMB: 2.5, gateMB: 5 }).n, 5);
  assert.equal(floorMeasurement(twenty([]), { thresholdMB: 2.5, gateMB: 5 }).n, 3);
  const gate = floorMeasurement(twenty([5.1]), { thresholdMB: 2.5, gateMB: 5 });
  assert.match(gate.comesBack.join(), /1 measurement ≥ 5 MB/);
  const none = floorMeasurement(twenty([3, 3, 3, 3, 3, 3, 3, 3]), { thresholdMB: 2.5, gateMB: 5 });
  assert.equal(none.n, null);
  assert.match(none.comesBack.join(), /no n in 3, 5, 7, 9 reaches ≤ 1 %/);
  // n is the larger of the two legs' n (the less favourable leg decides).
  assert.equal(Math.max(one.n, floorMeasurement([2.55, ...Array(15).fill(0.7)], { thresholdMB: 2.5, gateMB: 5 }).n), 5);
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
  assert.deepEqual(expected.linux["S3/omp"].owners["35"], ["omp:concurrent-preflights"]);
  assert.deepEqual(expected.windows["S3/omp"].owners["35"], ["omp:concurrent-preflights"]);
});

test("S3/omp is listed on both legs with 35 owning the concurrent preflights and 37 the flipping role peaks: RED passes, GREEN passes on the flips, `unstable` is refused", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const expected = readExpectedRed(join(here, "expected-red.json"));
  const issueIds = issueIdsIn(join(here, "..", "..", ".scratch", "kit-overhaul", "issues"));
  // Round 15 Q1 condition 3.
  assert.deepEqual(expected.linux["S3/omp"], { owners: { 35: ["omp:concurrent-preflights"], 37: ["procPeak:proxy", "procPeak:preflight"] }, flips: ["procPeak:proxy", "procPeak:preflight"] });
  assert.deepEqual(expected.windows["S3/omp"], { owners: { 35: ["omp:concurrent-preflights"], 37: ["peak:kit"] }, flips: ["peak:kit"] });
  for (const os of ["linux", "windows"]) {
    const results = JOB[os].map((key) => {
      const entry = expected[os][key];
      if (entry?.state === "unstable" && key === "S5/short") return { key, exitCode: 0, redChecks: [], growthChecks: [{ name: "growth:mcp-bridge", red: false, value: 15.55, commitValue: 15.55, gate: "commit", budget: 5, trend: false }] };
      if (entry?.state === "unstable") return { key, exitCode: 0, redChecks: [], median: { medianMB: 240, budgetMB: 250, check: "procPeak:proxy" } };
      // Each listed single run RED on its first owner's first check, every other run GREEN.
      const names = entry ? Object.values(entry.owners).flat() : [];
      return { key, exitCode: entry ? 1 : 0, redChecks: entry ? [names[0]] : [], checkNames: names };
    });
    const red = checkRatchet({ expected, os, results, issueIds });
    assert.deepEqual(red.failures, [], os);
    const green = checkRatchet({ expected, os, results: results.map((r) => (r.key === "S3/omp" ? { ...r, exitCode: 0, redChecks: [] } : r)), issueIds });
    assert.deepEqual(green.failures, [], os);
    assert.equal(green.rows.find((x) => x.key === "S3/omp").note, `S3/omp: GREEN, listed for ticket 37 on flipping checks ${expected[os]["S3/omp"].flips.join(", ")} (Round 15 Q1)`);
    const unstable = { ...expected, [os]: { ...expected[os], "S3/omp": { ticket: "35", state: "unstable" } } };
    assert.match(validateExpectedRed(unstable, { issueIds }).join("\n"), new RegExp(`${os} S3/omp: \`unstable\` is allowed for windows S1/burst1, windows S5/short only`));
  }
});

test("OMP leg on Windows: the waiter cost is gated on commit and reported with its working set", () => {
  const r = singleFlight();
  for (const h of r.hosts) Object.assign(h, { metric: "commit", costMB: 3.2, wsCostMB: 1.1 });
  r.hosts[2].costMB = 5.6;
  const c = ompCheck([r], "omp:waiter-cost");
  assert.equal(c.red, true, "a waiter above 5 MB of commit is red, whatever its working set");
  assert.equal(c.value, 5.6);
  assert.equal(c.gate, "commit");
  assert.match(c.detail.join("\n"), /omp-5 host 2 waiter \+5\.6 MB commit \/ \+1\.1 MB WS/);
  // Linux: RSS only, as before.
  const linux = ompCheck([singleFlight()], "omp:waiter-cost");
  assert.equal(linux.gate, undefined);
  assert.match(linux.detail.join("\n"), /omp-5 host 1 waiter \+1\.2 MB$/m);
});

// ── A listed single-run key names the checks its tickets own (Round 14 Q1, Round 15 Q1) ──
// A single-run entry that is not `unstable` maps owner ticket → check names,
// one owner per check: { "owners": { "<NN>": [<check>, …] }, "flips": [<check>, …] }.
// RED only on owned checks passes and prints "<key>: RED on <checks>, owned by
// ticket <t> (<names>), …"; RED on any other check fails as an ownership
// question naming every owner; RED with no check named, a harness failure and
// an owned name the run does not produce (stale or mistyped, Round 3 Q8
// condition 2) all fail. GREEN passes only while a name is marked `flips`
// (Round 15 Q1 condition 4); otherwise GREEN while listed fails. Repeated keys
// keep their median rule; the two `unstable` keys refuse owners and flips.
// The Round 14 cases below are unchanged in input and outcome; their entries
// use the Round 15 shape through `owned()` and their lines the Round 15 wording.
const ownsJob = { linux: ["S1/short", "S1/burst1", "S1/burst16", "S3/short"], windows: ["S1/short", "S1/burst1", "S1/burst16", "S3/short", "S5/short"] };
const ownsIds = new Set(["16", "17", "19", "20", "30", "37"]);
const S3_NAMES = ["peak:kit", "procPeak:launcher", "procPeak:proxy", "count:proxy", "orphans", "exactly-one-proxy-after-round", "failed-launches", "stale-lock-after-round"];
const S1_NAMES = ["procPeak:proxy", "count:proxy", "orphans", "steady:proxy"];
/** A single run as job.mjs hands it to the ratchet: its RED checks and every check name it produced. */
const run1 = (key, red = [], names = key.startsWith("S3/") ? S3_NAMES : S1_NAMES) => ({ key, exitCode: red.length ? 1 : 0, redChecks: red, checkNames: names });
/** A single-owner entry in the Round 15 shape. */
const owned = (ticket, ...owns) => ({ owners: { [ticket]: owns } });
const ownsDoc = { linux: { "S1/burst16": owned("19", "procPeak:proxy"), "S3/short": owned("37", "peak:kit", "procPeak:launcher", "procPeak:proxy") } };
const judgeOwns = (expected, results, os = "linux") => checkRatchet({ expected, os, results: [run1("S1/short"), run1("S1/burst1"), ...results], job: ownsJob, issueIds: ownsIds });
const tickets = (t) => { const ts = [t].flat(); return `${ts.length > 1 ? "tickets" : "ticket"} ${ts.join(", ")}`; };
const notOwned = (key, check, t, os = "linux") => `${key}: RED on ${check}, not owned by ${tickets(t)} (${os}, Round 14 Q1, Round 15 Q1); the RED comes back as an ownership question, do not edit owners`;
const SHAPE_ERROR = /a listed single-run key maps owner ticket → check names: \{ "owners": \{ "<NN>": \["<check>", …\] \}, "flips": \["<check>", …\] \} \(Round 14 Q1 condition 1, Round 15 Q1 condition 1\)/;

test("owns: a plain ticket id (string or number) for a listed single-run key is a schema error", () => {
  for (const value of ["37", 37]) {
    const errors = validateExpectedRed({ linux: { ...ownsDoc.linux, "S3/short": value } }, { job: ownsJob, issueIds: ownsIds }).join("\n");
    assert.match(errors, new RegExp(`linux S3\\/short: ${SHAPE_ERROR.source}`), JSON.stringify(value));
  }
  assert.deepEqual(validateExpectedRed(ownsDoc, { job: ownsJob, issueIds: ownsIds }), []);
  // A plainly listed single run never passes the ratchet, whatever it ran.
  assert.equal(judgeOwns({ linux: { ...ownsDoc.linux, "S3/short": "37" } }, [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short", ["peak:kit"])]).ok, false);
  // Round 14's single-ticket shape is gone too (Round 15 Q1 condition 1: one shape).
  assert.match(validateExpectedRed({ linux: { ...ownsDoc.linux, "S3/short": { ticket: "37", owns: ["peak:kit"] } } }, { job: ownsJob, issueIds: ownsIds }).join("\n"), /linux S3\/short: an entry is a ticket id or/);
});

test("owns: an empty list, a duplicate name, a non-string or empty name, or an extra field is a schema error", () => {
  for (const [value, pattern] of [
    [{ owners: { 37: [] } }, /linux S3\/short: owner 37 must name at least one check/],
    [{ owners: { 37: ["peak:kit", "peak:kit"] } }, /linux S3\/short: owner 37 names peak:kit twice/],
    [{ owners: { 37: ["peak:kit", 7] } }, /linux S3\/short: owner 37 holds check names \(non-empty strings\), got 7/],
    [{ owners: { 37: ["peak:kit", ""] } }, /linux S3\/short: owner 37 holds check names \(non-empty strings\), got ""/],
    [{ owners: { 37: "peak:kit" } }, /linux S3\/short: owner 37 must be a list of check names/],
    [{ owners: { 37: ["peak:kit"] }, note: "x" }, /linux S3\/short: an entry is a ticket id or \{ "ticket", "state": "unstable" \}/],
  ]) {
    const errors = validateExpectedRed({ linux: { ...ownsDoc.linux, "S3/short": value } }, { job: ownsJob, issueIds: ownsIds });
    assert.match(errors.join("\n"), pattern, JSON.stringify(value));
  }
});

test("owners and flips are a schema error on a repeated key and on either unstable key (windows S1/burst1, windows S5/short)", () => {
  for (const [os, key, value] of [
    ["windows", "S1/burst1", { owners: { 20: ["median:procPeak:proxy"] } }],
    ["windows", "S1/burst1", { ticket: "20", state: "unstable", owners: { 20: ["median:procPeak:proxy"] } }],
    ["windows", "S1/burst1", { ticket: "20", state: "unstable", flips: ["median:procPeak:proxy"] }],
    ["linux", "S1/burst1", { owners: { 20: ["median:procPeak:proxy"] } }],
    ["windows", "S5/short", { owners: { 30: ["growth:mcp-bridge"] } }],
    ["windows", "S5/short", { ticket: "30", state: "unstable", owners: { 30: ["growth:mcp-bridge"] } }],
    ["windows", "S5/short", { owners: { 30: ["growth:mcp-bridge"] }, flips: ["growth:mcp-bridge"] }],
  ]) {
    const errors = validateExpectedRed({ [os]: { [key]: value } }, { job: ownsJob, issueIds: ownsIds }).join("\n");
    assert.match(errors, new RegExp(`${os} ${key.replace("/", "\\/")}: \`owners\` and \`flips\` are not allowed (on a repeated key|on an \`unstable\` key)`), `${os} ${key} ${JSON.stringify(value)}`);
  }
  // The unstable entries themselves still validate unchanged.
  assert.deepEqual(validateExpectedRed({ windows: { "S1/burst1": { ticket: "20", state: "unstable" }, "S5/short": { ticket: "30", state: "unstable" } } }, { job: ownsJob, issueIds: ownsIds }), []);
});

test("owns: RED only on owned checks passes and prints its line; an owned check may be GREEN", () => {
  const r = judgeOwns(ownsDoc, [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short", ["peak:kit", "procPeak:launcher"])]);
  assert.deepEqual(r.failures, []);
  assert.equal(r.rows.find((x) => x.key === "S3/short").note, "S3/short: RED on peak:kit, procPeak:launcher, owned by ticket 37 (peak:kit, procPeak:launcher)");
  assert.equal(r.rows.find((x) => x.key === "S1/burst16").note, "S1/burst16: RED on procPeak:proxy, owned by ticket 19 (procPeak:proxy)");
});

test("owns: RED on a check the ticket does not own fails, also next to an owned RED", () => {
  for (const red of [["peak:kit", "orphans"], ["orphans", "failed-launches"]]) {
    const r = judgeOwns(ownsDoc, [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short", red)]);
    assert.equal(r.ok, false, red.join());
    const unowned = red.filter((c) => c !== "peak:kit");
    assert.deepEqual(r.failures, unowned.map((c) => notOwned("S3/short", c, "37")), red.join());
    assert.equal(r.rows.find((x) => x.key === "S3/short").note, undefined, "no tolerated line for a run that fails");
  }
});

test("owns: an owned check GREEN while an unowned check is RED fails", () => {
  const r = judgeOwns(ownsDoc, [run1("S1/burst16", ["orphans"]), run1("S3/short", ["peak:kit"])]);
  assert.deepEqual(r.failures, [notOwned("S1/burst16", "orphans", "19")]);
});

test("owns: RED with no RED check named fails", () => {
  const r = judgeOwns(ownsDoc, [run1("S1/burst16", ["procPeak:proxy"]), { ...run1("S3/short"), exitCode: 1 }]);
  assert.deepEqual(r.failures, ["S3/short: RED with no RED check named, so nothing shows it belongs to ticket 37 (linux, Round 14 Q1)"]);
});

test("owns: GREEN while listed and a harness failure still fail", () => {
  const green = judgeOwns(ownsDoc, [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short")]);
  assert.deepEqual(green.failures, ["S3/short: GREEN but listed for ticket 37: delete the entry from expected-red.json (linux)"]);
  const harness = judgeOwns(ownsDoc, [run1("S1/burst16", ["procPeak:proxy"]), { ...run1("S3/short", ["peak:kit"]), exitCode: 2 }]);
  assert.deepEqual(harness.failures, ["S3/short: harness failure (exit 2); a harness failure is never expected"]);
});

test("owns: an owned name the run does not produce fails as stale or mistyped, and so does a run without its check names", () => {
  const typo = { linux: { ...ownsDoc.linux, "S3/short": owned("37", "peak:kit", "procPeak:launcherr") } };
  const r = judgeOwns(typo, [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short", ["peak:kit"])]);
  assert.deepEqual(r.failures, ["S3/short: ticket 37 owns procPeak:launcherr, which this run does not produce: a stale or mistyped name (linux, Round 14 Q1, Round 3 Q8 condition 2)"]);
  assert.equal(r.rows.find((x) => x.key === "S3/short").note, undefined);
  const noNames = judgeOwns(ownsDoc, [run1("S1/burst16", ["procPeak:proxy"]), { key: "S3/short", exitCode: 1, redChecks: ["peak:kit"] }]);
  assert.deepEqual(noNames.failures, ["S3/short: the run reports no check names, so the checks of ticket 37 cannot be matched (linux, Round 14 Q1, Round 3 Q8 condition 2)"]);
});

test("owns leaves a listed repeated key on its median rule (Round 9 Q1 condition 1)", () => {
  const doc = { linux: { ...ownsDoc.linux, "S1/burst1": "20" } };
  const median = { key: "S1/burst1", exitCode: 1, redChecks: ["median:procPeak:proxy"], median: { medianMB: 255, budgetMB: 250 } };
  const base = [run1("S1/short"), run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short", ["peak:kit"])];
  assert.deepEqual(checkRatchet({ expected: doc, os: "linux", results: [median, ...base], job: ownsJob, issueIds: ownsIds }).failures, []);
  const ceiling = { ...median, redChecks: ["median:procPeak:proxy", "ceiling:procPeak:proxy"] };
  assert.match(checkRatchet({ expected: doc, os: "linux", results: [ceiling, ...base], job: ownsJob, issueIds: ownsIds }).failures.join("\n"), /S1\/burst1: RED on ceiling:procPeak:proxy: a listed repeated run accepts only median:procPeak:proxy/);
});

// ── Round 15 Q1: several owners per entry, one owner per check, flipping names ──
const twoOwners = (extra = {}) => ({ linux: { ...ownsDoc.linux, "S3/short": { owners: { 16: ["failed-launches", "stale-lock-after-round", "exactly-one-proxy-after-round"], 37: ["peak:kit", "procPeak:proxy"] }, ...extra } } });

test("owners: a two-owner entry passes on each owner's RED and prints both, and an unowned RED fails naming both owners", () => {
  for (const [red, line] of [
    [["peak:kit", "failed-launches"], "S3/short: RED on peak:kit, failed-launches, owned by ticket 16 (failed-launches), ticket 37 (peak:kit)"],
    [["failed-launches", "stale-lock-after-round"], "S3/short: RED on failed-launches, stale-lock-after-round, owned by ticket 16 (failed-launches, stale-lock-after-round)"],
    [["procPeak:proxy"], "S3/short: RED on procPeak:proxy, owned by ticket 37 (procPeak:proxy)"],
  ]) {
    const r = judgeOwns(twoOwners(), [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short", red)]);
    assert.deepEqual(r.failures, [], red.join());
    assert.equal(r.rows.find((x) => x.key === "S3/short").note, line);
  }
  const orphan = judgeOwns(twoOwners(), [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short", ["peak:kit", "failed-launches", "orphans"])]);
  assert.deepEqual(orphan.failures, [notOwned("S3/short", "orphans", ["16", "37"])]);
  assert.equal(orphan.rows.find((x) => x.key === "S3/short").note, undefined);
});

test("owners: a check under two owners, an empty owners map or an owner id without an issue file is a schema error", () => {
  const errorsOf = (entry) => validateExpectedRed({ linux: { ...ownsDoc.linux, "S3/short": entry } }, { job: ownsJob, issueIds: ownsIds }).join("\n");
  assert.deepEqual(validateExpectedRed(twoOwners(), { job: ownsJob, issueIds: ownsIds }), []);
  assert.match(errorsOf({ owners: { 16: ["failed-launches", "peak:kit"], 37: ["peak:kit"] } }), /linux S3\/short: peak:kit is listed under tickets 16 and 37: one owner per check \(Round 15 Q1 condition 1\)/);
  assert.match(errorsOf({ owners: {} }), /linux S3\/short: `owners` must map at least one owner ticket to its checks \(Round 15 Q1 condition 1\)/);
  assert.match(errorsOf({ owners: [] }), /linux S3\/short: `owners` must map owner tickets to check names/);
  assert.match(errorsOf({ owners: { 99: ["peak:kit"] } }), /linux S3\/short: ticket 99 has no issue file/);
  // Every owner is checked, not only the first.
  assert.match(errorsOf({ owners: { 16: ["failed-launches"], 99: ["peak:kit"] } }), /linux S3\/short: ticket 99 has no issue file/);
  assert.match(errorsOf({ owners: { 7: ["peak:kit"] } }), /linux S3\/short: ticket id must be a two-digit string, got "7"/);
  assert.match(errorsOf({ owners: { 16: [] , 37: ["peak:kit"] } }), /linux S3\/short: owner 16 must name at least one check/);
});

test("flips: a flipping name that no owner of the entry lists, an empty or repeated flips list is a schema error", () => {
  const errorsOf = (flips) => validateExpectedRed(twoOwners({ flips }), { job: ownsJob, issueIds: ownsIds }).join("\n");
  assert.equal(errorsOf(["exactly-one-proxy-after-round", "procPeak:proxy"]), "");
  assert.match(errorsOf(["orphans"]), /linux S3\/short: `flips` names orphans, which no owner of this entry lists \(Round 15 Q1 condition 1\)/);
  assert.match(errorsOf([]), /linux S3\/short: `flips` must name at least one owned check; leave it out when nothing flips/);
  assert.match(errorsOf(["procPeak:proxy", "procPeak:proxy"]), /linux S3\/short: `flips` names procPeak:proxy twice/);
  assert.match(errorsOf("procPeak:proxy"), /linux S3\/short: `flips` must be a list of check names/);
});

test("flips: a GREEN run of an entry with a flipping name passes and prints its line; without one GREEN still fails", () => {
  const one = judgeOwns(twoOwners({ flips: ["procPeak:proxy"] }), [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short")]);
  assert.deepEqual(one.failures, []);
  assert.equal(one.rows.find((x) => x.key === "S3/short").note, "S3/short: GREEN, listed for ticket 37 on flipping checks procPeak:proxy (Round 15 Q1)");
  const both = judgeOwns(twoOwners({ flips: ["exactly-one-proxy-after-round", "procPeak:proxy"] }), [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short")]);
  assert.equal(both.rows.find((x) => x.key === "S3/short").note, "S3/short: GREEN, listed for tickets 16, 37 on flipping checks exactly-one-proxy-after-round, procPeak:proxy (Round 15 Q1)");
  const none = judgeOwns(twoOwners(), [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short")]);
  assert.deepEqual(none.failures, ["S3/short: GREEN but listed for tickets 16, 37: delete the entry from expected-red.json (linux)"]);
  assert.equal(none.rows.find((x) => x.key === "S3/short").note, undefined);
  // A flipping entry is still RED-judged: an unowned RED fails, an owned one prints its owners.
  const red = judgeOwns(twoOwners({ flips: ["procPeak:proxy"] }), [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short", ["procPeak:proxy", "count:proxy"])]);
  assert.deepEqual(red.failures, [notOwned("S3/short", "count:proxy", ["16", "37"])]);
});

test("flips: a GREEN pass needs every owned name produced by the run (a stale flipping name cannot keep an entry alive)", () => {
  const stale = { linux: { ...ownsDoc.linux, "S3/short": { owners: { 37: ["peak:kit", "procPeak:gone"] }, flips: ["procPeak:gone"] } } };
  const r = judgeOwns(stale, [run1("S1/burst16", ["procPeak:proxy"]), run1("S3/short")]);
  assert.deepEqual(r.failures, ["S3/short: ticket 37 owns procPeak:gone, which this run does not produce: a stale or mistyped name (linux, Round 14 Q1, Round 3 Q8 condition 2)"]);
  assert.equal(r.rows.find((x) => x.key === "S3/short").note, undefined);
  const noNames = judgeOwns(twoOwners({ flips: ["procPeak:proxy"] }), [run1("S1/burst16", ["procPeak:proxy"]), { key: "S3/short", exitCode: 0, redChecks: [] }]);
  assert.deepEqual(noNames.failures, ["S3/short: the run reports no check names, so the checks of tickets 16, 37 cannot be matched (linux, Round 14 Q1, Round 3 Q8 condition 2)"]);
});

// One case per leg against the committed list: every listed single run RED on
// exactly the checks it owns passes; one added RED its owners do not hold fails
// naming its owners (a second proxy, count:proxy, which only windows S4/short
// owns since Round 16 Q1; there an orphan instead); an entry with flipping names
// passes GREEN with its line, one without fails GREEN.
test("the committed expected-red.json: each leg passes with every listed run RED on its owned checks, and fails on one unowned RED", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const expected = readExpectedRed(join(here, "expected-red.json"));
  const ids = issueIdsIn(join(here, "..", "..", ".scratch", "kit-overhaul", "issues"));
  const namesOf = (v) => Object.values(v.owners).flat();
  const ownersOf = (v) => Object.keys(v.owners).sort();
  for (const os of ["linux", "windows"]) {
    const entries = expected[os];
    const singles = Object.entries(entries).filter(([key, v]) => typeof v === "object" && v?.owners && !repetitionRule(key));
    // Every listed single run that is not unstable maps owners to names (Round 15 Q1 condition 1).
    for (const [key, v] of Object.entries(entries)) if (!repetitionRule(key) && v?.state !== "unstable") assert.ok(v?.owners && Object.keys(v.owners).length > 0, `${os} ${key}`);
    const results = JOB[os].map((key) => {
      const v = entries[key];
      const names = [...new Set([...(v?.owners ? namesOf(v) : []), "orphans", "count:proxy"])];
      if (v?.state === "unstable" && key === "S5/short") return { key, exitCode: 0, redChecks: [], checkNames: names, growthChecks: [{ name: "growth:mcp-bridge", red: false, value: 15.55, commitValue: 15.55, gate: "commit", budget: 5, trend: false }] };
      if (v?.state === "unstable") return { key, exitCode: 0, redChecks: [], median: { medianMB: 240, budgetMB: 250, check: "procPeak:proxy" } };
      return { key, exitCode: v ? 1 : 0, redChecks: v ? namesOf(v) : [], checkNames: names };
    });
    const r = checkRatchet({ expected, os, results, issueIds: ids });
    assert.deepEqual(r.failures, [], os);
    for (const [key, v] of singles) assert.match(r.rows.find((x) => x.key === key).note, new RegExp(`^${key.replace("/", "\\/")}: RED on .+, owned by ticket \\d\\d \\(`), `${os} ${key}`);
    for (const [key, v] of singles) {
      // Round 16 Q1: count:proxy is owned only in windows S4/short (ticket 17).
      assert.equal(namesOf(v).includes("count:proxy"), os === "windows" && key === "S4/short", `${os} ${key}`);
      const extra = ["count:proxy", "orphans"].find((c) => !namesOf(v).includes(c));
      const withExtra = results.map((x) => (x.key === key ? { ...x, redChecks: [...x.redChecks, extra] } : x));
      const bad = checkRatchet({ expected, os, results: withExtra, issueIds: ids });
      assert.deepEqual(bad.failures, [notOwned(key, extra, ownersOf(v), os)], `${os} ${key}`);
      const green = checkRatchet({ expected, os, results: results.map((x) => (x.key === key ? { ...x, exitCode: 0, redChecks: [] } : x)), issueIds: ids });
      if (v.flips) assert.deepEqual(green.failures, [], `${os} ${key} flips`);
      else assert.deepEqual(green.failures, [`${key}: GREEN but listed for ${tickets(ownersOf(v))}: delete the entry from expected-red.json (${os})`], `${os} ${key}`);
    }
  }
});
