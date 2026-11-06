# Architecture survey (Phase 1D): deepening candidates

- Date: 2026-11-06. Scope: branch `overhaul/stability-terminal-ux` at `/home/AgentKit/wt/overhaul` (origin/main 9e45d05 plus overhaul docs), read-only.
- Skill: `/improve-codebase-architecture`, steps 1 and 2 only. No grilling loop: the Owner Proxy picks candidates.
- Explorer: the roster asked for glm-5.3-flash. This run used claude-opus-5-5 as the logged substitute.
- HTML report (self-contained, Tailwind + Mermaid via CDN): `/tmp/architecture-review-20261106T022523Z.html`. It was not opened, because the session is headless.
- Vocabulary comes from `/codebase-design`: module, interface, implementation, depth, seam, adapter, leverage, locality.
- Domain names come from the code, because the repo has no `GLOSSARY.md`: proxy, kit manager, start lock, pid record, hung-own proof, respawn budget, captcha solver, solver generation, recycle, token pool, preflight, harness, MCP bridge, task, doctor checks, connection details.
- There are no ADRs (`docs/adr/` is missing), so no candidate contradicts a recorded decision.
- One code-level invariant matters: AUD-001, "no automatic stale-lock takeover" (`proxy/zcode-proxy-manager.mjs:437-442`). It is flagged on candidate 2.

## Hot spots

Last 60 commits, counting files only. Docs, translations, release bumps and `dist/` are excluded.

| File | Commits |
|---|---|
| `cli/zcode-kit.mjs` | 12 |
| `zcode-proxy-src/src/proxy/upstream-errors.ts` | 11 |
| `zcode-proxy-src/src/proxy/handler.ts` | 9 |
| `zcode-proxy-src/src/index.ts` | 8 |
| `upstream-errors-pool.test.ts` | 8 |
| `proxy/zcode-proxy-manager.mjs` | 5 |
| `ordered-transport.ts` | 5 |
| `auth/manager.ts` | 5 |
| `auth/account-store.ts` | 5 |
| `cli/harness-consent.mjs` | 5 |
| `lib/proxy-env.mjs` | 5 |
| `captcha-happy.ts` | 4 |
| `captcha.ts` | 4 |
| `account-rotator.ts` | 4 |

Some of these are anti-abuse files (B1). For them, only resource-lifecycle candidates are listed.

## Evidence used

- `reports/memloop-S1-*.log`: proxy peak 1618.9 MB at burst32 (RED). bigbody 320 MB (RED). Steady 3000 requests: growth 6.42 %/1k (RED).
- `reports/memloop-S2-short.log`:
  - solver retained 686 MB before recycle (budget 300);
  - scenario peak 1068.9 MB;
  - CDN cache memory growth 151 MB (budget 64);
  - RSS climbs about 4 MB per solve until the 200-solve recycle.
- `reports/memloop-S3-short.log`, kill-holder round:
  - 7/10 launches failed;
  - a stale lock was left;
  - kit-side peak 852 MB, of which preflight processes are about 70 MB each and MCP bridges about 86 MB each.
- `reports/memloop-S4-short.log`: stale lock after Ctrl-C in 5 of 8 cycles.
- `ux/before/doctor/*/pipe.txt`: doctor prints the 13 manager checks twice, with a premature summary line in between.
- `ux/before/tui/live/{no-color,term-dumb,ascii-locale}.ansi`: 18 escape sequences and `╭` box glyphs in every variant.
- `research/bun.md` §2-§4:
  - no in-process hard cap for a Worker or the heap;
  - `terminate()` is asynchronous and "experimental";
  - open leak #46669;
  - `memoryFootprint()` should replace RSS;
  - the per-OS options for capping a separate process.
- `research/happy-dom.md` §5: the teardown is correct. The gap is that interceptor fetches survive `close()`.
- `research/undici-yaml.md` §5: candidate #14 (drain wait with no close race) and #15 (tee buffering).
- `research/terminal-conventions.md`: colour precedence, the full/wgl4/ascii glyph tiers and the width.ts grapheme gaps.

---

## Candidate 1: Put the captcha solver behind a transport seam, in its own capped process

**Strength:** Strong. **Serves:** goal 1, and goal 2 because the interface is unchanged. **Dependency category:** ports & adapters (a local process the kit owns, reached by IPC).

