# Release checklist

This maintainer guide is kept in English as the canonical release reference.
Use it for the exact commit and version being prepared; an old successful run
does not verify a new candidate.

## Before a release-triggering change

- Review the source and run the required CI checks for the exact candidate.
- Confirm third-party redistribution rights and required notices for all
  shipped components. Do not infer third-party permission from this kit's
  root license.
- Check that release packages contain the intended application files and
  exclude credentials, local configuration, generated state, logs, and backups.
- Verify installation and update behavior on the supported platforms,
  including preservation of existing user configuration.
- Confirm that package metadata, the release tag, and the release marker agree.
- Review `.github/workflows/release.yml` before pushing to `main`: a main-branch
  push can run the stable release and npm publication workflow automatically.

## During publication

- Check that the workflow completed successfully for the exact source commit.
- Verify the GitHub release, its expected assets, and their published checksums.
- Verify the exact package version is visible in the npm registry; release
  creation or a successful dry run alone does not prove npm publication.
- Do not replace assets attached to an existing version. Correct a published
  release with a new version.

## Release notes

For a version-specific GitHub release description, the workflow uses
`docs/RELEASE_NOTES_vX.Y.Z.md` when that file exists. Keep release notes in
English, focused on user-visible changes, and current for that version. Do not
put test outputs, audit reports, private paths, credentials, or implementation
investigation notes in this public repository.

The `feature/account-rotator` branch has a prerelease workflow; consult the
workflow definition for its current behavior and verify its run separately.
