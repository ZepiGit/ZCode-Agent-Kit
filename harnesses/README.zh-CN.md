# 助手指南
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · **简体中文**

> 本文为英文原文的翻译；如有出入，以英文原版为准。

本页针对每个受支持的编程助手，说明要运行什么命令、Kit 会写入什么，以及还需要你自己做什么。安装方法见[主 README](../README.zh-CN.md)。CLI 把助手称为“harness”，所以参数名是 `--harness`。

Kit 需要 Node.js 24 或更高版本；Node.js 20 和 22 已不再受支持，在这些版本上 `zcode-kit setup` 和 `zcode-kit update` 会直接停止，不做任何更改。如果没有安装 Bun，正式版安装器会安装 Bun 1.4.2。`zcode-kit --version` 输出已安装的版本；`zcode-kit help` 列出所有命令。

## 在设置中选择助手

`zcode-kit setup` 会查找已安装的助手，只配置你同意的那些。

- **在终端中**，它以复选框列表显示检测到的助手：方向键移动，空格键勾选或取消勾选，`a` 切换全部，Enter 确认。勾选的助手会被配置，未勾选的会被跳过。按 Esc，或在没有勾选任何项时按 Enter，不会保存任何回答。
- **在不支持颜色或光标控制的终端中，或终端太小、放不下列表时**，它会针对每个助手单独询问 `Configure ZCode for <助手>? [y/n]`。`zcode-kit setup --select` 则显示一个带编号的列表，可输入编号、`all` 或 `none`。
- **没有终端时**（CI、管道），它不会提问，并跳过所有没有已保存回答的助手。这时请自行指定助手：`zcode-kit setup --harness omp,codex` 或 `ZCODE_KIT_HARNESSES=omp,codex` 只配置指定的这些。`none` 跳过所有检测到的助手；未知 id 视为错误。

回答保存在 `generated/harness-choices/` 下，之后的设置、`zcode-kit update` 和 `zcode-kit doctor --fix` 都会沿用：你同意的会保持最新，你拒绝的不会被改动，也不会再次询问。`zcode-kit setup --reask` 会在终端中重新询问，`zcode-kit doctor --forget <助手>` 删除一条已保存的回答。本 Kit 之前创建的集成，即使没有为它保存回答，也可能被刷新。

Ctrl-C 会让设置以退出码 130 结束。尚未确认的复选框列表不会被应用；已经给出的 y/n 回答保持生效。如果某个助手失败，它的部分更改会被撤销，其他助手仍会被配置，设置以退出码 20 结束。设置会输出用于撤销其更改的 `zcode-kit rollback` 命令。助手已配置只表示文件已经写入，并不表示登录有效或模型能够回复；请用 `zcode-kit auth status` 检查登录状态。

## 只配置一个助手

```sh
zcode-kit integrate <助手> --dry-run   # 列出将要写入的内容，不实际写入
zcode-kit integrate <助手>             # 写入并保存你的同意
zcode-kit rollback                     # 撤销最近一次更改
```

`--dry-run` 会为每个将被更改的文件输出一行 `would write`。实际运行还会为该助手保存一条“同意”，因此之后的设置和更新会让它保持最新。它绝不会注册 MCP 桥接。在 Kit 的 git 检出中，除非设置了 `ZCODE_KIT_ALLOW_CHECKOUT=1`，否则 `setup` 和 `integrate` 会拒绝写入。

## 概览

