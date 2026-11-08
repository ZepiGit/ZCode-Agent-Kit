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
- [ ] Loop S5/short (Round 26 Q1; replaces Round 24 Q1 condition 1's single restage): judged on the 10 pre-registered evidence runs per leg of the joint staging tree (integration tip, then 30, then 74) on `warm-up-growth:mcp-bridge` (today's quantity: load window cut at task 400, default 25 % warm-up): every windows value 5 < v ≤ 30 %/1k commit, every linux value ≤ 55 %/1k, every other S5 check GREEN in every run (procPeak ≤ 150 MB, WS on windows; reboot cost ≤ 20 MB; 0 task failures; 0 orphans); and Round 25 Q1 condition 4's 20-value set complete with no trigger. Signature (vi) never applies. If 74 is not staged (its mutant proof failed), the 10 runs are taken on this ticket's own staging tree on the band value (the same quantity). A value above 30 or any other S5 RED comes back with all values; nothing is rerun. Both S5/short entries stay re-owned to ticket 74, which holds their only exit (Round 24 Q1).
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
- 2026-11-08 (orchestrator, Owner Proxy round 25): restaged run 42483637377 (a53152d, with 36) disagrees with 42475847194: windows S5/short growth:mcp-bridge 34.62 %/1k commit (WS 19.17), trend true, above the 30 bound; signature (vi) does not apply (diff touches mcp/**). Its S1/short line (growth:proxy 5.18 commit only) is Round 17 signature (ii). Under Round 24 Q1 condition 1 the ticket does not merge on this run; the numbers come back as their own question.
- 2026-11-08 (orchestrator, Owner Proxy round 26, binding): 30 and 74 are staged together on one branch (integration tip, then ticket/30, then ticket/74, which is built on ticket/30). Restaged run 42483637377 (34.62 %/1k commit, trend true; z = 4.2 against the other 84 windows runs) is neither excused nor dropped: it stays value 3 of Round 25's 20-value set and in this ticket's "with 30" subset in METRICS. This ticket's S5/short verdict comes from the same 10 evidence runs per leg as 74's exit, read from warm-up-growth:mcp-bridge (Acceptance). Merge: 30 then 74 back to back in one push if both pass; 30 alone, after one confirming pre-merge run of its own tree, if only 30 passes; neither if 30 fails. Reverting 30 always reverts 74 first.
- 2026-11-08 (orchestrator, Owner Proxy round 29, binding): 74's mutant proof failed, so Round 26 Q1 condition 6c applies: this ticket takes exactly 10 full-CI runs per leg on its own staging tree (integration tip, then ticket/30; tree hash in RUNLOG before the first run), judged under the Acceptance's S5/short bullet on the band value (windows 5 < v ≤ 30 commit; linux ≤ 55 judged from the printed value; every other S5 check GREEN; Round 25's set tabulated, complete and trigger-free; signatures (vi) and (vii) never apply). Then one confirming pre-merge run (the 10th run serves if the tip has not moved and every job is GREEN), and 30 merges alone. A value above 30 or 55, or any other S5 RED, comes back with all values; nothing is rerun.
