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

### 2026-11-06 — implementer, round 2 (after the revert of 18351e1 by c252676)

Branch `ticket/02-windows-sampler`. The fix commits sit on top of ba7a8cc: 18d852c, b3393a3, 06ab74d, and this note. Per the orchestrator, the integration tip is NOT merged, because it contains the revert. The merger reverts the revert and merges this branch.

**What happened in CI run 42221794531 (windows-latest)** — evidence: `/home/AgentKit/overhaul-tools/win-mem-1.log` and the downloaded `memory-budget-windows` artefact in `/home/AgentKit/overhaul-tools/t02-ci-artifact-42221794531/`.
- Every run directory holds only `run.log` and a `samples.csv` with the header line. There is no `summary.json` and no sample.
- `run.log` holds nothing but the wrapper's `@@JOB applied=1 … peak≈104 MB` and a CLIXML progress record.
- `job-summary.json`: `exitCode 0`, `rawExit 0`, `metric null`, `samplerOverhead null` for all 13 runs, so the job called them GREEN.

**Root cause.**
- `run.mjs` reached `startSampler` (the CSV header was written) and then awaited `sampler.ready`.
- On Windows, `ready` depends only on the poller's units frame. Commit e1fab6c had unref'd the poller child and its pipes, so nothing held the event loop. Node exited with `main()` still pending and with exit code 0.
- The peak of ~104 MB is the wrapper PowerShell plus a node that did nothing.
- The live self-tests on the `test-kit` legs passed because the node:test runner keeps its own process alive.
- The CLIXML lines are PowerShell 5.1 progress output ("Preparing modules for first use") on the redirected stderr. They are noise; they did not break `@@JOB` parsing.

**Fixes**
1. The poller stays referenced (`lib/win-sampler.mjs`). RED → GREEN test: "the Windows sampler keeps its process alive until the poller answers".
   - The test runs a separate node process whose only pending work is the sampler, with the fake poller answering after 300 ms.
   - RED on ba7a8cc: exit 13 (Node's unsettled top-level await) and no `READY` (`reports/t02-r2-red1.log`). GREEN: `t02-r2-green1`.
2. **A run that did not run its scenario is a harness failure (exit 2), never GREEN** (`lib/completeness.mjs`, used by `job.mjs`). Exit 0 or 1 counts only together with a `summary.json` that meets all of these:
   - its key and outcome match the exit code;
   - samples and scenario time are at or above a per-scenario floor (S1 5 samples / 10 s, S2 30 / 60, S3 10 / 15, S4 30 / 60, S5 60 / 120, S6 1 / 1, S7 15 / 30);
   - every scenario role was seen at least once (S1 and S7: proxy; S2: scenario; S3: proxy, launcher, preflight, mcp-bridge; S4: proxy, manager; S5: mcp-bridge; S6: none);
   - on Windows, the metric is commit and the units self-test passed (Round 6 Q2 condition 2).

   The floors are about half the shortest real Linux run. S6 needs no role because its 3 s runs often sample no process (2 samples, no role, on Linux).
   - The job summary now shows samples and roles seen per run.
   - `run.mjs` exits 2 unless `main()` settles; this is defence in depth, with no test of its own (see Decisions).
   - `job.mjs --run-script` lets tests replay the symptom with `tests/memory/fixtures/fake-run.mjs`.
   - RED on the stubbed gate: both job-level tests reported `actual: 'GREEN'` (`t02-r2-red2`).
3. **PowerShell progress noise.** Every PowerShell we start (poller, Job Object wrapper, suspend) sets `$ProgressPreference = 'SilentlyContinue'` as its first statement and runs with `-OutputFormat Text`. The frame parser finds a frame head even when CLIXML is glued to it without a newline: before the fix, the units frame was lost and the run would have hung until its timeout. RED: `t02-r2-red3`.
4. Found in review, before the next CI run could show it:
   - The loop's own tooling (`netstat`/PowerShell/`where` started by the loop root, plus their conhosts) is role `tooling`: visible, but neither kit footprint nor an orphan. Before this, every `portsOf`/`processCommandLine`/suspend call could add a PowerShell (~60–70 MB) to the S3 kit total, and a leftover `netstat` would have made every run RED on orphans.
   - The kit's own PowerShell (children of kit processes, such as the manager's identity check) stays counted.
   - RED: `t02-r2-red4` (roles all `other`) and `t02-r2-red5` (survivors included 2800).
