# Release checklist

Use this reusable checklist for each release candidate; it is not a status report
for the current branch. Verify the exact commit's CI run, release assets, and npm
publication before reporting success. Main-branch pushes can trigger publication,
so review these gates before initiating one.

## Blocking gates before a release-triggering push or dispatch

- [ ] **Vendored redistribution permission:** resolve the existing license gate
  below with traceable upstream evidence. Do not infer permission from this kit's
  root MIT license or a newly copied license file.
- [ ] Complete the final source review and test matrix for the exact candidate
  commit, including repair/preflight, Continue YAML/key handling, credential
  reload/recovery, postinstall hint and installer regressions.
- [ ] Verify the release payload includes the required license notices, CLI/runtime
  sources and matching publish marker, and excludes real credentials, local
  configs, generated state, logs and backups. Use `pack/build.mjs` and
  `pack/verify-payload.mjs`; a dry-run publish does not publish anything.
- [ ] Verify installer paths with and without an existing bun runtime. Check the
  pinned bun version, platform checksums, archive checksum verification and
  preservation of existing local state; do not equate fixture tests with a real
  user installation.
- [ ] Confirm version consistency across `package.json`, `package-lock.json`,
  `pack/ALLOW_PUBLISH` and the intended release tag.
- [ ] Confirm npm Trusted Publisher is configured for `ZepiGit/ZCode-Agent-Kit`,
  workflow `release.yml`, with the environment matching the workflow. The job
  needs `id-token: write`, Node 24 with pinned **npm 11.19.1**, and provenance
  publishing; the test matrix remains on Node 20.

A release-triggering push is not merely a source backup: `.github/workflows/release.yml`
can publish automatically. Resolve these gates before pushing to `main` or a
matching tag, or manually dispatching that workflow. A version marker is an
execution gate, **not** legal clearance or evidence that verification completed.

The `feature/account-rotator` branch has a separate prerelease path. A push or
manual dispatch runs the same `test` matrix, then derives
`v<package-version>-account-rotator.<run_number>.<run_attempt>`. It builds a
non-latest GitHub prerelease with no npm publication and no push to `main`.
The package version, lockfile and `pack/ALLOW_PUBLISH` marker are staged into a
throwaway index before `git archive`; this keeps the uploaded archive metadata
identical to the package validation. The archive is versioned while the
installer assets remain `install.ps1`, `install.sh` and `checksums.txt` so the
installer URLs stay compatible.

## Actual release workflow behavior

Read `.github/workflows/release.yml`, not its older tag-only comments, as the
source of truth. Its triggers are pushes to `main`,
`feature/account-rotator`, `v*` tags and manual dispatch.
The workflow runs kit, proxy and MCP suites on Ubuntu and Windows before the
release/publish job.

- **Main push or non-tag dispatch:** reuse the current package version only if
  npm reports it missing and its remote tag is absent or resolves to the exact
  current HEAD (annotated tags are peeled to their commit). Otherwise scan up to
  100 patch candidates for a version absent from both npm and remote tags, update
  both manifests and `pack/ALLOW_PUBLISH`, then create/push the version commit/tag.
  Registry/tag lookup errors fail closed. A version missing on npm but tagged to
  older source is occupied, not an opportunity to reuse old GitHub assets.
- **Dispatch retry:** the same-version path requires npm-unpublished status and
  either no remote tag or an exact-HEAD tag. Dispatch is **not** unconditionally
  idempotent; a published version or different-source tag forces a new free patch.
- **Tag run:** the tag must agree with the package version and marker. If npm
  already has that version, npm publication is skipped.
- **Existing GitHub release:** its assets are preserved rather than replaced;
  an incomplete npm publication can still proceed. Dispatch may create a GitHub
  release if it does not exist—it is not an npm-only path.
- **Publication:** build and verify `pack/dist`, perform a dry-run where applicable,
  build the archive/installers/checksums, create the GitHub release if absent,
  then publish through npm OIDC. CI builds with `--tracked-only`. Exact npm-version
  lookup treats only structured `E404` as missing; timeouts, auth errors and
  malformed responses fail closed rather than implying an unpublished version.
  After publish, a bounded registry check verifies the exact version is visible.
  This checks version visibility, not the downloaded artifact contents. Any step
  can fail; a triggered run is not proof of a completed release.

## npm authentication and payload gates

The current release workflow uses **Trusted Publishing (OIDC)**, not an
`NPM_TOKEN`/`npm_token` repository secret. Do not follow the obsolete token-based
`npm-publish.yml` instructions. The root package remains `private: true`; the
built publish package is authorized only by a matching, version-bound marker,
which `scripts/verify-release-marker.mjs` checks again at publish time.

The built package's postinstall hook should only print `zcode-kit setup` guidance.
It must not launch setup, install runtime dependencies, import credentials or
change user harness files during npm installation. Test the hook itself, not
just the string in `package.json`.

## Artifact integrity and post-publication evidence

- Never replace assets under an existing tag. Fix forward with a new version and
  build from its exact source commit.
- The installer consumes the uploaded versioned archive, not GitHub's automatic
  source archive. Verify its SHA256 against `checksums.txt`.
- Checksums hosted beside the assets establish integrity relative to that file,
  not independent provenance. Check the release/tag commit and npm provenance.
- After publication, verify the registry's expected package version and download
  the actual published artifact for payload/marker/license checks. Verify the
  GitHub asset set and checksums separately. Do not infer npm success merely from
  GitHub release creation or a locally successful dry-run.
- Record exact tested commit/version, suite counts, skipped or unexecuted paths,
  and live-test limitations. The baseline MCP suite did not execute its `wmic`
  kill path; a test count alone cannot validate it.

## Vendored license gate — unresolved pending upstream evidence

The upstream README's **MIT declaration has been verified**. A standalone upstream
LICENSE/copyright-notice file was not found. The uncertainty concerns the
redistribution basis and notice requirements for the vendored source/artifacts,
not an assertion that upstream supplied no license declaration.
**Do not publish a candidate containing that code until the redistribution
basis and required notices are clarified and recorded.** Obtain traceable
upstream evidence or explicit permission as needed; pin the corresponding
source revision and retain the applicable notices. Do not re-label vendor code
or assume the root project's license grants rights over it.

Redistribution/notice review remains an explicit release gate despite the verified
MIT declaration. This checklist does not claim that the gate has been resolved
or that an existing published artifact establishes permission for a new one.

## Historical context (not current verification)

The v0.2.0/v0.2.1 preparation used different test counts and included manual
release commands and an obsolete release-event/npm-token path. Those instructions
are superseded here. The v0.2.0 asset-replacement history remains in its release
notes; it is not a precedent for replacing assets again. Use the CI results for the exact candidate commit, not old green checkboxes.
