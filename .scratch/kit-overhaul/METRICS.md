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
- `tests/update.test.mjs` and `tests/upstream-config.test.mjs` exist but are not wired into `npm run test`, so CI never runs them.
- CI runs Node 20 (EOL) while the local baseline ran Node 26: a Node-version coverage gap.

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

## Current

(pending)
