# Adaptadores de Harness — cómo otros CLIs de agentes usan el proxy local (Español)
[English (original)](README.md) · [Deutsch](README.de.md) · **Español** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

> Traducción del original en inglés; ante cualquier discrepancia manda el
> original en inglés.

El núcleo del kit es neutral respecto al harness: un proxy HTTP local con tres formatos estándar. Los ejemplos usan el puerto predeterminado `8457`; `zcode-kit proxy status` muestra el puerto y los datos de conexión de tu instalación:

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

## Configurado por `zcode-kit setup` (harnesses detectados, solo con consentimiento)

`zcode-kit setup --harness auto` detecta los harnesses instalados y pregunta, por cada uno sin decisión guardada, "Configure ZCode as a provider with its supported models in <HARNESS>? [y/n]". Un `y` configura ese harness; `n` lo omite y deja sus archivos intactos, y sin terminal se omite todo harness sin decidir. Ctrl-C detiene las preguntas (código de salida 130); lo que ya respondiste con `y` queda configurado. Si únicamente se detecta OMP, no se crean configuraciones ni wrappers de Claude/Codex. Las decisiones se guardan en un archivo por harness en `generated/harness-choices/` y forman parte de la transacción de configuración (un rollback las elimina de nuevo); `zcode-kit update` y `zcode-kit doctor --fix` solo vuelven a aplicar integraciones consentidas (un `y`, una selección explícita o `zcode-kit integrate <harness>`), y un `n` guardado se respeta hasta que `--harness`, `integrate` o `zcode-kit setup --reask` (vuelve a preguntar en una terminal) lo cambien. Una integración que el kit creó antes de preguntar se actualiza en ejecuciones desatendidas, pero nunca se convierte en consentimiento. Para ejecuciones desatendidas selecciona los harnesses con `--harness omp,codex` o `ZCODE_KIT_HARNESSES=omp,codex` (`none` omite todos los detectados); los id desconocidos son errores. El puente MCP del kit solo se registra con consentimiento aparte: una selección explícita o un `y` dado tras la nota MCP que la configuración muestra antes de la pregunta (`--no-mcp` lo desactiva); `integrate`, una actualización o una decisión guardada sin esa nota nunca lo registran. Un harness que falla no detiene a los demás: sus propios cambios parciales se deshacen, el resumen lo lista como fallido y la configuración termina con código 20 (los instaladores continúan con una advertencia).

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
| Harnesses con MCP | servidor stdio `zcode-harness` (`node mcp/zcode-harness-mcp/dist/index.js --stdio`) | OMP: entrada en `~/.omp/agent/mcp.json`; Claude Code: `claude mcp add` (solo si se detecta y se consiente); Codex: dentro del home aislado. MCP por sí solo NO cuenta como integración de modelo |

Las rutas `generated/` indican el estado del kit: dentro del directorio del
kit para versiones publicadas/código fuente y en un directorio aparte para npm.

Ejecuta OMP directamente, por ejemplo con `omp --model zcode/glm-5.3-flash --thinking low`, sin `zcode-kit run`. La configuración fija Node/Bun nativos; la comprobación previa del autoarranque usa un proceso hijo nuevo, sin importar módulos del kit en OMP. El proceso hijo tiene un límite de 120 segundos e informa de categorías de fallo sin secretos. Corrige la causa y reintenta tras los 60 segundos de espera por sesión; es posible recuperarse en la misma sesión. Si cambió la ubicación del runtime, ejecuta de nuevo `zcode-kit setup --harness auto` y recarga la extensión. Nunca se detienen procesos desconocidos que ocupen el puerto. Un proxy saludable o una configuración correcta no demuestran por sí solos que una respuesta del modelo termine.

## Wrappers opt-in (la config existente queda intacta)

| Harness | Wrapper | Qué hace |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | arranca el proxy bajo demanda y llama a `claude --settings <estado-del-kit>\generated\claude-zcode-settings.json` (los settings del CLI prevalecen sobre settings.json; tu `claude` normal sigue igual) |
| Codex CLI | `bin\zcode-codex.cmd` | fija `CODEX_HOME=<estado-del-kit>\generated\codex-home` + `ZCODE_PROXY_KEY` y arranca el proxy bajo demanda; tu `codex` normal y `~/.codex` quedan intactos |

## Conexión manual (cualquier cliente compatible OpenAI/Anthropic)

