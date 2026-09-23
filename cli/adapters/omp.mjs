// Adapter: OMP / Oh My Pi — native provider via ~/.omp/agent/models.yml
// (managed block) + autostart extension registered in config.yml.
// Takeover rules: an existing kit block is replaced in place; a legacy
// zcode-omp-integration managed block is migrated (same pattern, predecessor
// tool); a hand-written `zcode` entry outside any managed block aborts the
// adapter fail-closed instead of being overwritten.
import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { commitFile, ensureDir } from "../../lib/edit.mjs";
import { resolveCommand, resolveBun } from "../../lib/process.mjs";
import { PREFLIGHT_DETAILS, PREFLIGHT_WARNINGS } from "../heal.mjs";

const BLOCK_NAME = "zcode-kit";
const MARKER_BEGIN = `# >>> ${BLOCK_NAME} (managed block) — do not edit inside`;
const MARKER_END = `# <<< ${BLOCK_NAME}`;
// Previous-generation integration (zcode-omp-integration) used the same
// managed-block pattern; its block is taken over on setup instead of
// duplicated next to it.
const LEGACY_BLOCK_NAME = "zcode-omp-integration";
const EXT_ENTRY_NAME = "zcode-proxy-autostart.ts";

function removeManagedBlock(text, name) {
  const beginMarker = `# >>> ${name} (managed block)`;
  const endMarker = `# <<< ${name}`;
  const begins = [...text.matchAll(new RegExp(`^[ \\t]*${escapeRegExp(beginMarker)}.*$`, "gm"))];
  const ends = [...text.matchAll(new RegExp(`^[ \\t]*${escapeRegExp(endMarker)}[ \\t]*\\r?$`, "gm"))];
  if (begins.length === 0 && ends.length === 0) return text;
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error(`models.yml: duplicate or unbalanced "${name}" managed block markers — refusing to edit`);
  }
  const begin = begins[0].index;
  const end = ends[0].index;
  if (begin === undefined || end === undefined || end < begin) {
    throw new Error(`managed block "${name}": end marker without matching begin marker`);
  }
  let cutEnd = end + ends[0][0].length;
  if (text[cutEnd] === "\n") cutEnd += 1;
  return text.slice(0, begin) + text.slice(cutEnd);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadYaml(ctx) {
  const req = createRequire(join(ctx.proxySrc, "package.json"));
  return req("yaml");
}

function parseYamlDocument(ctx, text, label) {
  try {
    const YAML = loadYaml(ctx);
    const doc = YAML.parseDocument(text, { strict: true, uniqueKeys: true, prettyErrors: false });
    if (doc.errors.length > 0) throw doc.errors[0];
    return { YAML, doc };
  } catch (err) {
    throw new Error(`YAML validation failed for ${label}: ${err.message}`);
  }
}

function topLevelPair(doc, key, label) {
  const matches = doc.contents?.items?.filter((pair) => pair.key?.value === key) ?? [];
  if (matches.length !== 1) throw new Error(`${label}: expected exactly one top-level \`${key}:\` key`);
  return matches[0];
}

function leadingIndent(text, offset) {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return text.slice(lineStart, offset);
}

function providerLayout(text, providersPair) {
  const value = providersPair.value;
  const isImplicitEmpty = value?.constructor?.name === "Scalar"
    && value.value === null
    && value.source === "";
  if (isImplicitEmpty) {
    const lineEnd = text.indexOf("\n", providersPair.key.range[2]);
    return { indent: "  ", insertAt: lineEnd === -1 ? text.length : lineEnd + 1 };
  }
  if (!value || value.constructor?.name !== "YAMLMap") {
    throw new Error("models.yml: top-level `providers` must be a mapping");
  }
  if (value.flow) throw new Error("models.yml: top-level `providers` must use a block mapping");

  if (value.items.length > 0) {
    const indent = leadingIndent(text, value.items[0].key.range[0]);
    if (!/^[ \t]+$/.test(indent)) throw new Error("models.yml: providers entries must be indented");
    return { indent, insertAt: value.items[0].key.range[0] - indent.length };
  }

  const headerEnd = providersPair.key.range[2];
  const lineEnd = text.indexOf("\n", headerEnd);
  return { indent: "  ", insertAt: lineEnd === -1 ? text.length : lineEnd + 1 };
}

