# 35: OMP in-host single-flight preflight with the cause-line result record

**Blocked by:** 03 (S3 OMP stub-host leg in the memory loop), 15 (Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets)), 33 (`proxy.log` single rotator: size-capped writer, manager rotation under the lock, file modes)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0013 (Round 4 amendment)

**What to build:** The generated OMP extension takes an O_EXCL autostart token (host pid + start time + per-attempt nonce) in the logs dir before spawning a preflight. Other hosts wait in-host (stat poll + existing `healthy()` fetch, no process), never past `START_TIMEOUT_MS`. Released in `finally`; stale tokens (holder dead, or older than `START_TIMEOUT_MS`) taken over by proof. The starter writes the result record by temp + rename (`0o600`) on every outcome before releasing the token; it holds only the exit code and fixed-vocabulary `cause=` lines (≤ 4 KB / ≤ 16 lines). A waiter accepts it only if its identity matches the observed token and it is not older than its wait start; validates each line before printing; treats a missing/stale/corrupt/oversized record as a starter failure and takes over with its own preflight. One fixed-name file, overwritten per attempt, never deleted by waiters. Old extensions are unaffected. Existing installs get the new extension on the next `setup`/`integrate`.

**Acceptance criteria:**

- [ ] Seam 8 (generated-logic fixtures): write-before-release; identity match; stale record from an earlier start never printed; corrupt and oversized records → takeover; vocabulary validation; file mode.
- [ ] Seam 1 (S3 omp leg): ≤ 1 concurrent preflight with 5 hosts and with the starter killed; every waiter printed the starter's cause lines; waiter cost ≤ 5 MB per host; log-dir files ≤ 8 in S4. The S3 omp leg runs on both legs. **Delete `S3/omp` (linux, windows).**
- [ ] Extension refresh replayed twice through the transaction is a no-op.
- [ ] Seam 8 (adversarial): a live starter's token is never taken over; a token whose holder is dead, or that is older than `START_TIMEOUT_MS`, is taken over by proof; a waiter never waits longer than `START_TIMEOUT_MS` (injected clock); the token and the record are created with mode `0o600` (Story 33).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 31, 32, 33, 135

## Comments
