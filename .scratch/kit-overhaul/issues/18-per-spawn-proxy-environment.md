# 18: Per-spawn proxy environment: stop token and log dir set by the manager, token stripped from the respawn hook

**Blocked by:** 15 (Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets)), 21 (Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0014 (Round 4 amendment), 0015 (Round 4 amendment)

**What to build:** At every proxy spawn the manager sets `ZCODE_KIT_STOP_TOKEN` (fresh 256-bit token, also written as an additive field in `proxy.pid`) and `ZCODE_KIT_LOG_DIR` (its own logs dir), overwriting inherited values. The proxy removes the token from the respawn hook's environment. `ZCODE_KIT_LOG_DIR` is internal; a proxy without it keeps today's behaviour. The token never appears in logs, status, JSON, doctor, snapshots or error text.

**Acceptance criteria:**

- [ ] `proxy-env` suite (seam 8): ambient bogus values for both variables → the spawned proxy gets the manager's logs dir and a new token; the respawn hook's environment has no stop token.
- [ ] Seam 2: the token in the proxy's environment equals the one in `proxy.pid`; two consecutive spawns get different tokens; `proxy.pid` written with owner-only mode.
- [ ] Redaction test: the token value appears in no captured output of `status`, `--json`, `doctor` or logs.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 55, 56

## Comments

- 2026-11-06 (orchestrator, from ticket 14): generate the stop token as 32 random bytes base64url (43 chars, same shape as the proxy key) and add it to the manager's knownSecrets() so event-line redaction masks it (see ticket 14 Comments).
- 2026-11-08 (implementer, branch `ticket/18-per-spawn-proxy-env`, code head `b94dcb4` = e95a549 + merge of the integration tip 9256a33, which includes ticket 76's egress guard).
  - **What changed.** `lib/proxy-env.mjs`: `newStopToken()` (32 random bytes, base64url, 43 chars) and `proxyServeEnv(ctx, stopToken)` = `proxyEnv` + `ZCODE_KIT_LOG_DIR` (the manager's `ctx.logDir`) + `ZCODE_KIT_STOP_TOKEN`; it throws without a token. `proxyEnv` now drops inherited `ZCODE_KIT_STOP_TOKEN`/`ZCODE_KIT_LOG_DIR` in any casing, so no other proxy child (login, doctor's store probe, `zcode-kit` proxy CLI runs) inherits either. `lib/proxy-lifecycle.mjs` (spawn env line, `writePidFile`, `knownSecrets` only): a fresh token per spawn, written as the additive `stopToken` field of `proxy.pid`; `proxy.pid` is chmodded to 0600 after every write; `knownSecrets()` adds this manager's last-spawn token and the recorded token. `readPidFile()` does not return the token, so `status`/`--json`/`doctor`/`readState` cannot print it. `zcode-proxy-src/src/runtime/watchdog.ts`: `launchRespawnHook` (the memory guard's and the watchdog worker's hook launch) passes the env without `ZCODE_KIT_STOP_TOKEN` (any casing); the proxy's own env keeps it. Start-lock code is untouched.
  - **Paths touched:** `lib/proxy-env.mjs`, `lib/proxy-lifecycle.mjs`, `tests/proxy-env.test.mjs`, `tests/proxy-lifecycle.test.mjs`, `zcode-proxy-src/src/runtime/watchdog.ts`, `zcode-proxy-src/src/runtime/watchdog.test.ts`, this file. Signature (vii) does not apply (diff touches `zcode-proxy-src/**`).
  - **Seams** (from seams.md, confirmed by the Owner Proxy in Round 4; no new seam): seam 8 `proxy-env` = `tests/proxy-env.test.mjs` (env builder) and the `proxy-env:` tests in `watchdog.test.ts` (hook env, both launch paths); seam 2 = `tests/proxy-lifecycle.test.mjs`, a stand-in proxy spawned by the manager CLI.
  - **RED → GREEN** (runner root `/home/AgentKit/wt/t18`; logs under `reports/t18-*.log`):
    - seam 2, 3 tests collected, 3 failed on the tip code: spawned proxy's `ZCODE_KIT_LOG_DIR` = the ambient `…/ambient-logs`, not `…/logs`; no stop token in the proxy env; `manager logs` printed the recorded fixture token unmasked (`t18-red-seam2`). GREEN 3/3 (`t18-green-node`).
    - seam 8 node: the first run failed on the missing export (a load failure, not counted as RED); with a stub export, 9 collected, 3 new failed on their assertions (`t18-red-proxyenv-stub`). GREEN 9/9.
    - seam 8 proxy, under ticket 76's guard preloaded from a copy outside the repo: 13 collected, 2 new failed with `stopTokenNames` = `["ZCODE_KIT_STOP_TOKEN", …]` in the hook (`t18-red-hook`). GREEN 13/13 + supervisor tests + typecheck (`t18-green-hook`).
    - Mutation checks for assertions that could not go RED on their own (implementation committed as 9ec7f49 first; mutants restored with `git checkout 9ec7f49 -- <file>`; `git diff --exit-code` clean after each): removing the `chmodSync` failed "spawn 1: proxy.pid is owner-only" (`t18-mut-chmod`); a constant `newStopToken` failed "two consecutive spawns get different tokens" (`t18-mut-token`).
  - **Adversarial cases, derived from what the guarantees are for:** an ambient token of the right shape and an ambient logs dir in the manager's env (a respawned chain, or an old proxy's hook); a world-readable, unparseable `proxy.pid` that already exists (`writeFileSync`'s mode applies only to new files, so before the chmod the token sat in a 0644 file); case variants (`zcode_kit_stop_token`, `Zcode_Kit_Log_Dir`), because on Windows two spellings make the child's value depend on block order; a fixture token with more than four hyphens, which the token-shape rule leaves alone, so only the exact known-secret match masks it; the hook launched from the watchdog worker as well as from the memory guard.
  - **Redaction test** (seam 2): with a stand-in proxy running, the token is in none of `status`, `status --json` (premise: `health` = `ours`), `doctor`, `logs 400`, nor in any file under `logs/` other than `proxy.pid` after stop. No test prints a token: values are compared inside `assert.ok`/`toBe(true)` with messages that name no value; the hook recorder writes variable names, not values.
  - **Full suites after merging the tip:** `npm run test` 892 tests: 874 pass, 0 fail, 18 skipped (`t18-full-test`); `npm run test:proxy` 1598 pass, 0 fail, 107 files, guard preloaded via bunfig, + `test:proxy-typecheck` clean (`t18-full-proxy`); `npm run test:mcp` 100 tests: 99 pass, 0 fail, 1 skipped, `dist/` unchanged (`t18-full-mcp`).
  - **Memory loop** S4/short on port 19181 (`t18-memloop-s4`): RED as expected and the same as the baseline: stale lock 5 of 8 and respawn-with-stale-lock 0 proxies (tickets 16/17); 0 leaked proxies, 0 orphans, 3 respawns, 1 log file, proxy peak 59.8 MB. No expected-red entry belongs to this ticket.
  - **Decisions.** (1) The per-spawn variables are added by a separate `proxyServeEnv`, not inside `proxyEnv`, because `proxyEnv` also builds login/probe environments that must not carry a spawn's token; instead `proxyEnv` now strips inherited values (C2-safe: nothing set them before). (2) `readPidFile` does not expose `stopToken`; the stop-request ticket adds the reader it needs. (3) Only the spawner writes the token: `writePidFile` takes it from `lastSpawn` (same pid), so a rewrite by a manager that did not spawn the proxy drops the field. (4) `ZCODE_KIT_LOG_DIR` is documented in the `lib/proxy-env.mjs` header like `ZCODE_KIT_RESPAWN_*` (code comments only; no user doc lists either). The proxy does not read it yet; that belongs to the `proxy.log` writer and the acknowledgement wait, so "a proxy without it keeps today's behaviour" holds trivially. No new config key, log event or `ZCODE_PROXY_*` override.
  - **For the merger / other tickets.** Ticket 16 rewrites `writePidFile` (`writePidJson` temp + rename, a `spawning` field) and adds `completeRecord`, which rewrites a record another manager spawned. When merging, keep `stopToken` in the record: the spawner's writes take it from `lastSpawn`, and `completeRecord` should copy it from the existing record for the same pid. Keep the owner-only mode as well (its temp file with `wx` + 0600 + rename already does that). The solver process env must also lose the token (ADR-0002; ticket 27); this ticket does only the respawn hook.
  - **Windows criteria:** pending CI (orchestrator verifies after merge+push). The mode assertion is POSIX-only (on Windows `proxy.pid` is protected by the profile ACL); on Windows without a recorded start time, the spawn test stops the stand-in through its fixture command line, as the existing tests do.
