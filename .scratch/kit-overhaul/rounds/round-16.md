# Owner Proxy round 16 — ticket 67 follow-ups G and H, and ticket 37's windows clause

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-16-answers.md` (write nothing inside the integration worktree).

Sources: ticket 67's branch (`git -C /home/AgentKit/wt/t67 show HEAD:.scratch/kit-overhaul/issues/67-plain-listing-hides-other-reds.md`, `...:METRICS.md`, `...:tests/memory/expected-red.json`; head a097269), DECISIONS.md Rounds 14–15, issues/17-*.md and 37-*.md.

## Q1 (G) — windows S4/short `count:proxy` (two proxies at once) in 1 of 26 runs

Fact: run 42425476318, windows S4/short, `count:proxy` RED (2 proxies at once); 0 of the other 25 windows runs and 0 of 18 linux runs. Round 15 does not assign it, so a recurrence would fail the ratchet. Ticket 17's What-to-build says "never spawns a second one" (respawn over a proven-stale lock).

Recommendation: owner 17, marked `flips` (1/26), traced to that What-to-build line; ticket 17's Acceptance gains "`count:proxy` = 1 in S4/short (windows)" so the trace meets round 15's AC rule.

## Q2 (H) — does ticket 13's merge restart the S3 evidence floor?

Facts: round 15 Q2 condition 2 restarts the count when a merge changes S3's code; ticket 13 (merged f383d6b) changed the MCP bridge's dependencies (SDK 1.30.0 → 1.32.2, zod 4.6.2 → 4.6.7, TS 7 build with byte-identical dist/), which S3 runs (the mcp-bridge role). Before 13: 10 matching CI runs per leg for S3/short and S3/hung. On 13's tree: 2 per leg (42425069025, 42429164758), RED sets inside the earlier ones. The orchestrator has started 8 evidence runs on staging/67 (tip with 13 + ticket 67; identical tree, empty commits; runs 42435825059 … 42436440284), which will give 10 per leg on 13's tree within ~1 h.

Recommendation: the floor restarts (13 changes a process S3 samples); the 8 runs in flight satisfy it; ticket 67 merges only if every one of them is GREEN on the ratchet with the owners/flips as committed, and any RED outside the owned names or any flip rate that contradicts a `flips` mark comes back with numbers (no edit to owners in between).

## Q3 — ticket 37's windows acceptance line: "the entry is re-pointed to that follow-up"

Fact: round 15's Shared understanding says this clause conflicts with Q1 condition 5 (an owner removes only its own names; no other ticket edits an owner's names) but lists no text change. The docs worker left it and recorded the conflict in 37's Comments.

Recommendation: replace the clause with "if 37 cannot reach the windows target, it comes back to the Owner Proxy with the numbers; the names stay under 37 until then", matching round 15's own "comes back with numbers" rule.
