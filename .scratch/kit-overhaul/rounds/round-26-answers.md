# Round 26 (2026-11-08) — ticket 30 cannot merge on the S5/short tail that ticket 74 (blocked by 30) is meant to replace

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–25 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md`, `rounds/round-26.md`.
- DECISIONS Rounds 13, 17, 24 and 25 in full. I also read Round 8 for the 02 + 60 precedent the round cites: there, the ≥ 20 windows repetitions decided the rule, and then one pre-merge run confirmed it and decided nothing.
- The integration tree at c457fd8: `issues/30-*.md`, `74-*.md`, `56-*.md`, `57-*.md`, `INDEX.md`, METRICS.md lines 258–327, RUNLOG lines 177–180, STATE.md.
- Ticket 30's branch, head 2c6720c (`git -C /home/AgentKit/wt/t30 show HEAD:…`): its issue file in full and `git diff --stat` against the merge base. That is 14 files: `mcp/**`, `dist/**`, the retention test and fixtures, `expected-red.json`, `job.mjs`, `ratchet.mjs` (a comment), `loop.test.mjs`, `verdict.test.mjs` and the ticket.
- CI runs 42475847194 and 42483637377, from the job logs under `/home/AgentKit/overhaul-tools/ci-art/r25-logs/{win,lin}/` and `gh run view --json jobs`.
- Every windows and linux S5/short `growth:mcp-bridge` line in `ci-art/r25-logs` (57 windows and 58 linux values after Round 13), plus METRICS' 28 Round 13 windows values. I recomputed every statistic below from these.
- `gh run list`, for the runs started after Round 25.
- Ancestry checks: a53152d (the head of 42483637377) contains 2c6720c. 8126454 and 57c3db0 contain 7555b87 (ticket 36) and do not contain 0a059ad (ticket 30).

**Recomputed facts and corrections to the round.**
1. **Confirmed: Round 25's windows table.**
   - n = 85: min 11.99, median 18.14, mean 19.09, sd 4.08, max 34.62; 2 values above 30.
   - P(> 30) per run: normal 0.37 %, log-normal 0.94 %.
   - On the 13 tree scaled by ×1.09 (41 runs; mean 20.77, sd 4.69): 2.47 % / 3.72 %. Without 42480631098 it is 1.38 % / 2.61 %.
2. **34.62 does not "sit inside" the distribution. It is its maximum, and it is extreme.**
   - Against the other 84 values (mean 18.91, sd 3.73), z = 4.2. P(≥ 34.62) per run is 0.001 % on a normal fit and 0.054 % on a log-normal fit.
   - It is one of only 2 windows runs in 85 with trend true. The other is 42404639968.
   - 14.5 sits at the 7th percentile (6 of 85 values are ≤ 14.5).
   - On linux, 30's two runs are 31.82 (the minimum of 58 runs) and 44.23 (above the median of 42.25).
   - "30's code is not expected to move windows S5/short" is a mechanism argument: no eviction happens below 500 tasks. It is not a measurement. Round 25 Q1 condition 7's **EVIDENCE MISSING (is 34.62 30's code, 36's base, or the tail?)** still stands, and two runs per arm cannot settle it.
3. **"30's own windows S5/short value under the old rule is then not judged" is wrong.**
   - 74's `warm-up-growth:mcp-bridge` is *today's quantity, computed exactly as now* (Round 24 Q1 condition 3; Round 25 correction 6). On windows it is RED above 30 %/1k on commit regardless of trend.
   - So every run of the joint tree judges 30's code on the same quantity, at the same 30 bound, with no band and no signature (vi).
   - The joint staging therefore judges 30 more strictly than a restage, not less.
4. **"The 20 windows runs round 25 requires come from that staging branch" would rewrite a pre-registered set.**
   - Round 25 Q1 condition 4's set is "the first 20 windows S5/short values on trees that contain ticket 36, any branch". It already holds five values: 15.43, 18.14, **34.62** (30's tree), 19.82, 24.83.
   - Two more 36-tree runs are in progress: 42493218404 (integration 8126454) and 42494299680 (staging/29 57c3db0). **EVIDENCE MISSING: their S5/short values.**
   - Filling the set from the joint branch alone would drop 34.62 and the in-progress runs after they were seen.
5. **Run 42483637377 failed one job only: windows `memory-budget`.**
   - S5/short 34.62 (ineligible for any signature).
   - S1/short 5.18 commit (Round 17 signature (ii); that interim ended when 71 merged, RUNLOG 15:07Z).
   - All four test-kit legs and the linux memory leg were green. Linux S5/short was 44.23 with trend true, listed under 74.
6. **Round 25's ticket-text changes have not been applied to the integration tree at c457fd8.** These are 74's ceiling criterion and Comments line, 30's and 21's Comments lines, and the 85-run METRICS table: `grep` finds no "round 25" in these files. The text changes below assume they are applied first.
7. **How much one more restage of 30 can show.** On the 36 base (mean 20.77, sd 4.69), suppose 30's code raised the mean by 3 %/1k. A single run would still be ≤ 30 with P = 0.91. Ten runs would all be ≤ 30 with P = 0.38 (+5: 0.82 and 0.13). For an innocent tree, the chance that at least one of 10 runs is above 30 is 3.6–31.6 % (p = 0.37–3.72 %). With 20 joint runs it is 7.1–53.1 %.

---

## Q1 — how do 30 and 74 get out of the cycle?

**DECISION:** REJECTED in part.

Accepted:
- **Joint staging.** 74 is built on ticket/30. One staging branch takes the integration tip, then ticket/30, then ticket/74. One pre-registered set of evidence runs on one identical tree replaces 30's single restage and is 74's exit. 30 and 74 merge back to back.
- Run 42483637377 is not excused. It stays on record as value 3 of Round 25's set and in 30's subset (condition 5).

Rejected or corrected:
- (i) **"30's value under the old rule is not judged"** (correction 3). 30 is judged on the old quantity, at the old 30 bound, in every one of the joint runs. Its verdict is defined separately from 74's (condition 4).
- (ii) **"The 20 runs come from that staging branch"** (correction 4). Round 25's set stays as pre-registered, any branch, in run-creation order. Joint-tree runs enter in their place, and nothing is dropped (condition 5).
- (iii) **20 joint runs.** That doubles the by-chance fallback (correction 7). The joint tree gets **exactly 10 runs per leg**, fixed before the first one. That is the minimum Round 24 Q1 condition 7 requires.
- (iv) **"Merge back to back only if the set passes 74's criteria."** This would hold a finished C1 fix hostage to 74's own open risks: the windows post-bound value (EVIDENCE MISSING since Round 24) and the mutant's thin trend margin. 30 gets its own verdict from the same runs, and it may merge alone if only 74 fails (condition 6).
- (v) **Judging the exit on runs that also re-set its ceiling.** This is circular. The exit is judged against the ceiling in force (30), and a changed ceiling needs fresh exit runs (condition 3).

**This explicitly departs from:**
- **Round 24 Q1 condition 1** ("one restaged run must show the same outcomes"). It is replaced by 10 runs per leg with the hard 30 bound, which is a **tightening**. The one restage disagreed, and a single further run has almost no power to attribute 34.62 (correction 7).
- **Round 24 Q1's rationale** ("rather than holding 30 until ~20 more S5 evidence runs exist"). 30 now waits for 10 runs and for Round 25's set to complete. Condition 6 keeps 30 off 74's own failure modes.
- **Round 24 Q1 condition 7.** "≥ 10" is narrowed to exactly 10 (pre-registered). Full CI runs of the identical tree are accepted beside the S5-only mode. They are the same job and the same checks, with more checks around them, so this is not a loosening.
- **Round 25 Q1 condition 4** is only clarified, not changed: "first" means run-creation order, and on a tree with 74's rule the recorded value is `warm-up-growth:mcp-bridge` on commit.

It is the return Round 25 Q1 condition 7 asked for. It follows Round 8 (02 + 60 staged together, distribution first, the pre-merge run confirms) and Round 13 Q1 condition 6 (a restage on a changed tree after a cause decided here is not a rerun-until-green). Round 25 Q1 conditions 2 and 5 stand unchanged: no signature (vi) for 30 or 74, and 74 does not merge before the 20-value table and the ceiling round.

**I loosen no bound.** The 5 %/1k budget, `growth()`, `MEMORY.growth`, the 1,200 tasks and the 600–1,200 window are unchanged. So are the warm-up ceilings (55 linux, 30 windows commit), the windows band (5 < v ≤ 30), signature (vi) with its hard 35, the S5 budgets (150 MB, 20 MB, 0) and Round 25's triggers.

Binding conditions:

1. **Staging.**
   - 74 is implemented on ticket/30 (2c6720c or its successor).
   - The staging branch is the current integration tip (it contains 36 and 71), then ticket/30, then ticket/74.
   - 74's local mutant proof (Round 24 Q1 condition 5) comes before any staging, unchanged.
   - Edge 74 ← 30 is unchanged, and no edge changes. I checked the graph from INDEX.md (74 rows): it is acyclic. 74's ancestors are 30, 13, 12, 11, 10, 09, 04, 03, 02 and 01. Its descendants are 55, 56, 57, 53 and 54. 30's descendants are those plus 31, 52 and 74.
2. **Evidence runs (pre-registered).**
   - Before the first run, RUNLOG records the joint tree's hash and the count: **10 runs per leg**. They run through 74's off-by-default S5-only mode or as full CI runs (empty commits) of that identical tree.
   - Every run on that tree counts. None is added, dropped or replaced once it has an S5/short value.
   - A run with no S5/short value (an infrastructure failure before S5) is replaced, and the replacement is recorded.
   - Each run records:
     - the post-bound `growth:mcp-bridge` (commit and WS on windows, RSS on linux), its trend, window medians and sample counts;
     - `warm-up-growth:mcp-bridge` (commit and WS on windows), its slope in MB/1k, mean MB and window medians;
     - procPeak, reboot cost, task failures, orphans and duration.
   - Failures outside S5 are recorded and handled under the normal rules. They do not remove the run's S5 values.
3. **74's verdict** on these runs is Round 24 Q1 condition 7 plus Round 25 Q1 condition 5, unchanged:
   - every run has the post-bound value ≤ 5 %/1k whatever the trend flag says;
   - the warm-up value is ≤ 55 (linux) and ≤ 30 (windows commit);
   - every other S5 check is GREEN.

   The exit is judged against the windows ceiling in force when the runs ran (30). Then Round 25 condition 5's round takes place on the 20-value table:
   - If it re-confirms 30, the 10 runs stand as the exit.
   - If it lowers the ceiling, the same runs are re-judged against the lower value.
   - If it raises the ceiling, the exit needs 10 fresh runs per leg after that round. The ceiling is never fitted to the runs it judges.
4. **30's verdict**, read from the same runs (or, under condition 6c, from its own tree's runs, on the band value, which is the same quantity):
   - Windows: every one of the 10 values satisfies 5 < v ≤ 30 %/1k commit. A value ≤ 5 comes back as an ownership question (Round 13 Q1 condition 1; Round 17 Q2 condition 3).
   - Linux: every value is ≤ 55 %/1k.
   - In every run, every other S5 check is GREEN: procPeak ≤ 150 MB (WS on windows), reboot cost ≤ 20 MB, 0 task failures, 0 orphans.
   - Round 25's set is complete and fires no trigger.
   - Signature (vi) never applies.
   - Any value above 30, or any other S5 RED, sends both tickets back with all values, with no rerun. For 74 this is its fallback (Round 24 Q1 condition 8; Round 25 Q1 condition 5).
5. **Round 25's set.**
   - It is unchanged in definition, in run-creation order. Its first five values are 42454650683 15.43, 42469209389 18.14, 42483637377 34.62, 42483787372 19.82 and 42484868282 24.83. The next are 42493218404 and 42494299680 (running).
   - Joint-tree runs enter in their creation order, with their warm-up value.
   - If values are still missing after the 10 joint runs, they come from the next runs on any tree with 36. Empty-commit runs of the integration tip are allowed; more joint-tree runs are not.
   - METRICS marks each value "with 30" or "without 30" and prints n, mean, sd and max per subset. These subsets are the attribution Round 25 condition 7 asked for, laid before condition 5's round.
6. **Merge order and decoupling.**
   - a. **Both pass** (conditions 3 and 4, and the ceiling round re-confirms):
     - one pre-merge run of the final joint tree. If the tip moved, the branch is re-merged onto it, and this run confirms and does not decide. If the tree is unchanged, a full-CI 10th run serves.
     - It must be GREEN under the normal rules, with S5/short GREEN on both legs and no entry (Round 24 Q1 condition 7). A disagreement comes back.
     - Then **merge ticket/30, then ticket/74, back to back, in one push**. The post-merge run judges the tip that carries both.
   - b. **30 passes and 74 does not** (post-bound > 5 on either leg, the ceiling round changes the ceiling, or 74's own tests fail):
     - **30 merges alone** after one pre-merge run of its own tree (the tip plus ticket/30, entries labelled 74, band in force). That run confirms and does not decide: windows band, linux listed on growth only, every other S5 check GREEN.
     - 74 comes back under its fallback.
   - c. **74's mutant proof fails before staging:** 74 comes back. 30 takes the 10 runs on its own staging tree (full CI runs, empty commits), under condition 4, and then follows 6b.
   - d. **30 fails:** neither merges (74 ← 30), and everything comes back with all values.
   - Never: 74 before or without 30; 30 merged on fewer than 10 runs; a rerun after a failed value.
   - **Revert:** reverting 30 always reverts 74 first, because 74's window needs the bound. 74 may be reverted alone.
7. **Records.**
   - RUNLOG records this round's departures (above), correction 6 and the pre-registration of condition 2.
   - METRICS gains the joint-run table and condition 5's subset columns.
   - Round 25's pending ticket and METRICS changes are applied before this round's.

**Rationale:** The cycle is not a dependency cycle. 74 needs 30's bound, and 30 needs evidence that its restage cannot give: one more single run passes at P ≈ 0.91 even if 30 shifted the windows mean by 3 %/1k. And 34.62 is not ordinary: z = 4.2 against the other 84 runs, trend true, on the only 36-tree run that carries 30. So excusing it is not backed by evidence, and waiting for one more coin flip is not evidence either.

The joint staging is right because 74's warm-up check *is* the old quantity at the old bound. Ten joint runs therefore give 30 a stricter test (power 0.62 against a +3 shift) and give 74 its exit in one evidence set. Round 25's set, filled in creation order from any branch, puts 36-tree runs without 30 beside them.

The recommendation was wrong on three points:
- It claimed 30 goes unjudged, when 30 is judged ten times.
- It redrew a pre-registered set after seeing its values.
- It made a finished C1 fix depend on 74's two open risks.

The run count is fixed at the minimum, because every extra joint run adds by-chance fallback risk (3.6–31.6 % at 10 runs, 7.1–53.1 % at 20). The ceiling stays pre-registered against the runs it judges.

**Charter:** C1 (the retention fix lands only on evidence that it does not raise bridge growth; the 30 bound holds for the code that can move it), C7 (windows judged on 10 runs plus a comparison subset; linux gets the 55 ceiling), C9 (stronger measured evidence: 10 runs instead of 1, with recomputed tails; smaller blast radius: 30 is not tied to 74's own failure modes, and the revert order is fixed), §9 (no budget, ceiling or band loosened; one tightening), Round 8 conditions 2 and 4, Round 13 Q1 conditions 1 and 6, Round 17 Q2 condition 3, Round 24 Q1 conditions 1, 3, 5, 7 and 8, Round 25 Q1 conditions 2, 4, 5 and 7, PROMPT §7 Phase 4 (no rerun-until-green; no merge on an unattributed RED).

**REVERSIBILITY:** Two-way door: a staging order, a run count, ticket text and records. ADR: no.

### Exact text changes

**`issues/30-mcp-task-retention-and-idempotency-window.md`.** Replace the Acceptance bullet that begins `- [ ] Loop S5/short: no new RED on either leg` with:

```
- [ ] Loop S5/short (Round 26 Q1; replaces Round 24 Q1 condition 1's single restage): judged on the 10 pre-registered evidence runs per leg of the joint staging tree (integration tip, then 30, then 74) on `warm-up-growth:mcp-bridge` (today's quantity: load window cut at task 400, default 25 % warm-up): every windows value 5 < v ≤ 30 %/1k commit, every linux value ≤ 55 %/1k, every other S5 check GREEN in every run (procPeak ≤ 150 MB, WS on windows; reboot cost ≤ 20 MB; 0 task failures; 0 orphans); and Round 25 Q1 condition 4's 20-value set complete with no trigger. Signature (vi) never applies. If 74 is not staged (its mutant proof failed), the 10 runs are taken on this ticket's own staging tree on the band value (the same quantity). A value above 30 or any other S5 RED comes back with all values; nothing is rerun. Both S5/short entries stay re-owned to ticket 74, which holds their only exit (Round 24 Q1).
```

Add under `## Comments` (after Round 25's line):

```
- 2026-11-08 (orchestrator, Owner Proxy round 26, binding): 30 and 74 are staged together on one branch (integration tip, then ticket/30, then ticket/74, which is built on ticket/30). Restaged run 42483637377 (34.62 %/1k commit, trend true; z = 4.2 against the other 84 windows runs) is neither excused nor dropped: it stays value 3 of Round 25's 20-value set and in this ticket's "with 30" subset in METRICS. This ticket's S5/short verdict comes from the same 10 evidence runs per leg as 74's exit, read from warm-up-growth:mcp-bridge (Acceptance). Merge: 30 then 74 back to back in one push if both pass; 30 alone, after one confirming pre-merge run of its own tree, if only 30 passes; neither if 30 fails. Reverting 30 always reverts 74 first.
```

**`issues/74-s5-short-growth-after-retention-bound.md`.**
- Insert after the `- [ ] Mutant proof` bullet:

```
- [ ] Joint staging with 30 (Round 26 Q1): this ticket is built on ticket/30 and staged on one branch with it (integration tip, then 30, then 74). Before the first evidence run, RUNLOG records the joint tree's hash and the count, 10 per leg; every run on that tree counts, and none is added, dropped or replaced once it has an S5/short value (a run with no S5/short value, i.e. an infrastructure failure before S5, is replaced and recorded). Each run also records `warm-up-growth:mcp-bridge` (commit and WS on windows), its slope MB/1k, mean MB and window medians; these values are ticket 30's verdict and enter Round 25 Q1 condition 4's set in run-creation order. The exit is judged against the windows ceiling in force when the runs ran (30). If the Round 25 Q1 condition 5 round raises the ceiling, the exit is judged again on 10 fresh runs per leg after that round; if it lowers it, the same runs are re-judged against the lower value.
```

- In the `- [ ] Exit:` bullet, replace `≥ 10 fresh runs per leg on this tree via an off-by-default S5-only measurement mode (several CI runs or parallel jobs allowed)` with `the 10 joint-tree runs per leg (Round 26 Q1), via the off-by-default S5-only measurement mode or full CI runs of that identical tree (several CI runs or parallel jobs allowed)`. The rest of the bullet is unchanged.
- Add under `## Comments` (after Round 25's line):

```
- 2026-11-08 (orchestrator, Owner Proxy round 26, binding): staged jointly with 30 (Acceptance). Round 25 Q1 condition 5 stands: no merge before the 20-value windows table and the ceiling re-confirmation round. Round 25's set is unchanged and is not filled from this tree alone. Its first five values are 42454650683 15.43, 42469209389 18.14, 42483637377 34.62 (30's tree), 42483787372 19.82 and 42484868282 24.83. Joint-tree runs enter in creation order with their warm-up-growth value. If values are still missing after the 10 joint runs, they come from the next runs on any tree with 36: empty-commit runs of the integration tip are allowed, more joint-tree runs are not. METRICS marks each value "with 30" or "without 30" and prints n, mean, sd and max per subset. Merge order: 30 then 74, back to back in one push, after one pre-merge run of the final joint tree that is GREEN, with S5/short GREEN on both legs and no entry; never 74 without 30.
```

**`issues/INDEX.md`:** no change. No edge, status, model or risk changes. Row 74 keeps `30`, row 57 keeps `30, 36, 74`, row 56 keeps `13, 30, 31, 36, 57, 74`, and row 55 keeps `74`.

**Issues 55, 56 and 57:** no change.

---

## Shared understanding

Open branches I still see:
1. **The windows post-bound value is still EVIDENCE MISSING (Round 24).** The joint runs decide it. If it misses, condition 6b lets 30 merge alone.
2. **The attribution of 34.62 is still EVIDENCE MISSING.** It is decided by condition 4's pre-registered rule and laid out in condition 5's subsets before Round 25 condition 5's ceiling round.
3. **By-chance fallback.** An innocent tree fails 10 runs at the 30 bound in 3.6–31.6 % of attempts (Round 25's tail). If that happens, the question comes back with at least 10 joint values and the subset table. Any ceiling change belongs to the condition 5 round, never to the implementer.
4. **The values of the in-progress runs 42493218404 and 42494299680** (both on 36-trees without 30) are EVIDENCE MISSING. They are values 6 and 7 of Round 25's set.
5. **Round 25's ticket-text and METRICS changes are not yet applied** at c457fd8 (correction 6).
6. **The mutant's trend margin** (Round 24 Shared understanding 2) stays open until 74's local proof.
7. **Not decided here:** INDEX.md's "Initial frontier" lists 57 as `needs-triage`, while its table row says `ready-for-agent`.
