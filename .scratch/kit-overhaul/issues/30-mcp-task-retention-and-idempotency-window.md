# 30: MCP task retention (500 / 7 days) and the idempotency window

**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0009

**What to build:** Terminal tasks are evicted at > 500 or > 7 days, whichever first; running tasks never; `*.result.json` pruned with the task; startup restore loads only retained tasks; the idempotency key is forgotten on eviction; an evicted task gives the existing not-found error. The tool description carries the idempotency sentence.

**Acceptance criteria:**

- [ ] Seam 7 (MCP client + fake harness): eviction by count and age with an injected clock, non-terminal kept, files pruned, restore loads only retained, not-found and new-task-on-reused-key after eviction.
- [ ] Loop S5: growth ≤ 5 %/1k, reboot cost of history ≤ 20 MB, 0 task failures. **Delete `S5/short` (linux, windows).**
- [ ] Linux exit (Round 17 Q2 condition 2; explicitly contradicts Round 13 Q1 condition 4, third bullet): `growth:mcp-bridge`, and with it the linux `S5/short` entry, is removed only when every one of ≥ 10 fresh matching linux CI runs on this ticket's tree has `growth:mcp-bridge` ≤ 5 %/1k, whatever the trend flag says, and every other S5 check is GREEN. A GREEN at 39 %/1k is a missed trend, not a fix. Windows keeps the Round 13 exit (Comments, 2026-11-07).
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
