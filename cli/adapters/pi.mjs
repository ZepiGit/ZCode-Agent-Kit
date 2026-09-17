// Adapter: pi (pi.dev coding agent) — custom provider via ~/.pi/agent/models.json.
// Additive merge: existing providers are preserved. Ownership is explicit: the
// kit writes an "x-zcode-agent-kit" marker inside its provider entry and only
// ever updates entries carrying that marker (or byte-identical legacy kit
// entries from before the marker existed). A hand-written "zcode" entry
// without either proof is a hard conflict — nothing is written (ZAK-004).
// Efforts: pi's thinking system is separate from OMP's; the kit advertises
// reasoning models with verified low/high/max levels via thinkingLevelMap
// (documented in EFFORT_MAPPING.md); unverified capabilities are not claimed.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc, setTopLevelKey } from "../../lib/jsonc.mjs";
import { commitFile } from "../../lib/edit.mjs";

const MANAGED_NOTE = "// zcode provider block managed by zcode-kit — GLM via local proxy";
const OWNERSHIP_MARKER = { managed: true, schema: 1 };

function zcodeProvider(ctx) {
  const rootPath = ctx.root.replace(/\\/g, "/");
  return {
    "x-zcode-agent-kit": OWNERSHIP_MARKER,
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
    let doc = {};
    let existed = existsSync(modelsJson);
    if (existed) {
      try {
        doc = parseJsonc(readFileSync(modelsJson, "utf8"));
      } catch (err) {
        throw new Error(`~/.pi/agent/models.json is not valid JSON/JSONC: ${err.message} — refusing to edit`);
      }
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc) || (doc.providers != null && (typeof doc.providers !== 'object' || Array.isArray(doc.providers)))) throw new Error('pi: models.json and providers must be objects; refusing to edit');
    doc.providers = doc.providers ?? {};
    if (doc.providers.zcode) {
      const current = doc.providers.zcode;
      if (typeof current !== 'object' || Array.isArray(current)) throw new Error('pi: foreign zcode provider is not a mapping; refusing to edit');
      const wanted = zcodeProvider(ctx);
      const owned = current["x-zcode-agent-kit"]?.managed === true;
      const legacyKitEntry = !current["x-zcode-agent-kit"]
        && current.api === "anthropic-messages"
        && typeof current.apiKey === "string"
        && current.apiKey.startsWith("!node ")
        && current.apiKey.endsWith("/proxy/resolve-zcode-proxy-key.mjs\"");
      if (!owned && !legacyKitEntry) {
        throw new Error(
          'pi: ~/.pi/agent/models.json already has a "zcode" provider entry that zcode-kit does not own ' +
          "(no x-zcode-agent-kit marker and not a legacy kit entry) — nothing was changed. " +
          "Rename your entry or add the marker to hand ownership to the kit.",
        );
      }
      if (JSON.stringify(current) === JSON.stringify(wanted)) {
        log('  pi: "zcode" provider already current');
        return { changed: false };
      }
      log('  pi: updating kit-owned "zcode" provider entry');
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
  return setTopLevelKey(original, 'providers', doc.providers);
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
