# Automatischer Account-Rotator

Der Rotator verwaltet mehrere von dir autorisierte ZCode-Konten in einem verschlüsselten Pool. Ein Konto bleibt aktiv, bis der Provider ein ausdrücklich klassifiziertes Kontingent-Signal meldet. Dann wird höchstens ein weiterer, passender Account-Versuch zugelassen. Es gibt kein zufälliges Round-Robin, kein stilles Modellwechseln und keinen Fallback auf nicht freigegebene oder kostenpflichtige Konten.

Die Funktion erstellt keine Konten, kauft kein Kontingent, claimt keine Trials und umgeht keine Provider-Limits. Verwende sie nur mit Konten, deren Nutzung du autorisiert hast.

## Aktivieren und Schlüssel

Der Pool ist standardmäßig ausgeschaltet. In der aktiven Konfiguration:

```yaml
auth:
  accounts:
    enabled: true
    path: "~/.zcode-proxy/accounts.json"
    # Optional: nur diese lokalen IDs verwenden
    # allowedIds: [privat, arbeit]
    # pausedIds: [vps]
    # allowPaid: false
    # allowedOrigins: ["http://localhost:8457"]
```

Alternativ gelten `ZCODE_ACCOUNTS_ENABLED=true` und `ZCODE_PROXY_ACCOUNTS_PATH`. Ein aktivierter leerer, beschädigter oder nicht entschlüsselbarer Pool ist ein Fehlerzustand; der Proxy fällt nicht still auf `credentials.json` zurück.

Für neue Headless- oder CI-Installationen ist ein zufälliger Master-Key der bevorzugte Schlüssel:

```sh
export ZCODE_PROXY_CREDENTIAL_MASTER_KEY="$(openssl rand -base64 32)"
```

Der Wert muss mindestens 32 nicht-leere Zeichen enthalten und darf nicht in YAML, Logs oder Commits stehen. `ZCODE_PROXY_CREDENTIAL_SECRET` bleibt als explizit gesetztes Kompatibilitäts-Secret erhalten (mindestens 16 nicht-weiße Zeichen); gültige Werte werden nicht getrimmt. Ohne Secret nutzt die aktuelle Version weiterhin die historische maschinengebundene Ableitung, damit bestehende Einzelkonto-Installationen lesbar bleiben. Sie ist kein Ersatz für einen OS-Keyring oder einen Secret-Manager. Der Store wird mit AES-GCM, atomarem Schreiben und restriktiven Dateirechten angelegt.

Normale Lesezugriffe schreiben nicht. Eine Legacy-Verschlüsselung wird ausschließlich mit dem ausdrücklichen Migrationsbefehl umgeschrieben:

```sh
zcode-proxy auth accounts migrate
```

Falscher Schlüssel, beschädigte Daten, aktive Locks oder ein Revisionskonflikt führen zu einem redigierten Fehler und lassen den bisherigen Store unverändert. Lock-Recovery prüft Besitzer, PID und Nonce; ein Lock wird niemals nur wegen seines Alters gelöscht.

## Konten einbinden

Im `zcode-proxy-src`-Verzeichnis der Kit-Kopie (oder über den installierten Befehl):

```sh
zcode-proxy auth login zai --account privat
zcode-proxy auth login zai --account arbeit
zcode-proxy auth login bigmodel --account zweitkonto
zcode-proxy auth login zai --import --account desktop-1
zcode-proxy auth login zai --account arbeit --replace
```

Jede ID ist lokal und stabil. `--replace` ist für eine Credential-Ersetzung erforderlich. Ein Login ohne `--account` bleibt der bisherige Einzelkonto-Pfad. Der Desktop-Import ist lesend; er ändert keinen Desktop-Login und erweitert keine Projekt- oder Kostenfreigabe.

## Verwaltung und Status

```sh
zcode-proxy auth accounts                    # offline, redigierte Übersicht
zcode-proxy auth accounts --json
zcode-proxy auth accounts --live --json       # laufender, API-Key-geschützter Proxy
zcode-proxy auth accounts pause arbeit
zcode-proxy auth accounts resume arbeit
zcode-proxy auth accounts remove arbeit --yes
zcode-proxy auth accounts explain --model glm-5.3 --operation inference --json
zcode-proxy auth accounts doctor --json
zcode-proxy auth accounts quota --json
zcode-proxy auth accounts migrate
```

`zcode-kit accounts` und `zcode-kit accounts --json` sind Wrapper für die Offline-Übersicht; `zcode-kit accounts remove ID --yes` entfernt ein Profil. JSON-Ausgaben tragen `schemaVersion`, `source` und `asOf`. Sie enthalten keine Schlüssel, JWTs, Credential-Fingerprints, Prompts oder ungefilterte Provider-Fehler. `doctor` liest standardmäßig nur. Explain verwendet dieselben Provider-, Plan-, Allowlist-, Pause-, Kosten- und Capability-Prüfungen wie die Auswahl, verändert aber keinen aktiven Account, keine Sperre und kein `lastUsedAt`.

