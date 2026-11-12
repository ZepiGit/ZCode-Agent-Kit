/**
 * The health supervisor's memory thresholds and their defaults.
 * A leaf module, so the config loader can validate against the defaults
 * without loading the supervisor.
 */

/** The memory thresholds (`health.memory` in config.yaml). */
export interface MemoryThresholds {
  softLimitMB: number;
  hardLimitMB: number;
  /** Consecutive samples a limit must be held for. */
  samples: number;
  /** Time between two samples. */
  sampleIntervalMs: number;
}

/** Soft 512 MB, hard 1024 MB, each held for 3 samples 15 s apart. */
export const DEFAULT_MEMORY_THRESHOLDS: Readonly<MemoryThresholds> = Object.freeze({
  softLimitMB: 512,
  hardLimitMB: 1024,
  samples: 3,
  sampleIntervalMs: 15_000,
});
