# 43: UX batch (b1): compact `setup` report and `integrate --dry-run`

**Blocked by:** 40 (UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details), 42 (Account Rotator decision asked once, with migration)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0001, 0005

**What to build:** `setup` prints a compact report by default (stages, one result row per assistant, the connection check, the connection details, the undo command); full output to `install.log` and to screen with `--verbose`/`ZCODE_KIT_VERBOSE=1`; every WARN/FAIL keeps what/why/next on screen; `--installer` still accepted; nothing printed today is lost. `integrate --dry-run` lists every file it would write and every registration with the undo command. The Codex adapter prints the POSIX launcher on POSIX. One banner, TTY progress via `step()`. Closes A-07, A-11 (setup), A-15, A-16, A-26.

**Acceptance criteria:**

- [ ] Snapshots in every C3 variant; `install.log` contains every line the old verbose output had (line-set comparison test).
- [ ] `setup-regressions` passes; dry-run lists match the files a real run writes (temp-HOME comparison).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 95, 97, 111, 115

## Comments

- 2026-11-07 (orchestrator, from ticket 42): the harness-prompt part of audit finding A-22 and moving prompts to stderr remain here (ticket 42 kept prompts on stdout).

## Comments

### 2026-11-09 — implementation (glm, ticket/43-ux-batch-b1)

**Branch:** `ticket/43-ux-batch-b1`, worktree `/home/AgentKit/wt/t43`, base = integration tip `9d0d005` (merge-base verified; integration tip unchanged during the work — merge before report is a no-op). Commits: `478a768` (integrate --dry-run listing), `833edb1` (codex POSIX launcher), `d1e5e37` (compact setup report, prompts on stderr, banner, TTY progress, log sink), plus the ux-before refresh commit that adds this comment.

