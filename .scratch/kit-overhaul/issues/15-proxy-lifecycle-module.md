# 15: Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets)

**Blocked by:** 08 (CLI command-module split, part 2 (migrate remaining commands + contract)), 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24), 14 (Event-line format and redaction for new log events (prefactor))

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0003, 0012

**What to build:** One deep module owns start, stop, restart, status, the start lock, takeover hooks, orphan adoption, respawn requests and the restart budget. Its interface is the lifecycle intents (ensure running, stop, restart, budgeted respawn request, read state); intents print nothing and return outcome records. Every caller uses it: CLI commands, preflight, `run`, the OMP extension through the preflight, update, setup, the account change (`restartForAccountChange`), `doctor --fix` and the respawn hook. The preflight path imports no presentation code. `createManager({ root, home, processStartMsImpl, … })` stays the injection seam. Frozen: manager CLI commands, exit codes 0–5 and output (incl. its own legacy `doctor`), OMP exit mapping 3 → foreign / 5 → key, the `ZCODE_KIT_RESPAWN_MANAGER` path, `respawn <pid> --reason <r>`.

**Acceptance criteria:**

- [ ] `manager-safety`, `manager-audit` and the golden-path script pass unchanged (seam 2).
- [ ] Module-graph test: the preflight entry's import closure contains no output/presentation module.
- [ ] S3 starter-preflight role peak ≤ 76 MB (loop), recorded vs baseline 55–73 MB.
- [ ] An old proxy (origin/main) calling the new manager's `respawn` CLI works (spawned test).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 61

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 15): the "S3 starter-preflight role peak ≤ 76 MB (loop)" criterion binds 15 on its own evidence, while ticket 37 holds the `procPeak:preflight` names in `expected-red.json` (Q1 condition 2, several claimants: 37 is the descendant). 15 removes no names; if 15 lands with the preflight peak still RED, it comes back with the numbers (Round 15 Shared understanding).

### 2026-11-08 — implementer (ticket 15)

**Branch:** `ticket/15-proxy-lifecycle-module` (worktree `/home/AgentKit/wt/t15`). Implementation `931a219`, tests `5b96951`, `584b734`, `9cac453`; integration tip `d170038` merged in (`374f4dd`). The head SHA is the commit that adds this comment.

**What landed**
- `lib/proxy-lifecycle.mjs`: `createLifecycle({ root, home, processStartMsImpl, processCommandLineImpl, bunResolver, managerPath, …timings })`. It owns start, stop, restart, the start lock, the pid record, the identity proof, the hung-own proof, the kill guard, the respawn request and the restart budget. The code is moved from the manager unchanged in behaviour. Intents: `ensureRunning({ waitMs, onlyIfRecord, observe })`, `stop({ observe })`, `restart({ waitMs, observe })`, `requestRespawn(pid, reason, { observe })`, `readState()`. Each intent returns an outcome record `{ intent, code, outcome, recovered, lines, error? }`; `restart` adds `.stop` and `.start`. The intents print nothing: every narration line goes to `proxy.log` (`[manager <ISO>] …`, unchanged) and to the caller's optional `observe(line)` at the moment it happens. `readState()` returns `{ identity, pidRecord, alive }`. The module imports no presentation code and never touches `console`/`process.stdout|stderr` (a test checks the source).
- `lib/heal-log.mjs`: `logHeal`/`appendHealLine` moved out of `cli/heal.mjs`, verbatim. `cli/heal.mjs` re-exports `logHeal`, so the lifecycle path needs no CLI module.
- `proxy/zcode-proxy-manager.mjs`: the manager CLI, the respawn target, and `createManager` as a renderer over the intents. Every member stays (`start/stop/restart/respawn` return the exit code and print the lines as they happen; `healthIdentify`, `readPidFile`, `verifyOwnProcess`, `proveHungOwn`, `pidAlive`, `processStartMs`, `killOwned`, `lastRecovery`, `logEvent`, paths). `readState` is added. Status, doctor, logs and the connection details remain the manager's own reports; `status` reads `readState()`.
- Callers: the preflight (`cli/heal.mjs`) calls `ensureRunning` and no longer imports the manager. `run` (`cli/launch.mjs`) and the OMP extension (`execFile` of `heal.mjs`) reach it through the preflight. The account change (`restartForAccountChange`) uses `readState` + `restart`/`ensureRunning` instead of re-deriving state from `healthIdentify`/`readPidFile`/`pidAlive`. `doctor --fix` takes its identity from `readState`. Setup's connection-details step reads `readState()` (the details card stays in the manager). `proxy *`, `status`, `logs`, `update` and the proxy's respawn hook still spawn the manager CLI, whose commands are these intents rendered.
- Seams left for 16/17: the lock protocol is one function, `acquireStartLock()` → `{ status: "acquired", release() } | { status: "contended", holder, message } | { status: "unavailable", message }`; release is per acquisition (nonce in the handle), which ticket 17's signal release can call. Spawn → pid record → start time is one function, `spawnProxy()`, which is the window the 2026-11-06/07 Comments of 16/17 describe. **For 70:** the stop path is `stopIn` → `stopLocked` → `stopVerified` → `killOwnedIn` in `lib/proxy-lifecycle.mjs`, and its success record is `{ outcome: "stopped", pid }`.

