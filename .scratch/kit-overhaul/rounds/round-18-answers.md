# Owner Proxy round 18: answers (ticket 19's memory result: owners of the S1 burst entries, burst32 at the edge, ADR-0004's factor)

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–16 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision. Round 17 is being answered in parallel. Where the two rounds touch, this file says so (Q2 condition 6, Shared understanding).

I checked the evidence myself, read-only:
- `ticket/19-admission-control` at c1fb594 (`git -C /home/AgentKit/wt/t19 show HEAD:…`): `issues/19-*.md` (implementer report), `tests/memory/expected-red.json`, `zcode-proxy-src/src/server/admission.ts:33-47, 272-293` (cap constant and `admissionCost`), `tests/memory/scenarios/s1-proxy-steady.mjs:52-61, 116-126` (body construction, bigbody mix and pacing).
- `ticket/67-owned-checks` at 8901fae: `tests/memory/expected-red.json` (owners/flips schema; every S1 burst entry is `{ "owners": { "19": ["procPeak:proxy"] } }`, with no `flips`), `METRICS.md` S1 rows.
- Integration tree f087813: `docs/adr/0004-*.md`, `docs/adr/0008-*.md:7`, `issues/19-*.md`, `20-*.md`, `21-*.md`, `INDEX.md`, `tests/memory/expected-red.json` (the plain `"S1/burst32": "19"` entry is still present on both legs), `spec.md:633-634, 648`, `METRICS.md:33, 50-60, 215-240`, PROMPT §9, DECISIONS.md Round 1 Q5, Rounds 6, 9, 14, 15 and 16 in full, `rounds/round-17.md`.
- Logs in `reports/`: `t19-meas-impl.log` (5 runs at 93cb559), `t19-final-meas.log` (20 burst32 runs at cfdcbb9, plus S1/short, stalled, burst1 ×7), `t19-final-job.log` (144c031), `t19-v2-meas.log` (the variant that was not adopted).

**Statistics, recomputed** (python, from the log values):
- burst32 at cfdcbb9, 20 runs: median 549.65, min 479.8, max 608.5, mean 550.9, sd 32.5, 2 above 600 (602, 608.5). p = 0.10, Clopper–Pearson 95 % interval 0.012–0.317. Pooled with the 5 runs at 93cb559 and the final job: 2 of 26 above 600, p = 0.077 (0.009–0.251), median 551.6.
- 5-run medians: burst4 329.2 (296.2–371), burst16 488.6 (428.5–524.5), bigbody 358.3 (329.8–375.1). Against the single tip run: −10.1 %, −46.5 %, −14.2 %, and burst32 −56.8 % (20-run median) or −55.0 % (5-run median 573).
- A median of n repetitions at p = 0.10 goes RED with probability 2.8 % (n = 3) and 0.86 % (n = 5). At the interval's upper end, p = 0.32, those rates are 24 % and 19 %.

**Corrections to the round's facts.**
1. **Six bodies are admitted under the cap, not five.** The cap is 64 MiB (`DEFAULT_MAX_IN_FLIGHT_BYTES = 64 * 1024 * 1024` = 67,108,864 B). A request is charged its `Content-Length`. The S1 body is `"lorem ipsum dolor sit amet "` × 400,000 = 10,800,000 B plus about 100 B of JSON. 6 × 10.8 MB = 64.8 MB fits, and 7 does not. So burst16 and burst32 hold **64.8 MB** in flight, not 54.
2. **The factor, recomputed on ADR-0004's own formula** (peak = ~90 MB base + factor × MB in flight):
   - burst16, 6 bodies: (488.6 − 90) / 64.8 = **6.2 MB per MB** at the median, range 5.2–6.7.
   - burst32, the same 6 bodies plus up to 26 queued requests: median 7.1, range 6.0–8.0. The ~61 MB between the burst16 and burst32 medians, with the same bytes admitted, is a cost of the queue, not of the bytes in flight.
   - burst4, 43.2 MB, where the cap does not bind: 5.5.
   - burst1, one 10.8 MB body at a time: (182.7 − 90) / 10.8 = 8.6.
   - On the tip, unbounded, the same formula gives 4.8 at burst16 and 3.4 at burst32. That is where the ~4.5 came from.

   The round's "7–8 MB per MB" comes out only as (peak − 90) / 54 with five bodies, or as total RSS / 64.8 at burst16 (6.6–8.1). The ratio is also not constant: 5.5–8.6 across the variants. A single linear factor does not predict the peaks.
