# Round 4: Owner Proxy answers

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The Round 1–3 decisions in DECISIONS.md bind these answers. Where the spec or a recommendation contradicts one of them, the answer says so and the earlier decision wins.

I checked the spec myself against DECISIONS.md (Rounds 1–3), PROMPT.md §5/§7/§9, `docs/adr/0001–0015`, `GLOSSARY.md`, `ux/design-language.md`, `diagnosis/memory-report.md` §6, `diagnosis/data/S4-short.summary.json`, the `ux/before/doctor/*` snapshots and the code at b1aab55:
- `lib/proxy-env.mjs:1-30`
- `proxy/zcode-proxy-manager.mjs`: :165, :589, :1148-1155
- `zcode-proxy-src/src/runtime/watchdog.ts`: :72-112, :177, :189-193
- `zcode-proxy-src/src/proxy/captcha-solver.ts`: :136, :296-336
- `zcode-proxy-src/src/proxy/captcha-pool.ts`: :87-91
- `cli/zcode-kit.mjs`: :69, :91, :125, :671
- `cli/context.mjs:152`, `cli/heal.mjs:166`
- the diagnosis-branch loop: `tests/memory/scenarios/s4-lifecycle.mjs:148`

Where an answer is ACCEPTED with conditions, the conditions bind the spec and the tickets.

---

## Q1 — Test seams

**DECISION:** ACCEPTED with additions. The nine seams are the right ones, and no new seam is needed. But some decided behaviours have no home in any seam's coverage list, and two properties sit below the highest seam that can observe them. These additions bind `seams.md` and spec → Testing Decisions:
1. **Seam 5 (CLI spawn tests) gains the `process.execve` handover (Round 3 Q2 condition 6).** Spawn `zcode-kit run` against a fake harness executable on POSIX and assert each of these:
   - With Node ≥ 26.1, the harness runs under the launcher's pid, so no launcher process is resident.
   - On Node < 26.1, with `ZCODE_KIT_RESIDENT_LAUNCHER=1`, or with a non-executable target, the launcher stays resident.
   - A missing harness still gives `run: …` and exit 2.
   - stderr carries no `ExperimentalWarning`.
   - The `ready.detail` line and the `heal.log` write happen before the handover.
   - A harness killed by SIGTERM reports 143.
   - Exit codes 0, 7 and 130 are unchanged.
   The windows-latest leg asserts the resident path with signal and exit-code forwarding as today.
2. **Seam 1 owns "0 solver processes after the proxy is SIGKILLed", "an idle exit leaves 0 solver processes" and "≤ 1 solver process per proxy at every sample".** ADR-0002 condition 2, Round 3 Q10 condition 2 ("the S4/S2 orphan checks assert this") and §18 PROCESSES are process-level claims, and the windows proof is Job Object reaping. A dispatcher-level test (seam 3) cannot SIGKILL its own test runner, so seam 3 keeps only the ordering logic of one generation at a time.
3. **Seam 8 gains:**
   - the preflight check of the OMP autostart's pinned Node path against the floor (Round 1 Q14 condition 2);
   - the waiter cause-line record of Q2 below (generated logic);
   - the per-spawn environment rules of Q4 below: `ZCODE_KIT_LOG_DIR` and `ZCODE_KIT_STOP_TOKEN` are set by the manager and overwrite ambient values, and the stop token is absent from the respawn hook's environment.
4. **Seam 1's S3 OMP leg asserts that each waiter host printed the starter's `cause=` lines** whenever the starter's preflight emitted any. It does so with 5 hosts and in the killed-starter case (Round 3 Q2 condition 3).
5. **Seam 2 (manager CLI spawned) gains `proxy logs N` reading across `proxy.log.1` and `proxy.log`** (Round 2 Q4) and the golden-path classifier reading the tail-copy marker.

**Rationale:** Every seam on the list exists in the repo or is a small, justified addition (the snapshot suite, the guards). The list misses a home for one whole decided mechanism, the execve handover. That mechanism carries announced exit-status changes and an experimental API, so it needs a real spawn test (C2). The list also places the solver reaping claims below the level that can observe them. Round 3 Q10 already bound those claims to the S2/S4 orphan checks. The remaining items are decided behaviours with no named test.

