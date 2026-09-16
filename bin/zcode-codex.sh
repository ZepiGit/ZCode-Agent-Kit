#!/usr/bin/env sh
# Codex × ZCode launcher (POSIX): isolated CODEX_HOME; ~/.codex untouched.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
node "$ROOT/cli/heal.mjs" || exit $?
ZCODE_PROXY_KEY=$(tr -d '\r\n' < "$ROOT/.proxykey")
export ZCODE_PROXY_KEY
exec env CODEX_HOME="$ROOT/generated/codex-home" codex "$@"
