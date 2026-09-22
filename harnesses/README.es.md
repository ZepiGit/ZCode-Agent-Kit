# Adaptadores de Harness — cómo otros CLIs de agentes usan el proxy local (Español)
[English (original)](README.md) · [Deutsch](README.de.md) · **Español** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

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

Autenticación: `Authorization: Bearer <contenido de .proxykey>`.
`zcode-kit setup` genera la clave localmente. En instalaciones publicadas y
copias del código, `.proxykey` está en el directorio del kit; con npm se
guarda fuera de `node_modules`, en el estado exclusivo de esa instalación.

## Configurado automáticamente por `zcode-kit setup` (solo para harnesses detectados)

`zcode-kit setup --harness auto` detecta los harnesses instalados y configura
**solo esos**. Si únicamente se detecta OMP, no se crean configuraciones ni
wrappers de Claude/Codex.

| Harness | Mecanismo | Impacto en la config existente |
|---|---|---|
| OMP (oh-my-pi) | bloque de provider `zcode` en `~/.omp/agent/models.yml` + extensión de autoarranque | aditivo (bloque gestionado, transaccional, idempotente); elección de modelo: `omp --model zcode/glm-5.3[-flash] --thinking low\|high\|max` |
| pi | provider `zcode` en `~/.pi/agent/models.json` (`api: anthropic-messages`, resolver de clave `!node`) | aditivo (los demás providers se quedan); fuente: pi-mono docs/models.md |
| Claude Code | `generated/claude-zcode-settings.json` + `bin/zcode-claude.cmd\|.sh` | `~/.claude` queda intacto (opt-in por invocación) |
| Codex CLI | `generated/codex-home` aislado + `bin/zcode-codex.cmd\|.sh` | `~/.codex` queda intacto; **diferencia**: tus propias skills/reglas/MCP no aplican dentro del wrapper |
| OpenCode | provider `zcode` en `opencode.json` (`@ai-sdk/openai-compatible`, apiKey `{env:ZCODE_PROXY_KEY}`) | aditivo; los comentarios JSONC se conservan |
| Aider | `generated/aider-zcode.env` + `bin/zcode-aider.cmd\|.sh` (local al proceso, **sin setx**) | modelo `openai/glm-5.3[-flash]` |
| Continue | bloque gestionado en `~/.continue/config.yaml` (schema v1) | los modelos/roles existentes se quedan |
| Goose | `%APPDATA%/Block/goose/config/custom_providers/zcode.json` (Windows) o `~/.config/goose/custom_providers/zcode.json` (macOS/Linux) | credencial vía el helper documentado `auth.command` (resolver de clave del kit, sin shell) |
| Cline | `generated/cline-zcode-values.md` — **manual-confirmation-required** | el kit nunca toca el estado de VS Code; introduce los valores una vez en la UI |
| Kilo Code | `generated/kilo-zcode-values.md` — **manual-confirmation-required** | provider personalizado (Anthropic messages) en la UI; el kit deliberadamente no escribe kilo.jsonc |
| Harnesses con MCP | servidor stdio `zcode-harness` (`node mcp/zcode-harness-mcp/dist/index.js --stdio`) | OMP: entrada en `~/.omp/agent/mcp.json`; Claude Code: `claude mcp add` (solo si se detecta); Codex: dentro del home aislado. MCP por sí solo NO cuenta como integración de modelo |

Las rutas `generated/` indican el estado del kit: dentro del directorio del
kit para versiones publicadas/código fuente y en un directorio aparte para npm.

## Wrappers opt-in (la config existente queda intacta)

| Harness | Wrapper | Qué hace |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | arranca el proxy bajo demanda y llama a `claude --settings <estado-del-kit>\generated\claude-zcode-settings.json` (los settings del CLI prevalecen sobre settings.json; tu `claude` normal sigue igual) |
| Codex CLI | `bin\zcode-codex.cmd` | fija `CODEX_HOME=<estado-del-kit>\generated\codex-home` + `ZCODE_PROXY_KEY` y arranca el proxy bajo demanda; tu `codex` normal y `~/.codex` quedan intactos |

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
      "args": ["<ruta-absoluta-de-instalacion>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

El puente controla el **ZCode harness real instalado** (protocolo app-server:
sesiones, turnos, tareas). Desktop puede ser necesario para una verificación
interactiva; el proveedor aun así puede rechazar una solicitud al modelo.
Los niveles de razonamiento del puente son `low/high/max`. Su catálogo de
modelos en vivo puede diferir del del proxy; GLM-5.3-Flash se verificó a través
del proxy. Detalles: [puente MCP](../mcp/zcode-harness-mcp/README.es.md).

## Cuota y modos de error

- `GET /quota` (autenticado) muestra los buckets de tokens por modelo.
- Cuota agotada → HTTP 400 `[1005] exceed quota limit` (no reintentable;
  espera a que el proveedor restablezca la cuota).
- `[3007] captcha verify failed` → anti-abuso del gateway tras reintentos
  intensos; haz una pausa.
- `401 start_plan_jwt_invalid` → comprueba la sesión de Desktop y renuévala con `zcode-kit auth login zai`.
