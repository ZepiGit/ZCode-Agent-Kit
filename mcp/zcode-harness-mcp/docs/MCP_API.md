# MCP-API-Referenz (zcode-harness-mcp 0.1.0)

Transport: stdio (Standard) oder Streamable-HTTP `http://<host>:<port>/mcp` (nur localhost-Default).
MCP-Protokoll: offizielles SDK, Legacy-Initialize (`2025-06-18` kompatibel). Alle Tools liefern
`structuredContent` (maschinenlesbar) **und** den identischen Inhalt als Text-Block. Fehler erscheinen
als Tool-Fehler (`isError:true`) mit präziser Meldung (`READ_ONLY_MODE`, `REVISION_CONFLICT`,
`UNKNOWN_MODEL`, `not in the bridge allowlist`, …).

## Discovery

| Tool | Argumente | Beschreibung |
| --- | --- | --- |
| `zcode_health` | – | Bridge-Version, Runtime-Pfad/Version/Fingerprint, Prozesszustand, Read-only, Allowlist, Interaction-Policy. Degradierter Modus (Runtime nicht gefunden) wird ehrlich gemeldet. |
| `zcode_capabilities` | – | Vollständige Capability-Registry (45 Einträge): id, Beschreibung, Backend-Methode, Richtung, availability/implementation/verification, MCP-Mapping, Nachweis. |
| `zcode_operations_list` | `workspacePath?, kind? (mcp\|plugins\|skills\|usage\|registry)` | Native Listen (MCP-Server im Harness, Plugins, Skills, Usage-Stats) oder Registry-Überblick. |
| `zcode_operation_describe` | `method` | Registry-Beschreibung einer nativen Methode. |
| `zcode_operation_invoke` | `method, params?` | Aufruf **nur** aus der Read-only-Allowlist (`session/*`-Reads, `workspace/readState`, `mcp/list`, `plugins/list|overview`, `skills/referenceCatalog`, `usage/stats`). Kein beliebiges RPC-Passthrough. |

## Modelle & Einstellungen

| Tool | Argumente | Beschreibung |
| --- | --- | --- |
| `zcode_models_list` | `workspacePath` | Live-Katalog des Harness (Provider, ModelId, Kontextfenster, Reasoning-Levels, Modalitäten). Keine erfundenen Modellnamen. |
| `zcode_model_set` | `scope: session\|workspace, sessionId?/workspacePath?, model? ("providerId/modelId"), thoughtLevel?, mode?` | Setzt Modell/Reasoning/Mode; antwortet mit `requested` **und** `effective` (Read-back-Verifikation). Unbekanntes Modell → Fehler mit tatsächlichem Katalog. GLM-5.3-Flash wird nur verwendet, wenn im Katalog vorhanden — nie still ersetzt. |
| `zcode_settings_schema` | `workspacePath` | Typen, Choices, Defaults, effektive Werte, Quellen, Scopes, Schreibbarkeit, Neustart-Bedarf, Notizen (Desktop-Settings = read-only Inventar). |
| `zcode_settings_get` | `workspacePath, path?, scope?: workspace\|desktop` | Effektive Settings oder redigiertes Desktop-Inventar (`~/.zcode/v2/setting.json`, nur lesend). |
| `zcode_settings_update` | `workspacePath, changes, expectedRevision?` | Validiert + CAS (Revision aus vorherigem Lesen), Read-back (before/after), unbekannte Felder werden abgelehnt, nie still geschrieben. |
| `zcode_settings_reset` | `workspacePath, path (mode\|model\|thoughtLevel)` | Zurücksetzen auf bekannten Default. |

## Workspaces & Sessions

| Tool | Argumente |
| --- | --- |
| `zcode_workspaces_list` | – (Allowlist + im Harness gesehene Workspaces) |
| `zcode_workspace_open` | `workspacePath` → revision/settings/modelCatalog |
| `zcode_sessions_list` | `workspacePath?` |
| `zcode_session_create` | `workspacePath, mode?` → sessionId |
| `zcode_session_get` | `sessionId` → Projection (status/tokens/kontext), settings, todos |
| `zcode_session_resume` / `zcode_session_fork` / `zcode_session_close` / `zcode_session_compact` | `sessionId` (fork: latestCheckpoint) |
| `zcode_session_goal` | `sessionId, action: show\|set\|replace\|pause\|resume\|clear, value?` |

## Aufgaben (asynchron, vollständig)

