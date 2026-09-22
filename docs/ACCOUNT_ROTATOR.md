# Automatischer Account-Rotator

Der Account-Rotator ist eine optionale Pool-Funktion des lokalen ZCode-Proxys. Er verwendet mehrere von dir autorisierte ZCode-Konten und wechselt bei einem ausdrücklich gemeldeten Verbrauch des kostenlosen Kontingents oder des Builder-/Start-Plan-Kontingents zum nächsten passenden Konto.

Die Funktion erstellt keine Konten, kauft kein Kontingent, claimt keine Trials und umgeht keine Provider-Anmeldung oder Limits. Verwende sie nur mit Konten, die dir gehören oder deren Nutzung du ausdrücklich autorisiert hast.

## Aktivieren

Der Pool ist standardmäßig ausgeschaltet. Ergänze in der **tatsächlich verwendeten** Proxy-Konfiguration unter `auth`:

```yaml
auth:
  accounts:
    enabled: true
    # Optional; Standard: ~/.zcode-proxy/accounts.json
    path: "~/.zcode-proxy/accounts.json"
```

Alternativ kannst du die Werte für den Prozess setzen:

```sh
export ZCODE_ACCOUNTS_ENABLED=true
export ZCODE_PROXY_ACCOUNTS_PATH="$HOME/.zcode-proxy/accounts.json"
```

Unter Windows PowerShell heißen die entsprechenden Befehle `$env:ZCODE_ACCOUNTS_ENABLED = "true"` und `$env:ZCODE_PROXY_ACCOUNTS_PATH = "C:\Users\<Name>\.zcode-proxy\accounts.json"`.

Der Pool wird beim Proxy-Start geladen. Starte den Proxy nach jeder Änderung an `auth.accounts`, nach dem Hinzufügen oder Entfernen eines Kontos und nach einer Änderung von Provider oder Plan neu, zum Beispiel:

```sh
node /absoluter/pfad/zcode-agent-kit/proxy/zcode-proxy-manager.mjs restart
```

Ein aktivierter, aber leerer Pool ist absichtlich ein Fehlerzustand: Der Proxy fällt dann nicht still auf `credentials.json` zurück. Füge zuerst mindestens ein passendes Konto hinzu. Ein beschädigter oder nicht entschlüsselbarer Pool wird ebenfalls nicht als leerer, authentifizierter Pool behandelt.

Die Kontodatei liegt standardmäßig unter `~/.zcode-proxy/accounts.json`, wird verschlüsselt gespeichert und mit Dateirechten `0600` angelegt. Der Schlüssel ist an dieselbe lokale Maschinen-/Secret-Konfiguration wie der bestehende Credential-Store gebunden. Kopiere die Datei nicht unverschlüsselt und teile sie nicht mit anderen.

## Konten hinzufügen

Die Pool-Anmeldung läuft über das Proxy-CLI. Wechsel in das `zcode-proxy-src`-Verzeichnis deiner installierten Kit-Kopie und setze bei Bedarf den Pfad zur aktiven Konfiguration:

```sh
cd /absoluter/pfad/zcode-agent-kit/zcode-proxy-src
export ZCODE_PROXY_CONFIG=/absoluter/pfad/zcode-agent-kit/proxy/config.yaml
```

Danach kannst du wiederholt Konten anmelden. Jede Anmeldung braucht eine stabile lokale ID:

```sh
bun run src/index.ts auth login zai --account privat
bun run src/index.ts auth login zai --account arbeit
bun run src/index.ts auth login bigmodel --account zweitkonto
```

Die Befehle verwenden den normalen OAuth-Ablauf. Für eine bereits in ZCode Desktop vorhandene, lesbare Credential-Konfiguration kannst du den Import ohne erneuten OAuth-Ablauf verwenden:

```sh
bun run src/index.ts auth login zai --import --account desktop-1
```

`--paste` ist nur für den Bigmodel-Auth-Code-Ablauf vorgesehen:

```sh
bun run src/index.ts auth login bigmodel --paste --account vps
```

Eine bereits vorhandene ID wird aus Sicherheitsgründen nicht überschrieben. Verwende dafür ausdrücklich `--replace`:

```sh
bun run src/index.ts auth login zai --account arbeit --replace
```

`zcode-proxy auth login <provider>` ohne `--account` bleibt der bisherige Einzelkonto-Pfad und schreibt in den kompatiblen primären Credential-Store. Auch `zcode-kit auth login` ist weiterhin dieser Legacy-Pfad; für einen benannten Pool-Account verwende das Proxy-CLI wie oben. Der TUI-Login ist bei aktivem Pool gesperrt und verweist ebenfalls auf diesen Befehl, damit kein Login versehentlich den Einzelkonto-Store verändert.

Eine Account-ID beginnt mit einem Buchstaben oder einer Ziffer und darf danach bis zu 63 Zeichen aus Buchstaben, Ziffern, `.`, `_` und `-` enthalten. Die ID ist nur eine lokale Bezeichnung; sie ist kein ZCode-Benutzername.

## Anzeigen und Entfernen

