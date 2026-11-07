# Round 11: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–10 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself:
- `ci-art/t09-paired-1fRC/memory-budget-{linux,windows}/measure-S1-burst1.{json,md}`. I recomputed everything from the per-run `reps` in the JSON. All 144 runs are valid. The proxy's runtime Bun matches its arm in every run (`1.4.2+744846f84`, `1.4.3+c6da4a4d3`, `1.4.4+38afee6c8`). No run is above 400 MB.
  - **Linux**, runs above 250 MB: 5 / 14 / 13 of 24. Medians: 219.4 / 272.8 / 252.6 MB. Maxima: 260.5 / 331.4 / 333.2 MB.
  - Linux one-sided Fisher against 1.4.2: 1.4.3 p = 0.0086, 1.4.4 p = 0.0178. Both stay ≤ 0.05 after a Holm correction for the two comparisons. A one-sided Mann-Whitney test on the values agrees: z = 3.50 (p ≈ 2e-4) and z = 4.11 (p ≈ 2e-5).
  - All five 1.4.2 exceedances sit between 251.3 and 260.5 MB. The 1.4.3 and 1.4.4 tails reach 331–333 MB.
  - **Windows**, runs above 250 MB: 12 / 17 / 19 of 24. Medians: 250.1 / 254.45 / 257.7 MB. Maxima: 291.5 / 296.1 / 292 MB.
  - Windows one-sided Fisher against 1.4.2: p = 0.119 and 0.034. The 0.034 does **not** survive Holm (its threshold is 0.025), and Mann-Whitney on the values gives p = 0.20 and 0.12.
  - Environment: both legs ran on an Intel Xeon Platinum 8573C with 4 cores. Linux is cgroup v2-only, with `constrainedMemory` = MemoryMax = 3 GiB, and Windows runs under a 3G Job Object. The values are identical across arms.
- Run 42352122623 (`gh run view`): staging/09 e407916.
  - Both `memory-budget` legs and both `ux-before` legs are green.
  - Each of the 4 `test-kit` legs fails on exactly one test: "measurement mode is off by default … the marker is not committed", which is the marker guard.
- Runner image, from the ubuntu `memory-budget` job logs: runs 42316982634 (1.4.2, 1/24), 42347506810 (1.4.4, 12/24), 42344393581 (pre-merge) and 42352122623 (paired) all ran on `ubuntu-26.04` 20261101.186.1, provisioner 20261028.624.
- `r8-measure-nGEr` (Linux 1.4.2: 1/24, median 234.4, max 262.1) and `t09-measure-XAT9` (Linux 1.4.4: 12/24). **EVIDENCE MISSING: the CPU model and core count of the run 42316982634 runner.** The pre-paired artefacts do not record the environment, and the job log does not show it. So "same runner image" holds, but "same hardware class" is unproven.
- Recomputed binomials, P(median of n RED) = P(≥ ⌈n/2⌉ of n above 250):
  - at p = 5/24 = 0.2083: n = 5 → 6.45 %, n = 7 → 3.83 %, n = 9 → 2.32 %;
  - at pooled p = 6/48 = 0.125: n = 5 → 1.61 %, n = 7 → 0.62 %.
  - The largest p that is still stable unlisted is 0.135 / 0.189 / 0.225 / 0.251 for n = 3 / 5 / 7 / 9, which is at most 3 / 4 / 5 / 6 of 24.
  - Pooled 1.4.2 (6/48) against 1.4.3 and against 1.4.4: Fisher p = 8.5e-5 and 2.9e-4.
  - The two 1.4.2 CI samples: 5/24 against 1/24 gives a one-sided Fisher p of 0.094. The paired run's 1.4.2 arm has a *lower* median than run 42316982634's (219.4 vs 234.4), but a heavier near-budget tail.
  - The orchestrator's third-sample bounds are correct: pooled p ≤ 0.181 for up to 7/24 more, and 0.194 at 8/24.
