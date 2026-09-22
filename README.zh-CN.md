# ZCode Agent Kit

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)

[English](README.md) | **中文** | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md)

通过**你自己的 ZCode Desktop 账号**使用喜欢的编程助手。Kit 把受支持的助手连接到本地代理，不会替你安装助手、创建账号、购买配额，也不提供免费或无限访问。

- **模型代理：**支持 OpenAI Chat Completions、Responses、Anthropic Messages，默认地址为 `http://127.0.0.1:8457`。
- **模型：**`glm-5.3`（文本）、`glm-5.3-flash`（文本与图像）；标称上下文为 1M tokens，推理强度为 `low`、`high`、`max`。客户端兼容性和账号限制仍然适用。
- **可选 MCP 桥：**提供已安装 ZCode 运行时的操作接口，与模型提供方配置是两件事；Desktop 应用运行也不保证桥的模型调用获准。

## 尚未发布的审计修复

- Desktop 正在运行并不保证独立 MCP 模型调用成功，提供方仍可能拒绝。setup 保存配置后若模型测试失败，会报告警告，而不是宣称模型访问成功。
- 发布安装器将 Bun 绝对路径保存在 `.bun-path`，不修改全局 PATH。npm 状态移到 `node_modules` 之外：`%LOCALAPPDATA%/zcode-agent-kit/installs/<root-hash>` 或 `${XDG_STATE_HOME:-$HOME/.local/state}/zcode-agent-kit/installs/<hash>`。`ZCODE_KIT_STATE_DIR` 必须是该安装独占的绝对路径。源码/tarball 仍在根目录保存状态。替换旧 npm 包前先运行 setup 迁移；原数据保留，但已丢失的数据无法重建。
- MCP 工作区允许列表也约束会话 ID；`yolo` 必须通过 `--allow-yolo` 显式启用。日志有容量限制，同一桥的客户端共享信任域。
- 远程 CAPTCHA JavaScript 没有操作系统沙箱，Kit 外部默认禁用：手动启动的代理需要显式设置 `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA=1`。Kit 托管的服务通过 `proxyEnv` 自动启用该开关并自动解决 Captcha 挑战（进程内执行、无 OS 沙箱）；这不会绕过提供方限制。
- Start-plan 在客户端提示前加入随附的 ZCode 系统块并移除客户端 `cache_control`。Kit 使用中性 CWD `/workspace`，但平台、shell、系统版本、区域、追踪及设备元数据仍可能发送上游；不保证兼容性或访问权。
- main/dispatch 自动发布是有意设计。`ALLOW_PUBLISH` 只验证版本一致性，不是人工或法律授权。这些源码改动不证明已有对应发布版。

## 1. 安装前准备