Die Übersicht arbeitet offline. Sie startet keine Modellanfrage und verbraucht kein Kontingent:

```sh
zcode-kit accounts
zcode-kit accounts --json
zcode-kit accounts remove arbeit --yes
```

Direkt über das Proxy-CLI sind dieselben Funktionen verfügbar:

```sh
bun run src/index.ts auth accounts
bun run src/index.ts auth accounts --json
bun run src/index.ts auth accounts remove arbeit --yes
```

Die Ausgabe enthält nur lokale Metadaten: ID, Provider, Plan, einen maskierten Credential-Hinweis und den Zustand. Mögliche Zustände sind `ready`, `active`, `exhausted`, `expired` und `invalid`. API-Keys, Secrets, JWTs, OAuth-Codes, Prompt-Inhalte und Provider-Fehlertexte werden nicht ausgegeben. Ohne `--yes` wird nichts entfernt. Das Entfernen löscht nur das Pool-Profil; der ZCode-Desktop-Login und andere Profile bleiben bestehen.

`/quota` ist davon getrennt: Bei aktiviertem Pool wählt der Proxy für die Abfrage ein passendes Konto und partitioniert den kurzen Cache nach Konto-ID. Die Antwort ist daher eine Momentaufnahme dieses Kontos und keine Summe über den gesamten Pool. Eine `/quota`-Abfrage kann Providerdaten abrufen; die Account-Übersicht tut das nicht.

## Auswahl und Rotation

Für jede Anfrage wählt der Rotator ein passendes Konto nach deterministischer Least-Recently-Used-Reihenfolge. Bei gleichem Nutzungszeitpunkt entscheidet ein stabiler Round-Robin-Zeiger. Konten mit abgelaufenem Credential, falschem Provider, inkompatiblem Plan oder aktiver Sperrfrist werden übersprungen.

Eine Rotation wird nur bei einem expliziten Upstream-Kontingentsignal ausgelöst:

- `1005`: Kontingent erschöpft
- `1113`: Guthaben/Kontingent nicht ausreichend
- `3001`: Konto- oder Balance-Anfrage abgewiesen

Das gilt auch für Fehlerhüllen mit HTTP 200. Der Proxy versucht höchstens einmal mit dem nächsten passenden Konto. Meldet auch dieses Konto eine Erschöpfung, wird es ebenfalls vorübergehend gesperrt und der gemappte Fehler zurückgegeben. Liefert der Provider eine zukünftige Reset-Zeit, wird sie verwendet; fehlt sie, beträgt die Standard-Cooldown-Zeit 60 Sekunden.

401/403, 3012-Authentifizierungsfehler, 429, 5xx, Captcha-, Transport- und Modellfehler rotieren den Account-Pool nicht. Nach einer erfolgreichen Anfrage wird eine vorübergehende Erschöpfungsmarkierung entfernt.

Die Auswahl bleibt für die gesamte Anfrage und den zugehörigen Stream fest. Es gibt keine Wiederholung eines bereits begonnenen SSE- oder sonstigen Mid-Streams. Der Off-Peak-/Async-Bridge-eigene Ticket-Ablauf darf entsprechend seiner Async-Konfiguration ein Ticket neu anfordern, wechselt dabei aber nicht wegen dieses Ticket-Ablaufs das Konto und sendet den begonnenen Modellstream nicht erneut. Die gewählte Credential-Kombination bleibt an diesen Async-Vorgang gebunden.

## Provider und Plan

Der aktive `provider` und `plan` in `config.yaml` begrenzen die Auswahl. Ein `zai`-Profil wird nicht verwendet, wenn der Proxy auf `bigmodel` steht, und umgekehrt. Für `start-plan` benötigt ein Profil ein JWT; für `coding-plan` muss ein gültiger API-Key vorhanden sein. Profile mit inkompatibler Provider-/Plan-Kombination erscheinen als `invalid` und werden übersprungen.

Ändere Provider oder Plan erst in der Konfiguration, richte dafür passende Profile ein und starte den Proxy neu. Die Pool-Datei enthält mehrere Credentials verschlüsselt; Logs, Account-Listen und Statusmeldungen dürfen trotzdem niemals als Credential-Backup verwendet werden.

## Wenn etwas nicht funktioniert

- `No usable configured account`: Der Pool ist aktiviert, aber leer oder alle Profile sind abgelaufen, erschöpft oder inkompatibel. Prüfe `zcode-kit accounts --json`, Provider/Plan und die gespeicherte Reset-Zeit.
- `account store is locked`: Eine andere Pool-Mutation läuft oder ein Lockfile ist übrig geblieben. Prüfe den Prozess und entferne ein Lockfile nicht blind, solange ein anderer Proxy noch arbeitet.
- `account store is not decryptable on this machine`: Verwende dieselbe lokale Secret-/Maschinenkonfiguration oder melde die Profile auf dieser Maschine erneut an.
- Kein Wechsel trotz Fehlermeldung: Prüfe, ob die Antwort wirklich Code `1005`, `1113` oder `3001` enthält. Eine allgemeine 401-, 429- oder Serverfehlermeldung ist absichtlich kein Rotationssignal.
