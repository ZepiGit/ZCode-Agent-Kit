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

Der gebündelte Providerpfad wird relativ zum verifizierten Runtime-Einstiegspunkt
aufgelöst, nicht zum Arbeitsverzeichnis. Nichtleeres
`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` hat Vorrang vor
`ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE`, danach folgt das erkannte Bundle.
Nur die Kindprozess-Umgebung wird angepasst; `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`
bleibt erhalten, die Elternumgebung unverändert. Ein ungültiger expliziter Seed
führt zum Fehler statt zum Fallback. Die native Konfigurationsmaterialisierung
bleibt beim Anbieter. Siehe [Sicherheitsdetails](docs/SECURITY.md).

## Funktionen

Die [Capability-Übersicht](CAPABILITY_MATRIX.de.md) beschreibt die
nutzungsseitig sichtbaren Funktionen.

Nativ 0.16.9: `workspace/readPresentation` liefert nur die Präsentation, keine
Defaults, keinen Katalog und keine Settings-Revision. `zcode_models_list` erstellt
und schließt eine eigene deferred Session ohne Prompt; dabei können Runtime-Dienste
initialisiert werden, daher unter `--read-only` gesperrt. Native Modell-/Modus-/
Reasoning-Auswahl pro Session bleibt möglich; persistente Workspace-Setter/Reset
sind ohne lokalen Ersatz nicht unterstützt. Runtime-Präferenzen gelten für den
geteilten App-Server-Prozess; ihre Bestätigung ist kein unabhängiges Read-back.
Siehe [API-Details](docs/MCP_API.md).

Im aktuellen nativen Katalog wurde `zai-api/GLM-5.3-Flash` nachgewiesen; native
Flash-Anfrage unter Windows mit ZCode 0.16.9 und Reasoning `low` wurde mit
Upstream-Code `1113` (Guthaben/Ressourcenpaket fehlt) blockiert. Eine native
Flash-Antwort wird nicht behauptet. Proxy-Erfolg ist kein MCP-Modellerfolg;
0.16.5-Beobachtungen in den technischen Dokumenten sind historisch.

## Sicherheit

Die Bridge arbeitet mit den Berechtigungen des lokalen Nutzers. Gib ihr nur
Zugriff auf vertrauenswürdige Workspaces. Der Nur-Lese-Modus ist keine
Betriebssystem-Sandbox. Beschränke den Netzwerkzugriff auf den lokalen Rechner
und stelle den Dienst nicht in nicht vertrauenswürdigen Netzwerken bereit.

Siehe die [Sicherheitsrichtlinie](../../SECURITY.de.md).

## Lizenz

MIT; siehe das Repository-[LICENSE](../../LICENSE).
