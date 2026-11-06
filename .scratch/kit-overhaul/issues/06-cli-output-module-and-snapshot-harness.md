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
