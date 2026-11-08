# 21: Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB

**Blocked by:** 19 (Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract), 14 (Event-line format and redaction for new log events (prefactor))

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0008

**What to build:** One supervisor module owns heartbeat/watcher (`watchdogStep` stays its pure core, SAB heartbeat kept), memory sampling (`memoryFootprint`, RSS fallback), the single graceful shutdown sequence (used by SIGINT/SIGTERM, later the stop request, the memory respawn and update) and the respawn handoff point. Thresholds: soft 512 MB / hard 1024 MB × 3 samples 15 s apart, configurable. Soft only WARNs and logs (no solver recycle). Without a manager hook (TUI, standalone) the supervisor logs and keeps serving. During the drain the listener stays open, new requests are shed (19's contract), in-flight requests get the drain window, streams cut at the force point are counted in one log line. Lifecycle closures leave the proxy entry point.

**Acceptance criteria:**

- [ ] `health-monitor`/`watchdog` module tests with an injected sampler: soft → WARN only; hard ×3 → respawn request; thresholds from config; no hook → log + keep serving.
- [ ] Loopback drain test (seam 4): new requests during the drain get 503 + `Retry-After`, the listener stays open, an in-flight request completes, cut streams counted.
- [ ] Config keys documented; release-notes item "1536/3072 → 512/1024 MB" noted for 54.
- [ ] Adversarial: two consecutive samples above hard followed by one below → no respawn request; samples are 15 s apart (injected clock); a soft breach never recycles the solver.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 26, 27, 28, 52

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 18): Q3 condition 3 — ADR-0008's "designed maximum of about 450 MB … 64 MB × ~4.5" is out of date: the measured linux maximum under the cap is 608.5 MB (RSS, S1/burst32, ticket 19's tree), so the 512 MB soft limit (WARN only) can fire under legitimate cap-saturating load; the 1024 MB hard limit keeps more than 400 MB of margin on linux; the windows footprint is EVIDENCE MISSING. The thresholds do not change. This ticket's evidence records the proxy footprint the supervisor samples, per leg, for the S1 burst runs on its tree. If that footprint can hold at or above 1024 MB for 3 samples, this ticket comes back with numbers before it merges (C1: no restart storms).

### 2026-11-08 — implementer

**Branch:** `ticket/21-health-supervisor` (worktree `/home/AgentKit/wt/t21`). Commits: `9961d3b` (implementation), `15adb27` (test fix-forward after the mutation run). The integration tip `e88821f` was merged before the final suites ("Already up to date"). Ticket 15 had not landed (it is on `staging/15` only), so nothing was merged from it. The head SHA is the commit that adds this comment.

**What landed**
- `zcode-proxy-src/src/runtime/supervisor.ts`, the health supervisor (ADR-0008). It owns:
  - the heartbeat watcher (`installWatchdog`, unchanged: `watchdogStep` is still its pure core and the SAB heartbeat is kept) and the event-loop lag monitor;
  - memory sampling: `memoryFootprint()` = `Bun.unsafe.memoryFootprint()` (Pss on Linux, PrivateUsage on Windows), falling back to RSS where it is missing;
  - the thresholds: soft 512 / hard 1024 MB, each held for 3 samples taken 15 s apart on the injected clock (`DEFAULT_MEMORY_THRESHOLDS`, in the leaf module `memory-thresholds.ts`). The soft limit only writes one WARN event line per episode and never recycles the solver; an INFO line follows when the footprint is back under it. The hard limit requests a respawn through the handoff point `RespawnHandoff`, which today is the manager hook's spawn confirmation (`managerRespawnHandoff`). Only a confirmed request runs the graceful shutdown. Without a hook it writes one WARN per episode and keeps serving. A hook that does not start gives one ERROR and the proxy keeps serving, with no retry until the episode ends;
  - `createGracefulShutdown`, the one shutdown sequence. It drains (the listener stays open), stops background work (claim scheduler, captcha runtime), gives accepted requests the drain window, then cuts at the force point and writes one event line: `INFO|WARN shutdown drain finished reason=… waitedMs=… cut=N shed=M`. After that come the bounded account-metadata flush, closing the listener and `exit(0)`, all under a hard deadline timer. A second trigger joins the running sequence;
  - `handleShutdownSignals`: SIGINT and SIGTERM both run that sequence. SIGINT keeps its `\nShutting down...` line byte-identical.
