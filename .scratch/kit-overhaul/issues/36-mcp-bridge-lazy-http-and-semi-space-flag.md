# 36: MCP bridge: lazy HTTP transport and `--max-semi-space-size=1` in generated entries

**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0013 (consequences)

**What to build:** The bridge imports its HTTP transport lazily (HTTP mode unchanged). Generated harness MCP entries put `--max-semi-space-size=1` on the bridge command line, never in `NODE_OPTIONS`. Existing harness configs are updated on the next `setup`/`integrate` through the transaction, idempotently.

**Acceptance criteria:**

- [ ] Seam 7: HTTP mode tests unchanged; `test:mcp` green with the flag (build-time gate 6).
- [ ] Seam 8: the flag in every generated entry; bridge-flag migration replayed twice is a no-op; rollback restores the old entry.
- [ ] Loop: S3 bridge role peak ≤ 75 MB (baseline 86); S5 within budget.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 34, 135

## Comments
