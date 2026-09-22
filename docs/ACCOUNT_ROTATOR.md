# Automatic Account Rotator
**English (original)** · [Deutsch](ACCOUNT_ROTATOR.de.md)

The optional Account Rotator keeps authorized sign-ins as separate accounts.
While it is enabled, a successful new sign-in is saved as another account. For
supported requests, the Kit may try another saved account if the selected one
cannot continue. A retry is not guaranteed to succeed.

The feature does not create accounts or bypass provider rules. Use only
accounts you are authorized to access.

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

The account list shows the IDs used by these management commands:

```sh
zcode-kit accounts pause <ID>
zcode-kit accounts resume <ID>
zcode-kit accounts remove <ID>
```

If no eligible saved account is available, the Kit does not switch to an
unrelated or unauthorized account; the request may fail.
