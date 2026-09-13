#!/usr/bin/env sh
# zcode-agent-kit installer (POSIX: macOS / Linux / WSL).
# See install.ps1 header for the security model: pinned release tarball,
# SHA256 verified against the release's checksums.txt, no admin rights.
# WSL note: the ZCode Desktop app must run on the Windows host; the proxy
# inside WSL cannot drive it — install on Windows instead (detected, refused).
set -eu

VERSION="${ZCODE_KIT_VERSION:-v0.2.0}"
REPO="ZepiGit/ZCode-Agent-Kit"
INSTALL_DIR="${ZCODE_KIT_HOME:-$HOME/.local/share/zcode-agent-kit}"

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
  curl -fsSL https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip -o /tmp/bun.zip 2>/dev/null || \
    curl -fsSL https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-darwin-x64.zip -o /tmp/bun.zip
  # (Release checklist: verify against the published checksum before unzip.)
  unzip -o -q /tmp/bun.zip -d "$BUN_DIR"
  export PATH="$BUN_DIR/bun-linux-x64:$BUN_DIR/bun-darwin-x64:$PATH"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
BASE_URL="https://github.com/$REPO/releases/download/$VERSION"
curl -fsSL "$BASE_URL/$VERSION.tar.gz" -o "$TMP/kit.tar.gz"
curl -fsSL "$BASE_URL/checksums.txt" -o "$TMP/checksums.txt"

EXPECTED=$(grep "$VERSION.tar.gz" "$TMP/checksums.txt" | awk '{print $1}')
[ -n "$EXPECTED" ] || { echo "ERROR: checksums.txt missing entry for $VERSION.tar.gz"; exit 1; }
ACTUAL=$(sha256sum "$TMP/kit.tar.gz" | awk '{print $1}')
[ "$ACTUAL" = "$EXPECTED" ] || { echo "ERROR: archive hash mismatch\n  expected $EXPECTED\n  actual   $ACTUAL"; exit 1; }
echo "archive hash verified (${ACTUAL%% *})"

tar -xzf "$TMP/kit.tar.gz" -C "$TMP"
SRC=$(find "$TMP" -maxdepth 1 -type d -name 'zcode-agent-kit*' | head -1)
[ -n "$SRC" ] || { echo "ERROR: unexpected archive layout"; exit 1; }

mkdir -p "$INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ] || [ -f "$INSTALL_DIR/.proxykey" ]; then
  echo "existing install found — updating in place (config and .proxykey preserved)"
  rsync -a --delete --exclude '.proxykey' --exclude 'node_modules' --exclude 'backups' \
        --exclude 'logs' --exclude 'generated' "$SRC/" "$INSTALL_DIR/"
else
  cp -R "$SRC/." "$INSTALL_DIR/"
fi

cd "$INSTALL_DIR"
node cli/zcode-kit.mjs setup --harness auto

echo ""
echo "== done. Start using it =="
echo "  cd $INSTALL_DIR"
echo "  node cli/zcode-kit.mjs status"
