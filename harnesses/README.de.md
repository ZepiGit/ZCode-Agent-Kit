# Assistenten-Anleitungen
[English (original)](README.md) · **Deutsch** · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

> Übersetzung des englischen Originals; bei Abweichungen gilt das englische README.

Diese Seite beschreibt für jeden unterstützten Coding-Assistenten, was du ausführst, was das Kit schreibt und was du selbst noch tun musst. Die Installation steht im [Haupt-README](../README.de.md). Die CLI nennt einen Assistenten „Harness“, daher `--harness`.

Das Kit braucht Node.js 24 oder neuer; unter Node.js 20 und 22, die nicht mehr unterstützt werden, brechen `zcode-kit setup` und `zcode-kit update` ab, ohne etwas zu ändern. Die Release-Installer installieren Bun 1.4.2, wenn Bun fehlt. `zcode-kit --version` gibt die installierte Version aus; `zcode-kit help` listet alle Befehle auf.

## Assistenten im Setup auswählen

`zcode-kit setup` sucht nach installierten Assistenten und richtet nur die ein, denen du zustimmst.

- **In einem Terminal** zeigt es die erkannten Assistenten als Checkbox-Liste: Die Pfeiltasten bewegen die Markierung, die Leertaste setzt oder entfernt ein Häkchen, `a` schaltet alle um, Enter bestätigt. Angehakte Assistenten werden eingerichtet, die übrigen übersprungen. Esc oder Enter ohne ein einziges Häkchen speichert keine Antwort.
- **In einem Terminal ohne Farbe oder Cursorsteuerung oder in einem, das für die Liste zu klein ist,** fragt es für jeden Assistenten einzeln `Configure ZCode for <Assistent>? [y/n]`. `zcode-kit setup --select` zeigt stattdessen eine nummerierte Liste und nimmt Nummern, `all` oder `none` entgegen.
- **Ohne Terminal** (CI, Pipe) fragt es nichts und überspringt jeden Assistenten, für den keine Antwort gespeichert ist. Nenne die Assistenten dann selbst: `zcode-kit setup --harness omp,codex` oder `ZCODE_KIT_HARNESSES=omp,codex` richtet genau diese ein. `none` überspringt alle erkannten Assistenten; eine unbekannte ID ist ein Fehler.

Die Antworten werden unter `generated/harness-choices/` gespeichert und von späteren Setups, `zcode-kit update` und `zcode-kit doctor --fix` wiederverwendet: Wozu du zugestimmt hast, wird aktuell gehalten, was du abgelehnt hast, bleibt unberührt, und du wirst nicht erneut gefragt. `zcode-kit setup --reask` fragt in einem Terminal erneut, und `zcode-kit doctor --forget <Assistent>` löscht eine gespeicherte Antwort. Eine Integration, die dieses Kit früher angelegt hat, kann auch dann aktualisiert werden, wenn für sie keine Antwort gespeichert ist.

Strg+C beendet das Setup mit Exit-Code 130. Eine nicht bestätigte Checkbox-Liste wird nicht angewendet; bereits gegebene y/n-Antworten bleiben angewendet. Schlägt ein Assistent fehl, werden seine Teiländerungen zurückgenommen, die anderen werden trotzdem eingerichtet, und das Setup endet mit Exit-Code 20. Das Setup gibt den `zcode-kit rollback`-Befehl aus, der seine Änderungen rückgängig macht. Ein eingerichteter Assistent bedeutet, dass die Dateien geschrieben wurden, nicht, dass die Anmeldung funktioniert oder ein Modell antwortet; die Anmeldung prüfst du mit `zcode-kit auth status`.

## Einen einzelnen Assistenten einrichten

```sh
zcode-kit integrate <Assistent> --dry-run   # listet auf, was geschrieben würde, und schreibt nichts
zcode-kit integrate <Assistent>             # schreibt es und speichert deine Zustimmung
zcode-kit rollback                          # macht die letzte Änderung rückgängig
```

