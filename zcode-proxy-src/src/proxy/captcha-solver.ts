/**
 * Solver dispatch — the happy-dom solver runs on a dedicated worker thread.
 *
 * Backend (ZCODE_CAPTCHA_BACKEND): "happy" (default) — captcha-happy.ts,
 * loaded inside captcha-solver-worker.ts. Guest sync XHR parks its thread in
 * Atomics.wait and guest DOM state accumulates, so running it on the HTTP
 * server's thread let one stuck solve freeze /health and every request (the
 * 2026-09-24 incident: 83 s stalls, 11 GB RSS). On the worker, the host loop
 * stays responsive, a solve that outlives its deadline is terminated, and
 * recycling the worker returns its heap.
 *
 * One solve at a time (happy-dom aliases process-global state inside the
 * worker); callers queue FIFO. `bun build --compile` must list
 * src/proxy/captcha-solver-worker.ts as an extra entrypoint.
 */
import { CaptchaSdkError, type CaptchaFailureCategory } from "./captcha-token.js";

const BACKEND = process.env.ZCODE_CAPTCHA_BACKEND?.trim().toLowerCase() || "happy";

export interface CaptchaSolverStats {
  mode: "worker";
  alive: boolean;              // a worker thread currently exists
  busy: boolean;               // a solve is in flight
  queueDepth: number;          // solves waiting behind the in-flight one
  generation: number;          // incremented on every worker spawn (0 = never spawned)
  solvesSinceSpawn: number;
  totalSolves: number;         // completed with a token
  totalFailures: number;
  consecutiveFailures: number;
  deadlineKills: number;       // workers terminated for exceeding the hard per-solve deadline
  recycles: number;            // workers terminated for any reason (deadline, failures, quota, idle, request, fatal)
  lastRecycleReason: string | null;
  lastRecycleAt: number | null; // epoch ms
  /** SDK bundle fingerprints of the latest attempt: known basenames or opaque ids + sha256 only. */
  lastSdkScripts: ReadonlyArray<CaptchaSdkScript> | null;
}

export interface CaptchaSdkScript {
  readonly filename: string;
  readonly sha256: string | null;
}

export interface CaptchaSolverOptions {
  /** Hard per-solve deadline; the worker is terminated when exceeded. */
  deadlineMs?: number;
  recycleAfterSolves?: number;
  recycleAfterFailures?: number;
  /** Worker heap (JSC heapUsed, measured inside the worker after each solve). */
  maxWorkerHeapMB?: number;
  idleMs?: number;
  /** Test fixtures only: module the worker loads instead of captcha-happy. */
  backendModule?: string | null;
}

// Defaults must stand on their own: the kit manager strips CAPTCHA_* and
// ZCODE_CAPTCHA_* variables before spawning the proxy. The happy solver's own
// budget is ~30 s wait + ~30 s solve; 90 s only catches a thread that is stuck.
const options: Required<CaptchaSolverOptions> = {
  deadlineMs: 90_000,
  recycleAfterSolves: 200,
  recycleAfterFailures: 3,
  maxWorkerHeapMB: 768,
  idleMs: 10 * 60_000,
  backendModule: null,
};

export function configureCaptchaSolver(opts: CaptchaSolverOptions): void {
  for (const [key, value] of Object.entries(opts)) {
    if (value !== undefined) (options as Record<string, unknown>)[key] = value;
  }
}

interface Job {
  scene: string;
  region: string;
  prefix: string;
  beforeSolve?: () => void;
  resolve: (param: string) => void;
  reject: (err: Error) => void;
}

type WorkerMessage =
  | { type: "result"; id: number; ok: true; param: string; heapUsedMB: number | null;
      scripts: ReadonlyArray<CaptchaSdkScript> | null }
  | { type: "result"; id: number; ok: false; category: CaptchaFailureCategory; message: string;
      heapUsedMB: number | null; scripts: ReadonlyArray<CaptchaSdkScript> | null }
  | { type: "fatal"; name: string };

const CATEGORIES: ReadonlySet<string> = new Set<CaptchaFailureCategory>(["rate-limit", "duplicate", "other", "incompatible"]);
// Failure messages carry the solver's diagnostic suffix (stall timings,
// captchaMetadata hashes) into the pool's log line; bound them.
const MAX_FAILURE_MESSAGE = 4096;

