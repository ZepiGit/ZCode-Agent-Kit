# Terminal UX audit — zcode-kit, proxy manager, installers, proxy TUI (BEFORE)

Phase 1C of the kit overhaul, 2026-11-06. Heuristic evaluation against Charter clause C3 (and C4 for the fixes) of the outputs captured in [`before/`](before/INDEX.md) at kit commit `0960696` (= origin/main `9e45d05` + run bootstrap). 640 captures, 0 failed. install.ps1 could not run on this host (no PowerShell), so it is judged from its source ([static excerpt](before/install/install-ps1-static/source-excerpt.txt)).

Evidence rules: every finding links at least one snapshot, as a path relative to this file. Variant names are the capture variants from [`before/INDEX.md`](before/INDEX.md): `tty-color-80`, `tty-color-120`, `no-color`, `term-dumb`, `ascii-locale`, `pipe`, `ci`. Terminal-behaviour facts (WGL4 glyph coverage, colour precedence, width rules) come from [`../research/terminal-conventions.md`](../research/terminal-conventions.md); rule numbers `R1`–`R22` refer to its rule list.

## Severity scale

| Severity | Meaning |
|---|---|
| **S1 critical** | The user gets wrong or missing information, or is blocked: misleading instructions, lost next step, output that breaks in a C3 terminal, a hang. |
| **S2 major** | A C3 rule is broken (colour-only meaning, error without what/why/next, wrong stream, escapes where none are allowed), or scanning is badly impaired. |
| **S3 minor** | Inconsistency or noise that slows the reader but does not mislead. |
| **S4 cosmetic** | Polish. |

## Top 5

1. **A-01 (S1)** The installer's setup step tells the user to log in and then hides the command that does it.
2. **A-02 (S1)** `doctor` prints every proxy-manager check twice, with two verdict lines.
3. **A-03 (S1)** The proxy TUI shows the selected provider/plan and enabled buttons by colour only. It ignores NO_COLOR and TERM=dumb, and draws glyphs that Windows 10 conhost cannot render.
4. **A-04 (S1)** On a terminal, every `setup` and every `update` asks the Account Rotator question again, even after it was answered.
5. **A-05 (S2)** There is no output design language. Five status vocabularies, three indentation schemes, a single command (`setup`) that mixes `== x ==` banners with `[OK]` tags, errors sent to stdout, and 18 of the 34 help lines wider than 80 columns.

---

## S1 — critical

### A-01 Installer mode swallows the login instructions
- **Heuristic:** error quality (next step), progress feedback.
- **Evidence:** [setup/setup-installer-compact/tty-color-80.txt](before/setup/setup-installer-compact/tty-color-80.txt), [install/install-sh-fresh/tty-color-80.txt](before/install/install-sh-fresh/tty-color-80.txt). Compare with the non-compact [setup/setup-interactive/pipe.txt](before/setup/setup-interactive/pipe.txt).
- **What:** compact mode (`--installer`, the mode install.sh and install.ps1 use) prints `[WARN] MANUAL STEP REQUIRED (once): log in with your ZCode account:` and stops there. The two lines that follow, which carry the actual command, go only to `logs/install.log` (`cli/setup-output.mjs` forwards only lines that match `WARN:|MANUAL STEP REQUIRED`). A new user is told to log in and is not shown how.
- **Also:** the hidden command is the raw `cd <kit>/zcode-proxy-src && ZCODE_PROXY_CONFIG="…" bun run src/index.ts auth login zai`. That is POSIX env syntax, it is wrong for PowerShell, and it bypasses the public `zcode-kit auth login zai` that the installer's own closing card recommends.
- **Fix:** a warning is a block, and the block keeps its `next` line. Point it at `zcode-kit auth login zai`.

### A-02 `doctor` shows the manager checks twice
- **Heuristic:** hierarchy, scannability, consistency.
- **Evidence:** [doctor/doctor-proxy-running/tty-color-80.txt](before/doctor/doctor-proxy-running/tty-color-80.txt) (41 lines, the 13 manager checks appear twice), [doctor/doctor-fresh/pipe.txt](before/doctor/doctor-fresh/pipe.txt) (`doctor: 3 check(s) failed` appears twice), [doctor/doctor-fix-starts-proxy/tty-color-80.txt](before/doctor/doctor-fix-starts-proxy/tty-color-80.txt) (adapter log, manager start output, connection card, then two doctor reports).
- **What:** `cmdDoctor` writes the manager's raw stdout (`process.stdout.write(core.stdout)`) and then re-emits the same parsed checks inside its own list, followed by a second summary. The reader sees two verdicts and has to work out that they are one run.
- **Fix:** the CLI should own the report. The manager hands its checks over as data (JSON), and they appear once, grouped, with a single verdict. The `PASS|FAIL|SKIP` line grammar stays available for scripts (C2; see design-language §11).

