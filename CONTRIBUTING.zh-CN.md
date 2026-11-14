# 为 ZCode Agent Kit 做贡献
[English (original)](CONTRIBUTING.md) · [Deutsch](CONTRIBUTING.de.md) · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · **简体中文**

> 本文为英文原文的翻译；如有出入，以英文原版为准。

欢迎提交问题报告、修复、文档和翻译。本指南介绍如何在源码检出中开发 Kit；如果只是安装和使用，请按照 [README](README.zh-CN.md) 操作。

## 前提条件

- Node.js 24 或更高版本。CI 在 Node.js 24 和 26 上测试。
- Bun 1.4.2。代理和 MCP 桥接的测试在 Bun 上运行，CI 固定使用这个版本。在 CI 运行器上，Bun 1.4.3 及更高版本在一批大请求下会抬高代理的内存峰值；更旧的 Bun（例如 1.2.20）无法读取 MCP 桥接的 lockfile。
- Git。

## 克隆与安装

```sh
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git
cd ZCode-Agent-Kit
```

如果要提交 pull request，请在 GitHub 上 fork 本仓库，并把你的分支推送到自己的 fork。

Kit 本身没有 npm 依赖。代理和 MCP 桥接各有自己的依赖，版本固定在各自的 `bun.lock` 文件中。请按 CI 的方式安装：

```sh
cd zcode-proxy-src && bun install --frozen-lockfile
cd ../mcp/zcode-harness-mcp && bun install --frozen-lockfile
cd ../..
```

在检出目录中用 `node cli/zcode-kit.mjs <command>` 运行 CLI，例如 `node cli/zcode-kit.mjs doctor`。会写入助手配置的命令（`setup`、`integrate`、`doctor --fix`、`accounts enable` 和 `accounts disable`）拒绝在检出目录中运行。已安装的副本和检出目录共用同一个主文件夹，两边都写入会让 Kit 的状态分散在两处。`integrate <harness> --dry-run` 会列出将要更改的内容，但不写入任何东西。只有在你确实想从检出目录写入时，才设置 `ZCODE_KIT_ALLOW_CHECKOUT=1`。

## 运行测试

请在仓库根目录运行：

| 命令 | 运行内容 |
|---|---|
| `npm run test` | 用 `node --test` 运行 Kit 测试 |
| `npm run test:proxy` | 在 `zcode-proxy-src/` 中用 `bun test` 运行代理测试 |
| `npm run test:mcp` | 构建 MCP 桥接，然后运行它的测试 |
| `npm run test:all` | 以上三项，再加上代理的类型检查（`npm run test:proxy-typecheck`） |

`ci` 工作流会在每个 pull request 上运行这些测试套件，平台为 Ubuntu 和 Windows，Node.js 版本为 24 和 26。它还会运行两项较慢的检查：

- 输出比对（`npm run test:ux-before`）。每一份捕获的 `zcode-kit` 输出都必须与 `tests/ux-before/` 中的基线逐字节一致，因此如果你改了某条命令的输出，需要在同一个 pull request 中提交更新后的基线文件。任务失败时，它会把新的捕获结果作为 artifact 上传，方便你查看差异。在 Linux 上，比对大约需要 8 分钟，并且需要 util-linux 的 `script`；在 macOS 上会跳过。
- 内存预算（`tests/memory/`）。`tests/memory/expected-red.json` 中列出的运行必须失败，其他运行都必须通过。因此，如果某项改动修复了列表中的某个运行，也要把它从这个文件中删除。

## 提交改动

- 较大的改动，例如新的助手集成或代理处理请求方式的变化，请先开一个 issue 或发起一个 [Discussion](https://github.com/ZepiGit/ZCode-Agent-Kit/discussions)，在写代码之前先就做法达成一致。
- 每个 pull request 保持小而集中，只做一项改动。
- 改变行为时，请添加或更新覆盖该行为的测试。
- 提交信息采用 Conventional Commit 格式：`type(scope): summary`。历史中大多数提交使用 `feat`、`fix`、`docs`、`test`、`ci` 和 `chore` 这几种类型。scope 可以省略，用来指明你改动的部分，例如 `proxy`、`cli`、`mcp` 或 `omp`。历史中的一个例子：`fix(mcp): bridges sharing one data directory leave each other's tasks alone`。
- 新文件只有在 `pack/build.mjs` 的允许列表中列出时，才会进入 npm 包。

## 文档与翻译

README 有 English、Deutsch、Español、日本語 和 简体中文 几个版本。英文版是原文，各翻译以它为准。翻译文件与英文文件放在同一目录，文件名带语言后缀（`README.de.md`、`README.es.md`、`README.ja.md`、`README.zh-CN.md`）。其他文档的翻译较少，所以请查看你修改的文件旁边有哪些语言版本。

修改面向用户的英文文档时，如果可以，请在同一个 pull request 中更新对应的翻译文件。如果做不到，请在 pull request 描述中列出因此过时的文件，以便之后更新。

`CHANGELOG.md` 始终用英文撰写。

## 第一次贡献

带有 [`good first issue`](https://github.com/ZepiGit/ZCode-Agent-Kit/labels/good%20first%20issue) 标签的 issue 适合作为起点。开始之前，请先在该 issue 下留言，免得两个人做同一件事。

## 提问与安全报告

问题请在 [GitHub Discussions](https://github.com/ZepiGit/ZCode-Agent-Kit/discussions) 中提出。安全问题请按 [SECURITY.zh-CN.md](SECURITY.zh-CN.md#报告漏洞) 中的说明报告，切勿在公开 issue 中报告。
