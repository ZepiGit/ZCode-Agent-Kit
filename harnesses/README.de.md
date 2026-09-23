# Harness-Adapter — wie andere Agent-CLIs den lokalen Proxy nutzen (Deutsch)
[English (original)](README.md) · **Deutsch** · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

> Übersetzung des englischen Originals; bei Abweichungen gilt das englische README.

Der Kern des Kits ist harness-neutral: ein lokaler HTTP-Proxy auf
`http://127.0.0.1:8457` mit drei Standardformaten:

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

## Von `zcode-kit setup` automatisch eingerichtet (nur für erkannte Harnesses)

`zcode-kit setup --harness auto` erkennt installierte Harnesses und richtet
**nur diese** ein. Bei ausschließlich OMP werden keine Claude-/Codex-
Konfigurationen oder Wrapper-Dateien erzeugt.

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
| MCP-fähige Harnesses | stdio-Server `zcode-harness` (`node mcp/zcode-harness-mcp/dist/index.js --stdio`) | OMP: Eintrag in `~/.omp/agent/mcp.json`; Claude Code: `claude mcp add` (nur wenn erkannt); Codex: im isolierten Home. MCP allein zählt NICHT als Modellintegration |

Pfade unter `generated/` beziehen sich auf den Kit-Zustand: bei Release-/
Quellcode-Installationen im Kit-Verzeichnis, bei npm im separaten Zustandsverzeichnis.

OMP direkt starten, etwa mit `omp --model zcode/glm-5.3-flash --thinking low`, nicht über `zcode-kit run`. **Derzeit unveröffentlichte lokale Korrektur:** Das Setup fixiert natives Node/Bun; die Autostart-Vorprüfung läuft in einem neuen Kindprozess, ohne Kit-Module in OMP zu importieren. Der Kindprozess ist auf 120 Sekunden begrenzt und meldet Fehlerkategorien ohne Geheimnisse. Ursache beheben und nach der sitzungsbezogenen Wartezeit von 60 Sekunden erneut versuchen; dieselbe Sitzung kann sich erholen. Wurde die Laufzeit verschoben, `zcode-kit setup --harness auto` erneut ausführen und die Erweiterung neu laden. Unbekannte Portbesitzer werden nie beendet. Ein gesunder Proxy oder erfolgreiches Setup allein beweist keine vollständig abgeschlossene Modellantwort.

## Opt-in-Wrapper (bestehende Config bleibt unberührt)

| Harness | Wrapper | Was er tut |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | startet bei Bedarf den Proxy und ruft `claude --settings <Kit-Zustand>\generated\claude-zcode-settings.json` auf (CLI-Settings schlagen user settings.json; dein normales `claude` läuft unverändert weiter) |
| Codex CLI | `bin\zcode-codex.cmd` | setzt `CODEX_HOME=<Kit-Zustand>\generated\codex-home` + `ZCODE_PROXY_KEY` und startet den Proxy bei Bedarf; dein normales `codex` und `~/.codex` bleiben unberührt |

## Manuelles Anbinden (jeder OpenAI-/Anthropic-fähige Client)

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

**Derzeit unveröffentlichte lokale Korrektur — Flash:** `glm-5.3-flash` verwendet immer Thinking. Ausdrücklich deaktiviertes Thinking wird auf `low` normalisiert; ausdrücklich gewähltes `high` und `max` bleiben erhalten. Bei Flash beträgt das niedrige Anthropic-Thinking-Budget `8000` Tokens (statt der allgemeinen `2048` oben), mit zusätzlichem Ausgabespielraum für die Antwort; OpenAI verwendet `reasoning_effort: low`. Höherer Thinking-Aufwand allein ist kein Beleg für einen Hänger. Flash-Antworten über den direkten Proxy und Claude Code wurden erfolgreich abgeschlossen; das belegt keine erfolgreiche Prüfung aller Assistenten.

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
- Kontingent erschöpft → HTTP 400 `[1005] exceed quota limit` (nicht wiederholbar — warten, bis der Anbieter wieder Kontingent bereitstellt).
- `[3007] captcha verify failed` → Gateway-Anti-Absicherung nach intensiven Retry-Versuchen; Pause einlegen.
- `401 start_plan_jwt_invalid` → Desktop-Anmeldung prüfen und mit `zcode-kit auth login zai` erneuern. **Derzeit unveröffentlichte lokale Korrektur:** Mit `zcode-kit auth login zai --import` den aktuell aktiven `zai`/`start-plan`-Login aus Desktop 0.16.9 mit ausdrücklich konfiguriertem Plan importieren. Eine vorhandene `credentials.json` ist maßgeblich; bei ungültigen Anmeldedaten erfolgt kein stiller Rückgriff auf `config.json`. Moderne `coding-plan`-Logins verwenden stattdessen normales OAuth; der Import erstellt oder ermittelt keine API-Schlüssel.
- `[1210]` bei Flash → prüfen, ob Thinking aktiviert ist, und `low`, `high` oder `max` wählen, statt Thinking zu deaktivieren. Die derzeit unveröffentlichte lokale Korrektur normalisiert deaktiviertes Thinking auf `low`; siehe den Flash-Hinweis oben.