- `server.ts`: the drain gate.
  - `ProxyServer` gains `beginDrain`, `draining`, `inFlight`, `whenIdle`, `cutInFlight` and `drainShed`.
  - While draining, every route after the Host/Origin/bearer checks is shed with 19's `shedResponse` (503 + `Retry-After`, in the endpoint's shape), except `/health` and `/`. A request still waiting for admission when the drain starts leaves the queue and is shed at once.
  - In-flight means a response that is not finished yet.
- `index.ts` (serve):
  - `MemoryGuard` and both lifecycle closures (the memory-restart closure and `stop`) are gone; serve builds the shutdown and the supervisor and wires them;
  - the signal handlers are now installed before the `listening on` line. The spawned test found that a SIGINT sent right after that line killed the proxy outright. The tip has the same race.
- `health-monitor.ts`: `MemoryGuard` removed. `requestCaptchaRecycle` is kept for 58 (now unused).
- Config: `health.memory.{softLimitMB, hardLimitMB, samples, sampleIntervalSeconds}`.
  - Every key is optional. A key left out keeps its default.
  - Ranges: 64–65536 MB for both limits, `samples` 1–20, `sampleIntervalSeconds` 1–600. The hard limit must be above the soft limit, defaults included.
  - Invalid values stop the load with what/why/next.
  - No env override, so no `proxyEnv` entry (ADR-0008 cond 6).
  - Documented, commented out, in `proxy/config.example.yaml`, `zcode-proxy-src/config.example.yaml` and the vendored `template.ts`.
- New event lines (ticket 14 format), component `supervisor`: `memory above the soft limit`, `memory back under the soft limit`, `memory above the hard limit` (`action=respawn-request`), `memory above the hard limit; no manager hook, keeps serving`, `respawn hook did not start; keeps serving`. Component `shutdown`: `started`, `drain finished`, `deadline reached; exiting`.

**Timings (decision; spec/ADRs fix only the ≤ 10 s respawn cap and leave the signal deadline to ticket 22)**
- Memory respawn: drain 6 s, deadline 10 s, the same as before.
- Signal: drain 1 s, deadline 4.5 s (drain + 3 s flush + close). This keeps it inside the manager's current 5 s SIGTERM → SIGKILL grace until ticket 22 introduces `STOP_GRACE_MS` and the shared margin.
- Drain `Retry-After` = the seconds left until the force point + 2.
- C2: a `stop` with requests in flight now waits up to 1 s for them before the flush; an idle stop exits at once (S4: 95 shutdowns, all `waitedMs` ≤ 2 when idle).

**Tests**
- `src/runtime/supervisor.test.ts` (8, injected sampler and clock):
  - soft held 3× gives one WARN in the event-line format, with no respawn and 0 solver recycles (a spy registered as the captcha runtime);
  - hard held 3× at 15/30/45 s gives exactly one request at 45 000 ms, then the graceful shutdown;
  - thresholds, sample count and interval come from config;
  - no hook: one WARN per episode, sampling continues, never a shutdown;
  - hook not started: ERROR, keeps serving, no retry within the episode;
  - adversarial: hard, hard, below-hard repeated 5× never requests a respawn;
  - adversarial: 0 samples at 14 999 ms, the 3rd sample (and the request) only at 45 000 ms;
  - `memoryFootprint` reads the footprint and falls back to RSS.
- `src/server/drain.test.ts` (5, seam 4, in-process proxy on an ephemeral loopback port, injected upstream):
  - during the drain the anthropic, openai and GET `/v1/models` requests get 503 + `Retry-After` in their shapes, never 429; `/health` answers 200 and an unauthenticated call is still 401; the accepted request completes with 200; the order is background → flush → exit; one `drain finished … cut=0 shed=3` line;
  - two open SSE streams are cut at the 300 ms force point, with one `WARN … cut=2` line;
  - adversarial: a request queued in admission at drain start is shed at once and never reaches upstream;
  - adversarial: a second trigger joins (one `started`, one `drain finished`, one exit);
  - adversarial: a flush that never returns still exits at the 600 ms deadline, exactly once.
