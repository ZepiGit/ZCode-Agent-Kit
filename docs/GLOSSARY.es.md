# Glosario
[English (original)](GLOSSARY.md) · [Deutsch](GLOSSARY.de.md) · **Español** · [日本語](GLOSSARY.ja.md) · [简体中文](GLOSSARY.zh-CN.md)

El kit ejecuta un proxy local de ZCode y conecta a él tus propios agent harnesses (asistentes). Este glosario define las palabras que usan la salida de `zcode-kit` y los documentos del kit. La salida del kit está en inglés, así que cada término lleva entre paréntesis su nombre original.

## Instalación y procesos

**Instalación** (*Installation*):
Una copia del kit (instalación de versión publicada, instalación de npm o copia del código fuente) con su propia configuración, clave del proxy y estado. Todo lo demás de este glosario existe una vez por instalación.

**Upstream**:
El servicio ZCode del proveedor al que el proxy reenvía las solicitudes a los modelos.

**Proxy**:
El servicio HTTP local de la instalación, en loopback, que habla los formatos de Anthropic y OpenAI con los harnesses y reenvía al upstream. Hay uno por instalación.

**Clave del proxy** (*Proxy key*):
El secreto local que un cliente debe enviar al proxy. La configuración lo genera y lo guarda en `.proxykey`.

**Gestor** (*Manager*):
El componente del kit que inicia, detiene y reinicia el proxy. Lo usan `zcode-kit proxy start`, `stop` y `restart`.

**Prueba de identidad** (*Identity proof*):
Una respuesta de estado autenticada que demuestra que el proceso del puerto configurado es el proxy propio de esta instalación. Sus resultados son *propio* (*ours*), *ajeno* (*foreign*: otra cosa responde en el puerto), *caído* (*down*: no responde nada) y *sin clave* (*no key*: falta la clave del proxy, así que no se puede demostrar nada). `zcode-kit proxy status --json` los indica en su campo `health` como `ours`, `foreign`, `down` y `nokey`.

**Registro del pid** (*Pid record*):
El archivo `logs/proxy.pid`, en el que el gestor anota el pid y la hora de inicio del proxy. El gestor solo detiene un proceso que coincide con este registro. Los mensajes también lo llaman archivo pid (*pid file*).

**Harness**:
Una CLI de agente o una extensión de editor que usa el proxy como proveedor de modelos, como Claude Code, Codex, OMP u OpenCode. Otros documentos también lo llaman asistente.

**Integración** (*Integration*):
La configuración que el kit escribe para un harness, con tu consentimiento, para que ese harness use el proxy.

**Lanzador** (*Launcher*):
El proceso `zcode-kit run <harness>`. Ejecuta la comprobación previa e inicia el harness. Cuando es posible el traspaso, después se sustituye a sí mismo por el harness; si no, se queda hasta que el harness termina y devuelve su código de salida.

**Comprobación previa** (*Preflight*):
Una comprobación breve antes de que un harness use el proxy. Se asegura de que el proxy está en marcha y es el de la instalación, lo inicia si hace falta y comprueba la cuota.

**Puente MCP** (*MCP bridge*):
El servidor MCP que da a un harness herramientas de la runtime de ZCode Desktop instalada. Registrarlo no es lo mismo que conectar un modelo.

**Transacción** (*Transaction*):
El registro, con copias de seguridad, de los cambios en archivos que hizo una ejecución de un comando como `setup`, `integrate`, `update` o `accounts enable`. `zcode-kit rollback [tx-id]` deshace la más reciente o la indicada.

**Huella de memoria** (*Memory footprint*):
La memoria que el sistema operativo atribuye al proceso del proxy. Los límites de memoria del proxy se miden con ella; cuando la runtime no puede informarla, se usa el tamaño del conjunto residente (RSS).

**Traspaso** (*Handover*):
El lanzador se sustituye a sí mismo por el asistente, de modo que el asistente conserva el id de proceso del lanzador y no queda ningún proceso del kit a su lado. Funciona en Linux y macOS con Node.js 26.1 o posterior; `ZCODE_KIT_RESIDENT_LAUNCHER=1` lo desactiva.

**Comprobación previa compartida** (*Shared preflight*):
Una sola comprobación previa para varias ventanas de OMP de una instalación que se inician a la vez. La ventana que crea `logs/omp-autostart.token` la ejecuta; las demás esperan su resultado.

## Ciclo de vida del proxy y bloqueo de inicio

**Bloqueo de inicio** (*Start lock*):
El archivo `logs/manager.lock`, que indica que hay un inicio del proxy en curso para esta instalación. Como máximo existe un titular a la vez.

