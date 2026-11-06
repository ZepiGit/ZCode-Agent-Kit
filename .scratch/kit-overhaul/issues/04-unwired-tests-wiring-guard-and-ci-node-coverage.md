# 04: Pre-existing findings: unwired tests, the test-wiring guard and CI Node coverage

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: —

**What to build:** The METRICS baseline findings become fixed: `tests/update.test.mjs` and `tests/upstream-config.test.mjs` run in `npm run test`; a guard test fails when any kit `tests/*.test.mjs` file is referenced by no test script; `test-kit` runs {ubuntu-latest, windows-latest} × {Node 24, 26} instead of Node 20 (Round 1 Q14/Q19).

**Acceptance criteria:**

- [ ] `npm run test` count rises by the 16 previously unwired tests, all passing.
- [ ] The guard test goes RED when a scratch unwired test file is added in a fixture repo and GREEN on the real repo (seam 9).
- [ ] CI shows four `test-kit` legs green with the kit, proxy and MCP suites (the proxy typecheck joins in 11).
- [ ] METRICS.md "pre-existing findings" marked resolved with the CI run link.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 139, 140

## Comments
