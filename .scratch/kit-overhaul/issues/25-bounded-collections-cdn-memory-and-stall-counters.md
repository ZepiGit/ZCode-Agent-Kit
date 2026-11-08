# 25: Bounded-collection module; CDN memory cache and stall counters bounded

**Blocked by:** 12 (Batch 2 — proxy dependencies: happy-dom 21.0.4 (loading flags kept), undici 8.12.4, yaml 2.9.1)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0009

**What to build:** The responses store's LRU/TTL/byte-budget/injected-clock logic is lifted into one module (responses store behaviour and tests unchanged). The CDN memory cache is bounded to ≤ 64 MB of memory (`cdn-cache:memory-growth`) and ≤ 256 entries, holding ≤ 32 MiB of bodies (Round 20 Q1), and resets with each solver generation; stall counters to 1,024 entries, count only, oldest first, no TTL. Dead `solveTimes` deleted. The bytes served do not change (B1).

**Acceptance criteria:**

- [ ] Seam 6: eviction by count, bytes and TTL with a fake clock; responses-store suite unchanged.
- [ ] Seam 3: CDN memory and stall bounds hold inside one generation.
- [ ] Loop S2: CDN memory ≤ 64 MB (baseline +151 MB / 600 URLs). The `S2/short` entry stays until 58 (solver part still RED).
- [ ] Loop S2 (linux, windows): `cdn-cache:memory-growth` GREEN (CDN memory ≤ 64 MB); **remove `cdn-cache:memory-growth` from `S2/short` in `expected-red.json`, with the evidence Round 15 Q1 condition 5 requires.**
- [ ] Seam 3 (B1): for a recorded sequence of stalls and solves below 1,024 URLs, the CDN invalidation decisions (which pe URLs are evicted, and when) are identical to the pre-change code.
- [ ] Seam 3 (B1, Round 20 Q1): a recorded load/get/invalidate sequence within one generation (bodies > 64 MiB in total, repeat reads of evicted URLs, stall invalidations, a TTL expiry on a fake clock), replayed with a temp disk tier against the pre-change cache (8e11d15, verbatim, unbounded memory), head at 32 MiB and head at 64 MiB, makes identical `fetchBody` calls (URL, order, count) and returns identical bytes, `sha256` and `fetchedAt` (only `source` may differ); mutants "read-back resets fetchedAt" and "read-back skips the freshness check" are killed; the fetch counts with the disk tier unavailable are recorded for all three. A difference with the disk tier available comes back with the numbers.
- [ ] Loop S2 windows (Round 20 Q1): the pre-merge CI windows memory leg shows `cdn-cache:memory-growth` ok at 32 MiB; if RED it comes back with commit, working set and the Linux value — the cap, the list and the 64 MB budget are not changed.

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
- 2026-11-08 (orchestrator, Owner Proxy round 20): Round 20 Q1 confirms Decision 1 (≤ 32 MiB of bodies, constant, no config key; 256 entries and the 64 MB check unchanged) and moves its B1 proof into Acceptance (seam 3 replay; S2 cannot count fetches: phase D only calls put() and egress is blocked). Decision 1's text gains: phase D alone measures 70 MB at 32 MiB, so the GREEN (57–58 MB, 6–7 MB margin on Linux) holds inside full S2/short; and a read-back from a shared directory may return another installation's newer envelope for the same URL, as every generation start already does. (Decision 1 is not yet in this file on the integration branch, so these three facts are recorded here.)