**Files:**
- `zcode-proxy-src/src/proxy/captcha-solver.ts`:
  - the dispatcher: queue, deadline, recycle reasons, stats;
  - `spawnWorker` at :174;
  - `recycle` at :203;
  - module-level singleton state and `configureCaptchaSolver`.
- `zcode-proxy-src/src/proxy/captcha-solver-worker.ts`: the init/solve/result/fatal protocol.
- `zcode-proxy-src/src/proxy/captcha-happy.ts`: the nested sync-fetch worker at :41-157. It stays inside the solver.
- `zcode-proxy-src/src/runtime/health-monitor.ts`: the MemoryGuard soft-limit recycle.
- `zcode-proxy-src/src/index.ts`: warmup and shutdown.
- `zcode-proxy-src/package.json`: the compile entrypoints.
- `proxy/zcode-proxy-manager.mjs`: the spawn env.
- Tests: `captcha-solver.test.ts`, which goes through the `backendModule` fixture `__fixtures__/solver-backend.ts`. `captcha-pool.test.ts` uses `mock.module("./captcha-solver.js")`.

**Problem:**
- The happy-dom solver runs as a Bun `Worker` in the proxy's address space.
- Bun 1.4.4 cannot cap a Worker or a JS heap. `resourceLimits`, `--max-old-space-size` and `smol` are not caps (bun.md §4).
- A solver generation is therefore bounded only by in-process heuristics:
  - 200 solves;
  - 3 failures;
  - `heapUsed` > 768 MB, which lags and leaves out native memory (bun.md §3);
  - 10 min idle;
  - a 90 s deadline.
- MemoryGuard watches the whole process RSS.
- S2 measured 686 MB retained before a recycle, and peaks near 1 GB per generation.
- `terminate()` is asynchronous, so the old and new generations can overlap (about 2x peak). Open bug #46669 can leave a spinning thread after termination.
- Charter C1: "a separate process with a hard cap beats an in-process heuristic".

**Solution:**
- Keep the dispatcher's interface: `runCaptchaSolve`, stats, recycle request and shutdown, as consumed by `captcha-pool.ts`, `captcha.ts` and `health-monitor.ts`.
- Keep the existing message protocol.
- Move the transport behind an internal seam with two adapters:
  - a **child-process adapter**: the same solver entry started as an OS process under a hard memory cap. Linux: a cgroup or a `systemd-run --user` scope. Windows: a Job Object with `JOB_OBJECT_LIMIT_PROCESS_MEMORY`. macOS: sample `memoryFootprint()` and kill.
  - the existing **thread adapter**, kept for tests and as a fallback.
- An OOM kill shows up as the existing "exit" path, which recycles and starts a new generation.
- The dispatcher's module-level state becomes an instance owned by the deep module, so tests can build it with an in-memory adapter.

**Benefits:**
- Locality: every solver lifecycle rule (spawn, deadline, recycle, cap, kill) lives in one module.
- Leverage: the token pool, handler and health output do not change.
- When the cap is hit, the OS reclaims everything: happy-dom state, guest timers, the sync-fetch worker and leaked JIT threads.
- Tests cross the dispatcher's interface with an in-memory adapter instead of a real Worker plus `mock.module`.
- MemoryGuard no longer needs to recycle the solver, so its job becomes "growth outside the solver" (see candidate 5).

**Risks to grill:**
- Windows Job Objects need FFI or a small helper, because Bun has no built-in support for them (bun.md).
- The compiled-binary entry for the child process (a self-exec subcommand, never `-e`).
- Startup latency per generation.
- Proof that the behaviour is the same: identical token validation, SDK script fingerprints and env passthrough.

**B1:** in scope. Process and worker isolation and hard caps are named in §5. Solve behaviour, fingerprint values, one-solve-at-a-time and token validation must stay byte-identical.

---

## Candidate 2: Deepen the kit manager into one proxy lifecycle module

**Strength:** Strong. **Serves:** goals 1, 2 and 3. **Dependency category:** local-substitutable (filesystem, process table). `createManager` already accepts injected `processStartMsImpl`, `processCommandLineImpl`, `bunResolver` and timings.

**Files:**
- `proxy/zcode-proxy-manager.mjs` (1248 lines). Lifecycle and presentation are mixed in one factory that returns 20 members:
  - the start lock at :443-479;
  - `start` at :502;
  - `stop` at :652;
  - `killOwned` at :375;
  - `proveHungOwn` at :294;
  - the respawn budget at :758-839;
  - status, doctor, logs and connection-detail printing.
