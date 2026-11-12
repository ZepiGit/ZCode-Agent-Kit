/**
 * Solver dispatch — the happy-dom solver runs in the solver process, a child
 * OS process of the proxy.
 *
 * Backend (ZCODE_CAPTCHA_BACKEND): "happy" (default) — captcha-happy.ts,
 * loaded inside the solver generation (captcha-solver-generation.ts). Guest
 * sync XHR parks its thread in Atomics.wait and guest DOM state accumulates,
 * so running it on the HTTP server's thread let one stuck solve freeze /health
 * and every request (the 2026-09-24 incident: 83 s stalls, 11 GB RSS). Out of
 * the proxy's thread, the host loop stays responsive, a solve that outlives
 * its deadline is ended with its generation, and a recycle returns its memory.
 *
 * One solve at a time (happy-dom aliases process-global state inside the
 * generation); callers queue FIFO. `bun build --compile` must list
 * src/proxy/captcha-solver-worker.ts as an extra entrypoint (thread transport);
 * a compiled proxy starts the solver process by self-exec (index.ts).
 *
 * Shape: the dispatcher is an object built by createCaptchaSolver
 * over a SolverTransport, which starts solver generations and carries the
 * message protocol unchanged. solverProcessTransport() (the default) is the
 * child-process adapter; threadTransport() is the Bun Worker, kept for tests
 * and as a fallback. The module-level functions drive the proxy's own
 * dispatcher over the solver process.
 *
 * Memory: the solver process runs under a cap the operating system enforces
 * where it can (solver-cap.ts). After each solve it reports its footprint;
 * at 80 % of the cap, or after 100 solves, the generation is recycled.
 *
 * Failure: a generation that ends abnormally (crash, kill at the cap, fatal
 * error, deadline kill) fails only the solve in flight. More than 5 such
 * exits in 10 minutes start the fail-fast window: until the oldest of them is
 * 10 minutes old no generation is started and solves are refused with
 * CaptchaSolverUnavailableError, as is a solve that would be the 65th to
 * wait. The HTTP handlers answer those with 503 + Retry-After.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CaptchaSdkError, CaptchaSolverUnavailableError, captchaFailureFromTransport,
  type CaptchaFailureCategory, type SolverUnavailableReason,
} from "./captcha-token.js";
import { createEventLogger } from "../log/event-line.mjs";
import {
  NO_SOLVER_CAP, SOLVER_CAP_KEY, applySolverCap, configuredSolverCapMB,
  type SolverCap, type SolverEnforcement,
} from "./solver-cap.js";
import { SOLVER_PROCESS_COMMAND } from "./solver-process-command.js";

const BACKEND = process.env.ZCODE_CAPTCHA_BACKEND?.trim().toLowerCase() || "happy";

export interface CaptchaSolverStats {
  mode: "worker";
  alive: boolean;              // a solver generation currently exists
  busy: boolean;               // a solve is in flight
  queueDepth: number;          // solves waiting behind the in-flight one
  generation: number;          // incremented on every generation start (0 = never started)
  solvesSinceSpawn: number;
  totalSolves: number;         // completed with a token
  totalFailures: number;
  consecutiveFailures: number;
  deadlineKills: number;       // generations ended for exceeding the hard per-solve deadline
  recycles: number;            // generations ended for any reason (footprint, solves, failures, idle, request, deadline, exit, fatal)
  lastRecycleReason: string | null;
  lastRecycleAt: number | null; // epoch ms
  /** SDK bundle fingerprints of the latest attempt: known basenames or opaque ids + sha256 only. */
  lastSdkScripts: ReadonlyArray<CaptchaSdkScript> | null;
  /** The solver's memory cap in MB; null when its generations run without one (the thread transport). */
  capMB: number | null;
  /**
   * How the cap is enforced: by the operating system (`job-object`, `cgroup`),
   * by the solver process measuring itself (`sampling`), or not at all
   * (`none`). Null until the first solver process has been capped.
   */
  enforcement: SolverEnforcement | null;
  /** The solver process's own memory footprint after its latest solve, in MB; null on the thread transport. */
  lastFootprintMB: number | null;
  /** Abnormal exits (crash, kill at the cap, fatal error, deadline kill) within the last 10 minutes. */
  abnormalExits: number;
  /** Solves are refused because the abnormal exits used up the restart budget. */
  failFast: boolean;
  /** When the fail-fast window ends (epoch ms); null outside it. */
  failFastUntil: number | null;
  /** Solves refused without running since start (fail-fast window or full queue). */
  shedSolves: number;
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
  /**
   * Heap of a generation that runs without a memory cap (the thread
   * transport; JSC heapUsed, measured inside the worker after each solve). A
   * capped generation is recycled on its footprint instead.
   */
  maxWorkerHeapMB?: number;
  idleMs?: number;
  /** Solves that may wait behind the one in flight; a further one is refused. */
  maxQueuedSolves?: number;
  /** Test fixtures only: module the worker loads instead of captcha-happy. */
  backendModule?: string | null;
}

