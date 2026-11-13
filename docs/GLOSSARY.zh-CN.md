# 术语表
[English (original)](GLOSSARY.md) · [Deutsch](GLOSSARY.de.md) · [Español](GLOSSARY.es.md) · [日本語](GLOSSARY.ja.md) · **简体中文**

> 本文为英文原文的翻译；如有出入，以英文原版为准。

Kit 会运行一个本地 ZCode 代理，并把你自己的智能体 harness 连接到它。本术语表解释 `zcode-kit` 的输出和 Kit 文档中使用的词语。

## 安装与进程

**安装（Installation）**：
Kit 的一份副本（正式版安装、npm 安装或源码检出），带有自己的配置、代理密钥和状态。本术语表中的其他一切都按安装分别存在。

**上游（Upstream）**：
代理把模型请求转发到的供应商 ZCode 服务。

**代理（Proxy）**：
安装在回环地址上运行的本地 HTTP 服务。它以 Anthropic 和 OpenAI 格式与 harness 通信，并把请求转发到上游。每个安装有一个代理。

**代理密钥（Proxy key）**：
客户端必须发送给代理的本地密钥。设置程序生成它，并保存在 `.proxykey` 中。

**管理器（Manager）**：
Kit 中负责启动、停止和重启代理的组件。`zcode-kit proxy start`、`stop` 和 `restart` 会用到它。

**身份证明（Identity proof）**：
一次带认证的健康应答，证明配置端口上的进程是本安装自己的代理。结果有 *ours*（自己的）、*foreign*（端口上应答的是别的程序）、*down*（没有任何应答）和 *no key*（缺少代理密钥，因此无法证明任何事）。`zcode-kit proxy status --json` 在 `health` 字段中把它们报告为 `ours`、`foreign`、`down` 和 `nokey`。

**pid 记录（Pid record）**：
文件 `logs/proxy.pid`，管理器在其中记录代理的 pid 和启动时间。只有与这条记录相符的进程，管理器才会停止。消息中也称它为 pid 文件。

**Harness**：
把代理用作模型提供商的智能体 CLI 或编辑器扩展，例如 Claude Code、Codex、OMP 或 OpenCode。其他文档中也称它为助手。

**集成（Integration）**：
Kit 在你同意后为某个 harness 写入的配置，让该 harness 使用代理。

**启动器（Launcher）**：
`zcode-kit run <harness>` 进程。它运行预检并启动 harness。能够交接时，它随后用 harness 替换自身；否则它会一直保留到 harness 退出，并返回 harness 的退出码。

**预检（Preflight）**：
harness 使用代理之前的一次简短检查。它确认代理正在运行并且属于本安装，必要时启动代理，并检查额度。

**MCP 桥接（MCP bridge）**：
从已安装的 ZCode Desktop 运行时向 harness 提供工具的 MCP 服务器。注册它与连接模型是两回事。

**事务（Transaction）**：
`setup`、`integrate`、`update` 或 `accounts enable` 等命令单次运行所做文件更改的记录，附带备份。`zcode-kit rollback [tx-id]` 撤销最新的一次或指定的一次。

**内存占用（Memory footprint）**：
操作系统计入代理进程的内存。代理的内存上限以它为准；运行时无法报告它时，改用常驻集大小（RSS）。

**交接（Handover）**：
启动器用助手替换自身，使助手沿用启动器的进程 ID，旁边不再留有 Kit 进程。适用于 Linux 和 macOS，需要 Node.js 26.1 或更高版本；`ZCODE_KIT_RESIDENT_LAUNCHER=1` 可以关闭它。

**共享预检（Shared preflight）**：
同一安装中同时启动的多个 OMP 窗口共用的一次预检。创建 `logs/omp-autostart.token` 的窗口负责运行它，其他窗口等待它的结果。

## 代理生命周期与启动锁

**启动锁（Start lock）**：
文件 `logs/manager.lock`，记录本安装正在启动代理。同一时间最多只有一个持有者。

**持有者（Holder）**：
启动锁中记录的、正在执行启动的进程。

**失效锁（Stale lock）**：
已证明其持有者不存在的启动锁：持有者的进程已经结束，或者它的 pid 现在属于一个更晚启动的进程。仅仅存在时间较长，或者持有者无法检查的锁，不算失效锁。

**接管（Takeover）**：
用自己的锁替换失效锁，使启动可以继续。它绝不适用于仍存活的持有者的锁。

**启动宽限期（Startup grace）**：
代理启动后的前 60 秒。在这段时间内，尚未应答的代理绝不会被结束。

**孤立代理（Orphaned proxy）**：
启动它的那次启动被中断后仍在运行的健康代理。下一次启动会通过身份证明接手它，而不是再启动一个。

**挂起的代理（Hung proxy）**：
本安装自己的代理，正在运行但不应答健康检查。只有证明它既属于自己又已挂起时，Kit 才会结束它。

**健康监督器（Health supervisor）**：
代理中监视自身主线程和内存占用的部分，由它决定是发出警告、请求重启还是继续提供服务。

**自动重启（Automatic restart）**：
代理在主线程停止响应或内存持续高于硬上限之后，主动请求管理器重新启动它。日志行中称它为 respawn。它受重启预算限制。

**重启预算（Restart budget）**：
管理器在一个滚动时间窗内接受的自动重启次数：15 分钟内 3 次。

**重启确认（Respawn acknowledgement）**：
管理器记录下来的确认，表示它已接受代理的自动重启请求。因内存而发出请求的代理，只有收到确认后才开始排空；没有确认时，它会继续提供服务。

**排空（Drain）**：
平稳停止中的一个阶段：代理保持监听，拒绝新请求，并让正在处理的请求在期限之前完成。

