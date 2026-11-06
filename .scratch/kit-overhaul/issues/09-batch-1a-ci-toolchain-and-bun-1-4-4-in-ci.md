# 09: Batch 1a — CI toolchain: actions v7, Bun 1.4.4 in CI, nested proxy workflows removed

**Blocked by:** 02 (Windows sampler and the windows leg of the `memory-budget` job (Bun 1.4.2 reference run)), 03 (S3 OMP stub-host leg in the memory loop), 04 (Pre-existing findings: unwired tests, the test-wiring guard and CI Node coverage)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: 0006, 0016

**What to build:** `actions/checkout@v7`, `actions/setup-node@v7`, `oven-sh/setup-bun@v2`; Bun 1.4.4 in `ci.yml`, `release.yml` and the `memory-budget` job; the three nested vendored proxy workflows deleted with a MANIFEST vendor-change entry; `release.yml` changes only in versions, runs on Node 26, publish job keeps Node 24 for OIDC.

**Acceptance criteria:**

- [ ] All CI legs and both `memory-budget` legs green on Bun 1.4.4 with the unchanged `expected-red.json` (any entry turned GREEN by the runtime alone is deleted here, with evidence, and its fix ticket re-scoped).
- [ ] A release-audit test asserts the pins (no `bun-version: 1.4.2`/`1.4.0`, no `node-version: 20`) (seam 9).

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