// Defaults must stand on their own: the kit manager strips CAPTCHA_* and
// ZCODE_CAPTCHA_* variables before spawning the proxy. The happy solver's own
// budget is ~30 s wait + ~30 s solve; 90 s only catches a thread that is stuck.
const DEFAULT_OPTIONS: Readonly<Required<CaptchaSolverOptions>> = Object.freeze({
  deadlineMs: 90_000,
  // Only a backstop: a capped generation is recycled on its footprint first.
  recycleAfterSolves: 100,
  recycleAfterFailures: 3,
  maxWorkerHeapMB: 768,
  idleMs: 10 * 60_000,
  maxQueuedSolves: 64,
  backendModule: null,
});

/** A capped generation is recycled once its footprint after a solve reaches this share of the cap. */
export const FOOTPRINT_RECYCLE_SHARE = 0.8;
/** Abnormal exits the solver may have inside ABNORMAL_EXIT_WINDOW_MS; one more and solves fail fast. */
export const MAX_ABNORMAL_EXITS = 5;
export const ABNORMAL_EXIT_WINDOW_MS = 10 * 60_000;
/** `Retry-After` of a solve refused because the queue is full (the admission shed's value). */
export const QUEUE_FULL_RETRY_AFTER_MS = 2_000;

interface Job {
  scene: string;
  region: string;
  prefix: string;
  beforeSolve?: () => void;
  resolve: (param: string) => void;
  reject: (err: Error) => void;
}

type WorkerMessage =
  | { type: "result"; id: number; ok: true; param: string; heapUsedMB: number | null; footprintMB: number | null;
      scripts: ReadonlyArray<CaptchaSdkScript> | null }
  | { type: "result"; id: number; ok: false; category: CaptchaFailureCategory; message: string;
      heapUsedMB: number | null; footprintMB: number | null; scripts: ReadonlyArray<CaptchaSdkScript> | null }
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
  const footprintMB = typeof m.footprintMB === "number" && Number.isFinite(m.footprintMB) && m.footprintMB >= 0 ? m.footprintMB : null;
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
    if (!valid) return { type: "result", id: m.id, ok: false, category: "other", message: "captcha solver returned invalid token", heapUsedMB, footprintMB, scripts: null };
    return { type: "result", id: m.id, ok: true, param: String(m.param), heapUsedMB, footprintMB, scripts };
  }
  const error = (m.error && typeof m.error === "object" ? m.error : {}) as Record<string, unknown>;
  return {
    type: "result", id: m.id, ok: false, heapUsedMB, footprintMB, scripts,
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
  /** The memory cap of its generations; a transport without the method runs them uncapped. */
  cap?(): SolverCapState;
}

// From source the worker sits next to this module; in a compiled binary
// import.meta.url is the executable inside the embedded root (the common
// directory of the entrypoints, src/), so the worker lives under ./proxy/.
const FROM_SOURCE = import.meta.url.endsWith("captcha-solver.ts");
const WORKER_URL = FROM_SOURCE
  ? new URL("./captcha-solver-worker.ts", import.meta.url)
  : new URL("./proxy/captcha-solver-worker.ts", import.meta.url);

