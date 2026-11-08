# Owner Proxy round 15 — answers (ticket 67's ownership questions A–F and the S3 evidence floor)

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–14 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only:
- `ticket/67-owned-checks` at 6b9438c (`git -C /home/AgentKit/wt/t67 show HEAD:…`): `issues/67-*.md` (Round 14 text, implementer report, questions A–F), `METRICS.md` lines 329–408 ("RED check sets per listed single run, both legs"), `tests/memory/lib/budgets.mjs`, `tests/memory/scenarios/s2-captcha.mjs:90-130` (what `procPeak:scenario`, `growth:scenario` and `solver:cost-per-generation` measure), `tests/memory/scenarios/s3-concurrency.mjs:17-23, 108-112, 357-407` (both S3/short and S3/hung run the kill-holder round; only S3/hung runs the stale-lock round).
- `/home/AgentKit/overhaul-tools/ci-art/t67-logs/parsed.json`: I recounted every RED set per key and leg over the matching runs METRICS.md lists (13 linux, 21 windows, 5 + 5 for S3/short and S3/hung). Every count in the round matches. Log 42421424292-linux.log lines 419–436 (S2 values).
- Ticket files on the integration tree 9441486 (identical to the t67 branch for every ticket named): 15, 16, 17, 25, 27, 28, 33, 34, 35, 36, 37, 55, 58, `INDEX.md`, and ticket 01's notes item 10.
- DECISIONS.md Round 3 Q8, Round 7 Q4, Rounds 9, 13 and 14 in full. `config/template.ts:89` (the template writes `deviceMid: ""`).

**Corrections to the round's facts.**
1. **Two more open tickets claim S3 checks than the round names.** Ticket 15's AC: "S3 starter-preflight role peak ≤ 76 MB (loop)". Ticket 36's AC: "Loop: S3 bridge role peak ≤ 75 MB (baseline 86)". So `procPeak:preflight` and `procPeak:mcp-bridge` each have two claimants, with 37's "every role peak within target". Condition 2 below settles that.
2. **Round 7 Q4 condition 1 was never applied to ticket 16.** It moved 16's window-closing proof "out of the Comments into Acceptance" (a kill injected at each point between spawn and the complete record, and a forced probe timeout, on windows-latest; plus "S3/hung windows shows 0 orphans before 16 deletes S3/hung"). 16's Acceptance on the tree has neither. Its Comments hold only a one-line summary of the decision. Fact F rests on that gap.
3. **The 16/17 Comments behind fact B are measured findings, not owner text.** The 2026-11-06 line "the windows memory leg must show 0 orphans in S3" appears word for word in both 16 and 17 ("from ticket 02 round 4 Windows evidence"). The binding texts are Round 7 Q4 conditions 1 and 4.
4. **Ticket 35's Comments disclaim the S3/omp role peaks** ("if these two stay RED after the fix, ticket 35 cannot delete `S3/omp (linux)` and comes back with the numbers"). They cannot be the trace that recommendation D gives them.
5. **The recommendation's "the entry disappears when the run is GREEN" flakes as soon as one owner lands.** Recounted from parsed.json:
   - linux S3/omp is RED on `omp:concurrent-preflights` alone in 6 of 13 runs;
   - windows S3/omp is RED on it alone in 19 of 21;
   - windows S3/hung has no `orphans` and no `peak:kit` in 1 of 5.

   So after 35 (or after 16 and 17) lands, the entry is GREEN in ~46 %, ~90 % and ~80 % of runs. 37's flipping names stay RED in the rest. Under "GREEN but listed fails", every such run fails, whether the entry is kept or deleted. That is the random merge block that Round 9 and Round 13 refused. Round 14's Shared understanding (third bullet) said this branch would come back with its distribution. This is that distribution.
