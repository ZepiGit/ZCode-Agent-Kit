# 09: Batch 1a — CI toolchain: actions v7, Bun 1.4.2 in CI, nested proxy workflows removed

**Blocked by:** 02 (Windows sampler and the windows leg of the `memory-budget` job (Bun 1.4.2 reference run)), 03 (S3 OMP stub-host leg in the memory loop), 04 (Pre-existing findings: unwired tests, the test-wiring guard and CI Node coverage)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: 0006, 0016

Retitled 2026-11-07 (Round 11 Q1 condition 6): the pin is Bun 1.4.2, not 1.4.4. Bun 1.4.3 and 1.4.4 raise the Linux S1/burst1 proxy peak on the CI runners (Rounds 10–11; ticket 62 owns the newer Bun). The file name keeps `1-4-4` so existing links stay valid.

**What to build:** `actions/checkout@v7`, `actions/setup-node@v7`, `oven-sh/setup-bun@v2`; Bun 1.4.2 in `ci.yml` (all three jobs), `release.yml` and the `memory-budget` job (Round 11 Q1 condition 1; the paired measurement mode keeps 1.4.3/1.4.4 as marker-only candidate arms); S1/burst1 judged on a median of 7 (Round 11 Q1 condition 2); the three nested vendored proxy workflows deleted with a MANIFEST vendor-change entry; `release.yml` changes only in versions, runs on Node 26, publish job keeps Node 24 for OIDC.

**Acceptance criteria:**

- [ ] All CI legs and both `memory-budget` legs green on Bun 1.4.2 with the unchanged `expected-red.json` (Round 11 Q1 condition 3; one pre-merge confirmation run with the marker removed and n = 7, no rerun until green).
- [ ] A release-audit test asserts the pins (`bun-version: 1.4.2` exactly in every Bun-using job, no `1.4.0`, no `node-version: 20`) (seam 9; Round 11 Q1 condition 1 replaces "no `bun-version: 1.4.2`").

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

