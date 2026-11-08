# 67: A plain expected-RED listing of a single-run key accepts any RED, not only its owner's checks

**Blocked by:** None

**Status:** ready-for-agent

Model: sol
Risk: medium
ADR: no

**What to build:** Raised in Owner Proxy round 13 (Shared understanding) and round 9 (condition 1 fixed it for repeated keys only). For a single-run key listed plainly (e.g. linux `S5/short → 30`, `S3/short → 37`), the ratchet accepts the run when its outcome is RED, whatever checks are RED. A new RED on a check the owner ticket does not own (an orphan, a second proxy, a ceiling) passes unnoticed. Triage: decide whether plain entries should name the checks they own (so any other RED fails), and how that interacts with entries whose RED set legitimately varies run to run.

**Acceptance criteria:**

- [ ] Triage decision recorded.

## Comments

- 2026-11-07 (orchestrator) Triage, Owner Proxy round 14 (binding; full text in DECISIONS.md Round 14):

## Q1 — Ticket 67: a plain expected-RED listing of a single-run key accepts any RED

**DECISION:** ACCEPTED with conditions; one part REJECTED. Role: **`ready-for-agent`**, Model sol, Risk medium, ADR no. Blocked by: none. New edge: **55 ← 67**.

Accepted: every plain listing of a single-run key names the checks it owns. A RED on any other check fails the ratchet. An owned check may be GREEN, and the entry is deleted only when the run is GREEN, as today.

Rejected: building `owns` as "the union of the RED checks seen in the last N runs" and nothing more. A union adopts every RED it has seen, including an orphan, a second proxy or a ceiling breach that belongs to a different defect. That turns today's silent pass into a silent recorded ownership. It also leaves N undefined.

Binding conditions:
1. **Schema.** A listed single-run key that is not `unstable` takes `{ "ticket": "<NN>", "owns": ["<check>", …] }`. The exact shape is the implementer's choice, in one place. These are schema errors:
   - a plain string or number for a single-run key;
   - an empty `owns`, a duplicate name, or a non-string name.
   Repeated keys keep Round 9 Q1 condition 1 (median only). The two `unstable` keys keep Round 9 Q1 and Round 13 Q1 unchanged. `owns` on either of those is a schema error.
2. **Ratchet rule** for a listed single-run entry with `owns`:
   - RED with every RED check in `owns` passes. The job summary row prints `<key>: RED on <checks>, owned by ticket <t>`, so what is tolerated stays visible.
   - RED on any check not in `owns` fails, with this message: `<key>: RED on <check>, not owned by ticket <t> (<os>, Round 14 Q1); the RED comes back as an ownership question, do not edit owns`.
   - RED with no RED check named fails.
   - GREEN fails as "GREEN but listed", as today.
   - A harness failure fails, as today.
   - An owned check name that the run does not produce at all fails as a stale or mistyped name. This follows Round 3 Q8 condition 2: a stale entry cannot hide a RED.
3. **How `owns` is derived. Each key on each leg needs both conditions below:**
   - **(a) Evidence.** At least 10 valid runs of the leg's full short profile on code whose scenario, `verdict.mjs` and `budgets.mjs` for that key match the tree 67 merges onto. Use pre-merge staging runs and history first. Where fewer than 10 exist (for example S3/hung after ticket 65), run the job on 67's branch until there are 10. Record the run ids and each run's RED set per key in 67's Comments and in METRICS.md.
   - **(b) Ownership.** Every check in `owns` is traced to a line of the owner ticket's text: its acceptance criteria or its What-to-build. The line is cited in 67's Comments. A check the owner's criteria name explicitly may be included even if no recorded run showed it RED. This lowers the false-RED risk of a rare owned check without masking anything outside the owner's claim.
   - **Rule.** A check that is seen RED but cannot be traced to the owner does not go into `owns`. Typical cases: an orphan on a key whose owner is not a lifecycle ticket, or a check that a different open ticket claims. These come back to the Owner Proxy as an ownership question with the run ids before 67 merges. They are never folded in silently. If such a question is open for one key, the other keys may still land.
4. **The list only shrinks.** After 67 merges, an `owns` list can only lose names, and only in the owner ticket's own commit, with its evidence. An unowned RED in a later run follows the existing rules: no rerun-until-green, and the numbers come back as a question (Round 6 Q2 condition 3, Round 8 condition 4, PROMPT §7 Phase 4). No run or job edits `owns`, and no other ticket does either.
5. **Tests**, RED first, in the ratchet/verdict suite:
   - a plain string entry for a single-run key is rejected;
   - an owned RED passes and an unowned RED fails;
   - owned GREEN plus unowned RED fails;
   - GREEN while listed fails;
   - a stale owned name fails;
   - `owns` on `S1/burst1` or windows `S5/short` is rejected;
   - every existing Round 9 and Round 13 case passes unchanged;
   - one case per leg uses the real `expected-red.json`.
   67's pre-merge CI run confirms the change; it does not decide it. If any `owns` disagrees, the numbers come back. Nobody widens `owns` to make the run green.
