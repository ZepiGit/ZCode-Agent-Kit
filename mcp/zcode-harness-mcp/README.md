# zcode-harness-mcp
**English (original)** · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

A local Model Context Protocol (MCP) server that gives an MCP client, such as a
coding assistant, tools from the ZCode runtime installed on this machine. The
bridge starts the runtime (`zcode.cjs app-server --stdio`) as a child process
and offers 32 tools and a set of resources on top of it: list models, open
workspaces, create sessions, start tasks, wait for them, answer permission
requests and read the results.

The ZCode runtime does the work, with its own tools and the ZCode login on this
machine. The bridge passes requests and results on and stores the state of its
tasks. It does not use the kit's proxy, and registering it does not connect a
model to your assistant.

## Requirements

- Node.js 24 or newer. `node` must be on `PATH`, because the bridge starts the
  runtime with the program name `node`.
- ZCode Desktop, installed and signed in. The bridge does not handle the ZCode
  login.
- An MCP client that can start a local stdio server, or one that can send an
  `Authorization` header to a local HTTP endpoint.

## Finding the ZCode runtime

The bridge looks for `zcode.cjs` in the Windows install locations of ZCode
Desktop:

- `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
- `%LOCALAPPDATA%\ZCode\resources\glm\zcode.cjs`
- the same two paths under `%ProgramFiles%` and `%ProgramFiles(x86)%`
- `%LOCALAPPDATA%\zcode\app.resources\glm\zcode.cjs`

On other systems, or for another install location, name the file with
`--runtime-path` or `ZCODE_HARNESS_RUNTIME_PATH`. A file is accepted only if
`node <file> --version` exits with code 0 and prints a version number. If a file
you named is missing or fails this check, no other runtime is tried. The file is
executed, so name only a file you trust.

If no runtime is accepted, the bridge still starts. `zcode_health` then reports
`degraded: true` with the reason, and tools that need the runtime return an
error.

The runtime needs its built-in provider configuration. The bridge looks for
`zcode-builtin.json` relative to the runtime file, never in the working
directory, and hands it to the runtime in `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`.
A non-empty `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` in the bridge's environment
takes precedence, then `ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE`, then the
file the bridge found. Only the environment of the runtime process is changed,
and `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` is passed through unchanged. If the
selected file is not readable, the runtime is not started and no other file is
tried. The paths are listed in [docs/SECURITY.md](docs/SECURITY.md).

## Installation

The kit's release installer and its npm setup include the compiled bridge
(`dist/`) and install its dependencies. The kit's setup can register the bridge
with an assistant; [harnesses/README.md](../../harnesses/README.md) describes
when it does.

To build from source, run in this directory:

```sh
npm install
npm run build
npm run probe:runtime
```

`npm run probe:runtime` prints the result of the runtime search as JSON.

## Registering the bridge

### stdio

```json
{
  "mcpServers": {
    "zcode-harness": {
      "command": "node",
      "args": [
        "<kit>/mcp/zcode-harness-mcp/dist/index.js",
        "--stdio",
        "--allow-workspace", "<path to your projects>",
        "--interaction-policy", "ask"
      ]
    }
  }
}
```

Use absolute paths. Each client has its own configuration format; the example
shows the common `mcpServers` form. A read-only variant is in
[examples/config/stdio.mcp.json](examples/config/stdio.mcp.json).

Tools that take a `workspacePath` accept only directories inside an allowed
root. Without `--allow-workspace`, the only allowed root is the `workspaces`
directory inside the data directory.

The entries that the kit generates put the Node flag `--max-semi-space-size=1`
in front of the script path. It makes the young generation of the V8 heap
smaller and is optional.

### HTTP

```sh
node dist/index.js --http --http-key "<random local secret>" --allow-workspace "<path to your projects>"
```

The endpoint is `http://127.0.0.1:3322/mcp`. Every request must carry
`Authorization: Bearer <key>`. In HTTP mode the bridge refuses to start without
a key, or with a host other than `127.0.0.1`, `localhost`, `::1` or another
`127.x.x.x` address. It answers `POST` only and keeps no session between
requests, so several clients can use one bridge. A client configuration is in
[examples/config/http.mcp.json](examples/config/http.mcp.json).

