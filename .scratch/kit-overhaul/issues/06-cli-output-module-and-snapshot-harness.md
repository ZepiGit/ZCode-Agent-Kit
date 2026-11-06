# 06: CLI output module, capability record and the snapshot harness (no visible change)

**Blocked by:** 05 (Shared width core and token set (two renderers, one token set))

**Status:** ready-for-agent

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

- Merged 2026-11-06 as 5155b1d; fast suite: kit 487/498 (0 fail, 11 skipped), proxy 1343/1343 (90 files), mcp 95/96 (0 fail, 1 skipped). `dist/` unchanged; no lockfile changes. Logs: reports/merge-06-{npm-ci,test,proxy,mcp}.log. The Windows criteria (Windows pipe/ci BEFORE baseline, win32 JSON superset part) are pending CI by design (decision 3); the orchestrator verifies them after push. The 8-minute `npm run test:ux-before` is not part of the fast suite and was not run here.

- 2026-11-06 (orchestrator): REVERTED (revert of merge 5155b1d) per run rules: the new `ux-before` job is red on both legs of CI run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42236936458. ubuntu: 21 diffs, all in update/update-checkout captures, from git's own remote progress text varying by git version (e.g. "pack-reused 0" vs "pack-reused 0 (from 0)", position of `\e[K`) — environment text, not kit output. windows: 136 captures differ; the proxy start path is mangled ("Cannot find module 'D:aZCode-Agent-KitZCode-Agent-Kitzcode-proxy-src/src/index.ts'": backslashes lost when the path is passed through), and `tar` fails repeatedly ("Error is not recoverable"). Logs: /home/AgentKit/overhaul-tools/uxbefore-ubuntu-1.log, /home/AgentKit/overhaul-tools/uxbefore-win-1.log. Fix on branch ticket/06-cli-output-module.
