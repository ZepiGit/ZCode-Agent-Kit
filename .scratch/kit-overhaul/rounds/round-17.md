# Owner Proxy round 17 — what ticket 67's eight evidence runs surfaced

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-17-answers.md` (write nothing inside the integration worktree).

Context: 8 parallel CI runs on staging/67 (identical tree = integration tip with ticket 13 + ticket 67 round 2; runs 42435825059, 42435917288, 42436010878, 42436099293, 42436186573, 42436269194, 42436354758, 42436440284). 4 green; 4 red on five distinct, rare failures. None is caused by ticket 67's change; each blocks every merge when it hits, so earlier single pre-merge runs were partly lucky. Ticket 67's round 3 (round 16 G: windows S4 count:proxy → 17, flips) is in progress.

## Q1 — windows S7/short `responses-store:heap-at-cap` RED, unowned (1 of 8)

Run 42436010878: `RED responses-store:heap-at-cap 98 MB (budget 96)`; S7/short's owners map has only 33 (`proxy.log:bounded-while-running`). In the earlier history (ticket 67's METRICS) this check was never RED on either leg. Which ticket's text bounds the responses store? (Phase 1B refuted the responses store as a leak; ticket 25 "bounded collections" is the candidate.) Recommendation: if a ticket's acceptance names the responses-store bound, it owns the check marked `flips` (1 of 8 + 0 of the earlier history); otherwise a needs-triage ticket owns it with the numbers.

## Q2 — linux S5/short `growth:mcp-bridge` over budget but GREEN on the trend flag (1 of 8)

Run 42436186573: `ok growth:mcp-bridge 39.53 %/1k (budget 5) trend=false` → `S5/short: GREEN but listed for ticket 30: delete the entry (linux)`. Round 13 settled the same trend-flag flip on windows with a bounded unstable band; linux had been RED 26/26 (37/37 per ticket 66's count) until now. Recommendation: mark `growth:mcp-bridge` as `flips` on linux S5/short (owner 30) — the ticket 67 mechanism, not a third unstable key — since the value is far over budget in every run and only the trend flag flips.

## Q3 — windows S1/short `growth:proxy` RED (unlisted key, 1 of 8)

Run 42436354758: `RED (only on commit)`, `growth:proxy: commit 5.25 / WS 1.86 MB (budget 5, gate commit)`; procPeak and steady GREEN. Earlier windows history: S1/short GREEN (values ~3.7–4.0 %/1k recorded in several runs). Which ticket owns S1/short growth on windows (none lists it)? Recommendation: list windows `S1/short` with an owner whose text bounds proxy growth (19 admission control or 21 health supervisor are candidates; decide from their text), `growth:proxy` marked `flips`; or, if no text covers it, a needs-triage ticket with the distribution. No budget change.

## Q4 — ticket 03's floor test: "no-op hook charged 2.55 MB" on windows Node 26 (1 of 8 windows runs)

tests (ticket 03): "the stub OMP host charges a hook that does nothing well under the 5 MB waiter gate (its own churn is in the baseline)", threshold 2.5 MB commit on windows. Ticket 03's implementer wrote: "If this fails, it is a finding to bring back with the number, not a reason to loosen the gate." Value 2.55 MB. Recommendation: the floor test's purpose is to prove the measurement's noise floor is well under the 5 MB gate; 2.55 vs 2.5 is the noise floor itself showing through. Options: (a) keep 2.5 and repeat the measurement n times taking the median (a measurement change, like the burst1 median rule), or (b) a new ticket to make the stub host's baseline subtraction deterministic. The 5 MB waiter gate itself is untouched in both.

## Note — windows `manager-safety.test.mjs:160` "stop cleanly kills a verified-own process": process still alive (1 of 8)

Not a question for you: the orchestrator files ticket 70 to investigate (test timing vs a real stop race on Windows) with RED-first evidence, as tickets 64 and 65 did.
