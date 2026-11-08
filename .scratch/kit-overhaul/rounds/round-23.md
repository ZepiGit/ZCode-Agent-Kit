# Owner Proxy round 23 — triage of ticket 56 (MCP SDK 2.x and protocol revision 2026-07-28)

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-23-answers.md` (write nothing inside the integration worktree).

## Q1 — ticket 56: role, label, edges

Facts: ticket file issues/56-*.md (needs-triage, "sol (if accepted)", blocked by 13, which is resolved). research/mcp-sdk*.md (2026-11-06): stay on SDK 1.x ^1.32.2 now; a 2.x migration ticket before 2027-01-27. Ticket 13 (merged f383d6b) documented the stay-back on protocol 2025-11-25 / SDK 1.x in mcp/zcode-harness-mcp/docs/KNOWN_LIMITATIONS.md §6. MCP tickets still open: 30 (task retention; in progress), 31 (caps and text truncation; blocked by 30), 36 (staged), 57 (restart budget; blocked by 30, 36), 53 (docs; blocked by 57 and others). C5 (currency) vs C1/C2 (stability, compatibility of the bridge's tools and outputs).

Recommendation: decide from primary sources (the SDK's release notes and the 2026-07-28 protocol revision; record the URLs) whether 2.x is stable now and what the 2027-01-27 date is (1.x end of support?). If 2.x is stable: `ready-for-agent`, sol, risk high, blocked by 30, 31, 36, 57 (so the migration lands on the final bridge code, not under four tickets' churn) and 53 ← 56 (docs). If not stable yet: `needs-info` with the exact missing fact and the date to re-check; the KNOWN_LIMITATIONS stay-back note stays authoritative.
