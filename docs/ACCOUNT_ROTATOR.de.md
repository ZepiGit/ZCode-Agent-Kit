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

## Erneut anmelden

Ein Login mit derselben OAuth-Nutzer-ID aktualisiert das bestehende Konto
(neue Tokens; Label, Pause und Cooldown bleiben erhalten). Der erneute Import
identischer Anmeldedaten legt ebenfalls keinen zweiten Eintrag an. Provider und
Pläne bleiben voneinander getrennt.

Desktop-Importen kann eine verifizierte Nutzer-ID fehlen. Ein übereinstimmendes
JWT-Subject erkennt dann nur ein mögliches Duplikat, erlaubt aber kein
Überschreiben. Bei geänderten Tokens verweigert das Kit sowohl den stillen
Austausch als auch einen doppelten Eintrag und nennt das bestehende Konto.
Wähle es bei Bedarf ausdrücklich aus:
`zcode-kit auth login zai --import --account ID --replace` (für OAuth ohne
`--import`). Das Subject wird nie in das an den Provider gesendete `userId`
übernommen.

`--account ID` speichert immer unter der gewählten ID, auch wenn der Nutzer
bereits unter einer anderen ID gespeichert ist. Der Login nennt dann die andere
ID, und `zcode-kit accounts doctor` meldet `same_identity_accounts`. Ein solcher
Alias teilt sich das Kontingent des Nutzers und bringt keine zusätzliche
Kapazität, der Rotator behandelt ihn aber weiterhin als eigenen Eintrag (und
versucht ihn eventuell nach dem Original); entferne den überzähligen Eintrag mit
`zcode-kit accounts remove <ID> --yes`.

## Kontostatus

```sh
zcode-kit accounts health
zcode-kit accounts health --json
```

Zeigt je Konto eine Zeile: Urteil, Laufzeitstatus, verbleibend/gesamt je
Kontingentpaket mit Prozent und Reset-Uhrzeit, letzte Nutzung und `*` für das
aktive Konto, danach `usable: N of M` und die Summen des Pools. Der Befehl
braucht den laufenden Proxy; sonst ist jedes Konto `unknown` und der Befehl
nennt `zcode-kit proxy start`. Exit-Code 0 bedeutet: mindestens ein Konto ist
`ok` oder `low`; 1 bedeutet: gerade keines nutzbar oder keine Live-Daten.

Urteile, nach Vorrang geordnet:

| Urteil | Bedeutung |
| --- | --- |
| `paused` | Von dir oder per Richtlinie pausiert. |
| `blocked` | Durch Provider-, Plan- oder Allowlist-Richtlinie ausgeschlossen. |
| `expired` / `invalid` | Login abgelaufen oder mit der aktuellen Konfiguration unbrauchbar. |
| `auth_error` | Der Abrechnungsdienst lehnt den Login ab (401/3012); melde dich neu an. |
| `exhausted` | Im Cooldown nach einem Kontingentfehler, bis zur angezeigten Zeit. Bevor die Abklingzeit beginnt, wiederholt das Kit dieselbe Anmeldung einmal — das Gateway kann die Wiederholung dann aus einem anderen Kontingentpaket bedienen, das noch Guthaben hat (etwa ein Event-Guthaben neben einem leeren Tagespaket). Die Abklingzeit gilt nur, wenn auch die Wiederholung Kontingenterschöpfung meldet. |
| `duplicate` | Gleiche verifizierte OAuth-ID oder identische Anmeldedaten unter den zugelassenen Konten; nur einmal abgefragt und summiert. Ein ausgelesenes JWT-Subject allein unterdrückt keine Abfrage. |
| `no_quota_data` | Der Dienst hat geantwortet, meldet für dieses Konto aber gerade keine Kontingentpakete. Kein bestätigt gesunder Zustand. |
| `empty` | Alle Kontingentpakete sind aufgebraucht. |
| `low` | Mindestens ein Paket hat weniger als 10 % übrig. |
| `ok` | Nutzbar, Kontingent vorhanden. |
| `unknown` | Keine vollständige Live-Antwort für dieses Konto (Proxy aus, eine Kontingentabfrage fehlgeschlagen oder ein Paket mit unvollständigen Zahlen). Zählt nie als nutzbar. |

JSON enthält je Konto `probeSource` (`live`, `duplicate`, `error` oder
`not_probed`). Pausierte oder ausgeschlossene Konten bleiben sichtbar, werden
aber nicht abgefragt; fehlende Billing-Daten bedeuten nicht null Kontingent.

Kosten: Ein Aufruf stellt je eindeutigem Konto bis zu 2 Abrechnungsanfragen
(Guthaben und Vorschau), 15 Sekunden zwischengespeichert. Er sendet keine
Modellanfrage, löst kein Captcha und erneuert keine Tokens.
