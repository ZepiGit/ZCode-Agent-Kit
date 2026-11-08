# 72: Memory-loop tests check a PID after the process died (Windows PID reuse)

**Blocked by:** 70 (Windows: "stop cleanly kills a verified-own process" finds the process still alive)

**Status:** resolved

Model: sol
Risk: low
ADR: no

**What to build:** Ticket 70 showed that on Windows a freed PID is reused quickly on a busy runner, so "is PID N alive?" after the process exited can answer yes for a different process. It fixed the two manager tests by asking the child's own handle (`ChildProcess.kill(0)`). The memory-loop tests make the same PID-after-death check on processes they do not own a handle for: `tests/memory/win-sampler.test.mjs:157,205` and `tests/memory/loop.test.mjs:347,374,450`. Fix them so a reused PID cannot pass or fail them (identity by PID + start time, as the sampler already records, or a handle where the test can hold one), RED first with a simulated reuse (ticket 70's preload approach).

**Acceptance criteria:**

- [ ] Each listed check judged by identity, not PID alone; a simulated PID reuse can neither pass nor fail it; mutation proof.
- [ ] Full suites green; windows test-kit legs green (pending CI).

## Comments

- 2026-11-08 (implementer, branch `ticket/72-memory-tests-pid-identity`; implementation 8fda747, integration tip 8e11d15 merged as 5a03b56; head = the commit carrying this note). Ticket 67 had not landed by then (tip 8e11d15 has no ticket 67 merge). Its `loop.test.mjs` hunks (≈ lines 614, 815 and the end of the file) do not overlap with this ticket's (≈ 283–505), so a clean merge is expected.

**Lines on the tip (1fc7473), all confirmed:**
- win-sampler.test.mjs:157 and :205: `alive(pollerPid)` after `sampler.stop()`.
- loop.test.mjs:347: the same check against the live PowerShell poller (windows only).
- loop.test.mjs:374: `!alive(grandchild)`, Job Object (windows only).
- loop.test.mjs:450: `isAlive(host.pid)`.
- loop.test.mjs:449 made the same PID-after-death probe for the preflight, as did the cleanup kills at :374/:375 and :453/:454. They have the same root cause, so I fixed them too.

**Fix: a handle where the code holds one, identity elsewhere.**
- Poller (157, 205, 347): the sampler gets `pollerRunning()`, taken from its own ChildProcess (`exitCode`/`signalCode`). `stop()` resolves on the poller's exit, so the 200/500 ms sleeps are gone. The check is synchronous and stricter, as in ticket 70.
- OMP host (450): `startOmpHost` gets `running()`, taken from its handle.
- Preflight (449): the host's child, so the test holds no handle on it. The test records `identityOf(pid)` (pid + start time) as soon as the pid file appears; the preflight sleeps 30 s, so it is surely running then. "Gone" now means `!isSameProcess(id)`.
- Grandchild (374): the job kills it before the test can ask, so `fixtures/win32/job-probe.mjs` prints `GRANDCHILD <pid> <start>`, with the start taken while it runs. The test waits for `!isSameProcess`. The deadline went from 10 s to 20 s because each ask is one PowerShell.
- New `tests/memory/lib/process-identity.mjs`. The start time is the one the samplers record: Linux `/proc/<pid>/stat` starttime, Windows `Win32_Process.CreationDate` as FILETIME (same expression as the poller's `created`, so there is no access-denied case for a stranger's pid), macOS `ps -o lstart`. An unknown answer throws (PowerShell failed or timed out, empty output, unreadable stat); it is never read as "gone".
- Cleanup kills: the preflight and grandchild kills in `finally` only fire while `isSameProcess` holds.
- `killTree()` on Windows skips `taskkill /PID <pid> /T /F` once the host's handle has seen it exit. The killed-starter test's `finally` called it on a host that had already exited, so a reused pid would have given a stranger's tree to `/T /F`. The POSIX branch is unchanged: a process group id is not reallocated while the group exists.

