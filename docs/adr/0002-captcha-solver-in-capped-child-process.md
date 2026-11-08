---
status: accepted
---

# The captcha solver runs in a separate, OS-capped child process

Solves run in a separate OS process (the solver process) with a hard memory cap that the OS enforces, not on a worker thread inside the proxy. The solver worker keeps every closed happy-dom window until it is recycled: 958 MB RSS at the 200-solve recycle and 686 MB retained inside one generation (memory report RC1). Bun cannot cap a Worker or its own heap (`research/bun.md`, Answer 4–5). Charter C1 says a separate process with a hard cap beats an in-process heuristic. The in-process thread transport stays only as the test and fallback adapter. Solve inputs and outputs stay byte-identical, and the dispatcher interface is unchanged.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 1, Q3 (the recommendation was REJECTED as worded; the core was upheld with the binding corrections below).

## Binding conditions

1. **Spawn from the running Bun.** Users run `bun run src/index.ts serve` with their own Bun, not the compiled binary. From source, the solver process is started from the running Bun executable (`process.execPath`) plus the solver entry module. Compiled builds use a self-exec subcommand. `-e` is never used. Both paths have tests.
2. **The solver process dies with the proxy.** On Windows the Job Object carries `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Linux and macOS have no equivalent, so the solver process exits when its IPC channel reaches EOF. A test SIGKILLs the proxy and asserts that 0 solver processes remain.
3. **Cap before work.** The solver process loads neither happy-dom nor the solve code until the parent confirms, by handshake, that the cap is applied. This closes the window between spawn and `AssignProcessToJobObject` or scope creation.
4. **One solver generation at a time.** The old solver process has exited, or has been killed after a bounded grace period, before the next one spawns. The ~2x overlap from asynchronous worker termination must not return.
5. **Measure memory footprint, not RSS.** Sampling-and-kill and recycle-by-memory use `Bun.unsafe.memoryFootprint()` (commit charge on Windows, which is what the Job Object limits), with RSS only as the fallback.
6. **Linux cgroup is verified, not assumed.** Apply `MemoryMax=` together with `MemorySwapMax=0`, then read the scope's `memory.max`. If the limit did not take effect (no delegated memory controller), the enforcement mode is `sampling`, never `cgroup`.
7. **Cap value 300 MB**, the §9 ceiling. The memory-recycle threshold sits below the cap, so the OS kill is the backstop and not the normal path. An OOM kill goes through the existing exit path. No new retry policy is added.
8. **Enforcement mode is visible.** `proxy status`, its `--json` (additive field) and `doctor` report the active enforcement mode (`job-object` | `cgroup` | `sampling`) and the cap.

Per platform: Windows uses a Job Object created through `bun:ffi` (no new dependency). Linux uses a cgroup v2 scope through the user's systemd when its memory controller is delegated, otherwise sampling. macOS has no kernel per-process limit and uses sampling.

## Considered options

- **Keep the worker thread and tune recycling:** rejected. Recycling bounds growth only at about 1 GB, and no in-process cap exists in Bun.
- **Hunt down every retaining reference in the guest realm:** rejected as the wrong fix class. The exact GC root is not pinned down, and only terminating the realm frees it.
- **Self-exec of the compiled binary everywhere:** rejected. It does not describe what users run.

## Consequences

- The IPC shape and the solver entry contract are a one-way door once released.
- Whether a real vendor-SDK solve fits under 300 MB is unmeasured (owner action A1). If it does not, that is a new owner question. This decision cannot loosen the ceiling.

## Amended 2026-11-06 (Round 2, Q2 and Q5; Round 3, Q3 and Q10)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 2, Q2 and Q5; Round 3, Q3 and Q10. Round 2 Q2 and Round 3 Q10 add no ADR of their own; they refine this one.

**Failure and recycle semantics (Round 2, Q2).**

- **A crash or OS kill fails only the solve in flight,** through the existing error path and category (`CaptchaSdkError("other", …)`). Queued solves are pumped onto the next generation, as today. Requests that need no solve are never interrupted.
- **Abnormal exits have a restart budget.** Only crash, OS kill at the cap, fatal error and deadline kill count, at most 5 per 10 min; then the solver is in its fail-fast window. Planned recycles (count, footprint, idle, request, shutdown) never count. The budget limits process restarts and never resubmits a solve, so condition 7 ("no new retry policy") holds.
- **Shed only in the fail-fast window or on queue overflow,** with `Retry-After` set to the time until the window reopens ([ADR-0004](0004-admission-shed-contract.md)). Never merely because a crash happened.
- **Condition 5 is made concrete.** The footprint trigger is the primary recycle rule: 80 % of the configured cap (240 MB at 300), read from the solver process's own `Bun.unsafe.memoryFootprint()` report after each solve. The solve count of 100 (was 200) is only a backstop. The in-worker 768 MB heap trigger lies above the cap and is removed or re-based below it.
- **Condition 7 is made configurable.** The cap defaults to 300 MB and is set in `config.yaml` for the managed proxy. An env override applies only through the `proxyEnv` allowlist ([ADR-0008](0008-proxy-health-supervisor-and-respawn-handoff.md) condition 6). Values below a documented minimum are rejected at config load with what/why/next. The OS-kill log line names the `config.yaml` key. Tests and the §9 evidence use the 300 MB default, so the ceiling is not loosened.
- **Environment parity.** The solver process gets the inputs the worker gets today: `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA`, the CDN cache variables and the egress setting (Round 1, Q17). The guest error boundary is installed in the solver process too.

**Enforcement modes (Round 2, Q5).** Condition 8's list gains `none`, for the thread transport or for caps that are switched off: `job-object` | `cgroup` | `sampling` | `none`. See [ADR-0010](0010-observability-contract.md).

**Lifetime (Round 3, Q10).** The solver process is spawned on the first solve, kept alive while solves arrive, and exits after 10 min idle. That idle exit is a planned recycle, not an abnormal exit. Prewarm is off by default. Condition 4 holds during recycles too: at most one solver process per proxy. These match today's thread lifecycle exactly.

- The 90 s per-solve deadline still starts at dispatch. The cold-start cost (spawn + cap handshake + module load) is measured on Linux and Windows and recorded in METRICS; above 4.5 s (5 % of the deadline) it returns as a finding. The deadline is not moved.
- An idle exit releases the cap container (closes the Job Object, ends the scope) and leaves 0 solver processes. The S4/S2 orphan checks assert it.
- The solver process's environment excludes `ZCODE_KIT_RESPAWN_*` and `ZCODE_KIT_STOP_TOKEN` (Round 3, Q3; [ADR-0014](0014-graceful-stop-request-over-loopback.md)).
- Round 19: the solver process's environment also excludes the ambient proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, any case, and the npm/yarn/pnpm proxy variables); `ZCODE_PROXY_UPSTREAM_PROXY` passes.
