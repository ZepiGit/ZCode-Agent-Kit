#!/usr/bin/env bash
# Resource sentinel for the kit-overhaul run (Linux).
# Every INTERVAL seconds: append MemAvailable, swap and the top-10 RSS processes
# to reports/ram.log. Below THRESHOLD_PCT available memory, terminate ONLY the
# processes this run started: PIDs listed in reports/run-pids.txt, and processes
# of this user whose environment carries ZCODE_OVERHAUL_RUN=1. Nothing else.
set -u
RUN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$RUN_DIR/reports/ram.log"
PIDFILE="$RUN_DIR/reports/run-pids.txt"
RUNLOG="$RUN_DIR/RUNLOG.md"
INTERVAL="${SENTINEL_INTERVAL:-5}"
THRESHOLD_PCT="${SENTINEL_THRESHOLD_PCT:-15}"
SELF=$$
touch "$PIDFILE"

tagged_pids() {
  local p
  for p in /proc/[0-9]*; do
    p="${p#/proc/}"
    [ "$p" = "$SELF" ] && continue
    [ -O "/proc/$p" ] || continue
    if tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -qx 'ZCODE_OVERHAUL_RUN=1'; then
      echo "$p"
    fi
  done
}

while :; do
  total=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
  avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  swt=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
  swf=$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)
  pct=$(( avail * 100 / total ))
  {
    printf '%s avail_kb=%s total_kb=%s avail_pct=%s swap_used_kb=%s\n' \
      "$(date -u +%FT%TZ)" "$avail" "$total" "$pct" "$(( swt - swf ))"
    ps -eo pid,rss,comm --sort=-rss --no-headers | head -10 | sed 's/^/  /'
  } >> "$LOG"
  if [ "$pct" -lt "$THRESHOLD_PCT" ]; then
    victims=$( { grep -E '^[0-9]+$' "$PIDFILE" 2>/dev/null; tagged_pids; } | sort -un)
    killed=""
    for v in $victims; do
      [ "$v" = "$SELF" ] && continue
      [ -O "/proc/$v" ] || continue
      kill -TERM "$v" 2>/dev/null && killed="$killed $v"
    done
    sleep 3
    for v in $killed; do [ -e "/proc/$v" ] && kill -KILL "$v" 2>/dev/null; done
    printf -- '- %s SENTINEL ALERT: MemAvailable %s%% < %s%%; terminated run-owned PIDs:%s\n' \
      "$(date -u +%FT%TZ)" "$pct" "$THRESHOLD_PCT" "${killed:- none}" >> "$RUNLOG"
  fi
  sleep "$INTERVAL"
done