function editConfigYaml(ctx, text, extensionPath) {
  const { YAML, doc } = parseYamlDocument(ctx, text, "config.yml");
  if (!doc.contents || doc.contents.constructor?.name !== "YAMLMap") {
    throw new Error("config.yml: top level must be a mapping");
  }

  const disabledPairs = doc.contents.items.filter((pair) => pair.key?.value === "disabledProviders");
  const extensionPairs = doc.contents.items.filter((pair) => pair.key?.value === "extensions");
  if (disabledPairs.length > 1 || extensionPairs.length > 1) {
    throw new Error("config.yml: duplicate disabledProviders/extensions keys — refusing to edit");
  }

  let changed = false;
  if (disabledPairs.length === 1) {
    const seq = disabledPairs[0].value;
    if (!seq || seq.constructor?.name !== "YAMLSeq") {
      throw new Error("config.yml: disabledProviders must be a sequence");
    }
    const filtered = seq.items.filter((item) => item?.value !== "zcode");
    if (filtered.length !== seq.items.length) {
      seq.items = filtered;
      changed = true;
    }
  }

  if (extensionPairs.length === 1) {
    const seq = extensionPairs[0].value;
    if (!seq || seq.constructor?.name !== "YAMLSeq") {
      throw new Error("config.yml: extensions must be a sequence");
    }
    if (!seq.items.some((item) => item?.value === extensionPath)) {
      seq.add(extensionPath);
      changed = true;
    }
  } else {
    const seq = new YAML.YAMLSeq();
    seq.add(extensionPath);
    doc.set("extensions", seq);
    changed = true;
  }

  return { text: changed ? String(doc) : text, changed };
}

