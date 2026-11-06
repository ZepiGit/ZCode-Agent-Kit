# 14: Event-line format and redaction for new log events (prefactor)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: 0010

**What to build:** One small logger for new event lines, `ISO-time LEVEL component message key=value…`, in the proxy (TS) and the manager (mjs), with redaction applied to all lines. Existing lines stay byte-identical. Every later ticket's new events (memory, recycle, shed, supervisor, lock takeover, rotation WARN, respawn ERROR) use it.

**Acceptance criteria:**

- [ ] Unit tests: format, key escaping, redaction of keys/tokens (incl. a stop-token-shaped value) in old and new lines.
- [ ] Golden-path classifier and existing log-reading tests unchanged.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 88

## Comments