### A-03 Proxy TUI: colour-only state, no NO_COLOR, glyphs conhost cannot draw
- **Heuristic:** colour-only information, accessibility, correctness in C3 terminals.
- **Evidence:** [tui/frames/running-following-80x24/tty-color-80.txt](before/tui/frames/running-following-80x24/tty-color-80.txt) next to its [.ansi](before/tui/frames/running-following-80x24/tty-color-80.ansi). [tui/live/no-color.ansi](before/tui/live/no-color.ansi) and [tui/live/term-dumb.ansi](before/tui/live/term-dumb.ansi) still contain `38;2`/`48;2` truecolor SGR and mouse-mode sequences.
- **What:**
  - The provider/plan selection (`zai  bigmodel`) and the enabled/disabled state of `Start`/`Stop`/`Logout` are shown **only** by background colour (blue = selected, gray = available, dim = disabled). Without colour, or for a colour-blind user, the plain text gives no way to tell which provider is active or which button works.
  - `frame.ts` paints unconditionally, in truecolor with no depth downgrade (R13), under NO_COLOR and TERM=dumb alike.
  - Its rounded corners `╭╮╰╯`, `▸` (toast/login hint) and `✗` (failed status) are not in WGL4 and render as boxes on Windows 10 conhost (research §2).
  - The only gate is "is a TTY" (`app.ts:43`).
- **Fix:** design-language §8: selection marked with `(•)`/`[x]` text plus colour, disabled buttons in brackets with a `(stop to switch)` hint, palette mapped to the 16-colour roles, chrome glyphs from the tier table.

### A-04 Account Rotator question is asked again on every setup and update
- **Heuristic:** consistency of decisions, respecting user input.
- **Evidence:** [setup/setup-proxy-running/tty-color-80.txt](before/setup/setup-proxy-running/tty-color-80.txt) (stored harness decisions are respected, the rotator question comes back), [update/update-release/tty-color-80.txt](before/update/update-release/tty-color-80.txt), [update/update-checkout/tty-color-80.txt](before/update/update-checkout/tty-color-80.txt).
- **What:**
  - `cmdSetup` asks `ACCOUNT_ROTATOR_QUESTION` whenever no flag or env answer is given. A stored rotator choice is never consulted.
  - `update` re-runs `setup`, so **every update on a terminal stops at a y/n question** that the user already answered.
  - An update started on a pty with nothing typed waits forever. The first capture pass hit its 120 s kill timeout in all five TTY variants of both update scenarios before answers were scripted.
  - The update help text promises "new harnesses are asked only on a terminal". It says nothing about the rotator.
- **Fix:** treat it like a harness decision: store the answer and do not ask again (`--reask` asks again). This is a behaviour change, so it goes to the Owner Proxy (C2).

### A-05 `run` writes manager chatter into the harness's stdout
- **Heuristic:** streams (R7), scriptability.
- **Evidence:** [run/run-opencode/pipe.txt](before/run/run-opencode/pipe.txt): `already running (pid …)` comes before the harness's own first line on **stdout**, and `ZCode local proxy ready; quota preflight complete.` goes to stderr.
- **What:** `zcode-kit run codex -- exec … | jq` receives a kit status line on the harness's stdout. The manager's `logLine` always uses `console.log`.
- **Fix:** every kit message in `run` goes to stderr; stdout belongs to the child.

### A-06 Installer error text prints a literal `\n`
- **Heuristic:** error quality.
- **Evidence:** [install/install-sh-hash-mismatch/pipe.stderr.txt](before/install/install-sh-hash-mismatch/pipe.stderr.txt): `[ERROR] archive hash mismatch\n  expected 000…\n  actual   3bce…`.
- **What:** `die()` uses `printf '%s'`, so the `\n` escapes in its arguments are not interpreted. The Bun-download mismatch has the same bug. The message also has no next step: retry, pin `ZCODE_KIT_VERSION`, or report it.

