# Harness config formats vs. the kit's adapters (drift audit)

## Answer

1. Two adapters write config the harness rejects or misroutes (HIGH). Continue writes `capabilities` as a map, but the schema requires a string array (`continue.mjs:23,32,46-47`). The Kilo values sheet gives the Anthropic-Messages base URL without `/v1`, and `@ai-sdk/anthropic` treats baseURL as the `/v1` prefix, so requests go to `/messages`, which the proxy does not serve (`kilo-code.mjs:28,33-34`).
2. MEDIUM drift is mostly reasoning and image capability that never reaches the harness:
   - Claude Code: effort is off for `glm-*` IDs because neither `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` nor `_SUPPORTED_CAPABILITIES` is set.
   - pi: no `thinkingLevelMap`, so `max` is unavailable.
   - OMP: `auth` is omitted, which gives OAuth-style shaping, and the `supportsOutputEffort`/`injectClaudeCodeInstruction` compat keys are outside the models.yml schema.
   - Image input is never declared for Flash in Goose (`supports_vision`), OpenCode (`modalities`) or Kilo (Images flag).
3. OpenCode 2.x (stable since 2.2.x, 2026-10-27) moved to a `providers`/`package`/`settings` schema. It still accepts and migrates the kit's V1 `provider`/`npm`/`options` block, so this is LOW legacy drift, not breakage. Codex (`wire_api="responses"`, `windows.sandbox="unelevated"`), Aider and the OMP/pi paths and core fields are still current.
4. Some stale rationale comments are now false. Cline has a documented CLI config (`cline auth -p openai -b … -m …`, `~/.cline/data/settings/providers.json`). Kilo has a documented `kilo.jsonc` provider schema. OMP 18.16 supports `!command` apiKeys again. Claude's `ANTHROPIC_SMALL_FAST_MODEL` is deprecated.
5. Recorded versions are stale: OMP 18.1.18 → v18.16.0 (2026-11-02), Claude Code 2.1.269 → 2.1.318 (2026-11-04), Codex 0.153.4 → 0.166.0 (2026-10-29). Every adapter `primarySource` says "checked 2026-09-13". pi moved to `earendil-works/pi` and Goose to `aaif-goose/goose`.

## Details

Verified 2026-11-06 against GitHub releases (`gh api …/releases`), npm, tagged source files and the official docs pages listed under Sources. Each adapter citation is `file:line` in `/home/AgentKit/wt/overhaul` at commit `10c51dc`. No code changes are proposed; this note only lists drift.

### Latest releases (as of 2026-11-05/06)

| Harness | Latest release | Date | Recorded in kit |
|---|---|---|---|
| Claude Code | v2.1.318 (npm `@anthropic-ai/claude-code`) | 2026-11-04 | 2.1.269 (`MANIFEST.md:28`) |
| Codex CLI | rust-v0.166.0 stable (npm `@openai/codex` 0.166.0); rust-v0.168.0-alpha.7 prerelease 2026-11-05 | 2026-10-29 | 0.153.4 (`MANIFEST.md:29`, `codex.mjs:13`) |
| OpenCode | v2.2.5 (`anomalyco/opencode`, npm `@opencode/cli`); V1 line v1.19.5 (npm `opencode-ai`) 2026-10-28 | 2026-10-30 | none |
| Aider | v0.86.0 GitHub release 2025-08-09; PyPI `aider-chat` 0.86.2 | 2026-02-12 | none |
| Continue | v2.0.0-vscode (v2.1.0-vscode pre); `@continuedev/cli` 1.5.47 | 2026-06-19 | none |
| Goose | v1.57.0 (`aaif-goose/goose`, formerly `block/goose`) | 2026-10-28 | none |
| Cline | v4.1.26 (extension); npm `cline` CLI 3.0.74 | 2026-10-26 | none |
| Kilo Code | v7.8.27 (`Kilo-Org/kilocode`, npm `@kilocode/cli`) | 2026-11-05 | none |
| OMP | v18.16.0 (`can1357/oh-my-pi`, npm `@oh-my-pi/pi-coding-agent`) | 2026-11-02 | 18.1.18 Canary (`MANIFEST.md:27`) |
| pi | v1.5.0 (`earendil-works/pi`, npm `@earendil-works/pi-coding-agent`; old `@mariozechner/pi-coding-agent` stopped at 0.73.1) | 2026-11-02 | none (`pi.mjs:52` cites `badlogic/pi-mono`) |

