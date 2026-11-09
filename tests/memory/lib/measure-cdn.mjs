// The S2 CDN cache A/B (ticket 80, Owner Proxy round 31 Q1, stage 1).
// job.mjs --measure-cdn "N[ ABAB|BABA]" (CI: only while the test-loop marker
// tests/memory/measure-cdn exists; it never merges): N rotations of two arms,
// each a full, fresh S2/short run under the job's cap and timeout. The arms
// differ only in the cache phase D constructs inside the S2 body's own process
// (ZCODE_MEMLOOP_CDN_ARM, read by scenarios/s2-captcha-run.ts):
//   A "head"    the CaptchaCdnCache of the tree under test;
//   B "pre-29"  the verbatim pre-29 cache
//               zcode-proxy-src/src/__fixtures__/captcha-cdn-cache.7555b87.ts.
// Product code, fetches, bytes, prune decisions and the S2 workload are the
// same in both arms (B1): the switch only picks which class phase D builds.
// ABAB runs A first in every rotation, BABA runs B first. The order is the
// marker's ("N" means ABAB); an even re-run attempt (GITHUB_RUN_ATTEMPT)
// reverses it, so re-running one marker commit alternates ABAB and BABA.
//
// Per run: the cdn-cache:memory-growth value as the run judged it (commit on
// Windows, RSS on Linux; D-end minus D-start), its mode (low ≤ 54 MB, high
// > 54 MB), commit (Bun's memory footprint) and WS/RSS at D-start and D-end,
// the commit − WS gap of the growth, and whether the disk pruner's 60 s
// rescan ran in phase D. Per arm: the values, mean, sd and the mode counts;
// head − pre-29: the mean difference and Welch's t. The pre-registered rule
// (rule() below) is read for windows only and needs ≥ 30 valid runs per arm,
// which takes several jobs: cdn-ab-pool.mjs pools their JSON reports.
import { MEASURE_MAX_RUNS } from "./measure.mjs";

export const CDN_ARMS = ["head", "pre-29"];
export const CDN_ARM_ENV = "ZCODE_MEMLOOP_CDN_ARM";
export const CDN_MODE_SPLIT_MB = 54;
export const CDN_MIN_PER_ARM = 30;
// The pruner rescans after a write once its last scan is this old (captcha-cdn-disk.ts CDN_DISK_RESCAN_MS).
export const CDN_RESCAN_MS = 60_000;

const ORDERS = { ABAB: ["head", "pre-29"], BABA: ["pre-29", "head"] };
const OUTCOME = { 0: "GREEN", 1: "RED", 2: "HARNESS FAILURE" };

/** The marker's content: "N", "N ABAB" or "N BABA" → { count, order | null }, or throws. */
export function parseCdnSpec(text) {
  const m = String(text ?? "").trim().match(/^(\S+)(?:\s+(\S+))?$/);
  if (!m || (m[2] !== undefined && !ORDERS[m[2]])) throw new Error(`--measure-cdn needs "N", "N ABAB" or "N BABA" (got ${JSON.stringify(text ?? null)})`);
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NaN;
  if (!(n >= 1 && n <= MEASURE_MAX_RUNS)) throw new Error(`--measure-cdn needs a whole number of rotations from 1 to ${MEASURE_MAX_RUNS} (got ${JSON.stringify(text ?? null)})`);
  return { count: n, order: m[2] ?? null };
}

/** The order this job runs: the marker's (ABAB by default), reversed on an even re-run attempt. */
export function cdnOrder(markerOrder, attempt) {
  const given = markerOrder ?? "ABAB";
  return attempt % 2 === 0 ? (given === "ABAB" ? "BABA" : "ABAB") : given;
}

/** [{ rotation, arm }] in run order. */
export function cdnPlan(count, order) {
  const plan = [];
  for (let k = 1; k <= count; k++) for (const arm of ORDERS[order]) plan.push({ rotation: k, arm });
  return plan;
}

/**
 * Did the pruner's 60 s rescan run in phase D? The cache's start scan happens
 * inside its constructor ([c0, c1]); the last put, whose write ends with the
 * pruner's check, runs in [p0, p1] (all Date.now, the pruner's clock). "yes"
 * when even the earliest check is ≥ 60 s after the latest possible scan, "no"
 * when even the latest check is < 60 s after the earliest, else "unsure".
 */
export function rescanInPhaseD({ c0, c1, p0, p1 }) {
  if (p0 - c1 >= CDN_RESCAN_MS) return "yes";
  if (p1 - c0 < CDN_RESCAN_MS) return "no";
  return "unsure";
}

