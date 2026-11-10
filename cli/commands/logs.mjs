// `zcode-kit proxy logs [n] [--level warn|error] [--grep <text>]`: the last n
// lines of the proxy log (default 40), redacted, as data on stdout. The
// filters are additive (ticket 40, A-23; lib/proxy-logs.mjs). No log file yet
// is a note on stderr, exit 0; a bad filter is a usage error, exit 2.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { managerPath } from "./common.mjs";

const USAGE = "zcode-kit proxy logs [n] [--level warn|error] [--grep <text>]";

const kitModule = (kit, rel) => import(pathToFileURL(join(kit.root, ...rel.split("/"))).href);

/** @param {{ positional: string[], flags: Record<string, unknown> }} args  positional[2] is the optional line count */
export async function run({ positional, flags }, { kit }) {
  const { LOG_LEVELS, readLogTail } = await kitModule(kit, "lib/proxy-logs.mjs");
  const level = flags.level === undefined ? null : flags.level;
  const grep = flags.grep === undefined ? null : flags.grep;
  if (level !== null && !LOG_LEVELS.includes(level)) {
    return { exitCode: 2, records: [{ kind: "error", what: `--level takes ${LOG_LEVELS.join(" or ")}`, next: [USAGE], exit: 2 }] };
  }
  if (grep !== null && (typeof grep !== "string" || grep === "")) {
    return { exitCode: 2, records: [{ kind: "error", what: "--grep needs the text to look for", next: [USAGE], exit: 2 }] };
  }
  const { createLifecycle } = await kitModule(kit, "lib/proxy-lifecycle.mjs");
  const lifecycle = createLifecycle({ root: kit.root, home: kit.home, managerPath: managerPath(kit) });
  const n = Number(positional[2] ?? 40) || 40;
  const tail = readLogTail(lifecycle.LOG_FILE, { n, level, grep, redact: lifecycle.redact });
  if (!tail.exists) return { exitCode: 0, records: [{ kind: "note", text: `no proxy log yet at ${lifecycle.LOG_FILE}` }] };
  return { exitCode: 0, records: tail.lines.map((text) => ({ kind: "data", text })) };
}
