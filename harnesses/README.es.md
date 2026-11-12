# Guías de asistentes
[English (original)](README.md) · [Deutsch](README.de.md) · **Español** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

> Traducción del original en inglés; ante cualquier discrepancia manda el
> original en inglés.

Para cada asistente de programación compatible, esta página indica qué ejecutar, qué escribe el kit y qué te queda por hacer a ti. La instalación está en el [README principal](../README.es.md). La CLI llama «harness» a un asistente; de ahí `--harness`.

El kit necesita Node.js 24 o posterior; con Node.js 20 y 22, que ya no son compatibles, `zcode-kit setup` y `zcode-kit update` se detienen sin cambiar nada. Los instaladores de las versiones publicadas instalan Bun 1.4.2 si falta Bun. `zcode-kit --version` muestra la versión instalada; `zcode-kit help` lista todos los comandos.

## Elegir asistentes durante la configuración

`zcode-kit setup` busca los asistentes instalados y configura solo los que aceptas.

- **En una terminal** muestra los asistentes detectados como una lista de casillas: las flechas mueven el cursor, Espacio marca o desmarca, `a` cambia todas y Enter confirma. Los asistentes marcados se configuran y los demás se omiten. Esc, o Enter sin ninguna casilla marcada, no guarda ninguna respuesta.
- **En una terminal sin color o sin control del cursor, o demasiado pequeña para la lista,** pregunta `Configure ZCode for <asistente>? [y/n]` una vez por asistente. `zcode-kit setup --select` muestra en su lugar una lista numerada y acepta números, `all` o `none`.
- **Sin terminal** (CI, una tubería) no pregunta nada y omite todos los asistentes que no tienen una respuesta guardada. En ese caso indica tú los asistentes: `zcode-kit setup --harness omp,codex` o `ZCODE_KIT_HARNESSES=omp,codex` configura exactamente esos. `none` omite todos los asistentes detectados; un id desconocido es un error.

Las respuestas se guardan en `generated/harness-choices/` y las reutilizan las configuraciones posteriores, `zcode-kit update` y `zcode-kit doctor --fix`: lo que aceptaste se mantiene al día, lo que rechazaste no se toca y no se te vuelve a preguntar. `zcode-kit setup --reask` pregunta de nuevo en una terminal y `zcode-kit doctor --forget <asistente>` borra una respuesta guardada. Una integración que este kit creó antes puede actualizarse aunque no haya una respuesta guardada para ella.

Ctrl-C termina la configuración con el código de salida 130. Una lista de casillas sin confirmar no se aplica; las respuestas y/n ya dadas siguen aplicadas. Si un asistente falla, sus cambios parciales se deshacen, los demás se configuran igualmente y la configuración termina con el código 20. La configuración muestra el comando `zcode-kit rollback` que deshace sus cambios. Que un asistente esté configurado significa que los archivos se escribieron, no que la sesión funcione ni que un modelo responda; comprueba la sesión con `zcode-kit auth status`.

## Configurar un solo asistente

```sh
zcode-kit integrate <asistente> --dry-run   # lista lo que se escribiría, sin escribir nada
zcode-kit integrate <asistente>             # lo escribe y guarda tu consentimiento
zcode-kit rollback                          # deshace el cambio más reciente
```

`--dry-run` imprime una línea `would write` por cada archivo que cambiaría. La ejecución real guarda además un sí para ese asistente, de modo que las configuraciones y actualizaciones posteriores lo mantienen al día. Nunca registra el puente MCP. En un checkout de git del kit, `setup` e `integrate` se niegan a escribir salvo que esté definida `ZCODE_KIT_ALLOW_CHECKOUT=1`.

## Resumen

