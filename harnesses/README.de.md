# Harness-Adapter — wie andere Agent-CLIs den lokalen Proxy nutzen (Deutsch)

[English](README.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | **Deutsch**

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

Authentifizierung: `Authorization: Bearer <Inhalt von .proxykey>`
Der Schlüssel liegt nur lokal (`<clone>/.proxykey`) und wird von setup.mjs erzeugt.

## Von `zcode-kit setup` automatisch eingerichtet (nur für erkannte Harnesses)

setup.mjs erkennt, welche Harnesses installiert sind, und richtet **nur für
diese** etwas ein. Ein Nutzer mit nur OMP bekommt keinerlei Claude-/Codex-
Artefakte (auch keine generierten Dateien).

| Harness | Mechanismus | Eingriff in bestehende Config |
|---|---|---|
| OMP (oh-my-pi) | Provider-Block `zcode` in `~/.omp/agent/models.yml` + Autostart-Extension | additiv (Managed-Block, transaktional, idempotent); Modellwahl: `omp --model zcode/glm-5.3[-flash] --thinking low\|high\|max` |
| pi | Provider `zcode` in `~/.pi/agent/models.json` (`api: anthropic-messages`, `!node`-Key-Resolver) | additiv (fremde Provider bleiben); Quelle: pi-mono docs/models.md |
| Claude Code | `generated/claude-zcode-settings.json` + `bin/zcode-claude.cmd\|.sh` | `~/.claude` bleibt unberührt (Opt-in pro Aufruf) |
| Codex CLI | isoliertes `generated/codex-home` + `bin/zcode-codex.cmd\|.sh` | `~/.codex` bleibt unberührt; **Unterschied**: eigene Skills/Regeln/MCP gelten im Wrapper nicht |
| OpenCode | Provider `zcode` in `opencode.json` (`@ai-sdk/openai-compatible`, apiKey `{env:ZCODE_PROXY_KEY}`) | additiv; Kommentare in JSONC bleiben erhalten |
| Aider | `generated/aider-zcode.env` + `bin/zcode-aider.cmd\|.sh` (prozesslokal, **kein setx**) | Modell `openai/glm-5.3[-flash]` |
| Continue | Managed-Block in `~/.continue/config.yaml` (schema v1) | vorhandene Modelle/Rollen bleiben |
| Goose | `%APPDATA%/Block/goose/config/custom_providers/zcode.json` | Credential über dokumentierten `auth.command`-Helper (Kit-Key-Resolver, ohne Shell) |
| Cline | `generated/cline-zcode-values.md` — **manual-confirmation-required** | Kit fasst VS-Code-State nie an; Werte einmalig in der UI eintragen |
| Kilo Code | `generated/kilo-zcode-values.md` — **manual-confirmation-required** | Custom-Provider (Anthropic Messages) in der UI; kilo.jsonc schreibt das Kit bewusst nicht |
| MCP-fähige Harnesses | stdio-Server `zcode-harness` (`node mcp/zcode-harness-mcp/dist/index.js --stdio`) | OMP: Eintrag in `~/.omp/agent/mcp.json`; Claude Code: `claude mcp add` (nur wenn erkannt); Codex: im isolierten Home. MCP allein zählt NICHT als Modellintegration |

## Opt-in-Wrapper (bestehende Config bleibt unberührt)

| Harness | Wrapper | Was er tut |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | startet bei Bedarf den Proxy und ruft `claude --settings <clone>\generated\claude-zcode-settings.json` auf (CLI-Settings schlagen user settings.json; dein normales `claude` läuft unverändert weiter) |
| Codex CLI | `bin\zcode-codex.cmd` | setzt `CODEX_HOME=<clone>\generated\codex-home` + `ZCODE_PROXY_KEY` und startet den Proxy bei Bedarf; dein normales `codex` und `~/.codex` bleiben unberührt |

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

## MCP-Clients (generisch)

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["<clone-abs-pfad>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

Der Bridge steuert den **echten installierten ZCode-Desktop** (App-Server-Protokoll:
Sessions, Turns, Tasks). Einschränkungen: der Desktop muss laufen (er löst
Z.AI-Captchas); Reasoning-Level über den Bridge-Katalog sind `low/high/max`;
im Desktop-Plan-Katalog steht GLM-5.3/GLM-5-Turbo — GLM-5.3-Flash läuft über den
Proxy-Weg, nicht über den Desktop-Bridge. Details:
[mcp/zcode-harness-mcp/README.md](../mcp/zcode-harness-mcp/README.md).

## Kontingent & Fehlerbilder

- `GET /quota` (authentifiziert) zeigt die Token-Buckets je Modell.
- Kontingent erschöpft → HTTP 400 `[1005] exceed quota limit` (nicht wiederholbar — warten auf Reset, GLM-5.3: täglich 18:00 Ortszeit).
- `[3007] captcha verify failed` → Gateway-Anti-Absicherung nach intensiven Retry-Versuchen; Pause einlegen.
- `401 start_plan_jwt_invalid` → Desktop-Anmeldung erneuern ([README.de.md](../README.de.md) → „Login-Erneuerung").
- Codex-Weg: gelegentlicher kosmetischer Fehler `OutputTextDelta without active item` im
  Responses-Handler — das Ergebnis bleibt korrekt (known cosmetic issue).
