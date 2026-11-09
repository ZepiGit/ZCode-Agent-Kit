/**
 * supervisor.ts — the proxy's health supervisor (ADR-0008).
 *
 * One module owns the proxy's health policy:
 * - the heartbeat and its watcher thread (`watchdog.ts`, with `watchdogStep`
 *   as the pure core and the SharedArrayBuffer heartbeat unchanged);
 * - memory sampling: the memory footprint (`Bun.unsafe.memoryFootprint()`:
 *   Pss on Linux, commit charge on Windows, phys_footprint on macOS), RSS
 *   only where that is missing;
 * - the memory thresholds: a soft and a hard limit, each held for a number of
 *   samples taken a fixed interval apart (default 512 / 1024 MB × 3 samples
 *   15 s apart). The soft limit only WARNs: it never recycles the solver. The
 *   hard limit requests a respawn through the handoff;
 * - the respawn handoff point: the respawn request goes to the kit manager's
 *   hook; only the respawn acknowledgement (ADR-0015: the manager reserved the
 *   restart budget) starts the graceful shutdown. A refused or unacknowledged
 *   request keeps the proxy serving, logs one ERROR, reports the restarts as
 *   exhausted and spawns no further hook within the budget window. Without a
 *   manager hook (TUI, standalone proxy) the supervisor logs and keeps serving:
 *   a proxy at 3 GB still serves, a dead one does not;
 * - the single graceful shutdown sequence (`createGracefulShutdown`), used by
 *   SIGINT/SIGTERM and the memory respawn (later the stop request and update).
 *
 * New log lines use the event-line format (`log/event-line.mjs`, component
 * `supervisor` and `shutdown`).
 */
import { createEventLogger, type EventLogger } from "../log/event-line.mjs";
import { startEventLoopMonitor, stopEventLoopMonitor } from "./health-monitor.js";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  awaitRespawnAcknowledgement, installWatchdog, respawnHookCommand, spawnRespawnHook,
  RESPAWN_ACK_POLL_MS, RESPAWN_ACK_WAIT_MS, type RespawnAnswer, type RespawnOutcome, type WatchdogHandle,
} from "./watchdog.js";
import { DEFAULT_MEMORY_THRESHOLDS, type MemoryThresholds } from "./memory-thresholds.js";
import { SHED_RETRY_AFTER_SECONDS } from "../server/admission.js";
// Type-only: erased at runtime.
import type { ProxyServer } from "../server/server.js";

export { DEFAULT_MEMORY_THRESHOLDS, RESPAWN_ACK_WAIT_MS, type MemoryThresholds, type RespawnAnswer, type RespawnOutcome };

const MB = 1024 * 1024;

export interface FootprintSample {
  mb: number;
  /** `footprint` when the runtime reports one, `rss` for the fallback. */
  metric: "footprint" | "rss";
}

type FootprintSource = { memoryFootprint?: () => number | undefined } | null | undefined;

function bunUnsafe(): FootprintSource {
  return (globalThis as { Bun?: { unsafe?: FootprintSource } }).Bun?.unsafe ?? null;
}

/**
 * The proxy's memory footprint in MB, or its RSS where the runtime has no
 * footprint accessor (Node, an unsupported platform). `source` is injectable
 * for tests; it defaults to `Bun.unsafe`.
 */
export function memoryFootprint(source: FootprintSource = bunUnsafe()): FootprintSample {
  let bytes: number | undefined;
  try { bytes = source?.memoryFootprint?.(); } catch { bytes = undefined; }
  if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) {
    return { mb: Math.round(bytes / MB), metric: "footprint" };
  }
  return { mb: Math.round(process.memoryUsage.rss() / MB), metric: "rss" };
}

/** The time source and repeating timer the supervisor runs on. */
export interface SupervisorClock {
  now(): number;
  /** Call `fn` every `ms`; returns a cancel function. Must not keep the process alive. */
  every(ms: number, fn: () => void): () => void;
}

