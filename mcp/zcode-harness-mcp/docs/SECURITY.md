# Security

The bridge runs with the rights of the user who starts it. Its checks limit
what an MCP client can ask for; they are not an operating-system sandbox.

## Workspaces

Every tool that takes a workspace path, a session id or a file path checks it
against the allowed roots: the paths given with `--allow-workspace` and
`ZCODE_HARNESS_ALLOW_WORKSPACES`, plus the `workspaces` directory inside the
data directory.

- A path is resolved through symbolic links and junctions before it is
  compared. A path that does not exist yet is resolved through its nearest
  existing parent directory.
- Paths are compared segment by segment, so `C:\work` does not allow
  `C:\workshop`. On Windows the comparison ignores case.
- A session is accepted only if the runtime's session list shows it in an
  allowed workspace. Session lists returned to the client contain only such
  sessions. A task that reuses a session must name the workspace the session
  belongs to.
- `zcode_artifact_read` refuses paths that leave the workspace through `..` or
  a link, opens the file without following a final symbolic link where the
  system supports that, reads only regular files of at most 10 MiB
  (`ZCODE_HARNESS_MAX_ARTIFACT_BYTES`), and fails if the file changes while it
  is read.

The check and the later use of a path are two steps. A directory that is
replaced between them is not detected.

Task ids are not bound to a client. Every client of one bridge can read every
task the bridge keeps.

## Read-only mode

With `--read-only` these tools fail with `READ_ONLY_MODE`:
`zcode_session_create`, `zcode_session_resume`, `zcode_session_fork`,
`zcode_session_close`, `zcode_session_compact`, `zcode_session_goal`,
`zcode_model_set`, `zcode_settings_update`, `zcode_settings_reset`,
`zcode_task_start`, `zcode_task_input`, `zcode_task_cancel`,
`zcode_interaction_respond` and `zcode_models_list`. The check is in the tool
handlers, not only in the tool annotations. `zcode_models_list` is included
because reading the catalog creates a session, which can start services of the
runtime.

A single task can be started with `readOnly: true`. The bridge then sets the
session to the mode `plan` and sends the prompt with a deny list for the tools
`Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`, `PowerShell`,
`BashOutput` and `KillShell`. The runtime enforces both. A deny list cannot
rule out that a tool which is still allowed, or a subagent, changes files. Use
a separate copy of the workspace when that must not happen.

The mode `yolo` turns off the runtime's permission requests. The bridge refuses
it in every tool unless it was started with `--allow-yolo`.

## Starting the runtime

The runtime is started in one place (`src/runtime/spawn.ts`), as
`node <zcode.cjs> app-server --stdio`: the program name is the fixed word
`node`, the arguments are passed as a list, no shell is used, and on Windows no
window is opened. The path of `zcode.cjs` comes from `--runtime-path`,
`ZCODE_HARNESS_RUNTIME_PATH` or the search. No output of a model or a tool
becomes part of the command. The file named with `--runtime-path` is executed
with your rights.

A runtime file is accepted only after `node <file> --version` has exited with
code 0 and printed a version number. A file that was named explicitly and fails
is not replaced by another one.

The runtime's working directory is the parent directory of the data directory.
Its error output is not passed on, also not at log level `debug`. If it reports
that its built-in provider configuration is missing, the bridge adds the fixed
text `PROVIDER_CONFIG_MISSING: …` to the error.

### Provider configuration

The bridge looks for the runtime's built-in provider configuration relative to
the directory of `zcode.cjs`, in this order, and takes the first readable
regular file:

1. `provider/zcode-builtin.json`
2. `../config/provider/zcode-builtin.json`
3. `../../../../../config/provider/zcode-builtin.json`

It never looks in the working directory. `npm run probe:runtime` shows the file
it found as `bundledProviderConfigPath`, or `null` when there is none.

The file handed to the runtime is chosen in this order: a non-empty
`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` in the bridge's environment, then a
non-empty `ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE`, then the file found
above. The chosen file must be a readable regular file; a relative path is
resolved against the runtime's working directory. If it is not readable, the
runtime is not started, no other file is tried, and the error names the source
of the setting but not the path.

Only the environment of the runtime process is changed. There the bridge sets
`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` to the chosen file if it was not set, and
removes the three provider variables when they are empty.
`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` is otherwise passed through and never
invented. The bridge writes no provider files.

## Secrets

Tool results, stored events, log lines and error messages are redacted:

- The value of a key whose name contains, for example, `apiKey`, `authToken`,
  `authorization`, `password`, `secret`, `credential`, `cookie`, `privateKey`,
  `clientSecret`, `signature`, `proxyKey`, an access, refresh, id, bearer,
  session or CSRF token, or `x-aliyun-captcha-verify-param` becomes
  `<redacted>`.
