// `zcode-kit rollback [tx-id]`: undo the newest (or the named) transaction.
// Exit 0 when every step was undone (or nothing was recorded), 1 when a file
// conflict or an external step needing a manual undo remains.
import { join } from "node:path";
import { acquireLock, releaseLock, rollbackTransaction } from "../../lib/transaction.mjs";
import { ensureState } from "../../lib/state.mjs";
import { stdoutLine } from "./common.mjs";

/** @param {{ positional: string[] }} args */
export async function run({ positional }, { kit }) {
  const id = positional[1] ?? null;
  // Rollback mutates the same files as setup — serialize on the same lock.
  ensureState(kit);
  acquireLock(kit.backupDir);
  let r;
  try {
    r = rollbackTransaction(kit.backupDir, id);
  } finally {
    releaseLock(join(kit.backupDir, ".setup-lock"));
  }
  if (!r.id) return { exitCode: 0, records: [stdoutLine("nothing to roll back")] };
  const records = [];
  for (const t of r.restored) records.push(stdoutLine(`restored: ${t}`));
  for (const t of r.removed) records.push(stdoutLine(`removed (kit-created): ${t}`));
  for (const c of r.conflicts) records.push(stdoutLine(`CONFLICT (left untouched): ${c}`));
  for (const e of r.external) records.push(stdoutLine(`manual undo required: ${e.description}\n  -> ${e.undoHint}`));
  return { exitCode: r.complete ? 0 : 1, records };
}
