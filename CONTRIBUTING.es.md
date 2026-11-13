# Contribuir a ZCode Agent Kit
[English (original)](CONTRIBUTING.md) · [Deutsch](CONTRIBUTING.de.md) · **Español** · [日本語](CONTRIBUTING.ja.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Se aceptan informes de errores, correcciones, documentación y traducciones. Esta guía explica cómo trabajar en el kit desde una copia del código fuente; para instalarlo y usarlo, sigue el [README](README.es.md).

## Requisitos

- Node.js 24 o posterior. La CI hace las pruebas con Node.js 24 y 26.
- Bun 1.4.2. El proxy y el puente MCP ejecutan sus pruebas con Bun, y la CI fija esta versión. En los runners de la CI, Bun 1.4.3 y posteriores elevan el pico de memoria del proxy cuando llega una ráfaga de solicitudes grandes; un Bun más antiguo, como 1.2.20, rechaza el lockfile del puente MCP.
- Git.

## Clonar e instalar

```sh
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git
cd ZCode-Agent-Kit
```

Para enviar una pull request, haz un fork del repositorio en GitHub y sube tu rama a ese fork.

El kit en sí no tiene dependencias de npm. El proxy y el puente MCP tienen las suyas, fijadas en sus archivos `bun.lock`. Instálalas igual que la CI:

```sh
cd zcode-proxy-src && bun install --frozen-lockfile
cd ../mcp/zcode-harness-mcp && bun install --frozen-lockfile
cd ../..
```

Ejecuta la CLI desde la copia del código con `node cli/zcode-kit.mjs <command>`, por ejemplo `node cli/zcode-kit.mjs doctor`. Los comandos que escriben en la configuración de tus asistentes (`setup`, `integrate`, `doctor --fix`, `accounts enable` y `accounts disable`) se niegan a ejecutarse desde una copia del código. Una instalación y una copia del código comparten la misma carpeta personal, y si ambas escribieran, el estado del kit quedaría repartido entre las dos. `integrate <harness> --dry-run` muestra lo que cambiaría sin escribir nada. Define `ZCODE_KIT_ALLOW_CHECKOUT=1` solo cuando de verdad quieras escribir desde la copia del código.

## Ejecutar las pruebas

Ejecuta estos comandos desde la raíz del repositorio:

| Comando | Qué ejecuta |
|---|---|
| `npm run test` | Pruebas del kit con `node --test` |
| `npm run test:proxy` | Pruebas del proxy con `bun test` en `zcode-proxy-src/` |
| `npm run test:mcp` | Compila el puente MCP y luego ejecuta sus pruebas |
| `npm run test:all` | Las tres, más la comprobación de tipos del proxy (`npm run test:proxy-typecheck`) |

El workflow `ci` ejecuta estas suites en cada pull request, en Ubuntu y Windows con Node.js 24 y 26. Además ejecuta dos comprobaciones más lentas:

- Comparación de la salida (`npm run test:ux-before`). Toda salida capturada de `zcode-kit` debe coincidir byte a byte con las referencias de `tests/ux-before/`, así que si cambias lo que imprime un comando, la misma pull request debe incluir los archivos de referencia actualizados. Cuando el job falla, sube la captura nueva como artifact para que veas la diferencia. En Linux la comparación tarda unos 8 minutos y necesita `script` de util-linux; en macOS se omite.
- Presupuesto de memoria (`tests/memory/`). Las ejecuciones que figuran en `tests/memory/expected-red.json` deben fallar y todas las demás deben pasar, de modo que un cambio que arregla una ejecución de la lista también la quita de ese archivo.

## Proponer cambios

- Antes de un cambio grande, como la integración de un asistente nuevo o un cambio en cómo el proxy trata las solicitudes, abre un issue o inicia una [discusión](https://github.com/ZepiGit/ZCode-Agent-Kit/discussions) para acordar el enfoque antes de escribir el código.
- Mantén cada pull request pequeña y centrada en un solo cambio.
- Cuando cambies el comportamiento, añade o actualiza las pruebas que lo cubren.
- Escribe los mensajes de commit al estilo Conventional Commits: `type(scope): summary`. La mayoría de los commits del historial usan los tipos `feat`, `fix`, `docs`, `test`, `ci` y `chore`. El scope es opcional e indica la parte que has cambiado, como `proxy`, `cli`, `mcp` u `omp`. Un ejemplo del historial: `fix(mcp): bridges sharing one data directory leave each other's tasks alone`.
- Un archivo nuevo entra en el paquete de npm solo si la lista de permitidos de `pack/build.mjs` lo incluye.

## Documentación y traducciones

El README está disponible en English, Deutsch, Español, 日本語 y 简体中文. El inglés es el original y las traducciones lo siguen. Los archivos traducidos están junto al archivo en inglés, con un sufijo de idioma (`README.de.md`, `README.es.md`, `README.ja.md`, `README.zh-CN.md`). Otros documentos tienen menos traducciones, así que comprueba qué archivos de idioma hay junto al que cambias.

Cuando cambies documentación en inglés dirigida a los usuarios, actualiza los archivos traducidos en la misma pull request si puedes. Si no puedes, enumera en la descripción de la pull request los archivos que quedan desactualizados para que se puedan actualizar más adelante.

`CHANGELOG.md` se escribe siempre en inglés.

## Primeras contribuciones

Los issues con la etiqueta [`good first issue`](https://github.com/ZepiGit/ZCode-Agent-Kit/labels/good%20first%20issue) están pensados como punto de partida. Deja un comentario en el issue antes de empezar, para que no acaben dos personas trabajando en lo mismo.

## Preguntas e informes de seguridad

Haz tus preguntas en [GitHub Discussions](https://github.com/ZepiGit/ZCode-Agent-Kit/discussions). Informa de los problemas de seguridad como se describe en [SECURITY.es.md](SECURITY.es.md#informar-de-una-vulnerabilidad), nunca en un issue público.
