// Seam 5: the capability record (lib/term/caps.mjs), one per output stream.
// Expected values come from spec §10 / design-language §2:
//   colour  — flag > NO_COLOR > FORCE_COLOR > CLICOLOR_FORCE > non-TTY off
//             > TERM=dumb off > CLICOLOR=0 off > on
//   glyphs  — ZCODE_KIT_UNICODE override > ascii (TERM=dumb, non-TTY,
//             non-UTF-8 POSIX locale) > wgl4 (win32 without WT_SESSION /
//             TERM_PROGRAM) > full
//   animate — TTY && TERM != dumb && !CI
//   width   — stream.columns ?? COLUMNS ?? 80, min 40
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCaps } from "../lib/term/caps.mjs";

const TTY = { isTTY: true, columns: 100 };
const PIPE = { isTTY: false };
const UTF8 = { TERM: "xterm-256color", LANG: "en_US.UTF-8" };
const caps = (stream, env, { flags, platform = "linux" } = {}) => detectCaps(stream, { env, flags, platform });

test("colour: an interactive UTF-8 terminal with no overrides gets colour", () => {
  assert.equal(caps(TTY, UTF8).color, true);
});

test("colour: the --color flag beats every environment variable", () => {
  assert.equal(caps(PIPE, { ...UTF8, NO_COLOR: "1" }, { flags: { color: "always" } }).color, true);
  assert.equal(caps(TTY, { ...UTF8, FORCE_COLOR: "1", CLICOLOR_FORCE: "1" }, { flags: { color: "never" } }).color, false);
  assert.equal(caps(TTY, { ...UTF8, NO_COLOR: "1" }, { flags: { color: "auto" } }).color, false, "auto defers to the environment");
});

test("colour: NO_COLOR beats FORCE_COLOR and CLICOLOR_FORCE", () => {
  assert.equal(caps(TTY, { ...UTF8, NO_COLOR: "1", FORCE_COLOR: "1" }).color, false);
  assert.equal(caps(PIPE, { ...UTF8, NO_COLOR: "1", FORCE_COLOR: "3", CLICOLOR_FORCE: "1" }).color, false);
});

test("colour: an empty NO_COLOR does not count (no-color.org)", () => {
  assert.equal(caps(TTY, { ...UTF8, NO_COLOR: "" }).color, true);
});

test("colour: FORCE_COLOR turns colour on off a TTY and under TERM=dumb; FORCE_COLOR=0 turns it off", () => {
  assert.equal(caps(PIPE, { ...UTF8, FORCE_COLOR: "1" }).color, true);
  assert.equal(caps(TTY, { TERM: "dumb", FORCE_COLOR: "1" }).color, true);
  assert.equal(caps(TTY, { ...UTF8, FORCE_COLOR: "0" }).color, false);
  assert.equal(caps(TTY, { ...UTF8, FORCE_COLOR: "false" }).color, false);
});

test("colour: FORCE_COLOR beats CLICOLOR_FORCE", () => {
  assert.equal(caps(TTY, { ...UTF8, FORCE_COLOR: "0", CLICOLOR_FORCE: "1" }).color, false);
});

test("colour: CLICOLOR_FORCE turns colour on off a TTY; CLICOLOR_FORCE=0 does not", () => {
  assert.equal(caps(PIPE, { ...UTF8, CLICOLOR_FORCE: "1" }).color, true);
  assert.equal(caps(PIPE, { ...UTF8, CLICOLOR_FORCE: "0" }).color, false);
});

test("colour: off a TTY, under TERM=dumb and with CLICOLOR=0 there is no colour", () => {
  assert.equal(caps(PIPE, UTF8).color, false);
  assert.equal(caps(TTY, { TERM: "dumb", LANG: "C.UTF-8" }).color, false);
  assert.equal(caps(TTY, { ...UTF8, CLICOLOR: "0" }).color, false);
  assert.equal(caps(TTY, { ...UTF8, CLICOLOR: "1" }).color, true);
});

