# ZCode Proxy
[English (original)](README.md) · [Deutsch](README.de.md) · **Español** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

Este componente proporciona el proxy local de modelos incluido en ZCode Agent
Kit. El Kit se encarga de su configuración; las integraciones con asistentes
solo se configuran con tu consentimiento.

## Uso con ZCode Agent Kit

Usa los comandos de configuración y modelos descritos en el
[README principal](../README.es.md). La versión del código incluida y sus
cambios locales figuran en el [manifiesto de componentes](../MANIFEST.md). El
Kit necesita Node.js 24 o posterior e inicia el proxy con Bun; la versión
fijada de Bun es la 1.4.2.

## Importación del inicio de sesión de Desktop

`zcode-kit auth login zai --import` lee el inicio de sesión compartido actual de
Desktop. En Desktop 0.16.9, `credentials.json` es la fuente autoritativa si existe;
solo su ausencia permite recurrir al antiguo `config.json`. Las credenciales
inválidas, un secreto incorrecto o un proveedor activo no compatible no provocan
un fallback silencioso. Importar una sesión activa `zai`/`start-plan` requiere un
plan configurado explícitamente para `start-plan`; `coding-plan` utiliza el inicio de sesión OAuth
normal. La importación no crea cuentas, no restablece cuotas ni busca o crea
claves API. Consulta la [gestión de cuentas](../docs/ACCOUNT_ROTATOR.md).

## Solucionador de CAPTCHA y caché

El solucionador dentro del proceso ejecuta una ventana CAPTCHA a la vez.
Prepara un token y aumenta la reserva solo según la demanda, hasta cuatro;
los valores antiguos de paralelismo se limitan a esta capacidad. Los límites
del proveedor siguen pausando la resolución; el trabajo en cola, la invalidación
de caché y los hashes de diagnóstico no pueden eludir esa pausa.

`CAPTCHA_CDN_CACHE_TTL_MS` controla las cachés CDN en memoria y disco: el valor
predeterminado es `86400000` ms (24 horas), y solo admite enteros entre `0` y
`2147483647`. Los valores inválidos producen un error; `0` desactiva la lectura
y escritura en ambos niveles. `CAPTCHA_CDN_CACHE_DIR` selecciona un directorio
de caché aislado. El proxy administrado pasa ambas variables de entorno a su
proceso hijo. Las escrituras en disco usan un registro atómico; se rechazan las
entradas antiguas sin fecha de descarga y las truncadas. El paso a memoria
conserva la antigüedad original de la descarga.

Los diagnósticos capturan atómicamente la procedencia de cada artefacto cargado,
con hashes SHA-256 por ventana de los bytes realmente cargados; la procedencia
desconocida se indica explícitamente. `Last-Modified` no demuestra la identidad
histórica de los bytes. Para inspeccionar estáticamente un script del proveedor
guardado, usa la herramienta instalada:

```sh
node <installation>/zcode-proxy-src/captcha-compatibility.mjs <saved-script> [retrieval-epoch-ms]
```

Indica la hora de descarga conocida en milisegundos desde epoch, si está disponible.
La herramienta solo lee el archivo y muestra hashes y marcadores de compatibilidad:
no ejecuta el script ni demuestra el éxito del CAPTCHA de extremo a extremo. La
antigua reescritura diagnóstica de la VM de bytecode (`PE_PATCH`) se eliminó tras
reproducir la corrupción de los bundles, junto con los volcados sensibles de
argumentos DBT (`CAPTCHA_DUMP_DBT`). No uses esos controles. Se mantienen el solver,
sus controles de seguridad y la alternativa invocable `show`; los diagnósticos de
depuración contienen únicamente metadatos.

## Respuestas y reintentos

El proxy decodifica gzip, deflate y Brotli antes de interpretar los flujos
traducidos o las respuestas de error JSON. Los cuerpos vacíos o imposibles de
decodificar se notifican como `upstream_invalid_response`, no como respuestas
vacías correctas. El proxy no sustituye el directorio del asistente por el de
su proceso; `ZCODE_IDENTITY_ENV_CWD` sigue siendo una anulación explícita.

Los fallos transitorios antes de cualquier salida se reintentan hasta tres
veces en la misma cuenta, con un presupuesto menor que el del cliente oficial:

- Se reintentan: una conexión rechazada o reiniciada, HTTP 500, 502, 503, 504,
  524, 529 y 429, y los códigos de error del gateway que el cliente oficial
  reintenta.
- Nunca se reintentan: los veredictos del gateway (cuota, saldo, captcha,
  modelo, autenticación), los errores de la solicitud y cualquier cosa tras el
  inicio de la salida.
- La espera crece: alrededor de 1 s antes del primer reintento y el doble cada
  vez. `ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS` fija la unidad, que es la mitad de
  la primera espera, en milisegundos (500 por defecto, máximo 10000). `off`
  conserva solo el reintento de conexiones nunca establecidas.
