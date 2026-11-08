# Owner Proxy round 21 — linux S6/short `tui:adversarial-line-heap` RED once (unlisted key)

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-21-answers.md` (write nothing inside the integration worktree).

## Q1 — who owns the tail of S6's adversarial line-heap check?

Facts: ticket 32 (merged 0c75be5) turned S6/short GREEN and deleted its entry; it added the check `tui:adversarial-line-heap` (budget 16 MB; ticket 32 measured 8 MB). In ticket 19's 10 evidence runs on staging/19 (identical tree; linux S6 code unchanged by 19), run 42446461464 had `tui:adversarial-line-heap` = 20 MB (budget 16) RED; the other 9 runs measured 8 MB. S6/short is unlisted on linux and does not run on windows, so the RED fails the ratchet as "RED but not listed". The check is not one of round 17's four interim signatures. Ticket 32's Comments: the pane holds the only copy of a huge line, truncated; Bun substrings keep their parent alive, so every stored line is a fresh copy. Ticket 49 (log pane filter/scroll/follow) is open and touches the same pane.

Recommendation: same shape as round 17 Q1 (heap tail, not the bound): the check judges the pane's retained heap as the minimum of several readings after the adversarial phase (e.g. >= 10 readings 0.5 s apart, minus the starting value), budget 16 MB unchanged; implemented inside ticket 71 (one pre-merge run confirms all the rare-tail rules), and signature (v) "linux S6/short `tui:adversarial-line-heap` above 16 MB, only failure" joins round 17's interim rule until 71 merges. If the minimum itself exceeds 16 MB, it comes back with numbers (then it is a real leak, ticket 49 or a new ticket).
