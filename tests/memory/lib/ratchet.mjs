// The expected-RED ratchet for the memory-budget job.
//
// tests/memory/expected-red.json lists, per OS leg, every run key the job
// expects to be RED today. A single run maps each owner ticket to the checks it
// owns, one owner per check, and marks the checks that flip (Round 14 Q1,
// Round 15 Q1):
//
//   { "linux": { "S3/omp": { "owners": { "35": ["omp:concurrent-preflights"],
//                                        "37": ["procPeak:proxy"] },
//                            "flips": ["procPeak:proxy"] } } }
//
// A run key is `<scenario>/<variant>`, or `<scenario>/<profile>` for the run
// without a variant (the job runs the short profile, so `S2/short`). A
// repeated key (lib/budgets.mjs REPEATED) is listed with its ticket id alone;
// `owners` and `flips` are schema errors there and on either `unstable` key
// below. For a single run these are schema errors too: a plain ticket id, an
// empty owners map, an owner with an empty list, a duplicate or non-string
// name, a name under two owners, an owner id without an issue file, a `flips`
// name no owner lists.
//
// A listed single run passes while it is RED only on owned checks (an owned
// check may be GREEN) and prints "<key>: RED on <checks>, owned by ticket <t>
// (<names>), ticket <u> (<names>)". It passes GREEN only while one of its
// names is marked `flips`, and prints "<key>: GREEN, listed for ticket(s)
// <t…> on flipping checks <names> (Round 15 Q1)". A name is marked only by
// ticket 67 from its ≥ 10-run evidence (RED in fewer than all matching runs).
// The list only shrinks, per owner: only the owner's own commit removes its
// names, with evidence (a flipping name needs ≥ 10 GREEN matching CI runs of
// that leg); the commit that removes an entry's last name deletes the entry;
// no run, job or other ticket edits another owner's names (Round 14 Q1
// condition 4, Round 15 Q1 condition 5).
//
// The job fails when (any of):
//   - a listed single run is RED on a check none of its owners owns (that RED
//     comes back as an ownership question), RED with no RED check named, or
//     an owner owns a check the run does not produce (stale or mistyped, also
//     on a GREEN pass through `flips`);
//   - a run is RED and not listed;
//   - a listed run is GREEN with no name marked `flips`;
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
// An entry may instead be `{ "ticket": "<NN>", "state": "unstable" }`, only for
// a key in UNSTABLE below (any other key carrying the state is a schema
// error). Each key there has its own bound kind, and the kind must fit the key:
//   - { maxMedianMB } (a repeated key; Round 9 Q1): windows S1/burst1, whose
//     WS-gated median sits on its 250 MB budget (p ≈ 0.54, 24 fresh runs). It
//     passes with its median ≤ 250 (GREEN) or ≤ maxMedianMB (RED on the median
//     only) and prints "<key>: unstable (median <x> MB, budget <b>), owned by
//     ticket <t>"; a median above maxMedianMB fails, and the listed-repeated
//     rule above holds on top. It leaves only through ticket 20's ≥ 20-run
//     criterion.
//   - { growthBand: { check, budget, max } } (a single run; Round 13 Q1):
//     windows S5/short, whose growth:mcp-bridge is over its 5 %/1k budget in
//     28 of 28 runs and RED only when the trend flag fires (1 of 28). It is
//     judged on the check's commit value, not on RED/GREEN: budget < value ≤
//     max passes with either trend flag and prints "<key>: unstable (<check>
//     <x> %/1k commit, budget <b>, bound <max>, trend <t>), owned by ticket
//     <t>"; above max fails (a step change); ≤ budget fails as "at budget but
//     listed" (an entry is RED until its owner's fix); any other RED check
//     fails; no commit value (insufficient samples, no check) is a measurement
//     gap and fails. It leaves only through ticket 74's ≥ 10-run criterion
//     (re-owned from ticket 30 by Round 24 Q1).
// Ticket 55 removes this allow-list.

