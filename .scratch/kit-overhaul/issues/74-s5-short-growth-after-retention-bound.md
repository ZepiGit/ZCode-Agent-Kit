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

- 2026-11-08 (implementer, branch `ticket/74-s5-short-post-bound`, built on `ticket/30-mcp-task-retention` 2c6720c as Round 26 Q1 requires; code 8c5a947 + d6a17a0, this comment in the docs commit on top). The integration tip is not merged into this branch (orchestrator's instruction: the staging branch takes the tip, then 30, then 74). Linux x64, Node 26.7.0, Bun 1.4.2.

  **Result: the mutant proof (Round 24 Q1 condition 5) FAILED on both arms. Under the Fallback (condition 8) nothing merges in part and the ticket comes back with all values; no budget, ceiling, window or task count was changed.** Joint staging and the exit runs were not started (Round 26 Q1 condition 1: the mutant proof comes before any staging).

  | run (linux, local) | growth:mcp-bridge 600–1,199 %/1k (trend) | slope MB/1k / mean MB | net rise, rising windows | warm-up-growth:mcp-bridge %/1k (trend) | procPeak MB | reboot cost MB | failures / orphans | duration s |
  |---|---|---|---|---|---|---|---|---|
  | M1-1 (count bound removed) | 7.77 (false) | 7.96 / 102.4 | 5.4 %, 2 | 38.11 (true) | 117.2 | 4 | 0 / 0 | 2,127 |
  | M1-2 | 17.01 (false) | 17.64 / 103.7 | 7.7 %, 2 | 45.2 (true) | 120.9 | 4 | 0 / 0 | 2,127 |
  | M1-3 | 9.03 (false) | 9.33 / 103.4 | 4.0 %, 0 | 40.9 (true) | 119.1 | 3 | 0 / 0 | 2,127 |
  | tree-1 (8c5a947) | 2.85 (false) | 2.74 / 96.2 | 1.9 %, 0 | 41.99 (true) | 99 | 2 | 0 / 0 | 2,125 |
  | tree-2 | 5.75 (false) | 5.56 / 96.6 | 2.2 %, 0 | 43.37 (true) | 100.3 | 2 | 0 / 0 | 2,124 |
  | tree-3 | 5.62 (false) | 5.39 / 95.8 | 3.0 %, 0 | 40.58 (true) | 99.5 | 2 | 0 / 0 | 2,125 |

  - Window medians, sample bounds (post-bound: samples 1059–2116 of 2,125 on M1, 1059–2113/2114 of 2,122 on the tree; warm-up: samples 4–707, 176 warm-up samples), data dirs and the warm-up medians are in METRICS ("S5/short after the retention bound"). Raw data: `/home/AgentKit/overhaul-tools/t74-memloop/`; logs `reports/t74-s5-{tree,mut}-{1,2,3}.log`.
  - **M1 is GREEN in 3 of 3** (required: RED, value > 5 AND trend, in every run). The values are over 5 in all three, but the trend flag never fires: net rise 4.0–7.7 % against 10 %, trailing rising run ≤ 2 against 3. This is Round 24's Shared understanding 2 (the mutant's thin trend margin) realised. The slope does separate the arms: 7.96–17.64 MB/1k on M1 against 2.74–5.56 on the tree.
  - **The tree is ≤ 5 in 1 of 3** (required: every run): 2.85, 5.75, 5.62 (all GREEN under the rule, trend false). Round 24's 1.37 for this window came from one S5/long run on a tree without ticket 36; this tree has 36.
  - The warm-up value is under 55 in all six (38.11–45.2), and every other S5 check is GREEN in all six.
  - Replayed through the fixed job (d6a17a0) against the committed list (no S5/short entry), all six runs pass GREEN, the mutants included: under this rule CI would not see M1.
  - Mutant handling: 8c5a947 was committed first. M1 was applied in a scratch worktree (`mcp/zcode-harness-mcp/src/tasks/manager.ts` plus a rebuilt `dist/tasks/manager.js`), never committed, and restored with `git checkout 8c5a947 -- <both files>`; `git diff 8c5a947` was empty, and the scratch worktrees are removed.
  - Round 17 Q2 condition 3 (wrong-owner watch, recorded here): the old quantity (warm-up-growth) is 40.58–43.37 on the tree, far above 5, so no ownership question arises.

  **What is built (so a re-decided rule can reuse it).**
  - `lib/budgets.mjs`: `S5_SHORT` (1,200 tasks, judged from task 600, warm-up to task 400, ceilings linux 55 / windows 30) and `s5GrowthBudgets()`. S5/long is unchanged.
  - `lib/verdict.mjs`: a growth budget may carry `name`, `fromProgress` / `untilProgress` (a window in tasks: from the first sample at ≥ 600; up to and including the first sample that reaches 400) and `ceiling` (RED above the value whatever the trend says). The window's bounds go into the check's `detail.window`: tasks, 0-based sample indices, sample counts, warm-up samples. Windows judges `warm-up-growth:` on commit and reports WS, like `growth:`.
  - `scenarios/s5-mcp.mjs`: n = 1,200, and `s5Budgets()` is exported (the job-seam stand-in uses the same budgets).
  - `lib/completeness.mjs`: S5/short is a harness failure, never GREEN, when the load ran fewer than 1,200 tasks, when a window is missing, has no bounds or has fewer than 6 samples.
  - `job.mjs`: a "Growth windows" section in the job summary (bounds, values, commit/WS, slope, mean, medians), `growthChecks` carry `window` and `ceiling`, the S5 run timeout goes from 1,800 to 3,600 s, and `run.mjs` prints the window line.
  - `expected-red.json`: S5/short is deleted on both legs, in the same commit that removes S5/short from `UNSTABLE`. The single-run growth band goes with it, so the schema rejects `unstable` on S5/short on both legs.
  - `ci.yml`: the ubuntu `memory-budget` `timeout-minutes` goes from 75 to 100.
  - Spec §18 S5 row and METRICS are updated.

  **Tests, RED → GREEN (seam 1, the job).**
  - Seven new job-seam tests in `loop.test.mjs`: fixture series through `fixtures/fake-s5-run.mjs`, the scenario's own budgets, the real `osVerdict`, the job, its gate and the committed list.
    - Growth to task 600, then flat, is GREEN on both legs.
    - Growth after 600 with a trend is RED and "not listed".
    - Warm-up 55.1 linux / 30.1 windows commit is RED alone with a GREEN post-bound window; 55 and 30 pass, and WS 45 beside commit 30 passes.
    - A load ending at task 900 or 1,195, or 5 samples after task 600, is a harness failure; 6 samples pass.
    - A full load whose last sample is at task 1,199 is judged.
    - A 400-task summary of the old rule (CI 42404639968 windows, 42436186573 linux) is a harness failure.
    - Both windows' bounds are printed in `summary.json` and in the job summary.
  - RED: on 2c6720c (ticket 30's tree), 6 of 6 fail (`reports/t74-red-base.log`); the old-rule replay passes there as "unstable … owned by ticket 74", ratchet holds. The 1,199 test fails on 8c5a947 (`reports/t74-gatefix-red.log`). GREEN: `reports/t74-green1.log`, `t74-gatefix.log`.
  - `verdict.test.mjs`:
    - pins `S5_SHORT` / `s5GrowthBudgets` to Round 24's numbers;
    - tests that a ceiling is RED with trend false;
    - tests that `unstable` on S5/short is a schema error on both legs and that a re-added single-run band is refused;
    - tests that the committed list has no S5/short.

  **Pre-existing tests changed (justified by Round 24 Q1 condition 7: the entries and the `UNSTABLE` key leave in this commit).**
  - `verdict.test.mjs`: the eight windows band tests are replaced by the schema tests above (as condition 7 says). The committed-list test now expects no S5/short entry. The "`unstable` is allowed for …" messages lose ", windows S5/short". The owners-on-unstable test drops its S5/short rows. Two committed-list loops drop their dead unstable-S5 branch.
  - `loop.test.mjs`: the two windows band replays and the linux flip replay are replaced by the job-seam tests (their fixtures are reused in the old-rule test).

  **Suites on d6a17a0** (`reports/t74-full-*.log`):
  - `npm run test`: 860 tests, 842 pass, 0 fail, 18 skipped;
  - `test:proxy`: 1,451 pass, 0 fail (98 files);
  - `test:proxy-typecheck`: clean;
  - `test:mcp`: 105 tests, 104 pass, 0 fail, 1 skipped;
  - memory ratchet tests (verdict, loop, win-sampler): 185 tests, 180 pass, 5 skipped.

  **Decisions taken.**
  1. "Cut at the sample where progress reaches 400": the window includes that sample.
  2. "Load ended before 1,200" is read from the scenario's `bridge.tasks` note, not from the last sample's task. The last sample before the end of the load is at task 1,199; the first gate (8c5a947) used the last sample and turned all six real runs into harness failures. d6a17a0 fixes it, and no measured value changes.
  3. The six runs count for the proof: they ran on committed 8c5a947, whose measurement code (scenario, verdict, budgets) d6a17a0 does not touch, and their summaries were replayed through d6a17a0.
  4. No S5-only measurement mode was built: Round 26 Q1 accepts full CI runs of the identical tree, and the proof failed before any exit run.
  5. The S5 run timeout (3,600 s, 7,200 s on windows) is a wall-time guard like the CI timeout.

  **Pending CI (orchestrator verifies; not reached, since the Fallback applies):**
  - joint staging and its RUNLOG pre-registration;
  - the exit (10 runs per leg);
  - the windows ceiling re-confirmation round (Round 25 Q1 condition 5);
  - the pre-merge run.

  **Staging note.** `git merge-tree` of the tip (cbe2abb) with this branch conflicts in `issues/30-*.md` and `tests/memory/loop.test.mjs`, which ticket 30 alone already conflicts in, and in `tests/memory/lib/ratchet.mjs`. That last one is the tip's `os` parameter in `boundKindError` against this branch's removal of the band; keep both. With this docs commit, `issues/74-*.md` (the tip's Round 25/26 text is copied in, then this comment), `METRICS.md` (this section is appended at the end) and `spec.md` (the S5 row sits next to the tip's changed S6/S7 rows) conflict as well; keep both sides in each.

  **For the Owner Proxy (no option taken here):**
  - on this evidence, the post-bound window separates M1 from the tree by slope (≈ 8–18 vs ≈ 3–6 MB/1k) but not by the trend flag, and the tree itself sits around the 5 %/1k budget (2.85–5.75);
  - a windows post-bound value is still EVIDENCE MISSING.
