---
status: accepted
---

# Terminal design language: Ledger base, grep-stable off a TTY

Every kit command renders through one design language: variant A ("Ledger": aligned rows, verdict last) as the base, plus three parts of variant C: the help shape (examples first), a failure-first lead line in `doctor` when anything failed, and the proxy TUI sidebar at 100 columns or more. We chose it because it fixes every S1/S2 UX finding with the smallest blast radius and degrades best on pipes, CI, `TERM=dumb` and conhost. Variant B's boxed cards were not adopted for line-mode output. The design is specified in [`.scratch/kit-overhaul/ux/design-language.md`](../../.scratch/kit-overhaul/ux/design-language.md). Where the prototype renders differ from that spec, the spec wins.

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 1, Q1 (the recommendation was REJECTED as worded and replaced by this decision with binding amendments).

## Binding rules

1. **Check rows off a TTY keep the legacy grammar.** On a pipe, in CI or under `TERM=dumb`, a check row is exactly `^(PASS|FAIL|SKIP)  <name> — <detail>$`, with today's check names. `WARN` is the only additive verdict word (Round 1, Q10). New display labels are allowed on a TTY only. JSON check names stay byte-stable. The A-ledger prototype's own off-TTY render (`  + ok    Bun runtime`: lower-case word, a different leading glyph, renamed checks, wrapped details) is **not** the target.
2. **Boxes only in the full-screen TUI.** Box chrome appears only in the TUI header card and the log-pane card. Line-mode output has no boxes, so copied values stay clean.
3. **The `doctor` lead line states the problem count only.** It must not repeat the check rows, so the "everything twice" defect (audit A-02) cannot return.
4. **TUI memory rows show the enforced solver cap** from [ADR-0002](0002-captcha-solver-in-capped-child-process.md), not the prototype's placeholder caps (768 MB / 1024 MB).

## Considered options

- **A alone:** smallest change, but leaves the help and long-report findings unfixed.
- **B (Cards):** boxed verdict and error cards break triple-click copying and degrade worst on conhost and pipes.
- **C (Outline):** verdict first and collapsed passing checks; its parts were taken where they fix a finding, not as a whole.

## Consequences

- Scripts that grep `^(PASS|FAIL|SKIP)` keep working. The release notes announce `WARN` as the one new word.
- Snapshot tests and docs pin this language as each command migrates. Before that it is reversible per command; afterwards it is expensive to change.

## Amended 2026-11-06 (Round 2, Q6, Q7 and Q9)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 2, Q6, Q7 and Q9.

- **Rule 2 is narrowed to a header-only box (Q9, condition 3).** In the proxy TUI only the header card is boxed. The log pane gets an unboxed title line with the count/follow badge. This narrows the upper bound of rule 2 and does not contradict it.
- **Rule 4 is extended (Q9, condition 4).** The TUI process strip shows per-process RSS and, for capped processes, the enforced metric against the cap with the metric named (footprint/commit), the enforcement mode and the restarts in 15 min.
- **TERM=dumb and non-TTY refuse the TUI (Q9, condition 2)** and print the line-mode commands, instead of rendering a degraded frame.
- **The manager CLI keeps the legacy grammar (Q7, condition 2).** `node proxy/zcode-proxy-manager.mjs doctor` stays in the off-TTY grammar of rule 1. Only `zcode-kit doctor` stops parsing its text.
- **Where the code lives** is recorded in [ADR-0011](0011-shared-output-code-two-renderers-one-token-set.md): two renderers over one token set and one width core.

## Amended 2026-11-06 (Round 4, Q5 D1)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: [`.scratch/kit-overhaul/DECISIONS.md`](../../.scratch/kit-overhaul/DECISIONS.md), Round 4, Q5 (deviation D1).

- **Rule 1's grammar is stated exactly.** Off a TTY, check rows keep the separator ` — ` (U+2014) byte-for-byte in every glyph tier. The ascii copy mapping of design-language §3.2 (`—`→`-`) does not apply to the check-row separator or the verdict words. The grammar is `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$`: the detail is optional, as it is today, and the row is followed by whitespace-indented `why:`/`next:` lines. The `ux/before/doctor/*` pipe, `TERM=dumb` and ascii-locale snapshots and the existing parser pin this.

