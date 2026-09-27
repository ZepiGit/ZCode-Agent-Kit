# Harness-Adapter — wie andere Agent-CLIs den lokalen Proxy nutzen (Deutsch)
[English (original)](README.md) · **Deutsch** · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

> Übersetzung des englischen Originals; bei Abweichungen gilt das englische README.

Der Kern des Kits ist harness-neutral: ein lokaler HTTP-Proxy mit drei Standardformaten. Die Beispiele verwenden den Standardport `8457`; `zcode-kit proxy status` zeigt Port und Verbindungsdaten deiner Installation:

| Endpoint | Format | Nutzung |
|---|---|---|
| `POST /v1/messages` | Anthropic messages (SSE + batch) | Claude-Code-ähnliche Clients, OMP |
| `POST /v1/chat/completions` | OpenAI chat-completions (SSE + batch) | OpenAI-kompatible Clients |
| `POST /v1/responses` | OpenAI Responses API | Agents-SDK-ähnliche Clients |
| `GET /v1/models` | Modellliste | Discovery |
| `GET /health`, `GET /quota` | Status/Kontingent (Auth nötig) | Diagnose |

Authentifizierung: `Authorization: Bearer <Inhalt von .proxykey>`.
`zcode-kit setup` erzeugt den Schlüssel lokal. Bei Release-Installationen und
Quellcode-Checkouts liegt `.proxykey` im Kit-Verzeichnis; bei npm liegt der
Schlüssel im separaten Zustand dieser Installation außerhalb von `node_modules`.

## Einrichtung durch `zcode-kit setup` (erkannte Harnesses, nur mit Zustimmung)

`zcode-kit setup --harness auto` erkennt installierte Harnesses und fragt für jeden ohne gespeicherte Entscheidung: "Configure ZCode as a provider with its supported models in <HARNESS>? [y/n]". Ein `y` richtet diesen Harness ein; `n` überspringt ihn und lässt seine Dateien unberührt, und ohne Terminal wird jeder unentschiedene Harness übersprungen. Strg-C beendet die Fragen (Exit-Code 130); was du bereits mit `y` beantwortet hast, bleibt eingerichtet. Bei ausschließlich OMP werden keine Claude-/Codex-Konfigurationen oder Wrapper-Dateien erzeugt. Entscheidungen werden pro Harness als Datei unter `generated/harness-choices/` gespeichert und gehören zur Setup-Transaktion (ein Rollback entfernt sie wieder); `zcode-kit update` und `zcode-kit doctor --fix` wenden nur zugestimmte Integrationen erneut an (ein `y`, eine ausdrückliche Auswahl oder `zcode-kit integrate <harness>`), und ein gespeichertes `n` gilt, bis `--harness`, `integrate` oder `zcode-kit setup --reask` (fragt im Terminal erneut) es ändern. Eine Integration, die das Kit vor der Frage angelegt hat, wird bei unbeaufsichtigten Läufen aktualisiert, aber nie zur Zustimmung umgedeutet. Für unbeaufsichtigte Läufe wählst du Harnesses mit `--harness omp,codex` oder `ZCODE_KIT_HARNESSES=omp,codex` (`none` überspringt alle erkannten); unbekannte IDs sind Fehler. Die MCP-Bridge des Kits wird nur mit gesonderter Zustimmung registriert: bei ausdrücklicher Auswahl oder nach einem `y`, dem das Setup vor der Frage den MCP-Hinweis vorangestellt hat (`--no-mcp` schaltet es ab); `integrate`, eine Auffrischung oder eine gespeicherte Entscheidung ohne diesen Hinweis registrieren sie nie. Ein fehlgeschlagener Harness stoppt die anderen nicht: Seine eigenen Teiländerungen werden zurückgenommen, die Zusammenfassung führt ihn als fehlgeschlagen, und das Setup endet mit Exit-Code 20 (die Installer fahren mit einer Warnung fort).

