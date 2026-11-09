# Round 32 (2026-11-09): ticket 61's windows attribution is borderline-unaccounted, and the fix removes the excess

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–31 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-32.md`.
- DECISIONS Round 12 Q3 in full, with its Shared understanding; Round 30 Q1 (conditions 4 and 5, ticket 79); Round 31 Q2 in full, with its Shared understanding (branches 4 and 6).
- Ticket 61 at 6993e3d (`git -C /home/AgentKit/wt/t61 show HEAD:…`): every Comments entry, including the round-2 entry with the criterion-1 verdict. METRICS on the same branch: the caf66db S1 runs, the paired burst4 run, "Windows attribution mode, CI", and ticket 20's burst table.
- `tests/memory/lib/measure.mjs` at HEAD. The rule (`STALLED_ACCOUNTED_SHARE = 0.2`, `|residual| ≤ 0.2 × excess`) is computed from the medians of each component. It was committed in 1495c03 (00:11:48Z), before either run, and `git diff 1495c03 HEAD -- tests/memory/lib/measure.mjs` is empty.
- Artefacts `ci-art/t61m/{m1,m2}-{windows,linux}/`: the `.md` and `.json` files, plus each rotation's `summary.json` (outcome, every check, `growth:proxy` with trend, Bun runtime).
- Git (read-only):
  - `origin/staging/61m1` is 1495c03 plus one commit that adds only `tests/memory/measure-stalled`. `origin/staging/61m2` is ce6d627 plus the same one-file commit.
  - `git diff --name-only 788f2fb 984b45d -- zcode-proxy-src/` is empty.
  - `git diff --stat 984b45d ce6d627 -- zcode-proxy-src/src`.
  - `git diff --stat ce6d627 6993e3d` changes only docs (METRICS and ticket 61).
  - The integration tip since 984b45d is at 2b4e2e0 (tickets 30 and 18; `watchdog.ts` b63f453).

**Recomputed facts and corrections to the round.**

1. **Confirmed: the m1 windows verdict under the pre-registered rule.** Recomputed from the per-rotation raw values in the JSON.
   - Medians:
     - WS: excess 238.2, (iii) 102.4, (i) 85, residual 50.8, so 21.3 %, not accounted.
     - Commit: 271.3 / 111.7 / 85 / 74.6, so 27.5 %, not accounted.
   - Per rotation:
     - WS 20.5 / 19.5 / 18.4 %. Two of three rotations would pass, but the rule is the median form, and that fails.
     - Commit 26.9 / 20.6 / 24.9 %, so commit fails in every rotation.
   - Linux m1: 24.8 / 117.6 = 21.1 %.
2. **Confirmed: m2 is accounted under the same rule.**
   - Windows WS residual −4.0 / 77.6 = −5.2 %. Commit −3.8 / 116.3 = −3.3 %. (i) is 9 MB.
   - Linux m2: 15.3 / 80.8 = 18.9 %, accounted with little margin.
3. **Confirmed: the fix removes the stalled-specific excess.**
   - Stalled minus drained: WS 293.1 − 157.4 = 135.7 → 132.4 − 127.4 = 5.0 MB. Commit 453.7 − 298.3 = 155.4 → 298.1 − 294.7 = 3.4 MB.
   - m2's stalled WS peaks (121.6, 133.2, 132.4) are each more than 140 MB below the lowest of the 75 archived windows S1/stalled artefacts on the `tee()` tree (278–333, median 301.5; ticket 61 Comments).
   - m2's commit peaks are 292.7–306.5, under the 512 backstop.
   - The drained arm also falls on WS, 157.4 → 127.4, so the change helps readers that keep up too.
4. **The round's "when only the response copies change" holds for the proxy source, with one qualification.**
   - Nothing under `zcode-proxy-src/` changed between m1's base 788f2fb and 984b45d. Between the two measured trees, the proxy source differs only by 61's stage-2 files (`handler.ts`, `response-body.ts`, `server.ts`, `sse-translator.ts`) and their tests.
   - Both runs used Bun 1.4.2 (revision 744846f), Node v26.13.0 and the jobobject cap.
   - The trees also differ by kit-side tickets 16 and 38 and `tests/memory/lib/completeness.mjs`. None of these is on S1's proxy response path.
   - m1 and m2 are two CI runs, not one interleaved job. The size of the effect (point 3) makes runner variance an implausible explanation.
5. **Not in the round: m1 linux S1/stalled is RED on `growth:proxy` 6.09 %/1k (trend true) in rotation 3** (procPeak 178.6, count 1, orphans 0).
   - m1 linux stalled growth: 2.46, 4.33, 6.09, trend true in all three.
   - m2 linux stalled growth: 1.40, 1.34, 0.57, trend false in all three.
   - Drained arms on both trees: 0.04–1.27.
   - 6.09 is above 6 %/1k, which is one of ticket 79's early-return triggers (Round 30 Q1 condition 4). The run is an attribution-mode run ("no verdict, no ratchet") on the shipped `tee()` proxy, not on 61's change.
6. **The tip has moved past 984b45d** to 2b4e2e0: tickets 30 and 18. The only proxy-source change is `runtime/watchdog.ts` (the respawn hook's env drops the stop token). That is off the response path, but 61 must still merge it before its pre-merge run.
7. **The burst4 record (ticket 61 METRICS, local, shared machine).**
   - Paired runs: 219.9 (206.4–228.6, n 9) against 230.6 (214.7–235.8, n 9), permutation p = 0.015.
   - Both sit inside ticket 20's final 10-run range of 193.3–241.2. The budget is 250, and burst4 is unlisted on both legs.
   - The only changed code on that path is the 64 KiB socket-write piece.

---

## Q1 — does ticket 61's stage 2 (backpressure) ship?

**DECISION:** ACCEPTED with conditions. One part is REJECTED as worded: "burst4 recorded" (condition 5). The recommendation's merge conditions also leave out the windows half of Round 12 Q3 criterion 3, which is restored here (condition 4).

Stated departure:
- This **departs from the literal gate of Round 12 Q3 criterion 2** ("Stage 2, only if (i) or (ii) carries the excess", evidenced by criterion 1's ±20 % accounting) **and from Round 31 Q2 condition 1** ("Stage 2 still needs the windows attribution … within ±20 %"; inconclusive sends the commits back under criterion 4). The departure is for ticket 61 only.
- The commits have come back as those decisions required, and this round is that return. I decide on stronger measured evidence (C9).

What stays unchanged:
- The pre-registered rule, which is not reinterpreted.
- m1's verdict.
- Every budget.

Consistent with:
- **Round 12 Q3 criterion 4.** Its "the entry stays" branch needs the excess to sit in (iii)/(iv), or in Bun internals with no proxy-side lever.
  - m1's stalled-specific excess (135.7 WS) lies above the drained reference by construction. So it is neither (iii) nor (iv) as the mode defines them.
  - m2 shows a proxy-side lever directly.
- **Round 1 Q5.** Nothing is capped, shed or ended.
- **Round 30 Q1 condition 5.**
- **Round 31 Q2.** Its row-value acceptance now binds, because stage 2 ships.

Binding conditions:

1. **Records, with no retroactive change.**
   - m1 is recorded as "not accounted under the pre-registered rule (WS 21.3 %, commit 27.5 %; per rotation WS 20.5/19.5/18.4, commit 26.9/20.6/24.9)". `STALLED_ACCOUNTED_SHARE` and its median form stay as they are.
   - The residual (50.8 WS / 74.6 commit MB) is recorded as "unattributed, stalled-specific". The "RSS ≈ 2× heapUsed for queued `tee()` bytes" idea is recorded as an unproven hypothesis, not as an attribution.
   - **Basis for shipping.** The m2 intervention:
     - stalled minus drained 135.7 → 5.0 WS and 155.4 → 3.4 commit;
     - (i) 85 → 9;
     - m2 accounted on both metrics;
     - stalled WS 121.6–133.2, against an archive minimum of 278.
   - **No precedent.** A causal A/B does not in general replace a pre-registered attribution. Any other ticket that wants this substitution needs its own round.
2. **Finish Round 31 Q2.** Build conditions 2–6 of Round 31 Q2:
   - the source comment at `printHeader` / `printRow`;
   - seam-4 tests (a)–(c);
   - the release-notes line under edge 54 ← 61, recorded in 54's Comments when 61 closes;
   - the scope note for `/v1/responses` and the async bridge.

   Then merge the current tip (2b4e2e0 or later) into `ticket/61-s1-stalled-windows`.
3. **Transfer rule for the m2 evidence.**
   - m2 covers the shipping tree only if the non-test code of `zcode-proxy-src/src/{proxy/handler.ts,proxy/response-body.ts,server/server.ts,translator/sse-translator.ts}` matches ce6d627's, apart from the comment from condition 2 and anything the tip merge brings in.
   - Otherwise, for example if tests (a)–(c) force a code change, the attribution mode is rerun once on the new head (marker `3`, both legs). Before merge it must:
     - be accounted under the unchanged rule on windows WS and commit;
     - have a stalled WS median ≤ 250 and a commit maximum < 512.

     If either fails, 61 comes back with all values. Nothing is rerun beyond that one run.
   - The marker never merges, and the loop test enforces this.
4. **One pre-merge CI run on the merged head confirms Round 12 Q3 criterion 3 in full, on both legs.** Any RED comes back to an Owner Proxy round with its values, and nothing is rerun. No signature applies: 61 is ineligible for (vii) and (ix).
   - Windows S1/stalled must be GREEN on WS (≤ 250) and under the 512 MB commit backstop, with no `expected-red.json` entry (3820c9a; Round 15 Q1 condition 5).
   - Linux S1/stalled must be GREEN. A RED comes back under Round 30 Q1 condition 5 with the ticket 79 table. The value goes into ticket 79 either way.
   - S1/short, S1/burst1/4/16/32, S1/bigbody and S7 must not regress on either leg:
     - windows S1/short under ticket 71's 5-repetition rule (Round 17 Q3 condition 4);
     - S7 RED only on ticket 33's listed name;
     - every other job GREEN under the normal rules.
   - Then 61 merges alone. It may be reverted on its own.
5. **burst4 (REJECTED: "recorded" alone does not meet criterion 3's "do not regress").**
   - In the pre-merge run, S1/burst4 must be GREEN on both legs (condition 4).
   - The local paired shift (+10.7 MB, p = 0.015) is recorded in 61's Comments and METRICS as "flagged, unattributed". It came from a shared local machine, and both medians sit inside ticket 20's 193.3–241.2.
   - **Trigger, pre-registered now.** After 61 merges, the first S1/burst4 RED on either leg, in any run, comes back to an Owner Proxy round with 61 named as the suspect. 61's 64 KiB socket-write piece is the only changed code on that path, and the margin is 250 − 235.8 = 14 MB.
   - No budget changes.
6. **The m1 linux RED and ticket 79.**
   - The 6.09 %/1k RED of m1 linux rotation 3 is recorded. It is not charged to 61, because the tree is the shipped `tee()` proxy with a test-only mode. It is not rerun.
   - The six linux stalled values of both runs go into ticket 79's record with their run ids, trees and trends:
     - m1 (`tee()`): 2.46, 4.33, 6.09, trend true;
     - m2 (61's head): 1.40, 1.34, 0.57, trend false.
   - The three drained values of each run go in beside them.
   - Ticket 79's "any value above 6 %/1k" trigger has fired, so 79 is due back to an Owner Proxy round. Its question (a), "did a merged tree shift the tail", should then use this contrast as evidence. This round does not answer 79.
7. **When 61 merges:**
   - `S1/stalled` (windows) leaves the list, so 55's empty-list criterion is no longer blocked by 61.
   - Round 31 Shared understanding branch 4 is closed.
   - Round 31 branch 6 (burst4) is settled by condition 5.

**Rationale:** Criterion 1 exists so that a fix is not built on the wrong bucket. Under the rule fixed in advance, the m1 split narrowly fails on WS (21.3 % against 20 %, with two of three rotations passing) and clearly fails on commit. That failure stays on record. The question it was meant to answer has been answered more directly, though. On the same Bun, Node and cap, with the proxy source different only by 61's response-path change, the stalled-specific excess falls from 135.7 to 5.0 MB WS and from 155.4 to 3.4 MB commit. The JS heap that stalled readers hold falls from 85 to 9 MB, and the stalled peaks land more than 140 MB below every one of 75 archived `tee()` runs. The modified tree also passes the very rule that m1 failed. An intervention that removes the effect is stronger evidence than a subtraction-based split of the old tree, and C9 says the stronger measured evidence wins.

Criterion 4 keeps the entry only when the excess is in the drained or floor buckets, or in Bun internals with no proxy-side lever. m2 refutes the lever clause outright, and the stalled-specific part sits outside (iii)/(iv) by construction. Holding back a fix that turns a primary-platform RED GREEN, with an untouched contract, no shedding and no new surface, would fail C1 and C7 for the sake of a 1.3-point miss on an accounting rule whose purpose is already met.

I keep the rule and the m1 verdict exactly as recorded, so nothing is reinterpreted after the fact. I also bound the departure: it does not set a precedent, the m2 evidence transfers only to an unchanged response path, and one pre-merge run must confirm criterion 3 in full on both legs. That includes the windows items the recommendation left out. "burst4 recorded" is too weak for "do not regress" when a significant shift leaves 14 MB of margin, so it gets a GREEN requirement and a pre-registered return trigger. The m1 linux 6.09 is a ticket 79 trigger that the round missed. It belongs to 79, not to 61, and the m1/m2 contrast is useful evidence for that ticket.

**Charter:** C1 (bounded response memory by backpressure, without shedding; the windows RED removed; no budget loosened), C2 (client bytes and field names unchanged; row-value change announced via 54 under Round 31 Q2), C7 (the primary-platform RED fixed; linux not regressed: CI 181 → 144.3, local 175 → 148.5), C9 (stronger measured evidence: a causal intervention over a subtraction split; smaller blast radius: one revertible ticket, a transfer rule, no precedent), §9 (250 WS, 512 commit, 5 %/1k and the S1 budgets unchanged), B1 (no anti-abuse module touched), B5, Round 1 Q5, Round 12 Q3 criteria 1–4 (criterion 2's gate departed from for 61 only), Round 15 Q1 condition 5, Round 17 Q3 condition 4, Round 30 Q1 conditions 4–5, Round 31 Q2 (conditions 1 departed from, 2–6 binding), PROMPT §7 Phase 4 (no rerun-until-green).

**REVERSIBILITY:** Two-way door: an internal response pipeline behind unchanged contracts, a list deletion and records. 61 merges alone and can be reverted alone. ADR: no.

### Exact text change

**`issues/61-s1-stalled-windows-response-side-memory.md`**, add under `## Comments`:

