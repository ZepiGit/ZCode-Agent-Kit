# zcode-harness-mcp (Español)
[English (original)](README.md) · [Deutsch](README.de.md) · **Español** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

> Traducción del original en inglés; ante cualquier discrepancia manda el
> original en inglés.

Un servidor MCP (stdio **y** Streamable-HTTP) con el que otros modelos y
agentes pueden controlar el **ZCode harness real instalado**: descubrir
capacidades, elegir modelos, leer/cambiar ajustes, gestionar workspaces y
sesiones, iniciar tareas, responder preguntas de seguimiento, observar el
progreso y recuperar resultados completos incluyendo cambios de archivos y
artefactos.

El puente es una **capa de control**, no un cliente de chat ni un wrapper de
prompts: todo el trabajo lo ejecuta la runtime original de ZCode (`zcode.cjs
app-server --stdio`, instalada localmente) con sus herramientas, su gestión de
contexto y sus permisos.

- Protocolo: MCP (SDK oficial) hacia fuera, **ZCode Protocol v1** (NDJSON por
  stdio; la verificación de 0.16.5 es histórica, el contrato actual es 0.16.9) hacia dentro — ver
  [`docs/PROTOCOL.md`](docs/PROTOCOL.md).
- Alcance: 32 herramientas MCP + recursos MCP; registro de capacidades actualizado
  según el contrato nativo ([`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md)).
- `npm test` ejecuta fixtures locales deterministas. Las pruebas reales requieren opt-in; informes históricos no son aceptación actual.
- Refuerzo: IDs de sesión limitados al workspace; `yolo` requiere `--allow-yolo`. La allowlist usa nombres exactos; Bash, PowerShell y Shell se deniegan. Artefactos con límite de tamaño; JSONL conserva dos archivos de máximo 4 MiB cada uno. EOF interrumpe tareas y cierra el hijo; no se garantiza aislamiento del árbol de procesos Windows. `--runtime-path` ejecuta código: solo archivos confiables.

## Requisitos previos

- Windows 10/11 (probado); en otros sistemas indica `--runtime-path` si la búsqueda automática no encuentra el harness instalado
- Node.js ≥ 20 (`node --version`); el script arranca el harness con el nombre
  de programa fijo `node`
- ZCode (Desktop) instalado. El puente encuentra `zcode.cjs` automáticamente en
  - `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
  - `%ProgramFiles%\ZCode\resources\glm\zcode.cjs`
  - también puedes indicar el archivo instalado con `--runtime-path` o `ZCODE_HARNESS_RUNTIME_PATH`
- ZCode con sesión iniciada (el harness usa el login OAuth local de Z.AI; el
  puente **no gestiona credenciales** y redacta secretos en todas las salidas)

La ruta del proveedor incluido se resuelve desde el punto de entrada verificado,
no desde el directorio de trabajo. `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` no vacío
prevalece sobre `ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE` y, después, sobre el
archivo detectado. Solo se ajusta el entorno del hijo; se conserva
`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` y no se modifica el entorno padre. Una ruta
explícita de configuración base inválida falla sin sustitución. La materialización
nativa de la configuración sigue a cargo del proveedor; detalles en
[`docs/SECURITY.md`](docs/SECURITY.md).

## Instalación (Windows / PowerShell)

El instalador publicado y la configuración npm incluyen el puente compilado
e instalan sus dependencias. Para volver a compilarlo desde el código fuente,
sigue estos pasos; si ya tienes una copia del código,
omite el clon y entra en `mcp/zcode-harness-mcp`.

```powershell
cd $HOME
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git
cd ZCode-Agent-Kit\mcp\zcode-harness-mcp
npm install
npm run build
# comprobar la detección de runtime:
npm run probe:runtime
```

## Inicio rápido

### 1) Registrar como servidor MCP en un cliente MCP (stdio)

Configuración de ejemplo (p. ej. `claude_desktop_config.json` o `.mcp.json`):

```json
{
  "mcpServers": {
    "zcode-harness": {
      "command": "node",
      "args": [
        "C:\\path\\to\\zcode-agent-kit\\mcp\\zcode-harness-mcp\\dist\\index.js",
        "--stdio",
        "--allow-workspace", "C:\\Users\\<you>\\Projects",
        "--interaction-policy", "ask"
      ]
    }
  }
}
```

### 2) Modo Streamable-HTTP (varios clientes, activado explícitamente)

```powershell
node dist\index.js --http --http-key "<random-local-secret>" --host 127.0.0.1 --port 3322 --allow-workspace "C:\Users\<you>\Projects"
# Endpoint MCP: http://127.0.0.1:3322/mcp   (solo localhost; sin exposición pública)
```

### 3) Demo desde la perspectiva de otro agente

```powershell
# contra la instalación real:
node examples\demo-client.mjs --workspace "C:\Users\<you>\demo-workspace"
# offline contra el harness fixture:
node examples\demo-client.mjs --fixture
```

El cliente de demo muestra el flujo completo: descubrir capacidades → abrir
workspace → leer el catálogo real de modelos → comprobación de GLM-5.3-Flash
(sin cambio silencioso de modelo) → elegir el modelo y modo de sesión → iniciar una tarea →
consultar progreso → responder una pregunta de seguimiento → leer resultado +
artefactos → pedido de seguimiento en la misma sesión.

### 4) Tests

```powershell
npm test          # build + unitarios + integración (harness fixture, determinista)
$env:LIVE_TEST="1"; $env:LIVE_WORKSPACE="C:\path\to\workspace"; $env:LIVE_DATA_DIR="C:\path\to\data"
npm run test:live # habilitación explícita: instalación real y posible uso de cuota
```

## Flags de línea de comandos más importantes

| Flag | Significado |
| --- | --- |
| `--stdio` | MCP por stdin/stdout (por defecto) |
| `--http --http-key KEY --port N --host H` | Modo Streamable-HTTP con clave Bearer (por defecto 127.0.0.1:3322) |
| `--read-only` | las herramientas mutantes se rechazan (aplicado técnicamente, no solo anotado) |
| `--allow-workspace P` | liberar la raíz de un workspace (repetible; lista `;` vía `ZCODE_HARNESS_ALLOW_WORKSPACES`) |
| `--runtime-path P` | ruta explícita a `zcode.cjs` |
| `--data-dir D` | directorio de persistencia (por defecto `~/.zcode-harness-mcp`) |
| `--interaction-policy deny\|allowlist\|ask` | cómo se responden las peticiones de permiso (por defecto: `deny`) |
| `--interaction-allowlist "Read,Glob"` | nombres exactos para `allowlist` (shell denegado) |
| `--max-concurrent-tasks N` | paralelismo (por defecto 2; el exceso se encola) |

## Modelo de seguridad (versión corta)

- Allowlist de workspaces con resolución real de rutas (symlinks/junctions)
  para tasks **y** acceso de lectura a artefactos
- Modo read-only: las herramientas mutantes devuelven errores; el `readOnly`
  de una task aplica además, del lado del harness, modo plan + denylist de
  herramientas de escritura
- Redacción de secretos en todas las salidas de herramientas, logs y eventos;
  las credenciales nunca se exponen ni se gestionan
- Arranque de procesos solo con arrays de argumentos (`shell: false`),
  programa fijo (`node`), sin cadenas de shell
- Las preguntas de seguimiento (permisos/input de usuario) nunca se auto-expanden:
  política `deny` (por defecto), `allowlist` o `ask` con timeout → respuesta
  segura por defecto (deny)
- El puente no se registra en su propia runtime de ZCode, sin exposición
  pública de red, sin auto-instalación de plugins

Detalles: [`docs/SECURITY.md`](docs/SECURITY.md) · Límites honestos: [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)

## Estado

En 0.16.9, `workspace/readPresentation` solo devuelve la presentación, sin valores
predeterminados, catálogo ni revisión de ajustes. `zcode_models_list` crea y cierra
una sesión propia con persistencia diferida y sin prompt; puede inicializar servicios
de runtime y se rechaza con `--read-only`. Se admite la selección nativa de modelo,
modo y razonamiento por sesión. Los setters y el reset de valores persistentes del
workspace no están disponibles: se devuelve un error explícito, sin sustituto local.
Las preferencias de runtime afectan al proceso app-server compartido; su confirmación
no es una lectura independiente de verificación.

El catálogo nativo actual se verificó e incluye `zai-api/GLM-5.3-Flash`. Una solicitud
en Windows con ZCode 0.16.9 y razonamiento `low` fue bloqueada por el código `1113`
(saldo o paquete de recursos insuficiente); no se afirma una respuesta nativa. El éxito del proxy no demuestra éxito
del modelo por MCP. Las observaciones de 0.16.5 son históricas.

Estado actual de implementación y verificación: [`KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) · Evidencia de tests: [CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml) · Referencia de API: [`docs/MCP_API.md`](docs/MCP_API.md)

## Licencia

MIT. Los repositorios de referencia [zcode-acp](https://github.com/william0wang/zcode-acp) (Apache-2.0) y [zcode-open-bridge](https://github.com/tizerluo/zcode-open-bridge) (MIT) se investigaron como fuentes de protocolo (commits documentados en `docs/PROTOCOL.md`); código adoptado de ellos: ninguno.
