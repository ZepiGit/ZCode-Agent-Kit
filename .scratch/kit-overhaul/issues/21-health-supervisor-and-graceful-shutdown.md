# 21: Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB

**Blocked by:** 19 (Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract), 14 (Event-line format and redaction for new log events (prefactor))

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0008

**What to build:** One supervisor module owns heartbeat/watcher (`watchdogStep` stays its pure core, SAB heartbeat kept), memory sampling (`memoryFootprint`, RSS fallback), the single graceful shutdown sequence (used by SIGINT/SIGTERM, later the stop request, the memory respawn and update) and the respawn handoff point. Thresholds: soft 512 MB / hard 1024 MB × 3 samples 15 s apart, configurable. Soft only WARNs and logs (no solver recycle). Without a manager hook (TUI, standalone) the supervisor logs and keeps serving. During the drain the listener stays open, new requests are shed (19's contract), in-flight requests get the drain window, streams cut at the force point are counted in one log line. Lifecycle closures leave the proxy entry point.

**Acceptance criteria:**

- [ ] `health-monitor`/`watchdog` module tests with an injected sampler: soft → WARN only; hard ×3 → respawn request; thresholds from config; no hook → log + keep serving.
- [ ] Loopback drain test (seam 4): new requests during the drain get 503 + `Retry-After`, the listener stays open, an in-flight request completes, cut streams counted.
- [ ] Config keys documented; release-notes item "1536/3072 → 512/1024 MB" noted for 54.
- [ ] Adversarial: two consecutive samples above hard followed by one below → no respawn request; samples are 15 s apart (injected clock); a soft breach never recycles the solver.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 26, 27, 28, 52

## Comments
