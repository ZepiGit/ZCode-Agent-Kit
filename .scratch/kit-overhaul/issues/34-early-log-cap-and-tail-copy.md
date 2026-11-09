# 34: Early log (`proxy.early.log`): 1 MB cap and the tail copy into `proxy.log`

**Blocked by:** 33 (`proxy.log` single rotator: size-capped writer, manager rotation under the lock, file modes)

**Status:** ready-for-agent

Model: sol

Risk: medium

ADR: 0009

**What to build:** Inherited stdio goes to the early log, truncated at each start and capped at 1 MB by the proxy's writer (truncate in place after a marker event). Before any truncation of a non-empty early log the manager appends its last 64 KB to `proxy.log` behind a marker line (start failure, respawn, crash). The golden-path classifier keeps reading only `proxy.log`. Watchdog lines may be appended to `proxy.log` by path (`0o600`).

**Acceptance criteria:**

- [ ] Seam 4: cap enforcement with bounded overshoot; marker event.
- [ ] Seam 2: tail copy before every truncation path; the golden-path classifier finds a crash cause through the tail-copy marker (Round 4 Q1 add. 5).
- [ ] Loop S7: early log ≤ 1 MB + bounded overshoot.
- [ ] Seam 2/4 (POSIX): a watchdog by-path append that creates `proxy.log` creates it with mode `0o600`.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 76, 78

## Comments

- 2026-11-09 (`ticket/34-early-log-cap`, base `1b243b5`): **partial implementation; blocked, not ready for central acceptance**. Escalation requires a fresh Charter decision before changing the native-output overshoot contract or allowing the proxy writer instead of the manager to copy at cap truncations. Decision brief: `/home/AgentKit/overhaul-tools/t34-decision-brief.md`; reproducible probe: `/home/AgentKit/overhaul-tools/t34-native-burst.mjs` (outside repo, as instructed). Original guarantee unchanged; no cap or timer added.
- Independent slice: `lib/proxy-lifecycle.mjs:830` now copies only a positioned, fresh ≤64 KiB Buffer, appends the marker and redacted tail synchronously before per-start truncate, and routes inherited stdout/stderr to an O_APPEND owner-only early log. Failed exit/timeout/foreign-during-start preserve the cause immediately without truncating. `scripts/verify-golden-path.mjs:45` extracts the existing start-failure predicates unchanged, still fed only proxy.log. `zcode-proxy-src/src/runtime/watchdog.ts:290` adds owner-only by-path appends, with inherited stderr unchanged and no rotation. No anti-abuse behavior changes, new config/env overrides or snapshots.
- Commands below ran from `/home/AgentKit/wt/t34`; `C=/home/AgentKit/overhaul-tools/run-capped.sh`; default wrapper PATH uses Bun 1.4.2 and isolated HOME. Logs are under integration `.scratch/kit-overhaul/reports/`. Locked install: `BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin $C t34-install 3G 180 -- bash -c 'npm ci && bun install --cwd zcode-proxy-src --frozen-lockfile && npm ci --prefix mcp/zcode-harness-mcp'` → exit 0, 7 s (`t34-install.log:1-21`), lockfiles unchanged.
- RED: `$C t34-red-watchdog 1G 60 -- bun test zcode-proxy-src/src/runtime/watchdog.test.ts --test-name-pattern 'appends watchdog lines by path'` → 0 pass / 1 fail, missing file (`t34-red-watchdog.log:9-24`). `$C t34-red-start-tail 1G 90 -- node --test --test-name-pattern 'early log:' tests/proxy-lifecycle.test.mjs` → 0 pass / 1 fail, old early content retained (`t34-red-start-tail.log:15-22`). `$C t34-red-failure-tail 1G 45 -- node --test --test-name-pattern 'early log: a failed start' tests/proxy-lifecycle.test.mjs` → 0 pass / 1 fail, cause absent (`t34-red-failure-tail.log:15-18`). Initial GREEN retry corrected test literal byte count 40→42 (`t34-green-targeted-premerge.log:20`), not production code.
- GREEN: `$C t34-green-targeted-premerge2 2G 180 -- bash -c 'node --test --test-name-pattern "early log:" tests/proxy-lifecycle.test.mjs && node --test tests/golden-path.test.mjs tests/test-wiring.test.mjs && bun test zcode-proxy-src/src/runtime/watchdog.test.ts zcode-proxy-src/src/log/proxy-log-serve.test.ts'` → lifecycle 2 pass, golden/wiring 20 pass + 1 live opt-in skip, writer/watchdog 19 pass + 1 Windows skip, exit 0 (`t34-green-targeted-premerge2.log:1-72`). Existing assertions unchanged, new tests reuse wired files. Ticket 33 single-rotator tests pass unchanged. Full suites deliberately not run: current ask reserves `test:all` for controller. No expected-RED entry owned by 34, none removed.
- Native feasibility: `$C t34-native-burst 1G 30 -- bun /home/AgentKit/overhaul-tools/t34-native-burst.mjs` → `nativeWriteBytes=2097152 peakEarlyBytes=2097152 limitPlus64KiB=1114112`, exit 0 (`t34-native-burst.log:1-2`). Single native write plus hung main thread defeats an unconditional 1 MiB+64 KiB bound with direct inherited-file stdio and JS checks. This is not a passing cap test or a weaker proposed acceptance metric. Decision needed: explicitly revised checkpoint/native-chunk bound plus proxy-copy ownership, or bounded capture/backpressure/platform enforcement redesign. Windows runtime/memory-budget CI pending. Complete ticket remains blocked.

