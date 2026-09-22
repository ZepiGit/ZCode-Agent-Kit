# zcode-agent-kit installer (Windows).
#
# One-command install (installs the LATEST published release by default; pin
# a version with $env:ZCODE_KIT_VERSION (vX.Y.Z or vX.Y.Z-prerelease) -- see docs/RELEASE_CHECKLIST.md):
#   irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
#
# This works in Windows PowerShell 5.1 and PowerShell 7+. The script takes no
# param() block on purpose: Invoke-Expression parses its input in expression
# mode, where param() is a parse error in PowerShell 7. Configuration goes
# through environment variables instead (set them in the SAME line or session):
#
#   $env:ZCODE_KIT_VERSION     = "v0.2.22-account-rotator.123.2"    # pin a stable or prerelease tag (default: latest published release)
#   $env:ZCODE_KIT_INSTALL_DIR = "D:\tools\zcode-agent-kit"            # install location
#
# Running the saved file also works and reads the same variables:
#   .\install.ps1
#
# Security notes (stated honestly):
# - The script downloads a RELEASE tarball (the latest published release by
#   default, a pinned one via ZCODE_KIT_VERSION - never a branch) and verifies
#   its SHA256 against the checksums file in the same release.
# - A hash published next to the archive protects against corruption, not
#   against a compromised release host. Verify the hash against a second
#   channel (repo commit history / signed tag) if you need provenance.
# - Requires node >= 20 and bun. Offers a user-local, pinned bun install if
#   bun is missing. No admin rights needed; nothing global is modified.
#
# NOTE: this file is intentionally ASCII-only (Windows PowerShell 5.1 parses
# BOM-less UTF-8 as ANSI and smart-byte punctuation corrupts string parsing).

& {
$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$originalPath = $env:PATH
$ProgressPreference = 'SilentlyContinue'
$useColor = -not $env:NO_COLOR -and -not [Console]::IsOutputRedirected
function Write-InstallLine([string]$Text, [string]$Color = 'Cyan') {
  if ($useColor) { Write-Host $Text -ForegroundColor $Color }
  else { Write-Host $Text }
}
function Write-InstallStep([string]$Text) { Write-Host ''; Write-InstallLine "  $Text" }
function Write-InstallOk([string]$Text) { Write-InstallLine "  [OK]   $Text" 'Green' }

$Repo = "ZepiGit/ZCode-Agent-Kit"
$VersionPattern = '^v\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
$InstallDir = ""
if ($env:ZCODE_KIT_INSTALL_DIR) { $InstallDir = $env:ZCODE_KIT_INSTALL_DIR }
elseif ($env:ZCODE_KIT_HOME) { $InstallDir = $env:ZCODE_KIT_HOME }
else { $InstallDir = Join-Path $env:LOCALAPPDATA "zcode-agent-kit" }

if (Test-Path -LiteralPath (Join-Path $InstallDir '.git')) { throw 'Refusing to overwrite a checkout (.git).' }
if (Test-Path -LiteralPath $InstallDir) {
  $target = Get-Item -LiteralPath $InstallDir -Force
  if (-not $target.PSIsContainer -or ($target.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Install target must be a directory, not a link.' }
  if (@(Get-ChildItem -LiteralPath $InstallDir -Force).Count -gt 0) {
    $package = Join-Path $InstallDir 'package.json'
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'cli\zcode-kit.mjs')) -or -not (Test-Path -LiteralPath $package)) { throw 'Non-empty target is not a zcode-agent-kit install.' }
    if ((Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).name -ne 'zcode-agent-kit') { throw 'Non-empty target is a foreign installation.' }
  }
}
if ($env:ZCODE_KIT_VERSION -and $env:ZCODE_KIT_VERSION -notmatch $VersionPattern) { throw 'Invalid release version: ZCODE_KIT_VERSION must be vX.Y.Z or vX.Y.Z-prerelease.' }
$tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "zcode-kit-install-$([guid]::NewGuid().ToString('N'))")
try {
# Latest published release by default; explicit pins are validated before download.
if ($env:ZCODE_KIT_VERSION) {
  $Version = $env:ZCODE_KIT_VERSION
} else {
  try {
    $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "zcode-agent-kit-installer" }
    $Version = $latest.tag_name
  } catch {
    throw "could not resolve the latest release from the GitHub API - pin one with `$env:ZCODE_KIT_VERSION (e.g. 'v0.2.0'). Detail: $($_.Exception.Message)"
  }
}
if ($Version -notmatch $VersionPattern) { throw 'Invalid release version returned by release metadata.' }
$Tarball = "$Version.tar.gz"
$BaseUrl = "https://github.com/$Repo/releases/download/$Version"

