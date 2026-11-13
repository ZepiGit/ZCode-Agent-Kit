# 37 Launcher stays resident beside the harness

Checks: `peak:kit`, `procPeak:launcher`, `procPeak:mcp-bridge`,
`procPeak:preflight`, `procPeak:proxy` (S3).

`zcode-kit run` used to keep a Node process alive for as long as the harness
ran, which added its memory to every launched harness. On Linux and macOS
with Node.js 26.1 or newer it now hands its process over to the harness with
`process.execve`; Windows keeps the resident launcher. On Linux that changed
two of the checks, but neither is reliably within its budget yet:

- `peak:kit` went from about 800 MB to about 700 MB (budget 596). The peak
  used to be five resident launchers beside five bridges. Now it is the start
  itself: ten Node processes running the preflight at the same moment (five
  launchers and five directly started preflights in the mixed round, ten
  preflights in the preflight rounds).
- `procPeak:launcher` went from 78 MB to 66–72 MB as sampled (budget 74).
  Read from the harness, which inherits the launcher's peak, single launchers
  reach 73–75 MB just before the handover, so a sample taken at that moment
  can still be over.

The per-process peaks sit close to their budgets, so some of them are marked
`flips`.
