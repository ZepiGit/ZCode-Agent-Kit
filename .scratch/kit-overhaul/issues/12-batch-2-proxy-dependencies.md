# 12: Batch 2 — proxy dependencies: happy-dom 21.0.4 (loading flags kept), undici 8.12.4, yaml 2.9.1

**Blocked by:** 11 (Batch 1c — Bun 1.4.4 bootstrap in the installers, pinned proxy typecheck, 1.4.4 attribution runs)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0007

**What to build:** happy-dom `^21.0.4` with `enableCSSFileLoading: true` and `enableIframePageLoading: true` (surface unchanged, not stricter), undici `^8.12.4`, yaml `^2.9.1`. The captcha suite runs green right after the happy-dom bump, before any other captcha-path change.

**Acceptance criteria:**

- [ ] `captcha-happy`, `captcha-solver`, `captcha-cdn-cache` suites green on the happy-dom commit alone; full `test:proxy` green after the batch.
- [ ] `bun audit` shows the happy-dom/undici advisories from drift.md resolved.
- [ ] Both `memory-budget` legs green (entries handled as in 09).
- [ ] A test asserts that the happy-dom Window is constructed with `enableCSSFileLoading: true` and `enableIframePageLoading: true`, and fails if either flag is removed (ADR-0007, B1).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 127, 128

## Comments