- **2026-11-07, round 2 (Round 10 Q1 conditions 1–2): the paired Bun measurement.**
  - **Why.** The staged pre-merge run 42344393581 on `staging/09` failed on ubuntu `memory-budget` only: `S1/burst1: RED but not listed (linux)`, median 252.3 of [252.3, 280.6, 246, 221.2, 302.2]. The 24-run measurement 42347506810 then gave Linux CI 12/24 runs above 250 MB on Bun 1.4.4, against 1/24 on 1.4.2. The Owner Proxy (Round 10) ordered a paired, interleaved measurement before any pin decision. No pin and no list entry changed in this round; Bun stays 1.4.4 on the branch (conditions 2c/3 decide after the run).
  - **Commit 44b2ddb, plus the merge of the integration tip f497b95** (docs only) as 70b6259.
  - **How to switch it on.** Commit `tests/memory/measure-burst1` with one line: `24 bun=1.4.2,1.4.3,1.4.4` (LF or CRLF). Grammar: `N` (the old single-arm mode, unchanged) or `N bun=<x.y.z>,<x.y.z>[,…]` (N runs per arm, 1–50, two or more distinct exact versions; `parseMeasureSpec`). It is the same one-run marker as ticket 60: while it exists, both `memory-budget` legs run the measurement instead of the ratchet, and every `test-kit` leg fails exactly the guard test "measurement mode is off by default …". Checked locally: with this content present, the guard test fails with "tests/memory/measure-burst1 is a one-run switch". Delete it, commit and push, then make the pre-merge run.
  - **CI changes (`ci.yml` `memory-budget`, both legs):**
    - Only with the marker: `setup-bun@v2` steps for 1.4.2 and 1.4.3 (`no-cache: true`), each followed by `tests/memory/lib/keep-bun-arm.mjs`. That script copies the binary to `$RUNNER_TEMP/bun-arms/<v>/bun[.exe]` and keeps it only if `--revision` reports `<v>+…`; otherwise it removes the copy and fails the step.
    - Then the job's own `setup-bun` 1.4.4 runs, so it stays the Bun on PATH, and is kept aside the same way.
    - The measurement step passes `--bun 1.4.2=…,1.4.3=…,1.4.4=…` only when the marker contains `bun=`.
    - **Endpoint:** setup-bun with an exact version skips the tags API and downloads `https://github.com/oven-sh/bun/releases/download/bun-v<v>/bun-<os>-<arch>[-baseline].zip`. That is the official release asset endpoint the job's own 1.4.4 step already uses, so no new endpoint is added (C6).
    - **Integrity:** setup-bun itself verifies no checksum. The guards are the `--revision` match at keep time and the per-run runtime check below. That is the same trust as the job's own Bun.
    - **Why `no-cache`:** setup-bun always installs to `~/.bun/bin/bun`. Its post step caches whatever binary sits there at job end (1.4.4) under each step's key, so a cached 1.4.2 key would hold the 1.4.4 binary.
  - **Measurement code (`tests/memory`):**
    - `job.mjs`: `--bun <v>=<path>,…` is accepted only with `--measure-burst1`. Its arms must equal the marker's arms exactly, each file must exist, and every refusal exits 2 before anything runs. The runs follow the rotation 1.4.2, 1.4.3, 1.4.4, 1.4.2, … (not blocks), `rep-<i>-bun-<v>`, each with `ZCODE_KIT_BUN` set to its arm's binary. On Windows, run.mjs's per-run Bun copy is made from it.
    - `run.mjs` plus the new `lib/runtime-probe.mjs`: on only when job.mjs sets `ZCODE_MEMLOOP_MEASURE_PROBES=1`, i.e. in measurement mode, so a ratchet run is untouched.
      - Before the sampler starts, inside the run's cap scope, the arm's Bun records `Bun.version`/`revision`, `process.constrainedMemory()`, `process.availableMemory()`, `navigator.hardwareConcurrency`, `os.availableParallelism()`, the CPU model and the CPU count.
      - The node side adds `nproc`, `/proc/cpuinfo`'s model name, the cgroup filesystem type from the statfs magic (`v2-only`, `hybrid` or `v1-only`), the scope's `memory.max` read through `/proc/self/cgroup` (on hybrid hosts also the v1 `memory.limit_in_bytes`), and the cap the job requested. On Windows it records the Job Object limit instead.
      - **The proxy's runtime Bun:** for every proxy pid the sampler sees, the executable is read from the OS while the process lives (Linux `/proc/<pid>/exe`; Windows the CIM `ExecutablePath`, now passed through the Windows snapshot, not into samples.csv). That binary is then asked for `--revision`. The flag value is never trusted.
      - Probe processes run without the run marker, so the sampler never counts them.
    - `lib/measure.mjs`: a paired run is invalid when no runtime Bun was recorded for its proxy, or when the proxy ran another version than its arm.
      - The report gives, per arm: valid of requested, the count above 250, the stable-unlisted check, over-400 runs, min/median/max, the proxy's runtime Bun, and the environment (one row, plus how many variants occurred; free memory and the per-run scope path are excluded).
      - It also gives the one-sided Fisher p of each arm against 1.4.2.
      - On Linux it prints condition 2's mechanical reading: (a) invalid, (b) no Bun effect, or (c) with the version the rule gives, plus a caution when the count is not 24 per arm.
      - On Windows it prints the condition 5 flags (median > 300, runs > 400) for information only.
      - Everything goes to `measure-S1-burst1.{json,md}` and the step summary, so the result reads straight off the job summary. The job pins nothing.
  - **The decision rule as coded:**
    - "Stable unlisted" is `medianFalseRedRate(above/valid, 5) ≤ 0.05`, which at 24 runs is ≤ 4 of 24. The tests pin 4/24 as pass and 5/24 as fail.
    - The Fisher test is the hypergeometric upper tail. The test checks it against an independent BigInt computation; 12/24 against 1/24 gives p < 0.001.
    - The order is (a) → (b) → (c), with (c) V = 1.4.3 only if 1.4.3 is stable and its p > 0.05, otherwise 1.4.2.
    - Note: at 24 per arm, a stable 1.4.3 (≤ 4) can never be significantly above a stable 1.4.2. The closest case, 4 against 0, gives p = C(24,4)/C(48,4) ≈ 0.0546. So in (c) the 1.4.3 test reduces to "1.4.3 stable"; it is still computed and printed.
  - **Expected duration per leg** (from the 42347506810 artefacts: Linux 456 s for 24 runs, median 19 s/run; Windows 535 s for 24, median 22 s/run; locally the probes added no measurable time, 19.7 s/run against 19.6):
    - ubuntu: 72 runs × ~19 s ≈ **23 min** plus about 1–2 min for the two extra setup-bun downloads. Timeout 75.
    - windows: 72 × ~22 s ≈ **27 min**, about 30 min with setup. Timeout 150.
  - **RED → GREEN:**
    - 7 new tests failed on bf6fa98 (round 1's head) with only the new tests added (`reports/t09-r2-red.log`): marker spec, Fisher, condition 2 reading, paired rotation, runtime mismatch, cgroup info, and the CI guard with the new arm steps.
    - The `--bun` refusal test passed before the implementation only because `--bun` was an unknown argument (exit 2). Mutation M6 below shows it now guards the real check.
    - After the implementation: `loop.test.mjs` plus `release-audit.test.mjs` 62 pass, 0 fail, 5 skipped (`reports/t09-r2-green4.log`). The new tests: marker spec; Fisher; condition 2 reading; paired rotation (Linux); paired condition 5 (Windows shape); runtime mismatch / none recorded; `--bun` refusals; keep-bun-arm (Linux only, fake bun scripts); cgroup info; the extended CI guard; and the release-audit arm-step scanner self-check.
  - **Pre-existing test changes, justified:**
    - The release-audit pin test (round 1, this ticket) now exempts exactly the measurement-arm steps: a setup-bun step that carries the marker `if:`, has `no-cache: true` and sits in `memory-budget`. release.yml must have none, and ci.yml must have exactly 1.4.2 and 1.4.3. Everything else still has to be 1.4.4. Round 10 condition 1 requires those installs, and the scanner self-check shows that an unguarded `bun-version: 1.4.2` is still flagged.
    - The ticket-60 guard test gains assertions for the new steps. Its marker-not-committed assertion is unchanged.
  - **Mutations** (scratch edits on 44b2ddb, restored with `git checkout -- .`, `git status` clean):
    - M1, blocks instead of rotation: 3 tests fail.
    - M2, no runtime-revision check: the mismatch test fails.
    - M3, the job's own Bun installed before the arms: the CI guard fails.
    - M4, an arm step without `no-cache`: the release audit and the CI guard fail.
    - M5, stable rule on a median of 3 instead of 5: the condition 2 test fails.
    - M6, `--bun` accepted outside measurement mode: the refusal test fails.
  - **Local proof (Linux, real Bun 1.4.2/1.4.3/1.4.4 from `/home/AgentKit/overhaul-tools/bun-1.4.{2,3,4}`).** Bun 1.4.3 was installed for this round the same way as the others: `npm install --save-exact bun@1.4.3` under `/home/AgentKit/overhaul-tools/bun-1.4.3`, `reports/t09-install-bun143.log`; the binary is an ELF reporting `1.4.3+c6da4a4d3`.
    - **(1) `job.mjs --measure-burst1 '3 bun=1.4.2,1.4.3,1.4.4' --bun …`**, cap systemd, port 19093, 9 runs (`reports/t09-r2-paired-local2.log`, `/home/AgentKit/overhaul-tools/t09-memloop/r2-paired3b/`):
      - Every run is valid, and every proxy ran its arm's Bun (read from the live pid). Example: `pid … 1.4.3+c6da4a4d3 (…/bun-1.4.3/node_modules/bun/bin/bun.exe)`.
      - Per arm, above 250 / min / median / max (MB):
        - 1.4.2: 0 of 3, 236.2 / 238.3 / 242.2.
        - 1.4.3: 1 of 3, 211.7 / 213.3 / 275.5.
        - 1.4.4: 0 of 3, 207.8 / 221.8 / 230.4.
      - Reading: (b), with the "not 24 per arm" caution.
      - An earlier run of the same command (`r2-paired3`) gave the same shape: 1.4.2 235–244, 1.4.3 202–274, 1.4.4 205–209.
    - **(2) The CI path simulated** (`reports/t09-r2-ci-sim.log`): `keep-bun-arm.mjs` on the three binaries, then the measurement step's exact `run:` text extracted from ci.yml, with the marker `1 bun=1.4.2,1.4.3,1.4.4` present. It kept the three arms, ran the rotation and wrote the reading. The marker was removed afterwards.
    - **Environment once per arm on this machine** (Round 10 condition 1's "local machine" record):
      - Bun side, identical for all three versions: `constrainedMemory` 3221225472 (the 3G scope), `hardwareConcurrency` 8, `availableParallelism` 8.
      - Host: `nproc` 8, AMD EPYC 7B12, cgroup **v2-only**, scope `memory.max` 3221225472, one variant per arm.
      - On this v2-only host every Bun version already honours the scope limit. That fits the hypothesis that 1.4.4's change (cgroup v2 limits on hybrid hosts) can only show on a host of another cgroup type. The CI rows will show which type the runners have.
  - **Suites after merging f497b95** (Bun 1.4.4, Linux): `npm run test` 640 pass, 0 fail, 16 skipped (Node 26.7.0, and before the docs-only merge also on Node 24.22.2); `npm run test:proxy` 1343 pass, 0 fail; `npm run test:mcp` 95 pass, 0 fail, 1 skipped (`reports/t09-r2m-suite-*.log`, `t09-r2-suite-test-node24.log`).
  - **Left for the orchestrator:**
    - Commit the marker on `staging/09`, push, and read both `measure-S1-burst1.md` files.
    - Ubuntu decides by condition 2; windows is information by condition 5.
    - After V is chosen, condition 3 is a follow-up round on this branch: the `bun-version` pins, the release-audit `BUN_PIN`, and the arm list if V ≠ 1.4.4.
    - Delete the marker before the pre-merge run.

- **2026-11-07, round 3 (Round 11 Q1): Bun 1.4.2 pinned, n = 7, records.**
  - **The paired run** (https://github.com/ZepiGit/ZCode-Agent-Kit/actions/runs/42352122623, `staging/09` e407916, marker `24 bun=1.4.2,1.4.3,1.4.4`; artefacts `/home/AgentKit/overhaul-tools/ci-art/t09-paired-1fRC/`). All 144 runs are valid, every proxy ran its arm's Bun, and no run is above 400 MB. Both legs ran on an INTEL(R) XEON(R) PLATINUM 8573C with 4 cores; Linux is cgroup v2-only with `constrainedMemory` = `memory.max` = 3 GiB, and Windows runs under a 3G Job Object (Bun reports the host's 16 GiB there). The Round 10 reading was (a), because the 1.4.2 arm is 5/24, not ≤ 4/24 at n = 5. Round 11 decided on that data.

    | leg | 1.4.2 | 1.4.3 | 1.4.4 |
    |---|---|---|---|
    | linux, above 250 of 24 | 5 | 14 | 13 |
    | linux median / max (MB) | 219.4 / 260.5 | 272.8 / 331.4 | 252.6 / 333.2 |
    | linux one-sided Fisher vs 1.4.2 | — | 0.0086 | 0.0178 |
    | windows, above 250 of 24 | 12 | 17 | 19 |
    | windows median / max (MB) | 250.1 / 291.5 | 254.4 / 296.1 | 257.7 / 292 |
    | windows one-sided Fisher vs 1.4.2 | — | 0.119 | 0.0344 |

    The full per-run values are in METRICS.md, "S1/burst1 and the Bun version: the paired measurement".
  - **Commits:**
    - **ed12235** `test(memory): S1/burst1 median of 7 repetitions on both legs` (condition 2, a commit of its own).
      - `REPEATED["S1/burst1"].n` goes from 5 to 7 in `tests/memory/lib/budgets.mjs`, still the one place n lives. No budget, ceiling, metric, list or unstable change.
      - Tests: `chooseRepetitions(5/24) = 7` (6.45 % at n = 5, 3.83 % at n = 7); `repetitionRule("S1/burst1").n === 7`; the largest n over the four estimates is 7. The `unstable` 251/230 median case is re-expressed with 7 repetitions, both in `verdict.test.mjs` and at the job seam in `loop.test.mjs` (the >300 case too).
      - **Discrepancy:** Round 11 condition 2 says `chooseRepetitions(6/48)` returns 5, but it returns **3** (4.30 % at n = 3 is already ≤ 5 %; the round quoted the n = 5 rate, 1.61 %). The test pins the true value 3 with a comment. The decision, n = 7 from the less favourable 5/24, is unaffected.
      - RED first: 3 tests failed on n = 5 (`reports/t09-r3-n7-red2.log`). GREEN: 118/118 (`t09-r3-n7-green.log`).
      - Mutations: n = 5 fails 3 tests; n = 9 fails 3 tests; dropping 7 from the `chooseRepetitions` candidates fails 1 test.
    - **e637c4c** `ci: pin Bun 1.4.2 in ci.yml and release.yml` (condition 1).
      - `bun-version: 1.4.2` in `test-kit`, `ux-before` and `memory-budget`, and in release.yml. release.yml now differs from the original tip caf1517 only in action majors, Node versions and comments; its Bun line is 1.4.2 again. The v7 actions and the deleted nested workflows stay.
      - Release-audit: `BUN_PIN = "1.4.2"`. Every Bun-using job must be exactly 1.4.2 (ci.yml test-kit/ux-before/memory-budget, release.yml test), 1.4.0 and Node 20 are still rejected, and the scanner self-check now uses 1.4.4/1.4.3 as stale examples. Round 11 Q1 condition 1 is the named justification for replacing round 1's "no `bun-version: 1.4.2`".
      - **The paired mode stays as ticket 62's re-entry tool:**
        - The job's own Bun (1.4.2) is the reference arm, installed last so it stays on PATH. 1.4.3 and 1.4.4 are marker-only candidate arms (`no-cache`, `keep-bun-arm.mjs`).
        - `--bun` is now built from the marker's own arm list, so a future candidate needs only its own pair of setup/keep steps plus the marker.
        - The Round 10 decision reading (`condition2Reading`, hard-coded to 1.4.4 and n = 5) is replaced by Round 11 condition 4's per-leg re-entry reading `reentryReading`:
          - (i) every run of the candidate and of the reference is valid and ≤ 400;
          - (ii) Linux: stable unlisted at **the job's n** (read from `REPEATED`; at n = 7 that is ≤ 5 of 24);
          - (iii) Linux: one-sided Fisher against the reference gives p > 0.05;
          - (iv) Windows: median ≤ 300.
        - The summary says V needs both legs plus (ii) on the pooled CI history (the triage's part), and that n is never raised to admit a candidate.
        - It flags a reference arm that is not the job's own Bun (`jobBun`, from `bun --revision`).
        - Justification for replacing that pre-existing test: the Round 10 rule was a one-run decision rule, now applied (run 42352122623); condition 4 is the rule the mode serves from now on.
      - RED first: with the new tests and the old 1.4.4 workflows, the release-audit pin test and the CI guard fail (`t09-r3-pin-red.log`). GREEN: 132 pass, 0 fail, 5 skipped across loop, verdict and release-audit (`t09-r3-pin3.log`).
      - Mutations (restored, `cmp` against the saved copies): `ux-before` back to 1.4.4; release.yml to 1.4.3; a marker-guarded 1.4.4 arm step in release.yml. Each fails the pin test.
    - **This commit:** the records (ADR-0016 amendment, this ticket's title/text/criteria, METRICS paired block, spec §18 S1 row n = 7) and the merge of the integration tip.
  - **Records written (condition 6, my part):**
    - `docs/adr/0016-…md` gets an "Amended 2026-11-07 (Rounds 10–11)" section: "the job's Bun pin stays at 1.4.2", replacing the Consequences line. Condition 3 is upheld.
    - Ticket 09 is retitled to Bun 1.4.2 (file name unchanged, so links stay valid), with What to build and both criteria updated.
    - METRICS.md gets the paired block in the Round 8 style.
    - Spec §18 S1 row records n = 7 as a measurement-rule amendment.
    - Not mine (orchestrator, c8cb6a0): DECISIONS, RUNLOG, INDEX, ticket 62, Comments on 11 and 54. Not mine (tickets 11, 53, 54): README, SUPPORT_MATRIX, release notes.
  - **Linux full memory job, Bun 1.4.2, n = 7** (`node tests/memory/job.mjs` as CI runs it; e637c4c; Node 26.7.0; cap systemd; port 19090; 2322 s; `reports/t09-r3-linux-job.log`; run dirs `/home/AgentKit/overhaul-tools/t09-memloop/r3-linux-job/`). Deps were reinstalled first with Bun 1.4.2 `--frozen-lockfile`, and no lockfile changed (`t09-r3-deps.log`).
    - **The ratchet holds** with the unchanged `expected-red.json`.
    - S1/burst1 is GREEN: median **237.3** of [**264.4**, 242.1, 208.7, 234, 244.9, 236.4, 237.3], none over 400. Repetition 1 alone would have been RED, which is exactly what the median rule absorbs.
    - S1/short is GREEN (steady 124.3, peak 173.8), and S1/stalled is GREEN (peak 195.4).
    - Every listed entry is RED on its owner's checks.
    - Observation: S4/short's `unstoppable-proxy-after-ctrl-c` was 0 of 8 this run (1 of 8 in the 1.4.2 reference and in round 1's 1.4.4 run). The entry stays RED on `stale-lock-after-ctrl-c` 5/8 and `respawn-recovers-despite-stale-lock`, so the ratchet is unaffected. That check is a race; ticket 17 owns it.
  - **CI path of the paired step** (`t09-r3-ci-sim.log`): `keep-bun-arm.mjs` for 1.4.3, 1.4.4 and 1.4.2, then the measurement step's exact `run:` text from ci.yml with a CRLF marker `1 bun=1.4.2,1.4.3,1.4.4`. The arms were kept, the rotation ran, each proxy ran its arm, and the re-entry table was written with no reference-arm caution (`jobBun` = 1.4.2). The marker was removed afterwards.
  - **Suites** (Bun 1.4.2, Linux):
    - `npm run test`: 642 pass, 0 fail, 16 skipped on Node 26.7.0 and Node 24.22.2 (round 2 had 640; +3 re-entry tests, −1 Round 10 reading test).
    - `npm run test:proxy`: 1343 pass, 0 fail.
    - `npm run test:mcp`: 95 pass, 0 fail, 1 skipped.
    - Logs: `reports/t09-r3-suite-*.log`.
  - **Duration:** n = 7 adds 2 repetitions per leg, ≈ 40 s on Linux and ≈ 45–52 s on Windows. The local S1/burst1 set took 140 s. The paired mode with 24 runs per arm takes about the same as in round 2 (CI: Linux 1368 s, Windows 1632 s).
  - **Left for others:**
    - The spec still names Bun 1.4.4 in §1 (line 34), story 126, story 138 and §12 (lines 515–528, 609). That is outside this round's scope (§18 only); it belongs to the spec owner.
    - INDEX's row for 09 still reads "Bun 1.4.4" on the integration tip c8cb6a0 (orchestrator-owned).
