# GitHub Actions: action majors, Node runtimes, runner images (research, 2026-11-05)

## Answer

1. The root workflows use two outdated actions: `actions/checkout@v4` → current major is **v7** (v7.0.1, 2026-07-20), and `actions/setup-node@v4` → current major is **v7** (v7.1.0, 2026-10-08). Both v4 lines declare `runs.using: node20`. `oven-sh/setup-bun@v2` is already current: v2.2.0 (2026-03-14) moved it to node24.
2. Node 20 is no longer available to actions. Runners have defaulted to Node 24 since **2026-06-16**, and Node 20 was removed on **2026-09-23**, which also ended the `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION` opt-out. The v4 actions still run because the runner forces them onto Node 24, but those major lines were never validated on Node 24.
3. Breaking changes from v4 to v7 do not affect these workflows. checkout v6 moved persisted credentials to `$RUNNER_TEMP`, and `git push` still works (release.yml:119). checkout v7 blocks fork-PR checkout only under `pull_request_target`/`workflow_run`, which these workflows don't use. setup-node v5/v6 auto-caching triggers only on a `packageManager` field, and no `package.json` here has one. setup-node v7 dropped the dummy `NODE_AUTH_TOKEN`, and the docs say this does not affect npm OIDC Trusted Publishing. Recommendation: bump to `checkout@v7` / `setup-node@v7`, keep `setup-bun@v2`, and set Bun to 1.4.4.
4. Runner images: `windows-latest` = Windows Server 2025 with VS 2026 (moved from Server 2022 2025-09-02..30; VS 2026 image 2026-06-08..15). `ubuntu-latest` is **mid-migration** from 24.04 to 26.04, rolling out 2026-10-19 → 2026-11-19, so runs this month can land on either. Nothing in these workflows depends on an Ubuntu version, so keeping `-latest` is fine.
5. The nested `zcode-proxy-src/.github/workflows/{ci,release}.yml` are **never executed**: GitHub only reads `.github/workflows` at the repo root, and the API lists only the two root workflows for ZepiGit/ZCode-Agent-Kit. They are vendored upstream files (they trigger on `master`; this repo's default branch is `main`). Their actions are already on current majors (checkout v7, upload-artifact v7, download-artifact v8, action-gh-release v3, docker/* v4/v4/v4/v6/v7), but their `bun-version: "1.4.0"` is stale. Delete them, or move the proxy typecheck/test steps into the root CI.

## Details

### 1. Every `uses:` in scope

Pinned refs come from the repo (`grep -n "uses:"`). The "current" columns come from the GitHub REST API `GET /repos/{owner}/{repo}/releases` (fetched 2026-11-05). The runtime comes from `runs.using` in `action.yml` at the pinned and current major tags (`raw.githubusercontent.com/{repo}/{tag}/action.yml`, fetched 2026-11-05).

| Action | Pinned (file:line) | Pinned runtime | Current major (first release) | Latest release | Current runtime |
|---|---|---|---|---|---|
| actions/checkout | `@v4`: ci.yml:21; release.yml:44,75,227 | node20 (`v4` tag → v4.4.0, 2026-07-20) | **v7** (v7.0.0, 2026-06-18) | v7.0.1, 2026-07-20 | node24 |
| actions/setup-node | `@v4`: ci.yml:22; release.yml:45,79,231 | node20 (last v4: v4.4.0, 2025-04-14) | **v7** (v7.0.0, 2026-07-14) | v7.1.0, 2026-10-08 | node24 |
| oven-sh/setup-bun | `@v2`: ci.yml:28; release.yml:51 | node24 (`v2` tag) | **v2** (v2.0.1, 2024-07-15) | v2.2.0, 2026-03-14 | node24 |
| actions/checkout (nested) | `@v7`: zcode-proxy-src ci.yml:27; release.yml:48,74,127,167,200 | node24 | v7 | v7.0.1 | node24 |
| oven-sh/setup-bun (nested) | `@v2`: zcode-proxy-src ci.yml:29; release.yml:49,130 | node24 | v2 | v2.2.0 | node24 |
| actions/upload-artifact (nested) | `@v7`: zcode-proxy-src release.yml:153 | node24 | **v7** (v7.0.0, 2026-02-26) | v7.0.2, 2026-10-07 | node24 |
| actions/download-artifact (nested) | `@v8`: zcode-proxy-src release.yml:177 | node24 | **v8** (v8.0.0, 2026-02-26) | v8.0.2, 2026-10-07 | node24 |
| softprops/action-gh-release (nested) | `@v3`: zcode-proxy-src release.yml:182 | node24 | **v3** (v3.0.0, 2026-04-12) | v3.0.4, 2026-11-05 | node24 |
| docker/setup-qemu-action (nested) | `@v4`: zcode-proxy-src release.yml:206 | node24 | **v4** (v4.0.0, 2026-03-04) | v4.4.0, 2026-09-15 | node24 |
| docker/setup-buildx-action (nested) | `@v4`: zcode-proxy-src release.yml:207 | node24 | **v4** (v4.0.0, 2026-03-05) | v4.4.1, 2026-09-16 | node24 |
| docker/login-action (nested) | `@v4`: zcode-proxy-src release.yml:209 | node24 | **v4** (v4.0.0, 2026-03-04) | v4.8.0, 2026-11-05 | node24 |
| docker/metadata-action (nested) | `@v6`: zcode-proxy-src release.yml:216 | node24 | **v6** (v6.0.0, 2026-03-05) | v6.2.0, 2026-07-02 | node24 |
| docker/build-push-action (nested) | `@v7`: zcode-proxy-src release.yml:224 | node24 | **v7** (v7.0.0, 2026-03-05) | v7.4.0, 2026-09-15 | node24 |

Only the root workflows (the ones that run) are behind: `checkout@v4` ×4 and `setup-node@v4` ×4.

### 2. Node runtime of actions on GitHub-hosted runners

From "Deprecation of Node 20 on GitHub Actions runners" (GitHub Changelog, first posted 2025-09-19, editor's notes up to 2026-08-25; https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/):
- "Beginning on June 16th, 2026, runners will begin using Node24 by default. To opt out … set `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` … This will only work until we upgrade the runner and remove Node20 on September 23rd, 2026." The editor's notes show the dates moved several times: the default switch went from March to June 2026, and the removal was set to 2026-09-23 on 2026-08-25. Runner annotations seen in early 2026 still said "June 2nd" / "September 16th", which are superseded.
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` was the early opt-in.

From "Node 20 is no longer available in GitHub Actions" (GitHub Changelog, 2026-09-23; https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions):
- "Runners now use Node 24 for JavaScript actions. The temporary ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION opt-out is no longer available. … If you use JavaScript actions in your workflows, update to the latest versions of those actions that support Node 24."

Consequence for this repo: `checkout@v4` and `setup-node@v4` still declare `using: node20` (checked at the `v4` tags: `actions/checkout/v4/action.yml:116`; setup-node `v4` likewise). They have been executing under Node 24 since mid-June 2026. They work today, but they run in a configuration their maintainers never released for. Bumping to v7 removes that drift. The node24 action majors need runner ≥ v2.327.1 (checkout v5 and setup-node v5 release notes). GitHub-hosted runners are on v2.338.2 (https://github.com/actions/runner/releases, latest 2026-10-26).

This is separate from the **Node version the jobs test with** (`node-version: 20` at ci.yml:24, release.yml:47,233). Node 20 is EOL (2026-04-30). `research/node-lts.md` recommends a `>=24` floor with a 24 + 26 matrix. `actions/setup-node` installs any version you ask for. The runtime the action itself runs on does not limit that.

### 3. Breaking changes between pinned and current majors

**actions/checkout v4 → v7** (release notes via GitHub API; README https://github.com/actions/checkout, fetched 2026-11-05):
- v5.0.0 (2025-08-11): "Update actions checkout to use node 24". Minimum runner v2.327.1.
- v6.0.0 (2025-11-20): "`persist-credentials` now stores credentials in a separate file under `$RUNNER_TEMP` instead of directly in `.git/config`. No workflow changes required — `git fetch`, `git push`, etc. continue to work automatically". Authenticated git inside a *Docker container action* needs runner ≥ v2.329.0. Relevant only because `release.yml:119` runs `git push --atomic origin HEAD:main "v$NEW"` in a normal `run:` step, which the README says keeps working.
- v7.0.0 (2026-06-18): "checkout now refuses to check out fork pull request code by default when the workflow is triggered by `pull_request_target` or `workflow_run` … set the new `allow-unsafe-pr-checkout: true` input". Also "Migrated `actions/checkout` to ESM". The kit's triggers are `push`, `pull_request` and `workflow_dispatch` (ci.yml, release.yml), so this does not apply. The same block was **backported** to v4.4.0 and v6.1.0 (both 2026-07-20, release notes "[BREAKING] backport `allow-unsafe-pr-checkout`"), so `@v4` already behaves this way.
- Related: GitHub Changelog lists "pull_request_target blocked by default December 2" (posted 2026-11-02; title only, seen in the related-posts list of the changelog page above; body not fetched, UNVERIFIED). Not used here.

**actions/setup-node v4 → v7** (release notes; README https://github.com/actions/setup-node, fetched 2026-11-05):
- v5.0.0 (2025-09-04): node24 runtime. "Enabled caching by default with package manager detection if no cache input is provided", triggered by a valid `packageManager` field.
- v6.0.0 (2025-10-14): "Caching is now automatically enabled for npm projects when either the `devEngines.packageManager` field or the top-level `packageManager` field in `package.json` is set to `npm`". The `always-auth` input was removed. Repo check: no `packageManager`/`devEngines` in `package.json`, `mcp/zcode-harness-mcp/package.json` or `zcode-proxy-src/package.json`, and no `always-auth` in the workflows, so neither change applies. If a `packageManager` field is ever added, consider `package-manager-cache: false` in the publish job, as the README recommends for privileged workflows.
- v7.0.0 (2026-07-14): ESM migration. "The dummy `NODE_AUTH_TOKEN` fallback has been removed … if `registry-url` is set without `NODE_AUTH_TOKEN`, legacy Yarn Classic (1.x) and older Node/npm versions may fail … npm Trusted Publishing (OIDC) is not affected, since it does not use `NODE_AUTH_TOKEN`." The publish job sets `registry-url` (release.yml:79-82), upgrades to npm 11.19.1 (release.yml:85-88), and publishes with `npm publish --provenance` over OIDC (release.yml:204). That is the unaffected path.
- v7.1.0 (2026-10-08): adds `mise.toml` support, absolute `node-version-file` and version validation. No breaking changes.

**oven-sh/setup-bun v2 (no major change)** (release notes via API):
- v2.2.0 (2026-03-14): "build: update action runtime to Node.js 24". The floating `v2` tag's `action.yml` declares `using: "node24"`.
- v2.1.1 (2026-01-16) "use packageManager from package.json as default bun version", and v2.1.0 (2026-01-03) "read engines from package json". Both only matter when `bun-version` is omitted. The kit sets it explicitly (ci.yml:30, release.yml:53), so they are irrelevant. Bump the value to `1.4.4` per `research/bun.md`.
- No v3 exists (tags: `v2.2.0, v2.1.3, …, v2`).

### 4. Runner images (`runs-on`)

The kit uses `ubuntu-latest` and `windows-latest` (ci.yml:15,19; release.yml:38,42,73,225).

- **ubuntu-latest**: GitHub Changelog "Ubuntu 26 generally available and latest migration" (2026-09-17; https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/) says: "The ubuntu-latest label will migrate from Ubuntu 24.04 to Ubuntu 26.04. This migration will roll out gradually between October 19 and November 19, 2026." runner-images issue #14748 (opened 2026-09-17) gives the same window and lists 24.04.5 LTS (kernel 6.17) → 26.04.1 LTS (kernel 7.0) (https://github.com/actions/runner-images/issues/14748). Docs (https://docs.github.com/en/actions/reference/runners/github-hosted-runners) and the runner-images README still map `ubuntu-latest` → Ubuntu 24.04, consistent with a rollout still in progress. Ubuntu 22.04 images began deprecation on September 17 and are "fully unsupported by April 17", per the runner-images announcement in image release notes (https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20261004.327, 2026-10-05).
- **windows-latest**: moved from Windows Server 2022 to 2025 "beginning September 2, 2025 and finishing by September 30, 2025" (GitHub Changelog 2025-07-31, https://github.blog/changelog/2025-07-31-github-actions-new-apis-and-windows-latest-migration-notice/). It then moved to the Windows Server 2025 **with Visual Studio 2026** image, "rolled out over a week beginning June 8, 2026 and will complete by June 15, 2026" (GitHub Changelog 2026-05-14, http://github.blog/changelog/2026-05-14-github-actions-upcoming-image-migrations; runner-images #14017). The runner-images README maps `windows-latest`, `windows-2025`, `windows-2025-vs2026` → image `windows-2025-vs2026` (https://github.com/actions/runner-images, fetched 2026-11-05).
- Assessment: the jobs install Node via setup-node and Bun via setup-bun and otherwise use only `git`, `npm`, `bash` and `node`. Neither migration touches anything they rely on. Keep `-latest`. If byte-reproducible release assets are required, pin the release job to `ubuntu-26.04`. That is optional.

### 5. Are the nested `zcode-proxy-src/.github/workflows/*.yml` ever executed?

**No.**
- GitHub docs: "GitHub searches the `.github/workflows` directory in the root of your repository for workflow files" (https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows, accessed 2026-11-05).
- Live check: `GET https://api.github.com/repos/ZepiGit/ZCode-Agent-Kit/actions/workflows` (2026-11-05) returns exactly `.github/workflows/ci.yml` and `.github/workflows/release.yml`, both `active`. The nested files are not registered.
- They are vendored from the upstream proxy project. `zcode-proxy-src/.github/ISSUE_TEMPLATE/config.yml:4` points at `github.com/tridefender/zcode-proxy`, which returns 404 from the public API (private or removed; UNVERIFIED which). Their triggers (`push: branches: [master]`, `zcode-proxy-src/.github/workflows/ci.yml:8-10`) don't match this repo's default branch `main` (`git symbolic-ref refs/remotes/origin/HEAD` → `origin/main`).
- Practical effect: the proxy's `bun x tsc --noEmit` type-check (ci.yml:41, release.yml:58) **never runs in this repo**. The root CI runs only `bun test` for the proxy (`npm run test:proxy`, ci.yml:37-38). The `bun-version: "1.4.0"` pins (ci.yml:35; release.yml:54,132) are dead config that already disagree with the root pin (1.4.2). Either delete the nested workflows or port the typecheck step into the root `ci.yml`. If ported, pin `typescript` in the proxy first; see `research/typescript.md` §4.

### Recommended edits (root workflows)

| Location | Now | Recommended |
|---|---|---|
| ci.yml:21; release.yml:44,75,227 | `actions/checkout@v4` | `actions/checkout@v7` |
| ci.yml:22; release.yml:45,79,231 | `actions/setup-node@v4` | `actions/setup-node@v7` |
| ci.yml:28; release.yml:51 | `oven-sh/setup-bun@v2` | unchanged (`@v2` = v2.2.0, node24) |
| ci.yml:30; release.yml:53 | `bun-version: 1.4.2` | `1.4.4` (research/bun.md) |
| ci.yml:24; release.yml:47,233 | `node-version: 20` | matrix `[24, 26]` for tests, `24` for single-version jobs (research/node-lts.md) |
| release.yml:81 | `node-version: 24` | unchanged |

Optionally pin actions by commit SHA. GitHub has also made "workflow lockfiles" generally available (changelog list, 2026-10-28; title only, UNVERIFIED details). Neither is required for this change.

## Sources

- GitHub REST API releases (fetched 2026-11-05): https://api.github.com/repos/actions/checkout/releases, …/actions/setup-node/releases, …/oven-sh/setup-bun/releases, …/actions/upload-artifact/releases, …/actions/download-artifact/releases, …/softprops/action-gh-release/releases, …/docker/setup-qemu-action/releases, …/docker/setup-buildx-action/releases, …/docker/login-action/releases, …/docker/metadata-action/releases, …/docker/build-push-action/releases
- `action.yml` at tags (fetched 2026-11-05): https://raw.githubusercontent.com/actions/checkout/v4/action.yml, …/checkout/v7/…, …/setup-node/v4/…, …/setup-node/v7/…, …/oven-sh/setup-bun/v2/…, and the nested actions' current tags
- actions/checkout README (fetched 2026-11-05): https://github.com/actions/checkout
- actions/setup-node README (fetched 2026-11-05): https://github.com/actions/setup-node
- actions/runner latest release v2.338.2 (2026-10-26): https://github.com/actions/runner/releases
- GitHub Changelog, Deprecation of Node 20 on GitHub Actions runners (2025-09-19, edited through 2026-08-25): https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
- GitHub Changelog, Node 20 is no longer available in GitHub Actions (2026-09-23): https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions
- GitHub Changelog, Ubuntu 26 generally available and latest migration (2026-09-17): https://github.blog/changelog/2026-09-17-ubuntu-26-generally-available-and-latest-migration/
- runner-images issue #14748, ubuntu-latest → 26.04 (2026-09-17): https://github.com/actions/runner-images/issues/14748
- GitHub Changelog, windows-latest migration notice (2025-07-31): https://github.blog/changelog/2025-07-31-github-actions-new-apis-and-windows-latest-migration-notice/
- GitHub Changelog, Upcoming image migrations (2026-05-14): http://github.blog/changelog/2026-05-14-github-actions-upcoming-image-migrations
- runner-images issue #14017, windows-latest → WS2025 + VS2026 (2026-05-07): https://github.com/actions/runner-images/issues/14017
- runner-images README, label table (fetched 2026-11-05): https://github.com/actions/runner-images
- GitHub-hosted runners reference (accessed 2026-11-05): https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- GitHub Docs, Workflows (accessed 2026-11-05): https://docs.github.com/en/actions/concepts/workflows-and-actions/workflows
- GitHub REST API, registered workflows (fetched 2026-11-05): https://api.github.com/repos/ZepiGit/ZCode-Agent-Kit/actions/workflows
- Repo: `.github/workflows/ci.yml:15-41`, `.github/workflows/release.yml:38-53,73-88,119,204,225-233`, `zcode-proxy-src/.github/workflows/ci.yml:8-41`, `zcode-proxy-src/.github/workflows/release.yml:16-224`, `zcode-proxy-src/.github/ISSUE_TEMPLATE/config.yml:4`
