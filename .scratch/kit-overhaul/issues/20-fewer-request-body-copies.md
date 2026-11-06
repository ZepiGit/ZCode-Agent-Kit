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
