#!/usr/bin/env bash
# run-capped.sh <name> <memmax> <timeout_s> -- <cmd...>
# Runs a command under a systemd user scope with a hard memory cap, no swap,
# a timeout, ZCODE_OVERHAUL_RUN=1 and an isolated HOME. Logs to reports/<name>.log.
set -u
name="$1"; mem="$2"; to="$3"; shift 3; [ "$1" = "--" ] && shift
R=/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/reports
H="${OVERHAUL_HOME:-/home/AgentKit/overhaul-tools/home-$name}"
mkdir -p "$H"
start=$(date +%s)
systemd-run --user --scope --quiet -p MemoryMax="$mem" -p MemorySwapMax=0 \
  env ZCODE_OVERHAUL_RUN=1 HOME="$H" XDG_CONFIG_HOME="$H/.config" XDG_DATA_HOME="$H/.local/share" XDG_CACHE_HOME="$H/.cache" \
  PATH="${BUN_DIR:-/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin}:$PATH" \
  timeout --kill-after=30 "$to" "$@" > "$R/$name.log" 2>&1 &
pid=$!
echo "$pid" >> "$R/run-pids.txt"
wait "$pid"; rc=$?
echo "EXIT rc=$rc duration_s=$(( $(date +%s) - start ))" >> "$R/$name.log"
exit $rc
