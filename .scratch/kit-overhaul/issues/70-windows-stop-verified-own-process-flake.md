# 70: Windows: "stop cleanly kills a verified-own process" finds the process still alive (1 of 8 runs)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: sol
Risk: high
ADR: no

**What to build:** `tests/manager-safety.test.mjs:160` "stop cleanly kills a verified-own process (identity + pid + start time match)" failed on windows-latest Node 24 in CI run 42436186573 (staging/67, an identical tree that passed in 7 other runs): `AssertionError: the process must be gone` (true !== false) at :176, after 3.4 s. Decide with evidence whether the test checks too early (the kill is issued and the process exits later: Windows `taskkill /T` returns before the tree is gone) or whether the kit's stop can return success while its verified-own process is still alive (a real C1 defect: "every child is reaped on stop"). Fix the cause: a test waits on the observable event (process gone, with a bounded deadline) instead of a fixed time; a kit race gets a deterministic RED test first and a fix that keeps C6 (never kill without proof). Ticket 15 (proxy lifecycle module) is in flight and touches the stop path; coordinate by merging the integration tip often, and if 15 lands first, fix on top of its outcome records.

**Acceptance criteria:**

- [ ] Root cause shown with evidence (CI log of 42436186573; reproduction under load; Windows behaviour from primary docs for the kill primitive used).
- [ ] The test (or the kit) no longer depends on timing; a mutation that leaves the process alive still fails the test.
- [ ] Full suites green; windows test-kit legs green (pending CI).

## Comments

- 2026-11-08 (implementer, branch `ticket/70-windows-stop-flake`; implementation 5004c33, integration tip 6cd2ab5 merged as 0918c3d; head = the commit carrying this note).

**Root cause: PID reuse after a correct stop, not a kit defect and not a check that came too early.**
- **CI log** (42436186573, `test-kit (windows-latest, 24)`):
  - Just before the failure, the file prints `stopped (pid 1264)`. That is `stopVerified`'s success line.
  - The test took 3442 ms, which is normal. 28 windows test-kit legs read from 14 runs (staging/67, the integration branch, staging/68) passed in 2250–10318 ms, median ≈ 3.5 s. The failing leg is the only failure among them.
  - So stop took its ordinary path: identity, record and start time matched, PowerShell `TerminateProcess` was issued, and `killOwned` returned true.
- **Code (`proxy/zcode-proxy-manager.mjs`, `killOwned`/`waitForExit`)**:
  - Every `true` that `killOwned` returns is gated on `!pidAlive(pid)` after the signal. `pidAlive` fails closed: only ESRCH counts as dead.
  - On Windows, `process.kill(pid, 0)` is libuv `uv_kill`. It returns ESRCH only when `OpenProcess` fails with ERROR_INVALID_PARAMETER (no process object has that id), or when the opened object's exit status is not STILL_ACTIVE / the object is signaled (https://github.com/libuv/libuv/blob/v1.x/src/win/process.c, `uv_kill` / `uv__kill` case 0).
  - A process that has terminated cannot become live again. So stop's 0 proves that pid 1264's process was gone. 500 ms later `pidAlive(1264)` was true, so the PID then named another process.
- **Windows primary docs**:
  - PROCESS_INFORMATION: the PID "is valid from the time the process is created until all handles to the process are closed and the process object is freed; at this point, the identifier may be reused" (https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information). Also https://devblogs.microsoft.com/oldnewthing/20110107-00/?p=11803.
  - TerminateProcess "is asynchronous; it initiates termination and returns immediately … call WaitForSingleObject with a handle" (https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess). This is why the kit polls for the exit and does not trust the signal. The kit uses its own `OpenProcess`+`GetProcessTimes`+`TerminateProcess` script, not `taskkill /T`.
  - Nothing kept the PID pinned. The PowerShell script closes its handle. The test's own `ChildProcess` handle is closed as soon as libuv processes the exit: `uv__process_proc_exit` "Clean-up the process handle eagerly", and that runs during `waitForExit`'s 300 ms sleeps. From then on the PID was free, and on a runner where `node --test` runs files concurrently (PowerShell, node and bun spawns) a new process could take it inside the 500 ms sleep.
- **Hypothesis (a), "the test checks too early", refuted.** Probe `t70-scratch/late-exit.mjs`: a verified-own dummy that traps SIGTERM and exits 0 / 1.5 / 4 s later. stop returned 0 after 339 / 1830 / 4236 ms, each time after the exit event, with the child handle reporting gone (`reports/t70-late-exit.log`). stop never reports success before the process is gone. No C1 defect, and C6 is untouched (no kit change).

