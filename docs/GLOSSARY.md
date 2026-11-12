# Glossary

The kit runs a local ZCode proxy and connects the user's own agent harnesses to it. This glossary fixes the words the kit, its docs and its decisions (`docs/adr/`) use for that domain.

## Installation and processes

**Installation**:
One copy of the kit (release install, npm install or source checkout) with its own configuration, proxy key and state. Everything else in this glossary exists per installation.

**Upstream**:
The vendor's ZCode service that the proxy forwards model requests to.

**Proxy**:
The installation's local HTTP service on loopback that speaks the Anthropic and OpenAI formats to harnesses and forwards to the upstream. There is exactly one per installation.

**Manager**:
The kit component that starts, stops, restarts and respawns the proxy. It is the only thing that starts a proxy.

**Identity proof**:
An authenticated health answer showing that the process on the configured port is this installation's own proxy. Its outcomes are *ours*, *foreign*, *down* and *no key*.

**Harness**:
An agent CLI or editor extension that uses the proxy as its model provider, such as Claude Code, Codex, OMP or OpenCode. User-facing copy may call it an "assistant".

**Harness session**:
One running harness started by the user, together with the kit processes that serve it (launcher, MCP bridge, preflight).

**Launcher**:
The `zcode-kit run <harness>` process that starts a harness. It either hands over to the harness or stays resident for the whole harness session to forward signals and the exit code.

**Handover**:
The launcher turning itself into the harness within the same process, so that no launcher stays resident for the harness session. Where handover is not possible or is opted out of, the launcher stays resident.

**Preflight**:
A short-lived check run before a harness session uses the proxy, which makes sure the proxy is up and is the installation's own.

**Single-flight preflight**:
The rule that when several harness hosts of one installation start together, only one of them runs a preflight and the others wait inside their own process for its outcome.

**MCP bridge**:
The per-session MCP server that gives a harness tools from the installed ZCode runtime. Registering it is not the same as connecting a model.

**Kit footprint**:
The summed memory of every process the kit has started at one moment: launchers, MCP bridges, preflights, the proxy and the solver process.

**Footprint metric**:
The measure in which a kit footprint budget is summed and judged on each OS: the *RSS sum* on Linux and macOS, the *commit sum* on Windows. Shared-page measures are reported for information and never judge a budget.

**Memory footprint**:
The per-process memory measure that guards and caps use: the memory the OS actually charges to the process (commit charge on Windows). RSS is only its fallback.

## Proxy lifecycle and the start lock

**Start lock**:
The on-disk record that a start of the proxy is in progress for this installation. At most one holder exists at a time.

**Holder**:
The process recorded in the start lock as the one performing the start.

