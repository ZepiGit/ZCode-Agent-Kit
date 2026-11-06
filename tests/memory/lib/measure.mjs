// The S1/burst1 measurement (Round 8 Q1 condition 2, ticket 60): N fresh,
// isolated S1/burst1 runs one after another (job.mjs --measure-burst1 N), each
// recorded with the value the median rule judges and the observations that
// prove it is real. It is a distribution, not a verdict: nothing here decides
// n or the windows list (Round 8 Q1 condition 3 does, from these numbers).
//
// Per run: the gate value (the procPeak:proxy check: RSS/VmHWM on Linux, on
// Windows the working-set gate max(sampled WS, PeakWorkingSetSize), Round 7
// Q1), the sampled peak and the between-samples peak read back from
// samples.csv (ws_peak_kb on Windows, hwm_kb = VmHWM on Linux), the commit
// peak (Windows), the proxy count, the units self-test and the Job Object.
// A run counts only if all of them hold (Round 6 Q2 condition 2, Round 8 Q1
// condition 1: a GREEN from a missing PeakWorkingSetSize is a harness failure).
import { parseSamplesCsv } from "./sampler.mjs";
import { medianFalseRedRate } from "./repetitions.mjs";

export const MEASURE_MAX_RUNS = 50;

/** "N" → N, or throws: a whole number of runs from 1 to MEASURE_MAX_RUNS. */
export function parseMeasureCount(text) {
  const n = /^\d+$/.test(String(text ?? "").trim()) ? Number(String(text).trim()) : NaN;
  if (!(n >= 1 && n <= MEASURE_MAX_RUNS)) throw new Error(`--measure-burst1 needs a whole number of runs from 1 to ${MEASURE_MAX_RUNS} (got ${JSON.stringify(text ?? null)})`);
  return n;
}

const mb1 = (kb) => Number((kb / 1024).toFixed(1));
const maxOf = (xs) => (xs.length ? Math.max(...xs) : null);
const OUTCOME = { 0: "GREEN", 1: "RED", 2: "HARNESS FAILURE" };

/**
 * One run's record. result: the job's result for the run (exitCode, error,
 * jobApplied?); summary: its summary.json (or null); csvText: its samples.csv
 * (or null); rule: { check, budgetMB, ceilingMB } (budgets.mjs REPEATED).
 */
export function measureObservation({ rep, result, summary, csvText, rule }) {
  const windows = summary?.platform === "win32" || summary?.metric === "commit";
  const check = summary?.checks?.find((c) => c.name === rule.check) ?? null;
  const gateMB = typeof check?.value === "number" ? check.value : null;
  const proxy = csvText ? parseSamplesCsv(csvText).filter((s) => s.role === "proxy") : [];
  const sampledKb = maxOf(proxy.map((s) => s.rssKb));
  const wsPeaks = proxy.map((s) => s.wsPeakKb).filter((v) => typeof v === "number");
  const wsPeakKb = windows ? maxOf(wsPeaks) : null;
  const peakKb = windows ? wsPeakKb : maxOf(proxy.map((s) => s.hwmKb));
  const sampledMB = sampledKb === null ? null : mb1(sampledKb);
  const peakMB = peakKb === null ? null : mb1(peakKb);
  const fromCsv = sampledMB === null ? null : Math.max(sampledMB, peakMB ?? 0);
  const gateConsistent = gateMB !== null && fromCsv !== null && Math.abs(gateMB - fromCsv) <= 0.1;
  const proxyCount = summary?.checks?.find((c) => c.name === "count:proxy")?.value ?? summary?.summary?.proxy?.maxCount ?? null;
  const unitsOk = windows ? summary?.notes?.sampler?.units?.ok === true : null;
  const jobApplied = typeof result?.jobApplied === "boolean" ? result.jobApplied : windows ? false : null;
  const problems = [];
  if (result?.exitCode !== 0 && result?.exitCode !== 1) problems.push(`harness failure: ${result?.error ?? `exit ${result?.exitCode}`}`);
  if (gateMB === null) problems.push(`no ${rule.check} value`);
  if (!proxy.length || !(proxyCount >= 1)) problems.push("no proxy sampled");
  if (windows) {
    if (!wsPeakKb) problems.push("ws_peak_kb missing or 0 (PeakWorkingSetSize not observed)");
    if (!unitsOk) problems.push("units self-test did not pass");
    if (!jobApplied) problems.push("Job Object not applied (no @@JOB applied=1)");
  }
  if (gateMB !== null && fromCsv !== null && !gateConsistent) problems.push(`gate ${gateMB} MB ≠ max(sampled ${sampledMB}, peak ${peakMB}) from samples.csv`);
  return {
    rep, outcome: OUTCOME[result?.exitCode] ?? "HARNESS FAILURE", gate: check?.gate ?? (summary?.metric === "rss" ? "rss" : null),
    gateMB, sampledMB, peakMB, wsPeakKb, commitMB: windows && typeof check?.commitValue === "number" ? check.commitValue : null,
    proxyCount, unitsOk, jobApplied, samples: summary?.samples ?? null, durationS: result?.durationS ?? null,
    redChecks: result?.redChecks ?? [], gateConsistent, valid: problems.length === 0, problems,
  };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
}

