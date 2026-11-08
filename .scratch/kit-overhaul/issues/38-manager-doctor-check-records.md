# 38: Manager `doctor` returns check records; `zcode-kit doctor` stops parsing text

**Blocked by:** 15 (Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0001 (Round 2 amendment)

**What to build:** The manager's doctor returns its checks as records through the lifecycle module; `zcode-kit doctor` consumes records instead of regex-parsing text. The manager CLI's own `doctor` keeps the legacy off-TTY grammar byte for byte.

**Acceptance criteria:**

- [ ] Spawned manager CLI `doctor` output byte-identical to the pre-change snapshot (seam 2).
- [ ] `zcode-kit doctor` exit codes unchanged on every fixture state; no text parsing remains (grep test).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 61, 92

## Comments

### 2026-11-08 — implementer (ticket 38)

**Branch:** `ticket/38-doctor-check-records` (worktree `/home/AgentKit/wt/t38`). Pre-change snapshots `ee19874` and `5e31f78`, both captured on the untouched tip `91fa58f`. Tests `eb1cfe6`, implementation `2500097`. The integration tip `788f2fb` (docs only) is merged in `a971fd6`. The head SHA is the commit that adds this comment.

**What landed**
- `lib/proxy-doctor.mjs`: `managerDoctor({ root, home, env, lifecycle, bunResolver })` runs the manager's checks over the lifecycle module (its identity proof, key, port and Bun lookup). It returns a doctor record `{ intent: "doctor", code, outcome: "ok"|"failed", checks: [{ name, ok: true|false|null, detail }] }` and prints nothing. The check code moved from the manager verbatim. One addition: `env` is injectable for the env-override row, the explicit store, the Bun lookup and the credential probe's environment, and it defaults to `process.env`.
- `proxy/zcode-proxy-manager.mjs`: `createManager().doctor()` renders that record in the legacy off-TTY grammar (rows, then `doctor: N skipped, 0 failed — OK` / `doctor: N check(s) failed`). It returns the record's code. The manager CLI's `doctor` is unchanged byte for byte.
- `cli/commands/doctor.mjs`: `zcode-kit doctor` loads `lib/proxy-doctor.mjs` from its own kit (`kit.root`, the same tree whose manager it used to spawn). It calls the doctor with `{ root: kit.root, home: kit.home, env: ctx.env }` and reads `record.checks`. The manager's own report is rendered from the record, first, exactly as before (`legacyReport`). It no longer spawns `manager doctor` and has no row regex. `--json` holds the same `{ ok, failed, skipped, checks }` superset.
- `pack/verify-payload.mjs` requires `lib/proxy-doctor.mjs`.

**Acceptance evidence**
- *Spawned manager CLI `doctor` byte-identical to the pre-change snapshot (seam 2):* `tests/manager-doctor.test.mjs`, five fixture states. Each spawns `node proxy/zcode-proxy-manager.mjs doctor` in a kit copy and compares stdout, the exit code and stderr with `tests/snapshots/manager-doctor/<state>.txt`, captured on `91fa58f` before any code change (`t38-snap-capture*`):
  - `fresh`: no config/key/deps; exit 1.
  - `proxy-down`: env overrides, explicit decryptable store, OMP managed, MCP, artifacts; exit 1.
  - `proxy-running`: everything passes, JWT age row; exit 0.
  - `proxy-running-auth-rejected`: 401 quota, undecryptable store, OMP skipped; exit 1.
  - `foreign-no-bun`: a 401 listener, no Bun, OMP never asked; exit 1.

  Normalised: the fixture root as `<KIT>`, the Bun path and its version. GREEN after the change; the snapshot files are unchanged since `ee19874`.
- *`zcode-kit doctor` exit codes unchanged on every fixture state:* the same five states through `zcode-kit doctor` and `zcode-kit doctor --json`. Ten snapshots under `tests/snapshots/manager-doctor/kit-doctor-{text,json}/`, captured on `91fa58f` with exit codes (3 × exit 0, 12 × exit 1 across all 15 manager/kit snapshots), stay byte-identical. `npm run test:ux-before` (`t38-uxbefore`) is 1/1 pass: all captures byte-identical in all seven variants, including the twelve `doctor-*` captures (fresh, proxy down/running, `--json`, `--fix` ×2, `--harness`, `--upstream` ×2, `--forget` ×3). `json-superset` covers `doctor --json` running and down (pass in the full suite).
- *No text parsing remains (grep test):* `tests/cli-commands.test.mjs` "doctor reads the manager's check records: no text parsing and no manager doctor spawn remain in the CLI (grep)". It checks four things: `cli/commands/doctor.mjs` names `proxy-doctor.mjs`, has no regex literal starting with a verdict word, and reads no `.stdout`; and no file under `cli/` spawns `[manager|managerPath(…), "doctor"]`.

**RED → GREEN** (logs in the integration worktree's `reports/`)
- `t38-red-records`: the two seam-2 record tests fail on the tip (`ERR_MODULE_NOT_FOUND …/lib/proxy-doctor.mjs`). Both are green from `t38-green-records2` on.
- `t38-red-kit-doctor`: 7 of the rewritten seam-5 doctor tests fail on the tip's `cli/commands/doctor.mjs`: clean, FAIL, throw/inconsistent, multi-line detail, `--harness`, `--json` and grep. The tip still spawns the manager and regex-parses its rows. Green in `t38-green-kit-doctor` (164/164 over cli-commands, cli-kit, manager-doctor, auto-heal, manager-safety).
- `t38-red-injected` (adversarial, at the real spawn seam): a Bun whose `--version` prints `1.4.2\nFAIL  injected — from a version string`. On the tip the parser cuts the `bun available` detail at the newline and makes up an `injected` FAIL check, so `zcode-kit doctor --json` exits 1. After the change it stays one passing check: exit 0, `failed: 0`, no made-up check.
- `t38-red-payload`: a payload without `lib/proxy-doctor.mjs` passed `verify-payload` (status 0); after the change it is refused (status 1).
- The preservation tests (the 15 snapshot tests) pass on the tip by design. Mutation proofs (`t38-mutations`; implementation committed first as `2500097`, every mutant restored with `git checkout 2500097 -- <file>`, `git status` clean afterwards). All 8 were killed:
  - m1: manager row separator ` — ` → ` - `. 5 fail.
  - m2: manager summary wording. 4 fail.
  - m3: `health=` → `health: ` in the doctor module. 13 fail (manager and kit snapshots).
  - m4: the doctor reads `process.env` instead of the injected env. The record test fails.
  - m5: the kit drops the manager's report. 8 fail.
  - m6: the kit drops the manager's failed checks. 10 fail (exit codes and JSON).
  - m7: the kit passes `process.env` instead of `ctx.env`. 1 fails.
  - m8: the record's code is always 0. 5 fail (manager exit codes).

**Full suites** (Bun 1.4.2, Node 26.7.0; the merged tip adds only `.scratch` docs, so there is no code change after these runs)
- `npm run test` (`t38-full-test2`): 915 tests, 897 pass, 0 fail, 18 skipped, 52 s.
  - New: +18 in `manager-doctor.test.mjs`, +2 in `cli-commands`, +1 in `release-marker`.
  - The first full run, `t38-full-test`, hung: the 1200 s wrapper timeout interrupted it in `manager-audit` (fixed ports 18795–18805), and `json-superset` / `ux-before-capture` saw a busy fixed port ("port 18460 is in use; another capture may be running"). The four files failing there re-ran green alone (`t38-rerun-4`, 75/75 in 15 s), and the full rerun is clean. This is ticket 75's fixed-port class; no code here uses a fixed port.
- `npm run test:proxy` (`t38-full-proxy`): 1596 pass, 0 fail, 107 files. No proxy source changed.
- `npm run test:mcp` (`t38-full-mcp`): 100 tests, 99 pass, 0 fail, 1 skipped. `dist/` unchanged.
- `npm run test:ux-before` (`t38-uxbefore`): 1/1, byte-identical, seven variants.
- `node scripts/verify-golden-path.mjs` (mock; runs `doctor --fix --harness omp --json`) (`t38-golden`): exit 0.

**Metrics delta.** No memory-loop scenario runs `doctor`, and the preflight's import closure is unchanged: `lib/proxy-doctor.mjs` is not on it, and `proxy-lifecycle.test.mjs`'s closure test still passes. So no loop run was due and `expected-red.json` is unchanged (38 owns no entry). Each `zcode-kit doctor` now starts one Node process fewer: the manager's checks run in the kit process instead of in a spawned `manager doctor`.

**Decisions taken (spec/ADRs silent)**
1. **The record lives in `lib/proxy-doctor.mjs` and builds on the lifecycle module; it is not an intent inside `lib/proxy-lifecycle.mjs`.** The checks read the harness choices (`cli/harness-consent.mjs`), and the preflight's import closure must not contain that module (ticket 15's closure test, Round 2 Q11 condition 3). Putting the checks in the lifecycle module would also add them to every preflight's memory, which sits near its 76 MB budget. The record shape follows the lifecycle's outcome records (`intent`, `code`, `outcome`), plus `checks`.
2. **`zcode-kit doctor` calls the doctor in-process; it no longer spawns the manager CLI.** This is the only way it stops parsing text, short of a second serialisation. It loads the module from `kit.root`, the same tree whose manager it spawned, so a kit runs its own manager's checks, as before. Two consequences:
   - The old 25 s spawn timeout no longer caps the whole check run. The individual probes keep their own bounds: Bun `--version` 10 s, credential probe 20 s, identity 2.5 s, quota 8 s.
   - A doctor that throws, or that cannot be loaded (for example a payload without the module), keeps today's row `FAIL  manager doctor completed — manager check failed or timed out`. A record with a non-zero code but no failed check keeps `… manager check exited N without a diagnostic failure result`. Both reuse the existing texts rather than adding new ones.
3. **The manager's report shown first** is rendered from the record. It is byte-identical to the manager CLI's stdout, which the tip passed through. The A-02 "everything twice" output stays as it is; ticket 40 owns it.
4. **Pre-existing test changes (justified):**
   - `tests/cli-commands.test.mjs`: the doctor tests faked the manager at the `spawnSync` boundary, which no longer exists. They now fake it at `lib/proxy-doctor.mjs` in the temp kit, with the same cases and exit codes.
     - The "clean manager" test now expects the manager block with its summary line, as the real manager prints it (the old fake stdout omitted it).
     - The "exit 3 without a FAIL row" case is now a record with code 3 and no failed check.
     - The spawn-timeout case is now a throwing doctor; it keeps the same FAIL row.
     - `--forget` and usage errors still never call the manager.
   - `tests/cli-kit.test.mjs` "doctor --harness text summary counts manager FAIL lines": the deterministic stub moves from a fake manager CLI to a fake `lib/proxy-doctor.mjs` record with the same FAIL/PASS checks. Without that, the real doctor would run against the runner's real HOME (B2/B3).
   - `tests/manager-safety.test.mjs` H2a: its precondition "the manager calls spawnSync" no longer holds. The doctor's Bun probes were the last `spawnSync` calls in the manager; the darwin probe moved in ticket 15 and is guarded in `proxy-lifecycle.test.mjs`. The import-coverage check now runs over the manager and `lib/proxy-doctor.mjs` and stays non-vacuous.
   - `tests/release-audit.test.mjs`: the package fixture lists the new required file (a list extension like tickets 05, 08 and 15).
   - No other existing test changed.
5. Common acceptance:
   - no new log events;
   - no new config keys or `ZCODE_PROXY_*` overrides;
   - the new test file is wired into `npm run test` (the wiring guard passes).

**Pending CI (orchestrator verifies after merge+push)**
- `test-kit` windows-latest, Node 24 and 26: `tests/manager-doctor.test.mjs`. It covers:
  - `<KIT>` normalisation of backslash paths and the 8.3/realpath spellings;
  - the `node_modules` junction;
  - `bun.exe` through `ZCODE_KIT_BUN`;
  - the no-Bun state with an empty `PATH`.

  The fake-Bun injection test is skipped on Windows (a POSIX shell script). Also the rewritten `cli-commands`/`cli-kit` doctor tests and `release-marker`.
- `test-kit` ubuntu, Node 24 and 26: the same files.
- `ux-before` on both legs, byte for byte.
- `memory-budget` on both legs: unaffected (no scenario runs doctor; the preflight closure is unchanged); the ratchet must still hold with `expected-red.json` unchanged.
