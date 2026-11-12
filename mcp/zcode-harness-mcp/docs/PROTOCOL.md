# Protocol between the bridge and the ZCode runtime

The bridge starts `node <zcode.cjs> app-server --stdio` and exchanges messages
with that process over its stdin and stdout. This document describes what the
bridge sends and what it expects back. It is taken from the bridge's source
(`src/protocol`, `src/runtime`, `src/tasks`, `src/interactions`) and is not a
specification of ZCode. The last section lists what the bridge assumes about
the runtime without checking it.

## Runtime identity

`zcode_health` reports the path of `zcode.cjs`, the version it printed for
`--version`, and a fingerprint: the first 16 hexadecimal characters of the
file's SHA-256. `npm run probe:runtime` adds the file size and the list of paths
that were tried. `desktopVersion` is the modification time of `ZCode.exe` in
the directory three levels above `zcode.cjs`, or `null` if that file does not
exist.

The bridge names the protocol in `zcode_health` and `zcode_capabilities` as
`ZCode Protocol v1 (zcode.cjs app-server --stdio, 0.16.9 dispatcher inspected;
live validation pending)`.

## Framing

- One JSON object per line, in UTF-8, ended by a line feed. There is no
  `jsonrpc` field and no length header.
- A message is classified by its fields:

  | Fields | Kind |
  | --- | --- |
  | `id` and `method` | request, in either direction |
  | `method` only | notification |
  | `id` only | response, with `result` or `error` |

- A request of the bridge is `{"id": "client-1000000", "method": "session/list", "params": {}}`.
  The ids count up from `client-1000000`. A request of the runtime is answered
  with the id it came with.
- An error response is `{"id": …, "error": {"code": …, "message": …, "data": …}}`.
  The bridge turns it into the error text `harness error <code>: <message>`.
- There is no handshake. After starting the process the bridge waits 400
  milliseconds; if the process is still running, it is treated as ready.
- A line that is not JSON is logged and skipped. Output that grows past about
  32 MiB without a line feed is dropped.
- A request without an answer fails after the time limit (60 seconds by
  default, 90 for `session/create`). When the process exits, all open requests
  fail with `harness exited (code=…, signal=…)`.
- To stop the runtime, the bridge closes its stdin and kills the process if it
  has not exited after 3 seconds.

## Requests the bridge sends

A workspace is always sent as `{"workspaceKey": <path>, "workspacePath": <path>}`,
both with the same path without a trailing separator. A session id is used only
if it starts with `sess_` followed by 1 to 128 letters, digits, `.`, `_` or `-`.

| Method | Parameters | What the bridge reads from the answer |
| --- | --- | --- |
| `session/create` | `{workspace, mode?}` | `session.sessionId` |
| `session/create` (catalog) | `{workspace, persistence: "deferred", mode: "plan", titleGenerationEnabled: false, toolAllowlist: []}` | `session.sessionId`, `settings.model.available` |
| `session/close` | `{sessionId}`; for the catalog session `{sessionId, expectedPersistence: "deferred"}` | `closed` must be `true` for the catalog session |
| `session/list` | `{}` | `sessions[]` with `sessionId` and `workspace.workspacePath` |
| `session/read` | `{sessionId}` | `projection.status`, `projection.activeToolCalls`, `projection.backgroundJobs`, `projection.pendingPermissions`, `settings.model.current`, `settings.mode.current`, `settings.thoughtLevel.current` (or `settings.reasoning.current`), `runtime.stateRevision` |
| `session/subscribe` | `{sessionId, deliveryKind: "desktop-continuous"}` | `eventSeq` |
| `session/send` | `{sessionId, content, toolDenylist?}` | `accepted` must be `true` |
| `session/stop` | `{sessionId}` | nothing; the bridge checks with `session/read` |
| `session/messages` | `{sessionId}` | `messages[]`: the last entry with `info.role: "assistant"`, its `parts` (or `content`) of type `text` |
| `session/usage` | `{sessionId}` | `totalTokens`, `inputTokens`, `outputTokens` |
| `session/setModel` | `{sessionId, model: {providerId, modelId, options?: {reasoningLevel}}, expectedRevision?}` | `runtime.stateRevision` when a revision was sent |
| `session/setThoughtLevel` | `{sessionId, thoughtLevel, expectedRevision?}` | as above |
| `session/setMode` | `{sessionId, mode, expectedRevision?}` | as above |
| `session/resume` | `{sessionId}` | passed to the client |
| `session/fork` | `{sessionId, target: {kind: "latestCheckpoint"}}` | passed to the client |
| `session/compact` | `{sessionId, instructions?}` | passed to the client |
| `session/goal` | `{sessionId, action, target?}` | passed to the client |
| `workspace/readPresentation` | `{workspace}` | `mode` (string) and `slashCommands` (array) must be present |
| `workspace/updateInteractionPreferences` | `{workspace, preferences: {askUserQuestionAutoResolutionEnabled}}` | the same field with the value sent |
| `workspace/updateModelIoPreferences` | `{workspace, preferences: {fullRetentionEnabled}}` | the same field with the value sent |
| `workspace/updateOffPeakToolPolicy` | `{workspace, enabled}` | `enabled` with the value sent |
| `workspace/updateDynamicWorkflowPolicy` | `{workspace, enabled}` | `enabled` with the value sent |
| `mcp/list`, `plugins/list`, `skills/referenceCatalog` | `{workspace}` | passed to the client |
| `usage/stats` | `{range}` with `all`, `7d` or `30d` | passed to the client |

