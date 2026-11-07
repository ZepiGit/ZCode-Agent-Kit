# 53: Docs: SECURITY (+de), harness docs, MCP bridge READMEs × 5, `docs/MCP_API.md`, SUPPORT_MATRIX, MANIFEST

**Blocked by:** 11 (Batch 1c — Bun 1.4.4 bootstrap in the installers, pinned proxy typecheck, 1.4.4 attribution runs), 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24), 16 (Start lock protocol v1 with proven takeover (no judge-then-rename race)), 22 (Graceful stop request `POST /__kit/stop`, shared deadlines and the manager's stop path), 31 (Per-task caps and 4 MiB head/tail truncation of task text), 51 (Harness adapters: confirmed MEDIUM fixes and record refresh), 58 (Solver recycle triggers and failure semantics (abnormal-exit budget, fail-fast shed))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0002, 0003, 0007, 0014

**What to build:** SECURITY (+de): solver is a separate OS process with a cap and still not a sandbox; takeover rules replace "never taken over"; happy-dom flags keep the 20.x surface; `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA` unchanged; stop-token protections. `harnesses/README*` and `EFFORT_MAPPING*` where effort/image flags changed. The five MCP bridge READMEs at parity with the Node 24 floor and the stay-back note. `docs/MCP_API.md`: 4 MiB cap (1 MiB head + 3 MiB tail), marker, `truncated`, idempotency window. `SUPPORT_MATRIX.json` (date, Node/Bun versions, tested harness versions reconciled with MANIFEST) and `MANIFEST*`.

**Acceptance criteria:**

- [ ] Parity checks for SECURITY en/de and the five bridge READMEs; `release-audit`/`state-audit` pass with the new matrix.
- [ ] A grep test fails if any sentence that states the worker-thread solver or 'never taken over' is still present. The sentences are captured from the base commit into the test, from SECURITY.md, SECURITY.de.md, README × 5 and the MCP bridge READMEs.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 126, 129, 136, 137

## Comments

- 2026-11-07 (orchestrator, from ticket 10): the READMEs (en, de, es, ja, zh-CN) and SUPPORT_MATRIX.json still name Node 20; the support floor is Node 24 (engines >=24 in all three manifests, ticket 10) and Bun 1.4.2 (Round 11).
