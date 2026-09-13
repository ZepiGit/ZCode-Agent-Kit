// Audit backlog: version-bound release gate — a marker for a different
// version must keep the generated package private, and the package-internal
// verifier must reject a version changed after the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KIT = join(import.meta.dirname, "..");
const MARKER = join(KIT, "pack", "ALLOW_PUBLISH");

test("pack build keeps the generated package private when the marker names another version", () => {
  const existed = existsSync(MARKER);
  const prev = existed ? readFileSync(MARKER, "utf8") : null;
  writeFileSync(MARKER, "9.9.9\n"); // a version that is NOT the repo version
  try {
    const res = spawnSync(process.execPath, [join(KIT, "pack", "build.mjs")], { encoding: "utf8" });
    assert.equal(res.status, 0, `build should succeed (stderr: ${res.stderr})`);
    const pkg = JSON.parse(readFileSync(join(KIT, "pack", "dist", "package.json"), "utf8"));
    assert.equal(pkg.private, true, "mismatched marker version must keep the package private");
  } finally {
    if (existed) writeFileSync(MARKER, prev);
    else rmSync(MARKER);
  }
});

test("verify-release-marker rejects a version changed after the build", () => {
  const dir = mkdtempSync(join(tmpdir(), "zcode-marker-"));
  try {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    copyFileSync(join(KIT, "scripts", "verify-release-marker.mjs"), join(dir, "scripts", "verify-release-marker.mjs"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fake", version: "1.0.0" }));
    writeFileSync(join(dir, "ALLOW_PUBLISH"), "1.0.0\n");

    const ok = spawnSync(process.execPath, [join(dir, "scripts", "verify-release-marker.mjs")], { encoding: "utf8" });
    assert.equal(ok.status, 0, `matching version must pass (${ok.stderr})`);

    // the version changed after the build — the shipped marker no longer
    // names it, and a normal publish lifecycle must fail closed
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fake", version: "2.0.0" }));
    const bad = spawnSync(process.execPath, [join(dir, "scripts", "verify-release-marker.mjs")], { encoding: "utf8" });
    assert.equal(bad.status, 1, "changed version must be rejected");
    assert.match(bad.stderr, /2\.0\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
