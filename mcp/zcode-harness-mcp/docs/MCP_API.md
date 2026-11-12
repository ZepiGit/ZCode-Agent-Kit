# MCP API reference (zcode-harness-mcp 0.1.0)

## Transport and conventions

The bridge speaks MCP over stdio (default) or over HTTP at
`http://<host>:<port>/mcp`. It is built on the low-level `Server` of
MCP SDK 2 (`@modelcontextprotocol/server`). A client starts with `initialize`;
the newest protocol revision the bridge negotiates is `2025-11-25`. The server
announces tools, resources and logging. It sends no list-change notifications
and offers no resource subscriptions.

- Every tool returns its result twice with the same content: as JSON in a text
  block and as `structuredContent`. Both are redacted (see
  [SECURITY.md](SECURITY.md)).
- Arguments are checked against the tool's input schema before the tool runs.
  An unknown argument, a wrong type or a value out of range gives
  `INVALID_ARGUMENTS: …`.
- A failed call is a tool result with `isError: true` and the message as text.
  Messages that start with a code, such as `READ_ONLY_MODE:`, `UNKNOWN_MODEL:`
  or `WORKSPACE_BUSY:`, are meant to be matched on that code.
- A `workspacePath` must lie inside an allowed root, otherwise the call fails
  with `workspace "<path>" is not in the bridge allowlist`. A `sessionId` must
  belong to a session of an allowed workspace.
- With `--read-only`, the tools marked "changes state" below fail with
  `READ_ONLY_MODE`.

### HTTP

HTTP mode is stateless: each `POST /mcp` is handled on its own, the answer is a
JSON body, and there is no session id and no event stream. The bridge checks, in
this order:

| Check | Answer when it fails |
| --- | --- |
| `Host` header is the configured loopback host and port | `403` |
| `Authorization: Bearer <key>` matches the key | `401` |
| `Origin`, if sent, is `http://` on a loopback host and the bridge's port | `403` |
| fewer than 16 requests are in progress | `503` |
| path is `/mcp` | `404` |
| method is `POST` | `405` |
| body is at most 4 MiB | `413` |
| body is JSON | `400` with a JSON-RPC parse error |

The HTTP modules are loaded when the bridge starts in HTTP mode and not
otherwise. A stdio bridge does not load them.

## Discovery

| Tool | Arguments | Result |
| --- | --- | --- |
| `zcode_health` | none | Bridge version, start time, transport and read-only flag; path, version and fingerprint of the runtime; whether the runtime process runs and how it last exited; allowed roots; interaction policy. `degraded: true` means no runtime was found. |
| `zcode_capabilities` | none | The bridge's capability registry: for each entry the native method, direction, `availability`, `implementation`, `verification`, the MCP tool that exposes it and a note. |
| `zcode_operations_list` | `workspacePath?`, `kind?` (`registry`, `mcp`, `plugins`, `skills`, `usage`; default `registry`) | `registry` lists the methods of the registry. `mcp`, `plugins` and `skills` need `workspacePath` and return the runtime's lists. `usage` returns the runtime's usage statistics for 7 days. |
| `zcode_operation_describe` | `method` | The registry entries for one native method, or `known: false`. |
| `zcode_operation_invoke` | `method`, `params?` | Calls one of the read-only native methods listed below. Other methods are refused. |

`zcode_operation_invoke` accepts `session/list`, `session/read`,
`session/messages`, `session/events`, `session/usage`, `session/subagents`,
`workspace/readPresentation`, `runtime/capabilities`, `mcp/list`,
`plugins/list`, `plugins/overview`, `plugins/referenceCatalog`,
`skills/referenceCatalog` and `usage/stats`. Session methods other than
`session/list` take `{sessionId}` (`session/events` also `afterSeq` and
`limit`). `usage/stats` takes `{range}` with `all`, `7d` or `30d`.
`runtime/capabilities` takes `{}`. The remaining methods take
`{workspace: {workspacePath}}`. `session/list` returns only sessions of allowed
workspaces.

## Models and settings

