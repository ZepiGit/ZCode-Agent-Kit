# Merger brief (fresh merger subagent per merge)

You merge ONE finished ticket branch into the integration branch `overhaul/stability-terminal-ux` in the integration worktree `/home/AgentKit/wt/overhaul`. Never ask questions. You are the only writer of that worktree while you run.

1. `cd /home/AgentKit/wt/overhaul`; confirm a clean tree (`git status --short` empty except ignored files). If not clean, stop and report what is dirty.
2. `/home/AgentKit/overhaul-tools/gitc.sh merge --no-ff ticket/NN-<slug> -m "Merge ticket NN: <title>"`. Resolve conflicts conservatively: keep both sides' intent; never drop another ticket's change; for `.scratch/kit-overhaul/` files keep both texts. If a conflict needs a design decision, abort the merge and report it.
3. Fast suite on the merged tree, each via `/home/AgentKit/overhaul-tools/run-capped.sh merge-NN-<suite> 3G 1800 -- <cmd>` from `/home/AgentKit/wt/overhaul` with `BUN_DIR` set as IMPLEMENTER-BRIEF.md describes: `npm ci` (if lockfiles changed: also `bun install --frozen-lockfile` in `zcode-proxy-src` and `npm ci` in `mcp/zcode-harness-mcp`), `npm run test`, `npm run test:proxy`, `npm run test:mcp`. If `mcp/zcode-harness-mcp/dist/` differs after the build, the merge is RED (B5).
4. GREEN: update the ticket file on the integration branch: `Status: resolved`, and append under `## Comments` "Merged <date> as <merge SHA>; fast suite: kit X/Y, proxy X/Y, mcp X/Y". Commit (`docs(overhaul): resolve ticket NN`). Do NOT push.
5. RED: `git revert -m 1 --no-edit <merge SHA>` (a revert commit, never a reset), set the ticket's `Status: ready-for-agent`, append the failing suite, test names and log path under `## Comments`, commit. Report RED.
6. Final reply: GREEN/RED, merge SHA (and revert SHA), suite counts, log paths.

## Pre-merge CI gate (added 2026-11-06 after the 02 and 06 reverts)
If the ticket has any criterion marked "pending CI", the orchestrator first pushes the ticket branch and opens a draft PR from it into `overhaul/stability-terminal-ux`, so ci.yml runs on both OS legs. You are dispatched only after that CI run is green (its run URL is in your prompt); record the URL in the merge comment. Re-merging a reverted ticket: first `gitc.sh revert --no-edit <revert SHA>` (revert the revert), then merge the ticket branch. Exception (added 2026-11-07 after the 02/60 merge): if the branch you merge already carries its own revert of that revert (it merged the integration tip and undid the revert there), skip the first step; check with `git log --oneline <branch> --grep 'Revert' ` and `git merge-base --is-ancestor <revert SHA> <branch>`, and say which path you took.

## Memory-loop runs by the merger (added 2026-11-07)
When the orchestrator asks for a local memory-loop run, pass `--out /home/AgentKit/overhaul-tools/merge-NN-memloop` (outside the worktree) so the job's summary files never sit untracked in the integration tree.

## Sanity diff for a staged ticket (added 2026-11-07)
The ticket's own files are `git diff --name-only staging/NN^1 staging/NN -- . ':!.scratch'` (staging/NN's last commit merges the ticket into the tip). After your merge, `git diff staging/NN HEAD -- <those files>` must be empty; other differences come from tickets merged since and must be named in your report. If staging/NN's last commit merges the tip into the ticket (instead of the ticket into the tip), the ticket's files are `staging/NN^2..staging/NN` instead.
