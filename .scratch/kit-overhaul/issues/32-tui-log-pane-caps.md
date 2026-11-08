# 32: TUI log pane capped at 2,000 lines and 8 MB

**Blocked by:** 05 (Shared width core and token set (two renderers, one token set)), 11 (Batch 1c — Bun 1.4.4 bootstrap in the installers, pinned proxy typecheck, 1.4.4 attribution runs)

**Status:** resolved

Model: glm

Risk: low

ADR: 0009

**What to build:** The log pane enforces a byte cap (8 MB) in addition to its 2,000-line cap.

**Acceptance criteria:**

- [ ] Seam 6: `log-pane` tests for line and byte caps with 64 KB lines.
- [ ] Loop S6: log pane ≤ 16 MB heap with 64 KB lines, resize storm ≤ 8 MB, frame time unchanged. **Delete `S6/short` (linux).**
- [ ] A single line larger than 8 MB never makes the pane exceed 8 MB (the line is truncated or dropped; the ticket states which).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 73

## Comments

### 2026-11-07 — implementer (opus, standing in for the glm worker)

**Branch:** `ticket/32-tui-log-pane-caps` (worktree `/home/AgentKit/wt/t32`), Bun 1.4.2. The change is fix commit `e7918b4`. The integration tip `f579dbf` is merged in (`695fac1`, docs only). The head SHA is the commit that adds this comment.

**What changed**
- `zcode-proxy-src/src/tui/log-pane.ts`: `LogPane(capacity = 2000, byteCapacity = 8 MiB)` and the new `bytes` getter. `LOG_PANE_MAX_LINES` and `LOG_PANE_MAX_BYTES` are exported. Each pushed row is fitted, and then the oldest rows are evicted until the pane is within both caps. The scrollback offset is clamped to the retained line count. `app.ts` (`new LogPane(2000)`) gets the 8 MB default without a change.
- `tests/memory/scenarios/s6-tui-run.ts` and `s6-tui.mjs`: phase C ends at a new `C-end` mark, and `tui:long-line-heap` is now judged on `C-end` − `C-start`. A new phase D runs while the pane is scrolled to the top. It pushes 1,000 × 64 KB ASCII + 😀 lines, one 20 MB line, 1,000 × 64 KB CJK lines, and 4 multi-line records, each a 20 MB row plus 2,000 short rows. The new check `tui:adversarial-line-heap` takes the worst D mark − `C-start` against the same 16 MB budget (`MEMORY.S6.longLineHeapMB`; budgets unchanged). The frame time with the 8 MB line on screen is recorded as `hugeLineFrameMs`, not gated.
- `tests/memory/expected-red.json`: deleted `linux` `S6/short` → 32. There was no windows entry, because S6 is ubuntu-only.

**Decisions**
1. **A line above 8 MB is truncated, not dropped.** The head is kept, cut on a UTF-8 code-point boundary, so no surrogate pair or multibyte character is split. The giant line then fills the pane alone, and the next pushed line evicts it. A row only ever shows its first screen width (design-language §5 allows truncating TUI log lines). The untruncated record goes to the `ZCODE_TUI_LOGFILE` tee when that is set. The kit never sets it (round3-facts), so under the TUI the pane holds the only copy, truncated.
2. **Unit of the 8 MB cap: bytes = max(UTF-8 size, in-memory size).** Text holding a character beyond Latin-1 is held at two bytes per UTF-16 unit. So 64 KB of ASCII plus one emoji costs 128 KB of heap, and counting UTF-8 alone would let the pane hold about 16 MB. With the larger of the two counted, the cap bounds the text and its heap. When an over-cap head would still be over the cap in memory, it is cut at half the cap (`fitLine`).
3. **Stored text is always a fresh copy, made through UTF-8.** This was found by the adversarial S6 phase, and a probe confirms it: under Bun 1.4.2 a `slice`/`split` substring keeps its whole parent alive (8 × 16 MB parents with 4 KB slices kept: +128 MB heap; with a copy: +0). Without the copy, 2,000 short rows split from one record kept that 20 MB record alive (S6 phase D: 20 MB, RED). One side effect: a lone surrogate becomes U+FFFD in the pane (display only). The push cost of a short line goes from about 0.65 to 1.2 µs, which is negligible next to a frame (about 70 µs).
4. **The scroll offset is clamped on eviction.** Before the clamp, a long-line flood while scrolled 1,500 lines up left a stale offset above the line count, and `scrollDown(count)` did not return to following. Pinning the viewport while new lines arrive (it currently moves with the tail) is ticket 49's scope and is unchanged here.
5. 8 MB = 8 × 1,048,576 bytes, the same `MB` the S6 body uses.

**RED → GREEN**
- S6/short on the integration tip `feb4aec` (`reports/t32-s6-red.log`): RED, `tui:long-line-heap` 125 MB (budget 16), pane 2,000 lines.
- Unit tests at seam 6 (`log-pane.test.ts`, 9 new tests; `frame.test.ts`, 2 new tests), one slice at a time: `t32-unit-red1` → `green1` (64 KB byte cap), `red2` → `green2` (> 8 MB line), `red3` → `green3` (two-byte cost; the CJK count, CJK cut and emoji cut tests already held after slice 2's boundary cut), `red4` → `green4` (flood while scrolled). Then the S6 phase D: `t32-s6-red2` RED (`tui:adversarial-line-heap` 20 MB, a substring parent kept) → copy fix → `t32-s6-green2` GREEN.
- Proof against the tip's pane (`t32-frame-tip`: the tip's `log-pane.ts` swapped in, then restored; `cmp` identical): 9 of the 11 new tests fail. The 2,000-line cap with many small lines and the 80-column CJK/emoji/mixed frame rows already held on the tip. The second pins the unchanged renderer.

