// The loop freezes its own hung proxy in S3 (SIGSTOP on POSIX,
// NtSuspendProcess on Windows). Whatever the work in between does, the
// process is thawed afterwards; a thaw that fails is a harness failure, so a
// process the loop itself left frozen can never pass as a kit orphan or a
// kit verdict (CI run 42252896054, ticket 02 round 4).
// A process that is gone after the work (the kit's hung-own recovery killed
// it, which is what the S3 hung rounds test) needs no thaw.
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; } };

export async function whileFrozen(pid, work, { freeze, thaw, alive = isAlive }) {
  freeze(pid);
  let result, failure = null;
  try { result = await work(); } catch (err) { failure = err; }
  if (alive(pid)) try { thaw(pid); } catch (err) {
    throw new Error(`could not thaw pid ${pid} the loop froze itself (harness failure): ${err?.message ?? err}`);
  }
  if (failure) throw failure;
  return result;
}
