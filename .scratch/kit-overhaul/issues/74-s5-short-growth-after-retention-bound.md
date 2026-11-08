# 74: S5/short: judge MCP bridge growth after the retention bound (1,200 tasks, window 600–1,200)

**Blocked by:** 30 (MCP task retention (500 / 7 days) and the idempotency window)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: none

**What to build:** S5/short's 400-task window measures runtime warm-up and task history below ADR-0009's 500-task bound, which no fix can bring under 5 %/1k (Round 24 Q1). Run S5/short for 1,200 tasks with today's per-task workload and judge `growth:mcp-bridge` over tasks 600–1,200 (warm-up fraction 0 inside the window; `growth()`, 5 %/1k and the trend rule unchanged). Add `warm-up-growth:mcp-bridge`: today's quantity (load window cut at task 400, default 25 % warm-up), RED above 55 %/1k on linux (RSS) and above 30 %/1k on windows (commit) regardless of trend. procPeak (150 MB), reboot cost (20 MB), task failures (0) and orphans are judged over the whole run. This ticket owns both `S5/short` entries (re-owned from 30) and is their only exit.

**Acceptance criteria:**

- [ ] Tests RED first at the job seam: growth to task 600 then flat is GREEN; growth continuing after 600 with trend is RED; warm-up 55.1 (linux) / 30.1 (windows commit) is RED with a GREEN post-bound window; a load ending before 1,200 or < 6 samples after 600 is a harness failure / insufficient; window bounds are printed in summary.json and the job summary.
- [ ] Mutant proof (local linux, never committed): the count bound removed (ticket 30's M1) is RED on growth:mcp-bridge (value > 5 and trend) in every one of ≥ 3 runs; the tree with 30 is ≤ 5 with the warm-up value under its ceiling in every one of ≥ 3 runs. Otherwise come back with the numbers.
- [ ] Joint staging with 30 (Round 26 Q1): this ticket is built on ticket/30 and staged on one branch with it (integration tip, then 30, then 74). Before the first evidence run, RUNLOG records the joint tree's hash and the count, 10 per leg; every run on that tree counts, and none is added, dropped or replaced once it has an S5/short value (a run with no S5/short value, i.e. an infrastructure failure before S5, is replaced and recorded). Each run also records `warm-up-growth:mcp-bridge` (commit and WS on windows), its slope MB/1k, mean MB and window medians; these values are ticket 30's verdict and enter Round 25 Q1 condition 4's set in run-creation order. The exit is judged against the windows ceiling in force when the runs ran (30). If the Round 25 Q1 condition 5 round raises the ceiling, the exit is judged again on 10 fresh runs per leg after that round; if it lowers it, the same runs are re-judged against the lower value.
- [ ] Exit: the 10 joint-tree runs per leg (Round 26 Q1), via the off-by-default S5-only measurement mode or full CI runs of that identical tree (several CI runs or parallel jobs allowed), every one with growth:mcp-bridge ≤ 5 %/1k on the new window whatever the trend flag says, the warm-up value under its ceiling, and every other S5 check GREEN; values (commit and WS on windows), trend, window medians, sample counts and durations recorded in METRICS.md and here.
- [ ] The same commit deletes `S5/short` from both legs of `expected-red.json` and removes it from `UNSTABLE`; the schema then rejects `unstable` on S5/short (replacing the band tests, justified). The pre-merge run shows S5/short GREEN on both legs with no entry.
- [ ] Windows warm-up ceiling (Round 25 Q1 condition 5): this ticket does not merge before METRICS holds the first 20 windows S5/short values on trees containing ticket 36 and an Owner Proxy round has re-confirmed or re-decided the windows 30 %/1k warm-up-growth ceiling on them (Round 13's 28-run justification is superseded: 2 of 85 windows values exceed 30). Signature (vi) never applies to this ticket's runs; a windows warm-up value above 30 in a mutant, exit or pre-merge run comes back under the Fallback; the ceiling is never changed by the implementer.
- [ ] Fallback: if the mutant proof or the exit fails on either leg, nothing merges in part; the ticket comes back with all values. No budget, ceiling, window or task count is changed to fit.
- [ ] The ubuntu `memory-budget` `timeout-minutes` goes from 75 to 100 (wall-time guard, not a budget).
- [ ] Spec §18 S5 row and METRICS.md updated (Round 24 Q1 condition 10).

**Common acceptance (every ticket):** as in every ticket file.

Spec stories: none (measurement rule, Round 24 Q1)

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 24, binding): re-owned from 30. Until this ticket merges, Round 17 Q2 condition 3's wrong-owner watch (any linux S5/short value ≤ 5 %/1k on the old window comes back as an ownership question) and Round 17 cross-question signature (iv) are recorded here. Staged run 42475847194 (30's tree): windows 14.5 %/1k commit (trend false, in band), linux 31.82 %/1k (trend false, flip GREEN).
- 2026-11-08 (orchestrator, Owner Proxy round 25, binding): interim signature (vi): a windows S5/short run whose only failure is the band's bound, 30 < growth:mcp-bridge ≤ 35 %/1k commit, every other S5 check GREEN, does not count against a ticket whose diff touches none of mcp/**, lib/mcp-bridge.mjs, tests/memory/scenarios/s5-mcp.mjs, tests/memory/lib/{verdict,budgets,sampler*,win-*,ratchet}.mjs, the S5/short entries of expected-red.json, the Bun pin or the memory-budget job's Node version; recorded here each time (run, tree, commit/WS, trend, slope MB/1k, mean MB, window medians); ends when this ticket merges. First occurrence: 42480631098 (staging/21, 30.23 commit / WS 42.29, trend false, 24.42 MB/1k on 80.8 MB, medians 76.7, 79, 80.7, 81.1, 83.2, 82.6). Not covered (ticket 30's tree): 42483637377, 34.62 commit / WS 19.17, trend true, 26.24 MB/1k on 75.8 MB, medians 70.9, 74.4, 76.9, 76.3, 77.4, 78.7.
- 2026-11-08 (orchestrator, Owner Proxy round 26, binding): staged jointly with 30 (Acceptance). Round 25 Q1 condition 5 stands: no merge before the 20-value windows table and the ceiling re-confirmation round. Round 25's set is unchanged and is not filled from this tree alone. Its first five values are 42454650683 15.43, 42469209389 18.14, 42483637377 34.62 (30's tree), 42483787372 19.82 and 42484868282 24.83. Joint-tree runs enter in creation order with their warm-up-growth value. If values are still missing after the 10 joint runs, they come from the next runs on any tree with 36: empty-commit runs of the integration tip are allowed, more joint-tree runs are not. METRICS marks each value "with 30" or "without 30" and prints n, mean, sd and max per subset. Merge order: 30 then 74, back to back in one push, after one pre-merge run of the final joint tree that is GREEN, with S5/short GREEN on both legs and no entry; never 74 without 30.
