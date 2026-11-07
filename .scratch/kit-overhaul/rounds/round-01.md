# Round 1 — Phase 1 picks and the first design-tree frontier

Answers file: `rounds/round-01-answers.md`. Evidence root: `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/`.
Main evidence: `diagnosis/memory-report.md` (§1–§8), `METRICS.md` (Memory baseline), `reports/architecture.md`, `ux/ux-audit.md`, `ux/design-language.md` (§12), `ux/handoff-prototype.md` + `ux/prototype/`, `reports/drift.md`, `research/*.md`.
Every question is worded so "yes" accepts the recommendation.

---

❓ **Q1 - Terminal design variant (1C pick)**: Three prototype variants exist on `prototype/terminal-ux` (d27b890), rendered for every terminal mode under `ux/prototype/{A-ledger,B-cards,C-outline}/`: A Ledger (aligned rows, verdict last, grep-stable `[OK]`/PASS/FAIL), B Cards (boxed verdict/error cards, tile TUI), C Outline (verdict first, why/next tree, passing checks collapsed). Adopt A as the base, plus C's help structure (examples first), C's verdict as the first line of `doctor` when anything failed, and C's sidebar in the TUI at ≥100 columns; boxes only in the TUI header?

➡️ Yes: A + C's help shape + C's failure-first verdict line + C's TUI sidebar ≥100 cols; B only for the TUI header box. Evidence: `ux/handoff-prototype.md`, `ux/ux-audit.md` S1/S2 findings.

---

❓ **Q2 - Architecture candidates to explore (1D pick)**: `reports/architecture.md` lists 8 candidates. Explore #1 solver behind a transport seam in its own OS-capped process (Strong), #2 one proxy lifecycle module with a recoverable start lock (Strong), #3 one bounded-collection module for every growing store (Strong), #4 one terminal output module where producers return records (Strong), #5 one proxy self-supervisor module (Worth exploring; serves the restart-storm and memory-recycle policy) and #7 split `cli/zcode-kit.mjs` into command modules returning outcomes (Worth exploring; it is the CLI prefactor §7 Phase 3 asks for). "Do nothing" for #6 (stream `tee()` rework: 1B refuted stream buffering, 3,000 stalled clients retained nothing) and #8 (MCP runtime restart budget: S5 showed retention, not restarts).

➡️ Yes: explore 1, 2, 3, 4, 5, 7; do nothing for 6 and 8.

---

❓ **Q3 - Captcha solver process model (1B D1)**: RC1: the solver worker retains closed happy-dom windows (~4.1 MB/solve, 958 MB RSS at the 200-solve recycle, 686 MB guest heap retained, per-generation peak 0.9–1.0 GB). Bun cannot hard-cap a Worker or its own heap (`research/bun.md` §Answer 4–5). Move the solver into a separate OS process of the same binary (the compiled binary already contains the `captcha-solver-worker.ts` entrypoint), speaking the existing worker message protocol over stdio IPC, with a hard memory cap the OS enforces: Windows Job Object (`JOB_OBJECT_LIMIT_PROCESS_MEMORY` + `KILL_ON_JOB_CLOSE`, created through `bun:ffi` to kernel32, no new dependency), Linux cgroup v2 via `systemd-run --user --scope -p MemoryMax=` when a user systemd is available, otherwise parent-side sampling-and-kill; macOS parent-side sampling-and-kill (no kernel per-process limit exists). Cap 300 MB, recycle by solve count and by RSS, keep the in-process thread transport only as the test/fallback adapter. `proxy status`/`doctor` report which enforcement mode is active. Solve behaviour, inputs and outputs stay byte-identical (B1).

➡️ Yes: separate capped child process as described; thread transport remains as fallback/test adapter only. ADR: yes (one-way door for the IPC shape).

---

❓ **Q4 - Start lock and exactly-one-proxy (1B D3)**: 1B never produced two proxies (races of 5/10, killed holder, hung proxy), so the lock's exclusion works. But a killed or Ctrl-C'd start leaves a stale lock (5/8 Ctrl-C, every SIGKILL), after which 7–8/10 launches fail, `stop`/`restart` refuse, and a watchdog respawn ends with no proxy. Keep the lock design and AUD-001 ("never delete a live contender's lock"), and add: (a) proven takeover when the recorded holder is dead or its PID was reused (start-time mismatch), done by atomic rename so two contenders cannot both take over; (b) SIGINT/SIGTERM/exit handlers that release a lock the process owns; (c) respawn requests treat a proven-stale lock as takeable.

➡️ Yes: proven takeover + release on signals; never touch a live holder's lock. ADR: yes.

---

