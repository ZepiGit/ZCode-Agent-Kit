// The memory loop's budgets: spec §18 MEMORY and PROCESSES, in one place.
// Scenarios build their verdict budgets from these numbers; verdict.test.mjs
// pins them to the spec, so a budget can only change together with the spec.
// Metric: RSS (VmRSS / VmHWM) on Linux. Windows (Round 7 Q1): working set for
// the per-process peak/steady budgets of proxy, launcher, MCP bridge and
// preflight; commit for the S3 total, growth, solver and S2 checks.
// Budgets are never loosened past the Phase 1B baseline (METRICS.md).

export const MEMORY = {
  // S1–S5: % per 1,000 work units after warm-up, RED only together with a trend.
  growth: { maxPctPer1k: 5, risingWindows: 3, netRisePct: 10 },
  S1: {
    steadyMB: 160, // proxy main, median after warm-up under the mixed load
    peakMB: 250, // proxy main, per-process peak incl. VmHWM
    burstPeakMB: { burst16: 400, burst32: 600 }, // HWM at 16 / 32 concurrent 10.8 MB bodies (ADR-0004)
  },
  S2: {
    solverCapMB: 300, // each solver process (hard cap, ADR-0002)
    costPerGenerationMB: 300, // solver RSS above the host's base, per generation
    retainedBeforeRecycleMB: 300,
    hungReclaimMB: 64,
    cdnMemoryMB: 64, // the ≤ 256-entry bound is pinned at seam 3 (ticket 25), not observable here
    coldStartMs: 4500, // spawn + handshake + module load + first solve, 5 % of the 90 s deadline
  },
  S3: {
    // (a) maximum over all samples of summed kit RSS (commit on Windows)
    // windows: 0.7 × 734.5 MB, the first clean windows run (Round 7 Q2); kit-started PowerShell counts.
    kitTotalMB: { linux: 596, windows: 514 },
    // (b) every kit process's own peak (VmHWM / PeakPageFileUsage) per role
    rolePeakMB: { launcher: 74, "mcp-bridge": 75, preflight: 76, proxy: 62, solver: 20 },
  },
  S5: { procPeakMB: 150, rebootCostMB: 20, taskFailures: 0 },
  S6: { linesHeapMB: 16, longLineHeapMB: 16, resizeHeapMB: 8 },
  S7: { proxyLogMB: 6, earlyLogMB: 1, responsesStoreHeapMB: 96 },
};

/**
 * Runs judged on the median of n fresh, sequential repetitions instead of one
 * run (Round 6 Q1, ticket 60; lib/repetitions.mjs). The one place n lives.
 * S1/burst1 (3 sequential ~10.8 MB requests per repetition): the median proxy
 * peak against the 250 MB S1 peak, and every repetition ≤ 400 MB, §18's budget
 * for 16 concurrent bodies (a run with ≤ 1 body in flight above it is a
 * regression by definition). The value judged is the check's own: RSS/VmHWM
 * on Linux, the working-set gate max(sampled WS, PeakWorkingSetSize) on
 * Windows (Round 7 Q1); the ceiling applies to that same value. n = 7: the
 * smallest odd n whose predicted false-RED rate is ≤ 5 % on the less
 * favourable Linux estimate (Round 11 Q1 condition 2). That estimate is the
 * Bun 1.4.2 arm of the paired CI run 42352122623, 5 of 24 above 250 MB:
 * 6.45 % at n = 5, 3.83 % at n = 7. Earlier estimates gave 3 (5 of 48 on the
 * ticket-60 tip) and 5 (8 of 59 with the earlier runs; Round 6 Q1, ticket 60).
 * One n for both legs; Round 6 Q1 allows n ≤ 9.
 */
export const REPEATED = {
  "S1/burst1": { n: 7, check: "procPeak:proxy", budgetMB: MEMORY.S1.peakMB, ceilingMB: MEMORY.S1.burstPeakMB.burst16 },
};

// Windows only: in paced runs no proxy sample may exceed ADR-0008's 512 MB
// soft footprint limit in commit (Round 7 Q1 condition 2).
export const PROXY_COMMIT_BACKSTOP = { role: "proxy", maxMB: 512 };

