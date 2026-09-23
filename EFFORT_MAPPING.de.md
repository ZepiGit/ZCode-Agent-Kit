# Effort-Stufen für ZCode-Modelle in OMP
[English (original)](EFFORT_MAPPING.md) · **Deutsch**

Dieses Dokument listet die Reasoning-Effort-Stufen auf, die die OMP-Integration
für die unterstützten ZCode-Modelle bereitstellt.

| Modell | Unterstützte Effort-Stufen |
|---|---|
| GLM-5.3 | `low`, `high`, `max` |
| GLM-5.3-Flash | `low`, `high`, `max` |

GLM-5.3-Flash verwendet jetzt immer Thinking. Eine ausdrückliche Anforderung,
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
