# MANIFEST — Komponentenbestand und Herkunft
[English (original)](MANIFEST.md) · **Deutsch**

**Bestandsaufnahme:** Dieses Manifest beschreibt die Komponenten und Revisionen, die sich tatsächlich in diesem Repository befinden. Es behauptet nicht, dass jedes Upstream-Projekt seine neueste Version verwendet. Externe Harness-Versionen sind Referenzwerte und keine vom Kit installierten oder fest gepinnten Versionen.

## Komponenten

| Komponente | Quelle | Gepinnte Version / Referenz | Lizenz | Lokale Änderungen |
|---|---|---|---|---|
| zcode-proxy | https://github.com/TriDefender/zcode-api | v4.6.4, Commit `9a5cebe07c5255faa675075fa37632d4dea733fa` (2026-09-11) | MIT (im Upstream-README angegeben; Upstream enthält keine LICENSE-Datei) | Die vendorte Basis ist v4.6.4. Beim Abgleich am 2026-09-22 war v4.6.9 die neueste veröffentlichte Upstream-Version; sie ist in diesem Repository nicht enthalten. Die lokalen Änderungen stehen unten. `zcode-proxy-src/README.md` beschreibt den Kit-Kontext; die Fassungen `.de`, `.es`, `.ja` und `.zh-CN` sind Übersetzungen. Das Upstream-README ist im gepinnten Commit einsehbar. |
| zcode-harness-mcp | Dieses Repository (MCP-Bridge für ZCode Desktop `app-server`) | 0.1.0 | MIT | Eingebettet und lokal gepflegt unter `mcp/zcode-harness-mcp/`. Die Härtungen betreffen Workspace-Scope, Task-Lebenszyklus, Argumentprüfung und Speichergrenzen. Die kompilierte Ausgabe `dist/` ist eingecheckt. Das englische README ist das Original; deutsche, spanische, japanische und vereinfachte chinesische Übersetzungen sind enthalten. |
| OMP (Ziel-Harness, Referenzprüfung) | https://github.com/can1357/oh-my-pi | 18.2.9 | — | Keine Core-Änderungen; Integration beschränkt sich auf `models.yml`, `config.yml`, eine Extension und den Eintrag der MCP-Bridge in `mcp.json`. |
| Claude Code (Ziel-Harness, Wrapper) | Anthropic | 2.1.278 | — | Keine Änderungen an `~/.claude`; opt-in-Wrapper und generierte Settings-Datei. Das Setup registriert außerdem die MCP-Bridge mit `claude mcp add zcode-harness --scope user`; das ändert die eigene Nutzerkonfiguration von Claude Code. |
| Codex CLI (Ziel-Harness, Wrapper) | OpenAI | 0.155.1 | — | Keine Änderungen an `~/.codex`; isoliertes `CODEX_HOME` unter `generated/`. |

Die Harness-Versionen sind die in [SUPPORT_MATRIX.json](SUPPORT_MATRIX.json) als getestet verzeichneten; dort stehen auch die übrigen unterstützten Harnesses. `zcode-kit setup --no-mcp` überspringt die Registrierung der MCP-Bridge.

## Lizenzen

Für den eigenen Code des Kits gilt die MIT-Lizenz in [LICENSE](LICENSE). Die in diesem Manifest aufgeführten Fremdkomponenten behalten ihre eigenen Lizenzen.

Für den vendorten zcode-proxy in `zcode-proxy-src/` nennt das Upstream-README die MIT-Lizenz, das Upstream-Repository enthält aber keine LICENSE-Datei. Ob er weitergegeben werden darf, wird als Release-Bedingung in [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md) verfolgt.

## Laufzeit und Abhängigkeiten

- Node.js 24 oder neuer. Node.js 20 und 22 werden nicht unterstützt; `zcode-kit setup`, `zcode-kit update` und beide Installer brechen dort ab, bevor sie etwas ändern.
- Bun führt den Proxy aus. Gepinnt ist Version 1.4.2: Die Installer installieren sie, wenn Bun fehlt, und die automatisierten Prüfungen laufen damit.
- zcode-proxy (`zcode-proxy-src/package.json`): `happy-dom` ^21.0.4, `undici` ^8.12.4, `yaml` ^2.9.1. `zcode-proxy-src/bun.lock` löst sie auf 21.0.4, 8.12.4 und 2.9.1 auf. Nur für die Entwicklung: `typescript` 7.0.2 und `@types/bun` 1.4.2.
- zcode-harness-mcp (`mcp/zcode-harness-mcp/package.json`): `@modelcontextprotocol/server` ^2.4.0, `@modelcontextprotocol/node` ^2.1.2 und `zod` ^4.6.6. `mcp/zcode-harness-mcp/bun.lock` löst sie auf 2.4.0, 2.1.2 und 4.6.7 auf. Nur für die Entwicklung: `typescript` 7.0.2 und `@types/node` ^24.19.2.

