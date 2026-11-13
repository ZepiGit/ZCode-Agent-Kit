# Security Policy
**English (original)** · [Deutsch](SECURITY.de.md)

This policy describes the intended security boundaries of ZCode Agent Kit and
its bundled integrations. It is not a security certification.

## Security boundaries

- The proxy and MCP bridge are designed for a trusted local user. Keep them on
  loopback and do not expose them to a LAN or the public internet. The proxy
  refuses to start on an address that is not loopback or without a real key.
  A bearer key limits API access; it does not provide a sandbox or multi-user
  isolation.
- Some provider challenge flows can execute provider-supplied JavaScript
  without an operating-system sandbox. Treat that code as untrusted. Loopback
  binding and bearer authentication do not isolate it.
- The CAPTCHA solver runs in a process of its own, started by the proxy, with
  a memory cap (300 MB by default). A stuck or oversized solve does not block
  or grow the proxy, and the solver process can be ended and replaced. Its
  environment does not contain the proxy's stop token, credential secrets or
  API key. It is not an operating-system sandbox and adds no permission
  boundary: the solver process runs as the same user, with the same access to
  files and the network as the proxy.
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

## Stopping and restarting the proxy

The kit manager stops only a proxy it can prove is its own: the process on the
configured port answers an authenticated health request as this installation's
proxy, its pid is the recorded one, and its start time matches the one recorded
at start. Anything else is reported and left running.

- **Stop request.** `zcode-kit proxy stop`, `proxy restart` and `update` first
  send `POST /__kit/stop` to the proxy's loopback listener. The request needs the
  proxy key and a stop token. The token is created for each start and kept in
  the pid record (`logs/proxy.pid`); it is not written to any assistant's
  configuration. A proxy that was not started by the manager has no stop token
  and does not offer this request.
- **Drain.** A proxy that accepts the request answers new requests with HTTP
  503 and a `Retry-After` header, gives requests already running up to 6
  seconds to finish, cuts those that are still open, saves account metadata and
  exits. Its own deadline for all of this is 10 seconds.
- **Forced stop.** The manager ends the process itself only when it is still
  alive 2 seconds after that deadline, or when the proxy refused the request
  or does not know it. Ownership is checked again right before each signal.
- **Proxy that does not answer.** A recorded proxy that no longer answers
  health checks is ended only when all of this holds: it is past the 60-second
  startup grace, its start time and command line match this installation's
  proxy, and three health checks in a row get no answer.
- **Automatic restarts.** The proxy asks the manager for a fresh start in two
  cases. When its main thread has not run for 45 seconds, it asks and then ends
  itself. When its memory stays above 1024 MB for three samples 15 seconds
  apart, it asks and drains only after the manager has accepted the restart;
  if the manager refuses, the proxy keeps serving. Memory above 512 MB for
  three samples only writes a warning to the log. The manager accepts at most
  3 such restarts within 15 minutes. If it refuses one after the proxy has
  ended itself, no proxy runs until the next start. The memory limits are
  `health.memory` in `proxy/config.yaml`.
- **Start lock.** A start writes a lock file (`logs/manager.lock`) and removes
  it when it ends, also when it is ended with Ctrl-C. A lock left behind is
  taken over only when the manager can prove its holder is gone: the holder's
  process is dead, or its pid now belongs to a process that started later. The
  lock of a live holder, or of one that cannot be checked, is never touched. A
  lock file that cannot be read, or that a newer kit wrote, is left in place
  and reported with its path.
- **Overload.** The proxy holds at most 64 MiB of request bodies at a time
  (`server.admission.maxInFlightMB`). Further requests wait, at most 64 of
  them and each for up to 15 seconds, and are then answered with HTTP 503 and
  `Retry-After`.

Requests cut off by a stop or restart are not resumed; the client has to send
them again.

### Process recovery limits

Windows recovery opens an OS process handle and compares that handle's creation
time before terminating it; it does not terminate an unrelated PID-selected
descendant tree. Other platforms recheck the recorded identity immediately
before signalling a numeric PID; that does not provide a kernel-atomic pidfd
guarantee. Instances that an old kit started with a relative script path
cannot prove their installation path on Windows and macOS and are left for
explicit operator inspection. Newly started instances use an absolute script
path.

## Logs

The running proxy writes `logs/proxy.log` through one writer, which checks the
file size before each write, rotates the file at 5 MB and keeps one older
file, `proxy.log.1`. The manager appends its own lines to the same file and
rotates it only during a start, when no proxy runs. On macOS and Linux
the logs directory is created with mode `0700` and the log files and the pid
record with mode `0600`. These modes have no effect on Windows, where access
follows the permissions of the folder. The proxy key, the stop token, and
strings shaped like bearer tokens, JWTs or API keys are replaced with
`<redacted>` in log lines. The redaction works on patterns, so check a log
before you share it.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature from this
repository's **Security** tab when it is available. Otherwise, contact the
maintainers privately through GitHub. Do not publish vulnerability details,
credentials, or sensitive reproduction data in a public issue.

Include the affected release, operating system, component, impact, and the
smallest safe reproduction you can provide. Maintainers will review the report
and coordinate next steps; no response time is guaranteed.
