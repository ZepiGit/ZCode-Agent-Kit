/**
 * captcha-solver-process.ts — entry of the solver process: one
 * solver generation in an OS process of its own, started by the proxy's
 * child-process adapter (captcha-solver.ts, solverProcessTransport) with an
 * IPC channel. From source it runs as `<bun> captcha-solver-process.ts
 * <parent pid>`; a compiled proxy runs it as `<binary> __captcha-solver-process
 * <parent pid>` (index.ts).
 *
 * It never runs the watchdog, the health supervisor or the respawn hook: it
 * imports none of them, and its environment carries no ZCODE_KIT_RESPAWN_*.
 *
 * Cap before work. The process announces itself (`hello`) and then waits for
 * the proxy's acknowledgement that its memory cap is in place (`cap`). Until
 * that arrives it accepts no solve and loads neither the solve code nor the
 * DOM runtime; when it does not arrive within HANDSHAKE_TIMEOUT_MS the
 * process ends itself with exit code 3. Where the operating system does not
 * enforce the cap (`sampling`), and on Windows, where its limit counts commit
 * charge and sits above the cap (`job-object`), the watcher thread below
 * measures the process's own memory footprint and ends the process at the cap. Right
 * before that it writes a marker with the footprint to stderr; the proxy
 * takes the marker out of the output and writes the event line that names the
 * config key. The marker comes from the watcher thread because the main
 * thread may be parked in a solve and could not send a message.
 *
 * It dies with the proxy. The IPC channel's EOF ends it (`disconnect`), and so
 * does a small watcher thread for the case where the solve has parked or spun
 * the main thread, which then never sees the EOF: the watcher checks every
 * 500 ms that the parent is still its parent and alive, and otherwise kills
 * this process. Windows keeps a stale parent pid, so the watcher checks only
 * the parent's liveness there.
 */
import { createEventLogger } from "../log/event-line.mjs";
import { serveSolverGeneration } from "./captcha-solver-generation.js";
import { SOLVER_AT_CAP_MARKER, solverWatchesItself } from "./solver-cap.js";
import { SOLVER_PROCESS_COMMAND } from "./solver-process-command.js";

/** How often the watcher thread checks the parent. */
export const PARENT_CHECK_MS = 500;
/** How often the watcher thread measures the footprint when the solver process watches its own cap. */
export const CAP_SAMPLE_MS = 100;
/** How long the process waits for the proxy's cap acknowledgement before it ends itself. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
/** Exit code of a solver process that never got its cap acknowledgement. */
export const NO_CAP_EXIT_CODE = 3;

const MB = 1024 * 1024;
/**
 * On Windows the runtime reports the commit charge as its footprint. A Bun
 * process commits a few hundred MB that it never touches (solver-cap.ts,
 * JOB_COMMIT_ALLOWANCE_MB), so the footprint there is the working set, which
 * is close to what Linux and macOS report.
 */
const FOOTPRINT_IS_WORKING_SET = process.platform === "win32";

// POSIX reparents an orphan, so a changed ppid is proof; Windows keeps the
// stale ppid, so only the parent's liveness is checked there. Only ESRCH
// counts as gone: an unexpected error must never end a healthy solver.
const reparented = (parentPid: number): boolean => process.platform !== "win32" && process.ppid !== parentPid;

/**
 * Plain JS for a Worker built from a Blob, so the watcher needs no extra
 * compile entrypoint. A `{ capBytes }` message starts the footprint sampling.
 */
function watcherSource(parentPid: number): string {
  return `
import fs from "node:fs";
const parent = ${JSON.stringify(parentPid)};
const gone = () => {
  if (${JSON.stringify(process.platform)} !== "win32" && process.ppid !== parent) return true;
  try { process.kill(parent, 0); return false; } catch (err) { return err?.code === "ESRCH"; }
};
setInterval(() => { if (gone()) process.kill(process.pid, "SIGKILL"); }, ${PARENT_CHECK_MS});
let sampler = null;
self.onmessage = (event) => {
  const { capBytes } = event.data ?? {};
  if (sampler || !(capBytes > 0)) return;
  sampler = setInterval(() => {
    let used;
    if (!${FOOTPRINT_IS_WORKING_SET}) { try { used = Bun.unsafe.memoryFootprint(); } catch { used = undefined; } }
    if (!(used > 0)) used = process.memoryUsage.rss();
    if (used < capBytes) return;
    try { fs.writeSync(2, ${JSON.stringify(SOLVER_AT_CAP_MARKER)} + " footprintMB=" + Math.round(used / ${MB}) + "\\n"); } catch {}
    process.kill(process.pid, "SIGKILL");
  }, ${CAP_SAMPLE_MS});
};
`;
}

/** This process's memory footprint in MB: the runtime's figure, or the working set (RSS) on Windows and where the runtime reports none. */
function footprintMB(): number {
  let bytes: number | undefined;
  if (!FOOTPRINT_IS_WORKING_SET) {
    try { bytes = (globalThis as { Bun?: { unsafe?: { memoryFootprint?: () => number | undefined } } }).Bun?.unsafe?.memoryFootprint?.(); }
    catch { bytes = undefined; }
  }
  if (!(typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0)) bytes = process.memoryUsage.rss();
  return Math.round(bytes / MB);
}

export interface SolverProcessOptions {
  /** Default HANDSHAKE_TIMEOUT_MS. Tests shorten it. */
  handshakeTimeoutMs?: number;
}

/** Runs the solver process in this process. Exits 2 when started without an IPC channel. */
export function runSolverProcess(args: readonly string[] = process.argv.slice(2), opts: SolverProcessOptions = {}): void {
  const log = createEventLogger({ component: "solver", write: (line) => process.stderr.write(`${line}\n`) });
  const send = typeof process.send === "function" ? process.send.bind(process) : null;
  const parentPid = Number(args[args.length - 1]);
  if (!send || !Number.isSafeInteger(parentPid) || parentPid <= 0) {
    log.error("solver process started without the proxy's IPC channel; the proxy starts it on the first solve", { command: SOLVER_PROCESS_COMMAND });
    process.exit(2);
  }
  // A parent that is already gone: nothing would ever end this process.
  if (reparented(parentPid)) process.exit(0);

  const watcher = new Worker(URL.createObjectURL(new Blob([watcherSource(parentPid)], { type: "text/javascript" })), { smol: true } as WorkerOptions);
  (watcher as Worker & { unref(): void }).unref(); // Bun runtime API missing from the Worker DOM type

  process.on("disconnect", () => process.exit(0));

  const waitMs = opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  const handshake = setTimeout(() => {
    log.error("solver process got no memory cap acknowledgement from the proxy; it ends without solving", { waitedMs: waitMs });
    process.exit(NO_CAP_EXIT_CODE);
  }, waitMs);

  const onAcknowledgement = (raw: unknown): void => {
    const msg = raw as { type?: unknown; enforcement?: unknown; capMB?: unknown } | null;
    // Nothing but the acknowledgement is accepted before it.
    if (msg?.type !== "cap") return;
    clearTimeout(handshake);
    process.off("message", onAcknowledgement);
    if (solverWatchesItself(msg.enforcement) && typeof msg.capMB === "number" && msg.capMB > 0) {
      watcher.postMessage({ capBytes: msg.capMB * MB });
    }
    serveSolverGeneration({
      post: (message) => { send(message); },
      listen: (handler) => { process.on("message", handler); },
      footprintMB,
    });
  };
  process.on("message", onAcknowledgement);
  send({ type: "hello", pid: process.pid });
}

if (import.meta.main) runSolverProcess();
