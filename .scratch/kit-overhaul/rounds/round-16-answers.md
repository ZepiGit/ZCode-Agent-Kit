# Owner Proxy round 16 — answers (ticket 67 follow-ups G and H, ticket 37's windows clause)

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–15 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only:
- `ticket/67-owned-checks` at a097269 (`git -C /home/AgentKit/wt/t67 show HEAD:…`): `issues/67-*.md` (round 2 report, questions G and H), `METRICS.md` lines 329–377 ("owners and flips"), `tests/memory/verdict.test.mjs:1007-1035` (the real-list test), `tests/memory/lib/verdict.mjs:14,162` (`count:<role>` = more processes of a role than budgeted **at any one sample**).
- CI run 42425476318, windows: the job log in `/home/AgentKit/overhaul-tools/ci-art/t67-logs/logs/42425476318-windows.log:568-590`, and the S4/short `summary.json` from the run's `memory-budget-windows` artifact (id 13595619376, read in memory through `gh api`, nothing written).
- Integration tree 0b14839: DECISIONS.md Rounds 3 Q2, 7 Q2, 7 Q4, 14 and 15 in full; issues 13, 17, 23, 37; `spec.md` §18 PROCESSES and build-time gates; `tests/memory/scenarios/s3-concurrency.mjs:4`, `s4-lifecycle.mjs:1-160`; `tests/memory/lib/budgets.mjs:28`; `git diff f383d6b^1 f383d6b -- mcp/zcode-harness-mcp/package.json`.
- `gh run list --branch staging/67`: the 8 runs 42435825059 … 42436440284 are all `in_progress`. No result is known yet.

**Corrections to the round's facts.**
1. **G has a recorded mechanism, and it is 17's.** The S4/short summary of 42425476318 (`notes.sigintDuringStart`) shows it. The Ctrl-C at 150 ms into a `proxy start` left a surviving proxy whose pid record has no start time (`childSurvived: true`, `pidRecordStartedMs: null`). The next start exited 0 and spawned a second proxy instead of adopting the first (`nextStart: 0`, `proxiesAfter: 2`, `killedByHarness: 2`). It is the same event as that run's `unstoppable-proxy-after-ctrl-c` 1 of 8. The respawn storm shows `proxies: 1` at all six steps. The stale-lock respawn ends with `proxiesAfter: 0`. This is exactly the window in 17's Comments (2026-11-06) and Round 7 Q4 ("17 adopts pid records … left without a start time").
2. **Ticket 23 also names "exactly 1 proxy at every sample"** (AC "Loop: induced memory pressure → ≤ 3 restarts / 15 min and exactly 1 proxy at every sample"), and 23 is blocked by 17. Its loop line names no scenario key, though. The only loop phase close to it is S4's respawn storm, which was at 1 proxy throughout. So 23 is no claimant of this RED (Q1).
3. **H: "Before 13: 10 matching CI runs per leg" is 8 + 2.** METRICS.md's "10 runs per leg (with 65)" includes the two runs on the 13 tree (42425069025, 42429164758). The pre-13 count is 8. The answer does not change: 2 runs exist on the 13 tree, so 8 more are needed, which is what is in flight.
4. **13 changes more than S3.** The bridge's runtime dependencies change (`@modelcontextprotocol/sdk` ^1.30.0 → ^1.32.2, `zod` ^4.6.6 added). Every S3 variant holds a bridge session (`s3-concurrency.mjs:4`), so S3/omp is affected too. S5 runs the bridge (METRICS.md's own matching rule says so). Ticket 13's title says zod 4.6.6, the round says 4.6.7 (lockfile resolution); this does not matter for the decision.
5. **Q3: ticket 37's windows line also carries an overdue edit.** Round 7 Q2 condition 4 changed 37's windows criterion from "≤ 600 MB commit (≥ 30 % rule …)" to "≤ 514 MB commit". `budgets.mjs:28` has `windows: 514`, but 37's Acceptance still says 600. Round 7 Q2 condition 5 also names three levers for build-time gate 2: the lean resident launcher, the Bun bridge, and replacing the per-call PowerShell proofs. 37 still says "the two levers".
6. **The real-list test pins the opposite of Q1.** `verdict.test.mjs:1032` asserts that no entry owns `count:proxy`, and uses `count:proxy` as the one unowned RED on every key. Q1 makes that assertion false for windows S4/short.

---

## Q1 — G: windows S4/short `count:proxy` (two proxies at once) in 1 of 26 runs

**DECISION:** ACCEPTED with conditions. Owner **17**, windows only, marked `flips` (1/26). It is traced to 17's What-to-build "The next start adopts an orphaned proxy through the identity proof and never spawns a second one". 17's Acceptance gains the loop line. No new ticket, no new edge.

