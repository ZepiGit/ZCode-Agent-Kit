# Round 1: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. DECISIONS.md had no earlier entries, so none of these answers contradicts an earlier decision. I checked the evidence myself in `diagnosis/memory-report.md`, `diagnosis/data/*.summary.json`, `METRICS.md`, `reports/architecture.md`, `reports/drift.md`, `ux/ux-audit.md`, `ux/design-language.md`, `ux/handoff-prototype.md`, `ux/prototype/`, `research/*.md` and the repo at c4933c2 (`install.ps1`, `lib/proxy-env.mjs`, `cli/account-setup.mjs`, `cli/zcode-kit.mjs`, `.github/workflows/ci.yml`, `zcode-proxy-src/.github/workflows/ci.yml`). Where the evidence differs from the round's summary, the answer says so.

Each answer below is a decision. Where it is ACCEPTED with conditions, the conditions bind the spec and the tickets.

---

## Q1 — Terminal design variant (1C pick)

**DECISION:** REJECTED as worded. My decision: adopt A (Ledger) as the base. Take three parts from C: the help shape (examples first), a failure-first lead line in `doctor` when anything failed, and the TUI sidebar at ≥100 columns. That much is as recommended. Add these binding amendments:
1. Off a TTY (pipe, CI, TERM=dumb), check rows keep the exact legacy grammar `^(PASS|FAIL|SKIP)  <name> — <detail>$` and today's check names, as design-language §4.3/§11 requires. `WARN` is the only additive word (see Q10). The A-ledger prototype's own pipe and term-dumb renders do not do this: they print `  + ok    Bun runtime`, which uses a lower-case word, a different leading glyph, renamed checks and wrapped details. The implementation must follow design-language §4.3/§11, not the prototype's off-TTY render. New display labels are allowed on a TTY only. JSON check names stay byte-stable.
2. Box chrome appears only in the full-screen TUI (the header card and the log-pane card of design-language §8). Line-mode output has no boxes, so copied values stay clean.
3. The `doctor` lead line states the problem count. It must not repeat the check rows, so the A-02 "everything twice" defect cannot return.
4. TUI memory rows show the enforced cap from Q3, not the prototype's placeholder caps (768 MB / 1024 MB).

**Rationale:** A + C fixes every S1/S2 finding with the smallest blast radius, and it degrades best on pipes and conhost. I accept the recommendation's choice of variant. But the evidence shows the chosen prototype renders the off-TTY doctor in a form that breaks the grep-stable check grammar. The audit (A-02 fix), design-language §11 and the handoff's own "keeps the PASS|FAIL|SKIP row grammar" claim all promise that grammar to scripts. The pick is therefore valid only with the grammar pinned explicitly.

**Charter:** C3 (clarity over decoration, pipes/TERM=dumb/80 columns, no colour-only meaning), C2 (changes are additive; scripts keep working), C4 (existing frame.ts/width.ts), C9 (smaller blast radius).

**REVERSIBILITY:** Two-way door per command until the migration batches land. It hardens as snapshot tests and docs follow it. **ADR: yes** (the design language governs all output).

---

## Q2 — Architecture candidates to explore (1D pick)

**DECISION:** ACCEPTED. Explore #1, #2, #3, #4, #5 and #7. Do nothing for #6 and #8. Correction to the stated reason for #8: S5 never exercised MCP runtime restarts. Its summary records only task counts and reboot RSS. The evidence therefore neither shows nor refutes a crash loop. #8 stays Speculative and becomes a `needs-triage` ticket. It is not a refuted candidate.

**Rationale:** #1–#4 are rated Strong and serve goals 1–3. §7 1D requires all of them. #7 is the CLI prefactor that Phase 3 ordering principle 2 explicitly requires. #5 is justified under C9 by measured facts: there are two divergent shutdown sequences, and the memory guard samples RSS, which on Windows is the working set and not the commit charge that exhausts memory (bun.md §3). That gap matters on the primary platform. #6 was conditional on 1B attributing the burst peak to stream buffering. 1B attributed it to request-body copies (RC2), and S1-stalled retained 6 MB, so under its own condition #6 drops to Speculative. "Do nothing" is valid (C9).

**Charter:** C1, C7 (Windows memory metric), C9 (do nothing for candidates that do not serve goals 1–4).

**REVERSIBILITY:** Two-way door (exploration only).

