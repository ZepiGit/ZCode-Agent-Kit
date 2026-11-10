# 81: windows S4: deliver a real console control event in the Ctrl-C-during-start trial

**Blocked by:** 17 (Start-lock release on signals, orphan adoption, respawn over a proven-stale lock)

**Status:** ready-for-agent

Model: sol
Risk: medium (Windows console semantics on the hosted runner unproven)
ADR: no

**What to build:** Owner Proxy round 33. The windows S4 trial "Ctrl-C during start" uses `child.kill("SIGINT")`, which Node maps to TerminateProcess: a crash, not a console event, so no kit change can clear windows `S4/short` → `stale-lock-after-ctrl-c` (owned by this ticket, not `flips`). Make the windows trial deliver a real console control event (CTRL_BREAK_EVENT to the trial child's own process group) with proof of delivery, in tests/memory only.

**Acceptance criteria (Owner Proxy round 33 condition 4, verbatim):**

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

**Common acceptance (every ticket):** as in every ticket file.

## Comments

### 2026-11-10 — blocked pre-merge gate, no merge performed

PR76/run42691497644 at headfaaf2ef8ec4b857f5b8b38c60b23122ab3a122ec is FAILURE7/8, not the earlier claimed8/8. Windows memory job129412090016 failed S4/short trial0 with '__K81__CREATEFAIL 123' (CreateProcessW), no child created; harness failure is never expected. Fresh merger verified head/run and stopped without merging; integration remained clean4f21396. Keep original per-trial handler-line delivery proof, Linux behavior and expected-RED owner unchanged. Ticket81(h) requires the hosted-runner failure to return for decision/repair evidence; no fallback child.kill or acceptance exemption. Event-death0xC000013A may be useful mutant evidence but does not substitute for the ordinary run's child-handler proof.
