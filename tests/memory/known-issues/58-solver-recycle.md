# 58 Captcha solver memory between recycles

Checks: `solver:cost-per-generation`, `solver:retained-before-recycle`,
`procPeak:scenario`, `growth:scenario`, `procPeak:solver` (S2/short, Linux and
Windows).

The captcha solver is recycled after a fixed number of solves. Between two
recycles its memory grows past the budget the loop sets for it. The planned
fix recycles on the solver's own memory footprint and bounds how often an
abnormal solver exit may happen before solves fail fast. Not implemented yet.
