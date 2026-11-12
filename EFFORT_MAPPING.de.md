# Effort-Stufen für ZCode-Modelle in OMP
[English (original)](EFFORT_MAPPING.md) · **Deutsch**

Dieses Dokument listet die Reasoning-Effort-Stufen auf, die die OMP-Integration
für die unterstützten ZCode-Modelle bereitstellt, und beschreibt, wie der Proxy
die Werte anderer Clients zuordnet.

| Modell | Unterstützte Effort-Stufen | Standard |
|---|---|---|
| GLM-5.3 | `low`, `high`, `max` | `max` |
| GLM-5.3-Flash | `low`, `high`, `max` | `max` |

Die OMP-Integration schreibt diese Stufen und den Standard in ihren
Provider-Eintrag in `models.yml`. Eine Stufe `medium` gibt es nicht.

## Werte von Anthropic-kompatiblen Clients

Ein Client am Anthropic-kompatiblen Endpunkt, auch OMP, sendet die Stufe als
`output_config.effort` zusammen mit seinem eigenen `thinking.budget_tokens`.
Der Proxy ändert beides nicht, abgesehen von der Flash-Regel unten.

## Werte von OpenAI-kompatiblen Clients

Ein Client am OpenAI-kompatiblen Endpunkt sendet `reasoning_effort`; am
Responses-Endpunkt ist es `reasoning.effort`. Für die GLM-5.3-Modelle ordnet
der Proxy den Wert den drei Stufen zu:

| `reasoning_effort` | Stufe |
|---|---|
| `none`, `minimal`, `light`, `low` | `low` |
| `medium`, `high` | `high` |
| `xhigh`, `max`, `ultra` | `max` |
| nicht gesetzt oder ein anderer Wert | `max` |

Danach ergänzt der Proxy das Thinking-Budget dieser Stufe: `8000` Tokens für
`low`, `16000` für `high` und `32000` für `max`. Das Budget kommt zum
`max_tokens` der Anfrage hinzu, höchstens bis zum Ausgabelimit des Modells.
Setzt eine Anfrage ein eigenes Thinking-Budget, bleibt es erhalten.

## GLM-5.3-Flash und abgeschaltetes Thinking

GLM-5.3-Flash verwendet immer Thinking. Eine ausdrückliche Anforderung,
Thinking abzuschalten, wird auf die niedrigste unterstützte Stufe `low`
normalisiert; explizites `high` und `max` bleiben unverändert. Im
Anthropic-kompatiblen Pfad verwendet die niedrige Stufe ein Thinking-Budget von
`8000` Tokens zuzüglich Spielraum für die Antwort; im OpenAI-kompatiblen Pfad
wird `reasoning_effort: "low"` verwendet. Das Abschalten von Thinking bietet
also keinen separaten Flash-Modus ohne Thinking. Diese Proxy-Zuordnungen
bedeuten nicht, dass der native Desktop-MCP-Pfad denselben Provider oder
Modellkatalog verwendet.

Verfügbarkeit und Verhalten können sich mit Updates des Providers und des
Harness ändern. Die aktuellen Angaben dazu findest du in der Model- und
Provider-Dokumentation. Unterstützte Effort-Stufen sind Kompatibilitätsoptionen,
keine Dienstgarantie.

Maschinenlesbare Zusammenfassung: [EFFORT_MAPPING.json](EFFORT_MAPPING.json).
