---
status: accepted
---

# Every growing store has an enforced bound, and finished MCP tasks are retained for 500 tasks or 7 days

Every store with measured or code-evident growth gets an enforced bound and a test for it (§9 BOUNDS, RC4/RC5/RC7). The bounds come from one bounded-collection module lifted from `responses/store.ts` (LRU, TTL, byte budget, injected clock), and the dead `solveTimes` is deleted. The rule behind every bound is that it changes memory and disk use, never which bytes are served (B1). That rule holds for the memory caches. It did not hold for two of the proposed bounds, a TTL on `_stallCounts` and an age prune of the CDN disk cache that ignores a long configured TTL, so both were corrected. Deleting task history cannot be undone for the affected data, which is why the retention policy is recorded here.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 2, Q3 (ACCEPTED with the binding corrections below).

## The bounds

The limits proposed in the round stand where the corrections below do not change them: captcha CDN memory cache ≤ 64 MB and ≤ 256 entries; CDN disk directory ≤ 256 MB; per-task arrays capped (warnings 200, errors 200, tool calls 1,000, response text 4 MiB); TUI log pane 2,000 lines and 8 MB.

## Binding corrections

1. **`_stallCounts` has no TTL.** The count drives a solve-path decision: at 2 stalls of a pe URL the CDN entry is invalidated. A 1 h TTL would reset the count and change when the cache evicts, which changes which bytes are served. It is bounded by count only: 1,024 entries, oldest evicted first. The map is scoped to a solver generation, so with ≤ 100 solves per generation the cap is unreachable in practice and behaviour stays identical.
2. **The CDN disk prune by age removes only entries that are already expired under the configured TTL.** `CAPTCHA_CDN_CACHE_TTL_MS` may be up to ~24.8 days, more than 14 days, so the effective age limit is max(14 days, TTL). The 256 MB byte cap evicts the oldest entries. The directory is derived from HOME and can be shared by several installations and solver processes, so pruning skips temp files and files being written, and tolerates `ENOENT`.
3. **MCP task retention.** A task is evicted when either limit is exceeded: more than 500 terminal tasks, or older than 7 days. Non-terminal tasks are never evicted. Each task's `*.result.json` is pruned with it. A lookup of an evicted task returns the existing not-found error. An evicted task's idempotency key is forgotten, so the idempotency window equals the retention. The tool docs and the release notes say so.
4. **Response-text truncation uses the existing field.** The 4 MiB cap applies to the text that becomes the task's `responseText`. On truncation the existing `completeness` field is set to `partial` with an explanation, which existing consumers already understand. The additive `truncated` marker comes on top. The spec states which part of the text is kept (settled in the amendment below).
5. **What stays unchanged.** The responses store's behaviour and its tests stay as they are. The TUI pane's byte cap is tested against the S6 budget (≤ 16 MB of heap with 64 KB lines).

## Consequences

- The limits are a two-way door. Evicted task history and its idempotency keys are gone for good.
- The release notes announce MCP task retention (500 / 7 days), the resulting idempotency window, CDN disk pruning and `completeness: partial` on truncation (Round 2, Q10).

## Amended 2026-11-06 (Round 3, Q6)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 3, Q6 (ACCEPTED with conditions; no ADR beyond this one).

- **What is kept.** At 4 MiB the text keeps its first 1 MiB and its last 3 MiB, with one marker line `[… N bytes truncated …]`. The end of an agent turn carries the answer and the head carries the framing. The truncation note is merged into the end-state explanation. The transcript fallback gets the same cap. Cached `.result.json` files written before the change are served as stored.
- **The bound applies during ingestion,** not only when the result is built. The head is frozen at 1 MiB, the tail is a rolling 3 MiB window, and the dropped-byte count is tracked. A cut at result time would leave the in-memory buffer unbounded.
- **Units are UTF-8 bytes.** Cuts fall on code-point boundaries, and `N` is a byte count.
- **The `truncated` field stays** (for example `truncated: { droppedBytes }`). The truncation explanation is combined with the terminal-state override, which runs last, so the override cannot erase it.
- **The idempotency wording** is: "Idempotency keys are remembered for as long as the task is retained (at most 500 terminal tasks or 7 days, whichever comes first); after that the same key starts a new task." `docs/MCP_API.md`, the tool description and the release notes carry the cap, the marker and this sentence, and `dist/` is regenerated (B5).
