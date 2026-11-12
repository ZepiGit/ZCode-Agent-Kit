// `zcode-kit version` / `zcode-kit --version`: the installed kit's version
// (the `version` field of the installation's package.json), exit 0.
import { installedVersion } from "../../lib/self-update.mjs";
import { stdoutLine } from "./common.mjs";

export async function run(_args, ctx) {
  return { exitCode: 0, records: [stdoutLine(`zcode-kit ${installedVersion(ctx.kit.root) ?? "unknown"}`)] };
}
