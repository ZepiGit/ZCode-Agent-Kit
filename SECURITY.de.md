# Sicherheitsrichtlinie
[English (original)](SECURITY.md) · **Deutsch**

Diese Richtlinie beschreibt die vorgesehenen Sicherheitsgrenzen des ZCode
Agent Kit und seiner gebündelten Integrationen. Sie ist keine
Sicherheitszertifizierung.

## Sicherheitsgrenzen

- Proxy und MCP-Bridge sind für einen vertrauenswürdigen lokalen Nutzer gedacht.
  Betreibe sie nur über die Loopback-Schnittstelle und mache sie nicht im
  lokalen Netzwerk oder öffentlichen Internet erreichbar. Der Proxy startet
  nicht auf einer Adresse außerhalb von Loopback und nicht ohne echten
  Schlüssel. Ein Bearer-Key begrenzt den API-Zugriff, bietet aber weder eine
  Sandbox noch eine Isolation mehrerer Nutzer.
- Einige Provider-Challenges können vom Provider bereitgestelltes JavaScript
  ohne Betriebssystem-Sandbox ausführen. Behandle diesen Code als nicht
  vertrauenswürdig. Loopback-Bindung und Bearer-Authentifizierung isolieren ihn
  nicht.
- Der CAPTCHA-Solver läuft in einem eigenen Prozess, den der Proxy startet,
  mit einer Speichergrenze (standardmäßig 300 MB). Eine hängende oder zu große
  Lösung blockiert den Proxy nicht und lässt ihn nicht wachsen, und der
  Solver-Prozess kann beendet und ersetzt werden. Seine Umgebung enthält weder
  das Stopp-Token des Proxys noch Zugangsdaten-Geheimnisse oder den
  API-Schlüssel.
  Das ist keine Betriebssystem-Sandbox und schafft keine Berechtigungsgrenze:
  Der Solver-Prozess läuft als derselbe Nutzer, mit demselben Zugriff auf
  Dateien und das Netzwerk wie der Proxy.
- Lokale Konfigurationen, Zugangsdaten, Schlüssel, Logs und Backups können
  sensible Daten enthalten. Beschränke den Zugriff und entferne Geheimnisse,
  bevor du solche Daten weitergibst. CAPTCHA-Debug-Diagnosen enthalten nur
  Metadaten. Die alte diagnostische Bytecode-VM-Umschreibung (`PE_PATCH`) wurde
  nach reproduzierter Bundle-Beschädigung entfernt, ebenso die sensiblen
  DBT-Argument-Dumps (`CAPTCHA_DUMP_DBT`); aktiviere diese Schalter nicht.
  Solver und Sicherheitsprüfungen bleiben erhalten. Herkunftsangaben je
  Artefakt und Hashes der geladenen Bytes dienen der Diagnose; sie sind weder
  eine Sandbox noch ein Beleg für sicheren Provider-Code. Der statische
  Kompatibilitätshelfer liest nur gespeicherte Skripte; er führt sie nicht aus
  und belegt keinen Ende-zu-Ende-Erfolg der Challenge.
- Der Desktop-Import liest den aktuellen gemeinsamen Login. Ist die
  `credentials.json` von Desktop 0.16.9 vorhanden, ist sie maßgeblich; die alte
  `config.json` wird nur bei ihrem Fehlen verwendet, nicht bei Fehlern der
  Entschlüsselung oder Provider-Prüfung. Der Import verändert die
  Desktop-Zugangsdaten nicht und ermittelt oder erstellt keine API-Schlüssel.
  Ein aktiver `zai`-/`start-plan`-Import erfordert für `start-plan` einen ausdrücklich
  konfigurierten Plan; `coding-plan` verwendet stattdessen den normalen OAuth-Login.
- Der optionale Account Rotator speichert separate, verschlüsselte Kopien von
  Logins, über die du bereits verfügst. Verwende nur Konten, auf die du
  zugreifen darfst. Er erstellt keine Konten, setzt keine Kontingente zurück
  und umgeht keine Provider-Limits.
- Integrationen starten lokale Assistenten mit den Berechtigungen des aktuellen
  Betriebssystem-Nutzers. Prüfe Installer- und Setup-Aktionen, bevor du sie in
  Umgebungen mit strengeren Sicherheitsanforderungen ausführst.

## Proxy stoppen und neu starten

Der Kit-Manager stoppt nur einen Proxy, den er als eigenen nachweisen kann:
Der Prozess auf dem konfigurierten Port beantwortet eine authentifizierte
Gesundheitsprüfung als Proxy dieser Installation, seine PID ist die
aufgezeichnete, und seine Startzeit stimmt mit der beim Start aufgezeichneten
überein. Alles andere wird gemeldet und läuft weiter.

- **Stopp-Anfrage.** `zcode-kit proxy stop`, `proxy restart` und `update`
  senden zuerst `POST /__kit/stop` an den Loopback-Listener des Proxys. Die
  Anfrage braucht den Proxy-Schlüssel und ein Stopp-Token. Das Token wird bei
  jedem Start neu erzeugt und im PID-Eintrag (`logs/proxy.pid`) abgelegt; es
  steht in keiner Konfiguration eines Assistenten. Ein Proxy, den nicht der
  Manager gestartet hat, hat kein Stopp-Token und bietet diese Anfrage nicht an.
- **Auslaufen.** Ein Proxy, der die Anfrage annimmt, beantwortet neue Anfragen
  mit HTTP 503 und einem `Retry-After`-Header, gibt bereits laufenden Anfragen
  bis zu 6 Sekunden zum Abschluss, bricht die dann noch offenen ab, speichert
  die Konto-Metadaten und beendet sich. Seine eigene Frist für all das beträgt
  10 Sekunden.
