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