## Amended 2026-11-10 (Round 39: onboarding consent and bounded input)

Decided by Owner Proxy under Charter v1 on behalf of the owner. Source: `.scratch/kit-overhaul/DECISIONS.md`, Round39 Q1/Q4; original answers SHA256737aa578a57853b014dbd4838d5c9b0eb5bf9e23aa0548482676f73392d345ba. The following two decision sections are adopted verbatim, including the exact action/persistence matrix, required consequence copy and explicit input-provenance limits. Their cited V2/state facts retain their original historical context; no proposal or reviewer result is thereby ratified. Q2/Q3 inventory and optional geometry scope are recorded in ticket83/spec; ADR-0005 streams and ADR-0011 topology remain unchanged.

## Q1 — Esc, empty Enter and EOF: no new decision records, with exact existing per-run effects

**DECISION:** **ACCEPT the lower-persistence recommendation as an explicit amendment U1 to ticket 83, not as an interpretation of its current wording.** Decoded Esc and Enter with zero editable checks supply `undefined` for every editable row. EOF/close before confirmation discards provisional checks and supplies the same absent answers, while keeping input closed. None creates or replaces a harness-choice record. A nonempty Enter confirmation supplies `true` for checked editable rows and `false` for unchecked editable rows. Locked rows are outside that answer map.

Ticket 83 currently says “Esc/empty confirm selects none” and separately preserves saved choices; it does not settle this persistence dispute. Replace/extend its What-to-build and acceptance wording with this decision, including the reask matrix and disclosure. Do not implement against unchanged acceptance text. This expressly replaces the original proposal's recorded-none recommendation, not an earlier binding Charter decision (`I/.scratch/kit-overhaul/issues/83-setup-command-overview-and-multi-select-harness.md:17,23,38-46`; `X/t83-proposed-design-20261110.md:103-125`; P:169-186,459-465).

### Required mapping

| Input / row class | Action in this run | Harness-choice persistence / MCP |
|---|---|---|
| Nonempty Enter, readable editable row checked | Existing interactive `true`: configure through normal apply/savepoint handling | Existing configured-record rules; MCP only if this editable ID received the eligible disclosure. A failed apply is not successful configuration. |
| Nonempty Enter, readable editable row unchecked | Existing interactive `false`: skip; do not refresh its provider integration, even if owned | Existing skipped-record rules. This is a real decline, unlike Esc/empty Enter. |
| Nonempty Enter, unreadable editable row | Checked: configure for this run; unchecked: skip without refresh | `record:false`; unreadable file never overwritten. Existing MCP-offer/veto rules still apply to an actual yes. |
| Esc / empty Enter / EOF, `--reask`, readable **unowned** row, including old `configured` | **Skip this run.** Do not reapply the saved configured direction | `record:false`; saved file, source, timestamp and MCP bit unchanged. Old skipped and missing decisions likewise skip. |
| Esc / empty Enter / EOF, `--reask`, readable **owned** row, whether old `configured`, old `skipped` or missing | **Existing owned-integration refresh path**, subject to normal adapter success/failure handling | `record:false`, `consent:false`; no new MCP grant. Existing decision bytes stay unchanged. A saved no does not prevent this reasking/no-answer refresh. |
| Esc / empty Enter / EOF, unreadable row, owned or unowned | **Skip, no refresh** | `record:false`; file unchanged. Unreadability is checked before ownership shortcuts. |
| Esc / empty Enter / EOF, ordinary editable row with no saved decision | Readable owned: existing refresh path. Readable unowned: skip. Unreadable: skip, no refresh | No new harness-choice record or MCP grant. Ownership alone never prechecks a checkbox. |
| Any selector outcome, ordinary readable **locked** row | Saved configured: existing stored configure path. Saved skipped: existing stored skip path | No new record or changed provenance/MCP bit. Do not pass a batch answer or reask bit for locked context. |

