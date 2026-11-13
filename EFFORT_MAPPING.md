# Effort levels for ZCode models in OMP
**English (original)** · [Deutsch](EFFORT_MAPPING.de.md)

This document lists the reasoning-effort levels exposed by the OMP integration
for the supported ZCode models, and how the proxy maps the values other
clients send.

| Model | Supported effort levels | Default |
|---|---|---|
| GLM-5.3 | `low`, `high`, `max` | `max` |
| GLM-5.3-Flash | `low`, `high`, `max` | `max` |

The OMP integration writes these levels and the default into its provider
entry in `models.yml`. There is no `medium` level.

## Values from Anthropic-compatible clients

A client on the Anthropic-compatible endpoint, OMP included, sends the level
as `output_config.effort` together with its own `thinking.budget_tokens`. The
proxy changes neither, apart from the Flash rule below.

## Values from OpenAI-compatible clients

A client on the OpenAI-compatible endpoint sends `reasoning_effort`; on the
Responses endpoint it is `reasoning.effort`. For the GLM-5.3 models the proxy
maps the value to the three levels:

| `reasoning_effort` | Level |
|---|---|
| `none`, `minimal`, `light`, `low` | `low` |
| `medium`, `high` | `high` |
| `xhigh`, `max`, `ultra` | `max` |
| not set, or any other value | `max` |

The proxy then adds the thinking budget of that level: `8000` tokens for
`low`, `16000` for `high` and `32000` for `max`. The budget is added on top of
the request's `max_tokens`, up to the model's output limit. A request that
sets its own thinking budget keeps it.

## GLM-5.3-Flash and disabled thinking

GLM-5.3-Flash always uses thinking. An explicit request to disable thinking
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