### Current config surface per harness

| Harness | File / location (Win · macOS · Linux) | Custom provider registration | Reasoning / effort | Image flag | MCP |
|---|---|---|---|---|---|
| Claude Code | `~/.claude/settings.json` (same on all OSes under the home dir); per-invocation `--settings <file>` | env `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (Bearer) or `ANTHROPIC_API_KEY` (x-api-key), `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS,FABLE}_MODEL`; `ANTHROPIC_SMALL_FAST_MODEL` is **[DEPRECATED]** | Unrecognized IDs get no effort/thinking unless `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1` or `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES=effort,max_effort,thinking,…`; `CLAUDE_CODE_EFFORT_LEVEL` | none per model (capabilities list covers effort/thinking only) | `claude mcp add <name> --scope user -- <cmd> <args>` (not re-checked this pass) |
| Codex CLI | `$CODEX_HOME/config.toml`, default `~/.codex` on all OSes | `model_provider` + `[model_providers.<id>]` `name`, `base_url`, `env_key`, `wire_api` (only `responses` is supported, and it is the default) | `model_reasoning_effort` (low…max/ultra, model-dependent); `model_context_window` | via model catalog (`model_catalog_json`) | `[mcp_servers.<id>] command/args` |
| OpenCode 2.x | `~/.config/opencode/opencode.json(c)` on **all** OSes (XDG roots incl. Windows, `packages/util/src/global-roots.ts@v2.2.5`); `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR` honored; system dir `%ProgramData%\opencode` · `/Library/Application Support/opencode` · `/etc/opencode` | V2: `providers.<id>.{name, env[], package:"@opencode/ai/providers/openai-compatible" or "aisdk:@ai-sdk/…", settings.{baseURL,apiKey}, models.<id>.{modelID, capabilities, limit, variants:[{id,…}]}}`. The V1 `provider.<id>.{npm, options, models}` shape is still accepted and migrated (`packages/core/src/v1/config/migrate.ts@v2.2.5`). | V1 `options.reasoningEffort` kept as a setting; V1 `variants` map is converted to the V2 array | V2 `capabilities.input`; V1 `modalities.input` (migrated) | V2 `mcp.servers.<id>.{type:"local",command:[…]}`; V1 `mcp.<id>` migrated |
| Aider | env `OPENAI_API_BASE`, `OPENAI_API_KEY`; `~/.aider.conf.yml`, `.env`; `.aider.model.settings.yml` / `.aider.model.metadata.json` in home or repo | `--model openai/<id>` | `--reasoning-effort` only if the model's settings list `accepts_settings: [reasoning_effort]` | model metadata | n/a |
| Continue | `~/.continue/config.yaml` (`%USERPROFILE%\.continue` on Windows) | `models[]: {name, provider: openai, model, apiBase, apiKey, roles, capabilities: [tool_use, image_input]}`; secrets `${{ secrets.X }}` | `defaultCompletionOptions.{reasoning, reasoningBudgetTokens, contextLength}` | `capabilities: [image_input]` (string array) | `mcpServers[]: {name, command, args, env}` |
| Goose | `%APPDATA%\Block\goose\config\custom_providers\` (Windows) · `~/.config/goose/custom_providers/` (macOS/Linux) | JSON `{name, engine: openai\|anthropic\|ollama, display_name, base_url (full chat/completions URL accepted), models:[{name, context_limit, reasoning, supports_vision}], requires_auth, auth:{command,args,refresh_interval,timeout_seconds,cwd}}` | per-model `reasoning: bool`; thinking-effort picker | `supports_vision` (honored since v1.55.0) | extensions in `config.yaml` |
| Cline | Extension: VS Code internal state (GUI). CLI: `~/.cline/data/settings/providers.json`, `global-settings.json` | Extension: OpenAI Compatible → Base URL, API key, Model ID, model info (context window, image support). CLI: `cline auth -p openai -k <key> -b <baseurl> -m <model>` | CLI `--thinking none\|low\|medium\|high\|xhigh` | extension "Image Support" | CLI `~/.cline/data/settings/cline_mcp_settings.json` (`CLINE_MCP_SETTINGS_PATH`); extension MCP JSON via UI |
| Kilo Code | `~/.config/kilo/kilo.jsonc` / `kilo.json` (global); `./kilo.jsonc`, `./.kilo/` (project) | Dialog: Provider ID, Display name, Provider API (OpenAI Compatible = `@ai-sdk/openai-compatible`, OpenAI Responses = `@ai-sdk/openai`, Anthropic Messages = `@ai-sdk/anthropic`), Base URL, API key, Models, Headers. Config: `provider.<id>.{npm, name, options.baseURL, models.<id>.{name, reasoning, modalities, variants}}` | per-model `reasoning`, `variants` | per-model `modalities` ("Images" toggle) | `mcp.<name>.{type:"local", command:[…]}` |
| OMP | `~/.omp/agent/models.yml` (`~/.omp/profiles/<name>/agent/` for profiles; `PI_CODING_AGENT_DIR`, `PI_CONFIG_DIR`), `config.yml`, `mcp.json` | `providers.<id>.{baseUrl, apiKey (literal, env name or "!cmd"), api: anthropic-messages\|openai-completions\|…, auth: apiKey\|none\|oauth, models[], modelOverrides}`. A custom `anthropic-messages` provider gets **OAuth-style shaping when `auth` is omitted**. | `thinking.{mode: anthropic-budget-effort…, efforts, defaultLevel, requiresEffort, effortMap}` | model `input: [text, image]` | `mcp.json` `mcpServers.<n>.{type:"stdio",command,args}` |
| pi | `~/.pi/agent/models.json` (`PI_CODING_AGENT_DIR`), JSON with comments stripped | `providers.<id>.{baseUrl, api, apiKey (literal, $ENV or !command), authHeader, models[{id, name, reasoning, thinkingLevelMap, input, contextWindow, maxTokens, cost}]}` | `thinkingLevelMap`; unmapped levels go up to `high`, and **`xhigh` and `max` are unsupported** unless mapped | `input: ["text","image"]` | `~/.pi/agent/mcp.json` `mcpServers`, `pi mcp add` |

### Drift tables

Verdicts: OK = matches the current harness; DRIFT = differs; UNVERIFIED = could not be confirmed from a primary source. Severity applies to DRIFT only.

#### Claude Code (`cli/adapters/claude-code.mjs`, `cli/zcode-kit.mjs`)

| Field the adapter writes | Harness now | Verdict | Severity |
|---|---|---|---|
| `env.ANTHROPIC_BASE_URL` = proxy root (`claude-code.mjs:22`) | supported | OK | – |
| `env.ANTHROPIC_AUTH_TOKEN` (`:23`) | Bearer header; supported | OK | – |
| `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` (`:24,26-28`) | supported | OK | – |
| `ANTHROPIC_SMALL_FAST_MODEL` (`:25`) | marked [DEPRECATED]; HAIKU var replaces it | DRIFT | Low |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS=1000000` (`:31`) | applies directly to unrecognized IDs without `[1m]` | OK | – |
| no `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` / `_SUPPORTED_CAPABILITIES` (`:20-32`) | effort/thinking come from ID pattern matching; `glm-*` IDs get none unless declared. This conflicts with the effort pairing in `harnesses/README.md:100-103`. | DRIFT | Medium |
| `claude --settings <file>` launcher (`cli/launch.mjs:15`) | `--settings` still documented | OK | – |
| `claude mcp add zcode-harness --scope user -- node … --stdio` (`zcode-kit.mjs:529`) | not re-checked this pass | UNVERIFIED | – |
| recorded version 2.1.269 (`MANIFEST.md:28`) | 2.1.318 | DRIFT | Low |

