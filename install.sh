#!/usr/bin/env sh
# zcode-agent-kit installer (POSIX: macOS / Linux / WSL).
# See install.ps1 header for the security model: release tarball (latest
# published release by default, pin via ZCODE_KIT_VERSION), SHA256 verified
# against the release's checksums.txt, no admin rights.
# WSL note: the ZCode Desktop app must run on the Windows host; the proxy
# inside WSL cannot drive it — install on Windows instead (detected, refused).
set -eu

REPO="ZepiGit/ZCode-Agent-Kit"
INSTALL_DIR="${ZCODE_KIT_INSTALL_DIR:-${ZCODE_KIT_HOME:-$HOME/.local/share/zcode-agent-kit}}"

if [ -L "$INSTALL_DIR" ] || [ -e "$INSTALL_DIR/.git" ]; then
  echo "ERROR: refusing to overwrite a checkout (.git) or symlink install target"; exit 2
fi
if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR" ]; then
  echo "ERROR: install target is not a directory"; exit 2
fi
if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR")" ]; then
  if [ ! -f "$INSTALL_DIR/cli/zcode-kit.mjs" ] || [ ! -f "$INSTALL_DIR/package.json" ] || ! grep -Eq '"name"[[:space:]]*:[[:space:]]*"zcode-agent-kit"' "$INSTALL_DIR/package.json"; then
    echo "ERROR: non-empty target is not a zcode-agent-kit install"; exit 2
  fi
fi
if [ -n "${ZCODE_KIT_VERSION:-}" ] && ! printf '%s\n' "$ZCODE_KIT_VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "ERROR: invalid release version; ZCODE_KIT_VERSION must be vX.Y.Z"; exit 2
fi
for tool in curl tar node mktemp; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ERROR: required tool missing: $tool"; exit 2; }
done
command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 || { echo "ERROR: sha256sum or shasum required"; exit 2; }
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
  [ -n "$VERSION" ] || { echo "ERROR: could not resolve the latest release (offline? rate-limited?) - pin one with ZCODE_KIT_VERSION=vX.Y.Z"; exit 2; }
fi

printf '%s\n' "$VERSION" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || { echo "ERROR: invalid release version"; exit 2; }
if [ -f "$INSTALL_DIR/cli/zcode-kit.mjs" ]; then
  command -v rsync >/dev/null 2>&1 || { echo "ERROR: rsync required for updates"; exit 2; }
fi
echo "== zcode-agent-kit installer ($VERSION) =="
echo "install dir: $INSTALL_DIR"

case "$(uname -s)" in
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      echo "ERROR: WSL detected. The ZCode Desktop app runs on the Windows host;"
      echo "install the kit on Windows (install.ps1) and point OMP at that proxy."
      exit 2
    fi ;;
  Darwin) : ;;
  *) echo "ERROR: unsupported platform: $(uname -s)" && exit 2 ;;
esac

command -v node >/dev/null 2>&1 || { echo "ERROR: node >= 20 required (https://nodejs.org)"; exit 2; }
NODE_MAJOR=$(node --version | sed 's/^v\([0-9]*\)\..*/\1/')
[ "$NODE_MAJOR" -ge 20 ] || { echo "ERROR: node >= 20 required, found $(node --version)"; exit 2; }

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
  echo "bun not found — installing user-local, pinned bun v1.4.2 ..."
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
    *) echo "ERROR: unsupported architecture: $(uname -s)-$(uname -m)"; exit 2 ;;
  esac
  BUN_URL="https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/$BUN_ASSET"
  command -v unzip >/dev/null 2>&1 || { echo "ERROR: unzip required to install Bun"; exit 2; }
  curl -fsSL "$BUN_URL" -o "$TMP/bun.zip"
  ACTUAL=$(sha256_bin "$TMP/bun.zip")
  [ "$ACTUAL" = "$BUN_SHA" ] || { echo "ERROR: bun download hash mismatch\n  expected $BUN_SHA\n  actual   $ACTUAL"; exit 1; }
  unzip -o -q "$TMP/bun.zip" -d "$BUN_DIR"
  export PATH="$BUN_DIR/${BUN_ASSET%.zip}:$PATH"
