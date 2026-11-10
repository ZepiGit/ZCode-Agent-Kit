# 82: GitHub issue #32: safe failure diagnostics and latest-ZCode compatibility evidence

**Blocked by:** — (coordinate with 27 and 58 before changing solver lifecycle files)

**Status:** needs-triage

Model: sol
Risk: high (authorization failures, sensitive diagnostic data, anti-abuse boundary)
ADR: no (any proposed protocol change requires separate boundary review)

**Source:** https://github.com/ZepiGit/ZCode-Agent-Kit/issues/32 . This is GitHub issue 32, not local overhaul ticket 32 (TUI log pane caps, already merged).

**User requirement:** Include the issue's fix in the overhaul task list and aim for compatibility with the newest official ZCode. The latest release re-verified through GitHub's live release API on 2026-11-10 is v3.17.2, published 2026-11-04T10:41:06Z, target commit a9fe401eede6e6e5e01be9048679c206fe6f02d9: https://github.com/zai-org/ZCode/releases/tag/v3.17.2 . Recheck this at implementation/verification time.

## Incident evidence and uncertainty

The reporter uses kit v0.2.42, Windows 11 and Bun 1.4.2. They report failed POST /v1/chat/completions with HTTP 405 and business code 3012, repeated guest-script TypeErrors, successful local GET /v1/models and doctor checks, and a separate claim-preview response with code 0 but no data. Desktop succeeds for the same account according to the reporter. These observations do not establish that one failure causes the others.

Three independent earlier reports were received. They disagree about official request-verification behavior, source/version details, and the cause of 3012. Treat their proposed root causes as hypotheses, not verified facts. A later read of the issue found one maintainer comment; earlier reports saying zero comments are stale. Do not repeat the maintainer's causal claim as proven without a reproducer.

## Allowed scope

PROMPT.md B1-B6 remain binding. Work may improve error handling, secret-safe observability, resource lifecycle and documented runtime discovery/requirements. No change may raise CAPTCHA challenge pass rates, add browser-fingerprint/API shims for challenge solving, imitate the official client's identity, bypass request verification, rotate accounts differently, or work around quotas/rate limits. Do not automatically bump identity.appVersion or implement skip_model_request from an unverified report.

## Acceptance criteria

- [ ] Preserve a redacted incident evidence report separating local guest failure, upstream business rejection and malformed/missing claim-preview data. Preserve genuine authorization rejection; do not classify all 3012 responses as CAPTCHA failure.
- [ ] Build a deterministic offline public-boundary reproduction for each safe behavior to change. Record runner root, executed tests and exact failing assertion; infrastructure errors and fabricated successful tokens are not incident recovery evidence.
- [ ] If arbitrary guest messages/stacks can expose secrets, replace them with bounded metadata-only diagnostics and tests containing synthetic secret markers across uncaught-exception and unhandled-rejection paths. Coordinate changes with ticket 27; preserve host-error/guest-error classification.
- [ ] If local verification failure is swallowed, preserve sanitized failure provenance and surface it on subsequent request failure without leaking payloads, weakening authentication, adding unbounded retries or replaying after output.
- [ ] Independently verify latest official ZCode runtime requirements and distribution discovery paths against primary source at a pinned commit. Map gaps to existing overhaul tickets first; create separately scoped fixes only for uncovered runtime/discovery/config-consumption behavior, not anti-abuse identity imitation.
- [ ] Keep claim-preview missing-data handling fail-closed. Any response-parser compatibility fix needs its own offline fixture and independent source evidence; a successful empty preview is not a fix.
- [ ] Full local suites and both OS CI legs pass for any implementation; new tests are wired and existing tests are unchanged or justified.
- [ ] Do not close GitHub #32 or claim restored live inference from a green static inspector, doctor, models listing, fixture token or memory suite. If original failure recovery cannot be established safely without private artifacts/credentials or prohibited anti-abuse changes, record that limitation and an exact owner-only verification procedure in OWNER-ACTIONS.md, leaving the incident unresolved.

## Comments

### 2026-11-10 — standalone CLI distribution also misses automatic discovery

Pinned official builder/runner/installer source at a9fe401 now establishes `~/.zcode/runtime/releases/<version>/agent/zcode.cjs`, selected by the installation's `current` symlink, with `ZCODE_DIST_HOME` override. Exact source URLs, line references and verified Git blobs are in `research/zcode-current-runtime-20261110.md`. The official installer/runner was read only, never executed; launcher3.17.2 and agent0.17.1 versions must remain distinct.

Additional external seam7 probe `/home/AgentKit/overhaul-tools/t82-standalone-discovery-boundary-probe-20261110.mjs`, SHA256de8aca201b4b9fe709ee137b128f7c69c9548525b3078ba5ca184ccb3efbc953, runs realMCPinitialize/zcode_health against temporary release/current-symlink fixtures. One capped1G90sNode26.7.0 run:4executed/2PASS/2FAIL,0unexpectedErrors,EXIT1/1s. Default standalone and customZCODE_DIST_HOME are not found and execute zero version probes; explicit agent path succeeds and missing explicit path still fails closed. Log `reports/t82-standalone-discovery-boundary-red-20261110.log`, SHA256eb4f14106a4db863b9501d0567fb19af97c521c281f80584a7f8e49744242dc1. Four owned bridge children plus one version probe exited, temp root removed. Product/dist unchanged, no vendor/model/network/credential access.

