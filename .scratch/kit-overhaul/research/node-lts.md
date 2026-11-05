# Node.js `engines` floor for ZCode-Agent-Kit (research, 2026-11-05)

## Answer

1. On 2026-11-05 Node 20 has been end-of-life for six months (EOL 2026-04-30). Node 26 is Active LTS (since 2026-10-28). Node 24 and Node 22 are Maintenance LTS (EOL 2028-04-30 and 2027-04-30). Node 27 is in the new Alpha phase. There is no odd-numbered "Current" line any more.
2. Recommendation: set the floor to `>=24`, and test CI on 24 and 26. Node 22 has about 6 months of support left. nodejs.org now gives Windows users 26 ("Latest LTS v26.13.0"). The publish job already runs on 24, and the kit's support matrix was measured on Node 26.7.0.
3. No API the kit uses is removed between 20 and 26. Raising the floor breaks nothing at runtime. The only new runtime signal is DEP0190 on Node 24+, at `pack/build.mjs:159-163` (`spawnSync("npm", [args], { shell: win32 })`). It is a runtime deprecation warning on Windows today and could become an error later.
4. The CVE-2024-27980 `.cmd`/`.bat` EINVAL rule behaves the same on patched 20.x and on 24/26. `lib/process.mjs:65-79` already handles it by unwrapping npm shims to native `node.exe`, with `shell: false`. node:test changes (spec reporter is always the default in 23+, `test()` no longer returns a promise in 24+) do not affect this repo's tests.
5. Changing the floor means editing 7 places: `package.json:13`, `pack/build.mjs:136`, `mcp/zcode-harness-mcp/package.json:11`, `install.sh:115-117`, `install.ps1:25,88,95`, and the CI pins (`ci.yml:24`, `release.yml:47,233`). The OMP autostart has a separate risk: it pins an absolute `node` path (`cli/adapters/omp.mjs:269-272`), so it can keep running an old or deleted Node after a major upgrade.

---

## 1. Release schedule as of 2026-11-05

Primary source: `schedule.json` in nodejs/Release, https://raw.githubusercontent.com/nodejs/Release/main/schedule.json (fetched 2026-11-05).

| Line | Codename | Start | Active LTS | Maintenance | End of life | Status on 2026-11-05 |
|---|---|---|---|---|---|---|
| v20 | Iron | 2023-04-18 | 2023-10-24 | 2024-10-22 | **2026-04-30** | **EOL** |
| v22 | Jod | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 | Maintenance LTS |
| v23 | – | 2024-10-16 | – | 2025-04-01 | 2025-06-01 | EOL |
| v24 | Krypton | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 | Maintenance LTS (since 16 days) |
| v25 | – | 2025-10-15 | – | 2026-04-01 | 2026-06-01 | EOL |
| v26 | Lithium | 2026-05-05 | **2026-10-28** | 2027-10-20 | 2029-04-30 | **Active LTS** |
| v27 | – | alpha 2026-10-28, 27.0.0 2027-04-22 | 2027-10-20 | – | 2030-04-30 | Alpha |

- **Node 20 EOL is 2026-04-30** (`"v20": {"end": "2026-04-30"}`, schedule.json above). The nodejs.org releases page lists v20 as "EOL", last updated Mar 24, 2026. It lists v26 as "LTS", last updated Oct 28, 2026, with footer "v26.13.0 Latest LTS / v27.0.0-alpha.0.0.0 Latest Alpha". Source: https://nodejs.org/en/about/previous-releases (accessed 2026-11-05).
- **The schedule model changed.** "Starting with 27.x, Node.js will move from two major releases per year to one … As of October 2026: One major release per year (April), with LTS promotion in October. Every release becomes LTS … Alpha channel for early testing with semver-major changes allowed." "Node.js 26 follows the existing schedule. This is the last release line under the current model." Source: https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule (undated in the fetched excerpt; accessed 2026-11-05). The nodejs/Release README says the same: "Starting with Node.js 27 … every release line is promoted to LTS. Those release lines stay in 'Active LTS' for the whole 30 months … and do not go through the 'Maintenance' phase". Source: https://github.com/nodejs/release (accessed 2026-11-05).
- Consequence: today there is no production-grade "Current" line. 26 left Current on 2026-10-28, and 27 is Alpha until 2027-04-22. The releases page warns: "Production applications should only use Active LTS or Maintenance LTS releases." Source: https://nodejs.org/en/about/previous-releases (accessed 2026-11-05).

