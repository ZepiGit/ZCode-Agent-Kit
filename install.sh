#!/usr/bin/env sh
# zcode-agent-kit installer (POSIX: macOS / Linux / WSL).
# See install.ps1 header for the security model: pinned release tarball,
# SHA256 verified against the release's checksums.txt, no admin rights.
# WSL note: the ZCode Desktop app must run on the Windows host; the proxy
# inside WSL cannot drive it — install on Windows instead (detected, refused).
set -eu

VERSION="${ZCODE_KIT_VERSION:-v0.2.0}"
REPO="ZepiGit/ZCode-Agent-Kit"
INSTALL_DIR="${ZCODE_KIT_INSTALL_DIR:-${ZCODE_KIT_HOME:-$HOME/.local/share/zcode-agent-kit}}"

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
  curl -fsSL "$BUN_URL" -o /tmp/bun.zip
  # Audit H2b: on stock macOS sha256sum does not exist. Note that the naive
  # `sha256sum | awk || shasum` never falls back — awk exits 0 on empty input —
  # so the tool must be probed explicitly.
  sha256_bin() {
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$1" | awk '{print $1}'
    else
      shasum -a 256 "$1" | awk '{print $1}'
    fi
  }
  ACTUAL=$(sha256_bin /tmp/bun.zip)
  [ "$ACTUAL" = "$BUN_SHA" ] || { echo "ERROR: bun download hash mismatch\n  expected $BUN_SHA\n  actual   $ACTUAL"; exit 1; }
  unzip -o -q /tmp/bun.zip -d "$BUN_DIR"
  export PATH="$BUN_DIR/${BUN_ASSET%.zip}:$PATH"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
curl -fsSL "$BASE_URL/$VERSION.tar.gz" -o "$TMP/kit.tar.gz"
curl -fsSL "$BASE_URL/checksums.txt" -o "$TMP/checksums.txt"

EXPECTED=$(grep "$VERSION.tar.gz" "$TMP/checksums.txt" | awk '{print $1}')
[ -n "$EXPECTED" ] || { echo "ERROR: checksums.txt missing entry for $VERSION.tar.gz"; exit 1; }
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
if [ -d "$INSTALL_DIR/.git" ] || [ -f "$INSTALL_DIR/.proxykey" ]; then
  echo "existing install found — updating in place (.proxykey and proxy/config.yaml preserved)"
  # Excluded files are protected from --delete too (--delete-excluded is NOT
  # set): the local proxy key and user proxy/config.yaml survive updates.
  rsync -a --delete --exclude '.proxykey' --exclude 'config.yaml' --exclude 'node_modules' \
        --exclude 'backups' --exclude 'logs' --exclude 'generated' "$SRC/" "$INSTALL_DIR/"
else
  cp -R "$SRC/." "$INSTALL_DIR/"
fi

cd "$INSTALL_DIR"
node cli/zcode-kit.mjs setup --harness auto

echo ""
echo "== done. Start using it =="
echo "  cd $INSTALL_DIR"
echo "  node cli/zcode-kit.mjs status"
echo ""
echo "Thanks for your Trust, enjoy <3 -Github.com/ZepiGit - Instagram: Micheltie_"
