// The memory loop's definition of RED, pinned with hand-built series.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict } from "./lib/verdict.mjs";

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
