# Owner Proxy round 29 — ticket 74's mutant proof failed: what happens to 30 and S5/short?

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-29-answers.md` (write nothing inside the integration worktree).

Sources: DECISIONS.md Rounds 13, 17, 24, 25, 26 (and 28 for the signature pattern); issues/30-*.md, 74-*.md, 56-*.md, 57-*.md on the integration tree; ticket 74's branch (`git -C /home/AgentKit/wt/t74 log`, head eab4ddf on ticket/30 2c6720c; its issue file Comments and METRICS hold the full tables); raw mutant-proof data `/home/AgentKit/overhaul-tools/t74-memloop/`; RUNLOG (latest lines); round 25's windows evidence `/home/AgentKit/overhaul-tools/ci-art/r25-*`.

## Q1 — 74 failed its own proof. Does 30 merge, and what replaces 74's rule?

Facts: Round 24 pre-registered 74's rule (S5/short over 1,200 tasks, growth:mcp-bridge judged over tasks 600-1,200 with the unchanged `growth()`: RED when > 5 %/1k AND trend; plus `warm-up-growth:mcp-bridge`, today's quantity, RED above 55 linux / 30 windows). Its Acceptance required a local linux mutant proof before any staging: ticket 30's M1 mutant (count bound removed) RED on growth:mcp-bridge in each of ≥ 3 runs, and 30's tree ≤ 5 with the warm-up value under its ceiling in each of ≥ 3 runs; otherwise the ticket comes back with numbers, nothing merges in part (Fallback). Result (local linux, 6 runs, about 2,125 s each, 1,056-1,058 samples in the window):

| arm | growth 600-1,199 %/1k (trend) | slope MB/1k | mean MB | warm-up value |
|---|---|---|---|---|
| M1-1 | 7.77 (false) | 7.96 | 102.4 | 38.11 |
| M1-2 | 17.01 (false) | 17.64 | 103.7 | 45.2 |
| M1-3 | 9.03 (false) | 9.33 | 103.4 | 40.9 |
| tree-1 | 2.85 (false) | 2.74 | 96.2 | 41.99 |
| tree-2 | 5.75 (false) | 5.56 | 96.6 | 43.37 |
| tree-3 | 5.62 (false) | 5.39 | 95.8 | 40.58 |

The trend flag never fired (net rise 4.0-7.7 % against 10 %, rising run ≤ 2 against 3), so under the rule every M1 run is GREEN and CI would not catch the mutant; and 2 of 3 tree runs are above 5 (Round 24's 1.37 came from one run on a tree without ticket 36). The mutant stores 3,600 task files against the tree's 1,500. All other S5 checks GREEN in all six (procPeak 99-120.9 MB, reboot 2-4 MB, 0 failures, 0 orphans). No windows numbers exist for the new window. Round 26 condition 6 lets 30 merge alone if only 74 fails, judged by 30's own verdict on the joint runs (windows warm-up value in (5, 30] in all 10, linux ≤ 55, other S5 checks GREEN, Round 25's set complete without trigger); the joint runs were never started because 74's proof gates them. 56 and 57 are blocked behind 30 and 74.

Recommendation:
1. 74 does not stage or merge; its rule is withdrawn as failed (no budget, window or count changed to fit). Its branch keeps the job-seam work (window, warm-up check, timeout) for reuse.
2. 30 is staged alone (integration tip, then ticket/30) and judged by Round 26 condition 6's verdict on exactly 10 runs per leg of that one tree (tree hash in RUNLOG before the first run; every run with an S5/short value counts), with the S5/short entries unchanged (windows `unstable` band owned by 74, linux owned by 74 with `flips`); the values enter Round 25 Q1 condition 4's set in creation order. If the verdict holds, 30 merges and 56/57 unblock as their own blockers allow.
3. 74 is reopened as needs-triage with one question for a later round: which S5/short quantity separates a working retention bound from M1 on both legs. The local evidence points at the absolute slope (MB/1k) in the post-bound window or a longer post-bound window (e.g. tasks 600-2,400), not at %/1k with trend; 74 measures ≥ 5 runs per arm per leg (windows via an off-by-default staging measurement mode, no new endpoint) before any rule is pre-registered. Until then the S5/short entries and signature (vi) stay as they are.
