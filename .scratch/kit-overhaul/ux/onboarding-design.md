# Ticket 83 — canonical onboarding design

**Prospectively ratified, design only, recorded 2026-11-10 after accepted43. Ticket83 is ready-for-agent on the documentation gate only; it is NOT resolved or implemented.**

## Current adoption wrapper (not a new normative design)

This canonical document preserves the complete exact V4 reviewed body below. The ratified object is `/home/AgentKit/overhaul-tools/t83-status-corrected-v4-20261110.md`, SHA-256 `67dbf6bbfe5198f4f4108b25ff5a5d9f3657629a24660257b126ec8e5cb71724`, 91468 bytes. The external original is unmodified. This wrapper has not received a separate model review and is not represented as the reviewed file hash.

Actual independent GPT and Grok responses both explicitly approve that same hash, design only, with no remaining disagreement. Their complete bytes, paths, hashes, attribution limits and executed recorder checks are preserved in [onboarding-ratification.md](onboarding-ratification.md). They are later prospective judgments, not transferred approval from V2/V3 or an invented GLM/Sonnet vote.

Policy authority remains **Owner Proxy under Charter v1 on behalf of the owner**, Round39 source SHA-256 `737aa578a57853b014dbd4838d5c9b0eb5bf9e23aa0548482676f73392d345ba`. Adoption was already committed at `afe14cfe464a49176b39317ac7e27d63925c5d3d`. Accepted post43 preservation baseline is `54771fdfde870394236e547394f3330ce518b6e7`, following actual merge `7ffb80ff33dde1749ad574e20f285eb9f564893f`; tickets40/42/43 are resolved. The recorder verified these prerequisites and actual approvals before updating ticket83's status.

The embedded body's **PROPOSED / NOT RATIFIED**, “no responses”, open same-hash agreement and “this drafting/correction ask” statements describe V4's creation session, not this later recording. Its historical V3 inspections/commands/skill-load statements remain historical, not actions repeated here. Current ratification is supplied by the later actual responses and this ledger; no old ledger entry, response, command output or dissent is rewritten. The earlier construction/first review of V3 before the required transcription remains an ordering failure and is not backdated into compliance.

This wrapper changes status/provenance only. It changes no normative interaction, persistence/action matrix, exact English consequence copy, command inventory, geometry, input bound, migration, file responsibility or verification requirement. Sections1–5 and every other obligation of the exact reviewed body remain controlling subject to the already adopted Charter/ticket/spec/ADRs. Original citation roots and source line numbers inside that body remain as defined in its §0.1; they are not silently rebound to this wrapper's line numbers.

**Still open:** separate implementation dispatch/authorization, bounded supported-runtime feasibility, RED/GREEN and all complete named suites, preservation/mutation/log-line-set/C3 checks, central/full both-OS CI/dist/memory gates, native conhost/Windows Terminal/macOS evidence and ticket44's actual PowerShell5.1 stderr/whole-installer acceptance. No test, build or install was run by this recorder. Design approval is not a runtime feasibility result, shipped UX, live-access proof or permission to weaken any gate. Ticket82 stays unmerged with its recorded RED blockers/fresh-CI requirement. Fable5.2medium release-range review stays deferred and unstarted. Existing user concurrency and GPT/Grok routing are unchanged.

## Exact reviewed V4 body — unchanged archival payload

The byte span after the following marker through end-of-file is exactly the external V4 file. Hash that span, not the wrapper, to reproduce the reviewed SHA-256. This local copy makes the complete design and its disagreement/history record available without depending on external-file retention.

<!-- BEGIN EXACT REVIEWED V4 BYTES; payload continues through EOF -->
# Ticket 83 — proposed onboarding contract, status-corrected V4

**PROPOSED / NOT RATIFIED. Complete English design only. No implementation authorization.**

Round 39 decided the four policy questions; their canonical amendments were subsequently committed in `afe14cfe464a49176b39317ac7e27d63925c5d3d`. Ticket 43 was later accepted at `54771fdfde870394236e547394f3330ce518b6e7`, following merge `7ffb80ff33dde1749ad574e20f285eb9f564893f`. These are completed prerequisites, not ratification or implementation of ticket 83. This new file corrects only the status/provenance ledger. Normative sections 1–5, all six exact English Q1 consequence blocks, Q1's matrix, Q2's inventory, Q3's geometry and Q4's bounded input contract remain byte-identical to original V3, SHA-256 `31128562dc13f81273a4b68ac58e41f4529051381605779ca4d7a6c1b3505e0d`, which remains untouched. V3 was created and first reviewed **before** the required transcription; that ordering error is not backdated into compliance. Actual later V3 judgments are recorded chronologically in §8.2. No prior approval transfers to these V4 bytes. **PROPOSED / NOT RATIFIED** remains until actual independent GPT/Grok responses to the same new file hash exist.

This is the bounded status-only editorial correction authorized by E/t83-status-only-correction-brief-20261110.md:3-37 and the present dispatch, not a fourth UX design/fix round. The original at-most-three-round cap and every recorded dissent remain. A new normative disagreement must be reported rather than expanded into another design cycle. No review/model dispatch occurs in this correction.

## 0. Authority, provenance and revision ledger

### 0.1 Sources and citation roots

