# 16: Start lock protocol v1 with proven takeover (no judge-then-rename race)

**Blocked by:** 15 (Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets))

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0003, 0012

**What to build:** New locks add a protocol version and the holder's process start time, written atomically. Takeover only on proof (holder dead, or PID reused: live start time differs; v0: later than `startedAt`). The race is closed (moved record checked against the judged one, or an exclusive side-lock with pid + start-time proof). A live holder's lock is never touched; unparsable or unknown-higher-version locks are never deleted and are reported with what/why/next and the exact path. Old kits read only `pid`/`startedAt`. AUD-001 comments updated with the implementation. The takeover logs one event line.

**Acceptance criteria:**

- [ ] Takeover race test: N contenders with a kill injected at every protocol step → never two holders, never a deleted live lock (seam 2, real time).
- [ ] v0 lock recovery; unreadable/unknown-version lock untouched with the error block; old-manager interop test against the origin/main manager.
- [ ] Lock-version migration replayed twice is a no-op the second time.
- [ ] Loop: S3 killed-holder round → 0 failed launches, 0 stale locks, exactly 1 proxy. **Delete `S3/hung` (linux, windows) from `expected-red.json`.**
- [ ] A kill injected during the lock write leaves either no lock file or a complete, parsable record, never a partial one, on both legs (Story 48).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 41, 42, 43, 46, 47, 48, 135

## Comments
