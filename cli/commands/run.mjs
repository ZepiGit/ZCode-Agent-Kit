// `zcode-kit run <harness> -- <args>`: the startup preflight (safe start +
// quota check), then the harness on the terminal with the kit's key. The exit
// code is the preflight's refusal (3, 4, 5, …) or the harness's own; an
// unknown harness is exit 2, a harness without a launcher throws.
import { unknownHarness } from "./common.mjs";

/** @param {{ positional: string[], passthrough: string[] | null }} args */
export async function run({ positional, passthrough }, { kit }) {
  const id = positional[1];
  const unknown = unknownHarness(id);
  if (unknown) return unknown;
  // Lazy: launch.mjs (and heal.mjs under it) checks at module scope whether
  // it is the process entry, which reads argv.
  const { launchHarness } = await import("../launch.mjs");
  return { exitCode: await launchHarness(kit, id, passthrough ?? []), records: [] };
}
