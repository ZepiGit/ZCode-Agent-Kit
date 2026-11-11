# 46: UX batch (c2): `accounts` (+health), `auth status`, `models`

**Blocked by:** 40 (UX batch (a): `doctor`, `proxy start/status/stop/restart/logs`, connection details)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: 0001, 0005

**What to build:** Account tables with an active marker, one number format and `zcode-kit …` in next steps (A-19, A-27); `auth status` as text on a TTY, today's exact JSON when stdout is not a TTY, JSON on a TTY with `--json`; `models` through `Out`.

**Acceptance criteria:**

- [ ] `auth status` piped output byte-identical to the pre-change JSON; `--json` on a TTY identical too.
- [ ] Snapshots in every C3 variant; JSON superset tests.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 95, 102, 114

## Comments

### 2026-11-11 — authorized GPT fallback continuation; central candidate only

Preserved the existing `ticket/46-swarm` worktree and original commit `f8b0a9fa2285ca0c281f68a9103f2e67872f6d74` without reset, stash, rebase or replacement. Prerequisite 40 was checked in the canonical ticket: `**Status:** resolved` (line 5). No acceptance checkbox or ticket status is changed here. Independent Grok-only review and central full-suite/platform gates remain required.

Before edits, inspected process cwd/argv and write-capable descriptor metadata, excluding this reader's ancestor chain: no visible t46 writer; 188 inaccessible `/proc` entries mean this is not machine-wide proof. The controller-assigned exclusive ticket ownership is retained. External evidence root: `/home/AgentKit/overhaul-tools/t46-recovery-20261111-hwleex3t/`. `ownership.json`, `initial-status.txt` (empty), `initial-working.diff` (empty), `candidate.diff` (174378 bytes, SHA256 `22e2342dd44f05be640bbb17a2de50e4bb4bfb0d7e52031f4eeed26bd08945a2`) preserve the actual starting state.

#### Actual diff and preservation audit

Read the actual code/test diff and inventoried every committed path/content: **250 = 160 snapshot files + 82 ux-before files + 8 code/test/package paths**, not the earlier incorrect 176/66 breakdown. `250-file-and-capture-audit.json` records every file hash and the exact six intentionally changed baseline scenarios. Original baseline comparators, JSON baseline and pre-change JSON captures remain unchanged. The original `cli-commands.test.mjs` changes are justified by the migration from verbatim text records to Out data records for models; their expected bytes/exit codes remain identical. The removed bare-accounts forwarding case is replaced by the public command seam's rendered-table and exit assertions; JSON/live/management forwarding remains covered.

The audit found a real preservation defect in the original candidate: `healthRecords` divided `asOf` by 1000 although `account-health.ts` emits `lastUsedAt` in milliseconds (source lines 241,253,279-285). The old synthetic fixture also supplied seconds and hid that defect. Added a command-to-Out guard with literal millisecond timestamps: expected `used 2m ago` / `used 2h ago`, actual `used 0s ago` (RED 0 pass / 1 fail / 0 skip). Fixed only the presentation clock units and corrected the fixture; GREEN 1/0/0. Refreshed only the two affected health scenarios' 16 forced-C3 stdout snapshots, with their exact age changes reviewed. Existing ux-before age volatility rules were neither expanded nor weakened; a separate exact-age guard now prevents those existing normalizers from concealing this regression. Repair checkpoint: `cd7895adf1d11b2e95aa2f798bbf7fac414bb247`.

Added an asymmetric-terminal preservation guard: stdout pipe + stderr TTY must retain exact legacy JSON with no extra diagnostic bytes; stdout TTY + stderr pipe must retain the human report and plain stderr WARN/next lines. Committed guard checkpoint: `711bf612510e283e7e1c285083c1214347038775`. No production stream-policy change was necessary.

#### Fresh commands and results (not archived passes)

Every check used the **unchanged** `/home/AgentKit/overhaul-tools/run-capped.sh` with MemoryMax=1G, MemorySwapMax=0, explicit timeout, pinned Bun 1.4.2, Node v26.7.0, isolated HOME/XDG and fixture-only upstreams. The external `run-check.py` records exact wrapper argv, cwd, HOME, checkpoint, PID/PGID and exit in uniquely named `.command.json` files. Controller escalation explicitly allowed only ignored new `reports/t46-recovery-20261111-hwleex3t-*.log` outputs plus append-only `reports/run-pids.txt`; `check-ignore`, `ls-files` and absence were checked before each log. No other integration write, installation or configuration change was made.

Final targeted command at clean checkpoint `711bf612510e283e7e1c285083c1214347038775` (cwd `/home/AgentKit/wt/t46`, external OVERHAUL_HOME, TZ=UTC):

