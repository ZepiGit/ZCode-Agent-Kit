# ZCode Proxy
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · **简体中文**

此组件提供 ZCode Agent Kit 随附的本地模型代理。Kit 负责其安装配置；
只有在获得你的同意后才配置助手集成。

## 在 ZCode Agent Kit 中使用

请使用[主 README](../README.zh-CN.md)中介绍的设置和模型命令。随附源码
版本及本地修改记录在[组件清单](../MANIFEST.md)中。Kit 需要 Node.js 24 或
更高版本，并用 Bun 启动代理；固定的 Bun 版本为 1.4.2。

## 导入 Desktop 登录

`zcode-kit auth login zai --import` 读取 Desktop 当前的共享登录信息。
Desktop 0.16.9 的 `credentials.json` 存在时，以它为权威来源；仅在它不存在时
才回退到旧版 `config.json`。凭据损坏、密钥错误或当前服务商不受支持时，不会
静默回退。导入当前的 `zai`/`start-plan` 登录时，`start-plan` 需要明确配置套餐；
`coding-plan` 改用正常的 OAuth 登录。导入不会创建账号、重置配额，也不会查找或创建 API
密钥。参见[账号管理](../docs/ACCOUNT_ROTATOR.md)。

## CAPTCHA 求解器与缓存

求解器在独立的进程中运行，内存上限为 300 MB（`solver.memoryCapMB`），一次只运行
一个 CAPTCHA 窗口。达到上限的 50 % 或完成 100 次求解后，它会被一个新进程替换；
参见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 中的“The solver process”。
启动时准备一个令牌，随后按需求
增加储备，最多四个；旧的并行设置会被限制在该容量内。服务商限流仍会暂停求解，
排队任务、缓存失效操作和诊断哈希均不能绕过该暂停。

`CAPTCHA_CDN_CACHE_TTL_MS` 同时控制内存和磁盘 CDN 缓存，默认值为
`86400000` 毫秒（24 小时），仅接受 `0` 至 `2147483647` 的整数。
无效值会报错；`0` 禁用两级缓存的读取和写入。`CAPTCHA_CDN_CACHE_DIR`
可指定独立的缓存目录。Kit 管理的代理会将这两个环境变量传递给子进程。
磁盘写入采用原子封装；没有获取时间戳的旧条目和被截断的条目会被拒绝。
从磁盘提升到内存时，仍保留原始获取时间所对应的缓存年龄。

诊断会为每个已加载的产物原子记录来源，并按窗口报告实际加载字节的
SHA-256 哈希；来源未知时会明确说明。`Last-Modified` 不能证明历史字节内容
相同。要静态检查已保存的服务商脚本，请使用安装目录中的辅助工具：

```sh
node <installation>/zcode-proxy-src/captcha-compatibility.mjs <saved-script> [retrieval-epoch-ms]
```

如已知获取时间，可用 epoch 毫秒传入。该工具仅读取文件并报告哈希和兼容性
标记，不执行脚本，也不代表端到端 CAPTCHA 验证成功。旧的字节码 VM 诊断
重写（`PE_PATCH`）因已复现的脚本包损坏而移除，包含敏感参数的 DBT 转储
（`CAPTCHA_DUMP_DBT`）也已移除。请勿使用这些开关。求解器、安全检查及可调用
的 `show` 备用路径均保留；调试诊断仅包含元数据。

## 响应与重试

代理在解析转换流或 JSON 错误响应前解码 gzip、deflate 和 Brotli。空的或无法
解码的批量响应会报告为 `upstream_invalid_response`，不会视为成功的空回复。
代理不会将自身进程的目录冒充为调用方工作目录；`ZCODE_IDENTITY_ENV_CWD` 仍可
用于显式覆盖。

输出开始前的暂时性故障会在同一账号上最多重试三次，预算比官方客户端小：

- 会重试：连接被拒绝或重置，HTTP 500、502、503、504、524、529 和 429，以及
  官方客户端会重试的网关错误码。
- 不会重试：网关裁定（配额、余额、验证码、模型、认证）、请求错误，以及输出
  开始后的任何故障。
