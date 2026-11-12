# Capability-Übersicht der MCP-Bridge
[English (original)](CAPABILITY_MATRIX.md) · **Deutsch**

Diese Übersicht führt nach Bereichen auf, was die Bridge anbietet.
[docs/MCP_API.md](docs/MCP_API.md) beschreibt jedes Tool. Das Tool
`zcode_capabilities` liefert die Registry der Bridge mit einem Eintrag je
Methode der ZCode-Runtime, einschließlich der Angabe, ob und wie sie geprüft
wurde.

| Bereich | Was die Bridge anbietet | Tools |
|---|---|---|
| Discovery | Zustand der Bridge und der Runtime; die Capability-Registry; die Listen der Runtime zu MCP-Servern, Plugins und Skills sowie ihre Nutzungsstatistik; eine feste Auswahl lesender Runtime-Methoden. | `zcode_health`, `zcode_capabilities`, `zcode_operations_list`, `zcode_operation_describe`, `zcode_operation_invoke` |
| Modelle | Der Modellkatalog der Runtime. Zum Lesen wird eine Sitzung ohne Prompt erstellt und wieder geschlossen. | `zcode_models_list` |
| Workspaces | Die erlaubten Wurzelverzeichnisse; Modus und Slash-Befehle eines Workspaces. Die Runtime liefert für einen Workspace kein Standardmodell, keinen Katalog und keine Settings-Revision. | `zcode_workspaces_list`, `zcode_workspace_open` |
| Sitzungen | Sitzungen auflisten, erstellen, lesen, fortsetzen, forken, schließen und kompaktieren; das Sitzungsziel lesen und ändern; Modell, Reasoning-Stufe und Modus je Sitzung wählen. | `zcode_sessions_list`, `zcode_session_create`, `zcode_session_get`, `zcode_session_resume`, `zcode_session_fork`, `zcode_session_close`, `zcode_session_compact`, `zcode_session_goal`, `zcode_model_set` |
| Tasks | Arbeit starten, ihren Zustand prüfen, auf sie warten, weitere Eingaben senden, sie abbrechen. Standardmäßig laufen zwei Tasks gleichzeitig; weitere warten in der Warteschlange. | `zcode_task_start`, `zcode_task_get`, `zcode_tasks_list`, `zcode_task_wait`, `zcode_task_input`, `zcode_task_cancel` |
| Ergebnisse | Das Ergebnis eines Tasks mit Text, Verbrauch, Tool-Aufrufen und geänderten Dateien; seine Events; der Inhalt von Dateien im Workspace. | `zcode_task_result`, `zcode_task_events`, `zcode_artifact_read` |
| Freigabeanfragen | Freigabeanfragen und Rückfragen der Runtime auflisten und mit einer der angebotenen Optionen beantworten. Welche Anfragen den Client erreichen, hängt von `--interaction-policy` ab. | `zcode_interactions_list`, `zcode_interaction_respond` |
| Einstellungen | Vier Einstellungen des Runtime-Prozesses; ein Schema der bekannten Einstellungen; eine Nur-Lese-Sicht auf ausgewählte Einstellungen von ZCode Desktop. Workspace-Defaults lassen sich weder setzen noch zurücksetzen. | `zcode_settings_schema`, `zcode_settings_get`, `zcode_settings_update`, `zcode_settings_reset` |
| Nur-Lese-Modus | Mit `--read-only` liefert jedes Tool, das Zustand ändert, einen Fehler, ebenso `zcode_models_list`. Workspaces, Sitzungen, Tasks, Ergebnisse und Dateien lassen sich weiterhin lesen. | |

## Grenzen

- Die Bridge behält höchstens 500 beendete Tasks und keinen länger als 7 Tage
  nach seinem Ende. Ein `idempotencyKey` gilt so lange, wie sein Task behalten
  wird.
- Der Antworttext eines Tasks ist auf 4 MiB begrenzt; ein längerer Text behält
  sein erstes 1 MiB und seine letzten 3 MiB.
- Ein Task behält höchstens 200 Warnungen, 200 Fehler und 1.000 Tool-Aufrufe.
- In einem Workspace läuft immer nur ein schreibender Task.

## Hinweise

- Die Einstellungen von `zcode_settings_update` gelten für den gesamten
  Runtime-Prozess, nicht für einen einzelnen Workspace, und werden nicht
  gespeichert. Die Bridge erhält eine Bestätigung, kann die Werte aber nicht
  zurücklesen.
- Ein Modell-Turn über die Bridge ist nicht bestätigt. Im aufgezeichneten Test
  mit ZCode 0.16.9 unter Windows 11 stand `zai-api/GLM-5.3-Flash` im Katalog,
  und die Auswahl mit der Reasoning-Stufe `low` wurde bestätigt; der Provider
  wies den Turn jedoch mit dem Code `1113` ab (Guthaben oder Ressourcenpaket
  fehlt). Eine Anfrage, die über den Proxy des Kits gelingt, sagt nichts über
  einen Turn über die Bridge aus.
- Die Bridge übergibt der Runtime ihre Provider-Konfiguration nur über die
  Umgebung des Runtime-Prozesses und behält Werte bei, die du selbst gesetzt
  hast. Reihenfolge und Pfade stehen in [docs/SECURITY.md](docs/SECURITY.md).
- Der Nur-Lese-Modus ist keine Betriebssystem-Sandbox. Für eine stärkere
  Isolation verwende einen separaten Workspace, der nur die Dateien enthält,
  die ein Agent benötigt.
