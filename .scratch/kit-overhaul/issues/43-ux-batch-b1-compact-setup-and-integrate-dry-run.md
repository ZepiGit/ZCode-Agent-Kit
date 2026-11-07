# 43: UX batch (b1): compact `setup` report and `integrate --dry-run`

**Blocked by:** 40 (UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details), 42 (Account Rotator decision asked once, with migration)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0001, 0005

**What to build:** `setup` prints a compact report by default (stages, one result row per assistant, the connection check, the connection details, the undo command); full output to `install.log` and to screen with `--verbose`/`ZCODE_KIT_VERBOSE=1`; every WARN/FAIL keeps what/why/next on screen; `--installer` still accepted; nothing printed today is lost. `integrate --dry-run` lists every file it would write and every registration with the undo command. The Codex adapter prints the POSIX launcher on POSIX. One banner, TTY progress via `step()`. Closes A-07, A-11 (setup), A-15, A-16, A-26.

**Acceptance criteria:**

- [ ] Snapshots in every C3 variant; `install.log` contains every line the old verbose output had (line-set comparison test).
- [ ] `setup-regressions` passes; dry-run lists match the files a real run writes (temp-HOME comparison).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 95, 97, 111, 115

## Comments

- 2026-11-07 (orchestrator, from ticket 42): the harness-prompt part of audit finding A-22 and moving prompts to stderr remain here (ticket 42 kept prompts on stdout).
