# Round 9: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–8 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself:
- `/home/AgentKit/overhaul-tools/ci-art/r8-measure-nGEr/memory-budget-windows/measure-S1-burst1.{md,json}`:
  - 24 of 24 runs valid: `ws_peak_kb` non-zero in every run, units self-test `ok`, Job Object `applied`, `count:proxy 1`;
  - in every run the WS gate equals `ws_peak_kb` / 1024 (for example 298060 KB = 291.1 MB), so the gate is `max(sampled WS, PeakWorkingSetSize)` as Round 7 Q1 fixed it;
  - 13 of 24 above 250 MB (p = 0.542); min / median / max 206.9 / 251.9 / 291.1 MB; none above 400 MB; commit median 403.7, max 446.3 MB;
  - the first 12 runs have 8 above 250 and the last 12 have 5. That is no evidence of drift at this sample size.
- `…/memory-budget-linux/measure-S1-burst1.{md,json}`: 24 of 24 valid, 1 of 24 above 250 (p = 0.042), max 262.1, none above 400. RUNLOG 2026-11-07T00:15Z has the local 20 runs (2 of 20; pooled 10 of 79 = 0.127). Adding the CI runs gives 11 of 103 (p = 0.107), so the round's figures match.
- RUNLOG 2026-11-06T21:40Z: the Round 8 condition 1 check on run 42281731448 (`ws_peak_kb` non-zero in 19 of 19 rows, gate 222 = max). RUNLOG 2026-11-07T00:15Z and 00:34Z: staging/02 is 0f7b9e4 + 5380767, plus the marker db5f353. The measurement ran in run 42316982634.
- `issues/INDEX.md`: 20 ← 19 ← 13 (and 14) ← 12 ← 11 ← 10 ← 09 ← 02, 03, 04; and 03 ← 02. RUNLOG 21:20Z says "Frontier now only 02". 01, 04, 14 and 50 are `resolved`; 57 and 59 are `needs-triage`. The deadlock fact is correct.
- `issues/55-*.md`: it is blocked by 06, 16, 17, 19, 30, 32, 34, 35, 37 and 58, **not by 20 and not by 61**. Both of those own windows entries today.
- `issues/20-*.md`: the integration tree has no burst1 criteria. On `ticket/60` 7e8520a it carries the Round 6/7/8 burst1 criteria (every one of ≥ 20 repetitions ≤ 250 MB per leg; delete the windows entry).
- `ticket/60` 7e8520a: `tests/memory/lib/ratchet.mjs`, `lib/repetitions.mjs`, `lib/budgets.mjs` (`REPEATED` S1/burst1 n = 5, ceiling `burstPeakMB.burst16` = 400), `job.mjs` and `expected-red.json` (windows `S1/burst1 → 20`; linux unlisted).

**A gap in today's ratchet that matters here.** `medianVerdict` puts `median:procPeak:proxy`, `ceiling:procPeak:proxy` and every other RED check of every repetition into one `redChecks` list, and returns one exit code. `checkRatchet` only sees GREEN or RED per run key, and it accepts any RED for a listed key. So while `S1/burst1 → 20` is listed on windows, a repetition above the 400 MB ceiling, an orphan or a second proxy would all pass as "expected RED". Round 6 Q1 condition 3 ("every repetition must be ≤ 400 MB … applies now") is not enforced for a listed repeated key today. The round's point 2 assumes that it is.

---

## Q1 — What happens to windows S1/burst1 at p ≈ 0.54

**DECISION:** ACCEPTED with conditions. **This explicitly contradicts three earlier decisions:**
- Round 8 Q1 condition 3 says the middle band gets "no 'flaky entry' mechanism", and Round 8 authorised "at most one further windows list change, decided by the rule below". This answer adds such a mechanism, and the change is not decided by that rule.
- Round 6 Q1's rationale ("simpler than a flaky-entry mechanism").
- Round 7 Q3 condition 3 ("the median rule is not stretched to cover it"). The median rule itself is unchanged, but the ratchet is stretched for this one entry.

Round 8 sent the middle band back to the owner for exactly this case, and the distribution is now measured. So this is the intended return path. It is not a silent adjustment.

Merge 02 and then 60, with the windows `S1/burst1 → 20` entry kept and marked `unstable`. Binding conditions:

