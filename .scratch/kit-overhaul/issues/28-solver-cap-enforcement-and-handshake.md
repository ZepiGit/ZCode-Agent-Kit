# 28: Solver cap enforcement per OS and the cap handshake

**Blocked by:** 27 (Solver as a child process: spawn, environment parity, lazy start, idle exit, one generation)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0002

**What to build:** Windows: Job Object via `bun:ffi` with `JOB_OBJECT_LIMIT_PROCESS_MEMORY` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, no new dependency. Linux: user-systemd cgroup v2 scope with `MemoryMax=` and `MemorySwapMax=0`, verified by reading the scope's `memory.max`, else `sampling`. macOS: `sampling` (footprint sampling and kill). Enforcement mode `job-object|cgroup|sampling|none` (`none` = thread transport or caps off), exposed through the dispatcher stats for 39. The child loads neither happy-dom nor solve code until the handshake confirms the cap. Cap 300 MB by default; the `config.yaml` key is validated at config load against a documented minimum (what/why/next). A cap kill is logged as an event line naming the key that raises the cap. An idle exit releases the cap container (Job Object closed, scope ended).

**Acceptance criteria:**

- [ ] Seam 3: handshake ordering: no heavy module is loaded before the cap acknowledgement (module-load probe in the child); a child whose acknowledgement never arrives is killed and never solves.
- [ ] Seam 1/3 (adversarial, the cap's purpose): a fixture backend that allocates past the cap is killed by the active mode on each leg (`job-object` on windows-latest; `cgroup` on ubuntu where the memory controller is delegated, otherwise `sampling`), and the kill line names the config key.
- [ ] Adversarial (never claim a cap that is not there): with the memory controller not delegated (simulated: the scope's `memory.max` missing or not equal to the requested value), the mode is `sampling`, never `cgroup`.
- [ ] Seam 1: after an idle exit, the scope no longer exists (Linux) or the Job Object handle is closed (Windows), and 0 solver processes remain. Windows leg: Job Object reaping after the proxy is SIGKILLed → 0 solver processes (build-time gate 5).
- [ ] Config validation: a value below the documented minimum is rejected at load with what/why/next; the default is 300 MB.
- [ ] A1 (live vendor-SDK solve under 300 MB) recorded as an owner action, marked unverified.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 2, 3, 4, 5, 8, 10, 15, 16, 60

## Comments
