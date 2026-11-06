# 06: CLI output module, capability record and the snapshot harness (no visible change)

**Blocked by:** 05 (Shared width core and token set (two renderers, one token set))

**Status:** resolved

Model: glm

Risk: medium

ADR: 0001, 0005, 0011

**What to build:** `createOutput(...) → Out` with one capability record per stream (colour precedence flag > NO_COLOR > FORCE_COLOR > CLICOLOR_FORCE > non-TTY > TERM=dumb > CLICOLOR=0; glyph tier with `ZCODE_KIT_UNICODE` override; `animate` = TTY && TERM≠dumb && !CI; width with min 40, no truncation off a TTY) and the design-language §9 primitives (`heading`, `kv`, `check`, `result`, `table`, `connection`, `verdict`, `next`, `data/json` on stdout; `error`, `warn`, `note`, `step → Progress` on stderr). The ascii copy mapping never touches the off-TTY check-row separator ` — ` or the verdict words (Round 4 D1). Rendering loads lazily. The snapshot harness renders records with forced capabilities in every C3 variant, compares bytes (ANSI included), uses an explicit normalisation list, is exempt from line-ending conversion in `.gitattributes`, and writes only with `UPDATE_SNAPSHOTS=1`. A JSON key/type baseline of every `--json` output is captured once from the pre-change code and committed.

**Acceptance criteria:**

- [ ] Capability-record unit tests cover every precedence branch, including NO_COLOR beating FORCE_COLOR and non-UTF-8 POSIX locale → ascii, wgl4 on win32 without WT_SESSION/TERM_PROGRAM.
- [ ] A regex test pins `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` with whitespace-indented `why:`/`next:` lines for `check()` off a TTY in every glyph tier (seam 5).
- [ ] The Phase 1C BEFORE set and its tooling (`.scratch/kit-overhaul/ux/capture/` and `ux/before/`, 640 captures at 0960696) are committed under `tests/` as the step 1–2 baseline. A before-equivalence test re-runs the capture and compares byte for byte: all seven variants on ubuntu (pty via `script`); on windows-latest the pipe and ci variants, whose Windows baseline is captured from this ticket's base commit before the change and committed. This test is the proof of 'no visible change' for 06–08.
- [ ] The JSON baseline (key names + value types) is committed; a superset test runs in `npm run test`.
- [ ] No module other than the output module reads `isTTY`, `NO_COLOR`, `TERM`, `CI` or `columns` in code this ticket touches (grep test for new code).
- [ ] A scan asserts that no ESC byte appears in any NO_COLOR, pipe, TERM=dumb or CI render of the primitives' fixtures (Story 107).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 89, 106, 107, 108, 123

## Comments

- 2026-11-06 (orchestrator, from tickets 05 and 14): once commands import `lib/term/`, the mini-kit fixtures that copy only `cli/` and `lib/` (cli-kit, cli-audit, setup-regressions, harness-consent, auto-heal, verify-golden-path, ux/capture file list) must also copy `zcode-proxy-src/src/tui/{width-core,tokens}.mjs` (+ `.d.mts`) — justify the fixture change, never fork the core (ADR-0011). With those fixtures in place, ticket 14's checked duplicate `lib/event-line.mjs` can become a re-export of `zcode-proxy-src/src/log/event-line.mjs` the same way; do it here if it stays within this ticket's window, otherwise record it for ticket 15.

### 2026-11-06 — implementer (logged substitute for glm-5.3-flash)

**Branch:** `ticket/06-cli-output-module` (worktree `/home/AgentKit/wt/t06`), base `3f4e41a`. Commits `854265e` (BEFORE set + equivalence), `be29e0f` (capability record, output module, snapshot harness), `1d37261` (JSON baseline + superset); integration tip `97c2211` merged in `ec7929c` (conflicts in `ci.yml` and `package.json`, both sides kept). The head SHA is the commit that adds this comment. Logs: `.scratch/kit-overhaul/reports/t06-*.log` in the integration worktree.

**What landed**
- `lib/term/caps.mjs`: `detectCaps(stream, { env, flags, platform }) → { tty, color, glyphs, animate, width, fixed, plain }` (frozen). It is the only reader of `isTTY`/`NO_COLOR`/`TERM`/`CI`/`columns`.
- `lib/term/out.mjs`: `createOutput({ stdout, stderr, env, flags, platform, json, clock }) → Out` with the design-language §9 primitives: `heading`, `kv`, `check`, `result`, `table`, `connection`, `verdict`, `next`, `data`, `json` on stdout and `error`, `warn`, `note`, `step → Progress` on stderr. Also `renderRecords(out, records)`, where a record is `{ kind, ...args }` and every record is validated before anything is written.
- `lib/term/load.mjs`: `loadOutput()` / `loadRenderRecords()`, the lazy entry point.
- No command renders through any of it yet (no visible change). Commands move over in 07/08 and 40+.
- `tests/ux-before/`:
  - `capture/`: the Phase 1C tooling;
  - `linux/`: the 640 captures at 0960696, verbatim (copied from `ux/before`, which has a single commit, `cafe516`);
  - `compare.mjs`;
  - `json-shapes.mjs`, `json-baseline.json` and `json-extra/`;
  - `windows-base-commit`.
