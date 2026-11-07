# 38: Manager `doctor` returns check records; `zcode-kit doctor` stops parsing text

**Blocked by:** 15 (Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0001 (Round 2 amendment)

**What to build:** The manager's doctor returns its checks as records through the lifecycle module; `zcode-kit doctor` consumes records instead of regex-parsing text. The manager CLI's own `doctor` keeps the legacy off-TTY grammar byte for byte.

**Acceptance criteria:**

- [ ] Spawned manager CLI `doctor` output byte-identical to the pre-change snapshot (seam 2).
- [ ] `zcode-kit doctor` exit codes unchanged on every fixture state; no text parsing remains (grep test).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 61, 92

## Comments
