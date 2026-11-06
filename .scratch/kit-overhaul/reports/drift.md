# Phase 1E: drift audit

Run 2026-11-06 by the logged substitute for glm-5.3-flash. Worktree: detached `/home/AgentKit/wt/drift` at `fb3b135` (`overhaul/stability-terminal-ux`); it was removed after the run. Installs followed METRICS.md: `npm ci` (root), `bun install --frozen-lockfile` (proxy, Bun 1.4.2), `npm ci` (mcp). Every command ran through `run-capped.sh` with 2G and 600/300 s caps. The logs are `reports/drift-*.log` (not committed). Nothing was fixed or edited.

Research inputs: `research/node-lts.md`, `bun.md`, `happy-dom.md`, `undici-yaml.md`, `mcp-sdk.md`, `harness-configs.md`, plus `typescript.md` and `github-actions.md`. The last two appeared while this audit was running and were added before it finished.

`harness-configs.md` cites line numbers at commit `10c51dc`. `git diff 10c51dc fb3b135 -- cli harnesses MANIFEST.md SUPPORT_MATRIX.json` is empty, so those line numbers still apply.

---

## Dependencies

### Root (`package.json`)

The kit has no dependencies. `npm outdated --json` returns `{}`. There is nothing to update.

### MCP bridge (`mcp/zcode-harness-mcp`): `npm outdated --json`

