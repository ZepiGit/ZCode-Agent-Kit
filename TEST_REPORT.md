# TEST_REPORT — ZCode-Provider-Integration

Stand: **2026-09-13 (Audit-Remediation + zcode-kit CLI + 10-Adapter-Matrix)** · OMP 18.1.18 · zcode-proxy v4.6.4 (Commit 9a5cebe) · Node 26.7.0 / Bun 1.4.2
Testarten: **[FIXTURE]** = Mock/isoliert ohne Quota · **[LIVE]** = echte Inferenz über den ZCode-Zugang · **[CFG]** = Konfigurations-/Prozesstest

## 0. Aktueller Gesamtstand (Audit-Auftrag, 2026-09-13)

Exakte Befehle und Ergebnisse (alle am heutigen Stand ausgeführt):

| Suite | Befehl | Ergebnis |
|---|---|---|
| Kit (Transactions, Manager-Safety, Setup-Regressionen, CLI/Adapter) | `npm run test` | **28/28 PASS** |
| Proxy (inkl. Gateway-Envelopes, Contract-Tests, Quota-Hardening) | `npm run test:proxy` (`bun test`) | **858/858 PASS** |
| MCP-Bridge (inkl. HTTP-Gate, Allowlist-Escapes, Robustness) | `npm run test:mcp` | **36/36 PASS** |
| Package-Pipeline | `node pack/build.mjs --dry-run-publish` + `node pack/verify-payload.mjs` | 215 Dateien, Dry-Run-Publish OK, Payload-Verifikation OK |

### Neue Fixture-Beweise (Audit-Pflichtpunkte)

**[FIXTURE] Manager-Prozess-Sicherheit** (`tests/manager-safety.test.mjs`, mit harmlosen Mock-Prozessen):
- Fremder Dienst auf dem Port (401 für unseren Key) → `stop` verweigert (Exit 3), Mock-Prozess überlebt.
- Fehlender Key (Identität nicht verifizierbar) → `stop` fail-closed (Exit 5), kein Kill.
- PID-Reuse (Startzeit-Datei ≠ Prozess-Startzeit, via PowerShell `StartTime.Ticks`) → `stop` verweigert (Exit 4), Prozess überlebt.
- Verifiziert-eigener Prozess (Identität + PID + Startzeit matchen) → gestoppt (Exit 0), PID-Datei geräumt.
- `doctor`/`logs` überleben fehlende Config ohne Crash (Lazy-Load).

**[FIXTURE] Transaktionale Backups** (`tests/transaction.test.mjs`):
- Rollback stellt modifizierte Dateien byte-identisch wieder her; später geänderte Dateien → Konflikt-Meldung, kein Clobber.
- Kit-erzeugte Dateien werden beim Rollback gelöscht — außer nachfolgend geändert (Konflikt).
- Backup-Namen kollisionsfrei über Transaktionen; gelöschte Ziele werden restauriert; parallele Setups werden gelockt (toter Holder wird übernommen).

**[FIXTURE] `disabledProviders`-Scoping** (`tests/transaction.test.mjs` — Audit-Regression):
- `- zcode` in `disabledProviders` wird entfernt; identischer Eintrag in fremden Listen (`allowTools`, `trustedTools`, verschachtelt) überlebt; Kommentare bleiben.

**[FIXTURE] Setup-Integration** (`tests/setup-regressions.test.mjs`, Fake-Home, PATH-isoliert):
- Run 1 wendet an (models.yml-Block, config.yml, Extension, mcp.json), Run 2 ist byte-identischer No-op **ohne** neue Transaktion, Rollback stellt Originalzustand byte-identisch her.
- Gefundene und behobene Bugs: Nicht-Idempotenz des Block-Remove (Nachlauf-Newline), globaler `
{3,}`-Collapse (könnte fremde Leerzeilen zerstören), Extension-Eintrag ohne Einrückung (`extEntry.trim()`).

**[FIXTURE] Adapter-Matrix** (`tests/cli-kit.test.mjs`): pi (additiver Merge, fremde Provider bleiben), opencode (JSONC-Kommentare bleiben), continue (Managed-Block, fremde Modelle bleiben), goose (auth.command-Helper), aider (Key nur in Env-Datei, nie in Logs), cline/kilo (manual-confirmation-required, kein VS-Code-State-Zugriff), JSONC-Editor (Kommentare + Trailing-Commas), Dry-Run schreibt nichts, unbekannter Harness-Name ist Fehler (Exit 2), Idempotenz je Adapter.

