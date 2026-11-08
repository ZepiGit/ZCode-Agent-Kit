# Owner Proxy round 19 — ticket 26 on the pinned Bun 1.4.2: the unset-setting half does not work

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-19-answers.md` (write nothing inside the integration worktree).

Source: ticket 26's branch (`git -C /home/AgentKit/wt/t26 show HEAD:.scratch/kit-overhaul/issues/26-captcha-egress-routing-under-bun.md`, head 2378294; test `zcode-proxy-src/src/proxy/captcha-egress.test.ts`; logs `reports/t26-*` in the integration worktree), research/undici*.md, DECISIONS.md Rounds 10–11 (Bun 1.4.2 pin) and ticket 62, tickets 27 and 28.

## Q1 — how does ticket 26 close when half of it needs Bun ≥ 1.4.3?

**Facts.** Ticket 26: "On Bun, captcha fetches (`captchaFetch` and the sync-XHR worker path) use `proxy: <ZCODE_PROXY_UPSTREAM_PROXY> ?? false`; Node keeps the dispatcher. Routing only." Implemented. On the pinned Bun 1.4.2:
- configured `ZCODE_PROXY_UPSTREAM_PROXY`: fetch, sync-XHR and CONNECT go through the configured proxy, the ambient proxy gets nothing — works (1.4.2 and 1.4.4);
- unset setting with ambient `HTTP(S)_PROXY`: Bun 1.4.2 still uses the ambient proxy for `proxy: false` (also `""`, `null`, `undefined`); 1.4.3 and 1.4.4 go direct. Changing env inside the worker does not help (Bun reads the process-wide environment). Setting `NO_PROXY` process-wide would also reroute the proxy's own LLM traffic (outside B1/C2). The kit-managed proxy already strips proxy variables from its environment (`lib/proxy-env.mjs`), so exposure is limited to a standalone proxy started from a shell with proxy variables.
- an invalid proxy URL now fails closed (before: all requests went to the ambient proxy).
- The unset-case test is declared `it.failing` on Bun < 1.4.3 (becomes a plain test when the pin moves). Captcha 136/136, kit 817/836, proxy 1387, typecheck 0, mcp 96/97; five mutants killed; loopback mocks only.

**Recommendation.** Ticket 26 merges with the configured-proxy half and the fail-closed behaviour; its unset-setting criterion moves to ticket 27 (solver child process): the child is spawned with an environment that has no `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` (any case) unless `ZCODE_PROXY_UPSTREAM_PROXY` is set, which closes the gap on Bun 1.4.2 without touching the proxy's own traffic; ticket 62's re-entry check gains "the `it.failing` egress test turns into a passing test on the candidate". The `it.failing` declaration is accepted as the record of a known runtime gap (not a skip), with the version condition in the test name.
