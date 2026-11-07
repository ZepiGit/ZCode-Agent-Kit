# 52: Docs: README × 5 at content parity

**Blocked by:** 10 (Batch 1b — Node 24 support floor, refuse before mutation, autostart Node-path check), 19 (Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract), 21 (Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB), 30 (MCP task retention (500 / 7 days) and the idempotency window), 31 (Per-task caps and 4 MiB head/tail truncation of task text), 33 (`proxy.log` single rotator: size-capped writer, manager rotation under the lock, file modes), 34 (Early log (`proxy.early.log`): 1 MB cap and the tail copy into `proxy.log`), 37 (`process.execve` handover in `zcode-kit run` and the `ZCODE_KIT_RESIDENT_LAUNCHER=1` opt-out), 41 (`doctor` memory checks: proxy memory, solver memory, cap enforcement, restart budget), 42 (Account Rotator decision asked once, with migration), 43 (UX batch (b1): compact `setup` report and `integrate --dry-run`), 47 (UX batch (c3): `run`, `update`, `rollback`, `uninstall`), 58 (Solver recycle triggers and failure semantics (abnormal-exit budget, fail-fast shed))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0003, 0013

**What to build:** README en/de/es/ja/zh-CN updated together: Node 24 floor; new config keys; log rotation and the early log (`proxy.early.log`); MCP task retention and the idempotency window; enforcement modes per OS incl. the Linux delegated-controller section that `doctor` links to; the 503 shed; stderr routing; rotator asked once; the execve handover, its Node ≥ 26.1 requirement and `ZCODE_KIT_RESIDENT_LAUNCHER=1` next to that note; the start-lock "never taken over" line replaced.

**Acceptance criteria:**

- [ ] A parity check passes: all five files have the same heading count per level, the same explicit anchor ids, and the same set of env-var names, config keys and `zcode-kit` commands (extracted by regex).
- [ ] The README section that 41's enforcement WARN links to carries an explicit HTML anchor id (`<a id="…"></a>`) that is identical in all five files, and a test asserts that the id 41 prints exists in each file.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 136

## Comments

- 2026-11-07 (orchestrator, from ticket 10): the READMEs (en, de, es, ja, zh-CN) and SUPPORT_MATRIX.json still name Node 20; the support floor is Node 24 (engines >=24 in all three manifests, ticket 10) and Bun 1.4.2 (Round 11).