- `.gitattributes`: `-text` for `tests/snapshots/**`, `tests/ux-before/{linux,windows,json-extra}/**`.
- CI: a new `ux-before` job (ubuntu + windows).

**Tests (seam 5) and wiring**
- In `npm run test`:
  - `tests/term-caps.test.mjs` (18): every precedence branch. Covered: flag > NO_COLOR > FORCE_COLOR (incl. `FORCE_COLOR=0`) > CLICOLOR_FORCE > non-TTY > TERM=dumb > CLICOLOR=0; NO_COLOR beats FORCE_COLOR; an empty NO_COLOR does not count; LC_ALL > LC_CTYPE > LANG, and no locale at all is the C locale → ascii; win32 without WT_SESSION/TERM_PROGRAM → wgl4, whatever the locale; `ZCODE_KIT_UNICODE=1|0` beats everything, other values are ignored; animate; width clamp; frozen record.
  - `tests/term-output.test.mjs` (15): the grammar regex `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` plus whitespace-indented `why:`/`next:` lines, byte for byte, in 7 off-TTY terminals covering all three tiers: pipe/ascii, pipe + UNICODE=1/full, pipe + FORCE_COLOR=1, TERM=dumb TTY, CI TTY/full, CI conhost/wgl4, CI + C locale. Also: U+2014 is kept on the ascii tier; stream routing; JSON mode; reveal rule; record validation; progress (10 Hz, no motion under TERM=dumb/CI, replaced once by a result row); verdict; copy mapping.
  - `tests/term-snapshots.test.mjs` (94): 11 primitives' fixtures × 8 C3 variants (tty-color-80/120, no-color, pipe, term-dumb, ci, ascii, wgl4), giving 176 snapshot files under `tests/snapshots/term/`. Also: the Story 107 ESC scan over every NO_COLOR, pipe, TERM=dumb and CI render; a non-vacuity check; the harness's own tests (writes only with `UPDATE_SNAPSHOTS=1`, the exact value; byte compare catches CRLF, a missing SGR reset and trailing spaces; the normalisation list never masks status words, exit codes or the grammar).
  - `tests/term-boundaries.test.mjs` (7): the grep guard over the new code, the static import walk from `cli/heal.mjs`, `cli/launch.mjs` and `proxy/zcode-proxy-manager.mjs` (no `lib/term/` and no `tui/` module), and lazy loading proven with `module.registerHooks` (0 renderer files before `loadOutput()`, 3 after).
  - `tests/json-superset.test.mjs` (3): the superset rule; the committed baseline equals what the pre-change captures give; a live re-capture of all 16 `--json` outputs (pipe) checked for keys, types and exit codes.
- `npm run test:ux-before`: `tests/ux-before-equivalence.test.mjs`, the before-equivalence test (~8 min, so not in the fast suite). The CI job `ux-before` runs it.
- Wiring guard: 0 unwired.

**RED → GREEN**
- `t06-red1`: the caps test fails with `ERR_MODULE_NOT_FOUND lib/term/caps.mjs`. `t06-green1`: 18/18.
- `t06-red2`: the output test fails with `ERR_MODULE_NOT_FOUND lib/term/out.mjs`. `t06-green2`: 8/8.
- `t06-red3`: 88 of 94 fail with `snapshot missing`. The renders were reviewed against design-language §4 before `UPDATE_SNAPSHOTS=1` (`t06-snap-write`). The review fixed the `or` alignment, wrapping of long TTY details, result-label alignment and trailing spaces on an empty kv value. Then `t06-green3`: 120/120 for caps + output + snapshots.
- `t06-green4`: 15/15. `t06-green5`: 101/101. `t06-json-green`: 3/3.
- Guards that hold by construction were proven by mutation (`t06-mutants`; `git status` and `cmp` clean after each restore). All 9 mutants were killed:
  - M1: drop the TTY check on reveal;
  - M2: SGR on the off-TTY check word;
  - M3: no validation before writing;
  - M4: `ESC[K` with colour off;
  - M5: `cli/heal.mjs` imports `lib/term/out.mjs`;
  - M6: eager import in `load.mjs`;
  - M7: an `isTTY` read in `out.mjs`;
  - M8: the copy mapping applied to the check separator;
  - M9: SGR with colour off (38 failures).
