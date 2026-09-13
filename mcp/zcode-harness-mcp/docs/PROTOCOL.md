# ZCode Protocol v1 — Reverse-Engineering-Dokumentation

Dokumentiert den Stand, der live gegen die lokale Installation verifiziert wurde.
Alle Aussagen mit „live“ wurden gegen die echte Runtime ausgeführt; die Community-
Quellen bestätigen dieselben Mechanismen.

##	Runtime / Fingerabdruck (live, 2026-09-12)

| Was | Wert |
| --- | --- |
| Harness | `C:\Program Files\ZCode\resources\glm\zcode.cjs` |
| Version (eigen angegeben) | `zcode 0.16.5` |
| Bundle-Fingerprint | `e9f1868c0fdb8635` (SHA-256, erste 16 Hex) |
| Bundle-Größe | 12.615.227 Bytes |
| Desktop | `ZCode.exe` (Electron), mtime 2026-09-04 |
| Bundle-Metadaten | `{"runtime":"electron-node","entry":"zcode.cjs","source":"apps/zcode-cli/packages/cli/dist/zcode.cjs"}` |
| Modellkatalog-Datei | `resources/model-providers/models_catalog_china_llm_zcode_2026-06-03.json` (schemaVersion 24, 10 Provider) |

## Framing und Nachrichtenformat (live verifiziert)

- **NDJSON**: ein JSON-Objekt pro Zeile über stdin/stdout. Kein `Content-Length`, keine Magic Bytes, kein binärer Envelope.
- **Kein `jsonrpc`-Feld.** Ein Objekt mit `jsonrpc`-Schlüssel wird mit `-32600` und festem `id:"invalid-message"` abgelehnt (Zod-Unions: „Unrecognized key: jsonrpc“).
- Klassifikation nach Feldern:
  | Felder | Typ |
  | --- | --- |
  | `id` + `method` | Request (in **beiden** Richtungen — Reverse-Calls existieren) |
  | nur `method` | Notification |
  | nur `id` | Response |
- Request-Form: `{"id":1,"method":"session/create","params":{…}}` — IDs des Clients numerisch/string; der Server nutzt String-IDs `server-1`, `server-2`, …
- Fehlerobjekte: `{"error":{"code":-32601,"message":"…","data":{…}},"id":…}` (JSON-RPC-artige Codes).
- Interne Klasse im Bundle: `ZCodeProtocolNdjsonConnection` (Bestätigung über Fehler-Stacktrace, live).
- Parse-Fehler: `{"error":{"code":-32700,"message":"Parse error"},"id":"parse-error"}`.
- Validierungsfehler enthalten Zod-Issues in `error.data.issues` — die primäre Quelle, um Parametern live zu lernen.
- Kein Initialize-Handshake auf dieser Verbindung: `initialize` antwortet `-32601` (live); die Verbindung beginnt direkt mit Methodenaufrufen. Protokollversion wird in `session/create`-Result unter `result.protocol` gemeldet: `{"name":"ZCode Protocol","version":1}` (live).

## Methoden-Registry (aus dem 0.16.5-Bundle extrahiert, dispatcher-verifiziert)

Session: `session/create, resume, list, subagents, requestRuntimePreferences¹, read, messages, events, subscribe, send, stop, cancelBackgroundTask, fork, compact, goal, close, setModel, setThoughtLevel, updateRuntimeModelConfig, setMode, usage`

Workspace: `workspace/readState, hooks/trustGrant¹, updateProviderRegistry, updateInteractionPreferences, updateModelIoPreferences, upsertModelProvider, removeModelProvider, setDefaultModel, setDefaultThoughtLevel, setDefaultMode, generateText, cancelGenerateText`

Discovery/Management: `mcp/list, plugins/list, plugins/referenceCatalog, skills/referenceCatalog, plugins/resolveSuggestedReference, setEnabled, overview, marketplace/add|remove|update, install, cancelOperation, uninstall, update, restoreBuiltin, configure, resetConfig, validate, describe`

Reverse-Calls (Server→Client): `session/requestRuntimePreferences¹, interaction/requestPermission, interaction/requestUserInput, interaction/requestProviderRuntimeHeaders, interaction/requestOfficialMcpAuthHeaders², interaction/browserList, interaction/browserExecute, computer-use/operation-event³, process/mcpTelemetry³, state.updated³`

v4-Face (Desktop-Gateway, `requireV4Gateway`): `v4/conversation/{subscribe,unsubscribe,resync,rowsRange,plans,fileChanges,fileRewindPreview,usage,frame}, v4/controller/{subscribe,resync,unsubscribe}, v4/attachment/{begin,chunk,commit,abort,read,previewSource}, v4/connection/flow, v4/commands/query, v4/command, v4/usage/stats, v4/telemetry/event`

