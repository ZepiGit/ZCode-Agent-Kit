# 59: Proxy-side effort normalisation for native `/v1/messages` and the Kilo `/v1/models` sheet line

**Blocked by:** None (can start immediately)

**Status:** needs-triage

Model: sol
Risk: medium
ADR: no

**What to build:** Follow-up found by ticket 51. (a) Claude Code effort for `glm-*` ids stays off because enabling it (`CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1`) would send Claude Code's own levels (`medium`, `xhigh`), which the proxy passes through unchanged while only `low`/`high`/`max` are verified. A proxy-side normalisation on native `/v1/messages` (`medium` → `high`, `xhigh` → `max`, matching thinking budgets) would make enabling it safe; it needs a live probe first (owner action). (b) The Kilo Code values sheet says models can be auto-fetched from `/v1/models`, which is false for the Anthropic Messages provider (Low drift, out of the current spec's scope, but a false user-facing line).

- [ ] Triage: decide whether (a) is in scope after a live probe, and whether (b) is fixed as a one-line correction.

Spec stories: none (outside spec.md; recorded during ticket 51).

## Comments
