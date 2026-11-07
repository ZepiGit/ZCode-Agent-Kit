# 66: Windows S5/short re-listed under ticket 30 with a bounded unstable growth band

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: glm
Risk: low
ADR: no

**What to build:** Owner Proxy round 13 Q1 (DECISIONS.md Round 13, binding, read in full). Windows `S5/short` `growth:mcp-bridge` is over its 5 %/1k budget in 28 of 28 windows runs (max 26.24) and RED only when the trend flag also fires (1/28). It is the same defect as Linux S5/short (ticket 30). List windows `S5/short → 30` with the `unstable` state, judged on the commit value of `growth:mcp-bridge` (not on RED/GREEN): 5 < value ≤ 30 %/1k passes with either trend flag and prints "unstable … owned by ticket 30"; > 30 fails; ≤ 5 fails as "at budget but listed"; any other S5 RED (procPeak, orphans, reboot cost, task failures, harness, Job Object, units self-test) fails; a growth check with too few samples or no value fails as a measurement gap. One allow-list in code (tests/memory/lib/ratchet.mjs) with two keys: S1/burst1 (300 MB median bound, unchanged) and S5/short (growth-value band); the state on any other key or on Linux is a schema error.

**Acceptance criteria:**

- [ ] Ratchet + schema implement the band exactly as Round 13 conditions 1 and 3 say; tests pin each case (passes at 6, 26.24 and 30; fails at 30.01, at 5, on any other S5 RED, on a missing growth value, on `unstable` for any third key or Linux S5/short); a mutation proof per guard.
- [ ] `expected-red.json` windows gains the S5/short entry in the unstable shape; nothing else in either list changes.
- [ ] Records (Round 13 condition 8): spec §18 S5 row; METRICS.md tables for the 28 windows and 26 Linux S5/short runs (values in DECISIONS Round 13 / the answers file).
- [ ] One pre-merge run of this ticket alone is green on both legs (pending CI).

## Comments