| Tool | Arguments | Behaviour |
| --- | --- | --- |
| `zcode_models_list` | `workspacePath` | Returns the runtime's model catalog in `modelCatalog.available`, with `revision: null` and the `source`. To read the catalog, the bridge creates a session without a prompt and closes it again; if the runtime refuses to close it, the call fails with `CATALOG_SESSION_NOT_CLOSED`. Changes state. |
| `zcode_model_set` | `scope` (`session`, `workspace`), `sessionId?`, `workspacePath?`, `model?` (`providerId/modelId`), `thoughtLevel?`, `mode?` (`build`, `edit`, `plan`, `yolo`), `expectedRevision?` | With `scope: session`, sets model, reasoning level and mode of a session, reads the session back and returns `requested`, `effective`, `revision` and `verified` (true when every requested value is in effect). With `expectedRevision`, each setter is sent with the revision and the next one uses the revision the runtime returned. With `scope: workspace` the call fails with `UNSUPPORTED_WORKSPACE_DEFAULT`. Changes state. |
| `zcode_settings_schema` | `workspacePath` | The settings the bridge knows, with type, scope, source and whether they can be written. `mode`, `model` and `thoughtLevel` of a workspace cannot be written. The four runtime preferences can be written; their current and default values are unknown and given as `null`. |
| `zcode_settings_get` | `workspacePath`, `path?`, `scope?` (`workspace`, `desktop`) | Without `path`, the workspace presentation. With `path`, one entry of the schema; `path: modelCatalog` fails with `CATALOG_REQUIRES_SESSION` and points to `zcode_models_list`. With `scope: desktop`, selected keys of `~/.zcode/v2/setting.json`, read only; `workspacePath` is not needed then. |
| `zcode_settings_update` | `workspacePath`, `changes`, `expectedRevision?` | Sets runtime preferences. All changes are checked before the first one is sent. Changes state. |
| `zcode_settings_reset` | `workspacePath`, `path` (`mode`, `model`, `thoughtLevel`) | Always fails with `UNSUPPORTED_WORKSPACE_DEFAULT`: the runtime has no workspace defaults to reset. Changes state. |

`changes` accepts the booleans `askUserQuestionAutoResolutionEnabled`,
`modelIoFullRetentionEnabled`, `offPeakToolEnabled` and
`dynamicWorkflowEnabled`. They apply to the whole runtime process, beyond the
given workspace, and are not stored. The runtime confirms each change, and the
bridge reports it with `verification: "native-acknowledgement"`; it cannot read
the value back. Other outcomes: `expectedRevision` given →
`UNSUPPORTED_REVISION`; `mode`, `model` or `thoughtLevel` in `changes` →
`UNSUPPORTED_WORKSPACE_DEFAULT`; an unknown key → `UNKNOWN_SETTING`; a value that
is not a boolean → `INVALID_VALUE`; a confirmation that does not match →
`VERIFICATION_FAILED`, in which case earlier changes of the same call may have
been applied.

## Workspaces and sessions

| Tool | Arguments | Behaviour |
| --- | --- | --- |
| `zcode_workspaces_list` | none | The allowed roots, and the workspaces of allowed roots that appear in the runtime's session list. |
| `zcode_workspace_open` | `workspacePath` | Reads `workspace/readPresentation`: mode and slash commands. `revision`, `settings.model` and `settings.thoughtLevel` are `null`. Creates no session. |
| `zcode_sessions_list` | `workspacePath?` | Sessions of allowed workspaces, or of one workspace. |
| `zcode_session_create` | `workspacePath`, `mode?` | Creates a session and returns the runtime's answer with the `sessionId`. Without `mode` the session is created in `build`; a bridge started with `--allow-yolo` sends no mode in that case. Changes state. |
| `zcode_session_get` | `sessionId` | The runtime's `session/read` answer: projection, settings, todos. |
| `zcode_session_resume`, `zcode_session_fork`, `zcode_session_close` | `sessionId` | Resume, fork from the latest checkpoint, or close a session. Change state. |
| `zcode_session_compact` | `sessionId`, `instructions?` | Compacts the session context. Changes state. |
| `zcode_session_goal` | `sessionId`, `action` (`show`, `set`, `replace`, `pause`, `resume`, `clear`), `value?` | Reads or changes the session goal. Counts as changing state for every action, including `show`. |