These are source facts about the existing policy, not a proposed rewrite of `decideHarness`: `/home/AgentKit/wt/t43/cli/harness-consent.mjs:340-369`, independently consistent with `/home/AgentKit/wt/overhaul/cli/harness-consent.mjs:326-355`. In particular, `reasking` depends on an answer **function**, not whether that function returns a boolean. Keep `reask:true` and the function returning `undefined` for editable reask results; replacing it with `ask:null` would silently reinstate saved short-circuits. Ordinary locked rows retain those short-circuits. Existing transaction/file protection remains `/home/AgentKit/wt/t43/cli/harness-consent.mjs:276-304`; apply/failure handling remains `/home/AgentKit/wt/t43/cli/commands/setup.mjs:195-241`.

Ctrl-C/SIGINT before batch confirmation remains `ABORTED`, exit 130, zero provisional batch decision/apply writes, no later interactive rotator question and no overview. EOF is not a recorded decline or abort; no later interactive question may consume closed input. Other exceptions clean up and propagate the existing error/signal contract. This changes neither explicit harness flag/env/`--select` paths nor the rotator's already-explicit flag/env precedence, which still wins even after an earlier abort (`/home/AgentKit/wt/t43/cli/harness-consent.mjs:43-47,146-172,220-235`; `/home/AgentKit/wt/overhaul/cli/account-setup.mjs:82-93,114-142`; P:175-200).

### Required English consequence copy, before input arms

The following replaces P's vague “unanswered and unsaved” presentation. Render conditional lines only for their displayed row classes, wrapping them and counting them for fit. `LABEL` is replaced by the actual adapter label, not displayed as a placeholder.

```text
Configure ZCode as a provider in these assistants?
Enter with editable checks answers yes for checked rows and no for unchecked rows.
Esc or Enter with no editable checks saves no harness decision.
A nonempty confirmation saves readable editable choices; unreadable choices apply only to this run.
```

For ordinary locked context:

```text
Saved choices are locked. Change them with: zcode-kit setup --reask
```

For `--reask`:

```text
--reask: saved choices are editable. Esc, an empty confirmation or input closing keeps their saved decision files unchanged.
```

Per readable **unowned editable** row:

```text
Esc, an empty confirmation or input closing skips LABEL for this run, even if its saved choice is yes. No harness decision is saved.
```

Per readable **owned editable** row:

```text
Esc, an empty confirmation or input closing refreshes the existing kit integration for LABEL, even if its saved choice is no. No harness decision is saved.
In a nonempty confirmation, an unchecked LABEL is skipped without refreshing its integration and its readable choice is saved as no.
```

Per **unreadable editable** row:

```text
Esc, an empty confirmation or input closing skips LABEL without refreshing it. Its unreadable decision file is never overwritten.
```

Retain the eligible MCP notice before arming and the locked-row recovery hint. Do not use “none configures nothing”, “all files unchanged”, “saved answers still apply under --reask”, or “Esc records no”. No-answer is a valid input classification, but it must not replace disclosure of the resulting skip/refresh actions. Empty Enter deliberately does **not** record an all-no batch; that asymmetry is part of U1, not a hidden default.

**Rationale:** A stray Esc or an empty confirmation should not create durable locked declines. C2 protects the existing stored files and per-run decision policy; the smaller persistent effect wins under C9. Keeping the real reasking path avoids inventing a second policy in the selector. The owned-refresh consequence is material and must be stated, including refresh of a previously skipped owned row under `--reask`. Neither the Charter nor the inspected prior decisions requires the original recorded-none preference. The original GPT preference and historical Sonnet's different empty-Enter preference remain preserved dissent, not retroactive support for this choice (`X/t83-ratify-initial-gpt-20261110.md:130-155`; `X/t83-design-sonnet.md:251-268`; `I/.scratch/kit-overhaul/DECISIONS.md:131-158`; P:184-186).

**Charter:** C2, C3, C6, C9; B2/B3. Keep Round 1 Q8/Q9 and ticket 83's locked-row ruling unchanged (`I/.scratch/kit-overhaul/OWNER-PROXY-BRIEF.md:27-42,53-66`; `I/.scratch/kit-overhaul/DECISIONS.md:131-158`).