- 2026-11-07 (implementer, claude-opus-5-5; the glm worker has no provider). Branch `ticket/66-windows-s5-unstable-band`: 7dc1145 (ratchet, job, list, tests, fixtures), 9dff80d (spec §18, METRICS), then this comment. Integration tip a912cce merged ("Already up to date").
  - **Suites** (after the merge, Node 26.7.0, Bun 1.4.2): `npm run test` 756 tests, 737 pass, 0 fail, 19 skipped (`reports/t66-test.log`); `npm run test:proxy` 1343 pass, 0 fail, 90 files (`t66-test-proxy.log`); `npm run test:mcp` 96 tests, 95 pass, 0 fail, 1 skipped, `dist/` unchanged (`t66-test-mcp.log`). Memory tests alone: 155 tests, 150 pass, 0 fail, 5 skipped (`t66-green-memtests.log`).
  - **Memory loop, Linux, short profile** (`job.mjs --os linux --only S5/short`, `t66-linux-s5-job.log`): unchanged. Plain entry `S5/short → 30`, RED on growth:mcp-bridge 42.61 %/1k with trend (window medians 85.8 → 95.6 MB, net rise 11.4 %). procPeak 100.2 MB, orphans 0, reboot cost 2 MB, 0 task failures. Ratchet holds.
  - **RED → GREEN.** On a912cce the new and adjusted tests fail: 11 tests (`/home/AgentKit/overhaul-tools/t66-red-memtests-tip.log`). The replay of CI run 42404639968's windows `S5/short` summary through `job.mjs` fails there with `S5/short: RED but not listed in expected-red.json (windows)`, the CI's own line. After 7dc1145, 0 fail. Replaying through the job CLI (`t66-replay-ci-*.log`):
    - 42404639968: `| S5/short | RED (unstable) | ticket 30 |` and `S5/short: unstable (growth:mcp-bridge 23.71 %/1k commit, budget 5, bound 30, trend true), owned by ticket 30`.
    - The GREEN run 42401136452: `GREEN (unstable)` and `… 15.55 %/1k commit, budget 5, bound 30, trend false), owned by ticket 30`.
    - Both exit 0.
  - **Cases pinned** (verdict.test.mjs ratchet seam, loop.test.mjs job seam with the CI fixtures and variants of them):
    - Pass at 6 (either trend), 15.55 false, 23.71 true, 26.24 false and 30 (either trend).
    - Fail at 30.01, and at 5 and 4.9 ("at budget but listed for ticket 30"), either trend.
    - Fail on a band value with procPeak:mcp-bridge (WS 151), orphans 1, reboot cost 21 or task failures 1.
    - Fail on RED with no red check, on a harness failure, and on an insufficient growth check, no value, no growth check, no commit value or a WS gate (all measurement gaps).
    - Schema error on `unstable` for linux `S5/short` and for a third key (windows `S3/short`, also `S3/omp`), and on an entry carrying its own bound.
    - Schema error on an allow-list bound that does not fit its key: a median bound on S5/short, a growth band on S1/burst1, both kinds at once, a non-growth check, or max ≤ budget.
    - The S1/burst1 cases are unchanged.
  - **Mutation proofs** (`t66-mutations.log`, script `/home/AgentKit/overhaul-tools/t66-scripts/mutate.mjs`, each mutant restored with `git checkout 7dc1145 -- <file>`, restore diff empty, tree clean after). All 9 were killed:
    - M1: upper bound removed.
    - M2: lower bound removed.
    - M3: the other-RED rule removed.
    - M4: the measurement-gap rule removed.
    - M5: the commit-gate requirement removed.
    - M6: the allow-list ignores the OS leg (linux S5/short accepted).
    - M7: the bound-kind check removed.
    - M8: job.mjs no longer hands the growth checks over.
    - M9: the list entry removed.
  - **List:** `git diff a912cce -- tests/memory/expected-red.json` is exactly one added line, windows `"S5/short": { "ticket": "30", "state": "unstable" }`. Nothing else changed in either list.
  - **Decisions taken (smallest that satisfies Round 13):**
    1. Bound shape `{ growthBand: { check: "growth:mcp-bridge", budget, max: 30 } }` in `UNSTABLE`, with `budget` read from `MEMORY.growth.maxPctPer1k`, so the floor cannot drift from the budget. The JSON entry shape stays `{ ticket, state }`.
    2. "The value on commit" is the growth check's `commitValue` with `gate: "commit"`. A WS- or RSS-only value is a measurement gap, never judged.
    3. A bound kind that does not fit its key is a schema error, and that key then judges nothing (no pass line).
    4. `job-summary.json` results gain an additive `growthChecks` field (name, value, commit/WS value, gate, budget, trend, insufficient, samples, window medians), so C2 holds.
    5. The job summary's unstable heading now names both rounds and both exits.
  - **Existing tests changed (C2 justification):**
    - Three regexes on the schema-error text now name both keys and Round 13 (the allow-list content changed by Round 13 Q1 condition 3).
    - The committed-list test now expects two non-plain entries.
    - The S3/omp test's result builder gives the S5 unstable entry a growth check. Without it, that test's synthetic S5 result has no value and is correctly a measurement gap.
    - No S1/burst1 behaviour changed.
  - **Records (condition 8):**
    - spec §18 S5 row: the band, its bound and its only exit, as a measurement-rule amendment.
    - METRICS.md "S5/short growth:mcp-bridge across CI runs": the 28 windows runs and the 26 Linux runs, with run ids, branch, commit and WS values (Linux RSS), trend and verdict. They come from the job logs in `/home/AgentKit/overhaul-tools/ci-art/t66-full-logs/`, and the statistics match Round 13 exactly.
    - Two findings in those records:
      - (a) The Owner Proxy's 26 Linux runs are the 28 windows-paired runs less 42252896054 and 42265988296. The period holds 37 Linux runs, all RED with trend (37.53–46.33); METRICS lists the other 11.
      - (b) Rows 1–2 (Round 7's runs 3 and 4) have no WS split in their logs. Their WS growth (31.66, 21.68) is re-judged from the artefacts, and their commit values match the logs.
  - **Pre-merge run (pending CI, orchestrator verifies after merge+push).** The windows `memory-budget` job must:
    - show "ratchet holds";
    - show the row `| S5/short | RED (unstable) | ticket 30 |` or `| S5/short | GREEN (unstable) | ticket 30 |`;
    - print `S5/short: unstable (growth:mcp-bridge <x> %/1k commit, budget 5, bound 30, trend <t>), owned by ticket 30` with 5 < x ≤ 30, next to the unchanged S1/burst1 unstable line.

    The ubuntu leg must be unchanged (`S5/short` RED → ticket 30), and every other job green. Disagreement (Round 13 Q1 condition 6) is any condition-1 ratchet failure on windows S5/short or anything else RED that is not listed: the numbers come back, with no rerun.
  - **Left for others:** ticket 30 owns the only exit (≥ 10 windows runs ≤ 5 %/1k regardless of trend, then delete the entry and the `S5/short` key in `UNSTABLE`); ticket 55 removes the allow-list; ticket 67 owns the gap that plain listings accept any RED.
