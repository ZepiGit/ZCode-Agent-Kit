# Terminal output conventions for the kit's CLI and TUI (research, 2026-11-06)

## Answer

1. **Color.** Decide color separately for each stream, once, in the kit's own code. Order: CLI flag > `NO_COLOR` (non-empty) > `FORCE_COLOR` (`0`/`false` = off, `1`/`2`/`3` = 16/256/truecolor) > `CLICOLOR_FORCE` (non-empty, not `0`) > not a TTY = off > `TERM=dumb` = off > `CLICOLOR=0` = off > `stream.getColorDepth()`. Do not lean on `util.styleText` alone. In Node 24 and 26, `FORCE_COLOR` silently overrides `NO_COLOR` (it only warns). Node also treats an empty `FORCE_COLOR` as "force 16 colours".
2. **Windows.** Node (libuv) turns on VT processing by itself on Windows 10+ consoles, and on a TTY it writes UTF-16 through WriteConsoleW, so the code page does not matter there. It does matter when output is piped or captured: PowerShell 5.1 then uses `$OutputEncoding` = ASCII and the console's OEM code page. Rendering is the real risk. Windows 10 conhost has no font fallback, and Consolas and Lucida Console only cover WGL4. The TUI frame's `╭╮╰╯ ▸ ✗` therefore show as boxes there, while `─│┌┐└┘ ● ○ ▼ ↑↓ • …` are safe.
3. **Glyph tiers.** Use three tiers: `full` / `wgl4` / `ascii`.
   - `ascii`: `TERM=dumb`, a non-UTF-8 POSIX locale, or any non-TTY decoration.
   - `wgl4`: the default on win32 unless there is positive evidence of a modern renderer (`WT_SESSION`, `TERM_PROGRAM`, or Windows build ≥ 22621).
   - `full`: everywhere else.
   - Always allow a user override.

   npm already defaults `unicode=false` on Windows, and cargo has `term.unicode`.
4. **Width.** `zcode-proxy-src/src/tui/width.ts` measures one code point at a time using an old range table. It counts many current wide emoji (✅ ⚡ 🟢 🪄) as 1 cell, `TAB` as 0, `❤️` as 1, and `🧑‍🌾`/`👍🏽` as 4. Truncation can also cut a ZWJ sequence or flag in half. Fix it in four steps:
   - measure per grapheme with `Intl.Segmenter`;
   - generate the W/F table from UCD 17;
   - widen VS16 and regional-indicator pairs to 2 and cap every cluster at 2;
   - keep emoji and Ambiguous glyphs out of anything that must line up.
5. **Hyperlinks and output streams.** Emit OSC 8 hyperlinks only to a TTY on an allowlisted terminal: WT ≥1.4, iTerm2 ≥3.1, VTE ≥0.50, kitty, WezTerm, Alacritty ≥0.11, Ghostty, VS Code ≥1.72. Never emit them to Terminal.app or conhost, and inside tmux only when its `hyperlinks` feature is on. Always print the URL as visible text too. Follow clig.dev:
   - data goes to stdout and messages to stderr;
   - animate only when the stream is a TTY and neither `CI` nor `TERM=dumb` is set;
   - `--json` output is stable and contains no ANSI codes;
   - exit codes are meaningful.

---

## Details

### 1. Colour environment variables and their precedence

**What the specs say (primary sources):**

| Variable | Rule | Empty string | Source |
|---|---|---|---|
| `NO_COLOR` | "when present and not an empty string (regardless of its value), prevents the addition of ANSI color". User config files and per-instance CLI flags may override it (FAQ). | = unset | https://no-color.org/ (last updated 2026-09-29) |
| `FORCE_COLOR` | "when this variable is present and not an empty string (regardless of its value), it should force the addition of ANSI color". The reference C code checks `NO_COLOR` first, then lets `FORCE_COLOR` set `color = true`, so FORCE wins. | = unset | https://force-color.org/ (last updated 2026-09-10) |
| `CLICOLOR` / `CLICOLOR_FORCE` | `NO_COLOR` set → no colour. `CLICOLOR_FORCE` set (and `NO_COLOR` unset) → always colour. `CLICOLOR` → colour only on a terminal. The standard is now marked **deprecated**: "treat `FORCE_COLOR` as an alias for `CLICOLOR_FORCE`, enabling color whenever either is set, unless `NO_COLOR` is also set." It also maps `--color[=always]`, `--color=never` and `--color=auto` to these. | = unset | https://bixense.com/clicolors/ (fetched 2026-11-06; no date on page) |

