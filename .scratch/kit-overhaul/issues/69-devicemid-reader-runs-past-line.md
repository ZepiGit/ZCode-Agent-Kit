# 69: `ensureDeviceMidInConfig` reads past the end of an empty unquoted `deviceMid:` line

**Blocked by:** 68 (Every writer of proxy/config.yaml and harness configs keeps the file's line endings (CRLF audit))

**Status:** ready-for-agent

Model: sol
Risk: high
ADR: no

**What to build:** Found by ticket 68's audit (not fixed there). In the proxy, the reader in `ensureDeviceMidInConfig` can run past the end of its line: for an empty unquoted `deviceMid:` it takes the next line's text (e.g. `appVersion: "3.8.1`) as an existing device mid. It returns that text and skips its fill. The misread value is not sent: all four callers (`serve`, `claim`, `auth login`, the TUI) discard the return value, and `loadConfig` reads the empty unquoted value as absent. So that config never gets a device mid and sends no `X-Device-Mid`, while every other spelling of "empty" or "missing" gets one generated and persisted (corrected premise, Owner Proxy round 14 Q2 correction 2). After the fix, this spelling gets the same treatment as `deviceMid: ""`: a mid is generated, written to the file and sent, so its upstream requests change. Ticket 54's release notes announce this (condition 5). No caller changes, and no caller starts using the return value. The kit template writes `deviceMid: ""` and is not affected; a hand-edited or third-party-tool config can be. This touches identity code (B1: anti-abuse behaviour must not change). Triage question for the Owner Proxy: is fixing the parse (an empty value is treated as empty, as the quoted form already is) a correctness/error-handling fix inside B1's IN-SCOPE list, or a behaviour change that stays out? If in scope: the fix must make the empty-unquoted case behave exactly like the existing empty-quoted case, with a test per form, and change nothing else in identity handling.

**Acceptance criteria:**

- [ ] Triage decision recorded (B1 scope).
- [ ] If accepted: RED test reproducing the misread, fix, tests for quoted/unquoted/empty/missing forms; no other identity behaviour changes.

## Comments

- 2026-11-07 (orchestrator) Triage, Owner Proxy round 14 (binding; full text in DECISIONS.md Round 14):

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

- Correction (round 14): the misread value is NOT sent upstream today (all four callers discard the return value; loadConfig reads an empty unquoted deviceMid as absent, so that config never gets a device ID and sends no X-Device-Mid). After the fix the unquoted form gets the quoted form's treatment (UUID generated and written), so its upstream requests DO change; release-notes line in 54.

### 2026-11-07 — implementer (branch `ticket/69-devicemid-reader`)

**Base and commits.** Built on the integration tip `06aa96b`, which includes 68 (`aff5c05`). `f69e9fb` holds the fix, the tests and the condition-4 text correction. The head SHA is the commit that adds this comment. Before reporting, `git merge overhaul/stability-terminal-ux`: already up to date (tip still `06aa96b`).

**The change (condition 1).** One expression in `zcode-proxy-src/src/index.ts`, plus a three-line comment:
- before: `/^(\s*)deviceMid:\s*(.*)$/m`
- after: `/^(\s*)deviceMid:[^\S\r\n]*(.*)$/m`
The separator is `\s` minus CR and LF. Everything else is untouched: the indent capture, the quote stripping, the fill/insert/append branches, `randomUUID()`, the written line format, the log line and 68's `withLineEndingsOf`. No caller changes.

**Why only the empty unquoted spelling can change.** `^(\s*)deviceMid:` is unchanged, so every match starts at the same place with the same indent, and the rest (`[^\S\r\n]*(.*)$`) always matches. The old separator and the new one consume the same characters unless the whitespace run after `deviceMid:` holds a CR or LF. That happens only when the rest of the line is whitespace: the empty unquoted forms. Then the new reader stops at its own line end, so `(.*)` is empty and the existing empty-value path runs, the same path as `deviceMid: ""`.

**Tests (condition 2).** New file `zcode-proxy-src/src/device-mid-config.test.ts`: 10 forms × {LF, CRLF} = 20 tests, temp-dir fixtures only (B2/B3).
- The forms are the round's eight, plus "empty unquoted followed by a blank line":
  - quoted value; unquoted value; empty quoted;
  - empty unquoted followed by another key / followed by a blank line / with trailing spaces and a tab;
  - empty unquoted on the last line, with and without a final newline;
  - no key under `identity:`; no `identity:` block.
- `randomUUID` is stubbed with `spyOn(crypto, "randomUUID")` and restored after each test. The first call gets a pinned UUID. Later calls get a different one, so a second fill would show in (b).
- The expected file bytes and return values are literals.
- Per form the tests check:
  - the returned value;
  - the exact file bytes;
  - (a) `loadConfig(path).identity.deviceMid` equals the return value, and `buildIdentityHeaders(...)["X-Device-Mid"]` carries it;
  - (b) a repeat call returns the same value and leaves the file byte-identical;
  - (c) a CRLF file has no bare LF, and an LF file has no CR.
- The existing `index.test.ts` deviceMid tests are unchanged.

**Pre-fix proof (condition 3).**
- RED, log `t69-red-prefix`: `src/index.ts` restored from the parent commit (`git checkout f69e9fb~1 -- zcode-proxy-src/src/index.ts`), then the new tests plus `index.test.ts` were run. 29 pass, 8 fail. The 8 failures are exactly the empty-unquoted forms, LF and CRLF each:
  1. followed by another key;
  2. followed by a blank line;
  3. with trailing spaces;
  4. on the last line with a final newline.
  Cases 1–3 fail on the return value: it returned `appVersion: "3.8.1`. With that, the fill and the loader agreement fail too: there was no write, and the loader read the value as absent. Case 4 fails on the file bytes only. The old `\s*` also ate the file's final line break: `  deviceMid:\n` (or `\r\n`) at EOF became `  deviceMid: "<uuid>"` with no final break. The return value, the loader and the header there were already correct.
- Passing on the pre-fix code: every other form, including "empty unquoted on the last line without a final newline" (LF and CRLF), and all 17 `index.test.ts` tests.
- The same RED run on the unchanged tip before the fix: `t69-red-tip`, 12 pass / 8 fail, the same 8.
- GREEN: `t69-green-fix`, 37/37, after restoring with `git checkout f69e9fb -- zcode-proxy-src/src/index.ts`. `git status` was clean.
- Full-output equivalence, `reports/t69-equivalence.log`. A scratch harness derived from the committed test (sed adds a JSON dump line; harness kept outside the repo, logs `t69-dump-prefix` and `t69-dump-fix`) recorded each case's return value, file bytes and complete `buildIdentityHeaders(loadConfig(path).identity)` object, both on the pre-fix code and the fix. 12 of 20 cases are identical in all three. The 8 above differ:
  - cases 1–3: pre-fix `mid="appVersion: \"3.8.1"` and no `X-Device-Mid` header; post-fix the pinned UUID, persisted and sent;
  - case 4: file bytes only (the final line break is now kept). The mid and headers are identical.

**Mutation proofs** (`t69-mut-*`; committed tree, each mutant restored with `git checkout f69e9fb -- zcode-proxy-src/src/index.ts`; `git status` clean afterwards):
- M1, an existing value is never returned (always regenerate): 24 fail, among them all 20 new tests (through (b) or the literal bytes) and 4 `index.test.ts` tests.
- M2, the write skips `withLineEndingsOf`: 4 fail (the CRLF insert and append forms, plus 68's two matching tests).
- M3, no quote stripping: 22 fail.
- M4, the separator stops at LF but crosses CR (`[^\S\n]*`): 0 fail. This is expected and is not a gap in coverage. On a CRLF file, the only extra thing this mutant eats is the line's own `\r`. 68's whole-document conversion puts it back, so the output is byte-identical to the fix. No test can tell them apart. The committed reader still excludes `\r`, as condition 1 asks.

**Suites** (head after the merge check; Node 26.7.0, Bun 1.4.2):
- `npm run test`: 816 tests, 797 pass, 0 fail, 19 skipped (`t69-full-kit`).
- `npm run test:proxy`: 1384 pass, 0 fail, 92 files (`t69-full-proxy`). That is the merge-68 count of 1364 plus the 20 new tests.
- `npm run test:proxy-typecheck`: exit 0.
- `npm run test:mcp`: 96 tests, 95 pass, 0 fail, 1 skipped; `dist/` unchanged.
- Memory loop: not run. No scenario exercises this function's input forms, and the change is one regex in a once-per-start config edit.

**Decisions.**
1. The separator is `[^\S\r\n]*`, not `[ \t]*`. It is exactly the old `\s*` minus the line breaks, which makes the equivalence argument above hold character for character (other Unicode whitespace is treated as before).
2. The tests are in a new file, so `index.test.ts` stays byte-unchanged (condition 3's last sentence).
3. One form beyond the round's list: "empty unquoted followed by a blank line". It is the other way the old separator crossed lines.
4. `randomUUID` is stubbed with `spyOn` on the `node:crypto` namespace, restored per test, rather than injected. Injection would change the function's signature, which condition 1 rules out. Randomness is a system boundary (tdd `mocking.md`).
5. The acceptance checkboxes are left for the orchestrator, as in 68 and 42.

**Release-notes line for ticket 54 (condition 5; the orchestrator's to record).** Proposed sentence:
> Proxy: an empty, unquoted `deviceMid:` under `identity:` in `config.yaml` is now read as empty, as `deviceMid: ""` already was, so on its first `serve`, `claim` or `auth login` after this update the proxy writes a generated device ID into that line and sends it from then on (such a config previously ran without one).

An empty unquoted `deviceMid:` as the file's very last line already got a mid before the fix (only its final line break was lost), so the sentence stays true for it. The TUI calls the function only on a config it has just created from the template (`deviceMid: ""`), so the sentence leaves the TUI out.

**Left for another ticket (not changed here).**
- The residual forms from round 14's Shared understanding still disagree with the loader: `deviceMid:  # note`, `deviceMid: "x" # y`, `~`, `null`.
- The insert branch's `identityBlockLine` `/^identity:\s*$/m` also crosses a line break. On `identity:` followed by a blank line, it swallows that blank line when it inserts the key. That is a writer cosmetic, not a read, and condition 1 keeps that branch unchanged. It is a candidate for a `needs-triage` note under the same B1 question.
- 68's "Left for another ticket" note ("which then becomes X-Device-Mid") is wrong on the same point round 14 corrected. It is in 68's file, so it is left to the orchestrator.
