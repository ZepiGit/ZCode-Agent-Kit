# TEST_REPORT.md

Stand: 2026-09-12. Alle Befehle wurden tatsächlich ausgeführt (Node v26.7.0, Windows 11, Git Bash /
PowerShell-kompatibel). Trennung nach Testart:

| Art | Anzahl | Ergebnis | Gegenstand |
| --- | --- | --- | --- |
| Unit | 7 | ✅ 7/7 | Redaction, Allowlist/Pfad-Grenzen, SessionId-Validierung, Config-Parsing (`node --test test/unit/security.test.mjs`) |
| Integration (Fixture-Harness) | 18 | ✅ 18/18 | Kompletter MCP-Flow über echte stdio-MCP-Clients gegen deterministischen Fake-Harness |
| Robustheit | 5 | ✅ 5/5 | Persistence/Restart, Concurrency+Workspace-Schreibschutz, Harness-Crash, 2 HTTP-Clients |
| Live (echte 0.16.5) | 5 | ✅ 5/5 | Discovery, echter Katalog, Sessions/Modelle live, Task-Pipeline bis Provider, Usage |
| **Gesamt** | **35** | **35/35 grün** | `npm test` → 30/30; `npm run test:live` → 5/5 |

Exakte Befehle:
```
npm install && npm run build
npm test
set LIVE_TEST=1 && set LIVE_WORKSPACE=C:\Users\miche\zcode-harness-mcp\test\live-ws && set LIVE_DATA_DIR=C:\Users\miche\zcode-harness-mcp\test\live-data && npm run test:live
node examples\demo-client.mjs                      (live)
node examples\demo-client.mjs --fixture            (offline)
```

## Abnahmeszenarien (Auftrag §11)

**1. Start/Discovery ohne Runtime/Login** — ✅ Integrationstest „scenario 1“: `ZCODE_HARNESS_RUNTIME_PATH`
auf fehlende Datei → Bridge startet normal, `zcode_health` antwortet mit `degraded:true` und der exakten
Diagnose („points to a missing file …“), `zcode_capabilities`/`zcode_interactions_list` funktionieren,
harness-gebundene Tools scheitern mit klarer Meldung. Kein Crash, kein erfundener Status.
Live-Discovery mit echter Runtime: Version 0.16.5 + Fingerprint `e9f1868c0fdb8635` (live_verified).

**2. Modellkatalog lesen, GLM-5.3-Flash auswählen, wirksame Auswahl prüfen, Ungültiges ablehnen** — ✅
Live: Katalog = `zai/GLM-5.3, zai/GLM-5-Turbo`; `zcode_model_set` (session) mit Read-back
(`verified:true`, `effective.model`); `fake/NOPE` bzw. `zai/GLM-9.9-DoesNotExist` → Fehler mit
„Unsupported model … Available models …“ (live). **GLM-5.3-Flash**: nicht im lokalen Plan-Katalog →
`UNKNOWN_MODEL` mit Katalog; Demo-Client zeigt den „kein stiller Modellwechsel“-Pfad. Fixture: analog
verifiziert.

**3. Settings-Schema vollständig; reversibler Change; invalid + Revisionskonflikt** — ✅ Integration:
`zcode_settings_schema` (types/choices/defaults/effective/source/scope/writable/restart), update
`mode:plan` mit Read-back `after:"plan"`, `mode:"banana"` → `INVALID_VALUE`, unbekanntes Feld →
`UNKNOWN_SETTING` (kein stillschweigendes Schreiben), `expectedRevision`+100 → „revision moved“
(CAS), `zcode_settings_reset` → zurück auf default. Desktop-Inventar via `scope:"desktop"` (redigiert).

**4. Session → Task über mehrere Aufrufe verfolgen → vollständiges Ergebnis** — ✅ Integration:
`zcode_task_start` (nicht-blockierend, `starting/running`) → `zcode_task_get`-Polling →
`zcode_task_events` mit Cursor → `zcode_task_wait` → `completed` → `zcode_task_result`
(schemaVersion 1, responseText „FAKE-OK“, usage, toolCalls, fileChanges, interactions, warnings,
completeness). Live: Pipeline real bis `turn.started` → `turn.failed` mit Provider-Attribution
(s. KNOWN_LIMITATIONS §1).

**5. Ergebnis zusätzlich als MCP-Resource, Vergleich mit Tool-Ergebnis** — ✅ Integration:
`resources/read zcode://tasks/{id}/result` liefert identischen `taskId`/`status`; `resources/list`
enthält per-Task-URIs; `zcode://capabilities` lesbar.

**6. Folgeauftrag mit Session-Kontext; Resume/Fork separat** — ✅ Integration: `zcode_task_input`
nach Abschluss → gleiche `sessionId`, `followUpCount:1`, Ergebnis lesbar. `zcode_session_resume`
+ `zcode_session_fork` (latestCheckpoint) verifiziert (Fixture); live: resume/fork gegen echte
Runtime aufgerufen (Session-Objekt-Formen live bestätigt).

**7. Datei im temporären Projekt erstellen/ändern; Inhalt, Herkunft, Diff über MCP** — ✅ Integration:
Task erzeugt `tool.updated` (Write) → `fileChanges.modified` im Ergebnis (Herkunft
`source:"tool_events"`); `zcode_artifact_read` liefert Inhalt (base64, sha256, size, `truncated`,
MIME) aus dem echten Workspace. Grenze dokumentiert: Umbenennungen/Shell-Änderungen fehlen ggf.;
live blockiert durch KNOWN_LIMITATIONS §1.