**Titular** (*Holder*):
El proceso que el bloqueo de inicio registra como el que está haciendo el inicio.

**Bloqueo obsoleto** (*Stale lock*):
Un bloqueo de inicio cuyo titular ya no existe de forma demostrada: su proceso está muerto, o su pid pertenece ahora a un proceso que se inició más tarde. Un bloqueo que solo es antiguo, o cuyo titular no se puede comprobar, no está obsoleto.

**Toma del bloqueo** (*Takeover*):
Sustituir un bloqueo obsoleto por uno propio para que un inicio pueda continuar. Nunca se aplica al bloqueo de un titular vivo.

**Gracia de arranque** (*Startup grace*):
Los primeros 60 segundos después de iniciar un proxy. Un proxy que todavía no responde nunca se termina durante este tiempo.

**Proxy huérfano** (*Orphaned proxy*):
Un proxy sano que sigue en ejecución después de que se interrumpiera el inicio que lo lanzó. El siguiente inicio lo adopta mediante la prueba de identidad en lugar de lanzar otro.

**Proxy colgado** (*Hung proxy*):
El proxy propio de la instalación que está en ejecución pero no responde a las comprobaciones de estado. El kit solo lo termina cuando está demostrado que es suyo y que está colgado.

**Supervisor de estado** (*Health supervisor*):
La parte del proxy que vigila su propio hilo principal y su huella de memoria, y decide si advertir, pedir un reinicio o seguir atendiendo.

**Reinicio automático** (*Automatic restart*):
La petición que el propio proxy hace al gestor para iniciarse de nuevo, cuando su hilo principal ha dejado de responder o su memoria se ha mantenido por encima del límite máximo. Las líneas del registro lo llaman *respawn*. Lo limita el presupuesto de reinicios.

**Presupuesto de reinicios** (*Restart budget*):
El número de reinicios automáticos que acepta el gestor dentro de una ventana móvil: 3 en 15 minutos.

**Confirmación del respawn** (*Respawn acknowledgement*):
La confirmación registrada de que el gestor ha aceptado la petición de reinicio automático de un proxy. Un proxy que lo pidió por la memoria solo drena después de recibirla; sin ella, sigue atendiendo.

**Drenaje** (*Drain*):
La fase de una parada ordenada en la que el proxy mantiene abierto su listener, rechaza las solicitudes nuevas y deja que las que ya están en curso terminen antes de su plazo.

**Solicitud de parada** (*Stop request*):
La solicitud loopback autenticada (`POST /__kit/stop`) con la que el gestor pide a su propio proxy que se detenga de forma ordenada. Necesita la clave del proxy y el token de parada.

**Token de parada** (*Stop token*):
El secreto, creado en cada inicio, que autoriza una solicitud de parada junto con la clave del proxy. Se guarda en el registro del pid y no forma parte de la configuración de ningún harness.

**Reinicio** (*Restart*):
Una parada seguida de un inicio del proxy, que se pide con `zcode-kit proxy restart`.

## Solucionador de captcha

**Resolución** (*Solve*):
Una ejecución del desafío captcha del proveedor dentro de una página sin interfaz, que produce un token o un fallo.

**Solucionador** (*Solver*):
La parte del proxy que hace las resoluciones, de una en una y por orden de llegada.

**Proceso del solucionador** (*Solver process*):
El proceso que el proxy inicia para el solucionador. Hay como máximo uno por proxy. Tiene un límite de memoria (`solver.memoryCapMB`, 300 MB por defecto) que el sistema operativo aplica donde puede.

**Renovación** (*Recycle*):
Sustituir el proceso del solucionador por uno nuevo antes de la siguiente resolución: al llegar al 80 % del límite de memoria o tras 100 resoluciones.

**Fallo rápido** (*Fail-fast*):
El tiempo durante el que el proxy no inicia ningún proceso del solucionador porque más de 5 terminaron de forma anómala en 10 minutos. Las solicitudes que necesitan una resolución reciben HTTP 503 y `Retry-After`.

## Admisión

**Admisión** (*Admission*):
La decisión que toma el proxy para cada solicitud: procesar el cuerpo ahora, hacerla esperar o rechazarla.

**Bytes en curso** (*In-flight bytes*):
El tamaño total de los cuerpos de solicitud que el proxy tiene en ese momento, desde que lee un cuerpo hasta que el upstream ha respondido.

**Límite de bytes** (*Byte cap*):
El límite de bytes en curso, 64 MiB por defecto (`server.admission.maxInFlightMB`). Es el único límite de admisión; los flujos de respuesta abiertos no se limitan.

**Cola de admisión** (*Admission queue*):
La fila limitada, por orden de llegada, de solicitudes que esperan la admisión y cuyos cuerpos aún no se han leído. Esperan como máximo 64 solicitudes, cada una durante 15 segundos como máximo.

