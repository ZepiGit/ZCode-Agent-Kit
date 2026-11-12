# Glossary

The kit runs a local ZCode proxy and connects your own agent harnesses to it. This glossary defines the words the `zcode-kit` output and the kit's documents use.

## Installation and processes

**Installation**:
One copy of the kit (release install, npm install or source checkout) with its own configuration, proxy key and state. Everything else in this glossary exists per installation.

**Upstream**:
The vendor's ZCode service that the proxy forwards model requests to.

**Proxy**:
The installation's local HTTP service on loopback that speaks the Anthropic and OpenAI formats to harnesses and forwards to the upstream. There is one per installation.

**Proxy key**:
The local secret a client must send to the proxy. Setup generates it and stores it in `.proxykey`.

**Manager**:
The kit component that starts, stops and restarts the proxy. `zcode-kit proxy start`, `stop` and `restart` use it.

**Identity proof**:
An authenticated health answer showing that the process on the configured port is this installation's own proxy. Its outcomes are *ours*, *foreign* (something else answers on the port), *down* (nothing answers) and *no key* (the proxy key is missing, so nothing can be proven). `zcode-kit proxy status --json` reports them in its `health` field as `ours`, `foreign`, `down` and `nokey`.

**Pid record**:
The file `logs/proxy.pid`, in which the manager records the proxy's pid and start time. The manager stops a process only when it matches this record. Messages also call it the pid file.

**Harness**:
An agent CLI or editor extension that uses the proxy as its model provider, such as Claude Code, Codex, OMP or OpenCode. Other documents also call it an assistant.

**Integration**:
The configuration the kit writes for one harness, with your consent, so that the harness uses the proxy.

**Launcher**:
The `zcode-kit run <harness>` process. It runs the preflight, starts the harness and stays until the harness exits, then returns the harness's exit code.

**Preflight**:
A short check before a harness uses the proxy. It makes sure the proxy is up and is the installation's own, starts it if needed, and checks the quota.

**MCP bridge**:
The MCP server that gives a harness tools from the installed ZCode Desktop runtime. Registering it is not the same as connecting a model.

**Transaction**:
The record of the file changes that one run of a command such as `setup`, `integrate`, `update` or `accounts enable` made, with backups. `zcode-kit rollback [tx-id]` undoes the newest or the named one.

**Memory footprint**:
The memory the operating system charges to the proxy process. The proxy's memory limits are judged against it; where the runtime cannot report it, the resident set size (RSS) is used instead.

## Proxy lifecycle and the start lock

**Start lock**:
The file `logs/manager.lock`, which records that a start of the proxy is in progress for this installation. At most one holder exists at a time.

**Holder**:
The process recorded in the start lock as the one performing the start.

**Stale lock**:
A start lock whose holder is proven gone: its process is dead, or its pid now belongs to a process that started later. A lock that is merely old, or whose holder cannot be checked, is not stale.

**Takeover**:
Replacing a stale lock with one's own so that a start can proceed. It never applies to a live holder's lock.

**Startup grace**:
The first 60 seconds after a proxy was started. A proxy that does not answer yet is never ended during this time.

**Orphaned proxy**:
A healthy proxy left running after the start that spawned it was interrupted. The next start adopts it through the identity proof instead of spawning another.

**Hung proxy**:
The installation's own proxy that is running but does not answer health checks. The kit ends it only when it is proven to be both its own and hung.

**Health supervisor**:
The part of the proxy that watches its own main thread and memory footprint and decides whether to warn, ask for a restart or keep serving.

**Automatic restart**:
The proxy's own request to the manager for a fresh start, after its main thread stopped responding or its memory stayed above the hard limit. Log lines call it a respawn. It is limited by the restart budget.

**Restart budget**:
The number of automatic restarts the manager accepts within a rolling window: 3 within 15 minutes.

**Respawn acknowledgement**:
The manager's recorded confirmation that it has accepted a proxy's request for an automatic restart. A proxy that asked because of memory drains only after it; without one it keeps serving.

**Drain**:
The phase of a graceful stop in which the proxy keeps its listener open, sheds new requests and lets requests already running finish before its deadline.

