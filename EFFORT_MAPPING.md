# EFFORT_MAPPING — ZCode-Provider in OMP (GLM-5.3 / GLM-5.3-Flash)

Historischer Live-Stand: 2026-09-13 · Maschinenlesbar: [EFFORT_MAPPING.json](EFFORT_MAPPING.json)

**Abgrenzung (2026-09-17):** Diese Tabelle beschreibt ausschließlich den OMP-
Anthropic-Passthrough. OpenAI-/Responses-Requests werden separat übersetzt und
verwenden die vendorte Reasoning-Tabelle (8000/16000/32000; `medium` → `high`).
Die Tabellen sind nicht austauschbar und kein aktueller Live-Nachweis. Nicht alle
OpenAI-Felder haben ein Anthropic-Äquivalent; vollständige API-Parität wird nicht
zugesagt. Der unisolierte Remote-CAPTCHA-Pfad ist im Kit inzwischen standardmäßig
gesperrt; ältere Live-Ergebnisse garantieren keine aktuelle Start-Plan-Verfügbarkeit.

## Weg der Effort-Auswahl

```
OMP UI/CLI (--thinking low|high|max)
  → Modellmetadaten (models.yml: thinking.mode=anthropic-budget-effort,
    efforts=[low,high,max], defaultLevel=max, requiresEffort=true)
  → OMP anthropic-messages Request-Builder
      thinking: { type: "enabled", budget_tokens: <Tabelle>, display: "summarized" }
      output_config: { effort: <low|high|max> }        (compat.supportsOutputEffort=true)
  → lokaler zcode-proxy (passthrough; nur vorgeschriebene Start-plan-Systemblöcke
    + cache_control werden ergänzt)
  → https://zcode.z.ai/api/v1/zcode-plan (Bearer Start-plan-JWT)
  → GLM-5.3 / GLM-5.3-Flash
```

## Mapping-Tabelle (live am Upstream verifiziert)

| UI-Level | OMP-Wert | Upstream `output_config.effort` | Upstream `thinking.budget_tokens` | Status |
|---|---|---|---|---|
| low  | low  | low  | 2048  | live getestet (Flash: HTTP 200 + Inhalt; glm-5.3: Felder am Gateway nachgewiesen, Completion steht nach Quota-Reset aus) |
| high | high | high | 16384 | live getestet (Flash: HTTP 200 + Inhalt) |
| max  | max  | max  | 32768 | live getestet (Flash: HTTP 200 + Inhalt) |

- **Default:** `max` (verifizierter Modellstandard laut z.ai-Dokumentation und OMP-Katalog).
- **Budget-Verantwortlicher:** OMP (Modus `anthropic-budget-effort`). Der Proxy verändert
  Anthropic-Bodies nicht; eine doppelte Budgetumrechnung findet nicht statt.
- `max_tokens` bleibt das OMP-Output-Limit (64000 Default im Test, 128000 Modellmaximum (Desktop-Katalog-Spec; Gateway akzeptiert 131072 ebenfalls — Probe 2026-09-13));
  der Proxy addiert nichts. Das Gateway behandelt `max_tokens` als Gesamtausgabe inkl. Thinking
  (Anthropic-Semantik) — Antwortspielraum bleibt erhalten.

## Abweichung von der Desktop-Bundle-Tabelle

Das ZCode-Desktop-Bundle (laut TriDefender/zcode-api `src/provider/reasoning.ts`) paart
low/high/max mit Budgets 8000/16000/32000. Auf dem gewählten Weg ist **OMP** der einzige
Budget-Inhaber; seine gepaarten Budgets (2048/16384/32768) sind monoton, level-scharf
unterscheidbar und oberhalb des Gateway-Floors (1024). Die Abweichung ist dokumentiert und
live akzeptiert (alle drei Level HTTP 200). `reasoning_effort` (OpenAI-Feld) wird auf diesem
Weg nie gesendet — es gäbe das Gateway nur zu ignorieren.

## Normalisierungsregeln (sichtbar dokumentierte Kompatibilitätsregel)

GLM-5.3/Flash können Reasoning laut Herstellerdokumentation **nicht abschalten**. Die
OMP-Effort-Liste der Modelle enthält daher ausschließlich `low, high, max`:

| Externer Wert | Verhalten |
|---|---|
| `off` / `none` | OMP normalisiert auf das niedrigste unterstützte Level (`low`), Thinking bleibt aktiv — nie „aus"-Anzeige bei laufendem Reasoning |
| `minimal` / `medium` | normalisiert auf das nächstniedrigere unterstützte Level (`low`) |
| `xhigh` | normalisiert auf `high` (am Wire nachgewiesen: Budget 16384) |
| ungültige Werte | OMP wirft: „Thinking effort X is not supported by zcode/glm-5.3. Supported efforts: low, high, max" |

Die interaktive Modell-/Effort-Auswahl zeigt nur `low, high, max` an (keine Scheinkapazitäten).
Ein unvermeidlicher Rest: die Normalisierung erfolgt in OMP-Core, bevor eine Extension sie
sehen könnte; sie ist hiermit ausdrücklich dokumentiert.

## Teststatus je Kombination

- `zcode/glm-5.3-flash` × low/high/max: **live getestet** (OMP → Proxy → Gateway, HTTP 200,
 Thinking-Inhalt, Usage-Werte authentisch; Wire-Payloads je Level erfasst).
- `zcode/glm-5.3` × low/high/max: Wire-Felder am Proxy-Ausgang nachgewiesen (Dump); die
 Completion-Acceptance steht aus, weil das tägliche GLM-5.3-Kontingent (3 Mio. Token)
 zum Testzeitpunkt auf 0 war (Reset 2026-09-13 18:00 Ortszeit). Nachmessen mit
 `node tests/verify-glm53.mjs`.
