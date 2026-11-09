# 30: MCP task retention (500 / 7 days) and the idempotency window

**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24)

**Status:** resolved

Model: sol

Risk: high

ADR: 0009

**What to build:** Terminal tasks are evicted at > 500 or > 7 days, whichever first; running tasks never; `*.result.json` pruned with the task; startup restore loads only retained tasks; the idempotency key is forgotten on eviction; an evicted task gives the existing not-found error. The tool description carries the idempotency sentence.

**Acceptance criteria:**

- [ ] Seam 7 (MCP client + fake harness): eviction by count and age with an injected clock, non-terminal kept, files pruned, restore loads only retained, not-found and new-task-on-reused-key after eviction.
- [ ] Loop S5/long (3,000 tasks): GREEN on every check (growth ≤ 5 %/1k, procPeak ≤ 150 MB, reboot cost of history ≤ 20 MB, 0 task failures), tip RED → branch GREEN recorded.
- [ ] Loop S5/short (Round 26 Q1; replaces Round 24 Q1 condition 1's single restage): judged on the 10 pre-registered evidence runs per leg of the joint staging tree (integration tip, then 30, then 74) on `warm-up-growth:mcp-bridge` (today's quantity: load window cut at task 400, default 25 % warm-up): every windows value 5 < v ≤ 30 %/1k commit, every linux value ≤ 55 %/1k, every other S5 check GREEN in every run (procPeak ≤ 150 MB, WS on windows; reboot cost ≤ 20 MB; 0 task failures; 0 orphans); and Round 25 Q1 condition 4's 20-value set complete with no trigger. Signature (vi) never applies. If 74 is not staged (its mutant proof failed), the 10 runs are taken on this ticket's own staging tree on the band value (the same quantity). A value above 30 or any other S5 RED comes back with all values; nothing is rerun. Both S5/short entries stay re-owned to ticket 74, which holds their only exit (Round 24 Q1).
- [ ] Retention migration replayed twice.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 66, 67, 68, 135

## Comments

- 2026-11-07 (orchestrator, Owner Proxy round 13, binding): windows `S5/short → 30` is listed as unstable (growth:mcp-bridge commit value 5 < v ≤ 30 %/1k; ticket 66 builds it). This ticket's only exit: every one of ≥ 10 fresh windows S5/short runs on its tree shows growth:mcp-bridge ≤ 5 %/1k regardless of the trend flag, via an off-by-default measurement mode; the same commit deletes the windows entry and removes S5/short from the unstable allow-list. EVIDENCE MISSING (round 13): attribution of the bridge growth (JS heap vs native/allocator vs V8 semi-space); S5/short runs 400 tasks while this ticket's eviction starts above 500, and the measured per-task heap (~1.6 MB total) is far below the 5-12 MB climb, so this ticket may not clear either leg; ticket 36 (semi-space flag) may be the real fix. Attribute first.
- 2026-11-08 (orchestrator, Owner Proxy round 17): Q2 — ticket 67 marks `growth:mcp-bridge` as `flips` in linux `S5/short` (owner 30), because the name was GREEN in 1 of 10 runs on the 13 tree (42436186573, 39.53 %/1k, trend false). Added the linux value-based exit to Acceptance: ≥ 10 fresh matching linux runs, every one with `growth:mcp-bridge` ≤ 5 %/1k regardless of the trend flag, and every other S5 check GREEN. Windows `S5/short` stays `unstable` and keeps the Round 13 exit above. The 5 %/1k budget, `growth()`, `MEMORY.growth`, the windows band and the other S5 checks are unchanged. **Wrong-owner watch (Q2 condition 3):** for every linux S5/short run that is GREEN before 30 merges, the orchestrator records here the run id, the `growth:mcp-bridge` value and the window medians. Any value ≤ 5 %/1k before 30's fix lands (for example after 36's semi-space flag) comes back as an ownership question with the run id. The first such run is 42436186573 (39.53 %/1k, trend false, every other S5 check GREEN, peak 102.6 MB); its window medians are not in the round text and are still to be recorded. **Interim signature (iv) (cross-question condition 2):** until 67 merges, a staged or post-merge run whose only failure is linux S5/short "GREEN but listed" with `growth:mcp-bridge` > 5 %/1k and every other S5 check GREEN does not count against the ticket, does not block its merge and causes no revert, unless the ticket's diff touches `mcp/**`, `s5-mcp.mjs`, `tests/memory/lib/{verdict,budgets,sampler*}.mjs` or the Bun pin. Each occurrence is recorded here with the run id and values.

