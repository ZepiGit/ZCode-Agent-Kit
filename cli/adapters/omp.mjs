// Adapter: OMP / Oh My Pi — native provider via ~/.omp/agent/models.yml
// (additive managed block) + autostart extension registered in config.yml.
// Migrated from setup.mjs; behavior unchanged (audit fixes included).
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { removeFromDisabledProviders } from "../../lib/config-edit.mjs";
import { commitFile } from "../../lib/edit.mjs";

const MARKER_BEGIN = "# >>> zcode-kit (managed block) — do not edit inside";
const MARKER_END = "# <<< zcode-kit";
const EXT_ENTRY_NAME = "zcode-proxy-autostart.ts";

export function yamlSingleQuoted(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

function ompProviderBlock(ctx, port) {
  const rootPath = ctx.root.replace(/\\/g, "/");
  return `${MARKER_BEGIN}
# Provider ZCode — GLM-5.3 / GLM-5.3-Flash via the local zcode-proxy
# (start-plan access). Efforts low/high/max; default max. See EFFORT_MAPPING.md.
  zcode:
    name: ZCode
    baseUrl: http://127.0.0.1:${port}
    api: anthropic-messages
    apiKey: !node ${yamlSingleQuoted(rootPath + "/proxy/resolve-zcode-proxy-key.mjs")}
    modelOverrides:
      glm-5.3:
        thinking:
          mode: anthropic-budget-effort
          efforts:
            - low
            - high
            - max
          defaultLevel: max
          requiresEffort: true
        compat:
          supportsOutputEffort: true
          supportsContextManagement: false
          replayUnsignedThinking: true
          injectClaudeCodeInstruction: false
      glm-5.3-flash:
        thinking:
          mode: anthropic-budget-effort
          efforts:
            - low
            - high
            - max
          defaultLevel: max
          requiresEffort: true
        compat:
          supportsOutputEffort: true
          supportsContextManagement: false
          replayUnsignedThinking: true
          injectClaudeCodeInstruction: false
    models:
      - id: glm-5.3
        name: GLM-5.3
        reasoning: true
        input:
          - text
        contextWindow: 1000000
        maxTokens: 128000
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
      - id: glm-5.3-flash
        name: GLM-5.3-Flash
        reasoning: true
        input:
          - text
          - image
        contextWindow: 1000000
        maxTokens: 128000
        cost:
          input: 0
          output: 0
          cacheRead: 0
          cacheWrite: 0
${MARKER_END}`;
}

function validateYaml(ctx, text, label) {
  try {
    const req = createRequire(join(ctx.proxySrc, "package.json"));
    req("yaml").parse(text, { strict: false });
  } catch (err) {
    throw new Error(`YAML validation failed for ${label}: ${err.message}`);
  }
}

export default {
  id: "omp",
  label: "OMP / Oh My Pi",
  protocol: "OMP native provider (anthropic-messages + output_config.effort)",
  primarySource: "https://omp.sh/docs/custom-models (checked 2026-09-13)",
  detect: (home) => existsSync(join(home, ".omp", "agent")),

  apply(ctx, tx, log) {
    const agentDir = join(ctx.home, ".omp", "agent");
    const modelsYml = join(agentDir, "models.yml");
    const configYml = join(agentDir, "config.yml");
    if (!existsSync(modelsYml)) {
      log("omp: skipped (no ~/.omp/agent/models.yml)");
      return { changed: false };
    }
    const port = ctx.port();

    const models = readFileSync(modelsYml, "utf8");
    let newModels = models;
    const begin = newModels.indexOf(MARKER_BEGIN);
    if (begin !== -1) {
      const end = newModels.indexOf(MARKER_END, begin);
      if (end === -1) throw new Error("managed block begin without end marker");
      let cutEnd = end + MARKER_END.length;
      if (newModels[cutEnd] === "\n") cutEnd += 1;
      newModels = newModels.slice(0, begin) + newModels.slice(cutEnd);
    }
    const m = newModels.match(/^providers:\s*$/m);
    if (!m || m.index === undefined) throw new Error("top-level `providers:` key not found in models.yml");
    const insertAt = m.index + m[0].length;
    newModels = newModels.slice(0, insertAt) + "\n" + ompProviderBlock(ctx, port) + newModels.slice(insertAt);
    validateYaml(ctx, newModels, "models.yml (staged)");

    let newConfig = existsSync(configYml) ? readFileSync(configYml, "utf8") : null;
    let configChanged = false;
    if (newConfig) {
      const scoped = removeFromDisabledProviders(newConfig, "zcode");
      const cleaned = scoped.text;
      const extEntry = `  - ${join(agentDir, "extensions", EXT_ENTRY_NAME).replace(/\\/g, "/")}`;
      let withExt = cleaned;
      if (!cleaned.includes(EXT_ENTRY_NAME)) {
        const em = cleaned.match(/^extensions:\s*$/m);
        withExt = em && em.index !== undefined
          ? cleaned.slice(0, em.index + em[0].length) + `\n${extEntry}` + cleaned.slice(em.index + em[0].length)
          : cleaned.replace(/\n*$/, "\n") + `extensions:\n${extEntry}\n`;
      }
      if (withExt !== newConfig) {
        configChanged = true;
        newConfig = withExt;
        validateYaml(ctx, newConfig, "config.yml (staged)");
      }
    }

    const extSrc = join(ctx.root, "proxy", "zcode-proxy-autostart.ts");
    const extDst = join(agentDir, "extensions", EXT_ENTRY_NAME);
    mkdirSync(dirname(extDst), { recursive: true });
    const rootLiteral = ctx.root.replace(/\\/g, "/").replace(/"/g, '\\"');
    const extContent = readFileSync(extSrc, "utf8")
      .replaceAll("__ZCODE_OM_ROOT__", rootLiteral)
      .replaceAll("__ZCODE_OM_PORT__", String(port));
    if (!existsSync(extDst) || readFileSync(extDst, "utf8") !== extContent) {
      commitFile(ctx, tx, extDst, extContent, { log });
      log("  extension installed/updated: ~/.omp/agent/extensions/zcode-proxy-autostart.ts");
    } else {
      log("  extension already current");
    }

    let changed = false;
    if (newModels !== models) {
      commitFile(ctx, tx, modelsYml, newModels, { log: () => {} });
      log("  models.yml updated (zcode provider)");
      changed = true;
    } else {
      log("  models.yml already up to date");
    }
    if (newConfig && configChanged) {
      commitFile(ctx, tx, configYml, newConfig, { log: () => {} });
      log("  config.yml updated (disabledProviders cleaned / extension registered)");
      changed = true;
    } else if (newConfig) {
      log("  config.yml already up to date");
    }
    return { changed };
  },

  verify(ctx) {
    const agentDir = join(ctx.home, ".omp", "agent");
    const checks = [];
    const modelsYml = join(agentDir, "models.yml");
    if (!existsSync(modelsYml)) {
      checks.push({ name: "omp models.yml", ok: null, detail: "not installed" });
      return checks;
    }
    const models = readFileSync(modelsYml, "utf8");
    checks.push({ name: "omp provider registered", ok: models.includes("zcode:"), detail: "zcode block in models.yml" });
    checks.push({ name: "omp extension installed", ok: existsSync(join(agentDir, "extensions", EXT_ENTRY_NAME)) });
    return checks;
  },
};