1. **ZCode Desktop：**已登录自己的账号，并有可用模型配额。
2. **Node.js 20 或更新版：**已安装且终端 PATH 可用。[nodejs.org](https://nodejs.org/)
3. **Bun：**配置到持久 PATH。[安装说明](https://bun.sh/docs/installation)；验证使用 **1.4.2**。npm/源码 setup 用 Bun 安装依赖，并不安装 Bun 本身。
4. 单独安装你要用的助手：OMP、pi、Claude Code、Codex、OpenCode、Cline、Kilo Code、Aider、Continue 或 Goose。

打开**新的终端**检查：

```sh
node --version
bun --version
```

PowerShell 与 POSIX shell 都能运行。若找不到命令，先修好 PATH。发布安装器可以下载 Bun 并将绝对路径保存至 `.bun-path`；Kit 重启后仍可使用，无需修改全局 PATH。已有 Bun 会被复用，不会自动升级。

**Windows：**使用无需管理员权限的 PowerShell，不要在 Git Bash 或 WSL 中运行 `install.sh`。**macOS/Linux：**使用 POSIX shell，需要 `curl`、`tar`、SHA-256 工具，更新还需 `rsync`；引导安装 Bun 需 `unzip`。下述 Windows 验证不代表重新验证了 Linux/macOS 的真实客户端。

## 2. 只选一种安装方式

尽量不要混用 npm 与发布安装器的副本。它们可能持有不同代理密钥，却修改同一个助手用户配置。

### 推荐：已发布版本的安装器

可从**任意目录**执行，无需克隆仓库或进入 kit 目录。命令会下载并执行公开安装脚本；若安全策略要求，请先检查内容。

**Windows — PowerShell：**

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS/Linux — POSIX：**

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

安装器校验发布归档的 SHA-256，安装到用户目录并执行 setup。

| 系统 | Kit 目录 | 命令入口 |
|---|---|---|
| Windows | `%LOCALAPPDATA%\zcode-agent-kit` | `%LOCALAPPDATA%\Microsoft\WindowsApps\zcode-kit.cmd` |
| macOS/Linux | `$HOME/.local/share/zcode-agent-kit` | `$HOME/.local/bin/zcode-kit` |

优先级为 `ZCODE_KIT_INSTALL_DIR`、`ZCODE_KIT_HOME`、默认值。**必须使用专用绝对路径，绝不能指向 home、工作项目或源码检出目录：**更新会替换/镜像同步其中的文件。这些变量选择安装器目的地，不会重定向已安装 CLI 的路径。

如需固定版本，安装前把 `ZCODE_KIT_VERSION` 设为已有的发布标签，包含 `v` 前缀。恢复 latest 时移除该变量。它固定归档版本，但以上单行命令仍从最新发布获取安装脚本本身。

### 替代方案：npm

Node 与 Bun 必须已在 PATH；可从任意目录运行：

```sh
npm install -g zcode-agent-kit
zcode-kit setup
```

当前源码的 postinstall 只显示提示，集成由显式 setup 完成；旧发布包可能不同。npm 提供 `zcode-kit` 和 `zcode-agent-kit` 两个命令。404 可能表示包/版本不存在或无权访问，不证明本地安装故障。

不要用临时 `npx ... setup` 作为永久安装：生成配置会引用包的实际路径。请用稳定的全局安装或发布安装器。

## 3. 确认正在调用哪个副本

安装后新开终端。

**PowerShell：**

```powershell
Get-Command zcode-kit -All
node --version
bun --version
zcode-kit help
```

**macOS/Linux：**

```sh
command -v zcode-kit
node --version
bun --version
zcode-kit help
```

找不到 `zcode-kit` 时，可能需要把上表的命令入口目录加入用户/shell PATH，再打开终端。多个副本并存时使用下面的**显式路径**。Windows 的 PowerShell 与 Git Bash 可能选择不同副本。

### 显式路径：不依赖当前目录

每个终端会话设置一次**实际选择的安装路径**。下方默认值属于发布安装器，**不适用于 npm**。自定义目录或源码检出需修改赋值。

**PowerShell：**

```powershell
$KitRoot = Join-Path $env:LOCALAPPDATA 'zcode-agent-kit'
if (-not (Test-Path (Join-Path $KitRoot 'cli/zcode-kit.mjs'))) { throw 'Wrong KitRoot: cli/zcode-kit.mjs not found' }
node (Join-Path $KitRoot 'cli/zcode-kit.mjs') help
```

**macOS/Linux：**

```sh
KIT_ROOT="$HOME/.local/share/zcode-agent-kit"
if [ -f "$KIT_ROOT/cli/zcode-kit.mjs" ]; then
  node "$KIT_ROOT/cli/zcode-kit.mjs" help
else
  printf '%s\n' 'Wrong KIT_ROOT: cli/zcode-kit.mjs not found' >&2
fi
```

检查失败就停下修正路径。npm 的 `npm root -g` 返回全局模块目录，kit 位于其中的 `zcode-agent-kit` 子目录。不能把发布安装路径当作 npm 路径。

**不要在任意文件夹运行 `node cli/zcode-kit.mjs`。**相对路径以当前目录为基准，而非 kit 位置。全局命令入口或绝对路径可以避免这一错误。

## 4. 配置并发起首次模型调用

Setup 根据程序和配置目录检测助手并应用适配器。被检测到不代表客户端完整安装或真实可用。选择目标或预览：

```sh
zcode-kit setup --harness omp
zcode-kit integrate continue --dry-run
```

先按第 3 节确认命令指向哪个副本。Setup 可能修改用户级助手配置和 MCP 注册。它记录事务，但**不是全有或全无的操作**：后续步骤失败时，先前成功修改可能保留，并打印 rollback 命令。

当前 setup 还会尝试一次小型 Flash 真实请求，可能消耗配额。对该次调用设置 `ZCODE_KIT_SKIP_SMOKE=1` 可跳过；CI/test 也会跳过。Smoke 失败不自动撤销配置。`doctor --fix` 不安装缺失依赖，也不执行完整 setup。

```sh
zcode-kit status
zcode-kit doctor
zcode-kit auth status
zcode-kit usage --json
```

代理尚未启动时，诊断可能失败。按第 6 节启动，或用会自动启动代理的助手。**健康检查或退出码不能单独证明模型可用：**要看 `logged_in`、配额诊断和真实回复。

### 在工作项目中启动助手，不是在 kit 目录中

在**希望助手编辑的项目**打开终端，或用 PowerShell 的 `Set-Location` / POSIX 的 `cd` 进入项目。Kit 启动器保留这一工作目录。

**直接调用 OMP，不要用 `zcode-kit run omp`：**

```sh
omp -p --model zcode/glm-5.3-flash "Reply with 52"
omp -p --model zcode/glm-5.3 "Reply with 52"
```

预期回复 `52`，退出码 0。耗时会变化；超时仍是失败的尝试。交互使用：

```sh
omp --model zcode/glm-5.3 --thinking max
```

**其他 kit 启动器：**`--` 后的参数转交助手。

```sh
zcode-kit run claude-code -- -p "Reply with 52" --model glm-5.3-flash
zcode-kit run codex -- exec "Reply with 52" -m glm-5.3-flash
zcode-kit run aider -- --model openai/glm-5.3-flash
zcode-kit run opencode -- .
```

即使在 Windows，模型标识也使用 `/`。`run` **仅支持** `claude-code`、`codex`、`aider`、`opencode`。这些启动器和 OMP 扩展会检查/启动代理；其他客户端需手动启动。

## 5. 每种集成的作用

| ID | 配置 / 使用 |
|---|---|
| `omp` | 添加提供方、模型、自动启动扩展及可选 MCP；直接运行 `omp`。 |
| `pi` | 在 `~/.pi/agent/models.json` 添加 `zcode`；启动代理后 `pi --model zcode/glm-5.3`。 |
| `claude-code` | 生成设置与可选启动器，不替换常规模型设置；setup 可注册用户级 MCP。非 Claude 模型路由属于社区兼容。 |
| `codex` | `generated/codex-home` 内隔离的 `CODEX_HOME`；个人 Codex 配置和 skills 不自动适用。 |
| `opencode` | 添加提供方；`zcode-kit run opencode -- .` 设置进程级密钥。 |
| `aider` | 生成环境与启动器；传递其他参数时显式加 `--model openai/glm-5.3-flash`。 |
| `continue` | 更新**已有** `~/.continue/config.yaml`，缺失就跳过；先打开/配置 Continue，重新集成，再在 UI 选模型。 |
| `goose` | 持久自定义提供方文件及密钥助手；启动代理后 `goose session --provider zcode`。 |
| `cline` | 生成 `generated/cline-zcode-values.md`，需在扩展 UI 手动填入。 |
| `kilo-code` | 生成 `generated/kilo-zcode-values.md`，需在扩展 UI 手动填入。 |

十个适配器不等于十个客户端已实测。参阅带日期的[支持矩阵](SUPPORT_MATRIX.json)和[CI 运行](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)。Cline/Kilo 检查仅证明参数表存在，**不证明 GUI 已完成配置**；注册 MCP 也不等于模型访问。

**当前 Continue：**支持 `models: []`、注释及块列表缩进，用户模型和默认顺序保持在前。拒绝非空行内列表、重复键和不安全结构，不进行猜测。管理区域用带引号的 YAML 值保存本地代理密钥；`${ZCODE_PROXY_KEY}` 并非有效 Continue 插值。轮换密钥后重新集成或进行受支持修复。不声称完成原生 Continue 真实测试。

## 6. 显式启动、检查或停止代理

使用第 3 节的根路径变量，可以留在工作项目中运行。

**PowerShell：**

```powershell
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') start
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') status
node (Join-Path $KitRoot 'proxy/zcode-proxy-manager.mjs') logs 50
```

**macOS/Linux：**

```sh
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" start
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" status
node "$KIT_ROOT/proxy/zcode-proxy-manager.mjs" logs 50
```

将 `status` 换成 `doctor`、`stop`、`restart` 即可执行对应操作。**停止/重启会中断正在使用代理的客户端。**不要仅因进程占用 8457 就杀掉它。管理器拒绝外部/不可验证进程，停止自身进程前核实身份和启动时间，不自动抢占旧锁。

## 7. 故障处理和有限自愈

| 症状 | 检查 / 操作 |
|---|---|
| 找不到 `zcode-kit`、`node`、`bun` | 新开终端检查 PATH；kit 可用绝对路径。npm/源码 setup 不安装 Bun 本体。 |
| `Cannot find module .../cli/zcode-kit.mjs` | 相对路径执行目录或根路径错误；修正绝对路径，不要把脚本复制到项目。 |
| Continue `models: []` 使 setup 失败 | 旧版缺少兼容修复；用含修复的发布版或明确选择源码安装，不要重复添加 `models` 键。 |
| 未知命令 / 不支持的 `run` 目标 | OMP/pi/Goose 直接运行；只有前述四个启动器支持 `run`。 |
| `foreign`、端口占用、HTTP 401 | 先查多副本与命令解析，不删密钥、不抢锁、不杀监听进程；诊断正确副本。 |
| Auth `3012` / `logged_in: false` | 检查 Desktop 登录；现有源码可尝试有限恢复。主动登录命令为 `zcode-kit auth login`。 |
| 余额/配额 `1113` / `3001` | 查账号/套餐；重启或本地修复不会补充配额。 |
| Setup 后半段失败 | 前面修改可能保留；看事务记录和打印的 rollback 命令。 |
| `doctor --fix` 修完仍退出 1 | 可能代理未运行或人工步骤未完成，查看各项诊断。 |
| 代理停着也能 `models --json` | 可能是注册表回退；看 `source`，模型列表不是推理证据。 |

当前源码的管理区域修复：

```sh
zcode-kit doctor --harness continue --json
zcode-kit doctor --fix --harness continue
```

在锁保护下重用所选适配器。离线对齐密钥要求明确匹配 kit 模板且端口可保留；拒绝自定义/损坏配置或占用端口。密钥已匹配就不重写代理配置。修复失败回滚已记录文件，普通 setup 保留部分修改。凭据、依赖安装和外部注册不全部受文件 rollback 保护。

启动预检对上游认证/配额问题只警告，以允许模型调用尝试恢复；本地身份/启动失败阻止包装器。OMP 缓存本地健康 60 秒，失败后冷却一分钟，不逐回合查询上游配额。`logs/heal.log` 大小受限，仅使用固定诊断类别。

每次请求重新加载凭据；破损/部分写入保留最后有效值，文件缺失则清空。某些输出前错误可导入**已有 Desktop 登录**，有效凭据改变时才重发一次。不改 Desktop 文件、不创建 API key、不购买配额、不领取 trial，不重放进行中的 SSE 错误。恢复与持久化重试有限，不能保证成功。并发写入和进程上限参见 [SECURITY.md](SECURITY.md)。

## 8. 更新、回滚和卸载

**沿用原安装方式：**

- 发布安装器：同一专用目录重新运行，安装的是已发布文件而非未发布 Git 代码。先解除过时版本固定。
- npm：`npm install -g zcode-agent-kit@latest`，然后从同一 npm 副本运行 `zcode-kit setup`。
- Checkout：**在其根目录**运行 `node cli/zcode-kit.mjs update`；要求工作树干净，仅快进并重跑 setup。不是发布标签选择器，没有 `.git` 的安装会拒绝。

回滚已记录配置：

```sh
zcode-kit rollback
```

不传 ID 选择最新事务；传打印过的 ID 可指定。后续用户修改会作为冲突报告，不盲目覆盖。不要假定凭据、依赖、外部操作会完整恢复。

卸载前先用第 6 节的**管理器绝对路径**停止正确代理，再运行：

```sh
zcode-kit uninstall
```

Uninstall 本身不停止代理，也不删除安装目录、依赖、日志、`.proxykey`、共享凭据或 Desktop 数据。它移除已记录集成、生成文件和匹配的安装器命令入口。npm **随后**再执行 `npm uninstall -g zcode-agent-kit`。手动删除残留目录前先检查内容。

`zcode-kit auth logout` 解释实际凭据路径；`zcode-kit auth logout --yes` 删除该路径，并遵守 `ZCODE_PROXY_CREDENTIALS_PATH`。不会退出 Desktop 或撤销上游 token。不要把 logout 当成常规修复。

## 9. 源码安装和开发（高级）

仅在明确需要当前源码而非发布版时使用。预装 Node、Bun、Git；克隆到**新的专用目录**，而非让助手编辑的项目。不要把发布安装器运行在 checkout 上。

**PowerShell：**

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
if ($LASTEXITCODE -ne 0) { throw 'Clone failed; stop here' }
Set-Location zcode-agent-kit -ErrorAction Stop
$env:ZCODE_KIT_ALLOW_CHECKOUT = '1'
try { node cli/zcode-kit.mjs setup --harness omp }
finally { Remove-Item Env:ZCODE_KIT_ALLOW_CHECKOUT -ErrorAction SilentlyContinue }
```

**macOS/Linux：**

```sh
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit &&
cd zcode-agent-kit &&
ZCODE_KIT_ALLOW_CHECKOUT=1 node cli/zcode-kit.mjs setup --harness omp
```

只有克隆、目录切换都成功才继续；发生错误后不要执行后续行。示例刻意限定 `omp`，可改成所需助手或 `auto`。显式同意避免配置意外指向第二个副本。Checkout setup 不创建全局命令入口，之后应使用绝对 CLI 路径。集成引用该目录，不要移动；启动助手前回到**工作项目**。

先安装 proxy/MCP 依赖，再从 **checkout 根目录**运行开发测试。测试会生成 fixture/build 文件；严格隔离时使用临时开发副本。

```sh
npm run test
npm run test:proxy
npm run test:mcp
```

最新测试结果见 [CI 运行](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)。本地测试输出不纳入版本控制。自动化测试不能确认真实账户登录或模型可用性。

维护者注意：向 `main` 推送、推送 `v*` 标签或 dispatch 都可能触发发布。版本选择核对 npm/远程标签以避免复用其他提交的资产；未发布同版重试有条件。测试、包/版本关卡、OIDC 与再分发要求仍适用。参阅[发布清单](docs/RELEASE_CHECKLIST.md)；本地绿色不代表 npm 发布成功。

## 安全与更多文档

仅使用自己的授权账号。保护 `.proxykey`、生成设置/env 和用户配置，禁止将内容粘贴到 issue。代理仅监听 loopback 并使用 bearer 认证。Gateway challenge 处理属于内嵌协议实现，不保证得到提供方认可或始终兼容后续服务变化。自动 trial 和 off-peak 默认关闭。修改配置或暴露端点前先读 [SECURITY.md](SECURITY.md)。

- [助手详情](harnesses/README.md)与[支持矩阵](SUPPORT_MATRIX.json)
- [推理强度映射](EFFORT_MAPPING.md)
- [CI 运行](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)与[支持矩阵](SUPPORT_MATRIX.json)
- [内嵌组件及许可证](MANIFEST.md)
- [发布清单](docs/RELEASE_CHECKLIST.md)
