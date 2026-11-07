# 48: Proxy TUI redesign on the shared tokens

**Blocked by:** 05 (Shared width core and token set (two renderers, one token set)), 32 (TUI log pane capped at 2,000 lines and 8 MB), 39 (Observability fields in `/health` details, `proxy status` and `--json`)

**Status:** ready-for-agent

Model: sol

Risk: high

ADR: 0001 (Round 2 amendment), 0011

**What to build:** Boxed status header only (state, port, health, uptime, account/plan, login badge in words); process strip with per-process RSS and, for capped processes, the named enforced metric against the cap, the enforcement mode and restarts in 15 min; collapsed settings strip with `(•)/( )` selection and bracketed disabled controls; toast; key-hint footer in priority order (`quit` always visible, `[?] keys` overlay). Sidebar at ≥ 100 columns, single column at 80, minimum 60×16 with a notice naming `zcode-kit proxy status`. TERM=dumb and non-TTY refuse and print `zcode-kit proxy status` and `zcode-kit proxy logs 50`. NO_COLOR keeps bold/reverse/text markers; 16-colour roles; wgl4/ascii tiers; alt-screen/cursor/mouse/raw mode restored on every exit path. Polls ≥ 5 s, one request per source, no new endpoints; every existing action reachable. Closes A-03, A-18 (except the filter).

**Acceptance criteria:**

- [ ] Seam 6 frame tests per tier and size (80, 100, 120, 60×16, below minimum), NO_COLOR markers, TERM=dumb refusal.
- [ ] Exit-path tests restore terminal state (signal, error, quit); poll-interval test with an injected clock.
- [ ] Action-reachability test for provider/plan switching, login, start/stop. S6 within budget.
- [ ] The TERM=dumb refusal exits 1, the same code as today's non-TTY refusal (`tui/app.ts:43-48`), and prints `zcode-kit proxy status` and `zcode-kit proxy logs 50`; the non-TTY refusal keeps exit 1.

**Common acceptance (every ticket):**

- [ ] tests start RED and turn GREEN at the named seam
- [ ] the fast suite and the `memory-budget` job stay green on ubuntu and windows
- [ ] new test files are wired into a script (wiring guard, ticket 04)
- [ ] no pre-existing test changes without a justification in the ticket
- [ ] evidence (test summary, metrics delta, snapshot diff) is recorded in the ticket file before closing
- [ ] every new log event uses the event-line format (ticket 14)
- [ ] every new config key is optional and documented in `proxy/config.example.yaml`
- [ ] any new env override for a `ZCODE_PROXY_*` key goes through the `proxyEnv` exception list with a test

Spec stories: 117, 119, 120, 121, 122

## Comments
