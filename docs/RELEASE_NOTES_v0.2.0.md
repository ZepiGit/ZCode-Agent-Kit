# zcode-agent-kit v0.2.0

Local ZCode provider kit: run **GLM-5.3** and **GLM-5.3-Flash** from your own
ZCode Desktop account inside your own agent harnesses — no second
subscription, no API purchases.

## What this release contains

- **zcode-kit CLI** (`setup` / `integrate --dry-run` / `run` / `doctor --json`
  / `status` / `models` / `usage` / `auth` / `update` / `rollback` /
  `uninstall`) with transactional, ownership-aware config edits.
- **Ten harness adapters**: OMP (oh-my-pi), pi, Claude Code, Codex CLI,
  OpenCode, Cline, Kilo Code, Aider, Continue, Goose. Adapters act only for
  detected harnesses; Cline/Kilo are prepared-values + manual-confirmation by
  design (the kit never touches VS Code internal state).
- **Local proxy** (pinned vendored zcode-api v4.6.4 + documented patches) on
  127.0.0.1:8457 speaking Anthropic-messages, OpenAI chat-completions and
  Responses formats, plus hardened `/quota` and `/v1/models` (whitelist-aware).
- **MCP bridge** for driving the real ZCode Desktop (stdio; optional
  authenticated loopback-only HTTP).
- **Fail-closed process management**: a foreign service on the port or a
  suspected PID reuse is never killed; identity is verified via authenticated
  health checks plus process start times.

## Install (Windows, PowerShell)

```powershell
irm https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.ps1 | iex
```

Configuration via environment variables set in the same session:
`ZCODE_KIT_VERSION` (release tag, default `v0.2.0`) and
`ZCODE_KIT_INSTALL_DIR` (default `%LOCALAPPDATA%\zcode-agent-kit`).
Running the saved `install.ps1` file also works. From a source checkout,
`node setup.mjs` refuses to write user configs unless
`ZCODE_KIT_ALLOW_CHECKOUT=1` opts in (a checkout must never silently become
the machine's provider root).

## Install (macOS / Linux / WSL note)

```sh
curl -fsSL https://github.com/ZepiGit/ZCode-Agent-Kit/releases/download/v0.2.0/install.sh | sh
```

WSL: install on the Windows host instead (the installer detects WSL and
refuses — the desktop app lives on Windows).

## Requirements (stated honestly)

- Node ≥ 20; bun is installed user-locally by the installer if missing
  (pinned v1.4.2, SHA256-verified).
- Your own ZCode Desktop installed **and logged in**; the MCP bridge needs the
  desktop app running for model turns (it solves Z.AI captcha challenges).
- No admin rights; nothing global is modified. The npm package is NOT yet
  published — `package.json` is intentionally private until the maintainer
  enables publication.

## Verification status

- CI green on ubuntu-latest + windows-latest: kit suite 28/28, proxy suite
  858/858, MCP bridge suite 36/36.
- Live-verified on the author's machine: OMP (effort matrix low/high/max on
  the wire, tool roundtrip, streaming/abort, flash image), Claude Code
  wrapper, Codex CLI wrapper, live proxy smoke.
- Adapters for pi/OpenCode/Aider/Continue/Goose are config-tested against
  disposable fake homes; their client behavior is NOT claimed live-tested
  (see SUPPORT_MATRIX.json for per-adapter evidence states).

## Fixed after initial v0.2.0 assets (same tag, re-published tarball)

- OMP adapter migration: a machine still carrying the previous-generation
  `zcode-omp-integration` managed block in `~/.omp/agent/models.yml` made
  setup abort (duplicate `zcode` map keys, fail-closed, nothing written).
  The adapter now takes that legacy block over and refuses — still writing
  nothing — if it finds a hand-written `zcode` entry outside any managed
  block. Kit suite is 31/31 with two added regression tests.
- Update-in-place no longer resets `proxy/config.yaml`: the mirror step now
  excludes it (and `.proxykey`) from overwrite and deletion.
- Windows one-liner is the conventional `irm ... | iex` again; the installer
  takes no `param()` block (PowerShell 7's Invoke-Expression cannot parse
  one) and reads `ZCODE_KIT_VERSION` / `ZCODE_KIT_INSTALL_DIR` environment
  variables instead.
- Source-checkout guard: `setup` / `integrate` refuse to write user configs
  when run from a git checkout (no `.git` in tarball installs) unless
  `ZCODE_KIT_ALLOW_CHECKOUT=1` is set — a checkout must never silently
  become the machine's provider root.

## Security model

- Proxy binds 127.0.0.1 only; bearer key generated locally, never committed.
- `checksums.txt` covers `v0.2.0.tar.gz`, `install.ps1`, `install.sh`
  (integrity). The bun runtime download is additionally hash-pinned inside
  the installers. A hash on the same release host is not provenance — verify
  the tag commit if you need provenance.
- No quota circumvention, no CAPTCHA/login/device checks bypassed; trial
  claim and off-peak channels are disabled in the shipped config template.

## Files

| Artifact | Purpose |
|---|---|
| `v0.2.0.tar.gz` | source tree this release was built from (`git archive`) |
| `install.ps1` | Windows installer (pinned + SHA256-verified) |
| `install.sh` | POSIX installer (pinned + SHA256-verified) |
| `checksums.txt` | SHA256 of the artifacts above |
