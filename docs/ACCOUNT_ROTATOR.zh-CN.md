# 自动账号轮换
[English (original)](ACCOUNT_ROTATOR.md) · [Deutsch](ACCOUNT_ROTATOR.de.md) · [Español](ACCOUNT_ROTATOR.es.md) · [日本語](ACCOUNT_ROTATOR.ja.md) · **简体中文**

> 本文为英文原文的翻译；如有出入，以英文原版为准。

可选的账号轮换（Account Rotator）功能会把经过授权的登录作为相互独立的账号保存。开启后，每次成功的新登录都会保存为另一个账号。对于受支持的请求，如果当前选中的账号无法继续，Kit 可能会改用另一个已保存的账号重试。重试不保证成功。在产生任何输出之前发生的暂时性网络或网关故障，会先在同一个账号上重试；这种重试本身绝不会切换账号。

这个功能不会创建账号、重置额度或绕过供应商规则。导入登录不会带来新的额度。请只使用你有权访问的账号。

## 开启或关闭

该功能默认关闭。在终端中，设置程序会询问：

> Do you want to activate the Account Rotator feature? [y/N]

回答 `y` 会开启它，并保留 Kit 已经可以使用的登录。回答 `n` 或直接按回车则保持关闭。设置程序会保存这个回答，之后不再询问；`zcode-kit setup --reask` 会重新询问。没有终端时，设置程序不会改动这项设置。无人值守安装时，可以给设置程序传入 `--account-rotator y` 或 `--account-rotator n`，或者把 `ZCODE_KIT_ACCOUNT_ROTATOR` 设为 `y` 或 `n`。

你可以随时切换这个功能：

```sh
zcode-kit accounts enable
zcode-kit accounts disable
```

这两条命令都会重启本 Kit 正在运行的代理，使更改生效。关闭后，已保存的账号仍会保留。

## 添加和管理账号

再次登录即可添加另一个账号。也可以导入 ZCode Desktop 已经在使用的登录：

```sh
zcode-kit auth login zai
zcode-kit auth login zai --import
zcode-kit accounts
```

导入读取的是 Desktop 当前共享的凭据，而不是新建的账号。对于 Desktop 0.16.9，只要存在加密的 `credentials.json`，就以它为准。只有在它不存在时，才会回退到旧的 `config.json`；文件损坏、解密密钥错误或当前激活的供应商不受支持时，会报错，而不会悄悄导入一个旧登录。导入程序读取当前激活的 `zai`/`start-plan` 登录，`start-plan` 需要显式配置套餐。对于 `coding-plan`，请使用上面的普通 OAuth 登录：只读的 Desktop 导入程序不会解析或创建 API 密钥。它不会修改 Desktop 的共享凭据。

账号列表会显示这些管理命令使用的 ID：

```sh
zcode-kit accounts pause <ID>
zcode-kit accounts resume <ID>
zcode-kit accounts remove <ID> --yes
```

暂停和恢复只对新请求生效；已经在运行的请求会继续使用原来的账号。不带 `--yes` 的 `remove` 不会做任何更改，并提示你加上它重新运行命令。删除账号不会影响 Desktop 的登录。

如果没有符合条件的已保存账号可用，Kit 不会切换到无关或未经授权的账号；请求可能会失败。

更多命令：

| 命令 | 用途 |
| --- | --- |
| `zcode-kit accounts --json` | 以 JSON 格式输出账号列表，不含凭据。 |
| `zcode-kit accounts --live` | 账号的运行时状态，从正在运行的代理读取。 |
| `zcode-kit accounts quota` | 账号池中所有账号的额度，从正在运行的代理读取。 |
| `zcode-kit accounts explain --model MODEL --operation OP` | 对于某个模型和某种操作（`inference`、`billing`、`quota` 或 `async`），配置允许使用哪些已保存的账号，以及其他账号为什么被排除。只读取配置和账号存储。 |
| `zcode-kit accounts doctor [--json]` | 对配置和账号存储进行只读检查。 |
| `zcode-kit accounts unlock [--force]` | 删除账号存储上被遗弃的锁。仍被持有或无法读取的锁，只有加上 `--force` 才会删除。 |

## 再次登录

带有相同 OAuth 用户 ID 的登录会就地更新已有账号（换成新令牌；标签、暂停状态和冷却时间保持不变）。重新导入完全相同的凭据也是幂等的。供应商和套餐之间的界限保持不变。

