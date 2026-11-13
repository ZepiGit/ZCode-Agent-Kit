// Seam 6 under Bun: the shared width core and token set. The same
// suite runs under Node in tests/width-core.test.mjs.
import { expect, test } from "bun:test";
import * as core from "./width-core.mjs";
import * as tokens from "./tokens.mjs";
import * as widthTs from "./width.js";
import { buildFrame } from "./frame.js";
import { sharedOutputSuite, WIDTH_VECTORS } from "./__fixtures__/shared-output-suite.mjs";

sharedOutputSuite({
  test,
  equal: (actual: unknown, expected: unknown, message?: string) => {
    if (message !== undefined) expect(actual, message).toEqual(expected);
    else expect(actual).toEqual(expected);
  },
  core,
  tokens,
});

// The frames that change because of a changed grapheme class: a log row
// carrying the grapheme. `│ ` + 2-cell indent + text + padding + ` │` = 80
// cells, so the padding is 80 - 4 - 2 - (2 + width) for the text `[g]`; the
// row is padded by the class's new width, not its old one.
const changed = WIDTH_VECTORS.filter((v) => v.before !== v.width);
for (const v of changed) {
  test(`frame: a log row with ${v.cls} ${JSON.stringify(v.text)} is padded by its new width`, () => {
    const frame = buildFrame({
      version: "4.6.4", configPath: "/x/config.yaml", provider: "zai", plan: "start-plan", loggedIn: true,
      apiKeyPreview: "sk-…a1b2", loginInFlight: false, loginHint: "", serverStatus: "running",
      serverUrl: "http://127.0.0.1:18458", serverError: "", modelCount: 2, responsesEnabled: true, claimAuto: false,
      logTotal: 1, logView: [{ level: "info", text: `[${v.text}]` }], logFollowing: true, logFromBottom: 0,
      toast: null, width: 80, height: 24,
    });
    const rows = frame.text.split("\n").map((r) => core.stripAnsi(r));
    const row = rows.find((r) => r.includes(`[${v.text}]`));
    expect(row).toBe(`│   [${v.text}]${" ".repeat(72 - v.width)} │`);
    expect(72 - v.width).not.toBe(72 - v.before);
  });
}

test("width.ts re-exports the shared width core (one core for both renderers)", () => {
  expect(widthTs.displayWidth).toBe(core.displayWidth);
  expect(widthTs.truncateToWidth).toBe(core.truncateToWidth);
  expect(widthTs.padEndWidth).toBe(core.padEndWidth);
  expect(widthTs.stripAnsi).toBe(core.stripAnsi);
});
