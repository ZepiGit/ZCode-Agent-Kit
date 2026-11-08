# 78: windows S1/short commit growth: repetition-position and tree effects

**Blocked by:** None (recording starts now)

**Status:** needs-triage

Model: sol
Risk: medium
ADR: no

**What to build:** Owner Proxy round 28 Q1 condition 4. Since ticket 71 judges windows S1/short on 5 sequential repetitions, the per-repetition commit growth runs higher (80 repetitions, mean ~4.0, 14 above 5 %/1k; p(repetition > 5) ≈ 0.175, so P(≥ 3 of 5) ≈ 4 % per run) than the 49-run single-run distribution the n = 5 rule was designed on (mean 3.41; predicted 0.42 %). The 23 single runs just before the rule match the old history (mean 3.47). Repetitions 2–5 average higher than repetition 1 (4.12 vs 3.53, t ≈ 2.0). This ticket owns no name and lists nothing (Round 17 Q3's rejection of a listing stands).

**Records:** for every windows S1/short run from now on (Comments or the METRICS table "Windows S1/short repetitions by position"): run id, tree, position 1–5, commit value, trend, WS value; back-filled with the 16 five-repetition runs and the 23 single runs of Round 28 (generator: `/home/AgentKit/overhaul-tools/t78-scripts/s1short-table.mjs`). Every signature (vii) occurrence is recorded here with run id and the five values.

**Asks (comes back to the Owner Proxy with):**
- (a) Do repetitions 2–5 differ from repetition 1 and from the single-run history (the repetitions not independent draws)?
- (b) Does any merged tree shift the mean (compare position by position)?
- (c) Which rule then holds a false-RED rate ≤ 1 % without loosening the 5 %/1k budget, the trend clause or the 10 %/1k ceiling (e.g. better isolation per repetition, another statistic)? An off-by-default measurement mode on a staging branch is allowed (no new endpoint, C6).

**Comes back:** when 20 more windows runs exist (100 more repetitions); earlier if two (vii) occurrences fall within any 10 consecutive windows runs; earlier if any windows S1/short RED falls outside (vii). Until answered: no change to n, k, the budget, `growth()` or Round 7 Q1's commit gate.

**Interim signature (vii) (Round 28 Q1 condition 5), ends when this ticket is answered:** a staged or post-merge run whose only unexcused failure is windows S1/short RED on growth:proxy (≥ 3 of 5 RED), every repetition ≤ 10 %/1k commit, median ≤ 5.5, WS growth ≤ 5 in every repetition, every other S1/short check GREEN in every repetition, does not count against the ticket. Ineligible: a diff touching `zcode-proxy-src/**`, `tests/memory/scenarios/s1-proxy-steady.mjs`, `tests/memory/lib/**`, `tests/memory/job.mjs`, the Bun pin or the memory job's Node version.

## Comments

- 2026-11-08 (orchestrator, Round 28): first data set in METRICS "Windows S1/short repetitions by position (Round 28 Q1)": 16 five-repetition runs (10 on ticket 20's tree f1cdaff, 6 on other trees) and 23 single runs. Per position: 1: 3.53, 2: 4.16, 3: 3.64, 4: 4.53, 5: 4.17 (mean, n 16 each). The one RED among them, 42503284096 (staging/20: 5.27, 4.5, 5.12, 6.04, 4.92), was decided by Round 28 (not charged to 20; no signature, 20 is ineligible).
