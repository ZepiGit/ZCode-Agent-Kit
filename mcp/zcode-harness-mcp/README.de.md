# zcode-harness-mcp
[English (original)](README.md) · **Deutsch** · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

> Übersetzung des englischen Originals. Bei Abweichungen gilt das englische
> Original.

Ein lokaler Model-Context-Protocol-Server (MCP), der einem MCP-Client, etwa
einem Coding-Assistenten, Tools der auf diesem Rechner installierten
ZCode-Runtime bereitstellt. Die Bridge startet die Runtime
(`zcode.cjs app-server --stdio`) als Kindprozess und bietet darauf 32 Tools und
eine Reihe von Resources an: Modelle auflisten, Workspaces öffnen, Sitzungen
erstellen, Tasks starten, auf sie warten, Freigabeanfragen beantworten und die
Ergebnisse lesen.

Die Arbeit erledigt die ZCode-Runtime, mit ihren eigenen Tools und der
ZCode-Anmeldung auf diesem Rechner. Die Bridge reicht Anfragen und Ergebnisse
weiter und speichert den Zustand ihrer Tasks. Sie nutzt den Proxy des Kits
nicht, und ihre Registrierung verbindet kein Modell mit deinem Assistenten.

## Voraussetzungen

- Node.js 24 oder neuer. `node` muss im `PATH` liegen, weil die Bridge die
  Runtime mit dem Programmnamen `node` startet.
- ZCode Desktop, installiert und angemeldet. Die Bridge verwaltet die
  ZCode-Anmeldung nicht.
- Ein MCP-Client, der einen lokalen stdio-Server starten kann, oder einer, der
  einen `Authorization`-Header an einen lokalen HTTP-Endpunkt senden kann.

## Die ZCode-Runtime finden

Die Bridge sucht `zcode.cjs` an den Windows-Installationsorten von ZCode
Desktop:

- `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
- `%LOCALAPPDATA%\ZCode\resources\glm\zcode.cjs`
- dieselben beiden Pfade unter `%ProgramFiles%` und `%ProgramFiles(x86)%`
- `%LOCALAPPDATA%\zcode\app.resources\glm\zcode.cjs`

Auf anderen Systemen oder bei einem anderen Installationsort gibst du die Datei
mit `--runtime-path` oder `ZCODE_HARNESS_RUNTIME_PATH` an. Eine Datei wird nur
angenommen, wenn `node <Datei> --version` mit Code 0 endet und eine
Versionsnummer ausgibt. Fehlt eine von dir angegebene Datei oder besteht sie
diese Prüfung nicht, wird keine andere Runtime versucht. Die Datei wird
ausgeführt; gib also nur eine Datei an, der du vertraust.

Wird keine Runtime angenommen, startet die Bridge trotzdem. `zcode_health`
meldet dann `degraded: true` mit dem Grund, und Tools, die die Runtime
brauchen, liefern einen Fehler.

Die Runtime braucht ihre eingebaute Provider-Konfiguration. Die Bridge sucht
`zcode-builtin.json` relativ zur Runtime-Datei, nie im Arbeitsverzeichnis, und
übergibt sie der Runtime in `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`. Ein nichtleeres
`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` in der Umgebung der Bridge hat Vorrang,
danach `ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE`, danach die Datei, die die
Bridge gefunden hat. Geändert wird nur die Umgebung des Runtime-Prozesses, und
`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` wird unverändert durchgereicht. Ist die
gewählte Datei nicht lesbar, wird die Runtime nicht gestartet und keine andere
Datei versucht. Die Pfade stehen in [docs/SECURITY.md](docs/SECURITY.md).

## Installation

Der Release-Installer des Kits und sein npm-Setup enthalten die kompilierte
Bridge (`dist/`) und installieren ihre Abhängigkeiten. Das Setup des Kits kann
die Bridge bei einem Assistenten registrieren; wann es das tut, beschreibt
[harnesses/README.de.md](../../harnesses/README.de.md).

Um aus dem Quellcode zu bauen, führe in diesem Verzeichnis aus:

```sh
npm install
npm run build
npm run probe:runtime
```

`npm run probe:runtime` gibt das Ergebnis der Runtime-Suche als JSON aus.

## Die Bridge registrieren

### stdio

```json
{
  "mcpServers": {
    "zcode-harness": {
      "command": "node",
      "args": [
        "<kit>/mcp/zcode-harness-mcp/dist/index.js",
        "--stdio",
        "--allow-workspace", "<path to your projects>",
        "--interaction-policy", "ask"
      ]
    }
  }
}
```

Verwende absolute Pfade. Jeder Client hat sein eigenes Konfigurationsformat; das
Beispiel zeigt die verbreitete Form `mcpServers`. Eine Nur-Lese-Variante steht
in [examples/config/stdio.mcp.json](examples/config/stdio.mcp.json).

Tools, die einen `workspacePath` erwarten, nehmen nur Verzeichnisse innerhalb
eines erlaubten Wurzelverzeichnisses an. Ohne `--allow-workspace` ist das
einzige erlaubte Wurzelverzeichnis das Verzeichnis `workspaces` im
Datenverzeichnis.

Die Einträge, die das Kit erzeugt, setzen das Node-Flag
`--max-semi-space-size=1` vor den Skriptpfad. Es verkleinert die junge
Generation des V8-Heaps und ist optional.

### HTTP

```sh
node dist/index.js --http --http-key "<random local secret>" --allow-workspace "<path to your projects>"
```

Der Endpunkt ist `http://127.0.0.1:3322/mcp`. Jede Anfrage muss
`Authorization: Bearer <key>` enthalten. Im HTTP-Modus verweigert die Bridge den
Start ohne Schlüssel oder mit einem anderen Host als `127.0.0.1`, `localhost`,
`::1` oder einer weiteren `127.x.x.x`-Adresse. Sie beantwortet nur `POST` und
hält keine Sitzung zwischen Anfragen, sodass mehrere Clients eine Bridge nutzen
können. Eine Client-Konfiguration steht in
[examples/config/http.mcp.json](examples/config/http.mcp.json).

