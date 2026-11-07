# Round 13: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–12 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only, on the integration worktree at 4740ef1:
- DECISIONS.md Round 6 Q1–Q2, Round 7 Q1 and Q3 (with its Shared understanding), Rounds 8 and 9 in full, Rounds 10–11 (how the earlier flips came back), Round 12 Q1 (edge 57 ← 30).
- `issues/30-*.md`, `13-*.md`, `36-*.md`, `55-*.md`, `INDEX.md`; `METRICS.md` lines 43, 64 and 233; spec §18 rows "S1–S5 growth" and "S5 MCP bridge" (lines 632 and 644).
- Code, for the facts only: `tests/memory/lib/verdict.mjs:67-148` (`growth()` and the growth check), `tests/memory/lib/budgets.mjs:10-11, 32, 96-97` (`MEMORY.growth`, `MEMORY.S5`, `growthBudget`), `tests/memory/lib/ratchet.mjs:18-114` (the `UNSTABLE` allow-list and the listed-repeated rule), `tests/memory/scenarios/s5-mcp.mjs`, `tests/memory/expected-red.json`.
- Run 42404639968: all jobs green except `memory-budget (windows-latest)`, which fails on exactly one ratchet line, `S5/short: RED but not listed in expected-red.json (windows)`. I downloaded both legs' artefacts (into an empty scratch directory outside the worktree) and read `S5-short/*/summary.json`.
- The windows and ubuntu `memory-budget` job logs of every CI run since 42252896054 that ran the full short profile (`gh api …/actions/jobs/<id>/logs`, S5 lines only). The three S1-only measurement runs (42316982634, 42347506810, 42352122623) have no S5 line.

**Corrections to the round's facts.**
1. **The history is 28 windows runs, not 17.** The round's 17 values skip nine runs in the same period, mostly on the integration branch: 42398294952 (17.28), 42392375847 (21.62), 42384925753 (14.97), 42382114395 (**25.29**), 42378479007 (16.75), 42367395231 (15.64), 42338973997 (**23.57**), 42330994104 (15.88), 42281646419 (20.73). The 28 include Round 7's runs 3 and 4 (26.24 and 22.01). Recomputed on commit, the gate metric (Round 7 Q1 condition 1): n = 28, min 14.27, median 18.25, mean 19.04, sd 3.43, **max 26.24** (run 42252896054, which Round 7 Q3 itself cited), not 23.71. All 28 are above the 5 %/1k budget. The verdict is RED in 1 of 28 (3.6 %; the 95 % Clopper-Pearson upper bound is 15.9 %), not 1 of 17 (~6 %). A plain listing would fail 27 of 28 runs.
2. **The trend flag has two branches, not one.** `verdict.mjs:146`: trend = a trailing strictly rising run of ≥ 3 windows (each > 1 % above the one before) **or** a net rise ≥ 10 % from the first to the last post-warm-up window. RED = over budget AND trend (`:147`). In the RED run the window medians are 77.5, 78.3, 80.2, 80.0, 81.6, 82.6 MB: the rising-run branch fired (80.0 → 81.6 → 82.6), and the net rise was 6.6 %. On Linux the same run's medians are 88.0 → 99.3 MB, the net-rise branch fires (12.8 %), and the rising run is 0.
3. **Linux is a stable RED.** Linux `S5/short` growth:mcp-bridge is RED with trend in 26 of 26 runs: 38.21–46.33 %/1k, mean 42.58, sd 1.99.
4. **The `unstable` code path cannot take this key as built.** `validateExpectedRed` accepts `unstable` only for a key in `UNSTABLE` that also has a `REPEATED` rule (`ratchet.mjs:64`), and its only bound is `maxMedianMB`. `S5/short` is a single run with no median. The recommendation therefore needs a second bound kind, not one more key.

What the numbers mean: the windows bridge grows during the 400-task load in every run, at 4–5× the budget. Linux shows the same signature at roughly twice the rate (19 vs 42 MB per 1,000 tasks in run 42404639968). The windows "GREEN" in 27 of 28 runs is the trend detector missing a slow climb under Windows commit noise. It is not an absence of growth. Round 7 Q3 condition 2 already said so ("GREEN under spec §18's slope-plus-trend rule only").

---

