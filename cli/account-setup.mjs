import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { commitFile } from "../lib/edit.mjs";

export const ACCOUNT_ROTATOR_QUESTION = "Do you want to activate the Account Rotator feature?";

export function rotatorChoice(value) {
  if (value === undefined) return undefined;
  if (typeof value === "string" && /^[yn]$/i.test(value.trim())) return value.trim().toLowerCase() === "y";
  throw new Error("Account Rotator choice must be y or n (--account-rotator or ZCODE_KIT_ACCOUNT_ROTATOR).");
}

export async function askAccountRotator({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  if (!input.isTTY || !output.isTTY || (env.CI && !/^(0|false)$/i.test(env.CI))) return undefined;
  const lines = createInterface({ input, output, terminal: true });
  try {
    output.write(`${ACCOUNT_ROTATOR_QUESTION} [y/n] `);
    for await (const answer of lines) {
      if (/^[yn]$/i.test(answer.trim())) return answer.trim().toLowerCase() === "y";
      output.write(`Please answer y or n.\n${ACCOUNT_ROTATOR_QUESTION} [y/n] `);
    }
    return undefined; // Closed input must never count as consent.
  } finally { lines.close(); }
}

/** Record the config change in the existing setup transaction; keep YAML comments/policies. */
export function configureAccountRotator(ctx, tx, enabled, runProxyCli) {
  const { parseDocument } = createRequire(join(ctx.proxySrc, "package.json"))("yaml");
  const source = readFileSync(ctx.config, "utf8");
  const doc = parseDocument(source, { strict: true, uniqueKeys: true, prettyErrors: false });
  if (doc.errors.length) throw new Error("Cannot update Account Rotator: proxy config is invalid.");
  const previous = doc.getIn(["auth", "accounts", "enabled"]);
  let accountCount;
  if (enabled) {
    const result = runProxyCli(["auth", "accounts", "import-current"]);
    if (result.status !== 0) throw new Error("Cannot activate Account Rotator: current account import failed. Configuration was not changed.");
    accountCount = JSON.parse(result.stdout).accountCount;
  }
  if (previous !== enabled) {
    doc.setIn(["auth", "accounts", "enabled"], enabled);
    // An external editor must not lose changes made while the import ran.
    if (readFileSync(ctx.config, "utf8") !== source) throw new Error("Proxy config changed during account import; run setup again.");
    commitFile(ctx, tx, ctx.config, String(doc));
  }
  if (process.env.ZCODE_ACCOUNTS_ENABLED !== undefined) {
    console.warn("ZCODE_ACCOUNTS_ENABLED overrides this setting. Unset it to use the saved Account Rotator choice.");
  }
  return { changed: previous !== enabled, accountCount };
}

export async function restartForAccountChange(ctx) {
  const { createManager } = await import("../proxy/zcode-proxy-manager.mjs");
  const manager = createManager({ root: ctx.root, home: ctx.home });
  const health = await manager.healthIdentify();
  if (health === "ours") {
    if (await manager.restart() !== 0) throw new Error("Account Rotator setting saved, but proxy restart failed. Run zcode-kit doctor.");
  } else if (manager.readPidFile()) {
    console.warn("Account Rotator setting saved. A running proxy could not be verified; run zcode-kit doctor before restarting it.");
  }
}
