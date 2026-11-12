# KNOWN_LIMITATIONS.md

Ehrliche, belegte Grenzen — keine erfundenen Implementierungen.
Die Überschriften von Abschnitt 1/2 bleiben als historische Linkziele unverändert;
ihre 0.16.5-Aussagen sind keine aktuellen 0.16.9-Befunde. Aktuell ist der native
Vollkatalog mit `zai-api/GLM-5.3-Flash` nachgewiesen. Der tatsächliche Windows-Test
mit ZCode 0.16.9 und `low` bestätigte die Auswahl vor dem Senden, wurde danach
aber durch Upstream `1113` (Guthaben/Ressourcenpaket fehlt) blockiert.
Erfolgreiche Proxy-Modellaufrufe belegen keinen nativen MCP-Modellerfolg.

## 1. Modell-Turns außerhalb der Desktop-App scheitern aktuell an der Provider-Risikokontrolle (blockiert, nicht umgangen)

**Historische Beobachtung (0.16.5, live, 2026-09-12; keine aktuelle Inferenz-Abnahme):** Vom Desktop unabhängig gestartete Harness-Prozesse (sowohl
`zcode --prompt` als auch `app-server` über die Bridge) erhalten beim Modellrequest
HTTP 400 `captcha verify failed` (Attribution: `source:"provider", reason:"auth_failed",
providerId:"zai", transport:"sse"`). Die Z.AI-Risikokontrolle verlangt einen Aliyun-Captcha-
Verifizierungsparameter (`x-aliyun-captcha-verify-param`), den normalerweise die Desktop-UI über den
Reverse-Call `interaction/requestProviderRuntimeHeaders` (reason `model-request`/`captcha-retry`)
beisteuerte. Damals funktionierte der Desktop, Desktop-externe Turns dagegen nicht zuverlässig.
Daraus folgt keine Aussage über heutige native Flash-Turns oder andere Providerkonfigurationen.

**Was die Bridge tut:** Sie beantwortet Header-Rückfragen niemals mit erfundenen Werten
(`{headersApplied:false}`), umgeht die Risiko-Kontrolle **nicht** und meldet `turn.failed` mit der
vollen Harness-Attribution. Der damalige 0.16.5-Nachweis vor dem Modellstream umfasste Session-Setup,
Hooks, `turn.started`, Event-Stream, Usage, Stop/Cancel und damalige Settings; er bestätigt keine
entfernten Workspace-Setter in 0.16.9. Aktuelle lokale Nachweise separat aufbewahren.

**Historische Repro (0.16.5, nicht als aktueller 0.16.9-Startbefehl verwenden):**
```
node "C:\Program Files\ZCode\resources\glm\zcode.cjs" --prompt "Reply with exactly: OK" --json --verbose --cwd <workspace>
# → ProviderBusinessError: captcha verify failed … responseStatus: 400
```
Unter 0.16.9 kann dieser direkte Aufruf bereits an der Providerpfadauflösung scheitern;
das ist kein CAPTCHA- oder Inferenznachweis. Die reparierte Bridge löst den gebündelten
Providerpfad auf und setzt den Seed nur in der Kindprozess-Umgebung, mit Vorrang für
explizite Overrides (siehe `SECURITY.md`). Sie verändert weder Vendor-Bundle noch Elternumgebung.
**Auswirkung auf Tests:** Der damalige Live-Task-Nachweis reichte bis zur ehrlichen Fehlerfläche;
Fixture-Erfolge (`FAKE_TURN=ok`) sind keine nativen Modellantworten. Der aktuelle native
Flash-Test ist durch `1113` blockiert; eine erfolgreiche Antwort steht noch aus.
Ein erneuter Test erfordert ein gültiges Ressourcenpaket für genau diese native
Providerroute, keinen Modell- oder Providerwechsel.

## 2. GLM-5.3-Flash ist im lokalen Plan-Katalog nicht vorhanden

