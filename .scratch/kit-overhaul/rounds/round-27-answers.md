# Round 27 (2026-11-08) — ticket 16 changes what S3 counts as a failed launch

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–26 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md`, `rounds/round-27.md`.
- DECISIONS Round 1 Q4 (the budget's origin: "0 failed launches with a killed holder"), Round 8 Q1, Round 14 Q1, Round 15 Q1–Q2, Round 16 Q1–Q2 and Round 22 Q1 in full.
- Integration tree f21d3ac: `spec.md` §18. The killed-holder budget is the first **PROCESSES** bullet ("Exactly 1 proxy … with 0 failed launches, including a killed holder"). No S3 MEMORY row names `failed-launches`. Also METRICS.md lines 61, 230–231 and 379–421.
- Ticket 16's branch at 4dbee25 (`/home/AgentKit/wt/t16`): the issue file in full; `git diff origin/overhaul/stability-terminal-ux...HEAD -- tests/memory`; `tests/memory/scenarios/s3-concurrency.mjs` (the kill-holder adversary, `round()`, the checks at lines 412–427); `s4-lifecycle.mjs:117–160`; `lib/isolated-kit.mjs:152–184` (`run()` returns `child.pid`, and `preflight()` spawns `node cli/heal.mjs` directly); `cli/heal.mjs:117` (the preflight imports the lifecycle in-process, so the lock holder's pid **is** the launch's pid); `lib/completeness.mjs`; `docs/adr/0003-…:17`; `lib/budgets.mjs:88`.
- Every `summary.json` under `/home/AgentKit/overhaul-tools/t16-memloop/` (tip1–3, branch1–10). I recounted every S3 round.
- Every archived S3 kill-holder line in `/home/AgentKit/overhaul-tools/ci-art/t67-logs/logs/` (62 linux and 43 windows runs), and `parsed.json`.
- `gh run list --branch staging/16`: run 42507303528 (head 6a7b249) is `in_progress`. No result is known yet.

**Recomputed facts and corrections to the round.**
1. **Confirmed: the old counting could never reach budget 0.** Ticket 16's own fix, before `launchOutcomes` (branch1–3), still had `failed-launches` = 1 in 6 of 6 S3 runs. In each run the single failure was the kill-holder round's victim (`preflight#k code=null starting zcode-proxy ...`), and nothing else failed. With the new counting (branch4–10), every kill-holder round has exactly one `killedByAdversary` entry and 0 `failedLaunches`, in 14 of 14 S3 runs. The tip figures match the round: S3/short 3/8/3 → 2/7/2, S3/hung 11/12/11 → 10/11/10.
2. **The archive agrees: every kill-holder round has a victim.** All 124 linux and 86 windows archived kill-holder rounds show ≥ 1 failed launch. None shows 0.
3. **Correction: "the tip stays RED, so the check keeps its power" holds on linux and for S3/hung. It does not fully hold for windows S3/short.** I re-derived the archive under the new counting: the kill-holder count minus the victim, plus the other rounds.
   - **S3/hung:** RED in 62 of 62 linux and 43 of 43 windows runs. Its hung rounds fail anyway.
   - **Linux S3/short:** RED in 61 of 62.
   - **Windows S3/short:** RED in only 34 of 43. In 9 of 43 runs (21 %), and in 4 of the latest 20, the victim was the only failure. Those runs would have been GREEN on pre-16 code.
   - So, on windows S3/short, one GREEN pre-merge run proves ticket 16's fix only weakly (P ≈ 0.2 by chance). Condition 4 addresses this. The local tip runs (3 of 3 RED) are linux only.
4. **The new counting fails closed, except in one case.** Two missing values make it stricter, never looser:
   - a missing `r.pid`;
   - a missing or `null` `adversary.killed`.
   
   In both cases there is no victim, so every non-zero launch counts. That is the Round 8 Q1 condition 1 concern, and here it is answered. The one case that loosens: `launchOutcomes` takes **every** launch whose pid equals the victim's. If a pid is reused within one round (Windows reuses pids quickly), a real failure would be hidden. The round's condition (2) is not implemented on 4dbee25. `completeness.mjs` has no check on `killedByAdversary`, and the new test does not cover these cases.
