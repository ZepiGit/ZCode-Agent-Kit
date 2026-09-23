# ZCode Proxy
[English (original)](README.md) · [Deutsch](README.de.md) · **Español** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

Este componente proporciona el proxy local de modelos incluido en ZCode Agent
Kit. El Kit se encarga de configurarlo e integrarlo con los asistentes.

## Uso con ZCode Agent Kit

Usa los comandos de configuración y modelos descritos en el
[README principal](../README.es.md). La versión del código incluida y sus
cambios locales figuran en el [manifiesto de componentes](../MANIFEST.md).

`zcode-kit auth login zai --import` lee el inicio de sesión compartido actual de
Desktop. En Desktop 0.16.9, `credentials.json` es la fuente autoritativa si existe;
solo su ausencia permite recurrir al antiguo `config.json`. Las credenciales
inválidas, un secreto incorrecto o un proveedor activo no compatible no provocan
un fallback silencioso. Importar una sesión activa `zai`/`start-plan` requiere un
plan configurado explícitamente para `start-plan`; `coding-plan` utiliza el inicio de sesión OAuth
normal. La importación no crea cuentas, no restablece cuotas ni busca o crea
claves API. Consulta la [gestión de cuentas](../docs/ACCOUNT_ROTATOR.md).

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

La corrección local decodifica gzip, deflate y Brotli antes de interpretar los flujos traducidos o las respuestas de error JSON. Los cuerpos vacíos o imposibles de decodificar se notifican como `upstream_invalid_response`, no como respuestas vacías correctas. El proxy no sustituye el directorio del asistente por el de su proceso; `ZCODE_IDENTITY_ENV_CWD` sigue siendo una anulación explícita.

## Seguridad

El proxy está pensado para un uso local de confianza. Mantenlo en el equipo
local y protege los datos de acceso y configuración. Algunos desafíos del
proveedor pueden ejecutar JavaScript sin un entorno aislado del sistema
operativo; la conexión local no aísla ese código. Lee la
[política de seguridad](../SECURITY.md) y no expongas el servicio fuera del
equipo.

## Licencia

Este componente incluido puede tener condiciones distintas a las del Kit.
Antes de redistribuirlo, consulta el [manifiesto](../MANIFEST.md) y los avisos
aplicables del proyecto original.
