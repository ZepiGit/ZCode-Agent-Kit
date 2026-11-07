// Node.js support floor (ADR-0006): the kit supports Node.js 24 and newer.
// One source for the CLI's setup/update refusal and the preflight's check of
// the OMP autostart's pinned Node path. The installers (install.sh,
// install.ps1) and the pack build carry the same number in their own
// languages; tests/node-floor.test.mjs keeps every copy at this value.
//
// Plain ESM with no imports: it is evaluated on the old runtimes it turns
// away, before anything else is touched.

export const NODE_FLOOR = 24;

/** The major version of `v22.11.0` / `22.11.0`, or null when unreadable. */
export function nodeMajor(version) {
  const match = /^v?(\d+)\./.exec(String(version ?? "").trim());
  return match ? Number(match[1]) : null;
}

/** True when `version` is below the floor or cannot be read. */
export function belowNodeFloor(version) {
  const major = nodeMajor(version);
  return major === null || major < NODE_FLOOR;
}

/**
 * The exact upgrade steps, first choice first, each finished by `then`
 * (what to run after the upgrade). Windows: the winget LTS package
 * (`OpenJS.NodeJS.LTS`); elsewhere: the nodejs.org download, then nvm.
 */
export function nodeUpgradeSteps(then, platform = process.platform) {
  const download = `install Node.js ${NODE_FLOOR} LTS or newer from https://nodejs.org/en/download, then ${then}`;
  return platform === "win32"
    ? [`winget install --id OpenJS.NodeJS.LTS --exact, then ${then} in a new terminal`, download]
    : [download, `nvm install ${NODE_FLOOR}, then ${then}`];
}

/**
 * The error block (what/why/next/exit) for `zcode-kit <command>` on a Node
 * below the floor, or null when the running Node is supported.
 */
export function nodeFloorRefusal(command, { version = process.version, platform = process.platform } = {}) {
  if (!belowNodeFloor(version)) return null;
  return {
    what: `Node.js ${version} is below the support floor (Node.js ${NODE_FLOOR})`,
    why: `zcode-kit ${command} needs Node.js ${NODE_FLOOR} or newer; nothing was changed and the existing installation keeps working`,
    next: nodeUpgradeSteps(`rerun zcode-kit ${command}`, platform),
    exit: 2,
  };
}
