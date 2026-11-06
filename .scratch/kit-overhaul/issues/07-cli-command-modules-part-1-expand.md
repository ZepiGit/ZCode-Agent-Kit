# 07: CLI command-module split, part 1 (expand: dispatcher + status/doctor/proxy/models/logs)

**Blocked by:** 06 (CLI output module, capability record and the snapshot harness (no visible change))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: —

**What to build:** The CLI entry keeps parsing, dispatch and rendering; the first command group becomes modules that take parsed args + ctx and return `{ exitCode, records }`. Importing a command module has no side effects (no argv/env reads, no `process.exit`, no module-scope I/O). Bin entry points unchanged.

**Acceptance criteria:**

- [ ] Import-without-side-effects test for each new module; exit codes asserted on `{ exitCode, records }` (seam 5).
- [ ] Existing `cli-kit`, `cli-audit` and `setup-regressions` suites pass unchanged; all snapshots byte-identical.

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

### 2026-11-06 — implementer (logged substitute for glm-5.3-flash)

**Branch:** `ticket/07-cli-command-modules-part-1` (worktree `/home/AgentKit/wt/t07`), base `50887fc` (contains 06). Commits: `dd1a223` (modules + tests) and `6eb3fb2` (merge of the integration tip `0fc27fc`, 06 re-merged; one conflict in the `package.json` test list, both sides kept: `tests/cli-commands.test.mjs` + `tests/ux-before-capture.test.mjs`). The head SHA is the commit that adds this comment. Logs: `.scratch/kit-overhaul/reports/t07-*.log` in the integration worktree.

**What landed**
- `cli/commands/{status,proxy,logs,models,doctor}.mjs`: each exports `run(args, ctx) → { exitCode, records }`. `args` is the entry's parsed `{ positional, flags, passthrough }`. `ctx` is the command ctx built by the entry: `{ kit, env, execPath, spawnSync, fetch, progress }`.
- `cli/commands/common.mjs`: `ADAPTER_IDS`, `loadAdapter`, `assertNotCheckoutWrite(kit, env)`, `managerPath`, `proxyFetch`, `keepRecords` and the record helpers. The entry now imports these instead of keeping its own copies; its inline commands call them through thin wrappers.
- `cli/zcode-kit.mjs`: keeps parsing, the dispatcher (a `COMMANDS` table checked before the remaining `switch`) and rendering (`dispatch` + `render`). `cmdStatus`, `cmdProxy`, `cmdModels`, `cmdDoctor` and `forgetDecision` were deleted from the entry. Bin entry points are unchanged.

**Tests (seam 5)**: `tests/cli-commands.test.mjs`, 26 tests, wired into `npm run test` (wiring guard green).
- Import without side effects, one test per module. The probe runs in a fresh Node process. It traps these channels: `process.env` reads (Proxy), `process.argv`, every `fs`/`fs.promises` function, `child_process`, timers, `fetch`, `process.on/once/kill/chdir/exit`, and stdout/stderr writes. Then it imports the module. A hit counts only with a `file:` frame outside the probe on the stack, so transitive kit imports count and Node's own loader does not.
- Non-vacuity: 9 fixture modules (env, argv, fs, spawn, exit, output, timer, signal, transitive env) must each be flagged, and a clean module must not be.
- Exit codes on `{ exitCode, records }`, with the manager faked at `spawnSync` and the proxy at `fetch`:
  - status: 0/1/3 passed through, no exit status → 1, `--json` forwarded;
  - proxy: usage → 2; start/stop/restart/status pass the manager's 0–5 through; no exit status → 2; `--json` forwarded for status only;
  - logs: `n` forwarded, exit kept;
  - models: proxy list; registry fallback on a refused, failing (503) or keyless request; `--json` source; `--show-key` order; an unreadable key after the list keeps the list on the error;
  - doctor: unknown `--harness` → 2; clean → 0 with the manager's text first, verbatim; manager FAIL → 1; manager timeout or non-zero without a FAIL row → 1; `--harness codex` → 1; `--json` record; `--forget` usage → 2, nothing stored → 0.
