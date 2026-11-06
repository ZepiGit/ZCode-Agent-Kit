// Seam 6 vectors for the shared width core and token set (ticket 05).
//
// ONE suite, run unchanged by two runners: `bun test` (src/tui/width-core.test.ts)
// and `node --test` (tests/width-core.test.mjs, through the CLI's lib/term/
// re-exports). Each runner passes its own `test` and `equal`, so the same
// vectors and the same assertions run under Bun and under Node.
//
// Expected widths come from the spec, not from the code: UAX #11 (UCD 17
// EastAsianWidth.txt: W/F = 2, everything else 1), grapheme clusters with
// VS16 after an emoji-variation base = 2, regional-indicator pairs = 2, and
// every cluster capped at 2 (spec §10, research/terminal-conventions.md §3).
// `before` is the width the pre-ticket-05 module (code-point wcwidth subset)
// returned; a vector whose `before` differs from `width` is a grapheme class
// whose width changes (listed in CHANGED_CLASSES below).

/** @type {Array<{ cls: string, text: string, width: number, before: number }>} */
export const WIDTH_VECTORS = [
  // ASCII fast path (no segmentation)
  { cls: "ascii", text: "hello world", width: 11, before: 11 },
  { cls: "ascii", text: "", width: 0, before: 0 },
  { cls: "ascii", text: "x".repeat(300), width: 300, before: 300 },
  { cls: "ascii", text: "\x1b[31mab\x1b[0m", width: 2, before: 2 },
  { cls: "ascii", text: "a\tb\x7f", width: 2, before: 2 },
  { cls: "latin1", text: "café naïve ±§", width: 13, before: 13 },
  // CJK and other East Asian Wide/Fullwidth (unchanged)
  { cls: "cjk", text: "日志", width: 4, before: 4 },
  { cls: "cjk", text: "a日b志", width: 6, before: 6 },
  { cls: "cjk", text: "上游服务暂时不可用", width: 18, before: 18 },
  { cls: "cjk", text: "한국어", width: 6, before: 6 },
  { cls: "fullwidth", text: "ＡＢ", width: 4, before: 4 },
  { cls: "halfwidth", text: "ｶﾀｶﾅ", width: 4, before: 4 },
  { cls: "emoji-in-old-table", text: "🚀x", width: 3, before: 3 },
  // Ambiguous (EAW=A) and narrow chrome glyphs stay 1 cell (UAX #11 default)
  { cls: "ambiguous-chrome", text: "─│╭╮╰╯●○▼▸…·→—✓✗", width: 16, before: 16 },
  // Combining marks
  { cls: "combining", text: "e\u0301x", width: 2, before: 2 },
  { cls: "combining", text: "\u0301", width: 0, before: 0 },
  { cls: "mixed-prefix", text: "abc\u0301日", width: 5, before: 5 },
  // Fast-path boundaries: the first joiner may sit at index 0 or extend the
  // code point before it; text after it is segmented
  { cls: "combining", text: "\u0301abc", width: 3, before: 3 },
  { cls: "ri-pair", text: "ab\u{1F1E9}\u{1F1EA}c", width: 5, before: 5 },
  { cls: "emoji-zwj", text: "ok \u{1F468}\u200D\u{1F469}\u200D\u{1F467}", width: 5, before: 9 },
  { cls: "hangul-jamo-cluster", text: "\u1100\uAC00", width: 2, before: 4 },
  { cls: "format-char", text: "\u0600\u0661", width: 1, before: 2 },
  // Changed: marks outside U+0300–036F now join their base
  { cls: "combining-other-scripts", text: "\u05E9\u05B8\u05C1", width: 1, before: 3 },
  { cls: "spacing-mark", text: "\u0915\u093F", width: 1, before: 2 },
  { cls: "format-char", text: "a\u2060b", width: 2, before: 3 },
  { cls: "format-char", text: "\uFEFF", width: 0, before: 1 },
  { cls: "hangul-jamo-cluster", text: "\u1100\u1161\u11A8", width: 2, before: 4 },
  // Changed: wide combining marks (Mn with EAW=W) are zero-width and join their base
  { cls: "wide-combining", text: "\u304B\u3099", width: 2, before: 4 },
  { cls: "wide-combining", text: "\u302A", width: 0, before: 2 },
  // Changed: unassigned code points in U+20D0–20FF are no longer zero-width
  { cls: "unassigned-20F1-20FF", text: "\u20F1", width: 1, before: 0 },
  // Changed: VS16 after an emoji-variation base makes the cluster wide
  { cls: "vs16", text: "\u2764\uFE0F", width: 2, before: 1 },
  { cls: "vs16", text: "1\uFE0F\u20E3", width: 2, before: 1 },
  { cls: "vs16", text: "\u{1F321}\uFE0F", width: 2, before: 2 },
  { cls: "vs16-text-default", text: "\u2764", width: 1, before: 1 },
  { cls: "vs16-invalid-base", text: "x\uFE0F", width: 1, before: 1 },
  // Regional indicators: a pair is one 2-cell cluster (the old per-code-point
  // sum was also 2, so the width is unchanged; truncation no longer splits it)
  { cls: "ri-pair", text: "\u{1F1E9}\u{1F1EA}", width: 2, before: 2 },
  { cls: "ri-pair", text: "\u{1F1E9}\u{1F1EA}\u{1F1EB}\u{1F1F7}", width: 4, before: 4 },
  { cls: "ri-single", text: "\u{1F1E9}", width: 1, before: 1 },
  // Changed: multi-code-point emoji clusters are capped at 2
  { cls: "emoji-modifier", text: "\u{1F44D}\u{1F3FD}", width: 2, before: 4 },
  { cls: "emoji-zwj", text: "\u{1F9D1}\u200D\u{1F33E}", width: 2, before: 4 },
  { cls: "emoji-zwj", text: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", width: 2, before: 6 },
  // Changed: W/F code points the hand-written table missed (UCD 17)
  { cls: "ucd17-wide", text: "\u231A", width: 2, before: 1 },
  { cls: "ucd17-wide", text: "\u2705", width: 2, before: 1 },
  { cls: "ucd17-wide", text: "\u2B50", width: 2, before: 1 },
  { cls: "ucd17-wide", text: "\u{1F004}", width: 2, before: 1 },
  { cls: "ucd17-wide", text: "\u{1F7E2}", width: 2, before: 1 },
  { cls: "ucd17-wide", text: "\u{1FAE0}", width: 2, before: 1 },
  { cls: "ucd17-wide", text: "\u{1B000}", width: 2, before: 1 },
  { cls: "ucd17-wide", text: "\u4DC0", width: 2, before: 1 },
  // Changed: code points the old table called wide that UCD 17 does not
  { cls: "ucd17-narrow", text: "\u{1F321}", width: 1, before: 2 },
  { cls: "ucd17-narrow", text: "\u3248", width: 1, before: 2 },
];

/**
 * Grapheme classes whose width changes (code-point counts from a full
 * U+0000–10FFFF comparison against the pre-ticket-05 module), and the TUI
 * frame rows that change because of them. A frame changes only where free
 * text carries such a grapheme: a log row, the toast, the server error row or
 * the login hint row (their padding and truncation shift). No Phase 1C BEFORE
 * fixture (ux/before/tui) contains one, so those frames stay byte-identical;
 * the frame test in width-core.test.ts renders one log row per class.
 */
const TEXT_ROWS = ["log row", "toast", "server error row", "login hint row"];
export const CHANGED_CLASSES = {
  "combining-other-scripts": { change: "1 -> 0 (Mn/Me outside U+0300-036F, 2,309 code points with format-char)", frames: TEXT_ROWS },
  "spacing-mark": { change: "Mc joins its base cluster", frames: TEXT_ROWS },
  "format-char": { change: "1 -> 0 (Cf such as U+2060, U+FEFF, U+202A-202E)", frames: TEXT_ROWS },
  "hangul-jamo-cluster": { change: "1 -> 0 for U+1160-11FF; L+V+T is one 2-cell cluster", frames: TEXT_ROWS },
  "wide-combining": { change: "2 -> 0 (U+302A-302D, U+3099-309A)", frames: TEXT_ROWS },
  "unassigned-20F1-20FF": { change: "0 -> 1 (15 unassigned code points)", frames: TEXT_ROWS },
  vs16: { change: "VS16 after an emoji-variation base: 1 -> 2", frames: TEXT_ROWS },
  "emoji-modifier": { change: "base + skin tone: 4 -> 2", frames: TEXT_ROWS },
  "emoji-zwj": { change: "ZWJ sequences: sum -> 2", frames: TEXT_ROWS },
  "ucd17-wide": { change: "1 -> 2 (8,709 code points: BMP emoji, U+1F7E0-1F7EB, U+1FA70-1FAF8, Tangut/Kana, U+4DC0-4DFF, ...)", frames: TEXT_ROWS },
  "ucd17-narrow": { change: "2 -> 1 (327 code points: text-default emoji in U+1F300-1F64F etc., EAW=A U+3248-324F, unassigned in U+2E80-303E)", frames: TEXT_ROWS },
};

/** @type {Array<{ text: string, max: number, out: string, why: string }>} */
export const TRUNCATE_VECTORS = [
  { text: "abc", max: 10, out: "abc", why: "fits" },
  { text: "abc", max: 3, out: "abc", why: "fits exactly" },
  { text: "abc", max: 0, out: "", why: "max 0" },
  { text: "abcdefghijkl", max: 8, out: "abcdefg…", why: "ascii fast path" },
  { text: "\x1b[31merror message that is quite long\x1b[0m", max: 10, out: "error mes…", why: "ANSI stripped first" },
  { text: "x".repeat(65536), max: 80, out: "x".repeat(79) + "…", why: "64 KB ascii line" },
  { text: "日志日志日志", max: 7, out: "日志日…", why: "never half a wide char" },
  { text: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u{1F468}\u200D\u{1F469}\u200D\u{1F467}x", max: 4, out: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}…", why: "never inside a ZWJ sequence" },
  { text: "\u{1F1E9}\u{1F1EA}\u{1F1EB}\u{1F1F7}\u{1F1EE}\u{1F1F9}", max: 5, out: "\u{1F1E9}\u{1F1EA}\u{1F1EB}\u{1F1F7}…", why: "never half a flag" },
  { text: "e\u0301e\u0301e\u0301", max: 2, out: "e\u0301…", why: "keeps the combining mark with its base" },
  { text: "\u2764\uFE0F\u2764\uFE0F\u2764\uFE0F", max: 5, out: "\u2764\uFE0F\u2764\uFE0F…", why: "VS16 clusters are 2 cells" },
  { text: "caf\u00E9 \u4E0A\u6E38 error", max: 9, out: "caf\u00E9 \u4E0A…", why: "latin-1 prefix then CJK" },
  { text: "abcde\u0301f", max: 5, out: "abcd…", why: "the cut lands on the base a joiner extends" },
  { text: "ab\u{1F1E9}\u{1F1EA}\u{1F1EB}\u{1F1F7}", max: 5, out: "ab\u{1F1E9}\u{1F1EA}…", why: "ascii prefix then flags" },
  { text: "\u0301\u0301abcdef", max: 3, out: "\u0301\u0301ab…", why: "joiners at index 0" },
];

/** @type {Array<{ text: string, width: number, out: string }>} */
export const PAD_VECTORS = [
  { text: "ab", width: 5, out: "ab   " },
  { text: "日志", width: 6, out: "日志  " },
  { text: "\u2764\uFE0F", width: 4, out: "\u2764\uFE0F  " },
  { text: "abcdef", width: 3, out: "abcdef" },
];

// Design-language §3 (status tokens, chrome glyphs, colour roles).
export const EXPECTED_TOKENS = {
  tiers: ["full", "wgl4", "ascii"],
  words: { pass: "PASS", fail: "FAIL", warn: "WARN", skip: "SKIP", ok: "OK", info: "INFO", run: "running", stop: "stopped" },
  checkWords: ["PASS", "FAIL", "WARN", "SKIP"],
  actionWords: ["OK", "FAIL", "WARN", "SKIP", "INFO"],
  glyphs: {
    full: { pass: "✓", ok: "✓", fail: "✗", warn: "!", skip: "–", info: "•", run: "●", stop: "○", bullet: "•", separator: "·", pointer: "▸", arrow: "→", ellipsis: "…", dash: "—", barFull: "█", barEmpty: "░", up: "↑", down: "↓", more: "▼" },
    wgl4: { pass: "√", ok: "√", fail: "×", warn: "!", skip: "–", info: "•", run: "●", stop: "○", bullet: "•", separator: "·", pointer: "►", arrow: "→", ellipsis: "…", dash: "—", barFull: "█", barEmpty: "░", up: "↑", down: "↓", more: "▼" },
    ascii: { pass: "+", ok: "+", fail: "x", warn: "!", skip: "-", info: "*", run: "*", stop: "o", bullet: "*", separator: "-", pointer: ">", arrow: "->", ellipsis: "...", dash: "-", barFull: "#", barEmpty: ".", up: "^", down: "v", more: "v" },
  },
  box: {
    full: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
    wgl4: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
    ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
  },
  spinner: ["|", "/", "-", "\\"],
  roles: { ok: "32", fail: "31", warn: "33", info: "36", accent: "36", heading: "1", cmd: "1", muted: "2" },
  statusRoles: { pass: "ok", ok: "ok", fail: "fail", warn: "warn", skip: "muted", info: "info", run: "ok", stop: "muted" },
};

// WGL4 code points used by the wgl4 tier (design-language §3.2; the WGL4
// repertoire is the Windows console's guaranteed set). Literal list.
const WGL4_USED = new Set([..."√×!–•●○·►→…—█░↑↓▼┌┐└┘─│"]);

/**
 * @param {{ test: (name: string, fn: () => void) => void,
 *           equal: (actual: unknown, expected: unknown, message?: string) => void,
 *           core: typeof import("../width-core.mjs"),
 *           tokens: typeof import("../tokens.mjs") }} t
 */
export function sharedOutputSuite({ test, equal, core, tokens }) {
  const { displayWidth, truncateToWidth, padEndWidth, stripAnsi } = core;

  test("width vectors: CJK, emoji, VS16, RI, combining and the ASCII fast path", () => {
    const got = WIDTH_VECTORS.map((v) => ({ cls: v.cls, text: v.text, width: displayWidth(v.text) }));
    equal(got, WIDTH_VECTORS.map(({ cls, text, width }) => ({ cls, text, width })));
  });

  test("every changed grapheme class is listed with the frames it changes", () => {
    const changed = [...new Set(WIDTH_VECTORS.filter((v) => v.before !== v.width).map((v) => v.cls))].sort();
    equal(changed, Object.keys(CHANGED_CLASSES).sort());
  });

  test("a cluster is never wider than 2 cells", () => {
    const long = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}\u{1F3FD}\uFE0F\u20E3";
    equal(displayWidth(long), 2);
  });

  test("truncation happens only at cluster boundaries", () => {
    equal(TRUNCATE_VECTORS.map((v) => truncateToWidth(v.text, v.max)), TRUNCATE_VECTORS.map((v) => v.out));
  });

  test("a truncated result never exceeds the budget", () => {
    for (const v of WIDTH_VECTORS) {
      for (let max = 1; max <= 6; max++) {
        const out = truncateToWidth(v.text.repeat(4), max);
        equal(displayWidth(out) <= max, true, `${v.cls} ${JSON.stringify(v.text)} at ${max}: ${JSON.stringify(out)}`);
      }
    }
  });

  // Adversarial: the fast paths (ASCII, per-code-point until the first joiner)
  // must never change a result. Width is additive over grapheme clusters, and
  // a truncated text keeps a whole number of clusters, for random mixes of
  // ASCII, Latin-1, CJK, controls, combining marks, ZWJ, VS16, skin tones,
  // regional indicators, Hangul jamo and Prepend characters.
  const PIECES = ["a", "Z", " ", "~", "é", "\t", "\x7f", "日", "한", "…", "─", "\u0301", "\u093F", "\u200D", "\uFE0F",
    "\u{1F3FD}", "\u{1F1E9}", "\u{1F1EA}", "\u1100", "\u1161", "\u11A8", "\u0600", "\u2764", "\u{1F468}", "\u{1F680}", "\u20E3", "1", "\u3099"];
  const randomStrings = () => {
    let seed = 0x5eed05;
    const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 0x100000000;
    const out = [];
    for (let n = 0; n < 2000; n++) {
      let s = "";
      const len = 1 + Math.floor(next() * 12);
      for (let i = 0; i < len; i++) s += PIECES[Math.floor(next() * PIECES.length)];
      out.push(s);
    }
    return out;
  };
  const clustersOf = (s) => [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((x) => x.segment);

  test("width is the sum of its grapheme clusters' widths (fast paths agree with segmentation)", () => {
    const bad = [];
    for (const s of randomStrings()) {
      const sum = clustersOf(s).reduce((w, c) => w + displayWidth(c), 0);
      if (displayWidth(s) !== sum) bad.push(JSON.stringify(s));
    }
    equal(bad, []);
  });

  test("truncation keeps a whole number of clusters and never exceeds the budget", () => {
    const bad = [];
    for (const s of randomStrings()) {
      const clusters = clustersOf(s);
      for (const max of [1, 2, 3, 5, 8]) {
        const out = truncateToWidth(s, max);
        if (displayWidth(out) > max) { bad.push(`${JSON.stringify(s)}@${max} too wide`); continue; }
        if (out === s) continue;
        const kept = out.slice(0, -1);
        let prefix = "";
        let whole = kept === "";
        for (const c of clusters) { prefix += c; if (prefix === kept) { whole = true; break; } if (prefix.length > kept.length) break; }
        if (!whole || !out.endsWith("…")) bad.push(`${JSON.stringify(s)}@${max} -> ${JSON.stringify(out)}`);
      }
    }
    equal(bad, []);
  });

  test("padding is display-width aware", () => {
    equal(PAD_VECTORS.map((v) => padEndWidth(v.text, v.width)), PAD_VECTORS.map((v) => v.out));
  });

  test("stripAnsi removes CSI, OSC 8 and two-byte escapes", () => {
    equal(stripAnsi("\x1b[1;36mbold\x1b[0m \x1b]8;;https://x.test\x07link\x1b]8;;\x07 \x1b=ok"), "bold link ok");
  });

  test("the width core names its Unicode data version", () => {
    equal(core.UNICODE_VERSION, "17.0.0");
  });

  test("token set: tiers, verdict words, glyphs, box chrome and colour roles", () => {
    equal(
      {
        tiers: [...tokens.GLYPH_TIERS], words: { ...tokens.WORDS }, checkWords: [...tokens.CHECK_WORDS],
        actionWords: [...tokens.ACTION_WORDS],
        glyphs: Object.fromEntries(tokens.GLYPH_TIERS.map((t) => [t, { ...tokens.GLYPHS[t] }])),
        box: Object.fromEntries(tokens.GLYPH_TIERS.map((t) => [t, { ...tokens.BOX[t] }])),
        spinner: [...tokens.SPINNER], roles: { ...tokens.ROLES }, statusRoles: { ...tokens.STATUS_ROLES },
      },
      EXPECTED_TOKENS,
    );
  });

  test("tier glyphs stay inside their repertoire: ascii is 7-bit, wgl4 is WGL4, none is wide or VS16", () => {
    for (const tier of tokens.GLYPH_TIERS) {
      const all = [...Object.values(tokens.GLYPHS[tier]), ...Object.values(tokens.BOX[tier]), ...tokens.SPINNER].join("");
      for (const ch of all) {
        equal(displayWidth(ch), 1, `${tier} glyph ${JSON.stringify(ch)} must be one cell`);
        equal(ch === "\uFE0F", false, `${tier} must not use VS16`);
        if (tier === "ascii") equal(ch.codePointAt(0) < 0x80, true, `ascii glyph ${JSON.stringify(ch)}`);
        if (tier === "wgl4" && ch.codePointAt(0) >= 0x80) equal(WGL4_USED.has(ch), true, `wgl4 glyph ${JSON.stringify(ch)}`);
      }
    }
  });

  test("the shared token set cannot be mutated by one renderer behind the other's back", () => {
    const attempts = [
      () => { tokens.GLYPHS.full.pass = "X"; },
      () => { tokens.BOX.ascii.tl = "#"; },
      () => { tokens.ROLES.fail = "35"; },
      () => { tokens.WORDS.warn = "WARNING"; },
      () => { tokens.CHECK_WORDS.push("INFO"); },
      () => { tokens.GLYPHS.wgl4 = {}; },
    ];
    for (const attempt of attempts) {
      let threw = false;
      try { attempt(); } catch (err) { threw = err instanceof TypeError; }
      equal(threw, true, `mutation must throw: ${attempt}`);
    }
    equal(tokens.GLYPHS.full.pass, "✓");
    equal(tokens.CHECK_WORDS.length, 4);
  });
}