Write-Host ''
Write-InstallLine '  ZCODE  /  AGENT KIT'
Write-Host "  $Version  |  Your local AI workspace"
Write-Host '  --------------------------------------------'
Write-Host "  Install to  $InstallDir"
Write-InstallStep '[1/4] Checking runtime'

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
  Write-Host "  Downloading Bun v1.4.2 (bun-windows-x64.zip)..."
  $bunZip = Join-Path $tmp.FullName "bun.zip"
  # SHA256 of bun-v1.4.2 bun-windows-x64.zip (upstream release artifact).
  $bunSha = "ce4c17497b2f29712a99d3d53f028de28cd42e3bacb8589599e7f000e49b6405"
  try { Invoke-WebRequest -Uri "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-windows-x64.zip" -OutFile $bunZip } catch { throw "Bun download failed: $($_.Exception.Message)" }
  $actual = (Get-FileHash $bunZip -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $bunSha) {
    Write-Error "bun download hash mismatch:`n  expected $bunSha`n  actual   $actual`nAborting."
  }
  Expand-Archive -Path $bunZip -DestinationPath (Join-Path $env:LOCALAPPDATA "bun") -Force
  $bunBin = Join-Path (Join-Path $env:LOCALAPPDATA "bun") "bun-windows-x64"
  $env:PATH = "$bunBin;$env:PATH"
  if (-not (Test-Bun)) { Write-Error "bun installed but not runnable - add it to PATH and re-run." }
}

Write-InstallOk "Node.js and Bun available"