- Inside strings, `sk-…` keys, `Bearer …` values, JSON Web Tokens, GitHub
  tokens, AWS access key ids and any unbroken run of 200 or more letters,
  digits and `. _ ~ + / = -` become `<redacted:Nch>`.

The last rule also hits harmless long strings; see
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

Not redacted: the task record and the stored task result in the data directory,
which contain the prompt and the response text as they were, and the content
returned by the resource `zcode://artifacts/{path}`.

The bridge does not handle the ZCode login. When the runtime asks for provider
headers (`interaction/requestProviderRuntimeHeaders`), the bridge answers
`headersApplied: false` and supplies none. It answers
`interaction/requestOfficialMcpAuthHeaders` with `ok: false`.

## Permission requests

A client cannot give itself more rights than the runtime offers.

- `zcode_interaction_respond` accepts only an option that the runtime offered
  for that request, or a cancellation.
- The answer sent to the runtime is rebuilt from known fields: `decision` and
  `reason` for a permission request, `answers`, `cancelled` and `reason` for a
  question.
- A request that is not answered within `--interaction-timeout-sec` (300
  seconds by default) is denied. A second or late answer is refused.
- The policy is `deny` by default. `allowlist` approves exact tool names only.
  `Bash`, `PowerShell` and `Shell` are denied under every policy. In read-only
  mode and for `readOnly` tasks every request is denied.
- The bridge answers `workspace/hooks/trustGrant` with an error and never
  grants trust to workspace hooks. It has no browser adapter and answers
  `interaction/browserList` and `interaction/browserExecute` with an error.

## Effects beyond one workspace

The four settings of `zcode_settings_update`
(`askUserQuestionAutoResolutionEnabled`, `modelIoFullRetentionEnabled`,
`offPeakToolEnabled`, `dynamicWorkflowEnabled`) change the runtime process that
all workspaces of this bridge share. The allowed roots do not confine them.

The bridge does not add itself to the configuration of ZCode and writes no
ZCode files. It reads selected keys of `~/.zcode/v2/setting.json` for
`zcode_settings_get` with `scope: desktop`. It offers no tool that installs,
updates or removes plugins.

## Network

In stdio mode the bridge opens no port. In HTTP mode:

- The host must be `127.0.0.1`, `localhost`, `::1` or another `127.x.x.x`
  address. Any other host stops the bridge at startup.
- A key is required (`--http-key` or `ZCODE_HARNESS_HTTP_KEY`). Every request
  must carry it as `Authorization: Bearer <key>`. The key is compared with a
  timing-safe comparison.
- The `Host` header must name a loopback host with the bridge's port, and an
  `Origin` header, if present, must be `http://` on a loopback host with that
  port. These two checks are aimed at web pages that try to reach the bridge
  through a browser.
- Only `POST /mcp` is served. A body may have at most 4 MiB, and at most 16
  requests are handled at once.
- Headers must arrive within 10 seconds and a request within 120 seconds.

The bridge has no TLS and is not meant to be reached from another machine.

## Stored data

The data directory (`~/.zcode-harness-mcp` by default) holds task records, task
results, task events and interactions. Directories are created with mode `0700`
and files with mode `0600`. Files are written to a temporary file first and then
renamed. Paths inside the store are checked so that they cannot leave the data
directory. The bridge writes nothing into ZCode's own data.

Ended tasks are deleted with their files once there are more than 500 of them
or 7 days after they ended. Event files and the interaction log are limited to
two files of 4 MiB each. [MCP_API.md](MCP_API.md#retention-and-idempotency) has
the details.

## Limits on load

- A request to the runtime times out after 60 seconds by default, creating a
  session after 90 seconds. After a timeout the bridge stops the runtime and
  marks unfinished tasks `interrupted`. The next call starts the runtime again;
  nothing is retried.
- Two tasks run at once by default, and at most 50 may be unfinished.
- Output of the runtime that grows past about 32 MiB without a line end is
  dropped.
- When the bridge shuts down, unfinished tasks are marked `interrupted`, never
  `completed`.

## Remaining risks

| Risk | What the bridge does |
| --- | --- |
| A `readOnly` task changes files through a tool that is still allowed | Mode `plan` and the deny list reduce this but cannot rule it out. Use a separate copy of the workspace. |
| A workspace contains hooks that run code | The bridge never grants hook trust. What the runtime does with hooks that are already trusted is outside the bridge. |
| A prompt contains instructions or markup | The prompt is passed to the runtime as text and never becomes part of a command or a path. |
| Another local user reads the data directory | Files are created with mode `0600` and directories with `0700`. These modes are a POSIX feature; on Windows the permissions of the containing folder decide. |
