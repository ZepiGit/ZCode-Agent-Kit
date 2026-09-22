# Harness 适配器 — 其他 Agent CLI 如何使用本地代理（中文）
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · **简体中文**

> 本文为英文原文的翻译；如有出入，以英文原版为准。

kit 的核心与具体 harness 无关：一个监听 `http://127.0.0.1:8457` 的本地
HTTP 代理，支持三种标准格式：

| 端点 | 格式 | 用途 |
|---|---|---|
| `POST /v1/messages` | Anthropic messages（SSE + 批量） | Claude Code 类客户端、OMP |
| `POST /v1/chat/completions` | OpenAI chat-completions（SSE + 批量） | OpenAI 兼容客户端 |
| `POST /v1/responses` | OpenAI Responses API | Agents SDK 类客户端 |
| `GET /v1/models` | 模型列表 | 发现 |
| `GET /health`, `GET /quota` | 状态/配额（需认证） | 诊断 |

认证：`Authorization: Bearer <.proxykey 的内容>`。
`zcode-kit setup` 在本地生成密钥。正式版和源码检出将 `.proxykey`
保存在 Kit 目录；npm 安装则保存在 `node_modules` 之外的专用状态目录。

## 由 `zcode-kit setup` 自动配置（仅针对检测到的 harness）

`zcode-kit setup --harness auto` 检测已安装的 harness，并**只配置这些**。
如果只装了 OMP，就不会创建 Claude/Codex 的配置或生成包装器文件。

| Harness | 机制 | 对现有配置的影响 |
|---|---|---|
| OMP (oh-my-pi) | `~/.omp/agent/models.yml` 中的 provider 块 `zcode` + 自启动扩展 | 附加式（受管块、事务性、幂等）；模型选择： `omp --model zcode/glm-5.3[-flash] --thinking low\|high\|max` |
| pi | `~/.pi/agent/models.json` 中的 provider `zcode`（`api: anthropic-messages`、`!node` 密钥解析器） | 附加式（其他 provider 保留）；来源：pi-mono docs/models.md |
| Claude Code | `generated/claude-zcode-settings.json` + `bin/zcode-claude.cmd\|.sh` | `~/.claude` 保持不变（按调用启用） |
| Codex CLI | 隔离的 `generated/codex-home` + `bin/zcode-codex.cmd\|.sh` | `~/.codex` 保持不变；**差异**：你自己的 skills/规则/MCP 在包装器内不生效 |
| OpenCode | `opencode.json` 中的 provider `zcode`（`@ai-sdk/openai-compatible`、apiKey `{env:ZCODE_PROXY_KEY}`） | 附加式；JSONC 注释保留 |
| Aider | `generated/aider-zcode.env` + `bin/zcode-aider.cmd\|.sh`（进程本地，**不用 setx**） | 模型 `openai/glm-5.3[-flash]` |
| Continue | `~/.continue/config.yaml` 中的受管块（schema v1） | 已有模型/角色保留 |
| Goose | `%APPDATA%/Block/goose/config/custom_providers/zcode.json`（Windows）或 `~/.config/goose/custom_providers/zcode.json`（macOS/Linux） | 凭据通过文档化的 `auth.command` 助手（kit 密钥解析器，无 shell） |
| Cline | `generated/cline-zcode-values.md` — **manual-confirmation-required** | kit 绝不触碰 VS Code 状态；在 UI 中手动录入一次即可 |
| Kilo Code | `generated/kilo-zcode-values.md` — **manual-confirmation-required** | 在 UI 中配置自定义 provider（Anthropic messages）；kit 有意不写 kilo.jsonc |
| 支持 MCP 的 harness | stdio 服务器 `zcode-harness`（`node mcp/zcode-harness-mcp/dist/index.js --stdio`） | OMP：写入 `~/.omp/agent/mcp.json`；Claude Code：`claude mcp add`（仅在检测到时）；Codex：隔离 home 内。仅 MCP 不算作模型集成 |

`generated/` 下的路径指向 Kit 状态：正式版/源码安装位于 Kit
目录中；npm 安装位于单独的状态目录中。

## 可选启用的包装器（现有配置不受影响）

| Harness | 包装器 | 作用 |
|---|---|---|
| Claude Code | `bin\zcode-claude.cmd` | 按需启动代理并调用 `claude --settings <Kit 状态>\generated\claude-zcode-settings.json`（CLI settings 优先于 user settings.json；你平时的 `claude` 照常运行） |
| Codex CLI | `bin\zcode-codex.cmd` | 设置 `CODEX_HOME=<Kit 状态>\generated\codex-home` + `ZCODE_PROXY_KEY` 并按需启动代理；你平时的 `codex` 和 `~/.codex` 不受影响 |

## 手动接入（任何支持 OpenAI/Anthropic 的客户端）

```yaml
# OpenAI 格式
base_url: http://127.0.0.1:8457/v1
api_key: <.proxykey 的内容>
model: glm-5.3            # 或 glm-5.3-flash
```

```yaml
# Anthropic 格式
base_url: http://127.0.0.1:8457
auth_token: <.proxykey 的内容>
model: glm-5.3
```

推理/思考强度：
- **Anthropic 格式**： `thinking: {type: "enabled", budget_tokens: 2048|16384|32768}`
  搭配 `output_config: {effort: "low"|"high"|"max"}` — 详情见
  [EFFORT_MAPPING.md](../EFFORT_MAPPING.md)。
- **OpenAI 格式**： `reasoning_effort: low|high|max` + `thinking: {type: "enabled"}`
  （代理会翻译成 Anthropic 字段）。

## MCP 客户端（通用）

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["<Kit 安装的绝对路径>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

桥接控制的是**真实安装的 ZCode Harness**（app-server 协议：会话、回合、
任务）。交互验证可能需要运行 Desktop；服务商仍可能拒绝模型请求。
桥接支持 `low/high/max` 推理级别。实时模型目录可能与代理不同；
GLM-5.3-Flash 已通过代理路径验证。详情见
[MCP 桥接文档](../mcp/zcode-harness-mcp/README.zh-CN.md)。

## 配额与错误形态

- `GET /quota`（需认证）显示各模型的令牌桶。
- 配额耗尽 → HTTP 400 `[1005] exceed quota limit`（不可重试；等待服务商恢复额度）。
- `[3007] captcha verify failed` → 高频重试后的网关反滥用机制；请暂停片刻。
- `401 start_plan_jwt_invalid` → 检查 Desktop 登录，并通过 `zcode-kit auth login zai` 更新。
