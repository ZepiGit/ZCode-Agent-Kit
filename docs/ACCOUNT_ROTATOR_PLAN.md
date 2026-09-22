# Automatic Account Rotator – implementation plan

## Goal and scope

Add an opt-in pool of user-owned ZCode accounts to the proxy shipped by ZCode-Agent-Kit. A request starts with one selected account and may be retried once with another configured account when the upstream explicitly reports that the selected account's free/start-plan/Builder Week token balance is exhausted. The feature must not create accounts, claim trials, bypass authentication, bypass quotas, or fall back to paid/API credentials without an explicit configured account.

The existing single-account credential store and commands remain valid. Users can add several accounts through repeated OAuth or read-only Desktop imports, give every account a stable local id, inspect a redacted account overview, and remove one account without touching the others.

## Current architecture constraints

- `AuthManager` is the one request-time credential seam shared by chat, Anthropic messages, Responses, and async routes.
- The credential store is AES-GCM encrypted and atomically written. New pool data must use the same key derivation and permissions.
- `recoverAndMapUpstream` is the common pre-output recovery point. SSE responses are never replayed after bytes are available.
- `/quota` selects one credential from the active pool, partitions its short cache by account id, and reports that account's billing snapshot. It does not aggregate all profiles. Account listing remains a separate bounded, redacted offline view and must not perform billing calls.
- The local proxy remains loopback-only and bearer-authenticated.

## Data model and persistence

1. Add `AccountProfile` with:
   - `id`: stable user-selected identifier (`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`),
   - `credential`: existing provider/apiKey/secret/jwt/userId/expiresAt shape,
   - optional `label`, `createdAt`, `lastUsedAt`, `lastFailureAt`, `exhaustedUntil`, `lastFailureReason`.
2. Add an encrypted multi-account store at `~/.zcode-proxy/accounts.json`, overridable with `ZCODE_PROXY_ACCOUNTS_PATH`. The plaintext payload is an array of profiles; the file contains only `{encrypted}` and is written with mode `0600` through the existing atomic-write path.
3. Keep `credentials.json` as the compatibility primary. If no pool is configured, behavior is unchanged. `auth login <provider> --account ID` writes only the pool profile; a duplicate id is rejected unless `--replace` is explicit. An unqualified login keeps writing the legacy primary. The implemented read-only Desktop import uses `auth login <provider> --import --account ID`; there is no separate `auth accounts import` command. It does not log out or change Desktop state.
4. Pool mutations use an exclusive lock sidecar and fail closed on a live/unreadable lock. Duplicate ids are rejected unless `--replace` is explicit. Corrupt or undecryptable pool data is reported as unavailable and never treated as an empty authenticated pool.

## Selection and rotation semantics

- `AccountRotator` owns an immutable snapshot of profiles plus in-memory scheduling state. Selection is sticky and sequential: keep the active usable account for successive requests, then advance deterministically to the next usable account only after an explicit quota signal. Skip expired, quarantined, provider-mismatched, or plan-incompatible profiles.
- Every request snapshots the selected `AccountHandle` before building upstream headers. The handle remains fixed for the request and its stream.
- A response is eligible for rotation only when it is non-streaming / before output and its body contains one of the explicit account-balance codes `1005` (quota exhausted), `1113` (insufficient balance), or `3001` (account balance/request rejected). HTTP-200 envelopes are inspected as well as non-2xx responses. Generic 401/403/429/5xx, captcha errors, transport errors, model errors, and 3012 authentication failures do not rotate accounts.
- On an eligible failure, mark the selected profile unavailable until the reported reset time when available, otherwise for a bounded cooldown. Singleflight ensures concurrent failures for one account do not create a retry storm. Retry at most once with the next usable account. If all profiles are unavailable, return the original mapped error.
- A successful response clears the transient failure marker for the account. No mid-stream rotation or replay is attempted; in-stream errors are passed through.
- The same account-selection/retry seam is used by `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, and synchronous credential resolution for async routes. Off-peak ticket operations remain bound to the account selected for that request.
- Async ticket expiry may still use the existing ticket bridge retry policy, but it is not an account-rotation signal and does not replay a model stream after output has begun.

## CLI and user-visible behavior

- Proxy CLI: `zcode-proxy auth login <provider> --account ID [--import|--paste]`, `zcode-proxy auth accounts [--json]`, `zcode-proxy auth accounts remove ID [--yes]`.
- Kit wrapper: `zcode-kit accounts [--json]` and `zcode-kit accounts remove ID [--yes]`; `zcode-kit auth login` remains the legacy single-account path.
- The overview is offline by default and prints id, provider, plan compatibility, masked credential preview, state (`ready`, `active`, `exhausted`, `expired`, `invalid`), last-used/failure timestamps, and cooldown/reset metadata. JSON uses the same redacted fields. It never prints API keys, JWTs, OAuth codes, prompt bodies, or provider error text.
- Account commands do not start the proxy and make no quota-consuming inference requests. Optional quota refresh is explicitly separate from the overview.

## Configuration and compatibility

- Add an `accounts` block under `auth` with `enabled` (default `false`) and optional `path`; environment overrides are `ZCODE_ACCOUNTS_ENABLED` and `ZCODE_PROXY_ACCOUNTS_PATH`.
- When enabled and at least one usable profile exists, startup initializes the pool. With the pool disabled, the existing single credential path is used. An enabled-but-empty or enabled-but-corrupt pool fails closed; it never silently reverts to `credentials.json`.
- Existing Android/TUI startup paths use the same factory and therefore share rotation behavior. The TUI login action is guarded while a pool is active and directs the user to `auth login --account ID`; it does not select or overwrite a pool profile itself.
- `/quota` uses the currently selected compatible pool credential and an account-partitioned cache. It is not an aggregate pool report.

## Konkrete Abweichungen vom ursprünglichen Entwurf

- Es gibt keinen separaten Befehl `auth accounts import`. Der Desktop-Import ist `auth login <provider> --import --account ID`.
- Ein aktivierter leerer Pool beendet den Start mit „no usable configured account“ und fällt nicht auf den Legacy-Store zurück.
- Der TUI-Login ist bei aktivem Pool geschützt und nimmt keine Auswahl oder Überschreibung eines Pool-Profils vor; die benannte CLI-Anmeldung ist der vorgesehene Weg.
- `/quota` verwendet ein ausgewähltes kompatibles Pool-Konto und einen nach Konto-ID getrennten Cache. Die Antwort ist eine Konten-Momentaufnahme, keine Pool-Summe.
- Async-Ticket-Retries gehören weiterhin zur bestehenden Off-Peak-Bridge. Ein abgelaufenes Ticket löst keine Account-Rotation aus; nach begonnener Stream-Ausgabe gibt es keine Replay-Rotation.

## Verification gates

- Unit tests cover encrypted round trips, permissions, duplicate/removal validation, deterministic selection, cooldown reset, concurrent exhaustion singleflight, and secret redaction.
- Handler tests cover code 1005/1113/3001, HTTP-200 envelopes, one retry with the second credential, all-exhausted behavior, non-rotation for 3012/429/5xx, and no SSE replay after output. Test both coding-plan API-key and start-plan JWT credentials.
- CLI tests cover text/JSON account listing, empty/corrupt stores, masked output, and targeted removal.
- Run root `npm test`, proxy `bun test`, MCP tests, and the proxy compile build. No live account or quota is used by tests.
