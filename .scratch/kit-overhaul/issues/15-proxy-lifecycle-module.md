# 15: Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets)

**Blocked by:** 08 (CLI command-module split, part 2 (migrate remaining commands + contract)), 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24), 14 (Event-line format and redaction for new log events (prefactor))

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0003, 0012

**What to build:** One deep module owns start, stop, restart, status, the start lock, takeover hooks, orphan adoption, respawn requests and the restart budget. Its interface is the lifecycle intents (ensure running, stop, restart, budgeted respawn request, read state); intents print nothing and return outcome records. Every caller uses it: CLI commands, preflight, `run`, the OMP extension through the preflight, update, setup, the account change (`restartForAccountChange`), `doctor --fix` and the respawn hook. The preflight path imports no presentation code. `createManager({ root, home, processStartMsImpl, … })` stays the injection seam. Frozen: manager CLI commands, exit codes 0–5 and output (incl. its own legacy `doctor`), OMP exit mapping 3 → foreign / 5 → key, the `ZCODE_KIT_RESPAWN_MANAGER` path, `respawn <pid> --reason <r>`.

**Acceptance criteria:**

- [ ] `manager-safety`, `manager-audit` and the golden-path script pass unchanged (seam 2).
- [ ] Module-graph test: the preflight entry's import closure contains no output/presentation module.
- [ ] S3 starter-preflight role peak ≤ 76 MB (loop), recorded vs baseline 55–73 MB.
- [ ] An old proxy (origin/main) calling the new manager's `respawn` CLI works (spawned test).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 61

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 15): the "S3 starter-preflight role peak ≤ 76 MB (loop)" criterion binds 15 on its own evidence, while ticket 37 holds the `procPeak:preflight` names in `expected-red.json` (Q1 condition 2, several claimants: 37 is the descendant). 15 removes no names; if 15 lands with the preflight peak still RED, it comes back with the numbers (Round 15 Shared understanding).