- `cli/heal.mjs`: `startupPreflight`, an in-process dedupe Map that imports the whole manager.
- `cli/launch.mjs`.
- `cli/account-setup.mjs`: `restartForAccountChange` re-derives state from `healthIdentify`, `readPidFile` and `pidAlive`.
- `cli/zcode-kit.mjs`: setup imports the manager; doctor `--fix` imports it and spawns it; status, proxy and update use `spawnSync` of the manager CLI.
- `proxy/zcode-proxy-autostart.ts`: `execFile` of `heal.mjs`, with exit codes mapped 3 → foreign and 5 → key.
- `zcode-proxy-src/src/runtime/watchdog.ts`: the respawn CLI hook.
- `lib/process.mjs`.

**Problem:**
- Lifecycle knowledge leaks across the manager's interface. Callers reach it in three ways:
  - a CLI subprocess, decoded by exit codes 0-5 and text;
  - an in-process import that re-implements state decisions from internals;
  - an `execFile` of the preflight.
- The start lock is never taken over, and is never released by the OS when the holder dies. A crashed or Ctrl-C'd holder blocks every later start until someone removes the file by hand:
  - S3 kill-holder: 7/10 launches failed;
  - S4: a stale lock after Ctrl-C in 5 of 8 cycles.
- Each preflight imports the full manager and its presentation modules. S3 measured about 70 MB per preflight process, times N harness launches.

**Solution:**
- One deep lifecycle module. Its interface is the lifecycle intents:
  - ensure running;
  - stop;
  - restart;
  - respawn request (budgeted);
  - read state (identity + pid record).
- Each intent returns an outcome record and prints nothing.
- The start lock moves to a mechanism the OS releases on holder death, or one whose staleness is provable from pid plus recorded start time, reusing the existing PID-reuse guard. Takeover never deletes a live contender's lock.
- Every caller uses this interface: CLI commands, preflight, `run`, the OMP extension (through the preflight), update, setup, account change and the proxy's respawn hook.
- `zcode-proxy-manager.mjs` stays as the CLI entry and the respawn target. Its path is part of `ZCODE_KIT_RESPAWN_MANAGER` and of the documentation.
- Rendering moves to candidate 4.

**Benefits:**
- Locality: the lock, pid record, hung-own proof, kill guard and respawn budget live in one module.
- Leverage: about ten call sites share one interface.
- A dead holder no longer turns into failed launches.
- Preflight memory drops, because presentation is not imported.
- The existing injection points become the test surface, so manager-safety and manager-audit tests hit one interface.
- `restartForAccountChange` and doctor `--fix` stop duplicating state logic.

**ADR/invariant callout:** AUD-001 forbids automatic stale-lock takeover, because two contenders could delete each other's fresh locks. Keep that invariant. The S3/S4 numbers justify reopening "never recover". This is a code comment, not an ADR.

---

## Candidate 3: One bounded-collection module for every store that grows

**Strength:** Strong. **Serves:** goal 1. **Dependency category:** in-process for memory; local-substitutable (temp dir) for disk.

**Files and stores without a bound:**

| Store | Location | What grows |
|---|---|---|
| MCP task registry | `mcp/zcode-harness-mcp/src/tasks/manager.ts:132-135` | `tasks`, `byIdempotency` and `bySession` are never deleted from. `restore()` (:157-180) loads every `task-*.json` ever written. |
| Per-task data | `tasks/ingress.ts` | `warnings[]`, `errors[]`, `toolCalls`, `artifacts`, and the `accumulatedText` string (:135). |
| Task files | `store/store.ts` | Never pruned. JSONL streams are capped at 4 MiB per file, but there is no retention by count or age. |
| CDN cache, memory | `zcode-proxy-src/src/proxy/captcha-cdn-cache.ts` | A `Map` that expires entries only when the same URL is read again. No limit on entries or bytes. |
| CDN cache, disk | `captcha-cdn-cache.ts`, `~/.zcode-captcha-cdn-cache` | Never pruned. |
| Stall counts | `captcha-happy.ts:186` | `_stallCounts` per pe URL. A URL that stalls once is never removed. |
| (dead code) | `captcha-happy.ts:181` | `solveTimes` is never used. Delete it. |
| proxy.log | `proxy/zcode-proxy-manager.mjs:97-105, :503` | `rotateLogIfNeeded()` runs only in `start()`. The proxy appends to the inherited fd, so the log grows without limit for a proxy's whole lifetime (to be confirmed in S7). |

