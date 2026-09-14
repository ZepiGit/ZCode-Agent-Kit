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
- 测试：针对确定性 fixture harness 的 7 个单元测试 + 20 个集成/健壮性
  测试 + 针对真实安装的 5 个实机测试（[`TEST_REPORT.md`](TEST_REPORT.md)）。

## 前提条件

- Windows 10/11（已测试）或任何 PATH 中有 `node` 的操作系统
- Node.js ≥ 20（`node --version`）；脚本以固定的程序名 `node` 启动 harness
- 已安装 ZCode（桌面版）。桥接会自动在以下位置查找 `zcode.cjs`：
  - `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
  - `%ProgramFiles%\ZCode\resources\glm\zcode.cjs`
  - 也可以显式指定：`--runtime-path` 或 `ZCODE_HARNESS_RUNTIME_PATH`
- ZCode 已登录（harness 使用本地 Z.AI OAuth 登录；桥接**不管理任何凭据**，
  并在所有输出中对机密信息做脱敏）

## 安装（Windows / PowerShell）

在 ZCode Agent Kit 的检出中，桥接已经位于 `mcp/zcode-harness-mcp/` ——
无需克隆，直接进入该目录即可。

```powershell
cd $HOME
git clone <本仓库> zcode-harness-mcp   # 或直接复制文件夹
cd zcode-harness-mcp
npm install
npm run build
# 运行时检测自检：
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
        "C:\\Users\\<you>\\zcode-harness-mcp\\dist\\index.js",
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
node dist\index.js --http --host 127.0.0.1 --port 3322 --allow-workspace "C:\Users\<you>\Projects"
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
npm run test:live # 针对真实安装的实机测试： $env:LIVE_TEST="1"; $env:LIVE_WORKSPACE="C:\..."; $env:LIVE_DATA_DIR="C:\..."
```

## 最重要的命令行参数

| 参数 | 含义 |
| --- | --- |
| `--stdio` | 通过 stdin/stdout 的 MCP（默认） |
| `--http --port N --host H` | Streamable-HTTP 模式（默认 127.0.0.1:3322） |
| `--read-only` | 拒绝变更类工具（技术上强制，而非仅注记） |
| `--allow-workspace P` | 放行工作区根目录（可多次；可用 `ZCODE_HARNESS_ALLOW_WORKSPACES` 传 `;` 分隔列表） |
| `--runtime-path P` | `zcode.cjs` 的显式路径 |
| `--data-dir D` | 持久化目录（默认 `~/.zcode-harness-mcp`） |
| `--interaction-policy deny\|allowlist\|ask` | 如何应答权限请求（默认： `deny`） |
| `--interaction-allowlist "Bash,Read"` | `allowlist` 策略的前缀允许列表 |
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

当前实现与验证状态：[`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) · 测试证据：[`TEST_REPORT.md`](TEST_REPORT.md) · API 参考： [`docs/MCP_API.md`](docs/MCP_API.md)

## 许可证

MIT。参考仓库 [zcode-acp](https://github.com/william0wang/zcode-acp)（Apache-2.0）与 [zcode-open-bridge](https://github.com/tizerluo/zcode-open-bridge)（MIT）曾作为协议来源进行调研（提交记录见 `docs/PROTOCOL.md`）；从中采纳的代码：无。