## Q1 — windows S5/short: the growth value is over budget in every run, the verdict flips on the trend flag

**DECISION:** REJECTED in part. Accepted: windows `S5/short` is the same defect as Linux `S5/short`, owned by ticket 30, and it is listed again under a bounded, allow-listed non-binary state. Every other S5 check must stay GREEN. The 5 %/1k budget, the `growth()` rule, and every other entry on both legs stay as they are. Rejected: (i) letting a growth value ≤ 5 %/1k pass silently while the entry is listed; (ii) ticket 30's exit as "≥ 10 windows runs GREEN on growth:mcp-bridge", because today's verdict is already GREEN in 27 of 28 runs, so that exit is met with no fix at all; (iii) the bound's justification "the highest of 17 values is 23.71". The bound of 30 stays, justified on the 28-run history below; (iv) landing the change on ticket 65's branch.

**This explicitly contradicts:**
- **Round 9 Q1 condition 3** ("an allow-list of one key in code"; "`unstable` is not extended to it"). The allow-list gets a second key, with a bound kind of its own. Round 9 condition 3 also said that any other scenario in a middle band "comes back as its own question with its own distribution". This round is that question, and the distribution is the 28-run history above. So this is the intended return path, not a silent extension.
- **Round 10 Q1** ("Round 9 condition 3 stands") and **Round 11 Q1 condition 2** ("the `unstable` allow-list of one key"), for the same reason.
- **Round 6 Q2 condition 3** and **Round 7 Q3 condition 2** ("nobody edits the list a second time"). Both send a disagreeing windows run back as a question. This answer authorises exactly **one** further list edit, adding the windows `S5/short` entry. No later run, job or ticket edits it except ticket 30's exit (condition 4).
- **Round 6 Q1's rationale** ("simpler than a flaky-entry mechanism"), as Round 9 already did.

It does **not** contradict Round 6 Q2 condition 1 (owner): ticket 30's acceptance already reads "Loop S5: growth ≤ 5 %/1k … **Delete `S5/short` (linux, windows)**". Round 7 Q1 condition 1 stands: growth is gated on commit, and WS is reported only. Spec §18's slope-plus-trend rule is unchanged for every scenario and both legs.

Binding conditions:

