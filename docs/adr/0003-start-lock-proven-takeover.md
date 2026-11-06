---
status: accepted
---

# Start lock: proven takeover of a stale lock, never of a live holder's

A stale start lock may be taken over, but only on proof. Proof is that the recorded holder is dead, or that its PID was reused (the live process's start time does not match the recorded one). A live holder's lock is never touched; AUD-001 stays. Today no takeover happens at all. A killed or Ctrl-C'd start then leaves a stale lock (5 of 8 Ctrl-C trials, every SIGKILL). After that, 7–8 of 10 launches fail, `stop` and `restart` refuse, and a respawn ends with no proxy (memory report RC-L). Exclusion held in every race, so the fix keeps exclusion and restores recovery: "exactly one proxy" is useless if it can be zero.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 1, Q4 (ACCEPTED with the binding conditions below).

## Binding conditions

1. **Takeover closes the TOCTOU, not just "atomic rename".** A contender that judged the lock stale can, between judging and renaming, move a fresh lock that another contender has just written. The protocol must rule this out, for example by checking the moved record against the judged stale record, or by an exclusive takeover side-lock with its own pid and start-time proof. A race test proves it: N contenders, with a kill injected at every protocol step. It asserts that there are never two holders and that a live holder's lock is never deleted.
2. **Release on signals.** A process releases a start lock it owns on SIGINT, SIGTERM and SIGHUP, and on Windows on SIGBREAK and console close (Windows does not deliver SIGTERM). Release still deletes the lock only while the on-disk record is the process's own.
3. **Respawn treats a proven-stale lock as takeable.**
4. **Orphaned proxies are adopted.** A proxy that survived a Ctrl-C during its start is adopted on the next start through the existing identity proof. A second proxy is never spawned.
5. **Budgets:** 0 failed launches with a killed holder, 0 stale locks after a race round or after Ctrl-C, and the proxy is up after a respawn that met a stale lock.

## Considered options

- **Keep "no automatic takeover" (AUD-001 as written):** rejected. It is measured to leave sessions with no proxy.
- **Unconditional unlink after a stale observation:** rejected. Two contenders can delete each other's fresh locks and both believe they hold it, which is what AUD-001 exists to prevent.

## Consequences

- The on-disk lock protocol is a one-way door: old and new kits can meet the same lock during an update. Proof of PID reuse needs the holder's process start time in the lock record. A record without it can only be proven stale by a dead PID.
- This supersedes the "no automatic stale takeover" comments in `proxy/zcode-proxy-manager.mjs` and the README line "A leftover start lock is deliberately never taken over"; both must be updated with the implementation.
- Exit codes are unchanged.
