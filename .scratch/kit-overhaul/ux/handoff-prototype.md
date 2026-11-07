# Handoff: terminal-UX prototype (Phase 1C → Owner Proxy pick → Phase 2/3)

Written 2026-11-06 by the 1C UX design lead, following the handoff skill (mattpocock-skills `productivity/handoff`). Following the 1C brief, it lives in the run's `ux/` directory instead of `$TMPDIR`.

**Next session's job:**
- an Owner Proxy round chooses one variant, or a merge of variants, with a rationale (prompt §7 1C);
- the orchestrator then carries the verdict into `/grill-with-docs` (Phase 2) and the spec/tickets (Phase 3).

## The question this prototype answers

"What should zcode-kit's terminal output look like?" (the prototype skill's UI branch). The answer must hold across the C3 terminal modes and must use only stdlib plus the kit's existing `width.ts` (C4).

## Where things are

| What | Path |
|---|---|
| Prototype code (throwaway, never merge) | branch `prototype/terminal-ux` at **`d27b890`**, worktree `/home/AgentKit/wt/prototype-ux`, file `cli/ux-prototype/terminal-ux.prototype.mjs` (+ `prototype:ux` npm script). Local only, not pushed |
| Pre-rendered outputs (no need to run anything) | `ux/prototype/<A-ledger|B-cards|C-outline>/<screen>/<mode>.txt` (+ `.ansi` where colour is on). Screens: `help doctor setup status error tui`. Modes: `tty-color-80 tty-color-120 no-color term-dumb ascii win-conhost-wgl4 pipe ci` |
| What the variants must fix | [ux-audit.md](ux-audit.md) (27 findings, top 5 at the top) |
| The design language the variants express | [design-language.md](design-language.md) (tokens, primitives, TUI layout, `lib/term/` interface, open decisions D0–D6) |
| BEFORE evidence | [before/INDEX.md](before/INDEX.md) (640 captures) and the regenerating script `ux/capture/capture.mjs` |
| Terminal facts the rules rest on | `../research/terminal-conventions.md` |

## How to run it

```sh
cd /home/AgentKit/wt/prototype-ux
npm run prototype:ux -- --interactive                  # ←/→ switches the variant, ↑/↓ the screen, q quits (TTY only)
npm run prototype:ux -- --variant B --screen doctor    # one screen in this terminal
npm run prototype:ux -- --variant C                    # every screen of variant C
NO_COLOR=1 npm run prototype:ux -- --variant A --screen status --width 80
npm run prototype:ux -- --variant A --screen tui --glyphs wgl4   # Windows 10 conhost glyph tier
npm run prototype:ux -- --render-all /tmp/ux-proto      # regenerate ux/prototype/
```

- Node ≥ 22.18 is needed, because the prototype imports `zcode-proxy-src/src/tui/width.ts` through Node's type stripping. That works only outside `node_modules`, which is one reason design-language §5 proposes a `.mjs` width core.
- It uses fake data only: no network, no files written except `--render-all`.

## The variants

All three use the same tokens (glyph + word statuses, the full/wgl4/ascii glyph tiers, 16-colour roles) and the same capability probe. They differ in layout and information hierarchy.

### A — Ledger
- Classic line-oriented output: a bold section heading with a rule, one row per check in a fixed status column, and details aligned in a second column.
- `why`/`next` hang under failing rows, and a verdict line closes the report.
- Connection details are an unboxed aligned key/value block.
- TUI: a 3-row status card (state, memory per process + quota, accounts), then the log card with a filter row, then a priority-ordered footer.
- Renders: [doctor](prototype/A-ledger/doctor/tty-color-80.txt), [status](prototype/A-ledger/status/tty-color-80.txt), [tui](prototype/A-ledger/tui/tty-color-80.txt).

**Trade-offs:**
- (+) Closest to today's output, so the smallest change and blast radius (C9).
- (+) grep-stable: it keeps the `PASS|FAIL|SKIP` row grammar (C2).
- (+) The connection values copy cleanly.
- (+) It reads well in pipes and CI.
- (−) The answer comes last on a long doctor run.
- (−) Least visual separation between groups.

### B — Cards
- The answer comes first, in boxed cards: a verdict card, then one error card per problem (what/why/next), then one card per check group with an `n/m ok` badge.
- Connection details sit in a "Connect any client" card.
- TUI: a 4-tile dashboard (Health, Memory, Quota, Accounts) above the log card.
- Renders: [doctor](prototype/B-cards/doctor/tty-color-80.txt), [status](prototype/B-cards/status/tty-color-80.txt), [tui](prototype/B-cards/tui/tty-color-80.txt).

**Trade-offs:**
- (+) Most scannable on a wide colour TTY.
- (+) Problems are impossible to miss.
- (+) The TUI tiles give an at-a-glance health read.
- (−) Heaviest chrome: about as many lines as A for the same doctor run (47 vs 42 at 80 columns; 49 vs 35 in a pipe), but nearly every line carries border characters.
- (−) Box borders end up in copied values (a key or URL copied from inside a card picks up `│`).
- (−) Prose must re-wrap inside boxes.
- (−) In pipes and CI the boxes are pure noise.
- (−) On conhost it depends on the wgl4 corner fallback.
- (−) At 80 columns the TUI tiles are 19 cells wide and labels get cramped (`personal exh.`).

### C — Outline
- Problem-first and dense, with no boxes.
- A one-line verdict leads. Each problem follows as a small tree (`├─ why`, `└─ next`). Passing checks collapse to one line per group (`--verbose` expands them).
- Help is man-page shaped: Usage, **Common tasks with examples first**, Commands, Exit codes.
- TUI: a reverse-video status bar plus a full-height log pane. At ≥100 columns a right sidebar shows memory, quota and accounts.
- Renders: [doctor](prototype/C-outline/doctor/tty-color-80.txt), [help](prototype/C-outline/help/tty-color-80.txt), [tui 120](prototype/C-outline/tui/tty-color-120.txt).

**Trade-offs:**
- (+) Shortest output: 23 lines for the doctor run that takes A 42.
- (+) The answer is in line 1.
- (+) Best at 80 columns and in pipes.
- (+) Its help is the most task-oriented.
- (+) The wide-TUI sidebar uses space well.
- (−) Collapsing passing checks hides per-check lines from grep and from the user unless `--verbose` is given (it needs D3-style care for C2).
- (−) Tree glyphs are one more tier-dependent chrome set.
- (−) At 80 columns the TUI shows only total RSS, not RSS per process (the C1 visibility the brief asks for).

## Recommendation

**A as the base, with three parts taken from C** (design-language D0):
1. C's help structure (Common tasks/examples first, grouped commands, environment, exit codes).
2. C's one-line verdict *also* as the first line of `doctor` whenever something failed.
3. C's ≥100-column TUI sidebar.

Keep B's idea of a distinct verdict, but do not take its boxes. A's unboxed error block (what/why/next) is the error format everywhere.

**Why:**
- It fixes every S1/S2 audit finding without changing the stable surfaces: the check grammar, `[OK]` tags off a TTY, JSON, exit codes (C2).
- It keeps copyable values unboxed (manual connection details, C3).
- It degrades best: pipe, CI, TERM=dumb, conhost wgl4, ascii.
- It is the simplest to build on `lib/term/out.mjs` + `frame.ts` (C4, C9).

**Verdict status:** pending. The Owner Proxy decides. Capture the answer, the question it settled and the chosen variant in DECISIONS.md and on the implementation tickets. Point them at branch `prototype/terminal-ux` @ `d27b890` as the primary source (prototype skill rule 6).

## Open decisions to put to the Owner Proxy

Listed with recommendations in [design-language.md §12](design-language.md):
- **D0** variant;
- **D1** stop re-asking the Account Rotator question (audit A-04);
- **D2** move errors/progress/prompts to stderr, phased;
- **D3** add `WARN` to the doctor grammar;
- **D4** `auth status` human-readable by default;
- **D5** single-source `width-core.mjs`;
- **D6** compact setup output as the default.

Each needs a reversibility note: D1, D3, D5 and D6 are two-way doors. D2 and D4 change the stdout of scripted callers, so they are announced one release ahead.

## Known limits of this evidence

- **install.ps1 was never executed** (no PowerShell on the host), and no Windows console or macOS terminal was observed. `win-conhost-wgl4` is a *simulated* glyph tier based on the research's WGL4 list. Verifying on real hardware is an owner action: PowerShell 5.1 + 7, conhost + Windows Terminal.
- **The prototype is not complete.**
  - It does not implement the collapsed TUI settings strip, the filter prompt interaction, or progress animation. Progress is specified in design-language §4.10 only.
  - Variant B loses colour on wrapped rows.
  - The ascii tier's copy mapping is a post-pass in the prototype, not the per-token mapping a real module needs.
- **Per-worker RSS in the TUI header needs a data contract** from the 1B diagnosis work. The prototype's numbers are fake.

## Suggested skills for the next agent

- `grill-with-docs` (Phase 2): fold D0–D6 into GLOSSARY.md/ADRs. "Status token", "verdict line", "connection card" and "glyph tier" are glossary candidates.
- `to-spec` and then `to-tickets` (Phase 3). Suggested ticket seams:
  - `lib/term/` + `width-core.mjs`/`tokens.mjs`;
  - `doctor` report (A-02);
  - `setup`/installer output (A-01, A-15);
  - error blocks + streams (A-05, A-09);
  - help (A-10);
  - TUI header/strip/filter/NO_COLOR (A-03, A-18);
  - install.sh fixes (A-06, A-13);
  - the AFTER snapshot tests built on `ux/capture/capture.mjs`.
- `tdd` for `lib/term/` (pure, fake-stream testable) and `code-review` for the integration diff.
- `prototype`: only if the Owner Proxy asks for a fourth variant. Extend the existing branch rather than starting a new one.