### A-07 Codex adapter prints a Windows path on Linux and macOS
- **Heuristic:** correctness, consistency.
- **Evidence:** [setup/setup-interactive/pipe.txt](before/setup/setup-interactive/pipe.txt) and [setup/setup-explicit/pipe.txt](before/setup/setup-explicit/pipe.txt): `use via: bin\zcode-codex.cmd  (e.g. bin\zcode-codex.cmd exec "task")`.
- **What:** on POSIX the right launcher is `bin/zcode-codex.sh` or `zcode-kit run codex`. The other adapters say `zcode-kit run <harness> -- <args>`.

---

## S2 — major

### A-08 Five status vocabularies, no shared output layer
- **Heuristic:** consistency of verbs, labels and alignment.
- **Evidence:**
  - `PASS/FAIL/SKIP` in [doctor](before/doctor/doctor-proxy-down/pipe.txt);
  - `[OK]/[SKIP]/[WARN]/[FAIL]` in [setup](before/setup/setup-installer-compact/tty-color-80.txt) and [install.sh](before/install/install-sh-fresh/pipe.txt);
  - `OK/WARNING` in [accounts doctor](before/accounts/accounts-doctor/pipe.txt);
  - `ok/empty/paused/unknown` verdicts in [accounts health](before/accounts/accounts-health/pipe.txt);
  - `ERROR:`/`WARN:`/`NOTE:`/`note:`/`CONFLICT` free-form prefixes in [proxy start](before/proxy/proxy-start-foreign/pipe.txt), [setup](before/setup/setup-interactive/pipe.txt) and [rollback](before/rollback/rollback-after-integrate/pipe.txt);
  - JSON for a human command in [auth status](before/auth/auth-status-running/pipe.txt).
- **What:** every module prints with `console.log` and its own idiom. `cli/setup-output.mjs` is the only shared helper, and it is used only for compact setup. `[OK]` is followed by three spaces in some places and one in others ([setup-installer-compact](before/setup/setup-installer-compact/tty-color-80.txt): `[OK]   Runtime ready` vs `[OK] Account Rotator disabled`). A neutral choice ("Account Rotator disabled") is reported as `[OK]`.

### A-09 Errors and warnings go to stdout, and most lack why/next
- **Heuristic:** error quality (what/why/next), streams (R7).
- **Evidence:**
  - [proxy/proxy-start-foreign/pipe.txt](before/proxy/proxy-start-foreign/pipe.txt): `ERROR: port 18458 is occupied by a foreign service (auth failed). Not touching it.` goes to stdout, with no next step.
  - [proxy/proxy-start-nokey/pipe.txt](before/proxy/proxy-start-nokey/pipe.txt): `Run setup first (node setup.mjs)` names the retired entry point; the real command is `zcode-kit setup`.
  - [auth/auth-status-down/pipe.txt](before/auth/auth-status-down/pipe.txt) and [models/usage-json-down/pipe.txt](before/models/usage-json-down/pipe.txt): `"fetch failed"` with nothing else.
  - [update/update-release-corrupt/pipe.stderr.txt](before/update/update-release-corrupt/pipe.stderr.txt): `zcode-kit: release archive hash mismatch` and no next step.
  - [help/run-no-harness/pipe.stderr.txt](before/help/run-no-harness/pipe.stderr.txt): `unknown harness "undefined"`.
  - [help/unknown-command/pipe.txt](before/help/unknown-command/pipe.txt): the whole help page goes to stdout under exit code 2.
- **Good counter-examples:** [update-checkout-dirty](before/update/update-checkout-dirty/pipe.stderr.txt), [setup-checkout-refused](before/setup/setup-checkout-refused/pipe.stderr.txt), [accounts-health-down](before/accounts/accounts-health-down/pipe.txt) ("live data unavailable — start the proxy with: zcode-kit proxy start").

### A-10 Help is one 114-column block: not grouped, no examples, no per-command help
- **Heuristic:** help structure, discoverability, 80 columns.
- **Evidence:** [help/help/tty-color-80.txt](before/help/help/tty-color-80.txt): 18 of 34 lines are wider than 80 columns, max 114 (see the `lines >80` column in `INDEX.md`). [help/help-flag](before/help/help-flag/pipe.txt) is identical. `zcode-kit doctor --help` prints the same global page.
- **What:**
  - Commands are packed with `|` alternations into synopsis lines.
  - Behaviour notes sit in parentheses under the wrong command (rotator flags listed under `setup:` after doctor notes).
  - There are no examples and no task grouping, and the environment variables (`ZCODE_KIT_HARNESSES`, `ZCODE_KIT_ACCOUNT_ROTATOR`, `NO_COLOR` …) are not listed.
  - `usage` and `accounts enable|disable` are easy to miss.
  - R21: usage line, one sentence, grouped commands, flags, 1–3 examples, docs link.

