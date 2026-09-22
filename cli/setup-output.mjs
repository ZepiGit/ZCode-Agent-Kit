import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Compact installer output; full adapter diagnostics remain available in a private log. */
export function setupOutput(ctx, compact = false) {
  const color = compact && process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (code, text) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
  const logPath = join(ctx.logDir, "install.log");
  if (compact) {
    mkdirSync(ctx.logDir, { recursive: true, mode: 0o700 });
    writeFileSync(logPath, `ZCode Agent Kit setup - ${new Date().toISOString()}\n`, { mode: 0o600 });
  }
  return {
    logPath,
    detail(...args) {
      const text = args.join(" ");
      if (!compact) return console.log(text);
      appendFileSync(logPath, text + "\n");
      if (/\bWARN:|MANUAL STEP REQUIRED/.test(text)) console.log(paint("33", `  [WARN] ${text.trim().replace(/^WARN: /, "")}`));
    },
    step(text) { if (compact) console.log(`\n  ${paint("1;36", text)}`); },
    ok(text) { if (compact) console.log(`  ${paint("32", "[OK]")}   ${text}`); },
    skip(text) { if (compact) console.log(`  [SKIP] ${text}`); },
    warn(text) { console.log(`  ${paint("33", "[WARN]")} ${text}`); },
  };
}
