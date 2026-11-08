# 75: Kit tests share fixed fixture ports (18458 and others): parallel test files collide

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: sol
Risk: low
ADR: no

**What to build:** Ticket 72's merge run (2026-11-08) failed once in `tests/json-superset.test.mjs` ("accounts health --json (down): exit 0, baseline 1"): the capture's "down" case found a listener on the shared fixture port 18458, because several test files use that port and `node --test` runs files in parallel. Ticket 15's `tests/proxy-lifecycle.test.mjs` had the same class of problem with 19150-19159 (fixed in ticket/15-fix-windows-teardown by binding port 0). Files that reference 18458 on the integration tip: tests/continue-compatibility.test.mjs tests/term-output.test.mjs tests/ux-before-capture.test.mjs tests/term-fixtures.mjs . Give every kit test that needs a port a free one (bind 127.0.0.1:0 and pass the chosen port into the fixture, or one per-file helper), keep every assertion (a "down" case must still prove nothing listens on the port it checks: choose a port that was just freed, or a port proven unbound), and add a guard test that fails if a test file hard-codes a port in the fixture range again. Snapshot/ux-before outputs that print the port must stay byte-identical (normalise the port in the capture if one is printed).

**Acceptance criteria:**

- [ ] No kit test hard-codes a listening port; a guard test pins it (with a mutation proof).
- [ ] `npm run test` passes 5 times in a row and with two copies running in parallel in separate worktrees; ux-before byte-identical.
- [ ] Full suites green; windows legs green (pending CI).

## Comments
