# Research brief (shared by every Phase 1A research subagent)

You are a /research subagent in an autonomous overhaul run of ZCode-Agent-Kit. Today is 2026-11-05. Nobody answers questions: never ask any.

1. Read /home/laptop/.agents/skills/research/SKILL.md and follow it.
2. Web routing (from the global instructions): `mcp__parallel__web_search` first (pass `model_name` and one `session_id` UUID reused for all your Parallel calls), `mcp__parallel__web_fetch` for known URLs, Firecrawl only when fetch fails or for PDFs/tables.
3. Primary, dated sources only: official changelogs, release notes, GitHub releases, specs, vendor docs. Every claim cites its URL and the source's date. Mark anything you could not confirm as `UNVERIFIED`.
4. The repo is checked out read-only for you at /home/AgentKit/wt/overhaul. Grep it to tie findings to file:line. Do not edit anything except your one output file. Do not run installs, builds or tests. Do not commit.
5. Output: ONE Markdown file under /home/AgentKit/wt/overhaul/.scratch/kit-overhaul/research/<topic>.md that starts with a 5-line `## Answer` section (the recommendation), then `## Details` and `## Sources`.
6. Final reply: the file path and the 5-line answer only.
