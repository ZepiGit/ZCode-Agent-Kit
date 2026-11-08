# 16: Start lock protocol v1 with proven takeover (no judge-then-rename race)

**Blocked by:** 15 (Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets))

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0003, 0012

**What to build:** New locks add a protocol version and the holder's process start time, written atomically. Takeover only on proof (holder dead, or PID reused: live start time differs; v0: later than `startedAt`). The race is closed (moved record checked against the judged one, or an exclusive side-lock with pid + start-time proof). A live holder's lock is never touched; unparsable or unknown-higher-version locks are never deleted and are reported with what/why/next and the exact path. Old kits read only `pid`/`startedAt`. AUD-001 comments updated with the implementation. The takeover logs one event line.

**Acceptance criteria:**

- [ ] Takeover race test: N contenders with a kill injected at every protocol step → never two holders, never a deleted live lock (seam 2, real time).
- [ ] v0 lock recovery; unreadable/unknown-version lock untouched with the error block; old-manager interop test against the origin/main manager.
- [ ] Lock-version migration replayed twice is a no-op the second time.
- [ ] Loop: S3 killed-holder round → 0 failed launches (`failed-launches`), 0 stale locks (`stale-lock-after-round`), exactly 1 proxy (`exactly-one-proxy-after-round`); S3/hung's stale-lock round: a start over a dead holder's lock is taken over by proof (`start-over-stale-lock` GREEN). **Remove 16's names from `S3/short` (`failed-launches`, `stale-lock-after-round`, `exactly-one-proxy-after-round`) and `S3/hung` (the same three plus `start-over-stale-lock`) in `expected-red.json`, both legs (linux, windows), with the evidence Round 15 Q1 condition 5 requires.**
- [ ] Measurement (Round 27 Q1): S3 reports the kill-holder adversary's victim (pid = adversary.killed, non-zero exit) as killedByAdversary, never as a failed launch; the evidence gate makes kill-holder-10 a harness failure unless exactly one launch matches (tests for no kill, no match, a matched launch that exited 0, and two matches), RED first. Spec §18 PROCESSES, METRICS.md and ADR-0003 condition 5 state the rule; budgets.mjs is unchanged. Windows removal of failed-launches and stale-lock-after-round needs the pre-merge windows memory leg GREEN on both names in S3/short and S3/hung, one killedByAdversary and 0 failedLaunches in both kill-holder rounds, and tests/start-lock.test.mjs green on the windows test-kit legs of the same run.
- [ ] A kill injected during the lock write leaves either no lock file or a complete, parsable record, never a partial one, on both legs (Story 48).
- [ ] windows-latest (Round 7 Q4 condition 1): a kill injected at each point between spawn and the complete record, and a forced start-time probe timeout with no kill, each end with the proxy stoppable or adopted.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 41, 42, 43, 46, 47, 48, 135

## Comments

