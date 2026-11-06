# STATE — resume anchor

- Phase: 4 (implement-spec)
- Next action: after restart, run RESUME PROTOCOL; check CI of draft PRs #14 (staging/02, head 0f324a7) and #16 (staging/07); merge green ones via MERGER-BRIEF.md (02: merge staging/02, not the ticket branch); then resume t03 and t60 (blocked by 02) and continue the frontier
- Integration branch: overhaul/stability-terminal-ux (pushed; draft PR https://github.com/ZepiGit/ZCode-Agent-Kit/pull/13)
- Integration worktree: /home/AgentKit/wt/overhaul
- Owner checkout (read-only for this run): /home/AgentKit/ZCode-Agent-Kit
- Other branches: diagnosis/memory (1B loop, merged into ticket 01), prototype/terminal-ux (d27b890, throwaway, never merged)
- Briefs: IMPLEMENTER-BRIEF.md, MERGER-BRIEF.md, OWNER-PROXY-BRIEF.md
- Model routing in Phase 4: glm tickets, mergers, explorers -> worker-glm (GLM-5.3-Flash, needs a session restart to load; created 2026-11-06); sol tickets -> general-purpose (opus); Standards review = reviewer-grok; Spec review = reviewer-sol; red team = reviewer-grok
- Running subagents: see RUNLOG.md (latest "Spawned" lines)
- Last green SHA: 9e45d05 (baseline); integration tip before Phase 4 = this commit
