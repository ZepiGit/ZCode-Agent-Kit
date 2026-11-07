// `zcode-kit accounts …`: the offline account-pool wrapper. The proxy CLI
// owns encryption, redaction, its output (on the terminal) and the exit code
// (no exit status: 1); this command forwards to it and never starts a serving
// process. `enable|disable` switch the Account Rotator in the proxy config
// through a transaction (exit 0) and restart a running proxy of this kit.
// A missing account id or an unknown subcommand: exit 2.
import { acquireLock, beginTransaction, releaseLock } from "../../lib/transaction.mjs";
import { ensureState } from "../../lib/state.mjs";
import { configureAccountRotator, restartForAccountChange } from "../account-setup.mjs";
import { assertNotCheckoutWrite, proxyCli, stderrLine, stdoutLine } from "./common.mjs";

/** @param {{ positional: string[], flags: Record<string, unknown> }} args */
export async function run({ positional, flags }, ctx) {
  const sub = positional[1];
  if (sub === "enable" || sub === "disable") return toggle(sub === "enable", ctx);
  const forward = (cliArgs) => ({ exitCode: proxyCli(ctx, cliArgs, { stdio: "inherit" }).status ?? 1, records: [] });
  if (["remove", "pause", "resume"].includes(sub)) {
    const id = positional[2];
    if (!id || id.startsWith("--")) return { exitCode: 2, records: [stderrLine(`Usage: zcode-kit accounts ${sub} ID [--yes]`)] };
    return forward(["auth", "accounts", sub, id, ...(flags.yes === true ? ["--yes"] : [])]);
  }
  if (sub === "unlock") return forward(["auth", "accounts", "unlock", ...(flags.force === true ? ["--force"] : [])]);
  if (sub === "explain") {
    const cliArgs = ["auth", "accounts", "explain"];
    if (flags.model !== undefined) cliArgs.push("--model", String(flags.model));
    if (flags.operation !== undefined) cliArgs.push("--operation", String(flags.operation));
    if (flags.json === true) cliArgs.push("--json");
    return forward(cliArgs);
  }
  if (sub === "doctor" || sub === "quota" || sub === "health") {
    return forward(["auth", "accounts", sub, ...(flags.json === true ? ["--json"] : [])]);
  }
  if (sub !== undefined && sub !== "--json" && sub !== "--live") {
    return { exitCode: 2, records: [stderrLine("Usage: zcode-kit accounts [--json|--live] | accounts remove|pause|resume ID [--yes] | accounts unlock [--force]")] };
  }
  const cliArgs = ["auth", "accounts"];
  if (flags.json === true) cliArgs.push("--json");
  if (flags.live === true) cliArgs.push("--live");
  return forward(cliArgs);
}

async function toggle(enable, ctx) {
  const { kit, env } = ctx;
  assertNotCheckoutWrite(kit, env);
  ensureState(kit);
  const lock = acquireLock(kit.backupDir);
  const tx = beginTransaction(kit.backupDir, `zcode-kit accounts ${enable ? "enable" : "disable"}`);
  let result;
  try { result = configureAccountRotator(kit, tx, enable, (cliArgs, opts) => proxyCli(ctx, cliArgs, opts)); }
  finally { try { tx.finish(); } finally { releaseLock(lock); } }
  if (result.changed) await restartForAccountChange(kit);
  return {
    exitCode: 0,
    records: [stdoutLine(enable ? `Account Rotator enabled (${result.accountCount} saved accounts). New logins are added automatically.` : "Account Rotator disabled. Saved accounts are kept.")],
  };
}
