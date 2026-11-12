# Release checklist

This maintainer guide is kept in English as the canonical release reference.
Use it for the exact commit and version being prepared; an old successful run
does not verify a new candidate.

## What triggers a release

`.github/workflows/release.yml` runs on every push to `main`, on a pushed `v*`
tag and on a manual dispatch. Every push to `main` publishes a new version:
there is no separate release step.

- The `test` job runs the kit, proxy and MCP bridge tests on Ubuntu and Windows
  (Node.js 26, Bun 1.4.2). The publish job runs only when it passes.
- The publish job runs for `main` and for version tags. A tag with a
  prerelease suffix (`vX.Y.Z-something`) is tested but never published, and a
  manual dispatch on another branch only runs the tests.
- The release workflow does not wait for the `ci` workflow, which checks more:
  Node.js 24 as well as 26, the proxy typecheck step, the output comparison
  and the memory budget. Let `ci` pass on the pull request before you merge.

## Version numbers

- On `main` the workflow picks the version. If the version in `package.json`
  is already on npm, or its tag points at another commit, it takes the next
  free patch version, writes it to `package.json`, `package-lock.json` and
  `pack/ALLOW_PUBLISH`, and pushes that commit to `main` together with the tag.
  The commit message ends with `[skip ci]`. Pull `main` afterwards.
- For a new minor or major version, set it in `package.json`,
  `package-lock.json` and `pack/ALLOW_PUBLISH` in the change you push. A
  version that is still free is used as it is.
- On a tag push the version comes from the tag. The tag, `package.json` and
  `pack/ALLOW_PUBLISH` must name the same version or the run fails. If that
  version is already on npm, the npm steps are skipped.

## Before a release-triggering change

- Review the source and let the `ci` workflow pass for the exact candidate.
- Confirm third-party redistribution rights and required notices for all
  shipped components. Do not infer third-party permission from this kit's
  root license.
- Check that release packages contain the intended application files and
  exclude credentials, local configuration, generated state, logs, and backups.
  The workflow builds the npm package with `node pack/build.mjs --tracked-only`
  from the allowlist in `pack/build.mjs` and checks it with
  `node pack/verify-payload.mjs`; a new file ships in the npm package only when
  the allowlist names it. The release tarball is a `git archive` of the
  commit; `.gitattributes` keeps `tests/`, `.github/` and `pack/` out of it.
- Verify installation and update behavior on the supported platforms,
  including preservation of existing user configuration.
- When the Node.js floor or the pinned Bun version changes, change every copy:
  `lib/node-floor.mjs`, `install.sh`, `install.ps1`, `pack/build.mjs`, the
  `engines` fields, both workflows and the documents that name the versions.
  The installers also carry the SHA-256 of each Bun archive they download.
- If the release needs written notes, add `docs/RELEASE_NOTES_vX.Y.Z.md` for
  the version that will be published. On `main` that is the next free patch
  version, not necessarily the one in `package.json`.

## During publication

- Check that the workflow completed successfully for the exact source commit.
- Verify the GitHub release and its assets: `vX.Y.Z.tar.gz`, `install.sh`,
  `install.ps1` and `checksums.txt`, which holds the SHA-256 of the other
  three. The installers and `zcode-kit update` download the tarball and
  `checksums.txt` by these names.
- Verify the exact package version is visible in the npm registry; release
  creation or a successful dry run alone does not prove npm publication. The
  workflow publishes with npm Trusted Publishing (OIDC, no token secret),
  retries the publish up to three times and then waits for the version to
  appear.
- A rerun keeps an existing GitHub release and continues with the npm steps.
  Do not replace assets attached to an existing version. Correct a published
  release with a new version.

## Installing a specific version

Both installers install the latest published release unless
`ZCODE_KIT_VERSION` names a tag (`vX.Y.Z`); `zcode-kit update --version vX.Y.Z`
does the same for an existing installation. For the installers and for
release installations, the GitHub release with that tag and its
`checksums.txt` must exist. The installers also accept a tag with a
prerelease suffix, but the workflow publishes none, so such a release has to
be created by hand.

## Release notes

For a version-specific GitHub release description, the workflow uses
`docs/RELEASE_NOTES_vX.Y.Z.md` when that file exists; otherwise GitHub
generates the notes. Keep release notes in English, focused on user-visible
changes, and current for that version. Do not put test outputs, audit reports,
private paths, credentials, or implementation investigation notes in this
public repository.
