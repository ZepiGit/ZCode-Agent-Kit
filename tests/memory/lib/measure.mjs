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

/**
 * The marker's content (Round 10 Q1 condition 1): "N" (N runs on the job's
 * Bun) or "N bun=<x.y.z>,<x.y.z>[,…]" (the paired measurement: N runs per
 * arm, the arms interleaved in this order). → { count, arms | null }, or throws.
 */
export function parseMeasureSpec(text) {
  const raw = String(text ?? "").trim();
  const m = raw.match(/^(\S+)(?:\s+bun=(\S*))?$/);
  if (!m) throw new Error(`--measure-burst1 needs "N" or "N bun=<x.y.z>,<x.y.z>[,…]" (got ${JSON.stringify(text ?? null)})`);
  const count = parseMeasureCount(m[1]);
  if (m[2] === undefined) return { count, arms: null };
  const arms = m[2].split(",");
  if (arms.length < 2 || arms.some((v) => !/^\d+\.\d+\.\d+$/.test(v)) || new Set(arms).size !== arms.length) {
    throw new Error(`--measure-burst1: bun= needs two or more distinct x.y.z versions (got ${JSON.stringify(m[2])})`);
  }
  return { count, arms };
}

/** "--bun <v>=<path>[,<v>=<path>…]" → { [v]: path }, or throws. */
export function parseBunArms(text) {
  const out = {};
  for (const part of String(text ?? "").split(",")) {
    const m = part.match(/^(\d+\.\d+\.\d+)=(.+)$/);
    if (!m || out[m[1]]) throw new Error(`--bun needs <x.y.z>=<path>[,<x.y.z>=<path>…], each version once (got ${JSON.stringify(text ?? null)})`);
    out[m[1]] = m[2];
  }
  return out;
}

// ln C(n, k) for the hypergeometric terms (n ≤ a few hundred here).
function logChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/**
 * One-sided Fisher exact test: P(an arm with n1 valid runs has ≥ a runs above
 * the budget | a + c above among n1 + n2), i.e. the arm is more often above
 * the budget than the reference arm (c of n2). Round 10 Q1 condition 2(b)/(c).
 */
export function fisherOneSided(a, n1, c, n2) {
  const K = a + c, N = n1 + n2;
  const total = logChoose(N, K);
  let p = 0;
  for (let x = a; x <= Math.min(K, n1); x++) p += Math.exp(logChoose(n1, x) + logChoose(n2, K - x) - total);
  return Math.min(1, Number(p.toPrecision(12)));
}

// "Stable unlisted" (Round 6 Q1 condition 2, Round 8 condition 3, Round 11
// condition 4 (ii)): P(median of n RED) ≤ 5 % at the arm's p, where n is the
// job's own (budgets.mjs REPEATED; 7 since Round 11, i.e. at most 5 of 24).
export const STABLE_MAX_RATE = 0.05;
export const FISHER_ALPHA = 0.05;
export const PAIRED_RUNS = 24;
export const WINDOWS_MEDIAN_MAX_MB = 300;

export function stableUnlisted(arm, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`stableUnlisted needs the job's n (got ${n})`);
  return arm.valid > 0 && medianFalseRedRate(arm.aboveBudget / arm.valid, n) <= STABLE_MAX_RATE;
}

/** The largest count above the budget, of `runs`, that is still stable unlisted at n. */
export function stableMaxCount(runs, n) {
  let k = -1;
  while (k + 1 <= runs && medianFalseRedRate((k + 1) / runs, n) <= STABLE_MAX_RATE) k++;
  return k;
}

const fmtP = (p) => (p === null || p === undefined ? "—" : p < 0.0001 ? p.toExponential(2) : String(Number(p.toFixed(4))));

/**
 * Round 11 Q1 condition 4, the re-entry rule for a newer Bun (ticket 62),
 * on one leg. arms[0] is the reference: the pinned Bun, listed first in the
 * marker. Each later arm is a candidate. A candidate passes on this leg when:
 *   (i)   every run of its arm and of the reference arm is valid and ≤ the ceiling;
 *   (ii)  Linux: its arm is stable unlisted at the job's current n;
 *   (iii) Linux: one-sided Fisher against the reference arm gives p > 0.05;
 *   (iv)  Windows: its median is ≤ 300 MB (no run above the ceiling is (i)).
 * Mechanical and per leg. It never pins: V needs both legs, and (ii) also on
 * the candidate's pooled CI history when that is less favourable, which only
 * the triage can see. n is never raised to admit a candidate.
 */
