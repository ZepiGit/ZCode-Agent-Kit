# Footprint facts for Round 1 Q6 (S3 ≤ 600 MB)

Measured 2026-11-06 by the footprint explorer. This file reports measurements and arithmetic only. It decides nothing.

## Setup

- Code: `diagnosis/memory` @ 2ccafe2, in a throwaway detached worktree `/home/AgentKit/wt/footprint`. The worktree was removed at the end.
- Linux x64, 8 cores. Node v26.7.0 (local) and v24.22.2 (`npm i node@24` into `/home/AgentKit/overhaul-tools/node24`). Bun 1.4.2 (CI pin); Bun 1.4.4 for the solver and bare rows.
- Every process ran under `run-capped.sh <name> 2G <timeout>`: `ZCODE_OVERHAUL_RUN=1`, isolated HOME, `MemoryMax=2G`, no swap. Logs: `reports/fp-*.log`.
- Kit instance: the memory loop's own `createIsolatedKit` + `startProxySession` (soak-mock upstream, fixture credential, loopback only). Port **18459** only; every probe recorded `isolation.port 18459`, `stop.code 0` and no external connections. Nothing was left listening and no marked process survived.
- Units:
  - RSS = `/proc/<pid>/status` VmRSS.
  - HWM = VmHWM.
  - "lifetime peak" = `wait4()` `ru_maxrss` of the exited child. This is exact for processes too short for a 100 ms sampler.
  - anon/file = RssAnon/RssFile.
  - Values are medians of 3–5 repetitions unless stated otherwise.
- Experiment code (throwaway, not committed): `/home/AgentKit/overhaul-tools/footprint-exp/`. It contains `measure.mjs`, `kit-probe.mjs`, `lean-launch.mjs`, `execve-launch.mjs`, `execve-test.mjs`, `target.sh`, `tiny-waiter.mjs`, `imp.mjs`, `wait4.py`, `bridge-client.mjs`, `bridge-lazy/` and `f*.sh`.
  - `kit-probe.mjs` and `bridge-lazy/node_modules` (a symlink) point into the removed worktree. Re-create it with `git -C /home/AgentKit/wt/overhaul worktree add --detach /home/AgentKit/wt/footprint diagnosis/memory` plus the installs below, then re-run.
- Probe JSON: `/home/AgentKit/overhaul-tools/diag-data/footprint-{31f82c,16e20f,1435ca,6832a6,75500a,eaa5d2,13987c}/probe.json`.
- Installs:
  - `npm ci` at the root.
  - `bun install --frozen-lockfile` in `zcode-proxy-src` (METRICS says "(proxy)", but the lockfile lives in `zcode-proxy-src/`; `proxy/` has none).
  - `npm ci` in `mcp/zcode-harness-mcp`.

## What the measured S3 peak actually was

Recomputed from the full baseline samples (`diag-data/S3-short-2026-11-06T0138-865d06/samples.csv`, kit roles only):

| t (ms) | kit sum | composition |
|---|---|---|
| 12019 | 681.0 | 5 launcher (315) + 5 preflight (311) + proxy (55): start phase of race-10 |
| 13019–20030 | **851.8–852.1** | 5 launcher (364) + **5 bridge (429)** + proxy (59): steady phase; the 5 preflights had already exited |
| 23032 | 460.5 | 10 preflight (race-10-preflight) |

