# IMPLEMENTATION_STATUS

## Aktueller Arbeitsstand — 2026-09-16

**Quellcode unabhängig freigegeben; isolierte Tests bestanden; Release extern blockiert.**
Opus-5 (`max`) hat nach dem bestätigten Nutzungslimit von Fable 5.1 (`xhigh`)
die abschließende Codeprüfung übernommen und `CODE APPROVE` erteilt.
Implementierung, Fixture-Test, Live-Test und veröffentlichte Version sind getrennte Zustände.
Die persönliche Installation wurde in diesem Auftrag nicht verändert; vorhandene
Installationen erhalten diese Änderungen nicht allein durch eine Änderung im Checkout.

- Continue: sichere leere YAML-Modelllisten (`models: []`), Kommentare und
  einrückungslose Listen; Nutzermodelle/Default-Reihenfolge bleiben erhalten.
  JSON-gequoteter lokaler Proxy-Key statt ungültiger Env-Interpolation; Drift-Prüfung
  ohne Key-Ausgabe. Continue nicht installiert: echte Client-/Live-Prüfung blockiert.
- Diagnose/Reparatur (`cli/heal.mjs`): ausgewählte Adapter unter Setup-Lock;
  Key-Angleichung nur bei eindeutigem Kit-Template und exklusiv reservierbarem
  Offline-Port. Fehler rollen erfasste Reparatur-Dateiänderungen zurück, anders
  als Setup. Checkout-Opt-in bleibt nötig; kein allgemeines Bootstrap/Dependency-Install.
- Start-Preflight: sicherer Manager-Start plus einmalige begrenzte Quota-Prüfung;
  Auth `3012` getrennt von Balance `1113`/`3001`. Upstream-Befunde und fehlende
  Telemetrie warnen, lassen aber den gesunden Proxy für begrenzte Modellpfad-Recovery
  nutzbar; lokale Identitäts-/Startfehler blockieren. Kein Fremdprozess-Kill/Lock-Takeover.
- Setup-Smoke: ein minimaler echter Flash-Aufruf, der Kontingent verbrauchen kann;
  CI/Test oder `ZCODE_KIT_SKIP_SMOKE=1` überspringen ihn. Fehler lassen gespeicherte
  Integrationen bestehen. Das ist Quellcodeverhalten, kein neuer Live-Beweis.
- Credential-Recovery: Request-Reload bewahrt den letzten gültigen Wert bei
  ungültigen/teilgeschriebenen Stores, löscht ihn aber bei fehlendem Store/Logout.
  Ausgewählte nichtstreamende Auth-/Balance-Fehler: ein vorhandener Desktop-Import
  und eine Wiederholung nur bei geändertem effektivem Credential. Parallele
  Recovery geteilt, pro Credential/Quellrevision begrenzt; verschlüsselte Persistenz
  nur bei unverändertem beobachtetem Proxy-Store. Keine Desktop-Schreibzugriffe,
  Browser-Anmeldung, Trial-Aktivierung oder Wiederholung laufender SSE-Streams.
- npm: `postinstall` zeigt nur einen Hinweis. Erst `zcode-kit setup` führt die
  Installation/Integration aus.
- `setup` / `integrate` behalten bei Fehlern bereits erfolgreiche Teilschritte
  und protokollieren sie für einen expliziten Rollback. Kein globales All-or-nothing:
  Credentials, lokale Schlüsselerstellung, Dependencies und externe CLI-Aktionen
  sind nicht vollständig rückrollbar.
- Baseline vor Änderungen: **65 Kit / 872 Proxy / 42 MCP**; damaliger MCP-`wmic`-Kill-Pfad
  nicht ausgeführt. Finale isolierte Suiten: **150 Kit PASS + 1 Live-Opt-in SKIP,
  946 Proxy PASS, 42 MCP PASS**, keine Fehler. Echter besitzgeprüfter Windows-
  Fixture-Kill jetzt ausgeführt. OMP beide Modelle normal, nach eigenem Proxy-
  Absturz und nach Offline-Key-Reparatur live mit exakt `52`; ein erster
  Normalaufruf-Timeout bleibt dokumentiert. Echte isolierte npm- und PowerShell-
  Installationsprüfungen bestanden; Details und Grenzen in `TEST_REPORT.md`.
