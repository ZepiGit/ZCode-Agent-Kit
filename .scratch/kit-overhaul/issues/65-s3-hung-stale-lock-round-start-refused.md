# 65: S3/hung's stale-lock round is skipped when `manager start` exits 1 (harness failure on both legs)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: sol
Risk: high
ADR: no

**What to build:** Since ticket 02 round 7 a skipped S3 round is a harness failure (tests/memory/lib/completeness.mjs). Three CI runs now fail on it, all with `S3/hung: harness failure: no evidence the scenario ran: round hung-10-with-stale-lock skipped: manager start exited 1; round hung-10-with-stale-lock never ran`:
- run 42395651721 (staging/32, ubuntu), run 42398295810 (staging/12, windows), run 42398299724 (staging/32 restaged, windows). None of those tickets touch the lock, manager or scenario code. Earlier green runs (tickets 08, 09, 10, 11) passed S3/hung on both legs.
Find out with evidence what `manager start` returns in that round and why: the kit's stale-lock refusal (the defect tickets 16/17 own: a killed start leaves a lock the next start will not take over), a race in the scenario (the round starts before the killed holder is gone or before the lock is judged stale), or something that changed on the integration branch since ticket 11 (tickets 08 CLI split, 59, 64 sampler). Then fix the cause in the right place:
- If it is the kit defect, the scenario must not report it as "did not run": a refused start in the stale-lock round is a measured outcome. Record it as a RED check owned by ticket 16 (or 17) with the start's exit code and stderr, keep the round's remaining evidence, and keep the gate strict for genuinely not-run rounds (ticket 02 round 7's adversarial fixtures must still be harness failures). If that changes what counts as evidence in the gate, it is a two-way-door decision recorded in the ticket Comments with the reasoning; if the expected-RED list would change, stop and report numbers instead.
- If it is a scenario race, make the round wait on observable state (holder gone, lock state read) instead of time.
- If a recent merge caused it, show the bisect and fix it there.

**Acceptance criteria:**

- [ ] Root cause shown with evidence (CI artefacts of the three runs: the round's notes, the start's exit code and stderr; local reproduction on Linux; bisect if relevant).
- [ ] S3/hung passes its evidence gate on Linux in 10 consecutive local runs and on both CI legs in the pre-merge run; adversarial not-run fixtures stay harness failures.
- [ ] Full suites green.

## Comments

### 2026-11-07 — implementer

Branch `ticket/65-s3-hung-stale-lock-round`, code head 1fd6131:
- f17e1f5: RED tests and the three CI summaries as fixtures.
- 3b2dacf: the fix.
- 1fd6131: the real-run replay.

The integration tip 608658d is already in the branch, so the merge was a no-op. Bun 1.4.2, ports 19650–19655. Logs are in `reports/t65-*.log`. Artefacts are in `/home/AgentKit/overhaul-tools/ci-art/<run>-t65*-<leg>/`, local runs in `/home/AgentKit/overhaul-tools/t65-memloop/<tag>/`, and scratch scripts and copies (not committed) in `/home/AgentKit/overhaul-tools/t65-scratch/`.

**Root cause: the kit's stale-lock refusal (ticket 16), reached through the kill-holder adversary's timing. It is not a regression, and not a race of the round.**
- The adversary SIGKILLs the start lock holder as soon as it sees it in `manager.lock`. Usually the holder has spawned its proxy by then, which keeps running, so the next `manager start` answers 0 (healthy).
- Sometimes the kill lands before the proxy is up:
  - Ubuntu run 42395651721 and windows run 42398295810: before the spawn. kill-holder-10 shows `proxiesAfter 0`, failed launches 10/10, and `afterKillHolder.nextPreflight 4` (green runs show 0).
  - Windows run 42398299724: inside the spawn. The "proxy" pid 8652 stays at 1 thread and 1.7 MB for the whole run (611 samples) and never serves the port.
    - libuv creates a `detached` child `CREATE_SUSPENDED` and resumes it only after `CreateProcessW` returns (https://github.com/nodejs/node/blob/main/deps/uv/src/win/process.c).
    - A holder killed in between leaves a process that never runs.
- With no healthy proxy, `start()` reaches `acquireStartLock()` and throws the AUD-001 refusal. `main()` turns it into exit 1 (`zcode-proxy-manager.mjs:490-494`, `:1274-1277`).
  - The pre-fix scenario recorded only the code, so the CI notes have no stderr.
  - The stop right before, in the same state, prints the same refusal in all three runs (`afterKillHolder.stopTail`): "stale or unreadable manager start lock … (holder pid 4089 is not alive …) — refusing automatic takeover".
- The holder was dead and the lock was judged stale, so this is not "the round started before the holder was gone".

**Bisect: not needed. The failure predates every merge since ticket 11.**
- I surveyed 39 S3/hung legs from run 42326112543 (the ticket 02 re-merge) to 42398299724 (`t65-scratch/survey.py`).
- 35 ran the stale-lock round with a target `via: pid-record`. 4 skipped it with `manager start exited 1`, all with the signature above.
- One of the 4 is integration run 42378479007 (windows, ff51a49, ticket 10's merge). That commit lacks the merges of 59, 11, 08 and 64. It shows the same suspended orphan (pid 3668: 1 thread, 1.7 MB, 617 samples).
- 42395651721 (e4e7d19) lacks 64 as well. The rate is 4 in 39 legs, on both OSes, before and after 08/59/64.

**Local reproduction (Linux, short profile):**
- Integration tip, natural timing: `t65-base1..4`, 4/4 ran all three rounds and the ratchet holds.
- Integration tip with a 3 s sleep between `acquireStartLock()` and the spawn (`t65-scratch/kit-delay`, scratch copy only; the scenario there also noted the start's output): `t65-delay1/2` are 2/2 HARNESS FAILURE, exactly the CI shape. kill-holder-10 shows 0 proxies and 10/10; the round is "skipped: manager start exited 1".
  - The stderr: `manager error: stale or unreadable manager start lock at …/state/logs/manager.lock (holder pid 2133934 is not alive, started …) — refusing automatic takeover. If no start is actually running, remove … manually and retry.`
- The fixed adversary also records `afterMs`, `proxiesAtKill` and `pidRecordAfterKill`. In `t65-nat4` and `t65-nat6` the scan that found the holder saw 0 proxies, yet `proxy.pid` existed right after the kill: on Linux the margin is milliseconds.

**Fix** (`tests/memory/scenarios/s3-concurrency.mjs`, `lib/completeness.mjs`, `lib/freeze.mjs` exports `isAlive`). The kit is unchanged (B1/B4/C6).
- `hung-10-with-stale-lock` now runs with `{ staleLock: true }`. A failed `manager start` there becomes the round's measured outcome (`refusedOverStaleLock`) only on observable state:
  - `manager.lock` exists;
  - its holder pid is not alive;
  - the start's output names that lock file;
  - no proxy of this run serves the port.
- In that case the note `hung-10-with-stale-lock.startRefused` records the exit code, the stderr (last 3 lines), the lock (path, holder pid, alive false), the run's proxies and how many serve the port.
- The round's 10 launches then run unfrozen against the state the killed start left, and its `notes.rounds` entry carries `startRefused`.
- The new check `start-over-stale-lock` (budget 0; detail: the round, the exit code, the stderr's first line) turns RED.
- Anything else stays a `.skipped` round, now with the start's stderr: a refusal in `hung-10`, no lock, a live holder (the scenario's own race, never charged to the kit), a failure that does not name the lock, or a proxy on the port.

**Gate decision (two-way door; the expected-RED list is unchanged).** `completeness.mjs` `STALE_LOCK_ROUNDS = { "S3/hung": ["hung-10-with-stale-lock"] }`. A round entry with `startRefused` counts as run only when all of these hold:
- it is a listed stale-lock round;
- it has a non-zero integer exit code, non-empty stderr, and a lock whose holder pid is an integer and not alive;
- all of its n launches ran;
- the summary's `start-over-stale-lock` check is RED.

Each missing condition is a harness failure with its own message. Everything ticket 02 round 7 made a harness failure still is one: `.skipped` notes and missing rounds are untouched.

Reasoning:
- The killed start's stale lock is exactly what the round tests, and while ticket 16 is open the kit refuses it. That refusal is a measurement of the defect, the same one kill-holder-10 shows as 10/10 failed launches.
- Making the adversary wait until a proxy is up would have hidden the pre-spawn kill, a harness closed before its proxy started, which users hit. On Windows it would also race the holder's own lock release.
- S3/hung stays listed under ticket 16 on both legs. Ticket 16's deletion of the entry now also needs `start-over-stale-lock` green, which proven takeover delivers: the start takes the stale lock over, and the round freezes the new proxy again.

**RED → GREEN:**
- `t65-red1`: 4 failing on the tip's scenario and gate (the refused-start round, the Windows orphan case, the check, the gate rules).
- GREEN: `t65-green1` (loop + verdict 132 pass, 0 fail, 5 skipped) and `t65-green3` (with the replay: 133 pass, 0 fail, 5 skipped).

**Adversarial, from the gate's purpose:**
- The three CI summaries (`fixtures/ci-4239*-s3-hung-summary.json`) replayed through the job stay HARNESS FAILURE ("round hung-10-with-stale-lock skipped: manager start exited 1; round hung-10-with-stale-lock never ran"). So does the round 7 fixture `ci-42281731448`.
- A real fixed run in the CI state (`fixtures/local-20261107-s3-hung-refused-linux-summary.json`, from `t65-fixdelay1`) is ticket 16's listed RED with `start-over-stale-lock`. With the stale-lock round removed, or with the check not RED, it is a harness failure.
- Seven not-a-measured-outcome states each stay a skip (the list above, plus a lock with no holder pid and no stderr).
- The gate refuses a refusal with exit 0, an empty stderr, a live holder, no lock, no launches, no RED check, one in `hung-10`, and one in S3/short's kill-holder-10.

**Mutants** (on 3b2dacf, each restored with `git checkout 3b2dacf -- <file>`, `git diff` empty after each; logs `t65-mut-A..J`). All 10 were killed:
- A: holder-alive check removed.
- B: lock-path-in-stderr check removed.
- C: serving check removed.
- D: `staleLock` gating removed.
- E: stale-lock-round check removed.
- F: launches check removed.
- G: RED-check requirement removed.
- H: the refused-start validation removed entirely.
- I: the `.skipped` gate removed. This one fails 5 tests, including all four CI-fixture replays.
- J: the lock-evidence check removed.

**S3/hung on the fixed head (Linux, short profile):**

| runs | timing | result |
|---|---|---|
| `t65-nat1..10` (10 consecutive; nat5–10 under 8 busy loops on 8 cores) | natural | 10/10 pass the gate, RED as listed (ticket 16), the ratchet holds. 192–195 s, 591–611 samples; every stale-lock target `via: pid-record`; `start-over-stale-lock` 0 |
| `t65-fixdelay1/2` (3 s widened window) | CI state | 2/2 pass the gate, RED as listed (ticket 16) with `start-over-stale-lock` 1, the ratchet holds. 197/198 s, 628/637 samples, every role seen |

There are no budget or memory-number changes:
- `peak:kit` is 863.7–873.8 MB on the natural runs, one outlier at 921.5 (nat8, under CPU load), and 869.3/869.3 on the widened runs. The tip runs `t65-base1..4` were 868.6–870.9.
- `procPeak:proxy` is 61.5–62.8 MB everywhere.

**Full suites (head 1fd6131 = merged tip):**
- `npm run test`: 756 tests, 737 pass, 0 fail, 19 skipped (`t65-kit`).
- `npm run test:proxy`: 1343 pass, 0 fail, 90 files (`t65-proxy`).
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped; `git status` clean after the build (`t65-mcp`).

**Pending CI (orchestrator verifies after merge+push):** S3/hung passes the evidence gate on ubuntu and windows, and is the listed RED of ticket 16.
- If the adversary hits the window, the run has `hung-10-with-stale-lock.startRefused` with exit 1 and the refusal naming the leg's own lock path. The CI windows paths already match: the scenario's `join(stateDir, "logs", "manager.lock")` equals the path in 42398295810's stop text.
- `start-over-stale-lock` is then RED.
- Otherwise it has a `.target` as before.
- A `.skipped` stale-lock round now carries the start's stderr.

**Left for tickets 16/17 (kit lifecycle; not changed here):**
- (1) The stale-lock refusal itself is now a named check.
- (2) On Windows, a holder killed inside `spawn()` leaves a suspended, never-running proxy process. It is not on the port and has no pid record. It stays for the rest of the run and survives the final stop (42398299724: `finalStop.proxiesLeft 1`, `pidRecordLeft null`; hung-10 then shows 2 proxies at once, a fact the run already reports). Adoption cannot apply to it because it never answers. Only a proof tied to the spawn (ticket 16's record at spawn) can reap it.
