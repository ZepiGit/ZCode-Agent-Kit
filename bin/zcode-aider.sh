#!/usr/bin/env sh
# Aider × ZCode launcher (POSIX): process-local env only (no global vars).
# Credentials are NOT written here — this sources the kit-generated env file.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
node "$ROOT/proxy/zcode-proxy-manager.mjs" start >/dev/null 2>&1 || true
if [ ! -f "$ROOT/generated/aider-zcode.env" ]; then
  echo "zcode-aider: missing $ROOT/generated/aider-zcode.env — run: node cli/zcode-kit.mjs integrate aider" >&2
  exit 2
fi
set -a
. "$ROOT/generated/aider-zcode.env"
set +a
if [ $# -eq 0 ]; then
  exec aider --model "${ZCODE_AIDER_DEFAULT_MODEL:-openai/glm-5.3}"
else
  exec aider "$@"
fi
