# 01: Memory loop with budgets, process-count harness, expected-RED ratchet and the ubuntu `memory-budget` job

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0016, 0002 (budgets), 0004 (burst budgets)

**What to build:** The memory loop from `diagnosis/memory` becomes committed code under the isolated-installation rules (port 18457–65000, temp HOME/state dir, mock upstream, fixture credential, `ZCODE_OVERHAUL_RUN=1` / `ZCODE_MEMLOOP_ALLOW=1`). The verdict module encodes every §18 MEMORY budget and the PROCESSES counts, the two-part S3 verdict (summed-sample maximum + per-role peaks: launcher ≤ 74, bridge ≤ 75, starter preflight ≤ 76, proxy idle ≤ 62, solver idle ≤ 20 MB), the S2/S4 solver-process checks (0 solver processes after the proxy is SIGKILLed, 0 after an idle exit, ≤ 1 per proxy at every sample) and the additive `commit_kb` sampler column (empty on Linux). `expected-red.json` (per OS leg) and its ratchet land with a `memory-budget` CI job on ubuntu (Node 26, short profile S1–S7, `systemd-run --user` scope or `prlimit`, timeout, artefacts). The 10-launch process-count test (exactly 1 proxy, 0 failed launches incl. a killed holder, 0 orphans after stop) is part of S3.

**Acceptance criteria:**

- [ ] `node tests/memory/run.mjs S1…S7 --profile short` runs on the integration branch; exit codes 1 RED / 0 GREEN / 2 harness failure.
- [ ] Pinned verdict tests (`verdict.test.mjs`) cover: slope + trend rules, role peak, per-process HWM peak, process counts, orphans, the S3 two-part verdict and role budgets, and the ratchet: a RED scenario not listed fails; a listed scenario that is GREEN fails; an unknown scenario/variant fails; a ticket id with no `issues/<NN>-*.md` file fails (seam 9).
- [ ] `expected-red.json` lists, for `linux`: S1/burst4, S1/burst16, S1/burst32, S1/bigbody → 19; S2/short → 58; S3/short → 37; S3/hung → 16; S4/short → 17; S5/short → 30; S6/short → 32; S7/short → 34 (names as finalised here; S3/omp is added by 03; `windows` by 02).
- [ ] The ubuntu `memory-budget` job is green with that list (all listed scenarios RED, everything else GREEN) and uploads CSV + summary artefacts; `ZCODE_MEMLOOP_ALLOW=1` is set only in this job.
- [ ] METRICS.md records the committed-loop Linux run on Bun 1.4.2 against the Phase 1B baseline (no budget loosened).
- [ ] After this ticket merges, the orchestrator opens the draft PR against `main` (never merged; nothing pushed to `main` or `feature/account-rotator`), and its first CI run is the one ticket 02 needs.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 41, 141, 143

## Comments
