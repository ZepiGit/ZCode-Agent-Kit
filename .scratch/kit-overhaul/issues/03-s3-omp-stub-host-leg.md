# 03: S3 OMP stub-host leg in the memory loop

**Blocked by:** 01 (Memory loop with budgets, process-count harness, expected-RED ratchet and the ubuntu `memory-budget` job), 02 (Windows sampler and the windows leg of the `memory-budget` job (Bun 1.4.2 reference run))

**Status:** resolved

Model: sol

Risk: medium

ADR: 0013

**What to build:** S3 gains an `omp` variant that runs the generated OMP extension in a stub Bun host on both OS legs: 5 simultaneous hosts, and again with the starter host killed. It counts concurrent OMP preflight processes, reports each host's RSS delta (not counted as kit footprint) and asserts that each waiter host printed the starter's `cause=` lines whenever the starter's preflight emitted any (Round 4 Q1 add. 4).

**Acceptance criteria:**

- [ ] Verdict tests pin the new checks: ≤ 1 concurrent OMP preflight process (5 hosts; killed starter), in-host waiter cost ≤ 5 MB per host (reported, gate), cause lines present in every waiter.
- [ ] On today's code the variant is RED (5 preflights) on both legs, and `expected-red.json` gains `S3/omp → 35` under `linux` and `windows`.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 31 (measurement), 32 (measurement)

## Comments

### 2026-11-06 — implementer (claude-opus-5-5, logged substitute for gpt-6.1-sol-subagent)

Branch `ticket/03-s3-omp-stub-host`. Code head 50c027b, on base 1e8f753. That base contains ticket 02. Bun 1.4.2 (ticket 11 not merged), Node 26.7.0, ports 19030–19032.

**Final tip merge pending the 02 re-merge.** Ticket 02 was reverted on the integration branch (c252676). The orchestrator said not to merge the tip until 02 is re-merged. I started a trial merge of tip b4e3ee3 before that note arrived and aborted it, so nothing of it is committed. In that trial merge:
- Five files conflicted, all in `tests/memory/`: `expected-red.json`, `lib/catalogue.mjs`, `loop.test.mjs`, `scenarios/s3-concurrency.mjs` and `verdict.test.mjs`.
- My additions apply cleanly on the reverted code.
- If 02 is still reverted at merge time, the `windows` `S3/omp` entry must go. The ratchet rejects an entry for a leg the job does not run.

**What landed**
- `tests/memory/fixtures/omp-host.ts` is the stub Bun host:
  - It loads the generated extension the way OMP does (default export with an `on` registrar) and fires `before_provider_request` once for provider `zcode`.
  - It measures its own memory: RSS, or on Windows the commit charge via `Bun.unsafe.memoryFootprint`. Protocol: `OMP_HOST_READY` and `OMP_HOST_DONE` JSON lines on stdout; `arm`/`go` lines on stdin. It exits when stdin ends.
- `tests/memory/lib/omp-host.mjs` holds the host helpers:
  - `generateOmpExtension` writes the extension through the real OMP adapter (`omp.apply`) into the isolated HOME, so the template is filled exactly as `setup` fills it.
  - `startOmpHost` spawns a host. A POSIX host leads its own process group, so `killTree()` takes the host and its preflight. On Windows it uses `taskkill /T /F`.
- `tests/memory/lib/omp-leg.mjs` has `ompLegChecks` and `causeLinesOf`. It computes five checks:
  - `omp:concurrent-preflights` ≤ 1;
  - `omp:waiter-cost` ≤ 5 MB per waiter;
  - `omp:waiter-cause-lines`;
  - `omp:hosts-finished`;
  - `omp:starter-killed`.
