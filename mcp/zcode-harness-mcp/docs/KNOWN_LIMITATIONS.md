# KNOWN_LIMITATIONS.md

Ehrliche, belegte Grenzen — keine erfundenen Implementierungen.

## 1. Modell-Turns außerhalb der Desktop-App scheitern aktuell an der Provider-Risikokontrolle (blockiert, nicht umgangen)

**Beobachtung (live, 2026-09-12):** Vom Desktop unabhängig gestartete Harness-Prozesse (sowohl
`zcode --prompt` als auch `app-server` über die Bridge) erhalten beim Modellrequest
HTTP 400 `captcha verify failed` (Attribution: `source:"provider", reason:"auth_failed",
providerId:"zai", transport:"sse"`). Die Z.AI-Risikokontrolle verlangt einen Aliyun-Captcha-
Verifizierungsparameter (`x-aliyun-captcha-verify-param`), den normalerweise die Desktop-UI über den
Reverse-Call `interaction/requestProviderRuntimeHeaders` (reason `model-request`/`captcha-retry`)
beisteuert. Der Desktop funktioniert (diese Session läuft über ihn); Desktop-externe Turns derzeit
nicht zuverlässig.

**Was die Bridge tut:** Sie beantwortet Header-Rückfragen niemals mit erfundenen Werten
(`{headersApplied:false}`), umgeht die Risiko-Kontrolle **nicht** und meldet `turn.failed` mit der
vollen Harness-Attribution. Alles vor dem Modellstream ist live verifiziert: Session-Setup, Hooks,
`turn.started`, Event-Stream, Usage, Stop/Cancel, Settings. Aktuelle lokale Nachweise separat aufbewahren.

**Repro (exakt):**
```
node "C:\Program Files\ZCode\resources\glm\zcode.cjs" --prompt "Reply with exactly: OK" --json --verbose --cwd <workspace>
# → ProviderBusinessError: captcha verify failed … responseStatus: 400
```
**Auswirkung auf Tests:** Live-Task-Acceptance verifiziert die Pipeline bis zur ehrlichen
Fehlerfläche; `completed`-Pfad mit echtem Modelltext ist momentan nur per Fixture belegt
(`FAKE_TURN=ok`) bzw. falls die Risikokontrolle künftig freigibt (Live-Test unterstützt beide Pfade).

## 2. GLM-5.3-Flash ist im lokalen Plan-Katalog nicht vorhanden

Der Live-Katalog dieses Coding-Plans enthält `zai/GLM-5.3` und `zai/GLM-5-Turbo` (live geprüft,
2026-09-12). `zcode_model_set`/`zcode_task_start` mit `GLM-5.3-Flash` antworten mit
`UNKNOWN_MODEL` + tatsächlichem Katalog. Kein stiller Modellwechsel — genau wie gefordert.
Sobald der Plan Flash freischaltet, funktioniert die Auswahl ohne Code-Änderung (dynamischer Katalog).

## 3. Nicht implementiert / nicht exponiert (bewusst)

- `workspace/{upsert,remove}ModelProvider`, `updateProviderRegistry`, `updateInteractionPreferences`,
  `updateModelIoPreferences`, `workspace/generateText` — Registry-Einträge existieren, Tools fehlen
  in v1 (Schreibzugriff auf Provider-Konfigurationen = API-Key-Handling, absichtlich außen vor).
- Plugin-Lifecycle (`plugins/install|uninstall|update|marketplace/*`) — kein Auto-Plugin-Install
  (Sicherheitspolicy); `plugins/list|overview` sind via `zcode_operations_list` lesbar.
- `v4/*`-Face (Conversation-Frames, Attachments-Upload, Rewind-Preview) — Desktop-Gateway ist im
  Standalone-App-Server nicht initialisiert; Rewind/Fork-Refresh live nur eingeschränkt prüfbar.
- `session/subagents` braucht offenbar andere Params (live „Session not found“); `unknown` in der Matrix.

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