#### Codex CLI (`cli/adapters/codex.mjs`)

| Field | Harness now | Verdict | Severity |
|---|---|---|---|
| isolated `CODEX_HOME/config.toml` (`codex.mjs:17,36`; `launch.mjs:17`) | `$CODEX_HOME/config.toml` | OK | – |
| `model`, `model_provider = "zcode"` (`:23-24`) | supported | OK | – |
| `[model_providers.zcode] name, base_url …/v1, env_key, wire_api="responses"` (`:26-30`) | `responses` is the only value | OK | – |
| `[windows] sandbox = "unelevated"` (`:25`) | `mxc \| elevated \| unelevated` | OK | – |
| `[mcp_servers.zcode-harness] command/args` (`:32-34`) | supported | OK | – |
| no `model_context_window` / `model_reasoning_effort` for unknown `glm-5.3` (`:21-35`) | keys exist; fallback metadata for an unknown model not confirmed | UNVERIFIED | – |
| recorded 0.153.4 (`MANIFEST.md:29`, `codex.mjs:13`) | 0.166.0 stable | DRIFT | Low |

#### OpenCode (`cli/adapters/opencode.mjs`)

| Field | Harness now (2.2.5) | Verdict | Severity |
|---|---|---|---|
| path `XDG_CONFIG_HOME ?? ~/.config` + `/opencode/opencode.json(c)`, `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR` (`opencode.mjs:12-17`) | same on all OSes incl. Windows | OK | – |
| header comment "%APPDATA%/opencode on Windows" (`:2-3`) | Windows also uses `~/.config/opencode` | DRIFT (comment only) | Low |
| top-level `provider.zcode` with `npm: "@ai-sdk/openai-compatible"`, `options.{baseURL, apiKey}` (`:19-26,87`) | V2 key is `providers` with `package`/`settings`; the V1 shape is accepted and migrated (`npm` → `aisdk:` package, `options` → settings) | DRIFT (legacy, still works) | Low |
| `apiKey: "{env:ZCODE_PROXY_KEY}"` (`:25`) | `{env:…}` still documented; V2 also has `env: [..]` | OK | – |
| `models.<id>.limit.{context,output}` (`:28,30`) | migrated to V2 `limit` | OK | – |
| Flash `options.reasoningEffort` + `variants` map low/high/max (`:31-36`) | reasoningEffort kept as setting; map → `[{id,…}]` | OK | – |
| no `modalities.input: [text, image]` for Flash (`:29-37`) | without it the model gets default (text) capabilities | DRIFT | Medium |
| mixed file: user already on V2 `providers` + kit adds V1 `provider` | merge of both shapes in one file not documented | UNVERIFIED | – |