❓ **Q5 - Admission control (1B D4)**: RC2: no limit on request bytes in flight; ~4.5 MB RSS per MB in flight; HWM 998 MB at 16 and 1,619 MB at 32 concurrent 10.8 MB bodies. Add (a) a cap on total in-flight request body bytes (default 64 MB) and on concurrent upstream requests (default 16), both configurable in `config.yaml` and env; (b) excess requests wait in a bounded FIFO queue up to 15 s, then are rejected with HTTP 503 plus `Retry-After`, in the error shape of the endpoint (OpenAI `error` object; Anthropic `overloaded_error`), never 429 (429 stays reserved for upstream quota/rate semantics that clients map to quota); (c) reduce the per-MB amplification where the request path keeps redundant copies (measured, ticket-level). Budgets: burst HWM ≤ 400 MB at 16 and ≤ 600 MB at 32 × 10.8 MB.

➡️ Yes: byte + concurrency caps, bounded queue, 503 + Retry-After in endpoint error shape, amplification reduction.

---

❓ **Q6 - Scope of "total kit footprint ≤ 600 MB in S3" (1B D2)**: S3 at 10 launches peaked at 852 MB, of which the proxy is only 60 MB; each harness session costs ~160 MB in Node processes outside the proxy (`zcode-kit run` launcher 74 MB held for the whole session, per-session MCP bridge 86 MB, preflights 55–73 MB each while they run). §9 forbids loosening budgets. Count every process the kit starts (launcher, MCP bridge, preflight, proxy, solver) and keep ≤ 600 MB for the 10-launch S3 scenario, reaching it by: the launcher releasing everything it does not need and running with a small heap cap while it only waits on the child (it must stay alive to forward signals and the exit code, C2); the bridge lazy-loading modules it does not need at start; preflights single-flight per installation (one at a time, others wait for its result). Also budget per session: launcher ≤ 45 MB, bridge ≤ 60 MB steady.

➡️ Yes: everything counts; 600 MB kept; reach it by launcher slimming, bridge lazy loading, single-flight preflight; per-session sub-budgets as stated.

---

❓ **Q7 - Memory budget job on both CI legs (1B D5)**: The 1B sampler reads `/proc` only. §9 requires CI green on ubuntu and windows "with the new memory-budget and snapshot jobs". Build a Windows sampler (one `Get-CimInstance Win32_Process` / `Get-Process` call per second for WorkingSet/PrivateMemory and the process tree) and run the short profile on ubuntu (S1–S7) and a Windows subset (S1, S3, S4, S5) on windows-latest; the long profile stays local.

➡️ Yes: Windows sampler; ubuntu full short profile, windows subset; long profile local only.

---

❓ **Q8 - Account Rotator question asked on every setup/update (UX D1)**: every `setup`/`update` on a TTY re-asks the Account Rotator question even when it was answered, and an update on a pty with no input hangs there (`ux/ux-audit.md`). Store the answer like the harness choices, ask only when undecided, `setup --reask` asks again, `ZCODE_KIT_ACCOUNT_ROTATOR=y|n` still overrides.

➡️ Yes.

---

❓ **Q9 - stdout vs stderr (UX D2)**: today errors, progress and prompts go to stdout; `run` even writes kit status lines into the launched harness's stdout. Keep data on stdout (JSON, connection details, `--show-key`, `models`, `status --json`), move diagnostics (progress, spinners, warnings, errors, prompts, `run` status lines) to stderr, announced in the release notes as a behaviour change of human-readable text; exit codes and JSON unchanged.

➡️ Yes, in one release, announced; no phased dual output.

---

❓ **Q10 - `WARN` in the doctor check grammar (UX D3)**: add a third check verdict `WARN` (non-fatal, exit code unaffected) beside `PASS`/`FAIL`/`SKIP`; JSON gains the value additively.

➡️ Yes, additive, documented.

---

❓ **Q11 - `auth status` output (UX D4)**: today it prints JSON to stdout by default and scripts may parse it. Print human-readable text only when stdout is a TTY; keep the exact current JSON when stdout is not a TTY; `--json` forces JSON on a TTY. No deprecation window needed because non-TTY consumers see no change.

➡️ Yes.

---

❓ **Q12 - Single-source width core (UX D5)**: one width/glyph core (`width-core.mjs` + `.d.mts`) inside `zcode-proxy-src/src/tui/`, re-exported by `width.ts` and imported by the CLI's output module, rewritten per grapheme (`Intl.Segmenter`, UCD 17 wide table, VS16/RI pairs = 2, cluster cap 2) per `research/terminal-conventions.md`.

➡️ Yes.

---

