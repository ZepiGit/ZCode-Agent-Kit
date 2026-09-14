// Installer regression proofs (audit H2): the POSIX installer must keep
// working on stock macOS (no coreutils sha256sum) and on Apple Silicon
// (native arm64 bun), and the checksum helper must actually fall back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const KIT = join(import.meta.dirname, "..");
const INSTALL = readFileSync(join(KIT, "install.sh"), "utf8");

test("install.sh verifies the release tarball through the sha256_bin helper", () => {
  assert.match(INSTALL, /ACTUAL=\$\(sha256_bin "\$TMP\/kit\.tar\.gz"\)/, "tarball checksum must use the fallback-aware helper");
  // No raw sha256sum/shasum call outside the helper definition — a raw call
  // aborts the installer on stock Darwin (H2b).
  const withoutHelper = INSTALL.replace(/sha256_bin\(\)\s*\{[\s\S]*?\n\s*\}/, "");
  assert.doesNotMatch(withoutHelper, /\$\(sha256sum/);
  assert.doesNotMatch(withoutHelper, /\$\(shasum/);
});

test("sha256_bin helper actually falls back: explicit tool probe, not an exit-status guess", () => {
  // `sha256sum | awk || shasum` never falls back: awk exits 0 on empty input,
  // so the || branch is dead on machines without sha256sum (H2b).
  assert.match(INSTALL, /command -v sha256sum/);
  assert.match(INSTALL, /shasum -a 256/);
});

test("install.sh downloads a native bun for every supported arch (H2c: Apple Silicon)", () => {
  for (const asset of ["bun-linux-x64.zip", "bun-linux-aarch64.zip", "bun-darwin-x64.zip", "bun-darwin-aarch64.zip"]) {
    assert.ok(INSTALL.includes(asset), `missing bun asset: ${asset}`);
  }
  assert.match(INSTALL, /uname -m/, "arch must be detected, not just the OS");
  // Every pinned hash is a full 64-hex SHA-256 digest.
  const shas = [...INSTALL.matchAll(/BUN_[A-Z0-9_]+_SHA256="([0-9a-f]+)"/g)].map((m) => m[1]);
  assert.ok(shas.length >= 4, `expected 4 pinned bun hashes, found ${shas.length}`);
  for (const sha of shas) assert.match(sha, /^[0-9a-f]{64}$/);
});

test("bun PATH export covers the downloaded asset dir", () => {
  assert.match(INSTALL, /BUN_ASSET%\.zip/, "PATH must include the extracted dir of the chosen asset");
});
