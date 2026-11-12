// How the kit's generated harness MCP entries start its bridge:
//
//   node --max-semi-space-size=1 <kit>/mcp/zcode-harness-mcp/dist/index.js --stdio
//
// The flag shrinks V8's young generation for the one bridge per harness
// session. It sits on the bridge's own command line, never in NODE_OPTIONS:
// NODE_OPTIONS would leak to the harness and every child the bridge starts.
// The bridge's test client (mcp/zcode-harness-mcp/test/integration/client.mjs)
// holds the same list, so `test:mcp` runs the bridge as the entries start it.

import { realpathSync } from "node:fs";
import { posix, win32 } from "node:path";

export const BRIDGE_NODE_FLAGS = Object.freeze(["--max-semi-space-size=1"]);

/** The args of a generated entry whose command is `node`. */
export function bridgeArgs(serverJs) {
  return [...BRIDGE_NODE_FLAGS, serverJs, "--stdio"];
}

/**
 * The bridge script an entry's args point at: the first argument that is not
 * a Node flag. It decides whose entry it is, in the old form
 * (`[script, "--stdio"]`) and in the flagged one alike.
 */
export function bridgeScriptOf(args) {
  if (!Array.isArray(args)) return undefined;
  return args.find((a) => typeof a === "string" && !a.startsWith("-"));
}

/**
 * The `Args:` field of `claude mcp get zcode-harness` split into its leading
 * Node flags and the script (`[flags…] <script> --stdio`; the script may be
 * double-quoted when it holds spaces). null when the field has another shape.
 */
export function parseClaudeBridgeArgs(output) {
  const text = String(output ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  let field = text.match(/^\s*Args:\s*(.+?)\s+--stdio\s*$/m)?.[1];
  if (!field) return null;
  const flags = [];
  for (let m; (m = field.match(/^(--[A-Za-z0-9-]+(?:=\S*)?)\s+/)); field = field.slice(m[0].length)) flags.push(m[1]);
  const script = field.startsWith('"') && field.endsWith('"') ? field.slice(1, -1) : field;
  return { flags, script };
}

/** True when the flags equal the ones the kit generates, in order. */
export function hasBridgeFlags(flags) {
  return Array.isArray(flags) && flags.length === BRIDGE_NODE_FLAGS.length && flags.every((f, i) => f === BRIDGE_NODE_FLAGS[i]);
}

/**
 * Whether `candidate` names this installation's `expected` file: an
 * absolute path, compared after the platform's normalisation (separators,
 * `.`/`..`, repeated separators), case-insensitively on Windows, and through
 * realpath when it exists on this host. `platform` exists so the Windows rule
 * is testable on any host; realpath is used only for the host's own platform.
 */
export function sameInstallationPath(candidate, expected, { platform = process.platform } = {}) {
  const paths = platform === "win32" ? win32 : posix;
  if (typeof candidate !== "string" || !paths.isAbsolute(candidate)) return false;
  const canonical = (value) => {
    let resolved = paths.normalize(value);
    if (platform === process.platform) {
      try { resolved = realpathSync(resolved); } catch { /* lexical identity still handles missing artifacts */ }
    }
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return canonical(candidate) === canonical(expected);
}

/**
 * What `claude mcp get zcode-harness` shows, judged against this
 * installation's bridge script:
 *   - "foreign":  another script, or a display that cannot be read: never touched;
 *   - "current":  this installation's script (any equivalent spelling) with the kit's flags: left alone;
 *   - "outdated": this installation's script without them: re-registered once.
 */
export function claudeRegistrationState(output, serverJs, { platform = process.platform } = {}) {
  const registered = parseClaudeBridgeArgs(output);
  if (!registered || !sameInstallationPath(registered.script, serverJs, { platform })) return { state: "foreign", registered };
  return { state: hasBridgeFlags(registered.flags) ? "current" : "outdated", registered };
}