`--dry-run` gibt für jede Datei, die sich ändern würde, eine Zeile `would write` aus. Der echte Lauf speichert außerdem ein Ja für diesen Assistenten, sodass spätere Setups und Updates ihn aktuell halten. Die MCP-Bridge registriert er nie. In einem Git-Checkout des Kits schreiben `setup` und `integrate` nur, wenn `ZCODE_KIT_ALLOW_CHECKOUT=1` gesetzt ist.

## Übersicht

| Assistent (ID) | Das Setup schreibt | Start | Mit Modellantwort getestet |
|---|---|---|---|
| OMP (`omp`) | Provider `zcode` in `~/.omp/agent/models.yml`, eine Autostart-Erweiterung | `omp --model zcode/glm-5.3-flash` | Windows, Version 18.2.9 |
| pi (`pi`) | Provider `zcode` in `~/.pi/agent/models.json` | `zcode-kit proxy start`, dann `pi --model zcode/glm-5.3` | Windows, Version 0.85.0 |
| Claude Code (`claude-code`) | `generated/claude-zcode-settings.json` | `zcode-kit run claude-code -- <args>` | Windows, Version 2.1.278 |
| Codex CLI (`codex`) | `generated/codex-home/config.toml` | `zcode-kit run codex -- <args>` | Windows, Version 0.155.1 |
| OpenCode (`opencode`) | Provider `zcode` in der Konfigurationsdatei von OpenCode | `zcode-kit run opencode -- <args>` | Windows, Version 1.18.29 |
| Aider (`aider`) | `generated/aider-zcode.env` | `zcode-kit run aider -- <args>` | Windows, Version 0.86.2 |
| Continue (`continue`) | zwei Modelle in `~/.continue/config.yaml` | `zcode-kit proxy start`, dann das Modell in Continue auswählen | nein |
| Goose (`goose`) | `zcode.json` im Ordner `custom_providers` von Goose | `zcode-kit proxy start`, dann `goose session --provider zcode` | nein |
| Cline (`cline`) | `generated/cline-zcode-values.md` | die Werte in Cline eintragen, dann `zcode-kit proxy start` | nein |
| Kilo Code (`kilo-code`) | `generated/kilo-zcode-values.md` | die Werte in Kilo Code eintragen, dann `zcode-kit proxy start` | nein |

Die letzte Spalte stammt aus der [Support-Matrix](../SUPPORT_MATRIX.json): Windows 11, 2026-09-23, Kit v0.2.33, `glm-5.3-flash`. Unter Linux oder macOS wurde nichts mit einer echten Modellantwort getestet. Bei den Zeilen mit „nein“ wurde nur das Schreiben der Konfiguration getestet, ohne den Assistenten selbst.

`generated/` und der lokale Schlüssel `.proxykey` liegen bei Release-Installationen und Quellcode-Checkouts im Kit-Verzeichnis, bei npm-Installationen in einem separaten Zustandsverzeichnis außerhalb von `node_modules`. Einige der geschriebenen Dateien enthalten den Schlüssel im Klartext; gib sie nicht weiter und führe `zcode-kit setup` erneut aus, wenn sich der Schlüssel ändert.

`zcode-kit run <Assistent> -- <args>` gibt es für Claude Code, Codex CLI, OpenCode und Aider. Der Befehl startet bei Bedarf den Proxy und reicht alles nach `--` an den Assistenten weiter. Die Skripte `bin/zcode-claude`, `bin/zcode-codex` und `bin/zcode-aider` (`.cmd` oder `.sh`) im Kit-Verzeichnis tun dasselbe.

## Hinweise je Assistent

### OMP