import { readdirSync, readFileSync } from "node:fs";
import { CATALOGUE, JOB, OS_LEGS, parseRunKey } from "./catalogue.mjs";
import { MEMORY, REPEATED } from "./budgets.mjs";
import { repetitionRule, setCheckName } from "./repetitions.mjs";

const OUTCOME = { 0: "GREEN", 1: "RED", 2: "HARNESS FAILURE" };

/**
 * The one place the `unstable` state is allowed (Round 9 Q1 condition 3, Round
 * 13 Q1 condition 3), each key with its own bound: S1/burst1 a median bound
 * (Round 9 Q1 condition 2), S5/short a growth-value band on commit whose floor
 * is the growth budget and whose 30 %/1k ceiling is a regression bound, not a
 * budget (Round 13 Q1 condition 2).
 */
export const UNSTABLE = {
  windows: {
    "S1/burst1": { maxMedianMB: 300 },
    "S5/short": { growthBand: { check: "growth:mcp-bridge", budget: MEMORY.growth.maxPctPer1k, max: 30 } },
  },
};

const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/** Why an allow-list bound does not fit its key (Round 13 Q1 condition 3), or null. */
function boundKindError(key, bound, repeated, os) {
  const kinds = bound && typeof bound === "object" ? Object.keys(bound).sort().join() : "";
  const isRepeated = !!repetitionRule(key, repeated, os);
  const band = bound?.growthBand;
  const okMedian = isRepeated && kinds === "maxMedianMB" && isNum(bound.maxMedianMB);
  const okBand = !isRepeated && kinds === "growthBand" && band && typeof band === "object" && Object.keys(band).sort().join() === "budget,check,max"
    && typeof band.check === "string" && band.check.startsWith("growth:") && isNum(band.budget) && isNum(band.max) && band.max > band.budget;
  if (okMedian || okBand) return null;
  return `the \`unstable\` allow-list gives it ${JSON.stringify(bound)}${isRepeated ? " (a repeated key)" : " (a single run)"}; a repeated key takes { maxMedianMB }, a single run { growthBand: { check, budget, max } } (Round 13 Q1 condition 3)`;
}

const SHAPES = `an entry is a ticket id or { "ticket", "state": "unstable" } or { "owners": { "<NN>": ["<check>", …] }, "flips": ["<check>", …] }`;
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** "ticket 37" or "tickets 16, 37". */
export function ticketsLabel(ids) {
  return `${ids.length > 1 ? "tickets" : "ticket"} ${ids.join(", ")}`;
}

/**
 * An entry value → { ticket, state, … }, or { error }: "red" for a plain ticket
 * id (a repeated key), "unstable", or "owned" (Round 15 Q1 condition 1) with
 * `ids` (owner tickets, ascending), `owners` (id → its valid check names, for
 * judging), `flips` (null when absent) and `shapeErrors` (what is malformed).
 * `extrasWithState` is an `owners` or `flips` next to `state: "unstable"`.
 */
function entryOf(value) {
  if (typeof value === "string" || typeof value === "number") return { ticket: value, state: "red" };
  const fields = isPlainObject(value) ? Object.keys(value).sort().join() : "";
  if (isPlainObject(value) && value.state === "unstable" && fields === "state,ticket") return { ticket: value.ticket, state: "unstable" };
  if (isPlainObject(value) && value.state === "unstable" && ["flips,state,ticket", "owners,state,ticket", "flips,owners,state,ticket"].includes(fields)) return { ticket: value.ticket, state: "unstable", extrasWithState: true };
  if (fields === "owners" || fields === "flips,owners") return ownedEntry(value);
  return { ticket: null, state: null, error: `${SHAPES}, got ${JSON.stringify(value)}` };
}

