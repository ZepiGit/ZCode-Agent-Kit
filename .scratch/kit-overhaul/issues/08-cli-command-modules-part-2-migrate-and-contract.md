# 08: CLI command-module split, part 2 (migrate remaining commands + contract)

**Blocked by:** 07 (CLI command-module split, part 1 (expand: dispatcher + status/doctor/proxy/models/logs)), 10 (Batch 1b — Node 24 support floor, refuse before mutation, autostart Node-path check)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: —

**What to build:** `setup`, `integrate`, `update`, `rollback`, `uninstall`, `accounts`, `auth`, `run`, help and the rest move to command modules; the inline command bodies in the CLI entry are deleted (contract).

**Acceptance criteria:**

- [ ] Every command dispatches through a module; the CLI entry has no command bodies left (structural test).
- [ ] All spawn suites and snapshots unchanged; exit codes 0, 1, 2, 3, 4, 5, 20, 130 asserted per command where they occur today.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 61 (CLI contracts kept)

## Comments
