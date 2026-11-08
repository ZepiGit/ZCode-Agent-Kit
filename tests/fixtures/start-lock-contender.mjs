// A start-lock contender for tests/start-lock.test.mjs (seam 2, real
// processes, real time). It acquires the installation's start lock through
// the lifecycle module, holds it briefly, and releases it.
//   argv[2]  JSON { root, killAt, holdMs, deadlineMs, flag }
//   killAt   a protocol step name: the process SIGKILLs itself there (an
//            interrupted start), so it never prints a result
// It prints one JSON line: { pid, acquired, overlap, intact, contended, error }
//   overlap  another LIVE holder was inside the critical section at the same time
//   intact   the lock still held this acquisition's own record right before release
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const cfg = JSON.parse(process.argv[2]);
const { createLifecycle } = await import(pathToFileURL(join(cfg.kitRoot, "lib", "proxy-lifecycle.mjs")).href);
const lifecycle = createLifecycle({
  root: cfg.root, home: join(cfg.root, "home"),
  stepHook: (step) => { if (step === cfg.killAt) process.kill(process.pid, "SIGKILL"); },
});
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err?.code !== "ESRCH"; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { pid: process.pid, acquired: false, overlap: false, intact: null, contended: 0, error: null };
const deadline = Date.now() + (cfg.deadlineMs ?? 30_000);
try {
  for (;;) {
    const lock = lifecycle.acquireStartLock();
    if (lock.status === "acquired") {
      result.acquired = true;
      // Two holders at once? The flag is created exclusively; one left by a
      // holder that is still alive means two live holders overlapped.
      try {
        writeFileSync(cfg.flag, String(process.pid), { flag: "wx" });
      } catch (err) {
        if (err?.code !== "EEXIST") throw err;
        const other = Number(readFileSync(cfg.flag, "utf8"));
        if (other !== process.pid && alive(other)) result.overlap = true;
        writeFileSync(cfg.flag, String(process.pid));
      }
      await sleep(cfg.holdMs ?? 20);
      let onDisk = null;
      try { onDisk = JSON.parse(readFileSync(lifecycle.LOCK_FILE, "utf8")); } catch {}
      result.intact = onDisk?.nonce === lock.record.nonce;
      try { if (readFileSync(cfg.flag, "utf8") === String(process.pid)) unlinkSync(cfg.flag); } catch {}
      lock.release();
      break;
    }
    if (lock.status === "unavailable") { result.error = lock.message; break; }
    result.contended += 1;
    if (Date.now() > deadline) { result.error = `still contended after ${cfg.deadlineMs} ms: ${lock.message}`; break; }
    await sleep(15);
  }
} catch (err) {
  result.error = err?.stack ?? String(err);
}
process.stdout.write(JSON.stringify(result) + "\n");