#### Aider (`cli/adapters/aider.mjs`, `cli/launch.mjs`)

| Field | Harness now | Verdict | Severity |
|---|---|---|---|
| `OPENAI_API_BASE=…/v1`, `OPENAI_API_KEY` process-local (`aider.mjs:20-21`; `launch.mjs:22-23`) | documented | OK | – |
| default `--model openai/glm-5.3` (`aider.mjs:22`; `launch.mjs:24`) | `openai/<model>` prefix documented | OK | – |
| no `.aider.model.settings.yml` (`accepts_settings: [reasoning_effort]`) or metadata (context, vision) | `--reasoning-effort` is ignored with a warning for models that do not declare it | DRIFT (gap) | Low |

#### Continue (`cli/adapters/continue.mjs`)

| Field | Harness now | Verdict | Severity |
|---|---|---|---|
| `~/.continue/config.yaml`, append to `models:` (`continue.mjs:132`) | location and schema v1 current | OK | – |
| `name`, `provider: openai`, `model`, `apiBase …/v1`, `apiKey` literal (`:17-21,26-30`) | current | OK | – |
| `roles: [chat, edit, apply]` (`:22,31`) | valid enum values | OK | – |
| `capabilities: { toolUse: true[, imageInput: true] }` (`:23,32`, emitted `:46-47`) | `capabilities: modelCapabilitySchema.array()`, values `tool_use`, `image_input`. A map fails zod validation. | DRIFT | **High** |
| no `defaultCompletionOptions.{contextLength, reasoning}` | fields exist; the default context window for an unknown model is not confirmed | UNVERIFIED | – |

