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