**What was built**
- `setup` compact by default (cli/commands/setup.mjs, cli/setup-output.mjs): stage rows (bootstrap + connection check as `Out.step` progress rows with TTY spinner via `step()`; Assistant integrations and Account Rotator as stdout section headers, because their own rows and prompts print while the stage runs — a spinner would be redrawn over them), one result row per assistant (Out.result), the connection check as a step row carrying the smoke detail, the connection details verbatim via `manager.connectionDetails(source)` (install.log + screen, printed once), and the undo command as a summary kv row. `--verbose`/`ZCODE_KIT_VERBOSE=1` keep the old full stream on the screen (byte-shape preserved, plus the banner). `--installer` still accepted; it only suppresses the banner (the installers print it themselves — one banner, A-26; wording `ZCODE  /  AGENT KIT` + `v<version>  |  Your local AI workspace` from package.json via `installedVersion`).
- install.log is written in EVERY mode (header line, mode-independent) and carries the full output in the old verbose shape: `ui.detail` appends and only prints on screen in verbose; `ui.progress` (rotator lines, hints, `[SKIP]` check line) appends always, prints verbatim in verbose; the compact screen renders them through Out. WARN/FAIL keep what/why/next on screen in both modes: detail lines matching `WARN:`/`MANUAL STEP REQUIRED` surface as warn blocks and the following ≥4-space-indented lines join as `next:` (bootstrap's manual-step login commands).
- `integrate --dry-run` lists every file it would write (`  would write  <path>`) and every registration with the undo command, and ends with `Undo  zcode-kit rollback (the real run records the transaction; this command undoes it)`. The would-writes come from `commitFile`'s dry-run path reporting through `tx.touch` (same would-change predicate as the real write: absent or differing content; `log` is no longer called in dry-run) and from `recordHarnessChoice`'s dry-run path for the decision file.
- Codex adapter: the `use via:` hint and the config.toml comment name the launcher of the user's platform (`bin/zcode-codex.sh` on POSIX), read from `ctx.platform` (createCtx now carries it).
- Prompts (ADR-0005, A-22): `createPrompter` defaults to stderr, asks only when stdin AND stderr are terminals, renders `? <question> [y/n]`; the harness question is `Configure ZCode for <label>?`; the existing-integration and MCP-bridge notes are stderr INFO rows (`ui.note`). The `--select` notes stay with the list on stdout (they are list context, not a per-question preamble).

**Decisions taken (smallest that satisfies the ACs; spec/ADR silent)**
1. Stage rows for stages 1/4 are Out.step progress rows on stderr; stages 2/3 are stdout headings — per design-language §4.10 a stage whose content prints while it runs cannot hold a spinner without erasing that content (`\r ESC[K`).
2. The connection-details re-proof in `printConnectionDetails` (healthIdentify right before printing) is replaced by using `connectionDetails(source)` after `readState()`'s identity proof plus the smoke's own health check; the manager's printer is otherwise ticket 40's scope.
3. Lifecycle narration during a setup-triggered proxy start (heal.mjs `observe` → console.log) still goes to the terminal only, not install.log — pre-existing compact behaviour, unchanged; on a TTY during a spinner it merges into the spinner line (information preserved in scrollback).
4. Banner renders as plain stdout rows (no SGR) — correct on every tier; install.sh keeps its own bold.

**RED→GREEN evidence** (logs in the integration worktree `.scratch/kit-overhaul/reports/t43-*.log`)
- Dry-run listing: `t43-red-dryrun.log` (RED: "the dry run lists the files it would write") → `t43-green-dryrun2.log` (5/5 including the temp-HOME comparison: dry-run `would write` set == the files a real run writes, home + state generated/, snapshot diff).
- Codex launcher: `t43-red-codex.log` (RED: "linux: the shown launcher must work on the user's OS") → `t43-green-codex.log` + adapter-audit pin updated (it asserted the Windows path on POSIX — the defect itself).
- Prompts on stderr: `t43-red-prompt.log` (RED: stdout carried the prompt) → green in `t43-hc8.log` (spawn: stdout empty, `? Configure ZCode for Codex CLI? [y/n] ` on stderr, EOF is not consent).
- install.log line set: fixture `tests/fixtures/install-log-old-verbose.txt` captured from the PRE-change code (old-verbose capture script under overhaul-tools/t43-scripts, `t43-old-verbose.log`); `tests/install-log-lines.test.mjs` GREEN in `t43-loglines2.log`.
- Compact report snapshots: written and verified in all 8 C3 variants (`t43-snap-report.log`, tests/snapshots/setup-report/<variant>.{out,err}), escape-scan over the colourless variants, and the log-sink assertion that every old-format line survives.
- Prompt snapshots (`tests/snapshots/setup/{rotator,harness}-prompt/*`) regenerated for the `? ` prefix (12 files, `t43-snap-regen.log`).

**Pre-existing tests: justification per change** (common acceptance)
- setup-regressions: runs `--verbose` (it pins the full adapter pipeline and reads the transaction id from output; the compact-default behaviour has its own new test "compact setup by default: report on the screen, full output in install.log" — also asserts no escapes off a TTY). The root setup.mjs shim forwards flags it does not interpret (`--verbose` etc.).
- adapter-audit / cli-audit / crlf-writers / account-setup: assertions that read the transaction id or the adapter/bridge diagnostics from stdout now read install.log (`txOf`/`logText` helpers) — under the compact default those lines live there by design. Output-shape assertions updated to the Out row grammar (`OK  `, `SKIP  `, `INFO  `; justified by the design-language migration this ticket makes for setup).
- ux-before capture fixtures and 7 test fixture kits copy `zcode-proxy-src/src/tui/{tokens,width-core}.mjs` — the output module re-exports them (ADR-0011); a real layout ships them (pack allowlist `zcode-proxy-src/src/`, verify-payload requires them), the minimal fixtures did not.
- continue-compatibility: one dry-run test's `touched` expectation — in a dry run `tx.touch` now REPORTS the would-write (the listing seam), the file stays untouched.
- fixture-ports: 19439 recorded (dry-run comparison config nothing binds).
- capture fixtures ship src/tui (`srcLinks:false` release mirrors included): the capture initially exited 1/2 in install-sh-fresh/update and update-release because the release-shaped fixture lacked the files — a fixture gap, not a product gap; exit codes are 0 again in the refreshed captures.

**Suite evidence (this worktree)**
- `npm run test` (full kit suite): t43-kit-full2 ran 1011 tests with 13 fails + 1 cancelled during the assertion migration; after the fixes above the per-suite runs are green: harness-consent 28/28 (t43-hc8), account-setup 36/36 (t43-account4), adapter-audit 26/26 (t43-adapter5), continue+auto-heal+adapter batch 94 tests (t43-adapter2 partial → rerun green), proxy-lifecycle+cli-audit+update+state-audit+golden-path+cli-commands+cli-kit 171/171 (t43-batch2), crlf-writers 17/17 (t43-crlf2), ux-before-capture 21/21 (t43-uxcap2 after the fixture fix). A FINAL full `npm run test` run is recorded in the closing comment below.
- `npm run test:proxy`: 1652 tests, 0 fail (t43-testproxy.log). `npm run test:mcp`: 116 tests, 115 pass, 1 skipped, tsc build clean (t43-testmcp.log). dist/ untouched (B5).
- ux-before refresh: full capture of this branch (`t43-uxcap-full2.log`) compared against the committed baseline with compareCaptures: 146 differing files + 4 new stderr files, ALL inside exactly the 12 scenarios listed in tests/ux-before/linux/INDEX.md (setup ×6, integrate dry-run ×2, install-sh ×2, update ×2), 0 exit-code differences, 0 missing/unexpected scenarios; after the refresh compareCaptures reports 0 diffs.

**Pending CI (orchestrator verifies after merge+push)**
- The `ux-before` windows leg: the Windows baseline's pipe/ci captures of the 12 changed scenarios need a windows capture (tests/ux-before/windows/) — cannot be produced on linux (path shapes, shims). The linux ux-before job is satisfied by this refresh.
- The `memory-budget` job, the PowerShell 5.1 stderr gate (ADR-0005's windows verification: prompts now go to stderr — the installer's setup call must not turn them into a NativeCommandError; ADR-0005's gate exists for exactly this) and the snapshot-update refusal (ticket 55) run only in CI.
