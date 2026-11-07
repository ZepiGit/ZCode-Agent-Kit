# 10: Batch 1b — Node 24 support floor, refuse before mutation, autostart Node-path check

**Blocked by:** 09 (Batch 1a — CI toolchain: actions v7, Bun 1.4.4 in CI, nested proxy workflows removed)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0006

**What to build:** `engines.node >=24` in all three manifests; `install.sh`, `install.ps1` and the pack build gate at 24 with the exact upgrade step; `setup`/`update` on Node < 24 refuse before mutating state (what/why/next) and leave the installation working; the preflight reports when the OMP autostart's pinned Node path is below the floor or missing; DEP0190 in the pack build fixed.

**Acceptance criteria:**

- [ ] Temp-HOME installer fixtures (seam 8): fake Node v20 and v22 are rejected before any file changes (state dir byte-compared before/after); v24 and v26 pass; installer tests' fake versions moved to 24/26.
- [ ] Preflight fixture: pinned autostart Node v22 → WARN with the next command; missing path → WARN; v24+ → silent (seam 8).
- [ ] Pack build runs with no DEP0190 warning.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 124, 125

## Comments
