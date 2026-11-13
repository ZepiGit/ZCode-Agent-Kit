// `zcode-kit accounts …`: the offline account-pool wrapper. The proxy CLI
// owns encryption, redaction, its JSON documents and the exit code (no exit
// status: 1); this command never starts a serving process. `enable|disable`
// switch the Account Rotator in the proxy config through a transaction
// (exit 0), record it as the stored Account Rotator decision
// (generated/account-rotator.json, the one setup asks about), and restart a
// running proxy of this kit.
// A missing account id or an unknown subcommand: exit 2.
//
// Streams and rendering: the
// text views of `accounts` and `accounts health` render here through the
// output module (cli/accounts-report.mjs) — one table with an active marker,
// one number format, and every next step naming `zcode-kit …`.
// `--json` and `--live` keep forwarding the proxy CLI verbatim with an
// inherited terminal, so the JSON documents stay byte-stable (C2) and the
// store's own diagnostics stay on stderr. `doctor`, `quota`, `explain`,
// `remove|pause|resume` and `unlock` keep forwarding as before.
import { acquireLock, beginTransaction, releaseLock } from "../../lib/transaction.mjs";
import { ensureState } from "../../lib/state.mjs";
import { configureAccountRotator, recordRotatorDecision, restartForAccountChange } from "../account-setup.mjs";
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
  if (sub === "doctor" || sub === "quota") {
    return forward(["auth", "accounts", sub, ...(flags.json === true ? ["--json"] : [])]);
  }
  if (sub === "health") {
    if (flags.json === true) return forward(["auth", "accounts", "health", "--json"]);
    return rendered(["auth", "accounts", "health", "--json"], ctx);
  }
  if (sub !== undefined && sub !== "--json" && sub !== "--live") {
    return { exitCode: 2, records: [stderrLine("Usage: zcode-kit accounts [--json|--live] | accounts remove|pause|resume ID [--yes] | accounts unlock [--force]")] };
  }
  if (flags.json === true || flags.live === true) {
    const cliArgs = ["auth", "accounts"];
    if (flags.json === true) cliArgs.push("--json");
    if (flags.live === true) cliArgs.push("--live");
    return forward(cliArgs);
  }
  return rendered(["auth", "accounts", "--json"], ctx);
}

/**
 * One offline view through the output module (cli/accounts-report.mjs): the
 * proxy CLI's redacted JSON in, records out. The report builder loads on
 * use, like the doctor's (the launcher process stays lean).
 */
async function rendered(cliArgs, ctx) {
  const res = proxyCli(ctx, cliArgs, { stdio: ["ignore", "pipe", "inherit"] });
  const { proxyAccountRecords } = await import("../accounts-report.mjs");
  return proxyAccountRecords(cliArgs, { exitCode: res.status, stdout: res.stdout ?? "" });
}

async function toggle(enable, ctx) {
  const { kit, env } = ctx;
  assertNotCheckoutWrite(kit, env);
  ensureState(kit);
  const lock = acquireLock(kit.backupDir);
  const tx = beginTransaction(kit.backupDir, `zcode-kit accounts ${enable ? "enable" : "disable"}`);
  let result;
  try {
    result = configureAccountRotator(kit, tx, enable, (cliArgs, opts) => proxyCli(ctx, cliArgs, opts));
    // One meaning: this is also the stored answer setup
    // reads, in the same transaction. An unreadable decision file is left alone.
    recordRotatorDecision(kit, tx, enable, "accounts");
  } finally { try { tx.finish(); } finally { releaseLock(lock); } }
  if (result.changed) await restartForAccountChange(kit);
  return {
    exitCode: 0,
    records: [stdoutLine(enable ? `Account Rotator enabled (${result.accountCount} saved accounts). New logins are added automatically.` : "Account Rotator disabled. Saved accounts are kept.")],
  };
}