Es una vía de entrada equivalente, no un plan B. El proxy del kit debe estar en ejecución y ZCode necesita una sesión válida. `zcode-kit proxy start` (también cuando el proxy ya está en ejecución) y `zcode-kit proxy status` imprimen las URL base actuales, la clave local y los ID de modelo. Cuando el proxy no se verifica en ejecución, los valores se etiquetan como procedentes de la configuración y la salida dice `Start the proxy first: zcode-kit proxy start`. La clave completa solo aparece en una terminal interactiva; en otro caso usa `zcode-kit models --show-key`. Sustituye el puerto de ejemplo de abajo por el que muestra el comando.

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

**Flash:** `glm-5.3-flash` siempre usa thinking. Si se desactiva explícitamente, se normaliza a `low`; se conservan `high` y `max` cuando se eligen explícitamente. Para Flash, el presupuesto bajo de thinking de Anthropic es de `8000` tokens (en vez de los `2048` genéricos anteriores), con margen adicional de salida para la respuesta; OpenAI usa `reasoning_effort: low`. Un esfuerzo de thinking mayor no demuestra por sí solo un bloqueo. Las respuestas de Flash mediante el proxy directo y Claude Code se han completado correctamente; esto no acredita todos los asistentes.

En Windows, el perfil aislado de Codex activa el entorno restringido por token (`windows.sandbox = "unelevated"`); `workspace-write` sigue limitado al proyecto y no concede acceso total. OpenCode Flash ofrece `--variant low`, `high` y `max`, con `low` por defecto. Se admiten su wrapper npm para ejecutables nativos y los flujos de sesión comprimidos con Brotli/deflate. Se conservan los textos e imágenes de resultados de herramientas Responses; los eventos inválidos no se consideran salida correcta.

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
del proxy. Una entrada en el catálogo nativo no demuestra que una solicitud
nativa al modelo funcione; la aceptación del proxy no acredita al proveedor
nativo. Detalles: [puente MCP](../mcp/zcode-harness-mcp/README.es.md).

## Cuota y modos de error

- `GET /quota` (autenticado) muestra los buckets de tokens por modelo.
- Cuota agotada → HTTP 400 `[1005] exceed quota limit`. El proxy reintenta la misma cuenta con un calendario creciente (hasta ~65s) antes de cambiar de cuenta; si aún lo ves, espera a que el proveedor restablezca la cuota.
- `[3007] captcha verify failed` → anti-abuso del gateway. El proxy reintenta una vez con un token CAPTCHA recién emitido; si aún falla, haz una pausa.
- Los fallos transitorios antes de cualquier salida (conexión rechazada o reiniciada, HTTP 500/502/503/504/524/529, 429 con un `Retry-After` corto) se reintentan hasta 3 veces en la misma cuenta con una espera creciente, como hace el cliente oficial. Un código de error del gateway reconocido, un error de autenticación o de modelo y cualquier cosa tras el inicio de la salida nunca se reintentan; un `Retry-After` superior a 15 segundos se pasa al cliente. Ajústalo con `ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS` (espera base en milisegundos, 500 por defecto, máximo 10000; `off` conserva solo el reintento de conexiones que nunca se establecieron; proxy start/restart lo transmite).
- Un flujo que el upstream corta termina con un mensaje de error en lugar de un truncamiento silencioso: los flujos de chat con `data: {"error":…}`, los de Responses con `response.failed`, los flujos Anthropic nativos con un frame `event: error` (`upstream_incomplete` o `upstream_stream_error`). Nada se repite una vez iniciada la salida; vuelve a enviar el turno desde el harness.
- `401 start_plan_jwt_invalid` → comprueba la sesión de Desktop y renuévala con `zcode-kit auth login zai`. Usa `zcode-kit auth login zai --import` para el login activo de `zai`/`start-plan` en Desktop 0.16.9 con un plan configurado explícitamente. Si existe `credentials.json`, es la fuente autoritativa; unas credenciales inválidas no provocan una vuelta silenciosa a `config.json`. Los logins modernos de `coding-plan` usan el OAuth normal; la importación no crea ni obtiene claves API.
- `[1210]` con Flash → comprueba que thinking esté activado y elige `low`, `high` o `max`, en lugar de desactivarlo. El proxy normaliza thinking desactivado a `low`; consulta la nota sobre Flash anterior.
