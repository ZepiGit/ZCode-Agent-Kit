# Owner Proxy round 24: answers (S5/short after ticket 30)

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–23 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-24.md`.
- Ticket 30's branch at 142b384 (`git -C /home/AgentKit/wt/t30 show HEAD:…/issues/30-*.md`): the attribution, the mutation set and the loop tables. `git diff --stat e88821f 142b384` shows 9 files: `mcp/**`, `dist/**`, the new test and fixture, and the ticket. It touches no `tests/memory/**` file and not `expected-red.json`.
- The integration branch `overhaul/stability-terminal-ux`. It was at e88821f when I started and moved to af5caa8 (ticket 15) while I worked. That merge changes nothing under `tests/memory/` and does not touch ticket 30. Files read: `tests/memory/scenarios/s5-mcp.mjs` (n = 400, `growthBudget` with the default `warmupFraction` 0.25 over the load window), `tests/memory/lib/budgets.mjs` (`MEMORY.growth`, `MEMORY.S5`, `growthBudget`), `tests/memory/lib/verdict.mjs` (`growth()`, the trend rule), `tests/memory/lib/ratchet.mjs` (`UNSTABLE`, the ticket-id rule), `tests/memory/expected-red.json`, `loop.test.mjs:1247-1408`, `verdict.test.mjs:505-512`, `spec.md:633, 645`, `.github/workflows/ci.yml:124` (memory-budget timeout: windows 150 min, ubuntu 75 min).
- DECISIONS Rounds 5 Q2, 12, 13, 17 and 23. Issues 30, 31, 36, 55, 56, 57, 66 (resolved), 71 and INDEX.md. ADR-0009.
- Raw data, recomputed by me: `/home/AgentKit/overhaul-tools/t30-memloop/*/summary.json` and the `samples.csv` of both S5/long runs. I wrote my own re-implementation of `growth()` (same slope, six window medians, rising-run and net-rise branches). For the probe runs I used `/home/AgentKit/overhaul-tools/t30-attrib/{long-tip,long-branch,long-cap50}/probe.jsonl` through the implementer's `analyze.mjs`.
- Staged CI run **42475847194** (staging/30, head 0e99864 = e88821f + 142b384). It has finished: **conclusion success, 8 of 8 jobs green**. The S5 lines come from the job logs (jobs API 128716926718 and 128716926861):
  - **windows** `S5/short`: `growth:mcp-bridge` **14.5 %/1k commit** (WS −4.24), trend false. The job printed "S5/short: unstable (growth:mcp-bridge 14.5 %/1k commit, budget 5, bound 30, trend false), owned by ticket 30". procPeak 75.4 MB WS (89.3 commit), reboot cost 3 MB, 0 failures, 0 orphans. Ratchet holds. Job 43.9 min, of which S5/short took 12.0 min (11:58:02 → 12:10:03).
  - **linux** `S5/short`: `growth:mcp-bridge` **31.82 %/1k**, trend false. The job printed "GREEN, listed for ticket 30 on flipping checks". procPeak 101.6 MB, reboot cost 4 MB, 0 failures, 0 orphans. Ratchet holds. Job ≈ 37 min, of which S5/short took 11.9 min.
  - For comparison, the integration run 42469136344 (tip, no retention) had windows 16.53 (trend false) and linux 43.81 (trend true, RED, listed).

**Recomputed facts and corrections to the round.**
1. **Confirmed.** These figures are correct:
   - S5/long tip RED, 40.80 %/1k with trend, against branch GREEN, 1.11 %/1k without trend. My recompute of the job's own window (tasks 750–3,000) gives the same 40.80 and 1.11.
   - Reboot cost 31 against 4 MB.
   - S5/short local: tip 44.53 / 41.18 / 39.60, branch 35.29 / 37.62 / 34.52. Two of the three branch runs are GREEN only because the trend flag is false.
   - The per-task costs: (18.14 − 16.76) MB / 300 tasks = 4.6 KB of JS heap, and (93.0 − 84.5) / 300 = 28 KB of RSS.
   - The smaps split: 6.2 + 1.6 + 1.3 = 9.1 MB, or 68 / 18 / 14 %.
2. **The cap-50 warm-up is 11.4–15.0 MB/1k, not 11.4–12.8.** `analyze.mjs long-cap50` gives 14.95 MB/1k over tasks 100–400 and 11.43 over 100–500. It falls to −2.17 over 500–900 and −1.37 over 500–1,500. So the warm-up alone is 2.3–3× the 4.5 MB/1k that 5 %/1k allows at ~90 MB. Nothing that changes retention or per-task footprint can bring a window that starts at task 100 under budget. This supports the round's conclusion.
3. **The recommendation's window (500-task warm-up, ≥ 400 judged tasks) has no margin on the branch.** Its own fallback would also fire. Recomputed on the branch:

   | window (tasks), warm-up fraction 0 | branch, job sampler %/1k (trend) | branch, probe MB/1k | tip, job sampler %/1k (trend) | tip, probe MB/1k |
   |---|---|---|---|---|
   | 500–900 | **4.74** (false) | **7.60** | 37.49 (true) | 51.1 |
   | 600–1,000 | 0.50 (false) | 2.25 | 16.48 (**false**) | 35.6 |
   | 600–1,200 | 1.37 (false) | 2.72 | 15.82 (true, net rise 13.8 %) | 14.6 |
   | 500–1,500 | 2.12 (false) | 2.97 | 21.79 (true) | 19.6 |

   At ~102 MB, 1 MB/1k ≈ 1 %/1k, so the probe's 7.6 MB/1k over 500–900 is over budget. The first ~100 tasks after the bound is reached still settle, because evicted tasks become garbage and old-space pages are released slowly. A 400-task window that starts at 600 has the opposite problem: it misses the trend of the very defect it exists for (tip 16.48, trend false). Only a window that starts at 600 and runs to ≥ 1,200 keeps both a margin on the branch and a trend on the tip, on this evidence.
4. **EVIDENCE MISSING: a windows (commit) post-bound value.** There is no windows S5 run beyond 400 tasks. Condition 7's exit decides it.
5. **EVIDENCE MISSING (record only): the window medians of linux run 42475847194.** The log prints no medians. This run is a GREEN linux S5/short, so Round 17 Q2 condition 3 requires a record of its medians. They are in the run's `summary.json` artefact. The value 31.82 is > 5, so no ownership question arises.

---

## Q1 — S5/short after retention: who owns the growth that retention cannot reach

**DECISION:** REJECTED in part.

Accepted:
- Ticket 30 merges on its retention criteria and S5/long, and closes.
- The principle of option (a): S5/short's bridge growth is judged **after warm-up, and warm-up includes reaching the retention bound**. The 5 %/1k budget, `growth()` and the trend rule are unchanged.

Rejected:
- (i) **The window parameters.** A 500-task warm-up with ≥ 400 judged tasks is replaced by a 600-task warm-up and a 600-task judged window (S5/short n = 1,200). The branch measures 4.74 / 7.6 over 500–900, and a 600–1,000 window misses the tip's trend (correction 3).
- (ii) **Moving the entries to a per-task footprint ticket (c) "with the same exits".** Correction 2 shows those exits cannot be reached by construction. That would make the entries a permanent listing that blocks 55.
- (iii) **Filing (c) at all now.** The per-task footprint is bounded by the 500 bound (~28 KB of RSS each, ~14 MB at the bound). It breaks no budget: S5/long procPeak is 111.4 of 150 MB, reboot cost 4 of 20 MB, CI reboot cost 3–4 MB. Do nothing (C9).
- (iv) **Option (b), an owner for the warm-up.** A plateau after warm-up is not a defect under spec §18 ("after warm-up") or `verdict.mjs`'s own rule ("A plateau after allocator warm-up … is not [a leak]"). It gets a value ceiling instead of an owner (condition 3).
- (v) **"If (a)'s window is still over 5, (c)'s ticket owns it."** This is replaced by "the numbers come back" (condition 8).

The measurement rule and both S5/short entries move to **new ticket 74**. Its exit is reachable and pre-registered here.

**This explicitly contradicts:**
- **Round 13 Q1 condition 4** ("The entry leaves the list only through ticket 30"; "no other ticket ever edits this entry"). Ticket 30's tree re-owns both S5/short entries to 74 once, and 74 deletes them. The reason: 30's fix is complete (S5/long RED → GREEN). What remains is a measurement question that 30's code cannot answer, and the ratchet must not list an entry under a resolved owner.
- **Round 17 Q2 condition 2** (30's linux exit) and Round 13 Q1 condition 4's windows exit. Both move to 74 with the same strictness: ≥ 10 fresh runs per leg, every one ≤ 5 %/1k whatever the trend flag says, every other S5 check GREEN. They are now measured on the new window.
- **Round 13 Q1 condition 7**, insofar as the S5/short scenario length changes from 400 to 1,200 tasks. The S5 budgets (5 %/1k, 150 MB, 20 MB, 0) are unchanged.

It does not contradict Round 12 Q1 (edge 57 ← 30 stays, and 57 ← 74 is added for the same reasons) or Round 23 Q1 condition 3 (56 compares S5 values against a base under one rule; edge 56 ← 74).

Binding conditions:

1. **Ticket 30 merges now, on these terms.**
   - Run 42475847194 counts as its staged run. Both legs hold the ratchet: windows is in the band at 14.5, and linux is a flip GREEN at 31.82 with every other S5 check GREEN.
   - Before merging, 30's tree gains one list and label edit (condition 2), and **one restaged run** must show the same outcomes. The edit changes labels and the tests that pin them, not measurements. Any disagreement comes back, and nothing is rerun until it turns green.
   - 30's Acceptance is rewritten as in the text changes below: its "Delete `S5/short`" line and both exits move to 74.
   - 30's Comments record the CI values above and the linux run's window medians (correction 5; Round 17 Q2 condition 3).
2. **Re-own once, in 30's tree.**
   - Linux: `"S5/short": { "owners": { "74": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] }`.
   - Windows: `"S5/short": { "ticket": "74", "state": "unstable" }`.
   - The windows band (5 < v ≤ 30 on commit), the `UNSTABLE` key and every other rule of Round 13 Q1 conditions 1–3 stay as they are until 74 lands. Only the owner label changes.
   - `verdict.test.mjs:505-512`, `loop.test.mjs:1278-1289, 1403-1408` and the `ratchet.mjs:69` comment change "30" to "74". This is justified as a label-only test change.
   - The orchestrator first commits the issue file for 74, because the ratchet requires `issues/74-*.md` to exist.
   - Round 17 cross-question condition 2 signature (iv) and Round 17 Q2 condition 3's wrong-owner watch continue unchanged, recorded in **74's** Comments.
3. **Ticket 74: the rule (pre-registered; the implementer does not choose the numbers).**
   - **Scenario.** `S5/short` runs **n = 1,200** tasks with today's per-task workload unchanged (start, wait, result, a 16 KB prompt every 10th task, `tasks_list` every 25th). S5/long is unchanged (3,000 tasks, default 25 % warm-up).
   - **`growth:mcp-bridge`** is computed over the load samples from the first sample with progress ≥ 600 to the end of the load, with `warmupFraction: 0` inside that window. The 600 tasks are the warm-up: the 500-task bound plus 100 settling tasks (correction 3). `growth()`, `MEMORY.growth` (5 %/1k, 3 rising windows, 10 % net rise) and the RED rule (over budget AND trend) are unchanged. `summary.json` and the check detail record the window's bounds in tasks and in samples.
   - **A warm-up ceiling (new check; a tightening, not a budget).** Name it `warm-up-growth:mcp-bridge`. Its value is today's S5/short quantity, computed exactly as now: `growth()` over the load window cut at the sample where progress reaches 400, with the default 25 % warm-up. It is printed in every run and judged on value regardless of trend:
     - RED above **55 %/1k on linux** (RSS). The tip has 36 CI runs between 37.53 and 46.33 (Round 13: n = 26, mean 42.58, sd 1.99; Round 17: 10 runs, 39.53–45.99). 55 is 8.67 above that maximum, z = 6.2. Branch values on record are 31.82 (CI) and 34.52–37.62 (local).
     - RED above **30 %/1k on windows** (commit). This is Round 13's bound with its 28-run justification (max 26.24; branch CI 14.5). It carries over so that deleting the windows entry does not remove the only windows regression bound on bridge growth.
     - It also closes Round 17's open branch "Linux S5/short has no value ceiling".
   - **Every other S5 check is unchanged and judged over the whole run, warm-up included:** `procPeak:mcp-bridge` ≤ 150 MB (WS on windows), `bridge:reboot-cost-of-history` ≤ 20 MB (now after 1,200 tasks with 500 retained), `bridge:task-failures` 0, and orphans 0.
4. **Why this loosens nothing.**
   - Over tasks 100–400, the old window measured runtime warm-up (correction 2) and history below a bound that ADR-0009 sets on purpose. Both are bounded.
   - The new window tests the bound itself. The old 400-task window could never see a retention bound fail. The tip, with no bound, is 15.82 %/1k with trend over 600–1,200.
   - The level stays hard-bounded over the whole run by procPeak and the reboot cost. The warm-up phase gets value ceilings that bind today only on windows (and only while the entry exists).
   - Today the linux listing passes any value. After 74, linux is bounded on both windows.
5. **Mutant proof, before any CI evidence (local linux, never committed).**
   - A bridge with the count bound removed (30's mutant M1) runs the new S5/short **≥ 3 times**. It must be RED on `growth:mcp-bridge` (value > 5 and trend true) in **every** run.
   - The tree with 30 merged runs it ≥ 3 times. Every run must have `growth:mcp-bridge` ≤ 5 and a warm-up value under the ceiling.
   - If any mutant run is GREEN, the window cannot see its defect, and the numbers come back. Nobody lengthens or moves the window on their own.
6. **Tests, RED first, at the job seam with fixture series:**
   - growth until task 600, then flat: GREEN;
   - growth continuing after 600 with a trend: RED;
   - a warm-up value of 55.1 (linux) or 30.1 (windows commit): RED, while the post-bound window is GREEN;
   - a load that ends before task 1,200, or fewer than 6 samples after 600: a harness failure or `insufficient`, never GREEN;
   - the window bounds are printed.
7. **74's exit (the only way the entries leave):**
   - On 74's tree, through an off-by-default S5-only measurement mode, **≥ 10 fresh runs per leg**. They may span several CI runs or parallel jobs of the same tree, each on a fresh runner.
   - Every run must have `growth:mcp-bridge` ≤ 5 %/1k on the new window whatever the trend flag says, a warm-up value under its ceiling, and every other S5 check GREEN. Each run records the value (commit and WS on windows), trend, window medians, sample counts and duration in METRICS and in 74's Comments.
   - Then, in one commit:
     - delete linux and windows `S5/short` from `expected-red.json`;
     - remove `S5/short` from `UNSTABLE`, so the schema then rejects `unstable` on it. The band tests are replaced by that schema test, a justified pre-existing test change;
     - land the rule.
   - The pre-merge run must show S5/short GREEN on both legs with no entry.
8. **Fallback (pre-registered).** If the mutant proof or the exit fails on either leg, 74 does not merge in part (the windows band was calibrated on the old window), and it comes back with all the values. The 5 %/1k budget, the ceilings and the scenario are never bent to fit.
9. **CI wall time.** S5/short goes from ~12 to ~36 min per leg, measured in 42475847194 (12.0 min per 400 tasks on both legs). Windows: ≈ 68 min (≈ 86 with 71's repetitions) against 150. Ubuntu: ≈ 61 min against 75, which is 81 %. So 74 raises the ubuntu `memory-budget` `timeout-minutes` from 75 to 100. That is a wall-time guard, not a §9 budget, and every evidence run records the job duration.
10. **Records.**
    - Spec §18 S5 row: the amendment text below.
    - METRICS: correction 3's table, the cap-50 slopes, and the 42475847194 values.
    - RUNLOG: this round's departures from Round 13 Q1 conditions 4 and 7 and Round 17 Q2 condition 2.
    - ADR-0009 is unchanged; the retention policy did not move.

**Rationale:** The numbers settle what S5/short has been measuring. Even with a 50-task bound, tasks 100–400 grow at 11.4–15 MB/1k, and the curve flattens after ~500 tasks. That is runtime warm-up, which spec §18 itself excludes ("after warm-up"). The other half is history below a bound that ADR-0009 sets on purpose. So no retention or footprint ticket can meet an exit judged on that window, and handing the entries to one (option c) would only rename a permanent listing. Judging after the bound (option a) is right: it is the S5/long shape, the only window that can see a bound fail, and the tip is RED and the branch GREEN under it.

The recommendation's parameters fail on its own data. 500–900 gives 4.74 and 7.6 MB/1k on the branch, which is no margin, so the gate would flake on the primary platform. A 400-task window from 600 lets the no-retention tip through on the trend flag. 600–1,200 is the shortest window on record with margin on the branch (1.37 / 2.72) and a trend on the tip (15.82, trend true). The mutant proof and the ≥ 10-run exit exist because those numbers rest on one run per arm. The warm-up ceilings keep the windows regression bound that would otherwise disappear with the entry, and give linux the bound it never had. So nothing that is gated today is gated less after 74.

Splitting the rule into 74, rather than holding 30 until ~20 more S5 evidence runs exist, keeps a finished C1 fix (an unbounded store, 238.6 → 111.4 MB peak on S5/long) off the critical path of 31, 57 and 56. It also lets a revert of either the rule or the retention leave the other intact. That is the Round 13 (ticket 66) and Round 17 (ticket 71) precedent.

**Charter:** C1 (bounded memory: the bound is tested where it acts; a regression ceiling on warm-up; procPeak and reboot cost over the whole run), C7 (windows bound kept; windows post-bound value measured before deletion; linux brought to the same bounds), C9 (stronger measured evidence: recomputed windows on both arms; smaller blast radius: the rule in its own ticket; "do nothing" for per-task footprint), §9 (5 %/1k, 150 MB, 20 MB, 0 unchanged; one new ceiling only tightens), Round 5 Q2, Round 6 Q2 condition 1 (every entry has an open owner), Round 12 Q1, Round 13 Q1 conditions 1–4 and 7, Round 17 Q2 conditions 2–3, Round 17 cross-question condition 2, Round 23 Q1 condition 3, PROMPT §7 Phase 4 (no rerun-until-green; no spurious blocks).

**REVERSIBILITY:** Two-way door: test code, a scenario length, two list labels, ticket text, one CI timeout. ADR: no.

### Exact text changes

**New file `issues/74-s5-short-growth-after-retention-bound.md`** (the orchestrator commits it first):

```
# 74: S5/short: judge MCP bridge growth after the retention bound (1,200 tasks, window 600–1,200)

