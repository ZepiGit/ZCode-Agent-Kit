# 70: Windows: "stop cleanly kills a verified-own process" finds the process still alive (1 of 8 runs)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: sol
Risk: high
ADR: no

**What to build:** `tests/manager-safety.test.mjs:160` "stop cleanly kills a verified-own process (identity + pid + start time match)" failed on windows-latest Node 24 in CI run 42436186573 (staging/67, an identical tree that passed in 7 other runs): `AssertionError: the process must be gone` (true !== false) at :176, after 3.4 s. Decide with evidence whether the test checks too early (the kill is issued and the process exits later: Windows `taskkill /T` returns before the tree is gone) or whether the kit's stop can return success while its verified-own process is still alive (a real C1 defect: "every child is reaped on stop"). Fix the cause: a test waits on the observable event (process gone, with a bounded deadline) instead of a fixed time; a kit race gets a deterministic RED test first and a fix that keeps C6 (never kill without proof). Ticket 15 (proxy lifecycle module) is in flight and touches the stop path; coordinate by merging the integration tip often, and if 15 lands first, fix on top of its outcome records.

**Acceptance criteria:**

- [ ] Root cause shown with evidence (CI log of 42436186573; reproduction under load; Windows behaviour from primary docs for the kill primitive used).
- [ ] The test (or the kit) no longer depends on timing; a mutation that leaves the process alive still fails the test.
- [ ] Full suites green; windows test-kit legs green (pending CI).

## Comments
