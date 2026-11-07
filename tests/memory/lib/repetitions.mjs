// Runs judged on the median of n fresh repetitions (Round 6 Q1, ticket 60).
//
// A rule is { n, check, budgetMB, ceilingMB } (lib/budgets.mjs REPEATED, the
// one place n lives): the named check's value from each repetition's summary
// is judged as a median against budgetMB, and every single value must also
// stay ≤ ceilingMB. Every other check is judged in every repetition as usual.
import { REPEATED } from "./budgets.mjs";

/** The repetition rule of a run key, or null for a run judged on one run. */
export function repetitionRule(key, repeated = REPEATED) {
  return Object.hasOwn(repeated, key) ? repeated[key] : null;
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
  // Windows (Round 7 Q1): the value is the check's gated one (working set for
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
 * Runs `runOnce(i)` for i = 1 … rule.n, strictly one after another (each a
 * fresh, isolated run; never two at once), and judges the set with
 * medianVerdict. A harness failure ends the set: it decides the outcome.
 * Returns { reps, ...medianVerdict }.
 */
export async function runRepetitions(rule, runOnce) {
  const reps = [];
  for (let i = 1; i <= rule.n; i++) {
    const r = await runOnce(i);
    reps.push(r);
    if (r.exitCode !== 0 && r.exitCode !== 1) break;
  }
  return { reps, ...medianVerdict(reps, rule) };
}