const NEWLINE = Buffer.from("\n");

/** What one solver generation may write to the proxy's output: lines, bytes, and bytes per line. */
export const SOLVER_OUTPUT_LIMITS = Object.freeze({ lines: 200, bytes: 64 * 1024, lineBytes: 2 * 1024 });

/** The output allowance of one solver generation, shared by its stdout and stderr. */
interface OutputBudget { lines: number; bytes: number; dropped: number }

/** `line` cut to the per-line limit, on a character boundary. */
function cutLine(line: Buffer): Buffer {
  if (line.length <= SOLVER_OUTPUT_LIMITS.lineBytes) return line;
  let end = SOLVER_OUTPUT_LIMITS.lineBytes;
  while (end > 0 && (line[end]! & 0xc0) === 0x80) end -= 1;
  return line.subarray(0, end);
}

/** Writes one solver line to `to` within the generation's allowance, or counts it as dropped. */
function writeBounded(line: Buffer, terminated: boolean, to: NodeJS.WritableStream, budget: OutputBudget): void {
  const shown = cutLine(line);
  const size = shown.length + (terminated ? 1 : 0);
  if (budget.lines >= SOLVER_OUTPUT_LIMITS.lines || budget.bytes + size > SOLVER_OUTPUT_LIMITS.bytes) {
    budget.dropped += 1;
    return;
  }
  budget.lines += 1;
  budget.bytes += size;
  to.write(terminated ? Buffer.concat([shown, NEWLINE]) : shown);
}

const DROPPED_OUTPUT = "solver wrote more output than one generation may; further lines were dropped";
const droppedFields = (budget: OutputBudget) => ({
  droppedLines: budget.dropped, limitLines: SOLVER_OUTPUT_LIMITS.lines, limitKiB: SOLVER_OUTPUT_LIMITS.bytes / 1024,
});

/**
 * Re-emits a child stream on the proxy's own stream (process.stdout or
 * process.stderr, looked up at every write: a managed proxy routes both
 * through its proxy.log writer, which rotates the file and masks secrets).
 * Whole lines at a time, so a child line never interleaves with a proxy line;
 * a line without its newline is held until the newline or the stream's end.
 * Bounded per solver process: a line is cut at 2 KiB, and past 200 lines or
 * 64 KiB further lines are counted in `budget.dropped` instead of written.
 */
function relayLines(from: NodeJS.ReadableStream, to: () => NodeJS.WritableStream, budget: OutputBudget): void {
  let held: Buffer | null = null;
  // The held line is already over the per-line limit: the rest of it is skipped.
  let overlong = false;
  const emit = (line: Buffer, terminated: boolean): void => writeBounded(line, terminated, to(), budget);
  from.on("data", (chunk: Buffer) => {
    let buf = held ? Buffer.concat([held, chunk]) : chunk;
    held = null;
    for (let end = buf.indexOf(10); end >= 0; end = buf.indexOf(10)) {
      if (overlong) overlong = false;
      else emit(buf.subarray(0, end), true);
      buf = buf.subarray(end + 1);
    }
    if (overlong || buf.length === 0) return;
    if (buf.length > SOLVER_OUTPUT_LIMITS.lineBytes) {
      // Longer than a line may be: its start is written now, the rest is skipped.
      emit(buf, true);
      overlong = true;
    } else {
      held = Buffer.from(buf);
    }
  });
  from.on("end", () => {
    if (held) emit(held, false);
    held = null;
  });
}

