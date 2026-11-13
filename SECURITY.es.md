# Política de seguridad
[English (original)](SECURITY.md) · [Deutsch](SECURITY.de.md) · **Español** · [日本語](SECURITY.ja.md) · [简体中文](SECURITY.zh-CN.md)

Esta política describe los límites de seguridad previstos de ZCode Agent Kit y
de las integraciones que incluye. No es una certificación de seguridad.

## Límites de seguridad

- El proxy y el puente MCP están pensados para un usuario local de confianza.
  Mantenlos en loopback y no los expongas a una LAN ni a internet. El proxy se
  niega a iniciarse en una dirección que no sea loopback o sin una clave real.
  Una clave bearer limita el acceso a la API; no ofrece un sandbox ni
  aislamiento entre usuarios.
- Algunos flujos de desafío del proveedor pueden ejecutar JavaScript que
  entrega el propio proveedor, sin un sandbox del sistema operativo. Trata ese
  código como no fiable. Escuchar en loopback y la autenticación bearer no lo
  aíslan.
- El solucionador de CAPTCHA se ejecuta en un proceso propio, que inicia el
  proxy, con un límite de memoria (300 MB por defecto). Una resolución que se
  atasca o crece demasiado no bloquea el proxy ni hace crecer su memoria, y el
  proceso del solucionador se puede terminar y sustituir. Su entorno no
  contiene el token de parada del proxy, los secretos de las credenciales ni la
  clave API. No es un sandbox del sistema operativo ni añade un límite de
  permisos: el proceso del solucionador se ejecuta con el mismo usuario y con
  el mismo acceso a archivos y a la red que el proxy.
- La configuración local, las credenciales, las claves, los registros y las
  copias de seguridad pueden contener datos sensibles. Restringe el acceso a
  ellos y quita los secretos antes de compartirlos. Los diagnósticos de
  depuración del CAPTCHA contienen solo metadatos. La antigua reescritura de
  diagnóstico de la VM de bytecode (`PE_PATCH`) se eliminó después de que se
  reprodujera la corrupción del bundle, y también se eliminaron los volcados
  sensibles de argumentos DBT (`CAPTCHA_DUMP_DBT`); no actives esos
  interruptores. El solucionador y sus controles de seguridad se mantienen. La
  procedencia por artefacto y los hashes de los bytes cargados son
  diagnósticos, no un sandbox ni una prueba de que el código del proveedor sea
  seguro. La herramienta estática de compatibilidad solo lee scripts guardados;
  no los ejecuta ni demuestra que el desafío funcione de principio a fin.
- La importación de Desktop lee el inicio de sesión compartido actual. Si
  existe el `credentials.json` de Desktop 0.16.9, ese archivo manda; el
  `config.json` heredado solo se usa cuando falta, no cuando falla el
  descifrado o la validación del proveedor. La importación solo lee las
  credenciales de Desktop y no resuelve ni crea claves API. Una importación
  activa de `zai`/`start-plan` requiere un plan configurado explícitamente para
  `start-plan`; para `coding-plan` se usa el OAuth normal.
- El Account Rotator opcional guarda copias cifradas independientes de inicios
  de sesión que ya controlas. Usa solo cuentas a las que tengas autorización
  para acceder. No crea cuentas, no restablece cuotas ni elude los límites del
  proveedor.
- Las integraciones ejecutan herramientas de asistentes locales con los
  permisos del usuario actual del sistema operativo. Revisa lo que hacen el
  instalador y la configuración antes de ejecutarlos en entornos con
  requisitos de seguridad más estrictos.

## Detener y reiniciar el proxy

El gestor del kit solo detiene un proxy que puede demostrar que es suyo: el
proceso del puerto configurado responde a una solicitud de estado autenticada
como el proxy de esta instalación, su pid es el registrado y su hora de inicio
coincide con la que se registró al iniciarlo. Cualquier otra cosa se notifica
y se deja en ejecución.

- **Solicitud de parada.** `zcode-kit proxy stop`, `proxy restart` y `update`
  envían primero `POST /__kit/stop` al listener loopback del proxy. La
  solicitud necesita la clave del proxy y un token de parada. El token se crea
  en cada inicio y se guarda en el registro del pid (`logs/proxy.pid`); no se
  escribe en la configuración de ningún asistente. Un proxy que no inició el
  gestor no tiene token de parada y no ofrece esta solicitud.
- **Drenaje.** Un proxy que acepta la solicitud responde a las solicitudes
  nuevas con HTTP 503 y una cabecera `Retry-After`, da a las que ya están en
  curso hasta 6 segundos para terminar, corta las que siguen abiertas, guarda
  los metadatos de las cuentas y termina. Su propio plazo para todo esto es de
  10 segundos.