```
- 2026-11-09 (orchestrator, Owner Proxy round 32, binding): stage 2 ships. Criterion 1 is recorded as not accounted under the pre-registered rule on m1 (1495c03, 42561009557): WS 21.3 % (rotations 20.5/19.5/18.4), commit 27.5 % (26.9/20.6/24.9); the rule (STALLED_ACCOUNTED_SHARE 0.2, median form) is unchanged, and the residual (50.8 WS / 74.6 commit MB) is unattributed stalled-specific memory (the RSS ~2x heapUsed idea is unproven). The basis for shipping is the m2 intervention (ce6d627, 42561017903; proxy source differs from m1 only by this ticket's response-path files; same Bun 1.4.2, Node, cap): stalled minus drained WS 135.7 -> 5.0 MB, commit 155.4 -> 3.4 MB, (i) 85 -> 9 MB, m2 accounted (WS -5.2 %, commit -3.3 %), stalled WS 121.6-133.2 against an archive minimum of 278. This is a departure from Round 12 Q3 criterion 2's gate and Round 31 Q2 condition 1 for this ticket only, and no precedent. Before merge: Round 31 Q2 conditions 2-6, merge the current tip, then one pre-merge CI run confirming criterion 3 on both legs (windows S1/stalled GREEN WS <= 250 and commit < 512 with no entry; linux S1/stalled GREEN, a RED comes back under Round 30 Q1 condition 5; S1/short with windows under ticket 71's rule, burst1/4/16/32, bigbody, S7 except ticket 33's name; every other job GREEN); any RED comes back with values, nothing rerun, no signature. m2 transfers only if the non-test code of handler.ts, response-body.ts, server.ts and sse-translator.ts equals ce6d627's (apart from the printHeader/printRow comment and the tip merge); otherwise one rerun of the attribution mode on the new head must be accounted on windows WS and commit with stalled WS median <= 250 and commit max < 512, or 61 comes back. burst4: the local paired shift 219.9 -> 230.6 (p 0.015) is flagged and unattributed; it must be GREEN on both legs pre-merge, and the first S1/burst4 RED on either leg after this ticket merges comes back naming this ticket as the suspect. The m1 linux S1/stalled RED (growth:proxy 6.09 %/1k, trend true, tee() tree) is not charged to this ticket and goes to ticket 79 with the other five linux stalled values (m1 2.46/4.33/6.09 trend true; m2 1.40/1.34/0.57 trend false).
```

