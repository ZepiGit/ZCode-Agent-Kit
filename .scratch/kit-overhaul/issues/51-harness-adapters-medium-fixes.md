# 51: Harness adapters: confirmed MEDIUM fixes and record refresh

**Blocked by:** 50 (Harness adapters: HIGH fixes (Continue, Kilo Code))

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: —

**What to build:** Each MEDIUM candidate (Claude Code effort/capabilities, OpenCode Flash `modalities.input`, Goose `supports_vision`, Cline CLI config path, Kilo per-model reasoning/modalities, OMP `auth: apiKey` and unsupported compat fields, pi `thinkingLevelMap`) is applied only where `research/harness-configs.md` confirms it from primary docs; UNVERIFIED items and OpenCode V1 schema left unchanged; recorded versions and `primarySource` dates refreshed only for what was re-verified.

**Acceptance criteria:**

- [ ] One fixture per applied item, byte-idempotent; a test asserts each UNVERIFIED item's output is unchanged.
- [ ] The ticket lists each candidate as applied/left with its primary-doc link.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 133, 134, 135

## Comments

### 2026-11-06 — implementer (claude-opus-5-5, logged substitute for glm-5.3-flash)

**Branch:** `ticket/51-harness-adapters-medium-fixes`. Fix commit `615aca4`, merged with integration tip `49292c4` as `fc1edf0`. This evidence commit sits on top.

**Candidates: applied or left, with the primary source each decision rests on**

| Candidate | Verdict | Change / reason | Primary source (checked) |
|---|---|---|---|
| OpenCode Flash `modalities.input` | **applied** | `glm-5.3-flash` gets `modalities: { input: [text, image], output: [text] }` in the V1 `provider.zcode` block. The V1 shape is kept. | V1 schema `anomalyco/opencode@v1.19.5` and `@v2.2.5` `packages/core/src/v1/config/provider.ts` (`modalities.input/output`, both optional); V2 migration `v2.2.5 packages/core/src/v1/config/migrate.ts:226-232`; https://opencode.ai/v2/docs/providers (2026-11-05) |
| Goose `supports_vision` | **applied** | `glm-5.3-flash` gets `supports_vision: true`. GLM-5.3 is unchanged. | `aaif-goose/goose@v1.57.0 crates/goose-provider-types/src/base.rs:275-277` (`ModelInfo.supports_vision: Option<bool>`); https://goose-docs.ai/docs/getting-started/providers/ (2026-11-06) |
| Kilo Code per-model reasoning / modalities | **applied** | The values sheet gains a per-model table with Reasoning on/on and Image off/on. The kit still writes no `kilo.jsonc`. | `Kilo-Org/kilocode@v7.8.27 packages/kilo-vscode/src/shared/custom-provider.ts:52-54` (`reasoning`, `modalities`), `webview-ui/src/i18n/en.ts:445-446` (labels "Reasoning", "Image"); https://kilo.ai/docs/code-with-ai/agents/custom-models (2026-11-06) |
| Cline documented CLI config path | **applied** | The values sheet gains `cline auth -p openai -k <local proxy key> -b http://127.0.0.1:PORT/v1 -m glm-5.3` (the key stays a placeholder). The stale "CLI not documented" rationale is corrected. The kit does not write `providers.json`, because its format is not documented. | https://docs.cline.bot/cli/cli-reference (`auth -p/-k/-m/-b`, `~/.cline/data/settings/providers.json`) and https://docs.cline.bot/cline-cli/getting-started (`openai` = OpenAI Compatible), both 2026-11-06 |
| OMP `auth: apiKey` and unsupported compat keys | **applied** | The managed block gets `auth: apiKey`. `compat` drops `supportsOutputEffort` and `injectClaudeCodeInstruction` and keeps `supportsContextManagement` and `replayUnsignedThinking`. `thinking` is unchanged. | `can1357/oh-my-pi@v18.16.0 docs/models.md:212` (OAuth-style shaping when `auth` is omitted) and `:965-972` (honored `AnthropicCompat` keys; `applyCompatOverrides` drops the rest) |
| Claude Code effort / capabilities | **left** | `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES` is documented for third-party providers (Bedrock, Agent Platform, Foundry). For an `ANTHROPIC_BASE_URL` gateway the docs name only `_NAME` and `_DESCRIPTION`. `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1` is documented for gateways, but Claude Code would then send its own levels (`low/medium/high/xhigh/max`). The proxy passes native `/v1/messages` effort unchanged (`zcode-proxy-src/src/proxy/body-transformer.ts:66-72`), and only `low/high/max` are verified for glm-5.3 (`provider/types.ts:30-35`, `provider/models.ts:15-18`). Turning it on would send unverified values to the gateway on a live-tested harness. The adapter carries a comment with this reason. | https://code.claude.com/docs/en/model-config ("Customize pinned model display and capabilities") and https://code.claude.com/docs/en/env-vars (`CLAUDE_CODE_ALWAYS_ENABLE_EFFORT`), both 2026-11-05/06 |
| pi `thinkingLevelMap` | **left** | The format is confirmed, but on `anthropic-messages` pi sends the mapped values only with `compat.forceAdaptiveThinking` (`earendil-works/pi@v1.5.0 packages/ai/src/api/anthropic-messages.ts:974-983`). Otherwise it sends a budget and clamps `xhigh`/`max` to the `high` budget (`packages/ai/src/api/simple-options.ts:71-85`). A mapped `max` would be the `high` request under another name. Adaptive thinking without a budget is the "effort label alone" case the proxy documents as near-zero thinking (`provider/reasoning.ts:4-10`). The false header claim ("verified … via thinkingLevelMap") is corrected (comment only). | `earendil-works/pi@v1.5.0 packages/coding-agent/docs/models-configuration.md:37` (`thinkingLevelMap`), `packages/ai/src/models.ts:1261-1270` (supported levels) |
| UNVERIFIED: `claude mcp add` syntax, Codex fallback metadata, OpenCode mixed V1/V2, Continue `defaultCompletionOptions`, Cline reasoning value | **left** | Q18 condition 1. A test pins each one's output to the tip's bytes or argv. | `research/harness-configs.md` drift tables |
| OpenCode V2 schema | **left** | Q18; V1 is still accepted and migrated. | as above |

