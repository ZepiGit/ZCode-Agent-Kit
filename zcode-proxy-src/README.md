# ZCode Proxy
**English (original)** · [Deutsch](README.de.md) · [Español](README.es.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

This component provides the local model proxy bundled with ZCode Agent Kit.
The Kit manages its setup and integration with assistant tools.

## Use with ZCode Agent Kit

Use the Kit's setup and model commands described in the [main README](../README.md).
The bundled source version and local changes are listed in the
[component manifest](../MANIFEST.md).

`zcode-kit auth login zai --import` reads the current shared Desktop login.
Desktop 0.16.9's `credentials.json` is authoritative when present; only its
absence permits the legacy `config.json` fallback. Invalid credentials, a wrong
secret, or an unsupported active provider do not silently fall back. Importing
an active `zai`/`start-plan` login requires an explicitly configured plan for
`start-plan`; `coding-plan` uses normal OAuth instead. Import does not create accounts, reset
quotas, or resolve/create API keys. See [account management](../docs/ACCOUNT_ROTATOR.md).

The in-process solver runs one CAPTCHA window at a time. It warms one token
and grows its bank only with demand, up to four tokens; legacy parallel sizing
values are capped to this capacity. Provider rate limits still pause solving;
queued work, cache invalidation and diagnostic hashes cannot bypass that pause.

`CAPTCHA_CDN_CACHE_TTL_MS` controls both memory and disk CDN caches: the default
is `86400000` ms (24 hours), and only integers from `0` through `2147483647`
are accepted. Invalid values fail; `0` disables reads and writes in both tiers.
`CAPTCHA_CDN_CACHE_DIR` selects an isolated cache directory. The managed proxy
passes both environment controls to its child. Disk writes use an atomic
envelope; old entries without fetch timestamps and truncated entries are
rejected. Promotion to memory preserves the original fetch age.

Diagnostics capture provenance atomically for each loaded artifact, with
per-window SHA-256 hashes of the bytes actually loaded; unknown provenance is
reported explicitly. `Last-Modified` does not establish historical byte identity.
For a static inspection of a saved vendor script, use the installed helper:

```sh
node <installation>/zcode-proxy-src/captcha-compatibility.mjs <saved-script> [retrieval-epoch-ms]
```

Supply the known retrieval time as epoch milliseconds when available. The
helper only reads the file and reports hashes and compatibility markers: it
does not execute the script or establish end-to-end CAPTCHA success. The old
bytecode-VM diagnostic rewrite (`PE_PATCH`) was removed after reproduced bundle
corruption, and sensitive DBT argument dumps (`CAPTCHA_DUMP_DBT`) were removed.
Do not use those switches. The solver, its security gates, and the callable
`show` alternative remain; debug diagnostics are metadata-only.

The local repair decodes gzip, deflate, and Brotli before interpreting translated streams or JSON error envelopes. Empty or undecodable batch bodies are reported as `upstream_invalid_response`, not successful empty answers. The proxy does not substitute its daemon directory for the calling harness workspace; `ZCODE_IDENTITY_ENV_CWD` remains an explicit override.

## Security

The proxy is intended for trusted local use. Keep it on the local machine and
protect login and configuration data. Some provider challenge flows can execute
provider-supplied JavaScript without an operating-system sandbox; local binding
does not isolate that code. Do not expose the service outside the local
machine. Read the [security policy](../SECURITY.md) for details.

## Licensing

This bundled component may have terms separate from the Kit. Check the
[manifest](../MANIFEST.md) and the applicable upstream notices before
redistributing it.