/** The thread transport: each solver generation is a Bun Worker of this process. */
export function threadTransport(opts: { writeLog?: (line: string) => void } = {}): SolverTransport {
  const log = createEventLogger({ component: "solver", ...(opts.writeLog ? { write: opts.writeLog } : {}) });
  return {
    // A thread shares the proxy's memory: nothing can cap it.
    cap: () => ({ capMB: null, enforcement: "none" }),
    spawn(events) {
      const w = new Worker(WORKER_URL, { env: solverEnv() } as WorkerOptions);
      // The host never stays alive for an idle solver; an in-flight solve is held
      // by its ref'd deadline timer instead.
      (w as Worker & { unref(): void }).unref(); // Bun runtime API missing from the Worker DOM type
      // The thread's diagnostic lines arrive as messages and are written to
      // the proxy's stderr here, within the same allowance as a solver process.
      const output: OutputBudget = { lines: 0, bytes: 0, dropped: 0 };
      const sayDropped = (): void => {
        if (output.dropped > 0) log.warn(DROPPED_OUTPUT, droppedFields(output));
        output.dropped = 0;
      };
      w.addEventListener("message", (event: MessageEvent) => {
        const data = event.data as { type?: unknown; text?: unknown } | null;
        if (data?.type !== "log") { events.message(event.data); return; }
        if (typeof data.text !== "string") return;
        const lines = data.text.split("\n");
        const tail = lines.pop()!;
        for (const line of lines) writeBounded(Buffer.from(line), true, process.stderr, output);
        if (tail) writeBounded(Buffer.from(tail), false, process.stderr, output);
      });
      w.addEventListener("error", () => events.error());
      w.addEventListener("close", () => { sayDropped(); events.exit(); });
      return {
        post: (message) => w.postMessage(message),
        terminate: () => { sayDropped(); w.terminate(); },
      };
    },
  };
}

