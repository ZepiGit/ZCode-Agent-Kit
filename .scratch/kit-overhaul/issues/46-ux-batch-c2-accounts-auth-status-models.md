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

The audit found a real preservation defect in the original candidate: `healthRecords` divided `asOf` by 1000 although `account-health.ts` emits `lastUsedAt` in milliseconds (source lines 241,253,279-285). The old synthetic fixture also supplied seconds and hid that defect. Added a command-to-Out guard with literal millisecond timestamps: expected `used 2m ago` / `used 2h ago`, actual `used 0s ago` (RED 0 pass / 1 fail / 0 skip). Fixed only the presentation clock units and corrected the fixture; GREEN 1/0/0. Refreshed only the two affected health scenarios' 16 forced-C3 stdout snapshots, with their exact age changes reviewed. Existing ux-before age volatility rules were neither expanded nor weakened. The separate command-to-Out exact-age guard catches the renderer's unit error but did NOT exercise the real JSON producer/capture pipeline or detect the stale raw ux-before baselines. The independent rejection and raw pipeline correction below supersede that earlier coverage claim. Repair checkpoint: `cd7895adf1d11b2e95aa2f798bbf7fac414bb247`.

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

Result: **63 captures / 0 capture errors**, all nine scenarios in seven Linux variants, exit 0, 73 seconds. Bounded audit command `run-capped.sh t46-recovery-20261111-hwleex3t-scoped-audit 1G 60 -- node /home/AgentKit/overhaul-tools/t46-recovery-20261111-hwleex3t/audit-captures.mjs` returned exit 0: zero NORMALIZED Linux differences and zero NORMALIZED differences against the existing derived Windows pipe/ci files under the unchanged comparator. This was NOT zero raw differences: all 12 Linux accounts-health text/ANSI files and both derived Windows health files still contained the pre-fix `used 0s ago`, while the real post-fix capture printed `used 5d ago`. The existing relative-age rule masked that exact error; the historical exit 0 is not retroactively raw equivalence or pipeline coverage. Those Windows files are **derived, not native Windows evidence**; no baseline was refreshed during this continuation. Forced snapshots additionally cover wgl4. All 160 snapshot files survive; only the 16 exact health-age stdout files changed in this continuation.

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

### 2026-11-11 — independent rejection addressed: raw health pipeline and baseline provenance

The supplied independent review rejected candidate `8fd1d9ecca456522f40df918a0617eb3b0371d88` because the unchanged raw ux-before health baselines still contained the old 0s bug. That rejection was correct. The normalized-zero-diff claims above are corrected in place without relabeling the historical run as raw GREEN. Ticket status/acceptance remain unchanged.

**Starting state and complete audit.** Clean HEAD `8fd1d9e` on existing `ticket/46-swarm`, visible related-process scan empty (182 inaccessible `/proc` entries, not machine-wide exclusivity proof). Read GLOSSARY, ADR-0001/0005, ticket/seam/spec contracts and the entire product/test diff; all original changed paths and 160 forced snapshots were read and hashed. External evidence root: `/home/AgentKit/overhaul-tools/t46-age-pipeline-20261111/`. `initial.diff` is empty; `full-candidate.diff` is 185569 bytes, SHA256 `cbc3595f9161ee5a4b7100efe95c77a5b6e232a4eb89941791e651ac6c6f61ec`; all 251 starting paths are in `initial-path-hashes.json`. Original `f8b0a9f`, all later candidate history and the seven real preservation patches remain intact.

**Real path, not an invented JSON document.** `capture/fake-proxy.ts` forwards health CLI argv to the actual proxy source. `index.ts:1006-1013` fetches fixture-loopback `/accounts/status` + `/accounts/quota`, calls the real `buildHealthReport(..., Date.now())`, and serializes its `asOf`/millisecond `lastUsedAt`. The public kit CLI collects that JSON (`cli/commands/accounts.mjs:44-46,65-68`), passes it through the real account renderer and Out, and the real capture writer stores the text/ANSI. New test `tests/ux-before-capture.test.mjs:115-157` drives that entire path; it asserts literal `used 5d ago`, rejects `used 0s ago`, checks live millisecond JSON values and compares actual `.txt`/`.ansi` baseline bytes directly, with NO call to `compareCaptures` or `normaliseVolatile`. It runs all seven Linux capture variants, pipe/ci on actual Windows, and pins its child environment to UTC. It lives in the existing already-wired capture test file.