| Asistente (id) | La configuración escribe | Cómo iniciarlo | Probado con una respuesta del modelo |
|---|---|---|---|
| OMP (`omp`) | provider `zcode` en `~/.omp/agent/models.yml`, una extensión de autoarranque | `omp --model zcode/glm-5.3-flash` | Windows, versión 18.2.9 |
| pi (`pi`) | provider `zcode` en `~/.pi/agent/models.json` | `zcode-kit proxy start` y después `pi --model zcode/glm-5.3` | Windows, versión 0.85.0 |
| Claude Code (`claude-code`) | `generated/claude-zcode-settings.json` | `zcode-kit run claude-code -- <args>` | Windows, versión 2.1.278 |
| Codex CLI (`codex`) | `generated/codex-home/config.toml` | `zcode-kit run codex -- <args>` | Windows, versión 0.155.1 |
| OpenCode (`opencode`) | provider `zcode` en el archivo de configuración de OpenCode | `zcode-kit run opencode -- <args>` | Windows, versión 1.18.29 |
| Aider (`aider`) | `generated/aider-zcode.env` | `zcode-kit run aider -- <args>` | Windows, versión 0.86.2 |
| Continue (`continue`) | dos modelos en `~/.continue/config.yaml` | `zcode-kit proxy start` y después elegir el modelo en Continue | no |
| Goose (`goose`) | `zcode.json` en la carpeta `custom_providers` de Goose | `zcode-kit proxy start` y después `goose session --provider zcode` | no |
| Cline (`cline`) | `generated/cline-zcode-values.md` | introducir los valores en Cline y después `zcode-kit proxy start` | no |
| Kilo Code (`kilo-code`) | `generated/kilo-zcode-values.md` | introducir los valores en Kilo Code y después `zcode-kit proxy start` | no |

La última columna procede de la [matriz de compatibilidad](../SUPPORT_MATRIX.json): Windows 11, 2026-09-23, kit v0.2.33, `glm-5.3-flash`. En Linux y macOS no se probó nada con una respuesta real del modelo. En las filas con «no» solo se probó la escritura de la configuración, sin el asistente en sí.

`generated/` y la clave local `.proxykey` están en el directorio del kit en las instalaciones publicadas y las copias del código, y en un directorio de estado aparte, fuera de `node_modules`, en las instalaciones con npm. Algunos de los archivos escritos contienen la clave en texto plano; no los compartas y ejecuta de nuevo `zcode-kit setup` si la clave cambia.

`zcode-kit run <asistente> -- <args>` existe para Claude Code, Codex CLI, OpenCode y Aider. Arranca el proxy si hace falta y pasa al asistente todo lo que sigue a `--`. Los scripts `bin/zcode-claude`, `bin/zcode-codex` y `bin/zcode-aider` (`.cmd` o `.sh`) del directorio del kit hacen lo mismo.

## Notas por asistente

### OMP

Inicia OMP directamente; no existe `zcode-kit run omp`. Elige el nivel de thinking con `--thinking low`, `high` o `max`; el kit declara `max` como predeterminado. La configuración añade un bloque marcado a `models.yml`, copia la extensión a `~/.omp/agent/extensions/` y, si existe `config.yml`, registra allí la extensión y quita `zcode` de `disabledProviders`. Omite OMP cuando `models.yml` no existe y no cambia nada cuando el archivo ya tiene un provider `zcode` escrito por ti.

La extensión arranca el proxy con la primera solicitud de OMP a un modelo `zcode`. La comprobación de arranque se ejecuta en un proceso aparte durante 120 segundos como máximo. Si falla, OMP imprime una línea `[zcode-autostart]` con el motivo y no lo reintenta hasta pasados 60 segundos. La extensión guarda la ruta del Node.js que encontró la configuración; si ese Node.js se elimina o es anterior a la versión 24, ejecuta de nuevo `zcode-kit setup` y reinicia OMP.

### pi

pi no arranca el proxy por sí mismo. La entrada usa el formato Anthropic messages y tus demás providers se conservan. La clave no se escribe en el archivo: pi la obtiene ejecutando el script del kit `proxy/resolve-zcode-proxy-key.mjs`. La configuración omite pi cuando `~/.pi/agent` no existe y no cambia nada cuando el archivo tiene un provider `zcode` que no escribió el kit. El kit no define niveles de thinking para pi.

### Claude Code

`~/.claude/settings.json` no se modifica. `zcode-kit run claude-code -- <args>` ejecuta `claude --settings <archivo generado> <args>`, así que solo esa llamada va a ZCode y tu `claude` normal funciona como antes. Los ajustes usan `glm-5.3` como modelo principal y `glm-5.3-flash` como modelo pequeño y rápido; añade `--model glm-5.3-flash` para usar Flash en todo. Anthropic no ofrece soporte oficial para Claude Code con modelos que no sean Claude.