- Entry spawn tests (mini kit): usage errors go to stderr only, exit 2; `models --show-key` with no key prints the list and the stderr note before `zcode-kit: ENOENT …`, exit 2. The expected bytes were taken from the pre-split tip (`HEAD` before this ticket) on the same arguments.

**RED → GREEN**
- `t07-red1`/`red1b` (status), `t07-red2` (proxy, logs), `t07-red3` (models), `t07-red4` (doctor): every new test failed with `ERR_MODULE_NOT_FOUND` before its module existed. Green runs: `t07-green1` … `t07-green5` (26/26).
- `red1` also caught a vacuous-probe bug: the probe counted its own wrapper frame as kit code. Fixed before any module existed.
- The tests that pin behaviour that already held were proven by mutation (each restored, `cmp` clean):
  - `t07-mutant-probe`: a module-scope `process.env.ZCODE_KIT_DEBUG` read in `status.mjs` → `env.ZCODE_KIT_DEBUG`; a static `import "../heal.mjs"` in `doctor.mjs` → `argv`, `fs.realpathSync`. Both import tests fail.
  - `t07-mutant-route` (stderr records written to stdout): 2 entry tests fail.
  - `t07-mutant-errrecords` (the entry ignores `err.records`): 1 fails.
  - `t07-mutant-keep` (`models` drops `keepRecords`): 2 fail.
  - Doctor summary `—` → `-` (`t07-mutant-doctor-bytes`): cli-kit, cli-audit, setup-regressions, harness-consent, json-superset and upstream-config all stay **green** (72/72). The seam test fails (`t07-mutant-doctor-seam`), and so does `npm run test:ux-before` (`t07-before-mutant`: "36 capture(s) differ"). So the before-equivalence test exercises the module path.

**No visible change (acceptance 2)**
- `cli-kit`, `cli-audit` and `setup-regressions` are unchanged files and pass with the same counts as on the base: 39 tests, 36 pass, 3 skipped (`t07-base-cli3` → `t07-precommit`).
- `npm run test:ux-before` (`UX_CAPTURE_PORT=19070`): `t07-before1` (pre-merge, 484 s) and `t07-before-final` (merged head `6eb3fb2`, 472 s) both pass 1/1. All 7 variants and 640 captures are byte-identical, with equal exit codes. Snapshot diff: none.
- No fixture changed: no command loads `lib/term/`, and every mini-kit fixture and the capture's `KIT_FILES` copy `cli/` recursively, so `cli/commands/` is included.