Das Setup installiert beide Abhängigkeitssätze mit `bun install --frozen-lockfile`.

## Lokale Änderungen am vendorten Proxy

Die Git-Historie des Kits dokumentiert jede Änderung. Zusammengefasst:

- Zugangsdaten: maßgeblicher Import gemeinsamer Desktop-0.16.9-Zugangsdaten.
- CAPTCHA: streng validierte TTL für den Cache in Speicher und auf Platte sowie isolierte Cache-Verzeichnisse, jeweils über die verwaltete Umgebung weitergegeben; atomare Cache-Datenumschläge und Herkunftsangaben je geladenem Artefakt; ein statischer Kompatibilitätshelfer für gespeicherte Skripte, der keinen Provider-Code ausführt und keinen Ende-zu-Ende-Erfolg belegt. Die alte diagnostische Bytecode-VM-Umschreibung wurde nach reproduzierter Bundle-Beschädigung zusammen mit sensiblen DBT-Dumps entfernt; Solver und Sicherheitsprüfungen bleiben erhalten, Debug-Diagnosen enthalten nur Metadaten.
- Speichergrenze des CAPTCHA-Solvers: Die Grenze zählt auf jedem System den Speicher, den der Solver benutzt. Unter Windows misst der Solver-Prozess sein Working Set selbst und beendet sich an der Grenze; ein Job Object stoppt ihn 1024 MB Commit Charge über der Grenze. Bei 50 % der Grenze wird der Solver durch einen neuen Prozess ersetzt.
- Modelle: Flash-Anfragen mit deaktiviertem Thinking werden auf `low` normalisiert; `high` und `max` bleiben verfügbar.
- Transport: Brotli- und Deflate-Streams sowie JSON-Fehler werden verarbeitet; der Responses-Adapter erhält Tool-Ergebnisse und Pflichtfelder der Events.
- Betrieb: eine Stopp-Anfrage über den Loopback-Listener, eine Grenze für gleichzeitig gehaltene Anfragedaten, Überwachung von Speicher und Erreichbarkeit mit Neustart-Anforderungen an den Kit-Manager sowie ein größenbegrenztes, rotiertes `proxy.log`. Das Verhalten beschreibt die [Sicherheitsrichtlinie](SECURITY.de.md).
- Vom Kit geschriebene Harness-Konfiguration: Codex verwendet unter Windows eine Restricted-Token-Sandbox; OpenCode bietet ausdrückliche Flash-Varianten.
- Die native Bridge unterstützt das installierte 0.16.9-Protokoll; ihr Modellpfad bleibt vom Proxy getrennt.

Diese Änderungen belegen kein gleichwertiges Live-Verhalten auf anderen Betriebssystemen oder über alle Harnesses hinweg.

## Vom Vendor-Paket ausgeschlossene Verzeichnisse

- `zcode-proxy-src/node_modules/` — wird vom Setup mit `bun install` installiert.
- `zcode-proxy-src/Android-APP/` (209 MB) — für die Desktop-/Harness-Integration nicht erforderlich; der zugehörige Build-Pfad wurde entfernt (`scripts/build-android-apk.sh`, `build:android-*`-npm-Scripts, die esbuild-Dev-Dependency und der Android-Build-Job im vendorten `.github/workflows/release.yml`). Der Quelltext des Kontroll-Listeners unter `zcode-proxy-src/src/android/` bleibt, weil der Einstiegspunkt des Proxys ihn importiert.
- `zcode-proxy-src/.github/workflows/` (`ci.yml`, `release.yml`) und `zcode-proxy-src/.github/release.yml` — vendorte Upstream-CI- und Release-Workflows, entfernt. GitHub führt nur das Root-Verzeichnis `.github/workflows/` aus; sie liefen in diesem Repository also nie. Die Root-CI führt die Proxy-Tests aus.
- `mcp/zcode-harness-mcp/node_modules/` — wird vom Setup installiert.

Automatisierte Prüfungen: [GitHub Actions](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml). Effort-Zuordnung: [EFFORT_MAPPING.de.md](EFFORT_MAPPING.de.md) · [English](EFFORT_MAPPING.md).
