# Release checklist — status as of the v0.2.0 preparation

## Done (prepared and verified)

- [x] Bun checksums embedded: `install.ps1` carries the real SHA256 of
  bun-v1.4.2 `bun-windows-x64.zip`; `install.sh` verifies linux-x64 and
  darwin-x64 per-platform before unzip. `install.ps1` is ASCII-only with
  UTF-8 BOM (Windows PowerShell 5.1 mis-parses BOM-less UTF-8 punctuation).
- [x] Release notes: `docs/RELEASE_NOTES_v0.2.0.md` (honest claims, provenance
  note included).
- [x] `pack/build.mjs` assembles the npm launcher package (215 files,
  allowlist-driven), `pack/verify-payload.mjs` gates on secrets/local state/
  required files, `npm publish --dry-run` passes.
- [x] `install.ps1` / `install.sh`: pinned-tag download, SHA256 verification
  against the release `checksums.txt`, user-local install, ZCODE_KIT_HOME
  override, WSL detection, atomic in-place update preserving `.proxykey`,
  `proxy/config.yaml`, logs and generated state.
- [x] Root `package.json` is `private: true` — `npm publish` at the repo root
  is structurally impossible; CI runs the suites before any publish step.
- [x] CI green on ubuntu-latest + windows-latest (kit 28/28, proxy 858/858,
  MCP 36/36) at commit `447e5a8`.

## The release itself (one command block, run by the maintainer)

```powershell
cd C:\Users\miche\zcode-agent-kit
git add -A
git commit -m "release: v0.2.0 - embed bun v1.4.2 checksums, release notes"
git push
git tag v0.2.0
git push origin v0.2.0
git archive --format=tar.gz -o release/v0.2.0.tar.gz v0.2.0
sha256sum release/v0.2.0.tar.gz release/install.ps1 release/install.sh > release/checksums.txt
gh release create v0.2.0 release/v0.2.0.tar.gz release/install.ps1 release/install.sh release/checksums.txt --title "zcode-agent-kit v0.2.0" --notes-file docs/RELEASE_NOTES_v0.2.0.md
```

(`release/` is git-excluded; the uploaded `v0.2.0.tar.gz` asset is a
deterministic `git archive` of the tag — the installer downloads the ASSET,
not GitHub's auto-generated archive. Provenance note is part of the release
notes: checksums.txt lives on the same host as the artifacts — integrity,
not provenance; verify the tag commit for provenance.)

## npm publication — still gated (deliberate)

1. Confirm the package name, add the `npm_token` repository secret.
2. Commit the empty marker file `pack/ALLOW_PUBLISH`.
3. The next GitHub release then publishes `pack/dist` via CI (the
   `npm-publish.yml` publish job is skipped without the marker).

**License gate before npm publication:** the vendored zcode-proxy
(`zcode-proxy-src/`) states MIT in its upstream README but the upstream
repository ships no LICENSE file. Do not publish the npm package before this
is clarified (contact upstream or pin to an upstream release that includes a
LICENSE). Do not re-label the vendored code as anything else.