❓ **Q13 - Compact setup output by default (UX D6)**: the default shows stages, one result line per assistant, the connection check and the connection card; full diagnostics go to `install.log`, `--verbose` and `ZCODE_KIT_VERBOSE=1` (unchanged meaning). The installer-mode login hint must show the actual command on screen (audit finding #1).

➡️ Yes.

---

❓ **Q14 - Node floor and CI matrix**: Node 20 is EOL since 2026-04-30; Node 26 is Active LTS, 24 and 22 Maintenance (22 ends 2027-04-30) (`research/node-lts.md`). Set `engines.node` to `>=24` in all 3 manifests, installer gates (`install.sh`, `install.ps1`, `pack/build.mjs`) to 24, CI matrix {ubuntu, windows} × {Node 24, Node 26}, release workflow on 26. The installer error for an older Node names the exact upgrade step.

➡️ Yes. ADR: yes (support floor).

---

❓ **Q15 - Bun pin and the nested workflows**: pin Bun 1.4.4 in CI, release, both installers (with the 1.4.4 SHA-256s), docs and SUPPORT_MATRIX (1.4.3/1.4.4 fix Atomics.wait memory return, Bun.gc RSS release, worker-termination string leak, cgroup-aware heap sizing; `research/bun.md`). Delete `zcode-proxy-src/.github/workflows/` (never executed by GitHub, triggers on `master`, stale Bun 1.4.0) and note it in MANIFEST's vendor-change list; move nothing from them because the root CI already runs the proxy tests.

➡️ Yes.

---

❓ **Q16 - Dependency targets**: happy-dom `^21.0.4` (only fix for GHSA-834v-8h66-3h79) with `enableCSSFileLoading: true, enableIframePageLoading: true` so the solver's page behaviour stays as on 20.x (B1); undici `^8.12.4` (19 advisories on the locked 8.10.0); yaml `^2.9.1`; MCP SDK stay on 1.x `^1.32.2` and declare `zod` `^4.6.6` (advisory below 4.6.6, `reports/drift.md`); TypeScript `7.0.2` exact with fallback `6.0.3` if the build or dist diff misbehaves; `@types/node` `^24`; `@types/bun` `1.4.4` exact; plus a proxy `typescript` devDependency so `bun x tsc` is pinned; GitHub Actions `actions/checkout@v7`, `actions/setup-node@v7`, `oven-sh/setup-bun@v2`. One expand–contract batch per package (proxy deps; mcp deps; toolchain; CI), each green before the next. The MCP 2.x migration is a separate `needs-triage` ticket (1.x support ends no earlier than 2027-01-27).

➡️ Yes.

---

❓ **Q17 - Captcha egress routing under Bun**: under Bun the npm `undici` is replaced by Bun's stand-in, so the `dispatcher: ProxyAgent` for captcha traffic is ignored: `ZCODE_PROXY_UPSTREAM_PROXY` has no effect on captcha fetches although the banner reports "explicit proxy", and Bun's fetch reads ambient `HTTP(S)_PROXY` although the code comment says ambient variables are ignored (`research/undici-yaml.md` §Answer 2–3). Fix the routing only (Bun: `proxy: <configured URL> ?? false`; Node keeps the dispatcher), plus a test; no change to what is fetched or how challenges are solved. This is network-egress correctness and C6 (no unintended egress path), not challenge behaviour, so it is inside B1's IN SCOPE list (error handling/observability) rather than its OUT OF SCOPE list.

➡️ Yes, routing-only fix with test.

---

❓ **Q18 - Harness adapter drift**: fix the two HIGH items (Continue `capabilities` must be a string array; Kilo Code's Anthropic base URL must include `/v1`) and the MEDIUM ones whose current format is confirmed by primary docs in `research/harness-configs.md` (Claude Code effort enablement for `glm-*`, pi `thinkingLevelMap`, OMP `auth`/compat keys, image-input flags for Flash in Goose/OpenCode/Kilo); do nothing for OpenCode's V2 schema (V1 is still accepted and migrated); refresh recorded external versions and `primarySource` dates only for what was re-verified. Adapter tests run against temp HOME fixtures (B3).

➡️ Yes.

---

❓ **Q19 - Tests that CI never runs**: `tests/update.test.mjs` and `tests/upstream-config.test.mjs` pass but are not in `npm run test` (METRICS baseline). Wire them in, and add a guard test that fails when a `tests/*.test.mjs` file is not referenced by any test script.

➡️ Yes.

---

❓ **Q20 - Tracker docs in the PR**: the owner's checkout has untracked `AGENTS.md` and `docs/agents/` (issue-tracker, triage-labels, domain) that this run's tracker follows, but they are not on `origin/main`. Commit identical copies on the integration branch so the PR's `.scratch/` conventions are documented in the same tree. The owner's checkout stays untouched.

➡️ Yes.

---

❓ **Q21 - When to open the PR**: CI only runs on `pull_request` and pushes to `main`/`feature/account-rotator`, so a pushed branch alone gets no CI. Open a DRAFT PR against `main` after the first merge to the integration branch (implement-spec step 3), use its CI runs on both OS legs throughout Phase 4–6, and mark it ready for review in Phase 7. Never merge.

➡️ Yes.

---

❓ **Q22 - Unverifiable items become owner actions**: a live vendor-SDK solve measurement (1B A1), Windows/PowerShell 5.1/conhost console checks (1B A2, 1C install.ps1 run), macOS terminals, and the optional live "Reply with ok" smoke all need the owner's login or hardware. Record each in OWNER-ACTIONS.md with copy-paste commands, mark the related criteria "unverified — owner action", and never copy or read the owner's secrets to attempt them.

➡️ Yes.
