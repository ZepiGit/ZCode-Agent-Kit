# Account Rotator automático
[English (original)](ACCOUNT_ROTATOR.md) · [Deutsch](ACCOUNT_ROTATOR.de.md) · **Español** · [日本語](ACCOUNT_ROTATOR.ja.md) · [简体中文](ACCOUNT_ROTATOR.zh-CN.md)

El Account Rotator opcional guarda inicios de sesión autorizados como cuentas
separadas. Mientras está activado, cada nuevo inicio de sesión correcto se
guarda como una cuenta más. En las solicitudes compatibles, el Kit puede probar
otra cuenta guardada si la seleccionada no puede continuar. Un reintento no
tiene garantizado el éxito. Los fallos transitorios de red o de la pasarela
que ocurren antes de cualquier salida se reintentan primero con la misma
cuenta; ese reintento nunca cambia de cuenta por sí solo.

La función no crea cuentas, no restablece cuotas ni elude las reglas del
proveedor. Importar un inicio de sesión no concede cuota nueva. Usa solo
cuentas a las que tengas autorización para acceder.

## Activar o desactivar

La función está desactivada por defecto. En una terminal, la configuración
pregunta:

> Do you want to activate the Account Rotator feature? [y/N]

Responde `y` para activarla y conservar los inicios de sesión que el Kit ya
tiene. `n` o Enter la dejan desactivada. La configuración guarda la respuesta
y no vuelve a preguntar; `zcode-kit setup --reask` pregunta de nuevo. Sin
terminal, la configuración deja el ajuste como está. En instalaciones
desatendidas, pasa `--account-rotator y` o `--account-rotator n` a la
configuración, o define `ZCODE_KIT_ACCOUNT_ROTATOR` como `y` o `n`.

Puedes cambiar la función en cualquier momento:

```sh
zcode-kit accounts enable
zcode-kit accounts disable
```

Los dos comandos reinician el proxy de este Kit si está en ejecución, para que
el cambio surta efecto. Al desactivarla se conservan las cuentas guardadas.

## Añadir y gestionar cuentas

Vuelve a iniciar sesión para añadir otra cuenta. También puedes importar el
inicio de sesión que ya usa ZCode Desktop:

```sh
zcode-kit auth login zai
zcode-kit auth login zai --import
zcode-kit accounts
```

La importación lee las credenciales compartidas actuales de Desktop, no una
cuenta recién creada. Con Desktop 0.16.9, el `credentials.json` cifrado manda
cuando existe. Solo si falta se recurre al `config.json` anterior; un archivo
dañado, un secreto de descifrado incorrecto o un proveedor activo no compatible
producen un error en lugar de importar en silencio un inicio de sesión más
antiguo. El importador lee el inicio de sesión `zai`/`start-plan` activo y
requiere un plan configurado explícitamente para `start-plan`. Para
`coding-plan`, usa el inicio de sesión OAuth normal de arriba: el importador
de Desktop solo lee y no resuelve ni crea claves API. No modifica las
credenciales compartidas de Desktop.

La lista de cuentas muestra los ID que usan estos comandos de gestión:

```sh
zcode-kit accounts pause <ID>
zcode-kit accounts resume <ID>
zcode-kit accounts remove <ID> --yes
```

Pausar y reanudar se aplican a las solicitudes nuevas; una solicitud que ya
está en curso mantiene su cuenta. `remove` sin `--yes` no cambia nada y te
pide que repitas el comando con esa opción. Eliminar una cuenta no afecta al
inicio de sesión de Desktop.

Si no hay ninguna cuenta guardada que cumpla los requisitos, el Kit no cambia a
una cuenta ajena o no autorizada; la solicitud puede fallar.

Más comandos:

| Comando | Para qué sirve |
| --- | --- |
| `zcode-kit accounts --json` | La lista de cuentas en JSON, sin credenciales. |
| `zcode-kit accounts --live` | El estado de las cuentas en tiempo de ejecución, leído del proxy en ejecución. |
| `zcode-kit accounts quota` | La cuota de todas las cuentas del grupo, leída del proxy en ejecución. |
| `zcode-kit accounts explain --model MODEL --operation OP` | Qué cuentas guardadas permite la configuración para un modelo y una operación (`inference`, `billing`, `quota` o `async`), y por qué se excluyen las demás. Solo lee la configuración y el almacén. |
| `zcode-kit accounts doctor [--json]` | Comprobaciones de solo lectura de la configuración y del almacén de cuentas. |
| `zcode-kit accounts unlock [--force]` | Quita un bloqueo abandonado del almacén de cuentas. Un bloqueo que sigue activo o que no se puede leer solo se quita con `--force`. |

## Volver a iniciar sesión

Un inicio de sesión con el mismo ID de usuario de OAuth actualiza la cuenta
existente en su sitio (tokens nuevos; se conservan la etiqueta, la pausa y el
enfriamiento). Volver a importar credenciales idénticas tampoco cambia nada.
Los límites entre proveedores y planes se mantienen separados.