Der HTTP-Code wird nur geladen, wenn `--http` angegeben ist. Eine stdio-Bridge
lädt ihn nie.

## Optionen

Eine unbekannte Option beendet die Bridge beim Start, damit ein falsch
geschriebenes `--read-only` nicht unbemerkt bleibt.

| Option | Umgebungsvariable | Standard | Bedeutung |
| --- | --- | --- | --- |
| `--stdio` | | an | MCP über stdin und stdout. Logs gehen nach stderr. |
| `--http` | | aus | MCP über HTTP statt stdio. |
| `--http-key KEY` | `ZCODE_HARNESS_HTTP_KEY` | keiner | Bearer-Schlüssel. Mit `--http` erforderlich. |
| `--host H` | `ZCODE_HARNESS_HTTP_HOST` | `127.0.0.1` | HTTP-Host. Nur Loopback-Adressen. |
| `--port N` | `ZCODE_HARNESS_HTTP_PORT` | `3322` | HTTP-Port. |
| `--allow-workspace P` | `ZCODE_HARNESS_ALLOW_WORKSPACES` | keines | Erlaubtes Workspace-Wurzelverzeichnis. Wiederhole die Option oder trenne mehrere Pfade mit `;`. |
| `--read-only` | | aus | Tools, die Zustand ändern, liefern `READ_ONLY_MODE`. |
| `--allow-yolo` | `ZCODE_HARNESS_ALLOW_YOLO=1` | aus | Erlaubt Clients den Modus `yolo`, der die Freigabeanfragen der Runtime abschaltet. |
| `--runtime-path FILE` | `ZCODE_HARNESS_RUNTIME_PATH` | Suche | Pfad zu `zcode.cjs`. |
| `--data-dir DIR` | `ZCODE_HARNESS_DATA_DIR` | `~/.zcode-harness-mcp` | Speicherort für Tasks, Ergebnisse, Events und Interaktionen. |
| `--interaction-policy deny\|allowlist\|ask` | `ZCODE_HARNESS_INTERACTION_POLICY` | `deny` | Wie Freigabeanfragen der Runtime beantwortet werden. |
| `--interaction-allowlist A,B` | `ZCODE_HARNESS_INTERACTION_ALLOWLIST` | keine | Exakte Tool-Namen, die die Policy `allowlist` freigibt. Mit dieser Policy erforderlich. |
| `--interaction-timeout-sec N` | `ZCODE_HARNESS_INTERACTION_TIMEOUT_SEC` | `300` | Sekunden, bis eine unbeantwortete Anfrage abgelehnt wird. |
| `--max-concurrent-tasks N` | `ZCODE_HARNESS_MAX_CONCURRENT_TASKS` | `2` | Tasks, die gleichzeitig laufen. Weitere Tasks warten in der Warteschlange. |
| | `ZCODE_HARNESS_TASK_QUEUE_LIMIT` | `50` | Höchstzahl unbeendeter Tasks. |
| | `ZCODE_HARNESS_REQUEST_TIMEOUT_MS` | `60000` | Zeitlimit für eine Anfrage an die Runtime. |
| | `ZCODE_HARNESS_MAX_ARTIFACT_BYTES` | `10485760` | Größte Datei, die `zcode_artifact_read` liest. |
| | `ZCODE_HARNESS_LOG_LEVEL` | `info` | `debug`, `info`, `warn` oder `error`. |
| `--help`, `-h` | | | Gibt die Aufrufzeile aus. |

