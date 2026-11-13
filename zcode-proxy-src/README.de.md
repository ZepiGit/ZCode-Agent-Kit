# ZCode Proxy
[English (original)](README.md) · **Deutsch** · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

Diese Komponente stellt den lokalen Modell-Proxy bereit, der mit dem ZCode
Agent Kit gebündelt wird. Das Kit übernimmt die Einrichtung; Integrationen
mit Assistenten werden nur mit deiner Zustimmung konfiguriert.

## Mit dem ZCode Agent Kit verwenden

Verwende die Setup- und Modellbefehle aus der [Haupt-README](../README.de.md).
Die gebündelte Quellversion und lokale Änderungen stehen im
[Komponentenmanifest](../MANIFEST.de.md). Das Kit braucht Node.js 24 oder neuer
und startet den Proxy mit Bun; gepinnt ist Bun 1.4.2.

## Import des Desktop-Logins

`zcode-kit auth login zai --import` liest den aktuellen gemeinsamen Desktop-Login.
Die `credentials.json` von Desktop 0.16.9 ist maßgeblich, wenn sie vorhanden ist;
nur bei ihrem Fehlen wird auf die alte `config.json` zurückgegriffen. Ungültige
Zugangsdaten, ein falsches Secret oder ein nicht unterstützter aktiver Provider
führen nicht zu einem stillen Fallback. Der Import eines aktiven
`zai`-/`start-plan`-Logins erfordert für `start-plan` einen ausdrücklich
konfigurierten Plan; `coding-plan` verwendet stattdessen den normalen OAuth-Login. Der Import erstellt
keine Konten, setzt keine Kontingente zurück und ermittelt oder erstellt keine
API-Schlüssel. Siehe [Kontenverwaltung](../docs/ACCOUNT_ROTATOR.de.md).

## CAPTCHA-Solver und Cache

Der Solver läuft in einem eigenen Prozess mit einer Speichergrenze von 300 MB
(`solver.memoryCapMB`) und bearbeitet jeweils ein CAPTCHA-Fenster. Bei 80 % der
Grenze oder nach 100 Lösungen wird er durch einen neuen Prozess ersetzt; siehe
„The solver process“ in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md). Er hält
anfangs ein Token bereit und erweitert den Vorrat nur nach Bedarf auf höchstens
vier Tokens; alte Parallelitätswerte werden auf diese Kapazität begrenzt.
Provider-Ratelimits pausieren weiterhin die Verarbeitung. Wartende Aufträge,
Cache-Invalidierung und Diagnose-Hashes können diese Pause nicht umgehen.

`CAPTCHA_CDN_CACHE_TTL_MS` steuert den CDN-Cache im Speicher und auf der Platte:
Standard sind `86400000` ms (24 Stunden); zulässig sind nur ganze Zahlen von
`0` bis `2147483647`. Ungültige Werte führen zu einem Fehler; `0` deaktiviert
Lesen und Schreiben in beiden Ebenen. `CAPTCHA_CDN_CACHE_DIR` wählt ein isoliertes
Cache-Verzeichnis. Der verwaltete Proxy übergibt beide Umgebungsvariablen an
seinen Kindprozess. Platteneinträge werden als atomarer Datenumschlag geschrieben;
alte Einträge ohne Abrufzeitstempel und unvollständige Einträge werden verworfen.
Die Übernahme in den Speicher erhält das ursprüngliche Abrufalter.

Die Diagnose erfasst die Herkunft atomar je geladenem Artefakt, mit SHA-256-Hashes
der tatsächlich geladenen Bytes pro Fenster; unbekannte Herkunft wird ausdrücklich
angezeigt. `Last-Modified` belegt keine historische Byte-Identität. Zur statischen
Prüfung eines gespeicherten Provider-Skripts dient der installierte Helfer:

```sh
node <installation>/zcode-proxy-src/captcha-compatibility.mjs <saved-script> [retrieval-epoch-ms]
```

