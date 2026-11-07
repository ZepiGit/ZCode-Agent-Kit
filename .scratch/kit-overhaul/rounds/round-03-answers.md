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
