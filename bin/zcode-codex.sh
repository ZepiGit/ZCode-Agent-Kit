#!/usr/bin/env sh
# Codex × ZCode launcher (POSIX): isolated CODEX_HOME; ~/.codex untouched.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
exec node "$ROOT/cli/launch.mjs" codex "$@"
