# 19: Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract

**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24), 14 (Event-line format and redaction for new log events (prefactor))

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0004

**What to build:** In-flight bytes count from body read until sent upstream, capped at 64 MB (config key + `proxyEnv` exception env override). Queued requests have unread bodies (socket backpressure); the queue is FIFO, bounded by a documented count and 15 s. Overflow/timeout sheds HTTP 503 + `Retry-After` in the endpoint's own shape (OpenAI `error` object; Anthropic `overloaded_error`), never 429, never a reset. Open response streams are not limited. The shed helper is reused by the supervisor (21) and the solver fail-fast (58). Admission counters (`inFlightBytes`, `queued`, `shedTotal`) are exposed internally for 39.

**Acceptance criteria:**

- [ ] Loopback tests (seam 4): byte cap holds; queued bodies unread (server-side read counter); FIFO order; count bound and 15 s bound each shed with the right shape per endpoint; no 429 anywhere; 17+ concurrent streams not limited.
- [ ] Loop S1 (Round 18 Q1): `procPeak:proxy` improves by ≥ 30 % at S1/burst16 and S1/burst32 on each leg. Linux: the tip f906014 against this branch (burst16 912.9 → 488.6, 5-run median; burst32 1,272.4 → 549.7, 20-run median). Windows: the median of the ≥ 10 staging/19 CI runs (Round 18 Q2 condition 1) on the WS gate, against the median of ticket 67's matching windows runs on the pre-19 tree. S1/burst4 and S1/bigbody are recorded per leg. The byte cap's hard bound is proven by the seam-4 loopback tests above. 19's `procPeak:proxy` names in `S1/burst4`, `S1/burst16`, `S1/burst32` and `S1/bigbody` (both legs) move to ticket 20 in 19's commit (Round 18 Q1 and Q2). The budgets (≤ 250 / 400 / 600 / 250 MB) are ticket 20's criteria. If windows misses ≥ 30 % at burst16 or burst32, 19 comes back with the numbers.
- [ ] Config key documented in `config.example.yaml`; invalid value rejected with what/why/next.
- [ ] Adversarial (C2): with nothing else in flight, a single request at today's maximum body size (32 MB wire, `handler.ts:859`; 64 MB inflated, `handler.ts:894`) is admitted and served, never shed. The cap rule is 'admit when in-flight bytes + this request ≤ cap, or when in-flight bytes are 0'. The ticket states how a body without `Content-Length` is accounted, and tests that the cap holds for concurrent chunked bodies.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 21, 22, 23, 24

## Comments

### 2026-11-08 — implementer

**Branch:** `ticket/19-admission-control` (worktree `/home/AgentKit/wt/t19`). Commits: `93cb559` (implementation), `cfdcbb9` (fix-forward after the mutation run), `ccd5d27` (expected-RED), `144c031` (merge of the integration tip `eec3f4a`); the head SHA is the commit that adds this comment.

