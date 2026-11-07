// Line endings of user-owned text files (ticket 68): the one policy every
// writer of proxy/config.yaml and the harness configs uses. A Windows user's
// files are CRLF (installers, editors, git autocrlf), while the yaml library,
// JSON.stringify and the kit's own templates produce LF. A writer that puts
// that text into a CRLF file would leave mixed line endings, so it writes the
// text with the line endings the file already uses.
//
// The rule: a file with more CRLF than bare LF line breaks is CRLF, anything
// else (including a new or empty file, and a tie) is LF. A lone CR is not a
// line break. Writers that re-render the whole document pass the whole text;
// writers that splice a fragment into the file pass only the fragment, so the
// bytes outside the edit stay as they are.
//
// Runtime-neutral plain ESM (ADR-0011 condition 1): used by the CLI under Node
// and by the proxy under Bun. No Node-only or Bun-only APIs, no imports.
// Two byte-identical copies: zcode-proxy-src/src/config/line-endings.mjs (the
// proxy builds from zcode-proxy-src alone, e.g. its Dockerfile) and
// lib/line-endings.mjs (the CLI runs from cli/ + lib/). tests/crlf-writers.test.mjs
// fails when they differ: edit one, copy it over the other.

/** "\r\n" when `source` has more CRLF than bare LF line breaks, else "\n". */
export function lineEndingOf(source) {
  const crlf = (source.match(/\r\n/g) ?? []).length;
  const lf = (source.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? "\r\n" : "\n";
}

/** `text` with the line endings `source` uses (every break, CRLF or LF, converted). */
export function withLineEndingsOf(source, text) {
  const lines = text.replace(/\r\n/g, "\n");
  return lineEndingOf(source) === "\r\n" ? lines.replace(/\n/g, "\r\n") : lines;
}
