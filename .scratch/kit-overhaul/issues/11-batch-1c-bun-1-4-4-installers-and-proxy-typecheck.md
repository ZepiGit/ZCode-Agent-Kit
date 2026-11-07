# 11: Batch 1c — Bun 1.4.2 bootstrap in the installers, pinned proxy typecheck (Round 11 pin)

**Blocked by:** 10 (Batch 1b — Node 24 support floor, refuse before mutation, autostart Node-path check)

**Status:** resolved

Model: glm

Risk: medium

ADR: 0006, 0016

**What to build:** Both installers bootstrap Bun 1.4.2 (Round 11 Q1 condition 1) with the five upstream SHA-256s (linux-x64, linux-aarch64, darwin-x64, darwin-aarch64, windows-x64) from the primary source, Bun's GitHub release assets. The proxy typecheck runs in root CI through a pinned proxy `typescript` devDependency and `@types/bun` 1.4.2 exact. Its baseline is recorded first, and every failure becomes a ticket. The re-run of the memory loop's short profile on a new Bun (the Windows attribution run) is moot, because the runtime stays at 1.4.2 (Round 11 Q1 condition 1).

**Acceptance criteria:**

- [ ] Installer tests assert the five hashes and reject a tampered download (seam 8).
- [ ] `test-kit` legs include the proxy typecheck through the pinned devDependency, never an unpinned `bun x`. Its baseline error list is recorded before any fix. If the list is non-empty, the step compares against a committed expected-error list with the same ratchet as `expected-red.json` (a new error fails; a listed error that disappears fails until it is removed), and each listed error names a filed ticket.
- [ ] ~~METRICS.md records the Linux and Windows 1.4.4 attribution runs next to the 1.4.2 reference~~ (moot, Round 11 Q1 condition 1: METRICS.md records why); typecheck-baseline failures (if any) are filed as tickets (build-time gate 7).
- [ ] SUPPORT_MATRIX.json and README × 5 name Bun 1.4.2 (Round 11 Q1 condition 6), and spec.md's 1.4.4 mentions outside §18 move to 1.4.2 with a pointer to Round 11.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 126, 140

## Comments

