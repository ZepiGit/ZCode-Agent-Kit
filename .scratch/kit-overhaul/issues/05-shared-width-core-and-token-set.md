# 05: Shared width core and token set (two renderers, one token set)

**Blocked by:** 01 (Memory loop with budgets, process-count harness, expected-RED ratchet and the ubuntu `memory-budget` job)

**Status:** resolved

Model: sol

Risk: medium

ADR: 0011, 0001

**What to build:** One plain-ESM width core (+ `.d.mts`) and token set (glyph tiers full/wgl4/ascii, box chrome, 16-colour roles, verdict words) living with the TUI code and used by both the CLI (Node) and the TUI (Bun). The core is grapheme-based (`Intl.Segmenter`, a W/F table generated from UCD 17, VS16/RI pairs = 2, cluster cap 2) with an ASCII/no-combining fast path. The existing width module re-exports the core, so its imports and tests keep working.

**Acceptance criteria:**

- [ ] Width vectors (CJK, emoji, VS16, RI, combining, ASCII fast path) pass identically under `node --test` and `bun test` (seam 6).
- [ ] Existing `width`/`frame` tests pass unchanged; S6 heap within budget; a frame-time benchmark (a full 2,000-line pane rendered at 80 and 120 columns, with an ASCII fixture and a mixed CJK/emoji fixture) is recorded on the ticket's base commit and after the change, and the after p95 for the ASCII fixture is ≤ 1.10 × the base p95.
- [ ] `bun build --compile` succeeds for all five targets; `verify-payload`'s required list includes the shared files and their `.d.mts`.
- [ ] TUI frames and the `ux/before/tui` captures are byte-identical for every fixture whose graphemes keep their width; a vector test lists each grapheme class whose width changes (VS16, RI pairs, new UCD 17 W/F ranges) and the frames that change because of it.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 109

## Comments

### 2026-11-06 — implementer (substitute for gpt-6.1-sol-subagent)

**Branch:** `ticket/05-shared-width-core` (worktree `/home/AgentKit/wt/t05`). Commits `f8c264d` (core + tokens), `23d44bf` (payload), `3b431fb` (typings); integration tip `f5a2409` merged in (`8fb9c7c`); the head SHA is the commit that adds this comment.

**What landed**
- `zcode-proxy-src/src/tui/width-core.mjs` + `.d.mts`: plain ESM, no imports. Exports `stripAnsi`, `displayWidth`, `truncateToWidth`, `padEndWidth` and `UNICODE_VERSION` (`"17.0.0"`). Width is counted per grapheme cluster with `Intl.Segmenter`. A cluster is 0 cells when every code point in it is zero-width or a control. It is 2 cells when any code point is W/F, when VS16 follows a valid emoji-variation base, or when it is a regional-indicator pair. Anything else is 1 cell, and no cluster is wider than 2. Truncation cuts only at cluster boundaries.
- Fast paths:
  - printable ASCII is measured by `length`;
  - any other text is summed one code point at a time up to its first joiner (UCD GraphemeBreakProperty Extend/ZWJ/SpacingMark/Prepend/L/V/T/RI). Only the rest, starting at the previous code point (the possible base), goes through the segmenter.
- `scripts/gen-width-tables.mjs <ucd-dir> [--check]` generates four tables from UCD 17.0.0: WIDE (123 ranges), ZERO (377), VS16_BASES (183) and JOINERS (341). The generated header records the SHA-256 of each input file. `--check` reproduces the committed block byte for byte. The inputs are not committed; they come from `https://www.unicode.org/Public/17.0.0/ucd/`: `EastAsianWidth.txt`, `extracted/DerivedGeneralCategory.txt`, `emoji/emoji-variation-sequences.txt` and `auxiliary/GraphemeBreakProperty.txt`.
- `zcode-proxy-src/src/tui/tokens.mjs` + `.d.mts`: `GLYPH_TIERS`, `WORDS`, `CHECK_WORDS`, `ACTION_WORDS`, `GLYPHS[tier]`, `BOX[tier]`, `SPINNER`, `ROLES` (16-colour SGR) and `STATUS_ROLES`, with the values of design-language §3. Every export is deeply frozen.
- `width.ts` is now `export { … } from "./width-core.mjs"`, so its imports and tests are unchanged.
- `frame.ts` takes its box chrome (`BOX.full`), glyphs (`GLYPHS.full`) and colours (`ROLES.fail/ok/warn/info/heading`) from the tokens, with byte-identical output.
- `lib/term/width.mjs` and `lib/term/tokens.mjs` are the CLI's re-exports (design-language §9 "path indirection for the CLI").
- `pack/verify-payload.mjs` now requires `zcode-proxy-src/src/tui/{width-core,tokens}.{mjs,d.mts}`.

