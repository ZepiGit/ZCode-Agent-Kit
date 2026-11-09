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

- 2026-11-09 merger: RED. Merged `ticket/73-freeze-scan-pid-identity` (f1af7f5) as de1d550 (plain merge, no conflicts; pre-merge CI green: https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42535342500, staging/73 9615dd5), reverted as 2347fa2. Fast suite on the merged tree: kit 890/909 (1 fail, 18 skipped), proxy 1596/1596, mcp 99/100 (1 skipped), dist unchanged. Failing kit test: `tests/memory/loop.test.mjs:832` "a live child is frozen, thawed and killed by its identity; once it is gone nothing is done to its pid": `assert.match(/proc/<pid>/stat, /\) T /, "stopped")` read state `R` straight after `freezeProcess`. SIGSTOP delivery is asynchronous, so the test reads /proc before the child has stopped (the "running again" check after SIGCONT has the mirror race). Reproduced in isolation: 1 of 30 runs fails. Fix: poll /proc for the state (bounded wait) instead of reading it once. Logs: `.scratch/kit-overhaul/reports/merge-73-test.log` (failure at line 448), `merge-73-flake.log`, `merge-73-proxy.log`, `merge-73-mcp.log`, `merge-73-npmci.log`. Sanity diffs on the merged tree: staged-ticket diff empty; whole-tree diff `staging/73..de1d550` identical to `788f2fb..8cfc667` (ticket 75 e835bc6, 6572871, 2aeed5d via merge e3ae8d0: `scripts/fixture-ports.mjs`, `tests/free-port.mjs`, `tests/test-wiring.test.mjs` and 13 kit test files). The implementer's evidence comments remain on the branch at f1af7f5.
