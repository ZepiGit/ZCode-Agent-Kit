# RUNLOG — kit-overhaul (append-only)

- 2026-11-05T23:00Z Phase 0 start. Orchestrator runs on anthropic/claude-opus-5-5 (session model; the user picks it). Roster asked for claude-fable-5-1 → substitution logged, not changeable from inside the session.
- 2026-11-05 Self-hosting hazard check: no ZCode Agent Kit installed on this machine (no ~/.local/share/zcode-agent-kit, no zcode-kit on PATH), nothing listens on 8457. Session models are served by the ZCode harness itself (zcode-cli / server-core.js, ZCODE_BASE_URL=https://zcode.z.ai), not by a kit proxy. Those harness processes are off-limits (B4). Isolated dev instance will still use port 18457 and a temp HOME.
- 2026-11-05 Model routing substitutions (harness Agent tool selects models only through fixed agent types; CreateWorkflow is reserved for explicit user requests):
  - gpt-6.1-sol-subagent (writable research/diagnosis/implementer) → no writable sol agent type; chain sol → glm → opus: glm has no agent type either → general-purpose (session model claude-opus-5-5). Read-only sol work (reviews, verification) → reviewer-sol (openai/gpt-6.1-sol, xhigh).
  - glm-5.3-flash explorers → scout-gemini (gemini-3.8-flash, read-only) for searches; writable glm work → general-purpose (opus) per chain.
  - grok-4.7 xhigh (Standards review, red team) → reviewer-grok (xai/grok-4.7, effort high fixed by definition).
  - claude-opus-5-5 Owner Proxy / Spec review → general-purpose (opus) for Owner Proxy rounds; opus-reviewer or general-purpose for Spec axis (never the same instance as the round's Owner Proxy).
  - claude-fable-5-1 UX design lead → no agent type; general-purpose (opus) fresh subagent.
- 2026-11-05 Integration worktree /home/AgentKit/wt/overhaul on branch overhaul/stability-terminal-ux from origin/main 9e45d05 (upstream unset so no accidental push to main).
- 2026-11-05 Owner working tree untouched: it has untracked AGENTS.md + docs/agents/ that are NOT on origin/main; read from /home/AgentKit/ZCode-Agent-Kit.
- 2026-11-05T23:00Z Sentinel started (PID in reports/sentinel.pid), 5 s interval, 15 % threshold, kills only reports/run-pids.txt + env ZCODE_OVERHAUL_RUN=1 processes.
- 2026-11-05 Bun not on PATH: isolated Bun 1.4.2 (CI pin) and 1.4.4 (npm latest) installed via npm under /home/AgentKit/overhaul-tools/bun-*. Capped runner: tools/run-capped.sh (copy of /home/AgentKit/overhaul-tools/run-capped.sh).
- 2026-11-05 Baseline green: kit 267/278 (11 Windows/opt-in skips), proxy 1288/1288, mcp 95/96, compile, pack, golden mock. See METRICS.md.
- 2026-11-05 Spawned research: node-lts, bun (general-purpose/opus, substitute for sol).
- 2026-11-05 No git identity on this machine; every commit in this run goes through tools/gitc.sh (ZepiGit noreply identity via env vars, no git config change).
