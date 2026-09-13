# IMPLEMENTATION_STATUS

Stand: 2026-09-13 — **Kit-Paketierung abgeschlossen** (dieser Ordner, `zcode-agent-kit`,
ist das teilbare Paket; die Referenzinstallation lebt getrennt davon und blieb unangetastet).

## Kit-Stand (harness-agnostische Verteilung)

| Baustein | Status |
|---|---|
| setup.mjs (Bootstrap + OMP + Claude-Wrapper + Codex-Wrapper + MCP-Registrierung) | **implementiert**; Trockenlauf gegen Fake-Home sauber (Bootstrap, Adapter, Idempotenz, echte `~/.omp`/`~/.claude`/`~/.codex` unberührt) |
| Wrapper Claude Code (`bin/zcode-claude.cmd` + generierte Settings) | **live getestet** — „OK" über Kit-Proxy (2× stream 200); Settings-Env `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000` gegen Katalog-Warnung |
| Wrapper Codex CLI (`bin/zcode-codex.cmd` + isoliertes CODEX_HOME) | **live getestet** — „OK", 16.094 Tokens über Start-plan; `wire_api = "responses"` (chat wird von codex 0.153.4 nicht mehr unterstützt); kosmetischer Upstream-Fehler „OutputTextDelta without active item" im Proxy-Responses-Handler möglich, Ergebnis korrekt |
| `/v1/responses` im Proxy | **live getestet** (Responses-Objekt mit Reasoning-Summary) — daher in config.example.yaml aktiviert |
| MCP-Bridge (mcp/zcode-harness-mcp, MIT) | **Testsuite 30/30 grün** im Kit; Registrierung für OMP (mcp.json) + Claude (`claude mcp add`) implementiert; Live-Turn-Tests nicht wiederholt (Start-Plan-Quota-Rücksicht) — Desktop muss für Turns laufen |
| Manager (start/stop/restart/status/doctor) | **hartening nachgezogen**: `stop`/`start`-Fehlerpfade killen jetzt den ganzen Prozessbaum (taskkill /T /F) — bun-Spawn-Kinder hinterlassen keine Waisen mehr; in der Referenzinstallation synchronisiert |
| Bootstrap-Schlüssel-Substitution | Bug behoben: „GENERATE_ME" stand auch im Beispiel-Kommentar; Replace zielt jetzt auf denquoted Wert und validiert |
|Geheimnisse | Kit-Ordner source-only: kein `.proxykey`, kein `proxy/config.yaml`, kein `generated/`, keine Logs/Backups — alles regeneriert setup.mjs |

## Referenzinstallation (Separat, auf diesem Rechner)

`C:\Users\miche\zcode-omp-integration` — unverändert aktiv: doctor 9/9 PASS (nach Synchronisation
des Manager-Hardening und Entfernen des versehentlich dorthin kopierten `mcp/`-Ordners),
Proxy läuft, OMP-Smoke „BEREIT". Die beiden Installationen teilen Port 8457 nicht gleichzeitig —
pro Rechner läuft genau eine Proxy-Instanz; das Kit erkennt auf Port 8457 eine fremde Instanz
und startet dann nicht (Absicht).

---

## Historischer Stand der Referenzinstallation (2026-09-13, 22:50 UTC+2)

Abschlussprüfung: `doctor` 9/9 PASS; Live-Smoke im aktiven
Profil (`omp --model zcode/glm-5.3-flash --thinking high -p ...`) → „BEREIT", Exit 0.
Geheimnis-Scan über alle Artefakte sauber (Proxy-Schlüssel nur in `.proxykey` und der
Proxy-eigenen `config.yaml`; keine JWT-/Fremdschlüssel-Materialien in Berichten, Logs oder
Testresten; Testlogs entfernt).

## Status je Baustein

