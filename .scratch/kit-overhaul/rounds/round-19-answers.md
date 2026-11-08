# Owner Proxy round 19: answers (ticket 26 on the pinned Bun 1.4.2: the unset-setting half)

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–18 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it names the decision.

I checked the evidence myself, read-only:
- `ticket/26-captcha-egress-bun` at 2378294 (`git -C /home/AgentKit/wt/t26 show HEAD:…`):
  - `issues/26-*.md` (the implementer report);
  - the diff 482eef5..HEAD, which touches only three files: `captcha-happy.ts` (+23/−6), `captcha-egress.test.ts` (+116) and the ticket;
  - `captcha-egress.test.ts:147-161`: the unset case is gated as `Bun.semver.satisfies(Bun.version, ">=1.4.3") ? it : it.failing`. The test name is "goes direct when the setting is unset, even with ambient HTTP(S)_PROXY" and **does not carry the version condition**. The recommendation's "with the version condition in the test name" is therefore a change still to be made, not a description of the branch;
  - `src/index.ts:244-253`: the `captcha egress:` banner already prints "explicit proxy (invalid URL; requests will fail)" for an invalid setting.
- Call sites: `captcha-happy.ts` is loaded only by `captcha-solver-worker.ts:69` (dynamic import) and by tests. `captchaFetch` (cookie priming `:1776`, passthrough `:399`) and the sync-XHR worker (`SYNC_WORKER_SRC`, a thread spawned inside the solver) both run inside the solver. Once ticket 27 runs the solver as a child process, **all** captcha egress runs in that child's process environment.
- `reports/t26-*`:
  - `probe2.log`: on 1.4.2 `proxy: false`, `""`, `null` and `undefined` all go via the ambient proxy; `{}` and `{url:""}` are rejected; `{respectNoProxy}` with `NO_PROXY=*` still goes via the proxy. On 1.4.3 and 1.4.4 only `false` goes direct. So **no per-request option gives a direct route on 1.4.2.**
  - `probe3.log`: env changes inside a Worker (delete, `NO_PROXY=*`, the `env` option) have no effect. Only a main-thread `NO_PROXY` does.
  - `probe-tf.log`: `it.failing` and `Bun.semver` work on 1.4.2.
  - `red-142`/`red-144`/`green-142`/`green-144`/`mutants`: match the report (five mutants killed, restored clean each time).
  - `green-142.log:11` prints the declared-failing case as `(pass)`, so it cannot be told apart from a real pass in the output.
  - `captcha-last.log`: 136 pass, 0 fail. `full-kit`: 836 / 817 pass / 0 fail / 19 skipped. `full-mcp`: 97 / 96 / 0 / 1. `full-proxy`: 1387 pass, 0 fail. `full-typecheck`: 0 `error TS`.
