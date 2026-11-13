# Assistant guides
**English (original)** · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

For each supported coding assistant, this page says what to run, what the kit writes and what is left for you to do. Installation is in the [main README](../README.md). The CLI calls an assistant a "harness", hence `--harness`.

The kit needs Node.js 24 or newer; on Node.js 20 and 22, which are no longer supported, `zcode-kit setup` and `zcode-kit update` stop without changing anything. The release installers install Bun 1.4.2 when Bun is missing. `zcode-kit --version` prints the installed version; `zcode-kit help` lists all commands.

## Choosing assistants in setup

`zcode-kit setup` looks for installed assistants and configures only those you agree to.

- **On a terminal** it shows the detected assistants as a checkbox list: arrow keys move, Space ticks or unticks, `a` toggles all, Enter confirms. Ticked assistants are configured, unticked ones are skipped. Esc, or Enter with nothing ticked, stores no answer.
- **On a terminal without colour or cursor control, or one too small for the list,** it asks `Configure ZCode for <assistant>? [y/n]` once per assistant. `zcode-kit setup --select` shows a numbered list instead and accepts numbers, `all` or `none`.
- **Without a terminal** (CI, a pipe) it asks nothing and skips every assistant that has no stored answer. Name the assistants instead: `zcode-kit setup --harness omp,codex` or `ZCODE_KIT_HARNESSES=omp,codex` configures exactly those. `none` skips all detected assistants; an unknown id is an error.

Answers are stored under `generated/harness-choices/` and reused by later setups, `zcode-kit update` and `zcode-kit doctor --fix`: what you agreed to is kept up to date, what you declined is left alone, and you are not asked again. `zcode-kit setup --reask` asks again on a terminal, and `zcode-kit doctor --forget <assistant>` deletes one stored answer. An integration this kit created earlier may be refreshed even when no answer is stored for it.

Ctrl-C ends setup with exit code 130. A checkbox list that was not confirmed is not applied; y/n answers already given stay applied. If one assistant fails, its partial changes are undone, the others are still configured and setup exits with code 20. Setup prints the `zcode-kit rollback` command that undoes its changes. A configured assistant means that the files were written, not that sign-in works or that a model replies; check sign-in with `zcode-kit auth status`.

## Configuring one assistant

```sh
zcode-kit integrate <assistant> --dry-run   # lists what would be written, writes nothing
zcode-kit integrate <assistant>             # writes it and stores your consent
zcode-kit rollback                          # undoes the most recent change
```

`--dry-run` prints a `would write` line for each file that would change. The real run also stores a yes for that assistant, so later setups and updates keep it current. It never registers the MCP bridge. In a git checkout of the kit, `setup` and `integrate` refuse to write unless `ZCODE_KIT_ALLOW_CHECKOUT=1` is set.

## Overview

| Assistant (id) | Setup writes | Start it with | Tested with a model reply |
|---|---|---|---|
| OMP (`omp`) | provider `zcode` in `~/.omp/agent/models.yml`, an autostart extension | `omp --model zcode/glm-5.3-flash` | Windows, version 18.2.9 |
| pi (`pi`) | provider `zcode` in `~/.pi/agent/models.json` | `zcode-kit proxy start`, then `pi --model zcode/glm-5.3` | Windows, version 0.85.0 |
| Claude Code (`claude-code`) | `generated/claude-zcode-settings.json` | `zcode-kit run claude-code -- <args>` | Windows, version 2.1.278 |
| Codex CLI (`codex`) | `generated/codex-home/config.toml` | `zcode-kit run codex -- <args>` | Windows, version 0.155.1 |
| OpenCode (`opencode`) | provider `zcode` in OpenCode's configuration file | `zcode-kit run opencode -- <args>` | Windows, version 1.18.29 |
| Aider (`aider`) | `generated/aider-zcode.env` | `zcode-kit run aider -- <args>` | Windows, version 0.86.2 |
| Continue (`continue`) | two models in `~/.continue/config.yaml` | `zcode-kit proxy start`, then select the model in Continue | no |
| Goose (`goose`) | `zcode.json` in Goose's `custom_providers` folder | `zcode-kit proxy start`, then `goose session --provider zcode` | no |
| Cline (`cline`) | `generated/cline-zcode-values.md` | enter the values in Cline, then `zcode-kit proxy start` | no |
| Kilo Code (`kilo-code`) | `generated/kilo-zcode-values.md` | enter the values in Kilo Code, then `zcode-kit proxy start` | no |

