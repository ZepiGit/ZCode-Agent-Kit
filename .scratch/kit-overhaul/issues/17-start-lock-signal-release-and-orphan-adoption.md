# 17: Start-lock release on signals, orphan adoption, respawn over a proven-stale lock

**Blocked by:** 16 (Start lock protocol v1 with proven takeover (no judge-then-rename race))

**Status:** resolved

Model: sol

Risk: high

ADR: 0003

**What to build:** A holder releases its own lock on SIGINT, SIGTERM, SIGHUP, and on Windows SIGBREAK and console close, only while the on-disk record is still its own. The next start adopts an orphaned proxy through the identity proof and never spawns a second one. Respawn treats a proven-stale lock as takeable, so the proxy is up after a respawn that met a stale lock. Every child is reaped on stop/restart/crash/update.

**Acceptance criteria:**

- [ ] Seam 2 tests per signal (POSIX) and SIGBREAK/console-close paths (windows-latest); orphan adoption → exactly 1 proxy.
- [ ] Seam 2, ubuntu and windows-latest (Round 22 Q1): a start whose lock holder is killed after `spawn()` and before the pid record is written (kill injected deterministically at that point, not by timing) leaves a healthy proxy with no `proxy.pid`; the next start adopts it through the identity proof (never on a port or pid alone) or `stop` reaps it; the test ends with exactly 1 proxy, 0 orphans and no second proxy spawned.
- [ ] Loop S4, both legs: exactly 1 proxy at every sample (`count:proxy` ≤ 1), including after a Ctrl-C during start that leaves a proxy without a start-time record (windows run 42425476318, Round 16 Q1). On windows, `count:proxy` is one of 17's names in `S4/short`.
- [ ] Loop S4: 0 stale locks after Ctrl-C during start (baseline 5/8) on linux; respawn with a stale lock → proxy up; 50 cycles → 0 orphans, log-dir files ≤ 8. **Delete `S4/short` (linux).** Windows: remove 17's names from `S4/short` with Round 15 Q1 condition 5's evidence, except `stale-lock-after-ctrl-c`, whose windows trial is a TerminateProcess (crash) and moves to ticket 81 (Owner Proxy round 33). 17's windows obligation for a real interrupt is the windows-latest seam tests (SIGINT, SIGBREAK, SIGHUP release, exit 0xC000013A) and OA-3 (unverified).
- [ ] Loop S3 (windows): 0 orphans (`orphans`) after the scenario's stop in `S3/short` and `S3/hung`; **remove 17's names (`orphans`) from the windows `S3/short` and `S3/hung` entries in `expected-red.json`, with the evidence Round 15 Q1 condition 5 requires.**
- [ ] Loop S3 (linux, Round 22 Q1): 0 orphans (`orphans`) after the scenario's stop in `S3/short` and `S3/hung`, including after a kill-holder round whose holder died between spawning the proxy and writing `proxy.pid` (run 42457112513: orphan pid 4080, role proxy, final stop "proxy healthy but no pid file"). **Remove 17's name (`orphans`) from the linux `S3/short` entry in `expected-red.json`** only with both the seam proof below (RED first on today's code) and Round 15 Q1 condition 5's evidence for a `flips` name (≥ 10 GREEN matching linux CI runs on 17's tree).
- [ ] A2 (real PowerShell/conhost Ctrl-C) listed as an owner action, marked unverified.
- [ ] Adversarial: a holder whose lock was taken over (the on-disk record is no longer its own) leaves the new holder's lock untouched on SIGINT and SIGTERM.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 44, 45, 60

## Comments

- 2026-11-06 (orchestrator, from ticket 02 round 4 Windows evidence): a start killed between spawning the proxy and recording its start time leaves `proxy.pid` without a start time (manager writes the record first and fills `startedMs` from a later query: `zcode-proxy-manager.mjs:632/:639`; on Windows that query is PowerShell, up to 2 x 2.5 s). Every later stop then fails closed on `start-unknown` and the proxy can never be stopped by the kit (S3/hung windows: orphan pid 3796, all stops refused). The lock/lifecycle fix must close this window (e.g. record identity atomically before/at spawn, or adopt a healthy proxy that answers with this installation's key) and the windows memory leg must show 0 orphans in S3.

- 2026-11-06 (orchestrator, Round 7 Q4): ticket 17 adopts pid records that older kits already left without a start time (no kill on a pid alone); ticket 37 is now blocked by 17 so the Windows S3/short entry can clear.

- 2026-11-06 (orchestrator, from ticket 02 round 7 Linux evidence): orphan adoption must also cover a healthy proxy on the installation's port with no `proxy.pid` at all (start killed between spawn and the record write; see ticket 16 Comments of the same date). Adoption needs the same proof strength as Round 7 Q4 condition 3: never on a port or pid alone.

- 2026-11-07 (orchestrator, from ticket 65): Windows suspended-proxy orphan (see ticket 16 Comments of the same date) is a legacy/orphan state this ticket's adoption or stop must handle: a process with the proxy's command line that was never resumed, no pid record, not serving the port.

- 2026-11-08 (orchestrator, Owner Proxy round 15): Q1 conditions 3 and 7 — added the Loop S3 (windows) criterion "0 orphans after the scenario's stop in `S3/short` and `S3/hung`; remove 17's names". The windows S3 `orphans` check had two claimants (16 via Round 7 Q4 condition 1, 17 via What-to-build "Every child is reaped …"); 17 descends from 16, so 17 owns it (Q1 condition 2), which also avoids holding 16 on a reap only 17 delivers. "Delete `S4/short`" stays. The 2026-11-06 "0 orphans in S3" line above is a measured finding, not the source of this criterion (Q1 condition 6).

- 2026-11-08 (orchestrator, Owner Proxy round 16 Q1): new acceptance line for `count:proxy` in S4/short; windows `count:proxy` is owned by 17 and marked flips (1/26) in expected-red.json (ticket 67).

- 2026-11-08 (orchestrator, Owner Proxy round 22 Q1): linux S3/short `orphans` is owned by 17 and marked flips in expected-red.json (1 of 21 matching linux CI runs on the 13 tree onward, 42457112513; 4 of 81 linux runs on record, each with exactly-one-proxy-after-round RED). Mechanism: kill-holder holder 4001 killed at 229 ms after logging "starting zcode-proxy ..." and spawning proxy 4080, before writing proxy.pid (pidRecordAfterKill null, pidFileMatchesListener false); the round stop was refused on the stale lock (exit 4), the final stop with "proxy healthy but no pid file" (exit 4). Linux S3/hung `orphans` is not listed (0 of 29); a RED there comes back. Attribution watch (Round 22 Q1 condition 4): for every linux S3/short orphans RED before 17 merges, record run id, orphans[] (pid, role, cmd), the kill-holder round's pidFileMatchesListener and pidRecordAfterKill, and cleanup.finalStop.tail; a value > 1, a non-proxy role or a matching pid record comes back as an ownership question. First record: 42457112513 as above.

### 2026-11-09 — implementer (ticket 17)

**Branch:** `ticket/17-signal-release-orphan-adoption` (worktree `/home/AgentKit/wt/t17`), from `overhaul/stability-terminal-ux` 984b45d. The head is the commit that adds this report.

Commits:
- `2a4006a` signal release;
- `e037fde`, `ca65a2b` adoption of a proxy that has no pid record;
- `e39c0b0` ADR-0003 note and the lifecycle safety-rule comments;
- `7e15e1e` `expected-red.json`;
- `759d63d` merge of the tip with ticket 18;
- `72ed852` stop-token assertions;
- `9833b66`, `faec868` replacing a record whose process is gone;
- `2273955` OA-3;
- `64a6ea3` a test timeout;
- `fdf1672` merge of the tip with ticket 73.

Both merges had no conflicts.

**What landed**
- **Signal release (`lib/start-lock.mjs`).**
  - While a process holds a start lock, it listens for SIGINT, SIGTERM and SIGHUP. On Windows it listens for SIGINT, SIGBREAK and SIGHUP, which are the console control events Node delivers for Ctrl-C, Ctrl-Break and console close.
  - **When no other listener handles the signal:** the process would have died from it. So it releases every lock it holds through `releaseIfOwn` (only while the on-disk nonce is still its own), then dies the way the signal would have killed it:
    - POSIX: the listener is removed and the signal is re-raised, so the process ends by that signal (exit status unchanged);
    - Windows: `process.exit(STATUS_CONTROL_C_EXIT)`, the default console handler's code.
  - **When another listener exists** (a host with its own Ctrl-C handling): the process keeps running and keeps its lock. An `exit` hook releases the lock when that process exits.
  - The listeners exist only while a lock is held.
  - One event line per release: `INFO manager start lock released on signal signal=… pid=… path=…`.
  - Acquire and every pid-record write are synchronous, so a handler never meets a half-taken lock or a missing record.
- **Adoption of a proxy that has no pid record (`lib/proxy-lifecycle.mjs`, `adoptUnrecorded`, `voidRecord`).**
  - **When it runs:** under the start lock, when `completeRecord` finds no `proxy.pid`. It also runs when the record names a process that is proven gone (dead pid, or a pid whose start time differs) while another pid answers.
  - **The proof:**
    - the authenticated `/health` names P;
    - P's start time is read;
    - P's command line is this installation's kit proxy (`… <kit>/zcode-proxy-src/src/index.ts serve`);
    - the answer is asked again and still names P;
    - P's start time read again is the same.
  - **What it never does:** adopt on a port or a pid alone. It signals nothing. An unreadable `proxy.pid` is left alone, and so is a record whose live pid has no start time (that one goes through 16's completion path).
  - **What it writes:** the record through 18's `writePidFile`, so no stop token is invented. One event line: `INFO manager orphaned proxy adopted pid=…[ replaced=…]`.
  - **Where it runs:** the next start reaches it through `tidyWhileServing`, which runs when the killed holder's lock is still there. `stop` always reaches it. For a complete record, the check runs only when another pid answers than the recorded one, so a normal stop costs no extra start-time query.
- **No new config keys, no env overrides, no new stdout lines** (ux-before is byte-identical).

**Tests** (all in `tests/start-lock.test.mjs`, seam 2, already wired; new fixture `tests/fixtures/start-lock-holder.mjs`; `tests/fixtures/start-contender.mjs` gains `dropRecordAt`, additive):
- per signal on POSIX, a real `kill`: SIGINT, SIGTERM and SIGHUP each release the lock, end the holder by that signal, and log one event line;
- as Node delivers a console control event (`process.emit`): SIGINT on both legs; SIGBREAK and SIGHUP (console close) on windows-latest, which expect exit code 0xC000013A;
- adversarial: when the lock was taken over (the on-disk record is a successor's), SIGINT and SIGTERM leave it byte-identical (Windows: SIGINT only, since Windows delivers no SIGTERM);
- a holder that handles SIGINT itself keeps running and keeps its lock; its own `process.exit` releases it;
- Ctrl-C of the real manager CLI `start` during its health wait (POSIX): no stale lock; the next `start` adopts the proxy (no second spawn, the stop token kept); `stop` gives `stopped (pid N)`; 0 orphans;
- Round 22 Q1, both legs:
  - this kit's start killed right after `spawn()` leaves its spawn intent;
  - a start killed after `spawn()` before any record, with the intent dropped by injection at `spawn:intent-recorded` and SIGKILL at `spawn:spawned` (not timing), leaves a healthy proxy with no `proxy.pid`. The next `start` adopts it by proof: 1 proxy, no second spawn, a verified record without an invented token, one event line. `stop` stops it: 0 orphans;
  - `stop` alone reaps the same orphan;
- adversarial for that adoption: nothing is adopted or signalled, and no record is written, for:
  - a non-kit process;
  - the proxy's TUI;
  - another installation's proxy;
  - a start time that changes;
  - an unknown start time;
  - a second answer that names another pid;
  - an unreadable `proxy.pid` (left byte-identical);
- a gone record (dead pid, or a reused pid) beside the orphan: `stop` adopts and stops the orphan, and the process at the recorded pid is never signalled;
- a record with no start time, or a live record whose start time matches, is never replaced.

**RED → GREEN** (logs in `reports/`)
- Signals on the tip's code: `t17-red3-signals-tip` and `t17-red2-signals`, 5 fail:
  - "no stale lock after the signal" ×3;
  - "no stale lock after Ctrl-C during start";
  - "released by its own exit";
  - the emitted SIGINT hangs, because nothing listens.
  - The adversarial test passed: today nothing ever deletes the lock. It is proven by mutation s1 below.
  - GREEN: `t17-green3-signals`, 7 pass and 2 skipped (windows-only).
- Round 22 seam on the tip's code: `t17-red4-adopt`, 3 fail. The record is `null` after start, and `stop` exits 4 with "ERROR: proxy healthy but no pid file — refusing to guess", which is the CI signature of 42457112513 and 42542508787. GREEN: `t17-green4-adopt` and `t17-green5-adopt`.
- Gone record: `t17-red5-gone` fails on "pid 2147483646 from the pid file is gone but something still answers"; GREEN: `t17-green6-gone` and `t17-green7-gone`.

**Mutations** (implementation committed first; each mutant restored with `git checkout <sha> -- <file>`, `git diff` empty after each; script `/home/AgentKit/overhaul-tools/t17-scripts/mutate.py`; logs `reports/t17-mut-*`). Killed:
- s1: the signal release ignores the nonce;
- s2: release despite another listener;
- s3: no exit hook;
- s4: no re-raise;
- s5: no SIGHUP;
- a1: no command-line check;
- a2: no second start read;
- a3: no second answer;
- a4c: both record guards removed;
- a5: no adoption;
- v1: an alive record counts as void. It survived until the "still there" test was added in `faec868`, which then killed it;
- v2: no replacement.

Equivalent: a4 and a4b. Each removes one of two guards against overwriting an unreadable record, and the other guard alone holds.

**"Prove it either way": the spawn → record window on the merged tip** (scratch copies only, never committed; `/home/AgentKit/overhaul-tools/t17-scripts/scratch-window.py`). The scratch adds a 1.5 s synchronous sleep right after `spawn()`, as the RUNLOG reproduction of 42542508787 did. Linux, S3/short and S3/hung, `/home/AgentKit/overhaul-tools/t17-memloop/scr*`:
- **A, tip 984b45d + sleep, with 16's intent:** `orphans` 0 and `exactly-one-proxy-after-round` 0 in both keys. `pidRecordAfterKill` is the intent `{pid:null, spawning:{by:<killed holder>}}`, and the final stop says "not running". 16's intent closes the window.
- **B, tip + sleep, intent removed** (a kit before 16): `orphans` RED in both keys, role proxy. In S3/hung `pidRecordAfterKill` is null and the final stop says "proxy healthy but no pid file". In S3/short the final stop says "pid … from the pid file is gone but something still answers". This is the power check: the scratch reproduces the CI event.
- **C, this branch + sleep, intent removed:**
  - first on `ca65a2b`: S3/hung GREEN; S3/short `orphans` 1 (the gone-record form), which led to `9833b66`;
  - then on `faec868` (`scrC2-1`, `scrC2-2`): `orphans` 0 and final stop "not running" in all 4 keys.
  - Without an intent, a waiter that runs while the orphan is still coming up can still spawn a short-lived second proxy (16's `simultaneous-proxies`/`count:proxy`/`exactly-one-proxy-after-round` RED in 3 of 4 keys). Only the intent can prevent that, and with this kit's own starts it is always there (A).

**Memory loop** (linux, short profile, `--only S3/short,S3/hung,S4/short`, free loopback ports; `/home/AgentKit/overhaul-tools/t17-memloop/`; logs `t17-mem-*`):

| run (tree) | S4 stale-lock-after-ctrl-c | S4 unstoppable / respawn-recovers / count:proxy / orphans / log-dir files | S3/short + S3/hung orphans, 16's names | ratchet |
|---|---|---|---|---|
| tip-1, tip-2 (984b45d) | RED 5/8, 5/8 | 0 / up / 1 / 0 / 1 | 0, all GREEN | holds (old list); FAIL with the new list (stale lock unowned, the guard) |
| br-1..3 (ca65a2b) | 0/8 ×3 | 0 / up / 1 / 0 / 1 | 0, all GREEN | holds (old list and new list) |
| br2-1..3 (faec868, with 18) | 0/8 ×3 | 0 / up / 1 / 0 / 1 | 0, all GREEN | holds |
| br3-1..3 (fdf1672, with 73) | 0/8 ×3 | 0 / up / 1 / 0 / 1 | 0, all GREEN | holds |

- The S3 kill-holder rounds landed at 123–286 ms, and the Round 27 gate never fired. The REDs were 37's only: `peak:kit`, `procPeak:launcher`, and `procPeak:proxy` at 62.1–62.7 MB.
- S4 Ctrl-C trials on the branch: in 8/8 the proxy survived detached with a complete record, the next start exited 0 and the next stop exited 0, and 0 proxies were left. The footprint is unchanged.
- `br-1..3` on `e037fde` (`invalid-nomcp-br-*`) are void runs. That snapshot had no `mcp/zcode-harness-mcp/node_modules`, so the fake harness's bridge never started (exit 13, unsettled top-level await). They were rerun after `npm ci`. This was not a kit change.

**Round 22 Q1 attribution watch** (the orchestrator asked for it to be collected; `/home/AgentKit/overhaul-tools/t17-scripts/orphans.mjs` over `ci-art/`, `merge-*-ci/`, `merge-*-memloop/`, `t16-memloop/`; output `/home/AgentKit/overhaul-tools/t17-memloop/archived-orphans.jsonl`):
- There are 148 orphan records (some runs are archived twice), and every one is role `proxy`.
- **Linux:** 6 records, all role proxy, `pidFileMatchesListener` false, `pidRecordAfterKill` null or absent, and final stop "proxy healthy but no pid file". That is the spawn → record window:
  - 42246379763 S3/short, pid 3588;
  - 42281646419 S3/short, pid 3573;
  - 42281731448 S3/hung, pid 3723;
  - 42457112513 S3/short, pid 4080 (kill at 229 ms);
  - 42542508787 (staging/73b, without 16) S3/hung, pid 4224 (kill at 135 ms).
  - None is > 1, none has a non-proxy role, and none has a matching pid record.
- **Windows:** 142 records, all role proxy:
  - 133 are a record without a start time ("start time of pid N is not determinable"), which 16's completion proof now closes;
  - 8 are "not running" finals, which are the never-started proxy (for example 5728 in 16's round 1 run) that 16's round 2 resume closes;
  - 1 is "proxy healthy but no pid file".
- **On 16's tree:** 0 orphans in my 11 local runs (22 S3 keys, plus scratch A) and in the windows legs archived from 16's CI runs (42546127654 and the 2026-11-08 20:59 run in `merge-16-ci/`).
- My own runs had no S3 orphans RED, so there is nothing new to attribute.

**expected-red.json** (Round 15 Q1 condition 5)
- **Removed, linux `S4/short`:**
  - `stale-lock-after-ctrl-c`: RED 5/8 in every tip run, 0/8 in 9 of 9 branch runs;
  - `respawn-recovers-despite-stale-lock`: GREEN in every run since 16.
- **Removed, windows `S4/short`:** `unstoppable-proxy-after-ctrl-c` and `respawn-recovers-despite-stale-lock`. Both were RED in 24/24 and 10/10 runs before 16, and GREEN in the windows legs of 42546127654 and 16's earlier run, where S4 was RED only on `stale-lock-after-ctrl-c`.
- Pending CI: the pre-merge run must show these GREEN on both legs (orchestrator verifies). A later RED fails as unowned. The replay of 42546127654's windows `job-summary.json` through the new list holds.
- **Kept as `flips`, pending ≥ 10 GREEN matching CI runs per leg on 17's tree:**
  - linux S3/short `orphans`. Round 22 Q1's seam proof is done, RED first.
  - linux S4/short `unstoppable-proxy-after-ctrl-c`;
  - windows S3/short and S3/hung `orphans`;
  - windows S4/short `proxy-left-after-stop`, `failed-lifecycle-steps` and `count:proxy`.

**Not met: windows S4 `stale-lock-after-ctrl-c` (kept listed; a measurement question)**
- On Windows, S4's "Ctrl-C" trial is `child.kill("SIGINT")`. Node maps that to `TerminateProcess` (libuv `uv_kill`), which runs no handler, so it measures a crash, not a Ctrl-C.
- Windows has no way to release a lock from inside a process that `TerminateProcess` ends. That holder's lock stays until the next start takes it over by proof (16), which every trial shows: next start 0, next stop 0.
- So "0 stale locks after Ctrl-C" cannot turn GREEN on windows under this scenario, and "Delete `S4/short` (windows)" cannot happen.
- Delivering a real console control event from the scenario (`GenerateConsoleCtrlEvent` on a shared console) is unverified on the hosted runner, so I did not change the measurement.
- **Question for the orchestrator/Owner Proxy:** should the windows trial deliver a console event, or should windows `stale-lock-after-ctrl-c` be judged against `TerminateProcess` as a crash? The real Ctrl-C path is covered by the windows-latest seam tests and by owner action OA-3 (A2).

**Decisions taken (spec and ADRs silent)**
1. **A process that handles the signal itself keeps its lock.** Releasing it would let a second start begin beside a start that is still running. Its exit releases the lock.
2. **The Windows exit code after a release is `STATUS_CONTROL_C_EXIT`, the code the process had before (C2).** It is not 130.
3. **Adoption without any record adds a command-line proof.** With no intent there is no spawn time to bound the listener, so the authenticated answer plus a stable start time could also name a user's own `bun … serve`. The TUI and other installations are excluded.
4. **A record whose process is gone counts as no record.** This came from scratch C. The check costs a start-time query only when another pid answers than the recorded one.
5. **The next start adopts only on the paths that already take the lock** (a stale lock, or an unfinished record); `stop` always adopts. Gating it this way keeps the preflight with a TUI-hosted proxy free of extra lock and PowerShell work.
6. **No `README.md` edit.** The README ×5 "never taken over" line belongs to ticket 52. SECURITY.md:26 belongs to ticket 53.

**Suites on the merged head `fdf1672`** (Bun 1.4.2, Node 26.7.0)
- `npm run test` (`t17-final2-test`): 1010 tests, 990 pass, 0 fail, 20 skipped. That is 18 skips before, plus 2 windows-only console-event tests.
- `npm run test:proxy` + `test:proxy-typecheck` (`t17-final2-proxy`): 1598 pass, 0 fail, 107 files. Typecheck clean.
- `npm run test:mcp` (`t17-final2-mcp`): 107 tests, 106 pass, 0 fail, 1 skipped. `dist/` unchanged, git clean.
- `npm run test:ux-before` (`t17-final2-uxbefore`): 1/1.
- Memory tests with the edited list (`t17-memtests1`, before the merges): 218 tests, 213 pass, 5 skipped.

**Pending CI (orchestrator verifies after merge+push)**
- **windows-latest test-kit, Node 24 and 26, `tests/start-lock.test.mjs`:**
  - the console-event tests: SIGINT, SIGBREAK and SIGHUP releasing with exit 0xC000013A;
  - the adversarial taken-over lock (SIGINT);
  - the own-listener test;
  - both Round 22 tests: killed after `spawn()` with no record, then start adopts and stop reaps, and `stop` alone reaps. Adoption uses CIM for the command line and PowerShell ticks there;
  - the gone-record test (ms record against ticked live start), and the adoption-proof adversarial test (timeout 180 s).
- **ubuntu test-kit:** the same file.
- **memory-budget, both legs:**
  - the ratchet holds with the edited list;
  - linux S4/short RED on no name;
  - windows S4/short RED only on `stale-lock-after-ctrl-c` (above);
  - `orphans` 0 in S3 on both legs;
  - `count:proxy` ≤ 1 in S4 on both legs.
- **Floors:** ≥ 10 GREEN matching CI runs per leg on 17's tree for the `flips` names above. Only then may a later commit of 17 remove them, and linux S3/short `orphans` needs nothing else, since its seam proof is done.
- **Owner action OA-3 (A2):** a real PowerShell/conhost/Windows Terminal Ctrl-C, Ctrl-Break and console close. Unverified.

**Left for other tickets**
- **52:** the README ×5 "never taken over" line.
- **53:** SECURITY.md:26.
- **Orchestrator/Owner Proxy:** the windows S4 Ctrl-C measurement question above.

### 2026-11-09 — implementer (ticket 17, round 2: windows test-kit teardown)
Branch `ticket/17-signal-release-orphan-adoption`. Fix `baaa34e`, merged with the integration tip `9b87c23` (docs only) as `5e88671`.

**Failure.** Pre-merge CI run 42585313129 (staging/17r 2492c11) was RED only on both windows test-kit legs, in one test: `tests/start-lock.test.mjs:1030`, "this kit's start killed right after spawn() leaves its spawn intent …". Its `t.after` failed with `EPERM, Permission denied … kit-start-lock-…` (syscall `rm`).

**Cause (test, not product).** The test SIGKILLs a start at `spawn:spawned` and ended about 200 ms later. The proxy that start spawned (`bun run <fixture>/zcode-proxy-src/src/index.ts serve`, cwd `zcode-proxy-src`, stdout/stderr on `logs/proxy.log`) was still booting. It had not yet written its `spawned/<pid>` marker, so `killFixtureProxies` found nothing to kill. Windows will not remove a directory that a live process runs in or holds a file of. Proof on linux: a scratch probe (not committed) listed the fixture's processes at the `rm`. On the old code it showed the proxy alive (`t17-red-probe`: `… bun run /tmp/kit-start-lock-3rkvs3/zcode-proxy-src/src/index.ts serve`); on the fix it showed `none` (`t17-green-probe`). The probe was restored from `baaa34e`. On linux the `rm` succeeded, and the proxy died once its directory was gone, so the leak went unnoticed. No kit stop ever runs in this test (the kill is the scenario; adoption from the intent is the `spawn:spawned` case of 16's loop). So the kit was never asked to stop that proxy: not a product bug.

**Fix (tests only).**
- The test waits until the killed start's proxy announces its pid, then asserts it is the one live fixture proxy.
- `stopFixtureProxies` replaces `killFixtureProxies` for every kit fixture in the file. It works per announced pid:
  1. it reads the identity (pid + start time, `tests/memory/lib/process-identity.mjs`);
  2. the command line must name this fixture;
  3. `killProcess` (`tests/memory/lib/freeze.mjs`) re-checks the start time, under a held handle on Windows. B4: a stranger at a reused pid is never signalled;
  4. it waits (30 s bound) until each is gone. A linux zombie counts as gone.
- Holder children and `harmless` children are now awaited through their own handles after the kill.
- The fixture `after` hook awaits every cleanup. If a cleanup fails, it throws and keeps the directory, so a leak fails the test instead of being hidden. Only then does it run `rmSync(…, { maxRetries: 8, retryDelay: 100 })`, the bounded retry for Windows' asynchronous delete.
- The other new tests of this ticket had the same pattern (holder kill without a wait; `killFixtureProxies` in the Round 22 tests) and are covered by the same helpers.
- The `start-lock-holder.mjs` header named a non-existent `start-lock-signals.test.mjs`; it is corrected to `start-lock.test.mjs`.

**Suites on `5e88671`** (Bun 1.4.2):
- `npm run test` (`t17r2-test`): 1010 tests, 990 pass, 0 fail, 20 skipped. No `kit-start-lock-` process survives the run.
- `tests/start-lock.test.mjs` alone (`t17-startlock`): 53 tests, 51 pass, 2 skipped.
- `npm run test:proxy` + typecheck (`t17r2-proxy`): 1598 pass, 0 fail, 107 files. Typecheck clean.
- `npm run test:mcp` (`t17r2-mcp`): 107 tests, 106 pass, 0 fail, 1 skipped. `dist/` unchanged.

**Pending CI (orchestrator verifies after merge+push):** windows-latest test-kit on Node 24 and 26, `tests/start-lock.test.mjs` GREEN, with the teardown `rm` no longer failing; the other criteria as listed in the round 1 report.

**Interim label (Owner Proxy round 33, condition 5; records only, the scenario is unchanged):** windows S4 `stale-lock-after-ctrl-c` = `child.kill("SIGINT")` = TerminateProcess (crash), not a console event; on 16's tree 6/8 stale in both archived runs, with next start 0, next stop 0 and 0 proxies in 8/8. Merge check status: "moves to N (Round 33); not clearable under a TerminateProcess trial". This answers the round 1 question above.

- 2026-11-09 (merger): Merged 2026-11-09 as 6edf13f; fast suite: kit 995/1015 (0 fail, 20 skipped), proxy 1627/1627 (109 files), mcp 115/116 (0 fail, 1 skipped). Plain `--no-ff` merge of ticket/17-signal-release-orphan-adoption (c26a995) into the tip f516b38, no conflicts (`tests/memory/expected-red.json` auto-merged); no earlier merge or revert of 17 on the integration branch, so no revert-of-revert. No lockfile changed (`npm ci` only); `mcp/zcode-harness-mcp/dist/` unchanged after `test:mcp`'s build (B5). Logs: `reports/merge-17-{npm-ci,test,test-proxy,test-mcp}.log`.
  - Pre-merge CI run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42600357562 (staging/17s, head 699cf36 = 9b87c23 + ticket/17 c26a995), green on all 8 jobs (earlier attempt 42585313129 was RED on windows test-kit, teardown EPERM, fixed in round 2). Merged under Owner Proxy round 33 with windows S4 `stale-lock-after-ctrl-c` still listed. Values checked by the merger in that run's memory-budget logs (`/home/AgentKit/overhaul-tools/merge-17-ci/{linux,windows}-memory-budget.log`):
    - Names 17 removed, all GREEN: linux S4/short `stale-lock-after-ctrl-c` 0 of 8, `respawn-recovers-despite-stale-lock` 1 proxy up; windows S4/short `unstoppable-proxy-after-ctrl-c` 0 of 8, `respawn-recovers-despite-stale-lock` 1 proxy up.
    - linux S4/short GREEN (still listed for 17 on the flipping `unstoppable-proxy-after-ctrl-c`, 0 of 8). windows S4/short RED only on the listed `stale-lock-after-ctrl-c` (6 of 8, owned by 17); proxy-left-after-stop 0, failed-lifecycle-steps 0, count:proxy 1, orphans 0: all ok.
    - S3 `orphans` (10-run floor of 17's flips names): linux S3/short 0, S3/hung 0; windows S3/short 0, S3/hung 0 (budget 0, all ok).
    - Ratchet holds on both legs ("memory-budget (linux|windows, short profile): ratchet holds").
  - Sanity diffs: the staged-ticket diff over 17's files differs from staging/17s only in `tests/memory/expected-red.json` (windows `S1/stalled` entry removed by ticket 61's 3820c9a, merged in eb8aaae); 17's own hunks are intact. The whole-tree diff (`git diff staging/17s HEAD -- . ':!.scratch'`) comes only from integration commits after staging/17s^1 (9b87c23): ticket 61 (merge eb8aaae; `.github/workflows/ci.yml`, `tests/memory/{expected-red.json,job.mjs,loop.test.mjs,fixtures/fake-run.mjs,lib/catalogue.mjs,lib/measure.mjs,scenarios/s1-proxy-steady.mjs}`, `zcode-proxy-src/src/proxy/{handler,response-body,sse-terminal}.ts`, `zcode-proxy-src/src/server/{server,response-backpressure.test,response-bytes-contract.test}.ts` and its two `__fixtures__` JSON files, `zcode-proxy-src/src/translator/sse-translator.ts`) and ticket 31 (merge 667f967; `mcp/zcode-harness-mcp/{package.json,docs/MCP_API.md}`, `src/mcp/tools.ts`, `src/tasks/{ingress,manager,response-text}.ts`, their `dist/` outputs, `test/fixture/{fake-harness,heap-probe}.mjs`, `test/integration/{security-audit,task-caps}.test.mjs`). Nothing else.
- 2026-11-09 (orchestrator, Owner Proxy round 33, binding): windows S4 `stale-lock-after-ctrl-c` is measured by `child.kill("SIGINT")`, which Node maps to TerminateProcess on Windows: a crash, not a console event. No kit change can clear it. On 16's tree: 6/8 stale in both archived windows runs, with next start 0, next stop 0 and 0 proxies in 8/8. 17 merged with the name listed (pre-merge 42600357562: windows S4 RED on this name only, 6/8). The name moved to ticket 81 (windows console-event trial) in 81's publishing commit. "Delete S4/short" is amended to linux only; on windows 17 removes its own other names under Round 15 Q1 condition 5.