Starte OMP direkt; `zcode-kit run omp` gibt es nicht. Die Thinking-Stufe wählst du mit `--thinking low`, `high` oder `max`; als Standard trägt das Kit `max` ein. Das Setup fügt einen markierten Block in `models.yml` ein und kopiert die Erweiterung nach `~/.omp/agent/extensions/`. Wenn `config.yml` existiert, trägt es die Erweiterung dort ein und entfernt `zcode` aus `disabledProviders`. Es überspringt OMP, wenn `models.yml` nicht existiert, und ändert nichts, wenn die Datei einen `zcode`-Provider enthält, den du selbst geschrieben hast.

Die Erweiterung startet den Proxy bei der ersten Anfrage von OMP an ein `zcode`-Modell. Die Startprüfung läuft in einem eigenen Prozess und höchstens 120 Sekunden. Schlägt sie fehl, gibt OMP eine Zeile `[zcode-autostart]` mit dem Grund aus und versucht es frühestens 60 Sekunden später erneut. Die Erweiterung speichert den Pfad des Node.js, das das Setup gefunden hat; wurde dieses Node.js entfernt oder ist es älter als Version 24, führe `zcode-kit setup` erneut aus und starte OMP neu.

### pi

pi startet den Proxy nicht selbst. Der Eintrag verwendet das Anthropic-Messages-Format, und deine anderen Provider bleiben erhalten. Der Schlüssel steht nicht in der Datei: pi holt ihn, indem es das Kit-Skript `proxy/resolve-zcode-proxy-key.mjs` ausführt. Das Setup überspringt pi, wenn `~/.pi/agent` nicht existiert, und ändert nichts, wenn die Datei einen `zcode`-Provider enthält, den nicht das Kit geschrieben hat. Für pi legt das Kit keine Thinking-Stufen fest.

### Claude Code

`~/.claude/settings.json` wird nicht geändert. `zcode-kit run claude-code -- <args>` ruft `claude --settings <erzeugte Datei> <args>` auf; nur dieser Aufruf geht an ZCode, und das normale `claude` läuft wie bisher. Die Einstellungen nutzen `glm-5.3` als Hauptmodell und `glm-5.3-flash` als kleines, schnelles Modell; mit `--model glm-5.3-flash` verwendest du durchgehend Flash. Anthropic unterstützt Claude Code mit anderen Modellen als Claude nicht offiziell.

### Codex CLI

`zcode-kit run codex -- <args>` setzt `CODEX_HOME` für diesen Aufruf auf `generated/codex-home`; `~/.codex` und das normale `codex` bleiben, wie sie sind. Weil es ein eigenes Home ist, gelten deine eigenen Codex-Einstellungen, Skills, Regeln und MCP-Server dort nicht. Die `config.toml` darin nutzt die Responses API mit `glm-5.3` als Standardmodell und enthält immer einen Eintrag für die MCP-Bridge des Kits. Unter Windows setzt sie außerdem `sandbox = "unelevated"` unter `[windows]`.

### OpenCode

Das Setup bearbeitet die Datei, die `OPENCODE_CONFIG` nennt, sonst `opencode.jsonc` oder `opencode.json` in `OPENCODE_CONFIG_DIR`, `$XDG_CONFIG_HOME/opencode` oder `~/.config/opencode`, und legt sie an, wenn sie fehlt. Andere Einstellungen sowie Kommentare außerhalb des Abschnitts `provider` bleiben erhalten. Ein `zcode`-Provider, den nicht das Kit geschrieben hat, bricht die Änderung mit einem Fehler ab. Der Eintrag liest den Schlüssel aus der Umgebungsvariable `ZCODE_PROXY_KEY`, die `zcode-kit run opencode` setzt. Startest du `opencode` direkt, setze die Variable selbst und starte vorher den Proxy. `glm-5.3-flash` hat die Varianten `low`, `high` und `max`; Standard ist `low`.

### Aider