**Charter:** C2 (exit codes, announced changes tested), C1 (reaping proven at process level), C7 (Windows resident path), C9 (fewest seams, highest observation point).

**REVERSIBILITY:** Two-way door.

---

## Q2 — Preflight cause-line channel

**DECISION:** ACCEPTED with conditions. The starter writes a result record next to the single-flight token, and waiters read it. Binding conditions:
1. **Write before release.** The starter writes the record by temp file + rename, with mode `0o600`. It does this on every outcome (success, failure, timeout) and **before** it releases the token in `finally`. A waiter therefore never sees a released token without that attempt's record.
2. **A record belongs to one attempt.** The record carries the same identity as the token: host pid, host start time and a per-attempt nonce. A waiter accepts a record only if its identity equals the token it observed while waiting and its timestamp is not earlier than the waiter's own wait start. Any other record is stale and is never printed. A record left by an earlier start, or by a different installation's clock, is never replayed.
3. **No matching record counts as a starter failure.** This covers a token released without a matching record, and a token proven stale because the holder is dead. The waiter applies the existing ADR-0013 takeover-by-proof and becomes the new starter with its own preflight. The other waiters keep waiting on the new token. That way "≤ 1 concurrent OMP preflight process" holds in the killed-starter case as well, and no diagnostic is dropped silently.
4. **Bounded, fixed-vocabulary content.** The record holds only the exit code and the fixed-vocabulary `cause=` lines, with no paths, keys or free text. Its size is capped (for example ≤ 4 KB / ≤ 16 lines). The waiter validates every line against the fixed vocabulary before printing it in its host. A corrupt or oversized record is treated as "no matching record" (condition 3).
5. **One file.** The record has a fixed name and is overwritten per attempt. It counts toward S4's log-dir file budget (≤ 8, loop-encoded). Waiters never delete it.
6. An old extension (before re-setup) neither writes nor reads the record, which is harmless (Round 3 Q2 condition 3). The channel is recorded as an amendment line in ADR-0013 (condition 3).

**Rationale:** The channel fits Round 3 Q2: it starts no new process, it lives in the logs dir that already holds the token, and it keeps the host free of kit modules. As worded, it has three gaps. A waiter could read a stale record from an earlier start and print causes that do not apply. A waiter could find no record at all after a starter was killed. A waiter could print unvalidated file content into a harness session. The conditions close each gap by reusing the token's own proof and takeover rules, so they add no new mechanism.

**Charter:** C3 (diagnostics reach every host; no kit noise), C1 (≤ 1 preflight process, bounded file), C6 (`0o600`, no secrets, validated output), C9 (reuse the token protocol).