So the 852 MB peak is 5 × (launcher 73 + bridge 86) + proxy 59. The five OMP preflights did not overlap it in this run. A sum-of-everything bound (Q6's framing) is stricter than what was observed.

## Fact 1: bare Node RSS (and flags)

Command: `measure.mjs <label> 1500 --reps 5 -- node [flags] -e "setInterval(()=>{},1e9)"`. Logs: `reports/fp-f1-node26.log`, `fp-f1-node24.log`.

| variant | Node 26 RSS / HWM | Node 24 RSS / HWM | anon / file (26) |
|---|---|---|---|
| bare `-e` | 41.9 / 41.9 | 44.6 / 44.6 | 8.1 / 33.7 |
| bare, script file | 44.0 / 44.0 | 45.0 / 45.0 | 8.2 / 35.8 |
| `--max-old-space-size=16` | 41.8 | 44.6 | — |
| `--max-old-space-size=32` | 41.9 | 44.6 | — |
| `--max-semi-space-size=1` | 41.9 | 44.6 | — |
| `--jitless` | 41.5 | 42.4 | 8.0 / 33.4 |
| `--v8-pool-size=0` | 41.9 | 44.6 (threads 7 → 10) | — |
| `UV_THREADPOOL_SIZE=1` | 41.9 | 44.6 | — |
| all small-heap flags + pool0 + uv1 | 41.9 | 44.7 | — |
| same + `--jitless` | 41.5 | 42.4 | — |
| bare + one `fetch()` (undici) | 58.8 | 59.1 | 14.6 / 44.2 |

- Heap and thread flags do nothing to idle RSS. `--v8-pool-size=0` means "auto", not "none": it adds threads. The libuv pool is lazy, so `UV_THREADPOOL_SIZE` does not matter at idle.
- The Node floor is about **42–45 MB**. About 34–37 MB of that is file-backed (the node binary's pages), and only about 8 MB is anonymous.
- Loading undici (`fetch`) adds +15–17 MB. `node:http` alone adds +13 MB (58.6).
- Bun for comparison: bare `bun -e` is **13.9 MB** (1.4.2) and **12.9 MB** (1.4.4). `--smol` makes no difference (`reports/fp-f3.log`).
- `--jitless` breaks the kit: `zcode-kit run` with `--jitless` exits 4 ("ZCode safe start failed") in 160 ms, on both Node 26 and 24. It cannot be used.

## Fact 2: launcher (`zcode-kit run`)

Probe: `kit-probe.mjs launcher`. Fake `opencode` on PATH = `exec sleep 5`. Launcher-pid RSS was sampled while the harness child was alive. Logs: `reports/fp-probe-launcher.log` (Node 26), `fp-probe-node24.log`, `fp-probe-bun.log`.

| variant | steady RSS while harness runs, 26 / 24 | HWM 26 / 24 | anon (26) |
|---|---|---|---|
| today, proxy already up | **70.5** / 78.4 | 76.4 / 87.6 | 18.7 |
| today, proxy down (launcher starts it) | 71.9 / 79.5 | 77.4 / 89.0 | 20.1 |
| today + `--max-old-space-size=16 --max-semi-space-size=1` | 72.0 / 77.6 | 75.6 / 87.1 | 20.2 |
| preflight in-process, then all references dropped + `gc()` ×2 (`--expose-gc`, small heap) | 69.5–71.1 / 77.8–78.0 | 75.8–76.3 / 87.4 | 17.4–19.0 |
| lean: preflight in a child (`node cli/heal.mjs`); the launcher loads only fs/path/child_process, then `spawnSync` | **49.4** / 49.1 (+ a transient preflight child, see Fact 3) | 49.4 / 49.1 | 9.6 |
| `process.execve` handover after the in-process preflight | **1.9** (= `sleep` itself; kit cost 0) / 1.9 | 63–67.5 before handover / 63.7–65.3 | 0.1 |
| Bun: today's code under `bun` | 33.3 | 33.7 | 7.7 |
| Bun: lean (child preflight) | 20.7 | 20.7 | 3.1 |

- Releasing module references does not help. ESM modules cannot be unloaded, so dropping references and running GC leaves RSS within ±2 MB. The only levers are: load less in the resident process, hand over with execve, or use a different runtime.
- The lean launcher's 49 MB is a floor for any resident Node process that holds `child_process` (bare 44 plus about 5).

### Signals and exit codes (C2): today vs execve

`kit-probe.mjs launcher`, `exitCodes` block. Same results on Node 26 and 24.

| case | today (`spawnSync`) | execve |
|---|---|---|
| harness exits 0 / 7 / 130 | 0 / 7 / 130 | 0 / 7 / 130 |
| harness killed by SIGTERM | caller sees **exit 1** (signal lost; `result.status ?? 1`) | caller sees **signal SIGTERM** |
| SIGTERM sent to the launcher pid | launcher dies; **harness survives as an orphan** | same pid: the harness receives it and exits |

`execve-test.mjs` (`reports/fp-execve26.log`, `fp-execve24.log`, `fp-execve26-preload.log`):

- The pid is preserved: the target sees `pid == EXP_EXECVE_FROM`.
- stdin, stdout and stderr are passed through.
- A trap target received TERM, INT and HUP and returned its own exit codes 43, 42 and 41.
- The pid's RSS after handover is the target's own (1,968 KB for `sleep`).
- The handover also works after the full `zcode-kit.mjs` module graph is loaded (preload run).
- **Inherited ignored signals:** after `process.execve` the target has `SigIgn: 0x1001000`, i.e. SIGPIPE and SIGXFSZ are ignored. A plain `spawn`/`spawnSync` child has `SigIgn: 0`. Adding and then removing a JS listener for both signals before execve restores SIG_DFL (verified `SigIgn: 0` on 26 and 24). `env --default-signal` also works on GNU systems but not on macOS.
- fds: the target sees 0, 1, 2 plus the shell's own 3 and 10, the same as without execve. No Node fds leaked.
- **Failed execve (ENOENT):** Node 26.7 throws a catchable error (`code ENOENT, syscall execve`) and the process continues. **Node 24.22.2 aborts (SIGABRT).**
- Node docs (https://nodejs.org/api/process.html, `process.execve`):
  - Added in v23.11.0 and v22.15.0. Stability 1 (Experimental).
  - "not available on Windows or IBM i".
  - Since v26.1.0 "a failed execve(2) system call now throws an exception instead of aborting".
  - No `exit` handlers run.
  - An `ExperimentalWarning` is emitted. It was not visible when stderr was a pipe, but will likely print on a TTY.
- **Coverage:**
  - Node 20 has no execve. Both `engines` fields are `>=20`, and CI uses `node-version: 20`.
  - Node 22.15+, 24 and 26 have it.
  - On Node < 26.1 a pre-check (`access(X_OK)` on the resolved path) is required to avoid the abort.
- macOS: not run. execve is POSIX and documented as available; UNVERIFIED here.

### Windows (no execve), UNVERIFIED

The launcher must stay resident there. The minimal resident cost is estimated from the Linux numbers:

- lean Node launcher ≈ **49 MB**;
- today's code ≈ 70–79 MB;
- a lean Bun launcher ≈ **21 MB**.

The Node docs give no memory figures, and Windows working-set accounting of shared image pages differs from Linux RSS. All Windows figures are UNVERIFIED. Owner action: A2-type measurement.

## Fact 3: preflight (OMP autostart path)

- Path: `proxy/zcode-proxy-autostart.ts` runs `execFile(RUNTIME, [ROOT/cli/heal.mjs, "--diagnostic-code"])`. `RUNTIME` is pinned by `cli/adapters/omp.mjs:268-273`: the setup's own node/bun `execPath`, else `node` on PATH, else bun.
- `heal.mjs` statically imports `context.mjs`, `quota-diagnostics.mjs` and `lib/transaction.mjs`. `startupPreflight` then dynamically imports `proxy/zcode-proxy-manager.mjs` and uses `fetch`.

Lifetime peaks (`kit-probe.mjs rusage`, `wait4`; `reports/fp-probe-rusage.log`, `fp-probe-node24.log`):

| preflight | Node 26 | Node 24 | Bun 1.4.2 | duration (26) |
|---|---|---|---|---|
| warm (proxy healthy) | **73.1** (74.7–75.0 per run) | 75.5 | **31.4** | 140–154 ms (Bun 40–55 ms) |
| cold (starts the proxy) | **73.6** | 75.7 | **34.5** | ~765 ms (Bun ~655 ms) |

Sampled during races (`kit-probe.mjs preflight`, `reports/fp-probe-pf.log`):

- 5 concurrent cold, 2 rounds, 8 waiters + 2 lock holders: **waiters 62.3 MB median RSS while waiting, HWM 64.2**; holders HWM 64.7.
- A waiter has already loaded everything: the first sample, ≤ 100 ms after spawn, is already 59–62 MB.
- 5 concurrent warm: each about 61 MB (one sample each).

"A waiting preflight that has loaded nothing yet" (`reports/fp-f3.log`):

| process | Node 26 RSS |
|---|---|
| bare Node running a script | 44.0 |
| minimal waiter polling a lock file (fs only) | **48.1** |
| minimal waiter probing the port via `net.connect` | 48.4 |
| minimal waiter using `fetch` for /health | 59.2 |
| `heal.mjs` + manager imported, nothing run | 53.8 |
| same with `--max-semi-space-size=1` | 53.8 |

On Node, a waiter process costs at least 48 MB (65 % of a full preflight). Saving memory therefore means either fewer processes or a Bun runtime (≤ 35 MB for a whole preflight). Loading less in a Node process does not get there.

**Can waiters avoid a process entirely?** This is code reading, not measured.

- The extension already has an in-host health check (`healthy()`, a `fetch` with an 800 ms timeout, inside the OMP host). An in-host check adds no kit process.
- But `ensureProxy()` runs `if (first || !await healthy()) await runPreflight()`, so the first call per host always spawns a preflight, even when the proxy is healthy.
- In-process single-flight exists only per host (`pending`) and per process (`inFlight` in heal.mjs). Across hosts and sessions, the manager start lock is the only single-flight. Every waiter is a full Node process that waits inside `manager.start()`.
- An in-host lock-file wait (O_EXCL or a stat poll) plus health polling would cost 0 kit processes per waiter. Only the one starter would be a process.
- The extra cost in the host (OMP's Bun) was not measured. It is expected to be small (a timer plus a fetch), but this is UNVERIFIED.

## Fact 4: MCP bridge

At start: initialize + `zcode_health`, bridge pid only, against the fixture runtime. `kit-probe.mjs bridge`; `reports/fp-probe-pf.log`, `fp-probe-node24-bridge.log`, `fp-probe-bridge2.log`.

| variant | Node 26 RSS @3 s | Node 24 | anon (26) |
|---|---|---|---|
| today (`dist/index.js`) | **86.0** (S3: 85.8–86.2) | 87.3 | 34.1 |
| lazy HTTP (throwaway: `node:http` + `streamableHttp.js` imported only inside `serveHttp` / `handleMcpPost`) | 79.3 | 79.7 | 30.1 |
| today + `--max-semi-space-size=1` | 79.3 | 79.7 | 27.4 |
| lazy HTTP + semi1 | **73.7** | — | 24.4 |
| lazy HTTP + semi1 + `--max-old-space-size=32` | **72.0** | 71.8 | 22.8 |
| Bun 1.4.2, today's code | 59.2 | — | 24.1 |
| Bun, lazy HTTP | 56.1 | — | 22.1 |
| Bun, lazy HTTP, `--smol` | 55.3 | — | 21.5 |

- The Bun bridge was smoke-checked only: initialize plus `zcode_health` returned `degraded:false`. The bridge test suite was not run under Bun.
- The flags were passed via NODE_OPTIONS in the probe. A real change would put them in the MCP server command line (`node --max-semi-space-size=1 dist/index.js --stdio`), because NODE_OPTIONS would leak to children.
- Per-module attribution, import only (`imp.mjs` + `measure.mjs`; `reports/fp-f4-node26.log`, `fp-f4b-node26.log`, `fp-f4-node24.log`):
  - Node 26 baseline is 45.4 MB. Δ = MB above that baseline.
  - The Δs overlap (shared builtins and zod), so they are **not additive**.

| import set | RSS | Δ |
|---|---|---|
| fs + path + os / crypto / child_process / net (each) | 47.5–48.5 | +2–3 |
| `node:http` | 58.6 | +13.2 |
| `zod/v4` | 61.0 | +15.6 |
| `ajv` | 56.9 | +11.5 |
| SDK `types.js` (zod) | 65.6 | +20.2 |
| SDK `shared/protocol.js` | 68.3 | +22.9 |
| SDK `server/index.js` (protocol + ajv + zod + tasks) | 70.3 | +24.9 |
| SDK `server/stdio.js` | 65.6 | +20.2 |
| SDK `server/streamableHttp.js` (hono + node:http) | 79.2 | +33.8 |
| `@hono/node-server` | 59.9 | +14.5 |
| SDK index + stdio | 70.9 | +25.5 |
| SDK index + stdio + streamableHttp | 82.4 | +37.0 |
| kit modules without the SDK (config, discovery, store, allowlist, interactions, runtime, tasks, settings, log) | 53.4 | +8.0 |
| kit `mcp/tools.js` + `resources.js` + `validate.js` | 52.3 | +6.9 |
| `dist/mcp/server.js` | 83.2 | +37.8 |
| all of `index.js`'s imports | 84.0 | +38.6 |
| all of `index.js`'s imports + gc | 85.0 | — |
| stdio path only (everything except server.js's HTTP imports) | **77.1** | +31.7 |

- Lazy-loading the non-start modules (the HTTP transport) saves about **7 MB** (84 → 77 on import, 86 → 79 at runtime).
- The rest is the MCP SDK core: zod v4 plus ajv plus protocol, about 25 MB. Under the SDK this is irreducible on the stdio path.
- On Node the floor is about 72 MB with flags. ≤ 60 MB is reached only on Bun (55–59), or on Node without the SDK. The kit's own modules import at 53 MB; a hand-rolled stdio JSON-RPC bridge was not built or measured.
- Note (S5): the bridge grows about +28–42 MB per 1,000 tasks. That growth is outside S3 and is not in these numbers.

## Other roles

- **Proxy idle** (Bun 1.4.2, `bun run src/index.ts serve`, coding-plan): 57.9 MB (Node 26 probe) and 56.7 (Node 24 probe). The S3 baseline was 58.6–60.3. anon 20.7, file 37.2.
- **Solver idle as a separate Bun process (Q3).** Bun 1.4.2 / 1.4.4 (`reports/fp-f3.log`):
  - bare: 13.9 / 12.9;
  - solver-worker static deps (captcha-token, guest-error), no happy-dom: **16.5 / 16.2**;
  - `captcha-happy.ts` loaded (happy-dom + undici), no solve: **51.9 / 46.1**, HWM 54.2 / 49.5;
  - `--smol`: −0.5.
  - S3 runs coding-plan, so no solver exists today. A lazily spawned solver contributes 0 in S3.
- **Shared pages (metric caveat).**
  - Every Node process carries 34–52 MB of file-backed RSS: the node binary's pages, physically shared between processes. Bun carries 11–37 MB.
  - VmRSS sums count this once per process. The S3 852 MB contains about 10 × 37–52 MB of such pages.
  - Estimated unique memory at the S3 peak is anon (5 × 19 launcher + 5 × 34 bridge + 21 proxy ≈ 286) plus one Node image (≈ 52) and one Bun image (≈ 37), about **375 MB**. This is a derived estimate, not a measured PSS sum.
  - The budget metric (RSS sum vs PSS) is not a measurement question. It is listed here because it changes every number below.

## Fact 5: per-role plans for S3 (5 run + 5 OMP preflight + proxy + solver idle)

### Accounting model

- Everything is summed as if concurrent: Q6's framing, stricter than the observed peak.
- Per `run` session the worst instant is max(start phase, steady phase):
  - start = launcher with its in-process preflight;
  - steady = resident launcher + bridge.
- With execve the two phases never coexist inside one session: the bridge is spawned by the harness, which exists only after handover.
- Targets are the measured value rounded up by about 2–5 %.

### Plan P (POSIX: Linux and macOS; Node, smallest change)

| role | count at peak | target each | measured basis | subtotal |
|---|---|---|---|---|
| launcher, start phase (in-process preflight, then execve) | 5 | 70 | pre-handover HWM 63–67.5 (26), 63.7–65.3 (24) | (inside session max) |
| launcher, after handover | 5 | 0 | 1.9 MB = harness's own `sleep`; pid is the harness | 0 |
| MCP bridge (lazy HTTP + `--max-semi-space-size=1`) | 5 | 75 | 73.7 (26); 72.0/71.8 with `--max-old-space-size=32` | (inside session max) |
| **per run session = max(70, 0 + 75)** | 5 | **75** | — | **375** |
| OMP preflight processes (single-flight starter; waiters wait in the OMP host, no process) | 1 | 76 | lifetime peak 73.1–75.7 | 76 |
| OMP waiters in host | 4 | 0 | no process (code reading; host cost UNVERIFIED) | 0 |
| proxy (idle, coding-plan) | 1 | 62 | 56.7–60.3 | 62 |
| solver idle (Bun child, happy-dom loaded on first solve) | 1 | 20 | 16.2–16.5 | 20 |
| **sum** | | | | **533 → margin 67 MB (11 %)** |

Variants of Plan P:

- Solver idle with happy-dom preloaded (target 55; basis 46.1–51.9): sum **568 → margin 32**.
- Solver spawned lazily (0 in S3): **513 → margin 87**.
- Without in-host waiters, every OMP launch keeps a Node preflight: 375 + 5 × 76 + 62 + 20 = **837 → over by 237**.
  - Same with Bun preflights (target 36; basis 31.4–34.5): 375 + 180 + 82 = **637 → over by 37**.
  - Same with Node minimal waiters (fs poll 48) + 1 starter: 375 + 76 + 4 × 50 + 82 = **733 → over**.

### Plan B (all Bun, no in-host waiting needed)

| role | count | target | basis | subtotal |
|---|---|---|---|---|
| launcher start phase (preflight in-process on Bun), then execve on POSIX | 5 | 36 | Bun preflight lifetime peak 31.4–34.5; today's launcher on Bun 33.3–34.6 | (inside session max) |
| bridge on Bun (lazy HTTP) | 5 | 58 | 55.3–56.1 (59.2 today's code); smoke-only | (inside session max) |
| per run session = max(36, 58) | 5 | 58 | — | 290 |
| OMP preflight on Bun, one process per launch | 5 | 36 | 31.4–34.5 | 180 |
| proxy | 1 | 62 | 56.7–60.3 | 62 |
| solver idle | 1 | 20 | 16.2–16.5 | 20 |
| **sum** | | | | **552 → margin 48** (with in-host waiters instead: 1 × 36 → 408) |

### Plan W (Windows: no execve, launcher resident). All numbers are Linux measurements, UNVERIFIED on Windows.

- **Node launcher + Node bridge cannot fit:** 5 × (lean Node launcher 49 + bridge 74) = **615 MB** before any preflight, proxy or solver. Today's launcher: 5 × (70.5 + 86) = 783.
- **Lean Bun launcher + Node bridge:** steady 21 + 75 = 96 per session. Start phase: 21 + Bun preflight child 36 = 57.
  - 5 × 96 = 480, + 1 OMP starter (Node 76) + proxy 62 + solver 20 = **638 → over by 38**.
  - With the OMP starter on Bun (36): **598 → margin 2**. This is not a usable margin.
- **Lean Bun launcher + Bun bridge:** steady 21 + 58 = 79 per session.
  - 5 × 79 = 395, + 1 OMP starter (Bun 36) + 62 + 20 = **513 → margin 87**.
  - With 5 Bun preflights instead of 1: 657 → over.
  - With 5 Bun preflights and the solver lazy (0): 637 → over. Windows also needs in-host single-flight.
- Not evaluated: a native or batch shim resident instead of Node; launcher exit after a detached spawn (breaks C2 exit-code and stdio semantics).

### Check of the proposed sub-budgets (Q6)

- **"Launcher 45":**
  - Below the measured floor for any resident Node launcher, which is 48–49 MB (lean: 49.4/49.1; bare script 44; flags give 0).
  - On POSIX the steady figure can be 0 via execve, but the start-phase peak is 63–67.5.
  - On Bun a lean resident launcher measured 20.7.
- **"Bridge 60":**
  - Not reachable on Node with the MCP SDK. The best measured was 72.0, and the import floor on the stdio path is 77 without flags.
  - Reachable on Bun (55.3–59.2) or, possibly, on Node without the SDK (kit modules 53 import-only; unmeasured at runtime).
- **"5 preflights in ~15 MB":**
  - Impossible as 5 processes on either runtime: the Node waiter floor is 48 MB and a whole Bun preflight is 31–35.
  - Possible only if waiters are not processes, i.e. in-host waiting in the OMP extension.

## Raw excerpts

```
# fp-f1-node26.log
{"label":"bare","MEDIAN":true,"rssMB":41.9,"hwmMB":41.9,"anonMB":8.1,"fileMB":33.7,"pssMB":10.6,"threads":0}
{"label":"all-small+jitless","MEDIAN":true,"rssMB":41.5,"hwmMB":41.5,"anonMB":8.1,"fileMB":33.4,"pssMB":10.5,"threads":0}
{"label":"bare-fetch","MEDIAN":true,"rssMB":58.8,"hwmMB":58.8,"anonMB":14.6,"fileMB":44.2,"pssMB":18.1,"threads":0}
# (threads column was a reporting bug in that run; fixed later: 7 threads bare)

# fp-probe-launcher.log (Node 26)
{"label":"today-warm",...,"medRssWhileChildMB":70.5,"medHwmMB":76.4,"medAnonMB":18.7,...}
{"label":"today-warm-smallheap-jitless",...,"rows":[{"code":4,"ms":162,...,"tail":"ZCode safe start failed. ..."}]}
{"label":"lean-child-preflight-warm",...,"medRssWhileChildMB":49.4,"medHwmMB":49.4,"medAnonMB":9.6,...}
{"label":"inproc-gc-warm",...,"medRssWhileChildMB":69.5,"medHwmMB":75.8,...}
{"label":"execve-warm",...,"medRssWhileChildMB":1.9,"medHwmMB":65.1,"medAnonMB":0.1,"rows":[{"code":0,...,"handedOver":true,...,"threads":1,...}]}
{"exitCodes":{"today":{"0":0,"7":7,"130":130,"harnessKilledBySIGTERM":{"code":1,"sig":null},"launcherSIGTERM":{"code":null,"sig":"SIGTERM","harnessPid":459564,"launcherPid":459556,"harnessSurvived":true}},"execve":{"0":0,"7":7,"130":130,"harnessKilledBySIGTERM":{"code":null,"sig":"SIGTERM"},"launcherSIGTERM":{"code":null,"sig":"SIGTERM","harnessPid":459597,"launcherPid":459597,"harnessSurvived":false}}}

# fp-execve26.log / fp-execve24.log
"stdout": ["pid=454105 from=454105","SigBlk:\t0000000000000000","SigIgn:\t0000000001001000","SigCgt:\t0000000000010002","fds=0 1 10 2 3 ","stdin=hello"]
26: "enoent": {"exit": 2, "signal": null, "stderr": ["execve failed: ENOENT execve /nonexistent/harness", "(node:454147) ExperimentalWarning: process.execve is an experimental feature ..."]}
24: "enoent": {"exit": null, "signal": "SIGABRT", "stderr": ["node:internal/process/per_thread:326", "    _execve(execPath, args, envArray);", "    ^"]}
# reset trick (26 and 24): process.on/off('SIGPIPE'|'SIGXFSZ') before execve -> "SigIgn:	0000000000000000"

# fp-probe-rusage.log (wait4 ru_maxrss, KB)
node-warm 74988 74672 74836 74936 74848 (140-154 ms) | bun-warm 33024 32012 32052 32184 32268
node-cold 75344 75608 75412 (~765 ms)              | bun-cold 35336 35400 35268

# fp-probe-pf.log
{"label":"cold-5-concurrent",...,"waiters":{"medHwmMB":64.2,"medRssMB":62.3,"count":8},"holders":{"medHwmMB":64.7,"count":2}}
{"label":"today","flags":[],"medRss3sMB":86,...} {"label":"lazy-http",...,"medRss3sMB":79.3} {"label":"lazy-http-semi1-old32",...,"medRss3sMB":72}
{"proxyIdle":{"pid":460106,"rssMB":57.9,"hwmMB":59.1,"anonMB":20.7,"fileMB":37.2,"threads":19}}

# fp-probe-bridge2.log
{"label":"lazy-http-semi1",...,"medRss3sMB":73.7} {"label":"bun-today",...,"medRss3sMB":59.2} {"label":"bun-lazy-http",...,"medRss3sMB":56.1} {"label":"bun-lazy-http-smol",...,"medRss3sMB":55.3}

# fp-f3.log
waiter-fs 48.1 | waiter-net 48.4 | waiter-fetch 59.2 | heal-import-only 53.8 | launcher-import-only 53.8
bun1.4.2-bare 13.9 | bun1.4.2-solver-worker-mod 16.5 | bun1.4.2-happy-loaded 51.9 | bun1.4.4-bare 12.9 | bun1.4.4-solver-worker-mod 16.2 | bun1.4.4-happy-loaded 46.1
```

## Commands (all wrapped in `run-capped.sh <name> 2G <timeout> --`)

```
bash footprint-exp/f1-bare.sh node            # and with the Node 24 binary
node footprint-exp/execve-test.mjs node [<preload module>]
node footprint-exp/kit-probe.mjs launcher     # isolated kit, port 18459
node footprint-exp/kit-probe.mjs preflight bridge proxy
node footprint-exp/kit-probe.mjs preflight bunonly
node footprint-exp/kit-probe.mjs rusage
node footprint-exp/kit-probe.mjs bridge bridge2
<node24> footprint-exp/kit-probe.mjs launcher bridge rusage proxy
bash footprint-exp/f3-waiters-solver.sh node
bash footprint-exp/f4-bridge-imports.sh node  # and <node24>
bash footprint-exp/f4b-breakdown.sh node
```

Node 24 binary: `/home/AgentKit/overhaul-tools/node24/node_modules/node/node_modules/node-linux-x64/bin/node`. The sibling `node_modules/node/bin/node` is the npm wrapper.