**REVERSIBILITY:** Two-way before delivery; hard to reverse after people rely on the consent/write meaning, even without a schema migration. **ADR: yes.** Record a narrow onboarding/consent amendment to ADR-0001 before adoption, with the exact matrix, copy obligations and attribution: “Decided by Owner Proxy under Charter v1 on behalf of the owner.” Do not amend ADR-0005's stream contract or the rotator policy.

## Q4 — Bounded input grammar, honest provenance limits, and corrected dissent

**DECISION:** **ACCEPT the bounded grammar/ownership contract in V2 §§1.5–1.8, with Q1's exact consequence copy and the clarification below. REJECT perfect unmarked-paste protection and any chunk-count substitute.** This is a design requirement, not proof that a particular implementation or Node API already meets it. No new terminal mode, dependency, timer-based provenance heuristic or consent-policy rewrite is authorized (P:125-165).

### Required implementable boundary

1. **One owner and a disclosure barrier.** `createPrompter` owns mutually exclusive selector/line phases. Install owned cleanup before disclosure, but accept no action until the complete question, Q1's relevant consequences and editable MCP notices have finished writing/draining. Drop pre-arm input rather than replaying it. Failed disclosure cannot arm. Within an armed epoch, ordered valid keys, including fast Space+Enter or two `a`s in one delivery, act once. The untouched legacy path keeps its typed-ahead semantics (`/home/AgentKit/wt/t43/cli/harness-consent.mjs:39-77,99-137`; P:125-131).
2. **Whole marked paste and text contamination.** Recognize received bracketed-paste start/end markers even when split; do not enable the terminal's paste mode. On a start marker reset provisional state to initial seeds and discard the whole payload, including valid-looking keys and Ctrl-C bytes. Real process SIGINT still aborts. Hold only constant delimiter state; an unterminated paste stays discard-only until end/EOF/abort. A printable token outside the key grammar resets provisional state and quarantines input until a logical newline or decoded bare Esc; that delimiter resets, never confirms/selects none. Drop already-buffered suffix, redisclose and arm a fresh epoch. Never extract useful consent characters selectively from contaminated text (P:133-147).
3. **Finite parser state.** Retain V2's local bound of at most 32 undecided escape/control-prefix bytes, bounded UTF-8/delimiter state, one CR bit and at most ten row states, not arbitrary paste/line buffers or an unbounded action queue. Malformed/overlong sequences contaminate; never replay their suffix as consent. Supported CSI/SS3 arrows use complete key decoding within the supported escape window; only decoded bare Esc is none. Unsupported/meta/modified sequences are consumed whole. No additional custom 200-ms timer or asserted Windows 500-ms guarantee. An implementation unable to honor these bounds must return the concrete feasibility blocker, not silently weaken the contract. This local input bound does not amend an existing resource budget or lifecycle decision (P:137-145; `X/t83-design-grok.md:171-199` is historical Linux evidence only).
4. **CRLF handoff and cleanup.** Normalize CR, LF and adjacent CRLF once. Keep ownership through the accepted terminator and already-buffered old-epoch keys; discard selector suffix/partial parser state, restore the previous raw state and only then disclose/arm the next line question. During adapter work input remains unarmed. Carry only the lexical pending-CR bit: consume the immediately next LF as its tail, even if delayed; any intervening byte clears the bit. A fresh LF-only physical key identical to that tail is indistinguishable and may be consumed under this rule; do not claim physical-key provenance or ignore every first rotator Enter. No indefinite wait. Idempotently clean up only owned listeners/decoder timers on confirmation, Esc, EOF, Ctrl-C/SIGINT, exception, output failure and handled termination. Preserve existing signal/error semantics; SIGKILL/machine death cannot promise restoration (P:149-165).
5. **Acceptance evidence stays specific.** Require equivalent armed-epoch key partitions, whole/split markers, large/unterminated/malformed paste, valid prefix then text reset, disclosure/write failure, complete/split arrows, whole/split CRLF, delayed-tail limitation, queued suffix isolation, later fresh line answers, prior raw true/false and cleanup. Assert actions, decision files/MCP and rotator isolation, not pictures alone. Marked-paste/text handling must not be labeled proof against unmarked valid-only paste. None of these tests ran here (P:359-367).

