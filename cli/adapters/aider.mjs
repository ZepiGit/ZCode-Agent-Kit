// Adapter: Aider — process-local environment via the kit launcher
// (bin/zcode-aider.cmd|.sh): OPENAI_API_BASE + OPENAI_API_KEY + default model
// openai/glm-5.3. No system-wide setx, no ~/.aider.conf.yml modification —
// the user's own Aider config stays untouched.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { commitFile, ensureDir } from "../../lib/edit.mjs";

export default {
  id: "aider",
  label: "Aider",
  protocol: "OpenAI-compatible via OPENAI_API_BASE + openai/<model> mapping",
  primarySource: "https://aider.chat/docs/llms/openai-compat.html (checked 2026-09-13)",
  detect: (home) => detectOnPath("aider") || detectOnPath("aider-chat"),

  apply(ctx, tx, log) {
    ensureDir(ctx, ctx.generated);
    const envPath = join(ctx.generated, "aider-zcode.env");
    // The launcher sources this file in a child process — never global env.
    const content = `# Sourced by bin/zcode-aider.* — process-local only, never global env.
OPENAI_API_BASE=http://127.0.0.1:${ctx.port()}/v1
OPENAI_API_KEY=${ctx.key()}
ZCODE_AIDER_DEFAULT_MODEL=openai/glm-5.3
`;
    commitFile(ctx, tx, envPath, content);
    log(`  wrote ${envPath} (contains the local proxy key — excluded via local git excludes)`);
    log("  use via: bin/zcode-aider.cmd|.sh  (e.g. bin\\zcode-aider.cmd --model openai/glm-5.3-flash)");
    return { changed: true };
  },

  verify(ctx) {
    return [{ name: "aider launcher env", ok: existsSync(join(ctx.generated, "aider-zcode.env")), detail: "generated/aider-zcode.env" }];
  },
};

import { execFileSync } from "node:child_process";
function detectOnPath(cmd) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
