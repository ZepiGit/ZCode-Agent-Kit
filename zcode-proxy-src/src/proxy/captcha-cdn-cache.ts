import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BoundedCollection } from "../runtime/bounded-collection.js";
import { CDN_DISK_MAX_BYTES, CdnDiskPruner } from "./captcha-cdn-disk.js";

export const DEFAULT_CDN_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_CDN_TTL_MS = 2_147_483_647;

// Zero disables BOTH tiers. Invalid explicit values fail configuration rather
// than silently enabling a cache the operator intended to disable.
export function parseCdnTtl(value: unknown = process.env.CAPTCHA_CDN_CACHE_TTL_MS): number {
  if (value === undefined) return DEFAULT_CDN_TTL_MS;
  if ((typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && !/^\d+$/.test(value))) {
    throw new RangeError("CAPTCHA_CDN_CACHE_TTL_MS must be an integer from 0 to 2147483647");
  }
  const ttl = Number(value);
  if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > MAX_CDN_TTL_MS) {
    throw new RangeError("CAPTCHA_CDN_CACHE_TTL_MS must be an integer from 0 to 2147483647");
  }
  return ttl;
}

export type CdnSource = "network" | "memory" | "disk";
export interface CdnEntry {
  readonly body: Buffer;
  readonly fetchedAt: number;
  readonly sha256: string;
  readonly source: CdnSource;
}
export interface CdnCacheOptions {
  directory?: string;
  ttlMs?: number;
  now?: () => number;
  /**
   * Body budget of the memory tier. Tests only (the seam-3 replay compares
   * 32 and 64 MiB); production always uses CDN_MEMORY_MAX_BYTES. Deliberately
   * not a config key or env override (Owner Proxy round 20 Q1).
   */
  memoryMaxBytes?: number;
  /**
   * Byte cap of the disk directory. Tests only (the seam-3 replay records a
   * workload above the cap); production always uses CDN_DISK_MAX_BYTES.
   */
  diskMaxBytes?: number;
}

const sha256 = (body: Buffer | string) => crypto.createHash("sha256").update(body).digest("hex");

// The memory tier's bound (ADR-0009, spec §7): ≤ 64 MB of memory and ≤ 256
// entries. It lives in the solver, so it also resets with each solver
// generation. Eviction changes memory use only: an evicted entry is read back
// from its disk envelope or fetched again.
// Bodies are capped at half the memory bound because the runtime keeps the
// memory of evicted bodies for a while: S2 measured a steady +26 MB over the
// held bytes (64 MiB held → 90 MB, 32 MiB → 58 MB; ticket 25). Confirmed as a
// code constant by Owner Proxy round 20 Q1.
export const CDN_MEMORY_MAX_ENTRIES = 256;
export const CDN_MEMORY_MAX_BYTES = 32 * 1024 * 1024;

export class CaptchaCdnCache {
  readonly directory: string;
  readonly ttlMs: number;
  private readonly now: () => number;
  private readonly memory: BoundedCollection<string, CdnEntry>;
  private readonly disk: CdnDiskPruner;
  private readonly pending = new Map<string, Promise<CdnEntry>>();
  // Only failed deletions need a tombstone. Do not read an invalidated disk
  // entry again merely because the filesystem temporarily refused unlink.
  private readonly blockedDisk = new Set<string>();
  // Identity tokens are needed only while a load is pending. Removing a token
  // invalidates its completion without retaining a tombstone for every URL.
  private readonly generations = new Map<string, object>();

  constructor(options: CdnCacheOptions = {}) {
    this.memory = new BoundedCollection<string, CdnEntry>({
      maxEntries: CDN_MEMORY_MAX_ENTRIES,
      maxBytes: options.memoryMaxBytes ?? CDN_MEMORY_MAX_BYTES,
      sizeOf: (entry) => entry.body.length,
    });
    this.directory = options.directory ?? process.env.CAPTCHA_CDN_CACHE_DIR ??
      path.join(os.homedir(), ".zcode-captcha-cdn-cache");
    if (!this.directory.trim()) throw new Error("CAPTCHA_CDN_CACHE_DIR must not be empty");
    this.ttlMs = parseCdnTtl(options.ttlMs);
    this.now = options.now ?? Date.now;
    this.disk = new CdnDiskPruner({
      directory: this.directory,
      now: this.now,
      maxBytes: options.diskMaxBytes ?? CDN_DISK_MAX_BYTES,
    });
    // Pruned at start and after each write (spec §7). A TTL of 0 disables the
    // disk tier, so such an installation leaves the directory alone.
    if (this.ttlMs > 0) this.disk.prune();
  }

