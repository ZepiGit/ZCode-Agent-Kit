# 71: Measurement rules for three rare tails: S7 retained heap, windows S1/short repetitions, the OMP no-op floor

**Blocked by:** 67 (A plain expected-RED listing of a single-run key accepts any RED)

**Status:** ready-for-agent

Model: sol
Risk: low
ADR: no

**What to build:** Owner Proxy round 17 (DECISIONS.md, binding; Q1 conditions 1–4, Q3 conditions 1–4, Q4 condition 1). Three rare tails seen in ticket 67's eight evidence runs are decided as measurement-rule amendments, not as owned REDs. One ticket, so that a single pre-merge run on one tree confirms all three. Every budget, `growth()`, Round 7 Q1's commit gate, the 2.5 MB floor threshold and the 5 MB waiter gate stay unchanged.

1. **S7 retained heap (Q1 condition 1).** The 96 MB budget and the check name `responses-store:heap-at-cap` stay. The value becomes the store's *retained* heap:
   - After the existing 5 s wait, the scenario reads `/health` `heapUsedMB` at least 30 times, 1 s apart.
   - `heap-at-cap` = the **minimum** of that series minus `h0`.
   - `summary.json` and the check detail record the series: first reading (today's value), minimum, maximum, and RSS before and after.
   - No product code changes: no GC hook, no new endpoint (C6). Memory the store retains is present in every reading, so a store over its bound is RED under both rules, and the minimum is never above the first reading. Transient garbage stays bounded by S7's unchanged `procPeak:proxy` (WS 250 MB) and `commit-backstop:proxy` (512 MB). The short-profile load (1,500) and the long profile (4,000) stay as they are.
2. **Windows S1/short repetitions (Q3 condition 1).** The exact shape is the implementer's choice, in `REPEATED`, one place:
   - windows `S1/short` runs n = 5 fresh, isolated repetitions, one after another;
   - `growth:proxy` is RED when ≥ 3 of 5 repetitions are RED under the unchanged `growth()` (commit value > 5 AND trend); the reported value is the median;
   - **every** repetition must be ≤ 10 %/1k on commit (a ceiling: 4.73 above the observed max, z = 7.1);
   - every other S1/short check (`procPeak`, `steady`, `count`, `orphans`, `commit-backstop`) is judged in **each** repetition, and a RED in any one fails;
   - `summary.json` and the job summary print all five values, trends and the median.
   - Linux `S1/short` stays a single run. This departs from the `REPEATED` comment "One n for both legs": the key is windows-only (Linux: 70 runs, max 4.43, never RED).
   - Why n = 5 (Q3 condition 2): the smallest odd n whose predicted false-RED rate is ≤ 1 % on the less favourable fit (log-normal p = 0.078: n = 3 → 1.73 %, n = 5 → 0.42 %; empirical 2/49: 0.06 %; at the 95 % upper bound p = 0.14: 2.2 %). It costs about 18 min on a 42-min windows job, against a 150-min timeout.
3. **OMP no-op floor (Q4 decision and condition 1).** Ticket 03's floor test (`tests/memory/loop.test.mjs:459`) becomes **n fresh-host repetitions with two clauses**: the **median** no-op cost is < 2.5 MB; **every** repetition is < 5 MB; every value is printed, pass or fail. n comes from data (Round 6 Q1 condition 2's method): first record ≥ 20 no-op measurements on windows CI and ≥ 20 on Linux CI, through an off-by-default mode, with the values in METRICS. n is the smallest odd number in {3, 5, 7, 9} whose predicted false-fail rate (binomial on the measured fraction above 2.5 MB, less favourable leg) is ≤ 1 %. The stub OMP host runs under Bun; the Node version is not a variable.

