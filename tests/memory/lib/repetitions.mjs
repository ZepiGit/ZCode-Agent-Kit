// Runs judged on n fresh repetitions.
//
// Two rule kinds live in lib/budgets.mjs REPEATED, the one place n lives:
//   - the median rule { n, check, budgetMB, ceilingMB } (S1/burst1): the named
//     check's value from each repetition's summary is judged as a median
//     against budgetMB, and every single value must also stay ≤ ceilingMB;
//   - the majority rule { kind: "majority", n, redAtLeast, check, budget,
//     ceiling } (windows S1/short): the check is RED when at least redAtLeast
//     repetitions are RED on it under their own unchanged verdict, every
//     single value must stay ≤ ceiling, and the reported value is the median.
// Every other check is judged in every repetition as usual. A rule with
// `legs` applies on those OS legs only.
import { REPEATED } from "./budgets.mjs";

/** The repetition rule of a run key on an OS leg, or null for a run judged on one run. */
export function repetitionRule(key, repeated = REPEATED, os = null) {
  if (!Object.hasOwn(repeated, key)) return null;
  const rule = repeated[key];
  if (rule.legs && !rule.legs.includes(os)) return null;
  return rule;
}

/** The set-level name of the rule's own check: `median:<check>` (median rule) or `<check>` (majority rule). */
export function setCheckName(rule) {
  return rule.kind === "majority" ? rule.check : `median:${rule.check}`;
}

/**
 * Predicted false-RED rate of a median of n runs (n odd) when each run lands
 * above the budget with probability p: P(X ≥ (n + 1) / 2), X ~ Binomial(n, p).
 */
export function medianFalseRedRate(p, n) {
  let rate = 0;
  let choose = 1; // C(n, 0)
  for (let k = 0; k <= n; k++) {
    if (k > 0) choose = (choose * (n - k + 1)) / k;
    if (k >= (n + 1) / 2) rate += choose * p ** k * (1 - p) ** (n - k);
  }
  return rate;
}

