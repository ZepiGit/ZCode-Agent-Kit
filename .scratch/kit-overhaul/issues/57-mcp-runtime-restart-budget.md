# 57: MCP runtime restart budget (architecture candidate 8)

**Blocked by:** None (can start immediately)

**Status:** needs-triage

Model: sol (if accepted)

Risk: medium

ADR: —

**What to build:** Proposal to fold a respawn budget/backoff/state into the bridge runtime module with the same policy shape as the proxy's restart budget, tested through the fake harness. Not done now because S5 never exercised runtime restarts (Round 1 Q2).

**Acceptance criteria:**

- [ ] An S5 variant with induced harness exits shows whether a restart storm is possible; owner decides.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: none

## Comments
