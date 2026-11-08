# 73: Memory loop: `whileFrozen` resume and `scanWindows` filter by PID only (Windows PID reuse)

**Blocked by:** 72 (Memory-loop tests check a PID after the process died (Windows PID reuse))

**Status:** ready-for-agent

Model: sol
Risk: medium
ADR: no

**What to build:** Found by ticket 72 (same root cause as tickets 70 and 72: Windows reuses a freed PID quickly on a busy runner). `tests/memory/lib/freeze.mjs` `whileFrozen` resumes a frozen process if its PID answers alive; on Windows that could resume (or fail to resume) a stranger and turn an S3/hung run into a harness failure. `scanWindows` in `tests/memory/lib/sampler.mjs` filters by PID only. The orphan test's `finally` in `tests/memory/loop.test.mjs` kills by PID (low risk). Judge each by identity (PID + start time via ticket 72's `tests/memory/lib/process-identity.mjs`, or a held handle), RED first with ticket 72's PID-reuse simulation, mutation proof; S3/hung's evidence gate and the ratchet unchanged.

**Acceptance criteria:**

- [ ] Each site judged by identity; a simulated PID reuse can neither pass nor fail it; mutation proof.
- [ ] S3/hung linux short profile passes its evidence gate; full suites green; windows legs pending CI.

## Comments