**Blocked by:** 30 (MCP task retention (500 / 7 days) and the idempotency window)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: none

**What to build:** S5/short's 400-task window measures runtime warm-up and task history below ADR-0009's 500-task bound, which no fix can bring under 5 %/1k (Round 24 Q1). Run S5/short for 1,200 tasks with today's per-task workload and judge `growth:mcp-bridge` over tasks 600–1,200 (warm-up fraction 0 inside the window; `growth()`, 5 %/1k and the trend rule unchanged). Add `warm-up-growth:mcp-bridge`: today's quantity (load window cut at task 400, default 25 % warm-up), RED above 55 %/1k on linux (RSS) and above 30 %/1k on windows (commit) regardless of trend. procPeak (150 MB), reboot cost (20 MB), task failures (0) and orphans are judged over the whole run. This ticket owns both `S5/short` entries (re-owned from 30) and is their only exit.

**Acceptance criteria:**

- [ ] Tests RED first at the job seam: growth to task 600 then flat is GREEN; growth continuing after 600 with trend is RED; warm-up 55.1 (linux) / 30.1 (windows commit) is RED with a GREEN post-bound window; a load ending before 1,200 or < 6 samples after 600 is a harness failure / insufficient; window bounds are printed in summary.json and the job summary.
- [ ] Mutant proof (local linux, never committed): the count bound removed (ticket 30's M1) is RED on growth:mcp-bridge (value > 5 and trend) in every one of ≥ 3 runs; the tree with 30 is ≤ 5 with the warm-up value under its ceiling in every one of ≥ 3 runs. Otherwise come back with the numbers.
- [ ] Exit: ≥ 10 fresh runs per leg on this tree via an off-by-default S5-only measurement mode (several CI runs or parallel jobs allowed), every one with growth:mcp-bridge ≤ 5 %/1k on the new window whatever the trend flag says, the warm-up value under its ceiling, and every other S5 check GREEN; values (commit and WS on windows), trend, window medians, sample counts and durations recorded in METRICS.md and here.
- [ ] The same commit deletes `S5/short` from both legs of `expected-red.json` and removes it from `UNSTABLE`; the schema then rejects `unstable` on S5/short (replacing the band tests, justified). The pre-merge run shows S5/short GREEN on both legs with no entry.
- [ ] Fallback: if the mutant proof or the exit fails on either leg, nothing merges in part; the ticket comes back with all values. No budget, ceiling, window or task count is changed to fit.
- [ ] The ubuntu `memory-budget` `timeout-minutes` goes from 75 to 100 (wall-time guard, not a budget).
- [ ] Spec §18 S5 row and METRICS.md updated (Round 24 Q1 condition 10).

**Common acceptance (every ticket):** as in every ticket file.

Spec stories: none (measurement rule, Round 24 Q1)

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 24, binding): re-owned from 30. Until this ticket merges, Round 17 Q2 condition 3's wrong-owner watch (any linux S5/short value ≤ 5 %/1k on the old window comes back as an ownership question) and Round 17 cross-question signature (iv) are recorded here. Staged run 42475847194 (30's tree): windows 14.5 %/1k commit (trend false, in band), linux 31.82 %/1k (trend false, flip GREEN).
```

**`issues/30-mcp-task-retention-and-idempotency-window.md`.** Replace the two Acceptance bullets that begin `- [ ] Loop S5: growth ≤ 5 %/1k` and `- [ ] Linux exit (Round 17 Q2 condition 2;` with:

```
- [ ] Loop S5/long (3,000 tasks): GREEN on every check (growth ≤ 5 %/1k, procPeak ≤ 150 MB, reboot cost of history ≤ 20 MB, 0 task failures), tip RED → branch GREEN recorded.
- [ ] Loop S5/short: no new RED on either leg (linux listed, growth:mcp-bridge only; windows inside the 5–30 %/1k commit band; every other S5 check GREEN); values recorded. Both S5/short entries are re-owned to ticket 74, which holds their only exit (Round 24 Q1; explicitly contradicts Round 13 Q1 condition 4 and moves Round 17 Q2 condition 2's exit to 74).
```

Add under `## Comments`:

```
- 2026-11-08 (orchestrator, Owner Proxy round 24, binding): merges on retention and S5/long. Staged run 42475847194: windows S5/short 14.5 %/1k commit (WS −4.24, trend false, in band); linux 31.82 %/1k (trend false, flip GREEN; window medians from the run's summary.json to be recorded here, Round 17 Q2 condition 3); all other S5 checks GREEN on both legs. The S5/short entries are re-owned to 74 in this tree, followed by one restaged run. The per-task footprint (~4.6 KB heap / ~28 KB RSS per retained task) is bounded by the 500 bound and gets no ticket (C9).
```

**`tests/memory/expected-red.json`** (in 30's tree, the only list edit; replaces the two `S5/short` lines):
- linux: `"S5/short": { "owners": { "74": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] },`
- windows: `"S5/short": { "ticket": "74", "state": "unstable" },`

Ticket 74 later deletes both keys (condition 7). No other entry changes.

**`issues/INDEX.md`.**
- New row: `| 74 | [S5/short: judge MCP bridge growth after the retention bound (1,200 tasks, window 600–1,200)](74-s5-short-growth-after-retention-bound.md) | sol | medium | 30 | ready-for-agent |`
- Row 57's Blocked-by cell: `30, 36, 74`. Row 56's cell: `13, 30, 31, 36, 57, 74`. Row 55's cell: insert `74` after `61`.
- The `**Blocked by:**` lines of issues 55, 56 and 57 gain `74 (S5/short: judge MCP bridge growth after the retention bound)`.

**Edges.**
- **74 ← 30:** the rule needs the bound, and the mutant proof compares against it.
- **57 ← 74:** same file, `s5-mcp.mjs`, plus S5 measurement separation, as Round 12 Q1 ruled for 57 ← 30.
- **56 ← 74:** 56's memory gates compare S5 values against a base, so both must use one rule. 56 is also transitive through 57.
- **55 ← 74:** 74 owns two entries, and 55 needs an empty list.
- **No edge to 71:** 71 edits `REPEATED` in `budgets.mjs` and 74 edits `UNSTABLE` in `ratchet.mjs`, so they change different constants, and the later merge rebases.
- **Acyclic, checked.** 74's ancestors are 30 and 13 ← 12 ← 11 ← 10 ← 09 ← 02, 03, 04 (01). Its descendants are 55, 57 → 56 → 53 → 54. None of them is an ancestor of 30 or 13.

**`spec.md:645` (S5 row).** Append: `Measurement-rule amendment (Round 24 Q1): S5/short runs 1,200 tasks; growth:mcp-bridge is judged over tasks 600–1,200 (the 500-task retention bound plus 100 settling tasks, warm-up fraction 0 inside), budget and trend rule unchanged; warm-up-growth:mcp-bridge (tasks to 400, today's quantity) is RED above 55 %/1k on linux and 30 %/1k commit on windows regardless of trend; procPeak, reboot cost, failures and orphans are judged over the whole run. Both S5/short entries are owned by ticket 74, whose only exit is ≥ 10 fresh runs per leg at ≤ 5 %/1k on the new window.`

---

## Shared understanding

Open branches I still see (none blocks 30's merge):
1. **Windows post-bound value: EVIDENCE MISSING.** No windows S5 run has gone past 400 tasks. 74's exit decides it. If windows misses, it comes back with the values.
2. **The mutant's trend margin is thin on one run.** On the tip over 600–1,200 the net rise is 13.8 % against the 10 % threshold. Condition 5's ≥ 3 runs test it. If the trend flag misses it, the window question comes back, and a value-only rule for this key would be its own question.
3. **The per-task footprint (~28 KB of RSS per retained task, ~14 MB at the bound) has no owner by design.** It comes back if a bridge level budget (S5 procPeak, or 37's S3 bridge peak, which runs no tasks) is ever tied to it.
4. **CI wall time grows by ~24 min per leg per memory run** (condition 9). If it starts to constrain the staging pace, it comes back with the job durations.
5. **Until 74 merges, the Round 17 items stay open:** linux S5/short has no value ceiling, the wrong-owner watch is active, and signature (iv) applies.