**Tests** (seam 2; `tests/proxy-lifecycle.test.mjs`, wired into `npm run test` after `manager-audit`; ports 19150–19158)
- The preflight entry's import closure (static imports plus literal dynamic `import()`s) contains `lib/proxy-lifecycle.mjs` and no output/presentation module: `lib/term/`, the proxy TUI, `cli/commands/`, `cli/connection-details.mjs`, `cli/setup-output.mjs`, `cli/harness-consent.mjs`, the manager CLI. A non-vacuity test runs alongside it.
- A spawned `node cli/heal.mjs` with a module-resolve hook loads the lifecycle module and no presentation module. Its stdout and stderr are byte-identical to today's.
- Intents print nothing and return records: ensure running for ours/foreign/no key; a stale lock gives outcome `start-lock-unavailable` and the lock stays untouched; stop, restart, the respawn request and read state.
- Frozen contracts (spawned, real Bun, a stand-in proxy that answers the identity proof):
  - An **old proxy (origin/main) calls the new manager's `respawn <pid> --reason memory`** through origin/main's own hook code. That code is `tests/fixtures/origin-main-9e45d05/watchdog.ts`, a verbatim copy that a test re-checks against `9e45d05` when the object is present. The old proxy exits, a fresh proxy comes up, `respawn.json` records the event, and the fresh proxy gets `ZCODE_KIT_RESPAWN_NODE`/`_MANAGER` pointing at the manager.
  - A proxy started through the preflight carries the same hook (the `managerPath` default), and `manager stop` prints `stopped (pid N)`.
  - The account change restarts a verified own proxy with the manager's lines. A dead record only warns and starts nothing; no test covered this before.
- The child_process import-coverage check (H2a) now also covers the lifecycle module, where the darwin `spawnSync` probe moved. The manager-safety copy still passes unchanged.
- `tests/release-marker.test.mjs`: a payload without `lib/proxy-lifecycle.mjs` or `lib/heal-log.mjs` fails closed. `pack/verify-payload.mjs` requires both files.

