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
