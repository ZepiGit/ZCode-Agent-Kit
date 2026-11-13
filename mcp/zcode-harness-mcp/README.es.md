# zcode-harness-mcp
[English (original)](README.md) · [Deutsch](README.de.md) · **Español** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

> Traducción del original en inglés. Ante cualquier discrepancia manda el
> original en inglés.

Un servidor local de Model Context Protocol (MCP) que da a un cliente MCP, por
ejemplo un asistente de programación, herramientas de la runtime de ZCode
instalada en este equipo. El puente arranca la runtime
(`zcode.cjs app-server --stdio`) como proceso hijo y ofrece sobre ella 32
herramientas y un conjunto de recursos: listar modelos, abrir workspaces, crear
sesiones, iniciar tareas, esperarlas, responder peticiones de permiso y leer
los resultados.

El trabajo lo hace la runtime de ZCode, con sus propias herramientas y con el
inicio de sesión de ZCode de este equipo. El puente transmite peticiones y
resultados y guarda el estado de sus tareas. No usa el proxy del kit, y
registrarlo no conecta ningún modelo con tu asistente.

## Requisitos

- Node.js 24 o posterior. `node` debe estar en el `PATH`, porque el puente
  arranca la runtime con el nombre de programa `node`.
- ZCode Desktop, instalado y con la sesión iniciada. El puente no gestiona el
  inicio de sesión de ZCode.
- Un cliente MCP que pueda arrancar un servidor stdio local, o uno que pueda
  enviar una cabecera `Authorization` a un endpoint HTTP local.

## Localizar la runtime de ZCode

El puente busca `zcode.cjs` en las ubicaciones de instalación de ZCode Desktop
en Windows:

- `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
- `%LOCALAPPDATA%\ZCode\resources\glm\zcode.cjs`
- las mismas dos rutas bajo `%ProgramFiles%` y `%ProgramFiles(x86)%`
- `%LOCALAPPDATA%\zcode\app.resources\glm\zcode.cjs`

En otros sistemas, o con otra ubicación de instalación, indica el archivo con
`--runtime-path` o `ZCODE_HARNESS_RUNTIME_PATH`. Un archivo solo se acepta si
`node <archivo> --version` termina con código 0 e imprime un número de versión.
Si un archivo que has indicado no existe o no supera esta comprobación, no se
prueba ninguna otra runtime. El archivo se ejecuta, así que indica solo un
archivo en el que confíes.

Si no se acepta ninguna runtime, el puente arranca igualmente. `zcode_health`
informa entonces de `degraded: true` con el motivo, y las herramientas que
necesitan la runtime devuelven un error.

La runtime necesita su configuración de proveedores incorporada. El puente busca
`zcode-builtin.json` en relación con el archivo de la runtime, nunca en el
directorio de trabajo, y se lo pasa a la runtime en
`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`. Un `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` no
vacío en el entorno del puente tiene prioridad, después
`ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE` y después el archivo que encontró
el puente. Solo se modifica el entorno del proceso de la runtime, y
`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` se transmite sin cambios. Si el archivo
elegido no se puede leer, la runtime no se arranca y no se prueba ningún otro
archivo. Las rutas figuran en [docs/SECURITY.md](docs/SECURITY.md).

## Instalación

El instalador publicado del kit y su configuración npm incluyen el puente
compilado (`dist/`) e instalan sus dependencias. La configuración del kit puede
registrar el puente en un asistente;
[harnesses/README.es.md](../../harnesses/README.es.md) describe cuándo lo hace.

Para compilar desde el código fuente, ejecuta en este directorio:

```sh
npm install
npm run build
npm run probe:runtime
```

`npm run probe:runtime` imprime el resultado de la búsqueda de la runtime como
JSON.

## Registrar el puente

### stdio

```json
{
  "mcpServers": {
    "zcode-harness": {
      "command": "node",
      "args": [
        "<kit>/mcp/zcode-harness-mcp/dist/index.js",
        "--stdio",
        "--allow-workspace", "<path to your projects>",
        "--interaction-policy", "ask"
      ]
    }
  }
}
```

Usa rutas absolutas. Cada cliente tiene su propio formato de configuración; el
ejemplo muestra la forma habitual `mcpServers`. Hay una variante de solo lectura
en [examples/config/stdio.mcp.json](examples/config/stdio.mcp.json).

Las herramientas que reciben un `workspacePath` solo aceptan directorios dentro
de una raíz permitida. Sin `--allow-workspace`, la única raíz permitida es el
directorio `workspaces` dentro del directorio de datos.

Las entradas que genera el kit ponen el flag de Node `--max-semi-space-size=1`
delante de la ruta del script. Reduce la generación joven del heap de V8 y es
opcional.

### HTTP

```sh
node dist/index.js --http --http-key "<random local secret>" --allow-workspace "<path to your projects>"
```

El endpoint es `http://127.0.0.1:3322/mcp`. Cada petición debe llevar
`Authorization: Bearer <key>`. En modo HTTP el puente se niega a arrancar sin
clave, o con un host distinto de `127.0.0.1`, `localhost`, `::1` u otra
dirección `127.x.x.x`. Solo responde a `POST` y no mantiene sesión entre
peticiones, de modo que varios clientes pueden usar un mismo puente. Hay una
configuración de cliente en
[examples/config/http.mcp.json](examples/config/http.mcp.json).

