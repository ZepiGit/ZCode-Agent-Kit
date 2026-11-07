# Round 10: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–9 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself:
- `ci-art/t09-measure-XAT9/memory-budget-{linux,windows}/measure-S1-burst1.{md,json}` and `ci-art/r8-measure-nGEr/…` (same files). All 96 runs are valid. Linux 1.4.4: 12 of 24 above 250 MB, median 246.4, max 318.8. Linux 1.4.2: 1 of 24, median 234.4, max 262.1. Windows 1.4.4: 14 of 24, median 252.4, max 295.9, commit median 406 / max 448.8. Windows 1.4.2: 13 of 24, median 251.9, max 291.1. No run is above 400 MB. These match the round.
- CI logs (`gh api …/jobs/<id>/logs`) for the ubuntu `memory-budget` job in runs 42347506810 (1.4.4), 42316982634 (1.4.2) and 42344393581 (pre-merge, `staging/09` fc1b3e3):
  - all three ran on the same runner image, `ubuntu-26.04` 20261101.186.1, provisioner 20261028.624;
  - all three used the same Node binary, 26.13.0, from the same `actions/node-versions` URL;
  - setup-bun reports `1.4.4+38afee6c8` and `1.4.2+744846f84`;
  - the pre-merge run fails on one line only: `S1/burst1: RED but not listed in expected-red.json (linux)`, with repetitions 252.3, 280.6, 246, 221.2 and 302.2.
