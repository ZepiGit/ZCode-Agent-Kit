// S7's responses store at its cap, judged on the heap the store RETAINS.
// After the load and the scenario's
// 5 s wait, /health is read at least 30 times, 1 s apart; the check value is
// the MINIMUM heapUsedMB of that series minus the reading before the load
// (h0). Memory the store retains is in every reading, so a store over its
// bound is RED on the minimum as on any single reading, and the minimum is
// never above the first reading; garbage not yet collected is not. Transient
// heap stays bounded by S7's procPeak:proxy and commit-backstop:proxy checks.
// No product hook: plain /health readings, no GC trigger, no new endpoint.

export const RETAINED_HEAP = { readings: 30, intervalMs: 1000 };

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/**
 * Read `/health` details `readings` times, `intervalMs` apart (the first
 * reading at once). `health()` resolves to the /health JSON or null; each
 * entry is `{ heapUsedMB, rssMB }` as /health gave it, or null for no answer.
 */
export async function readHeapSeries(health, { readings = RETAINED_HEAP.readings, intervalMs = RETAINED_HEAP.intervalMs, sleep = sleepMs } = {}) {
  const series = [];
  for (let i = 0; i < readings; i++) {
    if (i > 0) await sleep(intervalMs);
    const d = (await health())?.details;
    series.push(d && typeof d === "object" ? { heapUsedMB: d.heapUsedMB, rssMB: d.rssMB } : null);
  }
  return series;
}

/**
 * The `responses-store:heap-at-cap` check from the reading before the load and
 * the series after it. An incomplete series is a harness failure (thrown),
 * never a verdict: fewer than `minReadings` readings, a reading without a
 * numeric heapUsedMB, or no numeric heapUsedMB before the load.
 */
export function storeHeapAtCap({ before, series, budgetMB, minReadings = RETAINED_HEAP.readings, intervalMs = RETAINED_HEAP.intervalMs }) {
  if (!isNum(before?.heapUsedMB)) throw new Error(`responses-store:heap-at-cap: no heapUsedMB before the load (${JSON.stringify(before ?? null)})`);
  if (!Array.isArray(series) || series.length < minReadings) throw new Error(`responses-store:heap-at-cap: ${Array.isArray(series) ? series.length : 0} readings, need ≥ ${minReadings}`);
  for (const [i, x] of series.entries()) {
    if (!isNum(x?.heapUsedMB)) throw new Error(`responses-store:heap-at-cap: reading ${i + 1} of ${series.length} has no numeric heapUsedMB (${JSON.stringify(x ?? null)})`);
  }
  const seriesMB = series.map((x) => x.heapUsedMB);
  const minMB = Math.min(...seriesMB);
  const h0MB = before.heapUsedMB;
  const value = minMB - h0MB;
  const rss = (x) => (isNum(x?.rssMB) ? x.rssMB : null);
  return {
    name: "responses-store:heap-at-cap",
    red: value > budgetMB,
    value,
    budget: budgetMB,
    unit: "MB",
    detail: {
      rule: "minimum of the /health heapUsedMB series after the load, minus h0 (Round 17 Q1)",
      readings: series.length, intervalMs, h0MB,
      firstMB: seriesMB[0], minMB, maxMB: Math.max(...seriesMB),
      firstReadingGrowthMB: seriesMB[0] - h0MB, // the value under the one-reading rule before Round 17
      rssBeforeMB: rss(before), rssAfterMB: rss(series[0]), rssLastMB: rss(series.at(-1)),
      seriesMB,
    },
  };
}

/** One line for logs and the job summary. */
export function heapAtCapLine(check) {
  const d = check.detail;
  return `responses-store:heap-at-cap: ${check.value} MB = min ${d.minMB} − h0 ${d.h0MB} over ${d.readings} readings ${d.intervalMs / 1000} s apart (first ${d.firstMB}, max ${d.maxMB}; rss ${d.rssBeforeMB ?? "—"} → ${d.rssAfterMB ?? "—"} … ${d.rssLastMB ?? "—"}) ${check.red ? "RED" : "ok"}`;
}
