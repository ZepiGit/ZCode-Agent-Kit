# 63: Proxy-side effort normalisation for native `/v1/messages` (Claude Code effort for `glm-*`)

**Blocked by:** None (needs-info: the owner's live probe, OWNER-ACTIONS.md)

**Status:** needs-info

Model: sol
Risk: medium
ADR: no

**What to build:** Part (a) of the original ticket 59, split off by Owner Proxy round 12 Q2 (binding; DECISIONS.md Round 12). Claude Code effort for `glm-*` ids stays off. Enabling it (`CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1`) would send Claude Code's own levels (`medium`, `xhigh`), which the proxy passes through unchanged while only `low`/`high`/`max` are verified. A proxy-side normalisation on native `/v1/messages` could make enabling it safe, but only once the upstream's behaviour per value is known.

**Missing fact:** for `glm-5.3` and `glm-5.3-flash`, on native `/v1/messages` through the real upstream, what the upstream does with `output_config.effort` in {`low`, `medium`, `high`, `xhigh`, `max`}: accepted, rejected (status and error type), or silently mapped. The run cannot probe it (B2); the commands are in OWNER-ACTIONS.md.

**Acceptance criteria:**

- [ ] The owner's probe table is recorded here; the ticket is then re-triaged.

## Comments
