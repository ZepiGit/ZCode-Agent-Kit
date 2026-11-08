# 24: Solver transport seam (prefactor): dispatcher state as an object, thread transport adapter

**Blocked by:** 12 (Batch 2 — proxy dependencies: happy-dom 21.0.4 (loading flags kept), undici 8.12.4, yaml 2.9.1)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0002

**What to build:** The dispatcher interface (`runCaptchaSolve`, stats, recycle request, shutdown) and message protocol stay; module-level state becomes an object owned by the deep module; the current Worker moves behind a transport seam as the thread transport. No behaviour change.

**Acceptance criteria:**

- [ ] `captcha-solver` suite with fixture backends passes unchanged through the seam (seam 3); `captcha-pool` no longer needs `mock.module` for the solver.
- [ ] S2 per-generation HWM and retained MB within ±10 % of the preceding run on the same leg (loop).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 17

## Comments

- 2026-11-08 (implementer, branch `ticket/24-solver-transport-seam`; implementation 8e70e71, integration tip c3f5464 merged in c209809; the head SHA is in the final report).
  - **What changed (B1: no behaviour change).** `captcha-solver.ts`: the dispatcher's module-level state (queue, in-flight solve, generation, idle/deadline timers, pending recycle, stats, options) now lives in the object `createCaptchaSolver({ transport })` returns. The Bun Worker moved behind `SolverTransport` (`spawn(events) → { post, terminate }`; events `message`/`error`/`exit`) as `threadTransport()`. The init/solve/result/fatal protocol, `parseWorkerMessage`, recycle reasons, thresholds, deadline, error texts and categories, the worker env snapshot (`{ ...process.env }`), `unref()` and `WORKER_URL` are unchanged. An indentation-insensitive diff of old vs new module shows only the Worker calls swapped for `transport.spawn`/`post`/`terminate` and `configure` moving into the object. The module-level functions (`configureCaptchaSolver`, `runCaptchaSolve`, `getCaptchaSolverStats`, `requestCaptchaSolverRecycle`, `shutdownCaptchaSolver`, `captchaSolverConcurrency`) delegate to `defaultCaptchaSolver` over the thread transport, so `captcha.ts`, `health-monitor.ts`, `index.ts` and the S2 body are untouched. `CaptchaTokenPool` takes an optional second constructor argument (its dispatcher, default `defaultCaptchaSolver`).
  - **Captcha suites (all 13 `src/proxy/captcha-*.test.ts`), first and last:** tip 133 pass / 0 fail, 866 expect() (`reports/t24-captcha-before.log`); branch 133 pass / 0 fail, 866 expect() (`reports/t24-captcha-after.log`). Count unchanged.
  - **Full suite at the merged head:** `npm run test` 816 tests, 797 pass, 0 fail, 19 skipped; `npm run test:proxy` 1391 pass, 0 fail, 93 files (tip 1384 / 92 files: +7 tests in the new file); `test:proxy-typecheck` clean; `npm run test:mcp` 97 tests, 96 pass, 0 fail, 1 skipped; `mcp/zcode-harness-mcp/dist/` unchanged after the build; `bun build --compile --target bun-linux-x64` with the worker entrypoint: 657 modules, ok.
  - **RED → GREEN.** New seam-3 file `src/proxy/solver-transport.test.ts` (7 tests, auto-discovered by `bun test`; deliberately not named `captcha-*` so the 13-suite count stays comparable). On the tip it fails at import (`Export named 'createCaptchaSolver' not found`, `reports/t24-red-transport.log`); GREEN on 8e70e71. `captcha-pool.test.ts` with `mock.module` removed and the fake dispatcher injected: on the tip 8 pass / 16 fail (the pool ignores the injected dispatcher, `reports/t24-red-pool.log`), GREEN on 8e70e71 (24 pass). Note: that RED run sent the 16 failing pools' solves through the real thread transport and `captcha-happy` (the tip has no injection point), so it may have attempted vendor CDN fetches. No credentials were involved and it was not repeated.
  - **Preservation by mutation** (`/home/AgentKit/overhaul-tools/t24-scripts/mutation-run.sh`, each mutant applied to the committed file and restored with `git checkout 8e70e71 -- …`, `git diff` empty after each; `reports/t24-mutation.log`): M1 worker env `{}` → "a solver generation sees the proxy's environment as it was at spawn" fails; M2 init message key order → the byte-for-byte protocol test fails; M3 recycle without `terminate()` → 2 fail (protocol test, deadline-kill test). The existing `captcha-solver` suite does **not** catch M3; finding for 27/58. M4 stats hoisted to module level (shared between dispatchers) → 5 fail.
  - **Memory, Linux S2/short** (`node tests/memory/job.mjs --only S2/short`, systemd cap, Node 26.7.0, Bun 1.4.2; base = clean detached worktree `/home/AgentKit/wt/t24-base` at 6a8eeff; runs alternated; run dirs `/home/AgentKit/overhaul-tools/t24-memloop/`):

    | run | cost per generation (MB) | procPeak:scenario (MB) | retained before recycle (MB) | growth %/1k | hang (MB) | CDN (MB) | cold start (ms) |
    |---|---|---|---|---|---|---|---|
    | base-1 | 1120.4 | 1149.9 | 687 | −47.51 ok | −5 | 151 | 195 |
    | base-2 | 946.3 | 973.7 | 690 | −18.91 ok | −5 | 151 | 140 |
    | t24-1 | 1007.6 | 1040.6 | 689 | −7.34 ok | −5 | 151 | 132 |
    | base-3 | 1027.3 | 1053.3 | 689 | 0.52 ok | −4 | 150 | 134 |
    | t24-2 | 1011.7 | 1045.6 | 688 | −16.34 ok | −4 | 151 | 131 |
    | t24-3 | 1057.6 | 1082.5 | 688 | 2.8 ok | −4 | 151 | 199 |
    | base-4 | 1106.4 | 1157.5 | 689 | −5.59 ok | −4 | 151 | 138 |

    Medians: cost per generation base 1066.9 / branch 1011.7 MB (−5.2 %, ranges overlap: 946–1120 vs 1008–1058); retained base 689 / branch 688 MB (−0.1 %). Each branch run is within ±10 % of the base run before it (+6.5 %, −1.5 %, and −4.4 % against the base run after it). 0 solver processes after the idle exit and after the host SIGKILLs, as before (thread transport). Ratchet holds on all 7 runs. `expected-red.json` not edited (S2/short stays for 25 and 58).
  - **Common acceptance:** no new log events, config keys or env overrides. The new test file runs in `npm run test:proxy` (bun discovers `*.test.ts`; the wiring guard covers `tests/*.test.mjs`). Pre-existing test changes: `captcha-pool.test.ts` header only. The `mock.module("./captcha-solver.js")` block became a fake dispatcher object and a local `CaptchaTokenPool` subclass that injects it; every test body is byte-identical (criterion 1 requires the removal). Fixture `__fixtures__/solver-backend.ts` gained one scene, `env:<NAME>`. The ubuntu/windows `test-kit` and `memory-budget` CI legs are **pending CI (orchestrator verifies after merge+push)**.
  - **Decisions:** (1) the dispatcher is a closure-backed object (`createCaptchaSolver`), not a class, to keep the function bodies textually identical; (2) the transport carries `SolverHostMessage` objects and leaves serialization to the adapter (structured clone for the thread; 27's IPC adapter must keep the JSON bytes the protocol test pins); (3) no clock injection was added (not needed here; 27/58 add it when their tests need it); (4) `stats().mode` stays `"worker"` (28 adds the enforcement mode).
  - **For other tickets:** 27 implements `SolverTransport` for the child process and switches `defaultCaptchaSolver` to it. The transport contract is: events are asynchronous, never from inside `spawn`/`post`, and are ignored after `terminate`. The `handler-resilience.test.ts` header comment still says `mock.module` is "the same technique as captcha-pool.test.ts"; left unchanged (pre-existing test file, comment only).
