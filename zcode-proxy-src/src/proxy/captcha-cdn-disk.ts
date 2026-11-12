import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// The CDN disk tier's bound.
// Removing an entry changes disk use only: a removed entry that is still fresh
// becomes a network fetch once the memory tier no longer holds it, so the size
// prune evicts the oldest entries and only when the directory is above the cap.
export const CDN_DISK_MAX_BYTES = 256 * 1024 * 1024;
// The age prune removes only entries already expired for this installation:
// the limit is max(14 days, configured TTL), so an installation with a TTL of
// up to ~24.8 days keeps serving its own entries. The
// 14-day floor leaves expired entries to installations sharing the directory
// with a longer TTL.
export const CDN_DISK_MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000;
// After a write, the pruner scans the directory again when its view (the last
// scan plus this process's writes) is older than this, so entries written by
// other installations sharing the directory are counted too.
export const CDN_DISK_RESCAN_MS = 60_000;

// Kits up to v0.2.31 wrote raw bodies in place under the entry name (no temp
// file, no envelope). Such a file modified this recently, or with a
// modification time ahead of the clock, may be in the middle of that write:
// it is counted but never deleted.
export const CDN_DISK_WRITE_GRACE_MS = 60_000;

export function cdnDiskAgeLimit(ttlMs: number): number {
  return Math.max(CDN_DISK_MIN_AGE_MS, ttlMs);
}

export interface CdnDiskPruneOptions {
  directory: string;
  now: () => number;
  maxBytes: number;
  /** Entries at least this old are pruned: cdnDiskAgeLimit(ttl). */
  ageLimitMs: number;
}

export interface CdnDiskPruneReport {
  /** Entries found (temp files and foreign names are not entries). */
  entries: number;
  /** Bytes of the entries left after the prune. */
  bytes: number;
  removed: number;
  removedBytes: number;
}

interface Entry {
  name: string;
  size: number;
  /** Retrieval time from the envelope header; the modification time for a legacy raw file. */
  time: number;
  /** A legacy raw file that may be being written in place: never deleted. */
  busy: boolean;
  /** The envelope header as scanned: what the entry holds, whatever inode carries it. */
  header: Header | null;
  dev: number;
  ino: number;
  mtimeMs: number;
}

interface Header { fetchedAt: number; length: number; sha256: unknown }

// Entry names: the hex sha256 of the URL (every kit since the sha1 names),
// and the older hex sha1. Anything else (temp files `<name>.<pid>.<uuid>.tmp`,
// other files, directories, links) is not an entry and is never touched.
const ENTRY_NAME = /^(?:[0-9a-f]{64}|[0-9a-f]{40})$/;
// A pruner deletes an entry by first renaming it to a private tombstone
// `<name>.<time>.<uuid>.prune` (see remove()). One left behind by a pruner that
// crashed in between is removed once its time is CDN_DISK_WRITE_GRACE_MS old.
const TOMBSTONE = /^(?:[0-9a-f]{64}|[0-9a-f]{40})\.(\d+)\.[0-9a-f-]{36}\.prune$/;
const HEADER_MAX = 513;

function readHeader(file: string, size: number): Header | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(HEADER_MAX, size));
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, read).indexOf(10);
    if (end < 0) return null;
    const header = JSON.parse(buffer.subarray(0, end).toString("utf8"));
    if (header?.version !== 1 || !Number.isSafeInteger(header.fetchedAt) || header.length !== size - end - 1) return null;
    return { fetchedAt: header.fetchedAt, length: header.length, sha256: header.sha256 };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

/**
 * Keeps one CDN cache directory bounded. A full scan runs at start. After a
 * write the pruner checks its view (the last scan plus its own writes) and
 * scans again when that view is above the byte cap, holds an entry that has
 * reached the age limit, or is CDN_DISK_RESCAN_MS old. A scan costs one
 * stat and one header read per entry, so it does not run on every write.
 */
export class CdnDiskPruner {
  private readonly directory: string;
  private readonly now: () => number;
  private readonly maxBytes: number;
  private readonly ageLimitMs: number;
  // The view: entry sizes as last scanned plus this process's own writes.
  private readonly sizes = new Map<string, number>();
  private bytes = 0;
  private scannedAt = -Infinity;
  private nextExpiry = Infinity;

  constructor(options: CdnDiskPruneOptions) {
    this.directory = options.directory;
    this.now = options.now;
    this.maxBytes = options.maxBytes;
    this.ageLimitMs = options.ageLimitMs;
  }

  /** Called after this process published an envelope of `size` bytes, fetched at `fetchedAt`, under `name`. */
  afterWrite(name: string, size: number, fetchedAt: number): CdnDiskPruneReport | null {
    this.bytes += size - (this.sizes.get(name) ?? 0);
    this.sizes.set(name, size);
    this.nextExpiry = Math.min(this.nextExpiry, fetchedAt + this.ageLimitMs);
    const now = this.now();
    const stale = !(now >= this.scannedAt && now - this.scannedAt < CDN_DISK_RESCAN_MS);
    if (this.bytes <= this.maxBytes && now < this.nextExpiry && !stale) return null;
    return this.prune();
  }

