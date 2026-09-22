# zcode-harness-mcp

**English** | [中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md)

An MCP server (stdio **and** Streamable-HTTP) that lets other models and agents drive the **real installed ZCode harness**: discover capabilities, pick models, read/change settings, manage workspaces and sessions, start tasks, answer follow-up questions, watch progress, and retrieve complete results including file changes and artifacts.

The bridge is a **control layer**, not a chat client and not a prompt wrapper: all work is executed by the original ZCode runtime (`zcode.cjs app-server --stdio`, locally installed) with its own tools, context management and permissions.

- Protocol: MCP (official SDK) on the outside, **ZCode Protocol v1** (NDJSON over stdio, verified live against 0.16.5) on the inside — see [`docs/PROTOCOL.md`](docs/PROTOCOL.md).
- Scope: 32 MCP tools + MCP resources; capability registry with 45 entries ([`CAPABILITY_MATRIX.md`](CAPABILITY_MATRIX.md)).
- `npm test` runs deterministic local fixtures. Live tests require explicit opt-in; historical test reports are not current acceptance evidence.
- Audit hardening: session IDs are workspace-scoped; `yolo` requires operator `--allow-yolo`. Permission allowlists use exact names; Bash, PowerShell and Shell are denied. Artifact reads are size-limited; JSONL retains two files of at most 4 MiB each. EOF interrupts work and stops the child gracefully; Windows process-tree containment is not guaranteed. `--runtime-path` executes code: use trusted files only.

## Prerequisites

- Windows 10/11 (tested) or any OS with `node` on the PATH
- Node.js ≥ 20 (`node --version`); the script starts the harness with the fixed program name `node`
- ZCode (Desktop) installed. The bridge finds `zcode.cjs` automatically at
  - `%LOCALAPPDATA%\Programs\ZCode\resources\glm\zcode.cjs`
  - `%ProgramFiles%\ZCode\resources\glm\zcode.cjs`
  - alternatively explicitly: `--runtime-path` or `ZCODE_HARNESS_RUNTIME_PATH`
- ZCode logged in (the harness uses the local Z.AI OAuth login; the bridge **manages no credentials** and redacts secrets in all output)

## Installation (Windows / PowerShell)

Inside a ZCode Agent Kit checkout the bridge already lives at `mcp/zcode-harness-mcp/` — skip the clone and `cd` there directly.

```powershell
cd $HOME
git clone <this-repo> zcode-harness-mcp   # or copy the folder
cd zcode-harness-mcp
npm install
npm run build
# self-test of the runtime detection:
npm run probe:runtime
```

## Quickstart

### 1) Register as an MCP server in an MCP client (stdio)

Example configuration (e.g. `claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "zcode-harness": {
      "command": "node",
      "args": [
        "C:\\Users\\<you>\\zcode-harness-mcp\\dist\\index.js",
        "--stdio",
        "--allow-workspace", "C:\\Users\\<you>\\Projects",
        "--interaction-policy", "ask"
      ]
    }
  }
}
```

### 2) Streamable-HTTP mode (multiple clients, explicitly enabled)

```powershell
node dist\index.js --http --http-key "<random-local-secret>" --host 127.0.0.1 --port 3322 --allow-workspace "C:\Users\<you>\Projects"
# MCP endpoint: http://127.0.0.1:3322/mcp   (localhost only; no public exposure)
```

### 3) Demo from another agent's perspective

```powershell
# against the real installation:
node examples\demo-client.mjs --workspace "C:\Users\<you>\demo-workspace"
# offline against the fixture harness:
node examples\demo-client.mjs --fixture
```

The demo client shows the complete flow: discover capabilities → open workspace → read the real model catalog → GLM-5.3-Flash check (no silent model switch) → change a setting → start a task → poll progress → answer a follow-up question → read result + artifacts → follow-up order in the same session.

### 4) Tests

```powershell
npm test          # build + unit + integration (fixture harness, deterministic)
npm run test:live # explicit opt-in only (real installation/quota): $env:LIVE_TEST="1"; $env:LIVE_WORKSPACE="C:\..."; $env:LIVE_DATA_DIR="C:\..."
```

## Most important CLI flags

| Flag | Meaning |
| --- | --- |
| `--stdio` | MCP over stdin/stdout (default) |
| `--http --http-key KEY --port N --host H` | Streamable-HTTP mode with bearer key (default 127.0.0.1:3322) |
| `--read-only` | mutating tools are rejected (technically enforced, not just annotated) |
| `--allow-workspace P` | allow a workspace root (repeatable; `;`-list via `ZCODE_HARNESS_ALLOW_WORKSPACES`) |
| `--runtime-path P` | explicit path to `zcode.cjs` |
| `--data-dir D` | persistence directory (default `~/.zcode-harness-mcp`) |
| `--interaction-policy deny\|allowlist\|ask` | how permission requests are answered (default: `deny`) |
| `--interaction-allowlist "Read,Glob"` | exact tool names for policy `allowlist` (shell tools denied) |
| `--max-concurrent-tasks N` | parallelism (default 2; excess tasks are queued) |

## Security model (short version)

- Workspace allowlist with real path resolution (symlinks/junctions) for tasks **and** artifact read access
- Read-only mode: mutating tools return errors; task `readOnly` additionally enforces plan mode + write-tool denylist on the harness side
- Secret redaction in all tool outputs, logs and events; credentials are never exposed or managed
- Process starts exclusively with argument arrays (`shell: false`), fixed program (`node`), no shell strings
- Follow-up questions (permissions/user input) are never auto-expanded: policy `deny` (default), `allowlist`, or `ask` with timeout → safe default answer (deny)
- The bridge never registers itself in its own ZCode runtime, no public network exposure, no auto plugin install

Details: [`docs/SECURITY.md`](docs/SECURITY.md) · Honest limits: [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)

## Status

Current implementation and verification status: [`KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) · Test evidence: [CI](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml) · API reference: [`docs/MCP_API.md`](docs/MCP_API.md)

## License

MIT. The reference repos [zcode-acp](https://github.com/william0wang/zcode-acp) (Apache-2.0) and [zcode-open-bridge](https://github.com/tizerluo/zcode-open-bridge) (MIT) were researched as protocol sources (commits documented in `docs/PROTOCOL.md`); code adopted from them: none.