5. **Where the rule lives.** It belongs in spec §18's PROCESSES bullet, not in an "S3 row". ADR-0003 condition 5 states the same budget. `budgets.mjs:88` holds the value and a comment, and `budgets.mjs` is in METRICS' matching rule. Condition 1 leaves it untouched.

---

## Q1 — may ticket 16 report the kill-holder adversary's own victim apart from `failed-launches`?

**DECISION:** ACCEPTED with conditions. Both changes are measurement corrections, not loosenings:
- the victim is reported as `killedByAdversary`;
- S4 records `staleLockLeft` instead of crashing on `unlinkSync`.

Ticket 16 may remove `failed-launches` and `stale-lock-after-round` from `S3/short` and `S3/hung` on both legs. On windows, the removal needs condition 4's evidence.

**REJECTED in part:**
- **(i) The evidence claim.** "The tip stays RED under the new counting, so the check keeps its power" is unproven for windows S3/short (correction 3). Condition 4 replaces it.
- **(ii) Condition (3)'s "until ticket 17 owns S4's lock checks".** No decision gives 17 a check on the lock left after a respawn, and no budget covers that state. §18 covers "after a race round or after Ctrl-C". So `staleLockLeft` is recorded only. Making it a judged check is a separate question with its own evidence (condition 5).
- **(iii) Condition (2) is widened (condition 2).** A kill-holder round counts as run only when exactly one launch is the matched victim. Every other adversary state is a harness failure, not just "a kill but no match".

**No earlier decision is contradicted.**
- Round 1 Q4 condition 4 and ADR-0003 condition 5 ("0 failed launches with a killed holder") get their only reachable reading. Their baseline was "7–8 of 10 launches failing", which counts the launches that failed **because of** the killed holder.
- Round 15 Q1 condition 5 is applied as written. 16 removes only its own names, with the owner's loop runs plus the pre-merge CI run GREEN on that check on that leg.
- Round 14 Q1 condition 4: no other owner's name is touched.
- Round 22 Q1: 17's `orphans` names are unaffected.
- Round 16 Q2 condition 1's restart rule applies (condition 6).

Binding conditions:
1. **The rule, stated where the budget is (C8, measurement-rule amendment).** These texts go in ticket 16's change:
   - **Spec §18 PROCESSES, first bullet.** Append: "Measurement-rule amendment (Round 27 Q1): in the kill-holder round, the launch the adversary SIGKILLed (its pid equals the adversary's recorded `killed` pid, and it exited non-zero) is reported as `killedByAdversary` and is never a failed launch. Every other launch that does not exit 0 is a failed launch. A round counts as run only with exactly one such launch. Budget 0 is unchanged."
   - **METRICS.md:**
     - the same sentence;
     - correction 3's power figures (S3/hung 62/62 and 43/43, linux S3/short 61/62, windows S3/short 34/43 RED under the new counting on archived code);
     - a note that every `failed-launches` value recorded before 16, including the §6 baseline "7/10 failed (killed holder)", includes the victim. History is not rewritten.
   - **ADR-0003 condition 5:** the same one-sentence clarification, inside 16's existing amendment.
   - **`budgets.mjs`: no change.** The value is unchanged, and the file is in the matching rule.
