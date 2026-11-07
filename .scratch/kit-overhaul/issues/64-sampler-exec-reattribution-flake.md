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

### 2026-11-07 — implementer

Branch `ticket/64-sampler-exec-reattribution`, code head a30b300 (c499de5 RED test + `scan()` seam, 8dc2fa7 fix, a30b300 merge of the integration tip b6587c8). Logs: `reports/t64-*.log`; scratch probes (not committed): `/home/AgentKit/overhaul-tools/t64-scratch/`.

**Root cause: the sampler, not the test.**
- During an exec, the kernel installs the new address space before it sets that space's arguments and environment. Until then `/proc/<pid>/cmdline` and `/proc/<pid>/environ` both read 0 bytes (`fs/proc/base.c` returns 0 while `mm->env_end` is unset).
- A tick inside that window saw "no marker". It cached `pid:starttime` as not ours, and because the start time survives the exec, that verdict held for the pid's whole life. The exec'd process then vanished from the samples.
- This is ticket 02 round 7's S3/hung failure class ("role proxy never seen"; a hung round with no proxy to freeze) by another path. The cmdline re-read from 6d8e8e0 was intact. The re-read itself was what consulted the empty environ.
- Evidence: a probe (`t64-scratch/probe.mjs`) runs the test's scenario against the real kernel. It checks whether the exec happened by reading `/proc/<pid>/cmdline` and the entry's own start file at the end of the window.
  - Pre-fix sampler: 1/10 runs (`t64-probe-noload`), 3/40 (`t64-probe-inst`), 2/150 (`t64-probe-before150`) and 2/40 at 1 ms sampling (`t64-probe-1ms-inst`) failed.
  - Every failure was class SAMPLER, with the CI shape exactly: six `other` samples up to t≈505 ms, then the pid is missing from every later sample while it is alive as `node …/index.ts serve`. The instrumented copy logged `marked <pid> dropped: was "/bin/sh…pre-exec.sh" now cmdline="" environ=0B` for each one.
  - Class TEST (the exec had not happened by the end of the window) occurred 0 times in about 290 runs, 40 of them under 32 busy loops on 8 cores.
- Fixed sampler: 0/150 (`t64-probe-after150`) and 0/40 at 1 ms (`t64-probe-1ms-fixed`).

**Fix** (`tests/memory/lib/sampler.mjs`):
- A read with an empty cmdline and an empty environ, from a process that is not a kernel thread, yields no sample. It is not cached, so the next tick reads the process again.
- A kernel thread (`PF_KTHREAD` in stat field 9) reads the same and still caches as not ours. That keeps hundreds of kernel threads from being re-read every tick.
- `scan(marker, cache, { procRoot })` (default `/proc`) is the new seam; callers are unchanged.

**Test** (`tests/memory/loop.test.mjs`):
- Two new fake-/proc tests:
  - The pid walks through sh → window → window → proxy; a pid first seen inside its exec is also picked up after it.
  - Adversarial, from the purpose (the window must never make a process ours): an exec into an environment without the marker is not ours, a kernel thread is not ours, and a stranger cached as not ours stays not ours.
- The real-exec test now waits on events, not a 1.6 s window: sampled as sh, then the exec released via stdin (`read go`), then the exec seen in `/proc/<pid>/cmdline`, then two ticks after it. Its assertions are unchanged.

**RED → GREEN:** `t64-red1` (the new test on the pre-fix sampler: `after the exec: the same pid is a proxy`, `actual: []`). GREEN: `t64-green2`, loop.test.mjs 55 pass / 0 fail / 5 skipped.

**Stability:** `t64-load50`: 50 consecutive runs of the three exec tests under 32 CPU busy loops (8 cores), 50/50 green.

**Mutants** (in place, then `git checkout`; `git diff` empty after each):
- U, the cmdline re-read removed (`meta === undefined` only): all 3 exec tests fail, the real-exec one included (`t64-mut-U`).
- W, the window guard removed: the window test fails (`t64-mut-W`).
- X, the stale command line reused inside the window: equivalent to W (it still falls through to the environ check), so no new information.
- Y, the marker not re-checked after a cmdline change: the adversarial test fails (`t64-mut-Y`).

**S3/hung, Linux short profile, 3 runs** (`t64-s3hung`, ports 19640–19642, artefacts `/home/AgentKit/overhaul-tools/t64-memloop/s3hung-{1,2,3}`):
- Every run: completeness gate `ok: true`, `failures: []`, 188 s, 489/445/561 samples, rounds kill-holder-10, hung-10-with-stale-lock and hung-10.
- Both hung-round targets came `via: pid-record`, no round was skipped, and the proxy role was seen.
- Outcome "RED as listed (ticket 16)", as before. Ticket 02 round 7's guarantee holds.

**Full suites (after the merge):** `npm run test` 746 tests: 727 pass, 0 fail, 19 skipped. `npm run test:proxy` 1343 pass, 0 fail, 90 files. `npm run test:mcp` 96 tests: 95 pass, 0 fail, 1 skipped; `dist/` unchanged after the build.

**Decisions:**
- The window yields no sample rather than a sample with the previous role. Its contents are unknown at that moment, and an exec may drop the marker (mutant Y's case).
- No expected-red entry belongs to this ticket.
- CI confirmation of the flake's absence on ubuntu Node 24: pending CI (orchestrator verifies after merge+push).
