# 33: `proxy.log` single rotator: size-capped writer, manager rotation under the lock, file modes

**Blocked by:** 14 (Event-line format and redaction for new log events (prefactor)), 16 (Start lock protocol v1 with proven takeover (no judge-then-rename race)), 18 (Per-spawn proxy environment: stop token and log dir set by the manager, token stripped from the respawn hook), 21 (Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB)

**Status:** resolved

Model: sol

Risk: high

ADR: 0009, 0015

**What to build:** While it runs, the proxy opens `proxy.log` (path from `ZCODE_KIT_LOG_DIR`) through a size-capped writer: rotation at 5 MB keeping one `proxy.log.1` (unlink `.1` → rename → reopen), plain fd writes, console/stdout/stderr through it, line content unchanged. A foreign handle blocking the rename → keep appending, retry each check, one WARN event. The manager keeps `[manager <ISO>] …` lines and rotates only under the start lock with no live recorded proxy (today's pre-lock rotation removed). Every creator of a log-dir file uses `0o600` and the logs dir `0o700` (manager, proxy writer on open/reopen; the watchdog's by-path append is added by 34). `proxy logs N` reads `.1` + current.

**Acceptance criteria:**

- [ ] Seam 4: rotation at 5 MB with kit readers and appenders open; foreign-handle case (windows-latest: rename with an open reader, build-time gate 5); one WARN; no line lost.
- [ ] Seam 2: manager rotation only under the lock and with no live proxy; file modes on every created file (POSIX); `proxy logs N` across `proxy.log.1` and `proxy.log`.
- [ ] Loop S7: `proxy.log` ≤ 6 MB while running (`proxy.log:bounded-while-running`). **Remove `proxy.log:bounded-while-running` from `S7/short` (linux, windows) in `expected-red.json`, with the evidence Round 15 Q1 condition 5 requires.**
- [ ] Seam 4: after the writer opens, a line written to `process.stdout` and one written to `process.stderr` appear unchanged in `proxy.log`.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 74, 75, 77, 78, 79

## Comments

- 2026-11-06 (orchestrator, from ticket 14): pass every line the proxy writes through redactLine() from lib/event-line.mjs / zcode-proxy-src/src/log/event-line.mjs in the size-capped writer (ticket 14 left existing proxy stdout lines unredacted at write time).

- 2026-11-08 (orchestrator, Owner Proxy round 15): Q1 condition 7 — "The `S7/short` entry stays until 34" became "remove `proxy.log:bounded-while-running` from `S7/short`". 33 is the entry's only owner (34 owns no name, Q1 E), so under Q1 condition 5 the commit that removes this name deletes the entry.

