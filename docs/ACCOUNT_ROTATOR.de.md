# Automatischer Account Rotator
[English (original)](ACCOUNT_ROTATOR.md) · **Deutsch**

Der optionale Account Rotator verwaltet autorisierte Logins als getrennte
Konten. Ist er aktiviert, wird ein erfolgreicher neuer Login als weiteres
Konto gespeichert. Bei unterstützten Anfragen kann das Kit ein anderes
gespeichertes Konto versuchen, wenn das ausgewählte Konto nicht fortfahren
kann. Ein erneuter Versuch ist nicht garantiert erfolgreich.

Die Funktion erstellt keine Konten und umgeht keine Provider-Regeln. Verwende
nur Konten, auf die du zugreifen darfst.

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

Die Kontenliste zeigt die IDs für diese Verwaltungsbefehle:

```sh
zcode-kit accounts pause <ID>
zcode-kit accounts resume <ID>
zcode-kit accounts remove <ID>
```

Gibt es kein verfügbares gespeichertes Konto, verwendet das Kit kein
unbeteiligtes oder nicht autorisiertes Konto; die Anfrage kann dann fehlschlagen.