**This amends Round 15 Q1 condition 3**, the row "S1/*, S1/stalled, S4/short, linux S5/short | as committed | unchanged". Windows S4/short gains one name under 17. This is the return path Round 15 Q2 condition 4 named ("comes back as a question with the run ids"). It is not a silent fold-in. No other earlier decision is contradicted.

Binding conditions:
1. **Owner and trace.** `count:proxy` goes under owner 17 in the windows `S4/short` entry and joins that entry's `flips` list. 67's Comments cite:
   - the What-to-build line;
   - run 42425476318 with the `sigintDuringStart` record (correction 1), as the measured link to that line.

   Single claimant (Round 15 Q1 condition 2): 23's line is not about this phase (correction 2). 16 does not claim it either: 16's single-proxy name is S3's `exactly-one-proxy-after-round`. And even with 16 counted as a claimant, 17 descends from 16, so 17 owns it.
2. **Linux is not listed.** Linux `count:proxy` was 0/18 in S4/short. Listing a never-RED name would loosen the C1 single-proxy check with no evidence, and no planned change makes it RED. This is unlike Round 15's `procPeak:solver`, where ticket 27 makes it RED. A linux `count:proxy` RED stays unowned: it comes back as a question.
3. **17's Acceptance gains** (with a Comments line naming this round): "Loop S4, both legs: exactly 1 proxy at every sample (`count:proxy` ≤ 1), including after a Ctrl-C during start that leaves a proxy without a start-time record (windows run 42425476318, Round 16 Q1). On windows, `count:proxy` is one of 17's names in `S4/short`." "Delete `S4/short` (linux, windows)" stays. Round 15 Q1 condition 5 covers it: removing the flipping name needs ≥ 10 GREEN matching windows CI runs on 17's tree, which 17 already needs for `proxy-left-after-stop` and `failed-lifecycle-steps`.
4. **Attribution check while the name is tolerated.** For every S4/short `count:proxy` RED before 17 merges, on either leg, the orchestrator records in 17's Comments which phase of `summary.json` showed more than one proxy: `sigintDuringStart[].proxiesAfter`, `respawnStorm[].proxies`, `respawnWithStaleLock.proxiesAfter`, or none of these. If the phase is not the Ctrl-C/adoption phase (for example the respawn storm, which is 23's subject), that RED comes back as an ownership question with its run id, even though the ratchet passed it. The ratchet cannot see phases, so this record is what keeps the tolerance attributable.
5. **Test change in 67.** The real-list test (`verdict.test.mjs:1010-1035`) keeps its purpose: on every listed single run of both legs, one added unowned RED fails and names the owners. Per key it picks a name that the key's owners do not hold. That is `count:proxy` everywhere except windows S4/short, where it is, for example, `orphans`. It asserts `count:proxy` is owned only in windows S4/short. Every other existing case passes unchanged. The change is justified in 67's Comments (common acceptance: no pre-existing test change without justification).
6. **Records.** METRICS.md moves `count:proxy 1/26 (42425476318)` from "not owned" to `17 count:proxy 1/26 †` in the windows S4/short row. RUNLOG names this round.

**Rationale:** The RED is a second proxy, which C1 forbids outright. So the bar is attribution, not convenience. The artifact supplies it. The second proxy appeared exactly where a Ctrl-C left an unrecorded proxy and the next start spawned instead of adopting. That is 17's What-to-build line word for word, and the same event as 17's already-owned `unstoppable-proxy-after-ctrl-c`.

Leaving the name unowned would make a 1-in-26 event fail the ratchet at random. That is the random merge block Rounds 9, 13 and 15 refused, and it would teach nothing new, because the answer is already known. The cost of owning it is bounded:
- the name is windows-only;
- it is marked as flipping on measured evidence;
- it can only leave through 17's ≥ 10-GREEN-run removal;
- condition 4 sends any second proxy from a different phase back as a question.

The orchestrator's recommendation was right. It needed the mechanism (it rested only on the What-to-build line), the 23 check, the linux scope, and the test pin it collides with.

**Charter:** C1 (single proxy per installation: enforced, attributed to the ticket that fixes it, not masked), C7 (windows evidence, linux unchanged), C9 (stronger measured evidence: the per-phase record in `summary.json`; smaller blast radius: one name on one leg, one AC line, no edge), C2 (test change justified), Round 7 Q4, Round 14 Q1 condition 3(b), Round 15 Q1 conditions 2, 4, 5 and 6, Round 15 Q2 condition 4, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (one list name, one AC line, one test case). ADR: no.

