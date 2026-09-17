// Ownership-aware transactions for kit config edits.
//
// Every apply wraps its file operations in a transaction:
//   - tx.touch(target)   before the first write to a file. An existing file is
//                        backed up (kind "modify"), an absent one recorded as
//                        "create" — rollback deletes it instead of "restoring".
//   - tx.external(hint)  for registrations outside the filesystem (e.g. a
//                        harness CLI registration); rollback prints the hint.
//   - tx.finish()        records post-hashes and writes the manifest.
//
// Rollback is three-way: a stored original is only restored when the current
// file still matches the hash recorded at commit time. Changes made after the
// transaction are reported as conflicts, never clobbered. Backup names carry
// the transaction id and an op index — basename collisions are impossible by
// construction.

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

const TOOL = "zcode-kit transaction format 1";

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function normalizeTarget(p) {
  return p.replace(/[\\/]+$/, "");
}

// Transaction ids sort by creation time even within one second (B-10): a
// millisecond stamp plus a per-process sequence, then a random suffix. Ids are
// only ever used as file-name components, so they are also validated on input.
let idSequence = 0;
function newId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  idSequence = (idSequence + 1) % 1000;
  return `${stamp}-${String(idSequence).padStart(3, "0")}-${randomBytes(3).toString("hex")}`;
}
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
function assertId(id) {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new Error(`invalid transaction id: ${String(id).slice(0, 60)}`);
  return id;
}
function assertOp(op) {
  if (!op || typeof op !== "object") throw new Error("corrupt manifest: op is not an object");
  if (op.kind === "external") return op;
  if (!["modify", "create"].includes(op.kind)) throw new Error(`corrupt manifest: unknown op kind ${String(op.kind)}`);
  if (typeof op.target !== "string" || !isAbsolute(op.target)) throw new Error("corrupt manifest: op target must be an absolute path");
  if (op.kind === "modify" && (typeof op.backup !== "string" || op.backup !== basename(op.backup) || !op.backup)) {
    throw new Error("corrupt manifest: backup name must be a plain file name");
  }
  return op;
}
function writePrivate(file, content) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { mode: 0o600 });
}
function copyPrivate(src, dst) {
  mkdirSync(dirname(dst), { recursive: true, mode: 0o700 });
  copyFileSync(src, dst);
  try { chmodSync(dst, 0o600); } catch {}
}

// ------------------------------------------------------------------ locking
// One setup at a time per backup dir. The lock is a wx-created file holding
// the holder pid plus a random owner nonce.
//
// AUD-001: there is NO automatic stale takeover, in either direction:
//   - A stale observation (dead holder) cannot authorize deleting the path,
//     because the unlink is unconditional — two contenders that both observe
//     the same stale lock can delete each other's freshly created locks and
//     both believe they own the lock (lost mutual exclusion).
//   - releaseLock only deletes the file when the on-disk nonce still matches
//     our own acquisition.
// A leftover lock from a crashed setup is removed manually (the error names
// the exact path and what to check). pidAlive treats only a real
// "no such process" (ESRCH) as dead — EPERM/unknown errors fail closed.

const OWNED_LOCKS = new Map(); // lockFile -> nonce of OUR acquisition

export function acquireLock(backupDir) {
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const lockFile = join(backupDir, ".setup-lock");
  const nonce = randomBytes(8).toString("hex");
  try {
    const fd = openSync(lockFile, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), nonce }));
    } finally {
      closeSync(fd);
    }
    OWNED_LOCKS.set(lockFile, nonce);
    return lockFile;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    let holder = null;
    try {
      holder = JSON.parse(readFileSync(lockFile, "utf8"));
    } catch {}
    if (holder && typeof holder.pid === "number" && pidAlive(holder.pid)) {
      throw new Error(`another setup is running (pid ${holder.pid}, started ${holder.startedAt}). If that is wrong (e.g. pid reuse), remove ${lockFile}`);
    }
    throw new Error(
      `stale or unreadable setup lock at ${lockFile}` +
        (holder ? ` (holder pid ${holder.pid} is not alive, started ${holder.startedAt})` : "") +
        ` — refusing automatic takeover because ownership cannot be atomically verified. ` +
        `If no setup is actually running, remove ${lockFile} manually and retry.`,
    );
  }
}