- 2026-11-06 (orchestrator, from ticket 02 round 4 Windows evidence): a start killed between spawning the proxy and recording its start time leaves `proxy.pid` without a start time (manager writes the record first and fills `startedMs` from a later query: `zcode-proxy-manager.mjs:632/:639`; on Windows that query is PowerShell, up to 2 x 2.5 s). Every later stop then fails closed on `start-unknown` and the proxy can never be stopped by the kit (S3/hung windows: orphan pid 3796, all stops refused). The lock/lifecycle fix must close this window (e.g. record identity atomically before/at spawn, or adopt a healthy proxy that answers with this installation's key) and the windows memory leg must show 0 orphans in S3.

- 2026-11-06 (orchestrator, Round 7 Q4): ticket 16 owns closing the missing-start-time window of a new start, including a start-time probe that times out without any kill; the kit never kills on a pid alone.

- 2026-11-06 (orchestrator, from ticket 02 round 7 Linux evidence): the same window exists on Linux, earlier. A start lock holder killed after it spawned the proxy but before it wrote `proxy.pid` leaves a healthy proxy with no record at all. Every later stop refuses it ("proxy healthy but no pid file"), it ends as an orphan, and while it is frozen the kit starts a second proxy (2 at once, 10/10 launches failed in the reproduction). CI run 42281731448 hit it naturally (ubuntu S3/hung). Closing the window covers spawn → record write, not only record write → start time. Reproduction: ticket 02 Comments, round 7 (5 s sleep widened between spawn and `proxy.pid`, scratch copy only).

- 2026-11-07 (orchestrator, from ticket 65): (1) deleting `S3/hung (linux, windows)` now also needs the new check `start-over-stale-lock` GREEN: S3/hung's stale-lock round records a start refused over a dead holder's lock (exit 1, 'refusing automatic takeover') as RED instead of a skipped round; 4 of 39 S3/hung legs hit it. (2) On Windows a holder killed inside spawn() leaves a suspended proxy that never runs (libuv creates detached children suspended and resumes after CreateProcessW returns; https://github.com/nodejs/node/blob/main/deps/uv/src/win/process.c): no pid record, never serves the port, survives the final stop (run 42398299724), cannot be adopted. The proven takeover must cover a dead holder with no proxy up.

- 2026-11-08 (orchestrator, Owner Proxy round 15): Q1 condition 7 — "Delete `S3/hung` (linux, windows)" became "remove 16's names from `S3/short` and `S3/hung` (both legs)", naming the checks 16 owns there under Q1 condition 3 (`failed-launches`, `stale-lock-after-round`, `exactly-one-proxy-after-round`, plus `start-over-stale-lock` in S3/hung). Q1 condition 6 — Round 7 Q4 condition 1's windows-latest seam proofs (kill at each point between spawn and the complete record; forced probe timeout) moved from these Comments into Acceptance, as Round 7 Q4 ordered. Round 7 Q4 condition 1's loop part ("S3/hung windows shows 0 orphans before 16 deletes S3/hung") is no longer 16's: the windows S3 `orphans` check moved to ticket 17 (Round 15 Q1, explicit contradiction of Round 7 Q4 condition 1, loop part only). The 2026-11-06 "0 orphans in S3" line above is a measured finding and assigns nothing (Q1 condition 6).

- 2026-11-08 (orchestrator, Owner Proxy round 22 Q1): linux S3/short `orphans` goes to 17 (descendant rule, as windows in Round 15); 16's `exactly-one-proxy-after-round` RED in run 42457112513 is the same event (pid file does not match the listener). If 16 closes the spawn → record window first, 17 removes a GREEN name. 16's own names and Acceptance are unchanged.

- 2026-11-08 (orchestrator, Owner Proxy round 27 Q1): the victim-apart counting and the S4 staleLockLeft record are accepted as measurement corrections (budget 0 unchanged). Under the new counting, archived pre-16 runs stay RED on failed-launches in S3/hung 62/62 linux and 43/43 windows, and in linux S3/short 61/62, but in windows S3/short only 34/43 (the victim alone in 9), so the windows removal also rests on the seam tests (Acceptance). staleLockLeft is recorded only; a judged check on it is a separate question. 16's tree restarts the matching count for S3/short, S3/hung, S3/omp and S4/short on both legs.

### 2026-11-08 — implementer (ticket 16)

**Branch:** `ticket/16-start-lock-v1` (worktree `/home/AgentKit/wt/t16`). Commits: `6157579` (implementation and seam tests), `313877c` (S3/S4 scenario fixes, adversarial tests), `80b231d` (a late start-time probe; names removed from `expected-red.json`), `836f83f` (ADR-0003 amendment). The integration tip `c457fd8` (tickets 36 and 71) is merged as `7cd8103` with no conflicts. Then `f21d3ac` (the ticket 15 Windows teardown fix) is merged as `e4b2c3c`, also with no conflicts; outside `.scratch` it changes only `tests/proxy-lifecycle.test.mjs`. After that merge the start-lock tests take free loopback ports instead of 19160–19169 (`faeaf02`; ticket 75's class of collision). The head SHA is the latest commit on the branch (the report correction after this one).

**What landed**
- `lib/start-lock.mjs`, protocol v1. The record is `{ pid, startedAt, nonce, v: 1, holderStartMs, holderStartId? }`.
  - `holderStartMs` is the holder's runtime time origin, an upper bound on its process start.
  - `holderStartId` is Linux only: `<boot id>:<start ticks>` from `/proc`, exact and immune to wall-clock steps.
  - The record is written atomically: a temp file, then `link()`. The lock path is either absent or a complete record.
  - Old kits read `pid`/`startedAt` only. The vendored origin/main excerpt below proves this.
- **Proof of a stale lock.**
  - The holder pid is dead.
  - Or the pid was reused. For v1, the start id differs (Linux), or the live start time is later than `holderStartMs` + 100 ms. For v0, the live start time is later than `startedAt` + 2 s (btime rounding).
  - An unknown live start time is no proof: the lock counts as contended.
- **The judge-then-delete race (ADR-0003 condition 1).** A contender that judged a record stale creates an exclusive claim for exactly those bytes: `manager.lock.claim-<sha256/16>`, carrying its own pid and start time, written the same atomic way.
  - Only the claimant deletes the record, and only after re-reading the lock and finding the judged bytes unchanged.
  - A claim whose claimant died is taken over the same way (a claim of the claim, at most 4 deep).
  - While holding the lock, the holder sweeps temp files of dead pids and claims on records that are gone.
- **Never deleted:** an unparsable lock, or one of an unknown higher version. Each gives a what/why/next error with the exact path (`manager error: start lock at <path> is not a readable start lock record, so it was left untouched.` + indented `why:` and `next:` lines). The CLI exit code stays 1 and stop's stays 4.
- **One takeover event line** (ticket 14 format): `WARN manager lock takeover holderPid=… reason="holder dead"|"pid reused" version=0|1 path=…`.
- `lib/proxy-lifecycle.mjs`:
  - Waiting starts retry the lock every 600 ms. A live holder's lock is still never touched. If the holder dies mid-start, the next attempt takes its lock over. The old loop gave up as soon as the lock vanished, and refused a dead holder's lock.
  - A start whose first check finds our proxy healthy takes a stale lock over and completes an unfinished record (`tidyWhileServing`). So no stale lock is left after a kill-holder round.
- **The spawn → pid record window is closed (Round 7 Q4 condition 1, Linux finding of 2026-11-06).**
  - `proxy.pid` is written as a spawn intent `{ pid: null, …, spawning: { by, at } }` before `spawn()`.
  - The pid is written right after the spawn, and the start time once known. Every pid-record write is atomic (temp + rename).
  - A start that holds the lock and finds an unfinished spawn waits for that proxy (≤ `pendingSpawnWaitMs` = 10 s, capped by its `waitMs`) and adopts it rather than spawn a second. The same applies to a recorded proxy still inside its startup grace.
- **Completing a record needs proof, never a port or a pid alone (Round 7 Q4 condition 3).**
  - The authenticated `/health` answer names pid P (`details.pid`, which the proxy already reports).
  - P's start time is read, a second answer must still name P, and P's start time read again must be the same.
  - P must be the recorded pid. With only an intent recorded, P must have started after the intent.
  - This runs under the start lock: at start, in tidy, and in stop. So a record left without a start time (a killed start, or a probe timeout) becomes stoppable.
  - The spawner itself keeps probing its own unreaped child during the health wait. Once the proxy is healthy, it keeps proving the record, bounded by its `waitMs`, before it returns. A forced probe timeout with no kill therefore ends with a complete record whenever the probe can answer at all.
- **New injection points** of `createLifecycle`: `stepHook(step)` (kill or pause injection at every lock and spawn step) and `pendingSpawnWaitMs`. New member: `acquireStartLock()`. Every spawn probe now goes through `processStartMsImpl` (before, the spawn probe ignored it).
- **AUD-001 comments** in the lifecycle module now describe proven takeover. ADR-0003 is amended (Round 7 Q4's Reversibility: the takeover claim and the pid-record contract). README has no "never taken over" line any more. SECURITY.md:26 belongs to ticket 53.

**Tests** (`tests/start-lock.test.mjs`, seam 2, wired into `npm run test`, 32 tests, free loopback ports):
- **Proofs.**
  - A dead v0 lock is taken over by ensure-running and by the manager CLI's stop, with one event line.
  - A v0 lock at a live pid that started after `startedAt` is taken over; one whose holder started before is left alone.
  - v1: a live holder is never touched; a later start is taken over; on Linux, another start id is taken over even with a far-future `holderStartMs`; an unknown start time is no proof.
  - The new record's shape is checked.
- **Unreadable and newer locks.** Garbage, an empty file, a non-numeric pid, a v1 record without a start time, and v7 are each left byte-identical. Each gives the exact what/why/next text, through the intent, the manager CLI `start` (exit 1) and `stop` (exit 4).
- **Old kits.** The vendored origin/main start-lock code (`tests/fixtures/origin-main-9e45d05/manager-start-lock.mjs`, re-checked block by block against `git show 9e45d05:…` when available) meets new locks. It reports a live v1 holder as START_IN_PROGRESS with its pid and startedAt. It reports a dead one as stale and never deletes either. The new kit waits on an old kit's live v0 lock.
- **Migration replayed twice:** the first pass takes a stale v0 lock over and logs one event; the second is a no-op.
- **Takeover race, real processes.**
  - The victim is killed alone at each of the 14 protocol steps: the 6 steps of the fresh path, the 8 takeover steps over a stale v1 lock, plus 4 double kills (a dead claimant, then a kill at each step of taking its claim over).
  - Then 5 racers run. Each racer must acquire, never overlap a live holder (an exclusive holder flag), and find its own record intact before release.
  - After every kill, the lock path holds no partial record (Story 48). Nothing is left in `logs/` afterwards.
  - Plus the victim among 5 racers, and the exact ADR-0003 condition 1 interleaving: a contender paused after judging, or while holding its claim, never deletes the fresh lock another contender wrote meanwhile.
- **Spawn window, real Bun stand-in proxy** answering with `details.pid`.
  - A start is killed at `spawn:intent-recorded`, `spawn:spawned`, `spawn:pid-recorded` and `spawn:start-recorded`. In each case the next `manager start` exits 0 and exactly 1 proxy exists. The record names the listener, carries its start time and verifies `match`. No lock is left, `manager stop` prints `stopped (pid N)`, and 0 proxies remain.
  - The same three post-spawn kills with a proxy that takes 4 s (6 s on Windows) to listen: no second proxy is spawned.
  - A probe that never answers during the start (no kill): the next start completes the record, and stop stops the proxy. Stop alone does the same.
  - A probe that answers only after the 5 s spawn window: the spawner's own record is complete.
- **Reused pid never signalled.**
  - A record without a start time, whose pid is a stranger while the listener names a decoy: stop refuses `start-unknown`, both processes are untouched and the record is unchanged.
  - A start time that changes between the two reads: not completed. A listener older than the intent: not adopted.
  - A waiter on a live holder that dies mid-start takes over and starts one proxy.
- `tests/memory/loop.test.mjs`: `launchOutcomes` (below), plus the S3/hung replay update (below).

**RED → GREEN** (logs in `reports/`)
- `t16-red1-startlock-tip`: the new file against the integration tip eb4a8f7 gives 22 fail, 2 pass. Most of these fail on the missing interface.
- `t16-red2-startlock-tip-seams`: for meaningful REDs, I scratch-patched the tip copy with injection seams only (`stepHook` calls at the same steps; the existing `acquireStartLock` exposed; patch in `/home/AgentKit/overhaul-tools/t16-scripts/tip-injection-seams.patch`). Result: 20 fail.
  - A dead v0 lock: "stale or unreadable … refusing automatic takeover".
  - Kill at `spawn:spawned`: "the pid record names the listener (null)", which is the Linux S3 orphan window.
  - Kill at `spawn:pid-recorded`: "with its start time".
  - Kill at `spawn:start-recorded`: "no stale lock after the start" (`manager.lock` left).
  - Kill at `spawn:intent-recorded`: the next start refused the stale lock.
  - The racers are refused on the stale lock.
- `t16-red3-probe-timeout-tip`: with the tip's spawn probe routed through `processStartMsImpl`, stop gives `code: 4, outcome: start-unknown`, "start time of pid N is not determinable … refusing to kill". This is exactly Round 7 Q4's defect.
- `t16-red-loop-tip`: `launchOutcomes` fails on the tip (missing).
- GREEN: `t16-green4-startlock` gives 32/32. The final full suite is below.

**Mutations** (implementation committed first; each mutant restored with `git checkout <sha> -- <file>`, `git diff` empty after each; `reports/t16-mut-*`; script `/home/AgentKit/overhaul-tools/t16-scripts/mutate.py`). All 15 were killed on 80b231d:
- m1: no re-read before the delete.
- m2: no claim (delete right after judging). Killed by the judge-then-delete test and the race.
- m3: an unknown start time counts as stale.
- m4: every live holder counts as reused.
- m5: the lock written in place in two halves. Killed by the race's partial-lock check.
- m6: completion accepts a listener pid other than the record's.
- m7: no second start-time read.
- m8: an intent adopts an older listener.
- m9: waiters never retry the lock.
- m10: stop does not complete a record.
- m11: no tidy while serving.
- m12: no wait for an unfinished spawn. It survived on 313877c, which gave the delayed-proxy tests.
- m13: no spawn intent.
- m14: no sweep.
- m15: no late completion by the spawner. Its first form survived on 313877c, which gave the late-probe test and the fix in 80b231d.
- m15b (deleting only the first of its two calls) is an equivalent mutant: the post-healthy loop does the same work.

**Scenario changes (two-way door, recorded here; budgets unchanged)**
- **S3 `failed-launches` (`tests/memory/scenarios/s3-concurrency.mjs` `launchOutcomes`).**
  - The kill-holder adversary SIGKILLs one of the round's own 10 preflights (the lock holder). That launch (`code=null`) was counted as failed in every run, so the budget 0 "incl. a killed lock holder" (spec §18, ADR-0003 condition 5: "0 failed launches with a killed holder") was unreachable by any kit.
  - It is now reported as `killedByAdversary`, matched by pid. Every other non-zero launch still counts.
  - On the tip this still leaves 2/7/2 (S3/short) and 10/11/10 (S3/hung) failed launches. So the change does not make the check pass; the kit fix does.
- **S4 (`s4-lifecycle.mjs`).** The stale-lock respawn phase unlinked the dead holder's lock unconditionally. Since the kit now takes that lock over, the unlink threw ENOENT, which was a harness failure. It now records `staleLockLeft` and removes the lock only if present.

**Pre-existing test changes (justified; ADR-0003 supersedes the no-takeover rule)**
- `tests/proxy-lifecycle.test.mjs` "ensure running reports a lock it may not take…": the dead-pid v0 lock became a v99 lock (still untouched, `/so it was left untouched/`).
- `tests/auto-heal.test.mjs` "stale pid is removed safely but … not stolen": the same, with the title "a manager lock the kit cannot judge".
- `tests/memory/loop.test.mjs`, ticket 65's S3/hung replay: the pre-fix refused run still passes the evidence gate as RED. Its REDs on the two removed names now fail the ratchet as unowned. The test pins both messages.

**Memory loop** (Linux, short profile, `--only S3/short,S3/hung,S4/short`, port 19160/19161; run dirs `/home/AgentKit/overhaul-tools/t16-memloop/{tip1-3,branch4-10}`; `reports/t16-mem-{tip,branch2,final}.log`):

| check (16's names) | tip eb4a8f7, 3 runs | branch 313877c (4) + merged 7cd8103 (3) |
|---|---|---|
| S3/short failed-launches | 3, 8, 3 (victim incl.; 2, 7, 2 without) | 0 in 7/7 |
| S3/short stale-lock-after-round | 1, 1, 1 | 0 in 7/7 |
| S3/short exactly-one-proxy-after-round | 0 (GREEN locally; flips) | 0 in 7/7 |
| S3/hung failed-launches | 11, 12, 11 | 0 in 7/7 |
| S3/hung stale-lock-after-round | 2, 2, 2 | 0 in 7/7 |
| S3/hung start-over-stale-lock / exactly-one | 0 / 0 (flips) | 0 / 0 in 7/7 |
| S3 afterKillHolder: next stop | exit 4, stale-lock refusal | exit 0, `stopped (pid N)` |

- Ratchet holds on every branch run. The tip runs held with the old list.
- The RED names left are 37's (`peak:kit`, `procPeak:launcher`; on the merged tree `procPeak:mcp-bridge` is GREEN after 36) and 17's `stale-lock-after-ctrl-c` (S4, 5/8, signal release).
- Not 16's, recorded for 17: S4 `respawn-recovers-despite-stale-lock` went from RED (0 proxies up) in 3/3 tip runs to GREEN in 7/7. `unstoppable-proxy-after-ctrl-c` was 1/8, 0/8, 1/8 on the tip and 0/8 in all 7 branch runs. Linux S3 `orphans` was 0 everywhere.
- Footprint is unchanged by 16 (S3 `peak:kit` 850–902 MB branch vs 850–872 tip on the same tree; 795–852 after 36). The preflight peak is 63–76.5 MB (one 76.5 sample in branch6, a flips name of 37).
- The spawn → record window was not hit naturally in these local runs (the kill landed at 138–251 ms). The seam tests force it deterministically on both legs.

**expected-red.json**
- Removed: `failed-launches` and `stale-lock-after-round` from `S3/short` and `S3/hung`, linux and windows. Both were RED in every matching run (non-flips).
  - The evidence is the 7 local loop runs above, plus the pre-merge CI run, which must show them GREEN on both legs.
  - With the names gone, a RED there now fails the ratchet as unowned. That is the guard.
- Kept (`flips`, Round 15 Q1 condition 5): `exactly-one-proxy-after-round` (S3/short, S3/hung) and `start-over-stale-lock` (S3/hung), both legs.
  - They need ≥ 10 GREEN matching CI runs per leg on 16's tree; one CI run covers both legs.
  - Round 22's power caveat is met by the seam tests: kill at every protocol step, and the spawn-window kills on ubuntu and windows.

**Full suites on the merged tree 7cd8103** (Bun 1.4.2, Node 26.7.0)
- `npm run test` (`t16-final-test`): 917 tests, 899 pass, 0 fail, 18 skipped. After the second merge and the free-port change (`t16-final2-test`): 918 tests, 900 pass, 0 fail, 18 skipped.
- `npm run test:proxy` (`t16-final-proxy`): 1451 pass, 0 fail, 98 files.
- `npm run test:proxy-typecheck`: clean.
- `npm run test:mcp` (`t16-final-mcp`): 100 tests, 99 pass, 0 fail, 1 skipped. `dist/` unchanged.
- `npm run test:ux-before`: 1/1.
- Memory suites (`t16-mem-tests`, before the merge): 186 tests, 181 pass, 5 skipped.

**Decisions taken (spec/ADRs silent)**
1. **Claim-based takeover rather than rename-and-compare.** A rename moves a fresh lock away and leaves a window for a third contender. The claim never moves the lock; it only authorises one delete of named bytes.
2. **The v1 start time is an upper bound** (the runtime's time origin), not the OS start time. Reading the OS start time on Windows costs a PowerShell call on every acquisition. "Created after the bound" is still proof. On Linux, the exact `/proc` start id avoids btime drift turning a live holder into a "reused" one.
3. **The spawn intent lives in `proxy.pid`, not in the lock.** Old kits read it as no record. A proxy found with no record and no intent (TUI-hosted, or an old kit's killed start) is not adopted here; that is ticket 17's.
4. **Event lines go to `proxy.log` only.** No new stdout lines, so CLI and preflight output stay byte-identical (ux-before).
5. **No new config keys or env overrides.**

**Pending CI (orchestrator verifies after merge+push)**
- **windows-latest test-kit, Node 24 and 26: `tests/start-lock.test.mjs` is all green.** These are Round 7 Q4 condition 1's seam proofs:
  - (a) `a start killed at spawn:intent-recorded|spawn:spawned|spawn:pid-recorded|spawn:start-recorded ends with exactly one proxy, adopted by the next start and stopped by stop`, which covers a kill at each point between spawn and the complete record;
  - (b) `… while its proxy is still coming up …` ×3. A diagnostic "windows: the orphaned proxy was already up" is allowed; then the adoption path ran instead of the wait;
  - (c) the forced probe timeout with no kill: `a start whose start-time probe times out (no kill) …`, `stop completes a record left without a start time …`, `the spawner itself completes the record …`;
  - (d) `a reused pid is never signalled …`, `… same before and after its second answer`, `a spawn intent adopts only a proxy that started after it`;
  - (e) the race tests and the judge-then-delete test (hard links on NTFS; self-SIGKILL is TerminateProcess);
  - (f) `v1 on Linux …` is skipped on Windows by design.
  - Watch the durations: Windows judges a reused pid through PowerShell (2.5 s timeout).
- **ubuntu test-kit, Node 24 and 26:** the same file. The vendored origin/main check skips with a diagnostic on a shallow checkout.
- **`tests/proxy-lifecycle.test.mjs` on windows:** the `startTimeMissing` diagnostics ("start-time probe did not answer within its deadline") should now be rare or gone, because the spawner keeps proving its record. Their presence is not a failure.
- **memory-budget, both legs:**
  - The ratchet holds with the edited list.
  - `failed-launches` and `stale-lock-after-round` are GREEN in S3/short and S3/hung. If either is RED, it fails as unowned and comes back to 16 with numbers; record `notes.rounds[].failedLaunches`, `killedByAdversary` and `adversary`.
  - `start-over-stale-lock` and `exactly-one-proxy-after-round` should be GREEN. They stay listed until 10 GREEN runs per leg.
  - S4/short stays RED on 17's `stale-lock-after-ctrl-c`. `respawn-recovers-despite-stale-lock` is expected GREEN (17's name, not removed here).
- **ux-before on both legs:** byte-identical.
- **CI runs needed:** the pre-merge run, plus ≥ 10 matching CI runs per leg (10 CI runs, each covering both legs) on 16's tree, before 16's follow-up commit removes the two flipping names. The commit that removes S3/hung linux's last 16 name leaves the entry to 37 (it does not delete it).

**Left for other tickets**
- **17:**
  - Signal release (S4 `stale-lock-after-ctrl-c` 5/8 unchanged).
  - Adoption of a healthy proxy with no record and no intent (old kits, TUI-hosted).
  - The Windows suspended proxy left by a holder killed inside `spawn()`. It cannot be injected deterministically from JS. Here it leaves an intent: the next start waits ≤ 10 s, then spawns its own proxy, and the suspended process remains for 17's reap.
  - The S3 `orphans` names (windows; linux S3/short), which the closed spawn → record window should turn GREEN. 17 removes them.
- **53:** SECURITY.md:26 "never taken over".
- **ticket 70's note** (the stop path's exit poll by pid) is untouched here.
