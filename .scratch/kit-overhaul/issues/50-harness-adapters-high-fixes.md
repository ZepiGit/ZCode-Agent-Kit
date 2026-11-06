# 50: Harness adapters: HIGH fixes (Continue, Kilo Code)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: —

**What to build:** Continue writes `capabilities` as a string array (`tool_use`, `image_input`); Kilo Code's Anthropic base URL gets `/v1`. Existing users get them on the next `setup`/`integrate` through the transaction with rollback, idempotently.

**Acceptance criteria:**

- [ ] `adapter-audit` fixtures: new shape, byte-idempotent on a second run, rollback restores the old file (seam 8).
- [ ] Adapter-refresh migration replayed twice.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 131, 132, 135

## Comments

### 2026-11-06 — implementer (claude-opus-5-5, logged substitute for glm-5.3-flash)

**Branch:** `ticket/50-harness-adapters-high-fixes`. Fix commit `c98660d`, merged with integration tip `e96c86f` as `c7d5506`. This evidence commit sits on top.

**Change**
- `cli/adapters/continue.mjs`: the managed models write `capabilities: [tool_use]` / `capabilities: [tool_use, image_input]` (Continue `modelCapabilitySchema.array()`), replacing `{ toolUse: true[, imageInput: true] }`.
- `cli/adapters/kilo-code.mjs`: the values sheet's Base URL is `http://127.0.0.1:PORT/v1` (`@ai-sdk/anthropic` appends `/messages`; the proxy routes `/v1/messages`). The "no /v1 suffix" note now gives the correct reason.
- Migration: no separate migration code. Both adapters already rewrite the kit-owned block or sheet on every `setup`/`integrate` through `commitFile` and the transaction, so the stale shape is replaced on the next run and recorded for rollback.

**Tests (seam 8, `tests/adapter-audit.test.mjs`, already wired into `npm run test`)**
Each fixture is a temp HOME plus an isolated `ZCODE_KIT_STATE_DIR` that already has `.owner.json`, a proxy key and a config on port 19500 (my range; nothing listens). It starts from the byte-exact files the pre-fix kit wrote and drives the real `zcode-kit` CLI:
1. `integrate continue`: the kit models get the string arrays, a user model's own `capabilities` map stays byte-identical, and the managed block has no map form left. A second integrate prints "already up to date" and the bytes are identical. `rollback <tx>` restores the pre-fix file byte for byte, and replaying the migration afterwards gives the same bytes again.
2. `integrate kilo-code`: the Base URL row is `…:19500/v1`, the "no /v1 suffix" text is gone and the sheet carries no key. It is byte-idempotent on a second run, rollback restores the old sheet, and a replay gives identical bytes.
3. A plain `setup` for an existing user with stored `configured` decisions for continue and kilo-code (Kilo detected via a fake `~/.vscode/extensions/kilocode.kilo-code-*` dir). Both files are refreshed in one transaction, a second setup is byte-idempotent, rollback restores both pre-fix files, and VS Code state is only read.

**RED → GREEN**
- Each new test was first run alone at its slice (logs `reports/t50-red1.log` and `t50-red2.log`). Continue failed with `actual: [ … [Object] … ] expected: [ … [Array] … ]`, and Kilo with `actual: 'http://127.0.0.1:19500' expected: 'http://127.0.0.1:19500/v1'`. Both passed after the fix (`t50-green1.log`, `t50-green2.log`, `t50-green3.log`).
- Whole file with the tip's adapters restored from stash: 3 fail / 5 pass, and all three new tests fail (`t50-red-tip.log`). With the fix: 8/8 pass.

**Full suite after merging the integration tip** (Bun 1.4.2, because ticket 11 is not merged)
- `npm run test`: 301 tests, 290 pass, 0 fail, 11 skipped (the Windows-only skips, as in the baseline). Log: `t50-full-kit.log`.
- `npm run test:proxy`: 1288 pass, 0 fail, 88 files. Log: `t50-full-proxy.log`.
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped. `git status` was clean after the build, so `dist/` is byte-identical. Log: `t50-full-mcp.log`.

**Metrics / snapshots:** none. The adapters are not on a memory-loop path, `tests/memory/` is not on the tip yet, and no snapshot suite exists yet. There is no expected-RED entry for this ticket.

**Common acceptance**
- RED → GREEN at seam 8: ✓.
- New test files: none. The tests were added to the already-wired `adapter-audit`.
- Pre-existing tests: none changed.
- No new log events, config keys or env overrides.
- The windows leg and the `memory-budget` job are **pending CI** (orchestrator verifies after merge and push). The fixtures use `USERPROFILE`/`APPDATA`/`LOCALAPPDATA` and the lowercase Windows owner identity. Template literals normalise CRLF, so the byte comparisons hold under autocrlf.

**Decisions taken**
- Test isolation: the state dir is pre-seeded with a matching `.owner.json`. Otherwise `ensureState` would migrate (copy) the checkout's own `.proxykey`, `generated/` and `backups/` into the fixture.
- `primarySource` dates and recorded versions are not refreshed here. Ticket 51 owns the record refresh ("refreshed only for what was re-verified").
- Low-severity Kilo drift is left as is. The sheet note "Models can also be auto-fetched from /v1/models" is false for `@ai-sdk/anthropic`, and the header comment "kilo.jsonc … documented only sparsely" is stale. Spec §Out of scope excludes Low drift. Flagged for ticket 51 if it touches the Kilo sheet anyway.
- `kilo-code.apply` still returns `changed: true` on a no-op run (pre-existing). The bytes are idempotent because `commitFile` skips identical content, and C2 keeps the return and log unchanged.
- Docs: `harnesses/README*` and `EFFORT_MAPPING*` name neither the Continue capability keys nor the Kilo base URL, so no doc change is needed (Q18 cond. 3).
- Noted but left: the generic setup "Connection details" print the Anthropic base URL as the proxy root plus "(POST /v1/messages)". That is correct for clients that append `/v1/messages` (Claude Code), so it is not the Kilo defect.