Der Live-Status wird erst nach einer Aktualisierung aus dem autoritativen Store erzeugt und zeigt Datenquelle, Aktualität, aktiven Account und Persistenzzustand. `/accounts/status` und `/accounts/quota` benötigen den Proxy-Bearer-Key, akzeptieren nur geschützte Loopback-/konfigurierte Origins und werden nicht durch eine bloße Loopback-Bindung authentifiziert.

## Laufzeit und Rotation

Vor jedem neuen Sendeversuch lädt der laufende Proxy die aktuelle Store-Revision. Hinzufügen, Entfernen, Pause und Credential-Ersetzung wirken daher ohne Neustart; bereits gestartete Requests behalten ihren unveränderlichen Account-/Credential-Kontext und dürfen auslaufen. Vor dem Transport wird dieser Kontext nochmals gegen Provider, Plan, Credential-Revision und Generation geprüft. Ein entferntes oder pausiertes Konto erhält keinen neuen Sendeversuch.

Die Reihenfolge ist stabil zyklisch. Das aktive Profil bleibt aktiv, bis ein explizites Kontingentsignal vorliegt:

| Signal | Wirkung |
|---|---|
| `1005`, `1113`, `3001` in einer strukturierten Provider-Antwort | Account sperren und höchstens einen nächsten passenden Account versuchen |
| gleiche Codes in einer HTTP-200-Fehlerhülle | wie oben |
| zukünftiger `resetAt` | bekannte Sperre wird niemals durch eine ältere/kürzere Information verkürzt |
| kein `resetAt` | begrenztes exponentielles Backoff bis höchstens 15 Minuten |
| allgemeine 401/403/429/5xx, Modell-, Captcha- oder Transportfehler | keine Pool-Rotation |

Ein HTTP-200-SSE-Header bestätigt keinen Modellabschluss. Streams bleiben inkrementell; nach begonnener Ausgabe gibt es kein transparentes Replay. Client-Abbruch beendet Wartequeue, Retry und Rotation. Alle Recovery-Schichten teilen ein Budget von höchstens einem zusätzlichen Account-Versuch und schließen bereits versuchte effektive Identitäten aus. Identische Credentials unter mehreren IDs zählen nicht als mehrere Kontingente.

Für `inference`, `billing`, `quota` und `async` werden unterschiedliche Capability-Anforderungen berücksichtigt. `start-plan` benötigt für Billing/Quota/Async ein JWT. Unbekannte Kosten- oder Bucket-Zuordnungen werden nicht als kostenlos oder summierbar erfunden. Die modellgenaue Provider-Bucket-Zuordnung bleibt providerabhängig und wird nur verwendet, wenn sie bestätigt ist.

## Poolweite Quota

`/quota` fragt im Pool den aktuell ausgewählten Account ab. `/accounts/quota` fragt passende Profile mit begrenzter Parallelität und Timeouts ab. Der Cache ist nach Account, Credential-Revision, Provider, Plan und Billing-Kontext getrennt und verwirft entfernte oder veraltete Profile. Nur Provider-bestätigte, unabhängige Buckets mit gleicher Einheit werden summiert; gemeinsam genutzte, unbekannte oder nicht vergleichbare Werte bleiben pro Account sichtbar. Fehler werden als stabile Codes ausgegeben.

Globale Richtlinien (`allowedIds`, `pausedIds`, `allowPaid`) gelten vor der Auswahl. Projektdateien enthalten keine Credentials und dürfen diese Freigaben nicht erweitern. Projektbezogene Richtlinien mit eigener Prioritätsauflösung sind in dieser Version nicht enthalten; ein erlaubter Pool ohne verfügbares Konto endet eindeutig mit `NO_USABLE_ACCOUNT` bzw. `account_pool_empty`.

## Diagnose und Grenzen

`doctor` meldet Store-, Konfigurations-, Duplikat- und Provider-/Plan-Probleme, ohne Reparaturen auszuführen. Persistenzfehler werden begrenzt wiederholt und als maschinenlesbarer Zustand angezeigt; ein unsicherer Snapshot wird nicht als aktuelle Wahrheit weiterverwendet. Ein ausführliches, dauerhaftes Event-Journal ist noch nicht Bestandteil der Version; Status- und Log-Ausgaben bleiben größenbegrenzt und redigiert.

Wenn `No usable configured account` erscheint, ist der Pool leer, pausiert, abgelaufen, erschöpft oder durch Provider/Plan/Kostenrichtlinie ausgeschlossen. `account store is locked` bedeutet, dass eine Mutation läuft oder ein Besitzer noch lebt; Lockdateien nicht blind löschen. Bei einem nicht entschlüsselbaren Store dieselbe sichere Secret-Konfiguration verwenden oder kontrolliert migrieren. Die automatisierten Tests nutzen ausschließlich synthetische Credentials und kontrollierte Transporte; echte Accounts, kostenpflichtige Aufrufe und Android-Emulatorläufe sind nicht Teil des Testlaufs.
