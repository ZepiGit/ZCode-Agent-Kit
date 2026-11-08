---
status: accepted
---

# Proxy health: one supervisor on footprint thresholds, and no drain without a reserved respawn

The proxy's health policy lives in one health supervisor module, with `watchdogStep` as its pure core, and the proxy has one shutdown sequence. The supervisor samples memory footprint (RSS only as the fallback) against a soft limit of 512 MB and a hard limit of 1024 MB, each held for 3 samples 15 s apart. The thresholds are configurable and tested with an injected sampler, and the respawn budget stays at 3 per 15 min. The thresholds follow from the designed maximum of the bounded proxy, about 450 MB: base 85–93 MB, plus the responses store at ≤ ~74 MB (RC6), plus 64 MB × ~4.5 of admitted bodies ([ADR-0004](0004-admission-shed-contract.md)). Today's 1536/3072 MB sit far above every budget. The binding part is the handoff. Today the proxy starts exiting as soon as the OS has spawned the respawn hook, and the manager checks the budget only after that, so a respawn with the budget used up ends with no proxy. "Exactly one proxy" includes "not zero" ([ADR-0003](0003-start-lock-proven-takeover.md)).

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 2, Q1 (ACCEPTED with the binding conditions below).

## Binding conditions

1. **Reserve the budget before draining.** The proxy drains only after the manager has confirmed that the respawn budget is reserved. If the reservation is refused, the proxy keeps serving, logs the refusal and reports it as WARN in `status` and `doctor`. Today's MemoryGuard rule holds: a standalone proxy at 3 GB still serves, a dead one does not. The byte cap of [ADR-0004](0004-admission-shed-contract.md) remains the memory protection. Test: under induced memory pressure there are ≤ 3 restarts per 15 min and exactly 1 proxy at every sample. The confirmation is the respawn acknowledgement of [ADR-0015](0015-respawn-acknowledgement-before-drain.md).
2. **How a respawn reaches clients.** During the drain the proxy keeps its listener open. New requests are shed under [ADR-0004](0004-admission-shed-contract.md) (503 + `Retry-After` in the endpoint's error shape), never answered with connection resets. In-flight requests get the drain window. The bounded account-metadata flush stays inside the proxy's hard deadline. Streams cut at the force point are counted in one log line.
3. **The stop deadline is shared with the manager.** On POSIX the manager sends SIGKILL 5 s after SIGTERM, so a 10 s drain would be killed halfway, flush included. The proxy's stop deadline (drain + flush) and the manager's SIGTERM→SIGKILL grace are defined together and tested together. Respawn for memory and update keep the ≤ 10 s cap. Round 3 fixed the exact relation; see the amendment below.
4. **Windows gets a graceful stop.** On Windows `killOwned` calls `TerminateProcess` for both the graceful and the forced step, so the graceful sequence never runs on `proxy stop` or `restart` on the primary platform. The lifecycle module delivers a graceful stop request on Windows, with `TerminateProcess` after the grace as the fallback. It adds no unauthenticated or non-loopback surface. A windows-latest test proves that the flush runs. The mechanism is the stop request of [ADR-0014](0014-graceful-stop-request-over-loopback.md).
5. **The soft limit only warns.** Once the solver runs out of process ([ADR-0002](0002-captcha-solver-in-capped-child-process.md)), the soft action is WARN plus a log line, not a solver recycle. Without a manager hook (the TUI, a standalone proxy) today's behaviour stays: log and keep serving.
6. **Config stays additive.** The new `config.yaml` keys are optional. An env override exists only if it is added to the `proxyEnv` allowlist with a test. The managed proxy's environment strips `ZCODE_PROXY_*` and `CAPTCHA_*`, so an unlisted override would silently do nothing.

## Considered options

- **The supervisor module with the handoff and the shutdown sequence left as they are (the recommendation as worded):** accepted only with conditions 1–4. Left as is, the "budget unchanged" path ends with zero proxies, and the single graceful sequence never runs on Windows and is SIGKILLed at 5 s on POSIX.

## Consequences

- The threshold defaults are a two-way door. The proxy↔manager handoff is hard to reverse, because an old running proxy and a new manager meet during an update.
- Respawns for memory become more likely (1536/3072 → 512/1024 MB). The release notes announce it, together with shedding during a drain and the Windows graceful stop (Round 2, Q10).
- The lifecycle module (Round 2, Q11) owns this handoff and the Windows graceful stop. The manager CLI's commands, exit codes 0–5 and output, and the `respawn <pid> --reason <r>` arguments stay unchanged.

## Amended 2026-11-06 (Round 3, Q3 and Q4)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 3, Q3 and Q4.

- **Condition 3 is a strict order, not one equal constant.** `STOP_GRACE_MS = 10_000` is the proxy's own hard deadline: drain + the 3 s account-metadata flush + exit. The manager forces only after `STOP_GRACE_MS + STOP_EXIT_MARGIN_MS`, a named margin of at least a few 300 ms poll intervals (for example 2 s). Both constants live in one shared module and are tested together. Two equal 10 s timers would race, and the manager could kill the proxy in the middle of the flush, which is the defect condition 3 exists to remove. Details in [ADR-0014](0014-graceful-stop-request-over-loopback.md).
- **Condition 1 is realised by the respawn acknowledgement** in [ADR-0015](0015-respawn-acknowledgement-before-drain.md). The respawn wait (30 s) stays longer than the acknowledgement wait + `STOP_GRACE_MS` + margin.

## Note 2026-11-08 (Round 18, Q3 condition 3): the designed maximum is out of date

Recorded by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 18, Q3; [ADR-0004](0004-admission-shed-contract.md), amendment of 2026-11-08 (Round 18, Q1–Q3).

- **The designed maximum is out of date.** The "designed maximum of about 450 MB … 64 MB × ~4.5" above is out of date: the measured linux maximum under the cap is 608.5 MB (RSS, S1/burst32, ticket 19's tree). The soft limit of 512 MB, which only WARNs, can therefore fire under legitimate cap-saturating load. The hard limit of 1024 MB has more than 400 MB of margin on linux.
- **The thresholds do not change.** Soft 512 MB and hard 1024 MB, each held for 3 samples 15 s apart, stay as decided.
- **Windows: EVIDENCE MISSING.** The windows footprint on ticket 19's tree has not been measured; the ≥ 10 staging/19 CI runs of Round 18 Q2 condition 1 record it.
- **Ticket 21** records the proxy footprint the supervisor samples, per leg, for the S1 burst runs on its tree. If that footprint can hold at or above 1024 MB for 3 samples, 21 comes back with numbers before it merges (C1: no restart storms).
