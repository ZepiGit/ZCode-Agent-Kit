# Memory and crash diagnosis (Phase 1B)

- Date: 2026-11-06. Lead: claude-opus-5-5, logged substitute for gpt-6.1-sol-subagent.
- Code under test: `overhaul/stability-terminal-ux` @ 0960696, which is origin/main 9e45d05 plus the run tracker. No product code was changed.
- Loop: branch `diagnosis/memory` in `/home/AgentKit/wt/diagnosis-memory`, commits 20fdcfb, ebf9abf and 2ccafe2. Everything is under `tests/memory/`.
- Platform: Linux x64, 8 cores, 32 GB RAM, no swap. Node 26.7.0, Bun 1.4.2 (the CI pin), happy-dom 20.11.6.
- Every run went through `run-capped.sh` (MemoryMax 3–4 G, no swap, timeout, isolated HOME).
- Raw data (CSV per second, heap snapshots) is in `/home/AgentKit/overhaul-tools/diag-data/`. Summaries and excerpts are in `data/` next to this file.

## 1. Verdict in one table

Verdicts below use the loop's current rules. Two runs were evaluated before the last rule change and were re-checked with `reverdict.mjs` (`data/reverdict-current-rules.txt`).

| Scenario | Result | What broke the budget |
|---|---|---|
| S1 proxy steady state, 30,000 requests (long) | GREEN | nothing: 0.07 %/1k, plateau 127 MB, HWM 182 MB |
| S1 burst (N concurrent 10.8 MB bodies) | **RED** | proxy HWM 219 / 425 / 998 / 1,619 MB at N = 1 / 4 / 16 / 32 |
| S1 stalled readers (3,000) | GREEN | heap 6 MB after idle, no retention |
| S2 captcha solver | **RED** | 958 MB RSS before the 200-solve recycle; 686 MB guest heap retained before the heap recycle; CDN map +151 MB (short) / +502 MB (long) |
| S3 5/10 concurrent launches | **RED** | kit footprint 852 MB; killed lock holder → 7–8/10 launches fail and a stale lock is left. Exactly one proxy in every race. |
| S4 50 lifecycle cycles + adversaries | **RED** | Ctrl-C during start leaves a stale lock (5/8); with a stale lock the respawn (memory guard / watchdog) path ends with **no proxy** |
| S5 MCP bridge, 400 tasks | **RED** | +11 MB RSS over 400 tasks (~42 %/1k), net rise 13 %; per-task heap never evicted |
| S6 TUI | **RED** | log pane holds 125 MB of heap with 64 KB lines (line cap holds, byte cap missing) |
| S7 disk-adjacent | **RED** | `proxy.log` is never rotated while the proxy runs (6.4 MB > 6 MB budget after a 6 MB fill); responses store stays bounded (+63 MB heap at its cap) |

## 2. Root causes, ranked by MB contribution

### RC1 · The captcha solver worker keeps every closed happy-dom window until it is recycled (start-plan; the shipped default)

**Measured** (S2: real dispatcher `captcha-solver.ts` → real worker → real `captcha-happy` solve path, offline guest document):

| solves in a generation | 10 | 100 | 200 (recycle) | after recycle |
|---|---|---|---|---|
| process RSS (MB) | 179 | 550 | 958 | 568 → 76 when idle |
| worker JS heap after a full GC (MB) | 40 | 265 | 512 | 26 |

- RSS grows by **+4.1 MB per solve**. The JS heap retained after a forced full GC grows by **+2.5 MB per solve**. A minimal guest (no globals, timers or listeners) still retains 0.9 MB per solve (`data/S2-gc.worker-heap.jsonl`).
- Long profile (2,000 solves) is a sawtooth: ten generations, each peaking at 0.9–1.0 GB RSS (worker heap 585–679 MB), HWM 1,068 MB. Recycling bounds the growth, but only at about 1 GB.
- With a guest that keeps heap inside one generation (phase B), **686 MB** stays retained until the heap trigger fires. That trigger is 768 MB of JS heap, measured inside the worker after a solve. Recycling then returns all of it (687 MB back within 5 s).

