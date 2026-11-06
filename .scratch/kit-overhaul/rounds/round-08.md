# Owner Proxy round 8 — Windows S1/burst1 disagrees with the calibrated list

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-08-answers.md` (outside the integration worktree; a merger owns that tree while you run).

## Q1 — S1/burst1 (windows) went GREEN on the calibration run

**Facts**
- Round 7 Q3 calibrated the windows list with `S1/burst1 → 20` "under the ticket-60 median rule", judged on working set (Round 7 Q1).
- The calibration commit is on `staging/02` (head 0f324a7, PR #14). Its CI run 42281731448 (https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42281731448) fails the windows ratchet on exactly one line: `S1/burst1: GREEN but listed for ticket 20: delete the entry from expected-red.json (windows)`.
- Windows S1/burst1 numbers in that run: proxy peak commit 365.2 MB / WS 222 MB (budget 250, gate WS). Earlier windows runs 3 and 4 were RED on live WS via `PeakWorkingSetSize`; run 4's sampled WS was 234.3 (sampled peak 248.3 in run 3). Single run, no median: ticket 60 (the median rule) is not on `staging/02`, because 60 is blocked by 02.
- Round 6 Q1 wanted the median rule to land before ticket 02 merges; RUNLOG 2026-11-06T13:11 recorded the deviation (02 merged first, then was reverted).
- Round 6 Q2 condition 3: a later windows run that disagrees with the calibrated list is not answered by a second list edit; it comes back as a question with its numbers.
- Ticket 60's branch `ticket/60-s1-burst1-median-rule` (worktree /home/AgentKit/wt/t60, head 4a54f63) exists; the implementer paused it until 02 re-merges. Its Linux distribution work is in that branch.
- The same CI run's ubuntu leg failed on a separate harness failure (`S3/hung: scenario ran 9 s, below the S3 floor of 15 s; role launcher never seen`). That is a real RED under Round 6 Q2 condition 4 and goes back to the ticket 02 implementer; it is not part of this question.

**Orchestrator recommendation**
Do not edit the list. Stage 02 and 60 together: once ticket 02's ubuntu harness failure is fixed, the orchestrator finishes ticket 60 on top of `ticket/02`, merges both into `staging/02` (02 first, then 60), and lets that one pre-merge CI run judge windows S1/burst1 under the median-of-n rule. Merge 02 and 60 to the integration branch back to back only if that run is green on both legs. If the windows median is then GREEN, the windows `S1/burst1 → 20` entry is deleted by ticket 60's own commit (the variant has no RED to own), and ticket 20 keeps its ≥ 20-repetition criterion on both legs.

Reason: Round 7 Q3 already made the windows entry conditional on the median rule, so judging it without that rule tests a configuration nobody decided. Staging the two tickets together restores the Round 6 Q1 order without a second calibration edit.
