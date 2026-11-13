# zcode-harness-mcp
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · **简体中文**

> 本文为英文原文的翻译；如有出入，以英文原版为准。

一个本地 Model Context Protocol（MCP）服务器，向 MCP 客户端（例如编程助手）提供
本机已安装的 ZCode 运行时的工具。桥接把运行时（`zcode.cjs app-server --stdio`）
作为子进程启动，并在其上提供 32 个工具和一组资源：列出模型、打开工作区、创建
会话、启动任务、等待任务、回答权限请求以及读取结果。

工作由 ZCode 运行时完成，使用它自己的工具和本机的 ZCode 登录。桥接负责转发请求
和结果，并保存任务的状态。它不使用套件的代理；注册桥接并不会把模型接入你的
助手。

## 前提条件

- Node.js 24 或更高版本。`node` 必须在 `PATH` 中，因为桥接以程序名 `node` 启动
  运行时。
- 已安装并已登录的 ZCode Desktop。桥接不管理 ZCode 的登录。
- 能启动本地 stdio 服务器的 MCP 客户端，或者能向本地 HTTP 端点发送
  `Authorization` 请求头的 MCP 客户端。

## 查找 ZCode 运行时

桥接在 ZCode Desktop 的 Windows 安装位置查找 `zcode.cjs`：

- `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
- `%LOCALAPPDATA%\ZCode\resources\glm\zcode.cjs`
- `%ProgramFiles%` 和 `%ProgramFiles(x86)%` 下的同样两个路径
- `%LOCALAPPDATA%\zcode\app.resources\glm\zcode.cjs`

在其他系统上，或者安装位置不同时，用 `--runtime-path` 或
`ZCODE_HARNESS_RUNTIME_PATH` 指定该文件。只有当 `node <文件> --version` 以退出码 0
结束并输出版本号时，文件才会被接受。如果你指定的文件不存在或未通过这项检查，
桥接不会再尝试其他运行时。该文件会被执行，因此只应指定你信任的文件。

即使没有任何运行时被接受，桥接仍会启动。此时 `zcode_health` 报告
`degraded: true` 及原因，需要运行时的工具会返回错误。

运行时需要它内置的提供商配置。桥接相对于运行时文件查找 `zcode-builtin.json`
（从不在工作目录中查找），并通过 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 交给
运行时。桥接环境中非空的 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 优先，其次是
`ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE`，最后是桥接找到的文件。只有运行时
进程的环境会被修改，`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 原样传递。如果选中的
文件不可读，运行时不会启动，也不会尝试其他文件。具体路径见
[docs/SECURITY.md](docs/SECURITY.md)。

## 安装

套件的正式版安装器和 npm 设置包含已构建的桥接（`dist/`），并会安装其依赖。
套件的设置可以把桥接注册到助手中；何时注册见
[harnesses/README.zh-CN.md](../../harnesses/README.zh-CN.md)。

如需从源码构建，请在本目录中运行：

```sh
npm install
npm run build
npm run probe:runtime
```

`npm run probe:runtime` 以 JSON 输出运行时查找的结果。

## 注册桥接

### stdio

```json
{
  "mcpServers": {
    "zcode-harness": {
      "command": "node",
      "args": [
        "<kit>/mcp/zcode-harness-mcp/dist/index.js",
        "--stdio",
        "--allow-workspace", "<path to your projects>",
        "--interaction-policy", "ask"
      ]
    }
  }
}
```

请使用绝对路径。每个客户端有自己的配置格式；示例采用常见的 `mcpServers` 形式。
只读的示例见 [examples/config/stdio.mcp.json](examples/config/stdio.mcp.json)。

接收 `workspacePath` 的工具只接受位于允许的根目录之内的目录。没有
`--allow-workspace` 时，唯一允许的根目录是数据目录中的 `workspaces` 目录。

套件生成的条目会在脚本路径之前加上 Node 参数 `--max-semi-space-size=1`。它会
缩小 V8 堆的新生代，可以省略。

### HTTP

```sh
node dist/index.js --http --http-key "<random local secret>" --allow-workspace "<path to your projects>"
```

端点是 `http://127.0.0.1:3322/mcp`。每个请求都必须带有
`Authorization: Bearer <key>`。在 HTTP 模式下，如果没有密钥，或者主机不是
`127.0.0.1`、`localhost`、`::1` 或其他 `127.x.x.x` 地址，桥接会拒绝启动。它只
响应 `POST`，并且不在请求之间保留会话，因此多个客户端可以共用一个桥接。客户端
配置示例见 [examples/config/http.mcp.json](examples/config/http.mcp.json)。

HTTP 代码只有在指定 `--http` 时才会加载。stdio 桥接从不加载它。