**Dominators** (JSC heap snapshot taken in the worker after 12 solves with a marker class; analyzer in `diag-scripts/retainers*.py`):
- 240,000 marker objects are present, which is 12 windows × 20,000. Every window of the generation is alive.
- Top classes by self size: string 12.8 MB, marker objects 7.3 MB, FunctionCodeBlock 3.6 MB, ModuleRecord 2.4 MB.
- Retaining paths per window:
  - 8 of 12 run through `<root> → {browserFrame,…}` (the `_domOwners` WeakMap value) `→ DetachedBrowserFrame.page.console.{trace|warn|debug|log}`, a no-op closure over `createDom`'s lexical environment (`w`).
  - 1 runs through `globalThis.window`, an alias getter that still points at the first closed window.
  - 1 runs through `FunctionCodeBlock → WithScope → scope.clearInterval`, i.e. compiled guest code.
  - 1 runs through a `Structure`.

**Refuted retainers:**
- Guest timers and DOM listeners: switching them on or off changes nothing (2.57 vs 2.57 MB per solve).
- The `_domOwners` WeakMap itself: deleting the entry after close leaves retention at 2.60 MB per solve. The WeakMap path is an ephemeron artifact of the snapshot, not the root.
- Plain happy-dom with no kit code does not retain closed windows (`diag-scripts/plain-happydom.ts`; its script path differs, so this is a weak control).

**Mechanism:** `captcha-happy.ts` documents that under Bun, guest scripts run in the worker's host realm. The kit aliases window globals onto `globalThis` and wraps guest code in `with` scopes, so compiled guest code and scope chains in the shared realm keep windows reachable. The only thing that actually frees them is terminating the worker. The exact GC root is not pinned down further: compiled guest code blocks and alias getters are the two remaining candidates. Finding every such reference is the wrong fix class; process isolation is the right one (see decision D1).

**Why it reaches crash territory:**
- The worker is a thread of the proxy, so it gets no OS-level cap.
- Recycling waits for 200 solves, or 768 MB of *JS heap*. RSS runs about 1.8× the JS heap.
- The memory guard checks RSS every 60 s. It recycles once per episode above 1,536 MB, and restarts only after 3 samples above 3,072 MB.
- The real vendor SDK is far heavier than this fixture (the 2026-09-24 incident reached 11 GB). The per-solve cost of the real SDK is **unmeasured** (owner action A1).

| | |
|---|---|
| Confirmed hypotheses | "happy-dom Windows surviving close"; "in-process memory heuristic recycling too late" |
| Refuted on Linux | "workers never terminated": a worker parked in `Atomics.wait` holding 256 MB is reclaimed at the deadline (−5 MB after 5 hangs); 23 generations terminated cleanly. Windows is unverified. |

### RC2 · Request bodies in flight have no byte or concurrency limit (every plan)

**Measured** (S1 `--variant burstN`, N concurrent ~10.8 MB `/v1/messages` bodies):

| concurrent bodies | 1 | 4 | 16 | 32 |
|---|---|---|---|---|
| proxy VmHWM (MB) | 219 | 425 | 998 | 1,619 |
| JS heap peak (MB) | 98 | 114 | 680 | 898 |

- That is about **4.2–4.8 MB of RSS per MB of body in flight**. The handler keeps several copies of each body: read chunks, a joined copy, the string, `JSON.parse`, translate/transform, and the upstream body.
- Afterwards RSS returns to 85–93 MB. This is a spike, not a leak.
- The ceiling in code is `maxConnections = 128` × the 32 MB `readBody` cap × ~4.5, which is a multi-GB theoretical peak.
- Mixed 8 MB image and 10 MB text payloads at only 4 requests/s already reach HWM 422 MB (`S1-bigbody`).
- This is a new finding; it was not on the suspect list.

### RC3 · Every harness session costs about 160 MB of Node processes outside the proxy

**Measured** (S3, real `zcode-kit run opencode` and the real OMP preflight `cli/heal.mjs --diagnostic-code`; the fake harness holds one real MCP bridge):

| process | RSS each | lifetime |
|---|---|---|
| launcher (`zcode-kit run`) | 74 MB | the whole harness session (`spawnSync` keeps the node process alive) |
| MCP bridge | 86 MB | per session |
| preflight | 55–73 MB | transient; 10 at once = 543–623 MB for about 1 s |
| proxy | 60 MB | idle, shared |