5. The CI `run.log` became a fixture as `ci-42221794531-run-log.txt`. The name `.log` is gitignored (`.gitignore:34`); without the rename CI would have lacked the file.

**Mutation proofs** (scratch copies; each copy restored and diffed identical):
- A, poller unref'd again → the keep-alive test fails.
- B, evidence gate bypassed in `job.mjs` → both job tests fail.
- C, duration floor dropped → the empty-run test fails.
- D, units check dropped → the evidence test fails.
- E, `parseJobReport` reads only the first line → the real-CI-log test fails (it is a preservation test, so this is its proof).
- F, the old frame parser → the CLIXML frame test fails.
- G, tooling role removed → the tooling and survivors tests fail.
- H, the survivors filter removed → the survivors test fails.

**Tests (branch head, Linux)**
- `npm run test`: 392 tests, 376 pass, 0 fail, 16 skipped (the 5 live Windows tests among them). Log: `reports/t02-r2-final-kit.log`.
- `npm run test:proxy`: 1343 pass, 0 fail.
- `npm run test:mcp`: 95 / 96, 0 fail, 1 skipped.
- Full Linux memory job with the gate: `reports/t02-r2-linux-job.log`, 2,183 s, **the ratchet holds**.
  - All 14 real runs pass the evidence gate. The smallest margins are S1/burst1 (20 s, 19 samples, proxy seen), S3/short (32 s, 118 samples, all four roles) and S6 (3 s, 2 samples).
  - S1/burst1 was GREEN this time; its flake is Round 6 Q1's.
  - Ticket 16's S3/hung and the rest: RED as listed.
  - The job started from the working tree with fixes 1–3. Fix 4 (`tooling`) landed while it ran; on Linux it is a no-op, because no `tooling` role exists there.

**What the next windows CI run must show** (Round 6 Q2) before any `windows` entry changes:
- each run's `scenarioS` and `samples` well above the floors (expect minutes, not 1 s);
- `rolesSeen` with the scenario's roles;
- `metric: "commit"`;
- `units.ok: true`;
- `samplerOverhead` present;
- `samples.csv` rows with `commit_kb` filled in;
- no harness failures.

If the scenarios still end early, they now show as `HARNESS FAILURE — no evidence the scenario ran: …` with the reason, never as GREEN. A guessed entry may be removed only with those numbers (Q2 condition 2). A run RED only on commit goes to the owner (Q2 condition 1).

**Decisions**
- The evidence floors are data-derived and per scenario, not per variant. A scenario that gets genuinely faster than half its shortest real Linux run would trip the gate; a tighter fix ticket must then lower its floor with its own numbers.
- `run.mjs`'s default exit 2 has no test of its own: provoking an empty event loop in `run.mjs` would need a scenario hook in production loop code. The job-level gate covers the same failure and is tested and mutation-proven.
- The S1/burst1 Linux flake is still open on this branch. Round 6 Q1 puts its median rule on the integration branch before 02 merges.

### 2026-11-06 — implementer, round 3 (pre-merge CI run 42246379763 on staging/02)

The evidence gate worked: the windows runs that did not run their scenario now report harness failures. S2 ran (RED, ticket 58) and S5 ran (GREEN, 713 samples). Two Windows-only defects remained; both are fixed in the commit after a12ab94, still with no merge of the integration tip.
1. **Config template with CRLF.** Every proxy run (S1, S3, S4, S7) failed in `isolatedConfig` with `missing "claim:\n  enabled: false"`. The Windows checkout converts `proxy/config.example.yaml` to CRLF (core.autocrlf), and the contract strings are LF.
   - Fix: `isolatedConfig` normalises the template to LF before filling it, and takes an optional `template` (the default is the file).
   - Why not `.gitattributes`: the shipped template's line endings on Windows checkouts belong to the product, not to the test loop, and this defect is in the loop's parsing. The current `.gitattributes` pins only `*.sh`, `*.ps1` and `*.cmd`.
   - RED: the test first passed vacuously, because `isolatedConfig` ignored the passed template. After the parameter was added and before the fix, it reproduced the exact CI error (`reports/t02-r3-red1b.log`). GREEN: `t02-r3-green1`.