El código HTTP solo se carga cuando se indica `--http`. Un puente stdio nunca lo
carga.

## Opciones

Una opción desconocida detiene el puente al arrancar, para que un `--read-only`
mal escrito no pase inadvertido.

| Opción | Variable de entorno | Valor por defecto | Significado |
| --- | --- | --- | --- |
| `--stdio` | | activado | MCP por stdin y stdout. Los logs van a stderr. |
| `--http` | | desactivado | MCP por HTTP en lugar de stdio. |
| `--http-key KEY` | `ZCODE_HARNESS_HTTP_KEY` | ninguna | Clave Bearer. Obligatoria con `--http`. |
| `--host H` | `ZCODE_HARNESS_HTTP_HOST` | `127.0.0.1` | Host HTTP. Solo direcciones de loopback. |
| `--port N` | `ZCODE_HARNESS_HTTP_PORT` | `3322` | Puerto HTTP. |
| `--allow-workspace P` | `ZCODE_HARNESS_ALLOW_WORKSPACES` | ninguna | Raíz de workspace permitida. Repite la opción o separa varias rutas con `;`. |
| `--read-only` | | desactivado | Las herramientas que cambian el estado devuelven `READ_ONLY_MODE`. |
| `--allow-yolo` | `ZCODE_HARNESS_ALLOW_YOLO=1` | desactivado | Permite a los clientes elegir el modo `yolo`, que desactiva las peticiones de permiso de la runtime. |
| `--runtime-path FILE` | `ZCODE_HARNESS_RUNTIME_PATH` | búsqueda | Ruta a `zcode.cjs`. |
| `--data-dir DIR` | `ZCODE_HARNESS_DATA_DIR` | `~/.zcode-harness-mcp` | Dónde se guardan tareas, resultados, eventos e interacciones. |
| `--interaction-policy deny\|allowlist\|ask` | `ZCODE_HARNESS_INTERACTION_POLICY` | `deny` | Cómo se responden las peticiones de permiso de la runtime. |
| `--interaction-allowlist A,B` | `ZCODE_HARNESS_INTERACTION_ALLOWLIST` | ninguna | Nombres exactos de herramientas que aprueba la política `allowlist`. Obligatoria con esa política. |
| `--interaction-timeout-sec N` | `ZCODE_HARNESS_INTERACTION_TIMEOUT_SEC` | `300` | Segundos hasta que una petición sin respuesta se deniega. |
| `--max-concurrent-tasks N` | `ZCODE_HARNESS_MAX_CONCURRENT_TASKS` | `2` | Tareas que se ejecutan a la vez. Las demás esperan en la cola. |
| | `ZCODE_HARNESS_TASK_QUEUE_LIMIT` | `50` | Número máximo de tareas sin terminar. |
| | `ZCODE_HARNESS_REQUEST_TIMEOUT_MS` | `60000` | Tiempo límite de una petición a la runtime. |
| | `ZCODE_HARNESS_MAX_ARTIFACT_BYTES` | `10485760` | Archivo más grande que lee `zcode_artifact_read`. |
| | `ZCODE_HARNESS_LOG_LEVEL` | `info` | `debug`, `info`, `warn` o `error`. |
| `--help`, `-h` | | | Imprime la línea de uso. |

