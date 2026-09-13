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
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const TOOL = "zcode-kit transaction format 1";
const LOCK_TTL_MS = 15 * 60_000;

function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function normalizeTarget(p) {
  return p.replace(/[\\/]+$/, "");
}

// ------------------------------------------------------------------ locking
// One setup at a time per backup dir. The lock is a wx-created file holding
// the holder pid; a dead holder or an expired deadline is taken over.

export function acquireLock(backupDir) {
  mkdirSync(backupDir, { recursive: true });
  const lockFile = join(backupDir, ".setup-lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockFile, "wx");
      try {
        writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      } finally {
        closeSync(fd);
      }
      return lockFile;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let holder = null;
      try {
        holder = JSON.parse(readFileSync(lockFile, "utf8"));
      } catch {}
      const age = holder ? Date.now() - statSync(lockFile).mtimeMs : Infinity;
      const stale = !holder || age > LOCK_TTL_MS || !pidAlive(holder.pid);
      if (!stale) throw new Error(`another setup is running (pid ${holder.pid}, started ${holder.startedAt}). If that is wrong, remove ${lockFile}`);
      try { unlinkSync(lockFile); } catch {}
    }
  }
  throw new Error("could not acquire setup lock");
}

export function releaseLock(lockFile) {
  try { unlinkSync(lockFile); } catch {}
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// -------------------------------------------------------------- transaction
export class Transaction {
  constructor(backupDir, label) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.id = `${stamp}-${randomBytes(3).toString("hex")}`;
    this.backupDir = backupDir;
    this.label = label;
    this.startedAt = new Date().toISOString();
    this.ops = [];
    this.dir = join(backupDir, `tx-${this.id}`);
  }

  /** Record a file the kit is about to write (existing → modify, new → create). */
  touch(target) {
    const t = normalizeTarget(target);
    if (this.ops.some((op) => op.target === t)) return this;
    mkdirSync(this.dir, { recursive: true });
    if (existsSync(t)) {
      const idx = this.ops.length;
      const backupName = `${String(idx).padStart(3, "0")}-${basename(t)}`;
      copyFileSync(t, join(this.dir, backupName));
      this.ops.push({ kind: "modify", target: t, backup: backupName, preHash: sha256File(t) });
    } else {
      this.ops.push({ kind: "create", target: t });
    }
    return this;
  }

  /** Record an action outside the filesystem, with a manual undo hint. */
  external(description, undoHint) {
    this.ops.push({ kind: "external", description, undoHint });
    return this;
  }

  /** Persist the manifest; returns the transaction id, or null when no-op. */
  finish() {
    if (this.ops.length === 0) {
      try { rmSync(this.dir, { recursive: true, force: true }); } catch {}
      return null;
    }
    for (const op of this.ops) {
      if (op.kind !== "external" && existsSync(op.target)) op.postHash = sha256File(op.target);
    }
    mkdirSync(this.backupDir, { recursive: true });
    const manifest = {
      format: TOOL,
      id: this.id,
      label: this.label,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      opCount: this.ops.length,
      ops: this.ops,
    };
    const tmp = join(this.backupDir, `tx-${this.id}.manifest.tmp`);
    writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
    // Exclusive rename target: fail rather than overwrite an existing manifest.
    const manifestPath = join(this.backupDir, `tx-${this.id}.manifest.json`);
    if (existsSync(manifestPath)) throw new Error(`manifest already exists: ${manifestPath}`);
    try {
      const fd = openSync(manifestPath, "wx");
      writeFileSync(fd, readFileSync(tmp));
      closeSync(fd);
    } finally {
      try { unlinkSync(tmp); } catch {}
    }
    return this.id;
  }
}

export function beginTransaction(backupDir, label) {
  return new Transaction(backupDir, label);
}

// ------------------------------------------------------------------ rollback
function readManifest(backupDir, txId) {
  const path = txId
    ? join(backupDir, `tx-${txId}.manifest.json`)
    : null;
  if (path) {
    if (!existsSync(path)) throw new Error(`no transaction "${txId}" in ${backupDir}`);
    return { id: txId, manifest: JSON.parse(readFileSync(path, "utf8")) };
  }
  const ids = listTransactions(backupDir);
  if (ids.length === 0) return null;
  return { id: ids[ids.length - 1], manifest: JSON.parse(readFileSync(join(backupDir, `tx-${ids[ids.length - 1]}.manifest.json`), "utf8")) };
}

export function listTransactions(backupDir) {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((f) => f.startsWith("tx-") && f.endsWith(".manifest.json"))
    .sort()
    .map((f) => f.slice(3, -".manifest.json".length));
}

/**
 * Roll back the newest (or named) transaction. Ownership-aware: a file whose
 * current hash no longer matches the committed post-hash is reported as a
 * conflict and left alone.
 */
export function rollbackTransaction(backupDir, txId = null) {
  const found = readManifest(backupDir, txId);
  if (!found) return { id: null, restored: [], removed: [], conflicts: [], external: [] };
  const { id, manifest } = found;
  const result = { id, restored: [], removed: [], conflicts: [], external: [] };
  for (const op of manifest.ops ?? []) {
    if (op.kind === "external") {
      result.external.push(op);
      continue;
    }
    const exists = existsSync(op.target);
    if (op.kind === "modify") {
      if (!exists) {
        copyFileSync(join(backupDir, `tx-${id}`, op.backup), op.target);
        result.restored.push(`${op.target} (had been deleted)`);
        continue;
      }
      if (op.postHash && sha256File(op.target) === op.postHash) {
        copyFileSync(join(backupDir, `tx-${id}`, op.backup), op.target);
        result.restored.push(op.target);
      } else {
        result.conflicts.push(`${op.target} changed after the transaction — left untouched`);
      }
    } else if (op.kind === "create") {
      if (!exists) {
        continue;
      }
      if (op.postHash && sha256File(op.target) === op.postHash) {
        unlinkSync(op.target);
        result.removed.push(op.target);
      } else {
        result.conflicts.push(`${op.target} (created by the kit) changed afterwards — left in place`);
      }
    }
  }
  return result;
}

export { sha256File };