- JSON superset (`t06-json-mutant`): `doctor --json` with `failed` turned into a string and `skipped` dropped → `$.failed: type string, baseline number` and `$.skipped: missing` for both doctor outputs. Restored, `git diff -- cli/` empty.
- Before-equivalence (`t06-before-mutant`): `doctor: N check(s) failed` → `checks failed` in `cli/zcode-kit.mjs` gives "60 capture(s) differ". Restored, `git diff --stat -- cli/` empty.

**Before-equivalence evidence ("no visible change")**
- `t06-capture-base`: a full capture of the base tree `3f4e41a`. Byte diff against the 0960696 set: 96 files differ, all run-to-run values:
  - wall-clock ages (`used 14h ago`);
  - the epoch `issuedAt`;
  - the random key of a fresh `install.sh` install;
  - fixture git commit ranges and git transfer statistics;
  - tarball SHA-256 (`actual …`);
  - the fixture release size (`(36 files updated …)`, which grows with every file under `cli/`/`lib/`).
  
  With the explicit list in `tests/ux-before/compare.mjs` (`VOLATILE`, applied to both sides; it never touches status words, exit codes or the grammar) the result is **0 differences**. So tickets 01–05, 14, 50 and 51 changed no captured output.
- `t06-before-green` (before the merge, 478 s) and `t06-before-final` (merged head `ec7929c`, 480 s): 1/1 pass, all 7 variants, 640 captures, exit codes equal.
- Excluded on purpose: `install/install-ps1-static` (a static source excerpt, not output; the Bun pin in `install.ps1` changes it in ticket 11) and `INDEX.md`/`manifest.json` timings.

**JSON baseline**
- `tests/ux-before/json-baseline.json` holds key names, value types (with optional keys across array elements) and the exit code of all 16 `--json` outputs:
  - `doctor` up/down;
  - `status` up/down;
  - `proxy status` up/down;
  - `models` up/down;
  - `usage` up/down;
  - `accounts`, `accounts doctor`;
  - `accounts health` up/down;
  - `auth status` (non-TTY) up/down.
- Sources: 12 come from the BEFORE set's pipe captures (0960696). 4 had no capture: `models --json` running, `doctor --json` down, `accounts doctor --json` and `accounts health --json` down. They were captured with `capture.mjs --extra json` from a clean detached worktree at `3f4e41a` (`t06-json-base`) and committed in `tests/ux-before/json-extra/`.
- The generator (`node tests/ux-before/json-shapes.mjs --write`) reproduces the committed file exactly; a test pins that.