export const PROCESSES = {
  proxiesPerInstallation: 1, // at every sample, incl. 10 concurrent launches
  failedLaunches: 0, // incl. a killed lock holder
  staleLocks: 0, // after a race round or Ctrl-C during start
  orphans: 0, // marked processes alive after the scenario's own stop
  logDirFiles: 8,
  solversPerProxy: 1, // at every sample
  solversAfterProxyKill: 0, // after the proxy is SIGKILLed
  solversAfterIdleExit: 0,
  respawnsPer15Min: 3,
};

// S3 OMP leg (ADR-0013 cond 4, spec §18 "S3 OMP leg"): the generated OMP
// extension in stub Bun hosts started together, also with the starter killed.
// The hosts are the harness: their RSS delta is reported and gated here, never
// counted as kit footprint.
export const OMP_LEG = {
  hosts: 5, // simultaneous hosts of one installation
  concurrentPreflights: 1, // OMP preflight processes alive at once
  waiterCostMB: 5, // in-host waiter cost per host (build-time gate)
};

/** S3's two-part verdict for one OS leg: (a) as `peaks.kit`, (b) as `procPeaks` per role. */
export function s3Budgets(os) {
  return {
    peaks: { kit: MEMORY.S3.kitTotalMB[os] },
    procPeaks: { ...MEMORY.S3.rolePeakMB },
    counts: { proxy: PROCESSES.proxiesPerInstallation },
    perParent: [{ role: "solver", max: PROCESSES.solversPerProxy }],
    orphans: PROCESSES.orphans,
    commitBackstop: PROXY_COMMIT_BACKSTOP, // S3 is paced
  };
}

/** The growth budget for a role over a window of the run. */
export function growthBudget(role, { fromT = 0, untilT = Infinity, warmupFraction = 0.25 } = {}) {
  return { role, axis: "progress", maxPctPer1k: MEMORY.growth.maxPctPer1k, risingWindows: MEMORY.growth.risingWindows, netRisePct: MEMORY.growth.netRisePct, warmupFraction, fromT, untilT };
}

/**
 * S5/short after the retention bound (Owner Proxy Round 24 Q1, ticket 74;
 * pre-registered there, never fitted to a run). 1,200 tasks with the per-task
 * workload unchanged. growth:mcp-bridge is judged over the load from the first
 * sample at task ≥ 600 (ADR-0009's 500-task bound plus 100 settling tasks) to
 * the end, with no warm-up inside, under the unchanged budget and trend rule.
 * warm-up-growth:mcp-bridge is the quantity S5/short judged before: the load
 * cut at the sample where progress reaches task 400, the default 25 % warm-up.
 * It is RED above its ceiling whatever the trend says: 55 %/1k on linux (RSS;
 * 8.67 above the highest of 36 tip runs) and 30 %/1k on windows (commit;
 * Round 13's bound, kept so that deleting the windows entry keeps a windows
 * regression bound). The ceilings are regression bounds, not budgets.
 */
export const S5_SHORT = {
  tasks: 1200,
  judgedFromTask: 600,
  warmUpUntilTask: 400,
  warmUpCeilingPctPer1k: { linux: 55, windows: 30 },
};

/** S5's growth checks over the load window [fromT, untilT]: the long profile's one, or S5/short's two. */
export function s5GrowthBudgets({ long = false, os, fromT, untilT }) {
  if (long) return growthBudget("mcp-bridge", { fromT, untilT });
  const ceiling = S5_SHORT.warmUpCeilingPctPer1k[os];
  if (typeof ceiling !== "number") throw new Error(`S5/short: no warm-up ceiling for OS leg ${os}`);
  return [
    { ...growthBudget("mcp-bridge", { fromT, untilT, warmupFraction: 0 }), fromProgress: S5_SHORT.judgedFromTask },
    { ...growthBudget("mcp-bridge", { fromT, untilT }), name: "warm-up-growth:mcp-bridge", untilProgress: S5_SHORT.warmUpUntilTask, ceiling },
  ];
}