export function yamlSingleQuoted(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

function ompProviderBlock(ctx, port, indent = "  ") {
  const rootPath = ctx.root.replace(/\\/g, "/");
  const block = `${MARKER_BEGIN}
# Provider ZCode — GLM-5.3 / GLM-5.3-Flash via the local zcode-proxy
# (start-plan access). Efforts low/high/max; default max. See EFFORT_MAPPING.md.
  zcode:
    name: ZCode
    baseUrl: http://127.0.0.1:${port}
    api: anthropic-messages
    apiKey: ${JSON.stringify(ctx.key())}
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
  return block.split("\n").map((line) => (line.startsWith("  ") ? indent + line.slice(2) : line)).join("\n");
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
    let newModels = removeManagedBlock(models, BLOCK_NAME);
    newModels = removeManagedBlock(newModels, LEGACY_BLOCK_NAME);

    const { YAML, doc } = parseYamlDocument(ctx, newModels, "models.yml");
    if (!doc.contents || doc.contents.constructor?.name !== "YAMLMap") {
      throw new Error("models.yml: top level must be a mapping");
    }
    const providersPair = topLevelPair(doc, "providers", "models.yml");
    const providers = providersPair.value;
    const providersImplicitlyEmpty = providers?.constructor?.name === "Scalar"
      && providers.value === null
      && providers.source === "";
    if (!providersImplicitlyEmpty && (!providers || !YAML.isMap(providers))) {
      throw new Error("models.yml: top-level `providers` must be a mapping");
    }
    if (!providersImplicitlyEmpty && providers.items.some((pair) => pair.key?.value === "zcode")) {
      throw new Error(
        "models.yml already has a hand-written `zcode` provider entry outside any managed block — " +
          "merge or rename it manually; nothing was changed (zcode-kit does not overwrite hand-written entries)",
      );
    }
    const { indent, insertAt } = providerLayout(newModels, providersPair);
    const block = ompProviderBlock(ctx, port, indent);
    const separator = insertAt > 0 && newModels[insertAt - 1] !== "\n" ? "\n" : "";
    newModels = newModels.slice(0, insertAt) + separator + block + "\n" + newModels.slice(insertAt);
    parseYamlDocument(ctx, newModels, "models.yml (staged)");

    let newConfig = existsSync(configYml) ? readFileSync(configYml, "utf8") : null;
    let configChanged = false;
    if (newConfig) {
      const extensionPath = join(agentDir, "extensions", EXT_ENTRY_NAME).replace(/\\/g, "/");
      const edited = editConfigYaml(ctx, newConfig, extensionPath);
      newConfig = edited.text;
      configChanged = edited.changed;
    }

    const extSrc = join(ctx.root, "proxy", "zcode-proxy-autostart.ts");
    const extDst = join(agentDir, "extensions", EXT_ENTRY_NAME);
    // Pin a real native interpreter while setup has a working runtime/PATH.
    // A packaged OMP execPath is not a Node/Bun interpreter. Never use it.
    let runtime;
    if (/^(?:node|bun)(?:\.exe)?$/i.test(basename(process.execPath))) runtime = process.execPath;
    else {
      try { runtime = resolveCommand(process.platform === "win32" ? "node.exe" : "node"); }
      catch (err) { if (err.code !== "ENOENT") throw err; runtime = resolveBun(ctx.root); }
    }
    ensureDir(ctx, dirname(extDst));
    const literal = (p) => JSON.stringify(p.replace(/\\/g, "/")).slice(1, -1);
    const extContent = readFileSync(extSrc, "utf8")
      .replaceAll("__ZCODE_OM_ROOT__", () => literal(ctx.root))
      .replaceAll("__ZCODE_OM_KEY_FILE__", () => literal(ctx.keyFile))
      .replaceAll("__ZCODE_OM_RUNTIME__", () => literal(runtime))
      .replaceAll("__ZCODE_OM_FAILURE_DETAILS__", () => JSON.stringify(JSON.stringify(PREFLIGHT_DETAILS)).slice(1, -1))
      .replaceAll("__ZCODE_OM_WARNINGS__", () => JSON.stringify(JSON.stringify(PREFLIGHT_WARNINGS)).slice(1, -1))
      .replaceAll("__ZCODE_OM_PORT__", () => String(port));
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
    let zcode;
    try {
      const { YAML, doc } = parseYamlDocument(ctx, models, "models.yml");
      const providersPair = topLevelPair(doc, "providers", "models.yml");
      zcode = YAML.isMap(providersPair.value) ? providersPair.value.get("zcode", true) : undefined;
    } catch (err) {
      checks.push({ name: "omp provider registered", ok: false, detail: err.message });
      checks.push({ name: "omp key resolver", ok: false, detail: "cannot verify providers.zcode.apiKey because models.yml is invalid" });
      checks.push({ name: "omp extension installed", ok: existsSync(join(agentDir, "extensions", EXT_ENTRY_NAME)) });
      return checks;
    }
    checks.push({ name: "omp provider registered", ok: Boolean(zcode), detail: "providers.zcode in models.yml" });
    // Self-check (F11): the managed block carries a LITERAL key because omp
    // 18+ no longer evaluates the old `!node` resolver tag (requests then fail
    // with 401). The embedded key must equal THIS copy's proxy key — after a
    // copy switch or key rotation an old value keeps failing; detect it so the
    // user is pointed at `zcode-kit setup`, which rebuilds the block.
    const apiKey = zcode?.get?.("apiKey");
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      checks.push({ name: "omp key resolver", ok: false, detail: "providers.zcode has no literal apiKey (old !node format — omp 18+ ignores it, requests fail with 401) — rerun zcode-kit setup; then restart omp" });
    } else if (apiKey !== ctx.key()) {
      checks.push({ name: "omp key resolver", ok: false, detail: "providers.zcode.apiKey does not match this copy's proxy key — rerun zcode-kit setup from this copy to repair; then restart omp" });
    } else {
      checks.push({ name: "omp key resolver", ok: true, detail: "key current" });
    }
    checks.push({ name: "omp extension installed", ok: existsSync(join(agentDir, "extensions", EXT_ENTRY_NAME)) });
    return checks;
  },
};
