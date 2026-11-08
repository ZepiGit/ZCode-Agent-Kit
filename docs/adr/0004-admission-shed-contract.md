---
status: accepted
---

# Admission: a cap on in-flight bytes only, and shedding as 503 + Retry-After

The proxy limits the total request-body bytes in flight, not the number of concurrent upstream requests. A request it cannot admit within the queue bounds is shed with HTTP 503 and a `Retry-After` header, in the error shape of the endpoint it called. Never 429. The memory evidence is per MB of body in flight, about 4.5 MB RSS per MB, from redundant body copies (memory report RC2). It is not per open stream: 30,000 mixed requests stayed GREEN, and 3,000 stalled readers retained 6 MB. Clients retry 5xx and map 429 to quota, so 429 stays reserved for upstream quota and rate semantics.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 1, Q5 (the recommendation was REJECTED in part: the concurrency cap was dropped).

## The contract

1. **Byte cap.** Total in-flight request-body bytes are capped, 64 MB by default, configurable through `config.yaml` and env (additive). Bytes count for as long as the proxy holds copies of the body: read, parse, translate, upstream send.
2. **Queued bodies are not read.** A request waiting for admission has not had its body read, so backpressure stays on the socket.
3. **Bounded FIFO.** Excess requests wait in a FIFO bounded by count and by 15 s.
4. **Shed shape.** After the bound, the response is HTTP 503 with `Retry-After`, in the endpoint's error shape: the OpenAI `error` object on the OpenAI-format endpoints, `overloaded_error` on the Anthropic-format endpoint. Never 429.
5. **No concurrency cap on upstream streams by default.** Open upstream response streams are not limited. If a concurrency limit is ever wanted, it applies only to the body-processing phase and needs measured evidence first.
6. **Fewer copies.** Redundant body copies are reduced, ticket by ticket and measured. The bytes sent upstream do not change.
7. **Budgets:** burst high-water mark ≤ 400 MB at 16 and ≤ 600 MB at 32 concurrent 10.8 MB bodies. The byte cap alone meets both: 64 MB × ~4.5 + ~90 MB base ≈ 380 MB.

## Considered options

- **Byte cap plus a default cap of 16 concurrent upstream requests (the recommendation):** rejected for the concurrency part. The 17th parallel harness session would wait and then be shed while long streaming answers run. That is a functional regression with no memory justification.
- **429 for overload:** rejected. Clients map it to quota exhaustion.

## Consequences

- The default values are a two-way door. The client-visible shed contract (503, `Retry-After`, endpoint error shape) is hard to change once clients rely on it.
- How a shed surfaces to connected clients beyond this response is still open (DECISIONS.md, Round 1, "Shared understanding" item 3).

## Amended 2026-11-06 (Round 2, Q1 and Q2; Round 3, Q3)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 2, Q1 and Q2; Round 3, Q3.

- **Shed during a drain (Round 2, Q1, condition 2).** While the proxy drains before a respawn or stop, it keeps its listener open and sheds new requests with this contract, never with connection resets. In-flight requests get the drain window. This settles the open item in the Consequences above for drains ([ADR-0008](0008-proxy-health-supervisor-and-respawn-handoff.md)).
- **Shed while the solver fails fast (Round 2, Q2, condition 1).** A request that needs a solve is shed with this contract while the solver is in its fail-fast window, with `Retry-After` set to the time until the window reopens, and when a bounded solve queue overflows. It is never shed merely because a solver crash happened ([ADR-0002](0002-captcha-solver-in-capped-child-process.md)).
- **The stop request bypasses admission (Round 3, Q3, condition 2).** It has no body, is never queued behind the byte cap, and answers `202` before the drain starts ([ADR-0014](0014-graceful-stop-request-over-loopback.md)).

## Amended 2026-11-06 (Round 5, Q4)

- **An idle proxy always admits (Round 5, Q4, change 10; [DECISIONS.md](../../.scratch/kit-overhaul/DECISIONS.md)).** A request is admitted when in-flight bytes + this request ≤ cap, or when in-flight bytes are 0, so a single request at today's maximum body size (32 MB wire, 64 MB inflated) with nothing else in flight is served, never shed.

## Amended 2026-11-08 (Round 18, Q1–Q3)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 18.

- **The factor under the cap (ticket 19, linux, RSS).** The default cap is 64 MiB (67,108,864 bytes; the key `server.admission.maxInFlightMB` counts MiB), so six 10.8 MB bodies (64.8 MB) are admitted at once. With them, S1/burst16 peaks at 428.5–524.5 MB (median 488.6, 5 runs): about 6.2 MB RSS per MB admitted above a ~90 MB base (5.2–6.7), not the ~4.5 measured at 16–32 unbounded bodies. S1/burst32 peaks at 479.8–608.5 MB (median 549.7, 20 runs; 2 above 600) with the same bytes admitted. The ~61 MB more than burst16 is the cost of the queued requests. The ratio is not constant (5.5 at 4 bodies, 8.6 at 1), so the linear formula in point 7 does not predict peaks.
- **Point 7's "the byte cap alone meets both" is superseded.** On today's code the cap alone meets neither budget at 16 bodies, and meets 32 only at the median, with ticket 19's one deferred collection after a ≥ 4 MiB release (cap only: 678–734 MB). The budgets stand unchanged. They are met by points 1 and 6 together, and ticket 20 owns them (≤ 250 / 400 / 600 / 250 MB for S1/burst4 / burst16 / burst32 / bigbody). If 20 cannot reach them, the question comes back with numbers. The levers outside 20 are a lower cap default, a body-processing concurrency limit (point 5) and Bun `--smol`.
- **The 64 MB default stays.** No lower value has been measured, and a lower one would queue and shed parallel sessions sooner (point 5's reasoning). It is a two-way door through the config key.
- **Ticket 20 re-measures** (peak − 90) / MB admitted at S1/burst16 and burst32 per copy removed. The result is recorded here as a further amendment naming the ticket.
