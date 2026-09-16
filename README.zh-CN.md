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

> **工作树说明（2026-09-15）：**下文修复、认证恢复及 postinstall 改动描述的是本地
> 源码，而非已验证的发布版本。最终验证待完成；不代表已修复现有个人安装。

## 快速开始

**Windows（PowerShell）**——安装器自动获取最新 Release，SHA256 校验，无需管理员权限：

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.ps1 | iex
```

**macOS / Linux**：

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/latest/download/install.sh | sh
```

单行命令会从**最新发布的 Release** 获取安装器；安装器会自动解析该 Release
（可用 `ZCODE_KIT_VERSION` 固定版本，例如 `$env:ZCODE_KIT_VERSION = "v0.2.0"`）。
安装器下载该发布包并校验校验和，安装到用户目录
（默认 `%LOCALAPPDATA%\zcode-agent-kit` 或 `~/.local/share/zcode-agent-kit`，
可用 `ZCODE_KIT_HOME` 覆盖），如缺少 bun 则自动在用户目录安装 v1.4.2，
然后运行带 harness 检测的 setup。

**npm / npx：**

```sh
npm install -g zcode-agent-kit
zcode-kit setup

# 或者无需全局安装：
npx --yes zcode-agent-kit setup
```

npm 包提供 `zcode-kit` 和 `zcode-agent-kit` 两个命令。postinstall 仅显示安装提示，
**不会**安装运行时或修改 harness 配置。请显式运行 `zcode-kit setup`。
setup 按幂等方式设计。npm 需要 **Node ≥ 20**；setup 安装或验证固定版本的 bun 依赖。

> npm 包由维护者按版本发布。如果 `npm install` 返回 404，说明该版本尚未发布到
> npm 仓库——请使用上方的安装器，或从本地构建安装：
> `npm install -g <repo>/pack/dist`。

## 首次使用，按顺序进行

1. **安装**（上方命令）。setup 会检测你安装的 harness，并只改动检测到的
   部分。已记录的配置修改可回滚，但凭据和依赖安装不在回滚范围内（见下文）。
2. **登录一次**：确保 ZCode Desktop 已安装并已登录；setup 会自动导入该
   凭据（否则会打印出准确的一次性登录命令）。
3. **检查**：`node cli\zcode-kit.mjs status`（代理是否在运行？配额？）和
   `node cli\zcode-kit.mjs doctor`（完整诊断）。
4. **使用**——见下方*各 harness 用法*。代理按需自动启动：OMP 通过其扩展
   自动启动，kit 启动器（`bin\zcode-claude`、`bin\zcode-codex`、
   `bin\zcode-aider` 或 `zcode-kit run ...`）会在启动前确保代理运行。其他
   方式（pi、Continue、Goose、直接 API 客户端）请自行启动一次：
   `node proxy\zcode-proxy-manager.mjs start`
5. **之后**：按安装方式参阅“更新”。`zcode-kit rollback` 撤销最新事务中已记录的
   文件修改；`zcode-kit uninstall` 移除集成，但保留共享凭据。

