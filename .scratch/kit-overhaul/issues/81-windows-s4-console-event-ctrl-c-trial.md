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

- 2026-11-09 (implementer, GLM-5.3-Flash max; branch `ticket/81-windows-s4-console-event`, code commit f45504f, integration tip 655fb47 merged — merge-base `--is-ancestor` holds; head = the commit carrying this note).

**Paths touched:** `tests/memory/lib/win-console-event.mjs` (new), `tests/memory/scenarios/s4-lifecycle.mjs`, `tests/memory/job.mjs`, `tests/memory/console-event.test.mjs` (new), `package.json` (test-script wiring only — the repository guard `tests/test-wiring.test.mjs` requires every test file wired; tests only). `git diff 655fb47..f45504f -- lib proxy zcode-proxy-src mcp cli` is empty: no product code (round 33 condition 4). Full suites were not run here — per the dispatch, targeted tests/memory checks only, full suites centrally.

**(a) Delivery.** A spawner helper (`powershell.exe -NoProfile -NonInteractive -OutputFormat Text -ExecutionPolicy Bypass -EncodedCommand …`, `windowsHide: true`, env = the isolated kit's) creates the trial child with `CreateProcessW(…, CREATE_NEW_PROCESS_GROUP = 0x200, NULL environment …)` and prints `__K81__PID <pid>`; the group id is the child's own pid. A sender helper does `FreeConsole()` + `AttachConsole(<child pid>)` and `GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT = 1, <child pid>)`. Group 0 and CTRL_C_EVENT are never minted (guard tests pin the scripts byte-level). The sender shares the child's own console: the helper tree runs on the console Windows gave the hidden helper (CREATE_NO_WINDOW) or the one Windows gives the child itself, which holds only processes this run started. Decision recorded: the trial attaches to the child's console instead of AllocConsole-ing a dedicated one — it satisfies "a console the sender shares" and the B4 ban without depending on AllocConsole in a runner session; every attach/send failure carries its win32 error in the evidence (the 4h path). The proxy itself is spawned `detached: true` (lib/proxy-lifecycle.mjs:1194), so on Windows it sits in its own group without a console and the event reaches only the trial child.

**(b) Footprint and safety.** Both helpers are short-lived powershell.exe children of the scenario: pid-tracked per trial (`helperPids`), reaped at the end of each trial and on every failure path (`reapAll`, `entry.helpersReaped` records what was actually killed); on the one path where the child may outlive its spawner (spawner timeout) the child is ended first, while the spawner's open process handle still pins the pid, then the helper. In-box tooling only: PowerShell 5.1 + `Add-Type` P/Invoke into kernel32, exactly like `lib/win-process.mjs`; no npm dependency, no addon, no binary, no network (guard test). The Windows sampler classifies powershell.exe as role "tooling" (`win-sampler.mjs` TOOLING), so helpers are never a kit role, never in `count:*`, never orphans, never in the commit backstop (proxy-role only).

**(c) Proof of delivery.** Per trial the kit's proxy.log (tail 64 KiB, plus a rotated proxy.log.1 in full) is searched for the child's own `INFO manager start lock released on signal signal=SIGBREAK pid=<child pid> path=…manager.lock` line (format pinned by tests/start-lock.test.mjs:962), with the line's timestamp required to be no older than the trial (bounds pid reuse). Trial 0 is the **self-test** (round 33: "a self-test proves that the event reached the child"): if it cannot prove delivery the run throws there — harness failure (run.mjs exit 2), never GREEN. The judgement (`judgeWindowsTrial`, unit-tested truth table): release line → proven ("release-line"); generated event + child death 0xC000013A without a line → delivered ("event-exit") — the round-33 mutant's signature, so a mutant run shows **stale locks (RED)**, not a harness failure; generated event + child exit 0 at t=0 → harness failure (a start holds its lock for seconds, so on 17's tree — whose only signal listeners are start-lock's, `lib/start-lock.mjs:82,105` — exit 0 can only mean the event never arrived); sender failure or unexplained exits → harness failure. There is **no** child.kill fallback anywhere on windows; later trials whose start completed before the event are recorded with `reason`, never silently re-killed.

**(d) Labels.** Verbatim (unit test): linux "SIGINT (kill)", windows "CTRL_BREAK_EVENT (console event, own process group)". Each `sigintDuringStart` entry carries `method`; the `stale-lock-after-ctrl-c` check's unit prints the label (`0 of 8 (SIGINT (kill))` in the linux runs below); the run prints a per-run delivery line; `job-summary.md` gains an additive "Ctrl-C-during-start trials" section (`job.mjs`, `notes.sigintDelivery`). The check name and budget are unchanged.

**(e) Linux unchanged — evidence (all `run-capped.sh`, isolated HOME, caps, logs in `reports/`):**
- BEFORE (pristine tree 655fb47): `t81-s4-before.log` — S4/short GREEN, `stale-lock-after-ctrl-c 0 of 8`, 8/8 sent, 8/8 childSurvived (adoption), nextStart/nextStop 0, 0 orphans, 247 s.
- AFTER (f45504f): `t81-s4-final.log` — GREEN, `stale-lock-after-ctrl-c 0 of 8 (SIGINT (kill))`, 8/8 delivered, same entry fields plus `trial`/`method`, 246 s. An intermediate run (`t81-s4-after.log`, exit 2) caught a real bug: `sent` was branch-scoped and undefined in the shared entry assembly — fixed before the final run; its harness-failure path (reap of marked survivors, exit 2) worked as designed.

**(c) RED first — NOT RUN locally; pending CI.** It needs a Windows console; this machine is linux (no `~/.fleet/FLEET.md`, no Windows host), so neither the mutant result nor the 0-of-8-on-17's-code result could be produced here, and **the delivery proof did not work locally**. Nothing was faked; the name stays under 81 and the budget is untouched. Exact mutant procedure for the windows-latest leg: on the branch, comment out `"SIGBREAK"` in `lib/start-lock.mjs:82` (the win32 `RELEASE_SIGNALS` array — the only signal-listener site in the manager path), run windows S4/short: each delivered trial shows `proofVia: "event-exit"` (the child died 0xC000013A from the console event, no handler) and `stale-lock-after-ctrl-c` RED with stale locks; restore with `git checkout <sha> -- lib/start-lock.mjs` (never from an uncommitted state). On 17's code the same run shows 0 of 8 stale with per-trial release lines. Both results are to be recorded from CI.

**Pending CI (orchestrator, after merge+push):** (i) windows S4/short GREEN-run evidence with the self-test's release lines per trial (4c); (ii) the mutant run above showing stale locks; (iii) 0 of 8 stale on 17's code; (iv) the 4g removal evidence (windows loop runs + pre-merge CI GREEN with the 4c proof in each). If the hosted runner cannot deliver (no console to share, event never arrives, self-test cannot pass), the trial fails loudly with the exact win32 errors and run evidence in the job log — that output is the 4h evidence for the Owner Proxy round, not a pass.

**(f) Matching counts.** Windows S4/short matching count restarts at this merge; 17's windows `flips` floor counts on this tree or later (METRICS.md records it — merger/orchestrator). Linux S4/short carries on: what it executes is unchanged apart from the additive note and label (before/after evidence above).

**Decisions taken (smallest that satisfy the criteria, per the brief):** (1) AttachConsole to the child's own console instead of a dedicated AllocConsole console (4a rationale above; failures recorded as 4h evidence). (2) The t=0 self-test accepts release-line OR event-exit so the round-33 mutant diagnostic still yields RED stale locks rather than a harness failure (4c's second and third bullets read together). (3) `package.json` test-script wiring for the new unit-test file (required by the wiring guard; tests only). (4) Full suite run centrally per the dispatch, not locally.