| Tool | Argumente | Verhalten |
| --- | --- | --- |
| `zcode_task_start` | `workspacePath, prompt, sessionId?, model?, thoughtLevel?, mode?, readOnly?, idempotencyKey?` | Startet echte Harness-Arbeit; liefert **sofort** `taskId` + state (`queued\|starting\|running`). Idempotenz-Key → gleiche Task. `readOnly` → Plan-Modus + Write-Tool-Denylist im Harness. Modell-Ref wird vor Start gegen den Live-Katalog validiert. |
| `zcode_task_get` | `taskId` | Task-Record (Zustandsmaschine: `queued→starting→running→(waiting_for_input\|waiting_for_approval)→completed\|failed\|cancelled\|interrupted\|unknown`; `cancelling` transient). |
| `zcode_tasks_list` | `workspacePath?, state?` | Alle Tasks der Bridge. |
| `zcode_task_wait` | `taskId, timeoutMs?` (max 120s) | Begrenztes Warten auf Terminalzustand; gibt immer den Record zurück. |
| `zcode_task_cancel` | `taskId` | `session/stop` + **Verifikation** via `session/read`; `cancelled` nur nach Bestätigung, sonst `unknown` + Warnung. |
| `zcode_task_input` | `taskId, content` | Steering im laufenden Turn bzw. Folgeauftrag nach Abschluss (gleiche Session). |
| `zcode_task_events` | `taskId, afterSeq?, limit?` | Normalisierte + redigierte Events mit Cursor (`nextSeq`, `hasMore`). |
| `zcode_task_result` | `taskId` | Versioniertes Ergebnis (schemaVersion 1, siehe unten). Terminal-Ergebnisse werden persistiert und überleben Neustarts. |
| `zcode_artifact_read` | `workspacePath, path, offset?, length?` | Inhaltlicher Lesezugriff (base64, sha256, Größe, truncation, MIME) — Pfad muss im Workspace bleiben. |

### Task-Ergebnis (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "taskId": "task-…", "sessionId": "sess_…", "workspacePath": "…",
  "status": "completed|failed|cancelled|interrupted|unknown|running|…",
  "createdAt": "…", "startedAt": "…", "finishedAt": "…",
  "requestedModel": "zai/GLM-5.3", "effectiveModel": {"providerId":"zai","modelId":"GLM-5.3"},
  "mode": "build", "thoughtLevel": null,
  "responseText": "…", "partial": false,
  "completeness": {"status":"full","explanation":"turn stream captured via session events"},
  "usage": {"cumulative":{"totalTokens":42,"inputTokens":30,"outputTokens":12,"reasoningTokens":0},
             "note":"…; null means missing, not zero"},
  "toolCalls": [{"toolName":"Write","summary":"toolCall tc1"}],
  "fileChanges": {"added":[],"modified":["fixture-output.txt"],"deleted":[],"source":"tool_events","preExistingUncommitted":[]},
  "artifacts": [{"path":"fixture-output.txt","bytes":-1,"sha256":null}],
  "interactions": [{"id":"ia-…","kind":"permission","status":"resolved","toolName":"Bash"}],
  "errors": [], "warnings": [],
  "eventsRef": {"firstSeq":1,"lastSeq":7,"storage":"tasks/task-….events.jsonl"}
}
```

`partial:true`/`completeness.status:"partial"` kennzeichnet Teilergebnisse klar. Usage-Werte sind
`null` (nicht 0), wenn der Harness keine Daten liefert. Modell behauptete Erfolge werden nicht als
beobachtet ausgegeben — Testerfolge erscheinen nur aus beobachteten `tool.updated`-Events.

## Interaktionen

| Tool | Argumente | Verhalten |
| --- | --- | --- |
| `zcode_interactions_list` | `status? (pending\|resolved\|all)` | Stabile IDs, Art, Optionen, Task/Session-Bezug, Auflösung. |
| `zcode_interaction_respond` | `interactionId, optionId? / value? / cancel?` | Atomare Auflösung; nur Optionen, die der Harness angeboten hat (keine Autoritätserweiterung); Doppel-/Spätantworten werden abgelehnt; Timeout → sichere Default-Antwort (deny) durch die Bridge. |

Automatisch (ohne Agent) beantwortet: `session/requestRuntimePreferences` (Bridge-Konfiguration),
`interaction/requestProviderRuntimeHeaders` (`{headersApplied:false}`), `interaction/requestOfficialMcpAuthHeaders`
(`{ok:false, reason:"unsupported"}`), `interaction/browserList/browserExecute` (abgelehnt — kein Adapter),
`workspace/hooks/trustGrant` (abgelehnt; Vertrauensentscheidungen bleiben beim Operator).

## Resources

| URI | Inhalt |
| --- | --- |
| `zcode://capabilities` | Registry (identisch zu `zcode_capabilities`) |
| `zcode://sessions/{sessionId}` | Session-Projektion |
| `zcode://tasks/{taskId}/status` | Task-Record |
| `zcode://tasks/{taskId}/result` | Task-Ergebnis (identisch zu `zcode_task_result`) |
| `zcode://tasks/{taskId}/events` | Events als NDJSON |
| `zcode://artifacts/{pfad}` | Datei-Inhalt (base64, allowlist-geprüft) |

Alle Resources sind wirklich lesbar (`resources/read`); Clients ohne Resource-Support nutzen die
äquivalenten Tools (Parität).

## Beispiel-Client-Konfiguration

Siehe README (stdio) und `examples/config/http.mcp.json` (HTTP). Getestete Clients: offizieller
SDK-Testclient (dieses Repo, Node), HTTP-Client über `fetch` (Robustheitstest), MCP-Smoke-Client.
