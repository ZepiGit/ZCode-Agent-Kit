# 08: CLI command-module split, part 2 (migrate remaining commands + contract)

**Blocked by:** 07 (CLI command-module split, part 1 (expand: dispatcher + status/doctor/proxy/models/logs)), 10 (Batch 1b — Node 24 support floor, refuse before mutation, autostart Node-path check)

**Status:** resolved

Model: glm

Risk: medium

ADR: —

**What to build:** `setup`, `integrate`, `update`, `rollback`, `uninstall`, `accounts`, `auth`, `run`, help and the rest move to command modules; the inline command bodies in the CLI entry are deleted (contract).

**Acceptance criteria:**

- [ ] Every command dispatches through a module; the CLI entry has no command bodies left (structural test).
- [ ] All spawn suites and snapshots unchanged; exit codes 0, 1, 2, 3, 4, 5, 20, 130 asserted per command where they occur today.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 61 (CLI contracts kept)

## Comments

### 2026-11-07 — implementer (logged substitute for glm; the glm worker has no provider)

**Branch:** `ticket/08-cli-command-modules-part-2` (worktree `/home/AgentKit/wt/t08`), base `ticket/10-node-24-floor` at `e57d75d`. Commits: `f1927fe` (modules, contract, payload), `fee804a` (auth login env assertion, added after mutant M11 survived), `afe2953` (merge of the integration tip `0937a8f`, clean; it contains ticket 10's merge `1e8f652`, ticket 59, not ticket 11), `28f472b` (Windows uninstall shim test). The head SHA is the commit that adds this comment. Logs: `.scratch/kit-overhaul/reports/t08-*.log` in the integration worktree; scratch scripts under `/home/AgentKit/overhaul-tools/t08-scripts/`.

**What landed**
- `cli/commands/{help,setup,integrate,run,usage,auth,accounts,update,rollback,uninstall}.mjs`, each `run(args, ctx) → { exitCode, records }`; `help.mjs` also exports `runUnknown` (unknown command).
- `cli/commands/index.mjs`: the dispatch table `COMMANDS` (all 14 commands → module namespace) and `UNKNOWN_COMMAND`.
- `cli/commands/common.mjs`: `unknownHarness(id)` (replaces the entry's `requireHarness` + `process.exit(2)`), `proxyCli(ctx, args, opts)` (replaces `runProxyCli`), `EXIT_HARNESS_FAILED`/`EXIT_ABORTED`; the ctx contract gained `platform`, `runCommandSync` and `progressError`.
- `cli/zcode-kit.mjs` (1041 → 140 lines): parsing, the Node-floor refusal, dispatch, rendering, the entry check. No command body, no `switch`, no `cmd*` function. Bin entry points unchanged.
- `pack/verify-payload.mjs` requires the 17 `cli/commands/*.mjs` files (left for 08 by ticket 07).

**Tests (seam 5)** — `tests/cli-commands.test.mjs` 26 → 71 tests (additions only), `tests/release-marker.test.mjs` +1.
- Import without side effects: one probe test per new module (11, `index.mjs` included, so the whole table is probed transitively).
- Structural (acceptance 1): `COMMANDS` keys = the 14 commands of the pre-split entry (its switch + 07's table + `help`); each value is the module namespace of `cli/commands/<name>.mjs`; every `zcode-kit <word>` the help text names is in the table. The entry's static imports are exactly `node:child_process`, `node:fs`, `node:url`, `./context.mjs`, `../lib/process.mjs`, `../lib/node-floor.mjs`, `../lib/term/load.mjs`, `./commands/index.mjs`; its functions are exactly `parseArgs`, `main`, `commandCtx`, `dispatch`, `render`.
- Exit codes on `{ exitCode, records }` (acceptance 2), boundaries faked at `spawnSync` (manager, proxy CLI, setup re-run), `runCommandSync` (git, npm, claude) and `fetch`:

| command | codes as today | asserted by |
|---|---|---|
| help / unknown | 0 / 2 | module tests + entry spawn (streams, `status --help`) |
| setup | 0, 20, 130 | `harness-consent.test.mjs:502` (20), `:734` (130), cli-audit smoke (0) — unchanged spawn tests, mutants M5/M5b |
| setup | 2 | module (unknown harness via `--harness` / `ZCODE_KIT_HARNESSES`, nothing written), entry spawn; floor refusal: `node-floor.test.mjs` (M7); checkout refusal, bad `--account-rotator`, held lock: rejects → entry 2 |
| integrate | 0, 2 | module (dry run writes nothing in HOME; unknown/missing harness), checkout refusal rejects; entry spawn |
| run | 2, 3, 0/7/130 | module (unknown/missing, no launcher rejects); entry spawn over a mini kit with a fake harness and a loopback proxy on 19083: harness 0/7/130 pass through, a foreign listener → preflight 3, harness never starts (POSIX) |
| usage | 0, 1 | module (2xx, 503, no answer) |
| auth | 0, 1, 2, 5 | status 0/1 (logged in, rejected, no answer); login passthrough 0/1/5, no status → 1, blank `--account` → 2; per-spawn proxy env; logout 2 / 0 (removes only the proxy credential); unknown → 2 |
| accounts | 0, 1, 2, 4, 5 | every forwarded subcommand passes 0/1/2/4/5 through, no status → 1; missing id / unknown → 2; disable → 0; enable with a failed import rejects, lock released |
| update | 0, 1, 2, 3, 4, 5, 20, 128, 130 | module: bad `--version` 2 (no git/npm/network); git missing/dirty/unknown tag 2, fetch 128, diverged 1; setup 0/20/130 → same code, proxy restarted; setup 1 → 1, no start; manager start 3/4/5 → same; stop exit 3 is not a stop failure; no manager → 0; release: lookup failure 2, already current 0 (no stop) |
| rollback | 0, 1 | module (nothing, complete, external needing manual undo) |
| uninstall | 0, 1 | module (claude registration of this copy undone, own shim removed; manual external → 1; foreign shim kept; Windows `.cmd`+`.ps1` pair via injected `platform`) |
| doctor/status/proxy/models/logs | 0–5 | ticket 07's tests (unchanged) |

**RED → GREEN**
- `t08-red1` … `t08-red5`: every new module test failed with `ERR_MODULE_NOT_FOUND` before its module existed; `t08-red6`: both structural tests failed on the pre-contract entry (it imported `../lib/transaction.mjs`, `./commands/doctor.mjs`, … and had `cmd*` bodies); `t08-red7`: the payload test failed (`a package missing cli/commands/accounts.mjs must fail closed`). Green: `t08-green1` … `t08-green9`.
- Preservation tests (entry spawn tests, setup's 20/130, the floor flag, the run passthrough) proven by mutation, `t08-mutants` / `t08-mutant-m11` / `t08-mutant-m13` (script restores each file; `git status` clean of `cli/`/`pack/` afterwards): M1 inline `cmdRollback` in the entry and M1b a `lib/transaction.mjs` import → structural test fails; M2 `usage: auth` in the table → dispatch test; M3 unknown-command error on stdout → module + entry test; M4 run drops the harness code → run spawn test; M5/M5b setup 20 → 1, 130 → 0 → harness-consent's tests; M6 update drops 20 → update test; M7 `nodeFloor = false` in setup → 3 node-floor tests; M8 a missing module in verify-payload's list → payload test; M9 module-scope env read in rollback and M10 a static `heal.mjs` import in setup → probe tests; M11 proxy CLI without `proxyEnv` **survived** at first → `fee804a` adds the assertion, then it fails; M12 uninstall removes any shim → uninstall test; M13 Windows shim ownership check removed → Windows shim test.
- Before-equivalence sees the new setup module: `t08-before-mutant` (`Configuration saved.` → `!`, pipe variant) → "10 capture(s) differ" (setup ×6, install-sh ×2, …), file restored.

**No visible change**
- `npm run test:ux-before` (`UX_CAPTURE_PORT=19080`): `t08-before1` (pre-merge `fee804a`, 484 s) and `t08-before-final` (merged `afe2953`, 487 s) pass 1/1: 7 variants, 640 captures byte-identical with equal exit codes. Snapshot diff: none.
- `cli-kit`, `cli-audit`, `setup-regressions`, `harness-consent`, `node-floor` (ticket 10, unchanged) green (`t08-green6`: 158 tests, 155 pass, 3 skipped).
- Real Node 22.23.4 and 20.20.2 load the new module graph and refuse `setup`, `update`, `update --version`, exit 2, fixture byte-identical (`t08-real-old-node`, ticket 10's script).
- `node pack/build.mjs --tracked-only` + `pack/verify-payload.mjs` on this checkout: 225 files, OK (`t08-pack`).

**Full suites on the merged head** (Node 26.7.0, Bun 1.4.2)
- `npm run test` (`t08-final-kit`, head `28f472b`): 733 tests, 716 pass, 0 fail, 17 skipped (tip 687 + 46 new).
- `npm run test:proxy` (`t08-full-proxy`): 1343 pass, 0 fail, 90 files.
- `npm run test:mcp` (`t08-full-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged.

**Memory loop** — S3/short (the scenario through `zcode-kit run`), port 19085, two runs each, base = integration tip `0937a8f` in a temporary detached worktree (removed):

| metric | base #1 | base #2 | after #1 | after #2 |
|---|---|---|---|---|
| peak:kit | 850.7 MB | 850.8 MB | 858.4 MB | 852.4 MB |
| launcher max/proc | 73.9 MB | 77.4 MB | 78.3 MB | 77.6 MB |
| failed-launches | 2 | 5 | 7 | 7 |
| stale-lock-after-round | 1 | 1 | 1 | 1 |

All four RED: the existing `S3/short` expected-RED entry (ticket 37); the failed launches are the start-lock race (ticket 16) and vary 2–8 run to run (07 saw 8 and 6). No expected-RED entry belongs to this ticket. Logs: `t08-memloop-S3-{base,after}{,-2}`.

**Decisions taken**
1. **Streamed vs recorded.** Commands whose output interleaves with a question or a child sharing the terminal (setup, integrate, run, update, uninstall, auth login, the accounts forwards) write through `ctx.progress`/`ctx.progressError` (or the child's own stdio) and return `records: []`; records rendered at the end would reorder them. help, usage, auth status/logout, accounts enable/disable, rollback and every usage error return records. Helpers that already printed (setup-output, bootstrap, adapters, launch) still do; batches 40+/43/47 move them onto output-module records.
2. **The floor refusal stays in the entry**, before the kit context exists, as ticket 10 placed it; it is driven by the module's `export const nodeFloor = true` (setup, update) instead of command names, and a test pins that only those two declare it.
3. **Lazy imports**: `setup` imports `heal.mjs` and `run` imports `launch.mjs` at call time (both check at module scope whether they are the process entry, which reads argv). The entry no longer imports `heal.mjs` statically.
4. **`update` passes `ctx.fetch`** to `resolveLatestTag`/`downloadRelease` (`fetchImpl`): the global fetch in production, as before; injectable in tests.
5. **`help` runs with `kit: null`**, before `createCtx`, as before; an unknown command still creates the kit context first.

**Pre-existing test changes (justified)**
- `tests/release-audit.test.mjs`: the payload fixture also writes the `cli/commands/*.mjs` files (listed from the checkout) and imports `readdirSync` — needed because verify-payload now requires them.
- `tests/release-marker.test.mjs`: `readdirSync` import + one new test.
- `tests/cli-commands.test.mjs`: additions only; no existing test or assertion changed.

**Left for other tickets / notes**
- `term-boundaries`' `NEW_CODE` still does not cover `cli/commands/`: no command module reads `isTTY`/`NO_COLOR`/`TERM`/`CI`/`columns` (grep clean); the first module moving onto `lib/term/` adds itself (40+).
- Comments in `tests/cli-kit.test.mjs:544` and `tests/setup-regressions.test.mjs:153` still name `cmdAuth`/`cmdUpdate`; left as they are (no test change for a comment).

**Pending CI (orchestrator verifies after merge+push)**
- windows-latest `test-kit` legs (Node 24 and 26): the new `cli-commands` tests, in particular `auth login`/`accounts` (`ZCODE_KIT_BUN=process.execPath` must resolve to the same path through `commandInvocation`), the entry spawn tests (`cli([...])` with PATH/HOME/SystemRoot only), the uninstall tests (injected `platform`), and the payload test (17 build+verify cycles). `entry: run passes …` is skipped on win32.
- The Windows-only spawn tests that now go through the new modules: `cli-audit` "CLI run preserves exact Windows prompt arguments…" (run → launch), "Claude MCP registration recognizes equivalent Windows paths…" and "…refuses a foreign path…" (setup's `integrateMcp`/`sameInstallationPath`), `installer-audit` install.ps1 tests that run setup (exit 20/130 handling, Node floor refusal).
- The windows `ux-before` leg (pipe, ci variants) and the `memory-budget` job on both OSes.
- Ubuntu legs of the same jobs (green locally on Node 26.7.0 only; Node 24 not run locally).

**Common acceptance**
- RED → GREEN at seam 5: ✓. Fast suite green on ubuntu: ✓ (locally); windows + `memory-budget`: pending CI. New test file: none (tests added to wired files; wiring guard green). Pre-existing test changes justified: ✓ (above). Evidence recorded: ✓. No new log events, config keys or `ZCODE_PROXY_*` overrides: n/a.

**Acceptance criteria**
- Every command dispatches through a module; the CLI entry has no command bodies left (structural test): ✓ (`t08-green6`, `t08-final-cmds`; M1/M1b/M2).
- All spawn suites and snapshots unchanged; exit codes 0, 1, 2, 3, 4, 5, 20, 130 asserted per command where they occur today: ✓ on ubuntu (`t08-before-final`, `t08-final-kit`, table above); windows pending CI.

### 2026-11-07 — implementer, round 2 (merge of ticket 11)

**Merge:** `78be83d` merges `overhaul/stability-terminal-ux` at `e1ab798` (contains ticket 11's merge `11cbfcb`) into this branch. Only one file conflicted: `tests/release-audit.test.mjs`, and only in its `node:fs` import line. This branch had added `readdirSync` for the command-module fixture; ticket 11 added `symlinkSync` for its live pinned-tsc check. I resolved it by hand to one import that has both names. The rest of the file merged automatically. Against the integration tip, the file now differs only by this ticket's two additions (`readdirSync` in the import and the `cli/commands/*.mjs` fixture lines); ticket 11's tests and helpers are unchanged. Dependencies were reinstalled with Bun 1.4.2 (`t08-r2-install`; `bun install --frozen-lockfile` → typescript 7.0.2, @types/bun 1.4.2).

**Suites on `78be83d`** (Node 26.7.0, Bun 1.4.2)
- `npm run test` (`t08-r2-kit`): 744 tests, 725 pass, 0 fail, 19 skipped.
- `npm run test:proxy` (`t08-r2-proxy`): 1343 pass, 0 fail, 90 files.
- `npm run test:proxy-typecheck` (`t08-r2-typecheck`): `tsc --noEmit -p tsconfig.json`, exit 0.
- `npm run test:mcp` (`t08-r2-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged.
- `npm run test:ux-before` (`t08-r2-before`, `UX_CAPTURE_PORT=19080`, 513 s): 1/1. All 640 captures are byte-identical.
- `release-audit` + `release-marker` (`t08-r2-release`): 28/28. Both sides' tests pass:
  - ticket 11's tests: "Bun 1.4.2 is the one pin…", "test-kit runs the proxy typecheck through the pinned typescript…", "the pinned proxy typecheck passes on the proxy source and fails on a new type error";
  - this ticket's tests: "package build excludes source tests/fixtures…" (on the fixture that now has the command modules) and "payload verification rejects a payload without any one of the CLI command modules".

The pending-CI checklist from round 1 still applies unchanged.

Merged 2026-11-07 as dabdc0b (ticket/08-cli-command-modules-part-2 at 873df4f; first merge, no revert-of-revert step); fast suite: kit 725/744 (19 skipped, 0 fail), proxy 1343/1343, mcp 95/96 (1 skipped, 0 fail); mcp dist unchanged. Also: proxy typecheck green (`tsc --noEmit -p tsconfig.json`), `test:ux-before` 1/1 (every capture byte-identical to the BEFORE baseline: tty-color-80, tty-color-120, no-color, term-dumb, ascii-locale, pipe, ci; 532 s). No lockfile changes, so only the root `npm ci` ran. Clean merge (no conflicts). Sanity: `git diff --stat staging/08 HEAD -- . ':!.scratch'` is empty. Pre-merge CI (draft PR #21, staging/08 after round 2), green on all 8 jobs: https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42387910869 (the ratchet holds on both memory-budget legs; the earlier run 42383999482, before ticket 11 landed, was also 8/8). Logs: .scratch/kit-overhaul/reports/merge-08-{npm-ci,test,proxy,mcp,ux-before,proxy-typecheck}.log.