2. **Fail-closed evidence gate (RED first, in 16's change).** In `lib/completeness.mjs` (or wherever the run-evidence gate lives), the `kill-holder-10` round counts as run only if `adversary.killed` is an integer and exactly one launch of that round has that pid and a non-zero exit. Each of these states is a harness failure that names the round and prints the adversary record, and it is never GREEN:
   - no kill (`killed: null`);
   - a kill whose pid matches no launch;
   - a matched launch that exited 0;
   - two or more launches with the victim's pid.
   
   Tests: one case for each of those four states, plus today's good case. `launchOutcomes` stays a pure helper, and its existing cases stay. The archive shows a victim in all 210 kill-holder rounds (correction 2), so this gate should not fire at random. If it does fire in CI, it comes back with the run ids and the adversary records: no rerun-until-green (Round 6 Q2 condition 3, Round 8 condition 4).
3. **Visibility.** `notes.rounds[].killedByAdversary` and `adversary` stay in `summary.json`. Ticket 16's Comments record them for the pre-merge run, as the implementer's report already plans. The field is additive, and no user-facing output changes (C2, C3).
4. **Removal evidence, per leg (Round 15 Q1 condition 5, made specific).**
   - **Linux:** the 7 branch loop runs, plus pre-merge run 42507303528's ubuntu leg GREEN on both names in `S3/short` and `S3/hung`.
   - **Windows:** run 42507303528's windows memory leg must be GREEN on both names in `S3/short` **and** `S3/hung`. Each of the two kill-holder rounds must show one `killedByAdversary` entry and 0 `failedLaunches`. In the same run, the windows `test-kit` legs must pass `tests/start-lock.test.mjs`, in particular:
     - the kill at every protocol step;
     - "a waiter on a live holder that dies mid-start takes over and starts one proxy" (the deterministic form of this check);
     - the spawn-window kills.
     
     The two rounds are two samples of the same round, P ≈ 0.16–0.21 each on pre-16 code. Together with the seam tests, they replace the single-run claim of correction 3. This adds no new floor.
   - **If any of this fails,** the names do not leave the list on that leg. The numbers come back, and 16 does not merge (the pre-merge run confirms, it does not decide).
   - **After the merge,** a RED on either name, on either leg, is an unowned RED: a question with run ids, never a re-add (Round 15 Q1 condition 5).
5. **S4 `staleLockLeft` (recorded, not judged).** The harness change is accepted. Ticket 16's designed takeover removes the planted dead-holder lock (pid 2147483646), and the old unconditional `unlinkSync` then turned correct kit behaviour into an ENOENT harness failure.
   - The judged `respawn-recovers-despite-stale-lock` check is unchanged.
   - `staleLockLeft` stays in `notes.respawnWithStaleLock` only, and METRICS records its value on 16's tree.
   - A future judged check on it is a new check name. It comes back as its own question with its distribution and a proposed owner, and it is not presumed to be 17's.
6. **Matching-count restart (Round 16 Q2 condition 1, Round 15 Q2 condition 2).** 16 changes `s3-concurrency.mjs`, `s4-lifecycle.mjs` and the lifecycle path. So, under METRICS' matching rule, the matching runs restart on 16's tree for at least `S3/short`, `S3/hung`, `S3/omp` and `S4/short` on both legs, and METRICS records the scope.
   - 16's remaining `flips` names (`exactly-one-proxy-after-round`; `start-over-stale-lock`) need their ≥ 10 GREEN matching CI runs per leg on that tree, as the implementer's report says.
   - 17's S4 and S3 floors also count on that tree or a later one.
7. **Nothing else changes:** budget values, check names, `budgets.mjs`, repetition counts, bounds, other owners' names and marks, and the `flips` lists (§9).

**Rationale:** The adversary's victim is a launch the scenario itself SIGKILLs. It ends with `code=null` under any kit. Ticket 16's own fix showed this: with every other launch healthy, the victim alone kept `failed-launches` at 1 in 6 of 6 runs. A budget no kit can meet measures nothing. The budget's origin explains what it was meant to count. Round 1 Q4 took it from memory-report §6, where the killed holder made 7–8 of 10 **other** launches fail. Counting the victim separately, matched by pid within its round, is that reading.

The change fails closed. A missing pid or kill record makes the count stricter. Pid reuse is the one way it could hide a failure, and condition 2 closes it. Condition 2 also turns "the round never killed anyone" into a harness failure, so a GREEN always means the killed-holder case was really exercised. That is Round 8 Q1 condition 1's lesson: a missing observation must never read as GREEN.

The orchestrator's power argument rested on three linux tip runs. The archive shows that on windows S3/short, about 1 run in 5 fails only on the victim. A lone windows GREEN would therefore prove little. Condition 4 pairs the two kill-holder rounds with the deterministic seam tests already in 16, and the unowned-RED guard catches any later miss.

The S4 edit only stops the harness from crashing on correct kit behaviour. Judging a new state would be a new check, and no budget names that state, so it is recorded and comes back separately.

**Charter:** C1 (exactly one proxy and 0 failed launches with a killed holder, now measurable; fail-closed evidence; the lock checks become unowned guards), C7 (windows judged on its own power figures and seam tests; linux unchanged), C9 (stronger measured evidence: 210 archived kill-holder rounds and 26 local runs recounted; smaller blast radius: one helper, one gate, notes-only S4; simpler than a new budget), C2 (additive `summary.json` fields; no user-facing change), C8 (spec, METRICS and ADR state the rule), §9 (budget 0 unchanged, never loosened), Round 1 Q4 condition 4, Round 6 Q2 condition 3, Round 8 Q1 conditions 1 and 4, Round 14 Q1 condition 4, Round 15 Q1 condition 5, Round 15 Q2 conditions 1–2, Round 16 Q2 condition 1, Round 22 Q1 (17's names untouched), PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door: test-harness code, an evidence gate, list names and record text. ADR: no. ADR-0003 condition 5 gets a clarifying sentence inside ticket 16's existing amendment, not a new decision.

### Ticket-text changes (exact)

**`issues/16-start-lock-protocol-v1-proven-takeover.md`**
- Acceptance, new line after the "Loop: S3 killed-holder round …" line:
  `- [ ] Measurement (Round 27 Q1): S3 reports the kill-holder adversary's victim (pid = adversary.killed, non-zero exit) as killedByAdversary, never as a failed launch; the evidence gate makes kill-holder-10 a harness failure unless exactly one launch matches (tests for no kill, no match, a matched launch that exited 0, and two matches), RED first. Spec §18 PROCESSES, METRICS.md and ADR-0003 condition 5 state the rule; budgets.mjs is unchanged. Windows removal of failed-launches and stale-lock-after-round needs the pre-merge windows memory leg GREEN on both names in S3/short and S3/hung, one killedByAdversary and 0 failedLaunches in both kill-holder rounds, and tests/start-lock.test.mjs green on the windows test-kit legs of the same run.`
- Comments gains:
  `- 2026-11-08 (orchestrator, Owner Proxy round 27 Q1): the victim-apart counting and the S4 staleLockLeft record are accepted as measurement corrections (budget 0 unchanged). Under the new counting, archived pre-16 runs stay RED on failed-launches in S3/hung 62/62 linux and 43/43 windows, and in linux S3/short 61/62, but in windows S3/short only 34/43 (the victim alone in 9), so the windows removal also rests on the seam tests (Acceptance). staleLockLeft is recorded only; a judged check on it is a separate question. 16's tree restarts the matching count for S3/short, S3/hung, S3/omp and S4/short on both legs.`

**`spec.md` §18, METRICS.md, ADR-0003:** as in condition 1.

**`issues/17-…`, INDEX.md:** no change.

---

## Shared understanding

CONFIRMED for this question. Open branches I still see (none blocks 16 once condition 4 is met):
- **Pre-merge run 42507303528 is in progress.** It confirms and does not decide. A RED on either removed name, a condition 2 harness failure, or a windows seam-test failure comes back with the numbers.
- **A lock left after a respawn (S4 `staleLockLeft`)** has no budget and no owner. If the orchestrator wants it judged, it comes back as its own question with its distribution on 16's tree.
- **The windows suspended proxy** left by a holder killed inside `spawn()` remains 17's (16's report, "Left for other tickets"). On windows, a kill-holder round that hits it could show a spawning second proxy, which is 16's `exactly-one-proxy-after-round`, and an `orphans` RED, which is 17's. The existing owners and Round 22 Q1 condition 4's attribution watch cover both.
