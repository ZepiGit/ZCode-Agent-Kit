# Owner Proxy round 9 — the Windows S1/burst1 distribution lands in the middle band

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-09-answers.md` (write nothing inside the integration worktree).

## Q1 — What happens to windows S1/burst1 at p ≈ 0.54

**Facts (Round 8 conditions 1–3 applied)**
- Measurement run: CI run 42316982634 on staging/02 db5f353 (= ticket/02 3dd5d2c merged first, ticket/60 7e8520a second, tree identical to ticket/60; marker `tests/memory/measure-burst1` = 24). Artefacts copied to `/home/AgentKit/overhaul-tools/ci-art/r8-measure-nGEr/` (`memory-budget-windows/measure-S1-burst1.{json,md}`, `memory-budget-linux/…`).
- Condition 1: all 24 windows runs valid (ws_peak_kb present and non-zero, units self-test ok, Job Object applied, gate = max(sampled WS, ws_peak_kb) matches samples.csv). Run 42281731448's GREEN was also a real measurement (RUNLOG 2026-11-06T21:40Z).
- **Windows, 24 fresh runs, WS gate (MB):** 291.1, 274, 261.6, 253.4, 249.4, 239.2, 272.6, 290.2, 290.4, 242, 270.1, 249.7, 206.9, 260.5, 274.6, 253.3, 240.2, 272.2, 250.6, 243.8, 238.6, 241.4, 231.1, 240.8.
  - above 250: 13 of 24 (p = 0.542); pooled with runs 3 (RED), 4 (RED), 5 (GREEN): 15 of 27 (p = 0.556). Less favourable estimate: 0.556.
  - min / median / max 206.9 / 251.9 / 291.1; none over the 400 MB ceiling (max 291.1). Commit median 403.7, max 446.3.
  - P(median of n above 250) at p = 0.542: n = 3: 0.56, 5: 0.58, 7: 0.59, 9: 0.60. No odd n ≤ 9 reaches 95 % agreement with either list state; at p > 0.5 a larger n converges on RED, not GREEN, but slowly.
- **Linux, 24 fresh CI runs (RSS):** 1 of 24 above 250 (p = 0.042); min / median / max 212.5 / 234.4 / 262.1; none over 400. Local 20 runs on the same code: 2 of 20 (p = 0.10); pooled with the 59 earlier runs: 11 of 103 (p ≈ 0.107). n = 5 gives P(false RED) ≈ 1.2 % at p = 0.107 and ≈ 1.7 % at p = 0.127.
- Round 8 condition 3: 0.251 < p < 0.749 → nothing changes, 02 and 60 do not merge, the question comes back with the distribution. This is that question.
- **Dependency fact:** the variant's owner, ticket 20 (fewer request-body copies), is blocked by 19, which chains back through 13 ← 12 ← 11 ← 10 ← 09 ← 02 (issues/INDEX.md). Ticket 02 is the only ticket on the frontier right now; 03, 09, 60, 61 and everything after them wait on it. "Wait until 20 makes burst1 stable" is a deadlock.
- The value sits on the budget: the windows median WS gate (251.9) is 1.9 MB above 250. Sampled WS alone is lower (median ≈ 190), but Round 7 Q1 fixed the gate as max(sampled WS, PeakWorkingSetSize); that is not up for change here.

**Orchestrator recommendation**
Merge 02 and 60 with the windows `S1/burst1 → 20` entry kept and marked **unstable**, a third ratchet state that exists only for this entry:
1. The job still runs n = 5 repetitions on windows and reports every value, the median and the ceiling check.
2. The 400 MB per-run ceiling stays a hard RED on windows (it is 109 MB above the highest of 27 measured values).
3. For the median verdict, the ratchet accepts GREEN or RED for this one entry and prints "unstable, owned by ticket 20" in the summary. Any other entry that flips stays a ratchet failure as today.
4. Ticket 20's existing criterion (every one of ≥ 20 windows runs ≤ 250 MB on the WS gate) is the only way to delete the entry; ticket 55 (CI guardrails, empty expected-RED) gains a criterion that no `unstable` entry may remain at the end of the run.
5. Linux keeps n = 5 and stays unlisted for burst1; the windows list is otherwise unchanged; no budget, metric or ceiling changes.
6. The marker commit is removed and one pre-merge confirmation run on staging/02 must be green on both legs (Round 8 condition 4 otherwise unchanged).

Reason: a median at p ≈ 0.54 cannot be made stable by any n the cost allows, and with no stable state the ratchet only produces revert churn on a borderline value that its owner ticket is already scoped to fix. The unstable state keeps the measurement visible, keeps the hard ceiling and gives the entry one owner and one exit, without loosening the 250 MB budget. Alternatives considered and not recommended: switching the windows gate to sampled WS (a metric change that loosens Round 7 Q1); holding 02 until 20 (deadlock); listing it as plain RED (flips GREEN in ~40 % of runs at n = 5, so the ratchet fails as often as it passes).