**What landed**
- `zcode-proxy-src/src/server/admission.ts`: `createAdmission({ maxInFlightBytes, maxQueued, queueTimeoutMs, writeLog, collectAfterBytes, collect })`, `admissionCost`, `settleBodyBytes`, `shedResponse` (the reusable ADR-0004 helper for 21 and 58), `admissionShedWhy`. Admit rule: in-flight bytes + this request ≤ cap, or in-flight bytes = 0 (an idle proxy always admits). Strict FIFO (no overtaking), bounded by 64 waiting and 15 s. Overflow sheds 503 + `Retry-After: 2` in the endpoint's shape: `{"type":"error","error":{"type":"overloaded_error",…}}` on `/v1/messages` and `/async/v1/messages`; `{"error":{"message","type":"server_error","param":null,"code":"overloaded"}}` on `/v1/chat/completions`, `/v1/responses`, `/async/v1/chat/completions`. The message is what/why/next ("The proxy is busy and did not accept this request. Its body was not admitted because … while X MB of request bodies are in flight against a cap of 64 MB (server.admission.maxInFlightMB). Retry in 2 s; if this keeps happening, …"). Every shed writes one event line (ticket 14 format, component `shed`): `… WARN shed request shed reason=queue_full|queue_timeout endpoint=… bytes=… waitedMs=… inFlightBytes=… queued=… maxInFlightBytes=… retryAfterS=2`. Never 429, never a reset.
- `server.ts`: the five body routes run under `admitted(...)` after the host/origin/auth checks (a 401 is never queued). GET routes, `Content-Length: 0` and the stop request (when 18/22 add it: no body) bypass admission. The request body is a pull-only stream (`countedPullStream`, highWaterMark 0) that counts the bytes handed to handlers (`bodyBytesRead`, the server-side read counter). `ProxyServer.admission()` exposes `{ inFlightBytes, queued, shedTotal, peakInFlightBytes, maxInFlightBytes, maxQueued, queueTimeoutMs, bodyBytesRead }` for 39.
- `handler.ts readBody` and `async/handler.ts readBody` call `settleBodyBytes` once the body is read (and again with the inflated size for gzip). Bytes sent upstream, retries, rotation and anti-abuse code are untouched (B1): the only change in those files is the two settle calls.
- Config: `server.admission.maxInFlightMB` (optional, 1–4096, default 64), env `ZCODE_PROXY_ADMISSION_MAX_INFLIGHT_MB` (wins over the file; through the `proxyEnv` allowlist, `lib/proxy-env.mjs`). Invalid values stop the load with what/why/next, e.g. `server.admission.maxInFlightMB must be a whole number of MB from 1 to 4096 (got "lots"). It caps the request-body bytes the proxy holds at once; requests beyond it wait, then get 503 + Retry-After. Set it to a whole number such as 64 (the default) or remove the key.` Documented (commented out) in `proxy/config.example.yaml`, `zcode-proxy-src/config.example.yaml` and the vendored `template.ts`.

**Accounting (the ticket asks this to be stated)**
- A body with `Content-Length` is charged that length on admission. **A body without `Content-Length` (chunked) is charged 32 MiB, the largest wire body any handler accepts, until its reader has all of it; from then on the bytes really read.** A reservation is therefore never smaller than what the reader may still read, so the cap holds for concurrent chunked bodies (test below). A declared length above 32 MiB bypasses the queue and gets today's 413 unread.
- A gzip body is charged its inflated size once inflated. That growth is charged at once (the bytes exist), so in-flight bytes can pass the cap by at most the inflation of requests already admitted; nothing new is admitted until they are back under it.
- Bytes come back when the route handler has its response (upstream headers, plus the stream prelude), i.e. once no retry needs the body. A client that leaves ends the handler too (its body read or upstream fetch fails on the request signal). The response body after that is never limited.

**Tests (seam 4, `src/server/admission.test.ts`, 16 tests; the proxy runs on an ephemeral loopback port against an injected upstream that holds every request until released)**
1. cap holds: 12 × 7.5 MB against 32 MB → exactly 4 upstream at once, 8 queued, all 12 served, peak in-flight ≤ cap;
2. queued bodies unread: B (12 MB) queued behind A → server read counter grows < 1 MB while B waits, ≥ 12 MB after;
3. count bound: queue of 1 full → the next request on each of the 5 endpoints is shed at once (< 1 s) with the shape above, `shedTotal` 5, 5 event lines;
4. 15 s bound (300 ms injected): each endpoint shed after ≥ 280 ms in its shape, never 429, never reaches upstream;
5. documented defaults 64 MB / 64 / 15 s;
6. FIFO under contention: tiny requests that would fit next to A wait behind a 6 MB one; s3 waits behind M though it fits;
7. 20 concurrent streams whose bodies together exceed a 32 KB cap all start and stay open, admission holds 0 bytes for them;
8. idle rule: one 32 MiB wire body with an 8 MB cap is served; 9. a gzip body inflating to exactly 64 MiB is served at the default cap (peak charged 64 MiB);
10. oversized single body: declared 40 MiB → 413 at once, 0 bytes read, while others wait;
11. concurrent chunked bodies: 10 × ~4 MiB chunked → 8 upstream + 2 waiting unread, peak ≤ 64 MiB;
12. slow upload holding budget: it keeps its bytes while it trickles, a request behind it is shed at the time bound with < 1 MB read, then the slow upload is served and its bytes come back;
13. disconnect mid-upload → bytes back, the waiting request is admitted and served; 14. disconnect while upstream holds the request → same; 15. disconnect while queued → leaves the queue, no shed counted;
16. a released request of ≥ 4 MiB triggers one collection, five 512 KB ones none.
- `src/config/loader.test.ts`: +9 (optional/default, file value, env override, six invalid values with what/why/next, invalid env names the env var). `tests/proxy-env.test.mjs`: +1 (the env key passes, another `ZCODE_PROXY_ADMISSION_*` name stays stripped). No pre-existing test changed.

