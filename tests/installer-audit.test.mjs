import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KIT = join(import.meta.dirname, "..");
const INSTALL_SH = join(KIT, "install.sh");
const INSTALL_PS1 = join(KIT, "install.ps1");

function executable(path, body) {
  writeFileSync(path, `#!/bin/sh\nset -eu\n${body}\n`);
  chmodSync(path, 0o755);
}

function runSh({ bin, home, install, temp, log, version = "v1.2.3" }) {
  return spawnSync("sh", ["-c", `
if command -v cygpath >/dev/null 2>&1; then
  FIXTURE_BIN=$(cygpath -u "$FIXTURE_BIN")
  HOME=$(cygpath -u "$HOME")
  ZCODE_KIT_INSTALL_DIR=$(cygpath -u "$ZCODE_KIT_INSTALL_DIR")
  TMPDIR=$(cygpath -u "$TMPDIR")
  AUDIT_LOG=$(cygpath -u "$AUDIT_LOG")
  set -- "$(cygpath -u "$1")"
fi
export HOME ZCODE_KIT_INSTALL_DIR TMPDIR AUDIT_LOG ZCODE_KIT_VERSION
export PATH="$FIXTURE_BIN:/usr/bin:/bin"
exec sh "$1"
`, "installer-audit", INSTALL_SH], {
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...process.env,
      FIXTURE_BIN: bin,
      HOME: home,
      ZCODE_KIT_INSTALL_DIR: install,
      TMPDIR: temp,
      AUDIT_LOG: log,
      ZCODE_KIT_VERSION: version,
    },
  });
}

