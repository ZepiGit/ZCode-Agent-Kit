# Round 2: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1 decisions in DECISIONS.md bind these answers. Where a recommendation contradicts one of them, the answer says so and the Round 1 decision wins. I checked the evidence myself in `reports/architecture.md`, `diagnosis/memory-report.md`, `diagnosis/data/*.csv`, `ux/design-language.md`, PROMPT.md §5/§7/§9, and the code at c4933c2: `proxy/zcode-proxy-manager.mjs`, `lib/proxy-env.mjs`, `zcode-proxy-src/src/{index.ts, runtime/health-monitor.ts, runtime/watchdog.ts, server/server.ts, proxy/captcha-solver.ts, proxy/captcha-happy.ts, proxy/captcha-cdn-cache.ts, tui/app.ts}`, `mcp/zcode-harness-mcp/src/tasks/{manager.ts, ingress.ts}`, `pack/build.mjs`, `scripts/verify-golden-path.mjs`, `.gitattributes`, `zcode-proxy-src/package.json`, `SECURITY.md`, and the diagnosis branch sampler (`/home/AgentKit/wt/diagnosis-memory/tests/memory/lib/sampler.mjs`). Where the evidence differs from the round's wording, the answer says so.

Where an answer is ACCEPTED with conditions, the conditions bind the spec and the tickets.

---

## Q1 — Proxy health policy and the supervisor module (arch #5)

