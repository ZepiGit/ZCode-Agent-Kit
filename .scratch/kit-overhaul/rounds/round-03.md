# Round 3 — footprint plan, stop/restart protocol, log ownership, remaining branches

Answers file: `rounds/round-03-answers.md`. Rounds 1–2 are binding (DECISIONS.md).
New facts this round: `diagnosis/footprint-facts.md` (Round 1 Q6 measurements) and `diagnosis/round3-facts.md` (Round 2 open branches). Evidence root `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/`.
Every question is worded so "yes" accepts the recommendation.

---

❓ **Q1 - S3 footprint: metric per OS**: §9 says "total kit footprint ≤ 600 MB in S3". Round 1 Q7 chose commit charge as the Windows metric. footprint-facts §fact 1: ~34–37 MB of every Node process is the shared node image, so a plain RSS sum counts it once per process (true unique memory at the 852 MB RSS peak ≈ 375 MB, estimated). Keep the §9 number literal and conservative: ≤ 600 MB as the SUM OF RSS on Linux/macOS and the SUM OF COMMIT (PrivatePageCount) on Windows, for the measured S3 scenario (5 `run` sessions + 5 OMP preflights + proxy + solver), and additionally report Linux PSS (smaps_rollup) as information only, never as the gate.

➡️ Yes: RSS sum gate on Linux/macOS, commit sum gate on Windows, PSS reported only.

---

❓ **Q2 - S3 footprint: the mechanisms (Round 1 Q6 sub-budgets, now measured)**: footprint-facts' per-role plan reaches 533 MB (margin 67 MB) on Linux with: (a) OMP preflight single-flight where waiters wait inside the OMP host (no process per waiter; one starter preflight ≤ 76 MB); (b) MCP bridge loads the HTTP transport lazily and runs with `--max-semi-space-size=1` (measured 73.7 MB; target ≤ 75 MB); (c) solver process spawned on the first solve and exiting after 10 min idle (idle 16 MB; 0 in S3 until a solve); (d) on POSIX, `zcode-kit run` hands its process over to the harness with `process.execve` after its preflight, only on Node ≥ 26.1 (where a failed handover throws instead of aborting) and only after pre-validating the target; it re-arms SIGPIPE/SIGXFSZ before the handover; on Node 24.x and on Windows the launcher stays resident as today (C2: exit code and signal forwarding unchanged). Per-role targets: launcher resident ≤ 70 MB (Node floor ~49 lean, today 70.5), bridge ≤ 75 MB, starter preflight ≤ 76 MB, proxy idle ≤ 62 MB, solver idle ≤ 20 MB. Windows is gated on commit (Q1) by the windows-latest memory job; its baseline is measured on the first draft-PR CI run. If Windows misses 600 MB after (a)–(c), the next measured lever is running the MCP bridge under the bundled Bun (55–59 MB, smoke-checked only) behind a ticket that must prove protocol parity — decided then with numbers, not now.

➡️ Yes: (a)–(d) with these targets; Windows lever deferred to measured evidence.

---

❓ **Q3 - Windows graceful stop (Round 2 Q1 condition)**: signals cannot request a graceful stop on Windows (Node/libuv map SIGINT/SIGTERM/SIGKILL to `TerminateProcess`; the detached proxy has no console; round3-facts §1). The proxy key is not enough because it is written into harness configs. Add one authenticated loopback request on the existing listener, `POST /__kit/stop`, accepted only with a per-spawn stop capability (random 256-bit, passed to the proxy through a `ZCODE_KIT_STOP_TOKEN` env var on the `proxyEnv` allowlist and stored in the 0600 `proxy.pid` as an additive field, compared in constant time; never logged). It triggers the Round 2 Q1 single graceful shutdown sequence. POSIX keeps SIGTERM as the trigger of the same sequence and may also use the request. The manager falls back to today's `TerminateProcess`/SIGKILL after one shared grace constant (`STOP_GRACE_MS = 10_000`, the same value as the drain deadline) when the proxy answers 404 (old proxy), does not answer, or does not exit. `verify-golden-path.mjs` gets an explicit force-kill helper for its crash injection.

➡️ Yes.

---