/** Why a list is not a non-empty list of distinct check names, or null. */
function namesError(list, what, emptyHint) {
  if (!Array.isArray(list)) return `${what} must be a list of check names, got ${JSON.stringify(list)}`;
  if (list.length === 0) return `${what} must name at least one ${emptyHint}`;
  const bad = list.find((c) => typeof c !== "string" || c === "");
  if (bad !== undefined) return `${what} holds check names (non-empty strings), got ${JSON.stringify(bad)} (Round 14 Q1 condition 1)`;
  const twice = list.find((c, i) => list.indexOf(c) !== i);
  if (twice !== undefined) return `${what} names ${twice} twice (Round 14 Q1 condition 1)`;
  return null;
}

/** The owners shape (Round 15 Q1 condition 1): one owner per check, flips only on owned names. */
function ownedEntry(value) {
  const shapeErrors = [];
  const owners = {};
  if (!isPlainObject(value.owners)) shapeErrors.push(`\`owners\` must map owner tickets to check names, got ${JSON.stringify(value.owners)}`);
  else if (Object.keys(value.owners).length === 0) shapeErrors.push("`owners` must map at least one owner ticket to its checks (Round 15 Q1 condition 1)");
  const ids = isPlainObject(value.owners) ? Object.keys(value.owners).sort((x, y) => Number(x) - Number(y) || x.localeCompare(y)) : [];
  const ownerOf = new Map();
  for (const id of ids) {
    const list = value.owners[id];
    const err = namesError(list, `owner ${id}`, "check (Round 14 Q1 condition 1, Round 15 Q1 condition 1)");
    if (err) shapeErrors.push(err);
    owners[id] = Array.isArray(list) ? list.filter((c) => typeof c === "string" && c !== "") : [];
    for (const c of new Set(owners[id])) {
      if (ownerOf.has(c)) shapeErrors.push(`${c} is listed under tickets ${ownerOf.get(c)} and ${id}: one owner per check (Round 15 Q1 condition 1)`);
      else ownerOf.set(c, id);
    }
  }
  let flips = null;
  if (Object.hasOwn(value, "flips")) {
    const err = namesError(value.flips, "`flips`", "owned check; leave it out when nothing flips (Round 15 Q1 condition 4)");
    if (err) shapeErrors.push(err);
    flips = Array.isArray(value.flips) ? value.flips.filter((c) => typeof c === "string" && c !== "") : [];
    for (const c of new Set(flips)) if (!ownerOf.has(c)) shapeErrors.push(`\`flips\` names ${c}, which no owner of this entry lists (Round 15 Q1 condition 1)`);
    flips = flips.filter((c) => ownerOf.has(c));
    if (flips.length === 0) flips = null;
  }
  return { ticket: ids.join(", ") || null, state: "owned", ids, owners, ownerOf, flips, shapeErrors };
}

/** Why an entry's kind does not fit its key (Round 14 Q1 condition 1, Round 15 Q1 condition 1): a list of errors. */
function kindErrors(os, key, entry, { repeated, unstable }) {
  const isRepeated = !!repetitionRule(key, repeated, os);
  const isUnstableKey = Object.hasOwn(unstable[os] ?? {}, key);
  const hasOwners = entry.state === "owned" || entry.extrasWithState;
  if (hasOwners && isRepeated) return ["`owners` and `flips` are not allowed on a repeated key: it keeps its median rule (Round 9 Q1 condition 1, Round 15 Q1 condition 1)"];
  if (hasOwners && isUnstableKey) return ["`owners` and `flips` are not allowed on an `unstable` key: it keeps its own bound (Round 9 Q1, Round 13 Q1, Round 15 Q1 condition 1)"];
  if (entry.extrasWithState) return [SHAPES];
  if (entry.state === "owned") return entry.shapeErrors;
  if (entry.state === "red" && !isRepeated) return [`a listed single-run key maps owner ticket → check names: { "owners": { "<NN>": ["<check>", …] }, "flips": ["<check>", …] } (Round 14 Q1 condition 1, Round 15 Q1 condition 1)`];
  return [];
}