test("glyphs: a UTF-8 terminal gets the full tier", () => {
  assert.equal(caps(TTY, UTF8).glyphs, "full");
  assert.equal(caps(TTY, { TERM: "xterm", LC_CTYPE: "C.utf8" }).glyphs, "full", "utf8 without the dash counts");
});

test("glyphs: off a TTY and under TERM=dumb the tier is ascii", () => {
  assert.equal(caps(PIPE, UTF8).glyphs, "ascii");
  assert.equal(caps(TTY, { TERM: "dumb", LANG: "en_US.UTF-8" }).glyphs, "ascii");
});

test("glyphs: a non-UTF-8 POSIX locale gets ascii, with LC_ALL > LC_CTYPE > LANG", () => {
  assert.equal(caps(TTY, { TERM: "xterm-256color", LANG: "C" }).glyphs, "ascii");
  assert.equal(caps(TTY, { TERM: "xterm-256color", LANG: "de_DE.ISO-8859-1" }).glyphs, "ascii");
  assert.equal(caps(TTY, { TERM: "xterm-256color" }).glyphs, "ascii", "no locale variable is the POSIX C locale");
  assert.equal(caps(TTY, { TERM: "xterm-256color", LANG: "en_US.UTF-8", LC_ALL: "C" }).glyphs, "ascii");
  assert.equal(caps(TTY, { TERM: "xterm-256color", LANG: "C", LC_CTYPE: "en_US.UTF-8" }).glyphs, "full");
  assert.equal(caps(TTY, { TERM: "xterm-256color", LC_ALL: "", LANG: "C.UTF-8" }).glyphs, "full", "an empty LC_ALL is unset");
});

test("glyphs: win32 without WT_SESSION / TERM_PROGRAM (conhost) gets wgl4, whatever the locale", () => {
  assert.equal(caps(TTY, {}, { platform: "win32" }).glyphs, "wgl4");
  assert.equal(caps(TTY, { LANG: "C" }, { platform: "win32" }).glyphs, "wgl4", "the locale rule is POSIX only");
  assert.equal(caps(TTY, { WT_SESSION: "8c1d" }, { platform: "win32" }).glyphs, "full");
  assert.equal(caps(TTY, { TERM_PROGRAM: "vscode" }, { platform: "win32" }).glyphs, "full");
  assert.equal(caps(PIPE, { WT_SESSION: "8c1d" }, { platform: "win32" }).glyphs, "ascii", "non-TTY still beats Windows Terminal");
});

test("glyphs: ZCODE_KIT_UNICODE=1|0 overrides every other glyph rule; other values are ignored", () => {
  assert.equal(caps(PIPE, { ...UTF8, ZCODE_KIT_UNICODE: "1" }).glyphs, "full");
  assert.equal(caps(TTY, { TERM: "dumb", LANG: "C", ZCODE_KIT_UNICODE: "1" }).glyphs, "full");
  assert.equal(caps(TTY, { ZCODE_KIT_UNICODE: "1" }, { platform: "win32" }).glyphs, "full");
  assert.equal(caps(TTY, { ...UTF8, ZCODE_KIT_UNICODE: "0" }).glyphs, "ascii");
  assert.equal(caps(TTY, { WT_SESSION: "x", ZCODE_KIT_UNICODE: "0" }, { platform: "win32" }).glyphs, "ascii");
  assert.equal(caps(TTY, { ...UTF8, ZCODE_KIT_UNICODE: "yes" }).glyphs, "full");
  assert.equal(caps(TTY, { TERM: "xterm", LANG: "C", ZCODE_KIT_UNICODE: "true" }).glyphs, "ascii");
});

test("animate: only on a TTY, not under TERM=dumb and not in CI", () => {
  assert.equal(caps(TTY, UTF8).animate, true);
  assert.equal(caps(PIPE, UTF8).animate, false);
  assert.equal(caps(TTY, { ...UTF8, TERM: "dumb" }).animate, false);
  assert.equal(caps(TTY, { ...UTF8, CI: "true" }).animate, false);
  assert.equal(caps(TTY, { ...UTF8, CI: "1" }).animate, false);
  assert.equal(caps(TTY, { ...UTF8, CI: "false" }).animate, true, "CI=false is not CI");
  assert.equal(caps(TTY, { ...UTF8, CI: "0" }).animate, true, "CI=0 is not CI");
  assert.equal(caps(TTY, { ...UTF8, NO_COLOR: "1" }).animate, true, "NO_COLOR does not stop motion");
});

