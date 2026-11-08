# Owner Proxy round 20 — ticket 25's CDN memory cache cap: 32 MiB instead of the spec's 64 MiB

Answers file: `/home/AgentKit/overhaul-tools/rounds/round-20-answers.md` (write nothing inside the integration worktree).

Source: ticket 25's branch (`git -C /home/AgentKit/wt/t25 show HEAD:.scratch/kit-overhaul/issues/25-bounded-collections-cdn-memory-and-stall-counters.md`, head a18d465; logs `reports/t25-*` in the integration worktree; run data /home/AgentKit/overhaul-tools/t25-memloop/), spec.md (CDN cache section), issues/25-*.md, DECISIONS.md Round 15 (25 owns `cdn-cache:memory-growth`, budget 64 MB) and Round 17 Q1 (25 does not own the responses-store check; the store stays unchanged), PROMPT.md §5 (B1).

## Q1 — confirm or reject the 32 MiB body cap

Facts: spec/ticket fix the CDN memory cache at 64 MiB of bodies (and 256 entries). With 64 MiB of bodies, S2/short's `cdn-cache:memory-growth` measures 90 MB (budget 64 MB): after evictions the runtime keeps ~26–37 MB above live data. With 32 MiB: 57–58 MB in 3/3 Linux runs (before: 151 MB RED in 3/3). The 256-entry limit is unchanged; the bytes the solver serves for a given request are unchanged; a recorded pre-change workload (2,000 stalls and solves) replays with the same 392 CDN invalidations at the same events. Windows is pending CI (run on staging/25). Open: whether a smaller memory cache changes how often the solver re-fetches from the vendor CDN in real use (the disk cache, ticket 29, still holds bodies), which is upstream-visible behaviour (B1).

Recommendation: confirm 32 MiB as the default body cap (a tightened bound backed by evidence, Charter §9), as a config value if the ticket already exposes one, with the spec and ticket text amended; condition: the implementer adds evidence that the CDN fetch count per solve does not rise on S2's workload (memory hits + disk hits vs network fetches before/after), so B1's "what is fetched does not change" holds; if it rises, the question comes back with the numbers.
