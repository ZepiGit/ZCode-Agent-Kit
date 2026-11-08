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
- [ ] Exit: ≥ 10 fresh runs per leg on this tree via an off-by-default S5-only measurement mode (several CI runs or parallel jobs allowed), every one with growth:mcp-bridge ≤ 5 %/1k on the new window whatever the trend flag says, the warm-up value under its ceiling, and every other S5 check GREEN; values (commit and WS on windows), trend, window medians, sample counts and durations recorded in METRICS.md and here.
- [ ] The same commit deletes `S5/short` from both legs of `expected-red.json` and removes it from `UNSTABLE`; the schema then rejects `unstable` on S5/short (replacing the band tests, justified). The pre-merge run shows S5/short GREEN on both legs with no entry.
- [ ] Fallback: if the mutant proof or the exit fails on either leg, nothing merges in part; the ticket comes back with all values. No budget, ceiling, window or task count is changed to fit.
- [ ] The ubuntu `memory-budget` `timeout-minutes` goes from 75 to 100 (wall-time guard, not a budget).
- [ ] Spec §18 S5 row and METRICS.md updated (Round 24 Q1 condition 10).

**Common acceptance (every ticket):** as in every ticket file.

Spec stories: none (measurement rule, Round 24 Q1)

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 24, binding): re-owned from 30. Until this ticket merges, Round 17 Q2 condition 3's wrong-owner watch (any linux S5/short value ≤ 5 %/1k on the old window comes back as an ownership question) and Round 17 cross-question signature (iv) are recorded here. Staged run 42475847194 (30's tree): windows 14.5 %/1k commit (trend false, in band), linux 31.82 %/1k (trend false, flip GREEN).