- `src/runtime/supervisor-serve.test.ts` (2, POSIX; the real `serve` entry spawned against a loopback mock, with `--preload src/runtime/__fixtures__/egress-guard.ts` refusing and reporting any non-loopback fetch, asserted absent):
  - SIGTERM with a request in flight: a new request gets 503, the held request completes with 200, exit 0 in < 5 s;
  - SIGINT idle: the `Shutting down...` line, exit 0 in < 2.5 s.
- `src/config/loader.test.ts`: +11 (optional, values, partial block, 7 invalid values, hard ≤ soft).
- Pre-existing test change: the `MemoryGuard` describe in `src/runtime/health-monitor.test.ts` (4 tests) is deleted. It pinned what this ticket removes: a solver recycle on the soft limit, 1536/3072 MB RSS and the `[memory] …` lines. Its no-hook and failed-hook cases are covered by the new supervisor tests. No other existing test changed.
- Wiring: `bun test` discovers every `*.test.ts` under `zcode-proxy-src` (proxy 93 → 96 files). The fixture sits under `__fixtures__/`, which the payload excludes (`pack/build.mjs`).

**RED → GREEN** (logs in the integration worktree's `reports/`)
- `t21-red1` (supervisor module missing) → `t21-green1` 8/8.
- `t21-red2` (loader, 11 fail) → `t21-green2` 56/56.
- `t21-red3` (`createGracefulShutdown` missing) → `t21-green3c` 13/13.
- Behavioural RED on the tip: the spawned serve test copied into a detached `e88821f` worktree (`/home/AgentKit/overhaul-tools/t21-tip`, files removed after; status clean), `t21-red-tip-serve`, failed 2/2. With SIGTERM the in-flight request got `ECONNRESET`; with SIGINT there was no drain. The egress guard was preloaded: no RED run could reach a real host, and none tried (no `EGRESS-BLOCKED` line).
- GREEN on the branch: `t21-green4b-{1,2,3}` 2/2 three times.
- Mutation run (`t21-mutants`, `/home/AgentKit/overhaul-tools/t21-scripts/mutants.py`, on the committed `9961d3b`; each mutant restored with `git checkout 9961d3b -- <file>`, `git status` clean after). 17 of 18 killed:
  - M1 soft recycles the solver;
  - M2 hard after samples − 1;
  - M3 the hard streak survives a below-hard sample;
  - M4 the interval ignores config;
  - M5 no hook still shuts down;
  - M6 soft WARN after 1 sample;
  - M7 a refused hook is retried within the episode;
  - M8 always RSS;
  - M9 the drain closes the listener;
  - M11 queued requests are not shed at the drain;
  - M12 no drain window;
  - M13 the cut is not counted;
  - M14 no deadline;
  - M15 a second trigger starts a second sequence;
  - M16 flush before the drain;
  - M17 signals wired to the old `server.stop(true)`;
  - M18 the drain sheds `/health` too.
- **M10 (no route-level drain check) survived.** Body routes are already shed through the admission path. `15adb27` adds a GET `/v1/models` shed assertion; after it M10 is killed (`t21-mutants-m10`, restored from `15adb27`).

**Full suites after the merge** (Bun 1.4.2, Node 26.7.0)
- `npm run test` (`t21-full-kit`): 837 tests, 818 pass, 0 fail, 19 skipped.
- `npm run test:proxy` (`t21-full-proxy`): 1435 pass, 0 fail, 96 files (1413 + 26 new − 4 removed). `npm run test:proxy-typecheck`: clean.
- `npm run test:mcp` (`t21-full-mcp`): 97 tests, 96 pass, 0 fail, 1 skipped; `dist/` unchanged.

**Memory loop, linux, short profile** (`node tests/memory/job.mjs --only S1/burst1,S1/burst4,S1/burst16,S1/burst32,S1/bigbody,S4/short --cap systemd`, port 19210/19213; before = detached tip `e88821f`, after = detached `9961d3b`; run dirs `/home/AgentKit/overhaul-tools/t21-memloop/{before,after}/`). In both runs the ratchet holds.

| run | before | after | budget | note |
|---|---|---|---|---|
| S1/burst1 (median of 7) | 187.7 | 186.8 | 250 | GREEN both |
| S1/burst4 | 357.5 | 324.3 | 250 | RED both (owner 20) |
| S1/burst16 | 478.0 | 494.0 | 400 | RED both (owner 20) |
| S1/burst32 | 542.3 | 515.1 | 600 | GREEN both (listed, `flips`, owner 20) |
| S1/bigbody | 340.6 | 366.4 | 250 | RED both (owner 20) |

The single-run differences are inside the run-to-run spread ticket 19 measured (burst16 428–525, bigbody 330–375): 21 does not touch the request-body path.

S4/short, before → after:
- `stale-lock-after-ctrl-c` 5/8 → 5/8 and `respawn-recovers-despite-stale-lock` 0 → 0, RED both (owner 17);
- `unstoppable-proxy-after-ctrl-c` 1/8 → 0/8. It is listed with `flips` for 17 on linux, so this is not claimed;
- unchanged: `count:proxy` 1, orphans 0, `proxy-left-after-stop` 0, failed steps 0, respawns 3/15 min (no storm), 1 log file.

In the after runs `proxy.log` shows 95 `shutdown started reason=signal`, every `drain finished` with `cut=0`, and no `supervisor` line (no S1 run lasts 30 s).

**Round 18: the proxy footprint the supervisor samples, per leg, S1 burst runs**
- hold3 = the highest level held by 3 samples 15 s apart at any phase: max over t of min(f(t), f(t+15 s), f(t+30 s)), from the loop's 1 s samples.
- Peak bound = VmHWM on linux and PeakPageFileUsage (the commit high-water mark) on windows. It bounds the footprint at every instant, between samples too. On linux the footprint (Pss) ≤ RSS ≤ VmHWM.
- Linux "this tree" additionally has Pss itself, sampled every 1 s by `/home/AgentKit/overhaul-tools/t21-scripts/pss-poll.mjs` from `smaps_rollup`, which is the source `memoryFootprint()` reads.
- Windows: the commit charge is the footprint itself. This tree has no windows run yet (pending CI). The 10 staging/19 CI runs (ticket 19's evidence, artefacts `/home/AgentKit/overhaul-tools/ci-art/t19r2/`) have a byte-identical request path; 21 adds only the drain, which does not run during a burst.
- Script: `/home/AgentKit/overhaul-tools/t21-scripts/footprint-hold.mjs`.

| leg | key | source (runs) | max footprint sampled | max hold3 | max peak bound | holds ≥ 1024 × 3? |
|---|---|---|---|---|---|---|
| linux | S1/burst1 | this tree (7) | Pss 177.8 | n/a (run 16 s) | 189.3 | no |
| linux | S1/burst4 | this tree (1) | Pss 195.2 | n/a (20 s) | 324.3 | no |
| linux | S1/burst16 | this tree (1) | Pss 360.0 | n/a (23 s) | 494.0 | no |
| linux | S1/burst32 | this tree (1) | Pss 361.4 | n/a (30 s) | 515.1 | no |
| linux | S1/bigbody | this tree (1) | Pss 296.9 | Pss 121.7 | 366.4 | no |
| linux | S1/burst32 | staging/19 CI (10) | RSS 506.4 | n/a | 612.2 | no |
| linux | S1/burst16 | staging/19 CI (10) | RSS 442.3 | n/a | 520.8 | no |
| linux | S1/bigbody | staging/19 CI (10) | RSS 238.5 | RSS 219.0 | 283.6 | no |
| windows | S1/burst1 | staging/19 CI (70) | commit 335.9 | n/a | 347.0 | no |
| windows | S1/burst4 | staging/19 CI (10) | commit 424.3 | n/a | 517.0 | no |
| windows | S1/burst16 | staging/19 CI (10) | commit 465.5 | n/a | 570.1 | no |
| windows | S1/burst32 | staging/19 CI (10) | commit 535.7 | n/a | 594.6 | no |
| windows | S1/bigbody | staging/19 CI (10) | commit 424.8 | commit 255.9 | 445.1 | no |

The footprint cannot hold at or above 1024 MB for 3 samples on either leg:
- the any-instant maximum is 612.2 MB (linux RSS) and 594.6 MB (windows commit), more than 400 MB under the hard limit;
- the burst runs end before a third sample 30 s after the first could fall.

So 21 does not come back on the hard limit. The soft limit: windows commit peaks above 512 in burst16/burst32 (570.1/594.6), and Pss stays under 512 on linux in this tree. Only a cap-saturating load held for 30 s would WARN, which matches Round 18's expectation. **Windows on this tree: pending CI** (the same script over the `memory-budget-windows` artefacts).

**Release-notes item for 54 (proposed sentence):** "Proxy memory health: the health supervisor now samples the proxy's memory footprint (commit charge on Windows, Pss on Linux) instead of RSS, with thresholds 1536/3072 MB → 512/1024 MB, each held for 3 samples 15 s apart (config `health.memory.*`). The soft limit only logs a WARN; it no longer recycles the captcha solver. The hard limit asks the kit manager for a respawn (budget unchanged, 3 per 15 min). During the drain before a respawn or stop the proxy keeps its port open, answers new requests with 503 + Retry-After and lets running requests finish; responses still open at the force point are cut and counted in the log."

**Decisions taken (spec/ADRs silent)**
1. The soft limit is also held for `samples` samples (ADR-0008: "each held for 3 samples"). It WARNs once per episode; an episode ends with a sample at or under the soft limit.
2. A no-hook or refused respawn is not retried within the episode (today's rule). Ticket 23 replaces this with one hook per budget window.
3. The handoff point is today's confirmation (the hook process started). 23 swaps `RespawnHandoff.request` for the acknowledgement wait without touching the supervisor's policy.
4. The signal timings are as above (1 s / 4.5 s); ticket 22 moves them to `STOP_GRACE_MS` and the shared module.
5. `/health` keeps answering during the drain (hung-proxy detection); every other route is shed after authentication. Drain sheds are counted in the `drain finished` line (`shed=`), not in admission's `shedTotal`, and get no per-request line.
6. Config path `health.memory`, interval in seconds, ranges as listed, no env override.
7. TUI and Android entries are unchanged: the TUI has no supervisor and keeps its own quit. "No hook → log and keep serving" is what any proxy without the manager's hook env does.

**Left for other tickets:**
- 22: `shutdown.run("stop")` from `/__kit/stop` with the shared deadlines.
- 23: the acknowledgement in `RespawnHandoff`, and one hook per window.
- 39: `/health` `memory[]` can read `supervisor.memory()` (last sample, cached) and `ProxyServer.draining()`.
- 58: `requestCaptchaRecycle` is still there for footprint-based solver recycling.

**Pending CI (orchestrator verifies after merge+push)**
- [ ] ubuntu `memory-budget`: ratchet holds (S1 bursts as listed for 20, S4/short as listed for 17).
- [ ] windows `memory-budget`: ratchet holds. Run `footprint-hold.mjs` over the leg's artefacts to fill this tree's windows rows; expected under 1024 as on staging/19.
- [ ] `test-kit` and the proxy legs green on ubuntu/windows × Node 24/26. `supervisor-serve.test.ts` skips on windows; `drain.test.ts` and `supervisor.test.ts` run there.

**Addendum (same day): ticket 15 landed during the work.**
- The integration tip moved to `a3959cc` (ticket 15, the proxy lifecycle module). I merged it into this branch (`47e599a`, clean, no conflicts). The lifecycle keeps the 5 s SIGTERM → SIGKILL escalation (`lib/proxy-lifecycle.mjs` `killOwned`), so the 4.5 s signal deadline still fits.
- Suites on `47e599a`:
  - `npm run test` (`t21-full2-kit`): 852 tests, 833 pass, 0 fail, 19 skipped;
  - `npm run test:proxy` (`t21-full2-proxy`): 1435 pass, 0 fail, 96 files; typecheck clean;
  - `npm run test:mcp` (`t21-full2-mcp`): 96/97, 1 skipped, 0 fail; `dist/` unchanged.
- Memory loop on `47e599a` (`--only S1/burst32,S4/short`, port 19214, `/home/AgentKit/overhaul-tools/t21-memloop/after-merge/`): the ratchet holds.
  - S1/burst32: 622.3 MB, RED; it is listed with `flips` for 20. Footprint: Pss peak 559.8, VmHWM 622.3, hold3 n/a (30 s run). Under 1024 by 400 MB; this is the highest linux bound seen in this ticket.
  - S4/short: identical to the tip except `unstoppable-proxy-after-ctrl-c` 1/8. It was 0/8 in the earlier after-run and 1/8 on the tip, which confirms it flips and is not attributable to 21.
  - 85 graceful shutdowns, all `cut=0`; no supervisor line.