const round = (x, d) => (x === null || x === undefined || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** One A/B run from its job result and summary.json. */
export function cdnObservation({ run, rotation, arm, result, summary }) {
  const windows = summary?.platform === "win32" || summary?.metric === "commit";
  const check = summary?.checks?.find((c) => c.name === "cdn-cache:memory-growth") ?? null;
  const valueMB = num(check?.value);
  const marks = Array.isArray(summary?.notes?.marks) ? summary.notes.marks : [];
  const start = marks.find((m) => m.name === "D-start") ?? null;
  const end = marks.find((m) => m.name === "D-end") ?? null;
  const at = (m) => (m ? { footprintMB: num(m.footprintMB), rssMB: num(m.rssMB) } : null);
  const dStart = at(start);
  const dEnd = at(end);
  const diff = (k) => (dStart?.[k] !== null && dEnd?.[k] !== null && dStart && dEnd ? dEnd[k] - dStart[k] : null);
  const commitGrowthMB = diff("footprintMB");
  const wsGrowthMB = diff("rssMB");
  const armRan = start?.cdnArm ?? null;
  const problems = [];
  if (result?.exitCode !== 0 && result?.exitCode !== 1) problems.push(`harness failure: ${result?.error ?? `exit ${result?.exitCode}`}`);
  if (summary?.key && summary.key !== "S2/short") problems.push(`summary is for ${summary.key}, not S2/short`);
  if (valueMB === null) problems.push("no cdn-cache:memory-growth value");
  if (!start || !end) problems.push("no D-start / D-end marks");
  else if (armRan !== arm || end.cdnArm !== arm) problems.push(`phase D did not report its cache (given ${arm}): D-start says ${start.cdnArm ?? "nothing"}, D-end ${end.cdnArm ?? "nothing"}`);
  if (windows) {
    if (summary?.notes?.sampler?.units?.ok !== true) problems.push("units self-test did not pass");
    if (result?.jobApplied !== true) problems.push("Job Object not applied (no @@JOB applied=1)");
  }
  return {
    run, rotation, arm, armRan, outcome: OUTCOME[result?.exitCode] ?? "HARNESS FAILURE", metric: windows ? "commit" : "rss",
    valueMB, mode: valueMB === null ? null : valueMB <= CDN_MODE_SPLIT_MB ? "low" : "high",
    dStart, dEnd, commitGrowthMB, wsGrowthMB, gapMB: commitGrowthMB === null || wsGrowthMB === null ? null : commitGrowthMB - wsGrowthMB,
    rescan: end?.cdnPhaseD?.rescan ?? null, putSpanMs: num(end?.cdnPhaseD?.putSpanMs),
    durationS: result?.durationS ?? null, valid: problems.length === 0, problems,
  };
}

function stats(values) {
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : null;
  const variance = n > 1 ? values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1) : null;
  return { n, mean, variance };
}

/** head − pre-29 over two value lists: mean difference, Welch's t and its degrees of freedom. */
export function welch(head, pre) {
  const a = stats(head);
  const b = stats(pre);
  if (a.n < 2 || b.n < 2) return { meanMB: a.n && b.n ? round(a.mean - b.mean, 2) : null, welchT: null, df: null };
  const va = a.variance / a.n;
  const vb = b.variance / b.n;
  const se = Math.sqrt(va + vb);
  return { meanMB: round(a.mean - b.mean, 2), welchT: se > 0 ? round((a.mean - b.mean) / se, 2) : null, df: se > 0 ? round((va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1)), 2) : null };
}

/**
 * The pre-registered rule (round 31 Q1), windows commit values: attributed when
 * head − pre-29 ≥ 2.0 MB with Welch t ≥ 2.5; not attributed when < 1.0 MB or
 * t < 1.5; otherwise inconclusive. Needs ≥ 30 valid runs per arm.
 */
export function rule({ nHead, nPre, meanMB, welchT }) {
  if (nHead < CDN_MIN_PER_ARM || nPre < CDN_MIN_PER_ARM) return `insufficient: ${nHead} and ${nPre} valid runs (head, pre-29); the rule needs ≥ ${CDN_MIN_PER_ARM} per arm (pool the jobs with tests/memory/cdn-ab-pool.mjs)`;
  if (meanMB === null) return "inconclusive: no difference";
  if (meanMB >= 2.0 && welchT !== null && welchT >= 2.5) return "attributed";
  if (meanMB < 1.0 || (welchT !== null && welchT < 1.5)) return "not attributed";
  return "inconclusive";
}