- `research/undici-yaml.md` items 2–3 and lines 73–79: the dispatcher is ignored (oven-sh/bun#38840), and Bun reads `HTTP(S)_PROXY`/`ALL_PROXY` on each fetch.
- Integration tree 5e99b52:
  - `lib/proxy-env.mjs`: the managed proxy strips `HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY` and the npm/yarn/pnpm proxy variables, in any case;
  - `proxy/config.example.yaml:57-59`: "ambient HTTP_PROXY/HTTPS_PROXY variables are ignored";
  - `spec.md` §2 (environment parity, thread transport = "tests and fallback") and §13;
  - `docs/adr/0002-*.md:46, 54`;
  - `issues/24`, `27`, `28`, `54`, `62`.
- DECISIONS.md Round 1 Q17, Round 2 Q2 condition 5, Round 5 (26 → Risk medium), Rounds 10–11 (the 1.4.2 pin, the re-entry rule in condition 4, the forgone-fix list, the release-note stay-back).

---

## Q1 — how does ticket 26 close when half of it needs Bun ≥ 1.4.3?

**DECISION:** REJECTED in part.

**Accepted:**
- Ticket 26 closes with the configured-proxy half and the fail-closed behaviour.
- Its unset-setting guarantee moves to ticket 27, which strips the ambient proxy variables from the solver child's environment.
- The `it.failing` declaration is accepted as the record of a known runtime gap.
- Ticket 62 records the gap.
- The pin stays at Bun 1.4.2.

**Rejected:**
- **"…unless `ZCODE_PROXY_UPSTREAM_PROXY` is set".** The child is spawned **always** without ambient proxy variables. The set is the one `lib/proxy-env.mjs` already strips: `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` in any case, plus the npm/yarn/pnpm proxy variables. Only the setting itself passes. When the setting is set, the configured URL reaches every routed fetch through the explicit `proxy:` option, which test 1 shows is honoured on 1.4.2. Leaving the ambient variables in the child would only keep a latent route for any fetch that does not pass `proxy:`. Ambient `NO_PROXY` would also leave open whether it bypasses the configured proxy. One unconditional rule is stricter (C6) and simpler (C9). Round 1 Q17 already decided that ambient variables are never an egress input.
- **"`it.failing` … with the version condition in the test name" as a description.** The branch's name lacks the condition (see the evidence above). The rename is a binding change, because the runner prints the declared-failing case as `(pass)` and the gap would otherwise be invisible.

**Explicit relation to earlier rounds:**
- **Round 1 Q17** stands as decided. Its premise that `proxy: false` gives a direct route holds only from Bun 1.4.3. On the 1.4.2 pin (Round 11) the guarantee is delivered by 26 and 27 together. This corrects the premise, not the decision.
- **Round 2 Q2 condition 5 / ADR-0002** ("the child gets the inputs the worker gets today"). **This narrows that wording explicitly.** The ambient proxy variables are no longer passed. They are not a solve input but the undeclared route Q17 removes. Solve inputs, outputs and the 90 s deadline stay byte-identical, and so do the unsandboxed flag, the CDN cache variables and the egress setting.
- **Round 11:** unchanged. This finding is **not** a reason to move the pin. 1.4.3 has failed the memory re-entry rule, and there is a 1.4.2 remedy that does not touch the proxy's own traffic.
- **Round 11 condition 4 (re-entry rule):** gains one explicit item (condition 4 below). It is a tightening already implied by C5's "passes the full test suite". It loosens nothing.

Binding conditions:

1. **Ticket 26 closes on this criterion** (the text is in "Ticket-text changes" below):
   - configured setting: fetch, sync-XHR and https CONNECT go through the configured proxy, and the ambient proxy and the targets receive nothing;
   - invalid setting: fails closed, and no listener receives anything;
   - unset setting with ambient variables: a plain test on Bun ≥ 1.4.3, declared `it.failing` on Bun < 1.4.3.

   The CI item ("fast suite and `memory-budget` on ubuntu and windows") stays open until the orchestrator has verified it after merge and push, as the ticket says. Nothing else is re-run.
2. **The declared-failing test.**
   - The gate stays exactly `>=1.4.3`.
   - The name gains the condition, for example: `goes direct when the setting is unset, even with ambient HTTP(S)_PROXY (declared failing on Bun < 1.4.3: proxy:false ignored, ticket 62)`.
   - The ticket's suite counts say "136 pass, including 1 declared-failing case on Bun 1.4.2" (and the same for the proxy suite's 1387).
   - The gap is not hidden: tests 1 and 3 use the same child harness, so a harness break still turns them RED. `it.failing` itself turns RED if the case passes unexpectedly.
   - This is an accepted known-gap record, not a skip. It is the only such declaration this round allows.
3. **Ticket 27 owns the process-level guarantee on 1.4.2.**
   - What it builds:
     - the solver child's environment excludes the ambient proxy set from the Rejected list, whether or not the setting is set;
     - `ZCODE_PROXY_UPSTREAM_PROXY` passes unchanged.
   - Its new seam-3 test runs on the pinned 1.4.2 as a **plain test with no version gate**. It goes through the child adapter, with mixed-case ambient `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` in the parent's environment:
     - unset → `captchaFetch` (http and https CONNECT) and the sync-XHR path go direct, and the ambient recording proxy receives nothing;
     - set → all three go only through the configured proxy;
     - a unit assertion that the child's environment holds none of the stripped names, in any case.

     The test uses loopback mocks only, on port 0.
   - The test must exercise the real `captchaFetch`/`syncFetchBlocking` inside the child. A fixture backend that bypasses them does not satisfy it.
   - Ticket 28 is unaffected.
4. **Ticket 62 records the gap and guards against re-gating.**
   - The forgone-fix list (Round 11 condition 4) gains an entry: "`fetch({ proxy: false })` ignored on 1.4.2 when ambient proxy variables are set". The entry carries:
     - the evidence (`reports/t26-probe2.log`, measured);
     - the primary release-note reference if one exists, otherwise "observed, not found in the release notes";
     - the kit path that hits it: captcha egress under the thread transport, plus the module-level test. The child adapter is covered by 27.
   - Re-entry gains item (v): the candidate passes `captcha-egress.test.ts` with the unset case running as a plain test. **The `>=1.4.3` gate is never moved to admit a candidate**, just as n is never raised.
