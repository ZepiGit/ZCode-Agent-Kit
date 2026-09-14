# Adaptadores de Harness — cómo otros CLIs de agentes usan el proxy local (Español)

[English](README.md) | [中文](README.zh-CN.md) | **Español** | [日本語](README.ja.md) | [Deutsch](README.de.md)

> Traducción del original en inglés; ante cualquier discrepancia manda el
> original en inglés.

El núcleo del kit es neutral respecto al harness: un proxy HTTP local en
`http://127.0.0.1:8457` con tres formatos estándar:

| Endpoint | Formato | Uso |
|---|---|---|
| `POST /v1/messages` | Anthropic messages (SSE + batch) | clientes tipo Claude Code, OMP |
| `POST /v1/chat/completions` | OpenAI chat-completions (SSE + batch) | clientes compatibles con OpenAI |
| `POST /v1/responses` | OpenAI Responses API | clientes tipo Agents SDK |
| `GET /v1/models` | lista de modelos | descubrimiento |
| `GET /health`, `GET /quota` | estado/cuota (requiere auth) | diagnóstico |

Autenticación: `Authorization: Bearer <contenido de .proxykey>`
La clave vive solo localmente (`<clone>/.proxykey`) y la genera setup.mjs.

## Configurado automáticamente por `zcode-kit setup` (solo para harnesses detectados)

setup.mjs detecta qué harnesses están instalados y configura **solo esos**.
Un usuario con solo OMP no recibe ningún artefacto de Claude/Codex (tampoco
archivos generados).

| Harness | Mecanismo | Impacto en la config existente |
|---|---|---|
| OMP (oh-my-pi) | bloque de provider `zcode` en `~/.omp/agent/models.yml` + extensión de autoarranque | aditivo (bloque gestionado, transaccional, idempotente); elección de modelo: `omp --model zcode/glm-5.3[-flash] --thinking low\|high\|max` |
| pi | provider `zcode` en `~/.pi/agent/models.json` (`api: anthropic-messages`, resolver de clave `!node`) | aditivo (los demás providers se quedan); fuente: pi-mono docs/models.md |
| Claude Code | `generated/claude-zcode-settings.json` + `bin/zcode-claude.cmd\|.sh` | `~/.claude` queda intacto (opt-in por invocación) |
| Codex CLI | `generated/codex-home` aislado + `bin/zcode-codex.cmd\|.sh` | `~/.codex` queda intacto; **diferencia**: tus propias skills/reglas/MCP no aplican dentro del wrapper |
| OpenCode | provider `zcode` en `opencode.json` (`@ai-sdk/openai-compatible`, apiKey `{env:ZCODE_PROXY_KEY}`) | aditivo; los comentarios JSONC se conservan |
| Aider | `generated/aider-zcode.env` + `bin/zcode-aider.cmd\|.sh` (local al proceso, **sin setx**) | modelo `openai/glm-5.3[-flash]` |
| Continue | bloque gestionado en `~/.continue/config.yaml` (schema v1) | los modelos/roles existentes se quedan |
| Goose | `%APPDATA%/Block/goose/config/custom_providers/zcode.json` | credencial vía el helper documentado `auth.command` (resolver de clave del kit, sin shell) |
| Cline | `generated/cline-zcode-values.md` — **manual-confirmation-required** | el kit nunca toca el estado de VS Code; introduce los valores una vez en la UI |
| Kilo Code | `generated/kilo-zcode-values.md` — **manual-confirmation-required** | provider personalizado (Anthropic messages) en la UI; el kit deliberadamente no escribe kilo.jsonc |
| Harnesses con MCP | servidor stdio `zcode-harness` (`node mcp/zcode-harness-mcp/dist/index.js --stdio`) | OMP: entrada en `~/.omp/agent/mcp.json`; Claude Code: `claude mcp add` (solo si se detecta); Codex: dentro del home aislado. MCP por sí solo NO cuenta como integración de modelo |

## Wrappers opt-in (la config existente queda intacta)

| Harness | Wrapper | Qué hace |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | arranca el proxy bajo demanda y llama a `claude --settings <clone>\generated\claude-zcode-settings.json` (los settings del CLI prevalecen sobre settings.json; tu `claude` normal sigue igual) |
| Codex CLI | `bin\zcode-codex.cmd` | fija `CODEX_HOME=<clone>\generated\codex-home` + `ZCODE_PROXY_KEY` y arranca el proxy bajo demanda; tu `codex` normal y `~/.codex` quedan intactos |

## Conexión manual (cualquier cliente compatible OpenAI/Anthropic)

```yaml
# Formato OpenAI
base_url: http://127.0.0.1:8457/v1
api_key: <contenido de .proxykey>
model: glm-5.3            # o glm-5.3-flash
```

```yaml
# Formato Anthropic
base_url: http://127.0.0.1:8457
auth_token: <contenido de .proxykey>
model: glm-5.3
```

Razonamiento/thinking:
- **Formato Anthropic**: `thinking: {type: "enabled", budget_tokens: 2048|16384|32768}`
  junto con `output_config: {effort: "low"|"high"|"max"}` — detalles en
  [EFFORT_MAPPING.md](../EFFORT_MAPPING.md).
- **Formato OpenAI**: `reasoning_effort: low|high|max` + `thinking: {type: "enabled"}`
  (el proxy traduce a los campos Anthropic).

## Clientes MCP (genérico)

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["<ruta-absoluta-del-clone>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

El puente controla el **ZCode Desktop real instalado** (protocolo app-server:
sesiones, turns, tasks). Limitaciones: el desktop debe estar en marcha (él
resuelve los CAPTCHA de Z.AI); los niveles de razonamiento vía el catálogo del
puente son `low/high/max`; el catálogo de planes del desktop lista
GLM-5.3/GLM-5-Turbo — GLM-5.3-Flash va por la vía del proxy, no por el puente
del desktop. Detalles:
[mcp/zcode-harness-mcp/README.md](../mcp/zcode-harness-mcp/README.md).

## Cuota y modos de error

- `GET /quota` (autenticado) muestra los buckets de tokens por modelo.
- Cuota agotada → HTTP 400 `[1005] exceed quota limit` (no reintentable —
  espera el reset, GLM-5.3: diario a las 18:00 hora local).
- `[3007] captcha verify failed` → anti-abuso del gateway tras reintentos
  intensos; haz una pausa.
- `401 start_plan_jwt_invalid` → renueva el login del desktop
  ([README.es.md](../README.es.md) → «Renovación de inicio de sesión»).
- Vía Codex: error cosmético ocasional `OutputTextDelta without active item`
  en el handler de responses — el resultado sigue siendo correcto (problema
  cosmético conocido).
