# Round 3 facts: stop, handoff, proxy.log, watchdog, MCP task text

Fact-finding for the Round 2 open branches 3, 4, 5 and 6 (`rounds/round-02-answers.md`: Q1 conditions 1–4, Q2, Q4, Q5, Q10, Q14 and the "Shared understanding" list). This is a read-only pass over `/home/AgentKit/wt/overhaul` at `1402052`. Code references are `path:line` at that commit. External sources are given as URL plus access date. All were accessed on 2026-11-06 unless a different date is shown.

---

## 1. Windows graceful stop

### 1.1 What the code does today

- **`killOwned`** is at `proxy/zcode-proxy-manager.mjs:375-425`. Its `signal(graceful)` helper (`:383-417`) branches on `process.platform === "win32"`. On Windows it ignores `graceful` and runs one PowerShell script (`:390-411`). The script opens a handle (`OpenProcess(0x1001)`), compares that handle's creation time with the recorded start time (±1 ms), and then calls **`TerminateProcess($handle,0)`** (`:409`). The "graceful" call (`:420`) and the forced call (`:423`) are therefore the same hard kill on Windows. On POSIX the calls are `SIGTERM` and then `SIGKILL` (`:416`).
- **Timing.** The graceful wait is `waitForExit(pid, 5000)` (`:421`). The forced wait is another 5000 ms (`:424`). `waitForExit` polls every 300 ms (`:360-367`). The ownership guard is re-checked before every signal (`:376-382`, `ownershipGuard` `:332-343`).
- **Callers:**
  - `stopVerified` (`:737`), which `stop` reaches through `stopLocked`.
  - `recoverHung` (`:349`), the hung-own path.
  - `start` on a foreign port (`:635`) or a startup timeout (`:642`).
  - `scripts/verify-golden-path.mjs`, which calls `m.killOwned(p.pid)` as its "crash" injection (the inline `crash` script around `:258-262`).
  - `restart` is `stop()` followed by `start()` (`:747-751`).
  - `zcode-kit` spawns `manager stop` (`cli/zcode-kit.mjs:1034`).

  If `killOwned` becomes graceful, the golden-path "crash" scenario turns into a graceful stop. That caller needs an explicit "force" variant.
- **What the proxy does on a signal** (`zcode-proxy-src/src/index.ts:304-317`). The `stop()` function stops the claim scheduler, runs `shutdownCaptchaRuntime()`, then `flushAccountMetadata(auth)` (deadline 3 s, `:321-330`), then `server.stop(true)`. `server.stop(true)` is `server.close()` plus an **immediate `process.exit(0)`** (`server/server.ts:280-283`). There is no drain on SIGTERM today: the process exits right after the flush. `SIGINT` prints "Shutting down..." and then calls the same `stop()` (`index.ts:313-316`).
- **How the proxy is spawned.** `spawn(bun, ["run", …/src/index.ts, "serve"], { detached: true, stdio: ["ignore", out.fd, out.fd] })` (`zcode-proxy-manager.mjs:585-592`). `windowsHide` is not set and there is no `ipc` stdio. The manager then `unref`s the child and exits. A later `stop` runs in a different process.

### 1.2 Does the proxy already have a control port, admin endpoint or IPC?

