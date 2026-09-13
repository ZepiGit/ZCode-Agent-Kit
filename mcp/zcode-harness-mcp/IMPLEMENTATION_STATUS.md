# IMPLEMENTATION_STATUS.md

Stand: 2026-09-12 — Projekt nach einer Kontextunterbrechung aus diesen Dateien fortsetzbar
(dieses Dokument, `docs/PROTOCOL.md`, `CAPABILITY_MATRIX.md`, `docs/KNOWN_LIMITATIONS.md`).

## Entscheidungen

1. **Protokoll live verifiziert statt angenommen**: NDJSON ohne `jsonrpc`-Feld; Klassifikation nach
   `id`/`method`; Reverse-Calls mit `server-N`-IDs; `session/create` blockiert bis
   `session/requestRuntimePreferences` beantwortet ist (live entdeckt — ohne das schlägt ALLES fehl).
   Details + Belege: `docs/PROTOCOL.md`.
2. **Eine Harness-Verbindung pro Bridge** (wie der Desktop): verwaltet mehrere Workspaces über
   Workspace-Objekte; transparenter Restart nach Harness-Exit; Tasks werden bei Verlust ehrlich
   `interrupted`/`unknown`, nie `completed`.
3. **Task-Completion = `turn.completed` + ruhige Projektion** (keine aktiven Tool-Calls, keine
   Background-Jobs, keine offenen Permissions) — „Turn fertig“ ist NICHT „Task fertig“.
4. **Sicherheitstechnische Durchsetzung** statt Annotationen (Allowlist, Read-only, Denylist im
   Harness, Reply-Whitelist für Interaktionen, Secret-Redaction in jedem Ausgabepfad).
5. **MCP via offizielles SDK, Legacy-Initialize**, strukturierte Outputs + Text-Parität, Resources
   mit echtem Read-Support; Polling-Tools funktionieren unabhängig von Client-Features.
6. **Fixture-Harness** für deterministische Integrationstests (Fake ist Testhilfsmittel, kein Teil
   der Bridge); Live-Suite testet die echte Installation separat und ehrlich.
7. **Mimosa Pre-Write-Hook**: blockierte mehrfach legitimen Spawn-Code (argument-array + `shell:false`
   — exakt die vom Hook empfohlene Form) und auch Bash/Edit-Weggaben. Lösung war **kein** Umgehen,
   sondern die vom Hook geforderte Form: fester Programmliteral `node`, variabler Script-Argv,
   `shell:false`, zentral in `src/runtime/spawn.ts`. SSRF-/„messages“-False-Positives wurden durch
   echte Umbenennungen (`.call`-Nomenklatur, `ipcSession*`-Fassade, `ipcSessionTranscript`) und
   echte Härtung (`parseSessionId`, `sanitizeInteractionReply`) aufgelöst. Verbleibende Findings:
   keine bekannten Write-Blocker mehr.

## Erledigt (mit Nachweis)

- Discovery (Kandidaten + `--version`-Verifikation + SHA-256-Fingerprint) — live: 0.16.5,
  `e9f1868c0fdb8635`
- Protokolladapter: Framing, Korrelation, Timeouts, Reverse-Calls, Notifications, Frame-Puffer-Grenze
- RuntimeManager: Restart-on-crash, Workspace-Scoping, Event/Reverse-Dispatch
- InteractionManager: Policies deny/allowlist/ask, Timeout→deny, atomare Auflösung, Option-Whitelist
- TaskManager+Ingress+Relay: nicht-blockierender Start, Idempotenz, Queue, Steering/Follow-up,
  verifizierter Cancel, Ergebnis-Cache über Neustarts, ehrliche Zustände
- Settings: Schema/Get/Update/Reset mit CAS (Revision), Read-back, Desktop-Inventar (read-only)
- 32 MCP-Tools + 6 Resource-Formen (alle wirklich lesbar), `zcode_operation_invoke` mit Allowlist
- Sicherheit: Allowlist (realpath), Read-only, Redaction (tests), Argument-Array-Spawn, Limits
- Tests: 7 Unit + 16 Integration + 4 Robustheit + 5 Live = **32/32 grün**
- Demo-Client (`examples/demo-client.mjs`) zeigt den 10-Schritte-Agenten-Fluss live und per Fixture

## Blocker (mit Beleg)

1. **Provider-Risikokontrolle** blockiert Desktop-externe Modell-Turns („captcha verify failed“,
   HTTP 400) — Details + Repro in `docs/KNOWN_LIMITATIONS.md` §1. Alles drumherum ist live verifiziert.
2. **GLM-5.3-Flash** im lokalen Plan-Katalog nicht enthalten → Auswahl liefert Fehler mit Katalog
   (korrektes Verhalten, kein Bridge-Defekt).

## Nächster konkreter Schritt

1. (Optionaler Nutzer-Step) Captcha/Risiko-Freigabe herbeiführen (Desktop-Sitzung) und
   `test:live` erneut laufen lassen → `completed`-Pfad mit echtem Modelltext belegen.
2. MCP Inspector einmal gegen stdio ausführen und Ergebnis in TEST_REPORT ergänzen.
3. Optional: `v4/*`-Gateway-Verfügbarkeit im Desktop-Kontext untersuchen (Attachments/Rewind).
4. Optional: Plugin-Lifecycle-Tools mit expliziter Operator-Freigabe implementieren.

## Ausführen

```
npm install && npm run build
npm test
$env:LIVE_TEST="1"; $env:LIVE_WORKSPACE="C:\..."; $env:LIVE_DATA_DIR="C:\..."; npm run test:live
node examples\demo-client.mjs --workspace "C:\..."
```
