Superseded by `issues/` (Round 5); not the tracker.

# Ticket breakdown — DRAFT (not published)

Feature: `kit-overhaul`. Source: `spec.md` (Round 4 corrections applied), `seams.md`, `DECISIONS.md` Rounds 1–4, ADR-0001–0016, `reports/architecture.md`, `reports/drift.md`, `ux/design-language.md`, `ux/ux-audit.md`.
Status: draft for the /to-tickets quiz with the Owner Proxy. On approval each ticket becomes `issues/<NN>-<slug>.md` with `Blocked by:`, `Status:`, `Model:` and `Risk:` lines (docs/agents/issue-tracker.md). Tickets 56–57 publish as `Status: needs-triage`; every other ticket publishes as `ready-for-agent`.

## How to read this draft

- **Order** = dependency order, following PROMPT §7 Phase 3 as amended (ADR-0016): (1) guardrail incl. the `memory-budget` CI job and `expected-red.json` (Round 4 D2) → (2) prefactors → (3) upgrade batches *before* the memory fixes (Round 2 Q15) → (4) memory/process fixes, each RED on the upgraded runtime → (5) UX batches, then the TUI → (6) observability → (7) docs/translations → (8) remaining CI guardrails. Ticket numbers follow that order; the **Blocked by** edges are the real gates, so the frontier is wider than the numbering (e.g. 01, 04, 50 and 57 can start at once). Ticket 58 was split out of 28 in Round 5; its number breaks the numeric order, and the `Blocked by` edges are authoritative.
- **Why the guardrail is three tickets (01–03), not one.** "Memory loop + budgets + process-count harness + Windows sampler + memory-budget CI job + expected-RED list" does not fit one fresh context window. 01 lands the loop, the budgets, the ratchet, the process-count harness and the ubuntu job. 02 adds the Windows sampler and the windows job leg, so the Bun 1.4.2 Windows reference run happens on the draft PR's first CI run (Round 3 Q9). 03 adds the S3 OMP stub-host leg. Together they are step 1, and all three are blockers of every upgrade and fix ticket.
- **Model rule.** `sol` for process lifecycle, concurrency, workers/solver isolation, streaming, the TUI renderer and migrations. `glm` for high-volume, well-scoped, mechanical work.
- **Expected-RED entries.** `expected-red.json` maps `<os leg> → "<scenario>/<variant>" → ticket number`. Ticket 01 finalises the variant names. The entries below use the loop's existing names (S1 `burst4|burst16|burst32|bigbody`, S2 `short`, S3 `short|hung`, plus the new S3 `omp`, S4–S7 `short`). A memory-fix ticket is closed only when its entries are deleted and the job is green on both legs. If an upgrade alone turns a scenario GREEN, the upgrade ticket deletes the entry and the fix ticket is re-scoped with that evidence (ADR-0016 cond 3).
- **Common acceptance for every ticket** (not repeated below): tests start RED and turn GREEN at the named seam; the fast suite and the `memory-budget` job stay green on ubuntu and windows; new test files are wired into a script (wiring guard, ticket 04); no pre-existing test changes without a justification in the ticket; evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing; every new log event uses the event-line format (ticket 14); every new config key is optional and documented in `proxy/config.example.yaml`; any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test.
- **C3 variants** = TTY colour at 80 and 120 columns, NO_COLOR, pipe, TERM=dumb, CI, ascii tier, wgl4 tier, on both OS legs.

---

## Step 1 — Guardrail

### 01. Memory loop with budgets, process-count harness, expected-RED ratchet and the ubuntu `memory-budget` job
- **Blocked by:** None (can start immediately).
- **Model:** sol · **Risk:** medium · **ADR:** 0016, 0002 (budgets), 0004 (burst budgets)
- **Delivers:** The memory loop from `diagnosis/memory` becomes committed code under the isolated-installation rules (port 18457–65000, temp HOME/state dir, mock upstream, fixture credential, `ZCODE_OVERHAUL_RUN=1` / `ZCODE_MEMLOOP_ALLOW=1`). The verdict module encodes every §18 MEMORY budget and the PROCESSES counts, the two-part S3 verdict (summed-sample maximum + per-role peaks: launcher ≤ 74, bridge ≤ 75, starter preflight ≤ 76, proxy idle ≤ 62, solver idle ≤ 20 MB), the S2/S4 solver-process checks (0 solver processes after the proxy is SIGKILLed, 0 after an idle exit, ≤ 1 per proxy at every sample) and the additive `commit_kb` sampler column (empty on Linux). `expected-red.json` (per OS leg) and its ratchet land with a `memory-budget` CI job on ubuntu (Node 26, short profile S1–S7, `systemd-run --user` scope or `prlimit`, timeout, artefacts). The 10-launch process-count test (exactly 1 proxy, 0 failed launches incl. a killed holder, 0 orphans after stop) is part of S3.
- **Acceptance:**
  - [ ] `node tests/memory/run.mjs S1…S7 --profile short` runs on the integration branch; exit codes 1 RED / 0 GREEN / 2 harness failure.
  - [ ] Pinned verdict tests (`verdict.test.mjs`) cover: slope + trend rules, role peak, per-process HWM peak, process counts, orphans, the S3 two-part verdict and role budgets, and the ratchet: a RED scenario not listed fails; a listed scenario that is GREEN fails; an unknown scenario/variant fails; a ticket id with no `issues/<NN>-*.md` file fails (seam 9).
  - [ ] `expected-red.json` lists, for `linux`: S1/burst4, S1/burst16, S1/burst32, S1/bigbody → 19; S2/short → 58; S3/short → 37; S3/hung → 16; S4/short → 17; S5/short → 30; S6/short → 32; S7/short → 34 (names as finalised here; S3/omp is added by 03; `windows` by 02).
  - [ ] The ubuntu `memory-budget` job is green with that list (all listed scenarios RED, everything else GREEN) and uploads CSV + summary artefacts; `ZCODE_MEMLOOP_ALLOW=1` is set only in this job.
  - [ ] METRICS.md records the committed-loop Linux run on Bun 1.4.2 against the Phase 1B baseline (no budget loosened).
  - [ ] After this ticket merges, the orchestrator opens the draft PR against `main` (never merged; nothing pushed to `main` or `feature/account-rotator`), and its first CI run is the one ticket 02 needs.
- **Stories:** 41, 141, 143