- **The serve path has none.** The only listener is the API server (`server/server.ts:209-288`). It binds loopback only and refuses to start without a real key (`:214-227`, ZAK-002). Every route except `GET /webui*` and `OPTIONS` requires `Authorization: Bearer <proxyApiKey>` (or `x-api-key`), checked with a constant-time comparison (`:97-102`, `checkProxyKey` `:371-…`). The routes are `/v1/*`, `/quota`, `/accounts/*`, `/async/v1/*` and `/health` (`:107-197`). An unknown route returns `404 not_found_error` (`:197`). Before that, the Host header must be a loopback host (`:70-73`, 421), and a browser `Origin` is checked (`:75-78`).
- **The Android entry has a control listener.** It exists only under `zcode-proxy android` (`index.ts:355-497`) and is **not used by `serve`**. `android/control.ts:151-180` binds `127.0.0.1`, re-checks `remoteAddress` (`:227-229`) and serves only `POST /control`. Every command except `status` needs a per-launch capability header `x-zcode-control-capability`, compared with `timingSafeEqual` (`:248-253`, capability from env `ZCODE_CONTROL_CAPABILITY`, `index.ts:466`). It has a `shutdown` command (`control.ts:45`, hook `index.ts:478-482`). This is the repo's existing pattern for an authenticated loopback lifecycle request.
- **IPC to the manager is impossible.** The manager that spawned the proxy exits after `start` (`child.unref()`, `:599`). `stop` is a new process that has no handle to the proxy. A Node `ipc` channel would need the spawner to stay alive. A named pipe in the proxy would be a new listener (new surface).
- **The bearer key is not manager-only.** `.proxykey` is written into harness configs: `cli/adapters/aider.mjs:25` (`.env`), `cli/adapters/claude-code.mjs:37` (settings), and `cli/adapters/continue.mjs:4,148` (a quoted literal key). A shutdown route behind the bearer key alone lets **every client that holds the key** stop the proxy. That still satisfies C6 (authenticated, loopback), but it widens who can stop the proxy, from the lifecycle owner to every harness.

### 1.3 Windows signal semantics (external)

