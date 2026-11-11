# 22: Graceful stop request `POST /__kit/stop`, shared deadlines and the manager's stop path

**Blocked by:** 18 (Per-spawn proxy environment: stop token and log dir set by the manager, token stripped from the respawn hook), 21 (Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB), 40 (UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0014

**What to build:** The route sits after Host, Origin and bearer checks and requires the stop-token header; both compared in constant time incl. length; no CORS allowance; without a token it answers the unknown-route `404 not_found_error`. No body, bypasses admission, answers 202 before the drain, triggers the single graceful sequence. One shared module holds `STOP_GRACE_MS = 10_000` and `STOP_EXIT_MARGIN_MS`; the manager forces only after both. The manager sends the request on Windows and POSIX after the identity proof; POSIX falls back to SIGTERM on 404/401/403/connection error, Windows to `TerminateProcess`. `recoverHung`, startup timeout, foreign-port paths and golden-path crash injection force directly through an explicit force helper. `proxy stop`/`restart` show progress on a TTY, line-based elsewhere.

**Acceptance criteria:**

- [ ] Seam 4: auth order (Host/Origin/bearer before token), wrong/short/long token rejected, 404 without a token, 202, bypass while the byte cap is saturated, listener open during drain.
- [ ] Seam 2: fallbacks per status/OS against an old proxy; force paths never send the request; deadline test (manager force point > proxy deadline; respawn wait 30 s > 10 s + grace + margin).
- [ ] windows-latest: `proxy stop` runs the account-metadata flush (marker in the log) — build-time gate 5.
- [ ] Snapshot for the stop/restart progress (TTY) and line mode.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 54, 55, 57, 58, 59

## Comments

### 2026-11-11 — preserved-worker continuation (candidate, not acceptance)

Reused `/home/AgentKit/wt/t22`, branch `ticket/22-swarm`, base `e3bf342cb41411f0677507cc9db8f0331411177b`. All 93 preserved paths (57 modified + 36 untracked) were archived before edits at `/home/AgentKit/overhaul-tools/t22-gpt-evidence-20261111-1/{initial.diff,preserved-files.tar,preserved-sha256.json}`. Ownership check found no observable target process; 186 permission-denied `/proc` accesses prevent a machine-wide exclusivity claim. Prerequisites 18/21/40 were freshly read as resolved. Archived test runs are not counted as fresh checks.

The preserved CLI failure was reproduced without updating snapshots: `reports/t22-gpt-20261111-cli-red.log` has 36 pass / 1 fail / 0 skip, with `OK  stopped (pid 4242) - stopped (pid 4242)`. The existing `Proxy (start|stop)` assertion is unchanged. Cause: transient `Progress.update()` text became the final action label. The additive optional result-label argument preserves existing callers' behavior and lets `finishStop` retain `Proxy stop`. Its seam-5 guard first failed in `reports/t22-gpt-20261111-progress-red.log`. Snapshot refresh is restricted to stop/restart stderr progress plus new graceful scenarios; no status/start stdout, JSON, exit, error or baseline-equivalence assertion is weakened.

Seam-4 behavioral RED `reports/t22-gpt-20261111-order-red.log` demonstrated that constructing the 202 Response started the drain before transport delivery. The listener now triggers the same shutdown sequence on the response's `finish` event. Fixed-size SHA-256 digests remove secret-length early returns for both credentials. Stop requests cancel unused response bodies and reject redirects. No anti-abuse behavior changes.

Added a non-skipped actual `serve` + spawned manager `stop` test in the already wired `supervisor-serve.test.ts`; it reads the real shutdown flush marker in the fixture proxy log, with isolated fixture credential stores and loopback-only egress preload. Linux `reports/t22-gpt-20261111-serve-green3.log`: 3 pass / 0 fail; NOT native Windows evidence. Earlier two attempts remain failed evidence (managed output is in proxy.log; a synchronous parent prevents child reaping). Native Windows fallbacks now use actual creation-time probes; a separate Windows-shaped PowerShell adapter tests the handle path locally. The direct force helper is exported by both lifecycle and manager (golden-path caller), retaining legacy `killOwned`.

Pre-existing test change justification: deadline relation imports the actual shared margin instead of duplicating 2000; fake lifecycle forwards observation lines to exercise progress; transient progress snapshots implement ADR-0014 condition 6 while stable result labels and legacy manager stdout remain protected. New stop diagnostics go to stderr in manager/account-restart callers; existing narration and account policy remain unchanged. No config/env key was added. `stop-route.test.ts` is discovered by existing `bun test`; the spawned proof extends an already discovered file. Memory thresholds, budgets and expected-RED entries are unchanged.

Fresh targeted proxy neighbor run `reports/t22-gpt-20261111-proxy-neighbors.log`: 84 pass / 0 fail, typecheck exit 0. Initial complete targeted kit neighbor run: 325 pass / 2 fail / 1 skip; two stdout regressions were diagnosed and repaired, not relaxed. Final reruns and committed-checkpoint mutation evidence follow below. Exact commands/PID/PGID metadata is external in `t22-gpt-evidence-20261111-1/`. Checks use original `run-capped.sh`, Bun 1.4.2, hard systemd caps, explicit timeouts and isolated HOME/XDG. Controller explicitly permitted only new ignored `reports/t22-gpt-20261111-*.log` and append-only `reports/run-pids.txt` integration harness outputs, retaining Sentinel visibility; no tracked integration writes.

Pending central gates: full `test:all`, memory job, exact-head both-OS CI, actual windows-latest flush execution, independent Grok review. No native/CI acceptance, ticket resolution or new memory measurements claimed.

### Fresh final checks and mutation proof

Implementation checkpoint: `469922292135b850bafee0d530c4e6b4b432ed9a`. Each mutation began from that owned committed product, saved its exact applied diff externally (`mutant-*.diff`), ran through the unchanged capped wrapper, then restored only the mutated path with `gitc.sh checkout 469922292135b850bafee0d530c4e6b4b432ed9a -- <path>`; byte equality and `git diff --exit-code` were checked after every restore. No history rewrite. Runner and metadata: `/home/AgentKit/overhaul-tools/t22-gpt-evidence-20261111-1/{mutants.py,mutant-results.json,run.py,t22-gpt-20261111-*.json}`. All logs below are under canonical `.scratch/kit-overhaul/reports/` and were executed in this continuation, not recovered archive passes.

| Check / deliberately broken property | Fresh result (pass / fail / skip) | Log |
| --- | --- | --- |
| Complete targeted kit neighbors, 11 files | 327 / 0 / 1; 328 tests, exit 0, 184 s | `t22-gpt-20261111-neighbors-final.log` |
| Proxy neighbors, six actual files, plus typecheck | 84 / 0 / 0; typecheck clean, exit 0, 27 s | `t22-gpt-20261111-proxy-final.log` |
| Restored checkpoint: CLI/output/safety + named seam-2 + route/serve/typecheck | 66 + 8 + 9 pass, 0 fail/skip, exit 0 | `t22-gpt-20261111-restored.log` |
| Final route auth-order strengthening + typecheck | 6 / 0 / 0, clean typecheck | `t22-gpt-20261111-auth-final.log` |
| Remove stable stop result label | 31 / 6 / 0; existing result assertion and exact snapshots fail | `t22-gpt-20261111-mut-label.log` |
| Disable Host rejection | 5 / 1 / 0; 421 expected, 202 received | `t22-gpt-20261111-mut-host.log` |
| Force immediately after accepted request | 0 / 2 / 0; graceful-exit and margin guards fail | `t22-gpt-20261111-mut-margin.log` |
| Remove real serve flush callback | 2 / 1 / 0; actual manager-stop log lacks flush marker | `t22-gpt-20261111-mut-flush.log` |
| Trigger before transport delivery | 2 / 4 / 0; handler guard sees true instead of false, extra triggers detected | `t22-gpt-20261111-mut-order.log` |
| Claim successful stop for a reused PID | 0 / 1 / 0; existing refusal guard expects exit 4, receives 0 | `t22-gpt-20261111-mut-refusal.log` |

Exact final neighbor launch: `run-capped.sh t22-gpt-20261111-neighbors-final 2G 480 -- bash -c 'cd /home/AgentKit/wt/t22 && node --test tests/proxy-lifecycle.test.mjs tests/manager-safety.test.mjs tests/manager-audit.test.mjs tests/proxy-env.test.mjs tests/cli-ux-proxy.test.mjs tests/cli-ux-streams.test.mjs tests/term-output.test.mjs tests/term-snapshots.test.mjs tests/event-line.test.mjs tests/test-wiring.test.mjs tests/golden-path.test.mjs'`.

Exact final proxy launch: `run-capped.sh t22-gpt-20261111-proxy-final 2G 180 -- bash -c 'cd /home/AgentKit/wt/t22/zcode-proxy-src && bun test src/server/stop-route.test.ts src/server/server.test.ts src/runtime/supervisor.test.ts src/runtime/supervisor-serve.test.ts src/runtime/watchdog.test.ts src/index.test.ts && bun run typecheck'`. Exact other launches are preserved in the external per-run JSON, including explicit memory/timeout and command argv. First three direct RED launches used the same original wrapper with caps 1G and timeouts 90/90/60 s for cli/progress/order respectively; those initial three lack supplementary external process metadata (the wrapper's own Sentinel PID register remains).

All 93 original preserved paths remain; no path deletion, MCP dist delta, baseline refresh, integration product write or install occurred. The final auth-order test edit is test-only after the mutation checkpoint; it was separately executed GREEN. Snapshot changes are 48 existing stop/restart stderr files plus 32 new graceful stdout/stderr snapshots across eight C3 variants. The existing single platform skip in the complete neighbor run is retained, not newly introduced. No memory delta is asserted because no memory scenario was run. The candidate is ready only for central validation and independent Grok review, not accepted/resolved.

### 2026-11-11 — bounded correction after PR81 run42974159500 (not acceptance)

Failed source candidate: `8ac1a9540124ec74674be755b4f71ba4c74eac91`; PR81/run42974159500 remains **FAILED6/8**, not retrospectively green. Independently read the complete 1,148-line external inspection, all 42 raw UX diffs (Windows 6, Linux 36), both actual manifests (Windows 193 records, Linux 640), and all three direct Windows logs. The Windows stop/restart captures refuse identity with exit 4; they are not graceful-stop success evidence. Duplicate raw ERROR/not-running narration and repeated terminal results were product defects, not baseline changes to approve. Accounts-health age volatility is separate and excluded. Existing Windows baseline history remains mixed Linux/native provenance; no Windows baseline was changed or relabelled as fully native.

All 100 paths in the initial ticket delta were archived before this correction in `/home/AgentKit/overhaul-tools/t22-bounded-20261111-2/{initial.diff,initial-index.diff,initial-status.txt,initial-product.tar,initial-sha256.json}`; the initial checkout/index were clean. All 100 paths still exist. Original Linux and Windows baseline trees are preserved in `before-baselines.tar` (SHA256 `dbf8f80625f8511bd53bee65c8ea9936debf5354de5115a5d90aeb42593a8206`); the older 93-path archive remains untouched.

**A — stop presentation:** only four fixed-vocabulary request/fallback stages enter line-mode progress; raw timestamps/PIDs, terminal narration and detailed errors stay out. The existing stable action label animates on a TTY throughout the wait, including a stable label under TERM=dumb; result/error is rendered once. `Progress.tty` exposes the existing capability snapshot instead of probing stream flags in the command. The fresh 13-file neighborhood initially caught that direct-probe mistake and a literal fixture port (360 pass / 2 fail / 3 skip); both were fixed without changing guards. Literal pipe/CI expected strings and all eight C3 variants protect request stages, fallback stages, stdout and exit codes. Snapshot changes are limited to existing stop/restart stderr plus two new fallback/forced scenario sets; comparison/normalization logic is unchanged.

Exactly four Linux baseline outputs and four associated manifest rows were refreshed from actual same-platform `linux-capture-final`: `proxy/proxy-{stop,restart}/{pipe,ci}.stderr.txt`. Each output adds two useful request/fallback lines, not duplicate completion text. TTY and not-running captures remain unchanged. Hash provenance is in external `baseline-refresh.json`, also documented additively in the Linux INDEX. The first mistaken capture selector yielded zero captures and is retained as failed capture setup evidence, not counted as a pass. The intermediate raw TTY-event capture was inspected but not adopted. The actual final capture executed 21 cases; unchanged `compareCaptures` returned `[]`. A second 21-case capture of committed checkpoint `a0423ed2b1f2172e737eb56d0295f55c85f34d43` also returned `[]` (`reports/t22-b2-capture-checkpoint.log`, exit 0). No accounts-health, Windows, capturetool or normalizer refresh.

**B — portable seam-2 controls:** `createLifecycle` now accepts clock, fetch and a complete process adapter (alive/identity/terminate/platform), so a simulated identity cannot fall through to a real OS kill. Six non-skipped tests call the real public `stop`/`forceStop` logic, real pid-record/lock/config paths and injected OS/request boundaries, without POSIX shebangs or process-start-ms rounding. Exact Windows-shaped identities differ by one 100 ns tick at identical milliseconds. Cases cover natural exit at 10,500 ms (after 10,000 ms proxy grace and before 12,000 ms manager force), exact force at 12,000 ms, replacement during grace/no termination, unknown identity/fail-closed exit 2, immediate 404/401/403/error/legacy fallback, and direct hung/force paths with no stop request. Existing POSIX integration tests and their justified Windows skips remain. Two additional actual-Windows-only tests exercise native natural exit and real force-after-margin/direct-force paths; locally they skip. The portable Windows-shaped controls are **not actual native TerminateProcess/deadline/PID-reuse proof**, even when later executed on Windows. Native Windows deadline/force/PID-reuse acceptance still requires downstream execution; no PowerShell/Wine is available here and none was installed.

**C — actual persisted dirty metadata:** retained the original actual `serve` + separate manager-stop marker proof. Added an isolated composition fixture with real listener/stop route/shutdown/AuthManager and the real bounded `flushAccountMetadata`, using synthetic metadata only, an intentionally failed first write and a 60 s retry delay. It mutates existing health metadata, not selection/rotation/claim/retry strategy. A separate real manager CLI stops the server child; only after actual process exit does the parent read the synthetic JSON and require `failureGeneration: 1` with stale failure/exhaustion fields removed. Scope: this dirty fixture composes the actual components but does not use the unchanged `serve()` auth factory; the separate original serve test protects that wiring. No real account store, secret or live upstream was read. Native Windows execution of the dirty-persistence proof is still outstanding.

All test/build commands below use the original `run-capped.sh`, Bun 1.4.2, explicit hard memory/timeout limits, isolated HOME/XDG and fixture/mock upstream only. External `run.py` records wrapper PID/PGID and observed descendants; each run has immutable canonical ignored log plus external argv/process metadata. No full suite, memory scenario, live model/claim request, install, MCP build, CI dispatch, push or independent review was run here. No memory delta or acceptance is claimed.

| Fresh check / negative control | Result | Canonical report log |
| --- | --- | --- |
| Initial exact UX guard before fix | 0 pass / 1 fail, duplicate not-running | `t22-b2-ux-red.log` |
| Initial portable controls before seam implementation | exit 1, RED | `t22-b2-portable-red.log` |
| Complete targeted kit neighborhood, corrected | 362 pass / 0 fail / 3 skip, 365 tests, exit 0 | `t22-b2-neighbors-final.log` |
| Targeted proxy/security/persistence neighbors + typecheck | 96 pass / 0 fail; typecheck exit 0 | `t22-b2-proxy.log` |
| Actual same-platform baseline comparison | 21 captures, zero diffs, exit 0 | `t22-b2-capture-checkpoint.log` |
| Restored committed product, full same targeted kit/proxy commands without snapshot-update mode | kit 362 pass / 0 fail / 3 skip; proxy 96 pass / 0 fail; typecheck clean; exit 0, 212 s | `t22-b2-restored-final.log` |
| Extra progress line | 0 pass / 1 fail, literal string mismatch | `t22-b2-mut-extra-line.log` |
| Remove necessary request stage | 0 pass / 1 fail, literal missing line | `t22-b2-mut-request-stage.log` |
| Remove necessary fallback stage | 0 pass / 1 fail, literal missing line | `t22-b2-mut-fallback-stage.log` |
| Change refusal exit to zero | 0 pass / 1 fail, expected exit 4 | `t22-b2-mut-exit.log` |
| Force immediately instead of grace + margin | 2 pass / 4 fail, force trace at 0 not 12,000 | `t22-b2-mut-margin.log` |
| Ignore exact tick equality | 5 pass / 1 fail, attempted termination of one-tick replacement | `t22-b2-mut-ticks.log` |
| Bypass real bounded metadata flush | 0 pass / 1 fail, persisted JSON still generation 0/stale fields despite shutdown marker | `t22-b2-mut-dirty-flush.log` |

All seven mutants began at own committed product `a0423ed2b1f2172e737eb56d0295f55c85f34d43`, saved the applied diff externally, exited 1 for the intended assertion, and restored only the mutated file byte-for-byte from that commit. Each restoration checked SHA256 and `git diff --exit-code`; checkout was clean afterward. External `mutants.py`, `mutant-*.diff` and `mutant-results.json` preserve exact commands, results and restored hashes. Original failed setup/typecheck/trace attempts remain in evidence; no failing attempt was erased or reclassified.

Exact neighborhood command (2G, 480 s): `node --test tests/proxy-lifecycle.test.mjs tests/manager-safety.test.mjs tests/manager-audit.test.mjs tests/proxy-env.test.mjs tests/cli-ux-proxy.test.mjs tests/cli-ux-streams.test.mjs tests/term-output.test.mjs tests/term-snapshots.test.mjs tests/event-line.test.mjs tests/test-wiring.test.mjs tests/golden-path.test.mjs tests/term-caps.test.mjs tests/term-boundaries.test.mjs` from this worktree. Proxy command (2G, 180 s): `bun --version && bun test src/server/stop-route.test.ts src/server/server.test.ts src/runtime/supervisor.test.ts src/runtime/supervisor-serve.test.ts src/runtime/watchdog.test.ts src/index.test.ts src/auth/account-pool.test.ts && bun run typecheck` from `zcode-proxy-src`. Guard controls use `node --test --test-name-pattern="stop progress keeps" tests/cli-ux-proxy.test.mjs` or `--test-name-pattern="portable Windows stop" tests/proxy-lifecycle.test.mjs`; dirty mutant uses `bun test --test-name-pattern="persists dirty synthetic metadata" src/runtime/supervisor-serve.test.ts` (2G, 90 s each). Full wrapper argv is retained in each external per-run JSON. Ready means locally verified candidate for central full-suite/CI and independent review only; ticket status and acceptance boxes remain unchanged.
