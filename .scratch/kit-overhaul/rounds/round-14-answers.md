# Owner Proxy round 14 — answers (triage of tickets 67 and 69)

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–13 decisions in DECISIONS.md bind these answers. Where an answer departs from one of them, it says so by name.

I checked the evidence myself, read-only, on the integration worktree at aa049c3:
- `issues/67-*.md`, `69-*.md`, `55-*.md`, `INDEX.md`, `docs/agents/triage-labels.md`; ticket 68's Comments, which exist only on `ticket/68-crlf-config-writers` / `staging/68` (70046f2). On the integration tree, 68's Comments section is empty. 68 is `ready-for-agent`, implemented and staged (PR #27, run 42421432504), and not merged.
- DECISIONS.md Round 3 Q8 (the ratchet), Round 9 Q1 with its gap paragraph and condition 1, Round 13 Q1 with its Shared understanding, Round 2 Q10 (release-notes list), and the B1 rulings of Round 1 Q3, Q17 and Round 2 Q2/Q3.
- PROMPT.md §5 B1–B6.
- `tests/memory/lib/ratchet.mjs` (all 198 lines), `tests/memory/lib/budgets.mjs:53-55` (`REPEATED` holds `S1/burst1` only), `tests/memory/job.mjs:151, 220` (each run's `redChecks` is in the job summary rows and in `summary.json`), `tests/memory/expected-red.json`.
- `zcode-proxy-src/src/index.ts:205-213, 546-551, 590, 1032-1078`, `tui/app.ts:51-58`, `config/loader.ts:130-143, 405-425`, `proxy/identity.ts:55-59, 120-125, 184`, `config/template.ts:89`, `index.test.ts:108-170`.

**Corrections to the round's facts.**
1. **Q1: the plain single-run entries also include windows `S1/stalled → 61`.** Every linux entry is plain and single-run (linux `S1/burst1` is not listed). On windows, every entry is plain and single-run except `S1/burst1` (repeated, `unstable`) and `S5/short` (`unstable` growth band). Both of those already reject any other RED.
2. **Q2: the misread device ID is not sent upstream today.** All four callers of `ensureDeviceMidInConfig` discard its return value: `serve` (`index.ts:210`), `claim` (`:550`), `auth login` through `ensureConfigWithDeviceMid` (`:590`), and the TUI (`tui/app.ts:55`). The value that reaches the headers comes from `loadConfig`'s YAML parse. That parse reads `deviceMid:` (empty, unquoted) as `null`, which `resolveIdentity` (`loader.ts:423-424`) treats as absent. So, today, a config with an empty unquoted `deviceMid:` behaves like this:
   - the function returns the misread `appVersion: "3.8.1` and writes nothing, because it took the value as non-empty;
   - the proxy runs with **no** device mid: no `X-Device-Mid` on control-plane requests (`identity.ts:184`), and no `device_id` in the metadata user id.
   Every other spelling ends up with a mid:
   - `deviceMid: ""` is filled in place;
   - a missing key is inserted under `identity:`;
   - a missing `identity:` block is appended.
   Ticket 69's text ("which then becomes X-Device-Mid") and 68's "Left for another ticket" note are wrong on this point. The recommendation's "no different upstream request for any well-formed config" is also inaccurate: `deviceMid:` is well-formed YAML, and after the fix that config does send a mid. The claim holds for every other form.
3. **What the empty-quoted path does today** (`index.ts:1060-1077`): an empty value leads to a fresh `randomUUID()`. The matched line is replaced in place with `<indent>deviceMid: "<uuid>"`, the file is written back (on 68's branch, with its own line endings), `Device identity generated: <first 8>… (stored in <path>)` is logged, and the UUID is returned. It is generated once and reused afterwards.

---

## Q1 — Ticket 67: a plain expected-RED listing of a single-run key accepts any RED

**DECISION:** ACCEPTED with conditions; one part REJECTED. Role: **`ready-for-agent`**, Model sol, Risk medium, ADR no. Blocked by: none. New edge: **55 ← 67**.

Accepted: every plain listing of a single-run key names the checks it owns. A RED on any other check fails the ratchet. An owned check may be GREEN, and the entry is deleted only when the run is GREEN, as today.

Rejected: building `owns` as "the union of the RED checks seen in the last N runs" and nothing more. A union adopts every RED it has seen, including an orphan, a second proxy or a ceiling breach that belongs to a different defect. That turns today's silent pass into a silent recorded ownership. It also leaves N undefined.

Binding conditions:
1. **Schema.** A listed single-run key that is not `unstable` takes `{ "ticket": "<NN>", "owns": ["<check>", …] }`. The exact shape is the implementer's choice, in one place. These are schema errors:
   - a plain string or number for a single-run key;
   - an empty `owns`, a duplicate name, or a non-string name.
   Repeated keys keep Round 9 Q1 condition 1 (median only). The two `unstable` keys keep Round 9 Q1 and Round 13 Q1 unchanged. `owns` on either of those is a schema error.
2. **Ratchet rule** for a listed single-run entry with `owns`:
   - RED with every RED check in `owns` passes. The job summary row prints `<key>: RED on <checks>, owned by ticket <t>`, so what is tolerated stays visible.
   - RED on any check not in `owns` fails, with this message: `<key>: RED on <check>, not owned by ticket <t> (<os>, Round 14 Q1); the RED comes back as an ownership question, do not edit owns`.
   - RED with no RED check named fails.
   - GREEN fails as "GREEN but listed", as today.
   - A harness failure fails, as today.
   - An owned check name that the run does not produce at all fails as a stale or mistyped name. This follows Round 3 Q8 condition 2: a stale entry cannot hide a RED.
3. **How `owns` is derived. Each key on each leg needs both conditions below:**
   - **(a) Evidence.** At least 10 valid runs of the leg's full short profile on code whose scenario, `verdict.mjs` and `budgets.mjs` for that key match the tree 67 merges onto. Use pre-merge staging runs and history first. Where fewer than 10 exist (for example S3/hung after ticket 65), run the job on 67's branch until there are 10. Record the run ids and each run's RED set per key in 67's Comments and in METRICS.md.
   - **(b) Ownership.** Every check in `owns` is traced to a line of the owner ticket's text: its acceptance criteria or its What-to-build. The line is cited in 67's Comments. A check the owner's criteria name explicitly may be included even if no recorded run showed it RED. This lowers the false-RED risk of a rare owned check without masking anything outside the owner's claim.
   - **Rule.** A check that is seen RED but cannot be traced to the owner does not go into `owns`. Typical cases: an orphan on a key whose owner is not a lifecycle ticket, or a check that a different open ticket claims. These come back to the Owner Proxy as an ownership question with the run ids before 67 merges. They are never folded in silently. If such a question is open for one key, the other keys may still land.
4. **The list only shrinks.** After 67 merges, an `owns` list can only lose names, and only in the owner ticket's own commit, with its evidence. An unowned RED in a later run follows the existing rules: no rerun-until-green, and the numbers come back as a question (Round 6 Q2 condition 3, Round 8 condition 4, PROMPT §7 Phase 4). No run or job edits `owns`, and no other ticket does either.
5. **Tests**, RED first, in the ratchet/verdict suite:
   - a plain string entry for a single-run key is rejected;
   - an owned RED passes and an unowned RED fails;
   - owned GREEN plus unowned RED fails;
   - GREEN while listed fails;
   - a stale owned name fails;
   - `owns` on `S1/burst1` or windows `S5/short` is rejected;
   - every existing Round 9 and Round 13 case passes unchanged;
   - one case per leg uses the real `expected-red.json`.
   67's pre-merge CI run confirms the change; it does not decide it. If any `owns` disagrees, the numbers come back. Nobody widens `owns` to make the run green.
6. **Edge 55 ← 67.** The empty-list guard and the removal of the allow-list land on the stricter schema. Then 55's guard also rejects a re-added `owns` entry. 67 has no blockers, so the edge cannot close a cycle. Owner tickets that delete their whole entry are unaffected and gain no edge.
7. **Nothing else changes:** every budget, ceiling, n, the `growth()` rule, Round 7 Q1's metric split, the two `unstable` bounds, and which keys are listed.

**Rationale:** Round 9 found and closed this gap for repeated keys, and Round 13 closed it for windows S5/short. Every other entry still accepts any RED, so on 22 entries an orphan, a second proxy or a ceiling breach passes as "expected". Those are the C1 checks this run exists to prove. Per-entry ownership is the smallest change that closes the gap, and it keeps the ratchet monotonic.

The union-only derivation is wrong for the same reason the plain listing is: it accepts whatever happened to be RED. Combining observed evidence with the owner's text makes the list both measured and attributable. The 10-run floor bounds the false-RED risk: a check RED in at least 26 % of runs is seen with 95 % probability. The owner-claimed inclusion covers rarer owned checks. Any remaining flake comes back as a question rather than as churn.

**Charter:** C1 (orphan, single-proxy and ceiling checks enforced where today's listing masks them), C7 (both legs, per-leg lists), C9 (measured runs plus attribution; one schema change in one file, two-way), §9 (no budget touched), Round 3 Q8 conditions 1–3, Round 6 Q2 condition 3, Round 8 condition 4, Round 9 Q1 conditions 1 and 5, Round 13 Q1 conditions 1, 3 and 7, and Round 13's Shared understanding (this is that branch returning).

**REVERSIBILITY:** Two-way door (test code, list shape, ticket text, one edge). ADR: no.

---

## Q2 — Ticket 69: `ensureDeviceMidInConfig` reads past an empty unquoted `deviceMid:`

**DECISION:** ACCEPTED with conditions and a corrected rationale. Role: **`ready-for-agent`**, Model sol, Risk high, ADR no. Blocked by: **68** (kept). New edge: **54 ← 69** (release-notes line).

**B1 scope ruling: IN SCOPE, as error handling.** The defect is a parse error: the separator `\s*` after `deviceMid:` crosses a line break. Because of it, the function and the proxy's own loader read the same file differently:
- the loader says "empty";
- the function says "already set" and skips its fill.

The fix makes the function agree with the loader. Then the empty unquoted form takes the existing empty-value path exactly as `deviceMid: ""` does, which is also what the missing-key and missing-block forms already get. Nothing new is added:
- no new ID source;
- no new generator or format;
- no new header or request field;
- no change for any other form.

So it does not raise pass rates or add a rotation strategy. It does not make the client look more like the official one beyond what the existing mechanism already does for every equivalent config.

The corrected impact: configs that use the empty unquoted spelling will now get a mid persisted and send it, where today they send none. That is the designed self-heal (`index.ts:548-549`) reaching the one spelling that misses it. It is not a new behaviour.

Binding conditions:
1. **The only code change.** The reader takes the value from the rest of the `deviceMid:` line only. The separator stops crossing a line break, including CRLF (`\r`). The exact regex is the implementer's choice. Unchanged:
   - the indent capture, the quote stripping and the fill/insert/append branches;
   - `randomUUID()`, the written line format and the log line;
   - 68's line-ending handling.
   Out of this ticket (residual forms, see Shared understanding):
   - trailing-comment values (`deviceMid:  # x`, `deviceMid: "x" # y`);
   - `~` / `null`.
2. **Tests (Bun, temp-file fixtures only, B2/B3).** Forms, each in LF and CRLF:
   - quoted value;
   - unquoted value;
   - empty quoted;
   - empty unquoted followed by another key;
   - empty unquoted with trailing spaces;
   - empty unquoted as the last line, with and without a final newline;
   - missing key under `identity:`;
   - no `identity:` block.

   For every form:
   - **(a)** after `ensureDeviceMidInConfig`, `loadConfig(path).identity.deviceMid` equals the returned value (the reader/loader agreement);
   - **(b)** a second call returns the same value and leaves the file byte-identical;
   - **(c)** the file keeps its line endings (68's contract).

   Pin the generated UUID (inject or stub `randomUUID`) so outputs can be compared byte for byte.
3. **Proof that nothing else changed.** Run the new tests against the pre-fix function, restored from the parent commit. Only the empty-unquoted cases may fail: on the return value, the fill, and the loader agreement. Every other form must pass there with byte-identical file output, return value and `buildIdentityHeaders` output. Record both runs (RED log name, then GREEN) in 69's Comments. The existing `index.test.ts` deviceMid tests stay unchanged.
4. **Correct ticket 69's text** in the same change, following correction 2 above: today the misread value is returned and discarded, and the config sends no mid. No existing caller changes, and no caller starts using the return value.
5. **C2/C8 announcement.** On a config with an empty unquoted `deviceMid:`, the proxy will now write a generated mid into the user's `config.yaml` on its first `serve`/`claim`/`auth login` after the update, as it already does for `deviceMid: ""`. Ticket 54's release notes say so in one line. The orchestrator records it in 54's Comments when 69 closes. The edge 54 ← 69 follows the ticket 59 precedent: 59 is a direct edge on 54 for its own release-notes line.
6. **Edge 69 ← 68 stays.** 68 changed the same function's writer (line endings) and is staged but not merged. 69 lands on top of it.

**Acyclicity.** 69's ancestors are 68 ← 42 ← 08 ← 07, 10 ← … ← 01, 02, 03, 04, 05, 06, 09. None of them is 54, and none depends on 54 or 69. 54 has no dependents. Adding 54 ← 69 closes no cycle.

**Rationale:** B1 forbids changing how anti-abuse code behaves. Its IN SCOPE list allows error handling and tests. The behaviour of this code is defined by its contract ("fills an empty `deviceMid:` value") and by the loader it feeds. Today, one YAML-equivalent spelling of "empty" falls through that contract because of a regex that crosses lines. Restoring the contract for that spelling is error handling.

The test that keeps it inside B1 is condition 3. Every other input must produce byte-identical results before and after, so the change cannot reach any config the run did not intend. "Do nothing" (C9) was considered and rejected. The function's return value is wrong today, and the affected configs silently miss the mid that the code comment says the billing gateway requires. The fix is one line with a full equivalence proof.

The recommendation was right on the scope and the test list. It needed two corrections:
- the upstream request does change, for exactly the one affected spelling;
- that write to a user-owned file must be announced.

**Charter:** B1 (IN SCOPE: error handling, tests; no OUT-OF-SCOPE effect, proven by condition 3), B2/B3 (fixtures, temp files only), C2 (every other config byte-identical; the one changed case announced), C6 (no new endpoint or data), C7 (CRLF on Windows), C8 (release-notes line), C9 (smallest blast radius: one reader expression), Round 1 Q3 / Q17 (the B1 reading: lifecycle and error handling allowed when the anti-abuse inputs and outputs stay identical).

**REVERSIBILITY:** Two-way door for the code. On an affected install, the persisted mid stays in the user's file after a revert. This is the same state that `deviceMid: ""` installs already have, so it is harmless. ADR: no.

---

## Shared understanding

Open branches I still see (none blocks this round):
- **Other `deviceMid` spellings the reader misreads on the same line:**
  - `deviceMid:  # note` returns `# note`;
  - `deviceMid: "x" # y` returns `x" # y`;
  - `deviceMid: ~` and `deviceMid: null` return `~` and `null`.
  In each case the loader reads the empty or correct value, so the reader and the loader disagree in the same way. They are not line-crossing, so they are outside ticket 69. If the orchestrator wants them fixed, they need their own `needs-triage` ticket and the same B1 question. The answer here would likely be the same, judged on its own equivalence proof.
- **Ticket 67 may find observed REDs on a key that its owner does not claim.** S2's `growth:scenario` (ticket 58 note) and S3/hung's per-leg sets are the likely cases. Those come back as ownership questions with run ids (Q1 condition 3).
- **The plain "GREEN but listed" rule still flakes where an owner's only RED check flips.** S2/short's `growth:scenario` may be such a case. That is today's behaviour, unchanged by 67. If 67's 10-run evidence shows a key whose run is GREEN in some runs on unchanged code, it comes back as its own question with its distribution (Round 9 condition 3, Round 13 condition 3). It is not covered silently by `owns`.
