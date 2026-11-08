# 72: Memory-loop tests check a PID after the process died (Windows PID reuse)

**Blocked by:** 70 (Windows: "stop cleanly kills a verified-own process" finds the process still alive)

**Status:** ready-for-agent

Model: sol
Risk: low
ADR: no

**What to build:** Ticket 70 showed that on Windows a freed PID is reused quickly on a busy runner, so "is PID N alive?" after the process exited can answer yes for a different process. It fixed the two manager tests by asking the child's own handle (`ChildProcess.kill(0)`). The memory-loop tests make the same PID-after-death check on processes they do not own a handle for: `tests/memory/win-sampler.test.mjs:157,205` and `tests/memory/loop.test.mjs:347,374,450`. Fix them so a reused PID cannot pass or fail them (identity by PID + start time, as the sampler already records, or a handle where the test can hold one), RED first with a simulated reuse (ticket 70's preload approach).

**Acceptance criteria:**

- [ ] Each listed check judged by identity, not PID alone; a simulated PID reuse can neither pass nor fail it; mutation proof.
- [ ] Full suites green; windows test-kit legs green (pending CI).

## Comments