- Release-Workflow (bestehende Trigger-/Versionspolitik): Push auf `main`, `v*`-Tags und
  manueller Dispatch lösen Tests aus. Nicht-Tag-Läufe verwenden die aktuelle Version
  nur bei npm-E404 und fehlendem Remote-Tag oder Tag auf exakt demselben HEAD.
  Sonst suchen sie maximal 100 Patch-Kandidaten, die auf npm und bei Remote-Tags
  frei sind, und erzeugen Versions-Commit/Tag. Dispatch ist nur unter diesen
  Bedingungen ein gleichversioniger Retry; ein fremder Tag-Commit blockiert
  Versionswiederverwendung auch bei fehlender npm-Version. Vorhandene GitHub-Release-Assets bleiben erhalten;
  Tag-Läufe überspringen npm-Publish bei bereits veröffentlichter Version.
  Versions-Gate, Tests und OIDC-Publish bleiben erforderlich. Neue Workflow-Härtung:
  npm 11.19.1, CI-Paketierung nur getrackter Dateien, nur strukturiertes Registry-E404
  gilt als unveröffentlicht, begrenzte Prüfung der exakten Version nach Publish.
  Das ist Quellcodeverhalten, kein Nachweis einer erfolgreichen Veröffentlichung.
- Release-Gate: Upstream-README deklariert nachweislich MIT; separate LICENSE-/
  Copyright-Notice-Datei nicht gefunden. Redistribution-/Notice-Prüfung bleibt
  offen; kein pauschales „unlizenziert“, aber auch keine Freigabe behauptet.

---

## Archiv — frühere Implementierungs- und Installationsbeobachtungen

Alle nachfolgenden Fertig-/Live-/Installations- und Release-Gate-Angaben beziehen
sich ausschließlich auf den genannten historischen Stand. Sie wurden in diesem
Auftrag nicht erneut verifiziert und belegen keine aktuelle persönliche Reparatur.
Die damalige Aussage „alle Schreibvorgänge transaktional“ war zu weit gefasst;
maßgeblich sind die oben dokumentierten Grenzen.

Stand: **2026-09-13 (spät) — Audit-Remediation + zcode-kit CLI + Zehn-Adapter-Matrix + Release-Vorbereitung**

## Baustein-Status (Audit-Auftrag)

