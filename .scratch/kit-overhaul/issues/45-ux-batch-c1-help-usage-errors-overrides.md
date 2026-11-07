# 45: UX batch (c1): grouped help, per-command `--help`, usage errors, output overrides

**Blocked by:** 37 (`process.execve` handover in `zcode-kit run` and the `ZCODE_KIT_RESIDENT_LAUNCHER=1` opt-out), 40 (UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details), 42 (Account Rotator decision asked once, with migration)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: 0001

**What to build:** Help grouped by task with examples first, environment variables and exit codes, at 80 columns; every command has `--help`; a usage error prints two lines on stderr and exits 2. `--color=auto|always|never`, `--no-color`, `ZCODE_KIT_UNICODE=0|1`, `ZCODE_KIT_PROGRESS`, `ZCODE_KIT_HYPERLINKS` (off by default) wired and documented; NO_COLOR wins over FORCE_COLOR. Help documents `WARN`, `--reask`, the rotator override, `ZCODE_KIT_RESIDENT_LAUNCHER` and the overrides. Closes A-10.

**Acceptance criteria:**

- [ ] Snapshots for global and per-command help in every C3 variant; width ≤ 80 asserted.
- [ ] Usage-error spawn test: exactly two stderr lines, exit 2, nothing on stdout.
- [ ] Override tests through real spawns.
- [ ] A test asserts that the global help names `WARN`, `--reask`, `--account-rotator`, `ZCODE_KIT_ACCOUNT_ROTATOR`, `ZCODE_KIT_RESIDENT_LAUNCHER`, `--color`, `--no-color`, `ZCODE_KIT_UNICODE`, `ZCODE_KIT_PROGRESS` and `ZCODE_KIT_HYPERLINKS`.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 95, 103, 104, 110

## Comments