/** Why a ticket id cannot name an owner, or null (Round 3 Q8 condition 2). */
function ticketIdError(ticket, issueIds) {
  if (typeof ticket !== "string" || !/^\d{2}$/.test(ticket)) return `ticket id must be a two-digit string, got ${JSON.stringify(ticket)}`;
  if (!issueIds.has(ticket)) return `ticket ${ticket} has no issue file (.scratch/kit-overhaul/issues/${ticket}-*.md)`;
  return null;
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
      if (!parsed.error) for (const e of kindErrors(os, key, entry, { repeated, unstable })) errors.push(`${os} ${key}: ${e}`);
      if (entry.state === "unstable" && !entry.extrasWithState) {
        if (!Object.hasOwn(unstable[os] ?? {}, key)) errors.push(`${os} ${key}: \`unstable\` is allowed for ${Object.entries(unstable).flatMap(([o, keys]) => Object.keys(keys).map((k) => `${o} ${k}`)).join(", ")} only (Round 9 Q1 condition 3, Round 13 Q1 condition 3)`);
        else {
          const kindError = boundKindError(key, unstable[os][key], repeated, os);
          if (kindError) errors.push(`${os} ${key}: ${kindError}`);
        }
      }
      for (const ticket of entry.state === "owned" ? entry.ids : [entry.ticket]) {
        const e = ticketIdError(ticket, issueIds);
        if (e) errors.push(`${os} ${key}: ${e}`);
      }
    }
  }
  return errors;
}

