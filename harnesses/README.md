# Harness Adapters — How Other Agent CLIs Use the Local Proxy
**English (original)** · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

The core of the kit is harness-neutral: a local HTTP proxy with three
standard formats. The examples below use the default port `8457`;
`zcode-kit proxy status` prints the port and connection values of your
installation:

| Endpoint | Format | Used by |
|---|---|---|
| `POST /v1/messages` | Anthropic messages (SSE + batch) | Claude-Code-like clients, OMP |
| `POST /v1/chat/completions` | OpenAI chat-completions (SSE + batch) | OpenAI-compatible clients |
| `POST /v1/responses` | OpenAI Responses API | Agents-SDK-like clients |
| `GET /v1/models` | model list | discovery |
| `GET /health`, `GET /quota` | status/quota (auth required) | diagnostics |

Authentication: `Authorization: Bearer <contents of .proxykey>`.
`zcode-kit setup` generates the key locally. In release installs and source checkouts
`.proxykey` lives in the kit directory; npm installs keep it in a separate
installation-specific state directory, outside `node_modules`.

## Set up by `zcode-kit setup` (detected harnesses, only with consent)

`zcode-kit setup --harness auto` detects installed harnesses and asks, for each
one without a stored decision, "Configure ZCode as a provider with its
supported models in <HARNESS>? [y/n]". A `y` configures that harness; `n`
skips it and leaves its files untouched, and without a terminal every
undecided harness is skipped. Ctrl-C stops the questions (exit code 130);
what you already answered `y` to stays configured. A user with only OMP gets
no Claude/Codex configuration or generated wrapper files.

Decisions are stored one file per harness under `generated/harness-choices/`
and are part of the setup transaction (a rollback removes them again).
`zcode-kit update` and `zcode-kit doctor --fix` re-apply only consented
integrations (a `y`, an explicit selection or `zcode-kit integrate
<harness>`); a stored `n` is respected until `--harness`, `integrate` or
`zcode-kit setup --reask` (asks again on a terminal) changes it. An
integration the kit created before it asked is refreshed on unattended runs
but never turned into consent. For unattended runs select harnesses with
`--harness omp,codex` or `ZCODE_KIT_HARNESSES=omp,codex` (`none` skips all
detected harnesses); unknown ids are errors. The kit's MCP bridge is
registered only with separate consent: an explicit selection, or a `y` given
after the MCP note that setup prints before the question (`--no-mcp` opts
out); `integrate`, a refresh or a stored decision without that note never
register it. One failing harness does not stop the others: its own partial
writes are undone, the summary lists it as failed and setup exits with code
20 (the installers continue with a warning).

| Harness | Mechanism | Impact on existing config |
|---|---|---|
| OMP (oh-my-pi) | provider block `zcode` in `~/.omp/agent/models.yml` + autostart extension | additive (managed block, transactional, idempotent); model selection: `omp --model zcode/glm-5.3[-flash] --thinking low\|high\|max` |
| pi | provider `zcode` in `~/.pi/agent/models.json` (`api: anthropic-messages`, `!node` key resolver) | additive (other providers stay); source: pi-mono docs/models.md |
| Claude Code | `generated/claude-zcode-settings.json` + `bin/zcode-claude.cmd\|.sh` | `~/.claude` stays untouched (opt-in per invocation) |
| Codex CLI | isolated `generated/codex-home` + `bin/zcode-codex.cmd\|.sh` | `~/.codex` stays untouched; **difference**: your own skills/rules/MCP do not apply inside the wrapper |
| OpenCode | provider `zcode` in `opencode.json` (`@ai-sdk/openai-compatible`, apiKey `{env:ZCODE_PROXY_KEY}`) | additive; JSONC comments are preserved |
| Aider | `generated/aider-zcode.env` + `bin/zcode-aider.cmd\|.sh` (process-local, **no setx**) | model `openai/glm-5.3[-flash]` |
| Continue | managed block in `~/.continue/config.yaml` (schema v1) | existing models/roles stay |
| Goose | `%APPDATA%/Block/goose/config/custom_providers/zcode.json` (Windows) or `~/.config/goose/custom_providers/zcode.json` (macOS/Linux) | credential via documented `auth.command` helper (kit key resolver, no shell) |
| Cline | `generated/cline-zcode-values.md` — **manual-confirmation-required** | the kit never touches VS Code state; enter the values once in the UI |
| Kilo Code | `generated/kilo-zcode-values.md` — **manual-confirmation-required** | custom provider (Anthropic messages) in the UI; the kit deliberately does not write kilo.jsonc |
| MCP-capable harnesses | stdio server `zcode-harness` (`node mcp/zcode-harness-mcp/dist/index.js --stdio`) | OMP: entry in `~/.omp/agent/mcp.json`; Claude Code: `claude mcp add` (only if detected and consented); Codex: inside the isolated home. MCP alone does NOT count as model integration |

Paths under `generated/` refer to kit state: the kit directory for release
installs/source checkouts, or the separate state directory for npm installs.

Run OMP directly, for example `omp --model zcode/glm-5.3-flash --thinking low`, not through `zcode-kit run`. Setup pins native Node/Bun; autostart preflight uses a fresh child process, not kit-module imports into OMP. The child has a 120-second limit and reports secret-free failure categories. After fixing the cause, retry after the 60-second per-session cooldown; the same session can recover. If the runtime moved, rerun `zcode-kit setup --harness auto` and reload the extension. Unknown port owners are never stopped. A healthy proxy or successful setup alone does not prove that a model reply completes.

## Opt-in wrappers (existing config stays untouched)

