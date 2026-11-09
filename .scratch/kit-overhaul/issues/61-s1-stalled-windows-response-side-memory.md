# 61: S1/stalled on Windows: proxy memory under many stalled streaming readers (response side)

**Blocked by:** 02 (Windows sampler …), 19 (Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract), 20 (Fewer redundant request-body copies (bytes upstream unchanged))

**Status:** ready-for-agent

Model: sol
Risk: high
ADR: no

**What to build:** Round 7 Q3 (DECISIONS.md, binding). On windows-latest the S1/stalled scenario (4 MB streamed responses to ~200-byte requests, readers that stall) is RED on both working set and commit (proxy peak ~452 MB commit), while Linux is GREEN. Ticket 19 bounds request bytes and leaves response streams unlimited, so it does not own this. Triage: attribute the Windows peak (Bun stream buffering per stalled reader on Windows? socket send buffers?), and decide whether a response-side bound is needed (touches Round 1 Q5; would come back to the owner proxy with numbers).

- [ ] Triage decision recorded with numbers from the windows memory leg.

Spec stories: none yet (outside spec.md; recorded in Round 7).

## Comments

- 2026-11-07 (orchestrator) Triage, Owner Proxy round 12 (binding; full text in DECISIONS.md Round 12):

## Q3 — Ticket 61: S1/stalled on Windows, response-side proxy memory

**DECISION:** ACCEPTED with conditions. The recommendation's stage 2 is in fact architecture candidate 6, which the round does not say. This answer names it and **explicitly amends Round 1 Q2 (#6 "do nothing")** and spec §Out of Scope line 809, conditionally, on the trigger Round 1 Q2 itself named. The edge set is changed.
- **Triage role:** `ready-for-agent`. Model sol. **Risk high**: Round 7 Q3 filed it as high, and the ticket file's "medium" is drift that is corrected here. ADR no.
- **Fact corrections for the ticket text.**
  - The 452.3 MB commit peak (275.0 MB sampled WS; max commit sample 437) comes from the Windows reference run **42265988296** (METRICS.md line 223, Round 7), not from 42281731448. Run 3 gave 444 commit / 283.8 sampled WS.
  - **EVIDENCE MISSING:** the "328-ish WS in later runs" figure. No file in the tracker carries it, so the ticket must not cite it unless the artefact is named. The decision does not depend on it.
  - Linux control: HWM 165 MB, heap 6 MB after idle (METRICS lines 34 and 59).
