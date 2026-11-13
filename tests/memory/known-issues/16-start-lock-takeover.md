# 16 Start lock takeover under contention

Checks: `exactly-one-proxy-after-round`, `start-over-stale-lock` (S3/short and
S3/hung, Linux and Windows).

The start lock takes over a stale lock only on proof that its holder is gone.
Both checks pass in most runs and fail in a few when many launchers start at
once on a loaded CI runner. They are marked `flips` and stay listed until ten
runs in a row are GREEN.
