# 25: Bounded-collection module; CDN memory cache and stall counters bounded

**Blocked by:** 12 (Batch 2 — proxy dependencies: happy-dom 21.0.4 (loading flags kept), undici 8.12.4, yaml 2.9.1)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0009

**What to build:** The responses store's LRU/TTL/byte-budget/injected-clock logic is lifted into one module (responses store behaviour and tests unchanged). The CDN memory cache is bounded to ≤ 64 MB and ≤ 256 entries and resets with each solver generation; stall counters to 1,024 entries, count only, oldest first, no TTL. Dead `solveTimes` deleted. The bytes served do not change (B1).

**Acceptance criteria:**

- [ ] Seam 6: eviction by count, bytes and TTL with a fake clock; responses-store suite unchanged.
- [ ] Seam 3: CDN memory and stall bounds hold inside one generation.
- [ ] Loop S2: CDN memory ≤ 64 MB (baseline +151 MB / 600 URLs). The `S2/short` entry stays until 58 (solver part still RED).
- [ ] Loop S2 (linux, windows): `cdn-cache:memory-growth` GREEN (CDN memory ≤ 64 MB); **remove `cdn-cache:memory-growth` from `S2/short` in `expected-red.json`, with the evidence Round 15 Q1 condition 5 requires.**
- [ ] Seam 3 (B1): for a recorded sequence of stalls and solves below 1,024 URLs, the CDN invalidation decisions (which pe URLs are evicted, and when) are identical to the pre-change code.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 62, 65

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 15): Q1 conditions 3 and 7 — added "remove `cdn-cache:memory-growth` from `S2/short`"; 25 owns that one S2 check on both legs (its "CDN memory ≤ 64 MB" criterion), and 58 owns the solver names in the same entry.
- 2026-11-08 (orchestrator, Owner Proxy round 17): Round 17 Q1: 25 does not own `responses-store:heap-at-cap`. Its lift keeps the store unchanged. (The windows S7/short RED on that check, run 42436010878, is handled by ticket 71's retained-heap measurement rule, not by an owner.)