**Record refresh (`primarySource`, only what the research re-verified):** claude-code (llm-gateway, 2026-11-05), codex (now `config-reference`, 2026-11-04, "codex 0.166.0: wire_api=responses is the only supported value"; the stale 0.153.4 note is gone), opencode (`/v2/docs/providers`, 2026-11-05), aider (2026-11-05), continue (`/reference`, 2026-10-26), goose / kilo-code / cline (2026-11-06), omp (now `oh-my-pi@v18.16.0 docs/models.md`, 2026-11-06), pi (now `earendil-works/pi … models-configuration.md`, 2026-11-06). Nothing reads `primarySource` at runtime (grep). The recorded harness versions in `MANIFEST*` / `SUPPORT_MATRIX.json` belong to ticket 53 (its scope names them); not touched here.

**Tests (seam 8, `tests/adapter-audit.test.mjs`, already wired into `npm run test`; +8 tests)**
Each "before" fixture is the byte-exact file the tip (`3773b47`) wrote, captured with a scratch run of `zcode-kit integrate <id>`. `refreshCycle` drives the real CLI against a temp HOME and a pre-seeded state dir with `.owner.json` (port 19500; nothing listens). It runs integrate, a second integrate (byte-idempotent), `rollback <tx>` (byte-exact restore) and a replay after rollback (same bytes).
1. OpenCode Flash modalities; GLM-5.3 untouched; the variants are kept; no V2 `providers` key written.
2. Goose `supports_vision` on Flash only.
3. Kilo per-model Reasoning/Image rows, starting from the post-ticket-50 sheet; no key in the sheet.
4. Cline CLI command with the `/v1` base URL; the extension table is kept unchanged; no key in the sheet.
5. OMP `auth: apiKey`; compat reduced to the honored keys; thinking, models and the literal key unchanged.
6. The next `setup --harness opencode,goose,kilo-code,cline,omp` refreshes all five in one transaction; a second setup is byte-idempotent; rollback restores all five pre-fix files.
7. Unchanged guard: the Claude Code settings, pi `models.json` and Codex `config.toml` are byte-identical to the tip (win32 variant included). A user's V2 OpenCode `providers` block keeps its bytes and gets nothing merged in. The Continue kit models have no `defaultCompletionOptions`. The Cline sheet has no reasoning or effort value.
8. Unchanged guard (POSIX; a fake `claude` on PATH in the fixture): `setup --harness claude-code` calls `claude mcp add zcode-harness --scope user -- node … --stdio`. The guard asserts only the syntax prefix and the trailing `--stdio`, so ticket 36's bridge flag does not break it.

