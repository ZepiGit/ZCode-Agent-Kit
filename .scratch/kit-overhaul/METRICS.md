# METRICS — baseline vs current

## Baseline (origin/main 9e45d05, 2026-11-05)

Environment: Linux x64, 8 cores, 32 GB RAM, no swap. Node v26.7.0 (local; CI uses Node 20), npm 11.19.0, Bun 1.4.2 (CI pin; isolated install under /home/AgentKit/overhaul-tools). Every command ran under `systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0`, `timeout`, `ZCODE_OVERHAUL_RUN=1` and an isolated HOME. Logs: `reports/baseline-*.log` (not committed; regenerable).

| Check | Result | Counts | Duration |
|---|---|---|---|
| `npm ci` + `bun install --frozen-lockfile` (proxy) + `npm ci` (mcp) | pass | — | 3 s |
| `npm run test` (kit, node:test) | pass | 278 tests: 267 pass, 0 fail, 11 skipped | 8.2 s |
| `npm run test:proxy` (bun test) | pass | 1288 pass, 0 fail, 88 files | 27.7 s |
| `npm run test:mcp` (tsc build + node:test) | pass | 96 tests: 95 pass, 0 fail, 1 skipped | 52.9 s |
| mcp `tsc` build vs committed `dist/` | byte-identical (git status clean after build) | — | — |
| `bun build --compile --target bun-linux-x64` | pass | 646 modules, 84.1 MB binary | <1 s |
| `node pack/build.mjs --tracked-only` + `pack/verify-payload.mjs` | pass | 195 files | <1 s |
| `node scripts/verify-golden-path.mjs` (mock mode) | pass | — | <1 s |
| `tests/update.test.mjs` + `tests/upstream-config.test.mjs` (NOT in `npm run test`) | pass | 16 pass | 0.8 s |

Skipped tests: all 11 kit skips are Windows-only (install.ps1, npm .cmd shims, Windows path equivalence) or the opt-in real-OMP golden path; the mcp skip is a live test. They run on the windows-latest CI leg.

Pre-existing findings (become tickets, not silent fixes):
- `tests/update.test.mjs` and `tests/upstream-config.test.mjs` exist but are not wired into `npm run test`, so CI never runs them. **Resolved (ticket 04):** both run in `npm run test` (278 → 298 tests: +16 wired, +4 wiring-guard tests in `tests/test-wiring.test.mjs`), locally on Node 24.22.2 and 26.7.0. CI run: https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42182894607 (all four `test-kit` legs green).
- CI runs Node 20 (EOL) while the local baseline ran Node 26: a Node-version coverage gap. **Resolved (ticket 04):** `test-kit` runs {ubuntu-latest, windows-latest} × {Node 24, 26}. CI run: https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42182894607 (ubuntu/windows × Node 24/26 green).

## Memory baseline

Source: Phase 1B memory loop (`diagnosis/memory` @ 2ccafe2, `tests/memory/`). Code under test: 0960696 (= origin/main 9e45d05 + tracker). Linux x64, Bun 1.4.2, isolated instance on port 18457 against the loopback soak mock. Details and evidence: `diagnosis/memory-report.md`, `diagnosis/data/`. RSS is from `/proc`; HWM = VmHWM; heap = JS heap.

| Scenario (profile) | Key numbers | Verdict |
|---|---|---|
| S1 proxy, 30,000 mixed requests (long, 20 min) | plateau median 127 MB, HWM 182 MB, heap ≤ 49 MB, growth 0.07 %/1k, 113 MB after idle | GREEN |
| S1 proxy, 3,000 requests (short) | growth 5.5 %/1k (warm-up, no trend), HWM 152 MB | GREEN |
| S1 burst: N concurrent 10.8 MB bodies, 3 × N requests (burst1: 3 sequential requests) | HWM 219 / 425 / 998 / 1,619 MB at N = 1 / 4 / 16 / 32; heap ≤ 898 MB; ~4.5 MB RSS per MB in flight (Phase 1B, unbounded bodies; history). On ticket 19's tree (linux, RSS, 64 MiB cap = six 10.8 MB bodies, 64.8 MB admitted; Round 18 Q3): (peak − 90) / MB admitted ≈ 6.2 at N = 16 (median 488.6 MB, 5 runs, range 5.2–6.7), 7.1 at N = 32 (median 549.7 MB, 20 runs, range 6.0–8.0; the ~61 MB above burst16 is the queue cost), 5.5 at N = 4 (43.2 MB, cap not binding), 8.6 at N = 1; the ratio is not constant, so no single linear factor predicts the peaks (ADR-0004 amendment Round 18). On ticket 20's tree (2798d2e, linux, RSS, 10 runs; "Request-body copies removed one at a time" below): medians 225.8 / 313.8 / 351.1 MB at N = 4 / 16 / 32, bigbody 183.6, burst1 119.5 (20 runs); (peak − 90) / MB admitted ≈ 3.1 at N = 4, 3.5 at N = 16, 4.0 at N = 32 | RED (N ≥ 4) on ticket 19's tree; GREEN on ticket 20's tree (linux local; CI pending) |
| S1 stalled readers, 3,000 | HWM 165 MB, heap 6 MB after idle | GREEN |
| S2 captcha solver, heavy happy-dom solves (short 420 / long 2,000) | RSS 179 → 958 MB at the 200-solve recycle (+4.1 MB/solve); heap after GC +2.5 MB/solve; per-generation peak 0.9–1.0 GB; HWM 1,068 MB | RED |
| S2 retained guest heap before recycle | 686 MB (long 619 MB); 687 MB returned on recycle | RED |
| S2 hung solves (5 × 256 MB parked) | reclaimed (−5 MB) | ok |
| S2 CDN memory map | +151 MB / 600 URLs, +502 MB / 2,000 URLs (256 KB each); bound ≤ 64 MB of memory (`cdn-cache:memory-growth`) and ≤ 256 entries, with a 32 MiB body budget (Round 20 Q1) | RED |
| S3 5 / 10 concurrent launches | max simultaneous proxies 1; kit peak 852 MB (each: launcher 74, bridge 86, preflight 55–73, proxy 60 MB) | RED (footprint) |
| S3 killed lock holder / hung proxy afterwards | 7–8 / 10 launches fail and a stale lock is left; then 10 / 10 fail. Clean hung recovery: 0 / 10 fail, ~36–44 s wait | RED |
| S4 50 start/stop/restart/crash/update cycles | 0 leaked proxies, 0 listeners after stop, 1 log file | ok |
| S4 Ctrl-C during start / respawn with a stale lock / respawn storm | stale lock 5 / 8; respawn ends with no proxy; storm capped at 3 | RED |
| S5 MCP bridge, 400 tasks | RSS 86 → 97–100 MB (~42 %/1k, net +13 %); ~4 KB heap/task retained; 3 files + 4.75 KB disk/task | RED |
| S6 TUI log pane | 100k lines +2 MB, resize storm +0 MB, 4,000 × 64 KB lines +125 MB (2,000-line cap) | RED |
| S7 proxy.log / responses store | 148 B/request, no rotation while running; store at cap: heap +63 MB, RSS 85 → 159 MB | RED (log) |

### Committed loop, Linux reference run (ticket 01, 2026-11-06)

The loop from `diagnosis/memory`, committed with the §18 budgets (`tests/memory/lib/budgets.mjs`, pinned by `verdict.test.mjs`) and the expected-RED ratchet, run as the ubuntu `memory-budget` job does: `node tests/memory/job.mjs` (short profile, every run in its own verified `systemd-run --user` scope with MemoryMax, plus `timeout`). Code under test: 3623e87 (= the Phase 1B code plus docs), branch `ticket/01-memory-loop-budgets`; Linux x64, Node 26.7.0, Bun 1.4.2, port 19010. Run dirs: `/home/AgentKit/overhaul-tools/t01-memloop/baseline-job/` (plus `job-burst32/` and `job-stalled/`, re-run after the two fixes below). Result: every run listed in `expected-red.json` RED, every other run GREEN; ratchet holds.

| Run | Phase 1B | Committed loop (Bun 1.4.2) | Budget (§18) | Verdict |
|---|---|---|---|---|
| S1/short | 3,000 req: 5.5–6.4 %/1k, HWM 152 MB | 6,000 req (half warm-up): 3.34 %/1k, no trend; steady 122 MB; HWM 167 MB | ≤ 5 %/1k + trend; steady ≤ 160; peak ≤ 250 | GREEN |
| S1/burst1 | HWM 219 MB | HWM 232 MB | ≤ 250 | GREEN |
| S1/burst4 | HWM 425 MB | HWM 373 MB | ≤ 250 | RED → 19 |
| S1/burst16 | HWM 998 MB | HWM 940 MB | ≤ 400 | RED → 19 |
| S1/burst32 | HWM 1,619 MB | HWM 1,363 MB | ≤ 600 | RED → 19 |
| S1/bigbody | HWM 422 MB | HWM 436 MB | ≤ 250 | RED → 19 |
| S1/stalled | 3,000 req: 2.0 %/1k, HWM 165 MB | 6,000 req: 2.36 %/1k; HWM 194 MB | ≤ 5 %/1k + trend; ≤ 250 | GREEN |
| S2/short | per generation 0.9–1.0 GB, HWM 1,068 MB; retained 686 MB; hang −5 MB; CDN +151 MB | cost per generation 1,096 MB (host HWM 1,161 MB); retained 685 MB; hang −7 MB; CDN +151 MB; cold start 157 ms; 0 solver processes after the idle exit and after 2 host SIGKILLs (thread transport: none exist) | ≤ 300 / 300 / 64 / 64 MB; cold start ≤ 4.5 s; 0 / 0 solvers | RED → 58 |
| S3/short | kit 852 MB; launcher 74, bridge 86, preflight 55–73, proxy 60 MB; 7/10 failed (killed holder), 1 stale lock | kit 850 MB (a); launcher 77.6, bridge 86.3, preflight 73.1, proxy 61.2 MB (b); 6 failed launches; 1 stale lock; exactly 1 proxy after every round | (a) ≤ 596; (b) 74 / 75 / 76 / 62 / solver 20 | RED → 37 |
| S3/hung | 18 failed, 2 stale locks | kit 849 MB; launcher 79.1, bridge 86.7, proxy 63.0 MB; 11 failed; 2 stale locks | as S3 | RED → 16 |
| S4/short | stale lock 5/8; respawn with stale lock → no proxy; 0 leaks; 3 respawns | same: 5/8, no proxy, 0 leaks in 50 cycles, 1 log file, 3 respawns; 0 solvers after 5 crash SIGKILLs | 0 / proxy up / 0 / ≤ 8 / ≤ 3 | RED → 17 |
| S5/short | ~42 %/1k, net +13 % | 43.5 %/1k, net +11.9 %; peak 101 MB; reboot +4 MB; 0 failures | ≤ 5 %/1k + trend; ≤ 150; ≤ 20; 0 | RED → 30 |
| S6/short | +2 / +0 / +125 MB | +2 / +0 / +125 MB; resize frame 0.234 ms (recorded, not gated). After ticket 32 (merged 0c75be5; CI run 42415961268, linux, entry deleted): +2 / +0 / +7 MB long-line heap (was 125 MB at the tip), new `tui:adversarial-line-heap` 8 MB | ≤ 16 / ≤ 8 / ≤ 16 MB | GREEN (32) |
| S7/short | 148 B/req, 6.37 MB, store heap +63 MB | 148 B/req, 6.37 MB while running, `proxy.early.log` absent, store heap +62 MB | ≤ 6 MB; ≤ 1 MB; ≤ 96 MB | RED → 34 |

No budget is loosened past the Phase 1B baseline. Against the diagnosis loop's own encoding: S3's total is 596 MB (was 600) plus the new per-role targets; S6's long-line budget is 16 MB (was 32); S1 gains the steady ≤ 160 MB check; S2 gains the per-generation, cold-start and solver-count checks. S1/burst16 and burst32 are judged against §18's 400 / 600 MB HWM (ADR-0004) instead of the diagnosis loop's blanket 250 MB; both stay RED. Measurement changes (ticket 01 Comments): S1 short and stalled run 6,000 requests (mixed with a half warm-up), burst and big-body runs are judged by their peak only, S3 samples every 250 ms.

### S1/burst1 distribution and the median rule (ticket 60, Round 6 Q1)

S1/burst1 sends 3 sequential ~10.8 MB requests per run (concurrency 1), not one request. Before the median rule landed we measured 48 fresh S1/burst1 runs, one after another. Each run was its own `node tests/memory/job.mjs --only S1/burst1` in its own systemd scope (MemoryMax 3G, no swap). Setup: integration tip 97c2211 (unchanged code), Linux x64, Node 26.7.0, Bun 1.4.2, port 19600. Runs 1–24 used `/home/AgentKit/overhaul-tools/t60-memloop/dist/` and the `ticket/60` worktree before any harness change. Runs 25–48 used `dist2/` and a clean detached worktree at 97c2211. Logs: `reports/t60-burst1-dist{,2}.log`.

Proxy peak (procPeak:proxy = max(RSS, VmHWM), MB), in run order:

236.5, 205.9, **267.4**, 235.5, 227.5, 239.4, 235.1, **255.6**, 239.9, 191.2, **268.9**, 240.3, 235.0, 234.0, 241.5, 235.0, 241.1, 214.7, 235.4, 239.7, 247.7, 207.3, 232.9, 237.3, 235.6, 203.9, 243.8, 225.3, 234.8, 248.9, 235.7, 240.1, 234.5, 239.4, **256.0**, 227.3, 239.7, 226.9, **262.3**, 237.8, 237.4, 237.8, 235.1, 236.0, 218.0, 235.2, 242.8, 240.4

Summary: min 191.2 MB, median 236.25 MB, max 268.9 MB. 5 of 48 runs are above 250 MB (p = 0.104) and none is above 400 MB. The 11 earlier runs on unchanged code (Round 6 Q1: 219.1 … 299.2 and one CI GREEN) have 3 above 250. Pooled: 8 of 59 (p = 0.136).

False-RED rate of a median of n, P(X ≥ (n+1)/2) with X ~ Binomial(n, p):

| p | n = 3 | n = 5 | n = 7 | n = 9 | smallest n ≤ 5 % |
|---|---|---|---|---|---|
| 0.104 (tip, 5/48) | 3.03 % | 0.96 % | 0.32 % | 0.11 % | 3 |
| 0.136 (pooled, 8/59) | 5.02 % | 2.01 % | 0.84 % | 0.36 % | 5 |

**Chosen n = 5.** This is the smallest odd n that keeps the predicted false-RED rate ≤ 5 % on both estimates. The tip-only estimate gives 3, but n = 3 misses 5 % on the pooled evidence (5.02 %). The cost is 5 × ~20 s per leg. Under the hard per-run ceiling of 400 MB, the measured false-RED rate is 0: the highest observed run, 299.2 MB, sits ~100 MB below it. n lives in `tests/memory/lib/budgets.mjs` (`REPEATED`), and `verdict.test.mjs` pins the computation on these numbers.

The first job run with the rule (`/home/AgentKit/overhaul-tools/t60-memloop/job-burst1/`) gave repetitions 236.4, 244.6, **257.3**, 189.1 and 234.9 MB. The median is 236.4 MB and nothing is over the ceiling, so the variant is GREEN. Judged on one run, repetition 3 alone would have turned the job RED.

### S1/burst1 measurement on the staged 02+60 code (ticket 60, Round 8 Q1 condition 2)

