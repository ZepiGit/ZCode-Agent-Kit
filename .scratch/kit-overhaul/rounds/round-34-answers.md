# Round 34: Owner Proxy answers — ticket 61's transfer-rule rerun (m3)

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–33 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-34.md`.
- DECISIONS Round 12 Q3 (criteria 1–4, with its Shared understanding), Round 31 Q2 and its Shared understanding, Round 32 in full (recomputed facts, Q1 conditions 1–7, Shared understanding).
- `tests/memory/lib/measure.mjs` at 326f5f5: the header comment, `STALLED_ACCOUNTED_SHARE = 0.2` and `stalledReport`. Its history: last changed in 1495c03 (2026-11-09T00:11:48Z), and `git diff 1495c03 326f5f5 -- tests/memory/lib/measure.mjs` is empty.
- Ticket 61 at 326f5f5: criterion text (line 35), the round-1 CI-mode entry (line 82), the round-2 verdict entry (line 150), and the round-3 entry, including its "Transfer rule" paragraph.
- Git (read-only):
  - `git diff --stat ce6d627 326f5f5 -- zcode-proxy-src/src`: non-test proxy code differs in `handler.ts` (comment lines only; no non-comment `+`/`-` line), `sse-terminal.ts` (`{ highWaterMark: 0 }` plus a comment) and `runtime/watchdog.ts` (ticket 18, off the response path).
  - `origin/staging/61m3` is 326f5f5 plus one commit adding only `tests/memory/measure-stalled`.
  - `origin/staging/61r` (7b9896f) has the same tree as 326f5f5, so it carries no marker.
- Artefacts `ci-art/t61m/{m1,m2,m3}-{windows,linux}/measure-S1-stalled.{md,json}` and every m3 rotation's `summary.json` (outcome, `procPeak:proxy` with commit, `growth:proxy` with trend, `count:proxy`), plus the `@@JOB` line of the m2 and m3 windows logs.

**Recomputed facts and corrections to the round.**

1. **Confirmed from the per-rotation rows: the m3 windows medians.**
   - WS: stalled 135.7 (133, 136.9, 135.7). Floor 55.2. Drained 140.4 (140.4, 143.1, 140.3), and its floor is 54.9.
     - Excess 80.5, (iii) 85.5, (i) 12 (stalled heap 30 − 5, drained 18 − 5).
     - Residual −17, which is −21.1 % of the excess: **not accounted**.
   - Commit: stalled 304.8, floor 185.9, drained 300.1 with its floor 181.2.
     - Excess 118.9, (iii) 118.9, (i) 12.
     - Residual −12, which is −10.1 %: accounted.
   - The other two transfer conditions are met: stalled WS median 135.7 ≤ 250, and commit maximum 307.9 < 512.
   - Same conditions as m2: Node v26.13.0 and the jobobject cap (`@@JOB applied=1`, limit 3 GiB).
2. **Per rotation (information only; the rule is the median form, Round 32 condition 1).**
   - WS residual shares: −15.6, −23.4 and −19.9 %. Two of three rotations would pass. This mirrors m1, where the medians failed at +21.3 % and Round 32 held them as not accounted.
   - Commit residual shares: +6.9, −15.4 and −12.7 %.
3. **The miss comes from the drained reference, not the stalled arm.** From m2 to m3:
   - stalled WS median rose by 3.3 (132.4 → 135.7);
   - drained WS median rose by 13.0 (127.4 → 140.4);
   - (i) rose by 3 (9 → 12).

   m2's own drained rotations spread over 124.5–149, so m3's drained values (140.3–143.1) lie inside m2's range. With n = 3, the drained shift cannot be separated from runner variance. In all three m3 rotations the stalled WS peak is below its drained reference, by 7.4, 6.2 and 4.6 MB. On commit, stalled minus drained is +4.7 MB (m2: +3.4).
4. **The rule is two-sided, and that was pre-registered on purpose.**
   - The code reads `Math.abs(residual) <= STALLED_ACCOUNTED_SHARE * Math.abs(excess)`. The header comment says "within ±20 % (Round 12 Q3 condition 1)".
   - Round 12 Q3 criterion 1 itself says "within ±20 %".
   - Ticket 61's round-2 entry states the rule as "|(ii) residual| ≤ 20 %, fixed in the mode before the run".
   - Round 32 recorded it as `|residual| ≤ 0.2 × excess` and said it "is not reinterpreted".
   - The tool's "no" is therefore the pre-registered reading. It is not a coding accident.
5. **The rerun was due.** By its letter, Round 32 condition 3 names four files, and the non-test code of all four equals ce6d627's apart from the comment. The rule's own example, though ("if tests (a)–(c) force a code change"), happened: test (c) forced `sse-terminal.ts`, which sits on the `/v1/messages` stream path. Round 32's Shared understanding branch 1 says: "If the response path changes before merge, condition 3's rerun decides." I do not now fall back on the four-file letter. Choosing the gate after seeing the result would be the same post-hoc move as the one-sided reading.
6. **Not in the round: m3 linux.**
   - RSS: stalled 152.1 (148.2, 152.1, 161.9), drained 120.6, floor 62.9. Excess 89.2, (iii) 57, (i) 10, residual **+22.2, which is +24.9 %: not accounted, on the positive side.**
   - Earlier runs: m2 linux +15.3 / 80.8 = 18.9 % (accounted); m1 linux 21.1 % (not accounted).
   - Round 32 condition 3 gates windows only, so linux does not decide this question. It is still a record:
     - the stalled median is +7.8 MB over m2 (144.3) and −28.9 MB under the shipped `tee()` tree m1 (181);
     - the local linux runs on 5a8ad97 read 143.5 / 148.7 / 151.8.
   - All six m3 linux rotations are GREEN, with count 1. Their `growth:proxy` values:
     - stalled 0.76, 1.88, 3.07 %/1k, trend false in all three;
     - drained 0.59, 0.72, 1.1, trend false.
   - All six m3 windows rotations are GREEN, with growth −0.35 to 0.39 and trend false.

---

## Q1 — does the m3 rerun satisfy Round 32's transfer rule?

**DECISION:** **REJECTED as worded.**
- **The rule.** m3 does **not** satisfy Round 32 condition 3. Under the unchanged, pre-registered two-sided rule, windows WS is not accounted (−21.1 %). Commit is accounted (−10.1 %), and the ≤ 250 WS median and < 512 commit conditions are met.
- **The one-sided reading** ("residual ≤ +20 %") is rejected. So is recording m3 as "accounted (one-sided)".
- **The record.** m3 is recorded only as "not accounted under the pre-registered rule (WS −21.1 %, rotations −15.6/−23.4/−19.9; commit −10.1 %, accounted), with a negative residual: the stalled WS peak is below its drained reference in 3 of 3 rotations".
- **Ticket 61's fate.** Round 32 condition 3 says 61 then "comes back with all values", and this round is that return. I decide that **61 goes to its pre-merge run (staging/61r) and merges only if that run meets Round 32 condition 4 in full.** This is a stated departure from Round 32 condition 3's first bullet (windows WS "accounted" before merge), for ticket 61 only.

Binding conditions:
1. **Records, with no retroactive change.**
   - `STALLED_ACCOUNTED_SHARE`, the `Math.abs` form and the median rule stay as they are.
   - Both failing runs stay recorded as failures of the rule: m1 (+21.3 % WS, +27.5 % commit) and m3 (−21.1 % WS).
   - The cause of the negative residual is recorded as a hypothesis, not as an attribution. Under backpressure, the stalled arm no longer carries all of the drained arm's in-flight native bytes, so (iii) can over-explain the stalled excess. Fact 3 (the drained shift sits inside m2's drained range) is the measured part.
2. **No further rerun.** Round 32 condition 3 allowed one rerun ("nothing is rerun beyond that one run"), and this departure does not add a second one. Changing the rule to fit m3 is ruled out, and so is calling it a "methods fix" now. If anyone wants the rule changed for future tickets, that needs its own round, and the change applies only to runs started after it.
3. **Pre-merge gate unchanged and binding.**
   - Round 32 condition 4 applies in full on staging/61r (tree equal to 326f5f5, no marker), on both legs:
     - windows S1/stalled GREEN at ≤ 250 WS and < 512 commit, with no `expected-red.json` entry;
     - linux S1/stalled GREEN;
     - S1/short (windows under ticket 71's rule), S1/burst1/4/16/32, S1/bigbody and S7 (except ticket 33's name) not regressed;
     - every other job GREEN.
   - Round 32 condition 5 also applies: S1/burst4 GREEN on both legs.
   - Any RED comes back to an Owner Proxy round with its values. Nothing is rerun, and no signature applies. 61 merges alone and can be reverted alone.
4. **Linux record (fact 6).**
   - The m3 linux bucket table, with its +24.9 % not-accounted residual, goes into 61's Comments and METRICS beside m1 and m2. It does not gate this decision.
   - The six m3 linux `growth:proxy` values, with run 42585293731, tree 326f5f5 and trend false, go into ticket 79's record next to m1 and m2 (Round 32 condition 6).
   - **Trigger, pre-registered now.** If the pre-merge linux S1/stalled peak is above m1's 181, that is a criterion-3 "HWM regression". It comes back even if GREEN.
5. **Drained-arm watch.** The m3 drained WS median (140.4) sits above m2's (127.4) and below the shipped `tee()` tree's (157.4). The pre-merge S1/short and S1/burst* items are the regression check for readers that keep up. Nothing more is added.
6. **No precedent, again.** This departure covers 61 only. Its ground is narrow and stated: the failing statistic fails on the side that cannot carry stalled-specific memory, while every Round 32 basis-for-shipping measure holds on the shipping tree. Any other ticket that fails a pre-registered accounting rule, on either side, gets its own round.

**Rationale:** The rule was pre-registered as two-sided, and the evidence shows it was meant that way. Round 12 Q3 wrote "±20 %". The code takes `Math.abs` and cites that line, and the code was unchanged since before m1. Ticket 61 restated it as "|(ii)| ≤ 20 %", and Round 32 refused to reinterpret it even when the reinterpretation would have helped 61. Reading it as one-sided now, after a result that fails only the lower bound, is exactly the after-the-fact reinterpretation that pre-registration exists to stop. The brief requires me to reject a recommendation that conflicts with an earlier decision, so the recommendation's reading and its dual record are rejected.

The rule's failure is what sends 61 back; it does not decide 61's fate, and Round 32 left that decision to this round. The transfer rule exists to show that the shipping tree keeps the properties Round 32 shipped on, and every one of them is reproduced at 326f5f5:
- stalled minus drained is −5.0 WS (all three rotations negative) and +4.7 commit, against m2's 5.0 and 3.4;
- (i) is 12 MB, against 9 on m2 and 85 on the `tee()` tree;
- the stalled WS range is 133–136.9, against an archive minimum of 278;
- commit is accounted;
- all rotations are GREEN with no growth trend.

The one statistic that fails, fails because the measured buckets over-explain. A stalled arm that peaks below its own drained reference cannot hold unexplained stalled-specific memory, which is the thing C1 cares about. The miss is driven by the drained reference moving within its own m2 range, and the code change behind the rerun can only remove read-ahead (at most one frame per stream). Holding 61 back would keep a primary-platform RED with no proxy-side alternative (C1, C7) because of a 1.1-point miss on the benign side.

C9 decides it. The stronger measured evidence is a direct same-run comparison of stalled against drained, reproduced across two trees, and a subtraction identity does not outweigh it. Merging alone, behind the full pre-merge gate, is also the smaller and reversible blast radius.

I keep the departure bounded: the rule and both failures are recorded unchanged, there is no second rerun and no precedent, and a linux HWM trigger is added because the round left out m3's positive linux residual.

**Charter:** C1 (bounded response memory by backpressure, no shedding; no stalled-specific memory remains on the shipping tree), C7 (removes the primary-platform windows RED; linux recorded, gated by the pre-merge run, with an HWM trigger), C9 (stronger measured evidence: a direct stalled-vs-drained comparison reproduced on m2 and m3; smaller blast radius: 61 merges alone and can be reverted), §9 (250 WS, 512 commit and the S1 budgets unchanged; the rule is not loosened). Decisions: Round 12 Q3 criteria 1–4 (the "±20 %" kept as written), Round 31 Q2 (binding, since stage 2 ships), Round 32 Q1 conditions 1, 4, 5 and 6 (unchanged) and condition 3 (first bullet departed from for 61 only; "nothing is rerun beyond that one run" kept), PROMPT §7 Phase 4 (no rerun-until-green).

**REVERSIBILITY:** Two-way door. An internal response pipeline behind unchanged contracts, a list deletion and records; 61 merges alone and can be reverted alone. ADR: no.

### Exact text change

**`issues/61-s1-stalled-windows-response-side-memory.md`**, add under `## Comments`:

