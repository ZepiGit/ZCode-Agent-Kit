# 65: S3/hung's stale-lock round is skipped when `manager start` exits 1 (harness failure on both legs)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: sol
Risk: high
ADR: no

**What to build:** Since ticket 02 round 7 a skipped S3 round is a harness failure (tests/memory/lib/completeness.mjs). Three CI runs now fail on it, all with `S3/hung: harness failure: no evidence the scenario ran: round hung-10-with-stale-lock skipped: manager start exited 1; round hung-10-with-stale-lock never ran`:
- run 42395651721 (staging/32, ubuntu), run 42398295810 (staging/12, windows), run 42398299724 (staging/32 restaged, windows). None of those tickets touch the lock, manager or scenario code. Earlier green runs (tickets 08, 09, 10, 11) passed S3/hung on both legs.
Find out with evidence what `manager start` returns in that round and why: the kit's stale-lock refusal (the defect tickets 16/17 own: a killed start leaves a lock the next start will not take over), a race in the scenario (the round starts before the killed holder is gone or before the lock is judged stale), or something that changed on the integration branch since ticket 11 (tickets 08 CLI split, 59, 64 sampler). Then fix the cause in the right place:
- If it is the kit defect, the scenario must not report it as "did not run": a refused start in the stale-lock round is a measured outcome. Record it as a RED check owned by ticket 16 (or 17) with the start's exit code and stderr, keep the round's remaining evidence, and keep the gate strict for genuinely not-run rounds (ticket 02 round 7's adversarial fixtures must still be harness failures). If that changes what counts as evidence in the gate, it is a two-way-door decision recorded in the ticket Comments with the reasoning; if the expected-RED list would change, stop and report numbers instead.
- If it is a scenario race, make the round wait on observable state (holder gone, lock state read) instead of time.
- If a recent merge caused it, show the bisect and fix it there.

**Acceptance criteria:**

- [ ] Root cause shown with evidence (CI artefacts of the three runs: the round's notes, the start's exit code and stderr; local reproduction on Linux; bisect if relevant).
- [ ] S3/hung passes its evidence gate on Linux in 10 consecutive local runs and on both CI legs in the pre-merge run; adversarial not-run fixtures stay harness failures.
- [ ] Full suites green.

## Comments