Gib die bekannte Abrufzeit, sofern verfügbar, als Epoch-Millisekunden an. Der
Helfer liest nur die Datei und meldet Hashes und Kompatibilitätsmarker: Er führt
das Skript nicht aus und belegt keinen Ende-zu-Ende-CAPTCHA-Erfolg. Die alte
diagnostische Bytecode-VM-Umschreibung (`PE_PATCH`) wurde nach reproduzierter
Bundle-Beschädigung entfernt, ebenso die sensiblen DBT-Argument-Dumps
(`CAPTCHA_DUMP_DBT`). Verwende diese Schalter nicht. Solver, Sicherheitsprüfungen
und die aufrufbare `show`-Alternative bleiben erhalten; Debug-Diagnosen enthalten
nur Metadaten.

## Antworten und Wiederholungen

Der Proxy dekodiert gzip, deflate und Brotli, bevor er übersetzte Streams oder
JSON-Fehlerantworten auswertet. Leere oder nicht dekodierbare Batch-Antworten
werden als `upstream_invalid_response` gemeldet, nicht als erfolgreiche leere
Antworten. Der Proxy ersetzt das Arbeitsverzeichnis des aufrufenden Harness
nicht durch sein eigenes; `ZCODE_IDENTITY_ENV_CWD` bleibt ein ausdrücklicher
Override.

Vorübergehende Fehler vor jeder Ausgabe werden bis zu dreimal auf demselben
Konto wiederholt, mit kleinerem Budget als beim offiziellen Client:

- Wiederholt werden: eine abgelehnte oder zurückgesetzte Verbindung, HTTP 500,
  502, 503, 504, 524, 529 und 429 sowie die Gateway-Fehlercodes, die der
  offizielle Client wiederholt.
- Nie wiederholt werden: Gateway-Entscheidungen (Kontingent, Guthaben, Captcha,
  Modell, Authentifizierung), Anfragefehler und alles nach begonnener Ausgabe.
- Die Wartezeit wächst: etwa 1 s vor der ersten Wiederholung, danach jeweils
  das Doppelte. `ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS` legt die Einheit fest,
  die Hälfte der ersten Wartezeit, in Millisekunden (Standard 500, maximal
  10000). `off` behält nur die Wiederholung nie zustande gekommener
  Verbindungen.
- Das Konto wird vor jeder Wiederholung erneut geprüft. Ein `Retry-After` wird
  bis 15 Sekunden beachtet und darüber an den Client durchgereicht.
- Ein Stream, der vor seinem ersten Inhalts-Event scheitert (ein Fehler-Event
  wie `overloaded_error` oder eine abgebrochene Verbindung), wird ebenso
  wiederholt; der Client erhält die Antwort-Header dann, sobald das erste
  Inhalts-Event da ist (höchstens 15 Sekunden später).
- Beim Start-Plan holt jede Wiederholung nach einer Antwort oder einem
  Verbindungsabbruch ein frisches Captcha-Token.
- Der geordnete Transport für erzwungene Client-Sitzungen wiederholt eine vor
  der Antwort abgebrochene Verbindung wie der Fetch-Pfad (dasselbe Konto; der
  Kontingent-Failover spielt sie nie auf einem anderen Konto erneut ab).

Ein nativer Anthropic-Stream, der ohne `message_stop` endet, erhält einen
abschließenden `event: error`-Frame vom Typ `api_error`. Die Meldung nennt
`upstream_incomplete`, bei fehlgeschlagenem Lesen `upstream_stream_error`. Ein
unvollständiger letzter Frame wird verworfen, damit Clients einen lesbaren
Fehler statt einer stillen Kürzung sehen.

## Stoppen, Neustarten und Überlast

