// Adapter: OpenCode — custom provider via the global opencode config
// (~/.config/opencode/opencode.json on POSIX, %APPDATA%/opencode/opencode.json
// on Windows; JSONC tolerated). Additive: only the "zcode" provider key is set.
// The API key is a process-local env reference: the kit's launcher sets
// ZCODE_PROXY_KEY; users can alternatively run /connect inside OpenCode.
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc, setTopLevelKey } from "../../lib/jsonc.mjs";
import { commitFile } from "../../lib/edit.mjs";

function configPath(home) {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "opencode", "opencode.json");
  }
  return join(home, ".config", "opencode", "opencode.json");
}

function zcodeProvider(ctx) {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "ZCode (local proxy)",
    options: {
      baseURL: `http://127.0.0.1:${ctx.port()}/v1`,
      apiKey: "{env:ZCODE_PROXY_KEY}",
    },
    models: {
      "glm-5.3": { name: "GLM-5.3", limit: { context: 1000000, output: 128000 } },
      "glm-5.3-flash": { name: "GLM-5.3-Flash", limit: { context: 1000000, output: 128000 } },
    },
  };
}

export default {
  id: "opencode",
  label: "OpenCode",
  protocol: "OpenAI-compatible (ai-sdk openai-compatible → /v1/chat/completions)",
  primarySource: "https://opencode.ai/docs/providers/ (checked 2026-09-13)",
  detect: (home) => detectOnPath("opencode") || existsSync(configPath(home)),

  apply(ctx, tx, log) {
    const target = configPath(ctx.home);
    mkdirSync(dirname(target), { recursive: true });
    let text = existsSync(target) ? readFileSync(target, "utf8") : `{\n}\n`;
    let doc;
    try {
      doc = parseJsonc(text);
    } catch (err) {
      throw new Error(`${target} is not valid JSON/JSONC: ${err.message} — refusing to edit`);
    }
    const before = JSON.stringify(doc.provider?.zcode ?? null);
    const wanted = zcodeProvider(ctx);
    if (before === JSON.stringify(wanted)) {
      log("  opencode: zcode provider already current");
      return { changed: false };
    }
    if (doc.provider && doc.provider.zcode && !before.includes("127.0.0.1")) {
      log('  opencode: existing "zcode" provider differs — updating kit-owned entry (baseUrl was not the local proxy; review if this was yours)');
    }
    text = setTopLevelKey(text, "provider", { ...(doc.provider ?? {}), zcode: wanted });
    // Validate the merged document still parses before writing.
    parseJsonc(text);
    const { wrote } = commitFile(ctx, tx, target, text.endsWith("\n") ? text : text + "\n");
    if (wrote) log(`  opencode: provider "zcode" written to ${target} (apiKey references ZCODE_PROXY_KEY — set by the kit launcher)`);
    log("  use via: zcode-kit run opencode -- <args>  |  openai-compatible chat/completions only");
    return { changed: wrote };
  },

  verify(ctx) {
    const target = configPath(ctx.home);
    if (!existsSync(target)) return [{ name: "opencode provider registered", ok: null, detail: "not installed" }];
    try {
      const doc = parseJsonc(readFileSync(target, "utf8"));
      const models = Object.keys(doc.provider?.zcode?.models ?? {});
      return [{ name: "opencode provider registered", ok: models.includes("glm-5.3"), detail: `models: ${models.join(", ")}` }];
    } catch (err) {
      return [{ name: "opencode provider registered", ok: false, detail: err.message }];
    }
  },
};

import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
function detectOnPath(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
