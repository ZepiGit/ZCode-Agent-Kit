# 50: Harness adapters: HIGH fixes (Continue, Kilo Code)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: —

**What to build:** Continue writes `capabilities` as a string array (`tool_use`, `image_input`); Kilo Code's Anthropic base URL gets `/v1`. Existing users get them on the next `setup`/`integrate` through the transaction with rollback, idempotently.

**Acceptance criteria:**

- [ ] `adapter-audit` fixtures: new shape, byte-idempotent on a second run, rollback restores the old file (seam 8).
- [ ] Adapter-refresh migration replayed twice.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 131, 132, 135

## Comments
