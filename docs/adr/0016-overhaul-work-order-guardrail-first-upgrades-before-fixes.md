---
status: accepted
---

# Overhaul work order: the memory-budget job lands first, upgrades land before the memory fixes

The kit overhaul deviates twice from the ticket order in the run's PROMPT §7 Phase 3. First, the `memory-budget` CI job on ubuntu and windows lands in step 1, together with the memory loop, its budgets, the process-count harness, the Windows sampler and the expected-RED list, instead of last with the other CI guardrails (principle 8). Second, the three upgrade batches (toolchain & CI, proxy deps, MCP deps) land before the memory and process fixes (principle 4 after principle 3). The first is needed because the expected-RED list exists precisely so that a job which is RED at baseline can land first, and because the Bun 1.4.2 Windows reference run must be the draft PR's first CI run on the loop code merged before the toolchain batch; without the job in CI at step 1 the Windows baseline cannot exist before the upgrades. The second makes every fix start RED on the runtime it ships on, and keeps the captcha suite green after the happy-dom bump before any other captcha-path change. The Bun 1.4.2 baseline stays the budget reference.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Sources: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 2, Q14 condition 1 and Q15 condition 2; Round 3, Q9 condition 1; Round 4, Q5 deviation D2.

## Binding conditions

1. **Step 1 is the whole guardrail:** the loop with budgets, the process-count harness, the Windows sampler and the `memory-budget` job on both OS legs with the expected-RED list (scenario/variant → ticket id, per OS). Step 8 keeps only the remaining guardrails (snapshot-update refusal, test-wiring guard).
2. **Upgrades before fixes, each batch green before the next.** The proxy typecheck and its pinned `typescript`/`@types/bun` move into batch 1.
3. **Every memory-fix ticket's RED test is RED on the upgraded runtime.** If an upgrade alone turns a scenario GREEN, the fix ticket is re-scoped with that evidence, and its expected-RED entry is removed in the ticket that turns it GREEN.
4. **Recorded in RUNLOG** alongside this record.

## Consequences

- The expected-RED list can only shrink; it is empty at the Phase 6 gate.
- The toolchain batch changes the job's Bun pin from 1.4.2 to 1.4.4; the attribution run follows immediately.

## Amended 2026-11-07 (Rounds 10–11)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 10, Q1 and Round 11, Q1.

- **The job's Bun pin stays at 1.4.2 (Rounds 10–11).** This replaces the Consequences line "The toolchain batch changes the job's Bun pin from 1.4.2 to 1.4.4". A paired, interleaved CI measurement on one runner showed Bun 1.4.3 and 1.4.4 raise the Linux S1/burst1 proxy peak against 1.4.2 (5 / 14 / 13 of 24 runs above 250 MB; one-sided Fisher p = 0.0086 and 0.0178). So no newer Bun passes the full suite there, and C5 picks 1.4.2. One pin applies everywhere: CI, the `memory-budget` job, release.yml and the installers. The attribution run is moot, because the runtime does not change.
- Condition 3 is upheld, not contradicted: every memory fix starts RED on 1.4.2, the runtime the kit ships.
- Ticket 62 owns moving the pin forward under Round 11 Q1 condition 4's re-entry rule.
