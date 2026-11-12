# 35 One preflight for several OMP hosts

Check: `omp:concurrent-preflights` (S3/omp, Linux and Windows).

When several OMP hosts start at the same moment, each one runs its own
preflight process. The start lock still guarantees a single proxy, so this
costs memory and start time but not correctness. The fix is a shared
autostart token so that one host runs the preflight and the others wait for
its result. Not implemented yet.
