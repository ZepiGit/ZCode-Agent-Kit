// The expected-RED ratchet for the memory-budget job.
//
// tests/memory/expected-red.json lists, per OS leg, every run key the job
// expects to be RED today and the ticket that owns turning it GREEN:
//
//   { "linux": { "S1/burst16": "19", "S3/short": "37" } }
//
// A run key is `<scenario>/<variant>`, or `<scenario>/<profile>` for the run
// without a variant (the job runs the short profile, so `S2/short`).
//
// The job fails when (any of):
//   - a run is RED and not listed;
//   - a listed run is GREEN (delete the entry in the ticket that fixed it);
//   - a run is a harness failure (exit 2): never expected, never listed;
//   - an entry names an OS leg, scenario or variant the job does not run;
//   - an entry's ticket id has no `.scratch/kit-overhaul/issues/<NN>-*.md`;
//   - a listed run did not run at all;
//   - a listed repeated run (lib/budgets.mjs REPEATED) is RED on anything but
//     its median check: a ceiling breach or another RED check in any
//     repetition (Round 9 Q1 condition 1).
// So the list can only shrink, and a stale or mistyped entry cannot hide a
// RED run.
//
// One entry may instead be `{ "ticket": "20", "state": "unstable" }` (Round 9
// Q1): windows S1/burst1, whose WS-gated median sits on its 250 MB budget
// (p ≈ 0.54, 24 fresh runs). UNSTABLE below is the allow-list of exactly that
// key; any other key carrying the state is a schema error. An unstable run
// passes with its median ≤ 250 (GREEN) or ≤ maxMedianMB (RED on the median
// only) and prints "<key>: unstable (median <x> MB, budget <b>), owned by
// ticket <t>"; a median above maxMedianMB fails, and the listed-repeated rule
// above holds on top. The entry leaves only through ticket 20's ≥ 20-run
// criterion; ticket 55 removes this allow-list.

import { readdirSync, readFileSync } from "node:fs";
import { CATALOGUE, JOB, OS_LEGS, parseRunKey } from "./catalogue.mjs";
import { REPEATED } from "./budgets.mjs";
import { repetitionRule } from "./repetitions.mjs";

const OUTCOME = { 0: "GREEN", 1: "RED", 2: "HARNESS FAILURE" };

/** The one place the `unstable` state is allowed (Round 9 Q1 condition 3), with its median bound (condition 2). */
export const UNSTABLE = { windows: { "S1/burst1": { maxMedianMB: 300 } } };

/** An entry value → { ticket, state } ("red" for a plain ticket id), or { error }. */
function entryOf(value) {
  if (typeof value === "string" || typeof value === "number") return { ticket: value, state: "red" };
  const ok = value !== null && typeof value === "object" && !Array.isArray(value) && value.state === "unstable" && Object.keys(value).sort().join() === "state,ticket";
  return ok ? { ticket: value.ticket, state: "unstable" } : { ticket: null, state: null, error: `an entry is a ticket id or { "ticket", "state": "unstable" }, got ${JSON.stringify(value)}` };
}

/** Schema errors of the whole document (every OS leg), independent of any run. */
export function validateExpectedRed(expected, { job = JOB, issueIds, catalogue = CATALOGUE, unstable = UNSTABLE, repeated = REPEATED }) {
  const errors = [];
  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) return ["expected-red.json: top level must be an object keyed by OS leg"];
  for (const [os, entries] of Object.entries(expected)) {
    if (!OS_LEGS.includes(os)) { errors.push(`${os}: unknown OS leg (allowed: ${OS_LEGS.join(", ")})`); continue; }
    if (entries === null || typeof entries !== "object" || Array.isArray(entries)) { errors.push(`${os}: entries must be an object of run key → ticket id`); continue; }
    for (const [key, value] of Object.entries(entries)) {
      const parsed = parseRunKey(key, catalogue);
      if (parsed.error) errors.push(`${os} ${key}: ${parsed.error}`);
      else if (!(job[os] ?? []).includes(key)) errors.push(`${os} ${key}: not run by the ${os} job, so its state can never be checked`);
      const entry = entryOf(value);
      if (entry.error) { errors.push(`${os} ${key}: ${entry.error}`); continue; }
      if (entry.state === "unstable" && !(Object.hasOwn(unstable[os] ?? {}, key) && repetitionRule(key, repeated))) errors.push(`${os} ${key}: \`unstable\` is allowed for ${Object.entries(unstable).flatMap(([o, keys]) => Object.keys(keys).map((k) => `${o} ${k}`)).join(", ")} only (Round 9 Q1 condition 3)`);
      const ticket = entry.ticket;
      if (typeof ticket !== "string" || !/^\d{2}$/.test(ticket)) errors.push(`${os} ${key}: ticket id must be a two-digit string, got ${JSON.stringify(ticket)}`);
      else if (!issueIds.has(ticket)) errors.push(`${os} ${key}: ticket ${ticket} has no issue file (.scratch/kit-overhaul/issues/${ticket}-*.md)`);
    }
  }
  return errors;
}