1. **A listed repeated key tolerates only its median check (this closes the gap above and applies to every listed repeated key, `unstable` or not).** The ratchet must see which checks were RED:
   - For a listed run key in `REPEATED`, the only RED check it accepts is `median:<check>`.
   - Each of these is a ratchet failure, listed or not: `ceiling:<check>`; any other RED check in any repetition (`count:proxy`, orphans, Job Object, units); a harness failure.
   - This enforces Round 6 Q1 condition 3 as written, so it does not contradict it.
2. **What `unstable` means.** It applies to windows `S1/burst1` only:
   - a median ≤ 250 MB passes;
   - a median > 250 MB and ≤ 300 MB passes;
   - each passing run prints `S1/burst1: unstable (median <x> MB, budget 250), owned by ticket 20` in the job summary and in the report rows;
   - a median > 300 MB is a ratchet failure;
   - condition 1 holds on top of this.

   The 300 MB bound is an evidence-backed tightening of the recommendation, not a budget:
   - 0 of 27 windows values exceed 300 MB (max 291.1). The 95 % upper bound on a single run above 300 is p ≈ 0.105, and at that p a median of 5 exceeds 300 with probability ≈ 1.0 % (binomial). The bound does not make the entry flaky.
   - Without it, a Windows-only regression of up to ~109 MB per run would pass silently until ticket 20. Ticket 20 sits eight tickets down the chain, behind Bun 1.4.4 (11) and the undici/happy-dom bumps (12).
   - This is not the per-run "≤ 300 MB" target that Round 6 Q1 condition 4 rejected for ticket 20. Ticket 20's target stays "every repetition ≤ 250 MB", and the 250 MB budget is unchanged.
   - The bound disappears with the entry.
3. **One entry, enforced in code.** `unstable` is a value kind in `expected-red.json`, for example `{ "ticket": "20", "state": "unstable" }`, in one place. The exact shape is the implementer's choice. The schema check accepts it for `windows` `S1/burst1` only, through an allow-list of one key in code. Any other key that carries it is a schema error. `verdict.test.mjs` / the ratchet tests pin these cases RED → GREEN:
   - an `unstable` median of 251 passes, and so does 230;
   - a median of 301 fails;
   - one repetition at 401 fails while the median is 240;
   - an orphan or `count:proxy 2` in one repetition fails;
   - `unstable` on any other key, or on `linux` `S1/burst1`, is rejected;
   - a normal listed repeated entry that is RED only on its ceiling fails (condition 1).

   Any other scenario that lands in a middle band comes back as its own question with its own distribution (Round 6 Q1 condition 6). `unstable` is not extended to it.
