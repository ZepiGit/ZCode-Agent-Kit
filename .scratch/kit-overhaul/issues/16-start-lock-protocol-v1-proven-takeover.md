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

### 2026-11-08 — implementer (ticket 16), round 2 (Owner Proxy round 27; pre-merge CI run 42507303528)

**Branch:** `ticket/16-start-lock-v1`, round 2 starting from 4dbee25. Commits:
- `06781d8`: `launchOutcomes` leaves out a launch only when exactly one launch carries the killed pid.
- `74a8bfc`: the S3 rounds record `launches[]`, and the kill-holder evidence gate is added.
- `ae39833`: the rule text in spec §18, METRICS.md, ADR-0003, plus Round 27's Acceptance and Comments lines.
- `cac3221`: merge of the integration tip 5f754b8 (ticket 29, rounds 27–28, ticket 77), with no conflicts.
- `6bcbb35`: the respawn test's wait never takes a spawn intent.
- `6e99192`: a dead spawner's never-started proxy is resumed, not doubled.

The head is the commit that adds this report.

**Round 27 Q1, condition by condition**
- **(2) Fail-closed gate, RED first.**
  - `tests/memory/scenarios/s3-concurrency.mjs`: `launchOutcomes` stays a pure helper with its existing cases. A killed pid carried by two launches now names no victim, and both count as failed.
    - RED on 4dbee25: `t16-r2-red1-launchoutcomes`. The current code put both launches in `killedByAdversary` and hid the `code=4` failure.
    - GREEN: `t16-r2-green1-launchoutcomes`.
  - Every S3 round records `launches[]` (`i`, `via`, `pid`, `code`, `signal`; additive).
  - `tests/memory/lib/completeness.mjs` `KILL_HOLDER_ROUNDS` (`kill-holder-10` in S3/short, S3/long, S3/hung) makes the run a harness failure in five cases. The failure names the round and prints the adversary record:
    - no kill (`killed: null`, or no adversary record);
    - a killed pid that matches no launch (including a round without `launches[]`);
    - a matched launch that exited 0;
    - two or more launches on the killed pid;
    - fewer launch records than launches.
  - Job-seam tests replay a real S3/short run of this tree (`tests/memory/fixtures/local-20261108-s3-short-linux-summary.json`: victim preflight#6, pid 31679, SIGKILL; 9 launches exit 0). There is one test per state, the good case keeps its verdict, and S3/hung is gated the same way.
    - RED on the current gate: `t16-r2-red2-killholder-gate` (6 fail: each state gave RED, never HARNESS FAILURE).
    - GREEN: `t16-r2-green3-loop` (loop.test.mjs 98 pass, 0 fail, 5 skipped).
- **(1) Rule text.** In spec §18 PROCESSES (first bullet), METRICS.md (new section "S3 kill-holder round …") and ADR-0003 (inside 16's amendment).
  - METRICS also carries the power figures (S3/hung 62/62 and 43/43; linux S3/short 61/62; windows S3/short 34/43, with the victim alone in 9 of 43 and in 4 of the latest 20).
  - It also notes that every earlier `failed-launches` value includes the victim, the baseline "7/10 failed (killed holder)" too.
  - `budgets.mjs` is unchanged (`git diff origin/overhaul/stability-terminal-ux...HEAD -- tests/memory/lib/budgets.mjs` is empty).
- **(5) S4 `staleLockLeft`** is recorded in `notes.respawnWithStaleLock` only. Nothing reads it: `grep -rn staleLockLeft tests lib cli proxy` finds only the S4 assignment, and S3's own `stale-lock-after-round` round field, which is a different name. On this tree it was `false` in 7 of 7 (branch4–10), with the proxy healthy and respawn exit 0 (METRICS).
- **(3) Visibility, pre-merge run 42507303528 (windows memory leg, code 4dbee25).**
  - S3/short kill-holder: `killedByAdversary` `["preflight#3 code=1 starting zcode-proxy ..."]`, `failedLaunches` `[]`, adversary `{"killed":4104,"afterMs":284,"proxiesAtKill":0,"pidRecordAfterKill":{"pid":null,…,"spawning":{"by":4104,…}}}`.
  - S3/hung kill-holder: `["preflight#9 code=1 starting zcode-proxy ..."]`, `[]`, adversary `{"killed":8140,"afterMs":305,"proxiesAtKill":0,"pidRecordAfterKill":{"pid":7280,"startedMs":null,…}}`.
  - `failed-launches` 0 and `stale-lock-after-round` 0 in both keys. Windows S3/hung was RED only on 37's `peak:kit`.
  - The windows ratchet still FAILED, on S3/short unowned names (below). So this run does not satisfy condition 4, and a new pre-merge run is needed on this head.
- **(4) Extra windows merge conditions, all pending CI (orchestrator verifies after merge+push), on the pre-merge run of THIS head:**
  - The windows memory leg is GREEN on `failed-launches` and `stale-lock-after-round` in S3/short and S3/hung.
  - Both kill-holder rounds are clean there: S3/short and S3/hung each have exactly one `killedByAdversary` entry and 0 `failedLaunches`, and the gate does not fire.
  - In the same run, `tests/start-lock.test.mjs` is green on the windows `test-kit` legs (Node 24 and 26), in particular:
    - the kill at every protocol step;
    - "a start waiting on a live holder takes the lock over once that holder dies mid-start, and ends with one proxy";
    - the spawn-window kills;
    - the new "a start killed while its proxy never ran …" (default CIM scan and NtResumeProcess, no injection on Windows).
  - If any of this fails, the names do not leave the windows list, and 16 does not merge.
- **(6) Matching-count restart:** the count restarts on 16's tree for S3/short, S3/hung, S3/omp and S4/short, both legs (METRICS states the scope). 16's `flips` names need ≥ 10 GREEN matching CI runs per leg on that tree. Pending CI.

**CI run 42507303528, the two RED jobs**
1. **windows memory-budget, S3/short unowned `count:proxy` 2, `simultaneous-proxies` 2, `proxy-generations/round` 2. This is 16's, and it is fixed in `6e99192`.**
   - The adversary killed the holder (pid 4104) at 284 ms, inside its `spawn()` call: 0 proxies, record = intent with no pid.
   - libuv creates a detached Windows child with `CREATE_SUSPENDED` and calls `ResumeThread` only after `CreateProcessW` returns (`deps/uv/src/win/process.c`, `uv_spawn`; source: https://raw.githubusercontent.com/libuv/libuv/v1.x/src/win/process.c). So the proxy, pid 5728, never ran. Its ParentProcessId is 4104, and it sat at 1 thread, 1.7 MB WS and 4.7 MB commit, unchanged for 20 s (`samples.csv`).
   - 16's takeover then let the waiters wait the 10 s pending-spawn bound (launches 12–14 s) and spawn a real proxy. The sampler counted both as `proxy`. Pre-16 the lock stayed stuck, so nothing was ever spawned beside it, which is why these names were never RED before.
   - **Fix:** under the start lock, an intent without a pid whose spawner is dead has the spawner's children listed. On Windows that is CIM `ParentProcessId`, which keeps naming a dead creator. On POSIX the list is `[]`: fork+exec never leaves an unstarted child, and it is re-parented. The kit resumes the child (NtResumeProcess; SIGCONT), never kills it, and only when:
     - it is the only child that is this installation's kit proxy (`isKitProxyCommand`);
     - it started after the intent (−2 s);
     - its start time is unchanged just before the resume.
   - After the resume, the existing bounded wait and the `completeRecord` proof adopt it. One event line: `INFO manager never-started proxy resumed pid=… spawner=…`. The new injection points `spawnedChildrenImpl` and `resumeProcessImpl` are tests only, with no config key and no env override.
   - **Seam 2, RED first.** "a start killed while its proxy never ran (intent without a pid, proxy frozen before it listens) …": the start is killed at `spawn:spawned` and its proxy is frozen before it listens (SIGSTOP; NtSuspendProcess on Windows). On Linux the scan is injected with what Windows reports.
     - RED: `t16-r2-red3-never-started`, `no second proxy was spawned (spawned: 318266, 318335)`, which is the CI symptom.
     - GREEN: `t16-r2-green5-never-started`. One proxy, the resumed one, serves with a complete, verified record. No lock is left, one event line, and stop leaves 0.
   - **Adversarial guard test:** "only a dead spawner's single child that is the kit proxy and started after the intent is ever resumed". Nothing is resumed for:
     - a foreign child;
     - a kit proxy older than the intent;
     - two kit proxies;
     - an unknown start time;
     - a pid reused after the scan.
     A live spawner is never scanned.
   - **Mutations** on 6e99192 (`/home/AgentKit/overhaul-tools/t16-scripts/r2-mutate.py`; logs `t16-r2-mut-n*`). Each mutant was restored with `git checkout 6e99192 -- lib/proxy-lifecycle.mjs`, and the diff was empty after each. All 5 were killed:
     - n1: no command-line check;
     - n2: no after-intent check;
     - n3: the first of many;
     - n4: a live spawner;
     - n5: no re-check before the resume.
   - Linux behaviour is unchanged: the POSIX scan is `[]`, and the loop below is the same as before.
   - The S3 `orphans` RED in this run (windows, 17's) is the same pid 5728. On 16's tree it should go GREEN in this case, and 17 removes a GREEN name (Round 22 Q1).
2. **test-kit ubuntu Node 24, "an old proxy (origin/main) calling the new manager's respawn CLI gets a fresh proxy (spawned)" (`8511 !== null`). This is a test race that 16's spawn intent made reachable; no product defect. Fixed in `6bcbb35`.**
   - The wait read `proxy.pid`, then awaited the port check (up to 1.5 s), and returned the record it had read before.
   - Under load, the read landed on 16's spawn intent (`pid: null`, written before `spawn()`) while the fresh proxy answered by the time the delayed check connected. So `fresh.pid` was null, and the final record named 8511.
   - Before 16, every record with another pid already named the fresh proxy.
   - **Fix (pre-existing test change, justified):** check the port first, then read the record, and accept only a record that names a pid.
   - **Proof by mutation:**
     - scratch: a 2 s synchronous pause between `spawn()` and the pid write in `lib/proxy-lifecycle.mjs`, the way a loaded runner stalls;
     - old predicate: RED, `the respawned proxy is the recorded one 312814 !== null`, 23.3 s, matching CI's 21.4 s (`t16-r2-mut-respawn-oldtest`);
     - fixed predicate: GREEN in 3.5 s (`t16-r2-mut-respawn-newtest`);
     - the mutant was restored with `git checkout 6bcbb35 -- lib/proxy-lifecycle.mjs`, and the diff was empty.
   - Unmodified, it passed 4 of 4 locally (`t16-r2-respawn-trace1–4`; the scratch trace showed no intent ever read when not under load).

**Pre-existing test changes this round (justified)**
- `tests/memory/loop.test.mjs`: the synthetic S3 builders' bare `{ name: "kill-holder-10" }` became `KILL_HOLDER_ROUND` (the kill and one matched launch), because a bare name is no evidence under condition 2. This applies in `S3_HUNG_ROUNDS` and in the stale-lock refused-start good case.
- `tests/memory/loop.test.mjs`, the replay of `local-20261107-s3-hung-refused-linux-summary.json`:
  - as archived, it is now a harness failure (no launch pids), and the test pins that;
  - its ticket-65 refused-start checks (RED with the two unowned names, and the cut and unchecked variants) run on a copy whose kill-holder launches are in the new shape: the victim is preflight#0 (its own failedLaunches line) under the adversary's pid, and the other pids are not recorded (null).
- `tests/proxy-lifecycle.test.mjs`: the respawn test's wait (item 2 above).

**Suites on the final tree (6e99192, Bun 1.4.2, Node 26.7.0)**
- `npm run test` (`t16-r2-final3-test`): 928 tests, 910 pass, 0 fail, 18 skipped.
  - On cac3221 before the CI fixes (`t16-r2-final-test`): 926 tests, 908 pass, 0 fail, 18 skipped.
  - One intermediate run (`t16-r2-final2-test`) collided with another worktree's concurrent runs on fixed ports:
    - `ux-before-capture` said "port 18460 is in use; another capture may be running";
    - `json-superset`'s captures on the same port diverged;
    - `manager-audit` uses ports 18795–18805 and hung without a timeout until I ended its worker.
  - All three files passed on their own (`t16-r2-recheck3`: 38/38), then in the full run above. This is ticket 75's class; I changed no file there.
- `npm run test:proxy` (`t16-r2-final3-proxy`): 1479 pass, 0 fail, 100 files. `test:proxy-typecheck`: clean.
- `npm run test:mcp` (`t16-r2-final3-mcp`): 100 tests, 99 pass, 0 fail, 1 skipped. `dist/` unchanged, git clean.

**Linux S3 loop** (`job.mjs --os linux --only S3/short,S3/hung`, free loopback ports, `/home/AgentKit/overhaul-tools/t16-memloop/r2-merged1–3` on cac3221 and `r2-final4` on 6e99192; logs `t16-r2-mem1–4`):

| run | S3/short failed-launches / stale / exactly-one | S3/hung failed-launches / stale / exactly-one | kill-holder rounds (killedByAdversary, launches on the killed pid) | ratchet |
|---|---|---|---|---|
| r2-merged1 | 0 / 0 / 0 | 0 / 0 / 0 | 1, 1 and 1, 1 (141, 182 ms) | holds |
| r2-merged2 | 0 / 0 / 0 | 0 / 0 / 0 | 1, 1 and 1, 1 (169, 215 ms) | holds |
| r2-merged3 | 0 / 0 / 0 | 0 / 0 / 0 | 1, 1 and 1, 1 (179, 242 ms) | holds |
| r2-final4 | 0 / 0 / 0 | 0 / 0 / 0 | 1, 1 and 1, 1 (144, 199 ms) | holds |

- The gate never fired: 8 of 8 kill-holder rounds have exactly one matched launch.
- `failed-launches` is 0 in all 8 keys.
- REDs are 37's only: `peak:kit` and `procPeak:launcher`, plus `procPeak:proxy` once in r2-merged2 S3/hung.

**Decisions taken (spec/ADRs silent)**
1. **The gate checks `launches[]` independently of `launchOutcomes`.** It recomputes the match from raw pids and exits, so a later edit of the helper cannot weaken it.
   - It also covers S3/long's `kill-holder-10`.
   - "Fewer launch records than launches" is a harness failure: a missing record could hide a second launch on the pid.
2. **Round 27's Acceptance line and orchestrator Comments line are added verbatim** in this branch's ticket copy (`ae39833`); the orchestrator should not add them again.
3. **The never-started proxy is fixed in 16, not left to 17,** for three reasons:
   - 16's windows Acceptance line ("a kill injected at each point between spawn and the complete record … ends with the proxy stoppable or adopted") is not met while it stays suspended;
   - the unowned REDs block the merge, and adding owners is not allowed;
   - Round 22 Q1 foresees 16 closing the window first.
   The path never kills; it resumes only, and only a proven candidate. 17 keeps signal release, adoption without any record, and its `orphans` names.
4. **POSIX `spawnedChildren` returns `[]`** rather than scanning `/proc` by command line. The state cannot occur there, and a wider scan could resume a process a user stopped on purpose.

**Left for other tickets**
- **77:** the stop path's millisecond kill guard is untouched. The resume path compares start times with `sameStart`, from CIM `CreationDate` against `Get-Process` `StartTime`, which come from the same FILETIME.
- **17:** removes its windows S3 `orphans` names once they are GREEN on this tree.

**Addendum, the same day: two more tip merges**
- `3395c0c` merges the tip 9256a33 (tickets 20, 21 and 76). The only conflict was METRICS.md, where both sides added a section at the same place; I kept both, ticket 20's first. `expected-red.json` merged on its own; 16's S3 entries are unchanged.
- `de4dec2` merges the tip f56c46d (round 29). It touches only `.scratch`, so no code changes after 3395c0c.
- Suites on 3395c0c:
  - `npm run test` (`t16-r2-merged9256-test`): 929 tests, 911 pass, 0 fail, 18 skipped.
  - `test:proxy` (`t16-r2-merged9256-proxy`, with 76's egress guard): 1596 pass, 0 fail, 107 files. Typecheck clean.
  - `test:mcp`: 100 tests, 99 pass, 0 fail, 1 skipped. `dist/` unchanged.
- Linux S3 loop on 3395c0c (`r2-merged9256-1–3`, logs `t16-r2-merged9256-mem1–3`): in 3 of 3 runs, S3/short and S3/hung have `failed-launches` 0, `stale-lock-after-round` 0 and `exactly-one-proxy-after-round` 0. Every kill-holder round has 1 `killedByAdversary` and 1 launch on the killed pid (145–220 ms), so the gate never fires. REDs are 37's only, and the ratchet holds 3/3. Over the whole of round 2, that makes 14 of 14 kill-holder rounds clean.
- **Ticket 18 (orchestrator note):** it is not on the tip at de4dec2, so nothing changes here. If 18 merges before 16, the merge into this branch must keep 18's `stopToken` and the 0600 mode wherever 16 rewrites `proxy.pid`. That means `writePidJson` (temp + rename, already `mode: 0o600` on the temp file and the fallback), `writePidFile`, and `completeRecord`, which must copy the token from the existing record for the same pid. The merge also needs a test that `completeRecord` keeps the token and the mode, and must never print the token (B2).

### 2026-11-08 — implementer (ticket 16), round 3 (merge with ticket 77)

**Branch:** `ticket/16-start-lock-v1`, from 0a7d5c3. The merger could not merge it: the tip contains ticket 77 (merge 78f51bd, exact start identity `{ ms, ticks }`, `startTicks` in `proxy.pid`).
- `88f07dc`: merge of the integration tip 8160c69 (`overhaul/stability-terminal-ux`), conflicts resolved below.
- `5599613`: three cross-ticket tests (16's records × 77's ticks).

The head is the commit that adds this report.

**Resolution, hunk by hunk (`lib/proxy-lifecycle.mjs`)**
- **Hunk 1, the pid record writer.**
  - There is one record builder now, `pidRecord(pid, start, { spawning })`, which gives `{ pid, startedMs, startedIso, startTicks?, spawning? }`. 16's atomic `writePidJson` (temp + rename, mode 0600) writes everything it builds.
  - `writePidFile(pid, start, spawning = null)` takes 77's identity `{ ms, ticks }` or null.
  - `startTicks` is recorded whenever the identity carries ticks. `spawning` is kept only while the start is unknown.
  - The spawn intent goes through the same builder (`pidRecord(null, null, { spawning })`), and its bytes are unchanged.
  - 16's `readPidJson()` and `pendingSpawn()` are kept unchanged. A record counts as unfinished on a missing `startedMs` only. So a record with damaged `startTicks` is not "completed" over 77's fail-closed refusal (77's test "start ticks present but unreadable" still passes).
  - Ticket 18's `stopToken` gets one place to go, `pidRecord` (or its options), so all writers keep it. 18 itself is not implemented.
- **Hunk 2, the spawn start-time probe loop.** 16's `startOf` (ms, through `processStartMsImpl`) is gone. Every start read of 16's paths is now 77's `liveStartOf`. It gives `processStartIdentity` (with ticks on Windows) or, when a test injects `processStartMsImpl`, `{ ms, ticks: null }`. So the probe keeps 16's rule that every spawn probe goes through the injection point, and it records ticks in production.
- **16's callers that assumed ms:**
  - `completeRecord`: `before` and `after` are identities, and `sameStart(before, after)` is exact when both reads carry ticks. Otherwise it keeps 77's ms rule, with 1 ms on Windows only for identities without ticks. The intent check uses `before.ms`. The completed record is `writePidFile(pid, before)`, so it carries `startTicks`.
  - `awaitHealthy` `fillStart`: `liveStartOf` gives an identity, which is written with ticks.
  - The start lock's `processStart`: `liveStartOf(pid)?.ms`. The lock record format is unchanged (`holderStartMs` upper bound, Linux `holderStartId`). On Windows the holder's ms now comes from exact ticks, without the float loss.
  - `resumeNeverStarted`: the CIM scan's start is compared as `{ ms, ticks: null }`, under the 1 ms rule. The reason is that CIM `CreationDate` is a DMTF datetime with microsecond resolution, so its ticks cannot equal `Get-Process` ticks exactly. `spawnedChildren` now converts through 77's `startFromTicks`, with no float loss. This path never signals a kill. The resumed proxy is adopted only through `completeRecord`'s exact proof.
- **B4:** every kill still passes `verifyOwnProcess` (exact ticks against a ticked record) and 77's integer kill guard. No path signals a process on a ms match when both sides have ticks.

**New tests** (`tests/start-lock.test.mjs`; fake Windows via 77's `tests/fixtures/fake-powershell.mjs`; skipped on win32, where the real-PowerShell tests run):
1. "a record completed by 16's proof carries the exact start ticks …": an unfinished record (pid, no start) and a spawn intent are each completed to `{ pid, startedMs, startedIso, startTicks }`, with a start one tick past a ms boundary.
2. "16's proof never completes a record when the listener's pid changed hands between its two reads within one millisecond (other ticks)": the two proof reads give T and T+1 (same ms), and the record stays byte-identical.
3. "the kill guard after a record 16 completed uses the exact ticks …":
   - After completion, stop runs one guard with `if ($created -ne [long]'<FILETIME>') { exit 4 }`, and the proxy exits.
   - With the pid reused one tick later, stop gives `code 4, reuse-suspect`, with no guard run. The process is never signalled and the record stays.

**Mutation proof** (the tests pin behaviour the merge already has; implementation committed first; `/home/AgentKit/overhaul-tools/t16-scripts/r3-mutate.py`; each mutant was restored with `git checkout 5599613 -- lib/proxy-lifecycle.mjs`, and `git diff` was empty after each; logs `reports/t16-r3-mut-*`). All 3 were killed:
- r1, the builder drops `startTicks`: killed by tests 1 and 3, and by 77's "a proxy the manager starts on Windows records its exact start ticks".
- r2, `completeRecord` compares in ms only: killed by test 2.
- r3, the completed record is written from ms only: killed by tests 1 and 3.
  - With test 3's ticks assertion removed (a scratch copy, deleted afterwards), the reuse branch alone fails: `reused one tick later: stopped`, `code 0`. So an ms-only record lets the guard stop a pid reused within the same millisecond, which is the B4 hole the exact record closes (`t16-r3-mut-r3-guardonly`).

**Suites on the merged tree** (5599613; Bun 1.4.2, Node 26.7.0)
- `npm run test` (`t16-r3-final2-test`): 940 tests, 922 pass, 0 fail, 18 skipped.
  - The first run (`t16-r3-final-test`) overlapped another worktree's full kit suite and failed only `json-superset` (`status --json (down): exit 0, baseline 1`: something else answered on the fixed capture port).
  - It passed alone (`t16-r3-recheck-json`: json-superset plus ux-before-capture, 22/22), and then in the full rerun. This is ticket 75's class; no file changed.
- `tests/proxy-lifecycle.test.mjs` + `tests/start-lock.test.mjs` right after the resolution (`t16-r3-merge-lifecycle`): 57/57. That includes every 77 test, and 16's spawn-window, probe-timeout, reuse and never-started tests.
- `npm run test:proxy` (`t16-r3-final-proxy`): 1596 pass, 0 fail, 107 files. `test:proxy-typecheck`: clean.
- `npm run test:mcp` (`t16-r3-final-mcp`): 100 tests, 99 pass, 0 fail, 1 skipped. `dist/` unchanged, git clean.

**Linux S3 loop** (`job.mjs --os linux --only S3/short,S3/hung`, free loopback ports 42169/34301/38943; `/home/AgentKit/overhaul-tools/t16-memloop/r3-1..3`; logs `t16-r3-mem1–3`):

| run | S3/short failed-launches / stale / exactly-one | S3/hung failed-launches / stale / exactly-one | kill-holder rounds (killedByAdversary, failedLaunches, launches on the killed pid; kill at) | ratchet |
|---|---|---|---|---|
| r3-1 | 0 / 0 / 0 | 0 / 0 / 0 | 1, 0, 1 (156 ms) and 1, 0, 1 (170 ms) | holds |
| r3-2 | 0 / 0 / 0 | 0 / 0 / 0 | 1, 0, 1 (164 ms) and 1, 0, 1 (216 ms) | holds |
| r3-3 | 0 / 0 / 0 | 0 / 0 / 0 | 1, 0, 1 (174 ms) and 1, 0, 1 (205 ms) | holds |

- `start-over-stale-lock` and `orphans` are 0 in all 6 keys.
- The round-27 gate never fired. There was no HARNESS FAILURE, and each victim (`code=null`, SIGKILL) is the single launch on the killed pid, among 10 launch records.
- REDs are 37's only: `peak:kit`, `procPeak:launcher`, plus `procPeak:proxy` 62.3 MB (budget 62) once, in r3-3 S3/short.

**Pending CI (orchestrator verifies after merge+push)**
- **windows-latest test-kit, Node 24 and 26.** `tests/start-lock.test.mjs` must be green there: the windows seam proofs of round 2 (a)–(e) and "a start killed while its proxy never ran …". These now run with the real PowerShell recording `startTicks`. The three new tests skip on win32 by design, and so do 77's fake-Windows tests.
- **The same run's `tests/proxy-lifecycle.test.mjs`:** 77's real-Windows paths go through 16's writer.
- **The windows memory leg (round 27 condition 4)** must show, on the pre-merge run of THIS head:
  - `failed-launches` and `stale-lock-after-round` GREEN in S3/short and S3/hung;
  - in both kill-holder rounds, one `killedByAdversary` and 0 `failedLaunches`;
  - the gate not firing.
- **Also watch:** that Windows stops of 16-completed records go through 77's exact guard (no `kill guard exit 4` on the right process).

**Decisions taken**
1. **Ticks are compared exactly only where both identities carry them.** That covers `completeRecord`'s two reads, and `verifyOwnProcess`/`exited` against a ticked record (77). The CIM resume scan stays on the ms rule (DMTF microsecond resolution). Its resumed proxy is recorded only through the exact proof.
2. **The start lock's v1 record does not gain Windows ticks.** That would mean a PowerShell call for the holder's own start on every acquisition (round 1 decision 2). The ticket asks for exact comparison "when both sides have them", and the lock's holder side has no ticks on Windows.

**Addendum (round 3).** The tip merged in `88f07dc` is 91fa58f, not 8160c69 as written above (91fa58f contains 8160c69 and 78f51bd). The tip then moved to 788f2fb, a docs-only commit (`.scratch` only). It is merged in the commit after `5c92dc7`, with no conflicts and no code change, so the suites and loop above stand for the code at the head.

### 2026-11-09 — implementer (ticket 16), round 4 (pre-merge CI run 42535365053: windows Node 26 takeover race)

**Branch:** `ticket/16-start-lock-v1`, from 1a9b457.
- `b443d7e`: merge of the integration tip de1d550 (tickets 75 and 73). There were no conflicts. `lib/start-lock.mjs`, `lib/proxy-lifecycle.mjs`, `tests/start-lock.test.mjs` and the fixtures are unchanged by it.
- `9bb23ec`: the fix and the seam test.
- `eed991d`: one more seam test (release), added after a mutant survived.

The head is the commit that adds this report.

**Root cause.** On Windows, an fs call on a name that another process is deleting (delete pending) or holds open fails with EPERM, sometimes EBUSY or EACCES. It does not give the ENOENT/EEXIST the protocol expects. In the race, a racer read or linked `manager.lock` while another racer released it (or while a claimant deleted it). The error left the protocol as `unavailable` (`reason: "io"`), and the racer failed with `EPERM: operation not permitted, open '…\logs\manager.lock'`.

There was a second defect on the same path. `link()` failing with EPERM counted as "this filesystem has no hard links" (`NO_LINK`). The lock was then written with the plain exclusive write, which is not atomic, although hard links work. A reader could see an empty or half-written lock, and it would then be reported as unparsable.

The Node 24 leg passing and Node 26 failing is consistent with timing. I did not prove that it comes from a libuv difference.

**Fix (`lib/start-lock.mjs`)**
- `BUSY = { EPERM, EBUSY, EACCES }`. Every path-based fs call of the protocol goes through `patient()`, which retries a busy code with backoff (2 → 50 ms) for at most `busyMs` (default 2 s) and then throws the last error. That covers:
  - the open of the temp file;
  - the reads of the lock and of claims (`readStable`, the takeover re-check, release, the final holder read);
  - the deletes (the stale target, the temp files, release, sweep).
- After the budget runs out, the error behaves as before: `unavailable`/io, exit code 1, and the message names the code. So on POSIX, where these codes are permanent, the only change is a delay of at most 2 s before the same error (C2).
- `link()` busy: the plain write is used only when a probe link (temp → a fresh temp name) proves that this directory has no hard links. If links work, the busy link is contention at the target name and is retried. EEXIST is still "exists". A positive probe is cached.
- `releaseIfOwn` still never deletes a lock it could not read and verify as its own. `discard()` (temp files, sweep, release) leaves a file it cannot delete for a later sweep.

**Why each code is safe to retry**
- **EPERM.** On Windows this is the delete-pending or access-denied state of a name that another holder is releasing or a claimant is deleting. A retry either sees the name gone (ENOENT: released, so go on) or sees the new record (EEXIST: judge it). A retry never counts as success:
  - a read retry returns only real bytes;
  - a link retry succeeds only when the exclusive link itself succeeds.
- **EBUSY.** A sharing violation (another open handle, an antivirus scanner). The same retry rules apply.
- **EACCES.** The same as EPERM on some Windows paths. On POSIX all three are permanent, and after the budget the error is reported unchanged.
- **The deletes.** A busy delete of the judged target is retried only while this contender holds the claim for exactly those bytes. While the claim is held, only this claimant can make those bytes leave the lock name, so the re-check still stands (the comment is at the call). Release and sweep never delete anything they could not verify.
- **The guarantees.** Never two holders: creation stays an exclusive `link()`. Never a deleted live lock: busy codes never lead to a judge or a delete. Never a partial lock: there is no non-atomic write while links work.

**Seam test, RED → GREEN** (`tests/start-lock-busy.test.mjs`, wired into `npm run test`)
- **The shim.** An fs shim wraps `openSync`, `linkSync`, `readFileSync`, `unlinkSync` and `writeFileSync` for the fixture's files only. `module.syncBuiltinESMExports()` makes the shim reach `lib/start-lock.mjs`'s named imports, so the same test runs unchanged on the old code.
- **How it injects.** A clean run records the call sequence. Then each recorded call is failed with each code: once, as a burst of 3, and for good.
- **Transient cases.** There are 3 scenarios: fresh; stale lock; stale lock with a dead claimant's claim plus a dead contender's temp file. Each must end acquired, with its own record on disk, the expected number of takeovers (0 or 1), no plain write, and nothing left after release.
- **A live holder's lock.** Each injection, once or for good, is never an acquisition and never changes the lock. A one-off injection must give `contended`.
- **A stale lock with an injection for good.** The result is never a partial lock, never a new record without the acquisition, and at most one takeover. Any `unavailable` names the code.
- **Release.** A lock that release cannot read, for good (a successor's record), is never deleted.
- **RED on 1a9b457's code** (`reports/t16-r4-red-busy.log`): 4 of 5 tests fail.
  - fresh: 30/30 injections broke. For example, `EPERM x1 at call 1 linkSync(…tmp, manager.lock): non-atomic write while hard links work: writeFileSync(manager.lock)`, and `EBUSY … unavailable`.
  - stale lock: 87/96.
  - claimed stale lock: 150/168.
  - live holder: 11 (`a transient gave unavailable`, temp files left).
  - The persistent stale test passed (a preservation test).
- **GREEN after the fix:** `t16-r4-green-busy2`, 6/6.
- **Mutation proof** (`/home/AgentKit/overhaul-tools/t16-scripts/r4-mutate.py`; each mutant restored with `git checkout <sha> -- lib/start-lock.mjs`, `git diff` empty after each; logs `t16-r4-mut-*`):
  - m1, a busy link falls back to the plain write: killed by 4 tests.
  - m2, the busy delete of the target is ignored: killed by 3 tests (more than one takeover).
  - m3, no retry: killed by 4 tests.
  - m4, release deletes a lock it cannot read: it survived on 9bb23ec. The release test in eed991d was added for it, and it then killed m4.
- **The windows race test is unchanged** (no weakening, no retry in the test). It is GREEN on Linux: `t16-r4-lock-suites`, start-lock-busy + start-lock + proxy-lifecycle, 65/65.

**Suites on the merged tree** (eed991d plus the uncommitted ADR line; Bun 1.4.2, Node 26.7.0)
- `npm run test` (`t16-r4-final-test`): 961 tests, 943 pass, 0 fail, 18 skipped.
- `npm run test:proxy` + `test:proxy-typecheck` (`t16-r4-final-proxy`): 1596 pass, 0 fail, 107 files; typecheck clean.
- `npm run test:mcp` (`t16-r4-final-mcp`): 100 tests, 99 pass, 0 fail, 1 skipped. `dist/` is unchanged.

**Linux S3 loop** (`job.mjs --os linux --only S3/short,S3/hung`, free loopback ports 41383/45209/42911; `/home/AgentKit/overhaul-tools/t16-memloop/r4-final-1..3`; logs `t16-r4-final-mem1–3`)

| run | S3/short failed-launches / stale / exactly-one | S3/hung failed-launches / stale / exactly-one | kill-holder rounds (killedByAdversary, failedLaunches; kill at) | ratchet |
|---|---|---|---|---|
| r4-1 | 0 / 0 / 0 | 0 / 0 / 0 | 1, 0 (302 ms) and 1, 0 (237 ms) | holds |
| r4-2 | 0 / 0 / 0 | 0 / 0 / 0 | 1, 0 (251 ms) and 1, 0 (307 ms) | holds |
| r4-3 | 0 / 0 / 0 | 0 / 0 / 0 | 1, 0 (142 ms) and 1, 0 (190 ms) | holds |

- `start-over-stale-lock` and `orphans` are 0 in all 6 keys. There was no HARNESS FAILURE.
- REDs are 37's only: `peak:kit`, `procPeak:launcher`, plus `procPeak:proxy` 62.1 MB (budget 62) once, in r4-1 S3/short.
- `expected-red.json` is unchanged. 16's kept names (`exactly-one-proxy-after-round`, plus `start-over-stale-lock` in S3/hung) stay until 10 GREEN runs per leg, as decided in round 1.

**Pending CI (orchestrator verifies after merge+push)**
- windows-latest test-kit, Node 24 and 26: `tests/start-lock.test.mjs`, the takeover race above all, and `tests/start-lock-busy.test.mjs` green.
- The round 3 windows items stay pending as written: the round 2 seam proofs, the windows memory leg (round 27 condition 4), and 77's guard on stops.

**Decisions taken**
1. **An exhausted busy budget stays `unavailable`/io, as before; it is not turned into `contended`.** Turning it into `contended` would turn a permanent POSIX EACCES on the lock into a 45 s contention wait and exit code 4 instead of exit code 1 (C2). 2 s covers a delete-pending window, which lasts only while the deleter's handle is open, since a failed open creates no handle.
2. **`busyMs` is an option of `createStartLock` (default 2000) for the seam test only.** It is not wired to config or env, so there is no new config key.
3. **ADR-0003 amendment, condition 1:** one sentence states the busy rule.

**Addendum (round 4): the tip moved during the runs.** The tip moved to 8d243c2, which reverts ticket 73 (2347fa2). It is merged as `056f799` with no conflicts. Outside `.scratch` that merge changes only `tests/memory/**`; `lib/`, `proxy/`, `cli/`, `zcode-proxy-src/`, `mcp/`, the start-lock tests and `package.json` are unchanged. The suites and the loop were rerun on 056f799, and these results replace the numbers above:
- `npm run test` (`t16-r4-final2-test`): 953 tests, 935 pass, 0 fail, 18 skipped. There are 8 fewer tests than before because 73's tests were reverted. All 6 start-lock-busy tests pass.
- `npm run test:proxy` + typecheck (`t16-r4-final2-proxy`): 1596 pass, 0 fail.
- `npm run test:mcp` (`t16-r4-final2-mcp`): 100 tests, 99 pass, 0 fail, 1 skipped.
- Linux S3 loop: `r4-final2-1..3`, logs `t16-r4-final2-mem1–3`, ports 33233/37787/34479.
  - In 3 of 3 runs, S3/short and S3/hung have `failed-launches`, `stale-lock-after-round`, `exactly-one-proxy-after-round`, `start-over-stale-lock` and `orphans` at 0.
  - The kill-holder rounds, as (killedByAdversary, failedLaunches; kill at):
    - run 1: 1, 0 (157 ms) and 1, 0 (146 ms);
    - run 2: 1, 0 (171 ms) and 1, 0 (217 ms);
    - run 3: 1, 0 (190 ms) and 1, 0 (248 ms).
  - The ratchet holds and there was no HARNESS FAILURE.
  - REDs are 37's only: `peak:kit`, `procPeak:launcher`, plus `procPeak:proxy` 62.4 MB (r4-final2-1 S3/short) and 62.1 MB (r4-final2-2 S3/hung), against a budget of 62.
