// Central mutation helpers for adapters: transaction recording + dry-run
// guard in one place, so `integrate --dry-run` can never write a file or
// create a directory. Adapters must not import write/mkdir primitives
// directly — every filesystem mutation goes through this module (ZAK-008).
import { mkdirSync, writeFileSync, renameSync, statSync } from "node:fs";

/**
 * Create `dir` (recursively), unless ctx.dryRun is set.
 * Returns { created, wouldCreate } — in dry-run nothing is created and
 * wouldCreate reports whether the directory is absent.
 */
export function ensureDir(ctx, dir) {
  const existed = existsDir(dir);
  if (ctx.dryRun) return { created: false, wouldCreate: !existed };
  if (!existed) mkdirSync(dir, { recursive: true });
  return { created: !existed, wouldCreate: false };
}

function existsDir(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

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
