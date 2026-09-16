// Adapter: Continue — schema-v1 YAML config (~/.continue/config.yaml).
// Additive: kit model entries are appended to `models:` under names the kit
// owns ("ZCode GLM-5.3(-Flash)"); existing models and roles are preserved.
// A quoted literal local proxy key works in Continue without external secret
// provisioning. ${VAR} is not Continue's ${{ secrets.NAME }} template syntax.
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
      apiKey: ctx.key(),
      roles: ["chat", "edit", "apply"],
      capabilities: { toolUse: true },
    },
    {
      name: "ZCode GLM-5.3-Flash",
      provider: "openai",
      model: "glm-5.3-flash",
      apiBase: base,
      apiKey: ctx.key(),
      roles: ["chat", "edit", "apply"],
      capabilities: { toolUse: true, imageInput: true },
    },
  ];
}

function yamlBlock(ctx, indent = "  ") {
  const lines = [BLOCK_BEGIN];
  for (const m of kitModels(ctx)) {
    lines.push(`  - name: ${m.name}`);
    lines.push(`    provider: ${m.provider}`);
    lines.push(`    model: ${m.model}`);
    lines.push(`    apiBase: ${m.apiBase}`);
    lines.push(`    apiKey: ${JSON.stringify(m.apiKey)}`);
    lines.push(`    roles: [${m.roles.join(", ")}]`);
    const caps = Object.entries(m.capabilities).map(([k, v]) => `${k}: ${v}`).join(", ");
    lines.push(`    capabilities: { ${caps} }`);
  }
  lines.push(BLOCK_END);
  return lines.map((line) => line.startsWith("  ") ? indent + line.slice(2) : line).join("\n");
}

function upsertModels(text, ctx) {
  // Check before replacing an existing managed block as well as inserting one.
  // Quoted keys are recognized for refusal, not silently duplicated.
  const keys = [...text.matchAll(/^(?:models|"models"|'models')[ \t]*:[^\r\n]*/gm)];
  if (keys.length > 1) {
    throw new Error("continue: config.yaml contains duplicate `models:` keys — cannot safely edit");
  }
  const header = keys[0];
  // Only a block header or an empty flow sequence can be edited losslessly.
  // Horizontal whitespace keeps this match from consuming following lines;
  // comments need separation so `[]#text` is not mistaken for empty YAML.
  const supported = header?.[0].match(/^models:(?:[ \t]+(\[[ \t]*\]))?(?:[ \t]+#[^\r\n]*)?[ \t]*$/);
  if (header && !supported) {
    throw new Error(
      "continue: config.yaml contains a `models:` key in a form the kit cannot safely edit " +
      "(nonempty inline value or unusual formatting) — refusing to append a duplicate key. " +
      "Reformat the models section as a block list under `models:`, then re-run.",
    );
  }
  if (supported?.[1]) {
    const normalized = header[0].replace(/^(models:[ \t]*)\[[ \t]*\]/, "$1");
    text = text.slice(0, header.index) + normalized + text.slice(header.index + header[0].length);
    header[0] = normalized;
  }
  const begin = text.indexOf(BLOCK_BEGIN);
  if (begin !== -1) {
    const end = text.indexOf(BLOCK_END, begin);
    if (end === -1) throw new Error("zcode-kit managed block begin without end marker in Continue config");
    // Reinsert at the sequence tail, repairing older prepended blocks without
    // keeping a kit model ahead of the user's first/default model.
    const cutEnd = end + BLOCK_END.length;
    const followingNewline = text.slice(cutEnd).match(/^\r?\n/)?.[0] ?? "";
    return upsertModels(text.slice(0, begin) + text.slice(cutEnd + followingNewline.length), ctx);
  }
  if (header) {
    const headerEnd = header.index + header[0].length;
    const newline = text.slice(headerEnd, headerEnd + 2) === "\r\n" ? "\r\n" : "\n";
    let indent;
    let sequenceEnd;
    // Append after the existing sequence, not before the user's default model.
    // Preserve its indentation (including valid indentless block sequences).
    for (const line of text.slice(headerEnd).matchAll(/[^\r\n]+(?:\r?\n|$)|\r?\n/g)) {
      const body = line[0].replace(/\r?\n$/, "");
      if (/^[ \t]*(?:#|$)/.test(body)) {
        // A deeply indented # line can be literal block-scalar content.
        if (indent !== undefined && body.startsWith(indent + " ")) {
          sequenceEnd = headerEnd + line.index + line[0].length;
        }
        continue;
      }
      const item = body.match(/^([ ]*)-(?:[ \t]|$)/);
      if (!item && /^[^ \t]/.test(body)) break; // next top-level key
      if (indent === undefined) {
        if (!item) throw new Error("continue: models block is not a sequence — cannot safely edit");
        indent = item[1];
      } else if (body.search(/[^ ]/) <= indent.length && (!item || item[1] !== indent)) {
        throw new Error("continue: inconsistent models sequence indentation — cannot safely edit");
      }
      sequenceEnd = headerEnd + line.index + line[0].length;
    }
    if (sequenceEnd !== undefined) {
      const before = text.slice(0, sequenceEnd);
      const separator = before.endsWith("\n") ? "" : newline;
      return before + separator + yamlBlock(ctx, indent) + newline + text.slice(sequenceEnd);
    }
    return text.slice(0, headerEnd) + newline + yamlBlock(ctx) + text.slice(headerEnd);
  }
  // Commented-out or indented occurrences are inert and safe to append to.
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
    if (!existsSync(configYaml)) {
      // Mirror the omp adapter: an absent config means the harness is not
      // installed — do not create foreign directories on the user's machine
      // (a raw ENOENT from staging into a missing ~/.continue leaked here).
      log("  continue: skipped (no ~/.continue/config.yaml)");
      return { changed: false };
    }
    const text = readFileSync(configYaml, "utf8");
    const updated = upsertModels(text, ctx);
    if (updated === text) {
      log("  continue: already up to date");
      return { changed: false };
    }
    const { wrote } = commitFile(ctx, tx, configYaml, updated);
    if (wrote) log(`  continue: kit models appended to ${configYaml} (existing models/roles preserved)`);
    log("  note: managed models use this kit's local proxy key; re-run integration after key rotation");
    return { changed: wrote };
  },

  verify(ctx) {
    const configYaml = join(ctx.home, ".continue", "config.yaml");
    if (!existsSync(configYaml)) return [{ name: "continue models registered", ok: null, detail: "not installed" }];
    const text = readFileSync(configYaml, "utf8");
    const begin = text.indexOf(BLOCK_BEGIN);
    const end = text.indexOf(BLOCK_END, begin);
    const block = begin >= 0 && end >= 0 ? text.slice(begin, end + BLOCK_END.length) : "";
    const indent = block.match(/^([ ]*)- /m)?.[1] ?? "  ";
    const current = block === yamlBlock(ctx, indent);
    return [{
      name: "continue models registered",
      ok: current,
      detail: current ? "managed block and local proxy key current" : "managed block missing or stale — rerun zcode-kit setup",
    }];
  },
};
