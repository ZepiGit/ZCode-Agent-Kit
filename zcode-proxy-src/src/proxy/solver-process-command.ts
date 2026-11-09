/**
 * The self-exec subcommand that starts the solver process from a compiled
 * proxy binary (ADR-0002 condition 1: compiled builds self-exec, never `-e`).
 * Internal: the proxy starts it with an IPC channel; it is not in the help.
 * The name keeps "captcha-solver" in the process's command line, which is how
 * the memory loop's sampler recognises the solver role.
 */
export const SOLVER_PROCESS_COMMAND = "__captcha-solver-process";
