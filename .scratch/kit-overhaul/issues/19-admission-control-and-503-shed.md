# 19: Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract

**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24), 14 (Event-line format and redaction for new log events (prefactor))

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0004

**What to build:** In-flight bytes count from body read until sent upstream, capped at 64 MB (config key + `proxyEnv` exception env override). Queued requests have unread bodies (socket backpressure); the queue is FIFO, bounded by a documented count and 15 s. Overflow/timeout sheds HTTP 503 + `Retry-After` in the endpoint's own shape (OpenAI `error` object; Anthropic `overloaded_error`), never 429, never a reset. Open response streams are not limited. The shed helper is reused by the supervisor (21) and the solver fail-fast (58). Admission counters (`inFlightBytes`, `queued`, `shedTotal`) are exposed internally for 39.

**Acceptance criteria:**

- [ ] Loopback tests (seam 4): byte cap holds; queued bodies unread (server-side read counter); FIFO order; count bound and 15 s bound each shed with the right shape per endpoint; no 429 anywhere; 17+ concurrent streams not limited.
- [ ] Loop S1 burst: HWM ≤ 400 MB at 16 and ≤ 600 MB at 32 × 10.8 MB bodies (≥ 30 % peak improvement); bigbody within budget. **Delete `S1/burst4`, `S1/burst16`, `S1/burst32`, `S1/bigbody` (linux, windows).**
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