**Full suites on the merged head `6eb3fb2`** (Bun 1.4.2, ticket 11 not merged; Node 26.7.0)
- `npm run test` (`t07-full-kit`): 543 tests, 532 pass, 0 fail, 11 skipped. That is the tip's 517 plus 26 new.
- `npm run test:proxy` (`t07-full-proxy`): 1343 pass, 0 fail, 90 files.
- `npm run test:mcp` (`t07-full-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged.
- `npm run test:ux-before` (`t07-before-final`): 1/1.

**Memory loop**: S3 is the only scenario through the changed entry (`zcode-kit run`). I ran S3/short on port 19071 against the base `0fc27fc` (temporary detached worktree, since removed) and against this branch:

| metric | base | after |
|---|---|---|
| peak:kit | 855.1 MB | 852.8 MB |
| procPeak:launcher | 78.4 MB | 78.4 MB |
| procPeak:mcp-bridge | 86.6 MB | 86.1 MB |
| procPeak:preflight | 71.4 MB | 72 MB |
| failed-launches | 8 | 6 |

Both runs are RED. That RED is the existing `S3/short` expected-RED entry, owned by other tickets; the 8 → 6 failed launches are run-to-run noise in that RED. No expected-RED entry belongs to this ticket. Logs: `t07-memloop-S3-base`, `t07-memloop-S3-after`.

**Decisions taken**
1. **Record kinds for the expand step.** The output module's kinds (`check`, `verdict`, …) would change the TTY bytes. So the modules return `{ kind: "text", stream, text }` (written verbatim) and `{ kind: "json", value }` (the same bytes as `console.log(JSON.stringify(v, null, 2))` and as `Out.json`). The entry renders these two kinds itself and throws on any other kind. It does not load `lib/term/`, so rendering stays lazy and the mini-kit fixtures need no copy of the shared core (the alternative named in 05/06's notes). Batches 40+ replace the text records with output-module records; the entry then needs a branch that hands those to `loadRenderRecords()`.
2. **`ctx.progress` for `doctor --fix`.** The repair log, the `transaction … recorded` line and `doctor --fix: proxy started|failed` are written as they happen, as before. They interleave with `manager start`, whose stdio is the terminal's, and records rendered at the end would reorder them. The report itself (manager text, rows, summary) is records.
3. **Records survive a throw.** Where a module fails after collecting records (an adapter `verify` that throws, an unreadable key after the `models` list, a failed `--forget` transaction), it attaches them as `err.records` (`keepRecords`). The entry prints them before `zcode-kit: <message>`, which is what the inline code printed.
4. **`heal.mjs` loads lazily in `doctor`.** Its module scope reads `process.argv[1]` and calls `realpathSync`, its own entry check. A static import would give `doctor.mjs` side effects at import time. The entry still imports `heal.mjs` statically for `setup` and the preflight, so nothing changes at run time.
5. **`logs` is its own module.** The ticket lists it, but there is no top-level `logs` command. `proxy` checks the subcommand and hands `proxy logs [n]` to `logs.mjs`.
6. **`requireHarness` inside `doctor`** returns exit 2 with the stderr line instead of calling `process.exit(2)`, which gives the same bytes and code. The entry's own `requireHarness` (used by `run` and `integrate`) is unchanged and is left for 08.

**Left for other tickets**
- 08: `pack/verify-payload.mjs` does not require `cli/commands/*.mjs` yet. Adding them changes the payload fixtures in `release-audit`/`release-marker`, which belongs with the contract step.
- 08: the remaining commands, the entry's `requireHarness`, and `usage`/`auth` (they still call the entry's `proxyFetch` wrapper).
- `term-boundaries`' `NEW_CODE` grep does not cover `cli/commands/`: those modules read no capability inputs, and the first command migrating onto `lib/term/` adds itself there, as that test's header asks.
- Observation for the controller: the fast spawn suites do not pin the doctor summary bytes. Only the 8-minute `test:ux-before` and this ticket's seam test catch a change there.

**Common acceptance**
- RED → GREEN at seam 5: ✓ (above).
- Fast suite green on ubuntu: ✓. The windows-latest `test-kit` legs, the windows `ux-before` leg and `memory-budget`: **pending CI** (orchestrator verifies on the staging branch before merging). The entry spawn tests normalise the realpath/short spelling of the temp root and use `join` for the expected path, so they should hold on Windows, but nothing here has run there.
- New test file wired: ✓. No pre-existing test changed: ✓ (only the `package.json` test list gained one entry).
- Evidence recorded: ✓. No new log events, config keys or `ZCODE_PROXY_*` overrides: n/a.

**Acceptance criteria**
- Import-without-side-effects test per new module, exit codes asserted on `{ exitCode, records }`: ✓ (`tests/cli-commands.test.mjs`; `t07-green5`, `t07-full-kit`).
- Existing `cli-kit`, `cli-audit` and `setup-regressions` pass unchanged, all snapshots byte-identical: ✓ on ubuntu (`t07-precommit`, `t07-full-kit`, `t07-before-final`); windows pending CI.
