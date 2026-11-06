// The memory loop's budgets: spec §18 MEMORY and PROCESSES, in one place.
// Scenarios build their verdict budgets from these numbers; verdict.test.mjs
// pins them to the spec, so a budget can only change together with the spec.
// Metric: RSS (VmRSS / VmHWM) on Linux, commit on Windows (ticket 02).
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
    kitTotalMB: { linux: 596, windows: 600 },
    // (b) every kit process's own peak (VmHWM / PeakPageFileUsage) per role
    rolePeakMB: { launcher: 74, "mcp-bridge": 75, preflight: 76, proxy: 62, solver: 20 },
  },
  S5: { procPeakMB: 150, rebootCostMB: 20, taskFailures: 0 },
  S6: { linesHeapMB: 16, longLineHeapMB: 16, resizeHeapMB: 8 },
  S7: { proxyLogMB: 6, earlyLogMB: 1, responsesStoreHeapMB: 96 },
};

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

/** S3's two-part verdict for one OS leg: (a) as `peaks.kit`, (b) as `procPeaks` per role. */
export function s3Budgets(os) {
  return {
    peaks: { kit: MEMORY.S3.kitTotalMB[os] },
    procPeaks: { ...MEMORY.S3.rolePeakMB },
    counts: { proxy: PROCESSES.proxiesPerInstallation },
    perParent: [{ role: "solver", max: PROCESSES.solversPerProxy }],
    orphans: PROCESSES.orphans,
  };
}

/** The growth budget for a role over a window of the run. */
export function growthBudget(role, { fromT = 0, untilT = Infinity, warmupFraction = 0.25 } = {}) {
  return { role, axis: "progress", maxPctPer1k: MEMORY.growth.maxPctPer1k, risingWindows: MEMORY.growth.risingWindows, netRisePct: MEMORY.growth.netRisePct, warmupFraction, fromT, untilT };
}
