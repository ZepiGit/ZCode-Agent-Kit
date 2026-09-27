# ZCode Proxy
[English (original)](README.md) · **Deutsch** · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

Diese Komponente stellt den lokalen Modell-Proxy bereit, der mit dem ZCode
Agent Kit gebündelt wird. Das Kit übernimmt die Einrichtung; Integrationen
mit Assistenten werden nur mit deiner Zustimmung konfiguriert.

## Mit dem ZCode Agent Kit verwenden

Verwende die Setup- und Modellbefehle aus der [Haupt-README](../README.de.md).
Die gebündelte Quellversion und lokale Änderungen stehen im
[Komponentenmanifest](../MANIFEST.de.md).

`zcode-kit auth login zai --import` liest den aktuellen gemeinsamen Desktop-Login.
Die `credentials.json` von Desktop 0.16.9 ist maßgeblich, wenn sie vorhanden ist;
nur bei ihrem Fehlen wird auf die alte `config.json` zurückgegriffen. Ungültige
Zugangsdaten, ein falsches Secret oder ein nicht unterstützter aktiver Provider
führen nicht zu einem stillen Fallback. Der Import eines aktiven
`zai`-/`start-plan`-Logins erfordert für `start-plan` einen ausdrücklich
konfigurierten Plan; `coding-plan` verwendet stattdessen den normalen OAuth-Login. Der Import erstellt
keine Konten, setzt keine Kontingente zurück und ermittelt oder erstellt keine
API-Schlüssel. Siehe [Kontenverwaltung](../docs/ACCOUNT_ROTATOR.de.md).

Der prozessinterne Solver bearbeitet jeweils ein CAPTCHA-Fenster. Er hält
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

Die lokale Korrektur dekodiert gzip, deflate und Brotli vor der Auswertung übersetzter Streams oder JSON-Fehlerantworten. Leere oder nicht dekodierbare Batch-Antworten werden als `upstream_invalid_response` gemeldet, nicht als erfolgreiche leere Antworten. Der Proxy ersetzt das Arbeitsverzeichnis des aufrufenden Harness nicht durch sein eigenes; `ZCODE_IDENTITY_ENV_CWD` bleibt ein ausdrücklicher Override.

Vorübergehende Fehler vor jeder Ausgabe (Verbindung abgelehnt oder zurückgesetzt, HTTP 500/502/503/504/524/529, 429 sowie die Gateway-Fehlercodes, die der offizielle Client wiederholt) werden bis zu dreimal auf demselben Konto mit wachsender Wartezeit wiederholt, mit kleinerem Budget als beim offiziellen Client (Basiswartezeit 1 s, verdoppelt; eingestellt über `ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS`: Basiswartezeit in Millisekunden, Standard 500, maximal 10000; `off` behält nur die Wiederholung nie zustande gekommener Verbindungen); das Konto wird vor jeder Wiederholung erneut geprüft, ein `Retry-After` wird bis 15 Sekunden beachtet und darüber an den Client durchgereicht, und Gateway-Entscheidungen (Kontingent, Guthaben, Captcha, Modell, Authentifizierung), Anfragefehler und alles nach begonnener Ausgabe werden nie wiederholt. Ein Stream, der vor seinem ersten Inhalts-Event scheitert (ein Fehler-Event wie `overloaded_error` oder eine abgebrochene Verbindung), wird ebenso wiederholt; der Client erhält die Antwort-Header dann, sobald das erste Inhalts-Event da ist (höchstens 15 Sekunden später). Beim Start-Plan holt jede Wiederholung nach einer Antwort oder einem Verbindungsabbruch ein frisches Captcha-Token. Der geordnete Transport für erzwungene Client-Sitzungen wiederholt eine vor der Antwort abgebrochene Verbindung wie der Fetch-Pfad (dasselbe Konto; der Kontingent-Failover spielt sie nie auf einem anderen Konto erneut ab). Ein nativer Anthropic-Stream, der ohne `message_stop` endet, erhält einen abschließenden `event: error`-Frame vom Typ `api_error` (die Meldung nennt `upstream_incomplete`, bei fehlgeschlagenem Lesen `upstream_stream_error`); ein unvollständiger letzter Frame wird verworfen, damit Clients einen lesbaren Fehler statt einer stillen Kürzung sehen.

## Sicherheit

Der Proxy ist für den vertrauenswürdigen lokalen Einsatz gedacht. Betreibe ihn
nur auf dem lokalen Rechner und schütze Login- und Konfigurationsdaten. Einige
Provider-Challenges können vom Provider bereitgestelltes JavaScript ohne
Betriebssystem-Sandbox ausführen; die lokale Bindung isoliert diesen Code
nicht. Lies die [Sicherheitsrichtlinie](../SECURITY.de.md) und mache den Dienst
nicht außerhalb deines Rechners erreichbar.

## Lizenzierung

Für diese gebündelte Komponente können andere Bedingungen als für das Kit
gelten. Prüfe vor einer Weiterverteilung das
[Manifest](../MANIFEST.de.md) und die jeweils geltenden Upstream-Hinweise.