Bounded today, each with hand-rolled eviction:
- `zcode-proxy-src/src/responses/store.ts`: LRU + TTL + byte budget + options. This is the model.
- `tui/log-pane.ts`: 2000 lines.
- `cli/heal.mjs` `logHeal`: 64 KiB.
- `captcha-pool.ts` `CertifyIdRegistry`: TTL prune.

**Problem:**
- Five stores grow with use, and none takes a limit a test could set.
- Four other stores each re-implement eviction.
- S2 is RED on CDN cache memory growth: 151 MB against a 64 MB budget.
- MCP bridge memory grows with the number of tasks it has ever run, and restart reloads all of them.

**Solution:**
- Lift the responses store's LRU, TTL, byte budget and injected clock into one deep in-process module.
- Every store that grows gets a limit through it:
  - the MCP task registry (terminal tasks evicted, files retained by count/age);
  - the CDN memory cache (entries and bytes);
  - the CDN disk directory (retention at startup and after a commit);
  - the log writer (size cap enforced while running, not only at start).
- Per-task arrays get count caps with an explicit "truncated" marker.

**Benefits:**
- Locality: the bound and its tests are in one module.
- Leverage: one implementation serves at least seven stores.
- A fake clock drives eviction tests.
- An MCP bridge restart stops loading all history.
- Disk caches stop growing silently.
- The deletion test passes: deleting the module brings eviction loops back in every store.

**B1:** bounding captcha-cdn-cache is resource lifecycle. The bytes served do not change; an evicted entry is only fetched again.

---

## Candidate 4: One terminal output module; producers return records

**Strength:** Strong. **Serves:** goal 3 and goal 2 (stable `--json`, records shared by JSON and text). **Dependency category:** in-process.

**Files:**
- `cli/zcode-kit.mjs`: 116 direct `console.*` or `process.std*.write` calls.
- `cli/setup-output.mjs`: its own `paint`. Colour only when compact + TTY + `!NO_COLOR`. `[OK]`/`[WARN]` tags.
- `proxy/zcode-proxy-manager.mjs`:
  - `logLine` prints and logs;
  - status text;
  - doctor `PASS`/`FAIL`/`SKIP` lines;
  - `detailLines`.
- `cli/connection-details.mjs`: plain lines plus a JSON object.
- `cli/heal.mjs` and `cli/launch.mjs`: `console.error` details.
- `zcode-proxy-src/src/tui/frame.ts`: unconditional truecolor SGR and the `╭╮╰╯` glyphs.
- `tui/width.ts`: a per-code-point table with the gaps listed in terminal-conventions §3.
- `runtime/paste-login.ts`: bold when TTY, ignoring NO_COLOR.
- `proxy/handler.ts`: the `printRow` request table.

**Problem:**
- Colour, glyphs and layout are decided in at least four places by three different rules.
- The TUI paints colour and box glyphs even under NO_COLOR, TERM=dumb and an ASCII locale: 18 escape sequences in every captured variant.
- The doctor treats the manager's text as an interface:
  - `zcode-kit doctor` regex-parses the manager's `PASS|FAIL|SKIP` lines (`cli/zcode-kit.mjs:666-673`);
  - it then prints the raw manager output (:675) and all checks again (:708-712);
  - so 13 checks and a premature "doctor: … OK" summary appear twice (`ux/before/doctor/*/pipe.txt`).
- Any change to the manager's text breaks the doctor's exit code.

**Solution:**
- Producers return records: check lists, lifecycle outcomes, key-value cards (connection details), and error blocks with what, why and the next command.
- One output module per stream resolves:
  - colour precedence (flag > NO_COLOR > FORCE_COLOR > CLICOLOR_FORCE > TTY > TERM=dumb > CLICOLOR);
  - the glyph tier (full / wgl4 / ascii);
  - width, through `width.ts` with the grapheme fix.
- It renders through adapters: TTY, plain, and JSON (already present as `--json`).
- The manager's doctor returns its existing `checks` array instead of printing it.

