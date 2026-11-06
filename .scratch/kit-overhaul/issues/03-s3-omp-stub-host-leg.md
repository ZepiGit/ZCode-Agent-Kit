# 03: S3 OMP stub-host leg in the memory loop

**Blocked by:** 01 (Memory loop with budgets, process-count harness, expected-RED ratchet and the ubuntu `memory-budget` job), 02 (Windows sampler and the windows leg of the `memory-budget` job (Bun 1.4.2 reference run))

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0013

**What to build:** S3 gains an `omp` variant that runs the generated OMP extension in a stub Bun host on both OS legs: 5 simultaneous hosts, and again with the starter host killed. It counts concurrent OMP preflight processes, reports each host's RSS delta (not counted as kit footprint) and asserts that each waiter host printed the starter's `cause=` lines whenever the starter's preflight emitted any (Round 4 Q1 add. 4).

**Acceptance criteria:**

- [ ] Verdict tests pin the new checks: ≤ 1 concurrent OMP preflight process (5 hosts; killed starter), in-host waiter cost ≤ 5 MB per host (reported, gate), cause lines present in every waiter.
- [ ] On today's code the variant is RED (5 preflights) on both legs, and `expected-red.json` gains `S3/omp → 35` under `linux` and `windows`.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 31 (measurement), 32 (measurement)

## Comments
