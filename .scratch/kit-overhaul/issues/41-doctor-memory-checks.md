# 41: `doctor` memory checks: proxy memory, solver memory, cap enforcement, restart budget

**Blocked by:** 39 (Observability fields in `/health` details, `proxy status` and `--json`), 40 (UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0010 (Round 3 amendment)

**What to build:** Four checks with the PASS/WARN/SKIP rules and next commands of ADR-0010's amendment: macOS `sampling` → PASS with a note; Linux without a delegated controller → WARN pointing to `systemctl --user status` and the README section; solver WARN only during fail-fast or after a recent abnormal exit; restart budget exhausted → WARN. `doctor` triggers no new sampling.

**Acceptance criteria:**

- [ ] Seam 5 record tests for every rule branch with injected status data; snapshots in every C3 variant.
- [ ] Off-TTY rows match the regex; JSON check names stable and new entries additive.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 84, 85, 86, 87

## Comments