**Benefits:**
- Locality: the design language from 1C lives in one module.
- Leverage: `width.ts` and `frame.ts` serve every producer.
- The doctor stops parsing text.
- JSON and text come from the same records.
- NO_COLOR, TERM=dumb and ASCII fallback are honoured everywhere by construction.
- Snapshot tests hit one renderer, and producer tests assert on records.

**Open decision (Phase 2):** the kit runs on Node `.mjs` and the TUI on Bun TypeScript. Options:
- one module shared by both (location and loading are to be decided);
- two renderers over one token set.

C4 prefers reusing `width.ts` and `frame.ts`.

---

## Candidate 5: Collapse proxy self-supervision into one supervisor module

**Strength:** Worth exploring. **Serves:** goal 1. **Dependency category:** in-process, with the spawn of the respawn hook as a mock adapter. `launchRespawnHook` already takes `spawnFn`.

**Files:**
- `zcode-proxy-src/src/runtime/watchdog.ts`: heartbeat SAB, eval worker, respawn launch, SIGKILL.
- `zcode-proxy-src/src/runtime/health-monitor.ts`: `MemoryGuard` (RSS soft 1536 MB / hard 3072 MB × 3 samples at 60 s), lag monitor and `healthDetails`.
- `zcode-proxy-src/src/index.ts`:
  - the memory-restart closure at :256-276: close for up to 6 s, flush, exit, force exit after 10 s;
  - the SIGINT/SIGTERM `stop` at :304-317: flush, then `server.stop(true)`.

**Problem:**
- Three modules each own part of "stop and hand over to the manager":
  - the respawn hook is launched from two places;
  - two shutdown sequences differ: one drains for 6 s, the other force-stops;
  - the memory sample is RSS, which on Windows is the working set and not the commit charge that exhausts memory (bun.md §3).
- Index.ts carries lifecycle closures that cannot be tested without starting a server.

**Solution:**
- One supervisor module owns:
  - the heartbeat and watcher, with `watchdogStep` kept as its pure core;
  - memory sampling by `Bun.unsafe.memoryFootprint()`, falling back to RSS;
  - the single graceful-shutdown sequence;
  - the respawn handoff to candidate 2's lifecycle module.
- Once candidate 1 lands, the solver's memory is capped by the OS, so this module guards only the proxy's own growth.

**Benefits:**
- One shutdown sequence to test.
- Locality: the respawn handoff lives in one place.
- The footprint metric matches what actually exhausts memory on every OS.
- `index.ts` loses its lifecycle closures.

---

## Candidate 6: Observe response streams in the client's path, not through tee()

**Strength:** Worth exploring. It depends on 1B attributing the S1 burst peak; if the peak is elsewhere, it drops to Speculative. **Serves:** goal 1. **Dependency category:** in-process.

**Files:**
- `zcode-proxy-src/src/proxy/handler.ts`: SSE branches at :420-447 with three `tee()` sites, `observeStream` at :1309 and `printRow` at :1260.
- `zcode-proxy-src/src/server/server.ts`: a `drain` wait at :349-351 with no close race.
- `proxy/sse-terminal.ts` and `translator/sse-translator.ts`.

