# 30: MCP task retention (500 / 7 days) and the idempotency window

**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0009

**What to build:** Terminal tasks are evicted at > 500 or > 7 days, whichever first; running tasks never; `*.result.json` pruned with the task; startup restore loads only retained tasks; the idempotency key is forgotten on eviction; an evicted task gives the existing not-found error. The tool description carries the idempotency sentence.

**Acceptance criteria:**

- [ ] Seam 7 (MCP client + fake harness): eviction by count and age with an injected clock, non-terminal kept, files pruned, restore loads only retained, not-found and new-task-on-reused-key after eviction.
- [ ] Loop S5/long (3,000 tasks): GREEN on every check (growth ≤ 5 %/1k, procPeak ≤ 150 MB, reboot cost of history ≤ 20 MB, 0 task failures), tip RED → branch GREEN recorded.
- [ ] Loop S5/short: no new RED on either leg (linux listed, growth:mcp-bridge only; windows inside the 5–30 %/1k commit band; every other S5 check GREEN); values recorded. Both S5/short entries are re-owned to ticket 74, which holds their only exit (Round 24 Q1; explicitly contradicts Round 13 Q1 condition 4 and moves Round 17 Q2 condition 2's exit to 74).
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
- 2026-11-08 (orchestrator, Owner Proxy round 17): Q2 — ticket 67 marks `growth:mcp-bridge` as `flips` in linux `S5/short` (owner 30), because the name was GREEN in 1 of 10 runs on the 13 tree (42436186573, 39.53 %/1k, trend false). Added the linux value-based exit to Acceptance: ≥ 10 fresh matching linux runs, every one with `growth:mcp-bridge` ≤ 5 %/1k regardless of the trend flag, and every other S5 check GREEN. Windows `S5/short` stays `unstable` and keeps the Round 13 exit above. The 5 %/1k budget, `growth()`, `MEMORY.growth`, the windows band and the other S5 checks are unchanged. **Wrong-owner watch (Q2 condition 3):** for every linux S5/short run that is GREEN before 30 merges, the orchestrator records here the run id, the `growth:mcp-bridge` value and the window medians. Any value ≤ 5 %/1k before 30's fix lands (for example after 36's semi-space flag) comes back as an ownership question with the run id. The first such run is 42436186573 (39.53 %/1k, trend false, every other S5 check GREEN, peak 102.6 MB); its window medians are not in the round text and are still to be recorded. **Interim signature (iv) (cross-question condition 2):** until 67 merges, a staged or post-merge run whose only failure is linux S5/short "GREEN but listed" with `growth:mcp-bridge` > 5 %/1k and every other S5 check GREEN does not count against the ticket, does not block its merge and causes no revert, unless the ticket's diff touches `mcp/**`, `s5-mcp.mjs`, `tests/memory/lib/{verdict,budgets,sampler*}.mjs` or the Bun pin. Each occurrence is recorded here with the run id and values.
- 2026-11-08 (orchestrator, Owner Proxy round 24, binding): merges on retention and S5/long. Staged run 42475847194: windows S5/short 14.5 %/1k commit (WS −4.24, trend false, in band); linux 31.82 %/1k (trend false, flip GREEN; window medians from the run's summary.json to be recorded here, Round 17 Q2 condition 3); all other S5 checks GREEN on both legs. The S5/short entries are re-owned to 74 in this tree, followed by one restaged run. The per-task footprint (~4.6 KB heap / ~28 KB RSS per retained task) is bounded by the 500 bound and gets no ticket (C9).