| Package | Declared (`package.json`) | Locked (package-lock + bun.lock) | Wanted | Latest | Research target |
|---|---|---|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.30.0` (:24) | 1.30.0 | 1.32.2 | 1.32.2 | `^1.32.2` (mcp-sdk.md §Answer 1). 2.x (`@modelcontextprotocol/server` 2.4.0) is the current line; 1.x fixes are guaranteed only until about 2027-01-27, so open a ticket for the migration. |
| `@types/node` (dev) | `^26.0.0` (:27) | 26.5.1 | 26.6.6 | 26.6.6 | **`^24.19.2`**: the types should match the `>=24` floor, not the 26 CI leg (typescript.md §Answer 3). This is a downgrade of the range on purpose. |
| `typescript` (dev) | `^5.9.0` (:28) | 5.9.3 | 5.9.3 | **7.0.2** | `"7.0.2"` exact, with `6.0.3` as the fallback (typescript.md §Answer 3). tsconfig needs no edit. TS 7 adds 20 per-platform optional packages, so regenerate both lockfiles. Rebuild and diff `dist/`; byte-identical output is UNVERIFIED. |
| `zod` (transitive, not declared) | — | 4.6.2 | — | — | mcp-sdk.md: declare `zod` explicitly. **Correction to that note:** use `^4.6.6`, not `^4.2.0`, because GHSA-mrhx-c7xc-m3w5 affects `<4.6.6` (see Advisories). |

The bridge has **two lockfiles**: `package-lock.json` and `bun.lock` (lockfileVersion 2). Both resolve the same versions. CI installs with `bun install --frozen-lockfile` (`.github/workflows/ci.yml:34`), while METRICS.md uses `npm ci`. Any bump has to regenerate both.

### Proxy (`zcode-proxy-src`): `bun outdated` (Bun 1.4.2)

| Package | Declared | Locked (`bun.lock`) | Update (in range) | Latest | Research target |
|---|---|---|---|---|---|
| `happy-dom` | `^20.11.6` (:16) | 20.11.6 (:32) | 20.14.6 | 21.0.4 | `^21.0.4`. Also add `enableCSSFileLoading: true, enableIframePageLoading: true` (captcha-happy.ts:1804-1814) to keep the 20.x behaviour (happy-dom.md §Answer 3-4). An in-range update is not enough: GHSA-c8p4 affects ≤20.14.6. |
| `undici` | `^8.10.0` (:17) | 8.10.0 (:34) | 8.12.4 | 8.12.4 | `^8.12.4` (undici-yaml.md §Answer 1). Under Bun the npm package is aliased to Bun's shim; it is only really used on the Node/Android path. |
| `yaml` | `^2.5.0` (:18) | 2.9.0 (:42) | 2.9.1 | 2.9.1 | Raise the floor to `^2.9.1`; `^2.5.0` still admits CVE-2026-33532 (<2.8.3) (undici-yaml.md §Answer 5). |
| `@types/bun` (dev) | `"latest"` (:21) | 1.3.14 (:18; bun-types :28) | 1.4.4 | 1.4.4 | Pin `1.4.4` exact to match the runtime (bun.md §Answer 2, typescript.md §Answer 4). It is needed for `Bun.unsafe.memoryFootprint()` types. |
| `typescript` (not declared) | — | — | — | 7.0.2 | `bun x tsc` downloads `typescript@latest` at run time, so the version floats. Add `"typescript": "7.0.2"` (typescript.md §Answer 4). |

---

## Advisories

Counts only. No fixes were applied.

| Scope | Tool | Result |
|---|---|---|
| root | `npm audit --json` | 0 vulnerabilities (the root has no dependencies) |
| mcp | `npm audit --json` | **9 packages: 1 critical, 3 high, 5 moderate.** npm counts per package. `fixAvailable: true` for all of them. |
| mcp | `bun audit` (bun.lock) | Same 9 packages. Counted per advisory: 20 (1 critical, 6 high, 11 moderate, 2 low). |
| proxy | `bun audit` | **22 advisories: 9 high, 10 moderate, 3 low.** happy-dom has 3 and undici has 19. Both are direct dependencies. |

### MCP bridge

| Package (locked) | Direct? | Severity | Advisories (fixed in) |
|---|---|---|---|
| `@modelcontextprotocol/sdk` 1.30.0 | yes | high | GHSA-6qxp-vccf-f47h OAuth creds to MCP-chosen auth server (1.31.0) · GHSA-22jm-h49p-29qw tasks not session-bound (1.32.0) · GHSA-46jr-4wx8-v453 memory exhaustion during validation (1.32.0) · GHSA-f897-62hf-6gxq no body-size / batch-length limit (1.30.1) · moderate GHSA-rvq5-wwqv-78pq bearer token audience (1.32.0) · moderate GHSA-6prh-2h8m-c8cw cross-origin redirects re-send headers (1.32.0) |
| `proxy-addr` 2.0.7 | no (express) | **critical** | GHSA-jqcg-44mw-7w3h IP spoofing via IPv4-mapped IPv6 trust subnet (2.0.8) |
| `body-parser` 2.3.0 | no | high | GHSA-27r3-jxmh-p828 DoS via trailing bytes after compressed body (2.4.0) |
| `zod` 4.6.2 | no (SDK peer) | high | GHSA-mrhx-c7xc-m3w5 memory exhaustion on oversized constrained collections (4.6.6) |
| `@hono/node-server` 2.1.1 | no | moderate | GHSA-rmxm-3fg6-px4f `serveStatic` double decode (2.1.3) |
| `hono` 4.13.7 | no | moderate | GHSA-5r4p-p66f-jhc7 `serveStatic` double decode (4.13.11) |
| `fast-uri` 3.1.7 | no (ajv) | moderate | GHSA-hrr3-gc8f-f4qj, GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr; low GHSA-xhq7-xmqj-769h, GHSA-333x-w4r6-6crp (3.1.9) |
| `ip-address` 10.7.0 | no | moderate | GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw (>10.7.0), GHSA-rxp7-6hxx-x8q5 (>10.7.3) |
| `qs` 6.16.0 | no | moderate | GHSA-6pq8-jhm2-2vcw `stringify` arrayFormat comma DoS (>6.16.0) |

How exposed is the bridge? It serves stateless POST-only HTTP plus stdio (mcp-sdk.md §Answer 4). The bridge does not use `serveStatic`, the OAuth client or `trust proxy`, which lowers its real exposure to the hono, OAuth and proxy-addr advisories. The body-size, batch, zod and validation-memory advisories do apply to its HTTP mode. A lockfile refresh with the SDK bump to 1.32.2 should clear all 9; this has not been checked by a re-run.

### Proxy

- **happy-dom 20.11.6:**
  - high GHSA-834v-8h66-3h79: import-alias host code execution, affects ≥17.0.0 ≤21.0.3, **fixed only in 21.0.4**.
  - high GHSA-c8p4-j97h-3vg8: SSRF via iframe/stylesheet, affects ≤20.14.6, fixed in 21.x.
  - moderate GHSA-5fpq-26gf-qwcr: cookie scope forgery, affects ≤20.14.5.
- **undici 8.10.0** (19 advisories):
  - 11 are fixed in 8.10.2:
    - high: GHSA-rfgv-xxqx-mfg5 (WebSocket subprotocol DoS), GHSA-w293-vg96-wgc3 (BalancedPool TLS validation bypass), GHSA-vp8m-p9jh-q5pm (cross-origin cache poisoning).
    - moderate: GHSA-3wwx-pv8p-q78v, GHSA-pmjh-fq2x-6v4x, GHSA-3xpg-4rpp-hhhm, GHSA-2jfj-6hjv-fm6j, GHSA-rx4f-c7p8-82vq.
    - low: GHSA-r53p-7pc4-xj5r, GHSA-2gqq-gqf2-x968, GHSA-8436-99hf-9mmv.
  - 8 are fixed in 8.12.2:
    - high: GHSA-xjj6-f33q-929c (content-encodings DoS), GHSA-4w7w-5xrc-9h26 (cross-origin redirect cache poisoning), GHSA-2m5v-pch6-74hx (Agent TLS options dropped), GHSA-qrxm-fqhp-jwvm (TLS 1.2 renegotiation DoS).
    - moderate: GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-9fm3-97px-rjf6, GHSA-55wc-3pg8-jfw6.
  - undici-yaml.md says 8.12.4 fixes 6 more in the cache, redirect and SRI code. Bun's advisory DB did not list those yet.
- **Exposure caveat (undici-yaml.md §Answer 2):** under Bun, `undici` is aliased to Bun's built-in shim, so the npm undici code does not run on the desktop build. The advisories apply to the Node/Android path (`runtime/node-fetch-compat.ts:36`). happy-dom does run in the captcha worker, so its advisories apply directly.

---

## Runtime pins

Targets:
- **Node:** floor `>=24`, CI on 24 and 26 (node-lts.md §Answer 2).
- **Bun:** 1.4.4 everywhere (bun.md §Answer 2).

The Bun 1.4.4 SHA256 values below come from the upstream `SHASUMS256.txt` (https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/SHASUMS256.txt, fetched 2026-11-06; release published 2026-10-22T10:11:32Z per the GitHub API `releases/latest`). The currently pinned 1.4.2 hashes were checked against `bun-v1.4.2/SHASUMS256.txt` and **all 5 match** (linux-x64, linux-aarch64, darwin-x64, darwin-aarch64, windows-x64).

Translations column: "n/a" means the file has no translated copy. Otherwise it lists the translated copies that carry the same statement, with their line numbers.

### Node engines and installer gates

| file:line | statement | current | target | translations affected |
|---|---|---|---|---|
| `package.json:13` | `"engines": { "node": ">=20" }` | >=20 | >=24 | n/a |
| `pack/build.mjs:136` | packed manifest `engines: { node: ">=20" }` | >=20 | >=24 | n/a |
| `mcp/zcode-harness-mcp/package.json:11` | `"node": ">=20"` | >=20 | >=24 | n/a |
| `install.sh:115` | `die "node >= 20 required (https://nodejs.org)"` | 20 | 24 | n/a |
| `install.sh:117` | `[ "$NODE_MAJOR" -ge 20 ] \|\| die "node >= 20 required, found …"` | 20 | 24 | n/a |
| `install.ps1:25` | comment `Requires node >= 20 and bun` | 20 | 24 | n/a |
| `install.ps1:88` | `Test-Node`: `[int]$Matches[1] -ge 20` | 20 | 24 | n/a |
| `install.ps1:95` | `Write-Error "node >= 20 is required …"` | 20 | 24 | n/a |

### Node in CI

| file:line | statement | current | target | translations affected |
|---|---|---|---|---|
| `.github/workflows/ci.yml:24` | `setup-node` `node-version: 20` (matrix ubuntu/windows, :19) | 20 (EOL 2026-04-30) | matrix `[24, 26]` × `[ubuntu, windows]` | n/a |
| `.github/workflows/release.yml:47` | test-matrix `node-version: 20` | 20 | `[24, 26]` | n/a |
| `.github/workflows/release.yml:78` | comment "test matrix … stays on Node 20 (the documented engines floor)" | 20 | update with the floor | n/a |
| `.github/workflows/release.yml:81` | publish job `node-version: 24` | 24 | 24 (already on target) | n/a |
| `.github/workflows/release.yml:10` | comment "Node 20 ships npm 10" | 20 | reword (Node 24 ships npm 11.3, per :83) | n/a |
| `.github/workflows/release.yml:84,87` | `npm install -g npm@11.19.1`; comment "npm@12 would need >= 22.22 / 24.15 / 26" | npm 11.19.1 | Keep. npm 12.2.2 exists (npm notice in the drift logs), but moving to it was not researched. | n/a |
| `.github/workflows/release.yml:233` | post-release job `node-version: 20` | 20 | 24 (or 26) | n/a |
| `zcode-proxy-src/.github/workflows/*` | — | no Node pin (Bun only) | — | n/a |

### Bun in CI

| file:line | statement | current | target | translations affected |
|---|---|---|---|---|
| `.github/workflows/ci.yml:26,30` | comment "Pinned to … (1.4.2)"; `bun-version: 1.4.2` | 1.4.2 | 1.4.4 | n/a |
| `.github/workflows/release.yml:49,53` | same comment; `bun-version: 1.4.2` | 1.4.2 | 1.4.4 | n/a |
| `zcode-proxy-src/.github/workflows/ci.yml:31-35` | `bun-version: "1.4.0"` (comment cites v4.5.2 / 1.3.14 drift, AGENTS.md #37) | **1.4.0** | 1.4.4, or delete the file (see the note below) | n/a |
| `zcode-proxy-src/.github/workflows/release.yml:51-54` | verify job `bun-version: "1.4.0"` ("keep all 3 jobs + ci.yml in sync") | **1.4.0** | same | n/a |
| `zcode-proxy-src/.github/workflows/release.yml:132` | compile matrix `bun-version: "1.4.0"` (upstream binary build) | **1.4.0** | same | n/a |

Note on the nested workflows (github-actions.md §Answer 5): GitHub reads workflows only from the repo-root `.github/workflows`, and they also trigger on `master` while this repo's default branch is `main`. So **these three 1.4.0 pins never run in this repo**. They are stale vendored upstream files. The kit itself does not ship these binaries: the manager runs `bun run src/index.ts` with the user's Bun (bun.md §1). The fix is to delete the files or move the proxy typecheck/test steps into the root CI. Bumping them alone changes nothing.

### Bun bootstrap in the installers

| file:line | statement | current | target | translations affected |
|---|---|---|---|---|
| `install.sh:131` | `Installing Bun v1.4.2 for your user...` | 1.4.2 | 1.4.4 | n/a |
| `install.sh:133` | comment `SHA256 of the bun-v1.4.2 release artifacts` | 1.4.2 | 1.4.4 | n/a |
| `install.sh:136` | `BUN_LINUX_X64_SHA256` | `36368fae…d422a913` | `bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c` | n/a |
| `install.sh:137` | `BUN_LINUX_AARCH64_SHA256` | `54328bbc…c8fda7` | `baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e` | n/a |
| `install.sh:138` | `BUN_DARWIN_X64_SHA256` | `80520d7e…affb012` | `50a3491f73abc2fe81673171a85762d3bc2cc1680ccecadd983de99adf77977e` | n/a |
| `install.sh:139` | `BUN_DARWIN_AARCH64_SHA256` | `90987a3a…be1d12f` | `c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510` | n/a |
| `install.sh:147` | `BUN_URL=…/download/bun-v1.4.2/$BUN_ASSET` | bun-v1.4.2 | bun-v1.4.4 | n/a |
| `install.ps1:98` | `Downloading Bun v1.4.2 (bun-windows-x64.zip)` | 1.4.2 | 1.4.4 | n/a |
| `install.ps1:100-101` | `$bunSha` (windows-x64) | `ce4c1749…e49b6405` | `cd2c0fccc78f3ede1f50ca827a15f063eda13d4d150a3d0674f4f6e323d864a5` | n/a |
| `install.ps1:102` | URL `…/bun-v1.4.2/bun-windows-x64.zip` | bun-v1.4.2 | bun-v1.4.4 | n/a |
| `install.ps1:98-108` | only `bun-windows-x64` is bootstrapped | x64 only | Optional: 1.4.4 `bun-windows-aarch64.zip` = `2d57a0eec0cb44d95c918c3f9734f60455a1306ae5085d76fc68f44e3ee30d09`. This is a scope choice, not drift. | n/a |
| `install.sh:130`, `install.ps1:90-92,97` | A Bun that is already installed is accepted **at any version** (`command -v bun` / `bun --version` exit 0). | no minimum | Gap: ci.yml:27 notes that older Bun (1.2.20) rejects the MCP lockfileVersion 2. Consider a minimum-version check. | n/a |

### "Node.js 20" / "tested with Bun x.y" wording in docs

| file:line | statement | current | target | translations affected |
|---|---|---|---|---|
| `README.md:19` | "Node.js 20 or newer" | 20 | 24 | de:19, es:19, ja:19, zh-CN:19 (all carry the same statement) |
| `README.md:56` | "Requires Node.js 20+ and Bun … (tested with Bun 1.4.2)" | 20 / 1.4.2 | 24 / 1.4.4 (only after the suite passes on 1.4.4) | de:56 "getestet mit Bun 1.4.2", es:56 "probado con Bun 1.4.2", ja:56 "Bun 1.4.2 で検証", zh-CN:56 "已用 Bun 1.4.2 测试" (all carry it) |
| `mcp/zcode-harness-mcp/README.md:10` | "Node.js 20 or newer" | 20 | 24 | de:11; es:30 "Node.js ≥ 20"; ja:27 "Node.js ≥ 20"; zh-CN:25 "Node.js ≥ 20". The es/ja/zh-CN requirements sections are structured differently from EN/DE (extra Windows line and `--runtime-path` note), so these translations are already out of sync. |
| `mcp/zcode-harness-mcp/docs/KNOWN_LIMITATIONS.md:96` | "Getestete MCP-Clients: offizieller SDK-Client (Node 26)" | Node 26 | OK (still Active LTS) | n/a (German only) |
| `harnesses/README*.md` | no runtime version statement (`:66` says only "Setup pins native Node/Bun") | — | — | — |
| `SECURITY.md`, `SECURITY.de.md` | no runtime version statement | — | — | — |
| `EFFORT_MAPPING.md` / `.de.md` / `.json` | no runtime version or date fields (effort lists only) | — | — | — |

### SUPPORT_MATRIX and MANIFEST

| file:line | statement | current | target | translations affected |
|---|---|---|---|---|
| `SUPPORT_MATRIX.json:3` | `"generated": "2026-09-23"` | 2026-09-23 | Re-stamp when the matrix is re-verified. It is 44 days old. | n/a |
| `SUPPORT_MATRIX.json:4` | `"testPlatform": "Windows 11 Pro (10.0.26200), Node 26.7.0, Bun 1.4.2; kit v0.2.33 source"` | Node 26.7.0, Bun 1.4.2, kit v0.2.33 | Node 26.x (26.13.0 is the latest LTS), Bun 1.4.4. The kit is now 0.2.42 (`package.json:3`). | n/a |
| `SUPPORT_MATRIX.json:6-8` | `nativeMcpVerification.date "2026-09-23"`, `runtimeVersion "0.16.9"` | 2026-09-23 | Re-verify (ZCode Desktop, out of research scope) | n/a |
| `SUPPORT_MATRIX.json:32,47,62,78,94,141` | `sourceChecked: "2026-09-23"` (omp, pi, claude-code, codex, opencode, aider) | 2026-09-23 | 2026-11-06 once the adapter drift is resolved | n/a |
| `SUPPORT_MATRIX.json:109,125,156,171` | `sourceChecked: "2026-09-13"` (cline, kilo-code, continue, goose) | 2026-09-13 | same | n/a |
| `MANIFEST.md:25` | proxy base v4.6.4; "At this snapshot (2026-09-22), upstream's latest … v4.6.9" | 2026-09-22 | Upstream was not re-checked here | de:27 (same) |
| `MANIFEST.md:27-29` | Recorded harness versions (see the last section) | — | — | de:29-31 (same values) |

### Installer tests that assert or fake versions

| file:line | statement | current | target | translations affected |
|---|---|---|---|---|
| `tests/installer-audit.test.mjs:113` | `const bunSha = "90987a3a…be1d12f"`. This is the **real** 1.4.2 darwin-aarch64 hash, and the bootstrap test depends on it. | 1.4.2 hash | `c240d7f0…577bc510` (it must change in the same commit as `install.sh:139`) | n/a |
| `tests/installer-audit.test.mjs:148,211,262,281,376,394` | fake `bun --version` prints `1.4.2` (not asserted) | 1.4.2 | 1.4.4 (cosmetic) | n/a |
| `tests/installer-audit.test.mjs:67,93,118,208,276,375,388` | fake `node --version` prints `v20.19.0` | v20.19.0 | **This breaks under a `>=24` gate.** Change it to v24.x/v26.x, and add a test that v22 is rejected. | n/a |
| `tests/installer.test.mjs:38` | fake node `v20.19.0` | v20.19.0 | same as above | n/a |
| `tests/installer.test.mjs:88-96` | asserts 4 assets and ≥4 64-hex `BUN_*_SHA256` values, not a version | — | still passes after the bump | n/a |

### GitHub Actions and other toolchain pins (github-actions.md, typescript.md)

| file:line | statement | current | target | translations affected |
|---|---|---|---|---|
| `.github/workflows/ci.yml:21`; `release.yml:44,75,227` | `actions/checkout@v4` (declares `node20`) | v4 | `@v7` (v7.0.1, 2026-07-20). v5–v7 breaking changes do not affect these workflows. | n/a |
| `.github/workflows/ci.yml:22`; `release.yml:45,79,231` | `actions/setup-node@v4` (declares `node20`) | v4 | `@v7` (v7.1.0, 2026-10-08). Dropping the dummy `NODE_AUTH_TOKEN` does not affect OIDC publishing. | n/a |
| `.github/workflows/ci.yml:28`; `release.yml:51` | `oven-sh/setup-bun@v2` | v2 (= v2.2.0, node24) | unchanged | n/a |
| runner images | `ubuntu-latest`, `windows-latest` | — | Keep. `ubuntu-latest` is moving from 24.04 to 26.04 between 2026-10-19 and 2026-11-19; `windows-latest` is Server 2025. | n/a |
| `mcp/zcode-harness-mcp/tsconfig.json:3-6` | `target`/`lib` `ES2023`, `module`/`moduleResolution` `Node16` | — | No edit needed for TS 6/7 (typescript.md §Answer 2) | n/a |

Since 2026-09-23 GitHub runners no longer have Node 20 for actions (github-actions.md §Answer 2). The v4 actions run only because the runner forces them onto Node 24.

---

## Adapter drift

Summarised from `research/harness-configs.md` (verified 2026-11-06). Severity applies only to DRIFT rows. OK rows are left out unless they matter for context.

| Harness | file:line | Field the kit writes / states | Harness now | Verdict | Severity |
|---|---|---|---|---|---|
| Continue | `cli/adapters/continue.mjs:23,32,46-47` | `capabilities: { toolUse: true[, imageInput: true] }` (map) | schema requires a string array `[tool_use, image_input]`; a map fails zod validation | DRIFT | **High** |
| Kilo Code | `cli/adapters/kilo-code.mjs:28,33-34` | Anthropic Messages Base URL `http://127.0.0.1:PORT`, "no /v1 suffix" | `@ai-sdk/anthropic` treats baseURL as the `/v1` prefix, so requests go to `/messages`; the proxy only routes `/v1/messages` (`server.ts:159`). Not run end to end. | DRIFT | **High** |
| Claude Code | `cli/adapters/claude-code.mjs:20-32` | no `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` / `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES` | `glm-*` IDs get no effort or thinking unless declared; conflicts with `harnesses/README.md:100-103` | DRIFT | Medium |
| Claude Code | `claude-code.mjs:25` | `ANTHROPIC_SMALL_FAST_MODEL` | [DEPRECATED]; replaced by `ANTHROPIC_DEFAULT_HAIKU_MODEL` | DRIFT | Low |
| Claude Code | `cli/zcode-kit.mjs:529` | `claude mcp add … --scope user` | not re-checked | UNVERIFIED | – |
| Codex | `cli/adapters/codex.mjs:21-35` | no `model_context_window` / `model_reasoning_effort` | keys exist; fallback for an unknown model not confirmed | UNVERIFIED | – |
| Codex | `codex.mjs:23-34` | `wire_api="responses"`, `[windows] sandbox="unelevated"`, `mcp_servers` | current | OK | – |
| OpenCode | `cli/adapters/opencode.mjs:19-26,87` | V1 `provider.zcode` with `npm`/`options` | 2.x uses `providers`/`package`/`settings`; V1 is accepted and migrated | DRIFT (legacy, still works) | Low |
| OpenCode | `opencode.mjs:29-37` | no `modalities.input: [text, image]` for Flash | images are not enabled | DRIFT | Medium |
| OpenCode | `opencode.mjs:2-3` | comment "%APPDATA%/opencode on Windows" | Windows also uses `~/.config/opencode` | DRIFT (comment) | Low |
| OpenCode | — | user file already on V2 `providers` and the kit adds V1 `provider` | mixed-shape merge not documented | UNVERIFIED | – |
| Aider | `cli/adapters/aider.mjs` | no `.aider.model.settings.yml` (`accepts_settings: [reasoning_effort]`) or metadata | `--reasoning-effort` is ignored with a warning | DRIFT (gap) | Low |
| Goose | `cli/adapters/goose.mjs:38` | no `supports_vision: true` on Flash | honoured since v1.55.0; when unset, images are stripped | DRIFT | Medium |
| Goose | `goose.mjs:37-38` | no per-model `reasoning: true` | drives the thinking-effort picker | DRIFT | Low |
| Cline | `cli/adapters/cline.mjs:5-7,16` | rationale "CLI config interface is not documented" | `cline auth -p openai -k -b -m`, `~/.cline/data/settings/providers.json` are documented | DRIFT (stale rationale; integration path missed) | Medium |
| Cline | `cline.mjs` values sheet | no reasoning-effort value | CLI `--thinking none…xhigh`; extension field not confirmed | UNVERIFIED | – |
| Kilo Code | `kilo-code.mjs:23-30` | no Reasoning / Images flags | per-model `reasoning`, `modalities`, `variants` exist | DRIFT | Medium |
| Kilo Code | `kilo-code.mjs:35` | "Models can also be auto-fetched from /v1/models" | fetching is disabled for `@ai-sdk/anthropic` | DRIFT | Low |
| Kilo Code | `kilo-code.mjs:4-5,36-37` | "kilo.jsonc … documented only sparsely" | documented (`~/.config/kilo/kilo.jsonc`) | DRIFT (stale rationale) | Low |
| OMP | `cli/adapters/omp.mjs:147-151` | `auth` omitted on custom `anthropic-messages` provider | omitting `auth` selects OAuth-style shaping; `auth: apiKey` gives plain shaping | DRIFT | Medium |
| OMP | `omp.mjs:163,166,177,180` | `compat.supportsOutputEffort`, `injectClaudeCodeInstruction` | not in the models.yml compat schema, so likely ignored | DRIFT | Medium |
| OMP | `omp.mjs:218-220` | default-profile paths only | named profiles and `PI_CODING_AGENT_DIR` not honoured | DRIFT | Low |
| OMP | `omp.mjs:339-341,346` | comment "omp 18+ no longer evaluates `!node`" | `!command` apiKeys are supported again (18.16) | DRIFT (comment) | Low |
| pi | `cli/adapters/pi.mjs:25-44` (header claim :7-9) | no `thinkingLevelMap` | unmapped levels go up to `high`; `xhigh`/`max` unavailable | DRIFT | Medium |
| pi | `pi.mjs:55-60` | `~/.pi/agent` only | `PI_CODING_AGENT_DIR` not honoured | DRIFT | Low |
| pi | `pi.mjs:52`, `SUPPORT_MATRIX.json` pi `primarySource`, `harnesses/README.md:52` | `badlogic/pi-mono … docs/models.md` | repo is now `earendil-works/pi`, docs `models-configuration.md` | DRIFT | Low |
| all adapters | `primarySource` in every `cli/adapters/*.mjs` (e.g. `claude-code.mjs:14`, `codex.mjs:13`, `omp.mjs:215`) | "(checked 2026-09-13)" | stale by 54 days; re-stamp after fixes | DRIFT | Low |
| MCP coverage | `harnesses/README.md:61` | bridge registered for OMP, Claude Code and Codex only | pi, Kilo, OpenCode, Continue, Goose and Cline CLI now have file-based MCP config | scope choice, not drift | – |

The harness-configs note has no Bun/Node-specific adapter drift. One related risk is in node-lts.md: the OMP autostart pins an absolute `node` path (`cli/adapters/omp.mjs:266-272`). After a Node major upgrade through a version manager, that path can point at an old or deleted runtime.

---

## Recorded external versions

| Thing | Where recorded | Recorded value | Latest (source, date) | Gap |
|---|---|---|---|---|
| Node.js | engines / CI (above) | floor 20, CI 20 | Active LTS 26 (26.13.0); 24 and 22 in Maintenance; 20 EOL 2026-04-30 (node-lts.md) | floor and CI on an EOL runtime |
| Node (test evidence) | `SUPPORT_MATRIX.json:4` | 26.7.0 | 26.13.0 (node-lts.md) | minor |
| Bun (kit CI / installers) | ci.yml:30, release.yml:53, install.sh:131, install.ps1:98 | 1.4.2 (2026-09-05) | 1.4.4 (2026-10-22; bun.md, GitHub API) | 2 patch releases |
| Bun (proxy CI / shipped binaries) | `zcode-proxy-src/.github/workflows/ci.yml:35`, `release.yml:54,132` | **1.4.0** | 1.4.4 | 4 patch releases; differs from the kit's own 1.4.2 pin |
| `@types/bun` | `zcode-proxy-src/bun.lock:18` | 1.3.14 | 1.4.4 | behind the runtime |
| npm (publish) | `.github/workflows/release.yml:87` | 11.19.1 | 12.2.2 (npm notice in the drift logs, 2026-11-06) | not researched |
| Claude Code | `MANIFEST.md:28` / de:30 | 2.1.269 | 2.1.318 (2026-11-04) | — |
| Claude Code | `SUPPORT_MATRIX.json:60` `versionTested` | 2.1.278 | 2.1.318 | **MANIFEST and SUPPORT_MATRIX disagree** |
| Codex CLI | `MANIFEST.md:29` / de:31, `codex.mjs:13` | 0.153.4 | 0.166.0 stable (2026-10-29) | — |
| Codex CLI | `SUPPORT_MATRIX.json:76` | 0.155.1 | 0.166.0 | MANIFEST and SUPPORT_MATRIX disagree |
| OMP | `MANIFEST.md:27` / de:29 | 18.1.18 (Canary) | v18.16.0 (2026-11-02) | — |
| OMP | `SUPPORT_MATRIX.json:30` | 18.2.9 | v18.16.0 | MANIFEST and SUPPORT_MATRIX disagree |
| pi | `SUPPORT_MATRIX.json:45` | 0.85.0 | v1.5.0 (`earendil-works/pi`, 2026-11-02); old `@mariozechner/pi-coding-agent` stopped at 0.73.1 | package and repo renamed |
| OpenCode | `SUPPORT_MATRIX.json:92` | 1.18.29 | v2.2.5 (2026-10-30); V1 line 1.19.5 (2026-10-28) | major line change |
| Aider | `SUPPORT_MATRIX.json:139` | 0.86.2 | 0.86.2 (PyPI, 2026-02-12) | current |
| Cline | `SUPPORT_MATRIX.json:107` | null | ext 4.1.26 / CLI 3.0.74 (2026-10-26) | never recorded |
| Kilo Code | `SUPPORT_MATRIX.json:123` | null | 7.8.27 (2026-11-05) | never recorded |
| Continue | `SUPPORT_MATRIX.json:154` | null | v2.0.0-vscode / CLI 1.5.47 (2026-06-19) | never recorded |
| Goose | `SUPPORT_MATRIX.json:169` | null | v1.57.0 (`aaif-goose/goose`, 2026-10-28) | never recorded; repo moved from `block/goose` |
| zcode-proxy upstream | `MANIFEST.md:25` / de:27 | base v4.6.4; upstream latest v4.6.9 as of 2026-09-22 | not re-checked | — |
| ZCode Desktop runtime | `SUPPORT_MATRIX.json:8` | 0.16.9 (2026-09-23) | not researched | — |
| `@modelcontextprotocol/sdk` | `mcp/zcode-harness-mcp/package.json:24` | ^1.30.0 → 1.30.0 | 1.32.2 (1.x, 2026-10-23); 2.x `@modelcontextprotocol/server` 2.4.0 | 6 advisories |
| happy-dom | `zcode-proxy-src/package.json:16` | ^20.11.6 → 20.11.6 | 21.0.4 (2026-10-20) | 3 advisories; 1 needs 21.0.4 |
| undici | `zcode-proxy-src/package.json:17` | ^8.10.0 → 8.10.0 | 8.12.4 (2026-11-05) | 19 advisories |
| yaml | `zcode-proxy-src/package.json:18` | ^2.5.0 → 2.9.0 | 2.9.1 (2026-09-11) | the floor admits a CVE |
| TypeScript | `mcp/zcode-harness-mcp/package.json:28` | ^5.9.0 → 5.9.3 | 7.0.2 (2026-07-08, native Go port, no JS API); 6.0.3 is the last JS line (typescript.md) | 2 majors behind; the proxy floats via `bun x tsc` |
| `@types/node` | `mcp/zcode-harness-mcp/package.json:27` | ^26.0.0 → 26.5.1 | target `^24.19.2` (matches the floor) | range above the floor |
| actions/checkout, actions/setup-node | root workflows | v4 / v4 | v7 / v7 (github-actions.md) | 3 majors behind each |

Sources (beyond the research notes above): `npm outdated`/`npm audit`/`bun outdated`/`bun audit` output in `reports/drift-*.log` (2026-11-06); Bun SHASUMS: https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/SHASUMS256.txt and https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/SHASUMS256.txt (fetched 2026-11-06); GitHub API https://api.github.com/repos/oven-sh/bun/releases/latest (fetched 2026-11-06).
