// `zcode-kit status [--json] [--verbose]`: the same report as `proxy status`
// (./proxy.mjs statusReport): exit 0 only when this kit's proxy answers.
import { statusReport } from "./proxy.mjs";

/** @param {{ flags: Record<string, unknown> }} args */
export async function run(args, ctx) {
  return statusReport(args, ctx);
}
