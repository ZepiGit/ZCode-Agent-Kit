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

- 2026-11-08 (orchestrator, Owner Proxy round 18): Q1 replaces the Loop S1 burst criterion with the ≥ 30 % `procPeak:proxy` improvement at S1/burst16 and S1/burst32 on each leg; the four burst budgets and 19's `procPeak:proxy` names in `S1/burst4`, `S1/burst16`, `S1/burst32` and `S1/bigbody` (both legs) move to ticket 20 in 19's commit. Correction 1: the 64 MiB cap (67,108,864 B) admits 6 bodies of 10.8 MB, 64.8 MB in flight, not "5 bodies of 10.8 MB" (54 MB). Q2: `S1/burst32` stays listed on both legs under owner 20 on ticket 67's schema (ccd5d27's deletion is reverted, 19 is restaged on 67 after 67 merges); the `flips` marks for every S1 burst key and leg are set in 19's restaged commit from ≥ 10 valid CI runs of the full short profile on staging/19 (Q2 conditions 1–5; linux burst32 keeps a mark unless RED in every run). Merge check (Q1 condition 5): 19's evidence lists every name it owned with its status ("moved to 20, Round 18"); after the move 19 owns no S1 name unless Round 17 Q3 gives it one (Q2 condition 6).
