# Security Policy
**English (original)** · [Deutsch](SECURITY.de.md)

This policy describes the intended security boundaries of ZCode Agent Kit and
its bundled integrations. It is not a security certification.

## Security boundaries

- The proxy and MCP bridge are designed for a trusted local user. Keep them on
  loopback and do not expose them to a LAN or the public internet. A bearer key
  limits API access; it does not provide a sandbox or multi-user isolation.
- Some provider challenge flows can execute provider-supplied JavaScript
  without an operating-system sandbox. Treat that code as untrusted. Loopback
  binding and bearer authentication do not isolate it.
- Local configuration, credentials, keys, logs, and backups may contain
  sensitive data. Restrict access and remove secrets before sharing them.
  CAPTCHA debug diagnostics are metadata-only. The old bytecode-VM diagnostic
  rewrite (`PE_PATCH`) was removed after reproduced bundle corruption, and
  sensitive DBT argument dumps (`CAPTCHA_DUMP_DBT`) were removed; do not enable
  those switches. The solver and its security gates remain. Per-artifact
  provenance and loaded-byte hashes are diagnostics, not a sandbox or proof
  that vendor code is safe. The static compatibility helper only reads saved
  scripts; it does not execute them or prove end-to-end challenge success.
- Desktop import reads the current shared login. If Desktop 0.16.9's
  `credentials.json` exists, it is authoritative; the legacy `config.json` is
  used only when it is absent, not when decryption or provider validation fails.
  Import is read-only with respect to Desktop credentials and does not
  resolve/create API keys. An active `zai`/`start-plan` import requires an
  explicitly configured plan for `start-plan`; `coding-plan` uses normal OAuth instead.
- The optional Account Rotator stores separate encrypted copies of logins you
  already control. Use only accounts you are authorized to access. It does not
  create accounts, reset quotas, or bypass provider limits.
- Integrations run local assistant tools with the permissions of the current
  operating-system user. Review installer and setup actions before running
  them in environments with stricter security requirements.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature from this
repository's **Security** tab when it is available. Otherwise, contact the
maintainers privately through GitHub. Do not publish vulnerability details,
credentials, or sensitive reproduction data in a public issue.

Include the affected release, operating system, component, impact, and the
smallest safe reproduction you can provide. Maintainers will review the report
and coordinate next steps; no response time is guaranteed.