**Historische Überschrift, heute nicht mehr zutreffend:** Die Flash-Abwesenheit bezog sich
auf den damaligen 0.16.5-Plan-Katalog vom 2026-09-12. Im aktuell geprüften vollständigen
nativen 0.16.9-Katalog ist `zai-api/GLM-5.3-Flash` vorhanden. Die Bridge verwendet tatsächliche
Provider-/Modell-IDs, ohne stillen Ersatz. Katalogpräsenz und native Session-Auswahl sind
kein Inferenznachweis; die reale Anfrage wurde mit `1113` abgewiesen, eine
native Flash-Modellantwort liegt nicht vor.
Die native Providerroute kann von der Proxyroute abweichen.

## 3. Nicht implementiert / nicht exponiert (bewusst)

- Nativ 0.16.9 fehlen die früheren `workspace/readState`, `workspace/setDefault*`,
  `workspace/{upsert,remove}ModelProvider` und `workspace/updateProviderRegistry` im Dispatcher;
  keine aktuell unterstützten Befehle, Aliasse oder lokalen Fallbacks. Persistente Workspace-
  Modell-/Modus-/Reasoning-Setter und Reset liefern `UNSUPPORTED_WORKSPACE_DEFAULT`;
  Workspace-`expectedRevision` liefert `UNSUPPORTED_REVISION` vor Mutation.
- `workspace/readPresentation` liefert nur `{workspace,mode,slashCommands}`, keine Defaults,
  keinen Katalog und keine Revision. Der Vollkatalog erfordert eine eigene deferred Session ohne
  Prompt mit anschließendem Schließen; mögliche Runtime-Initialisierung, daher unter `--read-only`
  gesperrt. `session/read` ist kein Vollkatalog. Native Session-Setter bleiben unterstützt.
- Die vier Runtime-Präferenzen sind über `zcode_settings_update` exponiert (siehe `MCP_API.md`),
  gelten aber pro gemeinsamem App-Server-Prozess und nicht als persistente Workspace-Defaults.
  Kein nativer Getter, Reset, bekannter Default oder CAS; Bestätigung ist kein unabhängiges Read-back.
  Provider-Konfigurationsschreibzugriffe und `workspace/generateText` werden nicht als Bridge-Tools angeboten.
- Plugin-Lifecycle (`plugins/install|uninstall|update|marketplace/*`) — kein Auto-Plugin-Install
  (Sicherheitspolicy); `plugins/list|overview` sind via `zcode_operations_list` lesbar.
- `v4/*`-Face (Conversation-Frames, Attachments-Upload, Rewind-Preview) — Desktop-Gateway ist im
  Standalone-App-Server nicht initialisiert; Rewind/Fork-Refresh live nur eingeschränkt prüfbar.
- `session/subagents`: historischer 0.16.5-Befund „Session not found“ bei damaligen Params;
  daraus folgt kein aktueller 0.16.9-Supportnachweis. Maßgeblich ist die aktuelle Capability-Registry.

## 4. Architektur-bedingt

- **stdio:** Die Bridge besitzt den Harness-Prozess. Endet der Bridge-stdio-Client (stdin zu), fährt
  die Bridge herunter; laufende Tasks werden als `interrupted` persistiert — ein gespeicherter Task
  läuft **nicht** ohne lebende Runtime weiter (ehrlich dokumentiert, kein Schein-Detach).
- **HTTP:** Tasks laufen im Bridge-Daemon weiter, auch wenn ein Client trennt; beim Daemon-Stop gilt
  dasselbe wie oben.
- Neustart-Verhalten: Persistierte, nicht-terminale Tasks werden als `interrupted` wiederhergestellt
  (nie automatisch `completed`); terminale Ergebnisse bleiben vollständig lesbar (Result-Cache).
- **Harness restarts are bounded.** A harness that has exited is started again only by the next call
  that needs it, and at most 3 times in 15 minutes, with a backoff of 1 s, 2 s, 4 s (up to 30 s)
  after the last exit. After that, harness-bound tools fail with `HARNESS_RESTART_BUDGET_EXHAUSTED`
  until a slot comes back (`zcode_health` → `runtime.restartBudget.retryAt`) or the bridge is
  restarted. `ZCODE_HARNESS_RESTART_BUDGET=<restarts>/<window seconds>` changes the budget. See
  `MCP_API.md`, "Harness restart budget".
