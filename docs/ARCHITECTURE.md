# How the kit works

This page describes the parts of the kit and the rules they follow. It is for people who operate the kit, debug it or want to change it. For installation and daily use, start with the [README](../README.md). Terms are defined in the [glossary](GLOSSARY.md).

## The parts

| Part | Where | Runs on | What it does |
| --- | --- | --- | --- |
| Proxy | `zcode-proxy-src/` | Bun 1.4.2 | Listens on loopback, speaks the OpenAI and Anthropic formats to assistants and forwards requests to ZCode with your login. One per installation. |
| Manager | `proxy/zcode-proxy-manager.mjs`, `lib/proxy-lifecycle.mjs` | Node.js 24+ | Starts, stops and restarts the proxy. Nothing else starts a proxy. |
| CLI | `cli/` | Node.js 24+ | The `zcode-kit` command. One module per command under `cli/commands/`. |
| Adapters | `cli/adapters/` | Node.js 24+ | One per assistant. Each knows which configuration files that assistant reads and how to change them and undo the change. |
| MCP bridge | `mcp/zcode-harness-mcp/` | Node.js 24+ | An MCP server that offers tools from your installed ZCode runtime to an assistant. |

Each installation keeps its own state next to the code: `.proxykey` (the local API key), `proxy/config.yaml`, `logs/`, `backups/` (transactions for rollback) and `generated/` (stored answers and generated values).

## Whose proxy is it

Several rules below depend on one question: is the process on the configured port this installation's proxy? The manager answers it with an authenticated `/health` request. Only a process that knows the local key and answers `{"status":"ok","provider":"zai"}` counts as ours. Anything else on the port is foreign and is never touched.

Before the manager ends a process, three things must agree: the identity answer, the pid in `logs/proxy.pid`, and the start time recorded at start compared with the live process's start time. The last check protects against a pid that the operating system gave to another process in the meantime. On Windows the comparison uses the exact creation time of the process handle that the kill goes through. If any of the three cannot be determined, nothing is killed and the command says why.

A proxy that no longer answers is ended only when it is past a 60-second startup grace, its start time and command line match, and three health checks in a row fail.

## Starting

Only one start runs at a time per installation. The start takes `logs/manager.lock`, which records the holder's pid and start time. A second start that finds the lock checks whether the holder is still alive:

- A live holder keeps its lock. The second start waits or reports that a start is in progress.
- A lock whose holder is gone (the process is dead, or the pid now belongs to a process that started later) is taken over. Two starts that both find the same stale lock cannot both take it: each must first create a claim file for exactly the bytes it judged, and only the claimant may delete the lock.
- A lock that cannot be read, or one written by a newer kit version, is never deleted. The error names the file and what to do.

A start that is ended by Ctrl-C releases its lock. The pid record is written before the proxy process is spawned and completed afterwards, so a start that was killed halfway leaves a record the next start can finish or discard with proof.

## Launching assistants

Before an assistant talks to the proxy, a preflight makes sure the proxy is running and asks it once for the account's quota state. The preflight starts the proxy the way the manager does, so the rules under "Starting" apply. It prints one line with the result and writes one line to `logs/heal.log`. Two things run it.

`zcode-kit run <assistant> -- <args>` runs the preflight in its own process and then starts the assistant with the local key in its environment. On Linux and macOS with Node.js 26.1 or newer the launcher then replaces itself with the assistant (`process.execve`): the assistant keeps the launcher's process id, terminal and environment, and no kit process stays beside it for the session. This is the last thing the launcher does, after the preflight's line is printed and its lock and log writes are finished, because nothing of the launcher runs afterwards. An assistant that is ended by a signal reports that signal to its caller. In five cases the launcher instead stays as the assistant's parent process and passes its exit code on: on Windows; on an older Node.js; when its output goes to a pipe (Node leaves a pipe in non-blocking mode, which the assistant must not inherit); when the assistant's command is not an executable on `PATH` (the launcher prints `run: …` and exits 2); and when `ZCODE_KIT_RESIDENT_LAUNCHER=1` is set. Only the exact value `1` counts.

