# Harness-Adapter — wie andere Agent-CLIs den lokalen Proxy nutzen

Der Kern des Kits ist harness-neutral: ein lokaler HTTP-Proxy auf
`http://127.0.0.1:8457` mit zwei Standardformaten:

| Endpoint | Format | Nutzung |
|---|---|---|
| `POST /v1/messages` | Anthropic messages (SSE + batch) | Claude-Code-ähnliche Clients, OMP |
| `POST /v1/chat/completions` | OpenAI chat-completions (SSE + batch) | OpenAI-kompatible Clients |
| `POST /v1/responses` | OpenAI Responses API | Agents-SDK-ähnliche Clients |
| `GET /v1/models` | Modellliste | Discovery |
| `GET /health`, `GET /quota` | Status/Kontingent (Auth nötig) | Diagnose |

Authentifizierung: `Authorization: Bearer <Inhalt von .proxykey>`
Der Schlüssel liegt nur lokal (`<clone>/.proxykey`) und wird von setup.mjs erzeugt.

## Von setup.mjs automatisch eingerichtet

| Harness | Mechanismus | Eingriff in bestehende Config |
|---|---|---|
| OMP (oh-my-pi) | Provider-Block `zcode` in `~/.omp/agent/models.yml` + Autostart-Extension | additiv (Managed-Block, Backups, idempotent); Modellwahl: `omp --model zcode/glm-5.3[-flash] --thinking low\|high\|max` |
| MCP-fähige Harnesses | stdio-Server `zcode-harness` (`node mcp/zcode-harness-mcp/dist/index.js --stdio`) | OMP: Eintrag in `~/.omp/agent/mcp.json`; Claude Code: `claude mcp add ... --scope user`; Codex: im isolierten `generated/codex-home` |

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
  gepaart mit `output_config: {effort: "low"|"high"|"max"}` — Details in EFFORT_MAPPING.md.
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
Proxy-Weg, nicht über den Desktop-Bridge. Details: `mcp/zcode-harness-mcp/README.md`.

## Kontingent & Fehlerbilder

- `GET /quota` (authentifiziert) zeigt die Token-Buckets je Modell.
- Kontingent erschöpft → HTTP 400 `[1005] exceed quota limit` (nicht wiederholbar — warten auf Reset, GLM-5.3: täglich 18:00 Ortszeit).
- `[3007] captcha verify failed` → Gateway-Anti-Absicherung nach intensiven Retry-Versuchen; Pause einlegen.
- `401 start_plan_jwt_invalid` → Desktop-Anmeldung erneuern (README.md → „Login erneuern").
- Codex-Weg: gelegentlicher kosmetischer Fehler `OutputTextDelta without active item` im
  Responses-Handler — das Ergebnis bleibt korrekt (known cosmetic issue).