**Unavoidable limit:** Unmarked valid key bytes are indistinguishable from the same typed bytes. A valid prefix can confirm before a later invalid suffix arrives; no future reset can undo that accepted confirmation. Chunk count and timing are not provenance. Q4 accepts this disclosed limit, not a guarantee against every arbitrary unmarked paste. Requiring stronger provenance later needs a separate input-policy/scope decision; it cannot be slipped into this ticket or established by favorable fixtures. The existing y/n path is not advertised as perfect paste protection either (P:135,147,157; `X/t83-ratify-initial-gpt-20261110.md:43-57`).

### Correct the Grok response's factual B1 wording before any new ratification

Here **B1 means the review heading**, not hard boundary PROMPT B1. Preserve the original `approved:false` record. Publish a separate correction/addendum or a new versioned response; do not overwrite or turn disagreement into approval.

The required factual correction is:

> V2 correctly maps no answer to `undefined` while retaining the reasking function. “No answer” describes input; its resulting action can be skip or owned refresh. V2 already says that saved answers do not apply this run under reask at line 105 and explicitly enumerates the unowned-skip/owned-refresh distinction at line 184. Its ordinary owned-refresh sentence is about owned rows, not an unowned saved-yes row. The remaining objection is whether the displayed consequence copy communicates the per-row outcomes clearly enough before arming, not that an undefined/no-answer input cannot result in skip. Round 39 Q1 requires explicit replacement copy for that clarity.

This is grounded in P:93,105-107,173-186 and `/home/AgentKit/wt/t43/cli/harness-consent.mjs:342-369`. The Grok record's contrary semantic opposition and ordinary-owned/unowned attribution are at `X/t83-ratify-v2-grok-20261110.md:15-32`. Its request for explicit readable-unowned/readable-owned/unreadable disclosure is accepted; its factual description must be corrected. Do not demand a changed approval verdict as the price of correction. GPT's V2 approval is real but covers the old exact bytes only (`X/t83-ratify-v2-gpt-20261110.md:3-14`). Neither response approves a later revised file.

**Rationale:** Single ownership and disclosure-first acceptance preserve consent scope and keep selector input from answering the separate rotator question. Constant-sized parsing and fail-closed contamination are enforceable requirements; perfect origin detection from identical bytes is not. The distinction prevents both unsafe selective consent and false security claims. Correcting a factual rationale while preserving a reviewer’s verdict is necessary evidence hygiene, not consensus manufacture. Existing MCP checks remain editable-ID-specific, saved MCP bits unchanged and `--no-mcp` an absolute registration veto (P:202-208; `/home/AgentKit/wt/t43/cli/commands/setup.mjs:157-185,243-246`; `X/t83-ratify-v2-grok-20261110.md:82-84`).

**Charter:** C1, C2, C3, C4, C6, C7, C8, C9; B1–B6 unchanged. Reports remain stdout and questions stderr. No anti-abuse challenge success, identity imitation, rotation strategy, quota/rate behavior, account-store access or live model/claim work follows from this decision (`I/.scratch/kit-overhaul/PROMPT.md:215-233`).

**REVERSIBILITY:** Two-way before delivery; the consent/disclosure/input handoff guarantee is hard to reverse once relied upon. **ADR: yes**, a narrow ADR-0001 onboarding amendment recording this boundary and its explicit limitations, alongside Q1. **No extra runtime/file scope beyond Q3 and the already listed prompter/setup/output/tests is approved.** No separate ADR-0005 stream change or ADR-0011 topology change is needed. Any later proposal for a terminal-mode change, dependency, stronger provenance policy or modified stored/rotator policy requires a fresh decision instead.

<!-- End of adopted verbatim Q1/Q4 sections. No implementation or ratification acceptance is implied. -->
