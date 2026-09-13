#!/usr/bin/env sh
# Claude Code × ZCode launcher (POSIX). Opt-in per invocation: routes through
# the local zcode-proxy only for this command; normal `claude` is untouched.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(dirname -- "$SCRIPT_DIR")
node "$ROOT/proxy/zcode-proxy-manager.mjs" start >/dev/null 2>&1 || true
exec claude --settings "$ROOT/generated/claude-zcode-settings.json" "$@"