2. **`timeout` on Windows.** The fake-run fixture itself calls no utility. `job.mjs --cap none` wrapped every run in GNU `timeout`, and on Windows that resolves to TIMEOUT.EXE ("Invalid syntax"), so the stand-in run exited 1 with no summary.
   - Fix: `commandFor("none", …)` on win32 runs `node run.mjs …` directly, and the job enforces `timeoutMs` itself. Linux is unchanged (pinned).
   - The fake run's `green-complete` summary now matches its OS (on Windows: commit and a passed units self-test). Without this, "a run with real evidence keeps its verdict" would still fail on Windows, because the gate rejects a Windows summary without commit.
   - RED: `t02-r3-red1` (the argv still began with `timeout`).

The REDs are the mutation proofs: removing either fix brings its RED back.

Tests (Linux):
- `npm run test`: 394 tests, 378 pass, 0 fail, 16 skipped;
- `npm run test:proxy`: 1343 pass;
- `npm run test:mcp`: 95 / 96, 1 skipped;
- a real job smoke `--only S7/short` builds the config from the template: RED (listed, ticket 34), 96 samples, proxy seen, the ratchet holds (`reports/t02-r3-job-smoke.log`).

What CI must show next:
- test-kit windows: the three `job:` tests pass;
- memory-budget windows: S1, S3, S4 and S7 run with samples and roles over the floors, and no `config template contract` failure.

Any remaining harness failure arrives with its reason.

### 2026-11-06 — implementer, round 4 (pre-merge CI run 42252896054 on staging/02 fdce519)

Evidence: `/home/AgentKit/overhaul-tools/t02-winmem-3.log` and the `memory-budget-windows` artefact, downloaded to `/home/AgentKit/overhaul-tools/t02-ci-artifact-42252896054/`. Fix commit e35742f; no tip merge.

**(1) S3/hung exit 2 although its verdict was complete.** The exit 2 was not a cleanup step: it was my evidence gate. The job line reads `S3/hung: harness failure: no evidence the scenario ran: role mcp-bridge never seen`. On Windows every S3/hung launch failed (21/21):
- kill-holder-10: 1/10 failed;
- hung-10-with-stale-lock: 10/10 failed, "safe start refused … No takeover attempted";
- hung-10: 10/10 failed, "safe start failed".

So no session ever started a bridge, and failed launches are what the scenario measures.
- Fix: S3's evidence roles are now proxy, launcher and preflight. The run then keeps its real verdict.
- RED: `t02-r4-red1`. Mutant (bridge required again): the test fails (`t02-r4-mutJ`).

**The orphan (pid 3796, role proxy) is a real kit orphan, not the loop's suspended process.**
- 3796 appeared during `kill-holder-10` (0 proxies before, 1 after): it was spawned by the start-lock holder that the adversary SIGKILLed. Every later stop refused it:
  - hung-10's stop: "alive but nothing answers … ownership not proven: its start time is not determinable or not recorded";
  - the final stop, after the thaw, with /health answering: `start time of pid 3796 is not determinable — PID reuse cannot be ruled out, refusing to kill` (`verifyOwnProcess` → `start-unknown`).
- Code: right after spawning, the manager writes `proxy.pid` with `startedMs: null` (`zcode-proxy-manager.mjs:632`) and fills in the start time only after `processStartMs` answers (:639). On Windows that is a PowerShell call of up to 2 × 2.5 s; on Linux it is a `/proc` read.
- A start killed inside that window leaves a record without a start time, and every later stop then fails closed (`verifyOwnProcess`: recorded null → `start-unknown`). The proxy can never be stopped by the kit, and the run ends with it alive.
- On Windows the window is wide, and the adversary sees the holder only at the next poll, so the kill lands inside it. On Linux it practically never does.
- This is a kit lifecycle defect of a killed start on Windows (ticket 16/17 territory: killed lock holder). It is not caused by the loop.

