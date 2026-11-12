// Capability record (design-language §2, spec §10, ADR-0011): what one output
// stream can show. This is the only kit module that reads isTTY, NO_COLOR,
// TERM, CI or columns; every renderer takes its decisions from the record.
// Pure: the stream, environment, flags and platform are passed in, so tests
// force any terminal without a pty.
//
//   colour  — flag > NO_COLOR > FORCE_COLOR > CLICOLOR_FORCE > non-TTY off
//             > TERM=dumb off > CLICOLOR=0 off > on
//   glyphs  — ZCODE_KIT_UNICODE override > ascii (TERM=dumb, non-TTY,
//             non-UTF-8 POSIX locale) > wgl4 (win32 without WT_SESSION /
//             TERM_PROGRAM) > full
//   animate — TTY && TERM != dumb && !CI
//   width   — stream.columns ?? COLUMNS ?? 80, min 40; off a TTY nothing
//             is truncated (fixed = tty)
//   plain   — off a TTY, under TERM=dumb or in CI: the legacy line grammar
//             (ADR-0001 rule 1) applies
// promptStyle(caps) derives how a question is drawn from the record.

/** @typedef {"full" | "wgl4" | "ascii"} GlyphTier */
/**
 * @typedef {{
 *   tty: boolean, color: boolean, glyphs: GlyphTier, animate: boolean,
 *   width: number, fixed: boolean, plain: boolean,
 * }} Caps
 */

const MIN_WIDTH = 40;
const DEFAULT_WIDTH = 80;

const set = (value) => typeof value === "string" && value !== "";
const falsy = (value) => /^(0|false)$/i.test(value);

/** CI as the kit already reads it (cli/connection-details.mjs): set, and not 0/false. */
const isCi = (env) => set(env.CI) && !falsy(env.CI);

function colour(tty, env, flag) {
  if (flag === "always") return true;
  if (flag === "never") return false;
  if (set(env.NO_COLOR)) return false;
  if (env.FORCE_COLOR !== undefined) return !falsy(env.FORCE_COLOR);
  if (set(env.CLICOLOR_FORCE) && env.CLICOLOR_FORCE !== "0") return true;
  if (!tty) return false;
  if (env.TERM === "dumb") return false;
  if (env.CLICOLOR === "0") return false;
  return true;
}

/** The POSIX locale's charset: LC_ALL > LC_CTYPE > LANG; none set is the C locale. */
function utf8Locale(env) {
  const locale = [env.LC_ALL, env.LC_CTYPE, env.LANG].find(set) ?? "C";
  return /utf-?8/i.test(locale);
}

function glyphTier(tty, env, platform) {
  if (env.ZCODE_KIT_UNICODE === "1") return "full";
  if (env.ZCODE_KIT_UNICODE === "0") return "ascii";
  if (!tty || env.TERM === "dumb") return "ascii";
  if (platform === "win32") return set(env.WT_SESSION) || set(env.TERM_PROGRAM) ? "full" : "wgl4";
  return utf8Locale(env) ? "full" : "ascii";
}

function columns(stream, env) {
  const fromStream = Number.isInteger(stream.columns) && stream.columns > 0 ? stream.columns : undefined;
  const fromEnv = /^\d+$/.test(env.COLUMNS ?? "") && Number(env.COLUMNS) > 0 ? Number(env.COLUMNS) : undefined;
  return Math.max(MIN_WIDTH, fromStream ?? fromEnv ?? DEFAULT_WIDTH);
}

/**
 * @param {{ isTTY?: boolean, columns?: number }} stream
 * @param {{ env?: Record<string, string | undefined>, flags?: { color?: "auto" | "always" | "never" }, platform?: string }} [opts]
 * @returns {Readonly<Caps>}
 */
export function detectCaps(stream, { env = process.env, flags = {}, platform = process.platform } = {}) {
  const tty = stream?.isTTY === true;
  const dumb = env.TERM === "dumb";
  const ci = isCi(env);
  return Object.freeze({
    tty,
    color: colour(tty, env, flags.color),
    glyphs: glyphTier(tty, env, platform),
    animate: tty && !dumb && !ci,
    width: columns(stream ?? {}, env),
    fixed: tty,
    plain: !tty || dumb || ci,
  });
}

/**
 * How a question is drawn on one stream (design-language §4.9). The kit
 * writes the question text itself on every terminal. Line editing may redraw
 * it with cursor control (ESC[1G, ESC[0J, ESC[<n>G) only where motion is
 * allowed and colour is on (§4.10 R6, §3.3 R15): never with colour off
 * (NO_COLOR, TERM=dumb), in CI or off a TTY.
 * @param {Readonly<Caps>} caps
 * @returns {Readonly<{ redraw: boolean }>}
 */
export function promptStyle(caps) {
  return Object.freeze({ redraw: caps.animate && caps.color });
}

/** Selector-only physical evidence. Never substitute logical/env dimensions. */
export function selectorCaps(stream, opts = {}) {
  const caps = detectCaps(stream, opts);
  const measured = (n) => Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : undefined;
  const columns = measured(stream?.columns), rows = measured(stream?.rows);
  return Object.freeze({
    ...caps, columns, rows,
    width: columns === undefined ? undefined : Math.min(caps.width, columns - 1),
    eligible: promptStyle(caps).redraw && !set((opts.env ?? process.env).NO_COLOR) && columns !== undefined && rows !== undefined,
  });
}