| Harness | Wrapper | What it does |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | starts the proxy on demand and calls `claude --settings <kit state>\generated\claude-zcode-settings.json` (CLI settings override user settings.json; your normal `claude` keeps running unchanged) |
| Codex CLI | `bin\zcode-codex.cmd` | sets `CODEX_HOME=<kit state>\generated\codex-home` + `ZCODE_PROXY_KEY` and starts the proxy on demand; your normal `codex` and `~/.codex` stay untouched |

## Wiring a client manually (any OpenAI-/Anthropic-capable client)

This is an equal entry point, not a fallback. The kit proxy must be running
and ZCode needs a valid login. `zcode-kit proxy start` (also when the proxy is
already running) and `zcode-kit proxy status` print the current base URLs,
local key and model IDs. While the proxy is not verified running, the values
are labelled as coming from configuration and the output says `Start the
proxy first: zcode-kit proxy start`. The full key appears only in an
interactive terminal; otherwise use `zcode-kit models --show-key`. Replace the
example port below with the port the command shows.

```yaml
# OpenAI format
base_url: http://127.0.0.1:8457/v1
api_key: <contents of .proxykey>
model: glm-5.3            # or glm-5.3-flash
```

```yaml
# Anthropic format
base_url: http://127.0.0.1:8457
auth_token: <contents of .proxykey>
model: glm-5.3
```

Reasoning/thinking:
- **Anthropic format**: `thinking: {type: "enabled", budget_tokens: 2048|16384|32768}`
  paired with `output_config: {effort: "low"|"high"|"max"}` — details in
  [EFFORT_MAPPING.md](../EFFORT_MAPPING.md).
- **OpenAI format**: `reasoning_effort: low|high|max` + `thinking: {type: "enabled"}`
  (the proxy translates into the Anthropic fields).

**Flash:** `glm-5.3-flash` always thinks. Explicitly disabled thinking is normalized to `low`; explicit `high` and `max` are preserved. For Flash, the low Anthropic thinking budget is `8000` tokens (rather than the generic `2048` above), with additional output headroom for the answer; OpenAI uses `reasoning_effort: low`. Do not treat higher thinking effort alone as evidence of a hang. Direct-proxy and Claude Code Flash replies have completed successfully; this does not establish acceptance for every harness.

On Windows the isolated Codex profile enables the restricted-token sandbox (`windows.sandbox = "unelevated"`); `workspace-write` remains limited to the project and does not grant full access. OpenCode Flash exposes `--variant low`, `high`, and `max`, with `low` as its default. Its native npm executable wrapper and Brotli/deflate-compressed session streams are supported. Responses tool-result text and image parts are preserved; malformed event items are not treated as successful output.

## MCP clients (generic)

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["<absolute kit installation path>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

The bridge drives the **real installed ZCode harness** (app-server protocol:
sessions, turns, tasks). Desktop may be needed for interactive verification;
the provider can still reject a model turn. Bridge reasoning levels are
`low/high/max`. Its live model catalog can differ from the proxy catalog;
GLM-5.3-Flash is verified through the proxy path. A native catalog entry is
not proof of a successful native model turn, and proxy acceptance does not
establish native-provider acceptance. Details:
[mcp/zcode-harness-mcp/README.md](../mcp/zcode-harness-mcp/README.md).

## Quota & error modes

- `GET /quota` (authenticated) shows the token buckets per model.
- Quota exhausted → HTTP 400 `[1005] exceed quota limit`. The proxy retries the same account on a growing schedule (up to ~65s by default) before failing over to another account, when the rotator has one; if you still see it, wait for the provider to restore quota.
- `[3007] captcha verify failed` → gateway anti-abuse. The proxy retries once with a freshly minted captcha token; if it still fails, take a pause.
- Transient failures before any output (connection refused or reset, HTTP 500/502/503/504/524/529, 429, and the gateway error codes the official client retries) are retried up to 3 times on the same account with a growing delay; the budget is smaller than the official client's (base delay 1 s doubling, `Retry-After` honoured up to 15 seconds), and the account is re-checked before every retry. Gateway verdicts (quota, balance, captcha, model, authentication), request errors and anything after output has started are never retried; a `Retry-After` above 15 seconds is passed to the client on 429, 503 and 529. Tune with `ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS` (base delay in milliseconds, default 500, capped at 10000; `off` keeps only the retry of connections that were never established; proxy start/restart passes it through).
- A stream that fails before its first content event (an error event such as `overloaded_error`, or a cut connection) is retried like a failed request, so the harness sees the good stream only; after the first content event nothing is retried. On start-plan every retry after a response takes a fresh captcha token.
- A stream that the upstream cuts off ends with an error payload instead of a silent truncation: chat streams get `data: {"error":…}`, Responses streams `response.failed`, native Anthropic streams one `event: error` frame of type `api_error` whose message names the cause (`upstream_incomplete` or `upstream_stream_error`); an unfinished last frame is dropped so that the error frame stays parseable. Nothing is replayed after output has started; send the turn again from the harness.
- `401 start_plan_jwt_invalid` → check your Desktop login and renew it with `zcode-kit auth login zai`. Use `zcode-kit auth login zai --import` for the current active Desktop 0.16.9 `zai`/`start-plan` login with an explicitly configured plan. Existing `credentials.json` is authoritative; invalid credentials do not silently fall back to `config.json`. Modern `coding-plan` logins use normal OAuth instead; import does not create or resolve API keys.
- `[1210]` with Flash → check that thinking is enabled and choose `low`, `high`, or `max`, rather than disabling it. The proxy normalizes disabled thinking to `low`; see the Flash note above.
