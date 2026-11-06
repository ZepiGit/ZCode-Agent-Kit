# 46: UX batch (c2): `accounts` (+health), `auth status`, `models`

**Blocked by:** 40 (UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: 0001, 0005

**What to build:** Account tables with an active marker, one number format and `zcode-kit …` in next steps (A-19, A-27); `auth status` as text on a TTY, today's exact JSON when stdout is not a TTY, JSON on a TTY with `--json`; `models` through `Out`.

**Acceptance criteria:**

- [ ] `auth status` piped output byte-identical to the pre-change JSON; `--json` on a TTY identical too.
- [ ] Snapshots in every C3 variant; JSON superset tests.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 95, 102, 114

## Comments
