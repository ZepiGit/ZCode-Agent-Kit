# 40: UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details

**Blocked by:** 38 (Manager `doctor` returns check records; `zcode-kit doctor` stops parsing text), 06 (CLI output module, capability record and the snapshot harness (no visible change))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0001, 0005

**What to build:** These commands render through `Out`: `doctor` shows each check once, a problem-count lead line when anything failed, one verdict line, off-TTY grammar `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` with today's names; `WARN` additive, exit 0, never applied to a condition that FAILs today. Status state line in human units (A-17). Connection details printed once per command, unboxed, ≤ 80 columns, key shown only on an interactive TTY, routes in `--verbose`/JSON (A-12). Reports on stdout, diagnostics on stderr, every error with what/why/next (`Run setup first (node setup.mjs)` → `zcode-kit setup`). Additive `proxy logs --level`/`--grep` filters (A-23). Closes A-02, A-05/A-09 (these commands), A-12, A-17, A-20, A-23.

**Acceptance criteria:**

- [ ] Snapshots updated in every C3 variant on both legs; the diff reviewed against design-language.md.
- [ ] Off-TTY regex test over every doctor fixture; WARN never changes an exit code; a check that FAILs today is never WARN (fixture matrix).
- [ ] JSON superset tests pass; connection-details reveal-rule suite passes.
- [ ] Stream routing asserted through real spawns (seam 5).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 89, 90, 91, 92, 93, 95, 105

## Comments

### 2026-11-09 — implementer (ticket 40)

