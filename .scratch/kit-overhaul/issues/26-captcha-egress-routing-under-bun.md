# 26: Captcha egress routing under Bun

**Blocked by:** 12 (Batch 2 — proxy dependencies: happy-dom 21.0.4 (loading flags kept), undici 8.12.4, yaml 2.9.1)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: —

**What to build:** On Bun, captcha fetches (`captchaFetch` and the sync-XHR worker path) use `proxy: <ZCODE_PROXY_UPSTREAM_PROXY> ?? false`; Node keeps the dispatcher. Routing only; what is fetched does not change.

**Acceptance criteria:**

- [ ] Seam 3 test with a local recording proxy: set → all captcha egress goes through it; unset with ambient `HTTP(S)_PROXY` set → no proxy used.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 130

## Comments
