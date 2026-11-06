# 05: Shared width core and token set (two renderers, one token set)

**Blocked by:** 01 (Memory loop with budgets, process-count harness, expected-RED ratchet and the ubuntu `memory-budget` job)

**Status:** ready-for-agent

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