- 2026-11-09 (implementer, `ticket/33-proxy-log-single-rotator`, implementation head 8da4906 on integration tip e0962b7; this report is the next commit). Logs: `reports/t33-*.log` in the integration worktree.
  - **What changed.**
    - Proxy: `zcode-proxy-src/src/log/proxy-log-writer.ts`, the size-capped writer, opened as the first statement of `serve()` when `ZCODE_KIT_LOG_DIR` is set. It uses plain fd writes (`writeSync`), and console plus `process.stdout`/`process.stderr` are routed through it.
      - Every chunk goes through `redactLine`: the stop token in the env, the config's proxy key (`addSecret`), and token shapes.
      - A size check through its own fd before every write; at ≥ 5 MB it unlinks `.1`, renames, and reopens.
      - A blocked unlink or rename leaves it appending, with one WARN event line per blocked spell, retried at every check.
      - Modes: the logs dir is created `0o700`, and `proxy.log` is created `0o600` on open and reopen.
      - Without the variable, nothing changes.
    - Manager (`lib/proxy-lifecycle.mjs`):
      - the pre-lock `rotateLogIfNeeded()` is removed;
      - `rotateLogUnderLock()` runs only in `startLocked`, after the recorded-pid handling (no live recorded proxy can be left there), before the dependency/Bun checks and the spawn;
      - `appendLog` creates the logs dir `0o700` and `proxy.log` `0o600`.
    - `lib/heal-log.mjs`: the `heal.log.1` marker file is created `0o600`, since it is a log-dir file too.
    - `proxy logs N` (`proxy/zcode-proxy-manager.mjs`): when the current file's 64 KB tail holds the whole file and fewer than N lines, the tail of `proxy.log.1` comes first. With only `.1` present it reads `.1`.
  - **Suites on 8da4906 (tip e0962b7).** `npm run test`: 998 tests, 980 pass, 0 fail, 18 skipped. `npm run test:proxy`: 1604 tests, 1603 pass, 0 fail, 1 skip, 108 files. `test:proxy-typecheck`: pass. `npm run test:mcp`: 107 tests, 106 pass, 0 fail, 1 skipped; `dist/` unchanged after the build. Memory-loop unit tests: 228 tests, 223 pass, 5 skipped.
  - **Suites after merging the moved tip 0e0b96f (ticket 61; merge e6e73fd, no conflicts)** (`t33-merged-*.log`). `npm run test`: 1003 tests, 985 pass, 0 fail, 18 skipped. `npm run test:proxy`: 1633 tests, 1632 pass, 0 fail, 1 skip, 110 files. `test:proxy-typecheck`: pass. `npm run test:mcp`: 107 tests, 106 pass, 0 fail, 1 skipped; worktree clean. Loop runs on the merged tree:
    - S7/short GREEN: `proxy.log` 0.08 MB, rotated true, `procPeak:proxy` 206.7 MB, heap-at-cap 63 MB. That makes 4 of 4 GREEN runs with 33.
    - S1/short GREEN: 3.35 %/1k, steady 119.6 MB, peak 153.9 MB.
  - **RED → GREEN.**
    - Loop S7/short (linux), on the tip: RED, `proxy.log:bounded-while-running` 6.37 MB, `rotatedWhileRunning: false` (`t33-s7-red-tip.log`).
    - Loop S7/short with 33: GREEN in 3 of 3 runs. Each run measured 0.08 MB with `rotatedWhileRunning: true` (`t33-s7-green-1.log`, `t33-loop-S7-2.log`, `t33-loop-S7-3.log`).
    - Seam 4 (`src/log/proxy-log-serve.test.ts`, spawned `serve`), on the tip's `index.ts`: 4 of the 4 POSIX writer tests fail, and the unchanged-without-the-variable test passes (`t33-red-tip-seam4.log`). With 33: 5 pass, plus 1 Windows-only skip.
    - Seam 2 (`tests/proxy-lifecycle.test.mjs`), on the tip: 4 of 4 fail (`t33-red-manager.log`); with 33 all pass. In the "a start rotates first" test, its rotation part was already GREEN on the tip, because the old pre-lock rotation did it; its new-file mode part was RED. That rotation is pinned by mutation below.
  - **Mutation proofs** (`t33-mutants.log`; each mutant was a scratch edit of the committed file and was restored with `git checkout 8da4906 -- <file>`; `git status` was clean afterwards). Each mutant made exactly its test fail:
    - writer never rotates → the rotation test;
    - WARN on every blocked check → the refused-rename test;
    - no redaction → the stop-token/key test;
    - writer opened without `ZCODE_KIT_LOG_DIR` → the unchanged-behaviour test;
    - manager rotation call removed → the "start rotates first" test;
    - pre-lock rotation put back → the "never rotates while its proxy answers / without the lock / over a live recorded proxy" test;
    - `logs` reading only `proxy.log` → the "reads across" test.
  - **Acceptance.**
    - Seam 4, rotation at 5 MB with kit readers and appenders open: met. A Node process holds a reader and an appender fd, and the kit appends by path while the proxy writes 2,000 sequenced lines across the threshold. Every line is present exactly once, in order, across `.1` + current.
    - Seam 4, foreign handle: met on POSIX. A logs dir made read-only makes the rename fail with EACCES; the writer keeps appending, writes one WARN, and rotates at the first check after the refusal ends. On Windows, a .NET FileStream shares read and write without delete (build-time gate 5); that test is pending CI (orchestrator verifies). One WARN; no line lost.
    - Seam 2: met (rotation only under the lock with no live proxy; POSIX file modes; `proxy logs N` across `.1` and current).
    - Loop S7 ≤ 6 MB while running: met on linux. Windows is pending CI.
    - Seam 4, stdout and stderr lines unchanged in `proxy.log`: met.
    - Every new log event uses the event-line format: met (`WARN proxy proxy.log rotation blocked, appending and retrying at every check path=… code=… sizeBytes=… limitBytes=…`, and the writer-unavailable WARN).
    - Config keys and env overrides: none added.
    - The new test file is `zcode-proxy-src/src/log/proxy-log-serve.test.ts`, picked up by `bun test` (`npm run test:proxy`). The fixture is `src/log/__fixtures__/stdio-lines.ts`.
  - **expected-red.json (Round 15 Q1 condition 5).** `proxy.log:bounded-while-running` is removed from `S7/short` on linux and windows. It was the entry's last name, so both entries are deleted.
    - Linux evidence: the 3 recorded loop runs above, plus the pre-merge CI run, which is **pending CI**.
    - Windows evidence: the pre-merge CI windows leg only, **pending CI** (the windows loop does not run locally).
    - Name status: `proxy.log:bounded-while-running` GREEN (linux, 3/3); windows pending CI.
  - **Metrics delta (linux, short).**
    - S7: `proxy.log` 6.37 → 0.08 MB. `procPeak:proxy` 205.3 → 218.3 / 212.9 / 215.8 MB (budget 250). heap-at-cap 58 → 64 / 58 / 57 MB (budget 96). 148 B/request unchanged. Early log absent (34).
    - S1/short GREEN: growth 3.36 %/1k with no trend, steady 120.9 MB, peak 158.9 MB (reference: 3.34–3.41, 118–122, 148–167). So routing every console line through the writer (one fstat plus redaction per write) shows no cost there.
    - S4/short: RED only on 17's `stale-lock-after-ctrl-c` (5 of 8), which is owned. `respawn-recovers-despite-stale-lock` was GREEN in this one run, though METRICS lists it RED 16/16 before 16 merged; that is for 17's evidence, not 33's.
  - **Pre-existing tests changed.**
    - Ticket 71's two S7 retained-heap job tests (`tests/memory/loop.test.mjs`) and the `s7-series` mode of `tests/memory/fixtures/fake-run.mjs` judged a fake S7 run against the committed list with 33's entry, and the fake reported `proxy.log` RED 6.37. With the entry deleted, the fake reports `proxy.log` GREEN 0.08 (as in 33's runs). The assertions follow: the GREEN series is GREEN with no note, and the heap RED is "RED but not listed" instead of "not owned by ticket 33". The retained-heap judging they test is unchanged.
    - `tests/memory/scenarios/s7-disk.mjs`: header comment only.
  - **Decisions taken.**
    1. The rotation check is an fstat of the writer's own fd before every write, so kit appenders' bytes count. While running, the bound is 5 MB plus one write plus concurrent appends.
    2. The fd is closed before the rename and reopened after it (new file, or the current one again if the rename failed). The rename therefore never depends on the writer's own share mode on Windows. If the reopen fails, the chunk goes to the original stderr (the inherited stdio) and the next write retries the open.
    3. If unlinking `.1` fails with anything but ENOENT, that counts as blocked, and the rename is not attempted. There is one WARN per blocked spell; it resets after a successful rotation.
    4. Redaction applies per write chunk, not per buffered line, so a secret split across two separate writes would not be masked. The proxy's console and stdio callers write whole lines. Following the ticket-14 Comments line, token-shape redaction also masks random-looking 32+ character runs (a sha256 hex, for example) in proxy lines.
    5. Console arguments are formatted with `util.format`. String arguments come out byte-identical. An Error prints its stack, without Bun's coloured source excerpt.
    6. The manager's threshold is now `>=` 5 MB (it was `>`), the same as the writer's. The defensive "no live recorded pid" check inside `rotateLogUnderLock` stays.
    7. File modes apply when a file is created. A `proxy.log` an older manager created keeps its mode until the next rotation creates a new one.
    8. CRLF (`lib/line-endings.mjs`) does not apply: `proxy.log` is a kit log, not a user-owned config, and lines are kept as written.
    9. The foreign-handle case is documented in the writer's module header. README and release notes are 52/54.
  - **Left for other tickets.**
    - 34: the spawned proxy's inherited stdio still points at `proxy.log`. That is native output only: Bun crash text, and the watchdog worker's console, which is a separate thread the routing does not reach. After a rotation, that fd writes into `proxy.log.1`, and after a second rotation into an unlinked file. The early log replaces it. The watchdog's by-path append mode is also 34's.
    - Windows leg to watch: on the second rotation the writer unlinks the `.1` that this inherited handle holds open (libuv and Bun open with FILE_SHARE_DELETE). Windows Server 2022 removes the name at once (POSIX delete). If it were delete-pending instead, the rename would fail, and the writer would stay in the blocked path (one WARN, appending) until the proxy exits.

- 2026-11-09 (merger): Merged 2026-11-09 as 278d329; fast suite: kit 999/1019 (0 fail, 20 skipped), proxy 1632/1633 (0 fail, 1 skipped: the windows-only foreign-handle test; 110 files), mcp 115/116 (0 fail, 1 skipped). This was a plain `--no-ff` merge of ticket/33-proxy-log-single-rotator (7d548f9) into the tip 542749b. 33 had never been merged or reverted on the integration branch, so no revert-of-revert was needed. There were no conflicts: `tests/memory/expected-red.json` and `lib/proxy-lifecycle.mjs` auto-merged. expected-red.json keeps both changes: 33 deleted the `S7/short` entries (linux, windows), and 542749b moved windows S4 `stale-lock-after-ctrl-c` to owner 81. The JSON parses. No lockfile changed (`npm ci` only). `mcp/zcode-harness-mcp/dist/` was unchanged after `test:mcp`'s build (B5). Logs: `reports/merge-33-{npm-ci,test,proxy,mcp}.log`.
  - Pre-merge CI run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42604412718 (staging/33, head 68f9981 = bd6d328 + ticket/33 7d548f9): green on all 8 jobs. The merger checked these values in its job logs (`/home/AgentKit/overhaul-tools/merge-33-ci/job-129116574889.log` linux memory-budget, `job-129116574689.log` windows memory-budget):
    - linux S7/short GREEN, with no expected-RED entry: `proxy.log:bounded-while-running` 0.08 MB (budget 6; 148 B/request, 0.1 MB while running, rotated: true), `proxy.early.log:bounded` 0 MB (+64 KB overshoot, budget 1), `responses-store:heap-at-cap` 58 MB (budget 96), procPeak:proxy 223.9 MB (budget 250), orphans 0.
    - windows S7/short GREEN, with no expected-RED entry: `proxy.log:bounded-while-running` 0.08 MB (budget 6; 148 B/request, 0.1 MB while running, rotated: true), `proxy.early.log:bounded` 0 MB (+64 KB overshoot, budget 1), `responses-store:heap-at-cap` 59 MB (budget 96), procPeak:proxy WS 227.6 MB (budget 250, commit 404.6), commit-backstop 404.6 MB (budget 512), orphans 0.
    - "ratchet holds" on both legs. Every RED run is listed for its owners: S2 (58), S3 (37, 35), S4 (17), and linux S5 (74). Windows S5 is unstable (74).
    - The windows test-kit legs (node 24 and 26) ran the new rotation tests, all passed: "the manager never rotates proxy.log while its proxy answers, …", "under the start lock with no live recorded proxy, a start rotates proxy.log first …", "`proxy logs N` reads across proxy.log.1 and proxy.log …", and the proxy.log writer's "rotates at 5 MB while kit readers and appenders hold the file open …", "after the writer opens, a line written to process.stdout and one written to process.stderr appear unchanged …", "never writes the stop token or the proxy key into proxy.log" and "serve without ZCODE_KIT_LOG_DIR … keeps today's behaviour". The windows foreign-handle variant "Windows: a foreign handle without FILE_SHARE_DELETE blocks the rename; the writer keeps appending with one WARN line and rotates once the handle is gone" passed on both windows legs (608.60 ms on 24, 553.97 ms on 26) and was skipped on the ubuntu legs. Its POSIX counterpart, "a rename the filesystem refuses …", and the POSIX file-mode test passed on ubuntu and were skipped on windows.
  - Sanity diffs. Staged ticket: `git diff staging/33 HEAD` over 33's 12 files (`staging/33^1..staging/33`) is not empty. Only `lib/proxy-lifecycle.mjs` and `tests/memory/expected-red.json` differ, and both differences come from 6edf13f (ticket 17) and 542749b. Whole tree: `git diff staging/33 HEAD -- . ':!.scratch'` covers 21 files. Its changed lines are identical to `git diff bd6d328 542749b` (the only text difference is two context lines in expected-red.json that lost a trailing comma because S7 was removed). Ticket 31's merge 667f967 brought the `mcp/zcode-harness-mcp/**` files (src, dist, docs/MCP_API.md, package.json, tests). Ticket 17's merge 6edf13f brought `docs/adr/0003-start-lock-proven-takeover.md`, `lib/start-lock.mjs`, `lib/proxy-lifecycle.mjs`, `tests/start-lock.test.mjs`, `tests/fixtures/start-{contender,lock-holder}.mjs` and `tests/memory/expected-red.json`. 542749b also changed `tests/memory/expected-red.json` (windows S4 owner move). Nothing else differs.
