#!/usr/bin/env sh
# Aider × ZCode launcher (POSIX): process-local env only (no global vars).
# The key is read by cli/launch.mjs; no env file is sourced by the shell.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
exec node "$ROOT/cli/launch.mjs" aider "$@"
