# zcode-harness-mcp
[English (original)](README.md) · **Deutsch**

Ein lokaler Model-Context-Protocol-Server, der einen MCP-Client mit einer
ZCode-Desktop-Sitzung verbindet. Er bietet sitzungs- und taskbezogene
Steuerung innerhalb konfigurierter Workspaces, Rückfragen und Zugriff auf
Task-Ergebnisse.

## Voraussetzungen

- Node.js 20 oder neuer
- Installiertes und angemeldetes ZCode Desktop
- Ein MCP-Client mit Unterstützung für lokale stdio-Server

## Bauen und starten

Führe diese Befehle in diesem Verzeichnis aus:

```sh
npm install
npm run build
npm run start:stdio
```

Registriere den Befehl `start:stdio` in deinem MCP-Client. Das
Konfigurationsformat ist je nach Client unterschiedlich. Falls ein absoluter
Pfad nötig ist, verwende den Pfad zu diesem Paket.

## Funktionen

Die [Capability-Übersicht](CAPABILITY_MATRIX.de.md) beschreibt die
nutzungsseitig sichtbaren Funktionen.

## Sicherheit

Die Bridge arbeitet mit den Berechtigungen des lokalen Nutzers. Gib ihr nur
Zugriff auf vertrauenswürdige Workspaces. Der Nur-Lese-Modus ist keine
Betriebssystem-Sandbox. Beschränke den Netzwerkzugriff auf den lokalen Rechner
und stelle den Dienst nicht in nicht vertrauenswürdigen Netzwerken bereit.

Siehe die [Sicherheitsrichtlinie](../../SECURITY.de.md).

## Lizenz

MIT; siehe das Repository-[LICENSE](../../LICENSE).
