// Adapter: Cline — GUI-configured VS Code extension. The kit does NOT touch
// VS Code internal state (state.vscdb / globalState is off-limits per the
// security rules). Instead it writes a prepared values sheet the user enters
// in the Cline settings panel: status = manual-confirmation-required.
// The Cline CLI has a documented setup command (`cline auth -p openai -k -b -m`,
// stored in ~/.cline/data/settings/providers.json); the sheet prints it. The kit
// does not write providers.json itself: the file format is not documented.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { commitFile, ensureDir } from "../../lib/edit.mjs";

export default {
  id: "cline",
  label: "Cline",
  protocol: "OpenAI-compatible provider settings (entered in the extension UI)",
  primarySource: "https://docs.cline.bot/provider-config/openai-compatible and https://docs.cline.bot/cli/cli-reference (checked 2026-11-06)",

  apply(ctx, tx, log) {
    ensureDir(ctx, ctx.generated);
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

Cline CLI: set up the same provider once from a terminal (it is stored in
~/.cline/data/settings/providers.json):

    cline auth -p openai -k <local proxy key> -b http://127.0.0.1:${ctx.port()}/v1 -m glm-5.3

Use \`-m glm-5.3-flash\` for the Flash model.

Start the proxy first: \`node proxy/zcode-proxy-manager.mjs start\`
`;
    commitFile(ctx, tx, sheet, values);
    log(`  wrote ${sheet} (manual-confirmation-required: enter the values in the Cline UI)`);
    return { changed: true, manualConfirmationRequired: true };
  },

  /** The values sheet lives in this installation's state: kit-owned by construction. */
  owned(ctx) {
    return existsSync(join(ctx.generated, "cline-zcode-values.md"));
  },

  verify(ctx) {
    return [{ name: "cline values sheet", ok: existsSync(join(ctx.generated, "cline-zcode-values.md")), detail: "generated — GUI entry still required" }];
  },
};