- `lib/budgets.mjs`: `OMP_LEG = { hosts: 5, concurrentPreflights: 1, waiterCostMB: 5 }`.
- `lib/sampler.mjs`: new role `omp-host`.
- `lib/verdict.mjs`: `omp-host` is not kit footprint (ADR-0013 cond 4: the host is the harness).
- `scenarios/s3-concurrency.mjs` gains `--variant omp` with two rounds, both from a stopped proxy:
  - `omp-5`: 5 hosts fire together;
  - `omp-5-kill-starter`: the same, and the first host seen with a preflight child is killed with its tree.
  - It also keeps the S3 two-part budgets (kit total, role peaks), `count:proxy` and orphans, and adds `simultaneous-proxies`.
- `lib/catalogue.mjs`: `S3/omp` is a variant of S3 in the linux job. The windows job is derived from it, so it is in the windows job too.
- `expected-red.json`: `S3/omp → 35` under `linux` and `windows`.
- New tests:
  - `verdict.test.mjs`: 14 tests (the OMP leg checks, the budget pin, the omp-host role, the catalogue/list entry);
  - `loop.test.mjs`: 3 tests (the host runs the generated extension, the killed-starter adversary kills the tree, the measurement floor).
  - Both files are already wired into `npm run test`.
  - No existing test or assertion changed.

**Tests (branch head 50c027b, base 1e8f753)**
- `npm run test`: 399 tests, 383 pass, 0 fail, 16 skipped. The base had 382 / 366 / 16, so this ticket adds 17 tests. Log: `reports/t03-full-kit.log`.
- `npm run test:proxy`: 1343 pass, 0 fail, 90 files (`reports/t03-full-proxy.log`).
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped (live). `git status` was clean after the build (`reports/t03-full-mcp.log`).
- Memory job, `--only S3/short,S3/hung,S3/omp`, systemd cap: the ratchet holds (`reports/t03-job-s3.log`, `/home/AgentKit/overhaul-tools/t03-memloop/job-s3/`).
  - S3/short (→ 37) and S3/hung (→ 16) are RED with the same red checks as in ticket 01.
  - S3/omp (→ 35) is RED on `omp:concurrent-preflights` only.

**RED evidence on today's code (Linux, Bun 1.4.2)** — runs `reports/t03-omp-red1.log`, `t03-omp-red2.log` and the job run above:

| round | preflights at once | spawned | hosts' own cost (starters) | cause lines |
|---|---|---|---|---|
| omp-5 | **5** | 5 | +3.6 to +3.9 MB each | every host printed `quota-unavailable` |
| omp-5-kill-starter | **5** | 5 | +3.2 to +3.9 MB (killed host unmeasured) | every survivor printed it |

- There are no waiters today: every host is its own starter. So `omp:waiter-cost` and `omp:waiter-cause-lines` pass vacuously. The verdict tests pin them on hand-built rounds, and the positive control below exercises them on real hosts.
- Footprint in the same run: kit total 373 MB, preflight peak 73.9 MB (≤ 76), proxy 60 MB, omp-host per-process peak 34.7 MB (not kit). The run takes about 12 s.
- Windows: the variant is in the windows job. **Pending CI (orchestrator verifies after merge+push)**, and it needs 02 re-merged first.

**RED → GREEN and mutation evidence**
- The verdict tests were written first, as one batch at seam 1 (the pure check module), and failed on the missing module (`reports/t03-red1.log`). The leg and list test then failed with `linux|windows S3/omp: unknown variant omp of S3` before the catalogue change (`t03-red2.log`). After the change, all were green.
- The host tests came after the host, so their teeth were shown by mutation. All mutations ran in a scratch worktree, which I removed after restoring it (`git diff` empty):
  - M1: in the positive control, waiters drop the record's lines → `omp:waiter-cause-lines` RED, 7 waiters (`t03-mutant1-causes.log`);
  - M2: `killTree` kills only the host → "killing a starter host takes its running preflight with it" fails: its preflight survived (`t03-mutant2-killtree`);
  - M3: the host ignores the end of stdin and holds a timer → "exits with its loop" fails (`t03-mutant3b-stdin`). A host that ignores stdin end but holds nothing exits anyway, so that variant passes by design (`t03-mutant3-stdin`). A held timer with the exit handler intact passes too (`t03-mutant3c-keepalive`);
  - M4: the baseline is taken right after a full GC, without the armed channel and the idle window → the floor test fails (`t03-mutant4-baseline`);
  - M5: a waiter passes with any one of the starter's lines → "did not print the starter's cause lines" fails (`t03-mutant5-subset`);
  - M6: killed hosts are counted as survivors → two OMP leg tests fail (`t03-mutant6-killed`);
  - M7: `omp-host` is counted as kit → the "never kit footprint" test fails (`t03-mutant7-notkit`).
