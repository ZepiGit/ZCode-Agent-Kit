/**
 * The bridge's event lines (src/util/event-line.ts) are the kit's
 * event-line format (lib/event-line.mjs): the same input gives the
 * same line, redaction included.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEventLine, redactLine } from "../../dist/util/event-line.js";
import * as kit from "../../../../lib/event-line.mjs";

const time = new Date("2026-11-09T10:00:00.000Z");
const VECTORS = [
  { level: "WARN", component: "runtime", message: "harness restart", fields: { restart: 1, budget: 3, windowSec: 900, backoffMs: 1000, lastExitCode: 7, lastExitSignal: undefined } },
  { level: "ERROR", component: "runtime", message: "harness restart budget exhausted", fields: { restarts: 3, windowSec: 900, retryAt: "2026-11-09T10:15:00.000Z", lastExitCode: null } },
  { level: "INFO", component: "a b", message: "two\nlines\u2028here", fields: { "k=v": "x y", quote: 'a"b\\c', empty: "", obj: { a: [1, 2] }, err: new Error("boom") } },
  { level: "DEBUG", component: "runtime", message: "Bearer abcdefghijklmnop sk-0123456789abcdefABCD", fields: { apiKey: "short", stopToken: "x", inputTokens: 12, key: "k", path: "C:\\Users\\a b\\x", uuid: "123e4567-e89b-12d3-a456-426614174000" } },
  { level: "WARN", component: "runtime", message: "opaque Zx9aQ2mB7cD4eF6gH8iJ0kL1nP3rS5tU7vW", fields: { jwt: "eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl", known: "my-known-secret-value" }, secrets: ["my-known-secret-value"] },
];

test("the bridge formats every event line byte-identically to lib/event-line.mjs", () => {
  for (const v of VECTORS) {
    assert.equal(formatEventLine({ time, ...v }), kit.formatEventLine({ time, ...v }), JSON.stringify(v.message));
  }
  assert.equal(formatEventLine({ time, ...VECTORS[0] }), "2026-11-09T10:00:00.000Z WARN runtime harness restart restart=1 budget=3 windowSec=900 backoffMs=1000 lastExitCode=7");
});

test("the bridge redacts lines like lib/event-line.mjs and rejects unknown levels", () => {
  for (const line of ['{"level":"warn","msg":"tool failed"}', "Authorization: Basic dXNlcjpwYXNzd29yZA==", "no secret here"]) {
    assert.equal(redactLine(line), kit.redactLine(line));
  }
  assert.throws(() => formatEventLine({ time, level: "NOTICE", component: "x", message: "m" }), /unknown level/);
});
