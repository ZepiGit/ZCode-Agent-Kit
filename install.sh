#!/usr/bin/env sh
# zcode-agent-kit installer (POSIX: macOS / Linux / WSL).
# See install.ps1 header for the security model: release tarball (latest
# published release by default, pin via ZCODE_KIT_VERSION (vX.Y.Z or prerelease), SHA256 verified
# against the release's checksums.txt, no admin rights.
# WSL note: the ZCode Desktop app must run on the Windows host; the proxy
# inside WSL cannot drive it — install on Windows instead (detected, refused).
set -eu

# Keep output readable in an interactive terminal while remaining plain text for
# logs, CI and callers that set NO_COLOR.
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_BOLD=$(printf '\033[1;36m'); C_RESET=$(printf '\033[0m'); C_OK=$(printf '\033[32m')
else
  C_BOLD=""; C_RESET=""; C_OK=""
fi
step() { printf '\n  %s%s%s\n' "$C_BOLD" "$1" "$C_RESET"; }
ok() { printf '  %s[OK]%s   %s\n' "$C_OK" "$C_RESET" "$1"; }
die() { printf '\n  [ERROR] %s\n' "$1" >&2; exit "${2:-1}"; }

REPO="ZepiGit/ZCode-Agent-Kit"
VERSION_PATTERN='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$'
INSTALL_DIR="${ZCODE_KIT_INSTALL_DIR:-${ZCODE_KIT_HOME:-$HOME/.local/share/zcode-agent-kit}}"

if [ -L "$INSTALL_DIR" ] || [ -e "$INSTALL_DIR/.git" ]; then
  die "refusing to overwrite a checkout (.git) or symlink install target" 2
fi
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR" ]; then
  die "install target is not a directory" 2
fi
if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR")" ]; then
  if [ ! -f "$INSTALL_DIR/cli/zcode-kit.mjs" ] || [ ! -f "$INSTALL_DIR/package.json" ] || ! grep -Eq '"name"[[:space:]]*:[[:space:]]*"zcode-agent-kit"' "$INSTALL_DIR/package.json"; then
    die "non-empty target is not a zcode-agent-kit install" 2
  fi
fi
if [ -n "${ZCODE_KIT_VERSION:-}" ] && ! printf '%s\n' "$ZCODE_KIT_VERSION" | grep -Eq "$VERSION_PATTERN"; then
  die "invalid release version; ZCODE_KIT_VERSION must be vX.Y.Z or vX.Y.Z-prerelease" 2
fi
for tool in curl tar node mktemp; do
  command -v "$tool" >/dev/null 2>&1 || { die "required tool missing: $tool" 2; }
done
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || { die "sha256sum or shasum required" 2; }
umask 077
TMP=$(mktemp -d "${TMPDIR:-/tmp}/zcode-kit-install.XXXXXX")
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

# Latest published release by default; ZCODE_KIT_VERSION pins one (recommended
# for reproducible installs). Never a branch: releases only.
if [ -n "${ZCODE_KIT_VERSION:-}" ]; then
  VERSION="$ZCODE_KIT_VERSION"
else
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
  [ -n "$VERSION" ] || { die "could not resolve the latest release (offline? rate-limited?) - pin one with ZCODE_KIT_VERSION=vX.Y.Z or vX.Y.Z-prerelease" 2; }
fi

printf '%s\n' "$VERSION" | grep -Eq "$VERSION_PATTERN" || die "invalid release version; expected vX.Y.Z or vX.Y.Z-prerelease" 2
if [ -f "$INSTALL_DIR/cli/zcode-kit.mjs" ]; then
  command -v rsync >/dev/null 2>&1 || die "rsync required for updates" 2
fi
printf '\n  %sZCODE  /  AGENT KIT%s\n' "$C_BOLD" "$C_RESET"
printf '  %s\n' "$VERSION  |  Your local AI workspace"
printf '  --------------------------------------------\n'
printf '  Install to  %s\n' "$INSTALL_DIR"
step "[1/4] Checking runtime"

