# 44: UX batch (b2): installer stages, `install.sh`/`install.ps1` text and the PowerShell 5.1 stderr gate

**Blocked by:** 43 (UX batch (b1): compact `setup` report and `integrate --dry-run`), 11 (Batch 1c — Bun 1.4.4 bootstrap in the installers, pinned proxy typecheck, 1.4.4 attribution runs)

**Status:** ready-for-agent

Model: glm

Risk: medium

ADR: 0005

**What to build:** Installer-mode login hint shows `zcode-kit auth login zai`; install.sh `die` prints real newlines plus a next step; no escapes under TERM=dumb/NO_COLOR incl. install.sh; `[OK]/[SKIP]/[FAIL]/[WARN]` tags kept off a TTY; nesting under installer steps fixed. Closes A-01, A-06, A-13 (installers), A-21.

**Acceptance criteria:**

- [ ] Installer tests assert the login hint, newline rendering and no ESC bytes under TERM=dumb and NO_COLOR.
- [ ] windows-latest PowerShell 5.1 gate: installer setup call and shim with `2>&1`, `-File … 2> file` and `$ErrorActionPreference = "Stop"` → no NativeCommandError, exit codes unchanged; failures hardened in this ticket (build-time gate 5).
- [ ] Real conhost/PS 5.1 rendering recorded as owner action A2, unverified.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 94, 95, 96, 116

## Comments

- 2026-11-07 (orchestrator, from ticket 10): install.sh and install.ps1 now refuse Node < 24 before any download; reshape that error text with the rest of the installer UX. PowerShell 7 for Linux (digest-verified download, see ticket 10 Comments) gives a real parse check and early-path runtime proof of install.ps1 locally.
