# 11: Batch 1c — Bun 1.4.2 bootstrap in the installers, pinned proxy typecheck (Round 11 pin)

**Blocked by:** 10 (Batch 1b — Node 24 support floor, refuse before mutation, autostart Node-path check)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0006, 0016

**What to build:** Both installers bootstrap Bun 1.4.2 (Round 11 Q1 condition 1) with the five upstream SHA-256s (linux-x64, linux-aarch64, darwin-x64, darwin-aarch64, windows-x64) from the primary source, Bun's GitHub release assets. The proxy typecheck runs in root CI through a pinned proxy `typescript` devDependency and `@types/bun` 1.4.2 exact. Its baseline is recorded first, and every failure becomes a ticket. The re-run of the memory loop's short profile on a new Bun (the Windows attribution run) is moot, because the runtime stays at 1.4.2 (Round 11 Q1 condition 1).

**Acceptance criteria:**

- [ ] Installer tests assert the five hashes and reject a tampered download (seam 8).
- [ ] `test-kit` legs include the proxy typecheck through the pinned devDependency, never an unpinned `bun x`. Its baseline error list is recorded before any fix. If the list is non-empty, the step compares against a committed expected-error list with the same ratchet as `expected-red.json` (a new error fails; a listed error that disappears fails until it is removed), and each listed error names a filed ticket.
- [ ] ~~METRICS.md records the Linux and Windows 1.4.4 attribution runs next to the 1.4.2 reference~~ (moot, Round 11 Q1 condition 1: METRICS.md records why); typecheck-baseline failures (if any) are filed as tickets (build-time gate 7).
- [ ] SUPPORT_MATRIX.json and README × 5 name Bun 1.4.2 (Round 11 Q1 condition 6), and spec.md's 1.4.4 mentions outside §18 move to 1.4.2 with a pointer to Round 11.

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

- 2026-11-07 (orchestrator, Owner Proxy round 11, binding): the kit pins **Bun 1.4.2** everywhere, not 1.4.4 (paired CI run 42352122623: Bun ≥ 1.4.3 raises the Linux S1/burst1 peak; ticket 62 owns re-entry). This explicitly amends Round 1 Q15, Round 2 Q10 condition 4 and the ADR-0016 Consequences line.
  For this ticket: installers bootstrap Bun 1.4.2 with its SHA-256s taken from the primary source (Bun's GitHub release assets), `@types/bun` 1.4.2 exact; the "1.4.4 attribution runs" criterion is moot (Round 11 C1). Retitle to 1.4.2. SUPPORT_MATRIX.json and README × 5 name 1.4.2 (Round 11 C6).
- 2026-11-07 (orchestrator): spec.md still names Bun 1.4.4 outside §18 (§1 line ~34, stories 126 and 138, §12 lines ~515–528 and ~609). Update them to 1.4.2 with a pointer to Round 11 when this ticket lands (ticket 09 changed §18 only).