4. **One owner, one exit.** The entry leaves the list only through ticket 20's existing criterion: a ≥ 20-repetition measurement where every windows repetition is ≤ 250 MB on the WS gate (run through the off-by-default measurement mode), and the commit that deletes the entry cites it. If ticket 20 cannot reach that, it comes back with numbers (Round 6 Q1 condition 4), and the budget is never loosened. No single job run, and no median of n, ever edits this entry (Round 6 Q2 condition 3 and Round 8 condition 4 stand).
5. **Ticket 55 gets the edge it is missing.** Add `20` to ticket 55's "Blocked by". Without that edge, 55's "empty list on both legs" criterion can come due while the 20-owned entry still exists. 55 also gains the recommended criterion: the guard rejects any `unstable` entry and any re-added entry, and the schema allow-list from condition 3 is removed. Ticket 20 keeps its "Delete `S1/burst1` (windows)" criterion, which Round 8 condition 3 did **not** strike, because the windows result was in the middle band.
6. **Nothing else changes:**
   - the 250 MB budget, the 400 MB per-run ceiling, n = 5 (`REPEATED`) and Round 7 Q1's metric split;
   - windows commit is still reported and still not judged for burst runs (Round 7 Q1 condition 2); the commit max of 446.3 is below the 512 MB paced backstop anyway;
   - Linux keeps S1/burst1 unlisted at n = 5 (false-RED ≈ 1.7 % at the less favourable p = 0.127, within Round 6 Q1 condition 2's 5 %);
   - every other `linux` and `windows` entry;
   - sampled WS does not become the gate. That would loosen Round 7 Q1 and miss the true peak.
7. **Merge path (Round 8 conditions 4 and 5, otherwise unchanged).**
   - Remove the marker commit db5f353.
   - Land conditions 1–5 on ticket 60, restage 02 first and 60 second, and run one pre-merge CI run on staging/02. It must be green on both legs.
   - That run confirms; it does not decide. For S1/burst1, "disagree" now means any of: a Linux median > 250; a windows median > 300; a ceiling breach; any RED check other than the median on either leg.
   - On any disagreement, the numbers come back as a question, with no rerun-until-green. Any other RED follows Round 6 Q2 condition 4 and Phase 4.
   - 02 and 60 merge back to back. Ticket 02 stays open until that run is green (Round 6 Q2 condition 6).
8. **Records.**
   - Spec §18 (S1 row) records the `unstable` state, the 300 MB median bound and condition 1 as a measurement-rule amendment.
   - RUNLOG records them as a deviation from Round 8 Q1 condition 3, naming this round.
   - METRICS.md and ticket 60's Comments get the windows and Linux distributions from run 42316982634, written the way the Linux block was written (Round 8 condition 2).
   - Ticket 20's Comments name the entry's state and its only exit.

**Rationale:** The decision rests on the 27 windows values: the median sits 1.9 MB above the budget and p ≈ 0.54–0.56. With those numbers, every option that keeps a binary ratchet fails:
- Listed as plain RED, the median of 5 is GREEN in ≈ 40–42 % of runs. At n = 9 it is still ≈ 36–40 %. That is a ratchet failure in roughly every second or third windows run, and under Phase 4 that means revert churn on good merges.
- Deleting the entry fails the other way, ≈ 58–60 % of the time.
- Gating on sampled WS would make the leg pass by loosening the metric Round 7 Q1 bound.
- Holding 02 until 20 is a deadlock: 02 is the only frontier ticket, and 20 is downstream of it.

Round 8 refused a flaky-entry mechanism because a "GREEN or RED" entry hides regressions. The evidence above shows that today's plain listing already hides more: it accepts a ceiling breach and any non-median RED for the listed key. So the accepted design is stricter than the status quo for this entry. It tolerates exactly one check, inside a 250–300 MB band with a measured ≈ 1 % false-RED rate. It cannot spread past one allow-listed key, and its only exit is ticket 20's ≥ 20-repetition criterion, backed by a new edge that stops ticket 55 from closing around it. The recommendation is right on the core point and is not loosening the 250 MB budget. It needed the band bound, the per-check tolerance and the 55 ← 20 edge to be safe.

**Charter:** C1 (bounded memory still proven: hard ceiling, single-proxy and orphan checks are now enforced where they were masked, plus a regression bound), C7 (Windows primary: a gate that holds without lying), C9 (stronger measured evidence: 27 valid runs; smaller blast radius than a deadlock or a metric change; one entry, one owner, one exit), §9 (250 MB budget, 400 MB ceiling and n unchanged; the 300 MB bound only tightens), Round 6 Q1 conditions 2–4 and 6, Round 6 Q2 conditions 3, 4 and 6, Round 7 Q1, Round 8 Q1 conditions 4 and 5, PROMPT §7 Phase 4 (no spurious reverts).

**REVERSIBILITY:** Two-way door (test code, one list entry, ticket text and one edge). The state is removed by ticket 20 and guarded out for good by ticket 55. No ADR.

---

## Shared understanding

Open branches I still see (none blocks this round's merge path):
- **Ticket 55 is also not blocked by 61**, but `S1/stalled → 61` is a windows entry. Ticket 61 is `needs-triage`, so 55's empty-list criterion can come due while that entry still exists. The orchestrator should add the edge 55 ← 61, or bring the question back if 61 is never accepted. This answer does not decide it.
- These come back as questions with numbers when they occur:
  - ticket 20 cannot get every windows (or Linux) repetition ≤ 250 MB (Round 6 Q1 condition 4);
  - a windows S1/burst1 median > 300 MB or a ceiling breach after a later merge, most likely at ticket 11 (Bun 1.4.4) or 12;
  - the pre-merge staging/02 run disagrees as defined in condition 7.