/** The distribution over the valid runs: exceedance count and fraction, ceiling breaches, P(median RED) per odd n ≤ 9. */
export function measureReport(reps, { key, os, requested, rule }) {
  const valid = reps.filter((r) => r.valid);
  const values = valid.map((r) => r.gateMB);
  const aboveBudget = values.filter((v) => v > rule.budgetMB).length;
  const p = valid.length ? Number((aboveBudget / valid.length).toFixed(4)) : null;
  const commits = valid.map((r) => r.commitMB).filter((v) => typeof v === "number");
  return {
    key, os, requested, rule: "measurement (Round 8 Q1 condition 2): no verdict, no ratchet", check: rule.check, budgetMB: rule.budgetMB, ceilingMB: rule.ceilingMB,
    gate: valid[0]?.gate ?? null, valid: valid.length, complete: valid.length === requested && reps.length === requested,
    aboveBudget, p, overCeiling: reps.filter((r) => typeof r.gateMB === "number" && r.gateMB > rule.ceilingMB).map((r) => r.rep),
    minMB: values.length ? Math.min(...values) : null, medianMB: median(values), maxMB: values.length ? Math.max(...values) : null,
    ...(commits.length ? { commitMedianMB: median(commits), commitMaxMB: Math.max(...commits) } : {}),
    medianRedProbability: p === null ? null : Object.fromEntries([3, 5, 7, 9].map((n) => [String(n), Number(medianFalseRedRate(p, n).toFixed(4))])),
    reps,
  };
}

/** The report as Markdown (job summary and artefact). */
export function measureMarkdown(m) {
  const win = m.os === "windows";
  const gate = win ? "WS gate = max(sampled WS, PeakWorkingSetSize)" : "RSS gate = max(sampled RSS, VmHWM)";
  const lines = [
    `## ${m.key} measurement (${m.os}, ${m.requested} fresh runs)`, "",
    `Not a ratchet run (Round 8 Q1 condition 2): ${m.requested} fresh, isolated runs one after another. Value: the ${m.check} ${gate}${win ? "; commit reported" : ""}. Budget ${m.budgetMB} MB (judged as a median in the job), ceiling ${m.ceilingMB} MB per run.`, "",
    win
      ? "| run | outcome | WS gate (MB) | sampled WS (MB) | ws_peak_kb | commit (MB) | proxy count | units self-test | Job Object | valid |"
      : "| run | outcome | RSS gate (MB) | sampled RSS (MB) | VmHWM (MB) | commit (MB) | proxy count | units self-test | Job Object | valid |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  const v = (x) => (x === null || x === undefined ? "—" : x);
  for (const r of m.reps) {
    lines.push(`| ${r.rep} | ${r.outcome} | ${v(r.gateMB)} | ${v(r.sampledMB)} | ${v(win ? r.wsPeakKb : r.peakMB)} | ${v(r.commitMB)} | ${v(r.proxyCount)} | ${r.unitsOk === null ? "—" : r.unitsOk ? "ok" : "FAILED"} | ${r.jobApplied === null ? "—" : r.jobApplied ? "applied" : "NOT applied"} | ${r.valid ? "yes" : `no: ${r.problems.join("; ")}`} |`);
  }
  lines.push("", `- valid runs: ${m.valid} of ${m.requested}${m.complete ? "" : " — INCOMPLETE: the distribution is not usable as it stands"}`);
  lines.push(`- above ${m.budgetMB} MB: ${m.aboveBudget} of ${m.valid} (p = ${v(m.p)})`);
  lines.push(`- over the ${m.ceilingMB} MB ceiling: ${m.overCeiling.length ? m.overCeiling.map((i) => `#${i}`).join(", ") : "none"}`);
  lines.push(`- min / median / max: ${v(m.minMB)} / ${v(m.medianMB)} / ${v(m.maxMB)} MB${m.commitMedianMB !== undefined ? `; commit median ${m.commitMedianMB}, max ${m.commitMaxMB} MB` : ""}`);
  if (m.medianRedProbability) lines.push(`- P(median of n above ${m.budgetMB}) at this p: ${Object.entries(m.medianRedProbability).map(([n, x]) => `n = ${n}: ${x}`).join(", ")}`);
  return lines.join("\n") + "\n";
}
