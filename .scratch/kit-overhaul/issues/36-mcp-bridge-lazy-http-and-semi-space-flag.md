# 36: MCP bridge: lazy HTTP transport and `--max-semi-space-size=1` in generated entries

**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0013 (consequences)

**What to build:** The bridge imports its HTTP transport lazily (HTTP mode unchanged). Generated harness MCP entries put `--max-semi-space-size=1` on the bridge command line, never in `NODE_OPTIONS`. Existing harness configs are updated on the next `setup`/`integrate` through the transaction, idempotently.

**Acceptance criteria:**

- [ ] Seam 7: HTTP mode tests unchanged; `test:mcp` green with the flag (build-time gate 6).
- [ ] Seam 8: the flag in every generated entry; bridge-flag migration replayed twice is a no-op; rollback restores the old entry.
- [ ] Loop: S3 bridge role peak ≤ 75 MB (baseline 86); S5 within budget.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 34, 135

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 15): the "Loop: S3 bridge role peak ≤ 75 MB" criterion binds 36 on its own evidence, while ticket 37 holds the `procPeak:mcp-bridge` names in `expected-red.json` (Q1 condition 2, several claimants: 37 is the descendant). 36 removes no names; if 36 lands with the bridge peak still RED, it comes back with the numbers (Round 15 Shared understanding).

