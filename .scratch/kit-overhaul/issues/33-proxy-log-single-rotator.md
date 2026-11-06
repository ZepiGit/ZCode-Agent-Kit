# 33: `proxy.log` single rotator: size-capped writer, manager rotation under the lock, file modes

**Blocked by:** 14 (Event-line format and redaction for new log events (prefactor)), 16 (Start lock protocol v1 with proven takeover (no judge-then-rename race)), 18 (Per-spawn proxy environment: stop token and log dir set by the manager, token stripped from the respawn hook), 21 (Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0009, 0015

**What to build:** While it runs, the proxy opens `proxy.log` (path from `ZCODE_KIT_LOG_DIR`) through a size-capped writer: rotation at 5 MB keeping one `proxy.log.1` (unlink `.1` → rename → reopen), plain fd writes, console/stdout/stderr through it, line content unchanged. A foreign handle blocking the rename → keep appending, retry each check, one WARN event. The manager keeps `[manager <ISO>] …` lines and rotates only under the start lock with no live recorded proxy (today's pre-lock rotation removed). Every creator of a log-dir file uses `0o600` and the logs dir `0o700` (manager, proxy writer on open/reopen; the watchdog's by-path append is added by 34). `proxy logs N` reads `.1` + current.

**Acceptance criteria:**

- [ ] Seam 4: rotation at 5 MB with kit readers and appenders open; foreign-handle case (windows-latest: rename with an open reader, build-time gate 5); one WARN; no line lost.
- [ ] Seam 2: manager rotation only under the lock and with no live proxy; file modes on every created file (POSIX); `proxy logs N` across `proxy.log.1` and `proxy.log`.
- [ ] Loop S7: `proxy.log` ≤ 6 MB while running. The `S7/short` entry stays until 34.
- [ ] Seam 4: after the writer opens, a line written to `process.stdout` and one written to `process.stderr` appear unchanged in `proxy.log`.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 74, 75, 77, 78, 79

## Comments
