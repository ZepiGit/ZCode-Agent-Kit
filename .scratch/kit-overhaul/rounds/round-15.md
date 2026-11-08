# Owner Proxy round 15 — ticket 67's ownership questions A–F

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-15-answers.md` (write nothing inside the integration worktree).

Source: ticket 67's implementer report and the ticket's Comments on branch `ticket/67-owned-checks` (head 6b9438c; read with `git -C /home/AgentKit/wt/t67 show HEAD:.scratch/kit-overhaul/issues/67-plain-listing-hides-other-reds.md`), and the new METRICS.md section "RED check sets per listed single run, both legs" on that branch (`git -C /home/AgentKit/wt/t67 show HEAD:.scratch/kit-overhaul/METRICS.md`). Evidence files: /home/AgentKit/overhaul-tools/ci-art/t67-logs/.

## Q1 — REDs on a listed key that belong to another ticket than the entry's owner

**Facts.** Round 14 Q1 gives each single-run key one owner ticket and an `owns` list traced to that ticket's text. The 10+ run CI history (linux 13 matching runs, windows 21; S3 keys 5 per leg after ticket 65 changed their scenario, plus 8 local Linux runs) shows REDs that no line of the entry owner's ticket covers, but another ticket's text does:
- **A. S2/short → 58:** `cdn-cache:memory-growth` RED 13/13 linux, 21/21 windows — ticket 25 claims it ("Loop S2: CDN memory ≤ 64 MB … the entry stays until 58"). `procPeak:scenario` (13/13, 21/21) and `growth:scenario` (11/13, 12/21) are named in no ticket's text.
- **B. S3/short → 37:** `failed-launches` and `stale-lock-after-round` RED 5/5 per leg and 8/8 local (the kill-holder round, claimed by ticket 16); `exactly-one-proxy-after-round` linux 1/5, windows 2/5 (same claim); windows `orphans` 3/5 (tickets 16/17 Comments).
- **C. S3/hung → 16:** linux `peak:kit`, `procPeak:launcher`, `procPeak:mcp-bridge` 5/5 CI and 8/8 local; `procPeak:preflight` 4/5; `procPeak:proxy` 2/5 (6/8 local); windows `peak:kit` 1/5 — ticket 37's S3 memory targets; no line of 16 names memory.
- **D. S3/omp → 35:** linux `procPeak:proxy` and `procPeak:preflight` 4/13 each; windows `peak:kit` 2/21 (ticket 03's merge comment and ticket 35's Comments record the near-budget values).
- **E. S7/short → 34:** `proxy.log:bounded-while-running` RED 13/13 and 21/21, the only RED — ticket 33 claims it ("proxy.log ≤ 6 MB while running … stays until 34").
- **F.** Windows S3/hung `orphans` rests on an orchestrator Comments line in ticket 16 (2026-11-06), not its AC/What-to-build.

**Orchestrator recommendation.** Let an entry own checks per ticket: `{ "owners": { "37": ["peak:kit", ...], "16": ["failed-launches", "stale-lock-after-round", "exactly-one-proxy-after-round"] } }`. Each owned check is traced to its own owner's text (round 14 C3 unchanged); a ticket deletes only its own checks (C4: only shrinks, only in that owner's commit); the entry disappears when the run is GREEN; ticket 55's empty-list guard is unchanged. Applied: A → 58 owns its two solver checks, 25 owns `cdn-cache:memory-growth`; `procPeak:scenario` and `growth:scenario` go to 58 if its "per-generation cost ≤ 300 MB / retained before recycle ≤ 300 MB" covers the scenario process (the solver runs inside it today, before ticket 27's child process) — otherwise they are an ownership question for 27/58, and the orchestrator files a needs-triage ticket. B → 37 + 16 (+ 17 for windows orphans). C → 16 + 37. D → 35 + 37 (S3 memory targets, the near-budget values carried in ticket 35's Comments). E → 34 + 33 (33 owns `proxy.log:bounded-while-running`, 34 its early-log check). F: an orchestrator Comments line recording an Owner Proxy decision or a measured finding counts as owner text when it states the criterion (as round 7 Q4's Comments do); otherwise not.

## Q2 — the 10-run floor for S3/short and S3/hung

**Facts.** Ticket 65 changed the S3 scenario, so only 5 CI runs per leg match; ticket 67 adds 8 local Linux runs of each. Each extra CI run costs ~40 min and covers both legs once.

**Orchestrator recommendation.** For Linux, count the local runs on the same tree (capped scope, same job code) toward the floor (5 CI + 8 local = 13); for Windows, require 5 more CI runs, obtained cheaply by the next five pre-merge runs of other tickets on the same S3 code, before ticket 67 merges; ticket 67 merges once the windows S3 floor is met. Until then the S3 `owns` lists are provisional and ticket 67 stays unmerged.
