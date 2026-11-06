# zcode-kit terminal design language (proposal)

Phase 1C, 2026-11-06. This proposal answers the findings in [ux-audit.md](ux-audit.md). Terminal facts and the rule numbers `R1`–`R22` come from [../research/terminal-conventions.md](../research/terminal-conventions.md); this document adopts those rules and does not restate their evidence. The three visual variants and the recommended merge are in [handoff-prototype.md](handoff-prototype.md). Layout examples below come from the recommended variant (A "Ledger", with C's help shape), rendered by the prototype into [prototype/](prototype/).

The proposal holds under three Charter clauses:
- **C3:** clarity, hierarchy and consistency beat decoration;
- **C4:** stdlib plus the kit's own `width.ts`/`frame.ts`, no new runtime dependency;
- **C2:** `--json` output, exit codes and the `PASS|FAIL|SKIP` check grammar stay stable.

---

## 1 · Principles

1. **One answer per command, stated as a word.** Every command ends with a verdict line, or for `status` begins with a state line. The reader never infers success from the absence of errors.
2. **Problems before inventory.** Failures and warnings carry what/why/next and appear before the list of passing items, or are marked so they can be found in one scan.
3. **Glyph + word, never colour alone** (R11). Colour only reinforces.
4. **Designed for 80 columns, correct at any width.** Prose wraps and is never cut. Data written to a pipe is never wrapped or truncated (R17).
5. **The terminal decides the decoration; the content never changes.** The same facts appear on a TTY, in a pipe, in CI, under NO_COLOR, TERM=dumb and on conhost. Only glyphs, colour and motion degrade.
6. **Data to stdout, conversation to stderr** (R7, phased; see §10).
7. **Copyable things are not boxed.** Commands, URLs and keys sit on their own lines with no border characters, so a triple-click copies exactly the value.

## 2 · Capability record (R1–R6)

The kit computes this once per output stream, in `lib/term/caps.mjs`. No other module reads `isTTY`, `NO_COLOR`, `TERM`, `CI` or `columns`.

```js
/** @typedef {{
 *   tty: boolean,                          // stream.isTTY
 *   color: 0 | 16 | 256 | 16777216,        // R2 precedence; the kit uses ≤16 (R13)
 *   glyphs: "full" | "wgl4" | "ascii",     // R4
 *   animate: boolean,                      // R6: tty && TERM!=dumb && !CI
 *   hyperlinks: boolean,                   // R5 allowlist; off by default in v1
 *   columns: number,                       // stream.columns ?? COLUMNS ?? 80, min 40
 *   wrap: boolean,                         // true on a TTY; off a TTY prose wraps at 80, data never
 * }} Caps */
detectCaps(stream, { env = process.env, flags = {}, platform = process.platform, release = os.release() }) → Caps
```

The overrides follow R22 and are documented in help:
- `--color=auto|always|never` (and `--no-color`);
- `ZCODE_KIT_UNICODE=0|1`;
- `ZCODE_KIT_PROGRESS=auto|always|never`;
- `ZCODE_KIT_HYPERLINKS=auto|always|never`.

`NO_COLOR` wins over `FORCE_COLOR` (research §1 recommendation).

## 3 · Tokens

### 3.1 Status tokens

| Token | Meaning | Word (all tiers) | full | wgl4 | ascii | Colour role |
|---|---|---|---|---|---|---|
| `pass` | a check passed | `PASS` | `✓` | `√` | `+` | ok |
| `ok` | an action succeeded | `OK` | `✓` | `√` | `+` | ok |
| `fail` | a check or action failed | `FAIL` | `✗` | `×` | `x` | fail |
| `warn` | works, needs attention | `WARN` | `!` | `!` | `!` | warn |
| `skip` | not applicable / declined / not detected | `SKIP` | `–` | `–` | `-` | muted |
| `info` | neutral fact (e.g. "Account Rotator disabled") | `INFO` | `•` | `•` | `*` | info |
| `run` / `stop` | process state | `running` / `stopped` | `●` / `○` | `●` / `○` | `*` / `o` | ok / muted |

The rules:
- **Two families, shared words.** *Checks* (doctor, accounts doctor, upstream) report `PASS|FAIL|WARN|SKIP`. *Actions* (setup, integrate, update, rollback, uninstall) report `OK|FAIL|WARN|SKIP|INFO`. `FAIL`, `WARN` and `SKIP` mean the same in both families.
- `WARN` is new for checks (audit A-08). For scripts it counts as "not failed": exit code 0, as today.
- **Word placement.** The word is always printed. The glyph precedes it on a TTY. Off a TTY, and on the `ascii` tier, the word appears in brackets (`[FAIL]`) or alone, so grep keeps working (`grep -E '^(PASS|FAIL)'`).
- **Neutral choices are `INFO`, not `OK`.** For example, "Account Rotator disabled" (A-08).

### 3.2 Chrome glyphs (R12)

| Purpose | full | wgl4 | ascii |
|---|---|---|---|
| Card corners | `╭ ╮ ╰ ╯` | `┌ ┐ └ ┘` | `+` |
| Lines | `─ │` | `─ │` | `- \|` |
| Section rule | `─` | `─` | `-` |
| Bullet / separator | `• ·` | `• ·` | `* -` |
| Next / pointer | `▸ →` | `► →` | `> ->` |
| Ellipsis | `…` | `…` | `...` |
| Bar (filled / empty) | `█ ░` | `█ ░` | `# .` |
| Scroll hints | `↑ ↓ ▼` | `↑ ↓ ▼` | `^ v` |
| Spinner frames | `\| / - \` | same | same |

Banned at every tier: emoji, braille spinners, and VS16 presentation (R12).

**Copy follows the tier.** On `ascii`, kit-authored punctuation maps down (`—`→`-`, `·`→`-`, `…`→`...`, `→`→`->`). User and upstream data (model errors in CJK, account labels) stay UTF-8 (R4).

### 3.3 Colour roles (16-colour SGR only, R13)

| Role | SGR | Use |
|---|---|---|
| `ok` | 32 green | `PASS`/`OK` word + glyph, `running` |
| `fail` | 31 red | `FAIL` word + glyph, the error block's first line. Never whole paragraphs (A-13) |
| `warn` | 33 yellow | `WARN`, exhausted quota, near-cap memory |
| `info` / `accent` | 36 cyan | key hints in the TUI footer, filter label |
| `heading` | 1 bold | section titles, the card title |
| `cmd` | 1 bold | commands the user should type (`next` lines, help command column) |
| `muted` | 2 dim | details, units, labels in key/value, borders |

- Close SGR on the same line (R14).
- With colour off, emit no escape sequences at all in line mode (R15).
- In the full-screen TUI, NO_COLOR drops colour but keeps bold/reverse to show state (§8.5).

## 4 · Text primitives

All of these live in `lib/term/out.mjs` (§9).

### 4.1 Section header

`Title ` followed by a rule to column 80 (or `min(columns, 80)`), as in `Runtime ──────…`. On the ascii tier the rule is `-`. In a pipe it is kept: it is one line, and it delimits groups for humans and for `awk '/^Runtime/'`.

### 4.2 Key/value block

```
  OpenAI base URL     http://127.0.0.1:8457/v1
  Anthropic base URL  http://127.0.0.1:8457
```

- Two-space indent. Keys are muted and padded to the longest key in the block with `padEndWidth`.
- Two spaces before the value. Values never wrap mid-token: a long value wraps with a hanging indent under the value column on a TTY, and stays on one line in a pipe.

### 4.3 Check / result row

```
  ✓ PASS  Proxy dependencies              zcode-proxy-src/node_modules
  ✗ FAIL  MCP bridge dependencies         mcp/zcode-harness-mcp/node_modules missing
                                          why   the last setup was interrupted before …
                                          next  zcode-kit setup
```

- The status column is fixed: glyph, space, a word padded to 4.
- The name column is padded to the longest name in the group. The detail is muted.
- `why` and `next` hang under the detail column. Only `FAIL` and `WARN` carry them, and every `FAIL` must.
- Off a TTY the row is one line, `FAIL  <name> — <detail>`, followed by indented `why:`/`next:` lines. That keeps the legacy `^(PASS|FAIL|SKIP)\s+` grammar (§11).

### 4.4 Verdict line

`doctor: 2 failed, 1 warning, 9 passed, 3 skipped → exit 1`

The verdict is the last line of any check report. Counts carry their word as well as their colour, and the exit code is named when it is non-zero. Recommended merge: the same line also opens `doctor` when there is at least one `FAIL` (C's problem-first lead), so a long report gives its answer in the first line too.

### 4.5 Error block (what / why / next)

```
✗ FAIL  Port 8457 is in use by another service
   why   it answered /health without this kit's identity (HTTP 401); the kit
         never stops a service it did not start
   next  zcode-kit proxy status
     or  change server.port in proxy/config.yaml, then zcode-kit proxy start
   exit 3
```

- **what:** one line, sentence case, no trailing period. Says what failed, not where in the code.
- **why:** the cause as the kit knows it. Ownership-safety language belongs here ("left untouched", "never stops a service it did not start").
- **next:** at least one exact command, copyable on its own line. `or` adds alternatives. For a human-only action, the next line says what to do and where (`unlock the phone…` style).
- **exit:** shown when non-zero.
- Goes to **stderr**. One block per failure, and no stack traces unless `ZCODE_KIT_DEBUG=1`.
- Warnings use the same block with `! WARN`.

### 4.6 Summary card: connection details

The manual-client card is printed **once** per command (A-12). It is an unboxed key/value block under a section header, so every value copies cleanly:

```
Connection details (manual clients) ────────────────────────────────────────
  OpenAI base URL     http://127.0.0.1:8457/v1
  Anthropic base URL  http://127.0.0.1:8457
  API key             k7Qm2_…                 (TTY only; otherwise: hidden — zcode-kit models --show-key)
  Models              glm-5.3, glm-5.3-flash
  State               ● running, identity verified
```

- The content rules are unchanged from `cli/connection-details.mjs`: key reveal only on an interactive TTY outside CI, and `running` only after the identity proof.
- Routes move to `zcode-kit proxy status --verbose` and the JSON. The block must fit 80 columns.

### 4.7 Tables

For accounts, health and quota:
- A header row in muted bold, columns padded with `padEndWidth`.
- Numbers right-aligned, with one number format: thousands without separators, `69 %`, durations as `1 h 02 min`/`3 d`, dates as `YYYY-MM-DD` or local `HH:MM`.
- An active-row marker `*`, explained in a footer line.
- On a TTY narrower than the table, the right-most text column truncates with the tier ellipsis. In a pipe, nothing truncates.

### 4.8 Bars

`█████░░░░░ 52 %` gives fill plus a number; the number is mandatory (no meaning by length alone). Width is 10 cells at 80 columns, 16 at ≥120.

### 4.9 Prompts

- **When:** only when stdin *and* stderr are TTYs (R10), on stderr.
- **Form:** `? Configure ZCode for Codex CLI? [y/N]`. The default is capitalised. Any context the answer implies (MCP bridge registration, an existing integration) goes on the line above as an `INFO` note, indented like everything else (A-22).
- **Remembered decisions are never asked again** without `--reask`. That includes the Account Rotator choice (A-04, Owner Proxy decision D1).

### 4.10 Progress (TTY-only motion, R6)

| Caps | Behaviour |
|---|---|
| `animate` | One line on stderr: spinner frame + label + elapsed time after 2 s, redrawn ≤10 Hz with `\r`+`ESC[K`. It ends by replacing itself with a result row (`✓ OK  Proxy dependencies installed (14 s)`). On failure, the hidden subprocess output is printed under the error block. |
| not `animate` | `label ...` printed once when the step starts, then a result row when it ends: `OK  Proxy dependencies installed (14 s)`. No `\r` and no cursor movement. |

Steps of known count are numbered `[2/4]` (install.sh/ps1, update). A sub-command's own steps nest one indent level deeper and never reuse the parent's heading style (A-21).

## 5 · Width handling

- **Measurement:** `displayWidth`, `truncateToWidth` and `padEndWidth` from the kit's own `width.ts`. The fixes in research §3 / R16 are needed: grapheme clusters through `Intl.Segmenter`, a W/F table generated from UCD 17, `\t` expanded, clusters capped at 2, and truncation only at cluster boundaries. Kit chrome contains no Ambiguous-width or emoji glyph in aligned positions.
- **Single source for Node and Bun (C4).** Move the implementation into `zcode-proxy-src/src/tui/width-core.mjs` (plain ESM) with `width-core.d.mts`. This is the pattern the repo already uses for `zcode-proxy-src/captcha-compatibility.mjs`/`.d.mts`, which TypeScript in `src/proxy/captcha-compatibility.test.ts` imports. Then:
  - `width.ts` becomes `export * from "./width-core.mjs"`, so every existing import and test keeps working, and the Docker image (which copies `src/` only) stays self-contained;
  - the Node CLI imports the same file through `lib/term/width.mjs`;
  - no type stripping is needed. Node does not strip types under `node_modules`, which rules out importing `.ts` from the npm install.
- **Design width:** 80. Help wraps at `min(columns, 100)` on a TTY and at 80 off a TTY.
- **Never truncate** prose, errors, commands, URLs or keys. Truncation is allowed only for:
  - TUI log lines (the full line stays in `proxy logs`);
  - TUI header fields;
  - table text cells on a narrow TTY.
- **Frames:** `frame.ts` keeps composing every row to exactly `width` cells and keeps the "terminal too small" notice (below 40×14 today; 60×16 for the new layout, §8).

## 6 · Help structure (R21; C's shape)

```
zcode-kit — local ZCode provider for your own agent harnesses

Usage  zcode-kit <command> [options]

Common tasks
  first run, one y/n question per detected assistant
    $ zcode-kit setup
  …

Get started      setup · integrate <harness> · run <harness> -- <args>
Check and fix    doctor · status · models
Proxy service    proxy start|stop|restart|status|logs
Accounts         auth status|login|logout · accounts …
Maintenance      update · rollback · uninstall

Environment      ZCODE_KIT_HARNESSES, ZCODE_KIT_ACCOUNT_ROTATOR, NO_COLOR, ZCODE_KIT_UNICODE, …
Exit codes       0 ok · 1 checks failed · 2 usage/runtime error · 3 port conflict · …
More             zcode-kit <command> --help · README.md#commands
```

- **Every command gets its own `--help`.** It contains a one-sentence description, the flags (long form, aligned), 1–3 examples and that command's exit codes. The parenthesised notes in today's help move there.
- **Usage errors** (unknown command or flag, missing argument) print a two-line message to stderr and exit 2: `FAIL  unknown command "frobnicate"`, then `next  zcode-kit --help`. Not the whole page (A-09).

## 7 · Command layouts

The full renders are in `prototype/A-ledger/<screen>/<mode>.txt`. The summaries:

| Command | Shape |
|---|---|
| `doctor` | Verdict lead (if anything failed) → groups `Runtime`, `Proxy`, `Account`, `Integrations`, `Upstream` (`--upstream`), each a section header plus check rows → verdict line. Each check appears once (A-02). `--verbose` adds paths; `--json` is unchanged. |
| `setup` | Steps `Runtime` → `Assistants` (prompt + result row per harness) → `Account Rotator` → `Connection check`, each as a progress or result row. Adapter diagnostics go to the setup log, plus the screen in `--verbose`. Then a summary block (assistants n/n/n, rotator, live check, undo command), the connection card, and `Next` commands. Same layout in installer mode: compact *is* the default. |
| `proxy status` / `status` | State line (`● running since 1 h 02 min (pid …)`) → `Memory` (one row per process: RSS of cap, bar, pid) → `Quota` (row per package) → `Accounts` (one line) → `Captcha` → connection card. Down: `○ stopped`, a `next zcode-kit proxy start` line, then the configured card. Foreign / no key: the error block. |
| `proxy start|stop|restart` | Progress row → result row (`✓ OK  proxy started on 127.0.0.1:8457 (pid …)`), then the card (start/restart only). |
| `proxy logs [n]` | Raw lines (data) on stdout. Proposed additive `--level warn|error` and `--grep <text>` filters. |
| `accounts`, `accounts health` | A table with an active marker and a verdict word per account, plus the summary line `usable: 1 of 3`. `next` names `zcode-kit …`, never `zcode-proxy …` (A-19). |
| `integrate --dry-run` | Every file it would write or patch and every external registration, each as `would write  <path>` / `would register  <what>  (undo: <cmd>)` (A-16). |
| `update` | `[1/5] Download` `[2/5] Verify` `[3/5] Stop proxy` `[4/5] Apply` `[5/5] Refresh integrations + start proxy`, then the summary with the undo command. The card is printed once, at the end. |
| `rollback`, `uninstall` | One result row per restored or removed file, then a verdict (`OK  rolled back <tx>: 2 restored, 5 removed, 0 conflicts`). Conflicts and manual undos are `WARN` blocks with `next`. |
| `run <harness>` | Kit messages only on stderr (A-05). The preflight is one `OK`/`WARN` row. |
| `auth status` | A human key/value block (`Logged in  yes · token 5.2 h old`). JSON only with `--json`. **Compat note:** `auth status` prints JSON today without a flag, so the change needs Owner Proxy decision D4. |

## 8 · Proxy TUI layout

It extends the pure `buildFrame(state) → { text, regions }` architecture of `frame.ts` (C4). Click regions, `keys.ts` and `log-pane.ts` stay.

### 8.1 Regions (top to bottom)

1. **Status header** (card, 3 content rows):
   - row 1: `● running :8457 · health ok · up 1 h 02 min · zai / start-plan`, with `logged in` / `logged out` as the right-hand badge in words;
   - row 2: `memory  proxy 182 MB  captcha 311 MB  fetch 41 MB` (RSS per process, warn colour + `!` when above 85 % of its cap), then `quota  4120/6000  35/200`;
   - row 3: `accounts  *work usable  personal exhausted  backup paused`.

   At ≥100 columns the header data moves to a 28-column **right sidebar** (MEMORY / QUOTA / ACCOUNTS stacked, with bars) and row 1 stays as the header (C's wide layout).
2. **Settings strip** (collapsed, 1 row): `provider (•) zai  ( ) bigmodel   plan ( ) coding-plan  (•) start-plan   [L] login`. **Selection is marked with text** (`(•)`/`( )`, ascii `(*)`/`( )`) as well as colour. Disabled controls are bracketed and dimmed, and the toast explains why when one is pressed (`provider is fixed while the proxy runs — stop it first`). The strip replaces today's 6-row Settings card, which returns the height to the log pane.
3. **Log pane** (card, absorbs the remaining height):
   - title `Logs (214)`, right badge `following` or `▼ 42 more · g follow`;
   - first row: the filter, `filter: 429   12 of 214 lines`, shown only while a filter is active;
   - `/` opens the filter prompt (substring; `level:warn`/`level:error` shortcuts), `Esc` clears it.
   - Each line shows `HH:MM:SS`, a level word (`warn `, `ERROR`, blank for info) and the text, truncated with the tier ellipsis. Colour by level only reinforces the word.
4. **Toast** (1 row, optional): `▸ proxy started on http://127.0.0.1:8457` (ascii `>`), with its kind as a word for errors (`FAIL …`).
5. **Key-hint footer** (1 row, no chrome), in priority order. Truncation happens from the right, so `quit` is always visible: `[q] quit  [s] start/stop  [/] filter  [l] login  [g] follow  [c] clear  [p] provider  [t] plan  ↑↓ scroll`. When something does not fit, a final `[?] keys` shows the full list in an overlay (A-18).

### 8.2 Sketch (80×24, full tier; wgl4 swaps the corners for `┌┐└┘`)

```
╭─ ZCode proxy ───────────────────────────────────────────────────── logged in ╮
│ ● running  :8457  ·  health ok  ·  up 1 h 02 min  ·  zai / start-plan        │
│ memory  proxy 182 MB  captcha 311 MB  fetch 41 MB   quota  4120/6000  35/200 │
│ accounts  *work usable  personal exhausted  backup paused                    │
╰──────────────────────────────────────────────────────────────────────────────╯
 provider (•) zai ( ) bigmodel  ·  plan ( ) coding-plan (•) start-plan  [L]
╭─ Logs (214) ────────────────────────────────────────────────────── following ╮
│ filter: 429   12 of 214 lines                                                │
│ 12:03:41 warn  r17 ANT glm-5.3 429 batch 233ms rate limited, retry in 30 s   │
│ …                                                                            │
╰──────────────────────────────────────────────────────────────────────────────╯
 [q] quit  [s] start/stop  [/] filter  [l] login  [g] follow  [c] clear  [?]keys
```

The prototype's A-variant render at [prototype/A-ledger/tui/tty-color-80.txt](prototype/A-ledger/tui/tty-color-80.txt) shows header, filtered logs and footer. The collapsed settings strip is specified here and is not in the prototype.

### 8.3 Data sources (no new endpoints)

| Field | Source |
|---|---|
| Health, uptime, RSS | the proxy's own `/health` `details` |
| Per-worker RSS | needs the diagnosis lead's process sampler / worker stats. Field contract to be agreed in Phase 3 |
| Quota | `/quota` |
| Accounts | `/accounts/status` + `/accounts/quota` |

The poll interval is ≥5 s, with a single in-flight request per endpoint (C1: bounded work).

### 8.4 Size rules

- Minimum 60×16. Below that, a one-line notice: `zcode-proxy: terminal too small (need ≥ 60×16, have 52×14) — resize, or use zcode-kit proxy status`.
- The header degrades row by row: row 3 is dropped first, then row 2 shrinks to `rss 534 MB · quota 4155`.
- The log pane keeps ≥3 rows.

### 8.5 Terminal rules

| Condition | Behaviour |
|---|---|
| Non-TTY stdin/stdout, or TERM=dumb | Refuse with the line-mode commands: `zcode-kit proxy status`, `zcode-kit proxy logs 50` (R18) |
| NO_COLOR | No colour SGR. Bold for titles, reverse video for the focused/selected control, and the `(•)` text markers carry state (R15) |
| Colour | 16-colour roles only. The truecolor button palette (`38;2`/`48;2`) maps to green/red/blue/gray backgrounds 42/41/44/100, or to brackets plus reverse at depth 16 (R13) |
| wgl4 tier | `┌┐└┘`, `►` for the toast, `×` for failed. ascii: `+-|`, `>`, `x` |
| Exit | Restore alt-screen, cursor, mouse and raw mode on normal exit, error, SIGINT and SIGTERM (R14; already done in `app.ts`) |

## 9 · Shared output module

**Name:** `lib/term/`, the kit-side presentation layer. Every Node entry point uses it: `cli/zcode-kit.mjs`, `cli/*`, `proxy/zcode-proxy-manager.mjs`, `cli/heal.mjs`. Its glyph and width core is shared with the Bun TUI. It has no dependencies, and Node and Bun both run it unchanged.

| File | Exports | Notes |
|---|---|---|
| `zcode-proxy-src/src/tui/width-core.mjs` (+ `.d.mts`) | `displayWidth`, `truncateToWidth`, `padEndWidth`, `stripAnsi`, `wrapToWidth(text, width, {first, rest})` | Single source (§5); `width.ts` re-exports it |
| `zcode-proxy-src/src/tui/tokens.mjs` (+ `.d.mts`) | `GLYPHS[tier]`, `BOX[tier]`, `ROLES`, `WORDS` | Shared by `frame.ts` and the CLI |
| `lib/term/caps.mjs` | `detectCaps(stream, opts) → Caps` | §2; the only reader of TTY/env |
| `lib/term/out.mjs` | `createOutput(opts) → Out` | Line renderer, below |
| `lib/term/width.mjs` | re-export of `width-core.mjs` | path indirection for the CLI |

```js
/**
 * createOutput({ stdout = process.stdout, stderr = process.stderr, env, flags, json = false }) → Out
 * Every method renders through the stream's Caps; nothing else writes to the terminal.
 */
interface Out {
  readonly caps: { out: Caps, err: Caps };
  // structure (stdout)
  heading(title: string): void;                           // §4.1
  kv(pairs: Array<[key: string, value: string]>, opts?: { indent?: number }): void;   // §4.2
  check(row: { status: "pass"|"fail"|"warn"|"skip", name: string, detail?: string,
               why?: string, next?: string | string[] }): void;   // §4.3, legacy grammar off-TTY
  result(row: { status: "ok"|"fail"|"warn"|"skip"|"info", label: string, detail?: string }): void;
  table(columns: Array<{ key: string, title: string, align?: "left"|"right", truncate?: boolean }>,
        rows: object[], opts?: { marker?: (row) => boolean, footer?: string }): void;   // §4.7
  card(title: string, pairs: Array<[string, string]>, opts?: { badge?: { status, text } }): void; // §4.6
  connection(facts: ConnectionFacts, opts: { reveal: boolean }): void;   // wraps cli/connection-details.mjs rules
  verdict(counts: Record<"pass"|"fail"|"warn"|"skip", number>, opts?: { label: string, exit?: number }): void; // §4.4
  next(commands: string[]): void;
  // conversation (stderr)
  error(block: { what: string, why?: string, next?: string[], exit?: number }): void;  // §4.5
  warn(block: { what: string, why?: string, next?: string[] }): void;
  note(text: string): void;                               // INFO line
  step(label: string, total?: [n: number, of: number]): Progress;   // §4.10
  // data (stdout, untouched)
  data(text: string): void;                               // never wrapped, never decorated
  json(value: unknown): void;                             // R8: one document, no ANSI
}
interface Progress { update(label: string): void; done(detail?: string): void; fail(block): void; skip(reason: string): void; }
```

- **Prompts** stay in `cli/harness-consent.mjs` (`createPrompter`); they render through `out.caps.err`.
- **Compact setup** (`cli/setup-output.mjs`) becomes a thin adapter over `Out` with the log file as a second sink.
- **The manager** gets `createOutput` injected, so `doctor` can ask it for checks as data (A-02) instead of parsing its stdout.
- **Testing:** the module is pure apart from `write`, so snapshot tests drive it with fake streams `{ isTTY, columns, write }` and a fixed env, one per C3 variant. `ux/capture/capture.mjs` then supplies the end-to-end BEFORE/AFTER snapshots.

## 10 · Streams (R7), phased for C2

- **Phase 1 (this overhaul):**
  - `run`: all kit messages go to stderr (A-05).
  - Every error and warning block goes to stderr.
  - Prompts go to stderr.
  - Progress goes to stderr.
  - Reports (`doctor`, `status`, setup summary, connection card) and data (`models`, `logs`, JSON) stay on stdout.
- **Not changed:** exit codes, `--json` documents, the doctor check grammar off a TTY (§11).
- **Release notes:** announce the stream move for error lines (C2: "deprecations are announced").

## 11 · Compatibility constraints the design must keep (C2)

- `doctor` text lines off a TTY keep `^(PASS|FAIL|SKIP)\s{2}<name>( — <detail>)?$`. `WARN` is added as a fourth word; it is the only additive change, and the release notes announce it. `why:`/`next:` continuation lines start with whitespace, so line-anchored greps are unaffected.
- All `--json` outputs stay byte-compatible (keys may only be added): `doctor`, `status`, `proxy status`, `models`, `usage`, `accounts*`, `auth status`.
- Exit codes are unchanged: 0, 1, 2, 3, 4, 5, 20 and 130.
- The `[OK]`/`[SKIP]`/`[FAIL]`/`[WARN]` installer tags off a TTY stay, because install tests and users match them.
- Key-redaction rules and the `--show-key` export path are unchanged (C6).
- Env vars that keep working: `NO_COLOR` (now consistent everywhere), `ZCODE_KIT_VERBOSE`, `ZCODE_KIT_HARNESSES`, `ZCODE_KIT_ACCOUNT_ROTATOR`. New ones are additive (§2).

## 12 · Open decisions (for the Owner Proxy)

| # | Question | Recommendation |
|---|---|---|
| D0 | Which visual variant | **A (Ledger) as base, plus C's help shape and C's problem-first verdict lead in `doctor`, plus C's sidebar for the TUI at ≥100 columns**; B's boxed cards only for the TUI header. Reason: smallest change from today (C9), copyable connection card, grep-stable checks, best in pipes and on conhost |
| D1 | Store the Account Rotator answer and stop re-asking it on every setup/update | yes, `--reask` asks again (two-way door) |
| D2 | Move errors, warnings, progress and prompts to stderr | yes, phased per §10; announced |
| D3 | Add `WARN` to the doctor check grammar | yes; additive, announced |
| D4 | `auth status` prints human text by default, JSON with `--json` | yes, but announced one release ahead with a deprecation note on stderr, because existing scripts parse its stdout. Otherwise keep JSON and add `auth status --text` |
| D5 | Single-source width core as `width-core.mjs` + `.d.mts` inside `zcode-proxy-src/src/tui/` | yes (C4; repo precedent `captcha-compatibility.mjs`) |
| D6 | Make compact setup output the default (full diagnostics in `--verbose` and the log) | yes |
