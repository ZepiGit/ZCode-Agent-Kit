// Seam 6 under Node: the shared width core and token set, reached
// through the CLI's lib/term/ re-exports. The same suite runs under Bun in
// zcode-proxy-src/src/tui/width-core.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "../lib/term/width.mjs";
import * as tokens from "../lib/term/tokens.mjs";
import * as tuiCore from "../zcode-proxy-src/src/tui/width-core.mjs";
import * as tuiTokens from "../zcode-proxy-src/src/tui/tokens.mjs";
import { sharedOutputSuite } from "../zcode-proxy-src/src/tui/__fixtures__/shared-output-suite.mjs";

const KIT = join(import.meta.dirname, "..");

sharedOutputSuite({
  test,
  equal: (actual, expected, message) => assert.deepStrictEqual(actual, expected, message),
  core,
  tokens,
});

test("the CLI's lib/term/ re-exports are the TUI's shared modules, not copies", () => {
  for (const name of ["displayWidth", "truncateToWidth", "padEndWidth", "stripAnsi", "UNICODE_VERSION"]) {
    assert.equal(core[name], tuiCore[name], name);
  }
  for (const name of Object.keys(tuiTokens)) assert.equal(tokens[name], tuiTokens[name], name);
  assert.deepEqual(Object.keys(tokens).sort(), Object.keys(tuiTokens).sort());
});

test("the shared files are runtime-neutral: no imports, no Node-only or Bun-only APIs (ADR-0011 cond 1)", () => {
  for (const file of ["width-core.mjs", "tokens.mjs"]) {
    const src = readFileSync(join(KIT, "zcode-proxy-src", "src", "tui", file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
    assert.doesNotMatch(src, /\bimport\b|\brequire\s*\(/, `${file} must not import anything`);
    assert.doesNotMatch(src, /\b(?:process|Bun|Deno|Buffer|globalThis|__dirname)\b/, `${file} must not use runtime-specific globals`);
  }
});