/** The worker runs guest code: validate everything that crosses the thread boundary. */
function parseWorkerMessage(raw: unknown): WorkerMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  if (m.type === "fatal") {
    return { type: "fatal", name: typeof m.name === "string" && /^\w{1,40}$/.test(m.name) ? m.name : "Error" };
  }
  if (m.type !== "result" || typeof m.id !== "number" || !Number.isSafeInteger(m.id)) return null;
  const heapUsedMB = typeof m.heapUsedMB === "number" && Number.isFinite(m.heapUsedMB) ? m.heapUsedMB : null;
  // Health output: only short resource ids and hex digests survive.
  const scripts = Array.isArray(m.scripts)
    ? Object.freeze(m.scripts.slice(0, 16).map((script: { filename?: unknown; sha256?: unknown } | null) => Object.freeze({
        filename: typeof script?.filename === "string" && /^[\w.-]{1,64}$/.test(script.filename) ? script.filename : "unknown",
        sha256: typeof script?.sha256 === "string" && /^[0-9a-f]{64}$/.test(script.sha256) ? script.sha256 : null,
      })))
    : null;
  if (m.ok === true) {
    let valid = false;
    if (typeof m.param === "string" && m.param.length >= 200 && m.param.length <= 16_384 && /^[A-Za-z0-9+/]+={0,2}$/.test(m.param)) {
      try {
        const token: unknown = JSON.parse(Buffer.from(m.param, "base64").toString("utf8"));
        valid = !!token && typeof token === "object"
          && "certifyId" in token && typeof token.certifyId === "string" && token.certifyId.length > 0
          && "sceneId" in token && typeof token.sceneId === "string" && token.sceneId.length > 0
          && "isSign" in token && typeof token.isSign === "boolean"
          && (("securityToken" in token && typeof token.securityToken === "string" && token.securityToken.length >= 50)
            || ("SecurityToken" in token && typeof token.SecurityToken === "string" && token.SecurityToken.length >= 50));
      } catch { /* malformed token */ }
    }
    if (!valid) return { type: "result", id: m.id, ok: false, category: "other", message: "captcha solver returned invalid token", heapUsedMB, scripts: null };
    return { type: "result", id: m.id, ok: true, param: String(m.param), heapUsedMB, scripts };
  }
  const error = (m.error && typeof m.error === "object" ? m.error : {}) as Record<string, unknown>;
  return {
    type: "result", id: m.id, ok: false, heapUsedMB, scripts,
    category: typeof error.category === "string" && CATEGORIES.has(error.category)
      ? error.category as CaptchaFailureCategory : "other",
    message: typeof error.message === "string" && error.message
      ? error.message.slice(0, MAX_FAILURE_MESSAGE) : "captcha solver failure",
  };
}

const queue: Job[] = [];
let inFlight: { job: Job; id: number; deadline: Timer } | null = null;
let worker: Worker | null = null;
let idleTimer: Timer | null = null;
let pendingRecycle: string | null = null;
let shutdownRequested = false;
let nextId = 0;
// Consecutive failures of the current generation (the stat spans generations).
let generationFailures = 0;

const stats: Omit<CaptchaSolverStats, "mode" | "alive" | "busy" | "queueDepth"> = {
  generation: 0,
  solvesSinceSpawn: 0,
  totalSolves: 0,
  totalFailures: 0,
  consecutiveFailures: 0,
  deadlineKills: 0,
  recycles: 0,
  lastRecycleReason: null,
  lastRecycleAt: null,
  lastSdkScripts: null,
};

// From source the worker sits next to this module; in a compiled binary
// import.meta.url is the executable inside the embedded root (the common
// directory of the entrypoints, src/), so the worker lives under ./proxy/.
const WORKER_URL = import.meta.url.endsWith("captcha-solver.ts")
  ? new URL("./captcha-solver-worker.ts", import.meta.url)
  : new URL("./proxy/captcha-solver-worker.ts", import.meta.url);

function solverError(category: CaptchaFailureCategory, message?: string): CaptchaSdkError {
  const err = new CaptchaSdkError(category);
  // The worker already redacted guest payloads; keep its diagnostic suffix
  // (stall timings, captchaMetadata, incompatible method types) for the log.
  if (message) err.message = message;
  return err;
}

function spawnWorker(): Worker {
  const w = new Worker(WORKER_URL, { env: { ...process.env } } as WorkerOptions);
  // The host never stays alive for an idle solver; an in-flight solve is held
  // by its ref'd deadline timer instead.
  (w as Worker & { unref(): void }).unref(); // Bun runtime API missing from the Worker DOM type
  w.addEventListener("message", (event: MessageEvent) => {
    if (w !== worker) return; // a terminated generation must not settle anything
    const msg = parseWorkerMessage(event.data);
    if (msg) onWorkerMessage(msg);
  });
  w.addEventListener("error", () => {
    if (w !== worker) return;
    console.error("[captcha-solver] worker error; recycling");
    failInFlight(solverError("other", "captcha solver worker failed"));
    recycle("fatal");
  });
  w.addEventListener("close", () => {
    if (w !== worker) return; // terminated by us; already accounted
    failInFlight(solverError("other", "captcha solver worker exited unexpectedly"));
    recycle("exit");
  });
  w.postMessage({ type: "init", backendModule: options.backendModule });
  worker = w;
  stats.generation += 1;
  stats.solvesSinceSpawn = 0;
  generationFailures = 0;
  return w;
}

function recycle(reason: string): void {
  const w = worker;
  worker = null;
  pendingRecycle = null;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (!w) return;
  try { w.terminate(); } catch {}
  stats.recycles += 1;
  stats.lastRecycleReason = reason;
  stats.lastRecycleAt = Date.now();
}

