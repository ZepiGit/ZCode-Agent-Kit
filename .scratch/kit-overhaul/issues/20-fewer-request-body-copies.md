# 20: Fewer redundant request-body copies (bytes upstream unchanged)

**Blocked by:** 19 (Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0004

**What to build:** The redundant body copies identified in research (undici-yaml §5) are removed one by one, each measured; the bytes sent upstream are byte-identical.

**Acceptance criteria:**

- [ ] `protocol-contract`/`handler-resilience` assert byte-identical upstream bodies for each endpoint shape (seam 4).
- [ ] Per-copy RSS-per-MB-in-flight delta recorded in METRICS (baseline ~4.5 MB RSS per MB); S1 stays GREEN on both legs.
- [ ] S1/burst1 (Round 6 Q1): in a ≥ 20-repetition measurement of S1/burst1 on each leg (RSS on Linux, commit on Windows), every repetition is ≤ 250 MB. The tail is gone, so the peak budget holds as a peak. The job keeps the median rule (ticket 60). If every repetition cannot reach ≤ 250 MB, the ticket comes back with numbers. The budget is never loosened.

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
