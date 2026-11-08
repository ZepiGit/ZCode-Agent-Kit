# Owner Proxy round 18 — ticket 19's memory result: owners of the S1 burst entries, burst32 at the edge, ADR-0004's factor

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-18-answers.md` (write nothing inside the integration worktree).

Source: ticket 19's branch (`git -C /home/AgentKit/wt/t19 show HEAD:.scratch/kit-overhaul/issues/19-admission-control-and-503-shed.md`, head c1fb594; logs `reports/t19-*` in the integration worktree), ADR-0004, issues/19-*.md and 20-*.md, DECISIONS.md Rounds 1 (Q5), 6, 14–16, ticket 67's branch (owners/flips schema, not merged yet).

## Facts

Ticket 19 (64 MB in-flight cap, FIFO queue of ≤ 64, 15 s bound, 503 shed with `Retry-After: 2`, 413 for an oversized single body, one deferred GC after a ≥ 4 MiB release) is implemented with loopback tests (16; 12 RED on the tip; 12/13 mutants killed). Linux proxy peak, MB (tip f906014 → branch, medians):
- burst4: 366.2 → 329.2 (5 runs), budget 250, RED (−10 %). Its 43 MB in flight is under the 64 MB cap, so the cap never bites.
- burst16: 912.9 → 488.6 (5 runs), budget 400, RED (−46 %).
- burst32: 1272.4 → 549.7 (20 runs; 2 of 20 above 600: 602, 608.5), budget 600, GREEN at the median (−57 %).
- bigbody: 417.8 → 358.3 (5 runs), budget 250, RED (−14 %).
- burst1 (ticket 20's, unstable on windows): median 182.7 over 7 repetitions (ticket 60 measured ~236 on unchanged code).
ADR-0004 assumed ~4.5 MB of RSS per MB in flight (measured at 16–32 unbounded concurrent bodies); under the cap the factor is 7–8 MB per MB (5 bodies of 10.8 MB → 430–525 MB). The implementer attributes the excess to the body copies on the way upstream (three separate JSON parses among them), which is ticket 20's scope ("fewer redundant request-body copies, bytes upstream unchanged"). Windows numbers are pending CI. The implementer deleted the plain `S1/burst32` entries (linux, windows) because ticket 67 has not landed.

## Q1 — who owns `S1/burst4`, `S1/burst16`, `S1/bigbody` now?

Recommendation: owner 20 (its body-copy reduction is what remains between the measured peaks and the budgets); ticket 19 keeps and meets its loopback criteria and its memory criterion is amended to "the cap holds and the ≥ 30 % improvement is measured" (it holds for burst16 and burst32). Ticket 20's acceptance gains the three budgets by name (`procPeak:proxy` ≤ 250 / 400 / 250 MB for burst4 / burst16 / bigbody); if 20 cannot reach them, it comes back with numbers. No budget changes.

## Q2 — `S1/burst32`: delete now, or keep listed?

Facts: deleted, ~1 linux job in 10 goes RED (unlisted RED; 2/20 above 600); kept as a plain entry, ~9 in 10 fail as GREEN-but-listed. With ticket 67's schema an entry can be listed with its check marked `flips`, which passes either way.

Recommendation: keep `S1/burst32` listed on both legs, owner 20, `procPeak:proxy` marked `flips` (2/20 RED linux; windows from the pre-merge run), and let ticket 20 delete it with ≥ 10 GREEN CI runs per leg (round 15's flipping-name rule). This needs ticket 67 merged first; ticket 19 is restaged on 67's schema before its pre-merge run.

## Q3 — ADR-0004's per-MB factor

Recommendation: an ADR-0004 amendment line records the measured 7–8 MB/MB under the 64 MB cap (vs the assumed ~4.5 at unbounded concurrency) and that the S1 budgets stand; ticket 20 re-measures the factor after its copies are gone and the ADR is updated with the result. The 64 MB default stays (it is a config key, `server.admission.maxInFlightMB`).
