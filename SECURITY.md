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
- The CAPTCHA solver runs on a dedicated worker thread inside the proxy
  process. This is responsiveness and lifecycle isolation only: a stuck solve
  no longer blocks the proxy, and the worker can be ended at a deadline and
  recycled. It is not an operating-system sandbox and adds no new permission
  boundary; the worker has the same user, file-system, network, and credential
  access as the proxy.
- The kit manager terminates a non-answering proxy only when it proves it is
  its own (past a 60-second startup grace, recorded start time and kit command
  line match, repeated consecutive health checks fail). A process of unknown
  ownership is never killed. Automatic restarts requested by the proxy's
  watchdog or memory guard are limited to 3 per 15 minutes, and a leftover
  start lock is never taken over automatically. Every stop or restart
  interrupts connected clients.
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

### Process recovery limits

Windows recovery opens an OS process handle and compares that handle's creation
time before terminating it; it does not terminate an unrelated PID-selected
descendant tree. Other platforms currently recheck recorded identity immediately
before signalling a numeric PID; that does not provide a kernel-atomic pidfd
guarantee. Legacy Windows instances started with a relative script path cannot
prove their installation path through CIM and are left for explicit operator
inspection. Newly started instances use an absolute script path.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature from this
repository's **Security** tab when it is available. Otherwise, contact the
maintainers privately through GitHub. Do not publish vulnerability details,
credentials, or sensitive reproduction data in a public issue.

Include the affected release, operating system, component, impact, and the
smallest safe reproduction you can provide. Maintainers will review the report
and coordinate next steps; no response time is guaranteed.