| Harness | Mechanismus | Eingriff in bestehende Config |
|---|---|---|
| OMP (oh-my-pi) | Provider-Block `zcode` in `~/.omp/agent/models.yml` + Autostart-Extension | additiv (Managed-Block, transaktional, idempotent); Modellwahl: `omp --model zcode/glm-5.3[-flash] --thinking low\|high\|max` |
| pi | Provider `zcode` in `~/.pi/agent/models.json` (`api: anthropic-messages`, `!node`-Key-Resolver) | additiv (fremde Provider bleiben); Quelle: pi-mono docs/models.md |
| Claude Code | `generated/claude-zcode-settings.json` + `bin/zcode-claude.cmd\|.sh` | `~/.claude` bleibt unberührt (Opt-in pro Aufruf) |
| Codex CLI | isoliertes `generated/codex-home` + `bin/zcode-codex.cmd\|.sh` | `~/.codex` bleibt unberührt; **Unterschied**: eigene Skills/Regeln/MCP gelten im Wrapper nicht |
| OpenCode | Provider `zcode` in `opencode.json` (`@ai-sdk/openai-compatible`, apiKey `{env:ZCODE_PROXY_KEY}`) | additiv; Kommentare in JSONC bleiben erhalten |
| Aider | `generated/aider-zcode.env` + `bin/zcode-aider.cmd\|.sh` (prozesslokal, **kein setx**) | Modell `openai/glm-5.3[-flash]` |
| Continue | Managed-Block in `~/.continue/config.yaml` (schema v1) | vorhandene Modelle/Rollen bleiben |
| Goose | `%APPDATA%/Block/goose/config/custom_providers/zcode.json` (Windows) oder `~/.config/goose/custom_providers/zcode.json` (macOS/Linux) | Credential über dokumentierten `auth.command`-Helper (Kit-Key-Resolver, ohne Shell) |
| Cline | `generated/cline-zcode-values.md` — **manual-confirmation-required** | Kit fasst VS-Code-State nie an; Werte einmalig in der UI eintragen |
| Kilo Code | `generated/kilo-zcode-values.md` — **manual-confirmation-required** | Custom-Provider (Anthropic Messages) in der UI; kilo.jsonc schreibt das Kit bewusst nicht |
| MCP-fähige Harnesses | stdio-Server `zcode-harness` (`node mcp/zcode-harness-mcp/dist/index.js --stdio`) | OMP: Eintrag in `~/.omp/agent/mcp.json`; Claude Code: `claude mcp add` (nur wenn erkannt und zugestimmt); Codex: im isolierten Home. MCP allein zählt NICHT als Modellintegration |

Pfade unter `generated/` beziehen sich auf den Kit-Zustand: bei Release-/
Quellcode-Installationen im Kit-Verzeichnis, bei npm im separaten Zustandsverzeichnis.

OMP direkt starten, etwa mit `omp --model zcode/glm-5.3-flash --thinking low`, nicht über `zcode-kit run`. Das Setup fixiert natives Node/Bun; die Autostart-Vorprüfung läuft in einem neuen Kindprozess, ohne Kit-Module in OMP zu importieren. Der Kindprozess ist auf 120 Sekunden begrenzt und meldet Fehlerkategorien ohne Geheimnisse. Ursache beheben und nach der sitzungsbezogenen Wartezeit von 60 Sekunden erneut versuchen; dieselbe Sitzung kann sich erholen. Wurde die Laufzeit verschoben, `zcode-kit setup --harness auto` erneut ausführen und die Erweiterung neu laden. Unbekannte Portbesitzer werden nie beendet. Ein gesunder Proxy oder erfolgreiches Setup allein beweist keine vollständig abgeschlossene Modellantwort.

## Opt-in-Wrapper (bestehende Config bleibt unberührt)

| Harness | Wrapper | Was er tut |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | startet bei Bedarf den Proxy und ruft `claude --settings <Kit-Zustand>\generated\claude-zcode-settings.json` auf (CLI-Settings schlagen user settings.json; dein normales `claude` läuft unverändert weiter) |
| Codex CLI | `bin\zcode-codex.cmd` | setzt `CODEX_HOME=<Kit-Zustand>\generated\codex-home` + `ZCODE_PROXY_KEY` und startet den Proxy bei Bedarf; dein normales `codex` und `~/.codex` bleiben unberührt |

## Manuelles Anbinden (jeder OpenAI-/Anthropic-fähige Client)

Das ist ein gleichwertiger Einstieg, kein Notbehelf. Der Kit-Proxy muss laufen, und ZCode braucht einen gültigen Login. `zcode-kit proxy start` (auch wenn der Proxy bereits läuft) und `zcode-kit proxy status` geben die aktuellen Basis-URLs, den lokalen Schlüssel und die Modell-IDs aus. Ist der Proxy nicht als laufend verifiziert, sind die Werte als aus der Konfiguration stammend gekennzeichnet, und die Ausgabe sagt `Start the proxy first: zcode-kit proxy start`. Der vollständige Schlüssel erscheint nur in einem interaktiven Terminal; sonst `zcode-kit models --show-key`. Ersetze den Beispielport unten durch den vom Befehl angezeigten Port.

```yaml
# OpenAI-Format
base_url: http://127.0.0.1:8457/v1
api_key: <Inhalt von .proxykey>
model: glm-5.3            # oder glm-5.3-flash
```

```yaml
# Anthropic-Format
base_url: http://127.0.0.1:8457
auth_token: <Inhalt von .proxykey>
model: glm-5.3
```

Reasoning/Thinking:
- **Anthropic-Format**: `thinking: {type: "enabled", budget_tokens: 2048|16384|32768}`
  gepaart mit `output_config: {effort: "low"|"high"|"max"}` — Details in
  [EFFORT_MAPPING.md](../EFFORT_MAPPING.md).
- **OpenAI-Format**: `reasoning_effort: low|high|max` + `thinking: {type: "enabled"}`
  (der Proxy übersetzt in die Anthropic-Felder).