- 2026-11-08 (implementer, branch `ticket/30-mcp-task-retention`; code c8c9243 + 0a059ad, integration tip f322df8 merged at 450aee2, clean). Linux x64, Node 26.7.0 (Node 24.22.2 spot check), Bun 1.4.2. Ticket 36 has not landed (`ticket/36-mcp-bridge-lazy-http` is not an ancestor of the tip), so nothing of it is merged here.

  **Attribution first (Round 13).** Tool: a preload in the bridge (`/home/AgentKit/overhaul-tools/t30-scripts/memprobe.mjs`). Each second it samples RSS, the V8 heap spaces, V8 malloc, external memory and `/proc/self/smaps_rollup`. On command it runs a full GC, dumps `/proc/self/smaps` or writes a heap snapshot. The driver (`driver.mjs`) runs the S5 workload: 400 tasks, a 16 KB prompt every 10th task, `tasks_list` every 25th. Slopes are in MB per 1,000 tasks, over tasks 100–400, from `analyze.mjs`; the smaps split is from `smapsdiff.py`. Data: `/home/AgentKit/overhaul-tools/t30-attrib/<run>/`. The probe's own load lowers the slope a little against the job (25 vs 33–42 MB/1k), but the arms are compared to each other.

  | arm (400 tasks unless noted) | RSS slope | heapTotal slope | what it tests |
  |---|---|---|---|
  | full / full2 / branch500 (no eviction below 500) | 26.1 / 25.2 / 23.4 | 14.7 / 15.7 / 14.6 | baseline |
  | MALLOC_ARENA_MAX=1 | 24.5 | 16.7 | glibc thread arenas: refuted |
  | `--v8-pool-size=1` (+ arena 1: 26.7) | 26.4 | 18.8 | V8 worker threads, background JIT: refuted |
  | no `tasks_list` | 26.6 | 23.8 | big list responses: refuted |
  | "lean": no O(n) list copy, sort or ingress resync per task | 30.0 / 30.0 | 19.6 / 17.7 | O(n) garbage per operation: refuted |
  | **retention cap lowered to 50** (scratch build, never committed) | **12.8** (11.4 over tasks 100–500 in the long run) | 9.0 | the retained task set |
  | the same, full GC every 50 tasks | **3.8** | 0.8 | the retained task set, GC noise removed |
  | the 500 cap, full GC every 50 tasks | 29.2 | 18.2 | — |
  | `zcode_health` only, 1,200 calls | 11.7 per 1k loops; the heap after a full GC does not grow | — | SDK/protocol path: warm-up only |

  - **After a full GC (every 50 tasks), from 50 to 350 tasks:**
    - The retained JS heap (`heapUsed` after GC) grows from 16.76 to 18.14 MB, **about 4.6 KB per task**. That is the task records, their Maps/Set/closures and the prompts (40 × 16 KB). This matches the 4 KB of the diagnosis.
    - RSS grows from 84.5 to 93.0 MB, **about 28 KB per retained task**, so about 5× the JS heap.
    - With the cap at 50, the heap is flat (16.98 → 17.19 MB) and so is RSS (86.4 → 87.2 MB).
  - **Where the RSS goes** (`/proc/self/smaps`, after GC, 50 → 400 tasks, +9.1 MB anonymous):
    - 256 KB V8 heap pages: +6.2 MB (69 %), against only +1.75 MB of `heapTotal`;
    - glibc main arena `[heap]`: +1.6 MB (18 %);
    - other anonymous memory: +1.3 MB (14 %).
    - File-backed pages and `external` stay flat.
  - **Attribution.** S5's bridge growth is not V8 young-generation sizing (ticket 36's measurement), not malloc arenas, not V8 worker threads and not per-call garbage. It has two parts:
    1. **About half: the growing retained task set.** Each retained task costs ~4.6 KB of JS heap, which shows up as ~22–28 KB of RSS: V8 old-space pages beyond the live set, plus native malloc. Retention is the right lever for this part. Below 500 tasks it does nothing, because the bound is not reached.
    2. **About half: runtime warm-up that is there even when retention is bounded.** With the cap at 50, the no-GC slope over tasks 100–400/500 is still 11.4–12.8 MB/1k, about 12–14 %/1k against a mean of about 90 MB. It levels off after about 500 tasks (long run, tasks 600–1500: −1.35 MB/1k).
  - **Ceiling of any retention in S5/short.** Even a 50-task bound leaves S5/short at about 12–14 %/1k, above the 5 %/1k budget. To reach the budget in the first 400 tasks, a retained task would need to cost less than ~4 KB of RSS, i.e. ≲ 1 KB of JS heap, and the warm-up would also have to go. Neither is retention.

  **What changed.**
  - `mcp/zcode-harness-mcp/src/tasks/manager.ts`:
    - `TASK_RETENTION = { maxTerminalTasks: 500, maxAgeMs: 7 days }`. Evictable states are completed, failed, cancelled and interrupted. A task is evicted when it is beyond the newest 500 by finish time, or when it finished more than 7 days ago.
    - On eviction the task leaves memory and the idempotency/session indexes, and its files are deleted: `.result.json`, `.events.jsonl`, `.events.jsonl.previous`, then the record last, so an interrupted prune is redone at the next start.
    - Retention is applied when a task turns terminal and on every lookup: get, list, events, wait, result, input, cancel, and the idempotency lookup through `get`. So a bridge whose clock passes 7 days evicts on the next request, without a timer.
    - `restore()` decides retention before it builds the in-memory tasks. It loads only the retained ones and prunes the rest. The existing restore log line gains `evicted` only when something was evicted; otherwise it is byte-identical. There is no new log event, config key or env var.
    - The `TaskManager` constructor takes an optional clock (default `Date.now`).
  - `src/mcp/tools.ts`: the `zcode_task_start` description ends with the ADR-0009 sentence, verbatim.
  - `dist/` is rebuilt with `npm run build` (B5); `git status` is clean after `test:mcp`.
  - Test-only:
    - `test/fixture/clock-offset.mjs` (new): a `--import` preload that shifts `Date` in the bridge process only, by an offset read from a file;
    - `test/fixture/fake-harness.mjs`: an additive `FAKE_HANG_PROMPT` (hangs only turns whose prompt contains it; default off);
    - `test/integration/retention.test.mjs` (new), wired into the bridge's `test` script.

  **Tests, RED → GREEN (seam 7, MCP client + fake harness).** `retention.test.mjs`, 5 tests. All 5 are RED on tip dcc7615 (`reports/t30-red2.log`): 508 tasks restored, seed-0000 still found, no age eviction, the sentence missing. All 5 are GREEN on the branch (`reports/t30-green4.log`). Under Node 24.22.2 the retention, lifecycle-audit and bridge tests pass 63/63 (`reports/t30-node24-retention.log`).
    1. **Restore and retention migration, replayed twice:**
       - 505 recent tasks plus 3 tasks older than 7 days;
       - the restore log reports `{count: 500, evicted: 8}`, `tasks_list` returns exactly seed-0005…0504, and 4 evicted ids give `unknown task: <id>` on get/result/events/wait, with no files left;
       - a retained cached result is served as stored;
       - the second start leaves the SHA-256 listing of all 1,500 files identical.
    2. **Count eviction at run time:**
       - 499 seeded tasks, one hanging task and two live tasks;
       - the 500th terminal task evicts nothing, the 501st evicts seed-0000 (not-found, files gone);
       - the running task is neither counted nor evicted (501 listed);
       - `key-0` starts a new task, while `key-2` still returns seed-0002.
    3. **Age eviction with the injected clock:**
       - at +7 d − 3 min nothing is evicted;
       - at +7 d − 90 s only seed-0000 is (files gone, its key starts a new task), while seed-0001, 30 s short of 7 days, stays;
       - at +30 d every seeded task is gone, and the running task stays with its key.
    4. **Adversarial: a task of unconfirmed outcome and a task cut off by a restart are never evicted:**
       - 501 tasks 8 days old, an `unknown` task 9 days old, and a `running` task with no `finishedAt`;
       - after restore only the unknown and the interrupted task remain, and the unknown task's key still resolves.
       - On shutdown the existing `stopAll` turns `unknown` into `interrupted`, keeping its old finish time, so the next start ages it out. The task cut off by the first restart stays.
    5. The tool description carries the sentence (via `tools/list`).
  - **Mutations** on committed c8c9243, in a detached scratch worktree (`/home/AgentKit/overhaul-tools/t30-mut`, script `t30-scripts/mutate.py`; `reports/t30-mutations{,2}.log`). Each mutant was restored with `git checkout c8c9243 -- <file> dist`, and every restore was clean.
    - **Killed (9 on c8c9243, plus M7 on 0a059ad):**
      - M1 / M1b: the count bound removed (check or victims);
      - M2: the age bound removed;
      - M3: running tasks evictable (the suite hangs, which counts as killed);
      - M4: unknown tasks evictable;
      - M6: files not pruned;
      - M8: lookups skip the retention;
      - M9: newest evicted first;
      - M10: the sentence removed.
    - **Equivalent at the seam (4)**, handled in 0a059ad:
      - M5: the key index entry kept on eviction. Not observable, because a stale key whose task is gone already falls through to a new task. The deletion only keeps the index bounded.
      - M7: restore loads every task. The first lookup evicted them anyway, so 0a059ad pins the restore log count. Rerun on 0a059ad, M7 is killed by test 1 and M5 still survives (`reports/t30-mutations3.log`).
      - M11 / M12: late-write guards and a duplicate retention call. Every async path that persists holds a non-evictable state or looks the task up again, so 0a059ad removes them.

  **Full suite** on 450aee2 (merged tip):
  - `npm run test`: 836 tests, 817 pass, 0 fail, 19 skipped;
  - `test:proxy`: 1387 pass, 0 fail (92 files);
  - `test:proxy-typecheck`: clean;
  - `test:mcp`: 102 tests, 101 pass, 0 fail, 1 skipped (+5);
  - logs: `reports/t30-full-{test,proxy,proxy-typecheck,mcp}.log`.

  **Memory loop, Linux.** Frozen trees: tip dcc7615 (detached worktree `/home/AgentKit/overhaul-tools/t30-tip`) and branch 0a059ad. The arms ran side by side. `job.mjs --os linux --only S5/short`, cap 5G; logs `reports/t30-s5-{tip,branch}-{1,2,3}.log`, run dirs `/home/AgentKit/overhaul-tools/t30-memloop/`.

  | run | growth %/1k (trend) | slope MB/1k | mean MB | window medians MB | net rise % | procPeak MB | empty → 400 → reboot MB | failures |
  |---|---|---|---|---|---|---|---|---|
  | tip-1 | 44.53 (true) | 41.51 | 93.2 | 86.3 / 90 / 93.6 / 94.1 / 95.8 / 97 | 12.4 | 100.6 | 86 → 97 → 88 | 0 |
  | tip-2 | 41.18 (true) | 38.39 | 93.2 | 86.6 / 90.8 / 93.2 / 94.4 / 94.3 / 96.8 | 11.8 | 99.7 | 86 → 97 → 89 | 0 |
  | tip-3 | 39.60 (true) | 36.90 | 93.2 | 86.9 / 90.8 / 93.4 / 93.7 / 96.3 / 97.6 | 12.3 | 102.8 | 86 → 92 → 89 | 0 |
  | branch-1 | 35.29 (false) | 32.57 | 92.3 | 86.1 / 90.3 / 92.4 / 93.6 / 95.3 / 93.7 | 8.8 | 99.7 | 86 → 95 → 89 | 0 |
  | branch-2 | 37.62 (true) | 34.84 | 92.6 | 86.6 / 91.2 / 91.8 / 93.8 / 95.3 / 96.1 | 11.0 | 100.3 | 86 → 96 → 89 | 0 |
  | branch-3 | 34.52 (false) | 31.85 | 92.3 | 86.2 / 89.8 / 92.1 / 94.3 / 95.4 / 94.3 | 9.4 | 99.9 | 85 → 94 → 89 | 0 |

  - **S5/short: the retention does not move it, as Round 13 expected.** S5/short has 400 tasks and the bound is 500, so no eviction happens.
    - The branch median is 35.29 against 41.18 on the tip. That gap is 3 local runs per arm and is not a fix: every value is 7× the budget.
    - Two branch runs are GREEN only because the trend flag missed ("a missed trend, not a fix").
    - procPeak, orphans, reboot cost and failures are ok in all 6 runs.
    - `expected-red.json` is untouched. The linux exit (≥ 10 CI runs ≤ 5 %/1k) and the windows exit (Round 13) are **not** met, so the linux `S5/short` entry and the windows `unstable` entry and allow-list key stay. No measurement mode was built for an exit that cannot be met.
  - **S5/long** (`run.mjs S5 --profile long`, 3,000 tasks; `reports/t30-s5long-{tip,branch}.log`): this is where the retention works.

    | arm | outcome | growth %/1k (trend) | slope MB/1k | window medians MB | procPeak MB | empty → 3,000 → reboot MB | data dir |
    |---|---|---|---|---|---|---|---|
    | tip | **RED** | 40.80 (true) | 63.4 | 113 / 120.2 / 127.8 / 136.3 / 215.1 / 224.8 | **238.6** (budget 150) | 86 → 228 → 117 (reboot cost **31**, budget 20) | 14.7 MB, 9,000 files |
    | branch | **GREEN** | **1.11** (false) | 1.16 | 102.4 / 103.1 / 103.4 / 103.6 / 104.7 / 104.8 | 111.4 | 86 → 105 → 90 (reboot cost 4) | 2.5 MB, 1,500 files |

    - Bridge RSS by task bucket (tip / branch): 500: 102.8 / 103.0; 1000: 114.8 / 104.5; 2000: 146.5 / 105.0; 2750: 224.5 / 106.6.
    - The probe runs over 1,500 tasks agree. Tip tasks 600–1500: +16.6 MB/1k, and still rising at 126.8 MB. Branch: +1.5 MB/1k, plateau at 104 MB.
  - **For the Owner Proxy (who owns the rest of S5/short):**
    - The S5/short window measures the first 400 tasks. In that window, ~half of the growth is task history that this ticket's 500-task bound only cuts above 500; the other half is warm-up that a bound does not touch (12–14 %/1k even at a 50-task bound).
    - The bound, the budget and the scenario are unchanged here (no bending).
    - Options the numbers support, none taken here:
      - (a) judge bridge growth after the retention bound, as S5/long does: GREEN on this branch, RED on the tip;
      - (b) give the warm-up part its own measurement rule or owner;
      - (c) a per-task footprint ticket, i.e. serving terminal records from the store instead of memory. It would need to get below ~1 KB of JS heap per task, and would still leave the warm-up.
  - **Windows:** no local leg. Nothing in the change is platform-specific. The windows S5/short value should stay in the band (5, 30] (pending CI).

  **Decisions taken.**
  1. **`unknown` is not evicted.** Its execution could not be confirmed, and every slot, session and workspace guard treats it as active; it is bounded by the task queue limit (50). The existing shutdown path makes it `interrupted`, and from then on it is aged out like any terminal task.
  2. **Age is counted from `finishedAt`** (`createdAt` when it is missing; unreadable times count as oldest), and "older than 7 days" is strict. On a tie, `createdAt` then the task id decide the order.
  3. **Eviction is lazy, with no timer:** on terminal transitions, at restore and on each lookup. An idle bridge does not grow, and the first request after 7 days sees the evicted state.
  4. **No new log event.** The existing restore line gains `evicted` only when something was evicted, because the bridge logs JSON lines on stderr and ticket 14's event-line logger belongs to the proxy and the manager.
  5. **The prune deletes only ids the bridge mints** (`task-[A-Za-z0-9-]+`), plus the record file itself, so a hand-edited record cannot aim it elsewhere.
  6. **Docs:** `docs/MCP_API.md` and the release notes are tickets 31/53 and 54. Here only the tool description carries the sentence (the ticket's text).

  **Pre-existing tests changed (justified).** No assertion changed. The fake harness gained an opt-in env flag, and the bridge `test` script lists the new file (wiring).

  **Pending CI (orchestrator verifies after merge+push):**
  - ubuntu and windows fast suites;
  - ubuntu `memory-budget`: `S5/short` RED or GREEN under `ticket 30` on `growth:mcp-bridge` only, "ratchet holds";
  - windows `memory-budget`: `S5/short: unstable (growth:mcp-bridge x %/1k commit …), owned by ticket 30` with 5 < x ≤ 30;
  - every other job green.
  - Interim signature (iv) does not apply, because this diff touches `mcp/**`.

  **Left for others:**
  - the S5/short ownership question above (Owner Proxy);
  - `docs/MCP_API.md` and the release-notes sentence (31/53/54);
  - ticket 31 builds on this file's `TASK_RETENTION` and the seam 7 tests.

- 2026-11-08 (implementer, addendum): merged the integration tip again at a59f48e (e88821f, ticket 19). The merge is clean and touches neither `mcp/**` nor the S5 entries of `expected-red.json`. Full suite on a59f48e (`reports/t30-final-{test,proxy,proxy-typecheck,mcp}.log`):
  - `npm run test`: 837 tests, 818 pass, 0 fail, 19 skipped;
  - `test:proxy`: 1413 pass, 0 fail (93 files);
  - `test:proxy-typecheck`: clean;
  - `test:mcp`: 102 tests, 101 pass, 0 fail, 1 skipped;
  - `git status` is clean after the build.

- 2026-11-08 (orchestrator, Owner Proxy round 24, binding): merges on retention and S5/long. Staged run 42475847194: windows S5/short 14.5 %/1k commit (WS −4.24, trend false, in band); linux 31.82 %/1k (trend false, flip GREEN; window medians from the run's summary.json to be recorded here, Round 17 Q2 condition 3); all other S5 checks GREEN on both legs. The S5/short entries are re-owned to 74 in this tree, followed by one restaged run. The per-task footprint (~4.6 KB heap / ~28 KB RSS per retained task) is bounded by the 500 bound and gets no ticket (C9).

- 2026-11-08 (implementer, round 2, Owner Proxy round 24).

  **CI values of staged run 42475847194** (staging/30, head 0e99864; 8 of 8 jobs green). The values come from the run's `memory-budget-{linux,windows}` artefacts, `S5-short/*/summary.json`, saved locally under `/home/AgentKit/overhaul-tools/ci-art/t30-42475847194/`.

  | leg | outcome | growth:mcp-bridge %/1k (trend) | slope MB/1k | mean MB | window medians MB | net rise % | rising windows | samples (growth / run) | procPeak MB | empty → 400 → reboot MB | orphans / failures | duration s |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|
  | linux (RSS) | GREEN (flip, listed) | 31.82 (false) | 30.04 | 94.4 | 88.3 / 92.2 / 95.2 / 95 / 97.1 / 95.7 | 8.4 | 0 | 701 / 713 | 101.6 | 87 → 96 → 91 (reboot cost 4) | 0 / 0 | 714 |
  | windows (commit; WS −4.24) | GREEN (unstable, in band) | 14.5 (false) | 11.61 | 80.1 | 77.8 / 79 / 79.9 / 81.1 / 81.2 / 78.9 | 1.4 | 0 | 705 / 716 | 89.3 commit (75.4 WS) | 79 → 79 → 82 (reboot cost 3) | 0 / 0 | 722 |

  - These are the linux window medians that Round 17 Q2 condition 3 asks for (Round 24 correction 5).
  - 31.82 > 5, so no ownership question arises.

  **List and label edit (Round 24 Q1 condition 2),** 0a256f9:
  - `tests/memory/expected-red.json`: linux `"S5/short": { "owners": { "74": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] }`, windows `"S5/short": { "ticket": "74", "state": "unstable" }`. No other entry changed.
  - Label-only test changes (justified by Round 24 Q1 condition 2). Each one reads the committed list:
    - `verdict.test.mjs`, the committed-list test;
    - `loop.test.mjs`, the windows CI replays (pass lines, row ticket, table row, "listed for ticket", "owned by ticket");
    - `loop.test.mjs`, the linux 42436186573 replay (flip line, "not owned by ticket").
  - Also renamed from 30 to 74:
    - the `ratchet.mjs` allow-list comment (exit owner);
    - the `job.mjs` unstable-entries heading ("ticket 74's ≥ 10 runs").
  - Unchanged:
    - the synthetic band tests in `verdict.test.mjs`, which build their own `{ ticket: "30" }` entry and do not read the list;
    - the band, the `UNSTABLE` key and every rule.
  - **Label mutation.** After the commit, both list labels were set back to 30. Four tests fail: the committed-list test, both windows replays and the linux replay (`reports/t30-r2-labelmut.log`). The list was restored with `git checkout 512c559 -- tests/memory/expected-red.json`, and the tree is clean.

  **Merge.** The integration tip 7555b87 is merged at 512c559. It brings the round-24 docs (issue 74 exists, so the ratchet's ticket-id rule holds), ticket 36 (lazy HTTP and the semi-space flag) and tickets 15, 24 and 25.
  - Conflicts resolved, keeping both sides:
    - `mcp/zcode-harness-mcp/package.json`: the test script lists `startup-footprint` and `retention`;
    - this file's Comments: my comments, then the orchestrator's round-24 comment.
  - After `npm run build`, `dist/` equals the merge result.

  **Full suite on 512c559** (`reports/t30-r2-*.log`):
  - `npm run test`: 860 tests, 842 pass, 0 fail, 18 skipped;
  - `test:proxy`: 1451 pass, 0 fail (98 files);
  - `test:proxy-typecheck`: clean;
  - `test:mcp`: 105 tests, 104 pass, 0 fail, 1 skipped;
  - memory ratchet tests (`verdict`, `loop`, `win-sampler`): 185 tests, 180 pass, 0 fail, 5 skipped;
  - `git status` is clean after the builds.

  **Pending CI (orchestrator):** one restaged run (Round 24 Q1 condition 1) must show the same outcomes. Linux S5/short is listed under ticket 74 on `growth:mcp-bridge` only (RED, or GREEN on the flip mark). Windows S5/short prints `unstable (… commit, budget 5, bound 30, …), owned by ticket 74` inside the band. The ratchet holds on both legs and every other job is green.

- 2026-11-08 (orchestrator, Owner Proxy round 25): restaged run 42483637377 (a53152d, with 36) disagrees with 42475847194: windows S5/short growth:mcp-bridge 34.62 %/1k commit (WS 19.17), trend true, above the 30 bound; signature (vi) does not apply (diff touches mcp/**). Its S1/short line (growth:proxy 5.18 commit only) is Round 17 signature (ii). Under Round 24 Q1 condition 1 the ticket does not merge on this run; the numbers come back as their own question.
- 2026-11-08 (orchestrator, Owner Proxy round 26, binding): 30 and 74 are staged together on one branch (integration tip, then ticket/30, then ticket/74, which is built on ticket/30). Restaged run 42483637377 (34.62 %/1k commit, trend true; z = 4.2 against the other 84 windows runs) is neither excused nor dropped: it stays value 3 of Round 25's 20-value set and in this ticket's "with 30" subset in METRICS. This ticket's S5/short verdict comes from the same 10 evidence runs per leg as 74's exit, read from warm-up-growth:mcp-bridge (Acceptance). Merge: 30 then 74 back to back in one push if both pass; 30 alone, after one confirming pre-merge run of its own tree, if only 30 passes; neither if 30 fails. Reverting 30 always reverts 74 first.
- 2026-11-08 (orchestrator, Owner Proxy round 29, binding): 74's mutant proof failed, so Round 26 Q1 condition 6c applies: this ticket takes exactly 10 full-CI runs per leg on its own staging tree (integration tip, then ticket/30; tree hash in RUNLOG before the first run), judged under the Acceptance's S5/short bullet on the band value (windows 5 < v ≤ 30 commit; linux ≤ 55 judged from the printed value; every other S5 check GREEN; Round 25's set tabulated, complete and trigger-free; signatures (vi) and (vii) never apply). Then one confirming pre-merge run (the 10th run serves if the tip has not moved and every job is GREEN), and 30 merges alone. A value above 30 or 55, or any other S5 RED, comes back with all values; nothing is rerun.

- 2026-11-08 (implementer, round 3, Owner Proxy round 29). The integration tip f56c46d (round 29, ticket 76's egress guard) is merged at 68ab061 with a merge commit, no rebase. No ticket-74 commit is in this branch: `git diff overhaul/stability-terminal-ux 68ab061` touches only 30's own 14 files, the same set as before.
  - **Conflicts and how they were resolved.** No assertion from either side was dropped.
    - `tests/memory/verdict.test.mjs`, the committed-list test: only the title line conflicted, and the body merged cleanly.
      - From ticket 20: no windows S1/burst1 entry, and `unstable` equals `["windows S5/short"]`.
      - From 30: both S5/short entries are owned by 74.
      - Title: "the committed list has no S1/burst1 entry (ticket 20 removed it) and marks windows S5/short unstable for ticket 74, its only unstable entry".
    - `tests/memory/loop.test.mjs`: the tip's new S7 retained-heap, windows S1/short and linux S6/short blocks are kept in full. The linux 42436186573 replay title that follows them keeps 30's "owned by ticket 74".
    - This file: my round-2 comment, then the tip's round 25, 26 and 29 orchestrator lines, all verbatim.
  - **List check (Round 29 condition 2).** The merged `expected-red.json` has:
    - linux `"S5/short": { "owners": { "74": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] }`;
    - windows `"S5/short": { "ticket": "74", "state": "unstable" }`;
    - ticket 20's S1 deletions kept, and nothing else differs from the tip.
    - `UNSTABLE` is the tip's version, which 30 does not touch: S1/burst1 `maxMedianMB` 300, and S5/short `growthBand` 5/30.
  - **B5.** The tip changes nothing under `mcp/`. `npm run build` leaves `git status` clean, so `dist/` equals the sources and there is no rebuild commit.
  - **Suites on 68ab061** (`reports/t30-r3-*.log`):
    - `npm run test`: 886 tests, 868 pass, 0 fail, 18 skipped;
    - `test:proxy` with the egress guard preload on: 1596 pass, 0 fail (107 files);
    - `test:proxy-typecheck`: clean;
    - `test:mcp`: 105 tests, 104 pass, 0 fail, 1 skipped;
    - the memory files alone (`verdict`, `loop`, `win-sampler`): 209 tests, 204 pass, 0 fail, 5 skipped.
  - **Local linux S5/short on 68ab061**, one run (`job.mjs --os linux --only S5/short`, cap systemd 6G; `reports/t30-r3-s5-short.log`, `/home/AgentKit/overhaul-tools/t30r3-memloop/`).
    - growth:mcp-bridge: 44.16 %/1k, trend true, so RED.
      - Slope 38.02 MB/1k, mean 86.1 MB, 703 samples.
      - Window medians 80.1 / 83.2 / 85.7 / 87.2 / 90.3 / 89.4 MB, net rise 11.6 %, 0 rising windows.
    - procPeak:mcp-bridge 91.7 MB (budget 150).
    - empty → 400 → reboot: 73 → 88 → 74 MB, so the reboot cost is 1 MB (budget 20). The data directory holds 2 MB in 1,200 files.
    - Task failures 0, orphans 0, duration 716 s.
    - The ratchet holds: the job exits 0, with "S5/short: RED on growth:mcp-bridge, owned by ticket 74 (growth:mcp-bridge)".
    - This is a local value only. It is not part of Round 29's 10-run verdict, which the orchestrator judges from CI (linux ≤ 55 from the printed value).
  - Not pushed. Staging (10 full-CI runs per leg) is the orchestrator's job.
- 2026-11-08 (orchestrator, Round 29 Q1 verdict): the 10 pre-registered runs per leg on staging/30r (tree b46596a, 42524937233..42525602188) FAIL the windows bound: commit 26.57, 31.22, 32.77, 26.01, 35.5, 20.75, 21.71, 27.82, 25.38, 25.56 (mean 27.33, 3 above 30, one above 35) against the without-30 mean 20.42 (n 19); linux 40.59-44.96 (unchanged from history); every other S5 check GREEN. 30 comes back: the next round diagnoses why 30's code raises windows commit growth of the MCP bridge by ~7 %/1k while linux RSS is unchanged (a C1 regression on the primary platform), and fixes it without changing any bound.

- 2026-11-09 (implementer, round 4, Round 29 Q1 verdict). Branch `ticket/30-mcp-task-retention`. The integration tip 788f2fb is merged at f3c22d1 (only this file conflicted; both sides kept). Fix at d8b34db; tests at 0ea6770 and 4d3552a.

  **Root cause: a full scan of every retained task on every request.**
  - Before this round, `enforceRetention()` ran on every lookup (get, list, wait, events, result, input, cancel) and on every terminal transition. Its no-op check `retentionExceeded` walked every retained task: a generator over the `tasks` Map, `EVICTABLE_STATES.includes` and a `Date.parse` per record.
  - S5 makes about 5 such calls per task: `startTask`'s `list()`, `wait`, `result` → `buildResult`, and `onTerminal` plus its own `buildResult`. With n retained tasks, each task costs O(n) work and garbage, so the run costs O(n²). S5/short has 400 tasks and nothing is evicted, so n climbs to 400.
  - **Linux probe** (`/home/AgentKit/overhaul-tools/t30r4-scripts/`):
    - Setup: `s5probe.mjs` makes the same calls as `s5-mcp.mjs`, 400 tasks, `--max-semi-space-size=1`. The `gcprobe.mjs` preload counts GCs by kind and samples the heap and CPU. Arms: bridge package copies that differ only in the two dist files, 3 runs per arm side by side (`/home/AgentKit/overhaul-tools/t30r4-runs/`).
    - Tip (f56c46d dist) vs 30's head (cbce56f dist):
      - minor GCs at task 400: 322.7 vs 443.0 (+37 %);
      - extra minor GCs per 100 tasks: +8, +23, +39, +50, so they grow with the number of retained tasks;
      - CPU: 4.73 vs 5.52 s (+17 %);
      - major GCs: 8 vs 8;
      - RSS slope: 37.5 vs 37.3 MB/1k (unchanged, as on CI linux);
      - heapTotal slope: 25.1 vs 27.0 MB/1k. Tip runs alone spread 24.5 to 29.4, so this is not conclusive.
    - Microbenchmark of the scan (`scanbench.mjs`): about 100 B per record while it is unoptimised, 2.5 to 6 B once optimised, and 0.1 ms per call at 400 tasks.
  - **Windows artefacts** (`/home/AgentKit/overhaul-tools/ci-art/t30r4-art/`, scripts `series.py` and `tail.py`):
    - Compared: the 10 staging/30r runs against 10 runs from Round 25's set (no 30).
    - Same runner image (20261103.298.1) and Node (v26.13.0). The bridge sources and the S5 harness are identical except for 30's two dist files.
    - Mean bridge commit medians per 50-task bucket:
      - tasks 0 to 350: the two arms agree within 0.3 MB;
      - tasks 350 to 400: 78.26 vs 76.42 MB (+1.84).
    - In 10-task buckets, the gap grows from about 0 at task 300 to +1.4 to +2.5 MB over tasks 350 to 390.
    - Without 30, commit falls by 1.5 to 3 MB somewhere in tasks 310 to 360; with 30, it does not.
    - The extra growth therefore builds up at the end of the window, where the scans are longest.
  - **Why windows commit and not linux RSS: an inference, not measured on windows.** The scan adds young-generation garbage and scavenges with a 1 MB semi-space, which churns heap pages. Windows commit counts committed pages; linux RSS counts only touched pages, and its S5 value is a noisier ~40 %/1k warm-up.
  - **Ruled out:**
    - fs work: no file is deleted or scanned below 500 tasks;
    - timers and watchers: none added;
    - retained per-task structures: the index is one boolean per task;
    - runner image or Node drift: the same image and Node in both arms;
    - the tool description: built once.

  **Fix (d8b34db, `src/tasks/manager.ts`, `dist/` rebuilt, B5): an O(1) retention index.**
  - `evictableCount` is the exact number of retained tasks in an evictable state. `oldestEvictableMs` is a lower bound of their finish times. Each task gets a `retentionCounted` flag.
  - Every record change goes through `persist()`, which updates the index for that task. This covers the terminal transitions, the follow-up rollback to a previous state, and `stopAll`. `restore()` and every scan rebuild the index.
  - The per-request check is `evictableCount ≤ 500 && oldestEvictableMs ≥ now − 7 d`. Only when it fails does the existing victim scan run, followed by a recount.
  - A task that leaves an evictable state can leave the bound too low. That costs one scan, never a missed eviction.
  - `retentionExceeded` is removed.
  - The retention rules are unchanged: 500 terminal tasks or 7 days, evictable states, file pruning, restore, the idempotency window and the sentence.
  - No budget, bound, band, window, task count, S5 scenario or `expected-red.json` entry changed (C1, §9).

  **Tests (seam 7, `retention.test.mjs`, now 7):**
  - New: "a lookup does not visit the retained tasks". The new `test/fixture/scan-count.mjs` preload counts Map elements visited and `Date.parse` calls in the bridge. Per-lookup work with 400 retained tasks, and at the 500 bound after a run-time eviction, must equal the work with 10.
    - RED on 0ea6770, i.e. 30's head code: "Map elements visited per lookup: 10 with 10 tasks, 400 with 400" (`reports/t30-r4-red.log`).
    - GREEN on the tip's dist (`reports/t30-r4-tipgreen.log`), and GREEN after the fix (`reports/t30-r4-green{2,3}.log`).
  - New, adversarial for the index: "a task finished at run time ages out with nothing restored, and a follow-up restarts its age". At +6 d the reopened task gets a follow-up; at +7 d +1 min the other task is gone (files and key too) while the reopened one stays; at +13 d it is gone too.
    - It also holds on the old full scan, so its proof is mutation (M13, M14).
  - **Mutations** on committed 4d3552a, in the detached scratch worktree `/home/AgentKit/overhaul-tools/t30r4-mut` (script `t30r4-scripts/mutate.py`, `reports/t30-r4-mutations.log`). All 10 are killed, and every restore with `git checkout 4d3552a -- src/tasks/manager.ts dist` is clean.
    - M1: count clause removed from the per-request check;
    - M1b: count bound removed in the victims;
    - M2: age bound removed in the victims;
    - M2b: age clause removed from the per-request check;
    - M8: lookups skip the retention;
    - M13: `persist` does not update the index;
    - M14: a record change never lowers the age bound;
    - M15: restore does not build the index;
    - M16: no recount after a scan;
    - M17: back to a full scan per request.

  **Linux after the fix** (3 fix runs beside 3 fresh tip runs, the same probe):

  | arm | minor GCs at task 400 | major GCs | CPU s | RSS slope MB/1k |
  |---|---|---|---|---|
  | tip | 319.7 | 8 | 4.97 | 38.1 |
  | fix | 321.0 | 8 | 4.97 | 38.6 |

  **Local `job.mjs --os linux --only S5/short`** (`--cap none` inside run-capped's 6G systemd scope; `reports/t30-r4-s5-short.log`, `/home/AgentKit/overhaul-tools/t30r4-memloop/`):
  - growth:mcp-bridge 38.17 %/1k, trend true (≤ 55). Slope 32.56 MB/1k, mean 85.3 MB, window medians 79.6 / 82.4 / 85.9 / 87.8 / 87.8 / 88.5, net rise 11.2 %.
  - procPeak 90.3 MB.
  - empty → 400 → reboot: 73 → 87 → 74 MB (reboot cost 1).
  - 0 failures, 0 orphans.
  - The ratchet holds: owned by ticket 74.

  **Suites on 4d3552a** (`reports/t30-r4-*.log`):
  - `npm run test`: 894 tests, 876 pass, 0 fail, 18 skipped;
  - `test:proxy`: 1596 pass, 0 fail (107 files);
  - `test:proxy-typecheck`: clean;
  - `test:mcp`: 107 tests, 106 pass, 0 fail, 1 skipped (+2);
  - `git status` is clean after the build.

  **Windows: pending CI.** The orchestrator runs a fresh pre-registered set. The expectation is that the windows commit series returns to the without-30 shape, but that is not proven here.

  **Left open:**
  - At the 500 bound, each new terminal task still costs one scan and sort, O(n log n), to pick its victim. Lookups stay O(1) (M16). This does not affect S5/short, and S5/long was GREEN with it.

- 2026-11-09 (implementer, round 4 addendum).
  - **Second merge.** The integration tip moved to 8cfc667 (ticket 75, free ports in kit tests). It is merged at 47169f0, with no conflicts and nothing under `mcp/`.
  - **One `test:mcp` failure on the merged tree, fixed in db386ed.** The new lookup-work test read the preload's count file while the preload was rewriting it ("Unexpected end of JSON input"). The read now retries until the JSON parses.
    - The test is still RED on 30's pre-fix dist ("10 with 10 tasks, 400 with 400"; `reports/t30-r4b-red.log`).
    - It is GREEN 3 of 3 times on the fix (`reports/t30-r4b-lookup-{1,2,3}.log`).
  - **Suites on db386ed:**
    - `npm run test`: 901 tests, 883 pass, 0 fail, 18 skipped (`reports/t30-r4b-test.log`, on 47169f0; db386ed only touches the bridge test);
    - `test:proxy`: 1596 pass, 0 fail (107 files);
    - `test:proxy-typecheck`: clean;
    - `test:mcp`: 107 tests, 106 pass, 0 fail, 1 skipped (`reports/t30-r4c-test-mcp.log`);
    - `git status` is clean after the build.
  - **Third and fourth merges.**
    - The tip merged ticket 73 (de1d550, merged here at c715e64). On that tree, `npm run test` failed in 2 of 3 runs on 73's new live freeze test in `tests/memory/loop.test.mjs`: "a live child is frozen, thawed and killed by its identity", which read the process state as `R` where it expected `T`. Nothing in 30 touches it.
    - The tip then reverted 73 (2347fa2, 6d4331d), merged here at ac0dcef. Without 73, the branch again differs from the tip only in 30's 15 files.
  - **Final suites on ac0dcef** (`reports/t30-r4f-*.log`):
    - `npm run test`: 901 tests, 883 pass, 0 fail, 18 skipped;
    - `test:proxy`: 1596 pass, 0 fail (107 files);
    - `test:proxy-typecheck`: clean;
    - `test:mcp`: 107 tests, 106 pass, 0 fail, 1 skipped;
    - `git status` is clean after the build.
- 2026-11-09 (orchestrator, Owner Proxy round 30, binding): the round-4 set on staging/30s (tree e5b2c50, 42542570923..42543167527, pre-registered at 00:52Z before the first run) is ratified as this ticket's Round 29 Q1 condition 2 set and PASSES: windows commit 17.1, 16.67, 26.04, 18.17, 21.16, 23.53, 19.72, 20.43, 26.59, 20.0 (mean 20.94, trend false 10/10; t 0.41 against the without-30 mean 20.42, t 3.48 against the failed b46596a set), linux 34.85-45.09 (all <= 55), every other S5 check GREEN on all 20 legs, Round 25's set complete with no trigger. The 34.62 of 42483637377 and the b46596a set are attributed to the pre-fix per-request retention scan (Round 25 Q1 condition 7 closed). Merge: re-merge onto the current tip and one confirming pre-merge run (band in force, linux listed on growth only, every other S5 check and every other job GREEN); the 10 runs transfer only if the tip since e84971f touched nothing on Round 25 Q1 condition 2's S5 list. Run 42542646289's linux S1/stalled RED (growth:proxy 5.5 %/1k, trend true; procPeak 206 MB, count 1, orphans 0) is not charged to this ticket (its S1-reachable edits are a label string in job.mjs and a comment in lib/ratchet.mjs); a linux S1/stalled or windows S1/short RED in the confirming run comes back with its values; nothing is rerun. A further failed S5 set comes back to an Owner Proxy round before any new set is pre-registered.
- 2026-11-09 (merger): Merged 2026-11-09 as c93fa09; fast suite: kit 957/975 (0 fail, 18 skipped), proxy 1596/1596, mcp 106/107 (0 fail, 1 skipped). Plain `--no-ff` merge of ticket/30-mcp-task-retention (540752f) into the tip 984b45d; only this file conflicted (both texts kept). No lockfile changed; `mcp/zcode-harness-mcp/dist/` unchanged after `test:mcp`'s build (B5). Confirming pre-merge CI run https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42554009659 (staging/30t, head 294188c = 984b45d + ticket/30), green on all 8 jobs. Owner Proxy round 30 check: windows S5/short growth:mcp-bridge 18.48 %/1k commit (WS 16.29, trend false), in (5, 30]; procPeak:mcp-bridge, orphans, bridge:reboot-cost-of-history and bridge:task-failures ok, so S5/short GREEN (unstable, ticket 74). Linux S5/short growth:mcp-bridge 41.51 %/1k (trend true), ≤ 55, RED on growth only (ticket 74); every other S5 check ok. Linux S1/stalled and windows S1/short GREEN; windows S1/stalled RED on procPeak:proxy 283.8 MB WS is the tolerated ticket-61 entry (ratchet holds). Pre-registered set: staging/30s (tree e5b2c50, 42542570923..42543167527), passed; failed pre-fix set: staging/30r (tree b46596a, 42524937233..42525602188). Sanity diffs: `git diff staging/30t HEAD` over the ticket's files and over the whole tree (excluding `.scratch`) are both empty; no tip changes since 984b45d. Logs: `reports/merge-30-{npm-ci,test,test-proxy,test-mcp}.log`; CI logs in `/home/AgentKit/overhaul-tools/merge-30-ci/`.
