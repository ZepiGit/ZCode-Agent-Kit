// Adapter: Kilo Code — GUI-configured VS Code extension with a documented
// "Custom provider" dialog (Provider API incl. Anthropic Messages). The kit
// prepares the exact values; entering them is manual-confirmation-required.
// kilo.jsonc model-level tuning is documented only sparsely upstream — the
// kit does not guess its schema (audit: no invented interfaces).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { commitFile, ensureDir } from "../../lib/edit.mjs";

export default {
  id: "kilo-code",
  label: "Kilo Code",
  protocol: "Anthropic Messages / OpenAI-compatible custom provider (extension UI)",
  primarySource: "https://kilo.ai/docs/ai-providers/openai-compatible (checked 2026-09-13)",
  detect: (home) => {
    const ext = join(home, ".vscode", "extensions");
    try {
      return existsSync(ext) && readdirSafe(ext).some((d) => /^kilocode\.kilo-code/i.test(d));
    } catch {
      return false;
    }
  },

  apply(ctx, tx, log) {
    ensureDir(ctx, ctx.generated);
    const sheet = join(ctx.generated, "kilo-zcode-values.md");
    const values = `# Kilo Code × ZCode — prepared values (manual confirmation required)

Kilo Code → Settings ⚙ → Providers → Custom provider:

| Setting        | Value |
|----------------|-------|
| Provider ID    | zcode |
| Display name   | ZCode (local proxy) |
| Provider API   | Anthropic Messages |
| Base URL       | http://127.0.0.1:${ctx.port()} |
| API key        | (local proxy key — run \`node cli/zcode-kit.mjs models --show-key\`) |
| Models         | glm-5.3, glm-5.3-flash |

Notes:
- Anthropic Messages uses the proxy root URL (no /v1 suffix), matching the
  /v1/messages endpoint contract.
- Models can also be auto-fetched from the /v1/models endpoint.
- kilo.jsonc: the upstream docs describe model-level tuning only in the
  "Custom Models" guide; the kit deliberately does not write kilo.jsonc.

Start the proxy first: \`node proxy/zcode-proxy-manager.mjs start\`
`;
    commitFile(ctx, tx, sheet, values);
    log(`  wrote ${sheet} (manual-confirmation-required: enter the values in the Kilo UI)`);
    return { changed: true, manualConfirmationRequired: true };
  },

  verify(ctx) {
    return [{ name: "kilo values sheet", ok: existsSync(join(ctx.generated, "kilo-zcode-values.md")), detail: "generated — GUI entry still required" }];
  },
};

import { readdirSync } from "node:fs";
function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
