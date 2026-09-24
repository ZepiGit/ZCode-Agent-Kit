/**
 * health-monitor.ts — cheap process vitals for `/health` `details`, and the
 * serve-side memory guard.
 *
 * Before this existed the proxy had no memory or event-loop signal at all: a
 * process at 11 GB RSS with a parked main thread looked identical to a
 * healthy one right up to the moment /health stopped answering. Everything
 * here is O(1) at read time — /health must answer even while the captcha
 * machinery is degraded, so it never awaits, never imports the captcha
 * module, and only reads values a timer already collected.
 *
 * The captcha module registers itself (`registerCaptchaRuntime`) when it
 * loads; until then `details.captcha` is null (non start-plan, or before the
 * lazy warmup import resolves).
 */
// Type-only: erased at runtime, so this never loads the solver.
import type { CaptchaSolverStats } from "../proxy/captcha-solver.js";

/** Captcha summary exposed as `/health` `details.captcha` (see contracts). */
export interface CaptchaHealth {
  ready: number;
  target: number;
  activeSolves: number;
  storm: boolean;
  mintSuccessRate10m: number;
  solver: CaptchaSolverStats;
}

export interface HealthDetails {
  pid: number;
  uptimeSec: number;
  rssMB: number;
  heapUsedMB: number;
  /** Drift of the most recent lag sample (0 until the monitor runs). */
  eventLoopLagMs: number;
  /** Worst drift over the last 60 s — a recent stall stays visible after it ends. */
  eventLoopLagMaxMs: number;
  captcha: CaptchaHealth | null;
}

export interface CaptchaRuntime {
  stats(): CaptchaHealth;
  recycle(reason: string): void;
  shutdown(): void;
}

let captchaRuntime: CaptchaRuntime | null = null;

/** Called by captcha.ts at load; `null` unregisters (tests). */
export function registerCaptchaRuntime(runtime: CaptchaRuntime | null): void {
  captchaRuntime = runtime;
}

