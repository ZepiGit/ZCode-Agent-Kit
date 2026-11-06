# Round 7: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–6 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself:
- `/home/AgentKit/overhaul-tools/t02-winmem-4.log`: run 42265988296 on the `pull/14` merge of 82de0da, windows-2025 image, Bun 1.4.2, Node 26.13.0, `@@JOB applied=1` on all 13 runs, no harness failure.
- `t02-winmem-3.log` and its artefact `t02-ci-artifact-42252896054/` (every `summary.json` and `samples.csv`). I recomputed per-process working set against commit from the CSVs, because **the run-4 log does not carry working-set values**. Its check lines print commit only. Working set shows up only as a verdict ("S1/short … working set: green"), and the run-4 artefact is not on this host. The working-set numbers below are therefore *sampled* WS from run 3. The WS verdict itself uses `PeakWorkingSetSize`, which `samples.csv` does not store (`win-sampler.mjs:11`, `verdict.mjs:215-217`).
- Ticket 02 on `ticket/02-windows-sampler` (worktree `/home/AgentKit/wt/t02`, head dd34ff8), Comments rounds 2–5, and `tests/memory/{expected-red.json, lib/budgets.mjs, lib/verdict.mjs, lib/win-sampler.mjs, scenarios/s1-proxy-steady.mjs}`. Also `proxy/zcode-proxy-manager.mjs:629-639` and `:274-284`.
- Issues 16, 17, 19, 20, 30, 33, 34, 37 and 60 in `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/issues/`, spec §18 and PROMPT §9.

Where an answer is ACCEPTED with conditions, the conditions bind the loop, the tickets and spec §18.

---

## Q1 — Which Windows metric gates the per-process budgets

**DECISION:** ACCEPTED with conditions. On Windows, the per-process peak and steady budgets are judged on the working set, which is Windows' RSS. Peaks use `max(sampled WS, PeakWorkingSetSize)`. This applies to the proxy, launcher, MCP bridge and preflight in S1, S3, S5 and S7, and to the S1/burst1 median rule. Commit is reported for every process. **This explicitly amends** Round 1 Q7 condition 3, Round 2 Q13 ("RED rules use commit charge on Windows"), Round 3 Q1 condition 2(b) (Windows per-process peak = `PeakPageFileUsage`), Round 6 Q1 conditions 4–5 ("commit on Windows"), the spec §18 sentence "commit on Windows unless stated", and ticket 02's "RED rules use commit on Windows". The amendment covers the per-process budgets named above and nothing else. Round 2 Q13 condition 3 and Round 6 Q2 condition 1 reserved exactly this question for the owner, so answering it here is the intended path, not a silent adjustment. Binding conditions:
1. **These stay on commit, because commit is what the OS enforces or what exhausts the system (C1):**
   - the S3 kit total (Round 3 Q1; see Q2);
   - every growth check;
   - every solver and S2 check: `procPeak:solver` anywhere, cost per generation, retained before recycle, hung-solve reclaim, and `procPeak:scenario` while S2 hosts the solver in-thread. The Job Object cap is a commit limit (Round 1 Q3 condition 5, ADR-0002), and a solver judged on WS could pass the test while the product's cap kills it.
2. **A commit backstop for the proxy.** In the paced runs (S1/short, S1/stalled, S3, S4, S7), no proxy sample's commit may exceed the ADR-0008 soft limit of 512 MB footprint. Above that limit the product's own `doctor` WARNs (Round 3 Q7), so a run there is not a pass. Today's values are all below it (S1/short 347.7, S1/stalled 452.3, S7 401.5, S3 188 MB), so the calibration does not change. Burst and bigbody runs are judged by their peaks only (ticket 01 decision 3).
3. **The WS peak must be reproducible from the artefact.** `samples.csv` gains an additive `ws_peak_kb` column (Round 2 Q13 condition 2 precedent). The job summary and `summary.json` print the commit value and the WS value for every memory check, not just a WS verdict. METRICS.md records both numbers per run, as Round 6 Q2 condition 5 already requires ("commit, working set").
4. `verdict.test.mjs` pins the split RED → GREEN with at least these cases:
   - a Windows proxy RED only on commit is GREEN;
   - a solver RED only on commit stays RED;
   - an S3 total RED only on commit stays RED;
   - a paced proxy above 512 MB commit is RED even when its WS is green.
5. Linux, every budget number and the product's own metrics (ADR-0002 cap, ADR-0008 footprint thresholds, `memory[]` fields) are unchanged. The amendment goes into spec §18 (metric sentence and the S1/S3 rows), ticket 02, ticket 20 (see Q3), and RUNLOG as a recorded deviation.