- **Positive control (the variant can turn GREEN):** I wrote a throwaway single-flight prototype of the extension in the scratch worktree. It uses an O_EXCL token in the logs dir, a stat + `healthy()` wait, a record written before release, and takeover by proof with a side lock. It was never committed. Results:
  - S3/omp was GREEN in 4 of 4 runs: 1 preflight in `omp-5`; 1 at a time (2 spawned) with the killed starter; all waiters printed the cause line (`t03-omp-control2..5`).
  - The first prototype took over by deleting the token after judging its holder dead. That ran **3 preflights at once** in the killed-starter round, because one waiter deleted another's fresh token (`t03-omp-control.log`). The adversary catches the judge-then-remove race of ADR-0003. **Note for ticket 35.**

**Metrics: in-host cost (Linux RSS, `reports/t03-cost-probe*.log`, 5 hosts each)**
- Measurement floor (a no-op hook): +0.63 to +0.75 MB. Before the fixes the floor was +4.9 MB, because two things were charged to the hook:
  - Bun's stdin reader set up after the baseline;
  - a baseline taken right after a full GC.
  The host now opens its control channel and receives one line before the baseline. The baseline is the maximum over one idle second with the same 10 ms sampler running.
- A waiter-shaped hook (stat poll plus a `fetch` to a closed port, for 1 s): +2.9 to +3.3 MB.
- Today's starter (spawning the preflight): +3.2 to +3.9 MB.
- Prototype waiters: +3.3 to +4.1 MB.
- **Finding for ticket 35:** the margin to the 5 MB gate is about 1 MB. Most of a waiter's cost is the first `fetch` in Bun, which `healthy()` already pays today.

**Decisions**
1. **Starter and waiter are observed, not reported by the extension.** A starter is a surviving host with a preflight child (ppid = host pid, seen by a 50 ms poll). A waiter spawned none. This works for today's extension and for any future one.
2. **The killed starter is killed with its process tree**, as soon as it is seen with a preflight child. On POSIX that is its process group; on Windows it is `taskkill /T`. This is what closing the harness's terminal does. If only the host were SIGKILLed, its preflight would run on as an orphan, and no in-host protocol could then keep ≤ 1 concurrent preflight. The manager-spawned proxy is detached and survives. A start lock the killed preflight held is this run's own and is cleared after the round, as in kill-holder.
3. **Only waiters are gated on cost** (ADR-0013 cond 4 names the waiter). Starters are reported in the check detail. A waiter that never reported a cost is RED, never assumed cheap.
4. **The cause-line rule.** A waiter passes if it printed every line of some surviving starter that printed any. If no starter printed a cause line, silent waiters pass ("whenever the starter's preflight emitted any"). Waiters with no surviving starter at all got no diagnostics and are RED. Cause lines are `[zcode-autostart] <cause>:` lines whose cause is in `PREFLIGHT_WARNINGS`. Failure categories are not cause lines.
5. **Two guards against vacuous checks:**
   - `omp:hosts-finished`: no surviving host may still be waiting after 150 s, which is above the extension's `START_TIMEOUT_MS`;
   - `omp:starter-killed`: the kill round must really kill a starter.
6. **The cost metric is RSS, and on Windows the commit charge (`Bun.unsafe.memoryFootprint`).** This follows the loop's per-OS metric. The Windows numbers are pending CI.