**REVERSIBILITY:** Two-way door (internal to one installation's generated extensions; old extensions ignore it). ADR: amendment line in ADR-0013, no new ADR.

---

## Q3 — Handover opt-out name

**DECISION:** ACCEPTED with conditions. The variable is `ZCODE_KIT_RESIDENT_LAUNCHER=1`. Conditions:
1. **The value convention is exactly `"1"`,** as the kit's other opt-in switches use it (`ZCODE_KIT_SKIP_DEPS === "1"`, `cli/context.mjs:152`; `ZCODE_KIT_ALLOW_CHECKOUT === "1"`, `cli/heal.mjs:166`). Any other value leaves the default.
2. The launcher reads the variable before the handover decision. With the variable set, the resident path behaves byte for byte as today, which the Q1 spawn test asserts. On Windows the variable has no effect, because the launcher is always resident.
3. **Documented as a user-visible variable:** `--help` (environment section), README × 5 next to the Node ≥ 26.1 note, and the release notes entry for the handover (Round 3 Q2 condition 6; spec §6 d, §10 Help, §16).
4. No other code path reads the variable.

**Rationale:** The name follows the `ZCODE_KIT_*` family and says what it forces, the resident launcher, which is the glossary term (GLOSSARY "Launcher", "Handover"). It does not collide with any existing variable (the repo has no `ZCODE_KIT_RESIDENT*`). Once released, users will script it, so it becomes part of C2's env-var surface.

**Charter:** C2 (a way back without a downgrade; env vars keep working once released), C8, C9.

**REVERSIBILITY:** One-way door once released (a public env var). **ADR: yes** (amendment line in ADR-0013 condition 6 naming it).

---

## Q4 — Log directory env

**DECISION:** REJECTED as worded; the name is accepted. The name `ZCODE_KIT_LOG_DIR` is accepted. The mechanism "added to the `proxyEnv` allowlist" is factually wrong, and the same error appears in spec §4 for `ZCODE_KIT_STOP_TOKEN`. `proxyEnv` (`lib/proxy-env.mjs:1-30`) copies the whole source environment and deletes only `ZCODE_PROXY_*`/`CLAIM_`/`ASYNC_`/`DUMP_`/`CAPTCHA_*` (with listed exceptions), `CAPTCHA_*`, `PE_PATCH` and ambient proxy variables (:21). `ZCODE_KIT_*` already passes through, so an allowlist entry does nothing. The real risk is the opposite: an **ambient** value passes through. The respawn hook is spawned with the proxy's own `process.env` (`watchdog.ts:177`, `:107`). A respawned manager therefore inherits the old proxy's `ZCODE_KIT_LOG_DIR` and `ZCODE_KIT_STOP_TOKEN`, and without an explicit overwrite it hands them to the next proxy. My decision:
1. **The manager sets both variables explicitly at every proxy spawn,** at the same place as `ZCODE_KIT_RESPAWN_NODE`/`_MANAGER` (`zcode-proxy-manager.mjs:589`) or inside `proxyEnv` the way `ZCODE_PROXY_CONFIG` is set. The value overwrites any inherited value. `ZCODE_KIT_LOG_DIR` is the manager's own logs dir. `ZCODE_KIT_STOP_TOKEN` is freshly generated for each spawn and is the same value written to `proxy.pid`.
2. **The proxy removes `ZCODE_KIT_STOP_TOKEN` from the environment it gives the respawn hook,** as it already must for the solver process (Round 3 Q3 condition 1, Q10 condition 3). The hook never needs the token, and passing it on breaks "per-spawn".
3. **`ZCODE_KIT_LOG_DIR` is internal, not a user setting.** A proxy started without it (TUI-hosted, standalone) keeps today's behaviour: no size-capped file writer is opened by path, and no respawn acknowledgement wait happens, because no manager hook exists (ADR-0008 condition 5). The variable is documented as internal, like `ZCODE_KIT_RESPAWN_*`, and not in the user env-var list.
4. **Tests (seam 8 `proxy-env` suite + seam 2):**
   - with ambient bogus values for both variables, the spawned proxy receives the manager's logs dir and a new token;
   - the token in the proxy's environment equals the one in `proxy.pid`;
   - the respawn hook's environment has no stop token;
   - two consecutive spawns get different tokens.

**Rationale:** Round 3 Q4 condition 1 requires that the variable "survives `proxyEnv`" with a test, and that nothing else in the proxy's env contract changes. Round 3 Q3 requires a *per-spawn* stop token that never leaks. The proposed "allowlist" wording would make an implementer add a no-op and miss the actual requirement: overwrite at spawn, and strip from the hook. Inheritance through the respawn chain would otherwise reuse a stale token. In the worst case it would point a new proxy at a stale logs dir.

**Charter:** C6 (per-spawn secret, no leaks), C1 (logs land in the bounded, rotated file), C2 (env contract otherwise unchanged; TUI/standalone keep today's behaviour), C9.

**REVERSIBILITY:** Two-way door (internal variable; both sides ship in one release). Record the name in ADR-0015 condition 1 and the overwrite rule in ADR-0014 condition 1 as amendment lines.

---

## Q5 — Spec fidelity

**DECISION:** REJECTED. The spec is faithful in most of its sections. §1–§3, §5, §7, §9, §11–§15, §17, the §18 budget table and the build-time gates match Rounds 1–3. I found **11 deviations**, and three of them matter (D1–D3). Apply every correction below to `spec.md` (and to `seams.md` where noted) before /to-tickets. None of them reopens a design branch.

**D1 (matters).** *§10 capability record + Binding rules; Stories 90, 106.* The record sends non-TTY output to the `ascii` glyph tier. design-language §3.2 says "Copy follows the tier. On `ascii`, kit-authored punctuation maps down (`—`→`-`)". Together, these rewrite every off-TTY check row to `PASS  name - detail`. That contradicts **ADR-0001 rule 1 / Round 1 Q1 amendment 1 and Round 1 Q10 condition 2** (the exact legacy grammar with ` — `), the `ux/before/doctor/*/pipe.txt`, `term-dumb.txt` and `ascii-locale.txt` snapshots (all ` — `), and the existing parser `cli/zcode-kit.mjs:671`. The spec regex also makes the detail mandatory, but today it is optional (`zcode-proxy-manager.mjs:1153`, design-language §11 `( — <detail>)?`). **Correction:** add to §10 Binding rules: "Off a TTY, check rows keep the separator ` — ` (U+2014) byte-for-byte in every glyph tier. The ascii copy mapping does not apply to the check-row separator or the verdict words. The grammar is `^(PASS|FAIL|SKIP|WARN)  <name>( — <detail>)?$`, followed by whitespace-indented `why:`/`next:` lines." Apply the same regex to Story 90 and to the seam 5 regex test.

**D2 (matters).** *§0 Order of work, step 8 "CI guardrails"; §1 Baselines; §12 CI layout.* As written, the `memory-budget` CI job lands last. That contradicts **Round 2 Q14 condition 1** (the expected-RED list exists so that the job lands first) and **Round 3 Q9 condition 1** (the Bun 1.4.2 Windows reference run is "the draft PR's first CI run", on the loop code merged before the toolchain batch). Without the job in CI at step 1, the Windows reference baseline cannot exist before step 3. **Correction:** in §0, step 1 reads "the memory loop with budgets, the process-count harness, the Windows sampler **and the `memory-budget` CI job on ubuntu and windows with the expected-RED list**". Step 8 becomes "the remaining CI guardrails (snapshot-update refusal, test-wiring guard)". Record this as a second deviation from PROMPT §7 principle 8, justified by Round 2 Q14 condition 1 and Round 3 Q9, next to the existing upgrade-order deviation (RUNLOG + ADR). Note that the proxy typecheck already moved into batch 1 (Round 2 Q15 condition 1).

**D3 (matters).** *§4 "stop-token storage … (allowlisted in `proxyEnv`)", §4 "log dir in the proxy env … allowlisted in `proxyEnv`", seam 8 prior art "allowlist for `ZCODE_KIT_LOG_DIR`, `ZCODE_KIT_STOP_TOKEN`".* This contradicts the per-spawn and never-leaks properties of **Round 3 Q3 condition 1** and the "survives `proxyEnv`, nothing else changes" property of **Round 3 Q4 condition 1**. See Q4: `ZCODE_KIT_*` already passes through, and the respawn hook inherits the proxy environment. **Correction:** replace both "allowlisted" phrases with the Q4 decision: the manager sets both variables at every spawn and overwrites inherited values, the token is fresh per spawn and equal to the `proxy.pid` field, the proxy strips the token from the respawn hook's environment, and the Q4 tests apply. Add the hook to §2's list of environments that exclude the token ("the child environment excludes … `ZCODE_KIT_STOP_TOKEN`" → "the solver process and the respawn hook environments exclude …").

**D4.** *§8 "The manager: … creates every log file with mode `0o600`, and the logs directory with `0o700`."* This narrows **Round 3 Q5 condition 2** ("every creator of a log file"). The proxy's writer also creates `proxy.log` when it reopens after rotation, and the watchdog's by-path append can create it. **Correction:** move the rule to its own §8 bullet that binds every creator: the manager, the proxy writer on open and reopen, the watchdog by-path append, the creation of the early log, and the OMP extension if it creates the logs dir. Apply it to `proxy.log`, `proxy.log.1`, the early log, the autostart token and its result record. Story 78 already states it this way.

**D5.** *§7 truncation shape ("the tool description, the MCP API doc and the release notes carry the sentence"); §16 scope and release notes.* This narrows **Round 3 Q6 condition 4**: those three places "describe the cap, the marker and the idempotency window". **Correction:** in §7, they describe the 4 MiB cap (first 1 MiB + last 3 MiB), the `[… N bytes truncated …]` marker, the `truncated` field and the idempotency sentence. Add `docs/MCP_API.md` to the §16 scope list. Add "MCP task text capped at 4 MiB with a head/tail marker" to the §16 release-notes list.

**D6.** *Solution, first bullet ("Ten parallel harness sessions fit in ≤ 596 MB of summed RSS on Linux"); Story 29.* This contradicts **Round 3 Q2 condition 6 / ADR-0013 condition 9** ("stated, not claimed": the lower footprint on Linux/macOS needs Node ≥ 26.1, the S3 total is not claimed on Node 24, and macOS is unverified). **Correction:** add the qualifier "on Node ≥ 26.1 (launcher handover); not claimed on Node 24; macOS unverified (owner action)" to both places, matching §18.

**D7.** *§2 failure semantics ("and when a bounded solve queue overflows"); §7 bounds table; §18 BOUNDS.* The spec names a bound it never defines. Today the solve queue is unbounded in code (`captcha-solver.ts:136`, `queue.push` at :336). It is bounded only by its single caller (`captcha-pool.ts`, solve concurrency clamped to 1 at :91). The result is a gap against **§9 BOUNDS** and **Round 2 Q2 condition 1**, which presupposes a bound. **Correction:** add a §7 row, "Solver queue: bounded by its callers (one in-flight solve per pool); the ticket states the bound with evidence and pins it with a seam 3 test". The overflow shed applies only if a count bound has to be added because no caller-side bound can be shown. In that case the count goes into §7 and the shed follows ADR-0004.

**D8.** *§8 heading "The early-output file", §16 "log rotation and the early-output file".* This contradicts **GLOSSARY "Early log"** (_Avoid_: early-output file) and the spec's own rule that every module uses the glossary's vocabulary. **Correction:** say "early log (`proxy.early.log`)".

**D9.** *§18 MEMORY, row "S1 proxy main steady state", Source column "memory report §6 as adopted in Round 2 Q1".* **Round 2 Q1** adopted no S1 budget. **Correction:** the source is "memory-report §6 (steady ≤ 160 MB tightens §9's 250 MB with Phase 1 evidence; peak ≤ 250 MB kept), loop". The numbers stay.

**D10.** *Further Notes, first bullet: "The ADR should get an amendment line."* This is stale. **ADR-0001** already carries the Round 2 Q9 condition 3 amendment ("Amended 2026-11-06"). **Correction:** "ADR-0001 records this in its Round 2 amendment."

**D11.** *Testing Decisions, seams 1, 2, 3, 5, 8 (and `seams.md`).* Several decided behaviours have no test home: the execve handover (**Round 3 Q2 condition 6**), the pinned-Node-path preflight check (**Round 1 Q14 condition 2**), the waiter cause lines (**Round 3 Q2 condition 3**), and `proxy logs` across both files (**Round 2 Q4**). The solver reaping claims sit at seam 3, below the process level that **ADR-0002 condition 2 / Round 3 Q10 condition 2** bind them to. **Correction:** apply the Q1 additions 1–5 to both `seams.md` and spec → Testing Decisions.

**Rationale:** "Yes" would mean that no deviation matters. D1 would silently break the grep contract that Round 1 pinned for scripts. D2 would make the Windows budget reference impossible before the toolchain batch. D3 would leave the per-spawn stop token able to propagate through the respawn chain. D4–D11 are narrowings, a dangling bound, an unconditional claim, vocabulary, citation and test-coverage gaps. Each one is cheap to fix now and expensive once copied into tickets. The remaining sections match the decisions, including every REJECTED-part replacement and condition, the tightened budgets (≤ 596 MB, ≤ 74 MB launcher, two-part S3 verdict, the ≥ 30 % rule) and all eight build-time gates.

**Charter:** C2 (the grep grammar and the JSON/exit-code contracts), C6 (the stop token, file modes), C7 (the Windows baseline), C1 / §9 BOUNDS, C8, C9; PROMPT §7 (ordering deviation recorded).

**REVERSIBILITY:** Two-way door (spec text before tickets).

---

## Shared understanding

CONFIRMED. No design branch is open. The Q5 corrections D1–D11 and the conditions of Q1–Q4 are exact text changes to `spec.md` and `seams.md`. Fold them in before /to-tickets; no further round is needed for them. The Round 3 build-time gates stay as listed in spec §18, and they return as questions with numbers only if a gate fails.