- 2026-11-08 (implementer, branch `ticket/36-mcp-bridge-lazy-http`, code head dd89d17 = 580b237 + harness docs f35cc9b + integration tip 8e11d15 merged). Linux x64, Node 26.7.0, Bun 1.4.2.

  **What changed.**
  - `mcp/zcode-harness-mcp/src/mcp/server.ts`: the HTTP stack (`node:http`, the SDK's `streamableHttp.js`, hono) is imported once inside `serveHttp`, before it listens. A missing module still fails at start, and no request pays for the import. The transport class is passed down to the POST handler. `serveHttp` / `serveStdio` keep their signatures, and `dist/` comes from `npm run build` (B5).
  - `lib/mcp-bridge.mjs` (new) holds the flag list and the args `node --max-semi-space-size=1 <kit>/mcp/zcode-harness-mcp/dist/index.js --stdio`, plus the ownership helpers.
  - All three generated entries now use those args: OMP `mcp.json` (`cli/commands/setup.mjs`), the Claude Code `claude mcp add` (setup), and Codex `config.toml` (`cli/adapters/codex.mjs`). There is no `env` block and no `NODE_OPTIONS`.
  - Migration on the next setup, through the transaction:
    - OMP and Codex are rewritten, and rollback restores them byte for byte.
    - Claude Code gets `claude mcp remove` + `add` with the flag.
  - Whose entry it is is now decided on the script argument (`bridgeScriptOf`), not `args[0]`, so a flagged entry of another kit copy stays untouched.
  - The bridge test client (`test/integration/client.mjs`) starts the bridge with the same flags by default (`BRIDGE_NODE_FLAGS`, held equal to the kit's list by a kit test), so `test:mcp` runs as the entries start it. The HTTP-mode tests spawn the bridge themselves and are unchanged.
  - The S3 fake session (`tests/memory/fixtures/fake-session.mjs`) starts its bridge with the flags.
  - `harnesses/README` × 5: the MCP row and the OMP `mcp.json` example show the flag. These are code literals only, so parity holds.

  **Tests, RED → GREEN.**
  - Seam 7, `test/integration/startup-footprint.test.mjs` (new, wired into `test:mcp`). A preload (`test/fixture/module-trace.mjs`, `module.registerHooks`) records every module URL the bridge process resolves and its execArgv.
    - "stdio mode loads no HTTP transport module" was RED on the tip: `streamableHttp.js`, `webStandardStreamableHttp.js`, `@hono/node-server` ×2, `hono/…/websocket`, `node:http` (`reports/t36-red1.log`). It is GREEN after the change.
    - "flag on the command line, never in NODE_OPTIONS" and "HTTP mode loads the transport at start and serves MCP" are guard tests.
    - `http-gate` passes unchanged.
  - Seam 8, `tests/adapter-audit.test.mjs` (+7 tests). On the tip, 6 were RED (`reports/t36-red2.log`): the kit/client flag agreement, the flag in every generated entry, the OMP + Codex migration replayed twice plus rollback, a flagged OMP entry of another copy (the warning named the flag, not the script), the Claude Code re-registration replayed twice, and the failed flagged add restoring the old registration. The 7th, a flagged Claude Code entry of another copy, is a guard. All 7 are GREEN.
  - Mutations on committed 580b237, each restored with `git checkout 580b237 -- <file>` and a clean diff after (`/home/AgentKit/overhaul-tools/t36-scripts/mutate.py`, `reports/t36-mut-*.log`). All 7 were killed:
    - M2: client without the flag;
    - M3: ownership by `args[0]`;
    - M4: no restore after a failed add;
    - M5: always re-register;
    - M6: flag in `NODE_OPTIONS`;
    - M7: Claude `Args:` flags not parsed;
    - M8: Codex without the flag.
    - A `dist/` mutant was not run (B5); the RED on the tip covers eager HTTP loading.

  **Pre-existing test changed (justified).** `adapter-audit` "integrate leaves UNVERIFIED and not-applied adapter output byte-identical to the tip" pins the whole Codex `config.toml`. Its `args` line now carries the flag, because that line is this ticket's change. Nothing else in the pin moved.

  **Full suite** on dd89d17 after merging the integration tip (`reports/t36-full-*.log`):
  - `npm run test`: 823 tests, 804 pass, 0 fail, 19 skipped (+7);
  - `test:proxy`: 1384 pass, 0 fail (92 files);
  - `test:proxy-typecheck`: clean;
  - `test:mcp`: 100 tests, 99 pass, 0 fail, 1 skipped (+3);
  - `git status` is clean after the `test:mcp` build;
  - Node 24.22.2: `startup-footprint` + `bridge` 39/39 and `adapter-audit` 25/25 (`reports/t36-node24-*.log`).

  **Memory loop, Linux short profile** (`job.mjs --os linux --only <key>`, systemd cap 5G). Frozen detached trees: tip `0b14839` and branch `580b237`, plus a no-flag arm (`580b237` with the client's flag list emptied, lazy HTTP only). The arms alternate. Run dirs: `/home/AgentKit/overhaul-tools/t36-memloop/`; logs: `reports/t36-memloop-*.log`.

  S3/short, bridge role peak (budget 75):

  | pair | tip procPeak:mcp-bridge | branch | tip / branch peak:kit |
  |---|---|---|---|
  | 1 | 86.7 RED | **74.3 ok** | 855.7 / 792.9 MB |
  | 2 | 86.2 RED | **73.4 ok** | 856.2 / 793.8 MB |
  | 3 | 87.1 RED | **73.9 ok** | 855.3 / 794.6 MB |

  - The bridge peak is ≤ 75 MB in 3 of 3 runs (−12.8 MB), with 0.7–1.6 MB of margin. The kit peak drops about 62 MB (5 bridges).
  - S3/short stays RED on `peak:kit` and `procPeak:launcher` (37's), so the ratchet holds (rc 0). That is true under today's list and under 67's owners map: an owned check may be GREEN while the run is RED on owned checks. 36 removes no names (Round 15).

  S5/short, growth:mcp-bridge (budget 5 %/1k):

  | arm | growth %/1k (trend) | slope MB/1k | mean MB | procPeak MB | empty → 400 tasks → reboot MB |
  |---|---|---|---|---|---|
  | tip 1 | 41.60 (true) | 38.77 | 93.2 | 100.0 | 86 → 97 → 88 |
  | branch 1 | 42.32 (true) | 36.26 | 85.7 | 91.5 | 74 → 88 → 74 |
  | tip 2 | 38.65 (true) | 35.80 | 92.6 | 101.1 | 86 → 93 → 89 |
  | branch 2 | 44.14 (true) | 37.84 | 85.7 | 91.9 | 73 → 88 → 74 |
  | tip 3 | 41.62 (true) | 38.85 | 93.4 | 101.7 | 85 → 93 → 89 |
  | branch 3 | 44.32 (true) | 37.75 | 85.2 | 91.2 | 73 → 87 → 74 |
  | no-flag 1 | 42.83 (true) | 36.82 | 86.0 | 93.1 | 79 → 86 → 82 |
  | no-flag 2 | 45.03 (true) | 38.73 | 86.0 | 93.9 | 79 → 85 → 82 |

  - **The semi-space flag does not move S5's growth.**
    - The absolute slope is unchanged: tip median 38.77 MB/1k, branch 37.75, no-flag 37.8.
    - The relative growth rises by +2.70 at the median (3 of 3 pairs higher: +0.72, +5.49, +2.70). That comes only from the lower base: lazy HTTP drops the mean under load from 93 to 86 MB, and the % is taken against the mean.
    - Lazy HTTP alone gives the same mean (86.0) and the same growth (42.83 / 45.03) as with the flag.
    - The flag's own effect is on the idle level only: empty RSS 79 → 73–74 MB, peak about −2 MB.
  - Every run is RED on `growth:mcp-bridge` only. procPeak drops from 100–101.7 to 91.2–91.9 MB (budget 150). Reboot cost goes from 2–4 MB to 0 MB (no-flag 3), against a budget of 20. There are 0 task failures and 0 orphans. The run stays listed under `S5/short → 30`, the ratchet holds (rc 0), and `expected-red.json` is untouched.
  - **For ticket 30 (Round 13 "attribute first"):** the climb is not V8 young-generation sizing. With semi-space at 1 MB the slope is the same, about 36–39 MB per 1k tasks, so it is retained memory (old space or native). 30's retention work is still the place to look.
  - **For ticket 66 / the windows unstable band:** if windows commit shows the same base drop (×1.09 on the %), today's windows values (28 runs, mean 19.04, max 26.24, before 13's shift) would move to about 20.7 / 28.6. With 13's measured shift (+9 % on Linux) compounding, the projected max is about 31, which is above the bound of 30. A windows S5/short run above 30 fails as a step change. The pre-merge CI must show it; nothing here edits the band.
  - Run s5-tip-3 was killed from outside at 03:52:46: its inner run scope ended with 7.5 s CPU, available RAM was 75 %, and no t36 command did it. The outer job then produced nothing until my background shell was stopped at 04:38. It was rerun as s5-tip-3b; the table shows the rerun. Other tickets' memory loops (t24 S2) ran on the machine during some of the arms. The alternation spreads that over both arms.

  **Acceptance.**
  - Seam 7 ✓.
  - Seam 8 ✓ for OMP and Codex. Claude Code: see decision 1.
  - Loop: S3 bridge peak ≤ 75 ✓ (Linux). "S5 within budget" is ✗ on growth, as before (30's; the flag does not move it). procPeak, reboot cost and failures are ✓.
  - Windows legs pending CI (orchestrator verifies after merge+push).

  **Decisions taken.**
  1. **Claude Code migration.** `claude mcp add` refuses an existing name, so this installation's older registration (same script, no flag) is removed and added again with the flag. A failed flagged add puts the previous registration back, and a failed remove leaves it as is (both WARN). The re-registration is recorded as a transaction external with the standard undo hint `claude mcp remove zcode-harness --scope user`, so `uninstall` still runs it. The entry lives in Claude Code's own config, which the transaction cannot restore, so `rollback` of the migration prints that manual step (exit 1), as for every Claude registration today. "Rollback restores the old entry" is byte for byte for the file-backed entries (OMP, Codex).
  2. The HTTP stack is loaded once in `serveHttp` before listen, not per request.
  3. The bridge's own READMEs × 5 and `mcp/zcode-harness-mcp/examples/config/stdio.mcp.json` document standalone use (`node dist/index.js --stdio`) and are left to ticket 53. Only the kit's harness docs changed.
  4. The setup lines added ("claude: re-registered …", the WARN lines) are setup progress lines like their neighbours, not log events. No config key or env override was added.

- 2026-11-08 (implementer, addendum): merged the integration tip again at 482eef5, which brings ticket 67's owners map; the merge is clean.
  - `npm run test`: 843 tests, 824 pass, 0 fail, 19 skipped (`reports/t36-final-kit.log`). The merge touches no proxy or MCP file, so the `test:proxy`, `test:proxy-typecheck` and `test:mcp` results above stand.
  - One job on the merged head (`job.mjs --os linux --only S3/short,S3/hung,S5/short`, `reports/t36-memloop-final.log`):
    - procPeak:mcp-bridge is 73.6 MB in S3/short and 73.3 MB in S3/hung, both ok;
    - S5/short growth is 40.98 %/1k (trend), procPeak 90.8 MB;
    - "ratchet holds": S3/short and S3/hung are RED only on 16's and 37's owned checks, S5/short only on 30's.
  - Under Round 16 Q2(c), linux `procPeak:mcp-bridge` (37's name, not marked `flips`) is now GREEN in S3/short and S3/hung on this tree. 67's ratchet accepts a GREEN owned check inside a RED run. The name stays under 37; removing it is 37's step (Round 15 Q1 condition 5).

- 2026-11-08 (implementer, round 2). Pre-merge run 42454650683 was RED on windows test-kit, Node 24 and 26: `tests\cli-audit.test.mjs:69` "Claude MCP registration recognizes equivalent Windows paths without changing ownership", `equivalent registration is not replaced` (`/home/AgentKit/overhaul-tools/ci-art/t36-r2/job-128650978529.log`). I merged the integration tip `1aa3784` first (tickets 26, 67 and 70 had landed).

  **Root cause: the test's premise, not the equivalence logic.**
  - The fixture's fake `claude mcp get` shows an equivalent spelling (forward slashes, upper case) **without** the flag, and records any other call as an attempt.
  - Setup recognised the registration as this installation's: there was no "another kit copy" warning, and that assertion passed in CI.
  - Because the flag was missing, the ticket 36 migration ran `claude mcp remove`, which the fake recorded and failed. The result: "WARN: claude mcp remove failed … left as registered", and the attempt file exists.
  - Reproduced on Linux through the same code path, with a scratch copy of the old test using a POSIX shim and a `/./` spelling (`/home/AgentKit/overhaul-tools/t36-scripts/r2/repro.test.mjs`, `reports/t36-r2-repro.log`):
    - without the flag: ✖, the attempt is `mcp remove zcode-harness --scope user`;
    - with the flag: ✔, "already registered", no attempt.
  - So ownership was never at risk. "No claude call for an equivalent registration" now holds only for a registration that already carries the flag; a flagless one is this installation's outdated entry and must be migrated once (this ticket's Seam 8).

  **Changes.**
  - `lib/mcp-bridge.mjs`: `sameInstallationPath(candidate, expected, { platform })` (moved from `setup.mjs`, with an explicit platform: `path.win32` / `path.posix` normalisation, lower-casing on win32, realpath only for the host's platform) and `claudeRegistrationState(output, serverJs, { platform })` → `foreign` / `current` / `outdated`.
  - `cli/commands/setup.mjs` uses them, with unchanged host behaviour. An unreadable `get` display still counts as foreign.
  - New cross-platform unit test in `tests/adapter-audit.test.mjs`: "Claude Code registration: equivalent path spellings with and without the bridge flag, per platform". It was RED before the refactor (`sameInstallationPath is not a function`, `reports/t36-r2-red1.log`).
    - win32 spellings: original, upper case, lower case, `/` separators, upper-case `/`, `\.\`, `\dist\..\dist\`, a doubled `\\`, quoted, quoted upper-case `/`, all with a space in the path.
    - posix spellings: `/./`, `//`, `/../`, quoted.
    - Each must be the same installation: `current` with the flag (also when ANSI-coloured), `outdated` without it or with `--max-semi-space-size=2`.
    - Foreign: `.foreign` suffix, a sibling dir, another drive, relative paths, upper case on posix, backslashes on posix, each with and without the flag. Unreadable displays (empty, no Args, no `--stdio`) are also foreign.

  **Pre-existing test change (justified, extended, not weakened).** The cli-audit test keeps its name and its two original assertions (no "another kit copy"; `equivalent registration is not replaced`), now for an equivalent spelling that carries the flag. It adds:
  - the same spelling without the flag is migrated exactly once (`[mcp remove …]`, then `[mcp add … -- node --max-semi-space-size=1 <server> --stdio]`), with no foreign warning;
  - two replays make no further call.

  It now runs on every host: Windows keeps its separator/case spelling and `.cmd` shim, other hosts use a `/./` spelling and an `sh` shim. The fake is stateful (`get` shows the stored Args, `remove` drops it, `add` stores it). Its sibling test (foreign prefix) is unchanged.

  **Mutations** (committed 9f72507, restored with `git checkout 9f72507 -- <file>`, clean diffs; `/home/AgentKit/overhaul-tools/t36-scripts/mutate-r2.py`, `reports/t36-r2-mut-*.log`). All 7 killed:
  - R1: win32 case-sensitive;
  - R2: no win32 separator normalisation;
  - R3: flag ignored;
  - R4: always outdated;
  - R5: substring ownership;
  - R6: add without remove;
  - R7: relative path adopted.

  **Suites** on 9f72507 (`reports/t36-r2-*.log`):
  - kit: 844 tests, 826 pass, 0 fail, 18 skipped (+1 test; −1 skip, since the cli-audit test now runs on Linux);
  - `test:proxy`: 1387 pass, 0 fail;
  - `test:proxy-typecheck`: clean;
  - `test:mcp`: 100 tests, 99 pass, 0 fail, 1 skipped;
  - Node 24.22.2: `adapter-audit` + `cli-audit` 29/31 (2 Windows skips).

  **Run 42454650683, memory-budget** (both legs success; "ratchet holds").
  - windows (job 128650978593), compared with the Windows baseline in METRICS (S3/short bridge 78.6 / 72.1 commit/WS, kit 734.5):
    - S3/short: procPeak:mcp-bridge 66.9 commit / 61.0 WS (gate WS, budget 75, ok); peak:kit 664.7 commit (budget 514, RED, owned by 37). RED on 16/17/37's checks.
    - S3/hung: peak:kit 459.3 commit, ok.
    - S3/omp: peak:kit 428.3 commit, ok.
    - S5/short: growth:mcp-bridge 15.43 %/1k commit (WS 35.21), trend false, inside the band 5 < v ≤ 30, so "unstable … owned by ticket 30". procPeak 82.1 commit / 59.7 WS. The run is GREEN.
  - linux (job 128650978580): S3/short and S3/hung procPeak:mcp-bridge 74.1 / 73.4 (ok); S5/short growth 40.87 %/1k, trend true, RED, owned by 30.
  - The round-1 projection for windows S5 (≈ 28.6–31) did not show in this single run: 15.43 is below the 28-run mean of 19.04. It is one run, not conclusive.