| Baustein | Status |
|---|---|
| Sicherheits-/Datenverlust-Fixes (Stufe 2) | **fertig + getestet** — transaktionales Setup (`lib/transaction.mjs`: Hash-Drei-Wege-Rollback, kollisionsfreie Backups, Setup-Lock), gescopetes `disabledProviders`-Editing (`lib/config-edit.mjs`), bun-Install hart fehlschlagend mit Lockfile-Hash-Marker, exklusive Key-Erstellung, YAML/TS-sicheres Quoting, byte-exakte Block-Entfernung (Idempotenz-Bug behoben) |
| Manager-Rewrite | **fertig + getestet** — stop fail-closed bei nicht verifizierbarer Identität, PID-Reuse-Schutz über Prozess-Startzeiten (PowerShell-Ticks / procfs), Start-Lock, Lazy-Config (help/doctor crashen nicht ohne Config), persönlicher Fallback-Pfad entfernt, ESM-logs-Fix + begrenztes Tail-Lesen, Harness-bewusster Doctor (SKIP statt FAIL), Auth-Validität getrennt vom JWT-Alter, Graceful-then-Forced-Eskalation; Mock-Prozess-Beweise in `tests/manager-safety.test.mjs` |
| MCP-Sicherheit | **fertig + getestet (36/36)** — Allowlist löst kanonisch durch Junction/Symlink-Eltern (auch für nicht existierende Ziele), Windows-Case-Insensitivität; HTTP-Modus: Bearer-Pflicht (timing-safe), exakte Host-/Origin-Prüfung (DNS-Rebinding + Prefix-Bypass geschlossen), Loopback-Only, Body-/Inflight-Limits, Header-Timeouts; Config: unbekannte Flags = Fehler, Limits validiert, Deny-by-default erhalten |
| Modell-Registry | **fertig + getestet (858/858)** — eine Quelle (`src/provider/models.ts`): Modalitäten (flash-Bild live belegt, nicht mehr `id.includes("v")`), verifizierte Efforts [low,high,max] (keine erfundenen Stufen), `/v1/models` respektiert `config.models`-Whitelist; 128000-vs-131072 per Desktop-Katalog + Live-Probe entschieden (128000); Quota: Singleflight + TTL + `asOf`/`cached`, unbekannte Werte `null` statt 0, Billing-Timeouts |
| Protocol-Contract-Tests | **fertig** — SSE-Grenzen (inkl. Multi-Byte-Splits), Thinking, Fehler im Stream, Abort-Propagation (Produktions-Wiring), Bilder, Backpressure, fragmentierte Tool-Args, mehrere Tools, Responses-Isolation + Byte-Budget (neu im Store), Usage-Fidelity |
| zcode-kit CLI (Stufe 3) | **fertig + getestet** — `cli/zcode-kit.mjs` mit setup / integrate(--dry-run) / run / doctor(--json) / status / models / usage / auth / update / rollback / uninstall; alle Schreibvorgänge transaktional, Dry-Run-Write-Guard zentral (`lib/edit.mjs`); `setup.mjs` ist Shim auf dieselbe Implementierung |
| Zehn Adapter (Stufe 4/5) | **implementiert + Fake-Home-getestet** — omp, pi, claude-code, codex, opencode, cline, kilo-code, aider, continue, goose; Live-getestet: omp (Effort-Matrix, Vorläufer-Session), claude-code, codex; ehrlich `runtime-unavailable`: pi/opencode/aider/continue/goose (nicht installiert); `blocked-by-gui`: cline/kilo (Werte vorbereitet, manual-confirmation-required); Details: SUPPORT_MATRIX.json/.md |
| Distribution (Stufe 6) | **vorbereitet, Publikation gated** — root package.json (private=true), `pack/build.mjs` (Allowlist, 215 Dateien) + `pack/verify-payload.mjs` (Secret-/Pfad-Gate) + `npm publish --dry-run` grün; `install.ps1`/`install.sh` (gepinnte Version, SHA256, WSL-Erkennung, in-place Update); CI (`.github/workflows/ci.yml`) + `npm-publish.yml` (Test-Gate + ALLOW_PUBLISH-Marker); echte Veröffentlichung erfordert Maintainer-Aktionen (docs/RELEASE_CHECKLIST.md) |
| Lizenz | Root-LICENSE (MIT) + MCP-LICENSE ergänzt; **Release-Gate**: vendored Proxy hat upstream README-MIT, aber keine LICENSE-Datei — Redistribution via npm erst nach Klärung (dokumentiert) |
| Referenzinstallation | unangetastet (Port 8457); Live-Smoke des GEÄNDERTEN Proxy-Codes lief isoliert auf Port 8477 (Flash 200 „OK", Quota/Catalog-Endpunkte verifiziert) |

## Offene Punkte / Blockaden

1. **Commits/Push**: Mimosa-Hook blockiert Commits aus dieser Session (Fremdbefunde im Plattform-Code `C:\Program Files\ZCode`, nicht Kit) — Übergabe an das Terminal des Nutzers.
2. **npm/Release-Publikation**: bewusst gated (private-Package + ALLOW_PUBLISH-Marker + npm_token + Lizenzklärung vendored Proxy) — docs/RELEASE_CHECKLIST.md.
3. **Live-Client-Tests** für pi/opencode/aider/continue/goose: auf dieser Maschine nicht installiert → Status `runtime-unavailable` (Konfiguration getestet, Client-Verhalten nicht behauptet).
4. **TUI-Interaktion OMP** (interaktive Modellwahl) weiter ungetestet (headless unmöglich).
5. Bun-Compile-Bundling (runtime-freie Enduser-Installation) ist als Ansatz benannt, aber nicht gebaut — Installer verifizieren stattdessen gepinnte Runtime-Downloads; die Voraussetzung Node ≥ 20 + bun bleibt ehrlich im README genannt.

---

## Vorheriger Stand: Kit-Paketierung (harness-agnostische Verteilung)

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

## Historische Referenzinstallation (damalige Beobachtung, 2026-09-13)

`C:\Users\miche\zcode-omp-integration` — damals als aktiv protokolliert: doctor 9/9 PASS (nach Synchronisation
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
