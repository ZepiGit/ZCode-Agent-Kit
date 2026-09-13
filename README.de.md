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

## Schnellstart

**Windows (PowerShell)** — gepinnter Installer, SHA256-verifiziert, ohne
Adminrechte:

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.ps1 | iex
```

**macOS / Linux**:

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.sh | sh
```

Der Installer lädt das gepinnte Release-Archiv, prüft dessen Prüfsumme,
installiert benutzerlokal (Standard `%LOCALAPPDATA%\zcode-agent-kit` bzw.
`~/.local/share/zcode-agent-kit`, überschreibbar mit `ZCODE_KIT_HOME`),
installiert bun v1.4.2 benutzerlokal, falls es fehlt, und führt das Setup mit
Harness-Erkennung aus.

## Erste Nutzung — in dieser Reihenfolge

1. **Installieren** (Befehle oben). Das Setup erkennt deine Harnesses und
   fasst nur diese an — jede Änderung landet in einer rückrollbaren
   Transaktion.
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
5. **Später**: `zcode-kit update` aktualisiert, `zcode-kit rollback` macht den
   letzten Schritt rückgängig, `zcode-kit uninstall` entfernt alles
   Kit-eigene.

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
zcode-kit doctor [--harness <id>] [--json]    maschinenlesbare Diagnose
zcode-kit status                              Proxy-Status + Kontingent-Snapshot
zcode-kit models [--json] [--show-key]        verfügbare Modelle (vom laufenden Proxy)
zcode-kit usage --json                        Konto-Nutzung/Kontingent (niemals erfundene Werte)
zcode-kit auth status|login|logout            Proxy-Credential-Lebenszyklus (rührt dein Desktop-Login nie an)
zcode-kit update                              Checkout fast-forwarden, Integrationen erneut anwenden
zcode-kit rollback [tx-id]                    neueste (oder benannte) Transaktion zurücknehmen
zcode-kit uninstall                           Kit-Integrationen entfernen; löscht nie geteilte Credentials
```

Jede Schreiboperation ist transaktional: Dateien werden zuerst gehasht und
gesichert; das Rollback ist besitzbewusst — spätere Nutzeränderungen werden als
Konflikt gemeldet, nie überschrieben.

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

`zcode-kit update` lehnt bei geändertem Arbeitsbaum ab, macht nur Fast-Forward
(nie Force) und wendet die Integrationen transaktional erneut an. Der enthaltene
Proxy ist gepinnt (siehe `MANIFEST.md`); lokale Patches liegen in `patches/`.

## Tests

```bat
npm run test          :: Kit-Suite (node --test): Transaktionen, Manager-Safety, Adapter, Regressionen
npm run test:proxy    :: 858 Bun-Tests inkl. Protokoll-Contract-Tests (SSE-Grenzen, Tool-Args, Abbruch, Usage)
npm run test:mcp      :: MCP-Bridge-Suite (36 Tests inkl. HTTP-Auth/Origin-Gates, Allowlist-Escapes)
```

## Dokumente

- `SUPPORT_MATRIX.json` / `.md` — ehrlicher Zustand je Adapter
- `EFFORT_MAPPING.md` / `.json` — wie low/high/max auf Upstream-Parameter abgebildet werden
- `SETUP_REPORT.md`, `TEST_REPORT.md` — Testbelege mit exakten Befehlen
- `IMPLEMENTATION_STATUS.md` — Entscheidungen und offene Punkte
- `harnesses/README.md` — Details je Harness und manuelle Integrations-Snippets
- `MANIFEST.md` — enthaltene Komponenten, Commits, Lizenzen
- `docs/RELEASE_CHECKLIST.md` — vorbereitet vs. ausstehend für Veröffentlichungen
