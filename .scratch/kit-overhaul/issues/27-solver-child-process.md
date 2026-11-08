# 27: Solver as a child process: spawn, environment parity, lazy start, idle exit, one generation

**Blocked by:** 24 (Solver transport seam (prefactor): dispatcher state as an object, thread transport adapter), 18 (Per-spawn proxy environment: stop token and log dir set by the manager, token stripped from the respawn hook), 26 (Captcha egress routing under Bun)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0002

**What to build:** The child-process adapter becomes the default. From source it starts from `process.execPath` + the solver entry; compiled builds use a self-exec subcommand (never `-e`). Environment parity: `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA`, CDN cache variables and the egress setting (`ZCODE_PROXY_UPSTREAM_PROXY`) pass; `ZCODE_KIT_RESPAWN_*`, `ZCODE_KIT_STOP_TOKEN` and the ambient proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, any case, and the npm/yarn/pnpm proxy variables, the set `lib/proxy-env.mjs` strips) are excluded, whether or not the egress setting is set (Round 19); the guest error boundary is installed; the child never runs the watchdog or the respawn hook. Child stdout/stderr are piped to the parent and re-emitted line by line on the parent's stdout/stderr, content unchanged (33 routes those streams through the size-capped writer). One generation at a time (old exited or killed after a bounded grace before the next spawns). POSIX child exits on IPC EOF. Lazy spawn on the first solve, idle exit after 10 min (not abnormal), prewarm off. Solve inputs, outputs and the 90 s deadline unchanged.

**Acceptance criteria:**

- [ ] Seam 3: byte-identical solve I/O on both adapters; spawn from source and compiled (compiled binary test on Linux); env parity and stripping; one-generation ordering.
- [ ] Seam 1 (loop S2/S4): 0 solver processes after the proxy is SIGKILLed (POSIX), 0 after an idle exit, ≤ 1 per proxy at every sample.
- [ ] Cold start (spawn + handshake + module load) measured on Linux and Windows, ≤ 4.5 s, recorded in METRICS (build-time gate 4; a miss returns as a finding, the deadline is not moved).
- [ ] Loop S3: solver idle 0 MB when never used.
- [ ] Seam 3: a child line (for example `[pe-cache-evict] …`) appears byte-identical on the parent's stderr; a solve dispatched during the child's cold start fails at 90 s from dispatch, not from child readiness (injected clock); the compiled-binary self-exec spawn test also runs on windows-latest (C7).
- [ ] Seam 3 (egress, Round 19, from ticket 26): on the pinned Bun 1.4.2, through the child adapter, with mixed-case ambient `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` in the parent's environment: setting unset → the real `captchaFetch` (http and https CONNECT) and the sync-XHR path inside the child go direct and the ambient recording proxy receives nothing; setting set → all three go through the configured proxy only; the child's environment contains none of the excluded proxy names in any case. Plain test, no version gate; loopback mocks only.
- [ ] The ticket records how the thread transport is selected outside tests. If it can run outside tests on Bun < 1.4.3, that returns to the Owner Proxy as a finding (Round 19 condition 5) before closing.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 1, 7, 8, 9, 17, 18, 19, 20

## Comments

- 2026-11-08 (orchestrator, from ticket 24): the existing captcha-solver suite alone does not catch a deadline kill that never terminates the generation; only ticket 24's seam test (src/proxy/solver-transport.test.ts) does. Keep it green across the transport change.
