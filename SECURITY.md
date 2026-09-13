# Security-Hinweise (Stand 2026-09-13)

## Politik-Entscheidungen (nach externem Audit, 2026-09-13)

Ein externes Audit (14 Findings, „ZAK-001" bis „ZAK-014") führte zu diesen
dokumentierten Entscheidungen und Code-Nachbesserungen:

1. **CAPTCHA-Solver bleibt, Verhalten ist dokumentiert.** Der im vendored
   Proxy enthaltene Solver beantwortet Gateway-Challenge-Seiten genau so wie
   der offizielle ZCode-Desktop-Client: automatisch, unsichtbar, ausschließlich
   für den lokal angemeldeten eigenen Account. Diese Challenges sind Teil des
   normalen Client-Protokolls (kein Mensch löst sie jemals) — es wird keine
   Mensch-Verifikations-Sperre umgangen, kein Fremd-Account berührt und kein
   Drittanbieter-Solver benutzt. Wer das nicht akzeptiert, nutzt das Kit nicht.
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
