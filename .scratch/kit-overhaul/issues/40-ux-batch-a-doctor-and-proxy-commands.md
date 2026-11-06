# 40: UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details

**Blocked by:** 38 (Manager `doctor` returns check records; `zcode-kit doctor` stops parsing text), 06 (CLI output module, capability record and the snapshot harness (no visible change))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0001, 0005

**What to build:** These commands render through `Out`: `doctor` shows each check once, a problem-count lead line when anything failed, one verdict line, off-TTY grammar `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` with today's names; `WARN` additive, exit 0, never applied to a condition that FAILs today. Status state line in human units (A-17). Connection details printed once per command, unboxed, ≤ 80 columns, key shown only on an interactive TTY, routes in `--verbose`/JSON (A-12). Reports on stdout, diagnostics on stderr, every error with what/why/next (`Run setup first (node setup.mjs)` → `zcode-kit setup`). Additive `proxy logs --level`/`--grep` filters (A-23). Closes A-02, A-05/A-09 (these commands), A-12, A-17, A-20, A-23.

**Acceptance criteria:**

- [ ] Snapshots updated in every C3 variant on both legs; the diff reviewed against design-language.md.
- [ ] Off-TTY regex test over every doctor fixture; WARN never changes an exit code; a check that FAILs today is never WARN (fixture matrix).
- [ ] JSON superset tests pass; connection-details reveal-rule suite passes.
- [ ] Stream routing asserted through real spawns (seam 5).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 89, 90, 91, 92, 93, 95, 105

## Comments
