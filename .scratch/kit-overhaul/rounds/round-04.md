# Round 4 — /to-spec seam check and the three choices the spec made

Answers file: `rounds/round-04-answers.md`. Rounds 1–3 binding. Read `spec.md` (the draft spec) and `seams.md` in `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/`.
Every question is worded so "yes" accepts the recommendation.

---

❓ **Q1 - Test seams**: `seams.md` lists 9 seams: 7 existing (memory loop, lifecycle `createManager` + manager CLI, solver dispatcher `configureCaptchaSolver({ backendModule })` + stats, proxy over loopback + `/health`, pure shared modules, MCP client + fake harness, installer/adapter temp-HOME fixtures) and 2 new (command records rendered with forced capabilities + snapshot suite; small repository guards). Do these seams match what the owner expects to be tested, at the highest available level, with no seam missing for a decided behaviour?

➡️ Yes, as listed.

---

❓ **Q2 - Preflight cause-line channel**: waiting OMP hosts need the starter preflight's diagnostics (Round 3 Q2 condition). The spec has the starter write its `cause=` lines into a small result record next to the single-flight token; waiters read them from there.

➡️ Yes.

---

❓ **Q3 - Handover opt-out name**: `ZCODE_KIT_RESIDENT_LAUNCHER=1` keeps the launcher resident instead of the `process.execve` handover (Round 3 Q2 condition).

➡️ Yes.

---

❓ **Q4 - Log directory env**: `ZCODE_KIT_LOG_DIR` carries the logs directory to the proxy (Round 3 Q4 condition), added to the `proxyEnv` allowlist.

➡️ Yes.

---

❓ **Q5 - Spec fidelity**: does `spec.md` faithfully reflect Rounds 1–3 (decisions as decided, including conditions and replacements), the §9 acceptance criteria with the tightened budgets, and the build-time gates? List every deviation you find; "yes" means none that matter.

➡️ Yes.
