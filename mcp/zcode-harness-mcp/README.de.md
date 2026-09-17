# zcode-harness-mcp (Deutsch)

[English](README.md) | [中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | **Deutsch**

> Übersetzung des englischen Originals; bei Abweichungen gilt das englische README.

Ein MCP-Server (stdio **und** Streamable-HTTP), mit dem andere Modelle und Agents den **echten installierten ZCode-Harness** steuern können: Fähigkeiten entdecken, Modelle auswählen, Einstellungen lesen/ändern, Workspaces und Sessions verwalten, Aufgaben starten, Rückfragen beantworten, Fortschritt beobachten und vollständige Ergebnisse inklusive Dateiänderungen und Artefakte abrufen.

Die Bridge ist ein **Steuer-Layer**, kein Chat-Client und kein Prompt-Wrapper: Alle Arbeit wird durch die originale ZCode-Runtime (`zcode.cjs app-server --stdio`, lokal installiert) mit deren Werkzeugen, Kontextverwaltung und Berechtigungen ausgeführt.

- Protokoll: MCP (offizielles SDK) nach außen, **ZCode Protocol v1** (NDJSON über stdio, live gegen 0.16.5 verifiziert) nach innen — siehe [`docs/PROTOCOL.md`](docs/PROTOCOL.md).
- Umfang: 32 MCP-Tools + MCP-Resources; Capability-Registry mit 45 Einträgen ([`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md)).
- `npm test` nutzt deterministische lokale Fixtures. Live-Tests benötigen Opt-in; alte Berichte sind keine aktuelle Abnahme.
- Audit-Härtung: Session-IDs sind Workspace-gebunden; `yolo` benötigt `--allow-yolo`. Tool-Allowlist nutzt exakte Namen; Bash, PowerShell und Shell werden abgelehnt. Artefakte sind größenbegrenzt, JSONL behält zwei Dateien mit höchstens je 4 MiB. EOF unterbricht Aufgaben und beendet das Kind geordnet; Windows-Prozessbaum-Isolation ist nicht garantiert. `--runtime-path` führt Code aus: nur vertrauenswürdige Dateien verwenden.

## Voraussetzungen

- Windows 10/11 (getestet) oder ein OS mit `node` im PATH
- Node.js ≥ 20 (`node --version`); das Skript startet den Harness mit dem festen Programmnamen `node`
- Installierter ZCode (Desktop). Die Bridge findet `zcode.cjs` automatisch unter
  - `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
  - `%ProgramFiles%\ZCode\resources\glm\zcode.cjs`
  - alternativ explizit: `--runtime-path` bzw. `ZCODE_HARNESS_RUNTIME_PATH`
- Angemeldeter ZCode (der Harness nutzt die lokale Z.AI-OAuth-Anmeldung; die Bridge **verwaltet keine Zugangsdaten** und redigiert Geheimnisse in allen Ausgaben)

## Installation (Windows / PowerShell)

Im ZCode-Agent-Kit-Checkout liegt die Bridge bereits unter `mcp/zcode-harness-mcp/` — das Klonen entfällt, direkt in das Verzeichnis wechseln.

```powershell
cd $HOME
git clone <dieses-repo> zcode-harness-mcp   # oder Ordner kopieren
cd zcode-harness-mcp
npm install
npm run build
# Selbsttest der Runtime-Erkennung:
npm run probe:runtime
```

## Quickstart

### 1) Als MCP-Server in einem MCP-Client (stdio) registrieren

Beispiel-Konfiguration (z. B. `claude_desktop_config.json` bzw. `.mcp.json`):

```json
{
  "mcpServers": {
    "zcode-harness": {
      "command": "node",
      "args": [
        "C:\\Users\\<you>\\zcode-harness-mcp\\dist\\index.js",
        "--stdio",
        "--allow-workspace", "C:\\Users\\<you>\\Projects",
        "--interaction-policy", "ask"
      ]
    }
  }
}
```

### 2) Streamable-HTTP-Modus (mehrere Clients, explizit aktiviert)

```powershell
node dist\index.js --http --http-key "<random-local-secret>" --host 127.0.0.1 --port 3322 --allow-workspace "C:\Users\<you>\Projects"
# MCP-Endpunkt: http://127.0.0.1:3322/mcp   (nur localhost; keine öffentliche Freigabe)
```

### 3) Demo aus Sicht eines anderen Agents

```powershell
# gegen die echte Installation:
node examples\demo-client.mjs --workspace "C:\Users\<you>\demo-workspace"
# offline gegen den Fixture-Harness:
node examples\demo-client.mjs --fixture
```

Der Demo-Client zeigt den kompletten Ablauf: Fähigkeiten entdecken → Workspace öffnen → echten Modellkatalog lesen → GLM-5.3-Flash-Prüfung (kein stiller Modellwechsel) → Einstellung ändern → Aufgabe starten → Fortschritt pollen → Rückfragen beantworten → Ergebnis + Artefakte lesen → Folgeauftrag in derselben Session.

### 4) Tests

```powershell
npm test          # Build + Unit + Integration (Fixture-Harness, deterministisch)
npm run test:live # Live-Tests nur mit ausdrücklichem Opt-in (echte Installation/Quota): $env:LIVE_TEST="1"; $env:LIVE_WORKSPACE="C:\..."; $env:LIVE_DATA_DIR="C:\..."
```

## Wichtigste Kommandozeilen-Flags

| Flag | Bedeutung |
| --- | --- |
| `--stdio` | MCP über stdin/stdout (Standard) |
| `--http --http-key KEY --port N --host H` | Streamable-HTTP-Modus mit Bearer-Key (Standard 127.0.0.1:3322) |
| `--read-only` | Mutierende Tools werden abgewiesen (technisch enforced, nicht nur annotiert) |
| `--allow-workspace P` | Workspace-Root freigeben (mehrfach möglich; `;`-Liste via `ZCODE_HARNESS_ALLOW_WORKSPACES`) |
| `--runtime-path P` | Expliziter Pfad zu `zcode.cjs` |
| `--data-dir D` | Persistenzverzeichnis (Standard `~/.zcode-harness-mcp`) |
| `--interaction-policy deny\|allowlist\|ask` | Wie Berechtigungsanfragen beantwortet werden (Standard: `deny`) |
| `--interaction-allowlist "Read,Glob"` | exakte Toolnamen für `allowlist` (Shell-Tools verweigert) |
| `--max-concurrent-tasks N` | Parallelität (Standard 2; Überschüsse werden gequeued) |

## Sicherheitsmodell (Kurzfassung)

- Workspace-Allowlist mit echter Pfadauflösung (Symlinks/Junctions) für Tasks **und** Artefakt-Lesezugriffe
- Read-only-Modus: mutierende Tools liefern Fehler; Task-`readOnly` setzt zusätzlich Harness-seitig Plan-Modus + Write-Tool-Denylist durch
- Secret-Redaction in allen Tool-Ausgaben, Logs und Events; Credentials werden nie exponiert oder verwaltet
- Prozessstart ausschließlich mit Argument-Arrays (`shell: false`), festes Programm (`node`), keine Shell-Strings
- Rückfragen (Permissions/User-Input) werden nie automatisch erweitert: Policy `deny` (Standard), `allowlist` oder `ask` mit Timeout → sichere Default-Antwort (deny)
- Kein Registrieren der Bridge in der eigenen ZCode-Runtime, keine öffentliche Netzwerkfreigabe, kein Auto-Plugin-Install

Details: [`docs/SECURITY.md`](docs/SECURITY.md) · Ehrliche Grenzen: [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)

## Status

Aktueller Implementierungs- und Verifikationsstand: [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) · Testnachweise: [`TEST_REPORT.md`](TEST_REPORT.md) · API-Referenz: [`docs/MCP_API.md`](docs/MCP_API.md)

## Lizenz

MIT. Die Referenz-Repos [zcode-acp](https://github.com/william0wang/zcode-acp) (Apache-2.0) und [zcode-open-bridge](https://github.com/tizerluo/zcode-open-bridge) (MIT) wurden als Protokollquellen recherchiert (Commits dokumentiert in `docs/PROTOCOL.md`); übernommener Code: keiner.
