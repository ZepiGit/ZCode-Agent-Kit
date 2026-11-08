# 26: Captcha egress routing under Bun

**Blocked by:** 12 (Batch 2 — proxy dependencies: happy-dom 21.0.4 (loading flags kept), undici 8.12.4, yaml 2.9.1)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: —

**What to build:** On Bun, captcha fetches (`captchaFetch` and the sync-XHR worker path) use `proxy: <ZCODE_PROXY_UPSTREAM_PROXY> ?? false`; Node keeps the dispatcher. Routing only; what is fetched does not change.

**Acceptance criteria:**

- [ ] Seam 3 test with a local recording proxy (Round 19): setting set → all captcha egress (`captchaFetch` http, sync-XHR, https CONNECT) goes through it and the ambient proxy receives nothing; setting invalid → all three fail closed and no listener receives anything; setting unset with ambient `HTTP(S)_PROXY` set → no proxy used, a plain test on Bun ≥ 1.4.3 and declared `it.failing` on Bun < 1.4.3 with that condition in the test name (gate `>=1.4.3`, never moved). On the pinned Bun 1.4.2 the unset-case guarantee is delivered by ticket 27 (solver child environment without ambient proxy variables).

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 130

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 19, binding): closes on the amended criterion; the unset case on Bun 1.4.2 moves to ticket 27; suite counts include 1 declared-failing case on 1.4.2; the test name carries the version condition.

### 2026-11-08: implementer (substitute for glm; the glm worker has no provider)

**Branch:** `ticket/26-captcha-egress-bun` (worktree `/home/AgentKit/wt/t26`), created on the integration tip `96b79c3`. Commits:
- `58d3935` fix(proxy): route captcha egress through Bun's proxy option;
- `67dbb27`: merge of the integration tip `482eef5` (clean; no proxy source or lockfile changes came in).

The head SHA is the commit that adds this comment. Ticket 24 (solver transport seam) has not landed on the integration branch, so nothing of it was merged. The ticket changes only `captcha-happy.ts`, which 24 does not touch.

**Change (B1: routing only):**
- `captchaFetch`: on Bun it now calls `fetch(input, { ...init, proxy: ZCODE_PROXY_UPSTREAM_PROXY ?? false })`. The Node path is byte-identical: `dispatcher: ProxyAgent` when set, plain `fetch` when unset.
- Sync-XHR worker source: on Bun the route is `{ proxy: m.proxyUrl ?? false }`. On Node it is the unchanged `ProxyAgent` dispatcher.
- The URL, method, headers, body, `redirect`, signal and timeout are untouched, and so are the interceptor, allowlist, fingerprints and challenge handling.
- `captchaFetch` and `syncFetchBlocking` are now named exports. They are the test seam, and the solve path uses them exactly as before.
- No new log events, config keys or env overrides. `ZCODE_PROXY_UPSTREAM_PROXY` is already on the `proxyEnv` exception list.
- C6: no new endpoints.

**Finding: `proxy: false` is a no-op on the pinned Bun 1.4.2.** Probed with loopback mocks (`/tmp/t26-scripts/probe2.mjs`, `reports/t26-probe2.log`), with ambient `HTTP_PROXY` set:
- on 1.4.2, `proxy: false`, `""`, `null` and `undefined` all still go through the ambient proxy;
- on 1.4.3 and 1.4.4, `proxy: false` goes direct;
- an explicit `proxy: <url>` is honoured on all three.

A worker-scoped env change does not help on 1.4.2 (`probe3.mjs`, `reports/t26-probe3.log`): deleting `HTTP(S)_PROXY`, setting `NO_PROXY=*` in the worker, or a stripped `env` option all leave the worker's fetch on the ambient proxy. Bun reads the process-level environment. Only a main-thread `process.env.NO_PROXY` takes effect, and that would reroute the proxy's own upstream LLM traffic (out of scope: B1/C2). So on 1.4.2:
- the configured proxy is now honoured, which fixes the banner's "explicit proxy" claim;
- an unset setting with ambient `HTTP(S)_PROXY` still leaks through the ambient proxy until the pin moves to ≥ 1.4.3 (ticket 62). The managed proxy is not exposed, because `lib/proxy-env.mjs` strips the ambient variables. Only a standalone proxy started from a shell with proxy variables is.

A future child-process solver transport could also close this on 1.4.2 by stripping the ambient variables from the child's environment. Ticket 24 provides only the seam for that.

