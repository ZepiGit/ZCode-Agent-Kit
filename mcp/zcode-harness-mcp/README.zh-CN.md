# zcode-harness-mcp（中文）

[English](README.md) | **中文** | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md)

> 本文为英文原文的翻译；如有出入，以英文原版为准。

一个 MCP 服务器（stdio **与** Streamable-HTTP），让其他模型和 Agent 控制
**真实安装的 ZCode harness**：发现能力、选择模型、读取/修改设置、管理
工作区与会话、启动任务、回答追问、观察进度，并取回包含文件变更和产物的
完整结果。

桥接是一个**控制层**，不是聊天客户端，也不是提示词包装器：所有工作都由
原始的 ZCode 运行时（`zcode.cjs app-server --stdio`，本地安装）以其自身的
工具、上下文管理和权限来执行。

- 协议：对外是 MCP（官方 SDK），对内是 **ZCode Protocol v1**（stdio 上的
  NDJSON，已针对 0.16.5 做过实机验证）——见 [`docs/PROTOCOL.md`](docs/PROTOCOL.md)。
- 规模：32 个 MCP 工具 + MCP 资源；包含 45 个条目的能力注册表
  （[`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md)）。
- `npm test` 使用确定性本地 fixtures。实机测试必须显式启用；历史报告不是当前验收证据。
- 审计加固：会话 ID 同样受工作区限制，`yolo` 需要 `--allow-yolo`。工具允许列表采用精确名称，拒绝 Bash、PowerShell 和 Shell。产物读取有大小上限，JSONL 保留两个各不超过4 MiB的文件。EOF 中断任务并正常关闭子进程，但不保证 Windows 进程树隔离。`--runtime-path` 会执行代码，只能指定可信文件。

## 前提条件

- Windows 10/11（已测试）；其他系统无法自动发现已安装的 Harness 时，使用 `--runtime-path` 指定
- Node.js ≥ 20（`node --version`）；脚本以固定的程序名 `node` 启动 harness
- 已安装 ZCode（桌面版）。桥接会自动在以下位置查找 `zcode.cjs`：
  - `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
  - `%ProgramFiles%\ZCode\resources\glm\zcode.cjs`
  - 也可以用 `--runtime-path` 或 `ZCODE_HARNESS_RUNTIME_PATH` 指定已安装的文件
- ZCode 已登录（harness 使用本地 Z.AI OAuth 登录；桥接**不管理任何凭据**，
  并在所有输出中对机密信息做脱敏）

## 安装（Windows / PowerShell）

正式版安装器和 npm 设置包含已构建的桥接，并会安装其依赖。
如需从源码重新构建，请按下方步骤操作；如果已有检出目录，
可跳过克隆，直接进入 `mcp/zcode-harness-mcp`。

```powershell
cd $HOME
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git
cd ZCode-Agent-Kit\mcp\zcode-harness-mcp
npm install
npm run build
# 检查运行时发现：
npm run probe:runtime
```

## 快速开始

### 1) 在 MCP 客户端中注册为 MCP 服务器（stdio）

示例配置（如 `claude_desktop_config.json` 或 `.mcp.json`）：

```json
{
  "mcpServers": {
    "zcode-harness": {
      "command": "node",
      "args": [
        "C:\\path\\to\\zcode-agent-kit\\mcp\\zcode-harness-mcp\\dist\\index.js",
        "--stdio",
        "--allow-workspace", "C:\\Users\\<you>\\Projects",
        "--interaction-policy", "ask"
      ]
    }
  }
}
```

### 2) Streamable-HTTP 模式（多客户端，需显式启用）

```powershell
node dist\index.js --http --http-key "<random-local-secret>" --host 127.0.0.1 --port 3322 --allow-workspace "C:\Users\<you>\Projects"
# MCP 端点： http://127.0.0.1:3322/mcp（仅限 localhost；不要公开暴露）
```

### 3) 以其他 Agent 视角运行的演示

```powershell
# 针对真实安装：
node examples\demo-client.mjs --workspace "C:\Users\<you>\demo-workspace"
# 离线针对 fixture harness：
node examples\demo-client.mjs --fixture
```

演示客户端展示完整流程：发现能力 → 打开工作区 → 读取真实模型目录 →
GLM-5.3-Flash 检查（不会静默切换模型）→ 修改设置 → 启动任务 → 轮询进度 →
回答追问 → 读取结果 + 产物 → 在同一会话中下达后续任务。

### 4) 测试

```powershell
npm test          # 构建 + 单元 + 集成（fixture harness，确定性）
$env:LIVE_TEST="1"; $env:LIVE_WORKSPACE="C:\path\to\workspace"; $env:LIVE_DATA_DIR="C:\path\to\data"
npm run test:live # 显式开启：真实安装，可能消耗额度
```

## 最重要的命令行参数

| 参数 | 含义 |
| --- | --- |
| `--stdio` | 通过 stdin/stdout 的 MCP（默认） |
| `--http --http-key KEY --port N --host H` | 带 Bearer 密钥的 Streamable-HTTP 模式（默认 127.0.0.1:3322） |
| `--read-only` | 拒绝变更类工具（技术上强制，而非仅注记） |
| `--allow-workspace P` | 放行工作区根目录（可多次；可用 `ZCODE_HARNESS_ALLOW_WORKSPACES` 传 `;` 分隔列表） |
| `--runtime-path P` | `zcode.cjs` 的显式路径 |
| `--data-dir D` | 持久化目录（默认 `~/.zcode-harness-mcp`） |
| `--interaction-policy deny\|allowlist\|ask` | 如何应答权限请求（默认： `deny`） |
| `--interaction-allowlist "Read,Glob"` | `allowlist` 精确工具名（拒绝 shell） |
| `--max-concurrent-tasks N` | 并行度（默认 2；超出部分排队） |

## 安全模型（简述）

- 工作区允许列表带真实路径解析（symlinks/junctions），同时覆盖任务
  **和**产物读取访问
- 只读模式：变更类工具返回错误；任务的 `readOnly` 还会在 harness 侧强制
  计划模式 + 写入工具拒绝列表
- 所有工具输出、日志和事件中的机密脱敏；凭据永远不会被暴露或管理
- 进程启动仅使用参数数组（`shell: false`）、固定程序（`node`）、不使用
  shell 字符串
- 追问（权限/用户输入）绝不自动展开：策略 `deny`（默认）、`allowlist`
  或带超时的 `ask` → 安全的默认应答（deny）
- 桥接不会在自身的 ZCode 运行时中注册自己、不公开暴露网络、不自动安装
  插件

详情：[`docs/SECURITY.md`](docs/SECURITY.md) · 诚实的限制： [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)

## 状态

当前实现与验证状态：[`KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) · 测试证据：[CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml) · API 参考： [`docs/MCP_API.md`](docs/MCP_API.md)

## 许可证

MIT。参考仓库 [zcode-acp](https://github.com/william0wang/zcode-acp)（Apache-2.0）与 [zcode-open-bridge](https://github.com/tizerluo/zcode-open-bridge)（MIT）曾作为协议来源进行调研（提交记录见 `docs/PROTOCOL.md`）；从中采纳的代码：无。