This supersedes the earlier 'standalone internal layout unmapped' limitation only. NativeWindows/macOS, live app-server/protocol compatibility, supported-path precedence/containment decisions, implementation/permanent tests/fullsuite/newreview/freshCI remain open. No product fix/merge, quota evidence or workflow change.

### 2026-11-10 — current official server layout is not auto-discovered

Primary-source/runtime evidence and exact source URLs: `research/zcode-current-runtime-20261110.md`. Live release API still latestv3.17.2/app, public targeta9fe401; release body separately names buildsourcee6b675b. Agent package at public target is0.17.1 with engines.node24.14.0; local server manifest names bundledNode22.16.0. These are separate version/context facts, not a proven minimum-runtime requirement or an identity-change instruction.

Pinned official manifest/paths/releaseManager source defines `(ZCODE_DATA_BASE_DIR || HOME)/.zcode/server/current.json` selecting a releases directory with `runtime/zcode.cjs`; current kit discovery.ts:34-44 considers only seven legacy Windows desktop paths. Existing13/36/56/57/53 scopes do not implement current distribution discovery; this remains an uncovered safe82scope item pending triage/independent review, not an authorized protocol or anti-abuse change.

Controller ran the real MCP initialize/zcode_health boundary with temp-HOME version-only fixtures: two finite1G90s runs, Node26.7.0, each5executed/3controlPASS/2discoveryFAIL, EXIT1/2s. Legacy desktop and explicit current-server path work; default current-server and customZCODE_DATA_BASE_DIR layouts degrade before any version probe; missing explicit override still fails closed. Five owned bridge children plus two version-probe children perrun exited with PID/PGID records; temporary fixtures removed. No vendor execution/model/network/credential/account-store use or product/dist edit. Logs `reports/t82-zcode-discovery-boundary-{red,repeat-red}-20261110.log`. Final externalprobe `/home/AgentKit/overhaul-tools/t82-zcode-discovery-boundary-probe-20261110.mjs`, SHA256f5a5b36c4ad204ce4a93be1df92eb8ba692b15119d5cd08c656514094bf0038c. Probe was made green-capable between runs by removing a red-only assertion, with unchanged semantic outcome.

This proves a Linux fixture discovery gap, not official app-server compatibility or original3012incident recovery. StandaloneCLI internal layout, actual nativeWindows/macOS layouts, safe pointer precedence/containment and permanent wired regressions/fullsuite/freshCI remain open. No fix/merge/approval or workflow change; quota/reset still unknown.

### 2026-11-10 — raw provenance reproduced over the real HTTP listener

Controller closed the previously unexecuted three-endpoint transport gap without model/provider calls or production edits. External probe `/home/AgentKit/overhaul-tools/t82-http-provenance-boundary-probe-20261110.ts` (SHA256485276bb76e0842e5118a302da4ad28aa4e7350f8cc944c62a618929f1354b61) uses real startServer/router/error mapping and real CaptchaTokenPool, an injected synthetic solver, a mocked lazy provider and synthetic upstream response. Own loopback port19820, in-memory fixture auth, global fetch restricted to that listener, no vendor SDK or account-store access. Approved seams3/4 from seams.md, not private field inspection.

Two finite capped Bun1.4.2 runs,1G90s/isolatedHOME, each12executed/6controlPASS/6securityFAIL, EXIT1/duration0s. Wrong-key controls401 on all three endpoints; trusted no-marker error controls503 captcha_solver_failed without marker. Raw and mutable typed SDK markers survive into actual HTTP503 bodies AND warnings on `/v1/chat/completions`, `/v1/messages`, `/v1/responses` (six FAILs). Per authorized request: one synthetic upstream call, two public pool takes, no extra mint/resend after storm refusal. Each run12local requests/9fixture upstream calls/0unexpected external fetches. Listener and owned probe processes closed; t82 remains clean at883f566, product unchanged. Logs `reports/t82-http-provenance-boundary-{red,repeat-red}-20261110.log`, first SHA256a3cb6f9f9386a370c7deae6ee2c03eeff7fc214713a98f2514da604c609ae0c6. Full finding `/home/AgentKit/overhaul-tools/t82-metadata-boundary-finding-20261110.md`.

This supersedes older comments saying all three HTTP paths were unexecuted; actual full-TUI integration remains unexecuted. It is neither a fix nor proof of a real credential leak/incident recovery. Keep82unmerged; permanent regressions, implementation, independent review/fullsuite/freshCI remain required. Quota/reset still unknown; stopped workflow658f0456 unchanged.

### 2026-11-10 — completed independent review recovered: APPROVAL REJECTED

