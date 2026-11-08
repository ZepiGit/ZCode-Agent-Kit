# Round 17 (2026-11-08) — the rare tails behind ticket 67's eight evidence runs

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–16 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only:
- `gh run view <id> --log` for all 8 runs (logs read into a scratch directory outside the worktree). All 8 head commits carry the same tree, 4a7e58e. Failures: 42436010878 windows memory (S7), 42436186573 linux memory (S5) **and** windows test-kit Node 24 (`manager-safety.test.mjs:160`, ticket 70), 42436354758 windows memory (S1/short), 42436440284 windows test-kit Node 26 (`loop.test.mjs:459`, the floor test). That is five failures in four runs, as the round says.
- The archived memory-job logs `/home/AgentKit/overhaul-tools/ci-art/t67-logs/logs/*.log` (every CI run up to 42429164758), recounted per key and leg for the three values in question.
- `ticket/67-owned-checks` at 3b414b2: `tests/memory/expected-red.json`, `tests/memory/lib/budgets.mjs`, `.scratch/kit-overhaul/METRICS.md` lines 258–373, `tests/memory/scenarios/s7-disk.mjs`, `tests/memory/loop.test.mjs:459-476`, `tests/memory/fixtures/omp-host.ts:25-89`.
- Integration tree d170038: issues 03, 19, 20, 21, 25, 30, 33, 35, 36, 61 and INDEX.md; spec §7 (bounded collections), §18 MEMORY rows, the ratchet and baseline paragraphs; `zcode-proxy-src/src/responses/store.ts:48-104`, `runtime/health-monitor.ts:166-171`; DECISIONS Rounds 6, 13–16; PROMPT §7 Phase 4; RUNLOG to 03:02Z.

**Corrections to the round's facts.**
1. **Q3: windows S1/short has been RED before, and the earlier RED was never recorded.** Integration run 42382114395 (`overhaul/stability-terminal-ux`, 2026-11-07 14:37Z) shows `RED growth:proxy 5.27 %/1k trend=true [commit 5.27 / WS 1.47]`, then `ratchet FAILED` and `S1/short: RED but not listed in expected-red.json (windows)`. Neither RUNLOG, METRICS nor DECISIONS mentions it. Recounted over every windows run with an S1/short line (n = 49: 41 archived + 8 new), commit growth is min 1.43, median 3.56, mean 3.41, sd 0.93, max 5.27. It is RED in **2 of 49** (4.1 %; 95 % Clopper-Pearson 0.5–14.0 %), and the round's "~3.7–4.0" understates the spread. Normal fit P(> 5) = 4.3 %, log-normal 7.8 %. WS growth is −5.6 to +3.5. Linux S1/short across 70 runs: max 4.43, never RED; it was 3.08 in the RED run.
2. **Q1: the check was never RED before, but it has a tail.** `responses-store:heap-at-cap` (heap growth, one `/health` reading 5 s after the load, no GC):
   - windows, n = 51: 46 values in 60–65 MB; tail 71, 71, 86, 87, **98** (42415959288, 42378479007, 42421424292, 42281646419, 42436010878);
   - linux, n = 70: 69 values in 59–65 MB; one 77 (42367395231).

   The store cannot cause that spread. `ResponseStore.set` evicts synchronously against a serialized-byte bound (64 MiB) and a count bound (1,000 entries), and S7 sends identical input every run (1,500 × 64 KB). So its retained size is the same in every run, which is the 59–65 MB cluster. The extra 6–34 MB is other heap that is not collected 5 s after the load. `heapUsedMB` is `process.memoryUsage().heapUsed` (`health-monitor.ts:171`), read without a GC.
