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

## Amended 2026-11-06 (Round 2, Q10; Round 3, Q2)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 2, Q10 and Round 3, Q2.

- **The lock carries a protocol version** ([ADR-0012](0012-start-lock-protocol-version-and-stored-state-migrations.md)). Today's version-less record `{pid, startedAt, nonce}` is protocol v0.
- **This replaces the sentence "A record without it can only be proven stale by a dead PID"** in the Consequences above. A v0 lock is also proven stale when the live process at its PID started later than the lock's `startedAt`. Otherwise stale locks left by old kits would never be recovered after the update.
- **Never deleted automatically:** an unparsable lock, or a lock of an unknown higher version. Its error gives what/why/next with the exact path.
- **New locks are written atomically,** so "unreadable" can only mean foreign corruption, never a contender's partial write.
- **The OMP single-flight token is a separate record** ([ADR-0013](0013-launcher-handover-and-single-flight-preflight.md)). It follows this ADR's lessons (proven takeover, release in `finally`) but does not change the start lock's protocol.

## Amended 2026-11-08 (Round 7 Q4; ticket 16)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 7, Q4 (its Reversibility puts the pid-record change under this ADR as an amendment line). The mechanism below is the one ticket 16 implemented.

- **Takeover mechanism (condition 1).** A contender that judged a record stale must first create an exclusive claim for exactly those bytes (`manager.lock.claim-<hash>`, holding the claimant's own pid and start time). Only the claimant deletes the record, and only after re-reading the lock and finding the judged bytes unchanged. A claim whose claimant died is taken over the same way. Locks and claims are written atomically (temp file + hard link).
- **No live proxy without a pid record.** `proxy.pid` is written before the spawn as a spawn intent (`pid: null`, `spawning: { by, at }`), with the pid right after the spawn, and with the start time once it is known. Every write is atomic (temp + rename). Old kits read the intent as "no record".
- **Completing a record needs proof, never a port or a pid alone (Round 7 Q4 condition 3).** A record its spawner left unfinished (the spawner was killed, or its start-time probe timed out) is completed under the start lock only when the authenticated `/health` answer names the pid (`details.pid`), and that pid's start time read before and after a second answer is the same. A spawn intent adopts only a proxy that started after the intent. Only then can a stop verify and stop it.
- **What condition 5's "0 failed launches with a killed holder" counts (Round 27 Q1, a measurement-rule clarification; the budget is unchanged).** In the kill-holder round, the launch the adversary SIGKILLed (its pid equals the adversary's recorded `killed` pid, and it exited non-zero) is reported as `killedByAdversary` and is never a failed launch. Every other launch that does not exit 0 is a failed launch. A round counts as run only with exactly one such launch.