❓ **Q4 - Restart handoff and budget acknowledgement (Round 2 Q1 condition)**: today the proxy starts exiting as soon as the respawn hook spawns, and the manager reserves the 3-per-15-min budget only afterwards, so a refusal leaves zero proxies (round3-facts §2). New proxy behaviour for memory recycles: spawn the hook (`respawn <pid> --reason memory`, arguments unchanged), then wait up to 10 s for the acknowledgement — `logs/respawn.json` rewritten with this pid and an `at` newer than the request (written by old and new managers exactly at reservation); only then run the graceful sequence. If the hook exits 4 (refused) or no ack arrives: do not drain, keep serving, log ERROR once, mark status/doctor `restarts` as exhausted, and retry after the budget window. The watchdog path (main thread hung) keeps self-terminating after ack OR refusal, because a hung proxy serves nobody, and logs which. Old proxies meeting a new manager keep today's behaviour (cannot be fixed from the manager side); documented. No piped-stdout ack (EPIPE risk).

➡️ Yes.

---

❓ **Q5 - `proxy.log` ownership (Round 2 Q4 corrections)**: the proxy becomes the single rotator of `proxy.log` (rotate at 5 MB, keep `proxy.log.1`; close → rename → reopen; on a rename failure keep appending and retry at the next threshold). The manager keeps appending its own lines with `appendFileSync` to the current `proxy.log`, and stops rotating in `start()` whenever a live owned proxy exists (fixes today's bug where a live proxy writes into a file that the next rotation deletes). Inherited stdout/stderr (early start output, watchdog fd-2 lines, unhandled rejections) go to `proxy.early.log`, truncated at each start and capped at 1 MB. On start failure and on a respawn, the manager appends the last 64 KB of `proxy.early.log` to `proxy.log` with a marker line, so `verify-golden-path.mjs` keeps classifying from `proxy.log`. The solver child's output goes through the parent's writer. `proxy logs N` reads `proxy.log.1` + `proxy.log`. The Windows rename behaviour is proven by a windows-latest test, not assumed.

➡️ Yes.

---

❓ **Q6 - MCP task text truncation and idempotency wording (Round 2 Q3 conditions)**: when `accumulatedText` exceeds 4 MiB, keep the first 1 MiB and the last 3 MiB with one marker line `[… N bytes truncated …]` (the end of an agent turn carries the answer), set `completeness: partial` and merge a `truncated` note with the end-state note; the transcript fallback gets the same cap. Cached `.result.json` files written before the change are served as stored. Document: "Idempotency keys are remembered for as long as the task is retained (at most 500 terminal tasks or 7 days); after that the same key starts a new task."

➡️ Yes.

---

❓ **Q7 - doctor Memory rows and next commands**: rows `memory: proxy` (PASS below soft, WARN at/above soft with the exact config key to change and `zcode-kit proxy restart`), `memory: solver` (PASS/WARN against 80 % of its cap; SKIP when no solver process exists), `memory: enforcement` (PASS for `job-object`/`cgroup`; WARN for `sampling` on Linux with next step `systemctl --user status` to check whether a user systemd session exists, and the README section explaining the fallback; PASS for `sampling` on macOS where no kernel limit exists, per Round 2 Q5), `restarts` (WARN when the 15-min budget is exhausted, next `zcode-kit proxy logs 50`). Each WARN has what/why/next.

➡️ Yes.

---

❓ **Q8 - Expected-RED mechanics for the memory job (Round 2 Q14 condition)**: `tests/memory/expected-red.json` maps scenario/variant → ticket number. The CI job fails when a scenario is RED and not listed, and also when a listed scenario turns GREEN (ratchet: the fixing ticket must delete its entry). Each memory-fix ticket's acceptance criterion includes removing its entry. The file must be empty at the Phase 6 gate.

➡️ Yes.

---

❓ **Q9 - Windows baseline (Round 2 Q13 condition)**: the windows-latest memory job's first run happens on the draft PR right after the toolchain batch (Bun 1.4.4) lands with the Windows sampler and the units self-test; its numbers are recorded in METRICS.md as the Windows baseline before any memory fix merges, with the job allowed RED only through expected-red.json.

➡️ Yes.

---

❓ **Q10 - Solver process lifetime (follows Q2 (c))**: spawn on the first solve, keep alive while solves arrive, exit after 10 min idle; at most one solver process per proxy (Round 1 Q3 condition); idle exit is not counted as an abnormal exit (Round 2 Q2). Prewarm is off by default.

➡️ Yes.
