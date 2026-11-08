# 20: Fewer redundant request-body copies (bytes upstream unchanged)

**Blocked by:** 19 (Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0004

**What to build:** The redundant body copies identified in research (undici-yaml §5) are removed one by one, each measured; the bytes sent upstream are byte-identical.

**Acceptance criteria:**

- [ ] `protocol-contract`/`handler-resilience` assert byte-identical upstream bodies for each endpoint shape (seam 4).
- [ ] Per-copy RSS-per-MB-in-flight delta recorded in METRICS (baseline: ticket 19's tree, ADR-0004 amendment of Round 18; per copy removed, record the S1/burst4/16/32/bigbody peaks and (peak − 90) / MB admitted); S1 stays GREEN on both legs.
- [ ] Loop S1, both legs (Round 18 Q1/Q2): `procPeak:proxy` ≤ 250 MB (S1/burst4), ≤ 400 MB (S1/burst16), ≤ 600 MB (S1/burst32), ≤ 250 MB (S1/bigbody). Linux judges RSS, windows the WS gate (Round 7 Q1). 20 removes its names from these four entries with Round 15 Q1 condition 5's evidence. For a name RED in every matching run: 20's recorded loop runs plus its pre-merge CI run GREEN on that check and leg. For a `flips` name: ≥ 10 GREEN matching CI runs of that leg on 20's tree. If a budget cannot be reached, 20 comes back with numbers per key and leg. It also names the levers outside 20, measured or not: a lower `server.admission.maxInFlightMB` default, a body-processing concurrency limit (Round 1 Q5 condition 2; ticket 19's table is the first evidence for it), and Bun `--smol`. The budgets are never loosened, and the names stay under 20 until then.
- [ ] S1/burst1 (Round 6 Q1, amended by Round 7 Q1): in a ≥ 20-repetition measurement of S1/burst1 on each leg (RSS on Linux, working set on Windows: max(sampled WS, PeakWorkingSetSize)), every repetition is ≤ 250 MB. The tail is gone, so the peak budget holds as a peak. The job keeps the median rule (ticket 60). If every repetition cannot reach ≤ 250 MB, the ticket comes back with numbers. The budget is never loosened.
- [ ] Delete `S1/burst1` (windows) from `tests/memory/expected-red.json` (Round 7 Q3 condition 3). Round 8 Q1 condition 3 may strike this criterion before the ticket starts, if the windows distribution puts the entry's deletion in ticket 60's commit; the criterion above stays either way.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 25

## Comments

- 2026-11-06 (ticket 60, Round 6 Q1 condition 4): this ticket owns S1/burst1 (3 sequential ~10.8 MB requests per run). The burst1 tail above 250 MB comes from body copies overlapping for a short time: 5 of 48 runs on the tip at 97c2211, up to 268.9 MB, plus 299.2 MB earlier. New criterion above: every one of ≥ 20 repetitions ≤ 250 MB on each leg. It replaces the proposed "median ≤ 250 MB, every repetition ≤ 300 MB". Until then the job judges the median of 5 repetitions (≤ 250 MB) and requires every repetition ≤ 400 MB (`tests/memory/lib/budgets.mjs` `REPEATED`). Distribution: METRICS.md "S1/burst1 distribution and the median rule".
- 2026-11-06 (ticket 60, Round 7 Q1/Q3 and Round 8 Q1): the windows leg judges S1/burst1 on the working-set gate, max(sampled WS, PeakWorkingSetSize), not on commit; the 400 MB per-run ceiling applies to that value, and commit is reported per repetition. The criterion text above is amended to match. Round 7 Q3 added the windows delete criterion. Round 8 Q1 condition 2 measures ≥ 20 fresh windows repetitions (`node tests/memory/job.mjs --measure-burst1 N`); condition 3 then keeps, deletes or reopens the windows entry and may raise n.
- 2026-11-07 (ticket 60, Round 9 Q1): the windows `S1/burst1` entry is now `{ "ticket": "20", "state": "unstable" }`. The windows WS-gate distribution sits on the budget: 13 of 24 fresh runs above 250 MB (p = 0.54), median 251.9, max 291.1, CI run 42316982634; METRICS.md has the block. While the entry is unstable, the windows job passes S1/burst1 with a median ≤ 250 MB or ≤ 300 MB and prints "S1/burst1: unstable (median <x> MB, budget 250), owned by ticket 20". A median above 300, a run above the 400 MB ceiling, or any other RED check fails the ratchet. **The only exit:** the criterion above. In a ≥ 20-repetition windows measurement (`node tests/memory/job.mjs --measure-burst1 N`, via the one-run marker `tests/memory/measure-burst1`), every run must be ≤ 250 MB on the WS gate, and the commit that deletes the entry cites that measurement. No single job run and no median ever edits the entry (Round 6 Q2 condition 3, Round 8 Q1 condition 4). The "Delete `S1/burst1` (windows)" criterion stays; Round 8 condition 3 did not strike it. If every run cannot reach ≤ 250 MB, this ticket comes back with numbers, and the budget is never loosened. Ticket 55 removes the `unstable` allow-list once the entry is gone.
- 2026-11-08 (orchestrator, Owner Proxy round 17): Q3 condition 4 — this ticket's "S1 stays GREEN on both legs" criterion is judged on windows under ticket 71's `S1/short` rule: 5 fresh sequential repetitions, `growth:proxy` RED when ≥ 3 of 5 are RED under the unchanged `growth()`, every repetition ≤ 10 %/1k on commit, every other S1/short check judged in each repetition. Linux `S1/short` stays a single run. If this ticket moves the windows commit mean toward 5 %/1k, more repetitions turn RED and the numbers come back.
- 2026-11-08 (orchestrator, Owner Proxy round 18): Q1/Q2 make this ticket the owner of `procPeak:proxy` in `S1/burst4`, `S1/burst16`, `S1/burst32` and `S1/bigbody` on both legs, moved from ticket 19 in 19's commit, with the four budgets as the new Loop S1 criterion above; the per-copy baseline is now ticket 19's tree (ADR-0004 amendment of Round 18), not ~4.5 MB RSS per MB. While listed, a passing burst entry is ungated against regressions: an owned RED passes at any value until this ticket removes the name. This ticket measures against the ≥ 10-run staging/19 CI distribution of Round 18 Q2 condition 1, recorded in METRICS.md. "Comes back with numbers" covers every key and leg. Expect the return path for burst4 and bigbody (the implementer's estimate with copies halved is about 263 MB at 4 bodies). After the copies are removed, this ticket re-measures (peak − 90) / MB admitted at S1/burst16 and burst32, and the result goes into ADR-0004 as a further amendment naming this ticket.

### 2026-11-08 — implementer

**Branch:** `ticket/20-fewer-body-copies` (worktree `/home/AgentKit/wt/t20`), forked from the integration tip e88821f, with the current tip a8e18f5 merged in (2798d2e, no conflicts). The head SHA is the commit that adds this comment. Commits, one copy each, each measured:
- a5a7757, d8cf9be, 64f7c01: the upstream-bytes contract test;
- 21d747f, e2bbd28, 25ff451, cc266d7, 8499b94, 375bea2, ec3ff73, 147c87f (+ 6aa6b2b, type fix), e0de0e0, 9ccf978: the copies;
- a3131ef: the body-read test;
- 8d669db: expected-RED.

**What changed (the bytes sent upstream are unchanged)**

Handler, `src/proxy/handler.ts`:
1. One `JSON.parse` per body on `/v1/messages` and `/v1/chat/completions`. Validation, the request meta (was `peekBody`), the OpenAI translation and the passthrough transforms read the same object; it was 3 parses. `applyRequestBodyTransforms(parsed, ctx)` is the in-place form of `transformRequestBody`: modified → `JSON.stringify(parsed)`, else the client text itself.
2. `readBody` reads a body with a Content-Length straight into one buffer of that size. Chunks are dropped once copied, instead of holding every chunk plus their joined copy. Bytes past a wrong declared length fall back to the chunk list.
3. The client text and parsed object are released before the upstream text is built. Only the text sent upstream is held for retries; debug mode keeps the text for its "body transformed" line.
4. Translated requests (chat completions, `/v1/responses`, both async routes) are transformed as built. `jsonCopy` is `JSON.parse(JSON.stringify(value))` without the text: it shares strings and follows stringify's rules (toJSON, wrappers, undefined/function/symbol, -0, non-finite, own `__proto__`, shared objects copied per place, the same TypeErrors). The result is serialised once (`transformBuiltRequestBody`); this removes a stringify + parse round trip (2 copies). Debug mode keeps the old path for its size line.
5. Bodies of 1 MiB or more are parsed straight from their bytes (`Response.json()`), so no JS copy of the text is held. On Bun 1.4.2, `Response.json()` decodes exactly like `TextDecoder` + `JSON.parse`: the BOM, invalid and truncated sequences, overlong, CESU, NUL and UTF-16 BOM gave the same result or the same throw in a 20-case check. The text is decoded only if it is sent as written. Smaller bodies, debug and dump output keep the text path, because a lone BOM must stay "no body".

Session resolver, `src/proxy/client-session.ts`, `session-context.ts`: B1 module, bounds only, see decision 1.
6. `resolveSessionContext` passes the parsed body through, which removes 2 more parses (body metadata trace, canonical identity). With a parsed body, the resolver needs no text.
7. The identity hash is fed piece by piece. Before, the stable text was joined anew at every nesting level (about 4 full copies of a large conversation) and then converted to UTF-8.
   - Long strings are escaped in 16 Ki slices that never end on a high surrogate.
   - A slice with nothing to escape is hashed as it is (`JSON_ESCAPED` = `"`, `\`, U+0000–U+001F, lone surrogates; nothing else is escaped).
   - Pieces are UTF-8 encoded into one reused 64 KiB buffer.
   - The digest is the old one's, including the quirk that an absent field is written as `undefined`.

Not changed: response paths, the ordered transport, upstream.ts (headers), retries, captcha, signing, routing.

**Memory, linux, RSS (`procPeak:proxy`, MB; METRICS.md "Request-body copies removed one at a time" has every step and repetition)**

| key | base e88821f, 5 runs (median, range) | final 2798d2e, 10 runs | budget | factor (peak − 90) / MB admitted |
|---|---|---|---|---|
| S1/burst4 | 323.6 (300.2–339.5) RED 5/5 | **225.8 (193.3–241.2) GREEN 10/10** | 250 | 5.4 → 3.1 |
| S1/burst16 | 480.6 (433.9–520) RED 5/5 | **313.8 (297.4–342.2) GREEN 10/10** | 400 | 6.0 → 3.5 |
| S1/burst32 | 563.1 (560.2–569.5) GREEN 5/5 | **351.1 (330–375.8) GREEN 10/10** | 600 | 7.3 → 4.0 |
| S1/bigbody | 366.5 (327.6–383.4) RED 5/5 | **183.6 (173.6–198.6) GREEN 10/10** | 250 | — |
| S1/burst1, 20-run measurement | 177.6 / 186.4 / 199.9 (min/median/max), 0 above 250 | **116.2 / 119.5 / 128.6, 0 of 20 above 250** | 250 per run | 8.9 → 2.7 |

- Against the staging/19 linux CI distribution (Round 18 Q2 condition 1, 10 runs; a cross-machine comparison): burst4 342.6 → 225.8, burst16 490.7 → 313.8, burst32 525.4 → 351.1, bigbody 266.6 → 183.6.
- S1/short GREEN on the final tree: growth 3.41 %/1k, no trend; peak 148.1; steady 118.
- S1/stalled GREEN: 0.61 %/1k, peak 165.8.
- The local job on the branch (`--only` all seven S1 keys, `t20-memloop/final-job`): "ratchet holds". S1/burst32 reads "GREEN, listed for ticket 20 on flipping checks procPeak:proxy"; S1/burst1's 7 repetitions are 117.1–124.

**RED → GREEN.**
- Seam 1, the memory loop: the RED runs are the 5 base runs at e88821f (`reports/t20-red-base.log`): burst4, burst16 and bigbody RED in 5 of 5. On the final tree all 10 runs are GREEN.
- Egress was blocked by construction: mock-only config (claim and routing off, providers on the loopback mock). Every run's own isolation proof is empty, in all 248 runs of this ticket. A watcher for non-loopback sockets of bun processes saw none from this ticket's proxies; the hits it saw were other agents' `bun install` / `bun test`.
- Seam 4, the upstream bytes: `src/server/protocol-contract-bytes.test.ts` puts a real proxy on a loopback listener in front of a recording mock upstream. The cases cover:
  - all five body endpoints, streaming and non-streaming;
  - tool use and results, tool calls, images (base64 block and data URI);
  - effort and thinking, unicode and numbers, duplicate and `__proto__` keys;
  - a verbatim (unmodified) body, gzip, chunked with split multi-byte characters, invalid UTF-8 + BOM;
  - bodies past 1 MiB;
  - the clientIdentity modes off / observe (explicit header, body metadata, inferred lineage) / enforce (ordered transport);
  - refused bodies and their answers.

  It compares method, path, header pairs and body bytes per request with `__fixtures__/upstream-bytes.json`. The fixture is 28 cases, recorded on e88821f with `UPDATE_SNAPSHOTS=1` and deterministic across two recordings. The 22 first cases are unchanged by the second recording. Random UUIDs and `ses_…` ids are normalised by first appearance, so lineage stays pinned; OS, locale and time-zone headers are masked so the fixture holds on every leg. It passes on the base and on every step.
- Mutation run on the committed tree (`/home/AgentKit/overhaul-tools/t20-scripts/mutants.py`, logs `reports/t20-mutants*.log`, each restored with `git checkout <sha> -- <file>`, `git diff` empty after). 18 of 19 mutants were killed:
  - M1: the passthrough body serialised untransformed;
  - M2/M3: the one-buffer read drops bytes past, or keeps zeros below, the declared length;
  - M4: the resolver ignores a passed body's metadata;
  - M5: `null` written for an absent field;
  - M7–M10: `__proto__` assigned, -0 kept, undefined kept, a shared copy reused;
  - M11: translated requests untransformed;
  - M12: responses untransformed;
  - M13: wrappers kept;
  - M14: verbatim body re-serialised;
  - M15/M16: slices hashed unescaped, or quotes missing from the escape test;
  - M17: a large verbatim body re-serialised;
  - M18: a large body parsed with the BOM kept;
  - M19: the resolver drops a parsed body without text.

  **M6 survived** (slices may split a surrogate pair). It changes only the internal digest text, consistently for an identity and its prefixes, so no session decision and no byte can tell. The test that pins the escaping that does matter is "a long text that spells another conversation's structure stays apart" (kills M15/M16).

**Suites after the merge (Bun 1.4.2, Node 26.7.0)**
- `npm run test` (`t20-full-kit2`): 881 tests, 863 pass, 0 fail, 18 skipped. The first run (`t20-full-kit`) had 3 EADDRINUSE failures in `tests/proxy-lifecycle.test.mjs`: its fixed ports 19150–19159 were held by another agent's test run in `/home/AgentKit/wt/t15b`. They are not this diff's; the rerun after that run ended is clean.
- `npm run test:proxy` (`t20-full-proxy`): 1524 pass, 0 fail, 101 files. `npm run test:proxy-typecheck`: pass.
- `npm run test:mcp` (`t20-full-mcp`): 100 tests, 99 pass, 0 fail, 1 skipped; `dist/` unchanged.
- New test files (`protocol-contract-bytes`, `request-body-read`, `json-copy`) are found by `bun test` (the proxy script runs every `*.test.ts`). The new `client-session.test.ts` cases are additions; no existing test changed.

**Expected-RED (Round 15 Q1 condition 5): names and status**

| leg | key | status |
|---|---|---|
| linux | S1/burst4, S1/burst16, S1/bigbody | **removed in 8d669db**, entries deleted (last name). Evidence: the 10 recorded GREEN loop runs above, plus the pre-merge CI run (pending) |
| linux | S1/burst32 (`flips`) | kept: needs ≥ 10 GREEN matching CI runs on 20's tree |
| windows | S1/burst4, S1/bigbody (no mark) | kept: no windows run on 20's tree exists. If CI shows them GREEN, the pre-merge run fails them as "GREEN but listed", and that run is the evidence for their removal commit |
| windows | S1/burst16 (`flips`) | kept: ≥ 10 GREEN matching CI runs |
| windows | S1/burst1 (`unstable`) | kept: its only exit is the ≥ 20-run windows measurement (Round 9 Q1) |

**Decisions taken (spec and ADRs silent)**
1. **B1.** `client-session.ts` and `session-context.ts` are named in B1. The changes there are memory bounds only: the same inputs give the same session results, headers and bodies. That is pinned at seam 4 (explicit, body-metadata and inferred sessions in observe and enforce, below and past 1 MiB) and by the resolver tests. That is where most of the memory was, so the budgets need it. Flagged for review.
2. The bytes fixture is written only with `UPDATE_SNAPSHOTS=1`, the convention that ticket 55 makes CI refuse.
3. The parse-from-bytes threshold is 1 MiB.
4. No lever outside 20 was needed. Measured with the phase probe and not adopted: a collection right after the upstream text is built, a bytes or Blob upstream body, Bun `--smol` (METRICS).
5. ADR-0004 is not edited (Round 18 Q3 condition 5: the orchestrator writes ADR amendments). Proposed text for the further amendment:

   > **Amended 2026-11-08 (ticket 20, Round 18 Q3).** After ticket 20 removed the redundant request-body copies, S1/burst16 peaks at 297.4–342.2 MB (median 313.8, 10 runs, linux RSS) and S1/burst32 at 330–375.8 (median 351.1) with the same 64.8 MB admitted: about 3.5 and 4.0 MB RSS per MB admitted above the ~90 MB base. That was 6.2 and 7.1 on ticket 19's tree. S1/burst4 peaks at 225.8 (3.1 per MB) and S1/bigbody at 183.6. Each copy is recorded in METRICS. Most of them were in the client-session identity hash (parses and a stable text joined at every level), plus two parses in the handler and a stringify/parse round trip for translated requests. Points 1 and 6 together meet all four budgets locally, with no other lever. The 64 MB default stays.

**Pending CI (orchestrator verifies after merge + push)**
- [ ] Pre-merge CI, ubuntu `memory-budget`: S1/burst4, S1/burst16 and S1/bigbody GREEN and unlisted; S1/burst32 passes (flips). If a removed name is RED, it comes back as an unowned RED with the run's numbers.
- [ ] Windows `memory-budget`, WS gate: burst4, burst16, burst32 and bigbody against 250 / 400 / 600 / 250 MB. S1/short under ticket 71's 5-repetition rule (Round 17 Q3 condition 4). S1/stalled stays 61's.
- [ ] ≥ 10 valid CI runs of the full short profile on 20's tree (a staging/20 branch, empty commits), replayed through the ratchet:
  - **removes** linux S1/burst32 and windows S1/burst16 (`flips`) when GREEN in all of them;
  - **removes** windows S1/burst4 and S1/bigbody when GREEN;
  - each removal is a 20-owned commit on this branch citing the run ids.
- [ ] Windows S1/burst1, the ≥ 20-run measurement:
  1. Commit the one-run marker `tests/memory/measure-burst1` containing `24` on a staging/20 branch only. A test fails while it exists, so it never merges.
  2. CI's `memory-budget` job then runs `node tests/memory/job.mjs --measure-burst1 24` on both legs. Artefacts: `memory-budget-{windows,linux}/measure-S1-burst1.{json,md}`.
  3. If every windows run is ≤ 250 MB on the WS gate (max(sampled WS, PeakWorkingSetSize), valid run: `ws_peak_kb` > 0, units self-test passed, `@@JOB applied=1`), a 20-owned commit deletes the windows `S1/burst1` entry and cites that run. Ticket 55 then drops the `unstable` allow-list.
  4. If not, 20 comes back with the numbers. On ticket 19's tree, windows WS burst1 medians were 180.8–191.2, against linux 191.6–200.7. Linux on 20's tree is 116–129.
- [ ] `test-kit` legs (ubuntu/windows × Node 24/26), including the new proxy tests on windows; the fixture's host-dependent headers are masked.

**Observations for the controller (not this ticket's to fix)**
- The proxy `bun test` suite opens a TLS connection to zcode.z.ai:443 on the integration tip too: 68 watcher samples from `bun test` in `/home/AgentKit/wt/t20-base`, peer 155.102.29.7:443.
  - A preload that blocks non-loopback fetch caught one call, `https://zcode.z.ai/api/v1/client/configs?app_version=3.17.2&platform=linux-x64`, from `endpoint-routing.ts:219` via `handler.ts:231`. That is the process-wide routing singleton reached from a test whose config has routing on.
  - A connection still opened past the preload.
  - Real egress from the fast suite, outside B2's spirit.
- `tests/proxy-lifecycle.test.mjs` binds fixed ports 19150–19159, so parallel agents' suites collide (EADDRINUSE).
- 2026-11-08 (implementer, after the evidence commit a86c498): the integration tip moved to 9e98295 (ticket 72, Owner Proxy rounds 25–26). It is merged as 589d6ba with no conflicts. The merge changes no file under `zcode-proxy-src/`, `mcp/`, `lib/` or `cli/`, and none on the S1 request path, so the memory numbers above stand. Suites on 589d6ba:
  - `npm run test` (`t20-full-kit3`): 884 tests, 866 pass, 0 fail, 18 skipped;
  - `npm run test:proxy` + typecheck (`t20-full-proxy3`): 1524 pass, 0 fail, 101 files, typecheck clean;
  - `npm run test:mcp` (`t20-full-mcp3`): 100 tests, 99 pass, 0 fail, 1 skipped, `dist/` unchanged.

  Rounds 25–26 do not touch ticket 20.