**RED → GREEN with a simulated reuse.**
- Preload `t72-scratch/reuse-pid.mjs` extends ticket 70's. A pid is reassigned the moment its process is gone (reaped), not after the first ESRCH the test sees. It covers pids from spawned children, alive probes, and a 10 ms `/proc` scan (that is how it knows the preflight). For such a pid:
  - `process.kill(pid, 0)` answers alive;
  - any other signal is logged as "delivered to the stranger" and never sent;
  - `/proc/<pid>/stat` describes a stranger with a later start time.
- `t72-control-tip`: tip, no preload: 3/3 pass.
- `t72-red-tip`: tip under the preload: 3 fail.
  - `win-sampler.test.mjs:157` "the poller child is reaped on stop" (`true !== false`), and `:205`.
  - `loop.test.mjs:450` "the host is gone".
  - The 449 loop ran its full 10 s (gone = false), and `[reuse-pid] signal SIGKILL delivered to the stranger at pid …`: the old cleanup would have killed a stranger.
- `t72-red3-preflight`: after the host fix, under the preload: `loop.test.mjs:450` "its preflight is gone too" (`false !== true`), the stranger SIGKILL again.
- `t72-green-plain` and `t72-green-reuse`: 7/7 each, the targeted checks plus 3 new identity tests and the PowerShell guard. Under the preload, no signal reached a stranger.

**New tests (adversarial, in CI on every leg), loop.test.mjs "Process identity":**
- A fake `/proc` where the pid's start time changes ("a reused pid is another process") and where the pid vanishes. `identityOf` refuses a pid that has no process.
- Unknown answers throw: Windows status 1, status null (timeout), empty stdout; truncated stat.
- A live child keeps its identity until reaped, then no process is it.
- win-sampler.test.mjs "every PowerShell we start silences progress" now also covers the identity script.

**Mutations** (committed first; each restored with `git checkout 8fda747 -- <file>`; `git status` and `git diff 8fda747` were clean after each; logs `reports/t72-mut{1..5}.log`):
- M1, the poller is never reaped (`stop()` resolves at once; the units-failure path does not kill): win-sampler :157 "the poller child is reaped on stop" and :203 "the poller is reaped" both fail. The file then hangs on the live fake pollers until the 300 s cap.
- M2, `killTree` does nothing: "the host is gone" fails.
- M3, `killTree` kills the host but not its group: "its preflight is gone too" fails. The host check passes, so the two checks are independent.
- M4, identity by pid alone (`startOf(..) !== null`), under the preload: "a reused pid is another process", the live-child test and "its preflight is gone too" fail.
- M5, an unknown Windows answer read as gone: "an unknown start time is never taken …" fails.
- The windows-only checks (347, 374) cannot run here. 347 uses the same `pollerRunning()` as 157/205 (M1). 374 uses the same `isSameProcess` as 449 (M4). A mutation of the Job Object itself (no KILL_ON_JOB_CLOSE) is left to a windows leg.

**Suites (merged tree 5a03b56):**
- kit: 819 tests, 800 pass / 0 fail / 19 skipped (`t72-test`; +3 identity tests).
- proxy: 1384 pass / 0 fail (`t72-proxy`).
- mcp: 97 tests, 96 pass / 0 fail / 1 skipped (`t72-mcp`); `dist/` unchanged.
- Memory loop S3/omp short (`t72-s3omp`, port 19720), because `omp-host.mjs` changed: RED on `omp:concurrent-preflights` only (5 procs), the listed RED owned by 35. Orphans 0, starter killed, peak:kit 371.9/596 MB. Same shape as `fixtures/local-20261107-s3-omp-linux-summary.json`.
- No expected-red entry for this ticket. All runs used fixtures and loopback only (no external host). The killed-starter test's extension port 19031 predates this ticket and is never listened on.