  /** What the memory tier holds now: entries and body bytes (diagnostics and tests). */
  memoryUsage(): { entries: number; bytes: number } {
    return { entries: this.memory.size, bytes: this.memory.bytes };
  }

  private file(url: string): string {
    return path.join(this.directory, sha256(url));
  }

  private fresh(fetchedAt: number): boolean {
    const age = this.now() - fetchedAt;
    return this.ttlMs > 0 && Number.isSafeInteger(fetchedAt) && fetchedAt >= 0 && age >= 0 && age < this.ttlMs;
  }

  get(url: string): CdnEntry | null {
    if (this.ttlMs === 0) return null;
    const memory = this.memory.get(url);
    if (memory && this.fresh(memory.fetchedAt)) return Object.freeze({ ...memory, source: "memory" });
    this.memory.delete(url);
    if (this.blockedDisk.has(url)) return null;
    try {
      // One envelope keeps timestamp and bytes in the same atomic transaction.
      // Legacy raw-body files have no retrieval time: deliberately treat as misses.
      const bytes = fs.readFileSync(this.file(url));
      const end = bytes.indexOf(10);
      if (end < 0 || end > 512) return null;
      const header = JSON.parse(bytes.subarray(0, end).toString("utf8"));
      if (header.version !== 1 || !this.fresh(header.fetchedAt)) return null;
      const body = bytes.subarray(end + 1);
      if (!body.length || header.length !== body.length || header.sha256 !== sha256(body)) return null;
      const entry: CdnEntry = Object.freeze({ body, fetchedAt: header.fetchedAt, sha256: header.sha256, source: "disk" });
      this.memory.set(url, entry); // Promotion must NOT reset fetchedAt.
      return entry;
    } catch {
      return null;
    }
  }

  invalidate(url: string): void {
    this.generations.delete(url);
    this.pending.delete(url);
    this.memory.delete(url);
    try {
      fs.unlinkSync(this.file(url));
      this.blockedDisk.delete(url);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") this.blockedDisk.delete(url);
      else this.blockedDisk.add(url);
    }
  }

  // A synchronous consumer's completed fetch supersedes any pending async load.
  put(url: string, body: Buffer, fetchedAt = this.now()): CdnEntry {
    this.generations.delete(url);
    this.pending.delete(url);
    const entry: CdnEntry = Object.freeze({ body, fetchedAt, sha256: sha256(body), source: "network" });
    this.commit(url, entry);
    return entry;
  }

  async load(url: string, fetchBody: () => Promise<Buffer>): Promise<CdnEntry> {
    const hit = this.get(url);
    if (hit) return hit;
    const pending = this.pending.get(url);
    if (pending) return pending;
    const generation = {};
    this.generations.set(url, generation);
    // Defer invocation until pending is registered, including synchronous throws.
    const promise = Promise.resolve().then(fetchBody).then((body) => {
      const entry: CdnEntry = Object.freeze({ body, fetchedAt: this.now(), sha256: sha256(body), source: "network" });
      if (this.generations.get(url) === generation) this.commit(url, entry);
      // Original waiters still receive their bytes; only publication is revoked.
      return entry;
    }).finally(() => {
      if (this.generations.get(url) === generation) {
        this.generations.delete(url);
        this.pending.delete(url);
      }
    });
    this.pending.set(url, promise);
    return promise;
  }

  private commit(url: string, entry: CdnEntry): void {
    if (!entry.body.length || !this.fresh(entry.fetchedAt)) return;
    this.memory.set(url, entry);
    let temporary: string | undefined;
    let fd: number | undefined;
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      const target = this.file(url);
      temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
      fd = fs.openSync(temporary, "wx", 0o600);
      const header = Buffer.from(JSON.stringify({ version: 1, fetchedAt: entry.fetchedAt, length: entry.body.length, sha256: entry.sha256 }) + "\n");
      fs.writeFileSync(fd, header);
      fs.writeFileSync(fd, entry.body);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, target);
      this.blockedDisk.delete(url);
      temporary = undefined;
      // POSIX needs the directory entry flushed too. Windows cannot generally
      // open/fsync directories; the complete temp file is still renamed atomically.
      let directoryFd: number | undefined;
      try {
        directoryFd = fs.openSync(this.directory, "r");
        fs.fsyncSync(directoryFd);
      } catch {} finally {
        if (directoryFd !== undefined) fs.closeSync(directoryFd);
      }
      this.disk.afterWrite(path.basename(target), header.length + entry.body.length);
    } catch {
      // Disk availability must not turn a valid CDN response into a solve error.
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
      if (temporary) { try { fs.unlinkSync(temporary); } catch {} }
    }
  }
}
