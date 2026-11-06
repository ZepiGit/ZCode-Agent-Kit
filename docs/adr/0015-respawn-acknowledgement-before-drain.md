---
status: accepted
---

# Respawn acknowledgement: the proxy drains for memory only after the manager has reserved the budget

When the proxy respawns for memory, it spawns the respawn hook with unchanged arguments (`respawn <pid> --reason memory`) and waits up to 10 s for the respawn acknowledgement: a `logs/respawn.json` event whose `pid` equals its own and whose `at` is later than its request time. Only then does it drain. On a refusal (hook exit 4) or no acknowledgement it does not drain: it keeps serving, logs ERROR once, reports `restarts` as exhausted, and retries after the budget window. This closes the hole [ADR-0008](0008-proxy-health-supervisor-and-respawn-handoff.md) condition 1 names: `launchRespawnHook` resolves on the hook's `spawn` event and the budget is reserved only afterwards, so a refusal left zero proxies. The file is the only channel that also works with an old manager, which already writes `{at, pid, reason}` by temp + rename exactly at reservation. It needs no new hook arguments and carries no EPIPE risk.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 3, Q4 (ACCEPTED with the binding conditions below; extends ADR-0008).

## Binding conditions

1. **One additive env variable carries the log dir.** It is a `ZCODE_KIT_*` variable that survives `proxyEnv`, a test proves it, and the `proxy.log` writer reuses it. Nothing else in the proxy's env contract changes.
2. **The proxy watches the hook's `exit` during the wait.** Exit 4 counts as a refusal at once. After the wait the proxy unrefs the hook handle; the detached hook must outlive the proxy.
3. **The timing invariant is tested.** Respawn wait (30 s) > acknowledgement wait (10 s) + `STOP_GRACE_MS` + margin ([ADR-0014](0014-graceful-stop-request-over-loopback.md)). A late acknowledgement must end in "healthy and ours → already running, 0", never in a second proxy or a kill of the serving one. Test: an acknowledgement after the proxy's timeout leaves exactly 1 proxy, with the budget slot consumed.
4. **A backwards wall-clock jump fails safe.** A missed acknowledgement means "keep serving", never "drain". Matching on `pid` plus `at > requestTime` makes an earlier event for the same pid unmatchable. Both are tested.
5. **The watchdog path is bounded.** A proxy whose main thread hung waits for the acknowledgement or refusal for at most the same 10 s, then terminates itself regardless and logs which outcome it saw. A refusal there can end with zero proxies. That is accepted: a hung proxy serves nobody, and the next launch's preflight starts a fresh one without the 36–44 s hung-proxy proof.
6. **Retries after a refusal are bounded:** at most one hook spawn per budget window while the hard condition persists, since each spawn is a transient manager process. The ERROR line uses the event-line format of [ADR-0010](0010-observability-contract.md), and the `restart budget` check in `doctor` shows the state.

## Considered options

- **An acknowledgement on the hook's piped stdout:** rejected. An old manager never writes it, and a closed pipe raises EPIPE in the hook.
- **New hook arguments:** rejected. After an update an old running proxy calls the new manager, and its arguments must stay valid (Round 2, Q11).

## Consequences

- Old proxies meeting a new manager keep today's behaviour; the gap cannot be fixed from the manager side and is documented.
- A cross-version handoff contract: the `respawn.json` event shape is now read by the proxy and cannot change without breaking it.
