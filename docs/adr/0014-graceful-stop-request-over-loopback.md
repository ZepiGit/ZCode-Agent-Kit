---
status: accepted
---

# Graceful stop: an authenticated stop request on the loopback listener, with a per-spawn stop token

The manager asks its own proxy to stop gracefully with `POST /__kit/stop` on the existing loopback listener. The request needs the proxy key and a per-spawn 256-bit stop token, passed to the proxy as `ZCODE_KIT_STOP_TOKEN` and recorded as an additive field in `proxy.pid`. It triggers the single graceful sequence of [ADR-0008](0008-proxy-health-supervisor-and-respawn-handoff.md). The fallback is today's handle-checked `TerminateProcess`/SIGKILL. On Windows no signal or console event can reach a console-less detached proxy (round3-facts §1.3), so today a Windows "graceful" stop is `TerminateProcess`. A loopback request adds the least surface: no new port, file watcher or IPC, and it reuses the repo's own capability pattern (`android/control.ts`). The stop token is needed because the proxy key is written into harness configs, so the key alone would let every harness stop the proxy.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 3, Q3 (ACCEPTED with the binding conditions below; extends ADR-0008).

## Binding conditions

1. **Two credentials, in the existing order.** The route sits after the Host, Origin and bearer checks and additionally requires the stop-token header. Both are compared in constant time, length included. A proxy without a stop token (the TUI hosting the proxy in-process, a standalone proxy) answers the same `404 not_found_error` as an unknown route; it never accepts without a token. No CORS allowance is added. The token never appears in logs, `status`/`--json`, `doctor`, snapshots or error text, and it is stripped from the solver process's environment. On Windows `proxy.pid` is protected by the user-profile ACL, like `.proxykey`.
2. **The stop request bypasses admission.** It has no body, is never queued behind the byte cap of [ADR-0004](0004-admission-shed-contract.md), and answers `202` before the drain starts. The listener stays open during the drain.
3. **One trigger path on every platform.** The manager sends the stop request on Windows and on POSIX, after the existing identity proof, so Linux CI exercises the path Windows users take. On POSIX, SIGTERM stays a handled trigger of the same sequence (external supervisors, `kill`), and the manager sends SIGTERM when the request gets 404/401/403 or a connection error. On Windows those answers go straight to `TerminateProcess`, which is today's behaviour for an old proxy.
4. **The deadlines are strictly ordered.** `STOP_GRACE_MS = 10_000` is the proxy's own hard deadline: drain + the 3 s account-metadata flush + exit. The manager forces only after `STOP_GRACE_MS + STOP_EXIT_MARGIN_MS`, a named margin of at least a few 300 ms poll intervals (for example 2 s). Both live in one shared module and are tested together. The respawn wait (30 s) stays longer than the acknowledgement wait + grace ([ADR-0015](0015-respawn-acknowledgement-before-drain.md)).
5. **Callers that know the proxy is broken force directly:** hung-proxy recovery (a hung main thread would never answer), the startup timeout and foreign-port paths in `start`, and the golden-path crash injection through an explicit force helper. Only `stop`, `restart` and the update path use the stop request.
6. **Visible progress, proven flush.** On a TTY `proxy stop`/`restart` show progress while the grace runs; off a TTY they stay line-based. A windows-latest test proves that the flush runs on `proxy stop`.

## Considered options

- **A stop-request file in `logs/`, or IPC:** each adds a surface (a file watcher, an IPC channel) that a request on the existing listener avoids.
- **The proxy key alone:** rejected; every harness holding the key could stop the proxy.
- **One equal 10 s grace for proxy and manager (the recommendation):** rejected; the two timers race and the manager can kill the proxy mid-flush.

## Consequences

- The endpoint and the `proxy.pid` field meet old and new kits during updates. An old proxy answers 404 and gets today's stop.
- Old managers never send the request, so a new proxy stopped by an old manager behaves as today.

## Amended 2026-11-06 (Round 4, Q4)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 4, Q4 (and Q5 deviation D3).

- **Condition 1: the token is overwritten at every spawn and never inherited.** `proxyEnv` already passes `ZCODE_KIT_*` through, so no allowlist entry is involved; the risk is an ambient value inherited through the respawn chain. The manager therefore sets `ZCODE_KIT_STOP_TOKEN` explicitly at every proxy spawn, overwriting any inherited value, with a freshly generated token equal to the one written to `proxy.pid`. The proxy strips the token from the environment it gives the respawn hook, as it does for the solver process. Tests: with an ambient bogus value the spawned proxy receives a new token; the token in its environment equals `proxy.pid`; the respawn hook's environment has no stop token; two consecutive spawns get different tokens.
