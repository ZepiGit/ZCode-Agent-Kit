# 62: Bun ≥ 1.4.3 raises the S1/burst1 proxy peak on the CI runners (re-entry gate for a newer Bun)

**Blocked by:** 20 (Fewer redundant request-body copies (bytes upstream unchanged))

**Status:** needs-triage

Model: sol
Risk: medium
ADR: 0016 (amendment line from Round 11)

**What to build:** Round 11 Q1 condition 4 (DECISIONS.md, binding). The kit pins Bun 1.4.2 everywhere because the paired CI run 42352122623 (24 interleaved runs per arm, same host) showed Linux S1/burst1 above 250 MB in 5/24 runs on 1.4.2, 14/24 on 1.4.3 and 13/24 on 1.4.4 (Fisher one-sided vs 1.4.2: 0.0086 / 0.0178; on values p ≈ 2e-4 / 2e-5). Windows: 12 / 17 / 19 of 24 (information only). Runners: Intel Xeon Platinum 8573C, 4 cores, cgroup v2-only; the local AMD EPYC 8-core host shows no step. Artefacts: /home/AgentKit/overhaul-tools/ci-art/t09-paired-1fRC/ (also t09-measure-XAT9/, r8-measure-nGEr/). Triage: list the Bun 1.4.3 and 1.4.4 fixes the kit gives up by staying on 1.4.2 (from the primary release notes), and rerun the paired measurement mode (ticket 09: marker `24 bun=1.4.2,<candidate>`) after ticket 20 merges and at each new Bun stable release.

**Re-entry rule for a newer Bun (binding, Round 11 condition 4):** all runs valid and ≤ 400 MB; Linux stable at the current n on the less favourable estimate; Fisher vs the pinned arm p > 0.05; Windows median ≤ 300 MB. n is never raised to admit a candidate. Round 19: the candidate also passes `captcha-egress.test.ts` with the unset case running as a plain test; the `>=1.4.3` gate is never moved to admit a candidate.

**Acceptance criteria:**

- [ ] Triage decision recorded with the paired numbers and the list of forgone 1.4.3/1.4.4 fixes.
- [ ] After ticket 20 merges: one paired run on the integration tip; the re-entry rule applied and its reading recorded.
- [ ] The forgone-fix list includes "`fetch({ proxy: false })` ignored on 1.4.2 when ambient proxy variables are set" (measured: reports/t26-probe2.log; primary release-note reference, or "observed, not found in the release notes"); kit path hit: captcha egress under the thread transport and the module-level egress test; the child adapter is covered by ticket 27's environment strip (Round 19).

## Comments
