# MANIFEST — eingebettete Komponenten und Herkunft

| Komponente | Quelle | Version/Commit | Lizenz | lokale Änderungen |
|---|---|---|---|---|
| zcode-proxy | https://github.com/TriDefender/zcode-api | v4.6.4, Commit `9a5cebe07c5255faa675075fa37632d4dea733fa` (2026-09-11) | MIT (laut upstream README; upstream führt keine LICENSE-Datei) | Der alte `patches/zcode-proxy-local-patches.patch` ist nur ein historischer Teilpatch und bildet den aktuellen Vendor-Diff nicht vollständig ab. Maßgeblich ist die Git-Historie des Verzeichnisses; aktuelle Audit-Reparaturen betreffen zusätzlich Credentials, Streaming, Kontrollport und Tests.  ursprünglicher Commit vor dem Entfernen des verschachtelten `.git` hier dokumentiert; README ersetzt: Kit-Kontext-Dokument (EN) als `README.md`, Upstream-Original als `README.zh-CN.md` erhalten, Übersetzungen (`README.de.md`/`README.es.md`/`README.ja.md`) ergänzt |
| zcode-harness-mcp | eigenes Projekt (MCP-Bridge für den ZCode-Desktop, `app-server`-Protokoll) | 0.1.0 | MIT | eingebettet und lokal weiterentwickelt unter `mcp/zcode-harness-mcp/` (Audit-Reparaturen: Workspace-Scope, Task-Lebenszyklus, Argumentprüfung, Speichergrenzen) (dist committet; Laufzeit-Abhängigkeiten: `@modelcontextprotocol/sdk`, `zod`); README auf EN-Default umgestellt, Übersetzungen (de/es/ja/zh) ergänzt |
| OMP (Ziel-Harness, Referenztest) | https://github.com/can1357/oh-my-pi | 18.1.18 (Canary) | — | keine Core-Änderungen; reine models.yml/config.yml/Extension-Integration |
| Claude Code (Ziel-Harness, Wrapper) | Anthropic | 2.1.269 | — | keine Änderungen an `~/.claude`; opt-in Wrapper + generierte Settings-Datei |
| Codex CLI (Ziel-Harness, Wrapper) | OpenAI | 0.153.4 | — | keine Änderungen an `~/.codex`; isoliertes `CODEX_HOME` unter `generated/` |

## Vom Vendor ausgeschlossene Verzeichnisse

- `zcode-proxy-src/node_modules/` — installiert setup.mjs via `bun install`
- `zcode-proxy-src/Android-APP/` (209 MB) — für die Desktop-/Harness-Integration nicht benötigt; zugehöriger Build-Pfad entfernt (`scripts/build-android-apk.sh`, `build:android-*`-npm-Scripts, esbuild-Dev-Dependency, `build-android`-Job im vendorten `.github/workflows/release.yml`)
- `mcp/zcode-harness-mcp/node_modules/` — installiert setup.mjs

## Referenzmaschine (Teststand 2026-09-12/13)

Windows 11 (Build 26200) x64 · Node 26.7.0 · Bun 1.4.2 · ZCode Desktop 3.11.2
(zcode.cjs 0.16.5, Fingerprint 5a80496a781802aa) · OMP 18.1.18.
Einzelheiten und Testergebnisse: SETUP_REPORT.md, TEST_REPORT.md, EFFORT_MAPPING.md.