**RED → GREEN** (logs in the integration worktree's `reports/`)
- `t15-red-lifecycle`: the new file against the tip code. 7 fail, 3 pass; the 3 that pass are the contract/preservation tests, which pass on the tip by design. On the tip the closure reaches `proxy/zcode-proxy-manager.mjs`, `cli/connection-details.mjs`, `cli/harness-consent.mjs`, `lib/term/*` and `tui/tokens|width-core`, and the spawned preflight loads the manager, `connection-details` and `harness-consent`. After the change, `t15-green-lifecycle` gives 12/12, three runs in a row.
- `t15-tip-preservation`: the account-change, old-proxy-respawn and preflight-hook tests are green on the untouched tip code f906014 too (scratch detached worktree, since removed).
- Mutation proofs (implementation committed first; each mutant restored with `git checkout HEAD -- <file>`, empty `git diff` after each). All 13 were killed (`t15-mut-*`):
  - m1: hook env `ZCODE_KIT_RESPAWN_MANAGER` changed. 2 fail (old-proxy respawn, preflight hook).
  - m2: the default manager path changed. 1 fail (preflight hook).
  - m3: the CLI reads `--why` instead of `--reason`. 1 fail (old-proxy respawn).
  - m4: the preflight observer silenced. 2 fail (spawned preflight output, preflight hook).
  - m5: the kill guard skips the pid-record re-check. manager-audit "not signalled when the pid record is replaced" fails.
  - m6: stop ignores `start-unknown`. manager-safety "fail-closed when the live start time is undeterminable" fails.
  - m7: stop ignores a foreign listener. manager-safety "refuses to kill a foreign service" fails.
  - m8: the hung-own proof skips the command-line check. 2 manager-audit tests fail.
  - m9: the restart budget off by one. 2 manager-audit budget tests fail.
  - m10: the account change uses ensure running instead of restart. Fails.
  - m11: the account change ignores `alive`. Fails.
  - m12: the narration `not running` → `not running.`. `test:ux-before` fails (`proxy-stop-not-running`, `update-checkout`, `update-release`).
  - m13: the `doctor --fix` identity check inverted. `test:ux-before` fails (`doctor-fix-starts-proxy`, `doctor-fix-nothing-to-do`).
  - m5–m9 show that the B4/C6 no-kill-without-proof proofs still guard the moved code.

**Full suites after merging the integration tip `d170038`** (Bun 1.4.2, Node 26.7.0)
- `npm run test` (`t15-final-test`): 829 tests, 810 pass, 0 fail, 19 skipped. That is +13 tests: 12 in the new file and 1 in release-marker.
- `npm run test:proxy` (`t15-final-proxy`): 1384 pass, 0 fail, 92 files. Unchanged; no proxy source changed.
- `npm run test:proxy-typecheck` (`t15-final-typecheck`): clean.
- `npm run test:mcp` (`t15-final-mcp`): 97 tests, 96 pass, 0 fail, 1 skipped. `dist/` unchanged.
- `npm run test:ux-before` (`t15-final-uxbefore`): 1 test, 1 pass, 0 fail — every capture byte-identical in all seven variants (tty-color-80, tty-color-120, no-color, term-dumb, ascii-locale, pipe, ci).

**Memory loop** (Linux, short profile, `ZCODE_MEMLOOP_PORT=19158`; run dirs `/home/AgentKit/overhaul-tools/t15-memloop/`). Paired runs on the tip f906014 and on the branch, same machine:

| run | tip f906014 | branch | budget |
|---|---|---|---|
| S3/short `procPeak:preflight` | 72.9 MB | 71.4 MB; job run 74.2 MB | ≤ 76 GREEN |
| S3/hung `procPeak:preflight` | 74.8 MB | 74.9 MB; job run 74.1 MB | ≤ 76 GREEN |
| S3/short kit / launcher / bridge / proxy | 863 / 79.0 / 86.0 / 62.1 | 857.9 / 78.9 / 86.4 / 60.9 | 596 / 74 / 75 / 62 |
| S3/short failed launches, stale locks | 8, 1 | 4, 1 | 0, 0 (16 owns them) |
| S3/hung failed launches, stale locks | 11, 2 | 12, 2 (job: 11, 2) | 0, 0 (16) |
| S4/short stale lock after Ctrl-C, respawn over a stale lock | 5/8, 0 | 5/8, 0 | 0, 1 (17) |

- The criterion "S3 starter-preflight role peak ≤ 76 MB (loop)" holds in every run (71.4–74.9 MB, baseline 55–73). The tip is GREEN on it too; the delta is within run noise. A paired preflight-only micro-measure (`t15-preflight-rss`: `node cli/heal.mjs` against a closed port, max RSS, 7 runs each) gives a median of 63.7 MB on the tip and 63.4 MB on the branch (−0.3 MB). Not loading the manager and its two presentation modules saves little, because the role's peak is mostly the Node runtime plus what the preflight does while the start runs.
- Ratchet: `node tests/memory/job.mjs --os linux --only S3/short,S3/hung,S4/short` → **ratchet holds** (`t15-mem-job`). The RED checks are exactly the ones tickets 37/16/17 own. Lifecycle checks that are GREEN on both sides stay GREEN: orphans 0, exactly one proxy after every round, simultaneous proxies 1, `start-over-stale-lock` 0, S4 failed lifecycle steps 0, log-dir files 1.
- `expected-red.json`: nothing removed. 15 owns no entry; the `procPeak:preflight` names stay with 37 (Round 15).

**Decisions taken (spec/ADRs silent)**
1. **CLI commands keep spawning the manager CLI.** This covers `proxy start|stop|restart|status|logs`, `status`, `update`, the start in `doctor --fix`, and the respawn hook. The manager CLI is the frozen external contract and is now a renderer of the intents. Its stdio streams to the terminal byte for byte, including the connection details after a start. `update` must start the proxy on the updated files, which an in-process import cannot guarantee. In-process callers that re-derived state (account change, `doctor --fix`'s identity check, setup) moved to the intents.
2. **A start lock the intent may not take is an outcome, not a throw.** It is `start-lock-unavailable` with `code: 1` and `error`, which is the manager CLI's observable exit (`manager error: …`, exit 1). `createManager().start/restart/respawn` and the account change rethrow it, so the CLI and callers behave as before. The preflight keeps mapping it to `4`/`startup` "safe start refused". Unexpected errors (unreadable config, filesystem) still throw, as before.
3. **`readState()` reads the pid record before the identity proof** (the order `status` always used). `restartForAccountChange` used to read the identity first. The two differ only under a concurrent change between two reads.
4. **The module lives in `lib/`, not `proxy/`.** The kit test fixtures and the ux-before capture copy `cli/`, `lib/` and the manager file only (the same reason as ticket 14's decision 1). `managerPath` (the `ZCODE_KIT_RESPAWN_MANAGER` value) defaults to the manager next to the module's own kit. That is the same path the preflight passed before; the manager CLI passes its own path, as before.
5. **Pre-existing test change (justified):** `tests/release-audit.test.mjs`'s package fixture lists the two new required files. It is a list extension like tickets 05 and 08. No other existing test changed.

**Pending CI (orchestrator verifies after merge+push)**
- `test-kit` windows-latest, Node 24 and 26: `tests/proxy-lifecycle.test.mjs`. It spawns Bun proxies; `processStartMs` uses PowerShell; stop goes through the handle-checked `TerminateProcess` and must print exactly `stopped (pid N)`; paths are compared canonically (realpath, case, 8.3 TEMP). Also the release tests with the new required files.
- `test-kit` ubuntu, Node 24 and 26: the same file, plus the vendored-hook check (skipped with a diagnostic on a shallow checkout).
- `ux-before` on both legs, byte for byte (the windows leg against `tests/ux-before/windows`).
- `memory-budget` on both legs: the ratchet holds with `expected-red.json` unchanged. Windows `S3/short`, `S3/hung` and `S4/short` keep their listed names, with no new RED name. Windows S3 `procPeak:preflight` (commit) must still be ≤ 76 MB; if it is RED there, 15 comes back with the numbers (Round 15).
- Windows behaviour not exercised locally: the per-acquisition lock release, and the preflight running the lifecycle module without the manager.