| 助手（id） | 设置写入的内容 | 启动方式 | 是否用模型回复测试过 |
|---|---|---|---|
| OMP (`omp`) | `~/.omp/agent/models.yml` 中的 provider `zcode`，以及一个自启动扩展 | `omp --model zcode/glm-5.3-flash` | Windows，版本 18.2.9 |
| pi (`pi`) | `~/.pi/agent/models.json` 中的 provider `zcode` | 先运行 `zcode-kit proxy start`，再运行 `pi --model zcode/glm-5.3` | Windows，版本 0.85.0 |
| Claude Code (`claude-code`) | `generated/claude-zcode-settings.json` | `zcode-kit run claude-code -- <args>` | Windows，版本 2.1.278 |
| Codex CLI (`codex`) | `generated/codex-home/config.toml` | `zcode-kit run codex -- <args>` | Windows，版本 0.155.1 |
| OpenCode (`opencode`) | OpenCode 配置文件中的 provider `zcode` | `zcode-kit run opencode -- <args>` | Windows，版本 1.18.29 |
| Aider (`aider`) | `generated/aider-zcode.env` | `zcode-kit run aider -- <args>` | Windows，版本 0.86.2 |
| Continue (`continue`) | `~/.continue/config.yaml` 中的两个模型 | 先运行 `zcode-kit proxy start`，再在 Continue 中选择模型 | 否 |
| Goose (`goose`) | Goose 的 `custom_providers` 文件夹中的 `zcode.json` | 先运行 `zcode-kit proxy start`，再运行 `goose session --provider zcode` | 否 |
| Cline (`cline`) | `generated/cline-zcode-values.md` | 先在 Cline 中填入这些值，再运行 `zcode-kit proxy start` | 否 |
| Kilo Code (`kilo-code`) | `generated/kilo-zcode-values.md` | 先在 Kilo Code 中填入这些值，再运行 `zcode-kit proxy start` | 否 |

最后一列来自[支持矩阵](../SUPPORT_MATRIX.json)：Windows 11，2026-09-23，Kit v0.2.33，`glm-5.3-flash`。在 Linux 和 macOS 上没有用真实的模型回复测试过任何助手。标为“否”的行只测试了配置的写入，没有用到助手本身。

`generated/` 和本地密钥 `.proxykey` 在正式版安装和源码检出中位于 Kit 目录，在 npm 安装中位于 `node_modules` 之外的单独状态目录。写入的文件中有一些以明文包含该密钥；不要分享这些文件，密钥变更后请重新运行 `zcode-kit setup`。

`zcode-kit run <助手> -- <args>` 适用于 Claude Code、Codex CLI、OpenCode 和 Aider。它会在需要时启动代理，并把 `--` 之后的所有内容传给助手。Kit 目录中的脚本 `bin/zcode-claude`、`bin/zcode-codex` 和 `bin/zcode-aider`（`.cmd` 或 `.sh`）作用相同。

## 各助手说明

### OMP

直接启动 OMP；没有 `zcode-kit run omp`。用 `--thinking low`、`high` 或 `max` 选择 thinking 级别；Kit 声明的默认值是 `max`。设置会在 `models.yml` 中添加一个带标记的块，并把扩展复制到 `~/.omp/agent/extensions/`；如果存在 `config.yml`，还会在其中注册该扩展，并从 `disabledProviders` 中移除 `zcode`。如果 `models.yml` 不存在，设置会跳过 OMP；如果文件中已有你自己写的 `zcode` provider，则不做任何更改。

当 OMP 首次向 `zcode` 模型发送请求时，扩展会启动代理。启动检查在单独的进程中运行，最长 120 秒。如果失败，OMP 会输出一行带原因的 `[zcode-autostart]`，并且至少 60 秒后才会再次尝试。扩展保存了设置时找到的 Node.js 的路径；如果该 Node.js 已被移除或版本低于 24，请重新运行 `zcode-kit setup` 并重启 OMP。

### pi

pi 不会自行启动代理。该条目使用 Anthropic messages 格式，你的其他 provider 会保留。密钥不会写入文件：pi 通过运行 Kit 的脚本 `proxy/resolve-zcode-proxy-key.mjs` 获取密钥。如果 `~/.pi/agent` 不存在，设置会跳过 pi；如果文件中有不是 Kit 写入的 `zcode` provider，则不做任何更改。Kit 不为 pi 设置 thinking 级别。

### Claude Code

`~/.claude/settings.json` 不会被修改。`zcode-kit run claude-code -- <args>` 会运行 `claude --settings <生成的文件> <args>`，因此只有这一次调用会发往 ZCode，你平时的 `claude` 照常工作。这份设置把 `glm-5.3` 用作主模型，把 `glm-5.3-flash` 用作小而快的模型；加上 `--model glm-5.3-flash` 可全程使用 Flash。Anthropic 并不正式支持在 Claude Code 中使用 Claude 以外的模型。

