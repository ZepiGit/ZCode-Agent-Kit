// Adapter: Continue — schema-v1 YAML config (~/.continue/config.yaml).
// Additive: kit model entries are appended to `models:` under names the kit
// owns ("ZCode GLM-5.3(-Flash)"); existing models and roles are preserved.
// API key as a secret reference: ${ZCODE_PROXY_KEY} resolved by the harness at
// runtime; the kit launcher sets it process-locally.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { commitFile } from "../../lib/edit.mjs";

const BLOCK_BEGIN = "# >>> zcode-kit managed models — do not edit inside";
const BLOCK_END = "# <<< zcode-kit";

function kitModels(ctx) {
  const base = `http://127.0.0.1:${ctx.port()}/v1`;
  return [
    {
      name: "ZCode GLM-5.3",
      provider: "openai",
      model: "glm-5.3",
      apiBase: base,
      apiKey: "${ZCODE_PROXY_KEY}",
      roles: ["chat", "edit", "apply"],
      capabilities: { toolUse: true },
    },
    {
      name: "ZCode GLM-5.3-Flash",
      provider: "openai",
      model: "glm-5.3-flash",
      apiBase: base,
      apiKey: "${ZCODE_PROXY_KEY}",
      roles: ["chat", "edit", "apply"],
      capabilities: { toolUse: true, imageInput: true },
    },
  ];
}

function yamlBlock(ctx) {
  const lines = [BLOCK_BEGIN];
  for (const m of kitModels(ctx)) {
    lines.push(`  - name: ${m.name}`);
    lines.push(`    provider: ${m.provider}`);
    lines.push(`    model: ${m.model}`);
    lines.push(`    apiBase: ${m.apiBase}`);
    lines.push(`    apiKey: ${m.apiKey}`);
    lines.push(`    roles: [${m.roles.join(", ")}]`);
    const caps = Object.entries(m.capabilities).map(([k, v]) => `${k}: ${v}`).join(", ");
    lines.push(`    capabilities: { ${caps} }`);
  }
  lines.push(BLOCK_END);
  return lines.join("\n");
}

function upsertModels(text, ctx) {
  const begin = text.indexOf(BLOCK_BEGIN);
  if (begin !== -1) {
    const end = text.indexOf(BLOCK_END, begin);
    if (end === -1) throw new Error("zcode-kit managed block begin without end marker in Continue config");
    // Replace exactly the block span — the block never owns the following
    // newline (it was part of the original document), so do not swallow it.
    const cutEnd = end + BLOCK_END.length;
    return text.slice(0, begin) + yamlBlock(ctx) + text.slice(cutEnd);
  }
  if (/^models:\s*$/m.test(text)) {
    const m = text.match(/^models:\s*$/m);
    const insertAt = m.index + m[0].length;
    return text.slice(0, insertAt) + "\n" + yamlBlock(ctx) + text.slice(insertAt);
  }
  // AUD-010: a column-0 `models:` key in another form (inline value like
  // `models: []`) cannot be safely block-edited here. Appending a second
  // top-level `models:` would produce a duplicate YAML key — refuse instead.
  // (Commented-out or indented occurrences are inert and safe to append to.)
  if (/^models[ \t]*:/m.test(text)) {
    throw new Error(
      "continue: config.yaml contains a `models:` key in a form the kit cannot safely edit " +
      "(inline value or unusual formatting) — refusing to append a duplicate key. " +
      "Reformat the models section so `models:` stands alone on a line, then re-run.",
    );
  }
  const sep = text.trimEnd() === "" ? "" : text.replace(/\s*$/, "").endsWith("---") ? "\n" : "\n";
  return text.replace(/\s*$/, "") + `${sep}models:\n${yamlBlock(ctx)}\n`;
}

export default {
  id: "continue",
  label: "Continue",
  protocol: "OpenAI-compatible (provider: openai, apiBase → /v1)",
  primarySource: "https://docs.continue.dev/customize/model-providers/top-level/openai (checked 2026-09-13; schema v1)",
  detect: (home) => existsSync(join(home, ".continue")),

  apply(ctx, tx, log) {
    const configYaml = join(ctx.home, ".continue", "config.yaml");
    const text = existsSync(configYaml) ? readFileSync(configYaml, "utf8") : "";
    const updated = upsertModels(text, ctx);
    if (updated === text) {
      log("  continue: already up to date");
      return { changed: false };
    }
    const { wrote } = commitFile(ctx, tx, configYaml, updated);
    if (wrote) log(`  continue: kit models appended to ${configYaml} (existing models/roles preserved)`);
    log("  note: apiKey uses ${ZCODE_PROXY_KEY} — set by the kit launcher or your shell profile");
    return { changed: wrote };
  },

  verify(ctx) {
    const configYaml = join(ctx.home, ".continue", "config.yaml");
    if (!existsSync(configYaml)) return [{ name: "continue models registered", ok: null, detail: "not installed" }];
    const text = readFileSync(configYaml, "utf8");
    return [{ name: "continue models registered", ok: text.includes("ZCode GLM-5.3") && text.includes(BLOCK_BEGIN), detail: "managed block present" }];
  },
};