export function releaseLock(lockFile) {
  const nonce = OWNED_LOCKS.get(lockFile);
  if (!nonce) return; // we never acquired it in this process — do not touch it
  OWNED_LOCKS.delete(lockFile);
  try {
    const holder = JSON.parse(readFileSync(lockFile, "utf8"));
    if (holder.nonce !== nonce) return; // file belongs to a successor — leave it alone
  } catch {
    return; // unreadable/gone — nothing provably ours to delete
  }
  try { unlinkSync(lockFile); } catch {}
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // AUD-001: only "no such process" proves death; EPERM (exists, not ours
    // to signal) and unknown errors fail closed — the process counts as alive.
    return err?.code !== "ESRCH";
  }
}

// -------------------------------------------------------------- transaction
export class Transaction {
  constructor(backupDir, label) {
    this.id = newId();
    this.backupDir = backupDir;
    this.label = label;
    this.startedAt = new Date().toISOString();
    this.ops = [];
    this.dir = join(backupDir, `tx-${this.id}`);
    this.finishedId = undefined;
  }

  /** Record a file the kit is about to write (existing → modify, new → create). */
  touch(target) {
    const t = normalizeTarget(target);
    if (this.ops.some((op) => op.target === t)) return this;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (existsSync(t)) {
      const idx = this.ops.length;
      const backupName = `${String(idx).padStart(3, "0")}-${basename(t)}`;
      copyPrivate(t, join(this.dir, backupName));
      this.ops.push({ kind: "modify", target: t, backup: backupName, preHash: sha256File(t) });
    } else {
      this.ops.push({ kind: "create", target: t });
    }
    this.persistJournal();
    return this;
  }

  expectWrite(target, content) {
    this.touch(target);
    const op = this.ops.find(op => op.target === normalizeTarget(target));
    op.expectedHashes = [...new Set([...(op.expectedHashes ?? []), ...(op.expectedHash ? [op.expectedHash] : [])])];
    op.expectedHash = createHash("sha256").update(content).digest("hex");
    this.persistJournal();
    return this;
  }

  /** Record an action outside the filesystem, with a manual undo hint. */
  external(description, undoHint) {
    this.ops.push({ kind: "external", description, undoHint });
    this.persistJournal();
    return this;
  }

  /**
   * AUD-004 write-ahead journal: every op is persisted to an in-progress
   * manifest BEFORE the mutation happens (backup first, then journal — so a
   * journal entry always has its backup on disk). A crash after a rename but
   * before finish() therefore leaves a discoverable record.
   */
  persistJournal() {
    const journal = join(this.backupDir, `tx-${this.id}.manifest.in-progress.json`);
    const tmp = `${journal}.tmp`;
    const body = JSON.stringify({
      format: TOOL,
      id: this.id,
      label: this.label,
      startedAt: this.startedAt,
      status: "in-progress",
      opCount: this.ops.length,
      ops: this.ops,
    }, null, 2) + "\n";
    writePrivate(tmp, body);
    renameSync(tmp, journal);
  }

  /**
   * Persist the manifest; returns the transaction id, or null when no-op.
   * Idempotent: a second call returns the first result. A failed first write
   * is NOT hidden — the second call retries and surfaces the error again.
   */
  finish() {
    if (this.finishedId !== undefined) return this.finishedId;
    if (this.ops.length === 0) {
      try { rmSync(join(this.backupDir, `tx-${this.id}.manifest.in-progress.json`), { force: true }); } catch {}
      try { rmSync(this.dir, { recursive: true, force: true }); } catch {}
      this.finishedId = null;
      return null;
    }
    for (const op of this.ops) {
      if (op.kind !== "external" && existsSync(op.target)) op.postHash = op.expectedHash ?? sha256File(op.target);
    }
    mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    const manifest = {
      format: TOOL,
      id: this.id,
      label: this.label,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      opCount: this.ops.length,
      ops: this.ops,
    };
    // Exclusive create: fail rather than overwrite an existing manifest.
    const manifestPath = join(this.backupDir, `tx-${this.id}.manifest.json`);
    if (existsSync(manifestPath)) throw new Error(`manifest already exists: ${manifestPath}`);
    const fd = openSync(manifestPath, "wx", 0o600);
    let saved = false;
    try {
      writeFileSync(fd, JSON.stringify(manifest, null, 2) + "\n");
      saved = true;
    } finally {
      closeSync(fd);
      if (!saved) { try { unlinkSync(manifestPath); } catch {} }
    }
    // Committed — the in-progress journal has served its purpose.
    try { unlinkSync(join(this.backupDir, `tx-${this.id}.manifest.in-progress.json`)); } catch {}
    this.finishedId = this.id;
    return this.id;
  }
}