// Names a solver generation never receives, on either transport, in any case
// (Windows names are case-insensitive). The solver runs the vendor's code and
// needs none of them:
// - the respawn chain's variables and this spawn's stop token belong to the
//   proxy;
// - the ambient proxy variables — the set lib/proxy-env.mjs strips — would
//   route captcha egress past ZCODE_PROXY_UPSTREAM_PROXY (Bun < 1.4.3 ignores
//   `proxy: false`);
// - the proxy's credentials and keys, and where it keeps them.
// Everything else passes: ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA, the CAPTCHA_*
// variables and ZCODE_PROXY_UPSTREAM_PROXY, which the solver code reads,
// included.
const EXCLUDED_FROM_SOLVER_ENV: readonly RegExp[] = [
  /^ZCODE_KIT_RESPAWN_/i,
  /^ZCODE_KIT_STOP_TOKEN$/i,
  /^(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/i,
  /^(?:npm|yarn|pnpm)_(?:http_proxy|https_proxy|all_proxy|no_proxy|proxy)$/i,
  /^ZCODE_PROXY_(?:CREDENTIAL_SECRET|CREDENTIAL_MASTER_KEY|MASTER_KEY|API_KEY|CREDENTIALS_PATH|ACCOUNTS_PATH)$/i,
  /^ZCODE_CREDENTIAL_SECRET$/i,
  /^ZCODE_CONTROL_CAPABILITY$/i,
];

/** The environment of a solver generation: `source` without the names above. */
export function solverEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
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
 * (never `-e`). The parent pid is appended at spawn.
 */
export function solverProcessCommand(): string[] {
  return FROM_SOURCE
    ? [process.execPath, fileURLToPath(new URL("./captcha-solver-process.ts", import.meta.url))]
    : [process.execPath, SOLVER_PROCESS_COMMAND];
}

/** The memory cap of the solver, as the transport last applied it. */
export interface SolverCapState {
  /** The cap in MB; null when the generations run without one. */
  capMB: number | null;
  /** How the cap is enforced; null until the first solver process has been capped. */
  enforcement: SolverEnforcement | null;
}

export interface SolverProcessTransportOptions {
  /** argv of the solver process (default: solverProcessCommand()). */
  command?: readonly string[];
  /** How long an ended generation may take to exit after SIGTERM before it is killed. */
  graceMs?: number;
  /** The memory cap of each solver process in MB, or null for none (default: the configured cap). */
  capMB?: number | null | (() => number | null);
  /** Applies the cap to a started solver process (default: the operating system, applySolverCap). */
  applyCap?: (pid: number, capBytes: number) => Promise<SolverCap>;
  /** Sink of the transport's event lines (default: the console). */
  writeLog?: (line: string) => void;
}

/** Default grace between SIGTERM and SIGKILL for an ended generation. */
export const SOLVER_EXIT_GRACE_MS = 2_000;

/**
 * The child-process adapter: each solver generation is a solver process
 * of its own. One generation at a time: a new process is spawned only after
 * the previous one has exited; until then (and until it has started) posts
 * are held. The 90 s deadline is armed by the dispatcher at dispatch, so a
 * cold start counts against it. The proxy never stays alive for an idle
 * solver process (unref); the in-flight solve's deadline timer holds it.
 *
 * Cap before work: a started process says `hello` and nothing else is sent to
 * it until its memory cap has been applied and acknowledged (`cap`). The
 * process loads nothing heavy before that and ends itself when the
 * acknowledgement does not come. A process the operating system ends at the
 * cap is reported with one event line that names the config key.
 */
export function solverProcessTransport(opts: SolverProcessTransportOptions = {}): SolverTransport {
  const graceMs = opts.graceMs ?? SOLVER_EXIT_GRACE_MS;
  const applyCap = opts.applyCap ?? ((pid: number, capBytes: number) => applySolverCap(pid, capBytes));
  const configuredCap = (): number | null => {
    const cap = opts.capMB === undefined ? configuredSolverCapMB() : typeof opts.capMB === "function" ? opts.capMB() : opts.capMB;
    return typeof cap === "number" && cap > 0 ? cap : null;
  };
  const log = createEventLogger({ component: "solver", ...(opts.writeLog ? { write: opts.writeLog } : {}) });
  // Settles when the latest generation's process has exited (or never started).
  let lastExit: Promise<void> = Promise.resolve();
  let capState: SolverCapState = { capMB: configuredCap(), enforcement: null };
  let saidWhyNotEnforced = false;

  return {
    cap: () => ({ ...capState }),
    spawn(events) {
      const command = opts.command ?? solverProcessCommand();
      let child: ChildProcess | null = null;
      let ended = false;
      // The cap acknowledgement has been sent: the process may be given work.
      let acknowledged = false;
      let greeted = false;
      let cap: SolverCap | null = null;
      const held: SolverHostMessage[] = [];
      const { promise: exited, resolve: markExited } = Promise.withResolvers<void>();

      const acknowledge = async (proc: ChildProcess): Promise<void> => {
        const capMB = configuredCap();
        const applied = capMB === null || proc.pid === undefined ? NO_SOLVER_CAP
          : await applyCap(proc.pid, capMB * 1024 * 1024).catch((): SolverCap => ({
              enforcement: "sampling", reason: "the memory cap could not be applied",
              endedAtCap: () => Promise.resolve(false), release: () => {},
            }));
        if (ended || proc.exitCode !== null || proc.signalCode !== null) { applied.release(); return; }
        cap = applied;
        capState = { capMB, enforcement: applied.enforcement };
        if (applied.enforcement === "sampling" && !applied.designed && !saidWhyNotEnforced) {
          saidWhyNotEnforced = true;
          log.warn("the operating system does not enforce the solver's memory cap; the solver process measures itself and ends at the cap", {
            capMB, enforcement: "sampling", why: applied.reason,
          });
        }
        // A process that died meanwhile reports through "exit".
        try {
          proc.send({ type: "cap", enforcement: applied.enforcement, capMB });
          acknowledged = true;
          for (const message of held.splice(0)) proc.send(message);
        } catch {}
      };

      const start = () => {
        if (ended) { markExited(); return; }
        try {
          child = spawn(command[0]!, [...command.slice(1), String(process.pid)], {
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            serialization: "json",
            env: solverEnv(),
            windowsHide: true,
          });
        } catch {
          markExited();
          if (!ended) events.error();
          return;
        }
        const proc = child;
        proc.on("message", (raw) => {
          if (ended) return;
          if (acknowledged) { events.message(raw); return; }
          // Before the acknowledgement only the greeting counts.
          if (!greeted && (raw as { type?: unknown } | null)?.type === "hello") {
            greeted = true;
            void acknowledge(proc);
          }
        });
        proc.on("error", () => {
          // A spawn failure has no process to wait for.
          if (proc.pid === undefined) markExited();
          if (!ended) events.error();
        });
        proc.on("exit", (_code, signal) => {
          markExited();
          const unexpected = !ended;
          if (unexpected) events.exit();
          const applied = cap;
          if (!applied) return;
          // The operating system ends a process at its cap with SIGKILL (Linux)
          // or lets its allocation fail (Windows); ask only then.
          const ask = unexpected || signal === "SIGKILL" ? applied.endedAtCap() : Promise.resolve(false);
          void ask.then((atCap) => {
            if (atCap && unexpected) {
              log.warn("solver process ended by the operating system at its memory cap", {
                capMB: capState.capMB, enforcement: applied.enforcement, key: SOLVER_CAP_KEY,
                next: `raise ${SOLVER_CAP_KEY} in the proxy's config.yaml if solves need more memory`,
              });
            }
          }, () => {}).finally(() => applied.release());
        });
        const output: OutputBudget = { lines: 0, bytes: 0, dropped: 0 };
        relayLines(proc.stdout!, () => process.stdout, output);
        relayLines(proc.stderr!, () => process.stderr, output);
        // Both streams have ended: say once what the limits kept out.
        proc.on("close", () => {
          if (output.dropped > 0) log.warn(DROPPED_OUTPUT, droppedFields(output));
        });
        // Neither the process nor its relayed pipes may hold the proxy open.
        proc.unref();
        for (const pipe of [proc.stdout, proc.stderr]) (pipe as { unref?: () => void } | null)?.unref?.();
      };

      // Asynchronous in every case: events never come from inside spawn().
      const previous = lastExit;
      lastExit = exited;
      void previous.then(start);

      return {
        post(message) {
          if (child && acknowledged) child.send(message);
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
  // A worker runs untrusted code: its type/category does not sanitize text.
  return message ? captchaFailureFromTransport(category, message) : new CaptchaSdkError(category);
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

/** The dispatcher's timers (the per-solve deadline and the idle exit) and its time. */
export interface SolverClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
  /** Epoch ms, for the abnormal-exit window (default: Date.now). */
  now?(): number;
}

const realClock: SolverClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (timer) => clearTimeout(timer as Timer),
};

export interface CaptchaSolverDeps {
  /** Default: the child-process adapter (the solver process). */
  transport?: SolverTransport;
  /** Default: the runtime's timers. Tests inject a manual clock. */
  clock?: SolverClock;
  /** Sink of the dispatcher's event lines (default: the console). */
  writeLog?: (line: string) => void;
}

/** A solver dispatcher that owns all of its state: queue, in-flight solve, generation, timers, stats. */
export function createCaptchaSolver(deps: CaptchaSolverDeps = {}): CaptchaSolver {
  const transport = deps.transport ?? solverProcessTransport();
  const { setTimeout, clearTimeout } = deps.clock ?? realClock;
  const now = (): number => deps.clock?.now?.() ?? Date.now();
  const log = createEventLogger({ component: "solver", ...(deps.writeLog ? { write: deps.writeLog } : {}) });
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
  // When the abnormal exits inside the window happened, oldest first.
  const abnormalExits: number[] = [];
  // Until then no generation is started and solves are refused (0 = not failing fast).
  let failFastUntil = 0;

  const capState = (): SolverCapState => transport.cap?.() ?? { capMB: null, enforcement: "none" };

  const stats: Omit<CaptchaSolverStats, "mode" | "alive" | "busy" | "queueDepth" | "capMB" | "enforcement" | "abnormalExits" | "failFast" | "failFastUntil"> = {
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
    lastFootprintMB: null,
    shedSolves: 0,
  };

  function failFastRemainingMs(): number {
    return Math.max(0, failFastUntil - now());
  }

  function refuse(reason: SolverUnavailableReason): CaptchaSolverUnavailableError {
    stats.shedSolves += 1;
    return new CaptchaSolverUnavailableError(reason, reason === "fail-fast" ? failFastRemainingMs() : QUEUE_FULL_RETRY_AFTER_MS);
  }

  /**
   * A generation ended in a way nobody planned: a crash, a kill at the cap, a
   * fatal error or a deadline kill. The solve in flight has failed with it;
   * queued solves go to the next generation. Each such exit uses one slot of
   * the restart budget (MAX_ABNORMAL_EXITS per window). The exit that finds
   * the budget used up starts no new generation: solves are refused until the
   * oldest exit has left the window. Planned recycles never come here, and no
   * solve is ever run a second time.
   */
  function noteAbnormalExit(): void {
    const at = now();
    while (abnormalExits.length && abnormalExits[0]! <= at - ABNORMAL_EXIT_WINDOW_MS) abnormalExits.shift();
    abnormalExits.push(at);
    if (abnormalExits.length <= MAX_ABNORMAL_EXITS) return;
    failFastUntil = abnormalExits[abnormalExits.length - MAX_ABNORMAL_EXITS - 1]! + ABNORMAL_EXIT_WINDOW_MS;
    log.error("solver fail-fast: too many abnormal solver exits; solves are refused until the window reopens", {
      abnormalExits: abnormalExits.length, windowMin: ABNORMAL_EXIT_WINDOW_MS / 60_000, retryAfterS: Math.ceil(failFastRemainingMs() / 1000),
    });
    // Nothing would run the solves that wait: refuse them now.
    for (const job of queue.splice(0)) job.reject(refuse("fail-fast"));
  }

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
        noteAbnormalExit();
      },
      exit() {
        if (w !== worker) return; // terminated by us; already accounted
        failInFlight(solverError("other", "captcha solver worker exited unexpectedly"));
        recycle("exit");
        noteAbnormalExit();
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
      noteAbnormalExit();
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
    stats.lastFootprintMB = msg.footprintMB;
    const { capMB } = capState();
    if (capMB !== null) {
      // The generation's own footprint against its cap: recycled well below
      // it, so that the operating system's kill stays the exception.
      if (msg.footprintMB !== null && msg.footprintMB >= capMB * FOOTPRINT_RECYCLE_SHARE) reason ??= "footprint";
    } else if (msg.heapUsedMB !== null && msg.heapUsedMB > options.maxWorkerHeapMB) {
      // Without a cap (a Bun worker): heapUsed there is that worker's own JSC
      // heap (verified: a 150 MB worker allocation leaves the host's figure
      // unchanged).
      reason ??= "heap";
    }
    if (stats.solvesSinceSpawn >= options.recycleAfterSolves) reason ??= "solves";
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
    noteAbnormalExit();
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
      if (failFastRemainingMs() > 0) {
        job.reject(refuse("fail-fast"));
        continue;
      }
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
        noteAbnormalExit();
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
      // Refused without running: nothing is queued, and nothing is retried.
      if (failFastRemainingMs() > 0) return Promise.reject(refuse("fail-fast"));
      if (queue.length >= options.maxQueuedSolves) return Promise.reject(refuse("queue-full"));
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
        ...capState(),
        abnormalExits: abnormalExits.filter((at) => at > now() - ABNORMAL_EXIT_WINDOW_MS).length,
        failFast: failFastRemainingMs() > 0,
        failFastUntil: failFastRemainingMs() > 0 ? failFastUntil : null,
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

/**
 * The proxy's solver dispatcher, over the solver process. Nothing outside
 * tests selects the thread transport: it is reached only by building a
 * dispatcher with `createCaptchaSolver({ transport: threadTransport() })`.
 */
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