The last column is from the [support matrix](../SUPPORT_MATRIX.json): Windows 11, 2026-09-23, kit v0.2.33, `glm-5.3-flash`. Nothing was tested with a real model reply on Linux or macOS. For the rows marked "no", only writing the configuration was tested, without the assistant itself.

`generated/` and the local key `.proxykey` are in the kit directory for release installs and source checkouts, and in a separate state directory outside `node_modules` for npm installs. Some of the written files contain the key in plain text; do not share them, and run `zcode-kit setup` again if the key changes.

`zcode-kit run <assistant> -- <args>` exists for Claude Code, Codex CLI, OpenCode and Aider. It starts the proxy if needed and passes everything after `--` to the assistant. The scripts `bin/zcode-claude`, `bin/zcode-codex` and `bin/zcode-aider` (`.cmd` or `.sh`) in the kit directory do the same.

## Notes per assistant

### OMP

Start OMP directly; there is no `zcode-kit run omp`. Choose the thinking level with `--thinking low`, `high` or `max`; the kit declares `max` as the default. Setup adds a marked block to `models.yml`, copies the extension to `~/.omp/agent/extensions/` and, if `config.yml` exists, registers the extension there and removes `zcode` from `disabledProviders`. It skips OMP when `models.yml` does not exist, and it changes nothing when the file has a `zcode` provider that you wrote yourself.

The extension starts the proxy on OMP's first request to a `zcode` model. The start check runs in a separate process for at most 120 seconds. If it fails, OMP prints a `[zcode-autostart]` line with the reason and tries again no earlier than 60 seconds later. The extension stores the path of the Node.js that setup found; if that Node.js is removed or is older than version 24, run `zcode-kit setup` again and restart OMP.

### pi

pi does not start the proxy itself. The entry uses the Anthropic messages format, and your other providers are kept. The key is not written into the file: pi obtains it by running the kit's script `proxy/resolve-zcode-proxy-key.mjs`. Setup skips pi when `~/.pi/agent` does not exist and changes nothing when the file has a `zcode` provider that the kit did not write. The kit sets no thinking levels for pi.

### Claude Code

`~/.claude/settings.json` is not changed. `zcode-kit run claude-code -- <args>` runs `claude --settings <generated file> <args>`, so only that call goes to ZCode and plain `claude` works as before. The settings use `glm-5.3` as the main model and `glm-5.3-flash` as the small, fast model; add `--model glm-5.3-flash` to use Flash throughout. Anthropic does not officially support Claude Code with models other than Claude.

### Codex CLI

`zcode-kit run codex -- <args>` sets `CODEX_HOME` to `generated/codex-home` for that call; `~/.codex` and plain `codex` stay as they are. Because it is a separate home, your own Codex settings, skills, rules and MCP servers do not apply there. Its `config.toml` uses the Responses API with `glm-5.3` as the default model and always contains an entry for the kit's MCP bridge. On Windows it also sets `sandbox = "unelevated"` under `[windows]`.

### OpenCode

Setup edits the file named by `OPENCODE_CONFIG`, otherwise `opencode.jsonc` or `opencode.json` in `OPENCODE_CONFIG_DIR`, `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`, and creates it if it is missing. Other settings, and comments outside the `provider` section, are kept. A `zcode` provider that the kit did not write stops the change with an error. The entry reads the key from the environment variable `ZCODE_PROXY_KEY`, which `zcode-kit run opencode` sets. If you start `opencode` directly, set the variable yourself and start the proxy first. `glm-5.3-flash` has the variants `low`, `high` and `max`, with `low` as the default.

### Aider

`zcode-kit run aider` sets `OPENAI_API_BASE` and `OPENAI_API_KEY` for that one process; nothing is set system-wide and `~/.aider.conf.yml` is not touched. Without arguments it runs `aider --model openai/glm-5.3`. With arguments, name the model yourself, for example `zcode-kit run aider -- --model openai/glm-5.3-flash`. `generated/aider-zcode.env` holds the same values for manual use.

### Continue

Setup appends "ZCode GLM-5.3" and "ZCode GLM-5.3-Flash" in a marked block at the end of the `models:` list; existing models stay. Setup skips Continue when `config.yaml` does not exist; once it does, run `zcode-kit integrate continue`. A `models:` list written on one line with entries is not edited; rewrite it as a block list first.

### Goose

The folder is `%APPDATA%\Block\goose\config\custom_providers` on Windows and `~/.config/goose/custom_providers` on macOS and Linux. The key is not stored in `zcode.json`; Goose obtains it by running the kit's key script. A `zcode.json` that this kit did not write is not overwritten.

### Cline and Kilo Code