---

## Q2 — H: does ticket 13's merge restart the S3 evidence floor?

**DECISION:** ACCEPTED with conditions. The floor restarts. It applies to every listed key whose executed code includes the MCP bridge, not only S3/short and S3/hung. The 8 runs in flight satisfy it. 67 merges only on a clean result. One term is defined below: what "a flip rate that contradicts a `flips` mark" means.

**No earlier decision is contradicted.** Round 15 Q2 condition 2 named 13 as a reset. Condition 4 below makes Round 15 Q2 condition 4 ("set their flips marks from all ≥ 10 runs per leg") precise for a restarted count. It departs, **for the `flips` marks only**, from a strict per-tree reading of Round 14 Q1 condition 3(a), and I say so here. The floor itself, which drives owners and unowned names, is strictly per-tree.

Binding conditions:
1. **Scope of the restart.** 13 changes the bridge's runtime dependencies, so the matching runs restart on the 13 tree for:
   - S3/short, S3/hung and S3/omp on both legs;
   - linux S5/short.

   Windows S5/short stays judged under Round 13's `unstable` bound, unchanged. The floor is ≥ 10 valid matching CI runs of the full short profile per leg on the 13 tree. Those are 42425069025 and 42429164758 plus the 8 in flight (42435825059 … 42436440284). The S1, S2, S4 and S7 counts are unaffected (correction 4). Q1's list edit and condition 5's test edit do not restart anything, because `expected-red.json`, `ratchet.mjs` and the tests are not in the matching rule.