---

## Q3 — Captcha solver process model (1B D1)

**DECISION:** REJECTED as worded. My decision upholds the core: the solver runs in a separate OS process with a hard memory cap the OS enforces. The thread transport stays only as the test/fallback adapter, and solve inputs and outputs stay byte-identical (B1). These binding corrections apply:
1. **Spawn model (factual correction).** The premise "a separate process of the same binary, the compiled binary already contains the entrypoint" does not describe what users run. The manager starts `bun run src/index.ts serve` with the user's Bun (`research/bun.md` §1 "Repo fact", `zcode-proxy-manager.mjs:585`). The child must therefore be started from the running Bun executable (`process.execPath`) plus the solver entry module when running from source. The self-exec subcommand is used in compiled builds, never `-e`. Both paths need tests.
2. **Reaping on parent crash (C1).** Windows: `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Linux and macOS have no equivalent, so the child must exit when its IPC channel reaches EOF. A test SIGKILLs the proxy and asserts that 0 solver processes remain.
3. **Cap before work.** The child must not load happy-dom or the solve code until the parent confirms that the cap is applied (handshake). This closes the window between spawn and `AssignProcessToJobObject` or scope creation.
4. **One generation at a time.** The old process has exited, or has been killed after a bounded grace period, before the next one spawns. Asynchronous worker termination produced the ~2× overlap (bun.md §2), and that must not come back.
5. **Metric.** Use `Bun.unsafe.memoryFootprint()` for sampling-and-kill and for recycle-by-memory (it reports commit charge on Windows, which is what the Job Object limits), with RSS as the fallback. Do not use RSS alone.
6. **Linux.** Apply `MemoryMax=` together with `MemorySwapMax=0`. Verify that the limit actually took effect by reading the scope's `memory.max`. If it did not (no delegated memory controller), report the mode as `sampling` and do not claim `cgroup`.
7. **Cap value.** 300 MB, the §9 ceiling. The memory-recycle threshold sits below the cap, so the OS kill is the backstop and not the normal path. An OOM kill goes through the existing exit path. No new retry policy is added (B1).
8. `proxy status`, `--json` (additive field) and `doctor` report the active enforcement mode (`job-object` | `cgroup` | `sampling`) and the cap.

**Rationale:** RC1 is measured: 958 MB RSS at the 200-solve recycle and 686 MB retained, and Bun cannot cap a Worker or a heap (bun.md §Answer 4–5). C1 says outright that a separate process with a hard cap beats an in-process heuristic. The recommendation is right in direction. It was rejected as worded for two reasons. First, its process-start premise contradicts the repo evidence. Second, it leaves C1 gaps: reaping on a parent crash on POSIX, double-generation overlap, and RSS versus commit charge on Windows. The fit of the real vendor SDK inside 300 MB is unmeasured (owner action A1). If A1 shows that a single real solve needs more than the cap, that is a new owner question. The ceiling cannot be loosened by this run (§9).

**Charter:** C1 (hard OS cap, reaping, no unbounded growth), C7 (Windows Job Object primary; Linux/macOS no regression), C4 (`bun:ffi`, no new dependency), C2 (dispatcher interface unchanged), B1 (lifecycle only).

**REVERSIBILITY:** One-way door for the IPC shape and the child entry contract. **ADR: yes.**

---

## Q4 — Start lock and exactly-one-proxy (1B D3)

**DECISION:** ACCEPTED with conditions. Proven takeover applies when the recorded holder is dead or its PID was reused (start-time mismatch). Signal handlers release a lock the process owns. Respawn treats a proven-stale lock as takeable. A live holder's lock is never touched (AUD-001 kept). Binding conditions:
1. **Mechanism.** Do not rely on "atomic rename" alone. A contender that judged the lock stale can, between judging and renaming, rename a fresh lock that another contender has just written. The protocol must close this TOCTOU, for example by checking the moved record against the judged stale record, or by using an exclusive takeover side-lock with its own pid + start-time proof. A race test must prove it: N contenders, with a kill injected at every protocol step. The test asserts that there are never two holders and that a live holder's lock is never deleted.
2. **Signals.** Handle SIGINT, SIGTERM, SIGHUP and, on Windows, SIGBREAK and console close. SIGTERM is not delivered on Windows.
3. **Orphan adoption.** After a Ctrl-C during start, 1B saw the child proxy survive and stay healthy. The next start must adopt it through the existing identity proof, never spawn a second one.
4. Budgets from memory-report §6: 0 failed launches with a killed holder, 0 stale locks after a round or after Ctrl-C, and the proxy is up after a respawn with a stale lock.

**Rationale:** 1B measured the failure: a stale lock in 5 of 8 Ctrl-C trials, 7–8 of 10 launches failing, refused stop/restart, and a respawn that ended with no proxy. The exclusion itself held in every race. The fix must keep exclusion and restore recovery. That is C1's purpose ("exactly one proxy" is useless if it can be zero).

**Charter:** C1 (exactly one proxy, reaping, no storms), C2 (exit codes kept), C7 (Windows signal semantics).

**REVERSIBILITY:** One-way door for the on-disk lock protocol, because old and new kits may meet the same lock during an update. **ADR: yes.**

---

## Q5 — Admission control (1B D4)

**DECISION:** REJECTED in part. My decision:
1. A cap on total in-flight request-body bytes, default 64 MB, configurable through `config.yaml` and env (additive). Bytes are counted for as long as the proxy holds copies of the body (read → parse → translate → upstream send). A request that waits in the queue must not have its body read, so backpressure stays on the socket.
2. **No default cap of 16 concurrent upstream requests.** Do not limit open upstream response streams. The memory evidence is per MB of body in flight (~4.5 MB RSS per MB). S1 long (30,000 mixed requests) was GREEN, and 3,000 stalled readers retained 6 MB. A 16-stream cap would make the 17th parallel agent session wait and then fail with 503 while long streaming answers run. That is a functional regression with no memory justification. If a concurrency limit is wanted at all, it applies only to the body-processing phase, and it needs measured evidence first.
3. Excess requests wait in a bounded FIFO (bounded by count and by 15 s), then get HTTP 503 with `Retry-After` in the endpoint's error shape (OpenAI `error` object; Anthropic `overloaded_error`). Never 429.
4. Reduce the redundant body copies (measured, ticket-level). The bytes sent upstream must not change.
5. Budgets: burst HWM ≤ 400 MB at 16 and ≤ 600 MB at 32 × 10.8 MB, as proposed. Arithmetic check: 64 MB × ~4.5 + ~90 MB base ≈ 380 MB, so the byte cap alone meets both budgets.

**Rationale:** RC2 is measured and attributes the peak to body copies, not to the number of streams. The byte cap addresses the measured cause and meets the budget by itself. The upstream concurrency default is not backed by evidence, and it collides with the fleet-of-sessions use case 1B itself identified (RC3). The 503/`Retry-After` choice and the reservation of 429 for quota semantics are sound: clients retry 5xx and map 429 to quota.

**Charter:** C1 (degrade by queueing/shedding, bounded memory), C2 (no regression for parallel sessions; config additive), C9 (stronger measured evidence; simpler option).

**REVERSIBILITY:** Two-way door for the default values. The client-visible shed contract (503 + `Retry-After` + error shape) is hard to change once clients rely on it. **ADR: yes** (shed contract).

---

## Q6 — Scope of "total kit footprint ≤ 600 MB in S3" (1B D2)

**DECISION:** REJECTED in part. Scope accepted: every process the kit starts counts (launcher, MCP bridge, preflight, proxy, solver), and ≤ 600 MB is kept for the 10-launch S3 scenario. §9 forbids loosening it, and 852 MB × 0.7 ≈ 596 MB also matches the "≥ 30 % peak improvement" rule. **The means and the per-session sub-budgets: EVIDENCE MISSING.** The proposed numbers do not add up for the scenario that was measured. That scenario is 5 `run` launches plus 5 preflights (`S3-*.summary.json`). Launcher 45 + bridge 60 = 105 MB × 5 = 525 MB, plus the proxy at 60 MB = 585 MB. That leaves ~15 MB for five preflight processes. Under single-flight, the waiting preflights still exist as Node processes, at least a bare-Node baseline each. Facts needed before the tickets are written:
- the measured RSS of a bare Node process and of a waiting preflight that has loaded nothing yet;
- the launcher RSS achievable on Windows (must stay resident) and on POSIX (exec handoff is possible if signals and the exit code stay correct, C2);
- the bridge RSS achievable with lazy loading;
- a per-role plan (target × count) whose peak sum is ≤ 600 MB for the 5 + 5 scenario.

The orchestrator then returns with sub-budgets derived from that plan.

**Rationale:** The question of what counts is answered by §9's wording, "total kit footprint", together with C1's per-process bound, so everything counts. A budget plan whose own arithmetic fails cannot be accepted as evidence. Committing tickets to sub-budgets that cannot meet the total would only move the failure to Phase 6.

**Charter:** C1 (bounded memory and process count), C2 (launcher keeps forwarding signals and exit codes), C9 (stronger measured evidence), §9 (no loosening).

**REVERSIBILITY:** Two-way door (budget accounting). No ADR.

---

## Q7 — Memory budget job on both CI legs (1B D5)

**DECISION:** REJECTED as worded. My decision: build a Windows sampler and run the short profile on both legs. ubuntu runs S1–S7. **windows-latest runs S1, S2 (short, offline fixture), S3, S4, S5 and S7.** S6 (the pure in-process TUI pane) may stay ubuntu-only. The long profile stays local. Sampler requirements:
1. One long-lived PowerShell/CIM sampler process that emits a line per second. Do not spawn PowerShell every second: that costs hundreds of milliseconds and pollutes the measurement.
2. Kit processes are identified by process tree plus command line (isolated state dir / run marker), because another process's environment cannot be read on Windows. Orphans are found by command line, because Windows does not re-parent processes.
3. The Windows budget metric is commit charge (PrivateMemory / PagefileUsage), with working set recorded for information. This matches the Q3 metric.

**Rationale:** Windows is the primary platform (C7). The worker/child termination and the Ctrl-C stale lock are unverified there (A2). Q3 makes the Job Object path the Windows cap, so excluding S2 would leave the primary platform's cap and reaping untested in CI. S7 must also run on Windows: rotating `proxy.log` while the proxy holds it open behaves differently there (sharing modes), and RC8's fix is exactly that rotation. The per-second PowerShell spawn in the recommendation would distort the numbers it measures.

**Charter:** C7, C1 (reaping and caps proven), §9 CI (memory-budget job green on ubuntu and windows).

**REVERSIBILITY:** Two-way door.

---

## Q8 — Account Rotator question asked on every setup/update (UX D1)

**DECISION:** ACCEPTED with conditions. Store the answer under `generated/` like the harness choices. Ask only when no answer is stored. `setup --reask` asks again. `--account-rotator` and `ZCODE_KIT_ACCOUNT_ROTATOR=y|n` still override. Conditions:
1. **Automatic, idempotent migration.** If `auth.accounts.enabled` is `true` in the current config, record "yes" without asking. The example config ships `enabled: false`, so `false` cannot be told apart from "never asked". It stays undecided and is asked once on the next TTY setup.
2. `accounts enable` / `accounts disable` also update the stored decision, so there is a single meaning.
3. `update` never blocks on an unanswered question without a usable TTY on stdin and stderr (the pty hang in A-04).
4. Document the behaviour in help and README (C8).

**Rationale:** A-04 is an S1 finding with direct evidence: the question returns every time, and an update hung 120 s in all TTY captures. The harness-choice precedent already exists (`generated/harness-choices/`, `--reask`). Changing when the question is asked is onboarding UX. It does not change rotator behaviour (B1).

**Charter:** C2 (stored state additive, automatic migration, env override kept), C3, C8.

**REVERSIBILITY:** Two-way door.

---

## Q9 — stdout vs stderr (UX D2)

**DECISION:** ACCEPTED with clarifications, in one release, announced, with no phased dual output.
1. Per design-language §10, **reports stay on stdout**: `doctor` check rows and verdict, `status` / `proxy status` text, the setup summary, the connection card, `proxy logs`, `models`, explicit `--help`, and all JSON. Diagnostics move to stderr: progress, spinners, warnings, error blocks, prompts, usage errors, and every kit line in `run` (A-05).
2. Exit codes and JSON are unchanged.
3. Verification gate for C7: on windows-latest, run the installer's setup call and the `zcode-kit.cmd` → `zcode-kit.ps1` shim under Windows PowerShell 5.1 with stderr redirected (`2>&1`, and `-File … 2> file`), with `$ErrorActionPreference = "Stop"` as `install.ps1` sets it. Assert that more stderr lines do not turn into a terminating NativeCommandError or a changed exit code. If they do, harden the PowerShell call sites in the same ticket.

**Rationale:** The A-05 and A-09 evidence is direct: `zcode-kit run … | jq` gets kit text on stdout. Moving human-readable diagnostics does not touch C2's protected surfaces (exit codes, JSON). The release notes announce it. The round's "keep data on stdout" list left out the human reports, so I pin them to the design-language rule. Otherwise a literal reading could move `doctor` output to stderr and break the grep grammar Q1 protects. More stderr traffic on PowerShell 5.1 is a primary-platform risk that the evidence has not covered, so it becomes a gate.

**Charter:** C3 (streams, pipes), C2 (exit codes/JSON stable; change announced), C7.

**REVERSIBILITY:** Two-way door technically, but script authors adapt to it. **ADR: yes** (stream contract).

---

## Q10 — `WARN` in the doctor check grammar (UX D3)

**DECISION:** ACCEPTED with conditions. Add `WARN` as a fourth check verdict. It never fails the exit code, and the JSON status gains the value additively. It is documented in the release notes and in `--help`. Conditions:
1. No check that today reports `FAIL`, and therefore contributes to exit 1, may become `WARN`. That would silently change exit codes. `WARN` is only for conditions that are `PASS` today (including notes) or for new checks.
2. The off-TTY form is `WARN  <name> — <detail>`, the same grammar as Q1.
3. The new JSON enum value is listed as an additive change for strict consumers.

**Rationale:** The A-08 evidence shows five status vocabularies, with neutral or attention states forced into `OK`/`PASS`. An additive verdict that cannot change exit codes meets C2. Condition 1 is what keeps it additive.

**Charter:** C2, C3.

**REVERSIBILITY:** Two-way door.

---

## Q11 — `auth status` output (UX D4)

**DECISION:** ACCEPTED. Human-readable text only when stdout is a TTY. The exact current JSON when stdout is not a TTY. `--json` forces JSON on a TTY. Announce it in the release notes.

**Rationale:** Scripts (including PowerShell `$x = …` capture, where stdout is a pipe) see byte-identical JSON. Only an interactive human sees the new form. This is stronger compatibility than design-language D4's deprecation-window alternative, and simpler (C9). It fixes the A-08 "JSON for a human command" finding.

**Charter:** C2 (non-TTY output unchanged; announced), C3 (`--json` stable), C9.

**REVERSIBILITY:** Two-way door.

---

## Q12 — Single-source width core (UX D5)

**DECISION:** ACCEPTED with conditions. One `width-core.mjs` + `.d.mts` in `zcode-proxy-src/src/tui/`, re-exported by `width.ts` and imported by the CLI's output module. Grapheme-based: `Intl.Segmenter`, a W/F table generated from UCD 17, VS16/RI pairs = 2, cluster cap 2. Conditions:
1. An ASCII / no-combining fast path that skips segmentation. The TUI log pane must still meet the S6 budget and show no frame-time regression.
2. The same width test vectors run under Node and Bun. Bun's segmentation data version is UNVERIFIED (terminal-conventions §3).
3. Existing `width.ts` imports and tests keep working unchanged.

**Rationale:** C4 prefers the kit's existing rendering code. The repo already uses this exact cross-runtime pattern (`captcha-compatibility.mjs` + `.d.mts`). Research documents the width gaps (missing W ranges, VS16 = 1). The conditions keep a correctness fix from becoming a performance regression in the 100k-line pane.

**Charter:** C4, C3 (CJK/emoji width, 80 columns), C1 (no TUI growth).

**REVERSIBILITY:** Two-way door.

---

## Q13 — Compact setup output by default (UX D6)

**DECISION:** ACCEPTED with conditions. The default shows stages, one result row per assistant, the connection check and the connection card. Full diagnostics go to `install.log`, and to the screen with `--verbose` / `ZCODE_KIT_VERBOSE=1` (same meaning as today: full output). The installer-mode login hint shows the actual command `zcode-kit auth login zai` on screen (A-01). Conditions:
1. Every `WARN`/`FAIL` keeps its what/why/next block on screen.
2. The summary always shows the transaction undo command.
3. `--installer` stays accepted.
4. Nothing that is printed today is lost: it is either on screen or in the log.

**Rationale:** The A-15 and A-01 evidence: today's default is a log, not a report, and the compact mode hides the one instruction a new user needs. The conditions keep C3's "every error has next" and preserve the undo path that C2's transaction mechanism relies on.

**Charter:** C3, C2.

**REVERSIBILITY:** Two-way door.

---

## Q14 — Node floor and CI matrix

**DECISION:** ACCEPTED with conditions. `engines.node` `>=24` in all 3 manifests. Installer gates (`install.sh`, `install.ps1`, `pack/build.mjs`) at 24. CI matrix {ubuntu, windows} × {24, 26}. Release workflow on 26 (the publish job's existing Node 24 requirement for OIDC stays satisfied). The installer error names the exact upgrade step. Conditions:
1. `setup` / `update` running on Node < 24 refuse **before** mutating any state, with what/why/next, and leave the existing install working (C2).
2. The preflight (`heal.mjs`) reports when the OMP autostart's pinned absolute Node path is below the floor or missing (node-lts.md §4).
3. Fix DEP0190 at `pack/build.mjs:159-163`.
4. The release notes announce that Node 20 and 22 are no longer supported.
5. C8: README + translations, SUPPORT_MATRIX.

**Rationale:** Primary sources (nodejs/Release schedule.json): 20 has been EOL since 2026-04-30, 26 is Active LTS, and 22 ends 2027-04-30. Its ~6 months left is shorter than a kit release cycle and would cost a third CI leg. No API the kit uses is removed between 20 and 26. C5 requires raising the floor. The conditions make the drop of 22 announced and safe, not silent.

**Charter:** C5, C2 (announced, no broken installs), C7, C8.

**REVERSIBILITY:** One-way door for users once released (support floor). **ADR: yes.**

---

## Q15 — Bun pin and the nested workflows

**DECISION:** REJECTED in part. Pin Bun 1.4.4 everywhere, as recommended: CI, release, both installers with the 1.4.4 SHA-256s, docs, SUPPORT_MATRIX, the installer tests. Pin `@types/bun` to the same version. Deleting `zcode-proxy-src/.github/workflows/` is accepted, with a MANIFEST vendor-change entry (there is precedent: the vendored Android release job was removed the same way). **But "move nothing" is wrong.** The nested `ci.yml` runs `bun x tsc --noEmit` (proxy typecheck), and the root CI does not: it runs only `npm run test`, `test:proxy` (= `bun test`) and `test:mcp`. Move the proxy typecheck into the root CI on both legs, pinned through the proxy `typescript` devDependency from Q16. Record its baseline first: if it fails today, the failures become tickets (§4.6), not silent fixes. Also re-run the memory-loop short profile on Bun 1.4.4 before the memory fixes land. The 1.4.2 baseline stays the budget reference, but the runtime upgrade's own effect (Atomics.wait/`Bun.gc` RSS release, cgroup heap sizing) must be separable from the fixes' effect.

**Rationale:** The bun.md/drift.md evidence supports 1.4.4: memory-return fixes that apply directly to the solver worker. The nested workflows never run (GitHub API lists only the root workflows), so deleting them is safe. But the claim that the root CI already covers them is contradicted by the files: the typecheck step would be lost. §7 Phase 3 #8 asks for type checks as CI guardrails.

**Charter:** C5, C1 (attribution of memory gains), C9 (stronger evidence), §9 CURRENCY (pins consistent).

**REVERSIBILITY:** Two-way door.

---

## Q16 — Dependency targets

**DECISION:** ACCEPTED with conditions. The targets are as listed: happy-dom `^21.0.4` with `enableCSSFileLoading: true, enableIframePageLoading: true`; undici `^8.12.4`; yaml `^2.9.1`; MCP SDK `^1.32.2` + `zod ^4.6.6`; TypeScript `7.0.2` exact, falling back to `6.0.3`; `@types/node ^24` (an intentional range downgrade in the MCP package, from `^26`); `@types/bun 1.4.4` exact; a proxy `typescript` devDependency; `actions/checkout@v7`, `actions/setup-node@v7`, `oven-sh/setup-bun@v2`. One expand–contract batch per package group, each green before the next. MCP 2.x becomes a separate `needs-triage` ticket. Conditions:
1. The two happy-dom flags restore 20.x loading behaviour (B1). This keeps the SSRF-relevant surface that 21.0.0 turned off by default **unchanged** relative to today. That is allowed by C6 ("unchanged or stricter"), but the ADR/notes must say so. Dropping either flag needs a live solve (owner action), not this run.
2. Staying on protocol revision `2025-11-25` / SDK 1.x is documented as a deliberate stay-back with its reason (the 2026-07-28 revision is an architectural step; 1.x is supported until at least 2027-01-27), as §9 CURRENCY requires.
3. `mcp/zcode-harness-mcp/dist/` is regenerated by the build and committed (B5). If the TS 7 output differs, the diff is reviewed. If it misbehaves, fall back to 6.0.3.
4. The captcha suite runs green after the happy-dom bump, before any other change to the captcha path.

**Rationale:** Each target is backed by dated primary sources and advisories: GHSA-834v (happy-dom ≤21.0.3), 19 undici advisories on 8.10.0, CVE-2026-33532 (yaml <2.8.3), GHSA-mrhx (zod <4.6.6). The drift report's correction of `zod` to `^4.6.6` is evidence-backed. Batching keeps CI green between steps.

**Charter:** C5, C6, B1, B5, C9.

**REVERSIBILITY:** Two-way door per batch.

---

## Q17 — Captcha egress routing under Bun

**DECISION:** ACCEPTED. Routing-only fix: on Bun, `proxy: <configured ZCODE_PROXY_UPSTREAM_PROXY> ?? false`; Node keeps the dispatcher. Tests cover both `captchaFetch` and the sync-XHR worker path. What is fetched and how challenges are solved do not change.

**Rationale:** Research documents with source references that Bun ignores `dispatcher` (oven-sh/bun#38840) and reads ambient `HTTP(S)_PROXY` on every fetch. The setting the banner reports is therefore false, and an undeclared egress path exists. I checked for a regression risk: `lib/proxy-env.mjs` already strips ambient proxy variables from the kit-managed proxy, with the comment "Operators who need an egress proxy opt in through ZCODE_PROXY_UPSTREAM_PROXY". So `proxy: false` changes nothing for kit-managed proxies when the setting is unset, and makes the documented opt-in work when it is set. This is egress correctness under C6. It is not a pass-rate or rotation change, so it is inside B1's IN SCOPE (error handling/observability).

**Charter:** C6 (no unintended egress), C2 (documented setting honoured; no change for unset managed proxies), B1.

**REVERSIBILITY:** Two-way door.

---

## Q18 — Harness adapter drift

**DECISION:** ACCEPTED with conditions. Fix the two HIGH items: Continue `capabilities` as a string array, and the Kilo Anthropic base URL with `/v1`. Fix the MEDIUM items that `research/harness-configs.md` confirms from primary docs. Leave OpenCode's V2 schema alone (V1 is still accepted and migrated). Refresh recorded versions and `primarySource` dates only for what was re-verified. Adapter tests use temp-HOME fixtures (B3). Conditions:
1. Items the research marks UNVERIFIED are not changed. Examples: the `claude mcp add` syntax, Codex fallback metadata, OpenCode mixed V1/V2 merge.
2. Existing users' harness configs are updated on the next `setup` / `integrate` through the existing transaction with rollback, idempotently (C2).
3. harnesses/README* and EFFORT_MAPPING* are updated where effort or image flags change (C8).

**Rationale:** The HIGH items produce configs the harness rejects or misroutes. That is a correctness defect for existing users. The MEDIUM items are confirmed against tagged sources. The conditions keep the changes to what is verified and keep migrations reversible.

**Charter:** C5 (adapters current), C2, C8, B3.

**REVERSIBILITY:** Two-way door.

---

## Q19 — Tests that CI never runs

**DECISION:** ACCEPTED. Wire `tests/update.test.mjs` and `tests/upstream-config.test.mjs` into `npm run test`. Add a guard test that fails when a `tests/*.test.mjs` file is referenced by no test script.

**Rationale:** METRICS baseline: both tests pass (16) but never run in CI. The guard turns a recurring mechanical gap into a deterministic check.

**Charter:** C2 (no silent regressions), C9 (simple, deterministic).

**REVERSIBILITY:** Two-way door.

---

## Q20 — Tracker docs in the PR

**DECISION:** ACCEPTED. Commit byte-identical copies of the owner checkout's untracked `AGENTS.md` and `docs/agents/` on the integration branch. Read them only. The owner's checkout is not modified in any way, and nothing else from it is copied.

**Rationale:** The run's tracker (`.scratch/kit-overhaul/`, committed on the branch) and the ADR/GLOSSARY layout follow these docs, and they are absent from `origin/main`. Without them the PR's conventions are undocumented. The content is conventions only, with no secrets (B2). The PR is not merged, so the owner can drop the files in review.

**Charter:** C8 (docs reflect what the change relies on), B2, C9 (reversible).

**REVERSIBILITY:** Two-way door (unmerged PR).

---

## Q21 — When to open the PR

**DECISION:** ACCEPTED with one condition. Open a DRAFT PR against `main` after the first merge to the integration branch, use its CI on both OS legs through Phases 4–6, and mark it ready for review in Phase 7. Never merge. Condition: never push to `main` or `feature/account-rotator`, because `release.yml` triggers on pushes to those branches (B6).

**Rationale:** `ci.yml` triggers only on `pull_request` and on pushes to `main` / `feature/account-rotator`. A pushed integration branch alone gets no CI, and §9 and Phase 6 require green ubuntu and windows runs. A draft PR does not trigger the release workflow. §7 Phase 7's "open as ready for review" is met by marking it ready then.

**Charter:** C7 (Windows CI throughout), B6.

**REVERSIBILITY:** Two-way door.

---

## Q22 — Unverifiable items become owner actions

**DECISION:** ACCEPTED. Record each of these in OWNER-ACTIONS.md with copy-paste commands: A1 (live vendor-SDK solve measurement), A2 and the 1C install.ps1 run (Windows PowerShell 5.1/7, conhost/Windows Terminal), macOS terminals, and the optional live "Reply with ok" smoke. Mark the related criteria "unverified — owner action", and never read or copy the owner's secrets. Add to A1: its result decides whether a real solve fits under the 300 MB solver cap (Q3). If it does not, that goes back to the owner as a new question.

**Rationale:** §1 and Phase 6 require exactly this handling. 1B and 1C document why each item cannot be verified here (no network or credentials under B2/B3, no PowerShell or macOS on the host).

**Charter:** C6, B2, B3, C7.

**REVERSIBILITY:** Two-way door.

---

## Shared understanding

NOT CONFIRMED. These branches of the design tree are still open:
1. **Q6 footprint plan:** measured per-role targets × counts that sum to ≤ 600 MB for the 5 run + 5 preflight S3 scenario (bare-Node and waiting-preflight RSS, Windows vs POSIX launcher, bridge lazy-load result), then per-session sub-budgets.
2. **Solver cap fit (A1):** whether a real vendor-SDK solve fits under 300 MB. The memory-recycle threshold value below the cap.
3. **Health policy after Q3:** MemoryGuard soft/hard limits re-based on footprint, not RSS (they guard only the proxy's own growth once the solver is out of process). How a memory recycle or restart, and a 503 shed, surface to connected clients. Restart-storm behaviour under induced memory pressure.
4. **Bounds per store** (candidate #3): concrete max size/TTL for the CDN memory and disk cache, MCP task registry and files (count/age), per-task arrays, TUI log pane byte cap, `_stallCounts`. The **`proxy.log` rotation-while-running mechanism**, given that the proxy writes to an inherited fd (a design gap per memory-report §7), on Windows and POSIX.
5. **Observability:** the memory/process section and field names in `proxy status`, `--json` and `doctor` (enforcement mode, per-process footprint and cap). The per-worker data contract the TUI header needs. A log line format.
6. **Output module topology** (candidate #4 open decision): one module shared by Node and Bun vs two renderers over one token set. The order in which commands migrate. The snapshot-test strategy and the `--json` stability guarantee as a documented superset.
7. **TUI redesign scope:** settings strip, filter, NO_COLOR/TERM=dumb refusal and wgl4 tier, as specified but not prototyped.
8. **Stored-state compatibility list and deprecation notices** for the release notes (stream move, `WARN`, Node floor, `auth status` on TTY, rotator decision migration).
9. **Docs plan (C8)** across README × 5 languages, harnesses/README*, SECURITY*, SUPPORT_MATRIX.json and EFFORT_MAPPING*.
10. **Windows memory-loop sampler** process identification and budget metric, as decided in Q7 (needs a spec).