- Post-merge GREEN after fixture correction: `$C t34-green-targeted-final2 2G 300 -- bash -c 'node --test tests/proxy-lifecycle.test.mjs tests/golden-path.test.mjs tests/test-wiring.test.mjs && bun test zcode-proxy-src/src/runtime/watchdog.test.ts zcode-proxy-src/src/runtime/respawn-ack.test.ts zcode-proxy-src/src/runtime/supervisor.test.ts zcode-proxy-src/src/log/proxy-log-serve.test.ts'` → Node 58 pass / 0 fail / 1 live skip; Bun 46 pass / 0 fail / 1 Windows skip; exit 0, 134 s (`t34-green-targeted-final2.log`). This includes ticket 23's induced-pressure refusal, late acknowledgement, watchdog 10 s wait and ticket 33 writer tests. First post-merge attempt timed out at 240 s because the fixture lacked the writer, recorded honestly in `t34-green-targeted-final.log`; fixed by modeling real proxy output, not reducing the tests.
- Capped S7 (unchanged scenario, not a native cap proof): `$C t34-s7-short 3G 600 -- env ZCODE_MEMLOOP_PORT=19341 node tests/memory/run.mjs S7 --profile short --out /home/AgentKit/overhaul-tools/t34-s7` → GREEN, exit 0, 126 s. `t34-s7-short.log` reports proxy HWM 210.2/250 MB, 0 orphans, proxy.log 0.08/6 MB, early log exists with **0 bytes** (no native load), responses-store heap-at-cap 56/96 MB. Exact summary `/home/AgentKit/overhaul-tools/t34-s7/S7-short-2026-11-09T1703-8c5188/summary.json:13-48,288-290`, CSV alongside. This low-load GREEN does NOT satisfy the unresolved early-log enforcement guarantee; measured adversarial burst remains 2 MiB.
- Integration merge: code slice `06dc3cd`, then merge `ebe2f3f` includes current integration `282557f44dd66ccddf0603b623532ce060980c71` and ticket 23. Watchdog conflicts resolved preserving all acknowledgement/refusal/deadline behavior; its outcome event now also goes through the owner-only by-path sink. Post-merge lifecycle test exposed a stand-in mismatch: ticket 23's `SUPERVISED_PROXY` wrote console output only to inherited stdio, unlike the actual managed proxy, so it waited 180 s for a refusal that was in early.log (`t34-green-targeted-final.log`). Justified fixture change: install the real `startProxyLog()` in the stand-in; no existing assertion changed. This models the new inherited-stdio contract and preserves ticket 23 checks rather than weakening them.

- 2026-11-07 (orchestrator, from ticket 32): in Bun 1.4.2 a substring keeps its whole parent string alive (probe in ticket 32 Comments: 2,000 short rows split from one 20 MB record kept all 20 MB). A bound that counts the bytes of slices, split parts or tail copies is beaten unless it makes a fresh copy of what it keeps. Check your truncation/tail copy for this and pin it with an adversarial test.

- 2026-11-08 (orchestrator, Owner Proxy round 15): Q1 E and condition 7 — struck "**Delete `S7/short` (linux, windows).**" from the Loop S7 criterion. 34 owns no `expected-red.json` name: its early-log check was never RED in 34 runs, and `S7/short`'s only name, `proxy.log:bounded-while-running`, is ticket 33's, whose removal deletes the entry. The early-log bound itself still binds 34.
