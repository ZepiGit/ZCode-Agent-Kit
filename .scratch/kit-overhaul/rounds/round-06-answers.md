# Round 6: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–5 decisions in DECISIONS.md bind these answers. Where a recommendation contradicts one of them, the answer says so and the earlier decision wins.

I checked the evidence myself:
- ticket 01 (`issues/01-*.md`, Comments and merge note) and ticket 20;
- ticket 02 on `ticket/02-windows-sampler` (worktree `/home/AgentKit/wt/t02`, head ba7a8cc, read-only);
- `reports/t02-linux-job.log`, `reports/t01-final-job.log`, `reports/t01-baseline-job.log`, `reports/memloop-S1-burst1.log` (1B), `reports/t02-burst1-t02-{1,2,3}.log` and `reports/t02-burst1-t02-tip-{1,2,3}.log`;
- CI run 42203592466 (`gh run view`): `memory-budget` (ubuntu) and all four `test-kit` legs green. The windows memory leg did not exist yet;
- `tests/memory/expected-red.json`, `tests/memory/lib/budgets.mjs`, `tests/memory/scenarios/s1-proxy-steady.mjs:51-59,159` on the t02 branch;
- spec §18, PROMPT §7 Phase 4 and §9.

Where the evidence differs from the round's wording, the answer says so. Where an answer is ACCEPTED with conditions, the conditions bind the tickets and the loop.

---

## Q1 — S1/burst1 flakes around its 250 MB peak budget

**DECISION:** REJECTED in part. Accepted: the 250 MB budget stays. The fix changes the measurement only. S1/burst1 runs as several independent repetitions in the job and is judged on the MEDIAN peak. Ticket 20 owns the variant. No expected-RED entry is added. Rejected: the claim that three repetitions fix the flake, and the deferral of the outlier bound to ticket 20. Binding corrections:
1. **Factual corrections.** S1/burst1 is not "one 10.8 MB request". It is 3 requests of ~10.8 MB at concurrency 1 (`s1-proxy-steady.mjs:58-59`; every log says "3 requests in 1 s"). The 250 MB number is the §18 "S1 proxy main ≤ 250 MB peak" budget, which ticket 01 decision 3 applies to the burst variants other than 16/32. It is not a §18 burst-row budget. Neither point changes the decision.
2. **The repetition count comes from the measured distribution.** The known samples on unchanged code are 219.1, 231.8, 234, 236.6, 236.7, 237.5, 237.7, 256.7, 264.6 and 299.2 MB, plus one CI GREEN. Three runs out of about 11 exceed 250 (p ≈ 0.27). A median of 3 fails whenever 2 of 3 runs land in the tail: 3p² − 2p³ ≈ 18 %. So roughly one job run in six would still go RED per leg, and under the Phase 4 revert rule a good merge could be reverted. Rule: before the median rule lands, run S1/burst1 at least 20 times, sequentially, on the integration tip (Linux), and record the distribution in METRICS.md. Then n is the smallest odd number in {3, 5, 7, 9} whose predicted false-RED rate (binomial, p = the measured exceedance fraction) is ≤ 5 % per leg run. At p ≈ 0.25 that is n = 9 (≈ 4.9 %), which costs about 3 minutes per leg. If no n ≤ 9 reaches 5 %, the rule is not adopted, and the question comes back with the distribution.
3. **The outlier ceiling applies now, not only after ticket 20.** Every repetition must be ≤ 400 MB, which is §18's budget for 16 concurrent bodies. A run with ≤ 1 body in flight that exceeds the 16-body budget is a regression by definition. The ceiling sits ~100 MB above the highest measured value (299.2), so it does not cause flakes of its own. Without it, a median rule would let one repetition spike to any size unnoticed until ticket 20 lands.
4. **Ticket 20's criterion is stricter than proposed.** Replace "S1/burst1 median peak ≤ 250 MB with every repetition ≤ 300 MB" with: "In a ≥ 20-repetition measurement of S1/burst1 on each leg (RSS on Linux, commit on Windows), every repetition is ≤ 250 MB. The tail is gone, so the peak budget holds as a peak. The job keeps the median rule." A 300 MB bound would sit 0.8 MB above an observed value on unchanged code, so it is neither a goal nor a stable gate. If ticket 20 cannot reach every repetition ≤ 250, it comes back with numbers. The budget is never loosened.
5. **Mechanics.**
   - Each repetition is a fresh, isolated proxy run. Repetitions run one after another, never concurrently (§6 resource safety).
   - `summary.json` and the job summary record every repetition's value, the median and the ceiling check.
   - The rule applies identically on the windows leg, using commit. If burst1 is RED there only on commit, Q2 condition 1 applies.
   - `verdict.test.mjs` pins the rule RED → GREEN with at least these cases: one high run passes; a high majority fails; one repetition above 400 MB fails even when the median is GREEN.
6. **Scope and order.**
   - The rule covers S1/burst1 only. Any other scenario needs its own decision with its own distribution. In particular, S1/burst4 and S1/bigbody may hover near 250 MB once ticket 19 lands, and that comes back with numbers.
   - The change lands on the integration branch with its tests, through the normal ticket/merge path, **before** ticket 02 merges. That way a pre-existing flake cannot trigger a revert of 02.
   - It is recorded as a measurement-rule amendment in spec §18 (S1 row) and in ticket 01's Comments, and the deviation goes in RUNLOG.

