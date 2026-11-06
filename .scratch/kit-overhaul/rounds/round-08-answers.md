# Round 8: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–7 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself:
- CI run 42281731448 (`gh run view`, `--log-failed`) on the `staging/02` head 0f324a7:
  - the windows `memory-budget` leg fails on exactly one ratchet line: `S1/burst1: GREEN but listed for ticket 20`;
  - S1/burst1 (windows) is `procPeak:proxy 222 MB (budget 250) [commit 365.2 / WS 222, gate WS]`, `count:proxy 1`, `orphans 0`, `@@JOB applied=1`, 3 requests;
  - the ubuntu leg's S1/burst1 is a single-run GREEN at 235.5 MB, and that leg fails on S3/hung;
  - all four `test-kit` legs and both `ux-before` legs are green.
- `expected-red.json` on `origin/staging/02`: `windows` lists `S1/burst1 → 20`, and `linux` does not list it.
- `staging/02` METRICS.md, Windows reference block:
  - run 4 S1/burst1: proxy peak 422 commit / 234.3 sampled WS, RED on live WS (`PeakWorkingSetSize`);
  - run 3: sampled WS 248.3, also RED through `PeakWorkingSetSize`;
  - the block's own caveat: "If it flips between runs, Round 6 Q2 condition 3 applies."
- Ticket 60 on `ticket/60-s1-burst1-median-rule` (`/home/AgentKit/wt/t60`, head 4a54f63, read-only):
  - 48 fresh Linux repetitions: 5 of 48 above 250 (p = 0.104); pooled with Round 6's samples, 8 of 59 (p = 0.136);
  - chosen n = 5, read from `budgets.mjs` (`REPEATED`);
  - the windows distribution was **not** measured.
- Ticket 60 in the integration tree says "Blocked by: 01, 02". Ticket 20 is unchanged in the integration tree, and its burst1 criterion text lives on the t60 branch.
- `tests/memory/lib/{win-sampler.mjs, verdict.mjs}` on `staging/02`: the WS gate uses `max(sampled WS, wsPeakKb)`. `wsPeakKb` is `PeakWorkingSetSize`, and it **defaults to 0** when the field is missing (`win-sampler.mjs:64`).
- RUNLOG 2026-11-06T13:11:25Z (the Round 6 Q1 order deviation) and 21:05Z (this round opened).

The windows S1/burst1 evidence so far is three single runs with WS gate verdicts **RED, RED, GREEN**. Its exceedance rate is unknown, and on these three runs it looks far above Linux's 0.10–0.14.

---

## Q1 — S1/burst1 (windows) went GREEN on the calibration run

**DECISION:** REJECTED in part.

Accepted:
- No list edit now.
- No budget change.
- Ticket 02's ubuntu S3/hung RED goes back to the 02 implementer first, outside this question.
- Then ticket 60 is finished on top of `ticket/02`. Both are merged into `staging/02` (02 first, then 60), and one pre-merge CI run judges them.
- 02 and 60 merge to the integration branch back to back, and only if that run is green on both legs.
- Ticket 20 keeps its ≥ 20-repetition criterion on both legs (RSS on Linux, WS on Windows).

Rejected: letting **one** pre-merge job run under the median rule decide whether the windows entry is deleted. That is a second list edit decided on a single sample. Round 6 Q2 condition 3 forbids it, and Round 7 Q3 condition 3 says the median rule "is not stretched to cover" a windows flip. Round 6 Q1 condition 2 requires that n comes from a measured distribution, with false-RED ≤ 5 % **per leg**. No windows distribution exists. At the windows evidence so far (2 of 3 RED, p ≈ 0.67), a median of 5 is GREEN about 21 % of the time. So the recommendation would leave the windows ratchet flaky one run in five if the entry is kept. If the entry is deleted on one GREEN median, about 79 % of later runs would fail as "RED but unlisted".

This answer is the "comes back as a question" step of Round 6 Q2 condition 3, and it authorises at most **one** further windows list change, decided by the rule below. Binding conditions:

1. **Rule out a measurement gap first (Round 6 Q2 condition 2).** From the run 42281731448 artefact, the proxy's `ws_peak_kb` in S1/burst1 `samples.csv` must be present and non-zero, and the 222 MB gate value must equal `max(sampled WS, ws_peak_kb)`.
   - If `ws_peak_kb` is missing or 0, the GREEN came from a missing observation (`wsPeakKb` defaults to 0). That is a harness failure and a real RED for ticket 02 (Round 6 Q2 condition 4). The windows entry stays, and the RED, RED history stands.
   - The check goes in ticket 02's Comments.
2. **Measure the windows distribution before the list question is settled.** On windows-latest, with the staged 02+60 code, run S1/burst1 as **at least 20** fresh, isolated repetitions, one after another.
   - Each repetition runs in its own Job Object with `@@JOB applied=1`.
   - The mechanism is the implementer's choice, for example the windows memory job restricted to S1/burst1 on the staging branch. It must use no new endpoints (C6).
   - Record per repetition: the WS gate value, sampled WS, `ws_peak_kb` (non-zero), commit peak, `count:proxy` and the units self-test.
   - Every repetition must also stay ≤ 400 MB WS (Round 6 Q1 condition 3 as amended by Round 7 Q1).
   - Write it to METRICS.md and ticket 60's Comments the way the Linux block was written.
   - Compute p_win twice: from these repetitions alone, and pooled with runs 3, 4 and 5 counted as RED, RED, GREEN. The decision uses the less favourable estimate, as ticket 60 did on Linux.