3. **The "1 linux job in 10" figure is local only.** All 26 burst32 values come from this machine. CI's Linux S1 peaks have run higher than local ones before (Rounds 10–11: the CI Bun 1.4.2 arm had S1/burst1 above 250 MB in 5 of 24 runs). The windows leg has **no** value on 19's tree. EVIDENCE MISSING: the CI distribution of every S1 burst key on 19's tree, on both legs. Q2 condition 1 supplies it.
4. **`S1/burst32` has not left the list.** The deletion is ccd5d27, on the unmerged branch. The integration list still holds `"S1/burst32": "19"` on both legs. So keeping the key listed is a re-point, not a re-add (Round 15 Q1 condition 5 forbids re-adds).
5. **bigbody is paced.** It sends 240 requests at 4 requests/s and concurrency 16, mixing 10.8 MB text bodies with 8 MB images. The cap binds only some of the time.
6. **Stale text.** Ticket 20's Acceptance cites "baseline ~4.5 MB RSS per MB". Spec §18 (`spec.md:634`) and ADR-0004 point 7 say "the byte cap alone: 64 × ~4.5 + ~90 ≈ 380 MB". ADR-0008:7 derives its "designed maximum of about 450 MB" from the same 4.5.
7. **The collection is a lever, not part of the contract.** One deferred full GC runs after a release of ≥ 4 MiB. The cap without it left burst32 at 677.8 and 733.8 MB, RED. With it, burst32 is GREEN at the median. The collection is part of why 600 MB is met. Its pause length while other streams are open was not measured (Shared understanding).

---

## Q1 — who owns `S1/burst4`, `S1/burst16`, `S1/bigbody` now?

**DECISION:** ACCEPTED with conditions. Owner **20**, on both legs, check `procPeak:proxy`. Ticket 19's memory criterion is amended so that 19 can close on what admission delivers. Ticket 20's Acceptance names the three budgets, plus burst32's (Q2). No budget changes. No new ticket. No new edge: 55 ← 20 and 61 ← 20 already exist.

**This explicitly contradicts Round 1 Q5 condition 5**, "the byte cap alone meets both budgets". The measurement refutes it: burst16 has a median of 488.6 MB against a budget of 400 with the cap in place. The budgets now need the cap (point 1) and fewer copies (point 6) together. Round 6 Q1 condition 6 said that burst4 and bigbody "come back with numbers once ticket 19 lands". This is that return. No other earlier decision is contradicted.

Binding conditions:
1. **Trace (Round 15 Q1 condition 2).** Once 19's line below replaces its budget line, 20 is the only claimant: its new Acceptance line names each key and its budget. 20 is also 19's descendant on the blocking graph (20 ← 19), so the several-claimants rule gives the same owner. ADR-0004 point 6 names the mechanism.
2. **Ticket 19's Acceptance.** Replace the line "Loop S1 burst: HWM ≤ 400 MB at 16 and ≤ 600 MB at 32 × 10.8 MB bodies (≥ 30 % peak improvement); bigbody within budget. **Delete `S1/burst4`, `S1/burst16`, `S1/burst32`, `S1/bigbody` (linux, windows).**" with:
   > - [ ] Loop S1 (Round 18 Q1): `procPeak:proxy` improves by ≥ 30 % at S1/burst16 and S1/burst32 on each leg. Linux: the tip f906014 against this branch (burst16 912.9 → 488.6, 5-run median; burst32 1,272.4 → 549.7, 20-run median). Windows: the median of the ≥ 10 staging/19 CI runs (Round 18 Q2 condition 1) on the WS gate, against the median of ticket 67's matching windows runs on the pre-19 tree. S1/burst4 and S1/bigbody are recorded per leg. The byte cap's hard bound is proven by the seam-4 loopback tests above. 19's `procPeak:proxy` names in `S1/burst4`, `S1/burst16`, `S1/burst32` and `S1/bigbody` (both legs) move to ticket 20 in 19's commit (Round 18 Q1 and Q2). The budgets (≤ 250 / 400 / 600 / 250 MB) are ticket 20's criteria.

   If windows misses ≥ 30 % at burst16 or burst32, 19 comes back with the numbers.
