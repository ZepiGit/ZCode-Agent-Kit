# 80: windows S2/short cdn-cache:memory-growth after ticket 29: A/B attribution

**Status:** ready-for-agent
**Blocked by:** none

Model: sol
Risk: medium
ADR: no

**What to build:** Owner Proxy round 31 Q1. Post-merge run 42553765178 (984b45d) was RED on windows S2/short cdn-cache:memory-growth 65 MB commit (WS 62; budget 64), unowned. By tree contents, windows values are 25-only n 26 mean 52.88 sd 6.00 max 62 and 25+29 n 39 mean 56.44 sd 5.26 max 65 (Welch t 2.45), bimodal on both trees (low ~47.6 / 49.8, high ~59.1 / 59.8; high share 46 % -> 67 %, Fisher p 0.13). Ticket 29 is the only change on S2's measured path but is not proven to be the cause. Stage 1 (pre-registered): an off-by-default test-loop marker (never merged) runs full S2/short with phase D on head's CaptchaCdnCache or on the verbatim pre-29 cache zcode-proxy-src/src/__fixtures__/captcha-cdn-cache.7555b87.ts, everything else identical; >= 30 runs per arm on windows (ABAB in one job, BABA in the next) and >= 10 per arm on linux; record commit and WS at D-start/D-end, the mode (<= 54 / > 54) and whether the pruner's 60 s rescan ran in phase D. Verdict: attributed if windows commit mean(head) - mean(pre-29) >= 2.0 MB with Welch t >= 2.5; not attributed if < 1.0 MB or t < 1.5; otherwise inconclusive and it comes back. Stage 2 only if attributed: remove the cost inside 29's code as resource lifecycle (B1 IN SCOPE); captcha-cdn-disk-prune.test.ts, captcha-cdn-disk-replay.test.ts and ticket 25's seam-3 replay pass unchanged (same prune decisions, fetches, bytes, sha256, fetchedAt). Never change the 64 MB budget, the 32 MiB body budget, 256 entries, the 256 MiB disk cap, the age rule, the S2 workload or the metric. Exit: >= 10 GREEN windows S2/short runs on the fix tree and the A/B on the fix tree < 1.0 MB. Attributed with no lever inside those limits, not attributed, or inconclusive: comes back to an Owner Proxy round with all values. A merge on S2's path (for example 58) during the runs restarts the count. This ticket owns no name and lists nothing; it records every signature (ix) occurrence (run id, commit, WS, linux value), starting with 42553765178.

**Acceptance criteria:**
- [ ] Stage 1 A/B recorded with all per-run values and the verdict under the pre-registered rule.
- [ ] Stage 2 (only if attributed): fix with the three replay/prune suites unchanged and green, then the exit evidence above.
- [ ] METRICS table: per arm, per leg, per run.

## Comments

### 2026-11-09, implementer: stage 1 tooling (branch `ticket/80-cdn-ab-attribution`, implementation c82251d, merged with the tip 278d329 as 4f4c079)

**What exists now.**
- **Marker** `tests/memory/measure-cdn`, never merged. Content `N`, `N ABAB` or `N BABA` (N = rotations from 1 to 50; `N` means ABAB). While the marker is committed, ci.yml's memory-budget job runs `job.mjs --measure-cdn "<content>"` in place of the ratchet, on both legs. An even `GITHUB_RUN_ATTEMPT` reverses the marker's order, so re-running one marker commit alternates ABAB / BABA. A new push of `N BABA` does the same.
- **Arms.** A = `head`: the tree's `CaptchaCdnCache`. B = `pre-29`: the verbatim `zcode-proxy-src/src/__fixtures__/captcha-cdn-cache.7555b87.ts`.
  - The job tells each run its arm through `ZCODE_MEMLOOP_CDN_ARM`. The S2 body loads both modules before phase A, so both arms load the same modules, and builds the arm's class only in phase D.
  - The D-start / D-end marks report the class of the instance built (`instanceof`), not the label it was given. The job marks a run invalid when the class does not match its arm.
  - An unknown arm value fails the body before phase A, so a typo never measures head instead.
  - With the variable unset, the body loads nothing extra and the marks carry nothing new (default S2/short run below).
- **B1.** No product file changed. The fetches, bytes, prune decisions and the S2 workload (600 × 256 KiB puts) are the same in both arms. S2 starts no proxy, uses the offline fixture backend, and phase D only `put`s, so there is no egress.
- **Per run** (`<out>/measure-S2-cdn.{json,md}`, rewritten after every run so a job that times out keeps its finished runs):
  - the `cdn-cache:memory-growth` value, the run's mode (≤ 54 / > 54), commit (`footprintMB`) and WS (`rssMB`) at D-start and D-end, both growths and the commit − WS gap;
  - whether the head pruner's 60 s rescan ran in phase D. This is read from Date.now around the constructor (start scan) and the last put (the pruner's check): yes / no / unsure; pre-29 is `no pruner`. The put span is recorded too.