OMP loads an extension that the kit generates. It runs inside OMP, imports nothing from the kit, and starts the preflight as a separate process before the first request to the kit's provider. When several OMP windows of one installation start at the same moment, only one of them runs the preflight:

- The window that creates `logs/omp-autostart.token` runs the preflight. The token records that window's process (pid and start time), the attempt, and the preflight process as soon as it is spawned.
- The other windows wait inside OMP, start no process, and watch the token. When it is gone they read `logs/omp-autostart.result`, which the first window writes before it deletes its token, and print the same warnings. If the shared preflight failed or left no result, the waiting windows take the token one after another and each runs its own, so every window reports its own failure.
- A token is replaced only when both processes it names are proven gone (dead, or the pid now belongs to a process that started later), under the same claim file rule as the start lock. A token that is merely old proves nothing: a window that has waited 120 seconds reports a timeout and starts no second preflight.
- The preflight checks at its start that the token names it. One whose OMP window died right after spawning it leaves without doing anything.
- If the token cannot be used (a file with other content or a newer format in its place, no write access), each window runs its own preflight, as extensions written by older kit versions do. The start lock still allows only one proxy.

`zcode-kit setup` or `zcode-kit integrate omp` writes the current extension over an older one.

## Stopping

`zcode-kit proxy stop`, `restart` and `update` stop the proxy in two steps.

1. The manager sends `POST /__kit/stop` to the proxy on loopback, with the local key and a stop token that was generated for this one start and is stored in the pid record. The proxy answers 202 and begins to drain: requests in progress get up to 6 seconds to finish, new requests are answered with HTTP 503 and `Retry-After`, account metadata is flushed, and the process exits within 10 seconds.
2. If the proxy has not exited 2 seconds after that deadline, the manager ends it, under the identity rules above. The same happens when the proxy does not know the stop route (an older version) or refuses the request.

The paths that already know the proxy is broken, such as hung-proxy recovery, skip step 1.

## Too much at once

The proxy limits the request bodies it holds at a time to 64 MiB in total (`server.admission.maxInFlightMB`). A request is admitted when it fits under the limit, or when nothing else is in flight, so a single large request always gets through. Requests that do not fit wait in order, without their bodies being read, for at most 15 seconds and at most 64 at a time. Past either bound the request is answered with HTTP 503 and `Retry-After: 2` in the error format of its endpoint. The proxy never answers overload with 429, because clients read 429 as an exhausted quota.

## Health and automatic restarts

The proxy samples its own memory every 15 seconds.

- Above 512 MB for three samples in a row it writes a warning.
- Above 1024 MB for three samples in a row it asks the manager for a restart. It keeps serving until the manager has confirmed the request, then drains as described under "Stopping" and exits; the manager starts a fresh proxy.

A watchdog asks for the same restart when the proxy's main loop stops responding. The manager accepts at most 3 restart requests in 15 minutes and records them in `logs/respawn.json`. A refused request leaves the proxy serving. The thresholds are under `health.memory` in `proxy/config.yaml`.

## The solver process

Some requests need a CAPTCHA token before ZCode accepts them. The proxy gets one by running the vendor's JavaScript in an emulated browser page, and that code keeps memory after every solve. This work runs in a process of its own, the solver process, so its memory never counts against the proxy.