- Kit footprint peaked at **852 MB** with 5 run + 5 preflight launches. 10 sessions held ≈ 1.6 GB plus the proxy.
- This is a new finding: users running fleets of parallel agent sessions pay this linearly.

### RC4 · The CDN cache memory map has no eviction (start-plan, inside the worker)

- `CaptchaCdnCache.memory` drops an entry only when it is re-read after its TTL, or when it is invalidated.
- Measured: 600 distinct 256 KB URLs → +151 MB; 2,000 → +502 MB.
- It lives in the worker, so a recycle resets it. Its real contribution depends on how many distinct `dynamicJS` URLs one generation sees, which is unknown without live traffic (conditional).

### RC5 · The TUI log pane caps lines, not bytes

- 100,000 ordinary lines: +2 MB heap. Resize storm of 5,000 frames: +0 MB.
- 4,000 records of 64 KB each: plateau at **+125 MB** heap (2,000 × 64 KB), RSS 218 MB.
- TUI only.

### RC6 · Responses store: bounded as designed

- Driven to its byte cap (1,500 × 64 KB inputs): heap +63 MB, RSS 85 → 159 MB.
- The 64 MB / 1,000-entry bound holds. It is a constant cost of up to ~74 MB RSS, not a leak.
- Refutes "unbounded responses/store.ts".

### RC7 · MCP bridge task retention (small, linear)

- S5, 400 tasks: RSS 86 → 97–100 MB, a rise of ~28–42 MB per 1,000 tasks.
- V8 snapshot diff between 30 and 230 tasks: self size 19.7 → 20.5 MB, about **4 KB of JS heap per task**. Per task that is 2 Maps (`toolCalls`, `artifacts`), 1 Set, and the `persist` / `onTerminal` closures. The rest is V8 heap expansion.
- `TaskManager.tasks` is never pruned, and every stored task is reloaded at boot (+3 MB per 400 tasks).
- On disk: 3 files and 4.75 KB per task, never pruned (1.9 MB for 400 tasks).

### RC8 · `proxy.log` grows while the proxy runs (disk)