### A-11 No progress feedback on a TTY during long steps; compact mode is silent
- **Heuristic:** progress feedback (C3: "every long operation shows progress on a TTY").
- **Evidence:** [setup/setup-installer-compact/tty-color-80.txt](before/setup/setup-installer-compact/tty-color-80.txt) and [install/install-sh-fresh/tty-color-80.txt](before/install/install-sh-fresh/tty-color-80.txt) contain no in-progress state. In non-compact mode the only line is `installing proxy dependencies (bun, frozen lockfile)...`, which is static (`cli/context.mjs`).
- **What:**
  - Bun dependency installs, the setup live smoke (up to 90 s by design), `proxy start` (up to 25 s readiness wait), `doctor --fix` and `update` downloads all run without a spinner or elapsed time.
  - `update: downloading v9.9.9 ...` is static ([update-release](before/update/update-release/pipe.txt)).
  - Off a TTY the output is correctly line-based. That part is right and must stay.

### A-12 Connection details: good content, but buried, too wide and printed twice
- **Heuristic:** discoverability of manual connection details, 80 columns.
- **Evidence:**
  - [proxy/proxy-status-running/pipe.txt](before/proxy/proxy-status-running/pipe.txt): 117 columns, with the route list inlined after the URL.
  - [update/update-release/pipe.txt](before/update/update-release/pipe.txt): the block appears twice in one command, first "not verified running", then "running and verified".
  - [setup/setup-interactive/tty-color-80.txt](before/setup/setup-interactive/tty-color-80.txt): it is the last item after a long adapter log.
- **What works:** the content rules are right and must stay: the key is revealed only on an interactive TTY, a redaction hint names `zcode-kit models --show-key`, and the block is labelled "running and verified" vs "from configuration". The JSON form ([proxy-status-json-down](before/proxy/proxy-status-json-down/pipe.txt)) is good.
- **What is missing:** a visually distinct, copyable card that fits 80 columns, printed once per command.

### A-13 Escapes where none are allowed
- **Heuristic:** NO_COLOR, TERM=dumb correctness (R2, R15).
- **Evidence:**
  - [install/install-sh-hash-mismatch/term-dumb.ansi](before/install/install-sh-hash-mismatch/term-dumb.ansi): install.sh colours under TERM=dumb, because it checks `-t 1` and NO_COLOR only.
  - [accounts/accounts-remove-unconfirmed/term-dumb.ansi](before/accounts/accounts-remove-unconfirmed/term-dumb.ansi) and [ascii-locale.ansi](before/accounts/accounts-remove-unconfirmed/ascii-locale.ansi): Bun's `console.error` paints the whole confirmation hint red. That is an alarm colour on a neutral prompt, and it is emitted under TERM=dumb. Bun does honour NO_COLOR ([no-color.ansi](before/accounts/accounts-remove-unconfirmed/no-color.ansi) is clean).
  - [setup/setup-interactive/no-color.ansi](before/setup/setup-interactive/no-color.ansi): readline cursor sequences (`ESC[1G ESC[0J`) under NO_COLOR. That is acceptable for a prompt, but note it for TERM=dumb.
  - The TUI case is covered by A-03.

### A-14 Non-UTF-8 terminals: non-ASCII kit punctuation everywhere
- **Heuristic:** ASCII fallback (C3 "Unicode-poor code pages"), R4/R12.
- **Evidence:** the `non-ASCII glyphs` column in [before/INDEX.md](before/INDEX.md). `—` (em dash) appears in 34 of the 86 CLI and installer scenarios under `ascii-locale` (every scenario with any non-ASCII output); `·`, `→` and `…` appear in help, accounts health and proxy logs. [help/help/ascii-locale.txt](before/help/help/ascii-locale.txt) contains `—·`.
- **What:**
  - The kit never checks the locale or code page.
  - When PowerShell 5.1 captures output (`$x = zcode-kit status`), it decodes with the OEM code page, so `—` becomes mojibake (research §2).
  - The TUI case (`╭╮╰╯ ▸ ✗`) is A-03.
  - Kit-authored copy should be ASCII on the `ascii` tier; data (upstream text, CJK model errors) stays UTF-8.

