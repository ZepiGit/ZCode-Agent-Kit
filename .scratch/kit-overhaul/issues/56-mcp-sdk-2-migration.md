# 56: MCP SDK 2.x and protocol revision 2026-07-28 migration

**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24)

**Status:** needs-triage

Model: sol (if accepted)

Risk: high

ADR: —

**What to build:** An evaluated migration plan off SDK 1.x / protocol 2025-11-25 before the 1.x support horizon noted in `research/mcp-sdk.md` (2027-01-27). Out of scope for this overhaul (spec Out of Scope; Round 1 Q16).

**Acceptance criteria:**

- [ ] Owner decides go/no-go; if go, the ticket is re-written as tracer bullets.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: none (follow-up to 129)

## Comments
