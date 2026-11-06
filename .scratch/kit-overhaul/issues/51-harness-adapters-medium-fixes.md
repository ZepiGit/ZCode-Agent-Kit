# 51: Harness adapters: confirmed MEDIUM fixes and record refresh

**Blocked by:** 50 (Harness adapters: HIGH fixes (Continue, Kilo Code))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: —

**What to build:** Each MEDIUM candidate (Claude Code effort/capabilities, OpenCode Flash `modalities.input`, Goose `supports_vision`, Cline CLI config path, Kilo per-model reasoning/modalities, OMP `auth: apiKey` and unsupported compat fields, pi `thinkingLevelMap`) is applied only where `research/harness-configs.md` confirms it from primary docs; UNVERIFIED items and OpenCode V1 schema left unchanged; recorded versions and `primarySource` dates refreshed only for what was re-verified.

**Acceptance criteria:**

- [ ] One fixture per applied item, byte-idempotent; a test asserts each UNVERIFIED item's output is unchanged.
- [ ] The ticket lists each candidate as applied/left with its primary-doc link.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 133, 134, 135

## Comments
