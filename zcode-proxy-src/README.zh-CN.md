# ZCode Proxy
[English (original)](README.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · **简体中文**

此组件提供 ZCode Agent Kit 随附的本地模型代理。Kit 负责其安装配置以及
与助手工具的集成。

## 在 ZCode Agent Kit 中使用

请使用[主 README](../README.zh-CN.md)中介绍的设置和模型命令。随附源码
版本及本地修改记录在[组件清单](../MANIFEST.md)中。

`zcode-kit auth login zai --import` 读取 Desktop 当前的共享登录信息。
Desktop 0.16.9 的 `credentials.json` 存在时，以它为权威来源；仅在它不存在时
才回退到旧版 `config.json`。凭据损坏、密钥错误或当前服务商不受支持时，不会
静默回退。导入当前的 `zai`/`start-plan` 登录时，`start-plan` 需要明确配置套餐；
`coding-plan` 改用正常的 OAuth 登录。导入不会创建账号、重置配额，也不会查找或创建 API
密钥。参见[账号管理](../docs/ACCOUNT_ROTATOR.md)。

进程内求解器一次只运行一个 CAPTCHA 窗口。启动时准备一个令牌，随后按需求
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

本地修复在解析转换流或 JSON 错误响应前解码 gzip、deflate 和 Brotli。空的或无法解码的批量响应会报告为 `upstream_invalid_response`，不会视为成功的空回复。代理不会将自身进程的目录冒充为调用方工作目录；`ZCODE_IDENTITY_ENV_CWD` 仍可用于显式覆盖。

## 安全

该代理面向可信的本地环境。请仅在本机运行，并保护登录信息和配置数据。
部分服务商验证流程可能会在没有操作系统沙箱的情况下执行服务商提供的
JavaScript；本地绑定无法隔离这段代码。请阅读[安全政策](../SECURITY.md)，
并且不要将服务暴露到本机之外。

## 许可

此捆绑组件可能适用与 Kit 不同的条款。重新分发前，请查看[组件清单](../MANIFEST.md)
以及适用的上游声明。
