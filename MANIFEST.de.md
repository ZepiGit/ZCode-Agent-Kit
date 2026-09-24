# MANIFEST — Komponentenbestand und Herkunft
[English (original)](MANIFEST.md) · **Deutsch**

**Bestandsaufnahme:** Dieses Manifest beschreibt die Komponenten und Revisionen, die sich tatsächlich in diesem Repository befinden. Es behauptet nicht, dass jedes Upstream-Projekt seine neueste Version verwendet. Externe Harness-Versionen sind Referenzwerte und keine vom Kit installierten oder fest gepinnten Versionen.

Zu den Kit-Reparaturen seit der Upstream-Revision gehören der maßgebliche
Import gemeinsamer Desktop-0.16.9-Zugangsdaten;
streng validierte TTL für den CAPTCHA-Cache in Speicher und auf Platte sowie
isolierte Cache-Verzeichnisse, jeweils über die verwaltete Umgebung weitergegeben;
atomare Cache-Datenumschläge und Herkunftsangaben je geladenem Artefakt; sowie
ein statischer Kompatibilitätshelfer für gespeicherte Skripte, der keinen
Provider-Code ausführt und keinen Ende-zu-Ende-Erfolg belegt. Die alte
diagnostische Bytecode-VM-Umschreibung wurde nach reproduzierter
Bundle-Beschädigung zusammen mit sensiblen DBT-Dumps entfernt; Solver und
Sicherheitsprüfungen bleiben erhalten, Debug-Diagnosen enthalten nur Metadaten.
Flash-Anfragen mit deaktiviertem Thinking werden auf `low` normalisiert;
`high` und `max` bleiben verfügbar. Der lokale Transport verarbeitet auch
Brotli-/Deflate-Streams und JSON-Fehler; der Responses-Adapter erhält
Tool-Ergebnisse und Pflichtfelder der Events. Codex verwendet unter Windows
eine Restricted-Token-Sandbox; OpenCode bietet ausdrückliche Flash-Varianten.
Die native Bridge unterstützt das installierte 0.16.9-Protokoll; ihr Modellpfad
bleibt vom Proxy getrennt. Diese Änderungen belegen kein gleichwertiges
Live-Verhalten auf anderen Betriebssystemen oder über alle Harnesses hinweg.

| Komponente | Quelle | Gepinnte Version / Referenz | Lizenz | Lokale Änderungen |
|---|---|---|---|---|
| zcode-proxy | https://github.com/TriDefender/zcode-api | v4.6.4, Commit `9a5cebe07c5255faa675075fa37632d4dea733fa` (2026-09-11) | MIT (im Upstream-README angegeben; Upstream enthält keine LICENSE-Datei) | Die vendorte Basis ist v4.6.4. Beim Abgleich am 2026-09-22 war v4.6.9 die neueste veröffentlichte Upstream-Version; sie ist in diesem Repository nicht enthalten. Die Git-Historie des Kits dokumentiert lokale Änderungen, darunter Anpassungen an Credentials, Streaming, Kontrollport und Tests. `zcode-proxy-src/README.md` beschreibt den Kit-Kontext; die Fassungen `.de`, `.es`, `.ja` und `.zh-CN` sind Übersetzungen. Das Upstream-README ist im gepinnten Commit einsehbar. |
| zcode-harness-mcp | Dieses Repository (MCP-Bridge für ZCode Desktop `app-server`) | 0.1.0 | MIT | Eingebettet und lokal gepflegt unter `mcp/zcode-harness-mcp/`. Die Härtungen betreffen Workspace-Scope, Task-Lebenszyklus, Argumentprüfung und Speichergrenzen. Die kompilierte Ausgabe `dist/` ist eingecheckt; Laufzeitabhängigkeiten sind `@modelcontextprotocol/sdk` und `zod`. Das englische README ist das Original; deutsche, spanische, japanische und vereinfachte chinesische Übersetzungen sind enthalten. |
| OMP (Ziel-Harness, Referenzprüfung) | https://github.com/can1357/oh-my-pi | 18.1.18 (Canary) | — | Keine Core-Änderungen; Integration beschränkt sich auf `models.yml`, `config.yml` und eine Extension. |
| Claude Code (Ziel-Harness, Wrapper) | Anthropic | 2.1.269 | — | Keine Änderungen an `~/.claude`; opt-in-Wrapper und generierte Settings-Datei. |
| Codex CLI (Ziel-Harness, Wrapper) | OpenAI | 0.153.4 | — | Keine Änderungen an `~/.codex`; isoliertes `CODEX_HOME` unter `generated/`. |

## Vom Vendor-Paket ausgeschlossene Verzeichnisse

- `zcode-proxy-src/node_modules/` — wird von `setup.mjs` mit `bun install` installiert.
- `zcode-proxy-src/Android-APP/` (209 MB) — für die Desktop-/Harness-Integration nicht erforderlich; der zugehörige Build-Pfad wurde entfernt (`scripts/build-android-apk.sh`, `build:android-*`-npm-Scripts, die esbuild-Dev-Dependency und der Android-Build-Job im vendorten `.github/workflows/release.yml`).
- `mcp/zcode-harness-mcp/node_modules/` — wird von `setup.mjs` installiert.

Automatisierte Prüfungen: [GitHub Actions](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml). Effort-Zuordnung: [EFFORT_MAPPING.de.md](EFFORT_MAPPING.de.md) · [English](EFFORT_MAPPING.md).
