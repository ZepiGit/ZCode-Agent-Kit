/**
 * Shared token set of the terminal output: glyph tiers, box chrome,
 * 16-colour roles and verdict
 * words. One set for two renderers: the proxy TUI's frame.ts (Bun) and the
 * kit CLI's lib/term/ (Node). Plain ESM, no imports, no runtime-specific
 * APIs; types in tokens.d.mts. Every export is deeply frozen, so neither
 * renderer can change a token behind the other's back.
 *
 * Tier choice (full / wgl4 / ascii) belongs to the capability record of the
 * renderer that uses the tokens, not to this module.
 */

const deepFreeze = (value) => {
  for (const v of Object.values(value)) if (typeof v === "object" && v !== null) deepFreeze(v);
  return Object.freeze(value);
};

/** Glyph tiers, richest first. */
export const GLYPH_TIERS = deepFreeze(["full", "wgl4", "ascii"]);

/**
 * Words printed in every tier. Checks report PASS|FAIL|WARN|SKIP, actions
 * OK|FAIL|WARN|SKIP|INFO (the words never map down).
 */
export const WORDS = deepFreeze({
  pass: "PASS", fail: "FAIL", warn: "WARN", skip: "SKIP", ok: "OK", info: "INFO", run: "running", stop: "stopped",
});
export const CHECK_WORDS = deepFreeze(["PASS", "FAIL", "WARN", "SKIP"]);
export const ACTION_WORDS = deepFreeze(["OK", "FAIL", "WARN", "SKIP", "INFO"]);

/** Status glyphs and chrome glyphs per tier. */
export const GLYPHS = deepFreeze({
  full: {
    pass: "✓", ok: "✓", fail: "✗", warn: "!", skip: "–", info: "•", run: "●", stop: "○",
    bullet: "•", separator: "·", pointer: "▸", arrow: "→", ellipsis: "…", dash: "—",
    barFull: "█", barEmpty: "░", up: "↑", down: "↓", more: "▼",
  },
  wgl4: {
    pass: "√", ok: "√", fail: "×", warn: "!", skip: "–", info: "•", run: "●", stop: "○",
    bullet: "•", separator: "·", pointer: "►", arrow: "→", ellipsis: "…", dash: "—",
    barFull: "█", barEmpty: "░", up: "↑", down: "↓", more: "▼",
  },
  ascii: {
    pass: "+", ok: "+", fail: "x", warn: "!", skip: "-", info: "*", run: "*", stop: "o",
    bullet: "*", separator: "-", pointer: ">", arrow: "->", ellipsis: "...", dash: "-",
    barFull: "#", barEmpty: ".", up: "^", down: "v", more: "v",
  },
});

/** Box chrome per tier: corners, horizontal and vertical lines. */
export const BOX = deepFreeze({
  full: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
  wgl4: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
});

/** Spinner frames, the same in every tier (no braille, R12). */
export const SPINNER = deepFreeze(["|", "/", "-", "\\"]);

/** Colour roles as 16-colour SGR parameters (R13). */
export const ROLES = deepFreeze({
  ok: "32", fail: "31", warn: "33", info: "36", accent: "36", heading: "1", cmd: "1", muted: "2",
});

/** Colour role of each status token. */
export const STATUS_ROLES = deepFreeze({
  pass: "ok", ok: "ok", fail: "fail", warn: "warn", skip: "muted", info: "info", run: "ok", stop: "muted",
});