export function reentryReading(arms, { os, n, jobBun = null }) {
  const [ref, ...candidates] = arms;
  const notes = [];
  if (!ref || !candidates.length) return { reference: ref?.bun ?? null, n, candidates: [], notes: ["no reading: the paired mode needs a reference arm and at least one candidate"] };
  if (arms.some((a) => a.requested !== PAIRED_RUNS)) notes.push(`not a re-entry run: the rule is fixed for ${PAIRED_RUNS} valid runs per arm (this run: ${arms.map((a) => `${a.bun} ${a.requested}`).join(", ")})`);
  const jobVersion = jobBun ? jobBun.split("+")[0] : null;
  if (jobVersion !== ref.bun) notes.push(`the reference arm ${ref.bun} is not the job's own Bun (${jobBun ?? "unknown"}): list the pinned Bun first in the marker`);
  const clean = (a) => a.valid === a.requested && !a.overCeiling.length;
  const out = candidates.map((c) => {
    const fisherP = fisherOneSided(c.aboveBudget, c.valid, ref.aboveBudget, ref.valid);
    const checks = {
      i: { pass: clean(c) && clean(ref), detail: [c, ref].filter((a) => !clean(a)).map((a) => `${a.bun}: ${a.requested - a.valid} invalid, over the ceiling ${a.overCeiling.map((i) => `#${i}`).join(", ") || "none"}`).join("; ") || "all runs valid and within the ceiling" },
    };
    if (os === "windows") {
      checks.iv = { pass: c.medianMB !== null && c.medianMB <= WINDOWS_MEDIAN_MAX_MB, detail: `median ${c.medianMB ?? "—"} MB (≤ ${WINDOWS_MEDIAN_MAX_MB})` };
    } else {
      checks.ii = { pass: stableUnlisted(c, n), detail: `${c.aboveBudget} of ${c.valid} above the budget (stable at n = ${n}: ≤ ${stableMaxCount(c.valid || PAIRED_RUNS, n)} of ${c.valid || PAIRED_RUNS}); also check the pooled CI history` };
      checks.iii = { pass: fisherP > FISHER_ALPHA, detail: `one-sided Fisher vs ${ref.bun}: p = ${fmtP(fisherP)} (needs > ${FISHER_ALPHA})` };
    }
    return { bun: c.bun, fisherP, checks, pass: Object.values(checks).every((x) => x.pass) };
  });
  return { reference: ref.bun, n, candidates: out, notes };
}

const mb1 = (kb) => Number((kb / 1024).toFixed(1));
const maxOf = (xs) => (xs.length ? Math.max(...xs) : null);
const OUTCOME = { 0: "GREEN", 1: "RED", 2: "HARNESS FAILURE" };

/**
 * One run's record. result: the job's result for the run (exitCode, error,
 * jobApplied?); summary: its summary.json (or null); csvText: its samples.csv
 * (or null); rule: { check, budgetMB, ceilingMB } (budgets.mjs REPEATED).
 */
export function measureObservation({ rep, result, summary, csvText, rule, arm = null, bunPath = null }) {
  const obs = baseObservation({ rep, result, summary, csvText, rule });
  // The Bun the proxy actually ran (run.mjs: the live proxy pid's executable,
  // asked for its --revision) and the runtime environment (lib/runtime-probe.mjs).
  const revisions = [...new Set((summary?.notes?.bunRuntime?.proxies ?? []).map((p) => p.revision).filter(Boolean))];
  const out = { ...obs, ...(arm ? { bun: arm, bunPath } : {}), bunRuntime: revisions.length ? revisions.join(" / ") : null, env: summary?.notes?.runtimeEnv ?? null };
  if (arm) {
    // Paired mode (Round 10 Q1 condition 1): a run counts for its arm only if its proxy ran that arm's Bun.
    if (!revisions.length) out.problems = [...out.problems, "no runtime Bun version recorded for the proxy"];
    for (const r of revisions) if (r.split("+")[0] !== arm) out.problems = [...out.problems, `proxy ran Bun ${r}, not the ${arm} arm`];
    out.valid = out.problems.length === 0;
  }
  return out;
}

function baseObservation({ rep, result, summary, csvText, rule }) {
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
  return s.length ? (s.length % 2 ? s[m] : Number(((s[m - 1] + s[m]) / 2).toFixed(1))) : null;
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

/**
 * The paired measurement (Round 10 Q1 condition 1; ticket 62's re-entry
 * tool): one measureReport per arm over its own runs, the arms' runtime
 * environments, the Fisher tests against the first arm (the reference, the
 * pinned Bun) and the per-leg re-entry reading of Round 11 Q1 condition 4 at
 * the job's n. jobBun: the job's own Bun revision (checked against arm 1).
 */
export function pairedReport(reps, { key, os, arms, perArm, rule, jobBun = null }) {
  const armReports = arms.map((bun) => {
    const own = reps.filter((r) => r.bun === bun);
    const m = measureReport(own, { key, os, requested: perArm, rule });
    const envs = [...new Map(own.filter((r) => r.env).map((r) => [JSON.stringify(stableEnv(r.env)), r.env])).values()];
    return { bun, requested: m.requested, valid: m.valid, complete: m.complete, aboveBudget: m.aboveBudget, p: m.p, stable: stableUnlisted(m, rule.n), overCeiling: m.overCeiling, minMB: m.minMB, medianMB: m.medianMB, maxMB: m.maxMB, ...(m.commitMedianMB !== undefined ? { commitMedianMB: m.commitMedianMB, commitMaxMB: m.commitMaxMB } : {}), medianRedProbability: m.medianRedProbability, bunRuntime: [...new Set(own.map((r) => r.bunRuntime).filter(Boolean))], env: envs[0] ?? null, envVariants: envs.length };
  });
  const ref = armReports[0];
  const fisherVsFirst = Object.fromEntries(armReports.slice(1).map((a) => [a.bun, fisherOneSided(a.aboveBudget, a.valid, ref.aboveBudget, ref.valid)]));
  return {
    mode: "paired", key, os, rotation: arms, perArm, requested: perArm * arms.length, n: rule.n, jobBun,
    rule: "paired measurement (Round 10 Q1 condition 1; re-entry rule Round 11 Q1 condition 4): no verdict, no ratchet, no pin", check: rule.check, budgetMB: rule.budgetMB, ceilingMB: rule.ceilingMB,
    complete: armReports.every((a) => a.complete), arms: armReports, fisherVsFirst, reading: reentryReading(armReports, { os, n: rule.n, jobBun }), reps,
  };
}

// The env fields that should not differ between runs of one arm (free memory
// and the per-run scope's cgroup path do).
function stableEnv(env) {
  const { bun = {}, cgroup = {}, ...rest } = env;
  const { availableMemory, freemem, ...b } = bun;
  const { v2Path, ...c } = cgroup ?? {};
  return { ...rest, cgroup: c, bun: b };
}

/** The paired report as Markdown (job summary and artefact): the decision reads straight off it. */
export function pairedMarkdown(m) {
  const win = m.os === "windows";
  const v = (x) => (x === null || x === undefined ? "—" : x);
  const lines = [
    `## ${m.key} paired Bun measurement (${m.os}, ${m.perArm} runs per arm, rotation ${m.rotation.join(" → ")})`, "",
    `Not a ratchet run (Round 10 Q1 condition 1): ${m.requested} fresh, isolated runs, the arms interleaved in rotation, each on its arm's Bun (the proxy's runtime version is checked per run). Reference arm: ${m.rotation[0]} (the job's own Bun: ${v(m.jobBun)}). Value: the ${m.check} ${win ? "WS gate = max(sampled WS, PeakWorkingSetSize); commit reported" : "RSS gate = max(sampled RSS, VmHWM)"}. Budget ${m.budgetMB} MB, ceiling ${m.ceilingMB} MB per run. Nothing here changes a pin.`, "",
    `| arm | valid | above ${m.budgetMB} MB | stable unlisted (P(median of ${m.n} RED) ≤ ${STABLE_MAX_RATE}; ≤ ${stableMaxCount(m.perArm, m.n)} of ${m.perArm}) | over ${m.ceilingMB} MB | min / median / max (MB) | ${win ? "commit median / max (MB)" : "p"} | proxy's runtime Bun |`,
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const a of m.arms) {
    lines.push(`| ${a.bun} | ${a.valid} of ${a.requested} | ${a.aboveBudget} | ${a.stable ? "pass" : "FAIL"} | ${a.overCeiling.length ? a.overCeiling.map((i) => `#${i}`).join(", ") : "none"} | ${v(a.minMB)} / ${v(a.medianMB)} / ${v(a.maxMB)} | ${win ? `${v(a.commitMedianMB)} / ${v(a.commitMaxMB)}` : v(a.p)} | ${a.bunRuntime.join(", ") || "—"} |`);
  }
  lines.push("");
  for (const [bun, p] of Object.entries(m.fisherVsFirst)) lines.push(`- Fisher one-sided p, ${bun} vs ${m.rotation[0]}: ${fmtP(p)} (${p <= FISHER_ALPHA ? "≤" : ">"} ${FISHER_ALPHA})`);
  const r = m.reading;
  lines.push("", `**Re-entry reading (Round 11 Q1 condition 4, ${m.os} leg, mechanical; reference ${r.reference}, n = ${r.n}):**`, "");
  const names = win ? { i: "(i) valid, ≤ ceiling", iv: `(iv) median ≤ ${WINDOWS_MEDIAN_MAX_MB} MB` } : { i: "(i) valid, ≤ ceiling", ii: `(ii) stable at n = ${r.n}`, iii: "(iii) Fisher p > 0.05" };
  lines.push(`| candidate | ${Object.values(names).join(" | ")} | this leg |`, `|---|${Object.keys(names).map(() => "---|").join("")}---|`);
  for (const c of r.candidates) lines.push(`| ${c.bun} | ${Object.keys(names).map((k) => `${c.checks[k].pass ? "pass" : "FAIL"}: ${c.checks[k].detail}`).join(" | ")} | ${c.pass ? "**passes**" : "**fails**"} |`);
  lines.push("", `A candidate becomes V only if it passes on both legs and (ii) also holds on its pooled CI history when that is less favourable (the triage, ticket 62); n is never raised to admit a candidate.`);
  for (const note of r.notes) lines.push("", `Caution: ${note}.`);
  lines.push("", "Runtime environment per arm (inside the run's cap scope):", "", "| arm | Bun (probe) | constrainedMemory | availableMemory | hardwareConcurrency | availableParallelism | nproc | CPU model | cgroup | scope MemoryMax | cap requested | variants |", "|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const a of m.arms) {
    const e = a.env ?? {};
    const b = e.bun ?? {};
    lines.push(`| ${a.bun} | ${b.version ? `${b.version}+${String(b.revision ?? "").slice(0, 9)}` : v(b.revision ?? b.error)} | ${v(b.constrainedMemory)} | ${v(b.availableMemory)} | ${v(b.hardwareConcurrency)} | ${v(b.availableParallelism)} | ${v(e.nproc)} | ${v(b.cpuModel ?? e.cpuModel)} | ${v(e.cgroup?.type)} | ${v(e.cgroup?.memoryMax ?? e.jobObjectLimit)}${e.cgroup?.v1MemoryLimit ? ` (v1 memory.limit_in_bytes ${e.cgroup.v1MemoryLimit})` : ""} | ${v(e.capRequested)} | ${a.envVariants} |`);
  }
  lines.push("", `| run | arm | proxy's runtime Bun | outcome | ${win ? "WS gate" : "RSS gate"} (MB) | sampled (MB) | ${win ? "ws_peak_kb" : "VmHWM (MB)"} | commit (MB) | valid |`, "|---|---|---|---|---|---|---|---|---|");
  for (const r of m.reps) lines.push(`| ${r.rep} | ${r.bun} | ${v(r.bunRuntime)} | ${r.outcome} | ${v(r.gateMB)} | ${v(r.sampledMB)} | ${v(win ? r.wsPeakKb : r.peakMB)} | ${v(r.commitMB)} | ${r.valid ? "yes" : `no: ${r.problems.join("; ")}`} |`);
  lines.push("", `- complete: ${m.complete ? "yes" : "NO — an arm has invalid runs; re-entry check (i) fails"}`);
  return lines.join("\n") + "\n";
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
