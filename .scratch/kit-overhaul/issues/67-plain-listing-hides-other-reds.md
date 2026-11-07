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
