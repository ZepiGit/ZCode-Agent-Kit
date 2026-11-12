# 58 Captcha solver memory between recycles

Checks: `solver:cost-per-generation`, `growth:scenario`, `procPeak:solver`
(S2/short, Linux and Windows).

The captcha solver used to be recycled only after a fixed number of solves,
and its memory counted against the proxy. It now runs in a process of its own
under a 300 MB cap and is recycled at 80 % of the cap (240 MB of its own
memory footprint) or after 100 solves. On Linux that took `procPeak:scenario`
from about 1130 MB to about 107 MB and `solver:retained-before-recycle` from
689 MB to 0 MB, so both names left the Linux list. On Windows the first CI
run with the solver process measured `procPeak:scenario` at 180 MB commit
against 600, `solver:cost-per-generation` at 266 MB against 300 and
`procPeak:solver` at 299 MB against 300; the first two names left the Windows
list as well, the last two are close enough to their budgets to stay listed.

What is left on Linux, from three runs of the short profile:

- `procPeak:solver`: 308 to 309 MB against 300. The check reads the solver's
  resident memory. The cgroup limit counts what the kernel charges to the
  solver's scope, which leaves out about 40 MB of file-backed pages of the Bun
  runtime and the few MB the process held before it joined the scope. The
  hung-solve phase keeps 256 MB in the guest; that stays just under the kernel
  limit, so the solve is ended by its deadline and not at the cap.
- `solver:cost-per-generation`: 286, 306 and 293 MB against 300. The recycle
  threshold is measured on the footprint the runtime reports, about 15 MB
  below resident memory, and one heavy solve adds up to about 40 MB to the
  level it started from. The check is RED in some runs only.
- `growth:scenario`: inside its budget in all three runs. It was RED only in
  some runs before the change, and three runs do not settle that.
