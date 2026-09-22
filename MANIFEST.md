# Manifest — bundled components and provenance
**English (original)** · [Deutsch](MANIFEST.de.md)

**Snapshot:** This file describes the components and revisions actually present in this repository. It does not claim that every upstream project is at its latest release. External harness versions are recorded references, not versions installed or pinned by the Kit.

| Component | Source | Bundled pin / recorded reference | License | Local changes |
|---|---|---|---|---|
| zcode-proxy | https://github.com/TriDefender/zcode-api | v4.6.4, commit `9a5cebe07c5255faa675075fa37632d4dea733fa` (2026-09-11) | MIT (declared in upstream README; upstream has no LICENSE file) | The vendored base is v4.6.4. At this snapshot (2026-09-22), upstream's latest published release was v4.6.9; it is not incorporated in this tree. The root Git history records local changes, including credential, streaming, control-port, and test fixes. `zcode-proxy-src/README.md` describes the Kit context; its `.de`, `.es`, `.ja`, and `.zh-CN` files are translations. The upstream README is available at the pinned commit. |
| zcode-harness-mcp | This repository (MCP bridge for ZCode Desktop `app-server`) | 0.1.0 | MIT | Embedded and maintained locally in `mcp/zcode-harness-mcp/`. Audit fixes cover workspace scope, task lifecycle, argument validation, and storage limits. The compiled `dist/` output is committed; runtime dependencies are `@modelcontextprotocol/sdk` and `zod`. The English README is the original; German, Spanish, Japanese, and Simplified Chinese translations are included. |
| OMP (target harness, reference check) | https://github.com/can1357/oh-my-pi | 18.1.18 (Canary) | — | No core changes; integration is limited to `models.yml`, `config.yml`, and an extension. |
| Claude Code (target harness, wrapper) | Anthropic | 2.1.269 | — | No changes to `~/.claude`; opt-in wrapper and generated settings file. |
| Codex CLI (target harness, wrapper) | OpenAI | 0.153.4 | — | No changes to `~/.codex`; isolated `CODEX_HOME` under `generated/`. |

## Directories excluded from the vendor copy

- `zcode-proxy-src/node_modules/` — installed by `setup.mjs` with `bun install`.
- `zcode-proxy-src/Android-APP/` (209 MB) — not needed for Desktop/harness integration; its build path was removed (`scripts/build-android-apk.sh`, `build:android-*` npm scripts, the esbuild dev dependency, and the vendored `.github/workflows/release.yml` Android build job).
- `mcp/zcode-harness-mcp/node_modules/` — installed by `setup.mjs`.

Automated checks: [GitHub Actions](https://github.com/ZepiGit/ZCode-Agent-Kit/actions/workflows/ci.yml). Effort mapping: [EFFORT_MAPPING.md](EFFORT_MAPPING.md); its German snapshot is [EFFORT_MAPPING.de.md](EFFORT_MAPPING.de.md).
