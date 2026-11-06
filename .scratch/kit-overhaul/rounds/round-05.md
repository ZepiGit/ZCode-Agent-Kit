# Round 5 — /to-tickets quiz

Answers file: `rounds/round-05-answers.md`. Rounds 1–4 binding. Read `tickets-draft.md` (57 tickets, dependency order, coverage table), `spec.md` and `seams.md` in `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/`, and ADR-0016 (work order). Model routing in practice: "sol" tickets go to the strongest available implementer, "glm" tickets to the high-volume implementer; reviewers always differ from the implementer (PROMPT.md §2).
Every question is worded so "yes" accepts the draft.

---

❓ **Q1 - Granularity**: each of the 57 tickets is a vertical, independently verifiable slice that fits one fresh context window; none is too coarse (would need splitting) or too fine (should merge with a neighbour). Name every ticket to split or merge, with the exact new shape.

➡️ Yes, the granularity is right.

---

❓ **Q2 - Blocking edges**: every `Blocked by` edge is a genuine gate (the ticket cannot start or cannot go green without it), no needed edge is missing (e.g. a ticket touching a module another ticket restructures), and the graph has no cycle. Name every edge to add or remove.

➡️ Yes, the edges are right.

---

❓ **Q3 - Model and risk labels**: the `Model:` and `Risk:` lines match PROMPT.md §2 routing (sol for process lifecycle, concurrency, workers/solver isolation, streaming, TUI renderer, migrations; glm for high-volume well-scoped work). Name every label to change.

➡️ Yes.

---

❓ **Q4 - Acceptance criteria**: each ticket's criteria are measurable (a named test that goes RED→GREEN, a memory-loop scenario with its budget, the expected-red.json entry it deletes, snapshot updates, docs touched), include an adversarial check derived from the guarantee's purpose where the ticket adds a guard or bound, and together cover every spec user story (coverage table: 144/144). Name every criterion that is missing or unmeasurable.

➡️ Yes.

---

❓ **Q5 - Approve the breakdown for publishing**: publish the tickets as one file per ticket under `.scratch/kit-overhaul/issues/NN-<slug>.md` per `docs/agents/issue-tracker.md`, Status `ready-for-agent` except 56 and 57 (`needs-triage`), with your Q1–Q4 changes applied.

➡️ Yes.