5. **Residual exposure.** On Bun 1.4.2, after 27, ambient egress is possible only when all three hold:
   - a standalone proxy (the managed proxy is stripped by `proxyEnv`);
   - ambient proxy variables in its shell;
   - the thread transport.

   **EVIDENCE MISSING: how the thread transport ("tests and fallback", spec §2) is selected in a non-test run.** Ticket 27 decides this and records it. If the thread transport can run outside tests on Bun < 1.4.3, it comes back to the Owner Proxy as a finding. The question then is the `captcha egress:` banner's "direct" claim in that case. I do not prescribe banner wording now. Nothing reaches users before Phase 6 (B6), so the interim state on the integration branch is not a release exposure.
6. **Announced, not silent (C2, C8).**
   - Ticket 54's release notes gain one line: "On Bun, captcha egress now honours `ZCODE_PROXY_UPSTREAM_PROXY`. An invalid value now fails captcha requests, as the startup banner already stated and as Node already did."
   - If condition 5's residual is reachable in the shipped build, the Bun 1.4.2 stay-back text (Round 11 condition 6) also names it.
   - `config.example.yaml`'s "ambient … ignored" line stays. It is true for the managed proxy and, after 27, for the child adapter.
   - No README, SECURITY or SUPPORT_MATRIX change: no command, flag, env var or support claim changes.
7. **Records.**
   - Spec §13 gains one sentence: "On Bun < 1.4.3 `proxy: false` is ignored when ambient proxy variables are set. The unset case is then guaranteed by the solver child's environment (§2, ticket 27)."
   - Spec §2's environment-parity bullet gains the exclusion.
   - ADR-0002 gets an amendment line next to line 54: "Round 19: the solver process's environment also excludes the ambient proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, any case, and the npm/yarn/pnpm proxy variables); `ZCODE_PROXY_UPSTREAM_PROXY` passes."
   - RUNLOG records this round as narrowing Round 2 Q2 condition 5.

**Rationale:** The evidence settles that no change confined to captcha code can give a direct route on Bun 1.4.2:
- every per-request option either still takes the ambient proxy or is rejected (probe2);
- worker-scoped env changes are ignored (probe3);
- a process-wide `NO_PROXY` would reroute the proxy's own LLM traffic, which B1/C2 forbid.

Moving the pin is closed by Round 11's measured memory result. The process boundary that ticket 27 builds anyway is the only remedy inside the boundaries. Every captcha fetch runs in the solver, and a child's environment is its own, so stripping there closes the gap without touching anything else. Splitting the ticket this way keeps 26's verified gains: the configured setting is honoured, and an invalid URL now fails closed instead of silently taking the ambient route. Making the strip unconditional removes a branch and a latent route at no cost, because the configured URL is always passed explicitly. The test-name and count conditions exist because the runner reports the known gap as a pass.

