# ZCode Agent Kit（中文）

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)
![Release](https://img.shields.io/github/v/release/ZepiGit/ZCode-Agent-Kit)

[English](README.md) | **中文** | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md)

> 本文为英文原文的翻译；如有出入，以英文原版为准。

通过**你自己的 ZCode Desktop 账号**为你的 Agent 工具（harness）提供模型访问——
不需要第二份订阅，不需要购买 API。十个 harness 适配器、一个本地代理、
可透明回滚。

```
你的 harness（OMP / pi / Claude Code / Codex / OpenCode / Cline / Kilo Code /
            Aider / Continue / Goose / 任何支持 MCP、OpenAI 或 Anthropic 格式的客户端）
        │
        ├─► 本地 zcode-proxy  http://127.0.0.1:8457（OpenAI + Anthropic + Responses 格式）
        │         └─► zcode.z.ai（start-plan，与你的 ZCode Desktop 同一配额）
        │
        └─► zcode-harness-mcp（stdio）──► 你已安装的 ZCode Desktop（真实桌面会话）
```

模型：**glm-5.3**（纯文本，1M 上下文）与 **glm-5.3-flash**（文本+图像，1M
上下文）；已验证的推理强度为 **low / high / max**（默认 max）。

## 快速开始

**Windows（PowerShell）**——固定版本安装器，SHA256 校验，无需管理员权限：

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.ps1 | iex
```

**macOS / Linux**：

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.sh | sh
```

安装器会下载固定版本的发布包并校验校验和，安装到用户目录
（默认 `%LOCALAPPDATA%\zcode-agent-kit` 或 `~/.local/share/zcode-agent-kit`，
可用 `ZCODE_KIT_HOME` 覆盖），如缺少 bun 则自动在用户目录安装 v1.4.2，
然后运行带 harness 检测的 setup。

**从仓库检出安装**（开发或手动安装）：

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
cd zcode-agent-kit
node setup.mjs                          # 或：node cli\zcode-kit.mjs setup --harness auto
node cli\zcode-kit.mjs doctor
```

前提条件：**Node ≥ 20**（仅仓库检出方式需要 bun，安装器会自带）以及**已安装
并登录的 ZCode Desktop**（凭据导入会读取你现有的桌面登录；MCP 桥在生成模型
回复期间需要桌面应用处于运行状态）。全程不需要管理员权限。检测到 WSL 时会
拒绝安装——请安装到 Windows 宿主机。

## zcode-kit CLI

```
zcode-kit setup [--harness auto|omp,pi,...]   初始化 + 集成检测到的 harness
zcode-kit integrate <harness> --dry-run       预览将要写入的内容
zcode-kit integrate <harness>                 应用单个适配器（事务性）
zcode-kit run <harness> -- <args>             以 ZCode 配置启动 claude-code/codex/aider/opencode
zcode-kit doctor [--harness <id>] [--json]    机器可读的诊断
zcode-kit status                              代理状态 + 配额快照
zcode-kit models [--json] [--show-key]        可用模型列表（来自运行中的代理）
zcode-kit usage --json                        账号用量/配额（绝不编造数值）
zcode-kit auth status|login|logout            代理凭据生命周期（logout 不会触碰你的桌面登录）
zcode-kit update                              快进更新仓库并重新应用集成
zcode-kit rollback [tx-id]                    回滚最近一次（或指定的）事务，三路安全
zcode-kit uninstall                           移除 kit 的集成；绝不删除共享凭据
```

所有写入都是事务性的：文件先做哈希与备份；回滚是所有权感知的——之后发生的
用户改动会以冲突形式报告，绝不会被覆盖。

## setup 的行为

`setup --harness auto` 只会改动**检测到的** harness——只装 OMP 的用户不会
得到任何 Claude/Codex 产物，反之亦然：

1. **bootstrap** —— 生成本地代理密钥（`.proxykey`，排他创建）、从模板生成
   `proxy/config.yaml`，用 `bun install --frozen-lockfile` 安装依赖（安装失败
   是硬错误，绝不会被吞掉），并从你现有的 ZCode Desktop 登录导入凭据。
2. **十个适配器**（每个仅对检测到或显式指定的 harness 生效）——详见
   `harnesses/README.md` 与 `SUPPORT_MATRIX.json`。
3. **MCP 桥** —— 仅向实际存在的 harness 注册 `zcode-harness` stdio 桥。
   仅注册 MCP 不算模型集成（Cline/Kilo 明确标注 manual-confirmation-required）。

在一台只装了 OMP 的机器上，恰好只运行 OMP 适配器加上 OMP 的 MCP 条目——
不会产生任何 Claude 或 Codex 相关内容。

## 各 harness 用法

**OMP**（附加 provider；完整 TUI/CLI 集成，含思考强度）：

```bash
omp --model zcode/glm-5.3-flash --thinking low -p "hi"
omp --model zcode/glm-5.3 --thinking max
```

**pi**（`~/.pi/agent/models.json`，附加 provider `zcode`）：

```bash
pi --model zcode/glm-5.3
```

**Claude Code**（可选启用包装器；`~/.claude` 不被改动）：

```bat
bin\zcode-claude.cmd -p "hi" --model glm-5.3-flash
```

**Codex CLI**（可选启用包装器，隔离的 CODEX_HOME）：

```bat
bin\zcode-codex.cmd exec "say hi" -m glm-5.3-flash
```

**Aider / OpenCode / Goose**（启动器仅设置进程级环境变量）：

```bat
node cli\zcode-kit.mjs run aider -- --model openai\glm-5.3-flash
node cli\zcode-kit.mjs run opencode -- .
goose session --provider zcode
```

**Cline / Kilo Code**（GUI 配置）：kit 会把准备好的参数表写入 `generated/`
并标注 `manual-confirmation-required`——绝不触碰 VS Code 的内部状态。

**其他客户端**（`http://127.0.0.1:8457` 上的 OpenAI / Anthropic / Responses
格式，Bearer 令牌 = `.proxykey` 的内容）：见 `harnesses/README.md`。

