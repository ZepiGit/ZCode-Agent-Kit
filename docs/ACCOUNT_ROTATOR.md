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