export const realClock: SupervisorClock = {
  now: () => Date.now(),
  every(ms, fn) {
    const timer = setInterval(fn, ms);
    (timer as { unref?: () => void }).unref?.();
    return () => clearInterval(timer);
  },
};

/**
 * The respawn handoff point (ADR-0008 cond 1, ADR-0015). `request` resolves
 * with the manager's answer; only a confirmed one (the respawn
 * acknowledgement: the manager has reserved the restart budget) lets the
 * proxy drain. Otherwise it keeps serving.
 */
export interface RespawnHandoff {
  available(): boolean;
  request(reason: "memory"): Promise<RespawnAnswer>;
}

export interface ManagerRespawnHandoffOptions {
  /** Longest wait for the acknowledgement or a refusal (default 10 s). */
  ackWaitMs?: number;
  pollMs?: number;
  /** The wall clock the request time is taken from (the manager stamps `at` with its own). */
  now?: () => number;
  spawn?: typeof spawn;
}

/**
 * The kit manager's respawn hook from this process's environment, or null
 * without one. With the manager's logs dir (`ZCODE_KIT_LOG_DIR`) a request
 * waits for the respawn acknowledgement in `respawn.json`; without it (a
 * manager older than ADR-0015) the hook's start is the confirmation, as before.
 */
export function managerRespawnHandoff(env: Record<string, string | undefined> = process.env, opts: ManagerRespawnHandoffOptions = {}): RespawnHandoff | null {
  if (respawnHookCommand(env, process.pid, "memory") === null) return null;
  return {
    available: () => respawnHookCommand(env, process.pid, "memory") !== null,
    async request(reason) {
      const hook = respawnHookCommand(env, process.pid, reason);
      if (!hook) return { outcome: "hook-failed", confirmed: false, waitedMs: 0, error: "no manager hook" };
      const logDir = env.ZCODE_KIT_LOG_DIR;
      if (!logDir) {
        const started = await spawnRespawnHook(reason, env);
        return { outcome: started ? "started" : "hook-failed", confirmed: started, waitedMs: 0 };
      }
      return awaitRespawnAcknowledgement(
        { spawn: opts.spawn ?? spawn, readFile: (path) => readFileSync(path, "utf8"), now: opts.now ?? Date.now },
        hook,
        env,
        { pid: process.pid, ackFile: join(logDir, "respawn.json"), ackWaitMs: opts.ackWaitMs ?? RESPAWN_ACK_WAIT_MS, pollMs: opts.pollMs ?? RESPAWN_ACK_POLL_MS },
      );
    },
  };
}

export interface HealthSupervisorOptions {
  thresholds?: Partial<MemoryThresholds>;
  /** The footprint sampler (default `memoryFootprint`). */
  sample?: () => FootprintSample;
  clock?: SupervisorClock;
  /** The respawn handoff; null = no manager hook (TUI, standalone): log and keep serving. */
  respawn?: RespawnHandoff | null;
  /** What a confirmed respawn runs: the graceful shutdown sequence. */
  shutdown: (reason: "memory") => Promise<void>;
  /** Event-line sink (default: the console). */
  writeLog?: (line: string) => void;
  /** Start the heartbeat watcher and the event-loop lag monitor (default true). */
  watchdog?: boolean;
}

/**
 * The manager's restart budget window (3 restarts per 15 min). After a
 * refused or unacknowledged respawn the proxy spawns no further hook until a
 * window has passed since that request (ADR-0015 cond 6).
 */
export const RESPAWN_BUDGET_WINDOW_MS = 15 * 60 * 1000;

export interface MemoryState {
  last: FootprintSample | null;
  lastAt: number | null;
  softStreak: number;
  hardStreak: number;
  respawnPending: boolean;
  /** How the last respawn request ended (null before the first). */
  respawnOutcome: RespawnOutcome | null;
  /**
   * The restart budget as this proxy last saw it: true from a refused or
   * unacknowledged respawn until the budget window has passed (`restarts`
   * exhausted, ADR-0015); no hook is spawned meanwhile.
   */
  restartsExhausted: boolean;
  /** When the next respawn request may spawn a hook (null: at once). */
  respawnRetryAt: number | null;
}

