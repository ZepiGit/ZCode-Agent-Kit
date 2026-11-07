# 59: Kilo `/v1/models` sheet line (part (b); effort normalisation moved to 63)

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Model: glm
Risk: low
ADR: no

**What to build:** Follow-up found by ticket 51. (a) Claude Code effort for `glm-*` ids stays off because enabling it (`CLAUDE_CODE_ALWAYS_ENABLE_EFFORT=1`) would send Claude Code's own levels (`medium`, `xhigh`), which the proxy passes through unchanged while only `low`/`high`/`max` are verified. A proxy-side normalisation on native `/v1/messages` (`medium` → `high`, `xhigh` → `max`, matching thinking budgets) would make enabling it safe; it needs a live probe first (owner action). (b) The Kilo Code values sheet says models can be auto-fetched from `/v1/models`, which is false for the Anthropic Messages provider (Low drift, out of the current spec's scope, but a false user-facing line).

- [ ] Triage: decide whether (a) is in scope after a live probe, and whether (b) is fixed as a one-line correction.

Spec stories: none (outside spec.md; recorded during ticket 51).

## Comments

- 2026-11-07 (orchestrator) Triage, Owner Proxy round 12 (binding; full text in DECISIONS.md Round 12):

## Q2 — Ticket 59: proxy-side effort normalisation and the Kilo `/v1/models` sheet line

**DECISION:** ACCEPTED with conditions: split into two tickets. The split is physical, by ticket number, because one ticket file cannot carry two statuses.
- **Ticket 59 keeps part (b).** Retitle it "Kilo Code values sheet: correct the `/v1/models` auto-fetch line".
  - **Triage role:** `ready-for-agent`. Model **glm**, Risk **low**, ADR no.
  - **Criteria:**
    1. The false line in `cli/adapters/kilo-code.mjs:42` ("Models can also be auto-fetched from the /v1/models endpoint.") is replaced by a true one: for the Anthropic Messages provider, Kilo does not fetch the model list, so the models listed in the sheet are entered by hand. The agent re-verifies the primary source before writing it (`research/harness-configs.md:137` cites `CustomProviderDialog.tsx:233`, fetching disabled for `@ai-sdk/anthropic`).
    2. A test pins the absence of the false line in the generated sheet: RED first, then GREEN.
    3. Existing `generated/kilo-zcode-values.md` files are refreshed on the next `setup`/`integrate` through the existing transaction. A second run is byte-idempotent, and rollback restores the old sheet (Round 1 Q18 condition 2, C2).
    4. `tests/adapter-audit.test.mjs:180` holds the legacy sheet as **input** (what is on users' disks). It is not edited. Any other pre-existing test that changes is justified in the ticket.
    5. Any snapshot diff of the sheet is recorded. `harnesses/README*` currently carries no such line (grep), so C8 needs no doc change beyond the release notes; the agent confirms that grep in the ticket.
  - **Scope note (explicit departure, narrow):** spec §Out of Scope line 812 (from Round 1 Q18) leaves Low adapter drift out. I make **one** exception, for this line only, because it is a false instruction to the user in a file the kit generates. Every other Low item listed in ticket 51's Comments stays out.
  - **Edges:** "blocked by 51" is not needed, because 51 is `resolved`. **New edge 54 ← 59.** The refreshed sheet is a user-visible change, so it joins 54's "harness configs refreshed on the next setup/integrate" item and spec §16's release-notes list. **Acyclic:** 59 has no blockers, so no edge into 54 can close a cycle.
- **Part (a) moves to a new ticket, 63** (next free number), "Proxy-side effort normalisation on native `/v1/messages` (Claude Code effort for `glm-*`)". Model sol, Risk medium.
  - **Triage role:** `needs-info`.
  - **EVIDENCE MISSING:** the live-probe result. For `glm-5.3` and `glm-5.3-flash`, on native `/v1/messages` through the real upstream, what does the upstream do with `output_config.effort` ∈ {`low`, `medium`, `high`, `xhigh`, `max`}? For each value it must show: accepted, rejected (status and error body) or silently mapped; and the thinking tokens actually used. It must also show whether the paired thinking budget changes the outcome. B2 forbids this run from using real credentials, so this can only be an owner action.
  - **Conditions while it waits:**
    1. `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT` stays off for `glm-*`. Ticket 51's unchanged guard and its mutant-tested assertion stay in force.
    2. The orchestrator writes the exact probe commands into OWNER-ACTIONS.md. They use the owner's own login on the owner's machine, and they put no key, token or account data in the file or the expected output (B2, C6).
    3. When the result arrives, 63 returns to `needs-triage`. That triage must also answer C2: users who set the variable themselves get pass-through today, and normalisation would change the bytes sent for them.
  - **Edges:** none now.
- **Label:** 59 → `ready-for-agent`; 63 → `needs-info`. INDEX.md gains the row for 63 and the new title for 59.

**Rationale:** The two parts share an origin (ticket 51), but nothing else. (b) is a verified false statement with a one-line fix and the migration pattern that tickets 50 and 51 already used. (a) depends on a fact only the owner can produce. Kept in one file, (b) would wait on (a) for no reason, and the edge 54 ← 59 would block the release notes on an owner action. Keeping number 59 for the actionable part keeps existing references stable (the Round 5 precedent of ticket 58). The round's "no edges" for (b) missed C2's rule that every user-visible change is announced.

**Charter:** C2 (generated state refreshed through the transaction, idempotent, reversible; changes announced), C3 (no false user-facing text), C6 and B2 (no credentials in this run), C8, C9 (smaller blast radius; simpler), Round 1 Q18, Round 5 (number stability).

**REVERSIBILITY:** Two-way door. ADR: no.

---

- Part (a) (effort normalisation) moved to ticket 63 (needs-info). This ticket now covers part (b) only.