3. **One n, from both legs, read from one place.** n is the smallest odd n ≤ 9 at which, on **each** leg, the median verdict matches that leg's list state with probability ≥ 95 %: P(median RED) ≤ 5 % where the variant is unlisted, and P(median GREEN) ≤ 5 % where it is listed. Linux needs n ≥ 5 at p = 0.136. If windows needs more, n rises for both legs (≤ 9), and `verdict.test.mjs` pins the computation on both distributions. For n ≤ 9 the bands are:
   - **Windows entry deleted** if p_win ≤ 0.251 at n = 9 (≤ 0.189 at n = 5). Ticket 60's commit makes the deletion and cites the distribution and the condition 1 observation checks (Round 6 Q2 condition 2). Ticket 20's "Delete `S1/burst1` (windows)" criterion is struck with a note. Its "every repetition ≤ 250 MB on each leg" criterion stays, because the tail still exists.
   - **Windows entry kept under 20** if p_win ≥ 0.749 at n = 9 (≥ 0.811 at n = 5). That is a stable RED that ticket 20 owns.
   - **Neither:** p_win is in the middle band, where no median of n ≤ 9 gives a stable verdict either way. Then the list does not change, no budget changes, and no "flaky entry" mechanism is added (Round 6 Q1 rationale). 02 and 60 do not merge. The question comes back with the windows distribution, the same as Round 6 Q1's "no n ≤ 9" exit.
4. **The pre-merge run confirms. It does not decide.** If the one pre-merge CI run on `staging/02` (02 + 60, with the list from condition 3) disagrees with the list on either leg's S1/burst1, there is no rerun-until-green. The run's numbers come back as a question, and 02 and 60 do not merge. Any other RED follows Round 6 Q2 condition 4 and the Phase 4 rule as usual.
5. **Order and records.**
   - Staging 02 and 60 together, with 02 merged first, meets ticket 60's "Blocked by: 02" edge and restores Round 6 Q1's intent that a pre-existing burst1 flake cannot trigger a revert of 02.
   - RUNLOG records this as the closure of the 13:11:25Z deviation.
   - Ticket 02 stays open until the pre-merge run is green on both legs (Round 6 Q2 condition 6).
6. **Nothing else changes:**
   - the 250 MB budget;
   - the 400 MB per-repetition ceiling;
   - the `linux` list;
   - every other `windows` entry;
   - `budgets.mjs`, except `REPEATED` if condition 3 raises n;
   - Round 7 Q1's metric split.

**Rationale:** The windows S1/burst1 peak sits right at its budget. The live WS is just over 250 in runs 3 and 4 and 222 in run 5, so a single run is a coin flip, not evidence (C9, Round 6 Q1). The recommendation is right on order: staging 02 and 60 together fixes the Round 6 Q1 deviation without a second calibration edit, and its merge gates are right. But it then lets one median-of-5 job run settle a list entry, using an n computed only from Linux. Round 6 Q1 requires n per leg from a measured distribution. Round 6 Q2 condition 3 and Round 7 Q3 condition 3 send a windows flip back as a question rather than letting a single run or a stretched median resolve it. The binomial bands show why that matters. Unless Windows' exceedance rate is outside roughly 0.25–0.75, no permitted n gives a stable windows verdict, and either list state would make the ratchet flaky, which leads to spurious reverts under Phase 4. Measuring 20+ windows repetitions first costs about 10 minutes of CI. It turns the entry into a decision backed by numbers, and it keeps the ratchet's meaning: an entry is RED until its owner's fix and GREEN otherwise. Condition 1 guards the one way this GREEN could be fake: a missing `PeakWorkingSetSize` silently defaults to 0.

**Charter:** C9 (stronger measured evidence; then the smaller blast radius: no merge on a coin flip), C1 (bounded memory proven by a distribution, not a lucky sample), C7 (Windows is primary, so its leg needs its own evidence), §9 (no budget loosened), Round 6 Q1 conditions 2, 3 and 5, Round 6 Q2 conditions 2, 3, 4 and 6, Round 7 Q1, Round 7 Q3 condition 3, PROMPT §7 Phase 4 (no spurious reverts).

**REVERSIBILITY:** Two-way door (a list entry, the repetition count and ticket text). No ADR.

---

## Shared understanding

CONFIRMED. No design branch is open. These come back as questions with numbers when they occur:
- the run 42281731448 GREEN turns out to be a missing `PeakWorkingSetSize` observation (a harness RED for 02);
- the windows S1/burst1 exceedance rate falls in the middle band, where no median of n ≤ 9 is stable;
- the pre-merge `staging/02` run disagrees with the distribution-backed list.