function armOf(reps, arm) {
  const own = reps.filter((r) => r.arm === arm);
  const valid = own.filter((r) => r.valid);
  const values = valid.map((r) => r.valueMB);
  const s = stats(values);
  return {
    arm, runs: own.length, valid: valid.length, values, meanMB: round(s.mean, 2), sdMB: s.variance === null ? null : round(Math.sqrt(s.variance), 2),
    minMB: values.length ? Math.min(...values) : null, maxMB: values.length ? Math.max(...values) : null,
    low: valid.filter((r) => r.mode === "low").length, high: valid.filter((r) => r.mode === "high").length,
    rescanRuns: valid.filter((r) => r.rescan === "yes").length,
  };
}

/** The A/B over this set of runs (one job, or several pooled). */
export function cdnReport(reps, { os, requested = null, markerOrder = null, attempt = null, order = null, tree = null }) {
  const head = armOf(reps, "head");
  const pre = armOf(reps, "pre-29");
  const difference = welch(head.values, pre.values);
  const complete = requested === null ? reps.every((r) => r.valid) : reps.length === requested * CDN_ARMS.length && reps.every((r) => r.valid);
  return {
    key: "S2/short", os, check: "cdn-cache:memory-growth", metric: os === "windows" ? "commit" : "rss", requested, markerOrder, attempt, order, tree,
    rule: "ticket 80 stage 1 (Owner Proxy round 31 Q1): no verdict per job, no ratchet",
    complete, head, "pre-29": pre, difference,
    reading: os === "windows" ? rule({ nHead: head.valid, nPre: pre.valid, ...difference }) : null,
    reps,
  };
}

/** The A/B as Markdown (job summary, artefact, pooled reading). */
export function cdnMarkdown(m, { title = null } = {}) {
  const win = m.os === "windows";
  const v = (x) => (x === null || x === undefined ? "—" : x);
  const [fp, rs] = win ? ["commit", "WS"] : ["footprint", "RSS"];
  const lines = [
    title ?? `## S2 CDN cache A/B (${m.os}, ${m.requested} rotations, order ${m.order}${m.attempt ? `, attempt ${m.attempt}` : ""}${m.tree ? `, tree ${m.tree}` : ""})`, "",
    `Not a ratchet run (ticket 80 stage 1, Owner Proxy round 31 Q1): full S2/short runs whose phase D uses head's CaptchaCdnCache (head) or the verbatim pre-29 cache (pre-29), everything else identical. Value: cdn-cache:memory-growth as the run judged it (${win ? "commit" : "RSS"}, D-end − D-start). Mode: low ≤ ${CDN_MODE_SPLIT_MB} MB, high above.`, "",
    "| arm | valid | values (MB) | mean | sd | low / high | rescan in D |", "|---|---|---|---|---|---|---|",
  ];
  for (const a of [m.head, m["pre-29"]]) lines.push(`| ${a.arm} | ${a.valid} of ${a.runs} | ${a.values.join(", ") || "—"} | ${v(a.meanMB)} | ${v(a.sdMB)} | ${a.low} / ${a.high} | ${a.rescanRuns} |`);
  lines.push("", `head − pre-29: ${v(m.difference.meanMB)} MB, Welch t ${v(m.difference.welchT)} (df ${v(m.difference.df)}).`);
  lines.push(m.reading === null ? "The pre-registered rule judges the windows commit values; this leg is recorded only." : `Rule (windows commit; attributed ≥ 2.0 MB with t ≥ 2.5, not attributed < 1.0 MB or t < 1.5): ${m.reading}.`);
  lines.push("", `| run | rotation | arm | value (MB) | mode | D-start ${fp} / ${rs} | D-end ${fp} / ${rs} | growth ${fp} / ${rs} | gap | rescan | put span (ms) | valid |`, "|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of m.reps) lines.push(`| ${r.run} | ${r.rotation} | ${r.arm} | ${v(r.valueMB)} | ${v(r.mode)} | ${v(r.dStart?.footprintMB)} / ${v(r.dStart?.rssMB)} | ${v(r.dEnd?.footprintMB)} / ${v(r.dEnd?.rssMB)} | ${v(r.commitGrowthMB)} / ${v(r.wsGrowthMB)} | ${v(r.gapMB)} | ${v(r.rescan)} | ${v(r.putSpanMs)} | ${r.valid ? "yes" : `no: ${r.problems.join("; ")}`} |`);
  lines.push("", `- complete: ${m.complete ? "yes" : "NO — invalid or missing runs (they are left out of the arms)"}`);
  return lines.join("\n") + "\n";
}