**8. Read-only technisch testen; unerlaubte Pfade, Rechteerweiterung, Secrets** — ✅ Integration:
`--read-only` → `session_create`/`task_start` → `READ_ONLY_MODE`-Fehler (Handler-Enforcement), lesende
Tools funktionieren; Task-`readOnly:true` → Harness-seitig `mode:"plan"` verifiziert (session_get) +
toolDenylist an `session/send`. Pfad-Escape (`..\..\package.json`) → abgelehnt; fremder Workspace →
„not in the bridge allowlist“; Secret-Redaction getestet (sk-Tokens/Authorization/cookies maskiert).

**9. Rückfrage sichtbar, berechtigt beantworten, Fortsetzung beobachten** — ✅ Integration (2 Teile):
Permission erscheint als `interaction/requestPermission`-Interaktion mit Optionen (`allow_once`,
`deny_once`); ungültige `optionId` abgelehnt; `deny_once` → Task läuft weiter und completed.
`requestUserInput` → Task-State `waiting_for_input`, Antwort über `value` → Fortsetzung → completed.
Unbeantwortete Permission → Timeout → deny (Policy-Sicherheit), Status `expired`/`resolved` in der
Liste. Live: `session/requestRuntimePreferences` (create-blockierend) und
`requestOfficialMcpAuthHeaders` live beantwortet/beobachtet.

**10. Laufenden Task abbrechen; Teilergebnisse erhalten; Restarbeit ehrlich** — ✅ Integration:
`zcode_task_cancel` → `session/stop` + Verifikation via `session/read` → `cancelled`; bei
Nicht-Verifizierbarkeit wäre State `unknown` + Warning (kein behaupteter Erfolg). Ergebnis bleibt
abrufbar. Fixture-Stop-Verhalten getestet.

**11. Zwei Clients, mehrere Sessions, gleiche Idempotency-ID, konkurrierende Workspace-Schreibzugriffe** — ✅
Robustheit: Zwei unabhängige MCP-Clients über Streamable-HTTP (initialize, tools/list, task_start,
task_get) gegen denselben Bridge-Daemon; Idempotency-Key → identische `taskId` (auch über Bridge-
Neustart hinweg); **konkurrierende Schreib-Tasks im selben Workspace werden verhindert**
(`WORKSPACE_BUSY`, Integration), read-only Tasks laufen parallel, Queuing unter Concurrency-Limit
verifiziert.

**12. Client-Disconnect, Bridge-Neustart, Backend-Absturz, verspätete Events, lückenhaftes Replay** — ✅
Robustheit: Neustart auf gleichem Datenverzeichnis → persistierte Tasks lesbar (Result-Cache),
Idempotenz-Key bleibt gebunden; Harness-Kindprozess per `taskkill` getötet → nächster Call
transparenter Restart, `zcode_models_list` funktioniert wieder; Events mit `seq`-Cursor
(`afterSeq`/`nextSeq`/`hasMore`) über mehrere Aufrufe; Client-Disconnect bei HTTP trennt nur den
Transport (Daemon behält Tasks). Cursor-Gap-Erkennung: `seq`-Basis dokumentiert; Lücken marker
via `origin`/`seq`-Folge sichtbar.

**13. Große Ausgaben, Anhänge, Binärartefakte, Pagination ohne stillen Datenverlust** — ✅
Integration: `zcode_artifact_read` mit 5-kB-Datei und `length:100` → `truncated:true`,
`size` korrekt, Base64-Inhalt exakt; Chunking via `offset/length` (Cap 1 MB), `sha256` über die
komplette Datei; Binary-fähig (base64 + MIME). Event-Pagination mit `limit`. Anhänge an
`session/send` sind nativ vorhanden (`attachments`-Param, 0.16+) aber nicht als eigenes Bridge-Tool
exponiert (Limitation §5).

**14. Für JEDE implementierte Capability positiv + negativ oder ausgewiesene Testblockade** — ✅
Matrix (`CAPABILITY_MATRIX.md`) führt für alle 45 Einträge Availability/Implementation/Verification
mit Nachweis. Implementierte Kern-Capabilities: positiv+negativ in Suite+Live (siehe oben). Als
`untested`/`missing` markierte Einträge (Plugin-Lifecycle, Provider-Registry-Writer, v4-Gateway,
subagents-Params) sind ausgewiesene Testblockaden mit Grund — keine behauptete Abdeckung.

## MCP-Client-Kompatibilität (getestet)

- Offizieller SDK-Client via `@modelcontextprotocol/sdk` (initialize/tools/list/tools/call/
  resources/list/resources/read, Legacy-Initialize) — alle Tests laufen über echte stdio-MCP-Clients.
- HTTP: Streamable-HTTP mit JSON-Responses via `fetch` (Robustheitstest, 2 Clients).
- MCP Inspector: **nicht ausgeführt** (nicht installiert). Repro:
  `npx @modelcontextprotocol/inspector node dist/index.js --stdio` — ausdrücklich als offener Punkt
  in IMPLEMENTATION_STATUS.md.

## Bekannte environment-bedingte Blockaden (nicht behoben, belegt)

1. Modell-Turns außerhalb der Desktop-App: Provider-Risikokontrolle „captcha verify failed“ (HTTP 400)
   — Pipeline bis dahin live grün, `turn.failed` mit voller Attribution. (KNOWN_LIMITATIONS §1)
2. GLM-5.3-Flash im lokalen Plan-Katalog nicht enthalten → Auswahl liefert `UNKNOWN_MODEL` + Katalog.
   (KNOWN_LIMITATIONS §2)
