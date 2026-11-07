import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { commitFile, ensureDir } from "../lib/edit.mjs";
import { withLineEndingsOf } from "../lib/line-endings.mjs";
import { ABORTED, askYesNo } from "./harness-consent.mjs";

export const ACCOUNT_ROTATOR_QUESTION = "Do you want to activate the Account Rotator feature?";
// The question's default is "no" ([y/N], design-language §4.9): Enter declines.
const ROTATOR_ASK = { defaultAnswer: false };

export function rotatorChoice(value) {
  if (value === undefined) return undefined;
  if (typeof value === "string" && /^[yn]$/i.test(value.trim())) return value.trim().toLowerCase() === "y";
  throw new Error("Account Rotator choice must be y or n (--account-rotator or ZCODE_KIT_ACCOUNT_ROTATOR).");
}

/** Independent of the per-harness questions: same y/n rules, separate answer, default no. */
export function askAccountRotator(streams = {}) {
  return askYesNo(ACCOUNT_ROTATOR_QUESTION, streams, ROTATOR_ASK);
}

// The stored decision (ticket 42, Round 1 Q8). One file next to the harness
// choices, written through the transaction of the command that decided, so a
// rollback of that command removes or restores it:
//   <state>/generated/account-rotator.json
//   { "schema": 1, "decision": "yes" | "no", "source", "decidedAt" }
// source: interactive (answered on a terminal), flag (--account-rotator), env
// (ZCODE_KIT_ACCOUNT_ROTATOR), accounts (accounts enable|disable), migration
// (auth.accounts.enabled: true from an older kit, recorded without asking).
// It decides only WHETHER setup asks; the rotator itself still reads
// auth.accounts.enabled from the proxy config, which only an answer changes.
export const ACCOUNT_ROTATOR_DECISION_FILE = "account-rotator.json";

export function rotatorDecisionFile(ctx) {
  return join(ctx.generated, ACCOUNT_ROTATOR_DECISION_FILE);
}

/**
 * `{ decision: "yes" | "no" | undefined, source, unreadable, error }`. A file
 * that cannot be read or has an unknown shape (a newer kit's schema, a hand
 * edit) fails closed: undecided, reported, and never overwritten.
 */
export function readRotatorDecision(ctx) {
  const file = rotatorDecisionFile(ctx);
  if (!existsSync(file)) return { decision: undefined, unreadable: false };
  try {
    const entry = JSON.parse(readFileSync(file, "utf8"));
    if (!entry || entry.schema !== 1 || (entry.decision !== "yes" && entry.decision !== "no")) throw new Error("unsupported format");
    return { decision: entry.decision, source: String(entry.source ?? "unknown"), unreadable: false };
  } catch (err) {
    return { decision: undefined, unreadable: true, error: `${file}: ${err.message} — fix or remove the file; the Account Rotator counts as undecided until then` };
  }
}

/**
 * Store `enabled` through `tx`. Idempotent: the same decision is never
 * rewritten (whatever its source), and an unreadable file is never
 * overwritten. Returns false only when nothing could be recorded.
 */
export function recordRotatorDecision(ctx, tx, enabled, source, stored = readRotatorDecision(ctx), now = () => new Date().toISOString()) {
  if (stored.unreadable) return false;
  const decision = enabled ? "yes" : "no";
  if (stored.decision === decision || ctx.dryRun) return true;
  ensureDir(ctx, ctx.generated);
  commitFile(ctx, tx, rotatorDecisionFile(ctx), JSON.stringify({ schema: 1, decision, source, decidedAt: now() }, null, 2) + "\n");
  return true;
}

/** auth.accounts.enabled in the proxy config: true, false, undefined (absent), or null (unreadable or invalid). */
function configuredRotator(ctx) {
  try {
    if (!existsSync(ctx.config)) return undefined;
    const { parseDocument } = createRequire(join(ctx.proxySrc, "package.json"))("yaml");
    const doc = parseDocument(readFileSync(ctx.config, "utf8"), { strict: true, uniqueKeys: true, prettyErrors: false });
    return doc.errors.length ? null : doc.getIn(["auth", "accounts", "enabled"]);
  } catch {
    return null;
  }
}