**E/** means `/home/AgentKit/overhaul-tools/`. **A43/** means `/home/AgentKit/wt/overhaul/` pinned to accepted commit `54771fdfde870394236e547394f3330ce518b6e7`; current ledger citations use that commit, not an assumed future HEAD. Git blob syntax `<commit>:<relative path>` makes the pin reproducible.

The unchanged sections 1–5 retain original V3 citation spelling and line numbers: **I/** is the historical `/home/AgentKit/wt/overhaul/` inspection at `829202b32cde3a2285c2c3fc39a5fc0394f1b50b`; **C43/** is the historical `/home/AgentKit/wt/t43/` inspection at `c27965a6fffe744996c59b9d9b7c2def00470f85`. Bare `ticket83` / `ticket44` and their line numbers in those unchanged sections likewise refer to V3's historical inspected documents, not a claim that today's ticket is unamended. They are source provenance, not current prerequisite verdicts. The pre-43 I/cli/harness-consent.mjs:326-355 policy citation remains historical; its accepted43 counterpart is A43/cli/harness-consent.mjs:340-369. The accepted prompter default is **stderr**, A43/cli/harness-consent.mjs:49-70, not the old stdout default.

Read-only Git-blob comparisons in this correction verified that the cited C43 `cli/harness-consent.mjs`, `cli/commands/setup.mjs` and `cli/setup-output.mjs` bytes equal their A43 counterparts and the inspected working files. Their original line references therefore also locate the accepted43 code. Historical I `lib/term/{caps,out,load}.mjs`, `cli/account-setup.mjs`, `cli/commands/common.mjs`, `cli/launch.mjs`, `install.sh`, `install.ps1` and `tests/snapshot-harness.mjs` also equal A43. This is citation/baseline identification only, not new preservation captures, source execution or a selector test. Future implementation preservation captures must use A43 explicitly.

The following table and the next two paragraphs preserve **historical V3 provenance**. Their “read”, “fresh” and “this ask” descriptions refer to V3's original creation session only; they do not claim those inspections or skill loads were repeated for V4. Newly read current records and executed integrity/ancestry checks are identified separately below.

| Historical input read for original V3 | Actual authority and integrity at that inspection |
|---|---|
| **D = E/rounds/round-39-onboarding-answers-20261110.md:1-220**, read in full | Owner Proxy under Charter v1, on behalf of the owner; explicitly not direct human UX answers, implementation, code review or test acceptance (:3-5). Fresh SHA-256 `737aa578a57853b014dbd4838d5c9b0eb5bf9e23aa0548482676f73392d345ba`. Q1/U1 :11-82; Q2/U2 :84-111; Q3/U3 :113-127; Q4 :129-157. |
| **V2 = E/t83-proposed-gpt-grok-v2-20261110.md:1-483**, read in full | Preserved proposal, SHA-256 `210fbd6ffc2790547b3b3e79f4e4a5989b1bd99acb5dee45cb6aa97d17d67d07`; not a binding ticket amendment. |
| **Grok V2 response = E/t83-ratify-v2-grok-20261110.md:1-114**, read in full | Actual `approved:false` for that V2 hash (:3-9). Fresh response-file SHA-256 `bcebd678dc93b703d04e7bac6dfb71f62df1d8768ba99b9c65b25e08f7709838`. Its B1 objection and requested per-row disclosure are :15-32. The factual correction is published separately from that preserved response in §0.4 below. |
| **GPT V2 response = E/t83-ratify-v2-gpt-20261110.md:1-113**, read in full | Actual `approved:true`, no remaining substantive change request, for the exact V2 hash (:3-14). Fresh response-file SHA-256 `58bae16339c5dee4d6b32f73c3701f66417542a2dcb686832f29e9204e5613c5`. Approval does not transfer to V3. |
| **Shared packet = E/t83-gpt-grok-ratification-packet-20261110.md:1-79**, read in full | Preparation, constraints and bounded review process, not policy authority or approval. Fresh SHA-256 `03d534bd45b380f2ee9a89728ecab24e7b77af848986635c5253941182da0097`. Same-hash independent responses, at most three fix/review rounds and preserved dissent are :24-28,73-79. |

The failed handoff E/t83-agreed-design.md:1-3 was read and remains untouched: `[object Object]` between markers, not a design. Its freshly checked digest is `118626cb607030e39752a30b5139409dcf519aae28330cf9c6a618cd95ab6d6b`. The original readable proposal is preserved at E/t83-proposed-design-20261110.md, fresh digest `ce8104b4640a27c47f8fca5accfca47865094e2ca370e0ede2e226cf340632ce`. Original content/history is not silently repaired by V3.

Relevant historical dissent passages were read directly in E/t83-design-sol.md:78-107, E/t83-design-glm.md:243-259, E/t83-design-sonnet.md:80-117,185-217,225-268 and E/t83-design-grok.md:59-75,161-205. The initial responses' disagreement passages were also read directly: E/t83-ratify-initial-gpt-20261110.md:3-18,43-179 and E/t83-ratify-initial-grok-20261110.md:3-9,32-91. They are historical evidence, not current participant responses. No new GLM, Sonnet, Fable, Anthropic or Gemini call occurred. That paragraph records V3-era routing provenance. For this correction, GPT/Grok authorization and unchanged concurrency come from the present dispatch and A43/.scratch/kit-overhaul/STATE.md:9,21; the shared packet:7-9 is historical preparation, not the current workflow identity. Fable5.2medium release-range review remains deferred and unstarted (correction brief:37).

### 0.2 Historical inspection and actual current prerequisite state

**Historical, not current:** original V3:27-33 inspected integration `829202b32cde3a2285c2c3fc39a5fc0394f1b50b` and C43 `c27965a6fffe744996c59b9d9b7c2def00470f85`. At that inspection, 43 was unaccepted, Round39 was not transcribed, and integration's prompter still defaulted to stdout. V3 §7.4's ancestry exit1 and its source searches belong to that earlier tree/session. They remain historical evidence, not a current failure or a claim those prerequisites are still missing.

1. **40 is resolved.** Resolution `829202b32cde3a2285c2c3fc39a5fc0394f1b50b` followed merge `0caa61887831e8eaf2dda40bdadf045f942f65c1`. A43/.scratch/kit-overhaul/STATE.md:17-19 records its central full-suite/S7 results and limits. Those recorded gates were read, not rerun here. No unchanged40 gate is reopened to correct prose.
2. **42 is resolved as recorded.** A43/.scratch/kit-overhaul/STATE.md:80 records merge `928565e` and resolution `cc3e77e`. Its asked-once rotator decision and explicit flag/env precedence remain unchanged.
3. **Round39 is canonically transcribed.** Actual commit `afe14cfe464a49176b39317ac7e27d63925c5d3d`, parent `829202b32cde3a2285c2c3fc39a5fc0394f1b50b`, records full answer bytes SHA-256 `737aa578a57853b014dbd4838d5c9b0eb5bf9e23aa0548482676f73392d345ba` in DECISIONS, with U1/U2/U3/Q4 ticket/spec amendments and the narrow ADR-0001 adoption. Current citations: A43/.scratch/kit-overhaul/issues/83-setup-command-overview-and-multi-select-harness.md:15-29,40-44; spec.md:804-813; docs/adr/0001-terminal-design-language-ledger.md:45-152; DECISIONS.md:5818-6039. Actual source-byte/blob comparisons verified preservation through A43; §7.5 records exact revision/diff checks. Adoption does not ratify a proposal.
4. **43 is accepted/resolved, not merely a candidate.** Accepted final `54771fdfde870394236e547394f3330ce518b6e7` follows merge `7ffb80ff33dde1749ad574e20f285eb9f564893f` of exact staging `71b2a67237b91e3ae4ce6060bc72e81b164fc6c3`. The merge parents are Round39 `afe14cfe464a49176b39317ac7e27d63925c5d3d` and that staging head. Both Round39 and the actual43 merge were freshly checked as ancestors of the accepted final, not inferred only from STATE. A43 ticket43:179-187 and STATE.md:5-9 record the central `npm run test:all` result: kit1145/1165(skip20), proxy1651/1652(skip1), MCP115/116(skip1), zero failures; S7 is **Linux short, partial=true only**. Earlylog was absent, so that record does not prove an exercised early-log writer/cap. These centrally executed results are historical records read here, not tests rerun or raw logs independently revalidated by this correction. No all-memory, native console83/44 or complete PowerShell5.1 acceptance follows.
5. **83 remains needs-triage, unimplemented and not jointly ratified.** A43 ticket83:5,15-31,40-44 now contains Round39's scope/acceptance amendments, not the obsolete wording cited as current in original V3. Its remaining same-new-hash ratification, implementation feasibility and execution/native gates remain real. **44 already depends on83**, A43 ticket44:3,36-38; footer-only deduplication stays with44. No dependency repair, product change or ticket edit occurs here.

The current accepted prompter is A43/cli/harness-consent.mjs:69, `output = process.stderr`. Setup explicitly consumes it at A43/cli/commands/setup.mjs:88-92. This proposal uses that accepted **post-43** prompt/report/log baseline; 83 does not repeat43's stream migration or claim its own selector is implemented.

### 0.3 Binding decisions, implementation choices and recorded adoption

Binding foundations remain Charter C1–C4/C6–C9 and B1–B6 (A43/.scratch/kit-overhaul/PROMPT.md:120-170,215-233), ticket83's controller rulings (:46-54), ADR-0001/0005/0011, spec §10 and Testing Decisions, and seams5/8 (A43/.scratch/kit-overhaul/seams.md:41-59,74-83). Round39's later explicit narrow amendments are now recorded at `afe14cfe464a49176b39317ac7e27d63925c5d3d` and preserved at A43. This changes adoption status only, not a decision or its obligations.

| Decision | Closed by actual authority | Required consequence, unchanged from V3 / recorded adoption |
|---|---|---|
| **U1: none/no-answer persistence** | D:13-30,32-82, Q1; explicit amendment, not an interpretation of old ticket wording | Esc/empty Enter/EOF supply undefined for editable rows, with exact owned/unowned/unreadable effects and no new choice record; nonempty Enter supplies true/false. §1.3 copy and §2.1 matrix remain unchanged. Ticket83:17,23-24,42 and ADR-0001:49-120 record this adoption in afe14cf. |
| **U2: useful inventory** | D:86-111, Q2 | Exactly five base rows, choosing `auth status`, plus zero/one qualified concrete `run ID`. Ticket83:19,28 and spec:809 now record the inventory/count/qualification and sink/installer responsibilities in afe14cf. Full help and recovery hints stay. No additional hard-to-reverse ADR decision. Implementation/snapshots remain future. |
| **U3: measured geometry scope** | D:115-127, Q3 | `lib/term/caps.mjs` optional measured physical columns/rows and selector-only capability gate are recorded in ticket83:15,17,25 and spec:810 in afe14cf. Preserve logical width/global color/old callers. No ADR-0011 topology or ADR-0005 stream change. Geometry/fallback and future tests remain as specified. |
| **Q4: bounded grammar and provenance limit** | D:131-157, Q4 | One owner, disclosure barrier, bounded whole-paste/text handling, lexical CRLF handoff and honest indistinguishability limits (§§1.5-1.8), adopted in ADR-0001:122-150, ticket83:17,24 and spec:811,813 in afe14cf. No new terminal mode/dependency or stronger provenance policy. Runtime feasibility remains unproved. |

The recorded ADR-0001 amendment retains the exact attribution: **“Decided by Owner Proxy under Charter v1 on behalf of the owner.”** A43/docs/adr/0001-terminal-design-language-ledger.md:47 adopts Q1/Q4 verbatim, including the matrix, six exact consequence-copy blocks and input guarantees/limitations. Its header directs Q2/Q3 inventory and optional geometry scope to ticket/spec; the complete Q3 geometry/fallback decision remains in committed DECISIONS. Do not claim ADR contains Q3 verbatim. U1 and Q4's reversibility status (D:82,157), U2/U3's reversible presentation/seam scope (D:111,127), and unchanged ADR-0005/0011/rotator policy remain exactly the original decisions, not new policy from this correction.

Visiting locked rows with focus, exact state labels and the small renderer interface remain proposed mechanical choices retained from V2, not invented Charter rulings. They are specified fully below and still need actual same-new-hash ratification. No majority vote, earlier approval or historical model identity supplies it.

### 0.4 Factual correction addendum to the preserved Grok V2 B1 rationale

This is a **new editorial addendum in V3 relaying D:143-151**, not a changed Grok verdict or a Grok-authored response. Here B1 is the review heading, not hard boundary PROMPT B1. The original review file and its `approved:false` remain intact. The correction required by the decision is quoted exactly:

> V2 correctly maps no answer to `undefined` while retaining the reasking function. “No answer” describes input; its resulting action can be skip or owned refresh. V2 already says that saved answers do not apply this run under reask at line 105 and explicitly enumerates the unowned-skip/owned-refresh distinction at line 184. Its ordinary owned-refresh sentence is about owned rows, not an unowned saved-yes row. The remaining objection is whether the displayed consequence copy communicates the per-row outcomes clearly enough before arming, not that an undefined/no-answer input cannot result in skip. Round 39 Q1 requires explicit replacement copy for that clarity.

The sources were read in original V3's drafting session: V2:93,105-107,173-186; historical C43/cli/harness-consent.mjs:342-369; Grok V2:15-32. The exact correction is also adopted at A43/docs/adr/0001-terminal-design-language-ledger.md:142-144. The request for explicit per-row readable-unowned/readable-owned/unreadable disclosure is accepted and implemented in this design's §1.3. No changed reviewer approval is demanded or fabricated. GPT's actual approval remains limited to old V2 bytes (GPT V2:3-14). Actual subsequent V3 responses are recorded in §8.2; neither relabels the old V2 response. Any prospective review of these V4 bytes must retain that correction and the unchanged replacement copy, not transfer a prior approval.

## 1. Interaction contract

### 1.1 Eligibility and unchanged precedence

Use the automatic checkbox selector only if **all** of the following hold:

1. The existing `resolveHarnessSelection` returns automatic detection and `--select` is not active. Preserve the resolver's exact flag/env handling for `auto`, empty values, `none`, deduplication and unknown-ID errors; do not substitute a simplified precedence slogan (C43/cli/harness-consent.mjs:220-235).
2. The post-43 prompter permits interaction: stdin **and stderr** are TTYs, CI policy permits questions and input is open. The prompt stream's `promptStyle(caps.err).redraw` must be true. Current redraw is `animate && color`; forced color cannot create animation or interactivity (C43/cli/harness-consent.mjs:28-31,69-77; I/lib/term/caps.mjs:33-45,73-98).
3. `input.setRawMode` is available and at least one detected row is editable. No raw-mode polyfill, zero-row selector or all-locked input UI.
4. Centralized capability/geometry inspection reports positive finite integer physical columns and rows from the actual prompt stream, and the fully wrapped selector fits with one spare column and row (§3). Unknown/invalid/insufficient geometry takes the existing line path **before** raw mode or selector drawing.
5. The selector-specific centralized opt-out is not active: nonempty `NO_COLOR`, effective color-off or `TERM=dumb` disables the selector. A nonempty `NO_COLOR` disables this new selector even if an explicit color flag wins in the existing global color policy. Do not change that global precedence, old line renderer or old bytes (D:120; I/lib/term/caps.mjs:36-45).

Explicit flag/env selections preserve their current policy, even for an undetected known harness. `--select` remains the numbered-line mode with its existing parsing, invalid-input retry, stored-choice override and ignore notes (C43/cli/commands/setup.mjs:114-145,181-182). If selector mode never ran, preserve the legacy typed-ahead queue. Pipes and CI ask nothing; interactive no-color/dumb paths keep the existing individual line questions. No monochrome raw selector, new environment flag or setup-side capability reader is introduced.

### 1.2 Rows and initial state

Rows are `ADAPTER_IDS` intersected with detected IDs, in existing order: **omp, pi, claude-code, codex, opencode, cline, kilo-code, aider, continue, goose** (I/cli/commands/common.mjs:36; C43/cli/commands/setup.mjs:100). Use actual adapter labels. Stored filenames do not add selectable IDs.

| Choice state | Ordinary setup | With `--reask` | Confirmation rules |
|---|---|---|---|
| Readable configured | `[x] saved yes / locked` | `[x] saved yes / editable` | Locked context gets no batch answer or reask bit. Editable answers use the existing decision/write rules. |
| Readable skipped | `[ ] saved no / locked` | `[ ] saved no / editable` | Same lock rule. Nonempty confirmation can deliberately save a new yes/no. |
| Missing choice, including owned integration | `[ ] new / editable` | Same | Ownership alone is never a prechecked checkbox or new consent. |
| Unreadable/unsupported choice | `[ ] unreadable / not saved`, editable | Same | Checked may configure this run; unchecked skips. Always `record:false`; never overwrite the unreadable file. |

Directory-wide unreadability applies to all affected known rows. Keep existing warning text above the selector. Unknown/undetected stored IDs are never rows, never activated and never deleted; retain doctor's existing `doctor --forget ID` guidance without an unrelated new setup warning (C43/cli/harness-consent.mjs:263-278,289-304,391-425).

In a mixed list display **all** detected rows, locked context included. Initial focus is the first editable row. All-locked ordinary setup opens no input UI and keeps stored configure/skip outcomes and recovery hints. Reask unlocks detected known rows only, seeded from readable saved directions. One editable row uses the same one-row list and keys.

Zero automatic detection means no list, raw mode, harness-question wait, invented row or harness-choice writes. Preserve the existing line: `No supported assistant detected. The connection details below work with any OpenAI- or Anthropic-compatible client.` The separate rotator/report flow continues. An explicitly selected undetected known ID remains eligible through its existing explicit path (C43/cli/commands/setup.mjs:111-113; C43/cli/harness-consent.mjs:344-352).

### 1.3 Required English consequence copy before input arms

Inline, unboxed, stderr. The question may use the existing `? ` presentation prefix. These sentences are the **Round 39 Q1 copy**, not optional vague substitutes. Wrap them by display cells and include every resulting physical line in fit. `LABEL` below is a design substitution slot for the actual adapter label; never print `LABEL` literally. Render conditional copy only for its displayed row classes (D:34-76).

Base disclosure:

```text
Configure ZCode as a provider in these assistants?
Enter with editable checks answers yes for checked rows and no for unchecked rows.
Esc or Enter with no editable checks saves no harness decision.
A nonempty confirmation saves readable editable choices; unreadable choices apply only to this run.
```

If ordinary locked context is displayed:

```text
Saved choices are locked. Change them with: zcode-kit setup --reask
```

With `--reask`, use this instead of the ordinary lock sentence:

```text
--reask: saved choices are editable. Esc, an empty confirmation or input closing keeps their saved decision files unchanged.
```

For **each readable unowned editable row**:

```text
Esc, an empty confirmation or input closing skips LABEL for this run, even if its saved choice is yes. No harness decision is saved.
```

For **each readable owned editable row**:

```text
Esc, an empty confirmation or input closing refreshes the existing kit integration for LABEL, even if its saved choice is no. No harness decision is saved.
In a nonempty confirmation, an unchecked LABEL is skipped without refreshing its integration and its readable choice is saved as no.
```

For **each unreadable editable row**, irrespective of ownership:

```text
Esc, an empty confirmation or input closing skips LABEL without refreshing it. Its unreadable decision file is never overwritten.
```

Render the eligible editable MCP notice from §2.4 before arming as well. Keep the locked-row recovery hint. Do not collapse these facts into “unanswered” without the action; do not claim none configures nothing, all files stay unchanged or saved directions keep applying under reask. Empty Enter deliberately does **not** save an all-no batch. Existing owned integrations can refresh, including a previously skipped owned row under reask. That is not a new grant of provider or MCP consent.

After this full disclosure, show the row inventory, key hints and count. A layout example, **not a captured render**, is:

```text
    [x] OMP / Oh My Pi  saved yes / locked
    [ ] pi              saved no / locked
  > [ ] Codex CLI       new / editable

  Arrows move  Space toggle  a toggle all editable  Enter confirm
  Esc no new harness decision  Ctrl-C abort
  0 of 1 editable checked; saved yes kept: 1
```

The example omits no required disclosure in a real frame: prepend the base and conditional sentences above for the actual rows, then the eligible MCP note. No alternate screen, hidden cursor, mouse mode, OSC, emoji or color-only meaning. Use ASCII `[x]`/`[ ]` in every tier and shared focus pointers `▸` full, `►` WGL4, `>` ASCII (I/.scratch/kit-overhaul/ux/design-language.md:69-98). Row grammar is two spaces, one-cell focus marker, one space, checkbox, one space, label padded by display width, two spaces, state. Hang state under a label when necessary; never drop material state or truncate labels/commands to force fit.

“Saved” in the copy uses existing recording/idempotence and apply success/failure handling. It does not promise a timestamp rewrite for an already identical record, override unreadability, or call a failed apply successful (C43/cli/harness-consent.mjs:289-304; C43/cli/commands/setup.mjs:195-241).

### 1.4 Keys and provisional state

| Decoded key/result | Action |
|---|---|
| Space | Toggle the focused editable row once. On locked context change nothing and replace the hint area with `Saved choice is locked; use zcode-kit setup --reask`. Keep it until the next navigation/edit; no flash timer. |
| Unmodified `a` / `A` | If every editable row is checked, clear all editable rows; otherwise check all editable rows. Never touch locked rows. Two presses from a partial set end empty, not at the original partial subset. |
| Unmodified Up/Left; Down/Right | Move one displayed row backward/forward, with wrap at both ends, visiting locked context too. Never toggle. |
| Enter/Return | Confirm once after disclosure and validation. At least one editable check gives true/false for editable rows; zero editable checks gives undefined for every editable row (§2.1). Locked checked rows do not make a confirmation nonempty. |
| Decoded bare Esc | Discard provisional edits and supply undefined for editable rows; apply the explicit per-row skip/refresh matrix. No second Enter; not an abort. |
| Ctrl-C outside marked paste / process SIGINT | One idempotent `ABORTED` path, exit 130, zero decision/apply writes from an unconfirmed batch, no later interactive rotator question or overview. |
| EOF/stream close or defined raw Ctrl-D EOF | Discard provisional edits; undefined for editable rows, same matrix; input stays closed. Neither decline nor abort. |

No y/n, digits, Tab, Backspace, Home/End or type-to-consent shortcuts. Consume supported-but-unhandled control/meta/modified key sequences whole without action. Printable tokens outside the grammar trigger contamination handling, not selective extraction of useful `a`, Space or Enter characters. Ctrl-C bytes inside a recognized marked paste are discarded payload; actual process SIGINT still aborts.

### 1.5 Single owner, disclosure barrier and fast keys

`createPrompter` owns the whole setup input session. Selector and legacy line phases are mutually exclusive, with at most one live readline input consumer. Extend that owner; do not add an independent reader to setup. The interface may lazily initialize the appropriate reader; literal readline Interface object identity is not a new public contract. Keep presentation lazy (I/lib/term/load.mjs:1-28; I/docs/adr/0011-shared-output-code-two-renderers-one-token-set.md:13-15).

Lifecycle: `preflight -> disclosing -> armed -> leaving -> fresh next-question phase`. Install owned listeners/cleanup before disclosure but accept **no action** until the complete question, all relevant per-row consequences and eligible MCP notices have finished writing/draining. Finish a prior spinner and flush pending UI notes before owning the region. Drop already queued/pre-arm input; never replay it as consent or a later question's answer. Failed output cannot arm consent (D:135).

Within an armed epoch, process ordered valid key tokens once, including during a later repaint. Fast Space+Enter, two `a`s and multiple arrows can share a delivery. A chunk is transport, not a user action or provenance. Compare equivalent partitions inside an armed epoch; disclosure/reset/arming are explicit events, not guessed typing origin. Preserve the untouched legacy path's typed-ahead semantics (C43/cli/harness-consent.mjs:39-77,99-137).

### 1.6 Bounded grammar, marked paste and text contamination

**This contract does not identify every unmarked paste.** Identical unmarked typed and pasted valid key bytes are indistinguishable. A valid prefix can confirm before a later invalid suffix arrives; no reset undoes an accepted confirmation. Chunk count and timing do not establish origin. Round 39 Q4 explicitly accepts this limit, not perfect provenance (D:131,141).

1. Recognize received bracketed-paste delimiters `ESC [ 200 ~` and `ESC [ 201 ~`, including split markers. Do **not** enable, disable or query the terminal's bracketed-paste mode. No new persistent console mode or terminal-name inference.
2. On paste start, reset provisional checks/focus to the initial seeds/first editable row. Discard the **whole** payload, including valid-looking keys, newlines, Esc and Ctrl-C bytes. Keep only constant delimiter-match state. An unterminated paste remains discard-only until end/EOF/abort, without polling or a timeout that reinterprets payload. On end, discard already-buffered suffix, redisclose and arm a fresh epoch. Actual process SIGINT still aborts.
3. An ordinary printable token outside the grammar resets provisional state and enters contamination quarantine. Consume without toggling/confirming until a logical newline or decoded bare Esc. That delimiter resets only; it does not confirm or select none. Drop already-buffered suffix, redisclose fully and arm anew. Ctrl-C outside marked paste still aborts. Thus whole/split `hello\r` has no accepted result, and provisional `a` then `hello\r` resets the edit. Fresh explicit input is required after reset.
4. Retain **at most 32 undecided escape/control-prefix bytes**, bounded UTF-8/delimiter state, one CR bit and at most ten row states. No arbitrary paste/line buffer or unbounded action queue. Malformed/overlong prefixes contaminate and never replay their suffix as consent. This local input bound does not amend an existing process/resource budget.
5. Decode complete permitted CSI/SS3 arrows through the supported Node readline key-decoding mechanism within its supported escape window. Only decoded bare Esc supplies none/no-answer, never a leading ESC byte alone. Unsupported/meta/modified sequences are consumed whole. No competing custom 200-ms timer, timer-based provenance heuristic or claimed exact Windows 500-ms guarantee.

These are implementation requirements, not proof that an existing Node interface already honors every bound. If a supported-runtime implementation cannot honor them, return the concrete feasibility blocker before weakening the contract (D:137). The historical Linux Node26.7 observations in E/t83-design-grok.md:171-190 were read, not repeated or promoted to Windows evidence.

Unmarked valid-only bytes retain the same semantics as identical typed keys. Multiline unmarked input may arrive after a fresh epoch arms. Text quarantine only helps when contamination is observed before acceptance. Stronger provenance, a new terminal mode, another dependency or a different input policy requires a separate decision; neither favorable fixtures nor the old y/n path establish universal paste protection (D:141,157).

### 1.7 CRLF and selector-to-line handoff

Normalize CR, LF and adjacent CRLF as one logical terminator. A decoded return/enter pair for CRLF must not confirm twice. Hold ownership through the accepted terminator and already-buffered old-epoch keys. Drop selector suffix, partial escape/UTF-8/action state and any selector line queue; restore prior raw state, leave the owned region with a newline when writable, and only then disclose/arm the next line question. During adapter work input is unarmed/discard-only. Queued selector `y`, `n`, `a` or newline must not answer the rotator (D:138).

Carry only one **lexical `pendingCR` bit** across the handoff. If the immediately next byte in stream order is LF, consume it as that CR's tail, even if delayed. Any intervening byte clears the bit: while leaving discard that byte with the old epoch; after the new question arms, route a non-LF byte normally. No indefinite wait, wall-clock provenance/drain heuristic or blanket suppression of the first rotator Enter.

A fresh LF-only physical key identical to that delayed tail is indistinguishable and may be consumed by this rule. A later CR/CRLF Enter works, and standalone LF works once the bit clears. This is the exact accepted limitation, not a promise to identify physical-key provenance (D:138,141).

When selector mode never ran, preserve the legacy typed-ahead queue and bytes unchanged. A selector-to-line transition intentionally starts a fresh disclosure phase instead of importing old input. Unsafe-resize fallback uses that same fresh-phase rule with discarded provisional edits and no replay.

### 1.8 Cleanup, output failure and signals

Idempotently clean up on confirmation, Esc, EOF/close, raw Ctrl-D, Ctrl-C/SIGINT, exception, output failure and handled termination. Restore the **prior** raw state, true or false. Remove only owned input/resize/signal listeners and decoder timers; no `removeAllListeners` or removal of another consumer's handlers. A failed terminal write must not prevent raw/listener cleanup or become a decline/successful confirmation.

Release the region with a newline only when output is writable. Preserve existing error/signal semantics after cleanup; do not swallow SIGTERM/SIGHUP/SIGBREAK or invent success exits. SIGKILL, machine death and process death cannot promise restoration. No selector-related process killing is required (D:138; V2:161-165).

## 2. Consent and cancellation

### 2.1 Exact Round 39 exit-to-decision/action matrix

This is **U1 as decided**, not a recommendation left for guessing. Nonempty confirmation is intentionally asymmetric with empty Enter. Only editable rows receive a selector answer map; locked context stays outside it.

| Input / row class | Action in this run | Harness-choice persistence / MCP |
|---|---|---|
| Nonempty Enter; readable editable checked | Existing interactive true: configure through normal apply/savepoint handling | Existing configured-record rules. MCP only for this ID after its eligible disclosure. A failed apply is not configured success. |
| Nonempty Enter; readable editable unchecked, owned or unowned | Existing interactive false: skip, **no owned refresh** | Existing skipped-record rules. This is an actual decline, unlike Esc/empty Enter. |
| Nonempty Enter; unreadable editable checked/unchecked | Checked configures this run; unchecked skips without refresh | Always `record:false`; unreadable file never overwritten. Existing MCP offer/veto still applies to actual yes. |
| Esc / empty Enter / EOF; reask; readable **unowned**, old configured/skipped/missing | **Skip this run**, including an old saved yes; do not reapply stored direction | `record:false`; saved bytes, source, timestamp and MCP bit unchanged. No new consent/MCP grant. |
| Esc / empty Enter / EOF; reask; readable **owned**, old configured/skipped/missing | **Existing owned-integration refresh**, subject to normal adapter success/failure | `record:false`, `consent:false`; no new MCP. Saved no does not prevent this no-answer refresh. |
| Esc / empty Enter / EOF; **unreadable**, owned or unowned | **Skip, no refresh**; unreadability precedes ownership shortcut | `record:false`; file unchanged; no new MCP. |
| Esc / empty Enter / EOF; ordinary editable, no saved decision | Readable owned: existing refresh; readable unowned: skip; unreadable: skip without refresh | No new harness-choice record or MCP grant. Ownership never seeds a check. |
| Any selector result; ordinary readable **locked** row | Saved configured: stored configure path. Saved skipped: stored skip path | No new record or changed provenance/MCP bit. Pass no batch answer or reask bit for locked context. |

This reproduces D:17-30 and existing policy, independently read at C43/cli/harness-consent.mjs:340-369 and I/cli/harness-consent.mjs:326-355. `reasking` depends on an answer **function**, not whether it returns a boolean. For editable reask results keep `reask:true` **and a function returning undefined** when there is no answer. Do not replace it with `ask:null`, which would reinstate saved short-circuits. For ordinary locked rows retain those short-circuits without batch input.

Esc discards provisional checks and needs no second Enter. Empty means zero **editable** checks; locked saved yes does not count. EOF discards provisional checks and uses the same absent answers **while input remains closed**; no later interactive question may consume it. EOF is neither decline nor abort. Abort before confirmation throws `ABORTED`, exit130, with no provisional batch apply/decision writes, no later interactive rotator question and no overview. Other errors/handled termination clean up and propagate existing semantics, never synthesize yes/no/success (D:13,32).

### 2.2 Storage, transactions and failure timing

The selector yields only an in-memory answer map and outcome reason. No new schema, decision file type, fake explicit flag or serialized selector object. Feed existing per-ID decision/apply/savepoint/recording plumbing (C43/cli/commands/setup.mjs:170-242). Readable locked bytes/provenance/timestamps/MCP and unknown/undetected files stay unchanged. Unreadability protection and existing foreign-copy checks remain.

There is no new all-or-nothing batch apply promise. Collect the batch before apply, then preserve per-adapter savepoints, rollback and partial failures. True/false use the existing writer's idempotence; a failed apply cannot count as successful configuration. One harness failure retains exit20 and other successful work. Ctrl-C during the unconfirmed selector writes nothing from that provisional batch; already authorized/applied later work is not retroactively erased. Preserve the legacy sequential partial-answer Ctrl-C tests on the unchanged line path (C43/cli/harness-consent.mjs:289-304; C43/cli/commands/setup.mjs:195-241).

### 2.3 Rotator and exits remain separate

The Account Rotator remains a line question with `[y/N]`, default no, asked-once/stored-choice/migration semantics from ticket42 (I/cli/account-setup.mjs:8-10,23-32,82-142). It gets its own complete disclosure and fresh input phase. Selector terminators never answer it.

“No rotator asked after Ctrl-C” means no later **interactive question**. Existing explicit `--account-rotator` / `ZCODE_KIT_ACCOUNT_ROTATOR` precedence still wins even after an earlier abort (I/cli/account-setup.mjs:82-93,114-115; D:32). Do not cancel that authorization or change rotation, quota, claims or account-store behavior to strengthen the sentence. Selector/overview generation adds no account-store read.

Setup exits remain 0, 2 for unknown harness, 20 for harness partial failure and 130 for abort, with existing fatal/error/signal handling (I/cli/commands/common.mjs:38-43; C43/cli/commands/setup.mjs:56-60,336-337). Smoke warning/skipping does not prove live access. This design authorizes no live model or claim request.

### 2.4 MCP disclosure, offer IDs and veto

Only editable `omp`/`claude-code` rows may receive the existing eligible offer, after bridge availability and `--no-mcp` checks. Exact retained notice:

```text
Selecting LABELS also registers the kit's MCP bridge "zcode-harness" (skip with --no-mcp).
```

Substitute the actual eligible editable labels, joined with ` or `. Write/drain the complete wrapped notice before arming. Freeze the disclosed **editable offer-ID set**, not every displayed row. Checked answers enter the existing interactive decision path with `mcpOffered` true only for those IDs. Never route them as synthetic `explicit` selections, whose MCP rule is broader (C43/cli/harness-consent.mjs:344-369).

Locked saved yes keeps its stored MCP bit; another row's notice cannot add one. No-answer refresh has `consent:false` and no new MCP. Unreadable actual yes may authorize this run's eligible MCP without overwriting its choice file. `--no-mcp` remains an absolute **registration veto**, including stored `mcp:true`, without rewriting the locked file to false. Reuse the existing registration/foreign-copy protection flow (C43/cli/commands/setup.mjs:157-185,243-246,354-425; D:153). No MCP protocol/transport/dist work belongs to 83.

## 3. Terminal capabilities and fallbacks

### 3.1 Additive geometry seam, not global policy replacement

U3 explicitly adds **`lib/term/caps.mjs`** for optional measured physical columns/rows and the selector-specific capability gate (D:115-120). Current logical width uses stream/env/default and clamps to at least40; no measured row field exists (I/lib/term/caps.mjs:27-28,62-85). Keep logical `caps.width`, color precedence, old callers and fallback bytes unchanged. Optional physical values are separate, positive finite integers from the actual prompt stream, post-43 stderr. `COLUMNS`, `LINES`, default80, the logical minimum40 and assumed24 rows are **not physical-fit evidence**.

At the centralized seam supply selector eligibility/geometry and the selector-only nonempty-NO_COLOR opt-out; do not read environment/geometry a second time in setup. No terminal query/mode change, viewport, dependency or new environment flag. Forced color cannot manufacture interactivity/animation or override the selector's no-selector policy for nonempty NO_COLOR/dumb.

Use a layout width no greater than both **measured columns minus one** and the shared logical design width. Measure with shared display-cell helpers. Wrap the entire question, every per-row consequence, eligible MCP notice, reask/owned/unreadable text, row metadata, hints/count, blanks and maximum locked-row feedback. Occupied physical lines plus **one spare row** must fit measured rows. Keep the spare column to avoid automatic-margin wrapping ambiguity. No data-row-only estimate, arbitrary70-column threshold, dropped material state or truncated label/command to force fit (D:118; I/.scratch/kit-overhaul/ux/design-language.md:200-211).

Unknown/invalid geometry, insufficient fit, an indivisible required token that cannot fit, absent raw support or no editable rows takes the existing line/no-question path before raw mode/drawing. Ten adapters is today's bound, not evidence that ten rows plus a fixed chrome allowance fits every console.

### 3.2 Resize and region ownership

A fitting resize re-reads centralized geometry, reflows all content, preserves provisional checks/focus and redraws only the owned region. Revalidate geometry before accepting confirmation, including a generation change while drawing. A fitting repaint alone neither resets state nor loses armed valid keys.

Unsafe shrink or newly unknown geometry first disarms, discards provisional edits and restores the prior raw state. Erase only provably owned safe lines. If rewrap/shrink makes old-region erasure uncertain, append rather than move above ownership. Emit this exact stderr notice:

```text
Terminal too small for the selector; continuing with individual questions.
```

Enter a **fresh legacy line phase**, no replay or answer derived from abandoned checks. No silent write on fallback. Finish a prior spinner and prevent competing redraw in the selector region. If an unavoidable diagnostic must print while selection is live, disarm/leave safely before printing and continue with individual questions; do not hide warnings to preserve a frame (D:119; V2:222-226).

### 3.3 All eight C3 variants and asymmetric streams

Use the exact repository variants (I/tests/snapshot-harness.mjs:28-40), adding explicit measured geometry/raw-input fixtures for selectors rather than assuming missing rows mean24. The current fake couples stdout/stderr TTY and omits rows (:42-69); extend fixtures without globally changing legacy snapshot facts.

| Variant | Consent interaction | New overview |
|---|---|---|
| `tty-color-80`, `tty-color-120` | Selector only with measured full fit; otherwise legacy line path | Outcome-dependent5/6 commands, shared alignment/wrapping |
| `ascii`, `wgl4` | Same gate, ASCII checkboxes and `>` / `►` pointers | Tiered header, same commands/facts |
| `no-color`, `term-dumb` | Existing line questions where interactive; no selector raw mode/motion | Plain block; no escape bytes |
| `pipe`, `ci` | Existing no-question path, including CI with synthetic TTY streams | Plain unwrapped command rows; no escapes/boxes |

Add stdin-only pipe, stderr-only redirection, stdout-only redirection with interactive stdin/stderr, everything piped, and CI=true with TTY streams. Redirecting stdout alone must not disable the post-43 stderr prompt; redirecting stderr must disable it. Preserve existing global override precedence and old line bytes even when an explicit color flag wins globally; the selector-specific opt-out is additive.

Fallback means the exact accepted **post-43** harness `[y/n]` path and empty retry `Please answer y or n.`, not the old ticket's shorthand `[y/N]` (C43/cli/harness-consent.mjs:143-172). Rotator alone defaults no. Preserve flags/env/`--select`/queue and separate stdout/stderr. For completed whole-setup transcripts remove only the exactly verified additive overview suffix for preservation comparisons; no status/exit/marker/stream normalization.

### 3.4 Native Windows evidence is still required

Portable fixtures and Linux PTYs do not prove native Windows input/rendering. Real conhost/PowerShell5.1 and Windows Terminal must cover arrows, Space, `a`, Enter/CRLF, decoded bare Esc, Ctrl-C, resize, fresh rotator ownership and returned-shell usability. Historical Linux Node evidence remains historical. **No Windows proof is claimed here** (D:121; E/t83-design-grok.md:171-190,207-209).

Ticket44 separately owns its actual windows-latest PowerShell5.1 stderr gate: installer setup invocation and `.cmd -> .ps1` shim with `2>&1`, `-File … 2> file`, `$ErrorActionPreference = "Stop"`, no terminating NativeCommandError and unchanged exit handling (I/docs/adr/0005-stdout-stderr-stream-contract.md:17-19; ticket44:17-19). Run with 83's additions. Do not move prompts to stdout or replace this with Linux PowerShell parsing. Native interactive console rendering stays unverified owner evidence until actually performed safely with fixtures.

## 4. English Next steps

### 4.1 Exact U2 inventory and source/preconditions

For every completed, non-aborted setup report, use the **five base rows decided by Q2**, in this order. Heading rule/padding belongs to the renderer; this is semantic content, not an executed snapshot:

```text
Next steps
  zcode-kit doctor          Check the installation
  zcode-kit proxy start     Start the proxy for manual clients
  zcode-kit proxy status    Check proxy health and connection details
  zcode-kit auth status     Check sign-in status
  zcode-kit --help          Browse all commands
```

| Actual command | Source and honest first-use meaning |
|---|---|
| `zcode-kit doctor` | Real form at I/cli/commands/help.mjs:13. Checks installation; includes authentication when its own proxy is reachable (I/lib/proxy-doctor.mjs:89-109,158-170). Do not claim doctor omits auth or proves a model reply. |
| `zcode-kit proxy start` | Real form at I/cli/commands/help.mjs:15. Manual clients need a proxy; harness launch already performs preflight (I/cli/launch.mjs:27-30). Incomplete/foreign installations may fail under existing checks/exits; displaying the form is not executing it or guaranteeing success. |
| `zcode-kit proxy status` | Real form at I/cli/commands/help.mjs:15,31-34. Existing identity/key-withholding policy still governs displayed connection details. No local configuration/health result becomes sign-in/model proof. |
| `zcode-kit auth status` | Real form at I/cli/commands/help.mjs:16; currently returns focused JSON on a TTY too, with an unreachable result if its proxy cannot answer (I/cli/commands/auth.mjs:21-35). Do not advertise the separately planned human format or depend on ticket46. |
| `zcode-kit --help` | Explicit full help remains available, before kit context, exit0 (I/cli/commands/help.mjs:1-3,10-21). This curated block does not remove any command. |

Q2 explicitly chooses `auth status` over a suggested `proxy logs` base row. V2 already used `auth status`; never claim V2 contained `proxy logs`. Logs, integrate syntax and every other command remain in full help and applicable failure guidance. This is an editorial first-use choice, not measured command-frequency evidence (D:86-107).

Insert **at most one** concrete `zcode-kit run ID` immediately after doctor, with description `Launch LABEL wired to ZCode`, only under §4.2. Example **only for a qualifying Codex outcome**:

```text
  zcode-kit run codex       Launch Codex CLI wired to ZCode
```

No executable-looking placeholders, unconditional launch row, new login/launcher strategy or guessed detected ID. Existing login/manual-action/failure/undecided hints remain. Base commands are syntactically complete; not every one is guaranteed to return success on an incomplete installation. No shell parse or command execution was performed here (D:107).

### 4.2 Qualification and completed-outcome matrix

Choose the first qualifying ID in existing `ADAPTER_IDS` order restricted to **claude-code, codex, opencode, aider**, the actual launchers (I/cli/commands/common.mjs:36; I/cli/launch.mjs:12-26). It must have successfully reached **this run's `outcome.configured`**, be neither manual nor a no-consent refresh, and have standing saved yes or deliberate this-run provider consent. **Any harness failure suppresses the row**, even if another harness succeeded. Do not infer success from detection, provisional/abandoned checks, a filename or old saved yes alone (D:99).

Use already available decision/outcome information: setup has `decision.consent` and distinguishes manual/refreshed/success/skipped/failed outcomes (C43/cli/commands/setup.mjs:195-241). Current `outcome.configured` stores `{ id, label, refreshed, manual }`, not a separate persisted consent field (:239). Qualification may use the consent already observed in the same apply loop; it must not invent a new state schema or reread real artifacts.

Launcher preconditions are actual source facts, not new probes: Claude requires generated `claude-zcode-settings.json`, Codex generated `codex-home/config.toml`, Aider generated `aider-zcode.env`; OpenCode has a direct launcher (I/cli/launch.mjs:12-26). Their successful apply paths create/update the matching artifacts/provider config (I/cli/adapters/claude-code.mjs:16-44; codex.mjs:16-45; aider.mjs:15-27; opencode.mjs:61-96). The overview uses observed successful apply, **not** new config/credential reads, executable scans, launcher calls, proxy probes or account-store inspection.

| Completed setup outcome | Overview |
|---|---|
| Zero detection, no selected/standing consent, explicit none, only skipped/undecided | Five base rows. No fabricated launchable ID. |
| Only non-launchable/extension/manual outcomes, or only unconsented owned refresh | Five base rows; preserve existing adapter instructions. |
| At least one qualifying successful launcher outcome, zero harness failures | Six rows; first qualifying ID deterministically. Successfully applied stored yes can qualify; detection or saved bytes alone cannot. |
| Exit20, including a different successful launcher | Five base rows; keep existing failure what/why/next. |
| Smoke warning/skipped or withheld/unavailable connection, otherwise completed | Applicable5/6 rows. Row certifies configuration only, not connectivity; keep warning/withholding/recovery explanations. |

Abort130 and early fatal incomplete reports get **no generic overview**. Esc/empty/EOF is not abort: if setup completes, the base block remains; a successfully applied locked saved yes can qualify only by the same launch rules. The row does **not** certify installed external executable, sign-in, available quota or a successful model reply (D:101-103).

### 4.3 Placement, stdout and canonical log sink

Print exactly once as the last **normal stdout report section**, with one preceding blank line, after connection details or their unavailable/withheld explanation and any existing setup-log reference. The C43 summary already includes Setup log (C43/cli/commands/setup.mjs:273-281,304-337); do not add a second tail pointer. Do not nest this block in key-reveal/connection logic, a progress callback, `Out.next` or an adapter diagnostic.

Use the same outcome matrix in compact, verbose, `ZCODE_KIT_VERBOSE=1`, `--installer`, pipe and CI. Prompts/key hints remain stderr; reports remain stdout (ADR-0005:11-19). Do not retarget unrelated old verbose lines during 83. Abort/fatal incomplete report suppresses the block.

Add a small `setupUi.commands` bridge: validate the semantic block before either sink, render the full block **once** through `out.commands` to the screen in every mode, and append **once** through existing `log(text)` a canonical plain rendering of the same semantic rows/title. Reuse the output renderer with an injected non-TTY ASCII no-color capture sink for this log representation, not a second ANSI/padding implementation in setup. Canonical log form has the blank separator, ASCII heading rule to80, same order/descriptions, unwrapped rows and final newline. Pass text without its final LF to `log`, whose current callback appends one (C43/cli/setup-output.mjs:181-188).

These are two sinks, not two screen renders. Do not route via `detail`/`progress`/per-row console plus Out/prompt logging, or let verbose append another copy. Preserve **every previous verbose log line**, additions allowed, no replacement/removal. Retain the full line-set comparison and negative controls. Never log raw keys, paste payloads, provisional redraws or secrets. The second-sink source is C43/cli/setup-output.mjs:3-15,29-38,64-111,147-188; it is not a fabricated special controller log-append ruling. Q2 retains one plain log copy (D:105).

### 4.4 Additive renderer and JSON suppression

Proposed narrow interface in existing `lib/term/out.mjs`:

```js
out.commands(rows, { title, note } = {})
```

`rows` is a nonempty array of `{ command: string, description: string }`. Setup passes `title: "Next steps"` and no note. All provided fields, including optional title/note, must be nonempty strings without CR/LF, ESC or other control characters. Reject invalid input with TypeError before any output. Add the `commands` record kind/dispatch with the same semantics and validate its fields in the record pre-output pass. Existing renderRecords prechecks **kinds only**, not every field (I/lib/term/out.mjs:351-363); do not turn 83 into unrelated record-validation cleanup.

Rows: two-space indent, command padded by shared display-cell width to this block's widest command, two spaces, description. Heading uses existing tiered rule to `min(width,80)`. No boxes, bullets, numbers, `next:` or `or` prefixes. Test actual80/120 fit. Narrow TTY: command intact on its own line, description wrapped with four-space hanging indent. No truncation; an indivisible command wider than the terminal remains intact even if the terminal physically wraps. Off-TTY each row is one unwrapped physical line.

The **whole new block** is plain for pipe/CI/dumb caps even under forced color, with no escape byte when color is off. Color TTY uses existing heading/cmd/muted roles and same-line SGR closure. Raw off-TTY `grep '^  zcode-kit '` must match the actual **5 or6** rows, never hardcoded8. Notes cannot masquerade as commands.

Use existing `report()` suppression, not raw `data`, for the full additive title/rows/note (I/lib/term/out.mjs:275-281,329-348). Keep Out.kv/Out.next/other headings/global policy unchanged and imports lazy (I/lib/term/load.mjs:1-28). There is **no current setup JSON document**: setup streams output and returns exit records (C43/cli/commands/setup.mjs:336-337; I/cli/zcode-kit.mjs:116-145). Do not invent `nextSteps`/`commands` JSON fields or claim `setup --json` is a supported document. Renderer JSON suppression and unchanged existing command JSON contracts are distinct obligations.

## 5. Installer single overview source

Setup supplies the new overview **including `--installer`**, per ticket83:46, ticket44:36-38 and D:105. Ticket83 does not edit install.sh/install.ps1 or suppress its own installer-mode block. Keep necessary login/completion/manual-action hints.

| Acceptance owner | Required proof |
|---|---|
| **83** | Fixture invocation `setup --harness auto --installer` has one setup-generated overview, correct stdout/log behavior, banner suppression,5/6 outcome count and unchanged setup exits. This does not claim whole-installer uniqueness. |
| **44 after83** | Remove only duplicate general command-footer rows, then prove the **complete installer output** has one canonical overview. Keep login/manual hints, `Installation complete.`, shim/PATH guidance, warnings/exits and the actual PS5.1 stderr gate. |

Current scripts call setup at I/install.sh:205 and I/install.ps1:188 and still print old footer rows at :239-245 / :219-225. Temporary overlap before44 is known dependency work, not a passing uniqueness test. Existing `44 <- 83` is already recorded; no reverse edge or premature footer removal.

Installer exit semantics are **not** identical to child setup: install.sh:215-221 and install.ps1:189-198 tolerate setup20/130 and preserve installation success. Keep that mapping; do not assert the entire installer must exit20/130. Native PowerShell/console proof remains separately unverified.

## 6. Integration and migration

### 6.1 Bounded file responsibilities

| File/seam | Responsibility in the eventual isolated ticket83 worktree |
|---|---|
| `cli/harness-consent.mjs` | Single input owner, mutually exclusive selector/line phases, bounded decoding/cleanup and answer-map result. Preserve resolver, legacy queue/bytes, schema and `decideHarness` policy. C43:39-180,220-235,340-369. |
| `cli/commands/setup.mjs` | Build detected known row inventory with pre-arm per-row/MCP disclosure, invoke eligible selector before apply, wire interactive answers/disclosed IDs and final overview from real outcomes. Reuse existing transactions/savepoints. C43:100-186,195-265,273-337. |
| `lib/term/out.mjs`, existing lazy load and **`lib/term/caps.mjs`** | Add described-command block/record; U3 permits only optional measured physical geometry and selector capability gate at the existing seam. Share tokens/width, preserve logical width/color/old callers. I/out:275-281,329-399; caps:1-17,27-98; load:1-28. |
| `cli/setup-output.mjs` | Small one-screen/one-plain-log bridge over accepted43 writer. Preserve all old verbose detail lines. C43:3-15,29-38,64-111,147-188. |
| Tests/snapshots and necessary script wiring | Consent/input, caps/renderer/streams, setup/log/C3, preservation mutants and portable PTY fixtures. Entire named suites remain required; new test files wired. No product implementation occurs in this drafting ask. |

`cli/zcode-kit.mjs` remains dispatch, not a relocated setup body (I:116-145; ticket83:41). No adapter/launcher/installer, account/rotator policy, dependency, crypto/claim path, endpoint, global config, decision schema, release or version change is required or authorized by83. Q4 permits no runtime/file scope beyond U3 and the already listed prompter/setup/output/tests (D:157).

The `codebase-design` skill was loaded in this drafting session. Its small-interface/single-owner principles are applied here by keeping parser lifecycle inside the prompter, capability/geometry decisions at the existing seam and described rows inside Out, rather than distributing those implementations across setup callers. It supplies no policy decision or approval.

### 6.2 Adoption, baseline and documentation

No state migration: schema1, harness-choices directory, existing flag/env/transaction/rollback semantics remain. Only actual editable answers may invoke existing recording rules. Round39 U1 determines when an answer exists; a proposal itself cannot change persistent policy.

The canonical adoption prerequisite is **completed** at `afe14cfe464a49176b39317ac7e27d63925c5d3d`: A43 ticket83:15-29,40-44, spec:804-813, DECISIONS:5818-6039 and ADR-0001:45-152 carry U1/U2/U3/Q4 and the exact required copy. Those four canonical files were compared byte-for-byte between afe14cf and accepted43 final `54771fdfde870394236e547394f3330ce518b6e7`; they are unchanged. The accepted merged43 baseline is now pinned to that final, following actual merge `7ffb80ff33dde1749ad574e20f285eb9f564893f`, not an unaccepted candidate. Original V3's pre-43/pending-transcription statements describe its historical inspection only. **Actual same-new-hash ratification, implementation authorization and feasibility/evidence remain open**; adoption/43 acceptance do not close them or backdate V3's ordering error. If a later implementation finds a source discrepancy, report it explicitly rather than weakening stream/consent/log tests or widening this correction.

Future affected onboarding documentation follows C8: English canonical README and translations de/es/ja/zh-CN, harness documentation and other affected support/security/effort documents only where their content changes (I/.scratch/kit-overhaul/PROMPT.md:163-165). No new behavior should be presented as shipped in this proposal. This drafting ask writes no product docs, release notes, tickets, ADRs, tests or git state.

### 6.3 Hard boundaries and execution limits

B1 anti-abuse challenge/pass/identity/rotation/quota/rate behavior is unchanged; this design is onboarding lifecycle/errors/observability only. B2 prohibits secret/token/account-store read/copy/print. B3 leaves installed kit, running proxies and real harness configs untouched; tests use temp HOME/fixtures/mock upstream. B4 permits killing only owned processes with PID **and process-group** tracking. B5 MCPdist is build-only, never hand-edited. B6 no version bump/tag/release/main merge (I/.scratch/kit-overhaul/PROMPT.md:215-233).

Owner checkout `/home/AgentKit/ZCode-Agent-Kit` remains read-only. Future product work uses isolated ticket worktrees; commits only through gitc.sh if separately authorized. No history rewrite, force push, push, merge or CI-trigger authorization follows from V3. No delegation, live model/claim call or workflow amend/resume/restart. Existing user concurrency setting is unchanged.

## 7. Verification

**FUTURE / NOT RUN FOR83:** every implementation suite, input/PTY test, snapshot, mutation, log-line-set check, build/install/soak and platform gate below. Reading a historical pass or decision is not running it. No product execution occurs in this status-only correction. Sections7.1-7.3 remain unchanged from V3. Section7.4 preserves V3-session inspection history, **not commands rerun for V4**. Section7.5 separately identifies current editorial integrity/revision checks. The skill-load claim retained in §6.1 also belongs to the original V3 session, not this correction.

### 7.1 Consent/input seam: required RED -> GREEN observations

| Test group | Required assertions at observable interfaces |
|---|---|
| **U1 action/persistence matrix** | Nonempty checked/unchecked true/false for readable owned/unowned, saved yes/no/missing; unreadable true/false without writes. For each of Esc/empty Enter/EOF under reask, cross old configured/skipped/missing with readable owned/unowned: unowned skips even old yes, owned refreshes even old no, all choice bytes/source/timestamp/MCP unchanged. Unreadable owned/unowned always skips without refresh. Ordinary missing owned refreshes/unowned skips; ordinary locked configured/skipped keeps stored path and MCP. Assert actions **and** decision bytes, not snapshots alone. |
| **Rows/disclosure/keys** | Mixed locked/editable; zero/one/all-locked; readable reask seeds; ownership never prechecks; directory-unreadable; unknown/undetected untouched. All four arrows/wrap, locked Space hint, partial `a` -> all -> none. Exact Q1 per-row consequences and eligible MCP precede arming. Drop pre-arm input, reject failed disclosure, accept armed Space+Enter/two `a`s in one delivery and equivalent partitions once, including repaint. |
| **Grammar/paste limits** | Whole/split delimiters, payload with Space/a/Enter/Esc/Ctrl-C discarded as a whole, real SIGINT abort; large and unterminated paste constant bounded state, no payload log; malformed/overlong prefixes contaminate. Whole/split `hello\r`, valid provisional prefix then text reset, reset newline/Esc not confirmation. Complete/split CSI/SS3 vs bare Esc, unsupported/meta/modified whole consumption. Tests do not claim to detect valid-only unmarked paste or undo an already accepted prefix. |
| **Handoff/cleanup** | Whole/split CRLF one effect, queued selector y/n/a/newline and partial parser state isolated from rotator, delayed adjacent LF tail consumed with explicit LF-only ambiguity, intervening byte clears bit, fresh CR/CRLF and later LF answers work. EOF/close/input stays closed; Ctrl-C/SIGINT abort once with zero provisional writes; exceptions/write failure/handled termination; prior raw true/false; owned listener/timer cleanup. Keep explicit rotator flag/env priority and legacy partial-answer abort tests. |
| **Geometry/resize** | Unknown/NaN/zero/negative/noninteger/infinite dimensions; actual sub-40 columns, no env/default fallback as physical proof. Maximum row inventory and fully wrapped Q1/MCP/owned/unreadable/reask notices/locked feedback/blanks/count plus spare margins. Fitting reflow retains state; shrink/new unknown disarms and discards before fresh line path; no erasure above ownership or queued replay; no competing redraw. |

Preserve explicit flag/env/none and numbered `--select` behavior separately. An all-unchecked **nonempty** batch is impossible by definition: deliberate false answers for every row require a nonempty batch containing another editable checked row, or the unchanged explicit/line mechanisms. Empty Enter supplies undefined, not all-false. Tests must reflect this decided asymmetry instead of silently restoring the original recorded-empty policy (D:13,76).

### 7.2 Output, preservation and installer obligations

1. **All eight C3 variants:** stdout/stderr separately, raw ANSI and logical frames, forced-color/plain combinations, asymmetric streams, measured geometry and fixed caps with process TERM unset/dumb/xterm. Do not strip ANSI to hide motion or normalize statuses/exits.
2. **Accepted-post43 preservation:** pin the accepted merged parent; byte-compare unchanged line/flag/env/`--select`/pipe/CI/no-color/dumb paths. For completed whole setup remove only the exactly checked additive overview suffix. Deliberate mutants changing `[y/n]`, default/retry, CI bypass, env selection, unanswered persistence, stream routing or deleting an old log line must fail. No broad normalizer or suite narrowing.
3. **U2 inventory/renderer:** exact five base commands/order/descriptions plus deterministic first qualified optional run. Cover every launcher ID, all nonlaunchable IDs, saved vs this-run consent, unreadable this-run yes, manual/skipped/failed/refreshed exclusion, no detection/explicit none, exit20, abort, smoke warning, withheld/unavailable connection, compact/verbose/env/installer. Assert raw off-TTY grep count equals actual5/6, no placeholder actions, control validation before output, no forbidden escapes/boxes and renderer JSON suppression with no invented setup document.
4. **Log completeness:** exactly one screen block and one canonical plain log append for each completed nonabort mode; none on abort/fatal incomplete report. Preserve every prior verbose line via the **complete line-set comparison and negative controls**. No raw keys, provisional frames, paste payload or fixture secret in logs. Do not relabel a screenshot as log proof.
5. **Installer/platform owners:** 83 tests the setup invocation under `--installer`; 44 later tests whole-installer uniqueness after footer-only removal. Keep login/completion/PATH/shim/exit mapping and actual native PS5.1 stderr gate. Native conhost/Windows Terminal and macOS claims require their own executed evidence, never a Linux fixture substitute.

### 7.3 Entire named suites and later central gates

After transcription, actual ratification, accepted43 baseline pinning and implementation authorization, run the **entire** named regression suites, without a test-name filter:

```sh
node --test tests/setup-regressions.test.mjs tests/cli-kit.test.mjs
```

Also run complete existing consent/account/output/caps/snapshot/boundary suites and post43 log/setup-report suites, plus newly wired selector checks:

```sh
node --test tests/harness-consent.test.mjs tests/account-setup.test.mjs tests/term-output.test.mjs tests/term-caps.test.mjs tests/term-snapshots.test.mjs tests/term-boundaries.test.mjs tests/setup-report-snapshots.test.mjs tests/install-log-lines.test.mjs tests/test-wiring.test.mjs
```

Run central **`npm run test:all`**, not a build or one file as a substitute. Current definition runs kit, proxy, proxy typecheck and MCP; post43 wiring must retain the union (I/package.json:16-20; C43 ticket43:144,156-167). Preserve normal exact-head both-OS CI/memory ratchets and merged-tree/regenerated-dist sanity. No current draft or inherited old CI supplies these passes or authorizes push/merge/CI dispatch.

Every test/install/build/soak uses **`/home/AgentKit/overhaul-tools/run-capped.sh`**, approved explicit hard memory cap/timeout, isolated HOME/XDG, pinned Bun1.4.2, fixture/mock upstream and tracked owned PID **and process group**. The wrapper sets hard systemd MemoryMax/SwapMax0, HOME/XDG, pinned Bun PATH and timeout and records a PID (E/run-capped.sh:2-18); it does **not** by itself discharge B4's additional process-group obligation. Preserve caller-owned PGID tracking. Use the isolated ticket worktree or tracked-only fixture export, never ignored installed state/keys or real configs. Verify pinned Bun before future execution; do not substitute another Bun or live upstream.

Planned example invocations, **not run and not permission to loosen an approved budget**:

```sh
/home/AgentKit/overhaul-tools/run-capped.sh t83-named-regressions-v3 3G 600 -- node --test tests/setup-regressions.test.mjs tests/cli-kit.test.mjs
/home/AgentKit/overhaul-tools/run-capped.sh t83-consent-output-v3 3G 600 -- node --test tests/harness-consent.test.mjs tests/account-setup.test.mjs tests/term-output.test.mjs tests/term-caps.test.mjs tests/term-snapshots.test.mjs tests/term-boundaries.test.mjs tests/setup-report-snapshots.test.mjs tests/install-log-lines.test.mjs tests/test-wiring.test.mjs
/home/AgentKit/overhaul-tools/run-capped.sh t83-central-full-v3 3G 2400 -- npm run test:all
```

Use existing exact mock/fixture isolation, not setup's live smoke. If an entire named check cannot be isolated or fit approved bounds, escalate with the concrete blocker, not a narrower substitute or weakened assertion. No suite, runtime feasibility probe, native Windows/macOS experiment, install, build, soak or live endpoint ran in this drafting ask.

### 7.4 Historical V3 read-only checks — preserved, not rerun for V4

**Everything from this paragraph to §7.5 is the original V3 inspection record.** Its commands, output fences and evidence quotations are retained unchanged. Within this historical record, “this ask”, “actually executed”, “fresh”, “here”, target absence, HEAD, search and diff results mean the **original V3 creation session only**. They do not describe current integration, current output-path absence or execution during this V4 correction. In particular the old reconciliation exit1 and old missing-transcription search are not current prerequisite findings. None of these historical check blocks was rerun or adopted as a current test pass merely by copying it.

These are **inspection/integrity checks only**, not product/platform tests. Initial target absence, HEADs and decision/review hashes were checked with:

```sh
if test -e /home/AgentKit/overhaul-tools/t83-proposed-gpt-grok-v3-20261110.md || test -L /home/AgentKit/overhaul-tools/t83-proposed-gpt-grok-v3-20261110.md; then printf 'V3_EXISTS_STOP\n'; exit 10; else printf 'V3_ABSENT\n'; fi
git -C /home/AgentKit/wt/overhaul log -1 --format='%H %s'
git -C /home/AgentKit/wt/t43 log -1 --format='%H %s'
sha256sum /home/AgentKit/overhaul-tools/rounds/round-39-onboarding-answers-20261110.md /home/AgentKit/overhaul-tools/t83-proposed-gpt-grok-v2-20261110.md /home/AgentKit/overhaul-tools/t83-ratify-v2-grok-20261110.md /home/AgentKit/overhaul-tools/t83-ratify-v2-gpt-20261110.md
```

Actual output:

```text
V3_ABSENT
829202b32cde3a2285c2c3fc39a5fc0394f1b50b docs(overhaul): resolve ticket 40 after central merged-tree gates
c27965a6fffe744996c59b9d9b7c2def00470f85 docs(overhaul): preserve ticket 43 reconciliation test logs
737aa578a57853b014dbd4838d5c9b0eb5bf9e23aa0548482676f73392d345ba  /home/AgentKit/overhaul-tools/rounds/round-39-onboarding-answers-20261110.md
210fbd6ffc2790547b3b3e79f4e4a5989b1bd99acb5dee45cb6aa97d17d67d07  /home/AgentKit/overhaul-tools/t83-proposed-gpt-grok-v2-20261110.md
bcebd678dc93b703d04e7bac6dfb71f62df1d8768ba99b9c65b25e08f7709838  /home/AgentKit/overhaul-tools/t83-ratify-v2-grok-20261110.md
58bae16339c5dee4d6b32f73c3701f66417542a2dcb686832f29e9204e5613c5  /home/AgentKit/overhaul-tools/t83-ratify-v2-gpt-20261110.md
```

Amendment-location search and ancestry inspection actually ran:

```sh
rg -n 'Round 39|U1|U2|U3|round-39|onboarding' /home/AgentKit/wt/overhaul/.scratch/kit-overhaul/DECISIONS.md /home/AgentKit/wt/overhaul/.scratch/kit-overhaul/spec.md /home/AgentKit/wt/overhaul/docs/adr/0001-terminal-design-language-ledger.md
git -C /home/AgentKit/wt/overhaul merge-base --is-ancestor ee15ea2c7a9bb65932a60310df82395be3420fc2 HEAD
printf 'RECONCILED43_IN_INTEGRATION_RC=%s\n' "$?"
```

Actual output:

```text
/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/DECISIONS.md:139:**Rationale:** A-04 is an S1 finding with direct evidence: the question returns every time, and an update hung 120 s in all TTY captures. The harness-choice precedent already exists (`generated/harness-choices/`, `--reask`). Changing when the question is asked is onboarding UX. It does not change rotator behaviour (B1).
RECONCILED43_IN_INTEGRATION_RC=1
```

That search found only an older onboarding mention; it is not a product test or a substitute for reading the ticket/decision. The ancestry exit1 establishes only absence of that reconciliation commit from inspected integration, not a failing product test or future merge judgment.

The following executed commands each produced **empty output** in the same inspection call. No output is a time-bound working-tree/diff observation, not acceptance or a future cleanliness promise:

```sh
git -C /home/AgentKit/wt/overhaul status --porcelain=v1
git -C /home/AgentKit/wt/t43 status --porcelain=v1
git -C /home/AgentKit/wt/overhaul diff --exit-code -- . ':!.scratch'
git -C /home/AgentKit/wt/t43 diff --exit-code -- . ':!.scratch'
```

The final pre-write preservation-input hash/absence command was:

```sh
sha256sum /home/AgentKit/overhaul-tools/t83-agreed-design.md /home/AgentKit/overhaul-tools/t83-proposed-design-20261110.md /home/AgentKit/overhaul-tools/t83-gpt-grok-ratification-packet-20261110.md /home/AgentKit/overhaul-tools/t83-ratify-initial-gpt-20261110.md /home/AgentKit/overhaul-tools/t83-ratify-initial-grok-20261110.md /home/AgentKit/overhaul-tools/t83-design-sol.md /home/AgentKit/overhaul-tools/t83-design-glm.md /home/AgentKit/overhaul-tools/t83-design-grok.md /home/AgentKit/overhaul-tools/t83-design-sonnet.md
if test -e /home/AgentKit/overhaul-tools/t83-proposed-gpt-grok-v3-20261110.md || test -L /home/AgentKit/overhaul-tools/t83-proposed-gpt-grok-v3-20261110.md; then printf 'V3_EXISTS_STOP\n'; exit 10; else printf 'V3_ABSENT\n'; fi
```

Actual output:

```text
118626cb607030e39752a30b5139409dcf519aae28330cf9c6a618cd95ab6d6b  /home/AgentKit/overhaul-tools/t83-agreed-design.md
ce8104b4640a27c47f8fca5accfca47865094e2ca370e0ede2e226cf340632ce  /home/AgentKit/overhaul-tools/t83-proposed-design-20261110.md
03d534bd45b380f2ee9a89728ecab24e7b77af848986635c5253941182da0097  /home/AgentKit/overhaul-tools/t83-gpt-grok-ratification-packet-20261110.md
521f7ca118f5895b1f12cc81a0a35b0401388ae0474deafc41c93e9c1fb75f82  /home/AgentKit/overhaul-tools/t83-ratify-initial-gpt-20261110.md
0018e95b1976d82fd89f38f712b1faefc17b1a4efe00a1bf524692a31a7bfd18  /home/AgentKit/overhaul-tools/t83-ratify-initial-grok-20261110.md
4c5d42849841eafed4e9aa2061f7243a72ab94c8346650be52bea9b083545f66  /home/AgentKit/overhaul-tools/t83-design-sol.md
960505954cf928fb4f3d6de2cab9de099216cc8a5911f9743916314c087a0080  /home/AgentKit/overhaul-tools/t83-design-glm.md
3e48fc864aa64e2270bde5ba0035fffc31739b41a2b3c7975274ffcd466aee2a  /home/AgentKit/overhaul-tools/t83-design-grok.md
2c64a8b236ba426f1995c0ee97e07328b3bc1b4c3d6dac65abc6acefdba14534  /home/AgentKit/overhaul-tools/t83-design-sonnet.md
V3_ABSENT
```

No tests/builds/installs/soaks, snapshot or mutation/log-line-set checks, Node key probes, CI calls or native-platform checks were executed. File creation/integrity does not supply model agreement. The final V3 digest must be computed **after** file creation and bound to two actual fresh responses; do not insert a self-hash or treat a structured Work object/empty response as a design or approval.

### 7.5 Current status-only checks and execution limits

The following exact command was executed for **this correction**. These are read-only file-integrity, Git revision, ancestry and four-path byte-diff checks, not product tests. Its outputs are distinct from historical §7.4:

```sh
set -e
sha256sum /home/AgentKit/overhaul-tools/t83-proposed-gpt-grok-v3-20261110.md /home/AgentKit/overhaul-tools/rounds/round-39-onboarding-answers-20261110.md
git --no-optional-locks -C /home/AgentKit/wt/overhaul show -s --format='%H %P %s' afe14cfe464a49176b39317ac7e27d63925c5d3d 7ffb80ff33dde1749ad574e20f285eb9f564893f 54771fdfde870394236e547394f3330ce518b6e7
git --no-optional-locks -C /home/AgentKit/wt/overhaul merge-base --is-ancestor afe14cfe464a49176b39317ac7e27d63925c5d3d 54771fdfde870394236e547394f3330ce518b6e7
printf '%s\n' 'ROUND39_ANCESTOR_OF_ACCEPTED43=exit0'
git --no-optional-locks -C /home/AgentKit/wt/overhaul merge-base --is-ancestor 7ffb80ff33dde1749ad574e20f285eb9f564893f 54771fdfde870394236e547394f3330ce518b6e7
printf '%s\n' 'MERGE43_ANCESTOR_OF_ACCEPTED43=exit0'
git --no-optional-locks -C /home/AgentKit/wt/overhaul diff --exit-code afe14cfe464a49176b39317ac7e27d63925c5d3d 54771fdfde870394236e547394f3330ce518b6e7 -- .scratch/kit-overhaul/DECISIONS.md .scratch/kit-overhaul/spec.md .scratch/kit-overhaul/issues/83-setup-command-overview-and-multi-select-harness.md docs/adr/0001-terminal-design-language-ledger.md
printf '%s\n' 'ROUND39_CANONICAL_FOUR_PATHS_UNCHANGED=exit0'
if test -e /home/AgentKit/overhaul-tools/t83-status-corrected-v4-20261110.md || test -L /home/AgentKit/overhaul-tools/t83-status-corrected-v4-20261110.md; then printf '%s\n' 'DESTINATION_EXISTS_STOP'; exit 10; else printf '%s\n' 'DESTINATION_ABSENT'; fi
```

Actual output (all commands exit0; the four-path diff itself is empty):

```text
31128562dc13f81273a4b68ac58e41f4529051381605779ca4d7a6c1b3505e0d  /home/AgentKit/overhaul-tools/t83-proposed-gpt-grok-v3-20261110.md
737aa578a57853b014dbd4838d5c9b0eb5bf9e23aa0548482676f73392d345ba  /home/AgentKit/overhaul-tools/rounds/round-39-onboarding-answers-20261110.md
afe14cfe464a49176b39317ac7e27d63925c5d3d 829202b32cde3a2285c2c3fc39a5fc0394f1b50b docs(overhaul): record round 39 before renewed onboarding ratification
7ffb80ff33dde1749ad574e20f285eb9f564893f afe14cfe464a49176b39317ac7e27d63925c5d3d 71b2a67237b91e3ae4ce6060bc72e81b164fc6c3 Merge ticket 43: compact setup report and integrate dry-run
54771fdfde870394236e547394f3330ce518b6e7 f3446a44a1e0aa0b1fae1a5b50615021cfb74230 docs(overhaul): resolve ticket 43 after central merged-tree gates
ROUND39_ANCESTOR_OF_ACCEPTED43=exit0
MERGE43_ANCESTOR_OF_ACCEPTED43=exit0
ROUND39_CANONICAL_FOUR_PATHS_UNCHANGED=exit0
DESTINATION_ABSENT
```

Original V3, both pre-transcription V3 responses and both post-transcription responses were read completely for the chronology. Their old “43 unaccepted” and “transcription pending” statements remain time-bound judgments, not current status. The actual post-transcription GPT approval and Grok rejection are not combined with an earlier contrary-stage response to fabricate joint ratification.

**NOT RUN in this correction:** `node --test tests/setup-regressions.test.mjs tests/cli-kit.test.mjs`, every other named83 suite in §7.3, `npm run test:all`, runtime feasibility/key/PTY probes, snapshots/mutations/log-line-set checks, build/install/soak, CI query/dispatch, native Windows/macOS/PS5.1 checks, or live model/claim calls. No new GPT/Grok review is dispatched by this writer. Accepted43's recorded central results are not executions of this ask and not83 acceptance. The final output digest is computed after exclusive file creation and returned externally; no self-hash or inferred approval is embedded here.

## 8. Agreement pending — PROPOSED / NOT RATIFIED ledger

### 8.1 Closed policy questions and applied canonical documentation

| Item | Real closure | Current adoption status and still-future evidence |
|---|---|---|
| **U1** | **CLOSED by Round39 Q1**, D:13-82. Undefined mapping, precise owned/unowned/unreadable effects and mandatory pre-arm copy. | **Documentation applied in afe14cfe464a49176b39317ac7e27d63925c5d3d**, preserved at accepted43 final54771fdfde870394236e547394f3330ce518b6e7: ticket83:17,23-24,42; spec:808,813; ADR-0001:49-120. Exact matrix and all six copy blocks remain unchanged in this file. Actual input/action/persistence/rendered-disclosure tests remain future. |
| **U2** | **CLOSED by Round39 Q2**, D:86-111. Five base commands plus at most one qualified concrete run row. | **Documentation applied in the same afe14cf commit**, ticket83:19,28; spec:809; full source in DECISIONS. Order/count5/6, qualification, stdout/log and installer ownership are unchanged. Implementation/snapshot/log proof remains future; full help stays. |
| **U3** | **CLOSED by Round39 Q3**, D:115-127. Optional measured geometry at caps.mjs and selector-only gate. | **Documentation applied in the same afe14cf commit**, ticket83:15,17,25; spec:810; full Q3 in DECISIONS. Global behavior unchanged, no second reader. Measured-fit/resize/fallback and native tests remain future. |
| **Q4** | **CLOSED by Round39 Q4**, D:131-157. Bounded grammar/ownership, honest unmarked-input and CR-tail limitations. | **Documentation applied in the same afe14cf commit**, ADR-0001:122-150; ticket83:17,24; spec:811,813. §0.4's factual correction and the old Grok V2 false verdict remain. Actual supported-runtime feasibility and input/cleanup evidence remain future. |

D:210-216 confirms shared understanding for these four policy questions only. There is **no unanswered policy branch from Round39** and no new normative issue reported by this editorial correction. Canonical transcription and accepted43 are completed prerequisites; same-new-hash participant ratification, implementation feasibility and native/installer/central acceptance are not. No old approval transfers to V4.

### 8.2 Actual review history and preserved dissent

| Chronological stage / exact proposal | Actual judgments and their limits |
|---|---|
| **Original proposal**, hash `ce8104b4640a27c47f8fca5accfca47865094e2ca370e0ede2e226cf340632ce` | Actual initial GPT **false** (E/t83-ratify-initial-gpt-20261110.md:3-18) and Grok **false** (E/t83-ratify-initial-grok-20261110.md:3-9). Conflicting none/chunk proposals remain historical dissent, not consensus. |
| **V2**, hash `210fbd6ffc2790547b3b3e79f4e4a5989b1bd99acb5dee45cb6aa97d17d67d07` | Actual GPT **true** (E/t83-ratify-v2-gpt-20261110.md:3-14), Grok **false** (E/t83-ratify-v2-grok-20261110.md:3-32). Q1 accepts the per-row clarity demand; Q4 corrects the factual rationale. Neither response is relabeled or converted into joint V2 approval. |
| **V3 creation, before canonical transcription**, hash `31128562dc13f81273a4b68ac58e41f4529051381605779ca4d7a6c1b3505e0d` | Original V3:559's “no fresh responses” described creation time only. It is not the current review inventory. The controller created V3 and dispatched its first ratifiers before the required recording (A43 RUNLOG:330; ticket83:44). |
| **V3 first actual reviews, still before transcription**, same V3 hash | GPT **false**, technically consistent but procedurally blocked by missing transcription (E/t83-ratify-v3-gpt-20261110.md:3-25). Grok **true**, design only while explicitly noting pending amendments (E/t83-ratify-v3-grok-20261110.md:3-9,40-47). Both stand as written. Their existence does not retroactively satisfy Round39's ordering requirement. |
| **Canonical transcription then committed**, actual `afe14cfe464a49176b39317ac7e27d63925c5d3d` | DECISIONS/ticket/spec/ADR adoption happened after V3 creation and the first ratifier dispatch. A43 ticket83:40-44, spec:813 and RUNLOG:330 explicitly retain that ordering error and require a later real decision, not an automatic future approval. This is not itself a review verdict. |
| **V3 post-transcription GPT response**, same V3 hash | Actual **approved:true**, expressly a new prospective design-only confirmation, not backdated compliance: E/t83-v3-post-transcription-gpt-20261110.md:3-9,15-29,82-90. It verified the committed amendments and qualified the immutable proposal's old status text. It neither speaks for Grok nor approves V4. |
| **V3 post-transcription Grok response**, same V3 hash | Actual **approved:false**: E/t83-v3-post-transcription-grok-20261110.md:3-9,11-30,46-63. It finds the unchanged normative contract consistent with committed Q1–Q4 (:32-42), but rejects stale current-tense ledger/prerequisite claims. That is the reason for this new status-only candidate, not a new normative redesign request or a changed old verdict. GPT true plus Grok false is **not joint ratification**. |
| **V4, this new status-corrected file** | **PROPOSED / NOT RATIFIED. No actual fresh GPT/Grok responses to these new bytes have been obtained in this correction.** Hash after creation; any authorized renewed status-focused review must use the same actual new hash. No original/V2/V3 or post-transcription approval transfers. This editorial correction does not reset the original at-most-three-design/fix-round cap or open a fourth design round. Report a new normative issue rather than widening the cycle. |
| **Unavailable/deferred participants** | Historical GLM/Sonnet briefs remain inputs only. GLM quota availability is not restored or re-probed; no new GLM/Sonnet/Fable/Anthropic/Gemini approval or dispatch. Fable5.2medium release-range review remains expressly deferred and unstarted. Authorized GPT/Grok routing and existing user concurrency are unchanged (present dispatch; A43 STATE:9,21; correction brief:3,37). |

Within each paired review stage this table reports the actual verdicts without inventing relative completion times. The stage order is the recorded chronology: original/V2, premature V3/first reviews, committed transcription, later post-transcription judgments, and this new unreviewed status correction. Old approvals and new rejections are not mixed across stages to manufacture agreement.

Historical dissent remains explicit:

- Initial GPT favored **recorded declines** for Esc/empty Enter (initial GPT:130-155); historical Sol favored explicit none and custom200ms handling (Sol:78-107). Round39 chooses otherwise on persistence and forbids that extra timer. GPT V2's later actual acceptance is preserved without pretending the initial preference never existed.
- Historical Sonnet favored **no-write Esc but recorded empty Enter**, and cursor-skip while still displaying locked rows (Sonnet:209-217,248-268). U1's no-write **empty** Enter is not attributed to Sonnet approval. Sonnet's “nothing configured” gloss is not valid for existing owned refresh; the exact matrix now controls.
- Sonnet proposed stdout-only overview, while GLM favored a log append (Sonnet:193-195; GLM:243-259). V3 retains one canonical plain log copy under Q2/existing second-sink design, not a retrospective vote or invented special controller ruling. Sonnet's conditional-command direction informed the history, but Q2 explicitly chooses auth status, which Sonnet had proposed dropping (Sonnet:80-117).
- Historical horizontal-arrow, focus, chunk and geometry alternatives stay recorded (Sol:84-85; GLM:253-256; Grok:59-75,169-205). V3 uses one-row all-four-arrow wrap visiting locked context, not the false claim that cursor-skip hides inventory. Chunk counting, first-paint action acceptance and assumed24 rows are not retained. Historical Linux measurements are not claimed as current Windows proof.

### 8.3 Completed prerequisites, real remaining gates and next controller action

| Gate | Current status without transferred approval |
|---|---|
| **Canonical adoption** | **COMPLETED** at `afe14cfe464a49176b39317ac7e27d63925c5d3d`, answer SHA-256 `737aa578a57853b014dbd4838d5c9b0eb5bf9e23aa0548482676f73392d345ba`. Required matrix/copy/attribution and U1/U2/U3/Q4 amendments are recorded and preserved at A43. This prerequisite is no longer assigned as future work. No new ticket/spec/ADR/git writes here; existing44<-83 edge needs no repair. |
| **Accepted merged43 baseline** | **COMPLETED / PINNED** to final `54771fdfde870394236e547394f3330ce518b6e7`, actual merge `7ffb80ff33dde1749ad574e20f285eb9f564893f`. Fresh actual ancestry checks and canonical-file equality are separate from historical43 tests. No reopening40/42 and no83/native/whole-memory acceptance inferred. |
| **Actual same-new-hash V4 agreement** | **OPEN.** Preserve this new complete proposal, compute its digest after creation, obtain actual independent GPT/Grok status-focused responses to those exact bytes within the bounded process, and preserve whichever verdicts return. No forced approval, no old approval transfer and no backdating. Only once both actually approve and no normative amendment remains may a separately authorized recorder update ticket83's agreement ledger. |
| **Implementation feasibility and execution evidence** | **FUTURE / NOT RUN.** Bounded supported-runtime input/cleanup is specified, not demonstrated. An implementation unable to honor it must return the concrete blocker. Entire named regressions, log-line-set/mutants, all C3/raw input/geometry, central suite and normal CI/dist/memory gates remain unchanged. Product implementation is a distinct authorized ticket-worker RED/GREEN step, not this correction. |
| **Native platform and installer acceptance** | **OPEN / UNVERIFIED.** Native conhost/Windows Terminal input/rendering and ticket44's actual PS5.1 stderr/whole-installer uniqueness are not supplied by accepted43's Linux short gate, Linux PTYs or historical notes. No native correctness, live access or delivered83 onboarding is claimed. |

Canonical adoption and accepted43 are already complete; do not ask to redo them to repair stale prose. No83 implementation before actual ratification and its separate authorization/gates. **Next controller action:** bind the computed V4 hash to actual prospective independent GPT/Grok status-correction reviews, preserving all earlier verdicts and dissent; if a new normative issue is raised, stop and report it instead of starting another design/fix round. Do not rewrite preserved V3 or any response, backdate approval, transfer an earlier approval, change workflow/concurrency, or start the deferred Fable review to manufacture agreement.

## Task-observer notes

Controller owns task-observer. This subagent did not repeat its protocol, inspect/write the observation log, or create skill-load checkpoints. Only the requested absent-checked external status-corrected V4 was written. The original V3 and every prior artifact remain untouched. No new skill was loaded for this status-only correction. No product/test/ticket/spec/ADR/integration/git mutation, test/build/install/soak, delegation/model/claim request, secret/token/account-store access, workflow/concurrency change or running-service/global-harness modification occurred.
