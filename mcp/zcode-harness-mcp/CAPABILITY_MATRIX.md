# MCP bridge capability overview
**English (original)** · [Deutsch](CAPABILITY_MATRIX.de.md)

This overview lists what the bridge offers, by area.
[docs/MCP_API.md](docs/MCP_API.md) describes every tool. The tool
`zcode_capabilities` returns the bridge's registry with one entry per method of
the ZCode runtime, including whether and how it was checked.

| Area | What the bridge offers | Tools |
|---|---|---|
| Discovery | State of the bridge and the runtime; the capability registry; the runtime's lists of MCP servers, plugins and skills and its usage statistics; a fixed set of read-only runtime methods. | `zcode_health`, `zcode_capabilities`, `zcode_operations_list`, `zcode_operation_describe`, `zcode_operation_invoke` |
| Models | The runtime's model catalog. Reading it creates a session without a prompt and closes it again. | `zcode_models_list` |
| Workspaces | The allowed roots; mode and slash commands of a workspace. The runtime gives no default model, no catalog and no settings revision for a workspace. | `zcode_workspaces_list`, `zcode_workspace_open` |
| Sessions | List, create, read, resume, fork, close and compact sessions; read and change the session goal; choose model, reasoning level and mode per session. | `zcode_sessions_list`, `zcode_session_create`, `zcode_session_get`, `zcode_session_resume`, `zcode_session_fork`, `zcode_session_close`, `zcode_session_compact`, `zcode_session_goal`, `zcode_model_set` |
| Tasks | Start work, check its state, wait for it, send more input, cancel it. Two tasks run at once by default; further tasks are queued. | `zcode_task_start`, `zcode_task_get`, `zcode_tasks_list`, `zcode_task_wait`, `zcode_task_input`, `zcode_task_cancel` |
| Results | The result of a task with text, usage, tool calls and changed files; its events; the content of files in the workspace. | `zcode_task_result`, `zcode_task_events`, `zcode_artifact_read` |
| Permission requests | List the runtime's permission requests and questions and answer them with one of the offered options. Which requests reach the client depends on `--interaction-policy`. | `zcode_interactions_list`, `zcode_interaction_respond` |
| Settings | Four settings of the runtime process; a schema of the known settings; a read-only view of selected ZCode Desktop settings. Workspace defaults can be neither set nor reset. | `zcode_settings_schema`, `zcode_settings_get`, `zcode_settings_update`, `zcode_settings_reset` |
| Read-only use | With `--read-only`, every tool that changes state returns an error, and so does `zcode_models_list`. Reading workspaces, sessions, tasks, results and files still works. | |

## Limits

- The bridge keeps at most 500 ended tasks and none for longer than 7 days after
  it ended. An `idempotencyKey` is remembered for as long as its task is kept.
- The response text of a task is limited to 4 MiB; a longer text keeps its first
  1 MiB and its last 3 MiB.
- A task keeps at most 200 warnings, 200 errors and 1,000 tool calls.
- A workspace runs one writing task at a time.

## Notes

- The settings of `zcode_settings_update` apply to the whole runtime process,
  not to one workspace, and are not stored. The bridge receives a confirmation
  but cannot read the values back.
- A model turn through the bridge has not been confirmed. In the recorded test
  with ZCode 0.16.9 on Windows 11, `zai-api/GLM-5.3-Flash` was in the catalog
  and its selection with reasoning level `low` was confirmed, but the provider
  rejected the turn with code `1113` (insufficient balance or resource
  package). A request that succeeds through the kit's proxy says nothing about
  a turn through the bridge.
- The bridge hands the runtime its provider configuration through the
  environment of the runtime process only and keeps values that you set
  yourself. [docs/SECURITY.md](docs/SECURITY.md) has the order and the paths.
- Read-only mode is not an operating-system sandbox. For stronger isolation, use
  a separate workspace with only the files an agent needs.
