# ZCode Agent Kit

Model access from your own agent harness through **your own ZCode Desktop
account** — no second subscription, no API purchases.

```
your harness (OMP / Claude Code / Codex / any MCP or OpenAI-/Anthropic-capable client)
        │
        ├─► local zcode-proxy  http://127.0.0.1:8457   (OpenAI + Anthropic + Responses formats)
        │         └─► zcode.z.ai  (start-plan, same quota as your ZCode Desktop)
        │
        └─► zcode-harness-mcp (stdio)  ─► your installed ZCode Desktop (real desktop sessions)
```

Models: **glm-5.3** (text, 1M context) and **glm-5.3-flash** (text+image, 1M
context), reasoning efforts **low / high / max** (default max).

## Quickstart (fresh machine)

Requirements: Windows, ZCode Desktop installed **and logged in**, Node ≥ 20,
Bun on PATH.

```bat
git clone <your-fork-url> zcode-agent-kit
cd zcode-agent-kit
node setup.mjs
node proxy\zcode-proxy-manager.mjs doctor
```

`setup.mjs` (idempotent, re-runnable, backups before every write) detects
which harnesses are installed and **only touches those** — an OMP-only user
gets no Claude/Codex artifacts, a Claude-only user gets no OMP edits:

1. **bootstrap** — generates the local proxy key (`.proxykey`) and
   `proxy/config.yaml` from the template, installs proxy + MCP dependencies
   (`bun install`), and imports the credential from your existing ZCode
   Desktop login. If the import is not possible you get the exact one-time
   browser-login command printed.
2. **OMP** (only if `~/.omp/agent` exists) — adds the additive provider block
   `zcode` to `~/.omp/agent/models.yml`, registers the proxy-autostart
   extension, and cleans the obsolete builtin `zcode` entry from
   `disabledProviders`.
3. **Claude Code** (only if Claude Code is detected) — writes
   `generated/claude-zcode-settings.json` and the opt-in wrapper
   `bin\zcode-claude.cmd`. Your `~/.claude` and your normal `claude` command
   are **not** touched.
4. **Codex CLI** (only if Codex is detected) — writes an isolated
   `generated/codex-home` (model provider + `zcode-harness` MCP) and the
   opt-in wrapper `bin\zcode-codex.cmd`. Your `~/.codex` is **not** touched.
5. **MCP** — registers the `zcode-harness` stdio bridge (which drives your
   installed ZCode Desktop) with the harnesses that are actually present:
   OMP via `~/.omp/agent/mcp.json`, Claude Code via `claude mcp add`
   (user scope, only when Claude Code is detected). Other MCP-capable
   harnesses: see `harnesses/README.md`.

On a machine with only OMP installed, exactly one adapter runs (step 2) plus
the OMP entry of step 5 — nothing Claude- or Codex-related is created.

## Usage

**OMP** (additive provider; full TUI/CLI integration incl. thinking levels):

```bash
omp --model zcode/glm-5.3-flash --thinking low -p "hi"
omp --model zcode/glm-5.3 --thinking max
```

**Claude Code** (opt-in wrapper):

```bat
bin\zcode-claude.cmd -p "hi" --model glm-5.3-flash
bin\zcode-claude.cmd            :: interactive; model default glm-5.3
```

**Codex CLI** (opt-in wrapper, isolated config home):

```bat
bin\zcode-codex.cmd exec "say hi" -m glm-5.3-flash
```

**Any other client** (OpenAI / Anthropic / Responses formats on
`http://127.0.0.1:8457`, bearer token = content of `.proxykey`):
see `harnesses/README.md`.

**MCP bridge** (drive the real ZCode Desktop from MCP-capable agents):
server command `node <clone>/mcp/zcode-harness-mcp/dist/index.js --stdio`.
The Desktop app must be running for model turns (it solves Z.AI captchas).

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
checks (a foreign service on the port is never killed), single instance across
parallel harness sessions, log rotation, trial-claim and off-peak channels
disabled. `start`/`stop`/`restart` affect only this kit's own proxy.

## Login renewal

The proxy uses your ZCode Desktop credential (start-plan). When `doctor`
reports an expired/rejected JWT:

```bash
cd zcode-proxy-src
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai --import
:: or browser login:
ZCODE_PROXY_CONFIG="../proxy/config.yaml" bun run src/index.ts auth login zai
```

## Uninstall / rollback

```bat
node setup.mjs --rollback
node proxy\zcode-proxy-manager.mjs stop
```

Manual leftovers: remove `~/.omp/agent/extensions/zcode-proxy-autostart.ts`
(+ its entry in `config.yml`), `claude mcp remove zcode-harness --scope user`,
the `zcode-harness` entry in `~/.omp/agent/mcp.json`, and `~/.zcode-proxy/`.
Deleting the clone removes everything else.

## Updating

The vendored proxy is pinned (see `MANIFEST.md`); local patches live in
`patches/`. After an OMP or ZCode Desktop update re-run `node setup.mjs`
(idempotent) and `doctor`. For a new upstream proxy release, re-apply
`patches/zcode-proxy-local-patches.patch` and run `bun test` inside
`zcode-proxy-src`.

## Documents

- `EFFORT_MAPPING.md` / `.json` — how low/high/max map to upstream parameters
- `SETUP_REPORT.md`, `TEST_REPORT.md` — reference installation evidence
- `IMPLEMENTATION_STATUS.md` — decisions and open points
- `harnesses/README.md` — per-harness details and manual integration snippets
- `MANIFEST.md` — vendored components, commits, licenses