export interface HealthSupervisor {
  start(): void;
  stop(): void;
  /** The last sample and the streaks (for /health details, ticket 39). */
  memory(): MemoryState;
}

export function createHealthSupervisor(opts: HealthSupervisorOptions): HealthSupervisor {
  const t: MemoryThresholds = { ...DEFAULT_MEMORY_THRESHOLDS, ...(opts.thresholds ?? {}) };
  const sample = opts.sample ?? (() => memoryFootprint());
  const clock = opts.clock ?? realClock;
  const respawn = opts.respawn === undefined ? managerRespawnHandoff() : opts.respawn;
  const log: EventLogger = createEventLogger({ component: "supervisor", ...(opts.writeLog ? { write: opts.writeLog } : {}) });

  let cancel: (() => void) | null = null;
  let watchdog: WatchdogHandle | null = null;
  const state: MemoryState = {
    last: null, lastAt: null, softStreak: 0, hardStreak: 0, respawnPending: false,
    respawnOutcome: null, restartsExhausted: false, respawnRetryAt: null,
  };
  // Once per episode (an episode ends with a sample at or under the soft limit).
  let softWarned = false;
  let hardWarned = false;

  // The ERROR line of a respawn that did not confirm, one per request (so at
  // most one per budget window). `restarts=exhausted` is the report ADR-0015
  // asks for; the state carries it too (`restartsExhausted`).
  const NOT_CONFIRMED: Record<Exclude<RespawnOutcome, "acknowledged" | "started">, string> = {
    "refused": "respawn refused by the kit manager; keeps serving",
    "no-acknowledgement": "respawn not acknowledged by the kit manager; keeps serving",
    "hook-failed": "respawn hook did not start; keeps serving",
  };

  function tick(): void {
    if (state.respawnPending) return;
    let s: FootprintSample;
    try { s = sample(); } catch { return; }
    const now = clock.now();
    state.last = s;
    state.lastAt = now;
    if (state.respawnRetryAt !== null && now >= state.respawnRetryAt) {
      state.respawnRetryAt = null;
      state.restartsExhausted = false;
    }
    const fields = { footprintMB: s.mb, metric: s.metric };
    if (s.mb <= t.softLimitMB) {
      if (softWarned) log.info("memory back under the soft limit", { ...fields, softLimitMB: t.softLimitMB });
      state.softStreak = 0;
      state.hardStreak = 0;
      softWarned = false;
      hardWarned = false;
      return;
    }
    state.softStreak++;
    state.hardStreak = s.mb > t.hardLimitMB ? state.hardStreak + 1 : 0;
    if (!softWarned && state.softStreak >= t.samples) {
      softWarned = true;
      // ADR-0008 cond 5: the soft limit only warns; the solver is not recycled.
      log.warn("memory above the soft limit", { ...fields, softLimitMB: t.softLimitMB, samples: t.samples, intervalS: t.sampleIntervalMs / 1000 });
    }
    if (state.hardStreak < t.samples) return;
    if (!respawn || !respawn.available()) {
      if (!hardWarned) log.warn("memory above the hard limit; no manager hook, keeps serving", { ...fields, hardLimitMB: t.hardLimitMB, samples: t.samples });
      hardWarned = true;
      return;
    }
    if (state.respawnRetryAt !== null) {
      // A refused or unacknowledged respawn in this budget window: no hook
      // until the window has passed, however often the condition comes back.
      if (!hardWarned) {
        log.warn("memory above the hard limit; restart budget exhausted, keeps serving", {
          ...fields, hardLimitMB: t.hardLimitMB, restarts: "exhausted", retryInS: Math.ceil((state.respawnRetryAt - now) / 1000),
        });
      }
      hardWarned = true;
      return;
    }
    hardWarned = true;
    log.warn("memory above the hard limit", { ...fields, hardLimitMB: t.hardLimitMB, samples: t.samples, action: "respawn-request" });
    state.respawnPending = true;
    const requestedAt = now;
    const notConfirmed = (answer: RespawnAnswer): void => {
      // Nobody would bring a stopped proxy back: keep serving, and spawn no
      // further hook within the budget window.
      state.respawnPending = false;
      state.hardStreak = 0;
      state.respawnOutcome = answer.outcome;
      state.restartsExhausted = true;
      state.respawnRetryAt = requestedAt + RESPAWN_BUDGET_WINDOW_MS;
      const outcome = answer.outcome as keyof typeof NOT_CONFIRMED;
      log.error(NOT_CONFIRMED[outcome] ?? NOT_CONFIRMED["no-acknowledgement"], {
        ...fields, hardLimitMB: t.hardLimitMB, outcome: answer.outcome, waitedMs: answer.waitedMs,
        ...(answer.exitCode !== undefined ? { hookExit: answer.exitCode } : {}),
        restarts: "exhausted", retryInS: RESPAWN_BUDGET_WINDOW_MS / 1000,
      });
    };
    respawn.request("memory").then((answer) => {
      if (!answer.confirmed) return notConfirmed(answer);
      state.respawnOutcome = answer.outcome;
      stopSampling();
      log.info("respawn confirmed; draining", { outcome: answer.outcome, waitedMs: answer.waitedMs });
      void opts.shutdown("memory");
    }, (err: unknown) => notConfirmed({ outcome: "hook-failed", confirmed: false, waitedMs: 0, error: String(err) }));
  }

  function stopSampling(): void {
    cancel?.();
    cancel = null;
  }

  return {
    start() {
      if (cancel) return;
      if (opts.watchdog !== false) {
        startEventLoopMonitor();
        watchdog = installWatchdog();
      }
      cancel = clock.every(t.sampleIntervalMs, tick);
    },
    stop() {
      stopSampling();
      watchdog?.stop();
      watchdog = null;
      if (opts.watchdog !== false) stopEventLoopMonitor();
    },
    memory: () => {
      const exhausted = state.respawnRetryAt !== null && clock.now() < state.respawnRetryAt;
      return { ...state, restartsExhausted: exhausted, respawnRetryAt: exhausted ? state.respawnRetryAt : null };
    },
  };
}

