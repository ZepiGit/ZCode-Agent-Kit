# Harness Adapters — How Other Agent CLIs Use the Local Proxy
**English (original)** · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

The core of the kit is harness-neutral: a local HTTP proxy at
`http://127.0.0.1:8457` with three standard formats:

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

## Set up automatically by `zcode-kit setup` (only for detected harnesses)

`zcode-kit setup --harness auto` detects installed harnesses and configures
**only those**. A user with only OMP gets no Claude/Codex configuration or
generated wrapper files.

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
| MCP-capable harnesses | stdio server `zcode-harness` (`node mcp/zcode-harness-mcp/dist/index.js --stdio`) | OMP: entry in `~/.omp/agent/mcp.json`; Claude Code: `claude mcp add` (only if detected); Codex: inside the isolated home. MCP alone does NOT count as model integration |

Paths under `generated/` refer to kit state: the kit directory for release
installs/source checkouts, or the separate state directory for npm installs.

Run OMP directly, for example `omp --model zcode/glm-5.3-flash --thinking low`, not through `zcode-kit run`. **Currently unreleased local repair:** setup pins native Node/Bun; autostart preflight uses a fresh child process, not kit-module imports into OMP. The child has a 120-second limit and reports secret-free failure categories. After fixing the cause, retry after the 60-second per-session cooldown; the same session can recover. If the runtime moved, rerun `zcode-kit setup --harness auto` and reload the extension. Unknown port owners are never stopped. A healthy proxy or successful setup alone does not prove that a model reply completes.

## Opt-in wrappers (existing config stays untouched)

| Harness | Wrapper | What it does |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | starts the proxy on demand and calls `claude --settings <kit state>\generated\claude-zcode-settings.json` (CLI settings override user settings.json; your normal `claude` keeps running unchanged) |
| Codex CLI | `bin\zcode-codex.cmd` | sets `CODEX_HOME=<kit state>\generated\codex-home` + `ZCODE_PROXY_KEY` and starts the proxy on demand; your normal `codex` and `~/.codex` stay untouched |

## Wiring a client manually (any OpenAI-/Anthropic-capable client)

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

**Currently unreleased local repair — Flash:** `glm-5.3-flash` always thinks. Explicitly disabled thinking is normalized to `low`; explicit `high` and `max` are preserved. For Flash, the low Anthropic thinking budget is `8000` tokens (rather than the generic `2048` above), with additional output headroom for the answer; OpenAI uses `reasoning_effort: low`. Do not treat higher thinking effort alone as evidence of a hang. Direct-proxy and Claude Code Flash replies have completed successfully; this does not establish acceptance for every harness.

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
- Quota exhausted → HTTP 400 `[1005] exceed quota limit` (not retryable — wait for the provider to restore quota).
- `[3007] captcha verify failed` → gateway anti-abuse after intense retrying; take a pause.
- `401 start_plan_jwt_invalid` → check your Desktop login and renew it with `zcode-kit auth login zai`. **Currently unreleased local repair:** use `zcode-kit auth login zai --import` for the current active Desktop 0.16.9 `zai`/`start-plan` login with an explicitly configured plan. Existing `credentials.json` is authoritative; invalid credentials do not silently fall back to `config.json`. Modern `coding-plan` logins use normal OAuth instead; import does not create or resolve API keys.
- `[1210]` with Flash → check that thinking is enabled and choose `low`, `high`, or `max`, rather than disabling it. The currently unreleased local repair normalizes disabled thinking to `low`; see the Flash note above.
