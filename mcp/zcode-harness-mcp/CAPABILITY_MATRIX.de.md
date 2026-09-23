# Capability-Übersicht der MCP-Bridge
[English (original)](CAPABILITY_MATRIX.md) · **Deutsch**

Diese Übersicht beschreibt die für Nutzende sichtbaren Funktionen. Der genaue
Werkzeugumfang kann sich zwischen Releases ändern.

| Bereich | Funktion |
|---|---|
| Workspaces | Nativ 0.16.9 nur Präsentation; kein Katalog, keine persistenten Defaults oder Settings-Revision. Workspace-Setter/Reset sind ohne Ersatz nicht unterstützt. |
| Sitzungen | Sitzungen starten/fortsetzen; Modell, Reasoning und Modus über native Session-Setter wählen. Der vollständige Katalog erfordert eine eigene deferred Session ohne Prompt, die wieder geschlossen wird. |
| Tasks | Aufgaben senden, ihren Fortschritt prüfen und laufende Tasks abbrechen. |
| Rückfragen | Antworten auf Fragen oder Freigabeanfragen des Hosts zurückgeben. |
| Nur-Lese-Modus | Präsentationsabfragen bleiben verfügbar; vollständige Katalogabfragen sind gesperrt, weil Session-Erstellung Runtime-Dienste initialisieren kann. Keine Betriebssystem-Sandbox. |
| Ergebnisse | Task-Status und zurückgegebene Ergebnisse prüfen. |

Runtime-Präferenzen betreffen den geteilten App-Server-Prozess, nicht persistente
Workspace-Defaults; native Bestätigung ist kein unabhängiges Read-back. Im aktuellen
nativen Katalog ist `zai-api/GLM-5.3-Flash` nachgewiesen, native Flash-Inferenz jedoch
unter Windows/ZCode 0.16.9 nach bestätigter Modell-/`low`-Auswahl durch Upstream
`1113` (Guthaben/Ressourcenpaket fehlt) blockiert. Proxy-Erfolg ist separat;
0.16.5-Nachweise sind historisch.
Der Provider-Bootstrap ändert nur die Kindprozess-Umgebung und wahrt explizite Overrides;
Priorität und Pfadauflösung stehen unter [Sicherheit](docs/SECURITY.md).

Für eine stärkere Isolation verwende einen separaten Workspace, der nur die
Dateien enthält, die ein Agent benötigt.
