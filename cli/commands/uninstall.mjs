// `zcode-kit uninstall`: roll back every recorded transaction (newest first),
// undo the kit's own claude MCP registration, remove the kit's own command
// shim. Exit 0 when complete, 1 when a file conflict or an external step
// remains. Output is streamed (ctx.progress): `claude mcp remove` shares the
// terminal.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { acquireLock, listTransactions, releaseLock, rollbackTransaction } from "../../lib/transaction.mjs";
import { ensureState } from "../../lib/state.mjs";

export async function run(_args, ctx) {
  const { kit, env, platform, progress, progressError } = ctx;
  progress("Scope: removes KIT-OWNED integrations and artifacts. Your ZCode Desktop login,");
  progress("~/.zcode-proxy/credentials.json (shared credential store) and harness data are NOT deleted.");
  ensureState(kit);
  acquireLock(kit.backupDir);
  let externalUndone = true;
  try {
    const ids = listTransactions(kit.backupDir);
    const serverJs = join(kit.mcpDir, "dist", "index.js");
    // Execute the KNOWN kit registrations' undo hints ourselves
    // (currently only the claude user-scope MCP registration); never run
    // arbitrary strings from manifests — only the exact undo command shape
    // we issued. Only remove a registration that points at THIS copy.
    const undoExternal = (e) => {
      if (e.undoHint !== 'claude mcp remove zcode-harness --scope user') return false;
      const get = ctx.runCommandSync("claude", ["mcp", "get", "zcode-harness"], { stdio: "pipe", encoding: "utf8" });
      if (get.error) { progressError(`claude mcp get failed: ${get.error.message}`); return false; }
      if (get.status !== 0) return /not found|no.*server.*named/i.test(`${get.stdout ?? ''}\n${get.stderr ?? ''}`);
      if (!(get.stdout ?? "").includes(serverJs)) {
        progress('claude "zcode-harness" is registered by another kit copy — left untouched');
        return true;
      }
      const res = ctx.runCommandSync("claude", ["mcp", "remove", "zcode-harness", "--scope", "user"], { stdio: "inherit" });
      if (res.error) progressError(`claude mcp remove failed: ${res.error.message}`);
      return !res.error && res.status === 0;
    };
    for (let i = ids.length - 1; i >= 0; i--) {
      const r = rollbackTransaction(kit.backupDir, ids[i], { undoExternal });
      if (!r.complete) externalUndone = false;
      progress(`rollback ${ids[i]}: ${r.restored.length} restored, ${r.removed.length} removed, ${r.conflicts.length} conflict(s)`);
      for (const conflict of r.conflicts) progress(`CONFLICT (left untouched): ${conflict}`);
      for (const e of r.external) {
        progress(`manual undo required: ${e.description}\n  -> ${e.undoHint}`);
        externalUndone = false;
      }
    }
  } finally {
    releaseLock(join(kit.backupDir, ".setup-lock"));
  }
  progress("Recorded kit files were rolled back. Unrecorded generated data, Codex sessions, proxy key and logs are preserved.");
  // The installers leave a user-scope `zcode-kit` command shim behind; remove
  // it only when it points at THIS root — a shim owned by another install
  // (or unreadable) is never touched.
  const shimPaths = platform === "win32"
    ? (env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, "Microsoft", "WindowsApps", "zcode-kit.cmd")] : [])
    : [join(kit.home, ".local", "bin", "zcode-kit")];
  for (const shim of shimPaths) {
    try {
      const companion = shim.replace(/\.cmd$/i, '.ps1');
      if (platform === 'win32' && existsSync(shim) && existsSync(companion) && readFileSync(shim, 'utf8').includes('"%~dp0zcode-kit.ps1"') && readFileSync(companion, 'utf8').includes(join(kit.root, 'cli', 'zcode-kit.mjs').replaceAll("'", "''"))) {
        rmSync(shim); rmSync(companion);
        progress(`removed kit-owned command shims: ${shim}`);
      } else if (existsSync(shim) && readFileSync(shim, "utf8").includes(join(kit.root, "cli", "zcode-kit.mjs"))) {
        rmSync(shim);
        progress(`removed kit-owned command shim: ${shim}`);
      }
    } catch { /* unreadable shim is not ours to delete */ }
  }
  if (!externalUndone) {
    progressError("uninstall incomplete: a file conflict or external registration remains (see output above).");
    return { exitCode: 1, records: [] };
  }
  return { exitCode: 0, records: [] };
}
