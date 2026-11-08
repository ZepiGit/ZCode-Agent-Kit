# 20: Fewer redundant request-body copies (bytes upstream unchanged)

**Blocked by:** 19 (Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0004

**What to build:** The redundant body copies identified in research (undici-yaml §5) are removed one by one, each measured; the bytes sent upstream are byte-identical.

**Acceptance criteria:**

- [ ] `protocol-contract`/`handler-resilience` assert byte-identical upstream bodies for each endpoint shape (seam 4).
- [ ] Per-copy RSS-per-MB-in-flight delta recorded in METRICS (baseline: ticket 19's tree, ADR-0004 amendment of Round 18; per copy removed, record the S1/burst4/16/32/bigbody peaks and (peak − 90) / MB admitted); S1 stays GREEN on both legs.
- [ ] Loop S1, both legs (Round 18 Q1/Q2): `procPeak:proxy` ≤ 250 MB (S1/burst4), ≤ 400 MB (S1/burst16), ≤ 600 MB (S1/burst32), ≤ 250 MB (S1/bigbody). Linux judges RSS, windows the WS gate (Round 7 Q1). 20 removes its names from these four entries with Round 15 Q1 condition 5's evidence. For a name RED in every matching run: 20's recorded loop runs plus its pre-merge CI run GREEN on that check and leg. For a `flips` name: ≥ 10 GREEN matching CI runs of that leg on 20's tree. If a budget cannot be reached, 20 comes back with numbers per key and leg. It also names the levers outside 20, measured or not: a lower `server.admission.maxInFlightMB` default, a body-processing concurrency limit (Round 1 Q5 condition 2; ticket 19's table is the first evidence for it), and Bun `--smol`. The budgets are never loosened, and the names stay under 20 until then.
- [ ] S1/burst1 (Round 6 Q1, amended by Round 7 Q1): in a ≥ 20-repetition measurement of S1/burst1 on each leg (RSS on Linux, working set on Windows: max(sampled WS, PeakWorkingSetSize)), every repetition is ≤ 250 MB. The tail is gone, so the peak budget holds as a peak. The job keeps the median rule (ticket 60). If every repetition cannot reach ≤ 250 MB, the ticket comes back with numbers. The budget is never loosened.
- [ ] Delete `S1/burst1` (windows) from `tests/memory/expected-red.json` (Round 7 Q3 condition 3). Round 8 Q1 condition 3 may strike this criterion before the ticket starts, if the windows distribution puts the entry's deletion in ticket 60's commit; the criterion above stays either way.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 25

## Comments

- 2026-11-06 (ticket 60, Round 6 Q1 condition 4): this ticket owns S1/burst1 (3 sequential ~10.8 MB requests per run). The burst1 tail above 250 MB comes from body copies overlapping for a short time: 5 of 48 runs on the tip at 97c2211, up to 268.9 MB, plus 299.2 MB earlier. New criterion above: every one of ≥ 20 repetitions ≤ 250 MB on each leg. It replaces the proposed "median ≤ 250 MB, every repetition ≤ 300 MB". Until then the job judges the median of 5 repetitions (≤ 250 MB) and requires every repetition ≤ 400 MB (`tests/memory/lib/budgets.mjs` `REPEATED`). Distribution: METRICS.md "S1/burst1 distribution and the median rule".
- 2026-11-06 (ticket 60, Round 7 Q1/Q3 and Round 8 Q1): the windows leg judges S1/burst1 on the working-set gate, max(sampled WS, PeakWorkingSetSize), not on commit; the 400 MB per-run ceiling applies to that value, and commit is reported per repetition. The criterion text above is amended to match. Round 7 Q3 added the windows delete criterion. Round 8 Q1 condition 2 measures ≥ 20 fresh windows repetitions (`node tests/memory/job.mjs --measure-burst1 N`); condition 3 then keeps, deletes or reopens the windows entry and may raise n.
- 2026-11-07 (ticket 60, Round 9 Q1): the windows `S1/burst1` entry is now `{ "ticket": "20", "state": "unstable" }`. The windows WS-gate distribution sits on the budget: 13 of 24 fresh runs above 250 MB (p = 0.54), median 251.9, max 291.1, CI run 42316982634; METRICS.md has the block. While the entry is unstable, the windows job passes S1/burst1 with a median ≤ 250 MB or ≤ 300 MB and prints "S1/burst1: unstable (median <x> MB, budget 250), owned by ticket 20". A median above 300, a run above the 400 MB ceiling, or any other RED check fails the ratchet. **The only exit:** the criterion above. In a ≥ 20-repetition windows measurement (`node tests/memory/job.mjs --measure-burst1 N`, via the one-run marker `tests/memory/measure-burst1`), every run must be ≤ 250 MB on the WS gate, and the commit that deletes the entry cites that measurement. No single job run and no median ever edits the entry (Round 6 Q2 condition 3, Round 8 Q1 condition 4). The "Delete `S1/burst1` (windows)" criterion stays; Round 8 condition 3 did not strike it. If every run cannot reach ≤ 250 MB, this ticket comes back with numbers, and the budget is never loosened. Ticket 55 removes the `unstable` allow-list once the entry is gone.
- 2026-11-08 (orchestrator, Owner Proxy round 17): Q3 condition 4 — this ticket's "S1 stays GREEN on both legs" criterion is judged on windows under ticket 71's `S1/short` rule: 5 fresh sequential repetitions, `growth:proxy` RED when ≥ 3 of 5 are RED under the unchanged `growth()`, every repetition ≤ 10 %/1k on commit, every other S1/short check judged in each repetition. Linux `S1/short` stays a single run. If this ticket moves the windows commit mean toward 5 %/1k, more repetitions turn RED and the numbers come back.
- 2026-11-08 (orchestrator, Owner Proxy round 18): Q1/Q2 make this ticket the owner of `procPeak:proxy` in `S1/burst4`, `S1/burst16`, `S1/burst32` and `S1/bigbody` on both legs, moved from ticket 19 in 19's commit, with the four budgets as the new Loop S1 criterion above; the per-copy baseline is now ticket 19's tree (ADR-0004 amendment of Round 18), not ~4.5 MB RSS per MB. While listed, a passing burst entry is ungated against regressions: an owned RED passes at any value until this ticket removes the name. This ticket measures against the ≥ 10-run staging/19 CI distribution of Round 18 Q2 condition 1, recorded in METRICS.md. "Comes back with numbers" covers every key and leg. Expect the return path for burst4 and bigbody (the implementer's estimate with copies halved is about 263 MB at 4 bodies). After the copies are removed, this ticket re-measures (peak − 90) / MB admitted at S1/burst16 and burst32, and the result goes into ADR-0004 as a further amendment naming this ticket.
