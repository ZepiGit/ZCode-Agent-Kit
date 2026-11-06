# 23: Respawn acknowledgement before drain (a refused respawn leaves the proxy serving)

**Blocked by:** 17 (Start-lock release on signals, orphan adoption, respawn over a proven-stale lock), 18 (Per-spawn proxy environment: stop token and log dir set by the manager, token stripped from the respawn hook), 21 (Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0015, 0008

**What to build:** On a memory respawn the proxy spawns the hook with unchanged arguments and waits up to 10 s for a `respawn.json` event with `pid === process.pid` and `at` > request time; hook exit 4 is an immediate refusal; afterwards the hook is unref'd. On refusal or no acknowledgement it keeps serving, logs ERROR once, reports `restarts` exhausted and spawns at most one hook per budget window. The watchdog path waits ≤ 10 s, then self-terminates and logs the outcome. Old proxies with a new manager keep today's behaviour (documented).

**Acceptance criteria:**

- [ ] Seam 2/4 tests: ack → drain; exit 4 → keep serving + one ERROR; no ack → keep serving; late ack → "already running, 0", exactly 1 proxy, slot consumed; backwards clock jump → keep serving; watchdog path bounded at 10 s.
- [ ] Loop: induced memory pressure → ≤ 3 restarts / 15 min and exactly 1 proxy at every sample.
- [ ] With the hard condition persisting over two budget windows and every respawn refused, exactly one hook is spawned per window (injected clock, spawn counter) (Story 50).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 49, 50, 51, 53

## Comments