### Codex CLI

`zcode-kit run codex -- <args>` 仅在这一次调用中把 `CODEX_HOME` 设为 `generated/codex-home`；`~/.codex` 和你平时的 `codex` 保持原样。由于这是一个单独的 home，你自己的 Codex 设置、skills、规则和 MCP 服务器在其中不生效。其中的 `config.toml` 使用 Responses API，以 `glm-5.3` 为默认模型，并且始终包含 Kit 的 MCP 桥接条目。在 Windows 上，它还会在 `[windows]` 下设置 `sandbox = "unelevated"`。

### OpenCode

设置会编辑 `OPENCODE_CONFIG` 指定的文件；未指定时，编辑 `OPENCODE_CONFIG_DIR`、`$XDG_CONFIG_HOME/opencode` 或 `~/.config/opencode` 中的 `opencode.jsonc` 或 `opencode.json`，文件不存在时会创建。其他设置以及 `provider` 部分之外的注释都会保留。如果已有不是 Kit 写入的 `zcode` provider，更改会中止并报错。该条目从环境变量 `ZCODE_PROXY_KEY` 读取密钥，`zcode-kit run opencode` 会设置这个变量。如果直接启动 `opencode`，请自行设置该变量，并先启动代理。`glm-5.3-flash` 有 `low`、`high` 和 `max` 三个变体，默认是 `low`。

### Aider

`zcode-kit run aider` 只为这一个进程设置 `OPENAI_API_BASE` 和 `OPENAI_API_KEY`；不会做任何系统级设置，也不会改动 `~/.aider.conf.yml`。不带参数时，它运行 `aider --model openai/glm-5.3`。带参数时请自行指定模型，例如 `zcode-kit run aider -- --model openai/glm-5.3-flash`。`generated/aider-zcode.env` 保存了同样的值，供手动使用。

### Continue

设置会把“ZCode GLM-5.3”和“ZCode GLM-5.3-Flash”放在一个带标记的块中，追加到 `models:` 列表末尾；已有模型会保留。如果 `config.yaml` 不存在，设置会跳过 Continue；文件存在后，请运行 `zcode-kit integrate continue`。写在同一行且带有条目的 `models:` 列表不会被编辑；请先把它改写成块列表。

### Goose

该文件夹在 Windows 上是 `%APPDATA%\Block\goose\config\custom_providers`，在 macOS 和 Linux 上是 `~/.config/goose/custom_providers`。密钥不保存在 `zcode.json` 中；Goose 通过运行 Kit 的密钥脚本获取密钥。不是本 Kit 写入的 `zcode.json` 不会被覆盖。

### Cline 和 Kilo Code

Kit 不会写入 VS Code 为这些扩展保存的存储。设置会写出一个包含各项值的文件，你需要在扩展的设置中填写一次：

- **Cline**：API Provider 选“OpenAI Compatible”，再填入以 `/v1` 结尾的基础 URL、密钥和一个模型 ID。该文件还给出了用于 Cline CLI 的 `cline auth` 命令。
- **Kilo Code**：新建一个 API 为“Anthropic Messages”的自定义 provider，填入以 `/v1` 结尾的基础 URL、密钥，并手动添加两个模型。Kit 不写入 `kilo.jsonc`。

这两个文件不包含密钥；用 `zcode-kit models --show-key` 输出密钥。设置只在 `~/.vscode/extensions` 中查找这两个扩展。如果使用其他编辑器，请运行 `zcode-kit integrate cline` 或 `zcode-kit integrate kilo-code`。

## MCP 桥接

桥接 `zcode-harness` 是一个本地 MCP 服务器，助手可以通过它操作你已安装的 ZCode 的会话和任务。注册它并不会连接模型。

当你勾选某个助手、为它回答 `y`，或用 `--harness` 指定它时，设置会为 OMP（`~/.omp/agent/mcp.json`）和 Claude Code（`claude mcp add zcode-harness --scope user`）注册桥接；列表和提问中都会说明这一点。`--no-mcp` 不注册桥接，`integrate` 则从不注册它。对 Claude Code 来说，这是对你平时配置的唯一更改；`claude mcp remove zcode-harness --scope user` 或 `zcode-kit uninstall` 可将其移除。其他 MCP 客户端可以使用下面的条目：

