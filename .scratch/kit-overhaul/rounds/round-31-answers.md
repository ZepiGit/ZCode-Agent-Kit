# Round 31 (2026-11-09): a post-merge windows S2/short RED (cdn-cache:memory-growth 65 MB) and ticket 61's row values

Owner Proxy: claude-opus-5-5, fresh context, Charter v1. The decisions of Rounds 1–30 in DECISIONS.md bind these answers. Where an answer departs from one of them, it names that decision.

Evidence read (read-only):
- `OWNER-PROXY-BRIEF.md` and `rounds/round-31.md`.
- DECISIONS Round 12 Q3, Rounds 14 and 15 in full, Round 17 (Q1, Q3, cross-question condition 2), Round 20 Q1 with its Shared understanding, Round 22 Q1, Rounds 28, 29 and 30 in full. PROMPT §5 B1 and §7 Phase 4.
- Issues 29, 54 (Blocked-by line) and INDEX rows 29, 54, 55 and 61 on the integration tree. Ticket 61's file on `ticket/61-s1-stalled-windows` at ce6d627.
- Raw logs `ci-art/cdn29/<run>.log` (106 with a value; 42467078897 and 42502424683 have no S2 line). I re-extracted every `cdn-cache:memory-growth` value and the phase-D `rss` marks (WS) from the logs. My values match `vals.txt` run for run. For each run I took the tree from `runs.txt` and classified it by its contents (`git show <sha>:…`), not by the flag column. The checks were: `CDN_MEMORY_MAX_BYTES` in `captcha-cdn-cache.ts` (ticket 25), `captcha-cdn-disk.ts` present (ticket 29), and ancestry of each merged ticket's first code commit. I also read the runner image line of every log.
- `ci-art/int-984b-128954839021.log` (42553765178, windows): the S2 marks, the check table, the ratchet lines and the sampler line.
- Git (read-only): `git diff 5f754b8^1 5f754b8` (29's merge), `git diff --stat 3ed5896 984b45d` on the S2 path, `git diff --name-only` of the 16 (b811246), 38 (dfb9b43) and 61 (984b45d..ce6d627) merges. I computed the S2 body's static import closure at 984b45d: `s2-captcha-run.ts` → `captcha-solver.ts`, `captcha-cdn-cache.ts`, `captcha-cdn-disk.ts`, `captcha-token.ts`, `runtime/bounded-collection.ts`, plus the worker `captcha-solver-worker.ts` → `runtime/guest-error.ts`. I also read `s2-captcha.mjs:96-105` (the value is `footprintMB` at D-end minus D-start on windows) and `captcha-cdn-disk.ts` (`afterWrite`, `prune`).
- On 61's branch: `handler.ts` (`printHeader`, `printRow`, `observeStream`), `response-body.ts` (`countTokens`, `onEnd`), and a grep of README*, `docs/`, `zcode-proxy-src/README*`, `cli/`, `lib/` and `zcode-proxy-src/src/tui` for consumers of TTFB, Tok, tok/s and Total.

**Recomputed facts and corrections to the round.**

1. **The round's tree bins are wrong in two places. The conclusion survives the correction, but it gets weaker.**
   - The three `staging/25` runs (42455986931 58, 42461329252 57, 42465834202 59) are counted as "before 25". Their trees carry the 32 MiB cap. That is where "before 25: n 44, mean 145.2" comes from. The true pre-25 set is n 41, mean 151.6, sd 1.8, range 147–155.
   - The first `staging/29` run 42494299680 (61) is flagged `no29`, but its tree has `captcha-cdn-disk.ts` (round-1 version of 29).
   - Corrected values:
     - with 25, without 29: n 26, mean 52.88, sd 6.00, max 62;
     - with 25 and 29: n 39, mean 56.44, sd 5.26, max 65.
   - The difference is +3.55 MB: Welch t 2.45 (df 49), Mann–Whitney z 2.66.
2. **The values are bimodal on both trees, so a single normal fit is the wrong model.** Splitting at 54 MB:

   | tree | low mode | high mode | share high |
   |---|---|---|---|
   | 25 only (n 26) | 14 runs, mean 47.6, sd 1.4 | 12 runs, mean 59.1, sd 1.3 | 46 % |
   | 25 + 29 (n 39) | 13 runs, mean 49.8, sd 2.1 | 26 runs, mean 59.8, sd 2.3 | 67 % |

   - Most of the +3.55 MB mean shift comes from a larger share of high-mode runs. That share change alone is not significant (Fisher p = 0.13).
   - The low mode moved +2.2 MB (t ≈ 3.2). The high mode moved +0.7 MB (t 1.16), but it widened.
   - **So "29 added about 3.7 MB per run" is not what the data show.** What they show is a shift on 29's trees of uncertain form.
   - **The tail is also smaller than the round says.**
     - Under the two-mode fit, P(≥ 65) is about 1.4 % per run on 29's trees, not about 7 %.
     - Empirically it is 1 of 39 = 2.6 % (95 % Clopper–Pearson 0.06–13.5 %).
     - On the 25-only trees, the high mode puts ≥ 65 at about 0.
3. **29 is the only change on S2's measured path between the two groups, so it is the leading suspect. It is not a proven cause.**
   - Since 29's merge, the tip changed `async/handler.ts`, `config/*`, `index.ts`, `proxy/{body-transformer,client-session,handler,responses-handler,session-context}.ts`, `runtime/{health-monitor,memory-thresholds,supervisor}.ts` and `server/server.ts` (tickets 20 and 21). None of these is in the S2 body's import closure.
   - 73's edit of `s2-captcha.mjs` was reverted (2347fa2) before 984b45d.
   - All 106 logs ran on runner image `win25-vs2026` 20261103.298.1, with Bun 1.4.2.
   - **Mechanism unknown.** Phase D writes 600 × 256 KiB ≈ 150 MiB, which is below the 256 MiB disk cap. So 29's pruner does no cap prune there. Per write it does Map bookkeeping. Beyond that, at most a 60 s rescan: one `lstat` and one 513-byte header read per entry.
4. **The 65 MB run is a commit/WS gap event.**
   - In 42553765178, phase D reads WS 77 → 139 MB = 62 (under 64) and commit 65. Its commit − WS gap is 3 MB. On 29's trees the mean gap is 0.9, and on the 25-only trees it is 0.3.
   - WS growth on 29's trees: mean 55.5, max 62. On the 25-only trees: mean 52.6, max 62.
   - The only ratchet failure in the run is this name. Every other S2 RED is one of 58's names.
   - **EVIDENCE MISSING (not blocking): the linux S2 value of 42553765178.** Its ubuntu log is not on this host.
5. **Confirmed: 16 and 38 cannot reach the value.**
   - 38 touches `cli/commands/doctor.mjs`, `lib/proxy-doctor.mjs`, `pack/verify-payload.mjs`, `proxy/zcode-proxy-manager.mjs`, the `package.json` test list and tests.
   - 16 touches `lib/{start-lock,proxy-lifecycle}.mjs`, the S3/S4 scenarios, `tests/memory/lib/completeness.mjs`, `expected-red.json`, the `package.json` test list and tests.
   - Neither touches a file in the S2 body's closure, `s2-captcha*`, `budgets.mjs`, `verdict.mjs`, a sampler, the Bun pin or the Node version.
6. **Q2: two facts in the round need correcting.**
   - **There is no "row help text".**
     - No README (any language), `docs/` page, `zcode-proxy-src/README*`, CLI help or TUI code describes the request-row columns.
     - The row is a console/log line in two formats: the table, and `ZCODE_LOG_FORMAT=compact`. Dump mode also writes an `upstream_stream_summary` with `totalMs` and `tokensObserved`.
     - **No `--json` output carries Total, Tok or tok/s.**
   - **Tok is not an event count.** `countTokens` takes the upstream's usage total (`completion_tokens` / `output_tokens`) when a usage event is read, and otherwise counts content deltas.
   - Also: the change covers only the three former `tee()` sites in `handler.ts`. Per 61's "Left for others", `/v1/responses` (`responses-handler.ts` `streamResponse`) and the async bridge still pump eagerly. They keep today's values.
7. Record drift: INDEX row 29 says `ready-for-agent`, but the file says `resolved`.

---

## Q1 — integration run 42553765178 (984b45d) is RED on windows S2/short `cdn-cache:memory-growth` 65 MB (budget 64), unowned

**DECISION:** REJECTED in part.

Accepted:
- **Item (1), first half.** Neither 16 nor 38 is reverted, because they cannot reach the value (correction 5). Ticket 29 is not reverted either.
- **Item (3).** The post-merge RED is recorded, and nothing is rerun.

Rejected:
- (i) **Attributing the shift to ticket 29 "on the measured evidence", and reopening 29 to "find why … and remove it".** The bins were wrong, the distribution is bimodal, and the mechanism is unknown (corrections 1–3). The evidence makes 29 the suspect, not the cause. A fix-forward that must "remove" a cost nobody has isolated would leave the implementer to decide whether a defect exists. Instead, a new ticket **80** measures first, by an A/B on one tree against the verbatim pre-29 cache. The fix lands only if that A/B attributes the shift (conditions 2–3).
- (ii) **Listing windows S2/short `cdn-cache:memory-growth` under owner 29 with `flips`.** This re-adds a removed name. Round 15 Q1 condition 5 ("a later RED of a removed name is an unowned RED: a question, never a re-add") forbids it, and so does Round 20 Q1 condition 3, which named "re-adding the name to `S2/short`" as forbidden for this very check. A `flips` listing would also tolerate the CDN memory bound at any value, including the 90 MB and 150 MB defect values. Round 17 Q1 and Q3 rejected exactly that. Round 22's listing is not a precedent here: there the mechanism was shown from the artefact and a role check bounded what was tolerated, and neither holds here.
- (iii) **"About 7 % per run".** The measured tail is about 1.4 % (two-mode fit) to 2.6 % (empirical) per run (correction 2). That is still above Round 30's 1 % bar, so a narrow interim signature is justified in place of the listing (condition 4).

Departures, stated explicitly:
- **PROMPT §7 Phase 4's revert rule, Round 6 Q2 condition 4's last bullet and Round 13 Q1 condition 6.** I depart from them for run 42553765178 and for signature (ix) only. This is the same departure as Round 17 cross-question condition 2, Round 22 Q1 condition 5 and Round 28 Q1 condition 5: the RED is one that the merged diffs cannot reach, and it is decided on its distribution.
- **Round 30 Q1 condition 5** ("a post-merge run follows PROMPT §7 Phase 4 unchanged") was written for linux S1/stalled. It is not contradicted, because that key gets no signature.
- **Consistent with:** Round 15 Q1 condition 5, Round 20 Q1 condition 3, and Round 20's Shared understanding. That Shared understanding foresaw this case: the 6–7 MB Linux margin, and "that RED comes back as an unowned RED, not as a quiet cap change".

**I loosen no bound.** These are all unchanged:
- the 64 MB `cdn-cache:memory-growth` budget and the windows commit gate (Round 7 Q1);
- the 32 MiB body budget and 256 entries (Round 20 Q1);
- 29's 256 MiB disk cap and its max(14 days, TTL) age rule;
- the S2 workload and phase order;
- every other S2 name and owner;
- `expected-red.json`.

Binding conditions:

1. **Run 42553765178.**
   - It does not count against 16 or 38 and causes no revert.
   - Its RED stands as an unowned RED, decided here. It is not rerun.
   - It satisfies signature (ix) below, and it is the first entry in ticket 80's record.
2. **New ticket 80** (exact text below). `Status: ready-for-agent`, Model sol, Risk medium, ADR no, Blocked by none.

   **Stage 1, A/B attribution (pre-registered).**
   - The setup:
     - An off-by-default measurement mode in the test loop only: a marker file, never merged, the same pattern as 61's `--measure-stalled`.
     - It runs full S2/short with phase D on either head's `CaptchaCdnCache` or the verbatim pre-29 cache `zcode-proxy-src/src/__fixtures__/captcha-cdn-cache.7555b87.ts` (in tree, blob checked by 29's replay test).
     - Everything else in the run is identical.
   - Counts and order:
     - **≥ 30 S2/short runs per arm on windows**, arms alternating ABAB in one job and BABA in the next;
     - ≥ 10 per arm on linux as the control.
     - Why 30: with sd ≈ 5.5, it takes about 30 per arm to see 3.5 MB at t ≈ 2.5. Ten per arm would see it with t ≈ 1.4 only.
   - What it records per run: commit and WS at D-start and D-end; the low/high mode (≤ 54 / > 54); and whether the pruner's 60 s rescan ran during phase D.
   - **Verdict (fixed now):**
     - **attributed to 29's code** if the windows commit mean of head minus pre-29 is ≥ 2.0 MB with Welch t ≥ 2.5;
     - **not attributed** if the difference is < 1.0 MB or t < 1.5;
     - **inconclusive** otherwise, and it comes back with all values.
     - The mode shares and a Fisher test are reported beside it.
   - If 58 (or anything else on S2's path) merges during the runs, the count restarts on the new tree.

   **Stage 2, only if attributed.**
   - The cost is removed inside 29's code under B1's IN SCOPE (resource lifecycle). 29's `captcha-cdn-disk-prune.test.ts` and `captcha-cdn-disk-replay.test.ts` and 25's seam-3 replay pass unchanged. Prune decisions, fetches, bytes, `sha256` and `fetchedAt` stay identical.
   - Forbidden: changing any bound in the list above, the S2 workload or the metric.
   - Exit: ≥ 10 GREEN windows S2/short runs on the fix tree, plus the A/B rerun on the fix tree showing a difference of < 1.0 MB.
   - If attributed but no lever exists inside those limits, it comes back with the numbers.

   **Not attributed.** It comes back with all values. The question then becomes the S2 phase-D bimodality on windows, with no owner, in the manner of tickets 78 and 79.
3. **Ticket 29 stays `resolved`.** It gets a Comments line (informational, no criterion, no ownership; Round 15 Q1 condition 6). If ticket 80 attributes the shift, the fix is 80's, and 29's number and record stay as they are.
4. **Interim signature (ix)** (Round 17 cross-question condition 2 form). A staged or post-merge run qualifies when all of these hold:
   - its only unexcused failure is windows S2/short RED on `cdn-cache:memory-growth`;
   - the value is ≤ 70 MB on commit;
   - phase-D WS growth (D-end − D-start `rss`) is ≤ 64 MB;
   - every other S2 RED name is one 58 owns;
   - the linux S2 `cdn-cache:memory-growth` of the same run is ok.

   Such a run does not count against the ticket, does not block its merge and causes no revert. The orchestrator records each occurrence in ticket 80's Comments with the run id, commit, WS and the linux value.
   - **Ineligible**, by exact path:
     - a diff touching `zcode-proxy-src/src/proxy/captcha-*`, `zcode-proxy-src/src/runtime/{bounded-collection,guest-error}.ts`, `zcode-proxy-src/package.json` or `bun.lock`;
     - `tests/memory/scenarios/s2-captcha*`, `tests/memory/lib/{verdict,budgets,sampler*,win-*}.mjs` or `tests/memory/job.mjs`;
     - the Bun pin or the memory job's Node version.
     - So ticket 80 itself, 58, 27, 28 and 61 (whose diff touches `job.mjs`) get no exception. A RED in their runs comes back with values.
   - **Why 70.**
     - It is 4.4 sd above the high mode on 29's trees (59.8, sd 2.3), and 2.6 sd above the single-normal mean. It was not fitted to the 65.
     - It lies well below the known defect values: 90 MB with 64 MiB of bodies, and 147–155 MB unbounded.
     - The WS clause sends back any run in which the tier's working set itself exceeds the budget.
   - **Comes back early:**
     - on two (ix) occurrences within any 20 consecutive windows runs;
     - on any value above 70, or WS above 64;
     - on any linux S2 `cdn-cache:memory-growth` RED.
   - **Ends** when the Owner Proxy answers ticket 80.
   - Signature (viii) is skipped, because that number was the proposal Round 30 rejected.
5. **Records.**
   - RUNLOG records: this round; corrections 1–4; that 42553765178 is not charged to 16 or 38 and is not rerun; and signature (ix) with its start time.
   - METRICS gains the corrected windows table: pre-25, 25-only and 25+29 by tree contents, the two-mode split, the WS column, and the run ids.
   - INDEX: row 29's status becomes `resolved` (drift), and row 80 is added.

**Rationale:** Three facts settle this. First, the RED cannot come from the merges that produced the tip, so a revert would punish two finished tickets for nothing. Second, the shift is real enough to name a suspect but not to name a cause. Once the bins are corrected, the data are two modes on both trees, the mode share moves without significance, and a small low-mode shift remains. 29 is the only change on S2's path, but its phase-D work is a Map entry per write. Third, the tail is about 1.4–2.6 % per run, not 7 %.

Under C9, the stronger evidence is the one that isolates the code. The verbatim pre-29 cache already sits in the tree, so an interleaved A/B on one runner is cheap and removes the tree and time confound. Pre-registering its verdict keeps the implementer from deciding whether a defect exists.

The listing is the wrong instrument. Two binding decisions forbid re-adding this exact name, and it would tolerate the CDN bound at any size. A narrow signature with a value ceiling, a WS clause and exact-path ineligibility does the listing's useful job instead: it shields tickets that cannot cause a roughly 2 % tail. It hides nothing that a real regression of the tier would show.

**Charter:** C1 (the CDN memory bound stays enforced at 64 MB; nothing tolerates it at an unbounded value; the disk bound is kept rather than reverted), C7 (windows evidence decides; linux is the control), C9 (stronger measured evidence: 106 runs re-binned by tree contents, the WS column and a pre-registered A/B; smaller blast radius: no revert, no list edit, one narrow signature; simpler: an existing fixture as the A arm), C6 (test-loop marker only, no endpoint), §9 (no bound loosened), B1 (any stage-2 change is lifecycle only, with 25's and 29's replay proofs unchanged), Round 7 Q1, Round 13 Q1 condition 6, Round 15 Q1 conditions 5 and 6, Round 17 Q1 and Q3 and cross-question condition 2, Round 20 Q1 condition 3 and its Shared understanding, Round 22 Q1 (distinguished), Round 28 Q1 conditions 1, 4 and 5, Round 30 Q1 condition 5 (the 1 % bar), PROMPT §7 Phase 4 (departure for this run and (ix) only; no rerun-until-green).

**REVERSIBILITY:** Two-way door: a measurement ticket, an interim signature that ends on a named answer, records. No code or list changes. ADR: no.

### Exact text changes

**New `issues/80-windows-s2-cdn-memory-after-29.md`:**

```
# 80: windows S2/short cdn-cache:memory-growth after ticket 29: A/B attribution

**Status:** ready-for-agent
**Blocked by:** none

Model: sol
Risk: medium
ADR: no

**What to build:** Owner Proxy round 31 Q1. Post-merge run 42553765178 (984b45d) was RED on windows S2/short cdn-cache:memory-growth 65 MB commit (WS 62; budget 64), unowned. By tree contents, windows values are 25-only n 26 mean 52.88 sd 6.00 max 62 and 25+29 n 39 mean 56.44 sd 5.26 max 65 (Welch t 2.45), bimodal on both trees (low ~47.6 / 49.8, high ~59.1 / 59.8; high share 46 % -> 67 %, Fisher p 0.13). Ticket 29 is the only change on S2's measured path but is not proven to be the cause. Stage 1 (pre-registered): an off-by-default test-loop marker (never merged) runs full S2/short with phase D on head's CaptchaCdnCache or on the verbatim pre-29 cache zcode-proxy-src/src/__fixtures__/captcha-cdn-cache.7555b87.ts, everything else identical; >= 30 runs per arm on windows (ABAB in one job, BABA in the next) and >= 10 per arm on linux; record commit and WS at D-start/D-end, the mode (<= 54 / > 54) and whether the pruner's 60 s rescan ran in phase D. Verdict: attributed if windows commit mean(head) - mean(pre-29) >= 2.0 MB with Welch t >= 2.5; not attributed if < 1.0 MB or t < 1.5; otherwise inconclusive and it comes back. Stage 2 only if attributed: remove the cost inside 29's code as resource lifecycle (B1 IN SCOPE); captcha-cdn-disk-prune.test.ts, captcha-cdn-disk-replay.test.ts and ticket 25's seam-3 replay pass unchanged (same prune decisions, fetches, bytes, sha256, fetchedAt). Never change the 64 MB budget, the 32 MiB body budget, 256 entries, the 256 MiB disk cap, the age rule, the S2 workload or the metric. Exit: >= 10 GREEN windows S2/short runs on the fix tree and the A/B on the fix tree < 1.0 MB. Attributed with no lever inside those limits, not attributed, or inconclusive: comes back to an Owner Proxy round with all values. A merge on S2's path (for example 58) during the runs restarts the count. This ticket owns no name and lists nothing; it records every signature (ix) occurrence (run id, commit, WS, linux value), starting with 42553765178.

**Acceptance criteria:**
- [ ] Stage 1 A/B recorded with all per-run values and the verdict under the pre-registered rule.
- [ ] Stage 2 (only if attributed): fix with the three replay/prune suites unchanged and green, then the exit evidence above.
- [ ] METRICS table: per arm, per leg, per run.
```

**`issues/29-cdn-disk-cache-pruning.md`**, add under `## Comments`:

```
- 2026-11-09 (orchestrator, Owner Proxy round 31 Q1, informational; no criterion, no ownership): windows S2/short cdn-cache:memory-growth reads +3.55 MB higher on trees with this ticket (n 39 against 26, bimodal on both). This ticket is the only change on S2's path but is not proven to be the cause; ticket 80 measures head against the verbatim pre-29 cache. This ticket stays resolved and is not reverted.
```

**`issues/INDEX.md`:** row 29's status becomes `resolved`. Add row 80 (`windows S2/short cdn-cache:memory-growth after ticket 29: A/B attribution`, sol, medium, blocked by none, `ready-for-agent`). No other edge.

---

## Q2 — ticket 61 changes two row values for slow clients (Round 12 Q3 condition 2, third bullet)

**DECISION:** ACCEPTED with conditions. The recommendation's text is corrected in three places (correction 6):
- there is no row help text;
- Tok is the upstream usage total, or the counted deltas, from the events read;
- the release-notes line must name the routes that changed.

This answers the "comes back before it ships" that Round 12 Q3 condition 2 required. It does not contradict that decision. The field names stay as they were. Each value keeps its definition: Total is still the time until the proxy saw the upstream end, and Tok is still what the proxy observed. The values move because the proxy now reads at the client's pace, which is the backpressure Round 12 ordered. Keeping today's values would need the read-ahead queue that Round 12 Q3 told 61 to remove.

Binding conditions:
1. **This acceptance binds only if stage 2 ships.** Stage 2 still needs the windows attribution on staging/61m1 and staging/61m2 to put the excess in bucket (i) or (ii) within ±20 % (Round 12 Q3 criterion 1). If it puts the excess in (iii) or (iv), or is inconclusive, criterion 4 applies, and the stage-2 commits come back together with this acceptance. Every windows GREEN criterion stays pending CI, as written.
2. **What is unchanged:**
   - column names, order and widths;
   - the compact format;
   - TTFB's meaning;
   - the dump field names (`totalMs`, `tokensObserved`);
   - every other route's values.
   No config key, env var or switch restores the old values. Such a switch would re-enable the queue (C1) and add surface for no gain (C9).
3. **Release notes (C2: announced, not silent).** New edge **54 ← 61**, following the 59 and 69 precedent. Acyclic: 54 has no dependents, and 61's ancestors (02, 19, 20 and theirs) do not include 54.

   The line, exact. The implementer may correct the route list to the code, but not the meaning:

   `Proxy request log: on streamed /v1/messages and /v1/chat/completions answers, the proxy now reads the upstream at the client's pace instead of buffering ahead of a slow client. For a client that reads slower than the upstream sends, Total and tok/s now include the time the client takes to read the answer. If such a client disconnects early, Tok reflects only what was read before it left (the upstream's usage total if it arrived by then, otherwise the counted text deltas). Clients that keep up see the same values as before; TTFB, the column names and the compact format are unchanged; /v1/responses streams are unchanged.`

   The dump-mode decoder fix (the 4 KiB sample's own decoder) gets one more clause in the same item. The orchestrator records the line in 54's Comments when 61 closes.
4. **Where it is documented (C8).** No README, translation, `harnesses/README*` or help text describes the request row today (correction 6), so none is owed a change. Instead:
   - a source comment at `printHeader` / `printRow` states the column semantics as in condition 3;
   - if ticket 52's README parity work documents the row later, it uses this wording.
5. **Tests that pin the new semantics** (seam 4; add the ones that the existing backpressure and contract tests do not already cover):
   - (a) for a client that keeps up, every one of the 9 contract cases yields the same Tok as on the tip 788f2fb;
   - (b) for a client that pauses P ms mid-stream, the row's Total is ≥ P;
   - (c) for a client that leaves early, the row is printed once, and Tok equals the usage total or delta count of the events delivered before the cancel, never more.
6. **Scope note.** The eager `/v1/responses` stream and the async bridge keep today's values. Until a follow-up exists, the row's semantics differ by route, and the release-notes line says so. A follow-up that converts them carries the same note. Nothing more is decided here.

**Rationale:** The new values describe what the proxy actually did, so the user sees the client's real experience instead of an upstream finish time reached only by queueing. The cost is a changed number for slow and early-leaving clients, in a human-readable log line. No `--json` output and no kit consumer reads that line (correction 6), so C3's `--json` stability and C2's JSON fields are untouched. The rest of C2 asks that the change be announced, which condition 3 does. The alternative would undo the C1 fix. A switch to keep old values would be a second mode that exists only to bring an unbounded queue back. The recommendation's own wording needed tightening: Tok is not an event count, the help text it relies on does not exist, and the change covers only some routes.

**Charter:** C1 (backpressure bounds response memory without shedding; no switch brings the queue back), C2 (field names unchanged; the change is announced in the release notes; no state or migration), C3 (consistency and clarity of the row; `--json` untouched), C8 (release notes; no affected README text), C9 (simpler: no switch; smaller blast radius: acceptance conditional on stage 2 shipping), B1 (`handler.ts` and `sse-translator.ts` are not anti-abuse modules; upstream request bytes are unchanged), Round 1 Q5, Round 12 Q3 criteria 1, 2 and 4, Round 12 Q2 and Round 14 Q2 condition 5 (the 54-edge precedent).

**REVERSIBILITY:** Two-way door: an internal response pipeline behind unchanged names, a log line's values, and a release-notes line. ADR: no.

### Exact text changes

**`issues/61-s1-stalled-windows-response-side-memory.md`**, add under `## Comments`:

```
- 2026-11-09 (orchestrator, Owner Proxy round 31 Q2, binding): the two row-value changes are accepted on the condition that stage 2 ships (windows attribution on staging/61m1 and staging/61m2 in bucket (i)/(ii) within ±20 %; otherwise criterion 4 and the stage-2 commits come back with this acceptance). Unchanged: column names, order and widths, compact format, TTFB, dump field names, other routes; no config switch. Release-notes line (edge 54 ← 61) as in round 31 Q2 condition 3; a source comment at printHeader/printRow states the semantics; seam-4 tests pin (a) Tok equal to the tip 788f2fb for a client that keeps up in all 9 contract cases, (b) Total >= an imposed client pause, (c) one row and Tok never above what was delivered for an early leaver. Corrections: Tok is the usage total or the counted deltas of the events read, not an event count; no row help text or README describes the row; no --json output carries Total, Tok or tok/s. This ticket's diff touches tests/memory/job.mjs, so signature (ix) does not apply to its runs.
```

**`issues/54-release-notes-and-owner-actions.md`:** add `61 (S1/stalled on Windows: proxy memory under many stalled streaming readers)` to `**Blocked by:**`. **INDEX row 54:** add 61.

---

## Shared understanding

Open branches I still see:
1. **Ticket 80's verdict.**
   - Attributed: a stage-2 fix inside 29's code.
   - Not attributed or inconclusive: windows S2 phase D has an unexplained two-mode distribution (≈ 48 / ≈ 60 MB) on both trees with no owner, and it comes back as a rule question like 78 and 79. Round 20's 6–7 MB margin is the underlying risk.
   - Signature (ix) holds until then.
2. **EVIDENCE MISSING: the linux S2 value of 42553765178.** It is not on this host. Ticket 80 records it.
3. **Ineligible tickets meet the tail with no exception.** 58, 27, 28 and 61 each have about a 13–23 % chance over 10 runs, and each RED comes back with values. If that happens often before 80 answers, the answer is due early.
4. **61's windows attribution** (staging/61m1, 61m2) is still pending. If the excess sits in (iii) or (iv), stage 2 and Q2's acceptance come back together, the windows `S1/stalled` entry stays, and 55's empty-list criterion becomes the owner question that Round 12 Q3 named.
5. **The row semantics differ by route** until `/v1/responses` and the async bridge get backpressure (61's "Left for others"). No ticket exists for that yet.
6. **61's burst4 paired shift** (219.9 → 230.6, p = 0.015, GREEN) is flagged by the implementer and was not decided here. It is judged with 61's pre-merge evidence under Round 12 Q3 criterion 3.
