# 77: Windows kill guard refuses ~1 in 3,500 proxies (start-time ticks rounded through a JS Number)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: sol
Risk: medium
ADR: no

**What to build:** Found by ticket 21 round 3 (run 42500996594, windows S1/short repetition 2: `stop.code 2`, twice `refusing to signal pid 5132: process handle identity could not be confirmed`, then `ERROR killing pid 5132`; the proxy stayed alive and the loop counted an orphan). `processStartMs()` in `lib/proxy-lifecycle.mjs` turns the .NET `StartTime.Ticks` string into milliseconds with `Number(ticks) / 10000 - 62135596800000`; the tick value (~6.39e17) is above 2^53, so the result can be a few µs low. The PowerShell guard in the stop path then compares the live creation time with `FromUnixTimeMilliseconds(Math.trunc(expected))` and refuses when the gap is above 1 ms; when the real start lies just above a millisecond boundary, the truncation drops a whole millisecond and every attempt for that process is refused. Simulation of the exact expressions: 571 of 2 M random start times refused (~1 in 3,500; `/home/AgentKit/overhaul-tools/t21-scripts/tick-trunc-sim.mjs`). Same code on the integration tip since September (35a9c4a, b20d4ca; moved unchanged in 931a219). Fix: carry the exact identity integer (ticks or FILETIME, as a string/BigInt) from the reader into the PowerShell comparison and compare integers; keep the guard's purpose (never signal a process whose identity is not proven, B4).

**Acceptance criteria:**

- [ ] Linux unit test pins the arithmetic, RED first on the tip: the worked example (ticks 639297530400030001) and a sweep of boundary tick values are accepted for the matching process and refused for a start 1 ms+1 tick away.
- [ ] The comparison is exact (integer ticks), not millisecond-rounded; a reused pid with a different start is still refused (adversarial test).
- [ ] Stored pid records written by older kits (millisecond `startMs`) still verify: tolerance for legacy records is stated and tested, without reopening the 1 ms rounding hole for new records.
- [ ] `stop.output` / summary notes record the PowerShell exit code of the guard (refusal branches distinguishable).
- [ ] windows test-kit legs green (pending CI); windows S1/short orphan count stays 0 in the next 10 runs that contain this ticket.

## Comments
