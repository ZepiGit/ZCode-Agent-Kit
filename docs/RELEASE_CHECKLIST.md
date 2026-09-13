# Release checklist — what is prepared vs. what needs maintainer action

## Already prepared and locally tested (no action needed)

- `pack/build.mjs` assembles the npm launcher package from tracked sources
  with an explicit allowlist (215 files, 2026-09-13), `pack/verify-payload.mjs`
  gates on secrets/local state/required files, `npm publish --dry-run` passes.
- `install.ps1` / `install.sh`: pinned-tag download, SHA256 verification
  against the release `checksums.txt`, user-local install, ZCODE_KIT_HOME
  override, WSL detection, atomic in-place update preserving `.proxykey`,
  `proxy/config.yaml`, logs and generated state.
- Root `package.json` is `private: true` on purpose — `npm publish` at the
  repo root is structurally impossible until a maintainer decides otherwise.
- CI: `.github/workflows/ci.yml` runs kit + proxy + MCP suites on
  ubuntu/windows; `npm-publish.yml` runs the same suites before any publish
  step and publishes nothing without the marker below.

## Maintainer actions required for an actual release (cannot be automated here)

1. **Publish rights / npm**: confirm the package name is available, add the
   `npm_token` repository secret, then — only then — create
   `pack/ALLOW_PUBLISH` (empty marker file) in a commit and cut the release.
   `npm-publish.yml` publishes only when that marker exists.
2. **Tag a release** `v0.2.0` (or later) from `main` and upload
   `install.ps1`, `install.sh`, the source tarball and a `checksums.txt`
   containing the SHA256 of each uploaded artifact.
3. **Embed the bun checksum**: `install.ps1` contains the placeholder
   `BUN_SHA256_TO_FILL_AT_RELEASE` — replace with the real SHA256 of
   `bun-windows-x64.zip` for the pinned bun release, and verify the POSIX
   download similarly (install.sh notes this inline).
4. **Second-channel provenance**: state in the release notes that the
   checksums.txt sits on the same host as the archive (integrity, not
   provenance) and link the tag commit for manual verification.
5. Re-run `node pack/build.mjs --dry-run-publish` from the release commit
   before uploading.

## License gates (audit §12)

- Root `LICENSE` (MIT) covers the kit's own code: `cli/`, `lib/`, `pack/`,
  `bin/`, `setup.mjs`, tests, docs, the `patches/` set.
- `mcp/zcode-harness-mcp/LICENSE` (MIT) added to match its package.json.
- `zcode-proxy-src/` (vendored from TriDefender/zcode-api): upstream README
  states "MIT" but the upstream repository ships **no LICENSE file**. This is
  unresolved publication territory: the vendored code is committed for local
  use, but **npm distribution of the package (pack/ALLOW_PUBLISH) must not go
  out before the upstream license question is clarified** (contact upstream
  or pin to an upstream release that includes a LICENSE). Do not re-label the
  vendored code as anything else.