**[FIXTURE] Protocol-Contract** (`zcode-proxy-src/src/server/protocol-contract.test.ts`):
- SSE-Chunk-Grenzen inkl. mitten im Multi-Byte-UTF-8-Zeichen gesplitteter Chunks (kein U+FFFD, Event-Framing intakt).
- Thinking-Blöcke pass-through; Usage exakt aus Upstream-Feldern (je Feld genau einmal).
- Upstream-Fehler mitten im Stream wird sichtbar durchgereicht (kein stilles Stream-Ende).
- Client-Abort propagiert in den Upstream-Fetch (Produktions-Wiring via `startServer`: Socket-Close → AbortController → upstream signal).
- Bild-Block erreicht den Upstream unverändert (flash, base64 PNG).
- Slow-Reader/Backpressure: 200 Chunks, Reihenfolge und Vollständigkeit erhalten.
- Tool-Calls mit in 3 Fragmente gesplitteten `input_json_delta`-Argumenten → korrekt reassembliert, stabile IDs (Index-Semantik je OpenAI-Streaming-Regel); mehrere Tools in Reihenfolge (non-streaming), distinkte IDs.
- Responses-State: unbekannte `previous_response_id` → 404 (keine erfundene Historie); Byte-Budget-Eviction → ehrlicher 404, Speicher bounded.

**[FIXTURE] Quota-Hardening** (`routes-quota.test.ts`): Singleflight (3 parallele /quota → genau 1 Billing-Roundtrip), TTL-Cache mit `cached`/`asOf`, fehlgeschlagene Collection wird nicht gecacht, unbekannte Kontingentwerte sind `null` statt erfundener 0, Billing-Calls haben 10s-Timeout.

**[FIXTURE] MCP-Sicherheit** (`test/unit/security.test.mjs`, `test/integration/http-gate.test.mjs`): unbekannte CLI-Flags sind harter Fehler (`--read-onyl`-Schutz), HTTP ohne Key verweigert Start, Nicht-Loopback-Host verweigert, Allowlist löst durch Junction/Symlink-Eltern auf (bestehende UND neu erstellte Ziele unter auswärts zeigendem Elter), Traversal verweigert; Live-Gates: kein Auth → 401 (vor allem anderen), falscher Key → 401, gefälschter Host-Header (DNS-Rebinding) → 403, Origin `http://127.0.0.1.evil` → 403 (Prefix-Bypass geschlossen), legitime Requests erreichen den MCP-Layer.

### [LIVE] Live-Smoke über den GEFIXTEN Proxy-Code (2026-09-13, Port 8477 isoliert)

| Probe | Befehl/Request | Ergebnis |
|---|---|---|
| Flash-Completion mit Effort low | `POST /v1/messages` (thinking budget 2048, max_tokens 128000) | **200, end_turn, "OK"**, usage 1716/32 |
| `/quota` (gehärtet) | `GET /quota` | 200; `asOf`, `cached:false`, echte Balances; glm-5.3 `0/3000000` (Quota-Limit ehrlich sichtbar) |
| `/v1/models?client_version=pi` | `GET` | flash: `input_modalities: ["text","image"]` (Bildableitung aus Registry, nicht mehr `id.includes("v")`), `supported_reasoning_levels: [low, high, max]` (keine erfundenen medium/xhigh) |
| `/v1/models` (Whitelist) | `GET` | exakt `glm-5.3`, `glm-5.3-flash` (config.models respektiert) |
| max_tokens-Grenze | 131072 / 128001 / 128000 je 1 Flash-Request | alle 200/end_turn — Gateway erzwingt 128000 nicht hart; **Entscheidung**: Desktop-Katalog-Spec (128000) gilt, setup/Registry/EFFORT_MAPPING konsistent |

Hinweis: Das Proxy-Credential (`~/.zcode-proxy/credentials.json`) wurde heute zweimal extern geleert (~13:54, ~14:05 — vermutlich Desktop-App-Wartung); der dokumentierte Import-Weg (`auth login zai --import`) stellte es jeweils sofort wieder her.

---

