# STATE — resume anchor

- Phase: 4 (implement-spec)
- Next action: wait for t60 round 3 (Owner Proxy round 9 conditions 1-3, 6, 8: unstable state for windows S1/burst1 only). Then on staging/02: git rm the marker tests/memory/measure-burst1 (db5f353), merge ticket/60 again, push, one pre-merge run (must be green on both legs; disagreement per R9 C7 -> question, no rerun-until-green). Green -> merge 02 then 60 via MERGER-BRIEF.md (staging/02 tree; revert the revert c252676 first). Then resume t03; frontier opens to 09, 61 (needs-triage).
- Ticket 07 merged 2026-11-06 as 5777177 (resolved 964e4d1).
- Integration branch: overhaul/stability-terminal-ux (pushed; draft PR https://github.com/ZepiGit/ZCode-Agent-Kit/pull/13)
- Integration worktree: /home/AgentKit/wt/overhaul
- Owner checkout (read-only for this run): /home/AgentKit/ZCode-Agent-Kit
- Other branches: diagnosis/memory (1B loop, merged into ticket 01), prototype/terminal-ux (d27b890, throwaway, never merged)
- Briefs: IMPLEMENTER-BRIEF.md, MERGER-BRIEF.md, OWNER-PROXY-BRIEF.md
- Model routing in Phase 4: glm tickets, mergers, explorers -> worker-glm (GLM-5.3-Flash; loads after restart but dispatch fails with provider-not-found for account:zai-start-plan/GLM-5.3-Flash as of 2026-11-06T21:05Z -> fallback general-purpose/opus until the owner fixes the provider); sol tickets -> general-purpose (opus); Standards review = reviewer-grok; Spec review = reviewer-sol; red team = reviewer-grok
- Running subagents: see RUNLOG.md (latest "Spawned" lines)
- Last green SHA: 9e45d05 (baseline); integration tip before Phase 4 = this commit