## Tareas

`zcode_task_start` devuelve un `taskId` de inmediato. La tarea se ejecuta
después en la runtime. `zcode_task_wait` espera hasta 120 segundos por llamada a
que termine, `zcode_task_get` devuelve su estado, `zcode_task_result` su texto y
sus detalles, `zcode_task_events` sus eventos. `zcode_task_input` envía más
entrada, `zcode_task_cancel` la detiene. [docs/MCP_API.md](docs/MCP_API.md)
describe todas las herramientas.

- **Concurrencia.** Por defecto se ejecutan dos tareas a la vez y las demás
  quedan en cola. Como máximo puede haber 50 tareas sin terminar. Un workspace
  ejecuta una sola tarea de escritura a la vez, y una sesión una sola tarea a la
  vez.
- **Retención.** El puente conserva como máximo 500 tareas terminadas, y ninguna
  más de 7 días después de que terminara. Una tarea eliminada pierde su
  registro, su resultado y sus eventos, y para ella se devuelve
  `unknown task: <taskId>`. Las tareas sin terminar y las que están en el estado
  `unknown` nunca se eliminan.
- **Idempotencia.** Un segundo `zcode_task_start` con el mismo `idempotencyKey`
  devuelve la tarea existente en lugar de iniciar una nueva. La clave se
  recuerda mientras se conserva la tarea; después, la misma clave inicia una
  tarea nueva.
- **Tamaño del texto.** El texto de respuesta de una tarea está limitado a 4 MiB
  de UTF-8. Un texto más largo conserva su primer 1 MiB y sus últimos 3 MiB, con
  la línea `[… N bytes truncated …]` entre ambos. Ese resultado se marca como
  `partial` y lleva `truncated.droppedBytes`.
- **Listas.** Una tarea conserva como máximo 200 advertencias, 200 errores y
  1.000 llamadas a herramientas.
- **Eventos.** Los eventos de una tarea se guardan en un máximo de dos archivos
  de 4 MiB cada uno; los eventos más antiguos se descartan.
- **Reinicio.** Tras un reinicio del puente, las tareas sin terminar se marcan
  como `interrupted`. Los resultados guardados de las tareas terminadas siguen
  siendo legibles.
- **Fin del cliente.** Cuando un cliente stdio cierra la conexión, el puente
  marca las tareas sin terminar como `interrupted`, detiene la runtime y
  termina. Solo detiene el proceso de la runtime que él arrancó, no los procesos
  que arrancó la runtime.

## Peticiones de permiso

La runtime pregunta antes de usar ciertas herramientas, y puede hacer preguntas
al usuario. `--interaction-policy` decide qué ocurre con estas peticiones:

- `deny` (por defecto): toda petición se deniega.
- `allowlist`: una petición de permiso se aprueba si el nombre de la herramienta
  está en `--interaction-allowlist`, y se deniega en caso contrario. Las
  preguntas al usuario se pasan al cliente.
- `ask`: la petición se pasa al cliente, que responde con
  `zcode_interaction_respond` y solo puede elegir entre las opciones que ofreció
  la runtime. Una petición que no se responde a tiempo se deniega.

Las peticiones para las herramientas `Bash`, `PowerShell` y `Shell` se deniegan
con cualquier política. En modo de solo lectura, y en una tarea iniciada con
`readOnly`, toda petición se deniega.

## Seguridad

El puente se ejecuta con los permisos de tu usuario y no es un sandbox.

