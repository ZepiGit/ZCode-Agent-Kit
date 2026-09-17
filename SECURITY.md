# Security-Hinweise

## Unveröffentlichte Audit-Reparaturen — 2026-09-17

Dieser Arbeitsstand repariert die Windows-Argumentweitergabe, Session-Workspace-Prüfung,
MCP-Task-Abbrüche, Streaming-Fehler, Adapter-Datenerhalt und Installer-Zielprüfungen.
Tests verwenden isolierte Profile und synthetische Credentials; sie sind kein neuer
Live-Modell-, Linux- oder macOS-Nachweis. Unabhängige Reviews sind bereichsweise erfolgt,
eine pauschale Freigabe aller Änderungen ist daraus nicht ableitbar.

- Remote CAPTCHA-JavaScript ist ohne ausdrückliches Standalone-Opt-in deaktiviert.
  Es gibt **keine OS-Sandbox**; die Egress-Allowlist ist keine Prozessisolation.
  Das Kit entfernt den unsicheren Opt-in aus seiner Proxy-Umgebung. Start-Plan-Anfragen
  können deswegen verweigert werden. Lokale Testfixtures laden keine CDN-Skripte.
- npm-Zustand wird außerhalb des austauschbaren Paketverzeichnisses gespeichert;
  Quell-/Tarball-Kopien behalten ihren lokalen Zustand. Migration beim Setup durchführen,
  bevor ein altes npm-Paket ersetzt wird. Bereits verlorene Daten werden nicht rekonstruiert.
- Proxy-/MCP-Bearer-Keys sind eine gemeinsame Vertrauensdomäne, keine Benutzerisolation.
  Der Proxy authentifiziert `/health` und API-Routen; WebUI und OPTIONS sind öffentlich.
- Credentials und manche Adapterkonfigurationen/Backups enthalten sensible Daten.
  Windows-Dateimodi ersetzen keine ACLs. Der ableitbare Standard-Credential-Schlüssel ist
  keine starke Geheimnisbindung; `ZCODE_PROXY_CREDENTIAL_SECRET` ermöglicht einen separaten
  stabilen geheimen Seed. Cross-Process-CAS und native Secret-Store-Integration bleiben offen.
- ALLOW_PUBLISH ist eine Versionskonsistenzprüfung. Automatische Main-Releases sind gewollt;
  weder Marker noch Workflow sind eine unabhängige rechtliche/Lizenzfreigabe.
- Crash-Rollback verändert existierende Dateien nur bei passendem protokolliertem
  Schreibhash. Unklare Änderungen bleiben als Konflikt erhalten. Nicht erfasste Codex-
  Sitzungen und andere Nutzerdaten in generated werden beim Uninstall nicht pauschal gelöscht.

## Historischer Arbeitsstand — 2026-09-15

Die nachstehenden aktuellen Aussagen beschreiben den geprüften Quellcode, keine
veröffentlichte Version und keine Reparatur der persönlichen Installation.
Abschließende Testergebnisse stehen noch aus; historische Audit- und Live-Belege
weiter unten sind kein neuer Sicherheitsaudit dieses Arbeitsstands.

- **Continue-YAML:** Leere Flow-Listen (`models: []`, auch mit getrenntem Kommentar)
  werden in eine Blockliste überführt. Nichtleere Inline-Werte, doppelte
  Top-Level-Schlüssel und nicht sicher editierbare Formen werden verweigert,
  nicht durch einen zweiten `models`-Schlüssel verdeckt. Nutzer-Modelle bleiben
  zuerst, auch bei einrückungslosen Listen. Die verwaltete Continue-Konfiguration
  enthält den JSON-gequoteten lokalen Proxy-Key, nicht die Desktop-Anmeldung;
  Adapter-Logs geben ihn nicht aus. Config und Transaktionsbackups deshalb nicht
  teilen oder veröffentlichen. Nach Key-Rotation erneut integrieren.
- **Credentials:** Request-seitiges Nachladen unterscheidet einen fehlenden Store
  (In-Memory-Credential wird gelöscht) von ungültigen/teilgeschriebenen Daten
  (letzter gültiger Wert bleibt). Das stoppt keine bereits laufende Anfrage und
  widerruft keinen Upstream-Token. Recovery liest nur die vorhandene eigene Desktop-
  Anmeldung, startet keinen Browser-Login und aktiviert weder Trial noch Claim.
  Versuche pro abgelehntem Credential und Desktop-Quellrevision sind begrenzt und
  parallel zusammengeführt; eine spätere Desktop-Anmeldung kann erneut geprüft
  werden. Neue gültige Werte werden nur bei unverändertem beobachtetem Proxy-Store
  verschlüsselt persistiert; Desktop-Dateien werden nicht beschrieben. Ausgewählte
  nichtstreamende Auth-/Balance-Fehler erlauben nur eine Wiederholung vor Ausgabe
  und nur bei geändertem effektivem Credential. Kein SSE-/In-Stream-Replay.
  Maximal 128 Fehler-Credential/Quellrevision-Paare pro Prozess, danach kein
  automatischer Reimport bis zum Neustart. Die Store-Prüfung vor atomarem Rename
  ist kein prozessübergreifender Lock: ein enges Rennen zwischen Vergleich und
  Ersetzen bleibt. Keine allgemeine CAS-/Mehrprozess-Garantie behaupten.
  Zugang, Berechtigung und Quota werden dadurch nicht garantiert.