### A-15 Setup output: a log, not a report
- **Heuristic:** hierarchy, scannability.
- **Evidence:** [setup/setup-interactive/pipe.txt](before/setup/setup-interactive/pipe.txt), [setup/setup-explicit/pipe.txt](before/setup/setup-explicit/pipe.txt).
- **What:**
  - Adapter diagnostics (`wrote …`, `models.yml updated …`, `== omp: OMP / Oh My Pi (answered y) ==`) are interleaved with the questions and results.
  - The transaction/undo line comes *before* "Configuration saved."
  - The MCP `NOTE: the bridge defaults to …` paragraph is printed even when no bridge was registered ([pipe](before/setup/setup-interactive/pipe.txt), 0 configured).
  - Without a terminal, the same 90-character hint is repeated once per skipped harness (6 times).
  - "Configuration saved." comes before the connection check, and the smoke skip names `ZCODE_KIT_SKIP_SMOKE=1` even when `ZCODE_KIT_SKIP_DEPS=1` caused it.
  - Compact mode has the right shape (steps, results, summary), but only installers get it.

### A-16 `integrate --dry-run` shows almost nothing
- **Heuristic:** discoverability, error prevention.
- **Evidence:** [integrate/integrate-codex-dry-run/pipe.txt](before/integrate/integrate-codex-dry-run/pipe.txt) (`detected: yes` and nothing else) and [integrate-opencode-dry-run](before/integrate/integrate-opencode-dry-run/pipe.txt) (one `use via` line).
- **What:** the dry run does not list the files it would write or the entries it would add, so it cannot be used to review a change before consenting.

### A-17 Proxy status speaks implementation jargon
- **Heuristic:** labels, hierarchy.
- **Evidence:** [proxy/proxy-status-fresh/pipe.txt](before/proxy/proxy-status-fresh/pipe.txt) (`health: nokey`, `port: (config missing)`), [proxy/proxy-status-down/pipe.txt](before/proxy/proxy-status-down/pipe.txt) (`pid file: none`, `health: down`), [proxy/proxy-status-running/pipe.txt](before/proxy/proxy-status-running/pipe.txt) (`up 3725s`, quota expiry as a raw ISO timestamp).
- **What:**
  - The state is spread over three key/value lines (`port`, `pid file`, `health: ours`), and the most important fact, running or not, never appears as a word.
  - Values are internal tokens (`ours`, `nokey`, `foreign`).
  - Uptime is in seconds.
  - Per-process RSS is shown only for the main process, and quota has no remaining-share indicator.
  - The JSON is fine and stays.

### A-18 Proxy TUI lacks the operational facts C1 needs and a log filter
- **Heuristic:** visibility of system status.
- **Evidence:** [tui/frames/running-following-80x24/tty-color-80.txt](before/tui/frames/running-following-80x24/tty-color-80.txt), [tui/live/tty-color-80.txt](before/tui/live/tty-color-80.txt).
- **What:**
  - No health, RSS per process (proxy, captcha worker, sync-fetch worker), quota or account summary.
  - The log pane cannot be filtered: errors scroll away in a 2000-line ring.
  - Two thirds of the height goes to settings rows that change rarely.
  - At 80 columns the footer silently drops `[p] provider · [t] plan · [c] clear`.
  - The non-TTY refusal ([tui/live/pipe.txt](before/tui/live/pipe.txt)) points to `zcode-proxy --cli serve`, which is the standalone binary; a kit user wants `zcode-kit proxy start` / `proxy status`.

### A-19 Accounts commands name the wrong binary
- **Heuristic:** consistency, next-step accuracy.
- **Evidence:** [accounts/accounts-empty/pipe.txt](before/accounts/accounts-empty/pipe.txt): `Add one with: zcode-proxy auth login <zai|bigmodel> --account ID` (the kit command is `zcode-kit auth login zai --account ID`). [accounts/accounts-doctor/pipe.txt](before/accounts/accounts-doctor/pipe.txt): machine codes (`provider_mismatch`, `pool_disabled`) and no next step.

---

## S3 — minor

### A-20 Alignment and width are never computed
- **Evidence:**
  - [accounts/accounts-list/pipe.txt](before/accounts/accounts-list/pipe.txt): ragged columns (`work (Work account)  provider=…` vs `backup  provider=…`).
  - [doctor](before/doctor/doctor-proxy-down/pipe.txt): `name — detail` runs straight on, so details start at a different column on every line.
  - [install.sh](before/install/install-sh-fresh/pipe.txt) is the only place that aligns (`printf '%-27s'`).