- **Node/libuv `process.kill` on Windows.** "Sending `SIGINT`, `SIGTERM`, and `SIGKILL` will cause the unconditional termination of the target process". "`'SIGTERM'` is not supported on Windows, it can be listened on". "`'SIGBREAK'` is delivered on Windows when Ctrl+Break is pressed". Sources: https://nodejs.org/api/process.html (v26.13.0 docs, "Signal events" and `process.kill`) and libuv guide https://docs.libuv.org/en/v1.x/guide/processes.html ("all of SIGTERM, SIGINT and SIGKILL, lead to termination of the process"). The libuv source maps all three to `TerminateProcess(process_handle, 1)` (https://github.com/libuv/libuv/issues/1133, quoting `src/win/process.c`). Bun's `ChildProcess.kill` reference says the same: "On Windows … the signal argument will be ignored, and the process will be killed forcefully and abruptly" (https://bun.com/reference/node/child_process/ChildProcess/kill). **So `process.kill(pid,'SIGINT')` from the manager cannot trigger the proxy's handler on Windows. It is a hard kill.**
- **How the detached proxy is created on Windows.** libuv with `UV_PROCESS_DETACHED` sets `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` (libuv `src/win/process.c`, quoted at https://grep.metacpan.org/search?f=libuv-1.49.2%2Fsrc%2Fwin%2Fprocess.c&q=daemonize). `DETACHED_PROCESS` means that "for console processes, the new process does not inherit its parent's console". `CREATE_NEW_PROCESS_GROUP` means that "CTRL+C signals will be disabled for all processes within the new process group" (https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags).
- **Console control events.** `GenerateConsoleCtrlEvent` "sends a specified signal to a console process group that shares the console associated with the calling process … Only those processes in the group that share the same console as the calling process receive the signal" (https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent). The proxy has **no console**, so neither CTRL_C nor CTRL_BREAK can reach it from a later `stop` process.
- **Bun on Windows.** `SIGHUP`/`SIGBREAK` handlers fire on console close and Ctrl+Break, since Bun v1.3.3, #24704 (https://bun.com/blog/bun-v1.4, 2026-08-20). Both are console events, so neither applies to a console-less detached proxy. There is also a known Windows issue where a `SIGINT` handler is aborted mid-run under `bun run <script>` (https://github.com/Hona/bun-sigint, which cites oven-sh/bun #11400, #13040, #15878). The 1.4 notes say nested `bun run` now waits for the script's cleanup (#36711, same blog).
- **Verdict.** On Windows, no signal or console-event mechanism exists that a separate `stop` process could use to run the proxy's shutdown code. Any graceful stop needs a channel the proxy reads itself.

### 1.4 Options compared

| Option | New surface | Old proxy (after update) | Notes |
|---|---|---|---|
| **A. Authenticated request on the existing loopback listener** (e.g. `POST /…/shutdown`) | One route on an existing listener. No new port, file or thread. | Answers `404 not_found_error` (`server.ts:197`). The manager can fall back to `TerminateProcess` at once. | Bearer alone widens the stop authority to every key holder (§1.2). Adding a per-spawn capability header (the `control.ts:248-253` pattern) closes that gap. The capability is passed via `ZCODE_KIT_*` env, which `proxyEnv` does not strip (`lib/proxy-env.mjs:21`), and recorded in `logs/proxy.pid` (written `0600`, `:161-166`; old readers read only `pid/startedMs/startedIso`, `:141-149`, so the extra field is additive). Q1 cond 2 keeps the listener open during the drain, so the route can answer 202 and then drain. A hung main thread never answers, so the existing `TerminateProcess` path stays as the fallback after the shared grace. |
| B. Stop-request file in `logs/` | Polling timer or `fs.watch` in the proxy, plus a file-format contract. | Ignored. The fallback only fires after the full grace. | A stale file after a crash could stop the next proxy (needs a pid+start-time binding). Polling adds latency and wake-ups. No network surface. |
| C. IPC / named pipe | A new listener (pipe server) or a long-lived parent. | Not possible. | Not viable without new surface (§1.2). |
| D. Signals / console control events | None. | n/a | Impossible on Windows (§1.3). |

**Recommendation for 1: A.** Use one authenticated route on the existing loopback listener. It needs the bearer key **plus** a per-spawn stop capability (`timingSafeEqual`, as in `control.ts`). The manager sends it only after the existing identity proof (`healthIdentify` + `verifyOwnProcess`). It then waits for exit for the shared grace and falls back to the existing handle-checked `TerminateProcess`. A 404 (old proxy), 401/403 or a timeout goes straight to the fallback. POSIX keeps SIGTERM, and the same request can optionally be used there too. This adds the least new surface: no new port, no file watcher, no IPC. If the capability is dropped, the residual risk is that any harness holding the key can stop the proxy. That is a decision for the spec, not a C6 violation.

### 1.5 Shared-deadline inputs (Q1 cond 3)

| Constant | Value | Location |
|---|---|---|
| Manager SIGTERM→SIGKILL grace | 5 s | `zcode-proxy-manager.mjs:421` |
| Manager post-SIGKILL wait | 5 s | `zcode-proxy-manager.mjs:424` |
| Memory-restart force exit | 10 s | `index.ts:267` |
| `server.close()` race (memory path) | 6 s | `index.ts:271` |
| `flushAccountMetadata` deadline | 3 s | `index.ts:321` |
| Respawn wait for the old pid | 30 s | `respawnWaitMs`, `zcode-proxy-manager.mjs:51,830` |
| Watchdog hook acknowledgement | 2 s | `watchdog.ts:198` |
| Memory hook launch acknowledgement | 5 s | `watchdog.ts:128` |

---

## 2. Restart handoff (proxy hook ↔ manager `respawn`)

### 2.1 The sequence today, memory path

1. `MemoryGuard.sample()` (`runtime/health-monitor.ts:244-281`) checks soft 1536 / hard 3072 MB × 3 samples, at a 60 s interval (`:224-227`). After a solver recycle, if the RSS stays hard it calls `canRestart()`, which is `respawnHookCommand(...) !== null` (`index.ts:257`). It then sets `restartPending` and calls `opts.restart()`.
2. The `restart` closure (`index.ts:258-275`) awaits `spawnRespawnHook("memory")` (`watchdog.ts:122-131`). That calls `respawnHookCommand`, which builds `node <manager> respawn <pid> --reason memory` (`watchdog.ts:72-81`). `launchRespawnHook(spawn, hook, env, 5000)` spawns it `detached`, `stdio:"ignore"`, `windowsHide` and resolves **`{ok:true}` on the child's `spawn` event** (`watchdog.ts:94-115`, `:108`). The hook's stdout, stderr and exit code are never observed.
3. On `true`, the proxy **starts exiting immediately**. In order: claim scheduler stop, `shutdownCaptchaRuntime()`, a `forceExit` 10 s timer, `Promise.race([server.close(), 6 s])`, then `flushAccountMetadata` (3 s), then `process.exit(0)` (`index.ts:264-273`). `server.close()` stops accepting connections at once, so new connections are refused rather than answered with 503. This bears on Q1 cond 2.
4. The manager process (`zcode-proxy-manager.mjs:1234-1237` → `respawn()` `:815-839`) does the following:
   - Logs `respawn: requested for pid P (reason R)` (`:822`).
   - Checks that the pid matches the pid file (`:823-826`). If not, it refuses with exit 4.
   - **Reserves the budget with `reserveRespawn(pid, why)` (`:827`, implementation `:782-813`).** This takes an exclusive `logs/respawn.lock` (`wx`, 20 × 100 ms retries, `:785-793`). It reads `logs/respawn.json` and treats missing as empty and corrupt as a refusal (`:758-772`). It counts events younger than `RESPAWN_WINDOW_MS` (15 min) against `RESPAWN_LIMIT` (3) (`:44-45, :797-799`). It **records the slot immediately**, `{at, pid, reason}` via temp+rename (`:800-807`). The slot is consumed even if the later start fails.
   - On refusal: `refuse()` logs, writes `heal.log` `cause=respawn result=refused`, and exits 4 (`:817-821, :828`). **The proxy is already draining at this point, so the result is zero proxies.** This is the C1 hole in Q1 cond 1.
   - On success: it logs `respawn: waiting up to 30s for pid P to exit` (`:829`), runs `waitForExit(pid, 30 s)` (`:830`), then `start({ onlyIfRecord: recorded })` (`:835`). `start` re-checks the record under the start lock (`:543-548`). If the old pid is still alive, the hung-own proof decides (`:549-565`). If something healthy already answers as "ours", start returns 0, "already running" (`:540-541`, `preStartVerdict` `:484-487`).

### 2.2 Watchdog path

The eval'd worker detects a frozen heartbeat (`watchdog.ts:165-181`) and writes `[watchdog] …` with `writeSync(2, …)` (`:171`). It launches the same hook with `hookAckMs` 2 s and then **SIGKILLs itself regardless of the outcome** (`:173-180`). A hung proxy cannot wait for a reservation anyway. If the budget is refused, the result is zero proxies, but the alternative would be a hung proxy that serves nothing either.

### 2.3 Cross-version meetings

`ZCODE_KIT_RESPAWN_MANAGER` is the manager's **file path** (`:43, :589`). An update replaces that file in place, so a running proxy always executes whatever manager file is at the path now.

- **Old proxy → new manager** (the common case after an update). The old proxy passes `respawn <pid> --reason <r>` with `stdio:"ignore"` and drains on `spawn`. The new manager must keep accepting those exact arguments (Q11 cond 1). Any acknowledgement it emits goes nowhere, and a refusal still yields zero proxies until that old proxy is gone. This cannot be fixed from the manager side.
- **New proxy → old manager** (rollback or downgrade). The old manager writes no machine acknowledgement. It does reserve and record before it starts anything, and on refusal it exits 4 without writing a `respawn.json` event.

### 2.4 What "budget acknowledgement before drain" needs on the wire

The proxy must learn **reserved** or **refused** before step 3. Ways to carry that answer:

| Option | Mechanism | Works with old manager? | Risk |
|---|---|---|---|
| a. Child exit code + pipe | Spawn the hook with a piped stdout and wait for a line. | Old manager prints the human line `respawn: waiting up to …` only after a successful reservation, and `respawn refused: …` / `respawn: refused — …` plus exit 4 on refusal (`:822-830`). | **EPIPE hazard:** the manager keeps calling `console.log` (`logLine`, `:90`) after the proxy exits and closes the pipe read end. An unhandled stdout `error` can crash the manager in the middle of `start()`. The ack channel must be closed or redirected right after the ack, and parsing human text is fragile. |
| b. File acknowledgement | Proxy polls `logs/respawn.json` for an event with `pid === process.pid` and `at >= requestTime`. | Yes: the old manager writes exactly that event at reservation time (`:802-803`, atomic rename). Refusal shows up as the hook process's `exit` code 4 with no event, or as a timeout. | The proxy needs the logs dir. Today it only gets `ZCODE_PROXY_CONFIG` = `<state>/proxy/config.yaml` (`lib/proxy-env.mjs:23`, `cli/context.mjs:29-31`). Q4 needs a log-dir env for the proxy anyway, and `ZCODE_KIT_*` survives `proxyEnv`. |
| c. New flag (e.g. `--ack`) | New manager arguments. | No: an old manager has no such flag. | Breaks the Q11 cond 1 pin on the arguments, so it is not recommended. |

**Required semantics, independent of the channel.** Reservation is still recorded at reservation time (`:802`). On "refused" or "no answer within T", a new proxy keeps serving and logs WARN (Q1 cond 1). If the hook exits 4 after reserving, the slot is consumed and nothing restarts. Today's `start` with a healthy "ours" answers 0, "already running", so a manager that reserves but finds the proxy still serving is harmless. The manager's `waitForExit` 30 s must exceed the proxy's drain+flush cap (10 s).

---

## 3. `proxy.log` writers and readers

### 3.1 Every place that touches the file

| Who | Operation | Where |
|---|---|---|
| Manager `logLine` | `appendFileSync(LOG_FILE, "[manager ISO] msg\n")`: open, append, close per line, by path | `zcode-proxy-manager.mjs:89-95` |
| Manager `rotateLogIfNeeded` | size > 5 MB (`MAX_LOG_BYTES`, `:69`) → unlink `proxy.log.1`, rename `proxy.log` → `proxy.log.1` | `:97-105`; only caller is `start()` `:503` |
| Manager `openLogStream` | `openSync(LOG_FILE, "a", 0o600)`, passed as the child's **stdout and stderr** (`stdio:["ignore", fd, fd]`); manager closes its copy after start | `:431-435, :581, :591, :615-644` |
| Proxy (bun) | Everything on fd 1/2: `console.*`, Bun's own crash/uncaught output, unhandled rejections | The inherited handle |
| Proxy watchdog worker | `writeSync(2, "[watchdog] …")` from a worker thread, bypassing `console` | `watchdog.ts:171, :178` |
| Solver worker | `fs.writeSync(2, "[captcha-guest-error] …")` | `proxy/captcha-solver-worker.ts:48` |
| Manager `logs [n]` | `openSync(LOG_FILE,"r")`, reads the last ≤ 64 KB; reads `proxy.log` only, never `.1` | `:1184-1201`; CLI forward `cli/zcode-kit.mjs:728-733` |
| Golden path | `readFileSync(logs/proxy.log)` when `manager start` ≠ 0, then regex-classifies the failure (ModuleNotFound, EADDRINUSE, `exited immediately \(code N`, SyntaxError…) | `scripts/verify-golden-path.mjs:245-253` |
| Docs and messages | "inspect logs/proxy.log" | `cli/heal.mjs:50, :80`; `zcode-proxy-manager.mjs:799` |
| Tests | Copy and migrate the file only (fixture content); no runtime writers or readers | `tests/installer-audit.test.mjs:219,237,318,328`, `tests/state-audit.test.mjs:81,98`, `tests/update.test.mjs:204,230` |
| TUI | Tees to `ZCODE_TUI_LOGFILE` only, which the kit never sets (`git grep` finds only the reader) | `tui/app.ts:116-121` |

### 3.2 How start-failure output reaches the log today

The child's stdout and stderr are the `proxy.log` handle, so Bun's own errors land in it directly: module-not-found, parse errors, and the uncaught handler `index.ts:73`. `serve()` is called without `await` or `catch` (`index.ts:127`), so a bind error from `startServer` (`server.on("error", reject)`, `server.ts:273`) surfaces as an unhandled rejection on stderr, and the process exits.

The manager adds its own lines through `logLine`, which also writes to `proxy.log`:

- `ERROR: proxy exited immediately (code N). See …` (`:619`). The golden path parses this line for the exit code.
- `ERROR: proxy did not become healthy within …` (`:641`).
- `ERROR: failed to spawn bun …` (`:595, :613`).

### 3.3 A live-proxy divergence bug that exists today

`startupPreflight` calls `manager.start()` on **every** harness launch (`cli/heal.mjs:70-75`). `start()` rotates (`:503`) **before** it checks health (`:506`). With a healthy proxy running and `proxy.log` > 5 MB, this happens:

1. The rename moves the file the running proxy still holds.
2. The proxy's output then goes into `proxy.log.1`, while new manager lines go into a fresh `proxy.log`.
3. The next rotation unlinks `proxy.log.1`, the file the proxy is writing into. From then on, proxy output is lost until the proxy restarts.

This happens on POSIX and, with share-delete handles, on Windows too. The Q4 rule "no line is ever lost" therefore requires that `start()` no longer rotates while a proxy holds the file, or that rotation moves into the proxy's writer only.

### 3.4 Windows rename and unlink of an open file (external)

- **Node/libuv opens every file with `FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`**, except under `UV_FS_O_EXLOCK`, "to match UNIX semantics. In particular, this ensures that the file can be deleted even whilst it's open". libuv **unlink** uses `FILE_DISPOSITION_DELETE | FILE_DISPOSITION_POSIX_SEMANTICS`, so the name disappears immediately even while handles are open. Source: https://github.com/libuv/libuv/blob/v1.51.0/src/win/fs.c (`fs__open`, `fs__unlink`). This covers the manager's `appendFileSync`, `openSync("a")` (and so the inherited child handle), `openSync("r")` in `logs`, and the golden-path `readFileSync`.
- **Bun opens Windows files via `NtCreateFile` with `sharing_mode` defaulting to the constant `FILE_SHARE`** (`NtCreateFileOptions`). The commented-out mapping beside it is `share = if (EXLOCK) 0 else FILE_SHARE`, mirroring libuv. Source: https://github.com/oven-sh/bun/blob/bun-v1.3.14/src/sys/sys.zig. The constant's definition was not visible in the excerpt. Indirect confirmation comes from a Bun collaborator on oven-sh/bun #40001 (2026-08-21): "an ordinary open file handle does not block deletion here — I verified that separately with plain `fs.openSync` … under both runtimes" (https://github.com/oven-sh/bun/issues/40001). **Status: very likely share-delete. The Q4 windows-latest test is the proof.**
- **Bun rename on Windows** goes through `bun.windows.renameAtW(…, true)` (same sys.zig). The `true` is presumably replace-if-exists. Whether it uses POSIX rename semantics was not confirmed.
- **Windows rule.** A rename requires DELETE access on the source, which is checked against the share access of all existing opens. So **every open handle must include `FILE_SHARE_DELETE`**, or the rename fails with a sharing violation or access denied (Eryk Sun, https://stackoverflow.com/questions/49107689). A replace-over-target with legacy `MoveFileEx` also fails while the *target* is open; POSIX-semantics rename tolerates share-delete opens (https://sqlite.org/forum/forumpost/7466a45cc7; https://github.com/fhaze/kitsu/issues/189).
- **Implications for the Q4 writer:**
  1. Unlink `proxy.log.1` first. With POSIX delete the name is free at once, even if a reader holds `.1`. Then rename `proxy.log` → `.1`. That target no longer exists, so the replace-target caveat does not apply.
  2. All kit readers and writers are libuv or Bun handles with share-delete, so the rename succeeds while they are open.
  3. Handles the kit does not own may lack `FILE_SHARE_DELETE` (editors, AV, indexer, other tail tools), and then the rename fails. Q4 cond 1 already specifies the right behaviour: keep appending and retry at the next check. The overshoot must be bounded for S7.
  4. After a rename, every handle opened earlier, including the proxy's inherited fd 1/2, **keeps writing into the renamed file**. The writer must reopen `proxy.log`, and fd 1/2 must not keep pointing at `proxy.log`. That is why Q4 sends early stdio to a separate early file.
  5. Use plain fd writes (`fs.writeSync` / `appendFileSync`) for the writer. Bun had a Windows handle leak on `FileHandle.createWriteStream` + `close` that made a later `rename` fail with EPERM (oven-sh/bun #32829, closed 2026-07-24, https://github.com/oven-sh/bun/issues/32829).

### 3.5 Consequences for the early-output file

- The watchdog's `[watchdog] main thread unresponsive …` and `respawn hook failed` lines are written from a worker thread straight to **fd 2** (`watchdog.ts:171,178`). Once fd 1/2 point at the early file, these lines land there, not in `proxy.log`.
- The watchdog exit is a self-SIGKILL. The process that would copy the early file's tail is the **respawn manager**, not `start()`'s "exited immediately" path, so the copy contract must cover the respawn path as well as start failure and crash.
- The golden-path classifier reads only `proxy.log`. Its patterns need the copied tail, or the classifier must also read the early file (an additive change).

**Recommendation for 3.** The proxy opens and rotates `proxy.log` itself and is the **single rotator**. The manager's pre-spawn `rotateLogIfNeeded` is dropped, or limited to "no live recorded proxy". The manager keeps per-line append by path. `logs N` reads `.1` + current. Rotation is unlink `.1` → rename → reopen; on failure, keep appending and retry. The early file is truncated at each start, and its bounded tail (64 KB) is copied into `proxy.log` by whichever manager observes the exit (start-failure path **and** respawn path). The windows-latest test opens a Node reader and a manager append during rotation.

---

## 4. Does the SharedArrayBuffer heartbeat/eval watcher survive moving the solver out of process?

**Yes, unchanged in mechanism.**

- **Independent of the solver.** The heartbeat is `setInterval(() => Atomics.add(beat,0,1), 250)` on the proxy main thread over a 4-byte SAB (`watchdog.ts:200-203`). The watcher is a separate eval'd `node:worker_threads` worker that reads it with `Atomics.load` (`:159-167`, created `:204-207`). It shares nothing with the solver. The solver today runs on its own `Worker` (`proxy/captcha-solver.ts:174-175`) with its own sync-fetch SAB (`captcha-happy.ts:102-123`), and both move with the solver. Nothing in `installWatchdog` imports or references captcha code. `health-monitor.ts` imports only a type (`:17`).

Caveats for the spec:

1. **Solver orphans.** The watchdog kills only the proxy (`process.kill(process.pid,"SIGKILL")`, `watchdog.ts:164`). An out-of-process solver survives that kill unless the Round 1 Q3 cond 2 reaping is in place: a Windows Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and IPC-EOF exit on POSIX (`DECISIONS.md:49`). The required "SIGKILL the proxy → 0 solver processes" test covers this path. Bun's `--no-orphans` uses the same kill-on-close Job Object approach on Windows (https://bun.com/blog/bun-v1.4, PR #34768), as a reference.
2. **Hook environment in the child.** `spawnWorker` passes the full env (`captcha-solver.ts:175`). A solver child must not run `installWatchdog` or the respawn hook. A child calling `respawn <childpid>` is refused, because its pid is not recorded (`zcode-proxy-manager.mjs:824-826`), but strip `ZCODE_KIT_RESPAWN_*` from the child or never import `index.ts`'s serve path there.
3. **Lines bypass the writer.** Watchdog lines bypass the Q4 writer (fd 2), see §3.5.
4. **Watchdog scope.** The original trigger, the solver parking the main thread (`watchdog.ts:4-10`), was already removed by the worker move. The watchdog stays relevant for other main-thread hangs. A hang in the solver child is Q2's deadline kill, not the watchdog's.
5. **Compile constraints unchanged.** The watcher needs no extra `bun build --compile` entrypoint (`watchdog.ts:13-15`). The solver child's entrypoint and compile constraints are a separate concern: compiled binaries ignore `-e` (`:18-20`).

---

## 5. MCP task text: `accumulatedText` and `completeness`

- **Producer.** `TaskIngress.ingressDerived` appends every `model.streaming` `text_delta` (`p.text ?? p.delta`) to `t.accumulatedText`, with no bound (`mcp/zcode-harness-mcp/src/tasks/ingress.ts:132-137`, field `:40`). It is initialised to `""` (`tasks/manager.ts:188`) and reset at each follow-up dispatch (`:503`). **It is in memory only.** After a bridge restart, `internalFromRecord` sets it to `""`.
- **Consumer, the only one.** `buildResult` (`manager.ts:597-689`):
  - `let responseText = t.accumulatedText` (`:612`).
  - Initial completeness (`:613-615`): `full` / "turn stream captured via session events" only if the text is non-empty and the state is `completed`. Otherwise `unknown` / "no completed assistant response has been captured".
  - **Transcript fallback** (`:616-635`), only when `responseText` is empty: reads `ipcSessionTranscript`, joins the last assistant message's text parts, and sets `full` / "response recovered from stored transcript" if the state is `completed`. A read error gives `unknown` / "transcript read failed: …". This text is also unbounded.
  - Event-gap warning (`:637-639`) → `partial` / "session events were lost; captured output may be incomplete".
  - State `failed|cancelled|interrupted|unknown` (`:640-642`) → `partial` / "task ended in state X". This is the last word and overrides earlier settings.
  - The result carries `responseText`, **`partial: completeness.status !== "full"`** (`:666`) and `completeness` (`:667`). Type: `completeness: { status: "full"|"partial"|"unknown"; explanation: string }` (`:81-83`).
- **Semantics of `completeness` today.**
  - `full`: a completed turn with captured or recovered text.
  - `partial`: lost events or a non-success terminal state.
  - `unknown`: no text captured, or the transcript read failed.

  `partial` is the boolean mirror (`unknown` also gives `partial: true`). Truncation of a completed task is a new reason for `partial` with an explanation. `partial: true` then follows automatically, and the Round 2 Q3 cond 4 additive `truncated` marker comes on top. Order matters: the terminal-state override (`:640-642`) runs last, so the truncation explanation must be combined with it or applied after it.
- **Exposure.**
  - The tool `zcode_task_result` returns `buildResult` verbatim (`src/mcp/tools.ts:869-884`). Its description says "final response text (clearly marked partial when incomplete) … completeness" (`:872`).
  - The resource `zcode://tasks/<id>/result` returns `safeJsonStringify(buildResult)` (`src/mcp/resources.ts:61-62`).
  - The documented shape is in `docs/MCP_API.md:70-90` (German text: "`partial:true`/`completeness.status:"partial"` kennzeichnet Teilergebnisse klar").
  - Example consumer: `examples/demo-client.mjs:191-193`.
  - Test assertions: `test/integration/security-audit.test.mjs:170-172` (`full`, `/transcript/`) and `test/live/live.test.mjs:85` (`partial`).
  - No kit code outside the bridge reads these fields (`git grep`).
- **Persistence.**
  - Terminal results are written to `tasks/<id>.result.json` via `writeJson` (atomic, **no size cap**, `src/store/store.ts:47-60`; `manager.ts:685-687`). They are served from that cache when status and `finishedAt` match (`:605-607`), so result files written before the change keep their untruncated text.
  - Events (each delta's payload) go to `tasks/<id>.events.jsonl` via `appendLine`. That is already bounded: a record over 4 MiB becomes `bridge.record_truncated`, and the file rotates to `.previous` at 4 MiB (`store.ts:71-84`). The existing 4 MiB constants are in `store.ts:75,91` and the HTTP body limit in `mcp/server.ts:141`.
- **Build note.** `mcp/zcode-harness-mcp/dist/` is tracked (23 files; `dist/tasks/manager.js:548-604` mirrors `buildResult`). `npm test` runs `tsc` first (`package.json:14,18`). Any change must regenerate `dist/`.
- **Open item for the spec (branch 6).** Which part of the text to keep (head, tail, or head+tail with a marker). The cap should apply to the final `responseText` from either source (stream or transcript fallback). The 4 MiB cap is in UTF-16 code units versus bytes. `appendLine` measures bytes (`Buffer.byteLength`).