- La cuenta se vuelve a comprobar antes de cada reintento. Un `Retry-After` se
  respeta hasta 15 segundos y por encima se pasa al cliente.
- Un flujo que falla antes de su primer evento de contenido (un evento de error
  como `overloaded_error` o una conexión cortada) se reintenta igual; el
  cliente recibe entonces las cabeceras de la respuesta cuando llega el primer
  evento de contenido (como mucho 15 segundos después).
- En start-plan, cada reintento tras una respuesta o una conexión cortada usa
  un token CAPTCHA nuevo.
- El transporte ordenado de las sesiones de cliente forzadas reintenta una
  conexión cortada antes de la respuesta igual que la ruta fetch (misma cuenta;
  la conmutación por cuota nunca la repite en otra cuenta).

Un flujo Anthropic nativo que termina sin `message_stop` recibe un frame final
`event: error` de tipo `api_error`. Su mensaje indica `upstream_incomplete`, o
`upstream_stream_error` si falló la lectura. Un último frame incompleto se
descarta para que los clientes vean un fallo legible en lugar de un
truncamiento silencioso.

## Detención, reinicio y sobrecarga

- **Detención.** El gestor del Kit pide al proxy que se detenga con una
  solicitud autenticada en la interfaz de loopback (`POST /__kit/stop`, la
  clave del proxy más un token de detención creado en cada inicio). El proxy
  responde entonces a las solicitudes nuevas con HTTP 503 y `Retry-After`, da
  a las solicitudes en curso hasta 6 segundos para terminar, corta las que
  siguen abiertas y termina en un máximo de 10 segundos. El gestor solo
  termina el proceso por su cuenta si sigue vivo 2 segundos después.
- **Sobrecarga.** El proxy mantiene como máximo 64 MiB de cuerpos de solicitud
  a la vez. Las demás solicitudes esperan, 64 como máximo y cada una hasta 15
  segundos, y después reciben HTTP 503 con `Retry-After: 2`, nunca 429. Un
  proxy sin solicitudes en curso siempre admite una. El límite se fija con
  `server.admission.maxInFlightMB` en `proxy/config.yaml` (de 1 a 4096) o con
  `ZCODE_PROXY_ADMISSION_MAX_INFLIGHT_MB`. Los flujos de respuesta abiertos no
  tienen límite.
- **Memoria.** El proxy mide su memoria cada 15 segundos. Si supera 512 MB en
  tres mediciones seguidas, escribe una advertencia en el registro. Si supera
  1024 MB en tres mediciones seguidas, pide un reinicio al gestor del Kit y
  se detiene de forma ordenada cuando el gestor lo ha aceptado. El gestor
  acepta como máximo 3 reinicios en 15 minutos; si lo rechaza, el proxy sigue
  funcionando. Los límites son `softLimitMB`, `hardLimitMB`, `samples` y
  `sampleIntervalSeconds` en `health.memory` de `proxy/config.yaml`.
- **Proxy que no responde.** Si el hilo principal del proxy lleva 45 segundos
  sin ejecutarse, el proxy pide un reinicio al gestor del Kit y termina por sí
  mismo.
- **Sin el gestor del Kit.** Un proxy que no inició el gestor del Kit no ofrece
  la solicitud de detención y nadie lo reinicia. Por encima del límite de
  memoria solo escribe en el registro y sigue funcionando; si su hilo
  principal deja de ejecutarse, termina y queda detenido.

## Registros

Iniciado por el gestor del Kit, el proxy escribe su salida en `logs/proxy.log`
a través de un único escritor. El escritor rota el archivo al llegar a 5 MB y
conserva un archivo anterior, `proxy.log.1`. Sustituye la clave del proxy, el
token de detención y las cadenas con forma de token por `<redacted>`. En macOS
y Linux los archivos de registro se crean con el modo `0600` y el directorio
de registros con el modo `0700`. Lee el registro con
`zcode-kit proxy logs [n] [--level warn|error] [--grep <text>]`. Un proxy
iniciado sin el gestor del Kit sigue escribiendo en su terminal.

## Seguridad

El proxy está pensado para un uso local de confianza. Mantenlo en el equipo
local y protege los datos de acceso y configuración. Algunos desafíos del
proveedor pueden ejecutar JavaScript proporcionado por el proveedor sin un
entorno aislado del sistema operativo; la conexión local no aísla ese código.
No expongas el servicio fuera del equipo. Los detalles están en la
[política de seguridad](../SECURITY.md).

## Licencia

Este componente incluido puede tener condiciones distintas a las del Kit.
Antes de redistribuirlo, consulta el [manifiesto](../MANIFEST.md) y los avisos
aplicables del proyecto original.
