// `zcode-kit status [--json]`: forwarded to the manager, which prints the
// status itself (its stdio is the terminal's) and owns the exit code.
import { managerPath } from "./common.mjs";

/** @param {{ flags: Record<string, unknown> }} args */
export async function run({ flags }, ctx) {
  const res = ctx.spawnSync(ctx.execPath, [managerPath(ctx.kit), "status", ...(flags.json === true ? ["--json"] : [])], { stdio: "inherit" });
  return { exitCode: res.status ?? 1, records: [] };
}
