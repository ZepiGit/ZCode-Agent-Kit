// Adapter: Cline — GUI-configured VS Code extension. The kit does NOT touch
// VS Code internal state (state.vscdb / globalState is off-limits per the
// security rules). Instead it writes a prepared values sheet the user enters
// in the Cline settings panel: status = manual-confirmation-required.
// The Cline CLI is intentionally NOT configured: its config interface is not
// documented (docs.cline.bot, checked 2026-09-13) and MCP alone does not count
// as model integration.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { commitFile } from "../../lib/edit.mjs";

export default {
  id: "cline",
  label: "Cline",
  protocol: "OpenAI-compatible provider settings (entered in the extension UI)",
  primarySource: "https://docs.cline.bot/provider-config/openai-compatible (checked 2026-09-13; no documented CLI/config-file interface)",
  detect: (home) => {
    const ext = join(home, ".vscode", "extensions");
    try {
      return existsSync(ext) && readdirSafe(ext).some((d) => /^saoudrizwan\.claude-dev/i.test(d));
    } catch {
      return false;
    }
  },

  apply(ctx, tx, log) {
    mkdirSync(ctx.generated, { recursive: true });
    const sheet = join(ctx.generated, "cline-zcode-values.md");
    const values = `# Cline × ZCode — prepared values (manual confirmation required)

Cline stores provider settings inside VS Code's internal state. The kit does
not touch that database. Enter these values once in Cline → Settings ⚙ →
API Provider:

| Setting            | Value |
|--------------------|-------|
| API Provider       | OpenAI Compatible |
| Base URL           | http://127.0.0.1:${ctx.port()}/v1 |
| API Key            | (local proxy key — run \`node cli/zcode-kit.mjs models --show-key\`) |
| Model ID           | glm-5.3  (or glm-5.3-flash) |
| Image Support      | on for glm-5.3-flash |

Start the proxy first: \`node proxy/zcode-proxy-manager.mjs start\`
`;
    commitFile(ctx, tx, sheet, values);
    log(`  wrote ${sheet} (manual-confirmation-required: enter the values in the Cline UI)`);
    return { changed: true, manualConfirmationRequired: true };
  },

  verify(ctx) {
    return [{ name: "cline values sheet", ok: existsSync(join(ctx.generated, "cline-zcode-values.md")), detail: "generated — GUI entry still required" }];
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
