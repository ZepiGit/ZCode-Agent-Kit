# Automatic Account Rotator
**English (original)** · [Deutsch](ACCOUNT_ROTATOR.de.md)

The optional Account Rotator keeps authorized sign-ins as separate accounts.
While it is enabled, a successful new sign-in is saved as another account. For
supported requests, the Kit may try another saved account if the selected one
cannot continue. A retry is not guaranteed to succeed.

The feature does not create accounts, reset quotas, or bypass provider rules.
Importing a login does not grant a new quota. Use only accounts you are
authorized to access.

## Enable or disable

The feature is off by default. Setup asks:

> Do you want to activate the Account Rotator feature? [y/n]

Choose `y` to enable it and keep sign-ins already available to the Kit. Choose
`n` to leave it off; you can enable it later:

```sh
zcode-kit accounts enable
zcode-kit accounts disable
```

## Add and manage accounts

Sign in again to add another account. You can also import the login already
used by ZCode Desktop:

```sh
zcode-kit auth login zai
zcode-kit auth login zai --import
zcode-kit accounts
```

Import reads the current shared Desktop credentials, not a newly created
account. With Desktop 0.16.9, the encrypted `credentials.json` is authoritative
when present. Only its absence allows fallback to the older `config.json`;
corruption, a wrong decryption secret, or an unsupported active provider produces
an error instead of silently importing an older login. The importer reads the
current active `zai`/`start-plan` login and requires an explicitly configured
plan for `start-plan`. For `coding-plan`, use the normal OAuth login above:
the read-only Desktop importer does not resolve or create API keys. It does not
modify Desktop's shared credentials.

The account list shows the IDs used by these management commands:

```sh
zcode-kit accounts pause <ID>
zcode-kit accounts resume <ID>
zcode-kit accounts remove <ID>
```

If no eligible saved account is available, the Kit does not switch to an
unrelated or unauthorized account; the request may fail.

## Signing in again

A sign-in carrying the same OAuth user ID updates the existing account in place
(new tokens; label, pause, and cooldown are kept). Reimporting identical
credentials is also idempotent. Provider and plan boundaries remain separate.

Desktop imports may lack a verified user ID. A matching decoded JWT subject
then identifies a possible duplicate, not permission to overwrite a credential.
If the tokens changed, the command refuses both silent replacement and duplicate
insertion, naming the existing account. Select it explicitly when intended:
`zcode-kit auth login zai --import --account ID --replace` (omit `--import` for
OAuth). The subject is never promoted into the upstream `userId` field.

`--account ID` always stores under the ID you chose, even if that user is
already saved under another ID. The login then prints a note naming the other
ID, and `zcode-kit accounts doctor` reports `same_identity_accounts`. Such an
alias shares the user's quota and adds no capacity, but the rotator still
treats it as a separate entry (and may try it after the original); remove it with
`zcode-kit accounts remove <ID> --yes`.

## Account health

```sh
zcode-kit accounts health
zcode-kit accounts health --json
```

Shows one line per account: verdict, runtime state, remaining/total per quota
package with percentage and reset time, when it was last used, and `*` for the
active account, followed by `usable: N of M` and pool totals. It needs the
running proxy; otherwise every account is `unknown` and the command tells you
to run `zcode-kit proxy start`. Exit code 0 means at least one account is `ok`
or `low`; 1 means none is usable right now or live data is unavailable.

Verdicts, in order of precedence:

| Verdict | Meaning |
| --- | --- |
| `paused` | Paused by you or by the policy. |
| `blocked` | Excluded by provider, plan, or allowlist policy. |
| `expired` / `invalid` | Login expired or unusable with the current configuration. |
| `auth_error` | The billing service rejected the login (401/3012); sign in again. |
| `exhausted` | In cooldown after a quota error, until the shown time. |
| `duplicate` | Equal verified OAuth identity or identical credentials in the eligible set; quota is queried and summed once. A decoded JWT subject alone never suppresses a probe. |
| `no_quota_data` | The service answered but reported no quota packages for this account right now. Not a confirmed healthy state. |
| `empty` | Every quota package is used up. |
| `low` | At least one package has less than 10% left. |
| `ok` | Usable with quota left. |
| `unknown` | No complete live answer for this account (proxy down, a quota query failed, or a package reported incomplete numbers). Never counted as usable. |

JSON includes `probeSource` for each account (`live`, `duplicate`, `error`, or
`not_probed`). Paused or policy-excluded accounts remain visible but are not
probed; their absence from the billing response is not interpreted as zero quota.

Cost: one run makes up to 2 billing requests (balance and preview) per unique
account, cached for 15 seconds. It sends no model request, solves no captcha,
and does not refresh tokens.