- **Prozessidentität:** Start-Preflight nutzt den sicheren Manager-Start; ein
  fremder oder nicht sicher identifizierter Listener wird nicht gestoppt. Ein
  belegter Port ist kein Besitznachweis, alte Locks werden nicht automatisch
  übernommen. Einmalige Quota-Prüfung mit Timeout; keine dauernde Polling-Schleife.
  Auth `3012` und Balance `1113`/`3001` bleiben getrennt. Diese Upstream-Befunde
  sowie fehlende Telemetrie warnen, blockieren aber den gesunden lokalen Proxy
  nicht: Der Modellpfad darf begrenzte Credential-Recovery versuchen. Lokale
  Identitäts-/Startfehler blockieren weiter; es gibt keinen erfundenen Nullsaldo. `logs/heal.log` ist größenbegrenzt
  und verwendet feste Kategorien statt Secrets oder Provider-Antworttext.
- **Explizite Reparatur:** `doctor --fix` übernimmt nur eindeutige Kit-Template-
  Key-Angleichung bei exklusiv reservierbarem Offline-Port sowie ausgewählte
  Adapter. Bei nötiger Key-Angleichung werden eigene/defekte Configs und belegte
  Ports verweigert; ein passender Key benötigt keine Config-Änderung. Setup-Lock
  und Checkout-Opt-in bleiben aktiv. Bei Fehlern werden erfasste Dateiänderungen
  dieser Reparatur zurückgerollt; das ist keine globale Rollback-Garantie.
- **Setup-Live-Smoke:** Normaler Setup-Lauf versucht einen minimalen Flash-Aufruf
  mit Timeout. Er kann Kontingent verbrauchen; CI/Test und `ZCODE_KIT_SKIP_SMOKE=1`
  überspringen ihn. Ein Fehlschlag entfernt keine gespeicherten Integrationen.
- **Rollback-Grenzen:** Erfasste Konfigurationsdateien haben Backups; bei
  abgeschlossenen Transaktionen schützen Post-Hashes spätere Nutzeränderungen.
  `setup` / `integrate` protokollieren Teiländerungen nach Fehlern, statt sie
  automatisch vollständig zurückzunehmen. Crash-Recovery eines offenen Journals
  stellt dessen Vorzustand wieder her und bietet nicht denselben Post-Hash-Schutz.
  Credentials, lokale Schlüsselerstellung, Dependencies und externe CLI-Wirkungen
  sind nicht vollständig transaktional; externe Registrierungen können manuelle
  Undo-Kommandos benötigen.
- **npm:** Der Postinstall-Hook zeigt nur einen Hinweis. Setup/Integration erfolgt
  erst durch den expliziten Setup-Aufruf.

## Historische Politik-Entscheidungen (nach externem Audit, 2026-09-13)

Die damaligen Scan-Ergebnisse und Testzahlen gelten nur für den damaligen Stand;
„keine Befunde“ bedeutet nicht, dass aktuelle Dateien nachweislich fehlerfrei sind.