## Historischer Bericht: Referenzinstallation (2026-09-13 vormittags)

## 1. Provider-Erkennung — [LIVE] ✅

| Befehl | Erwartung | Beobachtet |
|---|---|---|
| `omp models list` (aktives Profil) | Gruppe `zcode (2)` mit genau glm-5.3 + glm-5.3-flash, thinking `low,high,max` | ✅ `zcode (2)`, beide Modelle, `low,high,max`; 20 bestehende Provider-Gruppen unverändert (Diff leer) |

## 2. Wire-Payload je Effort-Level — [FIXTURE]+[LIVE] ✅

| Weg | Beleg |
|---|---|
| OMP → Mock (alle 6 Modell/Level-Kombinationen) | `tests/mock-requests.jsonl`: glm-5.3/flash senden `output_config.effort` ∈ {low,high,max} + `thinking.budget_tokens` ∈ {2048,16384,32768} |
| Proxy → Gateway (live, Flash low/high/max) | `logs/upstream-dump.jsonl` (seitlich entfernt): finale Bodies mit identischen Feldern; Start-plan-Systemblöcke vorhanden |
| glm-5.3 live | Felder am Gateway nachgewiesen (Dump); Completion blockiert durch Tageskontingent 0/3M (siehe 12) |

## 3. Live-Inferenz — [LIVE]

