// `zcode-kit proxy start|stop|restart|status [--json]|logs [n]`: thin
// forwarding to the manager, which owns identity, ownership proofs, its
// output and the exit codes 0-5. `logs` lives in ./logs.mjs.
import { managerPath, stderrLine } from "./common.mjs";
import { run as runLogs } from "./logs.mjs";

const SUBCOMMANDS = ["start", "stop", "restart", "status", "logs"];

/** @param {{ positional: string[], flags: Record<string, unknown> }} args */
export async function run(args, ctx) {
  const sub = args.positional[1];
  if (!SUBCOMMANDS.includes(sub)) {
    return { exitCode: 2, records: [stderrLine("Usage: zcode-kit proxy start|stop|restart|status|logs [n]")] };
  }
  if (sub === "logs") return runLogs(args, ctx);
  const managerArgs = [managerPath(ctx.kit), sub];
  if (sub === "status" && args.flags.json === true) managerArgs.push("--json");
  const res = ctx.spawnSync(ctx.execPath, managerArgs, { stdio: "inherit" });
  return { exitCode: res.status ?? 2, records: [] };
}
