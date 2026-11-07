# 59: Kilo `/v1/models` sheet line (part (b); effort normalisation moved to 63)

**Blocked by:** None (can start immediately)

**Status:** resolved

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

### 2026-11-07 — implementer (claude-opus-5-5, logged substitute for glm), part (b) only

**Branch:** `ticket/59-kilo-models-line`. Fix commit `5bad9ca` on integration tip `74899d2` (the merge of the current tip was a no-op, "Already up to date"). This evidence commit sits on top. Effort handling (ticket 63) is not touched.

**Primary source, re-verified where the value is consumed (criterion 1).** Kilo's Custom provider dialog decides whether to list models with `canFetch = (npm, url) => npm !== "@ai-sdk/anthropic" && /^https?:\/\//.test(url.trim())`. The debounced auto-fetch returns early when it is false (`:253`), and the "Fetch models" button is `disabled={fetching() || !canFetch(form.npm, form.baseURL)}` (`:708`). The Anthropic Messages entry is `@ai-sdk/anthropic` (`:45`). So for the provider API the sheet prescribes, Kilo does not request `/v1/models` and the user types in the models. Sources: https://github.com/Kilo-Org/kilocode/blob/v7.8.27/packages/kilo-vscode/webview-ui/src/components/settings/CustomProviderDialog.tsx#L232-L233 (tag `v7.8.27` = `03a6f07d053cd7e6aa88fa1e258e93510335259f`, the version `research/harness-configs.md` records). The same two lines are unchanged on `main` (`45484c9`, fetched 2026-11-07). The button label "Fetch models" is from `packages/kilo-vscode/webview-ui/src/i18n/en.ts:451` (`v7.8.27`).

**Change (`cli/adapters/kilo-code.mjs:42`).** The one false note is replaced, and nothing else in the sheet changes:
```
- Kilo does not fetch the model list for Anthropic Messages ("Fetch
  models" stays disabled): enter both models above by hand.
```
Sheet diff for an existing user (the snapshot diff for criterion 5; no snapshot suite holds this sheet, grep `tests/snapshots`): `-- Models can also be auto-fetched from the /v1/models endpoint.` becomes the two lines above. A user with a pre-50 or pre-51 sheet also gets the ticket 50/51 changes in the same refresh, as before.

**Tests (seam 8, `tests/adapter-audit.test.mjs`, already wired; +2 tests).**
1. `integrate replaces the false Kilo /v1/models auto-fetch note in every earlier sheet, idempotently and reversibly`. It runs three on-disk generations: the legacy `kiloSheetBeforeFix()` (line 180, used unedited as input), the post-50 sheet and a new post-51 fixture. Each goes through `refreshCycle`: integrate, second integrate (byte-idempotent), `rollback <tx>` (byte-exact restore), replay. Each asserts that no `auto-fetch` or `/v1/models` text is left, and that the result equals the post-51 sheet with only the note replaced (literal `KILO_TRUE_NOTE`).
2. `the next plain setup replaces the false Kilo auto-fetch note for a user with a stored decision, idempotently and reversibly`. It uses a temp HOME with a detected `kilocode.kilo-code-7.8.27` extension dir and a stored `configured` decision. Plain `setup` records a transaction, a second `setup` is byte-identical, and `rollback` restores the post-51 sheet byte for byte.
- The new fixture `kiloSheetAfterMediumFix()` is byte-equal to what the tip wrote. I captured it with a scratch `zcode-kit integrate kilo-code` on `74899d2` (temp HOME/state with `.owner.json`, port 19500 in the config, nothing listening). Comparison: `BYTE-EQUAL`.

**RED → GREEN.** RED on the tip's adapter: 2 tests, 0 pass, 2 fail (`reports/t59-red.log`; after the setup fixture gained the extension dir, again `t59-red2.log` with the tip adapter swapped in and restored, `git diff --stat` showing only this ticket's two files). The failures were `no auto-fetch claim left (before ticket 50)` and `the refresh is recorded as a transaction` (on the tip, setup writes the same bytes, so nothing is refreshed). GREEN: 2/2 (`t59-green.log`).

**Full suite** (Bun 1.4.2): `npm run test` 687 tests, 670 pass, 0 fail, 17 skipped (`t59-full-kit.log`). `npm run test:proxy` 1343 pass, 0 fail, 90 files (`t59-full-proxy.log`). `npm run test:mcp` 96 tests, 95 pass, 0 fail, 1 skipped (`t59-full-mcp.log`). `git status` was clean after the build, so `dist/` is unchanged.

**Criteria**
1. ✓ The false line is replaced by a true one, with the source re-verified above.
2. ✓ The test pins the absence, RED then GREEN.
3. ✓ Integrate and plain setup both refresh through the existing transaction. The second run is byte-idempotent, and rollback restores the old sheet (both tests).
4. ✓ `tests/adapter-audit.test.mjs:180` (`kiloSheetBeforeFix`) is not edited; it is used as input. No pre-existing test changed. The ticket 50/51 Kilo tests assert only Base URL, rows and the key, so they pass unchanged.
5. ✓ The sheet diff is recorded above, and no snapshot holds the sheet. Grep: `harnesses/README*` and `docs/` have no auto-fetch claim. Their only `/v1/models` hits are the proxy endpoint table ("`GET /v1/models` | model list | discovery"), which is true for the proxy. So C8 needs no doc change beyond the release notes.

**Decisions taken**
- The scope is the one line (the Round 12 exception to spec line 812). The header comment's stale "kilo.jsonc … documented only sparsely" and the sheet's kilo.jsonc note are other Low drift, so I left them.
- The new note names the disabled "Fetch models" button, so a user who sees the button greyed out knows this is expected.

**For other tickets**
- 54 (release notes): the Kilo values sheet is refreshed on the next setup/integrate. Its auto-fetch note becomes "enter both models above by hand".
- Orchestrator: the ticket's H1 and the INDEX row still carry the pre-split title. Round 12 says to retitle it "Kilo Code values sheet: correct the `/v1/models` auto-fetch line". I left INDEX.md and the H1 alone, because the merger owns the tracker rows.

Merged 2026-11-07 as 113075d6734e9bf7afee5a0e4a1a08e895546849 (ticket/59-kilo-models-line at 51baf79; first merge, no revert-of-revert step); fast suite: kit 670/687 (17 skipped, 0 fail; includes the 2 new tests in tests/adapter-audit.test.mjs), proxy 1343/1343, mcp 95/96 (1 skipped, 0 fail); mcp dist unchanged; no lockfile changes, so only the root `npm ci` ran; clean merge (no conflicts; the integration H1 from 7fd04c8 and both Comments texts kept). No CI-only criteria; CI runs on the next integration push. Logs: .scratch/kit-overhaul/reports/merge-59-{npm-ci,test,proxy,mcp}.log.
