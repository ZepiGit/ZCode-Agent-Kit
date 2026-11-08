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
- 2026-11-08 (implementer, branch `ticket/25-bounded-collections`; implementation 19f4a5e, 9ce256a, 4a279e0, 5f09f4b, d17f7ce, list edit 58dd838; integration tip b470684 (with ticket 67) merged in e41c9ad; the head SHA is in the final report).
  - **What changed.** New `zcode-proxy-src/src/runtime/bounded-collection.ts`: LRU with entry limit, byte budget (size recorded once at insert; a value above the budget or with a non-finite/negative size is refused and leaves the collection unchanged), optional TTL (`now - storedAt > ttlMs`, a read does not extend it) and an injected clock; `set`/`get` take an optional timestamp so a caller can use one clock reading. `responses/store.ts` delegates to it (same API, same defaults 1,000 / 24 h / 64 MB, same refusal, eviction order and TTL boundary; `Date.now()` read once per call as before). `captcha-cdn-cache.ts`: the memory tier is a bounded collection, ≤ 256 entries and ≤ 32 MiB of bodies (see decision 1), LRU; new read-only `memoryUsage()`. New `captcha-stall-counts.ts` (`StallCounts`, ≤ 1,024 URLs, count only, oldest first, no TTL) replaces the `_stallCounts` Map in `captcha-happy.ts`; the stall path keeps its order (pe filter → bypass flag → count → at 2: log line, invalidate, reset) and its try/catch. Dead `solveTimes` deleted. New export `captchaGenerationResources()` (the generation's CDN cache and stall counters, diagnostics and tests). What the solver fetches, from where, and how it behaves is unchanged (B1): an evicted memory entry is read back from its disk envelope (same bytes, same `fetchedAt`) or, without one, fetched again.
  - **Captcha suites, first and last (B1):** tip 133 pass / 0 fail in 13 files (`reports/t25-captcha-first.log`); head 146 pass / 0 fail in 15 files = the same 133 + 13 new (`reports/t25-captcha-last.log`). Pre-existing captcha test files: additions only (`captcha-cdn-cache.test.ts` +7 tests); fixture `__fixtures__/solver-backend.ts` gained the scenes `cdn-fill`, `stall-fill`, `stall-evict`, `resources`.
  - **Full suite at the merged head e41c9ad:** `npm run test` 836 tests, 817 pass, 0 fail, 19 skipped; `npm run test:proxy` 1410 pass, 0 fail, 95 files (tip 1384: +26 new); `test:proxy-typecheck` clean; `npm run test:mcp` 97 tests, 96 pass, 0 fail, 1 skipped; `bun build --compile --target bun-linux-x64` with the worker entrypoint 659 modules ok; `pack/build.mjs --tracked-only` + `verify-payload` OK (`__fixtures__` stays out of the payload).
  - **RED → GREEN (every RED run with egress blocked: `HTTP(S)_PROXY`/`ALL_PROXY`/`ZCODE_PROXY_UPSTREAM_PROXY` → closed port 127.0.0.1:19259; a probe showed Bun `fetch` refused in the main thread and in a Worker; no RED run reached the solve path).**
    - Seam 6 `runtime/bounded-collection.test.ts` (13 tests: count, LRU refresh, replace, zero limit, bytes, oversized refusal keeping held entries, uncountable sizes, release on delete/clear, 5,000-op mixed sequence never above either bound, TTL boundary on a fake clock, caller timestamp, no extension on read, no TTL): RED at import (`reports/t25-red-slice1.log`), GREEN.
    - Seam 3 CDN, `captcha-cdn-cache.test.ts` (+7: 256 entries with the evicted entry served from disk with identical bytes/sha/`fetchedAt`, 32 MiB, LRU keep, bounded disk promotion and network loads, a body above the budget served and kept on disk but not in memory, bounded with the disk tier unavailable (evicted entry fetched again), invalidation releases bytes): RED on the tip's cache (`reports/t25-red-slice3.log`; the LRU test on behaviour, `memory` instead of `disk`), GREEN; the 32 MiB tests RED against a 64 MiB mutant (2 fail), restored from 4a279e0.
    - Seam 3 B1, `captcha-stall-counts.test.ts`: a recording of the PRE-change code (`__fixtures__/stall-recording.json`: 2,000 stalls and solves over 48 pe URLs, other CDN URLs, `""` and `null`; recorded by evaluating the verbatim text of captcha-happy.ts @ 8e11d15 lines 186–205 and the success-path delete with recorders) replays with the same 392 invalidations at the same events, the same eviction counts (all 2) and the same 1,060 cache-bypass stalls. Plus the bound: 1,025 URLs → 1,024 held, oldest forgotten (its next stall counts as the first), newest evicts at its second stall; 10,000 distinct URLs never above 1,024; non-pe URLs never counted. RED at import (`reports/t25-red-slice4.log`), GREEN. Mutants (restored from 5f09f4b, `reports/t25-mutate-stalls.log`): evict at 3, solve keeps count, no restart after evict, case-insensitive filter, cap 512, unbounded: 6/6 killed.
    - Seam 3 dispatcher, `captcha-generation-bounds.test.ts` (real worker, fixture backend, the generation's real captcha-happy resources): two stalls evict a cached pe URL (`evict:memory:none`); inside one generation 300 × 1 KiB → 256 entries, then 40 × 1 MiB → 32 entries / 33,554,432 bytes, 1,100 stall URLs → 1,024; the next generation starts at `cdn:0:0:stalls:0`. RED on the integration tip (test + fixture copied into a clean base tree: `Export named 'captchaGenerationResources' not found`, `reports/t25-red-slice5-tip.log`), GREEN. Mutants (restored from d17f7ce, `reports/t25-mutate-gen.log`): CDN without entry limit, CDN without byte budget, stall evict without invalidate, unbounded stall counters: 4/4 killed (e.g. `stalls:1100`).
    - Responses store preservation (suite unchanged, 8 pass; handler and protocol suites pass): 6 mutants of the lifted module judged by the unchanged store suite (`reports/t25-mutate-store.log`, restored from 19f4a5e): 5 killed; "no oversized refusal" survives it (the oversized entry is inserted and evicted at once, same size/bytes) and is killed by the seam 6 test "refuses a value larger than the whole budget and keeps what it already holds".
  - **Memory, Linux S2/short** (`node tests/memory/run.mjs S2 --profile short`, systemd cap 6G, Node 26.7.0, Bun 1.4.2, egress blocked; before = clean detached base tree at 8e11d15, after = 58dd838's tree before the 67 merge (phase D code identical); alternated; run dirs `/home/AgentKit/overhaul-tools/t25-memloop/{before,after}`):

    | run | cdn-cache:memory-growth (MB, budget 64) | cost per generation (MB) | procPeak:scenario (MB) | retained before recycle (MB) | growth:scenario %/1k |
    |---|---|---|---|---|---|
    | before-1 | **151 RED** | 987.8 | 1014.7 | 690 | −2.46 ok |
    | after-1 | **57 ok** | 1116.1 | 1148.5 | 688 | −5.18 ok |
    | before-2 | **151 RED** | 1067.7 | 1092.1 | 688 | 13.93 RED |
    | after-2 | **57 ok** | 1044.5 | 1093.4 | 689 | −3.98 ok |
    | before-3 | **151 RED** | 995.4 | 1024.3 | 689 | 29.42 RED |
    | after-3 | **57 ok** | 963.1 | 988.6 | 688 | 10.18 RED |

    The solver checks (58's names) stay within their run-to-run spread; only the CDN check moves. Replayed through the merged ratchet (67's owners schema) with the edited list: the 3 after runs pass (`RED on … owned by ticket 58 (…)`); the 3 before runs and the 64 MiB run fail with `RED on cdn-cache:memory-growth, not owned by ticket 58`, so a regression of the removed name comes back as a question.
  - **Expected-RED:** `cdn-cache:memory-growth` removed from `S2/short` (linux, windows) under `owners."25"` (58dd838; Round 15 Q1 condition 5; not a `flips` name). The entry stays for 58. Windows: **pending CI** (the pre-merge run's windows memory leg must show `cdn-cache:memory-growth` ok; if it is RED, the ratchet fails it as unowned and it comes back with the numbers).
  - **Decision 1 (two-way door, for the Owner Proxy to confirm): bodies capped at 32 MiB, not 64 MiB.** The spec bound "CDN memory ≤ 64 MB and ≤ 256 entries" is kept as the memory the tier costs. Holding 64 MiB of bodies cannot meet it: the runtime keeps the memory of evicted bodies on top of the held bytes. Full S2/short, one run each: 64 MiB held → 90 MB RED (9ce256a), 32 MiB → 58 MB, 24 MiB → 50 MB (a steady +26 MB). Phase D alone in a fresh process: 64 → 101, 48 → 85, 40 → 77, 32 → 70 MB (+37 MB). A plain JS array keeping the last 256 of 600 256-KiB buffers shows +141 MB right after and +74 MB 3 s later, so the overhead belongs to the runtime's allocator, not to the cache. 32 MiB is the largest power-of-two budget that meets the 64 MB check in S2 (6–7 MB margin on Linux). The 256-entry limit is unchanged. No bytes served change: misses go to the disk envelope or the network as before. The windows leg (commit charge) may differ. Round 20 Q1 adds: phase D alone in a fresh process measures 70 MB at 32 MiB (above 64), so the GREEN (57–58 MB, 6–7 MB margin on Linux) holds inside full S2/short, where phases A–C have warmed the allocator; and a read-back from a directory shared with another installation may return that installation’s newer envelope for the same URL, as every generation start already does (pre-change behaviour, recorded, not claimed never to happen).
  - **Decision 2:** the stall counters' "oldest" is the least recently stalled URL (a stall re-inserts the count). Below the cap the order never matters (B1 replay); above it, the documented effect is that the forgotten URL's next stall counts as the first.
  - **Decision 3:** the CDN cache's `blockedDisk` tombstones (one per URL whose unlink failed) stay unbounded: dropping one would re-serve an invalidated disk entry (B1). They grow only with failed deletions inside one generation. `pending`/`generations` are bounded by the in-flight loads.
  - **Common acceptance:** no new log events (the `[pe-cache-evict]` line is the existing one, byte-identical), config keys or env overrides. The new test files run in `npm run test:proxy` (bun discovers `*.test.ts`). The ubuntu/windows `test-kit` and `memory-budget` CI legs are **pending CI (orchestrator verifies after merge+push)**.
  - **For other tickets:** 24 changes `captcha-solver.ts` and adds one fixture scene (`env:`); merging it should only touch the fixture's switch. 27/28: the generation reset holds wherever `captcha-happy` is loaded once per generation (thread or child); `captcha-generation-bounds.test.ts` goes through `runCaptchaSolve`, so it keeps proving it after the transport switch. 29: the disk tier is untouched by this ticket. 31/36 (MCP): the module is proxy TypeScript; sharing it with the MCP package needs a byte-identical copy with a drift test (ticket 68's pattern). Spec §7 / METRICS: the S2 CDN row could name the 32 MiB body budget beside the 64 MB memory bound (docs, not done here).
- 2026-11-08 (orchestrator, Owner Proxy round 20): Round 20 Q1 confirms Decision 1 (≤ 32 MiB of bodies, constant, no config key; 256 entries and the 64 MB check unchanged) and moves its B1 proof into Acceptance (seam 3 replay; S2 cannot count fetches: phase D only calls put() and egress is blocked). Decision 1's text gains: phase D alone measures 70 MB at 32 MiB, so the GREEN (57–58 MB, 6–7 MB margin on Linux) holds inside full S2/short; and a read-back from a shared directory may return another installation's newer envelope for the same URL, as every generation start already does. (Decision 1 is not yet in this file on the integration branch, so these three facts are recorded here.)
- 2026-11-08 (implementer, round 2, Owner Proxy round 20 Q1; replay 3e5cc33; integration tip e056af6 merged in 5ac0898 and 064cfec in 6cdbacf; the head SHA is in the final report). Ticket 24 had not landed, so it is not merged.
  - **Condition 1:** the cap stays the code constant `CDN_MEMORY_MAX_BYTES` (32 MiB), with no config key and no env override. To run replay (c), the cache constructor takes a test-only `memoryMaxBytes` option (`CdnCacheOptions`, documented "tests only; production always uses CDN_MEMORY_MAX_BYTES"). No production call site passes it (`captcha-happy.ts` constructs `new CaptchaCdnCache()`).
  - **Condition 2: seam-3 replay** `src/proxy/captcha-cdn-replay.test.ts` (3 tests, run by `npm run test:proxy`).
    - Recording `__fixtures__/cdn-sequence.json`: 2,527 calls of one generation. It has 373 URLs and 106.2 MiB of bodies: 72 pe bundles of 0.75–1.25 MiB, one 33 MiB bundle, and 300 small SDK files, so both the 256-entry and the byte caps evict. It includes repeat reads of evicted URLs, 20 stall invalidations, concurrent pairs, and a 10-minute TTL expiry on a fake clock. Ops follow captcha-happy's interceptor: async `get ?? load`, sync `get ?? put`, plain `get`, `invalidate`. The generator is `/home/AgentKit/overhaul-tools/t25-scratch/record-cdn-sequence.mjs`.
    - Pre-change cache: `__fixtures__/captcha-cdn-cache.8e11d15.ts`, verbatim. The test checks its git blob id `1b047f1c…` (= `git rev-parse 8e11d15:zcode-proxy-src/src/proxy/captcha-cdn-cache.ts`).
    - Network: a local fixture whose n-th fetch of a URL returns version n of its body, so a spurious refetch changes the bytes. Run under the egress block. `noegress.sh` now also lists `[::1]` in `NO_PROXY`; without it the IPv6 loopback server test was routed to the dead proxy port.

    | replay (temp disk tier) | fetches (`fetchBody` + sync) | served calls | from memory | from disk | from network | equal to (a): fetch log, bytes, sha256, fetchedAt |
    |---|---|---|---|---|---|---|
    | (a) pre-change @ 8e11d15, unbounded | 428 | 1,254 | 825 | 0 | 428 | — |
    | (b) head, 32 MiB | 428 | 1,254 | 513 | 312 | 428 | yes |
    | (c) head, 64 MiB | 428 | 1,254 | 517 | 308 | 428 | yes |

    Fetches after the TTL expiry: 35 in every replay. Disk tier unavailable (recorded, not a gate): (a) 428, (b) 735, (c) 734 fetches.
  - **RED → GREEN.** Before `memoryMaxBytes` existed, (c) ran at 32 MiB and the check "64 MiB evicts less than 32" failed: 312 disk reads in both (`reports/t25-r2-red-replay.log`). GREEN at 3e5cc33 (`reports/t25-r2-green-replay.log`). The equality itself pins behaviour that already holds, so it is proven by mutants. Each was applied to the committed `captcha-cdn-cache.ts` and restored with `git checkout 3e5cc33 --`; `git diff` was empty after each (`reports/t25-r2-mutate-replay.log`):
    - "read-back resets fetchedAt": killed, same 428 fetches but the served `fetchedAt` differs (…000250 vs …020880).
    - "read-back skips the freshness check": killed, 393 fetches instead of 428 (stale envelopes served after the expiry).
    - Extra mutant "commit writes no disk envelope": killed.
  - **Full suite at 6cdbacf:**
    - `npm run test`: 836 tests, 817 pass, 0 fail, 19 skipped.
    - `npm run test:proxy`: 1413 pass, 0 fail, 96 files (+3).
    - Typecheck clean.
    - `npm run test:mcp`: 97 tests, 96 pass, 0 fail, 1 skipped.
    - Linux compile: 659 modules. Pack + `verify-payload` OK (`__fixtures__` excluded).
    - Captcha suites last: 149 pass, 0 fail, 16 files (`reports/t25-r2-captcha-last.log`).
  - **Pending CI (orchestrator verifies after merge+push):** windows `memory-budget` S2/short `cdn-cache:memory-growth` ok at 32 MiB (Round 20 Q1 condition 3); the linux leg; `test-kit` on ubuntu/windows × Node 24/26.
- 2026-11-08 (implementer, round 3: Windows test time; fix 754c254; integration tip with ticket 26 (87da391) merged in 102b0c1; the head SHA is in the final report). Ticket 24 has not landed, so it is not merged.
  - **Cause.** Windows test-kit Node 24 in staging run 42455986931 failed "bounds promotion from disk and network loads as well as puts" at 5.98 s (bun's default is 5 s). The cause was fsync, not the bound. Every `put`/`load` commits a disk envelope with `fsyncSync`. Locally, 300 small puts take 833 ms with fsync, 29 ms with fsync stubbed and 4 ms with no disk tier. Windows runners flush more slowly. Run 42461329252 (round-2 tree), windows N24 / N26:
    - replay, disk available: 18.1 / 17.6 s;
    - promotion test: 3.9 / 3.4 s;
    - generation bounds: 3.4 / 3.1 s;
    - replay, disk unavailable: 2.8 / 2.8 s;
    - 256-entry + read-back test: 2.1 / 1.7 s;
    - LRU test: 1.7 / 1.5 s.

    A second cost, local only: `toMatchObject` on a 1 MiB Buffer compares it element by element (882 ms; `Buffer.equals` < 1 ms).
  - **Changes (tests only; no product code changed in this round):**
    - `captcha-cdn-cache.test.ts`, the ticket's 7 bound tests, now 9:
      - The count, byte, LRU, load and invalidation bounds run without a disk tier (the directory is a regular file); the bound is a memory property. They still use the production constants, 256 entries and 32 MiB.
      - Disk read-back keeps a real disk tier with 3–8 small envelopes, using the test-only `memoryMaxBytes` to evict cheaply. It covers: an evicted entry served from disk with the same bytes, sha256 and `fetchedAt` while the clock has moved on; the read-back promoted under the same bound; promotion from 8 envelopes bounded to 4 KiB; a body above the budget served and kept on disk only.
      - The 32 MiB refusal of an oversized body is a separate test without a disk tier, and `Buffer.equals` replaces `toMatchObject`.
    - `captcha-generation-bounds.test.ts`: the worker's `CAPTCHA_CDN_CACHE_DIR` is a regular file, so the 340 fills cost no I/O. The disk side of invalidation stays proven in `captcha-cdn-cache.test.ts`. The stall → invalidate wiring stays proven here ("stall-no-invalidate" is killed). The 30 s timeout is unchanged, with the measured times in a comment.
    - `captcha-cdn-replay.test.ts`: the disk tier stays real (temp files, atomic rename, read-back; b 312 and c 308 disk reads, asserted), but `fs.fsyncSync` is a no-op during each replay. fsync decides durability across a crash, never what the process reads back, and the stub applies to all three caches alike. Timeout 120 s → 60 s, with the measured times stated; the work is fixed by the recording. Replay results are unchanged: 428 / 428 / 428 fetches, identical bytes, sha256 and `fetchedAt`; disk unavailable 428 / 735 / 734.
    - `bounded-collection.test.ts` and `captcha-stall-counts.test.ts`: no file I/O, ≤ 17 ms per test. Unchanged.
  - **Local timings, 3 runs** (`reports/t25-r3-timing.log`; before = the same files at 9866ff0):
    - replay, disk available: 3.4–3.6 s (was 16.5 s);
    - replay, disk unavailable: 2.6–2.8 s (CPU: hashing ~0.8 GiB of served bodies and allocating fixture bodies per replay);
    - generation bounds: 0.37–0.38 s (2.1 s);
    - promotion: 71–78 ms (2.2 s);
    - 32 MiB: 54–57 ms (2.1 s);
    - 256 entries: 4–5 ms (1.0 s);
    - LRU: 3 ms (0.9 s);
    - every other new test ≤ 42 ms.
  - **Still proving what they proved** (mutants applied to the committed code and restored from 754c254, `reports/t25-r3-mutate.log`):
    - CDN budget at 64 MiB, no entry limit, no byte budget, `memoryMaxBytes` ignored, read-back resets `fetchedAt`, no promotion, no LRU refresh: 7/7 killed by the rewritten CDN and generation tests.
    - Generation: unbounded count, stall without invalidate, unbounded stall counters: 3/3 killed. That script's byte-budget mutant no longer matches the round-2 constructor; "no byte budget" above covers it.
    - Replay: read-back resets `fetchedAt`, read-back skips freshness, no disk envelope: 3/3 killed.
  - **Full suite at 754c254:** `npm run test` 836 tests, 817 pass, 0 fail, 19 skipped; `npm run test:proxy` 1418 pass, 0 fail, 96 files; typecheck clean; `npm run test:mcp` 97 tests, 96 pass, 0 fail, 1 skipped. Captcha suites last: 154 pass, 0 fail, 16 files (+5 from ticket 26's egress tests and this round's split).
  - **Pending CI:** the windows test-kit legs on the new tree. Expected: no new test near 5 s; the replay at an explicit 60 s.