## 代理管理

```bat
node proxy\zcode-proxy-manager.mjs status
node proxy\zcode-proxy-manager.mjs start
node proxy\zcode-proxy-manager.mjs stop
node proxy\zcode-proxy-manager.mjs restart
node proxy\zcode-proxy-manager.mjs doctor
node proxy\zcode-proxy-manager.mjs logs 50
```

安全属性：仅绑定 127.0.0.1；经过身份验证的健康/身份检查；fail-closed 停止
（端口上无法验证身份或属于外部的进程**永远不会**被杀；通过进程启动时间检测
PID 复用）；针对并行启动的管理器锁；先优雅后强制的关停；日志轮转与有界读取；
试用领取与错峰通道在发行配置中禁用。`doctor` 会把真实的认证有效性与 JWT
年龄分开，且只检查本机存在的组件。

## 登录续期

```bash
cd zcode-proxy-src
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai --import
# 或浏览器登录：
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai
```

## 卸载 / 回滚

```bat
node cli\zcode-kit.mjs rollback      :: 回滚最近一次事务（每次一步）
node cli\zcode-kit.mjs uninstall     :: 回滚 kit 拥有的一切并移除 generated/
node proxy\zcode-proxy-manager.mjs stop
```

`uninstall` 绝不删除 `~/.zcode-proxy/credentials.json`（与其他代理工具共享）
或你的 ZCode Desktop 登录/数据。`zcode-kit auth logout` 只移除代理自身的
存储凭据，并会明确说明。

## 更新

`zcode-kit update` 在工作树有改动时拒绝执行，只做快进合并（绝不强推），
并以事务方式重新应用集成。内嵌代理已固定版本（见 `MANIFEST.md`）；
本地补丁位于 `patches/`。

## 测试

```bat
npm run test          :: kit 套件（node --test）：事务、管理器安全、适配器、回归
npm run test:proxy    :: 858 个 bun 测试，含协议契约测试（SSE 边界、工具参数、中止、用量）
npm run test:mcp      :: MCP 桥套件（36 个测试，含 HTTP 认证/来源门、Allowlist 逃逸）
```

## 文档

- `SUPPORT_MATRIX.json` / `.md` —— 每个适配器的真实状态（已实现 / 配置已测 /
  已实测 / 需手动确认）
- `EFFORT_MAPPING.md` / `.json` —— low/high/max 如何映射到上游参数
- `SETUP_REPORT.md`、`TEST_REPORT.md` —— 带确切命令的测试证据
- `IMPLEMENTATION_STATUS.md` —— 决策与未决事项
- `harnesses/README.md` —— 各 harness 的细节与手动集成片段
- `MANIFEST.md` —— 内嵌组件、提交、许可证
- `docs/RELEASE_CHECKLIST.md` —— 发布前已备好与待办事项
