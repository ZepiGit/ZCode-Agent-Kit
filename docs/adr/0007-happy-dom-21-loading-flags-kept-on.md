---
status: accepted
---

# happy-dom 21 runs with CSS and iframe page loading re-enabled

The proxy moves to happy-dom `^21.0.4`, the only release that fixes GHSA-834v-8h66-3h79. The solver sets `enableCSSFileLoading: true` and `enableIframePageLoading: true`. happy-dom 21.0.0 turned both off by default to reduce SSRF surface (GHSA-c8p4-j97h-3vg8), which changes what a solve loads. Re-enabling them restores the 20.x loading behaviour, so solve behaviour stays as it is (B1). Whether the vendor SDK needs CSS links or iframe child frames to finish a solve is unverified offline (`research/happy-dom.md`, §2).

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 1, Q16, condition 1 (Q16 was ACCEPTED with conditions).

## Security position

With the flags on, the SSRF-relevant surface that happy-dom 21.0.0 disables by default stays **unchanged** relative to today. It is not made stricter. Charter C6 allows this ("unchanged or stricter"), and this record states it so that nobody reads the upgrade as a hardening of that surface.

## Dropping a flag

Turning either flag off needs a live solve against the real vendor SDK (an owner action). This run cannot do that. Offline captcha tests do not prove that a real solve still works.

## Consequences

- The captcha suite runs green after the happy-dom bump, before any other change to the captcha path (Q16, condition 4).
- A future reader who sees the flags set to `true` should not "fix" them to the safer default without that live solve.
