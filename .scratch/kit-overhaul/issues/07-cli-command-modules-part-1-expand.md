# 07: CLI command-module split, part 1 (expand: dispatcher + status/doctor/proxy/models/logs)

**Blocked by:** 06 (CLI output module, capability record and the snapshot harness (no visible change))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: —

**What to build:** The CLI entry keeps parsing, dispatch and rendering; the first command group becomes modules that take parsed args + ctx and return `{ exitCode, records }`. Importing a command module has no side effects (no argv/env reads, no `process.exit`, no module-scope I/O). Bin entry points unchanged.

**Acceptance criteria:**

- [ ] Import-without-side-effects test for each new module; exit codes asserted on `{ exitCode, records }` (seam 5).
- [ ] Existing `cli-kit`, `cli-audit` and `setup-regressions` suites pass unchanged; all snapshots byte-identical.

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
