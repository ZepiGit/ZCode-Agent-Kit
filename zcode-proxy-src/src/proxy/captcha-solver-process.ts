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
 * It dies with the proxy. The IPC channel's EOF ends it (`disconnect`), and so
 * does a small watcher thread for the case where the solve has parked or spun
 * the main thread, which then never sees the EOF: the watcher checks every
 * 500 ms that the parent is still its parent and alive, and otherwise kills
 * this process. Windows keeps a stale parent pid, so the watcher checks only
 * the parent's liveness there.
 */
import { createEventLogger } from "../log/event-line.mjs";
import { serveSolverGeneration } from "./captcha-solver-generation.js";
import { SOLVER_PROCESS_COMMAND } from "./solver-process-command.js";

/** How often the watcher thread checks the parent. */
export const PARENT_CHECK_MS = 500;

// POSIX reparents an orphan, so a changed ppid is proof; Windows keeps the
// stale ppid, so only the parent's liveness is checked there. Only ESRCH
// counts as gone: an unexpected error must never end a healthy solver.
const reparented = (parentPid: number): boolean => process.platform !== "win32" && process.ppid !== parentPid;

/** Plain JS for a Worker built from a Blob, so the watcher needs no extra compile entrypoint. */
function watcherSource(parentPid: number): string {
  return `
const parent = ${JSON.stringify(parentPid)};
const gone = () => {
  if (${JSON.stringify(process.platform)} !== "win32" && process.ppid !== parent) return true;
  try { process.kill(parent, 0); return false; } catch (err) { return err?.code === "ESRCH"; }
};
setInterval(() => { if (gone()) process.kill(process.pid, "SIGKILL"); }, ${PARENT_CHECK_MS});
`;
}

/** Runs the solver process in this process. Exits 2 when started without an IPC channel. */
export function runSolverProcess(args: readonly string[] = process.argv.slice(2)): void {
  const send = typeof process.send === "function" ? process.send.bind(process) : null;
  const parentPid = Number(args[args.length - 1]);
  if (!send || !Number.isSafeInteger(parentPid) || parentPid <= 0) {
    createEventLogger({ component: "solver", write: (line) => process.stderr.write(`${line}\n`) })
      .error("solver process started without the proxy's IPC channel; the proxy starts it on the first solve", { command: SOLVER_PROCESS_COMMAND });
    process.exit(2);
  }
  // A parent that is already gone: nothing would ever end this process.
  if (reparented(parentPid)) process.exit(0);

  const watcher = new Worker(URL.createObjectURL(new Blob([watcherSource(parentPid)], { type: "text/javascript" })), { smol: true } as WorkerOptions);
  (watcher as Worker & { unref(): void }).unref(); // Bun runtime API missing from the Worker DOM type

  process.on("disconnect", () => process.exit(0));
  serveSolverGeneration({
    post: (message) => { send(message); },
    listen: (handler) => { process.on("message", handler); },
  });
}

if (import.meta.main) runSolverProcess();
