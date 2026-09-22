# ZCode Proxy
[English (original)](README.md) · **Deutsch** · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

Diese Komponente stellt den lokalen Modell-Proxy bereit, der mit dem ZCode
Agent Kit gebündelt wird. Das Kit übernimmt Einrichtung und Integration mit
Assistenten.

## Mit dem ZCode Agent Kit verwenden

Verwende die Setup- und Modellbefehle aus der [Haupt-README](../README.de.md).
Die gebündelte Quellversion und lokale Änderungen stehen im
[Komponentenmanifest](../MANIFEST.de.md).

## Sicherheit

Der Proxy ist für den vertrauenswürdigen lokalen Einsatz gedacht. Betreibe ihn
nur auf dem lokalen Rechner und schütze Login- und Konfigurationsdaten. Einige
Provider-Challenges können vom Provider bereitgestelltes JavaScript ohne
Betriebssystem-Sandbox ausführen; die lokale Bindung isoliert diesen Code
nicht. Lies die [Sicherheitsrichtlinie](../SECURITY.de.md) und mache den Dienst
nicht außerhalb deines Rechners erreichbar.

## Lizenzierung

Für diese gebündelte Komponente können andere Bedingungen als für das Kit
gelten. Prüfe vor einer Weiterverteilung das
[Manifest](../MANIFEST.de.md) und die jeweils geltenden Upstream-Hinweise.