6. **The local runs do not match CI on the checks that flip.**
   - linux S3/hung `procPeak:preflight`: 4/5 in CI, 0/8 local.
   - linux S3/short `procPeak:preflight`: 1/5 in CI, 0/8 local. `procPeak:proxy`: 2/5 in CI, 0/8 local. `exactly-one-proxy-after-round`: 1/5 in CI, 0/8 local.

   Relevant to Q2.
7. Minor record drift: `INDEX.md` row 37 lists blockers 15, 35, 36 without 17 (Round 7 Q4 condition 4; 37's file has it). Row 65 says `ready-for-agent`, but the file says `resolved`. 69's merge (9441486) does not reset the matching runs. The memory-loop template writes `deviceMid: ""`, whose path 69 keeps byte-identical (Round 14 Q2 condition 3).

---

## Q1 — REDs on a listed key that belong to another ticket than the entry's owner

**DECISION:** ACCEPTED with conditions: per-check owners, one owner per check. Parts are REJECTED:
- (i) A's conditional / needs-triage route: I decide it, 58 owns both checks by an AC amendment;
- (ii) E's never-RED early-log name for 34;
- (iii) F's "or a measured finding";
- (iv) D's trace through 35's Comments;
- (v) the implementer's placement of windows S3/hung `orphans` under 16: it goes to 17;
- (vi) "the entry disappears when the run is GREEN" without a rule for flipping names.

No new ticket. No new edge.

**This explicitly contradicts:**
- **Round 14 Q1 condition 1** (one `ticket` per entry with one `owns`): an entry now carries owners per check.
- **Round 14 Q1 condition 2, fourth bullet**, and **Round 3 Q8** ("fails … on a listed scenario that turns GREEN"): these no longer apply to an entry that still lists a recorded flipping name (condition 4).
- **Round 14 Q1 condition 3(b)** ("the owner ticket's text"): each name is traced to its own owner's text.
- **Round 7 Q4 condition 1**, loop part only: the windows S3 `orphans` proof moves from 16 to 17. 16 keeps the seam proofs.

In each case this round is the return path that the earlier decision named ("comes back to the Owner Proxy as an ownership question", Round 14 condition 3 Rule and Shared understanding). It is not a silent extension.

Binding conditions:

1. **Schema (one shape, one place, the implementer's choice).** Every listed single-run entry that is not `unstable` maps owner ticket → check names, for example `{ "owners": { "16": [...], "37": [...] }, "flips": [...] }`. Single-owner entries use the same shape. Schema errors:
   - Round 14's list (plain string or number, empty list, duplicate, non-string);
   - a name under two owners in one entry;
   - an owner with an empty list;
   - an empty owners map;
   - an owner id with no issue file (Round 3 Q8 condition 2);
   - a `flips` name that is not an owned name;
   - owners or flips on a repeated key or either `unstable` key (Round 9 and Round 13 unchanged).
2. **Who owns a check.** Each name has exactly one owner, traced in 67's Comments:
   - **Single claimant.** A check named by one open ticket's AC or What-to-build, or by a binding Owner Proxy decision for that ticket (condition 6), belongs to that ticket.
   - **Several claimants.** The owner is the claimant that every other claimant blocks: its descendant on the blocking graph, which is the ticket whose criterion must hold for the entry to go. The other claimants' own criteria still bind them on their own evidence. If no claimant is a descendant of the others, the check comes back as a question.
   - **No claimant.** The check comes back as a question, or the Owner Proxy assigns it by amending a ticket's AC (A, below).
3. **The owners, per key and leg** (n = RED runs of matching runs; † = recorded as flipping, condition 4):

   | key | leg | owner → names | trace |
   |---|---|---|---|
   | S2/short | both | **58** → solver:cost-per-generation, solver:retained-before-recycle, procPeak:scenario, growth:scenario† (L 11/13, W 12/21), procPeak:solver† (0 RED) | 58 AC "Loop S2: per-generation cost ≤ 300 MB, retained before recycle ≤ 300 MB", amended (below) |
   | S2/short | both | **25** → cdn-cache:memory-growth | 25 AC "Loop S2: CDN memory ≤ 64 MB … stays until 58" |
   | S3/short | linux | **16** → failed-launches, stale-lock-after-round, exactly-one-proxy-after-round† (1/5); **37** → peak:kit, procPeak:launcher, procPeak:mcp-bridge, procPeak:preflight† (1/5), procPeak:proxy† (2/5) | 16 AC "Loop: S3 killed-holder round → 0 failed launches, 0 stale locks, exactly 1 proxy" (S3/short runs that round); 37 AC "Loop S3 Linux … summed-RSS ≤ 596 MB and every role peak within target", the descendant of the other claimants 15 and 36 |
   | S3/short | windows | **16** → failed-launches, stale-lock-after-round, exactly-one-proxy-after-round† (2/5); **17** → orphans† (3/5); **37** → peak:kit | as above; 17 What-to-build "Every child is reaped on stop/restart/crash/update" and Round 7 Q4 condition 4 (17 lands first "so the Windows S3/short entry can clear"); 37 AC "Loop S3 Windows" |
   | S3/hung | linux | **16** → failed-launches, stale-lock-after-round, exactly-one-proxy-after-round† (0/5), start-over-stale-lock† (0/5); **37** → peak:kit, procPeak:launcher, procPeak:mcp-bridge, procPeak:preflight† (4/5), procPeak:proxy† (2/5) | 16 AC as above; 16 What-to-build "Takeover only on proof (holder dead …)" for start-over-stale-lock; 37 as above |
   | S3/hung | windows | **16** → failed-launches, stale-lock-after-round, exactly-one-proxy-after-round† (1/5), start-over-stale-lock† (1/5); **17** → orphans† (4/5); **37** → peak:kit† (1/5) | as above; orphans: claimants 16 (Round 7 Q4 condition 1) and 17 (What-to-build); 17 descends from 16 |
   | S3/omp | linux | **35** → omp:concurrent-preflights; **37** → procPeak:proxy† (4/13), procPeak:preflight† (4/13) | 35 AC "Seam 1 (S3 omp leg): ≤ 1 concurrent preflight"; 37 AC "Loop S3 Linux … every role peak" (not 35's Comments) |
   | S3/omp | windows | **35** → omp:concurrent-preflights; **37** → peak:kit† (2/21) | 37 AC "Loop S3 Windows" |
   | S7/short | both | **33** → proxy.log:bounded-while-running | 33 AC "Loop S7: `proxy.log` ≤ 6 MB while running" |
   | S1/*, S1/stalled, S4/short, linux S5/short | as committed | unchanged single owners and names. Marked †: linux S4 unstoppable-proxy-after-ctrl-c (1/13); windows S4 proxy-left-after-stop and failed-lifecycle-steps (1/21) | 67's table |

   **A, decided.** In S2, `procPeak:scenario` and `growth:scenario` measure the same solver defect, not a different one. Example: 1061.5 MB host peak = base ≈ 37 MB + 1024.3 MB per-generation cost (run 42421424292). `growth:scenario` is phase A's host growth under heavy solves with production recycling, which 58's recycle triggers change. 58's Comments already record its flip.

   58's "Loop S2" AC gains three bounds:
   - `procPeak:scenario` ≤ 600 MB (ticket 01 note 10);
   - `growth:scenario` ≤ 5 %/1k (§18 S1–S5 growth row);
   - `procPeak:solver` ≤ 300 MB (§18 S2 row, the cap; 58's footprint recycle at 240 MB).

   The last bound is listed now, at 0 RED, under Round 14 3(b). Ticket 27 makes the solver a child, which turns this check RED until 28 and 58. Without the listing, 27's pre-merge run would bring back a question whose answer is already known. 27 and 28 are claimants that 58 descends from. 27's own S2 criteria (solver counts, cold start) stay 27's own and are not listed.

   **E, decided.** 34 owns nothing. Its early-log check was never RED in 34 runs. A name that is never RED and stays on a non-flipping entry would force 33's commit to delete 34's name, which breaks condition 5.
4. **GREEN while listed (replaces "the entry disappears when the run is GREEN").**
   - A listed entry whose run is GREEN **passes** only while at least one of its names is marked `flips`. It prints `<key>: GREEN, listed for ticket(s) <t…> on flipping checks <names> (Round 15 Q1)` in the job summary and report rows.
   - An entry with no `flips` name that is GREEN **fails** as today (Round 3 Q8).
   - **How a name is marked.** A name is marked only by 67, from its ≥ 10-run evidence: it was RED in fewer than all matching runs of that leg. That includes owner-named names never seen RED.
   - A mark is never added later. It goes when its name goes.

   Everything else in Round 14 condition 2 stands:
   - owned RED passes;
   - any RED name not owned fails;
   - RED with no name fails;
   - harness failure fails;
   - a name the run does not produce fails.

   The unowned message names every owner: `<key>: RED on <check>, not owned by tickets <t…> (<os>, Round 14 Q1, Round 15 Q1); the RED comes back as an ownership question, do not edit owners`. Passing rows print `RED on <checks>, owned by ticket <t> (<names>), ticket <u> (<names>)`.
5. **The list only shrinks, per owner (Round 14 condition 4, per name).**
   - **Who removes a name.** Only the owner's own commit removes its names, with evidence. For a name RED in every matching run, that evidence is the owner's recorded loop runs plus its pre-merge CI run GREEN on that check on that leg. A `flips` name needs ≥ 10 GREEN matching CI runs of that leg on the owner's tree (Q2's counting).
   - **Entry deletion.** The commit that removes an entry's last name deletes the entry.
   - **What no one does.** No run, job or other ticket edits another owner's names. A later RED of a removed name is an unowned RED: a question, never a re-add (Round 6 Q2 condition 3, Round 8 condition 4, PROMPT §7 Phase 4).
   - **Merge check.** A ticket's evidence lists each name it owns with its status. A name its fix should clear but that stays RED comes back with numbers. Budgets are never loosened.
6. **F: Comments as owner text.**
   - **What counts.** A Comments line counts only when it records a binding Owner Proxy decision (round and question named) that states the criterion for that ticket. The orchestrator then moves the criterion into that ticket's Acceptance in the same change, as Round 7 Q4 ordered.
   - **What does not count.** A Comments line that records only a measured finding (orchestrator or implementer) does **not** count. A finding cannot assign ownership. That is the silent-adoption path Round 14 rejected.
   - **Applied to windows S3/hung orphans.** The 16 line is a finding. Round 7 Q4 condition 1 is binding. Under condition 2 the check goes to 17, the descendant claimant, which avoids a stall: 17 is blocked by 16, so 16 must not need a reap that only 17 delivers.
   - **Overdue edit.** 16's Acceptance now gains Round 7 Q4 condition 1's seam proofs (windows-latest: a kill at each point between spawn and the complete record, and a forced probe timeout, each ending with the proxy stoppable or adopted).
7. **Ticket text the orchestrator applies before 67 merges.** Each change goes in the ticket's Acceptance, with a Comments line naming this round:
   - 16: "Delete `S3/hung` (linux, windows)" becomes "remove 16's names from `S3/short` and `S3/hung` (both legs)". Plus condition 6's seam proofs.
   - 17: gains "Loop S3 (windows): 0 orphans after the scenario's stop in `S3/short` and `S3/hung`; remove 17's names". "Delete `S4/short`" stays.
   - 25: gains "remove `cdn-cache:memory-growth` from `S2/short`".
   - 58: gains condition 3's three bounds. "Delete `S2/short`" becomes "remove 58's names".
   - 33: "The `S7/short` entry stays until 34" becomes "remove `proxy.log:bounded-while-running` from `S7/short`".
   - 34: "Delete `S7/short`" is struck. 34 owns no name.
   - 35: "Delete `S3/omp`" becomes "remove `omp:concurrent-preflights`". Its 2026-11-07 "comes back with the numbers" line is superseded: the role peaks are 37's.
   - 37: gains "remove 37's names from `S3/short`, `S3/hung`, `S3/omp` (both legs)".
   - 15 and 36: a Comments line saying their S3 role-peak criteria bind on their own evidence, while 37 holds the names.

   The rule "the commit that removes the last name deletes the entry" covers every "Delete" line that remains.
8. **Tests (RED first; Round 14 condition 5 extends):**
   - two-owner entry: each owner's RED passes, and an unowned RED fails naming both owners;
   - a name under two owners is a schema error;
   - an empty owner list is a schema error;
   - an unknown owner id is a schema error;
   - `flips` on a non-owned name is a schema error;
   - GREEN with a `flips` name passes and prints its line;
   - GREEN with no `flips` name fails;
   - a stale name still fails;
   - one real-list case per leg;
   - every Round 9, 13 and 14 case stays unchanged.

   67's pre-merge run confirms, it does not decide. On disagreement the numbers come back, and nobody widens an owner list.
9. **Edges.** None new:
   - 55's guard and its existing blockers cover every owner (25 through 58, 33 through 34, 35 and 37; 16 and 17 directly);
   - 15 and 36 hold no names;
   - no owner needs another owner first, because each removes only its own names.
10. **Records.**
    - RUNLOG records the deviations above, naming this round.
    - METRICS.md marks the `flips` names with their rates.
    - Spec §18 (or wherever the ratchet rule is stated) gains the owners and flips rule as a measurement-rule amendment.
    - Every budget, ceiling, n, `growth()`, Round 7 Q1's metric split, the two `unstable` bounds and the set of listed keys are unchanged.

**Rationale:** Per-check owners are the only form that keeps Round 14's two goals at once. Every tolerated RED stays attributable to a line of an open ticket's text, and every RED that no ticket claims still fails. A single owner per entry cannot do both. 16 cannot clear memory checks, 37 cannot clear lock checks, and Round 7 Q4 already had to add an edge to get around that.

The descendant rule gives one owner per check without adding edges. It also puts each check on the ticket whose criterion has to hold when the entry goes. It also removes a real stall: 16 being held on a Windows orphan that only 17's reap or adoption can clear.

A is the solver defect seen from the host process, with the numbers to show it. So it gets an owner now, not a triage ticket.

The flip rule rests on the recount. After one owner lands, the strict "GREEN but listed" rule fails roughly every second linux S3/omp run and most windows S3/omp and S3/hung runs, whatever is done with the entry. Tolerating GREEN only while a measured flipping name remains keeps Round 3 Q8's protection on every deterministic entry (all of S1, S5, most of S4) and relaxes it only where the evidence shows flips. It masks nothing beyond the owners' own names. The ≥ 10-run removal floor stops a premature removal from turning into random merge blocks later.

**Charter:** C1 (orphan, single-proxy, lock and ceiling checks stay enforced, now with an owner each), C7 (per-leg owners; the Windows orphan placed where it can be cleared), C9 (stronger measured evidence: the recounted RED sets and flip rates; smaller blast radius: one list shape, no new ticket or edge; simpler than a triage round for A), §9 (no budget touched; the removal floor only tightens), Round 3 Q8 conditions 1–3, Round 6 Q2 condition 3, Round 7 Q4 conditions 1–4, Round 8 condition 4, Round 9 Q1 conditions 1 and 3, Round 13 Q1 conditions 1, 3 and 7, Round 14 Q1 conditions 1–7 and its Shared understanding, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (test code, list shape, ticket text). ADR: no.

---

## Q2 — the 10-run floor for S3/short and S3/hung

**DECISION:** REJECTED in part.
- **Accepted:** ticket 67 stays unmerged until S3/short and S3/hung each have ≥ 10 matching runs per leg. Every other key is already over the floor (13 linux, 21 windows), and 67 lands in one merge.
- **Rejected:** counting the 8 local Linux runs toward the Linux floor. Also rejected: making 67 wait on "the next five pre-merge runs of other tickets".

Binding conditions:
1. **Only CI runs of the leg's full short profile count** (Round 14 condition 3(a) as written). The local runs stay in METRICS.md as a labelled supplement. They are never counted.
2. **Where the 5 more runs per leg come from.**
   - First, any pre-merge staging run of another ticket that already exists or happens anyway, and whose tree matches S3's executed code under METRICS.md's matching rule (scenario, `verdict.mjs`, `budgets.mjs`, and no change to the lifecycle, manager, launcher, preflight or bridge paths).
   - Otherwise, the orchestrator runs the job on 67's branch (or staging/67) until both legs have 10, as Round 14 condition 3(a) ordered for exactly this case. One CI run covers both legs, so five runs close both floors.
   - Do not wait for other tickets. If a ticket that changes S3's path (15, 16, 13, 36, …) merges first, the count restarts on the new tree.
3. **Branch preparation.** 67's branch merges the integration tip (9441486, ticket 69) before those runs. 69 does not reset the 5 existing runs (correction 7). METRICS.md's matching rule records why.
4. **What the runs decide.**
   - They confirm Q1's S3 owners and set their `flips` marks from all ≥ 10 runs per leg.
   - Suppose a run shows a RED name that Q1 does not assign. That name comes back as a question with the run ids, and nobody folds it in. The other keys' owners stand.
   - A name in Q1's table that the 10 runs never show RED stays only if it is owner-named (Round 14 condition 3(b)), and it is marked `flips`.
5. **The same counting applies to Q1 condition 5's ≥ 10-run removal floor:** matching CI runs of that leg only.

**Rationale:** The floor exists to see a check that is RED in ≥ 26 % of runs with 95 % probability. Local runs fail that purpose on exactly the checks that need it. On this machine `procPeak:preflight` is 0/8 where CI shows 4/5 (S3/hung) and 1/5 (S3/short), and `procPeak:proxy` and `exactly-one-proxy-after-round` behave the same way on S3/short. Counting them would mark the wrong `flips` and understate rates.

Counting them also buys nothing. The windows floor needs five more CI runs either way, and each of those runs is a Linux run too.

Waiting on other tickets' pre-merge runs risks a reset whenever one of them touches S3's path. Round 14 already named the cheap fix: run the job on 67's branch. PROMPT §0 says wall-clock time does not matter.

**Charter:** C9 (stronger measured evidence: CI-matching runs, which differ measurably from local; then the simpler option: one merge after five runs), C7 (both legs, same floor), C1 (the floor protects the orphan, lock and peak checks the owners now gate), Round 14 Q1 condition 3(a), Round 7 Q4 (PROMPT §0 citation), PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (run scheduling; no code or budget). ADR: no.

---

## Shared understanding

Open branches I still see (none blocks 67 once Q2's runs are in):
- **37's windows criterion "a miss … the entry is re-pointed to that follow-up"** conflicts with Q1 condition 5 (no other ticket edits an owner's names). If 37 misses build-time gate 2, it comes back with numbers, and the Owner Proxy decides the follow-up's names then. Nothing is re-pointed silently.
- **15's and 36's own S3 role-peak criteria** (preflight ≤ 76, bridge ≤ 75) bind them on their own evidence while 37 holds the names. If either lands with its peak still RED, it comes back with numbers.
- **EVIDENCE MISSING: the mechanism of the windows S3 orphans in the matching runs.** The candidates are the start-time window (Round 7 Q4) and the suspended proxy left by a holder killed inside spawn (16 and 17 Comments, 2026-11-07). The job table shows only the count. Q1 gives the name to 17 whatever the mechanism. If 16 clears it first, 17 removes a GREEN name.
- **27's pre-merge run** will move solver memory out of `procPeak:scenario` and into `procPeak:solver`. Both are 58's names, so it should pass. Any other S2 RED it shows comes back as a question.
