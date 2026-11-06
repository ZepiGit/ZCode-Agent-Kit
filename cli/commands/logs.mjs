// `zcode-kit proxy logs [n]`: the manager prints the last n lines of the
// proxy log itself (its stdio is the terminal's) and owns the exit code.
import { managerPath } from "./common.mjs";

/** @param {{ positional: string[] }} args  positional[2] is the optional line count */
export async function run({ positional }, ctx) {
  const managerArgs = [managerPath(ctx.kit), "logs"];
  if (positional[2] !== undefined) managerArgs.push(String(positional[2]));
  const res = ctx.spawnSync(ctx.execPath, managerArgs, { stdio: "inherit" });
  return { exitCode: res.status ?? 2, records: [] };
}