- Las rutas de workspace, los identificadores de sesión y las lecturas de
  archivos se comprueban contra las raíces permitidas después de resolver
  enlaces simbólicos y junctions.
- `--read-only` bloquea toda herramienta que cambie el estado. Una tarea con
  `readOnly` se ejecuta en el modo `plan` de la runtime con sus herramientas de
  escritura y de shell denegadas; esto no impide que una herramienta que sigue
  permitida cambie archivos.
- El modo `yolo` se rechaza salvo que el puente se haya arrancado con
  `--allow-yolo`.
- Los secretos se enmascaran en los resultados de herramientas, los eventos, los
  logs y los mensajes de error.
- La runtime se arranca con un nombre de programa fijo y una lista de
  argumentos, nunca a través de un shell.
- HTTP está limitado a direcciones de loopback y exige la clave Bearer.

Los detalles están en [docs/SECURITY.md](docs/SECURITY.md). La política de
seguridad del kit está en [SECURITY.es.md](../../SECURITY.es.md).

## ZCode 0.16.9

- `zcode_workspace_open` devuelve el modo y los comandos slash de un workspace.
  La runtime no da ningún modelo por defecto, ningún catálogo de modelos ni
  ninguna revisión de ajustes para un workspace.
- `zcode_models_list` lee el catálogo de modelos creando una sesión sin prompt y
  cerrándola de nuevo. Esto puede arrancar servicios de la runtime, por lo que
  está bloqueado en modo de solo lectura.
- El modelo, el nivel de razonamiento y el modo se eligen por sesión, con
  `zcode_model_set` o con los argumentos de `zcode_task_start`. Los valores por
  defecto de un workspace no se pueden fijar ni restablecer; las herramientas
  devuelven un error y no guardan nada localmente.
- Los cuatro ajustes de `zcode_settings_update` se aplican a todo el proceso de
  la runtime, no a un workspace, y no se guardan. El puente recibe una
  confirmación de la runtime, pero no puede volver a leer los valores.
- No se ha confirmado ningún turno de modelo a través del puente. En una prueba
  en Windows 11 el 2026-09-23, `zai-api/GLM-5.3-Flash` estaba en el catálogo y
  se confirmó su selección con el nivel de razonamiento `low`, pero el proveedor
  rechazó el turno con el código `1113` (saldo o paquete de recursos
  insuficiente). El registro está en
  [SUPPORT_MATRIX.json](../../SUPPORT_MATRIX.json). Una petición de modelo que
  funciona a través del proxy del kit no dice nada sobre un turno a través del
  puente.

Hay más límites en [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

## Tests y demo

```sh
npm test
```

compila el puente y ejecuta los tests unitarios y de integración contra un
sustituto de la runtime (`test/fixture/fake-harness.mjs`). No hace falta ZCode.

```sh
LIVE_TEST=1 LIVE_WORKSPACE="<workspace>" LIVE_DATA_DIR="<data directory>" npm run test:live
```

se ejecuta contra la runtime de ZCode instalada y puede consumir cuota. Sin
`LIVE_TEST=1` y `LIVE_WORKSPACE` estos tests se omiten.

```sh
node examples/demo-client.mjs --workspace "<workspace>"
node examples/demo-client.mjs --fixture
```

recorre las herramientas desde el punto de vista de un cliente: estado,
capacidades, workspace, catálogo de modelos, sesión, tarea, petición de permiso,
resultado y un pedido de seguimiento en la misma sesión. Con `--fixture` usa el
sustituto en lugar de la runtime instalada.

## Documentación

- [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md): qué ofrece el puente, por áreas (en inglés)
- [docs/MCP_API.md](docs/MCP_API.md): herramientas, recursos, el resultado de una tarea y sus límites (en inglés)
- [docs/SECURITY.md](docs/SECURITY.md): comprobaciones y sus límites (en inglés)
- [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md): qué no funciona o no se ofrece (en inglés)
- [docs/PROTOCOL.md](docs/PROTOCOL.md): cómo habla el puente con la runtime de ZCode (en inglés)

## Licencia

MIT; consulta [LICENSE](LICENSE).