case "$(uname -s)" in
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      echo "ERROR: WSL detected. The ZCode Desktop app runs on the Windows host;"
      echo "install the kit on Windows (install.ps1) and point OMP at that proxy."
      exit 2
    fi ;;
  Darwin) : ;;
  *) die "unsupported platform: $(uname -s)" 2 ;;
esac

command -v node >/dev/null 2>&1 || die "node >= 20 required (https://nodejs.org)" 2
NODE_MAJOR=$(node --version | sed 's/^v\([0-9]*\)\..*/\1/')
[ "$NODE_MAJOR" -ge 20 ] || die "node >= 20 required, found $(node --version)" 2

# Shared by Bun bootstrap and release verification, including existing Bun installs.
# Probe explicitly: `sha256sum | awk || shasum` cannot reliably fall back.
sha256_bin() {
  if command -v sha256sum >/dev/null 2>&1; then
    DIGEST_OUTPUT=$(sha256sum "$1") || return 1
  else
    DIGEST_OUTPUT=$(shasum -a 256 "$1") || return 1
  fi
  printf '%s\n' "$DIGEST_OUTPUT" | awk '{print $1}'
}

if ! command -v bun >/dev/null 2>&1; then
  printf '  Installing Bun v1.4.2 for your user...\n'
  BUN_DIR="$HOME/.bun"
  # SHA256 of the bun-v1.4.2 release artifacts (upstream SHASUMS256.txt).
  # Audit H2c: native arm64 assets so Apple Silicon / ARM Linux do not fall
  # back to x64-under-emulation.
  BUN_LINUX_X64_SHA256="36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913"
  BUN_LINUX_AARCH64_SHA256="54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7"
  BUN_DARWIN_X64_SHA256="80520d7e17526308c9185d261679ac6d27798d3803a0e9f7ff9121ab8affb012"
  BUN_DARWIN_AARCH64_SHA256="90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f"
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) BUN_ASSET="bun-linux-x64.zip"; BUN_SHA="$BUN_LINUX_X64_SHA256" ;;
    Linux-aarch64|Linux-arm64) BUN_ASSET="bun-linux-aarch64.zip"; BUN_SHA="$BUN_LINUX_AARCH64_SHA256" ;;
    Darwin-x86_64) BUN_ASSET="bun-darwin-x64.zip"; BUN_SHA="$BUN_DARWIN_X64_SHA256" ;;
    Darwin-arm64|Darwin-aarch64) BUN_ASSET="bun-darwin-aarch64.zip"; BUN_SHA="$BUN_DARWIN_AARCH64_SHA256" ;;
    *) die "unsupported architecture: $(uname -s)-$(uname -m)" 2 ;;
  esac
  BUN_URL="https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/$BUN_ASSET"
  command -v unzip >/dev/null 2>&1 || die "unzip required to install Bun" 2
  printf '  Downloading %s\n' "$BUN_ASSET"
  curl -fsSL "$BUN_URL" -o "$TMP/bun.zip" || die "Bun download failed: $BUN_URL"
  ACTUAL=$(sha256_bin "$TMP/bun.zip")
  [ "$ACTUAL" = "$BUN_SHA" ] || die "Bun download hash mismatch\n  expected $BUN_SHA\n  actual   $ACTUAL" 1
  unzip -o -q "$TMP/bun.zip" -d "$BUN_DIR" || die "could not extract Bun"
  export PATH="$BUN_DIR/${BUN_ASSET%.zip}:$PATH"
fi

BUN_BIN=$(command -v bun)
ok "Node.js and Bun available"
BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
step "[2/4] Downloading and verifying release"
curl -fsSL "$BASE_URL/$VERSION.tar.gz" -o "$TMP/kit.tar.gz" || die "release archive download failed: $BASE_URL/$VERSION.tar.gz"
curl -fsSL "$BASE_URL/checksums.txt" -o "$TMP/checksums.txt" || die "checksum download failed: $BASE_URL/checksums.txt"