- 等待时间递增：第一次重试前约 1 秒，之后每次翻倍。
  `ZCODE_PROXY_TRANSIENT_RETRY_UNIT_MS` 设置单位（第一次等待的一半），以毫秒
  计（默认 500，上限 10000）。`off` 只保留对从未建立的连接的重试。
- 每次重试前都会重新检查账号。`Retry-After` 最多遵守 15 秒，超过则交给客户端。
- 在第一个内容事件之前失败的流（如 `overloaded_error` 这类错误事件或连接被
  切断）也会以同样方式重试；此时客户端会在第一个内容事件到达时（最多 15 秒后）
  收到响应头。
- 在 start-plan 下，每次在响应或连接断开之后的重试都会使用新的验证码令牌。
- 用于强制客户端会话的有序传输会像 fetch 路径一样重试在响应之前断开的连接
  （同一账号；配额故障转移绝不会在其他账号上重放）。

没有 `message_stop` 就结束的原生 Anthropic 流会收到一个类型为 `api_error` 的
终止 `event: error` 帧。消息注明 `upstream_incomplete`，读取失败时为
`upstream_stream_error`。未完成的最后一帧会被丢弃，让客户端看到可解析的故障
而不是无声截断。

## 停止、重启与过载

- **停止。** Kit 管理器通过回环监听端口上的一个经过认证的请求要求代理停止
  （`POST /__kit/stop`，需要代理密钥和每次启动时生成的停止令牌）。此后代理对
  新请求返回 HTTP 503 和 `Retry-After`，给正在处理的请求最多 6 秒完成，切断
  仍未结束的请求，并在 10 秒内退出。只有代理在此之后 2 秒仍在运行时，管理器
  才会自行终止该进程。
- **过载。** 代理同时持有的请求体最多为 64 MiB。超出的请求会等待（最多 64 个，
  每个最多 15 秒），之后收到 HTTP 503 和 `Retry-After: 2`，绝不会是 429。
  没有请求在处理的代理总会接受一个请求。上限通过 `proxy/config.yaml` 中的
  `server.admission.maxInFlightMB`（1 至 4096）或
  `ZCODE_PROXY_ADMISSION_MAX_INFLIGHT_MB` 设置。已打开的响应流不受限制。
- **内存。** 代理每 15 秒测量一次内存。连续三次超过 512 MB 时，在日志中写入
  一条警告。连续三次超过 1024 MB 时，代理请求 Kit 管理器重启它，并在管理器
  接受后进入停止流程。管理器在 15 分钟内最多接受 3 次重启；如果被拒绝，代理
  继续提供服务。阈值是 `proxy/config.yaml` 中 `health.memory` 下的
  `softLimitMB`、`hardLimitMB`、`samples` 和 `sampleIntervalSeconds`。
- **无响应的代理。** 代理主线程 45 秒没有运行时，代理请求 Kit 管理器重启它，
  然后自行退出。
- **没有 Kit 管理器时。** 不是由 Kit 管理器启动的代理不提供停止请求，也没有
  谁会重启它。超过内存上限时它只写日志并继续提供服务；主线程停止运行时它会
  自行退出，并保持停止。

## 日志

由 Kit 管理器启动时，代理通过单一写入器把输出写入 `logs/proxy.log`。写入器
在文件达到 5 MB 时轮转，并保留一个旧文件 `proxy.log.1`。它会把代理密钥、
停止令牌以及形似令牌的字符串替换为 `<redacted>`。在 macOS 和 Linux 上，
日志文件以模式 `0600` 创建，日志目录以模式 `0700` 创建。使用
`zcode-kit proxy logs [n] [--level warn|error] [--grep <text>]` 查看日志。
未经 Kit 管理器启动的代理仍然输出到它的终端。

## 安全

该代理面向可信的本地环境。请仅在本机运行，并保护登录信息和配置数据。
部分服务商验证流程可能会在没有操作系统沙箱的情况下执行服务商提供的
JavaScript；本地绑定无法隔离这段代码。不要将服务暴露到本机之外。详情请
阅读[安全政策](../SECURITY.md)。

## 许可

此捆绑组件可能适用与 Kit 不同的条款。重新分发前，请查看[组件清单](../MANIFEST.md)
以及适用的上游声明。
