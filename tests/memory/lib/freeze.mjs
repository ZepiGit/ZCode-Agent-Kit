// The loop freezes its own hung proxy in S3 (SIGSTOP on POSIX,
// NtSuspendProcess on Windows). Whatever the work in between does, the
// process is thawed afterwards; a thaw that fails is a harness failure, so a
// process the loop itself left frozen can never pass as a kit orphan or a
// kit verdict (CI run 42252896054, ticket 02 round 4).
// A process that is gone after the work (the kit's hung-own recovery killed
// it, which is what the S3 hung rounds test) needs no thaw.
//
// The frozen process is named by its identity (pid + start time,
// lib/process-identity.mjs), taken from the run's own scan that chose it, and
// every freeze and thaw is judged by it, never by the pid alone (ticket 73):
// Windows hands a freed pid to a new process quickly (tickets 70, 72), so once
// the frozen proxy is gone its pid may name a stranger. A stranger is never
// frozen or thawed, and it neither fails the run (a refused or failed resume
// of a process the loop never froze) nor passes it.
import { startOf } from "./process-identity.mjs";
import { resumeProcess, suspendProcess, terminateProcess } from "./win-process.mjs";

// Pid-only liveness, kept for what it describes: the kit's own view of a start
// lock holder (lib/proxy-lifecycle.mjs `pidAlive`; the lock records no start
// time), which S3 mirrors as evidence. Never used to judge a process to signal.
export const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; } };

// POSIX: the start time is read, then the signal sent. Linux hands out pids in
// increasing order and reuses one only after the whole pid space wrapped, so
// nothing can take the pid between the two steps; Windows (below) holds a
// handle across both instead.
function posixSignal(id, signal, { start, kill }) {
  if (start(id.pid) !== id.start) return false; // gone, or the pid names another process
  try { kill(id.pid, signal); } catch (err) {
    if (err.code === "ESRCH") return false;
    throw err;
  }
  return true;
}

const defaults = (o) => ({ platform: process.platform, start: (pid) => startOf(pid), kill: (pid, sig) => process.kill(pid, sig), ...o });

/**
 * Freeze the process `id` names. false: the pid no longer names it (nothing
 * was frozen). Throws when the identity cannot be told or the OS refuses.
 * `start` (pid → start time | null) and `kill` are the process table (tests: a
 * fake one); `platform` selects the primitive.
 */
export function freezeProcess(id, opts = {}) {
  const o = defaults(opts);
  if (o.platform === "win32") return suspendProcess(id);
  return posixSignal(id, "SIGSTOP", o);
}

/** Thaw the process `id` names. false: it is gone, and a stranger at its pid is left alone. */
export function thawProcess(id, opts = {}) {
  const o = defaults(opts);
  if (o.platform === "win32") return resumeProcess(id);
  return posixSignal(id, "SIGCONT", o);
}

/**
 * Kill the process `id` names (`signal`, SIGKILL by default; Windows
 * TerminateProcess under a held handle). false: it is gone, and a stranger at
 * its pid is left alone. For the loop's own cleanup of processes it started.
 */
export function killProcess(id, { signal = "SIGKILL", ...opts } = {}) {
  const o = defaults(opts);
  if (o.platform === "win32") return terminateProcess(id);
  return posixSignal(id, signal, o);
}

/**
 * Run `work` while the process `id` ({ pid, start }) is frozen, then thaw it
 * if it is still that process. `freeze` / `thaw` (id → boolean, see above)
 * default to the OS primitives.
 */
export async function whileFrozen(id, work, { freeze = freezeProcess, thaw = thawProcess } = {}) {
  if (!freeze(id)) throw new Error(`pid ${id.pid} no longer names the process chosen to freeze (start ${id.start}): nothing was frozen`);
  let result, failure = null;
  try { result = await work(); } catch (err) { failure = err; }
  try { thaw(id); } catch (err) {
    throw new Error(`could not thaw pid ${id.pid} the loop froze itself (harness failure): ${err?.message ?? err}`);
  }
  if (failure) throw failure;
  return result;
}