- **What:** the CLI never reads `process.stdout.columns`. 80- and 120-column captures are byte-identical, and lines up to 190 columns soft-wrap mid-word in an 80-column terminal ([setup-interactive `max width` 190](before/INDEX.md)).

### A-21 Nested step hierarchy in install.sh
- **Evidence:** [install/install-sh-fresh/tty-color-80.txt](before/install/install-sh-fresh/tty-color-80.txt).
- **What:** `[4/4] Configuring your workspace` is followed by setup's own section titles (`Runtime and configuration`, `Assistant integrations`, `Account Rotator`, `Connection check`). These look the same as the installer steps (same indent, same bold cyan), so the reader loses the `n/4` frame. The prompts start at column 0, while everything else is indented by 2.

### A-22 Prompt copy is long and repeated
- **Evidence:** [setup/setup-interactive/tty-color-80.txt](before/setup/setup-interactive/tty-color-80.txt).
- **What:** `Configure ZCode as a provider with its supported models in Codex CLI? [y/n]` is repeated per harness (82 columns for "OMP / Oh My Pi"). The MCP note precedes the prompt as an unindented `note:` line. There is no default marker (`[y/N]`), so the user cannot tell that Enter repeats the question.

### A-23 `proxy logs` mixes two formats without levels
- **Evidence:** [proxy/proxy-logs/pipe.txt](before/proxy/proxy-logs/pipe.txt).
- **What:** `[manager <timestamp>] …` lines are interleaved with untimestamped proxy lines (`r001 ANT glm-5.3 200 stream …`). A 429 has no level marker, and there is no filter flag (e.g. `--level warn`).

### A-24 `rollback` and `uninstall` end without a verdict
- **Evidence:** [rollback/rollback-after-integrate/pipe.txt](before/rollback/rollback-after-integrate/pipe.txt), [uninstall/uninstall-after-setup/pipe.txt](before/uninstall/uninstall-after-setup/pipe.txt).
- **What:** both list `restored:` / `removed (kit-created):` lines but never say "done, n files restored". Uninstall does not say what is left or how to delete the install directory.

### A-25 `update` stops/starts the proxy with bare manager lines
- **Evidence:** [update/update-release/pipe.txt](before/update/update-release/pipe.txt).
- **What:** a bare `not running` line (the manager's stop answer) appears between `update: verified …` and `update: applied …`. The step structure (download → verify → stop → apply → refresh → start) has to be inferred.

---

## S4 — cosmetic

### A-26 Decorative banners differ between installers and CLI
- **Evidence:** [install/install-sh-fresh/pipe.txt](before/install/install-sh-fresh/pipe.txt).
- **What:** `ZCODE  /  AGENT KIT` and `v1.2.3  |  Your local AI workspace` appear only in the installers. The CLI has a different one-liner in help.

### A-27 Mixed numeric formats
- **Evidence:** [accounts/accounts-health/pipe.txt](before/accounts/accounts-health/pipe.txt) (`4,120/6,000`), [proxy/proxy-status-running/pipe.txt](before/proxy/proxy-status-running/pipe.txt) (`4120/6000`, `96%`, `up 3725s`).

---

## What already works (keep it)

- **Secrets:** the key is printed only on an interactive TTY, and there is an explicit `--show-key` export path ([models-show-key/pipe](before/models/models-show-key/pipe.txt) prints the key to stdout and the warning to stderr: correct).
- **`--json` outputs** are clean single documents with no ANSI: [doctor-json](before/doctor/doctor-json/pipe.txt), [status-json](before/status/status-json-running/pipe.txt), [accounts-json](before/accounts/accounts-json/pipe.txt), [accounts-health-json](before/accounts/accounts-health-json/pipe.txt). The design keeps them byte-stable (C3, C2).
- **Off-TTY behaviour is plain and line-based everywhere** except the TUI (A-03) and install.sh under TERM=dumb (A-13). Prompts never appear without a terminal; skipped harnesses are reported, not configured silently.
- **Exit codes** are documented and consistent across the manager and CLI (0/1/2/3/4/5/20/130).
- **Ownership-safe language** in errors ("Not touching it", "left untouched", "refusing to kill") is clear about what the kit did *not* do. It belongs in the `why` line of the error block.
- **The TUI's pure frame renderer** (`frame.ts`: deterministic, no I/O, width-aware through `width.ts`, priority-ordered footer) is the right architecture to extend (C4).