- `git diff db5f353 e73bb1b` (the two measured trees): **no file under `zcode-proxy-src/src` changes**. The diff touches the workflows, MANIFEST*, the deleted nested `.github` files and `tests/memory/*` (the S3 OMP leg, the `omp-host` role, the `unstable` ratchet). None of the `tests/memory/*` changes touches the S1 scenario or the Linux RSS gate.
- Ticket 09 on `ticket/09-ci-toolchain` bf6fa98, including its Comments. The local Linux runs on Bun 1.4.4 give 0 of 20 above 250 MB (median 210.7) against 2 of 20 on 1.4.2 (median 230.9). The local job's S2 cost per generation drops ~12 % (1098.8 → 967.1 MB).
- Tickets 11 and 20, `issues/INDEX.md` (the chain 11 → 12 → 13 → 19 → 20), ADR-0006, ADR-0016, `research/bun.md` §1, METRICS.md lines 91–128, and `ci.yml` on t09: the `memory-budget` ubuntu timeout is 75 min, and 24 measurement runs took ~7.5 min.
- npm registry: `@types/bun` 1.4.2, 1.4.3 and 1.4.4 all exist (https://www.npmjs.com/package/@types/bun).

**Corrections to the round's facts:**
1. The actions moved from **v4** to v7 (`checkout@v4`/`setup-node@v4` in run 42316982634's log), not from v6.
2. The Node patch **is** captured for the 1.4.2 run: it is v26.13.0, the same binary as the 1.4.4 run. The measure JSON (`"node": "v26.13.0"`) and METRICS.md line 109 say so too.
3. The proxy source is identical between the two measured trees.

So the actions bump can change the job's setup, but not the measured process: a Bun proxy started from the same tree, under an identical Node.

**The confound left open is the VM.** Each arm ran on one VM, so the Fisher p ≈ 0.0003 treats 24 repetitions on one host as independent. It is conditional on that host. Two separate 1.4.4 VMs ran high (12/24, and 3 of 5 in the pre-merge run), against one low 1.4.2 VM. That points to Bun, but it does not prove it.

The artefacts also do not record the Bun version per run: the version comes only from the workflow log.

---

## Q1 — Ticket 09 (Bun 1.4.4 in CI) turns the unlisted Linux S1/burst1 RED

**DECISION:** REJECTED in part.

**Accepted:**
- Attribute first, with one paired measurement in a single CI run.
- No list edit, no budget change, no `unstable` state for Linux. Round 9 condition 3 stands, and this answer does not override it.
- No rerun-until-green.

**Rejected:**
- **Pinning only the `memory-budget` job to Bun 1.4.2 while CI and the release run 1.4.4.** This contradicts ADR-0016 condition 3 and its Consequences ("the toolchain batch changes the job's Bun pin from 1.4.2 to 1.4.4"), Round 2 Q15 condition 3 and Round 3 Q9 condition 2. Every memory fix would be proven on a runtime the kit does not ship.
- **The edge 11 ← new ticket.** It closes a cycle. The proposed fix owner, ticket 20, is downstream of 11 (20 ← 19 ← 13 ← 12 ← 11), so 11 would wait for a fix that cannot start until 11 lands.

**My decision instead:** one Bun version everywhere, chosen by C5's own test, "the latest stable version that passes the full test suite". If the paired run shows that 1.4.4 causes the Linux tail, 1.4.4 does not pass. The kit then pins the newest version that does pass, 1.4.3 or else 1.4.2, in CI, the memory job, release.yml and the installers alike.

Binding conditions:

1. **The paired run.** It runs on `staging/09` with the v7 actions and the one-run marker discipline (the marker never merges).
   - The ubuntu `memory-budget` job installs Bun **1.4.2, 1.4.3 and 1.4.4** in the same job, through setup-bun or the same GitHub release assets. No new endpoint is allowed (C6).
   - It runs S1/burst1 as **24 valid runs per arm, interleaved in rotation** (1.4.2, 1.4.3, 1.4.4, 1.4.2, …), one after another, each fresh and isolated. Rotation, not blocks, so drift on the host cannot pose as a Bun effect.
   - Cost: ~23 min, inside the 75 min timeout.
   - The `--bun <path>` override exists only in measurement mode and is off by default.
   - Each run records the Bun version that the proxy reports at runtime, not the flag value.
   - Once per arm, inside the same cap scope, the run records: `process.constrainedMemory()`, `navigator.hardwareConcurrency`, the CPU model, `nproc`, the cgroup filesystem type (v2-only or hybrid) and the scope's `MemoryMax`. Bun 1.4.4's one memory-relevant runtime change is GC heap sizing that now honours cgroup v2 limits on hybrid hosts (`research/bun.md` §1). That fits a CI-only, opposite-direction effect, and these values let the triage confirm or rule it out. The same values are recorded once on the local machine.
   - The windows leg runs the same three arms in the same CI run if they fit its 150 min timeout. Those arms are for information (C7). They decide only through condition 5.
2. **The decision rule, fixed before the run.** "p" is the fraction of an arm's 24 runs above 250 MB. "Stable unlisted" means P(median of 5 RED) ≤ 5 %, which is p ≤ 0.189, i.e. at most 4 of 24 (Round 6 Q1 condition 2, Round 8 condition 3). The rules apply in this order:
   - **(a) Invalid → back as a question.** This applies if any run is invalid, any run is above 400 MB, or the 1.4.2 arm is not stable unlisted (≥ 5 of 24). In those cases the host itself sits in the tail, and Bun cannot be judged. This is the orchestrator's branch 3.
   - **(b) No Bun effect → back as a question.** One-sided Fisher exact test on the counts above 250 MB, 1.4.4 against 1.4.2: if p > 0.05, Bun is not shown to be the cause. The question comes back with the pooled Linux CI distribution, including the 12/24 run and the pre-merge run (branch 3). 09 does not merge meanwhile.
   - **(c) Bun-caused.** If the Fisher p ≤ 0.05, 1.4.4 fails the full suite on Linux. The pin V is:
     - **1.4.3** if its arm is stable unlisted (≤ 4 of 24) and its Fisher test against 1.4.2 gives p > 0.05;
     - otherwise **1.4.2**.

     1.4.4 cannot be V in this branch.
3. **If (c): ticket 09 and ticket 11 carry V everywhere.**
   - 09's code sets `bun-version: V` in all three `ci.yml` jobs and in release.yml. The release-audit pin test wants V. The actions v7 bump and the deletion of the nested workflows stay as built.
   - 09's criterion becomes "all CI legs and both `memory-budget` legs green on Bun V with the unchanged `expected-red.json`".
   - Ticket 11 bootstraps V in both installers, with V's five SHA-256s from the primary source. It pins `@types/bun` V exact; 1.4.2 and 1.4.3 both exist on npm. Its attribution runs record V. If V = 1.4.2, there is no runtime change, the attribution step is moot, and RUNLOG notes that under Round 3 Q9.
   - Mixed per-OS pins are not allowed. `bun.lock` churns between 1.4.2 and 1.4.4 (the `hasInstallScript` key, `research/bun.md` §1), and C1 needs one measured runtime.
   - One pre-merge CI run on the restaged 09 confirms the choice; it does not decide it. Disagreement is defined as in Round 9 condition 7: a Linux median > 250, a windows median > 300, a ceiling breach, or any non-median RED. On disagreement the numbers come back as a question, with no rerun.
4. **If (c): one owner for 1.4.4, with no edges upstream.**
   - File a `needs-triage` ticket: "Bun 1.4.4 raises the Linux S1/burst1 peak on CI runners". It carries all four distributions, the paired run and the condition 1 environment values.
   - The ticket is **blocked by 20** and by nothing upstream of it. It owns the re-evaluation: after 20 merges, and at each new Bun stable release, it reruns the condition 1 paired measurement. It then moves the pin to the newest version that passes condition 2, through the normal toolchain path (09-style CI pins, 11-style installer hashes, an attribution run).
   - The ticket owns no `expected-red.json` entry, so ticket 55 does not need it.
   - Ticket 20's criteria do not change. Its "every one of ≥ 20 runs ≤ 250 MB on each leg" target is measured on the pinned runtime.
5. **Windows (C7, primary).** The 1.4.4 Windows numbers stay inside Round 9's `unstable` band: median 252.4 ≤ 300, max 295.9, against 13/24 → 14/24 on 1.4.2, which is no significant change. They do not decide this question. If any windows arm in the paired run has a run above 400 MB, or the arm for V has a median above 300, the numbers come back as a question.
6. **Records and contradictions.**
   - If V ≠ 1.4.4, this explicitly contradicts Round 1 Q15 ("Pin Bun 1.4.4 everywhere"), the "Bun 1.4.4 requirement" item in Round 2 Q10 condition 4, and ADR-0016's Consequences line. ADR-0016 gets an amendment line ("the job's Bun pin moves to the version chosen in Round 10"); no new ADR is needed.
   - Ticket 11's title and text and ticket 54's release notes name V. The notes also give the reason 1.4.4 is deferred, as a documented stay-back the way Round 1 Q16 condition 2 did for the MCP SDK (C5, C2 "announced, never silent").
   - C8: SUPPORT_MATRIX and README × 5 state V. That happens through tickets 11 and 53 as planned; only the value changes.
   - The paired distributions go into METRICS.md and ticket 09's Comments, written like the Round 8 block. RUNLOG records the decision, naming this round.
   - Round 9 condition 3, ADR-0016 condition 3 and Round 2 Q15 condition 3 are upheld, not contradicted.

**Rationale:**

*The case for Bun is strong but not proven.* The evidence implicates Bun more than the round allows. The trees, the Node binary and the runner image are identical, and two separate 1.4.4 VMs ran high. But each version still ran on its own hosts, and the local machine moves the other way. A paired, interleaved run on one host costs about 23 minutes of CI and settles the attribution (C9: stronger measured evidence).

*Why not pin only the memory job.* It would make the ratchet green by measuring a runtime that nobody ships. ADR-0016 ordered upgrades before fixes precisely so that every fix starts RED "on the runtime it ships on". It also deadlocks the chain once 11 waits for 20.

*Why not list Linux S1/burst1 as `unstable`.* Round 9 condition 3 forbids it. Unlike the windows case, it would also be a loosening: the Linux leg holds the 250 MB median rule today with ~1.7 % false-RED. Marking it `unstable` would let medians up to 300 pass to fit an upgrade (§9, C7 "Linux must not regress").

*Why C5 settles the pin.* C5 itself resolves the C1/C5 tension: it asks for the latest stable version **that passes the full suite**. The 250 MB burst1 median rule on Linux is part of that suite. If 1.4.4 is shown to fail it, the newest version that passes is the right pin. 1.4.3 is the only release in between, and it carries the memory win that the 1.4.4 choice rested on (memory returned from threads blocked in `Atomics.wait()`, the captcha worker's case). So it is worth one extra arm.

*Smallest blast radius.* The rule decides mechanically, with thresholds fixed in advance. It keeps one runtime across CI, the memory job and the installers. It changes version strings only, and it gives 1.4.4 a single owner with a re-entry path and no cycle (C9).

**Charter:** C5 (the latest stable that passes the full suite), C1 (one measured runtime; no budget masked), C7 (Linux must not regress; Windows evidence respected), C9 (stronger measured evidence; then the smaller blast radius: version strings rather than a split runtime; then the simpler option: one pin), C6 (no new endpoints), C2/C8 (stay-back announced), §9 (no loosening), ADR-0016 conditions 2–3, Round 2 Q15 condition 3, Round 3 Q9, Round 6 Q1 condition 2, Round 8 conditions 3–4, Round 9 conditions 3 and 7.

**REVERSIBILITY:** Two-way door. It is a version pin plus a measurement-mode flag, and the triage ticket moves the pin forward once 1.4.4, or a later Bun, passes. No new ADR. If V ≠ 1.4.4, ADR-0016 gets an amendment line. Shipping V to users through ticket 11 stays reversible with the next release.

---

## Shared understanding

Open branches I still see (none blocks the paired run):
- **Branch 2(a)/(b):** the paired run finds no Bun effect, or the 1.4.2 arm is itself in the tail. Then the Linux CI S1/burst1 distribution depends on the host, independent of Bun, and Linux burst1 needs its own decision. Round 9 condition 3 rules out the `unstable` state, so that decision comes back with the pooled distribution.
- **Windows:** if V = 1.4.3, the windows S1/burst1 distribution on 1.4.3 has not been measured. The pre-merge run confirms only the Round 9 band.
- The Round 9 open branch stands: ticket 55 still lacks the edge 55 ← 61.