- **Per job:** per-arm values, mean, sd and low/high counts, head − pre-29 with Welch t and df, the order, the attempt and the tree. No verdict per job.
- **Pool:** `node tests/memory/cdn-ab-pool.mjs [--json] <reports…>` pools the valid runs of several jobs and reads the pre-registered rule: windows only, ≥ 30 valid per arm, otherwise "insufficient". It lists the jobs' orders and trees. It refuses to mix OS legs.

**Runs per job: 8 rotations (16 runs), marker content `8`.** Inputs:
- S2/short takes 147–212 s per run on the windows leg (cdn29 logs) and 137–181 s on CI linux. Locally it took 196–221 s.
- The job timeouts are 150 min (windows) and 75 min (linux). The per-run cap timeouts are 2400 s (windows) and 1200 s (linux).
- One marker serves both legs, so linux binds:
  - 16 × 181 s = 48 min, or 65 min with one run timing out, inside 75.
  - Windows: 16 × 212 s = 57 min, or 93 min with one run timing out.
  - 10 per arm would put linux at 77 min in the one-timeout case.

**CI runs to start: windows 4 (ABAB, BABA, ABAB, BABA → 32 per arm, ≥ 30 with 2 runs of slack per arm); linux 2 (→ 16 per arm, ≥ 10).** Every marker run carries both legs, so start 4 runs. The simplest way: commit `tests/memory/measure-cdn` = `8` on a staging branch, push (attempt 1 = ABAB), then re-run all jobs 3 times (attempts 2–4 = BABA, ABAB, BABA). The kit-test legs fail while the marker exists (the guard), as with measure-stalled. Pool the four windows `measure-S2-cdn.json` files, and separately the linux ones, with `cdn-ab-pool.mjs`. A merge on S2's path between the runs restarts the count.

**Tests** (`tests/memory/loop.test.mjs`, 13 new):
- CI wiring, including the guard: it fails while `tests/memory/measure-cdn` exists.
- The job seam, with a fake run in a `cdn-arms` mode: worked linux example, windows fields, order / attempt, explicit marker order, a deaf body (arm never reached phase D) → invalid + exit 2, missing phase D / value / harness failure → invalid, argument refusal.
- The real S2 body under Bun (phase D only, the real 600 puts): pre-29 vs head class, rescan "no", 600 entries, directory removed; unset arm adds nothing; unknown arm fails.
- The pool CLI: attributed at 3.0 MB / t 2.86, inconclusive at t 1.90 and at 1.5 MB, not attributed at 0.5 MB, insufficient at 29 per arm, invalid runs left out, linux without the rule, mixed OS refused, trees listed.
- The rescan classifier at its boundaries.

**RED → GREEN.**
- Wiring test RED (no step, the ratchet `if` without measure-cdn; `reports/t80-red1.log`).
- Job tests RED on `unknown argument --measure-cdn` (`t80-red2.log`).
- Body tests RED (no `cdnPhaseD`; the typo arm exited 0; `t80-red3.log`).
- Pool tests RED (no script; `t80-red4.log`).
- All GREEN in `t80-green2/3/4.log`.

**Mutations** (after committing c82251d; each restored with `git checkout c82251d -- <file>`, then `git diff c82251d` was empty):
1. Marker file present → the guard test fails ("tests/memory/measure-cdn is a test-loop switch…", `t80-mut1.log`).
2. Body always builds head's class → the body test fails (actual `[head, head, no]` for the pre-29 arm, `t80-mut2.log`).
3. Job does not pass the arm → the linux worked example fails (`t80-mut3.log`).

**Suites after the merge** (4f4c079):
- `npm run test`: 1032 tests, 1012 pass, 0 fail, 20 skipped.
- `npm run test:proxy`: 1633 tests, 1632 pass, 0 fail, 1 skip. Includes captcha-cdn-disk-prune and captcha-cdn-disk-replay, unchanged.
- `npm run test:mcp`: 116 tests, 115 pass, 0 fail, 1 skipped.
- `test:proxy-typecheck`: clean.
- Default `job.mjs --only S2/short` (linux, local): ratchet holds (RED only on ticket 58's owned names), cdn-cache:memory-growth 57 MB, D marks without `cdn*` fields (`reports/t80-s2-default.log`).

**Local linux A/B** (4 rotations ABAB, never counted, METRICS "Ticket 80"):
- head 58, 43, 58, 57 (mean 54, sd 7.35).
- pre-29 57, 57, 57, 58 (mean 57.25, sd 0.5).
- −3.25 MB, Welch t −0.88.
- 8 of 8 valid. Rescan in D: never (puts take 3.5–4.2 s).

**Decisions taken.**
- **One marker for both legs.** N is set by the linux timeout, not the windows one.
- **Order alternation by run attempt.** Re-runs need no extra commit, and the marker may still name the order.
- **Arm proof by `instanceof`, not by label.**
- **Rescan reading by timing.** It does not touch the pruner, which would be a B1 change.
- **The pool tool is part of stage 1.** The verdict needs ≥ 30 per arm across ≥ 4 jobs.
- **Linux carries no rule reading.** The pre-registered rule names windows commit.

**Left open.** The stage 1 verdict and the METRICS per-run CI table are pending CI: the orchestrator starts the 4 marker runs and records them. Stage 2 depends on that verdict. Signature (ix) occurrences beyond 42553765178: none seen by this implementer.
