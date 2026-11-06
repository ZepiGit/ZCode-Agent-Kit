---
status: accepted
---

# Output code: two renderers over one token set and one width core

The CLI and the proxy TUI render through two renderers that share one token set and one width core. `tokens.mjs` (glyph tiers, colour roles, verdict words) and its `.d.mts` sit beside `width-core.mjs` in `zcode-proxy-src/src/tui/`. The CLI gets `lib/term/` (Node), and the TUI keeps `frame.ts` (Bun) on the same tokens and width core. We chose this over one renderer forced to run on both runtimes because C4 prefers the existing `frame.ts`/`width.ts`, and because it follows the repo's own cross-runtime pattern (`captcha-compatibility.mjs` + `.d.mts`). It matches design-language §9 and Round 1 Q12, and it extends the design language of [ADR-0001](0001-terminal-design-language-ledger.md).

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 2, Q6 (ACCEPTED with the binding conditions below).

## Binding conditions

1. **The shared files are runtime-neutral.** Both are plain ESM, with no Node-only or Bun-only APIs and no imports from outside `tui/`. They are tested under Node and Bun (Round 1, Q12, condition 2), and `bun build --compile` bundles them for all five targets.
2. **They ship in every payload.** The pack allowlist already covers `cli/`, `lib/` and `zcode-proxy-src/src/`. `verify-payload`'s required list gains the shared files and their `.d.mts`.
3. **Rendering loads lazily.** The preflight and the lifecycle intents must not import renderers, because each preflight already costs ~70 MB (RC3, Round 1 Q6).

## Considered options

- **One output module shared by Node and Bun:** rejected. It would replace the TUI's existing renderer and force one rendering path across two runtimes, against C4.

## Consequences

- A two-way door, but every command migrated onto `lib/term/` (Round 2, Q7) raises the cost of changing the topology later.
- A token change reaches the CLI and the TUI at once; a renderer change does not.
