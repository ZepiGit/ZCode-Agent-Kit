# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Entries come from the git history; documentation-only and test-only commits are not listed.
This file is always written in English; non-English commit messages are translated.
Prerelease tags (`v0.2.22-account-rotator.*`) are folded into the next stable version.

## [Unreleased]

## [0.3.0] - 2026-11-13

Curated notes: [docs/RELEASE_NOTES_v0.3.0.md](docs/RELEASE_NOTES_v0.3.0.md).

### Added

- Recycle the solver on its footprint and contain its failures (f9ebd97)
- Run hands its process over to the harness on POSIX (e576a06)
- Build the bridge on MCP SDK 2.x, same 2025-era wire (3d67e5f)
- One preflight for OMP hosts that start together (6fc7496)
- Cap the solver process's memory through the operating system (a7d4b74)
- Run the captcha solver in a process of its own (9ba2908)
- Add --version, rewrite the help notes, fix the port lookup hint (319cb6c)
- Request graceful stop before guarded escalation (4699222)
- Render accounts, auth status and models through the output module (f8b0a9f)
- Add bounded onboarding checklist and qualified next commands (ada93df)
- Compact setup report by default; prompts on stderr; banner and TTY progress (d1e5e37)
- Integrate --dry-run lists every would-write and the undo command (478a768)
- Respawn acknowledgement before drain (5b43b46)
- Manager rotates proxy.log only under the start lock with no live proxy (8da4906)
- proxy.log size-capped writer, the proxy rotates its own log at 5 MB (7614674)
- Apply the 4 MiB cap to the transcript fallback (29f3c34)
- Cap per-task warnings (200), errors (200) and tool calls (1,000) (7c4c4d2)
- Bound task response text at 4 MiB while it is collected (68b37b4)
- Status and proxy commands render through the output module (70c28d4)
- Doctor shows each check once, grouped, with one verdict (8ae80d6)
- Lead, state and blank records; the connection card fits 80 columns (bcda0a3)
- Manager doctor returns check records; zcode-kit doctor stops parsing text (2500097)
- Set the stop token and logs dir at every proxy spawn (9ec7f49)
- Start lock protocol v1 with proven takeover, and no spawn window without a pid record (6157579)
- Health supervisor with one graceful shutdown sequence (512/1024 MB) (9961d3b)
- Retain terminal tasks for 500 tasks or 7 days and forget evicted idempotency keys (c8c9243)
- Lift the responses store's LRU, TTL and byte budget into a bounded collection (19f4a5e)
- Start the MCP bridge with --max-semi-space-size=1 in generated entries (580b237)
- Import the bridge's HTTP transport lazily (e2990a2)
- Admission control with a 64 MB in-flight byte cap and the 503 shed contract (93cb559)
- Ask the Account Rotator question once and remember the answer (83c4b09)
- Report the OMP autostart's pinned Node below the floor or missing (ee18504)
- Node 24 support floor for setup, update and the pack build (d129dfa)
- Gate install.sh and install.ps1 at Node 24, refuse before any change (df4b6b8)
- Add the capability record, the output module and the snapshot harness (be29e0f)
- Require the shared width core and token set in the payload (23d44bf)
- Grapheme width core from UCD 17 and a shared token set (f8c264d)
- Add the event-line logger and redact every manager log line (ad98a80)

### Changed

- Load the doctor and proxy report builders on use (e32d372)
- Require the status, log-tail and report modules in the payload (4229cec)
- Write the stop token only from the spawner's own record (e95a549)
- Encode the session identity's pieces into one reused buffer (9ccf978)
- Hash slices with nothing to escape without copying them (e0de0e0)
- Parse request bodies past 1 MiB straight from their bytes (147c87f)
- Transform translated requests without a text round trip (ec3ff73)
- Let go of the client body text once the upstream text exists (375bea2)
- Escape long strings of the session identity in slices (8499b94)
- Hash the session identity without building its full text (cc266d7)
- Let the session resolver read the parsed request body (25ff451)
- Read a request body with a Content-Length into one buffer (e2bbd28)
- Parse each request body once on the chat and messages routes (21d747f)
- Drop unreachable retention guards and pin the restore count (0a059ad)
- Solver dispatcher as an object over a transport seam (8e70e71)
- One proxy lifecycle module whose intents return outcome records (931a219)
- Move the remaining commands into command modules and contract the entry (f1927fe)
- Move status, doctor, proxy, logs and models into command modules (dd1a223)

### Fixed

