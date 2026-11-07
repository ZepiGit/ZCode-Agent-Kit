# 64: Sampler re-attribution after exec fails under CI load (test or sampler defect)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: sol
Risk: medium
ADR: no

**What to build:** `tests/memory/loop.test.mjs:65` "a marked process is re-attributed after it execs (a proxy first seen before its exec is a proxy)" (added by ticket 02 round 7 with the Linux sampler fix 6d8e8e0) failed on ubuntu-latest Node 24 in CI run 42391052837 (staging/12; unrelated change): `after its exec: other,other,other,other,other,other` ('other' !== 'proxy') at loop.test.mjs:81. Ticket 11's implementer saw it fail once locally under full-suite load (it samples ~1.6 s around a ~0.6 s exec). Decide with evidence whether the defect is in the test (samples labelled "after exec" by wall-clock time while the exec has not happened yet) or in the sampler (a marked process whose cmdline changes is not re-read in some interleaving, which would bring back the S3/hung harness failure ticket 02 round 7 fixed). Fix the cause: a test must wait on the observable event (the exec), not on a time window; a sampler race gets a deterministic RED test first. Never loosen what the test protects.

**Acceptance criteria:**

- [ ] Root cause shown with evidence (reproduction under load, e.g. CPU-stressed or with an injected delay before the exec).
- [ ] The test (or the sampler) no longer depends on timing; 50 consecutive runs under load pass; a mutation that removes the sampler's cmdline re-read still fails the test.
- [ ] Full suites green.

## Comments
