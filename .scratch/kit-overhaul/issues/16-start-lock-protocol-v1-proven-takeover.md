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
- [ ] Loop: S3 killed-holder round → 0 failed launches (`failed-launches`), 0 stale locks (`stale-lock-after-round`), exactly 1 proxy (`exactly-one-proxy-after-round`); S3/hung's stale-lock round: a start over a dead holder's lock is taken over by proof (`start-over-stale-lock` GREEN). **Remove 16's names from `S3/short` (`failed-launches`, `stale-lock-after-round`, `exactly-one-proxy-after-round`) and `S3/hung` (the same three plus `start-over-stale-lock`) in `expected-red.json`, both legs (linux, windows), with the evidence Round 15 Q1 condition 5 requires.**
- [ ] A kill injected during the lock write leaves either no lock file or a complete, parsable record, never a partial one, on both legs (Story 48).
- [ ] windows-latest (Round 7 Q4 condition 1): a kill injected at each point between spawn and the complete record, and a forced start-time probe timeout with no kill, each end with the proxy stoppable or adopted.

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

- 2026-11-06 (orchestrator, from ticket 02 round 4 Windows evidence): a start killed between spawning the proxy and recording its start time leaves `proxy.pid` without a start time (manager writes the record first and fills `startedMs` from a later query: `zcode-proxy-manager.mjs:632/:639`; on Windows that query is PowerShell, up to 2 x 2.5 s). Every later stop then fails closed on `start-unknown` and the proxy can never be stopped by the kit (S3/hung windows: orphan pid 3796, all stops refused). The lock/lifecycle fix must close this window (e.g. record identity atomically before/at spawn, or adopt a healthy proxy that answers with this installation's key) and the windows memory leg must show 0 orphans in S3.

- 2026-11-06 (orchestrator, Round 7 Q4): ticket 16 owns closing the missing-start-time window of a new start, including a start-time probe that times out without any kill; the kit never kills on a pid alone.

- 2026-11-06 (orchestrator, from ticket 02 round 7 Linux evidence): the same window exists on Linux, earlier. A start lock holder killed after it spawned the proxy but before it wrote `proxy.pid` leaves a healthy proxy with no record at all. Every later stop refuses it ("proxy healthy but no pid file"), it ends as an orphan, and while it is frozen the kit starts a second proxy (2 at once, 10/10 launches failed in the reproduction). CI run 42281731448 hit it naturally (ubuntu S3/hung). Closing the window covers spawn → record write, not only record write → start time. Reproduction: ticket 02 Comments, round 7 (5 s sleep widened between spawn and `proxy.pid`, scratch copy only).

- 2026-11-07 (orchestrator, from ticket 65): (1) deleting `S3/hung (linux, windows)` now also needs the new check `start-over-stale-lock` GREEN: S3/hung's stale-lock round records a start refused over a dead holder's lock (exit 1, 'refusing automatic takeover') as RED instead of a skipped round; 4 of 39 S3/hung legs hit it. (2) On Windows a holder killed inside spawn() leaves a suspended proxy that never runs (libuv creates detached children suspended and resumes after CreateProcessW returns; https://github.com/nodejs/node/blob/main/deps/uv/src/win/process.c): no pid record, never serves the port, survives the final stop (run 42398299724), cannot be adopted. The proven takeover must cover a dead holder with no proxy up.

- 2026-11-08 (orchestrator, Owner Proxy round 15): Q1 condition 7 — "Delete `S3/hung` (linux, windows)" became "remove 16's names from `S3/short` and `S3/hung` (both legs)", naming the checks 16 owns there under Q1 condition 3 (`failed-launches`, `stale-lock-after-round`, `exactly-one-proxy-after-round`, plus `start-over-stale-lock` in S3/hung). Q1 condition 6 — Round 7 Q4 condition 1's windows-latest seam proofs (kill at each point between spawn and the complete record; forced probe timeout) moved from these Comments into Acceptance, as Round 7 Q4 ordered. Round 7 Q4 condition 1's loop part ("S3/hung windows shows 0 orphans before 16 deletes S3/hung") is no longer 16's: the windows S3 `orphans` check moved to ticket 17 (Round 15 Q1, explicit contradiction of Round 7 Q4 condition 1, loop part only). The 2026-11-06 "0 orphans in S3" line above is a measured finding and assigns nothing (Q1 condition 6).