3. **Ticket 20's Acceptance gains:**
   > - [ ] Loop S1, both legs (Round 18 Q1/Q2): `procPeak:proxy` ≤ 250 MB (S1/burst4), ≤ 400 MB (S1/burst16), ≤ 600 MB (S1/burst32), ≤ 250 MB (S1/bigbody). Linux judges RSS, windows the WS gate (Round 7 Q1). 20 removes its names from these four entries with Round 15 Q1 condition 5's evidence. For a name RED in every matching run: 20's recorded loop runs plus its pre-merge CI run GREEN on that check and leg. For a `flips` name: ≥ 10 GREEN matching CI runs of that leg on 20's tree. If a budget cannot be reached, 20 comes back with numbers per key and leg. It also names the levers outside 20, measured or not: a lower `server.admission.maxInFlightMB` default, a body-processing concurrency limit (Round 1 Q5 condition 2; ticket 19's table is the first evidence for it), and Bun `--smol`. The budgets are never loosened, and the names stay under 20 until then.

   In the existing line, "(baseline ~4.5 MB RSS per MB)" becomes "(baseline: ticket 19's tree, ADR-0004 amendment of Round 18; per copy removed, record the S1/burst4/16/32/bigbody peaks and (peak − 90) / MB admitted)".
4. **Comments.** 19 and 20 each get a line naming this round. 19's line corrects "5 bodies of 10.8 MB" to 6 bodies, 64.8 MB (correction 1). 20's line says that a passing burst entry is ungated against regressions while listed (Shared understanding) and that 20 measures against the ≥ 10-run distribution of Q2 condition 1. "Comes back with numbers" covers every key.
5. **Merge check (Round 15 Q1 condition 5).** 19's evidence lists every name it owned with its status ("moved to 20, Round 18"). After the move, 19 owns no S1 name, unless Round 17 Q3 gives it one (Q2 condition 6).
6. **Nothing else changes:** the four budgets, the 64 MB default, ADR-0004's shed contract, n = 7 and the windows `S1/burst1` `unstable` entry with its only exit (Round 9 Q1 condition 4). Linux burst1's 182.7 MB median edits nothing.

**Rationale:** The evidence settles that admission alone cannot meet these budgets. Burst4 holds 43.2 MB, below the cap, so the cap never acts on it. Burst16 holds the full 64.8 MB and still peaks at 489 MB. Bigbody is paced. What remains between the measured peaks and the budgets is per-body overhead, and that is exactly the subject of 20's What-to-build and ADR-0004 point 6. Keeping the names under 19 would leave a finished, high-risk ticket open on criteria its mechanism cannot reach. Moving them silently would break Round 15's "only the owner removes its names". A named re-assignment in an Owner Proxy round, with numbers, is the return path Round 16 Q3 described ("the Owner Proxy then decides the follow-up's names in the open"). 19 keeps a measurable criterion of its own: ≥ 30 % at the two variants where the cap binds, on both legs. That is §9's rule applied to the share 19 can deliver. The budgets stay whole and move to the ticket that can meet them. If it cannot, the numbers come back.

**Charter:** C1 (bounded in-flight bytes proven at seam 4; memory budgets kept, with an owner able to meet them), C7 (≥ 30 % checked on windows, not assumed), C9 (stronger measured evidence: 26 + 15 loop runs; smaller blast radius: ticket text and owner ids, no budget or default change), §9 (no budget loosened; the ≥ 30 % rule applied), Round 1 Q5 conditions 2 and 4, Round 6 Q1 conditions 4 and 6, Round 15 Q1 conditions 2 and 5, Round 16 Q3.

**REVERSIBILITY:** Two-way door (ticket text and owner ids). ADR: no. ADR-0004's consequence is recorded under Q3.

---

## Q2 — `S1/burst32`: delete now, or keep listed?

