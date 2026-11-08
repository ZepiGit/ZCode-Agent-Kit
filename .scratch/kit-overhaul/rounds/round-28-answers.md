# Round 28 (2026-11-08) — windows S1/short RED only on commit in 1 of ticket 20's 10 evidence runs

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–27 decisions bind these answers (Rounds 1–26 in DECISIONS.md, Round 27 in `rounds/round-27-answers.md`). Where an answer departs from one of them, it names the decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md`, `rounds/round-28.md`.
- DECISIONS Round 6 Q1–Q2, Round 7 Q1 and Q3, Round 8 Q1, Round 9 Q1, Round 15 Q1 condition 5, Round 16 Q2 condition 1, Round 17 in full (Q3, cross-question condition 2 and its Shared understanding), Round 18 (ticket 20's S1 names), Round 25 Q1 (signature (vi)).
- `issues/20-*.md` on the integration tree and on `ticket/20-fewer-body-copies` (c737856, implementer report and expected-RED table), `issues/71-*.md`, METRICS.md lines 463–471 (the 49/51-run windows table), RUNLOG to 18:33Z.
- `git log origin/staging/20`: the 10 evidence commits 1b4a706 … 17f1d36 all carry tree f1cdaff. The measurement commit b98a54b (tree 7b0de62) is that tree plus the marker. `git diff 5922e59 origin/staging/20` touches `zcode-proxy-src/src/proxy/{handler,client-session,session-context,responses-handler,body-transformer}.ts` and `src/async/handler.ts`, so 20 is on S1/short's executed code. `git diff 5922e59 f21d3ac` touches only `tests/proxy-lifecycle.test.mjs` and `.scratch/` docs.
- Every log in `ci-art/t20-ev/` (10 windows, 10 ubuntu) and `ci-art/s1short-win/` (30 runs), with the 29-character prefix stripped. I re-extracted every S1/short value and recomputed every statistic. `ci-art/t20-measure/win/measure-S1-burst1.md`.

**Recomputed facts and corrections to the round.**
1. **Every number in the round checks out.** 20's tree: n = 50, mean 4.064, sd 1.03, min 1.79, max 6.22, 10 of 50 above 5 (all with trend true). RED repetitions per run: 1, 1, 1, 1, 0, 0, 1, 0, **3**, 2. The six non-20 trees since 71: n = 30, mean 3.911, sd 0.93, max 5.34, 4 of 30. RED repetitions per run: 2, 1, 1, 0, 0, 0. Welch t = 0.68 (df 66). Fisher's exact test on the counts above 5 (10/50 against 4/30) gives p = 0.55. Pooled: 14 of 80, p = 0.175 (95 % Clopper–Pearson 0.099–0.276), so P(≥ 3 of 5) = 4.05 % per run (0.83–13.3 %). That is 9.6× the 0.42 % design figure. Run 42503284096: [5.27, 4.5, 5.12, 6.04, 4.92], all trends true. WS per repetition: −1.02, 1.01, 0.08, −0.02, 0.77. Linux S1/short is GREEN in all 10 (2.14–4.28). The ubuntu ratchet holds in all 10.
2. **One RED run in ten is the expected outcome, not a surprise.** At 4.05 % per run, P(≥ 1 RED run in 10) = 34 %. At 20's own p = 0.20 (5.79 % per run), it is 45 %.
3. **Correction: the "drift" does not show up in single runs. It shows up in repetitions 2–5.** This bears on part (2)'s attribution question.
   - The 23 valid single-run windows S1/short values in `s1short-win/` (04:28–13:25Z today, before the 5-repetition rule ran in CI) have mean 3.47, sd 0.87 and max 5.18. That matches the 49-run 3.41. Some of those runs are on trees with 19, 25 and 36 (for example 42483637377 and 42484868282). 42467078897 has no S1/short line (HTTP 504).
   - Mean by repetition position over all 16 post-71 runs: 3.53, 4.16, 3.64, 4.53, 4.17.
   - Repetition 1 against repetitions 2–5: 3.53 (sd 1.10, n = 16) against 4.12 (sd 0.93, n = 64), Welch t ≈ 2.0.
   - On 20's tree alone, repetition 1 averages 3.44.
   - **This is suggestive, not proven.** The pattern does not rise steadily, and the count above 5 is flat across positions (3, 3, 2, 3, 3). Still, "which merged ticket moved the mean" is not the only hypothesis the data allow. The other: the five back-to-back repetitions on one runner are not independent draws from the single-run distribution. Round 17 Q3's n = 5 computation assumed they were.
4. **No n ≤ 9 restores the ≤ 1 % design bar at the measured rate.** At p = 0.175, n = 5/k = 3 gives 4.05 %, n = 7/k = 4 gives 2.09 %, and n = 9/k = 5 gives 1.11 %. The repetition count therefore cannot be fixed cheaply. Raising it would also rest on the independence assumption that correction 3 questions.
5. **The rest of ticket 20's evidence matches the round.**
   - Windows S1/burst4, S1/burst16 and S1/bigbody are GREEN in 10 of 10 runs, and so is linux S1/burst32.
   - In 9 of 10 runs, the windows ratchet's only failures are "GREEN but listed" for burst4 and bigbody. That is the removal evidence itself. Run 42503284096 adds S1/short.
   - Burst1 measurement 42502424683: 24 of 24 runs valid (`ws_peak_kb` > 0, units self-test ok, Job Object applied, 1 proxy). WS gate 110.5 / 116.8 / 131.7 MB, none above 250. The in-job burst1 medians are around 113 MB.
   - **Not on this host:** the linux leg of 42502424683 (the marker runs the measurement on both legs). 20's linux burst1 criterion currently rests on its 20 local runs (max 128.6, none above 250).
6. **One baseline run has an unrelated defect.** 42500996594 (staging/21) is in the non-20 baseline and had an orphan in repetition 2: ticket 77, the kill guard. Its growth values are valid, and the conclusions do not change without it.

---

## Q1 — does windows S1/short in run 42503284096 count against ticket 20, and what happens to the tail?

**DECISION:** ACCEPTED with conditions. Part (1) is accepted with merge conditions. Part (2) is accepted except for the attribution framing, which is REJECTED in part. Part (3) is accepted except for its eligibility wording, which is REJECTED in part.

**(1) The run does not count against ticket 20.** Ticket 20 removes its own entries in one list-only commit on its branch, then merges after one GREEN pre-merge run of the final tree. The entries:
- windows `S1/burst1` (`unstable`);
- windows `S1/burst4`, `S1/burst16`, `S1/bigbody`;
- linux `S1/burst32`.

**(2) No change to the budget, n, k or the ceiling.** A new `needs-triage` ticket (the next free number, 78 at the time of writing) records the windows S1/short values and comes back with them. Its question is wider than the round's (REJECTED in part, see below).

**(3) Interim signature (vii)**, with exact eligibility paths instead of "the proxy's request path" (REJECTED in part, see below). No signature applies to 20's own pre-merge run.

This departs from and confirms the following, explicitly:
- **Round 17 Q3 condition 2** set n = 5 for a predicted false-RED rate ≤ 1 %. The measured rate is now about 4 % (correction 1). I keep n = 5 knowingly above that bar until the triage ticket answers. No n ≤ 9 meets the bar (correction 4), and the independence premise behind any n is in doubt (correction 3).
- **Signature (vii)** departs from PROMPT §7 Phase 4's revert rule, Round 6 Q2 condition 4's last bullet and Round 13 Q1 condition 6, for (vii) only. That is the same departure Round 17 cross-question condition 2 made for (i)–(v) and Round 25 Q1 made for (vi). It also reopens an interim for this key. The interim for signature (ii) ended when 71 merged (RUNLOG 15:07Z). (vii) is new and narrower: a median bound, a WS clause, and wider ineligibility.
- **Confirmed, not contradicted:**
  - Round 17 Q3 condition 4 and 20's Comments line ("If this ticket moves the windows commit mean toward 5 %/1k … the numbers come back"). This round is that return, and the numbers show 20 did not move it.
  - Round 8 Q1 condition 4 and Round 9 Q1 condition 7 ("the pre-merge run confirms, it does not decide"): nothing was rerun. The RED came back and is decided here on its distribution.

Binding conditions:

1. **Why the run is not charged to 20, and what that does not license.**
   - On S1/short, 20's tree cannot be told apart from the non-20 trees since 71: per repetition t = 0.68, Fisher p = 0.55, repetition 1 3.44 against 3.69.
   - A 1-in-10 RED run is what the pooled rate predicts 34–45 % of the time (correction 2).
   - WS growth is about 0 in every repetition, and linux S1/short is GREEN 10 of 10.
   - This comparison can rule out a shift of roughly 0.6 %/1k or more. It cannot rule out a smaller one. A smaller shift is the triage ticket's to measure (condition 4), not a ground to block 20.
   - The decision covers run 42503284096 only. It is no standing exception for ticket 20.

2. **The list-only commit (Round 15 Q1 condition 5, Round 9 Q1 condition 4).** It is one 20-owned commit that edits only `tests/memory/expected-red.json` and cites the run ids for each removal:
   - **windows `S1/burst1` (`unstable`):** measurement 42502424683, 24 of 24 valid, max 131.7 MB. This is the entry's only exit (Round 9 Q1 condition 4). 20's "Delete `S1/burst1` (windows)" criterion is met by this commit. Removing the `unstable` allow-list from the schema stays ticket 55's job (Round 9 Q1 condition 5).
   - **windows `S1/burst4`, `S1/bigbody`** (names RED in every earlier matching run): 42502565823 … 42503373851, GREEN on the WS gate in 10 of 10.
   - **windows `S1/burst16` and linux `S1/burst32`** (`flips`): the same 10 runs, GREEN in 10 of 10. That meets the ≥ 10-run floor.
   - Each removal deletes its entry, because each is the entry's last name.
   - Before the commit, the orchestrator replays the 10 runs' RED sets through the edited list. Every windows and ubuntu leg must pass, except the S1/short line of 42503284096, which this round decides. Any other failure in the replay comes back with the run id.

3. **The final tree and its pre-merge run.**
   - `staging/20` is rebuilt on the current integration tip (f21d3ac or later), so that the test-kit legs carry cbe2abb's teardown fix.
   - Since 5922e59, the tip changed only `tests/proxy-lifecycle.test.mjs` and `.scratch/` docs. Neither is in METRICS' matching rule, and neither is the list commit (Round 16 Q2 condition 1). So the 10-run floors stand.
   - If the tip has meanwhile merged anything on S1's executed code, the floors restart on the new tree and it comes back: `zcode-proxy-src/**`, `tests/memory/scenarios/s1-proxy-steady.mjs`, `tests/memory/lib/**`, `tests/memory/job.mjs`, the Bun pin or the job's Node version.
   - The one pre-merge CI run must be GREEN on every leg: both `memory-budget` legs with the new list, and all four `test-kit` legs.
   - It confirms and does not decide. If windows S1/short is RED in it, that is a second RED run on 20's tree. It comes back with the five values, and nothing is rerun. No signature applies, because 20 touches `zcode-proxy-src/**`.
   - Ticket 20's evidence cites the linux leg of 42502424683 for its linux burst1 criterion. If that leg is missing, the 20 local runs stand as written, and METRICS labels them local. If any linux repetition there is above 250 MB, it comes back (Round 6 Q1 condition 4).
   - The orchestrator writes the further ADR-0004 amendment from 20's measured factors before the merge (Round 18 Q3 condition 5; this is not decided here).

4. **The triage ticket (REJECTED in part: its question).** Title: "windows S1/short commit growth: repetition-position and tree effects".
   - Metadata: `Status: needs-triage`. It owns no name and lists nothing; Round 17 Q3 rejected a listing of this key, and that rejection stands.
   - **What it records:** in its Comments or a METRICS table, for every windows S1/short run from now on: run id, tree, position 1–5, commit value, trend, WS value. It also back-fills the 16 runs here and the 23 single runs of correction 3.
   - **What it asks:**
     - (a) Do repetitions 2–5 differ from repetition 1 and from the single-run history (correction 3)? That would mean the five repetitions are not independent draws.
     - (b) Does any merged tree shift the mean? Compare position by position.
     - (c) Which rule then holds a false-RED rate ≤ 1 % without loosening the 5 %/1k budget, the trend clause or the 10 %/1k ceiling? Examples: isolate each repetition better, or judge another statistic.
   - It may use an off-by-default measurement mode on a staging branch, as the burst1 mode does, with no new endpoint (C6).
   - **When it comes back:**
     - when 20 more windows runs exist (100 more repetitions);
     - earlier if two (vii) occurrences fall within any 10 consecutive windows runs;
     - earlier if any windows S1/short RED falls outside (vii).
   - Until it is answered: no change to n, k, the budget, `growth()` or Round 7 Q1's commit gate.

5. **Signature (vii), interim (REJECTED in part: eligibility).** A staged or post-merge run qualifies when all of these hold:
   - Its only unexcused failure is windows `S1/short` RED on `growth:proxy` (≥ 3 of 5 repetitions RED).
   - Every repetition is ≤ 10 %/1k on commit.
   - The median is ≤ 5.5 %/1k.
   - WS growth is ≤ 5 %/1k in every repetition.
   - Every other S1/short check is GREEN in every repetition.

   Such a run does not count against the ticket, does not block its merge and causes no revert. Each occurrence goes into the triage ticket's Comments with the run id and the five values.

   **Ineligible**, by exact path rather than "the proxy's request path", because "request path" cannot be checked from a diff:
   - a diff that touches `zcode-proxy-src/**`;
   - `tests/memory/scenarios/s1-proxy-steady.mjs`, `tests/memory/lib/**` or `tests/memory/job.mjs`;
   - the Bun pin or the memory job's Node version.

   That is Round 17 signature (ii)'s list, widened by `lib/repetitions.mjs` (71) and `lib/process-identity.mjs` (72), and Round 25's Node clause.

   **Why the 5.5 bound costs little.** A normal fit to the pooled values (mean 4.0, sd 1.0):
   - about 9 % of noise REDs have a median above 5.5, so those few come back;
   - a +1 %/1k shift would push the median above 5.5 in about 17.5 % of runs.

   **When it ends:** when the Owner Proxy answers the triage ticket. A ticket that is ineligible and RED on S1/short comes back with its per-repetition distribution, as 20's did here.

6. **Records.**
   - RUNLOG names this round, the deviations above and the end of (ii) at 15:07Z.
   - METRICS gains the 16-run, 80-repetition table: per tree, per position, and the 23 single runs.
   - Ticket 20's Comments: "Round 28 Q1: windows S1/short RED in 42503284096 is not charged to 20 (distribution indistinguishable from the non-20 trees). Entries removed in the list-only commit. No signature for 20's pre-merge run."
   - Ticket 71's Comments: one line saying its S1/short n = 5 premise (≤ 1 %) is now measured at about 4 %, and that the triage ticket owns the question.

**Rationale:** Not charging the RED to 20 rests on measured evidence. 20 is the one ticket in the queue that could plausibly change proxy commit growth, and it did not move the per-repetition distribution measurably. One RED run in ten is the likeliest outcome at the pooled rate. Blocking 20 on it would be the random merge block that Rounds 9, 13 and 15 refused. It would also hold back the largest memory win of the run: burst1 WS median about 300 → 117 MB, and four budgets met on both legs.

The entry removals meet each entry's own exit exactly as earlier rounds wrote them. So there is nothing to decide beyond citing runs and replaying the list.

Leaving n alone is not complacency. No n ≤ 9 reaches 1 % at p = 0.175. Repetitions 2–5 run higher than repetition 1 and the single-run history (t ≈ 2), so the independence that any n assumes is itself in question. Re-tuning n now would repeat Round 17's assumption on weaker ground. A triage ticket that records positions and trees is the measured way to settle it.

The original framing ("which merged ticket moved the mean") could miss the measurement's own contribution, so I widen the question. A drift that WS, linux and single runs do not show is not yet evidence of a C1 regression. The commit gate, the trend clause and the 10 %/1k ceiling all stay in force.

(vii) gives non-proxy tickets the protection they need against a roughly 4 % tail they cannot cause. Its exact-path ineligibility keeps every ticket that could cause a real regression outside it. Its median and WS clauses make it narrower than (ii).

**Charter:** C1 (proxy growth stays gated at 5 %/1k with trend and the 10 %/1k ceiling; nothing is masked for code that can move it), C7 (windows evidence decides; linux unchanged), C9 (stronger measured evidence: 80 repetitions plus 23 single runs, recomputed; smaller blast radius: one list-only commit, one recording ticket, one narrow interim; "do nothing" to n until it is measured), C6 (no new endpoint for the measurement mode), §9 (no budget, n, k or ceiling loosened; (vii) is tighter than (ii)), Round 6 Q1 conditions 4 and 6, Round 6 Q2 conditions 1 and 4, Round 7 Q1, Round 8 Q1 condition 4, Round 9 Q1 conditions 4, 5 and 7, Round 13 Q1 condition 6, Round 15 Q1 condition 5, Round 16 Q2 condition 1, Round 17 Q3 conditions 2 and 4 and cross-question condition 2, Round 18 Q3 condition 5, Round 25 Q1, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (list entries, ticket text, a merge-gate interim and a recording ticket; the merge itself is revertible under Phase 4). ADR: no.

---

## Shared understanding

Open branches I still see (none blocks ticket 20 once condition 3's run is GREEN):
- **Cause of the higher repetition values** (correction 3): the repetition sequence on one runner, or a tree shift too small for 50 against 30 repetitions to resolve. The triage ticket (condition 4) settles it. Until then the windows job carries about 4 % false-RED per run on this key (95 % range 0.8–13 %). It is the largest known term in the job's aggregate rate.
- **Proxy-touching tickets have no signature for this tail.** Examples are 21, 76 and 77, and any later `zcode-proxy-src/**` ticket. Each one that meets an S1/short RED comes back with its distribution, as 20 did. If that happens often before the triage ticket answers, the answer is due early.
- **EVIDENCE MISSING: the linux leg of measurement run 42502424683** is not on this host. Condition 3 says how 20's linux burst1 criterion stands either way.
- **Ticket 77's kill-guard orphan** (about 1 in 3,500 proxies, seen in S1/short repetition 2 of 42500996594) is a separate RED class, not covered by (vii). With 5 repetitions per run it now gets five chances per windows run.