**Charter:** C6 (no undeclared egress route; stricter, never weaker), B1 (routing and environment only; solve I/O, the 90 s deadline and challenge handling unchanged; the proxy's own traffic untouched), C2 (the managed proxy is unchanged; the invalid-URL behaviour matches the banner and Node; announced in the release notes), C5 and C1 (the 1.4.2 pin from Round 11 stands; re-entry tightened, not loosened), C8 (spec, ADR amendment, release notes), C9 (stronger measured evidence: probes on three Bun versions and five killed mutants; smaller blast radius: one environment rule in an already-planned ticket; simpler: one unconditional strip set, shared in meaning with `proxyEnv`), Round 1 Q17, Round 2 Q2 condition 5 (narrowed explicitly), Round 11 conditions 4 and 6.

**REVERSIBILITY:** Two-way door: ticket text, a test name, an environment filter on a not-yet-built child and an amendment line. ADR: no new ADR; one amendment line in ADR-0002.

### Ticket-text changes (exact)

**`issues/26-captcha-egress-routing-under-bun.md`** — replace the single acceptance criterion with:

```
- [ ] Seam 3 test with a local recording proxy (Round 19): setting set → all captcha egress (`captchaFetch` http, sync-XHR, https CONNECT) goes through it and the ambient proxy receives nothing; setting invalid → all three fail closed and no listener receives anything; setting unset with ambient `HTTP(S)_PROXY` set → no proxy used, a plain test on Bun ≥ 1.4.3 and declared `it.failing` on Bun < 1.4.3 with that condition in the test name (gate `>=1.4.3`, never moved). On the pinned Bun 1.4.2 the unset-case guarantee is delivered by ticket 27 (solver child environment without ambient proxy variables).
```

and add a Comment: `- 2026-11-08 (orchestrator, Owner Proxy round 19, binding): closes on the amended criterion; the unset case on Bun 1.4.2 moves to ticket 27; suite counts include 1 declared-failing case on 1.4.2; the test name carries the version condition.`

**`captcha-egress.test.ts`** (on ticket 26's branch before merge) — the unset case's name becomes:
`goes direct when the setting is unset, even with ambient HTTP(S)_PROXY (declared failing on Bun < 1.4.3: proxy:false ignored, ticket 62)`

**`issues/27-solver-child-process.md`**:
- In What to build, replace `Environment parity: \`ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA\`, CDN cache variables and the egress setting pass; \`ZCODE_KIT_RESPAWN_*\` and \`ZCODE_KIT_STOP_TOKEN\` are excluded;` with:
  `Environment parity: \`ZCODE_PROXY_ALLOW_UNSANDBOXED_CAPTCHA\`, CDN cache variables and the egress setting (\`ZCODE_PROXY_UPSTREAM_PROXY\`) pass; \`ZCODE_KIT_RESPAWN_*\`, \`ZCODE_KIT_STOP_TOKEN\` and the ambient proxy variables (\`HTTP_PROXY\`, \`HTTPS_PROXY\`, \`ALL_PROXY\`, \`NO_PROXY\`, any case, and the npm/yarn/pnpm proxy variables, the set \`lib/proxy-env.mjs\` strips) are excluded, whether or not the egress setting is set (Round 19);`
- Add acceptance items:
  ```
  - [ ] Seam 3 (egress, Round 19, from ticket 26): on the pinned Bun 1.4.2, through the child adapter, with mixed-case ambient `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` in the parent's environment: setting unset → the real `captchaFetch` (http and https CONNECT) and the sync-XHR path inside the child go direct and the ambient recording proxy receives nothing; setting set → all three go through the configured proxy only; the child's environment contains none of the excluded proxy names in any case. Plain test, no version gate; loopback mocks only.
  - [ ] The ticket records how the thread transport is selected outside tests. If it can run outside tests on Bun < 1.4.3, that returns to the Owner Proxy as a finding (Round 19 condition 5) before closing.
  ```

**`issues/62-bun-1-4-3-plus-s1-burst1-peak.md`**:
- Append to the re-entry rule paragraph: `Round 19: the candidate also passes \`captcha-egress.test.ts\` with the unset case running as a plain test; the \`>=1.4.3\` gate is never moved to admit a candidate.`
- Add acceptance item:
  ```
  - [ ] The forgone-fix list includes "`fetch({ proxy: false })` ignored on 1.4.2 when ambient proxy variables are set" (measured: reports/t26-probe2.log; primary release-note reference, or "observed, not found in the release notes"); kit path hit: captcha egress under the thread transport and the module-level egress test; the child adapter is covered by ticket 27's environment strip (Round 19).
  ```

**`issues/54-*.md`** — add a Comment: `- 2026-11-08 (orchestrator, Owner Proxy round 19, binding): release-notes line: "On Bun, captcha egress now honours ZCODE_PROXY_UPSTREAM_PROXY; an invalid value now fails captcha requests, as the startup banner already stated and as Node already did." If ticket 27's record shows the thread transport reachable outside tests on Bun < 1.4.3, the Bun 1.4.2 stay-back text also names the ambient-proxy gap.`

**`issues/28-*.md`** — no change.

---

## Shared understanding

Open branches I still see (none blocks merging ticket 26):
- **EVIDENCE MISSING:** how the thread transport is selected outside tests. Ticket 27 records it, and if it is reachable on Bun < 1.4.3 it returns as a finding about the `captcha egress:` banner (condition 5).
- Ticket 27's new egress test fails on 1.4.2 through the child adapter. That would mean Bun reads something other than the child's process environment, and it comes back as a question. No version gate is added to make it pass.
- Ticket 26's CI item (both `memory-budget` legs, fast suite on ubuntu and windows) is still to be verified after merge and push.