**Flash:** `glm-5.3-flash` verwendet immer Thinking. Ausdrücklich deaktiviertes Thinking wird auf `low` normalisiert; ausdrücklich gewähltes `high` und `max` bleiben erhalten. Bei Flash beträgt das niedrige Anthropic-Thinking-Budget `8000` Tokens (statt der allgemeinen `2048` oben), mit zusätzlichem Ausgabespielraum für die Antwort; OpenAI verwendet `reasoning_effort: low`. Höherer Thinking-Aufwand allein ist kein Beleg für einen Hänger. Flash-Antworten über den direkten Proxy und Claude Code wurden erfolgreich abgeschlossen; das belegt keine erfolgreiche Prüfung aller Assistenten.

Unter Windows aktiviert das isolierte Codex-Profil die Restricted-Token-Sandbox (`windows.sandbox = "unelevated"`); `workspace-write` bleibt auf das Projekt begrenzt und gewährt keinen Vollzugriff. OpenCode Flash bietet `--variant low`, `high` und `max`, standardmäßig `low`. Der native npm-EXE-Wrapper und Brotli-/Deflate-komprimierte Session-Streams werden unterstützt. Text- und Bildanteile von Responses-Tool-Ergebnissen bleiben erhalten; fehlerhafte Events gelten nicht als erfolgreiche Ausgabe.

## MCP-Clients (generisch)

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["<absoluter-kit-installationspfad>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

Die Bridge steuert den **lokal installierten ZCode-Harness** (App-Server-Protokoll:
Sessions, Turns, Tasks). Für interaktive Verifizierung kann Desktop nötig sein;
der Provider kann Modell-Turns dennoch ablehnen. Die Bridge bietet die
Reasoning-Level `low/high/max`. Ihr Live-Modellkatalog kann vom Proxy-Katalog
abweichen; GLM-5.3-Flash wurde über den Proxy geprüft. Ein Eintrag im nativen
Katalog beweist keinen erfolgreichen nativen Modell-Turn; eine erfolgreiche
Proxy-Prüfung belegt keinen Erfolg beim nativen Provider. Details:
[MCP-Bridge](../mcp/zcode-harness-mcp/README.de.md).

## Kontingent & Fehlerbilder

- `GET /quota` (authentifiziert) zeigt die Token-Buckets je Modell.
- Kontingent erschöpft → HTTP 400 `[1005] exceed quota limit`. Der Proxy wiederholt denselben Account nach einem wachsenden Zeitplan (standardmäßig bis ~65s), bevor er auf einen anderen Account wechselt, sofern der Rotator einen hat; tritt der Fehler weiter auf, warte, bis der Anbieter wieder Kontingent bereitstellt.
- `[3007] captcha verify failed` → Gateway-Anti-Absicherung. Der Proxy wiederholt einmal mit einem frisch erzeugten Captcha-Token; schlägt das erneut fehl, lege eine Pause ein.
- Vorübergehende Fehler vor jeder Ausgabe (Verbindung abgelehnt oder zurückgesetzt, HTTP 500/502/503/504/524/529, 429 sowie die Gateway-Fehlercodes, die der offizielle Client wiederholt) werden bis zu 3-mal auf demselben Konto mit wachsender Wartezeit wiederholt; das Budget ist kleiner als beim offiziellen Client (Basiswartezeit 1 s, verdoppelt; `Retry-After` bis 15 Sekunden beachtet), und das Konto wird vor jeder Wiederholung erneut geprüft. Gateway-Entscheidungen (Kontingent, Guthaben, Captcha, Modell, Authentifizierung), Anfragefehler und alles nach begonnener Ausgabe werden nie wiederholt; ein `Retry-After` über 15 Sekunden wird bei 429, 503 und 529 an den Client durchgereicht. Einstellbar über `ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS` (Basiswartezeit in Millisekunden, Standard 500, maximal 10000; `off` behält nur die Wiederholung nie zustande gekommener Verbindungen; proxy start/restart reicht den Wert durch).
- Ein vom Upstream abgebrochener Stream endet mit einer Fehlermeldung statt einer stillen Kürzung: Chat-Streams mit `data: {"error":…}`, Responses-Streams mit `response.failed`, native Anthropic-Streams mit einem `event: error`-Frame vom Typ `api_error`, dessen Meldung die Ursache nennt (`upstream_incomplete` oder `upstream_stream_error`); ein unvollständiger letzter Frame wird verworfen, damit der Fehler-Frame lesbar bleibt. Nach begonnener Ausgabe wird nichts wiederholt; sende den Turn aus dem Harness erneut.
- `401 start_plan_jwt_invalid` → Desktop-Anmeldung prüfen und mit `zcode-kit auth login zai` erneuern. Mit `zcode-kit auth login zai --import` den aktuell aktiven `zai`/`start-plan`-Login aus Desktop 0.16.9 mit ausdrücklich konfiguriertem Plan importieren. Eine vorhandene `credentials.json` ist maßgeblich; bei ungültigen Anmeldedaten erfolgt kein stiller Rückgriff auf `config.json`. Moderne `coding-plan`-Logins verwenden stattdessen normales OAuth; der Import erstellt oder ermittelt keine API-Schlüssel.
- `[1210]` bei Flash → prüfen, ob Thinking aktiviert ist, und `low`, `high` oder `max` wählen, statt Thinking zu deaktivieren. Der Proxy normalisiert deaktiviertes Thinking auf `low`; siehe den Flash-Hinweis oben.