```json
{
  "mcpServers": {
    "zcode-harness": {
      "type": "stdio",
      "command": "node",
      "args": ["--max-semi-space-size=1", "<Kit 安装的绝对路径>/mcp/zcode-harness-mcp/dist/index.js", "--stdio"]
    }
  }
}
```

桥接需要已安装并已登录的 ZCode Desktop，它的模型列表可能与代理的不同。在记录在案的测试中（Windows 11，ZCode 0.16.9，2026-09-23），桥接列出并选中了 GLM-5.3-Flash，但服务商以代码 1113（余额不足）拒绝了模型请求，因此通过桥接获得模型回复尚未得到确认。详见[桥接文档](../mcp/zcode-harness-mcp/README.zh-CN.md)。

## 其他客户端

任何支持 OpenAI 或 Anthropic API 的客户端都可以不经集成直接使用代理。`zcode-kit proxy start` 和 `zcode-kit proxy status` 会输出基础 URL、密钥和模型 ID。完整密钥只在交互式终端中显示；其他情况下用 `zcode-kit models --show-key` 输出。示例使用默认端口 `8457`。

```yaml
# OpenAI 格式
base_url: http://127.0.0.1:8457/v1
api_key: <本地代理密钥>
model: glm-5.3            # 或 glm-5.3-flash
```

```yaml
# Anthropic 格式
base_url: http://127.0.0.1:8457
auth_token: <本地代理密钥>
model: glm-5.3
```

代理提供 `POST /v1/messages`（Anthropic）、`POST /v1/chat/completions` 和 `POST /v1/responses`（OpenAI）、`GET /v1/models`、`GET /health` 和 `GET /quota`。它们都需要密钥，通过 `Authorization: Bearer <密钥>` 或 `x-api-key` 发送。

### thinking 级别

两个模型都支持 `low`、`high` 和 `max` 三个级别；参见 [effort 对照表](../EFFORT_MAPPING.md)（英文）。

- **OpenAI 格式**：发送 `reasoning_effort`。`medium` 按 `high` 处理，不带该字段的请求按 `max` 运行。代理会附加 8000、16000 或 32000 tokens 的 thinking 预算。
- **Anthropic 格式**：发送 `thinking: {type: "enabled", budget_tokens: <n>}`，并同时发送 `output_config: {effort: "low"|"high"|"max"}`。
- **Flash 始终启用 thinking**。发往 `glm-5.3-flash` 且关闭了 thinking 的请求会按 `low` 发送。

## 错误与配额

- **`[1005] exceed quota limit`（HTTP 400）**：配额已用完。代理会重试约 65 秒，之后如果 Account Rotator 有其他账号，就改用那个账号。如果仍然收到该错误，请等待配额恢复；`zcode-kit proxy status` 会显示配额。
- **`[3007] captcha verify failed`**：服务商的反滥用检查拒绝了请求。代理会用新令牌重试一次；如果仍然失败，请稍等再重试。
- **Flash 返回 `[1210]`**：请选择 `low`、`high` 或 `max`，不要关闭 thinking。
- **HTTP 401**：`Invalid or missing proxy API key` 表示客户端发送了错误的本地密钥。其他情况请用 `zcode-kit auth status` 检查登录，并用 `zcode-kit auth login zai` 更新。加上 `--import` 可导入 Desktop 当前激活的 `zai`/`start-plan` 登录；`coding-plan` 登录则不带该选项。
- **输出开始前的暂时性故障**（连接被拒绝或重置，HTTP 429、500、502、503、504、524 或 529，或在第一段内容之前失败的流）最多重试 3 次，等待时间逐次增加。输出开始后不再重试。`ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS` 在代理启动时读取，用于设置基础等待时间（毫秒，默认 500，最大 10000）。
- **被中断的回复**会以错误结束，而不是无声地停止：聊天流中是 `data: {"error":…}`，Responses 流中是 `response.failed`，Anthropic 流中是 `event: error`。请从助手重新发送请求。
