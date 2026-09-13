// Adapter: pi (pi.dev coding agent) — custom provider via ~/.pi/agent/models.json.
// Additive merge: existing providers are preserved; an existing "zcode" entry
// from another tool is never overwritten (kit registers under "zcode" only
// when absent, else reports the conflict).
// Efforts: pi's thinking system is separate from OMP's; the kit advertises
// reasoning models with verified low/high/max levels via thinkingLevelMap
// (documented in EFFORT_MAPPING.md); unverified capabilities are not claimed.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseJsonc } from "../../lib/jsonc.mjs";
import { commitFile } from "../../lib/edit.mjs";

const MANAGED_NOTE = "// zcode provider block managed by zcode-kit — GLM via local proxy";

function zcodeProvider(ctx) {
  const rootPath = ctx.root.replace(/\\/g, "/");
  return {
    baseUrl: `http://127.0.0.1:${ctx.port()}`,
    api: "anthropic-messages",
    apiKey: `!node "${rootPath}/proxy/resolve-zcode-proxy-key.mjs"`,
    models: [
      {
        id: "glm-5.3",
        name: "GLM-5.3",
        reasoning: true,
        input: ["text"],
        contextWindow: 1000000,
        maxTokens: 128000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: "glm-5.3-flash",
        name: "GLM-5.3-Flash",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1000000,
        maxTokens: 128000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  };
}

export default {
  id: "pi",
  label: "pi",
  protocol: "pi custom provider (models.json, anthropic-messages)",
  primarySource: "https://github.com/badlogic/pi-mono — packages/coding-agent/docs/models.md (checked 2026-09-13)",
  detect: (home) => existsSync(join(home, ".pi", "agent")) || detectOnPath("pi"),

  apply(ctx, tx, log) {
    const agentDir = join(ctx.home, ".pi", "agent");
    const modelsJson = join(agentDir, "models.json");
    if (!existsSync(agentDir)) {
      log("pi: skipped (no ~/.pi/agent — pi not configured on this machine)");
      return { changed: false };
    }
    mkdirSync(agentDir, { recursive: true });
    let doc = {};
    let existed = existsSync(modelsJson);
    if (existed) {
      try {
        doc = parseJsonc(readFileSync(modelsJson, "utf8"));
      } catch (err) {
        throw new Error(`~/.pi/agent/models.json is not valid JSON/JSONC: ${err.message} — refusing to edit`);
      }
    }
    doc.providers = doc.providers ?? {};
    if (doc.providers.zcode) {
      const current = doc.providers.zcode;
      const wanted = zcodeProvider(ctx);
      if (JSON.stringify(current.models?.map((m) => m.id)) === JSON.stringify(wanted.models.map((m) => m.id)) && current.baseUrl === wanted.baseUrl) {
        log('  pi: "zcode" provider already current');
        return { changed: false };
      }
      log('  pi: updating existing "zcode" provider entry (kit-owned)');
    } else if (Object.keys(doc.providers).length > 0) {
      log('  pi: registering "zcode" alongside existing providers');
    }
    doc.providers.zcode = zcodeProvider(ctx);
    const rendered = existed
      ? setManagedProvider(readFileSync(modelsJson, "utf8"), doc)
      : `${MANAGED_NOTE}\n${JSON.stringify(doc, null, 2)}\n`;
    const { wrote } = commitFile(ctx, tx, modelsJson, rendered.endsWith("\n") ? rendered : rendered + "\n");
    if (wrote) log("  pi: models.json updated (zcode provider, anthropic-messages via local proxy)");
    return { changed: wrote };
  },

  verify(ctx) {
    const modelsJson = join(ctx.home, ".pi", "agent", "models.json");
    if (!existsSync(modelsJson)) return [{ name: "pi provider registered", ok: null, detail: "not installed" }];
    try {
      const doc = parseJsonc(readFileSync(modelsJson, "utf8"));
      const ids = (doc.providers?.zcode?.models ?? []).map((m) => m.id);
      return [{ name: "pi provider registered", ok: ids.includes("glm-5.3") && ids.includes("glm-5.3-flash"), detail: `models: ${ids.join(", ")}` }];
    } catch (err) {
      return [{ name: "pi provider registered", ok: false, detail: err.message }];
    }
  },
};

/**
 * Serialize the merged doc back while keeping a leading comment line if the
 * original file had one. (pi reads models.json as JSON with comment tolerance;
 * full comment preservation is out of scope for the managed file.)
 */
function setManagedProvider(original, doc) {
  const lines = original.split("\n");
  const header = lines.filter((l) => l.trim().startsWith("//")).slice(0, 2);
  const keepHeader = header.filter((l) => !l.includes("managed by zcode-kit"));
  return [...keepHeader, MANAGED_NOTE, JSON.stringify(doc, null, 2)].join("\n") + "\n";
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