**停止请求（Stop request）**：
管理器请求自己的代理平稳停止时发送的带认证回环请求（`POST /__kit/stop`）。它需要代理密钥和停止令牌。

**停止令牌（Stop token）**：
每次启动时生成的秘密值，与代理密钥一起授权停止请求。它保存在 pid 记录中，不属于任何 harness 配置。

**重启（Restart）**：
先停止再启动代理，通过 `zcode-kit proxy restart` 发起。

## CAPTCHA 求解器

**求解（Solve）**：
在无头页面中运行一次供应商的 CAPTCHA 验证挑战，结果是一个令牌或一次失败。

**求解器（Solver）**：
代理中执行求解的部分，按到达顺序一次处理一个。

**求解器进程（Solver process）**：
代理为求解器启动的进程。每个代理最多一个。它有内存上限（`solver.memoryCapMB`，默认 300 MB），操作系统能强制执行的地方会由操作系统强制执行。

**回收（Recycle）**：
在下一次求解之前，用新进程替换求解器进程：达到内存上限的 80 % 时，或者完成 100 次求解之后。

**快速失败（Fail-fast）**：
因为 10 分钟内有超过 5 个求解器进程异常结束，代理暂不启动求解器进程的这段时间。需要求解的请求会收到 HTTP 503 和 `Retry-After`。

## 准入

**准入（Admission）**：
代理对每个请求做出的决定：现在处理请求体、让它等待，还是拒绝它。

**在途字节（In-flight bytes）**：
代理当前持有的请求体总大小，从读取请求体开始，直到上游作出应答为止。

**字节上限（Byte cap）**：
在途字节的上限，默认 64 MiB（`server.admission.maxInFlightMB`）。这是唯一的准入限制；打开的响应流不受限制。

**准入队列（Admission queue）**：
等待准入、请求体尚未读取的请求组成的有界先进先出队列。最多 64 个请求等待，每个最多等 15 秒。

**拒绝（Shed）**：
对无法准入的请求，或在排空期间到达的请求，以 HTTP 503 和 `Retry-After` 拒绝，错误格式与它所调用的端点一致。拒绝绝不是额度错误。

## 账号

**账号轮换（Account Rotator）**：
可选功能，把多个经过授权的登录作为相互独立的账号保存。参见 [ACCOUNT_ROTATOR.zh-CN.md](ACCOUNT_ROTATOR.zh-CN.md)。

**当前账号（Active account）**：
代理当前使用的账号，在账号表格中以 `*` 标记。

**判定（Verdict）**：
`zcode-kit accounts health` 给每个账号的状态，例如 `ok`、`low` 或 `exhausted`。

**额度包（Quota package）**：
供应商为一个账号报告的一项余额，包含剩余量、总量和重置时间。

**冷却（Cooldown）**：
账号遇到额度错误后暂不使用的这段时间。

## MCP 任务

**任务保留（Task retention）**：
已完成的 MCP 任务及其结果在删除之前保留多久：最多 500 个已完成的任务，最长 7 天。任务的幂等键的记住时长与任务的保留时长完全相同。

**重启预算（Restart budget）**：
ZCode 运行时退出后，MCP 桥接重新启动它的次数上限：15 分钟内最多 3 次。预算用完后，需要运行时的工具会以 `HARNESS_RESTART_BUDGET_EXHAUSTED` 失败，直到再次有空余名额。

## 日志

**代理日志（Proxy log）**：
`logs/proxy.log`，由代理和管理器写入，达到 5 MB 时轮转，并保留一个旧文件 `proxy.log.1`。`zcode-kit proxy logs` 读取它。

**修复日志（Heal log）**：
`logs/heal.log`，简要记录预检和管理器发现了什么、做了什么。它使用固定的用词，不含供应商文本、路径或凭据。

## 终端输出

**报告（Report）**：
命令的回答：检查行和结论行、状态文本、设置摘要、连接详情。报告和数据输出到 stdout。

**诊断信息（Diagnostic）**：
命令回答之外的一切：进度、警告、错误块、提示和用法错误。诊断信息输出到 stderr。

**检查（Check）**：
`zcode-kit doctor` 中一项有名称的测试，包括 `doctor --upstream` 的上游比对。

**检查结果（Check verdict）**：
一项检查的结果词：*PASS*、*FAIL*、*WARN* 或 *SKIP*。只有 *FAIL* 会让命令失败；*WARN* 表示能工作但需要注意；*SKIP* 表示不适用或未检测到。`zcode-kit accounts doctor` 改用自己的词：*OK*、*WARNING* 和 *ERROR*。

**操作结果（Action result）**：
会做出更改的步骤（setup、integrate、update、rollback、uninstall）的结果词：*OK*、*FAIL*、*WARN*、*SKIP* 或 *INFO*。

**结论行（Verdict line）**：
汇总检查报告的一行，列出每种检查结果的数量，并指明非零的退出码。

**连接详情（Connection details）**：
告诉手动配置的客户端如何连接代理的信息块：基础 URL、密钥、模型 ID 和代理状态。

**行模式（Line mode）**：
除全屏代理 TUI 之外的所有输出：普通的行，没有边框。

**代理 TUI（Proxy TUI）**：
运行中代理的全屏终端视图，包含状态标题、日志窗格和按键提示。

**字形级别（Glyph tier）**：
输出在某个终端上可以使用的字符集：*full*、*wgl4* 或 *ascii*。各级别之间文字从不改变，只有符号不同。

## 支持

**最低支持版本（Support floor）**：
Kit 支持的最低运行时版本：Node.js 24。低于这个版本时，安装器、`setup` 和 `update` 会在做出任何更改之前拒绝运行。
