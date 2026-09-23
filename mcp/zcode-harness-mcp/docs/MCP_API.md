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
| `zcode_capabilities` | – | Vollständige Capability-Registry des aktuellen Builds: id, Beschreibung, Backend-Methode, Richtung, availability/implementation/verification, MCP-Mapping, Nachweis. |
| `zcode_operations_list` | `workspacePath?, kind? (mcp\|plugins\|skills\|usage\|registry)` | Native Listen (MCP-Server im Harness, Plugins, Skills, Usage-Stats) oder Registry-Überblick. |
| `zcode_operation_describe` | `method` | Registry-Beschreibung einer nativen Methode. |
| `zcode_operation_invoke` | `method, params?` | Aufruf **nur** aus der Read-only-Allowlist (`session/*`-Reads, `workspace/readPresentation`, `runtime/capabilities` mit `{}`, `mcp/list`, `plugins/list|overview`, `skills/referenceCatalog`, `usage/stats`). Kein beliebiges RPC-Passthrough. |

## Modelle & Einstellungen

| Tool | Argumente | Beschreibung |
| --- | --- | --- |
| `zcode_models_list` | `workspacePath` | Vollständige native Metadaten in `modelCatalog.available`, `revision:null`, Herkunft explizit. Erstellt/schließt eine eigene deferred Session ohne Prompt; kann Runtime-Dienste initialisieren und ist unter `--read-only` gesperrt. Cleanup-Verweigerung ist ein Fehler. |
| `zcode_model_set` | `scope: session\|workspace, sessionId?/workspacePath?, model? ("providerId/modelId"), thoughtLevel?, mode?, expectedRevision?` | Native Session-Setter mit CAS; liefert `requested`, `effective` und tatsächlichen Vergleich (`verified`). Revision wird zwischen Settern fortgeschrieben. `scope:workspace` ist nicht unterstützt, kein lokaler Ersatz. Modellnamen müssen aus dem tatsächlichen Katalog stammen; nie stiller Ersatz. |
| `zcode_settings_schema` | `workspacePath` | Typen, Choices, Quellen, Scopes und Schreibbarkeit. Workspace-Modell/Modus/Reasoning nicht schreibbar; unbekannte Defaults `null`. Runtime-Präferenzen haben Prozess-Scope und unbekannte effektive/Default-Werte. Desktop-Settings bleiben read-only Inventar. |
| `zcode_settings_get` | `workspacePath, path?, scope?: workspace\|desktop` | Präsentation mit explizit unbekannten Defaults oder redigiertes Desktop-Inventar (`~/.zcode/v2/setting.json`, nur lesend). `path:modelCatalog` verweist auf das separate Tool statt versteckt eine Session zu erstellen. |
| `zcode_settings_update` | `workspacePath, changes, expectedRevision?` | Nur die vier unten genannten Runtime-Booleans; gesamter Batch vorab validiert. Prozessweit, nicht persistent; native Bestätigung statt unabhängiger Read-back-Verifikation. `expectedRevision` → `UNSUPPORTED_REVISION` vor Mutation; Workspace-Defaults → `UNSUPPORTED_WORKSPACE_DEFAULT`. |
| `zcode_settings_reset` | `workspacePath, path (mode\|model\|thoughtLevel)` | Nativ 0.16.9 nicht unterstützt: `UNSUPPORTED_WORKSPACE_DEFAULT`, kein erfundener Default oder Fallback. |

`changes` unterstützt `askUserQuestionAutoResolutionEnabled`, `modelIoFullRetentionEnabled`,
`offPeakToolEnabled`, `dynamicWorkflowEnabled` als Booleans. Die Bridge prüft die native
Bestätigung und kennzeichnet sie als `native-acknowledgement`; es gibt keinen unabhängigen
Getter, keine Workspace-Revision und keinen Reset. Auswirkungen reichen über den angegebenen
Workspace hinaus, bei Interaktionen bzw. Model-IO auch auf offene Rückfragen bzw. aktive Sessions.
Der aktuelle native Katalog enthält nachweislich `zai-api/GLM-5.3-Flash`; native Flash-Inferenz
wurde unter Windows/ZCode 0.16.9 nach bestätigter Modell-/`low`-Auswahl mit
Upstream `1113` (Guthaben/Ressourcenpaket fehlt) blockiert. Proxy-Erfolg ist kein
MCP-Modellerfolg.

## Workspaces & Sessions

| Tool | Argumente |
| --- | --- |
| `zcode_workspaces_list` | – (Allowlist + im Harness gesehene Workspaces) |
| `zcode_workspace_open` | `workspacePath` → presentation, mode, revision:null, model:null, thoughtLevel:null, Quelle/Hinweis; reines `workspace/readPresentation`, kein Katalog/Default und keine Session-Erstellung |
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
`examples/config/stdio.mcp.json` bleibt absichtlich `--read-only`: Präsentation und
`runtime/capabilities` sind verfügbar, vollständige Katalogabfragen und Session-Setter nicht.
Die Demo benötigt Schreibfreigabe für die Katalog-Session und wählt Modell/Modus nativ pro
Session statt entfernte Workspace-Defaults zu setzen.