/**
 * expected: the parsed expected-red.json; os: "linux" | "windows";
 * results: [{ key, exitCode, redChecks? }] for the runs of this job (0 GREEN, 1 RED, 2 harness failure;
 *   a repeated key's set also carries median: { medianMB, budgetMB, check });
 * job: { [os]: [run key, …] } the runs each leg performs;
 * issueIds: Set of ticket ids that have an issue file.
 * Returns { ok, failures: string[], rows: [{ key, outcome, ticket }] }.
 */
export function checkRatchet({ expected, os, results, job = JOB, issueIds, catalogue = CATALOGUE, repeated = REPEATED, unstable = UNSTABLE }) {
  const failures = validateExpectedRed(expected, { job, issueIds, catalogue, unstable, repeated });
  const listed = expected?.[os] && typeof expected[os] === "object" ? expected[os] : {};
  const byKey = new Map(results.map((r) => [r.key, r]));
  const rows = [];
  for (const key of new Set([...(job[os] ?? []), ...byKey.keys()])) {
    const entry = Object.hasOwn(listed, key) ? entryOf(listed[key]) : null;
    const ticket = entry ? entry.ticket : null;
    const isUnstable = entry?.state === "unstable" && Object.hasOwn(unstable[os] ?? {}, key);
    const result = byKey.get(key);
    if (!result) {
      rows.push({ key, outcome: "NOT RUN", ticket });
      failures.push(`${key}: did not run in the ${os} job${ticket ? ` (listed for ticket ${ticket})` : ""}`);
      continue;
    }
    const outcome = OUTCOME[result.exitCode] ?? `exit ${result.exitCode}`;
    const row = { key, outcome, ticket, ...(isUnstable ? { state: "unstable" } : {}) };
    rows.push(row);
    // A listed repeated key tolerates only its median check (Round 9 Q1
    // condition 1): a ceiling breach or any other RED check of any repetition
    // fails, so the listing cannot mask Round 6 Q1 condition 3.
    const rule = repetitionRule(key, repeated);
    if (rule && ticket !== null && outcome === "RED") {
      const median = `median:${rule.check}`;
      const other = (result.redChecks ?? []).filter((c) => c !== median);
      if (other.length || !(result.redChecks ?? []).includes(median)) { failures.push(`${key}: RED on ${other.join(", ") || "no median check"}: a listed repeated run accepts only ${median} (${os}, Round 9 Q1 condition 1)`); continue; }
    }
    if (isUnstable && (outcome === "RED" || outcome === "GREEN")) {
      // Round 9 Q1 condition 2: GREEN or RED on the median alone, within the bound.
      const { maxMedianMB } = unstable[os][key];
      const medianMB = result.median?.medianMB;
      if (typeof medianMB !== "number") failures.push(`${key}: unstable entry without a median value (${os})`);
      else if (medianMB > maxMedianMB) failures.push(`${key}: unstable median ${medianMB} MB is above the ${maxMedianMB} MB bound (${os}, Round 9 Q1 condition 2)`);
      else row.note = `${key}: unstable (median ${medianMB} MB, budget ${result.median.budgetMB}), owned by ticket ${ticket}`;
      continue;
    }
    if (rule && ticket !== null && outcome === "RED") continue;
    if (outcome === "RED" && ticket === null) failures.push(`${key}: RED but not listed in expected-red.json (${os})`);
    else if (outcome === "GREEN" && ticket !== null) failures.push(`${key}: GREEN but listed for ticket ${ticket}: delete the entry from expected-red.json (${os})`);
    else if (outcome !== "RED" && outcome !== "GREEN") failures.push(`${key}: ${outcome.toLowerCase()} (exit ${result.exitCode}); a harness failure is never expected`);
  }
  return { ok: failures.length === 0, failures, rows };
}

/** Ticket ids that have an issue file `<NN>-*.md` in the issues directory. */
export function issueIdsIn(dir) {
  const ids = new Set();
  for (const name of readdirSync(dir)) {
    const m = /^(\d{2})-.+\.md$/.exec(name);
    if (m) ids.add(m[1]);
  }
  return ids;
}

export function readExpectedRed(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