**Fix (test only).**
- `tests/manager-safety.test.mjs:160`: the 500 ms sleep and the PID probe are replaced by `dummy.kill(0) === false`. Node's `ChildProcess.kill(0)` asks the child's own handle (`this._handle.kill`). That handle pins the process object, so it cannot see a reused PID, and once the exit is processed `_handle` is null and it answers false (https://github.com/nodejs/node/blob/main/lib/internal/child_process.js).
- No wait and no deadline are needed: stop's contract is to return only after the exit, so the check is synchronous and stricter than before. Decision: this departs from the ticket's suggested "bounded deadline". A deadline would also accept a stop that returns before the exit (see M2).
- The same PID-after-death assertion in `tests/manager-audit.test.mjs:80` (hung recovery, same `killOwned` path, a direct child) got the same change. This is a C2 change to an existing test, justified as the same root cause. Its title and intent are unchanged.

**RED → GREEN.**
- Linux cannot be made to reuse a chosen PID here: unprivileged user namespaces are blocked by AppArmor, so `ns_last_pid` is out of reach. Reuse is simulated at the process-table boundary by the scratch preload `t70-scratch/reuse-pid.mjs`: after the first ESRCH for a PID it has seen alive, `process.kill(pid, 0)` answers "alive", as a reassigned Windows PID would.
- `t70-red1`: tip test under the preload prints `stopped (pid N)`, then `AssertionError: the process must be gone`, `true !== false` at `manager-safety.test.mjs:176:12`. This is the exact CI shape.
- `t70-red2-audit`: the tip's manager-audit hung test under the preload fails with `the hung process is gone`, `true !== false`.
- `t70-green1`: both fixed tests pass under the preload.
- Under load (8 busy loops on 8 cores), 20 iterations each: `t70-load-natural` 20/20 and `t70-load-reuse` 20/20 passed.

**Mutations** (committed first, restored with `git checkout 5004c33 -- proxy/zcode-proxy-manager.mjs`; `git status` was clean after each):
- M1, stop returns 0 without killing (`if (false && !await killOwned(…))`): `t70-mut1` fails `the process must be gone` in 48 ms.
- M2, stop returns before the exit (`waitForExit` returns true at once): `t70-mut2` fails both fixed tests. The tip's test passes M2 (`t70-mut2-tiptest`), because its 500 ms sleep hid an early return.

**Suites (merged tree):**
- kit: 816 tests, 797 pass / 0 fail / 19 skipped (`t70-test`).
- proxy: 1384 pass / 0 fail (`t70-proxy`).
- mcp: 97 tests, 96 pass / 0 fail / 1 skipped (`t70-mcp`).
- mcp `dist/` unchanged. Memory loop not run: no scenario or kit code touched. No expected-red entry.

**Ticket 15:** not landed (`ticket/15-proxy-lifecycle-module` 83eda31 is not an ancestor of 6cd2ab5). It does not touch either test file. Its `lib/proxy-lifecycle.mjs` keeps the same contract (`killOwnedIn` returns true only via `waitForExit`/`!pidAlive`), so this fix holds on top of it.

**Pending CI (orchestrator verifies after merge+push):**
1. In every windows test-kit leg (Node 24 and 26), `stop cleanly kills a verified-own process …` and `start terminates a proven hung own proxy …` show ✔.
2. `stopped (pid N)` is present, and the durations stay in the known ranges (≈2–10 s and ≈6 s). The check is synchronous, so a large jump means something else changed.
3. No `ERR_UNHANDLED_ERROR` / `kill EPERM` from `ChildProcess.kill(0)` in those files (it emits `error` on EPERM).
4. ubuntu and macOS legs stay green.
5. Count these two tests across every windows test-kit leg from here on. The ticket's rate is 1 in 8 runs, and (7/8)^r ≤ 0.05 gives r ≥ 23 runs (46 legs) with 0 failures for 95 % confidence that the old rate is gone. 12 runs give ≈ 80 %. The per-leg rate seen so far is lower (1/28 legs read here, 1/16 in Round 17), which would need more legs for the same confidence. The root cause and the fix are shown deterministically above, so CI confirms the windows semantics; it is not the proof.

**Left for another ticket (not done here):**
- Kit, fail-closed false negative, not observed: `waitForExit` also probes by PID. If Windows reuses the PID before the first 300 ms poll sees ESRCH, stop waits 5 s. The guard then sees a start-time mismatch and refuses to signal the stranger (C6 holds), and stop reports `ERROR killing pid` (code 2) although the proxy died. The fix belongs in the kill script: keep the `OpenProcess` handle and `WaitForSingleObject` on it after `TerminateProcess`. That is the stop path ticket 15 rewrites, so it is 15's or a new ticket's.
- Memory-loop tests with the same PID-after-death probe on Windows: `tests/memory/win-sampler.test.mjs:157,205` and `tests/memory/loop.test.mjs:347,374,450`. They hold no `ChildProcess` handle for those pids (pollers, grandchildren), so the fix there is different. No CI failure attributed to them yet.