**从仓库检出安装**（开发或手动安装）：

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
cd zcode-agent-kit
$env:ZCODE_KIT_ALLOW_CHECKOUT = "1"     # 显式选择：仓库检出绝不应默默成为 provider 根目录
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
zcode-kit doctor [--fix] [--harness <id>] [--json]  诊断；显式受管理修复
zcode-kit status                              代理状态 + 配额快照
zcode-kit models [--json] [--show-key]        可用模型列表（来自运行中的代理）
zcode-kit usage --json                        账号用量/配额（绝不编造数值）
zcode-kit auth status|login|logout            代理凭据生命周期（logout 不会触碰你的桌面登录）
zcode-kit update                              快进更新仓库并重新应用集成
zcode-kit rollback [tx-id]                    回滚最近一次（或指定的）事务，三路安全
zcode-kit uninstall                           移除 kit 的集成；绝不删除共享凭据
```

已记录的配置修改采用基于哈希的备份。对于已完成的事务，回滚会将后续用户修改
报告为冲突而非覆盖。`setup` / `integrate` 可能在部分步骤成功后失败：它们会记录
这些部分修改并打印回滚命令，**不会**自动撤销整个安装。本地密钥创建、凭据、依赖
安装及外部 CLI 操作并非全部可回滚；外部注册可能需要执行提示中的撤销命令。

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

**Continue YAML：**已有 `models: []`（允许水平空白及以空白分隔的注释）会先转换为
块列表，再添加 kit 模型。有缩进或无缩进的列表均保留用户模型在前及原有默认顺序，
重复集成保持幂等。非空行内列表、重复 `models` 键及不支持格式会被拒绝，且不修改
文件。适配器在 `~/.continue/config.yaml` 的受管理区域写入 JSON 引号转义的
**本地代理密钥**，不是 Desktop 凭据，且不打印密钥。轮换后请重新集成。
旧 `${ZCODE_PROXY_KEY}` 并非 Continue 支持的秘密值插值，不会新增环境文件。
验证环境未安装 Continue，**真实客户端验证被阻塞**；解析器/配置测试不等于真实会话。

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

## 诊断与有限修复（当前源码，最终验证待完成）

`zcode-kit doctor` 进行诊断，`zcode-kit doctor --fix` 显式修复受管理配置。
`--harness <id>` 限制适配器选择，`--json` 输出结构化结果。修复不执行完整 setup，
也不安装依赖，而是在 setup 锁保护下重新应用所选适配器。仅当代理配置明确匹配 kit
模板且端口可被独占保留时，才校准密钥不一致。校准会拒绝自定义/损坏配置或已占用
端口；密钥已一致则不重写代理配置。
检出版仍需 `ZCODE_KIT_ALLOW_CHECKOUT=1`。修复失败会回滚已记录的文件修改，
与 setup 保留部分结果不同；凭据和外部操作不在该保证范围内。

共享启动预检先安全启动/验证代理，再进行一次有超时的配额检查，无定时轮询或重试循环。
认证码 `3012` 与余额/配额码 `1113` / `3001` 分开诊断；重启不会补充配额。
上游认证/余额异常或配额信息不可用会警告，但允许继续使用健康的本地代理，以便模型
请求尝试有限的凭据恢复。这不证明配额可用，也不会编造零余额；本地身份或启动失败
仍会阻止包装器启动。外部/无法验证
的监听进程不会被触碰，旧所有权锁也不会被自动抢占。`logs/heal.log` 有大小限制，
只记录固定分类的原因/动作/结果，不记录提供方响应正文。

OMP 在预检后将本地认证健康检查缓存 60 秒；后续请求可恢复已崩溃代理，启动失败后
冷却一分钟。正常健康的模型回合不会反复查询上游配额。

常规 setup 还会尝试一次最小 Flash 真实请求，可能消耗配额；可用
`ZCODE_KIT_SKIP_SMOKE=1` 跳过，CI/test 模式也会跳过。烟雾测试失败会报告错误，
但不会撤销已保存集成。存在这段代码不代表已对本次改动执行真实调用验证。

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

## 安全与自动化策略

开门见山，方便你判断这个工具是否适合你：

- **CAPTCHA 处理。** z.ai 网关会在其正常客户端协议中下发挑战页——官方
  ZCode Desktop 客户端会自动、无感地应答它们。内嵌的代理为**你自己已登录的
  账号**复现了完全相同的行为：它以与官方客户端相同的方式应答网关挑战。没有
  绕过任何人工验证关卡（这些挑战从来不需要人工解决），不触碰任何其他账号，
  也不使用任何打码平台或第三方求解器。
- **无试用自动化。** kit 附带的配置中不存在自动领取试用与错峰调度；自审计
  整改后，底层默认值为 fail-closed（`false`）：缺失或残缺的 claim 配置块
  不会启用领取功能。启用需要在您自己的配置中显式设置
  `claim.enabled: true`。
- **MCP 作用域。** `zcode-harness` 桥接特意注册在 **用户作用域**：它是
  机器级集成，而非按项目集成。撤销只需一条命令（`claude mcp remove
  zcode-harness --scope user`），且桥接本身绝不响应未认证或非环回请求。
- **由代码强制，而不仅是模板**（审计整改）：代理拒绝绑定环回以外的任何
  地址，没有真实 bearer 密钥时拒绝服务；适配器拒绝覆盖不属于它的 provider
  条目；setup 拒绝从源码检出版写入用户配置。

## 登录续期

运行时在请求时重新加载已保存代理凭据。无效或部分写入的数据不会替换最近的有效值；
存储文件不存在（logout）会在重载时清除内存值，但不会中断正在进行的请求或撤销上游
令牌。显式注入的凭据默认仍保持隔离。每个进程最多记录 128 个失败凭据/来源版本组合，
达到上限后停止自动重新导入，直到重启。保存前会比较存储内容，但没有跨进程锁，
仍存在与其他写入方竞争的狭窄时间窗口，并非通用的原子比较交换保证。

在输出响应之前，部分非流式认证/余额错误允许重新导入一次现有 Desktop 登录，且
**仅当有效凭据发生变化时**重发一次请求。并发请求共享恢复过程；尝试按失败凭据及
Desktop 来源版本限制，因此之后重新登录可被发现。仅当已观测存储未变化时，更新的
有效凭据才会加密保存到代理存储，不修改 Desktop 文件。不自动打开浏览器登录、创建
密钥、领取试用或无限重试，不重放 SSE/流内错误。恢复失败仍返回错误；账号权限和
配额无法在本地修复。

需要主动手动续期时：

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

在源码检出版中，`zcode-kit update` 会拒绝有改动的工作树，仅做快进合并，
并按上文的部分 setup 行为重新应用集成。Release/tarball 安装没有 `.git`，
会拒绝此命令：请重新运行安装器。代理已固定版本（见 `MANIFEST.md`）；
本地补丁位于 `patches/`。

### 自动发布（维护者）

`.github/workflows/release.yml` 在推送到 `main`、推送 `v*` 标签或 dispatch 时运行。
测试后，非标签运行仅在当前版本未发布到 npm，且远程标签不存在或指向完全相同 HEAD
时复用版本；否则选择在 npm 和远程标签中均未占用的下一个 patch（最多 100 个候选），
再推送版本 commit/tag。dispatch **仅在上述未发布、无标签/同 HEAD 条件下**是同版本
重试，并非无条件幂等。npm 版本不存在不允许复用其他提交的旧 GitHub 资产。标签运行
会跳过已有 npm 版本，不覆盖资产。注册表错误会阻止继续。npm 固定为 11.19.1，发布后
检查精确版本可见性，但不等于验证下载包内容。版本/标记检查和 OIDC 发布仍须成功；
本地改动不代表版本已发布。

## 测试与证据

```sh
npm run test          # kit fixture：事务、管理器安全、适配器
npm run test:proxy    # 代理协议和认证 fixture
npm run test:mcp      # MCP 桥套件
```

修复前 baseline：**kit 65 / proxy 872 / MCP 42**。MCP 的 `wmic` 终止路径
**未执行**，套件数量不能证明该路径已验证。**最终验证待完成**；带日期的结果见
`TEST_REPORT.md`。源码检查、fixture/配置测试、真实模型调用及已发布版本是不同层次的
证据。本地改动不代表新增真实调用验证，也不代表已修复用户个人安装；历史实测结果
不验证当前工作树。

## 文档

- `SUPPORT_MATRIX.json` —— 每个适配器的真实状态（已实现 / 配置已测 /
  已实测 / 需手动确认）
- `EFFORT_MAPPING.md` / `.json` —— low/high/max 如何映射到上游参数
- `SETUP_REPORT.md`、`TEST_REPORT.md` —— 带确切命令的测试证据
- `IMPLEMENTATION_STATUS.md` —— 决策与未决事项
- `harnesses/README.md` —— 各 harness 的细节与手动集成片段
- `MANIFEST.md` —— 内嵌组件、提交、许可证
- `docs/RELEASE_CHECKLIST.md` —— 发布前已备好与待办事项