- **Stopp.** Der Kit-Manager bittet den Proxy mit einer authentifizierten
  Anfrage über den Loopback-Listener um den Stopp (`POST /__kit/stop`, der
  Proxy-Schlüssel plus ein bei jedem Start neu erzeugtes Stopp-Token). Der
  Proxy beantwortet neue Anfragen dann mit HTTP 503 und `Retry-After`, gibt
  bereits laufenden Anfragen bis zu 6 Sekunden zum Abschluss, bricht die noch
  offenen ab und beendet sich innerhalb von 10 Sekunden. Der Manager beendet
  den Prozess nur dann selbst, wenn er 2 Sekunden danach noch läuft.
- **Überlast.** Der Proxy hält höchstens 64 MiB an Anfragedaten gleichzeitig.
  Weitere Anfragen warten, höchstens 64 gleichzeitig und jede bis zu 15
  Sekunden, und werden danach mit HTTP 503 und `Retry-After: 2` beantwortet,
  nie mit 429. Ein Proxy ohne laufende Anfragen nimmt immer eine Anfrage an.
  Die Grenze setzt du mit `server.admission.maxInFlightMB` in
  `proxy/config.yaml` (1 bis 4096) oder mit
  `ZCODE_PROXY_ADMISSION_MAX_INFLIGHT_MB`. Offene Antwort-Streams sind nicht
  begrenzt.
- **Speicher.** Der Proxy misst seinen Speicher alle 15 Sekunden. Liegt er bei
  drei Messungen in Folge über 512 MB, schreibt der Proxy eine Warnung ins
  Log. Liegt er bei drei Messungen in Folge über 1024 MB, fordert der Proxy
  beim Kit-Manager einen Neustart an und läuft aus, sobald der Manager ihn
  angenommen hat. Der Manager nimmt höchstens 3 Neustarts innerhalb von 15
  Minuten an; lehnt er ab, arbeitet der Proxy weiter. Die Grenzen sind
  `softLimitMB`, `hardLimitMB`, `samples` und `sampleIntervalSeconds` unter
  `health.memory` in `proxy/config.yaml`.
- **Proxy, der nicht reagiert.** Läuft der Haupt-Thread des Proxys 45 Sekunden
  lang nicht, fordert der Proxy beim Kit-Manager einen Neustart an und beendet
  sich selbst.
- **Ohne den Kit-Manager.** Ein Proxy, den nicht der Kit-Manager gestartet hat,
  bietet die Stopp-Anfrage nicht an, und niemand startet ihn neu. Über der
  Speichergrenze schreibt er nur ins Log und arbeitet weiter; läuft sein
  Haupt-Thread nicht mehr, beendet er sich und bleibt aus.

## Logs

Vom Kit-Manager gestartet, schreibt der Proxy seine Ausgabe über einen
einzigen Writer nach `logs/proxy.log`. Der Writer rotiert die Datei bei 5 MB
und behält eine ältere Datei, `proxy.log.1`. Er ersetzt den Proxy-Schlüssel,
das Stopp-Token und Zeichenfolgen in Token-Form durch `<redacted>`. Unter
macOS und Linux werden die Logdateien mit Modus `0600` und das
Logs-Verzeichnis mit Modus `0700` angelegt. Das Log liest du mit
`zcode-kit proxy logs [n] [--level warn|error] [--grep <text>]`. Ein Proxy,
der ohne den Kit-Manager gestartet wurde, schreibt weiter in sein Terminal.

## Sicherheit

Der Proxy ist für den vertrauenswürdigen lokalen Einsatz gedacht. Betreibe ihn
nur auf dem lokalen Rechner und schütze Login- und Konfigurationsdaten. Einige
Provider-Challenges können vom Provider bereitgestelltes JavaScript ohne
Betriebssystem-Sandbox ausführen; die lokale Bindung isoliert diesen Code
nicht. Mache den Dienst nicht außerhalb deines Rechners erreichbar. Details
stehen in der [Sicherheitsrichtlinie](../SECURITY.de.md).

## Lizenzierung

Für diese gebündelte Komponente können andere Bedingungen als für das Kit
gelten. Prüfe vor einer Weiterverteilung das
[Manifest](../MANIFEST.de.md) und die jeweils geltenden Upstream-Hinweise.
