# 32: TUI log pane capped at 2,000 lines and 8 MB

**Blocked by:** 05 (Shared width core and token set (two renderers, one token set)), 11 (Batch 1c — Bun 1.4.4 bootstrap in the installers, pinned proxy typecheck, 1.4.4 attribution runs)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: 0009

**What to build:** The log pane enforces a byte cap (8 MB) in addition to its 2,000-line cap.

**Acceptance criteria:**

- [ ] Seam 6: `log-pane` tests for line and byte caps with 64 KB lines.
- [ ] Loop S6: log pane ≤ 16 MB heap with 64 KB lines, resize storm ≤ 8 MB, frame time unchanged. **Delete `S6/short` (linux).**
- [ ] A single line larger than 8 MB never makes the pane exceed 8 MB (the line is truncated or dropped; the ticket states which).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 73

## Comments
