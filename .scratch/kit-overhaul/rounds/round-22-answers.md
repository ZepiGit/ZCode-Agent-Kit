# Owner Proxy round 22 — answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–21 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only; scratch copies outside the worktree):
- Run 42457112513 (staging/19, head b3e8fe7, tree on 67's schema): job list through `gh run view --json jobs`. Only `memory-budget (ubuntu-latest)` (job 128658388839) failed. Both test-kit legs, both ux-before jobs and the windows memory job passed. The linux job log came through `gh api …/actions/jobs/128658388839/logs` (`/home/AgentKit/overhaul-tools/ci-art/r22-job-linux-mb.log`, lines 440–480 and 600–630).
- Its `memory-budget-linux` artefact, in `/home/AgentKit/overhaul-tools/ci-art/r22-42457112513-5sdK/`. I read every field of `S3-short/S3-short-2026-11-08T0719-11b141/summary.json` (`checks`, `orphans`, `notes.rounds`, `notes.afterKillHolder`, `notes.cleanup`), plus the S3/hung and S3/omp summaries.
- The `memory-budget-linux` artefacts of the 10 earlier staging/19 runs (42446103818 … 42446746036, tree 6f25f13), in `/home/AgentKit/overhaul-tools/ci-art/r22-s19runs-h9ae/`. From each I took the S3 summaries' orphans, RED sets, kill-holder round fields and final stop code.
- `/home/AgentKit/overhaul-tools/ci-art/t67-logs/parsed.json` (62 linux and 46 windows archived runs up to 42429164758). For every run with linux S3/short or S3/hung `orphans` RED I checked the log lines. METRICS.md lines 333–402: the matching rule, the 13-tree restart and the S3 tables before and on the 13 tree.
- DECISIONS.md Rounds 15, 16, 17, 18 and 21 in full. Issues 16, 17, 19 and 37, plus INDEX rows 16, 17, 19 and 37.
- `tests/memory/expected-red.json` on the integration tip 76edd8a and on b3e8fe7. `tests/memory/verdict.test.mjs:1007-1045` on b3e8fe7 (the real-list test). `tests/memory/scenarios/s3-concurrency.mjs:84-95, 222-244` (the kill-holder adversary). `proxy/zcode-proxy-manager.mjs:610-639, 746`.
- Ticket 19's diff: `git diff --stat e056af6 b3e8fe7`, 15 files: the 19 issue file, `lib/proxy-env.mjs` (one name added to the env exception list), both `config.example.yaml`, `tests/proxy-env.test.mjs`, `tests/memory/expected-red.json`, and `zcode-proxy-src/src/{async/handler.ts, config/*, proxy/handler.ts, server/admission*.ts, server/server.ts}`. Between 6f25f13 and b3e8fe7 only 67's ratchet, list, `job.mjs` and test files changed, plus ADR text.

Statistics, recomputed (python, exact binomial, Clopper–Pearson 95 %):
- Linux S3/short `orphans`, matching CI runs on S3's current executed code (13 tree onward: 2 + 8 staging/67, 10 staging/19 on 6f25f13, 1 on b3e8fe7): **1 of 21** = 4.8 % (0.12–23.8 %). Every run with 65's scenario: **1 of 29** = 3.4 % (0.09–17.8 %). Every linux run on record (62 archived + 8 + 10 + 1): **4 of 81** = 4.9 % (1.4–12.2 %): 42246379763, 42281646419, 42415959288, 42457112513.
- Linux S3/hung `orphans`: **0 of 29** on runs with 65's scenario (upper bound 11.9 %). 2 of 81 overall, both before 65: 42228536094 and 42281731448.
- Each of the 6 linux S3 `orphans` REDs on record (4 S3/short, 2 S3/hung) came with `exactly-one-proxy-after-round` RED in the same entry. The converse does not hold: 4 runs had that check RED with no orphan.
- Under the pooled 4/81 rate, P(≥ 1 orphan RED in 11 runs on 19's trees) = 0.43. Nothing points to an effect of 19.
- A name RED at p = 3.4–4.8 % stays GREEN in 10 consecutive runs with P = 0.70–0.61, even with no fix at all.

**Corrections to the round's facts.**
1. **The orphan is the proxy spawned by the killed lock holder, left with no pid record.** That is the spawn → record-write window in 16's and 17's 2026-11-06 Linux Comments. Evidence from `summary.json`:
   - `orphans: [{ pid: 4080, role: "proxy", cmd: "bin/bun run src/index.ts serve" }]`;
   - in kill-holder-10 the adversary killed holder 4001 after 229 ms, with `proxiesAtKill: 0` (the scan before the kill) and `pidRecordAfterKill: null`;
   - the holder's launch (`preflight#0`) ended `code=null` after its last line "starting zcode-proxy ...", which the manager logs just before `spawn()` (`zcode-proxy-manager.mjs:610`). It writes the record afterwards (`:632`);
   - the other 9 launches failed `code=4 cause=startup`. The round ended with 1 proxy and `pidFileMatchesListener: false`;
   - the round's stop was refused on the dead holder's stale lock (exit 4), and the final cleanup stop was refused with "proxy healthy but no pid file — refusing to guess" (exit 4, `zcode-proxy-manager.mjs:746`). The proxy outlived the scenario.

   In all 10 earlier staging/19 runs the kill-holder round also left a stale lock and a refused round stop. There `pidFileMatchesListener` was `true`, so the final stop succeeded (exit 0) and there was no orphan. That pid record is the only difference.
2. **"1 of the runs on this tree" is 1 of 1 on b3e8fe7, 1 of 11 on 19's trees, and 1 of 21 on S3's matching code.** S3's matching rule (METRICS.md: scenario, `verdict.mjs`, `budgets.mjs`, lifecycle/manager/launcher/preflight/bridge paths) does not include 19's proxy request path or 67's ratchet and list. So the 10 + 1 staging/19 runs and the 10 13-tree runs judge the same S3 code. "0 of 10 on 13's tree" is correct.
3. **The round's linux S3/short owner list is correct, with one omission.** On the integration tip and on b3e8fe7, linux S3/short is: 16 → failed-launches, stale-lock-after-round, exactly-one-proxy-after-round†; 37 → peak:kit, procPeak:launcher, procPeak:mcp-bridge, procPeak:preflight†, procPeak:proxy†. The windows entry already has `"17": ["orphans"]` with `orphans` in `flips`. This run also has 16's `exactly-one-proxy-after-round` RED ("kill-holder-10: 1 proxies, pid file does not match"), which is the same event as the orphan.
4. **Ticket 19 cannot have produced the orphan.** It changes no file under `proxy/`, no lock, launcher or lifecycle code, not `s3-concurrency.mjs`, not `tests/memory/lib/{verdict,budgets,sampler*}.mjs`, and not the Bun pin. Its only change on the manager's spawn path is one constant name in `proxyEnv`'s exception list, computed before `spawn()`. That cannot move the kill relative to the `spawn()` → `writePidFile()` window. The orphan is a healthy proxy that lacks a record, so nothing in the proxy's own request path made it an orphan.

---

## Q1 — who owns linux S3/short `orphans`?

**DECISION:** ACCEPTED with conditions. Owner **17**, linux `S3/short`, marked `flips`. It is traced to 17's What-to-build ("The next start adopts an orphaned proxy through the identity proof and never spawns a second one … Every child is reaped on stop/restart/crash/update"). 17's Acceptance gains a linux loop line and a deterministic seam proof. Two parts are REJECTED:
- **(i)** "mirroring the windows one" in `S3/hung` is not taken as a list edit. Linux `S3/hung` gets no `orphans` name, because the check was never RED there in 29 runs with 65's scenario. The new acceptance line still requires 0 orphans in both keys.
- **(ii)** the ≥ 10-GREEN-run removal floor is not enough on its own to remove this name. At a 3–5 % rate it passes by chance in 61–70 % of cases, so removal also needs condition 3's seam proof.

The run does **not** count against ticket 19. No new ticket. No new edge: 17 ← 16 exists, 37 ← 17 exists, and 55's guard already covers 17.

**This explicitly contradicts:**
- **Round 15 Q1 condition 4** ("a name is marked only by 67 … A mark is never added later"). As in Round 16 Q1 and Round 18 Q2, the mark is set later. It is set by condition 4's own test: RED in fewer than all matching runs of the leg, 1 of 21, on CI runs only (Round 15 Q2 condition 1).
- **Round 15 Q1 condition 3, row "S3/short | linux"**: 17 joins 16 and 37 as an owner.
- **Round 18 Q2 condition 5**, "No owner list or mark changes after [19's pre-merge run]", for this one name only. Round 18 Q2 condition 4 and Round 15 Q2 condition 4 name this as the return path ("comes back as a question with the run ids"). It is not a fold-in.

It does **not** contradict Round 15 Q1 condition 5 ("no … other ticket edits another owner's names"). The edit is this decision, applied by the orchestrator in a commit of its own, and 19's own commits touch no name of 17. It does **not** contradict Round 16 Q1 condition 2 either: linux `S3/hung` stays unlisted under that condition's own rule (never RED, so no evidence).

Binding conditions:
1. **Owner and trace (Round 15 Q1 conditions 2 and 6).** Claimants:
   - **17** by What-to-build (above);
   - **16** only through its 2026-11-06 Linux Comments line ("Closing the window covers spawn → record write"). That line is a measured finding and assigns nothing (Round 15 Q1 condition 6). 16's Acceptance names `orphans` on no leg since Round 15.

   Even if 16 counted as a claimant, 17 descends from 16 and owns the check. That is the same reasoning as Round 15's windows decision, and it avoids holding 16 on an adoption that only 17 delivers. 17's Comments cite the What-to-build line and run 42457112513 with correction 1's record as the measured link.
2. **The list edit (exact; one commit, only `tests/memory/expected-red.json`, by the orchestrator on staging/19, message naming Owner Proxy round 22).** The linux `S3/short` entry becomes:
   ```json
       "S3/short": {
         "owners": { "16": ["failed-launches", "stale-lock-after-round", "exactly-one-proxy-after-round"], "17": ["orphans"], "37": ["peak:kit", "procPeak:launcher", "procPeak:mcp-bridge", "procPeak:preflight", "procPeak:proxy"] },
         "flips": ["exactly-one-proxy-after-round", "orphans", "procPeak:preflight", "procPeak:proxy"]
       },
   ```
   Nothing else in the file changes. Linux `S3/hung` and the whole windows leg stay unchanged, and so do 19's own S1 edits.

   The real-list test (`verdict.test.mjs:1012-1045`) handles this without edits: for this key it picks `count:proxy` as the unowned extra, and the failure message names owners 16, 17, 37. No test changes.

   The edit restarts no count, because `expected-red.json` is outside every matching rule (Round 16 Q2 condition 1, Round 18 Q2 condition 1). It goes on 19's branch, not on the integration branch, because 19 edits the same file. A separate integration commit would conflict with 19's merge for no gain (C9, smaller blast radius).
3. **17's Acceptance gains (exact text in "Ticket-text changes" below):**
   - a **linux loop line**: 0 orphans after the scenario's stop in `S3/short` and `S3/hung`;
   - a **deterministic seam proof on both legs**: a start whose holder dies between `spawn()` and the pid-record write ends with exactly 1 proxy, adopted or reaped, and 0 orphans.

   **Removing the name needs both:**
   - the seam proof, RED first on today's code;
   - Round 15 Q1 condition 5's ≥ 10 GREEN matching linux CI runs on 17's tree.

   The floor alone cannot show the fix (statistics: P = 0.61–0.70 with no fix). The seam proof turns the 1-in-21 event into a forced one. It follows Round 17 Q1's mutant reasoning: a check with no power against its defect class needs a constructed case.
4. **Attribution watch while tolerated (Round 16 Q1 condition 4's pattern; the ratchet cannot see roles).** For every linux `S3/short` `orphans` RED before 17 merges, the orchestrator records in 17's Comments:
   - the run id;
   - each `orphans[]` entry (pid, role, cmd);
   - the kill-holder round's `pidFileMatchesListener` and `adversary.pidRecordAfterKill`;
   - `cleanup.finalStop.tail`.

   Run 42457112513 is the first record (correction 1). An occurrence comes back as an ownership question with its run id, even though the ratchet passed it, if:
   - the value is > 1;
   - any orphan's role is not `proxy`;
   - or the kill-holder round's pid record matched the listener (not the spawn → record window).
5. **Run 42457112513 does not count against ticket 19.**
   - Its only failure is this RED (correction 4).
   - It stays a valid run for 19's S1 counts (Round 18 Q2 condition 4) and for S3's matching count.
   - It is not rerun. It is replayed: its per-key RED sets, both legs, go through the amended list and 67's ratchet (`t67-scripts/replay.mjs`, Round 16 Q2 condition 2) and must pass. Any other failure in the replay comes back with numbers.
   - The list commit changes 19's tip, so 19 merges only after one CI run on the final tip passes: test-kit checks the list schema and the real-list test, and the memory leg is judged normally. Round 17/21's interim signatures (i)–(v) apply. Any unowned RED in it comes back with run ids, with no list edit in between.
   - This is no rerun-until-green: 42457112513 stands as counted, and its RED is decided here.
6. **Linux `S3/hung` (Rejected part (i)).** No `orphans` name, because it was 0 of 29 on 65's scenario. A linux S3/hung `orphans` RED comes back as a question with its run id and condition 4's record, as Round 16 Q1 condition 2 ruled for a never-RED name. If its record shows the same spawn → record window, the Owner Proxy expects to apply this answer. It is still not applied silently.
7. **Records.**
   - METRICS.md, linux S3/short rows: `17 orphans 0/8 †` before 13, and `17 orphans 1/21 †` on the 13 tree onward (42457112513). Add the 4-of-81 all-run count and the co-occurrence with `exactly-one-proxy-after-round`.
   - Spec §18: no change, since budgets and rules are unchanged.
   - RUNLOG names this round and corrections 1–4.
   - Budgets, `orphans: 0`, every other owner, name and mark are unchanged (§9).

**Rationale:** The artefact settles the mechanism, not only the count. The killed holder logged its spawn line, its proxy came up, the pid record never appeared, and the kit's own stop then refused the healthy, unrecorded proxy. That is exactly the state 17's What-to-build adopts ("never spawns a second one") and its Linux Comments describe ("a healthy proxy on the installation's port with no `proxy.pid` at all"). The same state recurs on linux at about 5 % across 81 runs and every tree, always together with 16's `exactly-one-proxy-after-round`.

Leaving it unowned would block a random 1-in-20 run of every ticket on a question whose answer is already known. Rounds 9, 13, 15 and 16 all refused that kind of random merge block. Listing it with a mark is the mechanism Round 16 Q1 used for the windows twin.

The cost of tolerating it is bounded:
- one name, on one key and leg;
- a role check that sends any non-proxy or out-of-window orphan back;
- a removal that needs a forced reproduction, not luck.

19 changes neither the manager's spawn → record path nor the scenario, and the rate on its trees is what the pooled rate predicts. Counting the run against 19 would hold a finished ticket on a defect two tickets downstream.

**Charter:** C1 (every child reaped and exactly one proxy: the check stays enforced, attributed to the ticket that adopts or reaps, and gains a deterministic proof), C7 (linux brought to the windows ownership; windows unchanged), C9 (stronger measured evidence: the per-round record and 81 runs; smaller blast radius: one name in one entry, one list-only commit, no edge; simpler than a new ticket), C2 (no test change), §9 (no budget touched), Round 7 Q4, Round 15 Q1 conditions 2, 4, 5 and 6, Round 15 Q2 conditions 1 and 4, Round 16 Q1 conditions 2 and 4, Round 16 Q2 conditions 1 and 2, Round 17 Q1 (mutant reasoning) and cross-question condition 2, Round 18 Q2 conditions 4 and 5, Round 21 Q1 condition 6, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (one list name and mark, ticket text, run scheduling). ADR: no.

### Ticket-text changes (exact)

**`issues/17-start-lock-signal-release-and-orphan-adoption.md`**
- Acceptance, new line after "Loop S3 (windows): …":
  `- [ ] Loop S3 (linux, Round 22 Q1): 0 orphans (`orphans`) after the scenario's stop in `S3/short` and `S3/hung`, including after a kill-holder round whose holder died between spawning the proxy and writing `proxy.pid` (run 42457112513: orphan pid 4080, role proxy, final stop "proxy healthy but no pid file"). **Remove 17's name (`orphans`) from the linux `S3/short` entry in `expected-red.json`** only with both the seam proof below (RED first on today's code) and Round 15 Q1 condition 5's evidence for a `flips` name (≥ 10 GREEN matching linux CI runs on 17's tree).`
- Acceptance, new line after the first "Seam 2 …" line:
  `- [ ] Seam 2, ubuntu and windows-latest (Round 22 Q1): a start whose lock holder is killed after `spawn()` and before the pid record is written (kill injected deterministically at that point, not by timing) leaves a healthy proxy with no `proxy.pid`; the next start adopts it through the identity proof (never on a port or pid alone) or `stop` reaps it; the test ends with exactly 1 proxy, 0 orphans and no second proxy spawned.`
- Comments gains:
  `- 2026-11-08 (orchestrator, Owner Proxy round 22 Q1): linux S3/short `orphans` is owned by 17 and marked flips in expected-red.json (1 of 21 matching linux CI runs on the 13 tree onward, 42457112513; 4 of 81 linux runs on record, each with exactly-one-proxy-after-round RED). Mechanism: kill-holder holder 4001 killed at 229 ms after logging "starting zcode-proxy ..." and spawning proxy 4080, before writing proxy.pid (pidRecordAfterKill null, pidFileMatchesListener false); the round stop was refused on the stale lock (exit 4), the final stop with "proxy healthy but no pid file" (exit 4). Linux S3/hung `orphans` is not listed (0 of 29); a RED there comes back. Attribution watch (Round 22 Q1 condition 4): for every linux S3/short orphans RED before 17 merges, record run id, orphans[] (pid, role, cmd), the kill-holder round's pidFileMatchesListener and pidRecordAfterKill, and cleanup.finalStop.tail; a value > 1, a non-proxy role or a matching pid record comes back as an ownership question. First record: 42457112513 as above.`

**`issues/16-start-lock-protocol-v1-proven-takeover.md`** Comments gains:
`- 2026-11-08 (orchestrator, Owner Proxy round 22 Q1): linux S3/short `orphans` goes to 17 (descendant rule, as windows in Round 15); 16's `exactly-one-proxy-after-round` RED in run 42457112513 is the same event (pid file does not match the listener). If 16 closes the spawn → record window first, 17 removes a GREEN name. 16's own names and Acceptance are unchanged.`

**`issues/19-admission-control-and-503-shed.md`** Comments gains:
`- 2026-11-08 (orchestrator, Owner Proxy round 22 Q1): pre-merge run 42457112513 failed only on linux S3/short RED on orphans (unowned). The orphan is the kill-holder proxy left without a pid record; 19's diff touches no manager, lock, launcher, lifecycle or S3 scenario code. The name is assigned to 17 (flips) in a list-only orchestrator commit on staging/19; the run does not count against 19, is replayed through the amended list, and its S1 and S3 counts stand. 19 merges after one passing CI run on its final tip.`

**`issues/37-…`, INDEX.md:** no change. 37's "Delete `S3/short` (linux)" is covered by Round 15 Q1 condition 5 (the commit that removes the last name deletes the entry). 37 is blocked by 17, so it never waits on a name 17 has not yet removed out of order.

---

## Shared understanding

Open branches I still see (none blocks 19):
- **16's and 17's low-rate `flips` names share the power problem in condition 3.** For example, linux S3/short `exactly-one-proxy-after-round` is 1 of 21, and linux S3/hung `start-over-stale-lock` is 0 of 29. Ten GREEN runs prove little for them. 16's Acceptance already has seam tests for its lock names (kill at every protocol step). If 16 removes a name on the floor alone, that comes back with numbers.
- **The spawn → record window has two possible closers.** 16 could write the identity before or at spawn, or 17 could adopt or reap afterwards. Whichever lands first clears the event. 16's windows seam line covers it only on windows-latest. Whether 16 should also prove the window closed on ubuntu is not decided here. 17's new seam proof covers the outcome on both legs.
- **Linux S3/hung `orphans`** stays unlisted (condition 6). The same kill-holder code runs there, and it was RED twice before 65. A recurrence comes back once, and is then expected to follow this answer.
- **EVIDENCE MISSING: whether 42457112513's windows memory leg recorded any S3 orphan outside 17's known windows mechanism.** It passed the ratchet, but Round 15/16's open item on the windows orphan mechanism remains open.