1. **What the windows entry accepts.** The value is `{ "ticket": "30", "state": "unstable" }` (exact shape is the implementer's choice, in one place). The ratchet judges this key on the **value** of `growth:mcp-bridge` on commit, not on its RED/GREEN outcome:
   - 5 < value ≤ 30 %/1k passes, with the trend either `true` or `false`. Each passing run prints `S5/short: unstable (growth:mcp-bridge <x> %/1k commit, budget 5, bound 30, trend <t>), owned by ticket 30` in the job summary and the report rows.
   - **value > 30 fails** the ratchet (a step change).
   - **value ≤ 5 fails** the ratchet as "at budget but listed for ticket 30". The ratchet's meaning holds: an entry is RED until its owner's fix. 0 of 28 values are ≤ 5 (min 14.27; normal fit z = −4.1), so this case cannot flake. If it fires before ticket 30 lands, for example after ticket 36's semi-space flag, the run's numbers come back as an ownership question. Nobody edits the list.
   - **Any other RED fails, listed or not:** `procPeak:mcp-bridge` (WS gate, 150 MB), `orphans`, `bridge:reboot-cost-of-history` (20 MB), `bridge:task-failures` (0), a harness failure, a missing `@@JOB applied=1`, a failed units self-test.
   - **A growth check that is `insufficient`, or that has no value, or no `mcp-bridge` process in the load window, fails** as a measurement gap (Round 6 Q2 condition 2).

   This is stricter than both alternatives. Today, with no entry, a windows growth of any size passes whenever the trend flag is false (27 of 28 runs). A plain listing would accept any RED on any S5 check.
2. **The bound of 30 %/1k (commit) is evidence-backed, not a budget.** It sits 3.76 above the highest of 28 values (26.24). The per-run probability of a value above 30 is ≈ 0.07 % on a normal fit (z = 3.20) and ≈ 0.39 % on a log-normal fit. Both are well inside the 5 % false-RED line of Round 6 Q1 condition 2. A distribution-free bound from 28 runs cannot show < 5 % for any value (its 95 % upper bound for "above the observed max" is ≈ 10 %). That is why I record the model, so the bound is not mistaken for a guarantee. The bound catches a rise of ~1.6× the mean slope, and Linux's 38–46 %/1k would fail it. WS growth (13–41 %/1k) is reported and not judged (Round 7 Q1 condition 1). The bound disappears with the entry.
3. **One allow-list in code, two keys, each with its own bound kind.** `UNSTABLE` holds windows `S1/burst1` (median bound 300 MB, Round 9) and windows `S5/short` (growth-value band 5 < v ≤ 30 on `growth:mcp-bridge`). The schema check rejects `unstable` on any other key, on `linux` `S5/short`, and a `S5/short` entry carrying a median bound or a `S1/burst1` entry carrying a value band. The ratchet tests pin RED → GREEN at least:
   - 23.71 with trend `true` passes, and 15.55 with trend `false` passes;
   - 30.01 fails, and 4.9 fails;
   - a growth value in the band with `orphans 1`, `task-failures 1`, reboot cost 21 MB, or `procPeak:mcp-bridge` 151 MB WS fails;
   - an `insufficient` growth check fails;
   - `unstable` on `linux` `S5/short`, or on any third key, is a schema error;
   - the existing `S1/burst1` cases are unchanged.

   Any further scenario that disagrees with its list comes back as its own question, and `unstable` is not extended to it automatically.
4. **One owner, one exit.** The entry leaves the list only through ticket 30. Ticket 30's criteria change:
   - The windows deletion needs **every one of ≥ 10 fresh windows `S5/short` runs** on ticket 30's tree to have `growth:mcp-bridge` ≤ 5 %/1k on commit, **whatever the trend flag says**, and every other S5 check GREEN. Each run records commit and WS values, trend, window medians and sample count. They run through an off-by-default measurement mode restricted to S5, as the S1 mode does (Round 8 condition 2). The runs may span more than one CI run of the same tree to fit the windows timeout (≈ 12 min per S5 run). The deleting commit cites them, and METRICS.md and ticket 30's Comments record them.
   - The same commit removes the `S5/short` key from `UNSTABLE`.
   - The Linux deletion stays on the normal verdict, as today.
   - If ticket 30 cannot reach ≤ 5 on windows, it comes back with numbers. The budget is never loosened.
   - No single job run, and no other ticket, ever edits this entry (Round 6 Q2 condition 3 and Round 8 condition 4 stand).
5. **Ticket 55 needs no new edge.** It is already blocked by 30, and its criterion "no `unstable` entry remains … allow-list removed" already forces the exit. Its text "(windows S1/burst1 only, Round 9 Q1)" becomes "(windows S1/burst1, Round 9 Q1; windows S5/short, Round 13 Q1)".
6. **Where it lands: its own small ticket, not ticket 65.** File ticket 66 (next free number), "Ratchet: windows S5/short listed for 30 with a growth-value band", `Status: ready-for-agent`, Model glm, Risk low, ADR no, blocked by nothing. INDEX.md gains its row. Its only content is conditions 1–3, the list edit and the tests. Ticket 65 does not own this key, and putting the change on its branch would let a revert of either undo both (C9, smaller blast radius).
   - One pre-merge CI run of 66 alone confirms. It does not decide. "Disagree" means any ratchet failure in condition 1 on windows `S5/short`, or anything else RED that is not listed. On disagreement the numbers come back, with no rerun-until-green.
   - Then 65, 12, 32 and 42 are restaged on the new tip, and each gets its own pre-merge run as usual. **Run 42404639968 is not counted as a ticket 65 failure**, because its only RED is the key this round decides. A restaged run on a changed tree, after a cause decided here, is not a rerun-until-green. RUNLOG records that, naming this round.
7. **Nothing else changes:**
   - the 5 %/1k growth budget, `MEMORY.growth` (`risingWindows: 3`, `netRisePct: 10`) and `growth()`;
   - the S5 budgets (150 MB, 20 MB, 0 failures);
   - Round 7 Q1's metric split;
   - the `linux` list, including `S5/short → 30`;
   - every other `windows` entry, including the `S1/burst1` bound and n = 7.

   Alternative (a), a trend-free growth rule on windows, is not adopted. It changes spec §18 for every growth check on the primary platform, with no S1–S4 distribution to show what it would turn RED. Its stable plain listing would also accept any RED on S5, which is the gap Round 9 closed.
8. **Records.**
   - Spec §18 (S5 row) records the band, its bound and its only exit as a measurement-rule amendment.
   - RUNLOG records this as a deviation from Round 9 condition 3, Round 10 Q1, Round 11 condition 2, Round 6 Q2 condition 3 and Round 7 Q3 condition 2, naming this round.
   - METRICS.md gets the 28-run windows table and the 26-run Linux table, with run ids, commit and WS values and trend.
   - Ticket 30's Comments name the entry's state, its bound and its only exit.

**Rationale:** The numbers settle what the defect is: 28 of 28 windows runs grow at 14–26 %/1k against a 5 %/1k budget, with the same signature as Linux's stable 38–46 %/1k RED. So the entry belongs to the Linux owner, and ticket 30's own text already claims both legs. What is unstable is not the defect but the trend detector on Windows commit. That makes every binary option wrong:
- With no entry, the run is RED ~3.6 % of the time (up to ~16 % at 95 %) on a defect that no queued ticket touches. Under the no-rerun rule, that blocks four merges at random.
- A plain listing fails 27 of 28 runs.
- Waiting for ticket 30 leaves that random block on the critical path until 13 and 30 land.

The recommendation is right on the core: judge the value, bound it, keep the other S5 checks hard, and tie the exit to 30 and 55. It needed three corrections to be safe:
- **The bound's evidence.** The real maximum is 26.24, not 23.71, and 30 still holds with ≈ 0.1–0.4 % per-run risk.
- **The silent pass at ≤ 5.** It would let a fix land under the wrong owner unnoticed.
- **The exit.** An exit on "GREEN" would be met by today's broken code in 27 of 28 runs, so it has to be judged on the value regardless of trend.

Judged on the value, with a ceiling it lacks today, the windows S5 gate becomes stricter than the status quo and costs no budget. Keeping it in its own ticket keeps every other ticket's pre-merge run about that ticket.

**Charter:** C1 (bounded bridge growth: a regression bound plus hard procPeak, orphan, reboot-cost and failure checks where none bind today), C7 (Windows primary: a gate that holds without lying; Linux unchanged), C9 (stronger measured evidence: 28 windows and 26 Linux runs; then the smaller blast radius: one key in the ratchet, not a rule change for every growth check, and its own ticket), §9 (5 %/1k unchanged; the band only tightens), Round 6 Q1 condition 2, Round 6 Q2 conditions 1–3, Round 7 Q1 condition 1, Round 7 Q3 condition 2, Round 8 conditions 2 and 4, Round 9 conditions 1–5 and 7, Round 11 condition 3, PROMPT §7 Phase 4 (no spurious reverts or blocked merges).

**REVERSIBILITY:** Two-way door (test code, one list entry, ticket text and one new small ticket). ticket 30 removes the state, and ticket 55 guards it out for good. ADR: no.

---

## Shared understanding

Open branches I still see (none blocks ticket 66 or the queued merges):
- **Can ticket 30 turn S5/short GREEN at all, on either leg?** Its eviction acts at > 500 terminal tasks, while `S5/short` runs 400, and METRICS.md line 43 measures only ~4 KB of heap retained per task (≈ 1.6 MB for 400 tasks), against an RSS/commit climb of ~5–12 MB. **EVIDENCE MISSING: an attribution of the S5 bridge growth (JS heap vs native/allocator vs V8 semi-space).** Ticket 36's `--max-semi-space-size=1` also claims "S5 within budget". If 30 cannot reach ≤ 5 %/1k on either leg, or if 36 lands first and drives windows to ≤ 5 (condition 1's ownership failure), the ownership of both `S5/short` entries comes back as a question with numbers.
- **Plain listings still accept any RED on a listed non-repeated key** (the gap Round 9 found, closed only for repeated keys and now for windows `S5/short`). For example, Linux `S5/short → 30` would pass an orphan or a task failure as "expected RED". This round does not decide it; it may come back as its own question.
- These come back with numbers when they occur: a windows `S5/short` value > 30 or ≤ 5, or any other S5 RED, after a later merge; ticket 66's pre-merge run disagrees (condition 6); ticket 30 misses the ≥ 10-run windows exit.