export function beginTransaction(backupDir, label) {
  return new Transaction(backupDir, label);
}

// ------------------------------------------------------------------ rollback
function loadManifest(path) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.ops)) throw new Error(`corrupt manifest: ${path}`);
  for (const op of manifest.ops) assertOp(op);
  return manifest;
}

function readManifest(backupDir, txId) {
  if (txId) {
    assertId(txId);
    const path = join(backupDir, `tx-${txId}.manifest.json`);
    if (existsSync(path)) return { id: txId, manifest: loadManifest(path), path };
    const journal = join(backupDir, `tx-${txId}.manifest.in-progress.json`);
    if (existsSync(journal)) return { id: txId, manifest: loadManifest(journal), path: journal };
    throw new Error(`no transaction "${txId}" in ${backupDir}`);
  }
  const ids = listTransactions(backupDir);
  if (ids.length === 0) return null;
  const last = ids[ids.length - 1];
  return readManifest(backupDir, last);
}

function manifestComplete(manifest) {
  return (manifest.ops ?? []).every((op) => op.rolledBack === true);
}

/**
 * Active (not fully rolled back) transactions, oldest first. Ordering uses
 * the recorded startedAt (ids of older kits had second resolution), with the
 * id as a tiebreaker.
 */
export function listTransactions(backupDir) {
  if (!existsSync(backupDir)) return [];
  const entries = new Map(); // id -> { startedAt, committed }
  for (const f of readdirSync(backupDir)) {
    let id = null;
    let committed = false;
    if (f.startsWith("tx-") && f.endsWith(".manifest.json")) { id = f.slice(3, -".manifest.json".length); committed = true; }
    else if (f.startsWith("tx-") && f.endsWith(".manifest.in-progress.json")) id = f.slice(3, -".manifest.in-progress.json".length);
    if (!id || !ID_RE.test(id)) continue;
    if (entries.has(id) && !committed) continue; // committed manifest wins over its journal
    let manifest;
    try { manifest = loadManifest(join(backupDir, f)); } catch { continue; }
    if (manifestComplete(manifest)) continue;
    entries.set(id, { startedAt: typeof manifest.startedAt === "string" ? manifest.startedAt : "", committed });
  }
  return [...entries.entries()]
    .sort((a, b) => (a[1].startedAt < b[1].startedAt ? -1 : a[1].startedAt > b[1].startedAt ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id]) => id);
}

function restoreFromBackup(backupDir, id, op) {
  mkdirSync(dirname(op.target), { recursive: true });
  const tmp = `${op.target}.zcode-staging-${process.pid}-${randomBytes(6).toString('hex')}`;
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    try { writeFileSync(fd, readFileSync(join(backupDir, `tx-${id}`, op.backup))); }
    finally { closeSync(fd); }
    renameSync(tmp, op.target);
  } catch (err) { try { unlinkSync(tmp); } catch {} throw err; }
}

/**
 * Roll back the newest (or named) transaction. Ownership-aware: a file whose
 * current hash no longer matches the committed post-hash is reported as a
 * conflict and left alone. Every op that has been undone is marked
 * `rolledBack` in the manifest, so a repeated rollback never re-reports it as
 * a conflict; the manifest and backups stay as evidence. `complete` is true
 * only when every op (including externals actually undone via the
 * `undoExternal` callback) has been rolled back.
 */
