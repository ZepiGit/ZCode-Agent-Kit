# Round 33 (2026-11-09): the windows S4 "Ctrl-C" trial is a crash, not a Ctrl-C

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–32 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-33.md`.
- DECISIONS Round 1 Q4 (condition 4) and Q7; Round 15 Q1 in full (conditions 2, 4, 5, 7, 9) with its Shared understanding; Round 16 Q1 (conditions 3–4) and Q3; Round 22 Q1 (as recorded in ticket 17); METRICS.md "Matching code" and the ticket-16 restart line (Round 27 Q1 condition 6).
- Ticket 17 at ea1da62 (`git -C /home/AgentKit/wt/t17 show HEAD:…/issues/17-…md`): Acceptance, every Comments entry, the 2026-11-09 implementer report including "Not met: windows S4 `stale-lock-after-ctrl-c`".
- `tests/memory/scenarios/s4-lifecycle.mjs`: identical on the branch head and the integration tip (`diff` empty). The trial is `spawn(process.execPath, [manager, "start"])` then `child.kill("SIGINT")` once the lock names the child (`:95-100`); `stale-lock-after-ctrl-c` counts `existsSync(lockFile)` after the child exits (`:106`, `:153`, `:166`).
- `tests/memory/expected-red.json` on the branch and the tip: windows `S4/short` owners `17 → proxy-left-after-stop, failed-lifecycle-steps, stale-lock-after-ctrl-c, count:proxy`; `flips` does **not** hold `stale-lock-after-ctrl-c`.
- Spec §18 PROCESSES, second bullet: "0 stale locks after a race round or after Ctrl-C during start (baseline 5 of 8)".
- OWNER-ACTIONS.md OA-2 (tip) and OA-3 (branch). Ticket 42 Comments, round 2: "Ctrl-C in the plain path on a Windows console … there is no automated proof of it on Windows, so it stays an owner check."
- Archived windows S4/short summaries from 16's CI: `merge-16-ci/art-win/S4-short/…T2140…/summary.json` and `merge-16-ci/art/windows/S4-short/…T0215…/summary.json`.
- Primary sources: Node.js `child_process` docs, `subprocess.kill()`: "On Windows … 'SIGKILL', 'SIGTERM', 'SIGINT' and 'SIGQUIT' terminate the process forcefully and abruptly (similar to 'SIGKILL')" (https://nodejs.org/api/child_process.html). Microsoft Learn, `GenerateConsoleCtrlEvent`: CTRL_C_EVENT "cannot be limited to a specific process group"; only processes in the group "that share the same console as the calling process receive the signal"; a zero group id signals "all processes that share the console of the calling process"; "CTRL+BREAK signals always cause the handler functions to be called" (https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent).

**Recomputed facts and corrections to the round.**

1. **Confirmed: the windows trial is a hard kill.** Node's docs state it outright, and the scenario passes no option that changes it. No handler, no `exit` hook and no `finally` runs in the killed holder. So no kit change can make it release its lock, and the windows name cannot go GREEN under this trial.
2. **Confirmed: the crash is already recovered.** In both archived windows S4/short runs on 16's tree, `stale-lock-after-ctrl-c` is the only RED. The stale lock appears in 6 of 8 trials each (the 900 and 1050 ms trials end after the start released its lock normally). In 8 of 8 trials in both runs, `nextStart` = 0, `nextStop` = 0 and `proxiesAfter` = 0. That is 16's proven takeover at work: the lock a crash leaves behind does no harm.
3. **The rate is deterministic, not a flip.** The name is RED in every windows run on record and is not marked `flips`. So under Round 15 Q1 condition 5, its removal needs the owner's recorded loop runs plus a pre-merge CI run GREEN on windows, not the ≥ 10-run floor.
4. **The round leaves the interim label's owner unstated.** "The trial is labelled in the summary" until the follow-up merges would need a code change somewhere. On 17's branch that would void the pre-merge run in flight (staging/17r 2492c11). Condition 5 settles this.
5. **Not in the round, but needed:**
   - 17's Acceptance still says "Delete `S4/short` (linux, windows)". Round 15 Q1 condition 7 and Round 16 Q1 condition 3 both kept that line ("stays"). This round amends its windows half.
   - Ticket 55's blocked-by list must cover every owner (Round 15 Q1 condition 9), so a new owner needs a new edge.
   - A follow-up that edits `s4-lifecycle.mjs` restarts the windows S4/short matching count. That count is also 17's floor for its windows `flips` names (METRICS.md, ticket-16 restart line).
6. **CTRL_BREAK is not CTRL_C.** A process created with CREATE_NEW_PROCESS_GROUP has Ctrl-C disabled, and CTRL_C_EVENT cannot be aimed at a group. So the only console event CI can deliver to just the trial's child is Ctrl-Break. 17 handles SIGBREAK through the same release path as SIGINT (17's report; windows-latest seam tests for SIGINT/SIGBREAK/SIGHUP emission). A real Ctrl-C and a real console close stay with OA-3.

---

## Q1 — how is windows S4 `stale-lock-after-ctrl-c` judged?

**DECISION:** ACCEPTED with conditions. The check keeps its purpose and its budget: 0 stale locks after a user's interrupt during start, baseline 5 of 8. It is **never** re-judged as a crash. A follow-up memory-loop ticket (next free id, "N" below; 81 at this writing) makes the windows trial deliver a real console control event: CTRL_BREAK_EVENT to a process group rooted at the trial's own `proxy start` child. A self-test proves that the event reached the child's handler. The name moves from 17 to N in the open. 17 merges with the name listed and its other windows criteria met in its pre-merge run.

One ambiguity in the recommendation is resolved, not rejected: until N merges, the "TerminateProcess (crash), not a console event" label lives in the records. N's code carries the label for every trial from then on (conditions 4d and 5).

**This explicitly amends** the windows half of 17's "Delete `S4/short` (linux, windows)", which Round 15 Q1 condition 7 and Round 16 Q1 condition 3 kept. Linux is unchanged. Nothing else is contradicted. Round 15 Q1 condition 5 is applied, not bypassed: a name its owner's fix should clear stayed RED and came back with numbers (17's report), and the Owner Proxy decides its new owner here (Round 16 Q3: nothing is re-pointed silently).

Binding conditions:

1. **What the name measures (§18 PROCESSES, unchanged).**
   - Windows `stale-lock-after-ctrl-c` judges "0 stale locks after an interrupt during start" with budget 0 (`PROCESSES.staleLocks`) and baseline 5 of 8.
   - No one reinterprets the windows TerminateProcess result as passing, lowers the budget, or turns the name into a crash check.
   - Crash-of-holder recovery on windows is already judged elsewhere, and no new crash name is added:
     - S3's kill-holder round (16's names);
     - `respawn-recovers-despite-stale-lock`;
     - `unstoppable-proxy-after-ctrl-c` over the S4 trials;
     - 16's takeover proofs.
2. **Ticket 17 merges as follows.**
   - It needs no code change for this question. Its pre-merge run (2492c11) must show windows S4/short RED on `stale-lock-after-ctrl-c` and on no other name, and every other windows criterion met as 17's report lists them. Any other windows S4 RED comes back with values (Round 15 Q1 condition 5).
   - 17's merge check records the name's status as "moves to N (Round 33); not clearable under a TerminateProcess trial".
   - 17 keeps every other windows S4 name it owns: `proxy-left-after-stop`, `failed-lifecycle-steps` and `count:proxy`, all `flips` with the ≥ 10-run floor (Round 16 Q1 unchanged).
   - 17's windows obligation for a real interrupt is its windows-latest seam tests (SIGINT/SIGBREAK/SIGHUP releasing the lock with exit 0xC000013A) plus OA-3, which is marked unverified.
3. **The ownership move (in the open, one change).**
   - After 17 merges, the orchestrator commit that publishes N's issue file also moves `stale-lock-after-ctrl-c` from owner 17 to owner N in windows `S4/short` of `expected-red.json`, with a Comments line naming this round in both tickets. The name is not marked `flips`.
   - The same commit replays the latest windows `job-summary.json` through the edited list, and the replay must hold.
   - Edges: N is blocked by 17, because the event only releases the lock with 17's SIGBREAK listener. 55 gains "blocked by N" (Round 15 Q1 condition 9).
   - Until that commit, the name stays under 17. Nobody edits it otherwise.
4. **N's scope: `tests/memory` only, no product code.**
   - **(a) Delivery.**
     - The windows trial starts the `proxy start` child with CREATE_NEW_PROCESS_GROUP on a console the sender shares. It then sends `GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, <child pid>)` when the lock names the child, using the same timing schedule as today (`(t % 8) × 150 ms`, 8 trials, 20 on long).
     - A zero group id, and CTRL_C_EVENT on a shared console, are forbidden. Either would signal processes this run did not start, including the runner's own (B4).
     - If a dedicated console is needed, the helper creates it only for itself and the trial child.
   - **(b) Footprint and safety.**
     - Only in-box tooling may be used (Node, PowerShell `Add-Type`, or equivalent). No npm dependency, no native addon and no checked-in binary (C4, C6). It opens no network endpoint.
     - The helper is tracked by pid and reaped at the end of each trial and on every failure path, under the job's existing caps (B4, C1).
     - The helper is a harness process. It is never counted as a kit role, in `count:*`, orphans or footprint.
   - **(c) Proof of delivery (power check, every run).**
     - Each trial in which the child held the lock at delivery must show the child's own `INFO manager start lock released on signal signal=SIGBREAK …` event line. The trial records the delivered method and that proof per trial in `sigintDuringStart`.
     - A trial whose delivery cannot be proven is a **harness failure** (the job fails). It is never GREEN, and it never falls back silently to `child.kill`.
     - RED first: with 17's SIGBREAK listener removed (a mutant, restored afterwards), the windows trial shows stale locks. On 17's code it shows 0 of 8. Both results are recorded.
   - **(d) Labels.**
     - The S4 report and job summary print the event each trial delivered: linux "SIGINT (kill)", windows "CTRL_BREAK_EVENT (console event, own process group)". The label is additive.
     - The check name stays `stale-lock-after-ctrl-c`. Renaming it would trigger the stale-name rule and break the run history. The label makes plain that CI delivers Ctrl-Break, not Ctrl-C.
   - **(e) Linux.** The linux trial's behaviour is unchanged.
   - **(f) Matching runs.**
     - N's merge restarts the windows S4/short matching count on N's tree, and 17's windows `flips` floor counts on that tree or a later one (Round 27 Q1 condition 6 precedent).
     - Linux S4/short carries on only if what it executes is unchanged apart from the additive note and label. METRICS.md records which applies.
   - **(g) Removal.** Round 15 Q1 condition 5 applies to a name RED in every matching run. N removes the name with its recorded windows loop runs (CI runs on its branch when no local windows leg exists) plus its pre-merge CI run GREEN on windows S4/short, with the proof of condition 4c present in each.
   - **(h) If it cannot be done on the hosted runner.** This covers no console to share, an event that never arrives, or a self-test that cannot pass. N then comes back to an Owner Proxy round with that evidence. The name stays under N, and no one deletes it, re-labels it as a crash or loosens the budget.
5. **Interim label (records, no code).**
   - Until N merges, 17's Comments, METRICS.md (windows S4/short rows) and RUNLOG carry: "windows S4 `stale-lock-after-ctrl-c` = `child.kill("SIGINT")` = TerminateProcess (crash), not a console event; on 16's tree 6/8 stale in both archived runs, with next start 0, next stop 0 and 0 proxies in 8/8".
   - The orchestrator and the Owner Proxy read these records. Re-running 17's pre-merge CI only to print the label would buy nothing.
6. **Spec record.** §18 PROCESSES, second bullet, gains a measurement-rule amendment (Round 33): on windows, the Ctrl-C-during-start trial delivers CTRL_BREAK_EVENT to the trial child's own process group, with proof of delivery. Until ticket N merges, the windows value is a TerminateProcess result and is owned, not judged as a pass. The budget and the baseline are unchanged.

**Rationale:** On the primary platform, the trial as written measures something else than its name says. Every windows result so far is the effect of a hard kill, and Node's documentation leaves no doubt about that. Judging the name against a crash would quietly retire "0 stale locks after Ctrl-C" on Windows, which is the platform where users actually press Ctrl-C in conhost and PowerShell, and would leave only a manual owner action (OA-3) as evidence. That fails C7, and it amounts to loosening a §18 budget by reinterpretation.

Doing nothing fails too. The name could never leave the list, so 55's empty-list goal would be blocked forever.

The real-event trial is the smallest change that measures the right thing. It is test-only, uses in-box Windows APIs and the existing scenario, and keeps the same name and budget. Ctrl-Break to the child's own process group is the only console event the documented API can aim at just that child. Aiming more widely (CTRL_C_EVENT or group 0) would hit processes the run never started, which B4 forbids.

Delivery on a hosted runner is unproven (ticket 42 found no automated Windows console proof). So the decision ties the trial to a per-run proof of delivery and makes a failed delivery a harness failure, never a silent fallback to the crash path. It also routes "infeasible" back with evidence instead of letting it become a deletion.

The crash path keeps its own coverage (S3 kill-holder, respawn over a stale lock, and the trials' next-start/next-stop data, which recovered in 8 of 8 trials in both runs). So it needs no new name.

17 has done what its code can do: linux 5/8 → 0/8 in 9 of 9 runs, and the seam tests cover the windows console events. Holding 17 back on a measurement it cannot influence would stall the C1 fixes it delivers, and the descendant-ownership logic of Round 15 Q1 condition 2 favours N, which needs 17 first.

**Charter:** C1 (the stale-lock and single-proxy checks stay enforced; the harness helper is reaped and bounded), C7 (the primary platform gets a real interrupt measurement in CI instead of a crash under the interrupt's name; linux unchanged), C4 (in-box tooling only, no new dependency), C6 (no new endpoint; no binary or secret), C9 (stronger evidence: a measured, proven delivery beats a reinterpreted crash; smaller blast radius: one test-only ticket and one list move; "do nothing" rejected because the name could never clear), §9 (budget 0 and baseline 5 of 8 unchanged), B4 (no zero-group or CTRL_C broadcast), PROMPT §7 Phase 4 (no re-run until green; infeasibility comes back with evidence), Round 1 Q4 condition 4, Round 1 Q7 (A2), Round 15 Q1 conditions 2, 4, 5, 7 (amended for windows) and 9, Round 16 Q1 conditions 3 (amended for windows) and 4, Round 16 Q3, Round 27 Q1 condition 6.

**REVERSIBILITY:** Two-way door. The changes are test-harness code under `tests/memory`, a list ownership move, ticket text and records. No product code, contract or budget changes. ADR: no.

### Exact text changes

**`issues/17-start-lock-signal-release-and-orphan-adoption.md`**, Acceptance:
- "Loop S4: 0 stale locks after Ctrl-C during start (baseline 5/8); respawn with a stale lock → proxy up; 50 cycles → 0 orphans, log-dir files ≤ 8. **Delete `S4/short` (linux, windows).**" becomes:
  > - [ ] Loop S4: 0 stale locks after Ctrl-C during start (baseline 5/8) on linux; respawn with a stale lock → proxy up; 50 cycles → 0 orphans, log-dir files ≤ 8. **Delete `S4/short` (linux).** Windows: remove 17's names from `S4/short` with Round 15 Q1 condition 5's evidence, except `stale-lock-after-ctrl-c`, whose windows trial is a TerminateProcess (crash) and moves to ticket N (Owner Proxy round 33). 17's windows obligation for a real interrupt is the windows-latest seam tests (SIGINT, SIGBREAK, SIGHUP release, exit 0xC000013A) and OA-3 (unverified).

Comments:
```
- 2026-11-09 (orchestrator, Owner Proxy round 33, binding): windows S4 `stale-lock-after-ctrl-c` is measured by `child.kill("SIGINT")`, which Node maps to TerminateProcess on Windows: a crash, not a console event. No kit change can clear it. On 16's tree: 6/8 stale in both archived windows runs, with next start 0, next stop 0 and 0 proxies in 8/8. 17 merges with the name listed. Its pre-merge run must show windows S4/short RED on this name only, and any other windows S4 RED comes back with values. The name moves to ticket N (windows console-event trial) in the commit that publishes N, after 17 merges. Merge check status: "moves to N (Round 33)". "Delete S4/short" is amended to linux only; on windows 17 removes its own other names under Round 15 Q1 condition 5.
```

**New issue `issues/N-windows-s4-console-event-ctrl-c-trial.md`** (title: "windows S4: deliver a real console control event in the Ctrl-C-during-start trial"). Blocked by: 17. Model: sol. Risk: medium (Windows console semantics on the hosted runner unproven). Status: ready-for-agent. Acceptance = condition 4 (a)–(h) verbatim, plus the common acceptance. Owns windows `S4/short` → `stale-lock-after-ctrl-c` (not `flips`).

**`expected-red.json`** (in N's publishing commit, after 17 merges): windows `S4/short` owners: remove `stale-lock-after-ctrl-c` from `"17"` and add `"N": ["stale-lock-after-ctrl-c"]`. Replay the latest windows `job-summary.json` through the edited list, which must hold.

**`issues/55-…md` and `issues/INDEX.md`:** 55's blocked-by list gains N. Add an INDEX row for N.

**Spec §18 PROCESSES**, second bullet: append condition 6's measurement-rule amendment.

**METRICS.md / RUNLOG:** the interim label of condition 5; for N, the matching-count restart record of condition 4f.

---

## Shared understanding

Open branches I still see:
1. **Delivery on the hosted windows runner is unproven.** Does the job's process have a console the trial child can share, or can the helper create one, and does CTRL_BREAK_EVENT reach a Node child there? N's self-test answers this. If it cannot pass, N comes back with evidence (condition 4h), and the name stays listed under N.
2. **CI measures Ctrl-Break, not Ctrl-C or console close.** Those two real events stay with OA-3 and the emission-based seam tests. If OA-3 ever fails while CI is GREEN, that is a product finding for 17's release path, not a measurement change.
3. **17's pre-merge run (2492c11) is still running.** A windows S4 RED on any name other than `stale-lock-after-ctrl-c`, or a linux S4 RED on any name, comes back with values.
4. **N's merge restarts the windows S4/short matching count**, and with it 17's windows `flips` floor (`proxy-left-after-stop`, `failed-lifecycle-steps`, `count:proxy`). That costs time but not correctness. METRICS.md records the restart point.