- `tests/memory/lib/budgets.mjs` `REPEATED` (S1/burst1 n = 5; its comment says "Round 8 Q1 condition 3 may raise it (≤ 9)"), `lib/repetitions.mjs` `chooseRepetitions(p, {candidates: [3, 5, 7, 9]})`, and `verdict.test.mjs:522`, which pins n = 5.
- Issues 09, 11, 20, 55 and 60, `issues/INDEX.md` (55 already lists 61, so Round 9's open branch is closed), ADR-0006, ADR-0016 (Consequences: "changes the job's Bun pin from 1.4.2 to 1.4.4"), METRICS.md lines 70–128, and `research/bun.md` §1.
- A grep of `issues/` finds no ticket whose design relies on behaviour that only 1.4.3 or 1.4.4 has. The references are titles and blocked-by text only.

---

## Q1 — Which Bun does ticket 09 pin, given the paired run

**DECISION:** REJECTED in part.

**Accepted:**
- **V = 1.4.2 everywhere** (points 1, 3, 4 and 5, with the changes below).
- Linux S1/burst1 stays unlisted, with no `unstable` state and no budget change.
- No third 1.4.2 sample.

**Rejected:**
- **Point 2.** The recommendation calls 1.4.2 "stable" at n = 5 by switching to the pooled estimate (6/48). That contradicts the convention in Round 8 Q1 condition 2 and Round 9 Q1 condition 6, and the one ticket 60 followed: the decision uses the **less favourable** estimate. That estimate is this arm's 5/24, and at n = 5 it gives a 6.45 % false-RED rate per Linux run, above Round 6 Q1 condition 2's 5 % line. The mechanism already decided for exactly this case is to raise n (Round 6 Q1 condition 2, Round 8 Q1 condition 3). It is not to change the estimator after the result is known.
- **The claim that 1.4.4 is "also worse on Windows, the primary platform".** The Windows Fisher p = 0.034 does not survive the two-comparison correction, and the value-based test gives p = 0.12. Windows is information only (Round 10 condition 5) and is not a reason for the pin.

**The branch.** This is not branch (c) by relabelling. It is Round 10 condition 2(a) coming back as a question, and I answer it on the paired data. Round 10's premise for (a) was "the host itself sits in the tail, and Bun cannot be judged". On this host Bun **can** be judged: within one VM, interleaved, both newer releases are significantly worse than 1.4.2 on counts and on values. What (a) still leaves open is only whether the Linux leg is stable on 1.4.2. That is answered by n.

**Explicit contradictions:**
- Round 9 Q1 condition 6 ("n = 5 (`REPEATED`)" unchanged): n becomes 7.
- Round 10 Q1 condition 2's definition of "stable unlisted" at n = 5 (≤ 4 of 24): the job's n now sets that line.
- Round 1 Q15, Round 2 Q10 condition 4 ("Bun 1.4.4 requirement") and ADR-0016's Consequences line: V ≠ 1.4.4, as Round 10 condition 6 foresaw.

Round 10 sent this case back for an owner answer, so this is the intended return path.

Binding conditions:

1. **Pin V = 1.4.2 (Round 10 condition 3, applied as written).**
   - Ticket 09: `bun-version: 1.4.2` in all three `ci.yml` jobs and in release.yml. The extra arms exist only under the paired marker.
   - The release-audit test asserts 1.4.2 exactly, and still rejects 1.4.0 and `node-version: 20`. Today's "no `bun-version: 1.4.2`" assertion is replaced, with this round named as the justification.
   - The v7 actions and the deletion of the nested workflows stay.
   - Ticket 11: installers bootstrap 1.4.2 with its five SHA-256s from the primary source (the GitHub release assets), and pin `@types/bun` to 1.4.2 exactly. The attribution step is moot, and RUNLOG notes that under Round 3 Q9.
   - No per-OS pin and no pin that applies to the memory job only.
2. **Linux stability is settled by n, from the less favourable estimate (Round 6 Q1 condition 2, Round 8 Q1 condition 3).**
   - `REPEATED["S1/burst1"].n` goes from 5 to 7, on both legs: one n, read from one place.
   - At p = 5/24, n = 7 gives a predicted false-RED rate of 3.83 % per Linux run, and 0.62 % at the pooled 0.125.
   - Windows `unstable` still fails at a median above 300 MB. No Windows value in 72 + 48 runs is above 300 (max 296.1), so n = 7 does not make that entry flaky.
   - Cost: two more repetitions per leg, ≈ 38 s on Linux and ≈ 45–52 s on Windows (measured `durationS`: 19 s and 22.7–26 s per run).
   - Tests pin the change RED → GREEN, which justifies changing `verdict.test.mjs:522`:
     - `chooseRepetitions(5/24)` returns 7, and `chooseRepetitions(6/48)` returns 5;
     - `repetitionRule("S1/burst1").n === 7`;
     - an existing median and `unstable` case is re-expressed with 7 repetitions.
   - Nothing else changes: the 250 MB budget, the 400 MB per-repetition ceiling, the metric split (Round 7 Q1), the `unstable` allow-list of one key (Round 9 condition 3), and both `expected-red.json` lists.
   - This is a measurement-precision change inside the range Round 6 allowed (n ≤ 9). It is not a loosening: the median must still be ≤ 250, and every repetition must still be ≤ 400.
   - It lands as its own commit on ticket/09, because it is part of what 09's criterion is judged on.
3. **One pre-merge confirmation run** on the restaged 09, with the marker removed, Bun 1.4.2 and n = 7. It must be green on both legs. It confirms the decision; it does not make it.
   - "Disagree" has the Round 9 condition 7 meaning: a Linux median above 250, a windows median above 300, a ceiling breach, or any non-median RED.
   - On disagreement, the numbers come back as a question. Nobody reruns until green.
   - Ticket 09's criterion reads: "all CI legs and both `memory-budget` legs green on Bun 1.4.2 with the unchanged `expected-red.json`".
4. **One owner for the newer Bun (Round 10 condition 4, with a corrected title and a fixed re-entry rule).**
   - File a `needs-triage` ticket, blocked by 20 and by nothing upstream, titled "Bun ≥ 1.4.3 raises the S1/burst1 proxy peak on the CI runners".
   - It carries:
     - the four earlier distributions and both paired legs;
     - the environment table;
     - the facts that the hybrid-cgroup hypothesis is ruled out (v2-only) and that the step appears at 1.4.3;
     - the local contrast: AMD EPYC 7B12 with 8 cores, 1.4.2 2/20 and 1.4.4 0/20. The difference between the 4-core Intel runner and the 8-core AMD machine is a hypothesis, not a finding.
   - It also lists the 1.4.3 fixes the kit gives up by staying back (`research/bun.md` §1):
     - memory returned from threads blocked in `Atomics.wait()` (the captcha worker);
     - the `import.meta` string leak on Worker termination (solver recycle);
     - the `fetch()` Response/AbortSignal and compressed slow-reader leaks;
     - the `Bun.serve` `req.clone()` leak;
     - macOS `rss` under-reporting.

     Each entry records whether a kit path hits it.
   - **Re-entry rule.** It applies after 20 merges and at each new Bun stable release, using the paired mode with the pinned version as the reference arm. A candidate becomes V only if all four hold:
     - (i) every run is valid and ≤ 400 MB;
     - (ii) its Linux arm is stable unlisted at the job's current n, on the less favourable of its own arm and its pooled CI history;
     - (iii) one-sided Fisher against the pinned arm in the same run gives p > 0.05;
     - (iv) its Windows median is ≤ 300 MB with no run above 400 MB.

     n is never raised to admit a candidate. Then the normal toolchain path applies (09-style pins, 11-style hashes, an attribution run).
   - The ticket owns no `expected-red.json` entry, so 55 needs no edge to it.
5. **Windows (Round 10 condition 5) is met.** On the 1.4.2 arm the median is 250.1 MB (≤ 300) and no run is above 400 MB. The arm's 12/24 is consistent with the earlier 13/24, and the `unstable` entry is unchanged.
6. **Records (Round 10 condition 6, plus this round's additions).**
   - ADR-0016 gets an amendment line: "the job's Bun pin stays at 1.4.2 (Rounds 10–11)".
   - Tickets 09 and 11 have their titles and text renamed to name 1.4.2.
   - Ticket 54's release notes give the stay-back reason, Linux CI S1/burst1 peaks on ≥ 1.4.3, and the forgone 1.4.3 fixes, announced rather than silent (C2, C5).
   - SUPPORT_MATRIX and README × 5 state 1.4.2, through tickets 11 and 53.
   - METRICS.md and 09's Comments get the paired block, written like the Round 8 block.
   - Spec §18 (S1 row) records n = 7 as a measurement-rule amendment.
   - RUNLOG records this round as a deviation from Round 9 condition 6 and Round 10 condition 2's n = 5 line.
   - Ticket 20's target is measured on 1.4.2.

**Rationale:** The paired run did what Round 10 asked of it: it separated Bun from the host. On one VM with the arms interleaved, 1.4.3 and 1.4.4 move the Linux burst1 distribution up, from a 219 MB median with near-budget exceptions to 253–273 MB medians with tails above 330 MB. That holds on counts and on values, and it survives the multiple-comparison correction. So no newer Bun passes the full suite on the runner that judges the ratchet, and C5's own test picks 1.4.2.

The recommendation is right on the pin, the owner ticket and the confirmation run. But it makes 1.4.2 "stable" by changing the estimator after seeing a 5/24 result. The earlier rounds bound the less favourable estimate, and that rule exists so that a decision is robust to the VM a job happens to get. At n = 5 the less favourable estimate is a 6.45 % false-RED rate, and under Phase 4 a false RED reverts a good merge on a chain of about 50 tickets. Raising n to 7 uses the mechanism Round 6 Q1 already granted, fits on the worst VM observed, costs under a minute per leg, and leaves every budget, ceiling and list entry untouched (C9: stronger evidence, then the smaller blast radius).

**Charter:** C5 (latest stable that passes the full suite), C1 (one measured runtime; budget and ceiling unchanged), C7 (Linux must not regress; Windows checked and unchanged), C9 (stronger measured evidence, then the smaller blast radius, then the simpler option: one pin and one n), C2/C8 (stay-back announced), C6 (no new endpoints), §9 (no loosening), Round 6 Q1 condition 2, Round 8 Q1 conditions 2–3, Round 9 conditions 3 and 7, Round 10 conditions 2–6, ADR-0016.

**REVERSIBILITY:** Two-way door. The change is a version pin, one repetition count and ticket text. The triage ticket moves the pin forward under a fixed rule, and shipping 1.4.2 to users stays reversible with the next release. No new ADR; ADR-0016 gets an amendment line.

---

## Shared understanding

Open branches I still see (none blocks ticket 09):
- **EVIDENCE MISSING:** the CPU class of the run 42316982634 runner. If future paired runs land on other hardware, the triage ticket records the CPU model per arm. That is already in the paired mode.
- The pre-merge run at n = 7 disagrees (condition 3) and comes back with numbers.
- The Bun ≥ 1.4.3 triage ticket finds no fix by ticket 20, so the kit stays on 1.4.2 at Phase 6. That is a documented C5 stay-back for the release notes, not a blocker.
- Ticket 20 cannot get every repetition ≤ 250 MB on 1.4.2 (Round 6 Q1 condition 4).