### Codex CLI

`zcode-kit run codex -- <args>` fija `CODEX_HOME` en `generated/codex-home` para esa llamada; `~/.codex` y tu `codex` normal quedan como están. Como es un home aparte, tus propios ajustes, skills, reglas y servidores MCP de Codex no se aplican allí. Su `config.toml` usa la Responses API con `glm-5.3` como modelo predeterminado y siempre contiene una entrada para el puente MCP del kit. En Windows también define `sandbox = "unelevated"` en `[windows]`.

### OpenCode

La configuración edita el archivo indicado por `OPENCODE_CONFIG` o, si no, `opencode.jsonc` u `opencode.json` en `OPENCODE_CONFIG_DIR`, `$XDG_CONFIG_HOME/opencode` o `~/.config/opencode`, y lo crea si falta. Los demás ajustes y los comentarios fuera de la sección `provider` se conservan. Un provider `zcode` que no escribió el kit detiene el cambio con un error. La entrada lee la clave de la variable de entorno `ZCODE_PROXY_KEY`, que `zcode-kit run opencode` define. Si inicias `opencode` directamente, define tú la variable y arranca antes el proxy. `glm-5.3-flash` tiene las variantes `low`, `high` y `max`, con `low` por defecto.

### Aider

`zcode-kit run aider` define `OPENAI_API_BASE` y `OPENAI_API_KEY` solo para ese proceso; no se define nada a nivel de sistema y `~/.aider.conf.yml` no se toca. Sin argumentos ejecuta `aider --model openai/glm-5.3`. Con argumentos, indica tú el modelo, por ejemplo `zcode-kit run aider -- --model openai/glm-5.3-flash`. `generated/aider-zcode.env` contiene los mismos valores para uso manual.

### Continue

La configuración añade «ZCode GLM-5.3» y «ZCode GLM-5.3-Flash» en un bloque marcado al final de la lista `models:`; los modelos existentes se conservan. La configuración omite Continue cuando `config.yaml` no existe; cuando exista, ejecuta `zcode-kit integrate continue`. Una lista `models:` escrita en una sola línea con entradas no se edita; reescríbela antes como lista en bloque.

### Goose

La carpeta es `%APPDATA%\Block\goose\config\custom_providers` en Windows y `~/.config/goose/custom_providers` en macOS y Linux. La clave no se guarda en `zcode.json`; Goose la obtiene ejecutando el script de clave del kit. Un `zcode.json` que no escribió este kit no se sobrescribe.

### Cline y Kilo Code

El kit no escribe en el almacenamiento que VS Code mantiene para estas extensiones. La configuración escribe un archivo con los valores y tú los introduces una vez en los ajustes de la extensión:

- **Cline:** API Provider «OpenAI Compatible», la URL base terminada en `/v1`, la clave y un ID de modelo. El archivo incluye también el comando `cline auth` para la CLI de Cline.
- **Kilo Code:** un provider personalizado con la API «Anthropic Messages», la URL base terminada en `/v1`, la clave y los dos modelos, que añades a mano. El kit no escribe `kilo.jsonc`.

Los dos archivos no contienen la clave; muéstrala con `zcode-kit models --show-key`. La configuración solo encuentra las extensiones en `~/.vscode/extensions`. Para otro editor, ejecuta `zcode-kit integrate cline` o `zcode-kit integrate kilo-code`.

## Puente MCP

El puente `zcode-harness` es un servidor MCP local con el que un asistente puede trabajar con las sesiones y tareas de tu ZCode instalado. Registrarlo no conecta ningún modelo.

