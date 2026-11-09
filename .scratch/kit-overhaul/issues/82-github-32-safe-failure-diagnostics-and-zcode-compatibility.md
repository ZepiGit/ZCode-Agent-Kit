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
