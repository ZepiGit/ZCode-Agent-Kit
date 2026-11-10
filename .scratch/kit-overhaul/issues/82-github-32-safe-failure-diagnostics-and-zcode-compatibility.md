# 82: GitHub issue #32: safe failure diagnostics and latest-ZCode compatibility evidence

**Blocked by:** — (coordinate with 27 and 58 before changing solver lifecycle files)

**Status:** needs-triage

Model: sol
Risk: high (authorization failures, sensitive diagnostic data, anti-abuse boundary)
ADR: no (any proposed protocol change requires separate boundary review)

**Source:** https://github.com/ZepiGit/ZCode-Agent-Kit/issues/32 . This is GitHub issue 32, not local overhaul ticket 32 (TUI log pane caps, already merged).

**User requirement:** Include the issue's fix in the overhaul task list and aim for compatibility with the newest official ZCode. The latest release verified through GitHub's release API on 2026-11-09 is v3.17.2, published 2026-11-04, target commit a9fe401eede6e6e5e01be9048679c206fe6f02d9: https://github.com/zai-org/ZCode/releases/tag/v3.17.2 . Recheck this at implementation/verification time.

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