```sh
/home/AgentKit/overhaul-tools/run-capped.sh t46-recovery-20261111-hwleex3t-candidate-green 1G 240 -- bash -c 'bun --version && node --version && node --test tests/cli-ux-accounts-auth-models.test.mjs tests/cli-commands.test.mjs tests/term-output.test.mjs tests/term-snapshots.test.mjs tests/term-boundaries.test.mjs tests/cli-ux-streams.test.mjs tests/test-wiring.test.mjs tests/json-superset.test.mjs'
```

Result: **288 pass / 0 fail / 0 skip**, exit 0, 20 seconds. This is a targeted eight-file batch, **not** `test:all`. The ticket suite alone is 24/0/0; the JSON superset suite separately executed 3/0/0. Prior fresh checkpoint runs were 283/0/0 before the repair, 284/0/0 after the age guard, and 287/0/0 with JSON before the asymmetric guard; these are repeated coverage, not additional unique tests.

Relevant-only real spawned capture command:

```sh
/home/AgentKit/overhaul-tools/run-capped.sh t46-recovery-20261111-hwleex3t-scoped-capture 1G 300 -- node tests/ux-before/capture/capture.mjs --kit /home/AgentKit/wt/t46 --out /home/AgentKit/overhaul-tools/t46-recovery-20261111-hwleex3t/capture --only '^(accounts-(empty|list|health|health-down)|auth-status-(running|down)|models-(running|json-down|show-key))$'
```

Result: **63 captures / 0 capture errors**, all nine scenarios in seven Linux variants, exit 0, 73 seconds. Bounded audit command `run-capped.sh t46-recovery-20261111-hwleex3t-scoped-audit 1G 60 -- node /home/AgentKit/overhaul-tools/t46-recovery-20261111-hwleex3t/audit-captures.mjs` returned exit 0: zero Linux baseline differences and zero differences against the existing derived Windows pipe/ci files under the unchanged comparator. Those Windows files are **derived, not native Windows evidence**; no baseline was refreshed during this continuation. Forced snapshots additionally cover wgl4. All 160 snapshot files survive; only the 16 exact health-age stdout files changed in this continuation.

RED/GREEN logs live in canonical ignored `reports/` with prefix `t46-recovery-20261111-hwleex3t-`: `age-red.log` (0/1/0, behavioral assertion), `age-green.log` (1/0/0), `candidate-green.log` (288/0/0), `json-superset.log` (3/0/0), `scoped-capture.log`, `scoped-audit.log`. Archived original RED/GREEN logs remain historical only; no original launch-command provenance is invented.

#### Committed-checkpoint mutation proof

`prove-mutants.py` required clean HEAD `cd7895adf1d11b2e95aa2f798bbf7fac414bb247`, asserted an exact unique replacement and changed bytes, saved each nonempty patch plus before/after hashes, ran `run-capped.sh <unique-name> 1G 60 -- node --test tests/cli-ux-accounts-auth-models.test.mjs`, then restored **only** its exact owned mutant bytes and proved clean byte identity with the checkpoint after every mutant. No test/snapshot was mutated. `mutation-results.json` and `mut1-*.patch` through `mut6-*.patch` hold the complete protocol. Results (pass/fail/skip, each 23 tests):

| Mutant | Observable regression | Result |
|---|---|---|
| 1 | auth JSON boolean becomes string | 19/4/0, exit 1 |
| 2 | extra newline in models data | 20/3/0, exit 1 |
| 3 | missing percent-space | 22/1/0, exit 1 |
| 4 | empty-account next command changed to standalone binary | 21/2/0, exit 1 |
| 5 | health failure next command changed to standalone binary | 21/2/0, exit 1 |
| 6 | asOf milliseconds divided by 1000 again | 20/3/0, exit 1 |

Mutant 7 used the later clean committed checkpoint `711bf612510e283e7e1c285083c1214347038775`: `stdout.isTTY` changed to `stderr.isTTY`; the named asymmetric guard returned **0/1/0**, exit 1, then exact owned restoration. Evidence: `prove-asymmetric.py`, `mut7-asymmetric.patch`, `mut7-asymmetric.output` and the corresponding command JSON/log. Final 288/0/0 run followed restoration.

The old surviving/no-op attempt `reports/t46-mut4.log` is deliberately retained unchanged, SHA256 `aaee106f90e527845a8a4359e3df40d33aee97301df45c06ac9b06579e61f4e2`; its 90/0/0 result is **not** a killed-mutant proof. The new mutant4 proves the intended A-19 next-command mutation is applied and detected; the old edit itself is unrecoverable from the archived verdict-only log and is not reconstructed.

#### Limits and next gate

No `test:all`, memory-budget/soak job, build, native Windows/macOS or PowerShell 5.1 gate, exact-head CI, independent reviewer, push or integration merge was run. Memory metrics delta is **not measured**. No new dependency/config/env override/log event or anti-abuse behavior was introduced. Installed kit, running proxies, real account/token stores and real harness configurations were untouched; fixtures only. This is **ready for central validation and independent Grok-only review**, not ticket acceptance. Task-observer protocol/logging remains controller-owned; no observation record was written by this subagent.
