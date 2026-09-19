# ZCode Agent Kit

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)

[English](README.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | **Deutsch**

Nutze **deinen eigenen ZCode-Desktop-Account** mit einem Coding-Assistenten deiner Wahl. Das Kit verbindet unterstützte Assistenten mit einem lokalen Proxy. Es installiert die Assistenten nicht, erstellt keine Accounts, kauft kein Kontingent und bietet keinen kostenlosen oder unbegrenzten Zugang.

- **Modell-Proxy:** OpenAI Chat Completions, Responses und Anthropic Messages unter standardmäßig `http://127.0.0.1:8457`.
- **Modelle:** `glm-5.3` (Text) und `glm-5.3-flash` (Text und Bilder). Angegebenes Kontextfenster: 1M Tokens; Denkstufen: `low`, `high`, `max`. Client-Unterstützung und Account-Limits gelten weiterhin.
- **Optionale MCP-Bridge:** macht Funktionen deiner installierten ZCode-Runtime verfügbar. Das ist getrennt von der Modellanbindung; eine laufende Desktop-App garantiert keine Modellaufrufe über die Bridge.

## Unveröffentlichte Audit-Härtung

- Eine laufende Desktop-App garantiert keine eigenständigen MCP-Modellaufrufe; der Provider kann sie unabhängig davon ablehnen. Ist die Konfiguration gespeichert, bleibt ein fehlgeschlagener Setup-Modelltest eine Warnung, kein bestätigter Modellzugang.
- Release-Installer speichern den absoluten Bun-Pfad in `.bun-path`, ohne globalen PATH zu ändern. npm-Zustand liegt außerhalb von `node_modules`: `%LOCALAPPDATA%/zcode-agent-kit/installs/<root-hash>` bzw. `${XDG_STATE_HOME:-$HOME/.local/state}/zcode-agent-kit/installs/<hash>`. `ZCODE_KIT_STATE_DIR` muss absolut und exklusiv für diese Installation sein. Source-/Tarball-Kopien behalten Zustand im Root. Vor dem Ersetzen eines alten npm-Pakets Setup zur Migration ausführen; Originale bleiben erhalten, bereits verlorene Daten nicht.
- MCP-Allowlist gilt auch für Zugriffe über Session-IDs; `yolo` erfordert `--allow-yolo`. Logs sind begrenzt. Clients derselben Bridge teilen eine Vertrauensdomäne.
- Remote CAPTCHA-JavaScript besitzt keine OS-Sandbox und ist außerhalb des Kits standardmäßig gesperrt: ein direkt gestarteter Proxy braucht das ausdrückliche Opt-in `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA=1`. Der kit-verwaltete Dienst setzt dieses Opt-in über `proxyEnv` selbst und löst Captcha-Challenges automatisch (in-prozess, ohne OS-Sandbox); Provider-Sperren werden damit nicht umgangen.
- Start-Plan setzt vendorte ZCode-Systemblöcke vor Clientprompts und entfernt deren `cache_control`. Kit-CWD ist `/workspace`; Plattform, Shell, OS-Version, Locale, Trace- und Gerätedaten können weiterhin upstream gelangen. Keine Kompatibilitäts- oder Zugangsgarantie.
- Main-/Dispatch-Auto-Releases sind gewollt. `ALLOW_PUBLISH` prüft Versionskonsistenz, keine menschliche oder rechtliche Freigabe. Diese Änderungen sind kein Nachweis eines veröffentlichten Releases.

## 1. Voraussetzungen

Du brauchst:

1. **ZCode Desktop**, bereits mit deinem Account angemeldet und mit verfügbarem Modellkontingent.
2. **Node.js ab Version 20** im Terminal-PATH: [nodejs.org](https://nodejs.org/).
3. **Bun dauerhaft im PATH**: [Bun-Installation](https://bun.sh/docs/installation). Getestet wurde **1.4.2**. npm-/Quellcode-Setup installiert mit Bun die Abhängigkeiten, nicht Bun selbst.
4. Deinen separat installierten Assistenten: OMP, pi, Claude Code, Codex, OpenCode, Cline, Kilo Code, Aider, Continue oder Goose.

Öffne ein **neues Terminal** und prüfe:

```sh
node --version
bun --version
```

Diese Befehle funktionieren in PowerShell und POSIX-Shells. Fehlt einer, korrigiere zuerst den PATH. Release-Installer können fehlendes Bun herunterladen und speichern dessen absoluten Pfad in `.bun-path`; das Kit nutzt ihn auch nach einem Neustart, ohne den globalen PATH zu ändern. Vorhandenes Bun wird wiederverwendet, nicht automatisch aktualisiert.

**Windows:** PowerShell ohne Administratorrechte verwenden; `install.sh` nicht in Git Bash oder WSL ausführen. **macOS/Linux:** POSIX-Shell mit `curl`, `tar`, SHA-256-Werkzeug und für Updates `rsync`; Bun-Bootstrap benötigt zusätzlich `unzip`. Die unten genannten Windows-Prüfungen bestätigen keine neuen Linux-/macOS-Live-Client-Tests.

## 2. Einmal installieren – eine Methode wählen

Mische npm- und Release-Installer-Kopien möglichst nicht. Sie können unterschiedliche Proxy-Schlüssel haben, bearbeiten aber dasselbe Assistentenprofil.

### Empfohlen: Installer eines veröffentlichten Releases

Aus **jedem Verzeichnis** ausführbar. Du musst das Repository weder klonen noch in einen Installationsordner wechseln. Die Befehle laden den veröffentlichten Installer herunter und führen ihn aus; prüfe das Skript vorher, falls deine Sicherheitsrichtlinie das verlangt.

**Windows – PowerShell:**

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS/Linux – POSIX-Shell:**

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

Der Installer prüft die SHA-256-Prüfsumme des Archivs, installiert benutzerlokal und startet Setup.

| System | Kit-Verzeichnis | Befehlsverknüpfung |
|---|---|---|
| Windows | `%LOCALAPPDATA%\zcode-agent-kit` | `%LOCALAPPDATA%\Microsoft\WindowsApps\zcode-kit.cmd` |
| macOS/Linux | `$HOME/.local/share/zcode-agent-kit` | `$HOME/.local/bin/zcode-kit` |

`ZCODE_KIT_INSTALL_DIR` hat Vorrang vor `ZCODE_KIT_HOME`, danach gilt der Standard. **Wähle immer einen eigenen absoluten Pfad. Niemals das Home-Verzeichnis, Arbeitsprojekt oder einen Source-Checkout verwenden:** Updates ersetzen/spiegeln dort Dateien. Diese Variablen bestimmen das Installer-Ziel; sie ändern nicht nachträglich das Ziel eines bereits installierten CLI.

Für reproduzierbare Installation setze vor dem Installer `ZCODE_KIT_VERSION` auf einen vorhandenen Release-Tag inklusive `v`. Entferne diese Vorgabe, wenn du wieder „latest“ willst. Die Variable pinnt das Archiv; die obigen Einzeiler beziehen das Installer-Skript weiterhin aus dem neuesten Release.

### Alternative: npm

Node und Bun müssen bereits im PATH sein. Aus jedem Verzeichnis:

```sh
npm install -g zcode-agent-kit
zcode-kit setup
```

Im aktuellen Quellcode zeigt Postinstall nur einen Hinweis; explizites Setup konfiguriert die Integration. Ältere veröffentlichte Pakete können anders reagieren. npm stellt `zcode-kit` und `zcode-agent-kit` bereit. Ein 404 kann bedeuten, dass Paket/Version nicht verfügbar oder nicht zugänglich ist; er beweist keinen lokalen Installationsfehler.

Verwende kein flüchtiges `npx ... setup` als dauerhafte Installation: Generierte Konfigurationen verweisen auf den Paketpfad. Nutze eine stabile globale Installation oder den Release-Installer.

## 3. Die tatsächlich verwendete Installation prüfen

Öffne nach der Installation ein neues Terminal.

**PowerShell:**

```powershell
Get-Command zcode-kit -All
node --version
bun --version
zcode-kit help
```

**macOS/Linux:**

```sh
command -v zcode-kit
node --version
bun --version
zcode-kit help
```

Fehlt `zcode-kit`, ist möglicherweise das oben genannte Verknüpfungsverzeichnis nicht im PATH. Ergänze den richtigen Shell-/Benutzer-PATH und öffne ein neues Terminal. Bei mehreren Kopien verwende den **expliziten Pfad** unten. PowerShell und Git Bash können unter Windows unterschiedliche Kopien auswählen.

### Explizite Pfade – unabhängig vom Arbeitsverzeichnis

Setze einmal je Terminal den Pfad zu deiner **tatsächlich gewählten Installation**. Die Standards gelten für den Release-Installer, **nicht für npm**. Bei eigenem Ziel oder Source-Checkout die Zuweisung anpassen.

**PowerShell:**

```powershell
$KitRoot = Join-Path $env:LOCALAPPDATA 'zcode-agent-kit'
if (-not (Test-Path (Join-Path $KitRoot 'cli/zcode-kit.mjs'))) { throw 'Wrong KitRoot: cli/zcode-kit.mjs not found' }
node (Join-Path $KitRoot 'cli/zcode-kit.mjs') help
```

**macOS/Linux:**

```sh
KIT_ROOT="$HOME/.local/share/zcode-agent-kit"
if [ -f "$KIT_ROOT/cli/zcode-kit.mjs" ]; then
  node "$KIT_ROOT/cli/zcode-kit.mjs" help
else
  printf '%s\n' 'Wrong KIT_ROOT: cli/zcode-kit.mjs not found' >&2
fi
```

Scheitert die Prüfung, zuerst den Pfad korrigieren. Bei npm zeigt `npm root -g` das globale Modulverzeichnis; das Kit liegt im Unterordner `zcode-agent-kit`. Ein Release-Installationspfad ist kein Ersatz für den npm-Pfad.

**`node cli/zcode-kit.mjs` nicht aus einem beliebigen Ordner ausführen.** Relative Pfade beziehen sich auf das aktuelle Verzeichnis, nicht auf das Kit. Globale Verknüpfung oder absoluter Skriptpfad verhindern diesen Fehler.

## 4. Konfigurieren und den ersten Modellaufruf machen

Setup erkennt Assistenten anhand von Programmen/Konfigurationsverzeichnissen und wendet ihre Adapter an. Erkennung beweist weder eine vollständige Installation noch einen funktionierenden Client. Ein Ziel auswählen oder eine Änderung vorab ansehen:

```sh
zcode-kit setup --harness omp
zcode-kit integrate continue --dry-run
```

Vorher gemäß Abschnitt 3 sicherstellen, welche Kopie der Befehl aufruft. Setup kann benutzerweite Assistentenkonfiguration und MCP-Registrierungen ändern. Änderungen werden protokolliert, aber **nicht vollständig atomar** ausgeführt: Scheitert ein späterer Schritt, bleiben frühere Änderungen erhalten; ein Rollback-Befehl wird angezeigt.

Setup im aktuellen Quellstand versucht zusätzlich einen kleinen echten Flash-Aufruf, der Kontingent verbrauchen kann. Mit `ZCODE_KIT_SKIP_SMOKE=1` für diesen Aufruf überspringen; CI/Test überspringt ihn ebenfalls. Ein Smoke-Fehler nimmt Konfiguration nicht automatisch zurück. `doctor --fix` installiert keine fehlenden Abhängigkeiten und ersetzt kein vollständiges Setup.

```sh
zcode-kit status
zcode-kit doctor
zcode-kit auth status
zcode-kit usage --json
```

Ein noch gestoppter Proxy kann diese Prüfungen fehlschlagen lassen. Starte ihn gemäß Abschnitt 6 oder nutze einen automatisch startenden Assistenten. **Health-Check oder Exit-Code allein beweisen keinen Modellzugriff:** `logged_in`, Kontingentdiagnose und echte Modellantwort beachten.

### Assistenten im Arbeitsprojekt starten – nicht im Kit-Verzeichnis

Öffne das Terminal **im Projekt, das der Assistent bearbeiten soll**, oder wechsle mit `Set-Location` (PowerShell) / `cd` (POSIX) dorthin. Kit-Launcher behalten dieses Arbeitsverzeichnis bei.

**OMP direkt starten, nicht mit `zcode-kit run omp`:**

```sh
omp -p --model zcode/glm-5.3-flash "Reply with 52"
omp -p --model zcode/glm-5.3 "Reply with 52"
```

Erwartet: Modellantwort `52`, Exit 0. Die Antwortdauer schwankt; ein Timeout bleibt ein fehlgeschlagener Versuch. Interaktiv:

```sh
omp --model zcode/glm-5.3 --thinking max
```

**Andere Kit-Launcher:** Alles nach `--` geht an den Assistenten.

```sh
zcode-kit run claude-code -- -p "Reply with 52" --model glm-5.3-flash
zcode-kit run codex -- exec "Reply with 52" -m glm-5.3-flash
zcode-kit run aider -- --model openai/glm-5.3-flash
zcode-kit run opencode -- .
```

Modellnamen verwenden auch unter Windows `/`. `run` unterstützt **nur** `claude-code`, `codex`, `aider` und `opencode`. OMP-Erweiterung und diese Launcher starten/prüfen den Proxy; für andere Clients manuell starten.

## 5. Was die Integrationen konfigurieren

| Adapter-ID | Konfiguration / Verwendung |
|---|---|
| `omp` | Provider, Modelle, Autostart-Erweiterung und optionaler MCP-Eintrag; `omp` direkt ausführen. |
| `pi` | `zcode` in `~/.pi/agent/models.json`; Proxy starten, dann `pi --model zcode/glm-5.3`. |
| `claude-code` | Generierte Einstellungen und optionaler Launcher; normale Claude-Modellkonfiguration wird nicht ersetzt. Setup kann MCP im User-Scope registrieren. Fremdmodell-Anbindung ist Community-Kompatibilität. |
| `codex` | Isoliertes `CODEX_HOME` unter `generated/codex-home`; persönliche Codex-Konfiguration/Skills gelten dort nicht automatisch. |
| `opencode` | Zusätzlicher Provider; `zcode-kit run opencode -- .` setzt den prozesslokalen Schlüssel. |
| `aider` | Generierte Umgebung und Launcher; bei zusätzlichen Argumenten `--model openai/glm-5.3-flash` angeben. |
| `continue` | Ändert eine **vorhandene** `~/.continue/config.yaml`; fehlende Datei wird übersprungen. Continue zuerst öffnen/einrichten, erneut integrieren und Modell in der UI auswählen. |
| `goose` | Persistente Custom-Provider-Datei mit Schlüsselhelfer; Proxy starten, dann `goose session --provider zcode`. |
| `cline` | `generated/cline-zcode-values.md`; Werte manuell in der Erweiterungsoberfläche eintragen. |
| `kilo-code` | `generated/kilo-zcode-values.md`; Werte manuell in der Erweiterungsoberfläche eintragen. |

Zehn Adapter sind nicht zehn live geprüfte Clients. Siehe datierte [Support-Matrix](SUPPORT_MATRIX.json) und [Testbericht](TEST_REPORT.md). Cline-/Kilo-Prüfungen bestätigen ein Werteblatt, **nicht** abgeschlossene GUI-Einrichtung. MCP-Registrierung allein ist kein Modellzugriff.

**Continue im Quellstand:** Unterstützt `models: []`, Kommentare und Blocklisten-Einrückungen; Nutzermodelle und Default-Reihenfolge bleiben vorn. Nichtleere Inline-Listen, doppelte Schlüssel und unsichere Formen werden abgelehnt statt geraten. Im verwalteten YAML steht der lokale Proxy-Key als gequoteter Wert; `${ZCODE_PROXY_KEY}` ist keine gültige Continue-Interpolation. Nach Schlüsselrotation neu integrieren oder unterstützte Reparatur nutzen. Ein nativer Continue-Live-Test wird nicht behauptet.

## 6. Proxy ausdrücklich starten, prüfen oder stoppen

Verwende die Root-Variable aus Abschnitt 3; du kannst dabei im Arbeitsprojekt bleiben.

**PowerShell:**

```powershell
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') start
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') status
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') logs 50
```

**macOS/Linux:**

```sh
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" start
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" status
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" logs 50
```

Für weitere Aktionen `status` durch `doctor`, `stop` oder `restart` ersetzen. **Stop/Restart unterbricht verbundene Clients.** Einen Prozess nicht allein wegen Port 8457 beenden. Der Manager verweigert fremde/nicht verifizierbare Prozesse und prüft bei eigenen Prozessen Identität und Startzeit. Alte Ownership-Locks werden nicht automatisch übernommen.

## 7. Fehlerbehebung und begrenzte Selbstheilung

| Symptom | Prüfung / Maßnahme |
|---|---|
| `zcode-kit`, `node` oder `bun` nicht gefunden | PATH in neuem Terminal prüfen; für das Kit absoluten Pfad aus Abschnitt 3 verwenden. npm-/Source-Setup installiert Bun nicht selbst. |
| `Cannot find module .../cli/zcode-kit.mjs` | Falsches Arbeitsverzeichnis bei relativem Pfad oder falscher Installationsroot. Keine Skripte ins Projekt kopieren; absoluten Pfad korrigieren. |
| Setup scheitert an Continue `models: []` | Ältere Releases enthalten den Fix nicht. Passendes Release oder bewusste Source-Installation unten verwenden; keinen zweiten `models`-Schlüssel ergänzen. |
| Unbekannter Befehl / nicht unterstütztes `run`-Ziel | OMP/pi/Goose direkt starten; `run` unterstützt nur die vier genannten Launcher. |
| `foreign`, Port belegt oder HTTP 401 | Zuerst Mehrfachinstallation/Befehlsauflösung prüfen. Keine Keys löschen, Locks übernehmen oder Listener beenden. Gewünschte Kopie diagnostizieren. |
| Auth `3012` / `logged_in: false` | Desktop-Anmeldung prüfen. Aktueller Quellstand versucht begrenzte Erneuerung; bewusster Browser-Login: `zcode-kit auth login`. |
| Balance/Quota `1113` / `3001` | Account/Plan/Kontingent prüfen; lokale Reparatur oder Neustart füllt nichts auf. |
| Setup scheitert nach erfolgreichen Teilschritten | Frühere Änderungen können bleiben; protokollierte Transaktion prüfen und bei Bedarf ausgegebenen Rollback-Befehl nutzen. |
| `doctor --fix` repariert Dateien, liefert aber Exit 1 | Proxy möglicherweise gestoppt oder manueller Schritt offen. Einzelne Checks lesen, nicht nur Zusammenfassung. |
| `models --json` geht bei gestopptem Proxy | Möglich ist Registry-Fallback; `source` prüfen. Modellliste beweist keine Inferenz. |

Verwaltete Reparatur im aktuellen Quellstand:

```sh
zcode-kit doctor --harness continue --json
zcode-kit doctor --fix --harness continue
```

Reparatur wendet ausgewählte Adapter unter Lock erneut an. Offline-Key-Angleichung verlangt eindeutiges Kit-Template und reservierbaren Port; eigene/defekte Configs oder belegte Ports werden abgelehnt. Passende Keys erfordern kein Rewrite. Fehler rollen erfasste Reparatur-Dateiänderungen zurück; normales Setup behält protokollierte Teiländerungen. Credentials, Abhängigkeitsinstallationen und externe Registrierungen fallen nicht vollständig unter Datei-Rollback.

Start-Preflight warnt bei Upstream-Auth-/Kontingentbefunden, damit der Modellaufruf Recovery versuchen kann; lokale Identitäts-/Startfehler blockieren den Wrapper. OMP cached lokale Health 60 Sekunden; nach Fehler eine Minute Cooldown. Kein Kontingent-Polling bei jedem Turn. Begrenztes `logs/heal.log` enthält feste Diagnosekategorien.

Credentials werden pro Request neu geladen. Defekte/teilgeschriebene Daten behalten den letzten gültigen Wert; fehlender Store löscht ihn beim Reload. Bei ausgewählten Fehlern vor Antwortausgabe kann die **vorhandene** Desktop-Anmeldung importiert und einmal mit geändertem effektivem Credential wiederholt werden. Kein Desktop-Rewrite, keine API-Key-Erstellung, Käufe oder Trial-Claims; keine Wiederholung laufender SSE-Streams. Recovery-/Persistenzversuche sind begrenzt und ohne Erfolgsgarantie. Details zu parallelen Schreibern und Prozesslimits stehen in [SECURITY.md](SECURITY.md).

## 8. Aktualisieren, zurückrollen und deinstallieren

**Dieselbe Installationsmethode weiterverwenden:**

- Release-Installer erneut mit demselben eigenen Ziel ausführen; er liefert veröffentlichte Dateien, keine unveröffentlichten Git-Änderungen. Veraltete Versionsvorgabe zuvor entfernen.
- npm: `npm install -g zcode-agent-kit@latest`, danach `zcode-kit setup` aus derselben npm-Kopie.
- Source-Checkout: `node cli/zcode-kit.mjs update` **im Checkout-Root**. Benötigt sauberen Arbeitsbaum, aktualisiert nur per Fast-Forward und wendet Setup erneut an. Kein Release-Versionswähler; Release-/npm-Installationen ohne `.git` lehnen den Befehl ab.

Protokollierte Konfiguration zurückrollen:

```sh
zcode-kit rollback
```

Ohne ID wird die neueste Transaktion gewählt; eine ausgegebene ID wählt eine bestimmte. Spätere Nutzeränderungen werden als Konflikte behandelt. Credentials, Abhängigkeiten und externe Registrierungen werden nicht automatisch vollständig zurückgenommen.

Zum Entfernen zuerst den richtigen Proxy über den **absoluten Managerpfad** aus Abschnitt 6 stoppen. Dann:

```sh
zcode-kit uninstall
```

Uninstall stoppt den Proxy nicht selbst und löscht weder Installationsordner, Dependencies, Logs, `.proxykey`, geteilte Proxy-Credentials noch Desktop-Daten. Entfernt werden protokollierte Integrationen, generierte Dateien und die passende Installer-Verknüpfung. Bei npm **danach** das Paket mit `npm uninstall -g zcode-agent-kit` entfernen. Verbleibende Ordner vor manuellem Löschen prüfen.

`zcode-kit auth logout` erklärt den tatsächlichen Credential-Pfad; `zcode-kit auth logout --yes` löscht ihn, einschließlich eines gesetzten `ZCODE_PROXY_CREDENTIALS_PATH`. Kein Desktop-Logout oder Upstream-Token-Widerruf. Logout nicht als routinemäßige Reparatur verwenden.

## 9. Source-Installation und Entwicklung – fortgeschritten

Nur für bewusst gewünschte aktuelle Quellen statt eines veröffentlichten Releases. Node, Bun und Git vorab installieren. In einen **neuen eigenen Ordner** klonen, nicht ins Arbeitsprojekt. Keinen Release-Installer in den Checkout laufen lassen.

**PowerShell:**

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
if ($LASTEXITCODE -ne 0) { throw 'Clone failed; stop here' }
Set-Location zcode-agent-kit -ErrorAction Stop
$env:ZCODE_KIT_ALLOW_CHECKOUT = '1'
try { node cli/zcode-kit.mjs setup --harness omp }
finally { Remove-Item Env:ZCODE_KIT_ALLOW_CHECKOUT -ErrorAction SilentlyContinue }
```

**macOS/Linux:**

```sh
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit &&
cd zcode-agent-kit &&
ZCODE_KIT_ALLOW_CHECKOUT=1 node cli/zcode-kit.mjs setup --harness omp
```

Nur fortfahren, wenn Klonen und Verzeichniswechsel erfolgreich waren; nach einem Fehler keine Folgezeilen ausführen. `--harness omp` begrenzt das Beispiel bewusst; gewünschten Assistenten oder `auto` wählen. Schreibzugriffe aus Checkouts verlangen explizites Opt-in, damit Profile nicht versehentlich auf eine zweite Kopie zeigen. Checkout-Setup erstellt keinen globalen Shim; später absoluten CLI-Pfad verwenden. Checkout nicht verschieben, weil Integrationen darauf verweisen. Vor Assistentenstart zurück ins **Arbeitsprojekt** wechseln.

Entwicklertests **im Checkout-Root** nach Installation der Proxy-/MCP-Abhängigkeiten ausführen. Sie erzeugen Fixture-/Build-Dateien; bei strikter Isolation eine wegwerfbare Entwicklungskopie verwenden.

```sh
npm run test
npm run test:proxy
npm run test:mcp
```

Datierte Prüfung in [TEST_REPORT.md](TEST_REPORT.md): 150 Kit-Tests bestanden plus ein Live-Opt-in-Skip, 946 Proxy- und 42 MCP-Tests bestanden. Echte isolierte OMP-Aufrufe prüften normalen Start, eigenen Proxy-Absturz und Offline-Key-Reparatur; ein erster Timeout und erfolgreicher Wiederholungslauf bleiben dokumentiert. Keine Garantie für alle Clients/Plattformen/Langzeitfälle oder Inhalt des neuesten veröffentlichten Pakets. Später gefundene CI-Portabilitätsfehler sind getrennt vom lokalen Lauf zu betrachten; aktuellen Badge/Workflow beachten.

Maintainer: Push auf `main`, `v*`-Tag oder Dispatch kann ein Release auslösen. Die Versionswahl prüft npm/Remote-Tags gegen Wiederverwendung fremder Assets; gleichversionige unveröffentlichte Retries sind bedingt. Tests, Paket-/Versionsgates, OIDC und Redistributionsvoraussetzungen bleiben erforderlich. Siehe [Release-Checkliste](docs/RELEASE_CHECKLIST.md); lokale grüne Tests sind keine erfolgreiche npm-Veröffentlichung.

## Sicherheit und weitere Dokumentation

Nur den eigenen autorisierten Account verwenden. `.proxykey`, generierte Settings/Env-Dateien und Profilkonfiguration schützen; Inhalte niemals in Issues kopieren. Der Proxy ist Loopback-only und Bearer-authentifiziert. Gateway-Challenge-Behandlung gehört zur eingebundenen Protokollimplementierung und garantiert keine Anbieterfreigabe oder Verträglichkeit mit künftigen Änderungen. Trial-Claims und Off-Peak-Automatisierung sind standardmäßig deaktiviert. Vor Konfigurationsänderung oder Freigabe von Endpunkten [SECURITY.md](SECURITY.md) lesen.

- [Harness-Details](harnesses/README.md) und [Support-Matrix](SUPPORT_MATRIX.json)
- [Denkstufen-Zuordnung](EFFORT_MAPPING.md)
- [Testbericht](TEST_REPORT.md) und [Implementierungsstand](IMPLEMENTATION_STATUS.md)
- [Eingebundene Komponenten und Lizenzen](MANIFEST.md)
- [Release-Checkliste](docs/RELEASE_CHECKLIST.md)