**Rationale:** The variance is real kernel VmHWM. The sampled proxy peaks are ~100–104 MB, and the high values come from transient overlap of body copies. It is not sampler noise. That makes it a property of today's code, and ticket 20 (body copies) is the right owner. Judging a peak on the median of several fresh runs does not loosen the 250 MB number. That number already tightens §9, whose literal ceiling is steady-state RSS ≤ 250 MB, and the 1B baseline (219 MB) stays below it. A single-sample verdict on a distribution whose typical value sits ~13 MB under the budget is a coin flip, not evidence (C9). The recommendation's own premise is not backed, though: at the measured tail rate, a median of 3 stays flaky about one run in six. It also leaves the variant without any outlier guard until ticket 20 lands. The conditions take n from the data, keep a hard ceiling now, and give ticket 20 a target that restores the budget's meaning as a peak.

**Charter:** C1 (bounded memory proven, not sampled by luck), C9 (stronger measured evidence; simpler than a flaky-entry mechanism), §9 (budget not loosened; tightened at ticket 20), C7 (same rule on the windows leg), PROMPT §7 Phase 4 (no spurious reverts).

**REVERSIBILITY:** Two-way door (a measurement rule in test code and spec text). No ADR.

---

## Q2 — First windows-latest memory run

**DECISION:** ACCEPTED with conditions. The first windows-latest `memory-budget` run calibrates the guessed `windows` list. It is not a regression of an existing leg. If it differs from the guess only in which scenarios are RED, the orchestrator does not revert ticket 02. Instead it updates the `windows` key in `expected-red.json` from the measured run in one follow-up commit, and records that run in METRICS.md as the Windows Bun 1.4.2 reference (Round 3 Q9 condition 1). Every harness, cap or Job Object failure is a real RED: the merge is reverted per Phase 4 and ticket 02 reopens with the failure attached. Binding conditions:
1. **A run RED only on commit is never listed silently.** This follows Round 2 Q13 condition 3, Round 3 Q9, build-time gate 3 and ticket 02 acceptance item 2. A run RED on commit but GREEN on working set, or RED on Windows but GREEN on Linux because of the metric, goes to the owner as a question in the next round, with the commit value, the working-set value and the Linux value. To keep CI usable until that answer, it may be listed under a newly filed `needs-triage` ticket that states the question. It is never listed under a fix ticket that does not own it, and no budget changes.
2. **A guessed entry is removed only with numbers.** If a scenario the ticket expected RED is GREEN on Windows, the removal commit cites the run's check values. Those values must show that the check observed real processes: role present, process count ≥ 1, units self-test passed. This matters most where the Linux defect does not depend on the platform (S2 retained memory, S5 growth). A GREEN that comes from a missing observation is a harness failure, not a calibration.
3. **One calibration only.** The follow-up commit's CI run must hold the ratchet on both legs. If a later windows run disagrees with the calibrated list, nobody edits the list a second time. The scenario is flaky on Windows and comes back as a question with its numbers. The Q1 median rule is not extended to it automatically.
4. **What counts as a real RED (revert):**
   - a harness failure (exit 2);
   - a failed units self-test;
   - a Job Object not applied (`applied=0` or no `@@JOB` report);
   - a cap kill or a timeout (exit 124);
   - a poller left alive after the loop;
   - any failing live Windows self-test on the `test-kit` legs (units, orphan, self-exclusion, Job Object applied and killing the tree);
   - any RED on the ubuntu `memory-budget` leg or any `test-kit` leg, under the normal Phase 4 rule.
5. **The reference record is complete.** METRICS.md records:
   - the run URL, runner image, Bun version (it must be 1.4.2; otherwise Round 3 Q9's fallback note goes in RUNLOG) and Node version;
   - per run: commit, working set, `redOnlyOnCommit` and poller overhead.
   Where a Windows baseline peak exceeds its budget, the ≥ 30 % rule applies to that leg (Round 3 Q1 condition 3). In particular, if Windows S3 commit exceeds 600 MB, the windows S3 total in `budgets.mjs` becomes 0.7 × that baseline in the same follow-up commit. That is a tightening, and `verdict.test.mjs` pins it. Nothing else in `budgets.mjs` and nothing under the `linux` key changes in that commit.
6. **Ticket 02 stays open** until the calibrated run is green on both legs and its evidence (run URL, final `windows` list, METRICS reference table, live self-test results) is in the ticket file. The exception to "a merge that turns anything red is reverted" is limited to this first run of the new leg, and it is recorded in RUNLOG. The 1.4.4 attribution run remains ticket 11's (Round 3 Q9 condition 2).

**Rationale:** The windows leg is new, and the ticket can only guess its list, because this host has no Windows (ticket 02 Comments). Under the ratchet, a first run that disagrees with a guess is expected by design. Reverting the sampler for it would make the Windows reference baseline impossible, and with it build-time gate 3 and C7's primary-platform evidence. The recommendation correctly keeps harness, cap and Job Object failures as real REDs. It does not cover three cases that earlier rounds bound: a RED only on commit, which must go to the owner and never be absorbed silently; a GREEN that is really a measurement gap; and repeated list edits that would turn the ratchet into a rubber stamp. It also omits the ≥ 30 % rule for a Windows baseline above its budget. The conditions close those gaps.

**Charter:** C7 (Windows primary; reference baseline must exist), C1 (caps and reaping proven on Windows), C9 (measured evidence decides the list), §9 (no loosening; ≥ 30 % rule), Round 2 Q13, Round 3 Q1/Q8/Q9, PROMPT §7 Phase 4 (revert rule; exception recorded).

**REVERSIBILITY:** Two-way door (list entries and METRICS text). No ADR.

---

## Shared understanding

CONFIRMED. No design branch is open. Q1 and Q2 are measurement and calibration rules with exact conditions. These come back as questions with numbers only if their gates fail:
- no n ≤ 9 reaches ≤ 5 % false-RED for S1/burst1;
- ticket 20 cannot get every repetition ≤ 250 MB;
- a Windows run is RED only on commit;
- the calibrated Windows list does not hold on the next run.
