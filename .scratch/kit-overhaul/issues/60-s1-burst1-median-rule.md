# 60: S1/burst1 judged on the median of n fresh runs, every run ≤ 400 MB

**Blocked by:** 01 (Memory loop with budgets …), 02 (Windows sampler …)

**Status:** ready-for-agent

Model: sol
Risk: medium
ADR: no

**What to build:** Round 6 Q1 (DECISIONS.md, verbatim answer is binding). The 250 MB S1/burst1 peak budget stays. The memory job runs S1/burst1 as n fresh repetitions and judges the MEDIAN proxy peak against 250 MB; n is the smallest odd number ≤ 9 whose false-RED probability is ≤ 5 % given at least 20 measured repetitions on unchanged code (record the repetitions and the computation). Every single repetition must also stay ≤ 400 MB (a hard per-run ceiling, effective now). burst1 is 3 sequential ~10.8 MB requests per repetition (correct any text that calls it one request). Ticket 20's acceptance for burst1 becomes "every one of ≥ 20 runs ≤ 250 MB".

- [ ] ≥ 20 measured S1/burst1 repetitions on the integration tip recorded (peaks listed) and the chosen n with its false-RED computation, in this ticket's Comments and METRICS.md.
- [ ] `verdict.test.mjs` pins: median-of-n rule, per-run 400 MB ceiling, and that n is read from one place; a mutation proof for each.
- [ ] The job runs n repetitions for S1/burst1 on ubuntu (and on windows if the variant runs there) and the ratchet treats the variant as one verdict.
- [ ] Ticket 20's file updated with the new burst1 criterion (Comments note + criterion text).
- [ ] Full suites green; CI memory-budget ubuntu green (pending CI).

Spec stories: as for ticket 01 (budgets and measurement).

## Comments
