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
 *
 * Shape (ADR-0002): the dispatcher is an object built by createCaptchaSolver()
 * over a SolverTransport, which starts solver generations and carries the
 * message protocol below unchanged. threadTransport() is the Bun Worker; the
 * module-level functions drive the proxy's own dispatcher over it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CaptchaSdkError, type CaptchaFailureCategory } from "./captcha-token.js";
import { SOLVER_PROCESS_COMMAND } from "./solver-process-command.js";

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
const DEFAULT_OPTIONS: Readonly<Required<CaptchaSolverOptions>> = Object.freeze({
  deadlineMs: 90_000,
  recycleAfterSolves: 200,
  recycleAfterFailures: 3,
  maxWorkerHeapMB: 768,
  idleMs: 10 * 60_000,
  backendModule: null,
});

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

/** Host → solver generation: the existing protocol (captcha-solver-worker.ts). */
export type SolverHostMessage =
  | { type: "init"; backendModule: string | null }
  | { type: "solve"; id: number; scene: string; region: string; prefix: string };

/** What one solver generation reports to the dispatcher. */
export interface SolverChannelEvents {
  /** A message from the generation; raw, the dispatcher validates it. */
  message(raw: unknown): void;
  /** The generation failed (thread transport: the Worker's "error" event). */
  error(): void;
  /** The generation ended without being terminated (thread transport: "close"). */
  exit(): void;
}

/** One solver generation, as the dispatcher drives it. */
export interface SolverChannel {
  post(message: SolverHostMessage): void;
  terminate(): void;
}

/**
 * Starts solver generations. Events reach the dispatcher asynchronously, never
 * from inside spawn() or post(); after terminate() they are ignored.
 */
export interface SolverTransport {
  spawn(events: SolverChannelEvents): SolverChannel;
}

// From source the worker sits next to this module; in a compiled binary
// import.meta.url is the executable inside the embedded root (the common
// directory of the entrypoints, src/), so the worker lives under ./proxy/.
const FROM_SOURCE = import.meta.url.endsWith("captcha-solver.ts");
const WORKER_URL = FROM_SOURCE
  ? new URL("./captcha-solver-worker.ts", import.meta.url)
  : new URL("./proxy/captcha-solver-worker.ts", import.meta.url);

/** The thread transport: each solver generation is a Bun Worker of this process. */
export function threadTransport(): SolverTransport {
  return {
    spawn(events) {
      const w = new Worker(WORKER_URL, { env: { ...process.env } } as WorkerOptions);
      // The host never stays alive for an idle solver; an in-flight solve is held
      // by its ref'd deadline timer instead.
      (w as Worker & { unref(): void }).unref(); // Bun runtime API missing from the Worker DOM type
      w.addEventListener("message", (event: MessageEvent) => events.message(event.data));
      w.addEventListener("error", () => events.error());
      w.addEventListener("close", () => events.exit());
      return {
        post: (message) => w.postMessage(message),
        terminate: () => w.terminate(),
      };
    },
  };
}

// Names the solver process never receives, in any case (Windows names are
// case-insensitive): the respawn chain's variables and this spawn's stop token
// belong to the proxy (ADR-0002, Round 3 Q3; ADR-0014), and the ambient proxy
// variables — the set lib/proxy-env.mjs strips — would route captcha egress
// past ZCODE_PROXY_UPSTREAM_PROXY (Round 19; Bun < 1.4.3 ignores `proxy: false`).
// Everything else passes as the worker got it: ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA,
// the CDN cache variables and ZCODE_PROXY_UPSTREAM_PROXY included.
const EXCLUDED_FROM_SOLVER_ENV: readonly RegExp[] = [
  /^ZCODE_KIT_RESPAWN_/i,
  /^ZCODE_KIT_STOP_TOKEN$/i,
  /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i,
  /^(?:npm|yarn|pnpm)_(?:http_proxy|https_proxy|all_proxy|no_proxy|proxy)$/i,
];

function solverProcessEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || EXCLUDED_FROM_SOLVER_ENV.some((pattern) => pattern.test(name))) continue;
    env[name] = value;
  }
  return env;
}

/**
 * argv of the solver process: from source the running Bun plus the solver
 * entry module; a compiled binary runs itself with the self-exec subcommand
 * (ADR-0002 condition 1; never `-e`). The parent pid is appended at spawn.
 */
export function solverProcessCommand(): string[] {
  return FROM_SOURCE
    ? [process.execPath, fileURLToPath(new URL("./captcha-solver-process.ts", import.meta.url))]
    : [process.execPath, SOLVER_PROCESS_COMMAND];
}

