# Am ZCode Agent Kit mitwirken
[English (original)](CONTRIBUTING.md) · **Deutsch** · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Fehlerberichte, Korrekturen, Dokumentation und Übersetzungen sind willkommen. Diese Anleitung beschreibt die Arbeit am Kit aus einem Quellcode-Checkout. Wie du das Kit installierst und benutzt, steht im [README](README.de.md).

## Voraussetzungen

- Node.js 24 oder neuer. Die CI testet mit Node.js 24 und 26.
- Bun 1.4.2. Der Proxy und die MCP-Bridge führen ihre Tests mit Bun aus, und die CI pinnt diese Version. Auf den CI-Runnern erhöhen Bun 1.4.3 und neuer die Speicherspitze des Proxys bei einer Welle großer Anfragen; ältere Bun-Versionen wie 1.2.20 lehnen das Lockfile der MCP-Bridge ab.
- Git.

## Klonen und installieren

```sh
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git
cd ZCode-Agent-Kit
```

Für einen Pull Request forkst du das Repository auf GitHub und pushst deinen Branch in deinen Fork.

Das Kit selbst hat keine npm-Abhängigkeiten. Der Proxy und die MCP-Bridge haben eigene, die in ihren `bun.lock`-Dateien gepinnt sind. Installiere sie so wie die CI:

```sh
cd zcode-proxy-src && bun install --frozen-lockfile
cd ../mcp/zcode-harness-mcp && bun install --frozen-lockfile
cd ../..
```

Die CLI startest du aus dem Checkout mit `node cli/zcode-kit.mjs <command>`, zum Beispiel `node cli/zcode-kit.mjs doctor`. Befehle, die in die Konfiguration deiner Assistenten schreiben (`setup`, `integrate`, `doctor --fix`, `accounts enable` und `accounts disable`), laufen nicht aus einem Checkout. Eine installierte Kopie und ein Checkout teilen sich einen Home-Ordner, und wenn beide schreiben, verteilt sich der Zustand des Kits auf zwei Stellen. `integrate <harness> --dry-run` listet auf, was sich ändern würde, ohne etwas zu schreiben. Setze `ZCODE_KIT_ALLOW_CHECKOUT=1` nur, wenn du wirklich aus dem Checkout schreiben willst.

## Tests ausführen

Führe diese Befehle im Wurzelverzeichnis des Repositorys aus:

| Befehl | Was er ausführt |
|---|---|
| `npm run test` | Kit-Tests mit `node --test` |
| `npm run test:proxy` | Proxy-Tests mit `bun test` in `zcode-proxy-src/` |
| `npm run test:mcp` | Baut die MCP-Bridge und führt dann ihre Tests aus |
| `npm run test:all` | Alle drei, dazu der Typecheck des Proxys (`npm run test:proxy-typecheck`) |

Der `ci`-Workflow führt diese Suites bei jedem Pull Request aus, unter Ubuntu und Windows mit Node.js 24 und 26. Dazu kommen zwei langsamere Prüfungen:

- Ausgabevergleich (`npm run test:ux-before`). Jede aufgezeichnete Ausgabe von `zcode-kit` muss Byte für Byte mit den Referenzdateien in `tests/ux-before/` übereinstimmen. Ändert sich, was ein Befehl ausgibt, gehören die neu erzeugten Referenzdateien in denselben Pull Request. Schlägt der Job fehl, lädt er die neue Aufzeichnung als Artefakt hoch, damit du den Unterschied sehen kannst. Unter Linux dauert der Vergleich etwa 8 Minuten und braucht `script` aus util-linux; unter macOS wird er übersprungen.
- Speicherbudget (`tests/memory/`). Die in `tests/memory/expected-red.json` aufgeführten Läufe müssen fehlschlagen, alle anderen müssen bestehen. Wer einen aufgeführten Lauf repariert, entfernt ihn deshalb auch aus dieser Datei.

## Änderungen vorschlagen

- Vor einer größeren Änderung, etwa einer neuen Assistenten-Integration oder einer Änderung daran, wie der Proxy Anfragen verarbeitet, eröffne ein Issue oder starte eine [Discussion](https://github.com/ZepiGit/ZCode-Agent-Kit/discussions). So ist der Ansatz abgestimmt, bevor du den Code schreibst.
- Halte jeden Pull Request klein und beschränke ihn auf eine Änderung.
- Wenn du Verhalten änderst, ergänze oder aktualisiere die Tests dafür.
- Schreibe Commit-Messages im Stil von Conventional Commits: `type(scope): summary`. Die meisten Commits in der Historie verwenden die Typen `feat`, `fix`, `docs`, `test`, `ci` und `chore`. Der Scope ist optional und nennt den geänderten Teil, etwa `proxy`, `cli`, `mcp` oder `omp`. Ein Beispiel aus der Historie: `fix(mcp): bridges sharing one data directory leave each other's tasks alone`.
- Eine neue Datei kommt nur dann ins npm-Paket, wenn die Allowlist in `pack/build.mjs` sie aufführt.

## Dokumentation und Übersetzungen

Das README gibt es auf English, Deutsch, Español, 日本語 und 简体中文. Die englische Fassung ist die Quelle, die Übersetzungen folgen ihr. Übersetzte Dateien liegen neben der englischen Datei und tragen ein Sprachkürzel (`README.de.md`, `README.es.md`, `README.ja.md`, `README.zh-CN.md`). Andere Dokumente sind in weniger Sprachen übersetzt. Sieh deshalb nach, welche Sprachdateien neben der Datei liegen, die du änderst.

Wenn du nutzerseitige englische Dokumentation änderst, aktualisiere die übersetzten Dateien möglichst im selben Pull Request. Geht das nicht, liste die Dateien, die dadurch veraltet sind, in der Beschreibung des Pull Requests auf, damit sie später nachgezogen werden können.

`CHANGELOG.md` wird immer auf Englisch geschrieben.

## Erste Beiträge

Issues mit dem Label [`good first issue`](https://github.com/ZepiGit/ZCode-Agent-Kit/labels/good%20first%20issue) sind als Einstieg gedacht. Schreib vor dem Start einen Kommentar in das Issue, damit nicht zwei Leute an derselben Sache arbeiten.

## Fragen und Sicherheitsmeldungen

Fragen stellst du in den [GitHub Discussions](https://github.com/ZepiGit/ZCode-Agent-Kit/discussions). Sicherheitsprobleme meldest du wie in der [Sicherheitsrichtlinie](SECURITY.de.md#schwachstellen-melden) beschrieben, nie in einem öffentlichen Issue.