**Interim until this ticket merges (Round 17 cross-question condition 2).** A staged or post-merge run of another ticket whose **only** failures match signature (i) S7/short `responses-store:heap-at-cap` RED, either leg, value ≤ 128 MB, every other S7 check as listed; (ii) windows S1/short RED only on commit on `growth:proxy` alone, ≤ 10 %/1k; or (iii) the floor test failing with a no-op cost < 5 MB, does not count against that ticket, does not block its merge and causes no revert, provided its diff does not touch the code the signature executes ((i): `zcode-proxy-src/**`, `s7-disk.mjs`, `proxy-session.mjs`; (ii): `zcode-proxy-src/**`, `s1-proxy-steady.mjs`; (iii): `fixtures/omp-host.ts`, `lib/omp-host.mjs`, the generated OMP extension; for every signature also `tests/memory/lib/{verdict,budgets,sampler*}.mjs` or the Bun pin). Each occurrence is recorded in this ticket's Comments with the run id and values. The exception ends when this ticket merges.

**Acceptance criteria:**

- [ ] S7 rule (Q1 condition 1): `responses-store:heap-at-cap` is the minimum of ≥ 30 `/health` `heapUsedMB` readings 1 s apart after the existing 5 s wait, minus `h0`; budget 96 MB and name unchanged; `summary.json` and the check detail record first reading, minimum, maximum, and RSS before and after; no product code change.
- [ ] S7 tests, RED first, at the job seam with fixture series (Q1 condition 2): a series [98, 97, 80, 64, …] is GREEN; a series that never drops below 97 is RED; a series with a missing or non-numeric reading is a harness failure, never GREEN; a series shorter than 30 readings is a harness failure.
- [ ] S7 mutant (Q1 condition 2), local, never committed: the store with both bounds removed, run on the **long** profile, is RED under the new rule. Its short-profile value under both rules is recorded as information.
- [ ] S7 evidence (Q1 condition 3): this ticket's pre-merge run and every later run record the series. If any run's minimum lies above 66 MB, it comes back as a question with the series; that does not block this ticket's merge.
- [ ] S7 records (Q1 condition 4): spec §18 S7 row gains "responses store heap at its cap ≤ 96 MB, judged on the minimum of ≥ 30 `/health` readings 1 s apart after the load (Round 17 Q1)"; METRICS gets the 51-run windows / 70-run Linux `heap-at-cap` table (Round 17 correction 2).
- [ ] Windows S1/short rule (Q3 condition 1) in `REPEATED`, one place: 5 fresh sequential repetitions; `growth:proxy` RED when ≥ 3 of 5 are RED under the unchanged `growth()`, reported value the median; every repetition ≤ 10 %/1k on commit; `procPeak`, `steady`, `count`, `orphans`, `commit-backstop` judged in each repetition, a RED in any one fails; `summary.json` and the job summary print all five values, trends and the median. Linux `S1/short` stays a single run.
- [ ] Windows S1/short tests, RED first (Q3 condition 3): five fixture repetitions with 2 RED pass; 3 RED fail; one repetition at 10.1 %/1k fails with a GREEN median; one repetition with `steady` RED fails; a missing repetition is a harness failure; the S1/burst1 cases are unchanged.
- [ ] Windows S1/short records (Q3 condition 4): spec §18 S1 row gains the rule; METRICS gets the 49-run windows table and the 70-run Linux range. (Round 17 already gave tickets 20 and 61 their Comments line; the orchestrator records Round 17 correction 1 in RUNLOG. No revert is owed for 42382114395.)
- [ ] OMP floor measurement (Q4 condition 1): ≥ 20 no-op measurements on windows CI and ≥ 20 on Linux CI through an off-by-default mode, values in METRICS; n set to the smallest odd number in {3, 5, 7, 9} whose predicted false-fail rate (binomial on the measured fraction above 2.5 MB, less favourable leg) is ≤ 1 %. If none reaches it, or any no-op measurement is ≥ 5 MB, it comes back with the numbers. Nobody raises 2.5.
- [ ] OMP floor test (Q4): n fresh-host repetitions; the median no-op cost is < 2.5 MB; every repetition is < 5 MB; every value is printed, pass or fail. The windows floor distribution is recorded where ticket 35's waiter-gate criterion can use it.
- [ ] Pre-merge run (cross-question condition 1): this ticket's pre-merge run confirms the three rules, it does not decide them. Any of the three signatures there is a disagreement and comes back.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

## Comments
