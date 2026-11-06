# 11: Batch 1c — Bun 1.4.4 bootstrap in the installers, pinned proxy typecheck, 1.4.4 attribution runs

**Blocked by:** 10 (Batch 1b — Node 24 support floor, refuse before mutation, autostart Node-path check)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0006, 0016

**What to build:** Both installers bootstrap Bun 1.4.4 with the five upstream SHA-256s (linux-x64, linux-aarch64, darwin-x64, darwin-aarch64, windows-x64) from the primary source. The proxy typecheck runs in root CI through a pinned proxy `typescript` devDependency and `@types/bun` 1.4.4 exact; its baseline is recorded first and every failure becomes a ticket. The memory loop's short profile re-runs on 1.4.4 on both legs (the Windows attribution run).

**Acceptance criteria:**

- [ ] Installer tests assert the five hashes and reject a tampered download (seam 8).
- [ ] `test-kit` legs include the proxy typecheck through the pinned devDependency, never an unpinned `bun x`. Its baseline error list is recorded before any fix. If the list is non-empty, the step compares against a committed expected-error list with the same ratchet as `expected-red.json` (a new error fails; a listed error that disappears fails until it is removed), and each listed error names a filed ticket.
- [ ] METRICS.md records the Linux and Windows 1.4.4 attribution runs next to the 1.4.2 reference; typecheck-baseline failures (if any) are filed as tickets (build-time gate 7).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 126, 140

## Comments