Measurement mode: `node tests/memory/job.mjs --measure-burst1 N` runs N fresh, isolated S1/burst1 runs one after another. Each run gets the job's cap, timeout and evidence gate. The mode writes `measure-S1-burst1.{json,md}` and appends the table to the job summary. It is no verdict and no ratchet. CI runs it only while the one-run marker `tests/memory/measure-burst1` (holding N) is committed. On Windows a run counts only with a non-zero `ws_peak_kb`, a passed units self-test, `@@JOB applied=1` and a gate equal to max(sampled WS, ws_peak_kb) from its `samples.csv` (Round 8 Q1 condition 1).

**Linux, 20 runs** (2026-11-06, `ticket/60` at dac4f4b = `ticket/02` 6d8e8e0 + ticket 60, Linux x64, Node 26.7.0, Bun 1.4.2, port 19600, each run in its own systemd scope with MemoryMax 3G inside `run-capped.sh` 4G; `/home/AgentKit/overhaul-tools/t60-memloop/measure-linux20/`, log `reports/t60-measure-linux20.log`, 397 s). All 20 runs are valid, with 1 proxy each. RSS gate = max(sampled RSS, VmHWM), MB, in run order:

215.2, 242.7, 222.8, 217.0, 248.0, **251.8**, 237.5, 246.2, **250.7**, 205.0, 232.2, 212.5, 229.6, 233.9, 208.4, 240.6, 225.8, 211.3, 180.6, 237.1

Min 180.6, median 230.9, max 251.8 MB. 2 of 20 runs are above 250 (p = 0.10), and none is above 400. Pooled with the 59 earlier Linux runs (8 above 250): 10 of 79 (p = 0.127).