| Baustein | Status |
|---|---|
| Bestandsaufnahme (Abschnitt 3) | **fertig** — SETUP_REPORT.md |
| Zugangsanalyse | **fertig** — Z.ai-OAuth-Beide-Konten ohne Coding-Plan (429 1113); tatsächlicher Zugang: ZCode-Desktop **start-plan** (JWT); der Weg ist belegt |
| Proxy (zcode-api @ 9a5cebe, MIT) | **live getestet** — installiert, konfiguriert (127.0.0.1:8457, claim/async aus), Credential per Desktop-Import |
| Lokale Proxy-Patches | **implementiert + Unit-getestet (12/12)** — (a) HTTP-200-Fehler-Envelopes → echte Statuscodes (1005/1113→400, 3006/3007/3012→403, sonst 502), (b) Accept-Encoding-Filter (zstd raus, Grund: OMP/Bun kann zstd-Antworten nicht dekodieren). Dateien: `src/proxy/handler.ts`, `src/proxy/upstream.ts`; Tests: `src/proxy/gateway-envelope.test.ts`, `src/proxy/accept-encoding.test.ts` |
| OMP-Provider „zcode" (2 Modelle, Efforts) | **live getestet** — models.yml-Managed-Block, Effort-Weg vollständig (EFFORT_MAPPING.md/.json) |
| Autostart-Extension | **live getestet** — bedarfsgesteuerter Start beim ersten ZCode-Aufruf; registriert in config.yml `extensions:` (OMP lädt nur gelistete Extensions) |
| Manager (start/stop/restart/status/doctor/logs) | **lokal getestet** — inkl. Identitätscheck (authentifiziert), Foreign-Port-Verweigerung, Stale-PID-Behandlung |
| Setup/Rollback | **lokal getestet** — idempotent, YAML-validiert, atomar; Rollback restores byte-identisch (Hash-Vergleich) |
| Tests | **großteils live getestet** — TEST_REPORT.md; offen: glm-5.3 Live-Completion (Quota-Reset 18:00), TUI-Interaktion |

## Entscheidungen (chronologisch)

1. OMP-Binary-Analyse statt Raten: eingebaute `zai`-Catalogeinträge (glm-5.3: anthropic-messages+output_config.effort; flash: openai-completions+reasoning_effort), `anthropic-budget-effort`-Mapping, `Ty`-Reject für ungültige Levels.
2. Mock-Server bewies: reines models.yml setzt `compat.supportsOutputEffort` durch → keine Extension nötig für die Modellmetadaten.
3. 429-1113 auf beiden gespeicherten Z.ai-Konten → Direktweg (coding-plan) tot ohne Kauf → Start-plan-Weg über zcode-proxy mit Desktop-JWT-Import (`auth login zai --import`, kein neuer Browser-Login).
4. Transport anthropic-messages (Passthrough) für beide Modelle: geringster Übersetzungsverlust, OMP bleibt Budget-/max_tokens-Inhaber; Abweichung der Budgetzahlen von der Desktop-Tabelle dokumentiert.
5. `disabledProviders: zcode` war veraltet (kein builtin zcode-Provider mehr) und blockierte Custom-Provider → gezielt entfernt; `zai` bleibt deaktiviert.
6. Proxy-Patches minimal gehalten; Ursachen jeweils am Wire belegt (429-Sturm → CAPTCHA-Modus; zstd-Antworten von OMP undekodierbar).

## Offene Fehler / Blockaden

- **glm-5.3 Live-Completion**: blockiert durch erschöpftes Tageskontingent (0/3.000.000 Token, Reset 2026-09-13T15:59:59Z ≙ 18:00 Ortszeit). **Nächster konkreter Schritt:** `node C:\Users\miche\zcode-omp-integration\tests\verify-glm53.mjs` nach dem Reset ausführen; bei Fehlschlag Ausgabe in TEST_REPORT nachtragen. Zusätzlich einmal `omp --model zcode/glm-5.3 --thinking low -p "Antworte: ok"` im Terminal.
- **TUI**: interaktive Auswahl nicht automatisiert prüfbar → einmalig manuell verifizieren.
- **Gateway-CAPTCHA-Modus** bei erschöpftem Kontingent + Retry-Barrage: dokumentiert; keine Aktion nötig, außer Anfragen einzustellen bis Reset.
