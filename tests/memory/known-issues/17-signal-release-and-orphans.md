# 17 Lock release on signals and orphaned proxies

Checks: `orphans` (S3), `unstoppable-proxy-after-ctrl-c` (Linux S4),
`proxy-left-after-stop`, `failed-lifecycle-steps`, `count:proxy` (Windows S4).

A launcher ended by Ctrl-C releases its own start lock, and the next start
adopts a healthy proxy that was left without a pid record. The checks are
GREEN in most runs and RED in a few under load, so they are marked `flips`
and stay listed until ten runs in a row are GREEN.