/**
 * expected: the parsed expected-red.json; os: "linux" | "windows";
 * results: [{ key, exitCode, redChecks? }] for the runs of this job (0 GREEN, 1 RED, 2 harness failure;
 *   a repeated key's set also carries median: { medianMB, budgetMB, check }; a single run carries
 *   growthChecks: [{ name, commitValue, gate, trend, insufficient, samples, … }]);
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
    const isUnstable = entry?.state === "unstable" && !entry.extrasWithState && Object.hasOwn(unstable[os] ?? {}, key);
    const listedFor = entry?.state === "owned" ? ticketsLabel(entry.ids) : `ticket ${ticket}`;
    const result = byKey.get(key);
    if (!result) {
      rows.push({ key, outcome: "NOT RUN", ticket });
      failures.push(`${key}: did not run in the ${os} job${ticket ? ` (listed for ${listedFor})` : ""}`);
      continue;
    }
    const outcome = OUTCOME[result.exitCode] ?? `exit ${result.exitCode}`;
    const row = { key, outcome, ticket, ...(isUnstable ? { state: "unstable" } : {}), ...(entry?.state === "owned" ? { owners: entry.ids } : {}) };
    rows.push(row);
    // A listed repeated key tolerates only its median check (Round 9 Q1
    // condition 1): a ceiling breach or any other RED check of any repetition
    // fails, so the listing cannot mask Round 6 Q1 condition 3.
    const rule = repetitionRule(key, repeated, os);
    if (rule && ticket !== null && outcome === "RED") {
      const median = setCheckName(rule);
      const other = (result.redChecks ?? []).filter((c) => c !== median);
      if (other.length || !(result.redChecks ?? []).includes(median)) { failures.push(`${key}: RED on ${other.join(", ") || "no median check"}: a listed repeated run accepts only ${median} (${os}, Round 9 Q1 condition 1)`); continue; }
    }
    // A bound that does not fit its key is already a schema error: it judges nothing.
    if (isUnstable && boundKindError(key, unstable[os][key], repeated, os)) continue;
    const band = isUnstable ? unstable[os][key].growthBand : undefined;
    if (band && (outcome === "RED" || outcome === "GREEN")) {
      // Round 13 Q1 condition 1: judged on the check's commit value, either trend flag.
      const red = result.redChecks ?? [];
      const other = red.filter((c) => c !== band.check);
      const g = (result.growthChecks ?? []).find((c) => c.name === band.check);
      const value = g?.commitValue;
      const gap = !g ? `no ${band.check} check` : g.insufficient ? `insufficient: ${g.samples ?? 0} samples` : g.gate !== "commit" ? `gate ${g.gate ?? "none"}, not commit` : !isNum(value) ? "no value" : null;
      if (other.length || (outcome === "RED" && !red.includes(band.check))) failures.push(`${key}: RED on ${other.join(", ") || "no red check"}: the unstable entry accepts only ${band.check} within its band (${os}, Round 13 Q1 condition 1)`);
      else if (gap) failures.push(`${key}: unstable entry without a commit value of ${band.check} (${gap}): a measurement gap (${os}, Round 13 Q1 condition 1, Round 6 Q2 condition 2)`);
      else if (value > band.max) failures.push(`${key}: unstable ${band.check} ${value} %/1k (commit) is above the ${band.max} %/1k bound (${os}, Round 13 Q1 condition 1)`);
      else if (value <= band.budget) failures.push(`${key}: ${band.check} ${value} %/1k (commit) is at budget (≤ ${band.budget}) but listed for ticket ${ticket}: the ownership comes back as a question (${os}, Round 13 Q1 condition 1)`);
      else row.note = `${key}: unstable (${band.check} ${value} %/1k commit, budget ${band.budget}, bound ${band.max}, trend ${g.trend === true}), owned by ticket ${ticket}`;
      continue;
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
    // Round 14 Q1 condition 2, Round 15 Q1 condition 4: a listed single run is RED
    // only on checks its owners own; GREEN passes only while a name is marked `flips`.
    if (!rule && !isUnstable && entry?.state === "owned" && (outcome === "RED" || (outcome === "GREEN" && entry.flips))) {
      const red = result.redChecks ?? [];
      const names = result.checkNames;
      const before = failures.length;
      if (!Array.isArray(names)) failures.push(`${key}: the run reports no check names, so the checks of ${listedFor} cannot be matched (${os}, Round 14 Q1, Round 3 Q8 condition 2)`);
      else for (const id of entry.ids) for (const c of entry.owners[id].filter((c) => !names.includes(c))) failures.push(`${key}: ticket ${id} owns ${c}, which this run does not produce: a stale or mistyped name (${os}, Round 14 Q1, Round 3 Q8 condition 2)`);
      if (outcome === "RED" && !red.length) failures.push(`${key}: RED with no RED check named, so nothing shows it belongs to ${listedFor} (${os}, Round 14 Q1)`);
      for (const c of red.filter((c) => !entry.ownerOf.has(c))) failures.push(`${key}: RED on ${c}, not owned by ${listedFor} (${os}, Round 14 Q1, Round 15 Q1); the RED comes back as an ownership question, do not edit owners`);
      if (failures.length === before && outcome === "RED") {
        const by = entry.ids.map((id) => [id, red.filter((c) => entry.ownerOf.get(c) === id)]).filter(([, cs]) => cs.length);
        row.note = `${key}: RED on ${red.join(", ")}, owned by ${by.map(([id, cs]) => `ticket ${id} (${cs.join(", ")})`).join(", ")}`;
      } else if (failures.length === before) {
        const flipOwners = entry.ids.filter((id) => entry.flips.some((c) => entry.ownerOf.get(c) === id));
        row.note = `${key}: GREEN, listed for ${ticketsLabel(flipOwners)} on flipping checks ${entry.flips.join(", ")} (Round 15 Q1)`;
      }
      continue;
    }
    if (outcome === "RED" && ticket === null) failures.push(`${key}: RED but not listed in expected-red.json (${os})`);
    else if (outcome === "GREEN" && ticket !== null) failures.push(`${key}: GREEN but listed for ${listedFor}: delete the entry from expected-red.json (${os})`);
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
