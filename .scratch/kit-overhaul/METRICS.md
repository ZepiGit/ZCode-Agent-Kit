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
| S1 burst: N concurrent 10.8 MB bodies, 3 × N requests (burst1: 3 sequential requests) | HWM 219 / 425 / 998 / 1,619 MB at N = 1 / 4 / 16 / 32; heap ≤ 898 MB; ~4.5 MB RSS per MB in flight | RED (N ≥ 4) |
| S1 stalled readers, 3,000 | HWM 165 MB, heap 6 MB after idle | GREEN |
| S2 captcha solver, heavy happy-dom solves (short 420 / long 2,000) | RSS 179 → 958 MB at the 200-solve recycle (+4.1 MB/solve); heap after GC +2.5 MB/solve; per-generation peak 0.9–1.0 GB; HWM 1,068 MB | RED |
| S2 retained guest heap before recycle | 686 MB (long 619 MB); 687 MB returned on recycle | RED |
| S2 hung solves (5 × 256 MB parked) | reclaimed (−5 MB) | ok |
| S2 CDN memory map | +151 MB / 600 URLs, +502 MB / 2,000 URLs (256 KB each) | RED |
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
| S6/short | +2 / +0 / +125 MB | +2 / +0 / +125 MB; resize frame 0.234 ms (recorded, not gated) | ≤ 16 / ≤ 8 / ≤ 16 MB | RED → 32 |
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

Linux reference check on the ticket 02 branch (Bun 1.4.2, 2026-11-06, `/home/AgentKit/overhaul-tools/t02-memloop/linux-job/`): numbers in line with the ticket 01 run (S3/short kit 849 MB, launcher 78.2, bridge 85.9 MB; S2 cost per generation 1,050 MB, retained 685 MB, CDN +149 MB). S1/burst1 is flaky at its 250 MB HWM budget on the integration tip too: HWM 256.7 MB in the job, reruns 237.7 / 236.7 / 264.6 MB on the branch and 236.6 / 299.2 / 237.5 MB on the tip (3f4e41a).

## Current

(pending)