**Metrics delta (S6/short, linux, Bun 1.4.2)**

| check | tip `feb4aec` | this branch | budget |
|---|---|---|---|
| `tui:log-pane-heap` (100k lines) | 2 MB | 2 MB | 16 |
| `tui:resize-storm-heap` | 0 MB | 0 MB | 8 |
| `tui:long-line-heap` (4,000 × 64 KB) | **125 MB** (pane 2,000 lines) | **7 MB** (pane 127 lines) | 16 |
| `tui:adversarial-line-heap` (new) | — | 8 MB (worst mark: the 8 MB truncated line) | 16 |
| `resizeFrameMs` (not gated) | 0.067 | 0.066–0.070 (3 runs) | unchanged |
| `hugeLineFrameMs` (not gated, new) | — | 5.9 ms per frame while the 8 MB row is on screen | — |

- The ≥ 30 % peak rule is met: the long-line heap fell 125 → 7 MB, about 94 %.
- Job ratchet: `node tests/memory/job.mjs --os linux --only S6/short` (`t32-job-s6`) reports "ratchet holds": S6/short GREEN, not listed.
- The S6 body's own RSS peaks at about 268 MB during phase D. That is the scenario building 20 MB test strings, not the pane (heap 2 MB at that mark); S6 has no RSS budget.

**Snapshot diff:** none. `npm run test:ux-before` (`t32-ux-before`, the proxy-TUI captures) passes byte-identical, because ordinary log lines render as before. The two new frame tests pin the 80-column rows of a capped pane: a 64 KB CJK row cut on a cluster with `…` and a pad cell, an emoji row, a two-byte mixed row, and a > 8 MB row as one truncated row with the title `Logs (1)`. Every row is 80 cells.

**Full suites** (after the tip merge; the later docs-only merge changes no code)
- `npm run test` (`t32-test-kit`): 744 tests, 725 pass, 0 fail, 19 skipped.
- `npm run test:proxy` (`t32-test-proxy`): 1,354 pass, 0 fail, 90 files. `npm run test:proxy-typecheck`: 0 errors.
- `npm run test:mcp` (`t32-test-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped.

**Common criteria:** no new test files (the tests extend `log-pane.test.ts`, `frame.test.ts` and the S6 scenario, all already wired). No pre-existing test assertion changed. No new log event, config key or env override.

**Pending CI (orchestrator verifies after merge+push)**
- ubuntu `memory-budget` job: S6/short GREEN with the entry deleted, and the new `tui:adversarial-line-heap` check GREEN on the runner.
- windows-latest `test-proxy` leg: `log-pane.test.ts` and `frame.test.ts` pass. They use `Buffer`, emoji/CJK literals in source, and 9–10 MB strings.
- windows `memory-budget` leg: unaffected (no S6 there; the windows expected-RED list is unchanged), but confirm it stays green.
- `test-kit` legs (ubuntu/windows × Node 24/26): `tests/memory/verdict.test.mjs` and `loop.test.mjs` pass with the trimmed `expected-red.json`.

**Left for other tickets:** 49 owns viewport pinning while new lines arrive when scrolled, and the `▼ 0 more` badge shown when a short pane is scrolled by fewer rows than the viewport. 48 owns level words and timestamps in rows. When ticket 01's owner next edits `METRICS.md`, the S6/short row "RED → 32" becomes GREEN.

### 2026-11-07 — merger

- Merged 2026-11-07 as 0c75be53ccf550bdc30b239a7c35db9d047b3982 (ticket/32-tui-log-pane-caps at fcc10bf into a858ade; first merge, no revert-of-revert step); fast suite: kit 747/766 (19 skipped, 0 fail), proxy 1354/1354, mcp 95/96 (1 skipped, 0 fail); mcp dist unchanged; no lockfile changes; clean merge (no conflicts). Sanity: `git diff --stat staging/32 HEAD -- zcode-proxy-src/src/tui tests/memory/expected-red.json tests/memory/scenarios/s6-tui-run.ts tests/memory/scenarios/s6-tui.mjs` is empty (every file ticket 32 changed matches the staging/32 e296f35 tree CI judged). Pre-merge CI (draft PR #23, staging/32 on the tip with ticket 66), green on all 8 jobs: https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42415961268; linux S6/short GREEN without its expected-RED entry (long-line heap 7 MB vs 125 MB at the tip, budget 16). METRICS.md S6/short row moved from "RED → 32" to GREEN in this resolve commit. Logs: .scratch/kit-overhaul/reports/merge-32-{npmci,test,proxy,mcp}.log.

- 2026-11-08 (Owner Proxy round 21 Q1): tui:adversarial-line-heap read 20 MB once in 33 CI runs (42446461464; 8 MB in the other 32). From ticket 71's merge on, the check is judged on the median of 5 fresh S6 repetitions, every repetition ≤ 32 MB; budget 16 MB unchanged. The ticket stays resolved.