The mode `yolo` fails with `MODE_NOT_PERMITTED` unless the bridge was started
with `--allow-yolo`.

## Tasks

| Tool | Arguments | Behaviour |
| --- | --- | --- |
| `zcode_task_start` | `workspacePath`, `prompt`, `sessionId?`, `model?`, `thoughtLevel?`, `mode?`, `readOnly?`, `idempotencyKey?` | Creates a task and returns `taskId`, `state`, `sessionId`, `idempotencyKey`, `readOnly` and a `note` without waiting for the runtime. Changes state. |
| `zcode_task_get` | `taskId` | The task record. |
| `zcode_tasks_list` | `workspacePath?`, `state?` | The task records the bridge keeps, oldest first. |
| `zcode_task_wait` | `taskId`, `timeoutMs?` (default 60000, at most 120000) | Returns the task record when the task has ended or the time is up, whichever comes first. |
| `zcode_task_cancel` | `taskId` | Stops the task and checks the result; see below. Changes state. |
| `zcode_task_input` | `taskId`, `content` | Sends input to a running task, or starts a follow-up turn in the same session after the task has ended. Changes state. |
| `zcode_task_events` | `taskId`, `afterSeq?` (default -1), `limit?` (default 200, at most 1000) | Redacted events after `afterSeq`, with `nextSeq` and `hasMore`. |
| `zcode_task_result` | `taskId` | The task result; see below. |
| `zcode_artifact_read` | `workspacePath`, `path`, `offset?` (default 0), `length?` (default 262144, at most 1048576) | Reads part of a file inside the workspace: `contentBase64`, `size`, `sha256` of the whole file, `bytesReturned`, `truncated`, `mimeType`. Files larger than 10 MiB fail with `ARTIFACT_TOO_LARGE`. |

Tool results are redacted, and one redaction rule replaces any unbroken run of
200 or more letters, digits and `. _ ~ + / = -` by `<redacted:Nch>`. A
`contentBase64` reaches that length at 150 bytes of file content, so
`zcode_artifact_read` returns usable content only with a `length` of at most
149. The resource `zcode://artifacts/{path}` is not affected. The same rule
applies to such runs in `responseText`.

### Starting a task

For a new task the returned `state` is `queued` or `starting`, and `sessionId`
is `null` unless a session was given. The bridge then creates the session (or
checks that the given one belongs to the workspace), sets model, reasoning level
and mode, reads the session back, and sends the prompt.

- `model` must be in the runtime's catalog, otherwise the call fails with
  `UNKNOWN_MODEL` and lists the available models. Checking this reads the
  catalog as `zcode_models_list` does.
- If a model or reasoning level was requested and the session read-back fails
  or shows another value, the task ends as `failed` and the prompt is not sent.
- With `readOnly: true` the task runs in the mode `plan` and the tools `Write`,
  `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`, `PowerShell`, `BashOutput` and
  `KillShell` are denied in the runtime. Without `readOnly` and without `mode`
  the task runs in `build`; a bridge started with `--allow-yolo` leaves the
  mode of the session as it is in that case.
- A workspace runs one task without `readOnly` at a time. A second one fails
  with `WORKSPACE_BUSY`.
- A session runs one task at a time (`session already has an active task`).
- At most 50 tasks may be unfinished (`task queue limit reached (50)`). Two run
  at once by default; the others stay `queued` and start by themselves.

### States

`queued` → `starting` → `running` → `completed` or `failed`. While a permission
request or a question waits for the client, the state is `waiting_for_approval`
or `waiting_for_input`.

- `completed` is set after the runtime reports the end of the turn and a read of
  the session shows it idle, with no active tool calls, background jobs or
  pending permissions. The bridge reads up to six times, 1.5 seconds apart.
- `cancelling` is set by `zcode_task_cancel`. The bridge sends `session/stop`
  and reads the session up to ten times, half a second apart. It sets
  `cancelled` once the session is idle with no active tool calls. A task that
  has not sent its prompt yet is cancelled at once.