- **Criteria.**
  1. **Stage 1, attribution on windows CI**, using ticket 09's paired mode and an off-by-default marker. The marker lives in the test loop only: no new product config key or env var, and any product-side probe uses the existing debug/event-line logging. The run records MB per stalled reader (commit and WS) on the same commit on both legs, split into these buckets:
     - (i) the `tee()` stats branch queuing for a slow client (`handler.ts:423/433/441`; candidate 6's stated problem);
     - (ii) the proxy writing into a client socket that is not draining (Bun's per-socket send buffering);
     - (iii) upstream-fetch response buffering;
     - (iv) the Bun-on-Windows baseline (the commit floor of about 113–188 MB recorded in Round 7).
     The buckets must account for the Windows peak above idle to within ±20 %. Otherwise the attribution is inconclusive, and the ticket comes back with numbers.
  2. **Stage 2, only if (i) or (ii) carries the excess.** The fix restores backpressure from client to upstream: the upstream is read no faster than the client drains, and the stats are observed in the client's path (candidate 6's single response-body module).
     - It may not cap response bytes, limit the number of open streams, shed or end a stalled stream, or return 503 for it. Round 1 Q5 condition 2 stays intact.
     - The bytes and event order delivered to the client are unchanged. A reader that resumes within the existing timeouts receives the full answer, and a test proves it.
     - Request-row and `--json`/stats field names and meanings are unchanged. If a timing field's meaning would change (for example, total time measured at client pull speed), the ticket comes back before it ships.
  3. **GREEN means:**
     - `S1/stalled` (windows) is GREEN on the WS gate (≤ 250 MB peak) and under the 512 MB commit backstop (Round 7 Q1 condition 2);
     - **delete `S1/stalled` (windows) from `expected-red.json`**;
     - Linux S1/stalled stays GREEN with no HWM regression;
     - S1/short, S1/burst*, S1/bigbody and S7 do not regress on either leg.
  4. **If the excess sits in (iii) or (iv),** or in Bun internals with no proxy-side lever, the ticket comes back with the numbers. The entry stays, so 55's empty-list criterion is then blocked, and that is an owner question. §9's 250 MB is never loosened.
  5. **B1:** if the stream handling touches anti-abuse modules, only lifecycle and backpressure change there.
- **Label:** `ready-for-agent`.
- **Edges.**
  - Keep 61 ← 02 and 55 ← 61.
  - **61 ← 19 accepted:** both change the proxy's request/response handler.
  - **New edge 61 ← 20:** 20 edits the same handler and runs a ≥ 20-repetition S1/burst1 measurement on both legs. A response-path change landing in parallel would conflict in `handler.ts` and confound that measurement. Stage 1 then also attributes the code that stage 2 will change.
  - **Acyclic, checked.** 61's only descendant is 55, and nothing depends on 55. The ancestors of 19 and 20 are 19, 13, 14, 12, 11, 10, 09, 02, 03, 04 and 01, and 55 is not among them. No cycle forms.

**Rationale:** The Windows result is RED on both metrics with no owner, and Round 7 Q3 required triage with numbers. Measuring first follows C9: stronger measured evidence wins. The code evidence points straight at candidate 6. Its problem statement is the `tee()` stats branch that "queues without bound" for a slow, still-connected client. Round 1 Q2 dropped #6 only because the burst peak was attributed to body copies and Linux stalled readers retained 6 MB. It made #6 conditional on stream-buffering attribution. If stage 1 shows that attribution on Windows, the condition Round 1 Q2 set is met, so building #6 inside 61 follows that decision's own logic rather than contradicting it silently. I record the amendment here so that spec line 809 and DECISIONS stay consistent. Backpressure bounds memory without refusing work, which is why Round 1 Q5 stays intact. A byte cap or a stream limit would not leave it intact.

**Charter:** C1 (bounded memory; degrade by backpressure), C2 (client bytes and fields unchanged), C7 (primary platform RED), C9 (measured evidence; reversible), §9 (no loosening), Round 1 Q2 (amended conditionally), Round 1 Q5, Round 5 Q2, Round 6 Q2 condition 1, Round 7 Q1 and Q3, B1.

**REVERSIBILITY:** Two-way door (an internal response-pipeline module behind unchanged contracts). ADR: no. The conditional amendment of Round 1 Q2 / spec line 809 is recorded in DECISIONS and RUNLOG.

---

- 2026-11-08 (orchestrator, Owner Proxy round 17): Q3 condition 4 — criterion 3's "S1/short … do not regress on either leg" is judged on windows under ticket 71's `S1/short` rule: 5 fresh sequential repetitions, `growth:proxy` RED when ≥ 3 of 5 are RED under the unchanged `growth()`, every repetition ≤ 10 %/1k on commit, every other S1/short check judged in each repetition. Linux `S1/short` stays a single run.

---

- 2026-11-09 (implementer, ticket 61). Branch `ticket/61-s1-stalled-windows`, code head 3820c9a (this Comments commit sits on top), merged with the integration tip 6d4331d. Stage 1 numbers, stage 2 built, linux evidence local, every windows criterion **pending CI (orchestrator verifies)**. Numbers in METRICS.md "S1/stalled: response-side attribution and backpressure (ticket 61; Round 12 Q3)".

  **Commits.**
  - a7435ce `test(proxy)`: client-bytes contract, fixture captured on the tip 788f2fb before any change.
  - 1495c03 `test(memory)`: the stage 1 attribution mode (`job.mjs --measure-stalled N`, marker `tests/memory/measure-stalled`, new `S1/drained` variant in no job). This commit has the shipped `tee()` proxy, so it is the "before" tree for the windows attribution.
  - e540752, caf66db `fix(proxy)` and 0da10d7, b4b98ef `test(proxy)`: stage 2.
  - 3820c9a: the list-only commit.

  **Stage 1, attribution (criterion 1).**
  - Windows, from evidence that already exists: the 75 archived windows S1/stalled artefacts (shipped `tee()` tree, METRICS table). Proxy JS heap is 4 MB at idle. During the load it has a median of 54 MB and a peak of 88–140 MB (median 111). WS gate 301.5 MB (278–333), commit peak 451 MB, idle floor 52.5 MB WS and 182 MB commit. Linux: heap 16.5 MB median during the load and 25 MB at the peak. So at the peak, windows holds about 107 MB of JS heap above idle (13 MB per stalled reader at 8 readers), against about 20 MB on linux. Queued `tee()` chunks are JS heap: a local probe put 17.2 MB in an unread branch and saw `heapUsed` +18 MB and RSS +36 MB. That points at bucket (i).
  - Mechanism, from linux experiments (METRICS): Bun's writer stops pulling when the kernel send buffer is full. On linux the kernel takes almost the whole 4.5 MB answer of a paused client (Send-Q 4.0 MB), so only ~0.35 MB per reader stays in the tee queue. A smaller loopback buffer leaves the same bytes in the queue. Bun `fetch` with an unread body holds ~1 MB per stream and stops there.
  - **The ±20 % accounting on windows is not done yet.** It needs the drained reference on the windows leg. **CI measurement mode needed (the orchestrator runs it):**
    1. staging at 1495c03 + a commit adding `tests/memory/measure-stalled` with content `3`;
    2. the same on the branch head;
    3. both legs each. Per leg: 3 rotations × 2 arms, about 35 min on linux and likely 60–70 on windows, under the 150 min timeout.

    The artefact `measure-S1-stalled.{json,md}` gives per arm the peak and floor (WS and commit on windows), the JS heap, and the buckets (iv) floor, (iii) drained excess, (i) JS-held, (ii) residual, in MB and per stalled reader, with "accounted" when (i) + (iii) explain the excess within 20 %. The marker must not merge (a loop test fails while it exists).
  - Linux attribution (local, the mode as CI runs it, 3 rotations side by side, medians). Tee tree: stalled 175, drained 161.2, floor 60.1, (iii) 101.3, (i) 5, residual 8.6, accounted. So on linux the stalled excess is (iii); the kernel holds the rest. Branch: stalled **148.5** (147.8, 150.6, 148.5), drained 144.1, (iii) 84.4, (i) 6, residual −1.7.
  - **Decision taken (smallest step that satisfies the criteria, recorded here):** I built stage 2 on the windows heap evidence before the windows drained-arm attribution exists, because I cannot run windows CI. The two are separate commits, so the orchestrator can run stage 1 on 1495c03 first. If windows stage 1 puts the excess in (iii) or (iv) instead, criterion 4 applies, and the fix commits come back rather than ship.

  **Stage 2, what changed (criterion 2; `zcode-proxy-src/**`, so ineligible for signature (vii)).**
  - New `src/proxy/response-body.ts`: `observeInClientPath(source, { compressed, sample, onEnd })` replaces the three `tee()` sites in `handler.ts`.
    - It observes tokens and timings as the client pulls (high-water mark 0, one upstream read per pull).
    - It prints the request row once, on end, read failure or client cancel. A cancel propagates to the upstream.
    - The token parse is moved unchanged.
  - The two SSE translators (`sse-translator.ts`) wait for demand before each upstream read. They used to pump eagerly inside `start()`, which never let `pull()` run.
  - **The 64 KiB piece bound (caf66db), measured, not planned.** Backpressure alone (e540752) *raised* the linux stalled peak by ~14 MB: 188.8 against 174.4 side by side; standalone A/B HWM 145.9–150 against 129.9–143.4.
    - Cause: a late read of a `fetch` body returns what accumulated meanwhile, 130–330 KB, against 64 KB when read as it arrives. The terminal guard, the decoders and the socket write then each copied and held that chunk whole.
    - Fix: the response-body module now hands on at most 64 KiB per pull (views, no copy). `writeWebResponseToNodeResp` writes at most 64 KiB at a time.
    - Its drain wait also settles on `close`. That is lifecycle only: mutant M9 shows no observable difference, so the old wait was unreachable garbage once the socket was gone.
    - Result, standalone A/B HWM: 117.1–119.8 MB.
  - Nothing is capped, shed or ended, and no stream count is limited: Round 1 Q5 stays intact. No anti-abuse module touched (B1). No config key, env var or endpoint.

  **Criterion 2, bullets 2–3 (bytes, resume, fields).**
  - Client bytes and event order unchanged: `response-bytes-contract.test.ts` (seam 4) has 9 cases pinned on 788f2fb and passes on the branch. The cases: split frames and UTF-8, one chunk, a cut stream, a mid-stream read failure, gzip for a client that takes it and one that does not, translated chat text and tool call, chat cut, chat read failure.
  - Upstream bytes unchanged: `protocol-contract-bytes.test.ts` passes untouched.
  - Resume: a client that stops reading, then reads again, gets all 49,497,591 bytes in order (sha256 compared), and its row carries the usage total (3007).
  - **Comes back before it ships (Round 12 Q3 condition 2, third bullet).** Row and `--json` field names and the TTFB meaning are unchanged, but two values change for a client that is slower than its upstream:
    - **Total** (and tok/s) is the time until the upstream stream ended at the proxy, as before. The proxy now reads that stream at the client's pace, so for a slow client Total includes the client's drain time.
    - **Tok**, for a client that leaves early, counts the events read up to its departure. Before, it counted what the upstream raced ahead to deliver until the abort.

    For a client that keeps up, both are the same as before. This is exactly the case the condition names ("total time measured at client pull speed"), so the orchestrator should bring it to the Owner Proxy before merge. The alternative, keeping today's values, needs the upstream read ahead of the client, which is the queue this ticket removes.
  - Also changed, dump mode only: the 4 KiB dump sample now uses its own decoder. It used to share the token parser's streaming `TextDecoder`, which could garble a token line split inside a multi-byte character while dump was on.

  **RED → GREEN.**
  - Seam 4, `src/server/response-backpressure.test.ts`: a real proxy on loopback, an injected pull-counting upstream with a 48 MB answer, and raw paused clients (`reports/t61-bp-red.log`, on the tip proxy code).
    - Messages, held back: RED, pulled 49,497,591 of 49,497,591 against < 16 MiB. GREEN after the fix.
    - Messages, client leaves while stalled (upstream released, row printed once): RED, all bytes pulled. GREEN after.
    - Chat translated: RED. Still RED after the handler change alone (`t61-bp-slice1`), GREEN after the translators changed.
    - Pieces at the socket, ≤ 64 KiB: RED on e540752 (2,640,431 in one write). GREEN on caf66db.
    - Pieces at the handler, ≤ 64 KiB + one frame: kills M7.
  - Seam 1, linux, S1/stalled:
    - tee tree: single runs 169.8 (`base-stalled-1`, the job) and 169.8 (the mode alone), median 175 of 3 side by side;
    - branch: 148.9 (job) and median 148.5 of 3.

    Windows: pending CI.
  - Mutants on the committed tree (`/home/AgentKit/overhaul-tools/t61-scripts/mutants.py`, each restored with `git checkout b4b98ef -- src`, `git diff` against b4b98ef empty after). 8 of 9 killed: M1 drop a byte; M2 read error turned into an end; M3 usage total ignored (survived the first version of the row check, killed after 0da10d7); M4 eager translator; M5 no row on cancel; M6 eager observer (large high-water mark); M7 no module pieces; M8 no write pieces. **M9 survived** (drain wait ignores `close`): no observable difference at the seam, see above.

  **Criterion 3, GREEN means.**

  | criterion | status |
  |---|---|
  | windows S1/stalled ≤ 250 MB WS and < 512 MB commit | pending CI (orchestrator verifies). Expected from the heap evidence, not proven |
  | delete windows `S1/stalled` from `expected-red.json` | ✓ 3820c9a, list-only. The pre-merge CI run must be GREEN on that name (Round 15 Q1 condition 5) |
  | linux S1/stalled GREEN, no HWM regression | ✓ local: 175 → 148.5 MB median of 3, side by side (−15 %). linux CI: pending |
  | S1/short, burst*, bigbody, S7 do not regress (both legs) | linux local, caf66db. S1/short GREEN 3.53 %/1k, peak 145.5, steady 114.3. burst1 median 121.3 of 7. burst16 327.2, burst32 348.7. bigbody paired 193.7 → 187.4. S7 RED only on ticket 33's name, heap-at-cap 63. **burst4 paired: 219.9 → 230.6, 9 runs each, p = 0.015.** GREEN, inside ticket 20's 10-run range 193.3–241.2. Its path runs none of the changed code except one socket write per answer, and the standalone A/B of that shape shows no difference (189.9–217.7 against 177.4–214.6). No proxy-side cause found; flagged. Windows (S1/short under ticket 71's rule): pending CI |

  **Suites after the merge of 6d4331d (Bun 1.4.2, Node 26.7.0).**
  - `npm run test`: 906 tests, 888 pass, 0 fail, 18 skipped (`t61-full-kit`).
  - `npm run test:proxy`: 1611 pass, 0 fail, 109 files (`t61-full-proxy`).
  - `npm run test:proxy-typecheck`: pass.
  - `npm run test:mcp`: 100 tests, 99 pass, 0 fail, 1 skipped; `dist/` unchanged.
  - The memory unit tests after the list edit: 214, 209 pass, 5 skipped.

  **Left for others.**
  - The `/v1/responses` stream (`responses-handler.ts` `streamResponse`) and the async bridge still pump eagerly in `start()`, so a stalled client of those routes still queues. They are not in S1/stalled, and they are a follow-up if wanted.
  - Measurements and egress: every run used the loopback soak mock or an injected upstream (B2), and the proxy test suite ran under its egress guard.

- 2026-11-09 (implementer, ticket 61), addendum. The tip moved to 984b45d (tickets 16 and 38, Round 30, ticket 79), and I merged it in 6728f62. The only conflict was METRICS.md: both sides appended a section, and I kept both. Suites on 6728f62: `npm run test` 980 tests, 962 pass, 0 fail, 18 skipped (`t61-full2-kit`); `npm run test:proxy` 1611 pass, 0 fail; proxy typecheck passes; `npm run test:mcp` 100 tests, 99 pass, 0 fail, 1 skipped, `dist/` unchanged.
  - **Ticket 79 (record only, local runs, not CI).** Linux S1/stalled `growth:proxy` was 1.03 %/1k on the tip 788f2fb (job), 0.47 on e540752 and −0.03 on caf66db (no trend). The pre-merge run's linux S1/stalled value goes to 79, and a RED there comes back under Round 30 Q1.
  - **The diff touches `zcode-proxy-src/**` and `tests/memory/**`.** So no signature applies to this ticket's runs, including Round 28 (vii).

- 2026-11-09 (implementer, ticket 61, round 2). Branch `ticket/61-s1-stalled-windows` at ce6d627 before this commit. **Criterion 1 (Round 12 Q3) on windows: not met, so the attribution is inconclusive. Criterion 4 applies, and I stopped there.** None of the Round 31 Q2 conditions were built (source comment, seam-4 tests (a)–(c)), the integration tip was not merged and no suite or S1 run was started, because Round 31 Q2 condition 1 makes that acceptance binding only if stage 2 ships.
  - Runs: m1 = 1495c03 (the shipped `tee()` proxy plus the mode), 42561009557; m2 = ce6d627, 42561017903. Artefacts are in `/home/AgentKit/overhaul-tools/ci-art/t61m/`, and the full table is in METRICS.md under "Windows attribution mode, CI".
  - The rule was fixed in the mode before the run (`STALLED_ACCOUNTED_SHARE = 0.2`, this ticket's Comments above): accounted when (i) + (iii) explain the excess above idle within ±20 %, i.e. |(ii) residual| ≤ 20 %.

    | m1 windows (medians of 3) | excess above idle | (iii) drained | (i) JS-held | (ii) residual | residual share | accounted |
    |---|---|---|---|---|---|---|
    | WS | 238.2 (peak 293.1, floor 54.9) | 102.4 | 85 | 50.8 | 21.3 % | no |
    | commit | 271.3 (peak 453.7, floor 182.4) | 111.7 | 85 | 74.6 | 27.5 % | no |

    Per rotation (WS / commit): 20.5 / 26.9 %, 19.5 / 20.6 %, 18.4 / 24.9 %, so commit fails in every rotation. On m1 linux the share is also 21.1 % (not accounted).
  - Why this is the reading as written: (ii) is the residual, not a measured bucket. Counting it would make "the buckets account within ±20 %" true for any data, so only the measured buckets count, which is the rule the mode recorded beforehand.
  - Not part of the rule, for the Owner Proxy:
    - On m2 (ce6d627) windows the excess is accounted: WS residual −5.2 %, commit −3.3 %, (i) 9 MB. The stalled peak is 132.4 WS / 298.1 commit, against 293.1 / 453.7 on m1. Stalled minus drained WS falls from 135.7 to 5.0 MB. So the stage-2 change removes the stalled-specific excess: causal evidence for a proxy-side lever, though not the attribution criterion 1 asks for.
    - One plausible reason for the residual: (i) is measured in `heapUsed`, and a local probe saw RSS rise about 2× `heapUsed` for queued `tee()` bytes.
    - The m2 S1/stalled windows runs are GREEN on WS (121.6, 133.2, 132.4) and under the 512 MB commit backstop (292.7, 306.5, 298.1). These are attribution-mode runs, not a ratchet verdict.
  - Left for the orchestrator: an Owner Proxy round on criterion 4 with these numbers. The stage-2 commits (e540752, caf66db, 0da10d7, b4b98ef), the list-only commit 3820c9a and Round 31 Q2's acceptance come back together.

- 2026-11-09 (orchestrator, Owner Proxy round 31 Q2, binding): the two row-value changes are accepted on the condition that stage 2 ships (windows attribution on staging/61m1 and staging/61m2 in bucket (i)/(ii) within ±20 %; otherwise criterion 4 and the stage-2 commits come back with this acceptance). Unchanged: column names, order and widths, compact format, TTFB, dump field names, other routes; no config switch. Release-notes line (edge 54 ← 61) as in round 31 Q2 condition 3; a source comment at printHeader/printRow states the semantics; seam-4 tests pin (a) Tok equal to the tip 788f2fb for a client that keeps up in all 9 contract cases, (b) Total >= an imposed client pause, (c) one row and Tok never above what was delivered for an early leaver. Corrections: Tok is the usage total or the counted deltas of the events read, not an event count; no row help text or README describes the row; no --json output carries Total, Tok or tok/s. This ticket's diff touches tests/memory/job.mjs, so signature (ix) does not apply to its runs.
- 2026-11-09 (orchestrator, Owner Proxy round 32, binding): stage 2 ships despite criterion 1 not accounting on the old tree under the pre-registered rule (m1 windows residual WS 21.3 %, commit 27.5 %; recorded unchanged). Departure from Round 12 Q3 criterion 2 and Round 31 Q2 condition 1 for this ticket only. Conditions: finish Round 31 Q2 conditions 2-6; merge the tip; transfer rule (if the response path changes, rerun the attribution mode once under the unchanged rule); one pre-merge CI run confirms criterion 3 in full on both legs incl. windows S1/short under ticket 71's rule (any RED comes back, nothing rerun, no signature); S1/burst4 GREEN on both legs before merge; the first S1/burst4 RED after 61 merges comes back naming 61.