/**
 * The Account Rotator step of `setup`, in this order:
 *   1. an explicit answer (`--account-rotator`, ZCODE_KIT_ACCOUNT_ROTATOR)
 *      wins, is applied and recorded (source flag/env), even after an abort;
 *   2. after Ctrl-C at an earlier question nothing else happens;
 *   3. migration: no stored decision and auth.accounts.enabled: true → "yes"
 *      recorded without asking (Round 1 Q8 cond 1); `false` stays undecided;
 *   4. a stored decision stands (nothing asked, nothing applied) unless
 *      `reask` on a terminal;
 *   5. otherwise the question, on a terminal only; the answer is applied and
 *      recorded (source interactive). No terminal, closed input or Ctrl-C
 *      change nothing.
 * Only an answer changes the proxy config, through configureAccountRotator.
 * Returns `{ changed, aborted }`: changed = the config changed (restart the proxy).
 */
export async function decideAccountRotator({ ctx, tx, explicit, explicitSource, reask, prompter, aborted, progress, warn, runProxyCli }) {
  progress("\n  Keep authorized logins as separate encrypted accounts.");
  progress("  New logins are saved automatically while the feature is enabled.");
  const stored = readRotatorDecision(ctx);
  if (stored.error) warn(stored.error);
  const apply = (choice, source) => {
    const result = configureAccountRotator(ctx, tx, choice, runProxyCli);
    if (!recordRotatorDecision(ctx, tx, choice, source, stored)) warn(`the Account Rotator answer was applied but not recorded (${rotatorDecisionFile(ctx)} is unreadable)`);
    progress(choice ? `  [OK] Account Rotator enabled (${result.accountCount} saved accounts).` : "  [OK] Account Rotator disabled. Saved accounts are kept.");
    if (choice && result.accountCount === 0) progress("  Add your first account: zcode-kit auth login zai");
    return { changed: result.changed, aborted };
  };
  const unchanged = (wasAborted) => {
    progress(wasAborted ? "  Account Rotator question skipped (aborted); setting unchanged." : "  Account Rotator setting unchanged (no interactive answer).");
    progress("  Enable later: zcode-kit accounts enable");
    return { changed: false, aborted: wasAborted };
  };
  if (explicit !== undefined) return apply(explicit, explicitSource);
  if (aborted) return unchanged(true);
  let decision = stored.decision;
  const configured = configuredRotator(ctx);
  if (decision === undefined && !stored.unreadable && configured === true) {
    recordRotatorDecision(ctx, tx, true, "migration", stored);
    decision = "yes";
  }
  if (decision !== undefined && !(reask && prompter.interactive)) {
    const saved = decision === "yes";
    if (configured !== null && (configured === true) !== saved) {
      // The config was edited by hand since: say so and change nothing.
      progress(`  [WARN] Account Rotator saved choice is ${decision}, but proxy/config.yaml has it ${saved ? "disabled" : "enabled"}; setting unchanged.`);
      progress("  Pick one: zcode-kit accounts enable, or zcode-kit accounts disable");
      return { changed: false, aborted: false };
    }
    progress(`  [INFO] Account Rotator ${saved ? "enabled" : "disabled"} (saved choice; not asked again).`);
    progress(`  Change it: zcode-kit accounts ${saved ? "disable" : "enable"}, or zcode-kit setup --reask`);
    return { changed: false, aborted: false };
  }
  let choice;
  try {
    choice = await prompter.ask(ACCOUNT_ROTATOR_QUESTION, ROTATOR_ASK);
  } catch (err) {
    if (err?.code !== ABORTED) throw err;
    return unchanged(true);
  }
  if (choice === undefined) return unchanged(false);
  return apply(choice, "interactive");
}

/**
 * Record the config change in the existing setup transaction; keep YAML
 * comments/policies and line endings. The yaml library writes LF (keeping a
 * CRLF only inside comments it carries over), so the document is written with
 * the file's own line endings (lib/line-endings.mjs).
 */
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
    commitFile(ctx, tx, ctx.config, withLineEndingsOf(source, String(doc)));
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
  } else if (health === "down" && manager.readPidFile() && manager.pidAlive(manager.readPidFile().pid)) {
    // A live recorded proxy that does not answer may be hung. start()
    // replaces it only with the hung-own proof and refuses anything unproven,
    // so the new setting takes effect without touching unverified processes.
    // A dead record is not a running proxy: nothing to restart (the setting
    // applies on the next start), and a config command must not boot one.
    if (await manager.start() !== 0) {
      console.warn("Account Rotator setting saved. The recorded proxy could not be verified or restarted; run zcode-kit proxy restart, then zcode-kit doctor.");
    }
  } else if (manager.readPidFile()) {
    console.warn("Account Rotator setting saved. A running proxy could not be verified; run zcode-kit doctor before restarting it.");
  }
}
