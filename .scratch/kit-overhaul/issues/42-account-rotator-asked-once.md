# 42: Account Rotator decision asked once, with migration

**Blocked by:** 08 (CLI command-module split, part 2 (migrate remaining commands + contract))

**Status:** resolved

Model: sol

Risk: medium

ADR: 0012

**What to build:** The decision is stored under `generated/` next to the harness choices and asked only when nothing is stored; `setup --reask` asks again; `--account-rotator` and `ZCODE_KIT_ACCOUNT_ROTATOR=y|n` still override. Migration: `auth.accounts.enabled: true` → "yes" without asking; `false` stays undecided and is asked once on the next TTY setup. `accounts enable|disable` update the stored decision. `update` never blocks without a usable TTY on stdin and stderr. Prompt copy `[y/N]` (A-22).

**Acceptance criteria:**

- [ ] `account-setup`/`transaction-audit` fixtures (seam 8): migration replayed twice; enabled → yes recorded silently; no TTY → no prompt and no hang (timeout-guarded test); `--reask` prompts; overrides win.
- [ ] Snapshots for the prompt in TTY variants.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 98, 99, 100, 101, 135

## Comments

### 2026-11-07 — implementer

**Branch:** `ticket/42-account-rotator-asked-once` (worktree `/home/AgentKit/wt/t42`), base `feb4aec`. Commits: `83c4b09` (feature + tests + prompt snapshots), `39e437a` (replay assertion after mutant M6 survived; Windows npm-layout state path in the fixture), `b4a4397` (ux-before baseline refresh), `109ef73` (merge of the integration tip `e0f5349`, ticket 64, clean), `2158044` (merge of `91aa141`, docs only). The head SHA is the commit that adds this comment. Logs: `.scratch/kit-overhaul/reports/t42-*.log` in the integration worktree; scripts under `/home/AgentKit/overhaul-tools/t42-scripts/`.

