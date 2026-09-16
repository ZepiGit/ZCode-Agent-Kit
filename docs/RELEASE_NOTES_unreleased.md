# Unreleased — source changes under verification

This is a working-tree summary, **not a published release**. Final suite totals,
final Fable review approval and release readiness are pending. The user's existing
personal installation has not been repaired by these source changes.

## Changes

- **Continue compatibility:** accept empty `models: []` with supported whitespace
  and comments; preserve existing model/default order, indentation (including
  indentless lists), and idempotent managed updates. Refuse duplicate keys and
  unsupported inline forms without writing the Continue file. Store a quoted
  local proxy key in the managed user config instead of the nonfunctional
  `${ZCODE_PROXY_KEY}` placeholder; check key/config drift without logging keys.
  Continue is unavailable in the validation environment, so actual client/live
  validation remains **blocked**, distinct from parser/integration fixtures.
- **Explicit repair:** `doctor --fix` reapplies selected adapters under the setup
  lock. Key alignment requires an unambiguous kit-template config and an exclusively
  reservable offline port; no listener is killed or taken over. Checkout write
  consent remains required. Failed repair rolls back recorded file edits.
- **Shared launch preflight:** safe local start/identity verification followed by
  one bounded quota check. Upstream auth/balance diagnostics warn and continue so
  model-request credential recovery can run; local identity/start failures block
  wrappers. OMP caches lightweight local health for 60 seconds and cools down
  failed starts, rather than repeatedly polling upstream quota.
- **Setup smoke:** normal setup attempts one minimal live Flash request, which may
  consume quota. CI/test modes and `ZCODE_KIT_SKIP_SMOKE=1` skip it. Failure reports
  an error without undoing integrations already saved.
- **Credential recovery:** request-time reload distinguishes missing/logout state
  from malformed or partial store data. Selected non-streaming auth/balance errors
  can trigger one existing-Desktop reimport and one resend only when the effective
  credential changes. Concurrent recovery is shared and bounded by credential and
  Desktop source revision. Refreshed credentials persist encrypted only if the
  observed proxy store is unchanged; Desktop files are not rewritten. No automatic
  browser login, key creation, trial claim or SSE/in-stream replay. Recovery caps
  failed-credential/source-revision pairs at 128 per process. Persistence has no
  cross-process lock and retains a narrow competing-writer race; it is not a
  general atomic CAS guarantee. Final combined verification remains pending;
  implementation alone is not a live recovery test.
- **npm postinstall:** honor the hint-only branch. npm installation prints the
  explicit `zcode-kit setup` command instead of launching setup or modifying user
  harnesses. This describes corrected source, not previously published packages.

## Limits and release gates

`setup` / `integrate` can retain successful partial steps and record an explicit
rollback command. This is different from repair's rollback-on-failure behavior.
Credentials, local key creation, dependency installation and external CLI side
effects are not globally rollbackable.

The existing release workflow triggers on main pushes, version tags and dispatch.
Non-tag runs reuse the current version only when npm reports it missing and the
remote tag is absent or resolves to exact HEAD. Otherwise they select the next
patch absent from npm and remote tags, checking at most 100 candidates. Dispatch
is a same-version retry only under those exact conditions; missing npm does not
permit reusing another commit's GitHub assets. Existing assets are not replaced. OIDC/marker/payload checks and successful publication
must be verified independently.

Release hardening includes the existing-bun installer checksum-helper path,
required license/marker payload inclusion, tracked-only CI builds, pinned npm
11.19.1, fail-closed exact registry lookup and bounded post-publish version
visibility checks. Final acceptance remains pending; a registry version check
alone does not verify downloaded artifact contents.

The upstream README's MIT declaration is verified, but a standalone upstream
LICENSE/copyright-notice file was not found. Redistribution/notice review remains
an explicit unresolved release gate; this note is not publishing permission. See
`RELEASE_CHECKLIST.md` before any release-triggering action.

Baseline before these changes: **65 kit / 872 proxy / 42 MCP**. The baseline MCP
`wmic` kill path did not execute; do not infer that coverage from the baseline
count. Final dated results belong in `../TEST_REPORT.md`. Source inspection,
fixture checks, actual live model requests and published artifacts remain separate
evidence; historical live results do not validate this candidate.
