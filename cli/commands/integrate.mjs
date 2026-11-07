// `zcode-kit integrate <harness> [--dry-run]`: explicit consent for one
// harness; its adapter applies the integration through a transaction and the
// decision is recorded. `--dry-run` shows what would be written and writes
// nothing. Exit 0; an unknown harness is exit 2. Output is streamed
// (ctx.progress): the adapter and bootstrap log as they work.
import { join } from "node:path";
import { acquireLock, beginTransaction, releaseLock } from "../../lib/transaction.mjs";
import { detectHarnesses } from "../../lib/detect.mjs";
import { ensureState } from "../../lib/state.mjs";
import { bootstrap } from "../context.mjs";
import { readHarnessChoices, recordHarnessChoice } from "../harness-consent.mjs";
import { assertNotCheckoutWrite, loadAdapter, unknownHarness } from "./common.mjs";

/** @param {{ positional: string[], flags: Record<string, unknown> }} args */
export async function run({ positional, flags }, ctx) {
  const { kit, env, progress, progressError } = ctx;
  const id = positional[1];
  const unknown = unknownHarness(id);
  if (unknown) return unknown;
  const { default: adapter } = await loadAdapter(id);
  const detected = detectHarnesses(kit.home);
  if (flags["dry-run"]) {
    progress(`== integrate ${id}: DRY RUN (no changes written) ==`);
    progress(`  detected: ${detected[id] ? "yes" : "no"}`);
    kit.dryRun = true;
    kit.tx = null;
    const txNoop = { touch: (f) => progress(`  would record: ${f}`), external: (d, h) => progress(`  would register: ${d} (undo: ${h})`) };
    adapter.apply(kit, txNoop, (m) => progress("  " + m));
    return { exitCode: 0, records: [] };
  }
  assertNotCheckoutWrite(kit, env);
  ensureState(kit);
  acquireLock(kit.backupDir);
  const tx = beginTransaction(kit.backupDir, `zcode-kit integrate ${id}`);
  kit.tx = tx;
  let txId = null;
  try {
    bootstrap(kit);
    progress(`== integrate ${id}: ${adapter.label} ==`);
    adapter.apply(kit, tx, (m) => progress(m));
    // An explicit integrate command is consent for this harness: later
    // setup/update/repair runs keep it current without asking again. It is
    // not MCP consent (integrate never registers the bridge), and it neither
    // grants nor revokes an MCP consent recorded earlier.
    const choices = readHarnessChoices(kit);
    if (!recordHarnessChoice(kit, tx, choices, id, "configured", "integrate", undefined, { mcp: choices.harnesses[id]?.mcp === true })) {
      progress(`WARN: the decision for ${id} was not recorded — its decision file is unreadable; fix or remove it (see zcode-kit setup).`);
    }
  } finally {
    let finishErr = null;
    try { txId = tx.finish(); } catch (err) { finishErr = err; }
    releaseLock(join(kit.backupDir, ".setup-lock"));
    if (txId) progress(`transaction ${txId} recorded — undo with: zcode-kit rollback ${txId}`);
    if (finishErr) progressError(`WARN: recording the transaction failed (${finishErr.message})`);
  }
  return { exitCode: 0, records: [] };
}
