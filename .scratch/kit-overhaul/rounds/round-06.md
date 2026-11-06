# Round 6 — a flaky budget check (S1/burst1) and the first Windows run

Answers file: `rounds/round-06-answers.md`. Rounds 1–5 binding.
Evidence: ticket 01 and 02 Comments (`issues/01-*.md`, and ticket 02 on branch `ticket/02-windows-sampler` / after merge on the integration branch), `reports/t02-linux-job.log`, `reports/t01-final-job.log`, CI run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42203592466 (burst1 GREEN there), `tests/memory/expected-red.json`, spec §18 budgets, ADR-0016.
Every question is worded so "yes" accepts the recommendation.

---

❓ **Q1 - S1/burst1 flakes around its 250 MB peak budget**: one 10.8 MB request; proxy peak measured 219 (1B), 219–234 (t01), 236.6 / 299.2 / 237.5 MB on the integration tip and 237.7 / 236.7 / 256.7 / 264.6 MB on the t02 branch (code path untouched). It is not on the expected-RED list, so the ratchet fails the ubuntu job on a bad sample; listing it would fail the job on a good sample. Keep the 250 MB budget, and change the measurement only: S1/burst1 runs 3 repetitions in the job and is judged on the MEDIAN peak (a single 299 MB outlier then no longer flips the verdict; three high runs still do). Assign the variant to ticket 20 (fewer redundant request-body copies, which is where a single-request peak can actually drop), whose acceptance criterion becomes "S1/burst1 median peak ≤ 250 MB with every repetition ≤ 300 MB". Until 20 lands, the median rule alone decides; no expected-RED entry.

➡️ Yes.

---

❓ **Q2 - First windows-latest memory run**: ticket 02 lands the windows leg with an expected list the ticket guessed; the ticket says the first run decides the real list. If that first run differs only by which scenarios are RED (no harness failure, no cap failure), the orchestrator updates the `windows` list in `expected-red.json` from the measured run in a follow-up commit, records the run and its numbers as the Windows Bun 1.4.2 reference in METRICS.md, and does NOT revert ticket 02. A harness failure, a missing cap or a Job Object failure on Windows is a real RED: the merge is reverted per the run rules and ticket 02 reopens.

➡️ Yes.
