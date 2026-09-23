// Adapter: OpenCode — custom provider via the global opencode config
// (~/.config/opencode/opencode.json on POSIX, %APPDATA%/opencode/opencode.json
// on Windows; JSONC tolerated). Additive: only the "zcode" provider key is set.
// The API key is a process-local env reference: the kit's launcher sets
// ZCODE_PROXY_KEY; users can alternatively run /connect inside OpenCode.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc, setTopLevelKey } from "../../lib/jsonc.mjs";
import { commitFile, ensureDir } from "../../lib/edit.mjs";

/** Platform-correct global config location (exported for tests). */
export function configPath(home) {
  if (process.env.OPENCODE_CONFIG) return process.env.OPENCODE_CONFIG;
  const dir = process.env.OPENCODE_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode");
  const jsonc = join(dir, "opencode.jsonc");
  return existsSync(jsonc) ? jsonc : join(dir, "opencode.json");
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
      "glm-5.3-flash": {
        name: "GLM-5.3-Flash", limit: { context: 1000000, output: 128000 },
        options: { reasoningEffort: "low" },
        variants: {
          low: { reasoningEffort: "low" },
          high: { reasoningEffort: "high" },
          max: { reasoningEffort: "max" },
        },
      },
    },
  };
}

/** Kit-signature: proves an existing provider.zcode entry was written by the
 * kit (this exact provider shape). Anything else is foreign and a conflict. */
function isKitOwned(p) {
  return !!p && typeof p === "object" &&
    p.npm === "@ai-sdk/openai-compatible" &&
    p.name === "ZCode (local proxy)" &&
    p.options?.apiKey === "{env:ZCODE_PROXY_KEY}" &&
    /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(p.options?.baseURL ?? "");
}

export default {
  id: "opencode",
  label: "OpenCode",
  protocol: "OpenAI-compatible (ai-sdk openai-compatible → /v1/chat/completions)",
  primarySource: "https://opencode.ai/docs/providers/ (checked 2026-09-13)",
  detect: (home) => detectOnPath("opencode") || existsSync(configPath(home)),

  apply(ctx, tx, log) {
    const target = configPath(ctx.home);
    ensureDir(ctx, dirname(target));
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
    // AUD-003: fail closed on foreign entries — an existing provider.zcode
    // that does not match the kit signature is never overwritten (same
    // ownership model as the pi adapter).
    if (doc.provider?.zcode && !isKitOwned(doc.provider.zcode)) {
      throw new Error(
        `opencode: ${target} already has a "zcode" provider entry that zcode-kit does not own ` +
        "(does not match the kit signature) — nothing was changed. " +
        "Rename your entry or adjust it to hand ownership to the kit.",
      );
    }
    if (doc.provider?.zcode) {
      log("  opencode: updating kit-owned zcode provider entry");
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
