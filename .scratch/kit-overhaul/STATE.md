# STATE — resume anchor

- Phase: 4 (implement-spec)
- Next action: wait for t02 fix round 7 (ubuntu S3/hung harness failure). Then per Owner Proxy round 8 (DECISIONS.md): resume t60 on top of ticket/02, add a windows-latest S1/burst1 >= 20-repetition measurement (C2), pick n per C3, stage 02 then 60 into staging/02, one pre-merge CI run (confirms only, C4), merge 02 and 60 back to back via MERGER-BRIEF.md only if green on both legs. R8 C1 already checked OK (RUNLOG 21:40). Then resume t03. Frontier is only 02; 57 and 59 are needs-triage.
- Ticket 07 merged 2026-11-06 as 5777177 (resolved 964e4d1).
- Integration branch: overhaul/stability-terminal-ux (pushed; draft PR https://github.com/ZepiGit/ZCode-Agent-Kit/pull/13)
- Integration worktree: /home/AgentKit/wt/overhaul
- Owner checkout (read-only for this run): /home/AgentKit/ZCode-Agent-Kit
- Other branches: diagnosis/memory (1B loop, merged into ticket 01), prototype/terminal-ux (d27b890, throwaway, never merged)
- Briefs: IMPLEMENTER-BRIEF.md, MERGER-BRIEF.md, OWNER-PROXY-BRIEF.md
- Model routing in Phase 4: glm tickets, mergers, explorers -> worker-glm (GLM-5.3-Flash; loads after restart but dispatch fails with provider-not-found for account:zai-start-plan/GLM-5.3-Flash as of 2026-11-06T21:05Z -> fallback general-purpose/opus until the owner fixes the provider); sol tickets -> general-purpose (opus); Standards review = reviewer-grok; Spec review = reviewer-sol; red team = reviewer-grok
- Running subagents: see RUNLOG.md (latest "Spawned" lines)
- Last green SHA: 9e45d05 (baseline); integration tip before Phase 4 = this commit
