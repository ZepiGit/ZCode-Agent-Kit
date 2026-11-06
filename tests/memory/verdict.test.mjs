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

test("median rule on Windows: judged on commit, with the working-set median beside it, so a set RED only on commit is flagged", () => {
  // Each repetition as run.mjs writes it on Windows: commit checks plus the working-set verdict's values.
  const winRep = (commitMB, wsMB) => {
    const rows = rowsOf([winProc(1, "proxy", { ws: wsMB, commit: commitMB })], [winProc(1, "proxy", { ws: wsMB, commit: commitMB })]);
    const v = osVerdict(rows, { procPeaks: { proxy: 250 } });
    return { exitCode: v.red ? 1 : 0, checks: v.checks, workingSet: v.workingSet };
  };
  const v = medianVerdict([winRep(260, 120), winRep(255, 118), winRep(240, 117), winRep(270, 121), winRep(230, 119)], rule5);
  assert.equal(v.medianMB, 255);
  assert.deepEqual([v.red, v.workingSet.red, v.workingSet.medianMB, v.redOnlyOnCommit], [true, false, 119, true]);
  const both = medianVerdict([winRep(260, 260), winRep(255, 255), winRep(240, 240), winRep(270, 270), winRep(230, 230)], rule5);
  assert.deepEqual([both.red, both.workingSet.red, both.redOnlyOnCommit], [true, true, false]);
  // Linux repetitions carry no working-set verdict.
  assert.equal(medianVerdict([rep(236), rep(231), rep(240), rep(219), rep(230)], rule5).workingSet, null);
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