**Tests** (seam 3, egress routing; new `describe` in the existing `src/proxy/captcha-egress.test.ts`, so there is no new file and the wiring is unchanged):
- Each scenario is a child Bun process with its own environment, because the setting is read at module load, as in the solver worker.
- The parent runs everything on loopback, on ephemeral ports (port 0, the repo convention; the kernel's ephemeral range 32768–60999 cannot collide with the 19xxx ticket ranges):
  - two recording proxies ("configured", "ambient"). They answer absolute-form requests themselves and refuse every CONNECT with 403, so nothing is ever forwarded or tunnelled;
  - a plain HTTP target;
  - a raw TCP stand-in for an https origin.
- Inherited `*_proxy` variables are stripped from the child.
- Each scenario sends one request on each route: `captchaFetch` (http), `syncFetchBlocking` (http), and `captchaFetch` (https, which goes as CONNECT through a proxy).

The three scenarios:
1. `sends every captcha request through the configured proxy, not the ambient one` (set + ambient `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`): the configured proxy records exactly `CONNECT`, `GET …/fetch` and `GET …/sync-xhr`; the ambient proxy and the targets record nothing.
2. `goes direct when the setting is unset, even with ambient HTTP(S)_PROXY`: the targets record all three requests and the ambient proxy records none. This is a plain test on Bun ≥ 1.4.3. On 1.4.2 it is declared `it.failing` (semver gate), so it turns into a plain test automatically when ticket 62 moves the pin.
3. `fails closed on an invalid configured proxy instead of taking another route` (adversarial): the guarantee is "no undeclared route". With `ZCODE_PROXY_UPSTREAM_PROXY=not a proxy url` and ambient proxies set, no listener records anything and all three requests error. Before the fix, all three went through the ambient proxy.

**RED → GREEN** (egress suite only; there is no network anywhere in it except loopback):
- Tip code plus the exports only:
  - on 1.4.2, tests 1 and 3 fail (`reports/t26-red-142.log`). All three requests arrive at the **ambient** proxy, both when the setting is configured and when it is invalid.
  - on 1.4.4, tests 1, 2 and 3 fail (`reports/t26-red-144.log`); test 2 shows the ambient leak.
- After the fix, 8/8 pass on 1.4.2 (test 2 as the declared failing case) and 8/8 on 1.4.4, all three as plain tests (`reports/t26-green-142.log`, `t26-green-144.log`).
- Mutations, run after the commit and each restored with `git checkout 58d3935 -- captcha-happy.ts` (`git diff` clean after every one; `reports/t26-mutants.log`, script `/tmp/t26-scripts/mutants.sh`). All five were killed:
  - M1, `captchaFetch` without the Bun branch: tests 1 and 3 fail (1.4.2);
  - M2, the sync-XHR worker without the `proxy` option: tests 1 and 3 fail (1.4.2);
  - M3, `captchaFetch` without `?? false`: test 2 fails (1.4.4);
  - M4, the worker without `?? false`: test 2 fails (1.4.4);
  - M5, the host no longer passes `proxyUrl` to the worker: tests 1 and 3 fail (1.4.2).

**Node path verified where consumed** (`/tmp/t26-scripts/node-smoke.mjs`, `reports/t26-node-smoke.log`): the real module was bundled with `bun build --target node` (undici and happy-dom external) and run on Node 26.7.0 against loopback mocks with ambient proxies set.
- Set: both `fetch` and sync-XHR go to the configured proxy, through the npm undici `ProxyAgent`.
- Unset: both go direct, and the ambient proxy is ignored.

**Suites** (Bun 1.4.2):
- **Captcha suites first** (B1, before any change): 13 files, **133 pass, 0 fail** (`reports/t26-captcha-first.log`).
- **Captcha suites last** (after the merge): 13 files, **136 pass, 0 fail** (133 + the 3 new; `t26-captcha-last.log`).
- `npm run test` (kit): 836 tests, 817 pass, 0 fail, 19 skipped (`t26-full-kit.log`).
- `npm run test:proxy`: **1387 pass, 0 fail**, 92 files (`t26-full-proxy.log`).
- `npm run test:proxy-typecheck`: 0 errors.
- `npm run test:mcp`: 97 tests, 96 pass, 0 fail, 1 skipped. `git status` is clean afterwards, so `dist/` is unchanged.

**Memory loop: not run.**
- No scenario reaches the changed code. S2's backend (`tests/memory/fixtures/s2-backend.ts`) solves with injected resources: `primeCookies` is injected and the interceptor answers 503, so `captchaFetch` and `syncFetchBlocking` never run.
- On Bun, the removed `ProxyAgent` was an inert stub, so there is no allocation delta.
- `expected-red.json` was not touched.

**Criteria:**
- [x] Seam 3 test with a local recording proxy:
  - setting set: all captcha egress (fetch, sync-XHR, https CONNECT) goes through it. GREEN on 1.4.2 and 1.4.4.
  - setting unset with ambient `HTTP(S)_PROXY`: no proxy is used. GREEN on Bun ≥ 1.4.3. **On the pinned 1.4.2 this half is blocked by the runtime** (`proxy: false` ignored), and the test is declared failing there until ticket 62.
- [x] RED → GREEN at the named seam (above).
- [ ] Fast suite and `memory-budget` on ubuntu and windows: green locally on Linux. **Pending CI (orchestrator verifies after merge+push).**
- [x] Wiring: no new test file.
- [x] No pre-existing test changed. The existing allowlist tests in `captcha-egress.test.ts` are unchanged; only the imports line grew.
- [x] Evidence recorded here.
- [x] New log events, config keys, env overrides: none.

**Left for others:**
- Ticket 62: the move to Bun ≥ 1.4.3 makes the unset case effective, and the semver gate flips the test to plain.
- The child-process solver transport (after 24) could strip the ambient variables from the solver's environment as an alternative fix on 1.4.2.
- Unchanged and not in scope (B1): the per-request `ProxyAgent` on Node's sync-XHR path, which is never closed (research/undici-yaml.md §5 #2).
