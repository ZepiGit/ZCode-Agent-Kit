# TEST_REPORT — ZCode-Provider-Integration in OMP

Stand: 2026-09-13 · OMP 18.1.18 · zcode-proxy v4.6.4 (Commit 9a5cebe) · Node 26.7.0 / Bun 1.4.2
Testarten: **[FIXTURE]** = Mock/isoliert ohne Quota · **[LIVE]** = echte Inferenz über den ZCode-Zugang · **[CFG]** = Konfigurations-/Prozesstest

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
