# ZCode Proxy (Deutsch)

[English](README.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | **Deutsch**

> Übersetzung des englischen Originals; bei Abweichungen gilt das englische README.

Dieses Verzeichnis bettet den **zcode-proxy** aus
[TriDefender/zcode-api](https://github.com/TriDefender/zcode-api) ein — gepinnt
auf v4.6.4, Commit `9a5cebe07c5255faa675075fa37632d4dea733fa` (2026-09-11),
MIT-Lizenz (upstream führt keine LICENSE-Datei). Version, Commit und lokale
Änderungen sind in [`../MANIFEST.md`](../MANIFEST.md) dokumentiert; lokale
Patches liegen in [`../patches/`](../patches/).

Dieses README beschreibt die Komponente, **wie sie im ZCode Agent Kit verwendet
wird**. Das Original-README des Upstreams (Chinesisch) ist als
[README.zh-CN.md](README.zh-CN.md) erhalten; es dokumentiert das eigenständige
Upstream-Projekt (Android-App, Docker-Deployment, Off-Peak-Kanäle,
Trial-Claiming), das das Kit nicht nutzt.

## Rolle im Kit

Der Proxy ist das Modell-Gateway des Kits. Er nimmt OpenAI chat-completions-,
Anthropic messages- und OpenAI Responses-Anfragen auf **`http://127.0.0.1:8457`**
entgegen und leitet sie an das Z.AI-Gateway weiter — mit deinem angemeldeten
ZCode-Desktop-Account (start-plan, dasselbe Kontingent wie ZCode Desktop).

- Adressen/Formate: `POST /v1/chat/completions`, `POST /v1/messages`,
  `POST /v1/responses`, `GET /v1/models`, `GET /health`, `GET /quota`
- Authentifizierung: `Authorization: Bearer <Inhalt von .proxykey>` — der
  Schlüssel wird lokal von setup.mjs erzeugt und verlässt nie deine Maschine
- Lebenszyklus: verwaltet von `node proxy\zcode-proxy-manager.mjs start|stop|restart|status|doctor|logs`
  (nur Loopback-Bind, fail-closed-Stop, Logrotation — siehe Root-README)
- Login-Erneuerung: siehe [README.de.md](../README.de.md) → „Login-Erneuerung"

## Lokale Abweichungen vom Upstream

- **Port 8457** statt dem Upstream-Standalone-Default 8080 (Kit-Konfigurations-
  vorlage), nur Loopback, Bearer-Key Pflicht
- **Trial-Claiming und Off-Peak-Kanäle deaktiviert**: Die mitgelieferte
  Kit-Config nutzt die Upstream-Features `claim` (automatisches Greifen
  limitierter Trial-Pakete) und `/async/*` (Off-Peak) nicht; die zugrunde
  liegenden Defaults sind seit der Audit-Nachbesserung fail-closed (`false`)
- **Vendoring-Ausschlüsse**: `Android-APP/` (209 MB) und `node_modules/` sind
  nicht enthalten; `node_modules/` installiert setup.mjs via `bun install
  --frozen-lockfile`
- Zwei Upstream-Testdateien wurden lokal ergänzt; alle Quell-Änderungen stehen in
  [`../patches/zcode-proxy-local-patches.patch`](../patches/zcode-proxy-local-patches.patch)

## Verfügbare Modelle

Der Proxy listet folgende Modelle auf `/v1/models` (die Liste ist reine
Anzeige — andere Modellnamen werden ganz normal weitergeleitet). Im Kit sind
**glm-5.3** (Text, 1M Kontext) und **glm-5.3-flash** (Text+Bild, 1M Kontext)
die verifizierten Modelle; siehe Root-README.

| Modell | Kontext | Max. Ausgabe |
|---|---|---|
| `glm-4.5-air` | 131K | 96K |
| `glm-4.6` | 200K | 131K |
| `glm-4.6v` (Bild) | 131K | 32K |
| `glm-4.7` | 200K | 131K |
| `glm-5` / `glm-5-turbo` | 200K | 64K |
| `glm-5v-turbo` (Bild) | 200K | 131K |
| `glm-5.1` | 200K | 64K |
| `glm-5.2` | 1M | 128K |
| `glm-5.3` / `glm-5.3-flash` | 1M | 128K |

## Konfiguration & Umgebungsvariablen

Der Proxy liest `config.yaml` (das Kit zeigt per `ZCODE_PROXY_CONFIG` auf
`../proxy/config.yaml`). Umgebungsvariablen haben Vorrang. Die wichtigsten:

| Umgebungsvariable | Standard | Bedeutung |
|---|---|---|
| `ZCODE_PROXY_PORT` | `8080` | Listen-Port (die Kit-Vorlage nutzt 8457) |
| `ZCODE_PROXY_API_KEY` | keine | Schlüssel, den Clients vorlegen müssen (im Kit: Inhalt der `.proxykey`) |
| `ZCODE_PROVIDER` | `zai` | Anbieter `zai` / `bigmodel` |
| `ZCODE_PROXY_CONFIG` | `config.yaml` | Pfad der Konfigurationsdatei |
| `ZCODE_PROXY_CREDENTIAL_SECRET` | maschinenspezifisch | Verschlüsselungs-Seed des Login-Credentials (bei Migration/Docker fixieren) |
| `ZCODE_LOG_FORMAT` | Desktop-Tabelle | `compact` für einzeilige Logs (schmale Terminals) |

## Direkt aus dem Source starten / TUI

Der Proxy direkt aus diesem Verzeichnis gestartet öffnet das interaktive
Terminal-Panel (Upstream-Hauptoberfläche):

```powershell
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts
```

<img src="docs/images/tui-annotated.png" alt="ZCode Proxy Terminal-Panel" width="980" />

Das Panel hat drei Bereiche: **Login & Einstellungen** (Anbieter / Paket /
Login), **Proxy-Dienst** (Start/Stopp, aktuelle Konfiguration) und **Logs**
(eine Zeile pro Request, live). <kbd>s</kbd> startet den Proxy; `Status: running`
heißt betriebsbereit. Buttons sind klickbar, und `bun run zcode-proxy --cli
serve` läuft headless. Kürzel: <kbd>s</kbd> Start/Stopp · <kbd>l</kbd> Login ·
<kbd>L</kbd> Paste-Link-Login · <kbd>o</kbd> Logout · <kbd>p</kbd>/<kbd>t</kbd>
Anbieter/Paket wechseln · <kbd>↑</kbd><kbd>↓</kbd>/<kbd>PgUp</kbd>/<kbd>g</kbd>
Logs scrollen · <kbd>c</kbd> leeren · <kbd>q</kbd> beenden.

Kit-Nutzer brauchen das normalerweise nicht — `proxy/zcode-proxy-manager.mjs`
hält den Proxy headless mit Logrotation am Laufen.

## Vom Kit nicht genutzt

Diese Upstream-Features existieren im Code, sind aber nicht Teil der
mitgelieferten Kit-Konfiguration: die Android-App (vom Vendoring ausgeschlossen),
Docker-Deployment, die `/async/*`-Off-Peak-Kanäle und automatisches
Trial-Claiming (deaktiviert, fail-closed). Für die eigenständige Nutzung siehe
das Upstream-Repository.

## Lizenz

MIT (laut Upstream-README; upstream führt keine LICENSE-Datei — siehe
[`../MANIFEST.md`](../MANIFEST.md)).
