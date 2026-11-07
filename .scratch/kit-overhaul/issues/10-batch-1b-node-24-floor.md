# 10: Batch 1b — Node 24 support floor, refuse before mutation, autostart Node-path check

**Blocked by:** 09 (Batch 1a — CI toolchain: actions v7, Bun 1.4.4 in CI, nested proxy workflows removed)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0006

**What to build:** `engines.node >=24` in all three manifests; `install.sh`, `install.ps1` and the pack build gate at 24 with the exact upgrade step; `setup`/`update` on Node < 24 refuse before mutating state (what/why/next) and leave the installation working; the preflight reports when the OMP autostart's pinned Node path is below the floor or missing; DEP0190 in the pack build fixed.

**Acceptance criteria:**

- [ ] Temp-HOME installer fixtures (seam 8): fake Node v20 and v22 are rejected before any file changes (state dir byte-compared before/after); v24 and v26 pass; installer tests' fake versions moved to 24/26.
- [ ] Preflight fixture: pinned autostart Node v22 → WARN with the next command; missing path → WARN; v24+ → silent (seam 8).
- [ ] Pack build runs with no DEP0190 warning.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 124, 125

## Comments

### 2026-11-07 — implementer (substitute for glm; the glm worker has no provider)

**Branch:** `ticket/10-node-24-floor` (worktree `/home/AgentKit/wt/t10`), based on the integration tip `d249883` (still the tip when the suites ran, so no merge commit was needed). Code commits `df4b6b8` (installers), `d129dfa` (CLI, pack build, manifests), `ee18504` (preflight); the head SHA is the commit that adds this comment.