3. **Q1: the short-profile S7 check has almost no power against its own defect class.** 1,500 × 64 KB = 93.75 MiB, which is below the 96 MB budget. A store with no bound at all would read about 94–100 MB, about where today's 98 tail reading lies. The long profile (4,000 → 250 MiB) can tell them apart. Q1 does not decide this. It is recorded in Shared understanding.
4. **Q4: the Node version is not a variable.** The stub OMP host runs under Bun (`resolveBun(KIT)`), and Node only runs the test harness. The windows floor test passed 15 of 16 windows legs across the 8 runs (Node 24 8/8, Node 26 7/8) and all 16 Linux legs. **EVIDENCE MISSING: the windows commit no-op floor distribution.** A passing run prints no value, so 2.55 MB is the only windows number on record. Linux (RSS) is +0.63 to +0.75 MB (ticket 03).
5. **Q2: the GREEN is the net-rise branch missing by a small margin.** On the 13 tree, linux S5/short is RED in 9 of 10 runs (42425069025, 42429164758 and the 8). The values are 39.53–45.99 %/1k, median about 42.0, the same as before 13 (37.53–46.33, median 42.63). Run 42436186573 is 39.53 with `trend=false`; every other S5 check is GREEN, at a peak of 102.6 MB.

---

## Q1 — windows S7/short `responses-store:heap-at-cap` RED, unowned (1 of 8)

**DECISION:** REJECTED, both routes. No ticket owns the check, and no entry lists it. Instead, the check gets a measurement-rule amendment that lands in new ticket **71**.
- **Rejected: ticket 25 as owner.** 25's What-to-build says the responses-store logic "is lifted into one module (responses store behaviour and tests unchanged)", and spec §7 has "Responses store | unchanged (64 MB / 1,000 entries)". 25's text promises *no* change to this bound, so it cannot be the fix that clears the RED (Round 15 Q1 condition 2; Round 14 Q1 condition 3(b)). 33's acceptance names only `proxy.log:bounded-while-running`, and 34 owns nothing (Round 15 Q1, E).
- **Rejected: a needs-triage owner.** Listing the name would tolerate any value of a check that, at the short profile, already cannot tell an unbounded store from a bounded one (correction 3). That masks rather than triages.

