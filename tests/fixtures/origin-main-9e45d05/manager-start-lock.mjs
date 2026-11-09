// origin/main (9e45d05) manager's start-lock code, VERBATIM between the markers
// (tests/start-lock.test.mjs re-checks each block against
// `git show 9e45d05:proxy/zcode-proxy-manager.mjs` when the object is present).
// It is wrapped only so a test can run it against new (protocol v1) locks:
// an old kit reads only `pid` and `startedAt` and never deletes a lock it does
// not own (ADR-0012 condition 3).
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export function originMainStartLock({ LOG_DIR, LOCK_FILE }) {
// --- verbatim block: pidAlive
  function pidAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // AUD-001: only "no such process" proves death; EPERM and unknown
      // errors fail closed — the process counts as alive.
      return err?.code !== "ESRCH";
    }
  }
// --- end
// --- verbatim block: start lock
  let startLockNonce = null;
  function acquireStartLock() {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
    const nonce = randomBytes(8).toString("hex");
    try {
      writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce }), { flag: "wx", mode: 0o600 });
      startLockNonce = nonce;
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let holder = null;
      try { holder = JSON.parse(readFileSync(LOCK_FILE, "utf8")); } catch {}
      if (holder && typeof holder.pid === "number" && pidAlive(holder.pid)) {
        const contention = new Error(`another manager start is in progress (pid ${holder.pid}, started ${holder.startedAt}). If that is wrong (e.g. pid reuse), remove ${LOCK_FILE}`);
        contention.code = "START_IN_PROGRESS";
        throw contention;
      }
      throw new Error(
        `stale or unreadable manager start lock at ${LOCK_FILE}` +
          (holder ? ` (holder pid ${holder.pid} is not alive, started ${holder.startedAt})` : "") +
          ` — refusing automatic takeover. If no start is actually running, remove ${LOCK_FILE} manually and retry.`,
      );
    }
  }

  function releaseStartLock() {
    if (!startLockNonce) return;
    const nonce = startLockNonce;
    startLockNonce = null;
    try {
      const holder = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      if (holder.nonce !== nonce) return; // belongs to a successor — leave it alone
    } catch {
      return;
    }
    try { unlinkSync(LOCK_FILE); } catch {}
  }
// --- end
  return { acquireStartLock, releaseStartLock, nonce: () => startLockNonce };
}
