# 54: Release notes vNEXT and owner actions

**Blocked by:** 29 (CDN disk cache pruning), 44 (UX batch (b2): installer stages, `install.sh`/`install.ps1` text and the PowerShell 5.1 stderr gate), 45 (UX batch (c1): grouped help, per-command `--help`, usage errors, output overrides), 46 (UX batch (c2): `accounts` (+health), `auth status`, `models`), 48 (Proxy TUI redesign on the shared tokens), 52 (Docs: README × 5 at content parity), 53 (Docs: SECURITY (+de), harness docs, MCP bridge READMEs × 5, `docs/MCP_API.md`, SUPPORT_MATRIX, MANIFEST), 59 (Kilo `/v1/models` sheet line), 69 (deviceMid reader stops at its own line)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: —

**What to build:** `docs/RELEASE_NOTES_vNEXT.md` (English) lists every user-visible change: Node 20/22 dropped (installer refuses first); the stream move; `WARN` with the additive JSON values and `completeness: partial`; `auth status` text on a TTY; rotator asked once + migration; the 503 shed incl. during a recycle drain; the solver as a separate process (visible in task managers), its cap and enforcement modes; thresholds 1536/3072 → 512/1024 MB; recycle count 200 → 100; MCP retention 500/7 days and the idempotency window; MCP task text capped at 4 MiB with a head/tail marker; CDN disk pruning; log rotation while running and `proxy.early.log`; Bun 1.4.4; compact setup by default; Windows graceful stop; execve handover exit status and `ZCODE_KIT_RESIDENT_LAUNCHER=1`; nested proxy workflows deleted; the proxy TUI refuses under TERM=dumb (exit 1) and prints the line-mode commands; the four new `doctor` checks; the additive `proxy logs --level/--grep` filters; harness configs refreshed on the next `setup`/`integrate` (Continue `capabilities`, Kilo Code `/v1`, the confirmed MEDIUM items, the bridge's `--max-semi-space-size=1`). `OWNER-ACTIONS.md` lists A1, A2 (incl. install.ps1 run), macOS terminals/execve/S3 footprint and the optional live smoke with copy-paste commands, each related criterion marked "unverified — owner action".

**Acceptance criteria:**

- [ ] A checklist test/grep confirms that every item of spec §16's release-notes list (including the four Round 5 additions) appears.
- [ ] Every "unverified" criterion in tickets 17, 28, 37, 44 points to an OWNER-ACTIONS entry.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 138, 144

## Comments

- 2026-11-07 (orchestrator, Owner Proxy round 11, binding): the kit pins **Bun 1.4.2** everywhere, not 1.4.4 (paired CI run 42352122623: Bun ≥ 1.4.3 raises the Linux S1/burst1 peak; ticket 62 owns re-entry). This explicitly amends Round 1 Q15, Round 2 Q10 condition 4 and the ADR-0016 Consequences line.
  For this ticket: the release notes state the stay-back reason (Bun 1.4.2 instead of the latest stable, with the paired numbers and ticket 62 as the re-entry path), as C5 requires a documented reason (Round 11 C6).

- 2026-11-07 (orchestrator, from ticket 10): the release notes announce that Node 20 and 22 are no longer supported (floor 24; setup/update refuse before mutating, exit 2, what/why/next), alongside the Bun 1.4.2 stay-back reason.

- 2026-11-07 (orchestrator, from ticket 59): the release notes list the refreshed Kilo Code sheet (the false 'Kilo fetches /v1/models' line is replaced; existing sheets refresh on the next setup/integrate).

- 2026-11-07 (orchestrator, from ticket 42): the release notes describe the Account Rotator question asked once, with automatic migration of the old answer.
