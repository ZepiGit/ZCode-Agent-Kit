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

- 2026-11-08 (orchestrator, Owner Proxy round 17): Q2 condition 1 — before 67 merges, its list edit gives linux `"S5/short": { "owners": { "30": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] }` (Round 15 Q1 condition 4: RED in 9 of 10 runs on the 13 tree), and METRICS records the rate per tree: 0 GREEN of 37 before 13, 1 of 10 on the 13 tree (42436186573, 39.53 %/1k, trend false). Windows `S5/short` stays `unstable`; no third `unstable` key. Cross-question condition 3 (amends Round 16 Q2 condition 2) — 67's merge gate: runs 42436010878 and 42436354758 count as valid floor runs (their only ratchet failures are signatures (i) and (ii), excluded from the replay judgement); 42436186573 passes the replay with the Q2 mark; 67's final pre-merge run falls under cross-question condition 2 (the interim signatures (i)–(iv)); the `manager-safety.test.mjs:160` failure is ticket 70's and is not decided here. New ticket 71 (the S7, windows S1/short and OMP floor measurement rules) is blocked by 67.