## 选项

遇到未知选项时，桥接会在启动时停止，以免拼错的 `--read-only` 被忽略。

| 选项 | 环境变量 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `--stdio` | | 开启 | 通过 stdin 和 stdout 的 MCP。日志输出到 stderr。 |
| `--http` | | 关闭 | 通过 HTTP 而不是 stdio 的 MCP。 |
| `--http-key KEY` | `ZCODE_HARNESS_HTTP_KEY` | 无 | Bearer 密钥。使用 `--http` 时必填。 |
| `--host H` | `ZCODE_HARNESS_HTTP_HOST` | `127.0.0.1` | HTTP 主机。仅限回环地址。 |
| `--port N` | `ZCODE_HARNESS_HTTP_PORT` | `3322` | HTTP 端口。 |
| `--allow-workspace P` | `ZCODE_HARNESS_ALLOW_WORKSPACES` | 无 | 允许的工作区根目录。可重复该选项，或用 `;` 分隔多个路径。 |
| `--read-only` | | 关闭 | 会改变状态的工具返回 `READ_ONLY_MODE`。 |
| `--allow-yolo` | `ZCODE_HARNESS_ALLOW_YOLO=1` | 关闭 | 允许客户端选择模式 `yolo`，该模式会关闭运行时的权限请求。 |
| `--runtime-path FILE` | `ZCODE_HARNESS_RUNTIME_PATH` | 查找 | `zcode.cjs` 的路径。 |
| `--data-dir DIR` | `ZCODE_HARNESS_DATA_DIR` | `~/.zcode-harness-mcp` | 任务、结果、事件和交互的存放位置。 |
| `--interaction-policy deny\|allowlist\|ask` | `ZCODE_HARNESS_INTERACTION_POLICY` | `deny` | 如何应答运行时的权限请求。 |
| `--interaction-allowlist A,B` | `ZCODE_HARNESS_INTERACTION_ALLOWLIST` | 无 | 策略 `allowlist` 批准的精确工具名。使用该策略时必填。 |
| `--interaction-timeout-sec N` | `ZCODE_HARNESS_INTERACTION_TIMEOUT_SEC` | `300` | 未应答的请求在多少秒后被拒绝。 |
| `--max-concurrent-tasks N` | `ZCODE_HARNESS_MAX_CONCURRENT_TASKS` | `2` | 同时运行的任务数。其余任务在队列中等待。 |
| | `ZCODE_HARNESS_TASK_QUEUE_LIMIT` | `50` | 未结束任务的最大数量。 |
| | `ZCODE_HARNESS_REQUEST_TIMEOUT_MS` | `60000` | 向运行时发出一次请求的时间上限。 |
| | `ZCODE_HARNESS_MAX_ARTIFACT_BYTES` | `10485760` | `zcode_artifact_read` 读取的最大文件。 |
| | `ZCODE_HARNESS_LOG_LEVEL` | `info` | `debug`、`info`、`warn` 或 `error`。 |
| `--help`, `-h` | | | 输出用法行。 |

## 任务

`zcode_task_start` 立即返回 `taskId`。任务随后在运行时中运行。`zcode_task_wait`
每次调用最多等待 120 秒直到任务结束，`zcode_task_get` 返回它的状态，
`zcode_task_result` 返回它的文本和详情，`zcode_task_events` 返回它的事件。
`zcode_task_input` 发送更多输入，`zcode_task_cancel` 停止任务。所有工具见
[docs/MCP_API.md](docs/MCP_API.md)。

- **并发。** 默认同时运行两个任务，其余任务排队。未结束的任务最多 50 个。一个
  工作区同一时间只运行一个写入任务，一个会话同一时间只运行一个任务。
- **保留期限。** 桥接最多保留 500 个已结束的任务，并且任何任务在结束后都不会
  保留超过 7 天。被移除的任务会失去记录、结果和事件，对它的调用返回
  `unknown task: <taskId>`。未结束的任务和状态为 `unknown` 的任务永远不会被
  移除。
- **幂等。** 用相同的 `idempotencyKey` 再次调用 `zcode_task_start`，会返回已有的
  任务，而不是启动新任务。只要任务仍被保留，该键就有效；之后同一个键会启动
  新任务。
- **文本大小。** 任务的回复文本上限为 4 MiB 的 UTF-8。更长的文本保留开头的
  1 MiB 和末尾的 3 MiB，两者之间是一行 `[… N bytes truncated …]`。这样的结果
  会标记为 `partial`，并带有 `truncated.droppedBytes`。
- **列表。** 一个任务最多保留 200 条警告、200 条错误和 1,000 次工具调用。
- **事件。** 任务的事件最多保存在两个各 4 MiB 的文件中；更早的事件会被丢弃。
- **重启。** 桥接重启后，未结束的任务会标记为 `interrupted`。已结束任务的已
  保存结果仍然可读。
