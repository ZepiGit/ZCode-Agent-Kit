# 76: The proxy test suite reaches the real upstream (zcode.z.ai:443)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: sol
Risk: high
ADR: no

**What to build:** Found by ticket 20's egress watcher (2026-11-08): `npm run test:proxy` (bun test in zcode-proxy-src) opens connections to the real zcode.z.ai:443 on the integration tip, not only on ticket 20's branch. One source is the endpoint-routing config fetch through the process-wide routing singleton; at least one socket also opened past a fetch-blocking preload (a non-fetch path: e.g. node:https/net, a WebSocket, or a worker). This breaks the run rule "tests and soak runs use fixtures and the mock upstream only" (PROMPT §5 B2, C6 no new external endpoints from tests) and makes test results depend on the network. Find every test (and every module-level side effect reached by tests) that can open a non-loopback connection; route them to loopback mocks or inject the fetcher; and add a guard: the proxy test run fails if any non-loopback connection is attempted (a preload that blocks and records fetch, node:http(s)/net/tls connect, WebSocket, and worker-side equivalents), with a test proving the guard catches each path.

**Acceptance criteria:**

- [ ] A list of every path that reached the network, with the test that triggered it (from a recorded run: e.g. ticket 20's watcher approach or strace/ss on the bun process tree).
- [ ] Each fixed (loopback mock or injected fetcher); no product behaviour change outside tests (the routing fetch in production stays as it is).
- [ ] Guard preload wired into `npm run test:proxy` and CI; it fails the run on any non-loopback connect attempt; mutation proof per transport.
- [ ] Full suites green on both legs (pending CI), with the guard active.

## Comments

- 2026-11-08 (implementer). Branch `ticket/76-proxy-test-egress-guard`, suites run on f94dda6 (merge of integration tip 603475c). Logs: `reports/t76-*.log` in the integration worktree.

**Guard (criterion 3).** `zcode-proxy-src/test-support/egress-guard.mjs` (plain JS so Node loads it too, types in `.d.mts`) plus `egress-guard-preload.ts`, loaded by `zcode-proxy-src/bunfig.toml` `[test].preload`. `npm run test:proxy` (`cd zcode-proxy-src && bun test`) therefore loads it, and both workflows run that script (pending CI: orchestrator verifies after merge+push). Allowed: 127.0.0.0/8, ::1 (also ::ffff:127.x) and `localhost`, plus unix sockets/pipes. Anything else is blocked before a socket opens and recorded as JSON lines (transport, host:port, URL without query or userinfo, runtime, thread, pid, stack). By default the current test fails and names every attempt. Attempts before a test (module load, hooks, late async work) fail the next test, attempts after the last test fail the file's afterAll. `ZCODE_EGRESS_GUARD=record` prints the attempts and does not fail the run. Hooks, all verified on Bun 1.4.2 first:
  - `globalThis.fetch` (including a non-loopback `proxy:` option);
  - `net.Socket.prototype.connect`: in both Bun and Node, node:net, tls, http, https and http2 all connect through it;
  - `Bun.connect`;
  - `WebSocket`;
  - Bun's builtin `undici` (fetch, request, stream, pipeline, connect, upgrade, WebSocket, EventSource), via `mock.module`, because it fetches natively and bypasses globalThis.fetch;
  - Bun `Worker` and `node:worker_threads` Worker: the guard is injected as `preload`. Workers do not inherit preloads, and a named builtin import is only reachable through `mock.module`;
  - Bun child processes: `BUN_OPTIONS=--preload=<guard>`, set in process.env and added per call to `Bun.spawn`/`spawnSync`, because Bun.spawn ignores later process.env writes. Explicit `env` objects are covered too;
  - Node child processes: `NODE_OPTIONS=--import=<guard URL>`.
- **Paths that reached the network (criterion 1).** Recorded in one record-only run of the whole proxy suite (`t76-record.log`: 1469 pass, 3 fail, the 3 being guard self-tests that inherited record mode, fixed in 049f91d). A socket watcher sampled the process tree every 100 ms (`ss -tunap`, non-loopback peers of descendant pids).
  | # | transport | host:port | triggering test | module-level source |
  |---|---|---|---|---|
  | 1 | fetch (bun, main thread) | zcode.z.ai:443, `https://zcode.z.ai/api/v1/client/configs?app_version=…&platform=linux-x64` | `src/integration.test.ts` › "integration: OpenAI clients (translated Anthropic upstream) › POST /v1/chat/completions returns 200 with a translated OpenAI response" (first request of the file) | process-wide routing singleton `getDefaultEndpointRouting(config)` (`endpoint-routing.ts:267`) → `EndpointRoutingService.refresh` fetch (`endpoint-routing.ts:219`), from `handler.ts:221` (dispatch) ← `dispatchWithConnectRetry` (`handler.ts:726`) ← `proxyRequest` (`handler.ts:292`). The integration config left `endpointRouting` on with the default origin. |
  - The watcher saw 0 sockets from bun processes. Nothing else was recorded on any transport, worker or child.
  - The singleton's failure cooldown hides repeat fetches, so a scratch probe in `resolve` (never committed, restored from 3bebf5b; `t76-probe-routing2.log`) listed every routing resolve against a non-loopback origin:
    - `integration.test.ts`: 9 resolves, all through the default fetch;
    - `endpoint-routing.test.ts`: 23 resolves, all with an injected fetchImpl;
    - `handler-routing-signing.test.ts`: 1 resolve, with an injected fetchImpl.

    Only the integration file reached the network.
  - Ticket 20's "a connection still opened past the preload" did not reproduce on this tip. With every transport above hooked, the guard and the watcher found only the path in the table.
- **Fix (criterion 2).** `integration.test.ts` keeps endpoint routing on, the production default, and points `endpointRouting.origin` at its loopback mock. The mock serves `/api/v1/client/configs` with an empty mapping (`{code:0,data:{proxyEndpoint:{mapping:[]}}}`). A new test asserts that the routing config was fetched from the mock. No `src/` behaviour changed: `git diff overhaul/stability-terminal-ux -- zcode-proxy-src/src ':!*.test.ts'` is empty. No B1 file was touched.
- **RED → GREEN.**
  - RED: `t76-probe-routing.log` is the guarded suite on 3bebf5b. 1471 pass, 1 fail: the integration test above, failed by the guard's afterEach.
  - GREEN: `t76-guarded1.log` on 049f91d, 1473 pass, 0 fail, no BLOCKED lines.
- **Mutation proof per transport** (`t76-mutations.log`, `t76-mutation-m6.log`; each mutant built from the committed ea8b978, restored with `git checkout ea8b978 -- <file>`, `git status` clean after):
  | mutant | RED tests |
  |---|---|
  | M1 fetch hook off | global fetch; fetch via proxy; Bun Worker fetch; Bun child fetch; Node child fetch (seen as node:net, not fetch); the 4 run-level probes (9 fail) |
  | M2 Socket#connect hook off | net.connect; Socket#connect(port, host); tls.connect; http.request; https.request; worker_threads net connect (6 fail) |
  | M3 Bun.connect off | Bun.connect (1) |
  | M4 WebSocket off | WebSocket (1) |
  | M5 Worker preload injection off | Bun Worker fetch (1) |
  | M6 worker_threads `mock.module` off (both specifiers; removing only `node:worker_threads` survives, because Bun maps `worker_threads` to the same module) | worker_threads net connect (1) |
  | M7 undici `mock.module` off | undici fetch (1) |
  | M8 Bun.spawn/spawnSync env injection off | Bun child fetch; "an attempt from a test's child process fails that test" (2) |
  | M9 NODE_OPTIONS off | Node child fetch (1) |
  | M10 fail mode off | the swallowed-error, module-load and child-process run probes (3) |
  | M11 bunfig preload removed | `tests/test-wiring.test.mjs` "npm run test:proxy loads the egress guard preload, in CI too" (1) |

  The guard tests' "non-loopback" target is this host's own interface address (TEST-NET-1 as a fallback), served by a listener in the test. A mutant therefore connects only to this machine and is counted there.
- **Suites (with the guard active, on f94dda6, `t76-full.log`).** The socket watcher ran over all four and saw 0 non-loopback sockets.
  - `npm run test`: 886 tests, 868 pass, 0 fail, 18 skipped.
  - `npm run test:proxy`: 1473 pass, 0 fail, 99 files.
  - `npm run test:proxy-typecheck`: pass. `test-support/` was added to the tsconfig include.
  - `npm run test:mcp`: 100 tests, 99 pass, 0 fail, 1 skipped.
  - The pack payload has no `test-support/` and no `bunfig.toml`; verify-payload OK.
  - Criterion 4 (both legs): pending CI, orchestrator verifies after merge+push. The Windows leg uses forward-slash BUN_OPTIONS paths and a file-URL NODE_OPTIONS import, so far unproven on windows.
- **Decisions.**
  - `0.0.0.0` counts as non-loopback.
  - BUN_OPTIONS uses `--preload=<path>`: the space form makes Bun read the next subcommand (`test`, `run`) as a script name.
  - Not hooked:
    - `Bun.fetch`: in 1.4.2 it is neither writable nor configurable, and `src/` does not use it.
    - DNS lookups and UDP (`dgram`, `Bun.udpSocket`; neither is used).
    - Non-Bun/Node children (curl etc.).
    - `node:child_process` calls whose explicit env drops process.env.
    - Routing of a loopback fetch through an ambient HTTP(S)_PROXY.
    - Guard paths containing spaces in BUN_OPTIONS/NODE_OPTIONS (repo and CI paths have none).
- **Existing tests changed.** Only `integration.test.ts` (the fix itself) and `tests/test-wiring.test.mjs` (+1 wiring guard).
- **Real connections after step 1:** none from tests. Every suite run after 3bebf5b was guarded, and the watcher saw no socket from a bun or test process. The guard-test probes and mutants reached only this host's interface address. The only external sockets in the process tree were npm's own update-notifier check to registry.npmjs.org (104.16.1.34:443) during `t76-guarded1` (npm process, not a test). Later runs set `npm_config_update_notifier=false`. Before step 1, only `npm ci`/`bun install` used the network.
- 2026-11-08 (implementer, after merging integration tip 5f754b8, ticket 29). Suites on 2d8d561 with the guard active. The watcher saw 0 non-loopback sockets (`t76-full2.log`, `t76-kit-rerun.log`).
  - `npm run test:proxy`: 1501 pass, 0 fail, 101 files, 0 BLOCKED. Ticket 29's new CDN disk tests are loopback-only.
  - `npm run test:proxy-typecheck`: pass.
  - `npm run test:mcp`: 99 pass, 1 skipped.
  - `npm run test`: 886 tests, 868 pass, 0 fail, 18 skipped, on rerun. The first run had 1 failure: `tests/json-superset.test.mjs` "port 18458 is in use; another capture may be running". That is a fixed port shared with another agent's concurrent capture, unrelated to this ticket. The port was free 20 s later and the rerun passed.
