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
