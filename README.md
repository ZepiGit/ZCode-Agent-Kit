# ZCode Agent Kit

[![CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml/badge.svg)](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml)
![Release](https://img.shields.io/github/v/release/ZepiGit/ZCode-Agent-Kit)

**English** | [中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md)

Model access from your own agent harness through **your own ZCode Desktop
account** — no second subscription, no API purchases. Ten harness adapters,
one local proxy, transparent rollback.

```
your harness (OMP / pi / Claude Code / Codex / OpenCode / Cline / Kilo Code /
              Aider / Continue / Goose / any MCP or OpenAI-/Anthropic-capable client)
        │
        ├─► local zcode-proxy  http://127.0.0.1:8457   (OpenAI + Anthropic + Responses formats)
        │         └─► zcode.z.ai  (start-plan, same quota as your ZCode Desktop)
        │
        └─► zcode-harness-mcp (stdio)  ─► your installed ZCode Desktop (real desktop sessions)
```

Models: **glm-5.3** (text, 1M context) and **glm-5.3-flash** (text+image, 1M
context), verified reasoning efforts **low / high / max** (default max).

## Quickstart

**Windows (PowerShell)** — pinned installer, SHA256-verified, no admin rights:

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.ps1 | iex
```

**macOS / Linux**:

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.sh | sh
```

The installer downloads the pinned release archive, verifies its checksum,
installs user-locally (default `%LOCALAPPDATA%\zcode-agent-kit` or
`~/.local/share/zcode-agent-kit`, override with `ZCODE_KIT_HOME`), installs
bun v1.4.2 user-locally if it is missing, and runs setup with harness
detection.

**From a repo checkout** (development or manual install):

```powershell
git clone https://github.com/ZepiGit/ZCode-Agent-Kit.git zcode-agent-kit
cd zcode-agent-kit
node setup.mjs                          # or: node cli\zcode-kit.mjs setup --harness auto
node cli\zcode-kit.mjs doctor
```

Requirements: **Node ≥ 20** (bun is only needed for a repo checkout — the
installer brings its own) and **ZCode Desktop installed and logged in** (the
credential import reads your existing desktop login; the MCP bridge needs the
desktop app *running* for model turns). Administrator rights are never
required. WSL is detected and refused — install on the Windows host.

## The zcode-kit CLI

```
zcode-kit setup [--harness auto|omp,pi,...]   bootstrap + integrate detected harnesses
zcode-kit integrate <harness> --dry-run       preview exactly what would be written
zcode-kit integrate <harness>                 apply one adapter (transactional)
zcode-kit run <harness> -- <args>             launch claude-code/codex/aider/opencode wired to ZCode
zcode-kit doctor [--harness <id>] [--json]    machine-readable diagnostics
zcode-kit status                              proxy status + quota snapshot
zcode-kit models [--json] [--show-key]        advertised models (from the running proxy)
zcode-kit usage --json                        usage/quota from the account (never invented zeros)
zcode-kit auth status|login|logout            proxy credential lifecycle (logout never touches your desktop login)
zcode-kit update                              fast-forward the checkout, re-apply integrations
zcode-kit rollback [tx-id]                    undo the newest (or named) transaction, three-way safe
zcode-kit uninstall                           remove kit integrations; never deletes shared credentials
```

Every write is transactional: files are hashed and backed up first, and
rollback is ownership-aware — later user changes are reported as conflicts,
never clobbered.

## How setup behaves

`setup --harness auto` detects which harnesses are installed and **only
touches those** — an OMP-only user gets no Claude/Codex artifacts, a
Claude-only user gets no OMP edits:

1. **bootstrap** — generates the local proxy key (`.proxykey`, exclusive
   create) and `proxy/config.yaml` from the template, installs proxy + MCP
   dependencies with `bun install --frozen-lockfile` (a failed install is a
   hard error, never a swallowed warning), and imports the credential from
   your existing ZCode Desktop login. If the import is not possible you get
   the exact one-time browser-login command printed.
2. **ten adapters** (each only for detected or explicitly requested
   harnesses) — see `harnesses/README.md` and `SUPPORT_MATRIX.json`.
3. **MCP bridge** — registers the `zcode-harness` stdio bridge only with
   harnesses that are actually present. MCP alone is never counted as model
   integration (Cline/Kilo explicitly state manual-confirmation-required).

On a machine with only OMP installed, exactly one adapter runs (OMP) plus the
OMP MCP entry — nothing Claude- or Codex-related is created.

## Usage per harness

**OMP** (additive provider; full TUI/CLI integration incl. thinking levels):

```bash
omp --model zcode/glm-5.3-flash --thinking low -p "hi"
omp --model zcode/glm-5.3 --thinking max
```

**pi** (`~/.pi/agent/models.json`, additive provider `zcode`):

```bash
pi --model zcode/glm-5.3
```

**Claude Code** (opt-in wrapper; `~/.claude` untouched):

```bat
bin\zcode-claude.cmd -p "hi" --model glm-5.3-flash
```

**Codex CLI** (opt-in wrapper, isolated CODEX_HOME):

```bat
bin\zcode-codex.cmd exec "say hi" -m glm-5.3-flash
```

**Aider / OpenCode / Goose** (launchers set process-local env only):

```bat
node cli\zcode-kit.mjs run aider -- --model openai\glm-5.3-flash
node cli\zcode-kit.mjs run opencode -- .
goose session --provider zcode
```

**Cline / Kilo Code** (GUI-configured): the kit writes a prepared values
sheet to `generated/` and marks the step `manual-confirmation-required` — it
never touches VS Code's internal state.

**Any other client** (OpenAI / Anthropic / Responses formats on
`http://127.0.0.1:8457`, bearer token = content of `.proxykey`):
see `harnesses/README.md`.

## Proxy management

```bat
node proxy\zcode-proxy-manager.mjs status
node proxy\zcode-proxy-manager.mjs start
node proxy\zcode-proxy-manager.mjs stop
node proxy\zcode-proxy-manager.mjs restart
node proxy\zcode-proxy-manager.mjs doctor
node proxy\zcode-proxy-manager.mjs logs 50
```

Safety properties: binds to 127.0.0.1 only, authenticated health/identity
checks, fail-closed stop (an unverifiable or foreign process on the port is
**never** killed; PID-reuse is detected via process start times), manager
start lock against parallel starts, graceful-then-forced shutdown, log
rotation, bounded log reads, trial-claim and off-peak channels disabled.
`doctor` separates real auth validity from JWT age and only checks components
that exist on the machine.

## Login renewal

```bash
cd zcode-proxy-src
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai --import
:: or browser login:
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai
```

## Uninstall / rollback

```bat
node cli\zcode-kit.mjs rollback      :: undo newest transaction (one step per run)
node cli\zcode-kit.mjs uninstall     :: roll back everything kit-owned, remove generated/
node proxy\zcode-proxy-manager.mjs stop
```

`uninstall` never deletes `~/.zcode-proxy/credentials.json` (shared with other
proxy tools) or your ZCode Desktop login/data. `zcode-kit auth logout` removes
only the proxy's own stored credential and says so.

## Updating

`zcode-kit update` refuses on a dirty tree, fast-forwards only (never
force-updates), and re-applies the integrations transactionally. The vendored
proxy is pinned (see `MANIFEST.md`); local patches live in `patches/`.

## Tests

```bat
npm run test          :: kit suite (node --test): transactions, manager safety, adapters, regressions
npm run test:proxy    :: 858 bun tests incl. protocol contract tests (SSE boundaries, tool args, abort, usage)
npm run test:mcp      :: MCP bridge suite (36 tests incl. HTTP auth/origin gates, allowlist escapes)
```

## Documents

- `SUPPORT_MATRIX.json` / `.md` — honest per-adapter state (implemented /
  config-tested / live-tested / manual-confirmation-required)
- `EFFORT_MAPPING.md` / `.json` — how low/high/max map to upstream parameters
- `SETUP_REPORT.md`, `TEST_REPORT.md` — test evidence with exact commands
- `IMPLEMENTATION_STATUS.md` — decisions and open points
- `harnesses/README.md` — per-harness details and manual integration snippets
- `MANIFEST.md` — vendored components, commits, licenses
- `docs/RELEASE_CHECKLIST.md` — what is prepared vs. what needs maintainer action
