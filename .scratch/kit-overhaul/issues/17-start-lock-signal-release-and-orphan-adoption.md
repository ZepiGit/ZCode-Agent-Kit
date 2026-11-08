# 17: Start-lock release on signals, orphan adoption, respawn over a proven-stale lock

**Blocked by:** 16 (Start lock protocol v1 with proven takeover (no judge-then-rename race))

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0003

**What to build:** A holder releases its own lock on SIGINT, SIGTERM, SIGHUP, and on Windows SIGBREAK and console close, only while the on-disk record is still its own. The next start adopts an orphaned proxy through the identity proof and never spawns a second one. Respawn treats a proven-stale lock as takeable, so the proxy is up after a respawn that met a stale lock. Every child is reaped on stop/restart/crash/update.

**Acceptance criteria:**

- [ ] Seam 2 tests per signal (POSIX) and SIGBREAK/console-close paths (windows-latest); orphan adoption → exactly 1 proxy.
- [ ] Loop S4, both legs: exactly 1 proxy at every sample (`count:proxy` ≤ 1), including after a Ctrl-C during start that leaves a proxy without a start-time record (windows run 42425476318, Round 16 Q1). On windows, `count:proxy` is one of 17's names in `S4/short`.
- [ ] Loop S4: 0 stale locks after Ctrl-C during start (baseline 5/8); respawn with a stale lock → proxy up; 50 cycles → 0 orphans, log-dir files ≤ 8. **Delete `S4/short` (linux, windows).**
- [ ] Loop S3 (windows): 0 orphans (`orphans`) after the scenario's stop in `S3/short` and `S3/hung`; **remove 17's names (`orphans`) from the windows `S3/short` and `S3/hung` entries in `expected-red.json`, with the evidence Round 15 Q1 condition 5 requires.**
- [ ] A2 (real PowerShell/conhost Ctrl-C) listed as an owner action, marked unverified.
- [ ] Adversarial: a holder whose lock was taken over (the on-disk record is no longer its own) leaves the new holder's lock untouched on SIGINT and SIGTERM.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 44, 45, 60

## Comments

- 2026-11-06 (orchestrator, from ticket 02 round 4 Windows evidence): a start killed between spawning the proxy and recording its start time leaves `proxy.pid` without a start time (manager writes the record first and fills `startedMs` from a later query: `zcode-proxy-manager.mjs:632/:639`; on Windows that query is PowerShell, up to 2 x 2.5 s). Every later stop then fails closed on `start-unknown` and the proxy can never be stopped by the kit (S3/hung windows: orphan pid 3796, all stops refused). The lock/lifecycle fix must close this window (e.g. record identity atomically before/at spawn, or adopt a healthy proxy that answers with this installation's key) and the windows memory leg must show 0 orphans in S3.

- 2026-11-06 (orchestrator, Round 7 Q4): ticket 17 adopts pid records that older kits already left without a start time (no kill on a pid alone); ticket 37 is now blocked by 17 so the Windows S3/short entry can clear.

- 2026-11-06 (orchestrator, from ticket 02 round 7 Linux evidence): orphan adoption must also cover a healthy proxy on the installation's port with no `proxy.pid` at all (start killed between spawn and the record write; see ticket 16 Comments of the same date). Adoption needs the same proof strength as Round 7 Q4 condition 3: never on a port or pid alone.

- 2026-11-07 (orchestrator, from ticket 65): Windows suspended-proxy orphan (see ticket 16 Comments of the same date) is a legacy/orphan state this ticket's adoption or stop must handle: a process with the proxy's command line that was never resumed, no pid record, not serving the port.

- 2026-11-08 (orchestrator, Owner Proxy round 15): Q1 conditions 3 and 7 — added the Loop S3 (windows) criterion "0 orphans after the scenario's stop in `S3/short` and `S3/hung`; remove 17's names". The windows S3 `orphans` check had two claimants (16 via Round 7 Q4 condition 1, 17 via What-to-build "Every child is reaped …"); 17 descends from 16, so 17 owns it (Q1 condition 2), which also avoids holding 16 on a reap only 17 delivers. "Delete `S4/short`" stays. The 2026-11-06 "0 orphans in S3" line above is a measured finding, not the source of this criterion (Q1 condition 6).

- 2026-11-08 (orchestrator, Owner Proxy round 16 Q1): new acceptance line for `count:proxy` in S4/short; windows `count:proxy` is owned by 17 and marked flips (1/26) in expected-red.json (ticket 67).