**Rationale:** §9 states the per-process budgets in RSS, and all of their numbers (250/160, 62/74/75/76, 150) were derived from Linux RSS. The measurements show that Windows working set is the like-for-like counterpart and commit is not:
- An idle proxy is 52–57 MB WS against 166–188 MB commit (run 3, S3/S4). Linux RSS is ~60 MB.
- A proxy's first sample is already 27 MB WS / 113 MB commit (S4 pids 2676 and 1644), so the ~120–130 MB offset exists before the kit does any work.
- S1/short peaks at 150 MB sampled WS against 331 MB commit. Linux: steady 122, HWM 173.

Judged on commit, these budgets cannot be reached by any kit fix:
- The S3 proxy target is 62 MB against an idle commit of ~188.
- S7's proxy peak (401.5 commit, 190.7 sampled WS) would keep ticket 34 from ever deleting its entry.
- burst1's per-run 400 MB ceiling (Round 6 Q1 condition 3) would fail on commit alone (422/424.5).

The result would be a permanent expected-RED list, which defeats §9 CI ("green on windows, empty list"). That is not a gate (C9: stronger measured evidence). Round 1 Q7 chose commit for a valid C1 reason: it is the resource that exhausts Windows, and the OS may trim the working set. Conditions 1–2 keep that guarantee where it matters: the cap, the total, leak detection, and a product-meaningful ceiling. The combination is not the strictest metric for every check. The S3 WS sum is higher than the commit sum: in S3/hung run 3, commit was 460 and GREEN while WS was RED. I keep commit for the total because Round 3 Q1 bound it, because private commit adds up across processes while a WS sum counts shared image pages once per process, and because Q2's ≥ 30 % rule tightens it anyway.

**Charter:** §9 (budgets stated in RSS; numbers unchanged), C1 (the enforced cap metric, leak detection and the total stay on commit; backstop), C7 (meaningful gates on the primary platform), C9 (stronger measured evidence), Round 2 Q13 condition 3, Round 6 Q2 condition 1.

**REVERSIBILITY:** Two-way door (a measurement rule in test code and spec text). No ADR. The amendment is recorded in spec §18 and RUNLOG.

---

## Q2 — The Windows S3 total

**DECISION:** ACCEPTED with conditions. The Windows S3 total is **≤ 514 MB of commit** (734.5 × 0.7 = 514.15, rounded down, which is a tightening). PowerShell processes the kit itself starts count as kit footprint. This is consistent with Round 3 Q1 condition 3 and Round 6 Q2 condition 5; it contradicts nothing. Binding conditions:
1. **The baseline is this run.** Run 42265988296 is the first clean windows run, on Bun 1.4.2 (Round 3 Q9 condition 1). It goes into METRICS.md as the Windows reference with the Round 6 Q2 condition 5 fields, plus the WS sum for information (Q1 condition 3). Run 3 (738.4 MB) is cited as corroboration and does not raise the number.
2. **One Windows S3 total applies to every S3 variant**: `kitTotalMB.windows` 600 → 514 in `budgets.mjs`, pinned by `verdict.test.mjs`. S3/hung (456.8) stays GREEN on this check. Nothing under `linux` changes.
3. **What counts.** Every process the kit starts counts (Round 1 Q6), and so does its conhost:
   - the launcher's, manager's and preflight's PowerShell for identity and start-time proofs (~65–72 MB commit each; one includes an `Add-Type` `csc.exe` compile).

   The loop's own `netstat`/PowerShell stays in the `tooling` role and is excluded. Ticket 02 already pins that attribution (`t02-r2-red4/5`, `t02-r4-red2`), and it stays pinned.
4. **Ticket 37's Windows criterion** changes from "≤ 600 MB commit (≥ 30 % rule …)" to "≤ 514 MB commit".
5. **Known risk, recorded rather than adjusted.** On today's per-process commit, the proxy (187.9) plus five bridges (role peak 388.1) already make 576 MB, before launchers (161.9) and preflight. With mechanisms (a)–(c), 514 is therefore unlikely on Windows without further levers. When ticket 37 misses, build-time gate 2 applies (Round 3 Q2 condition 8): the orchestrator returns with numbers for the measured levers. Those are the lean resident launcher and the Bun bridge, and now also replacing the per-call PowerShell proofs. No lever is adopted now, and the 514 is never loosened (§9).

**Rationale:** The ≥ 30 % rule applies to every baseline above its budget on each leg (Round 3 Q1 condition 3), and Round 6 Q2 condition 5 already ordered this exact tightening. "Total kit footprint" means every process the kit starts. A PowerShell child of the launcher or manager is such a process, and leaving it out would understate Windows' real cost by ~65–72 MB per call. Writing down that 514 is probably out of reach of the planned mechanisms keeps the gate honest instead of leaving it to surprise ticket 37.

