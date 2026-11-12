# Known limitations

## Model turns

A model turn that the bridge started and the provider answered has not been
recorded.

- With ZCode 0.16.9 on Windows 11 (2026-09-23), `zai-api/GLM-5.3-Flash` was in
  the runtime's catalog and its selection with reasoning level `low` was
  confirmed before the prompt was sent. The provider then rejected the turn
  with code `1113` (insufficient balance or resource package). The record is
  `nativeMcpVerification` in [SUPPORT_MATRIX.json](../../../SUPPORT_MATRIX.json).
- The bridge's capability registry (`model.turn`) records another observation:
  turns started by the bridge were rejected by the provider with
  `captcha verify failed`, while turns in ZCode Desktop worked. The entry does
  not name the ZCode version, and whether it still applies is not known.
- When the runtime asks its client for provider headers
  (`interaction/requestProviderRuntimeHeaders`), the bridge answers
  `headersApplied: false`. It supplies no captcha value and does not work
  around the provider's check.
- A rejected turn ends the task as `failed` with the runtime's error message.
- The bridge does not use the kit's proxy. A model request that succeeds through
  the proxy says nothing about a turn through the bridge.
- The automated tests run against a stand-in for the runtime. A passing test is
  not a model answer.

## Model catalog and selection

- A model in the catalog can still be rejected when the turn runs.
- The catalog can be read only by creating a session without a prompt and
  closing it again. This happens on every `zcode_models_list` and on every
  `zcode_task_start` that names a model. It can start services of the runtime
  and is blocked in read-only mode.
- `zcode_workspace_open` and `zcode_settings_get` return the mode and slash
  commands of a workspace. The runtime gives no default model, no default
  reasoning level and no settings revision for a workspace.
- Workspace defaults for model, mode and reasoning level can be neither set nor
  reset. The tools return `UNSUPPORTED_WORKSPACE_DEFAULT` and store nothing
  locally. Choose them per session.
- The four settings of `zcode_settings_update` apply to the whole runtime
  process and are not stored. There is no way to read them, to reset them or to
  make a change depend on a revision. The bridge reports the runtime's
  confirmation, not a value it read back.

## Not offered

- Installing, updating, configuring or removing plugins. Plugin lists can be
  read with `zcode_operations_list` and `zcode_operation_invoke`.
- Changing the provider configuration.
- `workspace/generateText`.
- The `v4/*` methods that ZCode Desktop uses (conversation frames, attachments,
  rewind).
- Attachments. `zcode_task_start` and `zcode_task_input` take text only.
- `session/subagents` can be called through `zcode_operation_invoke`, but the
  capability registry marks it `unknown`: the recorded call returned "Session
  not found".
- MCP's own task mechanism. Tasks are ordinary tools and resources; the server
  announces tools, resources and logging only.
- Arbitrary calls to the runtime. `zcode_operation_invoke` accepts a fixed list
  of read-only methods.

## Task lifecycle

- A task needs the runtime process of the bridge that started it. A stdio bridge
  shuts down when its client closes the connection; it then marks unfinished
  tasks `interrupted` and stops the runtime. A task does not continue without
  its bridge.
- An HTTP bridge keeps running when a client disconnects, and so do its tasks.
  When the bridge stops, the same applies as for stdio.
- After a restart, tasks that were unfinished are marked `interrupted`. They are
  never marked `completed`, and the bridge does not check what the runtime did
  with them.
- If the runtime exits, or does not answer one request within the time limit
  (60 seconds by default), the bridge stops it and marks all unfinished tasks
  `interrupted`, not only the task that made the request.
- A task in the state `unknown` still counts as unfinished: it holds its
  session, blocks other writing tasks in its workspace and counts toward the
  limit of 50. It leaves that state when `zcode_task_cancel` confirms that the
  session is idle, or when the bridge shuts down or the runtime exits.
- Two tasks that write cannot run in the same workspace at the same time.
- `zcode_task_wait` waits at most 120 seconds per call. Call it again for
  longer tasks.
- Work started in ZCode Desktop appears in the bridge as sessions, not as tasks.

## Task results

- The response text is limited to 4 MiB; a longer text loses its middle. A task
  keeps at most 200 warnings, 200 errors and 1,000 tool calls.
  [MCP_API.md](MCP_API.md#limits-per-task) describes the limits.
- Ended tasks are removed once there are more than 500 of them, or 7 days after
  they ended, together with their results and events. Copy a result you need
  for longer.
- The response text, warnings, tool calls and artifact list of a task are held
  in memory until the task ends and its result is stored. If the bridge restarts
  before that, they are lost. The result of such a task has text only if the
  runtime is running when the result is requested and its transcript still has
  the answer.
- `usage` is the usage of the whole session, not of one turn. `reasoningTokens`
  is always `0`.
- `fileChanges` contains only files named in events of the tools `Write`,
  `Edit`, `MultiEdit` and `NotebookEdit`, all under `modified`. Files changed
  by shell commands or other tools are missing. `added`, `deleted` and
  `preExistingUncommitted` are always empty.
- In `artifacts`, `bytes` is always `-1` and `sha256` always `null`.
- The events of a task are kept in two files of at most 4 MiB each. Older
  events are dropped, and `eventsRef.firstSeq` then names the oldest event that
  is still stored.

## Redaction

Redaction replaces any unbroken run of 200 or more letters, digits and
`. _ ~ + / = -` by `<redacted:Nch>`, because long tokens look like that. It
also hits long paths, URLs and encoded data in tool results.

`zcode_artifact_read` returns file content as base64, which reaches 200
characters at 150 bytes. A read of 150 bytes or more therefore returns
`<redacted:Nch>` in `contentBase64`. Read with a `length` of at most 149, or
use the resource `zcode://artifacts/{path}`, which is not redacted.

## Runtime search

The automatic search knows only the Windows install locations of ZCode Desktop.
On other systems the path to `zcode.cjs` must be given with `--runtime-path` or
`ZCODE_HARNESS_RUNTIME_PATH`.

## MCP clients and protocol revision

- The bridge uses the 1.x line of `@modelcontextprotocol/sdk` (`^1.32.2`). The
  newest protocol revision that version 1.32.2 negotiates is `2025-11-25`;
  it also accepts `2025-06-18`, `2025-03-26`, `2024-11-05` and `2024-10-07`.
- The revision `2026-07-28` is not implemented, and SDK 1.32.2 does not offer
  it. A client must be able to open the connection with `initialize`, as the
  revisions above do. A client that speaks only `2026-07-28` cannot use the
  bridge.
- Whether a later 1.x release will offer `2026-07-28`, and how long the 1.x
  line receives fixes, is a matter of the
  [SDK's README](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md).
  What the revision changes is listed in its
  [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
  Neither page was checked for this document.
- In HTTP mode the bridge answers `POST` only, with a JSON body, without a
  session id and without an event stream. `GET` and `DELETE` return `405`.
- The tests in this directory use their own MCP client over stdio and `fetch`
  over HTTP, both with the revision `2025-06-18`. No other MCP client is covered
  by them.
