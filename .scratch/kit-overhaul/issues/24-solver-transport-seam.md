# 24: Solver transport seam (prefactor): dispatcher state as an object, thread transport adapter

**Blocked by:** 12 (Batch 2 — proxy dependencies: happy-dom 21.0.4 (loading flags kept), undici 8.12.4, yaml 2.9.1)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0002

**What to build:** The dispatcher interface (`runCaptchaSolve`, stats, recycle request, shutdown) and message protocol stay; module-level state becomes an object owned by the deep module; the current Worker moves behind a transport seam as the thread transport. No behaviour change.

**Acceptance criteria:**

- [ ] `captcha-solver` suite with fixture backends passes unchanged through the seam (seam 3); `captcha-pool` no longer needs `mock.module` for the solver.
- [ ] S2 per-generation HWM and retained MB within ±10 % of the preceding run on the same leg (loop).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 17

## Comments
