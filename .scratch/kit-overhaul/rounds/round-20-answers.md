# Owner Proxy round 20 — answers

Evidence read (read-only):
- Ticket 25 at head a18d465: `git -C /home/AgentKit/wt/t25 show HEAD:.scratch/kit-overhaul/issues/25-bounded-collections-cdn-memory-and-stall-counters.md`, including the implementer's Decisions 1–3.
- `zcode-proxy-src/src/proxy/captcha-cdn-cache.ts` at a18d465, the whole file.
- `tests/memory/scenarios/s2-captcha.mjs:101-125` and `tests/memory/scenarios/s2-captcha-run.ts:95-109`, at a18d465.
- `docs/adr/0009-bounded-stores-and-task-retention.md` at a18d465.
- Reports `t25-s2-{before,after}-{1,2,3}.log`, `t25-s2-after64-1.log`, `t25-s2-exp32.log`, `t25-s2-exp24.log`, `t25-probe-D.log` and `t25-probe-budget.log`.
- `/home/AgentKit/overhaul-tools/t25-memloop/alternate.txt` and the run directories.
- spec.md §7 (bounds table, CDN memory row) and §18 (S2 CDN memory row), plus stories 62–64.
- `issues/25-*.md` and `issues/29-cdn-disk-cache-pruning.md`.
- DECISIONS.md Round 2 Q3, Round 15 Q1 (conditions 3, 5, 6 and 7) and Round 17 Q1.
- PROMPT.md §5 B1 and §9 BOUNDS.

**Corrections to the round's facts.**
1. **S2 does not measure what the recommendation's condition asks for.** Phase D (`s2-captcha-run.ts:95-109`) only calls `cache.put()` on 600 distinct URLs with 256 KiB bodies. It never calls `get()` or `load()`. S2's solves run against the fixture backend with egress blocked, so they never reach the vendor CDN. On S2's workload, the "CDN fetch count per solve" is zero both before and after the change, by construction. It cannot show whether a smaller memory tier causes more network fetches.
2. **The 392-invalidation replay proves the stall-counter bound, not the body cap.** That recording (`__fixtures__/stall-recording.json`) replays the stall path. It does not exercise eviction of memory-tier bytes, so it says nothing about how often bodies are fetched under a 32 MiB cap.
3. **The 64 MB budget is not "tightened".** The 64 MB bound in spec §7 and §18 and in ADR-0009 stays exactly as it is, as the memory the tier costs (`cdn-cache:memory-growth`). The 32 MiB is the mechanism that meets that bound: the bytes the tier may hold. Also, "Charter §9" is not a Charter clause. §9 is PROMPT's acceptance section, and its BOUNDS line names no number for this store.
4. **The headroom depends on the scenario.** Phase D run alone in a fresh process (`t25-probe-budget.log`) measures **70 MB at 32 MiB**, which is above 64. The 57–58 MB GREEN holds inside full S2/short, where phases A–C have already warmed the allocator. The Linux margin is 6–7 MB, and the windows number does not exist yet.
5. **Verified as stated:**
   - 64 MiB → 90 MB RED (`t25-s2-after64-1.log:52`).
   - 32 MiB → 57/57/57 MB (after-1..3) and 58 MB (exp32), 4/4 ok.
   - Before → 151 MB RED in 3/3 runs.
   - 24 MiB → 50 MB.
   - Windows is pending CI.
   - The ticket adds no config key or env override for the cap. It is the constant `CDN_MEMORY_MAX_BYTES`.

## Q1 — confirm or reject the 32 MiB body cap

**DECISION:** ACCEPTED with conditions. I confirm the cap of 32 MiB of bodies. I **REJECT** the recommendation's B1 evidence condition, because it cannot be measured on S2 (correction 1). A replay proof at seam 3 replaces it. Binding conditions:

1. **The cap.**
   - The memory tier holds ≤ 256 entries and ≤ 32 MiB (33,554,432 bytes) of bodies, as the code constant `CDN_MEMORY_MAX_BYTES`.
   - No config key and no env override. The ticket exposes none, so the recommendation's "as a config value if the ticket already exposes one" does not apply. Adding a knob nobody has asked for would add surface without evidence (C9, simpler).
   - The 64 MB budget of `cdn-cache:memory-growth` and the 256-entry limit are unchanged.

2. **B1 replay proof (replaces "CDN fetch count per solve on S2").** Add a seam-3 test, wired into `npm run test:proxy`, that replays a recorded sequence of `load()`, `get()` and `invalidate()` calls within one generation.
   - **The recording:**
     - distinct URLs whose bodies total more than 64 MiB, so both caps evict;
     - repeat reads of evicted URLs;
     - stall invalidations;
     - at least one TTL expiry on a fake clock.
   - **Three replays, each with a temp disk tier:**
     - (a) the pre-change cache, `captcha-cdn-cache.ts` at 8e11d15 evaluated verbatim, with an unbounded memory tier. This uses the same method as the stall recording.
     - (b) head at 32 MiB.
     - (c) head with the byte budget set to 64 MiB.
   - **What must match across (a), (b) and (c):**
     - the sequence of `fetchBody` invocations (URL, order and count) is identical;
     - every returned entry has identical body bytes, `sha256` and `fetchedAt`;
     - only `source` (memory or disk) may differ.
   - **Mutants that must be killed:**
     - a disk read-back that resets `fetchedAt`;
     - a read-back that skips the freshness check.
   - **Disk tier unavailable.** Record the fetch counts of (a), (b) and (c) in the ticket evidence. This is a recorded number, not a gate.

3. **Return paths.**
   - **The replay differs between (a) and (b) with the disk tier available.** It comes back with the numbers. The implementer changes neither the cap nor the test.
   - **The windows leg is RED.** The pre-merge CI windows memory leg must show `cdn-cache:memory-growth` ok. If it is RED, it comes back with the numbers: commit, working set and the Linux value (Round 6 Q2 condition 1, Round 15 Q1 condition 5). Three things are forbidden:
     - lowering the cap to 24 MiB unilaterally;
     - re-adding the name to `S2/short`;
     - touching the 64 MB budget.

4. **Records.** Apply the text changes below, with a Comments line naming this round. Decision 1 in ticket 25 gains three facts:
   - the 70 MB figure for phase D alone (correction 4);
   - that the GREEN is measured inside full S2/short;
   - the shared-directory read-back nuance (rationale, last paragraph).

**Rationale:**
- **Why a tier bound cannot be held as bytes.** The measurement shows that 64 MiB of held bodies cannot meet a 64 MB tier bound:
  - 90 MB in full S2;
  - 101 MB for phase D alone;
  - a plain-array control at +141/+74 MB, which places the overhead in the runtime's allocator, not in the cache.

  The honest choice under C1 is to keep the measured bound and shrink what the tier holds. Re-reading "64 MB" as bytes held would loosen the budget past what the check measures, which is forbidden.
- **Why 32 MiB.** It meets the check in 4/4 Linux runs. It is the larger of the two measured passing budgets, so it evicts least. 24 MiB buys margin at the cost of more evictions, with no evidence that the margin is needed.
- **Why B1 holds with the disk tier available.** On B1, the code settles the question more strongly than an S2 count could:
  - `get()` applies the same `fresh(fetchedAt)` test to memory and to the disk envelope (`captcha-cdn-cache.ts:84-107`);
  - promotion keeps `fetchedAt`;
  - `commit()` writes the envelope at the same moment it inserts into memory.

  So with the disk tier available, an entry evicted from memory produces the same network-fetch decision and the same bytes as an unbounded tier. Condition 2 turns that reading into a replay against the verbatim pre-change code, which is Round 2 Q3's rule ("changes memory, never which bytes are served") applied as a test.