```
- 2026-11-09 (orchestrator, Owner Proxy round 34, binding): the transfer-rule rerun m3 (326f5f5, run 42585293731) is NOT accounted under the pre-registered two-sided rule on windows WS: residual -17 MB = -21.1 % of the 80.5 MB excess (rotations -15.6/-23.4/-19.9 %); commit accounted (-10.1 %); stalled WS median 135.7 <= 250, commit max 307.9 < 512. The rule (STALLED_ACCOUNTED_SHARE 0.2, |residual|, median form) is unchanged; the one-sided reading is rejected. The residual is negative: the stalled WS peak is below its drained reference in 3 of 3 rotations (by 7.4/6.2/4.6 MB); the drained median moved 127.4 -> 140.4, inside m2's own drained range 124.5-149; the over-explanation hypothesis (backpressured stalled readers carry less in-flight native memory than drained ones) is unproven. 61 proceeds to its pre-merge run (staging/61r) and merges only if Round 32 condition 4 and condition 5 hold in full; any RED comes back, nothing rerun, no signature. This departs from Round 32 condition 3's windows-WS accounting bullet for this ticket only, no precedent, no second rerun. m3 linux (record, not gating): RSS stalled 152.1, drained 120.6, residual +22.2 = +24.9 % (not accounted; m1 21.1 % no, m2 18.9 % yes); a pre-merge linux S1/stalled peak above 181 (m1) comes back as an HWM regression even if GREEN.
```