- **Start.** The first solve starts the solver process with the same Bun that runs the proxy; a compiled proxy starts itself with an internal subcommand. The solver process gets the proxy's environment without the stop token, the respawn variables and the ambient `HTTP_PROXY`-style variables. There is never more than one: a new one starts only after the old one has exited. It exits after 10 minutes without a solve, and it ends when the proxy ends, also when the proxy is killed.
- **Limit.** The solver process has a memory cap of 300 MB (`solver.memoryCapMB` in `proxy/config.yaml`). Before it loads anything heavy it waits until the proxy has confirmed that the cap is in place; without that confirmation it exits and never solves. Windows enforces the cap with a Job Object, Linux with a systemd user scope (a cgroup). Either is reported only after the limit has been read back from the kernel. Where the operating system cannot enforce the cap (macOS, or a Linux whose user systemd has no memory controller), the solver process measures its own memory and ends itself at the cap. `/health` shows the cap and how it is enforced under `details.captcha.solver`: `capMB` and `enforcement` (`job-object`, `cgroup`, `sampling`, or `none` when nothing caps the solver).
- **Recycling.** After each solve the solver process reports its memory footprint. At 80 % of the cap (240 MB), or after 100 solves, it is replaced by a fresh one before the next solve. This is the normal path. Being ended at the cap is the exception, and the log line for it names the config key.
- **Failure.** When the solver process crashes, is ended at its cap, reports a fatal error or takes longer than 90 seconds for one solve, only the solve that was running fails. Solves that were waiting run in the next solver process, no solve is run twice, and requests that need no solve are not affected. After more than 5 such exits within 10 minutes the proxy starts no new solver process until the oldest of those exits is 10 minutes old. During that time a request that needs a solve is answered with HTTP 503 and `Retry-After` set to the seconds that remain, in the error format of its endpoint. The same answer, with `Retry-After: 2`, goes to a request whose solve would be the 65th to wait.

## Bounded stores

| Store | Bound |
| --- | --- |
| `logs/proxy.log` | Rotated at 5 MB; one older file is kept as `proxy.log.1` |
| Solves waiting for the solver | 64 |
| CAPTCHA asset cache in memory | 256 entries and 32 MiB |
| CAPTCHA asset cache on disk | 256 MiB, oldest entries removed first; expired entries are removed after 14 days or the configured lifetime, whichever is longer |
| Log pane of the proxy TUI | 2,000 lines and 8 MB |
| Finished MCP tasks | 500 tasks and 7 days |
| Text of one MCP task | 4 MiB; longer text keeps its first 1 MiB and its end, with a marker in between |

## Logs

New log events are single lines of the form `time LEVEL component message key=value …`. Older lines keep the text they always had, because scripts and people search for it. Before a line is written, the local key, stop tokens and token-shaped strings are removed from it. The log directory and the files in it are readable by the owner only.

## Output of the CLI

- A command's result goes to stdout. Progress, warnings, errors and questions go to stderr, so output can be piped.
- `--json` prints one JSON document on stdout and never contains the local key.
- On a pipe, in CI or with `TERM=dumb`, check lines keep the fixed form `PASS|FAIL|SKIP  name — detail`, so scripts that read them keep working.
- Exit codes: 0 ok, 1 checks failed, 2 runtime error, 3 port or foreign conflict, 4 safe start refused, 5 auth or identity failure, 20 setup finished but at least one assistant failed, 130 setup interrupted with Ctrl-C.

## Changing an assistant's configuration

Every write to an assistant's configuration happens inside a transaction: the file is backed up, the operation is recorded under `backups/`, and `zcode-kit rollback` or `zcode-kit uninstall` restores it. A file with Windows line endings keeps them. The kit writes only for assistants the user agreed to, and stores each answer under `generated/harness-choices/`.

## Tests

```sh
npm run test                 # kit (node:test)
npm run test:proxy           # proxy (bun test)
npm run test:proxy-typecheck # proxy types
npm run test:mcp             # MCP bridge
npm run test:ux-before       # every command's output against the committed baseline
```

The proxy tests run with a guard that blocks requests to the real upstream. `tests/memory/` holds a memory loop that runs the proxy, the manager and the bridge under load against fixtures and checks their memory against budgets; CI runs its short profile on Linux and Windows. The runs known to miss a budget are listed in `tests/memory/expected-red.json`, each with a note under `tests/memory/known-issues/`.
