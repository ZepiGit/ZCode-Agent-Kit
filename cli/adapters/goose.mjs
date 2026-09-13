// Adapter: Goose — declarative custom provider file in the goose
// `custom_providers` directory (engine openai). The credential helper uses the
// kit's key resolver via `auth.command` (documented goose mechanism; the
// command runs directly without a shell and its stdout is the credential).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { commitFile, ensureDir } from "../../lib/edit.mjs";

/** Platform-correct custom_providers directory (exported for tests). */
export function providerDir(home) {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "Block", "goose", "config", "custom_providers");
  }
  return join(home, ".config", "goose", "custom_providers");
}

export default {
  id: "goose",
  label: "Goose",
  protocol: "OpenAI-compatible custom provider (engine: openai, full endpoint URL)",
  primarySource: "https://goose-docs.ai/docs/getting-started/providers/ (checked 2026-09-13)",
  detect: (home) => {
    if (process.platform === "win32") {
      const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
      return existsSync(join(appData, "Block", "goose"));
    }
    return existsSync(join(home, ".config", "goose")) || detectOnPath("goose");
  },

  apply(ctx, tx, log) {
    const dir = providerDir(ctx.home);
    ensureDir(ctx, dir);
    const file = join(dir, "zcode.json");
    const resolver = join(ctx.root, "proxy", "resolve-zcode-proxy-key.mjs").replace(/\\/g, "/");
    const provider = {
      name: "zcode",
      engine: "openai",
      display_name: "ZCode (local proxy)",
      description: "GLM-5.3 / GLM-5.3-Flash via the local zcode-proxy (own ZCode Desktop account)",
      // Goose schema: base_url is the FULL chat-completions endpoint URL.
      base_url: `http://127.0.0.1:${ctx.port()}/v1/chat/completions`,
      models: [
        { name: "glm-5.3", context_limit: 1000000 },
        { name: "glm-5.3-flash", context_limit: 1000000 },
      ],
      supports_streaming: true,
      requires_auth: true,
      auth: {
        command: "node",
        args: [resolver],
        refresh_interval: 0,
        timeout_seconds: 10,
      },
    };
    const current = existsSync(file) ? readJsonSafe(file) : null;
    if (current && JSON.stringify(current) === JSON.stringify(provider)) {
      log("  goose: zcode provider already current");
      return { changed: false };
    }
    commitFile(ctx, tx, file, JSON.stringify(provider, null, 2) + "\n");
    log(`  goose: wrote ${file}`);
    log("  use via: goose session --provider zcode  (credential fetched through the kit's auth helper)");
    return { changed: true };
  },

  verify(ctx) {
    const file = join(providerDir(ctx.home), "zcode.json");
    if (!existsSync(file)) return [{ name: "goose provider registered", ok: null, detail: "not installed" }];
    const doc = readJsonSafe(file);
    return [{ name: "goose provider registered", ok: doc?.name === "zcode" && Array.isArray(doc?.models) && doc.models.length === 2, detail: file }];
  },
};

function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

import { execFileSync } from "node:child_process";
function detectOnPath(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
