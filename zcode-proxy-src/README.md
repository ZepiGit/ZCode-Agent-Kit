# ZCode Proxy
**English (original)** · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

This component provides the local model proxy bundled with ZCode Agent Kit.
The Kit manages its setup and integration with assistant tools.

## Use with ZCode Agent Kit

Use the Kit's setup and model commands described in the [main README](../README.md).
The bundled source version and local changes are listed in the
[component manifest](../MANIFEST.md).

## Security

The proxy is intended for trusted local use. Keep it on the local machine and
protect login and configuration data. Some provider challenge flows can execute
provider-supplied JavaScript without an operating-system sandbox; local binding
does not isolate that code. Do not expose the service outside the local
machine. Read the [security policy](../SECURITY.md) for details.

## Licensing

This bundled component may have terms separate from the Kit. Check the
[manifest](../MANIFEST.md) and the applicable upstream notices before
redistributing it.
