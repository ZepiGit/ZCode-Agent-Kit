# ZCode Agent Kit

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)

[English](README.md) | [中文](README.zh-CN.md) | **Español** | [日本語](README.ja.md) | [Deutsch](README.de.md)

Usa **tu propia cuenta de ZCode Desktop** con tu asistente de programación preferido. El kit conecta asistentes compatibles mediante un proxy local; no instala los asistentes, crea cuentas, compra cuota ni ofrece acceso gratuito o ilimitado.

- **Proxy de modelos:** formatos OpenAI Chat Completions, Responses y Anthropic Messages; dirección predeterminada `http://127.0.0.1:8457`.
- **Modelos:** `glm-5.3` (texto) y `glm-5.3-flash` (texto e imágenes); contexto anunciado de 1M tokens y razonamiento `low`, `high`, `max`. Siguen aplicándose la compatibilidad del cliente y los límites de la cuenta.
- **Puente MCP opcional:** permite operar el runtime ZCode instalado. Es independiente de la configuración del proveedor de modelos y necesita Desktop ejecutándose para sus llamadas a modelos.

> **Código y versión publicada, comprobados el 16-09-2026:** GitHub ofrece **v0.2.2** y npm **0.2.1**. El código integrado contiene correcciones más recientes de Continue, recuperación de credenciales, `doctor --fix` e instaladores que esos paquetes **todavía no incluyen por completo**. Descargar “latest” no instala una rama Git. Esta guía describe el código actual salvo cuando indica instalación de una versión publicada. Consulta las [notas de versión](https://github.com/ZepiGit/ZCode-Agent-Kit/releases); que un CLI antiguo acepte una opción no demuestra que la implemente.

## 1. Requisitos

1. **ZCode Desktop**, con tu sesión iniciada y cuota disponible.
2. **Node.js 20 o posterior** en PATH: [nodejs.org](https://nodejs.org/).
3. **Bun en un PATH persistente**: [instalación de Bun](https://bun.sh/docs/installation); versión probada **1.4.2**. Setup de npm/código utiliza Bun para instalar dependencias, no instala el propio Bun.
4. El asistente instalado por separado: OMP, pi, Claude Code, Codex, OpenCode, Cline, Kilo Code, Aider, Continue o Goose.

Abre una **terminal nueva**:

```sh
node --version
bun --version
```

Sirve tanto en PowerShell como en shells POSIX. Si falta un comando, corrige PATH antes de seguir. Los instaladores publicados pueden descargar Bun, pero su modificación de PATH **no persiste**: una nueva terminal Windows la pierde y `curl | sh` no puede modificar el shell padre. Si Bun ya existe, se reutiliza sin actualizarlo automáticamente.

**Windows:** PowerShell sin permisos de administrador; no ejecutes `install.sh` en Git Bash ni WSL. **macOS/Linux:** shell POSIX con `curl`, `tar`, herramienta SHA-256 y `rsync` para actualizaciones; instalar Bun también requiere `unzip`. Las comprobaciones Windows indicadas abajo no son una nueva validación de clientes reales Linux/macOS.

## 2. Instalar una vez: elegir un método

Evita mezclar instalaciones npm y del instalador: pueden tener claves diferentes aunque modifiquen el mismo perfil de asistente.

### Recomendado: instalador de una versión publicada

Desde **cualquier directorio**, sin clonar el repositorio ni entrar en la carpeta del kit. Estos comandos descargan y ejecutan el instalador publicado; inspecciónalo antes si tu política lo exige.

**Windows — PowerShell:**

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS/Linux — POSIX:**

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

El instalador verifica el SHA-256 del archivo, instala localmente y ejecuta setup.

| Sistema | Directorio del kit | Acceso al comando |
|---|---|---|
| Windows | `%LOCALAPPDATA%\zcode-agent-kit` | `%LOCALAPPDATA%\Microsoft\WindowsApps\zcode-kit.cmd` |
| macOS/Linux | `$HOME/.local/share/zcode-agent-kit` | `$HOME/.local/bin/zcode-kit` |

`ZCODE_KIT_INSTALL_DIR` tiene prioridad sobre `ZCODE_KIT_HOME`; después se usa el valor predeterminado. **Elige una carpeta exclusiva con ruta absoluta, nunca tu home, proyecto o checkout:** las actualizaciones reemplazan/sincronizan sus archivos. Estas variables eligen el destino del instalador, no redirigen un CLI ya instalado.

Para fijar una versión, define `ZCODE_KIT_VERSION` con un tag publicado que incluya `v` antes de ejecutar el instalador. Quita la variable para volver a latest. Esto fija el archivo de distribución, pero los comandos anteriores siguen descargando el script del último release.

### Alternativa: npm

Requiere Node y Bun en PATH. Desde cualquier directorio:

```sh
npm install -g zcode-agent-kit
zcode-kit setup
```

En el código actual postinstall solo muestra una indicación; setup explícito configura la integración. Paquetes publicados antiguos pueden comportarse de otra manera. npm expone `zcode-kit` y `zcode-agent-kit`. Un 404 puede indicar paquete/versión no disponible o sin acceso; no demuestra un fallo local.

No uses un `npx ... setup` transitorio como instalación permanente: las configuraciones generadas apuntan a la ubicación del paquete. Usa una instalación global estable o el instalador.

## 3. Confirmar qué instalación ejecutas

Abre otra terminal después de instalar.

**PowerShell:**

```powershell
Get-Command zcode-kit -All
node --version
bun --version
zcode-kit help
```

**macOS/Linux:**

```sh
command -v zcode-kit
node --version
bun --version
zcode-kit help
```

Si falta `zcode-kit`, añade a tu PATH el directorio del acceso indicado arriba y vuelve a abrir la terminal. Si existen varias copias, usa la **ruta explícita** de abajo. PowerShell y Git Bash pueden seleccionar copias diferentes en Windows.

### Rutas explícitas: funcionan desde cualquier directorio

Define una vez por terminal la ruta de la **instalación elegida**. Estos valores corresponden al instalador de releases, **no a npm**; cambia la asignación para un destino personalizado o checkout.

**PowerShell:**

```powershell
$KitRoot = Join-Path $env:LOCALAPPDATA 'zcode-agent-kit'
if (-not (Test-Path (Join-Path $KitRoot 'cli/zcode-kit.mjs'))) { throw 'Wrong KitRoot: cli/zcode-kit.mjs not found' }
node (Join-Path $KitRoot 'cli/zcode-kit.mjs') help
```

**macOS/Linux:**

```sh
KIT_ROOT="$HOME/.local/share/zcode-agent-kit"
if [ -f "$KIT_ROOT/cli/zcode-kit.mjs" ]; then
  node "$KIT_ROOT/cli/zcode-kit.mjs" help
else
  printf '%s\n' 'Wrong KIT_ROOT: cli/zcode-kit.mjs not found' >&2
fi
```

Si falla, detente y corrige la ruta. Para npm, `npm root -g` muestra el directorio global de módulos; el kit está en su subdirectorio `zcode-agent-kit`. No uses la ruta del instalador para una copia npm.

**No ejecutes `node cli/zcode-kit.mjs` desde un directorio cualquiera.** Las rutas relativas parten del directorio actual, no del kit. El comando global o una ruta absoluta evita el error.

## 4. Configurar y realizar la primera llamada

Setup detecta ejecutables/directorios de configuración y aplica adaptadores. Detectar algo no demuestra que el cliente esté instalado correctamente o funcione. Para seleccionar un asistente o previsualizar cambios:

```sh
zcode-kit setup --harness omp
zcode-kit integrate continue --dry-run
```

Antes, confirma la copia según la sección 3. Setup puede modificar configuración de usuario y registros MCP. Registra transacciones, pero **no es una operación todo-o-nada**: si falla después, conserva cambios anteriores y muestra cómo revertirlos.

El setup actual también intenta una llamada Flash pequeña que puede consumir cuota. Define `ZCODE_KIT_SKIP_SMOKE=1` para omitirla en esa ejecución; CI/test también la omiten. Un fallo del smoke no revierte la configuración. `doctor --fix` no instala dependencias ni sustituye un setup completo.

```sh
zcode-kit status
zcode-kit doctor
zcode-kit auth status
zcode-kit usage --json
```

Si el proxy aún está detenido, las comprobaciones pueden fallar. Inícialo según la sección 6 o con un asistente que lo arranque automáticamente. **Un health-check o código de salida no demuestra acceso al modelo:** revisa `logged_in`, cuota y una respuesta real.

### Ejecutar asistentes en tu proyecto, no dentro del kit

Abre la terminal **en el proyecto que debe editar el asistente**, o entra con `Set-Location` en PowerShell / `cd` en POSIX. Los launchers conservan ese directorio de trabajo.

**OMP directamente, no `zcode-kit run omp`:**

```sh
omp -p --model zcode/glm-5.3-flash "Reply with 52"
omp -p --model zcode/glm-5.3 "Reply with 52"
```

Resultado esperado: `52`, salida 0. La latencia varía; un timeout sigue siendo un intento fallido. Uso interactivo:

```sh
omp --model zcode/glm-5.3 --thinking max
```

**Otros launchers del kit:** los argumentos después de `--` se pasan al asistente.

```sh
zcode-kit run claude-code -- -p "Reply with 52" --model glm-5.3-flash
zcode-kit run codex -- exec "Reply with 52" -m glm-5.3-flash
zcode-kit run aider -- --model openai/glm-5.3-flash
zcode-kit run opencode -- .
```

Los identificadores usan `/` incluso en Windows. `run` admite **solo** `claude-code`, `codex`, `aider`, `opencode`. La extensión OMP y esos launchers comprueban/inician el proxy; otros clientes necesitan arranque manual.

## 5. Función de cada integración

| ID | Configuración / uso |
|---|---|
| `omp` | Añade proveedor, modelos, extensión de arranque y entrada MCP opcional; ejecutar `omp` directamente. |
| `pi` | Añade `zcode` en `~/.pi/agent/models.json`; iniciar proxy y luego `pi --model zcode/glm-5.3`. |
| `claude-code` | Ajustes generados y launcher opcional; no reemplaza ajustes habituales de modelos Claude. Setup puede registrar MCP a nivel de usuario. Modelos ajenos a Claude: compatibilidad comunitaria. |
| `codex` | `CODEX_HOME` aislado en `generated/codex-home`; configuración y skills personales no se heredan automáticamente. |
| `opencode` | Añade proveedor; `zcode-kit run opencode -- .` suministra la clave solo al proceso. |
| `aider` | Entorno generado y launcher; al pasar otros argumentos, indica `--model openai/glm-5.3-flash`. |
| `continue` | Modifica una `~/.continue/config.yaml` **existente**; si falta, omite. Abre/configura Continue, reintegra y selecciona el modelo en su UI. |
| `goose` | Archivo persistente de proveedor personalizado con helper de clave; iniciar proxy y luego `goose session --provider zcode`. |
| `cline` | Genera `generated/cline-zcode-values.md`; introducir valores manualmente en la UI. |
| `kilo-code` | Genera `generated/kilo-zcode-values.md`; introducir valores manualmente en la UI. |

Diez adaptadores no equivalen a diez clientes probados en vivo. Consulta [matriz fechada](SUPPORT_MATRIX.json) e [informe](TEST_REPORT.md). En Cline/Kilo un check confirma la hoja de valores, **no** la configuración GUI completa. Registrar MCP no es acceso al modelo.

**Continue actual:** admite `models: []`, comentarios y sangrías de listas de bloque, conserva modelos/defaults del usuario primero. Rechaza listas inline no vacías, claves duplicadas y formas inseguras. Guarda la clave local entre comillas en YAML; `${ZCODE_PROXY_KEY}` no es interpolación válida de Continue. Tras rotación, reintegra o usa la reparación compatible. No se afirma prueba nativa de Continue en vivo.

## 6. Arrancar, inspeccionar o detener el proxy

Usa la variable raíz de la sección 3; puedes permanecer en tu proyecto.

**PowerShell:**

```powershell
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') start
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') status
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') logs 50
```

**macOS/Linux:**

```sh
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" start
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" status
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" logs 50
```

Sustituye `status` por `doctor`, `stop` o `restart`. **Stop/restart interrumpe los clientes conectados.** No mates un proceso solo por ocupar 8457. El gestor rechaza procesos ajenos/no verificables y comprueba identidad e inicio del proceso propio antes de detenerlo. No roba automáticamente bloqueos antiguos.

## 7. Problemas y autorreparación limitada

| Síntoma | Comprobar / actuar |
|---|---|
| Falta `zcode-kit`, `node` o `bun` | PATH en terminal nueva; para el kit usa ruta absoluta. Setup npm/código no instala Bun. |
| `Cannot find module .../cli/zcode-kit.mjs` | Ruta relativa desde directorio incorrecto o raíz equivocada. Corrige ruta absoluta; no copies scripts al proyecto. |
| Setup falla con Continue `models: []` | Versiones antiguas no incluyen el arreglo. Usa una que lo incluya o instala código conscientemente; no dupliques la clave `models`. |
| Comando desconocido / `run` no compatible | Ejecuta OMP/pi/Goose directamente; solo cuatro launchers admiten `run`. |
| `foreign`, puerto ocupado, HTTP 401 | Revisa copias y resolución del comando. No borres claves, robes locks ni mates listeners. Diagnostica la copia deseada. |
| Auth `3012` / `logged_in: false` | Revisa sesión Desktop; el código actual intenta renovarla de forma limitada. Login deliberado: `zcode-kit auth login`. |
| Cuota/saldo `1113` / `3001` | Revisa cuenta/plan; reiniciar o reparar localmente no repone saldo. |
| Fallo después de varios pasos de setup | Pueden quedar cambios; examina transacción y comando rollback mostrado. |
| `doctor --fix` repara pero sale con 1 | Proxy parado o paso manual pendiente; lee cada comprobación. |
| `models --json` funciona con proxy parado | Puede venir del registro; revisa `source`. No prueba inferencia. |

Reparación gestionada del código actual:

```sh
zcode-kit doctor --harness continue --json
zcode-kit doctor --fix --harness continue
```

Reaplica adaptadores seleccionados bajo bloqueo. Alinear claves offline requiere plantilla inequívoca y puerto reservable; rechaza configuración personalizada/corrupta o puerto ocupado. Claves coincidentes no requieren reescritura. El fallo de reparación revierte los archivos registrados; setup normal conserva cambios parciales. Credenciales, dependencias y registros externos no están cubiertos completamente por rollback.

El preflight advierte de cuota/auth upstream para permitir recuperación en la llamada de modelo; identidad/arranque local fallidos bloquean el launcher. OMP guarda health local 60 segundos y espera un minuto tras fallo. No consulta cuota cada turno. `logs/heal.log` es limitado y usa categorías fijas.

Se recargan credenciales por petición. Datos corruptos/parciales conservan el último valor válido; ausencia del almacén lo limpia al recargar. Algunos fallos antes de emitir respuesta pueden importar la sesión Desktop **existente** y reenviar una vez solo si cambia la credencial efectiva. No modifica Desktop, crea API keys, compra cuota ni reclama trials; no reproduce errores SSE en curso. Intentos y persistencia son limitados, sin éxito garantizado. Véase [SECURITY.md](SECURITY.md) para concurrencia y límites por proceso.

## 8. Actualizar, revertir y desinstalar

**Mantén el método original:**

- Instalador: repetir con el mismo destino exclusivo; instala archivos publicados, no cambios Git inéditos. Quita pins antiguos.
- npm: `npm install -g zcode-agent-kit@latest`, seguido de `zcode-kit setup` de la misma copia npm.
- Checkout: `node cli/zcode-kit.mjs update` **desde su raíz**, árbol limpio, solo fast-forward y reaplicación setup. No selecciona tags de release. Instalaciones sin `.git` lo rechazan.

Rollback registrado:

```sh
zcode-kit rollback
```

Sin ID selecciona la última transacción; una ID mostrada permite elegir otra. Cambios posteriores del usuario producen conflictos. No presupongas reversión total de credenciales, dependencias o acciones externas.

Primero detén el proxy correcto mediante la **ruta absoluta del gestor** de la sección 6. Después:

```sh
zcode-kit uninstall
```

No detiene el proxy por sí solo ni elimina directorio de instalación, dependencias, logs, `.proxykey`, credenciales compartidas o datos Desktop. Quita integraciones registradas, archivos generados y acceso del instalador coincidente. Para npm, **después** ejecuta `npm uninstall -g zcode-agent-kit`. Inspecciona restos antes de borrarlos.

`zcode-kit auth logout` explica la ruta efectiva; `zcode-kit auth logout --yes` la elimina, respetando `ZCODE_PROXY_CREDENTIALS_PATH`. No cierra Desktop ni revoca tokens upstream. No uses logout como reparación rutinaria.

## 9. Instalar desde código y desarrollar — avanzado

Solo si necesitas conscientemente el código actual. Instala Node, Bun y Git. Clona en una **carpeta nueva y exclusiva**, no en el proyecto que editará el asistente. No ejecutes un instalador de releases sobre el checkout.

**PowerShell:**

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
if ($LASTEXITCODE -ne 0) { throw 'Clone failed; stop here' }
Set-Location zcode-agent-kit -ErrorAction Stop
$env:ZCODE_KIT_ALLOW_CHECKOUT = '1'
try { node cli/zcode-kit.mjs setup --harness omp }
finally { Remove-Item Env:ZCODE_KIT_ALLOW_CHECKOUT -ErrorAction SilentlyContinue }
```

**macOS/Linux:**

```sh
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit &&
cd zcode-agent-kit &&
ZCODE_KIT_ALLOW_CHECKOUT=1 node cli/zcode-kit.mjs setup --harness omp
```

Continúa solo si clonación y cambio de directorio funcionaron; no ejecutes líneas posteriores tras un error. El ejemplo limita a `omp`; elige tu asistente o `auto`. El consentimiento evita vincular perfiles accidentalmente a otra copia. Setup del checkout no crea un comando global: utiliza luego su ruta absoluta. No muevas el checkout, porque las integraciones lo referencian; vuelve al **proyecto de trabajo** antes de iniciar asistentes.

Ejecuta pruebas **desde la raíz del checkout**, tras instalar dependencias proxy/MCP. Generan fixtures/builds; para aislamiento estricto usa una copia desechable.

```sh
npm run test
npm run test:proxy
npm run test:mcp
```

Validación fechada en [TEST_REPORT.md](TEST_REPORT.md): 150 pruebas kit aprobadas y un live opt-in omitido, 946 proxy y 42 MCP aprobadas. OMP real aislado cubrió arranque normal, caída del proxy propio y reparación de claves offline; conserva un timeout inicial y su repetición exitosa. No demuestra todos los clientes/plataformas/casos prolongados ni el contenido del último paquete publicado. Los fallos posteriores de portabilidad CI son separados del resultado local; consulta badge y logs actuales.

Mantenedores: push a `main`, tag `v*` o dispatch puede activar publicación. La selección de versión consulta npm/tags para no reutilizar artefactos de otro commit; el retry de versión inédita es condicional. Siguen aplicándose pruebas, controles de paquete/versión, OIDC y redistribución. Consulta [checklist](docs/RELEASE_CHECKLIST.md): pruebas locales verdes no significan publicación npm exitosa.

## Seguridad y documentación

Usa solo tu cuenta autorizada. Protege `.proxykey`, ajustes/env generados y perfiles; nunca pegues su contenido en issues. Proxy solo loopback y autenticado con bearer. Las respuestas a desafíos del gateway pertenecen al protocolo incluido; no garantizan aprobación del proveedor ni compatibilidad futura. Trials automáticos y off-peak están desactivados por defecto. Lee [SECURITY.md](SECURITY.md) antes de cambiarlos o exponer endpoints.

- [Detalles de asistentes](harnesses/README.md) y [matriz de soporte](SUPPORT_MATRIX.json)
- [Niveles de razonamiento](EFFORT_MAPPING.md)
- [Pruebas](TEST_REPORT.md) y [estado de implementación](IMPLEMENTATION_STATUS.md)
- [Componentes incluidos y licencias](MANIFEST.md)
- [Checklist de publicación](docs/RELEASE_CHECKLIST.md)