6. **Edge 55 ← 67.** The empty-list guard and the removal of the allow-list land on the stricter schema. Then 55's guard also rejects a re-added `owns` entry. 67 has no blockers, so the edge cannot close a cycle. Owner tickets that delete their whole entry are unaffected and gain no edge.
7. **Nothing else changes:** every budget, ceiling, n, the `growth()` rule, Round 7 Q1's metric split, the two `unstable` bounds, and which keys are listed.

**Rationale:** Round 9 found and closed this gap for repeated keys, and Round 13 closed it for windows S5/short. Every other entry still accepts any RED, so on 22 entries an orphan, a second proxy or a ceiling breach passes as "expected". Those are the C1 checks this run exists to prove. Per-entry ownership is the smallest change that closes the gap, and it keeps the ratchet monotonic.

The union-only derivation is wrong for the same reason the plain listing is: it accepts whatever happened to be RED. Combining observed evidence with the owner's text makes the list both measured and attributable. The 10-run floor bounds the false-RED risk: a check RED in at least 26 % of runs is seen with 95 % probability. The owner-claimed inclusion covers rarer owned checks. Any remaining flake comes back as a question rather than as churn.

**Charter:** C1 (orphan, single-proxy and ceiling checks enforced where today's listing masks them), C7 (both legs, per-leg lists), C9 (measured runs plus attribution; one schema change in one file, two-way), §9 (no budget touched), Round 3 Q8 conditions 1–3, Round 6 Q2 condition 3, Round 8 condition 4, Round 9 Q1 conditions 1 and 5, Round 13 Q1 conditions 1, 3 and 7, and Round 13's Shared understanding (this is that branch returning).

**REVERSIBILITY:** Two-way door (test code, list shape, ticket text, one edge). ADR: no.

---

- 2026-11-07 (implementer, branch `ticket/67-owned-checks`; implementation ff52f2d, integration tip merged twice: 3fc15e4 with ticket 12, 5a83b2c with ticket 68).

  **What changed.** `tests/memory/lib/ratchet.mjs`: a listed single-run key that is not `unstable` takes `{ "ticket": "<NN>", "owns": ["<check>", …] }` (`entryOf`/`kindError`/`ownsError`, one place). Schema errors: a plain ticket id (string or number) for a single-run key; an empty `owns`, a duplicate, a non-string or empty name; `owns` on a repeated key (median rule unchanged) and on either `unstable` key, with or without `state`. Ratchet (condition 2): RED only on owned checks passes and sets the row note `<key>: RED on <checks>, owned by ticket <t>`; each unowned RED check fails with `<key>: RED on <check>, not owned by ticket <t> (<os>, Round 14 Q1); the RED comes back as an ownership question, do not edit owns`; RED with no RED check named fails; an owned name the run does not produce fails (`… a stale or mistyped name (<os>, Round 14 Q1, Round 3 Q8 condition 2)`); GREEN while listed and a harness failure fail as before. `tests/memory/job.mjs` hands the ratchet every check name of a run (`checkNames`) and prints a "Tolerated REDs (Round 14 Q1 …)" list in the job summary (stdout, `job-summary.md`, `$GITHUB_STEP_SUMMARY`); the unstable lines keep their own list. `tests/memory/expected-red.json`: every single-run entry rewritten with `owns`; the two `unstable` entries unchanged.

  **Decisions taken.** (1) `owns` on a repeated key is a schema error too, the smallest reading of "repeated keys keep Round 9 Q1 condition 1 (median only)". (2) An `owns` list holds the checks seen RED in the matching runs that trace to a line of the owner ticket, plus owner-named checks with RED evidence (`start-over-stale-lock`, RED in windows 42421432504 and in 4 of 39 S3/hung legs in ticket 65's survey) or where the list would otherwise be empty (S7, below). Owner-named checks never seen RED are not added: condition 3(b) allows them, and leaving them out keeps the list tightest. (3) A run result without check names fails as a measurement gap, so the stale-name guard cannot be skipped by a run that reports nothing. (4) One failure line per unowned check. (5) The stale-name check runs on a RED run only (a GREEN listed run already fails).

  **Evidence (condition 3a).** METRICS.md "RED check sets per listed single run, both legs (ticket 67 …)" has the matching rule, every run id and each run's RED set per key. Matching = same `verdict.mjs`/`budgets.mjs`, Bun 1.4.2, ticket 10's preflight change present, no unmerged proxy-dependency bump (staging/12 runs before its merge excluded); linux also needs ticket 64's sampler fix; S3/short and S3/hung also need ticket 65's scenario change. Linux 13 runs, windows 21 runs; S3/short and S3/hung 5 per leg (**below 10: pending CI**, plus 8 local Linux runs of each as a supplement). Ticket 12 merged during this ticket: 1 run (42420564808, staging/12 final) is on its proxy tree, and its RED sets fall inside the earlier sets on every key and leg.

  **owns per key (condition 3b), each traced to the owner ticket's text:**

  | key | leg | owns | owner-ticket line | runs |
  |---|---|---|---|---|
  | S1/burst4, burst16, burst32, bigbody | both | procPeak:proxy | 19 AC "Loop S1 burst: HWM ≤ 400 MB at 16 and ≤ 600 MB at 32 … bigbody within budget. Delete `S1/burst4`, `S1/burst16`, `S1/burst32`, `S1/bigbody` (linux, windows)" | L 13, W 21 |
  | S1/stalled | windows | procPeak:proxy | 61 What-to-build "the S1/stalled scenario … is RED on both working set and commit (proxy peak ~452 MB commit)" | W 21 |
  | S2/short | both | solver:cost-per-generation, solver:retained-before-recycle | 58 AC "Loop S2: per-generation cost ≤ 300 MB, retained before recycle ≤ 300 MB" | L 13, W 21 |
  | S3/short | linux | peak:kit, procPeak:launcher, procPeak:mcp-bridge, procPeak:preflight, procPeak:proxy | 37 AC "Loop S3 Linux on Node 26: summed-RSS sample max ≤ 596 MB and every role peak within target" | L 5 (+8 local) |
  | S3/short | windows | peak:kit | 37 AC "Loop S3 Windows: ≤ 600 MB commit" | W 5 |
  | S3/hung | both | failed-launches, stale-lock-after-round, exactly-one-proxy-after-round | 16 AC "Loop: S3 killed-holder round → 0 failed launches, 0 stale locks, exactly 1 proxy" | L 5 (+8 local), W 5 |
  | S3/hung | both | start-over-stale-lock | 16 What-to-build "Takeover only on proof (holder dead, or PID reused …)"; 16 Comments 2026-11-07 "deleting `S3/hung (linux, windows)` now also needs the new check `start-over-stale-lock` GREEN" | as above |
  | S3/hung | windows | orphans | 16 Comments 2026-11-06 (ticket 02 round 4) "the windows memory leg must show 0 orphans in S3" (Comments, not AC: see question F) | W 5 |
  | S3/omp | both | omp:concurrent-preflights | 35 AC "Seam 1 (S3 omp leg): ≤ 1 concurrent preflight with 5 hosts and with the starter killed" | L 13, W 21 |
  | S4/short | both | stale-lock-after-ctrl-c, respawn-recovers-despite-stale-lock | 17 AC "Loop S4: 0 stale locks after Ctrl-C during start (baseline 5/8); respawn with a stale lock → proxy up" | L 13, W 21 |
  | S4/short | both (windows also the last two) | unstoppable-proxy-after-ctrl-c, proxy-left-after-stop, failed-lifecycle-steps | 17 What-to-build "Every child is reaped on stop/restart/crash/update" (42408170742: 14 stop/restart steps exited 2 with the proxy left) | L 13, W 21 |
  | S5/short | linux | growth:mcp-bridge | 30 AC "Loop S5: growth ≤ 5 %/1k" | L 13 |
  | S7/short | both | proxy.early.log:bounded (never RED) | 34 AC "Loop S7: early log ≤ 1 MB + bounded overshoot" | L 13, W 21 |

  **Ownership questions (condition 3, Rule): REDs no line of the owner ticket covers. Not folded into `owns`; each fails the ratchet until answered.**
  - **A. S2/short → 58, both legs.** `cdn-cache:memory-growth` RED in 13/13 linux and 21/21 windows runs. Ticket 25 claims it: AC "Loop S2: CDN memory ≤ 64 MB (baseline +151 MB / 600 URLs). The `S2/short` entry stays until 58 (solver part still RED)." `procPeak:scenario` (13/13, 21/21; the S2 host peak ≤ 600 MB, ticket 01 Comments item 10) and `growth:scenario` (11/13, 12/21) are named nowhere in 58's text. They could only be inferred from 58's What-to-build (the recycle triggers), so they were not added.
  - **B. S3/short → 37, both legs.** `failed-launches` and `stale-lock-after-round` RED in 5/5 per leg and 8/8 local runs. They come from S3/short's kill-holder-10 round, which ticket 16 claims (AC "S3 killed-holder round → 0 failed launches, 0 stale locks, exactly 1 proxy"). `exactly-one-proxy-after-round`: linux 1/5 (42421424292), windows 2/5 (42404639968, 42415957165), same claim. `orphans`, windows 3/5 (and 16 of 16 earlier runs): 16 Comments "0 orphans in S3"; 17 Comments "ticket 37 is now blocked by 17 so the Windows S3/short entry can clear".
  - **C. S3/hung → 16, both legs.** Linux `peak:kit`, `procPeak:launcher`, `procPeak:mcp-bridge` 5/5 (8/8 local), `procPeak:preflight` 4/5, `procPeak:proxy` 2/5 (6/8 local). Windows `peak:kit` 1/5 (42421432504). These are S3 memory targets, ticket 37's AC (which deletes S3/short only). No line of 16 names memory.
  - **D. S3/omp → 35.** Linux `procPeak:proxy` 4/13 and `procPeak:preflight` 4/13; windows `peak:kit` 2/21 (42383999482, 42415953488). 35's text names concurrent preflights, waiter cost, cause lines and hosts finished, not the S3 role peaks or kit total (37's S3 targets).
  - **E. S7/short → 34, both legs.** `proxy.log:bounded-while-running` RED in 13/13 and 21/21 runs, the only RED check. Ticket 33 claims it: AC "Loop S7: `proxy.log` ≤ 6 MB while running. The `S7/short` entry stays until 34." 34 owns the early log (`proxy.early.log:bounded`, never RED), which is what its entry now names.
  - **F. Process.** Windows S3/hung `orphans` rests on an orchestrator Comments line in ticket 16, not on its AC or What-to-build (condition 3(b) names those two). It is in `owns` with that citation. If Comments do not count, it moves to question C.
  - **Evidence floor.** S3/short and S3/hung have 5 matching runs per leg (ticket 65's scenario change), and the ticket 12 proxy tree has 1. Condition 3(a) wants 10 per leg: more runs on 67's branch are needed (orchestrator CI).

  **Predicted pre-merge CI result (condition 5: confirms, does not decide).** Replaying the new ratchet over the recorded RED sets (`t67-scripts/replay.mjs`), each leg fails exactly on the lines of questions A–E: S2/short, S3/short, S3/hung (linux every run, windows when peak:kit is RED), S3/omp (when a role peak is RED) and S7/short. Every other listed key holds on both legs. Nobody widens `owns` to make the run green.

  **Tests (RED first, condition 5).** `tests/memory/verdict.test.mjs` "owns: …" (10 cases) and "the committed expected-red.json: each leg passes … and fails on one unowned RED" (one case per leg on the real list) are 11 of 11 RED on the tip 5c68c2f (`reports/t67-red-verdict.log`) and GREEN on ff52f2d. `tests/memory/loop.test.mjs` "job: a listed run RED only on its owned checks …" and "job: an unowned RED or an owned check the run no longer produces fails the job …" (a real S3/omp summary replayed through job.mjs) were 2 of 2 RED before the job.mjs change (the run reported no check names) and GREEN after. Every Round 9 and Round 13 case (`judgeBurst`, `judgeS5`, the unstable and allow-list cases, the S1/burst1 and S5 job replays) passes unchanged.

  **Existing tests changed, and why (C2).** All of them pinned plain single-run entries, which condition 1 makes a schema error. In `verdict.test.mjs`, the seven seam-9 ratchet basics now use `owns` entries and results with RED checks, with the same assertions. The test "the committed list marks … its only non-plain entries" becomes "… its only unstable entries", and linux S5/short is now asserted as `{ ticket: "30", owns: ["growth:mcp-bridge"] }`; its unstable assertions are unchanged. "The S3 OMP leg runs on both legs …" reads `.ticket`. "S3/omp → 35 is a plain entry …" becomes "binary entry": RED on its owned check, with the GREEN-deletion and `unstable` refusal unchanged. In `loop.test.mjs`, the S3/omp replay row gains its tolerated-RED note. The S3/hung refused-start replay keeps its evidence-gate assertions; its ratchet result is now exit 1 with the four question-C lines, which pins the open question.

  **Suites** on 5a83b2c (after the ticket 68 merge): `npm run test` 829 tests, 810 pass, 19 skipped, 0 fail; `npm run test:proxy` 1364 pass, 0 fail; `npm run test:mcp` 96 tests, 95 pass, 1 skipped (logs `reports/t67-test2.log`, `t67-proxy2.log`, `t67-mcp2.log`). On 3fc15e4 (after the ticket 12 merge) the counts were 812/793/19/0, 1357/0 and 96/95/1. Memory-loop scenarios: no scenario code changed; local S3/hung ×8 and S3/short ×8 above.

  **Left for others.** Questions A–F and the evidence floor go to the Owner Proxy before 67 merges (condition 3). Edge 55 ← 67 is already in 55's "Blocked by". Under condition 4, `owns` lists only shrink, in the owner ticket's own commit.

- 2026-11-08 (implementer, round 2: Owner Proxy round 15). Branch `ticket/67-owned-checks`; implementation 730bf42 + a5692b9 (one more schema case found by a surviving mutant), integration tip merged at 64e5edb (69, round 15 log) and 6961023 (round 15 ticket texts 2a6fd21, ticket 13).

  **What changed.** The Round 14 `{ ticket, owns }` shape is gone (Round 15 Q1 condition 1: one shape). Each listed single run is `{ "owners": { "<NN>": [<check>, …] }, "flips": [<check>, …] }`, `flips` optional. New schema errors on top of Round 14's list: a name under two owners, an empty owners map, an owner with an empty list, an owner id that is not two digits or has no issue file (every owner checked), a `flips` name no owner lists, an empty or repeated `flips`, and `owners`/`flips` on a repeated key or either `unstable` key (with or without `state`). The ratchet passes RED only on owned names and prints `<key>: RED on <checks>, owned by ticket <t> (<names>), ticket <u> (<names>)`, where each owner gets the names RED in this run, in run order. An unowned RED fails as `<key>: RED on <check>, not owned by ticket(s) <t…> (<os>, Round 14 Q1, Round 15 Q1); the RED comes back as an ownership question, do not edit owners`. GREEN passes only with a `flips` name and prints `<key>: GREEN, listed for ticket(s) <owners of the flipping names> on flipping checks <names> (Round 15 Q1)`. GREEN with no `flips` still fails as "GREEN but listed for …". `tests/memory/job.mjs` prints the owners in the table and both kinds of line under "Tolerated REDs and flipping GREENs (Round 14 Q1, Round 15 Q1 …)".

  **Decisions taken.** (1) "ticket 37" for one owner, "tickets 16, 37" for several, in both new lines; the round's templates say `ticket(s) <t…>`. (2) The GREEN line names the owners of the flipping names. (3) The stale-name check also runs on a GREEN pass through `flips`, so a stale flipping name cannot keep an entry alive (adversarial; mutation-proven). (4) An empty `flips` is a schema error ("leave it out when nothing flips"), so there is one way to say "nothing flips". (5) Condition 5 (shrink per owner, ≥ 10 GREEN runs to remove a flipping name, last removal deletes the entry) is process: it is stated in the ratchet's header and enforced by review, not by code, because the job sees one run.

  **Owners (Round 15 Q1 condition 3), each traced to its owner ticket's updated text (2a6fd21).** n = RED runs / matching runs; † = `flips`.

  | key | leg | owner → names | trace |
  |---|---|---|---|
  | S1/burst4, burst16, burst32, bigbody | both | 19 → procPeak:proxy (L 18/18, W 26/26) | 19 AC "Loop S1 burst: HWM ≤ 400 MB at 16 and ≤ 600 MB at 32 … bigbody within budget" |
  | S1/stalled | windows | 61 → procPeak:proxy (26/26) | 61 What-to-build "RED on both working set and commit (proxy peak ~452 MB commit)" |
  | S2/short | both | 58 → solver:cost-per-generation, solver:retained-before-recycle, procPeak:scenario (all 18/18, 26/26), growth:scenario† (L 14/18, W 13/26), procPeak:solver† (0/18, 0/26) | 58 AC "Loop S2: per-generation cost ≤ 300 MB (`solver:cost-per-generation`), retained … (`solver:retained-before-recycle`) …; `procPeak:scenario` ≤ 600 MB; `growth:scenario` ≤ 5 %/1k; `procPeak:solver` ≤ 300 MB" |
  | S2/short | both | 25 → cdn-cache:memory-growth (18/18, 26/26) | 25 AC "Loop S2 (linux, windows): `cdn-cache:memory-growth` GREEN (CDN memory ≤ 64 MB); remove `cdn-cache:memory-growth` from `S2/short`" |
  | S3/short | linux | 16 → failed-launches, stale-lock-after-round (10/10), exactly-one-proxy-after-round† (1/10); 37 → peak:kit, procPeak:launcher, procPeak:mcp-bridge (10/10), procPeak:preflight† (2/10), procPeak:proxy† (3/10) | 16 AC "Loop: S3 killed-holder round → 0 failed launches (`failed-launches`), 0 stale locks (`stale-lock-after-round`), exactly 1 proxy (`exactly-one-proxy-after-round`) … Remove 16's names from `S3/short` …"; 37 AC "Loop S3, both legs: remove 37's names … Linux … `S3/short` and `S3/hung` → `peak:kit`, `procPeak:launcher`, `procPeak:mcp-bridge`, `procPeak:preflight`, `procPeak:proxy`" |
  | S3/short | windows | 16 → failed-launches, stale-lock-after-round (10/10), exactly-one-proxy-after-round† (4/10); 17 → orphans† (6/10); 37 → peak:kit (10/10) | 16 AC as above; 17 AC "Loop S3 (windows): 0 orphans (`orphans`) after the scenario's stop in `S3/short` and `S3/hung`"; 37 AC "Windows … `peak:kit` in `S3/short`, `S3/hung` and `S3/omp`" |
  | S3/hung | linux | 16 → failed-launches, stale-lock-after-round (10/10), exactly-one-proxy-after-round† (0/10), start-over-stale-lock† (0/10); 37 → peak:kit, procPeak:launcher, procPeak:mcp-bridge (10/10), procPeak:preflight† (8/10), procPeak:proxy† (3/10) | 16 AC "… S3/hung's stale-lock round: … (`start-over-stale-lock` GREEN). Remove 16's names from … `S3/hung` (the same three plus `start-over-stale-lock`)"; 37 AC as above |
  | S3/hung | windows | 16 → failed-launches, stale-lock-after-round (10/10), exactly-one-proxy-after-round† (1/10), start-over-stale-lock† (1/10); 17 → orphans† (9/10); 37 → peak:kit† (1/10) | as above |
  | S3/omp | linux | 35 → omp:concurrent-preflights (18/18); 37 → procPeak:proxy† (5/18), procPeak:preflight† (6/18) | 35 AC "≤ 1 concurrent preflight (`omp:concurrent-preflights`) … Remove `omp:concurrent-preflights` from `S3/omp`"; 37 AC "`S3/omp` → `procPeak:proxy`, `procPeak:preflight`" |
  | S3/omp | windows | 35 → omp:concurrent-preflights (26/26); 37 → peak:kit† (2/26) | as above; 37 AC "Windows … `peak:kit` in … `S3/omp`" |
  | S4/short | linux | 17 → stale-lock-after-ctrl-c, respawn-recovers-despite-stale-lock (18/18), unstoppable-proxy-after-ctrl-c† (2/18) | 17 AC "Loop S4: 0 stale locks after Ctrl-C during start; respawn with a stale lock → proxy up"; What-to-build "Every child is reaped on stop/restart/crash/update" (unchanged by round 15) |
  | S4/short | windows | 17 → stale-lock-after-ctrl-c, unstoppable-proxy-after-ctrl-c, respawn-recovers-despite-stale-lock (26/26), proxy-left-after-stop† (1/26), failed-lifecycle-steps† (1/26) | as above |
  | S5/short | linux | 30 → growth:mcp-bridge (18/18) | 30 AC "Loop S5: growth ≤ 5 %/1k" |
  | S7/short | both | 33 → proxy.log:bounded-while-running (18/18, 26/26) | 33 AC "Loop S7: `proxy.log` ≤ 6 MB while running (`proxy.log:bounded-while-running`). Remove … from `S7/short`" |

  34 owns no name (round 15 E). The windows `S1/burst1` and `S5/short` unstable entries are unchanged. Every `flips` mark fits its count over the matching runs (`t67-scripts/rates.mjs`), including the five CI runs after round 1 (42424608767, 42425069025, 42425476318, 42427108509, 42429164758).

  **Traces that fail:** none. Every owned name appears in its owner's updated AC, or (S1, S1/stalled, S4's reap names, S5) in the unchanged AC or What-to-build line that round 15's table keeps.

  **Back to the Owner Proxy (numbers).**
  - **G. Windows S4/short `count:proxy`.** RED (2 proxies at once) in 1 of 26 runs: 42425476318 (integration 06aa96b), together with 17's three usual names. Round 15 Q1 does not assign it, so per Q2 condition 4 it is not folded in, and a recurrence fails the ratchet. The candidate claimant is 17's What-to-build "The next start adopts an orphaned proxy … and never spawns a second one".
  - **H. The S3 floor restarts with ticket 13.** 13 (MCP dependencies, which S3's bridge runs) merged before 67, and Round 15 Q2 condition 2 names it. With 65 and before 13 there are 10 S3 runs per leg; on the 13 tree there are 2 per leg (42425069025, 42429164758), with RED sets inside the earlier sets. Under Q2 as written, S3/short and S3/hung need **8** more CI runs per leg on 67's tree, not 5. If the Owner Proxy holds that 13 does not change S3's RED sets, the current 10 suffice. Either way, the flips marks are set from whichever 10 count (Q2 condition 4).

  **Tests (RED first, mutation-proven).** `verdict.test.mjs`: the Round 14 block keeps every case, with the same inputs (entries through `owned()` in the round-15 shape) and the same pass/fail; the lines use round 15's wording. New cases: two-owner pass and unowned failure naming both owners; a check under two owners; an empty owners map; an empty owner list; an unknown owner id (first and second owner); `flips` not owned, empty or repeated; GREEN with flips passing with its line; GREEN without flips failing; a stale flipping name failing a GREEN pass; and the per-leg case on the real list (every listed run RED on its names passes; an added `count:proxy` fails naming the owners; GREEN passes exactly where the entry flips). All 16 cases are RED on 64e5edb (`reports/t67-r2-red-verdict.log`). `loop.test.mjs`: the S3/omp and S3/hung replays print their owners, a new job case covers the GREEN flipping S3/omp run, and with the Round 14 ratchet, job and list put back the five job cases fail 5 of 5 (`reports/t67-r2-red-loop.log`, restored from a5692b9, `git diff` empty). Mutation script `t67-scripts/mutate.py` (`reports/t67-r2-mutation2.log`): 10 mutants, 10 killed. The killed mutants are: one owner per check, flips not owned, an empty owners map, only the first owner id checked, GREEN without flips, no stale check on a GREEN pass, an unowned RED tolerated, owners on a repeated key, the job dropping check names, and the job omitting the tolerated list. The first run had the second-owner-id mutant surviving; a5692b9 adds that case. Every restore is from the committed sha, with an empty diff. Round 9 and Round 13 cases are unchanged.

  **Suites** on 6961023: `npm run test` 835 tests, 816 pass, 19 skipped, 0 fail; `npm run test:proxy` 1384 pass, 0 fail; `npm run test:mcp` 97 tests, 96 pass, 1 skipped (`reports/t67-r2-{test,proxy,mcp}.log`).

  **Left for the orchestrator.** The CI runs for the S3 floor (H). Spec §18 and RUNLOG (round 15 condition 10). METRICS.md (section "RED check sets per listed single run, owners and flips") now carries the flip rates.

- 2026-11-08 (implementer, round 3: Owner Proxy round 16). Branch `ticket/67-owned-checks`; integration tip merged at b2aa8ae (eec3f4a: tickets 17 and 37 updated); list change 3b414b2.

  **G (Round 16 Q1).** Windows `S4/short` gains `count:proxy` under owner 17 and in its `flips` list. Trace: 17's What-to-build "The next start adopts an orphaned proxy through the identity proof and never spawns a second one", and 17's new acceptance line (integration eec3f4a) "Loop S4, both legs: exactly 1 proxy at every sample (`count:proxy` ≤ 1), including after a Ctrl-C during start that leaves a proxy without a start-time record (windows run 42425476318, Round 16 Q1). On windows, `count:proxy` is one of 17's names in `S4/short`." The measured link is run 42425476318 (windows): its S4/short `summary.json` `notes.sigintDuringStart` shows a Ctrl-C 150 ms into `proxy start` leaving a proxy with no start-time record (`childSurvived: true`, `pidRecordStartedMs: null`). The next start then spawned a second proxy (`nextStart: 0`, `proxiesAfter: 2`). Rate: 1 of 24 runs before 13, 0 of 10 on the 13 tree. Linux `count:proxy` stays unlisted (0 of 26). Attribution check (Round 16 Q1 condition 4): no S4/short `count:proxy` RED appears in the 10 runs on the 13 tree, so there is no phase to record.

  **Test change (C2 justification).** The real-list test in `tests/memory/verdict.test.mjs` used `count:proxy` as the one unowned RED on every listed key and asserted that no entry owns it. Round 16 Q1 makes that false for windows S4/short. The test keeps its purpose: on every listed single run of both legs, one added RED the key's owners do not hold fails and names the owners. It now picks `count:proxy` where the key's owners don't hold it and `orphans` otherwise (windows S4/short), and it asserts `count:proxy` is owned only in windows S4/short. It failed on the list before 3b414b2 (`reports/t67-r3-red-verdict.log`: "windows S4/short") and passes after. Every other case is unchanged. The mutation script (`reports/t67-r3-mutation.log`) kills 10 of 10 on 3b414b2, with every restore from the committed sha.

  **Traces re-checked on the merged tip.** Every owned name is still in its owner's text. 17's new S4 line adds `count:proxy`. 37's replaced windows line (≤ 514 MB commit, `peak:kit`) still names `peak:kit`, and its round-15 line ("remove 37's names …") is unchanged. No trace fails.

  **H (Round 16 Q2): merge-gate replay.** `/home/AgentKit/overhaul-tools/t67-scripts/replay-artifacts.mjs` replays the `memory-budget-<leg>` artefacts (`ci-art/t67-r3-art/<run>-<leg>/job-summary.json`) through the final `ratchet.mjs` and `expected-red.json`. It checks (a) unowned REDs, (b) validity and harness failures, (c) owned non-`flips` names GREEN, and (d) entries GREEN with no `flips`. For 42425069025 and 42429164758 (from before 67, no `checkNames` in the job summary) it rebuilds the names from each run's `summary.json`. Result over the ten runs on the 13 tree, per run and leg:

  | run | linux | windows |
  |---|---|---|
  | 42425069025 (staging/13) | PASS | PASS |
  | 42429164758 (integration f906014) | PASS | PASS |
  | 42435825059 | PASS | PASS |
  | 42435917288 | PASS | PASS |
  | 42436010878 | PASS | FAIL (a): S7/short `responses-store:heap-at-cap` 98 MB, budget 96, not owned — pending round 17 |
  | 42436099293 | PASS | PASS |
  | 42436186573 | FAIL (c)+(d): S5/short GREEN, `growth:mcp-bridge` 39.53 %/1k with trend false — pending round 17 | PASS |
  | 42436269194 | PASS | PASS |
  | 42436354758 | PASS | FAIL (a): S1/short (unlisted) RED only on commit, `growth:proxy` 5.25 %/1k commit, budget 5 — pending round 17 |
  | 42436440284 | PASS | PASS |

  All 20 legs are valid: every key GREEN or RED, with no harness failure. On every other key of every run, each listed entry passes (RED only on owned names, or GREEN through `flips` with its line). Every non-`flips` name is RED in all 10 runs, except linux S5/short `growth:mcp-bridge` at 9/10. No `flips` name is RED in all 10 runs, so Round 16 Q2 condition 4 is not needed for any mark. Not memory, pending ticket 70 / the orchestrator: windows `test-kit` failed in 42436186573 (Node 24, `tests/manager-safety.test.mjs:176`) and in 42436440284 (Node 26, `tests/memory/loop.test.mjs:470` "no-op hook charged 2.55 MB"), both in tests 67 does not change. Per round 16 Q2 condition 3 and the orchestrator's instruction, no owner list or `flips` mark was edited for the round-17 items.

  **METRICS.md** ("RED check sets per listed single run, owners and flips") records:
  - the restart scope (S3/short, S3/hung and S3/omp on both legs, plus linux S5/short);
  - each name's rate before 13 and on the 13 tree, in two tables;
  - `count:proxy` under 17 (1/24 †, 0/10 †) with its phase;
  - the replay result.

  **Suites** on the round-3 tree: `npm run test` 835 tests, 816 pass, 19 skipped, 0 fail; `npm run test:proxy` 1384 pass, 0 fail; `npm run test:mcp` 97 tests, 96 pass, 1 skipped (`reports/t67-r3-{test,proxy,mcp}.log`).
- 2026-11-08 (orchestrator, Owner Proxy round 17): Q2 condition 1 — before 67 merges, its list edit gives linux `"S5/short": { "owners": { "30": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] }` (Round 15 Q1 condition 4: RED in 9 of 10 runs on the 13 tree), and METRICS records the rate per tree: 0 GREEN of 37 before 13, 1 of 10 on the 13 tree (42436186573, 39.53 %/1k, trend false). Windows `S5/short` stays `unstable`; no third `unstable` key. Cross-question condition 3 (amends Round 16 Q2 condition 2) — 67's merge gate: runs 42436010878 and 42436354758 count as valid floor runs (their only ratchet failures are signatures (i) and (ii), excluded from the replay judgement); 42436186573 passes the replay with the Q2 mark; 67's final pre-merge run falls under cross-question condition 2 (the interim signatures (i)–(iv)); the `manager-safety.test.mjs:160` failure is ticket 70's and is not decided here. New ticket 71 (the S7, windows S1/short and OMP floor measurement rules) is blocked by 67.

- 2026-11-08 (implementer, round 4: Owner Proxy round 17). The list change is fb2610a; integration tip c3f5464 (round 17's ticket texts) merged at 3d9f689.

  **Flips mark (Round 17 Q2 condition 1).** Linux `S5/short` is now `{ "owners": { "30": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] }`. Rate: RED in 16 of 16 matching runs before 13 (0 GREEN of 37 in Round 17's recount); on 13's tree RED in 9 of 10, with 42436186573 GREEN at 39.53 %/1k and trend false. Nothing else in the list changed. Windows S7/short gains no name, windows S1/short stays unlisted, and windows S5/short stays `unstable`.

  **Trace.** Ticket 30's Acceptance names `growth:mcp-bridge` in "Loop S5: growth ≤ 5 %/1k" and in its new linux exit line (c3f5464): "`growth:mcp-bridge`, and with it the linux `S5/short` entry, is removed only when every one of ≥ 10 fresh matching linux CI runs on this ticket's tree has `growth:mcp-bridge` ≤ 5 %/1k, whatever the trend flag says". I re-checked every owned name on the merged tip. Each is named verbatim in its owner's Acceptance or What-to-build, except the S1, S1/stalled and S4 names, which still trace through the prose lines of round 2's table (19's HWM line, 61's proxy-peak line, 17's S4 and reap lines); those texts are unchanged. No trace fails.

  **Tests (RED first).**
  - The committed-list test now pins linux S5/short with its `flips` mark; it failed on the old list (`reports/t67-r4-red-verdict.log`). This is a Round 13-era assertion, changed because Round 17 Q2 changes the entry.
  - New job-seam case: the real linux S5/short `summary.json` of 42436186573 (fixture `tests/memory/fixtures/ci-42436186573-s5-short-linux-summary.json`, copied from the run's artefact) replayed through `job.mjs` against the committed list. It passes with `S5/short: GREEN, listed for ticket 30 on flipping checks growth:mcp-bridge (Round 15 Q1)`, and the same run with an orphan fails. It failed on the old list (`reports/t67-r4-red-loop.log`).
  - Memory suites: 180 pass, 5 skipped, 0 fail.

  **Merge-gate amendment (Round 17 cross-question condition 3).** `t67-scripts/replay-artifacts.mjs` leaves signatures (i) and (ii) out of the judgement when the run's own values fit them: (i) S7/short `responses-store:heap-at-cap` ≤ 128 MB; (ii) windows S1/short RED only on commit on `growth:proxy` alone, ≤ 10 %/1k. It reports each exclusion and still counts every other failure. Replay of the ten runs on 13's tree against the final list:

  | run | linux | windows |
  |---|---|---|
  | 42425069025 (staging/13) | PASS | PASS |
  | 42429164758 (integration f906014) | PASS | PASS |
  | 42435825059 | PASS | PASS |
  | 42435917288 | PASS | PASS |
  | 42436010878 | PASS | PASS (signature (i) excluded: 98 MB) |
  | 42436099293 | PASS | PASS |
  | 42436186573 | PASS (S5/short GREEN on its flipping mark) | PASS |
  | 42436269194 | PASS | PASS |
  | 42436354758 | PASS | PASS (signature (ii) excluded: 5.25 %/1k commit) |
  | 42436440284 | PASS | PASS |

  All 20 legs are valid. No unowned RED is left (a); there is no harness failure (b); every non-`flips` owned name is RED in all 10 runs (c); and no listed entry is GREEN without a `flips` name (d). METRICS.md has the per-tree rates with the S5 mark and the replay. The S7, S1/short and OMP-floor measurement tables belong to ticket 71.