function failInFlight(err: Error): void {
  const current = inFlight;
  if (!current) return;
  inFlight = null;
  clearTimeout(current.deadline);
  stats.totalFailures += 1;
  stats.consecutiveFailures += 1;
  current.job.reject(err);
  queueMicrotask(pump);
}

function onWorkerMessage(msg: WorkerMessage): void {
  if (msg.type === "fatal") {
    console.error(`[captcha-solver] worker fault (${msg.name}); recycling`);
    failInFlight(solverError("other", "captcha solver worker fault"));
    recycle("fatal");
    return;
  }
  const current = inFlight;
  if (!current || msg.id !== current.id) return;
  inFlight = null;
  clearTimeout(current.deadline);
  stats.solvesSinceSpawn += 1;
  if (msg.scripts) stats.lastSdkScripts = msg.scripts;

  let reason: string | null = pendingRecycle;
  if (shutdownRequested && queue.length === 0) {
    shutdownRequested = false;
    reason = "shutdown";
  }
  if (msg.ok) {
    stats.totalSolves += 1;
    stats.consecutiveFailures = 0;
    generationFailures = 0;
    current.job.resolve(msg.param);
  } else {
    stats.totalFailures += 1;
    stats.consecutiveFailures += 1;
    generationFailures += 1;
    // A failed DOM close quarantines that worker's runtime for good; a fresh
    // generation is the only way back.
    if (/cleanup failed/.test(msg.message)) reason ??= "cleanup";
    if (msg.message === "captcha solver returned invalid token") reason ??= "invalid-result";
    if (generationFailures >= options.recycleAfterFailures) reason ??= "failures";
    current.job.reject(solverError(msg.category, msg.message));
  }
  if (stats.solvesSinceSpawn >= options.recycleAfterSolves) reason ??= "solves";
  // heapUsed inside a Bun worker is that worker's own JSC heap (verified: a
  // 150 MB worker allocation leaves the host's figure unchanged).
  if (msg.heapUsedMB !== null && msg.heapUsedMB > options.maxWorkerHeapMB) reason ??= "heap";
  if (reason) recycle(reason);
  // Let the caller record a provider cooldown before admitting queued work.
  queueMicrotask(pump);
}

function onDeadline(id: number): void {
  if (!inFlight || inFlight.id !== id) return;
  stats.deadlineKills += 1;
  // Terminate first: the stuck thread must not deliver a late result.
  recycle("deadline");
  failInFlight(solverError("other", "captcha solver deadline exceeded"));
}

function armIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (inFlight || queue.length) return;
  if (shutdownRequested) {
    shutdownRequested = false;
    recycle("shutdown");
    return;
  }
  if (!worker) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!inFlight && !queue.length) recycle("idle");
  }, options.idleMs);
  idleTimer.unref?.();
}

function pump(): void {
  while (!inFlight && queue.length) {
    const job = queue.shift()!;
    try {
      // A provider pause may have started while this request waited in the queue.
      job.beforeSolve?.();
    } catch (err) {
      job.reject(err instanceof Error ? err : new Error(String(err)));
      continue;
    }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    const id = ++nextId;
    try {
      const w = worker ?? spawnWorker();
      inFlight = { job, id, deadline: setTimeout(() => onDeadline(id), options.deadlineMs) };
      w.postMessage({ type: "solve", id, scene: job.scene, region: job.region, prefix: job.prefix });
    } catch {
      // Spawn or dispatch failed: this job fails now, the next gets a fresh worker.
      if (inFlight?.id === id) {
        clearTimeout(inFlight.deadline);
        inFlight = null;
      }
      stats.totalFailures += 1;
      stats.consecutiveFailures += 1;
      recycle("spawn");
      job.reject(solverError("other", "captcha solver worker unavailable"));
    }
  }
  armIdle();
}

export function runCaptchaSolve(
  scene: string,
  region: string,
  prefix: string,
  beforeSolve?: () => void,
): Promise<string> {
  if (BACKEND !== "happy") {
    return Promise.reject(new Error(`captcha backend "${BACKEND}" is not available; use ZCODE_CAPTCHA_BACKEND=happy`));
  }
  return new Promise<string>((resolve, reject) => {
    queue.push({ scene, region, prefix, beforeSolve, resolve, reject });
    pump();
  });
}

export function getCaptchaSolverStats(): CaptchaSolverStats {
  return {
    mode: "worker",
    alive: worker !== null,
    busy: inFlight !== null,
    queueDepth: queue.length,
    ...stats,
  };
}

/** Recycle the solver worker: immediately when idle, otherwise right after the in-flight solve settles. */
export function requestCaptchaSolverRecycle(reason: string): void {
  if (!worker) return;
  if (inFlight) pendingRecycle ??= reason;
  else recycle(reason);
}

/** Never abandons a live or queued solve: the worker is terminated once the queue drains. */
export function shutdownCaptchaSolver(): void {
  shutdownRequested = true;
  armIdle();
}

/** Fixed supported capacity, independent of historical daemon configuration. */
export function captchaSolverConcurrency(): number {
  return 1;
}
