// JSON key/type superset (spec §18 COMPATIBILITY, Story 123; seam 5): every
// `--json` output of the current tree keeps every key name and value type of
// the baseline captured once from the pre-change code
// (tests/ux-before/json-baseline.json), and its exit code. Keys may only be added.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASELINE_FILE, JSON_OUTPUTS, buildBaseline, checkSuperset, parseCapture, shapeOf } from "./ux-before/json-shapes.mjs";

const ROOT = join(import.meta.dirname, "..");
const baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));

test("superset rule: added keys and elements pass; a removed key, a changed type or a new type fails", () => {
  const shape = shapeOf({ ok: true, failed: 0, checks: [{ name: "a", ok: true, detail: "x" }, { name: "b", ok: false }], note: null });
  assert.deepEqual(checkSuperset(shape, { ok: true, failed: 1, checks: [{ name: "a", ok: true, status: "warn" }], note: null, extra: 1 }), []);
  assert.deepEqual(checkSuperset(shape, { ok: true, failed: 0, checks: [], note: "now a string" }), [], "an empty array and a null-only position constrain nothing");
  assert.deepEqual(checkSuperset(shape, { ok: true, checks: [], note: null }), ["$.failed: missing"]);
  assert.deepEqual(checkSuperset(shape, { ok: "yes", failed: 0, checks: [], note: null }), ["$.ok: type string, baseline boolean"]);
  assert.deepEqual(checkSuperset(shape, { ok: true, failed: 0, checks: [{ ok: true }], note: null }), ["$.checks[0].name: missing"]);
  assert.deepEqual(checkSuperset(shape, { ok: true, failed: 0, checks: [{ name: 1, ok: true }], note: null }), ["$.checks[0].name: type number, baseline string"]);
  assert.deepEqual(checkSuperset(shape, { ok: true, failed: 0, checks: [{ name: "c", ok: true }], note: null }), [], "detail was optional across elements");
  assert.deepEqual(checkSuperset(shape, [1, 2]), ["$: type array, baseline object"]);
});

test("the committed baseline is exactly what the pre-change captures give (never edited by hand)", () => {
  assert.deepEqual(baseline, buildBaseline());
  assert.deepEqual(Object.keys(baseline.outputs).sort(), Object.keys(JSON_OUTPUTS).sort(), "every --json output has a baseline");
});

test("every --json output of this tree is a key/type superset of the baseline, with the same exit code", {
  timeout: 10 * 60_000,
  skip: process.platform === "win32" ? "the live capture's Windows run is proven in the ux-before CI job first (ticket 06 Comments)" : false,
}, (t) => {
  const out = mkdtempSync(join(tmpdir(), "json-superset-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [join(ROOT, "tests", "ux-before", "capture", "capture.mjs"), "--kit", ROOT, "--out", out,
    "--extra", "json", "--only", "json|auth-status", "--variants", "pipe"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 9 * 60_000 });
  assert.equal(run.status, 0, `capture failed:\n${(run.stdout + run.stderr).slice(-3000)}`);
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  const problems = [];
  for (const [capture, base] of Object.entries(baseline.outputs)) {
    const m = manifest.find((x) => `${x.group}/${x.id}` === capture);
    if (!m || m.error) { problems.push(`${base.command}: not captured (${m?.error ?? "missing"})`); continue; }
    if (m.exit !== base.exit) problems.push(`${base.command}: exit ${m.exit}, baseline ${base.exit}`);
    let doc;
    try { doc = parseCapture(readFileSync(join(out, capture, "pipe.txt"), "utf8")); } catch (err) { problems.push(`${base.command}: not one JSON document (${err.message})`); continue; }
    for (const e of checkSuperset(base.shape, doc)) problems.push(`${base.command}: ${e}`);
  }
  assert.deepEqual(problems, []);
});
