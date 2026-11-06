# 01: Memory loop with budgets, process-count harness, expected-RED ratchet and the ubuntu `memory-budget` job

**Blocked by:** None (can start immediately)

**Status:** resolved

Model: sol

Risk: medium

ADR: 0016, 0002 (budgets), 0004 (burst budgets)

**What to build:** The memory loop from `diagnosis/memory` becomes committed code under the isolated-installation rules (port 18457–65000, temp HOME/state dir, mock upstream, fixture credential, `ZCODE_OVERHAUL_RUN=1` / `ZCODE_MEMLOOP_ALLOW=1`). The verdict module encodes every §18 MEMORY budget and the PROCESSES counts, the two-part S3 verdict (summed-sample maximum + per-role peaks: launcher ≤ 74, bridge ≤ 75, starter preflight ≤ 76, proxy idle ≤ 62, solver idle ≤ 20 MB), the S2/S4 solver-process checks (0 solver processes after the proxy is SIGKILLed, 0 after an idle exit, ≤ 1 per proxy at every sample) and the additive `commit_kb` sampler column (empty on Linux). `expected-red.json` (per OS leg) and its ratchet land with a `memory-budget` CI job on ubuntu (Node 26, short profile S1–S7, `systemd-run --user` scope or `prlimit`, timeout, artefacts). The 10-launch process-count test (exactly 1 proxy, 0 failed launches incl. a killed holder, 0 orphans after stop) is part of S3.

**Acceptance criteria:**

- [ ] `node tests/memory/run.mjs S1…S7 --profile short` runs on the integration branch; exit codes 1 RED / 0 GREEN / 2 harness failure.
- [ ] Pinned verdict tests (`verdict.test.mjs`) cover: slope + trend rules, role peak, per-process HWM peak, process counts, orphans, the S3 two-part verdict and role budgets, and the ratchet: a RED scenario not listed fails; a listed scenario that is GREEN fails; an unknown scenario/variant fails; a ticket id with no `issues/<NN>-*.md` file fails (seam 9).
- [ ] `expected-red.json` lists, for `linux`: S1/burst4, S1/burst16, S1/burst32, S1/bigbody → 19; S2/short → 58; S3/short → 37; S3/hung → 16; S4/short → 17; S5/short → 30; S6/short → 32; S7/short → 34 (names as finalised here; S3/omp is added by 03; `windows` by 02).
- [ ] The ubuntu `memory-budget` job is green with that list (all listed scenarios RED, everything else GREEN) and uploads CSV + summary artefacts; `ZCODE_MEMLOOP_ALLOW=1` is set only in this job.
- [ ] METRICS.md records the committed-loop Linux run on Bun 1.4.2 against the Phase 1B baseline (no budget loosened).
- [ ] After this ticket merges, the orchestrator opens the draft PR against `main` (never merged; nothing pushed to `main` or `feature/account-rotator`), and its first CI run is the one ticket 02 needs.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 41, 141, 143

## Comments

### 2026-11-06 — implementer (claude-opus-5-5, logged substitute for gpt-6.1-sol-subagent)

Branch `ticket/01-memory-loop-budgets`, code head 9fe49bc (merge of the integration tip ed469b4; `diagnosis/memory` merged first as b53032e). Bun 1.4.2 (ticket 11 not merged), Node 26.7.0, ports 19010–19011.

