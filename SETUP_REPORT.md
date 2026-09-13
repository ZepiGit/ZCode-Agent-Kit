# SETUP_REPORT — ZCode-Provider-Integration in OMP

Stand: 2026-09-13 · Alle Pfade absolut · Keine Secrets in diesem Dokument

## A. Befunde der Bestandsaufnahme

| Punkt | Befund |
|---|---|
| OS | Windows 11 Pro (Build 26200), x64, Git Bash (MINGW64), Benutzer `miche`; kein WSL/Container beteiligt |
| OMP | `omp` v18.1.18 (Update-Kanal: canary), natives Bun-Binary unter `C:\Users\miche\AppData\Local\omp\omp.exe`, kein Fork |
| Aktives Profil | Default-Profil `~/.omp/agent/` (`C:\Users\miche\.omp\agent\`); `PI_CODING_AGENT_DIR` nicht gesetzt |
| Konfiguration | `~/.omp/agent/config.yml` + `models.yml`; models.yml ist „headroom-wrapped" (headroom 0.37.0, Backup: `models.yml.headroom-backup`) — siehe „Headroom-Interaktion" |
| Bestehende Provider | 20 Gruppen (LiteLLMFree, tokenrouter, CliProxy, OrcaRouter, openrouter, anthropic, google, opencode-go/-zen, xai-oauth u. a.) — alle unverändert erhalten |
| Eingebauter `zai`-Provider | deaktiviert (`disabledProviders`); gespeicherte Z.ai-OAuth-Credentials (2 Konten) haben **keinen** GLM Coding Plan (live: HTTP 429 „[1113] Insufficient balance or no resource package") |
| Eingebauter `zcode`-Provider | in omp 18.1.18 **nicht mehr vorhanden** (nur der OAuth-Token-Endpunkt `zcode.z.ai/api/v1/oauth/token` ist im Binary); der `disabledProviders`-Eintrag `zcode` war veraltet |
| Tatsächlicher Modellzugang | ZCode-Desktop-App 3.11.2, Tarifweg **zai / start-plan** (JWT in `~/.zcode/v2/config.json` unter `builtin:zai-start-plan`, aktiv; `builtin:zai-coding-plan` deaktiviert und ohne Kontingent) |
| Kontingentlage bei Tests | GLM-5.3-Flash: ~50M/100M + 300M/300M Token-Buckets; GLM-5.3: 0/3.000.000 (Tagesbucket, Reset 2026-09-13T15:59:59Z) |
| Laufzeiten | Node v26.7.0, Bun 1.4.2, Git 2.55.0.windows.3 |
| Ports | 8457 frei gewählt (8080 und 8787 durch andere Tools potenziell belegt); keine WSL-/Container-Grenzen relevant |

## B. Architektur-Entscheidung

Gewählte Variante (Abschnitt 5 des Auftrags, Variante „Konfiguration + lokaler Proxy"):

```
OMP (Custom-Provider „zcode", 2 Modelle, anthropic-messages)
  → http://127.0.0.1:8457/v1/messages   (authentifiziert: lokaler Schlüssel)
  → zcode-proxy v4.6.4 (Commit 9a5cebe, MIT; Quellcode, per bun gefroren gelockt)
  → https://zcode.z.ai/api/v1/zcode-plan (Bearer Start-plan-JWT)
  → GLM-5.3 / GLM-5.3-Flash (Kontingent des bestehenden ZCode-Zugangs)
```

Begründung:
- **Direktzugriff ohne Proxy scheidet aus**: OMPs nativer `zai`-Auth-Weg (OAuth → minted Key gegen `api.z.ai/api/anthropic`) läuft über die Z.AI-**Coding-Plan**-Abrechnung; beide auf dem Rechner vorhandenen Z.ai-Konten haben keinen Coding-Plan (429 1113, live geprüft). Ein Kauf sollte/konnte nicht erfolgen.
- **Der Start-plan-Weg** (ZCode-Desktop-Tarif) benötigt die Desktop-Client-Identität (System-Inspektion des Gateways, Signierung); das ist exakt die Funktion des geprüften, MIT-lizenzierten Proxys `TriDefender/zcode-api` in der Rolle „start-plan". Er reicht Anfragen unverändert durch (Anthropic-Passthrough) und mimt nur die vom Gateway geforderten Client-Blöcke.
- **Kein OMP-Core-Patch, keine Extension-API-Kunstgriffe nötig**: Reines `models.yml` reicht — `compat.supportsOutputEffort` aus YAML wird vom OMP-Request-Builder übernommen (Mock-verifiziert), der eingebaute Modus `anthropic-budget-effort` erzeugt `output_config.effort` + level-spezifisches `thinking.budget_tokens`.
- OMP behält Systemprompt, Tools, Agentenschleife, Verlauf, Subagents; der Proxy liefert nur Inferenz-Transport. Kein zweiter Agent, kein ACP, keine MCP-Delegation, keine Desktop-Fernsteuerung.

## C. Installierte Komponenten

| Komponente | Ort | Status |
|---|---|---|
| Proxy-Quellcode (pinned) | `C:\Users\miche\zcode-omp-integration\zcode-proxy-src` @ Commit `9a5cebe07c5255faa675075fa37632d4dea733fa` (v4.6.4, 2026-09-11, MIT) + `bun.lock` | installiert, `bun install --frozen-lockfile` |
| Proxy-Konfiguration | `C:\Users\miche\zcode-omp-integration\proxy\config.yaml` — bind 127.0.0.1:8457, `plan: start-plan`, `provider: zai`, **claim.enabled/auto=false**, **async.enabled=false**, responses.enabled=false, proxyApiKey gesetzt (Dateirechte Benutzer) | aktiv |
| Lokaler Schlüssel | `C:\Users\miche\zcode-omp-integration\.proxykey` (32 Byte base64url, kryptografisch zufällig; ausschließlich benutzerlesbar; niemals in models.yml/Logs/Git) | aktiv |
| Credential-Import | `~/.zcode-proxy/credentials.json` (vom Proxy verschlüsselt, maschinengebunden) via `auth login zai --import` aus der bestehenden Desktop-Anmeldung — **kein neuer Browser-Login nötig** | aktiv |
| OMP-Provider | `~/.omp/agent/models.yml` — idempotenter Managed-Block `zcode:` (Anzeigename „ZCode", Models glm-5.3/glm-5.3-flash, Efforts low/high/max, Default max), apiKey via `!node .../resolve-zcode-proxy-key.mjs` | aktiv |
| Autostart-Extension | `~/.omp/agent/extensions/zcode-proxy-autostart.ts` + Eintrag in `config.yml` `extensions:` — startet beim ersten ZCode-Aufruf den Proxy bedarfsgesteuert (authentifizierter Health-Check, 30 s Budget), andere Provider unberührt | aktiv |
| Manager | `C:\Users\miche\zcode-omp-integration\proxy\zcode-proxy-manager.mjs` — start/stop/restart/status/doctor/logs | getestet |
| Setup/Rollback | `C:\Users\miche\zcode-omp-integration\setup-zcode-omp.mjs` (idempotent; `--rollback` stellt das letzte Backup je Datei wieder her); Backups in `C:\Users\miche\zcode-omp-integration\backups\` | getestet |

## D. Geänderte Dateien (abgesehen vom Integrationsverzeichnis)

1. `~/.omp/agent/models.yml` — Managed-Block `zcode:` eingefügt (idempotent, YAML-validiert, atomar; alles andere byte-identisch). Interaktion mit headroom: Der Block liegt außerhalb des Wrapped-Bereichs; ein späteres `headroom unwrap omp` würde ihn entfernen → dann einfach `node setup-zcode-omp.mjs` erneut ausführen.
2. `~/.omp/agent/config.yml` — veralteter Eintrag `- zcode` aus `disabledProviders` entfernt (ohne ihn bleibt der Custom-Provider unsichtbar; ein eingebauter zcode-Provider existiert in 18.1.18 nicht, es erscheinen also keine zusätzlichen Fremdmodelle). `- zai` bleibt deaktiviert. Eintrag für die Autostart-Extension in `extensions:` ergänzt. Alle anderen Felder/Rollen unangetastet.
3. `~/.omp/agent/extensions/zcode-proxy-autostart.ts` — neu (kopiert aus dem Integrationsverzeichnis).
4. `~/.zcode-proxy/credentials.json` — durch den Proxy-Login erstellt (verschlüsselter Credential-Store des Proxys).

Nicht verändert: Modellrollen (default/smol/slow/plan/vision/task), Retry-Policy, sonstige Provider, ZCode-Desktop, laufende Prozesse.

## E. Geheimnisschutz

- Der lokale Proxy-Schlüssel steht nur in `.proxykey` (Benutzerrechte) und wird von OMP per `!node`-Resolver zur Laufzeit gelesen; models.yml/Backups/Diagnosen/Logs enthalten ihn nicht.
- Proxy-Dumps (`ZCODE_DUMP_UPSTREAM`) maskieren Authorization-Header; die Dump-Dateien wurden nach den Tests entfernt.
- Upstream-Auth: Start-plan-JWT nur im verschlüsselten Proxy-Credential-Store; kein Token in Konfig-Dateien, Logs oder diesem Bericht.