`zcode-kit run aider` setzt `OPENAI_API_BASE` und `OPENAI_API_KEY` nur für diesen einen Prozess; systemweit wird nichts gesetzt, und `~/.aider.conf.yml` bleibt unberührt. Ohne Argumente läuft `aider --model openai/glm-5.3`. Mit Argumenten nennst du das Modell selbst, zum Beispiel `zcode-kit run aider -- --model openai/glm-5.3-flash`. `generated/aider-zcode.env` enthält dieselben Werte für die manuelle Nutzung.

### Continue

Das Setup hängt „ZCode GLM-5.3“ und „ZCode GLM-5.3-Flash“ in einem markierten Block ans Ende der Liste `models:` an; vorhandene Modelle bleiben. Das Setup überspringt Continue, wenn `config.yaml` nicht existiert; sobald die Datei da ist, führe `zcode-kit integrate continue` aus. Eine Liste `models:`, die mit Einträgen in einer einzigen Zeile steht, wird nicht bearbeitet; schreibe sie vorher als Blockliste um.

### Goose

Der Ordner ist unter Windows `%APPDATA%\Block\goose\config\custom_providers`, unter macOS und Linux `~/.config/goose/custom_providers`. Der Schlüssel steht nicht in `zcode.json`; Goose holt ihn, indem es das Schlüssel-Skript des Kits ausführt. Eine `zcode.json`, die nicht dieses Kit geschrieben hat, wird nicht überschrieben.

### Cline und Kilo Code

Das Kit schreibt nicht in den Speicher, den VS Code für diese Erweiterungen führt. Das Setup schreibt eine Datei mit den Werten, und du trägst sie einmal in den Einstellungen der Erweiterung ein:

- **Cline:** API Provider „OpenAI Compatible“, die Basis-URL mit `/v1` am Ende, der Schlüssel und eine Modell-ID. Die Datei nennt auch den Befehl `cline auth` für die Cline-CLI.
- **Kilo Code:** ein Custom Provider mit der API „Anthropic Messages“, die Basis-URL mit `/v1` am Ende, der Schlüssel und beide Modelle, die du von Hand hinzufügst. `kilo.jsonc` schreibt das Kit nicht.

Die beiden Dateien enthalten den Schlüssel nicht; gib ihn mit `zcode-kit models --show-key` aus. Das Setup findet die Erweiterungen nur in `~/.vscode/extensions`. Für einen anderen Editor führst du `zcode-kit integrate cline` oder `zcode-kit integrate kilo-code` aus.

## MCP-Bridge

Die Bridge `zcode-harness` ist ein lokaler MCP-Server, über den ein Assistent mit Sessions und Tasks deines installierten ZCode arbeiten kann. Sie zu registrieren verbindet kein Modell.