# --- download + verify -------------------------------------------------------
$bunExe = @(Get-Command bun -CommandType Application -ErrorAction Stop)[0].Source
  $archive = Join-Path $tmp.FullName "kit.tar.gz"
  $checksums = Join-Path $tmp.FullName "checksums.txt"
  Write-InstallStep "[2/4] Downloading and verifying release"
  try { Invoke-WebRequest -Uri "$BaseUrl/$Tarball" -OutFile $archive } catch { throw "Release archive download failed: $($_.Exception.Message)" }
  try { Invoke-WebRequest -Uri "$BaseUrl/checksums.txt" -OutFile $checksums } catch { throw "Checksum download failed: $($_.Exception.Message)" }

  $checksumPattern = '^([0-9a-fA-F]{64})\s+\*?' + [regex]::Escape($Tarball) + '$'
  $checksumLines = @(Get-Content -LiteralPath $checksums | Where-Object { $_ -match $checksumPattern })
  if ($checksumLines.Count -ne 1) { throw "checksums.txt must contain exactly one valid entry for $Tarball" }
  $expected = [regex]::Match($checksumLines[0], $checksumPattern).Groups[1].Value
  $actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $expected.ToLower()) {
    Write-Error "release archive hash mismatch:`n  expected $expected`n  actual   $actual`nAborting."
  }
  Write-InstallOk "Release archive hash verified (SHA-256)"

  # Safe extraction: tar with a structural check -- the archive must contain
  # exactly ONE top-level directory (its name is not load-bearing; git-archive
  # prefixes differ between release tooling versions). Use the explicit
  # Windows tar: a GNU tar earlier on PATH (e.g. Git Bash) would mis-parse
  # `-C C:\...` as a remote-host path ("Cannot connect to C:"). Extract into a
  # dedicated subdirectory: the archive itself lives in $tmp and would
  # otherwise count as a second top-level entry.
  $outDir = New-Item -ItemType Directory -Path (Join-Path $tmp.FullName "out")
  $tarExe = Join-Path $env:SystemRoot "System32\tar.exe"
  if (-not (Test-Path $tarExe)) { $tarExe = "tar" }
  & $tarExe -xzf $archive -C $outDir.FullName
  if ($LASTEXITCODE -ne 0) { Write-Error "archive extraction failed (tar exit $LASTEXITCODE) - aborting." }
  $top = @(Get-ChildItem $outDir.FullName -Force)
  if ($top.Count -ne 1 -or -not $top[0].PSIsContainer) {
    Write-Error "unexpected archive layout - aborting."
  }
  $extracted = $top[0]

  Write-InstallStep "[3/4] Installing files"
  # --- install ---------------------------------------------------------------
  # /XF keeps machine-local runtime state across updates: the local proxy key
  # and proxy/config.yaml (user settings) are never overwritten or deleted by
  # the mirror; node_modules/backups/logs/generated are rebuilt or kept.
  if (Test-Path -LiteralPath $InstallDir) {
    Write-Host "  Updating existing installation; keeping your configuration."
    robocopy $extracted.FullName $InstallDir /MIR /XJ /XF .proxykey config.yaml .bun-path /XD node_modules backups logs generated /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "update copy failed (robocopy exit $LASTEXITCODE) - aborting." }
  } else {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Path (Join-Path $extracted.FullName "*") -Destination $InstallDir -Recurse -Force
  }

  [IO.File]::WriteAllText((Join-Path $InstallDir '.bun-path'), $bunExe, (New-Object System.Text.UTF8Encoding($false)))
  Write-InstallOk "Application files installed"
  Write-InstallStep "[4/4] Configuring your workspace"
  Push-Location $InstallDir
  try {
    node cli/zcode-kit.mjs setup --harness auto --installer
    if ($LASTEXITCODE -ne 0) { throw "setup failed (exit $LASTEXITCODE) - see output above" }
  } finally {
    Pop-Location
  }

  # User-scope `zcode-kit` command: %LOCALAPPDATA%\Microsoft\WindowsApps is on
  # the user PATH by default; writing the shim there needs no admin rights and
  # no PATH changes. Delete the file (or run zcode-kit uninstall) to undo.
  $shim = Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\zcode-kit.cmd"
  try {
    New-Item -ItemType Directory -Path (Split-Path $shim -Parent) -Force | Out-Null
    $launcher = Join-Path (Split-Path $shim -Parent) 'zcode-kit.ps1'
    $entry = (Join-Path $InstallDir 'cli\zcode-kit.mjs').Replace("'", "''")
    [IO.File]::WriteAllText($launcher, "& node '$entry' @args`r`nexit `$LASTEXITCODE`r`n", (New-Object System.Text.UTF8Encoding($true)))
    Set-Content -LiteralPath $shim -Value '@echo off', 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0zcode-kit.ps1" %*', 'exit /b %errorlevel%' -Encoding Ascii
    Write-InstallOk "zcode-kit command installed"
  } catch {
    Write-Host "  note: could not create the zcode-kit shim ($($_.Exception.Message))"
  }

  Write-Host ""
  Write-InstallLine '  Installation complete.' 'Green'
  Write-Host '  --------------------------------------------'
  Write-Host '  zcode-kit auth login zai    Sign in / add an account'
  Write-Host '  zcode-kit accounts          View saved accounts'
  Write-Host '  zcode-kit doctor            Check warnings and model access'
  Write-Host ''
} finally {
  $env:PATH = $originalPath
  Remove-Item -LiteralPath $tmp.FullName -Recurse -Force -ErrorAction SilentlyContinue
}
}