#### Goose (`cli/adapters/goose.mjs`)

| Field | Harness now (1.57.0) | Verdict | Severity |
|---|---|---|---|
| dir `%APPDATA%/Block/goose/config/custom_providers` · `~/.config/goose/custom_providers` (`goose.mjs:10-16`) | `Paths::config_dir()` via etcetera "Block/goose"; docs say the same | OK | – |
| `name, engine: openai, display_name, description` (`:30-33`) | current | OK | – |
| `base_url` = full `/v1/chat/completions` (`:35`) | still accepted (docs + tests in `declarative.rs`) | OK | – |
| `models[{name, context_limit}]` (`:36-39`) | current | OK | – |
| no `supports_vision: true` on Flash (`:38`) | honored since v1.55.0; unset falls back to the catalog, then false, so images are stripped | DRIFT | Medium |
| no `reasoning: true` per model (`:37-38`) | `ModelInfo.reasoning` drives the thinking-effort picker | DRIFT | Low |
| `supports_streaming`, `requires_auth`, `auth.{command,args,refresh_interval:0,timeout_seconds}` (`:40-47`) | `AuthConfig` matches; `0` = reactive refresh only | OK | – |
| `primarySource` goose-docs.ai (`:22`) | official docs domain; repo now `aaif-goose/goose` | OK | – |

#### Cline (`cli/adapters/cline.mjs`)

| Field | Harness now (4.1.26 / CLI 3.0.74) | Verdict | Severity |
|---|---|---|---|
| values sheet: OpenAI Compatible, Base URL `…/v1`, API key, Model ID, Image Support (`cline.mjs:27-33`) | matches the extension's OpenAI Compatible settings | OK | – |
| rationale "Cline CLI … config interface is not documented" (`:5-7,16`) | CLI documents `cline auth -p openai -k -b -m` and `~/.cline/data/settings/providers.json` | DRIFT (stale rationale; integration path missed) | Medium |
| no reasoning-effort value in the sheet | CLI `--thinking none…xhigh` (no `max`); extension field not confirmed | UNVERIFIED | – |

#### Kilo Code (`cli/adapters/kilo-code.mjs`)

| Field | Harness now (7.8.27) | Verdict | Severity |
|---|---|---|---|
| Provider ID `zcode`, Display name, Provider API "Anthropic Messages" (`kilo-code.mjs:25-27`) | dialog fields; Anthropic Messages = `@ai-sdk/anthropic` (`provider-model.ts:5`, `CustomProviderDialog.tsx:45`) | OK | – |
| Base URL `http://127.0.0.1:PORT` "no /v1 suffix" (`:28,33-34`) | `@ai-sdk/anthropic` baseURL is the URL prefix, default `https://api.anthropic.com/v1`, so requests go to `<base>/messages`. The proxy only routes `/v1/messages` (`zcode-proxy-src/src/server/server.ts:159`). Not run end to end. | DRIFT | **High** |
| "Models can also be auto-fetched from /v1/models" (`:35`) | fetching is disabled for `@ai-sdk/anthropic` (`CustomProviderDialog.tsx:233`) | DRIFT | Low |
| no Reasoning / Images flags in the sheet (`:23-30`) | dialog and schema take per-model `reasoning`, `modalities`, `variants` (`custom-provider.ts:52-54`) | DRIFT | Medium |
| "kilo.jsonc … documented only sparsely" (`:4-5,36-37`) | documented: `~/.config/kilo/kilo.jsonc`, `provider.<id>.models` with modalities, limit, variants | DRIFT (stale rationale) | Low |

#### OMP (`cli/adapters/omp.mjs`, `cli/zcode-kit.mjs`)