La configuración registra el puente para OMP (en `~/.omp/agent/mcp.json`) y para Claude Code (`claude mcp add zcode-harness --scope user`) cuando marcas ese asistente, respondes `y` para él o lo indicas con `--harness`; la lista y las preguntas lo avisan. `--no-mcp` deja fuera el puente e `integrate` nunca lo registra. En Claude Code este es el único cambio en tu configuración normal; `claude mcp remove zcode-harness --scope user` o `zcode-kit uninstall` lo eliminan. Otros clientes MCP pueden usar esta entrada:

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["--max-semi-space-size=1", "<ruta-absoluta-de-instalacion>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

El puente necesita ZCode Desktop instalado y con la sesión iniciada, y su lista de modelos puede diferir de la del proxy. En la prueba registrada (Windows 11, ZCode 0.16.9, 2026-09-23) listó y seleccionó GLM-5.3-Flash, pero el proveedor rechazó la solicitud al modelo con el código 1113 (saldo insuficiente), así que no está confirmada una respuesta del modelo a través del puente. Consulta la [documentación del puente](../mcp/zcode-harness-mcp/README.es.md).

## Otros clientes

Cualquier cliente que hable la API de OpenAI o la de Anthropic puede usar el proxy sin integración. `zcode-kit proxy start` y `zcode-kit proxy status` imprimen las URL base, la clave y los ID de modelo. La clave completa solo aparece en una terminal interactiva; en otro caso la imprime `zcode-kit models --show-key`. Los ejemplos usan el puerto predeterminado `8457`.

```yaml
# Formato OpenAI
base_url: http://127.0.0.1:8457/v1
api_key: <clave local del proxy>
model: glm-5.3            # o glm-5.3-flash
```

```yaml
# Formato Anthropic
base_url: http://127.0.0.1:8457
auth_token: <clave local del proxy>
model: glm-5.3
```

El proxy atiende `POST /v1/messages` (Anthropic), `POST /v1/chat/completions` y `POST /v1/responses` (OpenAI), `GET /v1/models`, `GET /health` y `GET /quota`. Todos requieren la clave, como `Authorization: Bearer <clave>` o como `x-api-key`.

### Niveles de thinking

Ambos modelos admiten los niveles `low`, `high` y `max`; consulta la [correspondencia de niveles de esfuerzo](../EFFORT_MAPPING.md) (en inglés).

- **Formato OpenAI:** envía `reasoning_effort`. `medium` se trata como `high`, y una solicitud sin ese campo se ejecuta con `max`. El proxy añade un presupuesto de thinking de 8000, 16000 o 32000 tokens.
- **Formato Anthropic:** envía `thinking: {type: "enabled", budget_tokens: <n>}` junto con `output_config: {effort: "low"|"high"|"max"}`.
- **Flash siempre usa thinking.** Una solicitud a `glm-5.3-flash` que desactiva thinking se envía con `low`.

## Errores y cuota

- **`[1005] exceed quota limit` (HTTP 400):** la cuota está agotada. El proxy reintenta durante unos 65 segundos y después prueba con otra cuenta si el Account Rotator tiene alguna. Si el error te llega igualmente, espera a que se restablezca la cuota; `zcode-kit proxy status` la muestra.
- **`[3007] captcha verify failed`:** la comprobación antiabuso del proveedor rechazó la solicitud. El proxy reintenta una vez con un token nuevo; si también falla, espera antes de reintentar.
- **`[1210]` con Flash:** elige `low`, `high` o `max` en lugar de desactivar thinking.
- **HTTP 401:** `Invalid or missing proxy API key` significa que el cliente envió una clave local incorrecta. En otro caso, comprueba la sesión con `zcode-kit auth status` y renuévala con `zcode-kit auth login zai`. Añade `--import` para tomar la sesión activa `zai`/`start-plan` de Desktop; con `coding-plan` se inicia sesión sin esa opción.
- **Los fallos transitorios antes de cualquier salida** (conexión rechazada o reiniciada, HTTP 429, 500, 502, 503, 504, 524 o 529, o un flujo que falla antes de su primer contenido) se reintentan hasta 3 veces con una espera creciente. Una vez iniciada la salida no se reintenta nada. `ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS`, que se lee al arrancar el proxy, fija la espera base en milisegundos (500 por defecto, 10000 como máximo).
- **Una respuesta cortada** termina con un error en lugar de interrumpirse en silencio: `data: {"error":…}` en los flujos de chat, `response.failed` en los flujos de Responses, `event: error` en los flujos de Anthropic. Vuelve a enviar la solicitud desde el asistente.
