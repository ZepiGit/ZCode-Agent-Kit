# Owner Proxy round 10 — Bun 1.4.4 moves Linux S1/burst1 in CI from p ≈ 0.04 to p ≈ 0.5

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-10-answers.md` (write nothing inside the integration worktree).

## Q1 — Ticket 09 (Bun 1.4.4 in CI) turns the unlisted Linux S1/burst1 RED

**Facts**
- Ticket 09 (`ticket/09-ci-toolchain` bf6fa98): checkout@v7, setup-node@v7, setup-bun@v2, Bun 1.4.2 → 1.4.4 in ci.yml, release.yml and the memory-budget job; nested proxy workflows deleted. Its criterion: "all CI legs and both memory-budget legs green on Bun 1.4.4". Ticket 11 (installers ship Bun 1.4.4, proxy typecheck) is blocked by 10, which is blocked by 09; the chain 10 → 11 → 12 → 13 gates 19, 24–26, 30, 36 and most of the run.
- Pre-merge run 42344393581 (staging/09): everything green except ubuntu memory-budget: `S1/burst1: RED but not listed in expected-red.json (linux)`, median 252.3 of [252.3, 280.6, 246, 221.2, 302.2]. Windows held every check (burst1 unstable median 251.9 ≤ 300; S5/short GREEN; proxy commit backstop max 431.9 ≤ 512).
- Measurement run 42347506810 (staging/09 + marker e73bb1b, 24 fresh runs per leg, all valid; artefacts `/home/AgentKit/overhaul-tools/ci-art/t09-measure-XAT9/`):
  - **Linux CI, Bun 1.4.4 (RSS, MB):** 256.3, 318.8, 234.6, 252.4, 274.8, 202.2, 237.1, 251.4, 265.1, 265, 211.6, 266.7, 264.6, 255.4, 225.7, 230.1, 304.8, 279.1, 241.4, 235.4, 227.3, 221.5, 207.4, 236.2 → 12/24 > 250 (p = 0.50), median 246.4, max 318.8, none > 400. P(median of n > 250) = 0.5 for every n.
  - **Windows CI, Bun 1.4.4 (WS gate):** 14/24 > 250 (p = 0.58), median 252.4, max 295.9; commit median 406, max 448.8. On 1.4.2 (run 42316982634): 13/24 (p = 0.54), median 251.9, max 291.1.
- **Comparison, Linux S1/burst1 > 250 MB:**
  - CI, Bun 1.4.2 (run 42316982634, same runner image ubuntu-26.04 20261028.624): 1/24 (p = 0.04), median 234.4, max 262.1.
  - CI, Bun 1.4.4 (this): 12/24 (p = 0.50). One-sided Fisher exact test 1/24 vs 12/24: p ≈ 0.0003.
  - Local (this machine), Bun 1.4.2: 2/20 (median 230.9); Bun 1.4.4: 0/20 (median 210.7) (ticket 09 Comments, METRICS.md).
  - Pooled Linux history before 09: 11/103 (p ≈ 0.107).
- Confounds not ruled out: the measured CI runs differ in Bun **and** in checkout/setup-node v6 → v7 (the proxy runs on Bun; Node runs the loop and the manager). The local machine and the CI runner disagree in direction. The memory job's Node is v26.13.0 on the 1.4.4 run (1.4.2 run's Node patch not captured).
- Constraints from earlier rounds: Round 9 condition 3 forbids extending the `unstable` state to any other key (so "list Linux burst1 as unstable" is out unless explicitly overridden). Linux burst1 is unlisted; a plain RED listing would flip GREEN ~50 % of runs. Budgets are never loosened (§9). Charter C1 (stability first) and C5 (currency: latest stable that passes the full suite) pull in opposite directions here; C9: stronger measured evidence wins.

**Orchestrator recommendation**
1. **Attribute first, cheaply.** One paired CI measurement on staging/09: S1/burst1 × 24 on Bun 1.4.2 and × 24 on Bun 1.4.4, interleaved in the same job on the same runner, with the v7 actions in both. This separates Bun from the actions bump and from runner variance. (Implementation: the ticket 09 implementer adds a `--bun` override to the measurement mode; off by default, same marker discipline.)
2. **If Bun 1.4.4 is the cause (paired p clearly higher on 1.4.4):** ticket 09 merges with the v7 actions and Bun 1.4.4 in test-kit, ux-before and release.yml, but the **memory-budget job stays pinned to Bun 1.4.2** with a comment naming this round. Ticket 09's criterion is amended accordingly. A new needs-triage ticket owns "Bun 1.4.4 raises the Linux S1/burst1 peak" with the distributions; ticket 11 (installers ship 1.4.4) gains an edge on it, because shipping 1.4.4 to users would ship the regression. Ticket 20 (fewer body copies) is the natural fix owner if the triage confirms the extra peak is body copies.
3. **If the paired run shows no Bun difference:** the earlier 1/24 was the lucky draw; the question returns with the pooled distribution (Linux burst1 would then need its own decision, since Round 9 forbids another `unstable` key).

Reason: the evidence is strong that something in 09 moved Linux burst1 in CI, but not what. A paired run costs one CI run (~15 min) and decides between "pin the memory job's Bun" and "the Linux variant was mis-calibrated". Merging 09 as is breaks the ratchet; holding all of 09 for a memory-only question blocks the whole chain behind it.
