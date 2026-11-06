# STATE — resume anchor

- Phase: 4 (implement-spec)
- Next action: run the ticket frontier (issues/INDEX.md); merge finished tickets with a merger subagent (MERGER-BRIEF.md); open the draft PR after the first merge
- Integration branch: overhaul/stability-terminal-ux (pushed; draft PR https://github.com/ZepiGit/ZCode-Agent-Kit/pull/13)
- Integration worktree: /home/AgentKit/wt/overhaul
- Owner checkout (read-only for this run): /home/AgentKit/ZCode-Agent-Kit
- Other branches: diagnosis/memory (1B loop, merged into ticket 01), prototype/terminal-ux (d27b890, throwaway, never merged)
- Briefs: IMPLEMENTER-BRIEF.md, MERGER-BRIEF.md, OWNER-PROXY-BRIEF.md
- Model routing in Phase 4: implementers = general-purpose (opus) for sol and glm tickets (chain sol -> glm -> opus); Standards review = reviewer-grok; Spec review = reviewer-sol (not opus, because implementers are opus); red team = reviewer-grok
- Running subagents: see RUNLOG.md (latest "Spawned" lines)
- Last green SHA: 9e45d05 (baseline); integration tip before Phase 4 = this commit
