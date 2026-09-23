# Effort levels for ZCode models in OMP
**English (original)** · [Deutsch](EFFORT_MAPPING.de.md)

This document lists the reasoning-effort levels exposed by the OMP integration
for the supported ZCode models.

| Model | Supported effort levels |
|---|---|
| GLM-5.3 | `low`, `high`, `max` |
| GLM-5.3-Flash | `low`, `high`, `max` |

GLM-5.3-Flash now always uses thinking. An explicit request to disable thinking
is normalized to the lowest supported effort, `low`; explicit `high` and `max`
remain unchanged. On the Anthropic-compatible path, the low setting uses an
`8000`-token thinking budget plus answer headroom; on the OpenAI-compatible
path it uses `reasoning_effort: "low"`. Disabling thinking therefore does not
provide a separate non-thinking Flash mode. These proxy mappings do not imply
that the native Desktop MCP path uses the same provider or model catalog.

Availability and behavior can change with provider and harness updates. Check
the current model and provider documentation for their latest details.
Supported effort levels are compatibility options, not a service guarantee.

Machine-readable summary: [EFFORT_MAPPING.json](EFFORT_MAPPING.json).