## Tasks

`zcode_task_start` liefert sofort eine `taskId`. Der Task läuft danach in der
Runtime. `zcode_task_wait` wartet je Aufruf bis zu 120 Sekunden auf sein Ende,
`zcode_task_get` liefert seinen Zustand, `zcode_task_result` seinen Text und die
Einzelheiten, `zcode_task_events` seine Events. `zcode_task_input` sendet
weitere Eingaben, `zcode_task_cancel` bricht ihn ab.
[docs/MCP_API.md](docs/MCP_API.md) beschreibt alle Tools.

- **Gleichzeitigkeit.** Standardmäßig laufen zwei Tasks gleichzeitig, weitere
  Tasks warten in der Warteschlange. Höchstens 50 Tasks dürfen unbeendet sein.
  In einem Workspace läuft immer nur ein schreibender Task, in einer Sitzung
  immer nur ein Task.
- **Aufbewahrung.** Die Bridge behält höchstens 500 beendete Tasks und keinen
  länger als 7 Tage nach seinem Ende. Ein entfernter Task verliert Record,
  Ergebnis und Events; für ihn wird `unknown task: <taskId>` geliefert.
  Unbeendete Tasks und Tasks im Zustand `unknown` werden nie entfernt.
- **Idempotenz.** Ein zweites `zcode_task_start` mit demselben `idempotencyKey`
  liefert den bestehenden Task, statt einen neuen zu starten. Der Schlüssel gilt
  so lange, wie der Task behalten wird; danach startet derselbe Schlüssel einen
  neuen Task.
- **Textgröße.** Der Antworttext eines Tasks ist auf 4 MiB UTF-8 begrenzt. Ein
  längerer Text behält sein erstes 1 MiB und seine letzten 3 MiB, dazwischen
  steht die Zeile `[… N bytes truncated …]`. Ein solches Ergebnis ist als
  `partial` markiert und trägt `truncated.droppedBytes`.
- **Listen.** Ein Task behält höchstens 200 Warnungen, 200 Fehler und 1.000
  Tool-Aufrufe.
- **Events.** Die Events eines Tasks liegen in höchstens zwei Dateien von je
  4 MiB; ältere Events werden verworfen.
- **Neustart.** Nach einem Neustart der Bridge werden unbeendete Tasks als
  `interrupted` markiert. Gespeicherte Ergebnisse beendeter Tasks bleiben
  lesbar.
- **Ende des Clients.** Schließt ein stdio-Client die Verbindung, markiert die
  Bridge unbeendete Tasks als `interrupted`, stoppt die Runtime und beendet
  sich. Sie stoppt nur den Runtime-Prozess, den sie gestartet hat, nicht die
  Prozesse, die die Runtime gestartet hat.

## Freigabeanfragen

Die Runtime fragt, bevor sie bestimmte Tools verwendet, und sie kann dem Nutzer
Rückfragen stellen. `--interaction-policy` legt fest, was mit diesen Anfragen
geschieht:

- `deny` (Standard): Jede Anfrage wird abgelehnt.
- `allowlist`: Eine Freigabeanfrage wird freigegeben, wenn der Tool-Name in
  `--interaction-allowlist` steht, und sonst abgelehnt. Rückfragen an den Nutzer
  werden an den Client weitergereicht.
- `ask`: Die Anfrage wird an den Client weitergereicht. Er antwortet mit
  `zcode_interaction_respond` und kann nur unter den Optionen wählen, die die
  Runtime angeboten hat. Eine Anfrage, die nicht rechtzeitig beantwortet wird,
  wird abgelehnt.

Anfragen für die Tools `Bash`, `PowerShell` und `Shell` werden unter jeder
Policy abgelehnt. Im Nur-Lese-Modus und bei einem mit `readOnly` gestarteten
Task wird jede Anfrage abgelehnt.

## Sicherheit

Die Bridge läuft mit den Rechten deines Benutzers und ist keine Sandbox.

- Workspace-Pfade, Sitzungs-IDs und Dateizugriffe werden gegen die erlaubten
  Wurzelverzeichnisse geprüft, nachdem symbolische Links und Junctions
  aufgelöst wurden.