- `interrupted` is set when the bridge shuts down or restarts, or when the
  runtime process exits or fails to answer a request in time.
- `unknown` means the bridge could not confirm how the task ended: a cancel that
  could not be checked, an end of turn after which the session did not become
  idle, or input whose acceptance was not confirmed. Such a task still counts as
  unfinished for the limits above. `zcode_task_cancel` can be called on it
  again.

### Task result

```json
{
  "schemaVersion": 1,
  "taskId": "task-…", "sessionId": "sess_…", "workspacePath": "…",
  "status": "completed",
  "createdAt": "…", "startedAt": "…", "finishedAt": "…",
  "requestedModel": "zai/GLM-5.3", "effectiveModel": {"providerId": "zai", "modelId": "GLM-5.3"},
  "mode": "build", "thoughtLevel": null,
  "responseText": "…", "partial": false,
  "completeness": {"status": "full", "explanation": "turn stream captured via session events"},
  "usage": {"cumulative": {"totalTokens": 42, "inputTokens": 30, "outputTokens": 12, "reasoningTokens": 0},
            "note": "…"},
  "toolCalls": [{"toolName": "Write", "summary": "toolCall tc1"}],
  "fileChanges": {"added": [], "modified": ["fixture-output.txt"], "deleted": [], "source": "tool_events", "preExistingUncommitted": []},
  "artifacts": [{"path": "fixture-output.txt", "bytes": -1, "sha256": null}],
  "interactions": [{"id": "ia-…", "kind": "permission", "status": "resolved", "toolName": "Bash"}],
  "errors": [], "warnings": [],
  "eventsRef": {"firstSeq": 1, "lastSeq": 7, "storage": "tasks/task-….events.jsonl"}
}
```

- `status` is the task state. The result can be read while the task runs.
- `responseText` is collected from the text events of the turn. If none were
  collected and the runtime is running, the bridge takes the last assistant
  message from the session transcript instead.
- `completeness.status` is `full` only for a `completed` task with text.
  It is `partial` when the task ended in another state, when events were lost
  or when the text was shortened. It is `unknown` while the task has not ended
  and when a completed task has no text. `partial` is `true` whenever the
  status is not `full`.
- `usage.cumulative` is the usage of the whole session, not of one turn, and is
  `null` when the runtime gave none. `reasoningTokens` is always `0`.
- `fileChanges` lists the files named in the events of the tools `Write`,
  `Edit`, `MultiEdit` and `NotebookEdit`, all under `modified`. `artifacts`
  lists the same files; `bytes` is always `-1` and `sha256` always `null`. Use
  `zcode_artifact_read` for size and hash.
- The result of an ended task is stored once and returned as stored from then
  on, also after a restart. A follow-up with `zcode_task_input` discards it.

### Limits per task

- **Response text.** `responseText` holds at most 4 MiB of UTF-8, and the limit
  applies while the text is collected. A longer text keeps its first 1 MiB and
  its last 3 MiB. Between them stands one line `[… N bytes truncated …]`, where
  N is the number of UTF-8 bytes left out. The cuts fall between code points.
  The result then has `completeness.status: "partial"`, an explanation that
  ends with `response text capped at 4 MiB: N bytes truncated between the first
  1 MiB and the last 3 MiB`, and the field `truncated: { "droppedBytes": N }`.
  Results that were not shortened have no `truncated` field. Text taken from
  the transcript has the same limit.
- **Warnings and errors.** At most 200 each. When more arrive, the last entry is
  replaced by `warnings capped at 200; later warnings were dropped` (or the
  same for errors).
- **Tool calls.** At most 1,000 in `toolCalls`. Further calls are not listed,
  and one warning says so.
- **Events.** The events of a task are stored in at most two files of 4 MiB
  each; when the current file is full it replaces the older one. A single event
  larger than 4 MiB is stored as `bridge.record_truncated`. A jump in the
  runtime's sequence numbers is recorded as `bridge.event_gap`.

### Runtime restart budget

The bridge starts the runtime on the first call that needs it. When the runtime
exits, running tasks become `interrupted` and nothing is started until the next
call that needs it. Every start after the first is a restart: at most 3 in any
15 minutes, each no earlier than a pause after the last exit (1, 2, 4 seconds,
doubling up to 30). Calls that arrive together share one restart.