| p (Linux) | n = 3 | n = 5 | n = 7 | n = 9 |
|---|---|---|---|---|
| 0.100 (these 20) | 2.80 % | 0.86 % | 0.27 % | 0.09 % |
| 0.127 (pooled, 10/79) | 4.40 % | 1.66 % | 0.65 % | 0.26 % |
| 0.136 (ticket 60's earlier pooled, 8/59) | 5.02 % | 2.01 % | 0.84 % | 0.36 % |

n stays 5, the Linux-derived value. These numbers do not change it. The 8/59 estimate is still the least favourable Linux one and needs n ≥ 5. Round 8 Q1 condition 3 picks the final n from both legs.

**CI measurement run.** Run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42316982634, on `staging/02` db5f353: `ticket/02` 3dd5d2c merged first, then `ticket/60` 7e8520a, plus the marker `tests/memory/measure-burst1` = 24. Node v26.13.0, Bun 1.4.2. Artefacts are in `/home/AgentKit/overhaul-tools/ci-art/r8-measure-nGEr/memory-budget-{windows,linux}/measure-S1-burst1.{json,md}`.

**Windows, 24 runs.** Each run is in a Job Object, 557 s in total. All 24 are valid: `ws_peak_kb` is non-zero in every run, the units self-test passed, the Job Object was applied, `count:proxy` is 1, and the gate equals max(sampled WS, ws_peak_kb) from `samples.csv` (Round 8 Q1 condition 1). WS gate in MB, in run order:

**291.1**, **274.0**, **261.6**, **253.4**, 249.4, 239.2, **272.6**, **290.2**, **290.4**, 242.0, **270.1**, 249.7, 206.9, **260.5**, **274.6**, **253.3**, 240.2, **272.2**, **250.6**, 243.8, 238.6, 241.4, 231.1, 240.8

- Sampled WS: 238.8, 229.6, 199.7, 155.9, 135.0, 93.9, 167.6, 264.8, 176.2, 193.3, 251.8, 217.6, 145.4, 250.1, 257.9, 149.6, 178.4, 226.9, 166.5, 222.5, 215.4, 241.2, 157.3, 155.3. In every run the gate is the PeakWorkingSetSize.
- Commit (reported, not judged): 441, 430, 412.4, 409.5, 399.8, 391.5, 417.9, 446.3, 445.6, 391.4, 418.4, 403.6, 360.7, 411.5, 433.9, 403.8, 392.9, 421.8, 400.2, 388.8, 393.4, 393.7, 375.8, 388.8. Median 403.7, max 446.3.

Min 206.9, median 251.9, max 291.1 MB. 13 of 24 runs are above 250 (p_win = 0.542). Pooled with runs 3, 4 and 5 counted as RED, RED, GREEN: 15 of 27 (p_win = 0.556), the less favourable estimate. None is above 400 and none above 300.

At these p values, P(median of n above 250) is 0.56, 0.58, 0.59 and 0.60 for n = 3, 5, 7 and 9. That is Round 8 Q1 condition 3's middle band: no n ≤ 9 agrees with either list state at ≥ 95 %.

**Linux, 24 CI runs** (systemd scopes, 453 s). All 24 are valid. RSS gate in MB:

233.5, 212.9, 212.5, 230.7, 234.5, 246.3, **262.1**, 235.7, 214.6, 235.0, 233.7, 236.3, 241.9, 234.9, 236.5, 220.9, 236.9, 234.4, 238.4, 222.3, 240.3, 218.6, 212.7, 217.6

Min 212.5, median 234.4, max 262.1 MB. 1 of 24 runs is above 250 (p = 0.042), and none is above 400. All Linux runs together: 11 of 103 (p = 0.107), where n = 5 gives a false-RED rate of ≈ 1.2 %. At the less favourable p = 0.127 it is ≈ 1.7 %. Both are within Round 6 Q1 condition 2's 5 %, so Linux stays unlisted.

**Decision (Round 9 Q1).** n stays 5, and the 250 MB budget, the 400 MB ceiling and the metric are unchanged. The windows `S1/burst1 → 20` entry stays listed and is marked `unstable`: a median up to 300 MB passes, and each passing run prints "S1/burst1: unstable (median <x> MB, budget 250), owned by ticket 20".

The 300 MB bound rests on two numbers. 0 of 27 windows values are above 300. At the 95 % upper bound for a single run above 300 (p ≈ 0.105), a median of 5 exceeds 300 with probability ≈ 1.0 %.

A listed repeated key also no longer masks its ceiling or any other RED check (condition 1). The entry's only exit is ticket 20's ≥ 20-run measurement with every windows run ≤ 250 MB.

### S1/burst1 and the Bun version: the paired measurement (ticket 09, Rounds 10–11)

**Why.** Ticket 09 moved CI to Bun 1.4.4. Its staged pre-merge run (https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42344393581, `staging/09`) failed on ubuntu `memory-budget` only: `S1/burst1: RED but not listed (linux)`, median 252.3 of [252.3, 280.6, 246, 221.2, 302.2]. A 24-run single-arm measurement on Bun 1.4.4 (run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42347506810; artefacts `ci-art/t09-measure-XAT9/`) then gave:

- Linux: 12 of 24 above 250, median 246.4, max 318.8.
- Windows: 14 of 24 above 250, median 252.4, max 295.9.

Against the Bun 1.4.2 run 42316982634 above (Linux 1/24, Windows 13/24). Both ran on runner image `ubuntu-26.04` 20261101.186.1 with Node 26.13.0 and identical proxy source. Each version still ran on its own VM, so Round 10 Q1 ordered one paired run.

**Paired mode.** `node tests/memory/job.mjs --measure-burst1 "24 bun=1.4.2,1.4.3,1.4.4" --bun …`:

- 24 fresh S1/burst1 runs per arm, interleaved in rotation (1.4.2, 1.4.3, 1.4.4, 1.4.2, …) in one job on one VM.
- Each run starts the proxy with its arm's Bun.
- A run counts only if the proxy's live executable reports that arm's `--revision`.
- Once per arm, inside the cap scope, the run records `process.constrainedMemory()`, `navigator.hardwareConcurrency`, the CPU model, `nproc`, the cgroup type and the scope's `memory.max`.

**CI paired run.** Run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42352122623, `staging/09` e407916, Node v26.13.0. Artefacts are in `/home/AgentKit/overhaul-tools/ci-art/t09-paired-1fRC/memory-budget-{linux,windows}/measure-S1-burst1.{json,md}`.

- All 144 runs are valid, and in every run the proxy's runtime Bun equals its arm: `1.4.2+744846f84`, `1.4.3+c6da4a4d3`, `1.4.4+38afee6c8`.
- No run is above 400 MB.
- Environment, identical across arms: INTEL(R) XEON(R) PLATINUM 8573C, 4 cores (`nproc` = `hardwareConcurrency` = 4).
  - Linux: cgroup **v2-only**, `constrainedMemory` = scope `memory.max` = 3221225472.
  - Windows: Job Object 3G; `constrainedMemory` reports the host's 17174360064, because the Job Object limit is not visible to Bun.
- Run time: Linux 1368 s for 72 runs, Windows 1632 s.

**Linux** (RSS gate = max(sampled RSS, VmHWM), MB, run order within each arm):

- 1.4.2: 216.4, **251.3**, **260.5**, 216.6, **254.9**, 225.4, 222, 219.7, 218.7, **259.2**, 219.3, 218.4, 219.9, 219.5, 249.7, **255.5**, 209.5, 204, 217.6, 221.3, 211.7, 212.7, 206.7, 208.2
- 1.4.3: **276.9**, 245, 239, 206.5, **318**, **279.6**, 223.3, **296.3**, **294**, **273.5**, **272**, **315.2**, **317.7**, **288.4**, **331.4**, 220.3, 213.9, 238.9, 228.5, **319.9**, **278**, **266.8**, 210.4, 216.4
- 1.4.4: 236.3, **258.9**, 239.8, 217.6, 225.3, 238.7, **282.2**, **258.7**, 236.3, **252.2**, **290**, 234, 243, **282.8**, **261.2**, **252.9**, **288.9**, 245.8, **285.7**, **281.9**, **333.2**, 229.5, 241.5, **279.9**

**Windows** (WS gate = max(sampled WS, PeakWorkingSetSize), MB):

- 1.4.2: **250.7**, 245.3, **281.5**, 246, **253.2**, 247.7, 246.6, **281.3**, 227.4, **252.2**, 248.6, 248.4, 229.8, **252.9**, **264.2**, **250.5**, 249.7, **291.5**, 249.2, **268.9**, 248, **290.2**, 248.6, **262.5**
- 1.4.3: 216.4, **296.1**, **294.4**, **250.1**, 240.8, **251.1**, **265.6**, 230.2, **255.4**, **270.5**, 234.1, 235, **257.2**, **251.5**, **251**, **278.8**, **282.3**, **289.2**, 248.4, **255.4**, **253.5**, 222.4, **293.1**, **259.7**
- 1.4.4: **255.2**, **250.6**, **267.4**, **292**, 210.4, **263.9**, **267.7**, 207.5, **279.2**, **261**, **250.8**, **280.8**, **271.7**, **256**, **250.7**, **270.8**, **254.6**, 245.1, **269.4**, 216.3, **256.2**, 220.5, **259.2**, **281.3**

| leg | arm | above 250 of 24 | min / median / max (MB) | commit median / max (MB) | one-sided Fisher vs 1.4.2 |
|---|---|---|---|---|---|
| linux | 1.4.2 | 5 | 204 / 219.4 / 260.5 | — | — |
| linux | 1.4.3 | 14 | 206.5 / 272.8 / 331.4 | — | 0.0086 |
| linux | 1.4.4 | 13 | 217.6 / 252.6 / 333.2 | — | 0.0178 |
| windows | 1.4.2 | 12 | 227.4 / 250.1 / 291.5 | 403.3 / 443 | — |
| windows | 1.4.3 | 17 | 216.4 / 254.4 / 296.1 | 405.7 / 450.2 | 0.119 |
| windows | 1.4.4 | 19 | 207.5 / 257.7 / 292 | 407.2 / 448.1 | 0.0344 |

Reading of the data (Round 11 Q1's own recomputation):

- **Linux:** both Fisher p values survive a Holm correction for two comparisons. A one-sided Mann-Whitney test on the values agrees (z = 3.50 and 4.11). All five 1.4.2 exceedances lie between 251.3 and 260.5 MB.
- **Windows:** 0.034 does not survive Holm (threshold 0.025), and Mann-Whitney gives p = 0.20 / 0.12. Windows is information only.
- **Hypothesis ruled out:** the 1.4.4 hybrid-cgroup heap-sizing change cannot explain the step, since the runners are v2-only, and the step already appears at 1.4.3.
- **Local machine contrast:** AMD EPYC 7B12, 8 cores, cgroup v2-only, `constrainedMemory` = 3221225472 for every arm. There Linux 1.4.2 gave 2/20 and 1.4.4 gave 0/20, and a 3-per-arm paired run gave 0 / 1 / 0 of 3. The CPU class difference is a hypothesis, not a finding. **Evidence missing:** the CPU of run 42316982634's runner was not recorded.

**Decision (Round 11 Q1).**

- **Bun 1.4.2 everywhere.** That covers `ci.yml` test-kit, ux-before and memory-budget, release.yml, and the installers via ticket 11. Linux S1/burst1 stays unlisted, with no budget change.
- **n for S1/burst1 goes from 5 to 7 on both legs.** The less favourable Linux estimate is the paired 1.4.2 arm, 5/24, against the pooled 1.4.2 CI history of 6/48.

  | p (Linux, Bun 1.4.2) | n = 3 | n = 5 | n = 7 | n = 9 | smallest n ≤ 5 % |
  |---|---|---|---|---|---|
  | 0.208 (paired arm, 5/24) | 11.21 % | 6.45 % | 3.83 % | 2.32 % | 7 |
  | 0.125 (pooled CI, 6/48) | 4.30 % | 1.61 % | 0.62 % | 0.25 % | 3 |

  Stable unlisted at n = 7 means at most 5 of 24 above 250 (p ≤ 0.225).
- **Unchanged:** the 250 MB budget, the 400 MB ceiling, the metric split and both `expected-red.json` lists. No windows value in the 1.4.2 arms is above 300, so the `unstable` entry's 300 MB bound holds at n = 7.
- **Owner of the newer Bun:** ticket 62 ("Bun ≥ 1.4.3 raises the S1/burst1 proxy peak on the CI runners"). It owns the newer Bun with the paired mode as its re-entry tool: 1.4.2 is the reference arm, and Round 11 Q1 condition 4 gives the rule.

### Ticket 11: no attribution run, typecheck baseline (2026-11-07)

- **Attribution runs: moot (Round 11 Q1 condition 1, Round 10 Q1 condition 3).** The installers keep bootstrapping Bun 1.4.2, the runtime the Linux and Windows references were measured on (the Linux reference above, the Windows reference below). The runtime does not change, so there is no 1.4.4 attribution run to record. Build-time gate 3 is met by the Bun 1.4.2 Windows reference run alone.
- **Proxy typecheck baseline (build-time gate 7):** `tsc --noEmit -p tsconfig.json` with the pinned `typescript` 7.0.2 and `@types/bun` 1.4.2 (`bun-types` 1.4.2) found **0 errors** in 187 `src/` files. It was recorded before any fix (log `reports/t11-typecheck-baseline.log`). So no tickets are filed and there is no expected-error list. The `test-kit` step fails on any error.

### Windows reference run, Bun 1.4.2 (ticket 02)

Run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42265988296 (`pull/14` merge of staging/02 82de0da, 2026-11-06). This is the first clean windows run (Round 7 Q2 condition 1). Run 3 (42252896054) corroborates it.
- **Environment:** runner image windows-2025-vs2026 20261103.298.1 (Windows Server 2025), Node v26.13.0, Bun 1.4.2+744846f84, short profile.
- **Caps:** every run in a Job Object with the job memory limit and kill-on-close, read back (`@@JOB applied=1` on all 13 runs). No harness failure.
- **Units self-test:** passed in every run (S5: 133 processes compared, commit and WS ratios 1.0, hwm/commit 1.173).
- **Artefact:** `/home/AgentKit/overhaul-tools/t02-ci-artifact-42265988296/`. Log: `t02-winmem-4.log`.

Values are MB per run:
- **commit:** `PrivatePageCount`, with the peak from `PeakPageFileUsage`.
- **WS:** sampled working set. Run 4's CSVs predate `ws_peak_kb`, so its PeakWorkingSetSize lives only in the live WS verdict (`workingSet.redChecks`).
- **"R7":** the outcome under Round 7's rules, re-judged from the artefact: WS gates the per-process peak and steady of proxy, launcher, bridge and preflight; the S3 total is ≤ 514 commit; paced runs have the 512 MB proxy commit backstop.
- **Poller:** the poller's own peak commit / WS and its median / max poll time, excluded from every verdict.

| Run | Samples | Key numbers, commit / sampled WS | Run-4 verdict | WS verdict (live, with PeakWorkingSetSize) | R7 | Poller |
|---|---|---|---|---|---|---|
| S1/short | 258 | proxy peak 347.7 / 155.7; steady 283.3 / 112.6; growth 2.09 %/1k; proxy max commit sample 325.8 | RED only on commit (procPeak, steady) | GREEN | GREEN (unlisted) | 108 / 125 MB, 30 / 173 ms |
| S1/burst1 | 19 | proxy peak 422 / 234.3 | RED | RED (procPeak:proxy) | RED → 20 | 121 / 138, 30 / 82 |
| S1/burst4 | 19 | proxy peak 561.6 / 290.3 | RED | RED | RED → 19 | 122 / 138, 30 / 86 |
| S1/burst16 | 21 | proxy peak 1,095.4 / 758.7 | RED | RED | RED → 19 | 121 / 138, 32 / 86 |
| S1/burst32 | 23 | proxy peak 1,604.9 / 1,188.7 | RED | RED | RED → 19 | 122 / 139, 38 / 73 |
| S1/bigbody | 78 | proxy peak 491.6 / 279.6 | RED | RED | RED → 19 | 122 / 139, 32 / 71 |
| S1/stalled | 321 | proxy peak 452.3 / 275.0; max commit sample 437 | RED | RED | RED → 61 | 122 / 139, 32 / 375 |
| S2/short | 180 | host peak 1,269.7 / 1,016.3; cost per generation 1,101.7 / 914.3; growth 14.35 %/1k | RED | RED | RED → 58 (all on commit) | 123 / 140, 34 / 100 |
| S3/short | 133 | kit total 734.5 / 698.6; proxy 187.9 / 57.0; launcher 40.0 / 61.8; bridge 78.6 / 72.1; preflight 31.9 / 56.7; orphans 1, failed launches 1, stale lock 1 | RED | RED | RED → 37 (total > 514; orphan, lock) | 145 / 161, 34 / 123 |
| S3/hung | 532 | kit total 456.8 / 603.8; proxy 186.3 / 58.7; orphans 1, failed launches 21, stale locks 2 | RED | RED | RED → 16 (total GREEN at 514) | 144 / 161, 29 / 126 |
| S4/short | 319 | proxy max commit sample 186.9; stale lock after Ctrl-C, 2 unstoppable proxies after Ctrl-C, respawn with stale lock | RED | RED | RED → 17 | 122 / 138, 36 / 70 |
| S5/short | 714 | bridge peak 89.8 / 74.3; growth 22.01 %/1k, no trend (net 4.6 %, 0 rising windows); reboot cost 4; 0 task failures | GREEN | GREEN | GREEN (entry removed) | 122 / 139, 31 / 64 |
| S7/short | 87 | proxy peak 401.5 / 189.2; max commit sample 363.1; `proxy.log` RED | RED | RED | RED → 34 (`proxy.log` only) | 121 / 138, 30 / 59 |

- **S3 total budget:** the Windows S3 total budget is 514 MB commit (0.7 × 734.5; Round 7 Q2). Kit-started PowerShell (~65–72 MB commit each) and its conhosts count. The loop's own tooling does not.
- **Killed-start orphan (Round 7 Q4):** the S3 orphans are the killed-start proxies. `cleanup.pidRecordLeft` shows `{"pid":5788,"startedMs":null}` (S3/hung) and `{"pid":8532,"startedMs":null}` (S3/short), and the final stop says "start time … is not determinable … refusing to kill".
- **Calibrated `windows` list** (calibration commit on ticket 02): S1/burst1 → 20, S1/burst4/16/32/bigbody → 19, S1/stalled → 61, S2 → 58, S3/short → 37, S3/hung → 16, S4 → 17, S7 → 34. S5/short is removed and S1/short is unlisted.
- **S1/burst1 caveat:** it is RED on WS only through PeakWorkingSetSize (sampled WS 234.3, 248.3 in run 3). If it flips between runs, Round 6 Q2 condition 3 applies.

Reference-run plan as first merged in 18351e1 (superseded by the run above): **Pending CI (orchestrator verifies after merge+push).** The reference run is the windows leg of the `memory-budget` job (`node tests/memory/job.mjs` on windows-latest, Node 26, Bun 1.4.2, short profile: S1 all variants, S2, S3 short + hung, S4, S5, S7). Each run is capped by a Job Object (job memory limit + kill-on-close, read back) and timed out. The metric is commit (`PrivatePageCount`; per-process peak = `PeakPageFileUsage`), and each `summary.json` carries the working-set verdict next to it (`workingSet`, `redOnlyOnCommit`) and the sampler's units self-test and overhead (`notes.sampler`). Record per run here: outcome, the key commit numbers against the same budgets as the Linux table, any run RED only on commit (raised to the owner, build-time gate 3), and the poller overhead (peak commit / working set, poll ms). If the sampler cannot run on this pre-upgrade code, the reason goes to RUNLOG and ticket 11's Bun 1.4.4 run becomes the reference. (Moot since Round 11: Bun stays at 1.4.2 and there is no 1.4.4 run; see "Ticket 11" above.)

Linux reference check on the ticket 02 branch (Bun 1.4.2, 2026-11-06, `/home/AgentKit/overhaul-tools/t02-memloop/linux-job/`): numbers in line with the ticket 01 run (S3/short kit 849 MB, launcher 78.2, bridge 85.9 MB; S2 cost per generation 1,050 MB, retained 685 MB, CDN +149 MB). S1/burst1 is flaky at its 250 MB HWM budget on the integration tip too: HWM 256.7 MB in the job, reruns 237.7 / 236.7 / 264.6 MB on the branch and 236.6 / 299.2 / 237.5 MB on the tip (3f4e41a).

### S3 OMP stub-host leg, Linux, Bun 1.4.2 (ticket 03, 2026-11-06)

`node tests/memory/run.mjs S3 --variant omp` (in the job: `S3/omp`, expected RED → 35). Five stub Bun hosts run the generated OMP extension at once; a second round kills the first starter with its process tree. Branch `ticket/03-s3-omp-stub-host` @ 50c027b, Node 26.7.0, port 19030. Run dirs: `/home/AgentKit/overhaul-tools/t03-memloop/{red1,red2,job-s3}/`.

| Round | OMP preflights at once (≤ 1) | Spawned | Host's own cost (waiter gate ≤ 5 MB) | Cause lines in waiters | Verdict |
|---|---|---|---|---|---|
| omp-5 | 5 | 5 | starters +3.6 to +3.9 MB; no waiters | (no waiters) | RED → 35 |
| omp-5-kill-starter | 5 | 5 | starters +3.2 to +3.9 MB; no waiters | (no waiters) | RED → 35 |

Same run: kit total 373 MB (≤ 596), preflight peak 73.9 MB (≤ 76), proxy 60 MB; the host (34.7 MB per process) is not kit footprint. Measurement floor of the stub host (no-op hook) +0.6 to +0.75 MB; a stat + `fetch` waiter shape +2.9 to +3.3 MB. A throwaway single-flight prototype turned the variant GREEN in 4 of 4 runs with waiters at +3.3 to +4.1 MB (ticket 03 Comments). Windows: pending CI, after ticket 02 is re-merged.

Re-run after merging the integration tip 5631511 (02 + 60), 2026-11-07, `/home/AgentKit/overhaul-tools/t03-memloop/r2-job-s3/`: unchanged. Both rounds 5 preflights at once (5 spawned), starters +3.1 to +3.8 MB, every surviving host printed `quota-unavailable`, kit total 372 MB, preflight 62.9 MB, proxy 60.8 MB, host 34.6 MB per process (not kit). 12 s, 36 samples; the run passes the S3/omp evidence floor (≥ 5 s, ≥ 14 samples, proxy + preflight + omp-host, both rounds). Windows (commit gate for the waiter cost, WS reported beside it): pending CI.

### S5/short growth:mcp-bridge across CI runs (ticket 66, Round 13 Q1)

Every CI run since 42252896054 that ran the full short profile, from the `memory-budget` job logs (`gh api …/actions/jobs/<id>/logs`, the S5 check line and the "Memory checks" line), up to the pre-merge run 42404639968 that brought the question. The three S1-only measurement runs (42316982634, 42347506810, 42352122623) have no S5 line. Logs: `/home/AgentKit/overhaul-tools/ci-art/t66-full-logs/`. Budget 5 %/1k after warm-up; RED = over budget AND a trend (≥ 3 trailing rising windows, or a net rise ≥ 10 %; `growth()` in `tests/memory/lib/verdict.mjs`). Windows gates growth on commit and reports WS (Round 7 Q1).

**Windows, 28 runs** (commit: n = 28, min 14.27, median 18.25, mean 19.04, sd 3.43, max 26.24; over budget in 28 of 28; RED in 1 of 28). WS ranges 13.22–41.39 and is not judged. \* Rows 1 and 2 (Round 7's runs 3 and 4) predate the commit / WS split in the log: their WS value is re-judged from the artefacts (`/home/AgentKit/overhaul-tools/t02-ci-artifact-<run>/`, `osVerdict` over `samples.csv`; the commit value matches the log).

| # | Run | Branch | commit %/1k (gate) | WS %/1k (reported) | trend | verdict |
|---|---|---|---|---|---|---|
| 1 | 42252896054 | staging/02 | 26.24 | 31.66* | false | GREEN |
| 2 | 42265988296 | staging/02 | 22.01 | 21.68* | false | GREEN |
| 3 | 42281646419 | staging/02 | 20.73 | 26.99 | false | GREEN |
| 4 | 42281731448 | staging/02 | 19.17 | 19.69 | false | GREEN |
| 5 | 42326112543 | staging/02 | 15.5 | 27.05 | false | GREEN |
| 6 | 42330994104 | overhaul/stability-terminal-ux | 15.88 | 13.22 | false | GREEN |
| 7 | 42335478907 | staging/03 | 18.22 | 33.25 | false | GREEN |
| 8 | 42338973997 | overhaul/stability-terminal-ux | 23.57 | 32.38 | false | GREEN |
| 9 | 42344393581 | staging/09 | 14.27 | 29.71 | false | GREEN |
| 10 | 42360554587 | staging/09 | 16.16 | 17.47 | false | GREEN |
| 11 | 42364104638 | staging/09 | 21.81 | 15.47 | false | GREEN |
| 12 | 42367395231 | overhaul/stability-terminal-ux | 15.64 | 23.3 | false | GREEN |
| 13 | 42370286615 | staging/10 | 16.01 | 41.39 | false | GREEN |
| 14 | 42374566358 | staging/10 | 20.07 | 25.37 | false | GREEN |
| 15 | 42378479007 | overhaul/stability-terminal-ux | 16.75 | 28.38 | false | GREEN |
| 16 | 42381135168 | staging/11 | 18.28 | 18.76 | false | GREEN |
| 17 | 42382114395 | overhaul/stability-terminal-ux | 25.29 | 29.1 | false | GREEN |
| 18 | 42383999482 | staging/08 | 21.21 | 22.82 | false | GREEN |
| 19 | 42384925753 | overhaul/stability-terminal-ux | 14.97 | 20.65 | false | GREEN |
| 20 | 42387910869 | staging/08 | 17.21 | 16.85 | false | GREEN |
| 21 | 42391052837 | staging/12 | 15.2 | 27.66 | false | GREEN |
| 22 | 42392375847 | overhaul/stability-terminal-ux | 21.62 | 14.53 | false | GREEN |
| 23 | 42395651721 | staging/32 | 17.16 | 30.12 | false | GREEN |
| 24 | 42398294952 | overhaul/stability-terminal-ux | 17.28 | 25.08 | false | GREEN |
| 25 | 42398295810 | staging/12 | 22.92 | 15.34 | false | GREEN |
| 26 | 42398299724 | staging/32 | 20.72 | 28.83 | false | GREEN |
| 27 | 42401136452 | staging/42 | 15.55 | 26.39 | false | GREEN |
| 28 | 42404639968 | staging/65 | 23.71 | 25.03 | true | RED |

**Linux, 26 runs** (the runs with a windows S5 line above, less rows 1 and 2, 42252896054 and 42265988296; RSS: n = 26, min 38.21, median 42.63, mean 42.58, sd 1.99, max 46.33; RED with trend in 26 of 26). The other 11 Linux runs in the same period (Linux-only legs, and those two) are RED with trend too, at 37.53–43.93 %/1k: 42252896054 42.76, 42252927653 43.84, 42252974778 43.93, 42259233373 37.53, 42265988296 43.33, 42265998740 40.58, 42267516015 39.54, 42275502649 41.13, 42279882243 42.82, 42286030477 41.3, 42293233741 42.62 (all 37: mean 42.34, sd 1.99).

| # | Run | Branch | RSS %/1k | trend | verdict |
|---|---|---|---|---|---|
| 1 | 42281646419 | staging/02 | 43.29 | true | RED |
| 2 | 42281731448 | staging/02 | 42.63 | true | RED |
| 3 | 42326112543 | staging/02 | 46.33 | true | RED |
| 4 | 42330994104 | overhaul/stability-terminal-ux | 42.41 | true | RED |
| 5 | 42335478907 | staging/03 | 44.53 | true | RED |
| 6 | 42338973997 | overhaul/stability-terminal-ux | 42.01 | true | RED |
| 7 | 42344393581 | staging/09 | 39.98 | true | RED |
| 8 | 42360554587 | staging/09 | 40.54 | true | RED |
| 9 | 42364104638 | staging/09 | 40.62 | true | RED |
| 10 | 42367395231 | overhaul/stability-terminal-ux | 41.69 | true | RED |
| 11 | 42370286615 | staging/10 | 42.72 | true | RED |
| 12 | 42374566358 | staging/10 | 40.25 | true | RED |
| 13 | 42378479007 | overhaul/stability-terminal-ux | 42.62 | true | RED |
| 14 | 42381135168 | staging/11 | 43.54 | true | RED |
| 15 | 42382114395 | overhaul/stability-terminal-ux | 45.59 | true | RED |
| 16 | 42383999482 | staging/08 | 42.83 | true | RED |
| 17 | 42384925753 | overhaul/stability-terminal-ux | 40.78 | true | RED |
| 18 | 42387910869 | staging/08 | 44.38 | true | RED |
| 19 | 42391052837 | staging/12 | 41.51 | true | RED |
| 20 | 42392375847 | overhaul/stability-terminal-ux | 41.17 | true | RED |
| 21 | 42395651721 | staging/32 | 40.91 | true | RED |
| 22 | 42398294952 | overhaul/stability-terminal-ux | 44.51 | true | RED |
| 23 | 42398295810 | staging/12 | 44.74 | true | RED |
| 24 | 42398299724 | staging/32 | 44.91 | true | RED |
| 25 | 42401136452 | staging/42 | 38.21 | true | RED |
| 26 | 42404639968 | staging/65 | 44.44 | true | RED |

- **What the ratchet does with it (Round 13 Q1, ticket 66):** windows `S5/short → 30` is `unstable` with a growth-value band on the commit value of `growth:mcp-bridge`: 5 < value ≤ 30 passes with either trend flag and prints `S5/short: unstable (growth:mcp-bridge <x> %/1k commit, budget 5, bound 30, trend <t>), owned by ticket 30`; above 30 fails; ≤ 5 fails as at budget but listed; any other RED, a harness failure or a missing growth value fails. The bound sits 3.76 above the highest of 28 values (normal fit: ≈ 0.07 % per run above 30, z = 3.20; log-normal ≈ 0.39 %). Linux stays the plain entry `S5/short → 30`.
- **Replays at the job seam** (`tests/memory/loop.test.mjs`, fixtures `tests/memory/fixtures/ci-42404639968-s5-short-windows-summary.json` and `ci-42401136452-…`): run 42404639968 (RED, 23.71, trend true; window medians 77.5, 78.3, 80.2, 80.0, 81.6, 82.6 MB) and run 42401136452 (GREEN, 15.55, trend false; 77.3, 79.1, 80.6, 80.5, 82.6, 77.4 MB) both pass with their unstable line. On the integration tip a912cce the first fails as `S5/short: RED but not listed in expected-red.json (windows)`, as in CI.

**Windows, 85 runs to 42484868282 (Owner Proxy Round 25 Q1 correction 5 and condition 9).** Recomputed from the windows `memory-budget` job logs of every `ci.yml` run from 42404639968 to 42484868282 (`/home/AgentKit/overhaul-tools/ci-art/r25-logs/win/<run>.log`, list `runs.txt`; 42467078897's memory legs never ran, setup-bun HTTP 504), plus the 28 Round 13 values above. Commit %/1k, the gate metric:

| set | n | min | median | mean | sd | max | > 30 |
|---|---|---|---|---|---|---|---|
| Round 13's 28 (to 42404639968) | 28 | 14.27 | 18.25 | 19.04 | 3.43 | 26.24 | 0 |
| before 13, after Round 13 (42408170742–42424608767) | 11 | 14.74 | 17.98 | 17.75 | 1.72 | 20.34 | 0 |
| 13 tree without 36 (42425069025–42481592284) | 41 | 11.99 | 18.08 | 19.06 | 4.31 | **30.23** | 1 |
| trees with 36 (42454650683 15.43, 42469209389 18.14, 42483637377 **34.62**, 42483787372 19.82, 42484868282 24.83) | 5 | 15.43 | 19.82 | 22.57 | 7.56 | 34.62 | 1 |
| all | 85 | 11.99 | 18.14 | 19.09 | 4.08 | 34.62 | 2 |

- Per-run P(> 30): all 85, normal 0.37 % / log-normal 0.94 %, empirical 2/85 = 2.35 % (95 % Clopper-Pearson 0.29–8.24 %). On the 13 tree scaled by 36's ×1.09 (the base every tree now has): 2.47 % / 3.72 % (1.38 % / 2.61 % without 42480631098). Round 13 Q1 condition 2's 0.07 % / 0.39 % (bullet above) is superseded; the 30 bound is unchanged.
- The two values above 30: 42480631098 (staging/21, 13 tree without 36): 30.23 commit / WS 42.29, trend false, 24.42 MB/1k on a mean of 80.8 MB, window medians 76.7, 79, 80.7, 81.1, 83.2, 82.6 MB; signature (vi)'s first occurrence (Round 25 Q1 conditions 1 and 3; recorded in ticket 74). 42483637377 (ticket 30's restage, a53152d, with 36): 34.62 commit / WS 19.17, trend true, 26.24 MB/1k on a mean of 75.8 MB, window medians 70.9, 74.4, 76.9, 76.3, 77.4, 78.7 MB; not covered by (vi) (30's diff touches `mcp/**`).

**Round 25 Q1 condition 4's pre-registered set: the first 20 windows S5/short values on trees that contain ticket 36, any branch** (run-creation order; triggers: ≥ 3 of the 20 above 30, any value above 35, or a 20-run mean above 23 %/1k). Kept current until complete; it is the table ticket 74's merge precondition (Round 25 Q1 condition 5) needs.

| # | Run | Tree | commit %/1k |
|---|---|---|---|
| 1 | 42454650683 | with 36 | 15.43 |
| 2 | 42469209389 | with 36 | 18.14 |
| 3 | 42483637377 | ticket 30's tree (a53152d), trend true | 34.62 |
| 4 | 42483787372 | with 36 | 19.82 |
| 5 | 42484868282 | integration eaa91b3 (36 + 15's `setup.mjs`) | 24.83 |
| 6–20 | — | pending | — |

### RED check sets per listed single run, owners and flips, both legs (ticket 67; Round 14 Q1 condition 3, Round 15 Q1 and Q2)

Source: the `memory-budget` job logs of `ci.yml` runs up to 42429164758, and the `memory-budget-<leg>` artefacts of the ten runs on the ticket-13 tree (`gh api …/actions/jobs/<id>/logs`; the job summary table's "red checks" column per run key). Logs and the parsed table: `/home/AgentKit/overhaul-tools/ci-art/t67-logs/` (`logs/<run>-<leg>.log`, `parsed.json`); scripts `/home/AgentKit/overhaul-tools/t67-scripts/` (`parse.mjs`, `rates.mjs`, `replay.mjs`). A run counts when its job printed the summary table and the key's row is GREEN or RED (a harness failure is no valid run). Only CI runs of the leg's full short profile count (Round 15 Q2 condition 1).

**Matching code.** A run counts for a key when its tree matches the tree 67 merges onto in what that key executes:
- `tests/memory/lib/verdict.mjs` and `tests/memory/lib/budgets.mjs` identical (from 42360554587 on), the job's Bun 1.4.2 (every run from 42360554587 on);
- product code: ticket 10's preflight change (`cli/heal.mjs`) present, so windows starts at 42378479007; staging/12 runs before its merge (42391052837, 42398295810, 42415959288) excluded. Later product merges (08 CLI split, 59 Kilo sheet line, 11 installers, 12 proxy dependencies, 32 TUI log pane, 42 Account Rotator setup flow, 68 CRLF config writers, 69 deviceMid reader) touch no code path a listed key runs in a way that moves its RED set: 08's split is behaviour-preserving (08's own S3/short comparison), 12's only staging run on its final tree (42420564808) and every run after it fall inside the earlier sets, 69 keeps the template's `deviceMid: ""` path byte-identical (Round 15 correction 7);
- linux only: ticket 64's sampler fix (`tests/memory/lib/sampler.mjs`), so linux starts at 42398294952; the windows sampler path is unchanged throughout;
- S3/short and S3/hung only: ticket 65's `tests/memory/scenarios/s3-concurrency.mjs` (kill-holder adversary, stale-lock round), so only runs on a tree with 65.
- **Ticket 13 (MCP dependencies) merged before 67 (f383d6b)** and restarts the count for every key that runs the bridge (Round 15 Q2 condition 2, Round 16 Q2 condition 1): see "Restart on the ticket-13 tree" below.

Round 2 window (both trees mixed; split by tree below): Linux, 18 runs: 42398294952, 42398299724, 42401136452, 42404639968, 42408170742, 42412266693, 42415953488, 42415957165, 42415961268, 42415962768, 42420564808, 42421432504, 42421424292, 42424608767, 42425069025, 42425476318, 42427108509, 42429164758. Windows, 26 runs: 42378479007, 42381135168, 42382114395, 42383999482, 42384925753, 42387910869, 42392375847, 42395651721, and the 18 linux run ids from 42398294952 on. S3/short and S3/hung, 10 runs per leg (with 65): 42404639968, 42415957165, 42420564808, 42421432504, 42421424292, 42424608767, 42425069025, 42425476318, 42427108509, 42429164758; 42425069025 and 42429164758 are the two on the ticket-13 tree.

**Restart on the ticket-13 tree (Round 16 Q2 condition 1).** 13 changes the bridge's runtime dependencies (`@modelcontextprotocol/sdk` ^1.30.0 → ^1.32.2, `zod` added). So the matching runs restart on the 13 tree for every key whose executed code holds a bridge session: S3/short, S3/hung and S3/omp on both legs, and linux S5/short. Windows S5/short stays under Round 13's `unstable` bound. The S1, S2, S4 and S7 counts carry on. The floor on the 13 tree is ≥ 10 valid CI runs per leg: 42425069025 (staging/13), 42429164758 (integration f906014) and the eight staging/67 evidence runs 42435825059, 42435917288, 42436010878, 42436099293, 42436186573, 42436269194, 42436354758, 42436440284 (identical tree, empty commits). Rates are recorded on both trees separately (Round 16 Q2 condition 4): a `flips` name RED in every 13-tree run keeps its mark when the pre-13 runs show it GREEN at least once. None of the marks needed that: no `flips` name is RED in 10 of 10 on the 13 tree.

Per key and leg: matching runs n, then owner, name and RED count per run; † = marked `flips` in `expected-red.json` (RED in fewer than all matching runs, Round 15 Q1 condition 4); last column: RED names no owner holds.

**Before 13** (linux 16 runs, windows 24 runs; S3/short and S3/hung: the 8 runs with 65 and without 13: 42404639968, 42415957165, 42420564808, 42421432504, 42421424292, 42424608767, 42425476318, 42427108509). Source: the job logs (`ci-art/t67-logs/parsed.json`, `t67-scripts/rates.mjs`).

| key | leg | n | owner name RED/n | not owned |
|---|---|---|---|---|
| S1/burst4 | linux | 16 | 19 procPeak:proxy 16/16 | — |
| S1/burst16 | linux | 16 | 19 procPeak:proxy 16/16 | — |
| S1/burst32 | linux | 16 | 19 procPeak:proxy 16/16 | — |
| S1/bigbody | linux | 16 | 19 procPeak:proxy 16/16 | — |
| S2/short | linux | 16 | 25 cdn-cache:memory-growth 16/16; 58 solver:cost-per-generation 16/16; 58 solver:retained-before-recycle 16/16; 58 procPeak:scenario 16/16; 58 growth:scenario 14/16 †; 58 procPeak:solver 0/16 † | — |
| S3/short | linux | 8 | 16 failed-launches 8/8; 16 stale-lock-after-round 8/8; 16 exactly-one-proxy-after-round 1/8 †; 37 peak:kit 8/8; 37 procPeak:launcher 8/8; 37 procPeak:mcp-bridge 8/8; 37 procPeak:preflight 1/8 †; 37 procPeak:proxy 2/8 † | — |
| S3/hung | linux | 8 | 16 failed-launches 8/8; 16 stale-lock-after-round 8/8; 16 exactly-one-proxy-after-round 0/8 †; 16 start-over-stale-lock 0/8 †; 37 peak:kit 8/8; 37 procPeak:launcher 8/8; 37 procPeak:mcp-bridge 8/8; 37 procPeak:preflight 7/8 †; 37 procPeak:proxy 2/8 † | — |
| S3/omp | linux | 16 | 35 omp:concurrent-preflights 16/16; 37 procPeak:proxy 4/16 †; 37 procPeak:preflight 5/16 † | — |
| S4/short | linux | 16 | 17 stale-lock-after-ctrl-c 16/16; 17 unstoppable-proxy-after-ctrl-c 1/16 †; 17 respawn-recovers-despite-stale-lock 16/16 | — |
| S5/short | linux | 16 | 30 growth:mcp-bridge 16/16 † (marked from the 13 tree, where the count restarts: 9/10; Round 17 Q2) | — |
| S7/short | linux | 16 | 33 proxy.log:bounded-while-running 16/16 | — |
| S1/burst4 | windows | 24 | 19 procPeak:proxy 24/24 | — |
| S1/burst16 | windows | 24 | 19 procPeak:proxy 24/24 | — |
| S1/burst32 | windows | 24 | 19 procPeak:proxy 24/24 | — |
| S1/bigbody | windows | 24 | 19 procPeak:proxy 24/24 | — |
| S1/stalled | windows | 24 | 61 procPeak:proxy 24/24 | — |
| S2/short | windows | 24 | 25 cdn-cache:memory-growth 24/24; 58 solver:cost-per-generation 24/24; 58 solver:retained-before-recycle 24/24; 58 procPeak:scenario 24/24; 58 growth:scenario 13/24 †; 58 procPeak:solver 0/24 † | — |
| S3/short | windows | 8 | 16 failed-launches 8/8; 16 stale-lock-after-round 8/8; 16 exactly-one-proxy-after-round 3/8 †; 17 orphans 5/8 †; 37 peak:kit 8/8 | — |
| S3/hung | windows | 8 | 16 failed-launches 8/8; 16 stale-lock-after-round 8/8; 16 exactly-one-proxy-after-round 1/8 †; 16 start-over-stale-lock 1/8 †; 17 orphans 7/8 †; 37 peak:kit 1/8 † | — |
| S3/omp | windows | 24 | 35 omp:concurrent-preflights 24/24; 37 peak:kit 2/24 † | — |
| S4/short | windows | 24 | 17 proxy-left-after-stop 1/24 †; 17 failed-lifecycle-steps 1/24 †; 17 stale-lock-after-ctrl-c 24/24; 17 unstoppable-proxy-after-ctrl-c 24/24; 17 respawn-recovers-despite-stale-lock 24/24; 17 count:proxy 1/24 † | — |
| S7/short | windows | 24 | 33 proxy.log:bounded-while-running 24/24 | — |

Windows S4/short `count:proxy` is owned by 17 and marked `flips` (Round 16 Q1): 1 of 24 before 13 (run 42425476318, integration 06aa96b; Round 15's window counted it 1/26), 0 of 10 on the 13 tree. In 42425476318 the S4/short `summary.json` (`notes.sigintDuringStart`) shows the second proxy in the Ctrl-C-during-start phase (`childSurvived: true`, `pidRecordStartedMs: null`, `nextStart: 0`, `proxiesAfter: 2`), the adoption 17's What-to-build names. Linux S4/short `count:proxy` is 0 of 26 and stays unlisted.

**On the 13 tree** (10 runs per leg, every key). Source: the `memory-budget-<leg>` artefacts of each run (`/home/AgentKit/overhaul-tools/ci-art/t67-r3-art/<run>-<leg>/job-summary.json`, `t67-scripts/rates-artifacts.mjs`).

| key | leg | n | owner name RED/n | not owned |
|---|---|---|---|---|
| S1/burst4 | linux | 10 | 19 procPeak:proxy 10/10 | — |
| S1/burst16 | linux | 10 | 19 procPeak:proxy 10/10 | — |
| S1/burst32 | linux | 10 | 19 procPeak:proxy 10/10 | — |
| S1/bigbody | linux | 10 | 19 procPeak:proxy 10/10 | — |
| S2/short | linux | 10 | 25 cdn-cache:memory-growth 10/10; 58 solver:cost-per-generation 10/10; 58 solver:retained-before-recycle 10/10; 58 procPeak:scenario 10/10; 58 growth:scenario 1/10 †; 58 procPeak:solver 0/10 † | — |
| S3/short | linux | 10 | 16 failed-launches 10/10; 16 stale-lock-after-round 10/10; 16 exactly-one-proxy-after-round 0/10 †; 37 peak:kit 10/10; 37 procPeak:launcher 10/10; 37 procPeak:mcp-bridge 10/10; 37 procPeak:preflight 5/10 †; 37 procPeak:proxy 3/10 † | — |
| S3/hung | linux | 10 | 16 failed-launches 10/10; 16 stale-lock-after-round 10/10; 16 exactly-one-proxy-after-round 0/10 †; 16 start-over-stale-lock 0/10 †; 37 peak:kit 10/10; 37 procPeak:launcher 10/10; 37 procPeak:mcp-bridge 10/10; 37 procPeak:preflight 7/10 †; 37 procPeak:proxy 3/10 † | — |
| S3/omp | linux | 10 | 35 omp:concurrent-preflights 10/10; 37 procPeak:proxy 3/10 †; 37 procPeak:preflight 6/10 † | — |
| S4/short | linux | 10 | 17 stale-lock-after-ctrl-c 10/10; 17 unstoppable-proxy-after-ctrl-c 4/10 †; 17 respawn-recovers-despite-stale-lock 10/10 | — |
| S5/short | linux | 10 | 30 growth:mcp-bridge 9/10 † | — |
| S7/short | linux | 10 | 33 proxy.log:bounded-while-running 10/10 | — |
| S1/burst4 | windows | 10 | 19 procPeak:proxy 10/10 | — |
| S1/burst16 | windows | 10 | 19 procPeak:proxy 10/10 | — |
| S1/burst32 | windows | 10 | 19 procPeak:proxy 10/10 | — |
| S1/bigbody | windows | 10 | 19 procPeak:proxy 10/10 | — |
| S1/stalled | windows | 10 | 61 procPeak:proxy 10/10 | — |
| S2/short | windows | 10 | 25 cdn-cache:memory-growth 10/10; 58 solver:cost-per-generation 10/10; 58 solver:retained-before-recycle 10/10; 58 procPeak:scenario 10/10; 58 growth:scenario 5/10 †; 58 procPeak:solver 0/10 † | — |
| S3/short | windows | 10 | 16 failed-launches 10/10; 16 stale-lock-after-round 10/10; 16 exactly-one-proxy-after-round 1/10 †; 17 orphans 9/10 †; 37 peak:kit 10/10 | — |
| S3/hung | windows | 10 | 16 failed-launches 10/10; 16 stale-lock-after-round 10/10; 16 exactly-one-proxy-after-round 2/10 †; 16 start-over-stale-lock 1/10 †; 17 orphans 9/10 †; 37 peak:kit 2/10 † | — |
| S3/omp | windows | 10 | 35 omp:concurrent-preflights 10/10; 37 peak:kit 0/10 † | — |
| S4/short | windows | 10 | 17 proxy-left-after-stop 0/10 †; 17 failed-lifecycle-steps 0/10 †; 17 stale-lock-after-ctrl-c 10/10; 17 unstoppable-proxy-after-ctrl-c 10/10; 17 respawn-recovers-despite-stale-lock 10/10; 17 count:proxy 0/10 † | — |
| S7/short | windows | 10 | 33 proxy.log:bounded-while-running 10/10 | responses-store:heap-at-cap 1/10 |

Linux S5/short `growth:mcp-bridge` is owned by 30 and marked `flips` (Round 17 Q2). Before 13 it was RED in 16 of 16 matching runs (Round 17's recount over every archived linux run: 0 GREEN of 37). On the 13 tree it was RED in 9 of 10: 42436186573 was GREEN at 39.53 %/1k with trend false (net rise 9.7 %, no rising run, window medians 88.7, 91.9, 95.6, 96.5, 97.3, 97.3 MB). The other nine were 39.76–45.99 with trend true.

**Merge-gate replay (Round 16 Q2 condition 2, amended by Round 17 cross-question condition 3).** `t67-scripts/replay-artifacts.mjs` replays each run's `job-summary.json` results through 67's final `ratchet.mjs` and `expected-red.json`. It checks (a) a RED that no owner holds, (b) an invalid run or a harness failure, (c) an owned name not marked `flips` that is GREEN, and (d) a listed entry GREEN with no `flips` name. The two runs from before 67 (42425069025, 42429164758) carry no `checkNames`; the script rebuilds them from each run's own `summary.json`, as `job.mjs` now does. The script leaves Round 17 signatures (i) and (ii) out of the judgement when the run's values fit them, and reports them:
- (i) S7/short `responses-store:heap-at-cap` ≤ 128 MB;
- (ii) windows S1/short RED only on commit on `growth:proxy` alone, ≤ 10 %/1k.

Result over the ten runs on the 13 tree: all 20 legs valid, all 20 pass.
- 42436010878 windows: excluded as (i), 98 MB.
- 42436354758 windows: excluded as (ii), 5.25 %/1k commit.
- 42436186573 linux: S5/short passes GREEN on its flipping mark.

The measurement tables for S7, windows S1/short and the OMP floor belong to ticket 71. Not memory: windows `test-kit` failures in 42436186573 (Node 24, `manager-safety.test.mjs`, ticket 70) and 42436440284 (Node 26, the OMP floor test, Round 17 Q4, ticket 71).

Local supplement (labelled, **never counted**, Round 15 Q2 condition 1; Linux, Node 26.7.0, Bun 1.4.2, `node tests/memory/job.mjs --only <key>`, ports 19671–19678, `/home/AgentKit/overhaul-tools/t67-memloop/`): S3/hung on 5c68c2f, 8 of 8 RED on failed-launches, stale-lock-after-round, peak:kit, procPeak:launcher, procPeak:mcp-bridge, plus procPeak:proxy in 6 of 8. S3/short on 58ad4c6, 8 of 8 RED on exactly peak:kit, procPeak:launcher, procPeak:mcp-bridge, failed-launches, stale-lock-after-round. Neither shows procPeak:preflight, which CI shows (Round 15 correction 6).

### Rare tails decided as measurement rules (ticket 71; Round 17 Q1, Q3, Q4 and Round 21 Q1)

Sources: the archived memory-job logs `/home/AgentKit/overhaul-tools/ci-art/t67-logs/logs/*.log` (every CI run up to 42429164758) plus the memory-job logs of the eight staging/67 evidence runs 42435825059 … 42436440284 (job-log API, `/home/AgentKit/overhaul-tools/t71-ci/`), one value per run and leg, read from the run's own check line. Tabulation script: `/home/AgentKit/overhaul-tools/t71-scripts/tab.py`.

**S7/short `responses-store:heap-at-cap` under the one-reading rule (Round 17 correction 2).** Heap growth, one `/health` reading 5 s after the load, no GC; budget 96 MB.

| leg | runs | min | cluster | tail above 66 MB (run) | RED |
|---|---|---|---|---|---|
| windows | 51 | 60 | 46 of 51 in 60–65 (64 in 31) | 71 (42378479007), 71 (42415959288), 86 (42421424292), 87 (42281646419), **98** (42436010878) | 1 (42436010878) |
| linux | 70 | 59 | 69 of 70 in 59–65 (63 in 49) | 77 (42367395231) | 0 |

From ticket 71 on, the value is the store's retained heap: the minimum of ≥ 30 `/health` readings 1 s apart after the 5 s wait, minus h0 (Round 17 Q1). Local runs, Linux, Bun 1.4.2, Node 26.7.0 (ticket 71 branch, ports 19710–19713, `/home/AgentKit/overhaul-tools/t71-memloop/`):

| run | store | profile | h0 | first reading | min / max of 30 | value, one-reading rule | value, retained rule (≤ 96) | RSS before → after … last |
|---|---|---|---|---|---|---|---|---|
| s7-short-1 | shipped (1,000 / 64 MB) | short (1,500 × 64 KB) | 7 | 70 | 70 / 70 | 63 | 63 GREEN | 85 → 159 … 156 |
| bounded-long | shipped | long (4,000 × 64 KB) | 8 | 70 | 70 / 70 | 62 | 62 GREEN | 89 → 170 … 164 |
| mut-long | **both bounds removed** (local mutant, never committed) | long | 8 | 262 | 260 / 262 | 254 | **252 RED** | 90 → 387 … 379 |
| mut-short | **both bounds removed** | short | 7 | 102 | 102 / 102 | 95 | 95 GREEN | 85 → 196 … 190 |

The short profile cannot tell an unbounded store from a bounded one: 95 under both rules, below 96 (Round 17 correction 3). The long profile can: 252 against 62. Every later run prints the series in the job summary ("Responses store retained heap"). A minimum above 66 MB comes back as a question (Round 17 Q1 condition 3).

**S1/short `growth:proxy` (Round 17 correction 1, Q3).** Commit growth on windows, RSS on Linux, %/1k; the budget is 5 with the trend.

| leg | runs | min | median | mean | sd | max | RED (> 5 AND trend) | histogram (0.5 %/1k bins from 1.0) |
|---|---|---|---|---|---|---|---|---|
| windows (Round 17 recount) | 49 | 1.43 | 3.56 | 3.41 | 0.93 | 5.27 | 2 (42382114395 5.27, 42436354758 5.25) | — |
| windows (ticket 71 recount, same sources) | 51 | 1.43 | 3.50 | 3.39 | 0.93 | 5.27 | 2 (same two) | 1, 2, 9, 7, 6, 12, 9, 3, 2 |
| linux | 70 | 1.02 | 2.90 | 2.88 | 0.69 | 4.43 | 0 | 1, 4, 20, 15, 17, 6, 7 |

The ticket 71 recount finds 51 distinct windows runs with an S1/short line, where Round 17 counted 49. Min, max and both REDs are the same, and the decision does not move (2 of 51: 0.05 % at n = 5). The fits (Round 17): normal P(> 5) = 4.3 %, log-normal 7.8 %. n = 5 comes from the log-normal fit at ≤ 1 % (n = 3 → 1.73 %, n = 5 → 0.42 %; 2/49 → 0.06 %; p = 0.14, the 95 % upper bound → 2.2 %). Windows WS growth in the two RED runs: 1.47 and 1.86. From ticket 71 on, windows S1/short runs 5 fresh repetitions: RED when ≥ 3 are RED, every repetition ≤ 10 %/1k on commit (`REPEATED`). Linux stays a single run.

**OMP no-op floor (ticket 03's floor test; Round 17 Q4).** The stub host's cost for a hook that does nothing (commit on Windows, RSS on Linux). The test is now: the median of n fresh hosts < 2.5 MB, every one < 5 MB.

| leg | source | values | min / median / max (MB) | at or above 2.5 MB | n at ≤ 1 % |
|---|---|---|---|---|---|
| windows | CI, before ticket 71 (a passing run printed no value) | one value on record: 2.55 (42436440284, Node 26); 15 of 16 legs passed | — | 1 of 16 legs | 5 (n = 3: 1.12 %, n = 5: 0.22 %) |
| windows | CI measurement mode, run 42467078897, test-kit (windows-latest, Node 24.22.2), 20 fresh hosts, commit | 0.06, 0.06, **2.49**, 0, 0, **2.43**, 0.06, 0.06, 0.13, 0, 0.06, 0.06, 0.06, 0, 0, 0.06, 0.13, 0, 0.13, 0.13; working set beside it 0.07–0.29 (0.2 in 16 of 20) | 0 / 0.06 / 2.49 | 0 of 20 | 3 |
| windows | the record and the measurement pooled | 36 values | — | 1 of 36 | 3 (n = 3: 0.23 %) |
| linux | ticket 03 (local) | +0.63 to +0.75 | | 0 | |
| linux | ticket 71, local, measurement mode inside a full `npm run test` (Node 26.7.0, Bun 1.4.2), 25 fresh hosts | 0.5, 0.63, 0.63, 0.63, 0.63, 0.5, 0.5, 0.63, 0.63, 0.63, 0.5, 0.5, 0.63, 0.5, 0.63, 0.5, 0.75, 0.63, 0.63, 0.63, 0.5, 0.75, 0.63, 0.63, 0.63 | 0.5 / 0.63 / 0.75 | 0 of 25 | 3 |
| linux | CI measurement mode, run 42467078897, test-kit (ubuntu-latest, Node 26.13.0), 20 fresh hosts, RSS | 0.44, 0.44, 0.5, 0.31, 0.5, 0.31, 0.53, 0.44, 0.56, 0.69, 0.56, 0.59, 0.31, 0.31, 0.56, 0.44, 0.31, 0.44, 0.31, 0.31 | 0.31 / 0.44 / 0.69 | 0 of 20 | 3 |

Run 42467078897 (staging/71 with the marker `tests/memory/measure-omp-floor` = 20) measured two of its four test-kit legs; the ubuntu Node 24 and windows Node 26 legs failed in `setup-bun` (HTTP 504) before any test ran. That is still ≥ 20 per OS leg. No measurement is ≥ 5 MB. **n = 5**, the largest n over the estimates (as in Round 11 Q1): the CI values alone give n = 3 on both legs (0 of 20), and windows pooled with its record gives n = 3 (1 of 36: n = 3 → 0.23 %). The less favourable estimate is the windows record alone, 1 of 16 legs at 2.55 MB: n = 3 → 1.12 % > 1 %, n = 5 → 0.22 %. **The windows commit floor has two groups:** 16 of 20 values are 0–0.13 MB, but two sit at 2.43 and 2.49 MB, within 0.07 MB of the 2.5 MB median threshold, next to the earlier 2.55. That is 3 of 36 known windows values at ≥ 2.43 MB (8.3 %; at that rate n = 3 → 1.97 %, n = 5 → 0.51 %). A count at the 2.5 cut is fragile, and n = 5 holds under that reading too. Working set stays at 0.07–0.29 MB in all 20, so the second group is commit only. For ticket 35's waiter gate (Round 17 Q4 condition 2): the windows floor reaches about 2.5 MB of commit in about 1 run in 12, which leaves about 2.5 MB of margin under the 5 MB gate for a waiter's own cost on such a run. Linux stays at 0.31–0.75 MB in every measurement so far.

**S6/short `tui:adversarial-line-heap` (Round 21 corrections 1 and 3).** The worst of `D-mixed`, `D-huge`, `D-cjk`, `D-records`, `end` minus `C-start`, each after `Bun.gc(true)`; budget 16 MB.

| source | runs | values | `tui:long-line-heap` |
|---|---|---|---|
| linux CI, 42415961268 … 42454650683 on the same S6 and pane code (Round 21) | 33 | 32 × 8 MB, 1 × 20 MB (42446461464: `D-records` and `end` 22 MB heap against 2 MB in the other 9 staging/19 runs) | 7–8 MB in all 33 |
| ticket 71, local, `job.mjs --only S6/short` (5 repetitions) | 5 | 8, 8, 8, 8, 8 (median 8); `end` paneBytes 287,780; `flushed` 0 MB above `C-start` | 7, 7, 7, 7, 8 |
| ticket 71, local mutant (never committed): `fitLine` stores the raw row without the copy | 5 | 20, 20, 20, 20, 20 (median 20, RED); `flushed` 0 MB above `C-start` | 7 in all 5 |

From ticket 71 on, linux S6/short is the median of 5 fresh S6 body repetitions against 16 MB, every repetition ≤ 32 MB (`REPEATED`). n = 5 comes from 1 of 10 on the staging/19 tree (n = 3 → 2.80 %, n = 5 → 0.86 %; 1 of 33 → 0.027 %).

### Request-body copies removed one at a time (ticket 20; Round 18 Q1–Q3)

Linux x64, Node 26.7.0, Bun 1.4.2, local machine (AMD EPYC, 8 cores, shared with other agents' runs). Each run is `node tests/memory/job.mjs --only S1/burst4,S1/burst16,S1/burst32,S1/bigbody --cap systemd` from a detached snapshot worktree of the named commit (`/home/AgentKit/wt/t20-<step>`), port 19200. Logs: `reports/t20-red-base.log`, `t20-meas-s1.log` … `t20-meas-final.log`. Run directories: `/home/AgentKit/overhaul-tools/t20-memloop/<step>/`. The value is `procPeak:proxy` = max(sampled RSS, VmHWM) in MB: the median of the step's repetitions, with the range in brackets. Factor = (median − 90) / MB admitted, Round 18's formula: 64.8 MB at burst16 and burst32 (six 10.8 MB bodies under the 64 MiB cap), 43.2 MB at burst4 (the cap does not bind). Bigbody is paced and mixed, so it has no admitted-bytes figure. In every run the loop's own isolation proof is empty (`isolation.facts.externalConnections`, `isolation.externalConnectionsDuringRun`), so the proxy talked only to the loopback mock.

| step | commit | copy removed | reps | burst4 | burst16 | burst32 | bigbody | factor 16 / 32 |
|---|---|---|---|---|---|---|---|---|
| base | e88821f | none (integration tip, ticket 19 merged) | 5 | 323.6 (300.2–339.5) | 480.6 (433.9–520) | 563.1 (560.2–569.5) | 366.5 (327.6–383.4) | 6.0 / 7.3 |
| 1 | 21d747f | validation, request meta, translation and transforms read one `JSON.parse` (was 3) | 3 | 372.1 (350.1–386.1) | 565 (472.8–597) | 606.9 (539.9–645.7) | 382.3 (367.7–384.3) | 7.3 / 8.0 |
| 2 | e2bbd28 | one buffer of the declared length, instead of every chunk plus their joined copy | 3 | 365.6 (340.9–373.1) | 519.1 (506.2–521) | 585.7 (545.1–621.9) | 388.9 (363.4–391.7) | 6.6 / 7.6 |
| 3 | 25ff451 | the session resolver reads the parsed body (2 more parses gone) | 3 | 339.4 (293.5–342.5) | 464.8 (458.7–476.9) | 531.6 (480.1–550.1) | 315.7 (313.2–337.3) | 5.8 / 6.8 |
| 4 | cc266d7 | the session identity is hashed piece by piece, not joined into one text at every nesting level (~4 copies) | 3 | 253.1 (243.4–296) | 399.6 (395.7–423) | 428.1 (418.2–461.9) | 244.4 (239.7–248.5) | 4.8 / 5.2 |
| 4b | 8499b94 | long identity strings escaped in 16 Ki slices, not one `JSON.stringify` copy | 3 | 250.1 (244.1–274) | 389.1 (377.1–412.1) | 433 (428.5–436.1) | 240.4 (227.6–272.7) | 4.6 / 5.3 |
| 5 | 375bea2 | the client text and object are released before the upstream text is built | 3 | 263.8 (234.3–268.1) | 397.8 (390.5–418.4) | 438.9 (415.1–445.5) | 227.9 (223.7–270.7) | 4.8 / 5.4 |
| 6 | ec3ff73 | translated requests (chat, responses, both async routes) transformed as built: no stringify + parse round trip (2 copies) | 5 | 259.4 (235.8–282.2) | 393 (376.9–395.1) | 446.5 (404.1–461.7) | 214.9 (205.9–221) | 4.7 / 5.5 |
| 7 | 147c87f | bodies ≥ 1 MiB parsed from their bytes (`Response.json()`), so no JS copy of the text | 5 | 247.9 (217–251.9) | 370.6 (342.9–398.7) | 406.7 (396.6–441.3) | 217.9 (207.6–220.6) | 4.3 / 4.9 |
| 8 | e0de0e0 | identity slices with nothing to escape hashed as they are | 5 | 246.4 (227.6–259.1) | 350.7 (327.4–363.3) | 389.4 (362.5–404.2) | 193.8 (186.7–214.2) | 4.0 / 4.6 |
| 9 (final) | 9ccf978, measured as the merge 2798d2e (the merge changes no file on the S1 request path) | identity pieces UTF-8 encoded into one reused buffer, not a new buffer per `hash.update` | 10 | **225.8 (193.3–241.2)** | **313.8 (297.4–342.2)** | **351.1 (330–375.8)** | **183.6 (173.6–198.6)** | **3.5 / 4.0** |
| budget | | | | 250 | 400 | 600 | 250 | |

Final against base: burst4 −30.2 %, burst16 −34.7 %, burst32 −37.6 %, bigbody −49.9 %. Every one of the 10 final repetitions is GREEN on every key. The burst4 factor goes from 5.4 to 3.1.

Other S1 runs on the final tree (2798d2e, linux, `reports/t20-meas-final.log`):
- S1/short: GREEN (growth 3.41 %/1k, no trend; peak 148.1 MB; steady 118 MB).
- S1/stalled: GREEN (growth 0.61 %/1k; peak 165.8 MB).
- **S1/burst1, ≥ 20 repetitions** (`node tests/memory/job.mjs --measure-burst1 20`, ticket 60's measurement mode; `/home/AgentKit/overhaul-tools/t20-memloop/final-burst1/out/measure-S1-burst1.{json,md}`): 20 of 20 valid, **0 of 20 above 250 MB**. Min / median / max are 116.2 / 119.5 / 128.6 MB. On the base tree e88821f the same 20-run measurement gave 177.6 / 186.4 / 199.9 MB, 0 of 20 above 250 (`red-base-burst1`). Linux already met the criterion after ticket 19's collection; ticket 20 adds 121 MB of margin. Windows has no measurement on this tree yet (pending CI, through the marker `tests/memory/measure-burst1`).

What the steps show:
- **Step 1 alone made the peaks worse.** The validation parse's object stayed reachable while the session resolver still parsed the body twice and joined the identity text. One more copy was therefore live at the moment of most allocation. Steps 3–4 removed what it overlapped with.
- **The session resolver was the big lever** (`client-session.ts`; observe is the default mode). It parsed the body twice, joined the identity's stable text anew at every nesting level, and converted it to UTF-8 for the hash. That cost about 6 copies of a large body per request (steps 3, 4, 4b, 8 and 9).
- **Steps 2 and 5 are within run-to-run noise on their own** (±30 MB at 3 repetitions on a shared machine). Their value shows once the overlapping copies are gone.
- **Where the rest goes.** A phase probe measured an instrumented scratch copy that answers right after each phase, with 4 concurrent bodies (`/home/AgentKit/overhaul-tools/t20-scripts/probe.mjs`, never committed). At step 8 it placed the remaining peak in:
  - receiving the bodies: the socket chunks plus the read buffer, about 2 copies, the same as `await request.arrayBuffer()`;
  - the parsed tree;
  - the upstream text;
  - garbage not yet collected while the upstream reads the body.

  Sending a string body to fetch costs nothing extra: Bun streams it.
- **Measured with the probe and not adopted:**
  - a collection right after the upstream text is built (eden or full): no change beyond noise;
  - sending bytes or a Blob instead of the string: bytes +60 MB at 4 bodies, Blob no gain;
  - Bun `--smol` (`BUN_OPTIONS=--smol`): no gain at 4 or 16 bodies.

### S1/stalled: response-side attribution and backpressure (ticket 61; Round 12 Q3)

**Windows, from the archived `memory-budget-windows` artefacts (shipped `tee()` tree).** 75 distinct S1/stalled runs from 42265988296 on (every `S1-stalled/**/samples.csv` under `/home/AgentKit/overhaul-tools`, deduplicated; `/home/AgentKit/overhaul-tools/t61-scripts/stalled-art.py` and `stalled-art-stats.py`). Proxy rows only; "idle" is the first sample before the load window (`notes.loadWindowMs`); heap is the proxy's `/health` `heapUsedMB` that the sampler records with every sample. Values in MB, min / median / max.

| leg | runs | idle WS (RSS) | idle commit | idle heap | WS gate (procPeak) | commit peak | WS during load, median | heap during load, median | heap during load, peak |
|---|---|---|---|---|---|---|---|---|---|
| windows | 75 | 51.0 / 52.5 / 55.0 | 177.2 / 182.2 / 187.4 | 4 / 4 / 5 | 278.3 / 301.5 / 332.5 (without the Round 7 runs 42252896054 and 42265988296, whose 444 and 452.3 are commit-gated values) | 429.9 / 451.1 / 485.1 | 216.1 / 224.6 / 235.7 | 47 / 54 / 60 | 88 / 111 / 140 |
| linux | 70 | — (no sample before the load) | — | — | 141.7 / 174.1 / 208.2 | — | 113.9 / 135.2 / 164.2 | 15 / 16.5 / 30 | 21 / 25 / 51 |

At the peak the windows proxy's JS heap holds about 107 MB more than at idle (13 MB per stalled reader at 8 readers); the linux heap about 20 MB. A `tee()` branch queue is JS-held bytes (a local probe: 17.2 MB queued in an unread branch raises `heapUsed` by 18 MB and RSS by 36 MB), so the heap is where bucket (i) shows. The split against a drained reference on windows is the attribution mode's job (`job.mjs --measure-stalled`, marker `tests/memory/measure-stalled`): pending CI.

**Mechanism, linux experiments** (Bun 1.4.2, `/home/AgentKit/overhaul-tools/t61-scratch/`): Bun's response writer stops pulling once the kernel send buffer is full. For one paused loopback client it pulled 3.95 MiB of a 4.5 MB answer, all of it in the kernel (`ss`: Send-Q 4,025,344 B, `tcp_wmem` max 4 MiB, client Recv-Q 127,096 B), so on linux only ~0.35 MB per stalled reader stayed in the `tee()` queue. A Bun `fetch` body that JS does not read costs about 1.0–1.1 MB per stream and stops there (the upstream's kernel queues hold the rest; 0.78 MB per stream once drained). Read late, a `fetch` body returns what accumulated meanwhile: 130–330 KB per read against 64 KB when read as it arrives.

**Linux attribution mode, local** (`node tests/memory/job.mjs --measure-stalled N --cap systemd`, port 19614–19617; run dirs `/home/AgentKit/overhaul-tools/t61-memloop/attr-*`). Pre-fix tree: 1495c03 (the integration tip's proxy plus the mode). The pairs of 3 rotations ran side by side, pre against the branch. RSS, MB, medians:

| tree | rotations | stalled peak | drained peak | idle floor | (iii) drained excess | (i) JS-held | (ii) residual | stalled per reader (excess) |
|---|---|---|---|---|---|---|---|---|
| 1495c03 (`tee()`) alone | 1 | 169.8 | 149.8 | 59.7 | 89.8 | 5 | 15.3 | 13.8 |
| 1495c03, beside e540752 | 3 | 174.4 | 166 | 59.7 | 106.1 | 3 | 5.6 | 14.3 |
| e540752 (backpressure, whole chunks) | 3 | **188.8** | 167.1 | 60.3 | 107 | 5 | 16.5 | 16.1 |
| 1495c03, beside caf66db | 3 (184.3, 175, 173.4) | 175 | 161.2 | 60.1 | 101.3 | 5 | 8.6 | 14.4 |
| caf66db (backpressure, 64 KiB pieces) | 3 (147.8, 150.6, 148.5) | **148.5** | 144.1 | 59.8 | 84.4 | 6 | −1.7 | 11.1 |

All rows "accounted" (|residual| ≤ 20 % of the excess). On linux the stalled excess is almost all (iii): the kernel holds what a stalled reader leaves. Backpressure alone (e540752) raised the linux stalled peak by ~14 MB; the cause was the large late reads above, copied and held whole by every stage after the upstream (terminal-frame guard, decoders, socket write). Standalone A/B (`t61-scratch/ab-proxy.ts`: the proxy's `startServer` against the soak mock, 8 stalled readers at 25/s for 60 s, VmHWM): tee() tree 129.9–143.4 MB, e540752 145.9–150, with the 64 KiB pieces 117.1–119.8 (4 rounds).

**Other S1 and S7 runs on caf66db** (`job.mjs --only …`, `t61-memloop/fix2-s1-job`, "ratchet holds"): S1/short GREEN (growth 3.53 %/1k, peak 145.5, steady 114.3); S1/burst1 median 121.3 of 7 (118.1–123.7); burst4 230.8; burst16 327.2; burst32 348.7; bigbody 201.7; S1/stalled 148.9 (growth −0.03 %/1k); S7/short RED only on `proxy.log:bounded-while-running` (ticket 33), heap-at-cap 63, peak 211.7. Paired, alternating with 1495c03 (`t61-memloop/paired-heavy`, `paired-burst4`): bigbody 196.7 / 190 / 193.7 against 195.5 / 172.8 / 187.4; burst4 median 219.9 (206.4–228.6, 9 runs) against 230.6 (214.7–235.8, 9 runs), one-sided permutation p = 0.015. The burst4 path (non-streaming bodies, a "mock-ok" answer) runs none of the changed code except one socket write per answer; the standalone A/B of that shape (4 × 10.8 MB, 12 requests, 5 rounds) gives 189.9–217.7 MB on the tee() tree and 177.4–214.6 on the branch.

**Windows attribution mode, CI (Round 12 Q3 criterion 1; Round 31 Q2 condition 1).** Staging m1 = 1495c03 (shipped `tee()` proxy + the mode), run 42561009557; m2 = branch head ce6d627, run 42561017903; marker `3`, 3 rotations S1/stalled → S1/drained per leg, 8 stalled readers. Artefacts: `/home/AgentKit/overhaul-tools/ci-art/t61m/{m1,m2}-{windows,linux}/measure-S1-stalled.{md,json}`. Buckets as the mode defines them: (iv) the idle floor; (iii) the drained peak above its floor; (i) the JS heap the stalled run holds above the drained run's, above their floors; (ii) the residual of the excess. The rule, fixed in the mode before the run (`tests/memory/lib/measure.mjs` `STALLED_ACCOUNTED_SHARE = 0.2`, ticket 61 Comments 2026-11-09): accounted when the measured buckets (i) + (iii) explain the excess above idle to within ±20 %, i.e. |(ii)| ≤ 20 % of the excess. MB, medians of 3 (per stalled reader in brackets):

| tree | leg | metric | stalled peak | (iv) floor | excess above idle | (iii) drained excess | (i) JS-held | (ii) residual | residual share | accounted |
|---|---|---|---|---|---|---|---|---|---|---|
| m1 1495c03 | windows | WS | 293.1 | 54.9 | 238.2 (29.8) | 102.4 (12.8) | 85 (10.6) | 50.8 (6.3) | 21.3 % | **no** |
| m1 1495c03 | windows | commit | 453.7 | 182.4 | 271.3 (33.9) | 111.7 (14) | 85 (10.6) | 74.6 (9.3) | 27.5 % | **no** |
| m1 1495c03 | linux | RSS | 181 | 63.4 | 117.6 (14.7) | 84.8 (10.6) | 8 (1) | 24.8 (3.1) | 21.1 % | no |
| m2 ce6d627 | windows | WS | 132.4 | 54.8 | 77.6 (9.7) | 72.6 (9.1) | 9 (1.1) | −4 (−0.5) | −5.2 % | yes |
| m2 ce6d627 | windows | commit | 298.1 | 181.8 | 116.3 (14.5) | 111.1 (13.9) | 9 (1.1) | −3.8 (−0.5) | −3.3 % | yes |
| m2 ce6d627 | linux | RSS | 144.3 | 63.5 | 80.8 (10.1) | 56.5 (7.1) | 9 (1.1) | 15.3 (1.9) | 18.9 % | yes |

m1 windows per rotation (stalled run n paired with drained run n), residual share WS / commit: rotation 1 20.5 % / 26.9 %, rotation 2 19.5 % / 20.6 %, rotation 3 18.4 % / 24.9 %. Commit is outside ±20 % in all three rotations, and WS is outside on the medians and in rotation 1. Drained arm m1 → m2 windows: WS 157.4 → 127.4, commit 298.3 → 294.7.

**Verdict, criterion 1 as written: not met; the attribution is inconclusive.** On the shipped tree (m1) the measured buckets explain 78.7 % of the windows WS excess above idle and 72.5 % of the commit excess. Both are outside ±20 %, and the criterion names both metrics. Bucket (ii) has no measurement of its own here. It is the residual, so it cannot be counted toward the accounting without making the test true by construction. The m2 values are the fix tree's result, not the attribution of the shipped peak. They show that the stage-2 change removes the stalled-specific excess on windows: stalled minus drained WS falls from 135.7 to 5.0, the stalled peak drops 160.7 MB WS and 155.6 MB commit, and (i) falls from 85 to 9. That is causal evidence for a proxy-side lever, but it does not satisfy the pre-registered accounting. One explanation is not part of the rule and is not a verdict: (i) is counted in `heapUsed` MB, and the local probe above saw RSS rise about twice as much as `heapUsed` for queued `tee()` bytes, so the WS cost of (i) could carry the residual. Criterion 4 applies, so the stage-2 commits and Round 31 Q2's acceptance go back to the Owner Proxy with these numbers. Recorded 2026-11-09 (ticket 61 round 2).

**Owner Proxy round 32 records.** m1 is recorded as not accounted under the pre-registered rule (WS 21.3 %, commit 27.5 %; per rotation WS 20.5/19.5/18.4, commit 26.9/20.6/24.9); the rule and its median form are unchanged. The residual (50.8 WS / 74.6 commit MB) is unattributed, stalled-specific; "RSS ≈ 2× heapUsed for queued `tee()` bytes" is an unproven hypothesis. Stage 2 ships on the m2 intervention (round 32 Q1). The local burst4 paired shift above (219.9 → 230.6, p = 0.015) is **flagged, unattributed**.

**Merged head, local linux (ticket 61 round 3, 2026-11-09).** Two trees, both with round 31 Q2's tests, the terminal-frame guard on demand (8d025d4) and the printHeader comment (fb17d71): fb17d71 = ce6d627 + the integration tip 63a704b (tickets 30 and 18); 5a8ad97 = fb17d71 + the tip e0962b7 (ticket 73, memory-loop sampler and runner; no proxy source). `job.mjs --only S1/<variant> --cap systemd`, port 19610, sequential, Node 26.7.0, Bun 1.4.2; run dirs `/home/AgentKit/overhaul-tools/t61-memloop/{r3,r3b}/`, logs `reports/t61-r3-s1-*.log`, `reports/t61-r3b-s1-*.log`; every run's isolation proof (`externalConnections`) is empty.

| run | fb17d71: outcome, procPeak:proxy, growth %/1k (trend) | 5a8ad97 (final merged head): outcome, procPeak:proxy, growth %/1k (trend) |
|---|---|---|
| S1/stalled 1 | GREEN, 149, −0.12 (false) | GREEN, 143.5, 0.16 (false) |
| S1/stalled 2 | GREEN, 144.2, −0.82 (false) | GREEN, 148.7, 0.07 (true) |
| S1/stalled 3 | GREEN, 152.9, −0.85 (false) | GREEN, 151.8, −0.07 (false) |
| S1/burst4 1 | GREEN, 227.4 | GREEN, 231.3 |
| S1/burst4 2 | GREEN, 225.8 | GREEN, 213.6 |
| S1/burst4 3 | GREEN, 227.9 | GREEN, 226.5 |
| S1/short 1 | GREEN, 142 (steady 113.2), 3.4 (true) | GREEN, 138.2 (steady 113.1), 3.44 (true) |

count:proxy 1 and orphans 0 in every run. S1/stalled median 148.7 (143.5–151.8) on 5a8ad97 and 149 (144.2–152.9) on fb17d71, against 175 on the `tee()` tree and 148.5 on caf66db (table above). **S1/burst4 beside ticket 20's distribution:** 5a8ad97 median 226.5 (213.6–231.3, n 3); fb17d71 227.4 (225.8–227.9, n 3); all six 226.95 (213.6–231.3); ticket 20's final 225.8 (193.3–241.2, n 10); this ticket's earlier paired run 230.6 (214.7–235.8, n 9). Every value is inside ticket 20's range, and the highest is 18.7 MB under the 250 budget. Local, shared machine; the pre-merge CI run decides (round 32 conditions 4 and 5).

### S3 kill-holder round: the adversary's victim is not a failed launch (ticket 16; Round 27 Q1)

**The rule (spec §18 PROCESSES, first bullet).** Measurement-rule amendment (Round 27 Q1): in the kill-holder round, the launch the adversary SIGKILLed (its pid equals the adversary's recorded `killed` pid, and it exited non-zero) is reported as `killedByAdversary` and is never a failed launch. Every other launch that does not exit 0 is a failed launch. A round counts as run only with exactly one such launch. Budget 0 is unchanged (`budgets.mjs` `PROCESSES.failedLaunches`, untouched).

- **Where it is enforced.** `tests/memory/scenarios/s3-concurrency.mjs` `launchOutcomes` leaves a launch out only when exactly one launch of the round carries the killed pid and it exited non-zero. Each round records `launches[]` (`i`, `via`, `pid`, `code`, `signal`). `tests/memory/lib/completeness.mjs` (`KILL_HOLDER_ROUNDS`: `kill-holder-10` in S3/short, S3/long and S3/hung) makes the run a harness failure, never GREEN, in these cases: no kill (`killed` not an integer, or no adversary record); a killed pid that matches no launch (this includes a round without `launches[]`, which is every summary written before 16); a matched launch that exited 0; two or more launches on the killed pid (a reused pid); or fewer launch records than launches. The failure names the round and prints the adversary record. If it fires in CI, it comes back with the run ids and adversary records, never rerun-until-green (Round 6 Q2 condition 3, Round 8 condition 4).
- **Power on archived pre-16 code under the new counting** (Round 27 correction 3; 62 linux and 43 windows archived runs, `/home/AgentKit/overhaul-tools/ci-art/t67-logs/`): `failed-launches` stays RED in S3/hung 62 of 62 linux and 43 of 43 windows, and in linux S3/short 61 of 62. Windows S3/short stays RED in only 34 of 43. In 9 of 43 runs (21 %), and in 4 of the latest 20, the victim was the only failure. Those runs would have been GREEN on pre-16 code. So, on windows, the removal of `failed-launches` and `stale-lock-after-round` also rests on the two kill-holder rounds of the pre-merge run (S3/short and S3/hung, each with one `killedByAdversary` and 0 `failedLaunches`) and on `tests/start-lock.test.mjs` on the windows `test-kit` legs of the same run (Round 27 Q1 condition 4).
- **History is not rewritten.** Every `failed-launches` value recorded before ticket 16 includes the victim, including the memory baseline's "7/10 failed (killed holder)" (above, from the memory report §6) and every count in the tables above.
- **S4 `staleLockLeft` (recorded, not judged; Round 27 Q1 condition 5).** `notes.respawnWithStaleLock.staleLockLeft` says whether the planted dead-holder lock (pid 2147483646) was still there after the respawn. No check reads it; `respawn-recovers-despite-stale-lock` is unchanged. On 16's tree (linux, local, `/home/AgentKit/overhaul-tools/t16-memloop/branch4`–`branch10`): `false` in 7 of 7, with the proxy healthy and respawn exit 0. Before the harness change, branch1–3 ended in an ENOENT harness failure on `unlinkSync`, because 16's kit had already taken that lock over. A judged check on it would be a new check name and a new question.
- **Matching-count restart (Round 27 Q1 condition 6, Round 16 Q2 condition 1).** Ticket 16 changes `s3-concurrency.mjs`, `s4-lifecycle.mjs` and the lifecycle path (`lib/start-lock.mjs`, `lib/proxy-lifecycle.mjs`). The matching runs restart on 16's tree for S3/short, S3/hung, S3/omp and S4/short, on both legs. 16's remaining `flips` names (`exactly-one-proxy-after-round` in S3/short and S3/hung; `start-over-stale-lock` in S3/hung) need ≥ 10 GREEN matching CI runs per leg on that tree. 17's S3 and S4 floors also count on that tree or a later one.

## Current

(pending)

## Windows S1/short repetitions by position (Round 28 Q1)

Raw job logs, commit growth:proxy %/1k per repetition (5 sequential repetitions since ticket 71; "no trend" marks a repetition whose trend flag was false). Generator: `/home/AgentKit/overhaul-tools/t78-scripts/s1short-table.mjs`. Owner: ticket 78 (needs-triage), which appends every later windows S1/short run.

| run | branch, head | rep 1 | rep 2 | rep 3 | rep 4 | rep 5 | median | verdict |
|---|---|---|---|---|---|---|---|---|
| 42481592284 | staging/71 d6efa3b | 5.32 | 3.57 | 3.3 | 4.67 | 5.33 | 4.67 | GREEN |
| 42493218404 | overhaul/stability-terminal-ux 8126454 | 3.02 | 3.9 | 5.06 | 2.79 | 3.36 | 3.36 | GREEN |
| 42494299680 | staging/29 57c3db0 | 5.34 | 3.04 | 3.59 | 4.66 | 3.18 | 3.59 | GREEN |
| 42495987510 | staging/15b a004477 | 2.51 (no trend) | 4.5 | 2.2 (no trend) | 4.54 | 3.45 (no trend) | 3.45 | GREEN |
| 42500996594 | staging/21 57ebbc8 | 2.6 | 3.98 | 3.02 (no trend) | 3.71 | 4.05 | 3.71 | RED |
| 42501852701 | overhaul/stability-terminal-ux 1b904a1 | 3.34 | 4.85 | 4.98 | 5 | 4.47 | 4.85 | GREEN |
| 42502565823 | staging/20 1b4a706 | 3.58 | 5.12 | 3.15 | 3.81 | 2.85 | 3.58 | GREEN |
| 42502646304 | staging/20 ce38cbc | 3.23 (no trend) | 2.17 | 3.68 | 5.38 | 3.85 | 3.68 | GREEN |
| 42502739091 | staging/20 ce16fdf | 3.99 | 3.27 | 3.66 | 4.53 | 5.6 | 3.99 | GREEN |
| 42502835975 | staging/20 93667ae | 3.61 | 6.22 | 4.44 (no trend) | 3.65 | 4.21 | 4.21 | GREEN |
| 42502922415 | staging/20 c97d59e | 3.51 | 4.18 | 2.46 | 4.88 | 3.67 | 3.67 | GREEN |
| 42503015768 | staging/20 8b88d97 | 1.79 (no trend) | 4.12 | 3.88 | 4.78 | 3.83 | 3.88 | GREEN |
| 42503101039 | staging/20 39dd963 | 4.02 | 4.85 | 3.4 | 5.15 | 4.31 | 4.31 | GREEN |
| 42503197608 | staging/20 25697bd | 3.6 (no trend) | 3.09 | 4.29 | 4.09 | 4.09 | 4.09 | GREEN |
| 42503284096 | staging/20 1a78acb | 5.27 | 4.5 | 5.12 | 6.04 | 4.92 | 5.12 | RED |
| 42503373851 | staging/20 17f1d36 | 1.8 (no trend) | 5.2 | 2.05 | 4.79 | 5.51 | 4.79 | GREEN |

Per position (all runs):
- position 1: n 16, mean 3.53, sd 1.10, max 5.34, above 5: 3
- position 2: n 16, mean 4.16, sd 1.00, max 6.22, above 5: 3
- position 3: n 16, mean 3.64, sd 0.96, max 5.12, above 5: 2
- position 4: n 16, mean 4.53, sd 0.78, max 6.04, above 5: 3
- position 5: n 16, mean 4.17, sd 0.83, max 5.6, above 5: 3
- ticket 20's tree: n 50, mean 4.06, sd 1.03, max 6.22, above 5: 10
- other trees: n 30, mean 3.91, sd 0.93, max 5.34, above 5: 4

Single-run windows S1/short (before the 5-repetition rule): n 23, mean 3.47, sd 0.87, max 5.18, above 5: 1

| run | branch, head | commit %/1k | trend | WS %/1k |
|---|---|---|---|---|
| 42446746036 | staging/19 e341ef1 | 1.92 | false | -2.15 |
| 42448137342 | overhaul/stability-terminal-ux 1fc7473 | 2.53 | true | -2.86 |
| 42448283566 | staging/67 4de913b | 3.54 | true | 0.24 |
| 42448791937 | staging/24 ea4f040 | 3.61 | false | 1.29 |
| 42453037136 | overhaul/stability-terminal-ux 5e99b52 | 3.67 | true | -2.09 |
| 42454650683 | staging/36 0cb730d | 4.91 | true | 2.94 |
| 42455986931 | staging/25 e7451c6 | 2.14 | true | -0.88 |
| 42457112513 | staging/19 b3e8fe7 | 4.1 | true | -1.39 |
| 42457120690 | staging/26 d44d187 | 4.27 | true | -1.18 |
| 42461329252 | staging/25 5707c95 | 3.01 | false | -3.47 |
| 42462167868 | overhaul/stability-terminal-ux dcc7615 | 4.21 | true | 1.85 |
| 42464297212 | staging/19 8239cde | 3.98 | true | 1.25 |
| 42465834202 | staging/25 a8fd203 | 2.46 | false | -2.92 |
| 42469136344 | overhaul/stability-terminal-ux e88821f | 4.38 | true | -0.15 |
| 42469139184 | staging/15 5c7cda7 | 3.84 | true | 0.3 |
| 42469209389 | staging/36 b37393f | 3.68 | true | -2.77 |
| 42475847194 | staging/30 0e99864 | 3.17 | true | -2.52 |
| 42478422809 | overhaul/stability-terminal-ux e8b16ed | 3.19 | false | -3.2 |
| 42480631098 | staging/21 0f87d20 | 3.72 | true | 0.18 |
| 42481585464 | overhaul/stability-terminal-ux 0f405d9 | 3.05 | true | -3.26 |
| 42483637377 | staging/30 a53152d | 5.18 | true | 2.46 |
| 42483787372 | staging/72 ee48822 | 3.24 | true | -3.41 |
| 42484868282 | overhaul/stability-terminal-ux eaa91b3 | 2.01 | false | -1.2 |

## Round 25 Q1 condition 4: the first 20 windows S5/short values on trees with ticket 36 (Round 29 Q1 condition 4)

Run-creation order, any branch; a tree "contains 36" when it contains ticket 36's first code commit e2990a2. Runs with no S5/short value (the burst1 measurement run 42502424683; cancelled runs) are skipped. Values: windows growth:mcp-bridge %/1k on commit (WS reported). Generator data: `/home/AgentKit/overhaul-tools/ci-art/r25-set/set.txt`.

| # | run | branch, head | with 30 | commit %/1k | trend | WS %/1k |
|---|---|---|---|---|---|---|
| 1 | 42454650683 | staging/36 0cb730d | no | 15.43 | false | 35.21 |
| 2 | 42469209389 | staging/36 b37393f | no | 18.14 | false | 29.31 |
| 3 | 42483637377 | staging/30 a53152d | yes | 34.62 | true | 19.17 |
| 4 | 42483787372 | staging/72 ee48822 | no | 19.82 | false | 25.2 |
| 5 | 42484868282 | overhaul/stability-terminal-ux eaa91b3 | no | 24.83 | false | 33.77 |
| 6 | 42493218404 | overhaul/stability-terminal-ux 8126454 | no | 20.69 | false | 19.79 |
| 7 | 42494299680 | staging/29 57c3db0 | no | 16.39 | false | 22.17 |
| 8 | 42495987510 | staging/15b a004477 | no | 21.29 | false | 24.33 |
| 9 | 42500996594 | staging/21 57ebbc8 | no | 21.22 | false | 27.79 |
| 10 | 42501852701 | overhaul/stability-terminal-ux 1b904a1 | no | 19.21 | false | 27.45 |
| 11 | 42502565823 | staging/20 1b4a706 | no | 17.4 | false | 18.56 |
| 12 | 42502646304 | staging/20 ce38cbc | no | 23.77 | false | 30.12 |
| 13 | 42502739091 | staging/20 ce16fdf | no | 17.5 | false | 28.09 |
| 14 | 42502835975 | staging/20 93667ae | no | 19.92 | false | 30.85 |
| 15 | 42502922415 | staging/20 c97d59e | no | 25.39 | false | 31.94 |
| 16 | 42503015768 | staging/20 8b88d97 | no | 23.17 | false | 33.58 |
| 17 | 42503101039 | staging/20 39dd963 | no | 23.34 | false | 37.05 |
| 18 | 42503197608 | staging/20 25697bd | no | 18.41 | false | 20.26 |
| 19 | 42503284096 | staging/20 1a78acb | no | 19.84 | false | 27.46 |
| 20 | 42503373851 | staging/20 17f1d36 | no | 22.2 | false | 31.4 |

- all 20: n 20, mean 21.13, sd 4.22, max 34.62, above 30: 1, above 35: 0
- with 30: n 1, mean 34.62 (one value)
- without 30: n 19, mean 20.42, sd 2.85, max 25.39
- Round 25 Q1 condition 4 triggers (>= 3 above 30, any above 35, mean above 23): none. The set is complete; 30's 10 staging runs are printed beside it as the "with 30" comparison (Round 29 Q1 condition 4).

## S5/short after the retention bound: withdrawn rule (Round 29)

Copied from ticket 74's branch (eab4ddf, METRICS lines 425-436). Round 29 Q1 withdrew the rule: MB/1k is %/1k rescaled by the mean (95.8-103.7 MB), so it is not a separate quantity; over tasks 900-1,199 M1 reads 3.79 / 16.79 / -15.03 and the tree 0.43 / -0.91 / 2.57; M1 removes only the in-run bound (3,600 files at reboot, 1,500 after restore), so reboot cost cannot see it.

**Mutant proof, local linux (Round 24 Q1 condition 5): FAILED; the ticket comes back under the Fallback (condition 8).** Tree 8c5a947 (ticket/30 2c6720c + ticket 74's rule; contains ticket 36), Linux x64, Node 26.7.0, Bun 1.4.2. `job.mjs --os linux --only S5/short --cap none` under `run-capped.sh` (3G, no swap), 6 runs started 20 s apart and run side by side (load average < 1; ~1.77 s per task, the CI pace). The mutant is ticket 30's M1 (the count bound removed in `retentionExceeded`, src and a rebuilt `dist/`), in a scratch worktree, never committed, restored from 8c5a947 (clean). Data: `/home/AgentKit/overhaul-tools/t74-memloop/<arm>-<i>/`. In all six runs the job printed a harness failure: the evidence gate of 8c5a947 required the post-bound window to reach task 1,200, while the last sample inside the load is at task 1,199 (fixed in d6a17a0; no measured value changes). Replayed through the fixed job against the committed list (no S5/short entry), all six are GREEN, the three mutants included.

| run | verdict | growth:mcp-bridge %/1k (trend) | slope MB/1k / mean MB | window medians MB (net rise, rising) | window tasks / samples | warm-up-growth:mcp-bridge %/1k (trend) | warm-up slope / mean, medians MB | procPeak MB | empty → 1,200 → reboot MB (cost) | failures / orphans | data dir | duration s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M1-1 | GREEN | 7.77 (false) | 7.96 / 102.4 | 98.5, 100.8, 102.7, 103.5, 102.2, 103.8 (5.4 %, 2) | 600–1,199 / samples 1059–2116, 1,058 of 2,125 | 38.11 (true) | 32.78 / 86; 80.7, 83.6, 85.8, 87.6, 88.5, 89.4 | 117.2 | 73 → 103 → 77 (4) | 0 / 0 | 3,600 files, 5.9 MB | 2,127 |
| M1-2 | GREEN | 17.01 (false) | 17.64 / 103.7 | 98.5, 101, 102.2, 104, 104.5, 106.1 (7.7 %, 2) | 600–1,199 / 1059–2116, 1,058 of 2,125 | 45.2 (true) | 38.72 / 85.7; 79.5, 82.7, 85.2, 87.2, 89.2, 88.8 | 120.9 | 73 → 104 → 77 (4) | 0 / 0 | 3,600 files, 5.9 MB | 2,127 |
| M1-3 | GREEN | 9.03 (false) | 9.33 / 103.4 | 99.9, 100.5, 103.6, 104.7, 103.4, 103.9 (4.0 %, 0) | 600–1,199 / 1059–2116, 1,058 of 2,125 | 40.9 (true) | 35.21 / 86.1; 80.3, 83.6, 85.8, 87.9, 89.3, 89.5 | 119.1 | 73 → 101 → 76 (3) | 0 / 0 | 3,600 files, 5.9 MB | 2,127 |
| tree-1 | GREEN | 2.85 (false) | 2.74 / 96.2 | 94.6, 96, 96.7, 96.3, 96, 96.4 (1.9 %, 0) | 600–1,199 / 1059–2114, 1,056 of 2,122 | 41.99 (true) | 36.09 / 86; 80.1, 83.2, 85.7, 87.5, 89.3, 89.5 | 99 | 73 → 97 → 75 (2) | 0 / 0 | 1,500 files, 2.5 MB | 2,125 |
| tree-2 | GREEN | **5.75** (false) | 5.56 / 96.6 | 94.7, 95.7, 96.5, 97.2, 97.7, 96.8 (2.2 %, 0) | 600–1,199 / 1059–2114, 1,056 of 2,122 | 43.37 (true) | 37.29 / 86; 80.1, 83.4, 85.5, 87.3, 89.1, 90 | 100.3 | 73 → 97 → 75 (2) | 0 / 0 | 1,500 files, 2.5 MB | 2,124 |
| tree-3 | GREEN | **5.62** (false) | 5.39 / 95.8 | 93.8, 95, 95.1, 96, 96.6, 96.6 (3.0 %, 0) | 600–1,199 / 1059–2113, 1,055 of 2,122 | 40.58 (true) | 34.65 / 85.4; 79.6, 82.6, 85.6, 87, 88.2, 88.9 | 99.5 | 73 → 97 → 75 (2) | 0 / 0 | 1,500 files, 2.5 MB | 2,125 |

- **Mutant:** 0 of 3 RED. Every value is over 5 (7.77, 17.01, 9.03), and the trend flag is false in all three (net rise 4.0–7.7 % against 10 %, trailing rising run ≤ 2 against 3). Round 24's Shared understanding 2 named this risk (the tip's one run had a 13.8 % net rise). The window sees the slope of an unbounded store (7.96–17.64 MB/1k against 2.74–5.56 on the tree, 3,600 against 1,500 stored files) but not its trend.

## Ticket 30: S5/short pre-registered sets (Round 29 Q1 condition 2, Round 30 Q1)

| set | tree | run | windows commit %/1k (trend) | windows WS %/1k | linux RSS %/1k (trend) |
|---|---|---|---|---|---|
| failed, pre-fix | b46596a | 42524937233 | 26.57 (true) | 20.83 | 42.1 (true) |
| failed, pre-fix | b46596a | 42525082650 | 31.22 (true) | 37.82 | 43.75 (true) |
| failed, pre-fix | b46596a | 42525149472 | 32.77 (true) | 36.96 | 43.25 (true) |
| failed, pre-fix | b46596a | 42525211005 | 26.01 (false) | 29 | 41.85 (true) |
| failed, pre-fix | b46596a | 42525275217 | 35.5 (true) | 22.38 | 41.33 (true) |
| failed, pre-fix | b46596a | 42525337005 | 20.75 (false) | 33.82 | 44.96 (true) |
| failed, pre-fix | b46596a | 42525400425 | 21.71 (false) | 19.73 | 41.02 (true) |
| failed, pre-fix | b46596a | 42525461331 | 27.82 (true) | 30.18 | 42.32 (true) |
| failed, pre-fix | b46596a | 42525529102 | 25.38 (false) | 9.92 | 42.05 (true) |
| failed, pre-fix | b46596a | 42525602188 | 25.56 (true) | 22.36 | 40.59 (true) |
| passed, fixed | e5b2c50 | 42542570923 | 17.1 (false) | 28.19 | 42.52 (true) |
| passed, fixed | e5b2c50 | 42542646289 | 16.67 (false) | 24.24 | 44.14 (true) |
| passed, fixed | e5b2c50 | 42542711246 | 26.04 (false) | 13.27 | 45.09 (true) |
| passed, fixed | e5b2c50 | 42542784560 | 18.17 (false) | 11.39 | 42.81 (true) |
| passed, fixed | e5b2c50 | 42542851697 | 21.16 (false) | 32.3 | 38.86 (true) |
| passed, fixed | e5b2c50 | 42542917206 | 23.53 (false) | 28.24 | 34.85 (true) |
| passed, fixed | e5b2c50 | 42542983151 | 19.72 (false) | 29.7 | 37.78 (true) |
| passed, fixed | e5b2c50 | 42543045085 | 20.43 (false) | 29.46 | 40.39 (true) |
| passed, fixed | e5b2c50 | 42543105037 | 26.59 (false) | 41.03 | 39.42 (true) |
| passed, fixed | e5b2c50 | 42543167527 | 20 (false) | 26.61 | 37.67 (true) |

- failed pre-fix set b46596a: windows mean 27.33 (3 above 30, one above 35); fixed set e5b2c50: windows mean 20.94 (all in (5, 30], trend false 10/10); Round 25 without-30 subset: n 19, mean 20.42, sd 2.85 (Welch t per Round 30: fixed vs without-30 0.41, fixed vs failed 3.48). Every other S5 check GREEN on all 40 legs.
- "with 30" subsets: pre-fix (42483637377 + b46596a, n 11), fixed (e5b2c50, n 10).

## Windows S4 'Ctrl-C during start' trial (Round 33)
Until ticket 81 merges, the windows S4/short value of `stale-lock-after-ctrl-c` is a TerminateProcess (crash) result, not a console event (Node maps `child.kill("SIGINT")` to TerminateProcess); it is owned by 81 and never judged as a pass. 81's merge restarts the windows S4/short matching count; 17's windows `flips` floor (proxy-left-after-stop, failed-lifecycle-steps, count:proxy) counts on 81's tree or later.

## Ticket 43: corrected Windows fixture and snapshot gates (2026-11-10)

Candidate branch commit `1f9e26c`, staged head `02bd817474978613d8449a499622041a0b5d9e57`, [CI42750466098](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42750466098): all eight required jobs completed SUCCESS. This is ticket-level pre-merge evidence, not final integration acceptance or independent review.

| Scope | Kit | Proxy | MCP | UX |
|---|---|---|---|---|
| Local full CI-like suite (`CI=true TERM=xterm-256color`) |1018pass/1038total,20skip|1651pass,1skip|115pass/116total,1skip|Native captured Windows baseline separately reviewed|
| Windows Node24 |988pass/1038total,50skip|1649pass/1652total,3skip|116pass/116total,0skip|Full Windows pipe/ci comparison1/1pass|
| Windows Node26 |988pass/1038total,50skip|1649pass/1652total,3skip|116pass/116total,0skip|Same separately executed Windows UXjob|

Both native Windows jobs executed the exact known-path normalizer test and old-verbose install.log superset comparison successfully. Typecheck/build stages passed. No extra acceptance inferred from platform skips.

Both archived memory job summaries are complete and ratchet-acceptable (`partial=false,ok=true,failures=[]`). S1 variants and S7 GREEN on both platforms; Linux S6 GREEN. Owned S2/S3/LinuxS5 and WindowsS4 remain RED, WindowsS5 remains unstable; do not report all budgets met. Windows S1/burst1 working-set median117.7MB (seven values113.9–121.3; budget250), commit median254.4MB; Linux median124.2MB (budget250). No memory budget, owner or metric changed by the setup test/snapshot corrections.

Artifacts: `/home/AgentKit/overhaul-tools/t43-ci42750466098-artifacts-yvHJAP/`; exact-head gate metadata `t43-ci42750466098-verified-gates.json`; native logs `t43-ci42750466098-windows{24,26}.log` and `windows-ux.log`. Ticket40 prerequisite and independent ticket43review still open; no integration merge.

## Ticket 40: repaired reader, exact-head platform gate (2026-11-10)

[CI42760280311](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42760280311) passed all eight required jobs for head `d2ae4d4327aa30e535d282d065c034ef397bb79f`. Actual CI merge `85b76ed3158844df4b5c99ae6396c25f67538184` has the exact staging tree `b9c7b7c4c58a517439d39a7acd077fcdbd6421c0`; product unchanged from independently approved deadcbc. This is pre-merge evidence, not final acceptance.

| Scope | Kit | Proxy | MCP | UX baseline equivalence |
|---|---|---|---|---|
| Ubuntu Node24 and Node26, each |1129pass/1149total,20skip|1651pass/1652total,1skip|115pass/116total,1skip|1/1pass, seven terminal modes|
| Windows Node24 and Node26, each |1098pass/1149total,51skip|1649pass/1652total,3skip|116pass/116total,0skip|1/1pass, pipe/ci|

Zero test failures; all eight named doctor/connection/log-reader security and preservation regressions executed on all four test legs, including cut-secret fragments, byte-zero/no-newline and opened-fd rotation. Typecheck and MCP build stages passed. Counts come from direct job-API logs: the gh combined log export was incomplete and one job export empty, neither used as count evidence.

Both memory summaries: partial=false, ok=true, failures=[]; Linux systemd and Windows JobObject caps reported. Linux REDs S2/short, S3/short,hung,omp and S5/short; Windows REDs S2/short, S3/short,hung,omp and S4/short; WindowsS5 remains unstable (26.1%/1k commit, registered bound30, trend=false). This does NOT satisfy all memory budgets. Windows burst1 WSmedian115.7MB, commitmedian255.5MB; Linux RSSmedian126.1MB. No policy, metric, owner or budget change.

Artifacts `/home/AgentKit/overhaul-tools/t40-ci42760280311-artifacts-OgQYak/`; metadata/inspection `t40-ci42760280311-{verified-gates,inspected-evidence}.json`; direct logs `t40-ci42760280311-{linux24,linux26,windows24,windows26,linux-ux,windows-ux}-api.log`. Fresh merger and merged-tree suites/sanity/dist gates remain OPEN. No integration merge or model workflow restart.