2. **Merge gate.** 67 merges only if all of these hold:
   - each of the 8 runs is valid on both legs (the summary table printed, every key's row GREEN or RED);
   - each run passes the ratchet when its per-key RED sets are replayed through 67's **final** ratchet and list, including Q1's `count:proxy` (`t67-scripts/replay.mjs`). The runs started before Q1, so the list they executed lacks that name;
   - 67's pre-merge CI run on its final tip passes. It counts as one more run on the 13 tree.
3. **What comes back with run ids and numbers.** In each case: no rerun-until-green, and no edit to any owner list or `flips` mark in between (Round 6 Q2 condition 3, Round 8 condition 4).
   - **(a)** any RED name that no owner holds, on any key or leg;
   - **(b)** a harness failure or an invalid run. It does not count toward the floor, and it is reported;
   - **(c)** a name **not** marked `flips` that is GREEN in any run on the 13 tree. A new mark is a relaxation the committed evidence did not predict, and on these keys it may be 13's own effect: `procPeak:mcp-bridge` is RED 10/10 today;
   - **(d)** a listed entry that is GREEN with no `flips` name (linux S5/short in particular).
4. **What does not come back.** A name marked `flips` that is RED in every run on the 13 tree **keeps its mark**, as long as the pre-13 matching runs show it GREEN at least once. METRICS.md records each name's rate on both trees separately. The reason is sampling and the asymmetry of the two errors:
   - windows S3/hung `orphans` is 9/10 before 13, so it is RED in all 8 new runs with p ≈ 0.43;
   - linux S3/hung `procPeak:preflight` is 8/10, so p ≈ 0.17;
   - a dropped mark can never be re-added (Round 15 Q1 condition 4). Once the other owners land, it turns into random "GREEN but listed" failures;
   - a kept mark only lets a fully GREEN entry pass, and the job prints that visibly.
5. **What the runs settle.** On a clean result, the S3 owners of Round 15 Q1 condition 3 and Q1 above stand. The marks follow condition 4. The METRICS.md matching rule records the restart's scope (condition 1) and this round.

**Rationale:** Round 15 Q2 condition 2 already ruled that a merge changing S3's executed code restarts the count. 13 changes code the bridge loads at run time (the SDK and zod), and the bridge is sampled by S3 and S5. The byte-identical `dist/` does not make the dependencies identical. A restart is the rule, not a judgement call.

The scope follows the same reason. Restarting S3/short and S3/hung but not S3/omp and S5 would be inconsistent, and it costs nothing, because the same 8 runs cover every key on both legs.

The orchestrator's gate is right. It needed two things:
- **The replay against the final list.** Without it, a recurrence of G in the in-flight runs would block 67 on a name Q1 has already assigned.
- **A defined "contradiction".** As written, it would send back the most likely outcome (a 9/10 name going 10/10 by chance) as a question whose answer is already fixed by Round 15's rule and its asymmetry. The outcome that really carries information still comes back: a name going GREEN that has never gone GREEN before.

**Charter:** C9 (stronger measured evidence: CI runs on the tree 67 merges onto; then the simpler option: one set of 8 runs for every affected key), C1 (the floor protects the orphan, lock, single-proxy and peak checks the owners gate), C7 (both legs, same floor), §9 (no budget touched), Round 6 Q2 condition 3, Round 8 condition 4, Round 14 Q1 condition 3(a), Round 15 Q1 condition 4, Round 15 Q2 conditions 1, 2, 4 and 5, PROMPT §0 (wall-clock time does not matter), PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (run scheduling and evidence records; no code or budget). ADR: no.

---

## Q3 — ticket 37's windows acceptance line: "the entry is re-pointed to that follow-up"

**DECISION:** ACCEPTED with an addition. Replace the clause as recommended. In the same edit, apply Round 7 Q2 conditions 4 and 5, which were never applied to this line: ≤ 514 MB commit, and the three measured levers.

**No earlier decision is contradicted.** Round 7 Q2 conditions 4–5 and Round 15 Q1 condition 5 are applied. The superseded text is the original ticket wording, which no binding round chose.

Exact replacement for 37's Acceptance line "Loop S3 Windows: ≤ 600 MB commit (≥ 30 % rule if the baseline exceeded 600). GREEN → **delete `S3/short` (windows)**; a miss goes back to the owner with numbers for the two levers (build-time gate 2) and the entry is re-pointed to that follow-up.":

> - [ ] Loop S3 Windows: ≤ 514 MB commit (`peak:kit`; Round 7 Q2 condition 4). GREEN → **delete `S3/short` (windows)**. If 37 cannot reach the windows target, it comes back to the Owner Proxy with the numbers (build-time gate 2), including the measured levers: the lean resident launcher, the Bun bridge, and replacing the per-call PowerShell proofs (Round 3 Q2 condition 8, Round 7 Q2 condition 5). The names stay under 37 until then. No other ticket takes over or edits them (Round 15 Q1 condition 5).

Binding conditions:
1. 37's Comments gain one line naming this round. It names the overdue Round 7 Q2 edit, and it supersedes the 2026-11-08 line's "conflict" note.
2. The Linux line is unchanged. It has no re-point clause, and a Linux miss of build-time gate 1 already comes back with numbers (spec §18 build-time gates).
3. Nothing in `budgets.mjs` changes. It already holds 514 (§9: no loosening; this is text catching up with the code).

**Rationale:** "Re-pointed" would let a follow-up ticket inherit 37's names without 37's evidence. Round 15 Q1 condition 5 forbids exactly that: only an owner removes its own names, and nobody else edits them. The recommended text routes a miss the way every build-time gate already routes: back with numbers. The Owner Proxy then decides the follow-up's names in the open.

Correcting the number in the same edit avoids a second pass over the same line. It also removes a real ambiguity. "≤ 600 (≥ 30 % rule if the baseline exceeded 600)" resolves to 514 only for a reader who knows the 734.5 MB baseline, while the check that gates 37's windows `peak:kit` names already uses 514.

**Charter:** C9 (simpler: one routing rule for every gate; smaller blast radius: one line), C7 (the primary-platform target stated as enforced), §9 (budget text matches the tightened code, never loosened), Round 3 Q2 condition 8, Round 7 Q2 conditions 4 and 5, Round 15 Q1 condition 5 and Round 15's Shared understanding (first bullet), spec §18 build-time gates.

**REVERSIBILITY:** Two-way door (ticket text). ADR: no.

---

## Shared understanding

Open branches I still see (none blocks 67 once Q2's gate is met):
- **Ticket 23's loop line ("induced memory pressure … exactly 1 proxy at every sample") names no scenario key.** S4's respawn storm is the closest phase. If 23's evidence is taken from S4, its claim overlaps 17's windows `count:proxy`, and by Round 15's descendant rule the name would go to 23 (23 is blocked by 17). Nothing is reassigned now: no storm-phase RED exists. It comes back if Q1 condition 4 finds one, or when 23 states its loop key.
- **Windows S3 at ≤ 514 MB is probably out of reach of 37's mechanisms** (Round 7 Q2 condition 5: proxy plus five bridges already make 576 MB). The Q3 return path will likely be used. The levers are named. None is adopted now.
- **EVIDENCE MISSING: the mechanism of the windows S3 `orphans` in the matching runs** (carried over from Round 15). `summary.json` does record per-phase notes (as for S4 here). If the S3 artifacts carry similar notes, they can settle it without a new run.
- **Q2 condition 3(c) may fire** if 13's SDK/zod bump moves `procPeak:mcp-bridge` or linux S5/short `growth:mcp-bridge`. That would be a measured change by 13, decided then on its numbers.
