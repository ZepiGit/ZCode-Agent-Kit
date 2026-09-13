// Central file-commit helper for adapters: transaction recording + dry-run
// guard in one place, so `integrate --dry-run` can never write a file.
import { writeFileSync, renameSync } from "node:fs";

/**
 * Write `content` to `file` atomically, unless ctx.dryRun is set.
 * - dry-run: logs "would write" and returns { wrote: false }.
 * - normal: records the file in the transaction, writes via temp+rename.
 */
export function commitFile(ctx, tx, file, content, { log = () => {} } = {}) {
  if (ctx.dryRun) {
    log(`  would write: ${file}`);
    return { wrote: false };
  }
  const tmp = file + ".zcode-staging";
  writeFileSync(tmp, content);
  tx.touch(file);
  renameSync(tmp, file);
  log(`  wrote ${file}`);
  return { wrote: true };
}