test("plain: the legacy line grammar applies off a TTY, under TERM=dumb and in CI", () => {
  assert.equal(caps(TTY, UTF8).plain, false);
  assert.equal(caps(TTY, { ...UTF8, NO_COLOR: "1" }).plain, false, "NO_COLOR keeps the rich layout");
  assert.equal(caps(PIPE, { ...UTF8, FORCE_COLOR: "1" }).plain, true, "forced colour does not leave line mode");
  assert.equal(caps(TTY, { ...UTF8, TERM: "dumb" }).plain, true);
  assert.equal(caps(TTY, { ...UTF8, CI: "true" }).plain, true);
});

test("width: stream.columns, else COLUMNS, else 80; never below 40", () => {
  assert.equal(caps({ isTTY: true, columns: 120 }, { ...UTF8, COLUMNS: "90" }).width, 120);
  assert.equal(caps({ isTTY: true }, { ...UTF8, COLUMNS: "90" }).width, 90);
  assert.equal(caps(PIPE, { ...UTF8, COLUMNS: "132" }).width, 132);
  assert.equal(caps(PIPE, UTF8).width, 80);
  assert.equal(caps({ isTTY: true, columns: 20 }, UTF8).width, 40);
  assert.equal(caps(PIPE, { ...UTF8, COLUMNS: "12" }).width, 40);
  assert.equal(caps(PIPE, { ...UTF8, COLUMNS: "wide" }).width, 80, "a non-numeric COLUMNS is ignored");
  assert.equal(caps({ isTTY: true, columns: 0 }, UTF8).width, 80, "columns 0 (unknown) falls through");
});

test("tty and fixed: a TTY stream is fixed-width (may truncate); off a TTY nothing is truncated", () => {
  assert.deepEqual([caps(TTY, UTF8).tty, caps(TTY, UTF8).fixed], [true, true]);
  assert.deepEqual([caps(PIPE, UTF8).tty, caps(PIPE, UTF8).fixed], [false, false]);
  assert.equal(caps({}, UTF8).tty, false, "a stream without isTTY is not a TTY");
});

test("the record is a frozen snapshot: later env changes do not alter it", () => {
  const env = { ...UTF8 };
  const record = caps(TTY, env);
  env.NO_COLOR = "1";
  assert.equal(record.color, true);
  assert.ok(Object.isFrozen(record));
  assert.deepEqual(Object.keys(record).sort(), ["animate", "color", "fixed", "glyphs", "plain", "tty", "width"]);
});

// Ticket 42 round 2: how a question is drawn comes from the record, not from
// the process's own TERM (readline's rl.prompt() checks process.env.TERM).
test("promptStyle: a question may be redrawn with cursor control only on a colour TTY with motion (not NO_COLOR, TERM=dumb, CI or a pipe)", async () => {
  const { promptStyle } = await import("../lib/term/caps.mjs");
  const redraw = (stream, env, opts) => promptStyle(caps(stream, env, opts)).redraw;
  assert.equal(redraw(TTY, UTF8), true);
  assert.equal(redraw(TTY, {}), true, "an unset TERM is not dumb");
  assert.equal(redraw(TTY, {}, { platform: "win32" }), true, "conhost");
  assert.equal(redraw(TTY, { ...UTF8, NO_COLOR: "1" }), false);
  assert.equal(redraw(TTY, { ...UTF8, TERM: "dumb" }), false);
  assert.equal(redraw(TTY, { ...UTF8, CI: "true" }), false);
  assert.equal(redraw(TTY, UTF8, { flags: { color: "never" } }), false);
  assert.equal(redraw(PIPE, UTF8), false);
  assert.equal(redraw(PIPE, { ...UTF8, FORCE_COLOR: "1" }), false, "forced colour is no terminal");
});