The kit does not write into the storage that VS Code keeps for these extensions. Setup writes a sheet with the values, and you enter them once in the extension's settings:

- **Cline:** API Provider "OpenAI Compatible", the base URL ending in `/v1`, the key and a model ID. The sheet also gives the `cline auth` command for the Cline CLI.
- **Kilo Code:** a custom provider with the API "Anthropic Messages", the base URL ending in `/v1`, the key and both models, which you add by hand. The kit does not write `kilo.jsonc`.

The sheets do not contain the key; print it with `zcode-kit models --show-key`. Setup finds the two extensions only in `~/.vscode/extensions`. For another editor, run `zcode-kit integrate cline` or `zcode-kit integrate kilo-code`.

## MCP bridge

The bridge `zcode-harness` is a local MCP server that lets an assistant work with sessions and tasks of your installed ZCode. Registering it does not connect a model.

Setup registers the bridge for OMP (in `~/.omp/agent/mcp.json`) and for Claude Code (`claude mcp add zcode-harness --scope user`) when you tick or answer `y` for that assistant, or name it with `--harness`; the list and the questions say so. `--no-mcp` leaves the bridge out, and `integrate` never registers it. For Claude Code this is the only change to your normal configuration; `claude mcp remove zcode-harness --scope user` or `zcode-kit uninstall` removes it. Other MCP clients can use this entry:

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["--max-semi-space-size=1", "<absolute kit installation path>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

The bridge needs ZCode Desktop installed and signed in, and its model list can differ from the proxy's. In the recorded test (Windows 11, ZCode 0.16.9, 2026-09-23) it listed and selected GLM-5.3-Flash, but the provider rejected the model request with code 1113 (insufficient balance), so a model reply through the bridge is not confirmed. See the [bridge documentation](../mcp/zcode-harness-mcp/README.md).

## Other clients

Any client that speaks the OpenAI or Anthropic API can use the proxy without an integration. `zcode-kit proxy start` and `zcode-kit proxy status` print the base URLs, the key and the model IDs. The full key is shown only on an interactive terminal; `zcode-kit models --show-key` prints it elsewhere. The examples use the default port `8457`.

```yaml
# OpenAI format
base_url: http://127.0.0.1:8457/v1
api_key: <local proxy key>
model: glm-5.3            # or glm-5.3-flash
```

```yaml
# Anthropic format
base_url: http://127.0.0.1:8457
auth_token: <local proxy key>
model: glm-5.3
```

The proxy serves `POST /v1/messages` (Anthropic), `POST /v1/chat/completions` and `POST /v1/responses` (OpenAI), `GET /v1/models`, `GET /health` and `GET /quota`. All of them need the key, as `Authorization: Bearer <key>` or as `x-api-key`.

### Thinking levels

Both models take the levels `low`, `high` and `max`; see the [effort mapping](../EFFORT_MAPPING.md).

- **OpenAI format:** send `reasoning_effort`. `medium` is treated as `high`, and a request without the field runs at `max`. The proxy adds a thinking budget of 8000, 16000 or 32000 tokens.
- **Anthropic format:** send `thinking: {type: "enabled", budget_tokens: <n>}` together with `output_config: {effort: "low"|"high"|"max"}`.
- **Flash always thinks.** A request to `glm-5.3-flash` that turns thinking off is sent with `low`.

## Errors and quota

- **`[1005] exceed quota limit` (HTTP 400):** the quota is used up. The proxy retries for about 65 seconds and then tries another account if the Account Rotator has one. If the error still reaches you, wait until the quota is restored; `zcode-kit proxy status` shows it.
- **`[3007] captcha verify failed`:** the provider's abuse check rejected the request. The proxy retries once with a new token; if that fails too, wait before you retry.
- **`[1210]` with Flash:** choose `low`, `high` or `max` instead of turning thinking off.
- **HTTP 401:** `Invalid or missing proxy API key` means that the client sent the wrong local key. Otherwise check sign-in with `zcode-kit auth status` and renew it with `zcode-kit auth login zai`. Add `--import` to take over the active Desktop `zai`/`start-plan` login; `coding-plan` logins sign in without it.
- **Temporary failures before any output** (connection refused or reset, HTTP 429, 500, 502, 503, 504, 524 or 529, or a stream that fails before its first content) are retried up to 3 times with a growing delay. Nothing is retried once output has started. `ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS`, read when the proxy starts, sets the base delay in milliseconds (default 500, at most 10000).
- **A reply that is cut off** ends with an error instead of stopping silently: `data: {"error":…}` in chat streams, `response.failed` in Responses streams, `event: error` in Anthropic streams. Send the request again from the assistant.
