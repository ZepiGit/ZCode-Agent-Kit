# 55: CI guardrails: snapshot-update refusal and an empty expected-RED list

**Blocked by:** 06 (CLI output module, capability record and the snapshot harness (no visible change)), 16 (Start lock protocol v1 with proven takeover (no judge-then-rename race)), 17 (Start-lock release on signals, orphan adoption, respawn over a proven-stale lock), 19 (Admission control: 64 MB in-flight byte cap, FIFO queue, 503 shed contract), 30 (MCP task retention (500 / 7 days) and the idempotency window), 32 (TUI log pane capped at 2,000 lines and 8 MB), 34 (Early log (`proxy.early.log`): 1 MB cap and the tail copy into `proxy.log`), 35 (OMP in-host single-flight preflight with the cause-line result record), 37 (`process.execve` handover in `zcode-kit run` and the `ZCODE_KIT_RESIDENT_LAUNCHER=1` opt-out), 58 (Solver recycle triggers and failure semantics (abnormal-exit budget, fail-fast shed)), 20 (Fewer redundant request-body copies (bytes upstream unchanged)), 61 (S1/stalled on Windows: proxy memory under many stalled streaming readers), and every typecheck-baseline ticket filed by 11, 67 (plain expected-RED entries name the checks they own)

**Status:** ready-for-agent

Model: glm

Risk: low

ADR: 0016

**What to build:** CI fails when `UPDATE_SNAPSHOTS` is set; `expected-red.json` is empty on both legs and a guard keeps it empty from here on; the seam 9 guard suite (wiring guard from 04, expected-RED schema, `verify-payload` shared files from 05, snapshot refusal) runs in `npm run test`.

**Acceptance criteria:**

- [ ] A CI-env test with `UPDATE_SNAPSHOTS=1` fails; locally it writes.
- [ ] Both `memory-budget` legs green with an empty list; the guard rejects a re-added entry.
- [ ] No `unstable` entry remains in `expected-red.json` and the `unstable` allow-list (windows S1/burst1 only, Round 9 Q1) is removed from the schema and the ratchet code; a test rejects `unstable` on any key.
- [ ] `npm run test:all` and both `memory-budget` legs are green in the CI run in which the list becomes empty; the proxy typecheck expected-error list from 11 (if any) is empty too.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 141, 142

## Comments

- 2026-11-07 (orchestrator, Owner Proxy round 9 Q1 condition 5 and Shared understanding): new edges 55 <- 20 (owner of the windows `S1/burst1` unstable entry) and 55 <- 61 (owner of the windows `S1/stalled` entry); new criterion: no `unstable` entry and no allow-list remain. If 61 is never accepted out of needs-triage, the 55 <- 61 edge comes back to the Owner Proxy as a question.

- 2026-11-07 (orchestrator, Owner Proxy round 13 C5): the unstable allow-list now has two keys (windows S1/burst1 owned by 20, windows S5/short owned by 30); this ticket's criterion covers both.