The HTTP code is loaded only when `--http` is given. A stdio bridge never loads
it.

## Options

An unknown option stops the bridge at startup, so that a misspelled
`--read-only` cannot go unnoticed.

| Option | Environment variable | Default | Meaning |
| --- | --- | --- | --- |
| `--stdio` | | on | MCP over stdin and stdout. Logs go to stderr. |
| `--http` | | off | MCP over HTTP instead of stdio. |
| `--http-key KEY` | `ZCODE_HARNESS_HTTP_KEY` | none | Bearer key. Required with `--http`. |
| `--host H` | `ZCODE_HARNESS_HTTP_HOST` | `127.0.0.1` | HTTP host. Loopback addresses only. |
| `--port N` | `ZCODE_HARNESS_HTTP_PORT` | `3322` | HTTP port. |
| `--allow-workspace P` | `ZCODE_HARNESS_ALLOW_WORKSPACES` | none | Allowed workspace root. Repeat the option or separate several paths with `;`. |
| `--read-only` | | off | Tools that change state return `READ_ONLY_MODE`. |
| `--allow-yolo` | `ZCODE_HARNESS_ALLOW_YOLO=1` | off | Lets clients choose the mode `yolo`, which turns off the runtime's permission requests. |
| `--runtime-path FILE` | `ZCODE_HARNESS_RUNTIME_PATH` | search | Path to `zcode.cjs`. |
| `--data-dir DIR` | `ZCODE_HARNESS_DATA_DIR` | `~/.zcode-harness-mcp` | Where tasks, results, events and interactions are stored. |
| `--interaction-policy deny\|allowlist\|ask` | `ZCODE_HARNESS_INTERACTION_POLICY` | `deny` | How permission requests of the runtime are answered. |
| `--interaction-allowlist A,B` | `ZCODE_HARNESS_INTERACTION_ALLOWLIST` | none | Exact tool names that the policy `allowlist` approves. Required with that policy. |
| `--interaction-timeout-sec N` | `ZCODE_HARNESS_INTERACTION_TIMEOUT_SEC` | `300` | Seconds until an unanswered request is denied. |
| `--max-concurrent-tasks N` | `ZCODE_HARNESS_MAX_CONCURRENT_TASKS` | `2` | Tasks that run at the same time. Further tasks wait in the queue. |
| | `ZCODE_HARNESS_TASK_QUEUE_LIMIT` | `50` | Highest number of unfinished tasks. |
| | `ZCODE_HARNESS_REQUEST_TIMEOUT_MS` | `60000` | Time limit for one request to the runtime. |
| | `ZCODE_HARNESS_MAX_ARTIFACT_BYTES` | `10485760` | Largest file that `zcode_artifact_read` reads. |
| | `ZCODE_HARNESS_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. |
| `--help`, `-h` | | | Prints the usage line. |

## Tasks

`zcode_task_start` returns a `taskId` at once. The task then runs in the
runtime. `zcode_task_wait` waits up to 120 seconds per call for it to finish,
`zcode_task_get` returns its state, `zcode_task_result` its text and details,
`zcode_task_events` its events. `zcode_task_input` sends more input,
`zcode_task_cancel` stops it. [docs/MCP_API.md](docs/MCP_API.md) describes all
tools.

- **Concurrency.** By default two tasks run at once and further tasks are
  queued. At most 50 tasks may be unfinished. A workspace runs one writing task
  at a time, and a session one task at a time.
- **Retention.** The bridge keeps at most 500 finished tasks, and none for
  longer than 7 days after it finished. A removed task loses its record, result
  and events, and `unknown task: <taskId>` is returned for it. Unfinished tasks
  and tasks in the state `unknown` are never removed.
- **Idempotency.** A second `zcode_task_start` with the same `idempotencyKey`
  returns the existing task instead of starting a new one. The key is remembered
  for as long as the task is kept; after that the same key starts a new task.
- **Text size.** The response text of a task is limited to 4 MiB of UTF-8. A
  longer text keeps its first 1 MiB and its last 3 MiB, with the line
  `[… N bytes truncated …]` between them. Such a result is marked `partial` and
  carries `truncated.droppedBytes`.
- **Lists.** A task keeps at most 200 warnings, 200 errors and 1,000 tool calls.
- **Events.** The events of a task are kept in at most two files of 4 MiB each;
  older events are dropped.
- **Restart.** After a restart of the bridge, unfinished tasks are marked
  `interrupted`. Stored results of finished tasks stay readable.
- **End of the client.** When a stdio client closes the connection, the bridge
  marks unfinished tasks `interrupted`, stops the runtime and exits. It stops
  only the runtime process it started, not processes that the runtime started.

## Permission requests

The runtime asks before it uses certain tools, and it can ask the user
questions. `--interaction-policy` decides what happens to these requests:

- `deny` (default): every request is denied.
- `allowlist`: a permission request is approved if the tool name is in
  `--interaction-allowlist`, and denied otherwise. Questions to the user are
  passed to the client.
- `ask`: the request is passed to the client, which answers with
  `zcode_interaction_respond` and can choose only among the options the runtime
  offered. A request that is not answered in time is denied.

Requests for the tools `Bash`, `PowerShell` and `Shell` are denied under every
policy. In read-only mode, and for a task started with `readOnly`, every request
is denied.

## Security

The bridge runs with your user's rights and is not a sandbox.

- Workspace paths, session ids and file reads are checked against the allowed
  roots after symbolic links and junctions are resolved.
- `--read-only` blocks every tool that changes state. A task with `readOnly`
  runs in the runtime's mode `plan` with its write and shell tools denied; this
  does not stop a tool that is still allowed from changing files.
- The mode `yolo` is refused unless the bridge was started with `--allow-yolo`.
- Secrets are redacted in tool results, events, logs and error messages.
- The runtime is started with a fixed program name and an argument list, never
  through a shell.
- HTTP is limited to loopback addresses and requires the bearer key.

Details are in [docs/SECURITY.md](docs/SECURITY.md). The kit's security policy
is in [SECURITY.md](../../SECURITY.md).

## ZCode 0.16.9

- `zcode_workspace_open` returns the mode and slash commands of a workspace. The
  runtime gives no default model, no model catalog and no settings revision for
  a workspace.
- `zcode_models_list` reads the model catalog by creating a session without a
  prompt and closing it again. This can start services of the runtime, so it is
  blocked in read-only mode.
- Model, reasoning level and mode are chosen per session, with
  `zcode_model_set` or the arguments of `zcode_task_start`. Workspace defaults
  can be neither set nor reset; the tools return an error and store nothing
  locally.
- The four settings of `zcode_settings_update` apply to the whole runtime
  process, not to one workspace, and are not stored. The bridge receives a
  confirmation from the runtime but cannot read the values back.
- A model turn through the bridge has not been confirmed. In a test on Windows
  11 on 2026-09-23, `zai-api/GLM-5.3-Flash` was in the catalog and its selection
  with reasoning level `low` was confirmed, but the provider rejected the turn
  with code `1113` (insufficient balance or resource package). The record is in
  [SUPPORT_MATRIX.json](../../SUPPORT_MATRIX.json). A model request that
  succeeds through the kit's proxy says nothing about a turn through the bridge.

More limits are in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

## Tests and demo

```sh
npm test
```

builds the bridge and runs the unit and integration tests against a stand-in for
the runtime (`test/fixture/fake-harness.mjs`). ZCode is not needed.

```sh
LIVE_TEST=1 LIVE_WORKSPACE="<workspace>" LIVE_DATA_DIR="<data directory>" npm run test:live
```

runs against the installed ZCode runtime and can use quota. Without `LIVE_TEST=1`
and `LIVE_WORKSPACE` these tests are skipped.

```sh
node examples/demo-client.mjs --workspace "<workspace>"
node examples/demo-client.mjs --fixture
```

walks through the tools from a client's point of view: health, capabilities,
workspace, model catalog, session, task, permission request, result and a
follow-up in the same session. With `--fixture` it uses the stand-in instead of
the installed runtime.

## Documentation

- [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md): what the bridge offers, by area
- [docs/MCP_API.md](docs/MCP_API.md): tools, resources, the task result and its limits
- [docs/SECURITY.md](docs/SECURITY.md): checks and their limits
- [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md): what does not work or is not offered
- [docs/PROTOCOL.md](docs/PROTOCOL.md): how the bridge talks to the ZCode runtime

## License

MIT; see [LICENSE](LICENSE).
