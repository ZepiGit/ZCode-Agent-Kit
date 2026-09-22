# ZCode Agent Kit
[English (original)](README.md) · [Deutsch](README.de.md) · **Español** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

Usa tu cuenta de ZCode con el asistente de programación que ya utilizas.

![ZCode Desktop conectado a asistentes de programación mediante Agent Kit](zcode_agent_kit.png)

*El kit se ejecuta localmente; las solicitudes a los modelos se envían a ZCode.*

Conserva tu asistente de programación. Usa tus modelos y tu cuota de ZCode mediante una conexión local.

**Rotación de cuentas opcional:** El instalador pregunta **"Do you want to activate the Account Rotator feature? [y/n]"**. Si respondes `y`, se importa la sesión actual y los inicios de sesión posteriores con `zcode-kit auth login zai` se guardan como cuentas adicionales. Volver a iniciar sesión en la misma cuenta actualiza su registro. Puedes activarla más adelante con `zcode-kit accounts enable` y consultar las cuentas guardadas con `zcode-kit accounts`. Consulta la [documentación de Account Rotator (en alemán)](docs/ACCOUNT_ROTATOR.md).

**El recorrido:** preparar tu cuenta → instalar el kit → usar GLM-5.3(-flash) y empezar a trabajar.

## Paso 1 — Comprueba los requisitos

