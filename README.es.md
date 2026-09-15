# ZCode Agent Kit (Español)

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)
![Release](https://img.shields.io/github/v/release/ZepiGit/ZCode-Agent-Kit)

[English](README.md) | [中文](README.zh-CN.md) | **Español** | [日本語](README.ja.md) | [Deutsch](README.de.md)

> Traducción del original en inglés; ante cualquier discrepancia manda el
> original en inglés.

Acceso a modelos desde tu propio agent harness usando **tu propia cuenta de
ZCode Desktop** — sin segunda suscripción ni compra de API. Diez adaptadores
de harness, un proxy local y rollback transparente.

```
tu harness (OMP / pi / Claude Code / Codex / OpenCode / Cline / Kilo Code /
            Aider / Continue / Goose / cualquier cliente MCP u OpenAI-/Anthropic-compatible)
        │
        ├─► proxy local zcode-proxy  http://127.0.0.1:8457 (formatos OpenAI + Anthropic + Responses)
        │         └─► zcode.z.ai (start-plan, la misma cuota que tu ZCode Desktop)
        │
        └─► zcode-harness-mcp (stdio) ──► tu ZCode Desktop instalado (sesiones reales de escritorio)
```

Modelos: **glm-5.3** (texto, contexto 1M) y **glm-5.3-flash** (texto+imagen,
contexto 1M); niveles de razonamiento verificados **low / high / max**
(por defecto max).

## Inicio rápido

**Windows (PowerShell)** — el instalador obtiene la última release, verificado
por SHA256, sin permisos de administrador:

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS / Linux**:

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

Los one-liners obtienen el instalador de la **última release publicada**; el
instalador resuelve esa release automáticamente (fija una versión con
`ZCODE_KIT_VERSION`, p. ej. `$env:ZCODE_KIT_VERSION = "v0.2.0"`). Descarga el
archivo de la release, verifica su checksum, instala a nivel de usuario (por
defecto `%LOCALAPPDATA%\zcode-agent-kit` o `~/.local/share/zcode-agent-kit`,
configurable con `ZCODE_KIT_HOME`), instala bun v1.4.2 localmente si falta y
ejecuta setup con detección de harnesses.

**npm / npx:**

```sh
npm install -g zcode-agent-kit
zcode-kit setup

# O sin instalación global:
npx --yes zcode-agent-kit setup
```

El paquete npm expone los comandos `zcode-kit` y `zcode-agent-kit`. Su paso de
postinstall ejecuta el mismo setup transaccional; volver a ejecutar `setup` es
seguro e idempotente. El uso con npm requiere **Node ≥ 20** y las dependencias
bun gestionadas por setup.

> El artefacto npm lo publica el mantenedor en cada release. Si `npm install`
> devuelve 404, esta versión aún no está en el registro npm — usa los
> instaladores de arriba o una build local: `npm install -g <repo>/pack/dist`.

## Primera ejecución, en orden

1. **Instala** (comandos de arriba). El setup detecta tus harnesses y solo
   toca esos — cada escritura queda en una transacción que puedes revertir.
2. **Una sesión iniciada**: ten ZCode Desktop instalado y con sesión
   iniciada; el setup importa esa credencial automáticamente (si no puede,
   imprime el comando de inicio de sesión único exacto).
3. **Comprueba**: `node cli\zcode-kit.mjs status` (¿proxy en marcha? ¿cuota?)
   y `node cli\zcode-kit.mjs doctor` (diagnóstico completo).
4. **Úsalo** — ver *Uso por harness* más abajo. El proxy se inicia bajo
   demanda: OMP lo autoinicia con su extensión y los wrappers del kit
   (`bin\zcode-claude`, `bin\zcode-codex`, `bin\zcode-aider` o
   `zcode-kit run ...`) lo aseguran antes de lanzar. Para todo lo demás
   (pi, Continue, Goose, clientes API directos), arráncalo una vez tú:
   `node proxy\zcode-proxy-manager.mjs start`
5. **Más tarde**: `zcode-kit update` actualiza, `zcode-kit rollback` deshace
   el último paso, `zcode-kit uninstall` elimina todo lo propiedad del kit.

**Desde un checkout del repositorio** (desarrollo o instalación manual):

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
cd zcode-agent-kit
$env:ZCODE_KIT_ALLOW_CHECKOUT = "1"     # consentimiento explícito: un checkout nunca debe volverse la raíz del provider en silencio
node setup.mjs                          # o: node cli\zcode-kit.mjs setup --harness auto
node cli\zcode-kit.mjs doctor
```

Requisitos: **Node ≥ 20** (bun solo hace falta para el checkout del repositorio;
el instalador trae el suyo) y **ZCode Desktop instalado y con sesión iniciada**
(la importación de credenciales usa tu inicio de sesión del escritorio; el puente
MCP necesita la app de escritorio *en ejecución* para las respuestas). Nunca se
requieren permisos de administrador. WSL se detecta y se rechaza: instala en el
host Windows.

## CLI zcode-kit

```
zcode-kit setup [--harness auto|omp,pi,...]   bootstrap + integrar harnesses detectados
zcode-kit integrate <harness> --dry-run       previsualizar exactamente qué se escribiría
zcode-kit integrate <harness>                 aplicar un adaptador (transaccional)
zcode-kit run <harness> -- <args>             lanzar claude-code/codex/aider/opencode con ZCode
zcode-kit doctor [--harness <id>] [--json]    diagnóstico legible por máquina
zcode-kit status                              estado del proxy + instantánea de cuota
zcode-kit models [--json] [--show-key]        modelos anunciados (del proxy en ejecución)
zcode-kit usage --json                        uso/cuota de la cuenta (nunca valores inventados)
zcode-kit auth status|login|logout            ciclo de vida de la credencial del proxy
zcode-kit update                              actualizar el checkout y reaplicar integraciones
zcode-kit rollback [tx-id]                    deshacer la última (o indicada) transacción
zcode-kit uninstall                           quitar las integraciones del kit
```

Toda escritura es transaccional: los archivos se hashean y respaldan antes, y
el rollback es consciente de la propiedad — los cambios posteriores del usuario
se informan como conflictos, nunca se sobrescriben.

## Comportamiento del setup

`setup --harness auto` detecta qué harnesses están instalados y **solo toca
esos** — un usuario solo-OMP no obtiene artefactos de Claude/Codex:

1. **bootstrap** — genera la clave local del proxy (`.proxykey`), crea
   `proxy/config.yaml` desde la plantilla, instala dependencias con
   `bun install --frozen-lockfile` (un fallo de instalación es un error duro) e
   importa la credencial de tu inicio de sesión existente de ZCode Desktop.
2. **diez adaptadores** (cada uno solo para harnesses detectados o solicitados
   explícitamente) — ver `harnesses/README.md` y `SUPPORT_MATRIX.json`.
3. **puente MCP** — registra el puente stdio `zcode-harness` solo con los
   harnesses presentes. El registro MCP solo nunca cuenta como integración de
   modelo (Cline/Kilo indican manual-confirmation-required).

En una máquina con solo OMP, se ejecuta exactamente un adaptador (OMP) más la
entrada MCP de OMP — no se crea nada de Claude ni Codex.

## Uso por harness

**OMP** (provider aditivo; integración TUI/CLI completa con niveles de thinking):

```bash
omp --model zcode/glm-5.3-flash --thinking low -p "hi"
omp --model zcode/glm-5.3 --thinking max
```

**pi** (`~/.pi/agent/models.json`, provider aditivo `zcode`):

```bash
pi --model zcode/glm-5.3
```

**Claude Code** (wrapper opcional; `~/.claude` intacto):

```bat
bin\zcode-claude.cmd -p "hi" --model glm-5.3-flash
```

**Codex CLI** (wrapper opcional, CODEX_HOME aislado):

```bat
bin\zcode-codex.cmd exec "say hi" -m glm-5.3-flash
```

**Aider / OpenCode / Goose** (los launchers solo fijan variables de entorno del
proceso):

```bat
node cli\zcode-kit.mjs run aider -- --model openai\glm-5.3-flash
node cli\zcode-kit.mjs run opencode -- .
goose session --provider zcode
```

**Cline / Kilo Code** (configurados por GUI): el kit escribe una hoja de
valores preparados en `generated/` y marca el paso
`manual-confirmation-required` — nunca toca el estado interno de VS Code.

**Otros clientes** (formatos OpenAI / Anthropic / Responses en
`http://127.0.0.1:8457`, token Bearer = contenido de `.proxykey`):
ver `harnesses/README.md`.

## Gestión del proxy

```bat
node proxy\zcode-proxy-manager.mjs status
node proxy\zcode-proxy-manager.mjs start
node proxy\zcode-proxy-manager.mjs stop
node proxy\zcode-proxy-manager.mjs restart
node proxy\zcode-proxy-manager.mjs doctor
node proxy\zcode-proxy-manager.mjs logs 50
```

Propiedades de seguridad: solo escucha en 127.0.0.1; comprobaciones de salud e
identidad autenticadas; stop fail-closed (un proceso no verificable o ajeno en
el puerto **nunca** se mata; la reutilización de PID se detecta por el tiempo de
inicio del proceso); bloqueo contra arranques paralelos; apagado graceful-then-
forced; rotación y lectura acotada de logs; canales de claim de pruebas y
off-peak deshabilitados. `doctor` separa la validez real de autenticación de la
edad del JWT y solo comprueba los componentes presentes.

## Política de seguridad y automatización

Dicho sin rodeos, para que puedas decidir si esta herramienta es para ti:

- **Gestión de CAPTCHA.** El gateway de z.ai sirve páginas de desafío como
  parte de su protocolo normal de cliente — la app oficial ZCode Desktop las
  responde de forma automática e invisible. El proxy incluido reproduce
  exactamente ese comportamiento para **tu propia cuenta iniciada sesión**:
  resuelve los desafíos del gateway igual que el cliente oficial. No se
  elude ninguna barrera de verificación humana (nunca hay un humano que los
  resuelva), no se toca ninguna otra cuenta y no hay granjas de CAPTCHA ni
  resolutores de terceros.
- **Sin automatización de pruebas.** La reclamación automática de trials y
  la programación off-peak no existen en ninguna configuración distribuida
  por el kit, y desde la remediación de la auditoría los valores por defecto
  subyacentes son fail-closed (`false`): una configuración que omita o
  trunque el bloque claim NO activa la reclamación. Activarlo exige un
  `claim.enabled: true` explícito en tu propia configuración.
- **Alcance MCP.** El puente `zcode-harness` se registra deliberadamente a
  **nivel de usuario**: es una integración de toda la máquina, no por
  proyecto. Deshacerlo es un comando (`claude mcp remove zcode-harness
  --scope user`), y el puente nunca responde peticiones no autenticadas ni
  fuera de loopback.
- **Impuesto en código, no solo por plantilla** (remediación de auditoría):
  el proxy se niega a enlazar algo que no sea loopback y se niega a servir
  sin una clave bearer real; los adaptadores se niegan a sobrescribir
  entradas de provider que no les pertenecen; setup se niega a escribir
  configuraciones de usuario desde un checkout de código fuente.

## Renovación de inicio de sesión

```bash
cd zcode-proxy-src
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai --import
# o inicio de sesión por navegador:
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai
```

## Desinstalar / rollback

```bat
node cli\zcode-kit.mjs rollback      :: deshacer la última transacción (un paso por ejecución)
node cli\zcode-kit.mjs uninstall     :: revertir todo lo del kit y borrar generated/
node proxy\zcode-proxy-manager.mjs stop
```

`uninstall` nunca borra `~/.zcode-proxy/credentials.json` (compartida) ni tu
sesión o datos de ZCode Desktop. `zcode-kit auth logout` elimina solo la
credencial almacenada del propio proxy y lo indica.

## Actualizar

`zcode-kit update` se niega con el árbol sucio, solo avanza fast-forward (nunca
fuerza) y reaplica las integraciones de forma transaccional. El proxy incluido
está fijado (ver `MANIFEST.md`); los parches locales viven en `patches/`.

## Pruebas

```bat
npm run test          :: suite del kit (node --test): transacciones, seguridad del manager, adaptadores
npm run test:proxy    :: 872 pruebas bun incl. tests de contrato de protocolo (límites SSE, tool args, abort)
npm run test:mcp      :: suite del puente MCP (42 pruebas incl. gates de auth/origin HTTP, escapes de allowlist)
```

## Documentos

- `SUPPORT_MATRIX.json` — estado real por adaptador
- `EFFORT_MAPPING.md` / `.json` — cómo low/high/max se mapean a parámetros upstream
- `SETUP_REPORT.md`, `TEST_REPORT.md` — evidencia de pruebas con comandos exactos
- `IMPLEMENTATION_STATUS.md` — decisiones y puntos abiertos
- `harnesses/README.md` — detalles por harness y fragmentos de integración manual
- `MANIFEST.md` — componentes vendidos, commits, licencias
- `docs/RELEASE_CHECKLIST.md` — preparado vs. pendiente para publicar