**Rechazo** (*Shed*):
Rechazar con HTTP 503 y `Retry-After`, en el formato de error del endpoint llamado, una solicitud que no se pudo admitir o que llegó durante un drenaje. Un rechazo nunca es un error de cuota.

## Cuentas

**Account Rotator**:
La función opcional que guarda varios inicios de sesión autorizados como cuentas separadas. Consulta [ACCOUNT_ROTATOR.es.md](ACCOUNT_ROTATOR.es.md).

**Cuenta activa** (*Active account*):
La cuenta que usa el proxy en ese momento, marcada con `*` en las tablas de cuentas.

**Veredicto** (*Verdict*):
El estado que `zcode-kit accounts health` asigna a cada cuenta, como `ok`, `low` o `exhausted`.

**Paquete de cuota** (*Quota package*):
Un saldo que el proveedor indica para una cuenta, con las unidades restantes y totales y una hora de restablecimiento.

**Enfriamiento** (*Cooldown*):
El tiempo durante el que una cuenta no se usa después de un error de cuota.

## Tareas MCP

**Retención de tareas** (*Task retention*):
Cuánto tiempo se conservan las tareas MCP terminadas y sus resultados antes de eliminarse: 500 tareas terminadas y 7 días como máximo. La clave de idempotencia de una tarea se recuerda exactamente mientras la tarea se conserva.

**Presupuesto de reinicios** (*Restart budget*):
Cuántas veces el puente MCP vuelve a iniciar su runtime de ZCode después de que esta haya terminado: 3 veces en 15 minutos como máximo. Con el presupuesto agotado, las herramientas que necesitan la runtime fallan con `HARNESS_RESTART_BUDGET_EXHAUSTED` hasta que vuelve a quedar un hueco libre.

## Registros

**Registro del proxy** (*Proxy log*):
`logs/proxy.log`, que escriben el proxy y el gestor, y que se rota al llegar a 5 MB conservando un archivo anterior, `proxy.log.1`. `zcode-kit proxy logs` lo lee.

**Registro de reparación** (*Heal log*):
`logs/heal.log`, un registro breve de lo que encontraron e hicieron la comprobación previa y el gestor, con un vocabulario fijo y sin texto del proveedor, rutas ni credenciales.

## Salida de la terminal

**Informe** (*Report*):
La respuesta de un comando: filas de comprobación y línea de veredicto, texto de estado, el resumen de la configuración, los datos de conexión. Los informes y los datos van a stdout.

**Diagnóstico** (*Diagnostic*):
Todo lo que rodea a la respuesta de un comando: progreso, advertencias, bloques de error, preguntas y errores de uso. Los diagnósticos van a stderr.

**Comprobación** (*Check*):
Una prueba con nombre en `zcode-kit doctor`, incluida la comparación con el upstream de `doctor --upstream`.

**Veredicto de comprobación** (*Check verdict*):
La palabra de resultado de una comprobación: *PASS*, *FAIL*, *WARN* o *SKIP*. Solo *FAIL* hace que el comando falle; *WARN* significa que funciona pero requiere atención; *SKIP* significa que no se aplica o que no se ha detectado. `zcode-kit accounts doctor` imprime en su lugar sus propias palabras: *OK*, *WARNING* y *ERROR*.

**Resultado de acción** (*Action result*):
La palabra de resultado de un paso que cambia algo (setup, integrate, update, rollback, uninstall): *OK*, *FAIL*, *WARN*, *SKIP* o *INFO*.

**Línea de veredicto** (*Verdict line*):
La línea que resume un informe de comprobaciones con el recuento por veredicto e indica un código de salida distinto de cero.

**Datos de conexión** (*Connection details*):
El bloque que indica a un cliente configurado a mano cómo llegar al proxy: URL base, clave, ID de modelo y estado del proxy.

**Modo de líneas** (*Line mode*):
Toda la salida que no es la TUI de pantalla completa del proxy: líneas simples, sin recuadros.

**TUI del proxy** (*Proxy TUI*):
La vista de terminal a pantalla completa del proxy en ejecución, con su cabecera de estado, el panel de registro y las indicaciones de teclas.

**Nivel de glifos** (*Glyph tier*):
El conjunto de caracteres que puede usar la salida en una terminal concreta: *full*, *wgl4* o *ascii*. Las palabras no cambian entre niveles; solo cambian los símbolos.

## Compatibilidad

**Versión mínima compatible** (*Support floor*):
La versión de runtime más baja que admite el kit: Node.js 24. Por debajo de ella, los instaladores, `setup` y `update` se detienen antes de cambiar nada.