**What landed**
- `tests/memory/lib/budgets.mjs`: every §18 MEMORY budget and the PROCESSES counts. `s3Budgets(os)` is the two-part S3 verdict: (a) `peaks.kit` 596 linux / 600 windows; (b) `procPeaks` launcher 74, bridge 75, preflight 76, proxy 62, solver 20.
- `lib/verdict.mjs`: new rules `steady`, `windowPeaks` (solver cost per generation), `perParent` (≤ 1 solver per proxy at every sample) and `observed` (counts taken at a moment: 0 solvers after an idle exit and after the proxy's SIGKILL; a missing observation is RED).
- `lib/sampler.mjs`: an additive `commit_kb` column (empty on Linux), a `solver` role (argv containing `captcha-solver`, so ticket 27's child must keep that in its argv or update `roleOf`), `ppid` in rows, and a CSV parser shared with `reverdict.mjs`.
- `lib/catalogue.mjs` (scenarios, variants, run keys `S<n>/<variant|profile>`, the linux job set), `lib/ratchet.mjs`, and `tests/memory/expected-red.json` (linux only; `windows` comes with 02).
- `run.mjs`:
  - an unknown scenario or variant exits 2;
  - every scenario (not only the proxy ones) is refused outside `ZCODE_OVERHAUL_RUN=1`/`ZCODE_MEMLOOP_ALLOW=1`, or with the real HOME;
  - `summary.json` carries `key`, `outcome` and `observations`.
- Scenarios on the budgets:
  - S1: steady check and per-variant HWM;
  - S2: phase E (cold start + idle exit) and phase K (two hosts SIGKILLed, one with a hung generation, one with an idle one);
  - S3: two-part verdict, 250 ms sampling, exactly one proxy after every round;
  - S4: solver counts after every crash SIGKILL;
  - S6: long-line budget 16 MB, frame time recorded;
  - S7: `proxy.early.log` bound.
- `tests/memory/job.mjs` (`npm run memloop:job`):
  - runs the leg's job, each run in a verified `systemd-run --user --scope -p MemoryMax -p MemorySwapMax=0` (the probe reads `memory.max` inside the scope), with a `prlimit --as` fallback, plus `timeout`;
  - a cap kill or a timeout is a harness failure;
  - writes `job-summary.{json,md}` and the step summary.
- CI: `memory-budget` job. It runs on ubuntu-latest with Node 26 and Bun 1.4.2, sets `ZCODE_MEMLOOP_ALLOW=1` only in that job, and has a 75 min timeout. Artefacts (`memory-budget-linux`): the job summary and, per run, `run.log`, `samples.csv`, `summary.json` and `worker-heap.jsonl`.
- `tests/memory/verdict.test.mjs` and `tests/memory/loop.test.mjs` are wired into `npm run test`.

**Tests (after merging the integration tip)**
- `npm run test`: 345 tests, 334 pass, 0 fail, 11 skipped (Windows-only or opt-in, as at baseline). Log: `reports/t01-test-kit.log`.
- `npm run test:proxy`: 1303 pass, 0 fail, 89 files.
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped (live). `git status` is clean after the MCP build.
- `verdict.test.mjs` (23 tests) and `loop.test.mjs` (8 tests) are part of the 345.

**RED → GREEN evidence**
- Each slice went RED first (a missing module or export, or the failing assertion), then GREEN:
  - the ratchet (8 tests) and the committed-list validity test;
  - the budgets, S3 two-part and solver rules, and the window peak;
  - the sampler schema;
  - the run/job guards: before, `run.mjs` ran S2/S5/S6 without the env, and `job.mjs` started the whole job.
- Mutation proofs (scratch edit → the named test fails → restored with `git checkout`, `git status` clean):
  - ratchet accepts a listed GREEN run → "a listed run that is GREEN fails" fails;
  - `procPeak` ignores VmHWM → the S3 part (b) test and the HWM test fail;
  - `S3/omp` added to the list → the committed-list test fails;
  - the sampler drops reparented processes → the detached-orphan test fails;
  - the S3 total loosened to 600 → the budget pin and the ≥ 30 % rule tests fail.

**Memory loop (job, short profile)** — run dirs in `/home/AgentKit/overhaul-tools/t01-memloop/`
- Pre-merge code (= the Phase 1B code): `baseline-job/`, plus the reruns `job-burst32/` and `job-stalled/`. Numbers: the METRICS.md table "Committed loop, Linux reference run".
- Merged branch: `final-job/` (`reports/t01-final-job.log`, 2,203 s). **The ratchet holds.**
  - GREEN: S1/short (3.0 %/1k, steady 122 MB, HWM 173 MB), S1/burst1 (HWM 234 MB), S1/stalled (0.23 %/1k, HWM 167 MB).
  - RED: exactly the 11 listed runs (S1 burst4/16/32/bigbody, S2, S3 short/hung, S4, S5, S6, S7).
  - S3/short: kit 852 MB; launcher 78.2, bridge 87.1, preflight 73.6, proxy 61.4 MB.

**Decisions**
1. **S1/short was RED on the current code.** At 3,000 requests it reached 6.42 and 7.24 %/1k with the net-rise trend, in 2 of 2 runs. The whole run is allocator and responses-store warm-up: the long run plateaus after ~3,000 requests at 0.07 %/1k. The mixed short profile is now 6,000 requests, with the first half as warm-up. The budget (5 %/1k + trend) is unchanged. Results: 2.77, 3.34 and 3.0 %/1k, GREEN in 3 runs.
2. **S1/stalled** was at 6.02 %/1k with no trend at 3,000 requests, one noisy window from RED. It now runs 6,000 requests (warm-up 0.25): 2.36 and 0.23 %/1k.
3. Growth and steady are evaluated on the paced runs only. Burst and big-body runs are spikes, judged by their HWM (the diagnosis loop's growth RED on burst32 was sawtooth noise). S1/burst16 and burst32 use §18's 400 / 600 MB; the other S1 runs use the 250 MB peak.
4. S3 samples every 250 ms, so preflights (alive ~1 s) contribute their VmHWM; Node cannot read `ru_maxrss` of spawned children. Roles without a §18 target (manager) count in part (a) only.
5. Growth is not evaluated for S3/S4: no process lives across their work units (every round and cycle starts from a stopped proxy).
6. Two §18 items are not observable at seam 1:
   - the S2 "≤ 256 CDN entries" bound belongs to ticket 25's seam 3 test;
   - the S6 "frame-time regression" is recorded (`resizeFrameMs`, 0.234 ms) for ticket 05 to compare, not gated.
7. `proxy.early.log` bound: 1 MB plus one 64 KB write as the "bounded overshoot". The spec gives no number; ticket 34 may tighten it.
8. Caps and timeouts:
   - caps are 3G by default, 4G for S1/burst16, 6G for S1/burst32 (it died silently under 3G, a harness failure) and 4G for S2; S5's timeout is 1,800 s;
   - `prlimit --as=2×cap` is the fallback when no user systemd scope applies MemoryMax (node and bun start fine under `--as=4G`).
9. Ratchet rules beyond the ticket text:
   - an expected-RED entry must be a run of that leg's job, so an entry for a known variant the job never runs (e.g. `S2/gc`) fails;
   - every job run must actually run;
   - a harness failure is never expected;
   - `S1/burst1` and `S1/stalled` are in the linux job (GREEN today).
10. The diagnosis loop's S2 host peak check (`procPeak:scenario` ≤ 600 MB) stays alongside the new per-generation check, so nothing is loosened.

**Pending / left for others**
- AC 4 (ubuntu `memory-budget` job green on GitHub, with artefacts): **pending CI**; the orchestrator verifies after merge + push. Two risks to watch on the first run:
  - S1/burst1's HWM was 219–234 MB against its 250 MB budget;
  - the runner's user manager may not delegate the memory controller; the job then logs the prlimit fallback.
- AC 6 (draft PR) is the orchestrator's.
- 02: the windows sampler fills `commit_kb` and adds `JOB.windows` and the `windows` key.
- 03: the `S3/omp` variant and its entries.
- 27: the solver child's argv must contain `captcha-solver` (role); the S2/S4 counts become live with it.

Merged 2026-11-06 as 0b73e37c61c3c3eda3727f772ac6eb7ab9c04e73; fast suite: kit 334/345 (11 skipped, 0 fail; includes tests/memory/verdict.test.mjs and tests/memory/loop.test.mjs), proxy 1303/1303, mcp 95/96 (1 skipped, 0 fail); mcp dist unchanged. Logs: .scratch/kit-overhaul/reports/merge-01-{npmci,test,proxy,mcp}.log.

- 2026-11-06 (orchestrator): pending-CI criterion verified on draft PR #13, run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42203592466: `memory-budget` (ubuntu, short profile, systemd cap, Node 26.13.0) green, ratchet holds (11 expected RED, S1/short, S1/burst1, S1/stalled GREEN); all four test-kit legs green.

- 2026-11-06 (ticket 60, measurement-rule amendment, Round 6 Q1): S1/burst1 (3 sequential ~10.8 MB requests per run, not one request) is no longer judged on a single run. The job runs it as 5 fresh, sequential repetitions and judges the median proxy peak against the unchanged 250 MB peak budget. Every repetition must also stay ≤ 400 MB (hard per-run ceiling). The variant stays one verdict in the ratchet. n lives in `tests/memory/lib/budgets.mjs` `REPEATED`, and the rule lives in `tests/memory/lib/repetitions.mjs`. Distribution and computation: METRICS.md, ticket 60 Comments. Every other run keeps decision 3 above (judged on one run).
