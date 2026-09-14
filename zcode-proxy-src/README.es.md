# ZCode Proxy (Español)

[English](README.md) | [中文](README.zh-CN.md) | **Español** | [日本語](README.ja.md) | [Deutsch](README.de.md)

> Traducción del original en inglés; ante cualquier discrepancia manda el
> original en inglés.

Este directorio incluye (vendored) el **zcode-proxy** de
[TriDefender/zcode-api](https://github.com/TriDefender/zcode-api) — fijado en
v4.6.4, commit `9a5cebe07c5255faa675075fa37632d4dea733fa` (2026-09-11),
licencia MIT (el upstream no incluye archivo LICENSE). Versión, commit y
modificaciones locales están documentados en [`../MANIFEST.md`](../MANIFEST.md);
los parches locales viven en [`../patches/`](../patches/).

Este README describe el componente **tal como se usa dentro del ZCode Agent
Kit**. El README original del upstream (chino) se conserva como
[README.zh-CN.md](README.zh-CN.md); documenta el proyecto upstream
independiente (app Android, despliegue Docker, canales off-peak, reclamación de
trials) que el kit no usa.

## Papel dentro del kit

El proxy es la puerta de enlace de modelos del kit. Acepta peticiones OpenAI
chat-completions, Anthropic messages y OpenAI Responses en
**`http://127.0.0.1:8457`** y las reenvía al gateway de Z.AI usando tu cuenta
con sesión iniciada de ZCode Desktop (start-plan, la misma cuota que ZCode
Desktop).

- Direcciones/formatos: `POST /v1/chat/completions`, `POST /v1/messages`,
  `POST /v1/responses`, `GET /v1/models`, `GET /health`, `GET /quota`
- Autenticación: `Authorization: Bearer <contenido de .proxykey>` — la clave la
  genera localmente setup.mjs y nunca sale de tu máquina
- Ciclo de vida: gestionado por `node proxy\zcode-proxy-manager.mjs start|stop|restart|status|doctor|logs`
  (bind solo loopback, stop fail-closed, rotación de logs — ver el README raíz)
- Renovación de sesión: ver [README.es.md](../README.es.md) → «Renovación de
  inicio de sesión»

## Desviaciones locales respecto al upstream

- **Puerto 8457** en lugar del 8080 por defecto del upstream independiente
  (plantilla de config del kit), solo loopback, clave bearer obligatoria
- **Reclamación de trials y canales off-peak deshabilitados**: la config
  distribuida por el kit no usa las funciones upstream `claim` (captura
  automática de trials limitados) ni `/async/*` (off-peak); los valores por
  defecto subyacentes son fail-closed (`false`) desde la remediación de la
  auditoría
- **Exclusiones de vendoring**: `Android-APP/` (209 MB) y `node_modules/` no se
  incluyen; `node_modules/` lo instala setup.mjs con `bun install
  --frozen-lockfile`
- Se añadieron localmente dos archivos de test del upstream; todas las
  modificaciones de fuente están en
  [`../patches/zcode-proxy-local-patches.patch`](../patches/zcode-proxy-local-patches.patch)

## Modelos disponibles

El proxy lista estos modelos en `/v1/models` (la lista es solo display — otros
nombres de modelo se reenvían con normalidad). Dentro del kit, **glm-5.3**
(texto, contexto 1M) y **glm-5.3-flash** (texto+imagen, contexto 1M) son los
modelos verificados; ver el README raíz.

| Modelo | Contexto | Salida máx. |
|---|---|---|
| `glm-4.5-air` | 131K | 96K |
| `glm-4.6` | 200K | 131K |
| `glm-4.6v` (visión) | 131K | 32K |
| `glm-4.7` | 200K | 131K |
| `glm-5` / `glm-5-turbo` | 200K | 64K |
| `glm-5v-turbo` (visión) | 200K | 131K |
| `glm-5.1` | 200K | 64K |
| `glm-5.2` | 1M | 128K |
| `glm-5.3` / `glm-5.3-flash` | 1M | 128K |

## Configuración y variables de entorno

El proxy lee `config.yaml` (el kit lo apunta a `../proxy/config.yaml` vía
`ZCODE_PROXY_CONFIG`). Las variables de entorno tienen prioridad. Las más
comunes:

| Variable de entorno | Por defecto | Significado |
|---|---|---|
| `ZCODE_PROXY_PORT` | `8080` | puerto de escucha (la plantilla del kit usa 8457) |
| `ZCODE_PROXY_API_KEY` | ninguna | clave que deben presentar los clientes (en el kit: el contenido de `.proxykey`) |
| `ZCODE_PROVIDER` | `zai` | proveedor `zai` / `bigmodel` |
| `ZCODE_PROXY_CONFIG` | `config.yaml` | ruta del archivo de configuración |
| `ZCODE_PROXY_CREDENTIAL_SECRET` | específica de la máquina | semilla de cifrado de la credencial de login (fíjala al migrar/usar Docker) |
| `ZCODE_LOG_FORMAT` | tabla de escritorio | `compact` para logs de una línea (terminales estrechos) |

## Arrancar desde el código / TUI

Arrancar el proxy directamente desde este directorio abre el panel interactivo
de terminal (interfaz principal del upstream):

```powershell
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts
```

<img src="docs/images/tui-annotated.png" alt="Panel de terminal de ZCode Proxy" width="980" />

El panel tiene tres zonas: **login y ajustes** (proveedor / plan / login),
**servicio proxy** (arrancar/parar, config actual) y **logs** (una línea por
petición, en vivo). Pulsa <kbd>s</kbd> para arrancar el proxy; `Status: running`
significa que está listo. Los botones se pueden pulsar con el ratón, y `bun run
zcode-proxy --cli serve` corre sin interfaz. Atajos: <kbd>s</kbd>
arrancar/parar · <kbd>l</kbd> login · <kbd>L</kbd> login por enlace pegado ·
<kbd>o</kbd> logout · <kbd>p</kbd>/<kbd>t</kbd> cambiar proveedor/plan ·
<kbd>↑</kbd><kbd>↓</kbd>/<kbd>PgUp</kbd>/<kbd>g</kbd> desplazar logs ·
<kbd>c</kbd> limpiar · <kbd>q</kbd> salir.

Los usuarios del kit normalmente no necesitan esto —
`proxy/zcode-proxy-manager.mjs` mantiene el proxy corriendo headless con
rotación de logs.

## No usado por el kit

Estas funciones del upstream existen en el código pero no forman parte de la
configuración distribuida por el kit: la app Android (excluida del vendoring),
el despliegue Docker, los canales off-peak `/async/*` y la reclamación
automática de trials (deshabilitada, fail-closed). Para uso independiente,
consulta el repositorio upstream.

## Licencia

MIT (según el README del upstream; el upstream no incluye archivo LICENSE — ver
[`../MANIFEST.md`](../MANIFEST.md)).
