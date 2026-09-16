# ZCode Agent Kit (Deutsch)

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)
![Release](https://img.shields.io/github/v/release/ZepiGit/ZCode-Agent-Kit)

[English](README.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | **Deutsch**

> Übersetzung des englischen Originals; bei Abweichungen gilt das englische README.

Modellzugriff aus deinem eigenen Agent-Harness über **deinen eigenen
ZCode-Desktop-Account** — kein zweites Abo, keine API-Käufe. Zehn
Harness-Adapter, ein lokaler Proxy, transparentes Rollback.

```
dein Harness (OMP / pi / Claude Code / Codex / OpenCode / Cline / Kilo Code /
             Aider / Continue / Goose / jeder MCP- oder OpenAI-/Anthropic-fähige Client)
        │
        ├─► lokaler zcode-proxy  http://127.0.0.1:8457   (OpenAI + Anthropic + Responses-Formate)
        │         └─► zcode.z.ai  (start-plan, dasselbe Kontingent wie dein ZCode Desktop)
        │
        └─► zcode-harness-mcp (stdio)  ─► dein installierter ZCode Desktop (echte Desktop-Sitzungen)
```

Modelle: **glm-5.3** (Text, 1M Kontext) und **glm-5.3-flash** (Text+Bild, 1M
Kontext), verifizierte Reasoning-Stufen **low / high / max** (Standard max).

> **Arbeitsstand (2026-09-15):** Reparatur-/Recovery- und Postinstall-Änderungen
> beschreiben lokalen Quellcode, kein verifiziertes Release. Abschlussprüfung offen;
> eine Reparatur der bestehenden persönlichen Installation wird nicht behauptet.

## Schnellstart

**Windows (PowerShell)** — Installer lädt das neueste Release, SHA256-verifiziert,
ohne Adminrechte:

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS / Linux**:

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

Die Einzeiler laden den Installer aus dem **neuesten veröffentlichten
Release**; der Installer löst dieses Release automatisch auf (eine Version
pinnen mit `ZCODE_KIT_VERSION`, z. B. `$env:ZCODE_KIT_VERSION = "v0.2.0"`).
Er lädt das Release-Archiv, prüft dessen Prüfsumme, installiert benutzerlokal
(Standard `%LOCALAPPDATA%\zcode-agent-kit` bzw. `~/.local/share/zcode-agent-kit`,
überschreibbar mit `ZCODE_KIT_HOME`), installiert bun v1.4.2 benutzerlokal,
falls es fehlt, und führt das Setup mit Harness-Erkennung aus.

**npm / npx:**

```sh
npm install -g zcode-agent-kit
zcode-kit setup

# Oder ohne globale Installation:
npx --yes zcode-agent-kit setup
```

Das npm-Paket stellt die Befehle `zcode-kit` und `zcode-agent-kit` bereit. Der
Postinstall-Schritt zeigt nur einen Setup-Hinweis; er installiert **keine** Runtime
und ändert keine Harness-Konfiguration. Führe `zcode-kit setup` ausdrücklich aus.
Wiederholtes Setup ist auf Idempotenz ausgelegt. npm benötigt **Node ≥ 20**;
Setup installiert oder prüft die gepinnten bun-Abhängigkeiten.

> Das npm-Artefakt wird pro Release vom Maintainer veröffentlicht. Meldet
> `npm install` einen 404, ist diese Version noch nicht in der npm-Registry —
> nutze die Installer oben oder einen lokalen Build:
> `npm install -g <repo>/pack/dist`.

## Erste Nutzung — in dieser Reihenfolge

1. **Installieren** (Befehle oben). Das Setup erkennt deine Harnesses und
   fasst nur diese an. Erfasste Konfigurationsänderungen sind rückrollbar;
   Credentials und Abhängigkeitsinstallationen nicht (siehe unten).
2. **Einmalig angemeldet sein**: ZCode Desktop muss installiert und
   angemeldet sein; das Setup importiert das Credential automatisch (sonst
   gibt es den exakten einmaligen Login-Befehl aus).
3. **Prüfen**: `node cli\zcode-kit.mjs status` (läuft der Proxy? Kontingent?)
   und `node cli\zcode-kit.mjs doctor` (volle Diagnose).
4. **Nutzen** — siehe *Nutzung je Harness* unten. Der Proxy startet bei
   Bedarf selbst: OMP über seine Extension, die Kit-Wrapper
   (`bin\zcode-claude`, `bin\zcode-codex`, `bin\zcode-aider` bzw.
   `zcode-kit run ...`) stellen ihn vor dem Start sicher. Für alles andere
   (pi, Continue, Goose, direkte API-Clients) einmal selbst starten:
   `node proxy\zcode-proxy-manager.mjs start`
5. **Später**: siehe *Aktualisieren* für deinen Installationstyp.
   `zcode-kit rollback` nimmt erfasste Dateiänderungen der neuesten Transaktion
   zurück; `zcode-kit uninstall` entfernt Integrationen, nicht geteilte Credentials.

**Aus einem Repo-Checkout** (Entwicklung oder manuelle Installation):

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
cd zcode-agent-kit
$env:ZCODE_KIT_ALLOW_CHECKOUT = "1"     # Opt-in: ein Checkout wird nie stillschweigend zum Provider-Root
node setup.mjs                          # oder: node cli\zcode-kit.mjs setup --harness auto
node cli\zcode-kit.mjs doctor
```

Voraussetzungen: **Node ≥ 20** (bun nur beim Repo-Checkout — der Installer
bringt sein eigenes mit) und **ZCode Desktop installiert und angemeldet** (der
Credential-Import liest die bestehende Desktop-Anmeldung; die MCP-Bridge braucht
die laufende Desktop-App für Modellaufrufe). Adminrechte werden nie benötigt.
WSL wird erkannt und abgelehnt — installiere auf dem Windows-Host.

## Die zcode-kit-CLI

```
zcode-kit setup [--harness auto|omp,pi,...]   Bootstrap + erkannte Harnesses integrieren
zcode-kit integrate <harness> --dry-run       exakt anzeigen, was geschrieben würde
zcode-kit integrate <harness>                 einen Adapter anwenden (transaktional)
zcode-kit run <harness> -- <args>             claude-code/codex/aider/opencode mit ZCode starten
zcode-kit doctor [--fix] [--harness <id>] [--json]  Diagnose; optionale Reparatur
zcode-kit status                              Proxy-Status + Kontingent-Snapshot
zcode-kit models [--json] [--show-key]        verfügbare Modelle (vom laufenden Proxy)
zcode-kit usage --json                        Konto-Nutzung/Kontingent (niemals erfundene Werte)
zcode-kit auth status|login|logout            Proxy-Credential-Lebenszyklus (rührt dein Desktop-Login nie an)
zcode-kit update                              Checkout fast-forwarden, Integrationen erneut anwenden
zcode-kit rollback [tx-id]                    neueste (oder benannte) Transaktion zurücknehmen
zcode-kit uninstall                           Kit-Integrationen entfernen; löscht nie geteilte Credentials
```

Erfasste Konfigurationsänderungen erhalten Hash-basierte Backups. Bei abgeschlossenen
Transaktionen meldet Rollback spätere Nutzeränderungen als Konflikte, statt sie zu
überschreiben. `setup` / `integrate` können nach erfolgreichen Teilschritten scheitern:
Sie protokollieren Teiländerungen und geben einen Rollback-Befehl aus, statt das ganze
Setup automatisch zurückzunehmen. Lokale Schlüsselerstellung, Credentials,
Abhängigkeitsinstallation und externe CLI-Aktionen sind **nicht** vollständig
rückrollbar; Registrierungen können den ausgegebenen Undo-Befehl benötigen.

## Wie sich setup verhält

`setup --harness auto` erkennt die installierten Harnesses und **fasst nur die
an** — ein OMP-only-Nutzer bekommt keine Claude/Codex-Artefakte:

1. **bootstrap** — erzeugt den lokalen Proxy-Schlüssel (`.proxykey`, exklusive
   Erstellung) und `proxy/config.yaml` aus der Vorlage, installiert Abhängigkeiten
   mit `bun install --frozen-lockfile` (ein Fehlschlag ist ein harter Fehler) und
   importiert das Credential aus der bestehenden ZCode-Desktop-Anmeldung.
2. **zehn Adapter** (jeweils nur für erkannte oder explizit angefragte
   Harnesses) — siehe `harnesses/README.md` und `SUPPORT_MATRIX.json`.
3. **MCP-Bridge** — registriert die `zcode-harness`-Stdio-Bridge nur bei
   tatsächlich vorhandenen Harnesses. MCP allein zählt nie als Modellintegration
   (Cline/Kilo weisen explizit manual-confirmation-required aus).

Auf einer Maschine mit nur OMP läuft genau ein Adapter (OMP) plus der OMP-MCP-Eintrag —
nichts Claude- oder Codex-bezogenes entsteht.

**Continue-YAML:** Ein vorhandenes `models: []` (auch mit horizontalem Leerraum
und getrenntem Kommentar) wird vor dem Einfügen in eine Blockliste umgewandelt.
Eingerückte und einrückungslose Listen behalten Nutzermodelle zuerst und deren
Default-Reihenfolge; erneute Integration ist idempotent. Nichtleere Inline-Listen,
doppelte `models`-Schlüssel und uneditierbare Formen werden ohne Dateiänderung
verweigert. Der Adapter speichert den JSON-gequoteten **lokalen Proxy-Key** im
verwalteten Abschnitt von `~/.continue/config.yaml`, kein Desktop-Credential, und
gibt ihn nicht aus. Nach Key-Rotation erneut integrieren. `${ZCODE_PROXY_KEY}` war
keine gültige Continue-Secret-Interpolation; es entsteht keine zusätzliche Env-Datei.
Continue fehlt in der Prüfumgebung: **Live-Verifikation blockiert**;
Parser-/Config-Tests sind keine echte Client-Sitzung.

## Nutzung je Harness

**OMP** (additiver Provider; vollständige TUI/CLI-Integration inkl. Denkebenen):

```bash
omp --model zcode/glm-5.3-flash --thinking low -p "hi"
omp --model zcode/glm-5.3 --thinking max
```

**pi** (`~/.pi/agent/models.json`, additiver Provider `zcode`):

```bash
pi --model zcode/glm-5.3
```

**Claude Code** (Opt-in-Wrapper; `~/.claude` bleibt unberührt):

```bat
bin\zcode-claude.cmd -p "hi" --model glm-5.3-flash
```

**Codex CLI** (Opt-in-Wrapper, isoliertes CODEX_HOME):

```bat
bin\zcode-codex.cmd exec "say hi" -m glm-5.3-flash
```

**Aider / OpenCode / Goose** (Launcher setzen nur prozesslokale Umgebungsvariablen):

```bat
node cli\zcode-kit.mjs run aider -- --model openai\glm-5.3-flash
node cli\zcode-kit.mjs run opencode -- .
goose session --provider zcode
```

**Cline / Kilo Code** (GUI-Konfiguration): das Kit schreibt ein vorbereitetes
Werteblatt nach `generated/` und kennzeichnet den Schritt als
`manual-confirmation-required` — VS-Code-Interna werden nie angefasst.

**Andere Clients** (OpenAI / Anthropic / Responses-Formate auf
`http://127.0.0.1:8457`, Bearer-Token = Inhalt von `.proxykey`):
siehe `harnesses/README.md`.

## Diagnose und begrenzte Reparatur (Quellstand; Abschlussprüfung ausstehend)

`zcode-kit doctor` diagnostiziert; `zcode-kit doctor --fix` repariert ausdrücklich
verwaltete Konfiguration. `--harness <id>` begrenzt die Adapterauswahl, `--json`
liefert strukturierte Ergebnisse. Reparatur führt kein allgemeines Setup und keine
Dependency-Installation aus; sie wendet ausgewählte Adapter unter dem Setup-Lock
an. Key-Drift wird nur bei eindeutiger Kit-Template-Config und exklusiv reservierbarem
Port angeglichen. Bei dieser Angleichung werden eigene/defekte Configs oder belegte
Ports verweigert; ein bereits passender Key erfordert keine Config-Änderung.
Checkout-Schreibzugriffe benötigen weiterhin `ZCODE_KIT_ALLOW_CHECKOUT=1`.
Bei Reparaturfehlern werden erfasste Dateiänderungen zurückgerollt — anders als die
Teiländerungen bei Setup. Credentials und externe Wirkungen fallen nicht darunter.

Der gemeinsame Start-Preflight startet/verifiziert sicher den Proxy und prüft das
Kontingent einmal mit Timeout, ohne Polling-/Retry-Schleife. Auth `3012` ist von
Balance/Quota `1113` / `3001` getrennt; Neustarts füllen kein Kontingent auf.
Upstream-Auth-/Balance-Befunde und fehlende Quota-Telemetrie warnen, lassen aber den
gesunden lokalen Proxy nutzbar, damit der Modellpfad begrenzte Credential-Recovery
versuchen kann. Das belegt kein verfügbares Kontingent und erfindet keine Nullwerte;
lokale Identitäts-/Startfehler blockieren weiterhin den Wrapper-Start. Fremde/nicht verifizierbare Listener bleiben unberührt;
alte Ownership-Locks werden nicht übernommen. `logs/heal.log` ist begrenzt und
enthält feste Ursache/Aktion/Ergebnis-Felder, keine Provider-Antworttexte.

OMP cached nach dem Preflight lokale authentifizierte Health-Checks für 60 Sekunden.
Spätere Requests können einen abgestürzten Proxy wieder starten; Fehlstarts haben
eine Minute Cooldown. Gesunde Modell-Turns fragen nicht ständig die Upstream-Quota ab.

Normales Setup versucht außerdem einen minimalen Live-Flash-Aufruf, der Kontingent
verbrauchen kann. `ZCODE_KIT_SKIP_SMOKE=1` deaktiviert ihn; CI/Test überspringt ihn.
Ein fehlgeschlagener Smoke meldet Fehler, nimmt gespeicherte Integrationen aber
nicht zurück. Der Code allein belegt keinen Live-Lauf dieses Arbeitsstands.

## Proxy-Verwaltung

```bat
node proxy\zcode-proxy-manager.mjs status
node proxy\zcode-proxy-manager.mjs start
node proxy\zcode-proxy-manager.mjs stop
node proxy\zcode-proxy-manager.mjs restart
node proxy\zcode-proxy-manager.mjs doctor
node proxy\zcode-proxy-manager.mjs logs 50
```

Sicherheitsmerkmale: bindet nur an 127.0.0.1; authentifizierte Health-/Identity-
Checks; fail-closed-Stop (ein nicht verifizierbarer oder fremder Prozess auf dem
Port wird **nie** getötet; PID-Reuse wird über Prozess-Startzeiten erkannt);
Manager-Start-Lock gegen parallele Starts; graceful-then-forced-Herunterfahren;
Logrotation und begrenzte Log-Lesezugriffe; Trial-Claim- und Off-Peak-Kanäle sind
deaktiviert. `doctor` trennt echte Auth-Validität vom JWT-Alter und prüft nur
vorhandene Komponenten.

## Sicherheits- & Automatisierungs-Policy

Klare Worte, damit du entscheiden kannst, ob dieses Tool etwas für dich ist:

- **CAPTCHA-Behandlung.** Das z.ai-Gateway liefert Challenge-Seiten als Teil
  seines normalen Client-Protokolls — die offizielle ZCode-Desktop-App
  beantwortet sie automatisch und unsichtbar. Der vendored Proxy repliziert
  exakt dieses Verhalten für **deinen eigenen angemeldeten Account**: Er löst
  Gateway-Challenges so wie der offizielle Client. Keine
  Mensch-Verifikations-Sperre wird umgangen (kein Mensch löst diese Challenges
  jemals), kein fremder Account wird angerührt, kein CAPTCHA-Dienst oder
  Fremd-Solver ist im Spiel.
- **Keine Trial-Automatisierung.** Automatisches Trial-Claiming und
  Off-Peak-Scheduling gibt es in keiner mitgelieferten Config, und seit der
  Audit-Nachbesserung sind die zugrundeliegenden Defaults fail-closed
  (`false`): Eine Config, die den claim-Block auslässt oder verstümmelt,
  aktiviert KEIN Claiming. Zum Aktivieren ist ein explizites
  `claim.enabled: true` in der eigenen Config nötig.
- **MCP-Scope.** Die `zcode-harness`-Bridge wird bewusst im **User-Scope**
  registriert: sie ist eine maschinenweite Integration, keine pro Projekt.
  Rückgängig ist das ein Befehl (`claude mcp remove zcode-harness --scope
  user`), und die Bridge beantwortet niemals unauthentifizierte oder
  Nicht-Loopback-Anfragen.
- **Im Code erzwungen, nicht nur per Vorlage** (Audit-Nachbesserung): Der
  Proxy bindet ausschließlich Loopback und verweigert den Dienst ohne echten
  Bearer-Key; Adapter überschreiben keine fremden Provider-Einträge; Setup
  schreibt aus einem Source-Checkout keine Nutzer-Configs.

## Login-Erneuerung

Die Runtime lädt gespeicherte Proxy-Credentials pro Request nach. Ungültige oder
teilgeschriebene Daten ersetzen nicht den letzten gültigen Wert; ein fehlender
Store (Logout) löscht ihn beim Nachladen, ohne laufende Requests abzubrechen oder
Upstream-Tokens zu widerrufen. Explizit injizierte Credentials bleiben standardmäßig isoliert.
Pro Prozess werden höchstens 128 Fehler-Credential/Quellrevision-Paare erfasst;
danach stoppt automatischer Reimport bis zum Neustart. Persistenz prüft den Store
vor dem Ersetzen, hat aber keinen prozessübergreifenden Lock: ein enges Rennen
mit anderen Schreibern bleibt, keine allgemeine atomare Compare-and-swap-Garantie.

Vor der Antwortausgabe können ausgewählte nichtstreamende Auth-/Balance-Fehler
einen Import der vorhandenen Desktop-Anmeldung und genau eine Wiederholung
auslösen — **nur bei geändertem effektivem Credential**. Parallele Requests teilen
die Recovery; Versuche sind pro Fehler-Credential und Desktop-Quellrevision
begrenzt, sodass eine spätere Anmeldung erkannt werden kann. Der erneuerte gültige
Wert wird nur bei unverändertem beobachtetem Store verschlüsselt im Proxy-Store
gespeichert, nicht in Desktop-Dateien. Kein Browser-Login, keine Key-Erstellung,
kein Trial-Claim, keine Endlosschleife. SSE-/In-Stream-Fehler werden nicht wiederholt.
Scheitert Recovery, bleibt der Request fehlerhaft; Berechtigungen und Quota sind
nicht lokal reparierbar.

Bewusste manuelle Erneuerung:

```bash
cd zcode-proxy-src
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai --import
# oder Browser-Login:
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai
```

## Deinstallation / Rollback

```bat
node cli\zcode-kit.mjs rollback      :: neueste Transaktion zurücknehmen (ein Schritt pro Lauf)
node cli\zcode-kit.mjs uninstall     :: alles Kit-eigene zurücknehmen, generated/ entfernen
node proxy\zcode-proxy-manager.mjs stop
```

`uninstall` löscht niemals `~/.zcode-proxy/credentials.json` (mit anderen
Proxy-Tools geteilt) oder dein ZCode-Desktop-Login/Daten. `zcode-kit auth logout`
entfernt nur das gespeicherte Credential des Proxys — und sagt das.

## Aktualisieren

Im Source-Checkout lehnt `zcode-kit update` bei geändertem Arbeitsbaum ab, macht
nur Fast-Forward (nie Force) und wendet Integrationen mit dem oben beschriebenen
Teil-Setup-Verhalten erneut an. Release-/Tarball-Installationen ohne `.git`
verweigern diesen Befehl: stattdessen den Release-Installer erneut ausführen.
Der Proxy ist gepinnt (siehe `MANIFEST.md`); lokale Patches liegen in `patches/`.

### Release-Automatisierung (Maintainer)

`.github/workflows/release.yml` läuft bei Push auf `main`, `v*`-Tags und Dispatch.
Nach Tests nutzt ein Nicht-Tag-Lauf die aktuelle Version nur, wenn sie auf npm
fehlt und ihr Remote-Tag fehlt oder auf exakt denselben HEAD zeigt. Sonst wählt er
die nächste auf npm und bei Remote-Tags freie Patch-Version (maximal 100 Kandidaten)
und pusht Versions-Commit/Tag. Dispatch ist **nur in diesem unveröffentlichten
Absent-Tag/Exact-HEAD-Fall** ein gleichversioniger Retry. Fehlendes npm erlaubt
nicht, alte GitHub-Assets eines anderen Commits wiederzuverwenden. Tag-Läufe
überspringen vorhandene npm-Versionen; Assets werden nicht ersetzt. Registry-Fehler
brechen ab. npm 11.19.1 ist gepinnt; nach Publish wird die exakte Version geprüft,
nicht der heruntergeladene Paketinhalt. Gates/OIDC müssen erfolgreich sein;
lokaler Quellcode belegt keine Veröffentlichung.

## Tests und Evidenz

```sh
npm run test          # Kit-Fixtures: Transaktionen, Manager-Sicherheit, Adapter
npm run test:proxy    # Proxy-Protokoll- und Authentifizierungs-Fixtures
npm run test:mcp      # MCP-Bridge-Suite
```

Baseline vor dieser Reparaturarbeit: **65 Kit / 872 Proxy / 42 MCP Tests**.
Der MCP-`wmic`-Kill-Pfad wurde **nicht ausgeführt**; die Anzahl belegt diesen Pfad
nicht. **Abschlussprüfung ausstehend**; datierte Ergebnisse in `TEST_REPORT.md`.
Quellcodeprüfung, Fixture-/Config-Tests, echte Modellaufrufe und Veröffentlichungen
sind getrennte Evidenz. Diese lokalen Änderungen behaupten weder neue Live-Tests
noch eine Reparatur der persönlichen Installation. Historische Live-Belege gelten
nicht automatisch für diesen Arbeitsbaum.

## Dokumente

- `SUPPORT_MATRIX.json` — ehrlicher Zustand je Adapter
- `EFFORT_MAPPING.md` / `.json` — wie low/high/max auf Upstream-Parameter abgebildet werden
- `SETUP_REPORT.md`, `TEST_REPORT.md` — Testbelege mit exakten Befehlen
- `IMPLEMENTATION_STATUS.md` — Entscheidungen und offene Punkte
- `harnesses/README.md` — Details je Harness und manuelle Integrations-Snippets
- `MANIFEST.md` — enthaltene Komponenten, Commits, Lizenzen
- `docs/RELEASE_CHECKLIST.md` — vorbereitet vs. ausstehend für Veröffentlichungen