| Test | Befehl | Ergebnis |
|---|---|---|
| Flash, aktives Profil, normale CLI | `omp --model zcode/glm-5.3-flash --thinking low -p "Antworte ...: AKTIV"` | ✅ „AKTIV", Exit 0 (frische Shell, kein Env) |
| Flash Effort-Matrix (Testprofil) | `--thinking low|high|max` ×3 | ✅ je „BEREIT", Exit 0; Upstream-Usage authentisch (z. B. in=1721/out=27) |
| glm-5.3 live | `omp --model zcode/glm-5.3 ...` | ⏳ blockiert: Tageskontingent 0/3M (429/„[1005] exceed quota limit"); Nachweis-Skript `tests/verify-glm53.mjs` bereit (Reset 18:00 Ortszeit) |

## 4. Tool-Roundtrip — [LIVE] ✅

`tests/tooltrip/probe.txt` (3 Zeilen) → OMP (flash, low, --auto-approve): read → append `delta-8842` → re-read → Erklärung.
Beobachtet: ✅ echte OMP-Tool-Ereignisse, Datei danach enthält 4 Zeilen inkl. `delta-8842`, Modell fasst Inhalt korrekt zusammen (mehrere Tool-Turns, stabile IDs, vollständige JSON-Argumente).

## 5. Streaming und Abbruch — [LIVE] ✅

| Test | Beobachtet |
|---|---|
| Streaming sichtbar („Working…" + Textausgabe während Generierung, print-Mode) | ✅ |
| Abbruch während Generierung (taskkill nach 8 s) | ✅ Proxy bricht Upstream ab (client-close → AbortController); Folgeanfrage antwortet normal („FUNKTIONIERT"); keine orphan omp.exe (tasklist leer) |

## 6. Verlauf / Resume / Effortwechsel — [LIVE] ✅

Session (flash, low) „Merke dir WALD-42" → `-c --thinking high` Resume: ✅ „WALD-42" korrekt; Upstream-Request des Resumes trägt `effort: high` + Budget 16384 (Dump). Kein Zustandsüberlauf zwischen unabhängigen Sessions (jeweils `--no-session`-Läufe isoliert).
Kompaktierung: nicht synthetisch getestet (OMP-Core-Mechanik, provider-unabhängig); alle Transportdaten (Thinking-Replay-Blöcke, Tool-Ergebnisse) laufen im Anthropic-Passthrough unverändert.

## 7. Flash-Bildtest — [LIVE] ✅

`omp -p @red-square.png "Welche Hauptfarbe...?"` (echter OMP-Anhangspfad, 64×64 rot): ✅ „Rot." — multimodale Eingabe über den gesamten Weg.

## 8. Effort-Auswahl und Normalisierung — [LIVE] ✅ (mit dokumentiertem Rest)

| Fall | Beobachtet |
|---|---|
| `--thinking xhigh` | OMP normalisiert → Upstream `effort: high`, Budget 16384 (Dump); Picker zeigt nur low/high/max |
| `--thinking off` | OMP normalisiert → `low` + thinking enabled (GLM kann Reasoning nicht abschalten); dokumentiert in EFFORT_MAPPING.md |
| ungültiges Modell `zcode/glm-9.9` | ✅ saubere Fehlermeldung (Provider/Modell unbekannt) |
| interaktive TUI-Auswahl | **ungeprüft** (automatisierter TUI-Test in dieser Umgebung nicht möglich); CLI-Pfad vollständig nachgewiesen |

## 9. Negativfälle — [FIXTURE]+[LIVE]

| Fall | Beobachtet |
|---|---|
| Falscher/fehlender lokaler Schlüssel | Schlüsseldatei entfernt → OMP startet Request-Phase nicht: „Use /login, set an API key environment variable, or create models.yml" ✅; `--api-key` überschreibt Custom-Provider-Key nicht (Doku-Fakt, dokumentiert) |
| Unauthentifizierter Proxy-Zugriff | `curl /health` ohne Schlüssel → HTTP 401 ✅ (authentifizierter Health-Check als Identitätsnachweis im Manager/Extension) |
| Quota erschöpft (glm-5.3) | Gateway-Envelope `{"code":1005}` wird vom Proxy-Patch in **HTTP 400 (invalid_request_error, nicht retryable)** übersetzt; OMP bricht sauber ab statt Retry-Sturm ✅ (Einheitstests: `bun test src/proxy/gateway-envelope.test.ts` 7/7) |
| Modell nicht erlaubt (glm-5.2) | → HTTP 403 permission_error (Code 3006) ✅ |
| Rate-Limit / CAPTCHA (Gateway-Anti-Absicherung nach Retry-Barrage) | Gateway wechselt in Challenge-Modus (200 + CAPTCHA-Forderung; Solver im Proxy best-effort, in dieser Umgebung deaktivierbar) → Verhalten dokumentiert; nach Abkühlzeit wieder reguläre Envelope-Antworten |
| Fremder Dienst auf Port 8457 | Manager start verweigert: „port occupied by foreign service (auth failed). Not touching it." Exit 3 ✅ |
| Proxy nicht erreichbar (mit Extension) | Extension startet ihn bedarfsgesteuert ✅ (siehe 10) |
| Proxy nicht erreichbar (ohne Extension, `--no-extensions`) | OMP: „Retry budget exhausted after 10 retries: Connection error." — begrenzt, klar, andere Provider unbeeinflusst ✅ |

## 10. Automatischer Start — [LIVE] ✅

Manager-`stop` → neuer OMP-Aufruf (`omp --model zcode/glm-5.3-flash ...`): Extension erkennt toten Proxy (authentifizierter Check), startet via Manager („started (pid …) — healthy"), Anfrage läuft durch („AUTOSTART"). Parallelstart mehrerer OMP-Sessions konvergiert auf eine Instanz (Health-Check + Portbindung); PID-Datei + „already running" Erkennung; veraltete PID-Dateien werden entfernt.

## 11. Persistenz — [LIVE] ✅

`env -i` (leere Umgebung, nur HOME/USERPROFILE/PATH): Registrierung sichtbar, Schlüsselauflösung via `!node`-Resolver funktioniert (kein Env nötig), Modell-/Effort-Auswahl aktiv. Keine Abhängigkeit von Tool-Shell-Variablen. Kein Reboot erfolgt.

## 12. Offene Punkte

1. **glm-5.3 Live-Completion**: Tageskontingent (3 Mio. Token) zum Testzeitpunkt aufgebraucht (0/3M, Reset 2026-09-13T15:59:59Z). Wire-Felder nachgewiesen, Completion-Akzeptanz der drei Level ausstehend → `node tests/verify-glm53.mjs` nach dem Reset ausführen.
2. **TUI-Interaktion**: nicht automatisierbar in dieser Umgebung — interaktive Modell-/Effort-Auswahl im Vollbild-TUI bitte einmalig visuell prüfen.
3. **Gateway-CAPTCHA**: Bei Missbrauchsmustern (z. B. Retry-Stürme auf erschöpftem Kontingent) schaltet das Gateway auf Challenge-Modus; der im Proxy enthaltene Solver ist hier best-effort. Nach Abkühlzeit regulär; Verhalten dokumentiert.
