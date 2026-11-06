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

export const EVIDENCE = {
  S1: { minDurationS: 10, minSamples: 5, roles: ["proxy"] },
  S2: { minDurationS: 60, minSamples: 30, roles: ["scenario"] },
  S3: { minDurationS: 15, minSamples: 10, roles: ["proxy", "launcher", "preflight", "mcp-bridge"] },
  S4: { minDurationS: 60, minSamples: 30, roles: ["proxy", "manager"] },
  S5: { minDurationS: 120, minSamples: 60, roles: ["mcp-bridge"] },
  S6: { minDurationS: 1, minSamples: 1, roles: [] },
  S7: { minDurationS: 30, minSamples: 15, roles: ["proxy"] },
};

const OUTCOME_OF_EXIT = { 0: "GREEN", 1: "RED" };

/**
 * summary: the run's parsed summary.json, or null when there is none.
 * Returns { ok, problems }. An exit 2 is already a harness failure and needs no evidence.
 */
export function runEvidence(summary, { key, exitCode, evidence = EVIDENCE }) {
  if (exitCode !== 0 && exitCode !== 1) return { ok: true, problems: [] };
  if (!summary) return { ok: false, problems: [`exit ${exitCode} but no summary.json: the run never finished its scenario`] };
  const problems = [];
  if (summary.key !== key) problems.push(`summary is for ${summary.key}, not ${key}`);
  if (summary.outcome !== OUTCOME_OF_EXIT[exitCode]) problems.push(`outcome ${summary.outcome} but exit ${exitCode}`);
  const scenario = String(key).split("/")[0];
  const floor = evidence[scenario];
  if (!floor) problems.push(`no evidence floor for ${scenario}`);
  else {
    if (!(summary.samples >= floor.minSamples)) problems.push(`${summary.samples ?? 0} samples (need ≥ ${floor.minSamples})`);
    if (!(summary.durationS >= floor.minDurationS)) problems.push(`scenario ran ${summary.durationS ?? 0} s, below the ${scenario} floor of ${floor.minDurationS} s`);
    for (const role of floor.roles) if (!(summary.summary?.[role]?.maxCount >= 1)) problems.push(`role ${role} never seen`);
  }
  if (summary.platform === "win32" && summary.metric !== "commit") problems.push(`windows run with metric ${summary.metric ?? "none"}: no commit_kb was sampled`);
  if (summary.metric === "commit" && summary.notes?.sampler?.units?.ok !== true) problems.push("the units self-test did not pass");
  return { ok: problems.length === 0, problems };
}
