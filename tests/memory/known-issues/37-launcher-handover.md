# 37 Launcher stays resident beside the harness

Checks: `peak:kit`, `procPeak:launcher`, `procPeak:mcp-bridge`,
`procPeak:preflight`, `procPeak:proxy` (S3).

`zcode-kit run` keeps a Node process alive for as long as the harness runs,
which adds its memory to every launched harness. The planned fix hands the
process over to the harness with `process.execve` on POSIX and keeps today's
behaviour on Windows. Not implemented yet. The per-process peaks sit close to
their budgets, so some of them are marked `flips`.
