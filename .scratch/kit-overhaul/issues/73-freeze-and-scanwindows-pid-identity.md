# 73: Memory loop: `whileFrozen` resume and `scanWindows` filter by PID only (Windows PID reuse)

**Blocked by:** 72 (Memory-loop tests check a PID after the process died (Windows PID reuse))

**Status:** ready-for-agent

Model: sol
Risk: medium
ADR: no

**What to build:** Found by ticket 72 (same root cause as tickets 70 and 72: Windows reuses a freed PID quickly on a busy runner). `tests/memory/lib/freeze.mjs` `whileFrozen` resumes a frozen process if its PID answers alive; on Windows that could resume (or fail to resume) a stranger and turn an S3/hung run into a harness failure. `scanWindows` in `tests/memory/lib/sampler.mjs` filters by PID only. The orphan test's `finally` in `tests/memory/loop.test.mjs` kills by PID (low risk). Judge each by identity (PID + start time via ticket 72's `tests/memory/lib/process-identity.mjs`, or a held handle), RED first with ticket 72's PID-reuse simulation, mutation proof; S3/hung's evidence gate and the ratchet unchanged.

**Acceptance criteria:**

- [ ] Each site judged by identity; a simulated PID reuse can neither pass nor fail it; mutation proof.
- [ ] S3/hung linux short profile passes its evidence gate; full suites green; windows legs pending CI.

## Comments

- 2026-11-08 (implementer, branch `ticket/73-freeze-scan-pid-identity`; implementation bb95e35, integration tip 788f2fb merged as ceb9953; head = the commit carrying this note).

**Paths touched (all under `tests/memory/`):** `lib/freeze.mjs`, `lib/process-identity.mjs`, `lib/sampler.mjs`, `lib/win-process.mjs`, `lib/win-sampler.mjs`, `fixtures/win32/fake-poller.mjs`, `run.mjs`, `scenarios/s2-captcha.mjs`, `scenarios/s3-concurrency.mjs`, `scenarios/s4-lifecycle.mjs`, `scenarios/s5-mcp.mjs`, `loop.test.mjs`, `win-sampler.test.mjs`. Nothing outside `tests/memory/` (no kit, proxy or mcp code; `dist/` untouched).

