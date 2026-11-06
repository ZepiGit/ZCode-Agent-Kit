// Seam 5: byte snapshots of the output module's primitives in every C3
// variant (tests/snapshots/term/<fixture>/<variant>.{out,err}), rendered from
// records with forced capabilities (tests/snapshot-harness.mjs), plus the
// Story 107 scan: no escape sequence in any NO_COLOR, pipe, TERM=dumb or CI
// render. The stored renders were reviewed against design-language §4.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRIMITIVE_FIXTURES } from "./term-fixtures.mjs";
import { C3_VARIANTS, COLOURLESS_VARIANTS, matchSnapshot, normaliseSnapshot, renderVariant } from "./snapshot-harness.mjs";

for (const [name, drive] of Object.entries(PRIMITIVE_FIXTURES)) {
  for (const variant of Object.keys(C3_VARIANTS)) {
    test(`snapshot: ${name} in ${variant}`, () => {
      const { stdout, stderr } = renderVariant(variant, drive);
      matchSnapshot(`term/${name}/${variant}.out`, stdout);
      matchSnapshot(`term/${name}/${variant}.err`, stderr);
    });
  }
}

test("no escape sequence in any NO_COLOR, pipe, TERM=dumb or CI render of the primitives' fixtures (Story 107)", () => {
  let scanned = 0;
  for (const [name, drive] of Object.entries(PRIMITIVE_FIXTURES)) {
    for (const variant of COLOURLESS_VARIANTS) {
      const { stdout, stderr } = renderVariant(variant, drive);
      for (const [stream, text] of [["stdout", stdout], ["stderr", stderr]]) {
        assert.equal(text.indexOf("\x1b"), -1, `ESC byte in ${name} / ${variant} / ${stream}: ${JSON.stringify(text.slice(Math.max(0, text.indexOf("\x1b") - 20), text.indexOf("\x1b") + 20))}`);
        scanned += text.length;
      }
    }
  }
  assert.ok(scanned > 5000, "the scan must cover real renders");
});

test("the colour variants do colour (the scan above is not vacuous)", () => {
  const { stdout, stderr } = renderVariant("tty-color-80", PRIMITIVE_FIXTURES.checks);
  assert.match(stdout, /\x1b\[31m✗ FAIL\x1b\[0m/);
  assert.match(renderVariant("tty-color-80", PRIMITIVE_FIXTURES.diagnostics).stderr, /\x1b\[33m! WARN  Account Rotator question skipped\x1b\[0m/);
  assert.equal(stderr, "");
});

test("off a TTY in every glyph tier the fixture's check rows match the legacy grammar", () => {
  const ROW = /^(PASS|FAIL|SKIP|WARN)  .+?( — .+)?$/;
  for (const variant of ["pipe", "ci"]) {
    const lines = renderVariant(variant, PRIMITIVE_FIXTURES.checks).stdout.split("\n").filter(Boolean);
    const rows = lines.filter((l) => /^[A-Z]{4}  /.test(l));
    assert.equal(rows.length, 6);
    for (const row of rows) assert.match(row, ROW);
    for (const line of lines.filter((l) => /^\s/.test(l))) assert.match(line, /^\s+(why|next): /);
  }
});

test("matchSnapshot writes only with UPDATE_SNAPSHOTS=1 and otherwise fails on a missing or different snapshot", (t) => {
  const root = mkdtempSync(join(tmpdir(), "zcode-snapshots-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => matchSnapshot("a/x.out", "one\n", { root, env: {} }), /snapshot missing: a\/x\.out/);
  assert.throws(() => matchSnapshot("a/x.out", "one\n", { root, env: { UPDATE_SNAPSHOTS: "true" } }), /snapshot missing/, "only the exact value 1 writes");
  assert.equal(matchSnapshot("a/x.out", "one\n", { root, env: { UPDATE_SNAPSHOTS: "1" } }), "written");
  assert.equal(readFileSync(join(root, "a", "x.out"), "utf8"), "one\n");
  assert.equal(matchSnapshot("a/x.out", "one\n", { root, env: {} }), "match");
  assert.throws(() => matchSnapshot("a/x.out", "two\n", { root, env: {} }), /snapshot differs: a\/x\.out line 1/);
  assert.equal(readFileSync(join(root, "a", "x.out"), "utf8"), "one\n", "a failed comparison never writes");
});

test("matchSnapshot compares bytes: CRLF, a dropped SGR reset or a trailing space all differ", (t) => {
  const root = mkdtempSync(join(tmpdir(), "zcode-snapshots-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "b"), { recursive: true });
  writeFileSync(join(root, "b", "y.out"), "\x1b[32m✓ PASS\x1b[0m  name\n");
  assert.throws(() => matchSnapshot("b/y.out", "\x1b[32m✓ PASS\x1b[0m  name\r\n", { root, env: {} }));
  assert.throws(() => matchSnapshot("b/y.out", "\x1b[32m✓ PASS  name\n", { root, env: {} }));
  assert.throws(() => matchSnapshot("b/y.out", "\x1b[32m✓ PASS\x1b[0m  name \n", { root, env: {} }));
});

test("the normalisation list masks paths, ports, PIDs, times and versions only", () => {
  const input = [
    "PASS  bun available — /home/runner/.bun/bin/bun (1.4.4)",
    "FAIL  proxy reachable + identity — http://127.0.0.1:19060 pid 51234 at 2026-11-06T10:11:12.345Z (812ms)",
    "WARN  update — v0.2.43-rc.1 available; temp /tmp/zcode-kit-update-AbC123/kit",
    "SKIP  windows — C:\\Users\\runneradmin\\AppData\\Local\\Temp\\ux-kit-x1\\kit",
    "doctor: 1 failed, 1 warning, 1 passed, 1 skipped → exit 1",
    "  next: zcode-kit proxy start",
    "OK  done — exit 0 · exit 130 · exit 20",
  ].join("\n");
  assert.equal(normaliseSnapshot(input), [
    "PASS  bun available — <HOME> (<VERSION>)",
    "FAIL  proxy reachable + identity — http://127.0.0.1:<PORT> pid <PID> at <TS> (<MS>ms)",
    "WARN  update — <VERSION> available; temp <TMP>",
    "SKIP  windows — <TMP>",
    "doctor: 1 failed, 1 warning, 1 passed, 1 skipped → exit 1",
    "  next: zcode-kit proxy start",
    "OK  done — exit 0 · exit 130 · exit 20",
  ].join("\n"));
});