**Decisions:** a handle check where the code owns the ChildProcess (smaller and exact), identity only for processes without a handle. 20 s deadline on the Windows grandchild wait. The extra lines (449, the cleanup kills, `killTree`'s Windows `taskkill`) have the same root cause and were fixed here. Changes to existing tests (C2) keep their titles and intent; only the way "gone" is judged changed.

**Pending CI (orchestrator verifies after merge+push):**
1. In every windows test-kit leg (Node 24 and 26), these show ✔:
   - win-sampler "…reaps the poller" and "a units self-test failure stops …";
   - loop "Windows: the sampler excludes its own poller …", "Windows: closing the Job Object kills a detached grandchild …", "killing a starter host …";
   - the 3 "Process identity" tests (the live-child one runs PowerShell on windows).
2. "closing the Job Object …" stays well under its 20 s wait. Its stdout carries `GRANDCHILD <pid> <FILETIME>`, and a failure message "start time of pid … unknown" means PowerShell/CIM failed, not the job.
3. ubuntu legs stay green.

**Left for another ticket (not done here):**
- `lib/freeze.mjs` `whileFrozen` thaws if `alive(pid)` (pid only). On Windows, a dead hung proxy's reused pid gets `NtResumeProcess`. If that fails (access denied), the run is a harness failure, so a reuse can fail an S3/hung run. The poll's `created` would give the identity.
- `lib/sampler.mjs` `scanWindows` filters the latest poll with a pid-only `alive`, so a reused pid keeps a dead process in `scan()` until the next poll.
- `loop.test.mjs` orphan test `finally`: it kills its orphans by pid. They sleep 30 s, longer than the test runs, so the risk is low.
- Ticket 70's kit-side note (stop path `waitForExit` by pid) stands.

- Merged 2026-11-08 as 9e982959396383a1dd22118e0d17e631fc226665 (ticket/72-memory-tests-pid-identity at 271bdf7 into 3a796b4; first merge, never reverted, so no revert-of-revert step). No conflict; git auto-merged `tests/memory/loop.test.mjs` (shared with ticket 71). Fast suite on Bun 1.4.2: kit 866/884 (18 skipped, 0 fail; the first run had 1 fail, `tests/json-superset.test.mjs` "every --json output ... superset": `accounts health --json (down): exit 0, baseline 1`, the capture's "down" state seeing a listener on the shared fixture port 18458; ticket 72 does not touch that test or the capture; `node --test tests/json-superset.test.mjs` alone passed 3/3 and the full rerun was clean), proxy 1451/1451 (98 files), mcp 99/100 (1 skipped, 0 fail); `mcp/zcode-harness-mcp/dist/` unchanged after the build (B5); lockfiles unchanged (npm ci only). Memory-loop tests (`verdict`, `loop`, `win-sampler`): 204/209 (5 skipped, 0 fail). Memory loop `node tests/memory/job.mjs --os linux --only S3/omp,S3/hung` (port 19720): ratchet holds, exit 0; S3/hung RED only on tolerated checks (failed-launches, stale-lock-after-round: ticket 16; peak:kit, procPeak:launcher, procPeak:proxy: ticket 37); S3/omp RED only on omp:concurrent-preflights (ticket 35); summary under `/home/AgentKit/overhaul-tools/merge-72-memloop/`. Pre-merge CI: https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42483787372 (staging/72 on the tip with 67 and 36, all 8 jobs green). Sanity diff: staging/72's last commit (ee48822) merges the ticket into the tip 7555b87, so the `^1..` variant gives the ticket's 6 `tests/memory/` files; 5 are byte-identical to staging/72 after the merge; `loop.test.mjs` differs only by ticket 71's change (the staging/72..HEAD diff equals `git diff 7555b87 3a796b4` for that file, and this ticket's diff on the tip equals its diff on 7555b87, so 72's hunks are intact). The `^2..` variant lists the tip's files since the ticket forked (cli, lib, proxy, mcp, tests); of those, only ticket 71's `job.mjs`, `ratchet.mjs`, `loop.test.mjs`, `verdict.test.mjs` differ from HEAD. All 11 non-.scratch differences between staging/72 and HEAD equal `git diff 7555b87 3a796b4` exactly, all from ticket 71 (merge a8e18f5). Logs: `reports/merge-72-{npmci,kit,kit-jsonsuperset-rerun,kit-rerun,proxy,mcp,memtests,memloop}.log`.