Das Setup registriert die Bridge für OMP (in `~/.omp/agent/mcp.json`) und für Claude Code (`claude mcp add zcode-harness --scope user`), wenn du den Assistenten anhakst, für ihn mit `y` antwortest oder ihn mit `--harness` nennst; die Liste und die Fragen weisen darauf hin. `--no-mcp` lässt die Bridge weg, und `integrate` registriert sie nie. Bei Claude Code ist das die einzige Änderung an deiner normalen Konfiguration; `claude mcp remove zcode-harness --scope user` oder `zcode-kit uninstall` entfernt sie wieder. Andere MCP-Clients können diesen Eintrag verwenden:

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["--max-semi-space-size=1", "<absoluter-kit-installationspfad>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

Die Bridge braucht ein installiertes und angemeldetes ZCode Desktop, und ihre Modellliste kann von der des Proxys abweichen. Im aufgezeichneten Test (Windows 11, ZCode 0.16.9, 2026-09-23) hat sie GLM-5.3-Flash aufgelistet und ausgewählt, der Anbieter hat die Modellanfrage aber mit Code 1113 (unzureichendes Guthaben) abgelehnt; eine Modellantwort über die Bridge ist daher nicht bestätigt. Mehr steht in der [Dokumentation der Bridge](../mcp/zcode-harness-mcp/README.de.md).

## Andere Clients

Jeder Client, der die OpenAI- oder die Anthropic-API spricht, kann den Proxy ohne Integration nutzen. `zcode-kit proxy start` und `zcode-kit proxy status` geben die Basis-URLs, den Schlüssel und die Modell-IDs aus. Der vollständige Schlüssel erscheint nur in einem interaktiven Terminal; sonst gibt ihn `zcode-kit models --show-key` aus. Die Beispiele verwenden den Standardport `8457`.

```yaml
# OpenAI-Format
base_url: http://127.0.0.1:8457/v1
api_key: <lokaler Proxy-Schlüssel>
model: glm-5.3            # oder glm-5.3-flash
```

```yaml
# Anthropic-Format
base_url: http://127.0.0.1:8457
auth_token: <lokaler Proxy-Schlüssel>
model: glm-5.3
```

Der Proxy bedient `POST /v1/messages` (Anthropic), `POST /v1/chat/completions` und `POST /v1/responses` (OpenAI), `GET /v1/models`, `GET /health` und `GET /quota`. Alle brauchen den Schlüssel, als `Authorization: Bearer <Schlüssel>` oder als `x-api-key`.

### Thinking-Stufen

Beide Modelle kennen die Stufen `low`, `high` und `max`; siehe die [Effort-Zuordnung](../EFFORT_MAPPING.de.md).

- **OpenAI-Format:** Sende `reasoning_effort`. `medium` wird wie `high` behandelt, und eine Anfrage ohne das Feld läuft mit `max`. Der Proxy ergänzt ein Thinking-Budget von 8000, 16000 oder 32000 Tokens.
- **Anthropic-Format:** Sende `thinking: {type: "enabled", budget_tokens: <n>}` zusammen mit `output_config: {effort: "low"|"high"|"max"}`.
- **Flash verwendet immer Thinking.** Eine Anfrage an `glm-5.3-flash`, die Thinking abschaltet, wird mit `low` gesendet.

## Fehler und Kontingent

- **`[1005] exceed quota limit` (HTTP 400):** Das Kontingent ist aufgebraucht. Der Proxy versucht es etwa 65 Sekunden lang erneut und wechselt dann auf ein anderes Konto, wenn der Account Rotator eines hat. Erreicht dich der Fehler trotzdem, warte, bis das Kontingent wieder verfügbar ist; `zcode-kit proxy status` zeigt es an.
- **`[3007] captcha verify failed`:** Die Missbrauchsprüfung des Anbieters hat die Anfrage abgelehnt. Der Proxy versucht es einmal mit einem neuen Token; schlägt auch das fehl, warte, bevor du es erneut versuchst.
- **`[1210]` bei Flash:** Wähle `low`, `high` oder `max`, statt Thinking abzuschalten.
- **HTTP 401:** `Invalid or missing proxy API key` bedeutet, dass der Client den falschen lokalen Schlüssel gesendet hat. Andernfalls prüfe die Anmeldung mit `zcode-kit auth status` und erneuere sie mit `zcode-kit auth login zai`. Mit `--import` übernimmst du die aktive Desktop-Anmeldung `zai`/`start-plan`; bei `coding-plan` meldest du dich ohne diese Option an.
- **Vorübergehende Fehler vor jeder Ausgabe** (Verbindung abgelehnt oder zurückgesetzt, HTTP 429, 500, 502, 503, 504, 524 oder 529, oder ein Stream, der vor seinem ersten Inhalt scheitert) werden bis zu 3-mal mit wachsender Wartezeit wiederholt. Sobald die Ausgabe begonnen hat, wird nichts wiederholt. `ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS` wird beim Start des Proxys gelesen und legt die Basiswartezeit in Millisekunden fest (Standard 500, höchstens 10000).
- **Eine abgebrochene Antwort** endet mit einem Fehler, statt still abzureißen: `data: {"error":…}` in Chat-Streams, `response.failed` in Responses-Streams, `event: error` in Anthropic-Streams. Sende die Anfrage aus dem Assistenten erneut.
