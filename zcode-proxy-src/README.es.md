# ZCode Proxy
[English (original)](README.md) · [Deutsch](README.de.md) · **Español** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

Este componente proporciona el proxy local de modelos incluido en ZCode Agent
Kit. El Kit se encarga de configurarlo e integrarlo con los asistentes.

## Uso con ZCode Agent Kit

Usa los comandos de configuración y modelos descritos en el
[README principal](../README.es.md). La versión del código incluida y sus
cambios locales figuran en el [manifiesto de componentes](../MANIFEST.md).

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
