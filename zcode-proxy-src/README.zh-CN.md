# ZCode Proxy
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · **简体中文**

> 本文与英文版描述的是 ZCode Agent Kit 中的代理组件；如有差异，以英文版为准。

本目录引入来自 [TriDefender/zcode-api](https://github.com/TriDefender/zcode-api) 的
**zcode-proxy**，固定在 v4.6.4、提交
`9a5cebe07c5255faa675075fa37632d4dea733fa`（2026-09-11）。
许可证为 MIT（上游未包含 LICENSE 文件）。版本、提交和本地改动记录在
[`../MANIFEST.md`](../MANIFEST.md)，本地补丁位于
[`../patches/`](../patches/)。

本文以及[英文版](README.md)描述的是该组件**在 ZCode Agent Kit 中的用法**。
上游项目还包含 Android、Docker、离峰通道和试用额度领取等独立功能；
Kit 不使用这些功能。

## 在 Kit 中的作用

代理是 Kit 的模型网关。它在 **`http://127.0.0.1:8457`** 接收 OpenAI
Chat Completions、Anthropic Messages 和 OpenAI Responses 请求，
并使用已登录的 ZCode Desktop 账号将请求转发到 Z.AI 网关
（start-plan，与 ZCode Desktop 共用额度）。

可选的 `auth.accounts.enabled` 账号池可保存多个已授权账号。
每个新请求在发送前读取账号池的最新状态。只有明确的额度信号
`1005`、`1113` 或 `3001` 才允许顺序尝试一次其他合适账号。
启用该功能后，通过 `zcode-kit auth login zai` 登录的新账号会另存为
额外记录；再次登录同一账号会更新其原有记录。使用
`zcode-kit accounts` 或 `zcode-proxy auth accounts` 管理账号；
后者提供 `pause|resume`、`explain`、`doctor`、`quota` 和 `--live`。
密钥设置、迁移和恢复规则见[账号轮换文档](../docs/ACCOUNT_ROTATOR.md)。

- 地址/格式：`POST /v1/chat/completions`、`POST /v1/messages`、
  `POST /v1/responses`、`GET /v1/models`、`GET /health`、
  `GET /quota`；`GET /accounts/status` 与 `GET /accounts/quota`
  需要身份验证
- 身份验证：`Authorization: Bearer <.proxykey 的内容>` —— 本地密钥由
  `zcode-kit setup` 生成；正式版和源码安装存在 Kit 目录中，npm 安装存在
  单独的状态目录中
- 生命周期：由 `node proxy\zcode-proxy-manager.mjs start|stop|restart|status|doctor|logs`
  管理（仅监听本机环回地址、安全停止、日志轮转；见仓库根目录 README）
- 更新登录：`zcode-kit auth login zai`；见[主 README](../README.zh-CN.md)

## 与上游版本的本地差异

- **端口 8457**，不是上游独立版默认的 8080（由 Kit 配置模板指定）；
  仅监听环回地址，必须使用 Bearer 密钥
- **试用额度领取和离峰通道已禁用**：Kit 的配置不使用上游
  `claim`（自动领取有限试用额度）或 `/async/*`（离峰通道）功能；
  审计修复后的底层默认值为关闭（`false`）
- **引入时排除的内容**：不包含 `Android-APP/`（209 MB）和
  `node_modules/`；`zcode-kit setup` 通过 `bun install --frozen-lockfile`
  安装依赖。同时删除了 Android 构建链路
  （`scripts/build-android-apk.sh`、`build:android-*` npm 脚本、
  esbuild 开发依赖及引入的 `.github/workflows/release.yml` 中的
  `build-android` 作业）
- 本地改动与测试记录在本仓库中；[供应商补丁](../patches/zcode-proxy-local-patches.patch)
  仅作历史参考，不包含后续所有改动

## 可用模型

代理在 `/v1/models` 中列出下列模型。此目录仅用于显示，
其他模型名称仍会按常规转发。Kit 中已验证的模型是 **glm-5.3**
（文本，100 万上下文）和 **glm-5.3-flash**
（文本和图片，100 万上下文）；见主 README。

| 模型 | 上下文 | 最大输出 |
|---|---|---|
| `glm-4.5-air` | 131K | 96K |
| `glm-4.6` | 200K | 131K |
| `glm-4.6v`（图像） | 131K | 32K |
| `glm-4.7` | 200K | 131K |
| `glm-5` / `glm-5-turbo` | 200K | 64K |
| `glm-5v-turbo`（图像） | 200K | 131K |
| `glm-5.1` | 200K | 64K |
| `glm-5.2` | 1M | 128K |
| `glm-5.3` / `glm-5.3-flash` | 1M | 128K |

## 配置与环境变量

代理默认读取 `config.yaml`。正式版或源码安装通过
`ZCODE_PROXY_CONFIG` 指向 `../proxy/config.yaml`；npm 安装把配置
存储在单独的状态目录中。环境变量的优先级高于配置文件。常用选项：

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `ZCODE_PROXY_PORT` | `8080` | 监听端口（Kit 模板使用 8457） |
| `ZCODE_PROXY_API_KEY` | 无 | 客户端必须提供的密钥（在 Kit 中为 `.proxykey` 内容） |
| `ZCODE_PROVIDER` | `zai` | 服务商 `zai` / `bigmodel` |
| `ZCODE_PROXY_CONFIG` | `config.yaml` | 配置文件路径 |
| `ZCODE_PROXY_CREDENTIAL_SECRET` | 随机器确定 | 登录凭据的加密种子（迁移或 Docker 使用时需固定） |
| `ZCODE_LOG_FORMAT` | 桌面表格 | `compact` 为窄终端显示单行日志 |

## 从源码运行 / TUI

正式版或源码安装设置创建 `../proxy/config.yaml` 后，
可从本目录直接启动代理，打开交互式终端面板：

```powershell
$env:ZCODE_PROXY_CONFIG = (Resolve-Path ..\proxy\config.yaml).Path
bun run src/index.ts
```

<img src="docs/images/tui-annotated.png" alt="ZCode Proxy 终端面板" width="980" />

面板分为三个区域：**登录与设置**（服务商、套餐、登录）、
**代理服务**（启动/停止、当前配置）和**日志**（实时逐请求显示）。
按 <kbd>s</kbd> 启动代理；`Status: running` 表示已就绪。
也可以用鼠标点击按钮，或运行 `bun run zcode-proxy --cli serve`
在无界面模式下启动。快捷键：
<kbd>s</kbd> 启动/停止 · <kbd>l</kbd> 登录 ·
<kbd>L</kbd> 粘贴链接登录 · <kbd>o</kbd> 退出登录 ·
<kbd>p</kbd>/<kbd>t</kbd> 切换服务商/套餐 ·
<kbd>↑</kbd><kbd>↓</kbd>/<kbd>PgUp</kbd>/<kbd>g</kbd> 滚动日志 ·
<kbd>c</kbd> 清空日志 · <kbd>q</kbd> 退出。

Kit 用户通常不需要直接使用此界面；`proxy/zcode-proxy-manager.mjs`
会在无界面模式下管理代理并轮转日志。

## Kit 不使用的功能

下列上游功能仍存在于源码中，但不属于 Kit 附带的配置：
Android App（引入时排除）、Docker 部署、`/async/*` 离峰通道、
自动领取试用额度（默认关闭）。独立使用请参阅上游仓库。

## 许可证

MIT（依据上游 README；上游未包含 LICENSE 文件，见
[`../MANIFEST.md`](../MANIFEST.md)）。