Harness hardening so the orphan check stays honest:
- the hung rounds freeze and thaw through `lib/freeze.mjs` `whileFrozen`. The thaw always runs. It is skipped only when the process is gone, which happens on Linux when the kit's hung-own recovery killed it (this round 4 change briefly broke Linux S3/hung with `kill ESRCH` until fixed). A thaw that fails is a harness failure, never an orphan;
- S3 now records `cleanup.pidRecordLeft` (the kit's pid record of any proxy it could not stop), so the next windows run shows directly whether the record lacks `startedMs`.

RED: `t02-r4-red1` and `t02-r4-red3`. Mutant (thaw failure swallowed): the test fails (`t02-r4-mutI`).

**(2) S3/short `exactly-one-proxy-after-round` (1 round): a real outcome, not an artefact.** In round kill-holder-10:
- `maxSimultaneousProxies 0`, `distinctProxyProcesses 0`, `proxiesAfter 0`, `pidFileMatchesListener false`;
- 10/10 preflights failed;
- the stop answered "stale … manager start lock (holder pid 2044 is not alive) — refusing automatic takeover".

There is no second proxy and no double count. The holder was killed before it spawned a proxy, and the stale lock then blocked every launch: the round ended with zero proxies. The other three rounds each show exactly 1 proxy, 1 listener and a matching pid file. Same defect family as Linux S3 (stale lock after a killed holder). On Windows it also shows as "zero proxies", because the kill lands at a different point of the start.

**What counts as kit footprint on Windows** (S3/short samples, by parent):
- `other` holds PowerShell started by the kit itself: by the launcher, the manager (identity and start-time proofs, one with an Add-Type `csc.exe` compile) and the preflight. Each is ~65–72 MB commit / ~80 MB working set, plus its conhost.
- These are counted as kit footprint, correctly. They are a Windows finding for the S3 600 MB total.
- One misattribution was fixed: a conhost under a fixture (the fake harness's `--version` probe, the mock) counted as kit. It now takes its fixture owner's role. Under a kit process a conhost stays `other`, so it is never counted as a second proxy. RED: `t02-r4-red2`.

**For the record (owner proxy calibrates; `expected-red.json` untouched):**
- S1/short RED only on commit (`procPeak:proxy`, `steady:proxy`);
- S1/burst1 and S1/stalled RED on both metrics;
- S5 GREEN with 717 samples and the bridge seen.

**Tests:**
- `npm run test`: 398 tests, 382 pass, 0 fail, 16 skipped;
- `npm run test:proxy`: 1343 pass;
- `npm run test:mcp`: 95 / 96, 1 skipped.
- Linux job `--only S3/short,S3/hung`: both RED as listed, the ratchet holds (`reports/t02-r4-s3-job2.log`; hung 188 s, 514 samples).

**What CI must show next:**
- **memory-budget windows:** S3/hung ends RED (exit 1), not HARNESS FAILURE.
  - If its orphan remains, `notes.cleanup.pidRecordLeft` shows the kit's record. Expected `startedMs: null`, which would confirm the killed-start window.
  - No `could not thaw` harness failure.
- **memory-budget windows, other runs:** no harness failure. `other` in the S3 roles no longer includes fixture conhosts.
- **test-kit:** 4/4 green; **memory-budget ubuntu:** green.

### 2026-11-06 — implementer, round 5 (staging/02 82de0da: only test-kit windows/26 red)

`loop.test.mjs` "whileFrozen thaws after the work, …" used the fake pids 7 and 8 without an `alive` function, so it asked the host's process table. On windows-latest/26 the host answered "gone" for pid 8 and the thaw was skipped (`/home/AgentKit/overhaul-tools/t02-win26-r4.log`). This was a test defect, not a harness defect.
- **Reproduced on Linux:** with the default liveness forced to "gone" in a scratch copy, the test failed exactly as on Windows (`actual: ['freeze 7','work','freeze 8']`, `reports/t02-r5-red1.log`).
- **Fix:** the test injects `alive: () => true`. It is now OS-neutral: with the host liveness forced to "gone" it still passes (`t02-r5-hostgone`).
- **Mutation proof:** `whileFrozen` without a thaw after a failing round → the test fails (`t02-r5-mutK`).
- **Suites:** `npm run test`: 398 tests, 382 pass, 0 fail, 16 skipped.
- `expected-red.json` is untouched.

### 2026-11-06 — implementer, round 6 (Owner Proxy Round 7)

Commits 06b507d (Round 7 Q1/Q2) and 6e2f21a (Round 7 Q3 calibration, METRICS reference run); no tip merge.

**Q1 — metric split on Windows** (`lib/verdict.mjs` `osVerdict`, `WS_GATED_ROLES`, `windowsGate`):
- **Working set** gates the per-process peak and steady budgets of proxy, launcher, mcp-bridge and preflight: the max of sampled WS and PeakWorkingSetSize.
- **Commit** gates the S3 total, every growth check and every solver/S2 check (`procPeak:solver`, `procPeak:scenario`, cost per generation, extras).
- Every memory check carries `commitValue`, `wsValue` and `gate`. `run.mjs` prints both on each check line, and the job summary lists every memory check as "commit X / WS Y (budget, gate)" (`memoryChecks` in `job-summary.json`).
- **Backstop:** in the paced runs (S1/short, S1/stalled, S3, S4, S7), `commit-backstop:proxy` is RED when any proxy sample's commit exceeds 512 MB (ADR-0008 soft limit). Windows only; on Linux no check is added.
- `samples.csv` gains the additive `ws_peak_kb` column (PeakWorkingSetSize; empty on Linux). `parseSamplesCsv`/`rowsFromSamples` read it, so `reverdict.mjs` reproduces the WS verdict from the artefact.
- RED → GREEN: `t02-r6-red1` (7 failing: the Round 7 Q1 condition 4 cases plus the budget pin), `t02-r6-red2` (column), `t02-r6-red3` (both values reported).
- Mutants L–Q all killed (`t02-r6-mut*`):
  - L: the gate is always commit;
  - M: solver/scenario judged on WS;
  - N: no backstop;
  - O: backstop applied on Linux;
  - P: `ws_peak_kb` not written;
  - Q: the total back at 600.
- Existing tests changed, as Round 7 amends them:
  - "on Windows samples the verdict judges commit …" (proxy RED on commit) is replaced by "a proxy RED only on commit is GREEN";
  - the budget pin goes from `windows: 600` to `514`;
  - the two CSV header pins gain `ws_peak_kb`.

**Q2:** `MEMORY.S3.kitTotalMB.windows` is 514 for every S3 variant. Kit-started PowerShell and its conhosts count; the loop's tooling is excluded, as already pinned.

**Q3 calibration** (`expected-red.json` `windows`):
- S5/short removed, with its numbers in the commit message;
- S1/burst1 → 20;
- S1/stalled → 61;
- S1/short unlisted;
- the rest kept.

Issue 61 is checked out unchanged from the integration branch, an identical blob, so that the committed-list test passes on this branch.

Re-judging run 4's artefact under the new rules predicts exactly the calibrated list (METRICS.md table), with one caveat. Run 4's CSVs predate `ws_peak_kb`, so S1/burst1 re-judged from the CSV is GREEN on sampled WS (234.3). The live WS verdicts of runs 3 and 4, which used PeakWorkingSetSize, were RED, and the next run records that peak.

**Q4 condition 5 corroboration:** run 4's `cleanup.pidRecordLeft` is `{"pid":5788,"startedMs":null}` (S3/hung) and `{"pid":8532,"startedMs":null}` (S3/short).

**Tests:**
- `npm run test`: 405 tests, 389 pass, 0 fail, 16 skipped;
- `npm run test:proxy`: 1343 pass;
- `npm run test:mcp`: 95 / 96;
- Linux job `--only S3/short,S7/short`: unchanged output, no backstop check, the ratchet holds (`reports/t02-r6-job-smoke.log`).

**Left for the orchestrator:** the spec §18 metric sentence and S1/S3 rows, the RUNLOG deviation, and the ticket 16/17/20/37 text from Round 7 are not edited on this branch.

### 2026-11-06 — implementer, round 7 (pre-merge CI run 42281731448 on staging/02 0f324a7: ubuntu S3/hung HARNESS FAILURE)

Branch `ticket/02-windows-sampler`, code head 6d8e8e0. Commits: e890635 (scenario + gate), 3e107d4 (merge of the integration tip acb857e), 6d8e8e0 (sampler), plus this note. Bun 1.4.2, ports 19020–19027. Artefacts: `/home/AgentKit/overhaul-tools/ci-art/42281731448-t02r7/`, with the earlier ubuntu legs next to it (`<run>-t02r7-linux/`).

**Root cause: the gate was right, S3/hung really did not run.**
- In CI the killed start lock holder had already spawned the proxy but had not written `proxy.pid` yet (`proxy/zcode-proxy-manager.mjs:615–632`).
- `manager start` then answered 0 (healthy) with no pid record. `hungRound` skipped both hung rounds (`hung-10-with-stale-lock.skipped: 0`, `hung-10.skipped: 0`), and only kill-holder-10 ran: 9 s, 13 samples, no launcher.
- The 8 other ubuntu S3/hung legs downloaded (staging/02 runs 42246379763, 42252896054, 42265988296, 42281646419; integration runs 42252974778, 42265998740, 42275502649, 42286030477) all ran 187–189 s with the three rounds and a pid file that matches the listener.
- The integration branch passes only because it has no evidence gate: the same 9 s run would be "RED as listed" there.

**Fix 1: the hung round tests the state the killed start leaves; it does not skip it** (`scenarios/s3-concurrency.mjs` `hungTarget` / `makeHungRound`).
- It freezes the proxy the pid record names, if that is a process of this run. Otherwise it freezes the single proxy of this run that serves the isolated port. The target is noted as `<round>.target` with `via: pid-record | listener`.
- No proxy of this run, none on the port, two on it, a recorded pid that is not ours, or a failed start is still a skipped round, noted with its reason. Only marked processes are ever frozen. The target is chosen after the 65 s grace, so Windows' next poll sees the proxy.

**Fix 2: the gate, made stronger** (`lib/completeness.mjs`). These are now a harness failure, whatever the run's time and roles:
- any `<round>.skipped` note;
- any missing `notes.rounds` entry, per key: S3/short has the four short-profile rounds, S3/hung has kill-holder-10, hung-10-with-stale-lock and hung-10.

The 15 s floor and the roles are unchanged.

**Fix 3, found while proving fix 1: the Linux sampler kept a pre-exec role for life** (`lib/sampler.mjs`).
- In a local run (`t02-r7-hungA`) the holder `node cli/heal.mjs` was killed inside `spawn()`. Its proxy was first sampled before its exec (6 MB, the parent's command line). The `pid:starttime` cache kept role `preflight` for all 475 samples.
- So that run had no proxy role, and the gate rightly said "role proxy never seen".
- A marked process is now re-read whenever its `/proc/<pid>/cmdline` changed. A process cached as not ours stays not ours: a fork inherits its parent's environment.
- Windows is unaffected: CreateProcess has its final command line from the start, and every CIM poll reads it.

**RED → GREEN** (logs in `reports/`):
- Hung round: `t02-r7-red1`, 3/3 failing on the refactored pre-fix logic. The CI state test got `actual: []`: nothing frozen, no round. GREEN: `t02-r7-green1`.
- Gate: the old `completeness.mjs` was restored in place (`t02-r7-red2`), and 2 tests fail. The replayed CI summary was already a harness failure, but only through the floor and the launcher, not the skip. The busy run with a skipped round passed as ok. GREEN: `t02-r7-green1`.
- Sampler: `t02-r7-red3`. A real `sh` → exec into `…/zcode-proxy-src/src/index.ts serve` stayed `other`. The first attempt passed vacuously because the `sh -c` string itself matched the proxy pattern; it now execs from a script file. GREEN: `t02-r7-green2`.
- Adversarial, from the gate's purpose:
  - the CI run's own `summary.json` (fixture `ci-42281731448-s3-hung-summary.json`, replayed through the job with `FAKE_RUN_MODE=replay`) stays HARNESS FAILURE, with "round hung-10-with-stale-lock skipped" and "round hung-10 never ran";
  - a 300 s, 900-sample S3/hung with every role seen but one hung round skipped, or simply missing, is a harness failure, and so is the pre-fix bare `0` note;
  - the scenario never freezes a recorded pid that is not ours, and never guesses between two listeners.
- Mutants in a scratch copy (`t02-r7-mut{R..V}`), all killed; the copy was restored and diffed identical:
  - R, listener fallback removed: the CI-state test fails;
  - S, skip check removed: 2 gate tests fail;
  - T, round list removed: 2 gate tests fail;
  - U, cache without the cmdline check: the exec test fails;
  - V, recorded pid not checked against ours: the "never a guess" test fails.

**The CI state, reproduced locally** (scratch copies only: a 5 s sleep before `writePidFile` widens the killed-start window; the kit in the branch is unchanged):

| harness | runs | result |
|---|---|---|
| f4b0034 (pre-fix) | 2 | HARNESS FAILURE: "scenario ran 11 s, below the S3 floor of 15 s; role launcher never seen", both rounds `.skipped: 0`, orphan proxy, "proxy healthy but no pid file" (the CI run exactly) |
| e890635 (fix 1+2) | 2 | RED as listed (ticket 16), 166 s, 442 / 450 samples, launcher 5, both targets `via: listener`; ratchet holds |

**Memory loop, Linux, short profile (real kit):**
- Baseline f4b0034, `--only S3/hung` ×4 (`t02-r7-base0..3`): 191–192 s, the race not hit, ratchet holds.
- Merge 3e107d4:
  - job `--only S3/short,S3/hung` (`t02-r7-s3-job`): S3/short RED 33 s / 119 samples; S3/hung RED 189 s / 541; the ratchet holds;
  - `hungB`: RED 189 s;
  - `hungA`: the natural race before the exec, found fix 3.
- Head 6d8e8e0:
  - job `--only S3/short,S3/hung` (`t02-r7-s3-job2`): S3/short RED (ticket 37) 33 s / 120 samples, all 7 roles; S3/hung RED (ticket 16) 189 s / 540; **the ratchet holds**;
  - `hungC`: 238 s / 642;
  - `hungD`: the natural race again, the proxy first sampled as `preflight` then `proxy` ×468, target `via: listener`, RED 160 s / 470;
  - `hungE`: 190 s / 549.
  - All hold the ratchet. No budget or list entry changed. The S3/hung kit peak stays in its ticket-01 range on recorded-proxy runs.

**Kit finding for tickets 16/17 (not fixed here, B-scope of the kit lifecycle):**
- On Linux too, a start killed between fork and `writePidFile` leaves an unrecorded, healthy proxy:
  - every stop says "proxy healthy but no pid file — refusing to guess", and the proxy ends as an orphan;
  - frozen, it makes the next 10 launches start a second proxy (`simultaneous-proxies 2`, 10/10 failed).
- This is the Linux face of the Windows killed-start finding (round 4: a record without a start time). The window spans `spawn()` itself and the gap to the first `writePidFile`.

**Tests (head 6d8e8e0 unless noted):**
- `npm run test`: 593 tests, 577 pass, 0 fail, 16 skipped (`t02-r7-kit2`).
- `npm run test:proxy`: 1343 pass, 0 fail, 90 files (`t02-r7-proxy`).
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped; `git status` clean after the build (`t02-r7-mcp`).
- The proxy and mcp suites ran on 3e107d4. 6d8e8e0 changes only `tests/memory/lib/sampler.mjs` and `tests/memory/loop.test.mjs`, which neither suite loads.

**Merge of the tip (3e107d4), resolved by hand.** The tip carries the revert c252676:
- tests/memory: the branch versions. staging/02's tests/memory equals f4b0034's, and the tip has not changed tests/memory since.
- ci.yml: staging/02's repaired file. The tip has not changed `.github` since 0fc27fc.
- package.json: the tip's list (ticket 07's `cli-commands`) plus `win-sampler.test.mjs`.
- METRICS: the branch's Windows section.
- This file: the orchestrator's merge/claim/revert notes, then rounds 2–6.
- Check: the merged tree equals staging/02 0f324a7, plus the tip's 15 files since 0fc27fc (each identical to the tip except package.json), plus this round's files.

**Pre-existing test change (C2):** "run evidence: S3 is proven by its proxy, launchers and preflights …" (round 4) gains `notes.rounds` in its fixture summary. The gate now requires S3's rounds; its assertions are unchanged.

**Left for others:**
- Tickets 16/17: the Linux unrecorded-proxy window above.
- Out of scope here: the windows `S1/burst1 → 20` entry and Round 8's condition 1 `ws_peak_kb` check (Owner Proxy round 8; `expected-red.json` untouched).
- CI must show next: ubuntu S3/hung passes the gate with all three rounds (a run that hits the window shows `via: listener` and stays RED as listed). Windows S3/hung keeps its three rounds (161 s in this run).
