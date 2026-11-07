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