**Left for others**
- Orchestrator: merge the integration tip once 02 is re-merged (see above). Then verify the windows `S3/omp` run on the draft PR: RED on `omp:concurrent-preflights`, cap applied, hosts sampled, and the floor test on the windows `test-kit` legs.
- Ticket 35:
  - turn S3/omp GREEN on both legs and delete both entries;
  - mind the ~1 MB margin;
  - avoid the takeover race the positive control exposed;
  - the scenario gives you `notes.ompRounds` per host: preflights, cost, cause lines, last line.

### 2026-11-07 — implementer, round 2 (claude-opus-5-5): integration tip merged, S3/omp on the merged Windows sampler

Branch `ticket/03-s3-omp-stub-host`. Merge 18d6271 (tip 5631511: tickets 02 + 60), code 4386a38. Bun 1.4.2 (ticket 11 not merged), Node 26.7.0, port 19030.

**Merge.** Two files conflicted. I resolved both by hand and kept both sides:
- `lib/verdict.mjs`: `NOT_KIT` is the union (`tooling` from 02, `omp-host` from 03).
- `loop.test.mjs`: the imports are merged, and every test from both sides is kept.

`s3-concurrency.mjs`, `sampler.mjs`, `budgets.mjs`, `expected-red.json` and `METRICS.md` merged cleanly. `ci.yml` and `package.json` did not conflict. The merge commit holds only the resolution; the adaptation is the next commit.

**What the merge broke (RED on the tip, shown).** The tip's evidence gate (`lib/completeness.mjs`) judged S3/omp on the S3 floor: ≥ 15 s, and roles proxy, launcher and preflight. S3/omp starts no launcher and runs 10–12 s. I fed real S3/omp summaries to the tip's gate (`reports/t03-r2-gate-red.log`):
- the pre-merge run (50c027b) and the fresh merged run both fail with `scenario ran 12 s, below the S3 floor of 15 s` and `role launcher never seen`;
- in the job, that is a harness failure, so both `memory-budget` legs would have failed the ratchet.

**What landed (4386a38)**
- `completeness.mjs`: a run key may carry its own floor, which replaces its scenario's.
  - `S3/omp`: ≥ 5 s, ≥ 14 samples, roles `proxy`, `preflight` and `omp-host`. The numbers are half the shortest Linux run (10 s, 28 samples).
  - `manager` is not required: it is too short-lived for a Windows poll, which is the same reason S3 does not require `mcp-bridge`.
  - `ROUNDS["S3/omp"] = ["omp-5", "omp-5-kill-starter"]`. A run without the killed-starter round is a harness failure. That is a floor of its own, not an exemption.
- `s3-concurrency.mjs`:
  - `OMP_ROUNDS` is the single round table. A test pins it equal to the gate's list.
  - The rounds are noted as `rounds`, the name the gate reads. They were `ompRounds`. **Ticket 35: read `notes.rounds`.**
- `win-sampler.mjs`: a console host under an `omp-host` takes the host's role, because it belongs to the harness (ADR-0013 cond 4). The preflight the host spawns, with its PowerShell and console host, stays kit (Round 7 Q2 cond 3).
- `fixtures/omp-host.ts` and `lib/omp-leg.mjs`: on Windows the host also measures its working-set delta (`wsCostMB`, from `process.memoryUsage().rss`). The waiter-cost check carries `gate: "commit"` and prints `+x MB commit / +y MB WS` per host (Round 7 Q1 cond 3). Linux output is unchanged.
- `expected-red.json`: unchanged. `S3/omp → 35` is a plain string entry on both legs and fits the Round 9 schema. A test pins three things on both legs: RED passes the ratchet, GREEN asks for the deletion, and `unstable` is a schema error.
- New fixture `fixtures/local-20261107-s3-omp-linux-summary.json`: the real merged Linux run, with no secrets, port 19030 and no external connections. It replays through the job as the listed RED. Cut to one round, it replays as a harness failure.

