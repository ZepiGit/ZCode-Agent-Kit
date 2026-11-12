#!/usr/bin/env sh
# Claude Code × ZCode launcher (POSIX). Opt-in per invocation: routes through
# the local zcode-proxy only for this command; normal `claude` is untouched.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
exec node "$ROOT/cli/launch.mjs" claude-code "$@"