**Stop request**:
The authenticated loopback request (`POST /__kit/stop`) with which the manager asks its own proxy to stop gracefully. It needs the proxy key and the stop token.

**Stop token**:
The secret, created for each start, that authorises a stop request together with the proxy key. It is kept in the pid record and is not part of any harness configuration.

**Restart**:
A stop followed by a start of the proxy, requested with `zcode-kit proxy restart`.

## Captcha solver

**Solve**:
One run of the vendor's captcha challenge inside a headless page, which produces a token or a failure.

**Solver**:
The part of the proxy that performs solves, one at a time, in arrival order, on a worker thread of the proxy process.

**Recycle**:
Ending the solver's worker thread so that the next solve starts on a fresh one.

## Admission

**Admission**:
The proxy's decision, per request, to process the request body now, let it wait, or shed it.

**In-flight bytes**:
The total size of the request bodies the proxy currently holds, from reading a body until the upstream has answered.

**Byte cap**:
The limit on in-flight bytes, 64 MiB by default (`server.admission.maxInFlightMB`). It is the only admission limit; open response streams are not limited.

**Admission queue**:
The bounded first-in, first-out line of requests waiting for admission, whose bodies have not been read yet. At most 64 requests wait, each for at most 15 seconds.

**Shed**:
To reject a request that could not be admitted, or that arrived during a drain, with HTTP 503 and `Retry-After` in the error format of the endpoint it called. A shed is never a quota error.

## Accounts

**Account Rotator**:
The optional feature that keeps several authorised sign-ins as separate accounts. See [ACCOUNT_ROTATOR.md](ACCOUNT_ROTATOR.md).

**Active account**:
The account the proxy currently uses, marked `*` in the account tables.

**Verdict**:
The state `zcode-kit accounts health` gives each account, such as `ok`, `low` or `exhausted`.

**Quota package**:
One balance the vendor reports for an account, with remaining and total units and a reset time.

**Cooldown**:
The time during which an account is not used after a quota error.

## MCP tasks

**Task retention**:
How long finished MCP tasks and their results are kept before they are removed: at most 500 finished tasks and at most 7 days. A task's idempotency key is remembered exactly as long as the task is retained.

## Logs

**Proxy log**:
`logs/proxy.log`, written by the proxy and the manager and rotated at 5 MB with one older file, `proxy.log.1`. `zcode-kit proxy logs` reads it.

**Heal log**:
`logs/heal.log`, a short record of what the preflight and the manager found and did, in a fixed vocabulary without provider text, paths or credentials.

## Terminal output

**Report**:
A command's answer: check rows and verdict line, status text, the setup summary, the connection details. Reports and data go to stdout.

**Diagnostic**:
Everything around a command's answer: progress, warnings, error blocks, prompts and usage errors. Diagnostics go to stderr.

**Check**:
One named test in `zcode-kit doctor`, including the upstream comparison of `doctor --upstream`.

**Check verdict**:
The result word of a check: *PASS*, *FAIL*, *WARN* or *SKIP*. Only *FAIL* makes the command fail; *WARN* means it works but needs attention; *SKIP* means not applicable or not detected. `zcode-kit accounts doctor` prints its own words instead: *OK*, *WARNING* and *ERROR*.

**Action result**:
The result word of a step that changes something (setup, integrate, update, rollback, uninstall): *OK*, *FAIL*, *WARN*, *SKIP* or *INFO*.

**Verdict line**:
The line that sums up a check report as counts per check verdict and names a non-zero exit code.

**Connection details**:
The block that tells a manually configured client how to reach the proxy: base URLs, key, model IDs and the proxy's state.

**Line mode**:
All output that is not the full-screen proxy TUI: plain lines, without boxes.

**Proxy TUI**:
The full-screen terminal view of the running proxy, with its status header, log pane and key hints.

**Glyph tier**:
The set of characters the output may use on a given terminal: *full*, *wgl4* or *ascii*. The words never change between tiers; only the symbols do.

## Support

**Support floor**:
The lowest runtime version the kit supports: Node.js 24. Below it, the installers, `setup` and `update` refuse before changing anything.