Through `zcode_operation_invoke` a client can also reach `session/events`,
`session/subagents`, `runtime/capabilities`, `plugins/overview` and
`plugins/referenceCatalog`; the bridge passes their answers on unchanged.

The model catalog is read with the second form of `session/create`: no model,
no reasoning level and no prompt are sent, and the session is closed again in
every case. If the runtime does not confirm the close, the call fails.

## Events the bridge receives

After `session/subscribe` the runtime sends `session/event` notifications with
`{sessionId, seq, type, payload}`. While a task runs, the bridge stores the
events of its session in redacted form and acts on these types:

| Type | What the bridge does |
| --- | --- |
| `turn.started` | sets the task to `running` |
| `turn.failed` | sets the task to `failed` with `payload.error.message` |
| `turn.completed` | reads the session until it is idle, then sets `completed` |
| `model.streaming` with `kind: "text_delta"` | appends `payload.text` (or `payload.delta`) to the response text |
| `tool.updated` | records the tool call (`toolCallId`, `toolName` or `name`); for `Write`, `Edit`, `MultiEdit` and `NotebookEdit` it records the file path unless `state` is `error` |

An event whose `seq` is not higher than the last one seen is ignored. If `seq`
jumps, the bridge stores a `bridge.event_gap` entry and adds a warning to the
task. Other notifications are not used.

## Requests the runtime sends

| Method | What the bridge answers |
| --- | --- |
| `session/requestRuntimePreferences` | `{nativeSearchEnhancementsEnabled: false, memoryEnabled: false, askUserQuestionAutoResolutionEnabled: true, modelContextBudgetStrategy: "preflight-v1"}` |
| `interaction/requestPermission` | `{decision: "allow" \| "deny", reason}`, decided by the interaction policy or the client |
| `interaction/requestUserInput` | `{answers, cancelled, reason?}`, decided by the interaction policy or the client |
| `interaction/requestProviderRuntimeHeaders` | `{headersApplied: false, errorMessage}` |
| `interaction/requestOfficialMcpAuthHeaders` | `{ok: false, reason: "unsupported"}` |
| `interaction/browserList`, `interaction/browserExecute`, `workspace/hooks/trustGrant`, any other method | error `-32601` |

For a permission request the bridge takes the offered options from
`params.options[]` (`optionId` or `id`, `label` or `name`, `kind`), for a
question also from `params.questions[].options[].label`. When the client picks
an option, one whose `kind` is `deny` is sent as `deny` and every other offered
option as `allow`.

A request that belongs to the session of a bridge task can wait for the client.
A request for any other session cannot: where the policy would ask the client,
the bridge answers with error `-32001`.

## Assumptions about the runtime

The bridge depends on the following behaviour of the runtime but does not test
it at run time. The notes come from the bridge's source and its capability
registry (`zcode_capabilities`), which mark the wire format as observed with
ZCode 0.16.5 and the workspace and catalog methods as inspected in 0.16.9
without a live check.

- `session/create` does not return until `session/requestRuntimePreferences`
  has been answered.
- `session/create` returns the full model catalog in `settings.model.available`.
  `session/read` returns only the model in use.
- `workspace/readPresentation` returns the mode and slash commands and nothing
  about models or revisions. The runtime has no methods to set or reset
  workspace defaults.
- The four `workspace/update…` methods change the whole runtime process and
  return a confirmation. There is no method to read the values.
- `session/setModel` rejects a model that is not in the catalog.
- `seq` rises by one per event within a session.
- `automation/*` methods do not exist any more.

The `verification` value of each registry entry says how it was checked:
`live_verified`, `fixture_verified`, `untested` or `blocked_by_environment`.

## Sources

Besides the bridge's own observations, two public projects were consulted for
the wire format. No code was taken from them.

- `william0wang/zcode-acp` at commit `ad31b663eab446c2478f573498e5f7e3025d4c20` (Apache-2.0)
- `tizerluo/zcode-open-bridge` at commit `2c1f4ad36fa6942a22b86f23d3d1bbf9643c5fff` (MIT)