- [ZCode Desktop](https://zcode.z.ai/en), con sesión iniciada en tu propia cuenta y cuota disponible para los modelos.
- [Node.js 20 o posterior](https://nodejs.org/). Compruébalo con `node --version` en una terminal nueva.
- Un asistente de programación instalado por separado. El kit lo conecta a ZCode.


## Paso 2 — Instala el kit una vez

Elige el instalador de la versión publicada o npm. El instalador configura automáticamente los asistentes detectados, por lo que no hace falta ejecutar otro comando de configuración después.

El instalador muestra cuatro etapas numeradas, resultados breves por asistente y una prueba de conexión. El resultado detallado de la configuración se guarda en el `install.log` indicado; usa `ZCODE_KIT_VERBOSE=1` para ver todo o `NO_COLOR=1` para texto sin formato. La instalación interactiva requiere responder `y` o `n` a la pregunta de Account Rotator. Para instalaciones no interactivas, establece `ZCODE_KIT_ACCOUNT_ROTATOR=y` o `n`; sin una respuesta explícita, se conserva la configuración existente. Si falla la prueba de conexión, seguirá siendo una advertencia aunque la instalación haya terminado correctamente.

> **Antes de ejecutar el instalador:** descarga y ejecuta un script, modifica la configuración de los asistentes detectados y puede registrar herramientas MCP. La configuración también intenta hacer una pequeña solicitud al modelo que puede consumir cuota. Los cambios quedan registrados, pero un fallo posterior puede dejar en vigor cambios anteriores. Inspecciona el instalador si lo exige tu política de seguridad.

**Windows — PowerShell, sin permisos de administrador:**

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS / Linux — terminal POSIX:**

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

Puedes ejecutarlo desde cualquier directorio; no necesitas clonar el repositorio. El instalador realiza la configuración y puede instalar Bun si falta. En Windows usa PowerShell, no Git Bash ni WSL.

<details>
<summary>Ubicación de instalación y requisitos de macOS/Linux</summary>

Ubicaciones predeterminadas: `%LOCALAPPDATA%\zcode-agent-kit` en Windows; `$HOME/.local/share/zcode-agent-kit` en macOS/Linux. Mantén esta carpeta separada de tus proyectos. No uses tu carpeta personal ni una copia del código fuente como destino: las actualizaciones sustituyen los archivos del directorio elegido.

macOS/Linux también necesitan `curl`, `tar` y una utilidad SHA-256; para instalar Bun hace falta `unzip` y para actualizar, `rsync`. Las pruebas actuales con clientes reales se centran en Windows; consulta la [matriz de compatibilidad](SUPPORT_MATRIX.json), que incluye fechas.

</details>

**Alternativa — npm (Windows, macOS y Linux):**

Requiere Node.js 20+ y [Bun](https://bun.sh/docs/installation) ya instalados y disponibles en la terminal (`bun --version`; probado con Bun 1.4.2).

```sh
npm install -g zcode-agent-kit@latest
zcode-kit setup --harness auto --installer
```

npm instala los comandos `zcode-kit` y `zcode-agent-kit`. El segundo instala las dependencias del kit, configura los asistentes detectados y plantea la pregunta y/n de Account Rotator. Ejecútalo después de instalar el paquete de npm. Usa un solo método de instalación para que el comando, la configuración y el proxy pertenezcan a la misma copia del kit.

## Paso 3 — Usa GLM-5.3(-flash) en el asistente que prefieras

Abre una terminal nueva y ejecuta `zcode-kit help`. Luego abre una terminal **dentro de tu propio proyecto**, no en la carpeta del kit. Elige el asistente que instalaste:

**OMP:**

```sh
omp -p --model zcode/glm-5.3-flash "Reply with ok"
```

**Claude Code:**

```sh
zcode-kit run claude-code -- -p "Reply with ok" --model glm-5.3-flash
```

**Codex:**

```sh
zcode-kit run codex -- exec "Reply with ok" -m glm-5.3-flash
```

Estos comandos inician o comprueban el proxy automáticamente. Una respuesta `ok` confirma que la primera solicitud al modelo funcionó. Un mensaje de configuración correcta, por sí solo, no lo confirma.

**¿Recibiste la respuesta?** Tu cuenta, el proxy y el asistente elegido funcionaron juntos para esa solicitud. Ya puedes usar ese asistente en tu proyecto.

**¿No hubo respuesta?** Usa las comprobaciones de «Ayuda»; reinstalar no solucionará una cuota agotada.

## Paso 4 — Trabaja en tu proyecto

Para una sesión interactiva de OMP:

```sh
omp --model zcode/glm-5.3
```

Para una sesión interactiva de Claude Code:

```sh
zcode-kit run claude-code -- --model glm-5.3
```

Elige `glm-5.3` para texto o `glm-5.3-flash` para texto e imágenes. La compatibilidad con imágenes también depende del asistente. Un puente MCP opcional ofrece herramientas de la instalación local de ZCode; registrar el puente no equivale a conectar un modelo.

<details>
<summary>Otros asistentes y límites de integración</summary>

| Asistente | Qué hacer después de la configuración |
| --- | --- |
| OpenCode | Ejecuta `zcode-kit run opencode -- .` y selecciona un modelo de ZCode. |
| Aider | Ejecuta `zcode-kit run aider -- --model openai/glm-5.3-flash`. |
| pi | Inicia el proxy manualmente y ejecuta `pi --model zcode/glm-5.3`. |
| Goose | Inicia el proxy manualmente y ejecuta `goose session --provider zcode`. |
| Continue | Primero abre/configura Continue. Ejecuta `zcode-kit integrate continue`, inicia el proxy y elige el modelo en la interfaz. |
| Cline / Kilo Code | Copia los valores generados a la interfaz de la extensión e inicia el proxy. La configuración crea `generated/cline-zcode-values.md` o `generated/kilo-zcode-values.md` dentro de una instalación de la versión publicada. |

Ejecuta OMP directamente, sin `zcode-kit run`. Solo Claude Code, Codex, Aider y OpenCode tienen lanzadores del kit. Codex usa un perfil aislado: tus ajustes y skills habituales no se transfieren automáticamente. La integración con Claude Code es una solución de compatibilidad de la comunidad. Tener un adaptador no garantiza que cada cliente o versión se haya probado en vivo.

Consulta la [documentación de los asistentes](harnesses/README.es.md) y la [matriz de compatibilidad](SUPPORT_MATRIX.json).

</details>

<details>
<summary>Iniciar o detener el proxy manualmente</summary>

Solo para la ubicación predeterminada del **instalador de la versión publicada**:

**PowerShell:**

```powershell
node (Join-Path $env:LOCALAPPDATA 'zcode-agent-kit/proxy/zcode-proxy-manager.mjs') start
```

**macOS/Linux:**

```sh
node "$HOME/.local/share/zcode-agent-kit/proxy/zcode-proxy-manager.mjs" start
```

Sustituye `start` por `status`, `logs 50` o `stop` según corresponda. Detenerlo interrumpe los clientes conectados. Para una ubicación personalizada, usa la ruta absoluta de esa instalación. Estas rutas predeterminadas no corresponden a instalaciones de npm.

</details>

## Ayuda

```sh
zcode-kit doctor
zcode-kit auth status
```

- **No se encuentra el comando:** vuelve a abrir la terminal. En instalaciones de una versión publicada, comprueba que `%LOCALAPPDATA%\Microsoft\WindowsApps` (Windows) o `$HOME/.local/bin` (macOS/Linux) esté en PATH.
- **No responde el modelo:** comprueba la sesión de Desktop y la cuota disponible. Inicia el proxy si tu asistente no lo hace. Una comprobación de salud local no demuestra acceso al modelo.
- **401 o puerto ocupado:** comprueba si existe otra instalación del kit. No borres claves ni termines un proceso que no reconoces.
- **La configuración falló a medias:** lee el comando de rollback mostrado antes de volver a intentarlo. Es posible que queden cambios anteriores.

## Antes de usar datos reales del proyecto

Mantén el proxy en localhost y no compartas `.proxykey`, las credenciales ni los archivos de configuración generados.

**Lee la [política de seguridad (en alemán)](SECURITY.md):** el proxy gestionado puede ejecutar JavaScript CAPTCHA del proveedor sin un entorno aislado del sistema operativo. Sigue limitado a loopback y protegido por clave bearer, pero estas medidas no aíslan el proceso. Esto no elude restricciones de cuentas ni garantiza que todos los desafíos se resuelvan.

<details>
<summary>Actualizar o eliminar el kit</summary>

**Actualizar:**

- Instalación de versión publicada: vuelve a ejecutar el mismo instalador con el mismo destino específico. Elimina una fijación anterior de `ZCODE_KIT_VERSION` si quieres la versión más reciente.
- Instalación npm: ejecuta `npm install -g zcode-agent-kit@latest` y después `zcode-kit setup --harness auto --installer` desde esa instalación npm.

Conserva el mismo método de instalación al actualizar.

**Quitar integraciones:** detén tu proxy con `stop` mediante el comando de gestión anterior y ejecuta `zcode-kit uninstall`. Se conservan la carpeta de instalación, dependencias, registros, claves del proxy y credenciales compartidas; la sesión de Desktop sigue iniciada. Inspecciona los archivos restantes antes de borrar nada.

Si instalaste mediante npm, elimina después el paquete global con `npm uninstall -g zcode-agent-kit`.

</details>

## Más información

[Guías de asistentes](harnesses/README.es.md) · [Matriz de compatibilidad](SUPPORT_MATRIX.json) · [Seguridad](SECURITY.md) · [Informar de un problema](https://github.com/ZepiGit/ZCode-Agent-Kit/issues) · [Licencias y componentes incluidos](MANIFEST.md)