**Tests (head 4386a38, tip 5631511)**
- `npm run test`: 643 tests, 627 pass, 0 fail, 16 skipped. The tip had 620 / 604 / 16 (`reports/merge-02-60-test.log`). +23 tests: 17 from round 1 and 6 new. Log: `reports/t03-r2-full-kit.log`.
- `npm run test:proxy`: 1343 pass, 0 fail, 90 files (`t03-r2-full-proxy.log`).
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped (live). `git status` was clean after the build (`t03-r2-full-mcp.log`).
- RED → GREEN: the 4 new behaviour tests failed first (`t03-r2-red1.log`):
  - the S3/omp evidence floor;
  - the round table;
  - the omp-host conhost;
  - the Windows waiter-cost report.

  After the change, all memory tests pass (`t03-r2-green1.log`, then `t03-r2-green2.log` with the replay test).
- Mutations (`t03-r2-mutants.log`, script `/home/AgentKit/overhaul-tools/t03-scripts/r2/mutants.sh`). Each was restored, and `git diff` was empty afterwards:
  - M8 windows `S3/omp` made `unstable` → 8 tests fail;
  - M9 windows entry deleted → 2 fail;
  - M10 the tip's `completeness.mjs` → 3 fail;
  - M11 the gate forgets the killed-starter round → 3 fail;
  - M12 the scenario notes `ompRounds` again → no fast test fails. The live job is the guard there: `S3/omp: harness failure: … round omp-5 never ran; round omp-5-kill-starter never ran`, ratchet FAILED (`t03-r2-m12-job.log`).

**Memory loop, Linux short profile** (`--only S3/short,S3/hung,S3/omp`, systemd cap, `reports/t03-r2-job-s3.log`, `/home/AgentKit/overhaul-tools/t03-memloop/r2-job-s3/`): **the ratchet holds.**

| run | outcome | red checks | s / samples |
|---|---|---|---|
| S3/short → 37 | RED | peak:kit 855.1, procPeak:launcher 77.8, procPeak:mcp-bridge 86.8, failed-launches, stale-lock-after-round | 33 / 119 |
| S3/hung → 16 | RED | peak:kit 853, launcher 79.1, mcp-bridge 86, proxy 62.5 (budget 62), failed-launches, stale-lock-after-round | 189 / 528 |
| S3/omp → 35 | RED | omp:concurrent-preflights 5 (both rounds; 5 spawned) | 12 / 36 |

- S3/short and S3/hung are RED on the same checks as before the merge, so the merge did not disturb them. The S3/hung proxy peak sits at its 62 MB edge, as it did on the tip.
- S3/omp details:
  - starters cost +3.1 to +3.8 MB;
  - every surviving host printed `quota-unavailable`;
  - kit 372 MB, preflight 62.9 MB, proxy 60.8 MB;
  - host 34.6 MB per process (not kit).