/** Recycle the captcha solver when the captcha module is loaded; no-op otherwise. */
export function requestCaptchaRecycle(reason: string): boolean {
  if (!captchaRuntime) return false;
  try {
    captchaRuntime.recycle(reason);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop the captcha pool and solver if any code path loaded the captcha
 * module (serve warmup, request handlers, claim scheduler); never loads it.
 */
export function shutdownCaptchaRuntime(): void {
  try {
    captchaRuntime?.shutdown();
  } catch {}
}

function captchaSnapshot(): CaptchaHealth | null {
  if (!captchaRuntime) return null;
  try {
    return captchaRuntime.stats();
  } catch {
    // A broken stats provider must not take /health down with it.
    return null;
  }
}

const MB = 1024 * 1024;

export interface LagMonitorOptions {
  intervalMs?: number;
  windowMs?: number;
  now?: () => number;
}

/**
 * Event-loop lag sampler: a timer scheduled every `intervalMs` measures how
 * late it fires. Lateness is time the loop spent unable to run callbacks —
 * exactly what makes /health and every request stall.
 */
export class EventLoopLagMonitor {
  private readonly intervalMs: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private expectedAt = 0;
  private lastLagMs = 0;
  private samples: Array<{ at: number; lagMs: number }> = [];

  constructor(opts: LagMonitorOptions = {}) {
    this.intervalMs = Math.max(1, opts.intervalMs ?? 500);
    this.windowMs = Math.max(this.intervalMs, opts.windowMs ?? 60_000);
    this.now = opts.now ?? (() => performance.now());
  }

  start(): void {
    if (this.timer) return;
    this.expectedAt = this.now() + this.intervalMs;
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    // Monitoring must never be the reason the process stays alive.
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One tick: exposed so tests can drive the sampler with a fake clock. */
  sample(): void {
    const at = this.now();
    const lagMs = Math.max(0, Math.round(at - this.expectedAt));
    this.expectedAt = at + this.intervalMs;
    this.lastLagMs = lagMs;
    this.samples.push({ at, lagMs });
    const cutoff = at - this.windowMs;
    while (this.samples.length > 0 && (this.samples[0]!.at < cutoff || this.samples.length > 120)) this.samples.shift();
  }

  lastMs(): number {
    return this.lastLagMs;
  }

  maxMs(): number {
    let max = 0;
    for (const s of this.samples) if (s.lagMs > max) max = s.lagMs;
    return max;
  }
}

let lagMonitor: EventLoopLagMonitor | null = null;

/** Start the process-wide lag sampler used by `/health` (idempotent). */
export function startEventLoopMonitor(opts: LagMonitorOptions = {}): EventLoopLagMonitor {
  if (!lagMonitor) {
    lagMonitor = new EventLoopLagMonitor(opts);
    lagMonitor.start();
  }
  return lagMonitor;
}

export function stopEventLoopMonitor(): void {
  lagMonitor?.stop();
  lagMonitor = null;
}

/** Snapshot for `/health` `details`. Synchronous and O(1) by design. */
export function healthDetails(): HealthDetails {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    rssMB: Math.round(mem.rss / MB),
    heapUsedMB: Math.round(mem.heapUsed / MB),
    eventLoopLagMs: lagMonitor?.lastMs() ?? 0,
    eventLoopLagMaxMs: lagMonitor?.maxMs() ?? 0,
    captcha: captchaSnapshot(),
  };
}

export interface MemoryGuardOptions {
  intervalMs?: number;
  /** RSS above which the captcha solver is recycled once per episode. */
  softLimitMB?: number;
  /** RSS that, sustained after a recycle, requests a process restart. */
  hardLimitMB?: number;
  /** Consecutive post-recycle samples above hardLimitMB before restarting. */
  hardSamples?: number;
  sampleRssMB?: () => number;
  recycle?: (reason: string) => void;
  /** True when the kit manager's respawn hook is available. */
  canRestart: () => boolean;
  /**
   * Hand the process over to the kit manager. Resolves true once the
   * manager is running (the process is then exiting); false when it could
   * not be started — the guard keeps serving and retries next episode.
   */
  restart: () => Promise<boolean>;
  log?: (line: string) => void;
}

/**
 * Memory guard. Solver worker recycling returns the solver's heap to the
 * process (spike: 469 → 54 MB), so the first response to growth is a
 * recycle. Only when RSS stays far above the ceiling after that — the growth
 * is elsewhere — does the proxy ask the kit manager for a restart. Without
 * the manager's hook there is nobody to bring the proxy back, so it only
 * logs: a standalone proxy at 3 GB still serves, a dead one does not.
 */
export class MemoryGuard {
  private readonly intervalMs: number;
  private readonly softLimitMB: number;
  private readonly hardLimitMB: number;
  private readonly hardSamples: number;
  private readonly sampleRssMB: () => number;
  private readonly recycle: (reason: string) => void;
  private readonly log: (line: string) => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private recycled = false;
  private hardStreak = 0;
  /** Restart in flight or handed over: no further samples act. */
  private restartPending = false;
  /** Once per episode: missing hook or failed hook launch was reported. */
  private gaveUpThisEpisode = false;

  constructor(private readonly opts: MemoryGuardOptions) {
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.softLimitMB = opts.softLimitMB ?? 1536;
    this.hardLimitMB = opts.hardLimitMB ?? 3072;
    this.hardSamples = Math.max(1, opts.hardSamples ?? 3);
    this.sampleRssMB = opts.sampleRssMB ?? (() => Math.round(process.memoryUsage.rss() / MB));
    this.recycle = opts.recycle ?? ((reason) => { requestCaptchaRecycle(reason); });
    this.log = opts.log ?? ((line) => console.error(line));
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  sample(): void {
    if (this.restartPending) return;
    const rss = this.sampleRssMB();
    if (rss <= this.softLimitMB) {
      // Episode over: a later climb earns a fresh recycle (and restart try).
      this.recycled = false;
      this.hardStreak = 0;
      this.gaveUpThisEpisode = false;
      return;
    }
    if (!this.recycled) {
      this.recycled = true;
      this.hardStreak = 0;
      this.log(`[memory] rss ${rss} MB above ${this.softLimitMB} MB — recycling captcha solver`);
      try { this.recycle("memory"); } catch {}
      return;
    }
    this.hardStreak = rss > this.hardLimitMB ? this.hardStreak + 1 : 0;
    if (this.hardStreak < this.hardSamples || this.gaveUpThisEpisode) return;
    if (!this.opts.canRestart()) {
      this.gaveUpThisEpisode = true;
      this.log(`[memory] rss ${rss} MB above ${this.hardLimitMB} MB — no kit manager respawn hook, not restarting`);
      return;
    }
    this.restartPending = true;
    this.log(`[memory] rss ${rss} MB — requesting restart`);
    const failed = () => {
      // Nobody would bring a stopped proxy back: keep serving at high RSS.
      this.restartPending = false;
      this.gaveUpThisEpisode = true;
      this.hardStreak = 0;
      this.log(`[memory] kit manager respawn hook did not start — not restarting, still serving`);
    };
    this.opts.restart().then((started) => {
      if (started) this.stop();
      else failed();
    }, failed);
  }
}
