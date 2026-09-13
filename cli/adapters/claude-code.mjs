// Adapter: Claude Code — opt-in launcher via generated --settings file.
// ~/.claude/settings.json is NEVER modified; the kit's wrapper routes through
// ZCode only when explicitly used (bin/zcode-claude.cmd / .sh).
// Community compatibility: Anthropic does not officially support routing to
// non-Claude models; tested against claude CLI (see SUPPORT_MATRIX).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { commitFile, ensureDir } from "../../lib/edit.mjs";

export default {
  id: "claude-code",
  label: "Claude Code",
  protocol: "Anthropic-compatible endpoint (CLI --settings env override)",
  primarySource: "https://code.claude.com/docs/en/llm-gateway (checked 2026-09-13)",
  detect: (home) => existsSync(join(home, ".claude")) || detectOnPath("claude"),

  apply(ctx, tx, log) {
    const port = ctx.port();
    ensureDir(ctx, ctx.generated);
    const settingsPath = join(ctx.generated, "claude-zcode-settings.json");
    const settings = {
      env: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        ANTHROPIC_AUTH_TOKEN: ctx.key(),
        ANTHROPIC_MODEL: "glm-5.3",
        ANTHROPIC_SMALL_FAST_MODEL: "glm-5.3-flash",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.3-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3",
        // glm-* models are not in Claude Code's built-in catalog; declare the
        // real context window so auto-compact math and window enforcement match.
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "1000000",
      },
    };
    // Kit-owned generated artifact: recorded so uninstall can remove it.
    const wrote = commitFile(ctx, tx, settingsPath, JSON.stringify(settings, null, 2) + "\n");
    if (wrote.wrote) {
      log(`  wrote ${settingsPath} (contains the local proxy key — excluded via local git excludes)`);
      log("  use via: bin\\zcode-claude.cmd (POSIX: bin/zcode-claude.sh) — add --model glm-5.3-flash for the flash model");
    }
    return { changed: wrote.wrote };
  },

  verify(ctx) {
    const settingsPath = join(ctx.generated, "claude-zcode-settings.json");
    return [{ name: "claude adapter artifact", ok: existsSync(settingsPath), detail: settingsPath }];
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
