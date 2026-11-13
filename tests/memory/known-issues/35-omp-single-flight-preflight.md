# 35 One preflight for several OMP hosts

Check: `omp:concurrent-preflights` (S3/omp, Windows).

When several OMP hosts started at the same moment, each one ran its own
preflight process. The start lock still guaranteed a single proxy, so this
cost memory and start time but not correctness. The hosts now share an
autostart token: one host runs the preflight and the others wait inside their
own process for its result. On Linux the check is green and no longer listed.
The Windows entry stays until the Windows runs in CI show the same, together
with the cost of a waiting host there (`omp:waiter-cost`, gated on commit).