**Problem:**
- The stats branch of each `tee()` reads at upstream speed. If the client is slow but still connected, its branch queues without bound (undici-yaml §5 #15).
- A client that disconnects while backpressured leaves the drain promise pending (#14).
- S1 burst32 reached 1618.9 MB proxy RSS and an 898 MB heap with 96 requests. The cause is not yet attributed.

**Solution:**
- One response-body module translates, observes (tokens, TTFB, total), applies the terminal guard as the client pulls, and returns the client body. Backpressure then holds from client to upstream.
- The request-row record goes to the output module (candidate 4).

**Benefits:**
- Backpressure holds end to end.
- Three `tee` sites become one module.
- Stats logic can be tested on SSE fixtures without a server.
- `proxyRequest` (about 390 lines) shrinks.

---

## Candidate 7: Split zcode-kit.mjs into command modules that return outcomes

**Strength:** Worth exploring. **Serves:** goal 3 and goal 2. **Dependency category:** in-process.

**Files:**
- `cli/zcode-kit.mjs` (1186 lines, 12 of the last 60 commits). `parseArgs(process.argv)`, `ROOT` and `ctx` run at module scope (:98-100). It has 15 commands and 116 direct writes.
- `tests/cli-kit.test.mjs` and `tests/setup-regressions.test.mjs`, which spawn the CLI.

**Problem:**
- Importing the file runs the CLI, so commands are testable only by spawning a process and diffing text.
- Every command mixes decisions with printing.

**Solution:**
- Each command becomes a module that takes parsed arguments and ctx and returns an exit code plus records.
- `zcode-kit.mjs` keeps argument parsing, dispatch and rendering through candidate 4.

**Benefits:**
- Commands can be imported in tests.
- Exit codes are asserted directly. They are part of the C2 compatibility contract (20, 130, …).
- An output change no longer touches command logic.
- This is the hottest file in the history, so the change pays off soon.

---

## Candidate 8: Give the MCP runtime a restart budget like the proxy's

**Strength:** Speculative. It waits for S5. **Serves:** goal 1. **Dependency category:** local-substitutable, using the existing `test/fixture/fake-harness.mjs`.

**Files:**
- `mcp/zcode-harness-mcp/src/runtime/manager.ts`: its header claims restart on exit. `ensureConnection` at :63 respawns lazily.
- `runtime/spawn.ts`.
- `protocol/connection.ts`: `stop` at :265, then SIGKILL after 3 s.
- `src/index.ts:87-90`: the crash handler only calls `tasks.stopAll`.

**Problem:**
- After a harness exit, the bridge interrupts tasks. The next tool call then spawns a fresh `node … app-server` (about 86 MB in S3).
- There is no budget, backoff or recorded state, and the module header overstates what happens.

**Solution:**
- Fold the respawn policy (budget, backoff, state) into the runtime module, using the same policy shape as candidate 2's respawn budget.
- Two adapters: the app-server child and the fake-harness fixture.

**Benefits:**
- A crash loop becomes bounded.
- The policy matches the proxy manager.
- Tests cross one interface with the fake harness.

---

## Summary

| # | Candidate | Strength | Goals | Category |
|---|---|---|---|---|
| 1 | Captcha solver behind a transport seam, in its own capped process | Strong | 1, 2 | ports & adapters |
| 2 | Kit manager deepened into one proxy lifecycle module (OS-released start lock) | Strong | 1, 2, 3 | local-substitutable |
| 3 | One bounded-collection module for every store that grows | Strong | 1 | in-process / local-substitutable |
| 4 | One terminal output module; producers return records | Strong | 3, 2 | in-process |
| 5 | Proxy self-supervision collapsed into one supervisor module | Worth exploring | 1 | in-process / mock |
| 6 | Response streams observed in the client's path, not tee() | Worth exploring | 1 | in-process |
| 7 | zcode-kit.mjs split into command modules returning outcomes | Worth exploring | 3, 2 | in-process |
| 8 | MCP runtime restart budget | Speculative | 1 | local-substitutable |

## Where process lifecycle is scattered today (input for candidates 1, 2, 5, 8)

| Concern | Locations |
|---|---|
| Spawn | Manager `start` (`bun run src/index.ts serve`, detached). Solver `spawnWorker`. captcha-happy sync-fetch worker. Watchdog eval worker. Respawn hook (watchdog and MemoryGuard). MCP `spawnAppServer`. Preflight via `execFile` (OMP) or import. `spawnSync` of the manager CLI (zcode-kit status, proxy, doctor, update ×2). |
| Start lock | Manager `acquireStartLock` (no takeover). Respawn budget lock. `heal.mjs` in-process `inFlight` Map. Setup lock (`lib/transaction.mjs`). OMP extension `pending` + 60 s TTL. |
| Reaping | Manager `killOwned` (SIGTERM → SIGKILL, or a Windows handle-checked TerminateProcess). Solver `recycle` → `terminate()` (asynchronous). Watchdog SIGKILL of itself. MCP `stop` → SIGKILL after 3 s. |
| Restart policy | Manager 3 per 15 min. MemoryGuard soft/hard RSS. Watchdog 45 s stall. Solver 200 solves / 3 failures / 768 MB heapUsed / 10 min idle / 90 s deadline. MCP: none. |

## Top recommendation

**Candidate 1**:
- The solver is the largest measured memory consumer (S2).
- Charter C1 asks for exactly this: a separate OS process with a hard cap.
- The dispatcher interface and the message protocol already exist, so only the transport changes and the goal 2 risk is the smallest of the Strong candidates.

**Candidate 2 next**:
- Its lock fix has RED evidence (S3, S4).
- It gives candidates 1, 4 and 5 one lifecycle interface to call.