**RED → GREEN**
- Per slice, the new test ran alone first (`reports/t51-red1..5.log`). OpenCode: `actual: undefined, expected: { input: [text, image], output: [text] }`. Goose: `supports_vision` missing. Kilo: no model rows (`actual: []`). Cline: no `cline auth` line. OMP: `auth` `actual: undefined`. Then GREEN (`t51-green1..6.log`).
- Whole file on the tip's adapters (`git stash -- cli/`): 16 tests, 6 fail (all applied-item tests incl. setup), 10 pass (`t51-red-tip.log`). With the fix: 16/16 (`t51-green-file.log`).
- The unchanged guards pass on the tip by construction, so they were checked with mutants. Adding `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` and changing `--scope` to `-s` failed both guards (`t51-mutant1.log`). Adding a pi `thinkingLevelMap` failed guard 7 (`t51-mutant2.log`). All mutants were reverted.

**Full suite after merging the integration tip** (Bun 1.4.2, because ticket 11 is not merged)
- `npm run test`: 314 tests, 303 pass, 0 fail, 11 skipped (the Windows-only skips). Log: `t51-full-kit.log`.
- `npm run test:proxy`: 1303 pass, 0 fail, 89 files. Log: `t51-full-proxy.log`.
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped. `git status` was clean after the build, so `dist/` is byte-identical. Log: `t51-full-mcp.log`.

**Metrics / snapshots:** none. The adapters are not on a memory-loop path, and this ticket has no expected-RED entry or snapshot suite.

**Common acceptance**
- RED → GREEN at seam 8: ✓.
- No new test files (added to the wired `adapter-audit`).
- Pre-existing tests: no assertion changed. The `existingInstall` helper now also returns its `env`, which the fake-`claude` test needs; additive only.
- No new log events, config keys or env overrides.
- The windows leg and the `memory-budget` job are **pending CI** (orchestrator verifies after merge and push). The fixtures use `USERPROFILE`/`APPDATA`, and the Codex and Goose expectations carry the win32 variants. The `claude mcp add` guard is skipped on win32 (POSIX fake executable).

**Decisions taken**
- Claude Code and pi are left, with the evidence above. The research confirmed the drift, but in each case applying the candidate fix would claim effort levels the proxy path does not deliver, or send unverified ones. Story 134 and Q18 ("the kit does not guess") take precedence. Follow-up candidate (not this ticket): a proxy-side normalisation of native `/v1/messages` `output_config.effort` (`medium` → `high`, `xhigh` → `max`, paired with the catalog budget) would make `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1` safe. It needs a live probe first.
- OpenCode `modalities.output: [text]` is written next to `input`. Both are optional in the V1 schema, and the V2 migration fills a missing side from defaults, so writing `output` is the explicit form of the same value.
- Low drift is left as spec §Out of scope says, even where this ticket touches the file: the Kilo sheet's "Models can also be auto-fetched from /v1/models" (false for `@ai-sdk/anthropic`), the Kilo header's "kilo.jsonc … documented only sparsely", the OpenCode header's "%APPDATA%/opencode on Windows", OMP's stale "`!node` not evaluated" comment, Goose `reasoning: true`, `ANTHROPIC_SMALL_FAST_MODEL` (deprecated), and `PI_CODING_AGENT_DIR` / OMP profiles. The owner may want the false Kilo auto-fetch line fixed in a Low follow-up.
- **For ticket 53 (docs):** image flags changed. OpenCode Flash now declares image input, Goose Flash `supports_vision`, and the Kilo sheet the per-model Image/Reasoning toggles. The Cline sheet documents the CLI path, and OMP now uses `auth: apiKey`. No effort levels changed: OMP thinking is untouched, and Claude Code and pi were left. `harnesses/README*` should mention these, and `EFFORT_MAPPING*` needs no change. The `MANIFEST*` recorded versions (OMP 18.1.18 → 18.16.0, Claude Code 2.1.269 → 2.1.318, Codex 0.153.4 → 0.166.0) and `SUPPORT_MATRIX.json` `primarySource`/`sourceChecked` (pi now `earendil-works/pi`, OMP docs path) are 53's.
