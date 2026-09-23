# Sicherheitsrichtlinie
[English (original)](SECURITY.md) · **Deutsch**

Diese Richtlinie beschreibt die vorgesehenen Sicherheitsgrenzen des ZCode
Agent Kit und seiner gebündelten Integrationen. Sie ist keine
Sicherheitszertifizierung.

## Sicherheitsgrenzen

- Proxy und MCP-Bridge sind für einen vertrauenswürdigen lokalen Nutzer gedacht.
  Betreibe sie nur über die Loopback-Schnittstelle und mache sie nicht im
  lokalen Netzwerk oder öffentlichen Internet erreichbar. Ein Bearer-Key
  begrenzt den API-Zugriff, bietet aber weder eine Sandbox noch eine
  Isolation mehrerer Nutzer.
- Einige Provider-Challenges können vom Provider bereitgestelltes JavaScript
  ohne Betriebssystem-Sandbox ausführen. Behandle diesen Code als nicht
  vertrauenswürdig. Loopback-Bindung und Bearer-Authentifizierung isolieren ihn
  nicht.
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

## Schwachstellen melden

Nutze nach Möglichkeit GitHubs private Funktion zum Melden von Schwachstellen
im Tab **Security** dieses Repositories. Falls sie nicht verfügbar ist,
kontaktiere die Maintainer privat über GitHub. Veröffentliche keine Details,
Zugangsdaten oder sensiblen Reproduktionsdaten in einem öffentlichen Issue.

Nenne die betroffene Release-Version, das Betriebssystem, die Komponente, die
möglichen Auswirkungen und eine möglichst kleine, sichere Reproduktion. Die
Maintainer prüfen den Bericht und stimmen die nächsten Schritte ab; eine
bestimmte Antwortzeit ist nicht zugesichert.