**RED → GREEN** (logs in the integration worktree's `reports/`)
- `t19-red1` (no-op admission: 12 upstream at once, "Expected: 4 Received: 12") → `t19-green1`.
- `t19-red2` (read counter missing) → `t19-green2`; `t19-red5` loader 9 fail → `t19-green5` 45/45; `t19-red6` proxyEnv 1 fail → `t19-green6` 6/6; `t19-green3c`/`t19-green4`/`t19-green7` 16/16 at seam 4.
- The final test file against the integration tip f906014 with a no-op `admission.ts` stub (`/home/AgentKit/wt/t19-tipred`, `t19-red-tip-seam4`): 12 fail, 3 pass. The 3 that pass on the tip are preservation pins (C2): open streams not limited, the idle 32 MiB body served, and the defaults test (passes on the stub only).
- Mutation run on the committed implementation (`t19-mutants`, script `/home/AgentKit/overhaul-tools/t19-scripts/mutants.py`, each mutant restored with `git checkout 93cb559 -- <file>`, `git status` clean after): M1 no idle rule → 5 tests fail; M2 small ones overtake → FIFO test; M3 503→429 → 3; M4 no count bound → 1; M5 no time bound → 1; M6 no settle → 2 (chunked, gzip); M7 bytes held for the whole response stream → streams test; M8 body read before admission → 3 (unread, slow upload, disconnect); M10 gzip not charged inflated → 1; M11 no collection → 1; M12 aborted waiter stays queued → 1; M13 oversized length queued → 1. **M9 (no release on the abort signal) survived**: a leaving client already ends the handler, so the extra release only under-counted bytes still held. `cfdcbb9` removes it and adds test 14.

**Full suites after merging the integration tip `eec3f4a`** (Bun 1.4.2, Node 26.7.0)
- `npm run test` (`t19-full-kit`): 817 tests, 798 pass, 0 fail, 19 skipped.
- `npm run test:proxy` (`t19-full-proxy`): 1410 pass, 0 fail, 93 files. `npm run test:proxy-typecheck`: pass.
- `npm run test:mcp` (`t19-full-mcp`): 97 tests, 96 pass, 0 fail, 1 skipped; `dist/` unchanged.

**Memory loop, linux (`node tests/memory/job.mjs --only …`, systemd cap, port 19190; procPeak:proxy = max(RSS, VmHWM))**

| run | tip f906014 (1 run) | cap only, no collection (2 runs) | 93cb559, 5 runs (median) | burst32 at cfdcbb9, 20 runs | final job 144c031 | budget | verdict |
|---|---|---|---|---|---|---|---|
| S1/burst4 | 366.2 | 407.7 | 371, 350.4, 296.2, 329.2, 319.5 (329.2) | — | 349.2 | 250 | RED (−10 %) |
| S1/burst16 | 912.9 | 673.3, 569.2 | 512.7, 524.5, 430.7, 488.6, 428.5 (488.6) | — | 508.1 | 400 | RED (−46 %) |
| S1/burst32 | 1,272.4 | 733.8, 677.8 | 582.2, 535.7, 573, 553.4, 574.7 (573) | median 549.7, min 479.8, max 608.5, 2 of 20 above 600 (602, 608.5) | 535.8 | 600 | GREEN (−57 %) |
| S1/bigbody | 417.8 | 447.9 | 344.5, 375.1, 329.8, 358.3, 361.9 (358.3) | — | 351.2 | 250 | RED (−14 %) |

Other S1 runs on cfdcbb9 (`t19-final-meas`): S1/short GREEN (growth 2.46 %/1k, peak 169, steady 119.6 MB); S1/stalled GREEN (0.28 %/1k, peak 168.4 MB); **S1/burst1 GREEN, 7 repetitions 175.2–187.5 MB, median 182.7** (ticket 60 measured median 236 with a tail above 250 on unchanged code). Final job on 144c031: "ratchet holds" (burst4/16/bigbody RED and listed, burst32 GREEN and unlisted).

**Expected-RED:** deleted `S1/burst32` (linux, windows; windows pending CI). **Not deleted: `S1/burst4`, `S1/burst16`, `S1/bigbody`** (linux, windows): still RED. Ticket 67 has not landed, so the plain entries were edited.

**Decisions taken (spec/ADRs silent)**
1. Release point = the handler has its response (see Accounting). Earlier release (at upstream send) is not observable through `fetch`, and the handler keeps the body until then for retries.
2. Count bound 64, `Retry-After` 2 s, cap range 1–4096 MB. The cap key is MB, not bytes. The count and time bounds are constants (injectable for tests), not config keys: the ticket names only the cap as a key.
3. **A collection after a large body (≥ 4 MiB) is given back** (one deferred, coalesced `Bun.gc(true)`; a no-op off Bun). The cap alone left burst32 at 678–734 MB (RED); with the collection it is GREEN in 18 of 20 runs, and bigbody drops 448 → ~350. Requests under 4 MiB never trigger it (S1/short has none). A variant that collects before admitting the next waiter (10 burst32 runs: max 583, median 541; burst16 453–472) was not adopted: no measurable difference, more code.
4. Chunked reservation = the 32 MiB wire maximum (not a guess), so the cap is a hard bound for unknown lengths; the trim to the real size keeps chunked senders from serialising after their read.

**Comes back with numbers (Round 6 Q1 condition 6, ADR-0004 point 7)**
- ADR-0004's arithmetic (64 MB × ~4.5 + ~90 ≈ 380 MB) does not hold on today's code: with ≤ 64 MB admitted (5 × 10.8 MB bodies) the proxy peaks at 430–525 MB, about 7–8 MB RSS per MB in flight, not 4.5 (the 4.5 came from 16–32 unbounded bodies). The redundant copies per body (read chunks, joined bytes, decoded string, three `JSON.parse` passes — validation, `peekBody`, `transformRequestBody` — plus its `JSON.stringify` and the upstream `Request` body) are ticket 20's work; with them halved, 5 bodies × ~4 × 10.8 + 90 ≈ 310 MB would meet 400.
- burst32 sits in the middle band: 2 of 20 above 600 MB (p ≈ 0.10). Deleted, it fails about one linux job in ten; listed, it would fail about nine in ten as GREEN-but-listed. I deleted it (the acceptance asks for it, and the median is 50 MB under budget); the orchestrator may prefer to hold the merge until ticket 20 adds margin.
- burst4 (329 MB median, 43 MB in flight, below the cap) and bigbody (358) cannot reach 250 through admission at all; burst16 (489) cannot reach 400 at the 64 MB default. These three stay listed under 19. Their owner after this ticket (20, or 19 kept open) is the owner's call. No budget changed; the 64 MB default is unchanged.
- Levers outside this ticket, not adopted: fewer copies (20); a body-processing concurrency limit (Round 1 Q5 requires measured evidence: the table above is that evidence); running the proxy with Bun `--smol` (manager spawn flag, affects every scenario).

**Pending CI (orchestrator verifies after merge+push)**
- [ ] ubuntu `memory-budget`: ratchet holds with `S1/burst32` unlisted (2 of 20 local runs were above 600 MB).
- [ ] windows `memory-budget`: S1/burst32 GREEN on the WS gate (if RED, Round 6 Q2 applies: the entry comes back with the run's numbers); S1/burst4/16/bigbody still RED; S1/burst1 (`unstable`, ticket 20) passes. Linux burst1 dropped to a 183 MB median, so windows may now be ≤ 250, which the unstable state accepts.
- [ ] `test-kit` legs (ubuntu/windows × Node 24/26) green, including `tests/proxy-env.test.mjs`.

**For later tickets:** 21 and 58 call `shedResponse(shape, { why, retryAfterSeconds, next })` and pick the shape per route as `server.ts` does. 39 reads `ProxyServer.admission()`. 20: the collection on release already removed most of the burst1 tail; measure your copy removals against this tree.

- 2026-11-08 (orchestrator, Owner Proxy round 18): Q1 replaces the Loop S1 burst criterion with the ≥ 30 % `procPeak:proxy` improvement at S1/burst16 and S1/burst32 on each leg; the four burst budgets and 19's `procPeak:proxy` names in `S1/burst4`, `S1/burst16`, `S1/burst32` and `S1/bigbody` (both legs) move to ticket 20 in 19's commit. Correction 1: the 64 MiB cap (67,108,864 B) admits 6 bodies of 10.8 MB, 64.8 MB in flight, not "5 bodies of 10.8 MB" (54 MB). Q2: `S1/burst32` stays listed on both legs under owner 20 on ticket 67's schema (ccd5d27's deletion is reverted, 19 is restaged on 67 after 67 merges); the `flips` marks for every S1 burst key and leg are set in 19's restaged commit from ≥ 10 valid CI runs of the full short profile on staging/19 (Q2 conditions 1–5; linux burst32 keeps a mark unless RED in every run). Merge check (Q1 condition 5): 19's evidence lists every name it owned with its status ("moved to 20, Round 18"); after the move 19 owns no S1 name unless Round 17 Q3 gives it one (Q2 condition 6).

### 2026-11-08 — implementer, round 2 (Owner Proxy round 18)

**Branch:** `ticket/19-admission-control`. Commits: `39a41ca` (revert of ccd5d27, the burst32 deletion), `aa1480d` (merge of the integration tip `c9c4062`, with ticket 67's schema), `5d4a9e8` (the four S1 `procPeak:proxy` names move from 19 to 20, both legs), `3cedb69` (`flips` marks and the windows burst32 deletion); the head SHA is the commit that adds this comment. Product code is unchanged since `cfdcbb9`.

**Correction (round 18 correction 1):** the 64 MiB cap admits **6** bodies of 10.8 MB (64.8 MB), not 5 (54 MB) as my first report said.

**Evidence runs:** 10 CI runs of the full short profile on staging/19 (empty commits on one tree; the S1 request path — `zcode-proxy-src/src/server/*`, both `handler.ts`, `config/loader.ts`, `s1-proxy-steady.mjs`, `verdict.mjs`, `budgets.mjs` — is byte-identical to this branch): 42446103818, 42446173104, 42446247315, 42446315329, 42446391907, 42446461464, 42446534840, 42446603243, 42446678546, 42446746036. The `memory-budget-<leg>` artefacts are in `/home/AgentKit/overhaul-tools/ci-art/t19r2/<run>-<leg>/`. They were replayed through ticket 67's final ratchet with the list at `3cedb69` (`t67-scripts/replay-artifacts.mjs`; output `/home/AgentKit/overhaul-tools/t19-memloop/replay-r2.txt`). There were no invalid runs and no harness failures, and every key was present.

**Marks per key and leg (owner 20, `procPeak:proxy`; linux RSS, windows WS gate, MB)**

| key | leg | RED / 10 | min – max (median) | result |
|---|---|---|---|---|
| S1/burst4 | linux | 10 | 285.1 – 400.3 (342.6) | owner 20, no mark |
| S1/burst16 | linux | 10 | 462.5 – 520.8 (490.7) | owner 20, no mark |
| S1/burst32 | linux | 1 (612.2 in 42446103818) | 489.6 – 612.2 (525.4) | owner 20, `flips` (also condition 3) |
| S1/bigbody | linux | 10 | 257.3 – 283.6 (266.6) | owner 20, no mark |
| S1/burst4 | windows | 10 | 253.2 – 357.6 (319.9) | owner 20, no mark |
| S1/burst16 | windows | 1 (418.4 in 42446678546) | 314.5 – 418.4 (359.9) | owner 20, `flips` |
| S1/burst32 | windows | 0 | 358.0 – 437.8 (392.5; commit 504.6 – 594.6) | **entry deleted** (GREEN 10/10) |
| S1/bigbody | windows | 10 | 256.2 – 296.0 (291.3) | owner 20, no mark |

This matches round 18 Q2 condition 5's expected default on linux. Other S1 keys: linux S1/short and S1/stalled were GREEN 10/10. Windows S1/stalled (61) was RED 10/10. S1/burst1 was GREEN on both legs in every run: linux medians 191.6–200.7 MB, windows WS medians 180.8–191.2, none over the 400 MB ceiling. That is inside windows' `unstable` bounds, and the replay accepts it.

**Merge check (round 18 Q1 condition 5):** 19 owned `procPeak:proxy` in `S1/burst4`, `S1/burst16`, `S1/burst32` and `S1/bigbody` on linux and windows. All of them moved to 20 (Round 18), except windows `S1/burst32`, which was deleted (GREEN 10/10). 19 now owns no S1 name.

**≥ 30 % criterion, windows (round 18 Q1 condition 2, WS gate):** compared with ticket 67's 34 matching windows runs on the pre-19 tree (the 26 Round-2 runs from their job logs, plus the 13-tree artefact runs in `ci-art/t67-r3-art`):
- burst16: 798.0 → 359.9 (−54.9 %);
- burst32: 1,367.0 → 392.5 (−71.3 %).

The 13-tree artefacts alone give 802.3 → −55.1 % and 1,397.3 → −71.9 %. Recorded: burst4 409.1 → 319.9 (−21.8 %), bigbody 325.8 → 291.3 (−10.6 %). Linux CI, against 67's 10 linux 13-tree runs: burst16 877.4 → 490.7 (−44.1 %), burst32 1,425.7 → 525.4 (−63.1 %), burst4 464.3 → 342.6, bigbody 380.5 → 266.6. The linux criterion (local) stays as recorded above: burst16 −46.5 %, burst32 −56.8 %. ✓ on both legs.

**Comes back with run ids (no edit made):**
- linux `S6/short` RED on `tui:adversarial-line-heap` 20 MB (budget 16) in **42446461464**; 8 MB in the other 9 runs. It is not owned, and not one of round 17's four signatures. It is a non-S1 key, so it does not invalidate that run's S1 count (its summary table printed).
- Logged and excluded under the round 17 interim rule: windows `S1/short` `growth:proxy` 5.01 %/1k, commit only, in **42446534840** (signature ii).

**Full suites after the merge** (Bun 1.4.2, Node 26.7.0):
- `npm run test` (`t19r2-full-kit2`): 837 tests, 818 pass, 0 fail, 19 skipped. The first attempt (`t19r2-full-kit`) was SIGTERMed from outside after 4.6 s (rc 143, 36 cancelled, no test failures), so I reran it.
- `npm run test:proxy` (`t19r2-full-proxy`): 1410 pass, 0 fail, 93 files. Typecheck passes.
- `npm run test:mcp` (`t19r2-full-mcp`): 97 tests, 96 pass, 0 fail, 1 skipped.
- The memory tests on the new list (`t19r2-memtests`, after `5d4a9e8`): 185 tests, 180 pass, 0 fail. They are in the kit suite above as well.

- 2026-11-08 (orchestrator, Owner Proxy round 22 Q1): pre-merge run 42457112513 failed only on linux S3/short RED on orphans (unowned). The orphan is the kill-holder proxy left without a pid record; 19's diff touches no manager, lock, launcher, lifecycle or S3 scenario code. The name is assigned to 17 (flips) in a list-only orchestrator commit on staging/19; the run does not count against 19, is replayed through the amended list, and its S1 and S3 counts stand. 19 merges after one passing CI run on its final tip.
