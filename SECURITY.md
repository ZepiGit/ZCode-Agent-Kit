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
- The optional Account Rotator stores separate encrypted copies of logins you
  already control. Use only accounts you are authorized to access. It does not
  create accounts or bypass provider limits.
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
