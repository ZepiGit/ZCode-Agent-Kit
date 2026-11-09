# 23: Respawn acknowledgement before drain (a refused respawn leaves the proxy serving)

**Blocked by:** 17 (Start-lock release on signals, orphan adoption, respawn over a proven-stale lock), 18 (Per-spawn proxy environment: stop token and log dir set by the manager, token stripped from the respawn hook), 21 (Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0015, 0008

**What to build:** On a memory respawn the proxy spawns the hook with unchanged arguments and waits up to 10 s for a `respawn.json` event with `pid === process.pid` and `at` > request time; hook exit 4 is an immediate refusal; afterwards the hook is unref'd. On refusal or no acknowledgement it keeps serving, logs ERROR once, reports `restarts` exhausted and spawns at most one hook per budget window. The watchdog path waits ≤ 10 s, then self-terminates and logs the outcome. Old proxies with a new manager keep today's behaviour (documented).

**Acceptance criteria:**

- [ ] Seam 2/4 tests: ack → drain; exit 4 → keep serving + one ERROR; no ack → keep serving; late ack → "already running, 0", exactly 1 proxy, slot consumed; backwards clock jump → keep serving; watchdog path bounded at 10 s.
- [ ] Loop: induced memory pressure → ≤ 3 restarts / 15 min and exactly 1 proxy at every sample.
- [ ] With the hard condition persisting over two budget windows and every respawn refused, exactly one hook is spawned per window (injected clock, spawn counter) (Story 50).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 49, 50, 51, 53

## Comments

### 2026-11-09 implementer report (round 1)

**Branch:** `ticket/23-respawn-ack-before-drain` (worktree `/home/AgentKit/wt/t23`), from `overhaul/stability-terminal-ux` @ 278d329. Commits: `5b43b46` (implementation and tests), `bc04b40` (merge of the integration tip e01327b, docs only), `43ebbca` (lighter load in the S4 pressure phase). The head is the commit that adds this comment.

**What changed**
- `zcode-proxy-src/src/runtime/watchdog.ts`: `awaitRespawnAcknowledgement` spawns the hook with unchanged arguments (`respawn <pid> --reason <r>`, env without the stop token via `hookEnvironment`) and waits at most `RESPAWN_ACK_WAIT_MS` = 10 s. A `respawn.json` event with `pid === process.pid` and `at` > the request time (wall clock taken right before the spawn) is `acknowledged`. Hook exit 4 is `refused` at once. Any other exit without the event is `no-acknowledgement` at once (the file is read once more at the exit). A timeout is also `no-acknowledgement`, and a spawn failure is `hook-failed`. The hook handle stays referenced during the wait (its `exit` is watched) and is unref'd when the wait ends. The function is self-contained, so the watcher worker embeds it.
- Watchdog path (hung main thread): with `ZCODE_KIT_LOG_DIR` the watcher waits for the same answer (≤ 10 s, backstop timer at 12 s), then SIGKILLs itself regardless and writes one event line `… watchdog respawn handoff ended; terminating outcome=<o> waitedMs=<n> [hookExit=<c>]` (INFO when acknowledged, ERROR otherwise). Without the logs dir it keeps today's 2 s spawn confirmation.
- `zcode-proxy-src/src/runtime/supervisor.ts`: `RespawnHandoff.request` now resolves a `RespawnAnswer` `{ outcome, confirmed, waitedMs, exitCode? }`. Only `confirmed` drains (INFO `respawn confirmed; draining`). On refusal, no acknowledgement or a hook that did not start, the proxy keeps serving. It writes one ERROR event line per request (`respawn refused by the kit manager; keeps serving` / `respawn not acknowledged by the kit manager; keeps serving` / `respawn hook did not start; keeps serving`, each with `outcome= waitedMs= [hookExit=] restarts=exhausted retryInS=900`). `memory()` reports `respawnOutcome`, `restartsExhausted` and `respawnRetryAt`. No further hook is spawned until `RESPAWN_BUDGET_WINDOW_MS` (15 min) after that request, however often the condition comes back. A later episode inside the window logs one WARN `memory above the hard limit; restart budget exhausted, keeps serving restarts=exhausted retryInS=…`.
- `lib/proxy-lifecycle.mjs`: exports `RESPAWN_WAIT_MS` = 30 000 (the default of `respawnWaitMs`, used by `proxy/zcode-proxy-manager.mjs` too). Comment: the reservation event is the cross-version acknowledgement contract, and the old-proxy gap is documented there.
- Docs: the `health:` comment in `proxy/config.example.yaml`, `zcode-proxy-src/config.example.yaml` and `template.ts` now says the proxy drains only after the acknowledgement and keeps serving on a refusal. There are no new config keys and no new env overrides.

**Tests (all at the seams named in the ticket)**
- Seam 4, `respawn-ack.test.ts` (new, 10 tests, real hook processes, a real logs dir): ack → `acknowledged` with unchanged hook argv; exit 4 → `refused` in < 5 s with the default 10 s wait; silent hook → `no-acknowledgement` after the wait, hook still alive; adversarial: `at` 60 s before the request (backwards clock jump), an earlier event for the same pid, an event for another pid / corrupt file / non-numeric `at` → no acknowledgement; ack 1 s after a 0.5 s wait → still `no-acknowledgement`; missing hook executable → `hook-failed`; no `ZCODE_KIT_LOG_DIR` → `started` (today's handoff); unref: a Bun process whose only remaining work is the answered request exits at once while its detached hook lives on.
- Seam 4, `supervisor.test.ts` (6 new tests, the REAL `managerRespawnHandoff` with an injected spawn that counts hooks and an injected clock): ack → one shutdown; exit 4 and no ack → keep serving, exactly one ERROR event line with `restarts=exhausted retryInS=900`, state exhausted, still sampling; **two budget windows with every respawn refused → hooks at exactly 45 s and 945 s (one per window), the third at 1 845 s, not earlier (Story 50)**; adversarial: the condition coming and going 12× inside the window → 1 hook, 1 ERROR, 11 WARNs; the exhausted report ends with the window, and an acknowledged retry then drains.
- Seam 4, `watchdog.test.ts` (3 new child-process tests): ack → INFO outcome line, killed < stall + 6 s; exit 4 → ERROR `outcome=refused`, killed at once; silent hook with the default wait → `outcome=no-acknowledgement waitedMs` in [9 900, 10 500), killed within stall + 16 s.
- Seam 2, `tests/proxy-lifecycle.test.mjs` (3 new tests). The stand-in proxy runs this checkout's real supervisor + handoff under induced pressure, spawned by the real manager, and its hook is the fixture's real manager CLI:
  - (a) induced memory pressure: 3 acknowledged respawns drain and restart, the 4th is refused (`respawn refused: 3 restarts in 15 min`, hook exit 4) and the proxy keeps serving: never 2 stand-ins at any sample, exactly 1 serving proxy at each of 12 samples after the refusal, `respawn.json` holds 3 events, 4 hook requests and no further one, one ERROR line;
  - (b) late acknowledgement: proxy ack wait 1.5 s, the real manager starts 3 s late. The proxy logs `respawn not acknowledged`, the manager reserves (slot consumed: 1 event for that pid), waits 30 s and ends with `already running (pid N)`, exit 0. Exactly 1 proxy at every sample, the same pid, no drain;
  - (c) timing invariant: `RESPAWN_WAIT_MS` 30 000 > `RESPAWN_ACK_WAIT_MS` 10 000 + `SHUTDOWN_TIMING.memory.deadlineMs` 10 000 + 2 000 margin (proxy constants read by Bun from the proxy's modules, the manager's from `lib/proxy-lifecycle.mjs`).
- Seam 1, loop key **`S4/short`**, a new last phase "memory pressure" with checks `pressure:refusal-reached`, `pressure:restarts-in-window` (≤ 3), `pressure:max-proxies` (≤ 1), `pressure:serving-proxy-after-refusal` (0 samples of 40 without exactly one healthy proxy), `pressure:hooks-after-refusal` (0) and `pressure:error-lines` (1). The real proxy, started by the real manager, has `health.memory` soft 64 / hard 65 MB × 3 samples 2 s apart and one ~5.4 MB request at a time as load; its footprint is 100–106 MB. This states the loop key that DECISIONS (Round 15 Q1 notes) left open for 23. The phase's lines are read after a marker line in `proxy.log` (with `proxy.log.1`), because the storm phase earlier in S4 logs the same refusal text.

**RED → GREEN** (RED = the same test files on a detached copy of the integration tip 278d329, `/home/AgentKit/overhaul-tools/t23-tip`):
- Proxy: `respawn-ack` 10/10 fail, `supervisor` 7 fail (the 6 new tests and the changed one), `watchdog` the 3 new tests fail (no outcome line). In total 20 fail and 20 pass (`reports/t23-red-tip.log`). On the branch all 40 pass.
- Kit seam 2: 3/3 fail on the tip. In (a) the tip's 4th proxy logs `stand-in drained` right after `respawn refused: 3 restarts in 15 min`, so no proxy is left (`reports/t23-red-tip-pressure.log`). On the branch all 3 pass (`reports/t23-b2.log`).
- Loop S4/short with the final scenario: tip **RED**, `pressure:serving-proxy-after-refusal` 40 of 40 samples without a healthy proxy and `pressure:error-lines` 0 (`reports/t23-loop-s4-tip-light.log`). Branch **GREEN**: 40/40 serving, 3 restarts, 0 hooks after the refusal, 1 ERROR line (`reports/t23-loop-s4-light.log`, and `t23-loop-s4-head.log` on the merged head with the heavier first load). Every other S4 check is unchanged and GREEN on both.
- Mutation proof (commit 5b43b46, `reports/t23-mutants.log`, restored with `git checkout 5b43b46 -- <file>`, `git diff` empty afterwards). Each mutant fails its tests:
  - M1, no unref after the wait: the unref test fails;
  - M2, `at > requestTime` dropped: both clock tests fail;
  - M3, exit 4 not a refusal: the refusal test fails at 10 s;
  - M4, no budget-window gate: 3 window tests fail;
  - M5, drain on any answer: 5 tests fail;
  - M6, watchdog wait 30 s: the bounded test fails.

**Suites on the merged head (bc04b40 + 43ebbca, which changes only the loop scenario):**
- `npm run test`: 1 022 tests, 1 002 pass, 0 fail, 20 skipped;
- `npm run test:proxy`: 1 652 tests in 111 files, 1 651 pass, 1 skip, 0 fail;
- `test:proxy-typecheck`: clean;
- `npm run test:mcp`: 116 tests, 115 pass, 1 skipped, 0 fail; `dist/` is unchanged by the build.

**Metrics delta:** S4/short gains the pressure phase. The proxy role peak in S4 is 114.2 MB on the branch and 115 MB on the tip with the same scenario. The first, heavier load (4 × 10.8 MB) peaked at 229 MB. It was replaced so that the windows leg stays far below its 512 MB commit backstop (S1/burst4's shape once reached 561.6 MB commit). An S4/short run takes 250–253 s locally. No expected-red entry belongs to 23, so none was removed.

**Pre-existing tests changed (justification):**
- `supervisor.test.ts` harness: `request` returns a `RespawnAnswer` instead of a boolean, because the handoff interface now carries the manager's answer.
- The test "a respawn hook that does not start … is not retried within the episode" is now "… not retried within the budget window, not even in a new episode". Its old last step expected a second hook in a new episode about 2.5 min later. Story 50 / ADR-0015 cond 6 forbid exactly that ("at most one hook per budget window"), so the step now expects no hook inside the window and one after it.
- `watchdog.test.ts`: the child script accepts an optional `ACK_WAIT_MS` (additive); the existing assertions are unchanged.

**Decisions taken (spec silent):**
- A hook that exits with a code other than 4 without the event counts as `no-acknowledgement` at once. Waiting on would only read a file nobody writes any more.
- With hook variables but no `ZCODE_KIT_LOG_DIR` (a manager older than ADR-0015 spawned a new proxy), the hook's start confirms, as before (outcome `started`). The watchdog keeps its 2 s spawn wait there.
- The budget window counts from the request that was not confirmed, and it applies across episodes. A later episode inside the window only WARNs once.
- "Reports `restarts` as exhausted": `restarts=exhausted` in the ERROR line (and in the WARN of later episodes), plus `memory().restartsExhausted / respawnRetryAt / respawnOutcome`. The `/health` and `status` field `restarts { last15m, budget }` (ticket 39) and the `restart budget` doctor check (ticket 41) are left to those tickets, which are blocked by 23. They can read this state.
- "Exactly 1 proxy at every sample" (loop): never more than one at any sample during the phase, and exactly one healthy at every sample from the refusal on. During an acknowledged respawn the manager waits for the old proxy's exit before it starts the next one, so the hand-over has a short gap by design.
- `STOP_EXIT_MARGIN_MS` does not exist yet (ticket 22). The timing test uses a literal 2 000 ms margin. Ticket 22 should switch it to the shared constant and to `STOP_GRACE_MS`; that test is the place to do it.
- The watcher worker formats its one event line inline: an eval'd worker cannot load `log/event-line.mjs`, and every value is a plain token.

**Left for others / observations:**
- Windows legs (fast suite and `memory-budget` S4/short with the new `pressure:*` checks): pending CI (orchestrator verifies after merge+push).
- Ticket 22 touches the same stop path: the acknowledgement code is local to `watchdog.ts` / the supervisor's hard-limit branch, and `SHUTDOWN_TIMING.memory` is read but not changed.
- Possible, not observed: with very low `health.memory` settings, a fresh proxy could request a respawn before the manager that started it has finished its start. That manager could then see it exit and remove its record, and the second hook would refuse with `record changed`. With the defaults (3 × 15 s) this is far outside the start time. The seam 2 stand-in starts its pressure only after its start finished, and the loop phase holds 3 × 2 s.
