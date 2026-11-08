// A verdict counts only for a run that reached and completed its scenario.
// CI run 42221794531 (windows): every run exited 0 after writing the CSV
// header, with no summary and no sample, and the job called them GREEN.
// So a run's exit 0/1 is accepted only together with evidence in its
// summary.json; anything less is a harness failure (exit 2). This is Round 6
// Q2 condition 2: a GREEN from a missing observation is a harness failure,
// not a calibration.
//
// The evidence floors per scenario sit at about half the shortest Linux run
// (ticket 02 Comments, reports/t02-linux-job.log): a real run is far above
// them on either OS, while a run that never started its workload is below.
// `roles` must each be seen in at least one sample. S6 measures heap in its
// own Bun process and its processes are often not sampled at all in its 3–6 s
// (a Linux smoke run had 2 samples and no role), so it needs no role.
// A run key may carry its own floor, which then replaces its scenario's.

import { S5_SHORT } from "./budgets.mjs";

export const EVIDENCE = {
  S1: { minDurationS: 10, minSamples: 5, roles: ["proxy"] },
  S2: { minDurationS: 60, minSamples: 30, roles: ["scenario"] },
  // No mcp-bridge: a bridge starts only after a launch succeeds, and S3 measures
  // launches that fail (S3/hung on Windows: 21 of 21, CI run 42252896054).
  S3: { minDurationS: 15, minSamples: 10, roles: ["proxy", "launcher", "preflight"] },
  // The OMP stub-host leg (ticket 03) starts no launcher: its proof is the stub
  // hosts, the preflights they spawn and the proxy one of them starts. Linux
  // runs take 10–12 s with 28–37 samples (ticket 03 Comments); the manager a
  // preflight runs is too short-lived to be required on a Windows poll.
  "S3/omp": { minDurationS: 5, minSamples: 14, roles: ["proxy", "preflight", "omp-host"] },
  S4: { minDurationS: 60, minSamples: 30, roles: ["proxy", "manager"] },
  S5: { minDurationS: 120, minSamples: 60, roles: ["mcp-bridge"] },
  S6: { minDurationS: 1, minSamples: 1, roles: [] },
  S7: { minDurationS: 30, minSamples: 15, roles: ["proxy"] },
};

// The rounds a run must have completed (`notes.rounds` names). CI run
// 42281731448 (ubuntu): S3/hung skipped both hung rounds and still printed a
// RED verdict; time and roles caught it only because kill-holder-10 is short.
// A run that skipped a round did not run its scenario, however long the rest
// took. The long profile repeats the race rounds (#1, #2) and adds hung-10 to
// S3/short; these lists are the short profile's, a subset of the long one's.
export const ROUNDS = {
  "S3/short": ["race-5#0", "race-10#0", "race-10-preflight#0", "kill-holder-10"],
  "S3/hung": ["kill-holder-10", "hung-10-with-stale-lock", "hung-10"],
  // scenarios/s3-concurrency.mjs OMP_ROUNDS; the second is the killed-starter adversary.
  "S3/omp": ["omp-5", "omp-5-kill-starter"],
};

// The rounds where a refused `manager start` is the measured outcome, not a
// round that did not run (ticket 65; CI runs 42395651721, 42398295810,
// 42398299724). The killed holder's stale lock is what the round tests, and
// while the kit refuses that lock (ticket 16) the start fails there. Such a
// round counts as run only with its evidence: a non-zero exit code, the
// stderr, a lock whose holder was not alive, its launches, and the scenario's
// start-over-stale-lock check RED. In any other round a refused start is no
// evidence at all.
export const STALE_LOCK_ROUNDS = {
  "S3/hung": ["hung-10-with-stale-lock"],
};

function refusedStartProblems(key, rounds, checks, staleLockRounds) {
  const problems = [];
  for (const r of rounds) {
    if (!r?.startRefused) continue;
    const name = r.name;
    if (!(staleLockRounds[key] ?? []).includes(name)) { problems.push(`round ${name}: a refused start counts only in a stale-lock round`); continue; }
    const s = r.startRefused;
    if (!(Number.isInteger(s.startCode) && s.startCode !== 0 && typeof s.stderr === "string" && s.stderr.trim() !== "" && Number.isInteger(s.lock?.holderPid) && s.lock?.holderAlive === false)) {
      problems.push(`round ${name}: refused start without its evidence (exit code, stderr, a lock whose holder is not alive)`);
      continue;
    }
    const launches = Array.isArray(r.launchMs) ? r.launchMs.length : 0;
    if (!(r.n > 0 && launches === r.n)) problems.push(`round ${name}: refused start but ${launches} of ${r.n ?? 0} launches ran`);
    if (!checks.some((c) => c?.name === "start-over-stale-lock" && c.red === true)) problems.push(`round ${name}: refused start but the start-over-stale-lock check is not RED`);
  }
  return problems;
}