Desktop 导入可能没有经过验证的用户 ID。这时，解码后的 JWT subject 相同只说明可能是重复账号，并不意味着可以覆盖凭据。如果令牌发生了变化，命令既不会悄悄替换，也不会插入重复账号，而是给出已有账号的名称。如果确实要替换，请显式选择它：`zcode-kit auth login zai --import --account ID --replace`（OAuth 登录时省略 `--import`）。subject 绝不会被提升为上游的 `userId` 字段。

`--account ID` 总是保存到你选择的 ID 下，即使该用户已经以另一个 ID 保存过。此时登录会输出一条提示，指出另一个 ID，`zcode-kit accounts doctor` 也会报告 `same_identity_accounts`。这样的别名与该用户共享额度，不会增加容量，但轮换功能仍把它当作单独的条目（并可能在原账号之后尝试它）；可以用 `zcode-kit accounts remove <ID> --yes` 删除它。

## 账号健康状态

```sh
zcode-kit accounts health
zcode-kit accounts health --json
```

显示一张表，每个账号一行：账号 ID、判定、套餐、额度（每个额度包的剩余/总量，附百分比和重置时间）以及账号最后一次使用的时间。`*` 标记当前使用的账号。表格下方显示 `usable: N of M` 和账号池的合计。这条命令需要代理正在运行；否则每个账号都是 `unknown`，命令会提示你运行 `zcode-kit proxy start`。退出码 0 表示至少有一个账号是 `ok` 或 `low`；1 表示目前没有可用账号，或者无法获取实时数据。

各判定按优先级排列如下。表格中把 `auth_error` 和 `no_quota_data` 显示为 `auth error` 和 `no quota data`；JSON 输出保留下面的名称。

| 判定 | 含义 |
| --- | --- |
| `paused` | 被你或策略暂停。 |
| `blocked` | 因供应商、套餐或允许列表策略而被排除。 |
| `expired` / `invalid` | 登录已过期，或在当前配置下无法使用。 |
| `auth_error` | 计费服务拒绝了该登录（401/3012）；请重新登录。 |
| `exhausted` | 遇到额度错误后处于冷却中，直到显示的时间。冷却开始之前，Kit 会按逐渐拉长的间隔在同一个账号上重试（默认在 1s、4s、10s、20s 和 30s 后，因此一个请求可能被挂起约一分钟）；网关可能会从另一个仍有额度的余额包响应重试（例如每日额度包已用完，但旁边还有活动赠送的额度）。这个重试间隔也适用于单账号安装。在账号轮换模式下，如果重试被关闭、被拒绝或因其他错误失败，冷却同样会生效；只有单账号的重试记录会等到确认额度耗尽。可以用 `ZCODE_PROXY_QUOTA_RETRY_DELAYS_MS` 调整或关闭（以逗号分隔的毫秒数；`0` 表示立即重试一次，`off` 表示关闭；最多 6 项，每项上限 60s；只能使用十进制数字，无效值会回退到默认间隔；代理的 start/restart 会传递这个变量）。 |
| `duplicate` | 符合条件的账号中有相同的已验证 OAuth 身份或完全相同的凭据；额度只查询并合计一次。仅凭解码后的 JWT subject 相同，绝不会跳过查询。 |
| `no_quota_data` | 服务有应答，但目前没有报告该账号的任何额度包。这并不表示状态确认正常。 |
| `empty` | 所有额度包都已用完。 |
| `low` | 至少有一个额度包剩余不到 10%。 |
| `ok` | 可以使用，仍有额度。 |
| `unknown` | 没有拿到该账号完整的实时应答（代理未运行、某次额度查询失败，或某个额度包报告的数字不完整）。绝不会计为可用。 |

JSON 中每个账号都包含 `probeSource`（`live`、`duplicate`、`error` 或 `not_probed`）。被暂停或被策略排除的账号仍会显示，但不会被查询；计费响应中没有它们，并不会被解读为额度为零。

开销：每次运行对每个不重复的账号最多发出 2 个计费请求（余额和预览），结果缓存 15 秒。它不发送模型请求，不求解 CAPTCHA，也不刷新令牌。

如果正在运行的代理无法把账号元数据（冷却时间、最后使用时间）写入存储（另一个进程持有存储的锁，或者发生了暂时性 I/O 错误），这项更改会被保留，并在后台分别于 0.25、1、4 和 15 秒后重新写入；没有请求会等待它，而且下一次更改无论如何都会再次写入。在更改尚未写入磁盘期间，`zcode-kit accounts doctor` 会显示 `runtime_changes_unsaved`。损坏的存储不会重试。
