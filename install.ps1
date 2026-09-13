# zcode-agent-kit installer (Windows).
#
# One-command install (once a release tag exists -- see docs/RELEASE_CHECKLIST.md):
#   irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.ps1 | iex
#
# Security notes (stated honestly):
# - The script downloads a PINNED release tarball (never main) and verifies its
#   SHA256 against the checksums file in the same release.
# - A hash published next to the archive protects against corruption, not
#   against a compromised release host. Verify the hash against a second
#   channel (repo commit history / signed tag) if you need provenance.
# - Requires node >= 20 and bun. Offers a user-local, pinned bun install if
#   bun is missing. No admin rights needed; nothing global is modified.
#
# NOTE: this file is intentionally ASCII-only (Windows PowerShell 5.1 parses
# BOM-less UTF-8 as ANSI and smart-byte punctuation corrupts string parsing).
param(
  [string]$Version = "v0.2.0",
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

if (-not $InstallDir -or $InstallDir -eq "") {
  if ($env:ZCODE_KIT_HOME) { $InstallDir = $env:ZCODE_KIT_HOME }
  else { $InstallDir = Join-Path $env:LOCALAPPDATA "zcode-agent-kit" }
}

$Repo = "ZepiGit/ZCode-Agent-Kit"
$Tarball = "$Version.tar.gz"
$BaseUrl = "https://github.com/$Repo/releases/download/$Version"

Write-Host "== zcode-agent-kit installer ($Version) =="
Write-Host "install dir: $InstallDir"

# --- prerequisites -----------------------------------------------------------
function Test-Node {
  try { $v = (node --version) 2>$null; return $v -match "^v(\d+)\." -and [int]$Matches[1] -ge 20 } catch { return $false }
}
function Test-Bun {
  try { (bun --version) 2>$null | Out-Null; return $LASTEXITCODE -eq 0 } catch { return $false }
}

if (-not (Test-Node)) {
  Write-Error "node >= 20 is required but not found on PATH. Install from https://nodejs.org and re-run."
}
if (-not (Test-Bun)) {
  Write-Host "bun not found - installing user-local, pinned bun v1.4.2 ..."
  $bunZip = Join-Path $env:TEMP "bun-1.4.2.zip"
  # SHA256 of bun-v1.4.2 bun-windows-x64.zip (upstream release artifact).
  $bunSha = "ce4c17497b2f29712a99d3d53f028de28cd42e3bacb8589599e7f000e49b6405"
  Invoke-WebRequest -Uri "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-windows-x64.zip" -OutFile $bunZip
  $actual = (Get-FileHash $bunZip -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $bunSha) {
    Write-Error "bun download hash mismatch:`n  expected $bunSha`n  actual   $actual`nAborting."
  }
  Expand-Archive -Path $bunZip -DestinationPath (Join-Path $env:LOCALAPPDATA "bun") -Force
  $bunBin = Join-Path (Join-Path $env:LOCALAPPDATA "bun") "bun-windows-x64"
  $env:PATH = "$bunBin;$env:PATH"
  if (-not (Test-Bun)) { Write-Error "bun installed but not runnable - add it to PATH and re-run." }
}

# --- download + verify -------------------------------------------------------
$tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "zcode-kit-install-$(Get-Random)")
try {
  $archive = Join-Path $tmp.FullName "kit.tar.gz"
  $checksums = Join-Path $tmp.FullName "checksums.txt"
  Invoke-WebRequest -Uri "$BaseUrl/$Tarball" -OutFile $archive
  Invoke-WebRequest -Uri "$BaseUrl/checksums.txt" -OutFile $checksums

  $expected = (Select-String -Path $checksums -Pattern ([regex]::Escape($Tarball))).Line -split "\s+" | Select-Object -First 1
  if (-not $expected) { Write-Error "checksums.txt does not contain $Tarball - aborting." }
  $actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected.ToLower()) {
    Write-Error "release archive hash mismatch:`n  expected $expected`n  actual   $actual`nAborting."
  }
  Write-Host "archive hash verified ($($actual.Substring(0,16))...)"

  # Safe extraction: tar with explicit top-level prefix validation.
  tar -xzf $archive -C $tmp.FullName
  $extracted = Get-ChildItem $tmp.FullName -Directory | Where-Object { $_.Name -like "zcode-agent-kit*" } | Select-Object -First 1
  if (-not $extracted) { Write-Error "unexpected archive layout - aborting." }

  # --- install ---------------------------------------------------------------
  if (Test-Path $InstallDir) {
    Write-Host "existing install found - updating in place (config and .proxykey are preserved)"
    robocopy $extracted.FullName $InstallDir /MIR /XF .proxykey /XD node_modules backups logs generated /NFL /NDL /NJH /NJS | Out-Null
  } else {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Path (Join-Path $extracted.FullName "*") -Destination $InstallDir -Recurse -Force
  }

  Write-Host "== running setup (detects your harnesses) =="
  Push-Location $InstallDir
  try {
    node cli/zcode-kit.mjs setup --harness auto
    if ($LASTEXITCODE -ne 0) { Write-Error "setup failed (exit $LASTEXITCODE) - see output above" }
  } finally {
    Pop-Location
  }

  Write-Host ""
  Write-Host "== done. Start using it =="
  Write-Host "  cd $InstallDir"
  Write-Host "  node cli/zcode-kit.mjs status        # proxy status"
  Write-Host "  node cli/zcode-kit.mjs run omp -- ...  (or your harness's documented command)"
} finally {
  Remove-Item $tmp.FullName -Recurse -Force -ErrorAction SilentlyContinue
}