- **Where a network fetch can still follow an eviction.** Only where the envelope is missing:
  - the disk tier is unavailable;
  - the envelope is corrupt;
  - another installation invalidated it;
  - ticket 29's 256 MB size prune removed it.

  Any memory bound has this effect, including the spec's own 64 MiB. Round 2 Q3 and ADR-0009 accepted it for the memory caches. It is the same in kind as the existing per-generation reset, which already empties memory at every recycle. Halving the cap moves the threshold. It does not create a new behaviour, and it touches nothing on B1's out-of-scope list (pass rates, client mimicry, rotation, quotas). It falls under the IN SCOPE item "hard memory caps, bounded pools".
- **Shared directory.** In the same way, a read-back from a directory shared with another installation can return that installation's newer envelope for the same URL. The pre-change code already does this at the start of every generation. The ticket records it rather than claiming it never happens.

**Consistency with earlier decisions:**
- **Round 2 Q3 / ADR-0009:** the 64 MB / 256 bound stands, and the tier is clarified, not changed.
- **Round 15 Q1:** 25 still owns `cdn-cache:memory-growth` at 64 MB. Its removal from `S2/short` still needs the windows pre-merge GREEN (condition 5).
- **Round 17 Q1:** the responses store stays unchanged. The ticket keeps 1,000 / 24 h / 64 MB, and this decision does not touch the store.
- **Spec:** "≤ 64 MB" is kept. The amended text names the body budget beside it.

No earlier round and no spec text is contradicted.

**EVIDENCE MISSING:** the real per-generation CDN working set (the number and size of distinct bodies one solver generation loads in real use). If it is below 32 MiB, the cap is never reached and nothing changes in practice. The decision does not depend on it, because condition 2 proves equivalence for any working set while the disk tier is available. It would size the disk-unavailable effect recorded in condition 2.

**Charter:**
- C1: the tier's memory is bounded by what the OS measures, and the bound is not redefined to fit.
- C9: stronger measured evidence (4/4 runs, plus the allocator control); then the smaller blast radius (one constant and docs; the 256-entry limit and the budget unchanged); then the simpler option (no new config key).
- C2: no key, flag or state change.
- C7: the windows leg is gated before the name is removed.
- C8: spec, ticket and ADR text aligned.
- PROMPT §5 B1, with its IN SCOPE "hard memory caps, bounded pools".
- PROMPT §9 BOUNDS.
- Round 2 Q3, Round 15 Q1 conditions 5 and 6, Round 17 Q1.

**REVERSIBILITY:** Two-way door. It is one constant behind an unchanged 64 MB check, and the cache contents are rebuilt every generation. **ADR: no.** ADR-0009 gains an amendment note for the record only.

### Exact text changes (the orchestrator applies them on ticket 25's branch before merge)

**Ticket 25, What to build.** Replace
`The CDN memory cache is bounded to ≤ 64 MB and ≤ 256 entries and resets with each solver generation;`
with
`The CDN memory cache is bounded to ≤ 64 MB of memory (\`cdn-cache:memory-growth\`) and ≤ 256 entries, holding ≤ 32 MiB of bodies (Round 20 Q1), and resets with each solver generation;`

**Ticket 25, Acceptance.** Add after the "Seam 3 (B1)" item:
`- [ ] Seam 3 (B1, Round 20 Q1): a recorded load/get/invalidate sequence within one generation (bodies > 64 MiB in total, repeat reads of evicted URLs, stall invalidations, a TTL expiry on a fake clock), replayed with a temp disk tier against the pre-change cache (8e11d15, verbatim, unbounded memory), head at 32 MiB and head at 64 MiB, makes identical \`fetchBody\` calls (URL, order, count) and returns identical bytes, \`sha256\` and \`fetchedAt\` (only \`source\` may differ); mutants "read-back resets fetchedAt" and "read-back skips the freshness check" are killed; the fetch counts with the disk tier unavailable are recorded for all three. A difference with the disk tier available comes back with the numbers.`
`- [ ] Loop S2 windows (Round 20 Q1): the pre-merge CI windows memory leg shows \`cdn-cache:memory-growth\` ok at 32 MiB; if RED it comes back with commit, working set and the Linux value — the cap, the list and the 64 MB budget are not changed.`