// ------------------------------------------------------------------ shutdown

/** What started a graceful shutdown. Ticket 22 adds the stop request, update later. */
export type ShutdownReason = "signal" | "memory";

export interface ShutdownTiming {
  /** How long requests already accepted may run before the force point. */
  drainMs: number;
  /** Hard deadline from the trigger to `exit`: drain + flush + close. */
  deadlineMs: number;
}

/**
 * Per trigger. A signal comes from the kit manager's `stop` (SIGTERM; on POSIX
 * it sends SIGKILL 5 s later until ticket 22 shares the deadline) or Ctrl-C,
 * so drain + the 3 s account-metadata flush + exit stay inside 5 s. The memory
 * respawn keeps today's 10 s cap: 6 s for the requests in flight, then the
 * flush. ADR-0008 cond 3, ADR-0014.
 */
export const SHUTDOWN_TIMING: Readonly<Record<ShutdownReason, Readonly<ShutdownTiming>>> = Object.freeze({
  signal: Object.freeze({ drainMs: 1_000, deadlineMs: 4_500 }),
  memory: Object.freeze({ drainMs: 6_000, deadlineMs: 10_000 }),
});

const CAUSE: Record<ShutdownReason, string> = { signal: "it was asked to stop", memory: "a memory respawn" };

/** Longest wait for the listener to close after the force point. */
const CLOSE_WAIT_MS = 1_000;

export type DrainableServer = Pick<ProxyServer, "beginDrain" | "inFlight" | "whenIdle" | "cutInFlight" | "drainShed" | "close">;