- 2026-11-07 (orchestrator, Owner Proxy round 11, binding): the kit pins **Bun 1.4.2** everywhere, not 1.4.4 (paired CI run 42352122623: Bun ≥ 1.4.3 raises the Linux S1/burst1 peak; ticket 62 owns re-entry). This explicitly amends Round 1 Q15, Round 2 Q10 condition 4 and the ADR-0016 Consequences line.
  For this ticket: installers bootstrap Bun 1.4.2 with its SHA-256s taken from the primary source (Bun's GitHub release assets), `@types/bun` 1.4.2 exact; the "1.4.4 attribution runs" criterion is moot (Round 11 C1). Retitle to 1.4.2. SUPPORT_MATRIX.json and README × 5 name 1.4.2 (Round 11 C6).
- 2026-11-07 (orchestrator): spec.md still names Bun 1.4.4 outside §18 (§1 line ~34, stories 126 and 138, §12 lines ~515–528 and ~609). Update them to 1.4.2 with a pointer to Round 11 when this ticket lands (ticket 09 changed §18 only).

### 2026-11-07: implementer (substitute for glm)

**Branch:** `ticket/11-bun-1-4-2-installers` (worktree `/home/AgentKit/wt/t11`), created on `ticket/10-node-24-floor` (e57d75d) as instructed. Then the integration tip `ff51a49` was merged in (`85c6671`, clean). That tip already contains ticket 10's merge `1e8f652`. Code and docs commits:
- `0bf2f01` ci(proxy): typecheck in test-kit, with pinned typescript 7.0.2 and @types/bun 1.4.2;
- `cf46c16` test(installer): the five hashes and the tamper refusal;
- `d634d2f` test(release): one-pin guard;
- `4d5614c` docs.

The head SHA is the commit that adds this comment.

**Bun 1.4.2 SHA-256s from the primary source.** They were checked three ways. Every value matched every source, and every value matches what `install.sh`/`install.ps1` already pinned.
- Downloaded into the new, empty directory `/home/AgentKit/overhaul-tools/t11-bun-v1.4.2-assets/`, from `https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/<asset>`.
- **Source 1:** `sha256sum` of each downloaded asset.
- **Source 2:** the release's `SHASUMS256.txt` (`sha256sum -c` OK for all 5). Its clearsigned copy `SHASUMS256.txt.asc` gives `gpg: Good signature from "Robobun <robobun@oven.sh>"`. The signature was made 2026-09-05T05:57:48Z with EdDSA key `F3DC C08A 8572 C074 9B3E 1888 8EAB 4D40 A7B2 2B59`. The key was fetched from keys.openpgp.org into a throwaway GNUPGHOME (`/home/AgentKit/overhaul-tools/t11-gnupg`). It is not certified by a trust path, which is the usual case for a fetched key.
- **Source 3:** the GitHub release API `digest` field (`https://api.github.com/repos/oven-sh/bun/releases/tags/bun-v1.4.2`, published 2026-09-05T05:55:48Z, not a prerelease).

| Asset | Bytes | SHA-256 | Pinned in |
|---|---|---|---|
| bun-linux-x64.zip | 36646985 | `36368faef7527875d5ffa52e53cd48021741f2a83eb6208a8dd64068d422a913` | install.sh `BUN_LINUX_X64_SHA256` |
| bun-linux-aarch64.zip | 36602920 | `54328bbc2d9c8e0c9f892c544d66c57a83b84139e34909e5ee81758f1ac8fda7` | install.sh `BUN_LINUX_AARCH64_SHA256` |
| bun-darwin-x64.zip | 28440507 | `80520d7e17526308c9185d261679ac6d27798d3803a0e9f7ff9121ab8affb012` | install.sh `BUN_DARWIN_X64_SHA256` |
| bun-darwin-aarch64.zip | 25377591 | `90987a3a16d7db556d886ac3d551e7b6d3edf0a1cf43acaed622e8676be1d12f` | install.sh `BUN_DARWIN_AARCH64_SHA256` |
| bun-windows-x64.zip | 39807510 | `ce4c17497b2f29712a99d3d53f028de28cd42e3bacb8589599e7f000e49b6405` | install.ps1 `$bunSha` |
| SHASUMS256.txt | 3431 | `99ebf3e6afe003b57eae3f257abce7e9aa851452429e84ef16b1b401e9d7cff1` (API digest) | — |

So the installers needed no change. They already bootstrap 1.4.2, the Bun 1.4.4 bump never landed, and Round 11 keeps 1.4.2. What this ticket adds is the tests that hold the pins and the refusal in place.

**Pinned typecheck toolchain** (`zcode-proxy-src`): devDependencies `"typescript": "7.0.2"` (research/typescript.md §Answer 4) and `"@types/bun": "1.4.2"`, replacing `"latest"`, which was locked at 1.3.14. `bun.lock` was regenerated with Bun 1.4.2: `@types/bun@1.4.2`, `bun-types@1.4.2`, `typescript@7.0.2` plus its 20 per-platform optional packages. The integrity hashes match `npm view … dist.integrity` for typescript, @types/bun, bun-types, and @typescript/typescript-linux-x64 and -win32-x64. A fresh `bun install --frozen-lockfile` from only the committed manifest and lock, in a new empty dir, installs them and leaves the lock byte-identical (`t11-frozen`). The new script `typecheck` is `tsc --noEmit -p tsconfig.json`. The root script `test:proxy-typecheck` is `cd zcode-proxy-src && bun run typecheck` and is part of `test:all`. The new `test-kit` step "Proxy typecheck (pinned tsc)" runs it on all four legs, after the frozen install and with no `if:`.

**Typecheck baseline, recorded before any fix** (`reports/t11-typecheck-baseline.log`): `Version 7.0.2`, **0 errors**, exit 0, over 187 `src/` files (`--listFilesOnly`) plus bun-types and @types/node. A planted `const x: number = "…"` is caught (TS2322), so the check is real. With an empty baseline, the criterion's expected-error list and ratchet do not apply. The step is a plain pass/fail: any error fails the leg. No tickets were filed, and METRICS.md records this (build-time gate 7).

**Tests** (wired: both files were already in `npm run test`)
- `tests/release-audit.test.mjs` (+3):
  - `test-kit runs the proxy typecheck through the pinned typescript and @types/bun devDependencies, never an unpinned bun x`. It checks:
    - the exact devDependency pins, with `@types/bun` = `BUN_PIN`;
    - the lock entries;
    - the script strings;
    - `test:all`;
    - one test-kit step with no `if:`/`continue-on-error`, placed after the frozen proxy install, on the {ubuntu, windows} × {24, 26} matrix;
    - no `bunx`/`bun x`/`npx`/`dlx` in any script or workflow `run:` line, and no unpinned `tsc` in workflow code.
  - `the pinned proxy typecheck passes on the proxy source and fails on a new type error`. It is live. The installed tsc reports 7.0.2 and the installed bun-types are 1.4.2. `bun run typecheck` in `zcode-proxy-src` exits 0. Then the same script and tsconfig, with the real node_modules through a junction, run on a temp project with one TS2322 error. That run exits non-zero and names exactly that error, while a file using `Bun.env` type-checks. This proves `bun run` passes tsc's failure through, so the step can fail. It skips only when the proxy deps are not installed; CI installs them before `npm run test`.
  - `Bun 1.4.2 is the one pin: both installers, README x5 and SUPPORT_MATRIX name no other Bun` (story 126, Round 11 C6). It covers download URLs, every `bun-vX`, the printed `Bun vX`, the five READMEs ("tested with Bun 1.4.2" in each language) and SUPPORT_MATRIX `testPlatform`. They all already said 1.4.2, so no doc edit was needed.
- `tests/installer-audit.test.mjs` (+8, seam 8). `BUN_RELEASE_SHA256` is the table above, an independent literal with its source in a comment. It is not read from the installers.
  - `install.sh refuses a tampered Bun 1.4.2 download on <os>-<arch> (<asset>) before extracting it`: 6 tests, one per uname pair the installer maps (Linux x86_64/aarch64/arm64, Darwin x86_64/arm64/aarch64). Each runs three tamperings: other bytes, an empty body (both hashed by the real `sha256sum`), and the genuine digest of another platform's asset. Each asserts:
    - exit 1, with `expected <pinned asset hash>` and `actual <digest>` on stderr;
    - exactly one fetch, the exact `bun-v1.4.2/<asset>` URL;
    - no unzip, no kit download, no setup;
    - no `~/.bun`, no installation, and the private temp removed.
  - `install.ps1 refuses a tampered Bun 1.4.2 download (bun-windows-x64.zip) before extracting it` (Windows legs). It runs the same three tamperings. It asserts:
    - a non-zero exit, with the expected/actual digests in the error record (compared without the `|` gutter);
    - only the Bun URL fetched;
    - the logged Expand-Archive mock never called;
    - no `LOCALAPPDATA\bun`, no install, LOCALAPPDATA unchanged and TEMP empty.
  - `install.ps1 accepts exactly the pinned Bun 1.4.2 digest, extracts it under LOCALAPPDATA and records it in .bun-path` (Windows legs). Get-FileHash reports the pinned value in upper case, as the real cmdlet does. The test asserts:
    - the call order download, then hash, then `expand <LOCALAPPDATA>\bun`;
    - exit 0;
    - `.bun-path` = the bootstrapped `bun-windows-x64\bun.cmd`.
  - `runPs1Fixture` gained the opt-in options `bun` (default `true`), `bunBody` and `bunDigest`. With `bun: false`, every PATH directory that holds a Bun is dropped, setup-bun's `~/.bun/bin` included, so the bootstrap really runs on the CI runner.
  - The defaults generate the same wrapper as before. Proof: the four existing ps1 tests give byte-identical results (same pass/fail set, same assertion text md5) on Linux pwsh from ticket 10's file (`1e8f652`) and from this one (`t11-ps1-existing-base` vs `t11-ps1-existing`).

**Changed pre-existing tests and scripts, with justification:**
- No pre-existing test assertion changed.
- `runPs1Fixture` was extended as above, with its defaults unchanged.
- `test:all` gains `npm run test:proxy-typecheck`. Spec §12 and story 140 put the typecheck with the kit, proxy and MCP suites.

**RED → GREEN** (logs in `reports/`)
- `t11-red1`: the two typecheck tests against the tip's proxy manifest and lock. They fail with "typescript is an exact proxy devDependency (actual undefined)" and "proxy typecheck baseline is not clean (exit 1: no typecheck script)".
- `t11-green1`: release-audit 15/15.
- The installer and one-pin guards pin behaviour that already held, so they could not go RED first. They were proven by mutation instead. Each scratch edit was restored and `git diff` was clean after each (`t11-mutants`, `t11-mutants2`; scripts in `/home/AgentKit/overhaul-tools/t11-scripts/`):

| Mutant | Killed by |
|---|---|
| sh-M1: one hex digit in the linux-aarch64 pin | 2 tests (Linux aarch64, arm64) |
| sh-M2: hash comparison deleted | 6/6 install.sh tamper tests |
| sh-M3: Apple Silicon mapped to the x64 asset | 2 tests (Darwin arm64, aarch64) |
| sh-M4: URL `bun-v1.4.4` | 6/6 |
| ps-M5: mismatch `Write-Warning` instead of `Write-Error` (extraction goes on) | ps1 tamper test |
| ps-M6: one hex digit in `$bunSha` | both ps1 Bun tests |
| tc-M7: `typecheck` script `… \|\| exit 0` | both typecheck tests |
| tc-M8: a type error appended to `src/index.ts` | live test; `bun run typecheck` exit 1 with `src/index.ts(1180,14): error TS2322` |
| tc-M9: `if: runner.os == 'Linux'` on the CI step | the CI-wiring test |
| one-pin: README.ja → 1.4.4, SUPPORT_MATRIX → 1.4.3, install.ps1 message → v1.4.4, install.sh URL → v1.4.4 | the one-pin test, each with its own message |

- PowerShell 7.6.9 linux-x64 (ticket 10's digest-checked copy) ran both new ps1 tests with `process.platform` faked to win32: 8/8 Bun tests green (`t11-ps1-linux`). One local-only accommodation lives in the Expand-Archive mock: outside Windows it also appends the Bun dir to PATH with `:`, because `install.ps1` joins PATH with `;`. It never runs on Windows.

**Full suites** (Bun 1.4.2, Node 26.7.0; branch after merging the tip `ff51a49`)
- `npm run test` (`t11-full-kit2`): 696 tests, 677 pass, 0 fail, 19 skipped. Ticket 10 had 685/668/17: +11 tests, and +2 skips, which are the Windows-only ps1 tests.
  - The first full run (`t11-full-kit`) had one failure: `tests/memory/loop.test.mjs` "a marked process is re-attributed after it execs" (all 6 samples `other`). That test is timing-bound, sampling for 1.6 s around a 0.6 s fork-to-exec. Its file passed alone (`t11-loop-rerun`, 58/53/5 skip), and the full rerun passed. This ticket changes nothing in the sampler.
- `npm run test:proxy` (`t11-full-proxy`): 1343 pass, 0 fail, 90 files (unchanged).
- `npm run test:proxy-typecheck` (`t11-full-typecheck`): exit 0.
- `npm run test:mcp` (`t11-full-mcp`): 96 tests, 95 pass, 0 fail, 1 skipped. `dist/` is unchanged.
- Node 24.22.2, the touched files (release-audit, installer-audit, installer, test-wiring) (`t11-node24`): 51/45/0 fail/6 skipped.
- Memory loop: not run. This ticket changes no runtime, proxy source or kit code path; `@types/bun` and `typescript` are type-only devDependencies. There is no metrics delta, and no expected-red entry belongs to this ticket.

**Decisions taken**
1. **No expected-error list.** The baseline is empty, so the conditional ratchet in criterion 2 does not apply. The smallest step that meets the criterion is plain tsc pass/fail.
2. **TypeScript 7.0.2 and the tsconfig unchanged.** The research names 7.0.2. `"types": ["bun-types"]` still resolves through `@types/bun` 1.4.2; switching it to `"bun"` is optional and was not needed.
3. **The live typecheck test sits in `npm run test` as well as the CI step.** The CI step proves the tree is clean on every leg. The test adds the adversarial half: a new error must fail the same script through `bun run` on both OSes.
4. **No installer edit.** Both already pin 1.4.2 with exactly the primary-source digests.
   - install.sh's `die` prints the `\n` in "hash mismatch\n  expected …" literally. Ticket 44 already owns that ("install.sh `die` prints real newlines"). The new assertions match the digests, not the line breaks, so they survive that fix.
5. **release.yml is untouched.** The ticket does not ask for a change. Triggers are unchanged, and there is no version bump, tag or release (B6).
6. **spec.md:** every 1.4.4 mention outside §18 now names 1.4.2 with a Round 11 pointer: Solution (line 34), stories 126/138, the §1 baselines, §12 batch 1 and CI layout, the §16 release-notes list, and Testing Decisions seam 8. seams.md seam 8 too. Line 704 is in §18 (build-time gate 3, "the 1.4.4 attribution run") and was left for the §18 owner; METRICS.md now records that this run is moot.
7. **RUNLOG is not edited.** It is the orchestrator's append-only log. Round 11 C1's "RUNLOG notes the moot attribution step under Round 3 Q9" is for the orchestrator to append.

**Left for other tickets**
- **44:** the install.sh `die` newlines, already listed there.
- **62:** moving the pin means changing `BUN_PIN` (release-audit) and `BUN_VERSION`/`BUN_RELEASE_SHA256` (installer-audit) together with the installers, ci.yml/release.yml, `@types/bun`, README × 5 and SUPPORT_MATRIX. The one-pin test enforces that.
- **54:** the release notes state the Bun 1.4.2 stay-back (Round 11 C6). There is no user-visible installer change from this ticket.

**Pending CI** (the orchestrator checks these after merge and push)
1. All four `test-kit` legs (ubuntu/windows × Node 24/26):
   - `bun install --frozen-lockfile` in `zcode-proxy-src` passes with the new lock; on windows it pulls `@typescript/typescript-win32-x64`;
   - the new step "Proxy typecheck (pinned tsc)" runs, logs `$ tsc --noEmit -p tsconfig.json`, and passes;
   - in `npm run test`, `the pinned proxy typecheck passes on the proxy source and fails on a new type error` runs, not skipped, and passes. On windows that covers the junction and `bun run` on Windows.
2. Windows `test-kit`, Node 24 and 26:
   - `install.ps1 refuses a tampered Bun 1.4.2 download (bun-windows-x64.zip) before extracting it` runs, not skipped, and passes;
   - `install.ps1 accepts exactly the pinned Bun 1.4.2 digest, extracts it under LOCALAPPDATA and records it in .bun-path` runs and passes. It depends on removing setup-bun's `~/.bun/bin` from the fixture's PATH;
   - the six `install.sh refuses a tampered Bun 1.4.2 download on …` tests pass under Git Bash, with the real `sha256sum`;
   - the four existing `install.ps1` tests are unchanged.
3. `ux-before` on both legs and `memory-budget` on both legs: verdicts unchanged from the tip, no runtime change, `expected-red.json` untouched.
4. `release.yml` is unchanged: no run, no trigger change.

Merged 2026-11-07 as 11cbfcb (ticket/11-bun-1-4-2-installers at 285b932; first merge, no revert-of-revert step); fast suite: kit 679/698 (19 skipped, 0 fail; includes `the pinned proxy typecheck passes on the proxy source and fails on a new type error`), proxy 1343/1343, proxy typecheck green (`tsc --noEmit -p tsconfig.json`, typescript 7.0.2), mcp 95/96 (1 skipped, 0 fail); mcp dist unchanged. zcode-proxy-src/bun.lock changed, so `bun install --frozen-lockfile` (Bun 1.4.2) in zcode-proxy-src and `npm ci` in mcp/zcode-harness-mcp also ran, both green. Clean merge (no conflicts). Sanity: `git diff --stat staging/11 HEAD -- . ':!.scratch' ':!cli/adapters/kilo-code.mjs' ':!tests/adapter-audit.test.mjs'` is empty (ticket 59's two files are the only non-.scratch difference). Pre-merge CI (draft PR #20, staging/11), green on all 8 jobs: https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42381135168 — "Proxy typecheck (pinned tsc)" ran on all four test-kit legs; both install.ps1 Bun 1.4.2 tests (exact digest accepted; tampered download refused before extraction) ran and passed on windows Node 24 and 26; the ratchet holds on both memory-budget legs. Logs: .scratch/kit-overhaul/reports/merge-11-{npm-ci,bun-install,mcp-npm-ci,test,proxy,proxy-typecheck,mcp}.log.
