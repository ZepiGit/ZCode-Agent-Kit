# 09: Batch 1a — CI toolchain: actions v7, Bun 1.4.4 in CI, nested proxy workflows removed

**Blocked by:** 02 (Windows sampler and the windows leg of the `memory-budget` job (Bun 1.4.2 reference run)), 03 (S3 OMP stub-host leg in the memory loop), 04 (Pre-existing findings: unwired tests, the test-wiring guard and CI Node coverage)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: 0006, 0016

**What to build:** `actions/checkout@v7`, `actions/setup-node@v7`, `oven-sh/setup-bun@v2`; Bun 1.4.4 in `ci.yml`, `release.yml` and the `memory-budget` job; the three nested vendored proxy workflows deleted with a MANIFEST vendor-change entry; `release.yml` changes only in versions, runs on Node 26, publish job keeps Node 24 for OIDC.

**Acceptance criteria:**

- [ ] All CI legs and both `memory-budget` legs green on Bun 1.4.4 with the unchanged `expected-red.json` (any entry turned GREEN by the runtime alone is deleted here, with evidence, and its fix ticket re-scoped).
- [ ] A release-audit test asserts the pins (no `bun-version: 1.4.2`/`1.4.0`, no `node-version: 20`) (seam 9).

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

- 2026-11-07, implementer (claude-opus-5-5; the glm worker has no provider). Branch `ticket/09-ci-toolchain` cut from the integration tip caf1517. The code commit is 7d09068, and this Comments commit sits on top of it (the final head SHA is in the implementer's report). The integration tip was still caf1517 at the end, so no merge was needed.
- **Version facts re-checked against primary sources on 2026-11-07** (research from 2026-11-05/06 confirmed, nothing changed):
  - `actions/checkout`: latest v7.0.1 (2026-07-20). The `v7` major tag exists, and `action.yml` at `v7` runs on `node24`. Sources: https://api.github.com/repos/actions/checkout/releases, https://raw.githubusercontent.com/actions/checkout/v7/action.yml
  - `actions/setup-node`: latest v7.1.0 (2026-10-08). The `v7` tag runs on `node24`. Sources: https://api.github.com/repos/actions/setup-node/releases, https://raw.githubusercontent.com/actions/setup-node/v7/action.yml
  - `oven-sh/setup-bun`: latest v2.2.0 (2026-03-14). The major tags are only `v1` and `v2` (there is no v3), and `v2` runs on `node24`. Sources: https://api.github.com/repos/oven-sh/setup-bun/releases, https://api.github.com/repos/oven-sh/setup-bun/git/matching-refs/tags/v, https://raw.githubusercontent.com/oven-sh/setup-bun/v2/action.yml
  - Bun: `releases/latest` is `bun-v1.4.4` (2026-10-22T10:11:32Z), the stable release that follows 1.4.3 (2026-10-10). Sources: https://api.github.com/repos/oven-sh/bun/releases/latest, https://api.github.com/repos/oven-sh/bun/releases
- **What changed** (commit 7d09068):
  - `ci.yml`, all three jobs: `checkout@v4`→`@v7`, `setup-node@v4`→`@v7`, `bun-version` 1.4.2→1.4.4. The jobs are `test-kit`, `ux-before` and `memory-budget`.
  - `release.yml`: the same action and Bun bumps. The `test` and `feature-account-rotator-prerelease` jobs move from `node-version: 20` to 26. `release-and-publish` stays on 24 (npm OIDC path, npm 11.19.1 upgrade unchanged).
  - Deleted: `zcode-proxy-src/.github/workflows/{ci,release}.yml` and `zcode-proxy-src/.github/release.yml`.
  - New entry in MANIFEST.md and MANIFEST.de.md.
  - Three new tests in `tests/release-audit.test.mjs`. The file is already in `npm run test`, so it is wired and needs no new script.
- **release.yml triggers after this change (unchanged, now pinned by a test).** These are the only events that start it: `push` to the branches `main` or `feature/account-rotator`, `push` of a tag matching `v*`, and `workflow_dispatch`. There is no `pull_request` trigger and no other branch, so pushing a staging branch (or `overhaul/*`) cannot start it. Inside the workflow, `release-and-publish` runs only on `refs/heads/main` or a tag, and `feature-account-rotator-prerelease` runs only on `refs/heads/feature/account-rotator`. `ci.yml` keeps its triggers: `push` to `main`/`feature/account-rotator`, and `pull_request`.
- **RED → GREEN (seam 9, `tests/release-audit.test.mjs`):**
  - RED on caf1517 plus the new tests (`reports/t09-red.log`): 9 pass, 2 fail.
    - The pin test failed because the tracked workflows included `zcode-proxy-src/.github/workflows/{ci,release}.yml`.
    - The release test failed because the release test job was on Node `20`, not 26.
    - After the nested files were deleted (`reports/t09-mid.log`), the pin test still failed: release.yml had `node-version: 20 (floor 24)` twice.
  - GREEN after the change: 11 pass, 0 fail (`reports/t09-green.log`).
  - The scanner self-check is GREEN from the start, by design. It feeds synthetic stale pins to the scanner: `@v4`, quoted `'…@v6'`, a SHA ref, `1.4.2`, `"1.4.0"`, `latest`, setup-bun without `bun-version`, `node-version: 20`, `'22.x'`, `lts/*` and a matrix `node: [20, 24]`. Every one is flagged, and the clean shape passes.
- **Mutation checks** (scratch edits on top of 7d09068, restored with `git checkout --`, `git status` clean afterwards):
  - M1: adding `"overhaul/*"` to release.yml `push.branches` makes the trigger test fail (two existing tests fail too).
  - M1b: adding `pull_request:` to release.yml fails **only** the new trigger test. The existing release tests do not catch that.
  - M2: setting only the last `bun-version` in ci.yml (the memory-budget job) back to `"1.4.2"` fails the pin test with `bun-version: 1.4.2 (want 1.4.4)`.
  - M3: re-adding a vendored `zcode-proxy-src/.github/workflows/ci.yml` (intent-to-add) fails the pin test.
- **Suites** (Linux, Bun 1.4.4 from `/home/AgentKit/overhaul-tools/bun-1.4.4`; first line of every log = `1.4.4`):
  - `npm run test`: 630 pass, 0 fail, 16 skipped, on both Node 26.7.0 and Node 24.22.2 (`reports/t09-suite-test.log`, `t09-suite-test-node24.log`). The tip had 627 tests; this ticket adds +3.
  - `npm run test:proxy`: 1343 pass, 0 fail, 90 files.
  - `npm run test:mcp`: 95 pass, 0 fail, 1 skipped.
  - `npm run test:ux-before` (all seven Linux variants, port 19092): 1/1 pass in 487 s. The capture writes `<BUN> (1.4.4)` back to the baseline's 1.4.2 (`capture.mjs:297`), so the `ux-before` job's move to 1.4.4 needs no baseline change.
  - `bun install --frozen-lockfile` with 1.4.4 passes on both lockfiles (proxy and MCP bridge) with no lockfile change, so the stricter 1.4.4 frozen-lockfile and `hasInstallScript` behaviour causes no churn (`reports/t09-deps.log`).
- **Memory-budget job, Linux, Bun 1.4.4, run as CI runs it.** `node tests/memory/job.mjs --out …`, Node 26.7.0, cap systemd, port 19090, 2270 s (`reports/t09-linux-job.log`, run dirs `/home/AgentKit/overhaul-tools/t09-memloop/linux-job/`).
  - **The ratchet holds with the unchanged `expected-red.json`.** All 15 runs match the list: S1/short, S1/burst1 and S1/stalled are GREEN, and every listed entry is still RED on its owner's checks. No entry turned GREEN, so no entry was deleted and no fix ticket was re-scoped.
  - Values that moved, compared with the Bun 1.4.2 reference: t02 `linux-job-r2` for most runs, t60 `r3-job-burst1` for S1/burst1, t03 `r2-job-s3` for S3. Values are in MB unless a unit is given.

    | run / check | budget | 1.4.2 | 1.4.4 |
    |---|---|---|---|
    | S1/burst1 procPeak:proxy (n=5) | 250 (median) | 235.6/234.7/236.6/236.7/257.7, median 236.6 | 199.1/213.8/232.4/223.3/227.2, median 223.3 |
    | S1/short steady / peak | 160 / 250 | 122.4 / 167.9 | 105.2 / 162.2 |
    | S1/stalled peak | 250 | 151.8 | 141.7 |
    | S1/burst4 / burst16 / burst32 / bigbody (RED, 19) | 250/400/600/250 | 457.5 / 839.9 / 1299.5 / 447 | 445.8 / 893 / 1391.7 / 444.9 |
    | S2 growth:scenario (RED, 58) | 5 %/1k | 10.27 | 5.67 |
    | S2 procPeak:scenario / cost-per-generation (RED, 58) | 600 / 300 | 1124.5 / 1098.8 | 993.4 / 967.1 |
    | S3/hung procPeak:proxy | 62 | 62.5 (RED) | 59.1 (green) |
    | S3/omp procPeak:preflight | 76 | 62.9 | 73.5 |
    | S3/short / S3/hung peak:kit (RED) | 596 | 855.1 / 853 | 850.4 / 860.5 |
    | S5 growth:mcp-bridge (RED, 30) | 5 %/1k | 43.78 | 42.58 |
    | S7 procPeak:proxy | 250 | 226.3 | 223 |

    Notes on the moved values:
    - S2 drops about 12 % on peak and cost per generation, and growth almost halves. That fits Bun 1.4.3's change that returns memory from threads blocked in `Atomics.wait()`. All of its checks stay RED, and its owner check is still RED, so ticket 58 is not re-scoped.
    - S3/hung's proxy peak goes back under 62. It was 0.5 MB over on 1.4.2. That is within run-to-run noise, and S3/hung stays RED on its ticket-16 checks.
    - S3/omp's preflight peak moves to 73.5, close to its 76 budget. The S3/short and S3/hung preflights are 72–75 on both versions. Ticket 35 should know about this margin.
  - **S1/burst1 measurement on 1.4.4** (`job.mjs --measure-burst1 20`, port 19091, `reports/t09-linux-measure20.log`, `/home/AgentKit/overhaul-tools/t09-memloop/measure20/`): 20 of 20 runs valid, 0 of 20 above 250 MB, min/median/max 196.4 / 210.7 / 234.6 MB, none over 400. The 1.4.2 Linux reference (`t60-memloop/measure-linux20`) was 2 of 20 above 250, median 230.9, max 251.8. On Linux the runtime alone moves burst1 about 20 MB lower. Linux has no burst1 entry, so the list is unaffected. Windows S1/burst1 is `unstable` (ticket 20), and its windows distribution on 1.4.4 is pending CI.
- **Decisions taken:**
  1. **The "three nested workflows" are** `zcode-proxy-src/.github/workflows/ci.yml`, `…/workflows/release.yml` and `zcode-proxy-src/.github/release.yml`. The last one is the release-notes category config that only the nested release workflow's `generate_release_notes` consumed, and GitHub reads it only at the repo root. `zcode-proxy-src/.github/ISSUE_TEMPLATE/` is not a workflow and stays.
  2. **The nested `bun x tsc --noEmit` typecheck is not moved here.** It never ran in this repo. Moving it into the root CI through a pinned `typescript` devDependency, with its baseline recorded first, is ticket 11's criterion (Round 1 Q15). Until 11 lands, the root CI has no proxy typecheck. That matches today's state, because the nested step never ran.
  3. **release.yml changes are versions only**: two action majors, the Bun pin and three `node-version` values. Three comments that stated a version are updated with them: "Node 20 ships npm 10", "test matrix … stays on Node 20" and "Pinned to … (1.4.2)". Leaving them would make them false. No step, trigger, permission or condition changed (`git diff caf1517 -- .github/workflows/release.yml`).
  4. **The `ux-before` job's Bun also moves to 1.4.4**, because the ticket says "Bun 1.4.4 in `ci.yml`" and the capture normalises the Bun version (see Suites).
  5. **Installers, `SUPPORT_MATRIX.json` and the installer tests stay on 1.4.2.** They belong to ticket 11 (bootstrap and SHA-256s) and ticket 10 (Node gates).
  6. **No pre-existing test changed.** The attributes test still lists `zcode-proxy-src/.github/workflows/release.yml` for `export-ignore`. `git check-attr` matches patterns, not files, so it still passes for the deleted path. The `.gitattributes` rule stays, and it guards any future vendored `.github` content.
- **Left for others / pending CI** (the orchestrator verifies after the merge and push):
  - All four `test-kit` legs, both `ux-before` legs and both `memory-budget` legs green on Bun 1.4.4 (acceptance criterion 1).
  - Windows memory-budget with the unchanged list. The commit-based numbers can move with Bun 1.4.4's mimalloc and GC changes. Check:
    - (a) S1/burst1 (`unstable`, ticket 20): median ≤ 300 on WS. Record the value and the commit median. If it now sits clearly under 250, that is Round 6 Q2 condition 3 / ticket 20 evidence, not a list edit.
    - (b) S5/short stays GREEN. Its entry was removed in Round 7 Q3. If it is RED, it goes back as a question.
    - (c) S1/short GREEN on the WS gate. S1/stalled stays RED (ticket 61).
    - (d) The proxy commit backstop of ≤ 512 MB in the paced runs. The 1.4.2 values were S1/short 347.7, S1/stalled 452.3, S7 401.5 and S3 188.
    - (e) The S3 kit total stays ≤ 514 MB commit. S3/hung was 456.8 and GREEN on 1.4.2.
    - (f) The Bun commit floor: the first proxy sample and the idle proxy commit (1.4.2: ~113 / ~180 MB). Record it for the Round 7 "solver child under the 300 MB commit cap" question.
    - (g) The "RED only on commit" list in the job summary.
    - Any listed windows entry that turns GREEN fails the ratchet. That becomes an Owner Proxy question with the numbers, and `expected-red.json` is not edited.
  - release.yml cannot run on a staging push (see triggers). Its first real run is the next `main` push or `v*` tag, which is a release (B6, owner). Until then only the audit test checks it. setup-node v7 dropped the dummy `NODE_AUTH_TOKEN`. Its docs say npm Trusted Publishing (OIDC) is not affected, but the first real publish is the first live proof.
