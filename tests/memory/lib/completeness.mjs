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

const OUTCOME_OF_EXIT = { 0: "GREEN", 1: "RED" };

/**
 * summary: the run's parsed summary.json, or null when there is none.
 * Returns { ok, problems }. An exit 2 is already a harness failure and needs no evidence.
 */
export function runEvidence(summary, { key, exitCode, evidence = EVIDENCE, rounds = ROUNDS }) {
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
  const ran = new Set((Array.isArray(notes.rounds) ? notes.rounds : []).map((r) => r?.name));
  for (const name of rounds[key] ?? []) if (!ran.has(name)) problems.push(`round ${name} never ran`);
  if (summary.platform === "win32" && summary.metric !== "commit") problems.push(`windows run with metric ${summary.metric ?? "none"}: no commit_kb was sampled`);
  if (summary.metric === "commit" && summary.notes?.sampler?.units?.ok !== true) problems.push("the units self-test did not pass");
  return { ok: problems.length === 0, problems };
}