**Tests**
- Seam 6, the same suite under both runtimes: `zcode-proxy-src/src/tui/__fixtures__/shared-output-suite.mjs` (+ `.d.mts`) runs unchanged in `src/tui/width-core.test.ts` (bun) and in `tests/width-core.test.mjs` (node, through `lib/term/`). The suite covers:
  - 51 width vectors (ASCII, Latin-1, CJK, fullwidth/halfwidth, ambiguous chrome, combining, VS16, RI, skin tones, ZWJ, new UCD 17 W ranges, narrowed ranges, plus the fast-path boundaries: a joiner at index 0, RI/ZWJ after an ASCII prefix, Prepend, L+LV);
  - 15 truncation and 4 padding vectors;
  - the cluster cap;
  - the token set against design-language §3;
  - tier repertoires (ascii is 7-bit, wgl4 is the WGL4 subset, no glyph is wide or VS16);
  - frozen tokens.
- Adversarial tests (from the guarantees' purpose):
  - 2,000 seeded random mixes check that width is additive over `Intl.Segmenter` clusters, so the fast paths can never change a result;
  - truncation keeps whole clusters and never exceeds the budget;
  - every attempt to mutate a token throws.
- Bun only: for each of the 26 changed vectors, a frame whose log row carries the grapheme is padded by the new width (`72 − width` spaces at 80 columns), and `width.ts` exports the core's own functions.
- Node only: `lib/term/` exports are identical to the `tui/` modules (not copies); the two shared files contain no `import`/`require` and no `process`/`Bun`/`Deno`/`Buffer`/`globalThis` (ADR-0011 cond 1).
- Seam 9: `tests/release-marker.test.mjs` removes each of the four shared files from a built payload, and `verify-payload` must fail closed with `required file missing: …`.
- Wiring: `tests/width-core.test.mjs` runs in `npm run test`, and `tests/test-wiring.test.mjs` passes. The bun test is picked up by `bun test`.

**RED → GREEN** (logs in the integration worktree's `reports/`)
- `t05-red1-node` / `t05-red1-bun`: the modules are missing (`ERR_MODULE_NOT_FOUND`; bun 0 pass, 1 error). After `t05-green1-node` 13/13, `t05-green1-bun` 11 pass and 1 fail: the `width.ts` re-export check is RED.
- `t05-green2b-bun`: 81/81 after `width.ts` re-exports the core. The existing `width.test.ts` and `frame.test.ts` pass unchanged.
- `t05-red5`: the payload test fails (`a package missing zcode-proxy-src/src/tui/width-core.mjs must fail closed`). `t05-green5` is 19/19 after the required-list change.
- Mutation proofs:
  - `frame.ts` is wired to the tokens: in `t05-mutant-tokens`, `BOX.full.tl` → `┌` and `GLYPHS.full.fail` → `X` make 2 `frame.test.ts` tests fail; tokens restored (`cmp` OK).
  - The fast-path guard bites: in `t05-mutant-fastpath`, dropping the base re-walk adjustment in `displayWidth` makes 6 tests fail, including both property tests; restored (`cmp` OK).
- The `before` literals were checked against the real pre-change module (`t05-before-check2`: 51 vectors, 0 mismatches).

**Grapheme classes whose width changes** (full U+0000–10FFFF single-code-point comparison against the base module, `t05-before-check2`)
- 1 → 0: 2,309 code points (Mn/Me outside U+0300–036F, Cf such as U+2060/FEFF/202A–202E/0600–0605, Hangul U+1160–11FF).
- 1 → 2: 8,709 (BMP emoji ⌚✅⭐…, U+1F004, U+1F7E0–1F7EB, U+1FA70–1FAF8, Tangut/Kana U+17000–1B2FB, U+4DC0–4DFF, …).
- 2 → 1: 327 (text-default emoji in U+1F300–1F64F, U+1F680–1F6FF and U+1F900–1F9FF such as 🌡; EAW=A U+3248–324F; unassigned code points in U+2E80–303E and U+A48D–A48F).
- 2 → 0: 6 (U+302A–302D, U+3099–309A).
- 0 → 1: 15 (unassigned U+20F1–20FF).
- Multi-code-point clusters: VS16 1 → 2, skin tones 4 → 2, ZWJ sequences n → 2, Mc joins its base, Hangul L+V+T 4 → 2.
- RI pairs keep width 2: the old per-code-point sum was also 2. Only truncation changes; it no longer splits a flag. The vector list in `CHANGED_CLASSES` names the frame rows that change (log row, toast, server error row, login hint row).

**Byte-identical frames**
- `render-tui.ts` (the Phase 1C capture renderer) on the base tree and on this branch gives byte-identical JSON. Its 13 frames match `ux/before/tui/frames/*` (31 files).
- `capture.mjs --kit /home/AgentKit/wt/t05 --only tui` (38 captures, including the live `app.ts` first frame in all seven variants) gives `diff -r` against `ux/before/tui`: no differences (`t05-capture-tui2`).
- No BEFORE fixture contains a changed class.

**Frame-time benchmark** (`tests/bench/tui-frame-time.ts`)
- Setup: a full 2,000-line pane, with the frame height chosen so all 2,000 lines are rendered; 300 frames after a 30-frame warm-up; 3 runs each, Bun 1.4.2, same host.
- The base was measured on the base commit `28ca43f` (`t05-bench-base-{1,2,3}`), the after state on this branch (`t05-bench-after2-{1,2,3}`).

| fixture | base p95 (ms) | after p95 (ms) | after / base (mean of 3) |
|---|---|---|---|
| ASCII @80 | 11.55 / 9.87 / 10.83 | 5.67 / 5.08 / 5.71 | 0.51 |
| ASCII @120 | 11.42 / 10.65 / 11.42 | 5.57 / 5.78 / 5.11 | 0.49 |
| mixed CJK/emoji @80 (recorded) | 31.38 / 31.81 / 31.38 | 37.76 / 39.76 / 29.22 | 1.13 |
| mixed CJK/emoji @120 (recorded) | 27.49 / 25.89 / 26.60 | 32.89 / 36.11 / 30.76 | 1.25 |

- The ASCII bound of ≤ 1.10 × base holds (≈ 0.5 ×).
- A first version with only an ASCII/below-U+0300 fast path gave ASCII p95 ≈ 1.14 × base (`t05-bench-after-*`). Every truncated line ends in `…`, and that sent it through the segmenter. The joiner fast path fixed it.

**S6 (memory loop, short)**
- Base `28ca43f` (`t05-memloop-S6-base`) → this branch (`t05-memloop-S6-after`):
  - lines heap 2 → 2 MB (budget 16);
  - resize-storm heap 0 → 0 MB (budget 8);
  - long-line heap 125 → 125 MB (RED, the existing `S6/short` expected-RED entry owned by ticket 32, unchanged);
  - `resizeFrameMs` 0.21 → 0.092.
- No expected-RED entry belongs to this ticket.

**Build and payload**
- `bun build --compile` succeeds for bun-linux-x64, linux-arm64, darwin-x64, darwin-arm64 and windows-x64 (`t05-compile5`, with the `package.json` build flags). Each bundle has 648 modules, against 646 at baseline: the 2 new ones are the shared files. `VS16_BASES`/`STATUS_ROLES` appear in all five binaries.
- `node pack/build.mjs --tracked-only` + `pack/verify-payload.mjs`: OK, 204 files (`t05-pack`). The payload has the four shared files and `lib/term/`, and no `__fixtures__` or tests. From the assembled payload, `lib/term/width.mjs` and `lib/term/tokens.mjs` import and work under Node.
- Proxy typecheck (`tsc --noEmit -p zcode-proxy-src`, tsc from the MCP package): 0 errors, the same as base (`t05-tsc2`, `t05-tsc-base`).

**Full suites after merging the integration tip `f5a2409`** (Bun 1.4.2; ticket 11 not merged)
- `npm run test` (`t05-full-kit`): 361 tests, 350 pass, 0 fail, 11 skipped. The tip has 345 tests; the +16 are 15 in `width-core.test.mjs` and 1 in `release-marker`.
- `npm run test:proxy` (`t05-full-proxy`): 1343 pass, 0 fail, 90 files. The tip has 1303 tests in 89 files; this ticket adds 40 tests in 1 file.
- `npm run test:mcp` (`t05-full-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged.
- `scripts/verify-golden-path.mjs` mock mode, `GOLDEN_PORT=19050` (`t05-golden`): PASS for both models.

**Pre-existing test changes (justified)**
- `tests/release-audit.test.mjs` and `tests/release-marker.test.mjs`: the payload fixtures `put` the four shared files. The criterion makes them required, so a fixture without them can no longer pass `verify-payload`.
- `release-marker` gains one test. No assertion of an existing test changed.

**Decisions taken**
1. **One source, imported across packages, not a checked duplicate (unlike ticket 14).** ADR-0011 and Round 1 Q12 require one width core and one token set: "`width-core.mjs` … re-exported by `width.ts` and imported by the CLI's output module". The ADR's payload condition rests on `zcode-proxy-src/src/` already being in the pack allowlist, so the CLI is meant to load the files from there. A second copy under `lib/` would be a second core, and `verify-payload` would be guarding a file the CLI never loads. The proxy stays self-contained: Dockerfile `COPY src` and `bun --compile` both include `tui/`. Ticket 14's problem does not arise here, because nothing in `cli/` or `lib/` imports `lib/term/` yet; the mini-kit fixtures copy the two re-export files without loading them. **For 06:** once a command imports `lib/term/` eagerly, the mini-kit fixtures that copy only `cli/` and `lib/` will fail with `Cannot find module …/zcode-proxy-src/src/tui/width-core.mjs`. Those fixtures are `cli-kit`, `cli-audit`, `setup-regressions`, `harness-consent`, `auto-heal`, the golden-path script and `ux/capture` `KIT_FILES`. Fix them by also copying `zcode-proxy-src/src/tui/{width-core,tokens}.mjs` (a justified fixture change), or keep rendering lazy on the paths those fixtures run. Do not fork the core.
2. `frame.ts` keeps its own `DIM = "90"` (bright black), because the `muted` token is SGR 2 (design-language §3.3). Switching now would change every frame. Ticket 48 (TUI redesign) moves the TUI onto `ROLES.muted` and onto tiers; until then `frame.ts` uses the `full` tier only.
3. Zero-width set: Mn + Me + Cf, minus U+00AD (soft hyphen, drawn by terminals), plus Hangul U+1160–11FF and U+D7B0–D7FF. TAB stays 0 cells, as before: the ticket and spec do not ask for tab expansion, and frames do not change. VS15 is not special-cased; research mentions it, but the ticket does not.
4. A fourth UCD file (`GraphemeBreakProperty.txt`) feeds the no-combining fast path. LV/LVT syllables are not joiners (only a following V/T, which is one, extends them), so Korean text stays on the fast path.
5. `wrapToWidth` (design-language §9) is not added: it is not in this ticket. 06 can add it to the core when `lib/term/` needs it.
6. The benchmark lives in `tests/bench/` (a Bun script, not a `*.test.*` file, so the wiring guard does not apply). It takes the proxy source directory as an argument, so it runs unchanged against any commit.

**Common acceptance**
- RED → GREEN at seams 6 and 9: ✓ (above).
- Fast suite green locally on ubuntu: ✓. The windows-latest leg and the `memory-budget` job: pending CI (orchestrator verifies after merge+push). Locally S6/short is unchanged apart from the faster frame time.
- New test files wired: ✓.
- Pre-existing test changes justified: ✓ (above).
- No new log events, config keys or env overrides: n/a.

Merged 2026-11-06 as 4352e3272daa3e473ee779e2cb30004a456a6bdc; fast suite: kit 350/361 (11 skipped, 0 fail; includes tests/width-core.test.mjs), proxy 1343/1343, mcp 95/96 (1 skipped, 0 fail); mcp dist unchanged; pack build --tracked-only + verify-payload OK (204 files, all required files present). Logs: .scratch/kit-overhaul/reports/merge-05-{npmci,kit,proxy,mcp,payload}.log.
