// Output equivalence: the capture tool (tests/ux-before/capture/) is run
// against this checkout and every capture is compared byte for byte with the
// committed baseline, ANSI included, after the explicit run-to-run
// normalisation of tests/ux-before/compare.mjs. Exit codes are compared too.
// A change to any command's output therefore has to arrive together with the
// refreshed baseline files.
//
//   linux:   all seven variants (pty via `script`) against tests/ux-before/linux/
//   windows: the pipe and ci variants against tests/ux-before/windows/
// UX_BEFORE_BASELINE=<dir> compares against another baseline;
// UX_BEFORE_OUT=<dir> keeps the fresh capture there for inspection.
//
// Slow (about 8 minutes on Linux): wired as `npm run test:ux-before` and run by
// the `ux-before` CI job, not by `npm run test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareCaptures } from "./ux-before/compare.mjs";

const ROOT = join(import.meta.dirname, "..");
const IS_WIN = process.platform === "win32";
const VARIANTS = IS_WIN ? ["pipe", "ci"] : ["tty-color-80", "tty-color-120", "no-color", "term-dumb", "ascii-locale", "pipe", "ci"];
const BASELINE = process.env.UX_BEFORE_BASELINE ?? join(ROOT, "tests", "ux-before", IS_WIN ? "windows" : "linux");

test(`every capture matches the baseline byte for byte (${VARIANTS.join(", ")})`, {
  timeout: 45 * 60_000,
  skip: process.platform === "darwin" ? "the capture's pty runner is util-linux `script`; macOS is an owner action" : false,
}, (t) => {
  assert.ok(existsSync(join(BASELINE, "manifest.json")),
    `no baseline at ${BASELINE}: capture one with ` +
    "`node tests/ux-before/capture/capture.mjs --kit <kit checkout> --out <dir>` and set UX_BEFORE_BASELINE");
  // UX_BEFORE_OUT keeps the fresh capture (CI uploads it when this test fails).
  const out = process.env.UX_BEFORE_OUT || mkdtempSync(join(tmpdir(), "ux-before-now-"));
  if (!process.env.UX_BEFORE_OUT) t.after(() => rmSync(out, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [join(ROOT, "tests", "ux-before", "capture", "capture.mjs"), "--kit", ROOT, "--out", out, "--variants", VARIANTS.join(",")], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 40 * 60_000,
  });
  assert.equal(run.status, 0, `capture failed (status ${run.status}, signal ${run.signal}):\n${(run.stdout + run.stderr).slice(-4000)}`);
  const diffs = compareCaptures(BASELINE, out, { variants: VARIANTS });
  assert.deepEqual(diffs, [], `${diffs.length} capture(s) differ from the baseline:\n${diffs.slice(0, 40).join("\n")}`);
});
