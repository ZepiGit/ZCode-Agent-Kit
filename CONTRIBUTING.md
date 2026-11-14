# Contributing to ZCode Agent Kit
**English (original)** · [Deutsch](CONTRIBUTING.de.md) · [Español](CONTRIBUTING.es.md) · [日本語](CONTRIBUTING.ja.md) · [简体中文](CONTRIBUTING.zh-CN.md)

Bug reports, fixes, documentation and translations are welcome. This guide covers working on the kit from a source checkout; to install and use it, follow the [README](README.md).

## Requirements

- Node.js 24 or newer. CI tests on Node.js 24 and 26.
- Bun 1.4.2. The proxy and the MCP bridge run their tests on Bun, and CI pins this version. On the CI runners, Bun 1.4.3 and later raise the proxy's memory peak under a burst of large requests; older Bun, such as 1.2.20, rejects the MCP bridge's lockfile.
- Git.

## Clone and install

```sh
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git
cd ZCode-Agent-Kit
```

To send a pull request, fork the repository on GitHub and push your branch to your fork.

The kit itself has no npm dependencies. The proxy and the MCP bridge have their own, pinned in their `bun.lock` files. Install them the way CI does:

```sh
cd zcode-proxy-src && bun install --frozen-lockfile
cd ../mcp/zcode-harness-mcp && bun install --frozen-lockfile
cd ../..
```

Run the CLI from the checkout with `node cli/zcode-kit.mjs <command>`, for example `node cli/zcode-kit.mjs doctor`. Commands that write to your assistants' configuration (`setup`, `integrate`, `doctor --fix`, `accounts enable` and `accounts disable`) refuse to run from a checkout. An installed copy and a checkout share one home folder, and writing from both would split the kit's state between them. `integrate <harness> --dry-run` lists what would change without writing anything. Set `ZCODE_KIT_ALLOW_CHECKOUT=1` only when you do mean to write from the checkout.

## Running the tests

Run these from the repository root:

| Command | What it runs |
|---|---|
| `npm run test` | Kit tests with `node --test` |
| `npm run test:proxy` | Proxy tests with `bun test` in `zcode-proxy-src/` |
| `npm run test:mcp` | Builds the MCP bridge, then runs its tests |
| `npm run test:all` | All three, plus the proxy typecheck (`npm run test:proxy-typecheck`) |

The `ci` workflow runs these suites on every pull request, on Ubuntu and Windows with Node.js 24 and 26. It also runs two slower checks:

- Output comparison (`npm run test:ux-before`). Every captured `zcode-kit` output must match the baselines in `tests/ux-before/` byte for byte, so a change to what a command prints needs the refreshed baseline files in the same pull request. When the job fails, it uploads the fresh capture as an artifact so you can see the difference. On Linux the comparison takes about 8 minutes and needs util-linux `script`; on macOS it is skipped.
- Memory budget (`tests/memory/`). Runs listed in `tests/memory/expected-red.json` must fail and all other runs must pass, so a change that fixes a listed run also removes it from that file.

## Proposing changes

- Before a bigger change, such as a new assistant integration or a change to how the proxy handles requests, open an issue or start a [Discussion](https://github.com/ZepiGit/ZCode-Agent-Kit/discussions) so the approach is agreed before you write the code.
- Keep each pull request small and about one change.
- When you change behavior, add or update the tests that cover it.
- Write commit messages in Conventional Commit style: `type(scope): summary`. Most commits in the history use the types `feat`, `fix`, `docs`, `test`, `ci` and `chore`. The scope is optional and names the part you changed, such as `proxy`, `cli`, `mcp` or `omp`. An example from the history: `fix(mcp): bridges sharing one data directory leave each other's tasks alone`.
- A new file goes into the npm package only if the allowlist in `pack/build.mjs` names it.

## Documentation and translations

The README is available in English, Deutsch, Español, 日本語 and 简体中文. English is the source, and the translations follow it. Translated files sit next to the English file with a language suffix (`README.de.md`, `README.es.md`, `README.ja.md`, `README.zh-CN.md`). Other documents have fewer translations, so check which language files sit next to the one you change.

When you change user-facing English documentation, update the translated files in the same pull request if you can. If you can't, list the files that are now out of date in the pull request description so they can be updated later.

`CHANGELOG.md` is always written in English.

## First contributions

Issues labeled [`good first issue`](https://github.com/ZepiGit/ZCode-Agent-Kit/labels/good%20first%20issue) are meant as a starting point. Leave a comment on the issue before you start, so two people don't end up working on the same thing.

## Questions and security reports

Ask questions in [GitHub Discussions](https://github.com/ZepiGit/ZCode-Agent-Kit/discussions). Report security problems as described in [SECURITY.md](SECURITY.md#reporting-a-vulnerability), never in a public issue.
