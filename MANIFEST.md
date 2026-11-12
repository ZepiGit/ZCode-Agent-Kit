# Manifest — bundled components and provenance
**English (original)** · [Deutsch](MANIFEST.de.md)

**Snapshot:** This file describes the components and revisions actually present in this repository. It does not claim that every upstream project is at its latest release. External harness versions are recorded references, not versions installed or pinned by the Kit.

## Components

| Component | Source | Bundled pin / recorded reference | License | Local changes |
|---|---|---|---|---|
| zcode-proxy | https://github.com/TriDefender/zcode-api | v4.6.4, commit `9a5cebe07c5255faa675075fa37632d4dea733fa` (2026-09-11) | MIT (declared in upstream README; upstream has no LICENSE file) | The vendored base is v4.6.4. At this snapshot (2026-09-22), upstream's latest published release was v4.6.9; it is not incorporated in this tree. The local changes are listed below. `zcode-proxy-src/README.md` describes the Kit context; its `.de`, `.es`, `.ja`, and `.zh-CN` files are translations. The upstream README is available at the pinned commit. |
| zcode-harness-mcp | This repository (MCP bridge for ZCode Desktop `app-server`) | 0.1.0 | MIT | Embedded and maintained locally in `mcp/zcode-harness-mcp/`. Workspace safeguards cover scope, task lifecycle, argument validation, and storage limits. The compiled `dist/` output is committed. The English README is the original; German, Spanish, Japanese, and Simplified Chinese translations are included. |
| OMP (target harness, reference check) | https://github.com/can1357/oh-my-pi | 18.2.9 | — | No core changes; integration is limited to `models.yml`, `config.yml`, an extension, and the MCP bridge entry in `mcp.json`. |
| Claude Code (target harness, wrapper) | Anthropic | 2.1.278 | — | No changes to `~/.claude`; opt-in wrapper and generated settings file. Setup also registers the MCP bridge with `claude mcp add zcode-harness --scope user`, which changes Claude Code's own user configuration. |
| Codex CLI (target harness, wrapper) | OpenAI | 0.155.1 | — | No changes to `~/.codex`; isolated `CODEX_HOME` under `generated/`. |

The harness versions are the ones recorded as tested in [SUPPORT_MATRIX.json](SUPPORT_MATRIX.json), which also lists the other supported harnesses. `zcode-kit setup --no-mcp` skips the MCP bridge registration.

## Runtime and dependencies

- Node.js 24 or newer. Node.js 20 and 22 are not supported; `zcode-kit setup`, `zcode-kit update` and both installers refuse to run on them before changing anything.
- Bun runs the proxy. The pinned version is 1.4.2: the installers install it when Bun is missing, and the automated checks run on it.
- zcode-proxy (`zcode-proxy-src/package.json`): `happy-dom` ^21.0.4, `undici` ^8.12.4, `yaml` ^2.9.1. `zcode-proxy-src/bun.lock` resolves them to 21.0.4, 8.12.4 and 2.9.1. Development only: `typescript` 7.0.2 and `@types/bun` 1.4.2.
- zcode-harness-mcp (`mcp/zcode-harness-mcp/package.json`): `@modelcontextprotocol/sdk` ^1.32.2 and `zod` ^4.6.6. `mcp/zcode-harness-mcp/bun.lock` resolves them to 1.32.2 and 4.6.7. Development only: `typescript` 7.0.2 and `@types/node` ^24.19.2.

Setup installs both dependency sets with `bun install --frozen-lockfile`.

## Local changes to the vendored proxy

The root Git history records every change. In summary:

- Credentials: authoritative import of Desktop 0.16.9 shared credentials.
- CAPTCHA: strictly validated memory and disk cache TTL and isolated cache directories, passed through the managed environment; atomic cache envelopes and per-loaded-artifact provenance; a static saved-script compatibility helper that does not execute vendor code or prove end-to-end success. The old bytecode-VM diagnostic rewrite was removed after reproduced bundle corruption, along with sensitive DBT dumps; the solver and its security gates remain, with metadata-only debug diagnostics.
- Models: Flash requests that disable thinking are normalized to `low`, while `high` and `max` remain available.
- Transport: Brotli and deflate streams and JSON errors are handled; the Responses adapter preserves tool output and required event fields.
- Operation: a graceful stop request on the loopback listener, a limit on request bodies in flight, memory and responsiveness monitoring with restart requests to the Kit manager, and a size-capped, rotated `proxy.log`. The [security policy](SECURITY.md) describes their behavior.
- Harness configuration written by the Kit: Windows Codex uses a restricted-token sandbox, and OpenCode exposes explicit Flash reasoning variants.
- The native bridge targets the installed 0.16.9 protocol; its model route remains distinct from the proxy route.

These changes do not establish equivalent live behavior on other operating systems or across all harnesses.

## Directories excluded from the vendor copy

- `zcode-proxy-src/node_modules/` — installed by setup with `bun install`.
- `zcode-proxy-src/Android-APP/` (209 MB) — not needed for Desktop/harness integration; its build path was removed (`scripts/build-android-apk.sh`, `build:android-*` npm scripts, the esbuild dev dependency, and the vendored `.github/workflows/release.yml` Android build job). The control listener source under `zcode-proxy-src/src/android/` remains because the proxy entry point imports it.
- `zcode-proxy-src/.github/workflows/` (`ci.yml`, `release.yml`) and `zcode-proxy-src/.github/release.yml` — vendored upstream CI and release workflows, removed. GitHub runs only the root `.github/workflows/`, so they never ran in this repository. The root CI runs the proxy tests.
- `mcp/zcode-harness-mcp/node_modules/` — installed by setup.

Automated checks: [GitHub Actions](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml). Effort mapping: [EFFORT_MAPPING.md](EFFORT_MAPPING.md); its German translation is [EFFORT_MAPPING.de.md](EFFORT_MAPPING.de.md).
