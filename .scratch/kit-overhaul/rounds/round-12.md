# Owner Proxy round 12 — triage of tickets 57, 59 and 61

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-12-answers.md` (write nothing inside the integration worktree).

For each ticket decide its triage role (`ready-for-agent` with criteria and edges, `needs-info` with the exact missing fact, or `wontfix` with the reason), using the five canonical roles in `docs/agents/triage-labels.md`. Read each ticket file whole (`issues/57-*.md`, `issues/59-*.md`, `issues/61-*.md`) and `issues/INDEX.md` for edges. State any new edge and check that the graph stays acyclic.

## Q1 — Ticket 57: MCP runtime restart budget (architecture candidate 8)

Facts: proposed in Phase 1D (reports/architecture.md candidate 8); deferred in Round 1 Q2 because S5 never exercised runtime restarts. Its only criterion is "an S5 variant with induced harness exits shows whether a restart storm is possible; owner decides". MCP tickets in flight later: 30, 31 (task retention/caps), 36 (bridge lazy HTTP), 56 (SDK 2 migration, if accepted).

Recommendation: `ready-for-agent` as a measurement-first ticket, label sol: build the S5 restart variant (induced harness/runtime exits under the fake harness), report whether respawns are bounded today; if a storm is possible, fold a respawn budget with the proxy's policy shape into the bridge runtime and the variant becomes its RED→GREEN test; if not, the ticket closes with the evidence. Edge: blocked by 36 (same bridge runtime module), so the two do not conflict.

## Q2 — Ticket 59: proxy-side effort normalisation and the Kilo `/v1/models` sheet line

Facts: follow-up from ticket 51. Part (a) needs a live probe against the real upstream to verify which Claude Code effort levels the upstream accepts; B2 forbids real credentials in this run, so the probe can only be an owner action. Part (b) is described in the ticket as a one-line correction.

Recommendation: split. (b) becomes `ready-for-agent` (glm label, low risk, no edges beyond 51 which is merged). (a) stays `needs-info`: the missing fact is the live probe result; the exact probe commands go into OWNER-ACTIONS.md (the orchestrator writes them), and Claude Code effort for `glm-*` stays off until then (as ticket 51 left it).

## Q3 — Ticket 61: S1/stalled on Windows, response-side proxy memory

Facts: Round 7 Q3 created it; windows S1/stalled is RED on WS and commit (proxy peak ~452 MB commit on Bun 1.4.2 in run 42281731448; 328-ish WS in later runs), Linux GREEN. Ticket 19 bounds request bytes only. Round 1 Q5 rejected limiting response streams in ticket 19's scope; Round 7 named "a response-side bound touches Round 1 Q5" as a question that comes back with numbers. The paired measurement mode (ticket 09) and the windows sampler (ticket 02) exist, so a windows-CI attribution run is now cheap (marker-driven, like the burst1 measurement).

Recommendation: `ready-for-agent`, label sol, two stages in one ticket: (1) attribution on windows CI (where the bytes sit: Bun's per-socket send buffering for stalled readers vs. the proxy's own stream handling vs. upstream response buffering; numbers per stalled reader), via an off-by-default measurement marker; (2) only if the bytes are in the proxy's own handling, a fix that keeps backpressure (pause the upstream read when the client socket is not draining) rather than a byte cap on responses, so Round 1 Q5 stays intact; if the bytes are inside Bun's socket layer, the ticket comes back with the numbers. Edge: blocked by 19 (both change the proxy's request/response pipeline; 19 lands the admission control first), and 55 already depends on 61.