**Clock evidence and scope.** Fresh `live-before` at clean starting HEAD produced 14/14 health + health-JSON captures, zero capture errors, exit 0/27s. All 12 Linux raw health outputs differed from committed `f8b0a9f` ONLY in the two 0s→5d values. The health fixture now pins ONLY the health CLI's `Date.now()` to `2026-11-11T00:00:00Z`; listener timestamps stay `2026-11-05T12:00Z - 120000/-7200000` ms. Both ages are therefore 5d; the expired exhaustion and `empty` verdict stay unchanged. The initial Nov5 clock experiment was rejected: it legitimately changed personal's verdict to `exhausted` and column widths, so those outputs were NOT adopted (`baseline-red.log`, 0/1/0). No production clock, dependency, policy or timer changed. `compare.mjs` and global `capture.mjs` normalizers remain byte-identical to starting HEAD.

**RED → GREEN, freshly executed under the original hard cap.** Every command below runs at cwd `/home/AgentKit/wt/t46` through unchanged `/home/AgentKit/overhaul-tools/run-capped.sh`, 1G MemoryMax/no swap, isolated HOME/XDG, fixture-only upstreams and explicit timeout. `run-check.py` records exact argv/HOME/TZ/checkpoint/PID/PGID/exit in external `*.command.json`. New ignored harness logs and append-only run-pids are the sole controller-authorized integration writes.

- `run-capped.sh t46-age-pipeline-20261111-raw-red 1G 120 -- node --test --test-name-pattern 'accounts health raw capture pipeline' tests/ux-before-capture.test.mjs`: 0 pass / 1 fail / 0 skip, exit 1/38s (uncontrolled 5d versus planned literal 2m; retained experiment).
- `run-capped.sh t46-age-pipeline-20261111-age-only-baseline-red 1G 120 -- node --test --test-name-pattern 'accounts health raw capture pipeline' tests/ux-before-capture.test.mjs`: 0/1/0, exit 1/31s; correct controlled 5d output fails raw old 0s baseline equality, with every other output byte identical.
- `run-capped.sh t46-age-pipeline-20261111-reviewed-clock 1G 150 -- node tests/ux-before/capture/capture.mjs --kit /home/AgentKit/wt/t46 --out /home/AgentKit/overhaul-tools/t46-age-pipeline-20261111/reviewed-clock --only '^accounts-health(-json)?$'`: 14 captures / zero errors, exit 0/29s. `raw-green` with the same named guard after reviewed baseline correction: 1/0/0, exit 0/30s.

**Exact raw refresh, not a global baseline rewrite.** Only the following 14 existing raw health files changed: seven Linux `.txt` plus five TTY `.ansi`, and two historically derived Windows `.txt`. Every file has exactly two `used 0s ago`→`used 5d ago` substitutions (28 total); every other byte is unchanged and equals the fresh real Linux output. Old files, old INDEX/manifests and every exact raw unified diff are saved under `old-before/` and `raw-diff-hashes.json`. JSON outputs, health-down, auth, models and all 160 forced snapshots were not refreshed. Matching metadata only: seven Linux health rows now describe actual ANSI/width/glyphs/timing; two derived Windows health rows describe their bytes and explicitly retain historical timings with `nativeWindowsExecuted: false`, `msHistorical: true`. Corresponding index rows and derivation disclosures were corrected.

