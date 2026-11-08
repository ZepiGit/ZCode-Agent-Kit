# Round 29 (2026-11-08): ticket 74's mutant proof failed, so what happens to 30 and S5/short?

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–28 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-29.md`.
- DECISIONS Rounds 24, 25 and 26 in full, and Round 28's signature (vii) (ineligibility by exact path, the ~4 % per-run tail).
- On the integration tree (aed28ee): issues 30, 55, 56, 57 and 74, `INDEX.md` rows 30/55/56/57/74, METRICS lines 325–351 (Round 25's set), the RUNLOG tail to 20:03Z, and `spec.md:645`.
- Ticket 74's branch (`/home/AgentKit/wt/t74`, head eab4ddf on 2c6720c): the issue file's Comments, and METRICS lines 429–436. From 30's branch I read `git diff --stat` and the full diff of `job.mjs`, `lib/ratchet.mjs` and `expected-red.json` (merge base with 7555b87 to 2c6720c), plus the mutation list in 30's issue at 2c6720c.
- Raw data `/home/AgentKit/overhaul-tools/t74-memloop/{mut,tree}-{1,2,3}`: `samples.csv`, `job-summary.md`, `run.log` and the `bridge-data/tasks` listings. I re-implemented `growth()` independently from `verdict.mjs:70-106` (MB = 1024, linear slope on progress/1000, six window medians, a trailing rising run at 1 %, net rise) and ran it on the bridge role's samples.
- Windows S5/short lines in the local CI logs written after Round 25 (`ci-art/t20-ev/*-windows.log`, `ci-art/t16-r1/win-memory-job.log`).

**Recomputed facts and corrections to the round.**

1. **Confirmed: the six-run table.**
   - My recompute over tasks 600–1,199 matches each value within one sample: M1 7.76 / 16.96 / 8.98, tree 2.84 / 5.74 / 5.61 %/1k.
   - The medians are identical. Rising windows are 2 / 2 / 0 on M1 and 0 / 0 / 0 on the tree. Net rise is 5.4 / 7.7 / 3.9 % on M1 and 1.9 / 2.2 / 3.0 % on the tree.
   - So the trend flag cannot fire in any of the six runs. Under the pre-registered rule, M1 is GREEN 3 of 3, and the tree is ≤ 5 in only 1 of 3.
   - **Both halves of Round 24 Q1 condition 5 fail.** So 74's own exit criterion ("≤ 5 whatever the trend flag says") would also fail on the tree.
2. **"Absolute slope (MB/1k)" is not a different quantity.**
   - `growthPctPer1k` is slope ÷ mean × 100, and the means are 95.8–103.7 MB. So MB/1k and %/1k rank the six runs identically: tree max 5.56 MB/1k = 5.75 %/1k, M1 min 7.96 MB/1k = 7.77 %/1k.
   - Either one separates the arms only with a value threshold between about 5.8 and 7.7 %/1k without the trend flag. That is a different rule from §9's "5 %/1k AND trend", and it is not obviously a tightening. Three runs per arm with a gap of 2.4 MB/1k is no basis for one.
3. **"A longer post-bound window" is not supported by this data either.**
   - Over tasks 900–1,199, M1 gives 3.79 / 16.79 / **−15.03** %/1k and the tree gives 0.43 / −0.91 / 2.57.
   - M1's RSS signal comes in steps, not as a steady slope. Two of three mutant runs are flat or falling in the second half.
   - A longer window may still help, but that is a hypothesis to measure, not the place the evidence points.
4. **Confirmed, with a note: "3,600 task files against 1,500".**
   - Each M1 `run.log` prints "data 5.9 MB in 3600 files" at the reboot measurement.
   - All six `bridge-data/tasks` directories now hold 1,500 files (500 tasks × 3), mutants included. So the reboot path's restore still applies the bound, and M1 removes only the in-run check.
   - Consequence: `bridge:reboot-cost-of-history` (3–4 MB on M1) cannot see M1 either. Record only.
5. **M1 is already caught deterministically in CI.** 30's mutation set kills M1 and M1b ("the count bound removed (check or victims)") through `test/integration/retention.test.mjs`, which runs in `npm run test:mcp` (`ci.yml:48`). The bound has a guard whatever 74's later answer is. This matters for item 3 (condition 8).
6. **Under the current edges, "56/57 unblock as their own blockers allow" is false.**
   - 57's Blocked-by line names 30, 36 and **74**, and 56's names 13, 30, 31, 36, 57 and **74** (Round 24 Q1 edges; INDEX rows 56 and 57).
   - With 74 reopened as `needs-triage`, both would wait for an unscheduled round and a re-implementation.
7. **Round 25's 20-value set is not tabulated.**
   - METRICS lists values 1–5 only.
   - The local logs alone hold 11 further windows values on trees with 36: staging/20's ten evidence runs 42502565823–42503373851 (17.4, 23.77, 17.5, 19.92, 25.39, 23.17, 23.34, 18.41, 19.84, 22.2) and t16-r1's 18.93. Earlier 36-tree runs (42493218404, 42494299680, 42495987510, 42500996594, 42506095577, …) come before them in creation order and are not in hand.
   - **EVIDENCE MISSING: values 6–20 in run-creation order.** The set is very likely complete already, before 30's runs. Round 26 Q1 condition 4 requires it complete and trigger-free for 30's verdict.
   - Record only: the 15 known values without 30 have mean 20.54, sd 3.04, max 25.39, with none above 30.
8. **30 is ineligible for signature (vii), Round 28.**
   - 30's diff touches `tests/memory/lib/ratchet.mjs` (a comment) and `tests/memory/job.mjs` (one label string). Both are label-only, which I checked in the diff. They are still inside (vii)'s exact-path ineligibility.
   - At Round 28's ~4 % per windows run, the chance of at least one windows S1/short RED is 33.5 % over 10 full-CI runs and 36.2 % over 11. Signature (vi) never applies to 30 either (Round 25 Q1 condition 2).
9. **`spec.md:645` on the integration tree states Round 24's amendment as in force** ("S5/short runs 1,200 tasks …"). It also still says "owned by ticket 30" in the Round 13 text. Both are now wrong.

---

## Q1 — 74 failed its own proof. Does 30 merge, and what replaces 74's rule?

**DECISION:** REJECTED in part.

Accepted:
- **Item 1 in full.** 74 does not stage or merge. Its pre-registered rule (1,200 tasks, window 600–1,200, the `warm-up-growth` ceilings of 55 linux / 30 windows) is **withdrawn as failed** under Round 24 Q1 condition 8. Nothing is changed to fit. The branch (eab4ddf) is kept unmerged for reuse; its commits 8c5a947 and d6a17a0 delete both S5/short entries and `UNSTABLE`, and must never merge in part.
- **The core of item 2.** This is Round 26 Q1 condition 6c exactly: 30 takes exactly 10 full-CI runs per leg on its own staging tree under condition 4, then follows 6b.
- **The core of item 3.** 74 becomes `needs-triage` with one question for a later round. It measures ≥ 5 runs per arm per leg before any rule is pre-registered. The S5/short entries (owned by 74) and signature (vi) stay as they are.

Rejected or corrected:
- (i) **"If the verdict holds, 30 merges"** leaves out 6b's confirming pre-merge run (condition 3).
- (ii) **"56/57 unblock as their own blockers allow"** (correction 6). The edges 57 ← 74 and 56 ← 74 are removed, under a one-rule condition. 55 ← 74 stays (condition 6).
- (iii) **The pointers "absolute slope (MB/1k)" and "a longer post-bound window"** are not backed by the data (corrections 2 and 3). They do not go into 74's ticket. The question stays open, and that includes the answer "no S5/short quantity separates" (correction 5; condition 8).
- (iv) **"Windows via an off-by-default staging measurement mode"** for the mutant arm. A mutant on a CI runner needs a pushed mutant commit, and Round 24 Q1 condition 5 says "never committed". Nothing here authorises that. How a windows mutant arm is produced is part of 74's question (condition 8).
- (v) **Round 25's set must be tabulated** before 30's verdict can be read (correction 7; condition 4).
- (vi) **The linux ≤ 55 part of 30's verdict is applied by the orchestrator from the recorded value.** The ratchet cannot apply it: on 30's tree linux S5/short is listed under `flips` and passes any value (condition 2).

**This explicitly departs from:**
- **Round 24 Q1 "Edges"**: the edges 57 ← 74 and 56 ← 74 are removed. The reasons Round 24 gave, the shared `s5-mcp.mjs` and one S5 rule for 56's base comparison, are kept by condition 6 instead of by a block on a ticket with no rule and no schedule.
- **Round 24 Q1 conditions 3, 7 and 10, and Round 26 Q1 conditions 1–3 and 6a** for 74: they lapse with the withdrawn rule.
- **Round 25 Q1 condition 5's ceiling round** is moot until a re-decided rule has a warm-up ceiling. Round 25's set and triggers stay in force: they are part of 30's verdict and of the band's come-back rule.

It is consistent with Round 24 Q1 condition 8 (the Fallback), Round 26 Q1 conditions 2, 4, 5, 6b and 6c, Round 25 Q1 conditions 1–4, Round 28's (vii) eligibility, and Round 6 Q2 condition 1 (74 stays an open owner).

**I loosen no bound.** These are all unchanged:
- the 5 %/1k budget, `MEMORY.growth`, `growth()` and the trend rule;
- S5/short at 400 tasks with today's quantity;
- the windows band (5 < v ≤ 30 commit);
- (vi) with its hard 35;
- (vii);
- the S5 budgets (150 MB, 20 MB, 0).

Binding conditions:

1. **74 withdrawn.**
   - 74 does not stage, and no part of eab4ddf merges.
   - Its job-seam work (progress windows, the window bounds in `summary.json`, `completeness.mjs`, the fixture tests, the 1,199 fix) stays on `ticket/74-s5-short-post-bound` for reuse. Reuse needs a re-decided rule.
   - The ubuntu timeout stays at 75. S5/short stays at 400 tasks.
2. **30's staging (Round 26 Q1 condition 6c, pre-registered).**
   - Tree: the integration tip at staging time, then `ticket/30` (2c6720c or its successor; no 74 commit). Before the first run, RUNLOG records the tree hash and "10 per leg".
   - Exactly 10 full-CI runs per leg of that one tree (empty commits). Every run with an S5/short value counts. A run with no S5/short value (an infrastructure failure before S5) is replaced, and the replacement is recorded.
   - Each run records the windows commit and WS values, trend, slope MB/1k, mean MB and window medians; the linux RSS value with the same fields; and procPeak, reboot cost, task failures, orphans and duration.
   - 30's verdict is Round 26 Q1 condition 4, unchanged:
     - every windows value satisfies 5 < v ≤ 30 commit (≤ 5 comes back as an ownership question);
     - every linux value is ≤ 55 %/1k, judged by the orchestrator from the printed value;
     - every other S5 check is GREEN in every run;
     - Round 25's set is complete with no trigger;
     - (vi) and (vii) never apply.
   - Any value above 30, a linux value above 55, or any other S5 RED sends 30 back with all values, and nothing is rerun.
3. **Merge (Round 26 Q1 condition 6b).**
   - If the verdict holds and the tip has not moved since the tree was built, the 10th windows/linux run serves as the confirming pre-merge run. This is 6a's provision applied to 6b, so no identical 11th run adds risk without information. It serves only if every job of that CI run is GREEN under the normal rules.
   - If the tip moved, 30 is re-merged onto it and one confirming pre-merge run decides nothing new: band in force, linux listed on growth only, every other S5 check GREEN.
   - Then 30 merges alone.
   - Revert: 30 may be reverted on its own. No 74 code exists on the tip.
4. **Round 25's set (correction 7).**
   - Before 30's verdict is read, METRICS fills values 6–20 in run-creation order from the windows `memory-budget` job logs of every 36-tree run, any branch. It prints n, mean, sd and max with the "with 30 / without 30" subsets (Round 26 Q1 condition 5).
   - 30's runs enter only if slots remain. Either way, 30's 10 runs are printed beside the set as the "with 30" comparison that Round 25 Q1 condition 7 asked for.
   - A trigger comes back under Round 25 Q1 condition 4.
5. **Failures outside S5 in 30's runs** follow the normal rules and do not remove S5 values (Round 26 Q1 condition 2).
   - A windows S1/short RED is not covered by (vii) (correction 8). It comes back under Round 28 with its per-repetition distribution.
   - That round will have the fact that 30's two memory-lib edits are label text only. This round does not pre-judge it.
6. **Edges (departure above).**
   - Remove 57 ← 74 and 56 ← 74. Keep 55 ← 74, because 74 owns the two entries and 55 needs an empty list.
   - Edges 57 ← 30 and 56 ← 30 stay, so 56 and 57 still wait for 30's merge.
   - Condition carried into 56 and 57: their S5 values and base are measured under one S5/short rule. If a re-decided 74 rule merges while either is in flight, that ticket re-measures its base under the new rule. The later of two `s5-mcp.mjs` changes rebases (Round 24's no-edge-to-71 precedent).
   - Removing edges cannot create a cycle.
7. **Records.**
   - 74's METRICS section ("S5/short after the retention bound", t74 METRICS lines 425–436) is copied to the integration METRICS and labelled "withdrawn rule (Round 29)", with corrections 2–4.
   - RUNLOG records this round's departures, the pre-registration of condition 2, and that 74 does not merge.
   - `spec.md:645` is amended (text below).
8. **74's question (for a later round; no implementer chooses it).**
   - Is there an S5/short quantity that separates a working retention bound from M1 on both legs? It must be measured on ≥ 5 runs per arm per leg, with the arms on one tree, before any rule is pre-registered.
   - Any candidate must be checked against §9 (5 %/1k AND trend) as a tightening, never a loosening.
   - If none separates: how do the two entries end? Options include accepting 30's deterministic `retention.test.mjs` kill of M1 as the bound's guard (C9 "do nothing" for a memory statistic), and what 55's empty-list criterion then does with them.
   - How a windows mutant arm runs without committing the mutant (Round 24 Q1 condition 5).
   - Whether linux S5/short gets a value ceiling. Round 17's open branch reopens when the 55 ceiling is withdrawn; between them, 30's 10 runs give the next linux distribution on the merged tree.

**Rationale:** The proof did what it was pre-registered to do. It showed that the 600–1,200 window with the trend rule cannot see M1: net rise 3.9–7.7 % against 10 %, rising run ≤ 2 against 3. It also showed that the bounded tree sits on the 5 %/1k budget in 2 of 3 runs. So the rule fails both as a detector and as an exit, and the Fallback applies with no part merged. 30 is a finished C1 fix: S5/long 238.6 → 111.4 MB peak, and M1 is killed deterministically in `test:mcp`. Round 26 Q1 condition 6c already decided that 30 must not hang on 74's own failure modes, so 30 takes the 10 pre-registered runs on its own tree, judged on the same quantity and at the same 30 bound it has always faced.

The recommendation was right on that core. It was wrong on four facts:
- 56/57 are still blocked by edges to 74.
- Its two pointers for 74 point where the data does not: MB/1k is %/1k rescaled, and the second half of the window is flat or falling on two mutant runs.
- A windows mutant arm in CI needs a committed mutant.
- 30's verdict depends on a Round 25 set that nobody has tabulated.

The edge change is the smaller blast radius: a ticket with no rule, no schedule and an open question should not block the SDK migration (C5) and the restart budget (C1). The reasons for the edges (one rule, one file) are kept by condition 6.

**Charter:** C1 (the retention bound lands on 10 runs per leg; M1 stays guarded deterministically; no bound is loosened), C2 (no list, flag or output change; the S5/short entries keep their labels), C5 (56 is not held behind an unscheduled ticket), C7 (windows judged on 10 runs at the 30 band beside a complete 20-value set; linux values judged ≤ 55), C9 (stronger measured evidence: six raw runs recomputed, plus a second-half split; smaller blast radius: 74 withdrawn whole, 30 alone, edges replaced by a one-rule condition; "do nothing" stays a valid answer for 74), §9 (5 %/1k, 150 MB, 20 MB, 0 unchanged), Round 6 Q2 condition 1, Round 24 Q1 conditions 5 and 8, Round 25 Q1 conditions 2, 4 and 7, Round 26 Q1 conditions 2, 4, 5, 6b and 6c, Round 28 (vii), PROMPT §7 Phase 4 (no rerun-until-green; no spurious blocks).

**REVERSIBILITY:** Two-way door: a withdrawn rule that was never merged, a staging order, two removed edges, ticket text and records. 30's merge is itself revertible. ADR: no.

### Exact text changes

**`issues/74-s5-short-growth-after-retention-bound.md`.**
- `**Status:** ready-for-agent` becomes `**Status:** needs-triage`. Blocked by 30 stays. The file name stays, because the ratchet requires `issues/74-*.md`.
- Replace the title and the `**What to build:**` paragraph with:

```
# 74: S5/short: which measurement separates a working retention bound from its mutant (needs triage)

**What to build:** Round 24's rule (1,200 tasks, growth:mcp-bridge over tasks 600–1,200 with the trend rule, warm-up-growth ceilings 55 linux / 30 windows) failed its pre-registered mutant proof and is withdrawn (Round 29 Q1): ticket 30's M1 was GREEN in 3 of 3 runs (7.77 / 17.01 / 9.03 %/1k, trend false), the bounded tree ≤ 5 in 1 of 3 (2.85 / 5.75 / 5.62). Open question for an Owner Proxy round: which S5/short quantity, if any, separates a working retention bound from M1 on both legs, measured on ≥ 5 runs per arm per leg on one tree before any rule is pre-registered and checked against §9 as a tightening; if none, how the two S5/short entries end (30's retention.test.mjs already kills M1 in test:mcp), and what ticket 55's empty list does with them; how a windows mutant arm runs without committing the mutant. This ticket keeps owning both S5/short entries; signature (vi) ends only when a rule of this ticket merges.
```

- Keep the existing Acceptance list and mark it with one line above it: `Acceptance below is Round 24's withdrawn rule (Round 29 Q1); a later round replaces it.`
- Add under `## Comments`:

```
- 2026-11-08 (orchestrator, Owner Proxy round 29, binding): mutant proof failed on both arms (implementer comment above; values recomputed from /home/AgentKit/overhaul-tools/t74-memloop). The rule is withdrawn under the Fallback; nothing merges, branch eab4ddf kept unmerged for reuse. Recompute: MB/1k equals %/1k × mean/100 here (means 95.8–103.7 MB), so it is not a separate quantity; over tasks 900–1,199 M1 reads 3.79 / 16.79 / −15.03 and the tree 0.43 / −0.91 / 2.57. M1 removes only the in-run bound (3,600 files at reboot, 1,500 after restore), so reboot cost cannot see it. Edges 57 ← 74 and 56 ← 74 removed (one-rule condition in 56 and 57); 55 ← 74 stays.
```

**`issues/30-mcp-task-retention-and-idempotency-window.md`**, add under `## Comments`:

```
- 2026-11-08 (orchestrator, Owner Proxy round 29, binding): 74's mutant proof failed, so Round 26 Q1 condition 6c applies: this ticket takes exactly 10 full-CI runs per leg on its own staging tree (integration tip, then ticket/30; tree hash in RUNLOG before the first run), judged under the Acceptance's S5/short bullet on the band value (windows 5 < v ≤ 30 commit; linux ≤ 55 judged from the printed value; every other S5 check GREEN; Round 25's set tabulated, complete and trigger-free; signatures (vi) and (vii) never apply). Then one confirming pre-merge run (the 10th run serves if the tip has not moved and every job is GREEN), and 30 merges alone. A value above 30 or 55, or any other S5 RED, comes back with all values; nothing is rerun.
```

**`issues/56-mcp-sdk-2-migration.md` and `issues/57-mcp-runtime-restart-budget.md`.**
- Remove `74 (S5/short: judge MCP bridge growth after the retention bound)` from the `**Blocked by:**` lines.
- Add under Comments: `- 2026-11-08 (Owner Proxy round 29): edge to 74 removed; this ticket's S5 values and their base are measured under one S5/short rule; if a re-decided ticket-74 rule merges while this ticket is in flight, its base is re-measured under that rule.`

**`issues/INDEX.md`.**
- Row 74: title `S5/short: which measurement separates a working retention bound from its mutant (needs triage)`; Blocked-by stays `30`; status `needs-triage`.
- Row 56's cell becomes `13, 30, 31, 36, 57`. Row 57's becomes `30, 36`. Row 55 is unchanged.

**`spec.md:645`**, append: `Round 29 Q1: Round 24's S5/short amendment is withdrawn (its mutant proof failed); S5/short stays at 400 tasks with the Round 13 quantity and band; both S5/short entries are owned by ticket 74 (needs-triage), not ticket 30.`

**METRICS.** Values 6–20 of Round 25's set, with subsets (condition 4). 74's withdrawn-rule section and corrections 2–4 (condition 7). 30's 10-run table.

---

## Shared understanding

Open branches I still see:
1. **Round 25's set, values 6–20: EVIDENCE MISSING.** They must be tabulated in creation order before 30's verdict (condition 4).
2. **By-chance failure of 30's runs.**
   - S5 band: Round 26's 3.6–31.6 % per 10 runs; the 15 newer known values without 30 (max 25.39) point to the low end.
   - Windows S1/short: about 34–36 % over 10–11 runs, since 30 is ineligible for (vii). That RED comes back under Round 28.
3. **The attribution of 34.62** is decided by 30's 10 runs, laid beside the set.
4. **74's question** (condition 8): a separating quantity, or none (30's deterministic test as the guard). Also how the entries and 55's empty list end, and how a windows mutant arm runs without a committed mutant. The windows post-bound value is still EVIDENCE MISSING.
5. **Linux S5/short has no value ceiling** again after 30 merges (Round 17's branch reopens), and signature (vi) has no end date until a 74 rule merges. Both are bounded meanwhile by Round 25's triggers and the hard 35.
