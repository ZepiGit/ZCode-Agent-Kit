This release makes the local proxy steadier under load and makes starting and stopping it predictable. It also reworks most of the command output.

## Before you update

- **Node.js 24 or newer is required.** Node.js 20 and 22 are no longer supported. Install the new Node.js first: `zcode-kit update` from 0.2.x still runs on the old one, but the setup that follows refuses to run there, and so do `setup` and `update` afterwards. The installers check this before they download or change anything.
- The installers install Bun 1.4.2 when Bun is missing. With npm, use Bun 1.4.2.
- The proxy now restarts itself at a lower memory level than before: it writes a warning above 512 MB and asks for a restart above 1024 MB (0.2.x: 1536 and 3072 MB). Both values are under `health.memory` in `proxy/config.yaml`.

## Proxy

- **Overload is answered, not suffered.** The proxy holds at most 64 MiB of request bodies at a time (`server.admission.maxInFlightMB`). Further requests wait up to 15 seconds and are then answered with HTTP 503 and `Retry-After`. It never answers overload with 429, so clients do not mistake it for an exhausted quota.
- Large requests need much less memory, because the proxy copies a request body less often on its way upstream. The bytes sent upstream are the same as before.
- A streamed answer is read from ZCode at the pace the client reads it. A slow or stalled client no longer makes the proxy buffer the whole answer. For such a client, the duration and tokens-per-second shown in the request row now include the time the client took to read.
- An automatic restart begins only after the kit has confirmed it. A restart that is refused, for example because three already happened within 15 minutes, leaves the proxy serving instead of stopping it.
- `logs/proxy.log` has one writer and is rotated at 5 MB with one older file kept. Log files and the log directory are readable by your user only.
- The in-memory and on-disk caches for CAPTCHA assets are bounded (32 MiB and 256 entries in memory, 256 MiB on disk).
- When a CAPTCHA challenge fails, the error a client receives names the kind of failure and no longer contains internal paths or identifiers.
- The log pane of the proxy TUI keeps at most 2,000 lines and 8 MB.
- Updated dependencies: happy-dom 21.0.4, undici 8.12.4, yaml 2.9.1.

## Starting and stopping

- **Stopping is graceful.** `proxy stop`, `proxy restart` and `update` ask the proxy to stop. It gives running requests up to 6 seconds to finish, answers new ones with 503, and exits within 10 seconds. The kit ends the process itself only if that fails.
- **An interrupted start no longer blocks the next one.** If a start is killed, the next start takes over once it can prove the earlier one is gone. It never takes over from a start that is still running. Ctrl-C during a start releases the lock right away, and a proxy left behind by an interrupted start is adopted instead of being reported as unknown.
- On Windows, the check that protects against ending the wrong process now compares the exact creation time of the process, which removes a rare false refusal of `proxy stop`.

## Commands

- `zcode-kit --version` prints the installed version.
- `zcode-kit doctor` groups its checks and ends with one verdict. `proxy start`, `stop`, `restart` and `status` report what happened in a few lines and print the connection details. `zcode-kit proxy status --json` gives scripts one JSON object without the key.
- `zcode-kit setup` shows the detected assistants as a checkbox list on a terminal, prints one result line per assistant and ends with the commands to run next. `--verbose` brings back the full output.
- `zcode-kit integrate <assistant> --dry-run` lists what would be written without writing it.
- The Account Rotator question is asked once and the answer is remembered; `setup --reask` asks again.
- `accounts`, `accounts health`, `auth status` and `models` have a consistent table layout and say what to do next when something is wrong.
- The notes in `zcode-kit help` are plain sentences now.
- Results go to stdout and progress, warnings and questions to stderr, so output can be piped. On a pipe or in CI, check lines keep their `PASS`/`FAIL`/`SKIP` form.
- When the kit rewrites a configuration file with Windows line endings, it keeps them.
- Fixed: an empty `deviceMid:` line in `proxy/config.yaml` made setup read past the end of the line.

## Assistants

- Continue and Kilo Code: fixes to the configuration the kit writes for them.
- The values sheet for Kilo Code lists both models with their per-model settings, because Kilo Code does not fetch the model list for this provider type.

## MCP bridge

- Finished tasks are kept for at most 7 days and at most 500 at a time.
- The text of one task is limited to 4 MiB. Longer text keeps its beginning and its end, with a marker that says how much was dropped.
- The bridge uses less memory per assistant session: the HTTP transport is loaded only when it is used.
- Updated to MCP SDK 1.32.2 and zod 4.6.

## Not in this release

These were planned for it and are not finished: running the CAPTCHA solver in its own process with a memory limit, handing the `zcode-kit run` process over to the assistant instead of keeping it resident, a single shared preflight when several OMP windows start together, a restart limit for the runtime the MCP bridge starts, and the move to MCP SDK 2.