**Decisions**
7. **Per-key evidence floor** instead of loosening the S3 floor or exempting S3/omp. The S3 floor stays as it was for S3/short and S3/hung (pinned).
8. **The Windows waiter cost stays gated on commit.** Round 7 Q1 moved "the per-process peak and steady budgets … of the proxy, launcher, MCP bridge and preflight" to working set, and says "nothing else". The waiter cost is an in-host delta of the harness, so the earlier rule (Round 2 Q13: RED rules on commit) still applies. WS is reported beside it. If the waiter cost turns out RED only on commit on Windows once ticket 35 has waiters, Round 6 Q2 cond 1 applies: it goes to the owner with both numbers, and nothing is listed silently. Source for the metric: `Bun.unsafe.memoryFootprint()` is PrivateUsage, the commit charge, on Windows (https://bun.com/reference/bun/unsafe/memoryFootprint).
9. **The stub host's conhost is the harness's,** the same rule as the other fixtures' conhosts.

**Pending CI (orchestrator verifies after merge+push).** I cannot push. On the draft PR's run, check:
1. `memory-budget` (windows):
   - The job summary row is `S3/omp | RED | ticket 35`, with `omp:concurrent-preflights` among the red checks (expected value 5, or at least 2), and the ratchet holds. A `HARNESS FAILURE` row is a real RED.
   - The evidence holds: `scenarioS` ≥ 5, samples ≥ 14, and `rolesSeen` with `omp-host 5`, `preflight` ≥ 1 and `proxy 1`; `jobApplied: true`; `metric: commit`; units self-test `ok`.
   - `omp:starter-killed` ok (`taskkill /T` killed a starter), `omp:hosts-finished` ok, `simultaneous-proxies` 1, orphans 0.
   - The `omp:waiter-cost` detail shows `commit / WS` for every host. Today every host is a starter (no waiters), so the check is vacuous.
   - In `samples.csv`, no conhost whose ppid is an omp-host has a kit role.
   - Expected RED reason: `omp:concurrent-preflights`. Other REDs are possible on Windows and accepted under the plain entry. The most likely is `peak:kit` on commit (514 MB total: 5 preflights, each with kit PowerShell). Record the numbers. If S3/omp windows is still RED on `peak:kit` once single-flight lands, ticket 35 cannot delete its entry, and that comes back with numbers (37's lever question).
2. `memory-budget` (ubuntu): `S3/omp` RED → 35 on `omp:concurrent-preflights` only, as here.
3. `test-kit` windows (Node 24 and 26) must run these three host tests, not skip them:
   - "the stub OMP host runs the generated extension once …": metric `commit`, `wsCostMB` a number, one preflight spawned by the host itself;
   - "killing a starter host takes its running preflight with it": the `taskkill /T` path;
   - **the floor test** "… charges a hook that does nothing well under the 5 MB waiter gate": on commit, the no-op cost must be < 2.5 MB. If it fails there, the commit floor cannot tell a waiter from noise. That is a finding that comes back as a question with the number. It is not a reason to loosen the gate.
4. `test-kit` ubuntu legs: green.

**Left for others**
- Orchestrator: the pending-CI checks above.
- Ticket 35:
  - the round 1 notes still hold (≈ 1 MB margin; the takeover race);
  - the per-host data is now in `notes.rounds`;
  - on Windows the waiter gate is commit with WS reported beside it (decision 8).

Merged 2026-11-07 as efab6f19b9bef603d876830468bd69f5a72340e0; fast suite: kit 627/643 (16 skipped, 0 fail; includes the stub OMP host tests in tests/memory/loop.test.mjs and the OMP leg verdict tests), proxy 1343/1343, mcp 95/96 (1 skipped, 0 fail); mcp dist unchanged; no lockfile changes; clean merge (no conflicts). Pre-merge CI (draft PR #17, staging/03), green on all 8 jobs: https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42335478907. From that run: windows `S3/omp` RED → 35 on `omp:concurrent-preflights` only (5 at once in both rounds); `peak:kit` 350 MB commit / 400 MB WS (budget 514, ok); the 5 stub-host tests ran and passed on windows Node 24 and 26. Ubuntu `S3/omp` RED → 35 on `omp:concurrent-preflights` plus `procPeak:preflight` 77.4/76 MB and `procPeak:proxy` 62.9/62 MB. Logs: .scratch/kit-overhaul/reports/merge-03-{npm-ci,test,test-proxy,test-mcp}.log.

- 2026-11-08 (orchestrator, Owner Proxy round 17): the floor finding (no-op hook charged 2.55 MB on windows commit, run 42436440284, `loop.test.mjs:459`, 1 of 16 windows legs) was brought back as this ticket's text required, and was decided in Round 17 Q4. The 2.5 MB floor threshold and the 5 MB waiter gate are unchanged; ticket 71 turns the floor test into n fresh-host repetitions (median < 2.5 MB, every repetition < 5 MB, every value printed), with n set from ≥ 20 measurements per leg; ticket 35 gains the windows waiter-gate criterion.