**Fix per site.**
- `whileFrozen` (lib/freeze.mjs): it takes the identity `{ pid, start }` of the process to freeze. The S3 hung round takes it from the run's own scan row that chose the target (`sampleIdentity`: the sample key `<pid>:<start>`, Linux stat starttime / Windows CIM `created`). Freeze and thaw are identity primitives that answer true (done) or false (the pid no longer names that process: nothing done):
  - POSIX: start time read, then SIGSTOP/SIGCONT. Linux hands out pids cyclically, so nothing can take the pid between the two steps.
  - Windows (lib/win-process.mjs): one PowerShell opens a handle on the pid first, then asks CIM for the start time with the same expression as `process-identity.mjs` (`WINDOWS_START_EXPRESSION`), and runs `NtSuspendProcess`/`NtResumeProcess` on that handle only when the start time is the expected string. While a handle is open the pid cannot be reused (https://devblogs.microsoft.com/oldnewthing/20110107-00/?p=11803; https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information), so the comparison and the action are about the same process. Answers: `DONE <status>`, `OTHER <start|NONE>` (false), `OPENFAIL <err>` (it is ours, no handle: a failure, never "gone").
  - A stranger at the chosen pid is never frozen (the round does not run; same outcome as a target that is simply gone), a gone frozen process is never thawed, and a failed thaw of our own process is still a harness failure.
- `scanWindows` (lib/sampler.mjs): the live scan no longer asks any pid whether it is alive. It is the latest poll as the tracker selects it (pid + `created`). The pid-only filter could only ever drop rows, and under reuse it kept a dead one; the post-event reads that relied on that drop now wait for a poll that started after them: `settled(marker)`.
  - Each `@@POLL` head carries the poll's start on QueryPerformanceCounter (`Stopwatch.GetTimestamp()` + `Frequency`), the clock `process.hrtime` reads on Windows (libuv `uv__hrtime` divides the raw QPC counter, https://github.com/libuv/libuv/blob/v1.x/src/win/util.c; QPC is consistent across processes, https://learn.microsoft.com/en-us/windows/win32/sysinfo/acquiring-high-resolution-time-stamps). `settled` resolves on the first poll whose start ≥ the call + 1 ms; on Linux and without a live poller it resolves at once (those scans are already current); after 120 s without one it rejects (harness failure, message "no process table poll started within …").
  - Callers that read after an event now `await settled` first: `ctx.observe` (run.mjs, now async; S2 `after-idle-exit` and `after-proxy-sigkill`, S4 `after-proxy-sigkill`), S3 `stopAll` / round before-after / `afterKillHolder`, S4 `proxiesAfter`/`listenersAfter` (the `proxy-left-after-stop` check), the respawn storm, the Ctrl-C trials and the stale-lock respawn, S5's bridge memory reads. Continuous loops (S3 round/OMP polls) keep the sync scan: a count of processes that coexisted in one poll cannot be inflated by staleness.
- Orphan tests (loop.test.mjs, Linux and Windows): each orphan's identity is recorded while it surely runs; cleanup uses `killProcess(id)` (POSIX: identity check + signal; Windows: `TerminateProcess` under the same held-handle script). The Windows test now asserts that both orphans are still themselves and are terminated.

**RED → GREEN with a simulated reuse** (scratch, not committed: `/home/AgentKit/wt/t73-scratch/`; preload `reuse-pid.mjs` = ticket 72's, unchanged).
- `t73-control-tip` (tip f56c46d, no reuse): 2/2 pass.
- `t73-red-tip` (tip, preload + reused pid at the Windows sampler's pid probe): 2 fail.
  - whileFrozen with S3's own primitives: `[reuse-pid] signal SIGCONT delivered to the stranger at pid 607760`, thaw called for the gone process.
  - the tip's post-event read (`scan()` right after the proxy exited): `actual: [ 2400 ]`, "proxies after stop".
- `t73-green-plain` / `t73-green-reuse` (new code, the same two scenarios on the new API, plain and under the preload): 2/2 each; under the preload the pid was reused ("pid … is gone; the pid now names another process") and no signal reached the stranger.
- `t73-memtests-reuse`: the committed `loop.test.mjs` + `win-sampler.test.mjs` under the preload: 114 pass / 0 fail / 5 skipped, 4 pids reused, no `delivered to the stranger` line.

**New tests (in CI on every leg).** loop.test.mjs "Freeze, thaw and kill by identity": a process gone during the freeze is never thawed, its pid free or a stranger's; a stranger at the chosen pid is never frozen and the round does not run; freeze/thaw/kill reach only the named process and an unknown identity throws; a live child frozen/thawed/killed by identity, nothing done once it is gone (live: SIGSTOP state on Linux, the PowerShell held-handle script on windows-latest). win-sampler.test.mjs: a read after the proxy exits never counts it and a read while it runs always does, at 6 offsets across the poll cycle (fake poller re-reads a table file, 150 ms query lag); unstamped frames never satisfy `settled`, a stopped sampler releases it; stamp parsing and the poller's stamp position; the Windows action script holds the handle before asking CIM, acts only after the identity matched, and its answers (OPENFAIL, non-zero NTSTATUS, failed/timed-out PowerShell never read as done or gone). 10/10 repeats of the settled tests green (`t73-settled-reps`).

**Mutations** (committed bb95e35 first; each restored with `git checkout bb95e35 -- <file>`, `git status`/`git diff --stat bb95e35` empty after each; logs `reports/t73-mut{1..7}.log`, script `t73-scratch/mutate.sh`):
- M1 POSIX freeze/thaw/kill without the identity check: 3 fail (gone-during-freeze, stranger-at-chosen-pid, kill-reaches-only).
- M2 whileFrozen ignores a refused freeze: "a stranger at the chosen pid is never frozen" fails.
- M3 `settled` resolves at once: both settled tests fail.
- M4 `settled` takes the next poll that arrives, whenever it started: the offset test fails (at offset 80, 5/5 repeats, `t73-mut4-rep1..5`).
- M5 the Windows action asks CIM before it holds the handle: the action-script test fails.
- M6 OPENFAIL read as "gone": the action-script test fails.
- M7 the S3 hung round freezes by pid instead of the scan's identity: "the recorded proxy is frozen as before" fails.
- Not provable here: the wiring of `settled` into run.mjs/S2–S5 (Linux resolves at once, so a Linux run cannot tell); it is exercised by the windows memory-budget leg.

**Suites (merged tree ceb9953, Bun 1.4.2):**
- kit: 902 tests, 884 pass / 0 fail / 18 skipped (`t73-test`); memory-loop files alone 217 tests, 212 pass / 5 skipped (`t73-memtests-2`, before the merge; tip had 209/204).
- proxy: 1596 pass / 0 fail, 107 files (`t73-proxy`).
- mcp: 100 tests, 99 pass / 0 fail / 1 skipped (`t73-mcp`); `git status` clean after the build (dist unchanged, B5).
- Memory loop `job.mjs --os linux --only S3/hung,S3/short,S3/omp,S2/short,S4/short,S5/short`, port 19730 (`t73-memloop`, out `/home/AgentKit/overhaul-tools/t73-memloop/`): **ratchet holds, exit 0**. S3/hung 188 s, both hung rounds froze their pid-record target and ran (`hung-10-with-stale-lock.target`, `hung-10.target`), orphans 0, RED only on tolerated checks (failed-launches, stale-lock-after-round: ticket 16; peak:kit, procPeak:launcher, procPeak:proxy: ticket 37) — the same set as ticket 72's merge run. S4: proxy-left-after-stop 0, solver:after-proxy-sigkill 0, orphans 0, RED only on ticket 17's names. S2 (ticket 58), S3/short (16, 37), S3/omp (35), S5 (30): listed REDs only.
- No expected-red entry belongs to this ticket. Fixtures and loopback only; no external host.

**Changes to existing tests (C2), titles and intent kept:**
- "whileFrozen thaws after the work, …": identities instead of pids, no injected `alive` (the option is gone).
- `fakeHungRound`: scan rows carry `<pid>:<start>` keys and freeze/thaw take identities; assertions unchanged, plus one (frozen by the scan's identity).
- "whileFrozen: a frozen process the kit killed meanwhile … needs no thaw": a real child and the OS primitives instead of an injected "gone" answer that no longer exists.
- Orphan tests: cleanup by identity; the Windows one asserts the identity kill.
- win-sampler.test.mjs: `alive: () => true` removed from four sampler options (no pid probe left); "every PowerShell we start silences progress" checks the three process-action scripts instead of the removed `suspendScript`.
- Fake poller: sequential polls with a start stamp, optional live `table` file, `lagMs`, `noStamp`; old behaviour otherwise unchanged.

**Decisions:** identity from the scan row, not re-read at freeze time (a re-read would freeze whatever holds the pid then). Held handle + CIM with the shared expression on Windows instead of comparing GetProcessTimes with the CIM FILETIME (no rounding question, ticket 77's lesson). Exact post-event reads by waiting for a stamped poll, not a per-scan PowerShell identity query (≈1 s per scan would blind the S3/OMP 50–100 ms loops) and not handles held by the poller (pinning every pid would keep the kit's dead processes' pids unreused and change what the kit under test sees). `isAlive` stays only for S3's `lockState`, which mirrors the kit's own pid-only view of the lock holder as evidence (the lock records no start time).

**Pending CI (orchestrator verifies after merge+push):**
1. windows test-kit legs (Node 24, 26): ✔ "a live child is frozen, thawed and killed by its identity; …", "whileFrozen: a frozen process the kit killed meanwhile … needs no thaw", "Windows: a deliberately orphaned detached process is found, …" (now ends with two identity kills = true). A failure "suspend|resume|terminate pid N (start …) failed: status 1 …" means the held-handle PowerShell (Add-Type / `[ref]` out parameter) did not run, not the identity logic.
2. windows memory-budget leg: S3/hung passes its evidence gate (both hung rounds frozen and run, no harness failure); S2/S4/S5 not harness failures. The signature of a poller whose stamps do not arrive is "memory loop sampler: no process table poll started within 120000 ms after this read". S4/short gets slower by about one poll (≤ ~1.1 s) per read after a step (≈ 60–100 s over 50 cycles); within its 2400 s windows timeout.
3. ubuntu legs stay green.

**Left for another ticket (not done here, same root cause, pid-only kills after a scan):** S3 kill-holder adversary `process.kill(holder.pid, "SIGKILL")` (timing-critical: an identity kill on Windows costs a PowerShell, which would move the kill past the holder's lock window); S4 crash-cycle `process.kill(pid, "SIGKILL")` and the Ctrl-C cleanup `process.kill(p.pid, "SIGKILL")`; run.mjs orphan reaping after `survivors()`. All now read fresh state first (S4 cleanup) or kill within milliseconds of a fresh poll, but are still pid-only. Kit side: the start lock records no holder start time, so `pidAlive(holder.pid)` (lib/proxy-lifecycle.mjs) cannot tell a reused pid (the glossary's "stale lock" definition assumes it can).