- 148 B per request at the shipped log level, i.e. 14 MB per 100,000 requests.
- The manager rotates the file only in `start`, and the proxy writes to the inherited fd for its whole life. After a 6 MB fill, logging continued with no rotation (6.37 MB).
- Bounded by code: `install.log` (truncated per setup), `heal.log` (2 × 64 KB), `dump.ts` (opt-in and stripped from the managed proxy's env).

### RC-L · A killed or Ctrl-C'd start leaves a stale lock, and that breaks recovery (0 MB, but sessions go down)

**Measured:**
- SIGKILL of the lock holder while 10 launches race: 7–8 of 10 launches fail at once (`cause=startup`), and the lock is left stale.
- SIGINT (Ctrl-C) of `proxy start` at 0–600 ms: 5 of 8 trials leave a stale lock. The orphaned child proxy survives, healthy.
- Until someone deletes `logs/manager.lock` by hand:
  - `stop` and `restart` refuse (exit 4);
  - a later hung proxy cannot be recovered (10/10 launches fail);
  - the memory guard / watchdog restart path (`respawn <pid>` while the proxy exits) ends with **no proxy** (`manager error: stale or unreadable manager start lock`).
- The refusal to take over automatically is deliberate (AUD-001, two contenders deleting each other's fresh lock). Node's default SIGINT handler exits without running `finally { releaseStartLock() }`.

**The exactly-one-proxy guarantee held under every adversary tried:**
- races of 5 and 10 (mixed, preflight-only, run-only);
- a killed holder;
- a hung proxy past its startup grace raced by 10 launches: one replacement, all 10 succeed, each waits about 36–44 s for the hung-own proof;
- 50 start/stop/restart/crash/update cycles: 0 leaked proxies, 0 listeners after stop, 1 file in `logs/`;
- a respawn storm: 3 restarts allowed, then refused.

So "several proxies started by parallel sessions" is **refuted** on Linux. The happy-path guarantee is real; its *purpose* (every session gets a working proxy, and recovery stays possible) fails under the kill and Ctrl-C adversaries.

## 3. Hypotheses: confirmed vs refuted

| Suspect (brief) | Verdict | Evidence |
|---|---|---|
| Unbounded Maps/caches: responses store | refuted | RC6: bounded at 64 MB |
| `_stallCounts` | refuted (code only, not measured) | keyed by pe URL, deleted on success and on eviction, worker-local |
| CDN cache | confirmed (mechanism); size conditional | RC4 |
| session-context / client-session maps | refuted at S1 scale | 30,000 requests at 0.07 %/1k; TTL 900 s |
| happy-dom Windows / guest timers surviving close | windows: **confirmed**; timers: refuted as the retainer | RC1 |
| Workers/children never terminated or reaped | refuted on Linux; Windows unverified | RC1, S4 (23 generations, 50 cycles, 0 leaks) |
| Several proxies from parallel sessions | refuted | RC-L (max 1 simultaneous in every round) |
| SSE/stream buffering without backpressure | refuted in MB | S1-stalled: 3,000 stop-reading-then-disconnect clients, heap 6 MB after idle. The drain wait in `writeWebResponseToNodeResp` has no close guard; no measurable leak. |
| Log ring buffers without a cap | line cap holds; byte cap missing; proxy.log not rotated while running | RC5, RC8 |
| In-process memory heuristic recycling too late | **confirmed** | RC1: 686 MB retained before the heap recycle, 958 MB RSS before the solve-count recycle |
| MCP task retention | confirmed, small | RC7 |
| Not on the list | **new:** no admission limit on body bytes (RC2); per-session Node footprint (RC3); stale lock breaks recovery (RC-L) | |

## 4. Isolation proof (SELF-HOSTING HAZARD)

How each path resolves (source):
- **State dir:** `lib/state.mjs stateDirectory()`.
  - If `ZCODE_KIT_STATE_DIR` is set, it must be absolute and is used as is.
  - Otherwise a checkout uses its root.
  - An npm install uses `$XDG_STATE_HOME|~/.local/state/zcode-agent-kit/installs/<sha256(root)[:24]>`.
  - `cli/context.mjs createCtx()` derives `keyFile = <state>/.proxykey`, `config = <state>/proxy/config.yaml`, `logDir = <state>/logs` (pid file, `manager.lock`, `respawn.json`, `proxy.log`, `heal.log`) and `generated = <state>/generated`.
- **Port:**
  - The manager's `loadPort()` and `ctx.port()` both read the `^  port:` line of that config (8457 if it is missing).
  - The proxy reads `server.port` from the same file, passed as `ZCODE_PROXY_CONFIG` by `lib/proxy-env.mjs`.
  - `ZCODE_PROXY_PORT` and the other `ZCODE_PROXY_*` / `CAPTCHA_*` variables are stripped from the managed proxy's env, so the config file is the only port source.
- **Credentials:** `zcode-proxy-src/src/auth/store.ts` uses `ZCODE_PROXY_CREDENTIALS_PATH`, falling back to `homedir()/.zcode-proxy/credentials.json`. The key derives from `ZCODE_PROXY_CREDENTIAL_SECRET`, falling back to the HOME/platform seed. Both env vars survive `proxyEnv`.
- **HOME-derived paths:** the CDN cache (`~/.zcode-captcha-cdn-cache`), OMP dirs and adapters.

What the loop sets (`tests/memory/lib/isolated-kit.mjs`):
- `ZCODE_KIT_STATE_DIR=<run>/tmp/kit-*/state`, an isolated `HOME`/`USERPROFILE`/`XDG_*`/`TMPDIR`, and `ZCODE_KIT_BUN`.
- A **generated** fixture credential, written by the proxy's own `saveCredential` with synthetic values and encrypted with a per-run random secret.
- A config filled from `proxy/config.example.yaml`:
  - port 18457;
  - a random key;
  - `plan: coding-plan`;
  - zai upstream → the loopback soak mock;
  - claim, endpoint routing and MCP off.

Guards:
- Port 8457 and 18458 are refused; only 18457–65000 is allowed.
- Running with HOME = the real home is refused.
- Running without `ZCODE_OVERHAUL_RUN=1` (or the CI flag `ZCODE_MEMLOOP_ALLOW=1`) is refused.

Proven on the live process (`data/S1-long.summary.json` → `notes["isolation.facts"]`), read from `/proc/<proxy pid>/environ` and its fds:
- HOME, `ZCODE_PROXY_CONFIG`, `ZCODE_KIT_STATE_DIR` and the credentials path are all the isolated ones.
- The only listening port is `[18457]`.
- There are no non-loopback TCP peers at start, and none in checks every 5 s during the whole run (`isolation.externalConnectionsDuringRun: []`).

Not touched:
- No kit is installed on this machine (RUNLOG Phase 0), and nothing listens on 8457.
- The owner checkout, `.proxykey`, `credentials.json` and account stores were never read.
- One background command lost its `cd` and started in the owner checkout's cwd. It failed immediately with module-not-found and wrote nothing.

## 5. The loop: commands, design, how to read it (README section)

```
# one command per scenario (short = CI-sized minutes; long = local soak)
run-capped.sh memloop-S1 3G 3600 -- node tests/memory/run.mjs S1 --profile short|long
node tests/memory/run.mjs S1 --variant burst16|bigbody|stalled
node tests/memory/run.mjs S2 [--variant gc]     # S2 needs 4G for the hang phase
node tests/memory/run.mjs S3 [--variant hung]
node tests/memory/run.mjs S4 | S5 | S6 | S7
npm run memloop -- S1 --profile short             # same entry via package.json
node tests/memory/reverdict.mjs <run dir> [budgets.json]   # re-judge a finished run
node --test tests/memory/verdict.test.mjs         # the RED rules, pinned
```

- **Env:**
  - `ZCODE_MEMLOOP_OUT` sets the output root (default `.memloop/`, which is gitignored).
  - `ZCODE_MEMLOOP_PORT` runs a second proxy scenario side by side (default 18457).
  - `ZCODE_MEMLOOP_ALLOW=1` is for disposable CI runners.
- **Sampler** (`lib/sampler.mjs`):
  - Every second it finds every process carrying `ZCODE_MEMLOOP_RUN=<id>` in its environ. Detached proxies keep the marker, so orphans are visible.
  - It records VmRSS, VmHWM, threads, FD count, ppid and role (proxy, manager, preflight, launcher, mcp-bridge, mock, fake-harness, scenario). The role `kit` is everything except the fixtures.
  - JS heap is taken from `/health` `details.heapUsedMB` for the proxy, and from in-process reports for S2 and S6.
  - The "no real upstream" proof is `connectionsOf(pid)` over `/proc/net/tcp`.
- **RED** (`lib/verdict.mjs`), any of:
  - Growth after a 25 % warm-up above budget (% per 1,000 work units, by least squares), **and** a trend. The trend is either the last 3 of 6 window medians each rising more than 1 %, or the last window at least 10 % above the first. The second rule exists because a slow leak (S5) rises less than 1 % per window.
  - A role or per-process peak above budget. The per-process peak includes VmHWM, which catches spikes between samples.
  - More processes of a role than budgeted.
  - Any marked process alive after the scenario's own stop. The loop then reaps it, so a run never leaves processes behind.
- **Outputs:** `samples.csv`, `summary.json` (checks, role summary, budgets, notes, orphans) and the exit code: 1 RED, 0 GREEN, 2 harness failure.
- **Limits:**
  - Linux only (`/proc`). The Windows sampler is a missing seam.
  - S1/S3/S4/S7 run `coding-plan`, so the captcha path is measured in-process in S2 with the offline fixture, not the real SDK.

## 6. Proposed budgets for §9 (measured baseline → budget)

| Budget | Baseline | Proposal |
|---|---|---|
| S1 proxy steady RSS, mixed load | median plateau 127 MB, HWM 182 MB | steady ≤ 160 MB; peak ≤ 250 MB (keep) |
| S1 growth | long 0.07 %/1k; short 5.5 %/1k (allocator warm-up) | short ≤ 5 %/1k + trend rule; long ≤ 1 %/1k |
| S1 burst HWM, 16 / 32 × 10.8 MB bodies | 998 / 1,619 MB | ≤ 400 / ≤ 600 MB (−60 %), with an in-flight byte limit and a shed status |
| S2 solver cost above proxy base, per generation | ~880 MB (958 − 76) | ≤ 300 MB, hard-capped by the OS (separate process) |
| S2 retained before recycle | 686 MB (long: 619) | ≤ 300 MB |
| S2 hung-solve reclaim | −5 MB | ≤ 64 MB (keep) |
| S2 CDN memory map | +151 MB / 600 URLs | ≤ 64 MB, entries evicted by count/bytes |
| S3 proxies at 10 concurrent launches | 1 | exactly 1 (keep) |
| S3 failed launches incl. killed holder | 7–8 / 10 | 0 |
| S3 stale locks after a round | 1 | 0 |
| S3 kit footprint at 10 launches | 852 MB (5 run + 5 preflight); ~160 MB per session | ≤ 600 MB total (§9). Needs decision D2 on the bridge and launcher. |
| S4 leaked proxies / listeners / log files | 0 / 0 / 1 | keep |
| S4 stale lock after Ctrl-C during start | 5 / 8 | 0 |
| S4 respawn with a stale lock | no proxy | proxy up |
| S4 respawns per 15 min | 3 | ≤ 3 (keep) |
| S5 bridge growth per 1,000 tasks | ~42 %/1k, net +13 % | ≤ 5 %/1k; task records bounded by count or TTL; store pruned |
| S6 log pane heap incl. long lines | +125 MB | ≤ 16 MB (byte cap) |
| S7 proxy.log while running | unbounded (6.37 MB, no rotation) | ≤ 6 MB (5 MB + one rotation) |
| S7 responses store heap at cap | +63 MB | ≤ 96 MB (keep) |
| §9 "peak improves ≥ 30 % where baseline exceeded budget" | applies to S1 burst, S2, S3, S6 | — |

## 7. Seams for regression tests

| Area | Seam | Status |
|---|---|---|
| Process RSS, counts, orphans | the loop itself (process level) | exists |
| Proxy heap and RSS | `/health` `details` | exists |
| Captcha solver | `configureCaptchaSolver({ backendModule })` + `getCaptchaSolverStats()` + the fixture backends | good seam |
| Captcha solver memory | `stats` does not expose the worker heap it already receives (`heapUsedMB`) or the RSS delta | **missing**. Also: no OS-level cap is possible while the solver is a thread. |
| Request admission (RC2) | none: no limiter exists | **missing seam** |
| Start lock / stale takeover | `createManager({ root, home, processStartMsImpl, … })` with injectable timings | exists; S3/S4 drive it end to end |
| Launcher footprint (RC3) | `launchHarness(ctx, id, args)` with a fake harness on PATH | exists |
| MCP task retention | the MCP client in `test/integration/client.mjs` | exists; `TaskManager` has no eviction API to assert against |
| TUI pane | `LogPane` (pure class) | good unit seam for a byte cap |
| `proxy.log` rotation while running | the proxy writes to the manager's inherited fd | **missing**: no owner can rotate it, so this is a design gap |
| Windows | sampler is `/proc`-only | **missing**: the windows-latest CI leg cannot run the loop |

## 8. Open decisions for the owner (via the Owner Proxy)

- **D1** Captcha solver isolation. Option A: a child process with an OS memory cap (Job Object on Windows, cgroup/`prlimit` on Linux) and recycling. Option B: keep the in-process worker with tighter thresholds. C1 points to A; it is a one-way door for the IPC design.
- **D2** Does the per-session MCP bridge count toward "total kit footprint ≤ 600 MB in S3"? Should `zcode-kit run` stop holding a 74 MB node process for the whole session (exec/handoff instead of `spawnSync`)?
- **D3** Stale start lock policy. Proven takeover (holder dead plus start-time check under an atomic rename) vs today's refusal (AUD-001). Plus SIGINT/SIGTERM handlers that release the lock.
- **D4** Admission control. A limit on in-flight body bytes and concurrency, and the response when it is hit (429 vs 503 vs queue with a timeout).
- **D5** CI memory job on ubuntu only (short profile, ~15 min for S1–S7) until a Windows sampler exists.

## 9. Owner actions (human-only)

- **A1** Measure RC1 with the real vendor SDK: retained MB per solve and RSS at the 200-solve recycle. This needs a live start-plan solve, which this run cannot do (no network or credentials under B2/B3). An isolated instance with the owner's login, `node tests/memory/run.mjs S2`, swapping `heavy-dom` for a live solve, is an owner step to be specified.
- **A2** Windows: confirm worker termination and the Ctrl-C stale lock on Windows PowerShell and conhost.
