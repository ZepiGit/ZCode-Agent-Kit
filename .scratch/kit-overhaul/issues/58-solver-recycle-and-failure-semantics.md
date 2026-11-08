# 58: Solver recycle triggers and failure semantics (abnormal-exit budget, fail-fast shed)

**Blocked by:** 19 (Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract), 25 (Bounded-collection module; CDN memory cache and stall counters bounded), 28 (Solver cap enforcement per OS and the cap handshake)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0002, 0004

**What to build:** Recycle: footprint at 80 % of the configured cap (240 MB at 300), read from the child's own report after each solve; count backstop 100 (was 200); the failure, idle, request and deadline triggers are kept; the in-worker 768 MB heap trigger is removed or re-based below the cap. Failure: a crash, cap kill, fatal error or deadline kill fails only the in-flight solve with `CaptchaSdkError("other", …)`, and the queue is pumped onto the next generation. Only these abnormal exits count toward 5 per 10 min, after which solves fail fast with 503 + `Retry-After` = the time until the window reopens (19's shed helper). Planned recycles (count, footprint, idle, request, shutdown) never count. No solve is resubmitted. The solver queue's caller-side bound (one in-flight solve per pool, the `captcha-pool` clamp) is stated with evidence and pinned; a count bound + ADR-0004 shed is added only if none can be shown. The fail-fast state and its window end are exposed through the dispatcher stats for 39.

**Acceptance criteria:**

- [ ] Seam 3: each recycle trigger fires at its threshold and not below it (footprint 239 vs 241 MB at cap 300; count 99 vs 100); planned recycles never increment the abnormal-exit count; once the 5-per-10-min budget is used up, the next abnormal exit enters fail-fast, and the shed has the endpoint's error shape and `Retry-After` = seconds until the window reopens; after the window a solve succeeds (injected clock).
- [ ] Seam 3 (adversarial, "fail only the solve in flight"): a crash with one solve in flight and one queued fails only the in-flight solve, with the existing error and category; the queued solve completes on the next generation; the backend's call count shows that no solve was resubmitted.
- [ ] Seam 3: the queue-bound test.
- [ ] Loop S2: per-generation cost ≤ 300 MB (`solver:cost-per-generation`), retained before recycle ≤ 300 MB (`solver:retained-before-recycle`), hung-solve reclaim ≤ 64 MB, one generation at a time; `procPeak:scenario` ≤ 600 MB (ticket 01 note 10); `growth:scenario` ≤ 5 %/1k (§18 S1–S5 growth row); `procPeak:solver` ≤ 300 MB (§18 S2 row, the cap). **Remove 58's names (`solver:cost-per-generation`, `solver:retained-before-recycle`, `procPeak:scenario`, `growth:scenario`, `procPeak:solver`) from `S2/short` (linux, windows) in `expected-red.json`, with the evidence Round 15 Q1 condition 5 requires.**

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 6, 11, 12, 13, 14

## Comments

- 2026-11-07 (orchestrator, from ticket 12): S2's growth:scenario check flips between ok and RED on unchanged code from run to run (both happy-dom 20 and 21); one run cannot settle it, use repeated runs for this ticket's evidence. S2 cost per generation median 1034 (happy-dom 20) -> 1091 MB (21), ranges 1004-1115 vs 1019-1133.

- 2026-11-08 (orchestrator, Owner Proxy round 15): Q1 condition 3 (A, decided) and condition 7 — "Loop S2" gained three bounds: `procPeak:scenario` ≤ 600 MB, `growth:scenario` ≤ 5 %/1k and `procPeak:solver` ≤ 300 MB (the last listed now at 0 RED, because ticket 27 turns it RED until 28 and 58). The S2 host peak and growth measure the same solver defect, so 58 owns them. "Delete `S2/short` (linux, windows)" became "remove 58's names"; `cdn-cache:memory-growth` in the same entry is ticket 25's. `growth:scenario` and `procPeak:solver` are recorded as flipping, so removing them needs ≥ 10 GREEN matching CI runs per leg (Q1 condition 5).