**DECISION:** ACCEPTED with conditions. One supervisor module, with `watchdogStep` as its pure core. Footprint sampling uses RSS as the fallback. There is one shutdown sequence. Thresholds are soft 512 MB / hard 1024 MB, × 3 samples 15 s apart, configurable with injected-sampler tests. The restart budget stays at 3 per 15 min. Binding conditions:
1. **Reserve the budget before shutting down (C1).** Today the proxy starts exiting as soon as the OS has spawned the respawn hook (`watchdog.ts` `launchRespawnHook` resolves on the child's `spawn` event). The manager checks the budget only after that (`reserveRespawn`, `zcode-proxy-manager.mjs:827`). With the budget used up, a memory recycle therefore ends with **no proxy**. The handoff must confirm the budget reservation before the drain begins. If the reservation is refused, the proxy keeps serving (today's MemoryGuard rule: "a standalone proxy at 3 GB still serves, a dead one does not"), logs the refusal and reports it as WARN in status/doctor. The admission cap (Round 1 Q5) remains the memory protection. Test: under induced memory pressure there are ≤ 3 restarts per 15 min and exactly 1 proxy at every sample.
2. **How a recycle reaches clients.** During the drain the proxy keeps its listener open. New requests get the Round 1 Q5 shed contract (503 + `Retry-After` in the endpoint's error shape), not connection resets. In-flight requests get the drain window. The bounded account-metadata flush (`flushAccountMetadata`, index.ts) stays inside the hard cap. Streams cut at the force point are counted in one log line.
3. **The deadline is shared with the manager (POSIX).** `killOwned` sends SIGKILL 5 s after SIGTERM (`zcode-proxy-manager.mjs:420-424`). A 10 s drain on SIGTERM would be killed halfway, flush included. The stop deadline (drain + flush) and the manager's SIGTERM→SIGKILL grace become one shared, tested constant. Memory recycle and update keep the ≤ 10 s cap.
4. **Windows graceful stop (C7).** On Windows, `killOwned` calls `TerminateProcess` for both the graceful and the forced step (`:384-414`). On the primary platform the graceful sequence therefore never runs on `proxy stop`/`restart`. The lifecycle module (Q11) must deliver a graceful stop request on Windows, with `TerminateProcess` after the shared grace as the fallback. The spec picks the mechanism: a stop-request file in `logs/`, IPC, or an authenticated loopback request (C6: no unauthenticated or non-loopback surface). A windows-latest test proves that the flush runs.
5. Once the solver leaves the process, the soft action is WARN plus a log line, not a solver recycle. Q2 governs the solver. Without a manager hook (TUI or standalone), today's behaviour stays: log, keep serving.
6. The new `config.yaml` keys are optional. An env override exists only if it is added to `proxyEnv`'s allowlist with a test. `lib/proxy-env.mjs:21` strips `ZCODE_PROXY_*`/`CAPTCHA_*` from the managed proxy, so an unlisted env override would silently do nothing.

**Rationale:** The thresholds are backed by evidence. The designed maximum of the bounded proxy is ≈ 450 MB: base 85–93 MB, plus the responses store at ≤ ~74 MB (RC6), plus 64 MB × ~4.5 of admitted bodies (Round 1 Q5). Soft 512 MB sits just above that, and hard 1024 MB is a sustained 2× anomaly, far below today's 1536/3072. The recommendation leaves two C1 holes in the code it keeps unchanged. First, the "budget unchanged" path is the path that ends with zero proxies. Second, its single graceful sequence never runs on Windows and is SIGKILLed at 5 s on POSIX. "Exactly one proxy" includes "not zero" (Round 1 Q4 rationale).

**Charter:** C1 (no restart storm, never zero proxies, degrade by shedding), C7 (Windows stop semantics), C2 (config additive), C6.

**REVERSIBILITY:** Threshold defaults are a two-way door. The proxy↔manager handoff contract is hard to reverse, because an old running proxy and a new manager meet during an update. **ADR: yes** (handoff/shutdown contract).

---

## Q2 — Solver failure and recycle semantics

**DECISION:** ACCEPTED with conditions. A crash or an OS kill fails only the solve in flight. Requests that need no solve are never interrupted. The restart is lazy with backoff, at most 5 per 10 min, then fail-fast. Recycling happens by count or by footprint. The cap defaults to 300 MB and is configurable. The kill at the cap is logged with the setting that raises it. A1 revisits the default later. Binding conditions:
1. **Queued solves are not failed.** Today a worker exit fails only the in-flight job (`failInFlight`). The queue is then pumped onto the next generation (`captcha-solver.ts:184-193, 296-310`). That stays. The in-flight failure uses the existing error path and category (`CaptchaSdkError("other", …)`), so there is no new client-visible error. The 503 + `Retry-After` shed contract applies only while the solver is in the fail-fast window, with `Retry-After` set to the time until the window reopens. It also applies when a bounded queue overflows. It never applies merely because a crash happened.
2. **Only abnormal exits count toward 5 per 10 min:** crash, OS kill at the cap, fatal error, deadline kill. Planned recycles (count, footprint, idle, request, shutdown) never count. Otherwise a heavier real SDK that recycles by footprint every few solves would trip fail-fast in normal operation. The budget is a process restart limit. It never resubmits a solve, so it is not a new retry policy (Round 1 Q3 condition 7, B1).
3. **Corrected rationale and the threshold rule.** At the fixture's +4.1 MB per solve, 100 solves add ≈ 410 MB. That is above the 300 MB cap, so the count trigger cannot be what keeps the solver below the cap. The footprint trigger is the primary rule. It is defined as **80 % of the configured cap** (240 MB at 300) and is read from the child's own `Bun.unsafe.memoryFootprint()` report after each solve (Round 1 Q3 condition 5). The count of 100 is only a backstop. The in-worker 768 MB heap trigger lies above the cap and is removed or re-based below it.
4. **Config.** `config.yaml` is the source for the managed proxy. An env override only applies under the allowlist rule of Q1 condition 6. The OS-kill log line names the `config.yaml` key. Values below a documented minimum are rejected at config load with what/why/next. Tests and the §9 evidence use the default of 300 MB.
5. **Environment parity (B1).** The child gets the inputs the worker gets today: `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA` (it gates remote guest JS, `captcha-happy.ts:1753`), the CDN cache variables and the egress setting from Round 1 Q17. The guest error boundary (`index.ts:207`) is installed in the child as well. Without these, solves would fail or behave differently in the child.
6. The fail-fast state and its end time are reported in the Q5 fields.

**Rationale:** Most of the semantics are sound and serve C1 (bounded restarts, no storms). Two parts are not backed by evidence. Failing the queued requests on a crash would be a regression from today's behaviour, and the evidence gives no reason for it. The "100 because 4.1 MB/solve" arithmetic contradicts the 300 MB cap. The conditions keep the client-visible behaviour identical to today, except in the new fail-fast state.

**Charter:** C1, B1 (lifecycle only, byte-identical solves), C2 (no new error shape), C9.

**REVERSIBILITY:** Two-way door (defaults). No ADR beyond Round 1 Q3/Q5.

---

## Q3 — Bounds for every growing store (arch #3)

**DECISION:** ACCEPTED with conditions. One bounded-collection module is lifted from `responses/store.ts`. The limits are as listed, with a test each, and the dead `solveTimes` is deleted. Binding corrections:
1. **`_stallCounts`: no TTL (B1).** The count drives a solve-path decision. At 2 stalls of a pe URL the CDN entry is invalidated (`captcha-happy.ts:195-203`). A 1 h TTL would reset the count and change when the cache is evicted, which changes which bytes are served. Bound it by count only: 1,024 entries, oldest evicted first. The map is generation-scoped (reset with each solver process), so with ≤ 100 solves per generation the cap is unreachable in practice and behaviour stays identical.
2. **The CDN disk prune by age removes only entries that are already expired under the configured TTL.** `CAPTCHA_CDN_CACHE_TTL_MS` may be up to ~24.8 days (`captcha-cdn-cache.ts:7`), which is more than 14 days. The effective age limit is therefore max(14 days, TTL). The 256 MB byte cap evicts the oldest entries. The directory is HOME-derived and can be shared by several installations and solver processes. Pruning skips temp files and files being written, and tolerates `ENOENT`.
3. **MCP tasks.** A task is evicted when either limit is exceeded (count > 500 terminal tasks, or age > 7 days). Non-terminal tasks are never evicted. Each task's `*.result.json` is pruned with it. A lookup of an evicted task returns the existing not-found error. An evicted task's idempotency key is forgotten (`byIdempotency`, `manager.ts:258-264`), so the idempotency window equals the retention. That goes into the tool docs and the release notes.
4. **`accumulatedText` (4 MiB)** becomes the task's `responseText` (`manager.ts:612`). On truncation, the existing `completeness` field is set to `partial` with an explanation, which existing consumers already understand. The additive `truncated` marker comes on top. The spec states which part of the text is kept.
5. The responses store's behaviour and its tests stay unchanged. The TUI pane's byte cap is tested against the S6 budget (≤ 16 MB of heap with 64 KB lines).

**Rationale:** Every store with measured or code-evident growth gets an enforced bound (§9 BOUNDS, RC4/RC5/RC7). The claim that bounding "changes only memory, never which bytes are served" holds for the memory caches. It is false for a TTL on `_stallCounts`, and for an age prune that would remove entries still fresh under a long configured TTL. The conditions make the claim true.

**Charter:** C1, B1, C2 (stored-state change announced; error shapes unchanged), C9.

**REVERSIBILITY:** Limits are a two-way door. Deleting task history cannot be undone for the affected data. **ADR: yes** (retention policy for stored task state).

---

## Q4 — `proxy.log` rotation while the proxy runs

**DECISION:** REJECTED as worded. My decision keeps the direction: the proxy opens `proxy.log` itself through a size-capped writer (rotate at 5 MB, keep one `proxy.log.1`, the same as `MAX_LOG_BYTES` today), and `proxy logs N` reads across both files. These corrections bind:
1. **The proxy is not the only holder of the file.** The manager appends `[manager <ISO>] …` lines to `proxy.log` (`logLine`, `zcode-proxy-manager.mjs:93`). `proxy logs` opens it for reading (`:1191`). Rotation must tolerate concurrent appenders and readers. No line is ever lost. If the rename fails (Windows sharing), the writer keeps appending and retries at the next check. The overshoot is bounded so that S7 (≤ 6 MB) still holds. A windows-latest test rotates while a reader and a manager append are open.
2. **Startup failures stay in `proxy.log`.** `scripts/verify-golden-path.mjs:245-253` reads `logs/proxy.log` to classify start failures (ModuleNotFound, EADDRINUSE, SyntaxError, `exited immediately (code N)`). Users are told to "inspect logs/proxy.log" (`cli/heal.mjs:50,80`). The inherited stdio may go to a new early-output file that is truncated at each start. When the proxy exits during startup, or after a crash, the manager copies a bounded tail of that file (e.g. 64 KB) into `proxy.log`. The new file name is additive and documented.
3. Once the writer is open, the proxy's console, stdout and stderr writes go through it. Only output that bypasses JS (native panics) reaches the early file. The solver child's stdout/stderr is piped to the parent and written through the writer, with the line content unchanged (e.g. `[pe-cache-evict] …`).
4. Line content stays as it is today. The Q5 format applies only to new event lines.

**Rationale:** RC8 is measured and the missing seam is real (memory-report §7). But the Windows mechanism was justified by a false premise, "only the proxy holds the file". Moving early crash output out of `proxy.log` would also break a repo script and the documented diagnostic path (C2). The corrected design keeps every consumer of `proxy.log` working and bounds the file.

**Charter:** C1 (bounded disk), C2 (scripts and docs that read proxy.log), C7 (Windows sharing semantics), C3 (errors point to a log that contains the cause).

**REVERSIBILITY:** Two-way door. No ADR.

---

## Q5 — Observability fields

**DECISION:** REJECTED in part. Accepted: additive `memory` (per process: role, pid, `rssMB`, `footprintMB`, `capMB`, enforcement), `restarts` (`last15m`, `budget`) and `admission` (`inFlightBytes`, `queued`, `shedTotal`) in `proxy status`, `--json` and `/health` details. `/health` stays behind bearer auth (`server.ts`, where the auth check precedes the routes). Existing fields keep their names, types and meaning, and `schemaVersion` stays 1. My corrections:
1. **The enforcement enum follows Round 1 Q3 condition 8:** `job-object` | `cgroup` | `sampling`. `sampled` contradicts that binding decision. `none` is added, for the thread fallback adapter or for caps that are switched off.
2. **`processes` is limited to what the proxy owns** (proxy plus solver children), e.g. `processes: { proxy: 1, solver: n }`. A count of "all kit processes for this installation" (launchers, bridges, preflights) would need a process-table scan with command-line matching, which on Windows cannot read env. `/health` `details` must stay synchronous and O(1) (`server.ts:189` comment, `healthDetails()`), because hung-proxy detection depends on it. All memory values come from cached samples.
3. **When doctor WARNs.** WARN appears above the soft limit, when enforcement is `none`, or when a hard cap is supported on the platform but was not applied (Linux without a delegated memory controller, a failed Job Object). On macOS, `sampling` is the designed mode, so it shows PASS with a detail note. A permanent WARN with no possible next command would break C3 ("every error says … the exact next command") and Round 1 Q10's meaning of WARN.
4. **Log format scope.** `ISO-time LEVEL component message key=value…` applies to new event lines only (memory, recycle, shed, supervisor, lock takeover). Existing lines stay byte-identical (Q4, C2: the golden-path script greps them). The existing redaction applies to all lines.
5. Q2's solver fail-fast state and its end time are part of the solver entry.

**Rationale:** The fields serve §9 UX (per-process RSS in the TUI) and Round 1 branch 5. Three parts of the recommendation are not backed or conflict. The enum name contradicts Round 1. An installation-wide process count cannot be computed inside `/health`'s O(1) contract. The WARN rule would put a non-actionable WARN on every macOS doctor run.

**Charter:** C2 (additive JSON, stable lines), C3, C6 (authenticated, no secrets), C1 (bounded work per request).

**REVERSIBILITY:** Field names are hard to change once released (a documented superset). **ADR: yes** (observability contract).

---

## Q6 — Where the shared output code lives (arch #4 open decision)

**DECISION:** ACCEPTED with conditions. Add `tokens.mjs` (+ `.d.mts`) beside `width-core.mjs` in `zcode-proxy-src/src/tui/`. The CLI gets `lib/term/`, and the TUI keeps `frame.ts` on the same tokens and width core. That is two renderers, one token set and one width core. Conditions:
1. Both shared files are plain ESM, with no Node-only or Bun-only APIs and no imports outside `tui/`. They are tested under Node and Bun (Round 1 Q12 condition 2), and `bun build --compile` bundles them for all five targets (precedent: `captcha-compatibility.mjs`).
2. The pack allowlist already covers `cli/`, `lib/` and `zcode-proxy-src/src/` (`pack/build.mjs:20-46`). The change needed is that `verify-payload`'s required list gains the shared files and their `.d.mts`.
3. Rendering code loads lazily: `cli/heal.mjs` preflight and the lifecycle intents must not import renderers (RC3: ~70 MB per preflight, Round 1 Q6).

**Rationale:** This matches design-language §9 and Round 1 Q12, and it follows the repo's existing cross-runtime pattern. C4 prefers the existing `frame.ts`/`width.ts` over one forced shared renderer across two runtimes.

**Charter:** C4, C3, C1 (preflight footprint).

**REVERSIBILITY:** Two-way door. **ADR: yes** (the output topology governs all output; extends the Round 1 Q1 ADR).

---

## Q7 — Migration order for the output work

**DECISION:** ACCEPTED with conditions. The order is (1) the `lib/term/` prefactor plus the snapshot harness, (2) the command-module split, (3) manager doctor records, (4a/b/c) the per-command batches, (5) the TUI. Conditions:
1. "No visible output change" in steps 1–2 is proven by snapshots captured on the pre-change code.
2. Step 3: the manager CLI's own `doctor` output (`node proxy/zcode-proxy-manager.mjs doctor`) stays in the legacy off-TTY grammar (Round 1 Q1 amendment 1, Q11). Only `zcode-kit doctor` stops parsing text.
3. Batch (b) touches `install.ps1` text and so carries the Round 1 Q9 PowerShell 5.1 stderr gate. All stream moves ship in one release (Round 1 Q9).

**Rationale:** The order matches PROMPT §7 Phase 3 principles 2 and 5. The prefactor comes first, then the hottest file is split, then the A-02 double print is removed at its source, then the batches run in the order of user impact.

**Charter:** C3, C2, C9 (smaller steps, each reversible).

**REVERSIBILITY:** Two-way door.

---

## Q8 — Snapshot test strategy

**DECISION:** ACCEPTED with conditions. Snapshots live under `tests/snapshots/<command>/<variant>.txt` and are rendered from records with forced capabilities for every C3 variant, on both OS legs, without a pty. A few spawn tests check stream routing and exit codes. Normalisation uses an explicit list. `--json` gets key-set superset tests. Snapshots are updated only through `UPDATE_SNAPSHOTS=1`. Conditions:
1. **Line endings.** `.gitattributes` has no global rule today (only `*.sh`, `*.ps1`, `*.cmd`), and the windows-latest checkout converts to CRLF. Add `tests/snapshots/** -text` (or `eol=lf`) and compare bytes, ANSI included.
2. The JSON baseline (key names **and** value types, per C2 "names, types and meaning") is captured once from the pre-change code and committed. New enum values (`WARN`) are listed as additive (Round 1 Q10).
3. CI fails when `UPDATE_SNAPSHOTS` is set. The normalisation list never masks status words, exit codes or the check grammar. The off-TTY doctor grammar has a regex test (Round 1 Q1).
4. The Round 1 Q9 PowerShell 5.1 gate is a real spawn test on windows-latest. Real conhost/PS 5.1 rendering stays an owner action (Round 1 Q22).

**Rationale:** Rendering from records with injected capabilities is deterministic and covers every C3 variant on both legs, which §9 UX requires. The conditions close the concrete failure modes the repo shows: CRLF conversion on Windows, and a baseline that could otherwise drift with the new code.

**Charter:** C3, C2, C7.

**REVERSIBILITY:** Two-way door.

---

## Q9 — TUI redesign scope

**DECISION:** ACCEPTED with conditions. The scope is as listed: a boxed header, a process strip, a log pane with filter, the byte cap and scrolling, a key-hint footer, the sidebar at ≥ 100 columns, a single column at 80, glyph tiers, and no colour-only meaning. Conditions:
1. **Keep the collapsed settings strip and the toast** (design-language §8.1 items 2 and 4). The round's region list leaves them out. Today's TUI has provider/plan switching and login (`tui/app.ts:334-357, 601-602`). Every existing TUI action stays reachable and visible (C2).
2. **TERM=dumb and non-TTY refuse** and print the line-mode commands, per design-language §8.5. They do not render a degraded frame. NO_COLOR and the glyph tiers render as §8.5 specifies.
3. **Header-only box: accepted.** It narrows Round 1 Q1 amendment 2, which set an upper bound, so this is not a contradiction. It matches design-language D0 and principle 7. The log pane gets an unboxed title line with the count/follow badge.
4. **The process strip shows per-process RSS** (§9 UX, literally). For capped processes it also shows the enforced metric against the cap, with the metric named (footprint/commit), the enforcement mode and the restarts in 15 min.
5. **Data.** The TUI hosts the proxy in-process (`app.ts:64-68`), so it reads the same in-process snapshots `/health` exposes, plus the existing quota/accounts sources. Polling is ≥ 5 s with one request in flight per source (design-language §8.3). There are no new endpoints and no new upstream calls. Minimum size is 60×16 (§8.4).

**Rationale:** The scope delivers §9 UX (health, per-process RSS, key hints) inside the Round 1 Q1 layout. As worded it would drop existing controls and contradict the design-language's TERM=dumb rule. The conditions fix both.

**Charter:** C3, C2, C4 (`frame.ts`), C1 (bounded polling).

**REVERSIBILITY:** Two-way door.

---

## Q10 — Stored state, migration and the release-notes list

**DECISION:** ACCEPTED with conditions. New state is added only where needed. The lock gains a protocol version field. The new config keys are optional. Migrations go through the transaction mechanism, are idempotent and are tested twice. The release notes go in `docs/RELEASE_NOTES_vNEXT.md` (English) and README. Conditions:
1. **Today's lock is a known version.** `{pid, startedAt, nonce}` (`zcode-proxy-manager.mjs:448`) is protocol v0. The Round 1 Q4 proven-takeover rules apply to it: the holder is dead, or its process start time is later than the lock's `startedAt`. Otherwise stale locks left by old kits (5 of 8 Ctrl-C trials) would never be recovered after the update, which is the RC-L failure itself. Only unparsable or unknown-higher-version locks are never deleted automatically. Their error gives what/why/next with the exact path.
2. **New locks are written atomically** (the content is never visible half-written). "Unreadable" can then only mean foreign corruption, never a live contender's partial write.
3. An old kit reading a new lock reads only `pid`/`startedAt` (`:453-455`), so the extra fields are harmless. That is tested against the origin/main manager file.
4. **Correct the "no existing file changes shape" statement and complete the list.** The lock gains a field. Q4 adds an early-output log file. Q3 prunes MCP task files and CDN disk entries. The release notes must also announce: MCP task retention (500 / 7 days) and the resulting idempotency window; CDN disk pruning; log rotation while running and the new log file; the memory thresholds moving from 1536/3072 to 512/1024 MB (recycles become more likely); the solver recycle count moving from 200 to 100; the new JSON fields, the `WARN` value and `completeness: partial` on truncation; the Bun 1.4.4 requirement; shedding during a recycle drain; the Windows graceful stop. Nothing is removed silently.
5. Runtime migrations (lock versions, retention pruning) are idempotent and tested twice like the setup migrations. The Account Rotator migration follows Round 1 Q8.

**Rationale:** C2 requires automatic, idempotent, announced migrations. The evidence shows that treating the version-less lock as "unknown" would keep exactly the stale-lock failure the run exists to fix. The release-notes list as proposed omitted several user-visible changes decided in this round.

**Charter:** C2, C1, C8.

**REVERSIBILITY:** The lock protocol is a one-way door (Round 1 Q4). **ADR: yes** (lock versioning).

---

## Q11 — Proxy lifecycle module shape (arch #2)

**DECISION:** ACCEPTED with conditions. One module owns start/stop/restart/status, the start lock, takeover, orphan adoption, respawn and the budget. All ~10 callers use its interface. `createManager({ root, home, processStartMsImpl, … })` stays the test seam. The manager CLI stays a thin adapter. Conditions:
1. These stay unchanged: the manager CLI's commands, exit codes 0–5 and output; the OMP autostart's exit-code mapping (3 → foreign, 5 → key); the `ZCODE_KIT_RESPAWN_MANAGER` path; and the `respawn <pid> --reason <r>` arguments (`watchdog.ts:80`). After an update, an old running proxy calls the new manager.
2. The module owns the Q1 handoff (budget reserved before the proxy drains) and the Windows graceful stop.
3. The intents print nothing and return outcome records. The preflight path imports no presentation code (RC3).

**Rationale:** Strong candidate with RED evidence (S3, S4). The conditions protect the cross-version contracts that C2 covers and that the update path relies on.

**Charter:** C1, C2, C7.

**REVERSIBILITY:** Two-way door internally. The external contracts are pinned above. No ADR beyond Round 1 Q4 and Q1 above.

---

## Q12 — CLI command modules (arch #7)

**DECISION:** ACCEPTED with conditions. Each command lives in `cli/commands/<name>.mjs` and returns `{ exitCode, records }`. `cli/zcode-kit.mjs` keeps parsing, dispatch and rendering. Exit codes are asserted directly, and the spawn tests pass unchanged. Conditions: "no side effects on import" also means no reads of `process.argv`/env, no `process.exit`, and no I/O at module scope (today `parseArgs(process.argv)`, `ROOT` and `ctx` run at module scope, `cli/zcode-kit.mjs:98-100`). The `bin/` entry points stay unchanged. New test files fall under the Round 1 Q19 guard.

**Rationale:** It removes the measured coupling (116 direct writes, untestable imports) in the hottest file, and it is the prefactor that PROMPT §7 principle 2 requires.

**Charter:** C2, C3, C9.

**REVERSIBILITY:** Two-way door.

---

## Q13 — Windows sampler spec

**DECISION:** ACCEPTED with conditions. One long-lived `powershell.exe -NoProfile -NonInteractive` child polls `Win32_Process` every 1 s. RED rules use commit charge on Windows and RSS on Linux, and the sampler excludes itself by PID. Windows CI runs S1, S2, S3, S4, S5 and S7 short. Binding corrections:
1. **Identification follows Round 1 Q7 condition 2, not the process tree alone.** Windows does not re-parent processes, and the manager starts the proxy detached and then exits, so a tree walk loses exactly the orphans the loop must find. Processes are identified by the tree from the loop root **plus** a run-unique token in `CommandLine` or `ExecutablePath`, for example the isolated `ZCODE_KIT_BUN` path the loop already sets. On Linux the proxy's command line is a relative `bun run src/index.ts serve` (`S1-*.excerpt.csv`), so the command line alone is not unique. A self-test proves that a deliberately orphaned detached process is found.
2. **Schema.** The Linux header is `t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd` (`sampler.mjs:152`), with no commit column. Add `commit_kb` as an additive column (empty on Linux). On Windows: `rss_kb` = WorkingSetSize/1024, `commit_kb` = PrivatePageCount/1024, **`hwm_kb` = PeakPageFileUsage** (peak commit, already in KB), `threads` = ThreadCount, `fds` = HandleCount. The per-process peak rule depends on HWM to catch spikes between samples (memory-report §5). The WMI properties mix bytes and KB, so a start-up self-test checks units against `Get-Process` `PrivateMemorySize64`.
3. The first Windows run on the pre-fix code records a Windows baseline. The budgets keep the same numbers (§9: no loosening). If commit charge alone turns a scenario RED that is GREEN on Linux, it comes back as an owner question and is not adjusted silently.
4. The sampler child is reaped when the loop exits (B4, C1). Its measured overhead is recorded.

**Rationale:** The core matches Round 1 Q7. As worded, the tree-only filter contradicts Round 1 Q7's orphan rule, and the schema drops the peak column that the burst budgets depend on.

**Charter:** C7, C1, §9 (budgets not loosened), B4.

**REVERSIBILITY:** Two-way door.

---

## Q14 — CI layout

**DECISION:** ACCEPTED with conditions. `test-kit` runs {ubuntu, windows} × {Node 24, 26} with the kit, proxy, proxy typecheck and MCP tests. A separate `memory-budget` job (Node 26) runs per OS with the short profile and artefacts. The snapshot tests run in `npm run test`, and `release.yml` changes only in versions. Conditions:
1. **Expected-RED list.** At baseline the current code is RED in S1 burst, S2, S3, S4, S5, S6 and S7 (memory-report §1). Under the §7 Phase 4 rule "a merge that turns anything red is reverted", a fully enforcing job could never land first. The job therefore starts with an explicit expected-RED list (scenario → ticket id). A RED scenario not on the list fails the job. A listed scenario that turns GREEN also fails until its entry is removed, so stale entries cannot pile up. The list must be empty at Phase 6 (§9 CI).
2. The proxy typecheck runs through the pinned proxy `typescript` devDependency (Round 1 Q15), never an unpinned `bun x` download. Bun 1.4.4 is pinned in every job.
3. The memory jobs run under hard caps and timeouts. On ubuntu that is a `systemd-run --user` scope where available, otherwise `prlimit`. On windows the loop applies a Job Object. `ZCODE_MEMLOOP_ALLOW=1` is set only in that job.
4. The Round 1 Q9 PowerShell 5.1 stderr gate runs on the windows leg. CI runs come from the draft PR (Round 1 Q21). Nothing is pushed to `main`/`feature/account-rotator` (B6).

**Rationale:** The layout realises Round 1 Q7, Q14, Q15 and §9 CI. Condition 1 settles a conflict that would otherwise make PROMPT §7's own ordering (memory loop first) and its revert rule incompatible.

**Charter:** C7, C1, C5, §9, B6.

**REVERSIBILITY:** Two-way door.

---

## Q15 — Upgrade staging (Round 1 Q16)

**DECISION:** ACCEPTED with conditions. There are three batches (toolchain & CI; proxy deps; MCP deps), each green before the next, and they land before the memory fixes. Conditions:
1. **Move the proxy `typescript` devDependency and `@types/bun` 1.4.4 into batch (1).** Batch 1 adds the root-CI proxy typecheck, and Round 1 Q15 pins it through that devDependency. The proxy has none today, and `@types/bun` is `latest` (`zcode-proxy-src/package.json:20-21`). Without the move, batch 1's typecheck is unpinned. The typecheck baseline is recorded first, and any failures become tickets (Round 1 Q15).
2. **Record the ordering deviation.** PROMPT §7 Phase 3 lists upgrades (principle 4) after the memory fixes (principle 3). This order comes from Round 1 Q15 (re-baseline on Bun 1.4.4 before the fixes) and Q16 condition 4 (captcha suite green after the happy-dom bump, before any other captcha-path change), so it is justified. It goes into RUNLOG/ADR. The memory loop + budgets harness (principle 1) still lands before batch 1.
3. Each memory-fix ticket's RED test must be RED on the upgraded runtime. If an upgrade alone turns a scenario GREEN, the fix ticket is re-scoped with that evidence. The Bun 1.4.2 baseline stays the budget reference (Round 1 Q15).
4. Batch 1 carries the Round 1 Q14 conditions (refuse before mutating state, `heal.mjs` floor check, DEP0190) and the 1.4.4 SHA-256s from the primary source. MCP SDK 2.x stays out (Round 1 Q16).

**Rationale:** Measuring the fixes on the target runtime gives the stronger evidence (C9). As worded, batch 1 depends on a pin that only arrives in batch 2.

**Charter:** C5, C9, C1 (attribution), §7 ordering (deviation recorded).

**REVERSIBILITY:** Two-way door per batch.

---

## Q16 — Docs plan (C8)

**DECISION:** ACCEPTED with conditions. The scope is as listed: README × 5, SECURITY (+de), harnesses/README*, SUPPORT_MATRIX.json, MANIFEST*, EFFORT_MAPPING* only if affected, and the MCP bridge README translations brought to parity. English comes first, and the translations reach content parity in the same ticket. Additions:
1. In SECURITY (+de), replace the statements that will become false: "The CAPTCHA solver runs on a dedicated worker thread inside the proxy" (`SECURITY.md:15-18`) and "start lock is never taken over automatically" (`:26`). State that the happy-dom loading flags keep the 20.x surface unchanged (Round 1 Q16 condition 1), and that `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA` keeps its meaning.
2. README × 5 also covers the new optional config keys (admission bytes, solver cap, memory thresholds), log rotation and the early-output file, MCP task retention and the idempotency window, and enforcement modes per OS. `proxy/config.example.yaml` documents the optional keys with their defaults, since it ships in the pack.
3. All five MCP bridge READMEs state the Node 24 floor (all say 20 today). `--help` text documents `WARN`, `--reask` and the rotator override (Round 1 Q8/Q10).
4. `docs/RELEASE_NOTES_vNEXT.md` carries the Q10 list, in English.

**Rationale:** The plan covers every C8 file. The additions are documents that this round's decisions would otherwise leave stale or wrong. SECURITY is the most important one, because it would describe the old process model.

**Charter:** C8, C6 (accurate security statements), C2 (deprecations announced).

**REVERSIBILITY:** Two-way door.

---

## Shared understanding

NOT CONFIRMED. Open branches:
1. **Round 1 Q6 footprint plan:** per-role targets × counts summing to ≤ 600 MB for 5 run + 5 preflight. This waits for `diagnosis/footprint-facts.md` (Round 3).
2. **Solver sizing:** A1 (does a real solve fit under 300 MB), and the measured idle footprint of a solver child process, which validates the 80 % recycle threshold and the count backstop.
3. **Proxy↔manager handoff protocol (Q1/Q11):** how the budget reservation is acknowledged before the drain, and how an old running proxy and a new manager meet during an update.
4. **Windows graceful stop mechanism** (stop file vs IPC vs authenticated loopback), and the shared SIGTERM grace / drain deadline constant.
5. **`proxy.log` details:** the early-output file name, the copy-on-start-failure contract, and rename-with-readers behaviour under Bun on Windows (unverified).
6. **MCP task truncation:** which part of `accumulatedText` is kept, and the documented idempotency window wording.
7. **Doctor Memory section:** exact rows, and the exact next command for a Linux host without a delegated memory controller.
8. **Memory-budget job mechanics:** the expected-RED list format and how it is enforced.
9. **Windows commit-charge baseline** from the first windows-latest run, and any owner question it raises.
10. **Phase 3 quiz:** ticket granularity, blocking edges, merge/split.