/** A child line longer than this is passed on in pieces rather than held. */
const MAX_RELAYED_LINE = 64 * 1024;

/**
 * Re-emits a child stream on the proxy's own stream, whole lines at a time,
 * bytes unchanged, so a child line never interleaves with a proxy line.
 * A line without its newline is held up to MAX_RELAYED_LINE bytes, then
 * written as it is; the rest is written when the stream ends.
 */
function relayLines(from: NodeJS.ReadableStream, to: NodeJS.WritableStream): void {
  let held: Buffer | null = null;
  from.on("data", (chunk: Buffer) => {
    const buf = held ? Buffer.concat([held, chunk]) : chunk;
    const end = buf.lastIndexOf(10) + 1;
    if (end > 0) to.write(buf.subarray(0, end));
    held = end < buf.length ? Buffer.from(buf.subarray(end)) : null;
    if (held && held.length >= MAX_RELAYED_LINE) {
      to.write(held);
      held = null;
    }
  });
  from.on("end", () => {
    if (held) to.write(held);
    held = null;
  });
}

export interface SolverProcessTransportOptions {
  /** argv of the solver process (default: solverProcessCommand()). */
  command?: readonly string[];
  /** How long an ended generation may take to exit after SIGTERM before it is killed. */
  graceMs?: number;
}

/** Default grace between SIGTERM and SIGKILL for an ended generation. */
export const SOLVER_EXIT_GRACE_MS = 2_000;

/**
 * The child-process adapter: each solver generation is a solver process
 * (ADR-0002). One generation at a time: a new process is spawned only after
 * the previous one has exited; until then (and until it has started) posts
 * are held. The 90 s deadline is armed by the dispatcher at dispatch, so a
 * cold start counts against it. The proxy never stays alive for an idle
 * solver process (unref); the in-flight solve's deadline timer holds it.
 */
export function solverProcessTransport(opts: SolverProcessTransportOptions = {}): SolverTransport {
  const graceMs = opts.graceMs ?? SOLVER_EXIT_GRACE_MS;
  // Settles when the latest generation's process has exited (or never started).
  let lastExit: Promise<void> = Promise.resolve();

  return {
    spawn(events) {
      const command = opts.command ?? solverProcessCommand();
      let child: ChildProcess | null = null;
      let ended = false;
      const held: SolverHostMessage[] = [];
      const { promise: exited, resolve: markExited } = Promise.withResolvers<void>();

      const start = () => {
        if (ended) { markExited(); return; }
        try {
          child = spawn(command[0]!, [...command.slice(1), String(process.pid)], {
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            serialization: "json",
            env: solverProcessEnv(process.env),
            windowsHide: true,
          });
        } catch {
          markExited();
          if (!ended) events.error();
          return;
        }
        const proc = child;
        proc.on("message", (raw) => { if (!ended) events.message(raw); });
        proc.on("error", () => {
          // A spawn failure has no process to wait for.
          if (proc.pid === undefined) markExited();
          if (!ended) events.error();
        });
        proc.on("exit", () => {
          markExited();
          if (!ended) events.exit();
        });
        relayLines(proc.stdout!, process.stdout);
        relayLines(proc.stderr!, process.stderr);
        proc.unref();
        // A process that failed at once reports through "error"/"exit".
        try { for (const message of held.splice(0)) proc.send(message); } catch {}
      };

      // Asynchronous in every case: events never come from inside spawn().
      const previous = lastExit;
      lastExit = exited;
      void previous.then(start);

      return {
        post(message) {
          if (child) child.send(message);
          else held.push(message);
        },
        terminate() {
          if (ended) return;
          ended = true;
          held.length = 0;
          const proc = child;
          if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
          try { proc.kill("SIGTERM"); } catch {}
          const kill = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, graceMs);
          kill.unref?.();
          void exited.then(() => clearTimeout(kill));
        },
      };
    },
  };
}

function solverError(category: CaptchaFailureCategory, message?: string): CaptchaSdkError {
  const err = new CaptchaSdkError(category);
  // The worker already redacted guest payloads; keep its diagnostic suffix
  // (stall timings, captchaMetadata, incompatible method types) for the log.
  if (message) err.message = message;
  return err;
}