export interface GracefulShutdownOptions {
  server: DrainableServer;
  /** Background work that must not start anything new: the claim scheduler, the captcha pool and solver. */
  stopBackground?: () => void;
  /** The bounded account-metadata flush (`flushAccountMetadata`). */
  flush?: () => Promise<void>;
  /** Ends the process (default `process.exit`). */
  exit?: (code: number) => void;
  writeLog?: (line: string) => void;
}

export interface GracefulShutdown {
  /** Run the sequence once; a later trigger joins the running one. */
  run(reason: ShutdownReason, timing?: Partial<ShutdownTiming>): Promise<void>;
  running(): boolean;
}

/** A timer that does not outlive its race. */
function delay(ms: number): { promise: Promise<void>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * The proxy's one graceful shutdown sequence:
 * 1. drain: the listener stays open and sheds new requests (503 + Retry-After);
 * 2. background work stops (claim scheduler, captcha pool and solver);
 * 3. requests already accepted get the drain window;
 * 4. the force point: responses still open are cut and counted in one log line;
 * 5. the bounded account-metadata flush;
 * 6. the listener closes and the process exits 0.
 * A deadline timer exits regardless once `deadlineMs` has passed, so a flush
 * or close that never returns cannot keep the process alive.
 */
export function createGracefulShutdown(opts: GracefulShutdownOptions): GracefulShutdown {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const log: EventLogger = createEventLogger({ component: "shutdown", ...(opts.writeLog ? { write: opts.writeLog } : {}) });
  let current: Promise<void> | null = null;

  return {
    running: () => current !== null,
    run(reason, override = {}) {
      if (current) return current;
      const timing: ShutdownTiming = { ...SHUTDOWN_TIMING[reason], ...override };
      const startedAt = Date.now();
      const drainEndsAt = startedAt + timing.drainMs;
      let exited = false;
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      const exitOnce = (code: number): void => {
        if (exited) return;
        exited = true;
        clearTimeout(force);
        try { exit(code); } finally { finish(); }
      };
      const force = setTimeout(() => {
        log.warn("deadline reached; exiting", { reason, deadlineMs: timing.deadlineMs });
        exitOnce(0);
      }, timing.deadlineMs);
      (force as { unref?: () => void }).unref?.();

      log.info("started", { reason, drainMs: timing.drainMs, deadlineMs: timing.deadlineMs, inFlight: opts.server.inFlight() });
      opts.server.beginDrain({
        cause: CAUSE[reason],
        // The time left until the force point, plus the start of a fresh proxy.
        retryAfterSeconds: () => Math.max(0, Math.ceil((drainEndsAt - Date.now()) / 1000)) + SHED_RETRY_AFTER_SECONDS,
      });
      try { opts.stopBackground?.(); } catch { /* never block the shutdown */ }

      current = (async () => {
        const window = delay(Math.max(0, drainEndsAt - Date.now()));
        await Promise.race([opts.server.whenIdle(), window.promise]);
        window.cancel();
        const cut = opts.server.cutInFlight();
        const fields = { reason, waitedMs: Date.now() - startedAt, cut, shed: opts.server.drainShed() };
        if (cut > 0) log.warn("drain finished", fields);
        else log.info("drain finished", fields);
        try { await opts.flush?.(); } catch { /* bounded by the caller and by the deadline */ }
        const closeWait = delay(CLOSE_WAIT_MS);
        await Promise.race([opts.server.close().catch(() => {}), closeWait.promise]);
        closeWait.cancel();
        exitOnce(0);
      })();
      // Resolves when the process exits, by the sequence or by the deadline.
      current = Promise.race([current, finished]);
      return current;
    },
  };
}

/**
 * SIGINT and SIGTERM run the graceful shutdown. SIGINT keeps its
 * "Shutting down..." console line.
 */
export function handleShutdownSignals(shutdown: GracefulShutdown, proc: Pick<NodeJS.Process, "on"> = process): void {
  proc.on("SIGINT", () => {
    console.log("\nShutting down...");
    void shutdown.run("signal");
  });
  proc.on("SIGTERM", () => { void shutdown.run("signal"); });
}