| Field | Harness now (18.16.0) | Verdict | Severity |
|---|---|---|---|
| `~/.omp/agent/models.yml`, `config.yml` (`omp.mjs:218-220`) | default-profile paths current; named profiles (`~/.omp/profiles/<n>/agent`) and `PI_CODING_AGENT_DIR` not honored | DRIFT | Low |
| `providers.zcode.{name, baseUrl root, api: anthropic-messages, apiKey literal}` (`:147-151`) | valid fields | OK | – |
| `auth` omitted (`:147-151`) | custom `anthropic-messages` uses **OAuth-style shaping** when `auth` is omitted; `auth: apiKey` gives plain shaping (`docs/models.md:212`) | DRIFT | Medium |
| `modelOverrides.*.thinking.{mode: anthropic-budget-effort, efforts, defaultLevel: max, requiresEffort: true}` (`:153-161,168-175`) | all in `ModelThinkingSchema` | OK | – |
| `compat.supportsContextManagement`, `replayUnsignedThinking` (`:164-165,178-179`) | honored for anthropic-messages | OK | – |
| `compat.supportsOutputEffort`, `injectClaudeCodeInstruction` (`:163,166,177,180`) | not in the models.yml compat schema; docs say other Anthropic knobs "are not configurable here" (`docs/models.md:964-971`). `injectClaudeCodeInstruction:false` is therefore likely ignored while the OAuth-style shaping above applies. | DRIFT | Medium |
| `models[{id, name, reasoning, input, contextWindow, maxTokens, cost}]` (`:181-206`) | current | OK | – |
| comment "omp 18+ no longer evaluates the `!node` resolver" (`:339-341,346`) | `apiKey` may start with `!` to read command stdout (`docs/models.md:287`). The literal key still works; the rationale is stale. | DRIFT (comment) | Low |
| `config.yml` `extensions:` + `disabledProviders` cleanup (`:98-139,255-262`) | both keys current; extension also auto-discovered from `extensions/`, deduped by absolute path | OK | – |
| `~/.omp/agent/mcp.json` `mcpServers.zcode-harness {type: stdio, command, args}` (`zcode-kit.mjs:494-519`) | current | OK | – |
| recorded 18.1.18 Canary (`MANIFEST.md:27`) | v18.16.0 | DRIFT | Low |

#### pi (`cli/adapters/pi.mjs`)

| Field | Harness now (1.5.0) | Verdict | Severity |
|---|---|---|---|
| `~/.pi/agent/models.json`, skip if dir absent (`pi.mjs:55-60`) | path current; `PI_CODING_AGENT_DIR` not honored | DRIFT | Low |
| leading `//` comment line (`:15,100`) | loader runs `stripJsonComments` | OK | – |
| `x-zcode-agent-kit` marker key (`:21`) | TypeBox `Type.Object` without `additionalProperties:false` accepts it | OK | – |
| `baseUrl` root, `api: anthropic-messages`, `apiKey: !node "<path>"` (`:22-24`) | `!command` supported; `authHeader` default false → x-api-key, which the proxy accepts (`server.ts:98`) | OK | – |
| models `id, name, reasoning:true, input, contextWindow, maxTokens, cost` (`:25-44`) | current | OK | – |
| no `thinkingLevelMap` (`:25-44`) despite header claim "verified low/high/max levels via thinkingLevelMap" (`:7-9`) | unmapped levels use the provider default up to `high`; `xhigh`/`max` unsupported | DRIFT | Medium |
| `primarySource` `badlogic/pi-mono … docs/models.md` (`:52`) | repo is `earendil-works/pi`; field reference is now `docs/models-configuration.md` | DRIFT | Low |

### MCP registration coverage (informational, no drift)
The kit registers the bridge only for OMP, Claude Code and Codex (`harnesses/README.md:61`). pi (`~/.pi/agent/mcp.json`), Kilo (`mcp` key), OpenCode (`mcp.servers`), Continue (`mcpServers`), Goose (extensions) and the Cline CLI (`cline_mcp_settings.json`) now all have documented file-based MCP config. That gap is a scope choice, not drift.

## Sources