**Charter:** §9 (≥ 30 % rule; no loosening), C1 (the kit's processes are bounded in total), C7, C9, Round 1 Q6, Round 3 Q1/Q2.

**REVERSIBILITY:** Two-way door (a budget value; only further tightening is allowed). No ADR.

---

## Q3 — Calibration commit for the windows list (Round 6 Q2)

**DECISION:** REJECTED in part. Accepted:
- remove `S5/short`;
- keep `S3/short → 37`, `S3/hung → 16`, `S4/short → 17`, `S7/short → 34`, `S2/short → 58` and `S1/burst4|burst16|burst32|bigbody → 19`;
- add `S1/burst1 → 20` under the ticket-60 median rule;
- `S1/short` gets no entry, because Q1 answers its owner question and it is GREEN on the WS gate.

**Rejected: `S1/stalled → 19`.** Ticket 19 does not own that defect, so the entry would break Round 6 Q2 condition 1 ("never listed under a fix ticket that does not own it"). The facts:
- S1/stalled sends only ~200-byte request bodies, each asking for a ~4 MB streamed answer that is never read before disconnect (`s1-proxy-steady.mjs:68-80, 122`). The in-flight bytes are response bytes.
- Ticket 19 caps request-body bytes, and its own Delivers says "Open response streams are not limited" (Round 1 Q5).
- On Linux the variant is GREEN (HWM 167 MB). On Windows it is RED on both metrics: commit 444/452.3, sampled WS 283.8 MB in run 3, and WS RED in both runs.

So on Q1's gate it still needs an entry, and no existing ticket owns it. My decision:
1. **File a new ticket** (next free number, 61 at the time of writing): "S1/stalled on Windows: proxy peak above 250 MB with stalled streaming readers (Linux HWM 167 MB)", with `Status: needs-triage`, Model sol (streaming), Risk high. It carries both runs' numbers (commit, WS, Linux), and it asks where the buffering toward paused sockets on Windows comes from. List `S1/stalled` under `windows` → that ticket. Any fix that would limit open response streams contradicts Round 1 Q5, and it comes back to the owner before it is built.
2. **The S5/short removal** cites its numbers in the commit message, which meets Round 6 Q2 condition 2:
   - GREEN in runs 3 and 4 with 717/714 samples, the bridge seen, units self-test `ok: true`;
   - procPeak 89–89.8 MB (≤ 150), 0 task failures, reboot cost 4 MB.

   The commit also records that the growth slope is 26.24 / 22.01 %/1k with no trend (run 3: net 7.3 %, 0 rising windows). It is therefore GREEN under spec §18's slope-plus-trend rule only. Ticket 30 records the Windows S5 numbers after its fix. If a later windows run turns S5 RED, Round 6 Q2 condition 3 applies: the scenario comes back as a question, and nobody edits the list again.
3. **S1/burst1 → 20.** The rule is ticket 60's median of n with a per-repetition ceiling of 400 MB, judged on WS on Windows (Q1). Ticket 20 gains these criteria:
   - "In a ≥ 20-repetition measurement on each leg (RSS on Linux, **working set** on Windows), every repetition is ≤ 250 MB" (the Round 6 Q1 condition 4 text, amended by Q1);
   - "**Delete `S1/burst1` (windows).**"

   The sampled WS peak (248.3 MB in run 3) sits just under the budget, and only `PeakWorkingSetSize` puts it over. If the variant then flips GREEN/RED between windows runs, Round 6 Q2 condition 3 applies. The median rule is not stretched to cover it.
4. **The other kept entries stay RED on their owners' checks under Q1.** S7's only remaining RED is `proxy.log` (34), and its proxy peak is GREEN on WS. S3/hung keeps orphans, failed launches and stale locks (16). S3/short keeps the total, the lock and the orphan checks; for those, Q4 adds the edge that lets 37 delete it.
5. **The edits happen in one calibration commit,** with its CI run holding the ratchet on both legs (Round 6 Q2 condition 3). Ticket 02 stays open until that run is green (Round 6 Q2 condition 6).

**Rationale:** The ratchet's value lies in each entry naming the ticket whose fix turns it GREEN. Under 19, the S1/stalled entry would outlive ticket 19's merge, and the "delete your entry" acceptance could never be met. It would also push 19 toward limiting response streams, which Round 1 Q5 rejected. A Windows-only defect that is RED on both metrics and has no owner is exactly the `needs-triage` case. Everything else in the recommendation is backed by the two runs and matches Round 6 Q1/Q2.

**Charter:** C9 (an entry is owned by the ticket that fixes it), C1, C7, Round 1 Q5, Round 6 Q1/Q2.

**REVERSIBILITY:** Two-way door (list entries and ticket text). No ADR.

---

## Q4 — The Windows killed-start orphan

**DECISION:** ACCEPTED with conditions. The defect is confirmed in the code. `start()` writes `proxy.pid` with `startedMs: null` right after the spawn (`zcode-proxy-manager.mjs:632`), and fills it in only if `processStartMs` answers within a 5 s probe of up to 2 × 2.5 s PowerShell calls (`:633-639`). `verifyOwnProcess` then returns `start-unknown` (`:279-284`), and every stop refuses: "start time of pid 3796 is not determinable … refusing to kill" (run 3 S3/hung `cleanup.finalStop`). Windows S3 entries stay listed until the fix lands. "Owned by 16 and 17" leaves the work without a single owner, so these conditions bind:
1. **Ticket 16 owns closing the window.** No live proxy may end up with a pid record that lacks a start time. The ticket chooses the mechanism, for example recording identity before or at spawn, or a proof that needs no external query. **The window is wider than a killed start:** a probe that simply times out (two slow PowerShell calls, no kill at all) leaves the same record behind for good. Both cases are covered. Acceptance moves out of the Comments into Acceptance:
   - on windows-latest, a kill injected at each point between spawn and the complete record, and a forced probe timeout, each end with the proxy stoppable or adopted;
   - S3/hung windows shows 0 orphans before 16 deletes `S3/hung (linux, windows)`.
2. **Ticket 17 owns records that already exist.** Records with no start time, written by old kits on users' machines, are adopted or stopped (C2: old state keeps working). Ticket 17's S4 criterion covers `unstoppable-proxy-after-ctrl-c` on Windows (2 of 8 today).
3. **Never kill on a pid alone (C1, C6, AUD-001).** Without a recorded start time, a stop or adoption needs a proof of equal strength: an authenticated identity answer from the recorded pid, with the listener's owning pid equal to the record, or the per-spawn stop capability once ticket 22 exists. Relaxing `start-unknown` into "kill anyway" is not a fix. A test shows that a reused pid with no record match is never killed.
4. **New edge: ticket 37 is blocked by 17.** Windows S3/short is RED on the orphan, failed-launch and stale-lock checks as well as on the total (run 4: orphans 1, failed launches 1, stale lock 1). It has a single owner, 37, which cannot fix the lock checks. With 17 landed first, 37's "GREEN → delete `S3/short (windows)`" is reachable. The graph stays acyclic (17 ← 16 ← 15; 37 ← 15, 35, 36). PROMPT §0 says wall-clock time does not matter.
5. `cleanup.pidRecordLeft` stays in S3's summary. The calibration commit cites it from run 4's artefact as the direct record of `startedMs: null`. It is only corroboration: the code and the stop text already establish the defect.

**Rationale:** The finding is a C1 failure on the primary platform. The kit starts a proxy it can never stop, and a crash, Ctrl-C or slow PowerShell reaches the same state for real users, not only the adversarial loop. The recommendation is right that the entries stay until the fix lands. But it splits ownership without saying who does what, and it misses the no-kill timeout path. It also leaves ticket 37 holding an entry it can never clear. The conditions give each part one owner and keep the identity-proof safety that Round 1 Q4 kept.

**Charter:** C1 (every child reaped; exactly one proxy, never an unstoppable one), C2 (legacy records), C6 (no kill without proof), C7, C9, Round 1 Q4, Round 5 Q2 (edges where a criterion needs another ticket's output).

**REVERSIBILITY:** Two-way door (ticket text and one edge). The pid-record contract change inside ticket 16 falls under the existing ADR-0003/Round 2 Q10 lock-and-record ADR, as an amendment line, not a new ADR.

---

## Shared understanding

CONFIRMED. No design branch is open. Q1–Q4 are measurement, calibration and ownership rules with exact conditions. These come back as questions with numbers when they occur:
- the Windows S3 total misses 514 MB of commit after ticket 37: build-time gate 2, now with the PowerShell-proof lever named;
- ticket 61 (S1/stalled on Windows) needs a response-side bound, which touches Round 1 Q5;
- a Bun solver child cannot fit its work under the 300 MB commit cap on Windows. The Bun commit floor is ~113 MB at the first sample and ~180 MB at an idle proxy. Ticket 28's windows proof and A1 will show it;
- S5/short or S1/burst1 disagree with the calibrated windows list on a later run (Round 6 Q2 condition 3).