## 2. Recommended floor: `>=24`

Reasoning:

- **What Windows users get.** The default nodejs.org download is "Latest LTS", which is v26.13.0 as of 2026-11-05 (https://nodejs.org/en/about/previous-releases). Anyone who installed an LTS from nodejs.org after 2025-10-28 has 24 or 26. Anyone still on 20 runs an unsupported runtime.
- **Why not `>=22`.** 22 is in Maintenance and reaches EOL on 2027-04-30 (schedule.json). That is about 6 months away, shorter than a typical kit release cycle. Every line kept in the support range also needs a CI matrix leg.
- **Why not `>=26`.** 24 is supported until 2028-04-30 (schedule.json). The repo already depends on 24 in release CI (`.github/workflows/release.yml:76-84`: "The publish job alone runs on Node 24 … Trusted Publishing (OIDC) needs npm >= 11.5"). Requiring 26 would turn away users who installed LTS in 2025/early 2026, without any technical benefit (section 3).
- **Evidence from the repo itself.** `SUPPORT_MATRIX.json:4` records "Windows 11 Pro (10.0.26200), Node 26.7.0, Bun 1.4.2". Node 20 is used only in CI (`ci.yml:24`, `release.yml:47,233`), and its comment calls it "the documented engines floor" (`release.yml:78`).
- **The floor is already above 20.0 in practice.** 15 test files use `import.meta.dirname` (for example `tests/release-marker.test.mjs:11`, `tests/registry-version.test.mjs:144`). That API does not exist in early 20.x releases. Its exact "added in" version was not re-verified from a primary source in this pass. In any case, `>=20` was not true for the test suite.
- **Platform side effect (all acceptable):** Node 23 dropped 32-bit Windows and Windows older than 10. "build: remove support for 32-bit Windows" (#53184) and "build: drop experimental support for Windows <10" (#54079). Source: https://nodejs.org/en/blog/release/v23.0.0 (2024-10-16).
- **Install-time enforcement.** `engines` is only advisory for npm. The real gate is the installers, which hard-code 20: `install.sh:115-117` (`[ "$NODE_MAJOR" -ge 20 ]`) and `install.ps1:88` (`[int]$Matches[1] -ge 20`), plus messages at `install.ps1:25,95`. Change both. Also change the `engines` that the packed manifest emits (`pack/build.mjs:136`) and the MCP package (`mcp/zcode-harness-mcp/package.json:11`).

Alternative if the owner wants to keep users on 22 until April 2027: `>=22.12`. That version is the first 22.x with `require(esm)` unflagged, per https://nodejs.org/en/blog/release/v22.12.0 (2024-12-03). It needs a third CI leg (22/24/26), and the floor would have to be raised again in about 6 months.

## 3. Behaviour changes from 20 to 24, and up to 26 (the newest LTS)

### 3.1 child_process

| Change | Version | Source | Kit impact |
|---|---|---|---|
| `.bat`/`.cmd` passed to `spawn`/`spawnSync` **without `shell`** throws `EINVAL` (CVE-2024-27980) | security releases of 18.x/20.x/21.x, 2024-04-10, so present in every line ≥ the patched 20.x | "Node.js will now error with `EINVAL` if a `.bat` or `.cmd` file is passed to `child_process.spawn` and `child_process.spawnSync` without the `shell` option set." https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2 (2024-04-10) | **No change vs patched Node 20.** The kit already avoids it: `lib/process.mjs:65-71` (`commandInvocation`) unwraps npm `.cmd` shims to `node.exe <target.js>`, and `lib/process.mjs:77` runs with `shell: false, windowsVerbatimArguments: false`. `resolveBun` requires a native `bun.exe` (`lib/process.mjs:149`). OMP autostart uses `execFile(RUNTIME, …, { shell: false })` (`proxy/zcode-proxy-autostart.ts:47-49`). |
| **DEP0190**: passing an `args` array to `execFile`/`spawn` with `shell: true` (or a shell path) | doc-only in 22.15.0 / 23.11.0; **runtime deprecation in 24.0.0** | "When an `args` array is passed to `child_process.execFile` or `child_process.spawn` with the option `{ shell: true }` … the values are not escaped, only space-separated, which can lead to shell injection." https://nodejs.org/api/deprecations.html (v26.12.1 docs, accessed 2026-11-05). 24.0.0 changelog: "child_process: deprecate passing `args` to `spawn` and `execFile`" (#57199). https://nodejs.org/en/blog/release/v24.0.0 (2025-05-06) | **One hit:** `pack/build.mjs:159-163`, `spawnSync("npm", ["publish", "--dry-run"], { …, shell: process.platform === "win32" })`. On Windows with Node ≥24 this emits a DeprecationWarning on every `--dry-run-publish` build. Fix: route it through `runCommandSync("npm", […])` from `lib/process.mjs`, or pass a single command string like the two call sites below. **Not hits** (single string, no args array): `scripts/registry-version.mjs:11` (`spawnSync([command, ...args].join(" "), { shell: true })`) and `tests/release-marker.test.mjs:56-57`. Both are still shell-string invocations, but the arguments are fixed or validated, as the comment at `registry-version.mjs:9` says. |
| DEP0196: `options.shell` as empty string | doc-only 24.2.0 / 22.17.0 | https://nodejs.org/api/deprecations.html (accessed 2026-11-05) | Not used. |
| `child_process._channel` removed (EOL) | 25.0.0 | "child_process: move _channel to end-of-life" (#58527). https://nodejs.org/en/blog/release/v25.0.0 (2025-10-15) | Not used. |
| `detached` / `windowsHide` | No semver-major change found in the 22.0.0, 23.0.0, 24.0.0, 25.0.0 or 26.0.0 release notes reviewed | (release notes above) | None. Observation, not version-related: `proxy/zcode-proxy-manager.mjs:585-591` spawns bun with `detached: true` and no `windowsHide`. Every other Windows spawn in the manager passes `windowsHide: true`. |

### 3.2 node:test runner (root `npm test` = `node --test <24 explicit files>`)

| Change | Version | Source | Kit impact |
|---|---|---|---|
| `spec` is always the default reporter (before 23, TAP when not a TTY) | 23.0.0 | "test_runner: always make spec the default reporter" (#54548). https://nodejs.org/en/blog/release/v23.0.0 (2024-10-16) | CI logs change format. Nothing in the repo parses TAP (grep for `TAP version`/`# pass`/`--test-reporter` found nothing). Cosmetic only. |
| `only` tests detected when `--test` is not used | 23.0.0 | "test_runner: detect only tests when --test is not used" (#54881). Same source | None (`--test` is always used). |
| `test()` / `t.test()` no longer return promises; subtests are awaited automatically | 24.0.0 | "test_runner: remove promises returned by test()" / "…t.test()" / "automatically wait for subtests to finish" (#56664). https://nodejs.org/en/blog/release/v24.0.0 (2025-05-06) | None. No `await test(` or `await t.test(` anywhere in `tests/` or `mcp/zcode-harness-mcp/test/`. All files use `import { test[, beforeEach, afterEach] } from "node:test"`. |
| `--test-timeout` applies per test | 24.0.0 (semver-patch) | "test_runner: improve --test-timeout to be per test" (#57672). Same source | The flag is not used. |
| Default isolation is `'process'` (one child process per file) | Current docs | "`isolation` … If set to `'process'`, each test file is run in a separate child process … **Default:** `'process'`." https://nodejs.org/api/test.html (v26.13.0 docs, accessed 2026-11-05) | Same model as Node 20. The tests' shared fakehome and child spawns keep working. |
| Glob arguments to `node --test` | Current docs, in every supported line | "one or more glob patterns can be provided as the final argument(s) … enclosed in double quotes". https://nodejs.org/api/test.html | Optional cleanup: the explicit list in `package.json:16` could become `"tests/*.test.mjs"`. **Caution:** the list currently leaves out `tests/update.test.mjs` and `tests/upstream-config.test.mjs` (found with a `comm` of `tests/*.test.mjs` against the script). Switching to a glob would start running them. Decide before changing. |
| Mocks / snapshots | `t.assert`/`snapshot` added in 22.x/23.x per docs | https://nodejs.org/api/test.html | Not used (no `mock.`, `t.mock`, or `snapshot` in tests). |

### 3.3 Global `fetch` / undici

- Node 22: undici 6.x (22.0.0 changelog lines "deps: update undici to 6.3.0 / 6.6.0"), https://nodejs.org/en/blog/release/v22.0.0 (2024-04-24).
- Node 24: "Node.js 24 includes Undici 7" ("deps: update undici to 7.0.0" #56070), https://nodejs.org/en/blog/release/v24.0.0 (2025-05-06).
- Node 26: "Undici has been updated to version 8.0.2" (#62384), https://nodejs.org/en/blog/release/v26.0.0 (2026-05-05).
- Kit impact: **none expected.** The kit only uses plain `fetch(url, { headers, signal: AbortSignal.timeout(n) })` against 127.0.0.1 and GitHub. Examples: `cli/heal.mjs:85-86,126-127,142-145`, `cli/zcode-kit.mjs:187-190`, `proxy/zcode-proxy-manager.mjs:119,856,913,932,972,1168`, `lib/self-update.mjs:77,89`, `cli/upstream-config.mjs:99`, `proxy/zcode-proxy-autostart.ts:29`. It does not import `undici`, set a `dispatcher`, or call `setGlobalDispatcher` (grep found none). The OMP autostart `.ts` runs inside OMP's Bun host, not Node. `zcode-proxy-src` runs under Bun.

### 3.4 ESM/CJS interop (`require(esm)`)

- `require(esm)` was enabled by default in 23.0.0 ("Support for loading native ES modules using `require()` had been available on v20.x and v22.x under the command line flag `--experimental-require-module`. In v23.x, this feature is now enabled by default.", https://nodejs.org/en/blog/release/v23.0.0, 2024-10-16) and in 22.12.0 ("Node.js will no longer throw `ERR_REQUIRE_ESM` … can, however, throw `ERR_REQUIRE_ASYNC_MODULE` if the ES module … contain[s] top-level `await`", https://nodejs.org/en/blog/release/v22.12.0, 2024-12-03).
- Kit impact: the kit is pure ESM (`"type": "module"`, `package.json:7`). The only `require` uses are `createRequire(...)("yaml")` from `zcode-proxy-src/node_modules`: `cli/account-setup.mjs:22`, `cli/adapters/omp.mjs:47`, `scripts/verify-golden-path.mjs:162`. If `yaml` ever ships ESM-only, this now works on 22.12+/24+, where it would have thrown on 20. That is a relaxation, not a break.
- `module.register()` is runtime-deprecated in 26.0.0 (#62401), https://nodejs.org/en/blog/release/v26.0.0. Not used.

### 3.5 Removed or deprecated APIs (22 → 26) checked against the repo

Grep over `cli lib proxy scripts setup.mjs pack tests mcp/zcode-harness-mcp/src` found **no use** of any of these:
- `util.is*` (runtime-deprecated in 22.0.0, some EOL in 23.0.0; https://nodejs.org/en/blog/release/v22.0.0, https://nodejs.org/en/blog/release/v23.0.0).
- `url.parse()` (DEP0169 application deprecation since 24.0.0; https://nodejs.org/api/deprecations.html). The repo only imports `pathToFileURL`/`fileURLToPath`.
- `SlowBuffer` (EOL 25.0.0).
- `fs.F_OK/R_OK/W_OK/X_OK` (removed 25.0.0).
- `fs.rmdir` recursive option (EOL 25.0.0). `lib/self-update.mjs:200` calls `rmdirSync(full)` without `recursive`, which is unaffected.
- `process.on('multipleResolves')` (EOL 25.0.0).
- `_stream_*` modules (EOL 26.0.0, DEP0193).
- `http…writeHeader` (EOL 26.0.0).
- `assert.CallTracker` (EOL 25.0.0).
- `localStorage` (Web Storage on by default in 25.0.0; 26.0.0 "return undefined for localStorage without file").

Sources: https://nodejs.org/en/blog/release/v25.0.0 (2025-10-15), https://nodejs.org/en/blog/release/v26.0.0 (2026-05-05).

Watch item: **DEP0187** (passing invalid argument types to `fs.existsSync`) became a runtime deprecation in 24.0.0. It "will throw an error in a future version" (https://nodejs.org/api/deprecations.html). The repo has 107 `existsSync(` calls in `cli lib proxy setup.mjs`. A spot grep for literal `undefined`/`null`/optional-chain arguments found none, but this was not audited exhaustively. If a test run on 24 or 26 prints `DEP0187`, that points to an unchecked `undefined` path.

### 3.6 Signals, worker_threads, fs

- `process.on` signals: the only handlers are `SIGINT`/`SIGTERM` in `mcp/zcode-harness-mcp/src/index.ts:152-153`. No semver-major change to process signal handling appears in the 22–26 release notes reviewed. (23.0.0 "lib: validate signals with interface converter" #54965 is about WebIDL `AbortSignal` validation, not POSIX signals.)
- `worker_threads`: not used anywhere in the kit (grep for `worker_threads`/`new Worker(` found nothing).
- fs: 23.0.0 "fs,win: fix bug in paths with trailing slashes" (#54160) and "path: fix bugs and inconsistencies" (#54224), https://nodejs.org/en/blog/release/v23.0.0. These are Windows path-normalisation fixes. The kit builds paths with `join`/`resolve` throughout, so no break is expected. The Windows CI leg on 24/26 will confirm. 24.0.0 "fs: remove ability to call truncate with fd" (#57567) is not used.

## 4. Repo locations to change, or that the changes affect (read-only audit of `/home/AgentKit/wt/overhaul`)

| File:line | What | Action for a `>=24` floor |
|---|---|---|
| `package.json:12-14` | `"engines": { "node": ">=20" }` | `>=24` |
| `pack/build.mjs:136` | packed manifest `engines: { node: ">=20" }` | `>=24` |
| `mcp/zcode-harness-mcp/package.json:10-12` | `"node": ">=20"` | `>=24` (`@types/node` is already `^26.0.0`, line 27) |
| `install.sh:115-117` | `node >= 20 required` and `[ "$NODE_MAJOR" -ge 20 ]` | 24 |
| `install.ps1:25,88,95` | comment, `-ge 20` check, error text | 24 |
| `.github/workflows/ci.yml:24` | `node-version: 20` | matrix `[24, 26]` |
| `.github/workflows/release.yml:47,233` (and comment `:78`) | `node-version: 20` (test matrix and post-release job) | 24/26. The publish job (`:81`) is already on 24. |
| `pack/build.mjs:159-163` | `spawnSync("npm", [...], { shell: win32 })` | Hits DEP0190 on Windows with Node ≥24. Switch to `runCommandSync` (`lib/process.mjs:74`) or a single command string. |
| `cli/adapters/omp.mjs:266-272` + `proxy/zcode-proxy-autostart.ts:10,47` | OMP autostart pins the **absolute** interpreter path that setup ran under (`process.execPath` or `resolveCommand("node.exe")`) | Not a Node API change, but it interacts with the upgrade. A nodejs.org MSI upgrade keeps `C:\Program Files\nodejs\node.exe`, so the pin survives. Version managers (nvm-windows, fnm, volta) use version-specific paths: removing the old Node makes the pin fail with `ENOENT` (mapped to `"runtime-unavailable"` at `zcode-proxy-autostart.ts:51`), and keeping it means autostart silently runs `cli/heal.mjs` on the old (possibly EOL 20) runtime. Suggestion: have `heal.mjs` preflight compare `process.versions.node` with the floor and report it, or have setup re-pin on every run. |
| `tests/*.test.mjs` (15 files, e.g. `tests/release-marker.test.mjs:11`) | `import.meta.dirname` | Fine on 24/26. Documents that the old `>=20` was not the true floor for tests. |
| `scripts/registry-version.mjs:8-12`, `tests/release-marker.test.mjs:55-61` | Windows `shell: true` with a single command string | Not DEP0190 (no args array). No action required. |

## Sources (all accessed 2026-11-05)

- nodejs/Release `schedule.json`: https://raw.githubusercontent.com/nodejs/Release/main/schedule.json
- nodejs/Release README (release phases, Node 27 alpha): https://github.com/nodejs/release
- Node.js Releases page (status table, "v26.13.0 Latest LTS"): https://nodejs.org/en/about/previous-releases
- "Evolving the Node.js Release Schedule": https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule
- Node 22.0.0 release notes (2024-04-24): https://nodejs.org/en/blog/release/v22.0.0
- Node 22.12.0 release notes (2024-12-03): https://nodejs.org/en/blog/release/v22.12.0
- Node 23.0.0 release notes (2024-10-16): https://nodejs.org/en/blog/release/v23.0.0
- Node 24.0.0 release notes (2025-05-06): https://nodejs.org/en/blog/release/v24.0.0
- Node 25.0.0 release notes (2025-10-15): https://nodejs.org/en/blog/release/v25.0.0
- Node 26.0.0 release notes (2026-05-05): https://nodejs.org/en/blog/release/v26.0.0
- April 2024 security releases, CVE-2024-27980 (2024-04-10): https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2
- Deprecated APIs (v26.12.1 docs): https://nodejs.org/api/deprecations.html
- Test runner (v26.13.0 docs): https://nodejs.org/api/test.html

Not verified from a primary source in this pass: the exact Node version that added `import.meta.dirname`, and the undici major bundled with Node 20.
