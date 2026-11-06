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
