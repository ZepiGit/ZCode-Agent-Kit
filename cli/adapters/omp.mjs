// Adapter: OMP / Oh My Pi — native provider via ~/.omp/agent/models.yml
// (managed block) + autostart extension registered in config.yml.
// Takeover rules: an existing kit block is replaced in place; a legacy
// zcode-omp-integration managed block is migrated (same pattern, predecessor
// tool); a hand-written `zcode` entry outside any managed block aborts the
// adapter fail-closed instead of being overwritten.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { removeFromDisabledProviders } from "../../lib/config-edit.mjs";
import { commitFile, ensureDir } from "../../lib/edit.mjs";

const BLOCK_NAME = "zcode-kit";
const MARKER_BEGIN = `# >>> ${BLOCK_NAME} (managed block) — do not edit inside`;
const MARKER_END = `# <<< ${BLOCK_NAME}`;
// Previous-generation integration (zcode-omp-integration) used the same
// managed-block pattern; its block is taken over on setup instead of
// duplicated next to it.
const LEGACY_BLOCK_NAME = "zcode-omp-integration";
const EXT_ENTRY_NAME = "zcode-proxy-autostart.ts";

function removeManagedBlock(text, name) {
  const BEGIN = `# >>> ${name} (managed block)`;
  const END = `# <<< ${name}`;
  let out = text;
  for (let removed = 0; ; removed++) {
    const begin = out.indexOf(BEGIN);
    if (begin === -1) return out;
    if (removed >= 8) throw new Error(`models.yml: more than 8 "${name}" managed blocks — refusing to edit`);
    const end = out.indexOf(END, begin);
    if (end === -1) throw new Error(`managed block "${name}": begin marker without end marker`);
    let cutEnd = end + END.length;
    if (out[cutEnd] === "\n") cutEnd += 1;
    out = out.slice(0, begin) + out.slice(cutEnd);
  }
}

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
    apiKey: "${ctx.key()}"
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
    newModels = removeManagedBlock(newModels, BLOCK_NAME);
    newModels = removeManagedBlock(newModels, LEGACY_BLOCK_NAME);
    const m = newModels.match(/^providers:\s*$/m);
    if (!m || m.index === undefined) throw new Error("top-level `providers:` key not found in models.yml");
    const insertAt = m.index + m[0].length;
    const rest = newModels.slice(insertAt);
    const nextTop = rest.search(/^\S/m);
    const providersRegion = nextTop === -1 ? rest : rest.slice(0, nextTop);
    if (/^  zcode:(?:\s.*)?$/m.test(providersRegion)) {
      throw new Error(
        "models.yml already has a hand-written `zcode` provider entry outside any managed block — " +
          "merge or rename it manually; nothing was changed (zcode-kit does not overwrite hand-written entries)",
      );
    }
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
    ensureDir(ctx, dirname(extDst));
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
    // Self-check (F11): the managed block carries a LITERAL key because omp
    // 18+ no longer evaluates the old `!node` resolver tag (requests then fail
    // with 401). The embedded key must equal THIS copy's proxy key — after a
    // copy switch or key rotation an old value keeps failing; detect it so the
    // user is pointed at `zcode-kit setup`, which rebuilds the block.
    const keyLine = models.match(/apiKey: "?([A-Za-z0-9_-]+)"?/);
    if (!keyLine) {
      checks.push({ name: "omp key resolver", ok: false, detail: "managed block has no literal apiKey (old !node format — omp 18+ ignores it, requests fail with 401) — rerun zcode-kit setup; then restart omp" });
    } else if (keyLine[1] !== ctx.key()) {
      checks.push({ name: "omp key resolver", ok: false, detail: "apiKey does not match this copy's proxy key — rerun zcode-kit setup from this copy to repair; then restart omp" });
    } else {
      checks.push({ name: "omp key resolver", ok: true, detail: "key current" });
    }
    checks.push({ name: "omp extension installed", ok: existsSync(join(agentDir, "extensions", EXT_ENTRY_NAME)) });
    return checks;
  },
};
