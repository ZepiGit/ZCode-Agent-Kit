# 30: MCP task retention (500 / 7 days) and the idempotency window

**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0009

**What to build:** Terminal tasks are evicted at > 500 or > 7 days, whichever first; running tasks never; `*.result.json` pruned with the task; startup restore loads only retained tasks; the idempotency key is forgotten on eviction; an evicted task gives the existing not-found error. The tool description carries the idempotency sentence.

**Acceptance criteria:**

- [ ] Seam 7 (MCP client + fake harness): eviction by count and age with an injected clock, non-terminal kept, files pruned, restore loads only retained, not-found and new-task-on-reused-key after eviction.
- [ ] Loop S5: growth ≤ 5 %/1k, reboot cost of history ≤ 20 MB, 0 task failures. **Delete `S5/short` (linux, windows).**
- [ ] Retention migration replayed twice.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 66, 67, 68, 135

## Comments

- 2026-11-07 (orchestrator, Owner Proxy round 13, binding): windows `S5/short → 30` is listed as unstable (growth:mcp-bridge commit value 5 < v ≤ 30 %/1k; ticket 66 builds it). This ticket's only exit: every one of ≥ 10 fresh windows S5/short runs on its tree shows growth:mcp-bridge ≤ 5 %/1k regardless of the trend flag, via an off-by-default measurement mode; the same commit deletes the windows entry and removes S5/short from the unstable allow-list. EVIDENCE MISSING (round 13): attribution of the bridge growth (JS heap vs native/allocator vs V8 semi-space); S5/short runs 400 tasks while this ticket's eviction starts above 500, and the measured per-task heap (~1.6 MB total) is far below the 5-12 MB climb, so this ticket may not clear either leg; ticket 36 (semi-space flag) may be the real fix. Attribute first.
