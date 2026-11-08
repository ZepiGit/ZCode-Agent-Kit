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