- **Parada forzada.** El gestor solo termina el proceso por su cuenta cuando
  sigue vivo 2 segundos después de ese plazo, o cuando el proxy rechazó la
  solicitud o no la conoce. La propiedad se vuelve a comprobar justo antes de
  cada señal.
- **Proxy que no responde.** Un proxy registrado que ya no responde a las
  comprobaciones de estado solo se termina cuando se cumple todo esto: han
  pasado los 60 segundos de gracia del arranque, su hora de inicio y su línea
  de comandos coinciden con el proxy de esta instalación, y tres comprobaciones
  de estado seguidas no obtienen respuesta.
- **Reinicios automáticos.** El proxy pide al gestor un inicio nuevo en dos
  casos. Cuando su hilo principal lleva 45 segundos sin ejecutarse, lo pide y
  después termina. Cuando su memoria se mantiene por encima de 1024 MB en tres
  muestras tomadas cada 15 segundos, lo pide y solo drena cuando el gestor ha
  aceptado el reinicio; si el gestor lo rechaza, el proxy sigue atendiendo.
  Una memoria por encima de 512 MB en tres muestras solo escribe una
  advertencia en el registro. El gestor acepta como máximo 3 de estos
  reinicios en 15 minutos. Si rechaza uno después de que el proxy haya
  terminado, no hay ningún proxy en ejecución hasta el siguiente inicio. Los
  límites de memoria son `health.memory` en `proxy/config.yaml`.
- **Bloqueo de inicio.** Un inicio escribe un archivo de bloqueo
  (`logs/manager.lock`) y lo elimina al terminar, también cuando se interrumpe
  con Ctrl+C. Un bloqueo abandonado solo se toma cuando el gestor puede
  demostrar que su titular ya no existe: el proceso del titular está muerto, o
  su pid pertenece ahora a un proceso que se inició más tarde. El bloqueo de un
  titular vivo, o de uno que no se puede comprobar, nunca se toca. Un archivo
  de bloqueo que no se puede leer, o que escribió un kit más nuevo, se deja en
  su sitio y se notifica con su ruta.
- **Sobrecarga.** El proxy mantiene como máximo 64 MiB de cuerpos de solicitud
  a la vez (`server.admission.maxInFlightMB`). Las demás solicitudes esperan,
  64 como máximo y cada una hasta 15 segundos, y después reciben HTTP 503 y
  `Retry-After`.

Las solicitudes cortadas por una parada o un reinicio no se reanudan; el
cliente tiene que volver a enviarlas.

### Límites de la recuperación de procesos

En Windows, la recuperación abre un handle de proceso del sistema operativo y
compara la hora de creación de ese handle antes de terminarlo; no termina un
árbol de descendientes ajeno elegido por PID. En las demás plataformas, la
identidad registrada se vuelve a comprobar justo antes de enviar una señal a
un PID numérico; eso no ofrece una garantía atómica a nivel de kernel como
pidfd. Las instancias que un kit antiguo inició con una ruta de script relativa
no pueden demostrar su ruta de instalación en Windows ni en macOS, y se dejan
para que el operador las revise explícitamente. Las instancias iniciadas ahora
usan una ruta de script absoluta.

## Registros

El proxy en ejecución escribe `logs/proxy.log` mediante un único escritor, que
comprueba el tamaño del archivo antes de cada escritura, lo rota al llegar a
5 MB y conserva un archivo anterior, `proxy.log.1`. El gestor añade sus propias
líneas al mismo archivo y solo lo rota durante un inicio, cuando no hay ningún
proxy en ejecución. En macOS y Linux, la carpeta de registros se crea con modo
`0700` y los archivos de registro y el registro del pid con modo `0600`. Estos
modos no tienen efecto en Windows, donde el acceso depende de los permisos de
la carpeta. La clave del proxy, el token de parada y las cadenas con forma de
token bearer, JWT o clave API se sustituyen por `<redacted>` en las líneas del
registro. Esta ocultación se basa en patrones, así que revisa un registro antes
de compartirlo.

## Informar de una vulnerabilidad

Usa la función de informe privado de vulnerabilidades de GitHub, en la pestaña
**Security** de este repositorio, cuando esté disponible. Si no lo está,
contacta con los mantenedores de forma privada a través de GitHub. No publiques
detalles de la vulnerabilidad, credenciales ni datos sensibles de reproducción
en un issue público.

Indica la versión afectada, el sistema operativo, el componente, el impacto y
la reproducción segura más pequeña que puedas aportar. Los mantenedores
revisarán el informe y coordinarán los siguientes pasos; no se garantiza un
plazo de respuesta.
