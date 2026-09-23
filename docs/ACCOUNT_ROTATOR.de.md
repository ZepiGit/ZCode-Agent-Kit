# Automatischer Account Rotator
[English (original)](ACCOUNT_ROTATOR.md) · **Deutsch**

Der optionale Account Rotator verwaltet autorisierte Logins als getrennte
Konten. Ist er aktiviert, wird ein erfolgreicher neuer Login als weiteres
Konto gespeichert. Bei unterstützten Anfragen kann das Kit ein anderes
gespeichertes Konto versuchen, wenn das ausgewählte Konto nicht fortfahren
kann. Ein erneuter Versuch ist nicht garantiert erfolgreich.

Die Funktion erstellt keine Konten, setzt keine Kontingente zurück und umgeht
keine Provider-Regeln. Der Import eines Logins gewährt kein neues Kontingent.
Verwende nur Konten, auf die du zugreifen darfst.

## Aktivieren oder deaktivieren

Die Funktion ist standardmäßig ausgeschaltet. Beim Setup erscheint die Frage:

> Do you want to activate the Account Rotator feature? [y/n]

Mit `y` wird die Funktion aktiviert und bereits verfügbare Logins werden
übernommen. Mit `n` bleibt sie ausgeschaltet. Du kannst sie später aktivieren:

```sh
zcode-kit accounts enable
zcode-kit accounts disable
```

## Konten hinzufügen und verwalten

Melde dich erneut an, um ein weiteres Konto hinzuzufügen. Du kannst auch den
Login importieren, den ZCode Desktop bereits verwendet:

```sh
zcode-kit auth login zai
zcode-kit auth login zai --import
zcode-kit accounts
```

Der Import liest die aktuellen gemeinsamen Desktop-Zugangsdaten, kein neu
erstelltes Konto. Bei Desktop 0.16.9 ist die verschlüsselte `credentials.json`
maßgeblich, wenn sie vorhanden ist. Nur bei ihrem Fehlen ist ein Fallback auf
die ältere `config.json` möglich; beschädigte Daten, ein falsches
Entschlüsselungs-Secret oder ein nicht unterstützter aktiver Provider führen
zu einem Fehler statt zum stillen Import eines älteren Logins. Der Importer
liest den aktuell aktiven `zai`-/`start-plan`-Login und verlangt für `start-plan`
einen ausdrücklich konfigurierten Plan. Verwende für `coding-plan` den oben
gezeigten normalen OAuth-Login: Der rein lesende Desktop-Importer ermittelt
oder erstellt keine API-Schlüssel. Er verändert die gemeinsamen
Desktop-Zugangsdaten nicht.

Die Kontenliste zeigt die IDs für diese Verwaltungsbefehle:

```sh
zcode-kit accounts pause <ID>
zcode-kit accounts resume <ID>
zcode-kit accounts remove <ID>
```

Gibt es kein verfügbares gespeichertes Konto, verwendet das Kit kein
unbeteiligtes oder nicht autorisiertes Konto; die Anfrage kann dann fehlschlagen.
