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

(pending Phase 1B memory loop)

## Current

(pending)