With the budget used up, tools that need the runtime fail as an ordinary tool
error (`isError: true`) whose text starts with
`HARNESS_RESTART_BUDGET_EXHAUSTED:` and says what happened, when a slot is free
again and what to do. No process is started. A task started in that state ends
`failed` with the same text in `error`.

`zcode_health` reports the state in `runtime.restartBudget`: `limit`,
`windowSec`, `used`, `exhausted`, `retryAt` and `lastExit` (`at`, `code`,
`signal`). The environment variable
`ZCODE_HARNESS_RESTART_BUDGET=<restarts>/<window seconds>` sets the budget
(default `3/900`). `0/<seconds>` never restarts the runtime. An invalid value
stops the bridge at startup.

### Retention and idempotency

The bridge keeps at most 500 ended tasks in the states `completed`, `failed`,
`cancelled` and `interrupted`. When there are more, the ones that ended first
are removed. A task is also removed once it ended more than 7 days ago. Tasks in
other states, including `unknown`, are never removed. The limits are checked
when a task ends, on every lookup and at startup.

A removed task loses its record, its stored result and its events. Calls with
its id fail with `unknown task: <taskId>`.

`zcode_task_start` with an `idempotencyKey` that belongs to a kept task returns
that task, in whatever state it is, and starts nothing. The same key with
another workspace fails (`idempotency key belongs to a different workspace`).
The key is forgotten when the task is removed; the same key then starts a new
task.

## Interactions

| Tool | Arguments | Behaviour |
| --- | --- | --- |
| `zcode_interactions_list` | `status?` (`pending`, `resolved`, `all`; default `all`) | Permission requests and questions with their id, kind, offered options, task and session, state and answer. `resolved` covers everything that is no longer pending. |
| `zcode_interaction_respond` | `interactionId`, `optionId?`, `value?`, `cancel?` | Answers a pending interaction. A permission request takes one of the offered `optionId`s, or `cancel: true` to deny. A question takes `value` with the answers, or `cancel: true`. A second answer, or one after the time limit, is refused. Changes state. |

Which interactions reach the client depends on `--interaction-policy`; see the
[README](../README.md#permission-requests). The bridge answers these requests of
the runtime itself:

| Request | Answer |
| --- | --- |
| `session/requestRuntimePreferences` | fixed values: `nativeSearchEnhancementsEnabled: false`, `memoryEnabled: false`, `askUserQuestionAutoResolutionEnabled: true`, `modelContextBudgetStrategy: "preflight-v1"` |
| `interaction/requestProviderRuntimeHeaders` | `{headersApplied: false, errorMessage: …}` |
| `interaction/requestOfficialMcpAuthHeaders` | `{ok: false, reason: "unsupported"}` |
| `interaction/browserList`, `interaction/browserExecute`, `workspace/hooks/trustGrant` | error `-32601` |

## Resources

| URI | Content |
| --- | --- |
| `zcode://capabilities` | The registry, as `zcode_capabilities` |
| `zcode://sessions/{sessionId}` | The session, as `zcode_session_get` |
| `zcode://tasks/{taskId}/status` | The task record |
| `zcode://tasks/{taskId}/result` | The task result, as `zcode_task_result` |
| `zcode://tasks/{taskId}/events` | The stored events, one JSON object per line |
| `zcode://artifacts/{path}` | The first 1 MiB of a file inside an allowed root, as JSON with `contentBase64`; `{path}` is the URL-encoded absolute path |

`resources/list` returns `zcode://capabilities` and, for every kept task, its
status, result, events and session. A read that fails returns error `-32002`.
Every resource has a tool with the same content, for clients without resource
support.

## Client configuration

The [README](../README.md#registering-the-bridge) shows a stdio entry.
`examples/config/stdio.mcp.json` is a stdio entry with `--read-only`: reading
the workspace presentation and `runtime/capabilities` works with it,
`zcode_models_list`, sessions and tasks do not. `examples/config/http.mcp.json`
is an HTTP entry with the bearer header.
