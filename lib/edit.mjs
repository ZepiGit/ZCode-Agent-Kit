// Central mutation helpers for adapters: transaction recording + dry-run
// guard in one place, so `integrate --dry-run` can never write a file or
// create a directory. Adapters must not import write/mkdir primitives
// directly — every filesystem mutation goes through this module (ZAK-008).
import { mkdirSync, writeFileSync, renameSync, statSync, openSync, closeSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";

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
 * AUD-005: the staging path is a wx-created, pid+random sibling (0600) — a
 * predictable fixed name could clobber a preexisting file or follow a symlink.
 */
export function commitFile(ctx, tx, file, content, { log = () => {} } = {}) {
  if (ctx.dryRun) {
    log(`  would write: ${file}`);
    return { wrote: false };
  }
  const tmp = `${file}.zcode-staging-${process.pid}-${randomBytes(6).toString("hex")}`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
  try {
    tx.touch(file);
    renameSync(tmp, file);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
  log(`  wrote ${file}`);
  return { wrote: true };
}