// The growth windows a run must have measured in full (Owner Proxy Round 24
// Q1, ticket 74): the load ran all its tasks (the scenario's `bridge` note),
// and each check is present, with its window bounds recorded (lib/verdict.mjs
// detail.window) and enough samples for growth() (≥ 6). The window's last
// sample is not held to the last task: the load ends right after its last
// task, so the last sample inside it is usually at task 1,199 (ticket 74's
// local runs). A run without them (a load that ended early, a stalled
// sampler, a summary from the 400-task rule) measured nothing, so its GREEN
// or RED is a harness failure, never a verdict.
export const GROWTH_WINDOWS = {
  "S5/short": { loadTasks: S5_SHORT.tasks, checks: ["growth:mcp-bridge", "warm-up-growth:mcp-bridge"] },
};

function growthWindowProblems(key, summary, growthWindows) {
  const rule = growthWindows[key];
  if (!rule) return [];
  const problems = [];
  const tasks = summary.notes?.bridge?.tasks;
  if (!(tasks >= rule.loadTasks)) problems.push(`the load ended at task ${tasks ?? "none"}, before task ${rule.loadTasks}`);
  const checks = Array.isArray(summary.checks) ? summary.checks : [];
  for (const name of rule.checks) {
    const c = checks.find((x) => x?.name === name);
    const w = c?.detail?.window;
    if (!c) problems.push(`${name}: missing`);
    else if (!w) problems.push(`${name}: no window bounds recorded`);
    else if (c.detail.insufficient === true || typeof c.value !== "number") problems.push(`${name}: insufficient: ${w.samples ?? 0} samples in tasks ${w.fromTask ?? 0}–${w.untilTask ?? rule.loadTasks} (need ≥ 6)`);
  }
  return problems;
}

const OUTCOME_OF_EXIT = { 0: "GREEN", 1: "RED" };

/**
 * summary: the run's parsed summary.json, or null when there is none.
 * Returns { ok, problems }. An exit 2 is already a harness failure and needs no evidence.
 */
export function runEvidence(summary, { key, exitCode, evidence = EVIDENCE, rounds = ROUNDS, staleLockRounds = STALE_LOCK_ROUNDS, growthWindows = GROWTH_WINDOWS }) {
  if (exitCode !== 0 && exitCode !== 1) return { ok: true, problems: [] };
  if (!summary) return { ok: false, problems: [`exit ${exitCode} but no summary.json: the run never finished its scenario`] };
  const problems = [];
  if (summary.key !== key) problems.push(`summary is for ${summary.key}, not ${key}`);
  if (summary.outcome !== OUTCOME_OF_EXIT[exitCode]) problems.push(`outcome ${summary.outcome} but exit ${exitCode}`);
  const scenario = String(key).split("/")[0];
  const floorName = Object.hasOwn(evidence, key) ? key : scenario;
  const floor = evidence[floorName];
  if (!floor) problems.push(`no evidence floor for ${scenario}`);
  else {
    if (!(summary.samples >= floor.minSamples)) problems.push(`${summary.samples ?? 0} samples (need ≥ ${floor.minSamples})`);
    if (!(summary.durationS >= floor.minDurationS)) problems.push(`scenario ran ${summary.durationS ?? 0} s, below the ${floorName} floor of ${floor.minDurationS} s`);
    for (const role of floor.roles) if (!(summary.summary?.[role]?.maxCount >= 1)) problems.push(`role ${role} never seen`);
  }
  const notes = summary.notes ?? {};
  for (const [k, v] of Object.entries(notes)) {
    if (!k.endsWith(".skipped")) continue;
    const why = v && typeof v === "object" ? v.reason ?? JSON.stringify(v) : `manager start exited ${v}`;
    problems.push(`round ${k.slice(0, -".skipped".length)} skipped: ${why}`);
  }
  const roundList = Array.isArray(notes.rounds) ? notes.rounds : [];
  const ran = new Set(roundList.map((r) => r?.name));
  for (const name of rounds[key] ?? []) if (!ran.has(name)) problems.push(`round ${name} never ran`);
  problems.push(...refusedStartProblems(key, roundList, Array.isArray(summary.checks) ? summary.checks : [], staleLockRounds));
  problems.push(...growthWindowProblems(key, summary, growthWindows));
  if (summary.platform === "win32" && summary.metric !== "commit") problems.push(`windows run with metric ${summary.metric ?? "none"}: no commit_kb was sampled`);
  if (summary.metric === "commit" && summary.notes?.sampler?.units?.ok !== true) problems.push("the units self-test did not pass");
  return { ok: problems.length === 0, problems };
}
