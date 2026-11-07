# 47: UX batch (c3): `run`, `update`, `rollback`, `uninstall`

**Blocked by:** 40 (UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details), 37 (`process.execve` handover in `zcode-kit run` and the `ZCODE_KIT_RESIDENT_LAUNCHER=1` opt-out)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0005

**What to build:** `run` writes every kit line to stderr, so `zcode-kit run … | jq` sees only the harness's output; `update` shows numbered steps and prints the connection details once at the end (A-25); `rollback`/`uninstall` end with a verdict counting restored/removed files and WARN blocks for conflicts (A-24).

**Acceptance criteria:**

- [ ] Spawn test: `run` with a fake harness → stdout contains only harness bytes (seam 5).
- [ ] Snapshots in every C3 variant; exit codes unchanged.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 93, 95, 112, 113

## Comments