- **Erzwungener Stopp.** Der Manager beendet den Prozess nur dann selbst, wenn
  er 2 Sekunden nach dieser Frist noch läuft oder wenn der Proxy die Anfrage
  abgelehnt hat oder nicht kennt. Der Besitz wird unmittelbar vor jedem Signal
  erneut geprüft.
- **Proxy, der nicht antwortet.** Ein aufgezeichneter Proxy, der
  Gesundheitsprüfungen nicht mehr beantwortet, wird nur beendet, wenn alles
  Folgende zutrifft: Die Startfrist von 60 Sekunden ist abgelaufen, Startzeit
  und Befehlszeile passen zum Proxy dieser Installation, und drei
  Gesundheitsprüfungen in Folge bleiben ohne Antwort.
- **Automatische Neustarts.** Der Proxy fordert in zwei Fällen einen Neustart
  beim Manager an. Läuft sein Haupt-Thread 45 Sekunden lang nicht, fordert er
  den Neustart an und beendet sich danach selbst. Liegt sein Speicher bei drei
  Messungen im Abstand von 15 Sekunden über 1024 MB, fordert er den Neustart an
  und läuft erst aus, nachdem der Manager ihn angenommen hat; lehnt der Manager
  ab, arbeitet der Proxy weiter. Speicher über 512 MB bei drei Messungen
  schreibt nur eine Warnung ins Log. Der Manager nimmt höchstens 3 solche
  Neustarts innerhalb von 15 Minuten an. Lehnt er einen ab, nachdem sich der
  Proxy selbst beendet hat, läuft bis zum nächsten Start kein Proxy. Die
  Speichergrenzen stehen unter `health.memory` in `proxy/config.yaml`.
- **Startsperre.** Ein Start schreibt eine Sperrdatei (`logs/manager.lock`) und
  entfernt sie, wenn er endet, auch bei einem Abbruch mit Ctrl-C. Eine
  zurückgebliebene Sperre wird nur übernommen, wenn der Manager nachweisen
  kann, dass ihr Inhaber nicht mehr existiert: Der Prozess des Inhabers ist
  beendet, oder seine PID gehört inzwischen einem später gestarteten Prozess.
  Die Sperre eines laufenden Inhabers oder eines Inhabers, der sich nicht
  prüfen lässt, wird nie angetastet. Eine Sperrdatei, die sich nicht lesen
  lässt oder von einem neueren Kit stammt, bleibt liegen und wird mit ihrem
  Pfad gemeldet.
- **Überlast.** Der Proxy hält höchstens 64 MiB an Anfragedaten gleichzeitig
  (`server.admission.maxInFlightMB`). Weitere Anfragen warten, höchstens 64
  gleichzeitig und jede bis zu 15 Sekunden, und werden danach mit HTTP 503 und
  `Retry-After` beantwortet.

Anfragen, die ein Stopp oder Neustart abbricht, werden nicht fortgesetzt; der
Client muss sie erneut senden.

### Grenzen der Prozesswiederherstellung

Unter Windows öffnet die Wiederherstellung einen Betriebssystem-Prozesshandle
und vergleicht dessen Erstellungszeit vor dem Beenden. Fremde, nur über eine PID
zugeordnete Nachkommen werden nicht pauschal beendet. Andere Plattformen prüfen
die gespeicherte Identität unmittelbar vor dem PID-Signal erneut; das bietet
keine kernel-atomare pidfd-Garantie. Instanzen, die ein altes Kit mit relativem
Skriptpfad gestartet hat, können ihren Installationspfad unter Windows und
macOS nicht belegen: Sie bleiben zur expliziten Prüfung durch den Betreiber
unangetastet. Neue Instanzen starten mit absolutem Skriptpfad.

## Logs

Der laufende Proxy schreibt `logs/proxy.log` über einen einzigen Writer, der
vor jedem Schreiben die Dateigröße prüft, die Datei bei 5 MB rotiert und eine
ältere Datei, `proxy.log.1`, behält. Der Manager hängt seine eigenen Zeilen an
dieselbe Datei an und rotiert sie nur während eines Starts, wenn kein Proxy
läuft. Unter macOS und Linux wird das Logs-Verzeichnis mit Modus `0700`
angelegt, die Logdateien und der PID-Eintrag mit Modus `0600`. Unter Windows
haben diese Modi keine Wirkung; dort gelten die Berechtigungen des Ordners.
Der Proxy-Schlüssel, das Stopp-Token und Zeichenfolgen in der Form von
Bearer-Tokens, JWTs oder API-Schlüsseln werden in Logzeilen durch `<redacted>`
ersetzt. Die Schwärzung arbeitet mit Mustern; prüfe ein Log daher, bevor du es
weitergibst.

## Schwachstellen melden

Nutze nach Möglichkeit GitHubs private Funktion zum Melden von Schwachstellen
im Tab **Security** dieses Repositories. Falls sie nicht verfügbar ist,
kontaktiere die Maintainer privat über GitHub. Veröffentliche keine Details,
Zugangsdaten oder sensiblen Reproduktionsdaten in einem öffentlichen Issue.

Nenne die betroffene Release-Version, das Betriebssystem, die Komponente, die
möglichen Auswirkungen und eine möglichst kleine, sichere Reproduktion. Die
Maintainer prüfen den Bericht und stimmen die nächsten Schritte ab; eine
bestimmte Antwortzeit ist nicht zugesichert.