- Keep the solver transport's detached steps from rejecting unhandled (39b667d)
- Log a sampling-mode cap exit from the proxy, widen the solver's environment filter, ask systemd once after a failure (7abb663)
- A busy token file is not a released token; a takeover gets the full start timeout (fb07d76)
- Keep the launcher resident when its output is a pipe (c7c80b5)
- Bridges sharing one data directory leave each other's tasks alone (d1f633d)
- Keep credentials out of the solver's environment and bound its log output (69baf09)
- The demo client reads the created session's id from the answer's session field (951c896)
- The capability registry no longer says computer-use events reach task events (b3a0ece)
- A permission option is an approval only when it is known to approve (6f30bdd)
- zcode_artifact_read returns the file content intact (becdf76)
- Take the block's line endings from the user's lines; Windows help baseline (495ff82)
- Address the findings of the release review (681ab81)
- A restart budget for the bridge's harness runtime (15eb505)
- Deduplicate stop reports and test portable deadlines (a0423ed)
- Preserve millisecond account health ages (cd7895a)
- Restore prior raw mode after handoff SIGINT (4bfcb76)
- Quarantine malformed controls and refresh intentional onboarding captures (1ae7f62)
- Restore selector lifecycle and pin full onboarding preservation (8e73ed2)
- Omit returned certifyIds from mint failure diagnostics (c443f33)
- Preserve canonical SDK error subtypes (ccf3331)
- Rebuild safe guest and solver failure diagnostics (362b099)
- Codex adapter prints the POSIX launcher on POSIX (833edb1)
- Metadata-only guest diagnostics, preserved 3012 classification, sanitized solver provenance, fail-closed claim preview (issue 32) (3b4a902)
- Discard cut log lines before redaction (5b5a896)
- Wide-script prose without spaces wraps between characters on a TTY (11abe6d)
- The terminal-frame guard reads only on demand (8d025d4)
- Replace a pid record whose process is gone by the proven orphan (9833b66)
- Adopt an orphaned proxy left without any pid record (e037fde)
- Release the start lock when a signal ends its holder (2a4006a)
- Hand large response chunks to the client in 64 KiB pieces (caf66db)
- Start lock treats Windows busy fs errors as contention (9bb23ec)
- Observe streamed answers in the client's path, not through tee() (e540752)
- O(1) retention check per request instead of a scan of every retained task (d8b34db)
- Keep the stop token out of the respawn hook's environment (b63f453)
- Resume a dead spawner's never-started proxy instead of spawning a second (6e99192)
- Compare the Windows start identity as exact integer ticks (760f5bd)
- Delete a CDN disk entry through a private tombstone so another installation's new envelope is never removed (9e92602)
- A start completes its own record when the start-time probe answers late; remove 16's cleared S3 lock names (80b231d)
- Leave a CDN disk entry alone when another installation replaced it since the scan (b4e9621)
- Skip temp files and files being written when pruning the CDN disk directory (5310f5a)
- Prune CDN disk entries only once expired at max(14 days, configured TTL) (b68f890)
- Bound the captcha CDN disk directory to 256 MiB, oldest entries first (56c5e2f)
- Type the parse-from-bytes path (6aa6b2b)
- A stop whose proxy's pid is reused after the kill reports it stopped (c81cf9f)
- Route captcha egress through Bun's proxy option (58d3935)
- Bound the solver's stall counters to 1,024 URLs, count only (5f09f4b)
- Cap CDN memory bodies at 32 MiB so the tier's memory stays within 64 MB (4a279e0)
- Bound the captcha CDN memory cache to 256 entries and 64 MiB (9ce256a)
- Admission gives bytes back when the handler ends, not on the abort signal (cfdcbb9)
- Read deviceMid from its own line only (f69e9fb)
- SDK ^1.32.2, zod ^4.6.6, TypeScript 7.0.2, @types/node ^24 (6ef55df)
- Every writer of a user-owned config keeps the file's line endings (ea84a63)
- Keep a CRLF proxy config CRLF when the Account Rotator setting is written (04dfbaa)
- Draw setup questions from the capability record, not readline's TERM check (503bc0a)
- Cap the log pane at 8 MB as well as 2,000 lines (e7918b4)
- undici ^8.12.4 and yaml ^2.9.1 (366cd10)
- happy-dom ^21.0.4 with CSS and iframe loading kept on (2c7bd87)
- Correct the Kilo Code /v1/models auto-fetch note (5bad9ca)
- Print the install.ps1 Node floor refusal as plain what/why/next lines (653ed43)
- Make the before-equivalence capture pass on the CI runners (37c1514)
- Apply the confirmed MEDIUM harness config fixes (615aca4)
- Write Continue capabilities as a string array and the Kilo Code base URL with /v1 (c98660d)

## [0.2.42] - 2026-10-03

### Fixed