**Branch:** `ticket/40-doctor-proxy-ux` (worktree `/home/AgentKit/wt/t40`), from `overhaul/stability-terminal-ux` at e22326e. The integration tip is merged twice: eac7483 (tickets 16, 18, 30; one conflict, the `npm run test` file list in package.json, resolved by taking the tip's list and adding the three new files) and 75f5a15 (ticket 73, no conflict). The last code commit is e32d372. The head SHA is the commit that adds this comment.

**What landed**
- `lib/term/out.mjs` (output module): three new records, `lead` (the doctor's problem count), `state` (a state line: the word in the text, the glyph on a TTY only) and `blank`. The connection card fits 80 columns: a short redaction marker `REDACTED_KEY_CARD`, routes only with `verbose`, `(configured; live list unavailable)` when a verified proxy's model list came from the config, and a shorter non-loopback warning. Prose in a wide script with no spaces (CJK) now wraps between grapheme clusters on a TTY; paths, URLs and keys still never break.
- `cli/doctor-report.mjs` (new, pure): checks → records. It emits a lead line when something failed, then the checks once each under Runtime / Proxy / Account / Integrations / Upstream in their original order, why/next under every FAIL (the check's own first, else a default per check name), and one verdict line `doctor: N failed, … -> exit 1`. `checkStatus` derives PASS/FAIL/WARN/SKIP: `ok === false` is FAIL whatever else the check says; WARN needs `ok === true` and `warn: true`. The `--json` document is today's `{ ok, failed, skipped, checks }` plus `warned` and a per-check `status`.
- `cli/commands/doctor.mjs`: renders through `doctor-report`, and the manager report is no longer printed first (A-02). A check record may carry `warn`/`why`/`next` (manager or adapter). `--fix` runs the lifecycle's `ensureRunning` in-process (the manager CLI is no longer spawned). Its progress goes to stderr through `ctx.step`, and so do the repair lines and the undo line. It prints no connection details.
- `lib/proxy-status.mjs` (new): `readProxyStatus({ lifecycle, fetch })` → status record, `readConnectionFacts`, `statusDocument` (the `--json` document) and `statusExitCode`. The manager CLI's `status`/`status --json` render this record. Their bytes are unchanged:
  - a scratch probe gave 20 manager outputs (10 fixture states × text/JSON), identical before and after apart from the probe's own pid;
  - two new tests in `tests/connection-details.test.mjs` pin the text byte for byte, with expectations taken from the pre-change output. They pass on the tip's manager and on the branch.
- `lib/proxy-logs.mjs` (new): `readLogTail(file, { n, level, grep, redact })` and `lineLevel`. The manager CLI's `logs` uses it, with the same bytes.
- `cli/proxy-report.mjs` (new, pure): the status records (state line in human units, then Memory, Quota, Captcha and the card), and the start/stop results with what/why/next error blocks per lifecycle outcome.
- `cli/commands/proxy.mjs`, `status.mjs`, `logs.mjs`: the lifecycle intents and the status record now run in-process, with no manager spawn:
  - `proxy start`, `stop` and `restart` (restart = stop, then start; a refused stop ends it) put a progress row and then a result row or error block on stderr. After a successful start the card goes once to stdout. Exit codes are the lifecycle's. An intent that throws is exit 1, the manager CLI's `manager error` code.
  - `proxy logs [n] [--level warn|error] [--grep <text>]` prints the lines as data on stdout. A missing log is an INFO note on stderr. A bad filter is an error block, exit 2.
- `cli/zcode-kit.mjs`: text and JSON records are written as before. Every other record kind goes through the output module, which is loaded on first use only. The ctx gains `terminal.stdout` (for the reveal rule) and `step`.
- `lib/proxy-lifecycle.mjs`: the two "run setup first (node setup.mjs)" texts now name `zcode-kit setup` (A-09).
- Payload: `pack/verify-payload.mjs` now requires `lib/proxy-status.mjs`, `lib/proxy-logs.mjs`, `cli/doctor-report.mjs` and `cli/proxy-report.mjs`. The new manager imports the first two.

**Acceptance criteria**
- [x] *Snapshots in every C3 variant on both legs, reviewed against design-language.md.*
  - `tests/cli-ux-doctor.test.mjs`, `tests/cli-ux-proxy.test.mjs`: 6 doctor fixtures, 9 status fixtures and 14 start/stop/restart fixtures. Each is rendered in all 8 C3 variants (tty-color-80/120, no-color, pipe, term-dumb, ci, ascii, wgl4) and stored in `tests/snapshots/cli/`, 464 files, `.out` and `.err` separately.
  - Two fixtures carry CJK data. Every line of every `tty-color-80` status/proxy render is pinned to ≤ 80 columns.
  - New Out fixtures (`lead-state`, `connection-verbose`) are under `tests/snapshots/term/`.
  - The suite runs in `npm run test` on both OS legs. Windows: pending CI (orchestrator verifies).
  - ux-before baselines:
    - `tests/ux-before/linux` is refreshed for exactly the 154 captures that changed (22 scenarios, listed with the changes in its INDEX.md under "Ticket 40").
    - `tests/ux-before/windows`: the pipe and ci files of the same scenarios (68 files) were derived line for line from the Linux captures, with the two Windows facts that baseline already showed. Pending CI.
- [x] *Off-TTY regex test over every doctor fixture; WARN never changes an exit code; a FAIL is never WARN (fixture matrix).*
  - `cli-ux-doctor`, "off a TTY each check is one grammar row …": every fixture in pipe, ci and term-dumb. Every line is one of: a grammar row `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` (today's names, each exactly once), a whitespace-indented why:/next: line, a section header, the lead (only when something failed, first line) or the verdict (exactly one, last line). Anything else fails.
  - "the spawned zcode-kit doctor reports (manager-doctor fixtures) …" applies the same classifier to the five real spawned states of `tests/manager-doctor.test.mjs`, whose snapshots that file compares with live runs.
  - "WARN never changes the exit code …": the matrix ok ∈ {true, false, null} × warn ∈ {absent, false, true}. The text row is FAIL whenever `ok === false`. The exit code, the JSON `failed`/`warned`/`status` and the verdict's `-> exit 1` follow `ok === false` only.
- [x] *JSON superset tests pass; connection-details reveal-rule suite passes.*
  - `tests/json-superset.test.mjs` passes. The live `doctor --json` now carries `warned`/`status`; the shape baseline still comes from the pre-change capture, kept in `tests/ux-before/json-before/doctor/doctor-json/pipe.txt` (`json-shapes.mjs` reads it before the refreshed BEFORE capture).
  - `kit-doctor-json` snapshots differ only by the additive keys: a parse check showed each document equal to the pre-change one once `warned` and `status` are removed, with the same exit codes.
  - Status and `proxy status` `--json` stay byte-identical (`proxy-status-json-*` and `status-json-*` captures unchanged).
  - The reveal rule: `cli-ux-proxy` "connection details reveal rule …". The key is in the card only when stdin and stdout are TTYs and CI is unset or 0. Never in a pipe or CI variant, never in JSON, and in `proxy start` only on a terminal. The existing `tests/connection-details.test.mjs` passes.
- [x] *Stream routing asserted through real spawns (seam 5):* `tests/cli-ux-streams.test.mjs`, six tests. The real entry runs in a temp kit copy against a stand-in proxy on a free port:
  - `status`/`proxy status` of the own proxy: stdout only, exit 0, no key in the pipe;
  - a foreign listener: `proxy status`, `start` and `stop` write only an error block to stderr (exit 1/3/3);
  - `proxy start` already running: the result row on stderr, the card once on stdout;
  - no key: start exit 5 and status exit 1, both naming `zcode-kit setup`;
  - `proxy logs`: data on stdout, filters, a note or an error block on stderr;
  - `doctor`: stdout only, one verdict.
- [x] *Tests start RED and turn GREEN at the named seam* (logs under the integration worktree's `reports/`):
  - `t40-red-out`: the new Out tests fail (the card marker export does not exist).
  - `t40-red-doctor`: 17 of 18 doctor tests fail on the tip's command. The checks appear twice, there is no lead, verdict or why/next, and there is no WARN.
  - `t40-red-proxy`: 34 of 34 fail on the tip's commands, which spawn the manager.
  - `t40-red-streams`: 6 of 6 fail on a checkout of the tip (2b4e2e0).
  - Payload: the tip's verify-payload accepts a payload without `lib/proxy-status.mjs`; the branch refuses it.
  - CJK wrap: the vector fails on the Out of 50adde8 and passes after 11abe6d.
  - All are GREEN in the final runs.
- [x] Fast suite green on ubuntu (below); windows and `memory-budget`: pending CI.
- [x] New test files (`cli-ux-doctor`, `cli-ux-proxy`, `cli-ux-streams`) are wired into `npm run test` (the wiring guard passes). Their data port is recorded in `scripts/fixture-ports.mjs` (18458, data only); the spawn tests take free ports.
- [x] No new log events, no new config keys, no new `ZCODE_PROXY_*` override.

**Intended visible changes (before → after; files `git show 4bce908:tests/ux-before/linux/<path>` → `tests/ux-before/linux/<path>`)**
1. `doctor` (all 9 doctor scenarios):
   - each check is printed once (before, the 13 manager checks came twice, with two summary lines);
   - a lead line `N problems: N failed[, N warnings]` when something failed;
   - section headers `Runtime`/`Proxy`/`Account`/`Integrations`/`Upstream`;
   - `  why: …`/`  next: …` under every FAIL;
   - the verdict `doctor: 3 failed, 4 passed, 12 skipped -> exit 1` (before: `doctor: 3 check(s) failed` / `doctor: N skipped, 0 failed — OK`);
   - on a TTY: glyph + word, colour, aligned columns, wrapped details.

   Check row names and the off-TTY row bytes are unchanged; rows are reordered into their groups.
2. `doctor --json`: `+ "warned": 0` and `+ "status": "pass|fail|skip"` per check (additive).
3. `doctor --fix`:
   - repairs, the undo line and the proxy start progress go to stderr;
   - `Proxy start (--fix) ...` / `OK  Proxy start (--fix) - started (pid …)` replaces `starting zcode-proxy ...` / `started … — healthy` / `doctor --fix: proxy started`;
   - no connection details.
4. `status` / `proxy status`:
   - running: `port:`/`pid file:`/`health:` become `running on 127.0.0.1:18458, up 1 h 02 min (pid …)`. Memory, Quota (`4120 of 6000 prompts left (69 %), expires 2027-01-01`) and Captcha (`96 %`, `2026-11-05 11:50 UTC`) follow, then the card;
   - down: `stopped (port 18458)` + `next: zcode-kit proxy start`, then the card;
   - foreign / no key: error blocks on stderr, nothing on stdout;
   - the card: `Connection details (manual clients) ---…`, unboxed, 80 columns, redaction `(redacted — print it with: zcode-kit models --show-key)`, routes with `--verbose`.
5. `proxy start|restart`: `Proxy start ...` + `OK  Proxy start - started (pid …)` (or `already running`) on stderr, the card on stdout. Before, both went to stdout as manager narration plus the old 6-line card.
6. `proxy stop`: `Proxy stop ...` + `OK  Proxy stop - stopped (pid …)` / `SKIP  Proxy stop - not running` on stderr (before, on stdout).
7. Errors:
   - `ERROR: port 18458 is occupied by a foreign service (auth failed). Not touching it.` (stdout) becomes `FAIL  Port 18458 is in use by another service` + why/next/exit 3 (stderr);
   - `… Run setup first (node setup.mjs).` becomes `FAIL  The local proxy key is missing` + `next: zcode-kit setup` + `exit: 5` (A-09). The lifecycle's own narration (manager CLI, proxy.log) now says `Run setup first: zcode-kit setup`.
8. `proxy logs` without a log file: `(no log file at …)` on stdout becomes `INFO  no proxy log yet at …` on stderr, exit 0. New additive filters `--level warn|error`, `--grep <text>`.
9. Unchanged (byte-identical in the capture): `proxy logs`, `proxy logs 5`, `proxy/status --json`, `doctor --forget*`, and every scenario outside doctor/proxy/status (`help`, setup, update, run, accounts, auth, models, install, integrate, rollback, uninstall, tui). A first full capture (`t40-capture1`, 640 captures) differed from the BEFORE set in exactly the 22 refreshed scenarios. After the refresh and the last code change, `t40-capture3` (doctor/proxy/status/run) has 0 differences.

**Snapshot diff summary**
- `tests/snapshots/term/connection-*`: the shorter marker and warning.
- `tests/snapshots/manager-doctor/kit-doctor-text/*`: the new report.
- `tests/snapshots/manager-doctor/kit-doctor-json/*`: additive keys only.
- New: `tests/snapshots/cli/**` and `tests/snapshots/term/{lead-state,connection-verbose}`.
- The manager CLI's own `manager-doctor/*.txt` snapshots are unchanged.

**Preservation proofs (deliberate mutations; implementation committed first, each mutant restored with `git checkout <sha> -- <file>`, `git status` clean after; `t40-mutations`, `t40-mutations2`):** all 17 mutants were killed:
1. a FAIL that says warn becomes WARN;
2. a lead line without a failure;
3. a check printed twice;
4. WARN counted toward the verdict's exit (first survived; killed after the matrix gained the verdict assertion);
5. the card's key shown on a pipe;
6. the reveal rule ignoring stdin and CI;
7. routes without `--verbose`;
8. a foreign status as a warn block;
9. the doctor verdict moved to stderr;
10. the `--level` filter dropping ERROR lines;
11. grep before redaction;
12. a status `--json` key renamed;
13. a manager status label changed (first survived; killed after the byte-pin tests were added);
14. the spinner rule matching any label;
15. a start error naming `node setup.mjs`;
16. a restart that starts after a refused stop;
17. removing `json-before/` (the committed JSON baseline test fails).

**Full suites** (Bun 1.4.2, Node 26.7.0, after both merges):
- `npm run test` (`t40-final-test2`, after e32d372): 1078 tests, 1060 pass, 0 fail, 18 skipped. The new and changed test files add 63 tests in the three new files, +6 in term-output, +2 in connection-details and +2 in ux-before-capture; 5 superseded forwarding tests were removed from cli-commands.
- `npm run test:proxy` (`t40-final-proxy`): 1598 pass, 0 fail, 107 files.
- `npm run test:mcp` (`t40-final-mcp`): 107 tests, 106 pass, 1 skipped. `dist/` unchanged.
- `npm run test:ux-before` (`t40-final-uxbefore`): 1/1, Linux, seven variants, against the refreshed baseline.
- `node scripts/verify-golden-path.mjs` (mock, runs `doctor --fix --harness omp --json`; `t40-final-golden`): exit 0.

**Metrics delta (memory loop S3/short, linux; the ticket changes the import graph of the `zcode-kit run` launcher):**
- Tip e0962b7 ×2 (`t40-memloop-s3-tip1/2`): launcher 78.8 / 78.9 MB, preflight 71.7 / 71.5 MB.
- Branch before e32d372 ×3: launcher 79.1 / 79.1 / 79.0 MB. The report builders were imported by the entry for every command.
- Branch at e32d372 ×2 (`t40-memloop-s3-branch4/5`): launcher 78.9 / 78.8, preflight 71.6 / 70.8. The builders now load on use.
- RED keys are the same set as the tip's: `peak:kit`, `procPeak:launcher` (owned by 37) and the flip `procPeak:proxy`. `expected-red.json` is unchanged; this ticket owns no entry.

**Decisions taken (spec/ADRs silent)**
1. **The proxy commands, `status` and `doctor --fix` run the lifecycle intents and the status record in the kit process instead of spawning the manager CLI.** Rendering through Out needs the outcome records (ticket 15's interface) rather than the manager's stdout, and reading that stdout would be text parsing (what 38 removed).
   - The respawn hook target stays this kit's `proxy/zcode-proxy-manager.mjs` (`managerPath(kit)`).
   - The start lock and the per-spawn environment are the lifecycle's, so tickets 16, 17 and 18 apply unchanged. 17's signal release must live in the lifecycle (where the lock lives) to cover `zcode-kit proxy start`, not only in the manager CLI's main. This is recorded for 17.
   - The manager CLI keeps its own text for start/stop/restart/status/logs; the memory loop and the golden path drive it.
2. **The result row of start/stop/restart is progress (stderr).** Only the card is stdout. ADR-0005 lists `proxy start|stop` results under neither stream; §4.10 makes the row the end of the progress line. Scripts read the exit code; the manager CLI still prints its narration on stdout.
3. **The status state line reads `running on 127.0.0.1:<port>, up 1 h 02 min (pid N)`** instead of the design's `running since 1 h 02 min`, which is not idiomatic English. The pid is the pid record's, and the uptime comes from `/health` details. Dates are UTC (`YYYY-MM-DD`, `YYYY-MM-DD HH:MM UTC`) so renders are deterministic.
4. **The WARN JSON value:** `status` on every check plus `warned`, while `ok` keeps today's values; a WARN has `ok: true`. Round 1 Q10 says "the JSON status gains the value additively"; a key present on every check is easier for strict consumers than one that appears only for WARN.
5. **The lead line is `N problems: N failed[, N warnings]`** and is shown only when something failed. It must not start with `doctor:`, so that `grep '^doctor:'` keeps exactly one line (the verdict).
6. **Default why/next per check name.** They live in `cli/doctor-report.mjs`, and a check record's own why/next win (41's checks bring theirs). `next` lines are commands short enough for the TTY column. Human actions go into `why`, because Out never wraps a `next` command.
7. **Card redaction:** a short marker `REDACTED_KEY_CARD`, so the card fits 80 columns in a pipe. `REDACTED_KEY` itself is unchanged (setup, the manager CLI and the tests use it).
8. **Logs filters see the redacted lines** (a `--grep` for the key matches nothing). With a filter, the window is the last 1 MiB instead of 64 KiB.
9. **ux-before:** the TTY captures of the lifecycle steps hold spinner frames whose count depends on timing. `compare.mjs` folds a run of frames of the kit's own step labels into one marker and drops the step's elapsed time; this is pinned by two tests in `ux-before-capture.test.mjs`. Two after-captures matched each other with 0 differences.

**Pre-existing test changes (justified)**
- `tests/cli-commands.test.mjs`:
  - the doctor tests now assert the report records (check rows once, lead, verdict, `status` in JSON) instead of the legacy text with its first manager block;
  - the five forwarding tests (status/proxy exit codes through `spawnSync`, `--json` forwarded, the logs line count forwarded) pinned the manager spawn this ticket replaces. Their properties (exit codes 0-5 and 0/1, `--json`, line count) moved to `cli-ux-proxy`.
- `tests/cli-kit.test.mjs`:
  - `makeMiniKit` copies the shared tui token set and width core (the payload ships them, ADR-0011);
  - the doctor summary assertion reads the new verdict line.
- `tests/manager-doctor.test.mjs`:
  - the kit fixture copies the shared tui files;
  - the kit-doctor snapshots were refreshed with UPDATE_SNAPSHOTS=1 (text: the new report; JSON: additive keys);
  - the Windows-spelling test follows the new line numbers. The logged CI lines are unchanged, and the JSON detail lines are compared without the trailing comma that `status` now adds;
  - the fake-Bun test expects `status: "pass"`;
  - two titles and the header comment now describe the refreshed origin.
- `tests/term-output.test.mjs`: the card's redaction marker assertion names `REDACTED_KEY_CARD`.
- `tests/term-snapshots` data: `term/connection-*` re-rendered with the shorter marker and warning.
- `tests/release-audit.test.mjs`: the package fixture lists the four new required files (as 38 did).
- `tests/term-boundaries.test.mjs`: the reader guard covers the migrated command modules and the report builders.
- `tests/ux-before/json-shapes.mjs`: reads a frozen pre-change copy when a BEFORE capture was refreshed. `tests/ux-before/compare.mjs`: the two volatile rules.
- `scripts/fixture-ports.mjs`: records 18458 as data for `cli-ux-proxy`.

**Pending CI (orchestrator verifies after merge+push)**
- `test-kit` windows-latest (Node 24, 26): the three new files, the refreshed `manager-doctor` snapshots (windows expectation path) and `cli-ux-streams` (Windows paths in the error blocks).
  - The doctor fixtures empty PATH and point APPDATA at the temp home, so no runner-installed harness changes the rows.
- `ux-before` windows: the 68 derived files. Most likely to need a CI-backed correction: `proxy-stop`/`proxy-restart` (exit 4, the refused-stop block) and any path I did not see in the old Windows files.
- `memory-budget` both legs: S3 unchanged on Linux (above).
- PowerShell 5.1 stderr gate for the extra stderr lines of these commands: ticket 44 owns the gate (ADR-0005). These commands' exit codes are unchanged.

**Left for other tickets**
- 41: the manager CLI's legacy `doctor` prints `PASS` for a check with `warn: true`. No such check exists yet; 41 adds the first ones and should render `WARN` there too (the grammar allows it).
- 45: help and the `proxy` usage line still say `logs [n]`; they should document `--level`/`--grep`, `--verbose` routes and `WARN`. The `proxy`/`doctor` usage errors are still verbatim text records.
- 22: stop/restart progress during the grace period builds on `ctx.step("Proxy stop")` and `finishStop` (`cli/proxy-report.mjs`).
- 39: the observability fields go into `lib/proxy-status.mjs` (one record for the manager and the kit) and `statusRecords`' Memory section.
- 17: see decision 1 (signal release in the lifecycle covers the in-process start).
- 54: release notes:
  - the stream move for these commands;
  - the doctor layout and verdict line;
  - `warned`/`status` in `doctor --json`;
  - `--level`/`--grep`;
  - the card wording.

### Round 2 (2026-11-09) — ux-before ubuntu red on the bun row

Branch `ticket/40-doctor-proxy-ux`, integration tip merged (929a90d, clean), fix 081dc00.

**Cause.** Pre-merge CI run 42590699086 (staging/40 5c24049) failed `ux-before (ubuntu-latest)` on 48 files: the 80-column variants (`tty-color-80`, `no-color`, `ascii-locale`, `.txt`+`.ansi`) of the 8 doctor scenarios with a `bun available` row. Bun was found and probed (the version was there); the doctor's TTY row wraps its detail by the real path's length, and only then does normalise() write `<BUN>`. The round-1 refresh ran Bun from `/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin/bun` (realpath `…/node_modules/bun/bin/bun.exe`, 60+ chars): col 34 + path > 80, so `(1.4.2)` went onto a continuation line. The CI runner's `/home/runner/.bun/bin/bun` fits, one line. The baseline was host-dependent, not CI wrong. Reproduced locally before the fix: a doctor-only capture with a 19-char `UX_BUN` symlink gave exactly CI's 48 diffs against the round-1 baseline.

**Fix (no kit change, compare.mjs untouched).** `tests/ux-before/capture/host.mjs` `pinBun`: on POSIX the fixtures run Bun through a fixed-length symlink `<tmp>/ux-bun-XXXXXX/bun` (removed on exit); capture.mjs writes both the pinned and the host spelling back as `<BUN>`. Windows keeps the host path (pipe/ci never wrap). The normalisation rule is the tip's: path → `<BUN>`, version kept, a non-1.4.2 Bun written back as `(1.4.2)`; every capture now shows `<BUN> (1.4.2)` on one line, as the BEFORE set and `json-before/` do. Not an intended visible change: the round-1 continuation line was a capture artefact.

**Baselines.** Full Linux recapture (`t40-recapture`, 640 ok) vs the round-1 baseline: exactly 48 files differ, all in the bun row (+48/−96 lines: the row gains ` (1.4.2)`, the continuation line goes); copied those 48 only, plus one INDEX.md "Refreshed on purpose" line. Windows (`tests/ux-before/windows`): unchanged; its 16 plain rows and 2 JSON details already read `<BUN> (1.4.2)`.

**Tests.** `tests/ux-before-capture.test.mjs` +4: pinBun on POSIX (fixed path whatever the host directory), Windows (host path, no symlink), capture.mjs wiring, and a Linux end-to-end capture of `doctor-fresh` (3 × 80-column variants) with Bun under a short (38 chars) and a long (94 chars) directory, both byte-equal to the baseline. RED: against the round-1 baseline (short directory: the CI diff). Mutation: `pinBun` returning the host path → the POSIX unit test and the long-directory capture fail; restored from 081dc00, `git diff` empty.

**Suites (after the merge).** `npm run test` 1087 tests: 1069 pass, 0 fail, 18 skipped. `npm run test:proxy` 1627 pass, 0 fail (109 files). `npm run test:mcp` 116: 115 pass, 0 fail, 1 skipped. `npm run test:ux-before` (Linux, 7 variants): 1/1 pass. Pending CI: `ux-before (ubuntu-latest)` and windows (orchestrator verifies after merge+push).
