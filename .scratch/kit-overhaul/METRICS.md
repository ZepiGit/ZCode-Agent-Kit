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
| S1 burst: N × 10.8 MB bodies at once | HWM 219 / 425 / 998 / 1,619 MB at N = 1 / 4 / 16 / 32; heap ≤ 898 MB; ~4.5 MB RSS per MB in flight | RED (N ≥ 4) |
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

## Current

(pending)
