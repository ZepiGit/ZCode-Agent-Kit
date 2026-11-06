# DECISIONS — Owner Proxy log (Charter v1)

Every decision below was taken by a fresh Owner Proxy subagent under Charter v1 on behalf of the owner. Format per entry: round, question, decision, rationale, Charter clauses, reversibility.

## Round 1 (2026-11-06) — Phase 1 picks and first frontier

Questions: rounds/round-01.md. Answers below are copied verbatim from rounds/round-01-answers.md.

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

## Round 2 (2026-11-06) — process model details, bounds, observability, output module, tests, docs

Questions: rounds/round-02.md. Answers below are copied verbatim from rounds/round-02-answers.md.

# Round 2: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1 decisions in DECISIONS.md bind these answers. Where a recommendation contradicts one of them, the answer says so and the Round 1 decision wins. I checked the evidence myself in `reports/architecture.md`, `diagnosis/memory-report.md`, `diagnosis/data/*.csv`, `ux/design-language.md`, PROMPT.md §5/§7/§9, and the code at c4933c2: `proxy/zcode-proxy-manager.mjs`, `lib/proxy-env.mjs`, `zcode-proxy-src/src/{index.ts, runtime/health-monitor.ts, runtime/watchdog.ts, server/server.ts, proxy/captcha-solver.ts, proxy/captcha-happy.ts, proxy/captcha-cdn-cache.ts, tui/app.ts}`, `mcp/zcode-harness-mcp/src/tasks/{manager.ts, ingress.ts}`, `pack/build.mjs`, `scripts/verify-golden-path.mjs`, `.gitattributes`, `zcode-proxy-src/package.json`, `SECURITY.md`, and the diagnosis branch sampler (`/home/AgentKit/wt/diagnosis-memory/tests/memory/lib/sampler.mjs`). Where the evidence differs from the round's wording, the answer says so.

Where an answer is ACCEPTED with conditions, the conditions bind the spec and the tickets.

---

## Q1 — Proxy health policy and the supervisor module (arch #5)