| Raw path under `tests/ux-before/` | Old SHA256 | New SHA256 |
|---|---|---|
| linux/accounts/accounts-health/ascii-locale.ansi | cb00263b1eb4dbad1b7a9ee8bf7e0fc2eb55c966e4674da9b76b15833c81fbbb | 03073ad9b37cb8b8fc12d8faf9de5611c89d51ff6aeefc8626ba1feecbfc34f9 |
| linux/accounts/accounts-health/ascii-locale.txt | 89bd3a1f0b70eab552504eb834cc58e0ff5365badfe560c57d7cf134233fe478 | 5d13f76d9fe6c3c14dd3ff4947635683a3dc250b8de9409ac6ca363d2f4041b2 |
| linux/accounts/accounts-health/ci.txt | a5ec6e662739bd46bfb76161451bacd7928f54c663b91b4e7d3b22a712663a7f | 331576e5b9e1402508544cd949dac1e7607f888bd3378cd2175aa6092fddc3fd |
| linux/accounts/accounts-health/no-color.ansi | e6209c00115ed8af2edb4fd52fec8d8e685a477ed5b3a5f6f70f8dc474346038 | 0e2c52dec45b112f2a05d90cc81a38138664e6ba2d6a4d28fb7e4602e86f689c |
| linux/accounts/accounts-health/no-color.txt | e6209c00115ed8af2edb4fd52fec8d8e685a477ed5b3a5f6f70f8dc474346038 | 0e2c52dec45b112f2a05d90cc81a38138664e6ba2d6a4d28fb7e4602e86f689c |
| linux/accounts/accounts-health/pipe.txt | a5ec6e662739bd46bfb76161451bacd7928f54c663b91b4e7d3b22a712663a7f | 331576e5b9e1402508544cd949dac1e7607f888bd3378cd2175aa6092fddc3fd |
| linux/accounts/accounts-health/term-dumb.ansi | 89bd3a1f0b70eab552504eb834cc58e0ff5365badfe560c57d7cf134233fe478 | 5d13f76d9fe6c3c14dd3ff4947635683a3dc250b8de9409ac6ca363d2f4041b2 |
| linux/accounts/accounts-health/term-dumb.txt | 89bd3a1f0b70eab552504eb834cc58e0ff5365badfe560c57d7cf134233fe478 | 5d13f76d9fe6c3c14dd3ff4947635683a3dc250b8de9409ac6ca363d2f4041b2 |
| linux/accounts/accounts-health/tty-color-120.ansi | c98d870d64029c241cdd0e62008cd890b77e30e17a7b750ddcc8d6f6d2229f1a | 3ccd5265d299522849b516137ceb7c235aa441d95f4196dd0067678259bd8576 |
| linux/accounts/accounts-health/tty-color-120.txt | a5ec6e662739bd46bfb76161451bacd7928f54c663b91b4e7d3b22a712663a7f | 331576e5b9e1402508544cd949dac1e7607f888bd3378cd2175aa6092fddc3fd |
| linux/accounts/accounts-health/tty-color-80.ansi | 1c13af5dd7c6de1f5464437205aba74c4007cffe6ae6c2647613654c22352f7a | 4934b49af583c6ff4175a27a42e72854f3db84e34fc4b3256d0fd1c9b29db55b |
| linux/accounts/accounts-health/tty-color-80.txt | e6209c00115ed8af2edb4fd52fec8d8e685a477ed5b3a5f6f70f8dc474346038 | 0e2c52dec45b112f2a05d90cc81a38138664e6ba2d6a4d28fb7e4602e86f689c |
| windows/accounts/accounts-health/ci.txt | a5ec6e662739bd46bfb76161451bacd7928f54c663b91b4e7d3b22a712663a7f | 331576e5b9e1402508544cd949dac1e7607f888bd3378cd2175aa6092fddc3fd |
| windows/accounts/accounts-health/pipe.txt | a5ec6e662739bd46bfb76161451bacd7928f54c663b91b4e7d3b22a712663a7f | 331576e5b9e1402508544cd949dac1e7607f888bd3378cd2175aa6092fddc3fd |

Windows derivation is limited to these existing path-free, colour-free, ASCII pipe/ci outputs: old Windows bytes already equaled old Linux bytes; the only new substitutions are the independently checked elapsed ages. This follows the existing disclosed ticket46 derivation policy, not arbitrary cross-platform copying. No Windows execution is claimed. Fresh native Windows capture/CI still has to accept or reject these bytes.