Puede que las importaciones de Desktop no tengan un ID de usuario verificado.
En ese caso, que coincida el subject de un JWT decodificado indica un posible
duplicado, no un permiso para sobrescribir una credencial. Si los tokens han
cambiado, el comando no sustituye en silencio ni inserta un duplicado, e indica
la cuenta existente. Selecciónala explícitamente cuando sea lo que quieres:
`zcode-kit auth login zai --import --account ID --replace` (omite `--import`
para OAuth). El subject nunca se copia al campo `userId` del servicio upstream.

`--account ID` siempre guarda con el ID que has elegido, aunque ese usuario ya
esté guardado con otro ID. En ese caso, el inicio de sesión imprime una nota
con el otro ID, y `zcode-kit accounts doctor` informa de
`same_identity_accounts`. Un alias así comparte la cuota del usuario y no
añade capacidad, pero el rotator lo trata igualmente como una entrada aparte
(y puede probarlo después del original); elimínalo con
`zcode-kit accounts remove <ID> --yes`.

## Estado de las cuentas

```sh
zcode-kit accounts health
zcode-kit accounts health --json
```

Muestra una tabla con una fila por cuenta: ID de la cuenta, veredicto, plan,
cuota (restante/total por paquete de cuota, con porcentaje y hora de
restablecimiento) y cuándo se usó la cuenta por última vez. `*` marca la cuenta
activa. Debajo de la tabla aparecen `usable: N of M` y los totales del grupo.
El comando necesita el proxy en ejecución; si no está, todas las cuentas
aparecen como `unknown` y el comando te indica que ejecutes
`zcode-kit proxy start`. El código de salida 0 significa que al menos una
cuenta está en `ok` o `low`; 1 significa que ahora mismo ninguna se puede usar
o que no hay datos en vivo.

Veredictos, por orden de prioridad. La tabla imprime `auth_error` y
`no_quota_data` como `auth error` y `no quota data`; la salida JSON mantiene
los nombres de abajo.

| Veredicto | Significado |
| --- | --- |
| `paused` | Pausada por ti o por la política. |
| `blocked` | Excluida por la política de proveedor, de plan o de lista de permitidos. |
| `expired` / `invalid` | Inicio de sesión caducado o inutilizable con la configuración actual. |
| `auth_error` | El servicio de facturación rechazó el inicio de sesión (401/3012); vuelve a iniciar sesión. |
| `exhausted` | En enfriamiento tras un error de cuota, hasta la hora indicada. Antes de que empiece el enfriamiento, el kit reintenta con la misma cuenta a intervalos crecientes (por defecto tras 1s, 4s, 10s, 20s y 30s, así que una solicitud puede quedar retenida alrededor de un minuto); la pasarela puede atender un reintento desde otro paquete de saldo que aún tenga cuota (por ejemplo, una asignación de un evento junto a un paquete diario vacío). Estos intervalos también se aplican a las instalaciones con una sola cuenta. En el modo Account Rotator, el enfriamiento se aplica también cuando los reintentos están desactivados, se rechazan o fallan con otro error; solo la memoria de reintentos de una sola cuenta espera a que el agotamiento esté demostrado. Ajústalo o desactívalo con `ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS` (milisegundos separados por comas; `0` significa un reintento inmediato, `off` lo desactiva; 6 valores como máximo, cada uno limitado a 60s; solo dígitos decimales: los valores no válidos vuelven a los intervalos por defecto; el inicio o reinicio del proxy transmite la variable). |
| `duplicate` | Identidad OAuth verificada igual o credenciales idénticas dentro del conjunto que cumple los requisitos; la cuota se consulta y se suma una sola vez. Un subject de JWT decodificado por sí solo nunca evita una consulta. |
| `no_quota_data` | El servicio respondió, pero ahora mismo no indica ningún paquete de cuota para esta cuenta. No es un estado sano confirmado. |
| `empty` | Todos los paquetes de cuota están agotados. |
| `low` | Al menos un paquete tiene menos del 10% restante. |
| `ok` | Utilizable y con cuota restante. |
| `unknown` | No hay una respuesta en vivo completa para esta cuenta (el proxy no está en ejecución, una consulta de cuota falló o un paquete devolvió cifras incompletas). Nunca cuenta como utilizable. |

El JSON incluye `probeSource` para cada cuenta (`live`, `duplicate`, `error` o
`not_probed`). Las cuentas en pausa o excluidas por la política siguen
visibles, pero no se consultan; que no aparezcan en la respuesta de
facturación no se interpreta como cuota cero.

Coste: cada ejecución hace hasta 2 solicitudes de facturación (saldo y vista
previa) por cuenta única, y guarda el resultado en caché durante 15 segundos.
No envía ninguna solicitud a un modelo, no resuelve ningún captcha y no
renueva tokens.

Si el proxy en ejecución no puede escribir los metadatos de las cuentas
(enfriamientos, último uso) en el almacén, porque otro proceso tiene su bloqueo
o por un error de E/S transitorio, el cambio se conserva y se vuelve a escribir
en segundo plano tras 0.25, 1, 4 y 15 segundos; ninguna solicitud lo espera, y
el siguiente cambio lo vuelve a escribir de todos modos.
`zcode-kit accounts doctor` muestra `runtime_changes_unsaved` mientras un
cambio aún no está en disco. Un almacén dañado no se reintenta.