- Claude Code env vars, https://code.claude.com/docs/en/env-vars (fetched 2026-11-05); model config, https://code.claude.com/docs/en/model-config (fetched 2026-11-05); LLM gateway, https://code.claude.com/docs/en/llm-gateway (fetched 2026-11-05); release v2.1.318, https://github.com/anthropics/claude-code/releases (2026-11-04).
- Codex config reference, https://developers.openai.com/codex/config-reference (fetched 2026-11-04); releases, https://github.com/openai/codex/releases (rust-v0.166.0, 2026-10-29).
- OpenCode V2 config, https://opencode.ai/v2/docs/config (fetched 2026-11-02); providers, https://opencode.ai/v2/docs/providers (fetched 2026-11-05); migration, https://opencode.ai/v2/docs/migrate-v1; source `anomalyco/opencode@v2.2.5` (commit `9bbb8ce18c80f099e0e448775f59d965ead40a21`, 2026-10-30): `packages/core/src/v1/config/migrate.ts`, `provider-options.ts`, `provider.ts`, `mcp.ts`, `packages/util/src/global-roots.ts`, `packages/cli/src/server-process.ts`; release notes v2.2.0 (2026-10-27) and v2.2.1 (2026-10-29).
- Aider OpenAI-compatible, https://aider.chat/docs/llms/openai-compat.html (fetched 2026-11-05); reasoning, https://aider.chat/docs/config/reasoning.html (fetched 2026-11-05); PyPI `aider-chat` 0.86.2 (2026-02-12).
- Continue config.yaml reference, https://docs.continue.dev/reference (fetched 2026-10-26); schema `continuedev/continue@v2.0.0-vscode` (commit `03b05ef6…`, 2026-06-19) `packages/config-yaml/src/schemas/models.ts`.
- Goose custom providers, https://goose-docs.ai/docs/getting-started/providers/ (fetched 2026-11-06); source `block/goose@v1.57.0` (commit `30bba951…`, 2026-10-27) `crates/goose-providers/src/declarative.rs`, `crates/goose-provider-types/src/base.rs`, `crates/goose/src/config/paths.rs`; release v1.55.0 (2026-10-16, "Honor supports_vision", #12769); PR https://github.com/aaif-goose/goose/pull/12010 (2026-09-11).
- Cline CLI reference, https://docs.cline.bot/cli/cli-reference; getting started, https://docs.cline.bot/cline-cli/getting-started; MCP, https://docs.cline.bot/mcp/configuring-mcp-servers; OpenAI compatible, https://docs.cline.bot/provider-config/openai-compatible (all fetched 2026-11-06); issue https://github.com/cline/cline/issues/11671 (2026-06-19).
- Kilo custom models, https://kilo.ai/docs/code-with-ai/agents/custom-models; OpenAI-compatible, https://kilo.ai/docs/ai-providers/openai-compatible; CLI, https://kilo.ai/docs/code-with-ai/platforms/cli; MCP, https://kilo.ai/docs/automate/mcp/using-in-kilo-code (all fetched 2026-11-06); source `Kilo-Org/kilocode@v7.8.27` (commit `03a6f07d…`, 2026-11-05) `packages/kilo-vscode/src/shared/custom-provider.ts`, `src/shared/provider-model.ts`, `webview-ui/src/components/settings/CustomProviderDialog.tsx`.
- AI SDK Anthropic provider (`baseURL` prefix default `https://api.anthropic.com/v1`), https://ai-sdk.dev/providers/ai-sdk-providers/anthropic (fetched 2026-11-04).
- OMP source `can1357/oh-my-pi@v18.16.0` (commit `650f3a10…`, 2026-11-02): `docs/models.md`, `docs/mcp-config.md`, `docs/extension-loading.md`, `docs/config-usage.md`, `packages/coding-agent/src/config/models-config-schema-bundle.ts`, `packages/catalog/src/types.ts`.
- pi source `earendil-works/pi@v1.5.0` (commit `f9a26365…`, 2026-11-02): `packages/coding-agent/docs/models.md`, `models-configuration.md`, `configuration.md`, `mcp.md`, `src/core/model-config.ts`.
- npm registry (`npm view`, 2026-11-06): `@anthropic-ai/claude-code`, `@openai/codex`, `opencode-ai`, `@kilocode/cli`, `cline`, `@continuedev/cli`, `@oh-my-pi/pi-coding-agent`, `@earendil-works/pi-coding-agent`, `@mariozechner/pi-coding-agent`.
