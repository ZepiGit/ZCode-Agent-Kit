# 39: Observability fields in `/health` details, `proxy status` and `--json`

**Blocked by:** 19 (Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract), 21 (Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB), 23 (Respawn acknowledgement before drain (a refused respawn leaves the proxy serving)), 40 (UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details), 58 (Solver recycle triggers and failure semantics (abnormal-exit budget, fail-fast shed))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0010

**What to build:** Additive objects: `memory[]` per proxy-owned process (`role`, `pid`, `rssMB`, `footprintMB`, `capMB`, `enforcement`; the solver entry adds fail-fast state and window end), `restarts { last15m, budget }`, `admission { inFlightBytes, queued, shedTotal }`, `processes { proxy: 1, solver: n }`. `schemaVersion` stays 1. `/health` stays behind bearer auth, synchronous, O(1), every value from a cached sample.

**Acceptance criteria:**

- [ ] Seam 4: `/health` details superset vs the 06 JSON baseline (keys + types); adversarial: with the sampler stubbed to never complete, `/health` details still answer from the last cached sample (no await on sampling in the handler); unauthenticated request rejected as today.
- [ ] Seam 5: `proxy status --json` superset test; text rows render per design-language §7.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 80, 81, 82, 83, 123

## Comments