- **客户端结束。** stdio 客户端关闭连接时，桥接会把未结束的任务标记为
  `interrupted`，停止运行时并退出。它只停止自己启动的运行时进程，不停止
  运行时启动的进程。

## 权限请求

运行时在使用某些工具之前会先询问，也可能向用户提问。`--interaction-policy`
决定如何处理这些请求：

- `deny`（默认）：拒绝所有请求。
- `allowlist`：如果工具名在 `--interaction-allowlist` 中，就批准权限请求，否则
  拒绝。向用户提出的问题会转给客户端。
- `ask`：请求会转给客户端，客户端用 `zcode_interaction_respond` 回答，并且只能
  在运行时提供的选项中选择。未及时回答的请求会被拒绝。

对工具 `Bash`、`PowerShell` 和 `Shell` 的请求在任何策略下都会被拒绝。在只读
模式下，以及对于用 `readOnly` 启动的任务，所有请求都会被拒绝。

## 安全

桥接以你的用户权限运行，不是沙箱。

- 工作区路径、会话 ID 和文件读取会在解析符号链接和 junction 之后，与允许的
  根目录进行比对。
- `--read-only` 会阻止所有会改变状态的工具。带 `readOnly` 的任务在运行时的
  `plan` 模式下运行，其写入工具和 shell 工具被拒绝；但这不能阻止仍被允许的
  工具修改文件。
- 除非桥接以 `--allow-yolo` 启动，否则模式 `yolo` 会被拒绝。
- 工具结果、事件、日志和错误消息中的机密信息会被脱敏。
- 运行时以固定的程序名和参数列表启动，从不经过 shell。
- HTTP 仅限回环地址，并且要求 Bearer 密钥。

详情见 [docs/SECURITY.md](docs/SECURITY.md)。套件的安全策略见
[SECURITY.md](../../SECURITY.md)。

## ZCode 0.16.9

- `zcode_workspace_open` 返回工作区的模式和斜杠命令。运行时不提供工作区的默认
  模型、模型目录和设置修订号。
- `zcode_models_list` 通过创建一个不带提示词的会话并再次关闭它来读取模型目录。
  这可能会启动运行时的服务，因此在只读模式下被阻止。
- 模型、推理级别和模式按会话选择，使用 `zcode_model_set` 或
  `zcode_task_start` 的参数。工作区默认值既不能设置也不能重置；相关工具会返回
  错误，并且不会在本地保存任何内容。
- `zcode_settings_update` 的四项设置作用于整个运行时进程，而不是某一个工作区，
  并且不会被保存。桥接会收到运行时的确认，但无法回读这些值。
- 尚未确认过经由桥接的模型轮次。在 2026-09-23 于 Windows 11 上进行的一次测试
  中，`zai-api/GLM-5.3-Flash` 位于目录中，以推理级别 `low` 选择它也得到了确认，
  但提供商以代码 `1113`（余额或资源包不足）拒绝了该轮次。记录见
  [SUPPORT_MATRIX.json](../../SUPPORT_MATRIX.json)。经由套件代理成功的模型
  请求，并不能说明经由桥接的轮次的情况。

更多限制见 [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)。

## 测试与演示

```sh
npm test
```

构建桥接，并针对运行时的替身（`test/fixture/fake-harness.mjs`）运行单元测试和
集成测试。不需要 ZCode。

```sh
LIVE_TEST=1 LIVE_WORKSPACE="<workspace>" LIVE_DATA_DIR="<data directory>" npm run test:live
```

针对已安装的 ZCode 运行时运行，可能消耗额度。没有 `LIVE_TEST=1` 和
`LIVE_WORKSPACE` 时，这些测试会被跳过。

```sh
node examples/demo-client.mjs --workspace "<workspace>"
node examples/demo-client.mjs --fixture
```

从客户端的视角依次调用各个工具：健康状态、能力、工作区、模型目录、会话、任务、
权限请求、结果，以及在同一会话中的后续任务。加上 `--fixture` 时，它使用替身
而不是已安装的运行时。

## 文档

- [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md)：按领域列出桥接提供的功能（英文）
- [docs/MCP_API.md](docs/MCP_API.md)：工具、资源、任务结果及其限制（英文）
- [docs/SECURITY.md](docs/SECURITY.md)：各项检查及其局限（英文）
- [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)：不能工作或不提供的功能（英文）
- [docs/PROTOCOL.md](docs/PROTOCOL.md)：桥接如何与 ZCode 运行时通信（英文）

## 许可证

MIT；参见 [LICENSE](LICENSE)。
