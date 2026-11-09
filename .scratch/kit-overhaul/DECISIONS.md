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

## Round 4 (2026-11-06) — /to-spec seam check and spec fidelity

Questions: rounds/round-04.md. Answers below are copied verbatim from rounds/round-04-answers.md.

# Round 4: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–3 decisions in DECISIONS.md bind these answers. Where the spec or a recommendation contradicts one of them, the answer says so and the earlier decision wins.

I checked the spec myself against DECISIONS.md (Rounds 1–3), PROMPT.md §5/§7/§9, `docs/adr/0001–0015`, `GLOSSARY.md`, `ux/design-language.md`, `diagnosis/memory-report.md` §6, `diagnosis/data/S4-short.summary.json`, the `ux/before/doctor/*` snapshots and the code at b1aab55:
- `lib/proxy-env.mjs:1-30`
- `proxy/zcode-proxy-manager.mjs`: :165, :589, :1148-1155
- `zcode-proxy-src/src/runtime/watchdog.ts`: :72-112, :177, :189-193
- `zcode-proxy-src/src/proxy/captcha-solver.ts`: :136, :296-336
- `zcode-proxy-src/src/proxy/captcha-pool.ts`: :87-91
- `cli/zcode-kit.mjs`: :69, :91, :125, :671
- `cli/context.mjs:152`, `cli/heal.mjs:166`
- the diagnosis-branch loop: `tests/memory/scenarios/s4-lifecycle.mjs:148`

Where an answer is ACCEPTED with conditions, the conditions bind the spec and the tickets.

---

## Q1 — Test seams

**DECISION:** ACCEPTED with additions. The nine seams are the right ones, and no new seam is needed. But some decided behaviours have no home in any seam's coverage list, and two properties sit below the highest seam that can observe them. These additions bind `seams.md` and spec → Testing Decisions:
1. **Seam 5 (CLI spawn tests) gains the `process.execve` handover (Round 3 Q2 condition 6).** Spawn `zcode-kit run` against a fake harness executable on POSIX and assert each of these:
   - With Node ≥ 26.1, the harness runs under the launcher's pid, so no launcher process is resident.
   - On Node < 26.1, with `ZCODE_KIT_RESIDENT_LAUNCHER=1`, or with a non-executable target, the launcher stays resident.
   - A missing harness still gives `run: …` and exit 2.
   - stderr carries no `ExperimentalWarning`.
   - The `ready.detail` line and the `heal.log` write happen before the handover.
   - A harness killed by SIGTERM reports 143.
   - Exit codes 0, 7 and 130 are unchanged.
   The windows-latest leg asserts the resident path with signal and exit-code forwarding as today.
2. **Seam 1 owns "0 solver processes after the proxy is SIGKILLed", "an idle exit leaves 0 solver processes" and "≤ 1 solver process per proxy at every sample".** ADR-0002 condition 2, Round 3 Q10 condition 2 ("the S4/S2 orphan checks assert this") and §18 PROCESSES are process-level claims, and the windows proof is Job Object reaping. A dispatcher-level test (seam 3) cannot SIGKILL its own test runner, so seam 3 keeps only the ordering logic of one generation at a time.
3. **Seam 8 gains:**
   - the preflight check of the OMP autostart's pinned Node path against the floor (Round 1 Q14 condition 2);
   - the waiter cause-line record of Q2 below (generated logic);
   - the per-spawn environment rules of Q4 below: `ZCODE_KIT_LOG_DIR` and `ZCODE_KIT_STOP_TOKEN` are set by the manager and overwrite ambient values, and the stop token is absent from the respawn hook's environment.
4. **Seam 1's S3 OMP leg asserts that each waiter host printed the starter's `cause=` lines** whenever the starter's preflight emitted any. It does so with 5 hosts and in the killed-starter case (Round 3 Q2 condition 3).
5. **Seam 2 (manager CLI spawned) gains `proxy logs N` reading across `proxy.log.1` and `proxy.log`** (Round 2 Q4) and the golden-path classifier reading the tail-copy marker.

**Rationale:** Every seam on the list exists in the repo or is a small, justified addition (the snapshot suite, the guards). The list misses a home for one whole decided mechanism, the execve handover. That mechanism carries announced exit-status changes and an experimental API, so it needs a real spawn test (C2). The list also places the solver reaping claims below the level that can observe them. Round 3 Q10 already bound those claims to the S2/S4 orphan checks. The remaining items are decided behaviours with no named test.

**Charter:** C2 (exit codes, announced changes tested), C1 (reaping proven at process level), C7 (Windows resident path), C9 (fewest seams, highest observation point).

**REVERSIBILITY:** Two-way door.

---

## Q2 — Preflight cause-line channel

**DECISION:** ACCEPTED with conditions. The starter writes a result record next to the single-flight token, and waiters read it. Binding conditions:
1. **Write before release.** The starter writes the record by temp file + rename, with mode `0o600`. It does this on every outcome (success, failure, timeout) and **before** it releases the token in `finally`. A waiter therefore never sees a released token without that attempt's record.
2. **A record belongs to one attempt.** The record carries the same identity as the token: host pid, host start time and a per-attempt nonce. A waiter accepts a record only if its identity equals the token it observed while waiting and its timestamp is not earlier than the waiter's own wait start. Any other record is stale and is never printed. A record left by an earlier start, or by a different installation's clock, is never replayed.
3. **No matching record counts as a starter failure.** This covers a token released without a matching record, and a token proven stale because the holder is dead. The waiter applies the existing ADR-0013 takeover-by-proof and becomes the new starter with its own preflight. The other waiters keep waiting on the new token. That way "≤ 1 concurrent OMP preflight process" holds in the killed-starter case as well, and no diagnostic is dropped silently.
4. **Bounded, fixed-vocabulary content.** The record holds only the exit code and the fixed-vocabulary `cause=` lines, with no paths, keys or free text. Its size is capped (for example ≤ 4 KB / ≤ 16 lines). The waiter validates every line against the fixed vocabulary before printing it in its host. A corrupt or oversized record is treated as "no matching record" (condition 3).
5. **One file.** The record has a fixed name and is overwritten per attempt. It counts toward S4's log-dir file budget (≤ 8, loop-encoded). Waiters never delete it.
6. An old extension (before re-setup) neither writes nor reads the record, which is harmless (Round 3 Q2 condition 3). The channel is recorded as an amendment line in ADR-0013 (condition 3).

**Rationale:** The channel fits Round 3 Q2: it starts no new process, it lives in the logs dir that already holds the token, and it keeps the host free of kit modules. As worded, it has three gaps. A waiter could read a stale record from an earlier start and print causes that do not apply. A waiter could find no record at all after a starter was killed. A waiter could print unvalidated file content into a harness session. The conditions close each gap by reusing the token's own proof and takeover rules, so they add no new mechanism.

**Charter:** C3 (diagnostics reach every host; no kit noise), C1 (≤ 1 preflight process, bounded file), C6 (`0o600`, no secrets, validated output), C9 (reuse the token protocol).

**REVERSIBILITY:** Two-way door (internal to one installation's generated extensions; old extensions ignore it). ADR: amendment line in ADR-0013, no new ADR.

---

## Q3 — Handover opt-out name

**DECISION:** ACCEPTED with conditions. The variable is `ZCODE_KIT_RESIDENT_LAUNCHER=1`. Conditions:
1. **The value convention is exactly `"1"`,** as the kit's other opt-in switches use it (`ZCODE_KIT_SKIP_DEPS === "1"`, `cli/context.mjs:152`; `ZCODE_KIT_ALLOW_CHECKOUT === "1"`, `cli/heal.mjs:166`). Any other value leaves the default.
2. The launcher reads the variable before the handover decision. With the variable set, the resident path behaves byte for byte as today, which the Q1 spawn test asserts. On Windows the variable has no effect, because the launcher is always resident.
3. **Documented as a user-visible variable:** `--help` (environment section), README × 5 next to the Node ≥ 26.1 note, and the release notes entry for the handover (Round 3 Q2 condition 6; spec §6 d, §10 Help, §16).
4. No other code path reads the variable.

**Rationale:** The name follows the `ZCODE_KIT_*` family and says what it forces, the resident launcher, which is the glossary term (GLOSSARY "Launcher", "Handover"). It does not collide with any existing variable (the repo has no `ZCODE_KIT_RESIDENT*`). Once released, users will script it, so it becomes part of C2's env-var surface.

**Charter:** C2 (a way back without a downgrade; env vars keep working once released), C8, C9.

**REVERSIBILITY:** One-way door once released (a public env var). **ADR: yes** (amendment line in ADR-0013 condition 6 naming it).

---

## Q4 — Log directory env

**DECISION:** REJECTED as worded; the name is accepted. The name `ZCODE_KIT_LOG_DIR` is accepted. The mechanism "added to the `proxyEnv` allowlist" is factually wrong, and the same error appears in spec §4 for `ZCODE_KIT_STOP_TOKEN`. `proxyEnv` (`lib/proxy-env.mjs:1-30`) copies the whole source environment and deletes only `ZCODE_PROXY_*`/`CLAIM_`/`ASYNC_`/`DUMP_`/`CAPTCHA_*` (with listed exceptions), `CAPTCHA_*`, `PE_PATCH` and ambient proxy variables (:21). `ZCODE_KIT_*` already passes through, so an allowlist entry does nothing. The real risk is the opposite: an **ambient** value passes through. The respawn hook is spawned with the proxy's own `process.env` (`watchdog.ts:177`, `:107`). A respawned manager therefore inherits the old proxy's `ZCODE_KIT_LOG_DIR` and `ZCODE_KIT_STOP_TOKEN`, and without an explicit overwrite it hands them to the next proxy. My decision:
1. **The manager sets both variables explicitly at every proxy spawn,** at the same place as `ZCODE_KIT_RESPAWN_NODE`/`_MANAGER` (`zcode-proxy-manager.mjs:589`) or inside `proxyEnv` the way `ZCODE_PROXY_CONFIG` is set. The value overwrites any inherited value. `ZCODE_KIT_LOG_DIR` is the manager's own logs dir. `ZCODE_KIT_STOP_TOKEN` is freshly generated for each spawn and is the same value written to `proxy.pid`.
2. **The proxy removes `ZCODE_KIT_STOP_TOKEN` from the environment it gives the respawn hook,** as it already must for the solver process (Round 3 Q3 condition 1, Q10 condition 3). The hook never needs the token, and passing it on breaks "per-spawn".
3. **`ZCODE_KIT_LOG_DIR` is internal, not a user setting.** A proxy started without it (TUI-hosted, standalone) keeps today's behaviour: no size-capped file writer is opened by path, and no respawn acknowledgement wait happens, because no manager hook exists (ADR-0008 condition 5). The variable is documented as internal, like `ZCODE_KIT_RESPAWN_*`, and not in the user env-var list.
4. **Tests (seam 8 `proxy-env` suite + seam 2):**
   - with ambient bogus values for both variables, the spawned proxy receives the manager's logs dir and a new token;
   - the token in the proxy's environment equals the one in `proxy.pid`;
   - the respawn hook's environment has no stop token;
   - two consecutive spawns get different tokens.

**Rationale:** Round 3 Q4 condition 1 requires that the variable "survives `proxyEnv`" with a test, and that nothing else in the proxy's env contract changes. Round 3 Q3 requires a *per-spawn* stop token that never leaks. The proposed "allowlist" wording would make an implementer add a no-op and miss the actual requirement: overwrite at spawn, and strip from the hook. Inheritance through the respawn chain would otherwise reuse a stale token. In the worst case it would point a new proxy at a stale logs dir.

**Charter:** C6 (per-spawn secret, no leaks), C1 (logs land in the bounded, rotated file), C2 (env contract otherwise unchanged; TUI/standalone keep today's behaviour), C9.

**REVERSIBILITY:** Two-way door (internal variable; both sides ship in one release). Record the name in ADR-0015 condition 1 and the overwrite rule in ADR-0014 condition 1 as amendment lines.

---

## Q5 — Spec fidelity

**DECISION:** REJECTED. The spec is faithful in most of its sections. §1–§3, §5, §7, §9, §11–§15, §17, the §18 budget table and the build-time gates match Rounds 1–3. I found **11 deviations**, and three of them matter (D1–D3). Apply every correction below to `spec.md` (and to `seams.md` where noted) before /to-tickets. None of them reopens a design branch.

**D1 (matters).** *§10 capability record + Binding rules; Stories 90, 106.* The record sends non-TTY output to the `ascii` glyph tier. design-language §3.2 says "Copy follows the tier. On `ascii`, kit-authored punctuation maps down (`—`→`-`)". Together, these rewrite every off-TTY check row to `PASS  name - detail`. That contradicts **ADR-0001 rule 1 / Round 1 Q1 amendment 1 and Round 1 Q10 condition 2** (the exact legacy grammar with ` — `), the `ux/before/doctor/*/pipe.txt`, `term-dumb.txt` and `ascii-locale.txt` snapshots (all ` — `), and the existing parser `cli/zcode-kit.mjs:671`. The spec regex also makes the detail mandatory, but today it is optional (`zcode-proxy-manager.mjs:1153`, design-language §11 `( — <detail>)?`). **Correction:** add to §10 Binding rules: "Off a TTY, check rows keep the separator ` — ` (U+2014) byte-for-byte in every glyph tier. The ascii copy mapping does not apply to the check-row separator or the verdict words. The grammar is `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$`, followed by whitespace-indented `why:`/`next:` lines." Apply the same regex to Story 90 and to the seam 5 regex test.

**D2 (matters).** *§0 Order of work, step 8 "CI guardrails"; §1 Baselines; §12 CI layout.* As written, the `memory-budget` CI job lands last. That contradicts **Round 2 Q14 condition 1** (the expected-RED list exists so that the job lands first) and **Round 3 Q9 condition 1** (the Bun 1.4.2 Windows reference run is "the draft PR's first CI run", on the loop code merged before the toolchain batch). Without the job in CI at step 1, the Windows reference baseline cannot exist before step 3. **Correction:** in §0, step 1 reads "the memory loop with budgets, the process-count harness, the Windows sampler **and the `memory-budget` CI job on ubuntu and windows with the expected-RED list**". Step 8 becomes "the remaining CI guardrails (snapshot-update refusal, test-wiring guard)". Record this as a second deviation from PROMPT §7 principle 8, justified by Round 2 Q14 condition 1 and Round 3 Q9, next to the existing upgrade-order deviation (RUNLOG + ADR). Note that the proxy typecheck already moved into batch 1 (Round 2 Q15 condition 1).

**D3 (matters).** *§4 "stop-token storage … (allowlisted in `proxyEnv`)", §4 "log dir in the proxy env … allowlisted in `proxyEnv`", seam 8 prior art "allowlist for `ZCODE_KIT_LOG_DIR`, `ZCODE_KIT_STOP_TOKEN`".* This contradicts the per-spawn and never-leaks properties of **Round 3 Q3 condition 1** and the "survives `proxyEnv`, nothing else changes" property of **Round 3 Q4 condition 1**. See Q4: `ZCODE_KIT_*` already passes through, and the respawn hook inherits the proxy environment. **Correction:** replace both "allowlisted" phrases with the Q4 decision: the manager sets both variables at every spawn and overwrites inherited values, the token is fresh per spawn and equal to the `proxy.pid` field, the proxy strips the token from the respawn hook's environment, and the Q4 tests apply. Add the hook to §2's list of environments that exclude the token ("the child environment excludes … `ZCODE_KIT_STOP_TOKEN`" → "the solver process and the respawn hook environments exclude …").

**D4.** *§8 "The manager: … creates every log file with mode `0o600`, and the logs directory with `0o700`."* This narrows **Round 3 Q5 condition 2** ("every creator of a log file"). The proxy's writer also creates `proxy.log` when it reopens after rotation, and the watchdog's by-path append can create it. **Correction:** move the rule to its own §8 bullet that binds every creator: the manager, the proxy writer on open and reopen, the watchdog by-path append, the creation of the early log, and the OMP extension if it creates the logs dir. Apply it to `proxy.log`, `proxy.log.1`, the early log, the autostart token and its result record. Story 78 already states it this way.

**D5.** *§7 truncation shape ("the tool description, the MCP API doc and the release notes carry the sentence"); §16 scope and release notes.* This narrows **Round 3 Q6 condition 4**: those three places "describe the cap, the marker and the idempotency window". **Correction:** in §7, they describe the 4 MiB cap (first 1 MiB + last 3 MiB), the `[… N bytes truncated …]` marker, the `truncated` field and the idempotency sentence. Add `docs/MCP_API.md` to the §16 scope list. Add "MCP task text capped at 4 MiB with a head/tail marker" to the §16 release-notes list.

**D6.** *Solution, first bullet ("Ten parallel harness sessions fit in ≤ 596 MB of summed RSS on Linux"); Story 29.* This contradicts **Round 3 Q2 condition 6 / ADR-0013 condition 9** ("stated, not claimed": the lower footprint on Linux/macOS needs Node ≥ 26.1, the S3 total is not claimed on Node 24, and macOS is unverified). **Correction:** add the qualifier "on Node ≥ 26.1 (launcher handover); not claimed on Node 24; macOS unverified (owner action)" to both places, matching §18.

**D7.** *§2 failure semantics ("and when a bounded solve queue overflows"); §7 bounds table; §18 BOUNDS.* The spec names a bound it never defines. Today the solve queue is unbounded in code (`captcha-solver.ts:136`, `queue.push` at :336). It is bounded only by its single caller (`captcha-pool.ts`, solve concurrency clamped to 1 at :91). The result is a gap against **§9 BOUNDS** and **Round 2 Q2 condition 1**, which presupposes a bound. **Correction:** add a §7 row, "Solver queue: bounded by its callers (one in-flight solve per pool); the ticket states the bound with evidence and pins it with a seam 3 test". The overflow shed applies only if a count bound has to be added because no caller-side bound can be shown. In that case the count goes into §7 and the shed follows ADR-0004.

**D8.** *§8 heading "The early-output file", §16 "log rotation and the early-output file".* This contradicts **GLOSSARY "Early log"** (_Avoid_: early-output file) and the spec's own rule that every module uses the glossary's vocabulary. **Correction:** say "early log (`proxy.early.log`)".

**D9.** *§18 MEMORY, row "S1 proxy main steady state", Source column "memory report §6 as adopted in Round 2 Q1".* **Round 2 Q1** adopted no S1 budget. **Correction:** the source is "memory-report §6 (steady ≤ 160 MB tightens §9's 250 MB with Phase 1 evidence; peak ≤ 250 MB kept), loop". The numbers stay.

**D10.** *Further Notes, first bullet: "The ADR should get an amendment line."* This is stale. **ADR-0001** already carries the Round 2 Q9 condition 3 amendment ("Amended 2026-11-06"). **Correction:** "ADR-0001 records this in its Round 2 amendment."

**D11.** *Testing Decisions, seams 1, 2, 3, 5, 8 (and `seams.md`).* Several decided behaviours have no test home: the execve handover (**Round 3 Q2 condition 6**), the pinned-Node-path preflight check (**Round 1 Q14 condition 2**), the waiter cause lines (**Round 3 Q2 condition 3**), and `proxy logs` across both files (**Round 2 Q4**). The solver reaping claims sit at seam 3, below the process level that **ADR-0002 condition 2 / Round 3 Q10 condition 2** bind them to. **Correction:** apply the Q1 additions 1–5 to both `seams.md` and spec → Testing Decisions.

**Rationale:** "Yes" would mean that no deviation matters. D1 would silently break the grep contract that Round 1 pinned for scripts. D2 would make the Windows budget reference impossible before the toolchain batch. D3 would leave the per-spawn stop token able to propagate through the respawn chain. D4–D11 are narrowings, a dangling bound, an unconditional claim, vocabulary, citation and test-coverage gaps. Each one is cheap to fix now and expensive once copied into tickets. The remaining sections match the decisions, including every REJECTED-part replacement and condition, the tightened budgets (≤ 596 MB, ≤ 74 MB launcher, two-part S3 verdict, the ≥ 30 % rule) and all eight build-time gates.

**Charter:** C2 (the grep grammar and the JSON/exit-code contracts), C6 (the stop token, file modes), C7 (the Windows baseline), C1 / §9 BOUNDS, C8, C9; PROMPT §7 (ordering deviation recorded).

**REVERSIBILITY:** Two-way door (spec text before tickets).

---

## Shared understanding

CONFIRMED. No design branch is open. The Q5 corrections D1–D11 and the conditions of Q1–Q4 are exact text changes to `spec.md` and `seams.md`. Fold them in before /to-tickets; no further round is needed for them. The Round 3 build-time gates stay as listed in spec §18, and they return as questions with numbers only if a gate fails.

## Round 5 (2026-11-06) — /to-tickets quiz

Questions: rounds/round-05.md. Answers below are copied verbatim from rounds/round-05-answers.md.

# Round 5: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–4 decisions in DECISIONS.md bind these answers. Where the draft contradicts one of them, the answer says so and the earlier decision wins.

I checked the draft myself against `spec.md`, `seams.md`, DECISIONS.md Rounds 1–4, ADR-0004 and ADR-0016, PROMPT.md §2/§7/§9, `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `ux/before/INDEX.md`, and the code at ab54631:
- `cli/zcode-kit.mjs`: :105-129 (dispatch, `usage(2)`), :210 (`cmdSetup`), :910 (`cmdUpdate`)
- `zcode-proxy-src/src/runtime/watchdog.ts`: :72-108 (`respawnHookCommand`, `launchRespawnHook` spawns the hook with the env it is given)
- `zcode-proxy-src/src/runtime/health-monitor.ts`: :43-78, :180-248 (MemoryGuard recycles the solver)
- `zcode-proxy-src/src/index.ts`: :24, :256-317 (MemoryGuard, flush, SIGINT/SIGTERM closures)
- `zcode-proxy-src/src/proxy/handler.ts`: :859-860 (32 MB wire limit), :894 (64 MB inflated limit)
- `zcode-proxy-src/src/proxy/captcha-happy.ts:181` (`solveTimes`)
- `zcode-proxy-src/src/tui/app.ts:43-48` (today's non-TTY refusal, exit 1; TERM=dumb renders)

I re-derived the graph from the 57 `Blocked by` lines, checked it for cycles, and spot-checked every story row of the coverage table against the ticket's Delivers/Acceptance text. The coverage claim (144/144) holds by mapping. The gaps are in what the mapped criteria actually test, and they are listed under Q4.

Every change below is an exact edit to `tickets-draft.md` (and, where stated, to `spec.md`). The orchestrator applies all of them before publishing (Q5). Where a change also touches the "Ordered summary" table, the same edit applies to the matching table row.

---

## Q1 — Granularity

**DECISION:** REJECTED. One ticket is too coarse: **28** must be split. Every other ticket is a vertical, independently verifiable slice of acceptable size. I considered and rejected splitting 06, 15, 22 and 40 (see rationale), and merging 32 into 48 or 49 into 48 (32 owns the S6 entry; 48 is already the largest TUI ticket). Changes:

1. **Ticket 28: replace the ticket** with:
   - **Title:** `28. Solver cap enforcement per OS and the cap handshake`
   - **Blocked by:** `27`
   - **Model:** sol · **Risk:** high · **ADR:** 0002 (unchanged)
   - **Delivers:** "Windows: Job Object via `bun:ffi` with `JOB_OBJECT_LIMIT_PROCESS_MEMORY` + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, no new dependency. Linux: user-systemd cgroup v2 scope with `MemoryMax=` and `MemorySwapMax=0`, verified by reading the scope's `memory.max`, else `sampling`. macOS: `sampling` (footprint sampling and kill). Enforcement mode `job-object|cgroup|sampling|none` (`none` = thread transport or caps off), exposed through the dispatcher stats for 39. The child loads neither happy-dom nor solve code until the handshake confirms the cap. Cap 300 MB by default; the `config.yaml` key is validated at config load against a documented minimum (what/why/next). A cap kill is logged as an event line naming the key that raises the cap. An idle exit releases the cap container (Job Object closed, scope ended)."
   - **Acceptance:**
     - [ ] Seam 3: handshake ordering: no heavy module is loaded before the cap acknowledgement (module-load probe in the child); a child whose acknowledgement never arrives is killed and never solves.
     - [ ] Seam 1/3 (adversarial, the cap's purpose): a fixture backend that allocates past the cap is killed by the active mode on each leg (`job-object` on windows-latest; `cgroup` on ubuntu where the memory controller is delegated, otherwise `sampling`), and the kill line names the config key.
     - [ ] Adversarial (never claim a cap that is not there): with the memory controller not delegated (simulated: the scope's `memory.max` missing or not equal to the requested value), the mode is `sampling`, never `cgroup`.
     - [ ] Seam 1: after an idle exit, the scope no longer exists (Linux) or the Job Object handle is closed (Windows), and 0 solver processes remain. Windows leg: Job Object reaping after the proxy is SIGKILLed → 0 solver processes (build-time gate 5).
     - [ ] Config validation: a value below the documented minimum is rejected at load with what/why/next; the default is 300 MB.
     - [ ] A1 (live vendor-SDK solve under 300 MB) recorded as an owner action, marked unverified.
   - **Stories:** `2, 3, 4, 5, 8, 10, 15, 16, 60`
2. **New ticket 58,** inserted in the Step 4 section directly after 28, published as `issues/58-solver-recycle-and-failure-semantics.md`:
   - **Title:** `58. Solver recycle triggers and failure semantics (abnormal-exit budget, fail-fast shed)`
   - **Blocked by:** `19, 25, 28`
   - **Model:** sol · **Risk:** high · **ADR:** 0002, 0004
   - **Delivers:** "Recycle: footprint at 80 % of the configured cap (240 MB at 300), read from the child's own report after each solve; count backstop 100 (was 200); the failure, idle, request and deadline triggers are kept; the in-worker 768 MB heap trigger is removed or re-based below the cap. Failure: a crash, cap kill, fatal error or deadline kill fails only the in-flight solve with `CaptchaSdkError("other", …)`, and the queue is pumped onto the next generation. Only these abnormal exits count toward 5 per 10 min, after which solves fail fast with 503 + `Retry-After` = the time until the window reopens (19's shed helper). Planned recycles (count, footprint, idle, request, shutdown) never count. No solve is resubmitted. The solver queue's caller-side bound (one in-flight solve per pool, the `captcha-pool` clamp) is stated with evidence and pinned; a count bound + ADR-0004 shed is added only if none can be shown. The fail-fast state and its window end are exposed through the dispatcher stats for 39."
   - **Acceptance:**
     - [ ] Seam 3: each recycle trigger fires at its threshold and not below it (footprint 239 vs 241 MB at cap 300; count 99 vs 100); planned recycles never increment the abnormal-exit count; once the 5-per-10-min budget is used up, the next abnormal exit enters fail-fast, and the shed has the endpoint's error shape and `Retry-After` = seconds until the window reopens; after the window a solve succeeds (injected clock).
     - [ ] Seam 3 (adversarial, "fail only the solve in flight"): a crash with one solve in flight and one queued fails only the in-flight solve, with the existing error and category; the queued solve completes on the next generation; the backend's call count shows that no solve was resubmitted.
     - [ ] Seam 3: the queue-bound test.
     - [ ] Loop S2: per-generation cost ≤ 300 MB, retained before recycle ≤ 300 MB, hung-solve reclaim ≤ 64 MB, one generation at a time. **Delete `S2/short` (linux, windows).**
   - **Stories:** `6, 11, 12, 13, 14`
3. **S2/short ownership moves from 28 to 58** in four places: ticket 01 Acceptance item 3 (`S2/short → 28` → `S2/short → 58`); ticket 02 Acceptance item 2 (`S2/short → 28` → `S2/short → 58`); ticket 25 Acceptance item 3 (`The S2/short entry stays until 28` → `The S2/short entry stays until 58`); the `expected-red.json` ownership line under the summary table (`S2/short → 28` → `S2/short → 58`).
4. **"How to read this draft", first bullet:** append the sentence "Ticket 58 was split out of 28 in Round 5; its number breaks the numeric order, and the `Blocked by` edges are authoritative."
5. **Coverage table:** rows 6, 11, 12, 13 and 14 change from `28` to `58`. Rows 2, 3, 4, 5, 8, 10, 15, 16 and 60 keep 28.
6. **Ordered summary table:** row 28 becomes `| 28 | Solver cap per OS + handshake | sol | high | 27 |`, and a row `| 58 | Solver recycle + failure semantics | sol | high | 19, 25, 28 |` is added after row 28.

The edges that pointed at the old 28 (39, 52, 53, 55) are changed under Q2.

**Rationale:** As drafted, 28 combines three separately verifiable mechanisms: per-OS kernel enforcement (a `bun:ffi` Job Object with its struct layout, a verified systemd scope, macOS sampling), the cap handshake, and the whole recycle and failure policy (triggers, abnormal-exit budget, fail-fast shed, queue bound). It maps to 14 stories and needs proofs on both OS legs. That does not fit one fresh context window. It also mixes a security-relevant OS boundary with policy logic, so a reviewer cannot judge either part on its own. The split follows the natural seam. 28 can be verified alone with an over-allocating fixture. 58 can be verified alone at seam 3 with an injected clock, and it owns the S2 entry, because S2 needs both the cap and the 80 % recycle to turn GREEN. Keeping the number 58 leaves every existing reference (`expected-red.json`, ADR links, the S2 owner) stable. That is simpler and less error-prone than renumbering 57 files (C9). The other large tickets stay whole. 06 is mechanical glm work over an existing capture set. 15 is one deep module with a frozen external contract. 22's proxy route and manager path share one deadline module and one Windows proof. 40 is a well-scoped migration batch.

**Charter:** C1 (the cap and its recycle policy each proven), C7 (Windows Job Object proof isolated), C9 (smaller blast radius, stable numbering), PROMPT §7 Phase 3 (one fresh context per ticket).

**REVERSIBILITY:** Two-way door (tickets unpublished).

---

## Q2 — Blocking edges

**DECISION:** REJECTED. The draft graph has no cycle, but it is missing ten edges where two tickets touch the same module or a ticket's criterion needs another's output. It also has one edge that is not a gate, and four edges that change because of the Q1 split. With the changes below the graph stays acyclic (I re-checked it). The immediate frontier is 01, 04, 14, 50 and 57.

1. **03:** `Blocked by: 01` → `Blocked by: 01, 02`. The S3 OMP leg must also run on the windows leg (Q4 change 1), and that leg exists only after 02. Windows is the primary platform, and Round 1 Q7 puts S3 on windows. The in-host O_EXCL token and its proven-stale rule (pid liveness) behave differently on Windows.
2. **09:** `Blocked by: 02, 04` → `Blocked by: 02, 03, 04`. ADR-0016 condition 1 says that "step 1 is the whole guardrail", and the draft itself says 01–03 "are all blockers of every upgrade and fix ticket". 09 omitted 03, so the S3/omp variant would have no Bun 1.4.2 reference run (Round 3 Q9).
3. **08:** `Blocked by: 07` → `Blocked by: 07, 10`. 10 adds the Node < 24 refusal to `setup`/`update`, which today live in `cli/zcode-kit.mjs` (`cmdSetup` :210, `cmdUpdate` :910). 08 moves exactly those bodies into command modules. Without an order the two tickets edit the same functions in parallel. Placing 08 after 10 costs nothing on the path to 15, because 13 (which 15 needs) comes three tickets after 10 anyway.
4. **14:** `Blocked by: 01` → `Blocked by: None (can start immediately).` The event-line logger neither uses nor is measured by the memory loop, so this edge is not a gate.
5. **18:** `Blocked by: 15` → `Blocked by: 15, 21`. 18 strips the stop token from the environment that `launchRespawnHook` passes to the hook (`watchdog.ts:94-108`). 21 restructures that code into the supervisor module and moves the lifecycle closures out of `index.ts` (:256-317). The restructure comes first, then the small change.
6. **22:** `Blocked by: 18, 21` → `Blocked by: 18, 21, 40`. Both 22 (progress during the grace period, plus snapshots) and 40 (migration to `Out`, plus snapshots) change the rendering of `proxy stop`/`restart`, and the draft gives them no order. 22 is not on any critical path, so it goes after 40.
7. **32:** `Blocked by: 05` → `Blocked by: 05, 11`. 32 is a memory fix (it deletes `S6/short`). ADR-0016 condition 3 and Round 3 Q9 require every memory fix to start RED on the upgraded runtime, after the 1.4.4 attribution runs, which 11 records. As drafted, 32 could merge on Bun 1.4.2 right after 05.
8. **33:** `Blocked by: 16, 18, 14` → `Blocked by: 14, 16, 18, 21`. 33 routes the proxy's console, stdout and stderr through the writer, in the same `index.ts` region that 21 restructures. 21 completes before 16 on the existing paths, so this costs nothing.
9. **28:** `Blocked by: 27, 19, 25` → `Blocked by: 27` (Q1 split: 19's shed helper and 25's per-generation CDN reset are needed only by 58).
10. **58 (new):** `Blocked by: 19, 25, 28` (Q1).
11. **39:** `Blocked by: 19, 21, 23, 28` → `Blocked by: 19, 21, 23, 40, 58`. 58 supplies the solver's fail-fast state and window end that the `memory[]` solver entry carries, and 58 depends on 28. 39's seam 5 criterion renders `proxy status` text rows per design-language §7, which is 40's migration. That also matches spec §0, where observability (6) comes after the UX batches (5).
12. **45:** `Blocked by: 40` → `Blocked by: 37, 40, 42`. Help must document `ZCODE_KIT_RESIDENT_LAUNCHER` (37) and the rotator meaning of `--reask` (42). The draft's "if 37 has merged; otherwise …" is a conditional criterion that cannot be measured. Nothing depends on 45 except 54, so the added edges cost nothing.
13. **52:** `Blocked by: 10, 19, 21, 28, 30, 31, 33, 34, 37, 42, 43` → `Blocked by: 10, 19, 21, 30, 31, 33, 34, 37, 41, 42, 43, 47, 58`. 52's acceptance tests the README anchor that 41's doctor WARN links to, so 41 is required. README documents the stderr routing, whose last part is `run` (47). The 28 → 58 change is the Q1 split (58 implies 28).
14. **53:** `Blocked by: 11, 13, 16, 22, 28, 31, 51` → `Blocked by: 11, 13, 16, 22, 31, 51, 58`.
15. **54:** `Blocked by: 52, 53` → `Blocked by: 29, 44, 45, 46, 48, 52, 53`. 54's own acceptance checks the unverified criteria of 17, 28, 37 and 44, and 44 was not reachable. The release notes list items from 29 (CDN disk pruning), 46 (`auth status` on a TTY) and 45/48 (Q4 change 27), none of which were reachable from 52/53. 17 is now reachable through 52 → 41 → 39 → 23.
16. **55:** `Blocked by: 06, 16, 17, 19, 28, 30, 32, 34, 35, 37` → `Blocked by: 06, 16, 17, 19, 30, 32, 34, 35, 37, 58, and every typecheck-baseline ticket filed by 11` (58 now owns S2/short; Q4 change 6 adds the typecheck list).

I kept 15 ← 13. The lifecycle module does not use the MCP dependencies, but ADR-0016 puts step 4 after all three batches, and 15's S3 starter-preflight measurement then runs on the target toolchain. Wall-clock time does not matter (PROMPT §0).

**Rationale:** The question defines a missing edge as "a ticket touching a module another ticket restructures". The code shows four such pairs that the draft runs in parallel: 08/10 (`cmdSetup`/`cmdUpdate`), 18/21 (`launchRespawnHook`), 33/21 (`index.ts` lifecycle and stdio), and 22/40 (`proxy stop`/`restart` rendering). Three edges are required by binding decisions that the draft states but does not encode: the whole step-1 guardrail before the upgrades (ADR-0016 condition 1; 09 ← 03), every fix after the attribution runs (Round 3 Q9; 32 ← 11), and S3 on the primary platform (Round 1 Q7, C7; 03 ← 02). The remaining additions (39, 45, 52, 54) are cases where a ticket's own acceptance criterion reads another ticket's output that the graph did not guarantee would exist. One edge (14 ← 01) gates nothing. PROMPT §0 says wall-clock time does not matter, so serialising overlapping tickets is the cheaper risk (C9: smaller blast radius).

**Charter:** C1 and C7 (guardrail and Windows evidence before fixes), C9 (smaller blast radius over parallelism), ADR-0016, Round 3 Q9, Round 1 Q7.

**REVERSIBILITY:** Two-way door.

---

## Q3 — Model and risk labels

**DECISION:** REJECTED. Five `Model:` labels conflict with the PROMPT §2 routing, and two `Risk:` labels understate the risk. Changes (apply both to the ticket line and to its summary-table row):

1. **05:** `Model: glm` → `Model: sol`. The width core is what `frame.ts` (the TUI renderer) measures with. The ticket must keep TUI frames correct and frame time within budget under Node and Bun. §2 routes "TUI renderer" to sol.
2. **20:** `Model: glm` → `Model: sol`. Removing request-body copies changes the request streaming path to upstream under a byte-identical constraint. §2 routes "streaming" to sol.
3. **29:** `Model: glm` → `Model: sol`. Concurrent pruners from several installations share one directory, with vanishing files and files mid-write. The ticket also carries a retention-pruning migration. §2 routes "concurrency" and "migrations" to sol.
4. **30:** `Model: glm` → `Model: sol`, and `Risk: medium` → `Risk: high`. It is a stored-state migration that deletes task history irreversibly. Round 2 Q3 marked the retention policy "ADR: yes" because deleted data cannot be restored.
5. **31:** `Model: glm` → `Model: sol`. The 4 MiB bound is applied during streaming ingestion of deltas (`ingress.ts`: frozen head, rolling tail window, code-point-safe cuts), which is "streaming".
6. **26:** `Risk: low` → `Risk: medium`. It changes where solver traffic egresses (C6). A mistake either opens an undeclared ambient proxy route or breaks solves.
7. **58 (new):** `Model: sol`, `Risk: high` (set in Q1). **28** stays sol/high.

All other labels match §2. 42 (rotator migration) is already sol. 36, 50 and 51 refresh generated harness configs through the existing transaction, which is mechanical, so glm is right for them.

**Rationale:** PROMPT §2 routes process lifecycle, concurrency, workers/solver isolation, streaming, the TUI renderer and migrations to sol. The draft's own "Model rule" restates this, but it labels five tickets glm that fall squarely into those categories. The routing exists because the escalation ladder (glm fails twice, then sol) costs review loops, and these are the tickets where a plausible but wrong implementation passes casual review: race-prone pruning, irreversible deletion, streaming boundaries, renderer timing. The two risk corrections follow from Round 2's own one-way-door marking (30) and C6 (26).

**Charter:** PROMPT §2 routing, C1, C6, C9.

**REVERSIBILITY:** Two-way door.

---

## Q4 — Acceptance criteria

**DECISION:** REJECTED. The coverage table holds (144/144). But 28 criteria are missing, conditional or unmeasurable, or a guard or bound ships without an adversarial check derived from its purpose. The 28/58 criteria are given in full under Q1. Changes:

1. **03:** in Delivers, after "runs the generated OMP extension in a stub Bun host", insert "on both OS legs". Replace Acceptance item 2 with: "On today's code the variant is RED (5 preflights) on both legs, and `expected-red.json` gains `S3/omp → 35` under `linux` and `windows`."
2. **05:** replace Acceptance item 2 with: "Existing `width`/`frame` tests pass unchanged; S6 heap within budget; a frame-time benchmark (a full 2,000-line pane rendered at 80 and 120 columns, with an ASCII fixture and a mixed CJK/emoji fixture) is recorded on the ticket's base commit and after the change, and the after p95 for the ASCII fixture is ≤ 1.10 × the base p95."
3. **05:** replace Acceptance item 4 ("No visible output change (TUI frames byte-identical).") with: "TUI frames and the `ux/before/tui` captures are byte-identical for every fixture whose graphemes keep their width; a vector test lists each grapheme class whose width changes (VS16, RI pairs, new UCD 17 W/F ranges) and the frames that change because of it." (The width fix exists to change those widths, so "byte-identical" without this qualifier cannot pass.)
4. **06:** replace Acceptance item 3 with: "The Phase 1C BEFORE set and its tooling (`.scratch/kit-overhaul/ux/capture/` and `ux/before/`, 640 captures at 0960696) are committed under `tests/` as the step 1–2 baseline. A before-equivalence test re-runs the capture and compares byte for byte: all seven variants on ubuntu (pty via `script`); on windows-latest the pipe and ci variants, whose Windows baseline is captured from this ticket's base commit before the change and committed. This test is the proof of 'no visible change' for 06–08." (Reason: before 07/08 no command returns records, the BEFORE set was captured through a Linux pty, and Windows output legitimately differs, A-07. As drafted, the criterion cannot be run.)
5. **06:** add Acceptance item: "A scan asserts that no ESC byte appears in any NO_COLOR, pipe, TERM=dumb or CI render of the primitives' fixtures (Story 107)."
6. **11:** replace Acceptance item 2 with: "`test-kit` legs include the proxy typecheck through the pinned devDependency, never an unpinned `bun x`. Its baseline error list is recorded before any fix. If the list is non-empty, the step compares against a committed expected-error list with the same ratchet as `expected-red.json` (a new error fails; a listed error that disappears fails until it is removed), and each listed error names a filed ticket." (Round 1 Q15 makes baseline failures tickets. Without a ratchet, a failing baseline would make every later CI run red.)
7. **12:** add Acceptance item: "A test asserts that the happy-dom Window is constructed with `enableCSSFileLoading: true` and `enableIframePageLoading: true`, and fails if either flag is removed (ADR-0007, B1)."
8. **16:** add Acceptance item: "A kill injected during the lock write leaves either no lock file or a complete, parsable record, never a partial one, on both legs (Story 48)."
9. **17:** add Acceptance item: "Adversarial: a holder whose lock was taken over (the on-disk record is no longer its own) leaves the new holder's lock untouched on SIGINT and SIGTERM."
10. **19:** add Acceptance item: "Adversarial (C2): with nothing else in flight, a single request at today's maximum body size (32 MB wire, `handler.ts:859`; 64 MB inflated, `handler.ts:894`) is admitted and served, never shed. The cap rule is 'admit when in-flight bytes + this request ≤ cap, or when in-flight bytes are 0'. The ticket states how a body without `Content-Length` is accounted, and tests that the cap holds for concurrent chunked bodies." **ADR-0004 gets an amendment line** recording the in-flight-0 rule. (Without it, a request accepted today on an idle proxy could be shed forever, which is a functional regression the byte cap was never meant to cause.)
11. **21:** add Acceptance item: "Adversarial: two consecutive samples above hard followed by one below → no respawn request; samples are 15 s apart (injected clock); a soft breach never recycles the solver."
12. **23:** add Acceptance item: "With the hard condition persisting over two budget windows and every respawn refused, exactly one hook is spawned per window (injected clock, spawn counter) (Story 50)."
13. **24:** replace "S2 numbers unchanged within noise (loop)." with "S2 per-generation HWM and retained MB within ±10 % of the preceding run on the same leg (loop)."
14. **25:** add Acceptance item: "Seam 3 (B1): for a recorded sequence of stalls and solves below 1,024 URLs, the CDN invalidation decisions (which pe URLs are evicted, and when) are identical to the pre-change code."
15. **27:** in Delivers, replace "Child stdout/stderr go through the parent's log writer, lines unchanged." with "Child stdout/stderr are piped to the parent and re-emitted line by line on the parent's stdout/stderr, content unchanged (33 routes those streams through the size-capped writer)." (27 is not blocked by 33, so the writer may not exist yet.)
16. **27:** add Acceptance item: "Seam 3: a child line (for example `[pe-cache-evict] …`) appears byte-identical on the parent's stderr; a solve dispatched during the child's cold start fails at 90 s from dispatch, not from child readiness (injected clock); the compiled-binary self-exec spawn test also runs on windows-latest (C7)."
17. **29:** add Acceptance item: "An entry 15 days old under a configured TTL of 20 days is kept; an entry 21 days old is pruned (Round 2 Q3 condition 2)."
18. **32:** add Acceptance item: "A single line larger than 8 MB never makes the pane exceed 8 MB (the line is truncated or dropped; the ticket states which)."
19. **33:** in Delivers, replace "(manager, proxy writer on open/reopen, watchdog by-path append)" with "(manager, proxy writer on open/reopen; the watchdog's by-path append is added by 34)". (No watchdog by-path append exists today, so 33 cannot test its mode.)
20. **33:** add Acceptance item: "Seam 4: after the writer opens, a line written to `process.stdout` and one written to `process.stderr` appear unchanged in `proxy.log`."
21. **34:** add Acceptance item: "Seam 2/4 (POSIX): a watchdog by-path append that creates `proxy.log` creates it with mode `0o600`."
22. **35:** add Acceptance item: "Seam 8 (adversarial): a live starter's token is never taken over; a token whose holder is dead, or that is older than `START_TIMEOUT_MS`, is taken over by proof; a waiter never waits longer than `START_TIMEOUT_MS` (injected clock); the token and the record are created with mode `0o600` (Story 33)."
23. **35:** in Acceptance item 2, replace "**Delete `S3/omp` (all legs).**" with "The S3 omp leg runs on both legs. **Delete `S3/omp` (linux, windows).**"
24. **39:** in Acceptance item 1, replace "sync/O(1) (no await on sampling in the handler)" with "adversarial: with the sampler stubbed to never complete, `/health` details still answer from the last cached sample (no await on sampling in the handler)".
25. **45:** in Delivers, replace "`ZCODE_KIT_RESIDENT_LAUNCHER` (if 37 has merged; otherwise 37 adds its line to this structure)" with "`ZCODE_KIT_RESIDENT_LAUNCHER`".
26. **45:** add Acceptance item: "A test asserts that the global help names `WARN`, `--reask`, `--account-rotator`, `ZCODE_KIT_ACCOUNT_ROTATOR`, `ZCODE_KIT_RESIDENT_LAUNCHER`, `--color`, `--no-color`, `ZCODE_KIT_UNICODE`, `ZCODE_KIT_PROGRESS` and `ZCODE_KIT_HYPERLINKS`."
27. **48:** add Acceptance item: "The TERM=dumb refusal exits 1, the same code as today's non-TTY refusal (`tui/app.ts:43-48`), and prints `zcode-kit proxy status` and `zcode-kit proxy logs 50`; the non-TTY refusal keeps exit 1." (Today TERM=dumb renders the TUI, so the refusal is a behaviour change that needs a stable exit code under C2.)
28. **52:** replace Acceptance item 1 with: "A parity check passes: all five files have the same heading count per level, the same explicit anchor ids, and the same set of env-var names, config keys and `zcode-kit` commands (extracted by regex)." (Translated headings can never be "the same", so the drafted check cannot pass.) Replace Acceptance item 2 with: "The README section that 41's enforcement WARN links to carries an explicit HTML anchor id (`<a id=\"…\"></a>`) that is identical in all five files, and a test asserts that the id 41 prints exists in each file."
29. **53:** replace Acceptance item 2 with: "A grep test fails if any sentence that states the worker-thread solver or 'never taken over' is still present. The sentences are captured from the base commit into the test, from SECURITY.md, SECURITY.de.md, README × 5 and the MCP bridge READMEs." (An English-only grep cannot see the translations.)
30. **54:** in Delivers, append to the release-notes list: "the proxy TUI refuses under TERM=dumb (exit 1) and prints the line-mode commands; the four new `doctor` checks; the additive `proxy logs --level/--grep` filters; harness configs refreshed on the next `setup`/`integrate` (Continue `capabilities`, Kilo Code `/v1`, the confirmed MEDIUM items, the bridge's `--max-semi-space-size=1`)". Add the same four items to the release-notes list in **spec.md §16**. Story 138 and C2 require every user-visible change to be announced, and the TUI's TERM=dumb behaviour is removed.
31. **54:** replace Acceptance item 1 with: "A checklist test/grep confirms that every item of spec §16's release-notes list (including the four Round 5 additions) appears."
32. **55:** delete Acceptance item 3 ("The Phase 6 gate commands (spec §18) all run green in one CI run; METRICS 'Current' filled from the long-profile loop."). Replace it with: "`npm run test:all` and both `memory-budget` legs are green in the CI run in which the list becomes empty; the proxy typecheck expected-error list from 11 (if any) is empty too." 55 is not blocked by the UX and docs tickets, so it cannot hold the Phase 6 gate. The gate and the long-profile METRICS 'Current' column stay with the orchestrator's Phase 6 (PROMPT §7).

**Rationale:** "Yes" would mean that every criterion can be run and that every guard has a test aimed at its purpose. The evidence shows otherwise:
- Some criteria cannot be run as written: 05's byte-identical frames contradict its own width fix; 06's both-legs snapshots presuppose records that do not exist before 07/08 and a Linux pty that Windows lacks; 33 tests a watchdog append that only 34 creates; 52's identical headings across languages; 55 holds the Phase 6 gate while 20 tickets may still follow it.
- Some criteria are conditional or vague: 45 ("if 37 has merged"), 24 ("within noise").
- Several guards and bounds ship without a test of the failure they exist to prevent. The solver cap was never shown to kill an over-allocating child, nor was cgroup verification shown to refuse an unverified scope (Q1). The byte cap could shed an idle proxy's largest legal request forever. Other gaps are the stall-counter B1 equivalence, a fresh-under-long-TTL disk entry, a single oversized TUI line, token takeover against a live starter, the lock-release adversary, the hard-limit negative case, the retry-rate bound, the happy-dom flags (B1) and the stalled sampler behind `/health`.
- One user-visible removal, TERM=dumb in the TUI, is missing from the release notes and has no pinned exit code (C2).

The typecheck ratchet applies the Round 2 Q14 expected-RED pattern to Round 1 Q15's "failures become tickets", so CI can stay green without hiding them. The ADR-0004 amendment is a clarification that keeps today's accepted requests accepted. It neither loosens the cap's purpose nor any budget (S1 burst is measured with 10.8 MB bodies).

**Charter:** C1 (each bound tested against its purpose), C2 (exit codes, announced removals, idle requests never newly refused), C6 (egress flags, file modes), C7 (Windows legs for S3 omp and compiled spawn), C8 (docs parity measurable), C9; B1; Round 1 Q15, Round 2 Q3/Q14, ADR-0004, ADR-0007.

**REVERSIBILITY:** Two-way door (criteria). The ADR-0004 in-flight-0 rule is a two-way default and is recorded as an amendment line, not a new ADR.

---

## Q5 — Approve the breakdown for publishing

**DECISION:** ACCEPTED with conditions. Publish after applying every Q1–Q4 change, as one file per ticket under `.scratch/kit-overhaul/issues/NN-<slug>.md` per `docs/agents/issue-tracker.md`. That makes 58 files (01–58). `Status: ready-for-agent` for all except 56 and 57 (`Status: needs-triage`). The label strings match `docs/agents/triage-labels.md`. Conditions:
1. Each file carries, near the top, the lines `Blocked by:`, `Status:`, `Model:`, `Risk:` and `ADR:` with the post-Round-5 values, then Delivers, Acceptance and Stories.
2. The draft's "Common acceptance for every ticket" block is copied verbatim into every published file. Implementers start in a fresh context with only the ticket and pointers (PROMPT §2), so a block that is "not repeated below" would be lost.
3. All files, including 16, 17, 19, 30, 32, 34, 35, 37 and 58, exist before 01's ratchet tests run, because the expected-RED schema fails on a ticket id with no issue file (Round 3 Q8 condition 2).
4. ADR-0004 receives the amendment line from Q4 change 10. spec.md §16 receives the four release-notes additions from Q4 change 30.
5. `tickets-draft.md` gets a first line "Superseded by `issues/` (Round 5); not the tracker." It is kept as a record, not as a combined tickets file.

**Rationale:** With the Q1–Q4 changes applied, the breakdown follows ADR-0016's order, encodes every Round 1–4 binding condition that the tickets rely on, and every ticket has runnable criteria. The conditions keep the published files self-sufficient for fresh-context implementers and keep the expected-RED schema valid from the first guardrail merge.

**Charter:** C9, PROMPT §2/§7 Phase 3, docs/agents conventions, Round 3 Q8.

**REVERSIBILITY:** Two-way door.

---

## Shared understanding

CONFIRMED. No design branch is open. The Q1–Q4 changes are exact text and edge edits to `tickets-draft.md`, plus one amendment line in ADR-0004 and four release-notes items in spec.md §16. Apply them and publish; no further round is needed for them. The design detail of how bodies without `Content-Length` are accounted is delegated to ticket 19, bounded by its acceptance tests (Q4 change 10). The Round 3 build-time gates stay as listed in spec §18, and they return as questions with numbers only if a gate fails.

## Round 6 (2026-11-06) — S1/burst1 flake and the first Windows run

Questions: rounds/round-06.md. Answers below are copied verbatim from rounds/round-06-answers.md.

# Round 6: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–5 decisions in DECISIONS.md bind these answers. Where a recommendation contradicts one of them, the answer says so and the earlier decision wins.

I checked the evidence myself:
- ticket 01 (`issues/01-*.md`, Comments and merge note) and ticket 20;
- ticket 02 on `ticket/02-windows-sampler` (worktree `/home/AgentKit/wt/t02`, head ba7a8cc, read-only);
- `reports/t02-linux-job.log`, `reports/t01-final-job.log`, `reports/t01-baseline-job.log`, `reports/memloop-S1-burst1.log` (1B), `reports/t02-burst1-t02-{1,2,3}.log` and `reports/t02-burst1-t02-tip-{1,2,3}.log`;
- CI run 42203592466 (`gh run view`): `memory-budget` (ubuntu) and all four `test-kit` legs green. The windows memory leg did not exist yet;
- `tests/memory/expected-red.json`, `tests/memory/lib/budgets.mjs`, `tests/memory/scenarios/s1-proxy-steady.mjs:51-59,159` on the t02 branch;
- spec §18, PROMPT §7 Phase 4 and §9.

Where the evidence differs from the round's wording, the answer says so. Where an answer is ACCEPTED with conditions, the conditions bind the tickets and the loop.

---

## Q1 — S1/burst1 flakes around its 250 MB peak budget

**DECISION:** REJECTED in part. Accepted: the 250 MB budget stays. The fix changes the measurement only. S1/burst1 runs as several independent repetitions in the job and is judged on the MEDIAN peak. Ticket 20 owns the variant. No expected-RED entry is added. Rejected: the claim that three repetitions fix the flake, and the deferral of the outlier bound to ticket 20. Binding corrections:
1. **Factual corrections.** S1/burst1 is not "one 10.8 MB request". It is 3 requests of ~10.8 MB at concurrency 1 (`s1-proxy-steady.mjs:58-59`; every log says "3 requests in 1 s"). The 250 MB number is the §18 "S1 proxy main ≤ 250 MB peak" budget, which ticket 01 decision 3 applies to the burst variants other than 16/32. It is not a §18 burst-row budget. Neither point changes the decision.
2. **The repetition count comes from the measured distribution.** The known samples on unchanged code are 219.1, 231.8, 234, 236.6, 236.7, 237.5, 237.7, 256.7, 264.6 and 299.2 MB, plus one CI GREEN. Three runs out of about 11 exceed 250 (p ≈ 0.27). A median of 3 fails whenever 2 of 3 runs land in the tail: 3p² − 2p³ ≈ 18 %. So roughly one job run in six would still go RED per leg, and under the Phase 4 revert rule a good merge could be reverted. Rule: before the median rule lands, run S1/burst1 at least 20 times, sequentially, on the integration tip (Linux), and record the distribution in METRICS.md. Then n is the smallest odd number in {3, 5, 7, 9} whose predicted false-RED rate (binomial, p = the measured exceedance fraction) is ≤ 5 % per leg run. At p ≈ 0.25 that is n = 9 (≈ 4.9 %), which costs about 3 minutes per leg. If no n ≤ 9 reaches 5 %, the rule is not adopted, and the question comes back with the distribution.
3. **The outlier ceiling applies now, not only after ticket 20.** Every repetition must be ≤ 400 MB, which is §18's budget for 16 concurrent bodies. A run with ≤ 1 body in flight that exceeds the 16-body budget is a regression by definition. The ceiling sits ~100 MB above the highest measured value (299.2), so it does not cause flakes of its own. Without it, a median rule would let one repetition spike to any size unnoticed until ticket 20 lands.
4. **Ticket 20's criterion is stricter than proposed.** Replace "S1/burst1 median peak ≤ 250 MB with every repetition ≤ 300 MB" with: "In a ≥ 20-repetition measurement of S1/burst1 on each leg (RSS on Linux, commit on Windows), every repetition is ≤ 250 MB. The tail is gone, so the peak budget holds as a peak. The job keeps the median rule." A 300 MB bound would sit 0.8 MB above an observed value on unchanged code, so it is neither a goal nor a stable gate. If ticket 20 cannot reach every repetition ≤ 250, it comes back with numbers. The budget is never loosened.
5. **Mechanics.**
   - Each repetition is a fresh, isolated proxy run. Repetitions run one after another, never concurrently (§6 resource safety).
   - `summary.json` and the job summary record every repetition's value, the median and the ceiling check.
   - The rule applies identically on the windows leg, using commit. If burst1 is RED there only on commit, Q2 condition 1 applies.
   - `verdict.test.mjs` pins the rule RED → GREEN with at least these cases: one high run passes; a high majority fails; one repetition above 400 MB fails even when the median is GREEN.
6. **Scope and order.**
   - The rule covers S1/burst1 only. Any other scenario needs its own decision with its own distribution. In particular, S1/burst4 and S1/bigbody may hover near 250 MB once ticket 19 lands, and that comes back with numbers.
   - The change lands on the integration branch with its tests, through the normal ticket/merge path, **before** ticket 02 merges. That way a pre-existing flake cannot trigger a revert of 02.
   - It is recorded as a measurement-rule amendment in spec §18 (S1 row) and in ticket 01's Comments, and the deviation goes in RUNLOG.

**Rationale:** The variance is real kernel VmHWM. The sampled proxy peaks are ~100–104 MB, and the high values come from transient overlap of body copies. It is not sampler noise. That makes it a property of today's code, and ticket 20 (body copies) is the right owner. Judging a peak on the median of several fresh runs does not loosen the 250 MB number. That number already tightens §9, whose literal ceiling is steady-state RSS ≤ 250 MB, and the 1B baseline (219 MB) stays below it. A single-sample verdict on a distribution whose typical value sits ~13 MB under the budget is a coin flip, not evidence (C9). The recommendation's own premise is not backed, though: at the measured tail rate, a median of 3 stays flaky about one run in six. It also leaves the variant without any outlier guard until ticket 20 lands. The conditions take n from the data, keep a hard ceiling now, and give ticket 20 a target that restores the budget's meaning as a peak.

**Charter:** C1 (bounded memory proven, not sampled by luck), C9 (stronger measured evidence; simpler than a flaky-entry mechanism), §9 (budget not loosened; tightened at ticket 20), C7 (same rule on the windows leg), PROMPT §7 Phase 4 (no spurious reverts).

**REVERSIBILITY:** Two-way door (a measurement rule in test code and spec text). No ADR.

---

## Q2 — First windows-latest memory run

**DECISION:** ACCEPTED with conditions. The first windows-latest `memory-budget` run calibrates the guessed `windows` list. It is not a regression of an existing leg. If it differs from the guess only in which scenarios are RED, the orchestrator does not revert ticket 02. Instead it updates the `windows` key in `expected-red.json` from the measured run in one follow-up commit, and records that run in METRICS.md as the Windows Bun 1.4.2 reference (Round 3 Q9 condition 1). Every harness, cap or Job Object failure is a real RED: the merge is reverted per Phase 4 and ticket 02 reopens with the failure attached. Binding conditions:
1. **A run RED only on commit is never listed silently.** This follows Round 2 Q13 condition 3, Round 3 Q9, build-time gate 3 and ticket 02 acceptance item 2. A run RED on commit but GREEN on working set, or RED on Windows but GREEN on Linux because of the metric, goes to the owner as a question in the next round, with the commit value, the working-set value and the Linux value. To keep CI usable until that answer, it may be listed under a newly filed `needs-triage` ticket that states the question. It is never listed under a fix ticket that does not own it, and no budget changes.
2. **A guessed entry is removed only with numbers.** If a scenario the ticket expected RED is GREEN on Windows, the removal commit cites the run's check values. Those values must show that the check observed real processes: role present, process count ≥ 1, units self-test passed. This matters most where the Linux defect does not depend on the platform (S2 retained memory, S5 growth). A GREEN that comes from a missing observation is a harness failure, not a calibration.
3. **One calibration only.** The follow-up commit's CI run must hold the ratchet on both legs. If a later windows run disagrees with the calibrated list, nobody edits the list a second time. The scenario is flaky on Windows and comes back as a question with its numbers. The Q1 median rule is not extended to it automatically.
4. **What counts as a real RED (revert):**
   - a harness failure (exit 2);
   - a failed units self-test;
   - a Job Object not applied (`applied=0` or no `@@JOB` report);
   - a cap kill or a timeout (exit 124);
   - a poller left alive after the loop;
   - any failing live Windows self-test on the `test-kit` legs (units, orphan, self-exclusion, Job Object applied and killing the tree);
   - any RED on the ubuntu `memory-budget` leg or any `test-kit` leg, under the normal Phase 4 rule.
5. **The reference record is complete.** METRICS.md records:
   - the run URL, runner image, Bun version (it must be 1.4.2; otherwise Round 3 Q9's fallback note goes in RUNLOG) and Node version;
   - per run: commit, working set, `redOnlyOnCommit` and poller overhead.
   Where a Windows baseline peak exceeds its budget, the ≥ 30 % rule applies to that leg (Round 3 Q1 condition 3). In particular, if Windows S3 commit exceeds 600 MB, the windows S3 total in `budgets.mjs` becomes 0.7 × that baseline in the same follow-up commit. That is a tightening, and `verdict.test.mjs` pins it. Nothing else in `budgets.mjs` and nothing under the `linux` key changes in that commit.
6. **Ticket 02 stays open** until the calibrated run is green on both legs and its evidence (run URL, final `windows` list, METRICS reference table, live self-test results) is in the ticket file. The exception to "a merge that turns anything red is reverted" is limited to this first run of the new leg, and it is recorded in RUNLOG. The 1.4.4 attribution run remains ticket 11's (Round 3 Q9 condition 2).

**Rationale:** The windows leg is new, and the ticket can only guess its list, because this host has no Windows (ticket 02 Comments). Under the ratchet, a first run that disagrees with a guess is expected by design. Reverting the sampler for it would make the Windows reference baseline impossible, and with it build-time gate 3 and C7's primary-platform evidence. The recommendation correctly keeps harness, cap and Job Object failures as real REDs. It does not cover three cases that earlier rounds bound: a RED only on commit, which must go to the owner and never be absorbed silently; a GREEN that is really a measurement gap; and repeated list edits that would turn the ratchet into a rubber stamp. It also omits the ≥ 30 % rule for a Windows baseline above its budget. The conditions close those gaps.

**Charter:** C7 (Windows primary; reference baseline must exist), C1 (caps and reaping proven on Windows), C9 (measured evidence decides the list), §9 (no loosening; ≥ 30 % rule), Round 2 Q13, Round 3 Q1/Q8/Q9, PROMPT §7 Phase 4 (revert rule; exception recorded).

**REVERSIBILITY:** Two-way door (list entries and METRICS text). No ADR.

---

## Shared understanding

CONFIRMED. No design branch is open. Q1 and Q2 are measurement and calibration rules with exact conditions. These come back as questions with numbers only if their gates fail:
- no n ≤ 9 reaches ≤ 5 % false-RED for S1/burst1;
- ticket 20 cannot get every repetition ≤ 250 MB;
- a Windows run is RED only on commit;
- the calibrated Windows list does not hold on the next run.

## Round 7 (2026-11-06) — calibrating the Windows memory leg

Questions: rounds/round-07.md. Answers below are copied verbatim from rounds/round-07-answers.md.

# Round 7: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–6 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself:
- `/home/AgentKit/overhaul-tools/t02-winmem-4.log`: run 42265988296 on the `pull/14` merge of 82de0da, windows-2025 image, Bun 1.4.2, Node 26.13.0, `@@JOB applied=1` on all 13 runs, no harness failure.
- `t02-winmem-3.log` and its artefact `t02-ci-artifact-42252896054/` (every `summary.json` and `samples.csv`). I recomputed per-process working set against commit from the CSVs, because **the run-4 log does not carry working-set values**. Its check lines print commit only. Working set shows up only as a verdict ("S1/short … working set: green"), and the run-4 artefact is not on this host. The working-set numbers below are therefore *sampled* WS from run 3. The WS verdict itself uses `PeakWorkingSetSize`, which `samples.csv` does not store (`win-sampler.mjs:11`, `verdict.mjs:215-217`).
- Ticket 02 on `ticket/02-windows-sampler` (worktree `/home/AgentKit/wt/t02`, head dd34ff8), Comments rounds 2–5, and `tests/memory/{expected-red.json, lib/budgets.mjs, lib/verdict.mjs, lib/win-sampler.mjs, scenarios/s1-proxy-steady.mjs}`. Also `proxy/zcode-proxy-manager.mjs:629-639` and `:274-284`.
- Issues 16, 17, 19, 20, 30, 33, 34, 37 and 60 in `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/issues/`, spec §18 and PROMPT §9.

Where an answer is ACCEPTED with conditions, the conditions bind the loop, the tickets and spec §18.

---

## Q1 — Which Windows metric gates the per-process budgets

**DECISION:** ACCEPTED with conditions. On Windows, the per-process peak and steady budgets are judged on the working set, which is Windows' RSS. Peaks use `max(sampled WS, PeakWorkingSetSize)`. This applies to the proxy, launcher, MCP bridge and preflight in S1, S3, S5 and S7, and to the S1/burst1 median rule. Commit is reported for every process. **This explicitly amends** Round 1 Q7 condition 3, Round 2 Q13 ("RED rules use commit charge on Windows"), Round 3 Q1 condition 2(b) (Windows per-process peak = `PeakPageFileUsage`), Round 6 Q1 conditions 4–5 ("commit on Windows"), the spec §18 sentence "commit on Windows unless stated", and ticket 02's "RED rules use commit on Windows". The amendment covers the per-process budgets named above and nothing else. Round 2 Q13 condition 3 and Round 6 Q2 condition 1 reserved exactly this question for the owner, so answering it here is the intended path, not a silent adjustment. Binding conditions:
1. **These stay on commit, because commit is what the OS enforces or what exhausts the system (C1):**
   - the S3 kit total (Round 3 Q1; see Q2);
   - every growth check;
   - every solver and S2 check: `procPeak:solver` anywhere, cost per generation, retained before recycle, hung-solve reclaim, and `procPeak:scenario` while S2 hosts the solver in-thread. The Job Object cap is a commit limit (Round 1 Q3 condition 5, ADR-0002), and a solver judged on WS could pass the test while the product's cap kills it.
2. **A commit backstop for the proxy.** In the paced runs (S1/short, S1/stalled, S3, S4, S7), no proxy sample's commit may exceed the ADR-0008 soft limit of 512 MB footprint. Above that limit the product's own `doctor` WARNs (Round 3 Q7), so a run there is not a pass. Today's values are all below it (S1/short 347.7, S1/stalled 452.3, S7 401.5, S3 188 MB), so the calibration does not change. Burst and bigbody runs are judged by their peaks only (ticket 01 decision 3).
3. **The WS peak must be reproducible from the artefact.** `samples.csv` gains an additive `ws_peak_kb` column (Round 2 Q13 condition 2 precedent). The job summary and `summary.json` print the commit value and the WS value for every memory check, not just a WS verdict. METRICS.md records both numbers per run, as Round 6 Q2 condition 5 already requires ("commit, working set").
4. `verdict.test.mjs` pins the split RED → GREEN with at least these cases:
   - a Windows proxy RED only on commit is GREEN;
   - a solver RED only on commit stays RED;
   - an S3 total RED only on commit stays RED;
   - a paced proxy above 512 MB commit is RED even when its WS is green.
5. Linux, every budget number and the product's own metrics (ADR-0002 cap, ADR-0008 footprint thresholds, `memory[]` fields) are unchanged. The amendment goes into spec §18 (metric sentence and the S1/S3 rows), ticket 02, ticket 20 (see Q3), and RUNLOG as a recorded deviation.

**Rationale:** §9 states the per-process budgets in RSS, and all of their numbers (250/160, 62/74/75/76, 150) were derived from Linux RSS. The measurements show that Windows working set is the like-for-like counterpart and commit is not:
- An idle proxy is 52–57 MB WS against 166–188 MB commit (run 3, S3/S4). Linux RSS is ~60 MB.
- A proxy's first sample is already 27 MB WS / 113 MB commit (S4 pids 2676 and 1644), so the ~120–130 MB offset exists before the kit does any work.
- S1/short peaks at 150 MB sampled WS against 331 MB commit. Linux: steady 122, HWM 173.

Judged on commit, these budgets cannot be reached by any kit fix:
- The S3 proxy target is 62 MB against an idle commit of ~188.
- S7's proxy peak (401.5 commit, 190.7 sampled WS) would keep ticket 34 from ever deleting its entry.
- burst1's per-run 400 MB ceiling (Round 6 Q1 condition 3) would fail on commit alone (422/424.5).

The result would be a permanent expected-RED list, which defeats §9 CI ("green on windows, empty list"). That is not a gate (C9: stronger measured evidence). Round 1 Q7 chose commit for a valid C1 reason: it is the resource that exhausts Windows, and the OS may trim the working set. Conditions 1–2 keep that guarantee where it matters: the cap, the total, leak detection, and a product-meaningful ceiling. The combination is not the strictest metric for every check. The S3 WS sum is higher than the commit sum: in S3/hung run 3, commit was 460 and GREEN while WS was RED. I keep commit for the total because Round 3 Q1 bound it, because private commit adds up across processes while a WS sum counts shared image pages once per process, and because Q2's ≥ 30 % rule tightens it anyway.

**Charter:** §9 (budgets stated in RSS; numbers unchanged), C1 (the enforced cap metric, leak detection and the total stay on commit; backstop), C7 (meaningful gates on the primary platform), C9 (stronger measured evidence), Round 2 Q13 condition 3, Round 6 Q2 condition 1.

**REVERSIBILITY:** Two-way door (a measurement rule in test code and spec text). No ADR. The amendment is recorded in spec §18 and RUNLOG.

---

## Q2 — The Windows S3 total

**DECISION:** ACCEPTED with conditions. The Windows S3 total is **≤ 514 MB of commit** (734.5 × 0.7 = 514.15, rounded down, which is a tightening). PowerShell processes the kit itself starts count as kit footprint. This is consistent with Round 3 Q1 condition 3 and Round 6 Q2 condition 5; it contradicts nothing. Binding conditions:
1. **The baseline is this run.** Run 42265988296 is the first clean windows run, on Bun 1.4.2 (Round 3 Q9 condition 1). It goes into METRICS.md as the Windows reference with the Round 6 Q2 condition 5 fields, plus the WS sum for information (Q1 condition 3). Run 3 (738.4 MB) is cited as corroboration and does not raise the number.
2. **One Windows S3 total applies to every S3 variant**: `kitTotalMB.windows` 600 → 514 in `budgets.mjs`, pinned by `verdict.test.mjs`. S3/hung (456.8) stays GREEN on this check. Nothing under `linux` changes.
3. **What counts.** Every process the kit starts counts (Round 1 Q6), and so does its conhost:
   - the launcher's, manager's and preflight's PowerShell for identity and start-time proofs (~65–72 MB commit each; one includes an `Add-Type` `csc.exe` compile).

   The loop's own `netstat`/PowerShell stays in the `tooling` role and is excluded. Ticket 02 already pins that attribution (`t02-r2-red4/5`, `t02-r4-red2`), and it stays pinned.
4. **Ticket 37's Windows criterion** changes from "≤ 600 MB commit (≥ 30 % rule …)" to "≤ 514 MB commit".
5. **Known risk, recorded rather than adjusted.** On today's per-process commit, the proxy (187.9) plus five bridges (role peak 388.1) already make 576 MB, before launchers (161.9) and preflight. With mechanisms (a)–(c), 514 is therefore unlikely on Windows without further levers. When ticket 37 misses, build-time gate 2 applies (Round 3 Q2 condition 8): the orchestrator returns with numbers for the measured levers. Those are the lean resident launcher and the Bun bridge, and now also replacing the per-call PowerShell proofs. No lever is adopted now, and the 514 is never loosened (§9).

**Rationale:** The ≥ 30 % rule applies to every baseline above its budget on each leg (Round 3 Q1 condition 3), and Round 6 Q2 condition 5 already ordered this exact tightening. "Total kit footprint" means every process the kit starts. A PowerShell child of the launcher or manager is such a process, and leaving it out would understate Windows' real cost by ~65–72 MB per call. Writing down that 514 is probably out of reach of the planned mechanisms keeps the gate honest instead of leaving it to surprise ticket 37.

**Charter:** §9 (≥ 30 % rule; no loosening), C1 (the kit's processes are bounded in total), C7, C9, Round 1 Q6, Round 3 Q1/Q2.

**REVERSIBILITY:** Two-way door (a budget value; only further tightening is allowed). No ADR.

---

## Q3 — Calibration commit for the windows list (Round 6 Q2)

**DECISION:** REJECTED in part. Accepted:
- remove `S5/short`;
- keep `S3/short → 37`, `S3/hung → 16`, `S4/short → 17`, `S7/short → 34`, `S2/short → 58` and `S1/burst4|burst16|burst32|bigbody → 19`;
- add `S1/burst1 → 20` under the ticket-60 median rule;
- `S1/short` gets no entry, because Q1 answers its owner question and it is GREEN on the WS gate.

**Rejected: `S1/stalled → 19`.** Ticket 19 does not own that defect, so the entry would break Round 6 Q2 condition 1 ("never listed under a fix ticket that does not own it"). The facts:
- S1/stalled sends only ~200-byte request bodies, each asking for a ~4 MB streamed answer that is never read before disconnect (`s1-proxy-steady.mjs:68-80, 122`). The in-flight bytes are response bytes.
- Ticket 19 caps request-body bytes, and its own Delivers says "Open response streams are not limited" (Round 1 Q5).
- On Linux the variant is GREEN (HWM 167 MB). On Windows it is RED on both metrics: commit 444/452.3, sampled WS 283.8 MB in run 3, and WS RED in both runs.

So on Q1's gate it still needs an entry, and no existing ticket owns it. My decision:
1. **File a new ticket** (next free number, 61 at the time of writing): "S1/stalled on Windows: proxy peak above 250 MB with stalled streaming readers (Linux HWM 167 MB)", with `Status: needs-triage`, Model sol (streaming), Risk high. It carries both runs' numbers (commit, WS, Linux), and it asks where the buffering toward paused sockets on Windows comes from. List `S1/stalled` under `windows` → that ticket. Any fix that would limit open response streams contradicts Round 1 Q5, and it comes back to the owner before it is built.
2. **The S5/short removal** cites its numbers in the commit message, which meets Round 6 Q2 condition 2:
   - GREEN in runs 3 and 4 with 717/714 samples, the bridge seen, units self-test `ok: true`;
   - procPeak 89–89.8 MB (≤ 150), 0 task failures, reboot cost 4 MB.

   The commit also records that the growth slope is 26.24 / 22.01 %/1k with no trend (run 3: net 7.3 %, 0 rising windows). It is therefore GREEN under spec §18's slope-plus-trend rule only. Ticket 30 records the Windows S5 numbers after its fix. If a later windows run turns S5 RED, Round 6 Q2 condition 3 applies: the scenario comes back as a question, and nobody edits the list again.
3. **S1/burst1 → 20.** The rule is ticket 60's median of n with a per-repetition ceiling of 400 MB, judged on WS on Windows (Q1). Ticket 20 gains these criteria:
   - "In a ≥ 20-repetition measurement on each leg (RSS on Linux, **working set** on Windows), every repetition is ≤ 250 MB" (the Round 6 Q1 condition 4 text, amended by Q1);
   - "**Delete `S1/burst1` (windows).**"

   The sampled WS peak (248.3 MB in run 3) sits just under the budget, and only `PeakWorkingSetSize` puts it over. If the variant then flips GREEN/RED between windows runs, Round 6 Q2 condition 3 applies. The median rule is not stretched to cover it.
4. **The other kept entries stay RED on their owners' checks under Q1.** S7's only remaining RED is `proxy.log` (34), and its proxy peak is GREEN on WS. S3/hung keeps orphans, failed launches and stale locks (16). S3/short keeps the total, the lock and the orphan checks; for those, Q4 adds the edge that lets 37 delete it.
5. **The edits happen in one calibration commit,** with its CI run holding the ratchet on both legs (Round 6 Q2 condition 3). Ticket 02 stays open until that run is green (Round 6 Q2 condition 6).

**Rationale:** The ratchet's value lies in each entry naming the ticket whose fix turns it GREEN. Under 19, the S1/stalled entry would outlive ticket 19's merge, and the "delete your entry" acceptance could never be met. It would also push 19 toward limiting response streams, which Round 1 Q5 rejected. A Windows-only defect that is RED on both metrics and has no owner is exactly the `needs-triage` case. Everything else in the recommendation is backed by the two runs and matches Round 6 Q1/Q2.

**Charter:** C9 (an entry is owned by the ticket that fixes it), C1, C7, Round 1 Q5, Round 6 Q1/Q2.

**REVERSIBILITY:** Two-way door (list entries and ticket text). No ADR.

---

## Q4 — The Windows killed-start orphan

**DECISION:** ACCEPTED with conditions. The defect is confirmed in the code. `start()` writes `proxy.pid` with `startedMs: null` right after the spawn (`zcode-proxy-manager.mjs:632`), and fills it in only if `processStartMs` answers within a 5 s probe of up to 2 × 2.5 s PowerShell calls (`:633-639`). `verifyOwnProcess` then returns `start-unknown` (`:279-284`), and every stop refuses: "start time of pid 3796 is not determinable … refusing to kill" (run 3 S3/hung `cleanup.finalStop`). Windows S3 entries stay listed until the fix lands. "Owned by 16 and 17" leaves the work without a single owner, so these conditions bind:
1. **Ticket 16 owns closing the window.** No live proxy may end up with a pid record that lacks a start time. The ticket chooses the mechanism, for example recording identity before or at spawn, or a proof that needs no external query. **The window is wider than a killed start:** a probe that simply times out (two slow PowerShell calls, no kill at all) leaves the same record behind for good. Both cases are covered. Acceptance moves out of the Comments into Acceptance:
   - on windows-latest, a kill injected at each point between spawn and the complete record, and a forced probe timeout, each end with the proxy stoppable or adopted;
   - S3/hung windows shows 0 orphans before 16 deletes `S3/hung (linux, windows)`.
2. **Ticket 17 owns records that already exist.** Records with no start time, written by old kits on users' machines, are adopted or stopped (C2: old state keeps working). Ticket 17's S4 criterion covers `unstoppable-proxy-after-ctrl-c` on Windows (2 of 8 today).
3. **Never kill on a pid alone (C1, C6, AUD-001).** Without a recorded start time, a stop or adoption needs a proof of equal strength: an authenticated identity answer from the recorded pid, with the listener's owning pid equal to the record, or the per-spawn stop capability once ticket 22 exists. Relaxing `start-unknown` into "kill anyway" is not a fix. A test shows that a reused pid with no record match is never killed.
4. **New edge: ticket 37 is blocked by 17.** Windows S3/short is RED on the orphan, failed-launch and stale-lock checks as well as on the total (run 4: orphans 1, failed launches 1, stale lock 1). It has a single owner, 37, which cannot fix the lock checks. With 17 landed first, 37's "GREEN → delete `S3/short (windows)`" is reachable. The graph stays acyclic (17 ← 16 ← 15; 37 ← 15, 35, 36). PROMPT §0 says wall-clock time does not matter.
5. `cleanup.pidRecordLeft` stays in S3's summary. The calibration commit cites it from run 4's artefact as the direct record of `startedMs: null`. It is only corroboration: the code and the stop text already establish the defect.

**Rationale:** The finding is a C1 failure on the primary platform. The kit starts a proxy it can never stop, and a crash, Ctrl-C or slow PowerShell reaches the same state for real users, not only the adversarial loop. The recommendation is right that the entries stay until the fix lands. But it splits ownership without saying who does what, and it misses the no-kill timeout path. It also leaves ticket 37 holding an entry it can never clear. The conditions give each part one owner and keep the identity-proof safety that Round 1 Q4 kept.

**Charter:** C1 (every child reaped; exactly one proxy, never an unstoppable one), C2 (legacy records), C6 (no kill without proof), C7, C9, Round 1 Q4, Round 5 Q2 (edges where a criterion needs another ticket's output).

**REVERSIBILITY:** Two-way door (ticket text and one edge). The pid-record contract change inside ticket 16 falls under the existing ADR-0003/Round 2 Q10 lock-and-record ADR, as an amendment line, not a new ADR.

---

## Shared understanding

CONFIRMED. No design branch is open. Q1–Q4 are measurement, calibration and ownership rules with exact conditions. These come back as questions with numbers when they occur:
- the Windows S3 total misses 514 MB of commit after ticket 37: build-time gate 2, now with the PowerShell-proof lever named;
- ticket 61 (S1/stalled on Windows) needs a response-side bound, which touches Round 1 Q5;
- a Bun solver child cannot fit its work under the 300 MB commit cap on Windows. The Bun commit floor is ~113 MB at the first sample and ~180 MB at an idle proxy. Ticket 28's windows proof and A1 will show it;
- S5/short or S1/burst1 disagree with the calibrated windows list on a later run (Round 6 Q2 condition 3).


---

# Round 8 (2026-11-06) — windows S1/burst1 disagrees with the calibrated list


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–7 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself:
- CI run 42281731448 (`gh run view`, `--log-failed`) on the `staging/02` head 0f324a7:
  - the windows `memory-budget` leg fails on exactly one ratchet line: `S1/burst1: GREEN but listed for ticket 20`;
  - S1/burst1 (windows) is `procPeak:proxy 222 MB (budget 250) [commit 365.2 / WS 222, gate WS]`, `count:proxy 1`, `orphans 0`, `@@JOB applied=1`, 3 requests;
  - the ubuntu leg's S1/burst1 is a single-run GREEN at 235.5 MB, and that leg fails on S3/hung;
  - all four `test-kit` legs and both `ux-before` legs are green.
- `expected-red.json` on `origin/staging/02`: `windows` lists `S1/burst1 → 20`, and `linux` does not list it.
- `staging/02` METRICS.md, Windows reference block:
  - run 4 S1/burst1: proxy peak 422 commit / 234.3 sampled WS, RED on live WS (`PeakWorkingSetSize`);
  - run 3: sampled WS 248.3, also RED through `PeakWorkingSetSize`;
  - the block's own caveat: "If it flips between runs, Round 6 Q2 condition 3 applies."
- Ticket 60 on `ticket/60-s1-burst1-median-rule` (`/home/AgentKit/wt/t60`, head 4a54f63, read-only):
  - 48 fresh Linux repetitions: 5 of 48 above 250 (p = 0.104); pooled with Round 6's samples, 8 of 59 (p = 0.136);
  - chosen n = 5, read from `budgets.mjs` (`REPEATED`);
  - the windows distribution was **not** measured.
- Ticket 60 in the integration tree says "Blocked by: 01, 02". Ticket 20 is unchanged in the integration tree, and its burst1 criterion text lives on the t60 branch.
- `tests/memory/lib/{win-sampler.mjs, verdict.mjs}` on `staging/02`: the WS gate uses `max(sampled WS, wsPeakKb)`. `wsPeakKb` is `PeakWorkingSetSize`, and it **defaults to 0** when the field is missing (`win-sampler.mjs:64`).
- RUNLOG 2026-11-06T13:11:25Z (the Round 6 Q1 order deviation) and 21:05Z (this round opened).

The windows S1/burst1 evidence so far is three single runs with WS gate verdicts **RED, RED, GREEN**. Its exceedance rate is unknown, and on these three runs it looks far above Linux's 0.10–0.14.

---

## Q1 — S1/burst1 (windows) went GREEN on the calibration run

**DECISION:** REJECTED in part.

Accepted:
- No list edit now.
- No budget change.
- Ticket 02's ubuntu S3/hung RED goes back to the 02 implementer first, outside this question.
- Then ticket 60 is finished on top of `ticket/02`. Both are merged into `staging/02` (02 first, then 60), and one pre-merge CI run judges them.
- 02 and 60 merge to the integration branch back to back, and only if that run is green on both legs.
- Ticket 20 keeps its ≥ 20-repetition criterion on both legs (RSS on Linux, WS on Windows).

Rejected: letting **one** pre-merge job run under the median rule decide whether the windows entry is deleted. That is a second list edit decided on a single sample. Round 6 Q2 condition 3 forbids it, and Round 7 Q3 condition 3 says the median rule "is not stretched to cover" a windows flip. Round 6 Q1 condition 2 requires that n comes from a measured distribution, with false-RED ≤ 5 % **per leg**. No windows distribution exists. At the windows evidence so far (2 of 3 RED, p ≈ 0.67), a median of 5 is GREEN about 21 % of the time. So the recommendation would leave the windows ratchet flaky one run in five if the entry is kept. If the entry is deleted on one GREEN median, about 79 % of later runs would fail as "RED but unlisted".

This answer is the "comes back as a question" step of Round 6 Q2 condition 3, and it authorises at most **one** further windows list change, decided by the rule below. Binding conditions:

1. **Rule out a measurement gap first (Round 6 Q2 condition 2).** From the run 42281731448 artefact, the proxy's `ws_peak_kb` in S1/burst1 `samples.csv` must be present and non-zero, and the 222 MB gate value must equal `max(sampled WS, ws_peak_kb)`.
   - If `ws_peak_kb` is missing or 0, the GREEN came from a missing observation (`wsPeakKb` defaults to 0). That is a harness failure and a real RED for ticket 02 (Round 6 Q2 condition 4). The windows entry stays, and the RED, RED history stands.
   - The check goes in ticket 02's Comments.
2. **Measure the windows distribution before the list question is settled.** On windows-latest, with the staged 02+60 code, run S1/burst1 as **at least 20** fresh, isolated repetitions, one after another.
   - Each repetition runs in its own Job Object with `@@JOB applied=1`.
   - The mechanism is the implementer's choice, for example the windows memory job restricted to S1/burst1 on the staging branch. It must use no new endpoints (C6).
   - Record per repetition: the WS gate value, sampled WS, `ws_peak_kb` (non-zero), commit peak, `count:proxy` and the units self-test.
   - Every repetition must also stay ≤ 400 MB WS (Round 6 Q1 condition 3 as amended by Round 7 Q1).
   - Write it to METRICS.md and ticket 60's Comments the way the Linux block was written.
   - Compute p_win twice: from these repetitions alone, and pooled with runs 3, 4 and 5 counted as RED, RED, GREEN. The decision uses the less favourable estimate, as ticket 60 did on Linux.
3. **One n, from both legs, read from one place.** n is the smallest odd n ≤ 9 at which, on **each** leg, the median verdict matches that leg's list state with probability ≥ 95 %: P(median RED) ≤ 5 % where the variant is unlisted, and P(median GREEN) ≤ 5 % where it is listed. Linux needs n ≥ 5 at p = 0.136. If windows needs more, n rises for both legs (≤ 9), and `verdict.test.mjs` pins the computation on both distributions. For n ≤ 9 the bands are:
   - **Windows entry deleted** if p_win ≤ 0.251 at n = 9 (≤ 0.189 at n = 5). Ticket 60's commit makes the deletion and cites the distribution and the condition 1 observation checks (Round 6 Q2 condition 2). Ticket 20's "Delete `S1/burst1` (windows)" criterion is struck with a note. Its "every repetition ≤ 250 MB on each leg" criterion stays, because the tail still exists.
   - **Windows entry kept under 20** if p_win ≥ 0.749 at n = 9 (≥ 0.811 at n = 5). That is a stable RED that ticket 20 owns.
   - **Neither:** p_win is in the middle band, where no median of n ≤ 9 gives a stable verdict either way. Then the list does not change, no budget changes, and no "flaky entry" mechanism is added (Round 6 Q1 rationale). 02 and 60 do not merge. The question comes back with the windows distribution, the same as Round 6 Q1's "no n ≤ 9" exit.
4. **The pre-merge run confirms. It does not decide.** If the one pre-merge CI run on `staging/02` (02 + 60, with the list from condition 3) disagrees with the list on either leg's S1/burst1, there is no rerun-until-green. The run's numbers come back as a question, and 02 and 60 do not merge. Any other RED follows Round 6 Q2 condition 4 and the Phase 4 rule as usual.
5. **Order and records.**
   - Staging 02 and 60 together, with 02 merged first, meets ticket 60's "Blocked by: 02" edge and restores Round 6 Q1's intent that a pre-existing burst1 flake cannot trigger a revert of 02.
   - RUNLOG records this as the closure of the 13:11:25Z deviation.
   - Ticket 02 stays open until the pre-merge run is green on both legs (Round 6 Q2 condition 6).
6. **Nothing else changes:**
   - the 250 MB budget;
   - the 400 MB per-repetition ceiling;
   - the `linux` list;
   - every other `windows` entry;
   - `budgets.mjs`, except `REPEATED` if condition 3 raises n;
   - Round 7 Q1's metric split.

**Rationale:** The windows S1/burst1 peak sits right at its budget. The live WS is just over 250 in runs 3 and 4 and 222 in run 5, so a single run is a coin flip, not evidence (C9, Round 6 Q1). The recommendation is right on order: staging 02 and 60 together fixes the Round 6 Q1 deviation without a second calibration edit, and its merge gates are right. But it then lets one median-of-5 job run settle a list entry, using an n computed only from Linux. Round 6 Q1 requires n per leg from a measured distribution. Round 6 Q2 condition 3 and Round 7 Q3 condition 3 send a windows flip back as a question rather than letting a single run or a stretched median resolve it. The binomial bands show why that matters. Unless Windows' exceedance rate is outside roughly 0.25–0.75, no permitted n gives a stable windows verdict, and either list state would make the ratchet flaky, which leads to spurious reverts under Phase 4. Measuring 20+ windows repetitions first costs about 10 minutes of CI. It turns the entry into a decision backed by numbers, and it keeps the ratchet's meaning: an entry is RED until its owner's fix and GREEN otherwise. Condition 1 guards the one way this GREEN could be fake: a missing `PeakWorkingSetSize` silently defaults to 0.

**Charter:** C9 (stronger measured evidence; then the smaller blast radius: no merge on a coin flip), C1 (bounded memory proven by a distribution, not a lucky sample), C7 (Windows is primary, so its leg needs its own evidence), §9 (no budget loosened), Round 6 Q1 conditions 2, 3 and 5, Round 6 Q2 conditions 2, 3, 4 and 6, Round 7 Q1, Round 7 Q3 condition 3, PROMPT §7 Phase 4 (no spurious reverts).

**REVERSIBILITY:** Two-way door (a list entry, the repetition count and ticket text). No ADR.

---

## Shared understanding

CONFIRMED. No design branch is open. These come back as questions with numbers when they occur:
- the run 42281731448 GREEN turns out to be a missing `PeakWorkingSetSize` observation (a harness RED for 02);
- the windows S1/burst1 exceedance rate falls in the middle band, where no median of n ≤ 9 is stable;
- the pre-merge `staging/02` run disagrees with the distribution-backed list.


---

# Round 9 (2026-11-07) — the Windows S1/burst1 distribution lands in the middle band


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–8 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself:
- `/home/AgentKit/overhaul-tools/ci-art/r8-measure-nGEr/memory-budget-windows/measure-S1-burst1.{md,json}`:
  - 24 of 24 runs valid: `ws_peak_kb` non-zero in every run, units self-test `ok`, Job Object `applied`, `count:proxy 1`;
  - in every run the WS gate equals `ws_peak_kb` / 1024 (for example 298060 KB = 291.1 MB), so the gate is `max(sampled WS, PeakWorkingSetSize)` as Round 7 Q1 fixed it;
  - 13 of 24 above 250 MB (p = 0.542); min / median / max 206.9 / 251.9 / 291.1 MB; none above 400 MB; commit median 403.7, max 446.3 MB;
  - the first 12 runs have 8 above 250 and the last 12 have 5. That is no evidence of drift at this sample size.
- `…/memory-budget-linux/measure-S1-burst1.{md,json}`: 24 of 24 valid, 1 of 24 above 250 (p = 0.042), max 262.1, none above 400. RUNLOG 2026-11-07T00:15Z has the local 20 runs (2 of 20; pooled 10 of 79 = 0.127). Adding the CI runs gives 11 of 103 (p = 0.107), so the round's figures match.
- RUNLOG 2026-11-06T21:40Z: the Round 8 condition 1 check on run 42281731448 (`ws_peak_kb` non-zero in 19 of 19 rows, gate 222 = max). RUNLOG 2026-11-07T00:15Z and 00:34Z: staging/02 is 0f7b9e4 + 5380767, plus the marker db5f353. The measurement ran in run 42316982634.
- `issues/INDEX.md`: 20 ← 19 ← 13 (and 14) ← 12 ← 11 ← 10 ← 09 ← 02, 03, 04; and 03 ← 02. RUNLOG 21:20Z says "Frontier now only 02". 01, 04, 14 and 50 are `resolved`; 57 and 59 are `needs-triage`. The deadlock fact is correct.
- `issues/55-*.md`: it is blocked by 06, 16, 17, 19, 30, 32, 34, 35, 37 and 58, **not by 20 and not by 61**. Both of those own windows entries today.
- `issues/20-*.md`: the integration tree has no burst1 criteria. On `ticket/60` 7e8520a it carries the Round 6/7/8 burst1 criteria (every one of ≥ 20 repetitions ≤ 250 MB per leg; delete the windows entry).
- `ticket/60` 7e8520a: `tests/memory/lib/ratchet.mjs`, `lib/repetitions.mjs`, `lib/budgets.mjs` (`REPEATED` S1/burst1 n = 5, ceiling `burstPeakMB.burst16` = 400), `job.mjs` and `expected-red.json` (windows `S1/burst1 → 20`; linux unlisted).

**A gap in today's ratchet that matters here.** `medianVerdict` puts `median:procPeak:proxy`, `ceiling:procPeak:proxy` and every other RED check of every repetition into one `redChecks` list, and returns one exit code. `checkRatchet` only sees GREEN or RED per run key, and it accepts any RED for a listed key. So while `S1/burst1 → 20` is listed on windows, a repetition above the 400 MB ceiling, an orphan or a second proxy would all pass as "expected RED". Round 6 Q1 condition 3 ("every repetition must be ≤ 400 MB … applies now") is not enforced for a listed repeated key today. The round's point 2 assumes that it is.

---

## Q1 — What happens to windows S1/burst1 at p ≈ 0.54

**DECISION:** ACCEPTED with conditions. **This explicitly contradicts three earlier decisions:**
- Round 8 Q1 condition 3 says the middle band gets "no 'flaky entry' mechanism", and Round 8 authorised "at most one further windows list change, decided by the rule below". This answer adds such a mechanism, and the change is not decided by that rule.
- Round 6 Q1's rationale ("simpler than a flaky-entry mechanism").
- Round 7 Q3 condition 3 ("the median rule is not stretched to cover it"). The median rule itself is unchanged, but the ratchet is stretched for this one entry.

Round 8 sent the middle band back to the owner for exactly this case, and the distribution is now measured. So this is the intended return path. It is not a silent adjustment.

Merge 02 and then 60, with the windows `S1/burst1 → 20` entry kept and marked `unstable`. Binding conditions:

1. **A listed repeated key tolerates only its median check (this closes the gap above and applies to every listed repeated key, `unstable` or not).** The ratchet must see which checks were RED:
   - For a listed run key in `REPEATED`, the only RED check it accepts is `median:<check>`.
   - Each of these is a ratchet failure, listed or not: `ceiling:<check>`; any other RED check in any repetition (`count:proxy`, orphans, Job Object, units); a harness failure.
   - This enforces Round 6 Q1 condition 3 as written, so it does not contradict it.
2. **What `unstable` means.** It applies to windows `S1/burst1` only:
   - a median ≤ 250 MB passes;
   - a median > 250 MB and ≤ 300 MB passes;
   - each passing run prints `S1/burst1: unstable (median <x> MB, budget 250), owned by ticket 20` in the job summary and in the report rows;
   - a median > 300 MB is a ratchet failure;
   - condition 1 holds on top of this.

   The 300 MB bound is an evidence-backed tightening of the recommendation, not a budget:
   - 0 of 27 windows values exceed 300 MB (max 291.1). The 95 % upper bound on a single run above 300 is p ≈ 0.105, and at that p a median of 5 exceeds 300 with probability ≈ 1.0 % (binomial). The bound does not make the entry flaky.
   - Without it, a Windows-only regression of up to ~109 MB per run would pass silently until ticket 20. Ticket 20 sits eight tickets down the chain, behind Bun 1.4.4 (11) and the undici/happy-dom bumps (12).
   - This is not the per-run "≤ 300 MB" target that Round 6 Q1 condition 4 rejected for ticket 20. Ticket 20's target stays "every repetition ≤ 250 MB", and the 250 MB budget is unchanged.
   - The bound disappears with the entry.
3. **One entry, enforced in code.** `unstable` is a value kind in `expected-red.json`, for example `{ "ticket": "20", "state": "unstable" }`, in one place. The exact shape is the implementer's choice. The schema check accepts it for `windows` `S1/burst1` only, through an allow-list of one key in code. Any other key that carries it is a schema error. `verdict.test.mjs` / the ratchet tests pin these cases RED → GREEN:
   - an `unstable` median of 251 passes, and so does 230;
   - a median of 301 fails;
   - one repetition at 401 fails while the median is 240;
   - an orphan or `count:proxy 2` in one repetition fails;
   - `unstable` on any other key, or on `linux` `S1/burst1`, is rejected;
   - a normal listed repeated entry that is RED only on its ceiling fails (condition 1).

   Any other scenario that lands in a middle band comes back as its own question with its own distribution (Round 6 Q1 condition 6). `unstable` is not extended to it.
4. **One owner, one exit.** The entry leaves the list only through ticket 20's existing criterion: a ≥ 20-repetition measurement where every windows repetition is ≤ 250 MB on the WS gate (run through the off-by-default measurement mode), and the commit that deletes the entry cites it. If ticket 20 cannot reach that, it comes back with numbers (Round 6 Q1 condition 4), and the budget is never loosened. No single job run, and no median of n, ever edits this entry (Round 6 Q2 condition 3 and Round 8 condition 4 stand).
5. **Ticket 55 gets the edge it is missing.** Add `20` to ticket 55's "Blocked by". Without that edge, 55's "empty list on both legs" criterion can come due while the 20-owned entry still exists. 55 also gains the recommended criterion: the guard rejects any `unstable` entry and any re-added entry, and the schema allow-list from condition 3 is removed. Ticket 20 keeps its "Delete `S1/burst1` (windows)" criterion, which Round 8 condition 3 did **not** strike, because the windows result was in the middle band.
6. **Nothing else changes:**
   - the 250 MB budget, the 400 MB per-run ceiling, n = 5 (`REPEATED`) and Round 7 Q1's metric split;
   - windows commit is still reported and still not judged for burst runs (Round 7 Q1 condition 2); the commit max of 446.3 is below the 512 MB paced backstop anyway;
   - Linux keeps S1/burst1 unlisted at n = 5 (false-RED ≈ 1.7 % at the less favourable p = 0.127, within Round 6 Q1 condition 2's 5 %);
   - every other `linux` and `windows` entry;
   - sampled WS does not become the gate. That would loosen Round 7 Q1 and miss the true peak.
7. **Merge path (Round 8 conditions 4 and 5, otherwise unchanged).**
   - Remove the marker commit db5f353.
   - Land conditions 1–5 on ticket 60, restage 02 first and 60 second, and run one pre-merge CI run on staging/02. It must be green on both legs.
   - That run confirms; it does not decide. For S1/burst1, "disagree" now means any of: a Linux median > 250; a windows median > 300; a ceiling breach; any RED check other than the median on either leg.
   - On any disagreement, the numbers come back as a question, with no rerun-until-green. Any other RED follows Round 6 Q2 condition 4 and Phase 4.
   - 02 and 60 merge back to back. Ticket 02 stays open until that run is green (Round 6 Q2 condition 6).
8. **Records.**
   - Spec §18 (S1 row) records the `unstable` state, the 300 MB median bound and condition 1 as a measurement-rule amendment.
   - RUNLOG records them as a deviation from Round 8 Q1 condition 3, naming this round.
   - METRICS.md and ticket 60's Comments get the windows and Linux distributions from run 42316982634, written the way the Linux block was written (Round 8 condition 2).
   - Ticket 20's Comments name the entry's state and its only exit.

**Rationale:** The decision rests on the 27 windows values: the median sits 1.9 MB above the budget and p ≈ 0.54–0.56. With those numbers, every option that keeps a binary ratchet fails:
- Listed as plain RED, the median of 5 is GREEN in ≈ 40–42 % of runs. At n = 9 it is still ≈ 36–40 %. That is a ratchet failure in roughly every second or third windows run, and under Phase 4 that means revert churn on good merges.
- Deleting the entry fails the other way, ≈ 58–60 % of the time.
- Gating on sampled WS would make the leg pass by loosening the metric Round 7 Q1 bound.
- Holding 02 until 20 is a deadlock: 02 is the only frontier ticket, and 20 is downstream of it.

Round 8 refused a flaky-entry mechanism because a "GREEN or RED" entry hides regressions. The evidence above shows that today's plain listing already hides more: it accepts a ceiling breach and any non-median RED for the listed key. So the accepted design is stricter than the status quo for this entry. It tolerates exactly one check, inside a 250–300 MB band with a measured ≈ 1 % false-RED rate. It cannot spread past one allow-listed key, and its only exit is ticket 20's ≥ 20-repetition criterion, backed by a new edge that stops ticket 55 from closing around it. The recommendation is right on the core point and is not loosening the 250 MB budget. It needed the band bound, the per-check tolerance and the 55 ← 20 edge to be safe.

**Charter:** C1 (bounded memory still proven: hard ceiling, single-proxy and orphan checks are now enforced where they were masked, plus a regression bound), C7 (Windows primary: a gate that holds without lying), C9 (stronger measured evidence: 27 valid runs; smaller blast radius than a deadlock or a metric change; one entry, one owner, one exit), §9 (250 MB budget, 400 MB ceiling and n unchanged; the 300 MB bound only tightens), Round 6 Q1 conditions 2–4 and 6, Round 6 Q2 conditions 3, 4 and 6, Round 7 Q1, Round 8 Q1 conditions 4 and 5, PROMPT §7 Phase 4 (no spurious reverts).

**REVERSIBILITY:** Two-way door (test code, one list entry, ticket text and one edge). The state is removed by ticket 20 and guarded out for good by ticket 55. No ADR.

---

## Shared understanding

Open branches I still see (none blocks this round's merge path):
- **Ticket 55 is also not blocked by 61**, but `S1/stalled → 61` is a windows entry. Ticket 61 is `needs-triage`, so 55's empty-list criterion can come due while that entry still exists. The orchestrator should add the edge 55 ← 61, or bring the question back if 61 is never accepted. This answer does not decide it.
- These come back as questions with numbers when they occur:
  - ticket 20 cannot get every windows (or Linux) repetition ≤ 250 MB (Round 6 Q1 condition 4);
  - a windows S1/burst1 median > 300 MB or a ceiling breach after a later merge, most likely at ticket 11 (Bun 1.4.4) or 12;
  - the pre-merge staging/02 run disagrees as defined in condition 7.


---

# Round 10 (2026-11-07) — Bun 1.4.4 and the Linux S1/burst1 peak in CI


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–9 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself:
- `ci-art/t09-measure-XAT9/memory-budget-{linux,windows}/measure-S1-burst1.{md,json}` and `ci-art/r8-measure-nGEr/…` (same files). All 96 runs are valid. Linux 1.4.4: 12 of 24 above 250 MB, median 246.4, max 318.8. Linux 1.4.2: 1 of 24, median 234.4, max 262.1. Windows 1.4.4: 14 of 24, median 252.4, max 295.9, commit median 406 / max 448.8. Windows 1.4.2: 13 of 24, median 251.9, max 291.1. No run is above 400 MB. These match the round.
- CI logs (`gh api …/jobs/<id>/logs`) for the ubuntu `memory-budget` job in runs 42347506810 (1.4.4), 42316982634 (1.4.2) and 42344393581 (pre-merge, `staging/09` fc1b3e3):
  - all three ran on the same runner image, `ubuntu-26.04` 20261101.186.1, provisioner 20261028.624;
  - all three used the same Node binary, 26.13.0, from the same `actions/node-versions` URL;
  - setup-bun reports `1.4.4+38afee6c8` and `1.4.2+744846f84`;
  - the pre-merge run fails on one line only: `S1/burst1: RED but not listed in expected-red.json (linux)`, with repetitions 252.3, 280.6, 246, 221.2 and 302.2.
- `git diff db5f353 e73bb1b` (the two measured trees): **no file under `zcode-proxy-src/src` changes**. The diff touches the workflows, MANIFEST*, the deleted nested `.github` files and `tests/memory/*` (the S3 OMP leg, the `omp-host` role, the `unstable` ratchet). None of the `tests/memory/*` changes touches the S1 scenario or the Linux RSS gate.
- Ticket 09 on `ticket/09-ci-toolchain` bf6fa98, including its Comments. The local Linux runs on Bun 1.4.4 give 0 of 20 above 250 MB (median 210.7) against 2 of 20 on 1.4.2 (median 230.9). The local job's S2 cost per generation drops ~12 % (1098.8 → 967.1 MB).
- Tickets 11 and 20, `issues/INDEX.md` (the chain 11 → 12 → 13 → 19 → 20), ADR-0006, ADR-0016, `research/bun.md` §1, METRICS.md lines 91–128, and `ci.yml` on t09: the `memory-budget` ubuntu timeout is 75 min, and 24 measurement runs took ~7.5 min.
- npm registry: `@types/bun` 1.4.2, 1.4.3 and 1.4.4 all exist (https://www.npmjs.com/package/@types/bun).

**Corrections to the round's facts:**
1. The actions moved from **v4** to v7 (`checkout@v4`/`setup-node@v4` in run 42316982634's log), not from v6.
2. The Node patch **is** captured for the 1.4.2 run: it is v26.13.0, the same binary as the 1.4.4 run. The measure JSON (`"node": "v26.13.0"`) and METRICS.md line 109 say so too.
3. The proxy source is identical between the two measured trees.

So the actions bump can change the job's setup, but not the measured process: a Bun proxy started from the same tree, under an identical Node.

**The confound left open is the VM.** Each arm ran on one VM, so the Fisher p ≈ 0.0003 treats 24 repetitions on one host as independent. It is conditional on that host. Two separate 1.4.4 VMs ran high (12/24, and 3 of 5 in the pre-merge run), against one low 1.4.2 VM. That points to Bun, but it does not prove it.

The artefacts also do not record the Bun version per run: the version comes only from the workflow log.

---

## Q1 — Ticket 09 (Bun 1.4.4 in CI) turns the unlisted Linux S1/burst1 RED

**DECISION:** REJECTED in part.

**Accepted:**
- Attribute first, with one paired measurement in a single CI run.
- No list edit, no budget change, no `unstable` state for Linux. Round 9 condition 3 stands, and this answer does not override it.
- No rerun-until-green.

**Rejected:**
- **Pinning only the `memory-budget` job to Bun 1.4.2 while CI and the release run 1.4.4.** This contradicts ADR-0016 condition 3 and its Consequences ("the toolchain batch changes the job's Bun pin from 1.4.2 to 1.4.4"), Round 2 Q15 condition 3 and Round 3 Q9 condition 2. Every memory fix would be proven on a runtime the kit does not ship.
- **The edge 11 ← new ticket.** It closes a cycle. The proposed fix owner, ticket 20, is downstream of 11 (20 ← 19 ← 13 ← 12 ← 11), so 11 would wait for a fix that cannot start until 11 lands.

**My decision instead:** one Bun version everywhere, chosen by C5's own test, "the latest stable version that passes the full test suite". If the paired run shows that 1.4.4 causes the Linux tail, 1.4.4 does not pass. The kit then pins the newest version that does pass, 1.4.3 or else 1.4.2, in CI, the memory job, release.yml and the installers alike.

Binding conditions:

1. **The paired run.** It runs on `staging/09` with the v7 actions and the one-run marker discipline (the marker never merges).
   - The ubuntu `memory-budget` job installs Bun **1.4.2, 1.4.3 and 1.4.4** in the same job, through setup-bun or the same GitHub release assets. No new endpoint is allowed (C6).
   - It runs S1/burst1 as **24 valid runs per arm, interleaved in rotation** (1.4.2, 1.4.3, 1.4.4, 1.4.2, …), one after another, each fresh and isolated. Rotation, not blocks, so drift on the host cannot pose as a Bun effect.
   - Cost: ~23 min, inside the 75 min timeout.
   - The `--bun <path>` override exists only in measurement mode and is off by default.
   - Each run records the Bun version that the proxy reports at runtime, not the flag value.
   - Once per arm, inside the same cap scope, the run records: `process.constrainedMemory()`, `navigator.hardwareConcurrency`, the CPU model, `nproc`, the cgroup filesystem type (v2-only or hybrid) and the scope's `MemoryMax`. Bun 1.4.4's one memory-relevant runtime change is GC heap sizing that now honours cgroup v2 limits on hybrid hosts (`research/bun.md` §1). That fits a CI-only, opposite-direction effect, and these values let the triage confirm or rule it out. The same values are recorded once on the local machine.
   - The windows leg runs the same three arms in the same CI run if they fit its 150 min timeout. Those arms are for information (C7). They decide only through condition 5.
2. **The decision rule, fixed before the run.** "p" is the fraction of an arm's 24 runs above 250 MB. "Stable unlisted" means P(median of 5 RED) ≤ 5 %, which is p ≤ 0.189, i.e. at most 4 of 24 (Round 6 Q1 condition 2, Round 8 condition 3). The rules apply in this order:
   - **(a) Invalid → back as a question.** This applies if any run is invalid, any run is above 400 MB, or the 1.4.2 arm is not stable unlisted (≥ 5 of 24). In those cases the host itself sits in the tail, and Bun cannot be judged. This is the orchestrator's branch 3.
   - **(b) No Bun effect → back as a question.** One-sided Fisher exact test on the counts above 250 MB, 1.4.4 against 1.4.2: if p > 0.05, Bun is not shown to be the cause. The question comes back with the pooled Linux CI distribution, including the 12/24 run and the pre-merge run (branch 3). 09 does not merge meanwhile.
   - **(c) Bun-caused.** If the Fisher p ≤ 0.05, 1.4.4 fails the full suite on Linux. The pin V is:
     - **1.4.3** if its arm is stable unlisted (≤ 4 of 24) and its Fisher test against 1.4.2 gives p > 0.05;
     - otherwise **1.4.2**.

     1.4.4 cannot be V in this branch.
3. **If (c): ticket 09 and ticket 11 carry V everywhere.**
   - 09's code sets `bun-version: V` in all three `ci.yml` jobs and in release.yml. The release-audit pin test wants V. The actions v7 bump and the deletion of the nested workflows stay as built.
   - 09's criterion becomes "all CI legs and both `memory-budget` legs green on Bun V with the unchanged `expected-red.json`".
   - Ticket 11 bootstraps V in both installers, with V's five SHA-256s from the primary source. It pins `@types/bun` V exact; 1.4.2 and 1.4.3 both exist on npm. Its attribution runs record V. If V = 1.4.2, there is no runtime change, the attribution step is moot, and RUNLOG notes that under Round 3 Q9.
   - Mixed per-OS pins are not allowed. `bun.lock` churns between 1.4.2 and 1.4.4 (the `hasInstallScript` key, `research/bun.md` §1), and C1 needs one measured runtime.
   - One pre-merge CI run on the restaged 09 confirms the choice; it does not decide it. Disagreement is defined as in Round 9 condition 7: a Linux median > 250, a windows median > 300, a ceiling breach, or any non-median RED. On disagreement the numbers come back as a question, with no rerun.
4. **If (c): one owner for 1.4.4, with no edges upstream.**
   - File a `needs-triage` ticket: "Bun 1.4.4 raises the Linux S1/burst1 peak on CI runners". It carries all four distributions, the paired run and the condition 1 environment values.
   - The ticket is **blocked by 20** and by nothing upstream of it. It owns the re-evaluation: after 20 merges, and at each new Bun stable release, it reruns the condition 1 paired measurement. It then moves the pin to the newest version that passes condition 2, through the normal toolchain path (09-style CI pins, 11-style installer hashes, an attribution run).
   - The ticket owns no `expected-red.json` entry, so ticket 55 does not need it.
   - Ticket 20's criteria do not change. Its "every one of ≥ 20 runs ≤ 250 MB on each leg" target is measured on the pinned runtime.
5. **Windows (C7, primary).** The 1.4.4 Windows numbers stay inside Round 9's `unstable` band: median 252.4 ≤ 300, max 295.9, against 13/24 → 14/24 on 1.4.2, which is no significant change. They do not decide this question. If any windows arm in the paired run has a run above 400 MB, or the arm for V has a median above 300, the numbers come back as a question.
6. **Records and contradictions.**
   - If V ≠ 1.4.4, this explicitly contradicts Round 1 Q15 ("Pin Bun 1.4.4 everywhere"), the "Bun 1.4.4 requirement" item in Round 2 Q10 condition 4, and ADR-0016's Consequences line. ADR-0016 gets an amendment line ("the job's Bun pin moves to the version chosen in Round 10"); no new ADR is needed.
   - Ticket 11's title and text and ticket 54's release notes name V. The notes also give the reason 1.4.4 is deferred, as a documented stay-back the way Round 1 Q16 condition 2 did for the MCP SDK (C5, C2 "announced, never silent").
   - C8: SUPPORT_MATRIX and README × 5 state V. That happens through tickets 11 and 53 as planned; only the value changes.
   - The paired distributions go into METRICS.md and ticket 09's Comments, written like the Round 8 block. RUNLOG records the decision, naming this round.
   - Round 9 condition 3, ADR-0016 condition 3 and Round 2 Q15 condition 3 are upheld, not contradicted.

**Rationale:**

*The case for Bun is strong but not proven.* The evidence implicates Bun more than the round allows. The trees, the Node binary and the runner image are identical, and two separate 1.4.4 VMs ran high. But each version still ran on its own hosts, and the local machine moves the other way. A paired, interleaved run on one host costs about 23 minutes of CI and settles the attribution (C9: stronger measured evidence).

*Why not pin only the memory job.* It would make the ratchet green by measuring a runtime that nobody ships. ADR-0016 ordered upgrades before fixes precisely so that every fix starts RED "on the runtime it ships on". It also deadlocks the chain once 11 waits for 20.

*Why not list Linux S1/burst1 as `unstable`.* Round 9 condition 3 forbids it. Unlike the windows case, it would also be a loosening: the Linux leg holds the 250 MB median rule today with ~1.7 % false-RED. Marking it `unstable` would let medians up to 300 pass to fit an upgrade (§9, C7 "Linux must not regress").

*Why C5 settles the pin.* C5 itself resolves the C1/C5 tension: it asks for the latest stable version **that passes the full suite**. The 250 MB burst1 median rule on Linux is part of that suite. If 1.4.4 is shown to fail it, the newest version that passes is the right pin. 1.4.3 is the only release in between, and it carries the memory win that the 1.4.4 choice rested on (memory returned from threads blocked in `Atomics.wait()`, the captcha worker's case). So it is worth one extra arm.

*Smallest blast radius.* The rule decides mechanically, with thresholds fixed in advance. It keeps one runtime across CI, the memory job and the installers. It changes version strings only, and it gives 1.4.4 a single owner with a re-entry path and no cycle (C9).

**Charter:** C5 (the latest stable that passes the full suite), C1 (one measured runtime; no budget masked), C7 (Linux must not regress; Windows evidence respected), C9 (stronger measured evidence; then the smaller blast radius: version strings rather than a split runtime; then the simpler option: one pin), C6 (no new endpoints), C2/C8 (stay-back announced), §9 (no loosening), ADR-0016 conditions 2–3, Round 2 Q15 condition 3, Round 3 Q9, Round 6 Q1 condition 2, Round 8 conditions 3–4, Round 9 conditions 3 and 7.

**REVERSIBILITY:** Two-way door. It is a version pin plus a measurement-mode flag, and the triage ticket moves the pin forward once 1.4.4, or a later Bun, passes. No new ADR. If V ≠ 1.4.4, ADR-0016 gets an amendment line. Shipping V to users through ticket 11 stays reversible with the next release.

---

## Shared understanding

Open branches I still see (none blocks the paired run):
- **Branch 2(a)/(b):** the paired run finds no Bun effect, or the 1.4.2 arm is itself in the tail. Then the Linux CI S1/burst1 distribution depends on the host, independent of Bun, and Linux burst1 needs its own decision. Round 9 condition 3 rules out the `unstable` state, so that decision comes back with the pooled distribution.
- **Windows:** if V = 1.4.3, the windows S1/burst1 distribution on 1.4.3 has not been measured. The pre-merge run confirms only the Round 9 band.
- The Round 9 open branch stands: ticket 55 still lacks the edge 55 ← 61.


---

# Round 11 (2026-11-07) — the paired Bun run: pin Bun 1.4.2


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–10 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself:
- `ci-art/t09-paired-1fRC/memory-budget-{linux,windows}/measure-S1-burst1.{json,md}`. I recomputed everything from the per-run `reps` in the JSON. All 144 runs are valid. The proxy's runtime Bun matches its arm in every run (`1.4.2+744846f84`, `1.4.3+c6da4a4d3`, `1.4.4+38afee6c8`). No run is above 400 MB.
  - **Linux**, runs above 250 MB: 5 / 14 / 13 of 24. Medians: 219.4 / 272.8 / 252.6 MB. Maxima: 260.5 / 331.4 / 333.2 MB.
  - Linux one-sided Fisher against 1.4.2: 1.4.3 p = 0.0086, 1.4.4 p = 0.0178. Both stay ≤ 0.05 after a Holm correction for the two comparisons. A one-sided Mann-Whitney test on the values agrees: z = 3.50 (p ≈ 2e-4) and z = 4.11 (p ≈ 2e-5).
  - All five 1.4.2 exceedances sit between 251.3 and 260.5 MB. The 1.4.3 and 1.4.4 tails reach 331–333 MB.
  - **Windows**, runs above 250 MB: 12 / 17 / 19 of 24. Medians: 250.1 / 254.45 / 257.7 MB. Maxima: 291.5 / 296.1 / 292 MB.
  - Windows one-sided Fisher against 1.4.2: p = 0.119 and 0.034. The 0.034 does **not** survive Holm (its threshold is 0.025), and Mann-Whitney on the values gives p = 0.20 and 0.12.
  - Environment: both legs ran on an Intel Xeon Platinum 8573C with 4 cores. Linux is cgroup v2-only, with `constrainedMemory` = MemoryMax = 3 GiB, and Windows runs under a 3G Job Object. The values are identical across arms.
- Run 42352122623 (`gh run view`): staging/09 e407916.
  - Both `memory-budget` legs and both `ux-before` legs are green.
  - Each of the 4 `test-kit` legs fails on exactly one test: "measurement mode is off by default … the marker is not committed", which is the marker guard.
- Runner image, from the ubuntu `memory-budget` job logs: runs 42316982634 (1.4.2, 1/24), 42347506810 (1.4.4, 12/24), 42344393581 (pre-merge) and 42352122623 (paired) all ran on `ubuntu-26.04` 20261101.186.1, provisioner 20261028.624.
- `r8-measure-nGEr` (Linux 1.4.2: 1/24, median 234.4, max 262.1) and `t09-measure-XAT9` (Linux 1.4.4: 12/24). **EVIDENCE MISSING: the CPU model and core count of the run 42316982634 runner.** The pre-paired artefacts do not record the environment, and the job log does not show it. So "same runner image" holds, but "same hardware class" is unproven.
- Recomputed binomials, P(median of n RED) = P(≥ ⌈n/2⌉ of n above 250):
  - at p = 5/24 = 0.2083: n = 5 → 6.45 %, n = 7 → 3.83 %, n = 9 → 2.32 %;
  - at pooled p = 6/48 = 0.125: n = 5 → 1.61 %, n = 7 → 0.62 %.
  - The largest p that is still stable unlisted is 0.135 / 0.189 / 0.225 / 0.251 for n = 3 / 5 / 7 / 9, which is at most 3 / 4 / 5 / 6 of 24.
  - Pooled 1.4.2 (6/48) against 1.4.3 and against 1.4.4: Fisher p = 8.5e-5 and 2.9e-4.
  - The two 1.4.2 CI samples: 5/24 against 1/24 gives a one-sided Fisher p of 0.094. The paired run's 1.4.2 arm has a *lower* median than run 42316982634's (219.4 vs 234.4), but a heavier near-budget tail.
  - The orchestrator's third-sample bounds are correct: pooled p ≤ 0.181 for up to 7/24 more, and 0.194 at 8/24.
- `tests/memory/lib/budgets.mjs` `REPEATED` (S1/burst1 n = 5; its comment says "Round 8 Q1 condition 3 may raise it (≤ 9)"), `lib/repetitions.mjs` `chooseRepetitions(p, {candidates: [3, 5, 7, 9]})`, and `verdict.test.mjs:522`, which pins n = 5.
- Issues 09, 11, 20, 55 and 60, `issues/INDEX.md` (55 already lists 61, so Round 9's open branch is closed), ADR-0006, ADR-0016 (Consequences: "changes the job's Bun pin from 1.4.2 to 1.4.4"), METRICS.md lines 70–128, and `research/bun.md` §1.
- A grep of `issues/` finds no ticket whose design relies on behaviour that only 1.4.3 or 1.4.4 has. The references are titles and blocked-by text only.

---

## Q1 — Which Bun does ticket 09 pin, given the paired run

**DECISION:** REJECTED in part.

**Accepted:**
- **V = 1.4.2 everywhere** (points 1, 3, 4 and 5, with the changes below).
- Linux S1/burst1 stays unlisted, with no `unstable` state and no budget change.
- No third 1.4.2 sample.

**Rejected:**
- **Point 2.** The recommendation calls 1.4.2 "stable" at n = 5 by switching to the pooled estimate (6/48). That contradicts the convention in Round 8 Q1 condition 2 and Round 9 Q1 condition 6, and the one ticket 60 followed: the decision uses the **less favourable** estimate. That estimate is this arm's 5/24, and at n = 5 it gives a 6.45 % false-RED rate per Linux run, above Round 6 Q1 condition 2's 5 % line. The mechanism already decided for exactly this case is to raise n (Round 6 Q1 condition 2, Round 8 Q1 condition 3). It is not to change the estimator after the result is known.
- **The claim that 1.4.4 is "also worse on Windows, the primary platform".** The Windows Fisher p = 0.034 does not survive the two-comparison correction, and the value-based test gives p = 0.12. Windows is information only (Round 10 condition 5) and is not a reason for the pin.

**The branch.** This is not branch (c) by relabelling. It is Round 10 condition 2(a) coming back as a question, and I answer it on the paired data. Round 10's premise for (a) was "the host itself sits in the tail, and Bun cannot be judged". On this host Bun **can** be judged: within one VM, interleaved, both newer releases are significantly worse than 1.4.2 on counts and on values. What (a) still leaves open is only whether the Linux leg is stable on 1.4.2. That is answered by n.

**Explicit contradictions:**
- Round 9 Q1 condition 6 ("n = 5 (`REPEATED`)" unchanged): n becomes 7.
- Round 10 Q1 condition 2's definition of "stable unlisted" at n = 5 (≤ 4 of 24): the job's n now sets that line.
- Round 1 Q15, Round 2 Q10 condition 4 ("Bun 1.4.4 requirement") and ADR-0016's Consequences line: V ≠ 1.4.4, as Round 10 condition 6 foresaw.

Round 10 sent this case back for an owner answer, so this is the intended return path.

Binding conditions:

1. **Pin V = 1.4.2 (Round 10 condition 3, applied as written).**
   - Ticket 09: `bun-version: 1.4.2` in all three `ci.yml` jobs and in release.yml. The extra arms exist only under the paired marker.
   - The release-audit test asserts 1.4.2 exactly, and still rejects 1.4.0 and `node-version: 20`. Today's "no `bun-version: 1.4.2`" assertion is replaced, with this round named as the justification.
   - The v7 actions and the deletion of the nested workflows stay.
   - Ticket 11: installers bootstrap 1.4.2 with its five SHA-256s from the primary source (the GitHub release assets), and pin `@types/bun` to 1.4.2 exactly. The attribution step is moot, and RUNLOG notes that under Round 3 Q9.
   - No per-OS pin and no pin that applies to the memory job only.
2. **Linux stability is settled by n, from the less favourable estimate (Round 6 Q1 condition 2, Round 8 Q1 condition 3).**
   - `REPEATED["S1/burst1"].n` goes from 5 to 7, on both legs: one n, read from one place.
   - At p = 5/24, n = 7 gives a predicted false-RED rate of 3.83 % per Linux run, and 0.62 % at the pooled 0.125.
   - Windows `unstable` still fails at a median above 300 MB. No Windows value in 72 + 48 runs is above 300 (max 296.1), so n = 7 does not make that entry flaky.
   - Cost: two more repetitions per leg, ≈ 38 s on Linux and ≈ 45–52 s on Windows (measured `durationS`: 19 s and 22.7–26 s per run).
   - Tests pin the change RED → GREEN, which justifies changing `verdict.test.mjs:522`:
     - `chooseRepetitions(5/24)` returns 7, and `chooseRepetitions(6/48)` returns 5;
     - `repetitionRule("S1/burst1").n === 7`;
     - an existing median and `unstable` case is re-expressed with 7 repetitions.
   - Nothing else changes: the 250 MB budget, the 400 MB per-repetition ceiling, the metric split (Round 7 Q1), the `unstable` allow-list of one key (Round 9 condition 3), and both `expected-red.json` lists.
   - This is a measurement-precision change inside the range Round 6 allowed (n ≤ 9). It is not a loosening: the median must still be ≤ 250, and every repetition must still be ≤ 400.
   - It lands as its own commit on ticket/09, because it is part of what 09's criterion is judged on.
3. **One pre-merge confirmation run** on the restaged 09, with the marker removed, Bun 1.4.2 and n = 7. It must be green on both legs. It confirms the decision; it does not make it.
   - "Disagree" has the Round 9 condition 7 meaning: a Linux median above 250, a windows median above 300, a ceiling breach, or any non-median RED.
   - On disagreement, the numbers come back as a question. Nobody reruns until green.
   - Ticket 09's criterion reads: "all CI legs and both `memory-budget` legs green on Bun 1.4.2 with the unchanged `expected-red.json`".
4. **One owner for the newer Bun (Round 10 condition 4, with a corrected title and a fixed re-entry rule).**
   - File a `needs-triage` ticket, blocked by 20 and by nothing upstream, titled "Bun ≥ 1.4.3 raises the S1/burst1 proxy peak on the CI runners".
   - It carries:
     - the four earlier distributions and both paired legs;
     - the environment table;
     - the facts that the hybrid-cgroup hypothesis is ruled out (v2-only) and that the step appears at 1.4.3;
     - the local contrast: AMD EPYC 7B12 with 8 cores, 1.4.2 2/20 and 1.4.4 0/20. The difference between the 4-core Intel runner and the 8-core AMD machine is a hypothesis, not a finding.
   - It also lists the 1.4.3 fixes the kit gives up by staying back (`research/bun.md` §1):
     - memory returned from threads blocked in `Atomics.wait()` (the captcha worker);
     - the `import.meta` string leak on Worker termination (solver recycle);
     - the `fetch()` Response/AbortSignal and compressed slow-reader leaks;
     - the `Bun.serve` `req.clone()` leak;
     - macOS `rss` under-reporting.

     Each entry records whether a kit path hits it.
   - **Re-entry rule.** It applies after 20 merges and at each new Bun stable release, using the paired mode with the pinned version as the reference arm. A candidate becomes V only if all four hold:
     - (i) every run is valid and ≤ 400 MB;
     - (ii) its Linux arm is stable unlisted at the job's current n, on the less favourable of its own arm and its pooled CI history;
     - (iii) one-sided Fisher against the pinned arm in the same run gives p > 0.05;
     - (iv) its Windows median is ≤ 300 MB with no run above 400 MB.

     n is never raised to admit a candidate. Then the normal toolchain path applies (09-style pins, 11-style hashes, an attribution run).
   - The ticket owns no `expected-red.json` entry, so 55 needs no edge to it.
5. **Windows (Round 10 condition 5) is met.** On the 1.4.2 arm the median is 250.1 MB (≤ 300) and no run is above 400 MB. The arm's 12/24 is consistent with the earlier 13/24, and the `unstable` entry is unchanged.
6. **Records (Round 10 condition 6, plus this round's additions).**
   - ADR-0016 gets an amendment line: "the job's Bun pin stays at 1.4.2 (Rounds 10–11)".
   - Tickets 09 and 11 have their titles and text renamed to name 1.4.2.
   - Ticket 54's release notes give the stay-back reason, Linux CI S1/burst1 peaks on ≥ 1.4.3, and the forgone 1.4.3 fixes, announced rather than silent (C2, C5).
   - SUPPORT_MATRIX and README × 5 state 1.4.2, through tickets 11 and 53.
   - METRICS.md and 09's Comments get the paired block, written like the Round 8 block.
   - Spec §18 (S1 row) records n = 7 as a measurement-rule amendment.
   - RUNLOG records this round as a deviation from Round 9 condition 6 and Round 10 condition 2's n = 5 line.
   - Ticket 20's target is measured on 1.4.2.

**Rationale:** The paired run did what Round 10 asked of it: it separated Bun from the host. On one VM with the arms interleaved, 1.4.3 and 1.4.4 move the Linux burst1 distribution up, from a 219 MB median with near-budget exceptions to 253–273 MB medians with tails above 330 MB. That holds on counts and on values, and it survives the multiple-comparison correction. So no newer Bun passes the full suite on the runner that judges the ratchet, and C5's own test picks 1.4.2.

The recommendation is right on the pin, the owner ticket and the confirmation run. But it makes 1.4.2 "stable" by changing the estimator after seeing a 5/24 result. The earlier rounds bound the less favourable estimate, and that rule exists so that a decision is robust to the VM a job happens to get. At n = 5 the less favourable estimate is a 6.45 % false-RED rate, and under Phase 4 a false RED reverts a good merge on a chain of about 50 tickets. Raising n to 7 uses the mechanism Round 6 Q1 already granted, fits on the worst VM observed, costs under a minute per leg, and leaves every budget, ceiling and list entry untouched (C9: stronger evidence, then the smaller blast radius).

**Charter:** C5 (latest stable that passes the full suite), C1 (one measured runtime; budget and ceiling unchanged), C7 (Linux must not regress; Windows checked and unchanged), C9 (stronger measured evidence, then the smaller blast radius, then the simpler option: one pin and one n), C2/C8 (stay-back announced), C6 (no new endpoints), §9 (no loosening), Round 6 Q1 condition 2, Round 8 Q1 conditions 2–3, Round 9 conditions 3 and 7, Round 10 conditions 2–6, ADR-0016.

**REVERSIBILITY:** Two-way door. The change is a version pin, one repetition count and ticket text. The triage ticket moves the pin forward under a fixed rule, and shipping 1.4.2 to users stays reversible with the next release. No new ADR; ADR-0016 gets an amendment line.

---

## Shared understanding

Open branches I still see (none blocks ticket 09):
- **EVIDENCE MISSING:** the CPU class of the run 42316982634 runner. If future paired runs land on other hardware, the triage ticket records the CPU model per arm. That is already in the paired mode.
- The pre-merge run at n = 7 disagrees (condition 3) and comes back with numbers.
- The Bun ≥ 1.4.3 triage ticket finds no fix by ticket 20, so the kit stays on 1.4.2 at Phase 6. That is a documented C5 stay-back for the release notes, not a blocker.
- Ticket 20 cannot get every repetition ≤ 250 MB on 1.4.2 (Round 6 Q1 condition 4).


---

# Round 12 (2026-11-07) — triage of tickets 57, 59 and 61


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–11 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only, on the integration worktree at f5d223f:
- `issues/57-*.md`, `59-*.md`, `61-*.md` in full; `issues/INDEX.md`; the `Blocked by` lines of every ticket (reverse edges for the cycle check); `issues/19`, `20`, `30`, `31`, `36`, `53`, `54`, `55`; `issues/51-*.md` Comments (Claude Code effort row, the follow-up note, the Low-drift note).
- `docs/agents/triage-labels.md` (five roles: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`).
- DECISIONS.md Round 1 Q2, Q5 and Q18, Round 5 Q2, Round 7 Q1–Q4 and Shared understanding, Round 9 (55 ← 61).
- `reports/architecture.md` candidates 6 and 8 and the lifecycle table; spec.md §Out of Scope (lines 803–812); PROMPT.md B1–B6 and the live-smoke rule.
- METRICS.md (Linux S1/stalled HWM 165 MB, heap 6 MB; Windows reference run 42265988296 table); `tests/memory/expected-red.json`.
- Code, for the facts only: `mcp/zcode-harness-mcp/src/runtime/manager.ts` (`ensureConnection`, lazy respawn, no budget), `src/index.ts:16` (static `serveHttp` import) and `:87-90` (crash handler), `src/mcp/server.ts:11` (HTTP transport import), `test/fixture/fake-harness.mjs:14,281` (`FAKE_EXIT_ON_SEND`), `zcode-proxy-src/src/proxy/handler.ts:423,433,441` (three `tee()` sites), `cli/adapters/kilo-code.mjs:42`, `tests/adapter-audit.test.mjs:180`.

Where an answer is ACCEPTED with conditions, the conditions bind the ticket text and INDEX.md.

---

## Q1 — Ticket 57: MCP runtime restart budget (architecture candidate 8)

**DECISION:** ACCEPTED with conditions; the edge rationale is REJECTED as worded and one edge is added.
- **Triage role:** `ready-for-agent`. Model sol, Risk medium, ADR no. `Status: ready-for-agent`.
- **Criteria changes.** The single criterion "… owner decides" is replaced by a rule fixed before any measurement, so the agent never makes the owner's call:
  1. **Stage 1, measurement.** Add an S5 variant (`S5/restart`) that runs the real bridge against the fake harness with `FAKE_EXIT_ON_SEND=1` (it already exists, `fake-harness.mjs:281`), on both legs of the `memory-budget` job. A client issues K ≥ 20 back-to-back tool calls, each of which makes the harness exit, and then stops the bridge. The run records: harness children spawned; the maximum number of concurrent harness children; children still alive after each exit and after the bridge stops; spawn timestamps (rate); and the bridge peak against the S5 budget.
  2. **Storm definition (pre-registered).** A restart storm is possible if any of these holds: more than 1 harness child exists at once; any child is left unreaped after its exit or after the bridge stops; or respawns are bounded only by the client's call rate, i.e. K failing calls give about K spawns with no backoff or budget. The code suggests the third case holds today (`manager.ts` `ensureConnection` respawns on every call; candidate 8 lists the MCP restart policy as "none"), but the variant decides.
  3. **Stage 2, only if a storm is possible.** Fold a respawn policy into the runtime module with the proxy's policy shape: a count per window, backoff and recorded state. The defaults mirror the proxy manager's budget (3 per 15 min), and the config key is optional and documented. When the budget is exhausted, the tool call fails in the bridge's existing tool-error shape (additive fields only). The error says what happened, why, and the exact next step (C3). New log events use the event-line format. `S5/restart` is the RED → GREEN test, with RED on the branch before the fix. `dist/` is regenerated by the build (B5).
  4. **If no storm is possible,** the ticket closes with the variant's numbers recorded in the ticket. The variant stays in the job as a GREEN regression guard.
  5. **Either way,** the module header of `runtime/manager.ts` is corrected to say what the code does (lazy respawn on the next call), as candidate 8 notes.
  6. **No expected-RED entry is added by 57.** If stage 2 is needed, the fix lands in the same ticket, so `S5/restart` is GREEN at merge on both legs. If stage 2 cannot make it GREEN, the ticket comes back with numbers. That keeps 55's empty-list criterion clear without an edge 55 ← 57.
  7. **Docs (C8).** If stage 2 lands, `docs/MCP_API.md` and the bridge READMEs × 5 describe the budget and its error; that is ticket 53's scope (edge below). Spec §Out of Scope line 808 ("An MCP runtime restart budget") is amended to "triaged in Round 12 as ticket 57".
- **Label:** `ready-for-agent`.
- **Edges.**
  - **57 ← 36 accepted, with the reason corrected.** 36 does not touch the "bridge runtime module": its lazy HTTP transport lives in `src/mcp/server.ts:11`, imported statically at `src/index.ts:16`. The real overlap is `src/index.ts`, the bridge entry, which also holds the crash handler (`:87-90`) that stage 2 changes. That is a same-file edge under Round 5 Q2. Through 36 ← 13, 57 also builds on the Batch 3 SDK/TypeScript bump.
  - **New edge 57 ← 30.** `S5/short` (linux) is listed RED → 30 in `expected-red.json`, and both tickets edit `tests/memory/scenarios/s5-mcp.mjs`. A restart variant measured before 30 lands would mix 30's growth defect into 57's numbers. It would also need a list entry that 57 does not own (Round 6 Q2 condition 1).
  - **New edge 53 ← 57.** 53 owns the bridge READMEs × 5 and `docs/MCP_API.md`, and 54 ← 53 carries the item into the release notes. If 57 closes with "no storm", the edge clears at once.
  - **Acyclic, checked.** 57 had no dependents. Its new ancestors are 30, 36 and through them 13 ← 12 ← 11 ← 10 ← 09 ← 02, 03, 04 (and 01). Its only new descendants are 53 and then 54. Neither 53 nor 54 is an ancestor of 30 or 36, so no cycle forms.
  - 56 (SDK 2) is `needs-triage`. If it is accepted later, its triage orders it against 57. No edge now.

**Rationale:** Round 1 Q2 kept candidate 8 out of the exploration set only because S5 never exercised runtime restarts, and it filed the candidate as `needs-triage` so that the question would come back. Accepting it now is that path, not a reversal. The measurement is cheap because the fixture already induces exits. The recommendation is sound in shape: measure first, then fix, with the variant as the RED → GREEN test. But "owner decides" and "storm possible" were undefined, which would leave a policy decision to the implementer. The pre-registered definition and defaults close that gap. The edge reason in the round was factually wrong (36 lives in `server.ts`/`index.ts`, not in `runtime/`), and the S5 overlap with 30 was missing.

**Charter:** C1 (no restart storms; a bounded number of processes; every child reaped), C2 (additive config, existing error shape), C3 (error says what, why, next step), C8, C9 (stronger measured evidence first; reversible), Round 1 Q2, Round 5 Q2, Round 6 Q2 condition 1, B5.

**REVERSIBILITY:** Two-way door (a test variant and, if needed, a defaulted policy in one module). ADR: no.

---

## Q2 — Ticket 59: proxy-side effort normalisation and the Kilo `/v1/models` sheet line

**DECISION:** ACCEPTED with conditions: split into two tickets. The split is physical, by ticket number, because one ticket file cannot carry two statuses.
- **Ticket 59 keeps part (b).** Retitle it "Kilo Code values sheet: correct the `/v1/models` auto-fetch line".
  - **Triage role:** `ready-for-agent`. Model **glm**, Risk **low**, ADR no.
  - **Criteria:**
    1. The false line in `cli/adapters/kilo-code.mjs:42` ("Models can also be auto-fetched from the /v1/models endpoint.") is replaced by a true one: for the Anthropic Messages provider, Kilo does not fetch the model list, so the models listed in the sheet are entered by hand. The agent re-verifies the primary source before writing it (`research/harness-configs.md:137` cites `CustomProviderDialog.tsx:233`, fetching disabled for `@ai-sdk/anthropic`).
    2. A test pins the absence of the false line in the generated sheet: RED first, then GREEN.
    3. Existing `generated/kilo-zcode-values.md` files are refreshed on the next `setup`/`integrate` through the existing transaction. A second run is byte-idempotent, and rollback restores the old sheet (Round 1 Q18 condition 2, C2).
    4. `tests/adapter-audit.test.mjs:180` holds the legacy sheet as **input** (what is on users' disks). It is not edited. Any other pre-existing test that changes is justified in the ticket.
    5. Any snapshot diff of the sheet is recorded. `harnesses/README*` currently carries no such line (grep), so C8 needs no doc change beyond the release notes; the agent confirms that grep in the ticket.
  - **Scope note (explicit departure, narrow):** spec §Out of Scope line 812 (from Round 1 Q18) leaves Low adapter drift out. I make **one** exception, for this line only, because it is a false instruction to the user in a file the kit generates. Every other Low item listed in ticket 51's Comments stays out.
  - **Edges:** "blocked by 51" is not needed, because 51 is `resolved`. **New edge 54 ← 59.** The refreshed sheet is a user-visible change, so it joins 54's "harness configs refreshed on the next setup/integrate" item and spec §16's release-notes list. **Acyclic:** 59 has no blockers, so no edge into 54 can close a cycle.
- **Part (a) moves to a new ticket, 63** (next free number), "Proxy-side effort normalisation on native `/v1/messages` (Claude Code effort for `glm-*`)". Model sol, Risk medium.
  - **Triage role:** `needs-info`.
  - **EVIDENCE MISSING:** the live-probe result. For `glm-5.3` and `glm-5.3-flash`, on native `/v1/messages` through the real upstream, what does the upstream do with `output_config.effort` ∈ {`low`, `medium`, `high`, `xhigh`, `max`}? For each value it must show: accepted, rejected (status and error body) or silently mapped; and the thinking tokens actually used. It must also show whether the paired thinking budget changes the outcome. B2 forbids this run from using real credentials, so this can only be an owner action.
  - **Conditions while it waits:**
    1. `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` stays off for `glm-*`. Ticket 51's unchanged guard and its mutant-tested assertion stay in force.
    2. The orchestrator writes the exact probe commands into OWNER-ACTIONS.md. They use the owner's own login on the owner's machine, and they put no key, token or account data in the file or the expected output (B2, C6).
    3. When the result arrives, 63 returns to `needs-triage`. That triage must also answer C2: users who set the variable themselves get pass-through today, and normalisation would change the bytes sent for them.
  - **Edges:** none now.
- **Label:** 59 → `ready-for-agent`; 63 → `needs-info`. INDEX.md gains the row for 63 and the new title for 59.

**Rationale:** The two parts share an origin (ticket 51), but nothing else. (b) is a verified false statement with a one-line fix and the migration pattern that tickets 50 and 51 already used. (a) depends on a fact only the owner can produce. Kept in one file, (b) would wait on (a) for no reason, and the edge 54 ← 59 would block the release notes on an owner action. Keeping number 59 for the actionable part keeps existing references stable (the Round 5 precedent of ticket 58). The round's "no edges" for (b) missed C2's rule that every user-visible change is announced.

**Charter:** C2 (generated state refreshed through the transaction, idempotent, reversible; changes announced), C3 (no false user-facing text), C6 and B2 (no credentials in this run), C8, C9 (smaller blast radius; simpler), Round 1 Q18, Round 5 (number stability).

**REVERSIBILITY:** Two-way door. ADR: no.

---

## Q3 — Ticket 61: S1/stalled on Windows, response-side proxy memory

**DECISION:** ACCEPTED with conditions. The recommendation's stage 2 is in fact architecture candidate 6, which the round does not say. This answer names it and **explicitly amends Round 1 Q2 (#6 "do nothing")** and spec §Out of Scope line 809, conditionally, on the trigger Round 1 Q2 itself named. The edge set is changed.
- **Triage role:** `ready-for-agent`. Model sol. **Risk high**: Round 7 Q3 filed it as high, and the ticket file's "medium" is drift that is corrected here. ADR no.
- **Fact corrections for the ticket text.**
  - The 452.3 MB commit peak (275.0 MB sampled WS; max commit sample 437) comes from the Windows reference run **42265988296** (METRICS.md line 223, Round 7), not from 42281731448. Run 3 gave 444 commit / 283.8 sampled WS.
  - **EVIDENCE MISSING:** the "328-ish WS in later runs" figure. No file in the tracker carries it, so the ticket must not cite it unless the artefact is named. The decision does not depend on it.
  - Linux control: HWM 165 MB, heap 6 MB after idle (METRICS lines 34 and 59).
- **Criteria.**
  1. **Stage 1, attribution on windows CI**, using ticket 09's paired mode and an off-by-default marker. The marker lives in the test loop only: no new product config key or env var, and any product-side probe uses the existing debug/event-line logging. The run records MB per stalled reader (commit and WS) on the same commit on both legs, split into these buckets:
     - (i) the `tee()` stats branch queuing for a slow client (`handler.ts:423/433/441`; candidate 6's stated problem);
     - (ii) the proxy writing into a client socket that is not draining (Bun's per-socket send buffering);
     - (iii) upstream-fetch response buffering;
     - (iv) the Bun-on-Windows baseline (the commit floor of about 113–188 MB recorded in Round 7).
     The buckets must account for the Windows peak above idle to within ±20 %. Otherwise the attribution is inconclusive, and the ticket comes back with numbers.
  2. **Stage 2, only if (i) or (ii) carries the excess.** The fix restores backpressure from client to upstream: the upstream is read no faster than the client drains, and the stats are observed in the client's path (candidate 6's single response-body module).
     - It may not cap response bytes, limit the number of open streams, shed or end a stalled stream, or return 503 for it. Round 1 Q5 condition 2 stays intact.
     - The bytes and event order delivered to the client are unchanged. A reader that resumes within the existing timeouts receives the full answer, and a test proves it.
     - Request-row and `--json`/stats field names and meanings are unchanged. If a timing field's meaning would change (for example, total time measured at client pull speed), the ticket comes back before it ships.
  3. **GREEN means:**
     - `S1/stalled` (windows) is GREEN on the WS gate (≤ 250 MB peak) and under the 512 MB commit backstop (Round 7 Q1 condition 2);
     - **delete `S1/stalled` (windows) from `expected-red.json`**;
     - Linux S1/stalled stays GREEN with no HWM regression;
     - S1/short, S1/burst*, S1/bigbody and S7 do not regress on either leg.
  4. **If the excess sits in (iii) or (iv),** or in Bun internals with no proxy-side lever, the ticket comes back with the numbers. The entry stays, so 55's empty-list criterion is then blocked, and that is an owner question. §9's 250 MB is never loosened.
  5. **B1:** if the stream handling touches anti-abuse modules, only lifecycle and backpressure change there.
- **Label:** `ready-for-agent`.
- **Edges.**
  - Keep 61 ← 02 and 55 ← 61.
  - **61 ← 19 accepted:** both change the proxy's request/response handler.
  - **New edge 61 ← 20:** 20 edits the same handler and runs a ≥ 20-repetition S1/burst1 measurement on both legs. A response-path change landing in parallel would conflict in `handler.ts` and confound that measurement. Stage 1 then also attributes the code that stage 2 will change.
  - **Acyclic, checked.** 61's only descendant is 55, and nothing depends on 55. The ancestors of 19 and 20 are 19, 13, 14, 12, 11, 10, 09, 02, 03, 04 and 01, and 55 is not among them. No cycle forms.

**Rationale:** The Windows result is RED on both metrics with no owner, and Round 7 Q3 required triage with numbers. Measuring first follows C9: stronger measured evidence wins. The code evidence points straight at candidate 6. Its problem statement is the `tee()` stats branch that "queues without bound" for a slow, still-connected client. Round 1 Q2 dropped #6 only because the burst peak was attributed to body copies and Linux stalled readers retained 6 MB. It made #6 conditional on stream-buffering attribution. If stage 1 shows that attribution on Windows, the condition Round 1 Q2 set is met, so building #6 inside 61 follows that decision's own logic rather than contradicting it silently. I record the amendment here so that spec line 809 and DECISIONS stay consistent. Backpressure bounds memory without refusing work, which is why Round 1 Q5 stays intact. A byte cap or a stream limit would not leave it intact.

**Charter:** C1 (bounded memory; degrade by backpressure), C2 (client bytes and fields unchanged), C7 (primary platform RED), C9 (measured evidence; reversible), §9 (no loosening), Round 1 Q2 (amended conditionally), Round 1 Q5, Round 5 Q2, Round 6 Q2 condition 1, Round 7 Q1 and Q3, B1.

**REVERSIBILITY:** Two-way door (an internal response-pipeline module behind unchanged contracts). ADR: no. The conditional amendment of Round 1 Q2 / spec line 809 is recorded in DECISIONS and RUNLOG.

---

## Shared understanding

CONFIRMED for Q1–Q3, with these branches that come back as questions with numbers when they occur:
- 57's stage 2 cannot turn `S5/restart` GREEN, or the 3-per-15-min default refuses tool calls in a way the measurement shows to be harmful;
- 63 (effort normalisation) returns to `needs-triage` when the owner's probe result arrives, including the C2 pass-through question;
- 61's attribution puts the Windows excess in Bun or upstream buffering (iii/iv) or is inconclusive. The `S1/stalled` windows entry then cannot be deleted, and 55's empty-list criterion becomes an owner question;
- 61's stage 2 would change the meaning of a timing or stats field;
- 56, if accepted, needs ordering against 57.


---

# Round 13 (2026-11-07) — windows S5/short re-listed as bounded unstable


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–12 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only, on the integration worktree at 4740ef1:
- DECISIONS.md Round 6 Q1–Q2, Round 7 Q1 and Q3 (with its Shared understanding), Rounds 8 and 9 in full, Rounds 10–11 (how the earlier flips came back), Round 12 Q1 (edge 57 ← 30).
- `issues/30-*.md`, `13-*.md`, `36-*.md`, `55-*.md`, `INDEX.md`; `METRICS.md` lines 43, 64 and 233; spec §18 rows "S1–S5 growth" and "S5 MCP bridge" (lines 632 and 644).
- Code, for the facts only: `tests/memory/lib/verdict.mjs:67-148` (`growth()` and the growth check), `tests/memory/lib/budgets.mjs:10-11, 32, 96-97` (`MEMORY.growth`, `MEMORY.S5`, `growthBudget`), `tests/memory/lib/ratchet.mjs:18-114` (the `UNSTABLE` allow-list and the listed-repeated rule), `tests/memory/scenarios/s5-mcp.mjs`, `tests/memory/expected-red.json`.
- Run 42404639968: all jobs green except `memory-budget (windows-latest)`, which fails on exactly one ratchet line, `S5/short: RED but not listed in expected-red.json (windows)`. I downloaded both legs' artefacts (into an empty scratch directory outside the worktree) and read `S5-short/*/summary.json`.
- The windows and ubuntu `memory-budget` job logs of every CI run since 42252896054 that ran the full short profile (`gh api …/actions/jobs/<id>/logs`, S5 lines only). The three S1-only measurement runs (42316982634, 42347506810, 42352122623) have no S5 line.

**Corrections to the round's facts.**
1. **The history is 28 windows runs, not 17.** The round's 17 values skip nine runs in the same period, mostly on the integration branch: 42398294952 (17.28), 42392375847 (21.62), 42384925753 (14.97), 42382114395 (**25.29**), 42378479007 (16.75), 42367395231 (15.64), 42338973997 (**23.57**), 42330994104 (15.88), 42281646419 (20.73). The 28 include Round 7's runs 3 and 4 (26.24 and 22.01). Recomputed on commit, the gate metric (Round 7 Q1 condition 1): n = 28, min 14.27, median 18.25, mean 19.04, sd 3.43, **max 26.24** (run 42252896054, which Round 7 Q3 itself cited), not 23.71. All 28 are above the 5 %/1k budget. The verdict is RED in 1 of 28 (3.6 %; the 95 % Clopper-Pearson upper bound is 15.9 %), not 1 of 17 (~6 %). A plain listing would fail 27 of 28 runs.
2. **The trend flag has two branches, not one.** `verdict.mjs:146`: trend = a trailing strictly rising run of ≥ 3 windows (each > 1 % above the one before) **or** a net rise ≥ 10 % from the first to the last post-warm-up window. RED = over budget AND trend (`:147`). In the RED run the window medians are 77.5, 78.3, 80.2, 80.0, 81.6, 82.6 MB: the rising-run branch fired (80.0 → 81.6 → 82.6), and the net rise was 6.6 %. On Linux the same run's medians are 88.0 → 99.3 MB, the net-rise branch fires (12.8 %), and the rising run is 0.
3. **Linux is a stable RED.** Linux `S5/short` growth:mcp-bridge is RED with trend in 26 of 26 runs: 38.21–46.33 %/1k, mean 42.58, sd 1.99.
4. **The `unstable` code path cannot take this key as built.** `validateExpectedRed` accepts `unstable` only for a key in `UNSTABLE` that also has a `REPEATED` rule (`ratchet.mjs:64`), and its only bound is `maxMedianMB`. `S5/short` is a single run with no median. The recommendation therefore needs a second bound kind, not one more key.

What the numbers mean: the windows bridge grows during the 400-task load in every run, at 4–5× the budget. Linux shows the same signature at roughly twice the rate (19 vs 42 MB per 1,000 tasks in run 42404639968). The windows "GREEN" in 27 of 28 runs is the trend detector missing a slow climb under Windows commit noise. It is not an absence of growth. Round 7 Q3 condition 2 already said so ("GREEN under spec §18's slope-plus-trend rule only").

---

## Q1 — windows S5/short: the growth value is over budget in every run, the verdict flips on the trend flag

**DECISION:** REJECTED in part. Accepted: windows `S5/short` is the same defect as Linux `S5/short`, owned by ticket 30, and it is listed again under a bounded, allow-listed non-binary state. Every other S5 check must stay GREEN. The 5 %/1k budget, the `growth()` rule, and every other entry on both legs stay as they are. Rejected: (i) letting a growth value ≤ 5 %/1k pass silently while the entry is listed; (ii) ticket 30's exit as "≥ 10 windows runs GREEN on growth:mcp-bridge", because today's verdict is already GREEN in 27 of 28 runs, so that exit is met with no fix at all; (iii) the bound's justification "the highest of 17 values is 23.71". The bound of 30 stays, justified on the 28-run history below; (iv) landing the change on ticket 65's branch.

**This explicitly contradicts:**
- **Round 9 Q1 condition 3** ("an allow-list of one key in code"; "`unstable` is not extended to it"). The allow-list gets a second key, with a bound kind of its own. Round 9 condition 3 also said that any other scenario in a middle band "comes back as its own question with its own distribution". This round is that question, and the distribution is the 28-run history above. So this is the intended return path, not a silent extension.
- **Round 10 Q1** ("Round 9 condition 3 stands") and **Round 11 Q1 condition 2** ("the `unstable` allow-list of one key"), for the same reason.
- **Round 6 Q2 condition 3** and **Round 7 Q3 condition 2** ("nobody edits the list a second time"). Both send a disagreeing windows run back as a question. This answer authorises exactly **one** further list edit, adding the windows `S5/short` entry. No later run, job or ticket edits it except ticket 30's exit (condition 4).
- **Round 6 Q1's rationale** ("simpler than a flaky-entry mechanism"), as Round 9 already did.

It does **not** contradict Round 6 Q2 condition 1 (owner): ticket 30's acceptance already reads "Loop S5: growth ≤ 5 %/1k … **Delete `S5/short` (linux, windows)**". Round 7 Q1 condition 1 stands: growth is gated on commit, and WS is reported only. Spec §18's slope-plus-trend rule is unchanged for every scenario and both legs.

Binding conditions:

1. **What the windows entry accepts.** The value is `{ "ticket": "30", "state": "unstable" }` (exact shape is the implementer's choice, in one place). The ratchet judges this key on the **value** of `growth:mcp-bridge` on commit, not on its RED/GREEN outcome:
   - 5 < value ≤ 30 %/1k passes, with the trend either `true` or `false`. Each passing run prints `S5/short: unstable (growth:mcp-bridge <x> %/1k commit, budget 5, bound 30, trend <t>), owned by ticket 30` in the job summary and the report rows.
   - **value > 30 fails** the ratchet (a step change).
   - **value ≤ 5 fails** the ratchet as "at budget but listed for ticket 30". The ratchet's meaning holds: an entry is RED until its owner's fix. 0 of 28 values are ≤ 5 (min 14.27; normal fit z = −4.1), so this case cannot flake. If it fires before ticket 30 lands, for example after ticket 36's semi-space flag, the run's numbers come back as an ownership question. Nobody edits the list.
   - **Any other RED fails, listed or not:** `procPeak:mcp-bridge` (WS gate, 150 MB), `orphans`, `bridge:reboot-cost-of-history` (20 MB), `bridge:task-failures` (0), a harness failure, a missing `@@JOB applied=1`, a failed units self-test.
   - **A growth check that is `insufficient`, or that has no value, or no `mcp-bridge` process in the load window, fails** as a measurement gap (Round 6 Q2 condition 2).

   This is stricter than both alternatives. Today, with no entry, a windows growth of any size passes whenever the trend flag is false (27 of 28 runs). A plain listing would accept any RED on any S5 check.
2. **The bound of 30 %/1k (commit) is evidence-backed, not a budget.** It sits 3.76 above the highest of 28 values (26.24). The per-run probability of a value above 30 is ≈ 0.07 % on a normal fit (z = 3.20) and ≈ 0.39 % on a log-normal fit. Both are well inside the 5 % false-RED line of Round 6 Q1 condition 2. A distribution-free bound from 28 runs cannot show < 5 % for any value (its 95 % upper bound for "above the observed max" is ≈ 10 %). That is why I record the model, so the bound is not mistaken for a guarantee. The bound catches a rise of ~1.6× the mean slope, and Linux's 38–46 %/1k would fail it. WS growth (13–41 %/1k) is reported and not judged (Round 7 Q1 condition 1). The bound disappears with the entry.
3. **One allow-list in code, two keys, each with its own bound kind.** `UNSTABLE` holds windows `S1/burst1` (median bound 300 MB, Round 9) and windows `S5/short` (growth-value band 5 < v ≤ 30 on `growth:mcp-bridge`). The schema check rejects `unstable` on any other key, on `linux` `S5/short`, and a `S5/short` entry carrying a median bound or a `S1/burst1` entry carrying a value band. The ratchet tests pin RED → GREEN at least:
   - 23.71 with trend `true` passes, and 15.55 with trend `false` passes;
   - 30.01 fails, and 4.9 fails;
   - a growth value in the band with `orphans 1`, `task-failures 1`, reboot cost 21 MB, or `procPeak:mcp-bridge` 151 MB WS fails;
   - an `insufficient` growth check fails;
   - `unstable` on `linux` `S5/short`, or on any third key, is a schema error;
   - the existing `S1/burst1` cases are unchanged.

   Any further scenario that disagrees with its list comes back as its own question, and `unstable` is not extended to it automatically.
4. **One owner, one exit.** The entry leaves the list only through ticket 30. Ticket 30's criteria change:
   - The windows deletion needs **every one of ≥ 10 fresh windows `S5/short` runs** on ticket 30's tree to have `growth:mcp-bridge` ≤ 5 %/1k on commit, **whatever the trend flag says**, and every other S5 check GREEN. Each run records commit and WS values, trend, window medians and sample count. They run through an off-by-default measurement mode restricted to S5, as the S1 mode does (Round 8 condition 2). The runs may span more than one CI run of the same tree to fit the windows timeout (≈ 12 min per S5 run). The deleting commit cites them, and METRICS.md and ticket 30's Comments record them.
   - The same commit removes the `S5/short` key from `UNSTABLE`.
   - The Linux deletion stays on the normal verdict, as today.
   - If ticket 30 cannot reach ≤ 5 on windows, it comes back with numbers. The budget is never loosened.
   - No single job run, and no other ticket, ever edits this entry (Round 6 Q2 condition 3 and Round 8 condition 4 stand).
5. **Ticket 55 needs no new edge.** It is already blocked by 30, and its criterion "no `unstable` entry remains … allow-list removed" already forces the exit. Its text "(windows S1/burst1 only, Round 9 Q1)" becomes "(windows S1/burst1, Round 9 Q1; windows S5/short, Round 13 Q1)".
6. **Where it lands: its own small ticket, not ticket 65.** File ticket 66 (next free number), "Ratchet: windows S5/short listed for 30 with a growth-value band", `Status: ready-for-agent`, Model glm, Risk low, ADR no, blocked by nothing. INDEX.md gains its row. Its only content is conditions 1–3, the list edit and the tests. Ticket 65 does not own this key, and putting the change on its branch would let a revert of either undo both (C9, smaller blast radius).
   - One pre-merge CI run of 66 alone confirms. It does not decide. "Disagree" means any ratchet failure in condition 1 on windows `S5/short`, or anything else RED that is not listed. On disagreement the numbers come back, with no rerun-until-green.
   - Then 65, 12, 32 and 42 are restaged on the new tip, and each gets its own pre-merge run as usual. **Run 42404639968 is not counted as a ticket 65 failure**, because its only RED is the key this round decides. A restaged run on a changed tree, after a cause decided here, is not a rerun-until-green. RUNLOG records that, naming this round.
7. **Nothing else changes:**
   - the 5 %/1k growth budget, `MEMORY.growth` (`risingWindows: 3`, `netRisePct: 10`) and `growth()`;
   - the S5 budgets (150 MB, 20 MB, 0 failures);
   - Round 7 Q1's metric split;
   - the `linux` list, including `S5/short → 30`;
   - every other `windows` entry, including the `S1/burst1` bound and n = 7.

   Alternative (a), a trend-free growth rule on windows, is not adopted. It changes spec §18 for every growth check on the primary platform, with no S1–S4 distribution to show what it would turn RED. Its stable plain listing would also accept any RED on S5, which is the gap Round 9 closed.
8. **Records.**
   - Spec §18 (S5 row) records the band, its bound and its only exit as a measurement-rule amendment.
   - RUNLOG records this as a deviation from Round 9 condition 3, Round 10 Q1, Round 11 condition 2, Round 6 Q2 condition 3 and Round 7 Q3 condition 2, naming this round.
   - METRICS.md gets the 28-run windows table and the 26-run Linux table, with run ids, commit and WS values and trend.
   - Ticket 30's Comments name the entry's state, its bound and its only exit.

**Rationale:** The numbers settle what the defect is: 28 of 28 windows runs grow at 14–26 %/1k against a 5 %/1k budget, with the same signature as Linux's stable 38–46 %/1k RED. So the entry belongs to the Linux owner, and ticket 30's own text already claims both legs. What is unstable is not the defect but the trend detector on Windows commit. That makes every binary option wrong:
- With no entry, the run is RED ~3.6 % of the time (up to ~16 % at 95 %) on a defect that no queued ticket touches. Under the no-rerun rule, that blocks four merges at random.
- A plain listing fails 27 of 28 runs.
- Waiting for ticket 30 leaves that random block on the critical path until 13 and 30 land.

The recommendation is right on the core: judge the value, bound it, keep the other S5 checks hard, and tie the exit to 30 and 55. It needed three corrections to be safe:
- **The bound's evidence.** The real maximum is 26.24, not 23.71, and 30 still holds with ≈ 0.1–0.4 % per-run risk.
- **The silent pass at ≤ 5.** It would let a fix land under the wrong owner unnoticed.
- **The exit.** An exit on "GREEN" would be met by today's broken code in 27 of 28 runs, so it has to be judged on the value regardless of trend.

Judged on the value, with a ceiling it lacks today, the windows S5 gate becomes stricter than the status quo and costs no budget. Keeping it in its own ticket keeps every other ticket's pre-merge run about that ticket.

**Charter:** C1 (bounded bridge growth: a regression bound plus hard procPeak, orphan, reboot-cost and failure checks where none bind today), C7 (Windows primary: a gate that holds without lying; Linux unchanged), C9 (stronger measured evidence: 28 windows and 26 Linux runs; then the smaller blast radius: one key in the ratchet, not a rule change for every growth check, and its own ticket), §9 (5 %/1k unchanged; the band only tightens), Round 6 Q1 condition 2, Round 6 Q2 conditions 1–3, Round 7 Q1 condition 1, Round 7 Q3 condition 2, Round 8 conditions 2 and 4, Round 9 conditions 1–5 and 7, Round 11 condition 3, PROMPT §7 Phase 4 (no spurious reverts or blocked merges).

**REVERSIBILITY:** Two-way door (test code, one list entry, ticket text and one new small ticket). ticket 30 removes the state, and ticket 55 guards it out for good. ADR: no.

---

## Shared understanding

Open branches I still see (none blocks ticket 66 or the queued merges):
- **Can ticket 30 turn S5/short GREEN at all, on either leg?** Its eviction acts at > 500 terminal tasks, while `S5/short` runs 400, and METRICS.md line 43 measures only ~4 KB of heap retained per task (≈ 1.6 MB for 400 tasks), against an RSS/commit climb of ~5–12 MB. **EVIDENCE MISSING: an attribution of the S5 bridge growth (JS heap vs native/allocator vs V8 semi-space).** Ticket 36's `--max-semi-space-size=1` also claims "S5 within budget". If 30 cannot reach ≤ 5 %/1k on either leg, or if 36 lands first and drives windows to ≤ 5 (condition 1's ownership failure), the ownership of both `S5/short` entries comes back as a question with numbers.
- **Plain listings still accept any RED on a listed non-repeated key** (the gap Round 9 found, closed only for repeated keys and now for windows `S5/short`). For example, Linux `S5/short → 30` would pass an orphan or a task failure as "expected RED". This round does not decide it; it may come back as its own question.
- These come back with numbers when they occur: a windows `S5/short` value > 30 or ≤ 5, or any other S5 RED, after a later merge; ticket 66's pre-merge run disagrees (condition 6); ticket 30 misses the ≥ 10-run windows exit.


---

# Round 14 (2026-11-07) — triage of tickets 67 and 69


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–13 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only, on the integration worktree at aa049c3:
- `issues/67-*.md`, `69-*.md`, `55-*.md`, `INDEX.md`, `docs/agents/triage-labels.md`; ticket 68's Comments, which exist only on `ticket/68-crlf-config-writers` / `staging/68` (70046f2). On the integration tree, 68's Comments section is empty. 68 is `ready-for-agent`, implemented and staged (PR #27, run 42421432504), and not merged.
- DECISIONS.md Round 3 Q8 (the ratchet), Round 9 Q1 with its gap paragraph and condition 1, Round 13 Q1 with its Shared understanding, Round 2 Q10 (release-notes list), and the B1 rulings of Round 1 Q3, Q17 and Round 2 Q2/Q3.
- PROMPT.md §5 B1–B6.
- `tests/memory/lib/ratchet.mjs` (all 198 lines), `tests/memory/lib/budgets.mjs:53-55` (`REPEATED` holds `S1/burst1` only), `tests/memory/job.mjs:151, 220` (each run's `redChecks` is in the job summary rows and in `summary.json`), `tests/memory/expected-red.json`.
- `zcode-proxy-src/src/index.ts:205-213, 546-551, 590, 1032-1078`, `tui/app.ts:51-58`, `config/loader.ts:130-143, 405-425`, `proxy/identity.ts:55-59, 120-125, 184`, `config/template.ts:89`, `index.test.ts:108-170`.

**Corrections to the round's facts.**
1. **Q1: the plain single-run entries also include windows `S1/stalled → 61`.** Every linux entry is plain and single-run (linux `S1/burst1` is not listed). On windows, every entry is plain and single-run except `S1/burst1` (repeated, `unstable`) and `S5/short` (`unstable` growth band). Both of those already reject any other RED.
2. **Q2: the misread device ID is not sent upstream today.** All four callers of `ensureDeviceMidInConfig` discard its return value: `serve` (`index.ts:210`), `claim` (`:550`), `auth login` through `ensureConfigWithDeviceMid` (`:590`), and the TUI (`tui/app.ts:55`). The value that reaches the headers comes from `loadConfig`'s YAML parse. That parse reads `deviceMid:` (empty, unquoted) as `null`, which `resolveIdentity` (`loader.ts:423-424`) treats as absent. So, today, a config with an empty unquoted `deviceMid:` behaves like this:
   - the function returns the misread `appVersion: "3.8.1` and writes nothing, because it took the value as non-empty;
   - the proxy runs with **no** device mid: no `X-Device-Mid` on control-plane requests (`identity.ts:184`), and no `device_id` in the metadata user id.
   Every other spelling ends up with a mid:
   - `deviceMid: ""` is filled in place;
   - a missing key is inserted under `identity:`;
   - a missing `identity:` block is appended.
   Ticket 69's text ("which then becomes X-Device-Mid") and 68's "Left for another ticket" note are wrong on this point. The recommendation's "no different upstream request for any well-formed config" is also inaccurate: `deviceMid:` is well-formed YAML, and after the fix that config does send a mid. The claim holds for every other form.
3. **What the empty-quoted path does today** (`index.ts:1060-1077`): an empty value leads to a fresh `randomUUID()`. The matched line is replaced in place with `<indent>deviceMid: "<uuid>"`, the file is written back (on 68's branch, with its own line endings), `Device identity generated: <first 8>… (stored in <path>)` is logged, and the UUID is returned. It is generated once and reused afterwards.

---

## Q1 — Ticket 67: a plain expected-RED listing of a single-run key accepts any RED

**DECISION:** ACCEPTED with conditions; one part REJECTED. Role: **`ready-for-agent`**, Model sol, Risk medium, ADR no. Blocked by: none. New edge: **55 ← 67**.

Accepted: every plain listing of a single-run key names the checks it owns. A RED on any other check fails the ratchet. An owned check may be GREEN, and the entry is deleted only when the run is GREEN, as today.

Rejected: building `owns` as "the union of the RED checks seen in the last N runs" and nothing more. A union adopts every RED it has seen, including an orphan, a second proxy or a ceiling breach that belongs to a different defect. That turns today's silent pass into a silent recorded ownership. It also leaves N undefined.

Binding conditions:
1. **Schema.** A listed single-run key that is not `unstable` takes `{ "ticket": "<NN>", "owns": ["<check>", …] }`. The exact shape is the implementer's choice, in one place. These are schema errors:
   - a plain string or number for a single-run key;
   - an empty `owns`, a duplicate name, or a non-string name.
   Repeated keys keep Round 9 Q1 condition 1 (median only). The two `unstable` keys keep Round 9 Q1 and Round 13 Q1 unchanged. `owns` on either of those is a schema error.
2. **Ratchet rule** for a listed single-run entry with `owns`:
   - RED with every RED check in `owns` passes. The job summary row prints `<key>: RED on <checks>, owned by ticket <t>`, so what is tolerated stays visible.
   - RED on any check not in `owns` fails, with this message: `<key>: RED on <check>, not owned by ticket <t> (<os>, Round 14 Q1); the RED comes back as an ownership question, do not edit owns`.
   - RED with no RED check named fails.
   - GREEN fails as "GREEN but listed", as today.
   - A harness failure fails, as today.
   - An owned check name that the run does not produce at all fails as a stale or mistyped name. This follows Round 3 Q8 condition 2: a stale entry cannot hide a RED.
3. **How `owns` is derived. Each key on each leg needs both conditions below:**
   - **(a) Evidence.** At least 10 valid runs of the leg's full short profile on code whose scenario, `verdict.mjs` and `budgets.mjs` for that key match the tree 67 merges onto. Use pre-merge staging runs and history first. Where fewer than 10 exist (for example S3/hung after ticket 65), run the job on 67's branch until there are 10. Record the run ids and each run's RED set per key in 67's Comments and in METRICS.md.
   - **(b) Ownership.** Every check in `owns` is traced to a line of the owner ticket's text: its acceptance criteria or its What-to-build. The line is cited in 67's Comments. A check the owner's criteria name explicitly may be included even if no recorded run showed it RED. This lowers the false-RED risk of a rare owned check without masking anything outside the owner's claim.
   - **Rule.** A check that is seen RED but cannot be traced to the owner does not go into `owns`. Typical cases: an orphan on a key whose owner is not a lifecycle ticket, or a check that a different open ticket claims. These come back to the Owner Proxy as an ownership question with the run ids before 67 merges. They are never folded in silently. If such a question is open for one key, the other keys may still land.
4. **The list only shrinks.** After 67 merges, an `owns` list can only lose names, and only in the owner ticket's own commit, with its evidence. An unowned RED in a later run follows the existing rules: no rerun-until-green, and the numbers come back as a question (Round 6 Q2 condition 3, Round 8 condition 4, PROMPT §7 Phase 4). No run or job edits `owns`, and no other ticket does either.
5. **Tests**, RED first, in the ratchet/verdict suite:
   - a plain string entry for a single-run key is rejected;
   - an owned RED passes and an unowned RED fails;
   - owned GREEN plus unowned RED fails;
   - GREEN while listed fails;
   - a stale owned name fails;
   - `owns` on `S1/burst1` or windows `S5/short` is rejected;
   - every existing Round 9 and Round 13 case passes unchanged;
   - one case per leg uses the real `expected-red.json`.
   67's pre-merge CI run confirms the change; it does not decide it. If any `owns` disagrees, the numbers come back. Nobody widens `owns` to make the run green.
6. **Edge 55 ← 67.** The empty-list guard and the removal of the allow-list land on the stricter schema. Then 55's guard also rejects a re-added `owns` entry. 67 has no blockers, so the edge cannot close a cycle. Owner tickets that delete their whole entry are unaffected and gain no edge.
7. **Nothing else changes:** every budget, ceiling, n, the `growth()` rule, Round 7 Q1's metric split, the two `unstable` bounds, and which keys are listed.

**Rationale:** Round 9 found and closed this gap for repeated keys, and Round 13 closed it for windows S5/short. Every other entry still accepts any RED, so on 22 entries an orphan, a second proxy or a ceiling breach passes as "expected". Those are the C1 checks this run exists to prove. Per-entry ownership is the smallest change that closes the gap, and it keeps the ratchet monotonic.

The union-only derivation is wrong for the same reason the plain listing is: it accepts whatever happened to be RED. Combining observed evidence with the owner's text makes the list both measured and attributable. The 10-run floor bounds the false-RED risk: a check RED in at least 26 % of runs is seen with 95 % probability. The owner-claimed inclusion covers rarer owned checks. Any remaining flake comes back as a question rather than as churn.

**Charter:** C1 (orphan, single-proxy and ceiling checks enforced where today's listing masks them), C7 (both legs, per-leg lists), C9 (measured runs plus attribution; one schema change in one file, two-way), §9 (no budget touched), Round 3 Q8 conditions 1–3, Round 6 Q2 condition 3, Round 8 condition 4, Round 9 Q1 conditions 1 and 5, Round 13 Q1 conditions 1, 3 and 7, and Round 13's Shared understanding (this is that branch returning).

**REVERSIBILITY:** Two-way door (test code, list shape, ticket text, one edge). ADR: no.

---

## Q2 — Ticket 69: `ensureDeviceMidInConfig` reads past an empty unquoted `deviceMid:`

**DECISION:** ACCEPTED with conditions and a corrected rationale. Role: **`ready-for-agent`**, Model sol, Risk high, ADR no. Blocked by: **68** (kept). New edge: **54 ← 69** (release-notes line).

**B1 scope ruling: IN SCOPE, as error handling.** The defect is a parse error: the separator `\s*` after `deviceMid:` crosses a line break. Because of it, the function and the proxy's own loader read the same file differently:
- the loader says "empty";
- the function says "already set" and skips its fill.

The fix makes the function agree with the loader. Then the empty unquoted form takes the existing empty-value path exactly as `deviceMid: ""` does, which is also what the missing-key and missing-block forms already get. Nothing new is added:
- no new ID source;
- no new generator or format;
- no new header or request field;
- no change for any other form.

So it does not raise pass rates or add a rotation strategy. It does not make the client look more like the official one beyond what the existing mechanism already does for every equivalent config.

The corrected impact: configs that use the empty unquoted spelling will now get a mid persisted and send it, where today they send none. That is the designed self-heal (`index.ts:548-549`) reaching the one spelling that misses it. It is not a new behaviour.

Binding conditions:
1. **The only code change.** The reader takes the value from the rest of the `deviceMid:` line only. The separator stops crossing a line break, including CRLF (`\r`). The exact regex is the implementer's choice. Unchanged:
   - the indent capture, the quote stripping and the fill/insert/append branches;
   - `randomUUID()`, the written line format and the log line;
   - 68's line-ending handling.
   Out of this ticket (residual forms, see Shared understanding):
   - trailing-comment values (`deviceMid:  # x`, `deviceMid: "x" # y`);
   - `~` / `null`.
2. **Tests (Bun, temp-file fixtures only, B2/B3).** Forms, each in LF and CRLF:
   - quoted value;
   - unquoted value;
   - empty quoted;
   - empty unquoted followed by another key;
   - empty unquoted with trailing spaces;
   - empty unquoted as the last line, with and without a final newline;
   - missing key under `identity:`;
   - no `identity:` block.

   For every form:
   - **(a)** after `ensureDeviceMidInConfig`, `loadConfig(path).identity.deviceMid` equals the returned value (the reader/loader agreement);
   - **(b)** a second call returns the same value and leaves the file byte-identical;
   - **(c)** the file keeps its line endings (68's contract).

   Pin the generated UUID (inject or stub `randomUUID`) so outputs can be compared byte for byte.
3. **Proof that nothing else changed.** Run the new tests against the pre-fix function, restored from the parent commit. Only the empty-unquoted cases may fail: on the return value, the fill, and the loader agreement. Every other form must pass there with byte-identical file output, return value and `buildIdentityHeaders` output. Record both runs (RED log name, then GREEN) in 69's Comments. The existing `index.test.ts` deviceMid tests stay unchanged.
4. **Correct ticket 69's text** in the same change, following correction 2 above: today the misread value is returned and discarded, and the config sends no mid. No existing caller changes, and no caller starts using the return value.
5. **C2/C8 announcement.** On a config with an empty unquoted `deviceMid:`, the proxy will now write a generated mid into the user's `config.yaml` on its first `serve`/`claim`/`auth login` after the update, as it already does for `deviceMid: ""`. Ticket 54's release notes say so in one line. The orchestrator records it in 54's Comments when 69 closes. The edge 54 ← 69 follows the ticket 59 precedent: 59 is a direct edge on 54 for its own release-notes line.
6. **Edge 69 ← 68 stays.** 68 changed the same function's writer (line endings) and is staged but not merged. 69 lands on top of it.

**Acyclicity.** 69's ancestors are 68 ← 42 ← 08 ← 07, 10 ← … ← 01, 02, 03, 04, 05, 06, 09. None of them is 54, and none depends on 54 or 69. 54 has no dependents. Adding 54 ← 69 closes no cycle.

**Rationale:** B1 forbids changing how anti-abuse code behaves. Its IN SCOPE list allows error handling and tests. The behaviour of this code is defined by its contract ("fills an empty `deviceMid:` value") and by the loader it feeds. Today, one YAML-equivalent spelling of "empty" falls through that contract because of a regex that crosses lines. Restoring the contract for that spelling is error handling.

The test that keeps it inside B1 is condition 3. Every other input must produce byte-identical results before and after, so the change cannot reach any config the run did not intend. "Do nothing" (C9) was considered and rejected. The function's return value is wrong today, and the affected configs silently miss the mid that the code comment says the billing gateway requires. The fix is one line with a full equivalence proof.

The recommendation was right on the scope and the test list. It needed two corrections:
- the upstream request does change, for exactly the one affected spelling;
- that write to a user-owned file must be announced.

**Charter:** B1 (IN SCOPE: error handling, tests; no OUT-OF-SCOPE effect, proven by condition 3), B2/B3 (fixtures, temp files only), C2 (every other config byte-identical; the one changed case announced), C6 (no new endpoint or data), C7 (CRLF on Windows), C8 (release-notes line), C9 (smallest blast radius: one reader expression), Round 1 Q3 / Q17 (the B1 reading: lifecycle and error handling allowed when the anti-abuse inputs and outputs stay identical).

**REVERSIBILITY:** Two-way door for the code. On an affected install, the persisted mid stays in the user's file after a revert. This is the same state that `deviceMid: ""` installs already have, so it is harmless. ADR: no.

---

## Shared understanding

Open branches I still see (none blocks this round):
- **Other `deviceMid` spellings the reader misreads on the same line:**
  - `deviceMid:  # note` returns `# note`;
  - `deviceMid: "x" # y` returns `x" # y`;
  - `deviceMid: ~` and `deviceMid: null` return `~` and `null`.
  In each case the loader reads the empty or correct value, so the reader and the loader disagree in the same way. They are not line-crossing, so they are outside ticket 69. If the orchestrator wants them fixed, they need their own `needs-triage` ticket and the same B1 question. The answer here would likely be the same, judged on its own equivalence proof.
- **Ticket 67 may find observed REDs on a key that its owner does not claim.** S2's `growth:scenario` (ticket 58 note) and S3/hung's per-leg sets are the likely cases. Those come back as ownership questions with run ids (Q1 condition 3).
- **The plain "GREEN but listed" rule still flakes where an owner's only RED check flips.** S2/short's `growth:scenario` may be such a case. That is today's behaviour, unchanged by 67. If 67's 10-run evidence shows a key whose run is GREEN in some runs on unchanged code, it comes back as its own question with its distribution (Round 9 condition 3, Round 13 condition 3). It is not covered silently by `owns`.


---

# Round 15 (2026-11-08) — ticket 67 ownership: one owner per check


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–14 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only:
- `ticket/67-owned-checks` at 6b9438c (`git -C /home/AgentKit/wt/t67 show HEAD:…`): `issues/67-*.md` (Round 14 text, implementer report, questions A–F), `METRICS.md` lines 329–408 ("RED check sets per listed single run, both legs"), `tests/memory/lib/budgets.mjs`, `tests/memory/scenarios/s2-captcha.mjs:90-130` (what `procPeak:scenario`, `growth:scenario` and `solver:cost-per-generation` measure), `tests/memory/scenarios/s3-concurrency.mjs:17-23, 108-112, 357-407` (both S3/short and S3/hung run the kill-holder round; only S3/hung runs the stale-lock round).
- `/home/AgentKit/overhaul-tools/ci-art/t67-logs/parsed.json`: I recounted every RED set per key and leg over the matching runs METRICS.md lists (13 linux, 21 windows, 5 + 5 for S3/short and S3/hung). Every count in the round matches. Log 42421424292-linux.log lines 419–436 (S2 values).
- Ticket files on the integration tree 9441486 (identical to the t67 branch for every ticket named): 15, 16, 17, 25, 27, 28, 33, 34, 35, 36, 37, 55, 58, `INDEX.md`, and ticket 01's notes item 10.
- DECISIONS.md Round 3 Q8, Round 7 Q4, Rounds 9, 13 and 14 in full. `config/template.ts:89` (the template writes `deviceMid: ""`).

**Corrections to the round's facts.**
1. **Two more open tickets claim S3 checks than the round names.** Ticket 15's AC: "S3 starter-preflight role peak ≤ 76 MB (loop)". Ticket 36's AC: "Loop: S3 bridge role peak ≤ 75 MB (baseline 86)". So `procPeak:preflight` and `procPeak:mcp-bridge` each have two claimants, with 37's "every role peak within target". Condition 2 below settles that.
2. **Round 7 Q4 condition 1 was never applied to ticket 16.** It moved 16's window-closing proof "out of the Comments into Acceptance" (a kill injected at each point between spawn and the complete record, and a forced probe timeout, on windows-latest; plus "S3/hung windows shows 0 orphans before 16 deletes S3/hung"). 16's Acceptance on the tree has neither. Its Comments hold only a one-line summary of the decision. Fact F rests on that gap.
3. **The 16/17 Comments behind fact B are measured findings, not owner text.** The 2026-11-06 line "the windows memory leg must show 0 orphans in S3" appears word for word in both 16 and 17 ("from ticket 02 round 4 Windows evidence"). The binding texts are Round 7 Q4 conditions 1 and 4.
4. **Ticket 35's Comments disclaim the S3/omp role peaks** ("if these two stay RED after the fix, ticket 35 cannot delete `S3/omp (linux)` and comes back with the numbers"). They cannot be the trace that recommendation D gives them.
5. **The recommendation's "the entry disappears when the run is GREEN" flakes as soon as one owner lands.** Recounted from parsed.json:
   - linux S3/omp is RED on `omp:concurrent-preflights` alone in 6 of 13 runs;
   - windows S3/omp is RED on it alone in 19 of 21;
   - windows S3/hung has no `orphans` and no `peak:kit` in 1 of 5.

   So after 35 (or after 16 and 17) lands, the entry is GREEN in ~46 %, ~90 % and ~80 % of runs. 37's flipping names stay RED in the rest. Under "GREEN but listed fails", every such run fails, whether the entry is kept or deleted. That is the random merge block that Round 9 and Round 13 refused. Round 14's Shared understanding (third bullet) said this branch would come back with its distribution. This is that distribution.
6. **The local runs do not match CI on the checks that flip.**
   - linux S3/hung `procPeak:preflight`: 4/5 in CI, 0/8 local.
   - linux S3/short `procPeak:preflight`: 1/5 in CI, 0/8 local. `procPeak:proxy`: 2/5 in CI, 0/8 local. `exactly-one-proxy-after-round`: 1/5 in CI, 0/8 local.

   Relevant to Q2.
7. Minor record drift: `INDEX.md` row 37 lists blockers 15, 35, 36 without 17 (Round 7 Q4 condition 4; 37's file has it). Row 65 says `ready-for-agent`, but the file says `resolved`. 69's merge (9441486) does not reset the matching runs. The memory-loop template writes `deviceMid: ""`, whose path 69 keeps byte-identical (Round 14 Q2 condition 3).

---

## Q1 — REDs on a listed key that belong to another ticket than the entry's owner

**DECISION:** ACCEPTED with conditions: per-check owners, one owner per check. Parts are REJECTED:
- (i) A's conditional / needs-triage route: I decide it, 58 owns both checks by an AC amendment;
- (ii) E's never-RED early-log name for 34;
- (iii) F's "or a measured finding";
- (iv) D's trace through 35's Comments;
- (v) the implementer's placement of windows S3/hung `orphans` under 16: it goes to 17;
- (vi) "the entry disappears when the run is GREEN" without a rule for flipping names.

No new ticket. No new edge.

**This explicitly contradicts:**
- **Round 14 Q1 condition 1** (one `ticket` per entry with one `owns`): an entry now carries owners per check.
- **Round 14 Q1 condition 2, fourth bullet**, and **Round 3 Q8** ("fails … on a listed scenario that turns GREEN"): these no longer apply to an entry that still lists a recorded flipping name (condition 4).
- **Round 14 Q1 condition 3(b)** ("the owner ticket's text"): each name is traced to its own owner's text.
- **Round 7 Q4 condition 1**, loop part only: the windows S3 `orphans` proof moves from 16 to 17. 16 keeps the seam proofs.

In each case this round is the return path that the earlier decision named ("comes back to the Owner Proxy as an ownership question", Round 14 condition 3 Rule and Shared understanding). It is not a silent extension.

Binding conditions:

1. **Schema (one shape, one place, the implementer's choice).** Every listed single-run entry that is not `unstable` maps owner ticket → check names, for example `{ "owners": { "16": [...], "37": [...] }, "flips": [...] }`. Single-owner entries use the same shape. Schema errors:
   - Round 14's list (plain string or number, empty list, duplicate, non-string);
   - a name under two owners in one entry;
   - an owner with an empty list;
   - an empty owners map;
   - an owner id with no issue file (Round 3 Q8 condition 2);
   - a `flips` name that is not an owned name;
   - owners or flips on a repeated key or either `unstable` key (Round 9 and Round 13 unchanged).
2. **Who owns a check.** Each name has exactly one owner, traced in 67's Comments:
   - **Single claimant.** A check named by one open ticket's AC or What-to-build, or by a binding Owner Proxy decision for that ticket (condition 6), belongs to that ticket.
   - **Several claimants.** The owner is the claimant that every other claimant blocks: its descendant on the blocking graph, which is the ticket whose criterion must hold for the entry to go. The other claimants' own criteria still bind them on their own evidence. If no claimant is a descendant of the others, the check comes back as a question.
   - **No claimant.** The check comes back as a question, or the Owner Proxy assigns it by amending a ticket's AC (A, below).
3. **The owners, per key and leg** (n = RED runs of matching runs; † = recorded as flipping, condition 4):

   | key | leg | owner → names | trace |
   |---|---|---|---|
   | S2/short | both | **58** → solver:cost-per-generation, solver:retained-before-recycle, procPeak:scenario, growth:scenario† (L 11/13, W 12/21), procPeak:solver† (0 RED) | 58 AC "Loop S2: per-generation cost ≤ 300 MB, retained before recycle ≤ 300 MB", amended (below) |
   | S2/short | both | **25** → cdn-cache:memory-growth | 25 AC "Loop S2: CDN memory ≤ 64 MB … stays until 58" |
   | S3/short | linux | **16** → failed-launches, stale-lock-after-round, exactly-one-proxy-after-round† (1/5); **37** → peak:kit, procPeak:launcher, procPeak:mcp-bridge, procPeak:preflight† (1/5), procPeak:proxy† (2/5) | 16 AC "Loop: S3 killed-holder round → 0 failed launches, 0 stale locks, exactly 1 proxy" (S3/short runs that round); 37 AC "Loop S3 Linux … summed-RSS ≤ 596 MB and every role peak within target", the descendant of the other claimants 15 and 36 |
   | S3/short | windows | **16** → failed-launches, stale-lock-after-round, exactly-one-proxy-after-round† (2/5); **17** → orphans† (3/5); **37** → peak:kit | as above; 17 What-to-build "Every child is reaped on stop/restart/crash/update" and Round 7 Q4 condition 4 (17 lands first "so the Windows S3/short entry can clear"); 37 AC "Loop S3 Windows" |
   | S3/hung | linux | **16** → failed-launches, stale-lock-after-round, exactly-one-proxy-after-round† (0/5), start-over-stale-lock† (0/5); **37** → peak:kit, procPeak:launcher, procPeak:mcp-bridge, procPeak:preflight† (4/5), procPeak:proxy† (2/5) | 16 AC as above; 16 What-to-build "Takeover only on proof (holder dead …)" for start-over-stale-lock; 37 as above |
   | S3/hung | windows | **16** → failed-launches, stale-lock-after-round, exactly-one-proxy-after-round† (1/5), start-over-stale-lock† (1/5); **17** → orphans† (4/5); **37** → peak:kit† (1/5) | as above; orphans: claimants 16 (Round 7 Q4 condition 1) and 17 (What-to-build); 17 descends from 16 |
   | S3/omp | linux | **35** → omp:concurrent-preflights; **37** → procPeak:proxy† (4/13), procPeak:preflight† (4/13) | 35 AC "Seam 1 (S3 omp leg): ≤ 1 concurrent preflight"; 37 AC "Loop S3 Linux … every role peak" (not 35's Comments) |
   | S3/omp | windows | **35** → omp:concurrent-preflights; **37** → peak:kit† (2/21) | 37 AC "Loop S3 Windows" |
   | S7/short | both | **33** → proxy.log:bounded-while-running | 33 AC "Loop S7: `proxy.log` ≤ 6 MB while running" |
   | S1/*, S1/stalled, S4/short, linux S5/short | as committed | unchanged single owners and names. Marked †: linux S4 unstoppable-proxy-after-ctrl-c (1/13); windows S4 proxy-left-after-stop and failed-lifecycle-steps (1/21) | 67's table |

   **A, decided.** In S2, `procPeak:scenario` and `growth:scenario` measure the same solver defect, not a different one. Example: 1061.5 MB host peak = base ≈ 37 MB + 1024.3 MB per-generation cost (run 42421424292). `growth:scenario` is phase A's host growth under heavy solves with production recycling, which 58's recycle triggers change. 58's Comments already record its flip.

   58's "Loop S2" AC gains three bounds:
   - `procPeak:scenario` ≤ 600 MB (ticket 01 note 10);
   - `growth:scenario` ≤ 5 %/1k (§18 S1–S5 growth row);
   - `procPeak:solver` ≤ 300 MB (§18 S2 row, the cap; 58's footprint recycle at 240 MB).

   The last bound is listed now, at 0 RED, under Round 14 3(b). Ticket 27 makes the solver a child, which turns this check RED until 28 and 58. Without the listing, 27's pre-merge run would bring back a question whose answer is already known. 27 and 28 are claimants that 58 descends from. 27's own S2 criteria (solver counts, cold start) stay 27's own and are not listed.

   **E, decided.** 34 owns nothing. Its early-log check was never RED in 34 runs. A name that is never RED and stays on a non-flipping entry would force 33's commit to delete 34's name, which breaks condition 5.
4. **GREEN while listed (replaces "the entry disappears when the run is GREEN").**
   - A listed entry whose run is GREEN **passes** only while at least one of its names is marked `flips`. It prints `<key>: GREEN, listed for ticket(s) <t…> on flipping checks <names> (Round 15 Q1)` in the job summary and report rows.
   - An entry with no `flips` name that is GREEN **fails** as today (Round 3 Q8).
   - **How a name is marked.** A name is marked only by 67, from its ≥ 10-run evidence: it was RED in fewer than all matching runs of that leg. That includes owner-named names never seen RED.
   - A mark is never added later. It goes when its name goes.

   Everything else in Round 14 condition 2 stands:
   - owned RED passes;
   - any RED name not owned fails;
   - RED with no name fails;
   - harness failure fails;
   - a name the run does not produce fails.

   The unowned message names every owner: `<key>: RED on <check>, not owned by tickets <t…> (<os>, Round 14 Q1, Round 15 Q1); the RED comes back as an ownership question, do not edit owners`. Passing rows print `RED on <checks>, owned by ticket <t> (<names>), ticket <u> (<names>)`.
5. **The list only shrinks, per owner (Round 14 condition 4, per name).**
   - **Who removes a name.** Only the owner's own commit removes its names, with evidence. For a name RED in every matching run, that evidence is the owner's recorded loop runs plus its pre-merge CI run GREEN on that check on that leg. A `flips` name needs ≥ 10 GREEN matching CI runs of that leg on the owner's tree (Q2's counting).
   - **Entry deletion.** The commit that removes an entry's last name deletes the entry.
   - **What no one does.** No run, job or other ticket edits another owner's names. A later RED of a removed name is an unowned RED: a question, never a re-add (Round 6 Q2 condition 3, Round 8 condition 4, PROMPT §7 Phase 4).
   - **Merge check.** A ticket's evidence lists each name it owns with its status. A name its fix should clear but that stays RED comes back with numbers. Budgets are never loosened.
6. **F: Comments as owner text.**
   - **What counts.** A Comments line counts only when it records a binding Owner Proxy decision (round and question named) that states the criterion for that ticket. The orchestrator then moves the criterion into that ticket's Acceptance in the same change, as Round 7 Q4 ordered.
   - **What does not count.** A Comments line that records only a measured finding (orchestrator or implementer) does **not** count. A finding cannot assign ownership. That is the silent-adoption path Round 14 rejected.
   - **Applied to windows S3/hung orphans.** The 16 line is a finding. Round 7 Q4 condition 1 is binding. Under condition 2 the check goes to 17, the descendant claimant, which avoids a stall: 17 is blocked by 16, so 16 must not need a reap that only 17 delivers.
   - **Overdue edit.** 16's Acceptance now gains Round 7 Q4 condition 1's seam proofs (windows-latest: a kill at each point between spawn and the complete record, and a forced probe timeout, each ending with the proxy stoppable or adopted).
7. **Ticket text the orchestrator applies before 67 merges.** Each change goes in the ticket's Acceptance, with a Comments line naming this round:
   - 16: "Delete `S3/hung` (linux, windows)" becomes "remove 16's names from `S3/short` and `S3/hung` (both legs)". Plus condition 6's seam proofs.
   - 17: gains "Loop S3 (windows): 0 orphans after the scenario's stop in `S3/short` and `S3/hung`; remove 17's names". "Delete `S4/short`" stays.
   - 25: gains "remove `cdn-cache:memory-growth` from `S2/short`".
   - 58: gains condition 3's three bounds. "Delete `S2/short`" becomes "remove 58's names".
   - 33: "The `S7/short` entry stays until 34" becomes "remove `proxy.log:bounded-while-running` from `S7/short`".
   - 34: "Delete `S7/short`" is struck. 34 owns no name.
   - 35: "Delete `S3/omp`" becomes "remove `omp:concurrent-preflights`". Its 2026-11-07 "comes back with the numbers" line is superseded: the role peaks are 37's.
   - 37: gains "remove 37's names from `S3/short`, `S3/hung`, `S3/omp` (both legs)".
   - 15 and 36: a Comments line saying their S3 role-peak criteria bind on their own evidence, while 37 holds the names.

   The rule "the commit that removes the last name deletes the entry" covers every "Delete" line that remains.
8. **Tests (RED first; Round 14 condition 5 extends):**
   - two-owner entry: each owner's RED passes, and an unowned RED fails naming both owners;
   - a name under two owners is a schema error;
   - an empty owner list is a schema error;
   - an unknown owner id is a schema error;
   - `flips` on a non-owned name is a schema error;
   - GREEN with a `flips` name passes and prints its line;
   - GREEN with no `flips` name fails;
   - a stale name still fails;
   - one real-list case per leg;
   - every Round 9, 13 and 14 case stays unchanged.

   67's pre-merge run confirms, it does not decide. On disagreement the numbers come back, and nobody widens an owner list.
9. **Edges.** None new:
   - 55's guard and its existing blockers cover every owner (25 through 58, 33 through 34, 35 and 37; 16 and 17 directly);
   - 15 and 36 hold no names;
   - no owner needs another owner first, because each removes only its own names.
10. **Records.**
    - RUNLOG records the deviations above, naming this round.
    - METRICS.md marks the `flips` names with their rates.
    - Spec §18 (or wherever the ratchet rule is stated) gains the owners and flips rule as a measurement-rule amendment.
    - Every budget, ceiling, n, `growth()`, Round 7 Q1's metric split, the two `unstable` bounds and the set of listed keys are unchanged.

**Rationale:** Per-check owners are the only form that keeps Round 14's two goals at once. Every tolerated RED stays attributable to a line of an open ticket's text, and every RED that no ticket claims still fails. A single owner per entry cannot do both. 16 cannot clear memory checks, 37 cannot clear lock checks, and Round 7 Q4 already had to add an edge to get around that.

The descendant rule gives one owner per check without adding edges. It also puts each check on the ticket whose criterion has to hold when the entry goes. It also removes a real stall: 16 being held on a Windows orphan that only 17's reap or adoption can clear.

A is the solver defect seen from the host process, with the numbers to show it. So it gets an owner now, not a triage ticket.

The flip rule rests on the recount. After one owner lands, the strict "GREEN but listed" rule fails roughly every second linux S3/omp run and most windows S3/omp and S3/hung runs, whatever is done with the entry. Tolerating GREEN only while a measured flipping name remains keeps Round 3 Q8's protection on every deterministic entry (all of S1, S5, most of S4) and relaxes it only where the evidence shows flips. It masks nothing beyond the owners' own names. The ≥ 10-run removal floor stops a premature removal from turning into random merge blocks later.

**Charter:** C1 (orphan, single-proxy, lock and ceiling checks stay enforced, now with an owner each), C7 (per-leg owners; the Windows orphan placed where it can be cleared), C9 (stronger measured evidence: the recounted RED sets and flip rates; smaller blast radius: one list shape, no new ticket or edge; simpler than a triage round for A), §9 (no budget touched; the removal floor only tightens), Round 3 Q8 conditions 1–3, Round 6 Q2 condition 3, Round 7 Q4 conditions 1–4, Round 8 condition 4, Round 9 Q1 conditions 1 and 3, Round 13 Q1 conditions 1, 3 and 7, Round 14 Q1 conditions 1–7 and its Shared understanding, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (test code, list shape, ticket text). ADR: no.

---

## Q2 — the 10-run floor for S3/short and S3/hung

**DECISION:** REJECTED in part.
- **Accepted:** ticket 67 stays unmerged until S3/short and S3/hung each have ≥ 10 matching runs per leg. Every other key is already over the floor (13 linux, 21 windows), and 67 lands in one merge.
- **Rejected:** counting the 8 local Linux runs toward the Linux floor. Also rejected: making 67 wait on "the next five pre-merge runs of other tickets".

Binding conditions:
1. **Only CI runs of the leg's full short profile count** (Round 14 condition 3(a) as written). The local runs stay in METRICS.md as a labelled supplement. They are never counted.
2. **Where the 5 more runs per leg come from.**
   - First, any pre-merge staging run of another ticket that already exists or happens anyway, and whose tree matches S3's executed code under METRICS.md's matching rule (scenario, `verdict.mjs`, `budgets.mjs`, and no change to the lifecycle, manager, launcher, preflight or bridge paths).
   - Otherwise, the orchestrator runs the job on 67's branch (or staging/67) until both legs have 10, as Round 14 condition 3(a) ordered for exactly this case. One CI run covers both legs, so five runs close both floors.
   - Do not wait for other tickets. If a ticket that changes S3's path (15, 16, 13, 36, …) merges first, the count restarts on the new tree.
3. **Branch preparation.** 67's branch merges the integration tip (9441486, ticket 69) before those runs. 69 does not reset the 5 existing runs (correction 7). METRICS.md's matching rule records why.
4. **What the runs decide.**
   - They confirm Q1's S3 owners and set their `flips` marks from all ≥ 10 runs per leg.
   - Suppose a run shows a RED name that Q1 does not assign. That name comes back as a question with the run ids, and nobody folds it in. The other keys' owners stand.
   - A name in Q1's table that the 10 runs never show RED stays only if it is owner-named (Round 14 condition 3(b)), and it is marked `flips`.
5. **The same counting applies to Q1 condition 5's ≥ 10-run removal floor:** matching CI runs of that leg only.

**Rationale:** The floor exists to see a check that is RED in ≥ 26 % of runs with 95 % probability. Local runs fail that purpose on exactly the checks that need it. On this machine `procPeak:preflight` is 0/8 where CI shows 4/5 (S3/hung) and 1/5 (S3/short), and `procPeak:proxy` and `exactly-one-proxy-after-round` behave the same way on S3/short. Counting them would mark the wrong `flips` and understate rates.

Counting them also buys nothing. The windows floor needs five more CI runs either way, and each of those runs is a Linux run too.

Waiting on other tickets' pre-merge runs risks a reset whenever one of them touches S3's path. Round 14 already named the cheap fix: run the job on 67's branch. PROMPT §0 says wall-clock time does not matter.

**Charter:** C9 (stronger measured evidence: CI-matching runs, which differ measurably from local; then the simpler option: one merge after five runs), C7 (both legs, same floor), C1 (the floor protects the orphan, lock and peak checks the owners now gate), Round 14 Q1 condition 3(a), Round 7 Q4 (PROMPT §0 citation), PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (run scheduling; no code or budget). ADR: no.

---

## Shared understanding

Open branches I still see (none blocks 67 once Q2's runs are in):
- **37's windows criterion "a miss … the entry is re-pointed to that follow-up"** conflicts with Q1 condition 5 (no other ticket edits an owner's names). If 37 misses build-time gate 2, it comes back with numbers, and the Owner Proxy decides the follow-up's names then. Nothing is re-pointed silently.
- **15's and 36's own S3 role-peak criteria** (preflight ≤ 76, bridge ≤ 75) bind them on their own evidence while 37 holds the names. If either lands with its peak still RED, it comes back with numbers.
- **EVIDENCE MISSING: the mechanism of the windows S3 orphans in the matching runs.** The candidates are the start-time window (Round 7 Q4) and the suspended proxy left by a holder killed inside spawn (16 and 17 Comments, 2026-11-07). The job table shows only the count. Q1 gives the name to 17 whatever the mechanism. If 16 clears it first, 17 removes a GREEN name.
- **27's pre-merge run** will move solver memory out of `procPeak:scenario` and into `procPeak:solver`. Both are 58's names, so it should pass. Any other S2 RED it shows comes back as a question.


---

# Round 16 (2026-11-08) — ticket 67 follow-ups G and H, ticket 37 windows clause


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–15 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only:
- `ticket/67-owned-checks` at a097269 (`git -C /home/AgentKit/wt/t67 show HEAD:…`): `issues/67-*.md` (round 2 report, questions G and H), `METRICS.md` lines 329–377 ("owners and flips"), `tests/memory/verdict.test.mjs:1007-1035` (the real-list test), `tests/memory/lib/verdict.mjs:14,162` (`count:<role>` = more processes of a role than budgeted **at any one sample**).
- CI run 42425476318, windows: the job log in `/home/AgentKit/overhaul-tools/ci-art/t67-logs/logs/42425476318-windows.log:568-590`, and the S4/short `summary.json` from the run's `memory-budget-windows` artifact (id 13595619376, read in memory through `gh api`, nothing written).
- Integration tree 0b14839: DECISIONS.md Rounds 3 Q2, 7 Q2, 7 Q4, 14 and 15 in full; issues 13, 17, 23, 37; `spec.md` §18 PROCESSES and build-time gates; `tests/memory/scenarios/s3-concurrency.mjs:4`, `s4-lifecycle.mjs:1-160`; `tests/memory/lib/budgets.mjs:28`; `git diff f383d6b^1 f383d6b -- mcp/zcode-harness-mcp/package.json`.
- `gh run list --branch staging/67`: the 8 runs 42435825059 … 42436440284 are all `in_progress`. No result is known yet.

**Corrections to the round's facts.**
1. **G has a recorded mechanism, and it is 17's.** The S4/short summary of 42425476318 (`notes.sigintDuringStart`) shows it. The Ctrl-C at 150 ms into a `proxy start` left a surviving proxy whose pid record has no start time (`childSurvived: true`, `pidRecordStartedMs: null`). The next start exited 0 and spawned a second proxy instead of adopting the first (`nextStart: 0`, `proxiesAfter: 2`, `killedByHarness: 2`). It is the same event as that run's `unstoppable-proxy-after-ctrl-c` 1 of 8. The respawn storm shows `proxies: 1` at all six steps. The stale-lock respawn ends with `proxiesAfter: 0`. This is exactly the window in 17's Comments (2026-11-06) and Round 7 Q4 ("17 adopts pid records … left without a start time").
2. **Ticket 23 also names "exactly 1 proxy at every sample"** (AC "Loop: induced memory pressure → ≤ 3 restarts / 15 min and exactly 1 proxy at every sample"), and 23 is blocked by 17. Its loop line names no scenario key, though. The only loop phase close to it is S4's respawn storm, which was at 1 proxy throughout. So 23 is no claimant of this RED (Q1).
3. **H: "Before 13: 10 matching CI runs per leg" is 8 + 2.** METRICS.md's "10 runs per leg (with 65)" includes the two runs on the 13 tree (42425069025, 42429164758). The pre-13 count is 8. The answer does not change: 2 runs exist on the 13 tree, so 8 more are needed, which is what is in flight.
4. **13 changes more than S3.** The bridge's runtime dependencies change (`@modelcontextprotocol/sdk` ^1.30.0 → ^1.32.2, `zod` ^4.6.6 added). Every S3 variant holds a bridge session (`s3-concurrency.mjs:4`), so S3/omp is affected too. S5 runs the bridge (METRICS.md's own matching rule says so). Ticket 13's title says zod 4.6.6, the round says 4.6.7 (lockfile resolution); this does not matter for the decision.
5. **Q3: ticket 37's windows line also carries an overdue edit.** Round 7 Q2 condition 4 changed 37's windows criterion from "≤ 600 MB commit (≥ 30 % rule …)" to "≤ 514 MB commit". `budgets.mjs:28` has `windows: 514`, but 37's Acceptance still says 600. Round 7 Q2 condition 5 also names three levers for build-time gate 2: the lean resident launcher, the Bun bridge, and replacing the per-call PowerShell proofs. 37 still says "the two levers".
6. **The real-list test pins the opposite of Q1.** `verdict.test.mjs:1032` asserts that no entry owns `count:proxy`, and uses `count:proxy` as the one unowned RED on every key. Q1 makes that assertion false for windows S4/short.

---

## Q1 — G: windows S4/short `count:proxy` (two proxies at once) in 1 of 26 runs

**DECISION:** ACCEPTED with conditions. Owner **17**, windows only, marked `flips` (1/26). It is traced to 17's What-to-build "The next start adopts an orphaned proxy through the identity proof and never spawns a second one". 17's Acceptance gains the loop line. No new ticket, no new edge.

**This amends Round 15 Q1 condition 3**, the row "S1/*, S1/stalled, S4/short, linux S5/short | as committed | unchanged". Windows S4/short gains one name under 17. This is the return path Round 15 Q2 condition 4 named ("comes back as a question with the run ids"). It is not a silent fold-in. No other earlier decision is contradicted.

Binding conditions:
1. **Owner and trace.** `count:proxy` goes under owner 17 in the windows `S4/short` entry and joins that entry's `flips` list. 67's Comments cite:
   - the What-to-build line;
   - run 42425476318 with the `sigintDuringStart` record (correction 1), as the measured link to that line.

   Single claimant (Round 15 Q1 condition 2): 23's line is not about this phase (correction 2). 16 does not claim it either: 16's single-proxy name is S3's `exactly-one-proxy-after-round`. And even with 16 counted as a claimant, 17 descends from 16, so 17 owns it.
2. **Linux is not listed.** Linux `count:proxy` was 0/18 in S4/short. Listing a never-RED name would loosen the C1 single-proxy check with no evidence, and no planned change makes it RED. This is unlike Round 15's `procPeak:solver`, where ticket 27 makes it RED. A linux `count:proxy` RED stays unowned: it comes back as a question.
3. **17's Acceptance gains** (with a Comments line naming this round): "Loop S4, both legs: exactly 1 proxy at every sample (`count:proxy` ≤ 1), including after a Ctrl-C during start that leaves a proxy without a start-time record (windows run 42425476318, Round 16 Q1). On windows, `count:proxy` is one of 17's names in `S4/short`." "Delete `S4/short` (linux, windows)" stays. Round 15 Q1 condition 5 covers it: removing the flipping name needs ≥ 10 GREEN matching windows CI runs on 17's tree, which 17 already needs for `proxy-left-after-stop` and `failed-lifecycle-steps`.
4. **Attribution check while the name is tolerated.** For every S4/short `count:proxy` RED before 17 merges, on either leg, the orchestrator records in 17's Comments which phase of `summary.json` showed more than one proxy: `sigintDuringStart[].proxiesAfter`, `respawnStorm[].proxies`, `respawnWithStaleLock.proxiesAfter`, or none of these. If the phase is not the Ctrl-C/adoption phase (for example the respawn storm, which is 23's subject), that RED comes back as an ownership question with its run id, even though the ratchet passed it. The ratchet cannot see phases, so this record is what keeps the tolerance attributable.
5. **Test change in 67.** The real-list test (`verdict.test.mjs:1010-1035`) keeps its purpose: on every listed single run of both legs, one added unowned RED fails and names the owners. Per key it picks a name that the key's owners do not hold. That is `count:proxy` everywhere except windows S4/short, where it is, for example, `orphans`. It asserts `count:proxy` is owned only in windows S4/short. Every other existing case passes unchanged. The change is justified in 67's Comments (common acceptance: no pre-existing test change without justification).
6. **Records.** METRICS.md moves `count:proxy 1/26 (42425476318)` from "not owned" to `17 count:proxy 1/26 †` in the windows S4/short row. RUNLOG names this round.

**Rationale:** The RED is a second proxy, which C1 forbids outright. So the bar is attribution, not convenience. The artifact supplies it. The second proxy appeared exactly where a Ctrl-C left an unrecorded proxy and the next start spawned instead of adopting. That is 17's What-to-build line word for word, and the same event as 17's already-owned `unstoppable-proxy-after-ctrl-c`.

Leaving the name unowned would make a 1-in-26 event fail the ratchet at random. That is the random merge block Rounds 9, 13 and 15 refused, and it would teach nothing new, because the answer is already known. The cost of owning it is bounded:
- the name is windows-only;
- it is marked as flipping on measured evidence;
- it can only leave through 17's ≥ 10-GREEN-run removal;
- condition 4 sends any second proxy from a different phase back as a question.

The orchestrator's recommendation was right. It needed the mechanism (it rested only on the What-to-build line), the 23 check, the linux scope, and the test pin it collides with.

**Charter:** C1 (single proxy per installation: enforced, attributed to the ticket that fixes it, not masked), C7 (windows evidence, linux unchanged), C9 (stronger measured evidence: the per-phase record in `summary.json`; smaller blast radius: one name on one leg, one AC line, no edge), C2 (test change justified), Round 7 Q4, Round 14 Q1 condition 3(b), Round 15 Q1 conditions 2, 4, 5 and 6, Round 15 Q2 condition 4, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (one list name, one AC line, one test case). ADR: no.

---

## Q2 — H: does ticket 13's merge restart the S3 evidence floor?

**DECISION:** ACCEPTED with conditions. The floor restarts. It applies to every listed key whose executed code includes the MCP bridge, not only S3/short and S3/hung. The 8 runs in flight satisfy it. 67 merges only on a clean result. One term is defined below: what "a flip rate that contradicts a `flips` mark" means.

**No earlier decision is contradicted.** Round 15 Q2 condition 2 named 13 as a reset. Condition 4 below makes Round 15 Q2 condition 4 ("set their flips marks from all ≥ 10 runs per leg") precise for a restarted count. It departs, **for the `flips` marks only**, from a strict per-tree reading of Round 14 Q1 condition 3(a), and I say so here. The floor itself, which drives owners and unowned names, is strictly per-tree.

Binding conditions:
1. **Scope of the restart.** 13 changes the bridge's runtime dependencies, so the matching runs restart on the 13 tree for:
   - S3/short, S3/hung and S3/omp on both legs;
   - linux S5/short.

   Windows S5/short stays judged under Round 13's `unstable` bound, unchanged. The floor is ≥ 10 valid matching CI runs of the full short profile per leg on the 13 tree. Those are 42425069025 and 42429164758 plus the 8 in flight (42435825059 … 42436440284). The S1, S2, S4 and S7 counts are unaffected (correction 4). Q1's list edit and condition 5's test edit do not restart anything, because `expected-red.json`, `ratchet.mjs` and the tests are not in the matching rule.
2. **Merge gate.** 67 merges only if all of these hold:
   - each of the 8 runs is valid on both legs (the summary table printed, every key's row GREEN or RED);
   - each run passes the ratchet when its per-key RED sets are replayed through 67's **final** ratchet and list, including Q1's `count:proxy` (`t67-scripts/replay.mjs`). The runs started before Q1, so the list they executed lacks that name;
   - 67's pre-merge CI run on its final tip passes. It counts as one more run on the 13 tree.
3. **What comes back with run ids and numbers.** In each case: no rerun-until-green, and no edit to any owner list or `flips` mark in between (Round 6 Q2 condition 3, Round 8 condition 4).
   - **(a)** any RED name that no owner holds, on any key or leg;
   - **(b)** a harness failure or an invalid run. It does not count toward the floor, and it is reported;
   - **(c)** a name **not** marked `flips` that is GREEN in any run on the 13 tree. A new mark is a relaxation the committed evidence did not predict, and on these keys it may be 13's own effect: `procPeak:mcp-bridge` is RED 10/10 today;
   - **(d)** a listed entry that is GREEN with no `flips` name (linux S5/short in particular).
4. **What does not come back.** A name marked `flips` that is RED in every run on the 13 tree **keeps its mark**, as long as the pre-13 matching runs show it GREEN at least once. METRICS.md records each name's rate on both trees separately. The reason is sampling and the asymmetry of the two errors:
   - windows S3/hung `orphans` is 9/10 before 13, so it is RED in all 8 new runs with p ≈ 0.43;
   - linux S3/hung `procPeak:preflight` is 8/10, so p ≈ 0.17;
   - a dropped mark can never be re-added (Round 15 Q1 condition 4). Once the other owners land, it turns into random "GREEN but listed" failures;
   - a kept mark only lets a fully GREEN entry pass, and the job prints that visibly.
5. **What the runs settle.** On a clean result, the S3 owners of Round 15 Q1 condition 3 and Q1 above stand. The marks follow condition 4. The METRICS.md matching rule records the restart's scope (condition 1) and this round.

**Rationale:** Round 15 Q2 condition 2 already ruled that a merge changing S3's executed code restarts the count. 13 changes code the bridge loads at run time (the SDK and zod), and the bridge is sampled by S3 and S5. The byte-identical `dist/` does not make the dependencies identical. A restart is the rule, not a judgement call.

The scope follows the same reason. Restarting S3/short and S3/hung but not S3/omp and S5 would be inconsistent, and it costs nothing, because the same 8 runs cover every key on both legs.

The orchestrator's gate is right. It needed two things:
- **The replay against the final list.** Without it, a recurrence of G in the in-flight runs would block 67 on a name Q1 has already assigned.
- **A defined "contradiction".** As written, it would send back the most likely outcome (a 9/10 name going 10/10 by chance) as a question whose answer is already fixed by Round 15's rule and its asymmetry. The outcome that really carries information still comes back: a name going GREEN that has never gone GREEN before.

**Charter:** C9 (stronger measured evidence: CI runs on the tree 67 merges onto; then the simpler option: one set of 8 runs for every affected key), C1 (the floor protects the orphan, lock, single-proxy and peak checks the owners gate), C7 (both legs, same floor), §9 (no budget touched), Round 6 Q2 condition 3, Round 8 condition 4, Round 14 Q1 condition 3(a), Round 15 Q1 condition 4, Round 15 Q2 conditions 1, 2, 4 and 5, PROMPT §0 (wall-clock time does not matter), PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (run scheduling and evidence records; no code or budget). ADR: no.

---

## Q3 — ticket 37's windows acceptance line: "the entry is re-pointed to that follow-up"

**DECISION:** ACCEPTED with an addition. Replace the clause as recommended. In the same edit, apply Round 7 Q2 conditions 4 and 5, which were never applied to this line: ≤ 514 MB commit, and the three measured levers.

**No earlier decision is contradicted.** Round 7 Q2 conditions 4–5 and Round 15 Q1 condition 5 are applied. The superseded text is the original ticket wording, which no binding round chose.

Exact replacement for 37's Acceptance line "Loop S3 Windows: ≤ 600 MB commit (≥ 30 % rule if the baseline exceeded 600). GREEN → **delete `S3/short` (windows)**; a miss goes back to the owner with numbers for the two levers (build-time gate 2) and the entry is re-pointed to that follow-up.":

> - [ ] Loop S3 Windows: ≤ 514 MB commit (`peak:kit`; Round 7 Q2 condition 4). GREEN → **delete `S3/short` (windows)**. If 37 cannot reach the windows target, it comes back to the Owner Proxy with the numbers (build-time gate 2), including the measured levers: the lean resident launcher, the Bun bridge, and replacing the per-call PowerShell proofs (Round 3 Q2 condition 8, Round 7 Q2 condition 5). The names stay under 37 until then. No other ticket takes over or edits them (Round 15 Q1 condition 5).

Binding conditions:
1. 37's Comments gain one line naming this round. It names the overdue Round 7 Q2 edit, and it supersedes the 2026-11-08 line's "conflict" note.
2. The Linux line is unchanged. It has no re-point clause, and a Linux miss of build-time gate 1 already comes back with numbers (spec §18 build-time gates).
3. Nothing in `budgets.mjs` changes. It already holds 514 (§9: no loosening; this is text catching up with the code).

**Rationale:** "Re-pointed" would let a follow-up ticket inherit 37's names without 37's evidence. Round 15 Q1 condition 5 forbids exactly that: only an owner removes its own names, and nobody else edits them. The recommended text routes a miss the way every build-time gate already routes: back with numbers. The Owner Proxy then decides the follow-up's names in the open.

Correcting the number in the same edit avoids a second pass over the same line. It also removes a real ambiguity. "≤ 600 (≥ 30 % rule if the baseline exceeded 600)" resolves to 514 only for a reader who knows the 734.5 MB baseline, while the check that gates 37's windows `peak:kit` names already uses 514.

**Charter:** C9 (simpler: one routing rule for every gate; smaller blast radius: one line), C7 (the primary-platform target stated as enforced), §9 (budget text matches the tightened code, never loosened), Round 3 Q2 condition 8, Round 7 Q2 conditions 4 and 5, Round 15 Q1 condition 5 and Round 15's Shared understanding (first bullet), spec §18 build-time gates.

**REVERSIBILITY:** Two-way door (ticket text). ADR: no.

---

## Shared understanding

Open branches I still see (none blocks 67 once Q2's gate is met):
- **Ticket 23's loop line ("induced memory pressure … exactly 1 proxy at every sample") names no scenario key.** S4's respawn storm is the closest phase. If 23's evidence is taken from S4, its claim overlaps 17's windows `count:proxy`, and by Round 15's descendant rule the name would go to 23 (23 is blocked by 17). Nothing is reassigned now: no storm-phase RED exists. It comes back if Q1 condition 4 finds one, or when 23 states its loop key.
- **Windows S3 at ≤ 514 MB is probably out of reach of 37's mechanisms** (Round 7 Q2 condition 5: proxy plus five bridges already make 576 MB). The Q3 return path will likely be used. The levers are named. None is adopted now.
- **EVIDENCE MISSING: the mechanism of the windows S3 `orphans` in the matching runs** (carried over from Round 15). `summary.json` does record per-phase notes (as for S4 here). If the S3 artifacts carry similar notes, they can settle it without a new run.
- **Q2 condition 3(c) may fire** if 13's SDK/zod bump moves `procPeak:mcp-bridge` or linux S5/short `growth:mcp-bridge`. That would be a measured change by 13, decided then on its numbers.


---

# Round 17 (2026-11-08) — the rare REDs from ticket 67's evidence runs


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–16 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only:
- `gh run view <id> --log` for all 8 runs (logs read into a scratch directory outside the worktree). All 8 head commits carry the same tree, 4a7e58e. Failures: 42436010878 windows memory (S7), 42436186573 linux memory (S5) **and** windows test-kit Node 24 (`manager-safety.test.mjs:160`, ticket 70), 42436354758 windows memory (S1/short), 42436440284 windows test-kit Node 26 (`loop.test.mjs:459`, the floor test). That is five failures in four runs, as the round says.
- The archived memory-job logs `/home/AgentKit/overhaul-tools/ci-art/t67-logs/logs/*.log` (every CI run up to 42429164758), recounted per key and leg for the three values in question.
- `ticket/67-owned-checks` at 3b414b2: `tests/memory/expected-red.json`, `tests/memory/lib/budgets.mjs`, `.scratch/kit-overhaul/METRICS.md` lines 258–373, `tests/memory/scenarios/s7-disk.mjs`, `tests/memory/loop.test.mjs:459-476`, `tests/memory/fixtures/omp-host.ts:25-89`.
- Integration tree d170038: issues 03, 19, 20, 21, 25, 30, 33, 35, 36, 61 and INDEX.md; spec §7 (bounded collections), §18 MEMORY rows, the ratchet and baseline paragraphs; `zcode-proxy-src/src/responses/store.ts:48-104`, `runtime/health-monitor.ts:166-171`; DECISIONS Rounds 6, 13–16; PROMPT §7 Phase 4; RUNLOG to 03:02Z.

**Corrections to the round's facts.**
1. **Q3: windows S1/short has been RED before, and the earlier RED was never recorded.** Integration run 42382114395 (`overhaul/stability-terminal-ux`, 2026-11-07 14:37Z) shows `RED growth:proxy 5.27 %/1k trend=true [commit 5.27 / WS 1.47]`, then `ratchet FAILED` and `S1/short: RED but not listed in expected-red.json (windows)`. Neither RUNLOG, METRICS nor DECISIONS mentions it. Recounted over every windows run with an S1/short line (n = 49: 41 archived + 8 new), commit growth is min 1.43, median 3.56, mean 3.41, sd 0.93, max 5.27. It is RED in **2 of 49** (4.1 %; 95 % Clopper-Pearson 0.5–14.0 %), and the round's "~3.7–4.0" understates the spread. Normal fit P(> 5) = 4.3 %, log-normal 7.8 %. WS growth is −5.6 to +3.5. Linux S1/short across 70 runs: max 4.43, never RED; it was 3.08 in the RED run.
2. **Q1: the check was never RED before, but it has a tail.** `responses-store:heap-at-cap` (heap growth, one `/health` reading 5 s after the load, no GC):
   - windows, n = 51: 46 values in 60–65 MB; tail 71, 71, 86, 87, **98** (42415959288, 42378479007, 42421424292, 42281646419, 42436010878);
   - linux, n = 70: 69 values in 59–65 MB; one 77 (42367395231).

   The store cannot cause that spread. `ResponseStore.set` evicts synchronously against a serialized-byte bound (64 MiB) and a count bound (1,000 entries), and S7 sends identical input every run (1,500 × 64 KB). So its retained size is the same in every run, which is the 59–65 MB cluster. The extra 6–34 MB is other heap that is not collected 5 s after the load. `heapUsedMB` is `process.memoryUsage().heapUsed` (`health-monitor.ts:171`), read without a GC.
3. **Q1: the short-profile S7 check has almost no power against its own defect class.** 1,500 × 64 KB = 93.75 MiB, which is below the 96 MB budget. A store with no bound at all would read about 94–100 MB, about where today's 98 tail reading lies. The long profile (4,000 → 250 MiB) can tell them apart. Q1 does not decide this. It is recorded in Shared understanding.
4. **Q4: the Node version is not a variable.** The stub OMP host runs under Bun (`resolveBun(KIT)`), and Node only runs the test harness. The windows floor test passed 15 of 16 windows legs across the 8 runs (Node 24 8/8, Node 26 7/8) and all 16 Linux legs. **EVIDENCE MISSING: the windows commit no-op floor distribution.** A passing run prints no value, so 2.55 MB is the only windows number on record. Linux (RSS) is +0.63 to +0.75 MB (ticket 03).
5. **Q2: the GREEN is the net-rise branch missing by a small margin.** On the 13 tree, linux S5/short is RED in 9 of 10 runs (42425069025, 42429164758 and the 8). The values are 39.53–45.99 %/1k, median about 42.0, the same as before 13 (37.53–46.33, median 42.63). Run 42436186573 is 39.53 with `trend=false`; every other S5 check is GREEN, at a peak of 102.6 MB.

---

## Q1 — windows S7/short `responses-store:heap-at-cap` RED, unowned (1 of 8)

**DECISION:** REJECTED, both routes. No ticket owns the check, and no entry lists it. Instead, the check gets a measurement-rule amendment that lands in new ticket **71**.
- **Rejected: ticket 25 as owner.** 25's What-to-build says the responses-store logic "is lifted into one module (responses store behaviour and tests unchanged)", and spec §7 has "Responses store | unchanged (64 MB / 1,000 entries)". 25's text promises *no* change to this bound, so it cannot be the fix that clears the RED (Round 15 Q1 condition 2; Round 14 Q1 condition 3(b)). 33's acceptance names only `proxy.log:bounded-while-running`, and 34 owns nothing (Round 15 Q1, E).
- **Rejected: a needs-triage owner.** Listing the name would tolerate any value of a check that, at the short profile, already cannot tell an unbounded store from a bounded one (correction 3). That masks rather than triages.

Binding conditions:
1. **What the check judges.** The 96 MB budget and the check name stay. The value becomes the store's *retained* heap:
   - After the existing 5 s wait, the scenario reads `/health` `heapUsedMB` at least 30 times, 1 s apart.
   - `heap-at-cap` = the **minimum** of that series minus `h0`.
   - `summary.json` and the check detail record the series: first reading (today's value), minimum, maximum, and RSS before and after.

   No product code changes: no GC hook, no new endpoint (C6). Why the minimum loosens nothing: memory the store retains is present in every reading, so a store over its bound is RED under both rules, and the minimum is never above the first reading. Transient garbage stays bounded by S7's unchanged `procPeak:proxy` (WS 250 MB) and `commit-backstop:proxy` (512 MB). The short-profile load (1,500) and the long profile (4,000) stay as they are.
2. **Tests, RED first.** These run at the job seam with fixture series:
   - a series [98, 97, 80, 64, …] is GREEN;
   - a series that never drops below 97 is RED;
   - a series with a missing or non-numeric reading is a harness failure, never GREEN;
   - a series shorter than 30 readings is a harness failure.

   Plus one local mutant, never committed: the store with both bounds removed, run on the **long** profile, is RED under the new rule. Record its short-profile value under both rules as information (correction 3).
3. **Evidence and what comes back.** 71's pre-merge run and every later run record the series. If any run's minimum lies above 66 MB, it comes back as a question with the series, but it does not block 71's merge. That would be heap retained beyond the store's cluster, which is a real finding and not GC timing.
4. **Records.** Spec §18 S7 row gains: "responses store heap at its cap ≤ 96 MB, judged on the minimum of ≥ 30 `/health` readings 1 s apart after the load (Round 17 Q1)". METRICS gets the 51/70 table (correction 2). Ticket 25's Comments gain: "Round 17 Q1: 25 does not own `responses-store:heap-at-cap`. Its lift keeps the store unchanged."

**Rationale:** The numbers settle the cause. In 115 of 121 runs the reading sits on the store's cap, and the store's bound is enforced synchronously on identical input. So the 6–34 MB tail in six runs cannot be the store; it is uncollected heap read at a random moment. Listing the name would hand a rare GC-timing artefact to an owner whose text promises not to touch the store, and it would tolerate a store regression of any size. Measuring what the budget names, the store's retained heap, removes the false RED, keeps the bound's full force on real retention, and adds a mutant proof the check never had. It is test code in one scenario.

**Charter:** C1 (the store's bound is proven by the quantity it bounds; transient memory stays bounded by the unchanged peak and backstop checks), C6 (no product endpoint or GC hook), C9 (stronger measured evidence: 121 runs plus the store's code; smaller blast radius: one scenario's reading), §9 (96 MB unchanged), Round 14 Q1 condition 3(b), Round 15 Q1 conditions 2 and 6, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (test code and spec text). ADR: no.

---

## Q2 — linux S5/short `growth:mcp-bridge` over budget but GREEN on the trend flag (1 of 8)

**DECISION:** ACCEPTED with conditions. 67 marks `growth:mcp-bridge` as `flips` in linux `S5/short` (owner 30). Ticket 30's linux exit is judged on the value, not on GREEN.

**This explicitly contradicts:**
- **Round 13 Q1 condition 4, third bullet** ("The Linux deletion stays on the normal verdict"). Linux now uses the value-based exit that windows already has.

It is the return path that **Round 16 Q2 condition 3(c) and (d)** named: a name not marked `flips` turned GREEN on the 13 tree, and linux S5/short was GREEN with no `flips` name. It follows **Round 15 Q1 condition 4**: 67 marks a name from its evidence when it is RED in fewer than all matching runs, here 9 of 10 on the 13 tree. Windows `S5/short` stays `unstable` under Round 13, unchanged. No third `unstable` key is added, so Round 13 Q1 condition 3 stands.

Binding conditions:
1. **The list edit (in 67, before it merges).** Linux `"S5/short": { "owners": { "30": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] }`. METRICS records the rate per tree: 0 GREEN of 37 before 13, 1 of 10 on the 13 tree (42436186573, 39.53, trend false).
2. **Ticket 30's linux exit (Acceptance).** The name, and with it the entry, is removed only when every one of ≥ 10 fresh matching linux CI runs on 30's tree has `growth:mcp-bridge` ≤ 5 %/1k, whatever the trend flag says, and every other S5 check is GREEN. A GREEN at 39 %/1k is a missed trend, not a fix. Today the flag would meet a GREEN-based exit by chance in about 1 of 47 runs.
3. **Wrong-owner watch (orchestrator, because the ratchet cannot see it).** For every linux S5/short run that is GREEN before 30 merges, the orchestrator records the value and the window medians in 30's Comments. Any value ≤ 5 %/1k before 30's fix lands (for example after 36's semi-space flag) comes back as an ownership question with the run id. This is the linux counterpart of Round 13 Q1 condition 1's "≤ 5 fails".
4. **Nothing else changes:** the 5 %/1k budget, `growth()`, `MEMORY.growth`, the windows band and bound 30, and the other S5 checks.

**Rationale:** The value is 8× over budget in every run on both trees. Only the net-rise branch of the trend flag fell short once (correction 5). The flip mark is no looser than today's listing: an owned RED already passes at any value, and the mark only adds a GREEN pass. It is a list edit inside the open ticket that owns list edits, so it costs no new mechanism. The value-based exit closes the one hole the mark opens, an exit met by trend noise. The watch closes the other, a fix landing under the wrong owner.

**Charter:** C1 (bridge growth stays owned and its exit is honest), C7 (linux brought to the windows exit rule), C9 (stronger evidence: 47 runs; smaller blast radius and simpler: one list mark rather than a third `unstable` key), §9, Round 13 Q1 conditions 1 and 4, Round 15 Q1 conditions 4 and 5, Round 16 Q1 condition 4 (orchestrator record), Round 16 Q2 condition 3.

**REVERSIBILITY:** Two-way door (one list mark, ticket text). ADR: no.

---

## Q3 — windows S1/short `growth:proxy` RED (unlisted key, 1 of 8)

**DECISION:** REJECTED, all three routes; the key stays unlisted:
- **Rejected: 19 as owner.** 19's loop line names only `S1/burst4/16/32/bigbody`.
- **Rejected: 21 as owner.** 21's acceptance has no loop growth line at all. A trace to either ticket would be invented (Round 15 Q1 conditions 2 and 6).
- **Rejected: a needs-triage listing.** This is the path Round 6 Q2 condition 1 permits. It is not taken, because with `owners` and `flips` it would tolerate `growth:proxy` at any value on the primary platform's main proxy-growth check.

Decision: windows `S1/short` is judged on **5 sequential repetitions** (measurement-rule amendment, in ticket 71). The 5 %/1k budget, `growth()` and Round 7 Q1's commit gate are unchanged.

**No earlier decision is contradicted.** Round 6 Q1 condition 6 and Round 6 Q2 condition 3 require "its own decision with its own distribution"; this is that decision, on the 49-run distribution. **It departs from the `REPEATED` comment "One n for both legs"**: this key is windows-only, because Linux shows no tail (70 runs, max 4.43).

Binding conditions:
1. **The rule (exact shape is the implementer's choice, in `REPEATED`, one place):**
   - windows `S1/short` runs n = 5 fresh, isolated repetitions, one after another;
   - `growth:proxy` is RED when ≥ 3 of 5 repetitions are RED under the unchanged `growth()` (commit value > 5 AND trend); the reported value is the median;
   - **every** repetition must be ≤ 10 %/1k on commit (a ceiling: 4.73 above the observed max, z = 7.1);
   - every other S1/short check (`procPeak`, `steady`, `count`, `orphans`, `commit-backstop`) is judged in **each** repetition, and a RED in any one fails;
   - `summary.json` and the job summary print all five values, trends and the median.

   Linux `S1/short` stays a single run.
2. **Why n = 5.** It is the smallest odd n whose predicted false-RED rate is ≤ 1 % on the less favourable fit (log-normal p = 0.078: n = 3 → 1.73 %, n = 5 → 0.42 %; empirical 2/49: 0.06 %; at the 95 % upper bound p = 0.14: 2.2 %). The bar is stricter than Round 6 Q1's 5 % because the job's false-RED rate is the sum over its keys. It costs about 18 min on a 42-min windows job, against a 150-min timeout.
3. **Tests, RED first:**
   - five fixture repetitions with 2 RED pass;
   - 3 RED fail;
   - one repetition at 10.1 %/1k fails with a GREEN median;
   - one repetition with `steady` RED fails;
   - a missing repetition is a harness failure;
   - the S1/burst1 cases are unchanged.
4. **Records.** Spec §18 S1 row gains the rule. METRICS gets the 49-run windows table and the 70-run Linux range. Tickets 20 and 61 gain a Comments line: their "S1 stays GREEN / does not regress" criteria are judged under this rule on windows. RUNLOG records correction 1. **No revert is owed for 42382114395:** this round attributes it to the pre-existing tail on unchanged code.

**Rationale:** Two REDs in 49 runs, on a variant whose WS growth is about zero and whose Linux twin never exceeds 4.43, describe a commit-noise tail around a mean of 3.4 against a 5 budget. They do not describe a defect that any queued ticket fixes. The Round 6 Q1 repetition rule is the measured, budget-preserving answer to exactly this shape. Its ceiling and per-repetition hard checks keep it stricter than today on everything except the tail itself. Owning the RED instead would invent a trace or tolerate unbounded growth.

**Charter:** C1 (proxy growth stays gated at 5 %/1k, with a ceiling it lacks today), C7 (windows fixed, Linux unchanged), C9 (stronger measured evidence: 49 + 70 runs; smaller blast radius: one key on one leg), §9, Round 6 Q1 conditions 2–6, Round 6 Q2 conditions 1 and 3, Round 7 Q1 condition 1, Round 15 Q1 conditions 2 and 6, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (test code and spec text). ADR: no.

---

## Q4 — ticket 03's floor test: "no-op hook charged 2.55 MB" (1 of 16 windows legs)

**DECISION:** REJECTED in part. Neither (a) nor (b) is taken as stated. The 2.5 MB floor threshold and the 5 MB waiter gate are unchanged. The floor test becomes **n fresh-host repetitions with two clauses**:
- the **median** no-op cost is < 2.5 MB;
- **every** repetition is < 5 MB;
- every value is printed, pass or fail.

n is set in ticket 71 from measured data. The finding goes to ticket 35, where the gate becomes live.

Why each option is rejected:
- **(a), "like the burst1 median rule", is wrong as stated.** Burst1's median is the gate's own statistic. The waiter gate stays one measurement per host, so a median-only floor would claim a noise floor the gate does not have. The every-repetition < 5 clause is what ties the test to the gate: no single no-op measurement may reach it.
- **(b) has no defined goal.** Ticket 03 already removed the two known baseline errors (stdin reader, post-GC baseline; floor 4.9 → 0.63–0.75 MB on Linux). Nothing on record shows that a deterministic subtraction of windows commit exists.

Binding conditions:
1. **n from data (Round 6 Q1 condition 2's method).** 71 first records ≥ 20 no-op measurements on windows CI and ≥ 20 on Linux CI, through an off-by-default mode, with the values in METRICS. n is the smallest odd number in {3, 5, 7, 9} whose predicted false-fail rate (binomial on the measured fraction above 2.5 MB, less favourable leg) is ≤ 1 %. If none reaches it, or any no-op measurement is ≥ 5 MB, it comes back with the numbers. Nobody raises 2.5.
2. **Ticket 35 gains an Acceptance line:** "Windows waiter gate (Round 17 Q4): before removing `omp:concurrent-preflights`, record every waiter's commit and WS cost over ≥ 10 windows runs beside ticket 71's windows no-op floor distribution. If any waiter exceeds 5 MB on commit, or the floor's maximum plus the waiter's measured cost leaves no margin, it comes back with the numbers. A commit-only RED follows Round 6 Q2 condition 1, and the 5 MB gate is never loosened." Edge **35 ← 71**.
3. **Ticket 03's Comments** gain one line: the floor finding (2.55 MB, run 42436440284) was brought back as its text required, and was decided in Round 17 Q4.

**Rationale:** The floor test did its job: it found that the windows commit floor reaches the half-gate in about 1 of 16 runs. Linux waiters cost 3.3–4.1 MB, so that matters for ticket 35, not for ticket 03. A single-sample assertion cannot measure a tail. n samples with a median clause and a gate clause measure both the typical floor and the gate-relevant tail, and keep both thresholds. Sending the number to 35 puts it where a false waiter RED would otherwise appear later.

**Charter:** C9 (stronger evidence: measure before fixing n; simpler: no undefined "deterministic" ticket), C7 (windows evidence drives the windows gate), §9 / ADR-0013 condition 4 (5 MB per host unchanged), Round 6 Q1 condition 2, Round 6 Q2 condition 1, ticket 03 decision 8.

**REVERSIBILITY:** Two-way door (one test and ticket text). ADR: no.

---

## Cross-question conditions (binding for Q1–Q4)

1. **New ticket 71**, "Measurement rules for three rare tails: S7 retained heap, windows S1/short repetitions, the OMP no-op floor":
   - `Status: ready-for-agent`, Model sol, Risk low, ADR no, **blocked by 67**;
   - content: Q1 conditions 1–4, Q3 conditions 1–4, Q4 condition 1;
   - INDEX.md gains its row, and row 35 gains blocker 71.

   It is one ticket, not three. Three tickets would each need a pre-merge run exposed to the other two tails; one tree lets a single run confirm all three. 71's pre-merge run confirms, it does not decide. Any of the three signatures there is a disagreement and comes back. Acyclicity: 67 has no blockers, and 71's descendants (35, then 37 and 55) do not include 67.
2. **Interim until the fix lands** (71 for the signatures from Q1, Q3 and Q4; 67 for Q2's). A staged or post-merge run whose **only** failures match one of the signatures below does not count against the ticket, does not block its merge, and causes no revert. The condition: the ticket's diff does not touch the code that signature executes. Each occurrence is recorded in 71's Comments (or 30's, for S5) with the run id and values. The signatures:
   - (i) S7/short `responses-store:heap-at-cap` RED, either leg, value ≤ 128 MB, every other S7 check as listed. Ineligible: `zcode-proxy-src/**`, `s7-disk.mjs`, `proxy-session.mjs`;
   - (ii) windows S1/short RED only on commit on `growth:proxy` alone, ≤ 10 %/1k. Ineligible: `zcode-proxy-src/**`, `s1-proxy-steady.mjs`;
   - (iii) the floor test failing with a no-op cost < 5 MB. Ineligible: `fixtures/omp-host.ts`, `lib/omp-host.mjs`, the generated OMP extension;
   - (iv) linux S5/short "GREEN but listed" with `growth:mcp-bridge` > 5 %/1k and every other S5 check GREEN. Ineligible: `mcp/**`, `s5-mcp.mjs`.

   For every signature, a change to `tests/memory/lib/{verdict,budgets,sampler*}.mjs` or to the Bun pin also makes a ticket ineligible.

   **This explicitly departs from:**
   - Round 13 Q1 condition 6, which had a ticket in this position restaged after the fix;
   - Round 6 Q2 condition 4's last bullet and PROMPT §7 Phase 4's revert rule, for these four signatures only.

   It is not a rerun-until-green, because nothing is rerun: each cause is decided here and owned by a named ticket, and the exception ends when that ticket merges. A ticket whose diff touches the measured code gets no exception, so the code that could cause a real regression is never covered.
3. **67's merge gate (amends Round 16 Q2 condition 2).** Runs 42436010878 and 42436354758 count as valid floor runs. Their only ratchet failures are signatures (i) and (ii), which are excluded from the replay judgement. Run 42436186573 passes the replay with Q2's mark. 67's final pre-merge run falls under condition 2. The test-kit failure `manager-safety.test.mjs:160` is ticket 70's and is not decided here.

---

## Shared understanding

Open branches I still see (none blocks 67 or 71):
- **Ticket 70's stop flake still blocks merges** at an unknown rate (1 of 16 windows test-kit legs here). Condition 2 does not cover it; it needs 70's RED-first evidence.
- **The short-profile S7 check cannot tell an unbounded store from a bounded one** (1,500 × 64 KB = 93.75 MiB against 96 MB; correction 3). The long profile can. Raising the short load could push S7's `procPeak:proxy` (WS 217 of 250 on windows) into a new tail. It comes back as its own question if the orchestrator wants it fixed before the Phase 6 long-profile run.
- **Windows S1/short commit growth (mean 3.4 %/1k) while WS is about 0** is not attributed (allocator commit vs heap). Q3 needs no attribution. If ticket 19 or 20 moves the commit mean toward 5, the 5-repetition rule will show it as more repetitions RED, and the numbers come back.
- **Linux S5/short has no value ceiling** under its owned listing, as before Q2. A bridge regression from 42 to 100 %/1k would pass until ticket 30.
- **Integration-run memory legs went unchecked once** (42382114395, correction 1). The orchestrator should read the memory ratchet line of every post-merge run, as Phase 4 requires.
- **The job's aggregate false-RED rate** is the sum over its keys. The largest remaining predicted term is S1/burst1 at about 3.8 % per Linux run (Round 11). If it starts blocking merges, it comes back with its distribution.


---

# Round 18 (2026-11-08) — ticket 19 memory result: S1 owners, burst32, ADR-0004 factor


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–16 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision. Round 17 is being answered in parallel. Where the two rounds touch, this file says so (Q2 condition 6, Shared understanding).

I checked the evidence myself, read-only:
- `ticket/19-admission-control` at c1fb594 (`git -C /home/AgentKit/wt/t19 show HEAD:…`): `issues/19-*.md` (implementer report), `tests/memory/expected-red.json`, `zcode-proxy-src/src/server/admission.ts:33-47, 272-293` (cap constant and `admissionCost`), `tests/memory/scenarios/s1-proxy-steady.mjs:52-61, 116-126` (body construction, bigbody mix and pacing).
- `ticket/67-owned-checks` at 8901fae: `tests/memory/expected-red.json` (owners/flips schema; every S1 burst entry is `{ "owners": { "19": ["procPeak:proxy"] } }`, with no `flips`), `METRICS.md` S1 rows.
- Integration tree f087813: `docs/adr/0004-*.md`, `docs/adr/0008-*.md:7`, `issues/19-*.md`, `20-*.md`, `21-*.md`, `INDEX.md`, `tests/memory/expected-red.json` (the plain `"S1/burst32": "19"` entry is still present on both legs), `spec.md:633-634, 648`, `METRICS.md:33, 50-60, 215-240`, PROMPT §9, DECISIONS.md Round 1 Q5, Rounds 6, 9, 14, 15 and 16 in full, `rounds/round-17.md`.
- Logs in `reports/`: `t19-meas-impl.log` (5 runs at 93cb559), `t19-final-meas.log` (20 burst32 runs at cfdcbb9, plus S1/short, stalled, burst1 ×7), `t19-final-job.log` (144c031), `t19-v2-meas.log` (the variant that was not adopted).

**Statistics, recomputed** (python, from the log values):
- burst32 at cfdcbb9, 20 runs: median 549.65, min 479.8, max 608.5, mean 550.9, sd 32.5, 2 above 600 (602, 608.5). p = 0.10, Clopper–Pearson 95 % interval 0.012–0.317. Pooled with the 5 runs at 93cb559 and the final job: 2 of 26 above 600, p = 0.077 (0.009–0.251), median 551.6.
- 5-run medians: burst4 329.2 (296.2–371), burst16 488.6 (428.5–524.5), bigbody 358.3 (329.8–375.1). Against the single tip run: −10.1 %, −46.5 %, −14.2 %, and burst32 −56.8 % (20-run median) or −55.0 % (5-run median 573).
- A median of n repetitions at p = 0.10 goes RED with probability 2.8 % (n = 3) and 0.86 % (n = 5). At the interval's upper end, p = 0.32, those rates are 24 % and 19 %.

**Corrections to the round's facts.**
1. **Six bodies are admitted under the cap, not five.** The cap is 64 MiB (`DEFAULT_MAX_IN_FLIGHT_BYTES = 64 * 1024 * 1024` = 67,108,864 B). A request is charged its `Content-Length`. The S1 body is `"lorem ipsum dolor sit amet "` × 400,000 = 10,800,000 B plus about 100 B of JSON. 6 × 10.8 MB = 64.8 MB fits, and 7 does not. So burst16 and burst32 hold **64.8 MB** in flight, not 54.
2. **The factor, recomputed on ADR-0004's own formula** (peak = ~90 MB base + factor × MB in flight):
   - burst16, 6 bodies: (488.6 − 90) / 64.8 = **6.2 MB per MB** at the median, range 5.2–6.7.
   - burst32, the same 6 bodies plus up to 26 queued requests: median 7.1, range 6.0–8.0. The ~61 MB between the burst16 and burst32 medians, with the same bytes admitted, is a cost of the queue, not of the bytes in flight.
   - burst4, 43.2 MB, where the cap does not bind: 5.5.
   - burst1, one 10.8 MB body at a time: (182.7 − 90) / 10.8 = 8.6.
   - On the tip, unbounded, the same formula gives 4.8 at burst16 and 3.4 at burst32. That is where the ~4.5 came from.

   The round's "7–8 MB per MB" comes out only as (peak − 90) / 54 with five bodies, or as total RSS / 64.8 at burst16 (6.6–8.1). The ratio is also not constant: 5.5–8.6 across the variants. A single linear factor does not predict the peaks.
3. **The "1 linux job in 10" figure is local only.** All 26 burst32 values come from this machine. CI's Linux S1 peaks have run higher than local ones before (Rounds 10–11: the CI Bun 1.4.2 arm had S1/burst1 above 250 MB in 5 of 24 runs). The windows leg has **no** value on 19's tree. EVIDENCE MISSING: the CI distribution of every S1 burst key on 19's tree, on both legs. Q2 condition 1 supplies it.
4. **`S1/burst32` has not left the list.** The deletion is ccd5d27, on the unmerged branch. The integration list still holds `"S1/burst32": "19"` on both legs. So keeping the key listed is a re-point, not a re-add (Round 15 Q1 condition 5 forbids re-adds).
5. **bigbody is paced.** It sends 240 requests at 4 requests/s and concurrency 16, mixing 10.8 MB text bodies with 8 MB images. The cap binds only some of the time.
6. **Stale text.** Ticket 20's Acceptance cites "baseline ~4.5 MB RSS per MB". Spec §18 (`spec.md:634`) and ADR-0004 point 7 say "the byte cap alone: 64 × ~4.5 + ~90 ≈ 380 MB". ADR-0008:7 derives its "designed maximum of about 450 MB" from the same 4.5.
7. **The collection is a lever, not part of the contract.** One deferred full GC runs after a release of ≥ 4 MiB. The cap without it left burst32 at 677.8 and 733.8 MB, RED. With it, burst32 is GREEN at the median. The collection is part of why 600 MB is met. Its pause length while other streams are open was not measured (Shared understanding).

---

## Q1 — who owns `S1/burst4`, `S1/burst16`, `S1/bigbody` now?

**DECISION:** ACCEPTED with conditions. Owner **20**, on both legs, check `procPeak:proxy`. Ticket 19's memory criterion is amended so that 19 can close on what admission delivers. Ticket 20's Acceptance names the three budgets, plus burst32's (Q2). No budget changes. No new ticket. No new edge: 55 ← 20 and 61 ← 20 already exist.

**This explicitly contradicts Round 1 Q5 condition 5**, "the byte cap alone meets both budgets". The measurement refutes it: burst16 has a median of 488.6 MB against a budget of 400 with the cap in place. The budgets now need the cap (point 1) and fewer copies (point 6) together. Round 6 Q1 condition 6 said that burst4 and bigbody "come back with numbers once ticket 19 lands". This is that return. No other earlier decision is contradicted.

Binding conditions:
1. **Trace (Round 15 Q1 condition 2).** Once 19's line below replaces its budget line, 20 is the only claimant: its new Acceptance line names each key and its budget. 20 is also 19's descendant on the blocking graph (20 ← 19), so the several-claimants rule gives the same owner. ADR-0004 point 6 names the mechanism.
2. **Ticket 19's Acceptance.** Replace the line "Loop S1 burst: HWM ≤ 400 MB at 16 and ≤ 600 MB at 32 × 10.8 MB bodies (≥ 30 % peak improvement); bigbody within budget. **Delete `S1/burst4`, `S1/burst16`, `S1/burst32`, `S1/bigbody` (linux, windows).**" with:
   > - [ ] Loop S1 (Round 18 Q1): `procPeak:proxy` improves by ≥ 30 % at S1/burst16 and S1/burst32 on each leg. Linux: the tip f906014 against this branch (burst16 912.9 → 488.6, 5-run median; burst32 1,272.4 → 549.7, 20-run median). Windows: the median of the ≥ 10 staging/19 CI runs (Round 18 Q2 condition 1) on the WS gate, against the median of ticket 67's matching windows runs on the pre-19 tree. S1/burst4 and S1/bigbody are recorded per leg. The byte cap's hard bound is proven by the seam-4 loopback tests above. 19's `procPeak:proxy` names in `S1/burst4`, `S1/burst16`, `S1/burst32` and `S1/bigbody` (both legs) move to ticket 20 in 19's commit (Round 18 Q1 and Q2). The budgets (≤ 250 / 400 / 600 / 250 MB) are ticket 20's criteria.

   If windows misses ≥ 30 % at burst16 or burst32, 19 comes back with the numbers.
3. **Ticket 20's Acceptance gains:**
   > - [ ] Loop S1, both legs (Round 18 Q1/Q2): `procPeak:proxy` ≤ 250 MB (S1/burst4), ≤ 400 MB (S1/burst16), ≤ 600 MB (S1/burst32), ≤ 250 MB (S1/bigbody). Linux judges RSS, windows the WS gate (Round 7 Q1). 20 removes its names from these four entries with Round 15 Q1 condition 5's evidence. For a name RED in every matching run: 20's recorded loop runs plus its pre-merge CI run GREEN on that check and leg. For a `flips` name: ≥ 10 GREEN matching CI runs of that leg on 20's tree. If a budget cannot be reached, 20 comes back with numbers per key and leg. It also names the levers outside 20, measured or not: a lower `server.admission.maxInFlightMB` default, a body-processing concurrency limit (Round 1 Q5 condition 2; ticket 19's table is the first evidence for it), and Bun `--smol`. The budgets are never loosened, and the names stay under 20 until then.

   In the existing line, "(baseline ~4.5 MB RSS per MB)" becomes "(baseline: ticket 19's tree, ADR-0004 amendment of Round 18; per copy removed, record the S1/burst4/16/32/bigbody peaks and (peak − 90) / MB admitted)".
4. **Comments.** 19 and 20 each get a line naming this round. 19's line corrects "5 bodies of 10.8 MB" to 6 bodies, 64.8 MB (correction 1). 20's line says that a passing burst entry is ungated against regressions while listed (Shared understanding) and that 20 measures against the ≥ 10-run distribution of Q2 condition 1. "Comes back with numbers" covers every key.
5. **Merge check (Round 15 Q1 condition 5).** 19's evidence lists every name it owned with its status ("moved to 20, Round 18"). After the move, 19 owns no S1 name, unless Round 17 Q3 gives it one (Q2 condition 6).
6. **Nothing else changes:** the four budgets, the 64 MB default, ADR-0004's shed contract, n = 7 and the windows `S1/burst1` `unstable` entry with its only exit (Round 9 Q1 condition 4). Linux burst1's 182.7 MB median edits nothing.

**Rationale:** The evidence settles that admission alone cannot meet these budgets. Burst4 holds 43.2 MB, below the cap, so the cap never acts on it. Burst16 holds the full 64.8 MB and still peaks at 489 MB. Bigbody is paced. What remains between the measured peaks and the budgets is per-body overhead, and that is exactly the subject of 20's What-to-build and ADR-0004 point 6. Keeping the names under 19 would leave a finished, high-risk ticket open on criteria its mechanism cannot reach. Moving them silently would break Round 15's "only the owner removes its names". A named re-assignment in an Owner Proxy round, with numbers, is the return path Round 16 Q3 described ("the Owner Proxy then decides the follow-up's names in the open"). 19 keeps a measurable criterion of its own: ≥ 30 % at the two variants where the cap binds, on both legs. That is §9's rule applied to the share 19 can deliver. The budgets stay whole and move to the ticket that can meet them. If it cannot, the numbers come back.

**Charter:** C1 (bounded in-flight bytes proven at seam 4; memory budgets kept, with an owner able to meet them), C7 (≥ 30 % checked on windows, not assumed), C9 (stronger measured evidence: 26 + 15 loop runs; smaller blast radius: ticket text and owner ids, no budget or default change), §9 (no budget loosened; the ≥ 30 % rule applied), Round 1 Q5 conditions 2 and 4, Round 6 Q1 conditions 4 and 6, Round 15 Q1 conditions 2 and 5, Round 16 Q3.

**REVERSIBILITY:** Two-way door (ticket text and owner ids). ADR: no. ADR-0004's consequence is recorded under Q3.

---

## Q2 — `S1/burst32`: delete now, or keep listed?

**DECISION:** REJECTED in part.
- **Accepted:** `S1/burst32` stays listed on both legs under owner 20 (`procPeak:proxy`), on ticket 67's schema. 67 merges first, and 19 is restaged on 67's schema before its pre-merge run. ccd5d27's deletion is reverted on 19's branch. 20 deletes the entry through Round 15's flipping-name rule.
- **Rejected:**
  - marking `flips` from the 2 of 20 local runs and one windows pre-merge run;
  - deleting the entry (the implementer's choice);
  - holding 19 until 20 lands.

  The `flips` marks for every S1 burst key are set from ≥ 10 matching CI runs per leg on 19's tree.

**This explicitly contradicts Round 15 Q1 condition 4**, "a name is marked only by 67 … A mark is never added later". For S1 keys on 19's tree, 19's restaged commit sets marks. It sets them by condition 4's own test (RED in fewer than all matching runs of the leg) and Round 15 Q2's counting (CI runs only). This is the return path Round 16 Q2 condition 3(c) named for a name that turns GREEN after a merge. It is not a silent mark. It also departs from Round 6 Q2 condition 2's "removal with numbers" in one respect: under condition 3 below, a local RED can block a deletion. The local runs still never set a mark.

Binding conditions:
1. **Evidence before 19 merges.** ≥ 10 valid CI runs of the full short profile on staging/19, on both legs (one run covers both). The S1 matching rule is METRICS.md's rule applied to S1: the same `s1-proxy-steady.mjs`, `verdict.mjs`, `budgets.mjs` and proxy request path (`zcode-proxy-src/src/server/*`, both `handler.ts`, `config/loader.ts`), on Bun 1.4.2. 19 changes that path, so every S1 key's matching count restarts on 19's tree (Round 15 Q2 condition 2, Round 16 Q2). The runs may start now, on the tree with burst32 deleted. Each run's S1 RED sets are replayed through 67's final ratchet with this round's S1 entries (`t67-scripts/replay.mjs`, Round 16 Q2 condition 2). Restaging onto 67 does not reset the count, because the list, `ratchet.mjs` and the tests are outside the matching rule. METRICS.md records every value per key and leg. The 26 local burst32 values go there as a labelled supplement.
2. **Marks from those runs, per S1 burst key and leg** (Round 15 Q1 condition 4's test):
   - RED in some runs and GREEN in others: owner 20, marked `flips`;
   - RED in every run: owner 20, no mark;
   - GREEN in every run: 19's commit deletes that leg's entry and cites the run ids (the ≥ 10-GREEN floor is met). The exception is condition 3.
3. **Linux burst32 keeps a mark whatever the CI count shows**, unless it is RED in every run, in which case it carries no mark. The local supplement shows the check RED in 2 of 26 runs on this code. Deleting the entry would make an unlisted RED likely about once every 10–13 jobs (p 0.077–0.10), which is the random merge block that Rounds 9, 13 and 15 refused. A local RED can block a deletion. It can never set a mark (Round 15 Q2 condition 1 stands).
4. **What comes back with run ids, with no rerun-until-green and no list edit in between:**
   - any S1 RED not owned under this round (for example a ceiling, `count:proxy`, an orphan, a linux S1/short or S1/stalled RED);
   - windows `S1/stalled` (owner 61, no mark) GREEN in any run (Round 16 Q2 condition 3(d));
   - a windows `S1/burst1` result outside its `unstable` bounds;
   - a harness failure or an invalid run, which does not count.

   Rare REDs on non-S1 keys follow Round 17's answers and do not invalidate a run's S1 count, provided the run's summary table printed.
5. **Expected default.** Linux burst32 marked `flips`. Linux burst4, burst16 and bigbody unmarked. Windows decided by condition 2. 19's pre-merge run on its restaged tip passes the ratchet and counts as one more run. No owner list or mark changes after it.
6. **Round 17 interplay.** This answer does not depend on Round 17's outcome, with one addition. If Round 17 Q3 lists windows `S1/short` (`growth:proxy`), that key's matching runs also restart on 19's tree, because 19 changes S1's request path, and the staging/19 runs are its floor too. If Round 17 names 19 as that key's owner, 19 holds that name: it lists the name in its merge check and closes only after removing it with ≥ 10 GREEN windows CI runs on its tree (Round 15 Q1 condition 5). For the record, 19's text, before and after Q1, names no growth bound. Its only S1/short evidence is linux GREEN at 2.46 %/1k.

**Rationale:** Each option has a measured cost:
- **Deleted:** the entry fails about one linux job in 10–13 at random, and windows is unknown.
- **Listed plain:** it fails about nine in ten as GREEN-but-listed.
- **Holding 19 for 20:** a high-risk, finished ticket waits on a medium ticket that is blocked by it, and three other tickets wait behind 19 (21, 39, 58).

Listing with a measured `flips` mark is the only state that passes deterministically, and it uses the mechanism Round 15 built for exactly this case. The recommendation's evidence for the mark is the weak part. Round 15 Q2 rejected local runs for marks because CI behaved differently, and S1 has a history of CI peaks above local ones. One windows run cannot show that a check flips. Ten CI runs cost no local resources, settle the windows distribution that is still missing for all four keys, and turn the mark into Round 15's own test rather than an exception to it. The cost of listing is that a burst32 regression passes as an owned RED until 20 removes the name. The listed burst4, burst16 and bigbody entries already have that cost, as all four had before 19, and the gap closes at the very next ticket in the chain.

**Charter:** C1 (bounded memory still proven by every non-owned check; no random merge blocks that would revert good work), C7 (windows decided on its own numbers), C9 (stronger measured evidence: CI runs over local runs; smaller blast radius: one entry per leg, an existing mechanism, no new code), Round 9 Q1 condition 3 (`unstable` not extended), Round 15 Q1 conditions 4 and 5, Round 15 Q2 conditions 1 and 2, Round 16 Q2 conditions 2 and 3, PROMPT §0, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (list entries, marks and run scheduling). ADR: no.

---

## Q3 — ADR-0004's per-MB factor

**DECISION:** ACCEPTED with corrections. ADR-0004 gets an amendment that records the measured result with the corrected numbers: 6 bodies and 64.8 MB, a factor of about 6.2 at burst16, and a ratio that is not constant. It supersedes point 7's "the byte cap alone meets both". The 64 MB default stays. Ticket 20 re-measures, and the ADR gets a second amendment with its result. Spec §18 and ADR-0008 get matching one-line corrections. Every threshold and budget is unchanged. **ADR: yes** (an amendment to ADR-0004, with a cross-reference note in ADR-0008).

**This explicitly contradicts Round 1 Q5 condition 5**, as Q1 does. Nothing else is contradicted. The shed contract, the queue bounds, the idle rule (Round 5 Q4) and the no-concurrency-cap decision (Round 1 Q5 condition 2) stand.

Binding conditions:
1. **Append to ADR-0004:**
   > ## Amended 2026-11-08 (Round 18, Q1–Q3)
   >
   > Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 18.
   >
   > - **The factor under the cap (ticket 19, linux, RSS).** The default cap is 64 MiB (67,108,864 bytes; the key `server.admission.maxInFlightMB` counts MiB), so six 10.8 MB bodies (64.8 MB) are admitted at once. With them, S1/burst16 peaks at 428.5–524.5 MB (median 488.6, 5 runs): about 6.2 MB RSS per MB admitted above a ~90 MB base (5.2–6.7), not the ~4.5 measured at 16–32 unbounded bodies. S1/burst32 peaks at 479.8–608.5 MB (median 549.7, 20 runs; 2 above 600) with the same bytes admitted. The ~61 MB more than burst16 is the cost of the queued requests. The ratio is not constant (5.5 at 4 bodies, 8.6 at 1), so the linear formula in point 7 does not predict peaks.
   > - **Point 7's "the byte cap alone meets both" is superseded.** On today's code the cap alone meets neither budget at 16 bodies, and meets 32 only at the median, with ticket 19's one deferred collection after a ≥ 4 MiB release (cap only: 678–734 MB). The budgets stand unchanged. They are met by points 1 and 6 together, and ticket 20 owns them (≤ 250 / 400 / 600 / 250 MB for S1/burst4 / burst16 / burst32 / bigbody). If 20 cannot reach them, the question comes back with numbers. The levers outside 20 are a lower cap default, a body-processing concurrency limit (point 5) and Bun `--smol`.
   > - **The 64 MB default stays.** No lower value has been measured, and a lower one would queue and shed parallel sessions sooner (point 5's reasoning). It is a two-way door through the config key.
   > - **Ticket 20 re-measures** (peak − 90) / MB admitted at S1/burst16 and burst32 per copy removed. The result is recorded here as a further amendment naming the ticket.
2. **Spec §18, `spec.md:634`.** "(the byte cap alone: 64 × ~4.5 + ~90 ≈ 380 MB)" becomes "(the byte cap plus fewer copies, ticket 20; under the cap alone, burst16 median 488.6 MB at 64.8 MB admitted, ADR-0004 amendment Round 18)". Mark it as a measurement-record amendment. Budgets unchanged.
3. **ADR-0008 gets a cross-reference note, and its thresholds do not change.** Its "designed maximum of about 450 MB … 64 MB × ~4.5" is out of date: the measured linux maximum under the cap is 608.5 MB (RSS, S1/burst32). The soft limit of 512 MB, which only WARNs, can therefore fire under legitimate cap-saturating load. The hard limit of 1024 MB has more than 400 MB of margin on linux. The windows footprint on 19's tree is EVIDENCE MISSING; Q2 condition 1's runs record it. Ticket 21 gets a Comments line naming this round: its evidence records the proxy footprint the supervisor samples, per leg, for the S1 burst runs on its tree. If that footprint can hold at or above 1024 MB for 3 samples, 21 comes back with numbers before it merges (C1: no restart storms).
4. **METRICS.md line 33** keeps its Phase 1B "~4.5 MB RSS per MB in flight" as history and gains the 19-tree figures next to it.
5. **Records.** RUNLOG names this round. The ADR amendment is written by the orchestrator, not by 19 or 20.

**Rationale:** The ADR is the place a later reader goes to learn why 64 MB was chosen and whether it meets the budgets. Today it says the cap alone suffices, and the measurement says it does not. Leaving that text in place would point ticket 20, ticket 21 (whose thresholds were derived from it) and any future tuning at a wrong model. The recommended wording would have recorded a factor that cannot be reproduced from the code (five bodies) and that hides the queue cost. The corrected amendment records what was measured and how to recompute it. Keeping the default is the reversible, evidence-backed choice: lowering the cap has no measurement behind it and costs parallel sessions directly. The re-measure after 20 closes the loop.

**Charter:** C1 (memory model and supervisor thresholds kept honest; no restart storm from a stale derivation), C2 (default unchanged; config key unchanged), C8 (ADR, spec and METRICS consistent), C9 (stronger measured evidence; then the smaller, reversible option: text only, no default change), §9 (no budget loosened), Round 1 Q5 conditions 2, 4 and 5, Round 5 Q4.

**REVERSIBILITY:** Two-way door for the text and the default. The ADR amendment records a hard-to-reverse fact (the shed contract's memory model) and is permanent history. **ADR: yes.**

---

## Shared understanding

Open branches I still see. None blocks 19 once Q2's runs are in and 67 has merged:
- **19 waits on 67.** If 67's merge is delayed by Round 17 (its rare REDs), 19 waits with it. Wall-clock time does not matter (PROMPT §0). The staging/19 runs can still run in the meantime.
- **burst4 and bigbody may be out of 20's reach.** The implementer's own estimate with copies halved gives about 263 MB at 4 bodies, still above 250. Expect the Q1 condition 3 return path. The named levers are not adopted now.
- **While listed, the S1 burst entries are ungated against regressions.** An owned RED passes at any value until 20 removes the name, as it did before 19. 20 measures against Q2 condition 1's recorded distribution, and its pre-merge evidence shows any drift.
- **EVIDENCE MISSING: the pause length of the coalesced `Bun.gc(true)` while other response streams are open.** It is a C1/C3 question (stalled streaming during a full collection). Nobody has measured it. If 20 or 21 measures stream latency, it belongs there. Today it is not a merge condition.
- **Round 17 Q3 (windows S1/short `growth:proxy`)** touches 19 only as described in Q2 condition 6. This file decides no owner for it.


---

# Round 19 (2026-11-08) — ticket 26 on Bun 1.4.2


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–18 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

I checked the evidence myself, read-only:
- `ticket/26-captcha-egress-bun` at 2378294 (`git -C /home/AgentKit/wt/t26 show HEAD:…`):
  - `issues/26-*.md` (the implementer report);
  - the diff 482eef5..HEAD, which touches only three files: `captcha-happy.ts` (+23/−6), `captcha-egress.test.ts` (+116) and the ticket;
  - `captcha-egress.test.ts:147-161`: the unset case is gated as `Bun.semver.satisfies(Bun.version, ">=1.4.3") ? it : it.failing`. The test name is "goes direct when the setting is unset, even with ambient HTTP(S)_PROXY" and **does not carry the version condition**. The recommendation's "with the version condition in the test name" is therefore a change still to be made, not a description of the branch;
  - `src/index.ts:244-253`: the `captcha egress:` banner already prints "explicit proxy (invalid URL; requests will fail)" for an invalid setting.
- Call sites: `captcha-happy.ts` is loaded only by `captcha-solver-worker.ts:69` (dynamic import) and by tests. `captchaFetch` (cookie priming `:1776`, passthrough `:399`) and the sync-XHR worker (`SYNC_WORKER_SRC`, a thread spawned inside the solver) both run inside the solver. Once ticket 27 runs the solver as a child process, **all** captcha egress runs in that child's process environment.
- `reports/t26-*`:
  - `probe2.log`: on 1.4.2 `proxy: false`, `""`, `null` and `undefined` all go via the ambient proxy; `{}` and `{url:""}` are rejected; `{respectNoProxy}` with `NO_PROXY=*` still goes via the proxy. On 1.4.3 and 1.4.4 only `false` goes direct. So **no per-request option gives a direct route on 1.4.2.**
  - `probe3.log`: env changes inside a Worker (delete, `NO_PROXY=*`, the `env` option) have no effect. Only a main-thread `NO_PROXY` does.
  - `probe-tf.log`: `it.failing` and `Bun.semver` work on 1.4.2.
  - `red-142`/`red-144`/`green-142`/`green-144`/`mutants`: match the report (five mutants killed, restored clean each time).
  - `green-142.log:11` prints the declared-failing case as `(pass)`, so it cannot be told apart from a real pass in the output.
  - `captcha-last.log`: 136 pass, 0 fail. `full-kit`: 836 / 817 pass / 0 fail / 19 skipped. `full-mcp`: 97 / 96 / 0 / 1. `full-proxy`: 1387 pass, 0 fail. `full-typecheck`: 0 `error TS`.
- `research/undici-yaml.md` items 2–3 and lines 73–79: the dispatcher is ignored (oven-sh/bun#38840), and Bun reads `HTTP(S)_PROXY`/`ALL_PROXY` on each fetch.
- Integration tree 5e99b52:
  - `lib/proxy-env.mjs`: the managed proxy strips `HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY` and the npm/yarn/pnpm proxy variables, in any case;
  - `proxy/config.example.yaml:57-59`: "ambient HTTP_PROXY/HTTPS_PROXY variables are ignored";
  - `spec.md` §2 (environment parity, thread transport = "tests and fallback") and §13;
  - `docs/adr/0002-*.md:46, 54`;
  - `issues/24`, `27`, `28`, `54`, `62`.
- DECISIONS.md Round 1 Q17, Round 2 Q2 condition 5, Round 5 (26 → Risk medium), Rounds 10–11 (the 1.4.2 pin, the re-entry rule in condition 4, the forgone-fix list, the release-note stay-back).

---

## Q1 — how does ticket 26 close when half of it needs Bun ≥ 1.4.3?

**DECISION:** REJECTED in part.

**Accepted:**
- Ticket 26 closes with the configured-proxy half and the fail-closed behaviour.
- Its unset-setting guarantee moves to ticket 27, which strips the ambient proxy variables from the solver child's environment.
- The `it.failing` declaration is accepted as the record of a known runtime gap.
- Ticket 62 records the gap.
- The pin stays at Bun 1.4.2.

**Rejected:**
- **"…unless `ZCODE_PROXY_UPSTREAM_PROXY` is set".** The child is spawned **always** without ambient proxy variables. The set is the one `lib/proxy-env.mjs` already strips: `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` in any case, plus the npm/yarn/pnpm proxy variables. Only the setting itself passes. When the setting is set, the configured URL reaches every routed fetch through the explicit `proxy:` option, which test 1 shows is honoured on 1.4.2. Leaving the ambient variables in the child would only keep a latent route for any fetch that does not pass `proxy:`. Ambient `NO_PROXY` would also leave open whether it bypasses the configured proxy. One unconditional rule is stricter (C6) and simpler (C9). Round 1 Q17 already decided that ambient variables are never an egress input.
- **"`it.failing` … with the version condition in the test name" as a description.** The branch's name lacks the condition (see the evidence above). The rename is a binding change, because the runner prints the declared-failing case as `(pass)` and the gap would otherwise be invisible.

**Explicit relation to earlier rounds:**
- **Round 1 Q17** stands as decided. Its premise that `proxy: false` gives a direct route holds only from Bun 1.4.3. On the 1.4.2 pin (Round 11) the guarantee is delivered by 26 and 27 together. This corrects the premise, not the decision.
- **Round 2 Q2 condition 5 / ADR-0002** ("the child gets the inputs the worker gets today"). **This narrows that wording explicitly.** The ambient proxy variables are no longer passed. They are not a solve input but the undeclared route Q17 removes. Solve inputs, outputs and the 90 s deadline stay byte-identical, and so do the unsandboxed flag, the CDN cache variables and the egress setting.
- **Round 11:** unchanged. This finding is **not** a reason to move the pin. 1.4.3 has failed the memory re-entry rule, and there is a 1.4.2 remedy that does not touch the proxy's own traffic.
- **Round 11 condition 4 (re-entry rule):** gains one explicit item (condition 4 below). It is a tightening already implied by C5's "passes the full test suite". It loosens nothing.

Binding conditions:

1. **Ticket 26 closes on this criterion** (the text is in "Ticket-text changes" below):
   - configured setting: fetch, sync-XHR and https CONNECT go through the configured proxy, and the ambient proxy and the targets receive nothing;
   - invalid setting: fails closed, and no listener receives anything;
   - unset setting with ambient variables: a plain test on Bun ≥ 1.4.3, declared `it.failing` on Bun < 1.4.3.

   The CI item ("fast suite and `memory-budget` on ubuntu and windows") stays open until the orchestrator has verified it after merge and push, as the ticket says. Nothing else is re-run.
2. **The declared-failing test.**
   - The gate stays exactly `>=1.4.3`.
   - The name gains the condition, for example: `goes direct when the setting is unset, even with ambient HTTP(S)_PROXY (declared failing on Bun < 1.4.3: proxy:false ignored, ticket 62)`.
   - The ticket's suite counts say "136 pass, including 1 declared-failing case on Bun 1.4.2" (and the same for the proxy suite's 1387).
   - The gap is not hidden: tests 1 and 3 use the same child harness, so a harness break still turns them RED. `it.failing` itself turns RED if the case passes unexpectedly.
   - This is an accepted known-gap record, not a skip. It is the only such declaration this round allows.
3. **Ticket 27 owns the process-level guarantee on 1.4.2.**
   - What it builds:
     - the solver child's environment excludes the ambient proxy set from the Rejected list, whether or not the setting is set;
     - `ZCODE_PROXY_UPSTREAM_PROXY` passes unchanged.
   - Its new seam-3 test runs on the pinned 1.4.2 as a **plain test with no version gate**. It goes through the child adapter, with mixed-case ambient `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` in the parent's environment:
     - unset → `captchaFetch` (http and https CONNECT) and the sync-XHR path go direct, and the ambient recording proxy receives nothing;
     - set → all three go only through the configured proxy;
     - a unit assertion that the child's environment holds none of the stripped names, in any case.

     The test uses loopback mocks only, on port 0.
   - The test must exercise the real `captchaFetch`/`syncFetchBlocking` inside the child. A fixture backend that bypasses them does not satisfy it.
   - Ticket 28 is unaffected.
4. **Ticket 62 records the gap and guards against re-gating.**
   - The forgone-fix list (Round 11 condition 4) gains an entry: "`fetch({ proxy: false })` ignored on 1.4.2 when ambient proxy variables are set". The entry carries:
     - the evidence (`reports/t26-probe2.log`, measured);
     - the primary release-note reference if one exists, otherwise "observed, not found in the release notes";
     - the kit path that hits it: captcha egress under the thread transport, plus the module-level test. The child adapter is covered by 27.
   - Re-entry gains item (v): the candidate passes `captcha-egress.test.ts` with the unset case running as a plain test. **The `>=1.4.3` gate is never moved to admit a candidate**, just as n is never raised.
5. **Residual exposure.** On Bun 1.4.2, after 27, ambient egress is possible only when all three hold:
   - a standalone proxy (the managed proxy is stripped by `proxyEnv`);
   - ambient proxy variables in its shell;
   - the thread transport.

   **EVIDENCE MISSING: how the thread transport ("tests and fallback", spec §2) is selected in a non-test run.** Ticket 27 decides this and records it. If the thread transport can run outside tests on Bun < 1.4.3, it comes back to the Owner Proxy as a finding. The question then is the `captcha egress:` banner's "direct" claim in that case. I do not prescribe banner wording now. Nothing reaches users before Phase 6 (B6), so the interim state on the integration branch is not a release exposure.
6. **Announced, not silent (C2, C8).**
   - Ticket 54's release notes gain one line: "On Bun, captcha egress now honours `ZCODE_PROXY_UPSTREAM_PROXY`. An invalid value now fails captcha requests, as the startup banner already stated and as Node already did."
   - If condition 5's residual is reachable in the shipped build, the Bun 1.4.2 stay-back text (Round 11 condition 6) also names it.
   - `config.example.yaml`'s "ambient … ignored" line stays. It is true for the managed proxy and, after 27, for the child adapter.
   - No README, SECURITY or SUPPORT_MATRIX change: no command, flag, env var or support claim changes.
7. **Records.**
   - Spec §13 gains one sentence: "On Bun < 1.4.3 `proxy: false` is ignored when ambient proxy variables are set. The unset case is then guaranteed by the solver child's environment (§2, ticket 27)."
   - Spec §2's environment-parity bullet gains the exclusion.
   - ADR-0002 gets an amendment line next to line 54: "Round 19: the solver process's environment also excludes the ambient proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, any case, and the npm/yarn/pnpm proxy variables); `ZCODE_PROXY_UPSTREAM_PROXY` passes."
   - RUNLOG records this round as narrowing Round 2 Q2 condition 5.

**Rationale:** The evidence settles that no change confined to captcha code can give a direct route on Bun 1.4.2:
- every per-request option either still takes the ambient proxy or is rejected (probe2);
- worker-scoped env changes are ignored (probe3);
- a process-wide `NO_PROXY` would reroute the proxy's own LLM traffic, which B1/C2 forbid.

Moving the pin is closed by Round 11's measured memory result. The process boundary that ticket 27 builds anyway is the only remedy inside the boundaries. Every captcha fetch runs in the solver, and a child's environment is its own, so stripping there closes the gap without touching anything else. Splitting the ticket this way keeps 26's verified gains: the configured setting is honoured, and an invalid URL now fails closed instead of silently taking the ambient route. Making the strip unconditional removes a branch and a latent route at no cost, because the configured URL is always passed explicitly. The test-name and count conditions exist because the runner reports the known gap as a pass.

**Charter:** C6 (no undeclared egress route; stricter, never weaker), B1 (routing and environment only; solve I/O, the 90 s deadline and challenge handling unchanged; the proxy's own traffic untouched), C2 (the managed proxy is unchanged; the invalid-URL behaviour matches the banner and Node; announced in the release notes), C5 and C1 (the 1.4.2 pin from Round 11 stands; re-entry tightened, not loosened), C8 (spec, ADR amendment, release notes), C9 (stronger measured evidence: probes on three Bun versions and five killed mutants; smaller blast radius: one environment rule in an already-planned ticket; simpler: one unconditional strip set, shared in meaning with `proxyEnv`), Round 1 Q17, Round 2 Q2 condition 5 (narrowed explicitly), Round 11 conditions 4 and 6.

**REVERSIBILITY:** Two-way door: ticket text, a test name, an environment filter on a not-yet-built child and an amendment line. ADR: no new ADR; one amendment line in ADR-0002.

### Ticket-text changes (exact)

**`issues/26-captcha-egress-routing-under-bun.md`** — replace the single acceptance criterion with:

```
- [ ] Seam 3 test with a local recording proxy (Round 19): setting set → all captcha egress (`captchaFetch` http, sync-XHR, https CONNECT) goes through it and the ambient proxy receives nothing; setting invalid → all three fail closed and no listener receives anything; setting unset with ambient `HTTP(S)_PROXY` set → no proxy used, a plain test on Bun ≥ 1.4.3 and declared `it.failing` on Bun < 1.4.3 with that condition in the test name (gate `>=1.4.3`, never moved). On the pinned Bun 1.4.2 the unset-case guarantee is delivered by ticket 27 (solver child environment without ambient proxy variables).
```

and add a Comment: `- 2026-11-08 (orchestrator, Owner Proxy round 19, binding): closes on the amended criterion; the unset case on Bun 1.4.2 moves to ticket 27; suite counts include 1 declared-failing case on 1.4.2; the test name carries the version condition.`

**`captcha-egress.test.ts`** (on ticket 26's branch before merge) — the unset case's name becomes:
`goes direct when the setting is unset, even with ambient HTTP(S)_PROXY (declared failing on Bun < 1.4.3: proxy:false ignored, ticket 62)`

**`issues/27-solver-child-process.md`**:
- In What to build, replace `Environment parity: \`ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA\`, CDN cache variables and the egress setting pass; \`ZCODE_KIT_RESPAWN_*\` and \`ZCODE_KIT_STOP_TOKEN\` are excluded;` with:
  `Environment parity: \`ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA\`, CDN cache variables and the egress setting (\`ZCODE_PROXY_UPSTREAM_PROXY\`) pass; \`ZCODE_KIT_RESPAWN_*\`, \`ZCODE_KIT_STOP_TOKEN\` and the ambient proxy variables (\`HTTP_PROXY\`, \`HTTPS_PROXY\`, \`ALL_PROXY\`, \`NO_PROXY\`, any case, and the npm/yarn/pnpm proxy variables, the set \`lib/proxy-env.mjs\` strips) are excluded, whether or not the egress setting is set (Round 19);`
- Add acceptance items:
  ```
  - [ ] Seam 3 (egress, Round 19, from ticket 26): on the pinned Bun 1.4.2, through the child adapter, with mixed-case ambient `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` in the parent's environment: setting unset → the real `captchaFetch` (http and https CONNECT) and the sync-XHR path inside the child go direct and the ambient recording proxy receives nothing; setting set → all three go through the configured proxy only; the child's environment contains none of the excluded proxy names in any case. Plain test, no version gate; loopback mocks only.
  - [ ] The ticket records how the thread transport is selected outside tests. If it can run outside tests on Bun < 1.4.3, that returns to the Owner Proxy as a finding (Round 19 condition 5) before closing.
  ```

**`issues/62-bun-1-4-3-plus-s1-burst1-peak.md`**:
- Append to the re-entry rule paragraph: `Round 19: the candidate also passes \`captcha-egress.test.ts\` with the unset case running as a plain test; the \`>=1.4.3\` gate is never moved to admit a candidate.`
- Add acceptance item:
  ```
  - [ ] The forgone-fix list includes "`fetch({ proxy: false })` ignored on 1.4.2 when ambient proxy variables are set" (measured: reports/t26-probe2.log; primary release-note reference, or "observed, not found in the release notes"); kit path hit: captcha egress under the thread transport and the module-level egress test; the child adapter is covered by ticket 27's environment strip (Round 19).
  ```

**`issues/54-*.md`** — add a Comment: `- 2026-11-08 (orchestrator, Owner Proxy round 19, binding): release-notes line: "On Bun, captcha egress now honours ZCODE_PROXY_UPSTREAM_PROXY; an invalid value now fails captcha requests, as the startup banner already stated and as Node already did." If ticket 27's record shows the thread transport reachable outside tests on Bun < 1.4.3, the Bun 1.4.2 stay-back text also names the ambient-proxy gap.`

**`issues/28-*.md`** — no change.

---

## Shared understanding

Open branches I still see (none blocks merging ticket 26):
- **EVIDENCE MISSING:** how the thread transport is selected outside tests. Ticket 27 records it, and if it is reachable on Bun < 1.4.3 it returns as a finding about the `captcha egress:` banner (condition 5).
- Ticket 27's new egress test fails on 1.4.2 through the child adapter. That would mean Bun reads something other than the child's process environment, and it comes back as a question. No version gate is added to make it pass.
- Ticket 26's CI item (both `memory-budget` legs, fast suite on ubuntu and windows) is still to be verified after merge and push.


---

# Round 20 (2026-11-08) — ticket 25 CDN memory body cap


Evidence read (read-only):
- Ticket 25 at head a18d465: `git -C /home/AgentKit/wt/t25 show HEAD:.scratch/kit-overhaul/issues/25-bounded-collections-cdn-memory-and-stall-counters.md`, including the implementer's Decisions 1–3.
- `zcode-proxy-src/src/proxy/captcha-cdn-cache.ts` at a18d465, the whole file.
- `tests/memory/scenarios/s2-captcha.mjs:101-125` and `tests/memory/scenarios/s2-captcha-run.ts:95-109`, at a18d465.
- `docs/adr/0009-bounded-stores-and-task-retention.md` at a18d465.
- Reports `t25-s2-{before,after}-{1,2,3}.log`, `t25-s2-after64-1.log`, `t25-s2-exp32.log`, `t25-s2-exp24.log`, `t25-probe-D.log` and `t25-probe-budget.log`.
- `/home/AgentKit/overhaul-tools/t25-memloop/alternate.txt` and the run directories.
- spec.md §7 (bounds table, CDN memory row) and §18 (S2 CDN memory row), plus stories 62–64.
- `issues/25-*.md` and `issues/29-cdn-disk-cache-pruning.md`.
- DECISIONS.md Round 2 Q3, Round 15 Q1 (conditions 3, 5, 6 and 7) and Round 17 Q1.
- PROMPT.md §5 B1 and §9 BOUNDS.

**Corrections to the round's facts.**
1. **S2 does not measure what the recommendation's condition asks for.** Phase D (`s2-captcha-run.ts:95-109`) only calls `cache.put()` on 600 distinct URLs with 256 KiB bodies. It never calls `get()` or `load()`. S2's solves run against the fixture backend with egress blocked, so they never reach the vendor CDN. On S2's workload, the "CDN fetch count per solve" is zero both before and after the change, by construction. It cannot show whether a smaller memory tier causes more network fetches.
2. **The 392-invalidation replay proves the stall-counter bound, not the body cap.** That recording (`__fixtures__/stall-recording.json`) replays the stall path. It does not exercise eviction of memory-tier bytes, so it says nothing about how often bodies are fetched under a 32 MiB cap.
3. **The 64 MB budget is not "tightened".** The 64 MB bound in spec §7 and §18 and in ADR-0009 stays exactly as it is, as the memory the tier costs (`cdn-cache:memory-growth`). The 32 MiB is the mechanism that meets that bound: the bytes the tier may hold. Also, "Charter §9" is not a Charter clause. §9 is PROMPT's acceptance section, and its BOUNDS line names no number for this store.
4. **The headroom depends on the scenario.** Phase D run alone in a fresh process (`t25-probe-budget.log`) measures **70 MB at 32 MiB**, which is above 64. The 57–58 MB GREEN holds inside full S2/short, where phases A–C have already warmed the allocator. The Linux margin is 6–7 MB, and the windows number does not exist yet.
5. **Verified as stated:**
   - 64 MiB → 90 MB RED (`t25-s2-after64-1.log:52`).
   - 32 MiB → 57/57/57 MB (after-1..3) and 58 MB (exp32), 4/4 ok.
   - Before → 151 MB RED in 3/3 runs.
   - 24 MiB → 50 MB.
   - Windows is pending CI.
   - The ticket adds no config key or env override for the cap. It is the constant `CDN_MEMORY_MAX_BYTES`.

## Q1 — confirm or reject the 32 MiB body cap

**DECISION:** ACCEPTED with conditions. I confirm the cap of 32 MiB of bodies. I **REJECT** the recommendation's B1 evidence condition, because it cannot be measured on S2 (correction 1). A replay proof at seam 3 replaces it. Binding conditions:

1. **The cap.**
   - The memory tier holds ≤ 256 entries and ≤ 32 MiB (33,554,432 bytes) of bodies, as the code constant `CDN_MEMORY_MAX_BYTES`.
   - No config key and no env override. The ticket exposes none, so the recommendation's "as a config value if the ticket already exposes one" does not apply. Adding a knob nobody has asked for would add surface without evidence (C9, simpler).
   - The 64 MB budget of `cdn-cache:memory-growth` and the 256-entry limit are unchanged.

2. **B1 replay proof (replaces "CDN fetch count per solve on S2").** Add a seam-3 test, wired into `npm run test:proxy`, that replays a recorded sequence of `load()`, `get()` and `invalidate()` calls within one generation.
   - **The recording:**
     - distinct URLs whose bodies total more than 64 MiB, so both caps evict;
     - repeat reads of evicted URLs;
     - stall invalidations;
     - at least one TTL expiry on a fake clock.
   - **Three replays, each with a temp disk tier:**
     - (a) the pre-change cache, `captcha-cdn-cache.ts` at 8e11d15 evaluated verbatim, with an unbounded memory tier. This uses the same method as the stall recording.
     - (b) head at 32 MiB.
     - (c) head with the byte budget set to 64 MiB.
   - **What must match across (a), (b) and (c):**
     - the sequence of `fetchBody` invocations (URL, order and count) is identical;
     - every returned entry has identical body bytes, `sha256` and `fetchedAt`;
     - only `source` (memory or disk) may differ.
   - **Mutants that must be killed:**
     - a disk read-back that resets `fetchedAt`;
     - a read-back that skips the freshness check.
   - **Disk tier unavailable.** Record the fetch counts of (a), (b) and (c) in the ticket evidence. This is a recorded number, not a gate.

3. **Return paths.**
   - **The replay differs between (a) and (b) with the disk tier available.** It comes back with the numbers. The implementer changes neither the cap nor the test.
   - **The windows leg is RED.** The pre-merge CI windows memory leg must show `cdn-cache:memory-growth` ok. If it is RED, it comes back with the numbers: commit, working set and the Linux value (Round 6 Q2 condition 1, Round 15 Q1 condition 5). Three things are forbidden:
     - lowering the cap to 24 MiB unilaterally;
     - re-adding the name to `S2/short`;
     - touching the 64 MB budget.

4. **Records.** Apply the text changes below, with a Comments line naming this round. Decision 1 in ticket 25 gains three facts:
   - the 70 MB figure for phase D alone (correction 4);
   - that the GREEN is measured inside full S2/short;
   - the shared-directory read-back nuance (rationale, last paragraph).

**Rationale:**
- **Why a tier bound cannot be held as bytes.** The measurement shows that 64 MiB of held bodies cannot meet a 64 MB tier bound:
  - 90 MB in full S2;
  - 101 MB for phase D alone;
  - a plain-array control at +141/+74 MB, which places the overhead in the runtime's allocator, not in the cache.

  The honest choice under C1 is to keep the measured bound and shrink what the tier holds. Re-reading "64 MB" as bytes held would loosen the budget past what the check measures, which is forbidden.
- **Why 32 MiB.** It meets the check in 4/4 Linux runs. It is the larger of the two measured passing budgets, so it evicts least. 24 MiB buys margin at the cost of more evictions, with no evidence that the margin is needed.
- **Why B1 holds with the disk tier available.** On B1, the code settles the question more strongly than an S2 count could:
  - `get()` applies the same `fresh(fetchedAt)` test to memory and to the disk envelope (`captcha-cdn-cache.ts:84-107`);
  - promotion keeps `fetchedAt`;
  - `commit()` writes the envelope at the same moment it inserts into memory.

  So with the disk tier available, an entry evicted from memory produces the same network-fetch decision and the same bytes as an unbounded tier. Condition 2 turns that reading into a replay against the verbatim pre-change code, which is Round 2 Q3's rule ("changes memory, never which bytes are served") applied as a test.
- **Where a network fetch can still follow an eviction.** Only where the envelope is missing:
  - the disk tier is unavailable;
  - the envelope is corrupt;
  - another installation invalidated it;
  - ticket 29's 256 MB size prune removed it.

  Any memory bound has this effect, including the spec's own 64 MiB. Round 2 Q3 and ADR-0009 accepted it for the memory caches. It is the same in kind as the existing per-generation reset, which already empties memory at every recycle. Halving the cap moves the threshold. It does not create a new behaviour, and it touches nothing on B1's out-of-scope list (pass rates, client mimicry, rotation, quotas). It falls under the IN SCOPE item "hard memory caps, bounded pools".
- **Shared directory.** In the same way, a read-back from a directory shared with another installation can return that installation's newer envelope for the same URL. The pre-change code already does this at the start of every generation. The ticket records it rather than claiming it never happens.

**Consistency with earlier decisions:**
- **Round 2 Q3 / ADR-0009:** the 64 MB / 256 bound stands, and the tier is clarified, not changed.
- **Round 15 Q1:** 25 still owns `cdn-cache:memory-growth` at 64 MB. Its removal from `S2/short` still needs the windows pre-merge GREEN (condition 5).
- **Round 17 Q1:** the responses store stays unchanged. The ticket keeps 1,000 / 24 h / 64 MB, and this decision does not touch the store.
- **Spec:** "≤ 64 MB" is kept. The amended text names the body budget beside it.

No earlier round and no spec text is contradicted.

**EVIDENCE MISSING:** the real per-generation CDN working set (the number and size of distinct bodies one solver generation loads in real use). If it is below 32 MiB, the cap is never reached and nothing changes in practice. The decision does not depend on it, because condition 2 proves equivalence for any working set while the disk tier is available. It would size the disk-unavailable effect recorded in condition 2.

**Charter:**
- C1: the tier's memory is bounded by what the OS measures, and the bound is not redefined to fit.
- C9: stronger measured evidence (4/4 runs, plus the allocator control); then the smaller blast radius (one constant and docs; the 256-entry limit and the budget unchanged); then the simpler option (no new config key).
- C2: no key, flag or state change.
- C7: the windows leg is gated before the name is removed.
- C8: spec, ticket and ADR text aligned.
- PROMPT §5 B1, with its IN SCOPE "hard memory caps, bounded pools".
- PROMPT §9 BOUNDS.
- Round 2 Q3, Round 15 Q1 conditions 5 and 6, Round 17 Q1.

**REVERSIBILITY:** Two-way door. It is one constant behind an unchanged 64 MB check, and the cache contents are rebuilt every generation. **ADR: no.** ADR-0009 gains an amendment note for the record only.

### Exact text changes (the orchestrator applies them on ticket 25's branch before merge)

**Ticket 25, What to build.** Replace
`The CDN memory cache is bounded to ≤ 64 MB and ≤ 256 entries and resets with each solver generation;`
with
`The CDN memory cache is bounded to ≤ 64 MB of memory (\`cdn-cache:memory-growth\`) and ≤ 256 entries, holding ≤ 32 MiB of bodies (Round 20 Q1), and resets with each solver generation;`

**Ticket 25, Acceptance.** Add after the "Seam 3 (B1)" item:
`- [ ] Seam 3 (B1, Round 20 Q1): a recorded load/get/invalidate sequence within one generation (bodies > 64 MiB in total, repeat reads of evicted URLs, stall invalidations, a TTL expiry on a fake clock), replayed with a temp disk tier against the pre-change cache (8e11d15, verbatim, unbounded memory), head at 32 MiB and head at 64 MiB, makes identical \`fetchBody\` calls (URL, order, count) and returns identical bytes, \`sha256\` and \`fetchedAt\` (only \`source\` may differ); mutants "read-back resets fetchedAt" and "read-back skips the freshness check" are killed; the fetch counts with the disk tier unavailable are recorded for all three. A difference with the disk tier available comes back with the numbers.`
`- [ ] Loop S2 windows (Round 20 Q1): the pre-merge CI windows memory leg shows \`cdn-cache:memory-growth\` ok at 32 MiB; if RED it comes back with commit, working set and the Linux value — the cap, the list and the 64 MB budget are not changed.`

**Ticket 25, Comments.** Add:
`- 2026-11-08 (orchestrator, Owner Proxy round 20): Round 20 Q1 confirms Decision 1 (≤ 32 MiB of bodies, constant, no config key; 256 entries and the 64 MB check unchanged) and moves its B1 proof into Acceptance (seam 3 replay; S2 cannot count fetches: phase D only calls put() and egress is blocked). Decision 1's text gains: phase D alone measures 70 MB at 32 MiB, so the GREEN (57–58 MB, 6–7 MB margin on Linux) holds inside full S2/short; and a read-back from a shared directory may return another installation's newer envelope for the same URL, as every generation start already does.`

**spec.md §7, bounds table, row "CDN cache, memory".** Replace
`| CDN cache, memory | ≤ 64 MB and ≤ 256 entries; resets with each solver generation |`
with
`| CDN cache, memory | ≤ 64 MB of memory (measured, \`cdn-cache:memory-growth\`) and ≤ 256 entries; holds ≤ 32 MiB of bodies, because the runtime keeps evicted bodies' memory for a while (Round 20 Q1); an evicted entry is read back from its disk envelope or fetched again; resets with each solver generation |`

**spec.md §18, budget table, row "S2 CDN memory".** Replace
`| S2 CDN memory | ≤ 64 MB and ≤ 256 entries | +151 MB / 600 URLs | ADR-0009, loop |`
with
`| S2 CDN memory | ≤ 64 MB and ≤ 256 entries (32 MiB body budget: 57–58 MB on Linux in full S2/short; 64 MiB of bodies measured 90 MB) | +151 MB / 600 URLs | ADR-0009, loop, Round 20 Q1 |`

**Spec story 62:** unchanged. The user-facing bound is still 64 MB and 256 entries.

**ADR-0009.** Append:
`## Amended 2026-11-08 (Round 20, Q1)` / `The CDN memory cache's 64 MB bound is the memory the tier costs, as measured by \`cdn-cache:memory-growth\`. To meet it, the tier holds at most 32 MiB of bodies (and 256 entries): with 64 MiB held, S2 measured 90 MB, because the runtime keeps the memory of evicted bodies for a while. An evicted entry is read back from its disk envelope with the same bytes and \`fetchedAt\`, so with the disk tier available the network fetches are those of an unbounded tier (seam 3 replay, ticket 25). The bound and the two-way-door consequence are unchanged.`

**Ticket 29, Comments** (informational; no criterion, no ownership; Round 15 Q1 condition 6):
`- 2026-11-08 (orchestrator, Owner Proxy round 20): Round 20 Q1: the memory tier holds ≤ 32 MiB of bodies, and an entry evicted from memory is read back from its disk envelope. 29's size prune therefore decides when such an entry becomes a network fetch; 29's B1 evidence ("without serving different bytes") covers that case.`

**METRICS.md:** the S2 CDN row names the 32 MiB body budget beside the 64 MB bound, as the implementer suggested.

## Shared understanding

Open branches:
- **The windows leg of `cdn-cache:memory-growth` at 32 MiB is unmeasured.** A RED comes back under condition 3.
- **The 6–7 MB Linux margin depends on S2's phase order** (phase D alone: 70 MB). A future reorder of S2, or a runtime upgrade that changes allocator retention, can turn the check RED with no code change in the cache. That RED comes back as an unowned RED (Round 15 Q1 condition 5), not as a quiet cap change.
- **EVIDENCE MISSING: the real per-generation CDN working set.** It sizes only the disk-unavailable effect recorded under condition 2.
- **The interaction of ticket 29's 256 MB size prune with the memory tier** (an entry evicted from both tiers is fetched again) is 29's B1 evidence to give. It is not decided here.


---

# Round 21 (2026-11-08) — linux S6/short adversarial line-heap tail


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–20 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only; scratch copies outside the worktree in `/tmp/r21`):
- The linux `memory-budget` job log of run 42446461464, through `gh api …/actions/jobs/128626314087/logs`. `gh run view --log` returned an empty file, so I used the job-log API instead. I also read its windows memory log (job of the same run) and its `memory-budget-linux` artefact (`S6-short/…/summary.json`, all phase marks).
- The `memory-budget-linux` artefacts of all 10 staging/19 evidence runs (42446103818 … 42446746036). All 10 heads carry tree 6f25f13.
- The linux memory-job log of every completed CI run from 42415961268 (ticket 32's pre-merge run) to 42454650683: 34 runs. I checked each head with `git diff --quiet <head> HEAD -- zcode-proxy-src/src/tui tests/memory/scenarios/s6-tui*`. 33 judge the same S6 and pane code as the integration tip. The 34th, staging/42 (42415962768), predates 32.
- Integration tip 064cfec: `tests/memory/scenarios/s6-tui.mjs`, `s6-tui-run.ts`, `tests/memory/lib/budgets.mjs`, `tests/memory/lib/repetitions.mjs`, `zcode-proxy-src/src/tui/log-pane.ts` (and its imports `width.ts`, `width-core.mjs`, `frame.ts`, `tokens.mjs`).
- `issues/32-*.md` (with Comments), `49-*.md`, `71-*.md`, INDEX.md, spec §18 S6 row and §13 (S6 is ubuntu-only), RUNLOG to 07:14Z.
- DECISIONS.md Round 17 (Q1, Q3, cross-question conditions 1–3), Round 18 Q2 condition 5, Round 6 Q1, Round 15 Q1.
- Ticket 19's own diff: `git diff --stat $(git merge-base HEAD ef0a331c) ef0a331c`, 15 files.

**Corrections to the round's facts.**
1. **This is not a tail around the cap. It is a discrete 20 MB event at a different mark.** In all 32 GREEN CI runs on identical S6 code, the check reads exactly **8 MB**. The worst mark is `D-huge` (heap 10 − `C-start` 2: the 8 MB truncated line). In the RED run, `D-huge` is the usual 10 and `D-cjk` the usual 7. But `D-records` reads **22 MB** where the 9 other staging/19 runs read **2 MB** (9 of 9), and `end` reads 22 again (2 in 9 of 9). Pane 2,000 lines throughout, end RSS 242 MB (others 198–269).
2. **The readings are already taken after a forced GC.** `mark()` calls `Bun.gc(true)` before every reading (`s6-tui-run.ts:27-31`). The 20 MB survived two consecutive forced full collections, at `D-records` and `end` with a `scrollDown` between them. Round 17 Q1's premise does not hold here. That premise was a heap reading without GC, taken at a random moment, which a later reading undercuts.
3. **The rate is 1 of 33 CI runs, not only 1 of 10.** 1/33 = 3.0 % (95 % Clopper-Pearson 0.08–15.8 %); 1/10 on the staging/19 tree = 10 % (0.25–44.5 %). `tui:long-line-heap` is 7–8 MB in all 33.
4. **Cause: not attributed.** 20 MB is the size of one `D-records` parent. It is also the value ticket 32's `t32-s6-red2` showed without the copy. But the pane copies every stored row through UTF-8 (`log-pane.ts:66-75`), with no shared state and a fixed input. A pane-held parent would therefore read about 20 MB in every run, not in 1 of 33. The evidence fits a reference held outside the pane's rows, by the runtime or by the S6 body itself, and it varies per process. Nothing on record proves which.
5. **Ticket 19 cannot have caused it.** 19's diff (15 files) touches no file under `zcode-proxy-src/src/tui/`, neither S6 file, no `tests/memory/lib/{verdict,budgets,sampler*}.mjs` and not the Bun pin. The same run's windows memory failure is `S1/burst16: GREEN but listed for ticket 19`. That failure is 19's own exit signal, already handled in t19 round 2, and it is not part of this question.
6. **Minor record drift.** INDEX rows 32 and 67 say `ready-for-agent`, but both files say `resolved`. RUNLOG 07:14Z says t71 is already spawned.

---

## Q1 — who owns the tail of S6's adversarial line-heap check?

**DECISION:** REJECTED in part.
- **Accepted:** the fix belongs in ticket **71** as a measurement-rule amendment, not as an owned RED. Signature (v) joins Round 17's interim rule until 71 merges. The 16 MB budget and the check name stay.
- **Rejected:** the measurement shape (the minimum of ≥ 10 readings after the adversarial phase), on three grounds:
  - the readings are already post-GC, and the excess survived two of them (corrections 1–2), so nothing shows a later reading would drop it;
  - judging only after the phase throws away the per-part marks (`D-mixed`, `D-huge`, `D-cjk`) that the check was built to judge;
  - the evidence that does exist says the event is per process (32 of 33 fresh processes read 8). What re-rolls it is a **fresh process**, not another reading in the same one.
- **Also rejected:** naming ticket 49 as a fallback owner. 49's text says nothing about pane memory beyond "byte cap from 32 kept" (Round 15 Q1 condition 2).

Instead, **linux `S6/short` is judged on the median of n = 5 fresh, sequential repetitions**, through the existing `REPEATED` mechanism.

Binding conditions:
1. **The rule (in 71; one `REPEATED` entry, the mechanism of `lib/repetitions.mjs` unchanged):**
   - the entry is `"S6/short": { n: 5, check: "tui:adversarial-line-heap", budgetMB: MEMORY.S6.longLineHeapMB /* 16 */, ceilingMB: 32 }`;
   - each repetition is a fresh S6 body process, run one after another. The check's value per repetition is unchanged: the worst of `D-mixed`, `D-huge`, `D-cjk`, `D-records` and `end`, minus `C-start`, each read after `Bun.gc(true)`;
   - RED when the median of the 5 is > 16 MB, or when **any** repetition is > 32 MB;
   - `orphans`, `tui:log-pane-heap`, `tui:resize-storm-heap` and `tui:long-line-heap` are judged in **each** repetition, and a RED in any one fails. This is the existing behaviour of `medianVerdict`;
   - `summary.json` and the job summary print all five values and the median.

   Windows is unaffected (S6 is ubuntu-only).
2. **Why n = 5, and why 32 MB.**
   - n follows Round 17 Q3's method: the smallest odd n whose predicted false-RED rate is ≤ 1 % on the less favourable estimate. The staging/19 tree's 1/10 gives n = 3 → 2.80 % and n = 5 → 0.86 %. The 33-run 1/33 gives 0.27 % and 0.027 %, and 3.0 % at its 95 % upper bound.
   - An S6 body takes about 3 s (log 04:56:52 → 04:56:55), so the cost is about 12 s per linux job.
   - The ceiling is 2× the budget, as in Round 17 Q3. It clears the pane's own 8 MB plus the one stray 20 MB object seen here at any mark (about 28 MB). It fails an uncapped pane (about 125 MB) or two retained parents (≥ 40 MB) in a single repetition.
   - The median loses nothing against the defect class: the pane is deterministic code on fixed input, so a pane defect reads RED in every repetition (32's own red2: 20 MB).
3. **Attribution, recorded as information and not gated:**
   - every S6 mark gains `paneBytes` (`pane.bytes`);
   - after `end`, the body pushes 2,000 short ordinary lines, which evicts every stored row, and takes a `flushed` mark.

   The checks' marks are unchanged.
4. **Tests, RED first, at the job seam with fixture repetitions:**
   - [8, 8, 20, 8, 8] is GREEN;
   - [20, 20, 20, 8, 8] is RED (median);
   - [8, 8, 33, 8, 8] is RED (ceiling) with a GREEN median;
   - a repetition with `tui:long-line-heap` RED fails;
   - a missing repetition or a non-numeric value is a harness failure, never GREEN;
   - the S1/burst1 cases and 71's windows S1/short cases are unchanged.

   Plus one local mutant, never committed: `fitLine` storing the raw row without the copy must be RED under the new rule (expected median about 20 MB). Record the value.
5. **What comes back** (none of these blocks 71's merge, except a RED in its pre-merge run, which Round 17 cross-question condition 1 already covers):
   - any repetition > 16 MB whose `flushed` reading returns to within 2 MB of `C-start`. Releasing the pane's rows freed the excess, so the pane held it, and correction 4 is wrong;
   - a median > 16 MB on a tree whose diff does not touch the pane. That is a real leak with an unknown owner. It comes back as an ownership question, with the series and marks, to a new ticket and not to 49;
   - a per-repetition rate above 10 % over ≥ 50 recorded repetitions. That is n's basis, so n comes back.
6. **Interim (amends Round 17 cross-question condition 2 by one signature):**
   - (v) linux S6/short RED with `tui:adversarial-line-heap` as its only RED check, value ≤ 32 MB, and `orphans`, `tui:log-pane-heap`, `tui:resize-storm-heap`, `tui:long-line-heap` GREEN.
   - Ineligible: `zcode-proxy-src/src/tui/**`, `tests/memory/scenarios/s6-tui.mjs`, `tests/memory/scenarios/s6-tui-run.ts`, plus Round 17's common clause (`tests/memory/lib/{verdict,budgets,sampler*}.mjs`, the Bun pin).
   - Recording, the exception's end, and the departure from PROMPT §7 Phase 4's revert rule are as in Round 17, for this signature too.
   - Run 42446461464 is its first occurrence: it does not count against ticket 19 (correction 5) and causes no revert. Its S1 counts stand under Round 18 Q2 condition 5.
   - Tickets 48 and 49 touch `src/tui/**` and get no exception.
7. **Records:**
   - Spec §18 S6 row gains "`tui:adversarial-line-heap` judged on the median of 5 fresh repetitions of the S6 body, every repetition ≤ 32 MB, the other S6 checks in each repetition (Round 21 Q1)".
   - METRICS gets the 33-run table: 32 × 8 MB, 1 × 20 MB (42446461464, `D-records`/`end` 22 MB against 2 MB in 9 of 9), plus `tui:long-line-heap` 7–8 MB.
   - Ticket 32's and 49's Comments gain one line each (ticket-text changes below).
   - RUNLOG records corrections 1–6.

**Rationale:** The numbers do not describe the noisy tail Round 17 Q1 handled. They describe a deterministic check, exactly 8 MB in 32 of 33 processes, plus one process in which a 20 MB object stayed reachable through two forced full collections at a mark that otherwise reads 2 MB. A minimum over more readings in the same process is a guess at a mechanism the evidence already contradicts. Taking it only after the phase would also blind the check to the parts where the pane holds most. A fresh-process median is the measured answer to a per-process event. The existing `REPEATED` mechanism provides it with one entry, and it costs about 12 s. Because the pane's behaviour is deterministic, the median gives up no power against a pane defect. The 32 MB ceiling makes the check stricter than today against any single-run blow-up. The attribution mark turns the unproven cause into something the next occurrence can settle. Owning the RED instead would tolerate any value of the check that proves the pane's byte cap, and naming 49 would invent a trace.

**Charter:** C1 (the pane's byte cap is proven on the quantity it bounds, with a new hard per-run ceiling), C6 (test code only; no product change, endpoint or GC hook), C7 (linux only; windows unaffected), C9 (stronger measured evidence: 33 runs and per-mark readings over Round 17 Q1's analogy; smaller blast radius and simpler: one `REPEATED` entry in an existing mechanism), §9 (16 MB unchanged; the ceiling only tightens), Round 6 Q1 (repetition rule, n ≤ 9), Round 15 Q1 condition 2, Round 17 Q3 condition 2 (method for n), Round 17 cross-question conditions 1–2, Round 18 Q2 condition 5, PROMPT §7 Phase 4.

**Departures, named explicitly:**
- **Round 17 cross-question condition 1:** 71's content grows from three tails to four. Its single-pre-merge-run reasoning is applied, not changed.
- **Round 17 cross-question condition 2:** gains signature (v), with the same departure from PROMPT §7 Phase 4's revert rule and from Round 6 Q2 condition 4's last bullet, for (v) only.
- **Ticket 32's Loop S6 criterion** ("log pane ≤ 16 MB heap"): from now on it is judged under this rule. 32 stays resolved, and nothing is reopened.
- **The `REPEATED` comment** "One n for both legs": the S6 entry has its own n, as 71's S1/short entry already does. S6 is linux-only.
- **No contradiction with Round 17 Q1.** Its minimum rule stays for S7, where the readings are taken without a GC. This answer only declines to transfer it.

**REVERSIBILITY:** Two-way door (one `REPEATED` entry, test code, spec and ticket text). ADR: no.

### Ticket-text changes (exact)

**`issues/71-measurement-rules-rare-tails.md`**
- Title line → `# 71: Measurement rules for four rare tails: S7 retained heap, windows S1/short repetitions, the OMP no-op floor, linux S6/short repetitions`
- What to build, first paragraph: replace "Owner Proxy round 17 (DECISIONS.md, binding; Q1 conditions 1–4, Q3 conditions 1–4, Q4 condition 1). Three rare tails seen in ticket 67's eight evidence runs" with "Owner Proxy rounds 17 and 21 (DECISIONS.md, binding; Round 17 Q1 conditions 1–4, Q3 conditions 1–4, Q4 condition 1; Round 21 Q1 conditions 1–5). Three rare tails seen in ticket 67's eight evidence runs, and one in ticket 19's ten,". Replace "confirms all three" with "confirms all four". In "Every budget, …" insert "the 16 MB S6 budget," after "Every budget,".
- New What-to-build item after item 3:
  `4. **Linux S6/short repetitions (Round 21 Q1 conditions 1–3).** One `REPEATED` entry, `"S6/short": { n: 5, check: "tui:adversarial-line-heap", budgetMB: MEMORY.S6.longLineHeapMB, ceilingMB: 32 }`; each repetition a fresh S6 body process, one after another; the check's per-repetition value unchanged (worst of D-mixed, D-huge, D-cjk, D-records, end minus C-start, each after Bun.gc(true)); RED when the median > 16 MB or any repetition > 32 MB; the other S6 checks judged in each repetition; summary.json and the job summary print all five values and the median. Information, not gated: every S6 mark gains paneBytes, and after end the body pushes 2,000 short lines and takes a flushed mark. Why n = 5: smallest odd n with predicted false-RED ≤ 1 % on the less favourable estimate (1/10 on the staging/19 tree: n = 3 → 2.80 %, n = 5 → 0.86 %; 1/33 over all CI runs: 0.027 %); cost about 12 s per linux job. The minimum-of-readings shape of item 1 is not used here: S6 readings are already post-GC (Round 21 correction 2).`
- Interim paragraph: replace "or (iii) the floor test failing with a no-op cost < 5 MB," with "(iii) the floor test failing with a no-op cost < 5 MB; or (v) linux S6/short RED with `tui:adversarial-line-heap` as its only RED check, value ≤ 32 MB, the other S6 checks GREEN (Round 21 Q1 condition 6),". Replace "the generated OMP extension;" with "the generated OMP extension; (v): `zcode-proxy-src/src/tui/**`, `tests/memory/scenarios/s6-tui.mjs`, `tests/memory/scenarios/s6-tui-run.ts`;". Change "(Round 17 cross-question condition 2)" to "(Round 17 cross-question condition 2, Round 21 Q1 condition 6)".
- New acceptance criteria, before "Pre-merge run":
  - `- [ ] S6 rule (Round 21 Q1 condition 1): the REPEATED entry above; median of 5 fresh repetitions ≤ 16 MB, every repetition ≤ 32 MB, other S6 checks in each repetition; values and median printed; windows unaffected.`
  - `- [ ] S6 tests, RED first (Round 21 Q1 condition 4): [8, 8, 20, 8, 8] GREEN; [20, 20, 20, 8, 8] RED; [8, 8, 33, 8, 8] RED with a GREEN median; a repetition with tui:long-line-heap RED fails; a missing repetition or non-numeric value is a harness failure; S1/burst1 and windows S1/short cases unchanged.`
  - `- [ ] S6 mutant (Round 21 Q1 condition 4), local, never committed: fitLine storing the raw row without the copy is RED under the new rule; value recorded.`
  - `- [ ] S6 attribution and records (Round 21 Q1 conditions 3, 5, 7): paneBytes on every mark and a flushed mark (information); spec §18 S6 row gains the rule; METRICS gets the 33-run table. Comes back, not blocking: a repetition > 16 MB whose flushed reading returns within 2 MB of C-start; a median > 16 MB on a tree that does not touch the pane (ownership question, new ticket); a per-repetition rate > 10 % over ≥ 50 repetitions.`
- Pre-merge run criterion: "confirms the three rules" → "confirms the four rules"; "Any of the three signatures" → "Any of the four signatures (i)–(iii), (v)".
- Comments gains: `- 2026-11-08 (orchestrator, Round 21 Q1): signature (v), first occurrence: run 42446461464 (staging/19, tree 6f25f13), tui:adversarial-line-heap 20 MB (budget 16); D-records and end 22 MB heap against 2 MB in the other 9 staging/19 runs; not counted against ticket 19.`

**`issues/INDEX.md`** row 71: the title follows the new title. (Drift, correction 6: rows 32 and 67 → `resolved`.)

**`issues/32-tui-log-pane-caps.md`** Comments gains: `- 2026-11-08 (Owner Proxy round 21 Q1): tui:adversarial-line-heap read 20 MB once in 33 CI runs (42446461464; 8 MB in the other 32). From ticket 71's merge on, the check is judged on the median of 5 fresh S6 repetitions, every repetition ≤ 32 MB; budget 16 MB unchanged. The ticket stays resolved.`

**`issues/49-proxy-tui-log-pane-filter-scroll-follow.md`** Comments gains: `- 2026-11-08 (Owner Proxy round 21 Q1): 49 touches zcode-proxy-src/src/tui/**, so it gets no interim exception for signature (v); its memory-budget evidence judges linux S6/short under ticket 71's 5-repetition rule. 49 owns no S6 check.`

---

## Shared understanding

Open branches I still see (none blocks 71 or 19):
- **The 20 MB object is unattributed** (correction 4). Condition 3's `flushed` mark and `paneBytes` settle it on the next occurrence. A pane-held retention comes back (condition 5).
- **If t71 has already produced its pre-merge run before this amendment reaches it**, the S6 part goes in as t71's next round on the same branch, not as a new ticket. One pre-merge run must still confirm all four rules (Round 17 cross-question condition 1).
- **The staging/19 restage 42457112513 was still running** when I read the evidence. Signature (v) covers it if it repeats. Its S6 values join the METRICS count.
- **The job's aggregate false-RED rate.** Until 71 merges, this key fails a single run at about 3–10 %, and signature (v) excuses those failures. After 71 merges, it adds about 0.86 % on the 1/10 estimate (0.027 % on 1/33). Round 17's Shared-understanding item on the per-key sum stands.


---

# Round 22 (2026-11-08) — linux S3/short orphans


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–21 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only; scratch copies outside the worktree):
- Run 42457112513 (staging/19, head b3e8fe7, tree on 67's schema): job list through `gh run view --json jobs`. Only `memory-budget (ubuntu-latest)` (job 128658388839) failed. Both test-kit legs, both ux-before jobs and the windows memory job passed. The linux job log came through `gh api …/actions/jobs/128658388839/logs` (`/home/AgentKit/overhaul-tools/ci-art/r22-job-linux-mb.log`, lines 440–480 and 600–630).
- Its `memory-budget-linux` artefact, in `/home/AgentKit/overhaul-tools/ci-art/r22-42457112513-5sdK/`. I read every field of `S3-short/S3-short-2026-11-08T0719-11b141/summary.json` (`checks`, `orphans`, `notes.rounds`, `notes.afterKillHolder`, `notes.cleanup`), plus the S3/hung and S3/omp summaries.
- The `memory-budget-linux` artefacts of the 10 earlier staging/19 runs (42446103818 … 42446746036, tree 6f25f13), in `/home/AgentKit/overhaul-tools/ci-art/r22-s19runs-h9ae/`. From each I took the S3 summaries' orphans, RED sets, kill-holder round fields and final stop code.
- `/home/AgentKit/overhaul-tools/ci-art/t67-logs/parsed.json` (62 linux and 46 windows archived runs up to 42429164758). For every run with linux S3/short or S3/hung `orphans` RED I checked the log lines. METRICS.md lines 333–402: the matching rule, the 13-tree restart and the S3 tables before and on the 13 tree.
- DECISIONS.md Rounds 15, 16, 17, 18 and 21 in full. Issues 16, 17, 19 and 37, plus INDEX rows 16, 17, 19 and 37.
- `tests/memory/expected-red.json` on the integration tip 76edd8a and on b3e8fe7. `tests/memory/verdict.test.mjs:1007-1045` on b3e8fe7 (the real-list test). `tests/memory/scenarios/s3-concurrency.mjs:84-95, 222-244` (the kill-holder adversary). `proxy/zcode-proxy-manager.mjs:610-639, 746`.
- Ticket 19's diff: `git diff --stat e056af6 b3e8fe7`, 15 files: the 19 issue file, `lib/proxy-env.mjs` (one name added to the env exception list), both `config.example.yaml`, `tests/proxy-env.test.mjs`, `tests/memory/expected-red.json`, and `zcode-proxy-src/src/{async/handler.ts, config/*, proxy/handler.ts, server/admission*.ts, server/server.ts}`. Between 6f25f13 and b3e8fe7 only 67's ratchet, list, `job.mjs` and test files changed, plus ADR text.

Statistics, recomputed (python, exact binomial, Clopper–Pearson 95 %):
- Linux S3/short `orphans`, matching CI runs on S3's current executed code (13 tree onward: 2 + 8 staging/67, 10 staging/19 on 6f25f13, 1 on b3e8fe7): **1 of 21** = 4.8 % (0.12–23.8 %). Every run with 65's scenario: **1 of 29** = 3.4 % (0.09–17.8 %). Every linux run on record (62 archived + 8 + 10 + 1): **4 of 81** = 4.9 % (1.4–12.2 %): 42246379763, 42281646419, 42415959288, 42457112513.
- Linux S3/hung `orphans`: **0 of 29** on runs with 65's scenario (upper bound 11.9 %). 2 of 81 overall, both before 65: 42228536094 and 42281731448.
- Each of the 6 linux S3 `orphans` REDs on record (4 S3/short, 2 S3/hung) came with `exactly-one-proxy-after-round` RED in the same entry. The converse does not hold: 4 runs had that check RED with no orphan.
- Under the pooled 4/81 rate, P(≥ 1 orphan RED in 11 runs on 19's trees) = 0.43. Nothing points to an effect of 19.
- A name RED at p = 3.4–4.8 % stays GREEN in 10 consecutive runs with P = 0.70–0.61, even with no fix at all.

**Corrections to the round's facts.**
1. **The orphan is the proxy spawned by the killed lock holder, left with no pid record.** That is the spawn → record-write window in 16's and 17's 2026-11-06 Linux Comments. Evidence from `summary.json`:
   - `orphans: [{ pid: 4080, role: "proxy", cmd: "bin/bun run src/index.ts serve" }]`;
   - in kill-holder-10 the adversary killed holder 4001 after 229 ms, with `proxiesAtKill: 0` (the scan before the kill) and `pidRecordAfterKill: null`;
   - the holder's launch (`preflight#0`) ended `code=null` after its last line "starting zcode-proxy ...", which the manager logs just before `spawn()` (`zcode-proxy-manager.mjs:610`). It writes the record afterwards (`:632`);
   - the other 9 launches failed `code=4 cause=startup`. The round ended with 1 proxy and `pidFileMatchesListener: false`;
   - the round's stop was refused on the dead holder's stale lock (exit 4), and the final cleanup stop was refused with "proxy healthy but no pid file — refusing to guess" (exit 4, `zcode-proxy-manager.mjs:746`). The proxy outlived the scenario.

   In all 10 earlier staging/19 runs the kill-holder round also left a stale lock and a refused round stop. There `pidFileMatchesListener` was `true`, so the final stop succeeded (exit 0) and there was no orphan. That pid record is the only difference.
2. **"1 of the runs on this tree" is 1 of 1 on b3e8fe7, 1 of 11 on 19's trees, and 1 of 21 on S3's matching code.** S3's matching rule (METRICS.md: scenario, `verdict.mjs`, `budgets.mjs`, lifecycle/manager/launcher/preflight/bridge paths) does not include 19's proxy request path or 67's ratchet and list. So the 10 + 1 staging/19 runs and the 10 13-tree runs judge the same S3 code. "0 of 10 on 13's tree" is correct.
3. **The round's linux S3/short owner list is correct, with one omission.** On the integration tip and on b3e8fe7, linux S3/short is: 16 → failed-launches, stale-lock-after-round, exactly-one-proxy-after-round†; 37 → peak:kit, procPeak:launcher, procPeak:mcp-bridge, procPeak:preflight†, procPeak:proxy†. The windows entry already has `"17": ["orphans"]` with `orphans` in `flips`. This run also has 16's `exactly-one-proxy-after-round` RED ("kill-holder-10: 1 proxies, pid file does not match"), which is the same event as the orphan.
4. **Ticket 19 cannot have produced the orphan.** It changes no file under `proxy/`, no lock, launcher or lifecycle code, not `s3-concurrency.mjs`, not `tests/memory/lib/{verdict,budgets,sampler*}.mjs`, and not the Bun pin. Its only change on the manager's spawn path is one constant name in `proxyEnv`'s exception list, computed before `spawn()`. That cannot move the kill relative to the `spawn()` → `writePidFile()` window. The orphan is a healthy proxy that lacks a record, so nothing in the proxy's own request path made it an orphan.

---

## Q1 — who owns linux S3/short `orphans`?

**DECISION:** ACCEPTED with conditions. Owner **17**, linux `S3/short`, marked `flips`. It is traced to 17's What-to-build ("The next start adopts an orphaned proxy through the identity proof and never spawns a second one … Every child is reaped on stop/restart/crash/update"). 17's Acceptance gains a linux loop line and a deterministic seam proof. Two parts are REJECTED:
- **(i)** "mirroring the windows one" in `S3/hung` is not taken as a list edit. Linux `S3/hung` gets no `orphans` name, because the check was never RED there in 29 runs with 65's scenario. The new acceptance line still requires 0 orphans in both keys.
- **(ii)** the ≥ 10-GREEN-run removal floor is not enough on its own to remove this name. At a 3–5 % rate it passes by chance in 61–70 % of cases, so removal also needs condition 3's seam proof.

The run does **not** count against ticket 19. No new ticket. No new edge: 17 ← 16 exists, 37 ← 17 exists, and 55's guard already covers 17.

**This explicitly contradicts:**
- **Round 15 Q1 condition 4** ("a name is marked only by 67 … A mark is never added later"). As in Round 16 Q1 and Round 18 Q2, the mark is set later. It is set by condition 4's own test: RED in fewer than all matching runs of the leg, 1 of 21, on CI runs only (Round 15 Q2 condition 1).
- **Round 15 Q1 condition 3, row "S3/short | linux"**: 17 joins 16 and 37 as an owner.
- **Round 18 Q2 condition 5**, "No owner list or mark changes after [19's pre-merge run]", for this one name only. Round 18 Q2 condition 4 and Round 15 Q2 condition 4 name this as the return path ("comes back as a question with the run ids"). It is not a fold-in.

It does **not** contradict Round 15 Q1 condition 5 ("no … other ticket edits another owner's names"). The edit is this decision, applied by the orchestrator in a commit of its own, and 19's own commits touch no name of 17. It does **not** contradict Round 16 Q1 condition 2 either: linux `S3/hung` stays unlisted under that condition's own rule (never RED, so no evidence).

Binding conditions:
1. **Owner and trace (Round 15 Q1 conditions 2 and 6).** Claimants:
   - **17** by What-to-build (above);
   - **16** only through its 2026-11-06 Linux Comments line ("Closing the window covers spawn → record write"). That line is a measured finding and assigns nothing (Round 15 Q1 condition 6). 16's Acceptance names `orphans` on no leg since Round 15.

   Even if 16 counted as a claimant, 17 descends from 16 and owns the check. That is the same reasoning as Round 15's windows decision, and it avoids holding 16 on an adoption that only 17 delivers. 17's Comments cite the What-to-build line and run 42457112513 with correction 1's record as the measured link.
2. **The list edit (exact; one commit, only `tests/memory/expected-red.json`, by the orchestrator on staging/19, message naming Owner Proxy round 22).** The linux `S3/short` entry becomes:
   ```json
       "S3/short": {
         "owners": { "16": ["failed-launches", "stale-lock-after-round", "exactly-one-proxy-after-round"], "17": ["orphans"], "37": ["peak:kit", "procPeak:launcher", "procPeak:mcp-bridge", "procPeak:preflight", "procPeak:proxy"] },
         "flips": ["exactly-one-proxy-after-round", "orphans", "procPeak:preflight", "procPeak:proxy"]
       },
   ```
   Nothing else in the file changes. Linux `S3/hung` and the whole windows leg stay unchanged, and so do 19's own S1 edits.

   The real-list test (`verdict.test.mjs:1012-1045`) handles this without edits: for this key it picks `count:proxy` as the unowned extra, and the failure message names owners 16, 17, 37. No test changes.

   The edit restarts no count, because `expected-red.json` is outside every matching rule (Round 16 Q2 condition 1, Round 18 Q2 condition 1). It goes on 19's branch, not on the integration branch, because 19 edits the same file. A separate integration commit would conflict with 19's merge for no gain (C9, smaller blast radius).
3. **17's Acceptance gains (exact text in "Ticket-text changes" below):**
   - a **linux loop line**: 0 orphans after the scenario's stop in `S3/short` and `S3/hung`;
   - a **deterministic seam proof on both legs**: a start whose holder dies between `spawn()` and the pid-record write ends with exactly 1 proxy, adopted or reaped, and 0 orphans.

   **Removing the name needs both:**
   - the seam proof, RED first on today's code;
   - Round 15 Q1 condition 5's ≥ 10 GREEN matching linux CI runs on 17's tree.

   The floor alone cannot show the fix (statistics: P = 0.61–0.70 with no fix). The seam proof turns the 1-in-21 event into a forced one. It follows Round 17 Q1's mutant reasoning: a check with no power against its defect class needs a constructed case.
4. **Attribution watch while tolerated (Round 16 Q1 condition 4's pattern; the ratchet cannot see roles).** For every linux `S3/short` `orphans` RED before 17 merges, the orchestrator records in 17's Comments:
   - the run id;
   - each `orphans[]` entry (pid, role, cmd);
   - the kill-holder round's `pidFileMatchesListener` and `adversary.pidRecordAfterKill`;
   - `cleanup.finalStop.tail`.

   Run 42457112513 is the first record (correction 1). An occurrence comes back as an ownership question with its run id, even though the ratchet passed it, if:
   - the value is > 1;
   - any orphan's role is not `proxy`;
   - or the kill-holder round's pid record matched the listener (not the spawn → record window).
5. **Run 42457112513 does not count against ticket 19.**
   - Its only failure is this RED (correction 4).
   - It stays a valid run for 19's S1 counts (Round 18 Q2 condition 4) and for S3's matching count.
   - It is not rerun. It is replayed: its per-key RED sets, both legs, go through the amended list and 67's ratchet (`t67-scripts/replay.mjs`, Round 16 Q2 condition 2) and must pass. Any other failure in the replay comes back with numbers.
   - The list commit changes 19's tip, so 19 merges only after one CI run on the final tip passes: test-kit checks the list schema and the real-list test, and the memory leg is judged normally. Round 17/21's interim signatures (i)–(v) apply. Any unowned RED in it comes back with run ids, with no list edit in between.
   - This is no rerun-until-green: 42457112513 stands as counted, and its RED is decided here.
6. **Linux `S3/hung` (Rejected part (i)).** No `orphans` name, because it was 0 of 29 on 65's scenario. A linux S3/hung `orphans` RED comes back as a question with its run id and condition 4's record, as Round 16 Q1 condition 2 ruled for a never-RED name. If its record shows the same spawn → record window, the Owner Proxy expects to apply this answer. It is still not applied silently.
7. **Records.**
   - METRICS.md, linux S3/short rows: `17 orphans 0/8 †` before 13, and `17 orphans 1/21 †` on the 13 tree onward (42457112513). Add the 4-of-81 all-run count and the co-occurrence with `exactly-one-proxy-after-round`.
   - Spec §18: no change, since budgets and rules are unchanged.
   - RUNLOG names this round and corrections 1–4.
   - Budgets, `orphans: 0`, every other owner, name and mark are unchanged (§9).

**Rationale:** The artefact settles the mechanism, not only the count. The killed holder logged its spawn line, its proxy came up, the pid record never appeared, and the kit's own stop then refused the healthy, unrecorded proxy. That is exactly the state 17's What-to-build adopts ("never spawns a second one") and its Linux Comments describe ("a healthy proxy on the installation's port with no `proxy.pid` at all"). The same state recurs on linux at about 5 % across 81 runs and every tree, always together with 16's `exactly-one-proxy-after-round`.

Leaving it unowned would block a random 1-in-20 run of every ticket on a question whose answer is already known. Rounds 9, 13, 15 and 16 all refused that kind of random merge block. Listing it with a mark is the mechanism Round 16 Q1 used for the windows twin.

The cost of tolerating it is bounded:
- one name, on one key and leg;
- a role check that sends any non-proxy or out-of-window orphan back;
- a removal that needs a forced reproduction, not luck.

19 changes neither the manager's spawn → record path nor the scenario, and the rate on its trees is what the pooled rate predicts. Counting the run against 19 would hold a finished ticket on a defect two tickets downstream.

**Charter:** C1 (every child reaped and exactly one proxy: the check stays enforced, attributed to the ticket that adopts or reaps, and gains a deterministic proof), C7 (linux brought to the windows ownership; windows unchanged), C9 (stronger measured evidence: the per-round record and 81 runs; smaller blast radius: one name in one entry, one list-only commit, no edge; simpler than a new ticket), C2 (no test change), §9 (no budget touched), Round 7 Q4, Round 15 Q1 conditions 2, 4, 5 and 6, Round 15 Q2 conditions 1 and 4, Round 16 Q1 conditions 2 and 4, Round 16 Q2 conditions 1 and 2, Round 17 Q1 (mutant reasoning) and cross-question condition 2, Round 18 Q2 conditions 4 and 5, Round 21 Q1 condition 6, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (one list name and mark, ticket text, run scheduling). ADR: no.

### Ticket-text changes (exact)

**`issues/17-start-lock-signal-release-and-orphan-adoption.md`**
- Acceptance, new line after "Loop S3 (windows): …":
  `- [ ] Loop S3 (linux, Round 22 Q1): 0 orphans (`orphans`) after the scenario's stop in `S3/short` and `S3/hung`, including after a kill-holder round whose holder died between spawning the proxy and writing `proxy.pid` (run 42457112513: orphan pid 4080, role proxy, final stop "proxy healthy but no pid file"). **Remove 17's name (`orphans`) from the linux `S3/short` entry in `expected-red.json`** only with both the seam proof below (RED first on today's code) and Round 15 Q1 condition 5's evidence for a `flips` name (≥ 10 GREEN matching linux CI runs on 17's tree).`
- Acceptance, new line after the first "Seam 2 …" line:
  `- [ ] Seam 2, ubuntu and windows-latest (Round 22 Q1): a start whose lock holder is killed after `spawn()` and before the pid record is written (kill injected deterministically at that point, not by timing) leaves a healthy proxy with no `proxy.pid`; the next start adopts it through the identity proof (never on a port or pid alone) or `stop` reaps it; the test ends with exactly 1 proxy, 0 orphans and no second proxy spawned.`
- Comments gains:
  `- 2026-11-08 (orchestrator, Owner Proxy round 22 Q1): linux S3/short `orphans` is owned by 17 and marked flips in expected-red.json (1 of 21 matching linux CI runs on the 13 tree onward, 42457112513; 4 of 81 linux runs on record, each with exactly-one-proxy-after-round RED). Mechanism: kill-holder holder 4001 killed at 229 ms after logging "starting zcode-proxy ..." and spawning proxy 4080, before writing proxy.pid (pidRecordAfterKill null, pidFileMatchesListener false); the round stop was refused on the stale lock (exit 4), the final stop with "proxy healthy but no pid file" (exit 4). Linux S3/hung `orphans` is not listed (0 of 29); a RED there comes back. Attribution watch (Round 22 Q1 condition 4): for every linux S3/short orphans RED before 17 merges, record run id, orphans[] (pid, role, cmd), the kill-holder round's pidFileMatchesListener and pidRecordAfterKill, and cleanup.finalStop.tail; a value > 1, a non-proxy role or a matching pid record comes back as an ownership question. First record: 42457112513 as above.`

**`issues/16-start-lock-protocol-v1-proven-takeover.md`** Comments gains:
`- 2026-11-08 (orchestrator, Owner Proxy round 22 Q1): linux S3/short `orphans` goes to 17 (descendant rule, as windows in Round 15); 16's `exactly-one-proxy-after-round` RED in run 42457112513 is the same event (pid file does not match the listener). If 16 closes the spawn → record window first, 17 removes a GREEN name. 16's own names and Acceptance are unchanged.`

**`issues/19-admission-control-and-503-shed.md`** Comments gains:
`- 2026-11-08 (orchestrator, Owner Proxy round 22 Q1): pre-merge run 42457112513 failed only on linux S3/short RED on orphans (unowned). The orphan is the kill-holder proxy left without a pid record; 19's diff touches no manager, lock, launcher, lifecycle or S3 scenario code. The name is assigned to 17 (flips) in a list-only orchestrator commit on staging/19; the run does not count against 19, is replayed through the amended list, and its S1 and S3 counts stand. 19 merges after one passing CI run on its final tip.`

**`issues/37-…`, INDEX.md:** no change. 37's "Delete `S3/short` (linux)" is covered by Round 15 Q1 condition 5 (the commit that removes the last name deletes the entry). 37 is blocked by 17, so it never waits on a name 17 has not yet removed out of order.

---

## Shared understanding

Open branches I still see (none blocks 19):
- **16's and 17's low-rate `flips` names share the power problem in condition 3.** For example, linux S3/short `exactly-one-proxy-after-round` is 1 of 21, and linux S3/hung `start-over-stale-lock` is 0 of 29. Ten GREEN runs prove little for them. 16's Acceptance already has seam tests for its lock names (kill at every protocol step). If 16 removes a name on the floor alone, that comes back with numbers.
- **The spawn → record window has two possible closers.** 16 could write the identity before or at spawn, or 17 could adopt or reap afterwards. Whichever lands first clears the event. 16's windows seam line covers it only on windows-latest. Whether 16 should also prove the window closed on ubuntu is not decided here. 17's new seam proof covers the outcome on both legs.
- **Linux S3/hung `orphans`** stays unlisted (condition 6). The same kill-holder code runs there, and it was RED twice before 65. A recurrence comes back once, and is then expected to follow this answer.
- **EVIDENCE MISSING: whether 42457112513's windows memory leg recorded any S3 orphan outside 17's known windows mechanism.** It passed the ratchet, but Round 15/16's open item on the windows orphan mechanism remains open.


---

# Round 23 (2026-11-08) — triage of ticket 56 (MCP SDK 2.x)


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–22 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md`, `rounds/round-23.md`.
- Issues 56, 30, 31, 36, 53 and 57 in full, and `issues/INDEX.md`. Ticket 13 shows `Status: resolved`. `git show --stat f383d6b` shows the merge "ticket 13: MCP dependencies (SDK 1.32.2, zod 4.6, TypeScript 7.0.2, @types/node 24)", which touched `KNOWN_LIMITATIONS.md` (+24 lines).
- `research/mcp-sdk.md` (2026-11-06) in full.
- On the integration branch `overhaul/stability-terminal-ux` (tip f322df8):
  - `mcp/zcode-harness-mcp/package.json` has `"@modelcontextprotocol/sdk": "^1.32.2"`, `"zod": "^4.6.6"` and `engines.node >=24`.
  - `bun.lock:20`: SDK 1.32.2 already pulls in `express`, `hono`, `@hono/node-server`, `cors`, `jose`, `express-rate-limit` and more.
  - `docs/KNOWN_LIMITATIONS.md` §6 says SDK 1.x `^1.32.2`, at most `2025-11-25`, a deliberate stay-back, and a deadline of "at least until 2027-01-27". It also says "Overhaul-Ticket 56, `needs-triage`".
  - `src/mcp/server.ts`: `:41-44` declares `tools: { listChanged: false }`, `resources: { subscribe: false }` and `logging: {}`. `:99` returns `-32002`. `:278-293` is the stateless JSON-mode transport per request. Its `res.on("close")` is still attached after `handleRequest`, and the error path closes nothing.
  - `src/mcp/resources.ts:33-35`: the bridge's "tasks" are its own tool and resource objects (`zcode://tasks/...`), not the MCP protocol's experimental Tasks.
  - `grep`: the only docs that name the SDK or 2025-11-25 are `MANIFEST.md`, `MANIFEST.de.md`, `mcp/zcode-harness-mcp/docs/PROTOCOL.md` and `KNOWN_LIMITATIONS.md`. README × 5, SECURITY and SUPPORT_MATRIX do not.
- `docs/agents/triage-labels.md`. `DECISIONS.md` Round 1 Q15/Q16 and Round 12 Q1. `spec.md:34, 129 (story), 523-525, 677, 808`. `PROMPT.md` C5, §5 B1–B6 and the CURRENCY DoD (`:571-572`).
- `STATE.md:4` lists 30 as "Ready" and t36 as running. The round says 30 is "in progress". This does not affect the answer.

Primary sources (checked 2026-11-08, Parallel web_search/web_fetch, session 7f3c9a2e-5b41-4d8e-9c6a-1e2f3a4b5c6d):
- npm registry `@modelcontextprotocol/server`: `dist-tags.latest = 2.4.0`. Release times: 2.0.0 2026-07-27T23:55Z, 2.1.0 09-23, 2.2.0 09-28, 2.3.0 10-02, 2.3.1 10-05, 2.4.0 2026-10-23T18:20Z. Pre-releases (alpha/beta) ran 2026-04 to 2026-07-21, and the stable line has had 5 releases since. https://registry.npmjs.org/@modelcontextprotocol/server
- npm registry `@modelcontextprotocol/sdk`: `dist-tags.latest = 1.32.2`. https://registry.npmjs.org/@modelcontextprotocol/sdk
- GitHub releases: v2.4.0 is marked "Latest" (2026-10-23 18:32Z), with server/client/core/server-legacy/codemod 2.4.0 and node 2.1.2. 1.32.2 was released 2026-10-23 18:06Z. There is no release after 2026-10-23. https://github.com/modelcontextprotocol/typescript-sdk/releases, https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.4.0, https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.2
- v1.x README: "Support for the 2026-07-28 spec is not planned for v1.x: it is in v2, the current stable release, which … continues to receive bug fixes and security updates for at least six months after the v2 release (2026-07-27)". https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md and https://ts.sdk.modelcontextprotocol.io/
- ROADMAP (main): "v2.0.0 is the stable release line (main)"; "2026-07-28 spec revision board — implemented in v2.0.0 (released 2026-07-27, alongside the spec)"; "v1.x … at least six months after the v2 release (2026-07-27). It targets the 2025-11-25 spec revision; new spec revisions are implemented on main only." https://github.com/modelcontextprotocol/typescript-sdk/blob/main/ROADMAP.md
- `support-2026-07-28.md`: "Nothing in v2 puts a 2026-07-28 byte on the wire by default". `createMcpHandler(factory)` with the default `legacy: 'stateless'` serves both eras, and "a v1 stateless `StreamableHTTPServerTransport` hosting … maps directly onto the default entry". `serveStdio(factory)` serves both eras unless `legacy: 'reject'`. When serving 2026-07-28, the cache fields default to `ttlMs: 0` and `cacheScope: 'private'`. https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md
- MCP spec changelog 2026-07-28 ("changes … since the previous revision, 2025-11-25"): sessions removed, `initialize` removed, `server/discover` MUST be implemented, `subscriptions/listen`, a required `resultType`, and renumbered error codes. https://modelcontextprotocol.io/specification/2026-07-28/changelog
- The spec versioning page came back only as a cache from 2026-06-04, which still names 2025-11-25 as "current". That is older than the 2026-07-28 release. Its GitHub source path returned 404. https://modelcontextprotocol.io/specification/versioning

**Facts the round asked for.**
1. **Is 2.x stable now? Yes.** It is the npm `latest` tag, GitHub "Latest", and named "the current stable release" by the v1.x README and "the stable release line" by the ROADMAP. 2.0.0 is 104 days old, and 2.4.0 is the fifth stable release.
2. **What is 2027-01-27? A guaranteed minimum, not an announced end-of-support date.** The SDK promises 1.x fixes "for at least six months after the v2 release (2026-07-27)". **EVIDENCE MISSING: a published v1.x end-of-support date.** No primary source names one (README, ROADMAP and releases checked). After 2027-01-27, 1.x fixes are no longer guaranteed. `research/mcp-sdk.md` and `KNOWN_LIMITATIONS.md` §6 both say "at least" and are correct. Ticket 56's "support horizon … (2027-01-27)" should say "guaranteed floor".
3. **Protocol revision.** 2026-07-28 is a published revision. The SDK implemented it in 2.0.0, "alongside the spec". 1.x will never support it. **EVIDENCE MISSING (not decision-relevant): a live copy of the spec versioning page's "current" marker.** The only copy obtained predates 2026-07-28. The decision does not depend on it, because C5 asks for the latest revision that passes the suite, and 2026-07-28 is published and implemented in the stable SDK.

---

## Q1 — Ticket 56: role, label, edges

**DECISION:** ACCEPTED with conditions. The recommendation's "2.x is stable" branch applies. Its edges are accepted, and the ticket is rewritten as two staged tracer bullets with pre-registered gates and a fallback. No edge is cut. The ticket is not yet fully specified as written: its only criterion is "Owner decides go/no-go". This decision makes the go call and fixes the criteria, so an AFK agent never makes the owner's call.

- **Triage role / label:** `ready-for-agent` (`Status: ready-for-agent`). Model **sol**, Risk **high**, **ADR: yes**, a new ADR (next free number, 0017 on the current tree): "MCP SDK 2.x and dual-era serving (2025-11-25 + 2026-07-28)".
- **Spec amendment.** Spec §Out of Scope (`spec.md:808`), "MCP SDK 2.x and protocol revision 2026-07-28. They become a `needs-triage` ticket.", becomes "MCP SDK 2.x and protocol revision 2026-07-28: triaged in Round 23 as ticket 56 (in scope, staged; the stay-back stays documented until it lands)." This follows the Round 12 precedent for 57. It does not contradict Round 1 Q16: Q16 sent 2.x to a `needs-triage` ticket, and this is that triage.
- **Binding conditions.** They go into the ticket's Acceptance, exact text below.
  1. **Stage A: package swap on the 2025-era wire.** Replace `@modelcontextprotocol/sdk` with `@modelcontextprotocol/server`, using the latest stable 2.x when implemented and ≥ 2.4.0. Add `@modelcontextprotocol/node` (≥ 2.1.2) only if the HTTP path needs it. `zod` stays `^4.6.6`, which meets the 2.x minimum of 4.2. Both lockfiles are regenerated (bun.lock, package-lock.json), and versions are re-verified on npm on the day.
     - The bridge still answers `initialize` and negotiates at most 2025-11-25.
     - Every existing raw-JSON-RPC test and example passes unedited, the 2025-06-18 clients included. A test edit that touches a wire assertion comes back as a question (C2).
     - 36's lazy HTTP import survives: stdio mode loads no HTTP adapter.
     - On whatever code path lands, the per-request server and transport are closed on every path, the error path included. A seam 7 test closes the response before `handleRequest` returns. Today's `server.ts:285-293` attaches the listener late and the error path closes nothing.
     - The transitive package count and install size are recorded before and after (C4). If the tree grows, the ticket comes back with the numbers.
     - `dist/` is regenerated by the build (B5).
  2. **Stage B: serve 2026-07-28 additively.** Only after stage A is GREEN.
     - HTTP goes through `createMcpHandler(factory)` with `legacy: 'stateless'`. It builds a fresh server per request and never shares an instance (typescript-sdk #2607).
     - The bridge's own Host, Bearer and Origin checks, `MAX_IN_FLIGHT = 16` and the bounded body pre-read still run before the SDK sees a request. GET and DELETE still get 405. Loopback-only is unchanged (C6).
     - stdio goes through `serveStdio(factory)`, accepts 2025 openings and keeps the stdin-end shutdown.
     - 2025-era output (capabilities, results, the `-32002` resource error) is byte-identical to stage A: recorded 2025-06-18 and 2025-11-25 transcripts are replayed. 2026-era behaviour follows the spec (`server/discover`, `resultType`, `-32602`, SDK default cache fields `ttlMs: 0` / `cacheScope: 'private'`).
     - No capability is added. `tools.listChanged: false` and `resources.subscribe: false` stay. Any long-lived stream the SDK keeps open is capped and closed on stop (C1).
     - Seam 7 adds a 2026-07-28 client, raw JSON-RPC like the existing tests and with no new devDependency, on HTTP and on stdio: discover, `tools/list`, `tools/call`, and `resources/read` on a task resource.
  3. **Memory gates (both stages; values, not verdicts).**
     - Per leg, ≥ 5 fresh `memory-budget` runs on the ticket's tree record these values next to the base tip's: S3 bridge-role peak (`procPeak:mcp-bridge`), S5 `growth:mcp-bridge`, S5 bridge peak and task failures, and 57's `S5/restart` numbers.
     - Every run must stay within the existing budgets. A listed expected-RED name (37 holds the `procPeak:mcp-bridge` names; S5/short is listed under 30 if still listed) does not cover a change in the value.
     - If the 5-run median of any bridge value rises by more than 10 % over the base, the ticket comes back with the numbers. It is not auto-failed and not auto-accepted.
     - **No expected-RED entry is added by 56**, so 55 needs no edge to 56.
  4. **Fallback (pre-registered).** If stage B misses any gate, stage A lands alone, and `KNOWN_LIMITATIONS.md` §6 says "SDK 2.x; protocol 2025-11-25 stay-back" with the measured reason. Stage B then comes back to the Owner Proxy with its numbers. Stage B never lands without stage A. If stage A misses a gate, the ticket comes back with numbers. Edge 53 ← 56 is then cut, and 53 documents today's stay-back unchanged.
  5. **Docs (C8).**
     - 56 itself rewrites `mcp/zcode-harness-mcp/docs/KNOWN_LIMITATIONS.md` §6 and `docs/PROTOCOL.md` to say what landed. 13 established that the package docs are owned by the code change.
     - 53 updates `MANIFEST.md`/`MANIFEST.de.md` (they name the v1 package), the five bridge READMEs ("stay-back note" or its replacement), `docs/MCP_API.md` and SUPPORT_MATRIX. 54 carries the change into the release notes through 54 ← 53.
     - Until 56 merges, §6's "needs-triage" wording is stale. It is corrected by 56's rewrite, not by a separate product-file edit now.
  6. **Re-check tripwire.** The orchestrator re-reads the v1.x README and ROADMAP at each merge of 30, 31, 36 and 57, and again on 2027-01-27. The question comes back to the owner with dates if any of these happens:
     - (a) the SDK announces a v1.x end-of-support date before 56 can land;
     - (b) a v1.x security advisory that affects the bridge is published without a 1.x fix;
     - (c) 56 is not merged by 2027-01-27.
- **Edges.**
  - **56 ← 30, 31, 36, 57 accepted** (13 stays listed, resolved).
    - 36 edits `server.ts:11` and `index.ts:16` (the lazy HTTP import), which is the same block stage A replaces.
    - 31 edits the tool descriptions, the result shape (`truncated`) and `dist/`, all served through `server.ts`.
    - 57 edits `index.ts` (the crash handler) and `runtime/manager.ts`.
    - 30 shares `s5-mcp.mjs` and the S5 bridge measurements, the same separation reason as 57 ← 30 in Round 12.
    - These are same-file edges (Round 5 Q2) plus measurement separation, so the swap lands on the final bridge code and its numbers are not mixed with four tickets' changes. 57 ← 30, 36 and 31 ← 30 already exist, so 30 and 36 are also transitive. They stay listed for clarity.
  - **53 ← 56 accepted.**
  - **No edge 55 ← 56** (condition 3). **No edge 56 ← 37:** no file overlap; condition 3 covers the shared `procPeak:mcp-bridge` names. **No edge 52 ← 56:** README × 5 do not name the SDK (grep).
  - **Acyclic, checked mechanically** (DFS over every INDEX row plus the two new edges).
    - 56 had no dependents. Its ancestors are 30, 31, 36, 57, 13 ← 12 ← 11 ← 10 ← 09 ← 02, 03, 04, and 01.
    - Its only descendants are 53 and then 54. Neither is an ancestor of 30, 31, 36 or 57, so no cycle forms.

**Rationale:**
- The round made its recommendation conditional on a primary-source fact, and the fact holds: 2.x is the stable line. C5 names "@modelcontextprotocol/sdk and MCP protocol revision" explicitly. The ROADMAP says new revisions land on main only, so staying on 1.x means staying off every future revision, and 1.x fixes are guaranteed only to a floor date with no end date announced.
- The documented stay-back meets the run's DoD today (`PROMPT.md:571-572`). It was a deferral, not a verdict: Round 1 Q16 condition 2 justified it by cost ("an architectural step") and by the 1.x window. Neither argues against moving now that the window's end is in sight.
- The cost is small. One file imports the SDK, and the v2 stateless entry "maps directly" onto the bridge's current hosting. 1.32.2 already pulls in express and hono, so the swap may well shrink the tree, and condition 1 measures it instead of assuming it.
- The risk is real. The bridge's memory budgets are the run's hardest gates, a new major can move them, and v2-only defects were open on 2026-11-06 (#3148, #3097, #3036). That is why:
  - the ticket sits behind the four open MCP tickets;
  - its gates compare measured values, not listed verdicts;
  - the protocol adoption (the one-way part: once `server/discover` advertises 2026-07-28, withdrawing it is a deprecation under C2) is a separate stage with a fallback to a smaller, reversible stage A.
- The edges put 56 at the end of the MCP chain and in front of 53 → 54, the run's tail. The pre-registered fallback and the edge cut in condition 4 keep a stalled 56 from holding the release notes hostage. The tripwire keeps the 2027-01-27 floor from passing in silence.

**Charter:** C5 (SDK and protocol revision currency), C1 (memory gates, a per-request factory, capped streams, no added long-lived state), C2 (2025-era wire byte-identical; additive 2026 era; deprecation announced, never silent), C4 (footprint measured; no new framework), C6 (loopback, bearer, Host/Origin checks ahead of the SDK; no new endpoint), C8 (docs split between 56 and 53), C9 (stronger evidence first: primary sources; then the smaller blast radius: stage A before B, with a fallback). Also Round 1 Q16 (the triage it deferred to), Round 5 Q2 (same-file edges), Round 12 Q1 (56 to be ordered against 57; the spec amendment precedent), B5 (`dist/` by build), B6 (no kit version bump; dependency versions only).

**REVERSIBILITY:**
- Stage A is a two-way door: one dependency swap in one file, reverted by a revert commit.
- Stage B is one-way once released: a served protocol revision can only be withdrawn through an announced deprecation.
- **ADR: yes** (new ADR, next free number, 0017 on the current tree).

### Exact text changes

**`issues/56-mcp-sdk-2-migration.md`.** Replace everything from `**Blocked by:**` through the end of the `**Acceptance criteria:**` list (up to `**Common acceptance (every ticket):**`) with:

```
**Blocked by:** 13 (Batch 3 — MCP dependencies: SDK 1.32.2, zod 4.6.6, TypeScript 7, `@types/node` 24), 30 (MCP task retention (500 / 7 days) and the idempotency window), 31 (Per-task caps and 4 MiB head/tail truncation of task text), 36 (MCP bridge: lazy HTTP transport and `--max-semi-space-size=1` in generated entries), 57 (MCP runtime restart budget)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0017 (MCP SDK 2.x and dual-era serving; next free number)

**What to build:** Move the bridge off SDK 1.x (whose fixes are guaranteed only until at least 2027-01-27; no end date announced) onto the stable SDK 2.x line, in two stages (Round 23 Q1). Stage A swaps the packages and keeps the 2025-era wire byte-identical. Stage B then serves protocol revision 2026-07-28 in addition, on HTTP (`createMcpHandler`, `legacy: 'stateless'`, a fresh server per request) and on stdio (`serveStdio`), behind the bridge's existing Host/Bearer/Origin checks and in-flight cap. If stage B misses a gate, stage A lands alone with a documented protocol stay-back.

**Acceptance criteria:**

- [ ] Stage A: `@modelcontextprotocol/sdk` replaced by `@modelcontextprotocol/server` (latest stable 2.x, ≥ 2.4.0, re-verified on npm on the day) and, only if the HTTP path needs it, `@modelcontextprotocol/node` (≥ 2.1.2); `zod` stays `^4.6.6`; bun.lock and package-lock.json regenerated; `dist/` regenerated by the build (B5).
- [ ] Stage A, wire: the bridge still answers `initialize` and negotiates at most 2025-11-25; every existing raw-JSON-RPC test and example (2025-06-18 clients included) passes unedited. A test edit touching a wire assertion comes back as a question.
- [ ] Stage A: stdio mode loads no HTTP adapter (36's lazy import, its seam 7 test unchanged); the per-request server and transport are closed on every path including errors, pinned by a seam 7 test that closes the response before `handleRequest` returns.
- [ ] Stage A: transitive package count and install size recorded before/after; a larger tree comes back with the numbers (C4).
- [ ] Stage B (only after stage A is GREEN): 2025-06-18 and 2025-11-25 transcripts recorded on stage A replay byte-identical (capabilities, results, `-32002`); a 2026-07-28 raw-JSON-RPC client on HTTP and on stdio passes `server/discover`, `tools/list`, `tools/call` and `resources/read` on a task resource, with `-32602` for an unknown resource; no capability is added (`tools.listChanged: false`, `resources.subscribe: false`); any long-lived stream is capped and closed on stop; GET/DELETE stay 405; Host/Bearer/Origin checks, `MAX_IN_FLIGHT` and the bounded body pre-read still run before the SDK.
- [ ] Memory, each stage, values not verdicts: ≥ 5 fresh `memory-budget` runs per leg record S3 `procPeak:mcp-bridge`, S5 `growth:mcp-bridge`, S5 bridge peak and task failures, and `S5/restart`, next to the base tip's values. Every run is within the existing budgets whether or not a name is listed. A 5-run median rising > 10 % over the base on any bridge value comes back with the numbers. 56 adds no expected-RED entry.
- [ ] Fallback: if stage B misses a gate, stage A lands alone and stage B comes back with numbers. If stage A misses a gate, the ticket comes back and edge 53 ← 56 is cut.
- [ ] Docs: `mcp/zcode-harness-mcp/docs/KNOWN_LIMITATIONS.md` §6 and `docs/PROTOCOL.md` state what landed (SDK 2.x; dual-era serving, or the 2025-11-25 stay-back with its measured reason). MANIFEST, bridge READMEs × 5, `docs/MCP_API.md` and SUPPORT_MATRIX are 53's scope.
```

`Spec stories: none (follow-up to 129)` stays as it is: story 129, the stay-back on record, holds until 56 lands, and 56 changes no stored state, so story 135 does not apply. Add under `## Comments`:

```
- 2026-11-08 (orchestrator, Owner Proxy round 23, binding): triaged ready-for-agent. 2.x is the stable line (npm latest 2.4.0, 2026-10-23; 2.0.0 2026-07-27). 2027-01-27 is the guaranteed floor for 1.x fixes, not an announced end date. Edges 56 ← 30, 31, 36, 57 and 53 ← 56; acyclic. Tripwire: the orchestrator re-reads the v1.x README/ROADMAP at each merge of 30, 31, 36 and 57 and on 2027-01-27. The question comes back to the owner if a v1.x end date before 56 can land is announced, if an unfixed v1.x advisory affects the bridge, or if 56 is not merged by 2027-01-27.
```

**`issues/53-docs-security-harness-bridge-and-manifests.md`.** Append to the `**Blocked by:**` line: `, 56 (MCP SDK 2.x and protocol revision 2026-07-28 migration)`. In **What to build**, replace `The five MCP bridge READMEs at parity with the Node 24 floor and the stay-back note.` with `The five MCP bridge READMEs at parity with the Node 24 floor and with ticket 56's outcome (SDK 2.x and dual-era serving, or the remaining protocol stay-back); \`MANIFEST*\` names the SDK package that 56 ships.`

**`issues/INDEX.md`.**
- Row 56 becomes: `| 56 | [MCP SDK 2.x and protocol revision 2026-07-28 migration](56-mcp-sdk-2-migration.md) | sol | high | 13, 30, 31, 36, 57 | ready-for-agent |`
- Row 53's Blocked-by cell becomes: `11, 13, 16, 22, 31, 51, 58, 57, 56`

**`spec.md:808`.** Replace `- **MCP SDK 2.x and protocol revision 2026-07-28.** They become a \`needs-triage\` ticket.` with `- **MCP SDK 2.x and protocol revision 2026-07-28.** Triaged in Round 23 as ticket 56 (in scope, staged; the stay-back stays documented until it lands).`

---

## Shared understanding

Open branches I still see:
1. **Stage B's go/no-go is measured, not decided.** Whether 2026-07-28 is served in this run depends on condition 3's numbers. If it falls back, the protocol stay-back stays documented, and stage B comes back as its own owner question.
2. **Run-tail timing.** 56 now sits between the MCP chain (30 → 31, 36 → 57) and 53 → 54. If that chain is not done well before 2027-01-27, tripwire (c) brings the question back. The SDK has announced no end date, so the floor is not a hard stop.
3. **Side observation, not decided here.** `spec.md:809` still reads "An MCP runtime restart budget … becomes a `needs-triage` ticket". Round 12 Q1 condition 7 ordered it amended to "triaged in Round 12 as ticket 57", and the amendment is not on the tree (f322df8).
4. **EVIDENCE MISSING, carried:** (a) a published v1.x end-of-support date; none exists today. (b) A live copy of the spec versioning page's "current" marker; the only copy obtained (2026-06-04) predates 2026-07-28.


---

# Round 24 (2026-11-08) — S5/short after ticket 30


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–23 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-24.md`.
- Ticket 30's branch at 142b384 (`git -C /home/AgentKit/wt/t30 show HEAD:…/issues/30-*.md`): the attribution, the mutation set and the loop tables. `git diff --stat e88821f 142b384` shows 9 files: `mcp/**`, `dist/**`, the new test and fixture, and the ticket. It touches no `tests/memory/**` file and not `expected-red.json`.
- The integration branch `overhaul/stability-terminal-ux`. It was at e88821f when I started and moved to af5caa8 (ticket 15) while I worked. That merge changes nothing under `tests/memory/` and does not touch ticket 30. Files read: `tests/memory/scenarios/s5-mcp.mjs` (n = 400, `growthBudget` with the default `warmupFraction` 0.25 over the load window), `tests/memory/lib/budgets.mjs` (`MEMORY.growth`, `MEMORY.S5`, `growthBudget`), `tests/memory/lib/verdict.mjs` (`growth()`, the trend rule), `tests/memory/lib/ratchet.mjs` (`UNSTABLE`, the ticket-id rule), `tests/memory/expected-red.json`, `loop.test.mjs:1247-1408`, `verdict.test.mjs:505-512`, `spec.md:633, 645`, `.github/workflows/ci.yml:124` (memory-budget timeout: windows 150 min, ubuntu 75 min).
- DECISIONS Rounds 5 Q2, 12, 13, 17 and 23. Issues 30, 31, 36, 55, 56, 57, 66 (resolved), 71 and INDEX.md. ADR-0009.
- Raw data, recomputed by me: `/home/AgentKit/overhaul-tools/t30-memloop/*/summary.json` and the `samples.csv` of both S5/long runs. I wrote my own re-implementation of `growth()` (same slope, six window medians, rising-run and net-rise branches). For the probe runs I used `/home/AgentKit/overhaul-tools/t30-attrib/{long-tip,long-branch,long-cap50}/probe.jsonl` through the implementer's `analyze.mjs`.
- Staged CI run **42475847194** (staging/30, head 0e99864 = e88821f + 142b384). It has finished: **conclusion success, 8 of 8 jobs green**. The S5 lines come from the job logs (jobs API 128716926718 and 128716926861):
  - **windows** `S5/short`: `growth:mcp-bridge` **14.5 %/1k commit** (WS −4.24), trend false. The job printed "S5/short: unstable (growth:mcp-bridge 14.5 %/1k commit, budget 5, bound 30, trend false), owned by ticket 30". procPeak 75.4 MB WS (89.3 commit), reboot cost 3 MB, 0 failures, 0 orphans. Ratchet holds. Job 43.9 min, of which S5/short took 12.0 min (11:58:02 → 12:10:03).
  - **linux** `S5/short`: `growth:mcp-bridge` **31.82 %/1k**, trend false. The job printed "GREEN, listed for ticket 30 on flipping checks". procPeak 101.6 MB, reboot cost 4 MB, 0 failures, 0 orphans. Ratchet holds. Job ≈ 37 min, of which S5/short took 11.9 min.
  - For comparison, the integration run 42469136344 (tip, no retention) had windows 16.53 (trend false) and linux 43.81 (trend true, RED, listed).

**Recomputed facts and corrections to the round.**
1. **Confirmed.** These figures are correct:
   - S5/long tip RED, 40.80 %/1k with trend, against branch GREEN, 1.11 %/1k without trend. My recompute of the job's own window (tasks 750–3,000) gives the same 40.80 and 1.11.
   - Reboot cost 31 against 4 MB.
   - S5/short local: tip 44.53 / 41.18 / 39.60, branch 35.29 / 37.62 / 34.52. Two of the three branch runs are GREEN only because the trend flag is false.
   - The per-task costs: (18.14 − 16.76) MB / 300 tasks = 4.6 KB of JS heap, and (93.0 − 84.5) / 300 = 28 KB of RSS.
   - The smaps split: 6.2 + 1.6 + 1.3 = 9.1 MB, or 68 / 18 / 14 %.
2. **The cap-50 warm-up is 11.4–15.0 MB/1k, not 11.4–12.8.** `analyze.mjs long-cap50` gives 14.95 MB/1k over tasks 100–400 and 11.43 over 100–500. It falls to −2.17 over 500–900 and −1.37 over 500–1,500. So the warm-up alone is 2.3–3× the 4.5 MB/1k that 5 %/1k allows at ~90 MB. Nothing that changes retention or per-task footprint can bring a window that starts at task 100 under budget. This supports the round's conclusion.
3. **The recommendation's window (500-task warm-up, ≥ 400 judged tasks) has no margin on the branch.** Its own fallback would also fire. Recomputed on the branch:

   | window (tasks), warm-up fraction 0 | branch, job sampler %/1k (trend) | branch, probe MB/1k | tip, job sampler %/1k (trend) | tip, probe MB/1k |
   |---|---|---|---|---|
   | 500–900 | **4.74** (false) | **7.60** | 37.49 (true) | 51.1 |
   | 600–1,000 | 0.50 (false) | 2.25 | 16.48 (**false**) | 35.6 |
   | 600–1,200 | 1.37 (false) | 2.72 | 15.82 (true, net rise 13.8 %) | 14.6 |
   | 500–1,500 | 2.12 (false) | 2.97 | 21.79 (true) | 19.6 |

   At ~102 MB, 1 MB/1k ≈ 1 %/1k, so the probe's 7.6 MB/1k over 500–900 is over budget. The first ~100 tasks after the bound is reached still settle, because evicted tasks become garbage and old-space pages are released slowly. A 400-task window that starts at 600 has the opposite problem: it misses the trend of the very defect it exists for (tip 16.48, trend false). Only a window that starts at 600 and runs to ≥ 1,200 keeps both a margin on the branch and a trend on the tip, on this evidence.
4. **EVIDENCE MISSING: a windows (commit) post-bound value.** There is no windows S5 run beyond 400 tasks. Condition 7's exit decides it.
5. **EVIDENCE MISSING (record only): the window medians of linux run 42475847194.** The log prints no medians. This run is a GREEN linux S5/short, so Round 17 Q2 condition 3 requires a record of its medians. They are in the run's `summary.json` artefact. The value 31.82 is > 5, so no ownership question arises.

---

## Q1 — S5/short after retention: who owns the growth that retention cannot reach

**DECISION:** REJECTED in part.

Accepted:
- Ticket 30 merges on its retention criteria and S5/long, and closes.
- The principle of option (a): S5/short's bridge growth is judged **after warm-up, and warm-up includes reaching the retention bound**. The 5 %/1k budget, `growth()` and the trend rule are unchanged.

Rejected:
- (i) **The window parameters.** A 500-task warm-up with ≥ 400 judged tasks is replaced by a 600-task warm-up and a 600-task judged window (S5/short n = 1,200). The branch measures 4.74 / 7.6 over 500–900, and a 600–1,000 window misses the tip's trend (correction 3).
- (ii) **Moving the entries to a per-task footprint ticket (c) "with the same exits".** Correction 2 shows those exits cannot be reached by construction. That would make the entries a permanent listing that blocks 55.
- (iii) **Filing (c) at all now.** The per-task footprint is bounded by the 500 bound (~28 KB of RSS each, ~14 MB at the bound). It breaks no budget: S5/long procPeak is 111.4 of 150 MB, reboot cost 4 of 20 MB, CI reboot cost 3–4 MB. Do nothing (C9).
- (iv) **Option (b), an owner for the warm-up.** A plateau after warm-up is not a defect under spec §18 ("after warm-up") or `verdict.mjs`'s own rule ("A plateau after allocator warm-up … is not [a leak]"). It gets a value ceiling instead of an owner (condition 3).
- (v) **"If (a)'s window is still over 5, (c)'s ticket owns it."** This is replaced by "the numbers come back" (condition 8).

The measurement rule and both S5/short entries move to **new ticket 74**. Its exit is reachable and pre-registered here.

**This explicitly contradicts:**
- **Round 13 Q1 condition 4** ("The entry leaves the list only through ticket 30"; "no other ticket ever edits this entry"). Ticket 30's tree re-owns both S5/short entries to 74 once, and 74 deletes them. The reason: 30's fix is complete (S5/long RED → GREEN). What remains is a measurement question that 30's code cannot answer, and the ratchet must not list an entry under a resolved owner.
- **Round 17 Q2 condition 2** (30's linux exit) and Round 13 Q1 condition 4's windows exit. Both move to 74 with the same strictness: ≥ 10 fresh runs per leg, every one ≤ 5 %/1k whatever the trend flag says, every other S5 check GREEN. They are now measured on the new window.
- **Round 13 Q1 condition 7**, insofar as the S5/short scenario length changes from 400 to 1,200 tasks. The S5 budgets (5 %/1k, 150 MB, 20 MB, 0) are unchanged.

It does not contradict Round 12 Q1 (edge 57 ← 30 stays, and 57 ← 74 is added for the same reasons) or Round 23 Q1 condition 3 (56 compares S5 values against a base under one rule; edge 56 ← 74).

Binding conditions:

1. **Ticket 30 merges now, on these terms.**
   - Run 42475847194 counts as its staged run. Both legs hold the ratchet: windows is in the band at 14.5, and linux is a flip GREEN at 31.82 with every other S5 check GREEN.
   - Before merging, 30's tree gains one list and label edit (condition 2), and **one restaged run** must show the same outcomes. The edit changes labels and the tests that pin them, not measurements. Any disagreement comes back, and nothing is rerun until it turns green.
   - 30's Acceptance is rewritten as in the text changes below: its "Delete `S5/short`" line and both exits move to 74.
   - 30's Comments record the CI values above and the linux run's window medians (correction 5; Round 17 Q2 condition 3).
2. **Re-own once, in 30's tree.**
   - Linux: `"S5/short": { "owners": { "74": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] }`.
   - Windows: `"S5/short": { "ticket": "74", "state": "unstable" }`.
   - The windows band (5 < v ≤ 30 on commit), the `UNSTABLE` key and every other rule of Round 13 Q1 conditions 1–3 stay as they are until 74 lands. Only the owner label changes.
   - `verdict.test.mjs:505-512`, `loop.test.mjs:1278-1289, 1403-1408` and the `ratchet.mjs:69` comment change "30" to "74". This is justified as a label-only test change.
   - The orchestrator first commits the issue file for 74, because the ratchet requires `issues/74-*.md` to exist.
   - Round 17 cross-question condition 2 signature (iv) and Round 17 Q2 condition 3's wrong-owner watch continue unchanged, recorded in **74's** Comments.
3. **Ticket 74: the rule (pre-registered; the implementer does not choose the numbers).**
   - **Scenario.** `S5/short` runs **n = 1,200** tasks with today's per-task workload unchanged (start, wait, result, a 16 KB prompt every 10th task, `tasks_list` every 25th). S5/long is unchanged (3,000 tasks, default 25 % warm-up).
   - **`growth:mcp-bridge`** is computed over the load samples from the first sample with progress ≥ 600 to the end of the load, with `warmupFraction: 0` inside that window. The 600 tasks are the warm-up: the 500-task bound plus 100 settling tasks (correction 3). `growth()`, `MEMORY.growth` (5 %/1k, 3 rising windows, 10 % net rise) and the RED rule (over budget AND trend) are unchanged. `summary.json` and the check detail record the window's bounds in tasks and in samples.
   - **A warm-up ceiling (new check; a tightening, not a budget).** Name it `warm-up-growth:mcp-bridge`. Its value is today's S5/short quantity, computed exactly as now: `growth()` over the load window cut at the sample where progress reaches 400, with the default 25 % warm-up. It is printed in every run and judged on value regardless of trend:
     - RED above **55 %/1k on linux** (RSS). The tip has 36 CI runs between 37.53 and 46.33 (Round 13: n = 26, mean 42.58, sd 1.99; Round 17: 10 runs, 39.53–45.99). 55 is 8.67 above that maximum, z = 6.2. Branch values on record are 31.82 (CI) and 34.52–37.62 (local).
     - RED above **30 %/1k on windows** (commit). This is Round 13's bound with its 28-run justification (max 26.24; branch CI 14.5). It carries over so that deleting the windows entry does not remove the only windows regression bound on bridge growth.
     - It also closes Round 17's open branch "Linux S5/short has no value ceiling".
   - **Every other S5 check is unchanged and judged over the whole run, warm-up included:** `procPeak:mcp-bridge` ≤ 150 MB (WS on windows), `bridge:reboot-cost-of-history` ≤ 20 MB (now after 1,200 tasks with 500 retained), `bridge:task-failures` 0, and orphans 0.
4. **Why this loosens nothing.**
   - Over tasks 100–400, the old window measured runtime warm-up (correction 2) and history below a bound that ADR-0009 sets on purpose. Both are bounded.
   - The new window tests the bound itself. The old 400-task window could never see a retention bound fail. The tip, with no bound, is 15.82 %/1k with trend over 600–1,200.
   - The level stays hard-bounded over the whole run by procPeak and the reboot cost. The warm-up phase gets value ceilings that bind today only on windows (and only while the entry exists).
   - Today the linux listing passes any value. After 74, linux is bounded on both windows.
5. **Mutant proof, before any CI evidence (local linux, never committed).**
   - A bridge with the count bound removed (30's mutant M1) runs the new S5/short **≥ 3 times**. It must be RED on `growth:mcp-bridge` (value > 5 and trend true) in **every** run.
   - The tree with 30 merged runs it ≥ 3 times. Every run must have `growth:mcp-bridge` ≤ 5 and a warm-up value under the ceiling.
   - If any mutant run is GREEN, the window cannot see its defect, and the numbers come back. Nobody lengthens or moves the window on their own.
6. **Tests, RED first, at the job seam with fixture series:**
   - growth until task 600, then flat: GREEN;
   - growth continuing after 600 with a trend: RED;
   - a warm-up value of 55.1 (linux) or 30.1 (windows commit): RED, while the post-bound window is GREEN;
   - a load that ends before task 1,200, or fewer than 6 samples after 600: a harness failure or `insufficient`, never GREEN;
   - the window bounds are printed.
7. **74's exit (the only way the entries leave):**
   - On 74's tree, through an off-by-default S5-only measurement mode, **≥ 10 fresh runs per leg**. They may span several CI runs or parallel jobs of the same tree, each on a fresh runner.
   - Every run must have `growth:mcp-bridge` ≤ 5 %/1k on the new window whatever the trend flag says, a warm-up value under its ceiling, and every other S5 check GREEN. Each run records the value (commit and WS on windows), trend, window medians, sample counts and duration in METRICS and in 74's Comments.
   - Then, in one commit:
     - delete linux and windows `S5/short` from `expected-red.json`;
     - remove `S5/short` from `UNSTABLE`, so the schema then rejects `unstable` on it. The band tests are replaced by that schema test, a justified pre-existing test change;
     - land the rule.
   - The pre-merge run must show S5/short GREEN on both legs with no entry.
8. **Fallback (pre-registered).** If the mutant proof or the exit fails on either leg, 74 does not merge in part (the windows band was calibrated on the old window), and it comes back with all the values. The 5 %/1k budget, the ceilings and the scenario are never bent to fit.
9. **CI wall time.** S5/short goes from ~12 to ~36 min per leg, measured in 42475847194 (12.0 min per 400 tasks on both legs). Windows: ≈ 68 min (≈ 86 with 71's repetitions) against 150. Ubuntu: ≈ 61 min against 75, which is 81 %. So 74 raises the ubuntu `memory-budget` `timeout-minutes` from 75 to 100. That is a wall-time guard, not a §9 budget, and every evidence run records the job duration.
10. **Records.**
    - Spec §18 S5 row: the amendment text below.
    - METRICS: correction 3's table, the cap-50 slopes, and the 42475847194 values.
    - RUNLOG: this round's departures from Round 13 Q1 conditions 4 and 7 and Round 17 Q2 condition 2.
    - ADR-0009 is unchanged; the retention policy did not move.

**Rationale:** The numbers settle what S5/short has been measuring. Even with a 50-task bound, tasks 100–400 grow at 11.4–15 MB/1k, and the curve flattens after ~500 tasks. That is runtime warm-up, which spec §18 itself excludes ("after warm-up"). The other half is history below a bound that ADR-0009 sets on purpose. So no retention or footprint ticket can meet an exit judged on that window, and handing the entries to one (option c) would only rename a permanent listing. Judging after the bound (option a) is right: it is the S5/long shape, the only window that can see a bound fail, and the tip is RED and the branch GREEN under it.

The recommendation's parameters fail on its own data. 500–900 gives 4.74 and 7.6 MB/1k on the branch, which is no margin, so the gate would flake on the primary platform. A 400-task window from 600 lets the no-retention tip through on the trend flag. 600–1,200 is the shortest window on record with margin on the branch (1.37 / 2.72) and a trend on the tip (15.82, trend true). The mutant proof and the ≥ 10-run exit exist because those numbers rest on one run per arm. The warm-up ceilings keep the windows regression bound that would otherwise disappear with the entry, and give linux the bound it never had. So nothing that is gated today is gated less after 74.

Splitting the rule into 74, rather than holding 30 until ~20 more S5 evidence runs exist, keeps a finished C1 fix (an unbounded store, 238.6 → 111.4 MB peak on S5/long) off the critical path of 31, 57 and 56. It also lets a revert of either the rule or the retention leave the other intact. That is the Round 13 (ticket 66) and Round 17 (ticket 71) precedent.

**Charter:** C1 (bounded memory: the bound is tested where it acts; a regression ceiling on warm-up; procPeak and reboot cost over the whole run), C7 (windows bound kept; windows post-bound value measured before deletion; linux brought to the same bounds), C9 (stronger measured evidence: recomputed windows on both arms; smaller blast radius: the rule in its own ticket; "do nothing" for per-task footprint), §9 (5 %/1k, 150 MB, 20 MB, 0 unchanged; one new ceiling only tightens), Round 5 Q2, Round 6 Q2 condition 1 (every entry has an open owner), Round 12 Q1, Round 13 Q1 conditions 1–4 and 7, Round 17 Q2 conditions 2–3, Round 17 cross-question condition 2, Round 23 Q1 condition 3, PROMPT §7 Phase 4 (no rerun-until-green; no spurious blocks).

**REVERSIBILITY:** Two-way door: test code, a scenario length, two list labels, ticket text, one CI timeout. ADR: no.

### Exact text changes

**New file `issues/74-s5-short-growth-after-retention-bound.md`** (the orchestrator commits it first):

```
# 74: S5/short: judge MCP bridge growth after the retention bound (1,200 tasks, window 600–1,200)

**Blocked by:** 30 (MCP task retention (500 / 7 days) and the idempotency window)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: none

**What to build:** S5/short's 400-task window measures runtime warm-up and task history below ADR-0009's 500-task bound, which no fix can bring under 5 %/1k (Round 24 Q1). Run S5/short for 1,200 tasks with today's per-task workload and judge `growth:mcp-bridge` over tasks 600–1,200 (warm-up fraction 0 inside the window; `growth()`, 5 %/1k and the trend rule unchanged). Add `warm-up-growth:mcp-bridge`: today's quantity (load window cut at task 400, default 25 % warm-up), RED above 55 %/1k on linux (RSS) and above 30 %/1k on windows (commit) regardless of trend. procPeak (150 MB), reboot cost (20 MB), task failures (0) and orphans are judged over the whole run. This ticket owns both `S5/short` entries (re-owned from 30) and is their only exit.

**Acceptance criteria:**

- [ ] Tests RED first at the job seam: growth to task 600 then flat is GREEN; growth continuing after 600 with trend is RED; warm-up 55.1 (linux) / 30.1 (windows commit) is RED with a GREEN post-bound window; a load ending before 1,200 or < 6 samples after 600 is a harness failure / insufficient; window bounds are printed in summary.json and the job summary.
- [ ] Mutant proof (local linux, never committed): the count bound removed (ticket 30's M1) is RED on growth:mcp-bridge (value > 5 and trend) in every one of ≥ 3 runs; the tree with 30 is ≤ 5 with the warm-up value under its ceiling in every one of ≥ 3 runs. Otherwise come back with the numbers.
- [ ] Exit: ≥ 10 fresh runs per leg on this tree via an off-by-default S5-only measurement mode (several CI runs or parallel jobs allowed), every one with growth:mcp-bridge ≤ 5 %/1k on the new window whatever the trend flag says, the warm-up value under its ceiling, and every other S5 check GREEN; values (commit and WS on windows), trend, window medians, sample counts and durations recorded in METRICS.md and here.
- [ ] The same commit deletes `S5/short` from both legs of `expected-red.json` and removes it from `UNSTABLE`; the schema then rejects `unstable` on S5/short (replacing the band tests, justified). The pre-merge run shows S5/short GREEN on both legs with no entry.
- [ ] Fallback: if the mutant proof or the exit fails on either leg, nothing merges in part; the ticket comes back with all values. No budget, ceiling, window or task count is changed to fit.
- [ ] The ubuntu `memory-budget` `timeout-minutes` goes from 75 to 100 (wall-time guard, not a budget).
- [ ] Spec §18 S5 row and METRICS.md updated (Round 24 Q1 condition 10).

**Common acceptance (every ticket):** as in every ticket file.

Spec stories: none (measurement rule, Round 24 Q1)

## Comments

- 2026-11-08 (orchestrator, Owner Proxy round 24, binding): re-owned from 30. Until this ticket merges, Round 17 Q2 condition 3's wrong-owner watch (any linux S5/short value ≤ 5 %/1k on the old window comes back as an ownership question) and Round 17 cross-question signature (iv) are recorded here. Staged run 42475847194 (30's tree): windows 14.5 %/1k commit (trend false, in band), linux 31.82 %/1k (trend false, flip GREEN).
```

**`issues/30-mcp-task-retention-and-idempotency-window.md`.** Replace the two Acceptance bullets that begin `- [ ] Loop S5: growth ≤ 5 %/1k` and `- [ ] Linux exit (Round 17 Q2 condition 2;` with:

```
- [ ] Loop S5/long (3,000 tasks): GREEN on every check (growth ≤ 5 %/1k, procPeak ≤ 150 MB, reboot cost of history ≤ 20 MB, 0 task failures), tip RED → branch GREEN recorded.
- [ ] Loop S5/short: no new RED on either leg (linux listed, growth:mcp-bridge only; windows inside the 5–30 %/1k commit band; every other S5 check GREEN); values recorded. Both S5/short entries are re-owned to ticket 74, which holds their only exit (Round 24 Q1; explicitly contradicts Round 13 Q1 condition 4 and moves Round 17 Q2 condition 2's exit to 74).
```

Add under `## Comments`:

```
- 2026-11-08 (orchestrator, Owner Proxy round 24, binding): merges on retention and S5/long. Staged run 42475847194: windows S5/short 14.5 %/1k commit (WS −4.24, trend false, in band); linux 31.82 %/1k (trend false, flip GREEN; window medians from the run's summary.json to be recorded here, Round 17 Q2 condition 3); all other S5 checks GREEN on both legs. The S5/short entries are re-owned to 74 in this tree, followed by one restaged run. The per-task footprint (~4.6 KB heap / ~28 KB RSS per retained task) is bounded by the 500 bound and gets no ticket (C9).
```

**`tests/memory/expected-red.json`** (in 30's tree, the only list edit; replaces the two `S5/short` lines):
- linux: `"S5/short": { "owners": { "74": ["growth:mcp-bridge"] }, "flips": ["growth:mcp-bridge"] },`
- windows: `"S5/short": { "ticket": "74", "state": "unstable" },`

Ticket 74 later deletes both keys (condition 7). No other entry changes.

**`issues/INDEX.md`.**
- New row: `| 74 | [S5/short: judge MCP bridge growth after the retention bound (1,200 tasks, window 600–1,200)](74-s5-short-growth-after-retention-bound.md) | sol | medium | 30 | ready-for-agent |`
- Row 57's Blocked-by cell: `30, 36, 74`. Row 56's cell: `13, 30, 31, 36, 57, 74`. Row 55's cell: insert `74` after `61`.
- The `**Blocked by:**` lines of issues 55, 56 and 57 gain `74 (S5/short: judge MCP bridge growth after the retention bound)`.

**Edges.**
- **74 ← 30:** the rule needs the bound, and the mutant proof compares against it.
- **57 ← 74:** same file, `s5-mcp.mjs`, plus S5 measurement separation, as Round 12 Q1 ruled for 57 ← 30.
- **56 ← 74:** 56's memory gates compare S5 values against a base, so both must use one rule. 56 is also transitive through 57.
- **55 ← 74:** 74 owns two entries, and 55 needs an empty list.
- **No edge to 71:** 71 edits `REPEATED` in `budgets.mjs` and 74 edits `UNSTABLE` in `ratchet.mjs`, so they change different constants, and the later merge rebases.
- **Acyclic, checked.** 74's ancestors are 30 and 13 ← 12 ← 11 ← 10 ← 09 ← 02, 03, 04 (01). Its descendants are 55, 57 → 56 → 53 → 54. None of them is an ancestor of 30 or 13.

**`spec.md:645` (S5 row).** Append: `Measurement-rule amendment (Round 24 Q1): S5/short runs 1,200 tasks; growth:mcp-bridge is judged over tasks 600–1,200 (the 500-task retention bound plus 100 settling tasks, warm-up fraction 0 inside), budget and trend rule unchanged; warm-up-growth:mcp-bridge (tasks to 400, today's quantity) is RED above 55 %/1k on linux and 30 %/1k commit on windows regardless of trend; procPeak, reboot cost, failures and orphans are judged over the whole run. Both S5/short entries are owned by ticket 74, whose only exit is ≥ 10 fresh runs per leg at ≤ 5 %/1k on the new window.`

---

## Shared understanding

Open branches I still see (none blocks 30's merge):
1. **Windows post-bound value: EVIDENCE MISSING.** No windows S5 run has gone past 400 tasks. 74's exit decides it. If windows misses, it comes back with the values.
2. **The mutant's trend margin is thin on one run.** On the tip over 600–1,200 the net rise is 13.8 % against the 10 % threshold. Condition 5's ≥ 3 runs test it. If the trend flag misses it, the window question comes back, and a value-only rule for this key would be its own question.
3. **The per-task footprint (~28 KB of RSS per retained task, ~14 MB at the bound) has no owner by design.** It comes back if a bridge level budget (S5 procPeak, or 37's S3 bridge peak, which runs no tasks) is ever tied to it.
4. **CI wall time grows by ~24 min per leg per memory run** (condition 9). If it starts to constrain the staging pace, it comes back with the job durations.
5. **Until 74 merges, the Round 17 items stay open:** linux S5/short has no value ceiling, the wrong-owner watch is active, and signature (iv) applies.


---

# Round 25 (2026-11-08) — windows S5/short above the unstable band


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–24 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only on the worktree; downloads in new directories under `/home/AgentKit/overhaul-tools/ci-art/`):
- `OWNER-PROXY-BRIEF.md`, `rounds/round-25.md`; DECISIONS Rounds 13, 17, 21 and 24 in full; issues 30, 36, 74 (and 21's diff); METRICS.md S5 tables (lines 258–327, 402); RUNLOG to 13:25Z; STATE.md.
- The windows and ubuntu `memory-budget` job logs (jobs API) of **every** `ci.yml` run from 42404639968 to 42484868282: 59 runs, 58 with an S5 line (42467078897's memory legs never ran: setup-bun HTTP 504). Copies: `ci-art/r25-logs/{win,lin}/<run>.log`, list `runs.txt`.
- The `memory-budget-windows` artefacts of 42480631098 and 42483637377 (`ci-art/r25-art-<run>/S5-short/*/summary.json`).
- The windows `test-kit` job logs of every failed test-kit job in the 30 runs 42446391907 … 42484868282 (`ci-art/r25-logs/tk/`, `job-128731568530.log`).
- Git (read-only): `git diff --stat 16bfaa2 0f87d20` (staging/21 = 16bfaa2 + ticket 21), `git diff f383d6b 16bfaa2 -- mcp/ lib/mcp-bridge.mjs tests/memory/…`, ancestry of each run's head against 7555b87 (36), 16bfaa2 and f383d6b (13); `tests/memory/scenarios/s5-mcp.mjs`, `tests/memory/lib/ratchet.mjs:51-104`.

**Corrections to the round's facts.**
1. **42480631098 has a second failure that the round does not mention.** `test-kit (windows-latest, 26)` (job 128731568530) fails `zcode-proxy-src/src/auth/login-store.test.ts:181`, "kit setup, enable/disable and provider/import/account flags work through the real wrapper": it timed out after 5,000 ms (5,372 ms), and `runKit(["accounts","enable"])` returned status `null`. This test failed in none of the other failed test-kit jobs of the 29 other runs from 42446391907 to 42484868282. Ticket 21's diff touches `zcode-proxy-src/src/index.ts`, `server/server.ts`, `config/loader.ts` and the new supervisor, which is code the real wrapper runs. So the run is not "RED on one line".
2. **30.23 is not the only value above the band. Ticket 30's restaged run 42483637377 has finished and fails on the same line at 34.62 %/1k commit, with trend true** (WS 19.17; window medians 70.9, 74.4, 76.9, 76.3, 77.4, 78.7 MB; 3 rising windows, net rise 11 %; slope 26.24 MB/1k on a mean of 75.8 MB). Its windows job also has `S1/short: RED but not listed` (growth:proxy 5.18 %/1k commit, WS 2.46, trend true). STATE.md still plans "merge … 21 (42480631098), 30 (42483637377)". Neither run is green.
3. **staging/21 runs the same bridge code as the 40 other runs on the ticket-13 tree without 36.** Between 13's merge (f383d6b) and 16bfaa2, the only change under `mcp/`, `lib/mcp-bridge.mjs`, `s5-mcp.mjs` and `tests/memory/lib/` is `ratchet.mjs` (67's owners map), which judges values and does not produce them. Ticket 21 adds nothing under `mcp/`, `lib/`, `tests/`, `.github/` or `package.json`. So 30.23 is the tail of unchanged code. Ticket 36's projection cannot explain it, because staging/21 does not contain 36 (bridge `empty` 77 MB; trees with 36 read 66–67).
4. **Neither leg shows ticket 13's "shift" in CI.** Windows median: 18.14 before 13 (n = 39) and 18.05 on the 13 tree without 36 (n = 40, excluding 42480631098). Linux median: 42.63 before 13 (n = 37) and 42.12 on the 13 tree (n = 41). **EVIDENCE MISSING: the source of "linux median 39.54 → 44.28".** CI does not reproduce it. So 36's "compounded ~31" projection has no measured basis. Its ×1.09 base effect alone remains plausible on windows: one run's mean is 75.8 MB with 36 against 80.8 MB without it.
5. **The windows tail is heavier than Round 13 measured.** I recomputed from the job logs (commit, the gate metric):

   | set | n | min | median | mean | sd | max | > 30 |
   |---|---|---|---|---|---|---|---|
   | Round 13's 28 (to 42404639968) | 28 | 14.27 | 18.25 | 19.04 | 3.43 | 26.24 | 0 |
   | before 13, after Round 13 (42408170742–42424608767) | 11 | 14.74 | 17.98 | 17.75 | 1.72 | 20.34 | 0 |
   | 13 tree without 36 (42425069025–42481592284) | 41 | 11.99 | 18.08 | 19.06 | 4.31 | **30.23** | 1 |
   | trees with 36 (42454650683 15.43, 42469209389 18.14, 42483637377 **34.62**, 42483787372 19.82, 42484868282 24.83) | 5 | 15.43 | 19.82 | 22.57 | 7.56 | 34.62 | 1 |
   | all | 85 | 11.99 | 18.14 | 19.09 | 4.08 | 34.62 | 2 |

   - Per-run P(> 30): all 85, normal 0.37 % / log-normal 0.94 %, empirical 2/85 = 2.35 % (95 % Clopper-Pearson 0.29–8.24 %).
   - On the 13 tree scaled by 36's ×1.09 (the base every tree now has): 2.47 % / 3.72 % (1.38 % / 2.61 % without 42480631098).
   - Round 13 Q1 condition 2's 0.07 % / 0.39 % is superseded.
   - The 13-tree tail had already come near the bound: 27.72 (42436354758) and 29.44 (42435917288).
   - In absolute terms, 30.23 is 24.42 MB/1k (mean 80.8 MB, window medians 76.7, 79, 80.7, 81.1, 83.2, 82.6, no rising run, net 7.7 %, trend false). Every other S5 check was GREEN: procPeak 74.6 WS, reboot cost 4 MB, 0 failures, 0 orphans, units self-test ok, `@@JOB applied=1`.
6. **"74 replaces the measurement this tail lives in" is wrong.** Round 24 Q1 condition 3 carries *this exact quantity*, computed exactly as now, into 74's `warm-up-growth:mcp-bridge`. It is RED above 30 %/1k on windows commit regardless of trend, with no listing. So the tail survives 74 as a hard check. 74's exit needs ≥ 10 windows runs with the warm-up value under 30. At 1.4–3.7 % per run, that fails by chance in 13–32 % of attempts (P(10 of 10 pass) 87.0–68.4 %).

---

## Q1 — windows S5/short `growth:mcp-bridge` 30.23 %/1k on commit (bound 30)

**DECISION:** REJECTED in part.

Accepted:
- The 30 %/1k band bound, the 5 %/1k budget, `growth()` and every other S5 check stay exactly as they are. **I loosen no bound.**
- **The S5 failure of 42480631098 is not charged to ticket 21** (corrections 3 and 5).
- An interim signature (vi) for tickets whose diff cannot change the S5 value, with a hard ceiling of 35.

Rejected or corrected:
- (i) **"The run does not count against ticket 21."** Only its S5 line is excused. The windows test-kit Node 26 failure (correction 1) is undecided and covered by no signature. So **42480631098 is a failed pre-merge run for 21, and 21 does not merge on it.**
- (ii) **"Record it as the first windows value above the band"** is incomplete. 42483637377 (ticket 30, 34.62, trend true) is the second. Ticket 30's diff touches `mcp/**`, so (vi) does not cover it. Under Round 24 Q1 condition 1, it is a disagreement of 30's restaged run, so 30 does not merge on it, and it comes back as its own question.
- (iii) **"74 replaces the measurement"** (correction 6). The interim cannot simply end at 74's merge. 74 gains a merge precondition (condition 5).
- (iv) **The prioritisation of 74 "right after 30 merges"** is not decided here. Ordering is the orchestrator's. Today 30 cannot merge (ii), and 74 is blocked by 30 and by condition 5.

**This explicitly departs from:**
- **Round 13 Q1 condition 1 ("value > 30 fails the ratchet, a step change") together with condition 6, Round 6 Q2 condition 4's last bullet and PROMPT §7 Phase 4's revert rule**, for signature (vi) only. The ratchet still prints FAILED above 30 on every run. What changes is the consequence: for an eligible ticket, a value in (30, 35] no longer blocks the merge or causes a revert. **Stated plainly, this loosens the merge consequence for eligible tickets from 30 to 35.** It does not change the measurement, the bound or the band. The reason: the value comes from bridge code byte-identical to 40 runs, and no queued ticket can fix it before 74, while the code that can move the value keeps the full 30 bound.
- **Round 13 Q1 condition 2's risk figures** (superseded by correction 5). The bound itself is unchanged.
- **Round 24 Q1 conditions 3 and 7**: the windows warm-up ceiling's justification ("Round 13's 28-run justification") is stale, so 74's merge gains a precondition. The ceiling value of 30 is not changed by this round.

It is consistent with Round 13's Shared understanding ("a windows S5/short value > 30 … comes back with numbers"; this round is that return) and with Round 17 cross-question condition 2 and Round 21 Q1 condition 6 (same shape, one more signature).

Binding conditions:

1. **Signature (vi), interim, amends Round 17 cross-question condition 2.** A staged or post-merge run whose windows `memory-budget` failure is only `S5/short: unstable growth:mcp-bridge <v> %/1k (commit) is above the 30 %/1k bound` does not count against the ticket, does not block its merge and causes no revert, when all of the following hold:
   - 30 < v ≤ **35** on commit, trend either way;
   - every other S5 check is GREEN: `procPeak:mcp-bridge` ≤ 150 MB WS, `orphans` 0, `bridge:reboot-cost-of-history` ≤ 20 MB, `bridge:task-failures` 0;
   - the growth check has a value and is not `insufficient`, `@@JOB applied=1` is printed, and the units self-test passed;
   - every other failure of the whole CI run matches another open signature.

   Any S5 value above 35, any other S5 RED, or a measurement gap fails as before.
2. **Ineligible diffs (no exception).** A ticket gets no exception if its diff touches any of:
   - `mcp/**`, `lib/mcp-bridge.mjs`, `tests/memory/scenarios/s5-mcp.mjs`;
   - `tests/memory/lib/{verdict,budgets,sampler*,win-*,ratchet}.mjs`, or the `S5/short` entries of `tests/memory/expected-red.json`;
   - the Bun pin, or the Node version of the `memory-budget` job in `.github/workflows/ci.yml` (the bridge runs under Node).

   So 30, 74, 56 and 57 are ineligible.
3. **Recording.** Each occurrence goes into **74's** Comments (74 owns the entry, Round 24 Q1 condition 2) and into the METRICS windows table. Record: run id, tree, commit and WS values, trend, slope MB/1k, mean MB, window medians (from `summary.json`). The first occurrence is 42480631098.
4. **Comes back (with the table; none of these suspends (vi) for eligible tickets meanwhile, except the 35 ceiling, which always fails).**
   - The pre-registered set: the first 20 windows S5/short values on trees that contain ticket 36, any branch. The first five are those in correction 5.
   - **The triggers:**
     - ≥ 3 of the 20 are above 30;
     - or any value is above 35;
     - or the 20-run mean is above 23 %/1k.
   - **Why these thresholds.** 23 is the 13-tree mean × 1.09 (20.77) plus two standard errors of a 20-run mean (sd 4.69): 22.87. Under the per-run rates of correction 5, ≥ 3 of 20 happens by chance 0.25–3.66 % of the time.
   - **Two meanings.** A trigger means a shift on the current base, not a tail, and its owner is an ownership question. If no trigger fires, the 20-run table is the evidence for condition 5.
5. **Ticket 74's merge precondition.** 74 does not merge before two things exist:
   - condition 4's 20-run table in METRICS;
   - an Owner Proxy round that re-confirms or re-decides the windows `warm-up-growth:mcp-bridge` ceiling of 30 on that table.

   The rules for 74's own runs:
   - Signature (vi) never applies to 74's runs (condition 2).
   - A windows warm-up value above 30 in 74's mutant, exit or pre-merge runs follows Round 24 Q1 condition 8: nothing merges in part, and it comes back with all the values. The implementer never changes the ceiling, the window or the task count.
   - (vi) ends when 74 merges.
6. **Run 42480631098 and ticket 21.**
   - The S5 line is (vi)'s first occurrence and is not charged to 21.
   - The windows test-kit Node 26 failure (correction 1) is charged to 21 under the normal rules. No signature covers it, and nothing is rerun until it turns green. If 21's implementer shows, with evidence, that the timeout also occurs on a tree without 21, it comes back as its own question.
   - 21's next pre-merge run is judged with (vi) in force.
7. **Run 42483637377 and ticket 30.** The S5 line at 34.62 with trend true is not excused (30 touches `mcp/**`). Its S1/short line matches Round 17 signature (ii): commit only, 5.18 ≤ 10, and 30 touches neither `zcode-proxy-src/**` nor `s1-proxy-steady.mjs`. Under Round 24 Q1 condition 1, the restage disagrees with 42475847194 (14.5, trend false). So 30 does not merge on it, and the numbers come back as their own question. **EVIDENCE MISSING: whether 34.62 comes from 30's code, from 36's base (30's first staged run lacked 36), or from the tail.** That question needs at least the next 36-tree values without 30 beside it.
8. **Nothing else changes:**
   - the 5 %/1k budget, `MEMORY.growth`, `growth()`;
   - the windows band (5 < v ≤ 30) and `UNSTABLE`;
   - the S5 budgets (150 MB, 20 MB, 0);
   - Round 7 Q1's metric split;
   - the linux S5/short entry and its flip mark;
   - Round 24's 74 rule (1,200 tasks, window 600–1,200, linux 55 / windows 30 warm-up ceilings).

   No ratchet code changes; (vi) is a merge-gate rule the orchestrator applies.
9. **Records.**
   - METRICS gains the 85-run windows table (correction 5) under the Round 13 table, and keeps it current for condition 4.
   - RUNLOG records this round's departures (above), corrections 1, 2 and 4, and that STATE's planned merges of 21 on 42480631098 and of 30 on 42483637377 do not happen.

**Rationale:** The numbers show a heavier tail on unchanged bridge code, not a regression by ticket 21. staging/21 executes the bridge exactly as 40 other 13-tree runs did (30.23 commit, 24.42 MB/1k, no trend), and the 85-run history puts the per-run chance of > 30 at roughly 0.4–3.7 % depending on the fit and the tree. With no exception, that tail would block unrelated merges on the primary platform at random, on a defect no queued ticket fixes before 74. Raising the bound would weaken the only windows regression bound on bridge growth for the code that can actually move it. So the answer is the Round 17 shape: the bound stays at 30 for every ticket that touches the bridge, its measurement or its runtime, and tickets that cannot touch it pass (30, 35] while > 35 still fails.

The recommendation was right on that core and wrong on three facts:
- the run's second failure;
- ticket 30's 34.62;
- 74 inheriting the same tail.

Without condition 5, the exception would never end, and 74's exit would fail by chance in up to a third of attempts.

**Charter:** C1 (bridge growth stays bounded: 30 for code that can move it, a hard 35 ceiling for everyone, and the other S5 checks hard), C7 (windows primary: a gate that holds without random blocks; linux unchanged), C9 (stronger measured evidence: 85 windows and 83 linux runs recomputed; smaller blast radius: one interim signature, no ratchet or budget change), §9 (5 %/1k and 30 unchanged), Round 13 Q1 conditions 1–3 and 6 and Shared understanding, Round 17 cross-question condition 2, Round 21 Q1 condition 6, Round 24 Q1 conditions 1–3, 7–8, PROMPT §7 Phase 4 (no rerun-until-green; no spurious blocks or reverts).

**REVERSIBILITY:** Two-way door (a merge-gate rule, records, ticket text, and a precondition on one ticket's merge). ADR: no.

### Ticket-text changes (exact)

**`issues/74-s5-short-growth-after-retention-bound.md`**
- New Acceptance criterion before "Fallback":
  `- [ ] Windows warm-up ceiling (Round 25 Q1 condition 5): this ticket does not merge before METRICS holds the first 20 windows S5/short values on trees containing ticket 36 and an Owner Proxy round has re-confirmed or re-decided the windows 30 %/1k warm-up-growth ceiling on them (Round 13's 28-run justification is superseded: 2 of 85 windows values exceed 30). Signature (vi) never applies to this ticket's runs; a windows warm-up value above 30 in a mutant, exit or pre-merge run comes back under the Fallback; the ceiling is never changed by the implementer.`
- Comments gains:
  `- 2026-11-08 (orchestrator, Owner Proxy round 25, binding): interim signature (vi): a windows S5/short run whose only failure is the band's bound, 30 < growth:mcp-bridge ≤ 35 %/1k commit, every other S5 check GREEN, does not count against a ticket whose diff touches none of mcp/**, lib/mcp-bridge.mjs, tests/memory/scenarios/s5-mcp.mjs, tests/memory/lib/{verdict,budgets,sampler*,win-*,ratchet}.mjs, the S5/short entries of expected-red.json, the Bun pin or the memory-budget job's Node version; recorded here each time (run, tree, commit/WS, trend, slope MB/1k, mean MB, window medians); ends when this ticket merges. First occurrence: 42480631098 (staging/21, 30.23 commit / WS 42.29, trend false, 24.42 MB/1k on 80.8 MB, medians 76.7, 79, 80.7, 81.1, 83.2, 82.6). Not covered (ticket 30's tree): 42483637377, 34.62 commit / WS 19.17, trend true, 26.24 MB/1k on 75.8 MB, medians 70.9, 74.4, 76.9, 76.3, 77.4, 78.7.`

**`issues/21-health-supervisor-and-graceful-shutdown.md`** Comments gains:
`- 2026-11-08 (orchestrator, Owner Proxy round 25): pre-merge run 42480631098: the windows memory failure (S5/short 30.23 %/1k above the 30 bound) is signature (vi) and not charged to 21 (diff touches no bridge, S5 or measurement code). The run is still a failed pre-merge run: windows test-kit Node 26 fails login-store.test.ts:181 ("kit setup, enable/disable … through the real wrapper", 5 s timeout, accounts enable status null), unexcused and charged to 21 under the normal rules; seen in no other failed test-kit job of runs 42446391907–42484868282.`

**`issues/30-mcp-task-retention-and-idempotency-window.md`** Comments gains:
`- 2026-11-08 (orchestrator, Owner Proxy round 25): restaged run 42483637377 (a53152d, with 36) disagrees with 42475847194: windows S5/short growth:mcp-bridge 34.62 %/1k commit (WS 19.17), trend true, above the 30 bound; signature (vi) does not apply (diff touches mcp/**). Its S1/short line (growth:proxy 5.18 commit only) is Round 17 signature (ii). Under Round 24 Q1 condition 1 the ticket does not merge on this run; the numbers come back as their own question.`

---

## Shared understanding

Open branches I still see:
1. **Ticket 30's restage (34.62, trend true) needs its own question** (condition 7). Is it 30's code, 36's lower base (×1.07 in this run's mean), or the tail? The decision needs the next 36-tree values without 30 beside 30's next run. 74, 31 and 57 wait on it.
2. **Ticket 21's windows test-kit timeout is unattributed** (correction 1). It is 21's to diagnose. It comes back only with evidence that it also occurs without 21.
3. **Condition 4's 20-run windows table on 36 trees** decides whether 30.23 and 34.62 are a tail or a shift. A shift would reopen ownership of the windows S5 growth and the band itself.
4. **The source of the "linux 39.54 → 44.28" shift is EVIDENCE MISSING.** CI shows no shift on either leg (correction 4).
5. **Not decided here, recorded only:** integration run 42484868282 (eaa91b3, 36 + 15's `setup.mjs`) fails windows test-kit Node 24 and 26 on "an old proxy (origin/main) calling the new manager's respawn CLI gets a fresh proxy". That is the combination STATE watches. Its windows S5 is 24.83, inside the band.


---

# Round 26 (2026-11-08) — tickets 30 and 74 staged together


Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–25 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md`, `rounds/round-26.md`.
- DECISIONS Rounds 13, 17, 24 and 25 in full. I also read Round 8 for the 02 + 60 precedent the round cites: there, the ≥ 20 windows repetitions decided the rule, and then one pre-merge run confirmed it and decided nothing.
- The integration tree at c457fd8: `issues/30-*.md`, `74-*.md`, `56-*.md`, `57-*.md`, `INDEX.md`, METRICS.md lines 258–327, RUNLOG lines 177–180, STATE.md.
- Ticket 30's branch, head 2c6720c (`git -C /home/AgentKit/wt/t30 show HEAD:…`): its issue file in full and `git diff --stat` against the merge base. That is 14 files: `mcp/**`, `dist/**`, the retention test and fixtures, `expected-red.json`, `job.mjs`, `ratchet.mjs` (a comment), `loop.test.mjs`, `verdict.test.mjs` and the ticket.
- CI runs 42475847194 and 42483637377, from the job logs under `/home/AgentKit/overhaul-tools/ci-art/r25-logs/{win,lin}/` and `gh run view --json jobs`.
- Every windows and linux S5/short `growth:mcp-bridge` line in `ci-art/r25-logs` (57 windows and 58 linux values after Round 13), plus METRICS' 28 Round 13 windows values. I recomputed every statistic below from these.
- `gh run list`, for the runs started after Round 25.
- Ancestry checks: a53152d (the head of 42483637377) contains 2c6720c. 8126454 and 57c3db0 contain 7555b87 (ticket 36) and do not contain 0a059ad (ticket 30).

**Recomputed facts and corrections to the round.**
1. **Confirmed: Round 25's windows table.**
   - n = 85: min 11.99, median 18.14, mean 19.09, sd 4.08, max 34.62; 2 values above 30.
   - P(> 30) per run: normal 0.37 %, log-normal 0.94 %.
   - On the 13 tree scaled by ×1.09 (41 runs; mean 20.77, sd 4.69): 2.47 % / 3.72 %. Without 42480631098 it is 1.38 % / 2.61 %.
2. **34.62 does not "sit inside" the distribution. It is its maximum, and it is extreme.**
   - Against the other 84 values (mean 18.91, sd 3.73), z = 4.2. P(≥ 34.62) per run is 0.001 % on a normal fit and 0.054 % on a log-normal fit.
   - It is one of only 2 windows runs in 85 with trend true. The other is 42404639968.
   - 14.5 sits at the 7th percentile (6 of 85 values are ≤ 14.5).
   - On linux, 30's two runs are 31.82 (the minimum of 58 runs) and 44.23 (above the median of 42.25).
   - "30's code is not expected to move windows S5/short" is a mechanism argument: no eviction happens below 500 tasks. It is not a measurement. Round 25 Q1 condition 7's **EVIDENCE MISSING (is 34.62 30's code, 36's base, or the tail?)** still stands, and two runs per arm cannot settle it.
3. **"30's own windows S5/short value under the old rule is then not judged" is wrong.**
   - 74's `warm-up-growth:mcp-bridge` is *today's quantity, computed exactly as now* (Round 24 Q1 condition 3; Round 25 correction 6). On windows it is RED above 30 %/1k on commit regardless of trend.
   - So every run of the joint tree judges 30's code on the same quantity, at the same 30 bound, with no band and no signature (vi).
   - The joint staging therefore judges 30 more strictly than a restage, not less.
4. **"The 20 windows runs round 25 requires come from that staging branch" would rewrite a pre-registered set.**
   - Round 25 Q1 condition 4's set is "the first 20 windows S5/short values on trees that contain ticket 36, any branch". It already holds five values: 15.43, 18.14, **34.62** (30's tree), 19.82, 24.83.
   - Two more 36-tree runs are in progress: 42493218404 (integration 8126454) and 42494299680 (staging/29 57c3db0). **EVIDENCE MISSING: their S5/short values.**
   - Filling the set from the joint branch alone would drop 34.62 and the in-progress runs after they were seen.
5. **Run 42483637377 failed one job only: windows `memory-budget`.**
   - S5/short 34.62 (ineligible for any signature).
   - S1/short 5.18 commit (Round 17 signature (ii); that interim ended when 71 merged, RUNLOG 15:07Z).
   - All four test-kit legs and the linux memory leg were green. Linux S5/short was 44.23 with trend true, listed under 74.
6. **Round 25's ticket-text changes have not been applied to the integration tree at c457fd8.** These are 74's ceiling criterion and Comments line, 30's and 21's Comments lines, and the 85-run METRICS table: `grep` finds no "round 25" in these files. The text changes below assume they are applied first.
7. **How much one more restage of 30 can show.** On the 36 base (mean 20.77, sd 4.69), suppose 30's code raised the mean by 3 %/1k. A single run would still be ≤ 30 with P = 0.91. Ten runs would all be ≤ 30 with P = 0.38 (+5: 0.82 and 0.13). For an innocent tree, the chance that at least one of 10 runs is above 30 is 3.6–31.6 % (p = 0.37–3.72 %). With 20 joint runs it is 7.1–53.1 %.

---

## Q1 — how do 30 and 74 get out of the cycle?

**DECISION:** REJECTED in part.

Accepted:
- **Joint staging.** 74 is built on ticket/30. One staging branch takes the integration tip, then ticket/30, then ticket/74. One pre-registered set of evidence runs on one identical tree replaces 30's single restage and is 74's exit. 30 and 74 merge back to back.
- Run 42483637377 is not excused. It stays on record as value 3 of Round 25's set and in 30's subset (condition 5).

Rejected or corrected:
- (i) **"30's value under the old rule is not judged"** (correction 3). 30 is judged on the old quantity, at the old 30 bound, in every one of the joint runs. Its verdict is defined separately from 74's (condition 4).
- (ii) **"The 20 runs come from that staging branch"** (correction 4). Round 25's set stays as pre-registered, any branch, in run-creation order. Joint-tree runs enter in their place, and nothing is dropped (condition 5).
- (iii) **20 joint runs.** That doubles the by-chance fallback (correction 7). The joint tree gets **exactly 10 runs per leg**, fixed before the first one. That is the minimum Round 24 Q1 condition 7 requires.
- (iv) **"Merge back to back only if the set passes 74's criteria."** This would hold a finished C1 fix hostage to 74's own open risks: the windows post-bound value (EVIDENCE MISSING since Round 24) and the mutant's thin trend margin. 30 gets its own verdict from the same runs, and it may merge alone if only 74 fails (condition 6).
- (v) **Judging the exit on runs that also re-set its ceiling.** This is circular. The exit is judged against the ceiling in force (30), and a changed ceiling needs fresh exit runs (condition 3).

**This explicitly departs from:**
- **Round 24 Q1 condition 1** ("one restaged run must show the same outcomes"). It is replaced by 10 runs per leg with the hard 30 bound, which is a **tightening**. The one restage disagreed, and a single further run has almost no power to attribute 34.62 (correction 7).
- **Round 24 Q1's rationale** ("rather than holding 30 until ~20 more S5 evidence runs exist"). 30 now waits for 10 runs and for Round 25's set to complete. Condition 6 keeps 30 off 74's own failure modes.
- **Round 24 Q1 condition 7.** "≥ 10" is narrowed to exactly 10 (pre-registered). Full CI runs of the identical tree are accepted beside the S5-only mode. They are the same job and the same checks, with more checks around them, so this is not a loosening.
- **Round 25 Q1 condition 4** is only clarified, not changed: "first" means run-creation order, and on a tree with 74's rule the recorded value is `warm-up-growth:mcp-bridge` on commit.

It is the return Round 25 Q1 condition 7 asked for. It follows Round 8 (02 + 60 staged together, distribution first, the pre-merge run confirms) and Round 13 Q1 condition 6 (a restage on a changed tree after a cause decided here is not a rerun-until-green). Round 25 Q1 conditions 2 and 5 stand unchanged: no signature (vi) for 30 or 74, and 74 does not merge before the 20-value table and the ceiling round.

**I loosen no bound.** The 5 %/1k budget, `growth()`, `MEMORY.growth`, the 1,200 tasks and the 600–1,200 window are unchanged. So are the warm-up ceilings (55 linux, 30 windows commit), the windows band (5 < v ≤ 30), signature (vi) with its hard 35, the S5 budgets (150 MB, 20 MB, 0) and Round 25's triggers.

Binding conditions:

1. **Staging.**
   - 74 is implemented on ticket/30 (2c6720c or its successor).
   - The staging branch is the current integration tip (it contains 36 and 71), then ticket/30, then ticket/74.
   - 74's local mutant proof (Round 24 Q1 condition 5) comes before any staging, unchanged.
   - Edge 74 ← 30 is unchanged, and no edge changes. I checked the graph from INDEX.md (74 rows): it is acyclic. 74's ancestors are 30, 13, 12, 11, 10, 09, 04, 03, 02 and 01. Its descendants are 55, 56, 57, 53 and 54. 30's descendants are those plus 31, 52 and 74.
2. **Evidence runs (pre-registered).**
   - Before the first run, RUNLOG records the joint tree's hash and the count: **10 runs per leg**. They run through 74's off-by-default S5-only mode or as full CI runs (empty commits) of that identical tree.
   - Every run on that tree counts. None is added, dropped or replaced once it has an S5/short value.
   - A run with no S5/short value (an infrastructure failure before S5) is replaced, and the replacement is recorded.
   - Each run records:
     - the post-bound `growth:mcp-bridge` (commit and WS on windows, RSS on linux), its trend, window medians and sample counts;
     - `warm-up-growth:mcp-bridge` (commit and WS on windows), its slope in MB/1k, mean MB and window medians;
     - procPeak, reboot cost, task failures, orphans and duration.
   - Failures outside S5 are recorded and handled under the normal rules. They do not remove the run's S5 values.
3. **74's verdict** on these runs is Round 24 Q1 condition 7 plus Round 25 Q1 condition 5, unchanged:
   - every run has the post-bound value ≤ 5 %/1k whatever the trend flag says;
   - the warm-up value is ≤ 55 (linux) and ≤ 30 (windows commit);
   - every other S5 check is GREEN.

   The exit is judged against the windows ceiling in force when the runs ran (30). Then Round 25 condition 5's round takes place on the 20-value table:
   - If it re-confirms 30, the 10 runs stand as the exit.
   - If it lowers the ceiling, the same runs are re-judged against the lower value.
   - If it raises the ceiling, the exit needs 10 fresh runs per leg after that round. The ceiling is never fitted to the runs it judges.
4. **30's verdict**, read from the same runs (or, under condition 6c, from its own tree's runs, on the band value, which is the same quantity):
   - Windows: every one of the 10 values satisfies 5 < v ≤ 30 %/1k commit. A value ≤ 5 comes back as an ownership question (Round 13 Q1 condition 1; Round 17 Q2 condition 3).
   - Linux: every value is ≤ 55 %/1k.
   - In every run, every other S5 check is GREEN: procPeak ≤ 150 MB (WS on windows), reboot cost ≤ 20 MB, 0 task failures, 0 orphans.
   - Round 25's set is complete and fires no trigger.
   - Signature (vi) never applies.
   - Any value above 30, or any other S5 RED, sends both tickets back with all values, with no rerun. For 74 this is its fallback (Round 24 Q1 condition 8; Round 25 Q1 condition 5).
5. **Round 25's set.**
   - It is unchanged in definition, in run-creation order. Its first five values are 42454650683 15.43, 42469209389 18.14, 42483637377 34.62, 42483787372 19.82 and 42484868282 24.83. The next are 42493218404 and 42494299680 (running).
   - Joint-tree runs enter in their creation order, with their warm-up value.
   - If values are still missing after the 10 joint runs, they come from the next runs on any tree with 36. Empty-commit runs of the integration tip are allowed; more joint-tree runs are not.
   - METRICS marks each value "with 30" or "without 30" and prints n, mean, sd and max per subset. These subsets are the attribution Round 25 condition 7 asked for, laid before condition 5's round.
6. **Merge order and decoupling.**
   - a. **Both pass** (conditions 3 and 4, and the ceiling round re-confirms):
     - one pre-merge run of the final joint tree. If the tip moved, the branch is re-merged onto it, and this run confirms and does not decide. If the tree is unchanged, a full-CI 10th run serves.
     - It must be GREEN under the normal rules, with S5/short GREEN on both legs and no entry (Round 24 Q1 condition 7). A disagreement comes back.
     - Then **merge ticket/30, then ticket/74, back to back, in one push**. The post-merge run judges the tip that carries both.
   - b. **30 passes and 74 does not** (post-bound > 5 on either leg, the ceiling round changes the ceiling, or 74's own tests fail):
     - **30 merges alone** after one pre-merge run of its own tree (the tip plus ticket/30, entries labelled 74, band in force). That run confirms and does not decide: windows band, linux listed on growth only, every other S5 check GREEN.
     - 74 comes back under its fallback.
   - c. **74's mutant proof fails before staging:** 74 comes back. 30 takes the 10 runs on its own staging tree (full CI runs, empty commits), under condition 4, and then follows 6b.
   - d. **30 fails:** neither merges (74 ← 30), and everything comes back with all values.
   - Never: 74 before or without 30; 30 merged on fewer than 10 runs; a rerun after a failed value.
   - **Revert:** reverting 30 always reverts 74 first, because 74's window needs the bound. 74 may be reverted alone.
7. **Records.**
   - RUNLOG records this round's departures (above), correction 6 and the pre-registration of condition 2.
   - METRICS gains the joint-run table and condition 5's subset columns.
   - Round 25's pending ticket and METRICS changes are applied before this round's.

**Rationale:** The cycle is not a dependency cycle. 74 needs 30's bound, and 30 needs evidence that its restage cannot give: one more single run passes at P ≈ 0.91 even if 30 shifted the windows mean by 3 %/1k. And 34.62 is not ordinary: z = 4.2 against the other 84 runs, trend true, on the only 36-tree run that carries 30. So excusing it is not backed by evidence, and waiting for one more coin flip is not evidence either.

The joint staging is right because 74's warm-up check *is* the old quantity at the old bound. Ten joint runs therefore give 30 a stricter test (power 0.62 against a +3 shift) and give 74 its exit in one evidence set. Round 25's set, filled in creation order from any branch, puts 36-tree runs without 30 beside them.

The recommendation was wrong on three points:
- It claimed 30 goes unjudged, when 30 is judged ten times.
- It redrew a pre-registered set after seeing its values.
- It made a finished C1 fix depend on 74's two open risks.

The run count is fixed at the minimum, because every extra joint run adds by-chance fallback risk (3.6–31.6 % at 10 runs, 7.1–53.1 % at 20). The ceiling stays pre-registered against the runs it judges.

**Charter:** C1 (the retention fix lands only on evidence that it does not raise bridge growth; the 30 bound holds for the code that can move it), C7 (windows judged on 10 runs plus a comparison subset; linux gets the 55 ceiling), C9 (stronger measured evidence: 10 runs instead of 1, with recomputed tails; smaller blast radius: 30 is not tied to 74's own failure modes, and the revert order is fixed), §9 (no budget, ceiling or band loosened; one tightening), Round 8 conditions 2 and 4, Round 13 Q1 conditions 1 and 6, Round 17 Q2 condition 3, Round 24 Q1 conditions 1, 3, 5, 7 and 8, Round 25 Q1 conditions 2, 4, 5 and 7, PROMPT §7 Phase 4 (no rerun-until-green; no merge on an unattributed RED).

**REVERSIBILITY:** Two-way door: a staging order, a run count, ticket text and records. ADR: no.

### Exact text changes

**`issues/30-mcp-task-retention-and-idempotency-window.md`.** Replace the Acceptance bullet that begins `- [ ] Loop S5/short: no new RED on either leg` with:

```
- [ ] Loop S5/short (Round 26 Q1; replaces Round 24 Q1 condition 1's single restage): judged on the 10 pre-registered evidence runs per leg of the joint staging tree (integration tip, then 30, then 74) on `warm-up-growth:mcp-bridge` (today's quantity: load window cut at task 400, default 25 % warm-up): every windows value 5 < v ≤ 30 %/1k commit, every linux value ≤ 55 %/1k, every other S5 check GREEN in every run (procPeak ≤ 150 MB, WS on windows; reboot cost ≤ 20 MB; 0 task failures; 0 orphans); and Round 25 Q1 condition 4's 20-value set complete with no trigger. Signature (vi) never applies. If 74 is not staged (its mutant proof failed), the 10 runs are taken on this ticket's own staging tree on the band value (the same quantity). A value above 30 or any other S5 RED comes back with all values; nothing is rerun. Both S5/short entries stay re-owned to ticket 74, which holds their only exit (Round 24 Q1).
```

Add under `## Comments` (after Round 25's line):

```
- 2026-11-08 (orchestrator, Owner Proxy round 26, binding): 30 and 74 are staged together on one branch (integration tip, then ticket/30, then ticket/74, which is built on ticket/30). Restaged run 42483637377 (34.62 %/1k commit, trend true; z = 4.2 against the other 84 windows runs) is neither excused nor dropped: it stays value 3 of Round 25's 20-value set and in this ticket's "with 30" subset in METRICS. This ticket's S5/short verdict comes from the same 10 evidence runs per leg as 74's exit, read from warm-up-growth:mcp-bridge (Acceptance). Merge: 30 then 74 back to back in one push if both pass; 30 alone, after one confirming pre-merge run of its own tree, if only 30 passes; neither if 30 fails. Reverting 30 always reverts 74 first.
```

**`issues/74-s5-short-growth-after-retention-bound.md`.**
- Insert after the `- [ ] Mutant proof` bullet:

```
- [ ] Joint staging with 30 (Round 26 Q1): this ticket is built on ticket/30 and staged on one branch with it (integration tip, then 30, then 74). Before the first evidence run, RUNLOG records the joint tree's hash and the count, 10 per leg; every run on that tree counts, and none is added, dropped or replaced once it has an S5/short value (a run with no S5/short value, i.e. an infrastructure failure before S5, is replaced and recorded). Each run also records `warm-up-growth:mcp-bridge` (commit and WS on windows), its slope MB/1k, mean MB and window medians; these values are ticket 30's verdict and enter Round 25 Q1 condition 4's set in run-creation order. The exit is judged against the windows ceiling in force when the runs ran (30). If the Round 25 Q1 condition 5 round raises the ceiling, the exit is judged again on 10 fresh runs per leg after that round; if it lowers it, the same runs are re-judged against the lower value.
```

- In the `- [ ] Exit:` bullet, replace `≥ 10 fresh runs per leg on this tree via an off-by-default S5-only measurement mode (several CI runs or parallel jobs allowed)` with `the 10 joint-tree runs per leg (Round 26 Q1), via the off-by-default S5-only measurement mode or full CI runs of that identical tree (several CI runs or parallel jobs allowed)`. The rest of the bullet is unchanged.
- Add under `## Comments` (after Round 25's line):

```
- 2026-11-08 (orchestrator, Owner Proxy round 26, binding): staged jointly with 30 (Acceptance). Round 25 Q1 condition 5 stands: no merge before the 20-value windows table and the ceiling re-confirmation round. Round 25's set is unchanged and is not filled from this tree alone. Its first five values are 42454650683 15.43, 42469209389 18.14, 42483637377 34.62 (30's tree), 42483787372 19.82 and 42484868282 24.83. Joint-tree runs enter in creation order with their warm-up-growth value. If values are still missing after the 10 joint runs, they come from the next runs on any tree with 36: empty-commit runs of the integration tip are allowed, more joint-tree runs are not. METRICS marks each value "with 30" or "without 30" and prints n, mean, sd and max per subset. Merge order: 30 then 74, back to back in one push, after one pre-merge run of the final joint tree that is GREEN, with S5/short GREEN on both legs and no entry; never 74 without 30.
```

**`issues/INDEX.md`:** no change. No edge, status, model or risk changes. Row 74 keeps `30`, row 57 keeps `30, 36, 74`, row 56 keeps `13, 30, 31, 36, 57, 74`, and row 55 keeps `74`.

**Issues 55, 56 and 57:** no change.

---

## Shared understanding

Open branches I still see:
1. **The windows post-bound value is still EVIDENCE MISSING (Round 24).** The joint runs decide it. If it misses, condition 6b lets 30 merge alone.
2. **The attribution of 34.62 is still EVIDENCE MISSING.** It is decided by condition 4's pre-registered rule and laid out in condition 5's subsets before Round 25 condition 5's ceiling round.
3. **By-chance fallback.** An innocent tree fails 10 runs at the 30 bound in 3.6–31.6 % of attempts (Round 25's tail). If that happens, the question comes back with at least 10 joint values and the subset table. Any ceiling change belongs to the condition 5 round, never to the implementer.
4. **The values of the in-progress runs 42493218404 and 42494299680** (both on 36-trees without 30) are EVIDENCE MISSING. They are values 6 and 7 of Round 25's set.
5. **Round 25's ticket-text and METRICS changes are not yet applied** at c457fd8 (correction 6).
6. **The mutant's trend margin** (Round 24 Shared understanding 2) stays open until 74's local proof.
7. **Not decided here:** INDEX.md's "Initial frontier" lists 57 as `needs-triage`, while its table row says `ready-for-agent`.


# Round 27 (2026-11-08) — ticket 16 changes what S3 counts as a failed launch

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–26 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md`, `rounds/round-27.md`.
- DECISIONS Round 1 Q4 (the budget's origin: "0 failed launches with a killed holder"), Round 8 Q1, Round 14 Q1, Round 15 Q1–Q2, Round 16 Q1–Q2 and Round 22 Q1 in full.
- Integration tree f21d3ac: `spec.md` §18. The killed-holder budget is the first **PROCESSES** bullet ("Exactly 1 proxy … with 0 failed launches, including a killed holder"). No S3 MEMORY row names `failed-launches`. Also METRICS.md lines 61, 230–231 and 379–421.
- Ticket 16's branch at 4dbee25 (`/home/AgentKit/wt/t16`): the issue file in full; `git diff origin/overhaul/stability-terminal-ux...HEAD -- tests/memory`; `tests/memory/scenarios/s3-concurrency.mjs` (the kill-holder adversary, `round()`, the checks at lines 412–427); `s4-lifecycle.mjs:117–160`; `lib/isolated-kit.mjs:152–184` (`run()` returns `child.pid`, and `preflight()` spawns `node cli/heal.mjs` directly); `cli/heal.mjs:117` (the preflight imports the lifecycle in-process, so the lock holder's pid **is** the launch's pid); `lib/completeness.mjs`; `docs/adr/0003-…:17`; `lib/budgets.mjs:88`.
- Every `summary.json` under `/home/AgentKit/overhaul-tools/t16-memloop/` (tip1–3, branch1–10). I recounted every S3 round.
- Every archived S3 kill-holder line in `/home/AgentKit/overhaul-tools/ci-art/t67-logs/logs/` (62 linux and 43 windows runs), and `parsed.json`.
- `gh run list --branch staging/16`: run 42507303528 (head 6a7b249) is `in_progress`. No result is known yet.

**Recomputed facts and corrections to the round.**
1. **Confirmed: the old counting could never reach budget 0.** Ticket 16's own fix, before `launchOutcomes` (branch1–3), still had `failed-launches` = 1 in 6 of 6 S3 runs. In each run the single failure was the kill-holder round's victim (`preflight#k code=null starting zcode-proxy ...`), and nothing else failed. With the new counting (branch4–10), every kill-holder round has exactly one `killedByAdversary` entry and 0 `failedLaunches`, in 14 of 14 S3 runs. The tip figures match the round: S3/short 3/8/3 → 2/7/2, S3/hung 11/12/11 → 10/11/10.
2. **The archive agrees: every kill-holder round has a victim.** All 124 linux and 86 windows archived kill-holder rounds show ≥ 1 failed launch. None shows 0.
3. **Correction: "the tip stays RED, so the check keeps its power" holds on linux and for S3/hung. It does not fully hold for windows S3/short.** I re-derived the archive under the new counting: the kill-holder count minus the victim, plus the other rounds.
   - **S3/hung:** RED in 62 of 62 linux and 43 of 43 windows runs. Its hung rounds fail anyway.
   - **Linux S3/short:** RED in 61 of 62.
   - **Windows S3/short:** RED in only 34 of 43. In 9 of 43 runs (21 %), and in 4 of the latest 20, the victim was the only failure. Those runs would have been GREEN on pre-16 code.
   - So, on windows S3/short, one GREEN pre-merge run proves ticket 16's fix only weakly (P ≈ 0.2 by chance). Condition 4 addresses this. The local tip runs (3 of 3 RED) are linux only.
4. **The new counting fails closed, except in one case.** Two missing values make it stricter, never looser:
   - a missing `r.pid`;
   - a missing or `null` `adversary.killed`.
   
   In both cases there is no victim, so every non-zero launch counts. That is the Round 8 Q1 condition 1 concern, and here it is answered. The one case that loosens: `launchOutcomes` takes **every** launch whose pid equals the victim's. If a pid is reused within one round (Windows reuses pids quickly), a real failure would be hidden. The round's condition (2) is not implemented on 4dbee25. `completeness.mjs` has no check on `killedByAdversary`, and the new test does not cover these cases.
5. **Where the rule lives.** It belongs in spec §18's PROCESSES bullet, not in an "S3 row". ADR-0003 condition 5 states the same budget. `budgets.mjs:88` holds the value and a comment, and `budgets.mjs` is in METRICS' matching rule. Condition 1 leaves it untouched.

---

## Q1 — may ticket 16 report the kill-holder adversary's own victim apart from `failed-launches`?

**DECISION:** ACCEPTED with conditions. Both changes are measurement corrections, not loosenings:
- the victim is reported as `killedByAdversary`;
- S4 records `staleLockLeft` instead of crashing on `unlinkSync`.

Ticket 16 may remove `failed-launches` and `stale-lock-after-round` from `S3/short` and `S3/hung` on both legs. On windows, the removal needs condition 4's evidence.

**REJECTED in part:**
- **(i) The evidence claim.** "The tip stays RED under the new counting, so the check keeps its power" is unproven for windows S3/short (correction 3). Condition 4 replaces it.
- **(ii) Condition (3)'s "until ticket 17 owns S4's lock checks".** No decision gives 17 a check on the lock left after a respawn, and no budget covers that state. §18 covers "after a race round or after Ctrl-C". So `staleLockLeft` is recorded only. Making it a judged check is a separate question with its own evidence (condition 5).
- **(iii) Condition (2) is widened (condition 2).** A kill-holder round counts as run only when exactly one launch is the matched victim. Every other adversary state is a harness failure, not just "a kill but no match".

**No earlier decision is contradicted.**
- Round 1 Q4 condition 4 and ADR-0003 condition 5 ("0 failed launches with a killed holder") get their only reachable reading. Their baseline was "7–8 of 10 launches failing", which counts the launches that failed **because of** the killed holder.
- Round 15 Q1 condition 5 is applied as written. 16 removes only its own names, with the owner's loop runs plus the pre-merge CI run GREEN on that check on that leg.
- Round 14 Q1 condition 4: no other owner's name is touched.
- Round 22 Q1: 17's `orphans` names are unaffected.
- Round 16 Q2 condition 1's restart rule applies (condition 6).

Binding conditions:
1. **The rule, stated where the budget is (C8, measurement-rule amendment).** These texts go in ticket 16's change:
   - **Spec §18 PROCESSES, first bullet.** Append: "Measurement-rule amendment (Round 27 Q1): in the kill-holder round, the launch the adversary SIGKILLed (its pid equals the adversary's recorded `killed` pid, and it exited non-zero) is reported as `killedByAdversary` and is never a failed launch. Every other launch that does not exit 0 is a failed launch. A round counts as run only with exactly one such launch. Budget 0 is unchanged."
   - **METRICS.md:**
     - the same sentence;
     - correction 3's power figures (S3/hung 62/62 and 43/43, linux S3/short 61/62, windows S3/short 34/43 RED under the new counting on archived code);
     - a note that every `failed-launches` value recorded before 16, including the §6 baseline "7/10 failed (killed holder)", includes the victim. History is not rewritten.
   - **ADR-0003 condition 5:** the same one-sentence clarification, inside 16's existing amendment.
   - **`budgets.mjs`: no change.** The value is unchanged, and the file is in the matching rule.
2. **Fail-closed evidence gate (RED first, in 16's change).** In `lib/completeness.mjs` (or wherever the run-evidence gate lives), the `kill-holder-10` round counts as run only if `adversary.killed` is an integer and exactly one launch of that round has that pid and a non-zero exit. Each of these states is a harness failure that names the round and prints the adversary record, and it is never GREEN:
   - no kill (`killed: null`);
   - a kill whose pid matches no launch;
   - a matched launch that exited 0;
   - two or more launches with the victim's pid.
   
   Tests: one case for each of those four states, plus today's good case. `launchOutcomes` stays a pure helper, and its existing cases stay. The archive shows a victim in all 210 kill-holder rounds (correction 2), so this gate should not fire at random. If it does fire in CI, it comes back with the run ids and the adversary records: no rerun-until-green (Round 6 Q2 condition 3, Round 8 condition 4).
3. **Visibility.** `notes.rounds[].killedByAdversary` and `adversary` stay in `summary.json`. Ticket 16's Comments record them for the pre-merge run, as the implementer's report already plans. The field is additive, and no user-facing output changes (C2, C3).
4. **Removal evidence, per leg (Round 15 Q1 condition 5, made specific).**
   - **Linux:** the 7 branch loop runs, plus pre-merge run 42507303528's ubuntu leg GREEN on both names in `S3/short` and `S3/hung`.
   - **Windows:** run 42507303528's windows memory leg must be GREEN on both names in `S3/short` **and** `S3/hung`. Each of the two kill-holder rounds must show one `killedByAdversary` entry and 0 `failedLaunches`. In the same run, the windows `test-kit` legs must pass `tests/start-lock.test.mjs`, in particular:
     - the kill at every protocol step;
     - "a waiter on a live holder that dies mid-start takes over and starts one proxy" (the deterministic form of this check);
     - the spawn-window kills.
     
     The two rounds are two samples of the same round, P ≈ 0.16–0.21 each on pre-16 code. Together with the seam tests, they replace the single-run claim of correction 3. This adds no new floor.
   - **If any of this fails,** the names do not leave the list on that leg. The numbers come back, and 16 does not merge (the pre-merge run confirms, it does not decide).
   - **After the merge,** a RED on either name, on either leg, is an unowned RED: a question with run ids, never a re-add (Round 15 Q1 condition 5).
5. **S4 `staleLockLeft` (recorded, not judged).** The harness change is accepted. Ticket 16's designed takeover removes the planted dead-holder lock (pid 2147483646), and the old unconditional `unlinkSync` then turned correct kit behaviour into an ENOENT harness failure.
   - The judged `respawn-recovers-despite-stale-lock` check is unchanged.
   - `staleLockLeft` stays in `notes.respawnWithStaleLock` only, and METRICS records its value on 16's tree.
   - A future judged check on it is a new check name. It comes back as its own question with its distribution and a proposed owner, and it is not presumed to be 17's.
6. **Matching-count restart (Round 16 Q2 condition 1, Round 15 Q2 condition 2).** 16 changes `s3-concurrency.mjs`, `s4-lifecycle.mjs` and the lifecycle path. So, under METRICS' matching rule, the matching runs restart on 16's tree for at least `S3/short`, `S3/hung`, `S3/omp` and `S4/short` on both legs, and METRICS records the scope.
   - 16's remaining `flips` names (`exactly-one-proxy-after-round`; `start-over-stale-lock`) need their ≥ 10 GREEN matching CI runs per leg on that tree, as the implementer's report says.
   - 17's S4 and S3 floors also count on that tree or a later one.
7. **Nothing else changes:** budget values, check names, `budgets.mjs`, repetition counts, bounds, other owners' names and marks, and the `flips` lists (§9).

**Rationale:** The adversary's victim is a launch the scenario itself SIGKILLs. It ends with `code=null` under any kit. Ticket 16's own fix showed this: with every other launch healthy, the victim alone kept `failed-launches` at 1 in 6 of 6 runs. A budget no kit can meet measures nothing. The budget's origin explains what it was meant to count. Round 1 Q4 took it from memory-report §6, where the killed holder made 7–8 of 10 **other** launches fail. Counting the victim separately, matched by pid within its round, is that reading.

The change fails closed. A missing pid or kill record makes the count stricter. Pid reuse is the one way it could hide a failure, and condition 2 closes it. Condition 2 also turns "the round never killed anyone" into a harness failure, so a GREEN always means the killed-holder case was really exercised. That is Round 8 Q1 condition 1's lesson: a missing observation must never read as GREEN.

The orchestrator's power argument rested on three linux tip runs. The archive shows that on windows S3/short, about 1 run in 5 fails only on the victim. A lone windows GREEN would therefore prove little. Condition 4 pairs the two kill-holder rounds with the deterministic seam tests already in 16, and the unowned-RED guard catches any later miss.

The S4 edit only stops the harness from crashing on correct kit behaviour. Judging a new state would be a new check, and no budget names that state, so it is recorded and comes back separately.

**Charter:** C1 (exactly one proxy and 0 failed launches with a killed holder, now measurable; fail-closed evidence; the lock checks become unowned guards), C7 (windows judged on its own power figures and seam tests; linux unchanged), C9 (stronger measured evidence: 210 archived kill-holder rounds and 26 local runs recounted; smaller blast radius: one helper, one gate, notes-only S4; simpler than a new budget), C2 (additive `summary.json` fields; no user-facing change), C8 (spec, METRICS and ADR state the rule), §9 (budget 0 unchanged, never loosened), Round 1 Q4 condition 4, Round 6 Q2 condition 3, Round 8 Q1 conditions 1 and 4, Round 14 Q1 condition 4, Round 15 Q1 condition 5, Round 15 Q2 conditions 1–2, Round 16 Q2 condition 1, Round 22 Q1 (17's names untouched), PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door: test-harness code, an evidence gate, list names and record text. ADR: no. ADR-0003 condition 5 gets a clarifying sentence inside ticket 16's existing amendment, not a new decision.

### Ticket-text changes (exact)

**`issues/16-start-lock-protocol-v1-proven-takeover.md`**
- Acceptance, new line after the "Loop: S3 killed-holder round …" line:
  `- [ ] Measurement (Round 27 Q1): S3 reports the kill-holder adversary's victim (pid = adversary.killed, non-zero exit) as killedByAdversary, never as a failed launch; the evidence gate makes kill-holder-10 a harness failure unless exactly one launch matches (tests for no kill, no match, a matched launch that exited 0, and two matches), RED first. Spec §18 PROCESSES, METRICS.md and ADR-0003 condition 5 state the rule; budgets.mjs is unchanged. Windows removal of failed-launches and stale-lock-after-round needs the pre-merge windows memory leg GREEN on both names in S3/short and S3/hung, one killedByAdversary and 0 failedLaunches in both kill-holder rounds, and tests/start-lock.test.mjs green on the windows test-kit legs of the same run.`
- Comments gains:
  `- 2026-11-08 (orchestrator, Owner Proxy round 27 Q1): the victim-apart counting and the S4 staleLockLeft record are accepted as measurement corrections (budget 0 unchanged). Under the new counting, archived pre-16 runs stay RED on failed-launches in S3/hung 62/62 linux and 43/43 windows, and in linux S3/short 61/62, but in windows S3/short only 34/43 (the victim alone in 9), so the windows removal also rests on the seam tests (Acceptance). staleLockLeft is recorded only; a judged check on it is a separate question. 16's tree restarts the matching count for S3/short, S3/hung, S3/omp and S4/short on both legs.`

**`spec.md` §18, METRICS.md, ADR-0003:** as in condition 1.

**`issues/17-…`, INDEX.md:** no change.

---

## Shared understanding

CONFIRMED for this question. Open branches I still see (none blocks 16 once condition 4 is met):
- **Pre-merge run 42507303528 is in progress.** It confirms and does not decide. A RED on either removed name, a condition 2 harness failure, or a windows seam-test failure comes back with the numbers.
- **A lock left after a respawn (S4 `staleLockLeft`)** has no budget and no owner. If the orchestrator wants it judged, it comes back as its own question with its distribution on 16's tree.
- **The windows suspended proxy** left by a holder killed inside `spawn()` remains 17's (16's report, "Left for other tickets"). On windows, a kill-holder round that hits it could show a spawning second proxy, which is 16's `exactly-one-proxy-after-round`, and an `orphans` RED, which is 17's. The existing owners and Round 22 Q1 condition 4's attribution watch cover both.


# Round 28 (2026-11-08) — windows S1/short RED only on commit in 1 of ticket 20's 10 evidence runs

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–27 decisions bind these answers (Rounds 1–26 in DECISIONS.md, Round 27 in `rounds/round-27-answers.md`). Where an answer departs from one of them, it names the decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md`, `rounds/round-28.md`.
- DECISIONS Round 6 Q1–Q2, Round 7 Q1 and Q3, Round 8 Q1, Round 9 Q1, Round 15 Q1 condition 5, Round 16 Q2 condition 1, Round 17 in full (Q3, cross-question condition 2 and its Shared understanding), Round 18 (ticket 20's S1 names), Round 25 Q1 (signature (vi)).
- `issues/20-*.md` on the integration tree and on `ticket/20-fewer-body-copies` (c737856, implementer report and expected-RED table), `issues/71-*.md`, METRICS.md lines 463–471 (the 49/51-run windows table), RUNLOG to 18:33Z.
- `git log origin/staging/20`: the 10 evidence commits 1b4a706 … 17f1d36 all carry tree f1cdaff. The measurement commit b98a54b (tree 7b0de62) is that tree plus the marker. `git diff 5922e59 origin/staging/20` touches `zcode-proxy-src/src/proxy/{handler,client-session,session-context,responses-handler,body-transformer}.ts` and `src/async/handler.ts`, so 20 is on S1/short's executed code. `git diff 5922e59 f21d3ac` touches only `tests/proxy-lifecycle.test.mjs` and `.scratch/` docs.
- Every log in `ci-art/t20-ev/` (10 windows, 10 ubuntu) and `ci-art/s1short-win/` (30 runs), with the 29-character prefix stripped. I re-extracted every S1/short value and recomputed every statistic. `ci-art/t20-measure/win/measure-S1-burst1.md`.

**Recomputed facts and corrections to the round.**
1. **Every number in the round checks out.** 20's tree: n = 50, mean 4.064, sd 1.03, min 1.79, max 6.22, 10 of 50 above 5 (all with trend true). RED repetitions per run: 1, 1, 1, 1, 0, 0, 1, 0, **3**, 2. The six non-20 trees since 71: n = 30, mean 3.911, sd 0.93, max 5.34, 4 of 30. RED repetitions per run: 2, 1, 1, 0, 0, 0. Welch t = 0.68 (df 66). Fisher's exact test on the counts above 5 (10/50 against 4/30) gives p = 0.55. Pooled: 14 of 80, p = 0.175 (95 % Clopper–Pearson 0.099–0.276), so P(≥ 3 of 5) = 4.05 % per run (0.83–13.3 %). That is 9.6× the 0.42 % design figure. Run 42503284096: [5.27, 4.5, 5.12, 6.04, 4.92], all trends true. WS per repetition: −1.02, 1.01, 0.08, −0.02, 0.77. Linux S1/short is GREEN in all 10 (2.14–4.28). The ubuntu ratchet holds in all 10.
2. **One RED run in ten is the expected outcome, not a surprise.** At 4.05 % per run, P(≥ 1 RED run in 10) = 34 %. At 20's own p = 0.20 (5.79 % per run), it is 45 %.
3. **Correction: the "drift" does not show up in single runs. It shows up in repetitions 2–5.** This bears on part (2)'s attribution question.
   - The 23 valid single-run windows S1/short values in `s1short-win/` (04:28–13:25Z today, before the 5-repetition rule ran in CI) have mean 3.47, sd 0.87 and max 5.18. That matches the 49-run 3.41. Some of those runs are on trees with 19, 25 and 36 (for example 42483637377 and 42484868282). 42467078897 has no S1/short line (HTTP 504).
   - Mean by repetition position over all 16 post-71 runs: 3.53, 4.16, 3.64, 4.53, 4.17.
   - Repetition 1 against repetitions 2–5: 3.53 (sd 1.10, n = 16) against 4.12 (sd 0.93, n = 64), Welch t ≈ 2.0.
   - On 20's tree alone, repetition 1 averages 3.44.
   - **This is suggestive, not proven.** The pattern does not rise steadily, and the count above 5 is flat across positions (3, 3, 2, 3, 3). Still, "which merged ticket moved the mean" is not the only hypothesis the data allow. The other: the five back-to-back repetitions on one runner are not independent draws from the single-run distribution. Round 17 Q3's n = 5 computation assumed they were.
4. **No n ≤ 9 restores the ≤ 1 % design bar at the measured rate.** At p = 0.175, n = 5/k = 3 gives 4.05 %, n = 7/k = 4 gives 2.09 %, and n = 9/k = 5 gives 1.11 %. The repetition count therefore cannot be fixed cheaply. Raising it would also rest on the independence assumption that correction 3 questions.
5. **The rest of ticket 20's evidence matches the round.**
   - Windows S1/burst4, S1/burst16 and S1/bigbody are GREEN in 10 of 10 runs, and so is linux S1/burst32.
   - In 9 of 10 runs, the windows ratchet's only failures are "GREEN but listed" for burst4 and bigbody. That is the removal evidence itself. Run 42503284096 adds S1/short.
   - Burst1 measurement 42502424683: 24 of 24 runs valid (`ws_peak_kb` > 0, units self-test ok, Job Object applied, 1 proxy). WS gate 110.5 / 116.8 / 131.7 MB, none above 250. The in-job burst1 medians are around 113 MB.
   - **Not on this host:** the linux leg of 42502424683 (the marker runs the measurement on both legs). 20's linux burst1 criterion currently rests on its 20 local runs (max 128.6, none above 250).
6. **One baseline run has an unrelated defect.** 42500996594 (staging/21) is in the non-20 baseline and had an orphan in repetition 2: ticket 77, the kill guard. Its growth values are valid, and the conclusions do not change without it.

---

## Q1 — does windows S1/short in run 42503284096 count against ticket 20, and what happens to the tail?

**DECISION:** ACCEPTED with conditions. Part (1) is accepted with merge conditions. Part (2) is accepted except for the attribution framing, which is REJECTED in part. Part (3) is accepted except for its eligibility wording, which is REJECTED in part.

**(1) The run does not count against ticket 20.** Ticket 20 removes its own entries in one list-only commit on its branch, then merges after one GREEN pre-merge run of the final tree. The entries:
- windows `S1/burst1` (`unstable`);
- windows `S1/burst4`, `S1/burst16`, `S1/bigbody`;
- linux `S1/burst32`.

**(2) No change to the budget, n, k or the ceiling.** A new `needs-triage` ticket (the next free number, 78 at the time of writing) records the windows S1/short values and comes back with them. Its question is wider than the round's (REJECTED in part, see below).

**(3) Interim signature (vii)**, with exact eligibility paths instead of "the proxy's request path" (REJECTED in part, see below). No signature applies to 20's own pre-merge run.

This departs from and confirms the following, explicitly:
- **Round 17 Q3 condition 2** set n = 5 for a predicted false-RED rate ≤ 1 %. The measured rate is now about 4 % (correction 1). I keep n = 5 knowingly above that bar until the triage ticket answers. No n ≤ 9 meets the bar (correction 4), and the independence premise behind any n is in doubt (correction 3).
- **Signature (vii)** departs from PROMPT §7 Phase 4's revert rule, Round 6 Q2 condition 4's last bullet and Round 13 Q1 condition 6, for (vii) only. That is the same departure Round 17 cross-question condition 2 made for (i)–(v) and Round 25 Q1 made for (vi). It also reopens an interim for this key. The interim for signature (ii) ended when 71 merged (RUNLOG 15:07Z). (vii) is new and narrower: a median bound, a WS clause, and wider ineligibility.
- **Confirmed, not contradicted:**
  - Round 17 Q3 condition 4 and 20's Comments line ("If this ticket moves the windows commit mean toward 5 %/1k … the numbers come back"). This round is that return, and the numbers show 20 did not move it.
  - Round 8 Q1 condition 4 and Round 9 Q1 condition 7 ("the pre-merge run confirms, it does not decide"): nothing was rerun. The RED came back and is decided here on its distribution.

Binding conditions:

1. **Why the run is not charged to 20, and what that does not license.**
   - On S1/short, 20's tree cannot be told apart from the non-20 trees since 71: per repetition t = 0.68, Fisher p = 0.55, repetition 1 3.44 against 3.69.
   - A 1-in-10 RED run is what the pooled rate predicts 34–45 % of the time (correction 2).
   - WS growth is about 0 in every repetition, and linux S1/short is GREEN 10 of 10.
   - This comparison can rule out a shift of roughly 0.6 %/1k or more. It cannot rule out a smaller one. A smaller shift is the triage ticket's to measure (condition 4), not a ground to block 20.
   - The decision covers run 42503284096 only. It is no standing exception for ticket 20.

2. **The list-only commit (Round 15 Q1 condition 5, Round 9 Q1 condition 4).** It is one 20-owned commit that edits only `tests/memory/expected-red.json` and cites the run ids for each removal:
   - **windows `S1/burst1` (`unstable`):** measurement 42502424683, 24 of 24 valid, max 131.7 MB. This is the entry's only exit (Round 9 Q1 condition 4). 20's "Delete `S1/burst1` (windows)" criterion is met by this commit. Removing the `unstable` allow-list from the schema stays ticket 55's job (Round 9 Q1 condition 5).
   - **windows `S1/burst4`, `S1/bigbody`** (names RED in every earlier matching run): 42502565823 … 42503373851, GREEN on the WS gate in 10 of 10.
   - **windows `S1/burst16` and linux `S1/burst32`** (`flips`): the same 10 runs, GREEN in 10 of 10. That meets the ≥ 10-run floor.
   - Each removal deletes its entry, because each is the entry's last name.
   - Before the commit, the orchestrator replays the 10 runs' RED sets through the edited list. Every windows and ubuntu leg must pass, except the S1/short line of 42503284096, which this round decides. Any other failure in the replay comes back with the run id.

3. **The final tree and its pre-merge run.**
   - `staging/20` is rebuilt on the current integration tip (f21d3ac or later), so that the test-kit legs carry cbe2abb's teardown fix.
   - Since 5922e59, the tip changed only `tests/proxy-lifecycle.test.mjs` and `.scratch/` docs. Neither is in METRICS' matching rule, and neither is the list commit (Round 16 Q2 condition 1). So the 10-run floors stand.
   - If the tip has meanwhile merged anything on S1's executed code, the floors restart on the new tree and it comes back: `zcode-proxy-src/**`, `tests/memory/scenarios/s1-proxy-steady.mjs`, `tests/memory/lib/**`, `tests/memory/job.mjs`, the Bun pin or the job's Node version.
   - The one pre-merge CI run must be GREEN on every leg: both `memory-budget` legs with the new list, and all four `test-kit` legs.
   - It confirms and does not decide. If windows S1/short is RED in it, that is a second RED run on 20's tree. It comes back with the five values, and nothing is rerun. No signature applies, because 20 touches `zcode-proxy-src/**`.
   - Ticket 20's evidence cites the linux leg of 42502424683 for its linux burst1 criterion. If that leg is missing, the 20 local runs stand as written, and METRICS labels them local. If any linux repetition there is above 250 MB, it comes back (Round 6 Q1 condition 4).
   - The orchestrator writes the further ADR-0004 amendment from 20's measured factors before the merge (Round 18 Q3 condition 5; this is not decided here).

4. **The triage ticket (REJECTED in part: its question).** Title: "windows S1/short commit growth: repetition-position and tree effects".
   - Metadata: `Status: needs-triage`. It owns no name and lists nothing; Round 17 Q3 rejected a listing of this key, and that rejection stands.
   - **What it records:** in its Comments or a METRICS table, for every windows S1/short run from now on: run id, tree, position 1–5, commit value, trend, WS value. It also back-fills the 16 runs here and the 23 single runs of correction 3.
   - **What it asks:**
     - (a) Do repetitions 2–5 differ from repetition 1 and from the single-run history (correction 3)? That would mean the five repetitions are not independent draws.
     - (b) Does any merged tree shift the mean? Compare position by position.
     - (c) Which rule then holds a false-RED rate ≤ 1 % without loosening the 5 %/1k budget, the trend clause or the 10 %/1k ceiling? Examples: isolate each repetition better, or judge another statistic.
   - It may use an off-by-default measurement mode on a staging branch, as the burst1 mode does, with no new endpoint (C6).
   - **When it comes back:**
     - when 20 more windows runs exist (100 more repetitions);
     - earlier if two (vii) occurrences fall within any 10 consecutive windows runs;
     - earlier if any windows S1/short RED falls outside (vii).
   - Until it is answered: no change to n, k, the budget, `growth()` or Round 7 Q1's commit gate.

5. **Signature (vii), interim (REJECTED in part: eligibility).** A staged or post-merge run qualifies when all of these hold:
   - Its only unexcused failure is windows `S1/short` RED on `growth:proxy` (≥ 3 of 5 repetitions RED).
   - Every repetition is ≤ 10 %/1k on commit.
   - The median is ≤ 5.5 %/1k.
   - WS growth is ≤ 5 %/1k in every repetition.
   - Every other S1/short check is GREEN in every repetition.

   Such a run does not count against the ticket, does not block its merge and causes no revert. Each occurrence goes into the triage ticket's Comments with the run id and the five values.

   **Ineligible**, by exact path rather than "the proxy's request path", because "request path" cannot be checked from a diff:
   - a diff that touches `zcode-proxy-src/**`;
   - `tests/memory/scenarios/s1-proxy-steady.mjs`, `tests/memory/lib/**` or `tests/memory/job.mjs`;
   - the Bun pin or the memory job's Node version.

   That is Round 17 signature (ii)'s list, widened by `lib/repetitions.mjs` (71) and `lib/process-identity.mjs` (72), and Round 25's Node clause.

   **Why the 5.5 bound costs little.** A normal fit to the pooled values (mean 4.0, sd 1.0):
   - about 9 % of noise REDs have a median above 5.5, so those few come back;
   - a +1 %/1k shift would push the median above 5.5 in about 17.5 % of runs.

   **When it ends:** when the Owner Proxy answers the triage ticket. A ticket that is ineligible and RED on S1/short comes back with its per-repetition distribution, as 20's did here.

6. **Records.**
   - RUNLOG names this round, the deviations above and the end of (ii) at 15:07Z.
   - METRICS gains the 16-run, 80-repetition table: per tree, per position, and the 23 single runs.
   - Ticket 20's Comments: "Round 28 Q1: windows S1/short RED in 42503284096 is not charged to 20 (distribution indistinguishable from the non-20 trees). Entries removed in the list-only commit. No signature for 20's pre-merge run."
   - Ticket 71's Comments: one line saying its S1/short n = 5 premise (≤ 1 %) is now measured at about 4 %, and that the triage ticket owns the question.

**Rationale:** Not charging the RED to 20 rests on measured evidence. 20 is the one ticket in the queue that could plausibly change proxy commit growth, and it did not move the per-repetition distribution measurably. One RED run in ten is the likeliest outcome at the pooled rate. Blocking 20 on it would be the random merge block that Rounds 9, 13 and 15 refused. It would also hold back the largest memory win of the run: burst1 WS median about 300 → 117 MB, and four budgets met on both legs.

The entry removals meet each entry's own exit exactly as earlier rounds wrote them. So there is nothing to decide beyond citing runs and replaying the list.

Leaving n alone is not complacency. No n ≤ 9 reaches 1 % at p = 0.175. Repetitions 2–5 run higher than repetition 1 and the single-run history (t ≈ 2), so the independence that any n assumes is itself in question. Re-tuning n now would repeat Round 17's assumption on weaker ground. A triage ticket that records positions and trees is the measured way to settle it.

The original framing ("which merged ticket moved the mean") could miss the measurement's own contribution, so I widen the question. A drift that WS, linux and single runs do not show is not yet evidence of a C1 regression. The commit gate, the trend clause and the 10 %/1k ceiling all stay in force.

(vii) gives non-proxy tickets the protection they need against a roughly 4 % tail they cannot cause. Its exact-path ineligibility keeps every ticket that could cause a real regression outside it. Its median and WS clauses make it narrower than (ii).

**Charter:** C1 (proxy growth stays gated at 5 %/1k with trend and the 10 %/1k ceiling; nothing is masked for code that can move it), C7 (windows evidence decides; linux unchanged), C9 (stronger measured evidence: 80 repetitions plus 23 single runs, recomputed; smaller blast radius: one list-only commit, one recording ticket, one narrow interim; "do nothing" to n until it is measured), C6 (no new endpoint for the measurement mode), §9 (no budget, n, k or ceiling loosened; (vii) is tighter than (ii)), Round 6 Q1 conditions 4 and 6, Round 6 Q2 conditions 1 and 4, Round 7 Q1, Round 8 Q1 condition 4, Round 9 Q1 conditions 4, 5 and 7, Round 13 Q1 condition 6, Round 15 Q1 condition 5, Round 16 Q2 condition 1, Round 17 Q3 conditions 2 and 4 and cross-question condition 2, Round 18 Q3 condition 5, Round 25 Q1, PROMPT §7 Phase 4.

**REVERSIBILITY:** Two-way door (list entries, ticket text, a merge-gate interim and a recording ticket; the merge itself is revertible under Phase 4). ADR: no.

---

## Shared understanding

Open branches I still see (none blocks ticket 20 once condition 3's run is GREEN):
- **Cause of the higher repetition values** (correction 3): the repetition sequence on one runner, or a tree shift too small for 50 against 30 repetitions to resolve. The triage ticket (condition 4) settles it. Until then the windows job carries about 4 % false-RED per run on this key (95 % range 0.8–13 %). It is the largest known term in the job's aggregate rate.
- **Proxy-touching tickets have no signature for this tail.** Examples are 21, 76 and 77, and any later `zcode-proxy-src/**` ticket. Each one that meets an S1/short RED comes back with its distribution, as 20 did. If that happens often before the triage ticket answers, the answer is due early.
- **EVIDENCE MISSING: the linux leg of measurement run 42502424683** is not on this host. Condition 3 says how 20's linux burst1 criterion stands either way.
- **Ticket 77's kill-guard orphan** (about 1 in 3,500 proxies, seen in S1/short repetition 2 of 42500996594) is a separate RED class, not covered by (vii). With 5 repetitions per run it now gets five chances per windows run.


# Round 29 (2026-11-08): ticket 74's mutant proof failed, so what happens to 30 and S5/short?

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–28 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-29.md`.
- DECISIONS Rounds 24, 25 and 26 in full, and Round 28's signature (vii) (ineligibility by exact path, the ~4 % per-run tail).
- On the integration tree (aed28ee): issues 30, 55, 56, 57 and 74, `INDEX.md` rows 30/55/56/57/74, METRICS lines 325–351 (Round 25's set), the RUNLOG tail to 20:03Z, and `spec.md:645`.
- Ticket 74's branch (`/home/AgentKit/wt/t74`, head eab4ddf on 2c6720c): the issue file's Comments, and METRICS lines 429–436. From 30's branch I read `git diff --stat` and the full diff of `job.mjs`, `lib/ratchet.mjs` and `expected-red.json` (merge base with 7555b87 to 2c6720c), plus the mutation list in 30's issue at 2c6720c.
- Raw data `/home/AgentKit/overhaul-tools/t74-memloop/{mut,tree}-{1,2,3}`: `samples.csv`, `job-summary.md`, `run.log` and the `bridge-data/tasks` listings. I re-implemented `growth()` independently from `verdict.mjs:70-106` (MB = 1024, linear slope on progress/1000, six window medians, a trailing rising run at 1 %, net rise) and ran it on the bridge role's samples.
- Windows S5/short lines in the local CI logs written after Round 25 (`ci-art/t20-ev/*-windows.log`, `ci-art/t16-r1/win-memory-job.log`).

**Recomputed facts and corrections to the round.**

1. **Confirmed: the six-run table.**
   - My recompute over tasks 600–1,199 matches each value within one sample: M1 7.76 / 16.96 / 8.98, tree 2.84 / 5.74 / 5.61 %/1k.
   - The medians are identical. Rising windows are 2 / 2 / 0 on M1 and 0 / 0 / 0 on the tree. Net rise is 5.4 / 7.7 / 3.9 % on M1 and 1.9 / 2.2 / 3.0 % on the tree.
   - So the trend flag cannot fire in any of the six runs. Under the pre-registered rule, M1 is GREEN 3 of 3, and the tree is ≤ 5 in only 1 of 3.
   - **Both halves of Round 24 Q1 condition 5 fail.** So 74's own exit criterion ("≤ 5 whatever the trend flag says") would also fail on the tree.
2. **"Absolute slope (MB/1k)" is not a different quantity.**
   - `growthPctPer1k` is slope ÷ mean × 100, and the means are 95.8–103.7 MB. So MB/1k and %/1k rank the six runs identically: tree max 5.56 MB/1k = 5.75 %/1k, M1 min 7.96 MB/1k = 7.77 %/1k.
   - Either one separates the arms only with a value threshold between about 5.8 and 7.7 %/1k without the trend flag. That is a different rule from §9's "5 %/1k AND trend", and it is not obviously a tightening. Three runs per arm with a gap of 2.4 MB/1k is no basis for one.
3. **"A longer post-bound window" is not supported by this data either.**
   - Over tasks 900–1,199, M1 gives 3.79 / 16.79 / **−15.03** %/1k and the tree gives 0.43 / −0.91 / 2.57.
   - M1's RSS signal comes in steps, not as a steady slope. Two of three mutant runs are flat or falling in the second half.
   - A longer window may still help, but that is a hypothesis to measure, not the place the evidence points.
4. **Confirmed, with a note: "3,600 task files against 1,500".**
   - Each M1 `run.log` prints "data 5.9 MB in 3600 files" at the reboot measurement.
   - All six `bridge-data/tasks` directories now hold 1,500 files (500 tasks × 3), mutants included. So the reboot path's restore still applies the bound, and M1 removes only the in-run check.
   - Consequence: `bridge:reboot-cost-of-history` (3–4 MB on M1) cannot see M1 either. Record only.
5. **M1 is already caught deterministically in CI.** 30's mutation set kills M1 and M1b ("the count bound removed (check or victims)") through `test/integration/retention.test.mjs`, which runs in `npm run test:mcp` (`ci.yml:48`). The bound has a guard whatever 74's later answer is. This matters for item 3 (condition 8).
6. **Under the current edges, "56/57 unblock as their own blockers allow" is false.**
   - 57's Blocked-by line names 30, 36 and **74**, and 56's names 13, 30, 31, 36, 57 and **74** (Round 24 Q1 edges; INDEX rows 56 and 57).
   - With 74 reopened as `needs-triage`, both would wait for an unscheduled round and a re-implementation.
7. **Round 25's 20-value set is not tabulated.**
   - METRICS lists values 1–5 only.
   - The local logs alone hold 11 further windows values on trees with 36: staging/20's ten evidence runs 42502565823–42503373851 (17.4, 23.77, 17.5, 19.92, 25.39, 23.17, 23.34, 18.41, 19.84, 22.2) and t16-r1's 18.93. Earlier 36-tree runs (42493218404, 42494299680, 42495987510, 42500996594, 42506095577, …) come before them in creation order and are not in hand.
   - **EVIDENCE MISSING: values 6–20 in run-creation order.** The set is very likely complete already, before 30's runs. Round 26 Q1 condition 4 requires it complete and trigger-free for 30's verdict.
   - Record only: the 15 known values without 30 have mean 20.54, sd 3.04, max 25.39, with none above 30.
8. **30 is ineligible for signature (vii), Round 28.**
   - 30's diff touches `tests/memory/lib/ratchet.mjs` (a comment) and `tests/memory/job.mjs` (one label string). Both are label-only, which I checked in the diff. They are still inside (vii)'s exact-path ineligibility.
   - At Round 28's ~4 % per windows run, the chance of at least one windows S1/short RED is 33.5 % over 10 full-CI runs and 36.2 % over 11. Signature (vi) never applies to 30 either (Round 25 Q1 condition 2).
9. **`spec.md:645` on the integration tree states Round 24's amendment as in force** ("S5/short runs 1,200 tasks …"). It also still says "owned by ticket 30" in the Round 13 text. Both are now wrong.

---

## Q1 — 74 failed its own proof. Does 30 merge, and what replaces 74's rule?

**DECISION:** REJECTED in part.

Accepted:
- **Item 1 in full.** 74 does not stage or merge. Its pre-registered rule (1,200 tasks, window 600–1,200, the `warm-up-growth` ceilings of 55 linux / 30 windows) is **withdrawn as failed** under Round 24 Q1 condition 8. Nothing is changed to fit. The branch (eab4ddf) is kept unmerged for reuse; its commits 8c5a947 and d6a17a0 delete both S5/short entries and `UNSTABLE`, and must never merge in part.
- **The core of item 2.** This is Round 26 Q1 condition 6c exactly: 30 takes exactly 10 full-CI runs per leg on its own staging tree under condition 4, then follows 6b.
- **The core of item 3.** 74 becomes `needs-triage` with one question for a later round. It measures ≥ 5 runs per arm per leg before any rule is pre-registered. The S5/short entries (owned by 74) and signature (vi) stay as they are.

Rejected or corrected:
- (i) **"If the verdict holds, 30 merges"** leaves out 6b's confirming pre-merge run (condition 3).
- (ii) **"56/57 unblock as their own blockers allow"** (correction 6). The edges 57 ← 74 and 56 ← 74 are removed, under a one-rule condition. 55 ← 74 stays (condition 6).
- (iii) **The pointers "absolute slope (MB/1k)" and "a longer post-bound window"** are not backed by the data (corrections 2 and 3). They do not go into 74's ticket. The question stays open, and that includes the answer "no S5/short quantity separates" (correction 5; condition 8).
- (iv) **"Windows via an off-by-default staging measurement mode"** for the mutant arm. A mutant on a CI runner needs a pushed mutant commit, and Round 24 Q1 condition 5 says "never committed". Nothing here authorises that. How a windows mutant arm is produced is part of 74's question (condition 8).
- (v) **Round 25's set must be tabulated** before 30's verdict can be read (correction 7; condition 4).
- (vi) **The linux ≤ 55 part of 30's verdict is applied by the orchestrator from the recorded value.** The ratchet cannot apply it: on 30's tree linux S5/short is listed under `flips` and passes any value (condition 2).

**This explicitly departs from:**
- **Round 24 Q1 "Edges"**: the edges 57 ← 74 and 56 ← 74 are removed. The reasons Round 24 gave, the shared `s5-mcp.mjs` and one S5 rule for 56's base comparison, are kept by condition 6 instead of by a block on a ticket with no rule and no schedule.
- **Round 24 Q1 conditions 3, 7 and 10, and Round 26 Q1 conditions 1–3 and 6a** for 74: they lapse with the withdrawn rule.
- **Round 25 Q1 condition 5's ceiling round** is moot until a re-decided rule has a warm-up ceiling. Round 25's set and triggers stay in force: they are part of 30's verdict and of the band's come-back rule.

It is consistent with Round 24 Q1 condition 8 (the Fallback), Round 26 Q1 conditions 2, 4, 5, 6b and 6c, Round 25 Q1 conditions 1–4, Round 28's (vii) eligibility, and Round 6 Q2 condition 1 (74 stays an open owner).

**I loosen no bound.** These are all unchanged:
- the 5 %/1k budget, `MEMORY.growth`, `growth()` and the trend rule;
- S5/short at 400 tasks with today's quantity;
- the windows band (5 < v ≤ 30 commit);
- (vi) with its hard 35;
- (vii);
- the S5 budgets (150 MB, 20 MB, 0).

Binding conditions:

1. **74 withdrawn.**
   - 74 does not stage, and no part of eab4ddf merges.
   - Its job-seam work (progress windows, the window bounds in `summary.json`, `completeness.mjs`, the fixture tests, the 1,199 fix) stays on `ticket/74-s5-short-post-bound` for reuse. Reuse needs a re-decided rule.
   - The ubuntu timeout stays at 75. S5/short stays at 400 tasks.
2. **30's staging (Round 26 Q1 condition 6c, pre-registered).**
   - Tree: the integration tip at staging time, then `ticket/30` (2c6720c or its successor; no 74 commit). Before the first run, RUNLOG records the tree hash and "10 per leg".
   - Exactly 10 full-CI runs per leg of that one tree (empty commits). Every run with an S5/short value counts. A run with no S5/short value (an infrastructure failure before S5) is replaced, and the replacement is recorded.
   - Each run records the windows commit and WS values, trend, slope MB/1k, mean MB and window medians; the linux RSS value with the same fields; and procPeak, reboot cost, task failures, orphans and duration.
   - 30's verdict is Round 26 Q1 condition 4, unchanged:
     - every windows value satisfies 5 < v ≤ 30 commit (≤ 5 comes back as an ownership question);
     - every linux value is ≤ 55 %/1k, judged by the orchestrator from the printed value;
     - every other S5 check is GREEN in every run;
     - Round 25's set is complete with no trigger;
     - (vi) and (vii) never apply.
   - Any value above 30, a linux value above 55, or any other S5 RED sends 30 back with all values, and nothing is rerun.
3. **Merge (Round 26 Q1 condition 6b).**
   - If the verdict holds and the tip has not moved since the tree was built, the 10th windows/linux run serves as the confirming pre-merge run. This is 6a's provision applied to 6b, so no identical 11th run adds risk without information. It serves only if every job of that CI run is GREEN under the normal rules.
   - If the tip moved, 30 is re-merged onto it and one confirming pre-merge run decides nothing new: band in force, linux listed on growth only, every other S5 check GREEN.
   - Then 30 merges alone.
   - Revert: 30 may be reverted on its own. No 74 code exists on the tip.
4. **Round 25's set (correction 7).**
   - Before 30's verdict is read, METRICS fills values 6–20 in run-creation order from the windows `memory-budget` job logs of every 36-tree run, any branch. It prints n, mean, sd and max with the "with 30 / without 30" subsets (Round 26 Q1 condition 5).
   - 30's runs enter only if slots remain. Either way, 30's 10 runs are printed beside the set as the "with 30" comparison that Round 25 Q1 condition 7 asked for.
   - A trigger comes back under Round 25 Q1 condition 4.
5. **Failures outside S5 in 30's runs** follow the normal rules and do not remove S5 values (Round 26 Q1 condition 2).
   - A windows S1/short RED is not covered by (vii) (correction 8). It comes back under Round 28 with its per-repetition distribution.
   - That round will have the fact that 30's two memory-lib edits are label text only. This round does not pre-judge it.
6. **Edges (departure above).**
   - Remove 57 ← 74 and 56 ← 74. Keep 55 ← 74, because 74 owns the two entries and 55 needs an empty list.
   - Edges 57 ← 30 and 56 ← 30 stay, so 56 and 57 still wait for 30's merge.
   - Condition carried into 56 and 57: their S5 values and base are measured under one S5/short rule. If a re-decided 74 rule merges while either is in flight, that ticket re-measures its base under the new rule. The later of two `s5-mcp.mjs` changes rebases (Round 24's no-edge-to-71 precedent).
   - Removing edges cannot create a cycle.
7. **Records.**
   - 74's METRICS section ("S5/short after the retention bound", t74 METRICS lines 425–436) is copied to the integration METRICS and labelled "withdrawn rule (Round 29)", with corrections 2–4.
   - RUNLOG records this round's departures, the pre-registration of condition 2, and that 74 does not merge.
   - `spec.md:645` is amended (text below).
8. **74's question (for a later round; no implementer chooses it).**
   - Is there an S5/short quantity that separates a working retention bound from M1 on both legs? It must be measured on ≥ 5 runs per arm per leg, with the arms on one tree, before any rule is pre-registered.
   - Any candidate must be checked against §9 (5 %/1k AND trend) as a tightening, never a loosening.
   - If none separates: how do the two entries end? Options include accepting 30's deterministic `retention.test.mjs` kill of M1 as the bound's guard (C9 "do nothing" for a memory statistic), and what 55's empty-list criterion then does with them.
   - How a windows mutant arm runs without committing the mutant (Round 24 Q1 condition 5).
   - Whether linux S5/short gets a value ceiling. Round 17's open branch reopens when the 55 ceiling is withdrawn; between them, 30's 10 runs give the next linux distribution on the merged tree.

**Rationale:** The proof did what it was pre-registered to do. It showed that the 600–1,200 window with the trend rule cannot see M1: net rise 3.9–7.7 % against 10 %, rising run ≤ 2 against 3. It also showed that the bounded tree sits on the 5 %/1k budget in 2 of 3 runs. So the rule fails both as a detector and as an exit, and the Fallback applies with no part merged. 30 is a finished C1 fix: S5/long 238.6 → 111.4 MB peak, and M1 is killed deterministically in `test:mcp`. Round 26 Q1 condition 6c already decided that 30 must not hang on 74's own failure modes, so 30 takes the 10 pre-registered runs on its own tree, judged on the same quantity and at the same 30 bound it has always faced.

The recommendation was right on that core. It was wrong on four facts:
- 56/57 are still blocked by edges to 74.
- Its two pointers for 74 point where the data does not: MB/1k is %/1k rescaled, and the second half of the window is flat or falling on two mutant runs.
- A windows mutant arm in CI needs a committed mutant.
- 30's verdict depends on a Round 25 set that nobody has tabulated.

The edge change is the smaller blast radius: a ticket with no rule, no schedule and an open question should not block the SDK migration (C5) and the restart budget (C1). The reasons for the edges (one rule, one file) are kept by condition 6.

**Charter:** C1 (the retention bound lands on 10 runs per leg; M1 stays guarded deterministically; no bound is loosened), C2 (no list, flag or output change; the S5/short entries keep their labels), C5 (56 is not held behind an unscheduled ticket), C7 (windows judged on 10 runs at the 30 band beside a complete 20-value set; linux values judged ≤ 55), C9 (stronger measured evidence: six raw runs recomputed, plus a second-half split; smaller blast radius: 74 withdrawn whole, 30 alone, edges replaced by a one-rule condition; "do nothing" stays a valid answer for 74), §9 (5 %/1k, 150 MB, 20 MB, 0 unchanged), Round 6 Q2 condition 1, Round 24 Q1 conditions 5 and 8, Round 25 Q1 conditions 2, 4 and 7, Round 26 Q1 conditions 2, 4, 5, 6b and 6c, Round 28 (vii), PROMPT §7 Phase 4 (no rerun-until-green; no spurious blocks).

**REVERSIBILITY:** Two-way door: a withdrawn rule that was never merged, a staging order, two removed edges, ticket text and records. 30's merge is itself revertible. ADR: no.

### Exact text changes

**`issues/74-s5-short-growth-after-retention-bound.md`.**
- `**Status:** ready-for-agent` becomes `**Status:** needs-triage`. Blocked by 30 stays. The file name stays, because the ratchet requires `issues/74-*.md`.
- Replace the title and the `**What to build:**` paragraph with:

```
# 74: S5/short: which measurement separates a working retention bound from its mutant (needs triage)

**What to build:** Round 24's rule (1,200 tasks, growth:mcp-bridge over tasks 600–1,200 with the trend rule, warm-up-growth ceilings 55 linux / 30 windows) failed its pre-registered mutant proof and is withdrawn (Round 29 Q1): ticket 30's M1 was GREEN in 3 of 3 runs (7.77 / 17.01 / 9.03 %/1k, trend false), the bounded tree ≤ 5 in 1 of 3 (2.85 / 5.75 / 5.62). Open question for an Owner Proxy round: which S5/short quantity, if any, separates a working retention bound from M1 on both legs, measured on ≥ 5 runs per arm per leg on one tree before any rule is pre-registered and checked against §9 as a tightening; if none, how the two S5/short entries end (30's retention.test.mjs already kills M1 in test:mcp), and what ticket 55's empty list does with them; how a windows mutant arm runs without committing the mutant. This ticket keeps owning both S5/short entries; signature (vi) ends only when a rule of this ticket merges.
```

- Keep the existing Acceptance list and mark it with one line above it: `Acceptance below is Round 24's withdrawn rule (Round 29 Q1); a later round replaces it.`
- Add under `## Comments`:

```
- 2026-11-08 (orchestrator, Owner Proxy round 29, binding): mutant proof failed on both arms (implementer comment above; values recomputed from /home/AgentKit/overhaul-tools/t74-memloop). The rule is withdrawn under the Fallback; nothing merges, branch eab4ddf kept unmerged for reuse. Recompute: MB/1k equals %/1k × mean/100 here (means 95.8–103.7 MB), so it is not a separate quantity; over tasks 900–1,199 M1 reads 3.79 / 16.79 / −15.03 and the tree 0.43 / −0.91 / 2.57. M1 removes only the in-run bound (3,600 files at reboot, 1,500 after restore), so reboot cost cannot see it. Edges 57 ← 74 and 56 ← 74 removed (one-rule condition in 56 and 57); 55 ← 74 stays.
```

**`issues/30-mcp-task-retention-and-idempotency-window.md`**, add under `## Comments`:

```
- 2026-11-08 (orchestrator, Owner Proxy round 29, binding): 74's mutant proof failed, so Round 26 Q1 condition 6c applies: this ticket takes exactly 10 full-CI runs per leg on its own staging tree (integration tip, then ticket/30; tree hash in RUNLOG before the first run), judged under the Acceptance's S5/short bullet on the band value (windows 5 < v ≤ 30 commit; linux ≤ 55 judged from the printed value; every other S5 check GREEN; Round 25's set tabulated, complete and trigger-free; signatures (vi) and (vii) never apply). Then one confirming pre-merge run (the 10th run serves if the tip has not moved and every job is GREEN), and 30 merges alone. A value above 30 or 55, or any other S5 RED, comes back with all values; nothing is rerun.
```

**`issues/56-mcp-sdk-2-migration.md` and `issues/57-mcp-runtime-restart-budget.md`.**
- Remove `74 (S5/short: judge MCP bridge growth after the retention bound)` from the `**Blocked by:**` lines.
- Add under Comments: `- 2026-11-08 (Owner Proxy round 29): edge to 74 removed; this ticket's S5 values and their base are measured under one S5/short rule; if a re-decided ticket-74 rule merges while this ticket is in flight, its base is re-measured under that rule.`

**`issues/INDEX.md`.**
- Row 74: title `S5/short: which measurement separates a working retention bound from its mutant (needs triage)`; Blocked-by stays `30`; status `needs-triage`.
- Row 56's cell becomes `13, 30, 31, 36, 57`. Row 57's becomes `30, 36`. Row 55 is unchanged.

**`spec.md:645`**, append: `Round 29 Q1: Round 24's S5/short amendment is withdrawn (its mutant proof failed); S5/short stays at 400 tasks with the Round 13 quantity and band; both S5/short entries are owned by ticket 74 (needs-triage), not ticket 30.`

**METRICS.** Values 6–20 of Round 25's set, with subsets (condition 4). 74's withdrawn-rule section and corrections 2–4 (condition 7). 30's 10-run table.

---

## Shared understanding

Open branches I still see:
1. **Round 25's set, values 6–20: EVIDENCE MISSING.** They must be tabulated in creation order before 30's verdict (condition 4).
2. **By-chance failure of 30's runs.**
   - S5 band: Round 26's 3.6–31.6 % per 10 runs; the 15 newer known values without 30 (max 25.39) point to the low end.
   - Windows S1/short: about 34–36 % over 10–11 runs, since 30 is ineligible for (vii). That RED comes back under Round 28.
3. **The attribution of 34.62** is decided by 30's 10 runs, laid beside the set.
4. **74's question** (condition 8): a separating quantity, or none (30's deterministic test as the guard). Also how the entries and 55's empty list end, and how a windows mutant arm runs without a committed mutant. The windows post-bound value is still EVIDENCE MISSING.
5. **Linux S5/short has no value ceiling** again after 30 merges (Round 17's branch reopens), and signature (vi) has no end date until a 74 rule merges. Both are bounded meanwhile by Round 25's triggers and the hard 35.


# Round 30 (2026-11-09): ticket 30's round-4 set passed; one linux S1/stalled RED in it

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–29 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-30.md`.
- DECISIONS Rounds 25, 26, 28 and 29 in full. I also read Round 13 Q1 condition 6 for the "restage on a changed tree" precedent.
- The integration worktree at 7f0c368: RUNLOG lines 210–224 (both pre-registrations, the b46596a verdict, the round-4 diagnosis), METRICS lines 602–632 (Round 25's set), STATE.md.
- Ticket 30's issue file at 540752f (`git -C /home/AgentKit/wt/t30 show HEAD:…`): the Round 29 verdict comment and the implementer's round-4 entries (root cause, fix d8b34db, mutations M1–M17, the addendum).
- Git (read-only): `git diff --stat e84971f c6ead53`, the full diff of `job.mjs`, `lib/ratchet.mjs` and `expected-red.json` on 30's branch, `git diff --stat f56c46d e84971f` (failed-tree base against new-tree base), `git diff e84971f HEAD` (tip since the build), `git diff HEAD...origin/staging/16c`, and the PR merge base of every run.
- Raw job logs `ci-art/t30s/<run>-{windows,ubuntu}.log` and `ci-art/t30r/` (29-character prefix stripped). I re-extracted every S5/short check line on all 40 legs and did not use `values.txt`.
- Every archived log under `ci-art/` that contains a linux S1/stalled loop. I deduplicated by the loop id (`S1-short-stalled-<time>-<hex>`) and took the platform from the summary path (`/home/runner/…` against `D:\a\…`).
- `gh run view --json jobs` for the 10 t30s runs. I streamed the ubuntu `memory-budget` job logs of 11 recent runs not archived (42513423687 … 42543302875) through `grep` and saved nothing.

**Recomputed facts and corrections to the round.**

1. **Confirmed: the S5/short verdict on tree e5b2c50.**
   - Windows `growth:mcp-bridge` on commit: 17.1, 16.67, 26.04, 18.17, 21.16, 23.53, 19.72, 20.43, 26.59, 20.0. That is n 10, mean 20.94, sd 3.46, min 16.67, max 26.59. Trend is false in 10 of 10, and the windows S5 loop is GREEN outright in all 10.
   - Linux: 42.52, 44.14, 45.09, 42.81, 38.86, 34.85, 37.78, 40.39, 39.42, 37.67. That is mean 40.35, sd 3.24, all ≤ 55 (listed under 74, as expected).
   - Every other S5 check is GREEN on all 20 legs:
     - procPeak: windows WS 59.1–60.3 MB, linux 91.5–93.9 MB;
     - reboot cost 0–2 MB;
     - 0 task failures and 0 orphans.
   - Round 25's set (METRICS 606–632) is complete: n 20, mean 21.13, max 34.62, 1 value above 30, none above 35. No trigger fires.
2. **The measured tree is e5b2c50 plus one docs line, and it was fixed before any value existed.**
   - Every run checks out "Merge <staging/30s head> into 8d243c2". 8d243c2 is e84971f plus one RUNLOG line (the pre-registration itself), so it is the same shape as staging/30r (merged into 6875cd3).
   - All ten heads carry tree e5b2c50.
   - 8d243c2 was committed at 00:52:51Z. The first run was created at 00:52:59Z.
3. **The fix is the only S5-relevant difference between the failed tree and the new one.** Between the failed tree's base f56c46d and e84971f, nothing changed under `mcp/`, `lib/mcp-bridge.mjs`, `tests/memory/`, `.github/`, `package.json` or `zcode-proxy-src/`. The only changes were `lib/proxy-lifecycle.mjs` (77), `scripts/fixture-ports.mjs` and kit tests (75).
   - Windows mean, old tree against new: 27.33 against 20.94, Welch t 3.48. Trend true: 6 of 10 against 0 of 10.
   - New tree against Round 25's without-30 subset (20.42, n 19): t 0.41.
   - **This closes Round 25 Q1 condition 7's EVIDENCE MISSING.** The 34.62 of 42483637377 and the b46596a set came from 30's per-request retention scan before the fix. They did not come from 36's base or from the tail.
4. **How the new set came about (process).**
   - Round 29 Q1 condition 2 says a failed value "sends 30 back with all values, and nothing is rerun". The orchestrator read "back" as "back to its implementer". It then pre-registered a fresh set on a new tree as its own decision (RUNLOG 00:52Z), and no Owner Proxy round looked at it before the runs.
   - The failed tree was not rerun. The new tree changes S5-executed code at a diagnosed cause:
     - the new constant-lookup-work test is RED on the pre-fix dist and GREEN on the fix;
     - M17 (full scan per request) is killed;
     - minor GCs match the tip after the fix (321 against 319.7).
   - The verdict and the count are unchanged. This is Round 13 Q1 condition 6's shape, except that the cause was shown by the implementer and is confirmed here, not decided here beforehand.
5. **Only one job failed in the 10 runs: ubuntu `memory-budget` of 42542646289.** The other 79 jobs are GREEN. The 10th run 42543167527 is 8/8 GREEN, but it cannot serve as the pre-merge run, because the tip has moved: dfb9b43 (ticket 38) and 7f0c368 (Round 29 Q1 condition 3).
6. **What the tip changed since e84971f is off S5's path.**
   - Ticket 38 touches `cli/commands/doctor.mjs`, `lib/proxy-doctor.mjs`, `proxy/zcode-proxy-manager.mjs`, `pack/verify-payload.mjs`, `package.json` (only the `test` script list) and tests.
   - staging/16c (in flight) touches `tests/memory/lib/completeness.mjs`, the S3/S4 scenarios, the S3 entries of `expected-red.json`, `package.json` (test list) and tests.
   - None of this is on Round 25 Q1 condition 2's S5 list.
7. **Confirmed: the S1/stalled RED is the only failure in 42542646289.**
   - The values: `growth:proxy` 5.5 %/1k, trend true; `procPeak:proxy` 206 MB; `count:proxy` 1; `orphans` 0. The ratchet prints "S1/stalled: RED but not listed in expected-red.json (linux)".
   - **Correction: S1/stalled has no `steady` check.** Its four checks are `growth:proxy`, `procPeak:proxy`, `count:proxy` and `orphans`. Recommendation 2's clause "and steady GREEN" cannot be checked.
8. **Correction: 30's diff on `tests/memory/` is five files, not three.** They are `expected-red.json`, `job.mjs`, `lib/ratchet.mjs`, `loop.test.mjs` and `verdict.test.mjs`.
   - The last two are test files. The memory job does not run them.
   - The `job.mjs` change is one markdown label string ("ticket 30's ≥ 10 runs" → "ticket 74's"). The `ratchet.mjs` change is a comment. The `expected-red.json` change re-labels both S5/short owners to 74.
   - None of these can change a measured S1 value.
9. **Correction: the history is 135 distinct linux S1/stalled executions, not 197.** The archive holds 267 raw occurrences, with copies of the same loop in several directories. I deduplicated by loop id.
   - The 135: median 1.58 (confirmed), mean 1.41, sd 1.94, min −5.81, max 5.5. Seven are above 4.5 (5.5, 4.95, 4.88, 4.81, 4.81, 4.75, 4.56), and 5.5 is the only one above 5.
   - The 11 streamed runs (0.45, 4.5, 3.19, 1.62, 4.01, 0.97, 2.14, 2.05, 1.16, 1.64, 0.3) are all GREEN.
   - **Combined: 1 RED in 146, 0.68 % per run (95 % Clopper–Pearson 0.02–3.8 %).**
   - A normal fit predicts P(> 5) = 3.2 %, but only 1 of 135 values is above 5, so the upper tail is lighter than normal.
   - The round's conclusion ("max, first above 5") holds.
10. **Record only: the spread in the t30s burst.** Its ten S1/stalled values range from −5.81 to 5.5 (sd 3.43). The other 125 values have sd 1.79, and the means are 1.27 against 1.43.
    - The other trees that contain 77 (8 streamed, plus t73b) read sd 1.38. The staging/30r burst reads sd 1.44.
    - A spread on both sides with an unchanged mean is what measurement noise looks like, not a leak, which would raise the mean. It is local to one burst of 10 runs started within 7 minutes, not to the tree.

---

## Q1 — does ticket 30 merge, and what about the linux S1/stalled RED in run 42542646289?

**DECISION:** REJECTED in part.

Accepted:
- **Item 1.** 30 passes its pre-registered verdict on tree e5b2c50, and it merges after one confirming pre-merge run on the current tip (condition 2). I ratify the new-tree pre-registration explicitly here, under condition 1.
- **Item 2, first half.** The linux S1/stalled RED of 42542646289 is not charged to 30.
- **Item 2, the triage ticket.** It records values only and comes back on its triggers. I add one trigger and one question (condition 4).
- **Item 3.** A linux S1/stalled RED in 30's confirming run comes back with both values, and nothing is rerun.

Rejected:
- (i) **Interim signature (viii)** (condition 5). The measured rate does not support a standing exception: 1 RED in 146 runs, 0.68 % per run. That is below Round 17 Q3's 1 % design bar, against the 1.4–3.7 % that justified (vi) and the about 4 % that justified (vii).
  - Its 6 %/1k ceiling is the one observed value plus 0.5, with no distribution behind it.
  - Its "steady GREEN" clause names a check that S1/stalled does not have (correction 7).
  - Until ticket 79 answers, each linux S1/stalled RED comes back with its values, as 20's S1/short RED did in Round 28.
- (ii) **"Every other S1 failure in 197 values"** is corrected to 135 + 11 distinct runs (correction 9). No conclusion changes.

Consistency with earlier decisions:
- Consistent with Round 29 Q1 condition 2 ("nothing is rerun"). The failed tree b46596a was not rerun, and its 10 values stay on record.
- Consistent with Round 29 Q1 condition 3 (re-merge, one confirming run), Round 26 Q1 condition 2 (failures outside S5 do not remove S5 values) and Round 28 Q1 condition 1 (a RED that a diff cannot reach is decided on its distribution, for the one run only).
- Round 25 Q1 conditions 2 and 4 and signature (vi) are unchanged. So are Round 28's (vii) and ticket 78.
- It *clarifies* Round 29 Q1 condition 2. "Sends 30 back" means back to its implementer and to a new pre-registered set on a new tree. It never means a rerun. From now on, a fresh set after a failed verdict needs an Owner Proxy round before its first run (condition 1).

**I loosen no bound.** These are all unchanged:
- the 5 %/1k budget, the trend rule and `growth()`;
- the windows band (5 < v ≤ 30 commit) and the linux ≤ 55 judgement;
- the S5 budgets (150 MB, 20 MB, 0);
- S1's 250 MB procPeak and count/orphans budgets;
- (vi) with its hard 35, and (vii).

Binding conditions:

1. **The new set is ratified, once.**
   - staging/30s (tree e5b2c50, 42542570923 … 42543167527) is ticket 30's pre-registered set under Round 29 Q1 condition 2. It counts because:
     - it was registered before its first run;
     - it uses the same verdict and count as the failed set;
     - on S5-executed code, the tree differs from the failed one only by the fix for the diagnosed cause (correction 3).
   - b46596a's set stays on record as "failed, pre-fix" in METRICS and in 30's Comments.
   - If 30's confirming or post-merge run fails S5, it comes back to an Owner Proxy round with all values before any new set is registered. The orchestrator does not pre-register one itself.
2. **Merge (Round 29 Q1 condition 3).**
   - Re-merge `ticket/30` (540752f or its successor, with no change under `mcp/`) onto the current tip, then make one pre-merge CI run. It confirms and decides nothing new:
     - the windows band applies;
     - linux S5/short is listed on growth only (≤ 55 from the printed value);
     - every other S5 check is GREEN;
     - every other job is GREEN under the normal rules.
   - **Transfer rule.** The 10 runs carry over to the re-merged tree only if the tip since e84971f has merged nothing on Round 25 Q1 condition 2's S5 list:
     - `mcp/**`, `lib/mcp-bridge.mjs`, `tests/memory/scenarios/s5-mcp.mjs`;
     - `tests/memory/lib/{verdict,budgets,sampler*,win-*,ratchet}.mjs`;
     - the Bun pin, or the memory job's Node version.
   - Today that holds (correction 6). If the tip touches that list before the re-merge, 30 comes back.
   - A windows S1/short RED in that run comes back under Round 28 (30 is ineligible for (vii); Round 29 Q1 condition 5).
   - A linux S1/stalled RED comes back with both values (item 3): its value, 5.5, and this round's record. Nothing is rerun. No signature applies.
   - Then 30 merges alone. Revert: 30 may be reverted on its own.
3. **Run 42542646289 and ticket 30.**
   - The run's S5 values count, under Round 26 Q1 condition 2.
   - Its linux S1/stalled RED is not charged to 30:
     - 30's S1-reachable edits are one markdown label string and one comment (correction 8);
     - 5.5 lies inside a 146-run history with 1 RED;
     - every other S1/stalled check is GREEN.
   - This covers this run only. It is no standing exception for 30 or for this key.
4. **Ticket 79 (the next free number), `Status: needs-triage`: "linux S1/stalled growth:proxy: tail and burst spread".**
   - It owns no name and lists nothing.
   - **What it records:** for every linux S1/stalled run from now on, in its Comments or a METRICS table:
     - run id, tree, `growth:proxy` value, trend, `procPeak:proxy`;
     - the window medians from `summary.json` where the artefact exists;
     - how many CI runs were created in the 10 minutes before it.
   - It back-fills the 146 values above, with run ids.
   - **What it asks:**
     - (a) Is the upper tail stable, or did any merged tree shift it?
     - (b) Is the spread in the t30s burst runner contention (correction 10) or a tree effect?
     - (c) If a rule is needed, which one holds a false-RED rate ≤ 1 % without loosening the 5 %/1k budget or the trend rule?
   - **When it comes back:**
     - after 20 more linux runs;
     - earlier on a second RED within any 20 consecutive linux runs;
     - earlier on any value above 6 %/1k;
     - earlier on any linux S1/stalled RED in a ticket's own staged or pre-merge run.
   - Until then, there is no change to the budget, the trend rule, `growth()` or the list.
5. **No signature (rejected (viii)).**
   - Until ticket 79 is answered, a staged or pre-merge run whose only unexcused failure is linux S1/stalled RED comes back to an Owner Proxy round with its value, the diff's paths and the ticket 79 table. Nothing is rerun.
   - A post-merge run follows PROMPT §7 Phase 4 unchanged.
   - Departing from the default needs measured evidence of a rate above 1 %. Ticket 79 gathers it.
6. **Records.**
   - RUNLOG records:
     - this round;
     - the ratification and the rule of condition 1;
     - the correction of the history count (135 + 11 distinct, not 197);
     - that run 42542646289's S1/stalled RED is not charged to 30.
   - METRICS gains:
     - the staging/30s table (both legs, every S5 field, per run), printed beside the failed b46596a set and Round 25's set, with the Welch figures of correction 3;
     - the "with 30" subset split into pre-fix (42483637377 and b46596a, n 11) and fixed (e5b2c50, n 10).

**Rationale:** The pre-registered verdict holds on every clause, recomputed from the raw logs. Windows is 16.67–26.59, trend false in all 10, with a mean indistinguishable from the without-30 set (t 0.41). Linux is ≤ 45.09. Every other S5 check is GREEN on all 20 legs, and Round 25's set is complete with no trigger. The change from the failed tree is exactly the fix for a cause that was shown in three ways: the minor-GC excess, the late-window commit gap, and a lookup-work test that is RED before the fix. So the new set is evidence, not a second roll of the same dice, and I can ratify it. I close the door for later sets so that the orchestrator cannot pick its own retries. 30 is a finished C1 fix: S5/long peak 238.6 → 111.4 MB, and M1/M1b/M17 are killed in `test:mcp`. It should merge after the one confirming run Round 29 requires. The linux S1/stalled RED cannot come from 30's edits, which are a label and a comment, and 5.5 is the tail of a 146-run history. Charging it to 30 would be the random block that Rounds 9, 13, 15 and 28 refused. The standing signature fails C9's first test, though. At 0.68 % per run, the default rule rarely blocks anyone and no exception is needed. Its ceiling was fitted to the value it would excuse, and one of its clauses names a check that does not exist. So "do nothing" plus a recording ticket is the stronger-evidence, simpler and smaller-blast-radius answer.

**Charter:** C1 (the retention bound lands on 10 runs per leg plus a confirming run; no bound loosened; the proxy growth gate stays hard), C7 (windows decides the S5 verdict; linux judged ≤ 55; the linux tail recorded), C9 (stronger measured evidence: 40 legs and 146 linux S1/stalled values recomputed; simpler and smaller blast radius: no new signature, a recording ticket, one ratification with a closed door), §9 (5 %/1k, 30, 55, 150 MB, 20 MB and 0 unchanged), Round 13 Q1 condition 6, Round 17 Q3 condition 2 (≤ 1 % design bar), Round 25 Q1 conditions 2, 4 and 7, Round 26 Q1 conditions 2 and 4, Round 28 Q1 conditions 1 and 5, Round 29 Q1 conditions 2, 3 and 5, PROMPT §7 Phase 4 (no rerun-until-green; no merge on an unattributed RED).

**REVERSIBILITY:** Two-way door: a merge that is revertible on its own, a recording ticket, a process rule and records. ADR: no.

### Exact text changes

**`issues/30-mcp-task-retention-and-idempotency-window.md`**, add under `## Comments`:

```
- 2026-11-09 (orchestrator, Owner Proxy round 30, binding): the round-4 set on staging/30s (tree e5b2c50, 42542570923..42543167527, pre-registered at 00:52Z before the first run) is ratified as this ticket's Round 29 Q1 condition 2 set and PASSES: windows commit 17.1, 16.67, 26.04, 18.17, 21.16, 23.53, 19.72, 20.43, 26.59, 20.0 (mean 20.94, trend false 10/10; t 0.41 against the without-30 mean 20.42, t 3.48 against the failed b46596a set), linux 34.85-45.09 (all <= 55), every other S5 check GREEN on all 20 legs, Round 25's set complete with no trigger. The 34.62 of 42483637377 and the b46596a set are attributed to the pre-fix per-request retention scan (Round 25 Q1 condition 7 closed). Merge: re-merge onto the current tip and one confirming pre-merge run (band in force, linux listed on growth only, every other S5 check and every other job GREEN); the 10 runs transfer only if the tip since e84971f touched nothing on Round 25 Q1 condition 2's S5 list. Run 42542646289's linux S1/stalled RED (growth:proxy 5.5 %/1k, trend true; procPeak 206 MB, count 1, orphans 0) is not charged to this ticket (its S1-reachable edits are a label string in job.mjs and a comment in lib/ratchet.mjs); a linux S1/stalled or windows S1/short RED in the confirming run comes back with its values; nothing is rerun. A further failed S5 set comes back to an Owner Proxy round before any new set is pre-registered.
```

**New `issues/79-linux-s1-stalled-growth-tail.md`:**

```
# 79: linux S1/stalled growth:proxy: tail and burst spread (needs triage)

**Status:** needs-triage
**Blocked by:** none

**What to build:** nothing yet. Record every linux S1/stalled run from 2026-11-09 on (run id, tree, growth:proxy %/1k, trend, procPeak:proxy, window medians from summary.json where the artefact exists, number of CI runs created in the 10 minutes before it) and back-fill the 146 distinct values recomputed in Owner Proxy round 30 (135 archived under ci-art, deduplicated by loop id, plus 11 streamed; 1 RED: 42542646289, 5.5 %/1k, trend true). Questions for an Owner Proxy round: (a) is the upper tail stable or did a merged tree shift it; (b) is the wider spread of the staging/30s burst (sd 3.43 against 1.79, mean unchanged) runner contention or a tree effect; (c) if a rule is needed, which one holds a false-RED rate <= 1 % without loosening the 5 %/1k budget or the trend rule. This ticket owns no name and lists nothing; no signature applies meanwhile.

**Comes back:** after 20 more linux runs; earlier on a second RED within any 20 consecutive linux runs, on any value above 6 %/1k, or on any linux S1/stalled RED in a ticket's own staged or pre-merge run.
```

**`issues/INDEX.md`:** add row 79 (`linux S1/stalled growth:proxy: tail and burst spread`, blocked by none, `needs-triage`). No other edge or status changes.

**METRICS:** the staging/30s table and the pre-fix/fixed subsets (condition 6).

---

## Shared understanding

Open branches I still see:
1. **30's confirming run** can still fail by chance on keys 30 cannot reach. Windows S1/short is about 4 % per run (Round 28; 30 is ineligible for (vii)), and linux S1/stalled 0.7 % (up to 3.8 %). Either one comes back with values.
2. **Linux S1/stalled tail and the t30s burst spread** (ticket 79). Is it contention or a tree effect? Until it answers, each RED comes back to a round.
3. **74's question (Round 29 Q1 condition 8) is unchanged.** Signature (vi) has no end date until a 74 rule merges, and linux S5/short has no value ceiling once 30 merges (Round 17's branch).
4. **Record only: at the 500 bound, each new terminal task still costs one scan and sort** (30's implementer, "Left open"). S5/short does not reach the bound, and S5/long was GREEN with it.


# Round 31 (2026-11-09): a post-merge windows S2/short RED (cdn-cache:memory-growth 65 MB) and ticket 61's row values

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–30 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-31.md`.
- DECISIONS Round 12 Q3, Rounds 14 and 15 in full, Round 17 (Q1, Q3, cross-question condition 2), Round 20 Q1 with its Shared understanding, Round 22 Q1, Rounds 28, 29 and 30 in full. PROMPT §5 B1 and §7 Phase 4.
- Issues 29, 54 (Blocked-by line) and INDEX rows 29, 54, 55 and 61 on the integration tree. Ticket 61's file on `ticket/61-s1-stalled-windows` at ce6d627.
- Raw logs `ci-art/cdn29/<run>.log` (106 with a value; 42467078897 and 42502424683 have no S2 line). I re-extracted every `cdn-cache:memory-growth` value and the phase-D `rss` marks (WS) from the logs. My values match `vals.txt` run for run. For each run I took the tree from `runs.txt` and classified it by its contents (`git show <sha>:…`), not by the flag column. The checks were: `CDN_MEMORY_MAX_BYTES` in `captcha-cdn-cache.ts` (ticket 25), `captcha-cdn-disk.ts` present (ticket 29), and ancestry of each merged ticket's first code commit. I also read the runner image line of every log.
- `ci-art/int-984b-128954839021.log` (42553765178, windows): the S2 marks, the check table, the ratchet lines and the sampler line.
- Git (read-only): `git diff 5f754b8^1 5f754b8` (29's merge), `git diff --stat 3ed5896 984b45d` on the S2 path, `git diff --name-only` of the 16 (b811246), 38 (dfb9b43) and 61 (984b45d..ce6d627) merges. I computed the S2 body's static import closure at 984b45d: `s2-captcha-run.ts` → `captcha-solver.ts`, `captcha-cdn-cache.ts`, `captcha-cdn-disk.ts`, `captcha-token.ts`, `runtime/bounded-collection.ts`, plus the worker `captcha-solver-worker.ts` → `runtime/guest-error.ts`. I also read `s2-captcha.mjs:96-105` (the value is `footprintMB` at D-end minus D-start on windows) and `captcha-cdn-disk.ts` (`afterWrite`, `prune`).
- On 61's branch: `handler.ts` (`printHeader`, `printRow`, `observeStream`), `response-body.ts` (`countTokens`, `onEnd`), and a grep of README*, `docs/`, `zcode-proxy-src/README*`, `cli/`, `lib/` and `zcode-proxy-src/src/tui` for consumers of TTFB, Tok, tok/s and Total.

**Recomputed facts and corrections to the round.**

1. **The round's tree bins are wrong in two places. The conclusion survives the correction, but it gets weaker.**
   - The three `staging/25` runs (42455986931 58, 42461329252 57, 42465834202 59) are counted as "before 25". Their trees carry the 32 MiB cap. That is where "before 25: n 44, mean 145.2" comes from. The true pre-25 set is n 41, mean 151.6, sd 1.8, range 147–155.
   - The first `staging/29` run 42494299680 (61) is flagged `no29`, but its tree has `captcha-cdn-disk.ts` (round-1 version of 29).
   - Corrected values:
     - with 25, without 29: n 26, mean 52.88, sd 6.00, max 62;
     - with 25 and 29: n 39, mean 56.44, sd 5.26, max 65.
   - The difference is +3.55 MB: Welch t 2.45 (df 49), Mann–Whitney z 2.66.
2. **The values are bimodal on both trees, so a single normal fit is the wrong model.** Splitting at 54 MB:

   | tree | low mode | high mode | share high |
   |---|---|---|---|
   | 25 only (n 26) | 14 runs, mean 47.6, sd 1.4 | 12 runs, mean 59.1, sd 1.3 | 46 % |
   | 25 + 29 (n 39) | 13 runs, mean 49.8, sd 2.1 | 26 runs, mean 59.8, sd 2.3 | 67 % |

   - Most of the +3.55 MB mean shift comes from a larger share of high-mode runs. That share change alone is not significant (Fisher p = 0.13).
   - The low mode moved +2.2 MB (t ≈ 3.2). The high mode moved +0.7 MB (t 1.16), but it widened.
   - **So "29 added about 3.7 MB per run" is not what the data show.** What they show is a shift on 29's trees of uncertain form.
   - **The tail is also smaller than the round says.**
     - Under the two-mode fit, P(≥ 65) is about 1.4 % per run on 29's trees, not about 7 %.
     - Empirically it is 1 of 39 = 2.6 % (95 % Clopper–Pearson 0.06–13.5 %).
     - On the 25-only trees, the high mode puts ≥ 65 at about 0.
3. **29 is the only change on S2's measured path between the two groups, so it is the leading suspect. It is not a proven cause.**
   - Since 29's merge, the tip changed `async/handler.ts`, `config/*`, `index.ts`, `proxy/{body-transformer,client-session,handler,responses-handler,session-context}.ts`, `runtime/{health-monitor,memory-thresholds,supervisor}.ts` and `server/server.ts` (tickets 20 and 21). None of these is in the S2 body's import closure.
   - 73's edit of `s2-captcha.mjs` was reverted (2347fa2) before 984b45d.
   - All 106 logs ran on runner image `win25-vs2026` 20261103.298.1, with Bun 1.4.2.
   - **Mechanism unknown.** Phase D writes 600 × 256 KiB ≈ 150 MiB, which is below the 256 MiB disk cap. So 29's pruner does no cap prune there. Per write it does Map bookkeeping. Beyond that, at most a 60 s rescan: one `lstat` and one 513-byte header read per entry.
4. **The 65 MB run is a commit/WS gap event.**
   - In 42553765178, phase D reads WS 77 → 139 MB = 62 (under 64) and commit 65. Its commit − WS gap is 3 MB. On 29's trees the mean gap is 0.9, and on the 25-only trees it is 0.3.
   - WS growth on 29's trees: mean 55.5, max 62. On the 25-only trees: mean 52.6, max 62.
   - The only ratchet failure in the run is this name. Every other S2 RED is one of 58's names.
   - **EVIDENCE MISSING (not blocking): the linux S2 value of 42553765178.** Its ubuntu log is not on this host.
5. **Confirmed: 16 and 38 cannot reach the value.**
   - 38 touches `cli/commands/doctor.mjs`, `lib/proxy-doctor.mjs`, `pack/verify-payload.mjs`, `proxy/zcode-proxy-manager.mjs`, the `package.json` test list and tests.
   - 16 touches `lib/{start-lock,proxy-lifecycle}.mjs`, the S3/S4 scenarios, `tests/memory/lib/completeness.mjs`, `expected-red.json`, the `package.json` test list and tests.
   - Neither touches a file in the S2 body's closure, `s2-captcha*`, `budgets.mjs`, `verdict.mjs`, a sampler, the Bun pin or the Node version.
6. **Q2: two facts in the round need correcting.**
   - **There is no "row help text".**
     - No README (any language), `docs/` page, `zcode-proxy-src/README*`, CLI help or TUI code describes the request-row columns.
     - The row is a console/log line in two formats: the table, and `ZCODE_LOG_FORMAT=compact`. Dump mode also writes an `upstream_stream_summary` with `totalMs` and `tokensObserved`.
     - **No `--json` output carries Total, Tok or tok/s.**
   - **Tok is not an event count.** `countTokens` takes the upstream's usage total (`completion_tokens` / `output_tokens`) when a usage event is read, and otherwise counts content deltas.
   - Also: the change covers only the three former `tee()` sites in `handler.ts`. Per 61's "Left for others", `/v1/responses` (`responses-handler.ts` `streamResponse`) and the async bridge still pump eagerly. They keep today's values.
7. Record drift: INDEX row 29 says `ready-for-agent`, but the file says `resolved`.

---

## Q1 — integration run 42553765178 (984b45d) is RED on windows S2/short `cdn-cache:memory-growth` 65 MB (budget 64), unowned

**DECISION:** REJECTED in part.

Accepted:
- **Item (1), first half.** Neither 16 nor 38 is reverted, because they cannot reach the value (correction 5). Ticket 29 is not reverted either.
- **Item (3).** The post-merge RED is recorded, and nothing is rerun.

Rejected:
- (i) **Attributing the shift to ticket 29 "on the measured evidence", and reopening 29 to "find why … and remove it".** The bins were wrong, the distribution is bimodal, and the mechanism is unknown (corrections 1–3). The evidence makes 29 the suspect, not the cause. A fix-forward that must "remove" a cost nobody has isolated would leave the implementer to decide whether a defect exists. Instead, a new ticket **80** measures first, by an A/B on one tree against the verbatim pre-29 cache. The fix lands only if that A/B attributes the shift (conditions 2–3).
- (ii) **Listing windows S2/short `cdn-cache:memory-growth` under owner 29 with `flips`.** This re-adds a removed name. Round 15 Q1 condition 5 ("a later RED of a removed name is an unowned RED: a question, never a re-add") forbids it, and so does Round 20 Q1 condition 3, which named "re-adding the name to `S2/short`" as forbidden for this very check. A `flips` listing would also tolerate the CDN memory bound at any value, including the 90 MB and 150 MB defect values. Round 17 Q1 and Q3 rejected exactly that. Round 22's listing is not a precedent here: there the mechanism was shown from the artefact and a role check bounded what was tolerated, and neither holds here.
- (iii) **"About 7 % per run".** The measured tail is about 1.4 % (two-mode fit) to 2.6 % (empirical) per run (correction 2). That is still above Round 30's 1 % bar, so a narrow interim signature is justified in place of the listing (condition 4).

Departures, stated explicitly:
- **PROMPT §7 Phase 4's revert rule, Round 6 Q2 condition 4's last bullet and Round 13 Q1 condition 6.** I depart from them for run 42553765178 and for signature (ix) only. This is the same departure as Round 17 cross-question condition 2, Round 22 Q1 condition 5 and Round 28 Q1 condition 5: the RED is one that the merged diffs cannot reach, and it is decided on its distribution.
- **Round 30 Q1 condition 5** ("a post-merge run follows PROMPT §7 Phase 4 unchanged") was written for linux S1/stalled. It is not contradicted, because that key gets no signature.
- **Consistent with:** Round 15 Q1 condition 5, Round 20 Q1 condition 3, and Round 20's Shared understanding. That Shared understanding foresaw this case: the 6–7 MB Linux margin, and "that RED comes back as an unowned RED, not as a quiet cap change".

**I loosen no bound.** These are all unchanged:
- the 64 MB `cdn-cache:memory-growth` budget and the windows commit gate (Round 7 Q1);
- the 32 MiB body budget and 256 entries (Round 20 Q1);
- 29's 256 MiB disk cap and its max(14 days, TTL) age rule;
- the S2 workload and phase order;
- every other S2 name and owner;
- `expected-red.json`.

Binding conditions:

1. **Run 42553765178.**
   - It does not count against 16 or 38 and causes no revert.
   - Its RED stands as an unowned RED, decided here. It is not rerun.
   - It satisfies signature (ix) below, and it is the first entry in ticket 80's record.
2. **New ticket 80** (exact text below). `Status: ready-for-agent`, Model sol, Risk medium, ADR no, Blocked by none.

   **Stage 1, A/B attribution (pre-registered).**
   - The setup:
     - An off-by-default measurement mode in the test loop only: a marker file, never merged, the same pattern as 61's `--measure-stalled`.
     - It runs full S2/short with phase D on either head's `CaptchaCdnCache` or the verbatim pre-29 cache `zcode-proxy-src/src/__fixtures__/captcha-cdn-cache.7555b87.ts` (in tree, blob checked by 29's replay test).
     - Everything else in the run is identical.
   - Counts and order:
     - **≥ 30 S2/short runs per arm on windows**, arms alternating ABAB in one job and BABA in the next;
     - ≥ 10 per arm on linux as the control.
     - Why 30: with sd ≈ 5.5, it takes about 30 per arm to see 3.5 MB at t ≈ 2.5. Ten per arm would see it with t ≈ 1.4 only.
   - What it records per run: commit and WS at D-start and D-end; the low/high mode (≤ 54 / > 54); and whether the pruner's 60 s rescan ran during phase D.
   - **Verdict (fixed now):**
     - **attributed to 29's code** if the windows commit mean of head minus pre-29 is ≥ 2.0 MB with Welch t ≥ 2.5;
     - **not attributed** if the difference is < 1.0 MB or t < 1.5;
     - **inconclusive** otherwise, and it comes back with all values.
     - The mode shares and a Fisher test are reported beside it.
   - If 58 (or anything else on S2's path) merges during the runs, the count restarts on the new tree.

   **Stage 2, only if attributed.**
   - The cost is removed inside 29's code under B1's IN SCOPE (resource lifecycle). 29's `captcha-cdn-disk-prune.test.ts` and `captcha-cdn-disk-replay.test.ts` and 25's seam-3 replay pass unchanged. Prune decisions, fetches, bytes, `sha256` and `fetchedAt` stay identical.
   - Forbidden: changing any bound in the list above, the S2 workload or the metric.
   - Exit: ≥ 10 GREEN windows S2/short runs on the fix tree, plus the A/B rerun on the fix tree showing a difference of < 1.0 MB.
   - If attributed but no lever exists inside those limits, it comes back with the numbers.

   **Not attributed.** It comes back with all values. The question then becomes the S2 phase-D bimodality on windows, with no owner, in the manner of tickets 78 and 79.
3. **Ticket 29 stays `resolved`.** It gets a Comments line (informational, no criterion, no ownership; Round 15 Q1 condition 6). If ticket 80 attributes the shift, the fix is 80's, and 29's number and record stay as they are.
4. **Interim signature (ix)** (Round 17 cross-question condition 2 form). A staged or post-merge run qualifies when all of these hold:
   - its only unexcused failure is windows S2/short RED on `cdn-cache:memory-growth`;
   - the value is ≤ 70 MB on commit;
   - phase-D WS growth (D-end − D-start `rss`) is ≤ 64 MB;
   - every other S2 RED name is one 58 owns;
   - the linux S2 `cdn-cache:memory-growth` of the same run is ok.

   Such a run does not count against the ticket, does not block its merge and causes no revert. The orchestrator records each occurrence in ticket 80's Comments with the run id, commit, WS and the linux value.
   - **Ineligible**, by exact path:
     - a diff touching `zcode-proxy-src/src/proxy/captcha-*`, `zcode-proxy-src/src/runtime/{bounded-collection,guest-error}.ts`, `zcode-proxy-src/package.json` or `bun.lock`;
     - `tests/memory/scenarios/s2-captcha*`, `tests/memory/lib/{verdict,budgets,sampler*,win-*}.mjs` or `tests/memory/job.mjs`;
     - the Bun pin or the memory job's Node version.
     - So ticket 80 itself, 58, 27, 28 and 61 (whose diff touches `job.mjs`) get no exception. A RED in their runs comes back with values.
   - **Why 70.**
     - It is 4.4 sd above the high mode on 29's trees (59.8, sd 2.3), and 2.6 sd above the single-normal mean. It was not fitted to the 65.
     - It lies well below the known defect values: 90 MB with 64 MiB of bodies, and 147–155 MB unbounded.
     - The WS clause sends back any run in which the tier's working set itself exceeds the budget.
   - **Comes back early:**
     - on two (ix) occurrences within any 20 consecutive windows runs;
     - on any value above 70, or WS above 64;
     - on any linux S2 `cdn-cache:memory-growth` RED.
   - **Ends** when the Owner Proxy answers ticket 80.
   - Signature (viii) is skipped, because that number was the proposal Round 30 rejected.
5. **Records.**
   - RUNLOG records: this round; corrections 1–4; that 42553765178 is not charged to 16 or 38 and is not rerun; and signature (ix) with its start time.
   - METRICS gains the corrected windows table: pre-25, 25-only and 25+29 by tree contents, the two-mode split, the WS column, and the run ids.
   - INDEX: row 29's status becomes `resolved` (drift), and row 80 is added.

**Rationale:** Three facts settle this. First, the RED cannot come from the merges that produced the tip, so a revert would punish two finished tickets for nothing. Second, the shift is real enough to name a suspect but not to name a cause. Once the bins are corrected, the data are two modes on both trees, the mode share moves without significance, and a small low-mode shift remains. 29 is the only change on S2's path, but its phase-D work is a Map entry per write. Third, the tail is about 1.4–2.6 % per run, not 7 %.

Under C9, the stronger evidence is the one that isolates the code. The verbatim pre-29 cache already sits in the tree, so an interleaved A/B on one runner is cheap and removes the tree and time confound. Pre-registering its verdict keeps the implementer from deciding whether a defect exists.

The listing is the wrong instrument. Two binding decisions forbid re-adding this exact name, and it would tolerate the CDN bound at any size. A narrow signature with a value ceiling, a WS clause and exact-path ineligibility does the listing's useful job instead: it shields tickets that cannot cause a roughly 2 % tail. It hides nothing that a real regression of the tier would show.

**Charter:** C1 (the CDN memory bound stays enforced at 64 MB; nothing tolerates it at an unbounded value; the disk bound is kept rather than reverted), C7 (windows evidence decides; linux is the control), C9 (stronger measured evidence: 106 runs re-binned by tree contents, the WS column and a pre-registered A/B; smaller blast radius: no revert, no list edit, one narrow signature; simpler: an existing fixture as the A arm), C6 (test-loop marker only, no endpoint), §9 (no bound loosened), B1 (any stage-2 change is lifecycle only, with 25's and 29's replay proofs unchanged), Round 7 Q1, Round 13 Q1 condition 6, Round 15 Q1 conditions 5 and 6, Round 17 Q1 and Q3 and cross-question condition 2, Round 20 Q1 condition 3 and its Shared understanding, Round 22 Q1 (distinguished), Round 28 Q1 conditions 1, 4 and 5, Round 30 Q1 condition 5 (the 1 % bar), PROMPT §7 Phase 4 (departure for this run and (ix) only; no rerun-until-green).

**REVERSIBILITY:** Two-way door: a measurement ticket, an interim signature that ends on a named answer, records. No code or list changes. ADR: no.

### Exact text changes

**New `issues/80-windows-s2-cdn-memory-after-29.md`:**

```
# 80: windows S2/short cdn-cache:memory-growth after ticket 29: A/B attribution

**Status:** ready-for-agent
**Blocked by:** none

Model: sol
Risk: medium
ADR: no

**What to build:** Owner Proxy round 31 Q1. Post-merge run 42553765178 (984b45d) was RED on windows S2/short cdn-cache:memory-growth 65 MB commit (WS 62; budget 64), unowned. By tree contents, windows values are 25-only n 26 mean 52.88 sd 6.00 max 62 and 25+29 n 39 mean 56.44 sd 5.26 max 65 (Welch t 2.45), bimodal on both trees (low ~47.6 / 49.8, high ~59.1 / 59.8; high share 46 % -> 67 %, Fisher p 0.13). Ticket 29 is the only change on S2's measured path but is not proven to be the cause. Stage 1 (pre-registered): an off-by-default test-loop marker (never merged) runs full S2/short with phase D on head's CaptchaCdnCache or on the verbatim pre-29 cache zcode-proxy-src/src/__fixtures__/captcha-cdn-cache.7555b87.ts, everything else identical; >= 30 runs per arm on windows (ABAB in one job, BABA in the next) and >= 10 per arm on linux; record commit and WS at D-start/D-end, the mode (<= 54 / > 54) and whether the pruner's 60 s rescan ran in phase D. Verdict: attributed if windows commit mean(head) - mean(pre-29) >= 2.0 MB with Welch t >= 2.5; not attributed if < 1.0 MB or t < 1.5; otherwise inconclusive and it comes back. Stage 2 only if attributed: remove the cost inside 29's code as resource lifecycle (B1 IN SCOPE); captcha-cdn-disk-prune.test.ts, captcha-cdn-disk-replay.test.ts and ticket 25's seam-3 replay pass unchanged (same prune decisions, fetches, bytes, sha256, fetchedAt). Never change the 64 MB budget, the 32 MiB body budget, 256 entries, the 256 MiB disk cap, the age rule, the S2 workload or the metric. Exit: >= 10 GREEN windows S2/short runs on the fix tree and the A/B on the fix tree < 1.0 MB. Attributed with no lever inside those limits, not attributed, or inconclusive: comes back to an Owner Proxy round with all values. A merge on S2's path (for example 58) during the runs restarts the count. This ticket owns no name and lists nothing; it records every signature (ix) occurrence (run id, commit, WS, linux value), starting with 42553765178.

**Acceptance criteria:**
- [ ] Stage 1 A/B recorded with all per-run values and the verdict under the pre-registered rule.
- [ ] Stage 2 (only if attributed): fix with the three replay/prune suites unchanged and green, then the exit evidence above.
- [ ] METRICS table: per arm, per leg, per run.
```

**`issues/29-cdn-disk-cache-pruning.md`**, add under `## Comments`:

```
- 2026-11-09 (orchestrator, Owner Proxy round 31 Q1, informational; no criterion, no ownership): windows S2/short cdn-cache:memory-growth reads +3.55 MB higher on trees with this ticket (n 39 against 26, bimodal on both). This ticket is the only change on S2's path but is not proven to be the cause; ticket 80 measures head against the verbatim pre-29 cache. This ticket stays resolved and is not reverted.
```

**`issues/INDEX.md`:** row 29's status becomes `resolved`. Add row 80 (`windows S2/short cdn-cache:memory-growth after ticket 29: A/B attribution`, sol, medium, blocked by none, `ready-for-agent`). No other edge.

---

## Q2 — ticket 61 changes two row values for slow clients (Round 12 Q3 condition 2, third bullet)

**DECISION:** ACCEPTED with conditions. The recommendation's text is corrected in three places (correction 6):
- there is no row help text;
- Tok is the upstream usage total, or the counted deltas, from the events read;
- the release-notes line must name the routes that changed.

This answers the "comes back before it ships" that Round 12 Q3 condition 2 required. It does not contradict that decision. The field names stay as they were. Each value keeps its definition: Total is still the time until the proxy saw the upstream end, and Tok is still what the proxy observed. The values move because the proxy now reads at the client's pace, which is the backpressure Round 12 ordered. Keeping today's values would need the read-ahead queue that Round 12 Q3 told 61 to remove.

Binding conditions:
1. **This acceptance binds only if stage 2 ships.** Stage 2 still needs the windows attribution on staging/61m1 and staging/61m2 to put the excess in bucket (i) or (ii) within ±20 % (Round 12 Q3 criterion 1). If it puts the excess in (iii) or (iv), or is inconclusive, criterion 4 applies, and the stage-2 commits come back together with this acceptance. Every windows GREEN criterion stays pending CI, as written.
2. **What is unchanged:**
   - column names, order and widths;
   - the compact format;
   - TTFB's meaning;
   - the dump field names (`totalMs`, `tokensObserved`);
   - every other route's values.
   No config key, env var or switch restores the old values. Such a switch would re-enable the queue (C1) and add surface for no gain (C9).
3. **Release notes (C2: announced, not silent).** New edge **54 ← 61**, following the 59 and 69 precedent. Acyclic: 54 has no dependents, and 61's ancestors (02, 19, 20 and theirs) do not include 54.

   The line, exact. The implementer may correct the route list to the code, but not the meaning:

   `Proxy request log: on streamed /v1/messages and /v1/chat/completions answers, the proxy now reads the upstream at the client's pace instead of buffering ahead of a slow client. For a client that reads slower than the upstream sends, Total and tok/s now include the time the client takes to read the answer. If such a client disconnects early, Tok reflects only what was read before it left (the upstream's usage total if it arrived by then, otherwise the counted text deltas). Clients that keep up see the same values as before; TTFB, the column names and the compact format are unchanged; /v1/responses streams are unchanged.`

   The dump-mode decoder fix (the 4 KiB sample's own decoder) gets one more clause in the same item. The orchestrator records the line in 54's Comments when 61 closes.
4. **Where it is documented (C8).** No README, translation, `harnesses/README*` or help text describes the request row today (correction 6), so none is owed a change. Instead:
   - a source comment at `printHeader` / `printRow` states the column semantics as in condition 3;
   - if ticket 52's README parity work documents the row later, it uses this wording.
5. **Tests that pin the new semantics** (seam 4; add the ones that the existing backpressure and contract tests do not already cover):
   - (a) for a client that keeps up, every one of the 9 contract cases yields the same Tok as on the tip 788f2fb;
   - (b) for a client that pauses P ms mid-stream, the row's Total is ≥ P;
   - (c) for a client that leaves early, the row is printed once, and Tok equals the usage total or delta count of the events delivered before the cancel, never more.
6. **Scope note.** The eager `/v1/responses` stream and the async bridge keep today's values. Until a follow-up exists, the row's semantics differ by route, and the release-notes line says so. A follow-up that converts them carries the same note. Nothing more is decided here.

**Rationale:** The new values describe what the proxy actually did, so the user sees the client's real experience instead of an upstream finish time reached only by queueing. The cost is a changed number for slow and early-leaving clients, in a human-readable log line. No `--json` output and no kit consumer reads that line (correction 6), so C3's `--json` stability and C2's JSON fields are untouched. The rest of C2 asks that the change be announced, which condition 3 does. The alternative would undo the C1 fix. A switch to keep old values would be a second mode that exists only to bring an unbounded queue back. The recommendation's own wording needed tightening: Tok is not an event count, the help text it relies on does not exist, and the change covers only some routes.

**Charter:** C1 (backpressure bounds response memory without shedding; no switch brings the queue back), C2 (field names unchanged; the change is announced in the release notes; no state or migration), C3 (consistency and clarity of the row; `--json` untouched), C8 (release notes; no affected README text), C9 (simpler: no switch; smaller blast radius: acceptance conditional on stage 2 shipping), B1 (`handler.ts` and `sse-translator.ts` are not anti-abuse modules; upstream request bytes are unchanged), Round 1 Q5, Round 12 Q3 criteria 1, 2 and 4, Round 12 Q2 and Round 14 Q2 condition 5 (the 54-edge precedent).

**REVERSIBILITY:** Two-way door: an internal response pipeline behind unchanged names, a log line's values, and a release-notes line. ADR: no.

### Exact text changes

**`issues/61-s1-stalled-windows-response-side-memory.md`**, add under `## Comments`:

```
- 2026-11-09 (orchestrator, Owner Proxy round 31 Q2, binding): the two row-value changes are accepted on the condition that stage 2 ships (windows attribution on staging/61m1 and staging/61m2 in bucket (i)/(ii) within ±20 %; otherwise criterion 4 and the stage-2 commits come back with this acceptance). Unchanged: column names, order and widths, compact format, TTFB, dump field names, other routes; no config switch. Release-notes line (edge 54 ← 61) as in round 31 Q2 condition 3; a source comment at printHeader/printRow states the semantics; seam-4 tests pin (a) Tok equal to the tip 788f2fb for a client that keeps up in all 9 contract cases, (b) Total >= an imposed client pause, (c) one row and Tok never above what was delivered for an early leaver. Corrections: Tok is the usage total or the counted deltas of the events read, not an event count; no row help text or README describes the row; no --json output carries Total, Tok or tok/s. This ticket's diff touches tests/memory/job.mjs, so signature (ix) does not apply to its runs.
```

**`issues/54-release-notes-and-owner-actions.md`:** add `61 (S1/stalled on Windows: proxy memory under many stalled streaming readers)` to `**Blocked by:**`. **INDEX row 54:** add 61.

---

## Shared understanding

Open branches I still see:
1. **Ticket 80's verdict.**
   - Attributed: a stage-2 fix inside 29's code.
   - Not attributed or inconclusive: windows S2 phase D has an unexplained two-mode distribution (≈ 48 / ≈ 60 MB) on both trees with no owner, and it comes back as a rule question like 78 and 79. Round 20's 6–7 MB margin is the underlying risk.
   - Signature (ix) holds until then.
2. **EVIDENCE MISSING: the linux S2 value of 42553765178.** It is not on this host. Ticket 80 records it.
3. **Ineligible tickets meet the tail with no exception.** 58, 27, 28 and 61 each have about a 13–23 % chance over 10 runs, and each RED comes back with values. If that happens often before 80 answers, the answer is due early.
4. **61's windows attribution** (staging/61m1, 61m2) is still pending. If the excess sits in (iii) or (iv), stage 2 and Q2's acceptance come back together, the windows `S1/stalled` entry stays, and 55's empty-list criterion becomes the owner question that Round 12 Q3 named.
5. **The row semantics differ by route** until `/v1/responses` and the async bridge get backpressure (61's "Left for others"). No ticket exists for that yet.
6. **61's burst4 paired shift** (219.9 → 230.6, p = 0.015, GREEN) is flagged by the implementer and was not decided here. It is judged with 61's pre-merge evidence under Round 12 Q3 criterion 3.


# Round 32 (2026-11-09): ticket 61's windows attribution is borderline-unaccounted, and the fix removes the excess

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–31 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-32.md`.
- DECISIONS Round 12 Q3 in full, with its Shared understanding; Round 30 Q1 (conditions 4 and 5, ticket 79); Round 31 Q2 in full, with its Shared understanding (branches 4 and 6).
- Ticket 61 at 6993e3d (`git -C /home/AgentKit/wt/t61 show HEAD:…`): every Comments entry, including the round-2 entry with the criterion-1 verdict. METRICS on the same branch: the caf66db S1 runs, the paired burst4 run, "Windows attribution mode, CI", and ticket 20's burst table.
- `tests/memory/lib/measure.mjs` at HEAD. The rule (`STALLED_ACCOUNTED_SHARE = 0.2`, `|residual| ≤ 0.2 × excess`) is computed from the medians of each component. It was committed in 1495c03 (00:11:48Z), before either run, and `git diff 1495c03 HEAD -- tests/memory/lib/measure.mjs` is empty.
- Artefacts `ci-art/t61m/{m1,m2}-{windows,linux}/`: the `.md` and `.json` files, plus each rotation's `summary.json` (outcome, every check, `growth:proxy` with trend, Bun runtime).
- Git (read-only):
  - `origin/staging/61m1` is 1495c03 plus one commit that adds only `tests/memory/measure-stalled`. `origin/staging/61m2` is ce6d627 plus the same one-file commit.
  - `git diff --name-only 788f2fb 984b45d -- zcode-proxy-src/` is empty.
  - `git diff --stat 984b45d ce6d627 -- zcode-proxy-src/src`.
  - `git diff --stat ce6d627 6993e3d` changes only docs (METRICS and ticket 61).
  - The integration tip since 984b45d is at 2b4e2e0 (tickets 30 and 18; `watchdog.ts` b63f453).

**Recomputed facts and corrections to the round.**

1. **Confirmed: the m1 windows verdict under the pre-registered rule.** Recomputed from the per-rotation raw values in the JSON.
   - Medians:
     - WS: excess 238.2, (iii) 102.4, (i) 85, residual 50.8, so 21.3 %, not accounted.
     - Commit: 271.3 / 111.7 / 85 / 74.6, so 27.5 %, not accounted.
   - Per rotation:
     - WS 20.5 / 19.5 / 18.4 %. Two of three rotations would pass, but the rule is the median form, and that fails.
     - Commit 26.9 / 20.6 / 24.9 %, so commit fails in every rotation.
   - Linux m1: 24.8 / 117.6 = 21.1 %.
2. **Confirmed: m2 is accounted under the same rule.**
   - Windows WS residual −4.0 / 77.6 = −5.2 %. Commit −3.8 / 116.3 = −3.3 %. (i) is 9 MB.
   - Linux m2: 15.3 / 80.8 = 18.9 %, accounted with little margin.
3. **Confirmed: the fix removes the stalled-specific excess.**
   - Stalled minus drained: WS 293.1 − 157.4 = 135.7 → 132.4 − 127.4 = 5.0 MB. Commit 453.7 − 298.3 = 155.4 → 298.1 − 294.7 = 3.4 MB.
   - m2's stalled WS peaks (121.6, 133.2, 132.4) are each more than 140 MB below the lowest of the 75 archived windows S1/stalled artefacts on the `tee()` tree (278–333, median 301.5; ticket 61 Comments).
   - m2's commit peaks are 292.7–306.5, under the 512 backstop.
   - The drained arm also falls on WS, 157.4 → 127.4, so the change helps readers that keep up too.
4. **The round's "when only the response copies change" holds for the proxy source, with one qualification.**
   - Nothing under `zcode-proxy-src/` changed between m1's base 788f2fb and 984b45d. Between the two measured trees, the proxy source differs only by 61's stage-2 files (`handler.ts`, `response-body.ts`, `server.ts`, `sse-translator.ts`) and their tests.
   - Both runs used Bun 1.4.2 (revision 744846f), Node v26.13.0 and the jobobject cap.
   - The trees also differ by kit-side tickets 16 and 38 and `tests/memory/lib/completeness.mjs`. None of these is on S1's proxy response path.
   - m1 and m2 are two CI runs, not one interleaved job. The size of the effect (point 3) makes runner variance an implausible explanation.
5. **Not in the round: m1 linux S1/stalled is RED on `growth:proxy` 6.09 %/1k (trend true) in rotation 3** (procPeak 178.6, count 1, orphans 0).
   - m1 linux stalled growth: 2.46, 4.33, 6.09, trend true in all three.
   - m2 linux stalled growth: 1.40, 1.34, 0.57, trend false in all three.
   - Drained arms on both trees: 0.04–1.27.
   - 6.09 is above 6 %/1k, which is one of ticket 79's early-return triggers (Round 30 Q1 condition 4). The run is an attribution-mode run ("no verdict, no ratchet") on the shipped `tee()` proxy, not on 61's change.
6. **The tip has moved past 984b45d** to 2b4e2e0: tickets 30 and 18. The only proxy-source change is `runtime/watchdog.ts` (the respawn hook's env drops the stop token). That is off the response path, but 61 must still merge it before its pre-merge run.
7. **The burst4 record (ticket 61 METRICS, local, shared machine).**
   - Paired runs: 219.9 (206.4–228.6, n 9) against 230.6 (214.7–235.8, n 9), permutation p = 0.015.
   - Both sit inside ticket 20's final 10-run range of 193.3–241.2. The budget is 250, and burst4 is unlisted on both legs.
   - The only changed code on that path is the 64 KiB socket-write piece.

---

## Q1 — does ticket 61's stage 2 (backpressure) ship?

**DECISION:** ACCEPTED with conditions. One part is REJECTED as worded: "burst4 recorded" (condition 5). The recommendation's merge conditions also leave out the windows half of Round 12 Q3 criterion 3, which is restored here (condition 4).

Stated departure:
- This **departs from the literal gate of Round 12 Q3 criterion 2** ("Stage 2, only if (i) or (ii) carries the excess", evidenced by criterion 1's ±20 % accounting) **and from Round 31 Q2 condition 1** ("Stage 2 still needs the windows attribution … within ±20 %"; inconclusive sends the commits back under criterion 4). The departure is for ticket 61 only.
- The commits have come back as those decisions required, and this round is that return. I decide on stronger measured evidence (C9).

What stays unchanged:
- The pre-registered rule, which is not reinterpreted.
- m1's verdict.
- Every budget.

Consistent with:
- **Round 12 Q3 criterion 4.** Its "the entry stays" branch needs the excess to sit in (iii)/(iv), or in Bun internals with no proxy-side lever.
  - m1's stalled-specific excess (135.7 WS) lies above the drained reference by construction. So it is neither (iii) nor (iv) as the mode defines them.
  - m2 shows a proxy-side lever directly.
- **Round 1 Q5.** Nothing is capped, shed or ended.
- **Round 30 Q1 condition 5.**
- **Round 31 Q2.** Its row-value acceptance now binds, because stage 2 ships.

Binding conditions:

1. **Records, with no retroactive change.**
   - m1 is recorded as "not accounted under the pre-registered rule (WS 21.3 %, commit 27.5 %; per rotation WS 20.5/19.5/18.4, commit 26.9/20.6/24.9)". `STALLED_ACCOUNTED_SHARE` and its median form stay as they are.
   - The residual (50.8 WS / 74.6 commit MB) is recorded as "unattributed, stalled-specific". The "RSS ≈ 2× heapUsed for queued `tee()` bytes" idea is recorded as an unproven hypothesis, not as an attribution.
   - **Basis for shipping.** The m2 intervention:
     - stalled minus drained 135.7 → 5.0 WS and 155.4 → 3.4 commit;
     - (i) 85 → 9;
     - m2 accounted on both metrics;
     - stalled WS 121.6–133.2, against an archive minimum of 278.
   - **No precedent.** A causal A/B does not in general replace a pre-registered attribution. Any other ticket that wants this substitution needs its own round.
2. **Finish Round 31 Q2.** Build conditions 2–6 of Round 31 Q2:
   - the source comment at `printHeader` / `printRow`;
   - seam-4 tests (a)–(c);
   - the release-notes line under edge 54 ← 61, recorded in 54's Comments when 61 closes;
   - the scope note for `/v1/responses` and the async bridge.

   Then merge the current tip (2b4e2e0 or later) into `ticket/61-s1-stalled-windows`.
3. **Transfer rule for the m2 evidence.**
   - m2 covers the shipping tree only if the non-test code of `zcode-proxy-src/src/{proxy/handler.ts,proxy/response-body.ts,server/server.ts,translator/sse-translator.ts}` matches ce6d627's, apart from the comment from condition 2 and anything the tip merge brings in.
   - Otherwise, for example if tests (a)–(c) force a code change, the attribution mode is rerun once on the new head (marker `3`, both legs). Before merge it must:
     - be accounted under the unchanged rule on windows WS and commit;
     - have a stalled WS median ≤ 250 and a commit maximum < 512.

     If either fails, 61 comes back with all values. Nothing is rerun beyond that one run.
   - The marker never merges, and the loop test enforces this.
4. **One pre-merge CI run on the merged head confirms Round 12 Q3 criterion 3 in full, on both legs.** Any RED comes back to an Owner Proxy round with its values, and nothing is rerun. No signature applies: 61 is ineligible for (vii) and (ix).
   - Windows S1/stalled must be GREEN on WS (≤ 250) and under the 512 MB commit backstop, with no `expected-red.json` entry (3820c9a; Round 15 Q1 condition 5).
   - Linux S1/stalled must be GREEN. A RED comes back under Round 30 Q1 condition 5 with the ticket 79 table. The value goes into ticket 79 either way.
   - S1/short, S1/burst1/4/16/32, S1/bigbody and S7 must not regress on either leg:
     - windows S1/short under ticket 71's 5-repetition rule (Round 17 Q3 condition 4);
     - S7 RED only on ticket 33's listed name;
     - every other job GREEN under the normal rules.
   - Then 61 merges alone. It may be reverted on its own.
5. **burst4 (REJECTED: "recorded" alone does not meet criterion 3's "do not regress").**
   - In the pre-merge run, S1/burst4 must be GREEN on both legs (condition 4).
   - The local paired shift (+10.7 MB, p = 0.015) is recorded in 61's Comments and METRICS as "flagged, unattributed". It came from a shared local machine, and both medians sit inside ticket 20's 193.3–241.2.
   - **Trigger, pre-registered now.** After 61 merges, the first S1/burst4 RED on either leg, in any run, comes back to an Owner Proxy round with 61 named as the suspect. 61's 64 KiB socket-write piece is the only changed code on that path, and the margin is 250 − 235.8 = 14 MB.
   - No budget changes.
6. **The m1 linux RED and ticket 79.**
   - The 6.09 %/1k RED of m1 linux rotation 3 is recorded. It is not charged to 61, because the tree is the shipped `tee()` proxy with a test-only mode. It is not rerun.
   - The six linux stalled values of both runs go into ticket 79's record with their run ids, trees and trends:
     - m1 (`tee()`): 2.46, 4.33, 6.09, trend true;
     - m2 (61's head): 1.40, 1.34, 0.57, trend false.
   - The three drained values of each run go in beside them.
   - Ticket 79's "any value above 6 %/1k" trigger has fired, so 79 is due back to an Owner Proxy round. Its question (a), "did a merged tree shift the tail", should then use this contrast as evidence. This round does not answer 79.
7. **When 61 merges:**
   - `S1/stalled` (windows) leaves the list, so 55's empty-list criterion is no longer blocked by 61.
   - Round 31 Shared understanding branch 4 is closed.
   - Round 31 branch 6 (burst4) is settled by condition 5.

**Rationale:** Criterion 1 exists so that a fix is not built on the wrong bucket. Under the rule fixed in advance, the m1 split narrowly fails on WS (21.3 % against 20 %, with two of three rotations passing) and clearly fails on commit. That failure stays on record. The question it was meant to answer has been answered more directly, though. On the same Bun, Node and cap, with the proxy source different only by 61's response-path change, the stalled-specific excess falls from 135.7 to 5.0 MB WS and from 155.4 to 3.4 MB commit. The JS heap that stalled readers hold falls from 85 to 9 MB, and the stalled peaks land more than 140 MB below every one of 75 archived `tee()` runs. The modified tree also passes the very rule that m1 failed. An intervention that removes the effect is stronger evidence than a subtraction-based split of the old tree, and C9 says the stronger measured evidence wins.

Criterion 4 keeps the entry only when the excess is in the drained or floor buckets, or in Bun internals with no proxy-side lever. m2 refutes the lever clause outright, and the stalled-specific part sits outside (iii)/(iv) by construction. Holding back a fix that turns a primary-platform RED GREEN, with an untouched contract, no shedding and no new surface, would fail C1 and C7 for the sake of a 1.3-point miss on an accounting rule whose purpose is already met.

I keep the rule and the m1 verdict exactly as recorded, so nothing is reinterpreted after the fact. I also bound the departure: it does not set a precedent, the m2 evidence transfers only to an unchanged response path, and one pre-merge run must confirm criterion 3 in full on both legs. That includes the windows items the recommendation left out. "burst4 recorded" is too weak for "do not regress" when a significant shift leaves 14 MB of margin, so it gets a GREEN requirement and a pre-registered return trigger. The m1 linux 6.09 is a ticket 79 trigger that the round missed. It belongs to 79, not to 61, and the m1/m2 contrast is useful evidence for that ticket.

**Charter:** C1 (bounded response memory by backpressure, without shedding; the windows RED removed; no budget loosened), C2 (client bytes and field names unchanged; row-value change announced via 54 under Round 31 Q2), C7 (the primary-platform RED fixed; linux not regressed: CI 181 → 144.3, local 175 → 148.5), C9 (stronger measured evidence: a causal intervention over a subtraction split; smaller blast radius: one revertible ticket, a transfer rule, no precedent), §9 (250 WS, 512 commit, 5 %/1k and the S1 budgets unchanged), B1 (no anti-abuse module touched), B5, Round 1 Q5, Round 12 Q3 criteria 1–4 (criterion 2's gate departed from for 61 only), Round 15 Q1 condition 5, Round 17 Q3 condition 4, Round 30 Q1 conditions 4–5, Round 31 Q2 (conditions 1 departed from, 2–6 binding), PROMPT §7 Phase 4 (no rerun-until-green).

**REVERSIBILITY:** Two-way door: an internal response pipeline behind unchanged contracts, a list deletion and records. 61 merges alone and can be reverted alone. ADR: no.

### Exact text change

**`issues/61-s1-stalled-windows-response-side-memory.md`**, add under `## Comments`:

```
- 2026-11-09 (orchestrator, Owner Proxy round 32, binding): stage 2 ships. Criterion 1 is recorded as not accounted under the pre-registered rule on m1 (1495c03, 42561009557): WS 21.3 % (rotations 20.5/19.5/18.4), commit 27.5 % (26.9/20.6/24.9); the rule (STALLED_ACCOUNTED_SHARE 0.2, median form) is unchanged, and the residual (50.8 WS / 74.6 commit MB) is unattributed stalled-specific memory (the RSS ~2x heapUsed idea is unproven). The basis for shipping is the m2 intervention (ce6d627, 42561017903; proxy source differs from m1 only by this ticket's response-path files; same Bun 1.4.2, Node, cap): stalled minus drained WS 135.7 -> 5.0 MB, commit 155.4 -> 3.4 MB, (i) 85 -> 9 MB, m2 accounted (WS -5.2 %, commit -3.3 %), stalled WS 121.6-133.2 against an archive minimum of 278. This is a departure from Round 12 Q3 criterion 2's gate and Round 31 Q2 condition 1 for this ticket only, and no precedent. Before merge: Round 31 Q2 conditions 2-6, merge the current tip, then one pre-merge CI run confirming criterion 3 on both legs (windows S1/stalled GREEN WS <= 250 and commit < 512 with no entry; linux S1/stalled GREEN, a RED comes back under Round 30 Q1 condition 5; S1/short with windows under ticket 71's rule, burst1/4/16/32, bigbody, S7 except ticket 33's name; every other job GREEN); any RED comes back with values, nothing rerun, no signature. m2 transfers only if the non-test code of handler.ts, response-body.ts, server.ts and sse-translator.ts equals ce6d627's (apart from the printHeader/printRow comment and the tip merge); otherwise one rerun of the attribution mode on the new head must be accounted on windows WS and commit with stalled WS median <= 250 and commit max < 512, or 61 comes back. burst4: the local paired shift 219.9 -> 230.6 (p 0.015) is flagged and unattributed; it must be GREEN on both legs pre-merge, and the first S1/burst4 RED on either leg after this ticket merges comes back naming this ticket as the suspect. The m1 linux S1/stalled RED (growth:proxy 6.09 %/1k, trend true, tee() tree) is not charged to this ticket and goes to ticket 79 with the other five linux stalled values (m1 2.46/4.33/6.09 trend true; m2 1.40/1.34/0.57 trend false).
```

**`issues/79-linux-s1-stalled-growth-tail.md`**, add under `## Comments`: the six stalled and six drained linux values of 42561009557 and 42561017903, with trees 1495c03 / ce6d627 and trends, and "early-return trigger (value > 6 %/1k) fired by 42561009557 rotation 3, 6.09 %/1k; due back to an Owner Proxy round".

**RUNLOG:** this round; m1 not accounted (rule unchanged); the departure for 61 only; the 6.09 trigger for 79.

---

## Shared understanding

Open branches I still see:
1. **61's pre-merge run** can fail a criterion-3 item. Windows S1/short runs at about 4 % per run under Round 28 with no signature, and linux S1/stalled at about 0.7 %. Either comes back with values. If the response path changes before merge, condition 3's rerun decides.
2. **Ticket 79 is due back now** (6.09 %/1k on the `tee()` tree). The m1/m2 contrast (trend true 3/3 against false 3/3) suggests that `tee()` queuing feeds the linux S1/stalled tail. That is 79's question (a), not decided here.
3. **The burst4 shift** stays flagged with a return trigger. If it is real, the 14 MB margin under 250 is the risk.
4. **The m1 residual's nature** (native or allocator share of queued bytes, against socket send buffering) stays unproven. It is record only, because the fix removes it.
5. **`/v1/responses` and the async bridge still pump eagerly.** A stalled client of those routes still queues without bound (C1), the row semantics differ by route, and no ticket or measurement exists for them yet (Round 31 branch 5).
6. Round 31 branches 1–3 (ticket 80, the missing linux S2 value, ineligible tickets meeting the S2 tail) are unchanged.


# Round 33 (2026-11-09): the windows S4 "Ctrl-C" trial is a crash, not a Ctrl-C

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–32 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-33.md`.
- DECISIONS Round 1 Q4 (condition 4) and Q7; Round 15 Q1 in full (conditions 2, 4, 5, 7, 9) with its Shared understanding; Round 16 Q1 (conditions 3–4) and Q3; Round 22 Q1 (as recorded in ticket 17); METRICS.md "Matching code" and the ticket-16 restart line (Round 27 Q1 condition 6).
- Ticket 17 at ea1da62 (`git -C /home/AgentKit/wt/t17 show HEAD:…/issues/17-…md`): Acceptance, every Comments entry, the 2026-11-09 implementer report including "Not met: windows S4 `stale-lock-after-ctrl-c`".
- `tests/memory/scenarios/s4-lifecycle.mjs`: identical on the branch head and the integration tip (`diff` empty). The trial is `spawn(process.execPath, [manager, "start"])` then `child.kill("SIGINT")` once the lock names the child (`:95-100`); `stale-lock-after-ctrl-c` counts `existsSync(lockFile)` after the child exits (`:106`, `:153`, `:166`).
- `tests/memory/expected-red.json` on the branch and the tip: windows `S4/short` owners `17 → proxy-left-after-stop, failed-lifecycle-steps, stale-lock-after-ctrl-c, count:proxy`; `flips` does **not** hold `stale-lock-after-ctrl-c`.
- Spec §18 PROCESSES, second bullet: "0 stale locks after a race round or after Ctrl-C during start (baseline 5 of 8)".
- OWNER-ACTIONS.md OA-2 (tip) and OA-3 (branch). Ticket 42 Comments, round 2: "Ctrl-C in the plain path on a Windows console … there is no automated proof of it on Windows, so it stays an owner check."
- Archived windows S4/short summaries from 16's CI: `merge-16-ci/art-win/S4-short/…T2140…/summary.json` and `merge-16-ci/art/windows/S4-short/…T0215…/summary.json`.
- Primary sources: Node.js `child_process` docs, `subprocess.kill()`: "On Windows … 'SIGKILL', 'SIGTERM', 'SIGINT' and 'SIGQUIT' terminate the process forcefully and abruptly (similar to 'SIGKILL')" (https://nodejs.org/api/child_process.html). Microsoft Learn, `GenerateConsoleCtrlEvent`: CTRL_C_EVENT "cannot be limited to a specific process group"; only processes in the group "that share the same console as the calling process receive the signal"; a zero group id signals "all processes that share the console of the calling process"; "CTRL+BREAK signals always cause the handler functions to be called" (https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent).

**Recomputed facts and corrections to the round.**

1. **Confirmed: the windows trial is a hard kill.** Node's docs state it outright, and the scenario passes no option that changes it. No handler, no `exit` hook and no `finally` runs in the killed holder. So no kit change can make it release its lock, and the windows name cannot go GREEN under this trial.
2. **Confirmed: the crash is already recovered.** In both archived windows S4/short runs on 16's tree, `stale-lock-after-ctrl-c` is the only RED. The stale lock appears in 6 of 8 trials each (the 900 and 1050 ms trials end after the start released its lock normally). In 8 of 8 trials in both runs, `nextStart` = 0, `nextStop` = 0 and `proxiesAfter` = 0. That is 16's proven takeover at work: the lock a crash leaves behind does no harm.
3. **The rate is deterministic, not a flip.** The name is RED in every windows run on record and is not marked `flips`. So under Round 15 Q1 condition 5, its removal needs the owner's recorded loop runs plus a pre-merge CI run GREEN on windows, not the ≥ 10-run floor.
4. **The round leaves the interim label's owner unstated.** "The trial is labelled in the summary" until the follow-up merges would need a code change somewhere. On 17's branch that would void the pre-merge run in flight (staging/17r 2492c11). Condition 5 settles this.
5. **Not in the round, but needed:**
   - 17's Acceptance still says "Delete `S4/short` (linux, windows)". Round 15 Q1 condition 7 and Round 16 Q1 condition 3 both kept that line ("stays"). This round amends its windows half.
   - Ticket 55's blocked-by list must cover every owner (Round 15 Q1 condition 9), so a new owner needs a new edge.
   - A follow-up that edits `s4-lifecycle.mjs` restarts the windows S4/short matching count. That count is also 17's floor for its windows `flips` names (METRICS.md, ticket-16 restart line).
6. **CTRL_BREAK is not CTRL_C.** A process created with CREATE_NEW_PROCESS_GROUP has Ctrl-C disabled, and CTRL_C_EVENT cannot be aimed at a group. So the only console event CI can deliver to just the trial's child is Ctrl-Break. 17 handles SIGBREAK through the same release path as SIGINT (17's report; windows-latest seam tests for SIGINT/SIGBREAK/SIGHUP emission). A real Ctrl-C and a real console close stay with OA-3.

---

## Q1 — how is windows S4 `stale-lock-after-ctrl-c` judged?

**DECISION:** ACCEPTED with conditions. The check keeps its purpose and its budget: 0 stale locks after a user's interrupt during start, baseline 5 of 8. It is **never** re-judged as a crash. A follow-up memory-loop ticket (next free id, "N" below; 81 at this writing) makes the windows trial deliver a real console control event: CTRL_BREAK_EVENT to a process group rooted at the trial's own `proxy start` child. A self-test proves that the event reached the child's handler. The name moves from 17 to N in the open. 17 merges with the name listed and its other windows criteria met in its pre-merge run.

One ambiguity in the recommendation is resolved, not rejected: until N merges, the "TerminateProcess (crash), not a console event" label lives in the records. N's code carries the label for every trial from then on (conditions 4d and 5).

**This explicitly amends** the windows half of 17's "Delete `S4/short` (linux, windows)", which Round 15 Q1 condition 7 and Round 16 Q1 condition 3 kept. Linux is unchanged. Nothing else is contradicted. Round 15 Q1 condition 5 is applied, not bypassed: a name its owner's fix should clear stayed RED and came back with numbers (17's report), and the Owner Proxy decides its new owner here (Round 16 Q3: nothing is re-pointed silently).

Binding conditions:

1. **What the name measures (§18 PROCESSES, unchanged).**
   - Windows `stale-lock-after-ctrl-c` judges "0 stale locks after an interrupt during start" with budget 0 (`PROCESSES.staleLocks`) and baseline 5 of 8.
   - No one reinterprets the windows TerminateProcess result as passing, lowers the budget, or turns the name into a crash check.
   - Crash-of-holder recovery on windows is already judged elsewhere, and no new crash name is added:
     - S3's kill-holder round (16's names);
     - `respawn-recovers-despite-stale-lock`;
     - `unstoppable-proxy-after-ctrl-c` over the S4 trials;
     - 16's takeover proofs.
2. **Ticket 17 merges as follows.**
   - It needs no code change for this question. Its pre-merge run (2492c11) must show windows S4/short RED on `stale-lock-after-ctrl-c` and on no other name, and every other windows criterion met as 17's report lists them. Any other windows S4 RED comes back with values (Round 15 Q1 condition 5).
   - 17's merge check records the name's status as "moves to N (Round 33); not clearable under a TerminateProcess trial".
   - 17 keeps every other windows S4 name it owns: `proxy-left-after-stop`, `failed-lifecycle-steps` and `count:proxy`, all `flips` with the ≥ 10-run floor (Round 16 Q1 unchanged).
   - 17's windows obligation for a real interrupt is its windows-latest seam tests (SIGINT/SIGBREAK/SIGHUP releasing the lock with exit 0xC000013A) plus OA-3, which is marked unverified.
3. **The ownership move (in the open, one change).**
   - After 17 merges, the orchestrator commit that publishes N's issue file also moves `stale-lock-after-ctrl-c` from owner 17 to owner N in windows `S4/short` of `expected-red.json`, with a Comments line naming this round in both tickets. The name is not marked `flips`.
   - The same commit replays the latest windows `job-summary.json` through the edited list, and the replay must hold.
   - Edges: N is blocked by 17, because the event only releases the lock with 17's SIGBREAK listener. 55 gains "blocked by N" (Round 15 Q1 condition 9).
   - Until that commit, the name stays under 17. Nobody edits it otherwise.
4. **N's scope: `tests/memory` only, no product code.**
   - **(a) Delivery.**
     - The windows trial starts the `proxy start` child with CREATE_NEW_PROCESS_GROUP on a console the sender shares. It then sends `GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, <child pid>)` when the lock names the child, using the same timing schedule as today (`(t % 8) × 150 ms`, 8 trials, 20 on long).
     - A zero group id, and CTRL_C_EVENT on a shared console, are forbidden. Either would signal processes this run did not start, including the runner's own (B4).
     - If a dedicated console is needed, the helper creates it only for itself and the trial child.
   - **(b) Footprint and safety.**
     - Only in-box tooling may be used (Node, PowerShell `Add-Type`, or equivalent). No npm dependency, no native addon and no checked-in binary (C4, C6). It opens no network endpoint.
     - The helper is tracked by pid and reaped at the end of each trial and on every failure path, under the job's existing caps (B4, C1).
     - The helper is a harness process. It is never counted as a kit role, in `count:*`, orphans or footprint.
   - **(c) Proof of delivery (power check, every run).**
     - Each trial in which the child held the lock at delivery must show the child's own `INFO manager start lock released on signal signal=SIGBREAK …` event line. The trial records the delivered method and that proof per trial in `sigintDuringStart`.
     - A trial whose delivery cannot be proven is a **harness failure** (the job fails). It is never GREEN, and it never falls back silently to `child.kill`.
     - RED first: with 17's SIGBREAK listener removed (a mutant, restored afterwards), the windows trial shows stale locks. On 17's code it shows 0 of 8. Both results are recorded.
   - **(d) Labels.**
     - The S4 report and job summary print the event each trial delivered: linux "SIGINT (kill)", windows "CTRL_BREAK_EVENT (console event, own process group)". The label is additive.
     - The check name stays `stale-lock-after-ctrl-c`. Renaming it would trigger the stale-name rule and break the run history. The label makes plain that CI delivers Ctrl-Break, not Ctrl-C.
   - **(e) Linux.** The linux trial's behaviour is unchanged.
   - **(f) Matching runs.**
     - N's merge restarts the windows S4/short matching count on N's tree, and 17's windows `flips` floor counts on that tree or a later one (Round 27 Q1 condition 6 precedent).
     - Linux S4/short carries on only if what it executes is unchanged apart from the additive note and label. METRICS.md records which applies.
   - **(g) Removal.** Round 15 Q1 condition 5 applies to a name RED in every matching run. N removes the name with its recorded windows loop runs (CI runs on its branch when no local windows leg exists) plus its pre-merge CI run GREEN on windows S4/short, with the proof of condition 4c present in each.
   - **(h) If it cannot be done on the hosted runner.** This covers no console to share, an event that never arrives, or a self-test that cannot pass. N then comes back to an Owner Proxy round with that evidence. The name stays under N, and no one deletes it, re-labels it as a crash or loosens the budget.
5. **Interim label (records, no code).**
   - Until N merges, 17's Comments, METRICS.md (windows S4/short rows) and RUNLOG carry: "windows S4 `stale-lock-after-ctrl-c` = `child.kill("SIGINT")` = TerminateProcess (crash), not a console event; on 16's tree 6/8 stale in both archived runs, with next start 0, next stop 0 and 0 proxies in 8/8".
   - The orchestrator and the Owner Proxy read these records. Re-running 17's pre-merge CI only to print the label would buy nothing.
6. **Spec record.** §18 PROCESSES, second bullet, gains a measurement-rule amendment (Round 33): on windows, the Ctrl-C-during-start trial delivers CTRL_BREAK_EVENT to the trial child's own process group, with proof of delivery. Until ticket N merges, the windows value is a TerminateProcess result and is owned, not judged as a pass. The budget and the baseline are unchanged.

**Rationale:** On the primary platform, the trial as written measures something else than its name says. Every windows result so far is the effect of a hard kill, and Node's documentation leaves no doubt about that. Judging the name against a crash would quietly retire "0 stale locks after Ctrl-C" on Windows, which is the platform where users actually press Ctrl-C in conhost and PowerShell, and would leave only a manual owner action (OA-3) as evidence. That fails C7, and it amounts to loosening a §18 budget by reinterpretation.

Doing nothing fails too. The name could never leave the list, so 55's empty-list goal would be blocked forever.

The real-event trial is the smallest change that measures the right thing. It is test-only, uses in-box Windows APIs and the existing scenario, and keeps the same name and budget. Ctrl-Break to the child's own process group is the only console event the documented API can aim at just that child. Aiming more widely (CTRL_C_EVENT or group 0) would hit processes the run never started, which B4 forbids.

Delivery on a hosted runner is unproven (ticket 42 found no automated Windows console proof). So the decision ties the trial to a per-run proof of delivery and makes a failed delivery a harness failure, never a silent fallback to the crash path. It also routes "infeasible" back with evidence instead of letting it become a deletion.

The crash path keeps its own coverage (S3 kill-holder, respawn over a stale lock, and the trials' next-start/next-stop data, which recovered in 8 of 8 trials in both runs). So it needs no new name.

17 has done what its code can do: linux 5/8 → 0/8 in 9 of 9 runs, and the seam tests cover the windows console events. Holding 17 back on a measurement it cannot influence would stall the C1 fixes it delivers, and the descendant-ownership logic of Round 15 Q1 condition 2 favours N, which needs 17 first.

**Charter:** C1 (the stale-lock and single-proxy checks stay enforced; the harness helper is reaped and bounded), C7 (the primary platform gets a real interrupt measurement in CI instead of a crash under the interrupt's name; linux unchanged), C4 (in-box tooling only, no new dependency), C6 (no new endpoint; no binary or secret), C9 (stronger evidence: a measured, proven delivery beats a reinterpreted crash; smaller blast radius: one test-only ticket and one list move; "do nothing" rejected because the name could never clear), §9 (budget 0 and baseline 5 of 8 unchanged), B4 (no zero-group or CTRL_C broadcast), PROMPT §7 Phase 4 (no re-run until green; infeasibility comes back with evidence), Round 1 Q4 condition 4, Round 1 Q7 (A2), Round 15 Q1 conditions 2, 4, 5, 7 (amended for windows) and 9, Round 16 Q1 conditions 3 (amended for windows) and 4, Round 16 Q3, Round 27 Q1 condition 6.

**REVERSIBILITY:** Two-way door. The changes are test-harness code under `tests/memory`, a list ownership move, ticket text and records. No product code, contract or budget changes. ADR: no.

### Exact text changes

**`issues/17-start-lock-signal-release-and-orphan-adoption.md`**, Acceptance:
- "Loop S4: 0 stale locks after Ctrl-C during start (baseline 5/8); respawn with a stale lock → proxy up; 50 cycles → 0 orphans, log-dir files ≤ 8. **Delete `S4/short` (linux, windows).**" becomes:
  > - [ ] Loop S4: 0 stale locks after Ctrl-C during start (baseline 5/8) on linux; respawn with a stale lock → proxy up; 50 cycles → 0 orphans, log-dir files ≤ 8. **Delete `S4/short` (linux).** Windows: remove 17's names from `S4/short` with Round 15 Q1 condition 5's evidence, except `stale-lock-after-ctrl-c`, whose windows trial is a TerminateProcess (crash) and moves to ticket N (Owner Proxy round 33). 17's windows obligation for a real interrupt is the windows-latest seam tests (SIGINT, SIGBREAK, SIGHUP release, exit 0xC000013A) and OA-3 (unverified).

Comments:
```
- 2026-11-09 (orchestrator, Owner Proxy round 33, binding): windows S4 `stale-lock-after-ctrl-c` is measured by `child.kill("SIGINT")`, which Node maps to TerminateProcess on Windows: a crash, not a console event. No kit change can clear it. On 16's tree: 6/8 stale in both archived windows runs, with next start 0, next stop 0 and 0 proxies in 8/8. 17 merges with the name listed. Its pre-merge run must show windows S4/short RED on this name only, and any other windows S4 RED comes back with values. The name moves to ticket N (windows console-event trial) in the commit that publishes N, after 17 merges. Merge check status: "moves to N (Round 33)". "Delete S4/short" is amended to linux only; on windows 17 removes its own other names under Round 15 Q1 condition 5.
```

**New issue `issues/N-windows-s4-console-event-ctrl-c-trial.md`** (title: "windows S4: deliver a real console control event in the Ctrl-C-during-start trial"). Blocked by: 17. Model: sol. Risk: medium (Windows console semantics on the hosted runner unproven). Status: ready-for-agent. Acceptance = condition 4 (a)–(h) verbatim, plus the common acceptance. Owns windows `S4/short` → `stale-lock-after-ctrl-c` (not `flips`).

**`expected-red.json`** (in N's publishing commit, after 17 merges): windows `S4/short` owners: remove `stale-lock-after-ctrl-c` from `"17"` and add `"N": ["stale-lock-after-ctrl-c"]`. Replay the latest windows `job-summary.json` through the edited list, which must hold.

**`issues/55-…md` and `issues/INDEX.md`:** 55's blocked-by list gains N. Add an INDEX row for N.

**Spec §18 PROCESSES**, second bullet: append condition 6's measurement-rule amendment.

**METRICS.md / RUNLOG:** the interim label of condition 5; for N, the matching-count restart record of condition 4f.

---

## Shared understanding

Open branches I still see:
1. **Delivery on the hosted windows runner is unproven.** Does the job's process have a console the trial child can share, or can the helper create one, and does CTRL_BREAK_EVENT reach a Node child there? N's self-test answers this. If it cannot pass, N comes back with evidence (condition 4h), and the name stays listed under N.
2. **CI measures Ctrl-Break, not Ctrl-C or console close.** Those two real events stay with OA-3 and the emission-based seam tests. If OA-3 ever fails while CI is GREEN, that is a product finding for 17's release path, not a measurement change.
3. **17's pre-merge run (2492c11) is still running.** A windows S4 RED on any name other than `stale-lock-after-ctrl-c`, or a linux S4 RED on any name, comes back with values.
4. **N's merge restarts the windows S4/short matching count**, and with it 17's windows `flips` floor (`proxy-left-after-stop`, `failed-lifecycle-steps`, `count:proxy`). That costs time but not correctness. METRICS.md records the restart point.


# Round 34: Owner Proxy answers — ticket 61's transfer-rule rerun (m3)

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–33 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-34.md`.
- DECISIONS Round 12 Q3 (criteria 1–4, with its Shared understanding), Round 31 Q2 and its Shared understanding, Round 32 in full (recomputed facts, Q1 conditions 1–7, Shared understanding).
- `tests/memory/lib/measure.mjs` at 326f5f5: the header comment, `STALLED_ACCOUNTED_SHARE = 0.2` and `stalledReport`. Its history: last changed in 1495c03 (2026-11-09T00:11:48Z), and `git diff 1495c03 326f5f5 -- tests/memory/lib/measure.mjs` is empty.
- Ticket 61 at 326f5f5: criterion text (line 35), the round-1 CI-mode entry (line 82), the round-2 verdict entry (line 150), and the round-3 entry, including its "Transfer rule" paragraph.
- Git (read-only):
  - `git diff --stat ce6d627 326f5f5 -- zcode-proxy-src/src`: non-test proxy code differs in `handler.ts` (comment lines only; no non-comment `+`/`-` line), `sse-terminal.ts` (`{ highWaterMark: 0 }` plus a comment) and `runtime/watchdog.ts` (ticket 18, off the response path).
  - `origin/staging/61m3` is 326f5f5 plus one commit adding only `tests/memory/measure-stalled`.
  - `origin/staging/61r` (7b9896f) has the same tree as 326f5f5, so it carries no marker.
- Artefacts `ci-art/t61m/{m1,m2,m3}-{windows,linux}/measure-S1-stalled.{md,json}` and every m3 rotation's `summary.json` (outcome, `procPeak:proxy` with commit, `growth:proxy` with trend, `count:proxy`), plus the `@@JOB` line of the m2 and m3 windows logs.

**Recomputed facts and corrections to the round.**

1. **Confirmed from the per-rotation rows: the m3 windows medians.**
   - WS: stalled 135.7 (133, 136.9, 135.7). Floor 55.2. Drained 140.4 (140.4, 143.1, 140.3), and its floor is 54.9.
     - Excess 80.5, (iii) 85.5, (i) 12 (stalled heap 30 − 5, drained 18 − 5).
     - Residual −17, which is −21.1 % of the excess: **not accounted**.
   - Commit: stalled 304.8, floor 185.9, drained 300.1 with its floor 181.2.
     - Excess 118.9, (iii) 118.9, (i) 12.
     - Residual −12, which is −10.1 %: accounted.
   - The other two transfer conditions are met: stalled WS median 135.7 ≤ 250, and commit maximum 307.9 < 512.
   - Same conditions as m2: Node v26.13.0 and the jobobject cap (`@@JOB applied=1`, limit 3 GiB).
2. **Per rotation (information only; the rule is the median form, Round 32 condition 1).**
   - WS residual shares: −15.6, −23.4 and −19.9 %. Two of three rotations would pass. This mirrors m1, where the medians failed at +21.3 % and Round 32 held them as not accounted.
   - Commit residual shares: +6.9, −15.4 and −12.7 %.
3. **The miss comes from the drained reference, not the stalled arm.** From m2 to m3:
   - stalled WS median rose by 3.3 (132.4 → 135.7);
   - drained WS median rose by 13.0 (127.4 → 140.4);
   - (i) rose by 3 (9 → 12).

   m2's own drained rotations spread over 124.5–149, so m3's drained values (140.3–143.1) lie inside m2's range. With n = 3, the drained shift cannot be separated from runner variance. In all three m3 rotations the stalled WS peak is below its drained reference, by 7.4, 6.2 and 4.6 MB. On commit, stalled minus drained is +4.7 MB (m2: +3.4).
4. **The rule is two-sided, and that was pre-registered on purpose.**
   - The code reads `Math.abs(residual) <= STALLED_ACCOUNTED_SHARE * Math.abs(excess)`. The header comment says "within ±20 % (Round 12 Q3 condition 1)".
   - Round 12 Q3 criterion 1 itself says "within ±20 %".
   - Ticket 61's round-2 entry states the rule as "|(ii) residual| ≤ 20 %, fixed in the mode before the run".
   - Round 32 recorded it as `|residual| ≤ 0.2 × excess` and said it "is not reinterpreted".
   - The tool's "no" is therefore the pre-registered reading. It is not a coding accident.
5. **The rerun was due.** By its letter, Round 32 condition 3 names four files, and the non-test code of all four equals ce6d627's apart from the comment. The rule's own example, though ("if tests (a)–(c) force a code change"), happened: test (c) forced `sse-terminal.ts`, which sits on the `/v1/messages` stream path. Round 32's Shared understanding branch 1 says: "If the response path changes before merge, condition 3's rerun decides." I do not now fall back on the four-file letter. Choosing the gate after seeing the result would be the same post-hoc move as the one-sided reading.
6. **Not in the round: m3 linux.**
   - RSS: stalled 152.1 (148.2, 152.1, 161.9), drained 120.6, floor 62.9. Excess 89.2, (iii) 57, (i) 10, residual **+22.2, which is +24.9 %: not accounted, on the positive side.**
   - Earlier runs: m2 linux +15.3 / 80.8 = 18.9 % (accounted); m1 linux 21.1 % (not accounted).
   - Round 32 condition 3 gates windows only, so linux does not decide this question. It is still a record:
     - the stalled median is +7.8 MB over m2 (144.3) and −28.9 MB under the shipped `tee()` tree m1 (181);
     - the local linux runs on 5a8ad97 read 143.5 / 148.7 / 151.8.
   - All six m3 linux rotations are GREEN, with count 1. Their `growth:proxy` values:
     - stalled 0.76, 1.88, 3.07 %/1k, trend false in all three;
     - drained 0.59, 0.72, 1.1, trend false.
   - All six m3 windows rotations are GREEN, with growth −0.35 to 0.39 and trend false.

---

## Q1 — does the m3 rerun satisfy Round 32's transfer rule?

**DECISION:** **REJECTED as worded.**
- **The rule.** m3 does **not** satisfy Round 32 condition 3. Under the unchanged, pre-registered two-sided rule, windows WS is not accounted (−21.1 %). Commit is accounted (−10.1 %), and the ≤ 250 WS median and < 512 commit conditions are met.
- **The one-sided reading** ("residual ≤ +20 %") is rejected. So is recording m3 as "accounted (one-sided)".
- **The record.** m3 is recorded only as "not accounted under the pre-registered rule (WS −21.1 %, rotations −15.6/−23.4/−19.9; commit −10.1 %, accounted), with a negative residual: the stalled WS peak is below its drained reference in 3 of 3 rotations".
- **Ticket 61's fate.** Round 32 condition 3 says 61 then "comes back with all values", and this round is that return. I decide that **61 goes to its pre-merge run (staging/61r) and merges only if that run meets Round 32 condition 4 in full.** This is a stated departure from Round 32 condition 3's first bullet (windows WS "accounted" before merge), for ticket 61 only.

Binding conditions:
1. **Records, with no retroactive change.**
   - `STALLED_ACCOUNTED_SHARE`, the `Math.abs` form and the median rule stay as they are.
   - Both failing runs stay recorded as failures of the rule: m1 (+21.3 % WS, +27.5 % commit) and m3 (−21.1 % WS).
   - The cause of the negative residual is recorded as a hypothesis, not as an attribution. Under backpressure, the stalled arm no longer carries all of the drained arm's in-flight native bytes, so (iii) can over-explain the stalled excess. Fact 3 (the drained shift sits inside m2's drained range) is the measured part.
2. **No further rerun.** Round 32 condition 3 allowed one rerun ("nothing is rerun beyond that one run"), and this departure does not add a second one. Changing the rule to fit m3 is ruled out, and so is calling it a "methods fix" now. If anyone wants the rule changed for future tickets, that needs its own round, and the change applies only to runs started after it.
3. **Pre-merge gate unchanged and binding.**
   - Round 32 condition 4 applies in full on staging/61r (tree equal to 326f5f5, no marker), on both legs:
     - windows S1/stalled GREEN at ≤ 250 WS and < 512 commit, with no `expected-red.json` entry;
     - linux S1/stalled GREEN;
     - S1/short (windows under ticket 71's rule), S1/burst1/4/16/32, S1/bigbody and S7 (except ticket 33's name) not regressed;
     - every other job GREEN.
   - Round 32 condition 5 also applies: S1/burst4 GREEN on both legs.
   - Any RED comes back to an Owner Proxy round with its values. Nothing is rerun, and no signature applies. 61 merges alone and can be reverted alone.
4. **Linux record (fact 6).**
   - The m3 linux bucket table, with its +24.9 % not-accounted residual, goes into 61's Comments and METRICS beside m1 and m2. It does not gate this decision.
   - The six m3 linux `growth:proxy` values, with run 42585293731, tree 326f5f5 and trend false, go into ticket 79's record next to m1 and m2 (Round 32 condition 6).
   - **Trigger, pre-registered now.** If the pre-merge linux S1/stalled peak is above m1's 181, that is a criterion-3 "HWM regression". It comes back even if GREEN.
5. **Drained-arm watch.** The m3 drained WS median (140.4) sits above m2's (127.4) and below the shipped `tee()` tree's (157.4). The pre-merge S1/short and S1/burst* items are the regression check for readers that keep up. Nothing more is added.
6. **No precedent, again.** This departure covers 61 only. Its ground is narrow and stated: the failing statistic fails on the side that cannot carry stalled-specific memory, while every Round 32 basis-for-shipping measure holds on the shipping tree. Any other ticket that fails a pre-registered accounting rule, on either side, gets its own round.

**Rationale:** The rule was pre-registered as two-sided, and the evidence shows it was meant that way. Round 12 Q3 wrote "±20 %". The code takes `Math.abs` and cites that line, and the code was unchanged since before m1. Ticket 61 restated it as "|(ii)| ≤ 20 %", and Round 32 refused to reinterpret it even when the reinterpretation would have helped 61. Reading it as one-sided now, after a result that fails only the lower bound, is exactly the after-the-fact reinterpretation that pre-registration exists to stop. The brief requires me to reject a recommendation that conflicts with an earlier decision, so the recommendation's reading and its dual record are rejected.

The rule's failure is what sends 61 back; it does not decide 61's fate, and Round 32 left that decision to this round. The transfer rule exists to show that the shipping tree keeps the properties Round 32 shipped on, and every one of them is reproduced at 326f5f5:
- stalled minus drained is −5.0 WS (all three rotations negative) and +4.7 commit, against m2's 5.0 and 3.4;
- (i) is 12 MB, against 9 on m2 and 85 on the `tee()` tree;
- the stalled WS range is 133–136.9, against an archive minimum of 278;
- commit is accounted;
- all rotations are GREEN with no growth trend.

The one statistic that fails, fails because the measured buckets over-explain. A stalled arm that peaks below its own drained reference cannot hold unexplained stalled-specific memory, which is the thing C1 cares about. The miss is driven by the drained reference moving within its own m2 range, and the code change behind the rerun can only remove read-ahead (at most one frame per stream). Holding 61 back would keep a primary-platform RED with no proxy-side alternative (C1, C7) because of a 1.1-point miss on the benign side.

C9 decides it. The stronger measured evidence is a direct same-run comparison of stalled against drained, reproduced across two trees, and a subtraction identity does not outweigh it. Merging alone, behind the full pre-merge gate, is also the smaller and reversible blast radius.

I keep the departure bounded: the rule and both failures are recorded unchanged, there is no second rerun and no precedent, and a linux HWM trigger is added because the round left out m3's positive linux residual.

**Charter:** C1 (bounded response memory by backpressure, no shedding; no stalled-specific memory remains on the shipping tree), C7 (removes the primary-platform windows RED; linux recorded, gated by the pre-merge run, with an HWM trigger), C9 (stronger measured evidence: a direct stalled-vs-drained comparison reproduced on m2 and m3; smaller blast radius: 61 merges alone and can be reverted), §9 (250 WS, 512 commit and the S1 budgets unchanged; the rule is not loosened). Decisions: Round 12 Q3 criteria 1–4 (the "±20 %" kept as written), Round 31 Q2 (binding, since stage 2 ships), Round 32 Q1 conditions 1, 4, 5 and 6 (unchanged) and condition 3 (first bullet departed from for 61 only; "nothing is rerun beyond that one run" kept), PROMPT §7 Phase 4 (no rerun-until-green).

**REVERSIBILITY:** Two-way door. An internal response pipeline behind unchanged contracts, a list deletion and records; 61 merges alone and can be reverted alone. ADR: no.

### Exact text change

**`issues/61-s1-stalled-windows-response-side-memory.md`**, add under `## Comments`:

```
- 2026-11-09 (orchestrator, Owner Proxy round 34, binding): the transfer-rule rerun m3 (326f5f5, run 42585293731) is NOT accounted under the pre-registered two-sided rule on windows WS: residual -17 MB = -21.1 % of the 80.5 MB excess (rotations -15.6/-23.4/-19.9 %); commit accounted (-10.1 %); stalled WS median 135.7 <= 250, commit max 307.9 < 512. The rule (STALLED_ACCOUNTED_SHARE 0.2, |residual|, median form) is unchanged; the one-sided reading is rejected. The residual is negative: the stalled WS peak is below its drained reference in 3 of 3 rotations (by 7.4/6.2/4.6 MB); the drained median moved 127.4 -> 140.4, inside m2's own drained range 124.5-149; the over-explanation hypothesis (backpressured stalled readers carry less in-flight native memory than drained ones) is unproven. 61 proceeds to its pre-merge run (staging/61r) and merges only if Round 32 condition 4 and condition 5 hold in full; any RED comes back, nothing rerun, no signature. This departs from Round 32 condition 3's windows-WS accounting bullet for this ticket only, no precedent, no second rerun. m3 linux (record, not gating): RSS stalled 152.1, drained 120.6, residual +22.2 = +24.9 % (not accounted; m1 21.1 % no, m2 18.9 % yes); a pre-merge linux S1/stalled peak above 181 (m1) comes back as an HWM regression even if GREEN.
```

**`issues/79-linux-s1-stalled-growth-tail.md`**, add under `## Comments`: the m3 linux values of 42585293731 (tree 326f5f5): stalled `growth:proxy` 0.76, 1.88 and 3.07 %/1k, drained 0.59, 0.72 and 1.1, all with trend false, next to m1 and m2.

**METRICS (61's branch):** the m3 windows and linux bucket tables, next to m1 and m2.

**RUNLOG:** this round; m3 not accounted (WS −21.1 %, rule unchanged); the departure from Round 32 condition 3 for 61 only; the linux HWM trigger.

---

## Shared understanding

Open branches I still see:
1. **61's pre-merge run (staging/61r)** can fail a criterion-3 item. Windows S1/short has about a 4 % per-run chance, linux S1/stalled about 0.7 %, and burst4 has a 14 MB margin. Any of these comes back with values. So does a linux S1/stalled peak above 181.
2. **The two-sided accounting rule may not suit backpressured trees.** Its lower bound may test the additivity of the bucket model rather than memory. Any change is a future-only rule round. It does not apply to 61.
3. **m3 linux is not accounted on the positive side** (+24.9 %, stalled +7.8 MB over m2). It is recorded, not attributed; the pre-merge run and the HWM trigger cover it.
4. Round 32 branches 2–6 are unchanged: ticket 79 is due back, the burst4 shift stays flagged, the nature of the m1 residual is unproven, `/v1/responses` and the async bridge still pump eagerly, and Round 31 branches 1–3 still stand.


## Round 35 (2026-11-09) — Ticket 27 teardown and generation-local attribution

Answers copied verbatim from /home/AgentKit/overhaul-tools/rounds/round-35-answers.md. Decision proxy: gpt-6.1-sol high, per current user routing.

# Round 35 — Ticket 27: teardown repair and cache-attribution evidence

**Keep ticket 27 unmerged. Permit a bounded test-only teardown repair and a separate, diagnostic generation-local measurement; neither is merge approval.**

Repository citations below are relative to `/home/AgentKit/wt/overhaul/`. Staged-code citations explicitly name commit `36d9a34c163e221e509abf884e0b693834fb3602`. CI findings are reported evidence from `/home/AgentKit/overhaul-tools/t27-windows-diagnosis-2026-11-09.md`, not checks executed by this proxy.

## Q1 — Ticket 27 disposition and Windows teardown

**DECISION:** ACCEPT the recommendation with limits. Ticket 27 remains unmerged on CI 42614407069. Authorize a test/fixture-only repair that awaits termination of this test's known children and allows a finite, explicitly timed retry of executable-directory removal for EPERM/EBUSY. Persistent removal errors, termination timeouts and unexpected errors must still fail. Preserve compilation, the Windows self-exec assertions and lifecycle checks. Do not skip the test, swallow cleanup failures, kill processes by name, or change production shutdown behavior merely to obtain a passing test.

**Rationale:** The supplied diagnosis records both Windows proxy suites failing in `afterAll` after the compiled assertion passes: 1642 pass, 2 skip, 1 fail per leg. Typecheck/MCP steps after that failure were skipped, not passed (`/home/AgentKit/overhaul-tools/t27-windows-diagnosis-2026-11-09.md:5-9`). The staged test awaits the compiled host and its streams before checking the report, but removes the directory synchronously in `afterAll`; the fixture calls shutdown without awaiting completion (`36d9a34:zcode-proxy-src/src/proxy/solver-process.test.ts:315-335`; `36d9a34:zcode-proxy-src/src/proxy/__fixtures__/compiled-solver-host.ts:15-20`). This supports bounded test teardown work, not a proven explanation of the executable lock. The lock holder remains unverified. Even successful teardown repair would leave the independent cache-memory RED unresolved (`issues/27-solver-child-process.md:40-42`).

**Charter:** C1 (reap children, bounded waits), C2 (production contracts unchanged), C7 (Windows compiled self-exec coverage retained), C9 (small, reversible test-only change). B1–B4 remain binding; no installed-kit changes, secrets or foreign-process termination (`PROMPT.md:215-233`).

**REVERSIBILITY:** Two-way door. Test/fixture-only repair, independently reviewable and revertible. ADR: no.

**Evidence needed before crediting the repair:** Record the chosen retry deadline and process-exit evidence for owned children; demonstrate eventual cleanup and demonstrate that persistent EPERM/EBUSY, timeout and unexpected-error paths still fail. Subsequently run the actual full Windows proxy suites on both configured Node legs, including compilation and self-exec, plus the previously skipped stages and normal cross-platform gates. A focused teardown check is useful evidence, not a substitute for those suites. None was run in this ask.

## Q2 — Minimum honest follow-up for generation-local cache attribution

**DECISION:** EVIDENCE MISSING: the OS-memory delta of the actual generation-owned cache on ticket 27's changed process tree. Authorize the following bounded, pre-registered **diagnostic experiment**, not a production fix or a replacement acceptance gate.

1. **Freeze the measured tree and identify the process that owns each cache.** Use ticket 27's staged code plus only the authorized teardown repair and off-by-default test-only measurement instrumentation. Record exact code/tree, Bun 1.4.2, runner image, caps, isolated HOME and command lines. Restart this evidence set if the S2 path or runtime changes. No measurement marker is merged. Keep the unmodified host-D measurement as the reference arm; the comparison arm performs D against the real `captchaGenerationResources().cdnCache` in the solver generation actually present after the unchanged A–C sequence. Record PID, parent PID, generation ID, initial cache state and every intervening recycle. A separately constructed cache in the child is not evidence about the production generation's cache.
2. **Change placement, not the work.** Both arms run full S2/short, preserving A–E and the lifecycle probes. D remains exactly 600 distinct existing URLs with 256 KiB bodies, the same byte contents and copy semantics, order, disk-tier availability/work, mark/GC schedule and endpoint timing. Execute D once per run, not once in each process. Keep 32 MiB of held bodies, 256 entries, the 256 MiB disk cap and its age rule. No extra warm-up, dummy allocations, added heavy solves, cache-prefill, recycled-until-favorable generation, extra GC or settling delay may manufacture headroom. Any unavoidable difference must be disclosed before execution; a non-equivalent comparison comes back rather than silently counting.
3. **Collect three paired full-S2 rotations per platform as the first diagnostic set.** Each pair contains one unchanged host-D run and one generation-local-D run, fresh isolated runs with identical inputs. Use host/local, local/host, host/local order on Windows and on Linux: six full S2/short runs per platform. This is a bounded repeatability/placement probe, **not** a powered test of ticket 80's small mean shift. Collect every attempt, including failures. Do not stop on the first GREEN or extend the set until it passes.
4. **Report process-local marks, not a subtraction of unrelated processes.** At matching D-start, each 100-put checkpoint and D-end, record host and solver PID/generation, Windows commit and WS, Linux RSS, heap and actual held entries/body bytes. Compute each delta within the same PID/generation, preserving the existing D-end minus D-start definition and units. Also retain raw process samples/peaks and lifecycle observations so host-to-child movement cannot hide aggregate cost. Missing marks, a changed generation, failed work or invalid caps make that comparison invalid, never GREEN. Include same-generation bounds and next-generation reset evidence, and unchanged byte/fetch/freshness replay evidence; logical byte bounds alone do not establish a 64 MB OS-memory result.
5. **Return all values for a new gate decision.** Compare the legacy host delta and generation-local delta to the same fixed 64 MB budget: Windows commit is the deciding Windows metric, with WS reported; Linux uses RSS. Report each result, not just a mean. Generation-local values above 64, inconsistent results, or missing/invalid evidence keep the branch open without naming a cache defect. Even uniformly passing generation-local results establish only the measured workload/placement; they do not retroactively make CI42614407069 GREEN or prove every cold generation stays below 64. A fresh-generation-only probe may diagnose a remaining cold-allocation question, but cannot replace full S2 or count as this experiment's acceptance evidence.

**Rationale:** The current D creates a separate cache in the host after A–C; the staged code confirms the same construction and 600-put workload (`tests/memory/scenarios/s2-captcha-run.ts:95-109`, also read at `36d9a34`). Its verdict uses host D-end minus D-start, Windows footprint/commit and Linux RSS (`tests/memory/scenarios/s2-captcha.mjs:104-112,129-133`). The diagnosis records Windows commit 108→176 MB, delta 68 against 64; WS 32→94, delta 62; Linux delta 52. It reports that A–C moved to the child, while D stayed in the host (`/home/AgentKit/overhaul-tools/t27-windows-diagnosis-2026-11-09.md:15-21`). Ticket 25 already disclosed fresh-process D at 70 MB versus 57–58 in warmed full S2 (`issues/25-bounded-collections-cdn-memory-and-stall-counters.md:65,70`; `DECISIONS.md:3115-3125`). Thus placement/allocator history is a supported hypothesis, not an identified native-allocation cause or a proven cache defect. The actual generation resource accessor and offline fill fixture provide a measurement seam, but the existing fill scene uses different URLs/body contents and is not automatically the identical D workload (`zcode-proxy-src/src/proxy/__fixtures__/solver-backend.ts:16-20,82-89`). Three pairs are enough to demand reproducible process-local observations before deciding the next question; they are not claimed to establish a distribution, a tail probability or merge readiness.

**Charter:** C1 (OS-measured, generation-local bounds and complete process accounting), C2 and B1 (unchanged bytes, workload and lifecycle behavior), C6/B2 (offline fixtures, no live endpoints or secrets), C7 (Windows decides; Linux control), C9 (measure placement first with a small reversible probe). `PROMPT.md:237-257` resource rules remain binding. Future tests/builds must use `/home/AgentKit/overhaul-tools/run-capped.sh`, Bun 1.4.2, isolated HOME and explicit timeout, as required by this ask's developer boundaries; none is authorized in this decision-only session.

**REVERSIBILITY:** Two-way door. Diagnostic instrumentation and a finite evidence set only. ADR: no. Replacing the shipping measurement is **not** authorized here.

## Q3 — Fixed budget, ratchet ownership and ticket 80

**DECISION:** Keep the 68 MB result RED and unowned. Do not re-add `cdn-cache:memory-growth` to expected-RED, assign it to 58, lower cache caps, raise 64 MB, switch the Windows gate to WS, or subtract a guessed allocator allowance. Ticket 27 owns resolving its pre-merge evidence gap, not a new ratchet exemption. Ticket 58 retains only its existing solver names. Ticket 80 retains its separate pre-29-cache attribution question and owns no ratchet name.

Ticket 80's pre-27 dataset cannot settle ticket 27's changed host/child measurement. Do not pool it into the experiment above, infer causation from a favorable result on that tree, or reuse its statistical thresholds to decide process-placement attribution. If the later question is whether 29 adds cost **on the ticket-27 tree**, that requires a separately identified, same-tree cache A/B meeting ticket 80's existing counts and pre-registered verdict, or another explicit future decision. Do not silently enlarge or repurpose the current ticket 80 attempt.

**Rationale:** Round 20 anticipated a phase-order/runtime change making this check RED without a cache-code defect, and required its return as an unowned RED (`DECISIONS.md:3247-3252`). Round 31 keeps the budget, caps, workload and expected-RED unchanged; explicitly excludes 27 from signature (ix); and requires ≥30 Windows runs per cache arm and ≥10 Linux per arm for 80's distinct question (`DECISIONS.md:4959-4998,5000-5021`). Ticket 80 records that its launched measurement tree does not contain 27 and that no pooled verdict exists (`issues/80-windows-s2-cdn-memory-after-29.md:19-21`). Round 25 does not exempt an entire failed run merely because one failure has a signature (`DECISIONS.md:3943-3950,3992-4000`). Round 34's ticket-61-only departure expressly creates no precedent and refuses post-hoc reinterpretation of failed accounting (`DECISIONS.md:5485-5510`). Neither permits calling this result GREEN. The diagnosis's passing lifecycle observations and 193 ms cold start remain positive reported evidence, while solver peak/cost remain RED under 58, with no cap-handshake acceptance (`/home/AgentKit/overhaul-tools/t27-windows-diagnosis-2026-11-09.md:22-23`).

**Charter:** C1 (no concealed memory regression), C7 (Windows commit evidence retained), C9 (same-tree measurements and explicit ownership). Consistent with Rounds 20, 25, 31 and 34; no departure from them is granted.

**REVERSIBILITY:** Two-way door: hold the merge and request evidence. ADR: no. Any future replacement of the gate must explicitly identify the old and new measured processes, preserve the 64 MB requirement and workload, demonstrate sensitivity to known over-budget controls, retain the legacy RED record and return for approval before changing the shipping verdict.

## Checks and limits of this ask

- **Executed output-path check:** `if [ -e /home/AgentKit/overhaul-tools/rounds/round-35-answers.md ] || [ -L /home/AgentKit/overhaul-tools/rounds/round-35-answers.md ]; then printf 'CONFLICT: answers file already exists\n'; exit 1; else printf 'ABSENT: answers file does not exist\n'; fi` returned `ABSENT: answers file does not exist` before this write.
- **Executed revision lookup:** `git -C /home/AgentKit/wt/overhaul rev-parse --verify 36d9a34` returned `36d9a34c163e221e509abf884e0b693834fb3602`. Staged source excerpts were read with `git show`; no code was implemented or reviewed for approval.
- **Not run:** tests, builds, CI reruns, installs, memory experiments or live calls. CI counts and measurements above are attributed to the supplied local diagnosis, not independently reproduced here. Exact native allocation cause and executable lock holder remain unverified. Only this answers file was written.

## Shared understanding

Open branches: test-only teardown repair and its full verification; same-tree generation-local cache attribution; any subsequent, explicitly approved measurement-gate correction; ticket 80's separate A/B verdict. **Ticket 27 remains unmerged.**

## Task-observer notes

None logged: this is a decision subagent; the controller owns task-observer activation and observation records. No observation-log or skill-state writes were made.


## Round 36 (2026-11-09) — Identity evidence and bounded collector design

Answers copied verbatim from /home/AgentKit/overhaul-tools/rounds/round-36-answers.md; Sol high decision proxy under current routing.

# Round 36 — Preserve both RED records; collect identity evidence and design a bounded native-output collector

This is a decision-only result, not code review, implementation approval, merge approval or an owner-confirmed exception. The escalation record expressly grants none of those (`/home/AgentKit/overhaul-tools/workflow-policy-escalations-2026-11-09.md:3-15`).

Citation roots: `I` = `/home/AgentKit/wt/overhaul`; `T57` = `/home/AgentKit/wt/t57`; `T34` = `/home/AgentKit/wt/t34`; `E` = `T57/.scratch/t57-failure-evidence`; `W` = `E/artifact-windows/S5-restart/S5-short-restart-2026-11-09T1527-e88def`; `L` = `E/artifact-linux/S5-restart/S5-short-restart-2026-11-09T1504-598008`. File-and-line references below use these roots. Existing logs are evidence read here, not checks executed here.

## Q1 — Windows S5/restart: execution concurrency is not console-support process count

**DECISION:** **EVIDENCE MISSING for count-policy approval or retrospective harmlessness. REJECT approval of a shipping measurement amendment on the present evidence.** Keep the historical Windows S5/restart RED and ticket 57 not ready. Accept only the proposed design direction: a future measurement may distinguish executable-harness concurrency from console-support processes if identity, ancestry and lifecycle evidence proves the distinction while preserving all footprint and orphan accounting. This answer does **not** change the current role mapping, `count:fake-harness` verdict, budget, expected-RED list or ownership.

Permit narrowly scoped **diagnostic-only artifact instrumentation** to be built and run later by the controller/assigned worker, with the unchanged shipping verdict still evaluated and reported. It may collect the evidence below; it may not make the count check ignore consoles. No tests, builds or Windows runs are authorized in this decision session. Return the diagnostic results for a fresh decision before changing count semantics.

**Rationale:** The preserved Windows samples establish a concrete accounting collision, not two sampled app-server executions: at 2327 ms, bridge 5172 owns Node harness 5928, which owns conhost 1208; at 9374 ms, bridge 5172 owns Node harness 816, which owns conhost 9100 (`W/samples.csv:4-6,13-15`). The sampler deliberately assigns a fixture's console its fixture role, while consoles under kit processes remain kit footprint (`T57/tests/memory/lib/win-sampler.mjs:142-169`). Generic role counting counts every such process (`T57/tests/memory/lib/verdict.mjs:45-59`), explaining the sampled count 2. Windows records only that count as RED; the summary also records 4 starts/20 calls, maxAlive 1, restart gaps 1462/2456/4450 ms and zero after-exit, after-stop and orphan counts (`W/summary.json:20-115,382-405`). Those lifecycle numbers are aggregates, not independently reconstructible raw Windows spawn evidence. The CSV omits creation identities and truncates command display; current artifact upload omits the raw spawn log (`T57/tests/memory/lib/sampler.mjs:324-329`; `T57/tests/memory/lib/win-sampler.mjs:164-169`; `T57/.github/workflows/ci.yml:213-228`). The controller confirmed through this ask's escalation that no additional preserved raw Windows spawn/creation evidence is known. Thus the evidence supports investigation, not an acceptance waiver. Linux's recorded GREEN, count 1, 77.7 MB bridge peak and zero cleanup leftovers corroborate that platform only (`L/summary.json:9-105`).

**Charter:** C1 (bounded actual executions, bounded support processes, complete reaping), C2 (additive records rather than silently changing existing field meanings), C6 (sanitized evidence, no secrets), C7 (Windows proof required), C9 (direct evidence before a reversible change), and PROMPT §9's fixed budgets. Round 12 requires at most one harness child, reaping and bounded respawns, and prohibits a ticket-57 expected-RED entry (`I/.scratch/kit-overhaul/issues/57-mcp-runtime-restart-budget.md:40-47`). Round 7 requires kit-created consoles to remain charged to kit footprint (`I/.scratch/kit-overhaul/DECISIONS.md:1373-1387`). Neither is amended here. Round 34 expressly rejects post-hoc reinterpretation and confines its separate exception to ticket 61 (`I/.scratch/kit-overhaul/DECISIONS.md:5485-5510`).

**REVERSIBILITY:** Two-way door for diagnostic instrumentation and retaining the gate. ADR: no. A later count-method amendment must be explicitly versioned, recorded in spec §1/§18, ticket 57 and DECISIONS, and apply only to runs started after that decision. Historical REDs remain RED; even a diagnostic replay producing a different count cannot overwrite them.

**Smallest acceptable next evidence set:**

1. **Preserve reconstructible identity and lifecycle artifacts.** On one exact candidate tree, capture a sanitized raw `harness-spawns.jsonl` and parent-observed child spawn/exit records, with run token, PID, parent PID, creation identity and timestamps. Preserve the Windows process-table evidence needed to join those records: executable identity/path, sufficient sanitized argv to identify this fixture's `app-server --stdio`, creation time, parent identity and observation time. A basename or numeric parent PID alone is insufficient; account for PID reuse and the parent exiting between polls. Retain console ownership after parent exit. The current tracker already uses creation times in memory but the CSV does not persist them (`T57/tests/memory/lib/win-sampler.mjs:89-139,160-169`). A malformed, missing or contradictory record must invalidate the diagnostic classification, never silently remove a process. The fixture's current spawn reducer skips malformed records and keys starts by PID, so its aggregate alone is not this stronger proof (`T57/tests/memory/scenarios/s5-mcp.mjs:25-45`).
2. **Keep both accounting views.** Preserve every original process row, fixture/kit ownership, commit/WS, peaks and survivors. Report a separate diagnostic executable-concurrency value and console-support count/footprint. A fixture console stays measured with its fixture; a console owned by a kit process stays charged to kit totals. Nothing becomes tooling merely because it is conhost. Specify the supported helper-count/lifecycle rule rather than introducing an unlimited helper allowance. Unavailable ancestry/command evidence must remain visible and block a favorable classification. Keep after-exit/after-stop and zero-orphan checks sensitive to helpers as well as harness executions; they must not inherit an execution-only filter.
3. **Prove sensitivity with adversarial controls on Windows and Linux where applicable.** One authenticated fixture execution plus its console yields one diagnostic execution, but two measured processes and their full footprint. Two simultaneous real harness executions must remain RED at concurrency 2, including when short-lived between ordinary polls. A console surviving its parent must remain discoverable and fail the applicable cleanup/zero-orphan check. Kit-owned console memory must remain in kit totals. Include PID-reuse, missing-argv/ancestry and malformed/missing-lifecycle-record controls. These are required future proofs, not passed checks in this ask.
4. **Preserve the artifacts in CI and return the whole result.** Extend the diagnostic artifact set beyond today's summary/samples/run logs to include the raw spawn log, sanitized identity/ancestry records and control results; do not upload bridge task stores, environments or credentials. Record candidate and tested merge SHA, runner image, Node/Bun versions, cap mode, isolated HOME and exact commands. Run the existing K≥20 S5/restart workload with unchanged verdict, fixed 150 MB bridge peak and 3/900 restart policy, preserving all attempts and both old and diagnostic results. Return these records before a shipping amendment. After any later amendment, fresh full central platform gates remain required; targeted evidence is not the full memory job.

The separate Windows log test is still an acceptance gap, not a resolved kernel-semantics claim. Preserved CI failed `expected false / received true` at the old test's line 266 (`E/windows-node26-api.log:1872-1890`). The candidate retains the Windows FILE_SHARE_DELETE assertions and puts holder acknowledgement before filling the file (`T57/zcode-proxy-src/src/log/proxy-log-serve.test.ts:257-297,319-328`), but its recorded local targeted run explicitly skips that Windows case (`I/.scratch/kit-overhaul/reports/t57-repair-merged-targets.log:5-18`). Require the actual Windows regression and centrally owned full gates on the eventual candidate; Linux targeted GREEN does not satisfy them. This is not approval of the repair code or proof of the historical failure's exclusive cause.

## Q2 — Early native output: reject a checkpoint cap as the original hard bound

**DECISION:** **REJECT worker option 1 as satisfaction of the existing contract. Choose option 2 for design work only; keep option 3 as ticket 34's implementation/acceptance status until that design is decided.** Request the smallest bounded cross-platform pipe/collector design that can enforce the existing early-file bound independently of proxy JS progress. No collector architecture, runtime copy-owner change or implementation is approved here. Do not add an eventual/periodic interpretation, a supported-native-chunk assumption, larger overshoot, budget exemption or expected-RED entry.

The design may propose a precise, future-only amendment to the mechanism/ownership clauses, because a collector changes direct inherited-file stdio and the runtime copier. It must retain the hard size bound and pre-truncation diagnostic preservation. The current requirement that the **manager** copies before every nonempty truncation is not silently reassigned to the proxy or collector. Return the exact proposed ownership amendment and failure semantics for decision before implementation. No contract departure is granted by this round.

**Rationale:** The written contract combines direct inherited-file stdio, proxy-writer size checks and manager-owned tail copying before every nonempty truncate (`I/.scratch/kit-overhaul/spec.md:402-406`; `I/.scratch/kit-overhaul/DECISIONS.md:779-786`). The current writer checks synchronously only before JS writes and replaces JS stream methods, not native fd writes (`T34/zcode-proxy-src/src/log/proxy-log-writer.ts:110-124,147-177`). The manager passes the early-file fd directly to stdout/stderr, detaches the proxy, and closes its own fd when startup succeeds (`T34/lib/proxy-lifecycle.mjs:1208-1236,1293-1305`). Its bounded positioned-read tail-copy code is a per-start/failed-start path, not an ongoing runtime manager service (`T34/lib/proxy-lifecycle.mjs:830-864,1287-1291`). The preserved probe records a 2,097,152-byte native write and peak/final early-file size of 2,097,152 against 1,114,112 bytes (1 MiB + 64 KiB), with rc 0 (`I/.scratch/kit-overhaul/reports/t34-native-burst.log:1-2`). Its source performs native `writeSync(1, ...)` and then blocks the main thread for one second (`/home/AgentKit/overhaul-tools/t34-native-burst.mjs:12-33`). This is a feasibility counterexample for direct-file plus check-time enforcement, **not** a RED acceptance test against a completed cap implementation or a proof that every collector is impossible (`/home/AgentKit/overhaul-tools/t34-decision-brief.md:13-28`). A faster polling timer cannot prevent an arbitrary single direct write's transient overshoot. A collector needs bounded writes before disk growth, not retrospective polling.

**Charter:** C1 (bounds enforced throughout ingestion, bounded queues/processes, reliable cleanup), C2 (startup/crash diagnostics and golden-path behavior retained), C4 (standard-library-first; measured cost for additional runtime machinery), C6 (redaction and restricted files), C7 (Windows is the deciding platform, Linux/macOS must not regress), C8 (truthful documented contract), C9 (measure the smallest credible design before expanding lifecycle surface). PROMPT §9 and B1–B6 remain binding. Ticket 34 owns no expected-RED name and still owes the early-log bound (`I/.scratch/kit-overhaul/issues/34-early-log-cap-and-tail-copy.md:13-20,37-39`). Ticket 25/Round 20 is the relevant precedent: a logical held-byte bound is not the measured resource bound; shrink/change the mechanism rather than reinterpret the budget (`I/.scratch/kit-overhaul/DECISIONS.md:3115-3119,3168-3175`). Round 35 again preserves a failed measurement pending new evidence (`I/.scratch/kit-overhaul/DECISIONS.md:5594-5604`). None authorizes weakening this log contract.

**REVERSIBILITY:** Two-way door for a design brief and keeping ticket 34 blocked. ADR: no for this hold. A shipping collector/process-lifecycle or copy-ownership contract that is hard to reverse requires **ADR: yes** before adoption, naming exactly which Round 3/spec clauses it supersedes. Truncating diagnostic data is itself irreversible; failure to preserve the required tail cannot be treated as successful truncation.

**Smallest acceptable next design and evidence:**

1. **One bounded ingestion boundary, with an explicit proof argument.** Propose one logical collector per proxy generation, not one per stream/session, with exclusive authority over early-file writes/truncation. Native stdout/stderr must not retain a direct writable early-file fd that bypasses it. State finite OS-pipe capacity, read/write chunk bounds, user-space queue and fresh-copy tail limits, and the invariant preventing file growth beyond 1 MiB + 64 KiB before every append. Partial writes, simultaneous stdout/stderr, Unicode/binary input and long unbroken records must not create whole-output buffering or retained giant parent buffers. Choose no numeric process-memory allowance by guess; return measured costs against existing budgets.
2. **Settle copy ownership and diagnostic security explicitly.** Map manager startup, healthy runtime, failed start, respawn, crash and next-start truncation. State who serializes tail capture, marker append and truncation; who remains alive after the manager exits; and how exactly the last fresh 64 KiB reaches `proxy.log` before each nonempty truncate. Identify coordination with its existing single rotator and concurrent manager/watchdog appends. Preserve mode 0o600/dir 0o700 and C6 redaction, including secrets split across chunks. Show the bounded response to append/truncate failure or an unavailable `proxy.log`; do not discard the only cause, grow an unbounded spill file or claim both preservation and a hard bound without a failure policy. Return any required compatibility tradeoff rather than deciding it in code.
3. **Define bounded backpressure and lifecycle behavior before selecting a helper.** Compare the smallest viable placement, including any long-lived helper/manager cost, with no unbounded buffering or helper respawn storm. Specify pipe-full, hung proxy, blocked collector, collector crash, proxy crash, shutdown/update and inherited-handle closure behavior. Explain how diagnostic backpressure avoids deadlocking the watchdog/graceful-stop path and how every owned helper is reaped. A platform file-limit alternative is acceptable only with supported-platform proof and explicit native-write failure behavior; a Linux-only limit is not a Windows solution. No new external service or dependency is assumed.
4. **Return a measured feasibility package, not merely a final stat.** A later controller-owned, capped offline experiment must preserve the existing 2 MiB native-burst counterexample and exercise writes larger than the cap, sustained concurrent streams, JS hangs, abrupt proxy/manager/collector exits, restart/start-failure paths and Windows held-file/error paths. Supply a write-bound argument plus external peak observations; finite polling alone cannot prove absence of transient overshoot. Verify tail/marker-before-truncate ordering and golden-path cause visibility, malformed/split-secret redaction, permissions and zero surviving helpers. Record exact tree/commands, supported Windows source/compiled behavior, Linux control and macOS verification status. Measure collector/parent commit, WS/RSS, peak aggregate kit cost, process count, CPU, startup latency and backpressure impact against unchanged S3/S4/S7 and other affected gates. All later tests/builds/installations use `run-capped.sh`, Bun 1.4.2, isolated HOME and explicit timeout. Return the design and results for a fresh decision before product implementation.

The ordinary S7 check currently reads one final early-file size and allows 64 KiB overshoot; passing that checkpoint alone cannot establish an unconditional bound (`T57/tests/memory/scenarios/s7-disk.mjs:63-80`). Existing independent per-start copy/mode work may remain separately scoped, but this answer neither reviews it nor marks ticket 34 complete. A collector proposal unable to meet the fixed bound or existing safety budgets returns blocked, not as an implicitly accepted checkpoint contract.

## Checks and limits of this ask

- Executed absence check before writing: `if [ -e /home/AgentKit/overhaul-tools/rounds/round-36-answers.md ] || [ -L /home/AgentKit/overhaul-tools/rounds/round-36-answers.md ]; then printf 'CONFLICT: answers file already exists\n'; exit 1; else printf 'ABSENT: answers file does not exist\n'; fi` returned `ABSENT: answers file does not exist`.
- Executed revision lookups: `git -C /home/AgentKit/wt/t57 rev-parse HEAD` returned `8b69c550a7bcb24ae8d6ca53c7e1c1eef6ca7849`; `git -C /home/AgentKit/wt/t34 rev-parse HEAD` returned `cd984acfca99082474f93639fccc351c2fe8f756`.
- Read-only artifact enumeration found a raw spawn log only under `E/local-merged-s5/S5-short-restart-2026-11-09T1635-d15b12/`; its eight lines record four Linux start/exit pairs, not the missing Windows evidence. The escalation response confirmed no other known preserved source. No historical identity proof is inferred.
- **Not run:** tests, builds, installations, memory experiments, CI reruns, network/live calls or full acceptance gates. Worker command outcomes and preserved log measurements are attributed evidence only. Only this answers file was written; no repository, observation log or skill state was changed. The controller owns task-observer.

## Shared understanding

Open branches: prospective S5/restart identity/lifecycle diagnostics under the unchanged verdict; a later explicit future-only count-method decision; repaired-candidate Windows log/full central acceptance; bounded native-output collector feasibility and explicit copy-owner contract. Ticket 57 remains not ready; ticket 34's cap remains blocked. Next: the controller assigns the diagnostic-artifact brief and collector-design brief without changing either shipping gate.


## Round 37 (2026-11-09) — Prove native-preflight death before replacement

Answers copied verbatim from /home/AgentKit/overhaul-tools/rounds/round-37-answers.md; Sol-subagent xhigh decision proxy under current routing.

# Round 37 — Prove native-preflight death before replacement

**Keep ticket 35 blocked. Develop an identity-bound startup/lifetime protocol inside the existing native preflight; do not ship the current age/dead-host takeover.** This is a Charter decision about direction and required evidence, not implementation, code review, merge approval or a user-approved exception. The escalation explicitly withheld schema/handshake approval and every concurrency/bounded-wait waiver (`/home/AgentKit/overhaul-tools/workflow-policy-escalations-2026-11-09.md:17-23`).

Citation roots: `I` = `/home/AgentKit/wt/overhaul`; `T35` = `/home/AgentKit/wt/t35`; `X` = `/home/AgentKit/overhaul-tools`. Paths below use these roots. Existing logs are evidence read during this ask, not checks executed during it.

## Q1 — Lifecycle direction under the existing guarantees

**DECISION:** **ACCEPT the recommended handshake + durable identity-bound registration + parent-pipe/OS-lifetime direction for further design and offline feasibility work only. EVIDENCE MISSING for a shippable protocol. REJECT age alone, dead host alone, PID-only child registration, and fail-closed bookkeeping alone as a complete solution.** Ticket 35 is not ready to merge.

The unchanged invariants are ≤ 1 concurrent native OMP preflight process, bounded in-host waiting under `START_TIMEOUT_MS`, killed-starter recovery, no kit-module imports into the long-lived host, no new native waiter/helper process, and ≤ 5 MB per waiter host. The process limit includes a native preflight sitting in bootstrap or waiting for activation: moving its imports later does not make that process free. The direction must preserve reaping and existing footprint/role/file bounds, not merely serialize kit execution (`I/docs/adr/0013-launcher-handover-and-single-flight-preflight.md:14-16`; `I/.scratch/kit-overhaul/spec.md:639-655`; the ask's explicit prohibition on a new waiter process).

**Rationale:** The draft protects a token naming only the host, but launches the child separately. `T35/proxy/zcode-proxy-autostart.ts:37-45` defines host-only identity; `:104-113` treats age or host ESRCH as stale; `:115-128` can remove that token; `:201-216` launches native preflight with an independent timeout. The offline regression actually starts two children and records overlap after advancing the host clock (`T35/tests/auto-heal.test.mjs:514-542`). Its preserved log reports 0 passed, 1 failed, `actual: true`, `expected: false`, Bun 1.4.2 and rc=1 (`I/.scratch/kit-overhaul/reports/t35-red-expired-live-child.log:1-9,15-35,51`). That is sufficient to reject age as child-death proof. It does not execute host-only death. Existing S3 deliberately kills the host's whole tree, using a POSIX group kill or Windows `taskkill /T`, so that scenario cannot prove recovery while a child survives host-only death (`I/tests/memory/lib/omp-host.mjs:29-36,72-76`). The decision brief distinguishes all three timelines, including host death between spawn and publication (`X/t35-decision-brief.md:18-28`).

Binding design requirements:

1. **Reserve before spawn; activate only after durable binding.** Specify an exclusive attempt reservation and explicit pending-spawn, registered, activated, retiring and exited states, or equivalent states with the same proofs. The one existing native preflight starts in a bounded, standard-library bootstrap, unable to import or execute kit preflight logic until its exact process identity is durably bound to the reserved attempt and activation is authorized. Bind installation, protocol version, attempt nonce and reliable host/child creation identities; numeric PID alone is insufficient. Publication/acknowledgement must tolerate crashes and partial I/O. An inherited, attempt-bound channel must reject wrong/stale activation. This is a protocol requirement, not an approved token schema. The current `cli/heal.mjs` statically imports kit modules before its body (`T35/cli/heal.mjs:5-18`); adding a handshake after those imports would not satisfy the bootstrap boundary.
2. **Close the spawn-to-registration gap for process count as well as execution.** If the host dies after spawn but before identity publication, absence of a child field is UNKNOWN, not proof of no child. Child self-registration, READY/GO or a late-written PID can prevent unregistered kit execution but do not by themselves prove that no bootstrap process remains. The design must identify an OS-owned lifetime/containment or other verified existing-process/channel mechanism that lets a subsequent contender resolve this pending attempt without spawning a second native preflight, importing kit modules in-host or adding a helper. Show the ordering argument for death immediately before and after each publication step. If the mechanism cannot resolve pending spawn, keep recovery blocked; do not call permanent quarantine a completed recovery protocol (`X/t35-decision-brief.md:22-28`; `X/workflow-policy-escalations-2026-11-09.md:19`).
3. **Bind lifetime after activation too.** Define behavior for host-only death, pipe EOF, stalled host, stalled child and termination delay. Parent-pipe EOF is a candidate cooperative signal, not demonstrated OS-enforced termination. A blocked child may not process EOF; a host timer may not run on schedule. Windows Job Object or POSIX parent-lifetime mechanisms are candidates requiring platform proof, not facts established here. Specify handle inheritance/closure, nested-job or platform failure behavior, who owns termination and how identity-bound exit is acknowledged. Preserve the intended proxy's ownership/lifetime; do not assume killing a preflight's entire descendant tree is safe. No foreign or unverified PID may be signaled (`I/.scratch/kit-overhaul/PROMPT.md:122-130,225-230`; `X/t35-decision-brief.md:20-28`).
4. **Replace only after proof; bound the caller separately.** Token expiry, host death, a requested kill, a successful health check, missing/corrupt diagnostics and a timeout are not child-exit acknowledgements. Reclaim only after proving that the exact prior native preflight is absent/exited, or that no child could have been created under the resolved reservation. Serialize reclamation and revalidate attempt identity so delayed cleanup cannot remove a successor. Live-child, unresolved registration, unreadable identity or failed containment stays fail-closed: no replacement spawn. Return the bounded timeout/failure diagnostic rather than extending the waiter deadline, starting a private fallback preflight or busy-looping. Recovery must subsequently become possible through the proven lifetime-resolution path without speculative age takeover. Use a monotonic elapsed-time basis for local waiting and test wall-clock changes; record freshness is a separate validation question. Do not claim an in-host timer can run while its own event loop is blocked.
5. **Retain diagnostics without treating them as lifetime authority.** Keep Round 4's attempt-matched, timestamp-validated, bounded result record, write-before-release ordering and fixed vocabulary. Missing/corrupt/oversized records still mean starter failure, but any retry is subject to child-death proof. A crash cannot be assumed to execute `finally` or publish a result. Define crash and publication-failure behavior explicitly; do not claim a dead starter's unpublished warning was delivered. Preserve mode `0o600`, logs-directory protection, ≤ 4 KB/≤ 16 lines, one fixed-name result file and the S4 file count, including bounded cleanup of protocol intermediates (`I/.scratch/kit-overhaul/DECISIONS.md:959-965`; `I/.scratch/kit-overhaul/spec.md:344-350,401,655`).

**Charter:** C1 (one preflight, bounded processes/memory, reaping and no restart storm), C2 (compatible startup and diagnostics), C3 (actionable bounded failure), C4 (no assumed dependency/helper), C6 (identity, restricted records, no secrets), C7 (Windows first, no Linux/macOS regression), C9 (counterexample outranks token-age inference). B1–B6 and existing budgets remain binding (`I/.scratch/kit-overhaul/PROMPT.md:120-170,215-255`).

**REVERSIBILITY:** Two-way door for the design/prototype direction and merge hold. **ADR: yes before shipping the lifecycle protocol**, by amendment to ADR-0013 as specified in Q2. No additional resident helper is approved.

## Q2 — Required amendment and remaining design decision

**DECISION:** **ADR-0013 needs an explicit lifecycle amendment and ticket/spec/seam corrections. Additional design is required before product implementation.** This is not merely an implementation detail of the existing host token.

This answer **explicitly supersedes the sufficiency of age/dead-host takeover** in ADR-0013 condition 2 and the unconditional fallback inference in its Round 4 condition-3 amendment (`I/docs/adr/0013-launcher-handover-and-single-flight-preflight.md:14-15,38`). Corresponding text is in ticket 35's What-to-build/adversarial criteria (`I/.scratch/kit-overhaul/issues/35-omp-single-flight-preflight.md:13,20`) and spec §6(a) (`I/.scratch/kit-overhaul/spec.md:340-350`). Those clauses currently allow a new preflight after token expiry/dead host without child-lifetime proof; Q1 disallows that transition. The guarantees themselves are not superseded. Missing diagnostics remain failure, but no longer authorize immediate spawning while the prior process may exist.

The controller should record the amendment with the required attribution, “Decided by Owner Proxy under Charter v1 on behalf of the owner.” It must state the changed takeover predicate, literal process-count scope, bounded failure/recovery semantics and crash/publication ordering. It must also carry a versioned interoperability table for current/older token formats, concurrently loaded extensions, update/rollback and refresh through `setup`/`integrate`. Unknown records are not automatically deleted. The old-extension compatibility provision remains a compatibility obligation, not evidence that old extensions obey a new token. ADR-0013 already says old extensions keep spawning preflights (`I/docs/adr/0013-launcher-handover-and-single-flight-preflight.md:15`); the manager lock serializes proxy startup, not all preflight processes. Do not claim mixed-version max1 without proof or silently narrow the existing guarantee. If mixed-version behavior cannot meet the required scope, return that concrete incompatibility for a decision before implementation.

The next design package must choose one supported lifetime mechanism per platform, identify the pending-spawn resolution primitive, give a transition/proof table and report feasibility measurements. This round selects the direction and safe takeover predicate; it does **not** select an unverified OS API, token layout or bootstrap implementation. Return that package for a fresh Charter decision before adopting product lifecycle changes. A separate new ADR is not needed merely because the amendment is detailed; a distinct hard-to-reverse mechanism would need its own record if the later design warrants one (`I/.scratch/kit-overhaul/PROMPT.md:112-118`).

**Rationale:** Host liveness and child liveness are different facts. Round 4 inferred max1 from token ownership and result publication (`I/.scratch/kit-overhaul/DECISIONS.md:959-969`); the preserved overlap contradicts that inference, not the reason for the guarantee. An explicit amendment prevents implementers from simultaneously following “take over an old token” and “never overlap a live preflight.” Round 36's precedent is to retain a failed record and request a bounded design with exact prospective mechanism changes, not reinterpret a guarantee after failure (`I/.scratch/kit-overhaul/DECISIONS.md:5654-5669`). It does not authorize reusing its separate collector/helper proposal for ticket 35.

**Charter:** C1, C2, C7, C8 (truthful contracts), C9; ADR-0013 and Round 4 Q2 as explicitly amended above. Round 17 Q4's 5 MB gate is unchanged.

**REVERSIBILITY:** Two-way door before release for the amendment/design; versioned on-disk interoperability becomes harder to reverse once deployed. **ADR: yes**, amend ADR-0013 before adoption, with exact superseded clauses and compatibility behavior. No repository edits are made by this decision proxy.

## Q3 — Facts and prototype evidence required before shipping

**DECISION:** **EVIDENCE MISSING. Require the following feasibility package before the fresh design decision; require actual candidate acceptance afterward.** No current GREEN, helper assumption or escalation is a substitute.

1. **A supported-platform lifetime fact, demonstrated offline.** Establish whether the existing Bun 1.4.2 host and pinned native runtime can reserve, spawn, identity-bind, activate and resolve a child after host-only death, including the unregistered interval, without a new process or kit imports in-host. Provide platform API contracts and an executable isolated prototype, especially on Windows, plus Linux control and explicit macOS verification status. Demonstrate reliable creation identity, crash-safe publication and exit observation after the spawning host is gone. Prove what happens when permissions, containment assignment or identity lookup fail. A child receiving EOF in an ordinary cooperative run is not proof of bounded teardown during a child hang. Neither this ask nor the supplied brief establishes these facts (`X/t35-decision-brief.md:24-30`).
2. **Adversarial process-level proof, not just sampled counts.** Preserve the existing expired-live-child regression and its historical RED. Exercise live expired host with live child, forward/backward wall-clock changes, host-only death with an initially surviving child, and death at every reservation/spawn/registration/activation/retirement boundary. Include child stalls that prevent ordinary JS callbacks, delayed/ignored termination, PID reuse, partial/unknown records, publication failure and racing contenders/late cleanup. Trace child spawn and confirmed exit with attempt-bound creation identities, retaining all bootstrap processes and short-lived overlaps. Show no second native preflight exists before the old one exits and show killed-starter recovery completes through the selected mechanism. Retain existing five-host and killed-tree tests; add host-only tests rather than relabeling tree kill. The current checker describes ≤1 alive “at any moment,” so merely missing overlap between polls is not sufficient (`I/tests/memory/lib/omp-leg.mjs:3-24`; `I/tests/memory/lib/omp-host.mjs:72-76`).
3. **Bounded diagnostics, resource cost and interoperability.** Demonstrate bounded host waits, no kit-module imports in-host, zero new waiter/helper processes, bounded bootstrap/pipe/record buffering, zero orphaned native preflights and no retry storm. Record host/child handle cleanup, startup latency, CPU, per-role and aggregate memory, file counts and every host's cause lines/classification. Exercise mixed-version tokens/extensions and double transactional refresh. Keep all original S3/S4 role/aggregate budgets; host memory remains reported and gated, not discarded because it is excluded from aggregate kit footprint (`I/.scratch/kit-overhaul/spec.md:339-351,639-655`; `I/.scratch/kit-overhaul/issues/35-omp-single-flight-preflight.md:17-21`).
4. **Unchanged Windows waiter gate on the eventual candidate.** After lifecycle design is decided and implemented, execute ≥10 fresh matching Windows S3/omp runs, preserving every `summary.json`, `samples.csv` and command log, every host's `costMB`, `wsCostMB`, preflight/killed classification and cause lines. Compare each waiter's commit cost and remaining margin against ticket 71's recorded no-op floor distribution, including its maximum, without substituting a median or subtracting an invented noise allowance. METRICS records 20 Windows commit values with maximum 2.49 MB, an earlier 2.55 MB result, and an explicit roughly 2.5 MB floor-tail warning (`I/.scratch/kit-overhaul/METRICS.md:473-484`). The known historical tail must remain visible; do not select a lower floor by convenience. Any waiter >5 MB on commit, or no positive margin under the existing floor-maximum-plus-waiter comparison, returns with numbers. Round 17's exact rule remains binding (`I/.scratch/kit-overhaul/DECISIONS.md:2734-2754`). The brief names the future workload: `node tests/memory/run.mjs S3 --profile short --variant omp --out <isolated-artifact-dir>/t35-windows-<1..10>` (`X/t35-decision-brief.md:36-40`). No repetitions were run here.
5. **Retain ratchet ownership until evidence, then fresh central gates.** Both Linux and Windows ticket-35 `omp:concurrent-preflights` names remain; ticket 37's peak names remain untouched (`I/tests/memory/expected-red.json:15-17,38-40`; also present in `T35/tests/memory/expected-red.json:15-17,38-40`). The controller's existing retention/follow-up policy grants no budget, schema, owners or flips change (`X/workflow-policy-escalations-2026-11-09.md:13-19`). Only after actual lifecycle and Windows gate satisfaction does the branch author remove the two ticket-35 names, followed by fresh central premerge full-suite/memory CI on the tested candidate. All future experiments/tests/builds/installations use the required cap wrapper, Bun 1.4.2, isolated HOME and explicit timeout, with approved disposable Windows isolation; no live model/claim endpoint or installed harness is involved. Targeted prototype success is not full acceptance (`I/.scratch/kit-overhaul/PROMPT.md:85-94,215-255`; `I/.scratch/kit-overhaul/DECISIONS.md:5669`; `X/t35-decision-brief.md:36-40`).

**Rationale:** Fail-closed behavior safely refuses an uncertain attempt today; it does not prove eventual recovery. The missing feasibility fact is specifically how an existing-process/OS mechanism closes the unregistered-child interval while preserving literal max1. Windows cost is a separate missing gate: a lifecycle-safe Linux prototype cannot establish Windows identity APIs, Windows cleanup or its commit margin. Round 36 likewise requires reconstructible creation/lifecycle evidence rather than numeric PID inference or retrospective GREEN (`I/.scratch/kit-overhaul/DECISIONS.md:5633-5648`).

**Charter:** C1, C2, C6, C7, C9; PROMPT §9 fixed budgets; Round 4 cause-channel requirements; Round 17 Q4 unchanged. No approval is inferred from an automated escalation.

**REVERSIBILITY:** Two-way door for evidence collection and keeping the candidate blocked. ADR: no additional ADR for tests/gates; the product lifecycle amendment is Q2. If the feasibility package cannot meet the invariants, return blocked for another decision, not a relaxed gate.

## Checks and limits of this ask

- Executed absence check immediately before writing: `if test -e /home/AgentKit/overhaul-tools/rounds/round-37-answers.md || test -L /home/AgentKit/overhaul-tools/rounds/round-37-answers.md; then printf 'CONFLICT: answers path exists\n'; exit 1; else printf 'ABSENT: answers path does not exist\n'; fi`. Output: `ABSENT: answers path does not exist`; exit 0.
- Executed revision lookups: `git -C /home/AgentKit/wt/t35 rev-parse HEAD` returned `0c41ef79fc7f199b90cf4aee606d3b75d8873c65`; `git -C /home/AgentKit/wt/overhaul rev-parse HEAD` returned `ee93688fb06f3add1a07394ae98f4acb7d837e0b`. These identify checkout HEADs, not a claim that the read draft equals a clean committed tree.
- The brief attributes the preserved RED to `cd /home/AgentKit/wt/t35 && /home/AgentKit/overhaul-tools/run-capped.sh t35-red-expired-live-child 1G 60 -- node --test --test-name-pattern='generated OMP never overlaps' tests/auto-heal.test.mjs` (`X/t35-decision-brief.md:15`). I read the source and resulting rc=1 log cited in Q1. **That command was not run during this ask.** The source/log support the expired-live-host counterexample, not an executed host-only-death test.
- **Not run:** tests, builds, installations, prototypes, S3 repetitions, Windows CI, memory experiments, network/live calls or acceptance gates. OS lifetime feasibility, bounded recovery after host-only death and the eventual Windows waiter gate are unverified. Only this external answers file was written; no repository, installed harness, global config, skill state or observation log was changed. The controller owns task-observer.

## Shared understanding

Open branches: the exact per-platform pending-spawn/lifetime resolution primitive; a measured handshake/registration prototype proving literal max1 and bounded killed-starter recovery; versioned mixed-extension compatibility; the resulting ADR-0013/spec/ticket amendment and fresh design decision; eventual Windows waiter/margin evidence and full candidate acceptance. Ticket 35 stays blocked. Next: the controller assigns a decision-brief/prototype task focused first on host death between spawn and durable child registration, without changing shipping code or gates.
