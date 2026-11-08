# 29: CDN disk cache pruning

**Blocked by:** 25 (Bounded-collection module; CDN memory cache and stall counters bounded)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0009

**What to build:** The disk cache stays ≤ 256 MB (oldest first), pruning only entries already expired at max(14 days, configured TTL), at start and after each write, skipping temp files and files being written, tolerating `ENOENT`, safe with several installations sharing the directory.

**Acceptance criteria:**

- [ ] Temp-dir tests (seam 3/6): size bound, expiry-only pruning, temp/in-progress files skipped, concurrent pruners with vanishing files never throw or corrupt.
- [ ] Retention-pruning migration replayed twice is a no-op.
- [ ] An entry 15 days old under a configured TTL of 20 days is kept; an entry 21 days old is pruned (Round 2 Q3 condition 2).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 63, 64, 135

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 20): Round 20 Q1: the memory tier holds ≤ 32 MiB of bodies, and an entry evicted from memory is read back from its disk envelope. 29's size prune therefore decides when such an entry becomes a network fetch; 29's B1 evidence ("without serving different bytes") covers that case.
