# Bun runtime: pin, Workers, memory caps (research, 2026-11-05)

## Answer

1. The latest stable Bun is **1.4.4** (GitHub release 2026-10-22T10:11:32Z). The only release between 1.4.2 and 1.4.4 is 1.4.3 (2026-10-10). Daily `1.4.4-canary.*` builds continue up to 2026-11-05.
2. Recommendation: pin **1.4.4** everywhere, in one change: `.github/workflows/ci.yml:30`, `release.yml:53`, `install.sh:131-147` (version and SHA256s), `install.ps1:98-102`, `SUPPORT_MATRIX.json:4`, the installer tests, and the nested proxy workflows, which still pin **1.4.0** (`zcode-proxy-src/.github/workflows/ci.yml:35`, `release.yml:54,132`). Also pin `@types/bun` to 1.4.4: "latest" is locked at 1.3.14 (`zcode-proxy-src/bun.lock:18,28`).
3. Why 1.4.4 and not 1.4.2: 1.4.3 makes threads blocked in `Atomics.wait()` give memory back to the OS (the captcha worker blocks in `Atomics.wait()`, `captcha-happy.ts:123`). It also makes `Bun.gc(true)` release RSS right away, fixes a per-module string leak when Workers are terminated, and makes macOS `rss` report the real footprint. 1.4.4 makes GC heap sizing respect cgroup v2 limits. Re-test these risks: the `ws` rewrite (happy-dom imports `ws`), stricter `bun install` flags and `--frozen-lockfile` checks, and the new `hasInstallScript` key in `bun.lock`.
4. Memory-cap verdict: **Bun 1.4.4 cannot hard-cap a Worker or its own JS heap.** `resourceLimits` is ignored (docs). `--max-old-space-size` is silently ignored (issue #34917 is open; the fix PR #34924 is not merged and would only cover the main thread, checked at full GCs). `BUN_JSC_gcMaxHeapSize` only triggers GC more often, and `BUN_JSC_forceRAMSize` only changes growth heuristics. `smol` / `--smol` picks the small heap size class, which is not a cap. `worker.terminate()` is the only Worker-level kill, and the docs still call termination "experimental".
5. A hard cap needs a **separate OS process**. Linux: a cgroup (`Bun.spawn({cgroup})`, or `systemd-run --user -p MemoryMax=`). Windows: a Job Object with `JOB_OBJECT_LIMIT_PROCESS_MEMORY`; Bun does not expose this, and PR #43825 (`maxMemory`) is not merged. macOS: no kernel limit for a process group exists, so the only option is sample-and-kill. `ulimit -v`/RLIMIT_AS does not work, because Bun reserves its address space at startup (#41900 is open). For guards, use `Bun.unsafe.memoryFootprint()` and not RSS. On Windows it reports commit charge (`PrivateUsage`).

## Details

### 1. Releases 1.4.2 → 1.4.4

| Version | Date | Source |
|---|---|---|
| 1.4.2 | 2026-09-05 | https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2 (2026-09-05T05:55:48Z) |
| 1.4.3 | 2026-10-10 | https://github.com/oven-sh/bun/releases/tag/bun-v1.4.3 (2026-10-10T05:24:54Z), https://bun.com/blog/bun-v1.4.3 (2026-10-10) |
| 1.4.4 (latest) | 2026-10-22 | https://github.com/oven-sh/bun/releases/tag/bun-v1.4.4 (2026-10-22T10:11:32Z), https://bun.com/blog/bun-v1.4.4 (2026-10-22) |

The npm `time` field shows `1.4.4-canary.20261105.1` published 2026-11-05T14:24:35Z (`npm view bun time`). There is no newer stable release.

#### 1.4.3 (https://bun.com/blog/bun-v1.4.3, 2026-10-10), the parts that matter here

Memory / GC:
- "`Bun.gc(true)` and `gc()` return freed memory to the OS before returning, so RSS drops right away instead of after a delay."
- "threads that are idle after `WebAssembly.compile()`, or blocked in `Atomics.wait()` or `Bun.sleepSync()`, give freed memory back to the OS after about 100 ms. A thread blocked for one second after freeing most of its heap held 115 MB instead of 424 MB." This applies directly to the captcha worker, which blocks in `Atomics.wait` during sync XHR (`zcode-proxy-src/src/proxy/captcha-happy.ts:123`). An open follow-up, PR #47013 (opened 2026-10-26), says an idle thread still keeps 5 to 48 MiB of large blocks for about 10 s after each burst except the first: https://github.com/oven-sh/bun/pull/47013.
- "each garbage-collected module leaked the string that held its `import.meta` URL. Re-importing after `delete require.cache[...]`, hot reloading, or terminating Workers leaked one such string per module." This is fixed, and it matters because the solver recycles workers every 200 solves (`captcha-solver.ts:60`).
- Bun's mimalloc fork is better at returning memory to the OS. Idle CPU drops 67–89%, and idle memory is 6–11% lower than 1.4.2 (blog, "67–89% less CPU while your server sleeps").
- "on macOS, `process.memoryUsage().rss` now reports the physical memory footprint that Activity Monitor shows." Before 1.4.3, macOS RSS under-reported, so the RSS memory guard (`health-monitor.ts:228`) was partly blind on macOS. Issue #28318 (opened 2026-03-20, user report) measured 7 MB RSS against 1.3 GB footprint: https://github.com/oven-sh/bun/issues/28318.
- Leak fixes relevant to the proxy: a `fetch()` Response and its `AbortSignal` were never collected when an abort listener referenced the response. A compressed `fetch()` body read through a slow stream reader could grow memory "by hundreds of MB". `Bun.serve` leaked about 7 KB per request when `req.clone()` was called and neither copy was read.
- On Linux, `process.on("memoryPressure")` no longer fires a false `critical` event.

Workers:
- New `--disallow-code-generation-from-strings`. In `=strict` mode it also blocks `new Worker(code, { eval: true })`. The repo uses eval workers in `runtime/watchdog.ts:204` and `proxy/captcha-happy.ts:95`, so it must **not** adopt `=strict`.
- Experimental `Bun.ModuleGraph`: "`graph.dispose()` behaves like `worker.terminate()`. It is not a security sandbox."

`bun build --compile`:
- New `--bytecode-order` (PGO) and `--compile-jit-policy`. ESM `--bytecode` executables start faster.
- "long-running `bun build --compile` apps on Linux keep less of Bun's own code resident in memory."
- A Linux regression since 1.3.14 is fixed (`--compile` run from inside a compiled executable). A `--bytecode --splitting` reproducibility bug is fixed.
- "Lower memory usage in `bun build` with many entry points". This fixes a 1.4.1 regression that could abort with `memory allocation of N bytes failed` on Windows.

Windows:
- "WebAssembly fast memory is enabled again. Growing a WebAssembly memory or a resizable `ArrayBuffer` at the system commit limit throws instead of crashing."
- `bun install` no longer hangs at 100% CPU when it replaces a running executable's last hard link.
- The named-pipe `Bun.connect()` leak is fixed.

#### 1.4.4 (https://bun.com/blog/bun-v1.4.4, 2026-10-22), the parts that matter here

- Runtime: "`navigator.hardwareConcurrency`, `os.availableParallelism()` and `process.constrainedMemory()` ignored cgroup v2 limits on Linux hosts that also have a cgroup v1 hierarchy ... Bun's thread counts and GC heap sizing ignored them too." This is fixed. The notes also list "various stability issues in ... garbage collection on Linux", and JavaScriptCore is upgraded with 1,013 WebKit commits.
- `node:worker_threads`: "when a Worker stopped while a native addon's async work was still running, the addon's finalizers ran before that work was done." This is fixed. A Worker `Bun.serve` handler error is now printed.
- `bun build --compile`: only "various stability issues". `--disallow-code-generation-from-strings=strict` now also blocks running JS files from disk inside a compiled executable. That does not matter as long as the flag is not used.
- `ws` rewrite (affects happy-dom, see §5): "`import "ws"` in Bun loads a built-in implementation ... We rewrote it as a port of `ws` 8.22.0." "An `'error'` event without a listener is an uncaught exception, like in Node.js." "`ws` servers have no idle timeout ... The default `maxPayload` is 100 MiB, up from 16 MiB."
- `bun:sqlite`: "Workers no longer share one SQLite malloc mutex. As a result, `PRAGMA hard_heap_limit` and `soft_heap_limit` are accepted but no longer enforced." The proxy does not use this. It does show that Bun gives up per-Worker memory limits for throughput.
- There is no Worker termination or `--smol` change in 1.4.4.

#### Multiple entry points / worker entry points in compiled binaries

- Docs: "To use workers in a standalone executable, add the worker's entrypoint to the build ... When you add multiple entrypoints to a standalone executable, Bun bundles each one separately into the executable ... For now, you need to list the worker file as an entrypoint." https://github.com/oven-sh/bun/blob/main/docs/compiler/executables.mdx (main branch, fetched 2026-11-05). The repo does this: `zcode-proxy-src/package.json:9-13` and `zcode-proxy-src/.github/workflows/release.yml` ("Build binary" step) pass `src/index.ts src/proxy/captcha-solver-worker.ts`.
- Automatic Worker detection (`new Worker(new URL(...))` found by the build) exists only for `bun compile` / `--aot`. That is on `main` and **not in any release**: the AOT commits are dated 2026-10-27..31 (`docs/compiler/compatibility.mdx` history, https://github.com/oven-sh/bun/commits/main/docs/compiler/compatibility.mdx), and the 1.4.3/1.4.4 notes never mention `--aot`. Keep the explicit worker entry point.
- Windows targets are unchanged: `bun-windows-x64` and `bun-windows-arm64` (executables.mdx, target table). The repo cross-compiles `bun-windows-x64` on ubuntu-latest (`zcode-proxy-src/.github/workflows/release.yml`, matrix).
- Embedding flags: `--compile-exec-argv="--smol ..."` and the `BUN_OPTIONS` env var both work for compiled executables (executables.mdx §"Runtime arguments via BUN_OPTIONS"). This is how a compiled proxy could run with `--smol`.
- **Repo fact:** the kit does not run the compiled binary. The manager spawns `bun run src/index.ts serve` (`proxy/zcode-proxy-manager.mjs:585`) with the user's Bun, which the installer pins to 1.4.2 (`install.sh:131-147`, `install.ps1:98-102`). So the version the installers pin is the version users run. The compiled binaries come from the nested proxy workflows, which pin **1.4.0**.

### 2. Worker termination, leaks, caps

**Termination semantics** (https://bun.com/docs/runtime/workers, fetched 2026-11-05, page cached 2026-10-24):
- "The `Worker` API is still experimental (particularly for terminating workers)."
- "Calling `worker.terminate()` makes the worker exit as soon as possible." "Bun emits the `"close"` event when a worker has been marked as terminated. The worker itself can take some time to fully exit."
- `process.exit()` in a worker "does not terminate the main process" and passes its code to `"close"`. This matches the repo's watchdog note (`runtime/watchdog.ts:16-17`) and the solver worker's fault path (`captcha-solver-worker.ts:53`).
- Implication for `recycle()` (`captcha-solver.ts:203-213`, `terminate()` at :209): termination is asynchronous. The next solve can spawn a new generation before the old thread has freed its heap, so peak memory can briefly be close to 2x one worker. Issue #46396 (opened 2026-10-21, open, reproduces on 1.4.0/1.4.3/1.4.4-canary) shows that worker teardown waits for queued JIT plans: https://github.com/oven-sh/bun/issues/46396.

**Known leaks with repeated create/terminate:**
- #5709 "Bun leaks memory in Workers", opened 2023-09-19, closed as completed 2026-05-13: https://github.com/oven-sh/bun/issues/5709.
- PR #31646 "Fix memory leak in repeated Worker create/terminate", merged 2026-06-02, so it ships in 1.4.0+. It fixes one leaked `JSHeapData` per worker (about 4 KB per worker in release builds). After the fix, `[anon:WKFastMalloc]` plateaus. "The remaining few MB ... is ... mimalloc's lazily-reclaimed (`MADV_FREE`) pages." https://github.com/oven-sh/bun/pull/31646.
- PR #29331 (FetchTasklet UAF and leak when a worker terminates mid-`fetch`) was closed 2026-06-26 **without merge**. Issue #33911 (terminate racing an in-flight `fetch()`, crash) was closed as completed 2026-07-24: https://github.com/oven-sh/bun/issues/33911. The solver terminates on its deadline (`captcha-solver.ts:274`) while guest `fetch`es may be in flight, so this race applies to the proxy. Its fix should be in 1.4.x, but which release it landed in is UNVERIFIED.
- **Open, affects 1.4.2–1.4.4:** #46669 "Terminated Worker leaks a thread spinning at 100% CPU after running Wasm (fixed by `BUN_JSC_useOMGJIT=0`)", opened 2026-10-24: https://github.com/oven-sh/bun/issues/46669. Whether the captcha SDK runs Wasm is UNVERIFIED. If it does, every recycled generation could leave a spinning thread.
- #28318 (open, user analysis, 2026-03-20) says `VirtualMachine.deinit()` is a stub ("freeing workers will leak the vm"). This is UNVERIFIED against 1.4.4 source.
- Compiled-binary specific: #29585 (Workers re-extract embedded native `.so` files to /tmp on every spawn) was closed 2026-08-18: https://github.com/oven-sh/bun/issues/29585. The proxy embeds no native addons.

**`resourceLimits`:** "`Worker` ignores the `resourceLimits` and `trackUnmanagedFds` options." (https://bun.com/docs/runtime/nodejs-compat, `node:worker_threads` section, fetched 2026-11-05). The bun-types 1.4.4 `WorkerOptions` has `// resourceLimits?:` commented out (`bun.d.ts:702`, https://www.npmjs.com/package/bun-types/v/1.4.4). PR #32896 "implement resourceLimits and enforce maxOldGenerationSizeMb" is **open** (opened 2026-06-27): https://github.com/oven-sh/bun/pull/32896. Even after it merges, the check runs "after each full collection" and is not an allocation-time cap.

**Process heap cap:** #34917 (open, 2026-07-21): "`--max-old-space-size` is accepted by Bun but has no observable effect", and `BUN_JSC_gcMaxHeapSize` is "accepted but not enforced". https://github.com/oven-sh/bun/issues/34917. PR #34924 (open) states: "`BUN_JSC_gcMaxHeapSize` ... is a GC-frequency trigger ..., not a cap, and `BUN_JSC_forceRAMSize` only scales growth heuristics." Its own enforcement would be "at full-GC granularity", would bound "the managed JS heap, not total RSS", and "Workers are not capped yet". https://github.com/oven-sh/bun/pull/34924. Measurements in #34917 show `--smol` is "bimodal" in a 1 GB container: sometimes it completes, sometimes it is OOM-killed.

**`smol`:** "Setting `smol: true` sets `JSC::HeapSize` to be `Small` instead of the default `Large`." (workers docs). The process-wide equivalent is the `--smol` CLI flag (executables.mdx). It lowers the growth target but is not a limit. The repo uses neither: `new Worker(WORKER_URL, { env })` at `captcha-solver.ts:175`, and no `smol` anywhere in `src/`.

**Child-process hard caps (per OS):**
- Linux: `Bun.spawn({ cgroup })` starts the child inside an existing cgroup. "When a memory limit is exceeded the kernel OOM-kills a process _inside_ the cgroup". "Creating cgroups typically requires root or a delegated subtree. Bun ignores the option on other platforms." (https://bun.com/docs/runtime/child-process, fetched 2026-11-05). It is present in bun-types 1.4.2 and 1.4.4 (`bun.d.ts` ~7430/7771). The kit's manager is Node (`zcode-proxy-manager.mjs:1`, `spawn` at :585), so a user-level option is `systemd-run --user --scope -p MemoryMax=...`. systemd documents `MemoryMax=` as: "If memory usage cannot be contained under the limit, out-of-memory killer is invoked inside the unit" (https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html, fetched 2026-11-05). This needs memory-controller delegation to the user manager.
- Windows: Bun exposes no Job Object API. bun-types 1.4.4 spawn options have only `windowsHide`/`windowsVerbatimArguments` (`bun.d.ts:7977-7982`). PR #43825 "spawn: add maxMemory" (open, 2026-09-23) would use "Job Object with a notification limit ... and Bun calls `TerminateJobObject`": https://github.com/oven-sh/bun/pull/43825. Doing it yourself today means `CreateJobObject` + `SetInformationJobObject` + `AssignProcessToJobObject`. `JOB_OBJECT_LIMIT_PROCESS_MEMORY` makes a commit beyond the limit fail (https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information, https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information, both 2018-12-05). This can be done through `bun:ffi` or a small helper. It is not done in this repo.
- macOS: per PR #43825, "None. The kernel has no memory limit for a group of processes." Only sampling plus kill is possible.
- RLIMIT_AS / `ulimit -v`: not viable today. PR #41900 "Fit the startup address-space reservations to RLIMIT_AS" (open, 2026-09-08, https://github.com/oven-sh/bun/pull/41900) and #39967 (a failed JSC Structure heap reservation crashes) show that Bun reserves large address ranges at startup.

### 3. Memory APIs

- `bun:jsc` (bun-types 1.4.4 `jsc.d.ts:90-139, 484-515`): `heapSize()` returns the objects that "survived the most recent garbage collection ... Objects allocated since the last collection are not included". `heapStats()` walks the whole heap (slow). `memoryUsage()` returns `{current, peak, currentCommit, peakCommit, pageFaults}`. Its `current` field is "the resident set size on Linux and Windows, and on macOS the memory footprint". `currentCommit` is mimalloc's committed memory on macOS/Linux and "on Windows, the process's commit charge".
- `Bun.unsafe.memoryFootprint()` (bun-types 1.4.2 and 1.4.4, `bun.d.ts:5736-5741`): `phys_footprint` on macOS, `Pss` from `smaps_rollup` on Linux, `PrivateUsage` (commit charge) on Windows. The docs suggest the fallback `Bun.unsafe.memoryFootprint() ?? process.memoryUsage.rss()`. It is missing from the locked bun-types 1.3.14, so the type pin must move first.
- `Bun.gc(true)` is synchronous: it tells JSC to collect and tells mimalloc to clean up (`bun.d.ts:5761-5770`). Since 1.4.3 it returns memory to the OS before it returns. `Bun.generateHeapSnapshot()` produces the JSC format (Safari/WebKit inspector), and `generateHeapSnapshot("v8")` produces the Chrome format. `--heap-prof` / `--heap-prof-md` write a snapshot on exit, and can be set via `BUN_OPTIONS` (https://bun.com/docs/project/benchmarking, fetched 2026-11-05). `node:v8` `writeHeapSnapshot`/`getHeapStatistics` "describe JavaScriptCore's single heap" (nodejs-compat).
- `process.memoryUsage().heapUsed` accuracy: it reports the size JSC stored at the end of the last collection (PR #43926, open, 2026-09-24, https://github.com/oven-sh/bun/pull/43926). Allocations since the last GC are missing in both the process and the worker counters (PR #44548, open, 2026-10-03, https://github.com/oven-sh/bun/pull/44548). So the solver's `heapUsedMB` (`captcha-solver-worker.ts:74,84`), checked against `maxWorkerHeapMB: 768` (`captcha-solver.ts:62,264`), lags behind and leaves out native/mimalloc memory. A `Bun.gc(true)` before the sample, or a footprint-based check, is closer to the real number.
- RSS: on Windows `rss` is the working set (jsc.d.ts `MemoryUsage.current`). A Job Object limits commit charge, not working set (MS docs above), and the commit charge is what `memoryFootprint()` reports. The memory guard samples `process.memoryUsage.rss()` (`health-monitor.ts:228`) and `/health` reports `rss`/`heapUsed` (`health-monitor.ts:166-171`). Switching both to `memoryFootprint()` would match what actually exhausts memory on each OS.

### 4. happy-dom + Bun leak reports

Bun repo:
- #38211 (closed not_planned, 2026-08-13): a `bun test` GC SIGTRAP with accumulated React/happy-dom state, a regression in 1.3.13 (https://github.com/oven-sh/bun/issues/38211).
- #44707 (open, 2026-10-07): a failing `toEqual` on a happy-dom element builds a multi-MB diff "and can exhaust memory" (https://github.com/oven-sh/bun/issues/44707).
- No open Bun issue was found about happy-dom runtime memory inside Workers.

happy-dom repo (all open):
- #2195 (2026-06-11): undefined custom elements "pin their entire detached document to the Window" (https://github.com/capricorn86/happy-dom/issues/2195).
- #2202 (2026-06-11): the virtual console buffers every log entry forever (https://github.com/capricorn86/happy-dom/issues/2202). The repo passes its own `console: guestConsole` (`captcha-happy.ts:1803`), which may avoid this; UNVERIFIED.
- #2514 (2026-10-14): `MutationObserver` keeps observed nodes alive until `disconnect()` (https://github.com/capricorn86/happy-dom/issues/2514).
- #2424 (2026-09-18): `window.close()` is a no-op for a top-level window (https://github.com/capricorn86/happy-dom/issues/2424). The repo calls `happyDOM.close()` (`captcha-happy.ts:2185`).
- #2148 (2026-04-29): `DOMParser` documents are not cleaned up by `happyDOM.close()` (https://github.com/capricorn86/happy-dom/issues/2148).

The locked happy-dom is 20.11.6 (`bun.lock:32`). npm latest is 21.0.4 (2026-10-20). Whether 21.x fixes any of these is UNVERIFIED (the issues are still open). All of these leaks are bounded by a worker recycle, provided `terminate()` really frees the VM (§2).

### 5. Breaking changes that can affect `bun test` / `bun install --frozen-lockfile`

From https://bun.com/blog/bun-v1.4.4 (2026-10-22):
- `bun install` "understands npm, Yarn and pnpm flags, and rejects unknown ones": `--frozen-lockfil` now errors. CI uses the exact `--frozen-lockfile` (`.github/workflows/ci.yml:33-34`), so this is fine.
- `--frozen-lockfile` is stricter: "a direct dependency locked at a version outside its `package.json` range ... was installed anyway and passed `--frozen-lockfile`" is fixed. A locked version that an `overrides` rule forbids "now ... `--frozen-lockfile` fails with an explanation". CI may newly fail on a drifted lockfile.
- `bun.lock` gains `"hasInstallScript": true`. "Older versions of Bun ignore the new key and drop it the next time they save the lockfile." Mixed 1.4.2/1.4.4 machines will churn the lockfile, so pin everything together. No `lockfileVersion` bump is mentioned. The proxy lock is `lockfileVersion: 1` (`zcode-proxy-src/bun.lock:2`) and the MCP bridge lock is `2` (`mcp/zcode-harness-mcp/bun.lock:2`). Fresh installs resolve in a deterministic order, and peer resolution is "more like pnpm", but "Versions already in `bun.lock` don't change".
- `ws`: an `'error'` without a listener is now an uncaught exception. happy-dom's `WebSocket` imports `ws` (`node_modules/happy-dom/lib/web-socket/WebSocket.js:8`) and attaches only `.once('error')` (:218). In the solver worker, a second error would reach `onUncaught` → `fatal` → recycle (`captcha-solver-worker.ts:42-55`). This is low risk, but run the captcha suite.
- `bun test --coverage` numbers change ("`% Lines` can drop after upgrading"). The proxy has no `bunfig.toml` / `coverageThreshold`, so there is no impact.
- JSC semantic fixes (`+1n * 2n` now throws; `new` on non-constructor natives throws) and `node:http` `res.end()` with a NaN status now throwing are unlikely to affect this repo.

From https://bun.com/blog/bun-v1.4.3 (2026-10-10): fixes for `mock.module()`, fake timers and `--isolate`. No removals that affect `bun test` were found.

Worker message timing: #44574 (1.4.0+, closed not_planned 2026-10-16) means messages are lost when the handler is installed after a top-level `await`: https://github.com/oven-sh/bun/issues/44574. The solver worker installs its listener synchronously at module top level (`captcha-solver-worker.ts:89`), so it is not affected.

Other open issues seen on 1.4.2–1.4.4 (not 1.4.4 regressions):
- #46576: mimalloc livelock under gVisor. It also reproduced on 1.4.2 and on glibc (https://github.com/oven-sh/bun/issues/46576).
- #44186: Workers block on each other's GC marking; `BUN_JSC_numberOfGCMarkers=1` helps (https://github.com/oven-sh/bun/issues/44186).

### 6. Repo usage (read-only grep, `zcode-proxy-src/src`)

| What | file:line |
|---|---|
| Web `Worker` for the solver (no `smol`, env copy, `unref`) | `proxy/captcha-solver.ts:175-178` |
| Worker URL for source vs compiled embedded root | `proxy/captcha-solver.ts:162-164` |
| `recycle()` → `w.terminate()` | `proxy/captcha-solver.ts:203-213` (terminate :209) |
| Recycle triggers (failures / solves / heap) | `proxy/captcha-solver.ts:258-265`; defaults `:60-62` (200 solves, 3 failures, 768 MB heap) |
| Worker self-exit on fault | `proxy/captcha-solver-worker.ts:53` |
| Worker heap report (`process.memoryUsage().heapUsed`) | `proxy/captcha-solver-worker.ts:74,84` |
| Nested eval worker for sync fetch + `Atomics.wait` | `proxy/captcha-happy.ts:95,123`; terminate `:145,:155` |
| happy-dom `GlobalWindow` per solve / `happyDOM.close()` | `proxy/captcha-happy.ts:17,1801,2185` |
| Watchdog `node:worker_threads` eval worker + terminate | `runtime/watchdog.ts:204,215` (constraints noted at :12-20) |
| RSS memory guard / `/health` memory | `runtime/health-monitor.ts:228,240-265,166-171` |
| `resourceLimits`, `smol`, `heapStats`, `bun:jsc`, `Bun.gc`, `generateHeapSnapshot`, `BUN_JSC_*` | **none found** |
| Bun pins | `.github/workflows/ci.yml:30`, `.github/workflows/release.yml:53`, `install.sh:131-147`, `install.ps1:98-102`, `SUPPORT_MATRIX.json:4`, `tests/installer-audit.test.mjs:148,211,262,281,376,394`; nested 1.4.0: `zcode-proxy-src/.github/workflows/ci.yml:35`, `release.yml:54,132` |
| Types pin drift | `zcode-proxy-src/package.json` `"@types/bun": "latest"` → `bun.lock:18,28` = 1.3.14 |

## Sources

All fetched 2026-11-05.

- Bun v1.4.3 release notes, 2026-10-10: https://bun.com/blog/bun-v1.4.3 (markdown: https://bun.sh/blog/bun-v1.4.3.md)
- Bun v1.4.4 release notes, 2026-10-22: https://bun.com/blog/bun-v1.4.4 (markdown: https://bun.sh/blog/bun-v1.4.4.md)
- Bun v1.4.2 release notes, 2026-09-05: https://bun.sh/blog/release-notes/bun-v1.4.2
- GitHub releases (dates from the API): https://github.com/oven-sh/bun/releases/tag/bun-v1.4.4, https://github.com/oven-sh/bun/releases/tag/bun-v1.4.3, https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2
- Workers docs: https://bun.com/docs/runtime/workers
- Node.js compatibility (worker_threads, v8): https://bun.com/docs/runtime/nodejs-compat
- Spawn docs (cgroup, resourceUsage): https://bun.com/docs/runtime/child-process
- Benchmarking / heap tools: https://bun.com/docs/project/benchmarking
- Executables (worker entry points, targets, exec-argv, BUN_OPTIONS), main branch: https://github.com/oven-sh/bun/blob/main/docs/compiler/executables.mdx
- AOT compatibility (unreleased), main: https://github.com/oven-sh/bun/blob/main/docs/compiler/compatibility.mdx
- bun-types 1.4.4 / 1.4.2 (`bun.d.ts`, `jsc.d.ts`): https://www.npmjs.com/package/bun-types/v/1.4.4
- Issues/PRs:
  - #5709 (2023-09-19, closed 2026-05-13), #31646 (merged 2026-06-02), #29331 (closed unmerged 2026-06-26), #33911 (closed 2026-07-24)
  - #46669 (open, 2026-10-24), #46396 (open, 2026-10-21), #28318 (open, 2026-03-20), #29585 (closed 2026-08-18)
  - #34917 (open, 2026-07-21), #34924 (open PR), #32896 (open PR, 2026-06-27), #43825 (open PR, 2026-09-23), #41900 (open PR, 2026-09-08), #39967 (open)
  - #43926 (open PR, 2026-09-24), #44548 (open PR, 2026-10-03), #47013 (open PR, 2026-10-26)
  - #44574 (closed 2026-10-16), #46576 (open, 2026-10-23), #44186 (open, 2026-09-29), #38211 (closed 2026-08-13), #44707 (open, 2026-10-07)
  - All under https://github.com/oven-sh/bun/issues/<n> or /pull/<n>
- happy-dom issues #2195, #2202 (2026-06-11), #2424 (2026-09-18), #2514 (2026-10-14), #2148 (2026-04-29): https://github.com/capricorn86/happy-dom/issues/<n>
- Microsoft Learn, Job Objects (2018-12-05): https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information, https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information
- systemd.resource-control `MemoryMax=`: https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html