**`issues/79-linux-s1-stalled-growth-tail.md`**, add under `## Comments`: the m3 linux values of 42585293731 (tree 326f5f5): stalled `growth:proxy` 0.76, 1.88 and 3.07 %/1k, drained 0.59, 0.72 and 1.1, all with trend false, next to m1 and m2.

**METRICS (61's branch):** the m3 windows and linux bucket tables, next to m1 and m2.

**RUNLOG:** this round; m3 not accounted (WS −21.1 %, rule unchanged); the departure from Round 32 condition 3 for 61 only; the linux HWM trigger.

---

## Shared understanding

Open branches I still see:
1. **61's pre-merge run (staging/61r)** can fail a criterion-3 item. Windows S1/short has about a 4 % per-run chance, linux S1/stalled about 0.7 %, and burst4 has a 14 MB margin. Any of these comes back with values. So does a linux S1/stalled peak above 181.
2. **The two-sided accounting rule may not suit backpressured trees.** Its lower bound may test the additivity of the bucket model rather than memory. Any change is a future-only rule round. It does not apply to 61.
3. **m3 linux is not accounted on the positive side** (+24.9 %, stalled +7.8 MB over m2). It is recorded, not attributed; the pre-merge run and the HWM trigger cover it.
4. Round 32 branches 2–6 are unchanged: ticket 79 is due back, the burst4 shift stays flagged, the nature of the m1 residual is unproven, `/v1/responses` and the async bridge still pump eagerly, and Round 31 branches 1–3 still stand.