for (const targetKind of ["foreign", "checkout"]) {
  test(`install.sh refuses a non-kit ${targetKind} target before any download`, () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-installer-guard-"));
    const bin = join(root, "bin");
    const home = join(root, "home");
    const install = join(root, "target");
    const temp = join(root, "tmp");
    const log = join(root, "curl.log");
    try {
      for (const dir of [bin, home, install, temp]) mkdirSync(dir, { recursive: true });
      writeFileSync(join(install, "foreign.txt"), "preserve me\n");
      if (targetKind === "checkout") {
        mkdirSync(join(install, ".git"));
        mkdirSync(join(install, "cli"));
        writeFileSync(join(install, "cli", "zcode-kit.mjs"), "// fixture\n");
        writeFileSync(join(install, "package.json"), JSON.stringify({ name: "zcode-agent-kit" }));
      }
      executable(join(bin, "curl"), `printf 'called\\n' >> "$AUDIT_LOG"; exit 90`);
      executable(join(bin, "node"), `if [ "\${1}" = --version ]; then printf 'v20.19.0\\n'; else exit 0; fi`);
      executable(join(bin, "uname"), `if [ "\${1:-}" = -m ]; then printf 'arm64\\n'; else printf 'Darwin\\n'; fi`);
      executable(join(bin, "bun"), "exit 0");

      const result = runSh({ bin, home, install, temp, log });
      assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(existsSync(log), false, "guard must run before any curl invocation");
      assert.equal(readFileSync(join(install, "foreign.txt"), "utf8"), "preserve me\n");
      if (targetKind === "checkout") assert.ok(existsSync(join(install, ".git")));
      assert.match(`${result.stdout}\n${result.stderr}`, targetKind === "checkout" ? /checkout|\.git/i : /not a zcode-agent-kit install|foreign|non-empty/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("install.sh validates an explicit version before downloading", () => {
  const root = mkdtempSync(join(tmpdir(), "zcode-installer-version-"));
  const bin = join(root, "bin");
  const home = join(root, "home");
  const install = join(root, "target");
  const temp = join(root, "tmp");
  const log = join(root, "curl.log");
  try {
    for (const dir of [bin, home, temp]) mkdirSync(dir, { recursive: true });
    executable(join(bin, "curl"), `printf 'called\\n' >> "$AUDIT_LOG"; exit 90`);
    executable(join(bin, "node"), `printf 'v20.19.0\\n'`);
    executable(join(bin, "uname"), `printf 'Darwin\\n'`);
    executable(join(bin, "bun"), "exit 0");
    const result = runSh({ bin, home, install, temp, log, version: "1.2.3" });
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.equal(existsSync(log), false);
    assert.match(`${result.stdout}\n${result.stderr}`, /ZCODE_KIT_VERSION.*vX\.Y\.Z|invalid release version/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install.sh bootstraps Bun in its private temp, persists .bun-path, and accepts setup warnings with exit 0", () => {
  const root = mkdtempSync(join(tmpdir(), "zcode-installer-bun-"));
  const bin = join(root, "bin");
  const home = join(root, "home");
  const install = join(root, "target");
  const temp = join(root, "tmp");
  const log = join(root, "curl.log");
  const releaseSha = "b".repeat(64);
  const bunSha = "90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f";
  try {
    for (const dir of [bin, home, temp]) mkdirSync(dir, { recursive: true });
    executable(join(bin, "uname"), `if [ "\${1:-}" = -m ]; then printf 'arm64\\n'; else printf 'Darwin\\n'; fi`);
    executable(join(bin, "node"), `if [ "\${1:-}" = --version ]; then
  printf 'v20.19.0\\n'
else
  [ "\${1:-}" = cli/zcode-kit.mjs ] || exit 81
  [ "\${2:-}" = setup ] || exit 82
  printf 'WARN: optional configuration skipped\\n'
  printf 'setup completed\\n' > setup-ran
fi`);
    executable(join(bin, "curl"), `out=''; url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s|%s\\n' "$url" "$out" >> "$AUDIT_LOG"
case "$url" in
  *bun-darwin-aarch64.zip) printf 'bun archive\\n' > "$out" ;;
  */v1.2.3.tar.gz) printf 'kit archive\\n' > "$out" ;;
  */checksums.txt) printf '${releaseSha}  v1.2.3.tar.gz\\n' > "$out" ;;
  *) exit 83 ;;
esac`);
    executable(join(bin, "sha256sum"), `case "$1" in
  *bun.zip) printf '${bunSha}  %s\\n' "$1" ;;
  *kit.tar.gz) printf '${releaseSha}  %s\\n' "$1" ;;
  *) exit 84 ;;
esac`);
    executable(join(bin, "unzip"), `dest=''
while [ "$#" -gt 0 ]; do [ "$1" = -d ] && { dest="$2"; break; }; shift; done
mkdir -p "$dest/bun-darwin-aarch64"
printf '#!/bin/sh\\nprintf "1.4.2\\\\n"\\n' > "$dest/bun-darwin-aarch64/bun"
chmod +x "$dest/bun-darwin-aarch64/bun"`);
    executable(join(bin, "tar"), `out=''
while [ "$#" -gt 0 ]; do [ "$1" = -C ] && { out="$2"; break; }; shift; done
mkdir -p "$out/kit/cli"
printf '{"name":"zcode-agent-kit"}\\n' > "$out/kit/package.json"
printf '// fixture\\n' > "$out/kit/cli/zcode-kit.mjs"`);

    const result = runSh({ bin, home, install, temp, log });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /WARN: optional configuration skipped/);
    assert.equal(readFileSync(join(install, "setup-ran"), "utf8"), "setup completed\n");
    const bunPath = readFileSync(join(install, ".bun-path"), "utf8").trim();
    assert.match(bunPath.replace(/\\/g, "/"), /\/home\/\.bun\/bun-darwin-aarch64\/bun$/);
    const downloads = readFileSync(log, "utf8").trim().split(/\r?\n/);
    const bunDownload = downloads.find((line) => line.includes("bun-darwin-aarch64.zip"));
    assert.ok(bunDownload, "Bun download must occur");
    const bunTarget = bunDownload.split("|")[1];
    assert.notEqual(bunTarget, "/tmp/bun.zip");
    assert.match(bunTarget, /zcode-kit-install\.[^/]+\/bun\.zip$/);
    assert.deepEqual(readdirSync(temp), [], "private per-run temp must be removed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("install.ps1 executes hermetically with mocked downloads/setup and writes a Unicode-safe shim", { skip: process.platform !== "win32" }, (t) => {
  const probe = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" });
  if (probe.status !== 0) return t.skip("pwsh is unavailable");
  const root = mkdtempSync(join(tmpdir(), "zcode-installer-ps-"));
  const bin = join(root, "bin");
  const local = join(root, "Jörg 100%sure (x86)", "Local AppData");
  const install = join(root, "Jörg 100%sure (x86)", "kit");
  const temp = join(root, "temp");
  const fakeSystem = join(root, "system");
  const wrapper = join(root, "fixture.ps1");
  const archive = "fixture archive\n";
  const hash = createHash("sha256").update(archive).digest("hex");
  try {
    for (const dir of [bin, local, temp, fakeSystem]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(bin, "node.cmd"), "@echo off\r\nif \"%~1\"==\"--version\" (echo v20.19.0& exit /b 0)\r\necho WARN: optional configuration skipped\r\necho setup completed>setup-ran\r\nexit /b 0\r\n");
    writeFileSync(join(bin, "bun.cmd"), "@echo off\r\necho 1.4.2\r\nexit /b 0\r\n");
    writeFileSync(wrapper, `param([string]$Installer)
$ErrorActionPreference = 'Continue'
$beforePath = $env:PATH
function Invoke-WebRequest {
  param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  if ($Uri -like '*/v1.2.3.tar.gz') { [IO.File]::WriteAllText($OutFile, "fixture archive\n", $utf8); return }
  if ($Uri -like '*/checksums.txt') { [IO.File]::WriteAllText($OutFile, '${hash}  v1.2.3.tar.gz' + "\n", $utf8); return }
  throw "unexpected URL $Uri"
}
function node {
  if ($args[0] -eq '--version') { 'v20.19.0'; $global:LASTEXITCODE = 0; return }
  if ($args[0] -ne 'cli/zcode-kit.mjs' -or $args[1] -ne 'setup') { throw 'unexpected node invocation' }
  'WARN: optional configuration skipped'
  [IO.File]::WriteAllText((Join-Path (Get-Location) 'setup-ran'), 'setup completed')
  $global:LASTEXITCODE = 0
}
function bun { '1.4.2'; $global:LASTEXITCODE = 0 }
function tar {
  $idx = [Array]::IndexOf($args, '-C')
  if ($idx -lt 0) { $global:LASTEXITCODE = 91; return }
  $out = $args[$idx + 1]
  New-Item -ItemType Directory -Path (Join-Path $out 'kit\\cli') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $out 'kit\\package.json'), '{"name":"zcode-agent-kit"}')
  [IO.File]::WriteAllText((Join-Path $out 'kit\\cli\\zcode-kit.mjs'), '// fixture')
  $global:LASTEXITCODE = 0
}
$env:LOCALAPPDATA = '${local.replaceAll("'", "''")}'
$env:TEMP = '${temp.replaceAll("'", "''")}'
$env:SystemRoot = '${fakeSystem.replaceAll("'", "''")}'
$env:ZCODE_KIT_INSTALL_DIR = '${install.replaceAll("'", "''")}'
$env:ZCODE_KIT_VERSION = 'v1.2.3'
$env:PATH = '${bin.replaceAll("'", "''")};' + $env:PATH
& $Installer
$rc = if ($LASTEXITCODE -is [int]) { $LASTEXITCODE } else { 0 }
Write-Output "SCOPE_EAP=$ErrorActionPreference"
Write-Output "PATH_RESTORED=$([bool]($env:PATH -eq ('${bin.replaceAll("'", "''")};' + $beforePath)))"
exit $rc
`, "utf8");

    const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", wrapper, INSTALL_PS1], { encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /SCOPE_EAP=Continue/);
    assert.match(result.stdout, /PATH_RESTORED=True/);
    assert.equal(readFileSync(join(install, "setup-ran"), "utf8").trim(), "setup completed");
    assert.equal(readFileSync(join(install, ".bun-path"), "utf8").trim().toLowerCase(), join(bin, "bun.cmd").toLowerCase());
    const cmd = readFileSync(join(local, "Microsoft", "WindowsApps", "zcode-kit.cmd"), "ascii");
    assert.doesNotMatch(cmd, /Jörg|100%sure|x86/);
    assert.match(cmd, /zcode-kit\.ps1/);
    const ps1 = readFileSync(join(local, "Microsoft", "WindowsApps", "zcode-kit.ps1"), "utf8");
    assert.ok(ps1.includes(join(install, "cli", "zcode-kit.mjs")), "UTF-8 launcher must retain the exact install path");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
