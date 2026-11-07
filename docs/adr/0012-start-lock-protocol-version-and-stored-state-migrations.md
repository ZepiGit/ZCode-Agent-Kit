---
status: accepted
---

# Start lock protocol versions, and how stored state migrates

The start lock gains a protocol version field, and today's version-less record `{pid, startedAt, nonce}` is protocol v0, a known version. The proven-takeover rules of [ADR-0003](0003-start-lock-proven-takeover.md) apply to v0 locks too. Treating the version-less lock as "unknown, never delete" would keep every stale lock that old kits left behind (5 of 8 Ctrl-C trials) after the update, which is the RC-L failure itself. Beyond the lock, new state is added only where it is needed, new `config.yaml` keys are optional, and every migration runs through the transaction mechanism, is idempotent and is tested by replaying it twice. Nothing is removed silently. The lock protocol is a one-way door: old and new kits meet the same lock during an update.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 2, Q10 (ACCEPTED with the binding conditions below).

## Binding conditions

1. **v0 is takeable on proof.** A v0 lock is stale when its holder is dead, or when the live process's start time is later than the lock's `startedAt`. Only an unparsable lock, or a lock of an unknown higher version, is never deleted automatically. Its error gives what/why/next with the exact path.
2. **New locks are written atomically,** so their content is never visible half-written. "Unreadable" can then only mean foreign corruption, never a live contender's partial write.
3. **Old kits can read new locks.** An old kit reads only `pid` and `startedAt` from the record, so the extra fields are harmless. That is tested against the origin/main manager file.
4. **Runtime migrations are tested twice** like the setup migrations: lock versions and retention pruning ([ADR-0009](0009-bounded-stores-and-task-retention.md)). The Account Rotator decision migrates as decided in Round 1, Q8.
5. **Files do change shape, and the release notes say so.** The proposed statement "no existing file changes shape" was wrong: the lock gains a field, an early log appears, and MCP task files and CDN disk entries are pruned. `docs/RELEASE_NOTES_vNEXT.md` (English) and README announce, besides the Round 1 items: MCP task retention (500 / 7 days) and the idempotency window; CDN disk pruning; log rotation while running and the new log file; the memory thresholds moving from 1536/3072 to 512/1024 MB; the solver recycle count moving from 200 to 100; the new JSON fields, the `WARN` value and `completeness: partial` on truncation; the Bun 1.4.4 requirement; shedding during a respawn drain; the Windows graceful stop.

## Considered options

- **Treat a version-less lock as unknown and never delete it (the recommendation as worded):** rejected. It preserves the stale-lock failure the run exists to fix.

## Consequences

- Takeover of a v0 lock compares the live process's start time with the lock's `startedAt`, which is coarser than a recorded holder start time. It is still proof, not a guess: a process that started after the lock was written cannot be its holder.
- A future protocol version must stay readable as `pid`/`startedAt` by every kit still in the field, or it becomes an "unknown higher version" that older kits never touch.