Ein externes Audit (14 Findings, „ZAK-001" bis „ZAK-014") führte zu diesen
dokumentierten Entscheidungen und Code-Nachbesserungen. Ein zweiter,
adversarialer Audit des remedierten Stands (13 Findings, „AUD-001" bis
„AUD-013") wurde vollständig umgesetzt: Lock-Takeover jetzt vollständig
fail-closed (kein automatisches Löschen von Locks — die Unlink-After-Stale-
Observation-Race ist ohne atomares Compare-and-Delete nicht sicher schließbar),
`pidAlive` zählt nur ESRCH als tot, JSONC-Top-Level-Key-Scanner repariert
(Duplikat-Keys bei Re-Runs), OpenCode-Adapter respektiert fremde
`provider.zcode`-Einträge (Kit-Signatur), Write-ahead-Journal für
Crash-Konsistenz (in-progress-Transaktionen sind auffindbar und rollbar),
wx-Staging-Dateien mit Zufallssuffix, MCP-413 sofort beim Limit-Überschreiten
(slowloris-resistent) plus Content-Length-Vorabprüfung, macOS-Startzeit über
`ps -o lstart=` (kein /proc), `zcode-kit update` verweigert auf
Tarball-Installationen mit klarer Meldung, uninstall entfernt die
claude-MCP-Registrierung selbst, Continue-Adapter lehnt uneditierbare
`models:`-Formen ab statt Doppel-Keys zu erzeugen, `[::1]` wird kanonisiert,
Release-Marker ist versionsgebunden, vendored Beispiel-Config auf
fail-closed-Claim-Defaults.

1. **Historische CAPTCHA-Entscheidung überholt.** Die frühere Behauptung,
   automatisierte Challenge-Lösung sei keine Human-/Bot-Verifikationsumgehung,
   war nicht belastbar. Der aktuelle Default blockiert die nicht isolierte
   Ausführung fremder Skripte; es wird keine Freigabe oder Umgehung von
   Provider-Sperren zugesagt.
2. **Automatisches Trial-Claiming: fail-closed.** `CLAIM_ENABLED`/`CLAIM_AUTO`
   defaulten jetzt auf `false` (vorher `true`, wenn der claim-Block fehlte).
   Aktivierung erfordert explizit `claim.enabled: true` in der eigenen Config —
   keine Kit-Config setzt das.
3. **Loopback + Bearer-Key sind Startup-Invarianten.** Der Proxy verweigert
   das Binden jeder Nicht-Loopback-Adresse (Load-Zeit und Listen-Zeit) und den
   Dienst ohne echten Key (Platzhalter `GENERATE_ME` wird abgelehnt).
4. **MCP user-scope ist beabsichtigt.** Die Bridge ist eine maschinenweite
   Integration; die Registrierung im User-Scope ist dokumentiert und mit einem
   Befehl rückgängig zu machen.
5. **Ownership/Fail-closed bei Adaptern.** pi-Adapter: fremde `zcode`-Einträge
   (ohne Ownership-Marker) sind ein harter Konflikt, kein Stillhalteschreiben.
   Dry-Run garantiert Null-Mutation (auch keine Verzeichnisse).
6. **Locks sind nonce-besessen.** Ein lebender Halter wird nie wegen Alters
   verdrängt; Release löscht nur die eigene Lock.
7. **Quota-Singleflight** liefert Wartenden den vollständigen Snapshot (kein
   Null-Platzhalter), und nach TTL-Ablauf wird neu geholt statt Stale zu
   servieren. **MCP-Body-Limit** gilt für den tatsächlichen Stream (chunked
   ohne Content-Length → 413). **npm-Paket** ist intern private + trägt ein
   versionsgebundenes `prepublishOnly`-Gate.

Automatische Deep-Scans (Mimosa, scanId `scan-2026-09-13T09-40-41.171Z-fb3e4ffbe8be`,
seal `sha256:1c56e52a…d063`) über dieses Kit: 26 Befunde — **23× high, 3× medium**.

## Einordnung

**Alle Befunde betreffen eingebetteten Upstream-/Vendor-Code, keine Kit-eigenen Dateien**
(setup.mjs, proxy/zcode-proxy-manager.mjs, proxy/resolve-zcode-proxy-key.mjs,
proxy/zcode-proxy-autostart.ts, bin/*.cmd sind frei von Befunden):

| Fund-Cluster | Datei | Kontext/Mitigation |
|---|---|---|
| Code-Injection, schwache Kryptografie, Path-Traversal im Captcha-Solver | `zcode-proxy-src/src/proxy/captcha-*.ts` | bewusster Bestandteil des Upstream-Captcha-Solvers (evaluiert Gateway-Challenge-Seiten); lazy geladen — wird nur bei tatsächlichen Gateway-Captchas aktiv; `claim`/`async` sind im Kit-Config deaktiviert |
| SSRDFP/Command-Injection in Claim-/Browser-Öffnungs-Pfaden | `zcode-proxy-src/src/index.ts`, `src/tui/app.ts` | Auto-Claim im Kit-Config aus (`claim.enabled: false`); openBrowser nur im interaktiven Browser-Login |
| Path-Traversal im Docs-Bildgenerator | `zcode-proxy-src/docs/images/android/generate.py` | reines Build-Skript des Upstream, wird vom Kit nicht ausgeführt |
| „Path-Traversal-Eingang" discoverRuntime, readResource-Taint | `mcp/zcode-harness-mcp/src/*` | durch die eigene Security-Testsuite des Bridges abgedeckt (30/30 grün, inkl. `workspace allowlist`/`resolveInsideWorkspace refuses traversal`-Tests); Details: `mcp/zcode-harness-mcp/docs/SECURITY.md` |

## Empfehlungen für Nutzende dieses Kits

1. Nur eigene Maschinen/Ports: Proxy bindet 127.0.0.1, jeder Route (außer /health
   Identity-Payload) erfordert den lokalen Schlüssel.
2. Vor einer breiteren Verteilung den Upstream (TriDefender/zcode-api) auf
   Sicherheitsupdates prüfen und den Pin in MANIFEST.md nachziehen.
3. Den ZCode-Desktop-Bezugsrahmen nicht umgehen: Der Bridge startet genau den
   lokal installierten, vom Benutzer angemeldeten Desktop-Harness.

## Bekannter Scanner-Kontext

Der Pre-Commit-Hook dieser Arbeitsumgebung scannte beim ersten Commit-Versuch das
ZCode-Plattformverzeichnis (`C:\Program Files\ZCode\resources\...document-skills-plugin…`)
und blockierte wegen dortiger Alt-Befunde — außerhalb dieses Kits. Der hier
dokumentierte Scan zielt ausschließlich auf den Kit-Ordner.
