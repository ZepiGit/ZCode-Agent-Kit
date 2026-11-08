# Round 25 (2026-11-08) — windows S5/short above the unstable band's bound (30.23 %/1k > 30)

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–24 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only on the worktree; downloads in new directories under `/home/AgentKit/overhaul-tools/ci-art/`):
- `OWNER-PROXY-BRIEF.md`, `rounds/round-25.md`; DECISIONS Rounds 13, 17, 21 and 24 in full; issues 30, 36, 74 (and 21's diff); METRICS.md S5 tables (lines 258–327, 402); RUNLOG to 13:25Z; STATE.md.
- The windows and ubuntu `memory-budget` job logs (jobs API) of **every** `ci.yml` run from 42404639968 to 42484868282: 59 runs, 58 with an S5 line (42467078897's memory legs never ran: setup-bun HTTP 504). Copies: `ci-art/r25-logs/{win,lin}/<run>.log`, list `runs.txt`.
- The `memory-budget-windows` artefacts of 42480631098 and 42483637377 (`ci-art/r25-art-<run>/S5-short/*/summary.json`).
- The windows `test-kit` job logs of every failed test-kit job in the 30 runs 42446391907 … 42484868282 (`ci-art/r25-logs/tk/`, `job-128731568530.log`).
- Git (read-only): `git diff --stat 16bfaa2 0f87d20` (staging/21 = 16bfaa2 + ticket 21), `git diff f383d6b 16bfaa2 -- mcp/ lib/mcp-bridge.mjs tests/memory/…`, ancestry of each run's head against 7555b87 (36), 16bfaa2 and f383d6b (13); `tests/memory/scenarios/s5-mcp.mjs`, `tests/memory/lib/ratchet.mjs:51-104`.

**Corrections to the round's facts.**
1. **42480631098 has a second failure that the round does not mention.** `test-kit (windows-latest, 26)` (job 128731568530) fails `zcode-proxy-src/src/auth/login-store.test.ts:181`, "kit setup, enable/disable and provider/import/account flags work through the real wrapper": it timed out after 5,000 ms (5,372 ms), and `runKit(["accounts","enable"])` returned status `null`. This test failed in none of the other failed test-kit jobs of the 29 other runs from 42446391907 to 42484868282. Ticket 21's diff touches `zcode-proxy-src/src/index.ts`, `server/server.ts`, `config/loader.ts` and the new supervisor, which is code the real wrapper runs. So the run is not "RED on one line".
2. **30.23 is not the only value above the band. Ticket 30's restaged run 42483637377 has finished and fails on the same line at 34.62 %/1k commit, with trend true** (WS 19.17; window medians 70.9, 74.4, 76.9, 76.3, 77.4, 78.7 MB; 3 rising windows, net rise 11 %; slope 26.24 MB/1k on a mean of 75.8 MB). Its windows job also has `S1/short: RED but not listed` (growth:proxy 5.18 %/1k commit, WS 2.46, trend true). STATE.md still plans "merge … 21 (42480631098), 30 (42483637377)". Neither run is green.
3. **staging/21 runs the same bridge code as the 40 other runs on the ticket-13 tree without 36.** Between 13's merge (f383d6b) and 16bfaa2, the only change under `mcp/`, `lib/mcp-bridge.mjs`, `s5-mcp.mjs` and `tests/memory/lib/` is `ratchet.mjs` (67's owners map), which judges values and does not produce them. Ticket 21 adds nothing under `mcp/`, `lib/`, `tests/`, `.github/` or `package.json`. So 30.23 is the tail of unchanged code. Ticket 36's projection cannot explain it, because staging/21 does not contain 36 (bridge `empty` 77 MB; trees with 36 read 66–67).
4. **Neither leg shows ticket 13's "shift" in CI.** Windows median: 18.14 before 13 (n = 39) and 18.05 on the 13 tree without 36 (n = 40, excluding 42480631098). Linux median: 42.63 before 13 (n = 37) and 42.12 on the 13 tree (n = 41). **EVIDENCE MISSING: the source of "linux median 39.54 → 44.28".** CI does not reproduce it. So 36's "compounded ~31" projection has no measured basis. Its ×1.09 base effect alone remains plausible on windows: one run's mean is 75.8 MB with 36 against 80.8 MB without it.
5. **The windows tail is heavier than Round 13 measured.** I recomputed from the job logs (commit, the gate metric):

   | set | n | min | median | mean | sd | max | > 30 |
   |---|---|---|---|---|---|---|---|
   | Round 13's 28 (to 42404639968) | 28 | 14.27 | 18.25 | 19.04 | 3.43 | 26.24 | 0 |
   | before 13, after Round 13 (42408170742–42424608767) | 11 | 14.74 | 17.98 | 17.75 | 1.72 | 20.34 | 0 |
   | 13 tree without 36 (42425069025–42481592284) | 41 | 11.99 | 18.08 | 19.06 | 4.31 | **30.23** | 1 |
   | trees with 36 (42454650683 15.43, 42469209389 18.14, 42483637377 **34.62**, 42483787372 19.82, 42484868282 24.83) | 5 | 15.43 | 19.82 | 22.57 | 7.56 | 34.62 | 1 |
   | all | 85 | 11.99 | 18.14 | 19.09 | 4.08 | 34.62 | 2 |

   - Per-run P(> 30): all 85, normal 0.37 % / log-normal 0.94 %, empirical 2/85 = 2.35 % (95 % Clopper-Pearson 0.29–8.24 %).
   - On the 13 tree scaled by 36's ×1.09 (the base every tree now has): 2.47 % / 3.72 % (1.38 % / 2.61 % without 42480631098).
   - Round 13 Q1 condition 2's 0.07 % / 0.39 % is superseded.
   - The 13-tree tail had already come near the bound: 27.72 (42436354758) and 29.44 (42435917288).
   - In absolute terms, 30.23 is 24.42 MB/1k (mean 80.8 MB, window medians 76.7, 79, 80.7, 81.1, 83.2, 82.6, no rising run, net 7.7 %, trend false). Every other S5 check was GREEN: procPeak 74.6 WS, reboot cost 4 MB, 0 failures, 0 orphans, units self-test ok, `@@JOB applied=1`.
6. **"74 replaces the measurement this tail lives in" is wrong.** Round 24 Q1 condition 3 carries *this exact quantity*, computed exactly as now, into 74's `warm-up-growth:mcp-bridge`. It is RED above 30 %/1k on windows commit regardless of trend, with no listing. So the tail survives 74 as a hard check. 74's exit needs ≥ 10 windows runs with the warm-up value under 30. At 1.4–3.7 % per run, that fails by chance in 13–32 % of attempts (P(10 of 10 pass) 87.0–68.4 %).

---

## Q1 — windows S5/short `growth:mcp-bridge` 30.23 %/1k on commit (bound 30)

**DECISION:** REJECTED in part.

Accepted:
- The 30 %/1k band bound, the 5 %/1k budget, `growth()` and every other S5 check stay exactly as they are. **I loosen no bound.**
- **The S5 failure of 42480631098 is not charged to ticket 21** (corrections 3 and 5).
- An interim signature (vi) for tickets whose diff cannot change the S5 value, with a hard ceiling of 35.

Rejected or corrected:
- (i) **"The run does not count against ticket 21."** Only its S5 line is excused. The windows test-kit Node 26 failure (correction 1) is undecided and covered by no signature. So **42480631098 is a failed pre-merge run for 21, and 21 does not merge on it.**
- (ii) **"Record it as the first windows value above the band"** is incomplete. 42483637377 (ticket 30, 34.62, trend true) is the second. Ticket 30's diff touches `mcp/**`, so (vi) does not cover it. Under Round 24 Q1 condition 1, it is a disagreement of 30's restaged run, so 30 does not merge on it, and it comes back as its own question.
- (iii) **"74 replaces the measurement"** (correction 6). The interim cannot simply end at 74's merge. 74 gains a merge precondition (condition 5).
- (iv) **The prioritisation of 74 "right after 30 merges"** is not decided here. Ordering is the orchestrator's. Today 30 cannot merge (ii), and 74 is blocked by 30 and by condition 5.

**This explicitly departs from:**
- **Round 13 Q1 condition 1 ("value > 30 fails the ratchet, a step change") together with condition 6, Round 6 Q2 condition 4's last bullet and PROMPT §7 Phase 4's revert rule**, for signature (vi) only. The ratchet still prints FAILED above 30 on every run. What changes is the consequence: for an eligible ticket, a value in (30, 35] no longer blocks the merge or causes a revert. **Stated plainly, this loosens the merge consequence for eligible tickets from 30 to 35.** It does not change the measurement, the bound or the band. The reason: the value comes from bridge code byte-identical to 40 runs, and no queued ticket can fix it before 74, while the code that can move the value keeps the full 30 bound.
- **Round 13 Q1 condition 2's risk figures** (superseded by correction 5). The bound itself is unchanged.
- **Round 24 Q1 conditions 3 and 7**: the windows warm-up ceiling's justification ("Round 13's 28-run justification") is stale, so 74's merge gains a precondition. The ceiling value of 30 is not changed by this round.

It is consistent with Round 13's Shared understanding ("a windows S5/short value > 30 … comes back with numbers"; this round is that return) and with Round 17 cross-question condition 2 and Round 21 Q1 condition 6 (same shape, one more signature).

Binding conditions:

1. **Signature (vi), interim, amends Round 17 cross-question condition 2.** A staged or post-merge run whose windows `memory-budget` failure is only `S5/short: unstable growth:mcp-bridge <v> %/1k (commit) is above the 30 %/1k bound` does not count against the ticket, does not block its merge and causes no revert, when all of the following hold:
   - 30 < v ≤ **35** on commit, trend either way;
   - every other S5 check is GREEN: `procPeak:mcp-bridge` ≤ 150 MB WS, `orphans` 0, `bridge:reboot-cost-of-history` ≤ 20 MB, `bridge:task-failures` 0;
   - the growth check has a value and is not `insufficient`, `@@JOB applied=1` is printed, and the units self-test passed;
   - every other failure of the whole CI run matches another open signature.

   Any S5 value above 35, any other S5 RED, or a measurement gap fails as before.
2. **Ineligible diffs (no exception).** A ticket gets no exception if its diff touches any of:
   - `mcp/**`, `lib/mcp-bridge.mjs`, `tests/memory/scenarios/s5-mcp.mjs`;
   - `tests/memory/lib/{verdict,budgets,sampler*,win-*,ratchet}.mjs`, or the `S5/short` entries of `tests/memory/expected-red.json`;
   - the Bun pin, or the Node version of the `memory-budget` job in `.github/workflows/ci.yml` (the bridge runs under Node).

   So 30, 74, 56 and 57 are ineligible.
3. **Recording.** Each occurrence goes into **74's** Comments (74 owns the entry, Round 24 Q1 condition 2) and into the METRICS windows table. Record: run id, tree, commit and WS values, trend, slope MB/1k, mean MB, window medians (from `summary.json`). The first occurrence is 42480631098.
4. **Comes back (with the table; none of these suspends (vi) for eligible tickets meanwhile, except the 35 ceiling, which always fails).**
   - The pre-registered set: the first 20 windows S5/short values on trees that contain ticket 36, any branch. The first five are those in correction 5.
   - **The triggers:**
     - ≥ 3 of the 20 are above 30;
     - or any value is above 35;
     - or the 20-run mean is above 23 %/1k.
   - **Why these thresholds.** 23 is the 13-tree mean × 1.09 (20.77) plus two standard errors of a 20-run mean (sd 4.69): 22.87. Under the per-run rates of correction 5, ≥ 3 of 20 happens by chance 0.25–3.66 % of the time.
   - **Two meanings.** A trigger means a shift on the current base, not a tail, and its owner is an ownership question. If no trigger fires, the 20-run table is the evidence for condition 5.
5. **Ticket 74's merge precondition.** 74 does not merge before two things exist:
   - condition 4's 20-run table in METRICS;
   - an Owner Proxy round that re-confirms or re-decides the windows `warm-up-growth:mcp-bridge` ceiling of 30 on that table.

   The rules for 74's own runs:
   - Signature (vi) never applies to 74's runs (condition 2).
   - A windows warm-up value above 30 in 74's mutant, exit or pre-merge runs follows Round 24 Q1 condition 8: nothing merges in part, and it comes back with all the values. The implementer never changes the ceiling, the window or the task count.
   - (vi) ends when 74 merges.
6. **Run 42480631098 and ticket 21.**
   - The S5 line is (vi)'s first occurrence and is not charged to 21.
   - The windows test-kit Node 26 failure (correction 1) is charged to 21 under the normal rules. No signature covers it, and nothing is rerun until it turns green. If 21's implementer shows, with evidence, that the timeout also occurs on a tree without 21, it comes back as its own question.
   - 21's next pre-merge run is judged with (vi) in force.
7. **Run 42483637377 and ticket 30.** The S5 line at 34.62 with trend true is not excused (30 touches `mcp/**`). Its S1/short line matches Round 17 signature (ii): commit only, 5.18 ≤ 10, and 30 touches neither `zcode-proxy-src/**` nor `s1-proxy-steady.mjs`. Under Round 24 Q1 condition 1, the restage disagrees with 42475847194 (14.5, trend false). So 30 does not merge on it, and the numbers come back as their own question. **EVIDENCE MISSING: whether 34.62 comes from 30's code, from 36's base (30's first staged run lacked 36), or from the tail.** That question needs at least the next 36-tree values without 30 beside it.
8. **Nothing else changes:**
   - the 5 %/1k budget, `MEMORY.growth`, `growth()`;
   - the windows band (5 < v ≤ 30) and `UNSTABLE`;
   - the S5 budgets (150 MB, 20 MB, 0);
   - Round 7 Q1's metric split;
   - the linux S5/short entry and its flip mark;
   - Round 24's 74 rule (1,200 tasks, window 600–1,200, linux 55 / windows 30 warm-up ceilings).

   No ratchet code changes; (vi) is a merge-gate rule the orchestrator applies.
9. **Records.**
   - METRICS gains the 85-run windows table (correction 5) under the Round 13 table, and keeps it current for condition 4.
   - RUNLOG records this round's departures (above), corrections 1, 2 and 4, and that STATE's planned merges of 21 on 42480631098 and of 30 on 42483637377 do not happen.

**Rationale:** The numbers show a heavier tail on unchanged bridge code, not a regression by ticket 21. staging/21 executes the bridge exactly as 40 other 13-tree runs did (30.23 commit, 24.42 MB/1k, no trend), and the 85-run history puts the per-run chance of > 30 at roughly 0.4–3.7 % depending on the fit and the tree. With no exception, that tail would block unrelated merges on the primary platform at random, on a defect no queued ticket fixes before 74. Raising the bound would weaken the only windows regression bound on bridge growth for the code that can actually move it. So the answer is the Round 17 shape: the bound stays at 30 for every ticket that touches the bridge, its measurement or its runtime, and tickets that cannot touch it pass (30, 35] while > 35 still fails.

The recommendation was right on that core and wrong on three facts:
- the run's second failure;
- ticket 30's 34.62;
- 74 inheriting the same tail.

Without condition 5, the exception would never end, and 74's exit would fail by chance in up to a third of attempts.

**Charter:** C1 (bridge growth stays bounded: 30 for code that can move it, a hard 35 ceiling for everyone, and the other S5 checks hard), C7 (windows primary: a gate that holds without random blocks; linux unchanged), C9 (stronger measured evidence: 85 windows and 83 linux runs recomputed; smaller blast radius: one interim signature, no ratchet or budget change), §9 (5 %/1k and 30 unchanged), Round 13 Q1 conditions 1–3 and 6 and Shared understanding, Round 17 cross-question condition 2, Round 21 Q1 condition 6, Round 24 Q1 conditions 1–3, 7–8, PROMPT §7 Phase 4 (no rerun-until-green; no spurious blocks or reverts).

**REVERSIBILITY:** Two-way door (a merge-gate rule, records, ticket text, and a precondition on one ticket's merge). ADR: no.

### Ticket-text changes (exact)

**`issues/74-s5-short-growth-after-retention-bound.md`**
- New Acceptance criterion before "Fallback":
  `- [ ] Windows warm-up ceiling (Round 25 Q1 condition 5): this ticket does not merge before METRICS holds the first 20 windows S5/short values on trees containing ticket 36 and an Owner Proxy round has re-confirmed or re-decided the windows 30 %/1k warm-up-growth ceiling on them (Round 13's 28-run justification is superseded: 2 of 85 windows values exceed 30). Signature (vi) never applies to this ticket's runs; a windows warm-up value above 30 in a mutant, exit or pre-merge run comes back under the Fallback; the ceiling is never changed by the implementer.`
- Comments gains:
  `- 2026-11-08 (orchestrator, Owner Proxy round 25, binding): interim signature (vi): a windows S5/short run whose only failure is the band's bound, 30 < growth:mcp-bridge ≤ 35 %/1k commit, every other S5 check GREEN, does not count against a ticket whose diff touches none of mcp/**, lib/mcp-bridge.mjs, tests/memory/scenarios/s5-mcp.mjs, tests/memory/lib/{verdict,budgets,sampler*,win-*,ratchet}.mjs, the S5/short entries of expected-red.json, the Bun pin or the memory-budget job's Node version; recorded here each time (run, tree, commit/WS, trend, slope MB/1k, mean MB, window medians); ends when this ticket merges. First occurrence: 42480631098 (staging/21, 30.23 commit / WS 42.29, trend false, 24.42 MB/1k on 80.8 MB, medians 76.7, 79, 80.7, 81.1, 83.2, 82.6). Not covered (ticket 30's tree): 42483637377, 34.62 commit / WS 19.17, trend true, 26.24 MB/1k on 75.8 MB, medians 70.9, 74.4, 76.9, 76.3, 77.4, 78.7.`

**`issues/21-health-supervisor-and-graceful-shutdown.md`** Comments gains:
`- 2026-11-08 (orchestrator, Owner Proxy round 25): pre-merge run 42480631098: the windows memory failure (S5/short 30.23 %/1k above the 30 bound) is signature (vi) and not charged to 21 (diff touches no bridge, S5 or measurement code). The run is still a failed pre-merge run: windows test-kit Node 26 fails login-store.test.ts:181 ("kit setup, enable/disable … through the real wrapper", 5 s timeout, accounts enable status null), unexcused and charged to 21 under the normal rules; seen in no other failed test-kit job of runs 42446391907–42484868282.`

**`issues/30-mcp-task-retention-and-idempotency-window.md`** Comments gains:
`- 2026-11-08 (orchestrator, Owner Proxy round 25): restaged run 42483637377 (a53152d, with 36) disagrees with 42475847194: windows S5/short growth:mcp-bridge 34.62 %/1k commit (WS 19.17), trend true, above the 30 bound; signature (vi) does not apply (diff touches mcp/**). Its S1/short line (growth:proxy 5.18 commit only) is Round 17 signature (ii). Under Round 24 Q1 condition 1 the ticket does not merge on this run; the numbers come back as their own question.`

---

## Shared understanding

Open branches I still see:
1. **Ticket 30's restage (34.62, trend true) needs its own question** (condition 7). Is it 30's code, 36's lower base (×1.07 in this run's mean), or the tail? The decision needs the next 36-tree values without 30 beside 30's next run. 74, 31 and 57 wait on it.
2. **Ticket 21's windows test-kit timeout is unattributed** (correction 1). It is 21's to diagnose. It comes back only with evidence that it also occurs without 21.
3. **Condition 4's 20-run windows table on 36 trees** decides whether 30.23 and 34.62 are a tail or a shift. A shift would reopen ownership of the windows S5 growth and the band itself.
4. **The source of the "linux 39.54 → 44.28" shift is EVIDENCE MISSING.** CI shows no shift on either leg (correction 4).
5. **Not decided here, recorded only:** integration run 42484868282 (eaa91b3, 36 + 15's `setup.mjs`) fails windows test-kit Node 24 and 26 on "an old proxy (origin/main) calling the new manager's respawn CLI gets a fresh proxy". That is the combination STATE watches. Its windows S5 is 24.83, inside the band.
