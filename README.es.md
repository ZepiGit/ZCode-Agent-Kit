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

> **Árbol de trabajo (2026-09-15):** Los cambios de reparación/recuperación y
> postinstall describen código local, no una release publicada verificada.
> Validación final pendiente; no se afirma reparar la instalación personal existente.

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
postinstall solo muestra una indicación: **no** instala el runtime ni modifica
la configuración de los harnesses. Ejecuta `zcode-kit setup` explícitamente.
Setup está diseñado para ser idempotente. npm requiere **Node ≥ 20**; setup
instala o verifica las dependencias bun fijadas.

> El artefacto npm lo publica el mantenedor en cada release. Si `npm install`
> devuelve 404, esta versión aún no está en el registro npm — usa los
> instaladores de arriba o una build local: `npm install -g <repo>/pack/dist`.

## Primera ejecución, en orden

1. **Instala** (comandos de arriba). El setup detecta tus harnesses y solo
   toca esos. Se pueden revertir los cambios de configuración registrados,
   no las credenciales ni la instalación de dependencias (ver abajo).
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
5. **Más tarde**: consulta *Actualizar* según tu instalación. `zcode-kit rollback`
   revierte los cambios de archivos registrados en la última transacción;
   `zcode-kit uninstall` retira integraciones, no credenciales compartidas.

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
zcode-kit doctor [--fix] [--harness <id>] [--json]  diagnóstico; reparación explícita
zcode-kit status                              estado del proxy + instantánea de cuota
zcode-kit models [--json] [--show-key]        modelos anunciados (del proxy en ejecución)
zcode-kit usage --json                        uso/cuota de la cuenta (nunca valores inventados)
zcode-kit auth status|login|logout            ciclo de vida de la credencial del proxy
zcode-kit update                              actualizar el checkout y reaplicar integraciones
zcode-kit rollback [tx-id]                    deshacer la última (o indicada) transacción
zcode-kit uninstall                           quitar las integraciones del kit
```

Los cambios de configuración registrados tienen copias con hashes. Para transacciones
finalizadas, rollback informa de cambios posteriores del usuario como conflictos sin
sobrescribirlos. `setup` / `integrate` pueden fallar tras pasos ya completados:
registran esos cambios parciales y muestran el comando rollback, sin deshacer todo
automáticamente. La creación de claves locales, credenciales, dependencias y acciones
externas **no** son completamente reversibles; los registros externos pueden necesitar
el comando de deshacer indicado.

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

**YAML de Continue:** Un `models: []` existente (con espacios horizontales y un
comentario separado opcional) se convierte en lista de bloque antes de añadir
los modelos del kit. Las listas con o sin sangría conservan primero los modelos
del usuario y su orden predeterminado; repetir la integración es idempotente.
Se rechazan listas inline no vacías, claves `models` duplicadas y formatos no
soportados sin cambiar el archivo. El adaptador guarda la **clave local del proxy**
con comillas JSON en la sección gestionada de `~/.continue/config.yaml`, no una
credencial Desktop, y no la imprime. Reintegra tras rotarla. `${ZCODE_PROXY_KEY}`
no era interpolación válida de Continue; no se crea otro archivo de entorno.
Continue no está instalado en el entorno de validación: **validación real bloqueada**;
las pruebas del parser/configuración no son una sesión del cliente.

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

## Diagnóstico y reparación acotada (código actual; verificación final pendiente)

`zcode-kit doctor` diagnostica; `zcode-kit doctor --fix` solicita reparación
explícita. `--harness <id>` limita los adaptadores y `--json` entrega resultados
estructurados. La reparación no ejecuta setup general ni instala dependencias;
reaplica adaptadores bajo el bloqueo de setup. Solo alinea claves en una configuración
inequívoca de la plantilla del kit y con reserva exclusiva del puerto. Rechaza
configuraciones personalizadas/corruptas o puertos ocupados al alinear la clave;
si ya coincide, no reescribe la configuración. El checkout sigue
requiriendo `ZCODE_KIT_ALLOW_CHECKOUT=1`. Si falla, revierte los archivos registrados,
a diferencia del setup parcial; credenciales y efectos externos quedan fuera.

La comprobación compartida de arranque inicia/verifica el proxy de forma segura y
consulta la cuota una vez con timeout, sin bucle de sondeo/reintentos. Auth `3012`
es distinto de saldo/cuota `1113` / `3001`; reiniciar no repone cuota. Los avisos de auth/saldo upstream o telemetría no disponible permiten usar el proxy
local sano para que la petición de modelo intente una recuperación limitada.
No prueban cuota disponible ni inventan saldo cero; los fallos locales de identidad
o arranque sí bloquean el launcher.
No toca listeners ajenos/no verificables ni toma bloqueos antiguos automáticamente.
`logs/heal.log` es acotado y usa campos fijos de causa/acción/resultado, no respuestas
del proveedor.

OMP conserva la comprobación de salud local autenticada durante 60 segundos.
Una petición posterior puede recuperar un proxy caído; los arranques fallidos
tienen un minuto de espera. Los turnos normales no consultan la cuota repetidamente.

Setup normal también intenta una petición Flash mínima real, que puede consumir
cuota. `ZCODE_KIT_SKIP_SMOKE=1` la omite, igual que CI/test. Un fallo del smoke
se informa sin deshacer las integraciones guardadas. La existencia del código
no acredita una prueba real de estos cambios.

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

El runtime recarga la credencial persistida del proxy en cada petición. Datos
inválidos/parciales no sustituyen el último valor válido; un almacén ausente
(logout) lo elimina al recargar, sin cancelar peticiones activas ni revocar tokens
upstream. Las credenciales inyectadas explícitamente siguen aisladas por defecto.
Cada proceso registra como máximo 128 pares de credencial fallida/revisión del
origen; después detiene la reimportación automática hasta reiniciar. La persistencia
compara el almacén antes de reemplazarlo, pero no usa bloqueo entre procesos:
queda una pequeña carrera entre escritores, no una garantía general de CAS atómico.

Antes de emitir respuesta, ciertos errores no streaming de auth/saldo permiten
una reimportación de la sesión Desktop existente y un único reenvío **solo si
cambia la credencial efectiva**. Las peticiones concurrentes comparten recuperación;
los intentos se limitan por credencial fallida y revisión del origen Desktop, para
detectar una sesión posterior. El valor válido renovado se guarda cifrado en el
almacén del proxy solo si el contenido observado no cambió; no se escribe Desktop.
No abre navegador, crea claves, reclama trials ni reintenta indefinidamente.
No reproduce SSE ni errores durante el stream. Si falla, la petición sigue fallando;
los permisos y la cuota no se reparan localmente.

Para renovar manualmente de forma deliberada:

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

En un checkout, `zcode-kit update` rechaza un árbol modificado, solo hace
fast-forward (nunca fuerza) y reaplica las integraciones con el comportamiento
parcial de setup descrito arriba. Una instalación release/tarball sin `.git`
rechaza el comando: vuelve a ejecutar el instalador. El proxy está fijado
(ver `MANIFEST.md`); los parches locales viven en `patches/`.

### Automatización de releases (mantenedores)

`.github/workflows/release.yml` se activa con pushes a `main`, tags `v*` y dispatch.
Tras las pruebas, sin tag solo reutiliza la versión actual si falta en npm y el tag
remoto no existe o apunta exactamente al mismo HEAD. En otro caso elige el próximo
patch libre tanto en npm como en tags remotos (máximo 100 candidatos) y envía el
commit/tag. Dispatch reintenta la misma versión **solo en ese caso no publicado y
sin tag/o con HEAD idéntico**. La ausencia en npm no permite reutilizar assets de
otro commit. Las ejecuciones por tag omiten versiones npm existentes; no reemplazan
assets. Los errores del registro bloquean. Se fija npm 11.19.1 y se verifica la
visibilidad de la versión publicada, no el contenido descargado. Los controles y
OIDC deben completarse; cambios locales no prueban una release.

## Pruebas y evidencia

```sh
npm run test          # fixtures del kit: transacciones, seguridad, adaptadores
npm run test:proxy    # fixtures de protocolo y autenticación del proxy
npm run test:mcp      # suite del puente MCP
```

Baseline anterior a estas reparaciones: **65 kit / 872 proxy / 42 MCP**.
La ruta de terminación MCP con `wmic` **no se ejecutó**; el total no la valida.
**Verificación final pendiente**; resultados fechados en `TEST_REPORT.md`.
Inspección de código, fixtures/configuración, llamadas reales y releases publicadas
son evidencias distintas. No se afirman nuevas pruebas reales ni reparaciones de
la instalación personal. La evidencia histórica no verifica este árbol de trabajo.

## Documentos

- `SUPPORT_MATRIX.json` — estado real por adaptador
- `EFFORT_MAPPING.md` / `.json` — cómo low/high/max se mapean a parámetros upstream
- `SETUP_REPORT.md`, `TEST_REPORT.md` — evidencia de pruebas con comandos exactos
- `IMPLEMENTATION_STATUS.md` — decisiones y puntos abiertos
- `harnesses/README.md` — detalles por harness y fragmentos de integración manual
- `MANIFEST.md` — componentes vendidos, commits, licencias
- `docs/RELEASE_CHECKLIST.md` — preparado vs. pendiente para publicar
