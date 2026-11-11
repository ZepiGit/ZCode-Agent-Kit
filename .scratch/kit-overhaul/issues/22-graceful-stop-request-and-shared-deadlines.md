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
