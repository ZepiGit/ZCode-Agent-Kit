// Audit backlog: version-bound release gate — a marker for a different
// version must keep the generated package private, and the package-internal
// verifier must reject a version changed after the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, mkdirSync, symlinkSync } from "node:fs";
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
    const dist = join(KIT, "pack", "dist");
    const pkg = JSON.parse(readFileSync(join(dist, "package.json"), "utf8"));
    assert.equal(pkg.private, true, "mismatched marker version must keep the package private");
    assert.deepEqual(pkg.bin, {
      "zcode-kit": "cli/zcode-kit.mjs",
      "zcode-agent-kit": "cli/zcode-kit.mjs",
    }, "generated npm package must expose both documented CLI names");
    assert.equal(pkg.scripts.postinstall, "node setup.mjs --postinstall-hint");
    assert.match(readFileSync(join(dist, "cli", "zcode-kit.mjs"), "utf8"), /^#!\/usr\/bin\/env node/);
  } finally {
    if (existed) writeFileSync(MARKER, prev);
    else rmSync(MARKER);
  }
});

test("CLI entry guard survives npm-style path forms (casing/symlink/junction)", () => {
  // npm exposes global bins through paths that differ from the realized
  // module URL: differently-cased argv (Windows shims), symlinks (POSIX bins),
  // junctions (`npm i -g <folder>`). The entry check must canonicalize via
  // realpath or the installed CLI silently no-ops.
  const distCli = join(KIT, "pack", "dist", "cli", "zcode-kit.mjs");
  const cased = process.platform === "win32" ? distCli.replace(/^C:/i, "c:") : distCli;
  const res = spawnSync(process.execPath, [cased, "--help"], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /zcode-kit/, "CLI must answer --help through a non-canonical argv path");
  if (process.platform !== "win32") {
    const linkDir = mkdtempSync(join(tmpdir(), "zcode-entry-"));
    try {
      const link = join(linkDir, "zcode-kit");
      try {
        symlinkSync(distCli, link);
      } catch {
        return; // unprivileged sandbox without symlink rights: skip this leg
      }
      const viaLink = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8" });
      assert.equal(viaLink.status, 0, viaLink.stderr);
      assert.match(viaLink.stdout, /zcode-kit/, "CLI must answer --help through a symlinked bin");
    } finally {
      rmSync(linkDir, { recursive: true, force: true });
    }
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
