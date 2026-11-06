# Test seams for the kit-overhaul spec (for Owner Proxy confirmation)

Each seam is the highest point that can observe its properties. Existing seams are reused wherever possible. Windows-only proofs run inside seams 2, 3, 4, 5 and 8 on the windows-latest leg; they are not a separate seam. Details: `spec.md` → Testing Decisions.

1. **Memory loop, process level** (isolated installation, mock upstream, sampler, verdict, expected-RED ratchet). Tests the S1–S7 budgets, per-role peaks, process counts, orphans, and the S3 OMP stub-host leg. **Exists** on `diagnosis/memory`. **New:** the Windows sampler, the `commit_kb` column, S3 role budgets, the OMP stub host and the expected-RED schema.
2. **Lifecycle module interface** (`createManager({ root, home, processStartMsImpl, … })` with injected process table and timings, plus the manager CLI spawned). Tests:
   - the start-lock takeover race and v0 locks;
   - signal release and orphan adoption;
   - stop-request fallbacks and shared deadlines;
   - respawn acknowledgement and refusal;
   - manager-side log rotation and file modes;
   - CLI exit codes 0–5.

   **Exists.**
3. **Solver dispatcher interface** (`configureCaptchaSolver({ backendModule })` + stats, with fixture backends), now with a transport choice (child process / thread transport). Tests:
   - byte-identical solves;
   - the cap handshake and one solver generation;
   - recycle triggers;
   - fail-fast and abnormal-exit counting;
   - env parity;
   - reaping after a proxy SIGKILL;
   - egress routing;
   - in-generation CDN and stall bounds.

   **Exists, extended.**
4. **Proxy over its loopback listener** (an isolated proxy against the mock upstream, plus `/health` details; the supervisor through its injected sampler). Tests:
   - admission and the 503 shed shape;
   - `/__kit/stop` auth, 404, 202 and the admission bypass;
   - drain behaviour;
   - the additive observability JSON;
   - the `proxy.log` writer and `proxy.early.log`.

   **Exists.**
5. **CLI command records → output module with forced capabilities, plus a few CLI spawn tests.** Tests:
   - every command in every C3 variant (byte snapshots);
   - the off-TTY check-grammar regex and WARN;
   - what/why/next;
   - `{ exitCode, records }`;
   - stdout/stderr routing;
   - the JSON key/type superset;
   - the PowerShell 5.1 stderr gate.

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
   - the Bun 1.4.4 hashes;
   - the adapter HIGH and confirmed MEDIUM fixes;
   - the bridge flag in generated entries;
   - the OMP in-host token;
   - the rotator migration;
   - every migration replayed twice;
   - the `proxyEnv` allowlist.

   **Exists.**
9. **Repository guards.** Tests:
   - test-script wiring;
   - the expected-RED schema and ratchet;
   - the CI refusal of `UPDATE_SNAPSHOTS`;
   - `verify-payload` requiring the shared output files.

   **New** (small).
