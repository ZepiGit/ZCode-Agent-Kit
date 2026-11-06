# Round 7 — calibrating the Windows memory leg (first clean Windows run)

Answers file: `rounds/round-07-answers.md`. Rounds 1–6 binding (esp. Round 1 Q7, Round 3 Q1, Round 6 Q2, spec §18).
Evidence: the first Windows memory run with no harness failures, branch `staging/02` (ticket 02 fix round 4), job log saved at `/home/AgentKit/overhaul-tools/t02-winmem-4.log` (summary table, per-scenario check lines incl. working-set values, "RED only on commit" section). Earlier rounds: `/home/AgentKit/overhaul-tools/t02-winmem-3.log`. Linux reference: `METRICS.md`. Ticket 02 Comments (rounds 2–4) on `ticket/02-windows-sampler`.

Windows numbers (commit, Bun 1.4.2, Node 26.13, windows-latest): proxy idle ~187 MB (Linux RSS ~60); S1/short proxy steady 283 MB, peak 348 MB, working set within budget (RED only on commit); S1/burst1 proxy peak 422 MB; S1/stalled 452 MB; S1/burst16 1,095 MB; S3/short kit total 734.5 MB commit (launcher 40, bridge 78.6, preflight 31.9, proxy 187.9; kit PowerShell calls ~65–72 MB commit each count as kit); S3/hung 456.8 MB; S5/short GREEN (714 samples, bridge seen); S7 proxy peak 401.5 MB.
Every question is worded so "yes" accepts the recommendation.

---

❓ **Q1 - Which Windows metric gates the per-process budgets**: §9 states per-process budgets in RSS ("proxy main process steady-state RSS ≤ 250 MB"); Round 1 Q7 chose commit charge as the Windows metric; Round 3 Q1 gates the S3 TOTAL on commit (≤ 600 MB, ≥ 30 % rule if the Windows baseline is above 600). On Windows a Bun process's commit includes reserved-and-committed heap that the working set does not show (proxy idle 187 MB commit). Gate the per-process (procPeak/steady) budgets on Windows against the WORKING SET (Windows' RSS, which §9 names), keep commit as the gate for the S3 total (Round 3 Q1), and report commit for every process in METRICS and the job summary.

➡️ Yes.

---

❓ **Q2 - The Windows S3 total**: the Windows baseline is 734.5 MB commit (> 600), so by Round 3 Q1 the Windows S3 total budget becomes ≤ 514 MB commit (734.5 × 0.7). Confirm 514 MB, and record that the kit's own PowerShell helper calls (~65–72 MB commit each, measured in the launcher/manager/preflight paths) are kit processes and count.

➡️ Yes, ≤ 514 MB commit, PowerShell helpers count.

---

❓ **Q3 - Calibration commit for the windows list (Round 6 Q2)**: from this run: remove `S5/short` (GREEN with real evidence: 714 samples, bridge seen); list `S3/short` (ticket 37), `S3/hung` (16), `S4/short` (17), `S7/short` (34), `S2/short` (58), the S1 burst variants (19) as they are; add `S1/burst1` → ticket 20 (with the Round 6 median rule from ticket 60), `S1/stalled` → ticket 19 (the only S1 ticket that bounds in-flight bytes; if Q1 changes the gate and the working set is green, the entry is not added); and `S1/short` (RED only on commit) is not listed silently: it goes to the owner as a `needs-triage` ticket and, if Q1 is accepted, it is GREEN on the working-set gate and needs no entry.

➡️ Yes.

---

❓ **Q4 - The Windows killed-start orphan**: ticket 02's round-4 evidence shows a start killed between spawning the proxy and recording its start time leaves `proxy.pid` without a start time; every later stop then fails closed and the proxy can never be stopped by the kit (S3 orphans on Windows). The windows `orphans` checks in S3/short and S3/hung are owned by ticket 16 (start lock v1) and 17 (orphan adoption), whose files carry the finding; the Windows S3 entries stay listed until those land.

➡️ Yes.