**Stale lock**:
A start lock whose holder is proven gone: its PID is dead, or the PID was reused (the live process's start time differs from the recorded one). A lock that is merely old, or whose holder cannot be checked, is not stale.

**Takeover**:
Replacing a stale lock with one's own so that a start can proceed. It never applies to a live holder's lock.

**Orphaned proxy**:
A healthy proxy left running after the start that spawned it was interrupted. The next start adopts it through the identity proof instead of spawning another.

**Hung proxy**:
The installation's own proxy that is running but does not answer health checks. The kit stops it only when it is proven to be both its own and hung.

**Health supervisor**:
The part of the proxy that watches its own main thread and memory footprint and decides whether to warn, respawn or keep serving.

**Respawn**:
The proxy's own request to the manager for a fresh start, after its main thread stopped responding or its memory stayed too high. It is rate limited by the restart budget. User-facing copy calls it an "automatic restart".

**Restart budget**:
The number of respawns the manager grants an installation within a rolling window. A respawn the budget refuses leaves the serving proxy running.

**Respawn acknowledgement**:
The manager's recorded confirmation that it has reserved a slot in the restart budget for a given proxy's respawn. A proxy respawning for memory drains only after it; without one it keeps serving.

**Drain**:
The phase of a graceful stop in which the proxy keeps its listener open, sheds new requests and lets in-flight requests finish before its own deadline.

**Stop request**:
The authenticated loopback request with which the manager asks its own proxy to stop gracefully. It needs the proxy key and the stop token, and bypasses admission.

**Stop token**:
The per-spawn secret that, with the proxy key, authorises a stop request. Only the manager that spawned the proxy knows it; harnesses holding the proxy key do not.

**Restart**:
A user-requested stop followed by a start of the proxy.

## Captcha solver

**Solve**:
One run of the vendor's captcha challenge inside a headless page, which produces a token or a failure.

**Solver**:
The part of the proxy that performs solves, one at a time, in arrival order.

**Solver process**:
The separate OS process in which solves run under a memory cap.

**Thread transport**:
The in-process worker-thread variant of the solver, kept only for tests and as a fallback.

**Solver generation**:
One lifetime of the solver process (or thread), from spawn to its end. Only one generation exists at a time.

**Recycle**:
The planned end of a solver generation so the next solve starts fresh, triggered by memory footprint, solve count, idleness, an explicit request or shutdown. A recycle is never an abnormal exit.

**Idle exit**:
The recycle that ends a solver generation after a period with no solves, leaving no solver process until the next solve arrives.

**Abnormal exit**:
An end of a solver generation that was not planned: a crash, an OS kill at the solver cap, a fatal error or a deadline kill. Only abnormal exits count toward the solver's restart limit.

**Fail-fast window**:
The period after too many abnormal exits in which the solver starts no new generation and requests that need a solve are shed until the window ends.

**Solver cap**:
The hard memory limit on the solver process, enforced by the OS where the OS can.

**Enforcement mode**:
How the solver cap is enforced on this machine: *job-object* (a Windows kernel limit), *cgroup* (a Linux kernel limit), *sampling* (the kit measures and kills) or *none* (no cap). A mode is reported only when it is verified to be in effect.

## Admission

**Admission**:
The proxy's decision, per request, to process the request body now, let it wait, or shed it.

**In-flight bytes**:
The total size of request bodies of which the proxy currently holds copies, from reading the body until it is sent upstream.

**Byte cap**:
The limit on in-flight bytes. It is the only admission limit; open response streams are not limited.

**Admission queue**:
The bounded first-in, first-out line of requests waiting for admission, whose bodies have not been read yet.

**Shed**:
To reject a request that could not be admitted within the admission queue's bounds, as an "overloaded, retry later" answer in the format of the endpoint it called. A shed is never a quota error.

## MCP tasks

**Task retention**:
How long finished MCP tasks and their results are kept before they are evicted. A task's idempotency key is remembered exactly as long as the task is retained.

## Logs

**Proxy log**:
The installation's rotating log, written by the proxy and the manager, which `proxy logs` reads and where every start failure and crash cause ends up.

**Early log**:
The per-start file that catches the proxy's output written before its own log writer is open or that bypasses it. It is cleared at each start, and its tail is carried into the proxy log before it is cleared.

## Terminal output

**Report**:
A command's answer to the user: check rows and verdict, status text, the setup summary, the connection details. Reports and data go to stdout.

**Diagnostic**:
Conversation around a command's answer: progress, warnings, error blocks, prompts and usage errors. Diagnostics go to stderr.

**Check**:
One named test in `doctor`, `accounts doctor` or the upstream comparison, which yields a check verdict.

**Check verdict**:
The result word of a check: *PASS*, *FAIL*, *WARN* or *SKIP*. Only *FAIL* makes the command fail; *WARN* means it works but needs attention; *SKIP* means not applicable or not detected.

**Action result**:
The result word of a step that changes something (setup, integrate, update, rollback, uninstall): *OK*, *FAIL*, *WARN*, *SKIP* or *INFO*.

**Verdict line**:
The line that sums up a check report as counts per check verdict and names a non-zero exit code.

**Connection details**:
The unboxed block that tells a manually configured client how to reach the proxy: base URLs, key, model IDs and the proxy's state.

**Line mode**:
All output that is not the full-screen proxy TUI: plain lines, with no box chrome.

**Proxy TUI**:
The full-screen terminal view of the running proxy, with its status header, log pane and key hints.

**Glyph tier**:
The set of characters the output may use on a given terminal: *full*, *wgl4* or *ascii*. The words never change between tiers; only glyphs do.

## Memory budgets

**Expected-RED list**:
The declared set of memory-budget scenarios, per OS, that are known to miss their budget, each tied to the known issue that owns it (`tests/memory/known-issues/`). A scenario that fails without an entry, or passes with one, fails the job; the list is empty at release.

## Support

**Support floor**:
The lowest runtime version the kit supports and installs on; below it, `setup` and `update` refuse before changing anything.