export function rollbackTransaction(backupDir, txId = null, options = {}) {
  const lockFile = join(backupDir, '.setup-lock');
  if (OWNED_LOCKS.has(lockFile)) return rollbackLocked(backupDir, txId, options);
  acquireLock(backupDir);
  try { return rollbackLocked(backupDir, txId, options); }
  finally { releaseLock(lockFile); }
}

function rollbackLocked(backupDir, txId, { undoExternal = null } = {}) {
  const found = readManifest(backupDir, txId);
  if (!found) return { id: null, restored: [], removed: [], conflicts: [], external: [], complete: true };
  const { id, manifest, path } = found;
  // AUD-004: an in-progress journal means the transaction never committed —
  // crash recovery restores the recorded pre-state where that is provable.
  const inProgress = manifest.status === "in-progress";
  const result = { id, restored: [], removed: [], conflicts: [], external: [], complete: true };
  for (const op of manifest.ops ?? []) {
    if (op.rolledBack) continue;
    if (op.kind === "external") {
      let undone = false;
      if (undoExternal) {
        try { undone = undoExternal(op) === true; } catch { undone = false; }
      }
      if (undone) op.rolledBack = true;
      else { result.external.push(op); result.complete = false; }
      continue;
    }
    const exists = existsSync(op.target);
    if (op.kind === "modify") {
      if (inProgress) {
        if (!exists) {
          restoreFromBackup(backupDir, id, op);
          result.restored.push(`${op.target} (had been deleted)`);
          op.rolledBack = true;
        } else if (sha256File(op.target) === op.preHash) {
          // untouched since backup — nothing to recover
          op.rolledBack = true;
        } else if ([op.expectedHash, ...(op.expectedHashes ?? [])].includes(sha256File(op.target))) {
          restoreFromBackup(backupDir, id, op);
          result.restored.push(op.target);
          op.rolledBack = true;
        } else {
          // The journal has no committed post-hash: the change may be the
          // kit's interrupted write or an unrelated edit — fail closed.
          result.conflicts.push(`${op.target} differs from its backup and the transaction never committed — left untouched (restore manually from ${join(backupDir, `tx-${id}`, op.backup)} if it was the kit's write)`);
          result.complete = false;
        }
        continue;
      }
      if (!exists) {
        restoreFromBackup(backupDir, id, op);
        result.restored.push(`${op.target} (had been deleted)`);
        op.rolledBack = true;
        continue;
      }
      if ([op.postHash, ...(op.expectedHashes ?? [])].includes(sha256File(op.target))) {
        restoreFromBackup(backupDir, id, op);
        result.restored.push(op.target);
        op.rolledBack = true;
      } else {
        result.conflicts.push(`${op.target} changed after the transaction — left untouched`);
        result.complete = false;
      }
    } else if (op.kind === "create") {
      if (inProgress) {
        if (!exists) op.rolledBack = true;
        else if ([op.expectedHash, ...(op.expectedHashes ?? [])].includes(sha256File(op.target))) {
          unlinkSync(op.target);
          result.removed.push(op.target);
          op.rolledBack = true;
        } else {
          result.conflicts.push(`${op.target} has no matching journalled write hash — left in place`);
          result.complete = false;
        }
        continue;
      }
      if (!exists) {
        op.rolledBack = true;
        continue;
      }
      if ([op.postHash, ...(op.expectedHashes ?? [])].includes(sha256File(op.target))) {
        unlinkSync(op.target);
        result.removed.push(op.target);
        op.rolledBack = true;
      } else {
        result.conflicts.push(`${op.target} (created by the kit) changed afterwards — left in place`);
        result.complete = false;
      }
    }
  }
  manifest.rolledBackAt = result.complete ? new Date().toISOString() : manifest.rolledBackAt ?? null;
  const tmp = `${path}.tmp-${process.pid}`;
  writePrivate(tmp, JSON.stringify(manifest, null, 2) + "\n");
  renameSync(tmp, path);
  return result;
}

export { sha256File };