EXPECTED=$(awk -v name="$VERSION.tar.gz" '$2 == name && length($1) == 64 && $1 !~ /[^0-9a-fA-F]/ { print tolower($1); n++ } END { if (n != 1) exit 1 }' "$TMP/checksums.txt") || die "checksums.txt requires exactly one valid entry for $VERSION.tar.gz" 1
ACTUAL=$(sha256_bin "$TMP/kit.tar.gz")
[ "$ACTUAL" = "$EXPECTED" ] || die "archive hash mismatch\n  expected $EXPECTED\n  actual   $ACTUAL" 1
ok "Release archive hash verified (SHA-256)"

# Extract into a dedicated subdirectory: the archive itself lives in $TMP and
# would otherwise count as a second top-level entry. Then require exactly one
# top-level directory (its name is not load-bearing; git-archive prefixes
# differ between release tooling versions).
mkdir -p "$TMP/out"
tar -xzf "$TMP/kit.tar.gz" -C "$TMP/out"
TOP_COUNT=$(find "$TMP/out" -mindepth 1 -maxdepth 1 | wc -l)
SRC=$(find "$TMP/out" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ "$TOP_COUNT" -ne 1 ] || [ -z "$SRC" ]; then
  die "unexpected archive layout" 1
fi

step "[3/4] Installing files"
mkdir -p "$INSTALL_DIR"
if [ -f "$INSTALL_DIR/cli/zcode-kit.mjs" ]; then
  command -v rsync >/dev/null 2>&1 || { echo "ERROR: rsync required to update an existing installation"; exit 2; }
  printf '  Updating existing installation; keeping your configuration.\n'
  # Excluded files are protected from --delete too (--delete-excluded is NOT
  # set): the local proxy key and user proxy/config.yaml survive updates.
  if ! rsync -a --delete --exclude '.bun-path' --exclude '.proxykey' --exclude 'config.yaml' --exclude 'node_modules' \
        --exclude 'backups' --exclude 'logs' --exclude 'generated' "$SRC/" "$INSTALL_DIR/"; then
    die "update copy failed" 1
  fi
else
  cp -R "$SRC/." "$INSTALL_DIR/"
fi

printf '%s\n' "$BUN_BIN" > "$INSTALL_DIR/.bun-path"
cd "$INSTALL_DIR"
ok "Application files installed"
step "[4/4] Configuring your workspace"
# curl | sh consumes stdin. Read answers from the controlling terminal instead.
run_setup() { node cli/zcode-kit.mjs setup --harness auto --installer; }
if [ -t 1 ] && [ -r /dev/tty ]; then
  run_setup < /dev/tty || die "setup failed; see the diagnostics above" 1
elif ! run_setup; then
  die "setup failed; see the diagnostics above" 1
fi

# User-scope `zcode-kit` command in ~/.local/bin (conventionally on PATH).
# Delete the file (or run zcode-kit uninstall) to undo.
SHIM="$HOME/.local/bin/zcode-kit"
if mkdir -p "$HOME/.local/bin" 2>/dev/null \
   && printf '#!/usr/bin/env sh\nexec node "%s/cli/zcode-kit.mjs" "$@"\n' "$INSTALL_DIR" > "$SHIM" 2>/dev/null \
   && chmod +x "$SHIM" 2>/dev/null; then
  ok "zcode-kit command installed"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) : ;;
    *) echo "  note: $HOME/.local/bin is not on your PATH - add it to use zcode-kit from anywhere" ;;
  esac
else
  echo "  note: could not create the zcode-kit shim - use: node $INSTALL_DIR/cli/zcode-kit.mjs"
fi

printf '\n  %sInstallation complete.%s\n' "$C_OK" "$C_RESET"
printf '  --------------------------------------------\n'
printf '  %-27s %s\n' 'zcode-kit auth login zai' 'Sign in / add an account'
printf '  %-27s %s\n' 'zcode-kit accounts' 'View saved accounts'
printf '  %-27s %s\n' 'zcode-kit doctor' 'Check warnings and model access'
printf '\n'