- Tasks der **Desktop-App selbst** sind für die Bridge nur als Sessions sichtbar (`session/list`),
  nicht als Bridge-Tasks.

## 5. Kleine Grenzen

- `usage.delta`/per-Turn-Usage-Aufschlüsselung: Der Harness exponiert nur kumulative Session-Usage;
  per-Turn-Werte sind `null` mit Erklärung, nicht 0.
- Dateiänderungen kommen aus `tool.updated`-Events (Write/Edit-artige Tools). Umbenennungen/externe
  Änderungen (Shell) können fehlen; `preExistingUncommitted` wird nicht von Task-Arbeit
  unterschieden — Herkunftsangabe `fileChanges.source:"tool_events"` im Ergebnis.
- MCP-Tasks-Extension (io.modelcontextprotocol/tasks) ist nicht aktiviert; Polling über gewöhnliche
  MCP-Tools funktioniert unabhängig (so wie im Auftrag gefordert).
- Getestete MCP-Clients: offizieller SDK-Client (Node 26), eigener HTTP-Client (`fetch`), MCP Inspector
  nicht ausgeführt (nicht installiert); bei Bedarf separat verifizieren.

## 6. MCP protocol revision: at most 2025-11-25, on MCP SDK 2.x

- **What the bridge is built on.** The MCP SDK 2.x line: `@modelcontextprotocol/server` 2.4.0, and
  `@modelcontextprotocol/node` 2.1.2 for the HTTP transport (loaded in HTTP mode only; the stdio
  bridge loads no HTTP code). The earlier `@modelcontextprotocol/sdk` 1.x package is no longer used.
- **What it speaks.** The bridge wires the SDK's low-level `Server` to a transport itself and serves
  the 2025-era protocol revisions only. `initialize` answers with the revision the client asked for
  when that is `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` or `2024-10-07`, and with
  `2025-11-25` for anything else. Revision `2026-07-28` is not served: `server/discover` is answered
  with `-32601` (method not found), and an HTTP request that carries
  `MCP-Protocol-Version: 2026-07-28` is answered with `400`. A client of the new revision has to use
  its legacy path (`initialize`); a client without one cannot use the bridge.
- **The wire did not change with the SDK.** Conversations recorded on the bridge built with SDK
  1.32.2 (stdio and HTTP, revisions 2025-06-18 and 2025-11-25 in full) are replayed against every
  build by `test/integration/wire-replay.test.mjs` and must match byte for byte: capabilities, tool
  and resource results, statuses and headers. A failed `resources/read` (an unknown resource or
  task) still answers with error code `-32002`; SDK 2.x would send `-32602`, and the bridge restores
  the code the 2025-era revisions define. One answer differs: a `tools/call` without a tool name,
  which no client can validly send, is now refused with `-32602` and the message
  `Invalid tools/call request: …` instead of `-32603`.
- **Why `2026-07-28` is not served yet.** The SDK's combined HTTP entry (`createMcpHandler` with
  its stateless fallback for 2025-era traffic) was measured against the recorded conversations with
  SDK 2.4.0: it answers 2025-era requests as `text/event-stream` where the bridge sends
  `application/json` bodies, and it answers an unknown resource with `-32602` with no place to
  restore `-32002`. Both would change the wire for today's clients. On stdio the SDK's `serveStdio`
  entry served both eras in the same measurement (2025-era answers unchanged apart from that error
  code, `server/discover`, `tools/list`, `tools/call` and `resources/read` on `2026-07-28` with the
  capabilities unchanged). Serving `2026-07-28` therefore needs the bridge to route HTTP requests by
  era itself (the SDK's `isLegacyRequest` in front of a `2026-07-28`-only handler) and keep its
  present path for 2025-era requests; that is not built.
- **HTTP.** Stateless as before: POST only, no session id, `405` for GET and DELETE, one server and
  one transport per request, both closed when the response closes (also when the client leaves
  while a tool is still running).
- Sources: SDK 2.x packages <https://www.npmjs.com/package/@modelcontextprotocol/server>,
  <https://www.npmjs.com/package/@modelcontextprotocol/node>; changes in revision `2026-07-28`
  <https://modelcontextprotocol.io/specification/2026-07-28/changelog>.
