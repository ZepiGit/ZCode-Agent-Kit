# 68: Every writer of proxy/config.yaml and harness configs keeps the file's line endings (CRLF audit)

**Blocked by:** 42 (Account Rotator decision asked once, with migration)

**Status:** ready-for-agent

Model: sol
Risk: medium
ADR: no

**What to build:** Ticket 42 round 3 found that `configureAccountRotator` rewrote a CRLF `proxy/config.yaml` with mixed line endings (10 CRLF, 56 bare LF on the example config) because it wrote back what the yaml library renders; fixed in 04dfbaa by writing the file back with its own line endings. Real Windows configs are CRLF (installers, editors, git autocrlf). Audit every other place the kit reads-modifies-writes a user-owned text file: the harness adapters (cli/adapters/*, including Continue/Kilo/OMP/pi/Codex/Claude configs), upstream-config, `bootstrap`'s copy of config.example.yaml, the transaction/rollback mechanism, update's config migration. For each: does a CRLF input come back CRLF (or the file's majority ending), byte-identical on a no-op replay, with no duplicated keys? Fix the writers that fail, sharing one helper with ticket 42's (do not add a second line-ending policy).

**Acceptance criteria:**

- [ ] A table of every writer with its verdict (ok / fixed), in Comments.
- [ ] One CRLF fixture test per fixed writer, RED first; a no-op replay on CRLF is byte-identical for every writer.
- [ ] One shared line-ending helper; mutation proof.
- [ ] Full suites green; windows test-kit legs green (pending CI).

## Comments

### 2026-11-07 — implementer (branch `ticket/68-crlf-config-writers`)

**Base and commits.** Built on `ticket/42-account-rotator-asked-once` (`99310eb`), plus the integration tip (`ba7a55b` merges `48dd754`). `ea84a63` holds the product fix and the tests. The head SHA is the commit that adds this comment. **Ticket 42 has not landed on `overhaul/stability-terminal-ux` yet** (`99310eb` is not an ancestor of `48dd754`). This branch carries 42's commits, so merging it brings them along: merge 42 first.

**The helper.** `lib/line-endings.mjs` exports `lineEndingOf(source)` and `withLineEndingsOf(source, text)`. It is ticket 42's `withLineEndingsOf`, moved out of `cli/account-setup.mjs`, and `account-setup` now imports it. The policy is unchanged: CRLF when CRLF breaks outnumber bare LF breaks, else LF; a new or empty file and a tie count as LF.
- One correction: 42's bare-LF pattern `(?:^|[^\r])\n` counted a run of blank lines at half (`\n\n\n\n` counted 2). It is now `(?<!\r)\n`. This only matters for mixed files.
- The proxy builds from `zcode-proxy-src` alone (its Dockerfile), so it cannot import `lib/`. Following the event-line precedent (ADR-0010/0011), it keeps a byte-identical copy at `zcode-proxy-src/src/config/line-endings.mjs`, plus a `.d.mts` for tsc. A test fails when the two copies differ.
- **Granularity.** Writers that splice text into the file (Continue, OMP models.yml, JSONC, `.git/info/exclude`) convert only the inserted fragment, so the user's bytes outside the edit stay as they are. Writers that re-render the whole document (yaml or JSON) convert the whole text, as 42 did. `ensureDeviceMidInConfig` also converts the whole text, which keeps the B1 diff to one line. LF files come out exactly as before (C2).

**Writer table** (every read-modify-write of a user-owned text file, plus creators and copiers; found by grepping `writeFileSync|renameSync|copyFileSync|cpSync|commitFile|Bun.write` over `cli/ lib/ proxy/ setup.mjs zcode-proxy-src/src mcp/*/src scripts/ install.*`):

| # | Writer | File | CRLF before | Verdict | Evidence |
|---|---|---|---|---|---|
| 1 | `configureAccountRotator` (setup answer, `accounts enable/disable`; also update's config migration via the setup re-run) | `proxy/config.yaml` | fixed in 42 (`04dfbaa`) | ok (fixed in 42; now uses the shared helper) | `tests/account-setup.test.mjs` 3 CRLF tests; mutation M2 |
| 2 | heal `alignOfflineKey` (`doctor --fix`) | `proxy/config.yaml` | key line lost its CR (1 bare LF) | **fixed**: the match no longer takes the CR, so no ending policy is needed (the edit has no line break) | `doctor --fix aligns the key…` |
| 3 | `bootstrap` / `ensureRuntimeFiles`: create from `config.example.yaml` | `proxy/config.yaml` | creates it with the example's own bytes; an existing file is never rewritten | ok | `bootstrap creates proxy/config.yaml…` (pin, M7) |
| 4 | `bootstrap` `ensureLocalGitExclude` (checkout installs) | `.git/info/exclude` | LF block appended to a CRLF file | **fixed** (fragment) | `bootstrap appends the kit excludes…` |
| 5 | Continue adapter | `~/.continue/config.yaml` | LF managed block in a CRLF file (block list, `models: []`, no models key) | **fixed** (fragment; the header-local newline detection is replaced by the one policy). `verify()` also read a CRLF block as stale and is fixed. | 3 tests, M8 |
| 6 | OMP adapter, managed block | `~/.omp/agent/models.yml` | LF block | **fixed** (fragment) | `setup keeps CRLF OMP…` |
| 7 | OMP adapter `editConfigYaml` | `~/.omp/agent/config.yml` | yaml render: mixed | **fixed** (document) | same test |
| 8 | setup `integrateMcp` (OMP) | `~/.omp/agent/mcp.json` | JSON re-render: all LF | **fixed** (document) | same test |
| 9 | pi adapter (`setTopLevelKey` + final newline) | `~/.pi/agent/models.json` | LF value span in a CRLF file | **fixed** in `lib/jsonc.mjs` (fragment) plus `withFinalNewline` | `integrate keeps a CRLF pi…` |
| 10 | OpenCode adapter (same JSONC path) | `opencode.json(c)` | same (provider key, no provider key, no final newline) | **fixed** | 3 tests |
| 11 | Goose adapter (merge with the user's keys) | `custom_providers/zcode.json` | JSON re-render: all LF | **fixed** (document) | `integrate keeps a CRLF Goose…` |
| 12 | Codex, Claude Code, Aider, Cline, Kilo Code | `generated/*` (kit state) | not user-owned; regenerated whole from template literals (always LF, also on a CRLF checkout); a replay is a no-op through `commitFile`'s byte comparison | ok (n/a) | existing idempotence tests |
| 13 | OMP extension | `~/.omp/agent/extensions/zcode-proxy-autostart.ts` | kit-owned, rendered from the checkout's template bytes; replay compares bytes | ok (n/a) | `setup-regressions` idempotence |
| 14 | harness-choice / rotator-decision / transaction manifests, state migration manifests | kit state JSON | kit-owned | ok (n/a) | — |
| 15 | transaction backup, `restoreSince`, `rollback` | any recorded file | byte copies (`copyFileSync`, Buffer `readFileSync`) | ok | `rollback restores a CRLF user config…` (pin, M5) |
| 16 | `update`: `mirrorTree` (release), installers' robocopy/rsync | `proxy/config.yaml`, `.proxykey` | excluded from the mirror | ok | `update mirrors a release…` (pin, M6) |
| 17 | `update` config migration | `proxy/config.yaml` | it is the setup re-run, which is row 1 | ok | row 1 |
| 18 | state migration (`lib/state.mjs`) | the whole state dir | `cpSync` byte copy | ok | — |
| 19 | proxy `updateConfigYaml` (TUI or control provider/plan switch) | `config.yaml` | yaml render: mixed | **fixed** (document) | bun `config writers keep a CRLF config CRLF > updateConfigYaml` |
| 20 | proxy `updateAccountPolicyYaml` (exported, no caller today) | `config.yaml` | yaml render: mixed | **fixed** (document) | bun `…> updateAccountPolicyYaml` |
| 21 | proxy `ensureDeviceMidInConfig`: fill an empty `deviceMid: ""` (the kit template's case) | `config.yaml` | the line break stays outside the match | ok | bun `…when it fills an empty deviceMid` (passes on the tip) |
| 22 | proxy `ensureDeviceMidInConfig`: insert under `identity:`, append `identity:` | `config.yaml` | LF lines, and the `identity:` line lost its CR | **fixed** (document) | bun `…inserts under identity:`, `…appends identity:` |
| 23 | proxy `ensureConfigFile` | `config.yaml` | creates from the bundled template only when missing | ok | existing test |
| 24 | `scripts/verify-golden-path.mjs`, MCP task store, proxy credential/account stores, captcha cache, manager pid/lock/respawn files | own temp or state files | not user-owned | ok (n/a) | — |

**RED → GREEN.**
- Each slice went RED before its fix: logs `t68-red-continue`, `t68-red-omp{,2,3,4}` (models.yml, then config.yml, then mcp.json), `t68-red-jsonc`, `t68-red-goose`, `t68-red-heal`, `t68-red-exclude`, `t68-red-proxy`. The assertion was always `no bare LF in the rewritten CRLF file`, and for the proxy, bare-LF counts of 2, 2, 12 and 15.
- Combined proof `t68-red-tip`: the product files were restored from `ea84a63~1`, keeping the tests and the helper.
  - Kit: 12 of 17 fail. The 5 that pass are the helper vectors, the copy guard and two pins.
  - Bun: 4 fail (insert, append, updateConfigYaml, updateAccountPolicyYaml).
  - The rollback pin also failed there, but only because its fixture is the Continue write.
- GREEN: `t68-crlf-all` 17/17; the proxy files 24/24.

**The contract each kit test checks.** The same user file is run once as LF and once as CRLF, with the same command (`integrate <id>`, `setup --harness omp`, `repairManaged`, `bootstrap`). It passes when:
- the CRLF result equals the LF result with CRLF breaks (fixture paths anonymised);
- the CRLF result has no bare LF;
- keys and managed blocks appear exactly once;
- the CRLF write was recorded as a transaction;
- a replay leaves every CRLF file byte-identical and records no transaction.

**Mutation proofs** (`t68-mutants`; committed tree, restored with `git checkout ea84a63 -- <file>`; `git status` clean afterwards):
- M1, the helper always returns LF (both copies): 13 kit and 7 bun tests fail, covering every CRLF writer except heal, whose fix uses no helper.
- M2, the helper always returns CRLF: 17 kit tests fail (including 42's three rotator tests and adapter-audit's LF Continue test) and 9 bun tests (including the existing LF deviceMid tests).
- M3, 42's bare-LF count: the blank-line-run vector fails under Node and Bun.
- M4, the two copies differ: the guard fails.
- M5, rollback restores through a CR-dropping text round trip: the rollback pin fails.
- M6, the mirror no longer preserves `config.yaml`: the update pin fails.
- M7, bootstrap writes the example as LF: the bootstrap pin fails.
- M8, Continue's `verify()` compares the CRLF block byte for byte: the 3 Continue tests fail.

**Suites** (head after the merge; Node 26.7.0, Bun 1.4.2):
- `npm run test`: 806 tests, 787 pass, 0 fail, 19 skipped.
- `npm run test:proxy`: 1350 pass, 0 fail.
- `npm run test:proxy-typecheck`: exit 0.
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged.
- `npm run test:ux-before`: 1/1.
- `bun build --compile --target bun-linux-x64` bundles the `.mjs` import (649 modules; the binary runs `--help`).

**C2 / B1 / B3.**
- No existing test changed. The only fixture change is that `package.json` wires `tests/crlf-writers.test.mjs`.
- LF behaviour is byte-for-byte as before, pinned by the existing suites and by M2.
- The deviceMid and account-policy writes (B1 identity / account rotator) change only line-break bytes: values, generation, timing and reads are untouched.
- Every fixture is a temp HOME with an isolated state dir created with `.owner.json` first. Ports: 19680 and 19681 (a bind in the heal test) and 19682/19689 (written into files only).

**Decisions.**
1. Two byte-identical copies instead of one file, because the proxy's Dockerfile builds from `zcode-proxy-src` alone and many kit fixtures copy only `cli/` and `lib/`. This is the event-line precedent.
2. Splices convert the fragment and re-renders convert the whole document. It is one policy applied at the edit's own granularity, and it keeps jsonc.mjs's promise that bytes outside the edit are untouched.
3. Heal's fix uses no helper, because its edit carries no line break.
4. `.git/info/exclude` is included, as the user's file in a checkout install.
5. The new files are not added to verify-payload's required list: `lib/` and `zcode-proxy-src/src/` are already allowlisted, and event-line was not listed either.

**Left for another ticket.** `ensureDeviceMidInConfig`'s reader `^(\s*)deviceMid:\s*(.*)$` crosses a line break. On a config with an empty unquoted `deviceMid:`, it returns the next line's text as the device mid: `identity:\n  deviceMid:\n  appVersion: "3.8.1"` gives `appVersion: "3.8.1`, which then becomes X-Device-Mid. This is B1 identity, so it is not changed here. The kit template writes `deviceMid: ""`, which is unaffected.

**Pending CI (orchestrator verifies after merge+push):**
1. windows `test-kit` (Node 24 and 26): `tests/crlf-writers.test.mjs` on a CRLF checkout. Specifically:
   - the Goose path under `HOME/AppData/Roaming`;
   - path anonymisation with backslash and JSON-escaped roots;
   - the heal test's exclusive bind on 19681;
   - the byte-identical copy guard after autocrlf.
2. windows `test-kit`: 42's three CRLF rotator tests, now on the shared helper.
3. The proxy legs (`bun test`, typecheck) on every OS, including `src/config/line-endings.test.ts`, and the `bun build --compile` matrix for all five targets.
4. ubuntu and windows `test-kit`: the unchanged LF suites (adapter-audit, setup-regressions, continue-compatibility, auto-heal).
