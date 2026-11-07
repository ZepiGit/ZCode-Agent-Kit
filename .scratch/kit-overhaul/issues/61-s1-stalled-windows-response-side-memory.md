# 61: S1/stalled on Windows: proxy memory under many stalled streaming readers (response side)

**Blocked by:** 02 (Windows sampler …)

**Status:** needs-triage

Model: sol
Risk: medium
ADR: no

**What to build:** Round 7 Q3 (DECISIONS.md, binding). On windows-latest the S1/stalled scenario (4 MB streamed responses to ~200-byte requests, readers that stall) is RED on both working set and commit (proxy peak ~452 MB commit), while Linux is GREEN. Ticket 19 bounds request bytes and leaves response streams unlimited, so it does not own this. Triage: attribute the Windows peak (Bun stream buffering per stalled reader on Windows? socket send buffers?), and decide whether a response-side bound is needed (touches Round 1 Q5; would come back to the owner proxy with numbers).

- [ ] Triage decision recorded with numbers from the windows memory leg.

Spec stories: none yet (outside spec.md; recorded in Round 7).

## Comments
