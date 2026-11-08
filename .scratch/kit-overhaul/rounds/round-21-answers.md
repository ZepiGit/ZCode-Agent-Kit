# Owner Proxy round 21 — answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–20 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only; scratch copies outside the worktree in `/tmp/r21`):
- The linux `memory-budget` job log of run 42446461464, through `gh api …/actions/jobs/128626314087/logs`. `gh run view --log` returned an empty file, so I used the job-log API instead. I also read its windows memory log (job of the same run) and its `memory-budget-linux` artefact (`S6-short/…/summary.json`, all phase marks).
- The `memory-budget-linux` artefacts of all 10 staging/19 evidence runs (42446103818 … 42446746036). All 10 heads carry tree 6f25f13.
- The linux memory-job log of every completed CI run from 42415961268 (ticket 32's pre-merge run) to 42454650683: 34 runs. I checked each head with `git diff --quiet <head> HEAD -- zcode-proxy-src/src/tui tests/memory/scenarios/s6-tui*`. 33 judge the same S6 and pane code as the integration tip. The 34th, staging/42 (42415962768), predates 32.
- Integration tip 064cfec: `tests/memory/scenarios/s6-tui.mjs`, `s6-tui-run.ts`, `tests/memory/lib/budgets.mjs`, `tests/memory/lib/repetitions.mjs`, `zcode-proxy-src/src/tui/log-pane.ts` (and its imports `width.ts`, `width-core.mjs`, `frame.ts`, `tokens.mjs`).
- `issues/32-*.md` (with Comments), `49-*.md`, `71-*.md`, INDEX.md, spec §18 S6 row and §13 (S6 is ubuntu-only), RUNLOG to 07:14Z.
- DECISIONS.md Round 17 (Q1, Q3, cross-question conditions 1–3), Round 18 Q2 condition 5, Round 6 Q1, Round 15 Q1.
- Ticket 19's own diff: `git diff --stat $(git merge-base HEAD ef0a331c) ef0a331c`, 15 files.

**Corrections to the round's facts.**
1. **This is not a tail around the cap. It is a discrete 20 MB event at a different mark.** In all 32 GREEN CI runs on identical S6 code, the check reads exactly **8 MB**. The worst mark is `D-huge` (heap 10 − `C-start` 2: the 8 MB truncated line). In the RED run, `D-huge` is the usual 10 and `D-cjk` the usual 7. But `D-records` reads **22 MB** where the 9 other staging/19 runs read **2 MB** (9 of 9), and `end` reads 22 again (2 in 9 of 9). Pane 2,000 lines throughout, end RSS 242 MB (others 198–269).
2. **The readings are already taken after a forced GC.** `mark()` calls `Bun.gc(true)` before every reading (`s6-tui-run.ts:27-31`). The 20 MB survived two consecutive forced full collections, at `D-records` and `end` with a `scrollDown` between them. Round 17 Q1's premise does not hold here. That premise was a heap reading without GC, taken at a random moment, which a later reading undercuts.
3. **The rate is 1 of 33 CI runs, not only 1 of 10.** 1/33 = 3.0 % (95 % Clopper-Pearson 0.08–15.8 %); 1/10 on the staging/19 tree = 10 % (0.25–44.5 %). `tui:long-line-heap` is 7–8 MB in all 33.
4. **Cause: not attributed.** 20 MB is the size of one `D-records` parent. It is also the value ticket 32's `t32-s6-red2` showed without the copy. But the pane copies every stored row through UTF-8 (`log-pane.ts:66-75`), with no shared state and a fixed input. A pane-held parent would therefore read about 20 MB in every run, not in 1 of 33. The evidence fits a reference held outside the pane's rows, by the runtime or by the S6 body itself, and it varies per process. Nothing on record proves which.
5. **Ticket 19 cannot have caused it.** 19's diff (15 files) touches no file under `zcode-proxy-src/src/tui/`, neither S6 file, no `tests/memory/lib/{verdict,budgets,sampler*}.mjs` and not the Bun pin. The same run's windows memory failure is `S1/burst16: GREEN but listed for ticket 19`. That failure is 19's own exit signal, already handled in t19 round 2, and it is not part of this question.
6. **Minor record drift.** INDEX rows 32 and 67 say `ready-for-agent`, but both files say `resolved`. RUNLOG 07:14Z says t71 is already spawned.

---

## Q1 — who owns the tail of S6's adversarial line-heap check?

**DECISION:** REJECTED in part.
- **Accepted:** the fix belongs in ticket **71** as a measurement-rule amendment, not as an owned RED. Signature (v) joins Round 17's interim rule until 71 merges. The 16 MB budget and the check name stay.
- **Rejected:** the measurement shape (the minimum of ≥ 10 readings after the adversarial phase), on three grounds:
  - the readings are already post-GC, and the excess survived two of them (corrections 1–2), so nothing shows a later reading would drop it;
  - judging only after the phase throws away the per-part marks (`D-mixed`, `D-huge`, `D-cjk`) that the check was built to judge;
  - the evidence that does exist says the event is per process (32 of 33 fresh processes read 8). What re-rolls it is a **fresh process**, not another reading in the same one.
- **Also rejected:** naming ticket 49 as a fallback owner. 49's text says nothing about pane memory beyond "byte cap from 32 kept" (Round 15 Q1 condition 2).

Instead, **linux `S6/short` is judged on the median of n = 5 fresh, sequential repetitions**, through the existing `REPEATED` mechanism.

Binding conditions:
1. **The rule (in 71; one `REPEATED` entry, the mechanism of `lib/repetitions.mjs` unchanged):**
   - the entry is `"S6/short": { n: 5, check: "tui:adversarial-line-heap", budgetMB: MEMORY.S6.longLineHeapMB /* 16 */, ceilingMB: 32 }`;
   - each repetition is a fresh S6 body process, run one after another. The check's value per repetition is unchanged: the worst of `D-mixed`, `D-huge`, `D-cjk`, `D-records` and `end`, minus `C-start`, each read after `Bun.gc(true)`;
   - RED when the median of the 5 is > 16 MB, or when **any** repetition is > 32 MB;
   - `orphans`, `tui:log-pane-heap`, `tui:resize-storm-heap` and `tui:long-line-heap` are judged in **each** repetition, and a RED in any one fails. This is the existing behaviour of `medianVerdict`;
   - `summary.json` and the job summary print all five values and the median.

   Windows is unaffected (S6 is ubuntu-only).
2. **Why n = 5, and why 32 MB.**
   - n follows Round 17 Q3's method: the smallest odd n whose predicted false-RED rate is ≤ 1 % on the less favourable estimate. The staging/19 tree's 1/10 gives n = 3 → 2.80 % and n = 5 → 0.86 %. The 33-run 1/33 gives 0.27 % and 0.027 %, and 3.0 % at its 95 % upper bound.
   - An S6 body takes about 3 s (log 04:56:52 → 04:56:55), so the cost is about 12 s per linux job.
   - The ceiling is 2× the budget, as in Round 17 Q3. It clears the pane's own 8 MB plus the one stray 20 MB object seen here at any mark (about 28 MB). It fails an uncapped pane (about 125 MB) or two retained parents (≥ 40 MB) in a single repetition.
   - The median loses nothing against the defect class: the pane is deterministic code on fixed input, so a pane defect reads RED in every repetition (32's own red2: 20 MB).
3. **Attribution, recorded as information and not gated:**
   - every S6 mark gains `paneBytes` (`pane.bytes`);
   - after `end`, the body pushes 2,000 short ordinary lines, which evicts every stored row, and takes a `flushed` mark.

   The checks' marks are unchanged.
4. **Tests, RED first, at the job seam with fixture repetitions:**
   - [8, 8, 20, 8, 8] is GREEN;
   - [20, 20, 20, 8, 8] is RED (median);
   - [8, 8, 33, 8, 8] is RED (ceiling) with a GREEN median;
   - a repetition with `tui:long-line-heap` RED fails;
   - a missing repetition or a non-numeric value is a harness failure, never GREEN;
   - the S1/burst1 cases and 71's windows S1/short cases are unchanged.

   Plus one local mutant, never committed: `fitLine` storing the raw row without the copy must be RED under the new rule (expected median about 20 MB). Record the value.
5. **What comes back** (none of these blocks 71's merge, except a RED in its pre-merge run, which Round 17 cross-question condition 1 already covers):
   - any repetition > 16 MB whose `flushed` reading returns to within 2 MB of `C-start`. Releasing the pane's rows freed the excess, so the pane held it, and correction 4 is wrong;
   - a median > 16 MB on a tree whose diff does not touch the pane. That is a real leak with an unknown owner. It comes back as an ownership question, with the series and marks, to a new ticket and not to 49;
   - a per-repetition rate above 10 % over ≥ 50 recorded repetitions. That is n's basis, so n comes back.
6. **Interim (amends Round 17 cross-question condition 2 by one signature):**
   - (v) linux S6/short RED with `tui:adversarial-line-heap` as its only RED check, value ≤ 32 MB, and `orphans`, `tui:log-pane-heap`, `tui:resize-storm-heap`, `tui:long-line-heap` GREEN.
   - Ineligible: `zcode-proxy-src/src/tui/**`, `tests/memory/scenarios/s6-tui.mjs`, `tests/memory/scenarios/s6-tui-run.ts`, plus Round 17's common clause (`tests/memory/lib/{verdict,budgets,sampler*}.mjs`, the Bun pin).
   - Recording, the exception's end, and the departure from PROMPT §7 Phase 4's revert rule are as in Round 17, for this signature too.
   - Run 42446461464 is its first occurrence: it does not count against ticket 19 (correction 5) and causes no revert. Its S1 counts stand under Round 18 Q2 condition 5.
   - Tickets 48 and 49 touch `src/tui/**` and get no exception.
7. **Records:**
   - Spec §18 S6 row gains "`tui:adversarial-line-heap` judged on the median of 5 fresh repetitions of the S6 body, every repetition ≤ 32 MB, the other S6 checks in each repetition (Round 21 Q1)".
   - METRICS gets the 33-run table: 32 × 8 MB, 1 × 20 MB (42446461464, `D-records`/`end` 22 MB against 2 MB in 9 of 9), plus `tui:long-line-heap` 7–8 MB.
   - Ticket 32's and 49's Comments gain one line each (ticket-text changes below).
   - RUNLOG records corrections 1–6.

**Rationale:** The numbers do not describe the noisy tail Round 17 Q1 handled. They describe a deterministic check, exactly 8 MB in 32 of 33 processes, plus one process in which a 20 MB object stayed reachable through two forced full collections at a mark that otherwise reads 2 MB. A minimum over more readings in the same process is a guess at a mechanism the evidence already contradicts. Taking it only after the phase would also blind the check to the parts where the pane holds most. A fresh-process median is the measured answer to a per-process event. The existing `REPEATED` mechanism provides it with one entry, and it costs about 12 s. Because the pane's behaviour is deterministic, the median gives up no power against a pane defect. The 32 MB ceiling makes the check stricter than today against any single-run blow-up. The attribution mark turns the unproven cause into something the next occurrence can settle. Owning the RED instead would tolerate any value of the check that proves the pane's byte cap, and naming 49 would invent a trace.

**Charter:** C1 (the pane's byte cap is proven on the quantity it bounds, with a new hard per-run ceiling), C6 (test code only; no product change, endpoint or GC hook), C7 (linux only; windows unaffected), C9 (stronger measured evidence: 33 runs and per-mark readings over Round 17 Q1's analogy; smaller blast radius and simpler: one `REPEATED` entry in an existing mechanism), §9 (16 MB unchanged; the ceiling only tightens), Round 6 Q1 (repetition rule, n ≤ 9), Round 15 Q1 condition 2, Round 17 Q3 condition 2 (method for n), Round 17 cross-question conditions 1–2, Round 18 Q2 condition 5, PROMPT §7 Phase 4.

**Departures, named explicitly:**
- **Round 17 cross-question condition 1:** 71's content grows from three tails to four. Its single-pre-merge-run reasoning is applied, not changed.
- **Round 17 cross-question condition 2:** gains signature (v), with the same departure from PROMPT §7 Phase 4's revert rule and from Round 6 Q2 condition 4's last bullet, for (v) only.
- **Ticket 32's Loop S6 criterion** ("log pane ≤ 16 MB heap"): from now on it is judged under this rule. 32 stays resolved, and nothing is reopened.
- **The `REPEATED` comment** "One n for both legs": the S6 entry has its own n, as 71's S1/short entry already does. S6 is linux-only.
- **No contradiction with Round 17 Q1.** Its minimum rule stays for S7, where the readings are taken without a GC. This answer only declines to transfer it.

**REVERSIBILITY:** Two-way door (one `REPEATED` entry, test code, spec and ticket text). ADR: no.

### Ticket-text changes (exact)

**`issues/71-measurement-rules-rare-tails.md`**
- Title line → `# 71: Measurement rules for four rare tails: S7 retained heap, windows S1/short repetitions, the OMP no-op floor, linux S6/short repetitions`
- What to build, first paragraph: replace "Owner Proxy round 17 (DECISIONS.md, binding; Q1 conditions 1–4, Q3 conditions 1–4, Q4 condition 1). Three rare tails seen in ticket 67's eight evidence runs" with "Owner Proxy rounds 17 and 21 (DECISIONS.md, binding; Round 17 Q1 conditions 1–4, Q3 conditions 1–4, Q4 condition 1; Round 21 Q1 conditions 1–5). Three rare tails seen in ticket 67's eight evidence runs, and one in ticket 19's ten,". Replace "confirms all three" with "confirms all four". In "Every budget, …" insert "the 16 MB S6 budget," after "Every budget,".
- New What-to-build item after item 3:
  `4. **Linux S6/short repetitions (Round 21 Q1 conditions 1–3).** One `REPEATED` entry, `"S6/short": { n: 5, check: "tui:adversarial-line-heap", budgetMB: MEMORY.S6.longLineHeapMB, ceilingMB: 32 }`; each repetition a fresh S6 body process, one after another; the check's per-repetition value unchanged (worst of D-mixed, D-huge, D-cjk, D-records, end minus C-start, each after Bun.gc(true)); RED when the median > 16 MB or any repetition > 32 MB; the other S6 checks judged in each repetition; summary.json and the job summary print all five values and the median. Information, not gated: every S6 mark gains paneBytes, and after end the body pushes 2,000 short lines and takes a flushed mark. Why n = 5: smallest odd n with predicted false-RED ≤ 1 % on the less favourable estimate (1/10 on the staging/19 tree: n = 3 → 2.80 %, n = 5 → 0.86 %; 1/33 over all CI runs: 0.027 %); cost about 12 s per linux job. The minimum-of-readings shape of item 1 is not used here: S6 readings are already post-GC (Round 21 correction 2).`
- Interim paragraph: replace "or (iii) the floor test failing with a no-op cost < 5 MB," with "(iii) the floor test failing with a no-op cost < 5 MB; or (v) linux S6/short RED with `tui:adversarial-line-heap` as its only RED check, value ≤ 32 MB, the other S6 checks GREEN (Round 21 Q1 condition 6),". Replace "the generated OMP extension;" with "the generated OMP extension; (v): `zcode-proxy-src/src/tui/**`, `tests/memory/scenarios/s6-tui.mjs`, `tests/memory/scenarios/s6-tui-run.ts`;". Change "(Round 17 cross-question condition 2)" to "(Round 17 cross-question condition 2, Round 21 Q1 condition 6)".
- New acceptance criteria, before "Pre-merge run":
  - `- [ ] S6 rule (Round 21 Q1 condition 1): the REPEATED entry above; median of 5 fresh repetitions ≤ 16 MB, every repetition ≤ 32 MB, other S6 checks in each repetition; values and median printed; windows unaffected.`
  - `- [ ] S6 tests, RED first (Round 21 Q1 condition 4): [8, 8, 20, 8, 8] GREEN; [20, 20, 20, 8, 8] RED; [8, 8, 33, 8, 8] RED with a GREEN median; a repetition with tui:long-line-heap RED fails; a missing repetition or non-numeric value is a harness failure; S1/burst1 and windows S1/short cases unchanged.`
  - `- [ ] S6 mutant (Round 21 Q1 condition 4), local, never committed: fitLine storing the raw row without the copy is RED under the new rule; value recorded.`
  - `- [ ] S6 attribution and records (Round 21 Q1 conditions 3, 5, 7): paneBytes on every mark and a flushed mark (information); spec §18 S6 row gains the rule; METRICS gets the 33-run table. Comes back, not blocking: a repetition > 16 MB whose flushed reading returns within 2 MB of C-start; a median > 16 MB on a tree that does not touch the pane (ownership question, new ticket); a per-repetition rate > 10 % over ≥ 50 repetitions.`
- Pre-merge run criterion: "confirms the three rules" → "confirms the four rules"; "Any of the three signatures" → "Any of the four signatures (i)–(iii), (v)".
- Comments gains: `- 2026-11-08 (orchestrator, Round 21 Q1): signature (v), first occurrence: run 42446461464 (staging/19, tree 6f25f13), tui:adversarial-line-heap 20 MB (budget 16); D-records and end 22 MB heap against 2 MB in the other 9 staging/19 runs; not counted against ticket 19.`

**`issues/INDEX.md`** row 71: the title follows the new title. (Drift, correction 6: rows 32 and 67 → `resolved`.)

**`issues/32-tui-log-pane-caps.md`** Comments gains: `- 2026-11-08 (Owner Proxy round 21 Q1): tui:adversarial-line-heap read 20 MB once in 33 CI runs (42446461464; 8 MB in the other 32). From ticket 71's merge on, the check is judged on the median of 5 fresh S6 repetitions, every repetition ≤ 32 MB; budget 16 MB unchanged. The ticket stays resolved.`

**`issues/49-proxy-tui-log-pane-filter-scroll-follow.md`** Comments gains: `- 2026-11-08 (Owner Proxy round 21 Q1): 49 touches zcode-proxy-src/src/tui/**, so it gets no interim exception for signature (v); its memory-budget evidence judges linux S6/short under ticket 71's 5-repetition rule. 49 owns no S6 check.`

---

## Shared understanding

Open branches I still see (none blocks 71 or 19):
- **The 20 MB object is unattributed** (correction 4). Condition 3's `flushed` mark and `paneBytes` settle it on the next occurrence. A pane-held retention comes back (condition 5).
- **If t71 has already produced its pre-merge run before this amendment reaches it**, the S6 part goes in as t71's next round on the same branch, not as a new ticket. One pre-merge run must still confirm all four rules (Round 17 cross-question condition 1).
- **The staging/19 restage 42457112513 was still running** when I read the evidence. Signature (v) covers it if it repeats. Its S6 values join the METRICS count.
- **The job's aggregate false-RED rate.** Until 71 merges, this key fails a single run at about 3–10 %, and signature (v) excuses those failures. After 71 merges, it adds about 0.86 % on the 1/10 estimate (0.027 % on 1/33). Round 17's Shared-understanding item on the per-key sum stands.
