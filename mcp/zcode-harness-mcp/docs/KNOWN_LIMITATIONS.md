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