Controller recovered ONLY the exact completed Review result from read-only local workflow journal node1749/run658f0456, actor 'Sicherheitsreview82 vor eigenständigem Merge', resolvedmodelxai/grok-4.7-build-fast. No model call, workflow resume, credential/config/account-table access or transcript dump. Exact result `/home/AgentKit/overhaul-tools/t82-completed-review-recovered-20261110.json` has `approved:false` and three blocker findings: metadataformattertext/bounds, TUIvsheadlessclassification, rawsolvermessageprovenance. This supersedes earlier claims that its verdict was unavailable, not the result itself. Controller independently confirmed classification/publicpool findings with a new synthetic-only injected-dispatcher probe (3executed/0pass/3fail,EXIT1): hostCDNmessageclassifiedguestbyTUIbutnotheadlessandrendered; rawandmutabletypedSDKerrormarkerspresentinpoolwarningsandtakeTokenstormrejectionafter5mints. Log reports/t82-recovered-review-followup-red-20261110.log; probe `/home/AgentKit/overhaul-tools/t82-review-followup-probe-20261110.ts`. Cleanproductstillmatchesstaginge22c921. ActualfullTUIandthreeHTTPendpointregressionsnotexecutedbycontroller;reviewsourceclaimsremainqualified. GuesterrorSummarykindlabelalreadyallowlisted,notanunverifiednew-kindleakclaim. Keep82unmergedpendingerrorboundary/provenancerepair,tests,independentreview,newCI. Fullfindingbriefupdatedwithbothprovenances.

### 2026-11-10 — actual uncaught/rejection boundary counterexample

Follow-up controller probe /home/AgentKit/overhaul-tools/t82-real-error-boundary-probe-20261110.ts exercises12realownedsubprocesses through installGuestErrorBoundary:6uncaughtException/6unhandledRejection cases. Bun1.4.2/capped1G90s/isolatedHOME,EXIT1/1s,12executed/4controlPASS/8securityFAIL. Bothpathsleaksyntheticfunction/class/URLfragmentmarkersandoutput3512charlongselectedframes;ordinaryguestcontrolscontinuealiveandhostfaultcontrolsfatalexit1. Classificationstayscorrect;metadataoutputdoesnotmeetcontract. Log reports/t82-real-error-boundary-red-20261110.log:1-13. Cleanproductstillmatchesstaginge22c921; no realcredentials/network/productedits/modelcalls. ExistinggreenCIcannotapproveuncoveredprotection. Keep82unmergeduntilrepair/newboundaryregressions/review/freshCI.

### 2026-11-10 — verified metadata-boundary blocker despite green PR77

Controller ran an offline synthetic probe through the actual describeGuestError/hasGuestSourceFrame seam on clean t82HEAD883f566; wholeproduct diff versus testedstaging/82e22c921 (excluding.scratch) is empty. Probe /home/AgentKit/overhaul-tools/t82-metadata-boundary-probe-20261110.ts under cappedBun1.4.2/1G30s executed5cases:ordinaryguestcontrolPASS;guestfunctionname,classidentifierandURLfragmentmarkersstillappearFAIL;onehugechosenframeoutput3512charactersFAIL versus existingtested300bound. Summary1pass/4fail,exit1; reportst82-controller-metadata-boundary-red-20261110.log. No vendor request/credentialread/productedit occurred. This is verified arbitraryguesttext/output-bound failure, not evidence any realtokenleaked or originalissue32reproduced. Source guest-error.ts:106-117 permits guestidentifiernames and retains rawframeprefix/remainder. Keep82unmerged;require allowlistedhostbuiltmetadata/boundedsourceparseandrealuncaught/unhandledregressions without changingclassification/auth/retry/anti-abusebehavior. Full finding/nextwork /home/AgentKit/overhaul-tools/t82-metadata-boundary-finding-20261110.md. The completed workflow review's actual verdict remains unavailable to the controller; do not attribute this independently executed finding to that review or inferapprovalfromitsdone-status.

### 2026-11-09 — orchestration intake

Added at the user's request. Safe diagnostics and supported-runtime compatibility are actionable; the reported challenge compatibility cause is unverified and any challenge-pass-rate repair is outside this overhaul's B1 boundary. No live model request, claim, credential access or vendor challenge execution is authorized by this ticket. Existing three-agent investigation reports remain conversation evidence; consolidate verified facts in a durable report before implementation.

### 2026-11-09 — implementation (ticket/82-issue32-safe-diagnostics)

Branch `ticket/82-issue32-safe-diagnostics`, worktree `/home/AgentKit/wt/t82`, based on integration tip 655fb47. Scope kept to the four allowed items; no appVersion bump, no skip_model_request, no runtime discovery change, no challenge-pass-rate or identity change.

1. **Metadata-only bounded guest diagnostics** (`runtime/guest-error.ts`): `describeGuestError` no longer echoes guest message text or verbatim class names; it emits `Name [len=N sha256=…] (bundleFilename)` with query strings stripped from frame URLs, a plain-identifier name guard (else `Error`), and bounded output. Covers the headless boundary (`installGuestErrorBoundary`, uncaughtException + unhandledRejection), the solver-worker fatal path and the TUI warn line — all three consume the same renderer. Host-error path unchanged (full detail, exit 1); host/guest classification preserved (`hasGuestSourceFrame` untouched). Evidence: RED logs `reports/t82-red.log` (8 failures, synthetic secret marker shown verbatim in old output), GREEN `reports/t82-green1.log` (93 pass / 0 fail across the six touched files).
2. **3012 classification preserved** (`handler-issue32.test.ts` new): public-boundary pin (proxyRequest + mock fetch/captcha): HTTP 405 + `{"code":3012}` → exactly one mint, one upstream dispatch, `[3012] upstream authorization rejected`, never "captcha". Comment in handler.ts corrected (3012 is authorization, not "captcha/capability"). Test already held on the tip → proven by deliberate mutation below.
3. **Sanitized solver-failure provenance** (`proxy/captcha-token.ts` `CaptchaLocalVerificationError`, `captcha-happy.ts` `extractVerifyParam`, `captcha-pool.ts`): local verification refusals (too short / missing securityToken / not base64-JSON) previously collapsed into generic "captcha SDK failure" at `normalizeCaptchaError` (RED evidence `reports/t82-red3.log`: expected /too short/, received "captcha SDK failure"). Now typed, host-built detail only (literals + lengths), survives normalization, and the pool records the last failed mint (`recordMintFailure`, bounded 240 chars, control chars stripped) surfacing it on subsequent generic take failures — storm breaker and take deadline — as `(last local mint failure: …)` (RED `reports/t82-red2.log`). No payload content in any surfaced text (marker tests), no retry/auth/replay changes.
4. **Claim-preview missing-data fail-closed** (`server/routes-quota.ts`): a code-0 preview with missing/malformed `data.plans` now records `preview: provider_unknown` (mirroring the existing balance guard) instead of silently reading as a successful empty preview; genuinely empty `plans: []` stays a success. RED+GREEN in `reports/t82-red.log` / `t82-green1.log`.