**What landed**
- `cli/account-setup.mjs`: the stored decision `<state>/generated/account-rotator.json` (`{ schema: 1, decision: "yes"|"no", source, decidedAt }`, source `interactive|flag|env|accounts|migration`), `readRotatorDecision`, `recordRotatorDecision` (through the command's transaction; idempotent; never overwrites an unreadable file) and `decideAccountRotator`, the setup step. Its order: an explicit `--account-rotator`/`ZCODE_KIT_ACCOUNT_ROTATOR` wins and is recorded → after Ctrl-C at an earlier question nothing else → migration (`auth.accounts.enabled: true` and nothing stored → "yes", recorded without asking; `false`/absent stay undecided) → a stored decision stands unless `--reask` on a terminal → otherwise the question, on a terminal only. `configureAccountRotator` and `restartForAccountChange` are unchanged (B1).
- `cli/harness-consent.mjs`: `ask(question, { defaultAnswer: false })` gives `[y/N]`, and Enter answers n. Without the option nothing changes (`[y/n]`, Enter asks again). `askYesNo` passes the option on.
- `cli/commands/setup.mjs`: the inline rotator block is replaced by `decideAccountRotator`.
- `cli/commands/accounts.mjs`: `enable|disable` record the decision (source `accounts`) in their own transaction, after the config change.
- `cli/commands/update.mjs`: `setupStdin(ctx)`. The setup re-run gets the terminal on stdin only when update's stdin **and** stderr are TTYs and CI is unset, and `ignore` otherwise. The setup child also keeps its own stdin+stdout rule. `cli/zcode-kit.mjs` gives the ctx `terminal: { stdin, stderr }` as lazy getters, and `common.mjs` documents the field.

**Tests** (seam 8, `tests/account-setup.test.mjs`, already wired; 4 → 23 tests). The fixtures are throwaway kits with the state in the kit root, or npm-layout state moved to `$XDG_STATE_HOME`. Each fixture config uses port 19421, a synthetic key, and a fixture proxy CLI (`ZCODE_KIT_BUN=node` runs `zcode-proxy-src/run`, which answers only `auth accounts import-current` with 0 accounts and logs its calls). No account store or credential is read (B2). Every spawn is timeout-guarded, and stdin is never closed, so an unexpected question shows up as a SIGKILL, not as EOF.
- Asked once (pty): answering `n` on a terminal is stored. Then `setup`, `setup`, `doctor --fix`, a checkout `update` and `setup --harness none` ask 0 times and leave the decision byte-identical. `--reask` asks, Enter takes the default n, and the same answer rewrites nothing.
- Ctrl-C at the question (pty) gives exit 130, no decision and the config byte-identical; under `--reask` the stored decision stays byte-identical.
- No TTY, and CI (piped with stdin left open; pty with `CI=true`): `setup` and `doctor --fix` print no question and never hang.
- `update` with `2>file` on a pty and an undecided rotator: no question and no hang. With every stream on the pty it asks once.
- Migration, replayed twice, for three older layouts: in-tree state of a pre-consent kit (no `generated/`), in-tree state with stored harness choices, and an npm install whose state still sits in the package root. `enabled: true` is recorded as `yes/migration` without asking, with the config untouched and nothing imported. That is one recorded transaction. The replay is byte-identical and records no transaction. `rollback <tx>` of the migrating setup removes the decision, and the next run migrates again.
- `enabled: false`, and a pre-rotator config without `auth.accounts`: undecided twice without a terminal, then asked once on the next terminal setup.
- Overrides win and are recorded: `--account-rotator y --reask` over a stored no gives `yes/flag` (import called once), and `ZCODE_KIT_ACCOUNT_ROTATOR=n` gives `no/env`. A replayed override rewrites nothing. `--account-rotator maybe` exits 2 and writes nothing.
- `accounts enable|disable` record `yes/accounts`/`no/accounts`. The next setup reads it. `rollback` of `accounts disable` brings back the decision bytes `accounts enable` wrote.
- An unreadable decision file is reported (`… fix or remove the file; the Account Rotator counts as undecided until then`) and is never overwritten, by setup or by `accounts disable`.
- `setupStdin` returns inherit only for (TTY, TTY, no CI); a pipe on either side, CI, or no terminal info gives `ignore`.
- Prompt snapshots in the six TTY variants of the snapshot harness (`tests/snapshots/setup/rotator-prompt/{tty-color-80,tty-color-120,no-color,term-dumb,ascii,wgl4}.txt`). They show the step as the terminal shows it, undecided, answered n. They are byte-identical across variants, because setup's text is not on the output module yet (43 changes that).

**RED → GREEN**
- `t42-red1` (code at `feb4aec`): 18 of the 19 new tests fail, each on its intended symptom.
  - The pty tests (asked once, Ctrl-C, `enabled: false`/absent) wait for `[y/N]` while the prompt reads `[y/n]` and are killed at 60 s.
  - `update 2>file` on a pty: setup asks the rotator and hangs until the 45 s SIGKILL. That is A-04, reproduced.
  - The three migrations, the overrides and the accounts test record no decision (`null`).
  - The unreadable test gets no report.
  - `setupStdin` and `decideAccountRotator` are not functions, and the snapshots are missing.
  - The one test green on the old code (no TTY/CI) pins behaviour that already held; it is proven by mutation below.
- Green: `t42-green1`, then `t42-green3` (account-setup, harness-consent, cli-commands, term-boundaries, update, test-wiring): 142/142. One assertion was fixed between them: the test first expected the replay to record a transaction, but a transaction without ops is not recorded at all, which is the stronger result.
- Mutations (`t42-mutants2`, `t42-mutant-m6`). The script restores each file from the commit, and `git status` of `cli/` is clean afterwards. Each mutant and the tests that caught it:
  - M1, isInteractive always true: the no-TTY/CI test and both undecided tests fail.
  - M2, CI ignored: the no-TTY/CI test fails.
  - M3, `doctor --fix` asks the rotator: the asked-once test fails.
  - M4, update always inherits stdin: the update e2e and unit tests fail.
  - M5, migration off: the three migration tests and both undecided tests fail.
  - M6, the same decision is rewritten: first it **survived** the migration and accounts tests; `39e437a` adds the replayed-override assertion, and the mutant then fails.
  - M7, an unreadable file is overwritten: the unreadable test fails.
  - M8, `accounts` does not record: the overrides and accounts tests fail.
  - The first mutation run (`t42-mutants`) is void. Its restore step (`git checkout`) ran before the work was committed and reverted the implementation. The work was re-applied from the session, the diffstat was checked identical, then committed and re-run.

**Visible changes and snapshot diff** (design-language §3.1 INFO for a neutral choice and §4.9 `[y/N]`, with exact next commands and no colour; setup keeps its bracketed tags until 43)
- Prompt: `Do you want to activate the Account Rotator feature? [y/n]` → `… [y/N]`; Enter means n.
- New lines when a decision is stored: `  [INFO] Account Rotator enabled|disabled (saved choice; not asked again).` and `  Change it: zcode-kit accounts disable|enable, or zcode-kit setup --reask`. A hand-edited config that disagrees: `  [WARN] Account Rotator saved choice is <yes|no>, but proxy/config.yaml has it <enabled|disabled>; setting unchanged.` and `  Pick one: zcode-kit accounts enable, or zcode-kit accounts disable`. An unreadable file prints a `[WARN]` line with the path.
- The text without a stored decision and without a terminal is unchanged (`Account Rotator setting unchanged (no interactive answer).`).
- `test:ux-before` against the old baseline (`t42-before1`): 108 differing files, all intended.
  - `[y/N]` in the 5 TTY variants × (.txt + .ansi) of `setup-interactive`, `setup-installer-compact`, `setup-select`, `setup-none-detected`, `install-sh-fresh` and `install-sh-update`. `setup-none-detected` also gains `transaction <TX> recorded — undo with: …`, because the answer is now recorded.
  - The question is gone, with the INFO pair in all 7 variants, in `setup-proxy-running`, `update-checkout` and `update-release`. Their prep had answered `--account-rotator n`. These are A-04's own evidence captures.
  - `uninstall-after-setup`, all 7 variants: `2 restored, 5 removed` → `2 restored, 6 removed`. The kit-created decision file is rolled back too.
- Refreshed: those 108 Linux files from the `t42-before1` capture, and the 8 matching Windows pipe/ci files (`setup-proxy-running`, `update-checkout`, `update-release`, `uninstall-after-setup`) with the same line edits. Both `INDEX.md` files list the refresh, and the `compare.mjs` header says that later tickets may refresh captures they change on purpose. `t42-before-final` (merged head, 7 variants): 1/1, 0 differences.

**Full suites** (merged head `109ef73`; `2158044` adds only a `.scratch` line; Node 26.7.0, Bun 1.4.2)
- `npm run test` (`t42-full-kit`): 765 tests, 746 pass, 0 fail, 19 skipped.
- `npm run test:proxy` (`t42-full-proxy`): 1343 pass, 0 fail, 90 files.
- `npm run test:proxy-typecheck` (`t42-full-typecheck`): `tsc --noEmit`, exit 0.
- `npm run test:mcp` (`t42-full-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged.
- `npm run test:ux-before` (`t42-before-final`, `UX_CAPTURE_PORT=19420`): 1/1.

**Memory loop**, S3/short (the scenario through the changed entry), port 19425. Base = the integration tip `91aa141` in a temporary detached worktree (removed); after = `109ef73`.

| metric | base | after |
|---|---|---|
| peak:kit | 856.9 MB | 860 MB |
| procPeak:launcher | 78.6 MB | 78.7 MB |
| procPeak:mcp-bridge | 88 MB | 87.3 MB |
| procPeak:preflight | 71.5 MB | 72.1 MB |
| failed-launches | 7 | 5 |
| stale-lock-after-round | 1 | 1 |

Both are RED on the existing `S3/short` expected-RED entry (tickets 16/37); the deltas are run-to-run noise (07/08 saw 850–858 MB and 2–8 failed launches). No expected-RED entry belongs to this ticket. Logs: `t42-memloop-S3-{base,after}`.

**Decisions taken**
1. **File location.** The file is `generated/account-rotator.json`, beside `generated/harness-choices/` rather than inside it. `readHarnessChoices` and doctor's `decisionFileChecks` would report a file in that directory as an unknown harness id.
2. **A stored decision is not re-applied.** Setup then asks nothing and leaves `auth.accounts.enabled` alone. Re-applying a stored "yes" would run `import-current` on every unattended setup/update, which today never happens without an answer, and a failed import would fail the update. Only an answer changes the config, through the unchanged `configureAccountRotator`. So rotator behaviour is unchanged (B1).
3. **Overrides are recorded** (source `flag`/`env`), as an explicit `--harness` selection records consent. Otherwise `--account-rotator n` (config false = undecided) would be asked again on the next terminal setup.
4. **Idempotency.** The same decision is never rewritten, whatever its source, so replays and permanently set overrides record no transaction.
5. **Fail closed.** An unreadable or unknown-schema file is reported and never overwritten, by setup, the overrides or `accounts`. This follows the harness-choice precedent; the file may come from a newer kit.
6. **Hand-edit mismatch.** When the stored decision and the config disagree, setup prints a WARN with the two exact commands and changes nothing.
7. **`[y/N]` only for the rotator question; Enter means n** (design-language §4.9 "the default is capitalised"). Invalid answers still repeat, and only an explicit y opts in. The per-harness questions keep `[y/n]`. A-22's harness-prompt part (long copy, the `? ` prefix, the indented INFO note) is left for ticket 43, and the question text is unchanged.
8. **Streams unchanged.** The prompt stays on stdout as today; the move to stderr is ADR-0005's setup batch (43). The "usable TTY on stdin and stderr" condition is enforced where the ticket puts it, in `update`. A plain `setup 2>file` on a terminal still asks, with its prompt visible on stdout.
9. **Abort handling.** After Ctrl-C at an earlier question, an explicit override is still applied, as before, and the migration is skipped; the next run migrates.

**Pre-existing test changes (justified)**
- `tests/account-setup.test.mjs` "installer requires an explicit y/n answer and repeats invalid/empty answers" became "installer opts in only on an explicit y, repeats invalid answers, and Enter takes the default n". Under `[y/N]`, Enter means n (A-22); "maybe" still repeats, and opting in still needs y.
- The same file's "terminal redraw…": the expected prompt `[y/n] ` → `[y/N] `.
- `tests/harness-consent.test.mjs`: three rotator-prompt literals `[y/n]` → `[y/N]` (`:681` order check; `:713`/`:723` the `--select` pty steps wait for the rotator prompt). Nothing else changed.
- `tests/ux-before/{linux,windows}` baseline files, both `INDEX.md` files, and the `compare.mjs` header comment (above).

**Left for other tickets**
- 45: `--help` documents the rotator meaning of `--reask` and the saved choice (`help.mjs:27` still says only `generated/harness-choices/`).
- 52: README × 5. `README.md:12` still quotes `[y/n]`, and `:27` says "the existing Account Rotator setting is preserved"; both need the asked-once behaviour and `generated/account-rotator.json`. `docs/ACCOUNT_ROTATOR.md` likewise.
- 54: release notes for the rotator migration, `[y/N]`/Enter = n, and `update` without a usable stdin+stderr TTY not asking.
- 43: the harness prompts' A-22 copy, prompts on stderr, and the setup lines on the output module (it then updates `tests/snapshots/setup/rotator-prompt/*` per variant).

**Pending CI (orchestrator verifies after merge+push)**
1. windows-latest `test-kit` (Node 24, 26): the non-pty tests of `tests/account-setup.test.mjs`. The pty tests skip on win32. In particular:
   - the npm-layout migration with state under `%LOCALAPPDATA%\zcode-agent-kit\installs\<id>`;
   - the fixture proxy CLI through `ZCODE_KIT_BUN=node.exe` running `zcode-proxy-src\run`;
   - the junction for `node_modules`;
   - the 6 prompt snapshots (readline's prompt and echo bytes on Windows are unverified; the files are `-text`).
2. The install.ps1 asking flow. `install.ps1` is unchanged: it runs `setup --harness auto --installer` from the console.
   - A first interactive install asks `[y/N]` once.
   - Re-running the installer over an installation with a stored decision must not ask again.
   - `installer-audit`'s install.ps1 tests (20/130 handling, Node floor) stay green.
   - Real conhost/PowerShell 5.1 rendering stays an owner action.
3. windows `ux-before` leg (pipe, ci): the 8 hand-edited Windows baseline files. If the leg reports `differs:` for them, the `ux-before-now-Windows` artifact holds the fresh capture; commit exactly those 8 files from it.
4. ubuntu `ux-before` leg: green locally (`t42-before-final`).
5. `memory-budget` on both legs: the ratchet is unchanged, and this ticket has no expected-RED entry.
6. ubuntu `test-kit` on Node 24 (local runs were Node 26.7.0 only).

**Common acceptance**
- RED → GREEN at seam 8: ✓ (above).
- Fast suite green on ubuntu: ✓ locally. Windows and `memory-budget`: pending CI.
- New test files: none; the tests went into the wired `tests/account-setup.test.mjs`, and the wiring guard is green.
- Pre-existing test changes justified: ✓.
- Evidence recorded: ✓.
- No new log events, config keys or `ZCODE_PROXY_*` overrides: n/a.

**Acceptance criteria**
- `account-setup` fixtures (seam 8): migration replayed twice, enabled → yes recorded silently, no TTY → no prompt and no hang (timeout-guarded), `--reask` prompts, overrides win. ✓ (`t42-green3`, `t42-full-kit`; mutants M1–M8). The transaction side, including rollback of the migration and of `accounts`, is proven through the CLI in the same fixtures. No `transaction-audit` change was needed.
- Snapshots for the prompt in TTY variants: ✓. `tests/snapshots/setup/rotator-prompt/*` covers the 6 TTY variants, and the refreshed ux-before pty captures cover the 5 TTY variants end to end. The Windows snapshots are pending CI.

### 2026-11-07 — implementer, round 2 (pre-merge CI run 42401136452 RED: the prompt snapshots)

**Commits:** `503bc0a` (fix + tests + snapshots), `2b34269` (merge of the integration tip `ad0d572`, docs only), `b7e4891` (ux-before refresh). The head SHA is the commit that adds this comment.

**Root cause.**
- Node's readline `rl.prompt()` redraws the line with cursor control (`ESC[1G ESC[0J <prompt> ESC[<col>G`) unless the **process's** `process.env.TERM` is `"dumb"`. It ignores the env the kit passes in and the capability record.
- This agent shell runs with `TERM=dumb`, so round 1 recorded the plain path. The CI runners do not set TERM=dumb and took the redraw path; all four `test-kit` legs failed on the 6 snapshots.
- Reproduced locally: `t42-r2-red-term-{xterm-256color,unset}` (6/6 fail, byte-identical to the CI diff).
- It is a C3 defect, not only a test problem. Every setup question (harness questions included, since they share `createPrompter`) carried cursor control under `NO_COLOR=1`: the 7 prompting captures of the committed BEFORE set have `ESC[1G ESC[0J` in their `no-color.ansi`.

**How the bytes are decided now**
- `lib/term/caps.mjs` gains `promptStyle(caps) → { redraw: caps.animate && caps.color }`. The record itself is unchanged.
- `cli/harness-consent.mjs` `createPrompter({ …, platform, redraw })` takes the decision from the output stream's capability record on the first question. It is loaded lazily through `lib/term/load.mjs` `loadPromptStyle`, which loads only `caps.mjs`: the proxy manager imports this module, and its static graph stays free of presentation code (`term-boundaries` green).
- The kit writes the question text itself on every terminal; `rl.prompt()` and its TERM check are gone.
- **redraw** (colour TTY with motion): readline owns the line in raw mode as before. It echoes, edits and redraws the question on resize; Ctrl-C comes through the readline SIGINT event.
- **plain** (TERM=dumb, NO_COLOR, colour off; CI and pipes never ask): readline only reads lines (`terminal: false`). The terminal's line discipline echoes and edits, no byte the kit writes carries an escape sequence, and Ctrl-C arrives as a process SIGINT. A listener is registered only while the prompter is open and takes the same ABORTED path.
- `[y/N]`/Enter = n, the typed-ahead queue, the no-TTY and CI behaviour and `update`'s stdin rule are unchanged.

**Tests** (`tests/account-setup.test.mjs`, `tests/term-caps.test.mjs`; RED `t42-r2-red1`: 16/16 fail on readline's cursor control under the unset process TERM)
- Snapshots of the rotator step and of one per-harness question in the 6 TTY variants (`tests/snapshots/setup/{rotator,harness}-prompt/*`). Each is rendered under process TERM unset, `dumb` and `xterm-256color` and must be byte-identical. The colour variants keep round 1's bytes; `no-color`/`term-dumb` now contain no readline echo (the terminal echoes there).
- No ESC byte in either question under `no-color` and `term-dumb`, also after a resize and an erased key, under all three process TERM values.
- `promptStyle` rule: redraw on a colour TTY (TERM set or unset, conhost), never under NO_COLOR, TERM=dumb, CI, `--color=never` or a pipe (forced colour included).
- The touched suites (account-setup, harness-consent, cli-commands, term-*, update, test-wiring) passed 279/279 under each process TERM value (`t42-r2-green3-{dumb,xterm-256color,unset}`). Under `TERM=dumb` the pty Ctrl-C tests (account-setup and harness-consent) run the plain path, where Ctrl-C is a SIGINT from the line discipline; under the other two values they run the redraw path.
- Mutations (`t42-r2-mutants`, committed tree, each file restored from HEAD, `cli`/`lib` clean afterwards):
  - R1, `rl.prompt()` again → 8 colour-variant snapshots fail;
  - R2, redraw without colour → both NO_COLOR scans and the rule test fail;
  - R3, always `terminal: true` → 4 plain snapshots and 4 scans fail;
  - R4, plain mode without the SIGINT listener → both pty Ctrl-C tests fail.

**Harness consent prompts:** they had the same exposure (the same `createPrompter`) and are fixed by the same change. There were no byte snapshots of them before; `harness-prompt/*` is new. The existing harness-consent tests match by substring and needed no change.

**Pre-existing test change (justified):** `tests/account-setup.test.mjs` "terminal redraw keeps the y/n question visible before and during input" now waits for the question before its first assertion. The question is drawn after the capability record has loaded, one async step later. The test's assertions are unchanged.

**ux-before:** 49 Linux files refreshed from `t42-r2-before1`, in the 7 prompting scenarios.
- `tty-color-80`/`-120`/`ascii-locale`: `.ansi` only, with the redraw bytes gone from the question line.
- `no-color`/`term-dumb`: the questions carry no escape sequence, and answers typed ahead appear once, where they were typed (the line discipline's echo at the top of the capture), instead of a second time after each question (readline's raw-mode echo).
- `linux/INDEX.md` lists the refresh. The Windows baseline (pipe/ci only, no question) is unchanged.
- Remaining ESC bytes in `no-color`/`term-dumb` captures are not prompts: SGR from `setup-output`/install.sh under TERM=dumb (A-13, the setup and installer batches 43/44), git's `ESC[K` in `update-checkout`, and the TUI (48).
- `t42-r2-before-final`: 1/1.

**Full suites** (merged head `2b34269` + `b7e4891`; Node 26.7.0, Bun 1.4.2)
- `npm run test`, TERM unset (`t42-r2-full-kit`) and TERM=dumb (`t42-r2-full-kit-dumb`): each 776 tests, 757 pass, 0 fail, 19 skipped.
- `npm run test:proxy`: 1343 pass, 0 fail.
- `npm run test:proxy-typecheck`: exit 0.
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged.
- `npm run test:ux-before`: 1/1.

**Pending CI (in addition to round 1's list)**
1. All four `test-kit` legs: the 12 snapshots and 4 scans, now independent of the runner's TERM.
2. windows-latest: the redraw path through readline on conhost and Windows Terminal (raw mode as before). The `wgl4` snapshot is rendered with forced streams, so it does not depend on the runner's console. Ctrl-C in the plain path on a Windows console (NO_COLOR set) arrives as SIGINT; there is no automated proof of it on Windows, so it stays an owner check.
3. The ubuntu `ux-before` leg against the 49 refreshed files.

### 2026-11-07 — implementer, round 3 (restaged run 42408170742 RED on windows test-kit: CRLF)

**Commits:** `04dfbaa` (product fix, fixture fix, tests) and `eefca1e` (merge of the integration tip `f7d73d3`, docs only). The head SHA is the commit that adds this comment.

**Fixture (the CI RED).**
- The windows checkout has `proxy/config.example.yaml` with CRLF line endings, so `kitFixture`'s `/^  accounts:\n(?:    .*\n)+/m` did not match and the "pre-rotator" config kept its accounts block. The same exposure affected `/^    enabled: false$/m`.
- The fixture now normalises the example to LF once on read, then writes the user config with the requested line endings (new `eol: "lf" | "crlf"` option). A second shape assertion pins `enabled: <value>` too.
- Reproduced locally (`t42-r3-mutants` W1): CRLF example plus the round-2 fixture gives `fixture config shape`, as on CI. W2 shows the same CRLF example with the fixed fixture: 8/8 green.

**Product code: affected.**
- Reads were already correct on CRLF:
  - the migration's `configuredRotator` and the mismatch check parse with the `yaml` library;
  - `ctx.port()`'s `/^  port:\s*(\d+)/m` matches before `\r`.
- The rewrite was wrong. `configureAccountRotator` (setup's answer or override, `accounts enable|disable`) wrote `String(doc)`, and the yaml library renders LF, keeping CRLF only inside carried-over comments. Measured on the example config: 10 CRLF and 56 bare LF line breaks, content otherwise identical. A Windows user's config came back with mixed line endings.
- Fix: `withLineEndingsOf(source, text)` writes the document with the file's own line endings (majority rule: CRLF throughout when CRLF breaks outnumber bare LF, else LF). Only line-break bytes change; what is written, when, and the import order are unchanged (B1).

**Tests** (`tests/account-setup.test.mjs`, +3; RED `t42-r3-red1`: all 3 fail with `no bare LF in the rewritten config`). For a CRLF config with `enabled: true`, `enabled: false` and `auth.accounts` absent:
- `setup` replayed twice without a terminal gives the decision as on LF (`yes/migration` or undecided), with the config byte-identical.
- `setup --account-rotator y|n`, then the opposite through `accounts enable|disable`. Each must produce exactly the LF fixture's bytes with CRLF line endings, no bare LF, `auth.accounts.enabled` exactly once with the right value, and the decision recorded. Each replay leaves the config byte-identical.
- Mutations (committed tree, restored from HEAD, clean afterwards): M1, a rewrite without line-ending handling, makes the 3 CRLF tests fail; M2, always CRLF, fails them too, because an LF config must stay LF.

**Suites** (merged head `eefca1e`; Node 26.7.0, Bun 1.4.2)
- `npm run test`: 779 tests, 760 pass, 0 fail, 19 skipped.
- `npm run test:proxy`: 1343 pass, 0 fail.
- `npm run test:proxy-typecheck`: exit 0.
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged.
- `npm run test:ux-before`: 1/1, with no visible change in this round.

**Pending CI:** windows `test-kit` (Node 24, 26), the CRLF tests and the pre-rotator test on the CRLF checkout. Round 1–2's list otherwise stands.

**Not covered here:** `bootstrap` creates `config.yaml` from the example, keeping the checkout's line endings, and other writers of `config.yaml` outside this ticket (harness adapters, upstream-config) were not audited. This round covered only the Account Rotator paths.

- Merged 2026-11-07 as 928565e28a52788fda5c37ef49e2c9f004c20ec8 (ticket/42-account-rotator-asked-once at 99310eb into f2c0e74; first merge, no revert-of-revert step); fast suite: kit 780/799 (19 skipped, 0 fail), proxy 1354/1354, mcp 95/96 (1 skipped, 0 fail); also `npm run test:ux-before` 1/1 and `npm run test:proxy-typecheck` exit 0; mcp dist unchanged; no lockfile changes; clean merge (no conflicts, none in non-.scratch files after tickets 65 and 32 landed). Sanity: `git diff staging/42 HEAD` over the 143 non-.scratch files ticket 42 changed (from merge-base f7d73d3) is empty (every file matches the staging/42 4eff3c6 tree CI judged). Pre-merge CI (draft PR #24, staging/42 4eff3c6), green on all 8 jobs: https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42415962768 (earlier rounds: 42401136452 readline cursor control in CI, fixed in round 2; 42408170742 CRLF fixture + configureAccountRotator bug, fixed in round 3 04dfbaa). Logs: .scratch/kit-overhaul/reports/merge-42-{npm-ci,test,proxy,mcp,ux-before,proxy-typecheck}.log.