**Actual product negative control and exact restoration.** From clean own checkpoint `664eba062307c3028e1b738c048f07eb7d56d4ac`, `prove-product-mutant.py` uniquely changed production `const nowMs = Date.parse(doc.asOf)` to `Math.floor(Date.parse(doc.asOf) / 1000)`, saved the nonempty patch and hashes, then ran `run-capped.sh t46-age-pipeline-20261111-product-mutant-red 1G 120 -- node --test --test-name-pattern 'accounts health raw capture pipeline' tests/ux-before-capture.test.mjs`. Result 0/1/0, exit 1/31s, actual `used 0s ago` rejected by the literal 5d assertion before baseline comparison. Patch SHA256 `842afa8b3e8c18eade3345cc63251aac5b63137020e4a0eb4ac38bffb72e3c7e`; original production SHA256 `935d4a1f44d7a57d5e6ed12cfa41887a64578a0e250bacedd7574bcc26b3cdd4`; exact owned mutant bytes restored to the committed original and clean status proved before further tests. `product-age-mutant.{patch,json,output,original}` records this execution. The previous seven real mutants were read/hash-verified, NOT rerun in this ask. Original no-op `reports/t46-mut4.log` is still SHA256 `aaee106f90e527845a8a4359e3df40d33aee97301df45c06ac9b06579e61f4e2`, 90/0/0, not a kill.

**Fresh complete named targeted + C3 batch after restoration (not test:all):**

```sh
/home/AgentKit/overhaul-tools/run-capped.sh t46-age-pipeline-20261111-affected-c3-green 1G 480 -- bash -c 'bun --version && node --version && node --test tests/cli-ux-accounts-auth-models.test.mjs tests/cli-commands.test.mjs tests/term-output.test.mjs tests/term-snapshots.test.mjs tests/term-boundaries.test.mjs tests/cli-ux-streams.test.mjs tests/test-wiring.test.mjs tests/json-superset.test.mjs tests/ux-before-capture.test.mjs tests/term-caps.test.mjs tests/width-core.test.mjs'
```

Executed at clean own checkpoint `664eba0`: **350 pass / 0 fail / 0 skip**, exit 0/48s, Bun **1.4.2**, Node **26.7.0**. All original eight named files ran in full, plus the full affected capture suite and caps/width tests. The new raw pipeline guard passed inside that full targeted batch; prior auth JSON/model bytes, stream routing/asymmetric TTY and all eight forced C3 variants remain green.

Fresh scoped capture: `run-capped.sh t46-age-pipeline-20261111-scoped-final 1G 180 -- node tests/ux-before/capture/capture.mjs --kit /home/AgentKit/wt/t46 --out /home/AgentKit/overhaul-tools/t46-age-pipeline-20261111/scoped-final --only '^(accounts-(empty|list|health|health-json|health-down)|auth-status-(running|down)|models-(running|json-down|show-key))$'`: **70 captures, zero errors**, exit 0/98s. `run-capped.sh t46-age-pipeline-20261111-scoped-audit 1G 60 -- node /home/AgentKit/overhaul-tools/t46-age-pipeline-20261111/audit.mjs`: exit 0, 14 raw health files byte-exact, 28 age substitutions, zero normalized Linux/derived-Windows differences, only 7+2 metadata rows changed, every other metadata row retained, historical mut4 intact. Complete hash inventory in `final-audit.json`.

**Remaining gates.** Ready for central validation and fresh independent Grok-only review ONLY. No worker test:all, build, memory-budget/soak, full ux-before equivalence run, CI dispatch, native Windows/macOS/conhost/Windows Terminal/PowerShell 5.1, push or integration/staging merge. No fullsuite or platform acceptance inferred from supplied old logs. Metrics delta not measured. Production diff from starting candidate is empty; MCP dist, version, dependencies, normalizers, JSON baselines and all forced snapshots unchanged. No installed kit/running proxy/real store/token/harness configuration accessed. Task-observer is controller-owned; no subagent observation records.