**Node release status, re-checked from primary sources on 2026-11-07** (the research is dated 2026-11-05)
- nodejs/Release `schedule.json` (https://raw.githubusercontent.com/nodejs/Release/main/schedule.json): v20 end 2026-04-30; v22 maintenance since 2025-10-21, end 2027-04-30; v24 LTS 2025-10-28, maintenance 2026-10-20, end 2028-04-30; v26 LTS 2026-10-28, end 2029-04-30; v27 alpha. Unchanged from the research.
- nodejs.org releases page (https://nodejs.org/en/about/previous-releases): v26 "LTS" (v26.13.0 Latest LTS), v24 LTS (v24.22.2), v22 LTS (v22.23.4), v20 EOL (v20.20.2). So the floor of 24 still holds.
- The Windows upgrade step `winget install --id OpenJS.NodeJS.LTS --exact` was checked against microsoft/winget-pkgs (https://github.com/microsoft/winget-pkgs/issues/464841: 26.13.0 is published under `OpenJS.NodeJS.LTS`; https://github.com/microsoft/winget-pkgs/tree/master/manifests/o/OpenJS/NodeJS/LTS).

**What landed**
- `lib/node-floor.mjs` (new): `NODE_FLOOR = 24`, `nodeMajor`, `belowNodeFloor`, `nodeUpgradeSteps(then, platform)`, `nodeFloorRefusal(command)` → `{ what, why, next, exit: 2 }`. It is plain ESM with no imports.
- `cli/zcode-kit.mjs`: `setup` and `update` on Node < 24 render that block with `out.error` (`lib/term/load.mjs`, ticket 06), on stderr, and exit 2. This happens in `main()` before `createCtx`, so there is no `ensureState`, lock, transaction, proxy stop, git/npm call or download. `--help` and every other command are unchanged (decision 1).
- `install.sh`: the floor check (`NODE_FLOOR=24`) moved up, right after the required-tools check, so it runs before `umask`/`mktemp`, the latest-release lookup and any write. It prints `[ERROR]` + `why:` + `next:` (nodejs.org download, or `nvm install 24`) to stderr and exits 2. An unreadable or empty `node --version` is refused too. The old check at step 1 is removed.
- `install.ps1`: the floor check (`$NodeFloor = 24`) moved before the temp directory and the release lookup. It throws what/why/next with `winget install --id OpenJS.NodeJS.LTS --exact` (or the nodejs.org download). `Test-Node` is removed. The file stays ASCII-only and CRLF.
- `pack/build.mjs`: `NODE_FLOOR = 24`; the packed manifest declares `engines.node >=24`; the build refuses below the floor (exit 2, nothing assembled). DEP0190 is fixed: on Windows the dry-run publish now runs one fixed command string with `shell: true` (no args array); elsewhere it runs an args array without a shell. Decision 3 explains why the floor is not imported here.
- `engines.node` `>=24` in `package.json`, `mcp/zcode-harness-mcp/package.json` and the root entries of both `package-lock.json` files. A dependency's own engines entry (`@hono/node-server`) is untouched; `bun.lock` has no engines field.
- `cli/heal.mjs`: `autostartRuntimeCheck(ctx)` reads `~/.omp/agent/extensions/zcode-proxy-autostart.ts` (size-capped at 256 KB) and checks it only when its `ROOT` is this installation. A pinned Bun is skipped. If the pinned `RUNTIME` is missing → `runtime-missing`. If it is the running Node → `process.version`; otherwise `<runtime> --version` (5 s timeout, no shell). Below 24 → `runtime-floor`. Unreadable versions are silent. `startupPreflight` attaches `runtime: { cause, detail, next }` to its result. One WARN event line goes to `heal.log`, in the ticket 14 format, through `formatEventLine`: `… WARN preflight OMP autostart runtime check cause=runtime-floor action=runtime-check result=warning`. Its fields are a fixed vocabulary with no path. Human output (`node cli/heal.mjs`, and `zcode-kit run` via `cli/launch.mjs`) uses the off-TTY check grammar: `WARN  OMP autostart runtime — the pinned Node.js v22.23.4 is below the support floor (Node.js 24)` / `  next: zcode-kit setup, then restart OMP`. `--diagnostic-code` adds `[zcode-preflight] cause=runtime-floor|runtime-missing`. `PREFLIGHT_WARNINGS` gains both keys, so the regenerated autostart forwards `[zcode-autostart] runtime-floor: …` with the next command. An autostart generated before this change ignores the unknown cause, as it does today.

**Tests (seam 8, temp fixtures only; nothing touched the real HOME, B3)**
- `tests/installer-audit.test.mjs` (+6):
  - `install.sh refuses Node "v20.19.0" | "v22.23.4" | "v23.11.1" | "garbage" | ""` (5 tests). Each runs an existing installation (key, config, logs, backups, generated, `.bun-path`) plus the HOME shim. Every tool except `node --version` records its call. The test asserts exit 2, no tool call, and that the installation, HOME and TMPDIR are byte-identical (type, mode, mtime and sha256 of every entry, the roots included). It also asserts the what/why/next text.
  - `install.ps1 refuses Node v20 and v22 before any file changes; v24 and v26 install` (Windows only, pending CI). `runPs1Fixture` gained a `nodeVersion` parameter (default `v24.0.0`), a `calls.log` of downloads and non-version node calls, and before/after snapshots. The default behaviour of the three existing ps1 tests is unchanged.
- `tests/node-floor.test.mjs` (new, wired into `npm run test`, 15 tests):
  - `setup --harness none`, `update` and `update --version v9.9.9` on fake Node v20/v22/v23 (9 tests). The fake is a `--import` preload that reports the old `process.version` and records and blocks every `child_process` call and `fetch`. The fixture is a copy of the kit as an installed release, with its state and a temp HOME holding an OMP integration. The tests assert exit 2, no child process or network call, kit and HOME byte-identical, stdout empty, and the exact stderr block (FAIL/why/next/next/exit, platform-specific next lines).
  - v24.0.0 and v26.13.0 pass the floor and record a setup transaction (2 tests).
  - Pack build (3 tests): engines `>=24` plus a dry-run publish through a fixture `npm` with no `DEP0190`/`DeprecationWarning`; refusal on fake v20/v22 with nothing assembled and no git/npm call.
  - One guard (1 test): every copy of the floor is 24 (lib, both manifests, both lockfiles, `install.sh`, `install.ps1`, `pack/build.mjs`) and no `-ge 20`/`>=20` remains.
- `tests/auto-heal.test.mjs` (+4):
  - The generated OMP extension, executed under Bun as OMP does, with the pinned RUNTIME set to a fake Node v20/v22, forwards exactly `[zcode-autostart] runtime-floor: <text naming Node.js 24 and zcode-kit setup>` (POSIX).
  - The same extension with a fake v24/v26 prints nothing (POSIX).
  - `node cli/heal.mjs` with the pinned path missing (all OSes) or v22 (POSIX) prints the WARN row + `next:` line, writes exactly one event line in the expected format (no path), and `--diagnostic-code` prints the cause.
  - Silent cases (all OSes; fake v24/v26 on POSIX): no autostart, pinned = the running Node, a pinned Bun, another kit copy's autostart.
- Changed pre-existing tests, with justification. The ticket requires moving the fake versions; nothing else changed in these tests:
  - `tests/installer-audit.test.mjs`: fake `node --version` `v20.19.0` → `v24.0.0` at lines 67, 93 and 192 (the floor boundary on the full Bun-bootstrap path), and → `v26.13.0` in the two mirror tests and the hermetic ps1 test. The `runPs1Fixture` default changed as above.
  - `tests/installer.test.mjs:38`: `v20.19.0` → `v24.0.0`.

**RED → GREEN** (logs in `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/reports/`)
- Installers: `t10-red1`, the new sh tests against the tip's `install.sh`, gave 0/5. v20/v22/v23 went on to download (curl called). `garbage`/`""` were refused, but only after `mktemp`, so TMPDIR changed. `t10-green1` (installer-audit + installer): 22 tests, 19 pass, 0 fail, 3 skipped (Windows-only).
- CLI: `t10-red2`: 9 refusal tests fail on the tip. setup ran its bootstrap and wrote state; update called `fetch …/releases/latest`. 2 pass (v24/v26). `t10-green2`: 11/11.
- Preflight: `t10-red3`: both WARN tests fail on the tip. The silent tests passed there too, as they must; they were proven by mutation (below). `t10-green3` (auto-heal + term-boundaries + omp-audit): 51/51.
- Pack and guard: `t10-red4`: 4/4 fail on the tip (engines `>=20`, no floor gate, `>=20` copies). `t10-green4` (node-floor + test-wiring + release-marker + release-audit): 43/43.
- Mutation proofs (each scratch edit restored; `cmp` and `git diff` checked):
  - `t10-mut1-dep0190`: the dry-run publish switched back to an args array with `shell: true` on Linux → the DEP0190 assertion fails. That is the Linux stand-in for the Windows RED; on Windows the tip itself emits DEP0190.
  - `t10-mut2-owner`: without the ROOT ownership check, the "another kit copy" case warns → fails.
  - `t10-mut2-bun`: without the Bun skip, "pinned Bun" warns → fails.
- Real old runtimes (scratch scripts in `/home/AgentKit/overhaul-tools/t10-scripts/`, not committed). Official Node `v22.23.4` and `v20.20.2` linux-x64 were checked against their `SHASUMS256.txt`.
  - `t10-real-old-node`: the real Node 22 and Node 20 load the whole CLI module graph and print the refusal for `setup`, `update` and `update --version`. `pack/build.mjs` refuses too. All exit 2, and the fixture is byte-identical.
  - `t10-real-old-autostart`: `heal.mjs --diagnostic-code` run by a real pinned Node 22/20 reports `cause=runtime-floor` and logs the event line. The preflight itself keeps working on the old runtime.
- PowerShell, as far as possible without Windows. PowerShell 7.6.9 linux-x64 was checked against its release digest (`t10-ps1-linux`):
  - the PowerShell parser reports 0 errors in `install.ps1`;
  - with the same mocks as the test, v20/v22 are refused with no download, no node call and unchanged install/TEMP/LOCALAPPDATA;
  - v24/v26 run a fresh install to "Installation complete";
  - PowerShell's error view wraps the message under a `|` gutter, so the Windows test compares the text flattened (checked against the real pwsh output).
  - Not provable here: Windows PowerShell 5.1, robocopy, the Windows `tar`, and `irm | iex`.

**Full suites** (Bun 1.4.2, Node 26.7.0; branch = tip `d249883` + this ticket)
- `npm run test` (`t10-full-kit`): 685 tests, 668 pass, 0 fail, 17 skipped. The tip (`merge-09-test`) has 660/644/16: +25 tests, +1 skip (the Windows-only ps1 floor test).
- `npm run test:proxy` (`t10-full-proxy`): 1343 pass, 0 fail, 90 files (unchanged).
- `npm run test:mcp` (`t10-full-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped. `dist/` is unchanged; only the engines lines differ.
- Memory loop, the scenario this ticket touches: S3 `--variant omp --profile short` (the OMP stub host runs the preflight), port 19103, on the tip vs. the branch (`t10-memloop-S3omp-t10-base` vs. `t10-memloop-S3omp-t10`).
  - Same verdict. The only RED is `omp:concurrent-preflights 5 procs` (expected-RED, ticket 35); the waiter checks stay ok.
  - peak:kit 373.9 → 372.4 MB; procPeak:preflight 64 → 63 MB; role preflight peak 315.1 → 313.1 MB.
  - No `runtime-check` line in the run: the pinned runtime is the running Node, so no `--version` probe is spawned.
  - No expected-RED entry belongs to this ticket.

**Decisions taken (spec/ADRs silent)**
1. **Only `setup` and `update` refuse** (ADR-0006 cond 1, story 124). `run`, `doctor`, `integrate`, `rollback`, `uninstall`, the preflight and the manager keep working on Node 20/22 (C2: the existing installation keeps working). The refusal exit code is 2 (the existing "runtime error"), so no new exit code is introduced.
2. **The check runs in `main()` before `createCtx`, not inside the commands.** That puts it ahead of everything stateful, including the `update` path's proxy stop. Because the refusal must print on the very runtimes it refuses, `lib/node-floor.mjs` has no imports. The real Node 20/22 run proves the CLI's static graph (and `lib/term/out.mjs`) still loads there.
3. **`pack/build.mjs` keeps its own `NODE_FLOOR = 24` and builds the DEP0190 fix without `lib/process.mjs`.** The `release-audit` fixture copies only `pack/` and a placeholder `lib/transaction.mjs`, so a static `lib/` import would break pre-existing tests. The new guard test keeps the copies equal. The Windows dry-run publish keeps npm's `.cmd` shim behind a shell with one fixed string, the pattern `scripts/registry-version.mjs` already uses.
4. **Upgrade steps.** POSIX: the nodejs.org download, or `nvm install 24`. Windows: `winget install --id OpenJS.NodeJS.LTS --exact` (it installs 26.13.0 today, ≥ 24), or the nodejs.org download. The installers say "then re-run this installer"; the CLI says "then rerun zcode-kit <command>" (on Windows "… in a new terminal", so PATH is refreshed).
5. **Preflight scope.** Only an autostart whose `ROOT` is this installation is checked: another copy's autostart is not ours to report on, and the next command would re-point it. A pinned Bun is out of scope (the floor is a Node floor). An unreadable `--version` output is silent; the preflight never claims what it cannot read. The `--version` probe runs only when the pinned path is not the running Node; in the autostart path it is, so no process is spawned there. `zcode-kit run` on a machine with an OMP autostart pinned elsewhere pays one `node --version` (~40 ms).
6. **`next` for the preflight is `zcode-kit setup, then restart OMP`.** `setup` re-pins the interpreter it runs under, and on a Node < 24 it refuses with the upgrade steps, so one command leads to both fixes.

**Left for other tickets**
- **52/53:** README and its translations, the MCP bridge READMEs and `SUPPORT_MATRIX.json` still say Node 20 (ADR-0006 cond 5; out of this ticket's scope).
- **54:** the release notes must announce that Node 20/22 are dropped, that the installers and `setup`/`update` refuse first (exit 2), and the new preflight WARN.
- **44:** reshape the installers' error text when the installer UX batch lands. The floor checks are self-contained blocks at the top of both scripts.
- **11:** this ticket left the Bun hashes and versions in the installer tests alone.

**Pending CI** (the orchestrator checks these after the merge and push)
1. `test-kit` windows-latest × Node 24 and × Node 26, `npm run test`, all of the following pass and none is skipped except the documented win32 skips:
   - `install.ps1 refuses Node v20 and v22 before any file changes; v24 and v26 install`: must run, not skip;
   - the three existing `install.ps1` tests, with the 24/26 fakes;
   - the five `install.sh refuses Node …` tests (Git Bash);
   - `pack build declares engines.node >=24 and runs the dry-run publish without a DEP0190 warning`: the real Windows DEP0190 RED→GREEN;
   - the 11 CLI floor tests, with the winget `next` lines;
   - the auto-heal `preflight reports …` (missing case) and `preflight stays silent …` tests. The two fake-Node autostart tests are skipped on win32 by design.
2. `test-kit` ubuntu-latest × Node 24 and 26: green. On Node 24 the floor boundary is the running runtime.
3. The `memory-budget` job on ubuntu and windows: verdicts unchanged from the tip (expected-RED list untouched).
4. The release workflow's publish job runs on Node 24, exactly the floor: `node pack/build.mjs --tracked-only --dry-run-publish` must pass there.

### 2026-11-07 — implementer, round 2 (pre-merge run 42370286615: windows `install.ps1 refuses Node v20 and v22 …` RED)

**Cause.** The `install.ps1` refusal used `throw`, so the user saw a PowerShell error record: `Exception: …install.ps1:70`, `Line |`, the source line, a `|` gutter, `ESC[31;1m` colour codes and the text re-wrapped at the console width, with the why/next lines collapsed into one paragraph. That breaks C3, not only the test. The round-1 test flattened the gutter and so hid the problem; with the colour codes on the Windows runner even the flattened text no longer matched.

**Fix (`653ed43`).**
- The refusal writes three plain lines with `[Console]::Error.WriteLine`, the same shape as `install.sh`:
  - `  [ERROR] Node.js 24 or newer is required (found vX)`
  - `    why:  …nothing was downloaded, installed or changed`
  - `    next: winget install --id OpenJS.NodeJS.LTS --exact (or …), then open a new terminal and re-run this installer`
- Exit status:
  - Run as a file (`$PSCommandPath` set): `exit 1`. That is the same code the `throw` gave.
  - Under `irm … | iex` (no script path): `$global:LASTEXITCODE = 1` and `return`. `exit` there would close the user's PowerShell session. A `throw` also aborted whatever the caller ran after the `iex`, which RED case 4 shows.
- "Nothing changed" is unchanged: the check still runs before the temp directory, the release lookup and any write.
- The file stays ASCII-only and CRLF.
- The other early refusals in `install.ps1` (the target guards at lines 51–61, the release lookup, the downloads, the hash and layout checks) are pre-existing `throw`/`Write-Error` calls with the same error-record decoration. This ticket did not touch them, and ticket 44 (installers and the PowerShell gate) owns their UX. The only refusal this ticket added is the Node floor one, now fixed.

**Test.** `install.ps1 refuses Node v20 and v22 …` now runs four refusal cases: v20 run as a file, v22 run as a file, v22 with `NO_COLOR=1`, and v22 through `Get-Content -Raw | Invoke-Expression`, the way `irm | iex` runs it. Each asserts:
- exit status exactly 1;
- no download or node call;
- the install, TEMP and LOCALAPPDATA trees byte-identical;
- the exact three lines, consecutive, on stderr;
- no `ESC`;
- no `Exception:`, `Line |`, gutter line, `ErrorRecord` or `At line`;
- in iex mode, `SESSION_ALIVE` printed after the installer returns.

`runPs1Fixture` gained the `mode` (`call`, the default, or `iex`) and `env` options; the existing callers are unchanged.

**RED → GREEN** (PowerShell 7.6.9 linux-x64, digest-checked, as in round 1; logs in `reports/`)
- `t10-r2-red-ps1`: a scratch harness with the same mocks and assertions, run against the round-1 `install.ps1`, gives 21 failures.
  - Pipes, the four cases above: the exact lines and the no-error-record checks fail; the iex session does not continue.
  - A real PTY (`script`, `stty cols 40` and `200`, with and without `NO_COLOR`): `ESC[31;1mException:`, the gutter and the wrap at 40 columns. pwsh's error view colours the record even with `NO_COLOR=1`.
- `t10-r2-green-ps1`: the same harness against the fixed `install.ps1` passes every check (ALL OK), including the PTY at 40 columns: the lines stay whole and contain no ESC.
- The committed Windows test itself, run on Linux pwsh with `process.platform` faked to `win32` (`TEMP=/tmp`):
  - `t10-r2-wintest-on-linux-red` against the round-1 script fails at the first refusal case (`v20.19.0 call {}`, `Exception: …install.ps1:70`).
  - `t10-r2-wintest-on-linux` against the fix passes all four refusal cases. It then stops at the v24/v26 install half, which needs Windows (`bun.cmd`, robocopy) and is expected to fail on Linux.
- `t10-r2-ps1-linux`: 0 parser errors; v24/v26 still complete a fresh install.
- Not verifiable here: Windows PowerShell 5.1, which the tests do not run (they use `pwsh`). `[Console]::Error.WriteLine` and `$PSCommandPath` exist in 5.1 (PowerShell 3.0+); the 5.1 run is the owner action that ticket 54 records.

**Full suites** after merging the integration tip `07fe8a4`/`f36b6a9` (docs-only; merge `640d1ba`):
- `npm run test` (`t10-r2-full-kit2`): 685 tests, 668 pass, 0 fail, 17 skipped.
- `npm run test:proxy` (`t10-r2-full-proxy`): 1343 pass, 0 fail.
- `npm run test:mcp` (`t10-r2-full-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped.

**Pending CI, round 2.** On windows-latest × Node 24 and × Node 26, `install.ps1 refuses Node v20 and v22 before any file changes; v24 and v26 install` must run (not skip) and pass. That covers all four refusal cases (exact lines on stderr, exit 1, no ESC or error record, `SESSION_ALIVE` in iex mode) and the v24/v26 installs. Everything else in `test-kit` windows and ubuntu, ux-before and both memory-budget legs must stay as in run 42370286615.