- Fix account locks, proxy egress and Builder Event auto-claim (aaf6d8d)

## [0.2.41] - 2026-09-27

### Changed

- Remove unused kit helpers and simplify MCP runtime wiring (81bdc4a)

## [0.2.40] - 2026-09-27

### Changed

- Proxy: retry streams that fail before output, keep unsaved account state; kit: status --json, setup --select, doctor --forget/--upstream, rsync-free update (a7a8103)
- Proxy: retry the gateway codes the official client retries, frame-safe stream end; setup: --no-mcp never records MCP consent (2bdb271)
- Proxy: retry transient failures before output and end cut streams with an error; setup: separate MCP consent, exit code 20 (05d64fc)

### Fixed

- Review and CI findings on package 5 (installer exit code, mirror safety, prelude edge cases) (ff85d69)
- Setup: per-harness consent, copyable connection details, proxy rotator fixes (1d406ed)

## [0.2.39] - 2026-09-24

### Fixed

- Memoize the quota retry memo only after a fully run schedule (74d328f)

## [0.2.38] - 2026-09-24

### Fixed

- Failover on stale peer-quarantined handles, env knob pass-through (326dbb2)

## [0.2.37] - 2026-09-24

### Added

- Growing same-account retry schedule for 1005/1113 (092611a)

## [0.2.36] - 2026-09-24

### Added

- Update guarantees a running proxy on the updated code (012d20c)

## [0.2.35] - 2026-09-24

### Fixed

- Retry same account once on clean 1005/1113 quota envelopes (7ef1782)

## [0.2.34] - 2026-09-24

### Added

- Working zcode-kit update for every install type (9d6e50f)

## [0.2.33] - 2026-09-24

### Fixed

- Recover hung proxy, isolate captcha solver, add account health (b20d4ca)

## [0.2.32] - 2026-09-23

### Fixed

- Restore Windows Flash harness integration and runtime reliability (8929d39)

## [0.2.31] - 2026-09-22

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.30] - 2026-09-22

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.29] - 2026-09-22

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.28] - 2026-09-22

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.27] - 2026-09-22

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.26] - 2026-09-22

### Fixed

- Preserve account rotator prompt on terminal redraw (f890a1f)

## [0.2.25] - 2026-09-22

### Fixed

- Prompt for account rotation and retain authorized logins (dde1b85)

## [0.2.24] - 2026-09-22

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.23] - 2026-09-22

### Added

- Automatic account rotation, in 19 commits (48bdb44…f3c077b)
- Complete account rotator review remediation (a13d54f)

### Fixed

- Align status migration and claim selection (701255b)
- Consume account quotas sequentially (4e97167)

## [0.2.22] - 2026-09-20

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.21] - 2026-09-20

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.20] - 2026-09-20

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.19] - 2026-09-19

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.18] - 2026-09-19

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.17] - 2026-09-19

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.16] - 2026-09-19

### Fixed

- Enable managed CAPTCHA solving without guest crashes (74abb62)

## [0.2.15] - 2026-09-18

### Fixed

- Extend npm visibility window (ef08c8e)

## [0.2.14] - 2026-09-18

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.13] - 2026-09-18

### Fixed

- Allow npm propagation time (a58130a)

## [0.2.12] - 2026-09-17

### Fixed

- Honor explicit PATH casing on Windows (dcdfa68)
- Harden CLI, proxy, MCP, and installers (35a9c4a)

## [0.2.11] - 2026-09-16

### Fixed

- Proxy: cached captcha CDN bundles are syntax-checked, so truncated entries are fetched again (d586ac7)

### Security

- Proxy: the browser launcher accepts only http(s) URLs and no longer passes them through a shell (d586ac7)

## [0.2.10] - 2026-09-16

### Removed

- Remove temporary scanner-report scratch files (d0a3a35)

## [0.2.9] - 2026-09-16

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.8] - 2026-09-16

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.7] - 2026-09-16

### Changed

- Proxy: captcha CDN cache files are keyed by a hex digest of the URL; environment variable names are read without credential-shaped literals in the source (c0cb7b9)

## [0.2.6] - 2026-09-16

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.5] - 2026-09-16

Maintenance release: no user-facing changes beyond the release bump.

## [0.2.4] - 2026-09-16

### Security

- Proxy: requests made by the captcha CDN bundle are limited to an allowlist of hosts, blocking loopback, cloud metadata, LAN, `file:` and `data:` URLs (7da17b3)

## [0.2.3] - 2026-09-16

### Added

- Self-healing: `doctor --fix` reapplies the selected adapters, a shared launch preflight verifies the local proxy before start, setup sends one minimal test request, and credentials reload after a logout; Continue accepts an empty `models: []` (5a0e0fb)