- `--read-only` sperrt jedes Tool, das Zustand ändert. Ein Task mit `readOnly`
  läuft im Modus `plan` der Runtime, und ihre Schreib- und Shell-Tools sind
  gesperrt; das verhindert nicht, dass ein weiterhin erlaubtes Tool Dateien
  ändert.
- Der Modus `yolo` wird abgelehnt, sofern die Bridge nicht mit `--allow-yolo`
  gestartet wurde.
- Secrets werden in Tool-Ergebnissen, Events, Logs und Fehlermeldungen
  unkenntlich gemacht.
- Die Runtime wird mit festem Programmnamen und einer Argumentliste gestartet,
  nie über eine Shell.
- HTTP ist auf Loopback-Adressen beschränkt und verlangt den Bearer-Schlüssel.

Einzelheiten stehen in [docs/SECURITY.md](docs/SECURITY.md). Die
Sicherheitsrichtlinie des Kits steht in [SECURITY.de.md](../../SECURITY.de.md).

## ZCode 0.16.9

- `zcode_workspace_open` liefert Modus und Slash-Befehle eines Workspaces. Die
  Runtime liefert für einen Workspace kein Standardmodell, keinen Modellkatalog
  und keine Settings-Revision.
- `zcode_models_list` liest den Modellkatalog, indem es eine Sitzung ohne Prompt
  erstellt und wieder schließt. Dabei können Dienste der Runtime starten,
  deshalb ist es im Nur-Lese-Modus gesperrt.
- Modell, Reasoning-Stufe und Modus werden je Sitzung gewählt, mit
  `zcode_model_set` oder den Argumenten von `zcode_task_start`.
  Workspace-Defaults lassen sich weder setzen noch zurücksetzen; die Tools
  liefern einen Fehler und speichern lokal nichts.
- Die vier Einstellungen von `zcode_settings_update` gelten für den gesamten
  Runtime-Prozess, nicht für einen einzelnen Workspace, und werden nicht
  gespeichert. Die Bridge erhält von der Runtime eine Bestätigung, kann die
  Werte aber nicht zurücklesen.
- Ein Modell-Turn über die Bridge ist nicht bestätigt. In einem Test unter
  Windows 11 am 2026-09-23 stand `zai-api/GLM-5.3-Flash` im Katalog, und die
  Auswahl mit der Reasoning-Stufe `low` wurde bestätigt; der Provider wies den
  Turn jedoch mit dem Code `1113` ab (Guthaben oder Ressourcenpaket fehlt). Der
  Nachweis steht in [SUPPORT_MATRIX.json](../../SUPPORT_MATRIX.json). Eine
  Modellanfrage, die über den Proxy des Kits gelingt, sagt nichts über einen
  Turn über die Bridge aus.

Weitere Grenzen stehen in [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

## Tests und Demo

```sh
npm test
```

baut die Bridge und führt die Unit- und Integrationstests gegen einen Ersatz für
die Runtime aus (`test/fixture/fake-harness.mjs`). ZCode wird nicht gebraucht.

```sh
LIVE_TEST=1 LIVE_WORKSPACE="<workspace>" LIVE_DATA_DIR="<data directory>" npm run test:live
```

läuft gegen die installierte ZCode-Runtime und kann Kontingent verbrauchen. Ohne
`LIVE_TEST=1` und `LIVE_WORKSPACE` werden diese Tests übersprungen.

```sh
node examples/demo-client.mjs --workspace "<workspace>"
node examples/demo-client.mjs --fixture
```

geht die Tools aus Sicht eines Clients durch: Health, Capabilities, Workspace,
Modellkatalog, Sitzung, Task, Freigabeanfrage, Ergebnis und ein Folgeauftrag in
derselben Sitzung. Mit `--fixture` nutzt es den Ersatz statt der installierten
Runtime.

## Dokumentation

- [CAPABILITY_MATRIX.de.md](CAPABILITY_MATRIX.de.md): was die Bridge anbietet, nach Bereichen
- [docs/MCP_API.md](docs/MCP_API.md): Tools, Resources, das Task-Ergebnis und seine Grenzen (englisch)
- [docs/SECURITY.md](docs/SECURITY.md): Prüfungen und ihre Grenzen (englisch)
- [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md): was nicht funktioniert oder nicht angeboten wird (englisch)
- [docs/PROTOCOL.md](docs/PROTOCOL.md): wie die Bridge mit der ZCode-Runtime spricht (englisch)

## Lizenz

MIT; siehe [LICENSE](LICENSE).
