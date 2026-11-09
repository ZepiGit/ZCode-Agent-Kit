# kit-overhaul tickets

Published from `../tickets-draft.md` after the Round 5 changes (DECISIONS.md, Round 5). The `Blocked by` edges are authoritative; ticket 58 was split out of 28 and breaks the numeric order. Status strings follow `docs/agents/triage-labels.md`.

| NN | Title | Model | Risk | Blocked by | Status |
|---|---|---|---|---|---|
| 01 | [Memory loop with budgets, process-count harness, expected-RED ratchet and the ubuntu `memory-budget` job](01-memory-loop-budgets-and-ubuntu-memory-budget-job.md) | sol | medium | — | resolved |
| 02 | [Windows sampler and the windows leg of the `memory-budget` job (Bun 1.4.2 reference run)](02-windows-sampler-and-windows-memory-budget-leg.md) | sol | high | 01 | resolved |
| 03 | [S3 OMP stub-host leg in the memory loop](03-s3-omp-stub-host-leg.md) | sol | medium | 01, 02 | resolved |
| 04 | [Pre-existing findings: unwired tests, the test-wiring guard and CI Node coverage](04-unwired-tests-wiring-guard-and-ci-node-coverage.md) | glm | low | — | resolved |
| 05 | [Shared width core and token set (two renderers, one token set)](05-shared-width-core-and-token-set.md) | sol | medium | 01 | resolved |
| 06 | [CLI output module, capability record and the snapshot harness (no visible change)](06-cli-output-module-and-snapshot-harness.md) | glm | medium | 05 | resolved |
| 07 | [CLI command-module split, part 1 (expand: dispatcher + status/doctor/proxy/models/logs)](07-cli-command-modules-part-1-expand.md) | glm | medium | 06 | resolved |
| 08 | [CLI command-module split, part 2 (migrate remaining commands + contract)](08-cli-command-modules-part-2-migrate-and-contract.md) | glm | medium | 07, 10 | resolved |
| 09 | [Batch 1a — CI toolchain: actions v7, Bun 1.4.2 in CI, nested proxy workflows removed](09-batch-1a-ci-toolchain-and-bun-1-4-4-in-ci.md) | glm | low | 02, 03, 04 | resolved |
| 10 | [Batch 1b — Node 24 support floor, refuse before mutation, autostart Node-path check](10-batch-1b-node-24-floor.md) | glm | medium | 09 | resolved |
| 11 | [Batch 1c — Bun 1.4.2 bootstrap in the installers, pinned proxy typecheck (Round 11 pin)](11-batch-1c-bun-1-4-4-installers-and-proxy-typecheck.md) | glm | medium | 10 | resolved |
| 12 | [Batch 2 — proxy dependencies: happy-dom 21.0.4 (loading flags kept), undici 8.12.4, yaml 2.9.1](12-batch-2-proxy-dependencies.md) | glm | medium | 11 | resolved |
| 13 | [Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24](13-batch-3-mcp-dependencies.md) | glm | medium | 12 | resolved |
| 14 | [Event-line format and redaction for new log events (prefactor)](14-event-line-format-and-redaction.md) | glm | low | — | resolved |
| 15 | [Proxy lifecycle module: intents return outcome records, every caller uses them (prefactor for the lifecycle tickets)](15-proxy-lifecycle-module.md) | sol | high | 08, 13, 14 | resolved |
| 16 | [Start lock protocol v1 with proven takeover (no judge-then-rename race)](16-start-lock-protocol-v1-proven-takeover.md) | sol | high | 15 | resolved |
| 17 | [Start-lock release on signals, orphan adoption, respawn over a proven-stale lock](17-start-lock-signal-release-and-orphan-adoption.md) | sol | high | 16 | resolved |
| 18 | [Per-spawn proxy environment: stop token and log dir set by the manager, token stripped from the respawn hook](18-per-spawn-proxy-environment.md) | sol | medium | 15, 21 | resolved |
| 19 | [Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract](19-admission-control-and-503-shed.md) | sol | high | 13, 14 | resolved |
| 20 | [Fewer redundant request-body copies (bytes upstream unchanged)](20-fewer-request-body-copies.md) | sol | medium | 19 | resolved |
| 21 | [Health supervisor: one graceful shutdown sequence, footprint thresholds 512/1024 MB](21-health-supervisor-and-graceful-shutdown.md) | sol | high | 19, 14 | resolved |
| 22 | [Graceful stop request `POST /__kit/stop`, shared deadlines and the manager's stop path](22-graceful-stop-request-and-shared-deadlines.md) | sol | high | 18, 21, 40 | ready-for-agent |
| 23 | [Respawn acknowledgement before drain (a refused respawn leaves the proxy serving)](23-respawn-acknowledgement-before-drain.md) | sol | high | 17, 18, 21 | ready-for-agent |
| 24 | [Solver transport seam (prefactor): dispatcher state as an object, thread transport adapter](24-solver-transport-seam.md) | sol | medium | 12 | resolved |
| 25 | [Bounded-collection module; CDN memory cache and stall counters bounded](25-bounded-collections-cdn-memory-and-stall-counters.md) | glm | medium | 12 | resolved |
| 26 | [Captcha egress routing under Bun](26-captcha-egress-routing-under-bun.md) | glm | medium | 12 | resolved |
| 27 | [Solver as a child process: spawn, environment parity, lazy start, idle exit, one generation](27-solver-child-process.md) | sol | high | 24, 18, 26 | ready-for-agent |
| 28 | [Solver cap enforcement per OS and the cap handshake](28-solver-cap-enforcement-and-handshake.md) | sol | high | 27 | ready-for-agent |
| 29 | [CDN disk cache pruning](29-cdn-disk-cache-pruning.md) | sol | medium | 25 | resolved |
| 30 | [MCP task retention (500 / 7 days) and the idempotency window](30-mcp-task-retention-and-idempotency-window.md) | sol | high | 13 | resolved |
| 31 | [Per-task caps and 4 MiB head/tail truncation of task text](31-mcp-task-caps-and-text-truncation.md) | sol | medium | 30 | resolved |
| 32 | [TUI log pane capped at 2,000 lines and 8 MB](32-tui-log-pane-caps.md) | glm | low | 05, 11 | resolved |
| 33 | [`proxy.log` single rotator: size-capped writer, manager rotation under the lock, file modes](33-proxy-log-single-rotator.md) | sol | high | 14, 16, 18, 21 | resolved |
| 34 | [Early log (`proxy.early.log`): 1 MB cap and the tail copy into `proxy.log`](34-early-log-cap-and-tail-copy.md) | sol | medium | 33 | ready-for-agent |
| 35 | [OMP in-host single-flight preflight with the cause-line result record](35-omp-single-flight-preflight.md) | sol | high | 03, 15, 33, 71 | ready-for-agent |
| 36 | [MCP bridge: lazy HTTP transport and `--max-semi-space-size=1` in generated entries](36-mcp-bridge-lazy-http-and-semi-space-flag.md) | glm | medium | 13 | resolved |
| 37 | [`process.execve` handover in `zcode-kit run` and the `ZCODE_KIT_RESIDENT_LAUNCHER=1` opt-out](37-execve-handover-and-resident-launcher-opt-out.md) | sol | high | 15, 35, 36, 17 | ready-for-agent |
| 38 | [Manager `doctor` returns check records; `zcode-kit doctor` stops parsing text](38-manager-doctor-check-records.md) | glm | medium | 15 | resolved |
| 39 | [Observability fields in `/health` details, `proxy status` and `--json`](39-observability-fields.md) | glm | medium | 19, 21, 23, 40, 58 | ready-for-agent |
| 40 | [UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details](40-ux-batch-a-doctor-and-proxy-commands.md) | glm | medium | 38, 06 | ready-for-agent |
| 41 | [`doctor` memory checks: proxy memory, solver memory, cap enforcement, restart budget](41-doctor-memory-checks.md) | glm | medium | 39, 40 | ready-for-agent |
| 42 | [Account Rotator decision asked once, with migration](42-account-rotator-asked-once.md) | sol | medium | 08 | resolved |
| 43 | [UX batch (b1): compact `setup` report and `integrate --dry-run`](43-ux-batch-b1-compact-setup-and-integrate-dry-run.md) | glm | medium | 40, 42 | ready-for-agent |
| 44 | [UX batch (b2): installer stages, `install.sh`/`install.ps1` text and the PowerShell 5.1 stderr gate](44-ux-batch-b2-installers-and-powershell-gate.md) | glm | medium | 43, 11 | ready-for-agent |
| 45 | [UX batch (c1): grouped help, per-command `--help`, usage errors, output overrides](45-ux-batch-c1-help-usage-errors-overrides.md) | glm | low | 37, 40, 42 | ready-for-agent |
| 46 | [UX batch (c2): `accounts` (+health), `auth status`, `models`](46-ux-batch-c2-accounts-auth-status-models.md) | glm | low | 40 | ready-for-agent |
| 47 | [UX batch (c3): `run`, `update`, `rollback`, `uninstall`](47-ux-batch-c3-run-update-rollback-uninstall.md) | glm | medium | 40, 37 | ready-for-agent |
| 48 | [Proxy TUI redesign on the shared tokens](48-proxy-tui-redesign.md) | sol | high | 05, 32, 39 | ready-for-agent |
| 49 | [Proxy TUI log pane: filter, scroll, follow](49-proxy-tui-log-pane-filter-scroll-follow.md) | sol | medium | 48 | ready-for-agent |
| 50 | [Harness adapters: HIGH fixes (Continue, Kilo Code)](50-harness-adapters-high-fixes.md) | glm | low | — | resolved |
| 51 | [Harness adapters: confirmed MEDIUM fixes and record refresh](51-harness-adapters-medium-fixes.md) | glm | medium | 50 | resolved |
| 52 | [Docs: README × 5 at content parity](52-docs-readme-parity.md) | glm | medium | 10, 19, 21, 30, 31, 33, 34, 37, 41, 42, 43, 47, 58 | ready-for-agent |
| 53 | [Docs: SECURITY (+de), harness docs, MCP bridge READMEs × 5, `docs/MCP_API.md`, SUPPORT_MATRIX, MANIFEST](53-docs-security-harness-bridge-and-manifests.md) | glm | medium | 11, 13, 16, 22, 31, 51, 58, 57, 56 | ready-for-agent |
| 54 | [Release notes vNEXT and owner actions](54-release-notes-and-owner-actions.md) | glm | low | 29, 44, 45, 46, 48, 52, 53, 59, 61, 69 | ready-for-agent |
| 55 | [CI guardrails: snapshot-update refusal and an empty expected-RED list](55-ci-guardrails-snapshot-refusal-and-empty-expected-red.md) | glm | low | 06, 16, 17, 19, 20, 30, 32, 34, 35, 37, 58, 61, 74, and every typecheck-baseline ticket filed by 11, 67, 81 | ready-for-agent |
| 56 | [MCP SDK 2.x and protocol revision 2026-07-28 migration](56-mcp-sdk-2-migration.md) | sol | high | 13, 30, 31, 36, 57 | ready-for-agent |
| 57 | [MCP runtime restart budget (architecture candidate 8)](57-mcp-runtime-restart-budget.md) | sol | medium | 30, 36 | ready-for-agent |
| 58 | [Solver recycle triggers and failure semantics (abnormal-exit budget, fail-fast shed)](58-solver-recycle-and-failure-semantics.md) | sol | high | 19, 25, 28 | ready-for-agent |
| 59 | [Kilo `/v1/models` sheet line (part (b); effort normalisation moved to 63)](59-proxy-effort-normalisation-and-kilo-models-line.md) | glm | low | — | resolved |
| 60 | [S1/burst1 judged on the median of n fresh runs, every run ≤ 400 MB](60-s1-burst1-median-rule.md) | sol | medium | 01, 02 | resolved |
| 61 | [S1/stalled on Windows: proxy memory under many stalled streaming readers](61-s1-stalled-windows-response-side-memory.md) | sol | high | 02, 19, 20 | resolved |
| 62 | [Bun ≥ 1.4.3 raises the S1/burst1 proxy peak on the CI runners (re-entry gate for a newer Bun)](62-bun-1-4-3-plus-s1-burst1-peak.md) | sol | medium | 20 | needs-triage |
| 63 | [Proxy-side effort normalisation for native `/v1/messages` (Claude Code effort for `glm-*`)](63-claude-code-effort-normalisation-live-probe.md) | sol | medium | — | needs-info |
| 64 | [Sampler re-attribution after exec fails under CI load (test or sampler defect)](64-sampler-exec-reattribution-flake.md) | sol | medium | — | resolved |
| 65 | [S3/hung's stale-lock round is skipped when `manager start` exits 1](65-s3-hung-stale-lock-round-start-refused.md) | sol | high | — | resolved |
| 66 | [Windows S5/short re-listed under ticket 30 with a bounded unstable growth band](66-windows-s5-short-unstable-growth-band.md) | glm | low | — | resolved |
| 67 | [A plain expected-RED listing of a single-run key accepts any RED](67-plain-listing-hides-other-reds.md) | sol | medium | — | resolved |
| 68 | [Every writer of proxy/config.yaml and harness configs keeps the file's line endings (CRLF audit)](68-crlf-config-writers-audit.md) | sol | medium | 42 | resolved |
| 69 | [`ensureDeviceMidInConfig` reads past the end of an empty unquoted `deviceMid:` line](69-devicemid-reader-runs-past-line.md) | sol | high | 68 | resolved |
| 70 | [Windows: "stop cleanly kills a verified-own process" finds the process still alive](70-windows-stop-verified-own-process-flake.md) | sol | high | — | resolved |
| 71 | [Measurement rules for four rare tails: S7 retained heap, windows S1/short repetitions, the OMP no-op floor, linux S6/short repetitions](71-measurement-rules-rare-tails.md) | sol | low | 67 | resolved |
| 72 | [Memory-loop tests check a PID after the process died (Windows PID reuse)](72-memory-tests-pid-after-death.md) | sol | low | 70 | resolved |
| 73 | [Memory loop: `whileFrozen` resume and `scanWindows` filter by PID only](73-freeze-and-scanwindows-pid-identity.md) | sol | medium | 72 | resolved |
| 74 | [S5/short: which measurement separates a working retention bound from its mutant (needs triage)](74-s5-short-growth-after-retention-bound.md) | sol | medium | 30 | needs-triage |
| 75 | [Kit tests share fixed fixture ports (18458 and others): parallel test files collide](75-shared-fixture-ports-in-kit-tests.md) | sol | low | — | resolved |
| 76 | [The proxy test suite reaches the real upstream (zcode.z.ai:443)](76-proxy-tests-reach-real-upstream.md) | sol | high | — | resolved |
| 77 | [Windows kill guard refuses ~1 in 3,500 proxies (start-time ticks rounded through a JS Number)](77-windows-kill-guard-start-time-rounding.md) | sol | medium | — | resolved |
| 78 | [windows S1/short commit growth: repetition-position and tree effects](78-windows-s1-short-repetition-position-and-tree-effects.md) | sol | medium | — | needs-triage |
| 79 | [linux S1/stalled growth:proxy: tail and burst spread](79-linux-s1-stalled-growth-tail.md) | sol | low | — | needs-triage |
| 80 | [windows S2/short cdn-cache:memory-growth after ticket 29: A/B attribution](80-windows-s2-cdn-memory-after-29.md) | sol | medium | — | ready-for-agent |
| 81 | [windows S4: deliver a real console control event in the Ctrl-C-during-start trial](81-windows-s4-console-event-ctrl-c-trial.md) | sol | medium | 17 | ready-for-agent |
| 82 | [GitHub issue #32: safe failure diagnostics and latest-ZCode compatibility evidence](82-github-32-safe-failure-diagnostics-and-zcode-compatibility.md) | sol | high | — | needs-triage |

## Initial frontier

Tickets with no blockers:

- 01: [Memory loop with budgets, process-count harness, expected-RED ratchet and the ubuntu `memory-budget` job](01-memory-loop-budgets-and-ubuntu-memory-budget-job.md) (ready-for-agent)
- 04: [Pre-existing findings: unwired tests, the test-wiring guard and CI Node coverage](04-unwired-tests-wiring-guard-and-ci-node-coverage.md) (ready-for-agent)
- 14: [Event-line format and redaction for new log events (prefactor)](14-event-line-format-and-redaction.md) (ready-for-agent)
- 50: [Harness adapters: HIGH fixes (Continue, Kilo Code)](50-harness-adapters-high-fixes.md) (ready-for-agent)
- 57: [MCP runtime restart budget (architecture candidate 8)](57-mcp-runtime-restart-budget.md) (needs-triage)

Agent-grabbable (`ready-for-agent`): 01, 04, 14, 50. Awaiting triage (`needs-triage`): 57.
