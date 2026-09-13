// Harness detection for the zcode-kit CLI (audit §3: adapters act only for
// detected harnesses; detection is read-only).
import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export function commandOnPath(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Detection result per adapter id. Purely environmental: PATH probes plus
 * well-known config locations. Never modified by detection.
 */
export function detectHarnesses(home) {
  const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const dotConfig = process.platform === "win32" ? appData : join(home, ".config");
  const vscodeExt = join(home, ".vscode", "extensions");
  return {
    omp: existsSync(join(home, ".omp", "agent")),
    pi: existsSync(join(home, ".pi", "agent")) || commandOnPath("pi"),
    "claude-code": commandOnPath("claude") || existsSync(join(home, ".claude")),
    codex: commandOnPath("codex") || existsSync(join(home, ".codex")),
    opencode: commandOnPath("opencode") || existsSync(join(dotConfig, "opencode")),
    cline: existsSync(vscodeExt) && listDir(vscodeExt).some((d) => /^saoudrizwan\.claude-dev/i.test(d)),
    "kilo-code": existsSync(vscodeExt) && listDir(vscodeExt).some((d) => /^kilocode\.kilo-code/i.test(d)),
    aider: commandOnPath("aider") || commandOnPath("aider-chat"),
    continue: existsSync(join(home, ".continue")),
    goose: existsSync(join(dotConfig, "goose")) || existsSync(join(appData, "Block", "goose")),
  };
}
