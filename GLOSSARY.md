# ZCode Agent Kit

The kit runs a local ZCode proxy and connects the user's own agent harnesses to it. This glossary fixes the words the kit, its docs and its decisions (`docs/adr/`) use for that domain.

## Installation and processes

**Installation**:
One copy of the kit (release install, npm install or source checkout) with its own configuration, proxy key and state. Everything else in this glossary exists per installation.
_Avoid_: instance, install (as a noun), copy

**Upstream**:
The vendor's ZCode service that the proxy forwards model requests to.
_Avoid_: backend, gateway (except when quoting the vendor's own naming)

**Proxy**:
The installation's local HTTP service on loopback that speaks the Anthropic and OpenAI formats to harnesses and forwards to the upstream. There is exactly one per installation.
_Avoid_: server, gateway, service, daemon

**Manager**:
The kit component that starts, stops, restarts and respawns the proxy. It is the only thing that starts a proxy.
_Avoid_: supervisor, service manager (in prose), controller

**Identity proof**:
An authenticated health answer showing that the process on the configured port is this installation's own proxy. Its outcomes are *ours*, *foreign*, *down* and *no key*.
_Avoid_: ownership check, ping, liveness check

**Harness**:
An agent CLI or editor extension that uses the proxy as its model provider, such as Claude Code, Codex, OMP or OpenCode. User-facing copy may call it an "assistant".
_Avoid_: agent, client, tool

**Harness session**:
One running harness started by the user, together with the kit processes that serve it (launcher, MCP bridge, preflight).
_Avoid_: session (alone), run, agent session

**Launcher**:
The `zcode-kit run <harness>` process that starts a harness and stays alive for the whole harness session to forward signals and the exit code.
_Avoid_: wrapper, shim (a shim is the `zcode-kit.cmd` → `.ps1` entry point)

**Preflight**:
A short-lived check run before a harness session uses the proxy, which makes sure the proxy is up and is the installation's own.
_Avoid_: heal (the file name, not the concept), health check, warm-up

**MCP bridge**:
The per-session MCP server that gives a harness tools from the installed ZCode runtime. Registering it is not the same as connecting a model.
_Avoid_: MCP server (alone), harness MCP, plugin

**Kit footprint**:
The summed memory of every process the kit has started at one moment: launchers, MCP bridges, preflights, the proxy and the solver process.
_Avoid_: proxy memory, kit RSS, memory usage

**Memory footprint**:
The per-process memory measure that guards and caps use: the memory the OS actually charges to the process (commit charge on Windows). RSS is only its fallback.
_Avoid_: RSS, working set, heap (each is a different, narrower measure)

## Proxy lifecycle and the start lock

**Start lock**:
The on-disk record that a start of the proxy is in progress for this installation. At most one holder exists at a time.
_Avoid_: manager lock, pid file (a different record), mutex

**Holder**:
The process recorded in the start lock as the one performing the start.
_Avoid_: owner, contender (a contender is any process trying to acquire the lock)

**Stale lock**:
A start lock whose holder is proven gone: its PID is dead, or the PID was reused (the live process's start time differs from the recorded one). A lock that is merely old, or whose holder cannot be checked, is not stale.
_Avoid_: leftover lock, orphan lock, dead lock

**Takeover**:
Replacing a stale lock with one's own so that a start can proceed. It never applies to a live holder's lock.
_Avoid_: steal, break, force-unlock, lock removal

**Orphaned proxy**:
A healthy proxy left running after the start that spawned it was interrupted. The next start adopts it through the identity proof instead of spawning another.
_Avoid_: zombie, leaked proxy, second proxy

**Hung proxy**:
The installation's own proxy that is running but does not answer health checks. The kit stops it only when it is proven to be both its own and hung.
_Avoid_: frozen, dead proxy, crashed proxy

**Respawn**:
The proxy's own request to the manager for a fresh start, after its main thread stopped responding or its memory stayed too high. It is rate limited. User-facing copy calls it an "automatic restart".
_Avoid_: self-restart, reboot, recycle (that is the solver's word)

**Restart**:
A user-requested stop followed by a start of the proxy.
_Avoid_: reload, respawn (which the proxy requests, not the user)

## Captcha solver

**Solve**:
One run of the vendor's captcha challenge inside a headless page, which produces a token or a failure.
_Avoid_: captcha run, challenge (the challenge is the vendor's puzzle, the solve is the kit's attempt at it)

**Solver**:
The part of the proxy that performs solves, one at a time, in arrival order.
_Avoid_: captcha worker, captcha engine

**Solver process**:
The separate OS process in which solves run under a memory cap.
_Avoid_: solver worker, captcha child, sandbox

**Thread transport**:
The in-process worker-thread variant of the solver, kept only for tests and as a fallback.
_Avoid_: worker mode, legacy solver

**Solver generation**:
One lifetime of the solver process (or thread), from spawn to its end. Only one generation exists at a time.
_Avoid_: instance, epoch, worker (alone)

**Recycle**:
The deliberate end of a solver generation so the next solve starts fresh, triggered by solve count, failures, memory, idleness or a missed deadline.
_Avoid_: restart, reset, respawn (that is the proxy's word)

**Solver cap**:
The hard memory limit on the solver process, enforced by the OS where the OS can.
_Avoid_: memory limit (alone), heap limit, threshold (the recycle threshold sits below the cap)

**Enforcement mode**:
How the solver cap is enforced on this machine: *job-object*, *cgroup* or *sampling*. A mode is reported only when it is verified to be in effect.
_Avoid_: cap mode, limit type, backend

## Admission

**Admission**:
The proxy's decision, per request, to process the request body now, let it wait, or shed it.
_Avoid_: rate limiting, throttling, load balancing

**In-flight bytes**:
The total size of request bodies of which the proxy currently holds copies, from reading the body until it is sent upstream.
_Avoid_: pending bytes, concurrent requests, buffer size

**Byte cap**:
The limit on in-flight bytes. It is the only admission limit; open response streams are not limited.
_Avoid_: concurrency limit, request limit, body limit (that is the per-request size cap)

**Admission queue**:
The bounded first-in, first-out line of requests waiting for admission, whose bodies have not been read yet.
_Avoid_: backlog, buffer, retry queue

**Shed**:
To reject a request that could not be admitted within the admission queue's bounds, as an "overloaded, retry later" answer in the format of the endpoint it called. A shed is never a quota error.
_Avoid_: drop, throttle, rate-limit, 429

## Terminal output

**Report**:
A command's answer to the user: check rows and verdict, status text, the setup summary, the connection details. Reports and data go to stdout.
_Avoid_: output (alone), log

**Diagnostic**:
Conversation around a command's answer: progress, warnings, error blocks, prompts and usage errors. Diagnostics go to stderr.
_Avoid_: log, message, noise

**Check**:
One named test in `doctor`, `accounts doctor` or the upstream comparison, which yields a check verdict.
_Avoid_: test, probe, step

**Check verdict**:
The result word of a check: *PASS*, *FAIL*, *WARN* or *SKIP*. Only *FAIL* makes the command fail; *WARN* means it works but needs attention; *SKIP* means not applicable or not detected.
_Avoid_: status, OK (that is an action result), ERROR

**Action result**:
The result word of a step that changes something (setup, integrate, update, rollback, uninstall): *OK*, *FAIL*, *WARN*, *SKIP* or *INFO*.
_Avoid_: check verdict, PASS (that is a check verdict)

**Verdict line**:
The line that sums up a check report as counts per check verdict and names a non-zero exit code.
_Avoid_: summary, footer, result

**Connection details**:
The unboxed block that tells a manually configured client how to reach the proxy: base URLs, key, model IDs and the proxy's state.
_Avoid_: connection card, connection info, credentials

**Line mode**:
All output that is not the full-screen proxy TUI: plain lines, with no box chrome.
_Avoid_: CLI mode, text mode, plain mode

**Proxy TUI**:
The full-screen terminal view of the running proxy, with its status header, log pane and key hints.
_Avoid_: dashboard, console, UI

**Glyph tier**:
The set of characters the output may use on a given terminal: *full*, *wgl4* or *ascii*. The words never change between tiers; only glyphs do.
_Avoid_: charset, Unicode mode, theme

## Support

**Support floor**:
The lowest runtime version the kit supports and installs on; below it, `setup` and `update` refuse before changing anything.
_Avoid_: minimum version (alone), engines (the manifest field, not the policy)
