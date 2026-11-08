# 34: Early log (`proxy.early.log`): 1 MB cap and the tail copy into `proxy.log`

**Blocked by:** 33 (`proxy.log` single rotator: size-capped writer, manager rotation under the lock, file modes)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0009

**What to build:** Inherited stdio goes to the early log, truncated at each start and capped at 1 MB by the proxy's writer (truncate in place after a marker event). Before any truncation of a non-empty early log the manager appends its last 64 KB to `proxy.log` behind a marker line (start failure, respawn, crash). The golden-path classifier keeps reading only `proxy.log`. Watchdog lines may be appended to `proxy.log` by path (`0o600`).

**Acceptance criteria:**

- [ ] Seam 4: cap enforcement with bounded overshoot; marker event.
- [ ] Seam 2: tail copy before every truncation path; the golden-path classifier finds a crash cause through the tail-copy marker (Round 4 Q1 add. 5).
- [ ] Loop S7: early log ≤ 1 MB + bounded overshoot.
- [ ] Seam 2/4 (POSIX): a watchdog by-path append that creates `proxy.log` creates it with mode `0o600`.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 76, 78

## Comments

- 2026-11-07 (orchestrator, from ticket 32): in Bun 1.4.2 a substring keeps its whole parent string alive (probe in ticket 32 Comments: 2,000 short rows split from one 20 MB record kept all 20 MB). A bound that counts the bytes of slices, split parts or tail copies is beaten unless it makes a fresh copy of what it keeps. Check your truncation/tail copy for this and pin it with an adversarial test.

- 2026-11-08 (orchestrator, Owner Proxy round 15): Q1 E and condition 7 — struck "**Delete `S7/short` (linux, windows).**" from the Loop S7 criterion. 34 owns no `expected-red.json` name: its early-log check was never RED in 34 runs, and `S7/short`'s only name, `proxy.log:bounded-while-running`, is ticket 33's, whose removal deletes the entry. The early-log bound itself still binds 34.