fi

BUN_BIN=$(command -v bun)
BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
curl -fsSL "$BASE_URL/$VERSION.tar.gz" -o "$TMP/kit.tar.gz"
curl -fsSL "$BASE_URL/checksums.txt" -o "$TMP/checksums.txt"

EXPECTED=$(awk -v name="$VERSION.tar.gz" '$2 == name && length($1) == 64 && $1 !~ /[^0-9a-fA-F]/ { print tolower($1); n++ } END { if (n != 1) exit 1 }' "$TMP/checksums.txt") || { echo "ERROR: checksums.txt requires exactly one valid entry for $VERSION.tar.gz"; exit 1; }
ACTUAL=$(sha256_bin "$TMP/kit.tar.gz")
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ERROR: archive hash mismatch\n  expected $EXPECTED\n  actual   $ACTUAL"; exit 1; }
echo "archive hash verified (${ACTUAL%% *})"

# Extract into a dedicated subdirectory: the archive itself lives in $TMP and
# would otherwise count as a second top-level entry. Then require exactly one
# top-level directory (its name is not load-bearing; git-archive prefixes
# differ between release tooling versions).
mkdir -p "$TMP/out"
tar -xzf "$TMP/kit.tar.gz" -C "$TMP/out"
TOP_COUNT=$(find "$TMP/out" -mindepth 1 -maxdepth 1 | wc -l)
SRC=$(find "$TMP/out" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ "$TOP_COUNT" -ne 1 ] || [ -z "$SRC" ]; then
  echo "ERROR: unexpected archive layout"; exit 1
fi

mkdir -p "$INSTALL_DIR"
if [ -f "$INSTALL_DIR/cli/zcode-kit.mjs" ]; then
  command -v rsync >/dev/null 2>&1 || { echo "ERROR: rsync required to update an existing installation"; exit 2; }
  echo "existing install found — updating in place (.proxykey and proxy/config.yaml preserved)"
  # Excluded files are protected from --delete too (--delete-excluded is NOT
  # set): the local proxy key and user proxy/config.yaml survive updates.
  rsync -a --delete --exclude '.bun-path' --exclude '.proxykey' --exclude 'config.yaml' --exclude 'node_modules' \
        --exclude 'backups' --exclude 'logs' --exclude 'generated' "$SRC/" "$INSTALL_DIR/"
else
  cp -R "$SRC/." "$INSTALL_DIR/"
fi

printf '%s\n' "$BUN_BIN" > "$INSTALL_DIR/.bun-path"
cd "$INSTALL_DIR"
node cli/zcode-kit.mjs setup --harness auto

# User-scope `zcode-kit` command in ~/.local/bin (conventionally on PATH).
# Delete the file (or run zcode-kit uninstall) to undo.
SHIM="$HOME/.local/bin/zcode-kit"
if mkdir -p "$HOME/.local/bin" 2>/dev/null \
   && printf '#!/usr/bin/env sh\nexec node "%s/cli/zcode-kit.mjs" "$@"\n' "$INSTALL_DIR" > "$SHIM" 2>/dev/null \
   && chmod +x "$SHIM" 2>/dev/null; then
  echo "  added zcode-kit command -> $SHIM"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) : ;;
    *) echo "  note: $HOME/.local/bin is not on your PATH - add it to use zcode-kit from anywhere" ;;
  esac
else
  echo "  note: could not create the zcode-kit shim - use: node $INSTALL_DIR/cli/zcode-kit.mjs"
fi

echo ""
echo "== done. Start using it =="
echo "  zcode-kit status                     # proxy status (or: node cli/zcode-kit.mjs status)"
echo ""
echo "Thanks for your Trust, enjoy <3 -Github.com/ZepiGit - Instagram: Micheltie_"