**DECISION:** REJECTED in part.
- **Accepted:** `S1/burst32` stays listed on both legs under owner 20 (`procPeak:proxy`), on ticket 67's schema. 67 merges first, and 19 is restaged on 67's schema before its pre-merge run. ccd5d27's deletion is reverted on 19's branch. 20 deletes the entry through Round 15's flipping-name rule.
- **Rejected:**
  - marking `flips` from the 2 of 20 local runs and one windows pre-merge run;
  - deleting the entry (the implementer's choice);
  - holding 19 until 20 lands.

  The `flips` marks for every S1 burst key are set from ≥ 10 matching CI runs per leg on 19's tree.

**This explicitly contradicts Round 15 Q1 condition 4**, "a name is marked only by 67 … A mark is never added later". For S1 keys on 19's tree, 19's restaged commit sets marks. It sets them by condition 4's own test (RED in fewer than all matching runs of the leg) and Round 15 Q2's counting (CI runs only). This is the return path Round 16 Q2 condition 3(c) named for a name that turns GREEN after a merge. It is not a silent mark. It also departs from Round 6 Q2 condition 2's "removal with numbers" in one respect: under condition 3 below, a local RED can block a deletion. The local runs still never set a mark.

Binding conditions:
1. **Evidence before 19 merges.** ≥ 10 valid CI runs of the full short profile on staging/19, on both legs (one run covers both). The S1 matching rule is METRICS.md's rule applied to S1: the same `s1-proxy-steady.mjs`, `verdict.mjs`, `budgets.mjs` and proxy request path (`zcode-proxy-src/src/server/*`, both `handler.ts`, `config/loader.ts`), on Bun 1.4.2. 19 changes that path, so every S1 key's matching count restarts on 19's tree (Round 15 Q2 condition 2, Round 16 Q2). The runs may start now, on the tree with burst32 deleted. Each run's S1 RED sets are replayed through 67's final ratchet with this round's S1 entries (`t67-scripts/replay.mjs`, Round 16 Q2 condition 2). Restaging onto 67 does not reset the count, because the list, `ratchet.mjs` and the tests are outside the matching rule. METRICS.md records every value per key and leg. The 26 local burst32 values go there as a labelled supplement.
2. **Marks from those runs, per S1 burst key and leg** (Round 15 Q1 condition 4's test):
   - RED in some runs and GREEN in others: owner 20, marked `flips`;
   - RED in every run: owner 20, no mark;
   - GREEN in every run: 19's commit deletes that leg's entry and cites the run ids (the ≥ 10-GREEN floor is met). The exception is condition 3.
3. **Linux burst32 keeps a mark whatever the CI count shows**, unless it is RED in every run, in which case it carries no mark. The local supplement shows the check RED in 2 of 26 runs on this code. Deleting the entry would make an unlisted RED likely about once every 10–13 jobs (p 0.077–0.10), which is the random merge block that Rounds 9, 13 and 15 refused. A local RED can block a deletion. It can never set a mark (Round 15 Q2 condition 1 stands).
4. **What comes back with run ids, with no rerun-until-green and no list edit in between:**
   - any S1 RED not owned under this round (for example a ceiling, `count:proxy`, an orphan, a linux S1/short or S1/stalled RED);
   - windows `S1/stalled` (owner 61, no mark) GREEN in any run (Round 16 Q2 condition 3(d));
   - a windows `S1/burst1` result outside its `unstable` bounds;
   - a harness failure or an invalid run, which does not count.

   Rare REDs on non-S1 keys follow Round 17's answers and do not invalidate a run's S1 count, provided the run's summary table printed.
5. **Expected default.** Linux burst32 marked `flips`. Linux burst4, burst16 and bigbody unmarked. Windows decided by condition 2. 19's pre-merge run on its restaged tip passes the ratchet and counts as one more run. No owner list or mark changes after it.
6. **Round 17 interplay.** This answer does not depend on Round 17's outcome, with one addition. If Round 17 Q3 lists windows `S1/short` (`growth:proxy`), that key's matching runs also restart on 19's tree, because 19 changes S1's request path, and the staging/19 runs are its floor too. If Round 17 names 19 as that key's owner, 19 holds that name: it lists the name in its merge check and closes only after removing it with ≥ 10 GREEN windows CI runs on its tree (Round 15 Q1 condition 5). For the record, 19's text, before and after Q1, names no growth bound. Its only S1/short evidence is linux GREEN at 2.46 %/1k.

**Rationale:** Each option has a measured cost:
- **Deleted:** the entry fails about one linux job in 10–13 at random, and windows is unknown.
- **Listed plain:** it fails about nine in ten as GREEN-but-listed.
- **Holding 19 for 20:** a high-risk, finished ticket waits on a medium ticket that is blocked by it, and three other tickets wait behind 19 (21, 39, 58).

Listing with a measured `flips` mark is the only state that passes deterministically, and it uses the mechanism Round 15 built for exactly this case. The recommendation's evidence for the mark is the weak part. Round 15 Q2 rejected local runs for marks because CI behaved differently, and S1 has a history of CI peaks above local ones. One windows run cannot show that a check flips. Ten CI runs cost no local resources, settle the windows distribution that is still missing for all four keys, and turn the mark into Round 15's own test rather than an exception to it. The cost of listing is that a burst32 regression passes as an owned RED until 20 removes the name. The listed burst4, burst16 and bigbody entries already have that cost, as all four had before 19, and the gap closes at the very next ticket in the chain.

**Charter:** C1 (bounded memory still proven by every non-owned check; no random merge blocks that would revert good work), C7 (windows decided on its own numbers), C9 (stronger measured evidence: CI runs over local runs; smaller blast radius: one entry per leg, an existing mechanism, no new code), Round 9 Q1 condition 3 (`unstable` not extended), Round 15 Q1 conditions 4 and 5, Round 15 Q2 conditions 1 and 2, Round 16 Q2 conditions 2 and 3, PROMPT §0, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (list entries, marks and run scheduling). ADR: no.

---

## Q3 — ADR-0004's per-MB factor

**DECISION:** ACCEPTED with corrections. ADR-0004 gets an amendment that records the measured result with the corrected numbers: 6 bodies and 64.8 MB, a factor of about 6.2 at burst16, and a ratio that is not constant. It supersedes point 7's "the byte cap alone meets both". The 64 MB default stays. Ticket 20 re-measures, and the ADR gets a second amendment with its result. Spec §18 and ADR-0008 get matching one-line corrections. Every threshold and budget is unchanged. **ADR: yes** (an amendment to ADR-0004, with a cross-reference note in ADR-0008).

**This explicitly contradicts Round 1 Q5 condition 5**, as Q1 does. Nothing else is contradicted. The shed contract, the queue bounds, the idle rule (Round 5 Q4) and the no-concurrency-cap decision (Round 1 Q5 condition 2) stand.

Binding conditions:
1. **Append to ADR-0004:**
   > ## Amended 2026-11-08 (Round 18, Q1–Q3)
   >
   > Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 18.
   >
   > - **The factor under the cap (ticket 19, linux, RSS).** The default cap is 64 MiB (67,108,864 bytes; the key `server.admission.maxInFlightMB` counts MiB), so six 10.8 MB bodies (64.8 MB) are admitted at once. With them, S1/burst16 peaks at 428.5–524.5 MB (median 488.6, 5 runs): about 6.2 MB RSS per MB admitted above a ~90 MB base (5.2–6.7), not the ~4.5 measured at 16–32 unbounded bodies. S1/burst32 peaks at 479.8–608.5 MB (median 549.7, 20 runs; 2 above 600) with the same bytes admitted. The ~61 MB more than burst16 is the cost of the queued requests. The ratio is not constant (5.5 at 4 bodies, 8.6 at 1), so the linear formula in point 7 does not predict peaks.
   > - **Point 7's "the byte cap alone meets both" is superseded.** On today's code the cap alone meets neither budget at 16 bodies, and meets 32 only at the median, with ticket 19's one deferred collection after a ≥ 4 MiB release (cap only: 678–734 MB). The budgets stand unchanged. They are met by points 1 and 6 together, and ticket 20 owns them (≤ 250 / 400 / 600 / 250 MB for S1/burst4 / burst16 / burst32 / bigbody). If 20 cannot reach them, the question comes back with numbers. The levers outside 20 are a lower cap default, a body-processing concurrency limit (point 5) and Bun `--smol`.
   > - **The 64 MB default stays.** No lower value has been measured, and a lower one would queue and shed parallel sessions sooner (point 5's reasoning). It is a two-way door through the config key.
   > - **Ticket 20 re-measures** (peak − 90) / MB admitted at S1/burst16 and burst32 per copy removed. The result is recorded here as a further amendment naming the ticket.
2. **Spec §18, `spec.md:634`.** "(the byte cap alone: 64 × ~4.5 + ~90 ≈ 380 MB)" becomes "(the byte cap plus fewer copies, ticket 20; under the cap alone, burst16 median 488.6 MB at 64.8 MB admitted, ADR-0004 amendment Round 18)". Mark it as a measurement-record amendment. Budgets unchanged.
3. **ADR-0008 gets a cross-reference note, and its thresholds do not change.** Its "designed maximum of about 450 MB … 64 MB × ~4.5" is out of date: the measured linux maximum under the cap is 608.5 MB (RSS, S1/burst32). The soft limit of 512 MB, which only WARNs, can therefore fire under legitimate cap-saturating load. The hard limit of 1024 MB has more than 400 MB of margin on linux. The windows footprint on 19's tree is EVIDENCE MISSING; Q2 condition 1's runs record it. Ticket 21 gets a Comments line naming this round: its evidence records the proxy footprint the supervisor samples, per leg, for the S1 burst runs on its tree. If that footprint can hold at or above 1024 MB for 3 samples, 21 comes back with numbers before it merges (C1: no restart storms).
4. **METRICS.md line 33** keeps its Phase 1B "~4.5 MB RSS per MB in flight" as history and gains the 19-tree figures next to it.
5. **Records.** RUNLOG names this round. The ADR amendment is written by the orchestrator, not by 19 or 20.

**Rationale:** The ADR is the place a later reader goes to learn why 64 MB was chosen and whether it meets the budgets. Today it says the cap alone suffices, and the measurement says it does not. Leaving that text in place would point ticket 20, ticket 21 (whose thresholds were derived from it) and any future tuning at a wrong model. The recommended wording would have recorded a factor that cannot be reproduced from the code (five bodies) and that hides the queue cost. The corrected amendment records what was measured and how to recompute it. Keeping the default is the reversible, evidence-backed choice: lowering the cap has no measurement behind it and costs parallel sessions directly. The re-measure after 20 closes the loop.

**Charter:** C1 (memory model and supervisor thresholds kept honest; no restart storm from a stale derivation), C2 (default unchanged; config key unchanged), C8 (ADR, spec and METRICS consistent), C9 (stronger measured evidence; then the smaller, reversible option: text only, no default change), §9 (no budget loosened), Round 1 Q5 conditions 2, 4 and 5, Round 5 Q4.

**REVERSIBILITY:** Two-way door for the text and the default. The ADR amendment records a hard-to-reverse fact (the shed contract's memory model) and is permanent history. **ADR: yes.**

---

## Shared understanding

Open branches I still see. None blocks 19 once Q2's runs are in and 67 has merged:
- **19 waits on 67.** If 67's merge is delayed by Round 17 (its rare REDs), 19 waits with it. Wall-clock time does not matter (PROMPT §0). The staging/19 runs can still run in the meantime.
- **burst4 and bigbody may be out of 20's reach.** The implementer's own estimate with copies halved gives about 263 MB at 4 bodies, still above 250. Expect the Q1 condition 3 return path. The named levers are not adopted now.
- **While listed, the S1 burst entries are ungated against regressions.** An owned RED passes at any value until 20 removes the name, as it did before 19. 20 measures against Q2 condition 1's recorded distribution, and its pre-merge evidence shows any drift.
- **EVIDENCE MISSING: the pause length of the coalesced `Bun.gc(true)` while other response streams are open.** It is a C1/C3 question (stalled streaming during a full collection). Nobody has measured it. If 20 or 21 measures stream latency, it belongs there. Today it is not a merge condition.
- **Round 17 Q3 (windows S1/short `growth:proxy`)** touches 19 only as described in Q2 condition 6. This file decides no owner for it.
