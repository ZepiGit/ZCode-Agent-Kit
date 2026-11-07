# Test seams for the kit-overhaul spec (confirmed by the Owner Proxy in Round 4 Q1, with additions)

Each seam is the highest point that can observe its properties. Existing seams are reused wherever possible. Windows-only proofs run inside seams 1, 2, 3, 4, 5 and 8 on the windows-latest leg; they are not a separate seam. Details: `spec.md` → Testing Decisions. The Round 4 Q1 additions (1–5) and the Q2/Q4 test items are marked "(R4)".

1. **Memory loop, process level** (isolated installation, mock upstream, sampler, verdict, expected-RED ratchet). Tests:
   - the S1–S7 budgets, per-role peaks, process counts and orphans;
   - (R4, add. 2) the solver process-level claims: 0 solver processes after the proxy is SIGKILLed, an idle exit leaves 0 solver processes (and releases the cap container), ≤ 1 solver process per proxy at every sample, asserted by the S2/S4 orphan checks; on windows the proof is Job Object reaping;
   - the S3 OMP stub-host leg; (R4, add. 4) it asserts that each waiter host printed the starter's `cause=` lines whenever the starter's preflight emitted any, with 5 hosts and in the killed-starter case.

   **Exists** on `diagnosis/memory`. **New:** the Windows sampler, the `commit_kb` column, S3 role budgets, the OMP stub host and the expected-RED schema.
2. **Lifecycle module interface** (`createManager({ root, home, processStartMsImpl, … })` with injected process table and timings, plus the manager CLI spawned). Tests:
   - the start-lock takeover race and v0 locks;
   - signal release and orphan adoption;
   - stop-request fallbacks and shared deadlines;
   - respawn acknowledgement and refusal;
   - manager-side log rotation and file modes;
   - (R4, add. 5) `proxy logs N` reading across `proxy.log.1` and `proxy.log`, and the golden-path classifier reading the tail-copy marker;
   - (R4, Q4) at the spawned proxy: the stop token in its environment equals the one in `proxy.pid`, and two consecutive spawns get different tokens;
   - CLI exit codes 0–5.

   **Exists.**
3. **Solver dispatcher interface** (`configureCaptchaSolver({ backendModule })` + stats, with fixture backends), now with a transport choice (child process / thread transport). Tests:
   - byte-identical solves;
   - the cap handshake and (R4, add. 2) the ordering logic of one solver generation at a time;
   - recycle triggers;
   - fail-fast and abnormal-exit counting;
   - env parity;
   - the solver queue's caller-side bound (one in-flight solve per pool), or its count bound and shed if one must be added (R4, D7);
   - egress routing;
   - in-generation CDN and stall bounds.

   The process-level reaping claims moved to seam 1 (R4): a dispatcher-level test cannot SIGKILL its own test runner. **Exists, extended.**
4. **Proxy over its loopback listener** (an isolated proxy against the mock upstream, plus `/health` details; the supervisor through its injected sampler). Tests:
   - admission and the 503 shed shape;
   - `/__kit/stop` auth, 404, 202 and the admission bypass;
   - drain behaviour;
   - the additive observability JSON;
   - the `proxy.log` writer and the early log (`proxy.early.log`).

   **Exists.**
5. **CLI command records → output module with forced capabilities, plus a few CLI spawn tests.** Tests:
   - every command in every C3 variant (byte snapshots);
   - the off-TTY check-grammar regex `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$` (separator ` — ` byte-for-byte in every glyph tier, whitespace-indented `why:`/`next:` lines; R4, D1) and WARN;
   - what/why/next;
   - `{ exitCode, records }`;
   - stdout/stderr routing;
   - the JSON key/type superset;
   - the PowerShell 5.1 stderr gate;
   - (R4, add. 1) the `process.execve` handover: spawn `zcode-kit run` against a fake harness executable on POSIX and assert:
     - with Node ≥ 26.1 the harness runs under the launcher's pid, so no launcher process is resident;
     - on Node < 26.1, with `ZCODE_KIT_RESIDENT_LAUNCHER=1`, or with a non-executable target, the launcher stays resident;
     - a missing harness still gives `run: …` and exit 2;
     - stderr carries no `ExperimentalWarning`;
     - the `ready.detail` line and the `heal.log` write happen before the handover;
     - a harness killed by SIGTERM reports 143;
     - exit codes 0, 7 and 130 are unchanged;
     - the windows-latest leg asserts the resident path with signal and exit-code forwarding as today.

   **New** snapshot suite on top of existing spawn tests.
6. **Pure shared modules** (the width core and token set under Node and Bun, the TUI frame renderer and log pane, the bounded collection with a fake clock). Tests:
   - width vectors;
   - TUI layouts, tiers, refusals and the 60×16 minimum;
   - log-pane line and byte caps;
   - eviction.

   **Exists, extended.**
7. **MCP bridge through the MCP client and the fake harness.** Tests:
   - task retention (500 / 7 days);
   - not-found and idempotency after eviction;
   - per-task caps and the 4 MiB head+tail truncation with `completeness`/`truncated`;
   - lazy HTTP and the semi-space flag.

   **Exists.**
8. **Installer and adapter temp-HOME fixtures.** Tests:
   - the Node 24 refusal before mutation;
   - (R4, add. 3) the preflight check of the OMP autostart's pinned Node path against the floor;
   - the Bun 1.4.2 hashes (Round 11), and a tampered Bun download refused before extraction;
   - the adapter HIGH and confirmed MEDIUM fixes;
   - the bridge flag in generated entries;
   - the OMP in-host token and (R4, add. 3 / Q2) the waiter cause-line record logic (write before release, identity match, stale/corrupt/oversized records rejected, fixed-vocabulary validation);
   - the rotator migration;
   - every migration replayed twice;
   - (R4, add. 3 / Q4) the per-spawn environment rules in the `proxy-env` suite: `ZCODE_KIT_LOG_DIR` and `ZCODE_KIT_STOP_TOKEN` are set by the manager and overwrite ambient bogus values, and the stop token is absent from the respawn hook's environment; the `proxyEnv` allowlist only for the new `ZCODE_PROXY_*` config overrides.

   **Exists.**
9. **Repository guards.** Tests:
   - test-script wiring;
   - the expected-RED schema and ratchet;
   - the CI refusal of `UPDATE_SNAPSHOTS`;
   - `verify-payload` requiring the shared output files.

   **New** (small).
