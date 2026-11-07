# Round 2 — process model details, bounds, observability, output module, tests, docs

Answers file: `rounds/round-02-answers.md`. Round 1 decisions are binding (DECISIONS.md Round 1). Round 1 Q6 (footprint sub-budgets) waits for measurements in `diagnosis/footprint-facts.md` and comes back in Round 3.
Evidence root: `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/`. Main pointers per question.
Every question is worded so "yes" accepts the recommendation.

---

❓ **Q1 - Proxy health policy and the supervisor module (arch #5)**: Today `MemoryGuard` restarts at RSS soft 1536 MB / hard 3072 MB × 3 samples at 60 s (`reports/architecture.md` #5), far above the Round 1 budgets (steady ≤ 160 MB, peak ≤ 250 MB, burst ≤ 400/600 MB). One supervisor module owns heartbeat/watchdog (`watchdogStep` stays its pure core), memory sampling by `Bun.unsafe.memoryFootprint()` (commit charge on Windows) with RSS fallback, ONE graceful shutdown sequence (stop accepting, drain ≤ 10 s, then force) used by SIGINT/SIGTERM, memory recycle and update, and the respawn handoff to the lifecycle module (Q11). Thresholds for the proxy main process: soft 512 MB (WARN in status/doctor and log line), hard 1024 MB on 3 consecutive samples 15 s apart → graceful recycle through the manager; restart budget 3 per 15 min unchanged. Thresholds live in config with these defaults and are covered by tests with an injected sampler.

➡️ Yes.

---

❓ **Q2 - Solver failure and recycle semantics**: with the solver in its own capped process (Round 1 Q3): a solver crash or OS kill at the cap fails only the solve in flight with a retryable error; requests waiting on a solve then get the Round 1 Q5 shed contract (503 + `Retry-After`); requests that need no solve are never interrupted. The solver restarts lazily on the next solve with backoff (at most 5 restarts per 10 min, then solves fail fast with a clear status until the window passes). Recycle by solve count (100, half of today's 200, because RSS grows ~4.1 MB/solve) or by footprint above 240 MB between solves. The cap defaults to 300 MB and is configurable (`config.yaml` + env); an OS-kill at the cap is logged with the exact setting to raise it. If owner action A1 shows a real solve does not fit under 300 MB, the default is revisited then, not now.

➡️ Yes.

---

❓ **Q3 - Bounds for every growing store (arch #3)**: lift `responses/store.ts`' LRU + TTL + byte budget + injected clock into one bounded-collection module, and give each store a limit and a test: MCP task registry keeps at most 500 terminal tasks or 7 days (running tasks never evicted), files pruned by the same rule at start and on write, `restore()` loads only retained tasks; per-task arrays capped (warnings 200, errors 200, toolCalls 1,000, accumulatedText 4 MiB) with an explicit `truncated` marker in the task result (additive field); captcha CDN memory cache ≤ 64 MB and ≤ 256 entries; CDN disk directory ≤ 256 MB or 14 days, pruned at start and after each write; `_stallCounts` ≤ 1,024 entries with 1 h TTL; TUI log pane 2,000 lines and 8 MB; delete the dead `solveTimes`. Bounding captcha stores changes only memory, never which bytes are served (B1).

➡️ Yes.

---

❓ **Q4 - `proxy.log` rotation while the proxy runs**: today the manager rotates only at `start()` and the proxy appends to an inherited fd, so the log grows for the proxy's lifetime (S7: 148 B/request, no rotation). The manager passes the log path; the proxy opens `proxy.log` itself through a size-capped writer (rotate at 5 MB, keep one `proxy.log.1`; on Windows close → rename → reopen, since only the proxy holds the file); the inherited stdout/stderr becomes a small early-crash log capped at start. `zcode-kit proxy logs N` reads across both files. The path and line content stay as today (C2).

➡️ Yes.

---

❓ **Q5 - Observability fields**: additive only. `proxy status`, `proxy status --json` and `/health` details gain `memory` (per process: role `proxy`|`solver`, pid, rssMB, footprintMB, capMB, enforcement `job-object`|`cgroup`|`sampled`|`none`), `processes` (count of kit processes for this installation), `restarts` (`last15m`, `budget`), `admission` (`inFlightBytes`, `queued`, `shedTotal`). `doctor` gains a Memory section: WARN above the soft limit or when enforcement is `sampled`/`none`. Log lines: one line each, `ISO-time LEVEL component message key=value…`, existing redaction unchanged, no secrets. Existing JSON fields keep names, types and meaning.

➡️ Yes.

---

❓ **Q6 - Where the shared output code lives (arch #4 open decision)**: Round 1 Q12 put the width core at `zcode-proxy-src/src/tui/width-core.mjs`. Add `tokens.mjs` (glyph tiers, colour roles, verdict words) beside it. The CLI gets `lib/term/` (Node, `.mjs`: capability detection per stream, record renderers for text and JSON); the TUI keeps its Bun renderer (`frame.ts`) on the same tokens and width core. Two renderers, one token set, one width core. The pack allowlist and `verify-payload` include the two shared files for npm and release installs.

➡️ Yes.

---

❓ **Q7 - Migration order for the output work**: (1) `lib/term/` prefactor with the snapshot harness, no visible output change; (2) split `cli/zcode-kit.mjs` into command modules (Q12) with snapshot-identical output; (3) the manager's doctor returns its `checks` records instead of printing them (removes the double print); (4) migrate per batch, each updating its snapshots in all C3 variants: (a) doctor + proxy start/status/stop/restart/logs + connection card; (b) setup, integrate, installer stages, `install.sh`/`install.ps1` text; (c) help, models, accounts (+health), auth, run, update, rollback, uninstall; (5) TUI (Q9).

➡️ Yes.

---

❓ **Q8 - Snapshot test strategy**: promote `ux/capture/` into a committed snapshot suite: snapshots under `tests/snapshots/<command>/<variant>.txt`; the output module receives terminal capabilities explicitly, so every C3 variant (TTY colour 80/120, NO_COLOR, pipe, TERM=dumb, CI, ASCII tier, wgl4 tier) is rendered from records with forced capabilities, on both OS legs, without a pty; a small set of end-to-end spawn tests per command checks real stream routing (stdout vs stderr) and exit codes; volatile tokens (paths, ports, PIDs, times, versions) normalised through an explicit list; every `--json` output gets a key-set test asserting a superset of the baseline keys. Updating a snapshot requires an explicit `UPDATE_SNAPSHOTS=1` run.

➡️ Yes.

---

❓ **Q9 - TUI redesign scope**: within the Round 1 Q1 layout: header (health verdict, port, uptime, account/plan, quota) as the only boxed element; a process strip (proxy and solver footprint vs cap, enforcement mode, restarts in 15 min); log pane with level/text filter, the Q3 byte cap, and scroll; key-hint footer; C's sidebar at ≥ 100 columns, a defined single-column layout at 80; NO_COLOR, TERM=dumb and the glyph tiers honoured; no information by colour alone (the selected item carries a glyph or text marker). Data only from what `/health` and status already expose plus the Q5 fields; no new upstream calls.

➡️ Yes.

---

❓ **Q10 - Stored state, migration and the release-notes list**: new state only where needed: the Account Rotator answer under `generated/` next to `harness-choices/`; the lock file gains a protocol version field (an old kit meeting a new lock and vice versa is covered by tests; an unreadable or unknown-version lock is never deleted automatically); new `config.yaml` keys are optional with the defaults above. No existing file changes shape. Migrations run through the existing transaction/rollback mechanism, are idempotent, and have tests that replay them twice. Behaviour changes announced in `docs/RELEASE_NOTES_vNEXT.md` and README: Node 20/22 dropped (installer refuses before changing anything), stderr routing, `auth status` text on a TTY, `WARN` verdict, 503 shed contract, solver as a separate process (visible in task managers), compact setup default, Account Rotator asked once, nested proxy workflows deleted. Nothing is removed silently.

➡️ Yes.

---

❓ **Q11 - Proxy lifecycle module shape (arch #2)**: one module owns start, stop, restart, status, the start lock (Round 1 Q4 protocol), stale takeover, orphan adoption, respawn requests and the restart budget; the ~10 callers that reach the manager three different ways (CLI, manager CLI, OMP autostart preflight, heal, update, doctor --fix, run) call its interface; `createManager({ root, home, processStartMsImpl, … })` stays the injection seam for tests. The manager CLI keeps its commands and output as a thin adapter (releases without `zcode-kit proxy` keep working, C2).

➡️ Yes.

---

❓ **Q12 - CLI command modules (arch #7)**: each command in `cli/commands/<name>.mjs` takes parsed args and ctx and returns `{ exitCode, records }`; `cli/zcode-kit.mjs` keeps argument parsing, dispatch and rendering through `lib/term/`; importing any module has no side effects; exit codes (0, 1, 20, 130, …) are asserted directly in tests. Existing spawn-based tests keep passing unchanged.

➡️ Yes.

---

❓ **Q13 - Windows sampler spec (Round 1 Q7 decided: one long-lived sampler, commit charge)**: one long-lived `powershell.exe -NoProfile -NonInteractive` child of the loop, polling every 1 s with `Get-CimInstance Win32_Process` (ProcessId, ParentProcessId, Name, CommandLine, WorkingSetSize, PrivatePageCount, HandleCount), filtering to the scenario's process tree, writing the same CSV schema as the Linux sampler (commit = PrivatePageCount; rss = WorkingSetSize; fds = HandleCount); the loop's RED rules use commit on Windows and RSS on Linux; sampler overhead itself is excluded by PID. Windows CI runs S1, S2, S3, S4, S5, S7 short.

➡️ Yes.

---

❓ **Q14 - CI layout**: `test-kit` matrix {ubuntu-latest, windows-latest} × {Node 24, Node 26} running kit, proxy (bun test), proxy typecheck (`bun x tsc --noEmit`) and MCP tests; a separate `memory-budget` job (Node 26) per OS with the short profile (ubuntu S1–S7, windows per Q13), uploading CSV/summary artefacts; snapshot tests run inside `npm run test`. No change to `release.yml` beyond the Node/Bun/action versions already decided.

➡️ Yes.

---

❓ **Q15 - Upgrade staging (Round 1 Q16)**: batches in this order, each its own ticket green before the next: (1) toolchain & CI: Node floor 24, actions v7, Bun 1.4.4 everywhere incl. installers' SHA-256s and installer tests, root CI proxy typecheck, nested workflows deleted, memory baseline re-run on Bun 1.4.4 (Round 1 Q15 condition); (2) proxy deps: happy-dom 21 + the two loading flags, undici, yaml, `@types/bun` 1.4.4, proxy `typescript` devDependency; (3) MCP deps: SDK 1.32.2, zod 4.6.6, TypeScript 7.0.2 (fallback 6.0.3), `@types/node` 24, regenerated `dist/` committed (B5). Upgrades land before the memory fixes so fixes are measured on the target runtime.

➡️ Yes.

---

❓ **Q16 - Docs plan (C8)**: README and its de/es/ja/zh-CN translations: requirements (Node 24+, Bun 1.4.4), the solver process and memory caps, shed 503, status memory section, stderr routing, Account Rotator asked once; SECURITY (+de): the solver is now a separate OS process with a memory cap and still NOT a sandbox (same user, files, network, credentials), lock takeover rules in "Process recovery limits"; harnesses/README*: adapter changes; SUPPORT_MATRIX.json: date, Node/Bun versions, tested harness versions reconciled with MANIFEST; MANIFEST*: dependency versions, deleted nested workflows; EFFORT_MAPPING* only if an adapter's effort mapping changes; the MCP bridge README translations brought to parity (es/ja/zh-CN requirements sections are out of sync today). English first; translations at content parity in the same ticket.

➡️ Yes.
