# Owner Proxy round 11 — the paired Bun run reads (a): the 1.4.2 arm itself misses the stability line by one run

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-11-answers.md` (write nothing inside the integration worktree).

## Q1 — Which Bun does ticket 09 pin, given the paired run

**Facts**
- Paired run 42352122623 on staging/09 (ticket/09 ad6667b + marker `24 bun=1.4.2,1.4.3,1.4.4`), Round 10 Q1 condition 1 as specified: 72 runs per leg, arms interleaved, every run valid, every proxy ran its arm's Bun (runtime version checked per run). The only test-kit failure on all 4 legs is the marker guard. Artefacts: `/home/AgentKit/overhaul-tools/ci-art/t09-paired-1fRC/memory-budget-{linux,windows}/measure-S1-burst1.{md,json}`.
- **Linux (RSS gate), > 250 MB of 24:**
  - 1.4.2: 5 (p 0.208), min/median/max 204 / 219.4 / 260.5
  - 1.4.3: 14 (p 0.583), 206.5 / 272.8 / 331.4
  - 1.4.4: 13 (p 0.542), 217.6 / 252.6 / 333.2
  - Fisher one-sided vs 1.4.2: 1.4.3 p = 0.0086, 1.4.4 p = 0.0178. None over 400 MB.
  - Mechanical reading printed by the job: **(a) — the 1.4.2 arm is not stable unlisted (5 of 24 above the budget; the line is ≤ 4).**
- **Windows (WS gate, information only per condition 5), > 250 of 24:** 1.4.2: 12 (median 250.1), 1.4.3: 17 (254.4), 1.4.4: 19 (257.7); Fisher vs 1.4.2: 1.4.3 p = 0.119, 1.4.4 p = 0.034. Medians all ≤ 300, none > 400. Commit medians 403–407.
- **Environment (both legs, every arm identical):** Intel Xeon Platinum 8573C, 4 cores; Linux cgroup v2-only, `constrainedMemory` = scope MemoryMax = 3 GiB; Windows Job Object 3G. The Round 10 hypothesis (Bun 1.4.4's hybrid-cgroup heap sizing) does not apply: the runners are v2-only, and the step up appears at 1.4.3, not 1.4.4. The local machine (AMD EPYC 7B12, 8 cores, v2-only) shows no step (1.4.2 2/20, 1.4.4 0/20).
- **Linux 1.4.2 history in CI on unchanged proxy code:** run 42316982634 1/24, this run 5/24 → pooled 6/48 (p = 0.125). P(median of 5 RED) at p = 0.125 ≈ 1.6 % (≤ 5 %); at p = 5/24 ≈ 6.5 %. Pooled 1.4.2 (6/48) vs 1.4.3 (14/24): Fisher p ≈ 8e-5; vs 1.4.4 (13/24): p ≈ 3e-4.
- Round 10 condition 2(a) sends any failed 1.4.2 arm back as a question; this is that question. Condition 2(c) would have chosen V = 1.4.2 (1.4.3 is not stable). Condition 4 (a needs-triage ticket for the newer Bun, blocked by 20 only) and condition 6 (records, ADR-0016 amendment line, release-notes reason, SUPPORT_MATRIX/READMEs naming V) are written for exactly that outcome.

**Orchestrator recommendation**
Treat the evidence as branch (c) with V = 1.4.2:
1. Pin Bun 1.4.2 everywhere per Round 10 condition 3 (CI, release.yml, memory job, release-audit test in ticket 09; installers' SHA-256s and `@types/bun` 1.4.2 exact in ticket 11). Ticket 09 keeps the v7 actions.
2. The stability judgement for 1.4.2 uses the pooled CI history (6/48, P(median-of-5 false RED) ≈ 1.6 %), because the single 24-run arm sits one run over a line that was set for a 24-run sample; both 1.4.2 samples are on unchanged proxy code and the same runner image.
3. The needs-triage ticket from condition 4 owns "Bun ≥ 1.4.3 raises the S1/burst1 proxy peak on the CI runners (Linux p ≈ 0.55 vs 0.125; Windows 1.4.4 p 0.79 vs 0.5)", blocked by 20 only, with the paired distributions; it reruns the paired mode after 20 merges and at each new Bun stable.
4. Linux S1/burst1 stays unlisted. The pre-merge confirmation run (marker removed, Bun 1.4.2) must be green on both legs; any disagreement comes back as a question, no rerun-until-green.
5. Records per condition 6, naming this round as the reason V ≠ 1.4.4.

Reason: both newer Bun releases are significantly worse than 1.4.2 on Linux on the runner that judges the ratchet, and 1.4.4 is also worse on Windows, the primary platform (C7). 1.4.2 is the only candidate that is stable on the pooled evidence; the newer ones are not stable on any reading. Asking for a third 1.4.2 sample would cost one run and could only move the pooled p from 0.125 to somewhere between ~0.08 (0/24) and ~0.18 (7/24), all under the 0.189 line, unless it came out ≥ 8/24.
