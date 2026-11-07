# 49: Proxy TUI log pane: filter, scroll, follow

**Blocked by:** 48 (Proxy TUI redesign on the shared tokens)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0001

**What to build:** Unboxed title line with count/follow badge; filter (`/`, substring, `level:warn`/`level:error`, Esc clears); scrolling and follow; byte cap from 32 kept.

**Acceptance criteria:**

- [ ] Seam 6 tests for filter parsing, scroll/follow state and the footer hint.
- [ ] Frame snapshots per tier.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 118

## Comments

- 2026-11-07 (orchestrator, from ticket 32): with an 8 MB line on screen a frame takes 5.9 ms (recorded, not gated); a short pane scrolled by fewer rows than the viewport shows a '▼ 0 more' badge.
