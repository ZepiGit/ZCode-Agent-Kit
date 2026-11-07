# Implementer brief (shared by every Phase 4 implementer subagent)

You implement ONE ticket of the kit-overhaul spec on your own branch. Nobody answers questions: never ask, never pause. If the ticket is ambiguous, follow spec.md/ADRs/DECISIONS.md; if they are silent, take the smallest decision that satisfies the acceptance criteria and record it under the ticket's `## Comments`.

## Read first (pointers; read, do not skim)
1. `/home/laptop/.agents/skills/tdd/SKILL.md` and every file it references. Build the ticket with it: one red-green slice at a time, tests at the highest seam (see `seams.md`).
2. Your ticket file `issues/NN-*.md` (given in your prompt), then `spec.md`, `seams.md`, `GLOSSARY.md` (repo root) and the ADRs the ticket or spec section names (`docs/adr/`). Use the glossary vocabulary in code, tests and commit messages.
3. Evidence only as needed: `diagnosis/*.md`, `research/*.md`, `reports/*.md`, `ux/*.md`, `METRICS.md`.
All paths above are relative to `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/` except repo-root files.

## Worktree and branch
- Create: `git -C /home/AgentKit/wt/overhaul worktree add -b ticket/NN-<slug> /home/AgentKit/wt/tNN overhaul/stability-terminal-ux`.
- Before starting, confirm `git -C /home/AgentKit/wt/tNN merge-base --is-ancestor overhaul/stability-terminal-ux HEAD`; if not, reset onto the integration branch.
- Install deps in the worktree as `METRICS.md` (Baseline) describes. Bun is not on PATH: use `/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin/bun`. Bun is pinned to 1.4.2 everywhere (Owner Proxy round 11; ticket 62 owns any move to a newer Bun), so 1.4.3/1.4.4 under overhaul-tools are for the paired measurement only. Pass `BUN_DIR=<that .bin dir>` to the runner below.
- Commit with `/home/AgentKit/overhaul-tools/gitc.sh commit ...` only. Conventional Commits, English, matching the repo's style (`feat(proxy): …`, `fix(cli): …`, `test(memory): …`). Never rewrite history (no rebase, amend, squash or reset of committed work, even on an unpushed branch; fix forward with a new commit). Never push. Never touch `/home/AgentKit/ZCode-Agent-Kit` (owner checkout) or `/home/AgentKit/wt/overhaul` (integration worktree; the merger owns it).

## Running things
- Every test, build, soak or process you start: `/home/AgentKit/overhaul-tools/run-capped.sh <name> <MemoryMax> <timeout_s> -- <cmd>` (systemd scope, no swap, timeout, `ZCODE_OVERHAUL_RUN=1`, isolated HOME; log goes to the integration worktree's `.scratch/kit-overhaul/reports/<name>.log` — prefix `<name>` with `tNN-`). Run it from your worktree with absolute paths (a background `cd X && (A) & B` runs B elsewhere).
- Isolated ports only: your range is `19000 + NN*10` … `+9`. Never 8457, never another ticket's range. Mock upstream and fixtures only; no real credentials (B2).
- Never kill a process you did not start. A sentinel kills run-tagged processes when RAM < 15 %.
- If you set `PATH` inside a capped command, keep `$BUN_DIR` in it (the wrapper's Bun dir is otherwise lost).
- Criteria that need a GitHub Actions run (CI legs, CI run links): you cannot push. Make the change, prove it locally as far as possible, and mark the criterion "pending CI (orchestrator verifies after merge+push)". The orchestrator pushes the integration branch and checks the draft PR's CI.

## Hard boundaries (PROMPT.md §5) — never cross
B1 anti-abuse behaviour unchanged (captcha-*, client-signing, identity, trace-headers, session-context, account rotator/claim scheduler: lifecycle/bounds/errors/observability/UX/tests only). B2 no secrets read/printed/committed. B3 never modify installed kits, running proxies or real harness configs (temp HOME fixtures). B4 never kill foreign processes. B5 never hand-edit `mcp/zcode-harness-mcp/dist/` — rebuild and commit the output. B6 no version bumps, tags or release.

## Quality rules
- Every acceptance criterion gets evidence. Where the ticket adds a guard or a bound, include an adversarial test derived from the guarantee's PURPOSE (try the path the guard must make impossible: empty/partial/concurrent states, killed holders, oversized inputs), not only the happy path.
- Bug/memory fixes: the test or memory-loop scenario must be RED on the integration tip first (show it), then GREEN. Delete your entry from `tests/memory/expected-red.json` when your ticket owns one.
- Compatibility (C2): existing commands, flags, env vars, exit codes, JSON fields, config and stored state keep working; existing tests pass unchanged unless the ticket says otherwise (justify each change in Comments).
- Before reporting: merge the CURRENT integration tip into your branch (`git merge overhaul/stability-terminal-ux`), resolve conflicts, then run the FULL suite: `npm run test`, `npm run test:proxy`, `npm run test:mcp` (and the memory-loop scenarios your ticket touches, short profile). A slice that only touches one platform or package still runs the full suite.

## Report
1. Append to your ticket file's `## Comments` (in YOUR worktree's copy, committed on your branch): date, branch + head SHA, test output summary (counts per suite), RED→GREEN evidence, metrics delta (memory-loop numbers before/after where relevant), snapshot diff summary where relevant, decisions you had to take, anything left for another ticket.
2. Final reply (short): branch, head SHA, suites' pass/fail counts, acceptance criteria met (each ✓ with evidence pointer or ✗ with reason), expected-red entries removed, process observations worth logging (the controller logs them; you do not write to any observation log).
- Kit tests that point `ZCODE_KIT_STATE_DIR` at a directory that does not exist yet make the kit copy the checkout's own key, `generated/` and `backups/` into the fixture. Create the fixture state directory first (with a matching `.owner.json`, as `tests/adapter-audit.test.mjs` does since ticket 50) so nothing from the checkout leaks into a fixture (B2).
- Tests that pin behaviour which already holds (wiring guards, "output unchanged" checks, preservation tests in a refactor) cannot go RED first. Prove them live with a deliberate mutation instead: break the protected behaviour in a scratch edit, watch the test fail, restore, and `git diff` to show the restore; record it in Comments. Commit the implementation before running mutation scripts, and restore mutants only from that commit (`git checkout <sha> -- <file>`), never from an uncommitted state.
- Integration claims ("setting X makes harness Y do Z") are verified where the value is consumed (the harness's request code and the proxy's handling), not only in the config schema.