**`issues/79-linux-s1-stalled-growth-tail.md`**, add under `## Comments`: the six stalled and six drained linux values of 42561009557 and 42561017903, with trees 1495c03 / ce6d627 and trends, and "early-return trigger (value > 6 %/1k) fired by 42561009557 rotation 3, 6.09 %/1k; due back to an Owner Proxy round".

**RUNLOG:** this round; m1 not accounted (rule unchanged); the departure for 61 only; the 6.09 trigger for 79.

---

## Shared understanding

Open branches I still see:
1. **61's pre-merge run** can fail a criterion-3 item. Windows S1/short runs at about 4 % per run under Round 28 with no signature, and linux S1/stalled at about 0.7 %. Either comes back with values. If the response path changes before merge, condition 3's rerun decides.
2. **Ticket 79 is due back now** (6.09 %/1k on the `tee()` tree). The m1/m2 contrast (trend true 3/3 against false 3/3) suggests that `tee()` queuing feeds the linux S1/stalled tail. That is 79's question (a), not decided here.
3. **The burst4 shift** stays flagged with a return trigger. If it is real, the 14 MB margin under 250 is the risk.
4. **The m1 residual's nature** (native or allocator share of queued bytes, against socket send buffering) stays unproven. It is record only, because the fix removes it.
5. **`/v1/responses` and the async bridge still pump eagerly.** A stalled client of those routes still queues without bound (C1), the row semantics differ by route, and no ticket or measurement exists for them yet (Round 31 branch 5).
6. Round 31 branches 1–3 (ticket 80, the missing linux S2 value, ineligible tickets meeting the S2 tail) are unchanged.
