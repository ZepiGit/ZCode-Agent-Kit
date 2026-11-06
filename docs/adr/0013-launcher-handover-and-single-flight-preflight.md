---
status: accepted
---

# Launcher handover on POSIX, and single-flight preflight inside the harness host

Two changes to the process model of `zcode-kit run` and the OMP autostart bring the S3 kit footprint (5 `run` sessions, 5 OMP preflights, the proxy and the solver) under budget. First, on POSIX the launcher hands its process over to the harness with `process.execve` after its preflight, so it leaves 0 MB resident with the same pid. Second, among OMP hosts of one installation that start together, only one spawns a preflight, and the others wait inside their own host process. The footprint facts measured every part: bare Node 42–45 MB, a waiting preflight ≥ 48 MB as a process, a bridge floor of ≈ 72 MB, execve 0 MB. The plan checks out at 5 × 75 + 76 + 62 + 20 = 533 MB against ≤ 596 MB. It also rests on two assumptions that the conditions below turn into tested properties: the waiters really are not processes, and the resident launcher target is backed by measurement. Both failure modes are cross-version: an old extension meeting a new token, and the signal exit status.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 3, Q2 (ACCEPTED with the binding conditions below).

## Binding conditions

1. **Resident launcher target ≤ 74 MB on the CI Node version,** not ≤ 70. Today's code measures 70.5 MB median on Node 26 and 78.4 MB on Node 24, and nothing in the plan changes the resident path. 74 MB equals the S3 baseline launcher, so it is not a loosening. The resident path is the Windows path, which is gated on commit there.
2. **The single-flight token is taken before the preflight is spawned.** Today five hosts that start together all see "no lock", because the manager start lock is acquired only after a preflight has loaded its modules, and the plan would fail at 837 MB. The extension therefore takes its own exclusive token (an O_EXCL file in the installation's logs dir, holding host pid and start time) before it spawns. Hosts that find the token wait in-host with a stat poll plus the existing `healthy()` fetch, and start no process. The token follows the lessons of [ADR-0003](0003-start-lock-proven-takeover.md): it is released in `finally`, a stale token (holder dead, or older than `START_TIMEOUT_MS`) is taken over by proof, and no waiter waits longer than `START_TIMEOUT_MS`. It is separate from the start lock, whose protocol ([ADR-0012](0012-start-lock-protocol-version-and-stored-state-migrations.md)) does not change. The long-lived host still loads no kit modules.
3. **Waiters keep the diagnostics.** If the starter's preflight fails or the wait times out, a waiter runs its own preflight, so failure categories and the "Next … may retry" message stay per host. A waiter that sees a healthy proxy may skip its first preflight, but the fixed-vocabulary `cause=` warnings must still reach that host through a channel the spec chooses. Dropping them silently is not allowed. An old extension keeps spawning preflights, which the start lock already covers.
4. **The cost of waiting is measured.** S3's OMP leg runs the generated extension in a stub Bun host, so "≤ 1 concurrent OMP preflight process" is a test result, with 5 simultaneous hosts and with the starter host killed. The host's RSS delta is reported but not counted as kit footprint, since the host is the harness. The build-time gate is ≤ 5 MB per host; more is a finding that returns with numbers.
5. **Handover only when all of these hold:** POSIX, `typeof process.execve === "function"`, Node ≥ 26.1, and the target resolved on PATH and checked with `access(X_OK)`. Otherwise the launcher stays resident as today. Pre-validation keeps today's error (`run: …`, exit 2) when the harness is missing.
6. **A documented opt-out.** One `ZCODE_KIT_*` variable, named by the spec, forces the resident launcher. `process.execve` is Stability 1 (Experimental), and users need a way back that is not a downgrade.
7. **All work happens before the handover,** because exit handlers do not run after execve: the `ready.detail` line, any `heal.log` write and any cleanup. Then SIGPIPE/SIGXFSZ are re-armed. The `ExperimentalWarning` is suppressed for this call only, so no kit noise reaches the harness session.
8. **One visible exit-status change is announced.** With the handover, a harness killed by a signal reports that signal (for example 143) where today it reports exit 1. Exit codes 0, 7 and 130 are unchanged (measured). The release notes say so.
9. **Platform coverage is stated, not claimed.** macOS execve is unverified and goes to OWNER-ACTIONS.md. The release notes and README state that the lower footprint on Linux and macOS needs Node ≥ 26.1. On Node 24 the S3 total is not claimed.
10. **Windows levers stay ordered by evidence.** If Windows misses 600 MB of commit after these changes, the orchestrator returns with numbers for the lean resident launcher and the Bun bridge. Neither is adopted now.

## Considered options

- **Rely on the manager start lock for single-flight:** rejected. It is acquired ~100 ms after the preflight process exists, so every simultaneous host spawns one.
- **A ≤ 70 MB resident launcher target (the recommendation):** rejected; it sits below today's measured median with no change to back it.

## Consequences

- `run` on POSIX with Node ≥ 26.1 no longer has a kit process for the life of the harness session; signals reach the harness directly.
- The bridge flags (`--max-semi-space-size=1` on the bridge command line, never in `NODE_OPTIONS`) and lazy HTTP loading from the same answer are a two-way door and are not part of this record.

## Amended 2026-11-06 (Round 4, Q2 and Q3)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 4, Q2 and Q3.

- **Condition 3: the channel is a result record next to the autostart token (Q2).** The starter writes it by temp file + rename with mode `0o600` on every outcome and before it releases the token. The record carries the token's identity (host pid, host start time, per-attempt nonce); a waiter accepts it only if that identity equals the token it observed and the record is not older than its own wait start. A released or proven-stale token without a matching record counts as a starter failure: the waiter takes over by proof and runs its own preflight, so ≤ 1 concurrent OMP preflight process still holds. The record holds only the exit code and fixed-vocabulary `cause=` lines (≤ 4 KB / ≤ 16 lines), each validated before printing; a corrupt or oversized record counts as no record. It is one fixed-name file, overwritten per attempt, counted in S4's log-dir file budget, never deleted by waiters. Old extensions neither write nor read it.
- **Condition 6: the opt-out is `ZCODE_KIT_RESIDENT_LAUNCHER=1` (Q3).** Only the exact value `"1"` forces the resident launcher; with it set the resident path behaves byte for byte as today. It has no effect on Windows and no other code path reads it. It is documented in `--help`, README × 5 next to the Node ≥ 26.1 note and the release notes. Once released it is a public env var (a one-way door).
