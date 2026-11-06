# 02: Windows sampler and the windows leg of the `memory-budget` job (Bun 1.4.2 reference run)

**Blocked by:** 01 (Memory loop with budgets, process-count harness, expected-RED ratchet and the ubuntu `memory-budget` job)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0016

**What to build:** The loop runs on windows-latest. One long-lived `powershell.exe -NoProfile -NonInteractive` child polls `Win32_Process` every second and is reaped on exit. Kit processes are found by the tree from the loop root plus a run-unique token in the command line or executable path. Mapping: `rss_kb` = WorkingSetSize/1024, `commit_kb` = PrivatePageCount/1024, `hwm_kb` = PeakPageFileUsage, `threads`, `fds` = HandleCount. RED rules use commit on Windows. The windows job leg runs S1, S2 (offline fixture), S3, S4, S5 and S7 under a Job Object cap and a timeout.

**Acceptance criteria:**

- [ ] Self-tests on windows-latest: the units check against `Get-Process` `PrivateMemorySize64` passes; a deliberately orphaned detached process is found; the sampler excludes itself by PID and its measured overhead is recorded.
- [ ] `expected-red.json` gains a `windows` key whose entries come from the first windows run (expected: S1 burst variants → 19, S2/short → 58, S3/short → 37, S3/hung → 16, S4/short → 17, S5/short → 30, S7/short → 34). Any scenario RED **only on commit** is raised to the owner, never adjusted silently (build-time gate 3).
- [ ] The Bun 1.4.2 Windows reference run (the draft PR's first CI run on this code) is recorded in METRICS.md. If the sampler cannot run on the pre-upgrade code, the reason is in RUNLOG and ticket 11's 1.4.4 run becomes the reference.
- [ ] The windows job leg is green with its list.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 30, 141

## Comments

### 2026-11-06 — implementer (claude-opus-5-5, logged substitute for gpt-6.1-sol-subagent)

Branch `ticket/02-windows-sampler`. Code head fbad218, which includes the merge of the integration tip 3f4e41a as 883fe07. Bun 1.4.2 (ticket 11 not merged), Node 26.7.0, ports 19020–19022. This machine has no Windows and no PowerShell. Everything Windows-only was built against recorded `Get-CimInstance` / `Get-Process` / `netstat` output, and its live proofs are tests that run on windows-latest: **pending CI (orchestrator verifies after merge+push)**.

**What landed**
- `tests/memory/lib/win-sampler.mjs` is the Windows sampler. It has these parts:
  - **Poller:** one long-lived `powershell.exe -NoProfile -NonInteractive` child. It gets its script as `-EncodedCommand`, so no quoting is involved. It polls `Get-CimInstance Win32_Process … | ConvertTo-Csv` every interval and writes framed blocks (`@@UNITS`, `@@POLL <pid> <ms>`, `@@ERROR`). It exits by itself when its parent pid is gone or its pipe breaks. The loop also kills it on stop and on exit, and it is unref'd so it never holds the event loop.
  - **CSV parser:** RFC 4180, with quoted commas, quotes and newlines.
  - **Spec mapping:** `rss_kb` = WorkingSetSize/1024, `commit_kb` = PrivatePageCount/1024, `hwm_kb` = PeakPageFileUsage, `threads`, `fds` = HandleCount. The working-set peak is kept in memory only.
  - **Kit tracker:** the tree below the loop root plus the run token. A parent seen once keeps its descendants visible, because Windows does not reparent. A child created before its alleged parent is a pid reuse and is not ours. The poller and its descendants are excluded by pid.
  - **Units self-test:** before any sample, the median ratios over all comparable processes are checked: commit_kb ÷ `PrivateMemorySize64`, rss ÷ `WorkingSet64` (both within ±20 %), and hwm ÷ private (in [0.95, 64]). A failure stops the sampler before it writes anything, so the run is a harness failure.
  - **Overhead:** the poller's own peak commit and working set, and its poll time.
- `lib/sampler.mjs`:
  - `startSampler` has a Windows backend, plus `ready` (resolves after the units self-test) and `overhead()`;
  - `scan()` on Windows returns the latest poll filtered by liveness, or takes a fresh one-shot poll when no poller is live (for example `survivors()` after stop);
  - `portsOf`, `connectionsOf` and `externalConnections` read `netstat -ano` (`lib/win-net.mjs`);
  - the CSV row now writes `commit_kb`. Linux bytes are unchanged: the column stays empty.
- `lib/verdict.mjs`:
  - `osVerdict` judges RSS on Linux and commit on Windows (any row carrying `commit_kb`);
  - on Windows it computes the working-set verdict too and sets `redOnlyOnCommit`;
  - `rowsForMetric` maps the rows to either metric.
- `run.mjs`:
  - on Windows the run gets its own bun (`prepareRunBun`: a hard link, or a copy across volumes, under `<out>/<run id>/bun/bun.exe`) as `ZCODE_KIT_BUN`. So the proxy and the S2 body carry the run id in their executable path, also as orphans;
  - it awaits `sampler.ready` and judges with `osVerdict`;
  - `summary.json` gains `metric`, `workingSet` and `redOnlyOnCommit` (all additive), and `notes.sampler` (`units`, `overhead`).
- `lib/caps.mjs` holds the cap logic moved out of `job.mjs`. The Linux caps are byte-identical. It adds `jobobject`, a PowerShell 5.1 wrapper whose Add-Type C# does the following:
  - creates a Job Object with `JOB_OBJECT_LIMIT_JOB_MEMORY` and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`;
  - puts itself in it, reads the limit and flags back, then starts the run with inherited std handles, so the run and all its descendants (the detached proxy too) are in the job;
  - reports `@@JOB applied=… limit=… peak=…`.
- `job.mjs`:
  - `--os windows` and `--cap jobobject` (auto on win32);
  - the Windows timeout kills the wrapper, and closing the job kills the tree. That counts as exit 124, a harness failure;
  - a run without a proven cap (`applied=0` or no report) is a harness failure, so the job never runs uncapped;
  - timeouts are ×2 on windows;
  - the summary lists runs RED only on commit "raised to the owner" and the poller overhead per run.
- `lib/catalogue.mjs` adds `JOB.windows`: the linux runs minus S6. `expected-red.json` gains the `windows` key with the entries this ticket expects: S1 burst4/16/32/bigbody → 19, S2 → 58, S3/short → 37, S3/hung → 16, S4 → 17, S5 → 30, S7 → 34.
- Scenarios on Windows:
  - **proxy-session isolation proof:** another process's environment is unreadable on Windows. The proof is that the proxy's executable is the run's bun (via `processCommandLine`), that its only listener is the isolated port, that `/health` answers with the run's key, and that it has no external connections.
  - **S3:**
    - an npm-style `opencode.cmd` shim (the only `.cmd` form `lib/process.mjs` runs) and a case-insensitive `PATH`;
    - the hung proxy is frozen with `NtSuspendProcess`/`NtResumeProcess` (`lib/win-process.mjs`);
    - the kill-holder adversary keeps looking until the next poll shows the holder (it still signals only marked processes).
  - **S2:** marks carry `footprintMB` (`Bun.unsafe.memoryFootprint()`, present in 1.4.2), and the Windows mark numbers use it.
  - **S5:** the bridge figure uses commit on Windows.
  - **reverdict:** uses `osVerdict`.
- CI: `memory-budget` is a matrix {ubuntu-latest, windows-latest}. The windows timeout is 150 min, `--out "${{ runner.temp }}/memloop"` works in both shells, and the artefacts are `memory-budget-linux` / `memory-budget-windows`.
- New test file `tests/memory/win-sampler.test.mjs`, wired into `npm run test`. The wiring guard passes. Fixtures are in `tests/memory/fixtures/win32/`: `cim-poll.csv`, `cim-poll-commit-in-kb.csv`, `get-process.csv`, `netstat-ano.txt`, the `fake-poller.mjs` replayer and `job-probe.mjs`.

**Tests (after merging the integration tip 3f4e41a)**
- `npm run test`: 382 tests, 366 pass, 0 fail, 16 skipped. The tip has 361 / 350 / 11, so this ticket adds 21 tests. The 5 new skips are the live Windows self-tests, which run on the windows-latest `test-kit` legs. Log: `reports/t02-full-kit.log`.
- `npm run test:proxy`: 1343 pass, 0 fail, 90 files.
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped (live). `git status` is clean after the build.
- Live Windows self-tests in `loop.test.mjs` (skipped off Windows):
  - the units check against `PrivateMemorySize64` on the live table;
  - a deliberately orphaned detached process is found, both by the token (parent gone before any poll) and through a parent seen earlier (grandchild without the token), live and by a fresh poll after stop;
  - the poller is never sampled, its overhead is recorded and it is reaped;
  - the Job Object is applied and read back, and 2 GB inside a 1 GB job fails;
  - closing the job kills a detached grandchild.

**RED → GREEN evidence** (logs in `reports/t02-red*.log` / `t02-green*.log`)
- Each slice went RED first: a missing module or export, or a failing assertion. Then GREEN.
  - CIM mapping;
  - tracker (tree, token, self, pid reuse, orphan through a dead parent);
  - units self-test (pass, unit slip, too few processes);
  - Windows sampler backend through the fake poller;
  - netstat;
  - `osVerdict` (commit judged, RED only on commit, Linux unchanged);
  - windows leg list plus `expected-red.json`. Adding the `windows` key first made the committed-list test fail with "not run by the windows job";
  - caps (jobobject, Linux unchanged, `@@JOB` report).
- The unit-slip test found a real flaw while still RED. The first version filtered processes by the mapped value, so a KB/bytes slip silently made every process "not comparable". It now filters by the reference only.
- Mutation proofs were run in a scratch copy, because the Linux job was running from the worktree. Each mutant failed the named tests, and the copy was restored and diffed identical:
  - `MemorySwapMax=0` dropped → "Linux caps are unchanged" fails (`t02-mutant1`);
  - the rss metric drops VmHWM on Linux rows → "Linux samples keep the RSS verdict" fails (`t02-mutant2`);
  - the creation-time check removed → the pid-reuse, tree and backend tests fail (`t02-mutant3`);
  - self-exclusion removed → the tracker and backend tests fail (`t02-mutant4`).
- Mutant 3 also showed that a failing assertion left the fake poller running and hung the file (120 s). Fixed: the poller is unref'd and the tests stop samplers in `finally`. Rerun `t02-mutant3b`: it fails in 0.9 s.

**Memory loop, Linux leg (unchanged code path), short profile**
- Full job on the branch before the tip merge: `reports/t02-linux-job.log`, 2,197 s, `/home/AgentKit/overhaul-tools/t02-memloop/linux-job/`. Every listed run was RED, as in ticket 01, with the same numbers (S3/short kit 849.3 MB, launcher 78.2, bridge 85.9; S3/hung 11 failed launches, 2 stale locks; S2 retained 685 MB, CDN +149 MB). The S1/short and S1/stalled runs were GREEN.
- **The ratchet failed on S1/burst1** (procPeak 256.7 MB > 250). This is a pre-existing flake, not this ticket. Reruns of `--only S1/burst1` gave:
  - branch: 237.7 / 236.7 / **264.6** MB;
  - integration tip 3f4e41a, in a scratch worktree since removed: 236.6 / **299.2** / 237.5 MB.
- The Linux burst path is untouched here: on Linux, `osVerdict` is the old verdict (pinned by a test and by mutant 2). Neither the list nor the budget was adjusted; this is raised to the orchestrator (see below).
- After the tip merge, a job smoke (`--only S6/short,S7/short`) passed: the ratchet holds (`reports/t02-job-smoke.log`).

**Acceptance criteria**
- Self-tests on windows-latest (units, orphan, self-exclusion + overhead): written and wired. **Pending CI.**
- `expected-red.json` `windows` key: committed with the ticket's expected list, so the windows leg can land. **Pending CI:** the first windows run decides the final list. Any run listed there as RED only on commit (job summary section) goes to the owner, never adjusted silently. Expect S1/burst1 to be at risk on commit, given its Linux flake.
- Bun 1.4.2 Windows reference run in METRICS.md: a placeholder section with what to record. **Pending CI** (the draft PR's first CI run on this code). If the sampler cannot run there, the reason goes to RUNLOG and the 1.4.4 run becomes the reference.
- Windows job leg green with its list: **pending CI.**
- Common:
  - RED → GREEN at seam 1: done;
  - fast suites green on Linux: done (CI legs pending);
  - new test file wired: done;
  - one pre-existing test change, justified below;
  - no new log events, config keys or `ZCODE_PROXY_*` env overrides.

**Decisions**
1. The run token is the run id, put in each Bun process's executable path by a run-local bun hard link or copy. Node processes (launcher, manager, preflight, bridge) are found by the tree from `run.mjs`, which on Windows also covers detached ones once their parent was seen.
2. `conhost.exe` children of kit processes count as kit footprint (role `other`). Only the poller's own conhost is excluded, as its descendant.
3. The Job Object caps the whole tree (`JOB_MEMORY`), like the Linux cgroup scope, not each process. The wrapper sits in its own job, so its ~70 MB count toward the cap. The cap is far above every budget, so this is harmless and avoids a start-before-assign race.
4. Windows has no SIGINT/SIGTERM delivery to a child: Node's `kill` is TerminateProcess. So S4's "Ctrl-C during start" is a killed start on Windows, and the soak mock and orphan reaping are hard kills. The S3 hung proxy uses NtSuspendProcess instead of SIGSTOP.
5. Windows isolation is proven without reading the environment (see proxy-session above). The env facts are recorded as `null`.
6. `reverdict.mjs` on a Windows CSV judges the working set without its peak, because PeakWorkingSetSize is not a CSV column (the CSV schema is the spec's). The live run's `summary.json` uses the in-memory peak.
7. Windows timeouts are ×2, and the CI job timeout is 150 min. The Linux leg is unchanged (75 min).

**Pre-existing test change (C2)**
- `tests/memory/loop.test.mjs`: the `linuxOnly` skip used `supported()`, which is now true on win32. The two tests it guards pin /proc semantics: `commit_kb` empty, and an orphan found through the environment marker without a token. They now skip on `process.platform !== "linux"`. Their Windows counterparts are the new live tests. The assertions are unchanged.

**Left for others**
- Orchestrator: verify the windows `memory-budget` leg and the 5 live Windows tests on the draft PR. Then adjust `expected-red.json` `windows` to the first run, raise any RED-only-on-commit run to the owner, and fill the METRICS Windows reference table.
- S1/burst1's Linux flake at 250 MB is pre-existing and can fail the ubuntu ratchet intermittently. It belongs to ticket 19 or an owner decision; it was not touched here.
- Ticket 27: on Windows the solver child started from `process.execPath` inherits the run token through the run's bun. Its argv must keep `captcha-solver` (role), as ticket 01 noted.

Merged 2026-11-06 as 18351e1b29750156fa2d5e6574aae4f26878afcf; fast suite: kit 366/382 (16 skipped, 0 fail; includes tests/memory/win-sampler.test.mjs; the 5 new skips are the live Windows-only tests in tests/memory/loop.test.mjs), proxy 1343/1343, mcp 95/96 (1 skipped, 0 fail); mcp dist unchanged; no lockfile changes. Windows criteria pending CI (windows memory-budget leg, live Windows self-tests, expected-red.json `windows` entries and the METRICS Bun 1.4.2 Windows reference run; orchestrator verifies after push). Logs: .scratch/kit-overhaul/reports/merge-02-{npmci,test,proxy,mcp}.log.

- 2026-11-06 (orchestrator): per Round 6 Q2 this ticket stays open (Status claimed) until the calibrated windows memory-budget run is green.

- 2026-11-06 (orchestrator): REVERTED (revert of merge 18351e1) per run rules and Round 6 Q2: the first windows-latest memory-budget run (https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42221794531) reported every scenario GREEN in ~1 s with a Job Object peak of ~104 MB, i.e. the scenarios never ran (a harness failure presenting as GREEN; the ratchet then failed on 10 "GREEN but listed" entries). The live Windows self-tests in test-kit (windows, 24/26) passed. Fix on branch ticket/02-windows-sampler: make a run that does not reach its scenario a harness failure (exit 2), never GREEN, and get the scenarios to actually run on Windows. Log excerpt: /home/AgentKit/overhaul-tools/win-mem-1.log.
