# CAPABILITY_MATRIX.md

Generiert aus der Capability-Registry (`src/capabilities/registry.ts`) — dieselben Daten liefert
`zcode_capabilities` über MCP. Stand: 2026-09-12 gegen **zcode.cjs 0.16.5**
(Fingerprint `e9f1868c0fdb8635`, `C:\Program Files\ZCode\resources\glm\zcode.cjs`).

**Nenner jeder Quote:** 45 registrierte Capabilities. Darunter 37 `available`, 3 `requires_desktop`,
1 `requires_login`, 1 `removed_in_version`, 3 `unknown`. „100 %“ wird **nicht** behauptet:
`unknown`-Bereiche (subagents-Params, v4-Gateway) und bewusst nicht implementierte
Management-Funktionen (Provider-Registry, Plugin-Lifecycle) sind offene Lücken mit Belegen.

Legende: **A**vailability = available / unavailable / requires_desktop / requires_login / removed_in_version / unknown.
**I**mplementation = implemented / partial / missing / not_applicable.
**V**erification = live_verified / fixture_verified / untested / blocked_by_environment.

| ID | Titel | Backend | Richtung | A | I | V | MCP-Tool |
| --- | --- | --- | --- | --- | --- | --- | --- |
| session.create | Create a session | session/create | client_call | available | implemented | live_verified | zcode_session_create |
| session.list | List sessions | session/list | client_call | available | implemented | live_verified | zcode_sessions_list |
| session.read | Read session state | session/read | client_call | available | implemented | live_verified | zcode_session_get |
| session.send | Send a prompt | session/send | client_call | available | implemented | live_verified | zcode_task_start |
| session.stop | Stop the running turn | session/stop | client_call | available | implemented | live_verified | zcode_task_cancel |
| session.close | Close a session | session/close | client_call | available | implemented | live_verified | zcode_session_close |
| session.resume | Resume a session | session/resume | client_call | available | implemented | fixture_verified | zcode_session_resume |
| session.fork | Fork a session | session/fork | client_call | available | implemented | fixture_verified | zcode_session_fork |
| session.subscribe | Subscribe to events | session/subscribe | client_call | available | implemented | live_verified | (intern in zcode_task_start) |
| session.messages | Stored transcript | session/messages | client_call | available | implemented | live_verified | (intern in zcode_task_result) |
| session.events | Event history | session/events | client_call | available | implemented | live_verified | (intern in zcode_task_events) |
| session.usage | Session usage | session/usage | client_call | available | implemented | live_verified | (intern in zcode_task_result) |
| session.setModel | Select session model | session/setModel | client_call | available | implemented | live_verified | zcode_model_set |
| session.setMode | Select session mode | session/setMode | client_call | available | implemented | live_verified | zcode_model_set |
| session.setThoughtLevel | Reasoning level | session/setThoughtLevel | client_call | available | implemented | live_verified | zcode_model_set |
| session.compact | Compact context | session/compact | client_call | available | implemented | live_verified | zcode_session_compact |
| session.goal | Session goal | session/goal | client_call | available | implemented | live_verified | zcode_session_goal |
| session.subagents | Subagents | session/subagents | client_call | unknown | partial | untested | (projection.backgroundJobs) |
| session.cancelBackgroundTask | Cancel background task | session/cancelBackgroundTask | client_call | available | implemented | fixture_verified | (intern in zcode_task_cancel) |
| workspace.readState | Workspace state | workspace/readState | client_call | available | implemented | live_verified | zcode_workspace_open |
| workspace.setDefaultModel | Workspace default model | workspace/setDefaultModel | client_call | available | implemented | fixture_verified | zcode_settings_update |
| workspace.setDefaultMode | Workspace default mode | workspace/setDefaultMode | client_call | available | implemented | fixture_verified | zcode_settings_update |
| workspace.setDefaultThoughtLevel | Workspace default reasoning | workspace/setDefaultThoughtLevel | client_call | available | implemented | fixture_verified | zcode_settings_update |
| workspace.upsertModelProvider | Custom model provider | workspace/upsertModelProvider | client_call | available | missing | untested | — (bewusst, v1) |
| workspace.removeModelProvider | Remove model provider | workspace/removeModelProvider | client_call | available | missing | untested | — |
| workspace.updateProviderRegistry | Provider registry | workspace/updateProviderRegistry | client_call | available | missing | untested | — |
| workspace.updateInteractionPreferences | Interaction preferences | workspace/updateInteractionPreferences | client_call | available | missing | untested | — |
| workspace.updateModelIoPreferences | Model IO preferences | workspace/updateModelIoPreferences | client_call | available | missing | untested | — |
| workspace.generateText | One-shot text generation | workspace/generateText | client_call | available | missing | untested | — |
| workspace.hooks.trustGrant | Hook trust | workspace/hooks/trustGrant | server_callback | available | implemented | fixture_verified | (Policy-Antwort) |
| mcp.list | Harness-internal MCP servers | mcp/list | client_call | available | implemented | live_verified | zcode_operations_list |
| plugins.list / skills.referenceCatalog | Plugins / Skills / Usage | plugins/list; skills/referenceCatalog; usage/stats | client_call | available | implemented | live_verified | zcode_operations_list |
| plugins.overview\|install\|… | Plugin lifecycle | plugins/* | client_call | available | missing | untested | — (bewusst: keine Auto-Installation) |
| automation.* | Scheduled automations | automation/* | client_call | removed_in_version | not_applicable | live_verified | — (0.16.5 entfernt, live -32601) |
| usage.stats | Account usage | usage/stats | client_call | available | implemented | live_verified | zcode_operations_list |
| interaction.requestPermission | Permission requests | interaction/requestPermission | server_callback | available | implemented | fixture_verified | zcode_interactions_list / _respond |
| interaction.requestUserInput | User input questions | interaction/requestUserInput | server_callback | available | implemented | fixture_verified | zcode_interactions_list / _respond |
| session.requestRuntimePreferences | Runtime preferences | session/requestRuntimePreferences | server_callback | available | implemented | live_verified | (intern, Konfiguration) |
| interaction.requestProviderRuntimeHeaders | Provider runtime headers | interaction/requestProviderRuntimeHeaders | server_callback | requires_desktop | implemented | fixture_verified | — |
| interaction.requestOfficialMcpAuthHeaders | Official MCP auth | interaction/requestOfficialMcpAuthHeaders | server_callback | requires_desktop | implemented | live_verified | — |
| interaction.browserList/browserExecute | Browser use relay | interaction/browser* | server_callback | requires_desktop | implemented | fixture_verified | — |
| computer-use.operation-event | Computer use events | computer-use/operation-event | event | requires_desktop | implemented | fixture_verified | — |
| v4.* | Desktop v4 gateway | v4/* | client_call | unknown | partial | untested | — |
| model.turn | Model turn execution | session/send → provider | client_call | requires_login | implemented | blocked_by_environment | zcode_task_start |

## Desktop-/UI-Einstellungen (Inventar, nicht aus dem Umfang gestrichen)

`~/.zcode/v2/setting.json` (Desktop-UI: locale, Browser-Viewport, Tool-Grouping, Task-Auto-Archive,
Interaction-Behavior, Provider-Family, Indexing, Memory, …) wird als **read-only Inventar** über
`zcode_settings_get {scope:"desktop"}` (redigiert) exponiert. Sie haben ausschließlich Desktop-Wirkung
bzw. benötigen den laufenden Desktop; die Bridge schreibt die Datei nie. Steuerbare Workspace-Einstellungen
(mode/model/thoughtLevel) laufen über die nativen Workspace-Setter (siehe oben).

## Nachweise (Auszug)

- Live-Probes (echte Runtime): siehe `test/live/live.test.mjs` + `TEST_REPORT.md` §Live.
- Fixture-Verifikation: `test/integration/bridge.test.mjs`, `test/integration/robustness.test.mjs`.
- Entfernte Methoden: live `-32601` (`automation/list`), konsistent mit recheck-0.16.5.
- `blocked_by_environment`: Provider-Risikokontrolle („captcha verify failed“) für Desktop-externe
  Turns — Repro + Erklärung in `docs/KNOWN_LIMITATIONS.md`.
