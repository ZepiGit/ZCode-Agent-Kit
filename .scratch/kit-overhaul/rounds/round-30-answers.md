# Round 30 (2026-11-09): ticket 30's round-4 set passed; one linux S1/stalled RED in it

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–29 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-30.md`.
- DECISIONS Rounds 25, 26, 28 and 29 in full. I also read Round 13 Q1 condition 6 for the "restage on a changed tree" precedent.
- The integration worktree at 7f0c368: RUNLOG lines 210–224 (both pre-registrations, the b46596a verdict, the round-4 diagnosis), METRICS lines 602–632 (Round 25's set), STATE.md.
- Ticket 30's issue file at 540752f (`git -C /home/AgentKit/wt/t30 show HEAD:…`): the Round 29 verdict comment and the implementer's round-4 entries (root cause, fix d8b34db, mutations M1–M17, the addendum).
- Git (read-only): `git diff --stat e84971f c6ead53`, the full diff of `job.mjs`, `lib/ratchet.mjs` and `expected-red.json` on 30's branch, `git diff --stat f56c46d e84971f` (failed-tree base against new-tree base), `git diff e84971f HEAD` (tip since the build), `git diff HEAD...origin/staging/16c`, and the PR merge base of every run.
- Raw job logs `ci-art/t30s/<run>-{windows,ubuntu}.log` and `ci-art/t30r/` (29-character prefix stripped). I re-extracted every S5/short check line on all 40 legs and did not use `values.txt`.
- Every archived log under `ci-art/` that contains a linux S1/stalled loop. I deduplicated by the loop id (`S1-short-stalled-<time>-<hex>`) and took the platform from the summary path (`/home/runner/…` against `D:\a\…`).
- `gh run view --json jobs` for the 10 t30s runs. I streamed the ubuntu `memory-budget` job logs of 11 recent runs not archived (42513423687 … 42543302875) through `grep` and saved nothing.

**Recomputed facts and corrections to the round.**

1. **Confirmed: the S5/short verdict on tree e5b2c50.**
   - Windows `growth:mcp-bridge` on commit: 17.1, 16.67, 26.04, 18.17, 21.16, 23.53, 19.72, 20.43, 26.59, 20.0. That is n 10, mean 20.94, sd 3.46, min 16.67, max 26.59. Trend is false in 10 of 10, and the windows S5 loop is GREEN outright in all 10.
   - Linux: 42.52, 44.14, 45.09, 42.81, 38.86, 34.85, 37.78, 40.39, 39.42, 37.67. That is mean 40.35, sd 3.24, all ≤ 55 (listed under 74, as expected).
   - Every other S5 check is GREEN on all 20 legs:
     - procPeak: windows WS 59.1–60.3 MB, linux 91.5–93.9 MB;
     - reboot cost 0–2 MB;
     - 0 task failures and 0 orphans.
   - Round 25's set (METRICS 606–632) is complete: n 20, mean 21.13, max 34.62, 1 value above 30, none above 35. No trigger fires.
2. **The measured tree is e5b2c50 plus one docs line, and it was fixed before any value existed.**
   - Every run checks out "Merge <staging/30s head> into 8d243c2". 8d243c2 is e84971f plus one RUNLOG line (the pre-registration itself), so it is the same shape as staging/30r (merged into 6875cd3).
   - All ten heads carry tree e5b2c50.
   - 8d243c2 was committed at 00:52:51Z. The first run was created at 00:52:59Z.
3. **The fix is the only S5-relevant difference between the failed tree and the new one.** Between the failed tree's base f56c46d and e84971f, nothing changed under `mcp/`, `lib/mcp-bridge.mjs`, `tests/memory/`, `.github/`, `package.json` or `zcode-proxy-src/`. The only changes were `lib/proxy-lifecycle.mjs` (77), `scripts/fixture-ports.mjs` and kit tests (75).
   - Windows mean, old tree against new: 27.33 against 20.94, Welch t 3.48. Trend true: 6 of 10 against 0 of 10.
   - New tree against Round 25's without-30 subset (20.42, n 19): t 0.41.
   - **This closes Round 25 Q1 condition 7's EVIDENCE MISSING.** The 34.62 of 42483637377 and the b46596a set came from 30's per-request retention scan before the fix. They did not come from 36's base or from the tail.
4. **How the new set came about (process).**
   - Round 29 Q1 condition 2 says a failed value "sends 30 back with all values, and nothing is rerun". The orchestrator read "back" as "back to its implementer". It then pre-registered a fresh set on a new tree as its own decision (RUNLOG 00:52Z), and no Owner Proxy round looked at it before the runs.
   - The failed tree was not rerun. The new tree changes S5-executed code at a diagnosed cause:
     - the new constant-lookup-work test is RED on the pre-fix dist and GREEN on the fix;
     - M17 (full scan per request) is killed;
     - minor GCs match the tip after the fix (321 against 319.7).
   - The verdict and the count are unchanged. This is Round 13 Q1 condition 6's shape, except that the cause was shown by the implementer and is confirmed here, not decided here beforehand.
5. **Only one job failed in the 10 runs: ubuntu `memory-budget` of 42542646289.** The other 79 jobs are GREEN. The 10th run 42543167527 is 8/8 GREEN, but it cannot serve as the pre-merge run, because the tip has moved: dfb9b43 (ticket 38) and 7f0c368 (Round 29 Q1 condition 3).
6. **What the tip changed since e84971f is off S5's path.**
   - Ticket 38 touches `cli/commands/doctor.mjs`, `lib/proxy-doctor.mjs`, `proxy/zcode-proxy-manager.mjs`, `pack/verify-payload.mjs`, `package.json` (only the `test` script list) and tests.
   - staging/16c (in flight) touches `tests/memory/lib/completeness.mjs`, the S3/S4 scenarios, the S3 entries of `expected-red.json`, `package.json` (test list) and tests.
   - None of this is on Round 25 Q1 condition 2's S5 list.
7. **Confirmed: the S1/stalled RED is the only failure in 42542646289.**
   - The values: `growth:proxy` 5.5 %/1k, trend true; `procPeak:proxy` 206 MB; `count:proxy` 1; `orphans` 0. The ratchet prints "S1/stalled: RED but not listed in expected-red.json (linux)".
   - **Correction: S1/stalled has no `steady` check.** Its four checks are `growth:proxy`, `procPeak:proxy`, `count:proxy` and `orphans`. Recommendation 2's clause "and steady GREEN" cannot be checked.
8. **Correction: 30's diff on `tests/memory/` is five files, not three.** They are `expected-red.json`, `job.mjs`, `lib/ratchet.mjs`, `loop.test.mjs` and `verdict.test.mjs`.
   - The last two are test files. The memory job does not run them.
   - The `job.mjs` change is one markdown label string ("ticket 30's ≥ 10 runs" → "ticket 74's"). The `ratchet.mjs` change is a comment. The `expected-red.json` change re-labels both S5/short owners to 74.
   - None of these can change a measured S1 value.
9. **Correction: the history is 135 distinct linux S1/stalled executions, not 197.** The archive holds 267 raw occurrences, with copies of the same loop in several directories. I deduplicated by loop id.
   - The 135: median 1.58 (confirmed), mean 1.41, sd 1.94, min −5.81, max 5.5. Seven are above 4.5 (5.5, 4.95, 4.88, 4.81, 4.81, 4.75, 4.56), and 5.5 is the only one above 5.
   - The 11 streamed runs (0.45, 4.5, 3.19, 1.62, 4.01, 0.97, 2.14, 2.05, 1.16, 1.64, 0.3) are all GREEN.
   - **Combined: 1 RED in 146, 0.68 % per run (95 % Clopper–Pearson 0.02–3.8 %).**
   - A normal fit predicts P(> 5) = 3.2 %, but only 1 of 135 values is above 5, so the upper tail is lighter than normal.
   - The round's conclusion ("max, first above 5") holds.
10. **Record only: the spread in the t30s burst.** Its ten S1/stalled values range from −5.81 to 5.5 (sd 3.43). The other 125 values have sd 1.79, and the means are 1.27 against 1.43.
    - The other trees that contain 77 (8 streamed, plus t73b) read sd 1.38. The staging/30r burst reads sd 1.44.
    - A spread on both sides with an unchanged mean is what measurement noise looks like, not a leak, which would raise the mean. It is local to one burst of 10 runs started within 7 minutes, not to the tree.

---

## Q1 — does ticket 30 merge, and what about the linux S1/stalled RED in run 42542646289?

**DECISION:** REJECTED in part.

Accepted:
- **Item 1.** 30 passes its pre-registered verdict on tree e5b2c50, and it merges after one confirming pre-merge run on the current tip (condition 2). I ratify the new-tree pre-registration explicitly here, under condition 1.
- **Item 2, first half.** The linux S1/stalled RED of 42542646289 is not charged to 30.
- **Item 2, the triage ticket.** It records values only and comes back on its triggers. I add one trigger and one question (condition 4).
- **Item 3.** A linux S1/stalled RED in 30's confirming run comes back with both values, and nothing is rerun.

Rejected:
- (i) **Interim signature (viii)** (condition 5). The measured rate does not support a standing exception: 1 RED in 146 runs, 0.68 % per run. That is below Round 17 Q3's 1 % design bar, against the 1.4–3.7 % that justified (vi) and the about 4 % that justified (vii).
  - Its 6 %/1k ceiling is the one observed value plus 0.5, with no distribution behind it.
  - Its "steady GREEN" clause names a check that S1/stalled does not have (correction 7).
  - Until ticket 79 answers, each linux S1/stalled RED comes back with its values, as 20's S1/short RED did in Round 28.
- (ii) **"Every other S1 failure in 197 values"** is corrected to 135 + 11 distinct runs (correction 9). No conclusion changes.

Consistency with earlier decisions:
- Consistent with Round 29 Q1 condition 2 ("nothing is rerun"). The failed tree b46596a was not rerun, and its 10 values stay on record.
- Consistent with Round 29 Q1 condition 3 (re-merge, one confirming run), Round 26 Q1 condition 2 (failures outside S5 do not remove S5 values) and Round 28 Q1 condition 1 (a RED that a diff cannot reach is decided on its distribution, for the one run only).
- Round 25 Q1 conditions 2 and 4 and signature (vi) are unchanged. So are Round 28's (vii) and ticket 78.
- It *clarifies* Round 29 Q1 condition 2. "Sends 30 back" means back to its implementer and to a new pre-registered set on a new tree. It never means a rerun. From now on, a fresh set after a failed verdict needs an Owner Proxy round before its first run (condition 1).

**I loosen no bound.** These are all unchanged:
- the 5 %/1k budget, the trend rule and `growth()`;
- the windows band (5 < v ≤ 30 commit) and the linux ≤ 55 judgement;
- the S5 budgets (150 MB, 20 MB, 0);
- S1's 250 MB procPeak and count/orphans budgets;
- (vi) with its hard 35, and (vii).

Binding conditions:

1. **The new set is ratified, once.**
   - staging/30s (tree e5b2c50, 42542570923 … 42543167527) is ticket 30's pre-registered set under Round 29 Q1 condition 2. It counts because:
     - it was registered before its first run;
     - it uses the same verdict and count as the failed set;
     - on S5-executed code, the tree differs from the failed one only by the fix for the diagnosed cause (correction 3).
   - b46596a's set stays on record as "failed, pre-fix" in METRICS and in 30's Comments.
   - If 30's confirming or post-merge run fails S5, it comes back to an Owner Proxy round with all values before any new set is registered. The orchestrator does not pre-register one itself.
2. **Merge (Round 29 Q1 condition 3).**
   - Re-merge `ticket/30` (540752f or its successor, with no change under `mcp/`) onto the current tip, then make one pre-merge CI run. It confirms and decides nothing new:
     - the windows band applies;
     - linux S5/short is listed on growth only (≤ 55 from the printed value);
     - every other S5 check is GREEN;
     - every other job is GREEN under the normal rules.
   - **Transfer rule.** The 10 runs carry over to the re-merged tree only if the tip since e84971f has merged nothing on Round 25 Q1 condition 2's S5 list:
     - `mcp/**`, `lib/mcp-bridge.mjs`, `tests/memory/scenarios/s5-mcp.mjs`;
     - `tests/memory/lib/{verdict,budgets,sampler*,win-*,ratchet}.mjs`;
     - the Bun pin, or the memory job's Node version.
   - Today that holds (correction 6). If the tip touches that list before the re-merge, 30 comes back.
   - A windows S1/short RED in that run comes back under Round 28 (30 is ineligible for (vii); Round 29 Q1 condition 5).
   - A linux S1/stalled RED comes back with both values (item 3): its value, 5.5, and this round's record. Nothing is rerun. No signature applies.
   - Then 30 merges alone. Revert: 30 may be reverted on its own.
3. **Run 42542646289 and ticket 30.**
   - The run's S5 values count, under Round 26 Q1 condition 2.
   - Its linux S1/stalled RED is not charged to 30:
     - 30's S1-reachable edits are one markdown label string and one comment (correction 8);
     - 5.5 lies inside a 146-run history with 1 RED;
     - every other S1/stalled check is GREEN.
   - This covers this run only. It is no standing exception for 30 or for this key.
4. **Ticket 79 (the next free number), `Status: needs-triage`: "linux S1/stalled growth:proxy: tail and burst spread".**
   - It owns no name and lists nothing.
   - **What it records:** for every linux S1/stalled run from now on, in its Comments or a METRICS table:
     - run id, tree, `growth:proxy` value, trend, `procPeak:proxy`;
     - the window medians from `summary.json` where the artefact exists;
     - how many CI runs were created in the 10 minutes before it.
   - It back-fills the 146 values above, with run ids.
   - **What it asks:**
     - (a) Is the upper tail stable, or did any merged tree shift it?
     - (b) Is the spread in the t30s burst runner contention (correction 10) or a tree effect?
     - (c) If a rule is needed, which one holds a false-RED rate ≤ 1 % without loosening the 5 %/1k budget or the trend rule?
   - **When it comes back:**
     - after 20 more linux runs;
     - earlier on a second RED within any 20 consecutive linux runs;
     - earlier on any value above 6 %/1k;
     - earlier on any linux S1/stalled RED in a ticket's own staged or pre-merge run.
   - Until then, there is no change to the budget, the trend rule, `growth()` or the list.
5. **No signature (rejected (viii)).**
   - Until ticket 79 is answered, a staged or pre-merge run whose only unexcused failure is linux S1/stalled RED comes back to an Owner Proxy round with its value, the diff's paths and the ticket 79 table. Nothing is rerun.
   - A post-merge run follows PROMPT §7 Phase 4 unchanged.
   - Departing from the default needs measured evidence of a rate above 1 %. Ticket 79 gathers it.
6. **Records.**
   - RUNLOG records:
     - this round;
     - the ratification and the rule of condition 1;
     - the correction of the history count (135 + 11 distinct, not 197);
     - that run 42542646289's S1/stalled RED is not charged to 30.
   - METRICS gains:
     - the staging/30s table (both legs, every S5 field, per run), printed beside the failed b46596a set and Round 25's set, with the Welch figures of correction 3;
     - the "with 30" subset split into pre-fix (42483637377 and b46596a, n 11) and fixed (e5b2c50, n 10).

**Rationale:** The pre-registered verdict holds on every clause, recomputed from the raw logs. Windows is 16.67–26.59, trend false in all 10, with a mean indistinguishable from the without-30 set (t 0.41). Linux is ≤ 45.09. Every other S5 check is GREEN on all 20 legs, and Round 25's set is complete with no trigger. The change from the failed tree is exactly the fix for a cause that was shown in three ways: the minor-GC excess, the late-window commit gap, and a lookup-work test that is RED before the fix. So the new set is evidence, not a second roll of the same dice, and I can ratify it. I close the door for later sets so that the orchestrator cannot pick its own retries. 30 is a finished C1 fix: S5/long peak 238.6 → 111.4 MB, and M1/M1b/M17 are killed in `test:mcp`. It should merge after the one confirming run Round 29 requires. The linux S1/stalled RED cannot come from 30's edits, which are a label and a comment, and 5.5 is the tail of a 146-run history. Charging it to 30 would be the random block that Rounds 9, 13, 15 and 28 refused. The standing signature fails C9's first test, though. At 0.68 % per run, the default rule rarely blocks anyone and no exception is needed. Its ceiling was fitted to the value it would excuse, and one of its clauses names a check that does not exist. So "do nothing" plus a recording ticket is the stronger-evidence, simpler and smaller-blast-radius answer.

**Charter:** C1 (the retention bound lands on 10 runs per leg plus a confirming run; no bound loosened; the proxy growth gate stays hard), C7 (windows decides the S5 verdict; linux judged ≤ 55; the linux tail recorded), C9 (stronger measured evidence: 40 legs and 146 linux S1/stalled values recomputed; simpler and smaller blast radius: no new signature, a recording ticket, one ratification with a closed door), §9 (5 %/1k, 30, 55, 150 MB, 20 MB and 0 unchanged), Round 13 Q1 condition 6, Round 17 Q3 condition 2 (≤ 1 % design bar), Round 25 Q1 conditions 2, 4 and 7, Round 26 Q1 conditions 2 and 4, Round 28 Q1 conditions 1 and 5, Round 29 Q1 conditions 2, 3 and 5, PROMPT §7 Phase 4 (no rerun-until-green; no merge on an unattributed RED).

**REVERSIBILITY:** Two-way door: a merge that is revertible on its own, a recording ticket, a process rule and records. ADR: no.

### Exact text changes

**`issues/30-mcp-task-retention-and-idempotency-window.md`**, add under `## Comments`:

```
- 2026-11-09 (orchestrator, Owner Proxy round 30, binding): the round-4 set on staging/30s (tree e5b2c50, 42542570923..42543167527, pre-registered at 00:52Z before the first run) is ratified as this ticket's Round 29 Q1 condition 2 set and PASSES: windows commit 17.1, 16.67, 26.04, 18.17, 21.16, 23.53, 19.72, 20.43, 26.59, 20.0 (mean 20.94, trend false 10/10; t 0.41 against the without-30 mean 20.42, t 3.48 against the failed b46596a set), linux 34.85-45.09 (all <= 55), every other S5 check GREEN on all 20 legs, Round 25's set complete with no trigger. The 34.62 of 42483637377 and the b46596a set are attributed to the pre-fix per-request retention scan (Round 25 Q1 condition 7 closed). Merge: re-merge onto the current tip and one confirming pre-merge run (band in force, linux listed on growth only, every other S5 check and every other job GREEN); the 10 runs transfer only if the tip since e84971f touched nothing on Round 25 Q1 condition 2's S5 list. Run 42542646289's linux S1/stalled RED (growth:proxy 5.5 %/1k, trend true; procPeak 206 MB, count 1, orphans 0) is not charged to this ticket (its S1-reachable edits are a label string in job.mjs and a comment in lib/ratchet.mjs); a linux S1/stalled or windows S1/short RED in the confirming run comes back with its values; nothing is rerun. A further failed S5 set comes back to an Owner Proxy round before any new set is pre-registered.
```

**New `issues/79-linux-s1-stalled-growth-tail.md`:**

```
# 79: linux S1/stalled growth:proxy: tail and burst spread (needs triage)

**Status:** needs-triage
**Blocked by:** none

**What to build:** nothing yet. Record every linux S1/stalled run from 2026-11-09 on (run id, tree, growth:proxy %/1k, trend, procPeak:proxy, window medians from summary.json where the artefact exists, number of CI runs created in the 10 minutes before it) and back-fill the 146 distinct values recomputed in Owner Proxy round 30 (135 archived under ci-art, deduplicated by loop id, plus 11 streamed; 1 RED: 42542646289, 5.5 %/1k, trend true). Questions for an Owner Proxy round: (a) is the upper tail stable or did a merged tree shift it; (b) is the wider spread of the staging/30s burst (sd 3.43 against 1.79, mean unchanged) runner contention or a tree effect; (c) if a rule is needed, which one holds a false-RED rate <= 1 % without loosening the 5 %/1k budget or the trend rule. This ticket owns no name and lists nothing; no signature applies meanwhile.

**Comes back:** after 20 more linux runs; earlier on a second RED within any 20 consecutive linux runs, on any value above 6 %/1k, or on any linux S1/stalled RED in a ticket's own staged or pre-merge run.
```

**`issues/INDEX.md`:** add row 79 (`linux S1/stalled growth:proxy: tail and burst spread`, blocked by none, `needs-triage`). No other edge or status changes.

**METRICS:** the staging/30s table and the pre-fix/fixed subsets (condition 6).

---

## Shared understanding

Open branches I still see:
1. **30's confirming run** can still fail by chance on keys 30 cannot reach. Windows S1/short is about 4 % per run (Round 28; 30 is ineligible for (vii)), and linux S1/stalled 0.7 % (up to 3.8 %). Either one comes back with values.
2. **Linux S1/stalled tail and the t30s burst spread** (ticket 79). Is it contention or a tree effect? Until it answers, each RED comes back to a round.
3. **74's question (Round 29 Q1 condition 8) is unchanged.** Signature (vi) has no end date until a 74 rule merges, and linux S5/short has no value ceiling once 30 merges (Round 17's branch).
4. **Record only: at the 500 bound, each new terminal task still costs one scan and sort** (30's implementer, "Left open"). S5/short does not reach the bound, and S5/long was GREEN with it.
