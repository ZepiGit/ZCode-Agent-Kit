import fs from "node:fs";
import path from "node:path";

// The CDN disk tier's bound (ADR-0009 correction 2, spec §7 "CDN cache, disk").
// Removing an entry changes disk use only: a removed entry that is still fresh
// becomes a network fetch once the memory tier no longer holds it, so the size
// prune evicts the oldest entries and only when the directory is above the cap.
export const CDN_DISK_MAX_BYTES = 256 * 1024 * 1024;

export interface CdnDiskPruneOptions {
  directory: string;
  now: () => number;
  maxBytes: number;
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
  /** Retrieval time from the envelope header. */
  time: number;
  dev: number;
  ino: number;
  mtimeMs: number;
}

const ENTRY_NAME = /^[0-9a-f]{64}$/;
const HEADER_MAX = 513;

function readHeader(file: string, size: number): { fetchedAt: number } | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(HEADER_MAX, size));
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, read).indexOf(10);
    if (end < 0) return null;
    const header = JSON.parse(buffer.subarray(0, end).toString("utf8"));
    if (header?.version !== 1 || !Number.isSafeInteger(header.fetchedAt) || header.length !== size - end - 1) return null;
    return { fetchedAt: header.fetchedAt };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

/**
 * Keeps one CDN cache directory bounded. A full scan runs at start; after a
 * write the pruner first checks the directory as it last saw it plus its own
 * writes, and scans again only when that view exceeds the bound.
 */
export class CdnDiskPruner {
  private readonly directory: string;
  private readonly now: () => number;
  private readonly maxBytes: number;
  private readonly sizes = new Map<string, number>();
  private bytes = 0;

  constructor(options: CdnDiskPruneOptions) {
    this.directory = options.directory;
    this.now = options.now;
    this.maxBytes = options.maxBytes;
  }

  /** Called after this process published an envelope of `size` bytes under `name`. */
  afterWrite(name: string, size: number): CdnDiskPruneReport | null {
    this.bytes += size - (this.sizes.get(name) ?? 0);
    this.sizes.set(name, size);
    if (this.bytes <= this.maxBytes) return null;
    return this.prune();
  }

  /** A full scan and prune. Never throws: disk trouble must not fail a solve. */
  prune(): CdnDiskPruneReport {
    const report: CdnDiskPruneReport = { entries: 0, bytes: 0, removed: 0, removedBytes: 0 };
    this.sizes.clear();
    this.bytes = 0;
    let names: string[];
    try { names = fs.readdirSync(this.directory); } catch { return report; }
    const entries: Entry[] = [];
    for (const name of names) {
      if (!ENTRY_NAME.test(name)) continue;
      const file = path.join(this.directory, name);
      let stat: fs.Stats;
      try { stat = fs.lstatSync(file); } catch { continue; }
      if (!stat.isFile()) continue;
      const header = readHeader(file, stat.size);
      if (!header) continue;
      entries.push({ name, size: stat.size, time: header.fetchedAt, dev: stat.dev, ino: stat.ino, mtimeMs: stat.mtimeMs });
    }
    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    const kept = new Set(entries);
    if (total > this.maxBytes) {
      const oldestFirst = [...entries].sort((a, b) => a.time - b.time || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of oldestFirst) {
        if (total <= this.maxBytes) break;
        if (this.remove(entry)) { total -= entry.size; kept.delete(entry); report.removed++; report.removedBytes += entry.size; }
      }
    }
    for (const entry of kept) this.sizes.set(entry.name, entry.size);
    this.bytes = total;
    report.entries = entries.length;
    report.bytes = total;
    return report;
  }

  /** True when the entry is gone afterwards (removed here or already vanished). */
  private remove(entry: Entry): boolean {
    const file = path.join(this.directory, entry.name);
    try {
      fs.unlinkSync(file);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  }
}