**Ticket 25, Comments.** Add:
`- 2026-11-08 (orchestrator, Owner Proxy round 20): Round 20 Q1 confirms Decision 1 (≤ 32 MiB of bodies, constant, no config key; 256 entries and the 64 MB check unchanged) and moves its B1 proof into Acceptance (seam 3 replay; S2 cannot count fetches: phase D only calls put() and egress is blocked). Decision 1's text gains: phase D alone measures 70 MB at 32 MiB, so the GREEN (57–58 MB, 6–7 MB margin on Linux) holds inside full S2/short; and a read-back from a shared directory may return another installation's newer envelope for the same URL, as every generation start already does.`

**spec.md §7, bounds table, row "CDN cache, memory".** Replace
`| CDN cache, memory | ≤ 64 MB and ≤ 256 entries; resets with each solver generation |`
with
`| CDN cache, memory | ≤ 64 MB of memory (measured, \`cdn-cache:memory-growth\`) and ≤ 256 entries; holds ≤ 32 MiB of bodies, because the runtime keeps evicted bodies' memory for a while (Round 20 Q1); an evicted entry is read back from its disk envelope or fetched again; resets with each solver generation |`

**spec.md §18, budget table, row "S2 CDN memory".** Replace
`| S2 CDN memory | ≤ 64 MB and ≤ 256 entries | +151 MB / 600 URLs | ADR-0009, loop |`
with
`| S2 CDN memory | ≤ 64 MB and ≤ 256 entries (32 MiB body budget: 57–58 MB on Linux in full S2/short; 64 MiB of bodies measured 90 MB) | +151 MB / 600 URLs | ADR-0009, loop, Round 20 Q1 |`

**Spec story 62:** unchanged. The user-facing bound is still 64 MB and 256 entries.

**ADR-0009.** Append:
`## Amended 2026-11-08 (Round 20, Q1)` / `The CDN memory cache's 64 MB bound is the memory the tier costs, as measured by \`cdn-cache:memory-growth\`. To meet it, the tier holds at most 32 MiB of bodies (and 256 entries): with 64 MiB held, S2 measured 90 MB, because the runtime keeps the memory of evicted bodies for a while. An evicted entry is read back from its disk envelope with the same bytes and \`fetchedAt\`, so with the disk tier available the network fetches are those of an unbounded tier (seam 3 replay, ticket 25). The bound and the two-way-door consequence are unchanged.`

**Ticket 29, Comments** (informational; no criterion, no ownership; Round 15 Q1 condition 6):
`- 2026-11-08 (orchestrator, Owner Proxy round 20): Round 20 Q1: the memory tier holds ≤ 32 MiB of bodies, and an entry evicted from memory is read back from its disk envelope. 29's size prune therefore decides when such an entry becomes a network fetch; 29's B1 evidence ("without serving different bytes") covers that case.`

**METRICS.md:** the S2 CDN row names the 32 MiB body budget beside the 64 MB bound, as the implementer suggested.

## Shared understanding

Open branches:
- **The windows leg of `cdn-cache:memory-growth` at 32 MiB is unmeasured.** A RED comes back under condition 3.
- **The 6–7 MB Linux margin depends on S2's phase order** (phase D alone: 70 MB). A future reorder of S2, or a runtime upgrade that changes allocator retention, can turn the check RED with no code change in the cache. That RED comes back as an unowned RED (Round 15 Q1 condition 5), not as a quiet cap change.
- **EVIDENCE MISSING: the real per-generation CDN working set.** It sizes only the disk-unavailable effect recorded under condition 2.
- **The interaction of ticket 29's 256 MB size prune with the memory tier** (an entry evicted from both tiers is fetched again) is 29's B1 evidence to give. It is not decided here.