Mutation proof for the already-green 3012 pin: committed implementation first, then mutated `upstream-errors.ts` (3012 message → "captcha verify failed") and restored from the commit; test failed under the mutant and passed after restore.

Unverified / left open (matches the ticket's limitations): no live inference recovery claim; the incident's real upstream cause (authorization vs content-inspection vs challenge compatibility — the three earlier reports disagree) remains unverified; requires the owner-only procedure in OWNER-ACTIONS.md. Not exercised here: real vendor SDK solve, Windows/CI legs, the compiled solver child (ticket 27 lifecycle untouched — error text only, coordinated by not touching spawn/recycle paths).

### 2026-11-09 — implementation complete (branch tip 6ff8595)

Commits on `ticket/82-issue32-safe-diagnostics` (base = integration tip 655fb47, contained by ancestry; tip unchanged during the run): `3b4a902` implementation + tests, `6ff8595` tsc typing fix.

RED→GREEN evidence (all offline, isolated HOME, capped, Bun 1.4.2):
- RED `reports/t82-red.log`: 10 fail / 34 pass — guest message and stack-URL synthetic secret `SYNTHETIC-SECRET-MARKER-7c41ab90` printed verbatim by the old boundary (uncaught AND unhandled child paths), quota preview missing-data silent success.
- RED `reports/t82-red2.log`: 2 fail — storm take and take-deadline rejections carried no mint-failure provenance ("captcha minting degraded (storm) — retry later", "captcha take deadline (1000ms)").
- RED `reports/t82-red3.log`: 2 fail — `normalizeCaptchaError` collapsed local verification refusals to "captcha SDK failure" (expected /too short/, /securityToken/).
- GREEN `reports/t82-green1.log`: 93 pass / 0 fail across the six touched files.
- Mutation proof for the already-green 3012 pin (`reports/t82-mutant.log`, `t82-mutant2.log`): mutating `upstream-errors.ts` (3012 → "captcha verify failed") fails the message assertions; mutating `captcha-retry.ts` markers (3012 as in-body challenge) fails `mints/upstreamCalls = 1` (received 2 — a captcha re-solve). Both restored from commit `3b4a902` (`git checkout <sha> -- <file>`), `git status` clean after each restore.
- Full suites after typing fix, integration tip 655fb47 contained: `npm run test` 1002 pass / 0 fail / 20 skip (`t82-full-kit4.log`); proxy `bun test` 1668 pass / 0 fail / 1 skip (`t82-full-proxy.log`); mcp `npm test` 115 pass / 0 fail / 1 skip (`t82-full-mcp.log`); proxy typecheck rc=0 (`t82-full-tc.log`; the first typecheck pass was a false pass from a wrong PATH — reproduced, fixed, re-run clean).

Boundaries honored: B1 — only error text, diagnostics and tests changed in captcha-*/handler files; detection, classification, retry, recycle and identity logic untouched (3012 stays TERMINAL + 403-authorization mapping). B2 — only synthetic markers, fixture secrets (`fixtureSecret`), no real credentials. B5/B6 — no dist changes, no version bumps. Coordination with 27/58: no solver lifecycle (spawn/recycle/cap) code touched, only refusal error construction and pool error surfacing.

Unverified (incident stays open): the real cause of the reporter's 405+3012 and whether the guest TypeErrors correlate — three earlier reports disagree; no live model request, claim or vendor challenge was run (out of scope by ticket). Owner-only verification remains in OWNER-ACTIONS.md.


### 2026-11-10 — rejected-review repair candidate (not ticket resolution)

Starting point: clean `883f566bf7a6e24f6faa96580ad1653955782498`, own branch/worktree only. Read the recovered independent `approved:false` review `/home/AgentKit/overhaul-tools/t82-completed-review-recovered-20261110.json:7-15` and full `/home/AgentKit/overhaul-tools/t82-metadata-boundary-finding-20261110.md:1-79`. The earlier “bounded/plain identifier” and “sanitized provenance” implementation claims above are superseded: those guards leaked guest-controlled function/class/fragment text and raw/mutable SDK messages. No new independent approval is claimed.

Confirmed causes and repairs:
- `runtime/guest-error.ts`: host error-class allowlist, bounded validated known bundle identifiers or opaque resource hashes; discard callbacks, arbitrary basenames, paths, queries, fragments and message-line sources. Keep message length and SHA256. `hasGuestSourceFrame` itself is unchanged. `isGuestOriginError` is now a strict compatibility alias; TUI explicitly uses `hasGuestSourceFrame`.
- `proxy/captcha-token.ts`: canonical host-built refusal/category text lives in a WeakMap outside mutable Error objects. Normalization rebuilds clean errors; a trusted class alone no longer authorizes message/stack/cause forwarding. Local refusal detail is allowlisted. Raw diagnostics retain only category/length/hash. Worker output and dispatcher error construction validate the text again, without changing the message protocol. The existing cleanup recycle predicate and its 4096-character worker window are preserved as a fixed sentence, not guest text.
- `proxy/captcha-pool.ts`: failure recording, per-attempt messages, parallel warnings and storm-probe warnings use host-built provenance/metadata. All retry counts, admission/storm/backoff/scheduling branches and token handling remain unchanged. No CAPTCHA shim, identity/signing/protocol change, vendor execution, claim call, account rotation or quota workaround.

Permanent regressions were added/run RED before their corresponding fixes, at approved seams 3/4 and existing formatter/process-log boundaries. New `*.test.ts` files are automatically wired by `zcode-proxy-src/package.json` (`bun test`) and root `test:proxy`; the HTTP fixture runs in a child to contain its solver-provider mock, uses port 0 and the real listener/router/pool. TUI regression executes real `runTui` and its installed uncaught handler with synthetic terminal capabilities, temp HOME and mocked empty credential source (no real store); no native PTY claim. Actual uncaughtException and unhandledRejection children cover function/class/fragment/filename/long-frame counterexamples and fatal-host controls. The worker fixture imports no vendor/happy-dom backend.

#### Commands executed in this repair ask

All Bun commands below use pinned Bun1.4.2 via the wrapper, 1G hard cap/no swap, isolated HOME. Logs are under `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/reports/`; the wrapper owns those report outputs. No integration product/state file was edited.

Original external probes, both before and after fixes (same unedited scripts):

```sh
for item in 'metadata-boundary 30' 'real-error-boundary 90' 'review-followup 60' 'http-provenance-boundary 90'; do
  set -- $item; name=$1; limit=$2
  BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh "t82-repair-candidate-external-$name" 1G "$limit" -- /home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin/bun "/home/AgentKit/overhaul-tools/t82-$name-probe-20261110.ts"
done
```

RED used name prefix `t82-repair-external-red-`: metadata5 executed/1pass/4fail, actual boundary12/4/8, classification+pool3/0/3, realHTTP12/6/6; all EXIT1. Final GREEN uses `t82-repair-candidate-external-`: metadata5/5/0 (`:6-7`), boundary12/12/0 (`:13-14`), followup3/3/0 (`:4-5`), HTTP12/12/0 (`:27-28`), all EXIT0. HTTP: 12 owned loopback requests, 9 synthetic upstream calls, 0 unexpected external fetches; wrong-key controls remain401, authorized solver failures503, exactly5 fixture mints/storm, two pool takes and one upstream call/request, no resend. Original probe's `productionEdits:false` label means the probe performs no edits, not that this repair has no product diff.

Permanent RED logs: `t82-repair-metadata-wired-red.log:338-342` 24pass/20fail includes three TUI fixture startup failures (port0 rejected by config), not three behavioral failures; corrected TUI fixture `t82-repair-tui-wired-red.log:34-38` 1pass/2 genuine failures. `t82-repair-provenance-wired-red.log:360-364` 34pass/5fail; `t82-repair-dispatcher-worker-wired-red.log:33-38` 0pass/2fail. Added cleanup-predicate preservation regression was RED (`t82-repair-cleanup-preservation-red.log:13-24`) before preserving its fixed signal. Intermediate `t82-repair-line-bound-red.log` was only an incorrect expected literal length (49 vs51), not a product failure; corrected expected51 without a production change. Intermediate runs are not reclassified as green.

Final targeted command (not full suite):

```sh
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-repair-candidate-targeted 1G 120 -- bash -c 'cd /home/AgentKit/wt/t82/zcode-proxy-src && printf "runner_pid=%s runner_pgid=%s\n" "$$" "$(ps -o pgid= -p $$)"; bun test src/runtime/guest-error.test.ts src/runtime/guest-error-boundary.test.ts src/tui/guest-error-boundary.test.ts src/proxy/captcha-token.test.ts src/proxy/captcha-pool.test.ts src/proxy/solver-transport.test.ts src/proxy/captcha-solver.test.ts src/proxy/handler-issue32.test.ts src/server/solver-error-http.test.ts src/server/routes-quota.test.ts'
```

Actual `t82-repair-candidate-targeted.log:225-229`: **125pass/0fail**,10files,9.38s,EXIT0. Includes 12 actual HTTP cases in the child fixture, actual TUI handler controls, actual uncaught/unhandled boundaries, worker/dispatcher sanitization, unchanged cleanup/deadline/category behavior, claim-preview missing-data fail-closed, and3012terminal **one initial mint/one upstream call/HTTP405 authorization rejection**. RunnerPID3503869/PGID3503868 recorded at:1; no owned scenario process remains after completion.

```sh
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-repair-candidate-typecheck 1G 60 -- bash -c 'cd /home/AgentKit/wt/t82/zcode-proxy-src && bun run typecheck'
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-repair-preservation 1G 60 -- bash -c 'cd /home/AgentKit/wt/t82/zcode-proxy-src && bun test src/proxy/captcha-happy.test.ts src/proxy/captcha-diagnostics.test.ts src/proxy/credential-recovery.test.ts --test-name-pattern "local verification refusals|provenance|metadata|incompatible|never recovers or duplicates after SSE output"'
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-repair-wiring2 1G 45 -- bash -c 'cd /home/AgentKit/wt/t82 && node --test tests/test-wiring.test.mjs'
git -C /home/AgentKit/wt/t82 diff --check
```

Typecheck EXIT0 (`:1-2`). Preservation12pass/0fail/80filtered (`:26-31`), including no retry/import after SSE output across all three route formats; not the full three files. Wiring guard Node26.7.0 **10pass/0fail** (`:11-19`), verifies `test:proxy` preload and CI wiring; earlier attempted `bun --use node --test` was an invalid CLI invocation and failed before tests (`t82-repair-wiring.log`), not a passing check. `diff --check` EXIT0. No install/build/full `test:all`/nativeWindows/macOS/compiled-solver/CI run in this ask; central validation owns fullsuite, independent review and fresh OS CI.

#### Separately OPEN under82: current-runtime discovery, not implemented here

Read integration's `.scratch/kit-overhaul/research/zcode-current-runtime-20261110.md:1-110` as supplied source/evidence, not as tests rerun in this ask. Source pinned at public commit a9fe401 and releasev3.17.2; agentpackage0.17.1 is a separate version domain. The note records server fixtures5/3/2 (default/custom `ZCODE_DATA_BASE_DIR` current.json not discovered; legacy/explicit/missing-explicit controls pass) and standalone fixtures4/2/2 (default/custom `ZCODE_DIST_HOME/current/agent/zcode.cjs` not discovered; explicit controls pass). These are Linux synthetic MCP health findings, not native/runtime/protocol success. No discovery/MCP source/dist change in this repair. Explicit override precedence, pointer containment/malformed metadata and multi-distribution selection require separate scoping/review plus permanent seam7 tests/native evidence. Do not merge moving integration here; the merger/controller will reconcile afterward.

Original GitHub#32 Windows405+3012 cause and correlation with guest TypeErrors remain OPEN; OA-4 owner-only re-observation remains necessary. No real inference recovery, challenge compatibility or latest official app-server protocol compatibility proved. Native Windows/macOS TUI/PTY and current-runtime discovery acceptance remain unverified. This commit is only a **candidate for central review/validation**, never entire82 resolved. Controller owns task-observer; no observation files written by this subagent.

### 2026-11-10 — reconcile the diagnostics security repair with SDK error semantics

Started clean at `362b099d7eedff25913b87b1e3c2af0dcfb1fe95`, own worktree/branch only. Loaded tdd and diagnosing-bugs and read their open observations without writing observation logs (controller-owned). Reused approved solver/listener seams3/4 and existing public normalization/formatter/process/TUI seams; no discovery implementation. Read actual original assertions before editing: `src/proxy/captcha-sdk-contract.test.ts:35-38` requires the incompatible subtype through the actual offline DOM callback; `src/proxy/captcha-diagnostics.test.ts:134-145` additionally required object identity after normalization. Read `git show 362b099d^:zcode-proxy-src/src/proxy/captcha-token.ts`: original normalization returned every SDK instance unchanged. The supplied central fullsuite log was READ, not rerun: `reports/gpt-grok-t82-full-20261110.log:3538-3547` records1695pass/1skip/2fail, exiting before proxy typecheck/MCP. Its two failures are genuine contract regressions, not obsolete tests.

**Cause and explicit contract.** Repair `362b099d` rebuilt every typed error as the base `CaptchaSdkError`. Fix commit `ccf333173f8c80cc64ce085d8c8d371af44ac21c` preserves the host-registered concrete subtype (`CaptchaSdkIncompatibleError` or `CaptchaLocalVerificationError`), category and canonical method-type/refusal text. It deliberately does **not** preserve object identity: normalization always constructs a clean Error with a fresh host stack and no copied cause, arbitrary own properties or serializers. Returning the original instance can retain hostile mutations/nonconfigurable properties even when its current message appears safe; in-place cleanup cannot safely guarantee both canonical diagnostics and identity for arbitrary mutable/frozen typed errors. The one identity assertion is therefore replaced with nonidentity plus concrete subtype, literal host-built method metadata, category, no-marker and no-cause assertions. The original SDK callback subtype test is unchanged byte-for-byte. No test was deleted or broadly relaxed.

Canonical kind/category/message now live together in a private WeakMap. Classification consumes registered category rather than a mutable public TypeScript `readonly` field; a forged prototype alone is not trusted. Re-normalization preserves semantic subtype/metadata without guest values. New hostile regression mutates message (including misleading rate-limit/F008 text), stack, name, cause, category, payload and a nonconfigurable `toJSON`; only canonical subtype/category/type metadata survive. A separate forged-prototype negative control fails closed. No SDK start/show selection, challenge behavior, retry/recycle scheduling, identity/signing, rotation or quota policy change.

#### Actual RED and GREEN commands in this ask

All commands use the wrapper below: hard1G/no swap, finite timeout, fresh isolated HOME, pinned Bun1.4.2. Wrapper-owned logs are in `/home/AgentKit/wt/overhaul/.scratch/kit-overhaul/reports/`; this worker did not edit integration files. Each test runner prints its actual root/PID/PGID and Bun version.

Exact original cases, before implementation or test changes:

```sh
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-sdk-contract-exact-red-20261110 1G 60 -- bash -c 'cd /home/AgentKit/wt/t82/zcode-proxy-src && printf "runner_root=%s runner_pid=%s runner_pgid=%s\n" "$PWD" "$$" "$(ps -o pgid= -p $$)"; bun --version; bun test src/proxy/captcha-sdk-contract.test.ts src/proxy/captcha-diagnostics.test.ts --test-name-pattern "rejects incompatible SDK instances with a trusted local category|rejects missing and noncallable methods with trusted diagnostics but no guest values"'
```

RED **0pass/2fail/17filtered**,2files,EXIT1/1s: `t82-sdk-contract-exact-red-20261110.log:9-38,40-73`. The actual failing assertions are subtype at SDK line37 and identity at diagnostics line143; this is not a test-discovery/infrastructure failure.

New hostile tests, written and executed before the fix:

```sh
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-sdk-hostile-red-20261110 1G 45 -- bash -c 'cd /home/AgentKit/wt/t82/zcode-proxy-src && printf "runner_root=%s runner_pid=%s runner_pgid=%s\n" "$PWD" "$$" "$(ps -o pgid= -p $$)"; bun --version; bun test src/proxy/captcha-token.test.ts --test-name-pattern "rebuilds a hostile mutable incompatible error|does not trust an incompatible prototype"'
```

RED **0pass/2fail/12filtered**,EXIT1: `t82-sdk-hostile-red-20261110.log:6-52`, wrong rebuilt subtype/mutable rate-limit category and trusted forged incompatible prototype. After the fix, the two original scenarios (with only the justified identity contract change) plus both hostile tests ran GREEN **4pass/0fail/29filtered**,3files,EXIT0: `t82-sdk-contract-exact-green-premerge-20261110.log:5-20`, using the original command with `src/proxy/captcha-token.test.ts` added and pattern `rejects incompatible SDK instances with a trusted local category|rejects missing and noncallable methods with trusted diagnostics but no guest values|rebuilds a hostile mutable incompatible error|does not trust an incompatible prototype`.

Complete requested targeted set, executed both before and after merging current integration:

```sh
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-sdk-contract-merged-targeted-green-20261110 1G 120 -- bash -c 'cd /home/AgentKit/wt/t82/zcode-proxy-src && printf "runner_root=%s runner_pid=%s runner_pgid=%s\n" "$PWD" "$$" "$(ps -o pgid= -p $$)"; bun --version; bun test src/proxy/captcha-sdk-contract.test.ts src/proxy/captcha-diagnostics.test.ts src/runtime/guest-error.test.ts src/runtime/guest-error-boundary.test.ts src/tui/guest-error-boundary.test.ts src/proxy/captcha-token.test.ts src/proxy/captcha-pool.test.ts src/proxy/solver-transport.test.ts src/proxy/captcha-solver.test.ts src/proxy/handler-issue32.test.ts src/server/solver-error-http.test.ts src/server/routes-quota.test.ts'
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-sdk-contract-merged-preservation-20261110 1G 60 -- bash -c 'cd /home/AgentKit/wt/t82/zcode-proxy-src && printf "runner_root=%s runner_pid=%s runner_pgid=%s\n" "$PWD" "$$" "$(ps -o pgid= -p $$)"; bun --version; bun test src/proxy/captcha-happy.test.ts src/proxy/captcha-diagnostics.test.ts src/proxy/credential-recovery.test.ts --test-name-pattern "local verification refusals|provenance|metadata|incompatible|never recovers or duplicates after SSE output"'
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-sdk-contract-merged-typecheck-20261110 1G 60 -- bash -c 'cd /home/AgentKit/wt/t82/zcode-proxy-src && printf "runner_root=%s runner_pid=%s runner_pgid=%s\n" "$PWD" "$$" "$(ps -o pgid= -p $$)"; bun --version; bun run typecheck'
BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh t82-sdk-contract-merged-wiring-20261110 1G 45 -- bash -c 'cd /home/AgentKit/wt/t82 && printf "runner_root=%s runner_pid=%s runner_pgid=%s\n" "$PWD" "$$" "$(ps -o pgid= -p $$)"; bun --version; node --version; node --test tests/test-wiring.test.mjs'
```

Actual merged candidate `421280856d395cbcbbe8968c37bda8fbe67944aa` results:
- `t82-sdk-contract-merged-targeted-green-20261110.log:252-256`: **146pass/0fail**,12files,8.64s,EXIT0. Before merge the same146tests passed (`t82-sdk-contract-targeted-green-20261110.log:252-256`). Includes SDK/metadata/pool/dispatcher/worker, real HTTP child/listener across all three routes and real TUI handler controls. At merged-log:11-12 claim-preview missing data fails closed while genuine empty plans succeed; :73 preserves HTTP405+3012 authorization and exactly one mint/one upstream call, no captcha re-solve; :248-250 strict guest/host TUI classification. Not a native PTY claim.
- `t82-sdk-contract-merged-preservation-20261110.log:28-33`: **12pass/0fail/80filtered**,3files,EXIT0, including local verification refusals and no retry/import after SSE output. This is a filtered preservation set, not the full three files.
- `t82-sdk-contract-merged-typecheck-20261110.log:1-4`: actual `tsc --noEmit -p tsconfig.json`,EXIT0; premerge typecheck alsoEXIT0.
- `t82-sdk-contract-merged-wiring-20261110.log:1-22`: Node26.7.0, **10pass/0fail/0skip**,EXIT0. No proxy/fullsuite substitute is claimed.

All four unchanged original external security probes reran on the merged tree:

```sh
for item in 'metadata-boundary 30' 'real-error-boundary 90' 'review-followup 60' 'http-provenance-boundary 90'; do
  set -- $item; name=$1; limit=$2
  BUN_DIR=/home/AgentKit/overhaul-tools/bun-1.4.2/node_modules/.bin bash /home/AgentKit/overhaul-tools/run-capped.sh "t82-sdk-contract-merged-rooted-external-$name-20261110" 1G "$limit" -- bash -c 'cd /home/AgentKit/wt/t82 && printf "runner_root=%s runner_pid=%s runner_pgid=%s\n" "$PWD" "$$" "$(ps -o pgid= -p $$)"; bun --version; bun "$1" & owned=$!; printf "owned_probe_pid=%s owned_probe_pgid=%s\n" "$owned" "$(ps -o pgid= -p "$owned")"; wait "$owned"' bash "/home/AgentKit/overhaul-tools/t82-$name-probe-20261110.ts" || exit $?
done
```

Rooted external logs with that prefix: metadata**5/5** (`:9-10`), actual uncaught/unhandled boundary**12/12** (`:16-17`), classification+pool**3/3** (`:7-8`), HTTP**12/12** (`:30-31`), all0fail/EXIT0. HTTP retains12ownedlocalrequests/9syntheticupstreamcalls/0unexpectedexternalfetches,401authcontrols,503solvererrors,5mints/storm,noresend,listenerClosed=true. Earlier same-ask `merged-external-` runs also passed but their shell cwd was the read-only owner checkout; imports were absolute ticket-worktree paths. They are not the rooted evidence quoted here. No vendor/model/claim call or real secret/account-store read occurred.

#### Integration and preservation

After targeted GREEN, merged **exact current integration `829202b32cde3a2285c2c3fc39a5fc0394f1b50b`**, via `gitc.sh merge --no-ff --no-commit` and `gitc.sh commit`, into the own branch as `421280856d395cbcbbe8968c37bda8fbe67944aa` (parents `ccf3331` / `829202b`). Sole conflict: OWNER-ACTIONS additions; retained entire OA1-4 from own parent plus entire OA5 from integration, verified by exact parent-text comparison. Automatic82merge retains both complete parent comment bodies, also verified exactly. All other integration `.scratch` files, including accepted40resolution/INDEX/STATE/RUNLOG/DECISIONS/research, byte-identical to829202b. No other worktree was edited, no push.

Executed preservation commands, all empty/EXIT0:

```sh
git -C /home/AgentKit/wt/t82 merge-base --is-ancestor 829202b HEAD
git -C /home/AgentKit/wt/t82 diff --exit-code 829202b HEAD -- .scratch ':!.scratch/kit-overhaul/OWNER-ACTIONS.md' ':!.scratch/kit-overhaul/issues/82-github-32-safe-failure-diagnostics-and-zcode-compatibility.md'
git -C /home/AgentKit/wt/t82 diff --exit-code 829202b HEAD -- mcp/zcode-harness-mcp
git -C /home/AgentKit/wt/t82 diff --check 829202b..HEAD
```

Also executed `git diff --exit-code 829202b HEAD -- <909 actual ticket40 product paths from git diff --name-only deadcbc^2 deadcbc -- . ':!.scratch'>`: all909filesbyte-identical, ticket40staysresolved. SDK callback test, SDK method selection, retry/signing/identity/session/rotator files are unchanged from integration. A separate check of the imported integration delta `git diff --check ccf3331..HEAD -- . ':!.scratch'` reports the pre-existing accepted40snapshot whitespace/EOF diagnostics; no accepted snapshot or product cleanup was performed. Own delta check against829202b is clean. Fresh `ps -eo pid=,ppid=,pgid=,comm=` comparison against all17recorded SDK-check/probe process groups (including the hostile RED run) found0activeprocesses; no process was killed.

**Next gate only:** central controller runs full `npm run test:all` and required MCP build/dist checks; this worker did NOT rerun fullsuite, install, build, soak, nativeWindows/macOS or CI. Independent review/freshCI remain pending. Remaining82gaps unchanged: server and standalone default/custom discovery failures plus precedence/containment/malformed-pointer/multiple-install decisions and permanent seam7/native tests (`research/zcode-current-runtime-20261110.md:104-110`, read, not rerun); official app-server/protocol/runtime compatibility; original Windows405+3012cause/recovery and correlation with guestTypeErrors; OA-4 owner-only re-observation. No blanket82resolution, no release/version/tag/mainmerge or challenge-pass claim. Task-observer: none logged by this worker because the controller owns it.
