# Release notes — zcode-agent-kit v0.2.1

Maintenance release: the third-round audit findings (P0) are fixed, the kit is
now npm-installable, and both installers resolve the latest release by default.

## Fixed (audit P0)

- **macOS stop/restart**: `spawnSync` was used but never imported in the proxy
  manager — the darwin process-start-time probe threw a swallowed
  ReferenceError and stop/restart refused fail-closed. Fixed, with a static
  import-coverage regression test.
- **Installer on macOS**: the release-tarball checksum used `sha256sum`
  (absent on stock Darwin), and the bun checksum helper's `||` fallback was
  dead code (awk exits 0 on empty input). Both fixed; bun is now downloaded
  natively for darwin-arm64 and linux-aarch64 (pinned SHA256s from upstream
  SHASUMS256.txt).
- **Tests never touch the real login**: the credential-store path is
  injectable (`ZCODE_PROXY_CREDENTIALS_PATH`); the test suite runs against a
  temp store instead of `~/.zcode-proxy/credentials.json`.
- **First-run template**: the vendored config template shipped
  `host: 0.0.0.0`, which the loader rejects — first-run serve died. The
  template and example now ship loopback, guarded by a template-vs-loader
  consistency test.
- **MCP `--read-only` bypass**: `zcode_operation_invoke` allowed
  `session/goal` (whose action enum includes set/replace/pause/resume/clear)
  without the write gate. Removed from the invoke allowlist; mutating access
  stays with `zcode_session_goal` (requireWritable).
- **`zcode-kit update`**: the re-setup step hit the checkout-write guard, so
  update could never finish on a checkout. `update` now implies the opt-in,
  proven end-to-end in a fixture git repo.

## Added

- **npm**: `zcode-agent-kit` is published to the npm registry
  (`npm install -g zcode-agent-kit` / `npx zcode-agent-kit setup`). The CLI
  entry check is realpath-canonical — it works through npm's symlink/junction
  shims and case-variant paths (previously the CLI silently no-oped there).
  Both `zcode-kit` and `zcode-agent-kit` commands are exposed.
- **Installer shim**: the installers create a user-scope `zcode-kit` command
  (Windows: `%LOCALAPPDATA%\Microsoft\WindowsApps`, POSIX: `~/.local/bin`);
  `zcode-kit uninstall` removes a shim only when it points at its own root.
- **Latest-release installers**: both installers resolve the latest published
  release via the GitHub API by default; `ZCODE_KIT_VERSION` pins a version.
  The README one-liners use the versionless
  `releases/latest/download/...` URLs.
- **pack build**: tolerates a process holding `pack/dist` as its working
  directory (Windows EPERM) by emptying it in place.

## Verification

kit 57/57 (`npm test`), proxy 872/872 (`npm run test:proxy`), MCP 42/42
(`npm run test:mcp`) at the release commit.

## Provenance & known open items

- `checksums.txt` lives on the same host as the artifacts — integrity, not
  provenance; verify the tag commit for provenance.
- License gate (carried over from v0.2.0): the vendored `zcode-proxy-src`
  states MIT upstream but ships no LICENSE file. Publication proceeded with
  this item still open; clarification with upstream remains outstanding.
- The Mimosa L3 project scan reports findings in `captcha-happy.ts` (weak
  crypto / code injection) that are inherent to the CAPTCHA solver's function
  (it patches an obfuscated target VM and computes custom proof-of-work
  hashes — audit finding M6), plus dummy credentials in test fixtures. They
  are reviewed and accepted by the maintainer for this release.
