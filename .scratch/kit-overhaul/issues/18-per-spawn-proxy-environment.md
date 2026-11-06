# 18: Per-spawn proxy environment: stop token and log dir set by the manager, token stripped from the respawn hook

**Blocked by:** 15 (Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets)), 21 (Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0014 (Round 4 amendment), 0015 (Round 4 amendment)

**What to build:** At every proxy spawn the manager sets `ZCODE_KIT_STOP_TOKEN` (fresh 256-bit token, also written as an additive field in `proxy.pid`) and `ZCODE_KIT_LOG_DIR` (its own logs dir), overwriting inherited values. The proxy removes the token from the respawn hook's environment. `ZCODE_KIT_LOG_DIR` is internal; a proxy without it keeps today's behaviour. The token never appears in logs, status, JSON, doctor, snapshots or error text.

**Acceptance criteria:**

- [ ] `proxy-env` suite (seam 8): ambient bogus values for both variables → the spawned proxy gets the manager's logs dir and a new token; the respawn hook's environment has no stop token.
- [ ] Seam 2: the token in the proxy's environment equals the one in `proxy.pid`; two consecutive spawns get different tokens; `proxy.pid` written with owner-only mode.
- [ ] Redaction test: the token value appears in no captured output of `status`, `--json`, `doctor` or logs.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 55, 56

## Comments

- 2026-11-06 (orchestrator, from ticket 14): generate the stop token as 32 random bytes base64url (43 chars, same shape as the proxy key) and add it to the manager's knownSecrets() so event-line redaction masks it (see ticket 14 Comments).