¹ `session/create` **blockiert**, bis der Client `session/requestRuntimePreferences` beantwortet (live: Fehlerantwort lässt create mit demselben Fehler scheitern; korrekte Antwort: `{nativeSearchEnhancementsEnabled: boolean, memoryEnabled?: boolean, askUserQuestionAutoResolutionEnabled?: boolean, modelContextBudgetStrategy?: "legacy"|"preflight-v1"}`).
² Neu in 0.16.5; nicht-beantwortet blockiert create nicht (live beobachtet für `image_search` / `document-skills`-Plugin).
³ Notifications.

**In 0.16.5 entfernt** (Registry-Strings noch im Bundle, Dispatcher lehnt ab): `automation/{create,update,delete,list,checkTaskBinding}` — live `-32601 „Method not found: automation/list“`. Bereits früher entfernt (live + Quellen): `session/steer`, `session/rewind*`, `session/new`, `prompt`, `initialize`.

## Event-Stream (live)

`session/subscribe` mit `{sessionId, deliveryKind:"desktop-continuous"}` (ohne `deliveryKind` → `-32602`, live) → Notifications `session/event` mit `{sessionId, seq, type, payload}`; `seq` ist pro Session monoton. Beobachtete Typen (live): `session.updated`, `session.titleUpdated`, `turn.started`, `model.streaming` (payload `kind:"text_delta"|"reasoning_delta"`), `tool.updated`, `usage.delta`, `turn.completed`, `turn.failed` (payload `error.attribution` mit `source:"provider", reason:"auth_failed"` etc.).

## Wichtige Parametern/-Schemata (live gelernt)

- Workspace-Objekt: `{workspaceKey, workspacePath}`; `workspaceKey` ist der normalisierte Pfad selbst (live).
- `session/send`: `{sessionId, content}` → `{accepted:true, sessionId, stateRevision}`; 0.16+ zusätzlich `attachments, toolDenylist, runtimeModel, expectedRevision, …` (Quellen).
- `session/goal`: `action`-Enum `show|set|replace|pause|resume|clear` (live aus Validierungsfehler).
- `usage/stats`: `range`-Enum `all|7d|30d` (live).
- `session/setModel`: `{sessionId, model:{providerId, modelId}}`; unbekanntes Modell → `-32603` „Unsupported model: … Available models: …“ (live).
- `interaction/requestProviderRuntimeHeaders` Request: `{requestId, sessionId, turnId?, workspace, modelRef, providerId, reason:"model-request"|"captcha-retry"}`; erwartete Antwort: `{headersApplied: boolean, errorMessage?, providerRevision?}`; Header-Name `x-aliyun-captcha-verify-param` (Bundle). Refresh-Port nur für Provider-IDs `zaiStartPlan`/`bigmodelStartPlan` (Bundle).
- `interaction/requestOfficialMcpAuthHeaders` Antwort: `{ok:true, headers} | {ok:false, reason}` (Bundle-Diskriminierte Union).
- `interaction/requestPermission` Optionen (Bundle): `allow_once` / `allow_always|allow_project` / deny-Varianten mit `response:{decision,reason}`.

## Provider-/Risikokontrolle (live, entscheidend für Live-Verhalten)

Turns aus Harness-Prozessen **außerhalb der Desktop-App** werden aktuell vom Provider mit
HTTP 400 `captcha verify failed` abgelehnt (live auch per `zcode --prompt --json --verbose`):
`ProviderBusinessError: captcha verify failed … providerId:"zai" … transport:"sse"`.
Der Desktop-Captcha-Flow (`captcha-retry` → Aliyun-Token → Retry) ist eine Desktop-UI-Fähigkeit;
die Bridge umgeht das **nicht** (siehe SECURITY/KNOWN_LIMITATIONS) und meldet `turn.failed`
mit voller Attribution. Sessions/Hooks/Events/Usage laufen bis dahin vollständig.

## Community-Quellen (recherchiert, Commits dokumentiert)

- `william0wang/zcode-acp` @ `ad31b663eab446c2478f573498e5f7e3025d4c20` (Apache-2.0) — NDJSON-Bestätigung, Event-Typen, Backlog („missing dispatch case + live -32601 is the proof“).
- `tizerluo/zcode-open-bridge` @ `2c1f4ad36fa6942a22b86f23d3d1bbf9643c5fff` (MIT) — recheck-0.16.5: additive Kompatibilität 0.16.1→0.16.5, `automation/*`-Entfernung, `mcp.servers`-Konfigurationsschlüssel in `~/.zcode/cli/config.json`.
- MCP-Spezifikation (2026-07-28 modern + Legacy ≤2025-11-25) — genutzt für die MCP-Oberfläche dieser Bridge (Legacy-Initialize; strukturierte Tool-Outputs; Resources).
- Übernommener Code aus diesen Quellen: **keiner** (nur Protokollwissen).
