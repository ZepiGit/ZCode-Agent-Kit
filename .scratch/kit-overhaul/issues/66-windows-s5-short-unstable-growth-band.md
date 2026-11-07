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
