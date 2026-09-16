// Installer regression proofs (audit H2): the POSIX installer must keep
// working on stock macOS (no coreutils sha256sum) and on Apple Silicon
// (native arm64 bun), and the checksum helper must actually fall back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KIT = join(import.meta.dirname, "..");
const INSTALL = readFileSync(join(KIT, "install.sh"), "utf8");
const INSTALL_PS1 = readFileSync(join(KIT, "install.ps1"), "utf8");

for (const validChecksum of [true, false]) {
  test(`existing Bun installer ${validChecksum ? "verifies and installs" : "rejects a corrupt archive before extraction"}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-installer-"));
    const bin = join(dir, "bin");
    const home = join(dir, "home");
    const install = join(home, "kit");
    const hash = createHash("sha256").update("fixture archive\n").digest("hex");
    const script = (name, body) => writeFileSync(join(bin, name), `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 });
    try {
      mkdirSync(bin);
      mkdirSync(home);
      script("uname", "printf 'Darwin\\n'");
      script("bun", "exit 0");
      script("curl", `case "$2" in
  */v1.2.3.tar.gz) printf 'fixture archive\\n' > "$4" ;;
  */checksums.txt) printf '${validChecksum ? hash : "0".repeat(64)}  v1.2.3.tar.gz\\n' > "$4" ;;
  *) exit 91 ;;
esac`);
      // Extraction and setup are the only install side effects mocked. Hashing
      // and the installer control flow execute for real, entirely under tmp.
      script("tar", `mkdir -p "$4/kit/cli"
printf 'fixture cli\\n' > "$4/kit/cli/zcode-kit.mjs"`);
      script("node", `if [ "$1" = "--version" ]; then printf 'v20.19.0\\n'; else
  [ "$1" = "cli/zcode-kit.mjs" ] && [ "$2" = "setup" ] && [ "$3" = "--harness" ] && [ "$4" = "auto" ]
  printf 'setup completed\\n' > setup-ran
fi`);
      const res = spawnSync("sh", ["-c", `
if command -v cygpath >/dev/null 2>&1; then
  FIXTURE_BIN=$(cygpath -u "$FIXTURE_BIN")
  HOME=$(cygpath -u "$HOME")
  ZCODE_KIT_INSTALL_DIR=$(cygpath -u "$ZCODE_KIT_INSTALL_DIR")
  set -- "$(cygpath -u "$1")"
fi
export HOME ZCODE_KIT_INSTALL_DIR
export PATH="$FIXTURE_BIN:$PATH"
exec sh "$1"
`, "fixture", join(KIT, "install.sh")], {
        encoding: "utf8", timeout: 15_000,
        env: { ...process.env, FIXTURE_BIN: bin, HOME: home,
          ZCODE_KIT_INSTALL_DIR: install, ZCODE_KIT_VERSION: "v1.2.3" },
      });
      assert.equal(res.status, validChecksum ? 0 : 1, `${res.stdout}\n${res.stderr}`);
      if (validChecksum) {
        assert.match(res.stdout, /archive hash verified/);
        assert.equal(readFileSync(join(install, "setup-ran"), "utf8"), "setup completed\n");
        assert.ok(existsSync(join(home, ".local", "bin", "zcode-kit")));
      } else {
        assert.match(res.stdout, /archive hash mismatch/);
        assert.equal(existsSync(install), false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

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

test("installers resolve the latest release by default and keep the pin override", () => {
  for (const [name, src] of [["install.sh", INSTALL], ["install.ps1", INSTALL_PS1]]) {
    assert.ok(/api\.github\.com|releases\/latest/.test(src), `${name} must resolve the latest published release`);
    assert.ok(src.includes("ZCODE_KIT_VERSION"), `${name} must keep the ZCODE_KIT_VERSION pin override`);
    assert.doesNotMatch(src, /:-\s*v0\.2\.0/, `${name} must not hardcode a version default (sh form)`);
    assert.doesNotMatch(src, /else\s*\{\s*"v0\.2\.0"\s*\}/, `${name} must not hardcode a version default (ps1 form)`);
  }
});

test("bun PATH export covers the downloaded asset dir", () => {
  assert.match(INSTALL, /BUN_ASSET%\.zip/, "PATH must include the extracted dir of the chosen asset");
});
