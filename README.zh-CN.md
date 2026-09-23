# ZCode Agent Kit
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · **简体中文**

在你已经使用的编程助手中使用自己的 ZCode 账号。

![ZCode Desktop 通过 Agent Kit 连接到编程助手](zcode_agent_kit.png)

*Kit 在本机运行；模型请求会发送到 ZCode。*

继续使用熟悉的编程助手，通过本地连接使用现有的 ZCode 模型和额度。

**可选的账号轮换：**安装器会询问 **"Do you want to activate the Account Rotator feature? [y/n]"**。回答 `y` 后，当前登录会被导入；以后通过 `zcode-kit auth login zai` 登录的新账号会作为额外账号保存。再次登录同一个账号会更新其记录。之后可以用 `zcode-kit accounts enable` 启用，用 `zcode-kit accounts` 查看保存的账号。详见[账号轮换文档（英文）](docs/ACCOUNT_ROTATOR.md)。

**使用流程：**准备账号 → 安装 Kit → 使用 GLM-5.3(-flash) 开始工作。

## 第 1 步 — 检查所需条件

- [ZCode Desktop](https://zcode.z.ai/en)：已登录自己的账号，且模型额度仍可用。
- [Node.js 20 或更新版本](https://nodejs.org/)：在新终端中运行 `node --version` 检查。
- 单独安装的编程助手。Kit 会将其连接到 ZCode。


## 第 2 步 — 安装一次 Kit

在下面的正式版安装器和 npm 之间选择一种方式。正式版安装器会自动配置检测到的助手，无须再单独运行设置命令。

安装器会显示四个编号步骤、简洁的助手配置结果和连接检查。详细的设置输出保存在屏幕提示的 `install.log` 中；设置 `ZCODE_KIT_VERBOSE=1` 可显示全部输出，设置 `NO_COLOR=1` 可显示纯文本。交互式安装必须对账号轮换问题回答 `y` 或 `n`。无人值守安装可设置 `ZCODE_KIT_ACCOUNT_ROTATOR=y` 或 `n`；如果没有明确回答，会保留原有设置。即使安装成功，连接检查失败仍会显示为警告。

> **运行安装器之前：**安装器会下载并执行脚本、修改已检测助手的配置，还可能注册 MCP 工具。设置时也会尝试一次小型模型请求，可能消耗额度。变更会被记录，但之后若发生错误，先前的变更仍可能保留。如果安全政策有要求，请先检查安装脚本。

**Windows — PowerShell，无须管理员权限：**

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS / Linux — POSIX 终端：**

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

可以在任意目录运行，无须克隆仓库。安装器会执行设置，缺少 Bun 时也可以安装。Windows 下请使用 PowerShell，不要使用 Git Bash 或 WSL。

<details>
<summary>安装位置与 macOS/Linux 的前置条件</summary>

默认位置：Windows 下为 `%LOCALAPPDATA%\zcode-agent-kit`；macOS/Linux 下为 `$HOME/.local/share/zcode-agent-kit`。请将此目录与工作项目分开。不要将安装目标设为主目录或源码检出目录：更新会替换目标目录里的文件。

macOS/Linux 还需要 `curl`、`tar` 和 SHA-256 工具；安装 Bun 需要 `unzip`，更新需要 `rsync`。目前实际客户端验证主要针对 Windows；请参阅带日期的[支持矩阵](SUPPORT_MATRIX.json)。

</details>

**替代方式 — npm（Windows、macOS 和 Linux）：**

需要提前安装 [Bun](https://bun.sh/docs/installation) 和 Node.js 20+，并确保终端能够运行 `bun --version`（已用 Bun 1.4.2 测试）。

```sh
npm install -g zcode-agent-kit@latest
zcode-kit setup --harness auto --installer
```

npm 会安装 `zcode-kit` 和 `zcode-agent-kit` 两个命令。第二个命令会安装 Kit 的依赖项、配置检测到的助手，并询问账号轮换的 y/n 问题。安装 npm 包后请运行该命令。使用同一种安装方式，以确保命令、配置和代理属于同一份 Kit。

## 第 3 步 — 在所选助手中使用 GLM-5.3(-flash)

打开新终端并运行 `zcode-kit help`。然后在**自己的项目目录内**打开终端，不要在 Kit 目录内运行。选择已安装的助手：

**OMP：**

```sh
omp -p --model zcode/glm-5.3-flash "Reply with ok"
```

**Claude Code：**

```sh
zcode-kit run claude-code -- -p "Reply with ok" --model glm-5.3-flash
```

**Codex：**

```sh
zcode-kit run codex -- exec "Reply with ok" -m glm-5.3-flash
```

这些命令会自动启动或检查代理。收到 `ok` 回复才表示第一次模型调用成功；仅有设置成功的消息不足以证明模型可用。

**收到回复了吗？**对于这次请求，你的账号、代理和所选助手已协同工作。现在可以在自己的项目中使用该助手。

**没有回复？**请使用下方“获取帮助”中的检查项；额度耗尽无法靠重新安装解决。

## 第 4 步 — 在自己的项目中使用

启动交互式 OMP 会话：

```sh
omp --model zcode/glm-5.3-flash
```

启动交互式 Claude Code 会话：

```sh
zcode-kit run claude-code -- --model glm-5.3-flash
```

文本任务选择 `glm-5.3`；文本和图片任务选择 `glm-5.3-flash`。图片支持还取决于助手自身。可选的 MCP 桥接提供本机 ZCode 运行时的工具；注册它不等于连接了模型。

**目前尚未发布的本地修复：**Flash 始终启用 thinking。禁用 thinking 的请求会被规范化为 `low`；显式选择的 `high` 和 `max` 保持不变。在 OMP 中使用 `--thinking low`、`--thinking high` 或 `--thinking max` 选择级别。已通过直接代理调用和 Claude Code 验证 Flash 能完整返回模型回复；这并不表示所有助手都已通过测试。

<details>
<summary>其他助手与集成限制</summary>

| 助手 | 设置后的操作 |
| --- | --- |
| OpenCode | 运行 `zcode-kit run opencode -- .` 并选择 ZCode 模型。 |
| Aider | 运行 `zcode-kit run aider -- --model openai/glm-5.3-flash`。 |
| pi | 手动启动代理，然后运行 `pi --model zcode/glm-5.3`。 |
| Goose | 手动启动代理，然后运行 `goose session --provider zcode`。 |
| Continue | 先打开并配置 Continue。运行 `zcode-kit integrate continue`，启动代理，再在界面中选模型。 |
| Cline / Kilo Code | 将生成的配置值填入扩展的界面并启动代理。正式版安装会在安装目录中生成 `generated/cline-zcode-values.md` 或 `generated/kilo-zcode-values.md`。 |

直接运行 OMP，不要通过 `zcode-kit run` 启动。只有 Claude Code、Codex、Aider 和 OpenCode 提供 Kit 启动器。Codex 使用隔离的配置环境；你平时使用的设置和技能不会自动继承。Claude Code 的路由属于社区兼容方案。存在适配器并不保证每个客户端或版本都经过实际测试。

参阅[助手专用文档](harnesses/README.zh-CN.md)和[支持矩阵](SUPPORT_MATRIX.json)。

</details>

<details>
<summary>手动启动或停止代理</summary>

以下路径**仅适用于正式版安装器的默认位置**：

**PowerShell：**

```powershell
node (Join-Path $env:LOCALAPPDATA 'zcode-agent-kit/proxy/zcode-proxy-manager.mjs') start
```

**macOS/Linux：**

```sh
node "$HOME/.local/share/zcode-agent-kit/proxy/zcode-proxy-manager.mjs" start
```

按需要将 `start` 换成 `status`、`logs 50` 或 `stop`。停止代理会中断已连接的客户端。若使用自定义位置，请使用该安装的绝对路径。这些默认路径不适用于 npm 安装。

</details>

## 获取帮助

```sh
zcode-kit doctor
zcode-kit auth status
```

- **找不到命令：**重新打开终端。对于正式版安装，请检查 `%LOCALAPPDATA%\Microsoft\WindowsApps`（Windows）或 `$HOME/.local/bin`（macOS/Linux）是否位于 PATH 中。
- **模型没有回复：**检查 Desktop 登录状态和可用额度。如果助手不会自动启动代理，请手动启动。本地健康检查不能证明模型可访问。
- **OMP 自启动（目前尚未发布的本地修复）：**直接启动 OMP。设置过程固定原生 Node/Bun；扩展在新的子进程中执行预检查，而不是将 Kit 模块导入 OMP。失败时会报告不含秘密信息的错误类别；子进程最长运行 120 秒。修复所报告的原因后，等待该会话的 60 秒冷却时间再重试；可在同一会话中恢复。若运行时位置已变更，请重新运行 `zcode-kit setup --harness auto` 并重新加载扩展。不会干预占用端口的未知进程。
- **导入 Desktop 登录（目前尚未发布的本地修复）：**运行 `zcode-kit auth login zai --import`，导入 Desktop 0.16.9 当前激活的 `zai`/`start-plan` 登录；必须已明确配置计划。只要存在 `credentials.json`，就以它为准；凭据无效时不会静默回退到旧的 `config.json`。新版 `coding-plan` 登录应改用 `zcode-kit auth login zai` 进行常规 OAuth 登录；导入器不会创建或获取 API 密钥。
- **401 或端口被占用：**检查是否存在另一份 Kit。不要删除密钥，也不要终止不认识的进程。
- **设置中途失败：**重试前先阅读输出中的回滚命令。此前的变更可能仍在。

## 使用真实项目数据之前

让代理仅监听 localhost，不要分享 `.proxykey`、凭据或生成的配置文件。

**阅读[安全政策（英文）](SECURITY.md)（也提供[德文版](SECURITY.de.md)）：**托管代理可能在没有操作系统沙箱的情况下执行供应商的 CAPTCHA JavaScript。代理仍仅限本机环回地址，并要求 Bearer 密钥，但这些措施不能隔离进程。它不会绕过账号限制，也无法保证所有验证都成功。

<details>
<summary>更新或移除 Kit</summary>

**更新：**

- 正式版安装：用相同的专用目标目录重新运行同一个正式版安装器。如果想要最新版本，请移除旧的 `ZCODE_KIT_VERSION` 版本固定设置。
- npm 安装：运行 `npm install -g zcode-agent-kit@latest`，随后从该 npm 安装运行 `zcode-kit setup --harness auto --installer`。

更新时保持使用同一种安装方式。

**移除集成：**使用上方管理命令的 `stop` 停止代理，再运行 `zcode-kit uninstall`。安装目录、依赖项、日志、代理密钥和共享凭据仍会保留；Desktop 不会因此退出登录。删除剩余文件前请先检查。

如果通过 npm 安装，之后再运行 `npm uninstall -g zcode-agent-kit` 移除全局包。

</details>

## 更多信息

[助手指南](harnesses/README.zh-CN.md) · [支持矩阵](SUPPORT_MATRIX.json) · [安全政策（英文）](SECURITY.md) · [报告问题](https://github.com/ZepiGit/ZCode-Agent-Kit/issues) · [组件清单（英文）](MANIFEST.md)
