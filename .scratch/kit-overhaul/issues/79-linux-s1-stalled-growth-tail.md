# 79: linux S1/stalled growth:proxy: tail and burst spread (needs triage)

**Status:** needs-triage
**Blocked by:** none

**What to build:** nothing yet. Record every linux S1/stalled run from 2026-11-09 on (run id, tree, growth:proxy %/1k, trend, procPeak:proxy, window medians from summary.json where the artefact exists, number of CI runs created in the 10 minutes before it) and back-fill the 146 distinct values recomputed in Owner Proxy round 30 (135 archived under ci-art, deduplicated by loop id, plus 11 streamed; 1 RED: 42542646289, 5.5 %/1k, trend true). Questions for an Owner Proxy round: (a) is the upper tail stable or did a merged tree shift it; (b) is the wider spread of the staging/30s burst (sd 3.43 against 1.79, mean unchanged) runner contention or a tree effect; (c) if a rule is needed, which one holds a false-RED rate <= 1 % without loosening the 5 %/1k budget or the trend rule. This ticket owns no name and lists nothing; no signature applies meanwhile.

**Comes back:** after 20 more linux runs; earlier on a second RED within any 20 consecutive linux runs, on any value above 6 %/1k, or on any linux S1/stalled RED in a ticket's own staged or pre-merge run.

## Comments
