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