Binding conditions:
1. **What the check judges.** The 96 MB budget and the check name stay. The value becomes the store's *retained* heap:
   - After the existing 5 s wait, the scenario reads `/health` `heapUsedMB` at least 30 times, 1 s apart.
   - `heap-at-cap` = the **minimum** of that series minus `h0`.
   - `summary.json` and the check detail record the series: first reading (today's value), minimum, maximum, and RSS before and after.

   No product code changes: no GC hook, no new endpoint (C6). Why the minimum loosens nothing: memory the store retains is present in every reading, so a store over its bound is RED under both rules, and the minimum is never above the first reading. Transient garbage stays bounded by S7's unchanged `procPeak:proxy` (WS 250 MB) and `commit-backstop:proxy` (512 MB). The short-profile load (1,500) and the long profile (4,000) stay as they are.
2. **Tests, RED first.** These run at the job seam with fixture series:
   - a series [98, 97, 80, 64, …] is GREEN;
   - a series that never drops below 97 is RED;
   - a series with a missing or non-numeric reading is a harness failure, never GREEN;
   - a series shorter than 30 readings is a harness failure.

   Plus one local mutant, never committed: the store with both bounds removed, run on the **long** profile, is RED under the new rule. Record its short-profile value under both rules as information (correction 3).
3. **Evidence and what comes back.** 71's pre-merge run and every later run record the series. If any run's minimum lies above 66 MB, it comes back as a question with the series, but it does not block 71's merge. That would be heap retained beyond the store's cluster, which is a real finding and not GC timing.
4. **Records.** Spec §18 S7 row gains: "responses store heap at its cap ≤ 96 MB, judged on the minimum of ≥ 30 `/health` readings 1 s apart after the load (Round 17 Q1)". METRICS gets the 51/70 table (correction 2). Ticket 25's Comments gain: "Round 17 Q1: 25 does not own `responses-store:heap-at-cap`. Its lift keeps the store unchanged."

**Rationale:** The numbers settle the cause. In 115 of 121 runs the reading sits on the store's cap, and the store's bound is enforced synchronously on identical input. So the 6–34 MB tail in six runs cannot be the store; it is uncollected heap read at a random moment. Listing the name would hand a rare GC-timing artefact to an owner whose text promises not to touch the store, and it would tolerate a store regression of any size. Measuring what the budget names, the store's retained heap, removes the false RED, keeps the bound's full force on real retention, and adds a mutant proof the check never had. It is test code in one scenario.

**Charter:** C1 (the store's bound is proven by the quantity it bounds; transient memory stays bounded by the unchanged peak and backstop checks), C6 (no product endpoint or GC hook), C9 (stronger measured evidence: 121 runs plus the store's code; smaller blast radius: one scenario's reading), §9 (96 MB unchanged), Round 14 Q1 condition 3(b), Round 15 Q1 conditions 2 and 6, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (test code and spec text). ADR: no.

---

## Q2 — linux S5/short `growth:mcp-bridge` over budget but GREEN on the trend flag (1 of 8)

**DECISION:** ACCEPTED with conditions. 67 marks `growth:mcp-bridge` as `flips` in linux `S5/short` (owner 30). Ticket 30's linux exit is judged on the value, not on GREEN.

**This explicitly contradicts:**
- **Round 13 Q1 condition 4, third bullet** ("The Linux deletion stays on the normal verdict"). Linux now uses the value-based exit that windows already has.

It is the return path that **Round 16 Q2 condition 3(c) and (d)** named: a name not marked `flips` turned GREEN on the 13 tree, and linux S5/short was GREEN with no `flips` name. It follows **Round 15 Q1 condition 4**: 67 marks a name from its evidence when it is RED in fewer than all matching runs, here 9 of 10 on the 13 tree. Windows `S5/short` stays `unstable` under Round 13, unchanged. No third `unstable` key is added, so Round 13 Q1 condition 3 stands.

Binding conditions:
1. **The list edit (in 67, before it merges).** Linux `"S5/short": { "owners": { "30": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] }`. METRICS records the rate per tree: 0 GREEN of 37 before 13, 1 of 10 on the 13 tree (42436186573, 39.53, trend false).
2. **Ticket 30's linux exit (Acceptance).** The name, and with it the entry, is removed only when every one of ≥ 10 fresh matching linux CI runs on 30's tree has `growth:mcp-bridge` ≤ 5 %/1k, whatever the trend flag says, and every other S5 check is GREEN. A GREEN at 39 %/1k is a missed trend, not a fix. Today the flag would meet a GREEN-based exit by chance in about 1 of 47 runs.
3. **Wrong-owner watch (orchestrator, because the ratchet cannot see it).** For every linux S5/short run that is GREEN before 30 merges, the orchestrator records the value and the window medians in 30's Comments. Any value ≤ 5 %/1k before 30's fix lands (for example after 36's semi-space flag) comes back as an ownership question with the run id. This is the linux counterpart of Round 13 Q1 condition 1's "≤ 5 fails".
4. **Nothing else changes:** the 5 %/1k budget, `growth()`, `MEMORY.growth`, the windows band and bound 30, and the other S5 checks.

**Rationale:** The value is 8× over budget in every run on both trees. Only the net-rise branch of the trend flag fell short once (correction 5). The flip mark is no looser than today's listing: an owned RED already passes at any value, and the mark only adds a GREEN pass. It is a list edit inside the open ticket that owns list edits, so it costs no new mechanism. The value-based exit closes the one hole the mark opens, an exit met by trend noise. The watch closes the other, a fix landing under the wrong owner.

**Charter:** C1 (bridge growth stays owned and its exit is honest), C7 (linux brought to the windows exit rule), C9 (stronger evidence: 47 runs; smaller blast radius and simpler: one list mark rather than a third `unstable` key), §9, Round 13 Q1 conditions 1 and 4, Round 15 Q1 conditions 4 and 5, Round 16 Q1 condition 4 (orchestrator record), Round 16 Q2 condition 3.

**REVERSIBILITY:** Two-way door (one list mark, ticket text). ADR: no.

---

## Q3 — windows S1/short `growth:proxy` RED (unlisted key, 1 of 8)

**DECISION:** REJECTED, all three routes; the key stays unlisted:
- **Rejected: 19 as owner.** 19's loop line names only `S1/burst4/16/32/bigbody`.
- **Rejected: 21 as owner.** 21's acceptance has no loop growth line at all. A trace to either ticket would be invented (Round 15 Q1 conditions 2 and 6).
- **Rejected: a needs-triage listing.** This is the path Round 6 Q2 condition 1 permits. It is not taken, because with `owners` and `flips` it would tolerate `growth:proxy` at any value on the primary platform's main proxy-growth check.

Decision: windows `S1/short` is judged on **5 sequential repetitions** (measurement-rule amendment, in ticket 71). The 5 %/1k budget, `growth()` and Round 7 Q1's commit gate are unchanged.

**No earlier decision is contradicted.** Round 6 Q1 condition 6 and Round 6 Q2 condition 3 require "its own decision with its own distribution"; this is that decision, on the 49-run distribution. **It departs from the `REPEATED` comment "One n for both legs"**: this key is windows-only, because Linux shows no tail (70 runs, max 4.43).

Binding conditions:
1. **The rule (exact shape is the implementer's choice, in `REPEATED`, one place):**
   - windows `S1/short` runs n = 5 fresh, isolated repetitions, one after another;
   - `growth:proxy` is RED when ≥ 3 of 5 repetitions are RED under the unchanged `growth()` (commit value > 5 AND trend); the reported value is the median;
   - **every** repetition must be ≤ 10 %/1k on commit (a ceiling: 4.73 above the observed max, z = 7.1);
   - every other S1/short check (`procPeak`, `steady`, `count`, `orphans`, `commit-backstop`) is judged in **each** repetition, and a RED in any one fails;
   - `summary.json` and the job summary print all five values, trends and the median.

   Linux `S1/short` stays a single run.
2. **Why n = 5.** It is the smallest odd n whose predicted false-RED rate is ≤ 1 % on the less favourable fit (log-normal p = 0.078: n = 3 → 1.73 %, n = 5 → 0.42 %; empirical 2/49: 0.06 %; at the 95 % upper bound p = 0.14: 2.2 %). The bar is stricter than Round 6 Q1's 5 % because the job's false-RED rate is the sum over its keys. It costs about 18 min on a 42-min windows job, against a 150-min timeout.
3. **Tests, RED first:**
   - five fixture repetitions with 2 RED pass;
   - 3 RED fail;
   - one repetition at 10.1 %/1k fails with a GREEN median;
   - one repetition with `steady` RED fails;
   - a missing repetition is a harness failure;
   - the S1/burst1 cases are unchanged.
4. **Records.** Spec §18 S1 row gains the rule. METRICS gets the 49-run windows table and the 70-run Linux range. Tickets 20 and 61 gain a Comments line: their "S1 stays GREEN / does not regress" criteria are judged under this rule on windows. RUNLOG records correction 1. **No revert is owed for 42382114395:** this round attributes it to the pre-existing tail on unchanged code.

**Rationale:** Two REDs in 49 runs, on a variant whose WS growth is about zero and whose Linux twin never exceeds 4.43, describe a commit-noise tail around a mean of 3.4 against a 5 budget. They do not describe a defect that any queued ticket fixes. The Round 6 Q1 repetition rule is the measured, budget-preserving answer to exactly this shape. Its ceiling and per-repetition hard checks keep it stricter than today on everything except the tail itself. Owning the RED instead would invent a trace or tolerate unbounded growth.

**Charter:** C1 (proxy growth stays gated at 5 %/1k, with a ceiling it lacks today), C7 (windows fixed, Linux unchanged), C9 (stronger measured evidence: 49 + 70 runs; smaller blast radius: one key on one leg), §9, Round 6 Q1 conditions 2–6, Round 6 Q2 conditions 1 and 3, Round 7 Q1 condition 1, Round 15 Q1 conditions 2 and 6, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (test code and spec text). ADR: no.

---

## Q4 — ticket 03's floor test: "no-op hook charged 2.55 MB" (1 of 16 windows legs)

**DECISION:** REJECTED in part. Neither (a) nor (b) is taken as stated. The 2.5 MB floor threshold and the 5 MB waiter gate are unchanged. The floor test becomes **n fresh-host repetitions with two clauses**:
- the **median** no-op cost is < 2.5 MB;
- **every** repetition is < 5 MB;
- every value is printed, pass or fail.

n is set in ticket 71 from measured data. The finding goes to ticket 35, where the gate becomes live.

Why each option is rejected:
- **(a), "like the burst1 median rule", is wrong as stated.** Burst1's median is the gate's own statistic. The waiter gate stays one measurement per host, so a median-only floor would claim a noise floor the gate does not have. The every-repetition < 5 clause is what ties the test to the gate: no single no-op measurement may reach it.
- **(b) has no defined goal.** Ticket 03 already removed the two known baseline errors (stdin reader, post-GC baseline; floor 4.9 → 0.63–0.75 MB on Linux). Nothing on record shows that a deterministic subtraction of windows commit exists.

Binding conditions:
1. **n from data (Round 6 Q1 condition 2's method).** 71 first records ≥ 20 no-op measurements on windows CI and ≥ 20 on Linux CI, through an off-by-default mode, with the values in METRICS. n is the smallest odd number in {3, 5, 7, 9} whose predicted false-fail rate (binomial on the measured fraction above 2.5 MB, less favourable leg) is ≤ 1 %. If none reaches it, or any no-op measurement is ≥ 5 MB, it comes back with the numbers. Nobody raises 2.5.
2. **Ticket 35 gains an Acceptance line:** "Windows waiter gate (Round 17 Q4): before removing `omp:concurrent-preflights`, record every waiter's commit and WS cost over ≥ 10 windows runs beside ticket 71's windows no-op floor distribution. If any waiter exceeds 5 MB on commit, or the floor's maximum plus the waiter's measured cost leaves no margin, it comes back with the numbers. A commit-only RED follows Round 6 Q2 condition 1, and the 5 MB gate is never loosened." Edge **35 ← 71**.
3. **Ticket 03's Comments** gain one line: the floor finding (2.55 MB, run 42436440284) was brought back as its text required, and was decided in Round 17 Q4.

**Rationale:** The floor test did its job: it found that the windows commit floor reaches the half-gate in about 1 of 16 runs. Linux waiters cost 3.3–4.1 MB, so that matters for ticket 35, not for ticket 03. A single-sample assertion cannot measure a tail. n samples with a median clause and a gate clause measure both the typical floor and the gate-relevant tail, and keep both thresholds. Sending the number to 35 puts it where a false waiter RED would otherwise appear later.

**Charter:** C9 (stronger evidence: measure before fixing n; simpler: no undefined "deterministic" ticket), C7 (windows evidence drives the windows gate), §9 / ADR-0013 condition 4 (5 MB per host unchanged), Round 6 Q1 condition 2, Round 6 Q2 condition 1, ticket 03 decision 8.

**REVERSIBILITY:** Two-way door (one test and ticket text). ADR: no.

---

## Cross-question conditions (binding for Q1–Q4)

1. **New ticket 71**, "Measurement rules for three rare tails: S7 retained heap, windows S1/short repetitions, the OMP no-op floor":
   - `Status: ready-for-agent`, Model sol, Risk low, ADR no, **blocked by 67**;
   - content: Q1 conditions 1–4, Q3 conditions 1–4, Q4 condition 1;
   - INDEX.md gains its row, and row 35 gains blocker 71.

   It is one ticket, not three. Three tickets would each need a pre-merge run exposed to the other two tails; one tree lets a single run confirm all three. 71's pre-merge run confirms, it does not decide. Any of the three signatures there is a disagreement and comes back. Acyclicity: 67 has no blockers, and 71's descendants (35, then 37 and 55) do not include 67.
2. **Interim until the fix lands** (71 for the signatures from Q1, Q3 and Q4; 67 for Q2's). A staged or post-merge run whose **only** failures match one of the signatures below does not count against the ticket, does not block its merge, and causes no revert. The condition: the ticket's diff does not touch the code that signature executes. Each occurrence is recorded in 71's Comments (or 30's, for S5) with the run id and values. The signatures:
   - (i) S7/short `responses-store:heap-at-cap` RED, either leg, value ≤ 128 MB, every other S7 check as listed. Ineligible: `zcode-proxy-src/**`, `s7-disk.mjs`, `proxy-session.mjs`;
   - (ii) windows S1/short RED only on commit on `growth:proxy` alone, ≤ 10 %/1k. Ineligible: `zcode-proxy-src/**`, `s1-proxy-steady.mjs`;
   - (iii) the floor test failing with a no-op cost < 5 MB. Ineligible: `fixtures/omp-host.ts`, `lib/omp-host.mjs`, the generated OMP extension;
   - (iv) linux S5/short "GREEN but listed" with `growth:mcp-bridge` > 5 %/1k and every other S5 check GREEN. Ineligible: `mcp/**`, `s5-mcp.mjs`.

   For every signature, a change to `tests/memory/lib/{verdict,budgets,sampler*}.mjs` or to the Bun pin also makes a ticket ineligible.

   **This explicitly departs from:**
   - Round 13 Q1 condition 6, which had a ticket in this position restaged after the fix;
   - Round 6 Q2 condition 4's last bullet and PROMPT §7 Phase 4's revert rule, for these four signatures only.

   It is not a rerun-until-green, because nothing is rerun: each cause is decided here and owned by a named ticket, and the exception ends when that ticket merges. A ticket whose diff touches the measured code gets no exception, so the code that could cause a real regression is never covered.
3. **67's merge gate (amends Round 16 Q2 condition 2).** Runs 42436010878 and 42436354758 count as valid floor runs. Their only ratchet failures are signatures (i) and (ii), which are excluded from the replay judgement. Run 42436186573 passes the replay with Q2's mark. 67's final pre-merge run falls under condition 2. The test-kit failure `manager-safety.test.mjs:160` is ticket 70's and is not decided here.

---

## Shared understanding

Open branches I still see (none blocks 67 or 71):
- **Ticket 70's stop flake still blocks merges** at an unknown rate (1 of 16 windows test-kit legs here). Condition 2 does not cover it; it needs 70's RED-first evidence.
- **The short-profile S7 check cannot tell an unbounded store from a bounded one** (1,500 × 64 KB = 93.75 MiB against 96 MB; correction 3). The long profile can. Raising the short load could push S7's `procPeak:proxy` (WS 217 of 250 on windows) into a new tail. It comes back as its own question if the orchestrator wants it fixed before the Phase 6 long-profile run.
- **Windows S1/short commit growth (mean 3.4 %/1k) while WS is about 0** is not attributed (allocator commit vs heap). Q3 needs no attribution. If ticket 19 or 20 moves the commit mean toward 5, the 5-repetition rule will show it as more repetitions RED, and the numbers come back.
- **Linux S5/short has no value ceiling** under its owned listing, as before Q2. A bridge regression from 42 to 100 %/1k would pass until ticket 30.
- **Integration-run memory legs went unchecked once** (42382114395, correction 1). The orchestrator should read the memory ratchet line of every post-merge run, as Phase 4 requires.
- **The job's aggregate false-RED rate** is the sum over its keys. The largest remaining predicted term is S1/burst1 at about 3.8 % per Linux run (Round 11). If it starts blocking merges, it comes back with its distribution.