The specs conflict when both `NO_COLOR` and `FORCE_COLOR` are set. force-color.org lets FORCE win. bixense lets NO_COLOR win. clig.dev lists both without ranking them (https://clig.dev/, "Environment variables"). The kit should pick one rule and document it. **Recommendation: `NO_COLOR` wins.** A wrongly plain line costs nothing, while wrongly emitted escape codes corrupt logs. This also matches the bixense alias rule.

**What Node actually does.** Source: `lib/internal/tty.js` on the `v26.x` and `v24.x` branches (identical logic), https://raw.githubusercontent.com/nodejs/node/v26.x/lib/internal/tty.js (fetched 2026-11-06):

- `FORCE_COLOR` is checked **first**:
  - `''`, `'1'` and `'true'` give 16 colours (depth 4);
  - `'2'` gives 256;
  - `'3'` gives truecolor (24);
  - any other value (`'0'`, `'false'`) gives 2 colours (off).
  - When it forces colour on, Node emits the warning `The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.` In other words, **in Node, `FORCE_COLOR` beats `NO_COLOR`**, and an empty `FORCE_COLOR` forces colour, which contradicts force-color.org's empty-string rule.
- Next, a non-empty `NODE_DISABLE_COLORS` or `NO_COLOR`, or `TERM === 'dumb'`, gives 2 colours.
- On win32: Windows 10 build ≥ 14931 gives truecolor, build ≥ 10586 gives 256, anything else gives 16. **Neither `TERM` nor `isTTY` is consulted at this point.**
- After that, in order:
  - `TMUX` → truecolor;
  - Azure DevOps (`TF_BUILD` + `AGENT_NAME`) → 16;
  - `CI` → `GITHUB_ACTIONS`/`GITEA_ACTIONS`/`CIRCLECI` 24, `GITLAB_CI`/`TRAVIS`/`APPVEYOR`/`BUILDKITE`/`DRONE` 256, any other CI 2;
  - `TERM_PROGRAM`: `iTerm.app` ≥3 → 24, `Apple_Terminal` → 256;
  - `COLORTERM=truecolor|24bit` → 24;
  - `TERM` patterns → 256 or 16;
  - otherwise 2.
- `util.styleText(format, text, {stream, validateStream})` became TTY- and env-aware in v22.8.0 / v20.18.0 and stable in v23.5.0 / v22.13.0. v24.2.0 added the `'none'` format and v26.1.0 added hex colours. Defaults: `validateStream: true`, `stream: process.stdout`. Source: https://nodejs.org/api/util.html (v26.13.0 docs, fetched 2026-11-06).
- `shouldColorize(stream)` is in `lib/internal/util/colors.js`, https://raw.githubusercontent.com/nodejs/node/v26.x/lib/internal/util/colors.js. If `FORCE_COLOR !== undefined` it returns `getColorDepth() > 2` **without checking `isTTY`**. Otherwise it returns `stream.isTTY && stream.getColorDepth() > 2`.

**Consequences for the kit:**

- (a) `styleText` without `{stream: process.stderr}` checks stdout even when the text goes to stderr.
- (b) `NO_COLOR=1 FORCE_COLOR=1` gives colour plus a runtime warning.
- (c) `FORCE_COLOR=` (empty) forces colour.

So compute the decision once, then call `styleText(..., {validateStream: false})` or emit SGR directly. `tty.WriteStream.getColorDepth()` and `hasColors()` are still the right tools for *depth*. Docs: https://nodejs.org/api/tty.html.

**What the kit does today:**

| Location | Logic | Gaps |
|---|---|---|
| `cli/setup-output.mjs:6` | `compact && process.stdout.isTTY && !process.env.NO_COLOR` | No `FORCE_COLOR`/`CLICOLOR*`/`TERM=dumb` handling. Warnings and results go to **stdout** via `console.log` (lines 19, 24, 29). |
| `install.sh:12` | `[ -t 1 ] && [ -z "${NO_COLOR:-}" ]` | Correct `NO_COLOR` semantics (empty = unset). No `TERM=dumb`. `die()` correctly writes to stderr (line 19). |
| `install.ps1:36` | `-not $env:NO_COLOR -and -not [Console]::IsOutputRedirected` | Uses `Write-Host -ForegroundColor`, which goes through the console API and needs no VT, so it is fine on legacy conhost. |
| `zcode-proxy-src/src/runtime/paste-login.ts:14` | bold if `stdout.isTTY` | Ignores `TERM=dumb`. |
| `zcode-proxy-src/src/tui/frame.ts:83-92` | `paint()` always emits SGR. `BTN_*` use truecolor `38;2`/`48;2` unconditionally. | No `NO_COLOR` and no depth downgrade (Node reports 256 colours for `Apple_Terminal`). The TTY gate is at `app.ts:43`. |

### 2. Windows: VT, code pages, PowerShell, fonts

**Is VT processing on automatically?**

- **Node: yes.** `uv_tty_init()` calls `uv__determine_vterm_state()`, which tries to set `ENABLE_VIRTUAL_TERMINAL_PROCESSING`. If that works, libuv converts UTF-8 to UTF-16 and passes the text straight to `WriteConsoleW`. Otherwise libuv **emulates** a subset of ANSI and silently drops sequences it does not know.
  - Source: libuv issue #2389 (2019-07-25), https://github.com/libuv/libuv/issues/2389.
  - libuv's own doc: "Windows10 consoles are usually detected automatically" (`uv_tty_set_vterm_state`, added in 1.33.0), https://docs.libuv.org/en/v1.x/tty.html.
  - Consequence: on the legacy console path, OSC 8 and other OSC sequences are swallowed rather than printed. That last part is a 2014 secondary source (https://stackoverflow.com/questions/27575929), so treat it as plausible but old.
- **Bun:** also libuv-based on Windows.
  - PR #21161 "node:tty: use terminal VT mode on Windows" (merged 2025-09-26) switched `setRawMode(true)` to libuv's `UV_TTY_MODE_RAW_VT`: https://github.com/oven-sh/bun/pull/21161.
  - Bun v1.3.4 fixed "Windows console codepage not being properly saved and restored" (https://bun.sh/blog/bun-v1.3.4.md), which implies Bun changes the console code page while it runs.
  - **UNVERIFIED:** whether Bun's own stdout writer goes through WriteConsoleW or byte writes plus CP 65001.
- **Windows Terminal maintainer guidance** (DHowett, 2020-07-06, https://github.com/Textualize/rich/issues/140): "WT_SESSION is not an API… It's safer to use feature detection for the console. If you can enable ENABLE_VIRTUAL_TERMINAL_PROCESSING, VT is supported… if you're beyond 10.0.15063 24-bit color is supported." He later threatened to remove `WT_SESSION` because people used it for detection (https://github.com/microsoft/terminal/issues/9068, 2021-02-08). It is still set as of 2026, per terminfo.dev and Codex issue #30004 (2026-06-25).
  - Practical limits (https://github.com/microsoft/terminal/issues/8681, 2021):
    - `WT_SESSION` is not set over SSH;
    - it is inherited by a conhost window started from WT;
    - WT refuses to set `TERM_PROGRAM`.
  - **Use `WT_SESSION` only as a positive hint for the glyph tier, never to decide VT.**

**Code pages and PowerShell:**

- Each console has an input and an output code page. Microsoft recommends that new apps "avoid code pages and use Unicode", either UTF-16 to the W APIs or UTF-8 to the A APIs "after ensuring the code page is first set to 65001". Source: https://learn.microsoft.com/en-us/windows/console/console-code-pages (updated 2021-02-12).
- Windows PowerShell 5.1: `$OutputEncoding` defaults to **`ASCIIEncoding`**. It governs what PowerShell pipes *into* native programs, and Microsoft notes it should usually match `[Console]::InputEncoding`. Source: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables?view=powershell-5.1 (fetched 2026-11-06).
- PowerShell 7.x defaults `$OutputEncoding` to `UTF8Encoding` and defaults all output to `utf8NoBOM`. 5.1 cmdlets are inconsistent: `>` and `Out-File` write UTF-16LE, `Set-Content` writes ANSI. Sources: same page (7.6 view, dated 2026-06-29) and https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding.
- When PowerShell *captures* a native program's stdout (`$x = node cli.mjs`, `| Select-String`), it decodes the bytes with `[Console]::OutputEncoding`. On a stock US or Western-European system that is the OEM code page (437 or 850), so UTF-8 glyphs turn into mojibake. **UNVERIFIED in this session:** the exact default value. It follows from the console output code page described above.
  - The kit already applies the correct mitigation for a child process whose output it captures: `lib/process.mjs:93` prepends `[Console]::OutputEncoding=[Text.Encoding]::UTF8;`.
  - The `.ps1` installers are deliberately ASCII-only (`install.ps1:28-29`).
- PowerShell 7.2+ `$PSStyle.OutputRendering` defaults to `Host`, which strips ANSI from redirected output. `TERM=dumb` sets `$Host.UI.SupportsVirtualTerminal = $false`, and `NO_COLOR` sets `PlainText`. Source: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_ansi_terminals (2026-07-02).
- This applies to PowerShell's own formatting only; "Output from native executables isn't affected".

**Fonts and glyph coverage:**

- conhost renders through GDI and **does not do font fallback**. A glyph missing from the selected font shows as a box. Sources:
  - https://devblogs.microsoft.com/commandline/windows-command-line-unicode-and-utf-8-output-text-buffer (2018-11-16)
  - https://github.com/microsoft/terminal/issues/219 (2018-07-10), where `╭╰` and `✔` show as boxes.
- The fix (PR #10478) ships **only on Windows 11 22H2 and later**. "conhost does NOT support font fallback (on Windows 10)… Consolas does NOT contain braille glyphs." Source: DHowett/lhecker in https://github.com/microsoft/terminal/issues/18024 and /18042 (2024-10).
- Win 11 22H2 corresponds to build 22621. That mapping is general knowledge and was not re-fetched.
- The conhost text buffer is UCS-2: one `WCHAR` per cell. Non-BMP characters (all emoji in U+1F000 and above) are unreliable there. Source: https://github.com/microsoft/terminal/discussions/13806.
- Lucida Console is "Lucida Sans Typewriter + the WGL4 character set" (https://en.wikipedia.org/wiki/Lucida_Console). Consolas also targets WGL4.
- The WGL4 list for U+2013–U+FB02 (https://learn.microsoft.com/en-us/typography/opentype/otspec140/wgl4e) **contains**:
  - `– — • … ← ↑ → ↓ ↔ ↕ √ ∞ ≠ ≤ ≥ ─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬ ▀ ▄ █ ▌ ▐ ░ ▒ ▓ ■ □ ▪ ▫ ▬ ▲ ► ▼ ◄ ◊ ○ ● ◘ ◙ ◦`
  - and all of Latin-1, including `·` and `×`.
- It does **not** contain:
  - `╭ ╮ ╯ ╰` (U+256D–2570), `▸` (U+25B8), `✓ ✔ ✗ ✘` (U+2713–2718) and braille (U+2800–28FF);
  - anything in the emoji planes.
  - Spinners such as `⠋⠙⠹` (braille) are therefore unsafe.

**What the TUI frame breaks on Windows 10 conhost:**

- `frame.ts:117,134-135,140` use `╭ ╮ ╰ ╯`;
- `frame.ts:300,367` use `▸`;
- `frame.ts:315` uses `✗`.

These render as boxes there. `─ │ ● ○ ▼ ↑↓ · …` (`frame.ts:186,237-240,311-316,346,377`) are WGL4 and safe. The TUI only runs on a TTY, but it does run in conhost whenever the user launches it from a legacy console window.

**Detection and safe fallback (recommended):**

| Signal | Use |
|---|---|
| `TERM=dumb` | `ascii` tier, no colour, no cursor movement |
| POSIX, `LC_ALL` → `LC_CTYPE` → `LANG` not containing `UTF-8`/`utf8` | `ascii` tier (npm uses the same locale rule for its `unicode` default: https://docs.npmjs.com/cli/v11/using-npm/config) |
| win32 and no positive hint | `wgl4` tier (npm defaults `unicode=false` on Windows) |
| win32 with `WT_SESSION` set, or `TERM_PROGRAM` set (VS Code, etc.), or `os.release()` build ≥ 22621 | `full` tier |
| stream not a TTY | `ascii` decorations (`[OK]`, `[WARN]`); data stays UTF-8 |
| user override (e.g. `ZCODE_KIT_UNICODE=0|1`, mirroring cargo `term.unicode` / `CARGO_TERM_UNICODE`) | wins |

Do not shell out to `chcp` and do not change the console code page. Node's TTY path does not need it, and changing it is global state that Bun had to fix (v1.3.4).

### 3. Unicode width

**Normative sources:**

- **UAX #11 rev 44** (Unicode 17.0.0, 2025-07-24, https://www.unicode.org/reports/tr11/):
  - W and F characters are wide.
  - "Ambiguous characters… If the context cannot be established reliably, they should be treated as narrow characters by default."
  - Variation sequences in `emoji-variation-sequences.txt` "may specify a narrow or wide presentation behaviour" that differs from the base character's `East_Asian_Width`. In practice VS16 (U+FE0F) makes the cluster wide.
  - Unassigned code points in CJK blocks and planes 2/3 are W.
- **Mode 2027** (Contour's grapheme-clustering proposal, https://github.com/contour-terminal/terminal-unicode-core) lets a terminal advance the cursor by grapheme cluster instead of summing per-code-point `wcwidth`.
  - Ghostty's documented cluster rule (https://libghostty.tip.ghostty.org/group__unicode.html):
    - start at the first code point's width;
    - VS16 after a valid emoji-VS base → 2, VS15 → 1;
    - any other width-contributing continuation → 2;
    - so a cluster is at most 2.

**How terminals disagree.** Examples:

| Sequence | Terminals | Width |
|---|---|---|
| `🧑‍🌾` | Ghostty, Contour, foot, kitty (grapheme-aware) | 2 |
| `🧑‍🌾` | wcwidth-sum terminals | 4 or more |
| `👨‍👩‍👧` | wcwidth sum | 6 |
| `👨‍👩‍👧` | grapheme-aware | 2 |
| `🇩🇪` | wcwidth sum | 4 |
| `🇩🇪` | grapheme-aware | 2 |

Sources:
- Mitchell Hashimoto, 2023-10-02: https://mitchellh.com/writing/grapheme-clusters-in-terminals
- JLine issue #1753, 2026-03-31: https://github.com/jline/jline3/issues/1753

Mode 2027 support per JLine's table (https://jline.org/docs/advanced/grapheme-cluster-mode, undated):

| Support | Terminals |
|---|---|
| Yes | Contour, foot, WezTerm, Ghostty |
| No | iTerm2, Terminal.app, GNOME Terminal, **Windows Terminal**, Konsole, xterm |

Windows Terminal 1.22 added grapheme-cluster support with a `wcswidth` compatibility option (https://devblogs.microsoft.com/commandline/windows-terminal-preview-1-22-release, 2024-08-27). That is not the same thing as mode 2027.

Even among mode-2027 terminals, Jeff Quast's ucs-detect measurements (2026-06-07, https://www.jeffquast.com/post/perfecting-terminal-character-width-using-correction-tables) found:
- foot and Windows Terminal give standalone regional indicators and Fitzpatrick modifiers width 1;
- Contour and WezTerm miss VS16 on keycap bases;
- 14 Cf format characters are disputed (width 0 or 1).

**Conclusion: no single width function is correct everywhere. The kit should avoid emitting ambiguous content in aligned layouts, rather than try to measure it perfectly.**

**What `zcode-proxy-src/src/tui/width.ts` implements:**

| Line(s) | What it does | Gap |
|---|---|---|
| 13 | `ANSI_RE` strips CSI, OSC (BEL- or ST-terminated, so OSC 8 too) and 2-byte ESC sequences | Fine. Note that `truncateToWidth` (66-70) strips hyperlinks along with colour. |
| 16-23 | Hand-written wide ranges: Hangul Jamo, CJK, Hangul, fullwidth forms, `1F300–1F64F`, `1F680–1F6FF`, `1F900–1F9FF`, planes 2/3 | Missing W code points from UCD 17. **BMP emoji with EAW=W:** `⌚⌛ ⏩–⏬ ◽◾ ☔☕ ♈–♓ ♿ ⚓ ⚡ ⚪⚫ ⚽⚾ ⛄⛅ ⛎ ⛔ ⛪ ⛲⛳ ⛵ ⛺ ⛽ ✅ ✊✋ ✨ ❌ ❎ ❓–❕ ❗ ➕–➗ ➰ ➿ ⬛⬜ ⭐ ⭕`. **Supplementary emoji:** `🀄 🃏 🆎 🆑–🆚 🈁…`, `1F7E0–1F7EB` (🟢), `1FA70–1FAFF` (🪄 🫠). **Ideographic/Kana:** Tangut/Kana Supplement `16FE0–18AFF`, `1B000–1B2FF`. All of these measure as 1 instead of 2. |
| 26-28 | Zero width only for `0300–036F`, `200B–200F`, `20D0–20FF`, `FE00–FE0F` | Misses: combining marks in other scripts (Hebrew, Arabic, Devanagari…), `1AB0–1AFF`, `1DC0–1DFF`, `FE20–FE2F`, `2060–2064`, `FEFF`, VS supplement `E0100–E01EF`, tag characters `E0020–E007F` (subdivision flags), and Hangul medial/final Jamo `1160–11FF`. |
| 45 | Every C0/C1 control → 0 | **`TAB` counts as 0 cells** but advances to the next tab stop (up to 8 cells). Upstream error bodies that contain tabs misalign the log pane. |
| 46-47 | VS16 → 0, base width kept | `❤️` (U+2764 EAW=N + FE0F) measures 1; grapheme-aware terminals draw it at 2. |
| 59, 77 | `for (const ch of …)` iterates code points, not graphemes | `👍🏽` measures 4 (1F44D + 1F3FD both in `1F300–1F64F`), `🧑‍🌾` 4, `👨‍👩‍👧` 6, against 2 in grapheme-aware terminals. `truncateToWidth` can cut between a base and its ZWJ, skin tone or second regional indicator, leaving a dangling joiner or half a flag. |
| (all) | Ambiguous (EAW=A) → 1 | Correct UAX #11 default. The frame's `─ │ ╭ ● ○ ▼ ↑ ↓ … ·` are Ambiguous per EastAsianWidth.txt (**not re-fetched**; recalled from UCD). In terminals set to "ambiguous = wide" they would break the box, and VTE's and iTerm2's options for this are **UNVERIFIED** in this session. |

Tests at `width.test.ts:31-44` cover CJK, fullwidth, `🚀`, and a combining acute only. There are no ZWJ, VS16, flag or tab cases.

**Recommended fix:**

1. Iterate `new Intl.Segmenter(undefined, {granularity: "grapheme"})`. It is available in Node ≥16 and in Bun; **UNVERIFIED** for Bun's segmentation data version.
2. Give each cluster a width:
   - 0 if every code point is zero-width or a control (expand `\t` before measuring);
   - 2 if any code point is W/F per a table **generated from UCD 17 `EastAsianWidth.txt`** (not hand-written);
   - 2 if a VS16 follows an emoji base, or the cluster is a regional-indicator pair;
   - otherwise 1;
   - never more than 2.
3. Truncate only at cluster boundaries.

This matches mode-2027 and WT 1.22 behaviour. Under wcwidth-sum terminals ZWJ emoji will still drift, which is why the kit's own chrome must not use emoji at all (rule R12).

### 4. OSC 8 hyperlinks

**Spec:** `ESC ] 8 ; params ; URI ST text ESC ] 8 ; ; ST`. Use `ST = ESC \`; BEL is a tolerated non-standard alternative. The URI is limited to bytes 32–126 (percent-encode the rest), and in practice to about 2083 bytes (VTE and iTerm2). Two points from the spec:
- "Currently there's no way of detecting whether the terminal emulator supports hyperlinks."
- A link "should not be the only means of figuring out the target."

A correct ECMA-48 parser ignores unknown OSCs. Known-buggy terminals: VTE ≤0.46.2 and 0.48.1, Windows Terminal ≤0.9, Emacs term, and screen with URLs over 700 characters. Source: https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda.

**Support matrix.** Primary list: https://github.com/Alhadis/OSC8-Adoption (fetched 2026-11-06), plus vendor changelogs.

| Terminal | OSC 8 | Since | Env signal to detect it |
|---|---|---|---|
| Windows Terminal | yes | v1.4.3141.0 (2020-11-12) | `WT_SESSION` (hint only, see §2) |
| conhost (Win10/11 inbox console) | **not listed** | – | none; treat as unsupported. Behaviour on unknown OSC: ignored when VT is on (ECMA-48); stripped by libuv emulation on the legacy path. Rendering behaviour **UNVERIFIED**. |
| iTerm2 | yes | 3.1 | `TERM_PROGRAM=iTerm.app` (confirmed in Node's tty.js) |
| Terminal.app (macOS) | **not listed** | – | `TERM_PROGRAM=Apple_Terminal`; treat as unsupported. Status on macOS 26 **UNVERIFIED**. |
| GNOME Terminal / VTE | yes | VTE 0.50 (GNOME Terminal 3.26); use ≥0.50.4/0.52.2 to avoid a crash | `VTE_VERSION` ≥ 5000 (**UNVERIFIED** variable format) |
| kitty | yes | 0.19 | `TERM=xterm-kitty` (confirmed in Node's tty.js) |
| WezTerm | yes | early 2018 | `TERM_PROGRAM=WezTerm` (**UNVERIFIED**) |
| Alacritty | yes | v0.11 (2022-10-13) | `TERM=alacritty` (**UNVERIFIED**) |
| Ghostty | yes | 2024-07 (#1928) | `TERM_PROGRAM=ghostty` (**UNVERIFIED**) |
| VS Code terminal (xterm.js 5) | yes | VS Code 1.72 (2022-09) | `TERM_PROGRAM=vscode` (**UNVERIFIED**) |
| Konsole | yes, **off by default** | 2020-07 | – |
| tmux | passes through only with `set -as terminal-features '*:hyperlinks'` (or the outer terminal's terminfo `Hls`) | 3.4 ("Add support for OSC 8 hyperlinks", tmux 3.4 CHANGES) | `TMUX` set → off unless the user opts in |
| GNU screen | no (pending) | – | `STY`/`TERM=screen*` → off |
| GitHub Actions log viewer | does not render OSC 8; it auto-links bare URLs ("URLs are now interactive") | 2020-09-23 | `GITHUB_ACTIONS` → print plain URLs |

Sources:
- tmux: https://raw.githubusercontent.com/tmux/tmux/3.4/CHANGES and https://www.man7.org/linux/man-pages/man1/tmux.1.html (`hyperlinks` feature)
- GitHub Actions: https://github.blog/changelog/2020-09-23-github-actions-log-improvements/

**Safe policy:** emit OSC 8 only if all of the following hold:
- the stream is a TTY;
- escapes are allowed (colour decision on, `TERM` ≠ dumb);
- the terminal matches the allowlist above;
- not inside tmux or screen unless the user overrides.

Always print the visible text **as the URL itself**, or follow it with the URL. cargo exposes the same switch as `term.hyperlinks` / `CARGO_TERM_HYPERLINKS` (auto-detect), and gh exposes a `hyperlink` template helper. Sources: https://doc.rust-lang.org/cargo/reference/config.html, https://cli.github.com/manual/gh_help_formatting.

### 5. CLI output conventions

**clig.dev** (https://clig.dev/, fetched 2026-11-01):

- **Basics:**
  - exit 0 on success and non-zero on failure, mapping codes to the important failure modes;
  - "primary output… and anything machine readable" goes to stdout;
  - "Log messages, errors, and so on" go to stderr.
- **Colour:** disable it when the stream is not a TTY ("check individually"), when `NO_COLOR` is non-empty, when `TERM=dumb`, or with `--no-color`. A `MYAPP_NO_COLOR` variable is optional. `FORCE_COLOR` "to enable it and ignore the detection logic".
- **Animation:** "If `stdout` is not an interactive terminal, don't display any animations… stop progress bars turning into Christmas trees in CI log output." When a run fails, print the logs that a progress bar was hiding.
- **Output:** human-first output on a TTY. Provide `--plain` when human formatting breaks line-per-record output, and `--json` for structured output. Keep success output brief. `-q` suppresses non-essential output. Don't treat stderr as a log file: no `ERR`/`WARN` level labels unless in verbose mode. Use symbols and emoji only where they clarify. Page long output (`less -FIRX`) only on a TTY.
- **Help:**
  - concise help when required arguments are missing, with a description, one or two examples, flags, and "pass `--help`";
  - full help on `-h`/`--help`/`help <sub>`;
  - `-h` must work appended to anything;
  - a support link;
  - bold headings, but no escape codes when piped.
- **Interactivity:** prompt only if stdin is a TTY, provide `--no-input`, and never echo passwords.
- **Future-proofing:** "Changing output for humans is usually OK"; scripts should use `--plain`/`--json`, which must therefore stay stable.

**gh (GitHub CLI):**
- `NO_COLOR` = any value disables colour.
- `CLICOLOR=0` disables colour.
- `CLICOLOR_FORCE` ≠ `0` keeps colour when piped.
- `GH_COLOR_LABELS` enables truecolor labels.
- `GH_ACCESSIBLE_COLORS` (preview) switches to customizable 4-bit colours.

Source: https://cli.github.com/manual/gh_help_environment (fetched 2026-11-05).

Output and exit codes:
- Default output is "line-based plain text". `--json fields` with `--jq`/`--template` gives structured output, and the template helpers include `autocolor` ("only emits color to terminals"), `tablerow` and `hyperlink`. Source: https://cli.github.com/manual/gh_help_formatting.
- Exit codes: 0 ok, 1 failure, 2 cancelled, 4 auth required. Source: https://cli.github.com/manual/gh_help_exit-codes.
- The `NO_COLOR` list dates gh's support to 0.7.0 (2020-04-22).

**npm** (https://docs.npmjs.com/cli/v11/using-npm/config, fetched 2026-11-05):
- `color`: default true "unless the NO_COLOR environ is set to something other than '0'". `"always"` forces it, true means "only… for tty file descriptors".
- `progress`: default true only "when not in CI and both stderr and stdout are TTYs and not in a dumb terminal".
- `unicode`: "false on windows, true on mac/unix systems with a unicode locale, as defined by the LC_ALL, LC_CTYPE, or LANG environment variables". When false npm uses ASCII instead of Unicode glyphs.

**cargo** (https://doc.rust-lang.org/cargo/reference/config.html, fetched 2026-10-20):
- `term.color` = `auto|always|never` (`CARGO_TERM_COLOR`, `--color`)
- `term.hyperlinks` (auto-detect)
- `term.unicode` (auto-detect: "whether… non-ASCII unicode characters")
- `term.progress.when` = `auto|always|never`
- `term.progress.width`
- `term.progress.term-integration` (taskbar progress)

That gives one tri-state per capability, each with an env var and a flag.

**CI (GitHub Actions):**
- The log viewer renders "ANSI colors, 8-bit colors, 24-bit colors" and makes URLs clickable (GitHub blog, 2020-09-23: https://github.blog/news-insights/product-news/a-better-logs-experience-with-github-actions).
- The steps are **not a TTY**. A GitHub engineer wrote in 2019, "We set $TERM=dumb so that tools ran here dont try to do anything fancy" (https://github.com/actions/runner/issues/241). Whether `TERM=dumb` is still set on current hosted runners is **UNVERIFIED**.
- Node gives `GITHUB_ACTIONS`+`CI` truecolor *depth*, but only when `TERM` ≠ dumb. `styleText` still refuses colour on non-TTY streams unless `FORCE_COLOR` is set. So in Actions the kit is plain by default, and users opt in with `FORCE_COLOR`.
- SGR state resets at every line in the Actions viewer, per the `@actions/core` README (mirror: https://www.npmjs.com/package/@unlike/github-actions-core; the original toolkit README was not fetched). So close SGR on each line.

**80 columns:**
- `process.stdout.columns` is undefined when the stream is not a TTY. The TUI already falls back to 80 (`app.ts:183`). Use 80 as the design width for help and line output.
- Never hard-wrap data lines meant for pipes.
- `util.inspect`'s own default `breakLength` is 80 (util docs). That only confirms the convention.

---

## Rule list (MUST / SHOULD) for the kit's design language

Adopt verbatim. "Stream" means the stream the text is written to.

**Capability detection**

- **R1 (MUST)** Compute one capability record per output stream at startup:
  - `{ color: 0|16|256|16m, glyphs: "full"|"wgl4"|"ascii", hyperlinks: bool, animate: bool, columns: number }`
  - Every renderer reads this record. No renderer checks `isTTY` or env vars on its own.
- **R2 (MUST)** Colour precedence. The first rule that applies wins, and an empty env var counts as unset.
  1. `--no-color` / `--color=never` → off; `--color=always` → on.
  2. `NO_COLOR` → off.
  3. `FORCE_COLOR`: `0`/`false` → off; `2` → 256; `3` → 16m; any other value → 16.
  4. `CLICOLOR_FORCE` ≠ `0` → detected depth (minimum 16).
  5. Stream not a TTY → off.
  6. `TERM=dumb` → off.
  7. `CLICOLOR=0` → off.
  8. Otherwise → `stream.getColorDepth()`.
- **R3 (MUST NOT)** Use `util.styleText` with its default stream validation. After R2 decides, call it with `{ validateStream: false }`, or write SGR directly. (Node lets `FORCE_COLOR` override `NO_COLOR`, and validates stdout by default.)
- **R4 (MUST)** Glyph tier, first match wins:
  1. User override (`ZCODE_KIT_UNICODE=0|1`).
  2. `ascii` if `TERM=dumb`, if the stream is not a TTY (decorations only), or on POSIX if the locale (`LC_ALL` → `LC_CTYPE` → `LANG`) is not UTF-8.
  3. `wgl4` on win32 unless `WT_SESSION` or `TERM_PROGRAM` is set or the Windows build is ≥ 22621.
  4. `full` otherwise.
- **R5 (MUST)** Use hyperlinks (OSC 8) only when:
  - the stream is a TTY;
  - colour/escapes are allowed and `TERM` ≠ dumb;
  - `TMUX`/`STY` are not set (unless the user overrides);
  - the terminal is on the allowlist in §4.

  Hyperlink text MUST be the URL itself, or be followed by the URL. Close every link with `ESC]8;;ESC\`.
- **R6 (MUST)** Animate (spinners, progress bars, `\r` rewrites, cursor movement) only when the stream is a TTY, `TERM` ≠ dumb, and `CI` is unset. Otherwise print one line per state change. On failure, print the logs that the animation was hiding.

**Streams, formats and exit codes**

- **R7 (MUST)** Primary results and all machine-readable output go to stdout. Progress, status, warnings, errors and prompts go to stderr.
- **R8 (MUST)** `--json`:
  - exactly one UTF-8 JSON document on stdout;
  - no ANSI codes and no tier-dependent glyphs;
  - keys only ever added, never renamed or removed, within a major version;
  - exit codes unchanged.
- **R9 (MUST)** Exit codes: `0` success, `1` failure, `2` usage error (unknown command or flag, missing argument). Any further code is documented in `--help`.
- **R10 (MUST)** Prompt only when stdin and stderr are both TTYs and neither `--yes` nor `--no-input` is given. Otherwise fail, naming the flag that supplies the answer.

**Colour and glyph use**

- **R11 (MUST)** Never carry meaning by colour alone. Every coloured status also has a text tag: `[OK]`, `[WARN]`, `[FAIL]`, `[SKIP]`.
- **R12 (MUST)** The kit's own chrome (borders, status markers, spinners, column separators) uses only:
  - **wgl4 tier:** `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ═ ║ ╔ ╗ ╚ ╝ ● ○ ■ □ ▪ ▲ ▼ ► ◄ ← ↑ → ↓ • · … ░ ▒ ▓ █`
  - **ascii tier:** `- | + * o > < ^ v . ...`
  - **full tier additions:** `╭ ╮ ╰ ╯ ▸ ✓ ✗`
  - Emoji, braille spinners, and characters with emoji or VS16 presentation MUST NOT appear in kit chrome at any tier.
- **R13 (MUST)** Downgrade palettes to the detected depth:
  - truecolor (`38;2`/`48;2`) only at 16m;
  - 256-colour (`38;5`) only at 256 or above;
  - otherwise the 16 basic SGR colours.
- **R14 (MUST)** Close SGR on the same line (`ESC[0m` before `\n`). A full-screen TUI MUST restore every mode it changes (alt screen, cursor, mouse, raw mode) on normal exit, on error, and on SIGINT/SIGTERM.
- **R15 (SHOULD)** When colour is off in line mode, emit no escape sequences at all. In the full-screen TUI, `NO_COLOR` removes colours, but bold/dim/reverse MAY stay to show state (no-color.org FAQ).

**Width and layout**

- **R16 (MUST)** Measure display width per grapheme cluster:
  - segment with `Intl.Segmenter`;
  - W/F from a generated UCD `EastAsianWidth.txt` table → 2;
  - Ambiguous → 1;
  - VS16 after an emoji base, or a regional-indicator pair → 2;
  - controls and zero-width marks → 0;
  - cap every cluster at 2;
  - expand `\t` before measuring.

  Truncate only at cluster boundaries.
- **R17 (MUST)** Design all line output and help text for 80 columns. Wrap help to `min(columns, 100)` on a TTY and to 80 otherwise. Never hard-wrap or truncate data written to a non-TTY. A full-screen TUI below its minimum size shows a one-line "terminal too small" notice instead of a broken frame.
- **R18 (MUST)** On `TERM=dumb`, or with a non-TTY stdin or stdout, the full-screen TUI refuses to start and points to the line-mode command (as `app.ts:43` does today).

**Windows**

- **R19 (MUST)** On Windows:
  - write text only through `process.stdout`/`process.stderr`, and let libuv handle VT and UTF-16;
  - never run `chcp` and never change the console code page;
  - prefix a captured PowerShell child with `[Console]::OutputEncoding=[Text.Encoding]::UTF8;`;
  - keep `.ps1` files ASCII-only;
  - colour in PowerShell scripts uses `Write-Host -ForegroundColor`, not raw ANSI, so that Windows PowerShell 5.1 on legacy conhost works.

**CI and help**

- **R20 (SHOULD)** In CI (`CI` set): no animations and no prompts. Colour only through `FORCE_COLOR`/`--color=always`. Print URLs plain (Actions auto-links them).
- **R21 (SHOULD)** Help layout:
  1. `Usage:` line;
  2. one-sentence description;
  3. commands grouped by task;
  4. flags (long form first, aligned);
  5. 1–3 examples;
  6. docs and issues link.

  Running with no arguments prints the concise form plus "Run `zcode-kit --help` for more." `-h`/`--help` work after any subcommand. There are no escape codes when output is piped.
- **R22 (SHOULD)** Every capability has a tri-state override in cargo's style: `--color=auto|always|never`, plus `ZCODE_KIT_UNICODE`, `ZCODE_KIT_HYPERLINKS` and `ZCODE_KIT_PROGRESS` = `auto|always|never`. All of them are documented in `zcode-kit --help`.

---

## Sources

All accessed 2026-11-01 … 2026-11-06 unless noted. Dates are the source's own date where shown.

**Colour standards and runtimes**
- NO_COLOR, https://no-color.org/ (updated 2026-09-29)
- FORCE_COLOR, https://force-color.org/ (updated 2026-09-10)
- CLICOLOR standard (deprecated), https://bixense.com/clicolors/
- Node.js `lib/internal/tty.js` (v26.x and v24.x), https://raw.githubusercontent.com/nodejs/node/v26.x/lib/internal/tty.js, https://raw.githubusercontent.com/nodejs/node/v24.x/lib/internal/tty.js
- Node.js `lib/internal/util/colors.js` (v26.x), https://raw.githubusercontent.com/nodejs/node/v26.x/lib/internal/util/colors.js
- Node.js util docs v26.13.0 (`styleText` history), https://nodejs.org/api/util.html
- Node.js tty docs, https://nodejs.org/api/tty.html

**Windows: libuv, Bun, console**
- libuv tty docs, https://docs.libuv.org/en/v1.x/tty.html
- libuv issue #2389 (2019-07-25), https://github.com/libuv/libuv/issues/2389
- Bun PR #21161 (merged 2025-09-26), https://github.com/oven-sh/bun/pull/21161
- Bun v1.3.4 release notes, https://bun.sh/blog/bun-v1.3.4.md
- Microsoft, Console Code Pages (2021-02-12), https://learn.microsoft.com/en-us/windows/console/console-code-pages
- Microsoft, SetConsoleMode, https://learn.microsoft.com/en-us/windows/console/setconsolemode
- Microsoft devblogs, Unicode and UTF-8 Output Text Buffer (2018-11-16), https://devblogs.microsoft.com/commandline/windows-command-line-unicode-and-utf-8-output-text-buffer
- Microsoft devblogs, Inside the Windows Console (2018-07-20), https://devblogs.microsoft.com/commandline/windows-command-line-inside-the-windows-console

**Windows: PowerShell**
- about_Preference_Variables (5.1 view), https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables?view=powershell-5.1
- about_Preference_Variables (7.x, 2026-06-29), https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_preference_variables
- about_Character_Encoding, https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding
- about_ANSI_Terminals (2026-07-02), https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_ansi_terminals

**Windows: Terminal and conhost behaviour**
- microsoft/terminal #219 (2018-07-10), #9068 (2021-02-08), #8681 (2020-12-30), #18024 / #18042 (2024-10), discussion #13806: https://github.com/microsoft/terminal/issues/219, https://github.com/microsoft/terminal/issues/9068, https://github.com/microsoft/terminal/issues/8681, https://github.com/microsoft/terminal/issues/18024, https://github.com/microsoft/terminal/issues/18042, https://github.com/microsoft/terminal/discussions/13806
- Textualize/rich #140, DHowett on WT_SESSION (2020-07-06), https://github.com/Textualize/rich/issues/140
- Windows Terminal Preview 1.22 (2024-08-27), https://devblogs.microsoft.com/commandline/windows-terminal-preview-1-22-release

**Fonts and Unicode width**
- Microsoft Typography, WGL4 U+2013–U+FB02, https://learn.microsoft.com/en-us/typography/opentype/otspec140/wgl4e
- Lucida Console (secondary, for "WGL4 coverage"), https://en.wikipedia.org/wiki/Lucida_Console
- UAX #11 rev 44, Unicode 17.0.0 (2025-07-24), https://www.unicode.org/reports/tr11/
- Contour terminal-unicode-core (Mode 2027), https://github.com/contour-terminal/terminal-unicode-core
- libghostty Unicode docs, https://libghostty.tip.ghostty.org/group__unicode.html
- M. Hashimoto, Grapheme Clusters and Terminal Emulators (2023-10-02), https://mitchellh.com/writing/grapheme-clusters-in-terminals
- JLine Mode 2027 docs, https://jline.org/docs/advanced/grapheme-cluster-mode
- JLine #1753 (2026-03-31), https://github.com/jline/jline3/issues/1753
- J. Quast, correction tables / ucs-detect (2026-06-07), https://www.jeffquast.com/post/perfecting-terminal-character-width-using-correction-tables

**Hyperlinks**
- OSC 8 spec (Egmont Koblinger), https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda
- OSC 8 adoption list, https://github.com/Alhadis/OSC8-Adoption
- tmux 3.4 CHANGES, https://raw.githubusercontent.com/tmux/tmux/3.4/CHANGES
- tmux(1), https://www.man7.org/linux/man-pages/man1/tmux.1.html

**CLI conventions and other tools**
- Command Line Interface Guidelines, https://clig.dev/
- GitHub CLI manual: https://cli.github.com/manual/gh_help_environment, https://cli.github.com/manual/gh_help_formatting, https://cli.github.com/manual/gh_help_exit-codes
- npm v11 config, https://docs.npmjs.com/cli/v11/using-npm/config
- Cargo config, https://doc.rust-lang.org/cargo/reference/config.html

**CI**
- GitHub changelog, Actions log improvements (2020-09-23), https://github.blog/changelog/2020-09-23-github-actions-log-improvements/
- GitHub blog, A better logs experience (2020-09-23), https://github.blog/news-insights/product-news/a-better-logs-experience-with-github-actions
- actions/runner #241 (2019-09-10), https://github.com/actions/runner/issues/241

**Repo files cited**

All under `/home/AgentKit/wt/overhaul/`:
- `zcode-proxy-src/src/tui/width.ts`
- `zcode-proxy-src/src/tui/width.test.ts`
- `zcode-proxy-src/src/tui/frame.ts`
- `zcode-proxy-src/src/tui/app.ts`
- `zcode-proxy-src/src/runtime/paste-login.ts`
- `cli/setup-output.mjs`
- `install.sh`
- `install.ps1`
- `lib/process.mjs`