### 02. Windows sampler and the windows leg of the `memory-budget` job (Bun 1.4.2 reference run)
- **Blocked by:** 01
- **Model:** sol · **Risk:** high · **ADR:** 0016
- **Delivers:** The loop runs on windows-latest. One long-lived `powershell.exe -NoProfile -NonInteractive` child polls `Win32_Process` every second and is reaped on exit. Kit processes are found by the tree from the loop root plus a run-unique token in the command line or executable path. Mapping: `rss_kb` = WorkingSetSize/1024, `commit_kb` = PrivatePageCount/1024, `hwm_kb` = PeakPageFileUsage, `threads`, `fds` = HandleCount. RED rules use commit on Windows. The windows job leg runs S1, S2 (offline fixture), S3, S4, S5 and S7 under a Job Object cap and a timeout.
- **Acceptance:**
  - [ ] Self-tests on windows-latest: the units check against `Get-Process` `PrivateMemorySize64` passes; a deliberately orphaned detached process is found; the sampler excludes itself by PID and its measured overhead is recorded.
  - [ ] `expected-red.json` gains a `windows` key whose entries come from the first windows run (expected: S1 burst variants → 19, S2/short → 58, S3/short → 37, S3/hung → 16, S4/short → 17, S5/short → 30, S7/short → 34). Any scenario RED **only on commit** is raised to the owner, never adjusted silently (build-time gate 3).
  - [ ] The Bun 1.4.2 Windows reference run (the draft PR's first CI run on this code) is recorded in METRICS.md. If the sampler cannot run on the pre-upgrade code, the reason is in RUNLOG and ticket 11's 1.4.4 run becomes the reference.
  - [ ] The windows job leg is green with its list.
- **Stories:** 30, 141

### 03. S3 OMP stub-host leg in the memory loop
- **Blocked by:** 01, 02
- **Model:** sol · **Risk:** medium · **ADR:** 0013
- **Delivers:** S3 gains an `omp` variant that runs the generated OMP extension in a stub Bun host on both OS legs: 5 simultaneous hosts, and again with the starter host killed. It counts concurrent OMP preflight processes, reports each host's RSS delta (not counted as kit footprint) and asserts that each waiter host printed the starter's `cause=` lines whenever the starter's preflight emitted any (Round 4 Q1 add. 4).
- **Acceptance:**
  - [ ] Verdict tests pin the new checks: ≤ 1 concurrent OMP preflight process (5 hosts; killed starter), in-host waiter cost ≤ 5 MB per host (reported, gate), cause lines present in every waiter.
  - [ ] On today's code the variant is RED (5 preflights) on both legs, and `expected-red.json` gains `S3/omp → 35` under `linux` and `windows`.
- **Stories:** 31 (measurement), 32 (measurement)

### 04. Pre-existing findings: unwired tests, the test-wiring guard and CI Node coverage
- **Blocked by:** None (can start immediately).
- **Model:** glm · **Risk:** low
- **Delivers:** The METRICS baseline findings become fixed: `tests/update.test.mjs` and `tests/upstream-config.test.mjs` run in `npm run test`; a guard test fails when any kit `tests/*.test.mjs` file is referenced by no test script; `test-kit` runs {ubuntu-latest, windows-latest} × {Node 24, 26} instead of Node 20 (Round 1 Q14/Q19).
- **Acceptance:**
  - [ ] `npm run test` count rises by the 16 previously unwired tests, all passing.
  - [ ] The guard test goes RED when a scratch unwired test file is added in a fixture repo and GREEN on the real repo (seam 9).
  - [ ] CI shows four `test-kit` legs green with the kit, proxy and MCP suites (the proxy typecheck joins in 11).
  - [ ] METRICS.md "pre-existing findings" marked resolved with the CI run link.
- **Stories:** 139, 140

## Step 2 — Prefactors

### 05. Shared width core and token set (two renderers, one token set)
- **Blocked by:** 01
- **Model:** sol · **Risk:** medium · **ADR:** 0011, 0001
- **Delivers:** One plain-ESM width core (+ `.d.mts`) and token set (glyph tiers full/wgl4/ascii, box chrome, 16-colour roles, verdict words) living with the TUI code and used by both the CLI (Node) and the TUI (Bun). The core is grapheme-based (`Intl.Segmenter`, a W/F table generated from UCD 17, VS16/RI pairs = 2, cluster cap 2) with an ASCII/no-combining fast path. The existing width module re-exports the core, so its imports and tests keep working.
- **Acceptance:**
  - [ ] Width vectors (CJK, emoji, VS16, RI, combining, ASCII fast path) pass identically under `node --test` and `bun test` (seam 6).
  - [ ] Existing `width`/`frame` tests pass unchanged; S6 heap within budget; a frame-time benchmark (a full 2,000-line pane rendered at 80 and 120 columns, with an ASCII fixture and a mixed CJK/emoji fixture) is recorded on the ticket's base commit and after the change, and the after p95 for the ASCII fixture is ≤ 1.10 × the base p95.
  - [ ] `bun build --compile` succeeds for all five targets; `verify-payload`'s required list includes the shared files and their `.d.mts`.
  - [ ] TUI frames and the `ux/before/tui` captures are byte-identical for every fixture whose graphemes keep their width; a vector test lists each grapheme class whose width changes (VS16, RI pairs, new UCD 17 W/F ranges) and the frames that change because of it.
- **Stories:** 109

### 06. CLI output module, capability record and the snapshot harness (no visible change)
- **Blocked by:** 05
- **Model:** glm · **Risk:** medium · **ADR:** 0001, 0005, 0011
- **Delivers:** `createOutput(...) → Out` with one capability record per stream (colour precedence flag > NO_COLOR > FORCE_COLOR > CLICOLOR_FORCE > non-TTY > TERM=dumb > CLICOLOR=0; glyph tier with `ZCODE_KIT_UNICODE` override; `animate` = TTY && TERM≠dumb && !CI; width with min 40, no truncation off a TTY) and the design-language §9 primitives (`heading`, `kv`, `check`, `result`, `table`, `connection`, `verdict`, `next`, `data/json` on stdout; `error`, `warn`, `note`, `step → Progress` on stderr). The ascii copy mapping never touches the off-TTY check-row separator ` — ` or the verdict words (Round 4 D1). Rendering loads lazily. The snapshot harness renders records with forced capabilities in every C3 variant, compares bytes (ANSI included), uses an explicit normalisation list, is exempt from line-ending conversion in `.gitattributes`, and writes only with `UPDATE_SNAPSHOTS=1`. A JSON key/type baseline of every `--json` output is captured once from the pre-change code and committed.
- **Acceptance:**
  - [ ] Capability-record unit tests cover every precedence branch, including NO_COLOR beating FORCE_COLOR and non-UTF-8 POSIX locale → ascii, wgl4 on win32 without WT_SESSION/TERM_PROGRAM.
  - [ ] A regex test pins `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` with whitespace-indented `why:`/`next:` lines for `check()` off a TTY in every glyph tier (seam 5).
  - [ ] The Phase 1C BEFORE set and its tooling (`.scratch/kit-overhaul/ux/capture/` and `ux/before/`, 640 captures at 0960696) are committed under `tests/` as the step 1–2 baseline. A before-equivalence test re-runs the capture and compares byte for byte: all seven variants on ubuntu (pty via `script`); on windows-latest the pipe and ci variants, whose Windows baseline is captured from this ticket's base commit before the change and committed. This test is the proof of 'no visible change' for 06–08.
  - [ ] The JSON baseline (key names + value types) is committed; a superset test runs in `npm run test`.
  - [ ] No module other than the output module reads `isTTY`, `NO_COLOR`, `TERM`, `CI` or `columns` in code this ticket touches (grep test for new code).
  - [ ] A scan asserts that no ESC byte appears in any NO_COLOR, pipe, TERM=dumb or CI render of the primitives' fixtures (Story 107).
- **Stories:** 89, 106, 107, 108, 123

### 07. CLI command-module split, part 1 (expand: dispatcher + status/doctor/proxy/models/logs)
- **Blocked by:** 06
- **Model:** glm · **Risk:** medium · **ADR:** —
- **Delivers:** The CLI entry keeps parsing, dispatch and rendering; the first command group becomes modules that take parsed args + ctx and return `{ exitCode, records }`. Importing a command module has no side effects (no argv/env reads, no `process.exit`, no module-scope I/O). Bin entry points unchanged.
- **Acceptance:**
  - [ ] Import-without-side-effects test for each new module; exit codes asserted on `{ exitCode, records }` (seam 5).
  - [ ] Existing `cli-kit`, `cli-audit` and `setup-regressions` suites pass unchanged; all snapshots byte-identical.
- **Stories:** 61 (CLI contracts kept)

### 08. CLI command-module split, part 2 (migrate remaining commands + contract)
- **Blocked by:** 07, 10
- **Model:** glm · **Risk:** medium · **ADR:** —
- **Delivers:** `setup`, `integrate`, `update`, `rollback`, `uninstall`, `accounts`, `auth`, `run`, help and the rest move to command modules; the inline command bodies in the CLI entry are deleted (contract).
- **Acceptance:**
  - [ ] Every command dispatches through a module; the CLI entry has no command bodies left (structural test).
  - [ ] All spawn suites and snapshots unchanged; exit codes 0, 1, 2, 3, 4, 5, 20, 130 asserted per command where they occur today.
- **Stories:** 61 (CLI contracts kept)

## Step 3 — Upgrade batches (before the memory fixes; ADR-0016)

### 09. Batch 1a — CI toolchain: actions v7, Bun 1.4.4 in CI, nested proxy workflows removed
- **Blocked by:** 02, 03, 04
- **Model:** glm · **Risk:** low · **ADR:** 0006, 0016
- **Delivers:** `actions/checkout@v7`, `actions/setup-node@v7`, `oven-sh/setup-bun@v2`; Bun 1.4.4 in `ci.yml`, `release.yml` and the `memory-budget` job; the three nested vendored proxy workflows deleted with a MANIFEST vendor-change entry; `release.yml` changes only in versions, runs on Node 26, publish job keeps Node 24 for OIDC.
- **Acceptance:**
  - [ ] All CI legs and both `memory-budget` legs green on Bun 1.4.4 with the unchanged `expected-red.json` (any entry turned GREEN by the runtime alone is deleted here, with evidence, and its fix ticket re-scoped).
  - [ ] A release-audit test asserts the pins (no `bun-version: 1.4.2`/`1.4.0`, no `node-version: 20`) (seam 9).
- **Stories:** 126, 140

### 10. Batch 1b — Node 24 support floor, refuse before mutation, autostart Node-path check
- **Blocked by:** 09
- **Model:** glm · **Risk:** medium · **ADR:** 0006
- **Delivers:** `engines.node >=24` in all three manifests; `install.sh`, `install.ps1` and the pack build gate at 24 with the exact upgrade step; `setup`/`update` on Node < 24 refuse before mutating state (what/why/next) and leave the installation working; the preflight reports when the OMP autostart's pinned Node path is below the floor or missing; DEP0190 in the pack build fixed.
- **Acceptance:**
  - [ ] Temp-HOME installer fixtures (seam 8): fake Node v20 and v22 are rejected before any file changes (state dir byte-compared before/after); v24 and v26 pass; installer tests' fake versions moved to 24/26.
  - [ ] Preflight fixture: pinned autostart Node v22 → WARN with the next command; missing path → WARN; v24+ → silent (seam 8).
  - [ ] Pack build runs with no DEP0190 warning.
- **Stories:** 124, 125

### 11. Batch 1c — Bun 1.4.4 bootstrap in the installers, pinned proxy typecheck, 1.4.4 attribution runs
- **Blocked by:** 10
- **Model:** glm · **Risk:** medium · **ADR:** 0006, 0016
- **Delivers:** Both installers bootstrap Bun 1.4.4 with the five upstream SHA-256s (linux-x64, linux-aarch64, darwin-x64, darwin-aarch64, windows-x64) from the primary source. The proxy typecheck runs in root CI through a pinned proxy `typescript` devDependency and `@types/bun` 1.4.4 exact; its baseline is recorded first and every failure becomes a ticket. The memory loop's short profile re-runs on 1.4.4 on both legs (the Windows attribution run).
- **Acceptance:**
  - [ ] Installer tests assert the five hashes and reject a tampered download (seam 8).
  - [ ] `test-kit` legs include the proxy typecheck through the pinned devDependency, never an unpinned `bun x`. Its baseline error list is recorded before any fix. If the list is non-empty, the step compares against a committed expected-error list with the same ratchet as `expected-red.json` (a new error fails; a listed error that disappears fails until it is removed), and each listed error names a filed ticket.
  - [ ] METRICS.md records the Linux and Windows 1.4.4 attribution runs next to the 1.4.2 reference; typecheck-baseline failures (if any) are filed as tickets (build-time gate 7).
- **Stories:** 126, 140

### 12. Batch 2 — proxy dependencies: happy-dom 21.0.4 (loading flags kept), undici 8.12.4, yaml 2.9.1
- **Blocked by:** 11
- **Model:** glm · **Risk:** medium · **ADR:** 0007
- **Delivers:** happy-dom `^21.0.4` with `enableCSSFileLoading: true` and `enableIframePageLoading: true` (surface unchanged, not stricter), undici `^8.12.4`, yaml `^2.9.1`. The captcha suite runs green right after the happy-dom bump, before any other captcha-path change.
- **Acceptance:**
  - [ ] `captcha-happy`, `captcha-solver`, `captcha-cdn-cache` suites green on the happy-dom commit alone; full `test:proxy` green after the batch.
  - [ ] `bun audit` shows the happy-dom/undici advisories from drift.md resolved.
  - [ ] Both `memory-budget` legs green (entries handled as in 09).
  - [ ] A test asserts that the happy-dom Window is constructed with `enableCSSFileLoading: true` and `enableIframePageLoading: true`, and fails if either flag is removed (ADR-0007, B1).
- **Stories:** 127, 128

### 13. Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24
- **Blocked by:** 12
- **Model:** glm · **Risk:** medium · **ADR:** 0006
- **Delivers:** `@modelcontextprotocol/sdk ^1.32.2`, `zod ^4.6.6` declared, TypeScript `7.0.2` exact (fallback `6.0.3` with the reason), `@types/node ^24`; both MCP lockfiles and `dist/` regenerated by the build and committed, TS 7 output diff reviewed; staying on protocol 2025-11-25 and SDK 1.x documented as a deliberate stay-back.
- **Acceptance:**
  - [ ] `npm run test:mcp` green; `tsc` build clean; `git status` clean after a rebuild (dist matches).
  - [ ] `npm audit` in the bridge shows the drift.md advisories (incl. the critical one) resolved.
  - [ ] The stay-back note exists in the bridge docs; ticket 56 is filed.
- **Stories:** 128, 129

## Step 4 — Memory and process fixes (each RED on the upgraded runtime)

### 14. Event-line format and redaction for new log events (prefactor)
- **Blocked by:** None (can start immediately).
- **Model:** glm · **Risk:** low · **ADR:** 0010
- **Delivers:** One small logger for new event lines, `ISO-time LEVEL component message key=value…`, in the proxy (TS) and the manager (mjs), with redaction applied to all lines. Existing lines stay byte-identical. Every later ticket's new events (memory, recycle, shed, supervisor, lock takeover, rotation WARN, respawn ERROR) use it.
- **Acceptance:**
  - [ ] Unit tests: format, key escaping, redaction of keys/tokens (incl. a stop-token-shaped value) in old and new lines.
  - [ ] Golden-path classifier and existing log-reading tests unchanged.
- **Stories:** 88

### 15. Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets)
- **Blocked by:** 08, 13, 14
- **Model:** sol · **Risk:** high · **ADR:** 0003, 0012
- **Delivers:** One deep module owns start, stop, restart, status, the start lock, takeover hooks, orphan adoption, respawn requests and the restart budget. Its interface is the lifecycle intents (ensure running, stop, restart, budgeted respawn request, read state); intents print nothing and return outcome records. Every caller uses it: CLI commands, preflight, `run`, the OMP extension through the preflight, update, setup, the account change (`restartForAccountChange`), `doctor --fix` and the respawn hook. The preflight path imports no presentation code. `createManager({ root, home, processStartMsImpl, … })` stays the injection seam. Frozen: manager CLI commands, exit codes 0–5 and output (incl. its own legacy `doctor`), OMP exit mapping 3 → foreign / 5 → key, the `ZCODE_KIT_RESPAWN_MANAGER` path, `respawn <pid> --reason <r>`.
- **Acceptance:**
  - [ ] `manager-safety`, `manager-audit` and the golden-path script pass unchanged (seam 2).
  - [ ] Module-graph test: the preflight entry's import closure contains no output/presentation module.
  - [ ] S3 starter-preflight role peak ≤ 76 MB (loop), recorded vs baseline 55–73 MB.
  - [ ] An old proxy (origin/main) calling the new manager's `respawn` CLI works (spawned test).
- **Stories:** 61

### 16. Start lock protocol v1 with proven takeover (no judge-then-rename race)
- **Blocked by:** 15
- **Model:** sol · **Risk:** high · **ADR:** 0003, 0012
- **Delivers:** New locks add a protocol version and the holder's process start time, written atomically. Takeover only on proof (holder dead, or PID reused: live start time differs; v0: later than `startedAt`). The race is closed (moved record checked against the judged one, or an exclusive side-lock with pid + start-time proof). A live holder's lock is never touched; unparsable or unknown-higher-version locks are never deleted and are reported with what/why/next and the exact path. Old kits read only `pid`/`startedAt`. AUD-001 comments updated with the implementation. The takeover logs one event line.
- **Acceptance:**
  - [ ] Takeover race test: N contenders with a kill injected at every protocol step → never two holders, never a deleted live lock (seam 2, real time).
  - [ ] v0 lock recovery; unreadable/unknown-version lock untouched with the error block; old-manager interop test against the origin/main manager.
  - [ ] Lock-version migration replayed twice is a no-op the second time.
  - [ ] Loop: S3 killed-holder round → 0 failed launches, 0 stale locks, exactly 1 proxy. **Delete `S3/hung` (linux, windows) from `expected-red.json`.**
  - [ ] A kill injected during the lock write leaves either no lock file or a complete, parsable record, never a partial one, on both legs (Story 48).
- **Stories:** 41, 42, 43, 46, 47, 48, 135

### 17. Start-lock release on signals, orphan adoption, respawn over a proven-stale lock
- **Blocked by:** 16
- **Model:** sol · **Risk:** high · **ADR:** 0003
- **Delivers:** A holder releases its own lock on SIGINT, SIGTERM, SIGHUP, and on Windows SIGBREAK and console close, only while the on-disk record is still its own. The next start adopts an orphaned proxy through the identity proof and never spawns a second one. Respawn treats a proven-stale lock as takeable, so the proxy is up after a respawn that met a stale lock. Every child is reaped on stop/restart/crash/update.
- **Acceptance:**
  - [ ] Seam 2 tests per signal (POSIX) and SIGBREAK/console-close paths (windows-latest); orphan adoption → exactly 1 proxy.
  - [ ] Loop S4: 0 stale locks after Ctrl-C during start (baseline 5/8); respawn with a stale lock → proxy up; 50 cycles → 0 orphans, log-dir files ≤ 8. **Delete `S4/short` (linux, windows).**
  - [ ] A2 (real PowerShell/conhost Ctrl-C) listed as an owner action, marked unverified.
  - [ ] Adversarial: a holder whose lock was taken over (the on-disk record is no longer its own) leaves the new holder's lock untouched on SIGINT and SIGTERM.
- **Stories:** 44, 45, 60

### 18. Per-spawn proxy environment: stop token and log dir set by the manager, token stripped from the respawn hook
- **Blocked by:** 15, 21
- **Model:** sol · **Risk:** medium · **ADR:** 0014 (Round 4 amendment), 0015 (Round 4 amendment)
- **Delivers:** At every proxy spawn the manager sets `ZCODE_KIT_STOP_TOKEN` (fresh 256-bit token, also written as an additive field in `proxy.pid`) and `ZCODE_KIT_LOG_DIR` (its own logs dir), overwriting inherited values. The proxy removes the token from the respawn hook's environment. `ZCODE_KIT_LOG_DIR` is internal; a proxy without it keeps today's behaviour. The token never appears in logs, status, JSON, doctor, snapshots or error text.
- **Acceptance:**
  - [ ] `proxy-env` suite (seam 8): ambient bogus values for both variables → the spawned proxy gets the manager's logs dir and a new token; the respawn hook's environment has no stop token.
  - [ ] Seam 2: the token in the proxy's environment equals the one in `proxy.pid`; two consecutive spawns get different tokens; `proxy.pid` written with owner-only mode.
  - [ ] Redaction test: the token value appears in no captured output of `status`, `--json`, `doctor` or logs.
- **Stories:** 55, 56

### 19. Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract
- **Blocked by:** 13, 14
- **Model:** sol · **Risk:** high · **ADR:** 0004
- **Delivers:** In-flight bytes count from body read until sent upstream, capped at 64 MB (config key + `proxyEnv` exception env override). Queued requests have unread bodies (socket backpressure); the queue is FIFO, bounded by a documented count and 15 s. Overflow/timeout sheds HTTP 503 + `Retry-After` in the endpoint's own shape (OpenAI `error` object; Anthropic `overloaded_error`), never 429, never a reset. Open response streams are not limited. The shed helper is reused by the supervisor (21) and the solver fail-fast (28). Admission counters (`inFlightBytes`, `queued`, `shedTotal`) are exposed internally for 39.
- **Acceptance:**
  - [ ] Loopback tests (seam 4): byte cap holds; queued bodies unread (server-side read counter); FIFO order; count bound and 15 s bound each shed with the right shape per endpoint; no 429 anywhere; 17+ concurrent streams not limited.
  - [ ] Loop S1 burst: HWM ≤ 400 MB at 16 and ≤ 600 MB at 32 × 10.8 MB bodies (≥ 30 % peak improvement); bigbody within budget. **Delete `S1/burst4`, `S1/burst16`, `S1/burst32`, `S1/bigbody` (linux, windows).**
  - [ ] Config key documented in `config.example.yaml`; invalid value rejected with what/why/next.
  - [ ] Adversarial (C2): with nothing else in flight, a single request at today's maximum body size (32 MB wire, `handler.ts:859`; 64 MB inflated, `handler.ts:894`) is admitted and served, never shed. The cap rule is 'admit when in-flight bytes + this request ≤ cap, or when in-flight bytes are 0'. The ticket states how a body without `Content-Length` is accounted, and tests that the cap holds for concurrent chunked bodies.
- **Stories:** 21, 22, 23, 24

### 20. Fewer redundant request-body copies (bytes upstream unchanged)
- **Blocked by:** 19
- **Model:** sol · **Risk:** medium · **ADR:** 0004
- **Delivers:** The redundant body copies identified in research (undici-yaml §5) are removed one by one, each measured; the bytes sent upstream are byte-identical.
- **Acceptance:**
  - [ ] `protocol-contract`/`handler-resilience` assert byte-identical upstream bodies for each endpoint shape (seam 4).
  - [ ] Per-copy RSS-per-MB-in-flight delta recorded in METRICS (baseline ~4.5 MB RSS per MB); S1 stays GREEN on both legs.
- **Stories:** 25

### 21. Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB
- **Blocked by:** 19, 14
- **Model:** sol · **Risk:** high · **ADR:** 0008
- **Delivers:** One supervisor module owns heartbeat/watcher (`watchdogStep` stays its pure core, SAB heartbeat kept), memory sampling (`memoryFootprint`, RSS fallback), the single graceful shutdown sequence (used by SIGINT/SIGTERM, later the stop request, the memory respawn and update) and the respawn handoff point. Thresholds: soft 512 MB / hard 1024 MB × 3 samples 15 s apart, configurable. Soft only WARNs and logs (no solver recycle). Without a manager hook (TUI, standalone) the supervisor logs and keeps serving. During the drain the listener stays open, new requests are shed (19's contract), in-flight requests get the drain window, streams cut at the force point are counted in one log line. Lifecycle closures leave the proxy entry point.
- **Acceptance:**
  - [ ] `health-monitor`/`watchdog` module tests with an injected sampler: soft → WARN only; hard ×3 → respawn request; thresholds from config; no hook → log + keep serving.
  - [ ] Loopback drain test (seam 4): new requests during the drain get 503 + `Retry-After`, the listener stays open, an in-flight request completes, cut streams counted.
  - [ ] Config keys documented; release-notes item "1536/3072 → 512/1024 MB" noted for 54.
  - [ ] Adversarial: two consecutive samples above hard followed by one below → no respawn request; samples are 15 s apart (injected clock); a soft breach never recycles the solver.
- **Stories:** 26, 27, 28, 52

### 22. Graceful stop request `POST /__kit/stop`, shared deadlines and the manager's stop path
- **Blocked by:** 18, 21, 40
- **Model:** sol · **Risk:** high · **ADR:** 0014
- **Delivers:** The route sits after Host, Origin and bearer checks and requires the stop-token header; both compared in constant time incl. length; no CORS allowance; without a token it answers the unknown-route `404 not_found_error`. No body, bypasses admission, answers 202 before the drain, triggers the single graceful sequence. One shared module holds `STOP_GRACE_MS = 10_000` and `STOP_EXIT_MARGIN_MS`; the manager forces only after both. The manager sends the request on Windows and POSIX after the identity proof; POSIX falls back to SIGTERM on 404/401/403/connection error, Windows to `TerminateProcess`. `recoverHung`, startup timeout, foreign-port paths and golden-path crash injection force directly through an explicit force helper. `proxy stop`/`restart` show progress on a TTY, line-based elsewhere.
- **Acceptance:**
  - [ ] Seam 4: auth order (Host/Origin/bearer before token), wrong/short/long token rejected, 404 without a token, 202, bypass while the byte cap is saturated, listener open during drain.
  - [ ] Seam 2: fallbacks per status/OS against an old proxy; force paths never send the request; deadline test (manager force point > proxy deadline; respawn wait 30 s > 10 s + grace + margin).
  - [ ] windows-latest: `proxy stop` runs the account-metadata flush (marker in the log) — build-time gate 5.
  - [ ] Snapshot for the stop/restart progress (TTY) and line mode.
- **Stories:** 54, 55, 57, 58, 59

### 23. Respawn acknowledgement before drain (a refused respawn leaves the proxy serving)
- **Blocked by:** 17, 18, 21
- **Model:** sol · **Risk:** high · **ADR:** 0015, 0008
- **Delivers:** On a memory respawn the proxy spawns the hook with unchanged arguments and waits up to 10 s for a `respawn.json` event with `pid === process.pid` and `at` > request time; hook exit 4 is an immediate refusal; afterwards the hook is unref'd. On refusal or no acknowledgement it keeps serving, logs ERROR once, reports `restarts` exhausted and spawns at most one hook per budget window. The watchdog path waits ≤ 10 s, then self-terminates and logs the outcome. Old proxies with a new manager keep today's behaviour (documented).
- **Acceptance:**
  - [ ] Seam 2/4 tests: ack → drain; exit 4 → keep serving + one ERROR; no ack → keep serving; late ack → "already running, 0", exactly 1 proxy, slot consumed; backwards clock jump → keep serving; watchdog path bounded at 10 s.
  - [ ] Loop: induced memory pressure → ≤ 3 restarts / 15 min and exactly 1 proxy at every sample.
  - [ ] With the hard condition persisting over two budget windows and every respawn refused, exactly one hook is spawned per window (injected clock, spawn counter) (Story 50).
- **Stories:** 49, 50, 51, 53

### 24. Solver transport seam (prefactor): dispatcher state as an object, thread transport adapter
- **Blocked by:** 12
- **Model:** sol · **Risk:** medium · **ADR:** 0002
- **Delivers:** The dispatcher interface (`runCaptchaSolve`, stats, recycle request, shutdown) and message protocol stay; module-level state becomes an object owned by the deep module; the current Worker moves behind a transport seam as the thread transport. No behaviour change.
- **Acceptance:**
  - [ ] `captcha-solver` suite with fixture backends passes unchanged through the seam (seam 3); `captcha-pool` no longer needs `mock.module` for the solver.
  - [ ] S2 per-generation HWM and retained MB within ±10 % of the preceding run on the same leg (loop).
- **Stories:** 17

### 25. Bounded-collection module; CDN memory cache and stall counters bounded
- **Blocked by:** 12
- **Model:** glm · **Risk:** medium · **ADR:** 0009
- **Delivers:** The responses store's LRU/TTL/byte-budget/injected-clock logic is lifted into one module (responses store behaviour and tests unchanged). The CDN memory cache is bounded to ≤ 64 MB and ≤ 256 entries and resets with each solver generation; stall counters to 1,024 entries, count only, oldest first, no TTL. Dead `solveTimes` deleted. The bytes served do not change (B1).
- **Acceptance:**
  - [ ] Seam 6: eviction by count, bytes and TTL with a fake clock; responses-store suite unchanged.
  - [ ] Seam 3: CDN memory and stall bounds hold inside one generation.
  - [ ] Loop S2: CDN memory ≤ 64 MB (baseline +151 MB / 600 URLs). The `S2/short` entry stays until 58 (solver part still RED).
  - [ ] Seam 3 (B1): for a recorded sequence of stalls and solves below 1,024 URLs, the CDN invalidation decisions (which pe URLs are evicted, and when) are identical to the pre-change code.
- **Stories:** 62, 65

### 26. Captcha egress routing under Bun
- **Blocked by:** 12
- **Model:** glm · **Risk:** medium · **ADR:** —
- **Delivers:** On Bun, captcha fetches (`captchaFetch` and the sync-XHR worker path) use `proxy: <ZCODE_PROXY_UPSTREAM_PROXY> ?? false`; Node keeps the dispatcher. Routing only; what is fetched does not change.
- **Acceptance:**
  - [ ] Seam 3 test with a local recording proxy: set → all captcha egress goes through it; unset with ambient `HTTP(S)_PROXY` set → no proxy used.
- **Stories:** 130

### 27. Solver as a child process: spawn, environment parity, lazy start, idle exit, one generation
- **Blocked by:** 24, 18, 26
- **Model:** sol · **Risk:** high · **ADR:** 0002
- **Delivers:** The child-process adapter becomes the default. From source it starts from `process.execPath` + the solver entry; compiled builds use a self-exec subcommand (never `-e`). Environment parity: `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA`, CDN cache variables and the egress setting pass; `ZCODE_KIT_RESPAWN_*` and `ZCODE_KIT_STOP_TOKEN` are excluded; the guest error boundary is installed; the child never runs the watchdog or the respawn hook. Child stdout/stderr are piped to the parent and re-emitted line by line on the parent's stdout/stderr, content unchanged (33 routes those streams through the size-capped writer). One generation at a time (old exited or killed after a bounded grace before the next spawns). POSIX child exits on IPC EOF. Lazy spawn on the first solve, idle exit after 10 min (not abnormal), prewarm off. Solve inputs, outputs and the 90 s deadline unchanged.
- **Acceptance:**
  - [ ] Seam 3: byte-identical solve I/O on both adapters; spawn from source and compiled (compiled binary test on Linux); env parity and stripping; one-generation ordering.
  - [ ] Seam 1 (loop S2/S4): 0 solver processes after the proxy is SIGKILLed (POSIX), 0 after an idle exit, ≤ 1 per proxy at every sample.
  - [ ] Cold start (spawn + handshake + module load) measured on Linux and Windows, ≤ 4.5 s, recorded in METRICS (build-time gate 4; a miss returns as a finding, the deadline is not moved).
  - [ ] Loop S3: solver idle 0 MB when never used.
  - [ ] Seam 3: a child line (for example `[pe-cache-evict] …`) appears byte-identical on the parent's stderr; a solve dispatched during the child's cold start fails at 90 s from dispatch, not from child readiness (injected clock); the compiled-binary self-exec spawn test also runs on windows-latest (C7).
- **Stories:** 1, 7, 8, 9, 17, 18, 19, 20

### 28. Solver cap enforcement per OS and the cap handshake
- **Blocked by:** 27
- **Model:** sol · **Risk:** high · **ADR:** 0002
- **Delivers:** Windows: Job Object via `bun:ffi` with `JOB_OBJECT_LIMIT_PROCESS_MEMORY` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, no new dependency. Linux: user-systemd cgroup v2 scope with `MemoryMax=` and `MemorySwapMax=0`, verified by reading the scope's `memory.max`, else `sampling`. macOS: `sampling` (footprint sampling and kill). Enforcement mode `job-object|cgroup|sampling|none` (`none` = thread transport or caps off), exposed through the dispatcher stats for 39. The child loads neither happy-dom nor solve code until the handshake confirms the cap. Cap 300 MB by default; the `config.yaml` key is validated at config load against a documented minimum (what/why/next). A cap kill is logged as an event line naming the key that raises the cap. An idle exit releases the cap container (Job Object closed, scope ended).
- **Acceptance:**
  - [ ] Seam 3: handshake ordering: no heavy module is loaded before the cap acknowledgement (module-load probe in the child); a child whose acknowledgement never arrives is killed and never solves.
  - [ ] Seam 1/3 (adversarial, the cap's purpose): a fixture backend that allocates past the cap is killed by the active mode on each leg (`job-object` on windows-latest; `cgroup` on ubuntu where the memory controller is delegated, otherwise `sampling`), and the kill line names the config key.
  - [ ] Adversarial (never claim a cap that is not there): with the memory controller not delegated (simulated: the scope's `memory.max` missing or not equal to the requested value), the mode is `sampling`, never `cgroup`.
  - [ ] Seam 1: after an idle exit, the scope no longer exists (Linux) or the Job Object handle is closed (Windows), and 0 solver processes remain. Windows leg: Job Object reaping after the proxy is SIGKILLed → 0 solver processes (build-time gate 5).
  - [ ] Config validation: a value below the documented minimum is rejected at load with what/why/next; the default is 300 MB.
  - [ ] A1 (live vendor-SDK solve under 300 MB) recorded as an owner action, marked unverified.
- **Stories:** 2, 3, 4, 5, 8, 10, 15, 16, 60

### 58. Solver recycle triggers and failure semantics (abnormal-exit budget, fail-fast shed)
- **Blocked by:** 19, 25, 28
- **Model:** sol · **Risk:** high · **ADR:** 0002, 0004
- **Delivers:** Recycle: footprint at 80 % of the configured cap (240 MB at 300), read from the child's own report after each solve; count backstop 100 (was 200); the failure, idle, request and deadline triggers are kept; the in-worker 768 MB heap trigger is removed or re-based below the cap. Failure: a crash, cap kill, fatal error or deadline kill fails only the in-flight solve with `CaptchaSdkError("other", …)`, and the queue is pumped onto the next generation. Only these abnormal exits count toward 5 per 10 min, after which solves fail fast with 503 + `Retry-After` = the time until the window reopens (19's shed helper). Planned recycles (count, footprint, idle, request, shutdown) never count. No solve is resubmitted. The solver queue's caller-side bound (one in-flight solve per pool, the `captcha-pool` clamp) is stated with evidence and pinned; a count bound + ADR-0004 shed is added only if none can be shown. The fail-fast state and its window end are exposed through the dispatcher stats for 39.
- **Acceptance:**
  - [ ] Seam 3: each recycle trigger fires at its threshold and not below it (footprint 239 vs 241 MB at cap 300; count 99 vs 100); planned recycles never increment the abnormal-exit count; once the 5-per-10-min budget is used up, the next abnormal exit enters fail-fast, and the shed has the endpoint's error shape and `Retry-After` = seconds until the window reopens; after the window a solve succeeds (injected clock).
  - [ ] Seam 3 (adversarial, "fail only the solve in flight"): a crash with one solve in flight and one queued fails only the in-flight solve, with the existing error and category; the queued solve completes on the next generation; the backend's call count shows that no solve was resubmitted.
  - [ ] Seam 3: the queue-bound test.
  - [ ] Loop S2: per-generation cost ≤ 300 MB, retained before recycle ≤ 300 MB, hung-solve reclaim ≤ 64 MB, one generation at a time. **Delete `S2/short` (linux, windows).**
- **Stories:** 6, 11, 12, 13, 14

### 29. CDN disk cache pruning
- **Blocked by:** 25
- **Model:** sol · **Risk:** medium · **ADR:** 0009
- **Delivers:** The disk cache stays ≤ 256 MB (oldest first), pruning only entries already expired at max(14 days, configured TTL), at start and after each write, skipping temp files and files being written, tolerating `ENOENT`, safe with several installations sharing the directory.
- **Acceptance:**
  - [ ] Temp-dir tests (seam 3/6): size bound, expiry-only pruning, temp/in-progress files skipped, concurrent pruners with vanishing files never throw or corrupt.
  - [ ] Retention-pruning migration replayed twice is a no-op.
  - [ ] An entry 15 days old under a configured TTL of 20 days is kept; an entry 21 days old is pruned (Round 2 Q3 condition 2).
- **Stories:** 63, 64, 135

### 30. MCP task retention (500 / 7 days) and the idempotency window
- **Blocked by:** 13
- **Model:** sol · **Risk:** high · **ADR:** 0009
- **Delivers:** Terminal tasks are evicted at > 500 or > 7 days, whichever first; running tasks never; `*.result.json` pruned with the task; startup restore loads only retained tasks; the idempotency key is forgotten on eviction; an evicted task gives the existing not-found error. The tool description carries the idempotency sentence.
- **Acceptance:**
  - [ ] Seam 7 (MCP client + fake harness): eviction by count and age with an injected clock, non-terminal kept, files pruned, restore loads only retained, not-found and new-task-on-reused-key after eviction.
  - [ ] Loop S5: growth ≤ 5 %/1k, reboot cost of history ≤ 20 MB, 0 task failures. **Delete `S5/short` (linux, windows).**
  - [ ] Retention migration replayed twice.
- **Stories:** 66, 67, 68, 135

### 31. Per-task caps and 4 MiB head/tail truncation of task text
- **Blocked by:** 30
- **Model:** sol · **Risk:** medium · **ADR:** 0009
- **Delivers:** Per-task warnings 200, errors 200, tool calls 1,000. Response text bounded during ingestion at 4 MiB UTF-8 (head 1 MiB frozen, rolling 3 MiB tail, dropped-byte count) with one `[… N bytes truncated …]` marker cut on code-point boundaries; `completeness: partial` with the note merged after the terminal-state override; additive `truncated: { droppedBytes }`; the transcript fallback gets the same cap; results cached before the change are served as stored. Tool description and `docs/MCP_API.md` describe cap, marker, field and idempotency window; `dist/` regenerated by the build.
- **Acceptance:**
  - [ ] Seam 7: caps, truncation boundaries (multi-byte at both cuts), marker count = 1, `completeness`/`truncated`, terminal override cannot erase the note, old cached result byte-identical.
  - [ ] `security-audit` completeness assertions extended, not weakened; S5 stays GREEN.
- **Stories:** 69, 70, 71, 72

### 32. TUI log pane capped at 2,000 lines and 8 MB
- **Blocked by:** 05, 11
- **Model:** glm · **Risk:** low · **ADR:** 0009
- **Delivers:** The log pane enforces a byte cap (8 MB) in addition to its 2,000-line cap.
- **Acceptance:**
  - [ ] Seam 6: `log-pane` tests for line and byte caps with 64 KB lines.
  - [ ] Loop S6: log pane ≤ 16 MB heap with 64 KB lines, resize storm ≤ 8 MB, frame time unchanged. **Delete `S6/short` (linux).**
  - [ ] A single line larger than 8 MB never makes the pane exceed 8 MB (the line is truncated or dropped; the ticket states which).
- **Stories:** 73

### 33. `proxy.log` single rotator: size-capped writer, manager rotation under the lock, file modes
- **Blocked by:** 14, 16, 18, 21
- **Model:** sol · **Risk:** high · **ADR:** 0009, 0015
- **Delivers:** While it runs, the proxy opens `proxy.log` (path from `ZCODE_KIT_LOG_DIR`) through a size-capped writer: rotation at 5 MB keeping one `proxy.log.1` (unlink `.1` → rename → reopen), plain fd writes, console/stdout/stderr through it, line content unchanged. A foreign handle blocking the rename → keep appending, retry each check, one WARN event. The manager keeps `[manager <ISO>] …` lines and rotates only under the start lock with no live recorded proxy (today's pre-lock rotation removed). Every creator of a log-dir file uses `0o600` and the logs dir `0o700` (manager, proxy writer on open/reopen; the watchdog's by-path append is added by 34). `proxy logs N` reads `.1` + current.
- **Acceptance:**
  - [ ] Seam 4: rotation at 5 MB with kit readers and appenders open; foreign-handle case (windows-latest: rename with an open reader, build-time gate 5); one WARN; no line lost.
  - [ ] Seam 2: manager rotation only under the lock and with no live proxy; file modes on every created file (POSIX); `proxy logs N` across `proxy.log.1` and `proxy.log`.
  - [ ] Loop S7: `proxy.log` ≤ 6 MB while running. The `S7/short` entry stays until 34.
  - [ ] Seam 4: after the writer opens, a line written to `process.stdout` and one written to `process.stderr` appear unchanged in `proxy.log`.
- **Stories:** 74, 75, 77, 78, 79

### 34. Early log (`proxy.early.log`): 1 MB cap and the tail copy into `proxy.log`
- **Blocked by:** 33
- **Model:** sol · **Risk:** medium · **ADR:** 0009
- **Delivers:** Inherited stdio goes to the early log, truncated at each start and capped at 1 MB by the proxy's writer (truncate in place after a marker event). Before any truncation of a non-empty early log the manager appends its last 64 KB to `proxy.log` behind a marker line (start failure, respawn, crash). The golden-path classifier keeps reading only `proxy.log`. Watchdog lines may be appended to `proxy.log` by path (`0o600`).
- **Acceptance:**
  - [ ] Seam 4: cap enforcement with bounded overshoot; marker event.
  - [ ] Seam 2: tail copy before every truncation path; the golden-path classifier finds a crash cause through the tail-copy marker (Round 4 Q1 add. 5).
  - [ ] Loop S7: early log ≤ 1 MB + bounded overshoot. **Delete `S7/short` (linux, windows).**
  - [ ] Seam 2/4 (POSIX): a watchdog by-path append that creates `proxy.log` creates it with mode `0o600`.
- **Stories:** 76, 78

### 35. OMP in-host single-flight preflight with the cause-line result record
- **Blocked by:** 03, 15, 33
- **Model:** sol · **Risk:** high · **ADR:** 0013 (Round 4 amendment)
- **Delivers:** The generated OMP extension takes an O_EXCL autostart token (host pid + start time + per-attempt nonce) in the logs dir before spawning a preflight. Other hosts wait in-host (stat poll + existing `healthy()` fetch, no process), never past `START_TIMEOUT_MS`. Released in `finally`; stale tokens (holder dead, or older than `START_TIMEOUT_MS`) taken over by proof. The starter writes the result record by temp + rename (`0o600`) on every outcome before releasing the token; it holds only the exit code and fixed-vocabulary `cause=` lines (≤ 4 KB / ≤ 16 lines). A waiter accepts it only if its identity matches the observed token and it is not older than its wait start; validates each line before printing; treats a missing/stale/corrupt/oversized record as a starter failure and takes over with its own preflight. One fixed-name file, overwritten per attempt, never deleted by waiters. Old extensions are unaffected. Existing installs get the new extension on the next `setup`/`integrate`.
- **Acceptance:**
  - [ ] Seam 8 (generated-logic fixtures): write-before-release; identity match; stale record from an earlier start never printed; corrupt and oversized records → takeover; vocabulary validation; file mode.
  - [ ] Seam 1 (S3 omp leg): ≤ 1 concurrent preflight with 5 hosts and with the starter killed; every waiter printed the starter's cause lines; waiter cost ≤ 5 MB per host; log-dir files ≤ 8 in S4. The S3 omp leg runs on both legs. **Delete `S3/omp` (linux, windows).**
  - [ ] Extension refresh replayed twice through the transaction is a no-op.
  - [ ] Seam 8 (adversarial): a live starter's token is never taken over; a token whose holder is dead, or that is older than `START_TIMEOUT_MS`, is taken over by proof; a waiter never waits longer than `START_TIMEOUT_MS` (injected clock); the token and the record are created with mode `0o600` (Story 33).
- **Stories:** 31, 32, 33, 135

### 36. MCP bridge: lazy HTTP transport and `--max-semi-space-size=1` in generated entries
- **Blocked by:** 13
- **Model:** glm · **Risk:** medium · **ADR:** 0013 (consequences)
- **Delivers:** The bridge imports its HTTP transport lazily (HTTP mode unchanged). Generated harness MCP entries put `--max-semi-space-size=1` on the bridge command line, never in `NODE_OPTIONS`. Existing harness configs are updated on the next `setup`/`integrate` through the transaction, idempotently.
- **Acceptance:**
  - [ ] Seam 7: HTTP mode tests unchanged; `test:mcp` green with the flag (build-time gate 6).
  - [ ] Seam 8: the flag in every generated entry; bridge-flag migration replayed twice is a no-op; rollback restores the old entry.
  - [ ] Loop: S3 bridge role peak ≤ 75 MB (baseline 86); S5 within budget.
- **Stories:** 34, 135

### 37. `process.execve` handover in `zcode-kit run` and the `ZCODE_KIT_RESIDENT_LAUNCHER=1` opt-out
- **Blocked by:** 15, 35, 36
- **Model:** sol · **Risk:** high · **ADR:** 0013 (Round 4 amendment)
- **Delivers:** Handover only on POSIX with `typeof process.execve === "function"`, Node ≥ 26.1 and the target resolved on PATH with `access(X_OK)`; otherwise resident as today, with "run: …" + exit 2 for a missing harness. `ZCODE_KIT_RESIDENT_LAUNCHER` read before the decision; exactly `"1"` forces resident (byte-for-byte today's path); no effect on Windows; read nowhere else. Before the handover: `ready.detail`, any `heal.log` write and all cleanup, then SIGPIPE/SIGXFSZ re-armed and `ExperimentalWarning` suppressed for this call only. Documented in `--help` (environment section) and as input for README × 5 / release notes (52–54).
- **Acceptance:**
  - [ ] Seam 5 spawn tests (POSIX, fake harness): Node ≥ 26.1 → harness under the launcher's pid, no launcher resident; Node < 26.1, `ZCODE_KIT_RESIDENT_LAUNCHER=1` or non-executable target → resident; `ZCODE_KIT_RESIDENT_LAUNCHER=yes` → handover (only `"1"` counts); missing harness → `run: …`, exit 2; no `ExperimentalWarning` on stderr; `ready.detail` and `heal.log` written before; SIGTERM-killed harness → 143; exit codes 0, 7, 130 unchanged. windows-latest: resident path with signal and exit-code forwarding as today.
  - [ ] Loop S3 Linux on Node 26: summed-RSS sample max ≤ 596 MB and every role peak within target (build-time gate 1). **Delete `S3/short` (linux).**
  - [ ] Loop S3 Windows: ≤ 600 MB commit (≥ 30 % rule if the baseline exceeded 600). GREEN → **delete `S3/short` (windows)**; a miss goes back to the owner with numbers for the two levers (build-time gate 2) and the entry is re-pointed to that follow-up.
  - [ ] macOS execve recorded as an owner action, unverified.
- **Stories:** 29, 30, 35, 36, 37, 38, 39, 40

## Steps 5–6 — UX migration batches, observability, then the TUI

Observability fields (39) land before the TUI because the TUI process strip reads them; the `doctor` memory checks (41) follow UX batch (a), whose renderer they use.

### 38. Manager `doctor` returns check records; `zcode-kit doctor` stops parsing text
- **Blocked by:** 15
- **Model:** glm · **Risk:** medium · **ADR:** 0001 (Round 2 amendment)
- **Delivers:** The manager's doctor returns its checks as records through the lifecycle module; `zcode-kit doctor` consumes records instead of regex-parsing text. The manager CLI's own `doctor` keeps the legacy off-TTY grammar byte for byte.
- **Acceptance:**
  - [ ] Spawned manager CLI `doctor` output byte-identical to the pre-change snapshot (seam 2).
  - [ ] `zcode-kit doctor` exit codes unchanged on every fixture state; no text parsing remains (grep test).
- **Stories:** 61, 92

### 39. Observability fields in `/health` details, `proxy status` and `--json`
- **Blocked by:** 19, 21, 23, 40, 58
- **Model:** glm · **Risk:** medium · **ADR:** 0010
- **Delivers:** Additive objects: `memory[]` per proxy-owned process (`role`, `pid`, `rssMB`, `footprintMB`, `capMB`, `enforcement`; the solver entry adds fail-fast state and window end), `restarts { last15m, budget }`, `admission { inFlightBytes, queued, shedTotal }`, `processes { proxy: 1, solver: n }`. `schemaVersion` stays 1. `/health` stays behind bearer auth, synchronous, O(1), every value from a cached sample.
- **Acceptance:**
  - [ ] Seam 4: `/health` details superset vs the 06 JSON baseline (keys + types); adversarial: with the sampler stubbed to never complete, `/health` details still answer from the last cached sample (no await on sampling in the handler); unauthenticated request rejected as today.
  - [ ] Seam 5: `proxy status --json` superset test; text rows render per design-language §7.
- **Stories:** 80, 81, 82, 83, 123

### 40. UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details
- **Blocked by:** 38, 06
- **Model:** glm · **Risk:** medium · **ADR:** 0001, 0005
- **Delivers:** These commands render through `Out`: `doctor` shows each check once, a problem-count lead line when anything failed, one verdict line, off-TTY grammar `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` with today's names; `WARN` additive, exit 0, never applied to a condition that FAILs today. Status state line in human units (A-17). Connection details printed once per command, unboxed, ≤ 80 columns, key shown only on an interactive TTY, routes in `--verbose`/JSON (A-12). Reports on stdout, diagnostics on stderr, every error with what/why/next (`Run setup first (node setup.mjs)` → `zcode-kit setup`). Additive `proxy logs --level`/`--grep` filters (A-23). Closes A-02, A-05/A-09 (these commands), A-12, A-17, A-20, A-23.
- **Acceptance:**
  - [ ] Snapshots updated in every C3 variant on both legs; the diff reviewed against design-language.md.
  - [ ] Off-TTY regex test over every doctor fixture; WARN never changes an exit code; a check that FAILs today is never WARN (fixture matrix).
  - [ ] JSON superset tests pass; connection-details reveal-rule suite passes.
  - [ ] Stream routing asserted through real spawns (seam 5).
- **Stories:** 89, 90, 91, 92, 93, 95, 105

### 41. `doctor` memory checks: proxy memory, solver memory, cap enforcement, restart budget
- **Blocked by:** 39, 40
- **Model:** glm · **Risk:** medium · **ADR:** 0010 (Round 3 amendment)
- **Delivers:** Four checks with the PASS/WARN/SKIP rules and next commands of ADR-0010's amendment: macOS `sampling` → PASS with a note; Linux without a delegated controller → WARN pointing to `systemctl --user status` and the README section; solver WARN only during fail-fast or after a recent abnormal exit; restart budget exhausted → WARN. `doctor` triggers no new sampling.
- **Acceptance:**
  - [ ] Seam 5 record tests for every rule branch with injected status data; snapshots in every C3 variant.
  - [ ] Off-TTY rows match the regex; JSON check names stable and new entries additive.
- **Stories:** 84, 85, 86, 87

### 42. Account Rotator decision asked once, with migration
- **Blocked by:** 08
- **Model:** sol · **Risk:** medium · **ADR:** 0012
- **Delivers:** The decision is stored under `generated/` next to the harness choices and asked only when nothing is stored; `setup --reask` asks again; `--account-rotator` and `ZCODE_KIT_ACCOUNT_ROTATOR=y|n` still override. Migration: `auth.accounts.enabled: true` → "yes" without asking; `false` stays undecided and is asked once on the next TTY setup. `accounts enable|disable` update the stored decision. `update` never blocks without a usable TTY on stdin and stderr. Prompt copy `[y/N]` (A-22).
- **Acceptance:**
  - [ ] `account-setup`/`transaction-audit` fixtures (seam 8): migration replayed twice; enabled → yes recorded silently; no TTY → no prompt and no hang (timeout-guarded test); `--reask` prompts; overrides win.
  - [ ] Snapshots for the prompt in TTY variants.
- **Stories:** 98, 99, 100, 101, 135

### 43. UX batch (b1): compact `setup` report and `integrate --dry-run`
- **Blocked by:** 40, 42
- **Model:** glm · **Risk:** medium · **ADR:** 0001, 0005
- **Delivers:** `setup` prints a compact report by default (stages, one result row per assistant, the connection check, the connection details, the undo command); full output to `install.log` and to screen with `--verbose`/`ZCODE_KIT_VERBOSE=1`; every WARN/FAIL keeps what/why/next on screen; `--installer` still accepted; nothing printed today is lost. `integrate --dry-run` lists every file it would write and every registration with the undo command. The Codex adapter prints the POSIX launcher on POSIX. One banner, TTY progress via `step()`. Closes A-07, A-11 (setup), A-15, A-16, A-26.
- **Acceptance:**
  - [ ] Snapshots in every C3 variant; `install.log` contains every line the old verbose output had (line-set comparison test).
  - [ ] `setup-regressions` passes; dry-run lists match the files a real run writes (temp-HOME comparison).
- **Stories:** 95, 97, 111, 115

### 44. UX batch (b2): installer stages, `install.sh`/`install.ps1` text and the PowerShell 5.1 stderr gate
- **Blocked by:** 43, 11
- **Model:** glm · **Risk:** medium · **ADR:** 0005
- **Delivers:** Installer-mode login hint shows `zcode-kit auth login zai`; install.sh `die` prints real newlines plus a next step; no escapes under TERM=dumb/NO_COLOR incl. install.sh; `[OK]/[SKIP]/[FAIL]/[WARN]` tags kept off a TTY; nesting under installer steps fixed. Closes A-01, A-06, A-13 (installers), A-21.
- **Acceptance:**
  - [ ] Installer tests assert the login hint, newline rendering and no ESC bytes under TERM=dumb and NO_COLOR.
  - [ ] windows-latest PowerShell 5.1 gate: installer setup call and shim with `2>&1`, `-File … 2> file` and `$ErrorActionPreference = "Stop"` → no NativeCommandError, exit codes unchanged; failures hardened in this ticket (build-time gate 5).
  - [ ] Real conhost/PS 5.1 rendering recorded as owner action A2, unverified.
- **Stories:** 94, 95, 96, 116

### 45. UX batch (c1): grouped help, per-command `--help`, usage errors, output overrides
- **Blocked by:** 37, 40, 42
- **Model:** glm · **Risk:** low · **ADR:** 0001
- **Delivers:** Help grouped by task with examples first, environment variables and exit codes, at 80 columns; every command has `--help`; a usage error prints two lines on stderr and exits 2. `--color=auto|always|never`, `--no-color`, `ZCODE_KIT_UNICODE=0|1`, `ZCODE_KIT_PROGRESS`, `ZCODE_KIT_HYPERLINKS` (off by default) wired and documented; NO_COLOR wins over FORCE_COLOR. Help documents `WARN`, `--reask`, the rotator override, `ZCODE_KIT_RESIDENT_LAUNCHER` and the overrides. Closes A-10.
- **Acceptance:**
  - [ ] Snapshots for global and per-command help in every C3 variant; width ≤ 80 asserted.
  - [ ] Usage-error spawn test: exactly two stderr lines, exit 2, nothing on stdout.
  - [ ] Override tests through real spawns.
  - [ ] A test asserts that the global help names `WARN`, `--reask`, `--account-rotator`, `ZCODE_KIT_ACCOUNT_ROTATOR`, `ZCODE_KIT_RESIDENT_LAUNCHER`, `--color`, `--no-color`, `ZCODE_KIT_UNICODE`, `ZCODE_KIT_PROGRESS` and `ZCODE_KIT_HYPERLINKS`.
- **Stories:** 95, 103, 104, 110

### 46. UX batch (c2): `accounts` (+health), `auth status`, `models`
- **Blocked by:** 40
- **Model:** glm · **Risk:** low · **ADR:** 0001, 0005
- **Delivers:** Account tables with an active marker, one number format and `zcode-kit …` in next steps (A-19, A-27); `auth status` as text on a TTY, today's exact JSON when stdout is not a TTY, JSON on a TTY with `--json`; `models` through `Out`.
- **Acceptance:**
  - [ ] `auth status` piped output byte-identical to the pre-change JSON; `--json` on a TTY identical too.
  - [ ] Snapshots in every C3 variant; JSON superset tests.
- **Stories:** 95, 102, 114

### 47. UX batch (c3): `run`, `update`, `rollback`, `uninstall`
- **Blocked by:** 40, 37
- **Model:** glm · **Risk:** medium · **ADR:** 0005
- **Delivers:** `run` writes every kit line to stderr, so `zcode-kit run … | jq` sees only the harness's output; `update` shows numbered steps and prints the connection details once at the end (A-25); `rollback`/`uninstall` end with a verdict counting restored/removed files and WARN blocks for conflicts (A-24).
- **Acceptance:**
  - [ ] Spawn test: `run` with a fake harness → stdout contains only harness bytes (seam 5).
  - [ ] Snapshots in every C3 variant; exit codes unchanged.
- **Stories:** 93, 95, 112, 113

### 48. Proxy TUI redesign on the shared tokens
- **Blocked by:** 05, 32, 39
- **Model:** sol · **Risk:** high · **ADR:** 0001 (Round 2 amendment), 0011
- **Delivers:** Boxed status header only (state, port, health, uptime, account/plan, login badge in words); process strip with per-process RSS and, for capped processes, the named enforced metric against the cap, the enforcement mode and restarts in 15 min; collapsed settings strip with `(•)/( )` selection and bracketed disabled controls; toast; key-hint footer in priority order (`quit` always visible, `[?] keys` overlay). Sidebar at ≥ 100 columns, single column at 80, minimum 60×16 with a notice naming `zcode-kit proxy status`. TERM=dumb and non-TTY refuse and print `zcode-kit proxy status` and `zcode-kit proxy logs 50`. NO_COLOR keeps bold/reverse/text markers; 16-colour roles; wgl4/ascii tiers; alt-screen/cursor/mouse/raw mode restored on every exit path. Polls ≥ 5 s, one request per source, no new endpoints; every existing action reachable. Closes A-03, A-18 (except the filter).
- **Acceptance:**
  - [ ] Seam 6 frame tests per tier and size (80, 100, 120, 60×16, below minimum), NO_COLOR markers, TERM=dumb refusal.
  - [ ] Exit-path tests restore terminal state (signal, error, quit); poll-interval test with an injected clock.
  - [ ] Action-reachability test for provider/plan switching, login, start/stop. S6 within budget.
  - [ ] The TERM=dumb refusal exits 1, the same code as today's non-TTY refusal (`tui/app.ts:43-48`), and prints `zcode-kit proxy status` and `zcode-kit proxy logs 50`; the non-TTY refusal keeps exit 1.
- **Stories:** 117, 119, 120, 121, 122

### 49. Proxy TUI log pane: filter, scroll, follow
- **Blocked by:** 48
- **Model:** sol · **Risk:** medium · **ADR:** 0001
- **Delivers:** Unboxed title line with count/follow badge; filter (`/`, substring, `level:warn`/`level:error`, Esc clears); scrolling and follow; byte cap from 32 kept.
- **Acceptance:**
  - [ ] Seam 6 tests for filter parsing, scroll/follow state and the footer hint.
  - [ ] Frame snapshots per tier.
- **Stories:** 118

### 50. Harness adapters: HIGH fixes (Continue, Kilo Code)
- **Blocked by:** None (can start immediately).
- **Model:** glm · **Risk:** low · **ADR:** —
- **Delivers:** Continue writes `capabilities` as a string array (`tool_use`, `image_input`); Kilo Code's Anthropic base URL gets `/v1`. Existing users get them on the next `setup`/`integrate` through the transaction with rollback, idempotently.
- **Acceptance:**
  - [ ] `adapter-audit` fixtures: new shape, byte-idempotent on a second run, rollback restores the old file (seam 8).
  - [ ] Adapter-refresh migration replayed twice.
- **Stories:** 131, 132, 135

### 51. Harness adapters: confirmed MEDIUM fixes and record refresh
- **Blocked by:** 50
- **Model:** glm · **Risk:** medium · **ADR:** —
- **Delivers:** Each MEDIUM candidate (Claude Code effort/capabilities, OpenCode Flash `modalities.input`, Goose `supports_vision`, Cline CLI config path, Kilo per-model reasoning/modalities, OMP `auth: apiKey` and unsupported compat fields, pi `thinkingLevelMap`) is applied only where `research/harness-configs.md` confirms it from primary docs; UNVERIFIED items and OpenCode V1 schema left unchanged; recorded versions and `primarySource` dates refreshed only for what was re-verified.
- **Acceptance:**
  - [ ] One fixture per applied item, byte-idempotent; a test asserts each UNVERIFIED item's output is unchanged.
  - [ ] The ticket lists each candidate as applied/left with its primary-doc link.
- **Stories:** 133, 134, 135

## Step 7 — Docs and translations (C8)

### 52. Docs: README × 5 at content parity
- **Blocked by:** 10, 19, 21, 30, 31, 33, 34, 37, 41, 42, 43, 47, 58
- **Model:** glm · **Risk:** medium · **ADR:** 0003, 0013
- **Delivers:** README en/de/es/ja/zh-CN updated together: Node 24 floor; new config keys; log rotation and the early log (`proxy.early.log`); MCP task retention and the idempotency window; enforcement modes per OS incl. the Linux delegated-controller section that `doctor` links to; the 503 shed; stderr routing; rotator asked once; the execve handover, its Node ≥ 26.1 requirement and `ZCODE_KIT_RESIDENT_LAUNCHER=1` next to that note; the start-lock "never taken over" line replaced.
- **Acceptance:**
  - [ ] A parity check passes: all five files have the same heading count per level, the same explicit anchor ids, and the same set of env-var names, config keys and `zcode-kit` commands (extracted by regex).
  - [ ] The README section that 41's enforcement WARN links to carries an explicit HTML anchor id (`<a id="…"></a>`) that is identical in all five files, and a test asserts that the id 41 prints exists in each file.
- **Stories:** 136

### 53. Docs: SECURITY (+de), harness docs, MCP bridge READMEs × 5, `docs/MCP_API.md`, SUPPORT_MATRIX, MANIFEST
- **Blocked by:** 11, 13, 16, 22, 31, 51, 58
- **Model:** glm · **Risk:** medium · **ADR:** 0002, 0003, 0007, 0014
- **Delivers:** SECURITY (+de): solver is a separate OS process with a cap and still not a sandbox; takeover rules replace "never taken over"; happy-dom flags keep the 20.x surface; `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA` unchanged; stop-token protections. `harnesses/README*` and `EFFORT_MAPPING*` where effort/image flags changed. The five MCP bridge READMEs at parity with the Node 24 floor and the stay-back note. `docs/MCP_API.md`: 4 MiB cap (1 MiB head + 3 MiB tail), marker, `truncated`, idempotency window. `SUPPORT_MATRIX.json` (date, Node/Bun versions, tested harness versions reconciled with MANIFEST) and `MANIFEST*`.
- **Acceptance:**
  - [ ] Parity checks for SECURITY en/de and the five bridge READMEs; `release-audit`/`state-audit` pass with the new matrix.
  - [ ] A grep test fails if any sentence that states the worker-thread solver or 'never taken over' is still present. The sentences are captured from the base commit into the test, from SECURITY.md, SECURITY.de.md, README × 5 and the MCP bridge READMEs.
- **Stories:** 126, 129, 136, 137

### 54. Release notes vNEXT and owner actions
- **Blocked by:** 29, 44, 45, 46, 48, 52, 53
- **Model:** glm · **Risk:** low · **ADR:** —
- **Delivers:** `docs/RELEASE_NOTES_vNEXT.md` (English) lists every user-visible change: Node 20/22 dropped (installer refuses first); the stream move; `WARN` with the additive JSON values and `completeness: partial`; `auth status` text on a TTY; rotator asked once + migration; the 503 shed incl. during a recycle drain; the solver as a separate process (visible in task managers), its cap and enforcement modes; thresholds 1536/3072 → 512/1024 MB; recycle count 200 → 100; MCP retention 500/7 days and the idempotency window; MCP task text capped at 4 MiB with a head/tail marker; CDN disk pruning; log rotation while running and `proxy.early.log`; Bun 1.4.4; compact setup by default; Windows graceful stop; execve handover exit status and `ZCODE_KIT_RESIDENT_LAUNCHER=1`; nested proxy workflows deleted; the proxy TUI refuses under TERM=dumb (exit 1) and prints the line-mode commands; the four new `doctor` checks; the additive `proxy logs --level/--grep` filters; harness configs refreshed on the next `setup`/`integrate` (Continue `capabilities`, Kilo Code `/v1`, the confirmed MEDIUM items, the bridge's `--max-semi-space-size=1`). `OWNER-ACTIONS.md` lists A1, A2 (incl. install.ps1 run), macOS terminals/execve/S3 footprint and the optional live smoke with copy-paste commands, each related criterion marked "unverified — owner action".
- **Acceptance:**
  - [ ] A checklist test/grep confirms that every item of spec §16's release-notes list (including the four Round 5 additions) appears.
  - [ ] Every "unverified" criterion in tickets 17, 28, 37, 44 points to an OWNER-ACTIONS entry.
- **Stories:** 138, 144

## Step 8 — Remaining CI guardrails

### 55. CI guardrails: snapshot-update refusal and an empty expected-RED list
- **Blocked by:** 06, 16, 17, 19, 30, 32, 34, 35, 37, 58, and every typecheck-baseline ticket filed by 11
- **Model:** glm · **Risk:** low · **ADR:** 0016
- **Delivers:** CI fails when `UPDATE_SNAPSHOTS` is set; `expected-red.json` is empty on both legs and a guard keeps it empty from here on; the seam 9 guard suite (wiring guard from 04, expected-RED schema, `verify-payload` shared files from 05, snapshot refusal) runs in `npm run test`.
- **Acceptance:**
  - [ ] A CI-env test with `UPDATE_SNAPSHOTS=1` fails; locally it writes.
  - [ ] Both `memory-budget` legs green with an empty list; the guard rejects a re-added entry.
  - [ ] `npm run test:all` and both `memory-budget` legs are green in the CI run in which the list becomes empty; the proxy typecheck expected-error list from 11 (if any) is empty too.
- **Stories:** 141, 142

## Follow-ups (publish as `needs-triage`)

### 56. (needs-triage) MCP SDK 2.x and protocol revision 2026-07-28 migration
- **Blocked by:** 13
- **Model:** sol (if accepted) · **Risk:** high · **Status:** needs-triage
- **Delivers:** An evaluated migration plan off SDK 1.x / protocol 2025-11-25 before the 1.x support horizon noted in `research/mcp-sdk.md` (2027-01-27). Out of scope for this overhaul (spec Out of Scope; Round 1 Q16).
- **Acceptance (for triage):** [ ] Owner decides go/no-go; if go, the ticket is re-written as tracer bullets.
- **Stories:** — (follow-up to 129)

### 57. (needs-triage) MCP runtime restart budget (architecture candidate 8)
- **Blocked by:** None.
- **Model:** sol (if accepted) · **Risk:** medium · **Status:** needs-triage
- **Delivers:** Proposal to fold a respawn budget/backoff/state into the bridge runtime module with the same policy shape as the proxy's restart budget, tested through the fake harness. Not done now because S5 never exercised runtime restarts (Round 1 Q2).
- **Acceptance (for triage):** [ ] An S5 variant with induced harness exits shows whether a restart storm is possible; owner decides.
- **Stories:** —

---

## Ordered summary

| # | Title | Model | Risk | Blocked by |
|---|---|---|---|---|
| 01 | Memory loop, budgets, process-count harness, expected-RED ratchet, ubuntu `memory-budget` job | sol | medium | — |
| 02 | Windows sampler + windows `memory-budget` leg (1.4.2 reference run) | sol | high | 01 |
| 03 | S3 OMP stub-host leg | sol | medium | 01, 02 |
| 04 | Pre-existing findings: unwired tests, wiring guard, CI Node 24/26 | glm | low | — |
| 05 | Shared width core + token set | sol | medium | 01 |
| 06 | CLI output module, capability record, snapshot harness, JSON baseline | glm | medium | 05 |
| 07 | Command-module split part 1 (expand) | glm | medium | 06 |
| 08 | Command-module split part 2 (migrate + contract) | glm | medium | 07, 10 |
| 09 | Batch 1a: CI toolchain, Bun 1.4.4 in CI, nested workflows removed | glm | low | 02, 03, 04 |
| 10 | Batch 1b: Node 24 floor, refuse before mutation, autostart Node-path check | glm | medium | 09 |
| 11 | Batch 1c: Bun 1.4.4 installer bootstrap, pinned proxy typecheck, attribution runs | glm | medium | 10 |
| 12 | Batch 2: happy-dom 21.0.4, undici 8.12.4, yaml 2.9.1 | glm | medium | 11 |
| 13 | Batch 3: MCP SDK 1.32.2, zod 4.6.6, TS 7, @types/node 24 | glm | medium | 12 |
| 14 | Event-line format + redaction (prefactor) | glm | low | — |
| 15 | Proxy lifecycle module (intents, outcome records) | sol | high | 08, 13, 14 |
| 16 | Start lock v1 with proven takeover | sol | high | 15 |
| 17 | Signal release, orphan adoption, respawn over stale lock | sol | high | 16 |
| 18 | Per-spawn proxy env (stop token, log dir) | sol | medium | 15, 21 |
| 19 | Admission control + 503 shed | sol | high | 13, 14 |
| 20 | Fewer request-body copies | sol | medium | 19 |
| 21 | Health supervisor + single graceful sequence | sol | high | 19, 14 |
| 22 | Graceful stop request `/__kit/stop` + shared deadlines | sol | high | 18, 21, 40 |
| 23 | Respawn acknowledgement before drain | sol | high | 17, 18, 21 |
| 24 | Solver transport seam (prefactor) | sol | medium | 12 |
| 25 | Bounded-collection module; CDN memory + stall bounds | glm | medium | 12 |
| 26 | Captcha egress routing under Bun | glm | medium | 12 |
| 27 | Solver child process: spawn, env parity, lazy/idle, one generation | sol | high | 24, 18, 26 |
| 28 | Solver cap per OS + handshake | sol | high | 27 |
| 58 | Solver recycle + failure semantics | sol | high | 19, 25, 28 |
| 29 | CDN disk pruning | sol | medium | 25 |
| 30 | MCP task retention + idempotency window | sol | high | 13 |
| 31 | Per-task caps + 4 MiB truncation | sol | medium | 30 |
| 32 | TUI log pane 2,000 lines / 8 MB | glm | low | 05, 11 |
| 33 | `proxy.log` single rotator + file modes | sol | high | 14, 16, 18, 21 |
| 34 | Early log cap + tail copy | sol | medium | 33 |
| 35 | OMP in-host single-flight + cause-line record | sol | high | 03, 15, 33 |
| 36 | MCP bridge lazy HTTP + semi-space flag | glm | medium | 13 |
| 37 | execve handover + `ZCODE_KIT_RESIDENT_LAUNCHER=1` | sol | high | 15, 35, 36 |
| 38 | Manager doctor returns records | glm | medium | 15 |
| 39 | Observability fields (`/health`, status, JSON) | glm | medium | 19, 21, 23, 40, 58 |
| 40 | UX batch (a): doctor, proxy commands, connection details | glm | medium | 38, 06 |
| 41 | doctor memory checks | glm | medium | 39, 40 |
| 42 | Account Rotator asked once + migration | sol | medium | 08 |
| 43 | UX batch (b1): compact setup, integrate --dry-run | glm | medium | 40, 42 |
| 44 | UX batch (b2): installers + PowerShell 5.1 gate | glm | medium | 43, 11 |
| 45 | UX batch (c1): help, usage errors, overrides | glm | low | 37, 40, 42 |
| 46 | UX batch (c2): accounts, auth status, models | glm | low | 40 |
| 47 | UX batch (c3): run, update, rollback, uninstall | glm | medium | 40, 37 |
| 48 | Proxy TUI redesign | sol | high | 05, 32, 39 |
| 49 | TUI log pane filter/scroll/follow | sol | medium | 48 |
| 50 | Adapters: HIGH fixes | glm | low | — |
| 51 | Adapters: confirmed MEDIUM fixes | glm | medium | 50 |
| 52 | Docs: README × 5 | glm | medium | 10, 19, 21, 30, 31, 33, 34, 37, 41, 42, 43, 47, 58 |
| 53 | Docs: SECURITY, harness, bridge READMEs, MCP_API, SUPPORT_MATRIX, MANIFEST | glm | medium | 11, 13, 16, 22, 31, 51, 58 |
| 54 | Release notes vNEXT + owner actions | glm | low | 29, 44, 45, 46, 48, 52, 53 |
| 55 | CI guardrails: snapshot refusal, empty expected-RED list | glm | low | 06, 16, 17, 19, 30, 32, 34, 35, 37, 58, and every typecheck-baseline ticket filed by 11 |
| 56 | (needs-triage) MCP SDK 2.x migration | sol | high | 13 |
| 57 | (needs-triage) MCP runtime restart budget (arch #8) | sol | medium | — |

`expected-red.json` ownership: S1 variants → 19; S2/short → 58; S3/hung → 16; S3/omp → 35; S3/short → 37; S4/short → 17; S5/short → 30; S6/short → 32; S7/short → 34.

## Coverage: spec user stories → tickets

| Story | Ticket(s) |
|---|---|
| 1 | 27 |
| 2 | 28 |
| 3 | 28 |
| 4 | 28 |
| 5 | 28 |
| 6 | 58 |
| 7 | 27 |
| 8 | 27, 28 |
| 9 | 27 |
| 10 | 28 |
| 11 | 58 |
| 12 | 58 |
| 13 | 58 |
| 14 | 58 |
| 15 | 28 |
| 16 | 28 |
| 17 | 24, 27 |
| 18 | 27 |
| 19 | 27 |
| 20 | 27 |
| 21 | 19 |
| 22 | 19 |
| 23 | 19 |
| 24 | 19 |
| 25 | 20 |
| 26 | 21 |
| 27 | 21 |
| 28 | 21 |
| 29 | 37 |
| 30 | 02, 37 |
| 31 | 03, 35 |
| 32 | 03, 35 |
| 33 | 35 |
| 34 | 36 |
| 35 | 37 |
| 36 | 37 |
| 37 | 37 |
| 38 | 37 |
| 39 | 37 |
| 40 | 37 |
| 41 | 01, 16 |
| 42 | 16 |
| 43 | 16 |
| 44 | 17 |
| 45 | 17 |
| 46 | 16 |
| 47 | 16 |
| 48 | 16 |
| 49 | 23 |
| 50 | 23 |
| 51 | 23 |
| 52 | 21 |
| 53 | 23 |
| 54 | 22 |
| 55 | 18, 22 |
| 56 | 18 |
| 57 | 22 |
| 58 | 22 |
| 59 | 22 |
| 60 | 17, 28 |
| 61 | 07, 08, 15, 38 |
| 62 | 25 |
| 63 | 29 |
| 64 | 29 |
| 65 | 25 |
| 66 | 30 |
| 67 | 30 |
| 68 | 30 |
| 69 | 31 |
| 70 | 31 |
| 71 | 31 |
| 72 | 31 |
| 73 | 32 |
| 74 | 33 |
| 75 | 33 |
| 76 | 34 |
| 77 | 33 |
| 78 | 33, 34 |
| 79 | 33 |
| 80 | 39 |
| 81 | 39 |
| 82 | 39 |
| 83 | 39 |
| 84 | 41 |
| 85 | 41 |
| 86 | 41 |
| 87 | 41 |
| 88 | 14 |
| 89 | 06, 40 |
| 90 | 40 |
| 91 | 40 |
| 92 | 38, 40 |
| 93 | 40, 47 |
| 94 | 44 |
| 95 | 40, 43, 44, 45, 46, 47 |
| 96 | 44 |
| 97 | 43 |
| 98 | 42 |
| 99 | 42 |
| 100 | 42 |
| 101 | 42 |
| 102 | 46 |
| 103 | 45 |
| 104 | 45 |
| 105 | 40 |
| 106 | 06 |
| 107 | 06 |
| 108 | 06 |
| 109 | 05 |
| 110 | 45 |
| 111 | 43 |
| 112 | 47 |
| 113 | 47 |
| 114 | 46 |
| 115 | 43 |
| 116 | 44 |
| 117 | 48 |
| 118 | 49 |
| 119 | 48 |
| 120 | 48 |
| 121 | 48 |
| 122 | 48 |
| 123 | 06, 39 |
| 124 | 10 |
| 125 | 10 |
| 126 | 09, 11, 53 |
| 127 | 12 |
| 128 | 12, 13 |
| 129 | 13, 53 |
| 130 | 26 |
| 131 | 50 |
| 132 | 50 |
| 133 | 51 |
| 134 | 51 |
| 135 | 16, 29, 30, 35, 36, 42, 50, 51 |
| 136 | 52, 53 |
| 137 | 53 |
| 138 | 54 |
| 139 | 04 |
| 140 | 04, 09, 11 |
| 141 | 01, 02, 55 |
| 142 | 55 |
| 143 | 01 |
| 144 | 54 |

**Uncovered stories:** none. All 144 spec user stories map to at least one ticket; tickets 56–57 are follow-ups and cover no story by design.