**DECISION:** ACCEPTED with conditions. One supervisor module, with `watchdogStep` as its pure core. Footprint sampling uses RSS as the fallback. There is one shutdown sequence. Thresholds are soft 512 MB / hard 1024 MB, × 3 samples 15 s apart, configurable with injected-sampler tests. The restart budget stays at 3 per 15 min. Binding conditions:
1. **Reserve the budget before shutting down (C1).** Today the proxy starts exiting as soon as the OS has spawned the respawn hook (`watchdog.ts` `launchRespawnHook` resolves on the child's `spawn` event). The manager checks the budget only after that (`reserveRespawn`, `zcode-proxy-manager.mjs:827`). With the budget used up, a memory recycle therefore ends with **no proxy**. The handoff must confirm the budget reservation before the drain begins. If the reservation is refused, the proxy keeps serving (today's MemoryGuard rule: "a standalone proxy at 3 GB still serves, a dead one does not"), logs the refusal and reports it as WARN in status/doctor. The admission cap (Round 1 Q5) remains the memory protection. Test: under induced memory pressure there are ≤ 3 restarts per 15 min and exactly 1 proxy at every sample.
2. **How a recycle reaches clients.** During the drain the proxy keeps its listener open. New requests get the Round 1 Q5 shed contract (503 + `Retry-After` in the endpoint's error shape), not connection resets. In-flight requests get the drain window. The bounded account-metadata flush (`flushAccountMetadata`, index.ts) stays inside the hard cap. Streams cut at the force point are counted in one log line.
3. **The deadline is shared with the manager (POSIX).** `killOwned` sends SIGKILL 5 s after SIGTERM (`zcode-proxy-manager.mjs:420-424`). A 10 s drain on SIGTERM would be killed halfway, flush included. The stop deadline (drain + flush) and the manager's SIGTERM→SIGKILL grace become one shared, tested constant. Memory recycle and update keep the ≤ 10 s cap.
4. **Windows graceful stop (C7).** On Windows, `killOwned` calls `TerminateProcess` for both the graceful and the forced step (`:384-414`). On the primary platform the graceful sequence therefore never runs on `proxy stop`/`restart`. The lifecycle module (Q11) must deliver a graceful stop request on Windows, with `TerminateProcess` after the shared grace as the fallback. The spec picks the mechanism: a stop-request file in `logs/`, IPC, or an authenticated loopback request (C6: no unauthenticated or non-loopback surface). A windows-latest test proves that the flush runs.
5. Once the solver leaves the process, the soft action is WARN plus a log line, not a solver recycle. Q2 governs the solver. Without a manager hook (TUI or standalone), today's behaviour stays: log, keep serving.
6. The new `config.yaml` keys are optional. An env override exists only if it is added to `proxyEnv`'s allowlist with a test. `lib/proxy-env.mjs:21` strips `ZCODE_PROXY_*`/`CAPTCHA_*` from the managed proxy, so an unlisted env override would silently do nothing.

**Rationale:** The thresholds are backed by evidence. The designed maximum of the bounded proxy is ≈ 450 MB: base 85–93 MB, plus the responses store at ≤ ~74 MB (RC6), plus 64 MB × ~4.5 of admitted bodies (Round 1 Q5). Soft 512 MB sits just above that, and hard 1024 MB is a sustained 2× anomaly, far below today's 1536/3072. The recommendation leaves two C1 holes in the code it keeps unchanged. First, the "budget unchanged" path is the path that ends with zero proxies. Second, its single graceful sequence never runs on Windows and is SIGKILLed at 5 s on POSIX. "Exactly one proxy" includes "not zero" (Round 1 Q4 rationale).

**Charter:** C1 (no restart storm, never zero proxies, degrade by shedding), C7 (Windows stop semantics), C2 (config additive), C6.

**REVERSIBILITY:** Threshold defaults are a two-way door. The proxy↔manager handoff contract is hard to reverse, because an old running proxy and a new manager meet during an update. **ADR: yes** (handoff/shutdown contract).

---

## Q2 — Solver failure and recycle semantics

**DECISION:** ACCEPTED with conditions. A crash or an OS kill fails only the solve in flight. Requests that need no solve are never interrupted. The restart is lazy with backoff, at most 5 per 10 min, then fail-fast. Recycling happens by count or by footprint. The cap defaults to 300 MB and is configurable. The kill at the cap is logged with the setting that raises it. A1 revisits the default later. Binding conditions:
1. **Queued solves are not failed.** Today a worker exit fails only the in-flight job (`failInFlight`). The queue is then pumped onto the next generation (`captcha-solver.ts:184-193, 296-310`). That stays. The in-flight failure uses the existing error path and category (`CaptchaSdkError("other", …)`), so there is no new client-visible error. The 503 + `Retry-After` shed contract applies only while the solver is in the fail-fast window, with `Retry-After` set to the time until the window reopens. It also applies when a bounded queue overflows. It never applies merely because a crash happened.
2. **Only abnormal exits count toward 5 per 10 min:** crash, OS kill at the cap, fatal error, deadline kill. Planned recycles (count, footprint, idle, request, shutdown) never count. Otherwise a heavier real SDK that recycles by footprint every few solves would trip fail-fast in normal operation. The budget is a process restart limit. It never resubmits a solve, so it is not a new retry policy (Round 1 Q3 condition 7, B1).
3. **Corrected rationale and the threshold rule.** At the fixture's +4.1 MB per solve, 100 solves add ≈ 410 MB. That is above the 300 MB cap, so the count trigger cannot be what keeps the solver below the cap. The footprint trigger is the primary rule. It is defined as **80 % of the configured cap** (240 MB at 300) and is read from the child's own `Bun.unsafe.memoryFootprint()` report after each solve (Round 1 Q3 condition 5). The count of 100 is only a backstop. The in-worker 768 MB heap trigger lies above the cap and is removed or re-based below it.
4. **Config.** `config.yaml` is the source for the managed proxy. An env override only applies under the allowlist rule of Q1 condition 6. The OS-kill log line names the `config.yaml` key. Values below a documented minimum are rejected at config load with what/why/next. Tests and the §9 evidence use the default of 300 MB.
5. **Environment parity (B1).** The child gets the inputs the worker gets today: `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA` (it gates remote guest JS, `captcha-happy.ts:1753`), the CDN cache variables and the egress setting from Round 1 Q17. The guest error boundary (`index.ts:207`) is installed in the child as well. Without these, solves would fail or behave differently in the child.
6. The fail-fast state and its end time are reported in the Q5 fields.

**Rationale:** Most of the semantics are sound and serve C1 (bounded restarts, no storms). Two parts are not backed by evidence. Failing the queued requests on a crash would be a regression from today's behaviour, and the evidence gives no reason for it. The "100 because 4.1 MB/solve" arithmetic contradicts the 300 MB cap. The conditions keep the client-visible behaviour identical to today, except in the new fail-fast state.

**Charter:** C1, B1 (lifecycle only, byte-identical solves), C2 (no new error shape), C9.

**REVERSIBILITY:** Two-way door (defaults). No ADR beyond Round 1 Q3/Q5.

---

## Q3 — Bounds for every growing store (arch #3)

**DECISION:** ACCEPTED with conditions. One bounded-collection module is lifted from `responses/store.ts`. The limits are as listed, with a test each, and the dead `solveTimes` is deleted. Binding corrections:
1. **`_stallCounts`: no TTL (B1).** The count drives a solve-path decision. At 2 stalls of a pe URL the CDN entry is invalidated (`captcha-happy.ts:195-203`). A 1 h TTL would reset the count and change when the cache is evicted, which changes which bytes are served. Bound it by count only: 1,024 entries, oldest evicted first. The map is generation-scoped (reset with each solver process), so with ≤ 100 solves per generation the cap is unreachable in practice and behaviour stays identical.
2. **The CDN disk prune by age removes only entries that are already expired under the configured TTL.** `CAPTCHA_CDN_CACHE_TTL_MS` may be up to ~24.8 days (`captcha-cdn-cache.ts:7`), which is more than 14 days. The effective age limit is therefore max(14 days, TTL). The 256 MB byte cap evicts the oldest entries. The directory is HOME-derived and can be shared by several installations and solver processes. Pruning skips temp files and files being written, and tolerates `ENOENT`.
3. **MCP tasks.** A task is evicted when either limit is exceeded (count > 500 terminal tasks, or age > 7 days). Non-terminal tasks are never evicted. Each task's `*.result.json` is pruned with it. A lookup of an evicted task returns the existing not-found error. An evicted task's idempotency key is forgotten (`byIdempotency`, `manager.ts:258-264`), so the idempotency window equals the retention. That goes into the tool docs and the release notes.
4. **`accumulatedText` (4 MiB)** becomes the task's `responseText` (`manager.ts:612`). On truncation, the existing `completeness` field is set to `partial` with an explanation, which existing consumers already understand. The additive `truncated` marker comes on top. The spec states which part of the text is kept.
5. The responses store's behaviour and its tests stay unchanged. The TUI pane's byte cap is tested against the S6 budget (≤ 16 MB of heap with 64 KB lines).

**Rationale:** Every store with measured or code-evident growth gets an enforced bound (§9 BOUNDS, RC4/RC5/RC7). The claim that bounding "changes only memory, never which bytes are served" holds for the memory caches. It is false for a TTL on `_stallCounts`, and for an age prune that would remove entries still fresh under a long configured TTL. The conditions make the claim true.

**Charter:** C1, B1, C2 (stored-state change announced; error shapes unchanged), C9.

**REVERSIBILITY:** Limits are a two-way door. Deleting task history cannot be undone for the affected data. **ADR: yes** (retention policy for stored task state).

---

## Q4 — `proxy.log` rotation while the proxy runs

**DECISION:** REJECTED as worded. My decision keeps the direction: the proxy opens `proxy.log` itself through a size-capped writer (rotate at 5 MB, keep one `proxy.log.1`, the same as `MAX_LOG_BYTES` today), and `proxy logs N` reads across both files. These corrections bind:
1. **The proxy is not the only holder of the file.** The manager appends `[manager <ISO>] …` lines to `proxy.log` (`logLine`, `zcode-proxy-manager.mjs:93`). `proxy logs` opens it for reading (`:1191`). Rotation must tolerate concurrent appenders and readers. No line is ever lost. If the rename fails (Windows sharing), the writer keeps appending and retries at the next check. The overshoot is bounded so that S7 (≤ 6 MB) still holds. A windows-latest test rotates while a reader and a manager append are open.
2. **Startup failures stay in `proxy.log`.** `scripts/verify-golden-path.mjs:245-253` reads `logs/proxy.log` to classify start failures (ModuleNotFound, EADDRINUSE, SyntaxError, `exited immediately (code N)`). Users are told to "inspect logs/proxy.log" (`cli/heal.mjs:50,80`). The inherited stdio may go to a new early-output file that is truncated at each start. When the proxy exits during startup, or after a crash, the manager copies a bounded tail of that file (e.g. 64 KB) into `proxy.log`. The new file name is additive and documented.
3. Once the writer is open, the proxy's console, stdout and stderr writes go through it. Only output that bypasses JS (native panics) reaches the early file. The solver child's stdout/stderr is piped to the parent and written through the writer, with the line content unchanged (e.g. `[pe-cache-evict] …`).
4. Line content stays as it is today. The Q5 format applies only to new event lines.

**Rationale:** RC8 is measured and the missing seam is real (memory-report §7). But the Windows mechanism was justified by a false premise, "only the proxy holds the file". Moving early crash output out of `proxy.log` would also break a repo script and the documented diagnostic path (C2). The corrected design keeps every consumer of `proxy.log` working and bounds the file.

**Charter:** C1 (bounded disk), C2 (scripts and docs that read proxy.log), C7 (Windows sharing semantics), C3 (errors point to a log that contains the cause).

**REVERSIBILITY:** Two-way door. No ADR.

---

## Q5 — Observability fields

**DECISION:** REJECTED in part. Accepted: additive `memory` (per process: role, pid, `rssMB`, `footprintMB`, `capMB`, enforcement), `restarts` (`last15m`, `budget`) and `admission` (`inFlightBytes`, `queued`, `shedTotal`) in `proxy status`, `--json` and `/health` details. `/health` stays behind bearer auth (`server.ts`, where the auth check precedes the routes). Existing fields keep their names, types and meaning, and `schemaVersion` stays 1. My corrections:
1. **The enforcement enum follows Round 1 Q3 condition 8:** `job-object` | `cgroup` | `sampling`. `sampled` contradicts that binding decision. `none` is added, for the thread fallback adapter or for caps that are switched off.
2. **`processes` is limited to what the proxy owns** (proxy plus solver children), e.g. `processes: { proxy: 1, solver: n }`. A count of "all kit processes for this installation" (launchers, bridges, preflights) would need a process-table scan with command-line matching, which on Windows cannot read env. `/health` `details` must stay synchronous and O(1) (`server.ts:189` comment, `healthDetails()`), because hung-proxy detection depends on it. All memory values come from cached samples.
3. **When doctor WARNs.** WARN appears above the soft limit, when enforcement is `none`, or when a hard cap is supported on the platform but was not applied (Linux without a delegated memory controller, a failed Job Object). On macOS, `sampling` is the designed mode, so it shows PASS with a detail note. A permanent WARN with no possible next command would break C3 ("every error says … the exact next command") and Round 1 Q10's meaning of WARN.
4. **Log format scope.** `ISO-time LEVEL component message key=value…` applies to new event lines only (memory, recycle, shed, supervisor, lock takeover). Existing lines stay byte-identical (Q4, C2: the golden-path script greps them). The existing redaction applies to all lines.
5. Q2's solver fail-fast state and its end time are part of the solver entry.

**Rationale:** The fields serve §9 UX (per-process RSS in the TUI) and Round 1 branch 5. Three parts of the recommendation are not backed or conflict. The enum name contradicts Round 1. An installation-wide process count cannot be computed inside `/health`'s O(1) contract. The WARN rule would put a non-actionable WARN on every macOS doctor run.

**Charter:** C2 (additive JSON, stable lines), C3, C6 (authenticated, no secrets), C1 (bounded work per request).

**REVERSIBILITY:** Field names are hard to change once released (a documented superset). **ADR: yes** (observability contract).

---

## Q6 — Where the shared output code lives (arch #4 open decision)

**DECISION:** ACCEPTED with conditions. Add `tokens.mjs` (+ `.d.mts`) beside `width-core.mjs` in `zcode-proxy-src/src/tui/`. The CLI gets `lib/term/`, and the TUI keeps `frame.ts` on the same tokens and width core. That is two renderers, one token set and one width core. Conditions:
1. Both shared files are plain ESM, with no Node-only or Bun-only APIs and no imports outside `tui/`. They are tested under Node and Bun (Round 1 Q12 condition 2), and `bun build --compile` bundles them for all five targets (precedent: `captcha-compatibility.mjs`).
2. The pack allowlist already covers `cli/`, `lib/` and `zcode-proxy-src/src/` (`pack/build.mjs:20-46`). The change needed is that `verify-payload`'s required list gains the shared files and their `.d.mts`.
3. Rendering code loads lazily: `cli/heal.mjs` preflight and the lifecycle intents must not import renderers (RC3: ~70 MB per preflight, Round 1 Q6).

**Rationale:** This matches design-language §9 and Round 1 Q12, and it follows the repo's existing cross-runtime pattern. C4 prefers the existing `frame.ts`/`width.ts` over one forced shared renderer across two runtimes.

**Charter:** C4, C3, C1 (preflight footprint).

**REVERSIBILITY:** Two-way door. **ADR: yes** (the output topology governs all output; extends the Round 1 Q1 ADR).

---

## Q7 — Migration order for the output work

**DECISION:** ACCEPTED with conditions. The order is (1) the `lib/term/` prefactor plus the snapshot harness, (2) the command-module split, (3) manager doctor records, (4a/b/c) the per-command batches, (5) the TUI. Conditions:
1. "No visible output change" in steps 1–2 is proven by snapshots captured on the pre-change code.
2. Step 3: the manager CLI's own `doctor` output (`node proxy/zcode-proxy-manager.mjs doctor`) stays in the legacy off-TTY grammar (Round 1 Q1 amendment 1, Q11). Only `zcode-kit doctor` stops parsing text.
3. Batch (b) touches `install.ps1` text and so carries the Round 1 Q9 PowerShell 5.1 stderr gate. All stream moves ship in one release (Round 1 Q9).

**Rationale:** The order matches PROMPT §7 Phase 3 principles 2 and 5. The prefactor comes first, then the hottest file is split, then the A-02 double print is removed at its source, then the batches run in the order of user impact.

**Charter:** C3, C2, C9 (smaller steps, each reversible).

**REVERSIBILITY:** Two-way door.

---

## Q8 — Snapshot test strategy

**DECISION:** ACCEPTED with conditions. Snapshots live under `tests/snapshots/<command>/<variant>.txt` and are rendered from records with forced capabilities for every C3 variant, on both OS legs, without a pty. A few spawn tests check stream routing and exit codes. Normalisation uses an explicit list. `--json` gets key-set superset tests. Snapshots are updated only through `UPDATE_SNAPSHOTS=1`. Conditions:
1. **Line endings.** `.gitattributes` has no global rule today (only `*.sh`, `*.ps1`, `*.cmd`), and the windows-latest checkout converts to CRLF. Add `tests/snapshots/** -text` (or `eol=lf`) and compare bytes, ANSI included.
2. The JSON baseline (key names **and** value types, per C2 "names, types and meaning") is captured once from the pre-change code and committed. New enum values (`WARN`) are listed as additive (Round 1 Q10).
3. CI fails when `UPDATE_SNAPSHOTS` is set. The normalisation list never masks status words, exit codes or the check grammar. The off-TTY doctor grammar has a regex test (Round 1 Q1).
4. The Round 1 Q9 PowerShell 5.1 gate is a real spawn test on windows-latest. Real conhost/PS 5.1 rendering stays an owner action (Round 1 Q22).

**Rationale:** Rendering from records with injected capabilities is deterministic and covers every C3 variant on both legs, which §9 UX requires. The conditions close the concrete failure modes the repo shows: CRLF conversion on Windows, and a baseline that could otherwise drift with the new code.

**Charter:** C3, C2, C7.

**REVERSIBILITY:** Two-way door.

---

## Q9 — TUI redesign scope

**DECISION:** ACCEPTED with conditions. The scope is as listed: a boxed header, a process strip, a log pane with filter, the byte cap and scrolling, a key-hint footer, the sidebar at ≥ 100 columns, a single column at 80, glyph tiers, and no colour-only meaning. Conditions:
1. **Keep the collapsed settings strip and the toast** (design-language §8.1 items 2 and 4). The round's region list leaves them out. Today's TUI has provider/plan switching and login (`tui/app.ts:334-357, 601-602`). Every existing TUI action stays reachable and visible (C2).
2. **TERM=dumb and non-TTY refuse** and print the line-mode commands, per design-language §8.5. They do not render a degraded frame. NO_COLOR and the glyph tiers render as §8.5 specifies.
3. **Header-only box: accepted.** It narrows Round 1 Q1 amendment 2, which set an upper bound, so this is not a contradiction. It matches design-language D0 and principle 7. The log pane gets an unboxed title line with the count/follow badge.
4. **The process strip shows per-process RSS** (§9 UX, literally). For capped processes it also shows the enforced metric against the cap, with the metric named (footprint/commit), the enforcement mode and the restarts in 15 min.
5. **Data.** The TUI hosts the proxy in-process (`app.ts:64-68`), so it reads the same in-process snapshots `/health` exposes, plus the existing quota/accounts sources. Polling is ≥ 5 s with one request in flight per source (design-language §8.3). There are no new endpoints and no new upstream calls. Minimum size is 60×16 (§8.4).

**Rationale:** The scope delivers §9 UX (health, per-process RSS, key hints) inside the Round 1 Q1 layout. As worded it would drop existing controls and contradict the design-language's TERM=dumb rule. The conditions fix both.

**Charter:** C3, C2, C4 (`frame.ts`), C1 (bounded polling).

**REVERSIBILITY:** Two-way door.

---

## Q10 — Stored state, migration and the release-notes list

**DECISION:** ACCEPTED with conditions. New state is added only where needed. The lock gains a protocol version field. The new config keys are optional. Migrations go through the transaction mechanism, are idempotent and are tested twice. The release notes go in `docs/RELEASE_NOTES_vNEXT.md` (English) and README. Conditions:
1. **Today's lock is a known version.** `{pid, startedAt, nonce}` (`zcode-proxy-manager.mjs:448`) is protocol v0. The Round 1 Q4 proven-takeover rules apply to it: the holder is dead, or its process start time is later than the lock's `startedAt`. Otherwise stale locks left by old kits (5 of 8 Ctrl-C trials) would never be recovered after the update, which is the RC-L failure itself. Only unparsable or unknown-higher-version locks are never deleted automatically. Their error gives what/why/next with the exact path.
2. **New locks are written atomically** (the content is never visible half-written). "Unreadable" can then only mean foreign corruption, never a live contender's partial write.
3. An old kit reading a new lock reads only `pid`/`startedAt` (`:453-455`), so the extra fields are harmless. That is tested against the origin/main manager file.
4. **Correct the "no existing file changes shape" statement and complete the list.** The lock gains a field. Q4 adds an early-output log file. Q3 prunes MCP task files and CDN disk entries. The release notes must also announce: MCP task retention (500 / 7 days) and the resulting idempotency window; CDN disk pruning; log rotation while running and the new log file; the memory thresholds moving from 1536/3072 to 512/1024 MB (recycles become more likely); the solver recycle count moving from 200 to 100; the new JSON fields, the `WARN` value and `completeness: partial` on truncation; the Bun 1.4.4 requirement; shedding during a recycle drain; the Windows graceful stop. Nothing is removed silently.
5. Runtime migrations (lock versions, retention pruning) are idempotent and tested twice like the setup migrations. The Account Rotator migration follows Round 1 Q8.

**Rationale:** C2 requires automatic, idempotent, announced migrations. The evidence shows that treating the version-less lock as "unknown" would keep exactly the stale-lock failure the run exists to fix. The release-notes list as proposed omitted several user-visible changes decided in this round.

**Charter:** C2, C1, C8.

**REVERSIBILITY:** The lock protocol is a one-way door (Round 1 Q4). **ADR: yes** (lock versioning).

---

## Q11 — Proxy lifecycle module shape (arch #2)

**DECISION:** ACCEPTED with conditions. One module owns start/stop/restart/status, the start lock, takeover, orphan adoption, respawn and the budget. All ~10 callers use its interface. `createManager({ root, home, processStartMsImpl, … })` stays the test seam. The manager CLI stays a thin adapter. Conditions:
1. These stay unchanged: the manager CLI's commands, exit codes 0–5 and output; the OMP autostart's exit-code mapping (3 → foreign, 5 → key); the `ZCODE_KIT_RESPAWN_MANAGER` path; and the `respawn <pid> --reason <r>` arguments (`watchdog.ts:80`). After an update, an old running proxy calls the new manager.
2. The module owns the Q1 handoff (budget reserved before the proxy drains) and the Windows graceful stop.
3. The intents print nothing and return outcome records. The preflight path imports no presentation code (RC3).

**Rationale:** Strong candidate with RED evidence (S3, S4). The conditions protect the cross-version contracts that C2 covers and that the update path relies on.

**Charter:** C1, C2, C7.

**REVERSIBILITY:** Two-way door internally. The external contracts are pinned above. No ADR beyond Round 1 Q4 and Q1 above.

---

## Q12 — CLI command modules (arch #7)

**DECISION:** ACCEPTED with conditions. Each command lives in `cli/commands/<name>.mjs` and returns `{ exitCode, records }`. `cli/zcode-kit.mjs` keeps parsing, dispatch and rendering. Exit codes are asserted directly, and the spawn tests pass unchanged. Conditions: "no side effects on import" also means no reads of `process.argv`/env, no `process.exit`, and no I/O at module scope (today `parseArgs(process.argv)`, `ROOT` and `ctx` run at module scope, `cli/zcode-kit.mjs:98-100`). The `bin/` entry points stay unchanged. New test files fall under the Round 1 Q19 guard.

**Rationale:** It removes the measured coupling (116 direct writes, untestable imports) in the hottest file, and it is the prefactor that PROMPT §7 principle 2 requires.

**Charter:** C2, C3, C9.

**REVERSIBILITY:** Two-way door.

---

## Q13 — Windows sampler spec

**DECISION:** ACCEPTED with conditions. One long-lived `powershell.exe -NoProfile -NonInteractive` child polls `Win32_Process` every 1 s. RED rules use commit charge on Windows and RSS on Linux, and the sampler excludes itself by PID. Windows CI runs S1, S2, S3, S4, S5 and S7 short. Binding corrections:
1. **Identification follows Round 1 Q7 condition 2, not the process tree alone.** Windows does not re-parent processes, and the manager starts the proxy detached and then exits, so a tree walk loses exactly the orphans the loop must find. Processes are identified by the tree from the loop root **plus** a run-unique token in `CommandLine` or `ExecutablePath`, for example the isolated `ZCODE_KIT_BUN` path the loop already sets. On Linux the proxy's command line is a relative `bun run src/index.ts serve` (`S1-*.excerpt.csv`), so the command line alone is not unique. A self-test proves that a deliberately orphaned detached process is found.
2. **Schema.** The Linux header is `t_ms,pid,ppid,role,rss_kb,hwm_kb,threads,fds,heap_mb,progress,cmd` (`sampler.mjs:152`), with no commit column. Add `commit_kb` as an additive column (empty on Linux). On Windows: `rss_kb` = WorkingSetSize/1024, `commit_kb` = PrivatePageCount/1024, **`hwm_kb` = PeakPageFileUsage** (peak commit, already in KB), `threads` = ThreadCount, `fds` = HandleCount. The per-process peak rule depends on HWM to catch spikes between samples (memory-report §5). The WMI properties mix bytes and KB, so a start-up self-test checks units against `Get-Process` `PrivateMemorySize64`.
3. The first Windows run on the pre-fix code records a Windows baseline. The budgets keep the same numbers (§9: no loosening). If commit charge alone turns a scenario RED that is GREEN on Linux, it comes back as an owner question and is not adjusted silently.
4. The sampler child is reaped when the loop exits (B4, C1). Its measured overhead is recorded.

**Rationale:** The core matches Round 1 Q7. As worded, the tree-only filter contradicts Round 1 Q7's orphan rule, and the schema drops the peak column that the burst budgets depend on.

**Charter:** C7, C1, §9 (budgets not loosened), B4.

**REVERSIBILITY:** Two-way door.

---

## Q14 — CI layout

**DECISION:** ACCEPTED with conditions. `test-kit` runs {ubuntu, windows} × {Node 24, 26} with the kit, proxy, proxy typecheck and MCP tests. A separate `memory-budget` job (Node 26) runs per OS with the short profile and artefacts. The snapshot tests run in `npm run test`, and `release.yml` changes only in versions. Conditions:
1. **Expected-RED list.** At baseline the current code is RED in S1 burst, S2, S3, S4, S5, S6 and S7 (memory-report §1). Under the §7 Phase 4 rule "a merge that turns anything red is reverted", a fully enforcing job could never land first. The job therefore starts with an explicit expected-RED list (scenario → ticket id). A RED scenario not on the list fails the job. A listed scenario that turns GREEN also fails until its entry is removed, so stale entries cannot pile up. The list must be empty at Phase 6 (§9 CI).
2. The proxy typecheck runs through the pinned proxy `typescript` devDependency (Round 1 Q15), never an unpinned `bun x` download. Bun 1.4.4 is pinned in every job.
3. The memory jobs run under hard caps and timeouts. On ubuntu that is a `systemd-run --user` scope where available, otherwise `prlimit`. On windows the loop applies a Job Object. `ZCODE_MEMLOOP_ALLOW=1` is set only in that job.
4. The Round 1 Q9 PowerShell 5.1 stderr gate runs on the windows leg. CI runs come from the draft PR (Round 1 Q21). Nothing is pushed to `main`/`feature/account-rotator` (B6).

**Rationale:** The layout realises Round 1 Q7, Q14, Q15 and §9 CI. Condition 1 settles a conflict that would otherwise make PROMPT §7's own ordering (memory loop first) and its revert rule incompatible.

**Charter:** C7, C1, C5, §9, B6.

**REVERSIBILITY:** Two-way door.

---

## Q15 — Upgrade staging (Round 1 Q16)

**DECISION:** ACCEPTED with conditions. There are three batches (toolchain & CI; proxy deps; MCP deps), each green before the next, and they land before the memory fixes. Conditions:
1. **Move the proxy `typescript` devDependency and `@types/bun` 1.4.4 into batch (1).** Batch 1 adds the root-CI proxy typecheck, and Round 1 Q15 pins it through that devDependency. The proxy has none today, and `@types/bun` is `latest` (`zcode-proxy-src/package.json:20-21`). Without the move, batch 1's typecheck is unpinned. The typecheck baseline is recorded first, and any failures become tickets (Round 1 Q15).
2. **Record the ordering deviation.** PROMPT §7 Phase 3 lists upgrades (principle 4) after the memory fixes (principle 3). This order comes from Round 1 Q15 (re-baseline on Bun 1.4.4 before the fixes) and Q16 condition 4 (captcha suite green after the happy-dom bump, before any other captcha-path change), so it is justified. It goes into RUNLOG/ADR. The memory loop + budgets harness (principle 1) still lands before batch 1.
3. Each memory-fix ticket's RED test must be RED on the upgraded runtime. If an upgrade alone turns a scenario GREEN, the fix ticket is re-scoped with that evidence. The Bun 1.4.2 baseline stays the budget reference (Round 1 Q15).
4. Batch 1 carries the Round 1 Q14 conditions (refuse before mutating state, `heal.mjs` floor check, DEP0190) and the 1.4.4 SHA-256s from the primary source. MCP SDK 2.x stays out (Round 1 Q16).

**Rationale:** Measuring the fixes on the target runtime gives the stronger evidence (C9). As worded, batch 1 depends on a pin that only arrives in batch 2.

**Charter:** C5, C9, C1 (attribution), §7 ordering (deviation recorded).

**REVERSIBILITY:** Two-way door per batch.

---

## Q16 — Docs plan (C8)

**DECISION:** ACCEPTED with conditions. The scope is as listed: README × 5, SECURITY (+de), harnesses/README*, SUPPORT_MATRIX.json, MANIFEST*, EFFORT_MAPPING* only if affected, and the MCP bridge README translations brought to parity. English comes first, and the translations reach content parity in the same ticket. Additions:
1. In SECURITY (+de), replace the statements that will become false: "The CAPTCHA solver runs on a dedicated worker thread inside the proxy" (`SECURITY.md:15-18`) and "start lock is never taken over automatically" (`:26`). State that the happy-dom loading flags keep the 20.x surface unchanged (Round 1 Q16 condition 1), and that `ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA` keeps its meaning.
2. README × 5 also covers the new optional config keys (admission bytes, solver cap, memory thresholds), log rotation and the early-output file, MCP task retention and the idempotency window, and enforcement modes per OS. `proxy/config.example.yaml` documents the optional keys with their defaults, since it ships in the pack.
3. All five MCP bridge READMEs state the Node 24 floor (all say 20 today). `--help` text documents `WARN`, `--reask` and the rotator override (Round 1 Q8/Q10).
4. `docs/RELEASE_NOTES_vNEXT.md` carries the Q10 list, in English.

**Rationale:** The plan covers every C8 file. The additions are documents that this round's decisions would otherwise leave stale or wrong. SECURITY is the most important one, because it would describe the old process model.

**Charter:** C8, C6 (accurate security statements), C2 (deprecations announced).

**REVERSIBILITY:** Two-way door.

---

## Shared understanding

NOT CONFIRMED. Open branches:
1. **Round 1 Q6 footprint plan:** per-role targets × counts summing to ≤ 600 MB for 5 run + 5 preflight. This waits for `diagnosis/footprint-facts.md` (Round 3).
2. **Solver sizing:** A1 (does a real solve fit under 300 MB), and the measured idle footprint of a solver child process, which validates the 80 % recycle threshold and the count backstop.
3. **Proxy↔manager handoff protocol (Q1/Q11):** how the budget reservation is acknowledged before the drain, and how an old running proxy and a new manager meet during an update.
4. **Windows graceful stop mechanism** (stop file vs IPC vs authenticated loopback), and the shared SIGTERM grace / drain deadline constant.
5. **`proxy.log` details:** the early-output file name, the copy-on-start-failure contract, and rename-with-readers behaviour under Bun on Windows (unverified).
6. **MCP task truncation:** which part of `accumulatedText` is kept, and the documented idempotency window wording.
7. **Doctor Memory section:** exact rows, and the exact next command for a Linux host without a delegated memory controller.
8. **Memory-budget job mechanics:** the expected-RED list format and how it is enforced.
9. **Windows commit-charge baseline** from the first windows-latest run, and any owner question it raises.
10. **Phase 3 quiz:** ticket granularity, blocking edges, merge/split.

## Round 3 (2026-11-06) — footprint plan, stop/restart protocol, log ownership, remaining branches

Questions: rounds/round-03.md. Answers below are copied verbatim from rounds/round-03-answers.md. Shared understanding: CONFIRMED (with build-time gates).

# Round 3: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1 and Round 2 decisions in DECISIONS.md are binding here. Where a recommendation contradicts one of them, the answer says so and the earlier decision wins.

I checked the evidence myself in `diagnosis/footprint-facts.md`, `diagnosis/round3-facts.md`, `diagnosis/memory-report.md`, `METRICS.md` and PROMPT.md §5/§7/§9. I also read the code at 1402052:
- `cli/launch.mjs`
- `proxy/zcode-proxy-autostart.ts`
- `proxy/zcode-proxy-manager.mjs`: `logLine` :89-95, `rotateLogIfNeeded` :97-105, `openLogStream` :431-435, `start()` :502-514, `reserveRespawn` :795-803, doctor checks :1085-1155
- `zcode-proxy-src/src/server/server.ts` :65-105
- `zcode-proxy-src/src/proxy/captcha-solver.ts` :44-63, :174-323

Where the evidence differs from the round's wording, the answer says so.

Where an answer is ACCEPTED with conditions, the conditions bind the spec and the tickets.

---

## Q1 — S3 footprint: metric per OS

**DECISION:** ACCEPTED with conditions. On Linux the gate is the sum of RSS. On Windows the gate is the sum of commit (`PrivatePageCount`). Linux PSS (`smaps_rollup`) is reported for information only and never gates. The scenario is the measured S3: 5 `run` sessions, 5 OMP preflights, the proxy and the solver. Binding conditions:
1. **The effective Linux number is ≤ 596 MB, not 600.** S3 is one of the scenarios whose baseline exceeded its budget (memory-report §6). §9's "peak improves by ≥ 30 %" therefore also applies: 852 × 0.7 = 596.4. The stricter of the two numbers binds. This tightens the budget with evidence, which §9 allows. Round 1 Q6 already noted this arithmetic.
2. **The gate can see short-lived processes.** A warm preflight lives 140–154 ms (footprint-facts Fact 3), so a 1 s sampler can miss it entirely. The S3 verdict therefore has two parts:
   - (a) the maximum, over all samples, of the summed kit RSS (commit on Windows) must be ≤ the total;
   - (b) every kit process's own peak (VmHWM on Linux, PeakPageFileUsage on Windows, or `ru_maxrss` where the loop spawns the process itself) must be ≤ its Q2 per-role target, enforced as role budgets in `verdict.mjs`.

   Part (b) is what makes the as-if-concurrent plan of Q2 a tested claim and not just a sampled one.
3. **Windows applies the same rules against its own baseline.** The total is 600 MB of commit. If the Windows baseline (Q9) exceeds 600, the ≥ 30 % rule applies to that leg as well. Round 2 Q13 condition 3 still holds: the budget is not loosened, and a scenario that is RED only on commit goes back to the owner.
4. **macOS has no sampler and no CI leg.** The macOS RSS gate is recorded as "unverified — owner action" (Round 1 Q22) and is added to OWNER-ACTIONS.md. It must not be claimed as met.

**Rationale:** The 852 MB baseline is a sum of RSS. Keeping the same metric on Linux is the only reading that does not loosen the budget after the fact. Switching to PSS would lower the number without saving a byte. Commit on Windows was decided in Round 1 Q7 and Round 2 Q13. Reporting PSS costs nothing and shows readers how much of the RSS sum is shared pages. The conditions close two gaps. First, the ≥ 30 % rule was not applied. Second, a 1 s sampled sum can miss exactly the transient preflights the plan relies on bounding.

**Charter:** §9 (no loosening; the ≥ 30 % rule), C1 (bounded memory), C7 (Windows metric), C9 (stronger measured evidence).

**REVERSIBILITY:** Two-way door (accounting rule). No ADR.

---

## Q2 — S3 footprint: the mechanisms

**DECISION:** ACCEPTED with conditions. Mechanisms (a)–(d) are accepted. The deferred Windows lever (the Bun bridge) is decided later with numbers. The per-role targets hold, with one correction. Binding conditions:

1. **Correction: the resident launcher target is ≤ 74 MB on the CI Node version, not ≤ 70.** Today's code measures 70.5 MB median on Node 26 and 78.4 MB on Node 24, with HWM 76.4 (footprint-facts Fact 2). A ≤ 70 MB target sits below the measured median, and nothing in the plan changes the resident path, so that number has no evidence behind it. 74 MB equals the S3 baseline launcher (memory-report RC3), so it is not a loosening. The resident path is the Windows path, which is gated there on commit.
2. **(a) In-host single-flight must be taken before the preflight is spawned.**
   - Today `ensureProxy` spawns the preflight on the first call per host, and the manager start lock is acquired only after the preflight has loaded its modules (~100 ms later). Five hosts that start together would all see "no lock" and all spawn a preflight, and the plan (533 MB) would fail at 837 MB.
   - The extension therefore takes its own exclusive token (O_EXCL file in the installation's logs dir, holding host pid and start time) **before** it spawns the preflight. Hosts that find the token wait in-host: a stat poll plus the existing `healthy()` fetch, with no new process.
   - The token follows the Round 1 Q4 lessons. It is released in `finally`. A stale token (holder dead, or older than `START_TIMEOUT_MS`) is taken over by proof. A waiter never waits longer than today's `START_TIMEOUT_MS`.
   - This token is separate from `manager.lock`, whose one-way protocol (Round 1 Q4, Round 2 Q10) does not change.
   - The extension keeps its rule "no kit modules in the long-lived host" (autostart.ts header).
3. **(a) Waiters keep the diagnostics.**
   - If the starter's preflight fails, or the wait times out, a waiter runs its own preflight. The failure categories and the "Next … may retry" message (C3) therefore stay per host.
   - A waiter that sees a healthy proxy after waiting may skip its first-call preflight. The fixed-vocabulary `cause=` warnings that preflight would have printed must still reach that host. The spec chooses the channel, for example the starter writing its cause lines where waiters read them. Dropping them silently is not allowed.
   - An old extension (before re-setup) keeps spawning preflights. That is harmless and covered by the existing manager lock.
4. **(a) The cost of in-host waiting is measured.**
   - S3's OMP leg must run the generated extension in a stub Bun host. That makes "≤ 1 concurrent OMP preflight process" a test result, with 5 simultaneous hosts and also with the starter host killed.
   - The host's RSS delta is reported. It is not counted as kit footprint, because the host is the harness process. It must stay small: ≤ 5 MB per host is the build-time gate. If it is larger, that is a finding that returns with numbers.
5. **(b) Bridge flags.**
   - `--max-semi-space-size=1` goes on the bridge command line in the generated harness MCP entries, never in `NODE_OPTIONS`.
   - Existing harness configs are updated on the next `setup`/`integrate` through the existing transaction, idempotently (C2, Round 1 Q18 condition 2).
   - S5 stays within its budget, and `test:mcp` passes with the flag.
   - Lazy HTTP loading must not change the HTTP mode's behaviour, which the bridge tests cover.
6. **(d) `process.execve` handover:**
   - **Use it only when all of these hold:** POSIX, `typeof process.execve === "function"`, Node ≥ 26.1, and the target has been resolved on PATH and checked with `access(X_OK)`. In every other case the launcher stays resident, as it is today. Pre-validation keeps today's error ("run: …", exit 2) when the harness is missing.
   - **Opt-out:** add a documented opt-out environment variable (`ZCODE_KIT_*`; the spec names it) that forces the resident launcher. `process.execve` is Stability 1 (Experimental), and users need a way back that does not require a downgrade (C2).
   - **Do all the work before the handover:** exit handlers do not run after execve. The `ready.detail` line, any `heal.log` write and any cleanup must finish first. Then re-arm SIGPIPE/SIGXFSZ (add and remove a listener, verified in Fact 2).
   - **Suppress the `ExperimentalWarning`** for this call only. On a TTY it would print kit noise into the harness session.
   - **Announce the one visible exit-status change:** with execve, a harness killed by a signal reports that signal (for example 143) where today it reports exit 1, which loses the signal. This is more correct, but it is a change, so it goes into the release notes (C2: announced, never silent). Exit codes 0/7/130 are unchanged (measured).
   - **Platform coverage:** macOS execve is UNVERIFIED and is added to OWNER-ACTIONS.md. The release notes and README state that the lower footprint on Linux/macOS needs Node ≥ 26.1. On Node 24 the S3 total is not claimed, because the memory job runs Node 26 (Round 2 Q14).
7. **(c)** is governed by Q10.
8. **Windows levers stay ordered by evidence.** If Windows misses 600 MB of commit after (a)–(c), the orchestrator returns with numbers for the measured candidates. These are the lean resident launcher (preflight in a child; 49 MB vs 70.5 MB on Linux; Node-only, smaller blast radius) and the Bun bridge (needs protocol parity). Neither is adopted now.

**Rationale:** The footprint facts close every Round 1 Q6 question with measurements:
- bare Node: 42–45 MB;
- waiting preflight: ≥ 48 MB as a process;
- bridge floor on Node with the SDK: ≈ 72 MB;
- execve handover: 0 MB resident and the same pid.

Plan P's arithmetic checks out: 5 × 75 + 76 + 62 + 20 = 533 ≤ 596, a margin of 63 MB. The plan carries two hidden assumptions, and the conditions turn them into tested properties:
- The waiters really are not processes. The current code would race past the manager lock.
- The resident launcher number is backed by evidence.

The execve conditions keep C2's guarantees (exit codes, error messages, a way back) on an experimental API.

**Charter:** C1 (bounded process count and memory), C2 (exit codes, transactioned config migration, announced change, opt-out), C3 (no kit noise, every failure keeps what/why/next), C7 (Windows stays resident and is gated on commit), C9 (measured evidence; the smaller blast radius decides the lever order), §9.

**REVERSIBILITY:** The bridge flags and targets are a two-way door. The in-host token and the execve handover change the process model of `run` and of the OMP autostart. Their failure modes are cross-version: an old extension meeting a new token, and signal exit status. **ADR: yes** (launcher handover and in-host single-flight).

---

## Q3 — Windows graceful stop

**DECISION:** ACCEPTED with conditions. `POST /__kit/stop` on the existing loopback listener is accepted. It needs a per-spawn 256-bit stop capability, passed as `ZCODE_KIT_STOP_TOKEN` and recorded as an additive field in `proxy.pid`. The capability is compared in constant time and never logged. The request triggers the single graceful sequence of Round 2 Q1. The fallback is today's handle-checked `TerminateProcess`/SIGKILL. Binding conditions:
1. **Two credentials, in the existing order.**
   - The route sits after the Host, Origin and bearer checks (`server.ts:70-102`) and additionally requires the capability header. Both are compared in constant time, length included.
   - **If the proxy has no token** (the TUI hosting the proxy in-process, a standalone proxy), the route answers the same `404 not_found_error` as an unknown route. It never accepts without a capability.
   - No CORS allowance is added for the route.
   - The capability never appears in logs, `status`/`--json`, doctor, snapshots or error text (C6). It is stripped from the solver child's environment (round3-facts §4 caveat 2).
   - On Windows, `proxy.pid` is protected by the user-profile ACL, the same as `.proxykey`.
2. **The stop request bypasses admission.** It has no body, is never queued behind the Round 1 Q5 byte cap, and answers `202` before the drain starts. The listener stays open during the drain (Round 2 Q1 condition 2).
3. **One trigger path on every platform.**
   - The manager sends the request on Windows **and** POSIX, after the existing identity proof (`healthIdentify` + `verifyOwnProcess`). That way the Linux CI exercises the same path Windows users take.
   - On POSIX, SIGTERM remains a handled trigger of the same sequence (external supervisors, `kill`). The manager also sends SIGTERM when the request gets 404/401/403 or a connection error.
   - On Windows, a 404/401/403 or a connection error goes straight to `TerminateProcess` (old proxy, today's behaviour).
4. **The deadline is strictly ordered, not equal.** `STOP_GRACE_MS = 10_000` is the proxy's own hard deadline: drain + the 3 s account-metadata flush + exit. The manager forces only after `STOP_GRACE_MS + STOP_EXIT_MARGIN_MS`, a named constant of at least a few 300 ms poll intervals (for example 2 s). Both live in one shared module and are tested together. Two equal 10 s timers would race, and the manager could kill the proxy in the middle of the flush, which is the defect Round 2 Q1 condition 3 exists to remove. The respawn wait (30 s) stays longer than ack-wait + grace (Q4).
5. **Callers that know the proxy is broken use the force variant directly:** `recoverHung` (a hung main thread would never answer), the startup timeout and foreign-port paths in `start`, and the golden-path crash injection (explicit force helper, as proposed). Only `stop`, `restart` and the update path use the graceful request.
6. On a TTY, `proxy stop`/`restart` show progress while the grace runs. Off a TTY they stay line-based (C3). A windows-latest test proves that the flush runs on `proxy stop`.

**Rationale:** round3-facts §1.3 shows from primary sources that no signal or console event can reach a console-less detached proxy on Windows. Today a Windows "graceful" stop is `TerminateProcess` (`zcode-proxy-manager.mjs:409`). Option A adds the least surface: no new port, file watcher or IPC. It reuses the repo's own capability pattern (`android/control.ts`). The capability closes the gap facts §1.2 identified, where every harness holding the key could otherwise stop the proxy. The conditions fix four issues:
- equal timers that race;
- a route that could accept without a token where none was issued;
- a stop request that could queue behind admission;
- an unspecified "may" on POSIX that would leave the Windows path untested on Linux.

**Charter:** C6 (loopback, bearer + capability, no secrets in output), C1 (flush completes; reaping by fallback), C7 (graceful stop on the primary platform), C2 (old proxies keep today's behaviour), C3, C9.

**REVERSIBILITY:** The endpoint and the `proxy.pid` field meet old and new kits during updates. **ADR: yes** (lifecycle stop contract; extends the Round 2 Q1 ADR).

---

## Q4 — Restart handoff and budget acknowledgement

**DECISION:** ACCEPTED with conditions. On a memory recycle the proxy spawns the hook with unchanged arguments. It waits up to 10 s for the file acknowledgement: a `logs/respawn.json` event with `pid === process.pid` and `at` later than the request time. Only then does it drain. On exit 4 or no acknowledgement it does not drain: it keeps serving, logs ERROR once, reports `restarts` as exhausted, and retries after the budget window. The watchdog path self-terminates after acknowledgement or refusal. Old proxies keep today's behaviour, and this is documented. There is no piped-stdout acknowledgement. Binding conditions:
1. **The log dir reaches the proxy through one additive `ZCODE_KIT_*` env variable.** It survives `proxyEnv` (`lib/proxy-env.mjs:21`), a test proves it, and Q5 reuses it. Nothing else changes in the proxy env contract.
2. **The proxy observes the hook's `exit` event during the wait.** Exit 4 counts as a refusal immediately. After the wait the proxy unrefs the hook handle. The detached hook must outlive the proxy.
3. **The timing invariant is tested:** respawn wait (30 s, `respawnWaitMs`) > acknowledgement wait (10 s) + `STOP_GRACE_MS` + margin (Q3). A late acknowledgement must lead to "healthy and ours → already running, 0" (`zcode-proxy-manager.mjs:540-541`) and never to a second proxy or a kill of the serving one. A test covers it: an acknowledgement after the proxy's timeout leaves exactly 1 proxy, with the slot consumed.
4. **A backwards wall-clock jump fails safe.** A missed acknowledgement means "keep serving". It never means "drain". Matching on `pid` plus `at > requestTime` makes an earlier event for the same pid unmatchable. Both are tested.
5. **The watchdog waits for the acknowledgement or refusal for a bounded time,** at most the same 10 s, and then self-terminates regardless, logging which outcome it saw. A refusal there can end with zero proxies. That is accepted because a hung proxy serves nobody, and the next launch's preflight starts a fresh one without the 36–44 s hung-own proof.
6. **The retry after refusal is bounded:** at most one hook spawn per budget window while the hard condition persists (each spawn is a transient Node manager process). The ERROR line uses the Round 2 Q5 event-line format. The doctor `restarts` row (Q7) shows the state.

**Rationale:** round3-facts §2 confirms the C1 hole in the code. `launchRespawnHook` resolves on `spawn` (`watchdog.ts:108`), and `reserveRespawn` runs only afterwards (`zcode-proxy-manager.mjs:827`). A refusal therefore leaves zero proxies. The file acknowledgement is the only channel that also works with an old manager: it writes `{at: Date.now(), pid, reason}` at reservation by temp + rename (`:797-803`, verified). It needs no new arguments (Round 2 Q11 condition 1) and carries no EPIPE risk. The conditions pin the races the recommendation leaves implicit: a late acknowledgement, a clock jump, the watchdog's bound and the retry rate.

**Charter:** C1 (never zero proxies on the memory path; no restart storm), C2 (hook arguments unchanged; old/new manager interop), C7, C9.

**REVERSIBILITY:** It is a cross-version handoff contract. **ADR: yes** (extends the Round 2 Q1 handoff ADR).

---

## Q5 — `proxy.log` ownership

**DECISION:** ACCEPTED with conditions. The proxy is the single rotator of `proxy.log` while it runs (5 MB, keep `proxy.log.1`). The manager keeps appending its own lines and no longer rotates under a live proxy. Inherited stdio goes to `proxy.early.log`, which is truncated at each start and capped at 1 MB. A bounded 64 KB tail of it is copied into `proxy.log` with a marker. The solver child writes through the parent's writer. `proxy logs N` reads `.1` + current. A windows-latest test proves the rename behaviour. Binding conditions:
1. **The rotation order is: unlink `.1` → rename current → `.1` → reopen,** not "close → rename". On Windows a replace-rename fails while the *target* is open, and unlinking first frees the name at once (round3-facts §3.4, implication 1). The writer uses plain fd writes, never `FileHandle.createWriteStream` (oven-sh/bun #32829).
2. **Every creator of a log file uses mode `0o600`, and the logs dir uses `0o700`.** Today `logLine` calls `appendFileSync(LOG_FILE, …)` with no mode, and `mkdirSync(LOG_DIR, { recursive: true })` with no mode (`zcode-proxy-manager.mjs:92-93`). Only `openLogStream` sets `0o600`. Once the proxy rotates while running, the manager's next append will often be the call that *creates* the new `proxy.log`, with umask permissions such as `0644`. That would be a C6 regression. The same rule applies to `proxy.log.1` and `proxy.early.log`.
3. **Manager-side rotation exists only for the no-proxy case, and only under the start lock.** Today `start()` rotates at `:503`, before it acquires the start lock (`:514`), so concurrent preflights can rotate concurrently and delete each other's `.1`. Repeated start failures still need a bound, because each one appends manager lines plus a 64 KB tail. So the manager may rotate only under the start lock, and only when no live recorded proxy exists.
4. **The tail copy also covers crashes (Round 2 Q4 condition 2: "or after a crash").** The round names start failure and respawn only. A runtime crash with no respawn (a Bun panic, an uncaught error) would lose its output when the next start truncates the early file. Rule: before **any** truncation of a non-empty `proxy.early.log`, the manager appends its last 64 KB to `proxy.log` with the marker line. Start failure and respawn are special cases of this rule. The golden-path classifier keeps reading only `proxy.log`.
5. **The 1 MB early-file cap needs a named enforcer.** The fd is inherited, so nobody rotates it implicitly. The proxy's writer checks the early file's size at each rotation check and truncates it in place when it exceeds 1 MB, after first writing a marker event to `proxy.log`. S7 asserts that `proxy.early.log` ≤ 1 MB + bounded overshoot.
6. **Foreign handles.** If a handle the kit does not own blocks the rename (an editor, AV, `Get-Content -Wait`), the writer keeps appending, retries at every check and logs one WARN event line. Nothing is lost, and rotation resumes as soon as the handle closes. This case is documented. S7's ≤ 6 MB budget is proven with kit readers and writers open. That is the bound Round 2 Q4 condition 1 requires.
7. Watchdog lines written to fd 2 end up in the early file and reach `proxy.log` through rule 4. The worker may also append them to `proxy.log` by path (`appendFileSync`, mode `0o600`), which is preferred, because users look there.

**Rationale:** The direction is the Round 2 Q4 decision. round3-facts §3.3 found a live-proxy bug: rotating in `start()` before the health check deletes the file the running proxy writes into. Making the proxy the single rotator fixes it. The conditions fix four things in the round's wording, each checked in the code:
- the rename order that fails on Windows;
- a file-permission regression that the new rotation frequency would expose;
- a rotation outside the lock;
- the dropped "after a crash" case, which Round 2 Q4 had bound.

**Charter:** C1 (bounded disk), C2 (the golden-path classifier and docs keep working), C6 (log file permissions unchanged or stricter), C7 (Windows rename semantics), C3.

**REVERSIBILITY:** Two-way door (the new file name is additive and documented). No ADR.

---

## Q6 — MCP task text truncation and idempotency wording

**DECISION:** ACCEPTED with conditions. Cap the text at 4 MiB. Keep the first 1 MiB and the last 3 MiB, with one marker line `[… N bytes truncated …]`. Set `completeness: partial` and merge the truncation note into the end-state explanation. The transcript fallback gets the same cap. Cached `.result.json` files written before the change are served as stored. The idempotency sentence is adopted as written, with "whichever comes first" added. Binding conditions:
1. **The bound applies during ingestion, not only in `buildResult`.** `accumulatedText` grows in memory with every delta (`ingress.ts:132-137`). A result-time cut would leave the buffer unbounded, which fails §9 BOUNDS. The head is frozen at 1 MiB. The tail is a rolling 3 MiB window, and the dropped-byte count is tracked.
2. **The units are UTF-8 bytes**, consistent with `store.ts`'s `Buffer.byteLength`. Cuts fall on code-point boundaries, so no split surrogates or UTF-8 sequences appear. `N` in the marker is a byte count.
3. **The additive `truncated` marker of Round 2 Q3 condition 4 stays** as a field on the result (for example `truncated: { droppedBytes }`). A note inside the explanation is not enough. The truncation explanation is combined with the terminal-state override (`manager.ts:640-642`), which runs last, so the override cannot erase it.
4. `dist/` is regenerated (B5). `docs/MCP_API.md`, the tool description and the release notes describe the cap, the marker and the idempotency window.

**Rationale:** Keeping head and tail fits the data: the end of an agent turn carries the answer, and the head carries the framing. The conditions make the cap a real memory bound, not just an output trim. They also remove the code-unit/byte ambiguity that round3-facts §5 flagged, and they keep the additive field Round 2 already bound.

**Charter:** C1 / §9 BOUNDS, C2 (additive field; old results served unchanged; existing `completeness` semantics), C8, B5.

**REVERSIBILITY:** Two-way door (the split between kept parts). No ADR beyond the Round 2 Q3 retention ADR.

---

## Q7 — doctor Memory rows and next commands

**DECISION:** REJECTED in part. Accepted: four new additive rows, the off-TTY grammar `WARN  <name> — <detail>`, what/why/next for every WARN, `sampling` on macOS = PASS with a note, `restarts` WARN when the budget is exhausted with next `zcode-kit proxy logs 50`, proxy memory WARN at/above soft with the config key and `zcode-kit proxy restart`. My corrections:
1. **The solver row does not WARN at 80 % of the cap.** 80 % is the footprint recycle threshold (Round 2 Q2 condition 3). A solver above it mid-solve is normal and recycles right after the solve. A one-shot doctor sample would therefore show a flapping, non-actionable WARN, against Round 1 Q10's meaning of WARN. The solver row WARNs when the solver is in the fail-fast window, or when an abnormal exit (cap kill, crash, deadline kill) happened inside the 10-minute restart window. The next step names the cap's `config.yaml` key (for cap kills) or `zcode-kit proxy logs 50`. Otherwise it shows PASS with footprint/cap in the detail. It shows SKIP when no solver has run (lazy spawn, coding-plan).
2. **The enforcement row covers every case in Round 2 Q5 condition 3:**
   - WARN for `sampling` on Linux (next: `systemctl --user status`, plus the README section, as proposed);
   - WARN for `sampling` on Windows, meaning the Job Object failed (next: `zcode-kit proxy logs 50`);
   - WARN for `none` (thread fallback or caps off; next: the config key that switches caps on);
   - PASS for `job-object`/`cgroup` and for macOS `sampling`;
   - SKIP before the first solver spawn, because no mode exists yet.
3. **Check names follow the existing style.** Today's names are lower-case phrases without colons ("proxy reachable + identity", "bun available", `zcode-proxy-manager.mjs` doctor), so the new rows are "proxy memory", "solver memory", "memory cap enforcement" and "restart budget". The JSON names are additive (Round 2 Q5 observability contract), and the regex grammar test covers them.
4. Values come from the cached `/health` details (Round 2 Q5 condition 2). Doctor triggers no new sampling work in the proxy.

**Rationale:** The rows give §9 UX/Observability a doctor surface with exact next commands. The solver threshold as worded would WARN during normal operation. The enforcement rows omitted two cases Round 2 bound (`none` and a failed Job Object). The names would break the consistent vocabulary design-language asks for.

**Charter:** C3 (actionable WARN, consistency), C2 (additive checks and JSON), Round 1 Q10, Round 2 Q2/Q5.

**REVERSIBILITY:** Two-way door for thresholds. The check names fall under the Round 2 Q5 observability ADR.

---

## Q8 — Expected-RED mechanics for the memory job

**DECISION:** ACCEPTED with conditions. `tests/memory/expected-red.json` maps scenario/variant → ticket id. The job fails on a RED scenario that is not listed and on a listed scenario that turns GREEN (ratchet). Each memory-fix ticket's acceptance criteria include deleting its entry, and the file must be empty at the Phase 6 gate. Conditions:
1. Entries are keyed per OS leg (`linux` / `windows`). The Windows baseline may be RED in different scenarios than Linux (Q9).
2. The schema is validated: an unknown scenario or variant, or a ticket id with no file in `.scratch/kit-overhaul/issues/`, fails the job.
3. `verdict.test.mjs` pins the ratchet rule.

**Rationale:** This is the mechanism Round 2 Q14 condition 1 asked for. Keying by OS follows from Round 2 Q13 condition 3. Schema validation keeps stale or typo entries from hiding a RED scenario.

**Charter:** §7 Phase 4 (revert rule), §9 CI, C7, C9.

**REVERSIBILITY:** Two-way door.

---

## Q9 — Windows baseline

**DECISION:** ACCEPTED with conditions. The Windows numbers are recorded in METRICS.md before any memory fix merges, and the job may be RED only through `expected-red.json`. Condition: **record two Windows runs, not one.**
1. **The Bun 1.4.2 reference run.** The memory loop + budgets harness, with the Windows sampler and the units self-test (Round 2 Q13), merges before the toolchain batch (Round 2 Q15). The draft PR opens at the first merge (Round 1 Q21). The run on that code is the Windows **budget reference**, matching the Linux rule that 1.4.2 stays the reference (Round 1 Q15).
2. **The run right after the toolchain batch (Bun 1.4.4)** is the attribution point. It separates the runtime's effect from the fixes' effect (Round 1 Q15, Round 2 Q15 condition 3).

If the sampler cannot run on the pre-upgrade code for a recorded reason, the 1.4.4 run becomes the reference, and that is noted in RUNLOG.

**Rationale:** Round 1 Q15 requires the runtime upgrade's effect to be separable from the fixes' effect, and the same reasoning holds on the primary platform. The first draft-PR CI run happens on pre-upgrade code anyway, so the extra run costs nothing.

**Charter:** C7, C1 (attribution), C9, §9 (no loosening).

**REVERSIBILITY:** Two-way door.

---

## Q10 — Solver process lifetime

**DECISION:** ACCEPTED with conditions. The solver is spawned on the first solve and kept alive while solves arrive. It exits after 10 min idle. There is at most one solver process per proxy, including during a recycle (Round 1 Q3 condition 4). An idle exit is not an abnormal exit. Prewarm is off by default. These semantics match today's code exactly: lazy `worker ?? spawnWorker()` (`captcha-solver.ts:308`), `idleMs: 10 * 60_000` (`:63`) and idle recycle (`:288-291`). The change is the lifecycle of a process instead of a thread, which B1 allows. Conditions:
1. **The 90 s per-solve deadline still starts at dispatch, as today** (`:309`). The cold-start cost is measured and recorded in METRICS: spawn + cap handshake + module load, on Linux and Windows. If it exceeds 5 % of the deadline (4.5 s), it comes back as a finding. Silently moving the deadline would change solve behaviour (B1).
2. **An idle exit releases the cap container** (closes the Job Object, ends the scope) and leaves 0 solver processes. The S4/S2 orphan checks assert this.
3. The child environment excludes `ZCODE_KIT_RESPAWN_*` and `ZCODE_KIT_STOP_TOKEN` (round3-facts §4 caveat 2, Q3). It keeps the Round 2 Q2 condition 5 parity inputs.

**Rationale:** Lazy spawn is what puts the solver at 0 MB in S3 (the Plan P variant with margin 87). It also keeps today's lifecycle unchanged, so it is not a behaviour change under B1. The conditions keep the deadline semantics identical and make the cold-start cost a measured fact rather than an assumption.

**Charter:** C1 (bounded processes, reaping), B1 (lifecycle only), C9.

**REVERSIBILITY:** Two-way door (defaults). No ADR beyond Round 1 Q3.

---

## Shared understanding

CONFIRMED. Every branch of the design tree that /to-spec needs is settled by Rounds 1–3, with the conditions above folded in. The Phase 3 quiz (ticket granularity, blocking edges, merge/split) belongs to /to-tickets, not to /to-spec.

Build-time gates. These are settled by measurement during the build or by owner action. If a gate fails, it returns as a question with numbers.

1. **S3 footprint, Linux:**
   - ≤ 596 MB as a summed-RSS sample maximum on Node 26, plus per-role per-process peaks within the Q2 targets (Q1, Q2).
   - The in-host waiter cost is ≤ 5 MB per host.
   - ≤ 1 concurrent OMP preflight process, including the killed-starter case.
2. **S3 footprint, Windows:** ≤ 600 MB of commit against the Windows baseline (≥ 30 % rule if that baseline exceeds 600). If it misses, the lever choice (lean resident launcher vs Bun bridge) returns with numbers (Q2 condition 8).
3. **Windows baseline:** the Bun 1.4.2 reference run and the 1.4.4 attribution run are recorded before any memory fix (Q9). Any scenario RED only on commit goes back to the owner (Round 2 Q13).
4. **Solver:**
   - A1: does a real vendor-SDK solve fit under 300 MB (owner action)?
   - The cold-start time is ≤ 5 % of the 90 s deadline (Q10).
5. **windows-latest proofs:**
   - `proxy.log` rotation with kit readers/appenders open (Q5);
   - the graceful stop flush via `/__kit/stop` (Q3);
   - the PowerShell 5.1 stderr gate (Round 1 Q9);
   - Job Object reaping after the proxy is SIGKILLed (Round 1 Q3).
6. **Bridge flags:** S5 within budget and `test:mcp` green with `--max-semi-space-size=1` and lazy HTTP (Q2 condition 5).
7. **Proxy typecheck baseline:** any failures become tickets (Round 1 Q15, Round 2 Q15).
8. **Owner actions:** macOS execve and macOS footprint (Q1, Q2); A2 and real conhost/PS 5.1 rendering (Round 1 Q22); the optional live smoke.