  /** A full scan and prune. Never throws: disk trouble must not fail a solve. */
  prune(): CdnDiskPruneReport {
    const report: CdnDiskPruneReport = { entries: 0, bytes: 0, removed: 0, removedBytes: 0 };
    const now = this.now();
    this.sizes.clear();
    this.bytes = 0;
    this.scannedAt = now;
    this.nextExpiry = Infinity;
    let names: string[];
    try { names = fs.readdirSync(this.directory); } catch { return report; }
    const entries: Entry[] = [];
    for (const name of names) {
      const tombstone = TOMBSTONE.exec(name);
      if (tombstone) {
        if (now - Number(tombstone[1]) >= CDN_DISK_WRITE_GRACE_MS) { try { fs.unlinkSync(path.join(this.directory, name)); } catch {} }
        continue;
      }
      if (!ENTRY_NAME.test(name)) continue;
      const file = path.join(this.directory, name);
      let stat: fs.Stats;
      try { stat = fs.lstatSync(file); } catch { continue; }
      if (!stat.isFile()) continue;
      const header = name.length === 64 ? readHeader(file, stat.size) : null;
      const time = header ? header.fetchedAt : stat.mtimeMs;
      const busy = !header && !(now - stat.mtimeMs >= CDN_DISK_WRITE_GRACE_MS);
      entries.push({ name, size: stat.size, time, busy, header, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs });
    }
    let total = 0;
    for (const entry of entries) total += entry.size;
    const kept = new Set<Entry>(entries);
    const replaced = new Map<string, number>();
    const removeEntry = (entry: Entry) => {
      const result = this.remove(entry);
      total += result.size - entry.size;
      if (result.gone) { kept.delete(entry); report.removed++; report.removedBytes += entry.size; }
      else if (result.replaced) { kept.delete(entry); replaced.set(entry.name, result.size); } // newer: not a candidate
    };
    for (const entry of entries) {
      if (!entry.busy && now - entry.time >= this.ageLimitMs) removeEntry(entry);
    }
    if (total > this.maxBytes) {
      const oldestFirst = [...kept].sort((a, b) => a.time - b.time || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of oldestFirst) {
        if (total <= this.maxBytes) break;
        if (!entry.busy && kept.has(entry)) removeEntry(entry);
      }
    }
    for (const [name, size] of replaced) this.sizes.set(name, size);
    for (const entry of kept) {
      this.sizes.set(entry.name, entry.size);
      if (!entry.busy) this.nextExpiry = Math.min(this.nextExpiry, entry.time + this.ageLimitMs);
    }
    this.bytes = total;
    report.entries = entries.length;
    report.bytes = total;
    return report;
  }

  /**
   * Removes one entry. `gone`: it no longer exists (removed here, or already
   * vanished because another pruner won the race). `replaced`: the name now
   * holds another installation's newer envelope, which is left alone; `size`
   * is what the name holds afterwards. Any other failure (Windows refuses to
   * rename a file another process holds open without delete sharing) leaves
   * the entry as it was.
   *
   * Another installation may publish under the same name at any moment, so
   * the entry is first renamed to a private tombstone: that is atomic and
   * takes whatever the name holds at that instant, and nothing else ever
   * writes the tombstone. Only then is it compared with what the scan judged:
   * the same file (dev, inode, size, mtime) holding the same envelope
   * (fetchedAt, length, sha256), because an inode number can be reused and a
   * timestamp tick is coarse. A match is deleted; anything else is put back
   * with a hard link, which fails if an even newer envelope took the name
   * meanwhile (the newer one stays).
   */
  private remove(entry: Entry): { gone: boolean; size: number; replaced: boolean } {
    const file = path.join(this.directory, entry.name);
    const tombstone = path.join(this.directory, `${entry.name}.${Math.max(0, Math.floor(this.now()))}.${crypto.randomUUID()}.prune`);
    try {
      fs.renameSync(file, tombstone);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { gone: true, size: 0, replaced: false };
      return { gone: false, size: entry.size, replaced: false };
    }
    let same = false;
    let size = 0;
    try {
      const taken = fs.lstatSync(tombstone);
      size = taken.size;
      same = taken.isFile() && taken.dev === entry.dev && taken.ino === entry.ino && taken.size === entry.size &&
        taken.mtimeMs === entry.mtimeMs && sameHeader(entry.header, entry.header ? readHeader(tombstone, taken.size) : null);
    } catch {
      return { gone: true, size: 0, replaced: false }; // the tombstone is private: nothing to put back
    }
    if (!same) return this.putBack(file, tombstone, size);
    try { fs.unlinkSync(tombstone); } catch {} // a leftover tombstone is no entry and is removed later
    return { gone: true, size: 0, replaced: false };
  }

  private putBack(file: string, tombstone: string, size: number): { gone: boolean; size: number; replaced: boolean } {
    try {
      fs.linkSync(tombstone, file);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // No hard links here (some network or FAT filesystems): rename back
      // when the name is still free.
      if (code !== "EEXIST") {
        try { fs.lstatSync(file); } catch {
          try { fs.renameSync(tombstone, file); return { gone: false, size, replaced: true }; } catch {}
        }
      }
    }
    try { fs.unlinkSync(tombstone); } catch {}
    let now = 0;
    try { const stat = fs.lstatSync(file); now = stat.isFile() ? stat.size : 0; } catch {}
    return { gone: false, size: now, replaced: true };
  }
}

function sameHeader(a: Header | null, b: Header | null): boolean {
  if (!a || !b) return a === b;
  return a.fetchedAt === b.fetchedAt && a.length === b.length && a.sha256 === b.sha256;
}