/** The dispatcher interface, as the token pool, the captcha module and the health supervisor consume it. */
export interface CaptchaSolver {
  configure(opts: CaptchaSolverOptions): void;
  run(scene: string, region: string, prefix: string, beforeSolve?: () => void): Promise<string>;
  stats(): CaptchaSolverStats;
  /** Recycle: immediately when idle, otherwise right after the in-flight solve settles. */
  requestRecycle(reason: string): void;
  /** Never abandons a live or queued solve: the generation ends once the queue drains. */
  shutdown(): void;
  /** Fixed supported capacity, independent of historical daemon configuration. */
  concurrency(): number;
}

/** The dispatcher's timers (the per-solve deadline and the idle exit). */
export interface SolverClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

const realClock: SolverClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer as Timer),
};

export interface CaptchaSolverDeps {
  /** Default: the thread transport. */
  transport?: SolverTransport;
  /** Default: the runtime's timers. Tests inject a manual clock. */
  clock?: SolverClock;
}

/** A solver dispatcher that owns all of its state: queue, in-flight solve, generation, timers, stats. */
export function createCaptchaSolver(deps: CaptchaSolverDeps = {}): CaptchaSolver {
  const transport = deps.transport ?? threadTransport();
  const { setTimeout, clearTimeout } = deps.clock ?? realClock;
  const options: Required<CaptchaSolverOptions> = { ...DEFAULT_OPTIONS };

  const queue: Job[] = [];
  let inFlight: { job: Job; id: number; deadline: unknown } | null = null;
  let worker: SolverChannel | null = null;
  let idleTimer: unknown = null;
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

  function spawnWorker(): SolverChannel {
    let w: SolverChannel | null = null;
    w = transport.spawn({
      message(raw) {
        if (w !== worker) return; // a terminated generation must not settle anything
        const msg = parseWorkerMessage(raw);
        if (msg) onWorkerMessage(msg);
      },
      error() {
        if (w !== worker) return;
        console.error("[captcha-solver] worker error; recycling");
        failInFlight(solverError("other", "captcha solver worker failed"));
        recycle("fatal");
      },
      exit() {
        if (w !== worker) return; // terminated by us; already accounted
        failInFlight(solverError("other", "captcha solver worker exited unexpectedly"));
        recycle("exit");
      },
    });
    w.post({ type: "init", backendModule: options.backendModule });
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
    (idleTimer as { unref?: () => void }).unref?.();
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
        w.post({ type: "solve", id, scene: job.scene, region: job.region, prefix: job.prefix });
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

  return {
    configure(opts) {
      for (const [key, value] of Object.entries(opts)) {
        if (value !== undefined) (options as Record<string, unknown>)[key] = value;
      }
    },
    run(scene, region, prefix, beforeSolve) {
      if (BACKEND !== "happy") {
        return Promise.reject(new Error(`captcha backend "${BACKEND}" is not available; use ZCODE_CAPTCHA_BACKEND=happy`));
      }
      return new Promise<string>((resolve, reject) => {
        queue.push({ scene, region, prefix, beforeSolve, resolve, reject });
        pump();
      });
    },
    stats() {
      return {
        mode: "worker",
        alive: worker !== null,
        busy: inFlight !== null,
        queueDepth: queue.length,
        ...stats,
      };
    },
    requestRecycle(reason) {
      if (!worker) return;
      if (inFlight) pendingRecycle ??= reason;
      else recycle(reason);
    },
    shutdown() {
      shutdownRequested = true;
      armIdle();
    },
    concurrency() {
      return 1;
    },
  };
}

/** The proxy's solver dispatcher (thread transport). */
export const defaultCaptchaSolver: CaptchaSolver = createCaptchaSolver();

export function configureCaptchaSolver(opts: CaptchaSolverOptions): void {
  defaultCaptchaSolver.configure(opts);
}

export function runCaptchaSolve(
  scene: string,
  region: string,
  prefix: string,
  beforeSolve?: () => void,
): Promise<string> {
  return defaultCaptchaSolver.run(scene, region, prefix, beforeSolve);
}

export function getCaptchaSolverStats(): CaptchaSolverStats {
  return defaultCaptchaSolver.stats();
}

/** Recycle the solver worker: immediately when idle, otherwise right after the in-flight solve settles. */
export function requestCaptchaSolverRecycle(reason: string): void {
  defaultCaptchaSolver.requestRecycle(reason);
}

/** Never abandons a live or queued solve: the worker is terminated once the queue drains. */
export function shutdownCaptchaSolver(): void {
  defaultCaptchaSolver.shutdown();
}

/** Fixed supported capacity, independent of historical daemon configuration. */
export function captchaSolverConcurrency(): number {
  return defaultCaptchaSolver.concurrency();
}