## [0.2.2] - 2026-09-15

### Added

- Health check detects an OMP key-resolver path that belongs to another kit installation (401 errors after a reinstall) and points to `zcode-kit setup` (f3e6be8)

### Fixed

- Embed literal proxy key - omp 18+ ignores the !node resolver tag (401) (c598a09)
- Continue adapter no longer creates `~/.continue` when Continue is not installed; `doctor` exit code counts every failure shown, not only adapter checks (2ff5b48)

## [0.2.1] - 2026-09-15

### Added

- npm-callable CLI, latest-release installers, hardened pack build (058ba1b)
- `zcode-kit` works as a global npm install (realpath-safe entry check); installers remove a leftover command shim only when it belongs to the same installation (846b8fa)

### Changed

- Installers install the latest published release by default; `ZCODE_KIT_VERSION` pins a release, and downloads are verified against the release SHA-256 checksums (e96f0bb)
- `zcode-kit update` can finish on release installs (the checkout write guard no longer blocks it); `install.sh` verifies Bun 1.4.2 by SHA-256 and uses native arm64 builds on Apple Silicon and ARM Linux (b3372de)
- Adapters merge additively and update only provider entries that carry the kit's `x-zcode-agent-kit` marker; a hand-written `zcode` entry is reported as a conflict and left untouched (cc22fd9)
- Clean installer invocation (irm|iex + env vars), preserve config.yaml on update, checkout write guard (0d61235)
- Manager: fail-closed stop when process start time is undeterminable (audit: never kill on doubtful evidence) (a689c87)

### Fixed

- OpenCode and Continue adapters refuse configs they cannot edit safely (inline `models:` value, foreign `provider.zcode` entry) instead of writing duplicates (c9c4693)
- Fix omp adapter: take over legacy zcode-omp-integration block, fail closed on hand-written zcode entries (548894d)
- Installers extract the release archive into a separate folder, so the archive itself is no longer counted as a second top-level entry (569934d)
- Fix installer: git-archive prefix, single-top-dir check, explicit System32 tar (b4c7c8e)
- Fix install one-liner: scriptblock::Create instead of iex (BOM/param parsing); refresh release asset + checksums (ff85566)

## [0.2.0] - 2026-09-13

### Changed

- Audit remediation: transactions, fail-closed manager, MCP hardening, model registry, contract tests; zcode-kit CLI with 10 harness adapters; npm pack pipeline (gated) (cb13b38)
- Setup: harness detection - only configure detected harnesses (OMP-only users get no Claude/Codex artifacts) (dcd1c1a)
- Move ignore rules to .git/info/exclude, ship MCP bridge build (01cc460)
- ZCode Agent Kit: harness-agnostic GLM access via own ZCode Desktop account (2a3e175)

### Fixed

- Fix fresh-checkout: proper crypto imports in cli/context, race-safe ensureRuntimeFiles for tests (CI green) (6ee2622)

[Unreleased]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.42...v0.3.0
[0.2.42]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.41...v0.2.42
[0.2.41]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.40...v0.2.41
[0.2.40]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.39...v0.2.40
[0.2.39]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.38...v0.2.39
[0.2.38]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.37...v0.2.38
[0.2.37]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.36...v0.2.37
[0.2.36]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.35...v0.2.36
[0.2.35]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.34...v0.2.35
[0.2.34]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.33...v0.2.34
[0.2.33]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.32...v0.2.33
[0.2.32]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.31...v0.2.32
[0.2.31]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.30...v0.2.31
[0.2.30]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.29...v0.2.30
[0.2.29]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.28...v0.2.29
[0.2.28]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.27...v0.2.28
[0.2.27]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.26...v0.2.27
[0.2.26]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.25...v0.2.26
[0.2.25]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.24...v0.2.25
[0.2.24]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.23...v0.2.24
[0.2.23]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.22...v0.2.23
[0.2.22]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.21...v0.2.22
[0.2.21]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.20...v0.2.21
[0.2.20]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.19...v0.2.20
[0.2.19]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.18...v0.2.19
[0.2.18]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.17...v0.2.18
[0.2.17]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.16...v0.2.17
[0.2.16]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.15...v0.2.16
[0.2.15]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.14...v0.2.15
[0.2.14]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.13...v0.2.14
[0.2.13]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.12...v0.2.13
[0.2.12]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.11...v0.2.12
[0.2.11]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.10...v0.2.11
[0.2.10]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.9...v0.2.10
[0.2.9]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/ZepiGit/ZCode-Agent-Kit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ZepiGit/ZCode-Agent-Kit/releases/tag/v0.2.0