**Full suites after merging `97c2211`** (Bun 1.4.2; ticket 11 not merged; Node 26.7.0)
- `npm run test` (`t06-full-kit`): 519 tests, 503 pass, 0 fail, 16 skipped. The tip has 382 (`merge-02-test`); +137 = 18 + 15 + 94 + 7 + 3, the new files only.
- `npm run test:proxy` (`t06-full-proxy`): 1343 pass, 0 fail, 90 files (= tip).
- `npm run test:mcp` (`t06-full-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped (= tip); `dist/` unchanged.
- `npm run test:ux-before` (`t06-before-final`): 1/1.
- `pack/build.mjs --tracked-only` + `verify-payload` (`t06-pack`): OK, 207 files (204 + `lib/term/{caps,out,load}.mjs`), no `tests/`. `loadOutput()` renders from the assembled payload.
- Memory loop: this ticket touches no scenario's code path (no command imports `lib/term/`), so nothing was re-run and no expected-RED entry belongs to it.

**Decisions taken**
1. **The baseline stays verbatim.** Run-to-run values are normalised on both sides at compare time by the explicit `VOLATILE` list, instead of rewriting 640 files. The capture writes a non-default fixture port (`UX_CAPTURE_PORT`, so isolated ranges work) and a different running Bun version back as the baseline's `18458` / `1.4.2`. Both are no-ops for a run like the original.
2. **Capture tooling changes** (scenarios, fixtures and normalisation of a Linux run on 18458 are unchanged):
   - `--out` is required;
   - `--kit` defaults to the checkout;
   - Bun comes from `UX_BUN` or `PATH`;
   - `--extra json` is opt-in;
   - Windows support for the pipe/ci variants: junctions or copies instead of symlinks, a fixture PATH from the Bun/Node/git dirs, path spellings (long/short, JSON-escaped, `/`), and a file-URL `--import`. `WIN32_SKIP` lists the scenarios that need a POSIX shell (`install-sh-*`, `run-opencode`).
3. **Windows baseline: pending CI.** This host has no Windows. The `ux-before` job on windows-latest captures the pipe/ci baseline from the base commit (`tests/ux-before/windows-base-commit` = `3f4e41a`) on the same runner before running the test, and uploads it as the `ux-before-windows-baseline` artifact. **Orchestrator:** commit that artifact as `tests/ux-before/windows/`; the CI step is then skipped and the committed set is used. The Windows code paths of the capture are untested here; if the job fails, the fix belongs to the capture tool, not to the baseline. The live part of `json-superset` is skipped on win32 for the same reason; remove the skip once the windows `ux-before` leg is green.
4. **Capability record details.** Spec and design-language are silent on these, so the smallest choice was taken:
   - `color` is a boolean (the kit uses ≤ 16 colours, R13);
   - `FORCE_COLOR` set and not `0`/`false` counts as on, empty included (Node's rule);
   - only an exact `ZCODE_KIT_UNICODE` of `1`/`0` counts;
   - an additive `plain` field (off a TTY, TERM=dumb or CI) marks where ADR-0001 rule 1's grammar applies;
   - CI keeps colour on a TTY (CI is not in the colour precedence) but stops motion;
   - `--color` parsing, `ZCODE_KIT_PROGRESS` and `ZCODE_KIT_HYPERLINKS` are left to ticket 45; `detectCaps` already takes `flags.color`.
5. **Off a TTY a check row never carries SGR, even with `FORCE_COLOR`**, because the grammar is "exactly". Other primitives honour forced colour. `next` alternatives off a TTY are each `  next: <cmd>`; `or` appears on a TTY only. Error blocks use `  why:`/`  next:`/`  exit:` lines.
6. **Animated progress with colour off** (NO_COLOR on a TTY) blanks the line with spaces instead of `ESC[K`. Story 107 forbids any escape sequence when colour is off.
7. **JSON mode** (`createOutput({ json: true })`): stdout carries only `json()`/`data()`; report primitives write nothing, and diagnostics still go to stderr.
8. **`connection()` shows the key only when the caller asks (`reveal`) and stdout is a TTY.** The CI/stdin rule stays the caller's (`shouldRevealKey`), so the reveal rules are unchanged.
9. **Table column specs are called `fields`**, so the grep guard can be a strict token scan over `lib/term/` (every file except `caps.mjs`). Comments are stripped before scanning.
10. Word wrap (`wrapWords`) lives in `out.mjs`, built on the core's `displayWidth`. `wrapToWidth` in the shared core (ticket 05, decision 5) is not needed yet; the TUI does not wrap.

**Fixture note (orchestrator comment above)**
- No command imports `lib/term/` in this ticket, so the mini-kit fixtures are unchanged and no pre-existing test changed.
- For 07, when a command module loads `lib/term/` eagerly:
  - cli-kit, cli-audit, setup-regressions, harness-consent, auto-heal and `scripts/verify-golden-path.mjs` must also copy `zcode-proxy-src/src/tui/{width-core,tokens}.mjs` (+ `.d.mts`);
  - the capture already has them through its `src/*` symlinks in every fixture except the release-shaped ones (`srcLinks: false`: `update-release*`, `makeRelease`), which need them in `KIT_FILES`.
- Loading through `lib/term/load.mjs` on rendering paths avoids the problem for code paths that never render.
- The `lib/event-line.mjs` → re-export of `zcode-proxy-src/src/log/event-line.mjs` is **left for ticket 15**. The manager imports `lib/event-line.mjs` today, so the switch touches every mini-kit fixture now (they would also need `src/log/`), which is outside this ticket's no-visible-change window.

**Pre-existing tests:** none changed. Only additions: the `package.json` test list, `test:ux-before`, `.gitattributes`, and the `ux-before` CI job.

**Common acceptance**
- RED → GREEN at seam 5: ✓. Guards that hold by construction were proven by mutation.
- Fast suite green locally on ubuntu: ✓. The windows `test-kit` legs, the `ux-before` job (both OS) and `memory-budget`: pending CI (orchestrator verifies after merge+push).
- New test files wired: ✓.
- No pre-existing test changed: ✓.
- Evidence recorded: ✓.
- No new log events, config keys or `ZCODE_PROXY_*` overrides: n/a. `UX_BUN`, `UX_CAPTURE_PORT` and `UX_BEFORE_BASELINE` are test-tooling variables only.

**Acceptance criteria**
- Capability-record precedence tests: ✓ (`term-caps`, 18).
- Off-TTY grammar regex in every glyph tier: ✓ (`term-output`, 7 terminals + the ascii separator test; `term-snapshots` pipe/ci).
- BEFORE set + tooling under `tests/` with the byte-for-byte before-equivalence test: ✓ on ubuntu (7 variants, `t06-before-final`). The Windows pipe/ci baseline is pending CI (decision 3).
- JSON baseline committed + superset test in `npm run test`: ✓ (live part on linux/macOS; win32 pending, decision 3).
- Grep test for new code: ✓ (`term-boundaries`).
- No-ESC scan over NO_COLOR/pipe/TERM=dumb/CI renders: ✓ (`term-snapshots`).

**Update after a second merge (same day).**
- The integration tip moved to `922833a` (ticket 02 reverted). It was merged in `8475174`; conflicts in `ci.yml` and `package.json` were resolved by keeping the `ux-before` job and the five new test files on top of the reverted tip.
- `git diff --stat ec7929c 8475174 -- cli lib proxy zcode-proxy-src mcp install.sh install.ps1` is empty, so the before-equivalence result of `t06-before-final` holds for this head.
- Re-run:
  - `npm run test` (`t06-full2-kit`): 498 tests, 487 pass, 0 fail, 11 skipped. The reverted tip has 361; +137.
  - `npm run test:proxy` (`t06-full2-proxy`): 1343 pass, 0 fail, 90 files.
  - `npm run test:mcp` (`t06-full2-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged.
  - Wiring guard: 0 unwired.

### 2026-11-06 — implementer, round 2 (after the revert of merge 5155b1d in f8be074)

**Why `ux-before` was red** (CI run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42236936458; logs in `overhaul-tools/uxbefore-{ubuntu,win}-1.log`)
- **ubuntu (git 2.56.0; this host has 2.43.0).** 10 files differed, all in `update/update-checkout` (the log repeats them, hence 21 lines). The cause is git's own transfer-progress meter: 2.56 writes `ESC[K` before the text and appends `(from 0)` to `pack-reused 0`. Reproduced here with a git 2.56.0 from conda-forge in an isolated prefix (`UX_GIT=…/git256/bin/git`).
- **windows.** Three causes:
  1. `fakeProxySource()` pasted the proxy source path raw into the TS literal `"__REAL_PROXY_SRC__"`. In the base worktree `D:\a\_temp\ux-base`, `\u` is an invalid escape, so the fake proxy did not parse and 40 proxy starts failed. In the HEAD checkout `D:\a\ZCode-Agent-Kit\…` the literal parsed, but its escapes had collapsed, giving `Cannot find module 'D:aZCode-Agent-Kit…'`.
  2. `tar` resolved to Git for Windows' GNU tar in the bash step, which reads `C:\…` as host `C` (6 failures).
  3. The fixture `git clone -q --bare` failed with an empty stderr (4 failures; the cause is not visible in the log).
  
  The comparator then also counted "was undefined" exit codes against the broken baseline.
- **The artifact `ux-before-windows-baseline` of that run must not be committed:** it holds 50 failed captures.

**Fixes (tooling only; no kit code changed)**
- `tests/ux-before/compare.mjs`:
  - a new `VOLATILE` rule, "git transfer progress": a run of lines starting (optionally after `ESC[K`) with `remote: ` or `Receiving|Unpacking|Resolving objects|deltas: ` becomes one `<GIT TRANSFER PROGRESS>` line. It replaces the narrower "git transfer stats" rule. Kit lines are never matched: indented text, mid-line text and other wording are pinned by a test;
  - a failed **baseline** capture is now a difference (`baseline capture error: …`), and exit codes are compared only where both sides captured;
  - an `only` filter (by `<group>/<scenario>`).
- `tests/ux-before/capture/host.mjs` (new): pure, platform-injectable helpers, tested on Linux with Windows paths:
  - `importBase`: Bun helper scripts (fake proxy, seed-store, render-tui) import from a file URL on every platform. The specifier never appears in a captured output; the BEFORE set has no `<PROXY_SRC>` line;
  - `fakeProxySource`: inserts that URL as a JSON string literal;
  - `tarBinary`: `%SystemRoot%\System32\tar.exe` on Windows;
  - `cloneArgs`: `--no-local` on Windows;
  - `pathForms` / `swapPath`: the moved Windows path normalisation;
  - `describeFailure`: status, signal, error and both streams of a failed prep step.
- `capture.mjs`:
  - Windows fixture dirs use their long-name realpath (no `RUNNER~1`);
  - git, tar and Bun prep failures report fully;
  - new opt-in `UX_GIT` (POSIX) puts a chosen git first on the fixture PATH.
- `tests/ux-before-equivalence.test.mjs`: `UX_BEFORE_OUT` keeps the fresh capture. The CI job sets it and uploads `ux-before-now-<os>` when the test fails.
- `tests/ux-before-capture.test.mjs` (new, in `npm run test`, 11 tests):
  - git progress: the 2.43, 2.56, TERM=dumb and ANSI-stripped forms give one identical text, and kit lines stay untouched;
  - fake-proxy literal for both CI paths: a `file:///D:/a/…` URL whose `fileURLToPath(…, { windows: true })` round-trips to `D:\…\src\index.ts`;
  - the raw substitution is invalid, and reproduces CI's `D:aZCode` message;
  - **Linux end to end:** the capture of `proxy-status-json-running` from a kit path containing `k\ux-base` starts the fixture proxy (`health: ours`). The original tool fails there with "fixture proxy did not start" (`t06-bs-old`). This test uses `UX_CAPTURE_PORT + 1`, because `json-superset` captures in parallel;
  - tar, clone args, failure description, Windows path forms incl. JSON-escaped and long names, and the comparison rules.

**Evidence**
- `t06-git256-capture` + compare: with git 2.56, `update-checkout` vs baseline gives 0 differences. Without the new rule there are 10, the same lines CI reported.
- `t06-before-git256`: the **full** before-equivalence test with git 2.56 on the fixture PATH (`UX_GIT`) is 1/1 GREEN (503 s), so it holds under the ubuntu runner's git.
- `t06-r2-sub`: 178 captures (update, accounts, doctor-json, setup-proxy-running, tui) with the system git 2.43 vs baseline: 0 differences.
- Mutation proofs (`t06-mutants2`; every file restored, `cmp` clean):
  - **R1:** git progress rule removed → killed (2).
  - **R3:** plain path instead of a file URL → killed (2).
  - **R4:** GNU tar → killed (1).
  - **R5:** no `--no-local` → killed (1).
  - **R6:** no JSON-escaped path form → killed (1).
  - **R7:** no realpath form → killed (1).
  - **R8:** stderr dropped from failure text → killed (1).
  - **R9:** baseline errors ignored → killed (1).
  - **R2** (JSON-quoting dropped while keeping the URL) survives. It is an equivalent mutant: `pathToFileURL` percent-encodes `\` and `"`, so the URL is safe either way and the JSON quoting is defence in depth.
  - The original behaviour (raw path, raw substitution; `t06-mutant-orig-literal`) is killed by both the literal test and the Linux end-to-end test.
- Full suites at `37c1514` (branch not re-merged with the integration tip, as instructed: the tip carries the revert):
  - `npm run test` (`t06-r2-full-kit`, `t06-r2-full-kit2`): 509 tests, 498 pass, 0 fail, 11 skipped, twice;
  - `npm run test:proxy` (`t06-r2-full-proxy`): 1343 pass, 0 fail;
  - `npm run test:mcp` (`t06-r2-full-mcp`): 95 pass, 0 fail, 1 skipped;
  - wiring guard: 0 unwired.

**What CI must show (run on the integration branch after the revert of f8be074 and the merge of this branch)**
1. `ux-before / ubuntu-latest`: green. The step "Before-equivalence (byte for byte)" passes 1/1 against `tests/ux-before/linux` (all 7 variants), with no `differs:`, `capture error` or `baseline capture error`.
2. `ux-before / windows-latest`, in order:
   - the step "Windows baseline from the base commit" ends with `captures: N ok, 0 failed` (≈ 2 × 115 non-TTY scenarios plus TUI; **0 failed is the check**);
   - the artifact `ux-before-windows-baseline` is uploaded;
   - the equivalence step passes 1/1.
   
   Only an artifact from such a run may be committed as `tests/ux-before/windows/`. If the leg fails, the `ux-before-now-Windows` artifact holds the fresh capture, and every failed prep step now prints its status, signal and streams (the `git clone` cause in particular).
3. `test-kit` (ubuntu/windows × Node 24/26): `npm run test` green, including `tests/ux-before-capture.test.mjs`. The Linux end-to-end test is skipped on win32, and `json-superset`'s live part stays skipped on win32 until leg 2 is green.

### 2026-11-06 — implementer, round 3 (staging/06 pre-merge CI)

**Result reported by the orchestrator** (log `overhaul-tools/uxbefore-win-2.log`)
- `test-kit` 4/4 and `ux-before` ubuntu were green.
- `ux-before` windows: the baseline step ended `captures: 189 ok, 4 failed`.
- All four failures were the fixture `git clone --no-local -q --bare …` of `update-checkout`/`update-checkout-dirty` (pipe, ci), with status `3221225477` (0xC0000005, git.exe crashed). The other 8 differences were `unexpected:` files for the same captures.
- The same clones **succeeded in the equivalence step**, where the fresh capture has those files.

**Cause.** The two steps ran under different shells. The baseline step was `shell: bash` (Git Bash) and the equivalence step used the runner default (pwsh). Under Git Bash, PATH starts with `Git\mingw64\bin`, so the fixture PATH (`winPath()`, which took the first `git.exe`) used the raw mingw64 binary instead of the `Git\cmd` launcher. The fixture env also inherited the MSYS shell state (`MSYSTEM`, `EXEPATH`, `MSYS`, `ORIGINAL_PATH`, `SHLVL`, `PWD`, …) alongside the narrow fixture PATH. The two steps also differed in environment, which an equivalence baseline must not.

**Fixes (test tooling and CI only)**
- `host.mjs`:
  - `windowsGitDir(PATH, { exists })`: any `git.exe` inside a Git for Windows tree (`mingw64\bin`, `usr\bin`, `bin`, `cmd`) maps to that tree's `cmd` launcher; a git elsewhere is used as found;
  - `fixtureBaseEnv(env, { windows })`: the fixture env filter, moved from `capture.mjs`. On Windows it also drops `PATH`/`TEMP`/`TMP` (any case) and the Git Bash variables, and keeps the Windows runtime (`SystemRoot`, `WINDIR`, `PATHEXT`, `ComSpec`, `HOMEDRIVE`, `HOMEPATH`, …). On POSIX it is exactly the original filter.
- `ci.yml`: the "Windows baseline from the base commit" step runs under `shell: pwsh`, the equivalence step's shell, with an exit-code check after each native command; `GITHUB_ENV` is written as UTF-8 without a BOM (pwsh 7).
- `tests/ux-before-capture.test.mjs` (+4 tests, now 15):
  - the git-dir mapping for the bash, pwsh/cmd, trailing-backslash, non-Git-for-Windows and no-git cases;
  - the Windows env filter (exact kept set);
  - the POSIX filter pin;
  - a workflow guard (the baseline step is `shell: pwsh`, the equivalence step has no shell override);
  - a wiring check that `capture.mjs` builds the env and the Windows git dir through `host.mjs`.

**Evidence**
- `t06-r3-green1`: 15/15.
- Mutation proofs (`t06-mutants3`; every file restored, `git status` shows only the intended changes). All 7 killed, 1 failing test each:
  - **W1:** no launcher mapping;
  - **W2:** MSYSTEM leaks;
  - **W3:** EXEPATH leaks;
  - **W4:** baseline step back to bash;
  - **W5:** `capture.mjs` without `windowsGitDir`;
  - **W6:** `capture.mjs` with an unfiltered env;
  - **W7:** the Windows filter applied on POSIX.
- `t06-r3-sub`: 140 Linux captures (all `update-*` incl. `update-checkout`, all `doctor-*`, `accounts-list`, `setup-explicit`) against the baseline: 0 differences. The POSIX path is unchanged.
- Full suites at this head (no tip merge, as instructed):
  - `npm run test` (`t06-r3-full-kit`): 514 tests, 503 pass, 0 fail, 11 skipped;
  - `npm run test:proxy`: 1343 pass, 0 fail;
  - `npm run test:mcp`: 95 pass, 0 fail, 1 skipped;
  - wiring guard: 0 unwired.

**What CI must show (staging/06 or the merge)**
1. `ux-before / windows-latest`:
   - the pwsh step "Windows baseline from the base commit" ends with `captures: N ok, 0 failed` (N ≈ 193, matching round 2's 189 + 4);
   - `update/update-checkout` and `update/update-checkout-dirty` (pipe and ci) show an exit code, not `ERROR git clone`;
   - the step "Before-equivalence (byte for byte)" passes 1/1 with no `unexpected:`, `differs:` or `baseline capture error` line.
   
   Commit the `ux-before-windows-baseline` artifact of that run as `tests/ux-before/windows/` only if both hold.
2. `ux-before / ubuntu-latest`: still green (no Linux behaviour changed).
3. `test-kit` 4/4: green with the 15 tests of `tests/ux-before-capture.test.mjs`. The two env/git tests and the workflow guard also run on the windows legs; the Linux end-to-end test is skipped there.

If windows still fails: the `ux-before-now-Windows` artifact holds the fresh capture, and the failure text names the git command with its status and both streams.

### 2026-11-06 — implementer, round 4 (run 42259233373)

**Result reported by the orchestrator** (log `overhaul-tools/uxbefore-win-3.log`)
- `test-kit` 4/4 and `ux-before` ubuntu were green.
- windows: the baseline was `193 ok, 0 failed`, then 2 differences: `update/update-checkout/{ci,pipe}.txt` line 4, ` package.json | 68 +++…---` (base) vs `70` (this branch).

**Cause.** `gitFixture()` makes the fixture origin one commit ahead by rewriting `package.json` with `JSON.stringify(pkg, null, 2) + "\n"`; `update` then prints git's fast-forward diffstat.
- On the windows runner the checkout has CRLF line endings (autocrlf; `package.json` has no eol attribute), so the rewrite changes every line: 34 lines at `3f4e41a` give 68, and 35 on this branch (the added `test:ux-before` script) give 70.
- The summary line differs too (`34` vs `35 insertions(+)`); the comparator only prints a file's first differing line.

**Why ubuntu passes, and why that is not an accident.** On an LF checkout `package.json` is already exactly `JSON.stringify(…, null, 2)` output at both `3f4e41a` and HEAD (checked), so the fixture commit changes only the version line. The stat is ` package.json | 2 +-` / `1 insertion(+), 1 deletion(-)` whatever the file's length. It would break only if `package.json` stopped being in that canonical form; the new rule removes that dependency as well.

**Fix** (`tests/ux-before/compare.mjs`, explicit `VOLATILE` list, both sides):
- **"git diffstat":** `^( [^\s|][^\n|]*? \| +)\d+ (?:ESC[…m|[+-])+$` becomes `$1<N> <GRAPH>`, so the path is kept.
- **"git diffstat summary":** `^ \d+ files? changed(, \d+ insertions?\(\+\))?(, \d+ deletions?\(-\))?$` becomes a fixed marker.
- In the BEFORE set, only `update/update-checkout` has such lines.

**Tests** (`tests/ux-before-capture.test.mjs`, +4, now 19):
- the LF, coloured-TTY and CRLF (34/35) forms normalise to one text, and a different path stays a difference;
- kit lines stay strict: indented lines, trailing text, a non-numeric count, and "files changed" elsewhere in a line are untouched;
- **Linux end to end:** `update-checkout` captured from a kit with a CRLF `package.json`. It shows `N insertions(+), N deletions(-)` with N = the file's line count, exactly the windows shape, and compares clean against the baseline. Its port is `UX_CAPTURE_PORT + 2`. A manual run gave ` package.json | 70 …`, ` 1 file changed, 35 insertions(+), 35 deletions(-)` and 0 differences (`t06-r4-crlf`).

**Evidence**
- `t06-r4-green1`: 19/19.
- Mutation proofs (`t06-mutants4`, restored): 6 killed:
  - **D1:** no diffstat rule;
  - **D2:** no summary rule;
  - **D3:** the diffstat rule accepts any indentation;
  - **D4:** trailing text accepted after the graph;
  - **D5:** the summary unanchored;
  - **D6:** the path masked.
- Unchanged: the base capture and the git 2.56 `update-checkout` capture still compare clean (0).
- Full suites at this head (no tip merge):
  - `npm run test` (`t06-r4-full-kit`): 517 tests, 506 pass, 0 fail, 11 skipped;
  - `npm run test:proxy`: 1343 pass, 0 fail;
  - `npm run test:mcp`: 95 pass, 0 fail, 1 skipped;
  - full `npm run test:ux-before` with git 2.56 on the fixture PATH (`t06-r4-before-git256`): 1/1 (467 s).

**What CI must show**
1. `ux-before / windows-latest`: baseline `193 ok, 0 failed`, then the equivalence step passes 1/1 with no `differs:`, `unexpected:` or `baseline capture error`. That run's `ux-before-windows-baseline` artifact may then be committed as `tests/ux-before/windows/`.
2. `ux-before / ubuntu-latest`: green.
3. `test-kit` 4/4: green with the 19 tests. The two Linux end-to-end tests are skipped on win32; the normalisation, env, git-dir and workflow tests run there too.

- 2026-11-06 (orchestrator): first merge 5155b1d was reverted (f8be074); fix rounds 2-4 staged on staging/06 for pre-merge CI via draft PR #15.

- Merged 2026-11-06 as 97bd0c0 (merge of `staging/06` at 1ba62de, which already holds the revert of the revert 635276c and fix rounds 2-4), after the pre-merge CI gate: draft PR #15, run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42267516015 green on all 7 jobs (test-kit 4/4, ux-before ubuntu + windows, memory-budget). Windows BEFORE baseline: the run's `ux-before-windows-baseline` artifact (261 files, INDEX `193 ok, 0 failed`) committed byte for byte as `tests/ux-before/windows/` in c8c88e9 (`-text`, so `install-ps1-static/source-excerpt.txt` keeps its CRs); the CI capture step now skips because `tests/ux-before/windows/manifest.json` exists. Fast suite on the merged tree: kit 506/517 (0 fail, 11 skipped), proxy 1343/1343 (90 files), mcp 95/96 (0 fail, 1 skipped). `dist/` unchanged; no lockfile changes. Logs: reports/merge-06-{npm-ci,kit,proxy,mcp}.log. Open follow-up from decision 3: the win32 skip of `json-superset`'s live part can now be removed (not done in this merge).