/** The smallest odd n in {3, 5, 7, 9} whose false-RED rate is ≤ target, or null (rule not adopted). */
export function chooseRepetitions(p, { target = 0.05, candidates = [3, 5, 7, 9] } = {}) {
  return candidates.find((n) => medianFalseRedRate(p, n) <= target) ?? null;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * reps: [{ exitCode, checks: [{ name, red, value, gate?, commitValue?, wsValue? }], workingSetRedChecks?, error? }],
 * one per repetition, in order (Windows checks carry gate/commitValue/wsValue, lib/verdict.mjs osVerdict).
 * Returns { exitCode (0 GREEN, 1 RED, 2 harness failure), red, redChecks,
 * values, medianMB, budgetMB, ceilingMB, overCeiling (1-based repetitions), gate
 * ("ws"/"commit" on Windows, null on Linux), commitValues, commitMedianMB,
 * workingSetRedChecks, redOnlyOnCommit, error? }.
 * An incomplete set (a harness failure, fewer than n repetitions, a missing
 * value) is a harness failure: a median of fewer runs is not the rule.
 */
export function medianVerdict(reps, rule) {
  const base = { budgetMB: rule.budgetMB, ceilingMB: rule.ceilingMB };
  const harness = (error) => ({ exitCode: 2, red: false, redChecks: [], values: reps.map((r) => r.checks?.find((c) => c.name === rule.check)?.value ?? null), medianMB: null, overCeiling: [], ...base, error });
  for (const [i, r] of reps.entries()) {
    if (r.exitCode !== 0 && r.exitCode !== 1) return harness(`repetition ${i + 1}: ${r.error ?? `exit ${r.exitCode}`}`);
    if (typeof r.checks?.find((c) => c.name === rule.check)?.value !== "number") return harness(`repetition ${i + 1}: no ${rule.check} value`);
  }
  if (reps.length !== rule.n) return harness(`ran ${reps.length} of ${rule.n} repetitions`);
  const values = reps.map((r) => r.checks.find((c) => c.name === rule.check).value);
  const medianMB = median(values);
  // Repetition numbers (1-based) above the hard per-run ceiling.
  const overCeiling = values.flatMap((v, i) => (v > rule.ceilingMB ? [i + 1] : []));
  const redChecks = [];
  if (medianMB > rule.budgetMB) redChecks.push(`median:${rule.check}`);
  if (overCeiling.length) redChecks.push(`ceiling:${rule.check}`);
  // Every other check is judged in every repetition.
  for (const r of reps) for (const c of r.checks) if (c.red && c.name !== rule.check && !redChecks.includes(c.name)) redChecks.push(c.name);
  const red = redChecks.length > 0;
  // Windows: the value is the check's gated one (working set for
  // the proxy peak); commit rides along per repetition and is reported, never
  // judged. The all-WS view (the same rule over wsValue plus each repetition's
  // WS-RED checks) says whether the set is RED only on commit (build-time gate 3).
  const ofCheck = (r) => r.checks.find((c) => c.name === rule.check);
  const gate = ofCheck(reps[0]).gate ?? null;
  const commitValues = reps.every((r) => typeof ofCheck(r).commitValue === "number") ? reps.map((r) => ofCheck(r).commitValue) : null;
  let workingSetRedChecks = [];
  if (gate) {
    const wsValues = reps.map((r) => ofCheck(r).wsValue);
    if (median(wsValues) > rule.budgetMB) workingSetRedChecks.push(`median:${rule.check}`);
    if (wsValues.some((v) => v > rule.ceilingMB)) workingSetRedChecks.push(`ceiling:${rule.check}`);
    for (const r of reps) for (const name of r.workingSetRedChecks ?? []) if (name !== rule.check && !workingSetRedChecks.includes(name)) workingSetRedChecks.push(name);
  }
  return { exitCode: red ? 1 : 0, red, redChecks, values, medianMB, overCeiling, ...base, gate, commitValues, commitMedianMB: commitValues ? median(commitValues) : null, workingSetRedChecks, redOnlyOnCommit: gate ? red && workingSetRedChecks.length === 0 : false };
}

/**
 * The majority rule: reps as for medianVerdict. The rule's check
 * is RED when at least `redAtLeast` repetitions have it RED under their own
 * verdict (growth(): commit > budget AND trend, unchanged); every value must
 * stay ≤ `ceiling` whatever its trend; every other check is judged in every
 * repetition. The value judged is the check's gated one (commit on Windows).
 * Returns { exitCode, red, redChecks, values, trends, redRepetitions (1-based),
 * median, budget, redAtLeast, ceiling, overCeiling, gate, commitValues,
 * wsValues, workingSetRedChecks, redOnlyOnCommit, error? }.
 * An incomplete set is a harness failure, as for the median rule.
 */
export function majorityVerdict(reps, rule) {
  const base = { budget: rule.budget, redAtLeast: rule.redAtLeast, ceiling: rule.ceiling };
  const ofCheck = (r) => r.checks?.find((c) => c.name === rule.check);
  const harness = (error) => ({ exitCode: 2, red: false, redChecks: [], values: reps.map((r) => ofCheck(r)?.value ?? null), trends: reps.map((r) => ofCheck(r)?.trend ?? null), redRepetitions: [], median: null, overCeiling: [], ...base, error });
  for (const [i, r] of reps.entries()) {
    if (r.exitCode !== 0 && r.exitCode !== 1) return harness(`repetition ${i + 1}: ${r.error ?? `exit ${r.exitCode}`}`);
    const c = ofCheck(r);
    if (typeof c?.value !== "number" || !Number.isFinite(c.value) || c.detail?.insufficient === true) return harness(`repetition ${i + 1}: no ${rule.check} value${c?.detail?.insufficient ? ` (insufficient: ${c.detail.samples ?? 0} samples)` : ""}`);
  }
  if (reps.length !== rule.n) return harness(`ran ${reps.length} of ${rule.n} repetitions`);
  const checks = reps.map(ofCheck);
  const values = checks.map((c) => c.value);
  const trends = checks.map((c) => c.trend === true);
  const redRepetitions = checks.flatMap((c, i) => (c.red ? [i + 1] : []));
  // The ceiling is on commit (the check's commit value on Windows, its value elsewhere).
  const ceilingValue = (c) => (typeof c.commitValue === "number" ? c.commitValue : c.value);
  const overCeiling = checks.flatMap((c, i) => (ceilingValue(c) > rule.ceiling ? [i + 1] : []));
  const redChecks = [];
  if (redRepetitions.length >= rule.redAtLeast) redChecks.push(setCheckName(rule));
  if (overCeiling.length) redChecks.push(`ceiling:${rule.check}`);
  for (const r of reps) for (const c of r.checks) if (c.red && c.name !== rule.check && !redChecks.includes(c.name)) redChecks.push(c.name);
  const red = redChecks.length > 0;
  // Windows: the all-WS view (the same rule on each repetition's WS verdict) says
  // whether the set is RED only on commit (build-time gate 3); the ceiling is commit's.
  const gate = checks[0].gate ?? null;
  const commitValues = checks.every((c) => typeof c.commitValue === "number") ? checks.map((c) => c.commitValue) : null;
  const wsValues = checks.every((c) => typeof c.wsValue === "number") ? checks.map((c) => c.wsValue) : null;
  let workingSetRedChecks = [];
  if (gate) {
    if (reps.filter((r) => (r.workingSetRedChecks ?? []).includes(rule.check)).length >= rule.redAtLeast) workingSetRedChecks.push(setCheckName(rule));
    for (const r of reps) for (const name of r.workingSetRedChecks ?? []) if (name !== rule.check && !workingSetRedChecks.includes(name)) workingSetRedChecks.push(name);
  }
  return { exitCode: red ? 1 : 0, red, redChecks, values, trends, redRepetitions, median: median(values), overCeiling, ...base, gate, commitValues, wsValues, workingSetRedChecks, redOnlyOnCommit: gate ? red && workingSetRedChecks.length === 0 : false };
}

/**
 * The OMP no-op floor (budgets.mjs OMP_FLOOR): `values` are the
 * no-op costs (MB) of n fresh stub hosts. The median must be < medianBelowMB
 * and every value < everyBelowMB. Fewer than n values or a non-numeric one is
 * a harness failure (`error`), never a pass. Returns { ok, error, values,
 * medianMB, atOrAboveGate (1-based repetitions), failures }.
 */
export function floorVerdict(values, rule) {
  const out = (o) => ({ ok: false, error: null, values, medianMB: null, atOrAboveGate: [], failures: [], ...o });
  for (const [i, v] of values.entries()) if (typeof v !== "number" || !Number.isFinite(v)) return out({ error: `repetition ${i + 1}: no numeric no-op cost (${JSON.stringify(v)})` });
  if (values.length !== rule.n) return out({ error: `${values.length} of ${rule.n} repetitions measured` });
  const medianMB = median(values);
  const atOrAboveGate = values.flatMap((v, i) => (v >= rule.everyBelowMB ? [i + 1] : []));
  const failures = [];
  if (!(medianMB < rule.medianBelowMB)) failures.push(`median no-op cost ${medianMB} MB is not below ${rule.medianBelowMB} MB`);
  for (const i of atOrAboveGate) failures.push(`repetition ${i} charged ${values[i - 1]} MB, not below the ${rule.everyBelowMB} MB waiter gate`);
  return out({ ok: failures.length === 0, medianMB, atOrAboveGate, failures });
}

/**
 * The floor measurement's reading (Round 17 Q4 condition 1, Round 6 Q1
 * condition 2's method): p = the fraction of no-op costs at or above
 * thresholdMB (each would fail a single-sample test), the predicted false-fail
 * rate of the median clause per odd n (binomial), and n, the smallest odd n in
 * {3, 5, 7, 9} at ≤ target. `comesBack` lists what Round 17 Q4 sends back: a
 * measurement ≥ gateMB, or no n reaching the target.
 */
export function floorMeasurement(values, { thresholdMB, gateMB, target = 0.01, candidates = [3, 5, 7, 9] }) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  const atOrAbove = nums.filter((v) => v >= thresholdMB).length;
  const p = nums.length ? atOrAbove / nums.length : null;
  const falseFailRate = p === null ? null : Object.fromEntries(candidates.map((n) => [String(n), Number(medianFalseRedRate(p, n).toFixed(4))]));
  const n = p === null ? null : chooseRepetitions(p, { target, candidates });
  const atGate = nums.filter((v) => v >= gateMB).length;
  const comesBack = [];
  if (atGate) comesBack.push(`${atGate} measurement${atGate > 1 ? "s" : ""} ≥ ${gateMB} MB (Round 17 Q4 condition 1)`);
  if (p !== null && n === null) comesBack.push(`no n in ${candidates.join(", ")} reaches ≤ ${target * 100} % at p = ${Number(p.toFixed(4))} (Round 17 Q4 condition 1)`);
  return { count: nums.length, invalid: values.length - nums.length, atOrAbove, p: p === null ? null : Number(p.toFixed(4)), falseFailRate, n, minMB: nums.length ? Math.min(...nums) : null, medianMB: nums.length ? median(nums) : null, maxMB: nums.length ? Math.max(...nums) : null, comesBack };
}

/** The set verdict under its rule's kind. */
export function judgeRepetitions(reps, rule) {
  return rule.kind === "majority" ? majorityVerdict(reps, rule) : medianVerdict(reps, rule);
}

/**
 * Runs `runOnce(i)` for i = 1 … rule.n, strictly one after another (each a
 * fresh, isolated run; never two at once), and judges the set under its rule
 * (medianVerdict or majorityVerdict). A harness failure ends the set: it
 * decides the outcome. Returns { reps, ...verdict }.
 */
export async function runRepetitions(rule, runOnce) {
  const reps = [];
  for (let i = 1; i <= rule.n; i++) {
    const r = await runOnce(i);
    reps.push(r);
    if (r.exitCode !== 0 && r.exitCode !== 1) break;
  }
  return { reps, ...judgeRepetitions(reps, rule) };
}
